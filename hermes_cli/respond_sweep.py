from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from hermes_cli import briefings, messages, tracked_items
from hermes_cli import entities as entities_service
from run_agent import AIAgent

MISSION_CONTROL_STATE_PATH = briefings.MISSION_CONTROL_STATE_PATH
RESPOND_SWEEP_TIMEOUT_SECONDS = 60

RESPOND_SWEEP_PROMPT = """You are {agent_label}, agent for {entity_name}.

You have just received {message_count} high-priority message(s) in your inbox. Consider whether immediate action is needed.

INCOMING:
{incoming_json}

THREAD CONTEXT:
{thread_context_json}

AGENT ROSTER:
{agent_roster_json}

INSTRUCTIONS:

Decide whether to respond. Your options:

1. Reply to the sender. Use in_reply_to in the outgoing message.
2. Escalate or coordinate by messaging another agent.
3. Do nothing. Return outgoing_messages: [].

Most reactive triggers do NOT require multi-step action. A short, clear reply or a single escalation is usually correct.

Cap: at most 2 outgoing messages per respond sweep.

Loop prevention: any messages you send here will NOT trigger further respond sweeps in their recipients, regardless of priority. They will land in inboxes and be picked up by tomorrow's daily briefing if not already in scope.

You may also produce a brief notes_for_david string if the situation warrants flagging to the user. Keep it under 200 chars.

DO NOT produce parsed_items. DO NOT propose new tracked items. This is a reactive sweep, not a briefing.

Return JSON:
{{
  "outgoing_messages": [
    {{
      "to_agent_id": "agent_xxx",
      "subject": "...",
      "body": "...",
      "priority": "low" | "normal" | "high",
      "related_entity": "...",
      "tracked_item_ids": [],
      "in_reply_to": "msg_xxx" or null
    }}
  ],
  "notes_for_david": "string or null"
}}
"""


def _read_json(path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return default


def _load_state() -> dict[str, Any]:
    return _read_json(MISSION_CONTROL_STATE_PATH, {"agents": [], "entities": []})


def _migrated_state() -> dict[str, Any]:
    state, _ = entities_service.migrate_state_if_needed(_load_state(), persist=False)
    return state


def _agent(agent_id: str) -> dict[str, Any] | None:
    for agent in entities_service.active_agents(_migrated_state()):
        if str(agent.get("id") or "") == str(agent_id):
            return agent
    return None


def _entity_name(agent: dict[str, Any] | None) -> str:
    if not agent:
        return "Unassigned"
    state = _migrated_state()
    entity_id = str(agent.get("entity_id") or "")
    for entity in entities_service.active_entities(state):
        if str(entity.get("id") or "") == entity_id:
            return str(entity.get("name") or agent.get("operating_entity") or "Unassigned")
    return str(agent.get("operating_entity") or "Unassigned")


def _thread_context(trigger_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_threads = {str(msg.get("thread_id") or "") for msg in trigger_messages if msg.get("in_reply_to") and msg.get("thread_id")}
    rows: list[dict[str, Any]] = []
    for thread_id in seen_threads:
        for msg in trigger_messages:
            agent_id = str(msg.get("to_agent_id") or "")
            try:
                rows.extend(messages.thread(agent_id, thread_id, status="all", limit=100).get("messages") or [])
            except Exception:
                pass
            break
    dedup = {str(row.get("id")): row for row in rows if row.get("id")}
    return sorted(dedup.values(), key=lambda row: str(row.get("sent_at") or ""))


def _incoming(trigger_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    incoming = []
    for msg in trigger_messages:
        refs = msg.get("references") if isinstance(msg.get("references"), dict) else {}
        incoming.append({
            "id": msg.get("id"),
            "from_agent_id": msg.get("from_agent_id"),
            "from_agent_label": messages.agent_label(str(msg.get("from_agent_id") or "")),
            "subject": msg.get("subject"),
            "priority": msg.get("priority"),
            "sent_at": msg.get("sent_at"),
            "related_entity": msg.get("related_entity"),
            "body": msg.get("body"),
            "references": {"tracked_item_ids": refs.get("tracked_item_ids") or [], "briefing_id": refs.get("briefing_id")},
            "in_reply_to": msg.get("in_reply_to"),
        })
    return incoming


def build_prompt(agent_id: str, trigger_messages: list[dict[str, Any]]) -> str:
    agent = _agent(agent_id)
    return RESPOND_SWEEP_PROMPT.format(
        agent_label=str((agent or {}).get("name") or agent_id),
        entity_name=_entity_name(agent),
        message_count=len(trigger_messages),
        incoming_json=json.dumps(_incoming(trigger_messages), indent=2, ensure_ascii=False),
        thread_context_json=json.dumps(_thread_context(trigger_messages), indent=2, ensure_ascii=False),
        agent_roster_json=json.dumps(briefings.build_agent_roster(agent_id), indent=2, ensure_ascii=False),
    )


def _parse_response(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
    except Exception as exc:
        raise ValueError("Invalid JSON in reactive sweep response") from exc
    if not isinstance(data, dict):
        raise ValueError("Reactive sweep response must be an object")
    outgoing = data.get("outgoing_messages") or []
    if not isinstance(outgoing, list):
        raise ValueError("outgoing_messages must be an array")
    return {"outgoing_messages": outgoing[:2], "notes_for_david": data.get("notes_for_david")}


def run_respond_sweep(agent_id: str, trigger_messages: list[dict[str, Any]]) -> dict[str, Any]:
    agent = _agent(agent_id)
    if not agent:
        raise ValueError(f"Unknown or inactive agent: {agent_id}")
    runtime_agent = AIAgent(
        model=agent.get("preferred_model") or "gpt-5.5",
        quiet_mode=True,
        enabled_toolsets=agent.get("tool_permissions", {}).get("enabled") or [],
        max_tokens=1200,
        platform="mission-control-reactive",
        skip_context_files=False,
        skip_memory=True,
    )
    result = runtime_agent.run_conversation(user_message=build_prompt(agent_id, trigger_messages), system_message=str(agent.get("system_prompt") or ""))
    reply = str(result.get("final_response") or "")
    if result.get("failed") and not reply:
        raise RuntimeError(str(result.get("error") or "Reactive sweep failed"))
    return _parse_response(reply)


def validate_and_send_outgoing(agent_id: str, sweep_id: str, raw_messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sent: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    registry_ids = {str(agent.get("id")) for agent in entities_service.active_agents(_migrated_state()) if agent.get("id")}
    tracked_ids = {str(item.get("id")) for item in tracked_items.load_items_for_agent(agent_id) if item.get("id")}
    inbox_by_id = {str(msg.get("id")): msg for msg in messages.inbox(agent_id, status="sent,read", limit=200).get("messages") or [] if msg.get("id")}
    for idx, raw in enumerate(raw_messages):
        if idx >= 2:
            rejected.append({"to_agent_id": raw.get("to_agent_id") if isinstance(raw, dict) else None, "subject": raw.get("subject") if isinstance(raw, dict) else None, "reason": "exceeded cap of 2, truncated"})
            continue
        to_agent_id = str(raw.get("to_agent_id") or "").strip() if isinstance(raw, dict) else ""
        subject = str(raw.get("subject") or "").strip() if isinstance(raw, dict) else ""
        body = str(raw.get("body") or "").strip() if isinstance(raw, dict) else ""
        priority = str(raw.get("priority") or "normal").strip().lower() if isinstance(raw, dict) else "normal"
        related_entity = raw.get("related_entity") if isinstance(raw, dict) else None
        tracked_item_ids = [str(item) for item in (raw.get("tracked_item_ids") or [])] if isinstance(raw, dict) and isinstance(raw.get("tracked_item_ids") or [], list) else []
        in_reply_to = raw.get("in_reply_to") or None if isinstance(raw, dict) else None
        reason = None
        if not isinstance(raw, dict):
            reason = "outgoing message must be an object"
        elif not to_agent_id:
            reason = "to_agent_id missing"
        elif to_agent_id not in registry_ids:
            reason = "to_agent_id not in registry"
        elif to_agent_id == agent_id:
            reason = "self-send rejected"
        elif not entities_service.messaging_policy_check(_migrated_state(), agent_id, to_agent_id)[0]:
            reason = f"policy_blocked: {entities_service.messaging_policy_check(_migrated_state(), agent_id, to_agent_id)[1]}"
        elif not subject:
            reason = "subject missing"
        elif len(subject) > 200:
            reason = "subject over 200 chars"
        elif not body:
            reason = "body missing"
        elif priority not in messages.VALID_PRIORITIES:
            reason = "priority invalid"
        elif related_entity == "":
            related_entity = None
        if reason is None and related_entity not in messages.VALID_RELATED_ENTITIES:
            reason = "related_entity invalid"
        if reason is None and any(item_id not in tracked_ids for item_id in tracked_item_ids):
            reason = "tracked_item_ids must belong to this agent"
        if reason is None and in_reply_to and str(in_reply_to) not in inbox_by_id:
            reason = "in_reply_to not in inbox"
        if reason:
            rejected.append({"to_agent_id": to_agent_id or None, "subject": subject or None, "reason": reason})
            continue
        payload = {
            "from_agent_id": agent_id,
            "to_agent_id": to_agent_id,
            "subject": subject,
            "body": body,
            "priority": priority,
            "related_entity": related_entity,
            "references": {"tracked_item_ids": tracked_item_ids, "briefing_id": None, "reactive_sweep_id": sweep_id},
            "in_reply_to": str(in_reply_to) if in_reply_to else None,
            "sent_from_reactive_sweep": True,
        }
        try:
            msg = messages.create_message(payload)
        except Exception as exc:
            rejected.append({"to_agent_id": payload.get("to_agent_id"), "subject": payload.get("subject"), "reason": str(exc)})
            continue
        sent.append({"msg_id": msg["id"], "to_agent_id": msg["to_agent_id"], "to_agent_label": messages.agent_label(str(msg["to_agent_id"])), "subject": msg["subject"], "priority": msg["priority"], "in_reply_to": msg.get("in_reply_to")})
    return sent, rejected
