from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_hermes_home
from hermes_cli import entities as entities_service

HERMES_HOME = get_hermes_home()
RUNTIME_DIR = HERMES_HOME / "runtime"
MESSAGES_DIR = RUNTIME_DIR / "messages"
MESSAGING_AUDIT_LOG_PATH = RUNTIME_DIR / "messaging-audit.log"
MISSION_CONTROL_STATE_PATH = HERMES_HOME / "mission_control" / "state.json"

VALID_PRIORITIES = {"low", "normal", "high"}
VALID_RELATED_ENTITIES = {"trust", "holdings", "media", "properties", "customs", None}
VALID_STATUSES = {"sent", "read", "archived"}
ALL_STATUSES = {"sent", "read", "archived"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


def _path(agent_id: str) -> Path:
    safe = "".join(ch for ch in str(agent_id) if ch.isalnum() or ch in {"_", "-"})
    if not safe:
        raise ValueError("agent_id is required")
    return MESSAGES_DIR / f"{safe}.json"


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _atomic_write(path: Path, data: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_suffix(path.suffix + ".bak")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    else:
        path.with_suffix(path.suffix + ".bak").write_text("[]\n", encoding="utf-8")
    tmp = path.with_suffix(path.suffix + ".tmp")
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    tmp.replace(path)
    try:
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass


def _load_state() -> dict[str, Any]:
    try:
        if MISSION_CONTROL_STATE_PATH.exists():
            data = json.loads(MISSION_CONTROL_STATE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {"agents": []}
    except Exception:
        pass
    return {"agents": []}


def registry_agents() -> list[dict[str, Any]]:
    agents = _load_state().get("agents", [])
    return agents if isinstance(agents, list) else []


def agent_ids() -> set[str]:
    return {str(agent.get("id")) for agent in registry_agents() if agent.get("id")}


def agent_label(agent_id: str, fallback: str | None = None) -> str:
    for agent in registry_agents():
        if str(agent.get("id") or "") == str(agent_id):
            return str(agent.get("name") or fallback or agent_id)
    return fallback or str(agent_id)


def _validate_agent_ids(from_agent_id: str, to_agent_id: str) -> None:
    if from_agent_id == to_agent_id:
        raise ValueError("agent cannot send to itself")
    known = agent_ids()
    unknown = [agent_id for agent_id in (from_agent_id, to_agent_id) if agent_id not in known]
    if unknown:
        raise ValueError(f"Unknown agent id: {unknown[0]}")
    try:
        state, _ = entities_service.migrate_state_if_needed(_load_state(), persist=False)
        ok, detail = entities_service.messaging_policy_check(state, from_agent_id, to_agent_id)
        if not ok:
            if detail == "Unknown agent id":
                raise ValueError(detail)
            raise ValueError(json.dumps({"error": "messaging_policy_blocked", "detail": detail}))
    except ValueError as exc:
        text = str(exc)
        try:
            payload = json.loads(text)
        except Exception:
            raise
        if payload.get("error") == "messaging_policy_blocked":
            raise ValueError(text) from exc
        raise


def _normalize_references(value: Any) -> dict[str, Any]:
    refs = value if isinstance(value, dict) else {}
    tracked = refs.get("tracked_item_ids") if isinstance(refs.get("tracked_item_ids"), list) else []
    return {"tracked_item_ids": [str(item) for item in tracked], "briefing_id": refs.get("briefing_id")}


def _find_message_any(message_id: str) -> dict[str, Any] | None:
    MESSAGES_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(MESSAGES_DIR.glob("*.json")):
        for message in _read(path):
            if message.get("id") == message_id:
                return message
    return None


def _sort_messages(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed = list(enumerate(rows))
    indexed.sort(key=lambda item: (str(item[1].get("sent_at") or ""), item[0]), reverse=True)
    return [message for _, message in indexed]


def create_message(payload: dict[str, Any]) -> dict[str, Any]:
    from_agent_id = str(payload.get("from_agent_id") or "").strip()
    to_agent_id = str(payload.get("to_agent_id") or "").strip()
    if not from_agent_id or not to_agent_id:
        raise ValueError("from_agent_id and to_agent_id are required")
    _validate_agent_ids(from_agent_id, to_agent_id)
    subject = str(payload.get("subject") or "").strip()
    if len(subject) > 200:
        raise ValueError("subject must be 200 chars or fewer")
    priority = str(payload.get("priority") or "normal").strip().lower()
    if priority not in VALID_PRIORITIES:
        raise ValueError("priority must be one of: low, normal, high")
    related_entity = payload.get("related_entity")
    if related_entity == "":
        related_entity = None
    if related_entity not in VALID_RELATED_ENTITIES:
        raise ValueError("related_entity must be one of: trust, holdings, media, properties, customs")

    in_reply_to = payload.get("in_reply_to") or None
    parent = _find_message_any(str(in_reply_to)) if in_reply_to else None
    if in_reply_to and not parent:
        raise ValueError("in_reply_to message not found")
    thread_id = str(parent["thread_id"]) if parent else _new_id("thread")
    supplied_thread_id = payload.get("thread_id")
    if supplied_thread_id and str(supplied_thread_id) != thread_id:
        raise ValueError("thread_id mismatch for reply")

    now = _now_iso()
    message = {
        "id": _new_id("msg"),
        "thread_id": thread_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "subject": subject,
        "body": str(payload.get("body") or ""),
        "priority": priority,
        "related_entity": related_entity,
        "references": _normalize_references(payload.get("references")),
        "in_reply_to": str(in_reply_to) if in_reply_to else None,
        "status": "sent",
        "sent_at": now,
        "read_at": None,
        "archived_at": None,
        "created_at": now,
        "updated_at": now,
        "sent_from_reactive_sweep": bool(payload.get("sent_from_reactive_sweep", False)),
        "triggered_reactive_sweep": bool(payload.get("triggered_reactive_sweep", False)),
        "queued_for_reactive": bool(payload.get("queued_for_reactive", False)),
        "reactive_sweep_id": payload.get("reactive_sweep_id") or None,
    }
    sender_path = _path(from_agent_id)
    recipient_path = _path(to_agent_id)
    sender_messages = _read(sender_path)
    recipient_messages = _read(recipient_path)
    sender_messages.append(message)
    recipient_messages.append(message)
    _atomic_write(sender_path, sender_messages)
    try:
        _atomic_write(recipient_path, recipient_messages)
    except Exception:
        _atomic_write(sender_path, _read(sender_path)[:-1])
        raise
    return message


def _status_set(status: str | None, default: set[str]) -> set[str]:
    if not status:
        return default
    if str(status).strip().lower() == "all":
        return set(ALL_STATUSES)
    requested = {part.strip() for part in str(status).split(",") if part.strip()}
    invalid = requested - VALID_STATUSES
    if invalid:
        raise ValueError("status must be sent, read, archived, or all")
    return requested or default


def _apply_before(rows: list[dict[str, Any]], before: str | None) -> list[dict[str, Any]]:
    if not before:
        return rows
    for idx, msg in enumerate(rows):
        if msg.get("id") == before:
            return rows[idx + 1:]
    return [msg for msg in rows if str(msg.get("sent_at") or "") < str(before)]


def _page(rows: list[dict[str, Any]], *, status: str | None, limit: int, before: str | None, thread_id: str | None, default_statuses: set[str]) -> dict[str, Any]:
    statuses = _status_set(status, default_statuses)
    filtered = [msg for msg in rows if msg.get("status") in statuses]
    if thread_id:
        filtered = [msg for msg in filtered if msg.get("thread_id") == thread_id]
    filtered = _apply_before(_sort_messages(filtered), before)
    safe_limit = max(1, min(int(limit or 50), 200))
    unread_count = sum(1 for msg in rows if msg.get("status") == "sent" and not msg.get("archived_at"))
    return {"messages": filtered[:safe_limit], "total": len(filtered), "unread_count": unread_count}


def inbox(agent_id: str, *, status: str | None = None, limit: int = 50, before: str | None = None, thread_id: str | None = None) -> dict[str, Any]:
    rows = [msg for msg in _read(_path(agent_id)) if msg.get("to_agent_id") == agent_id]
    if status != "all":
        rows = [msg for msg in rows if not msg.get("archived_at")]
    return _page(rows, status=status, limit=limit, before=before, thread_id=thread_id, default_statuses={"sent", "read"})


def sent(agent_id: str, *, status: str | None = None, limit: int = 50, before: str | None = None, thread_id: str | None = None) -> dict[str, Any]:
    rows = [msg for msg in _read(_path(agent_id)) if msg.get("from_agent_id") == agent_id]
    if status != "all":
        rows = [msg for msg in rows if not msg.get("archived_at")]
    return _page(rows, status=status, limit=limit, before=before, thread_id=thread_id, default_statuses={"sent", "read"})


def thread(agent_id: str, thread_id: str, *, status: str | None = "all", limit: int = 200) -> dict[str, Any]:
    rows = [msg for msg in _read(_path(agent_id)) if msg.get("thread_id") == thread_id]
    statuses = _status_set(status, ALL_STATUSES)
    filtered = [msg for msg in rows if msg.get("status") in statuses]
    ordered = sorted(filtered, key=lambda msg: str(msg.get("sent_at") or ""))
    safe_limit = max(1, min(int(limit or 200), 200))
    unread_count = sum(1 for msg in rows if msg.get("to_agent_id") == agent_id and msg.get("status") == "sent" and not msg.get("archived_at"))
    return {"messages": ordered[:safe_limit], "total": len(filtered), "unread_count": unread_count}


def get_message(message_id: str, agent_id: str) -> dict[str, Any]:
    for message in _read(_path(agent_id)):
        if message.get("id") == message_id:
            return message
    raise FileNotFoundError(message_id)


def _update_copy(agent_id: str, message_id: str, updater) -> dict[str, Any]:
    path = _path(agent_id)
    rows = _read(path)
    for idx, message in enumerate(rows):
        if message.get("id") == message_id:
            updated = updater(dict(message))
            updated["updated_at"] = _now_iso()
            rows[idx] = updated
            _atomic_write(path, rows)
            return updated
    raise FileNotFoundError(message_id)


def _participants_for_message(message: dict[str, Any]) -> list[str]:
    seen: list[str] = []
    for key in ("from_agent_id", "to_agent_id"):
        value = str(message.get(key) or "").strip()
        if value and value not in seen:
            seen.append(value)
    return seen


def update_message_everywhere(message_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    existing = _find_message_any(message_id)
    if not existing:
        raise FileNotFoundError(message_id)
    updated: dict[str, Any] | None = None
    for agent_id in _participants_for_message(existing):
        updated = _update_copy(agent_id, message_id, lambda row: {**row, **patch})
    return updated or existing


def mark_queued_for_reactive(message_id: str, queued: bool = True) -> dict[str, Any]:
    return update_message_everywhere(message_id, {"queued_for_reactive": bool(queued)})


def mark_reactive_triggered(message_ids: list[str], sweep_id: str) -> None:
    for message_id in message_ids:
        update_message_everywhere(message_id, {"queued_for_reactive": False, "triggered_reactive_sweep": True, "reactive_sweep_id": sweep_id})


def queued_reactive_messages(agent_id: str) -> list[dict[str, Any]]:
    rows = [msg for msg in _read(_path(agent_id)) if msg.get("to_agent_id") == agent_id and msg.get("queued_for_reactive")]
    return sorted(rows, key=lambda msg: str(msg.get("sent_at") or ""))


def mark_read(message_id: str, agent_id: str) -> dict[str, Any]:
    message = get_message(message_id, agent_id)
    if message.get("to_agent_id") != agent_id:
        raise PermissionError("only the recipient can mark a message read")

    def updater(row: dict[str, Any]) -> dict[str, Any]:
        if row.get("status") == "sent":
            row["status"] = "read"
            row["read_at"] = _now_iso()
        return row

    return _update_copy(agent_id, message_id, updater)


def archive_message(message_id: str, agent_id: str) -> dict[str, Any]:
    get_message(message_id, agent_id)

    def updater(row: dict[str, Any]) -> dict[str, Any]:
        row["status"] = "archived"
        row["archived_at"] = _now_iso()
        return row

    return _update_copy(agent_id, message_id, updater)


def delete_message(message_id: str, agent_id: str) -> bool:
    path = _path(agent_id)
    rows = _read(path)
    kept = [msg for msg in rows if msg.get("id") != message_id]
    if len(kept) == len(rows):
        return False
    _atomic_write(path, kept)
    return True


def unread_counts() -> dict[str, int]:
    counts = {agent_id: 0 for agent_id in sorted(agent_ids())}
    for agent_id in list(counts):
        for message in _read(_path(agent_id)):
            if message.get("to_agent_id") == agent_id and message.get("status") == "sent" and not message.get("archived_at"):
                counts[agent_id] += 1
    return counts


def unread_summary_for_briefing(agent_id: str, limit: int = 10) -> list[dict[str, Any]]:
    rows = inbox(agent_id, status="sent", limit=limit)["messages"]
    return [
        {
            "id": message.get("id"),
            "thread_id": message.get("thread_id"),
            "from_agent_id": message.get("from_agent_id"),
            "from_agent_label": agent_label(str(message.get("from_agent_id") or "")),
            "subject": message.get("subject"),
            "priority": message.get("priority"),
            "sent_at": message.get("sent_at"),
            "related_entity": message.get("related_entity"),
        }
        for message in rows[:limit]
    ]


def append_audit_log(entry: dict[str, Any]) -> None:
    MESSAGING_AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ts": _now_iso(), **entry}
    with MESSAGING_AUDIT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        handle.write("\n")


def seed_default_messages(force: bool = False) -> list[dict[str, Any]]:
    from hermes_cli import tracked_items

    labels = {agent_label(agent_id).lower(): agent_id for agent_id in agent_ids()}

    def find_agent(label: str) -> str | None:
        target = label.lower()
        for name, agent_id in labels.items():
            if target in name:
                return agent_id
        return None

    holdings = find_agent("holdings operator")
    financial = find_agent("financial analyst")
    customs = find_agent("customs director")
    properties = find_agent("properties director")
    media = find_agent("media director")
    required = [holdings, financial, customs, properties, media]
    if any(agent_id is None for agent_id in required):
        return []

    all_existing = [msg for agent_id in set(required) if agent_id for msg in _read(_path(agent_id))]
    if not force and any("seed data for slice 7" in str(msg.get("body", "")).lower() for msg in all_existing):
        return []

    def tracked_id(agent_id: str, title_part: str) -> str | None:
        for item in tracked_items.load_items_for_agent(agent_id):
            if title_part.lower() in str(item.get("title") or "").lower():
                return str(item.get("id"))
        return None

    assert holdings and financial and customs and properties and media
    seed_tag = "\n\n[Seed data for Slice 7 inter-agent messaging; safe to remove later.]"
    created: list[dict[str, Any]] = []
    msg1 = create_message({"from_agent_id": holdings, "to_agent_id": financial, "subject": "Q2 estimated tax planning", "body": "Seed coordination note for estimated tax planning." + seed_tag, "priority": "normal", "related_entity": "holdings", "references": {"tracked_item_ids": [tracked_id(financial, "Q2 estimated tax payment")], "briefing_id": None}})
    created.append(msg1)
    created.append(create_message({"from_agent_id": customs, "to_agent_id": holdings, "subject": "FBA Q3 restock budget request", "body": "Seed budget request for Q3 restock planning." + seed_tag, "priority": "high", "related_entity": "customs", "references": {"tracked_item_ids": [tracked_id(customs, "Restock listings on Amazon FBA Q3")], "briefing_id": None}}))
    created.append(create_message({"from_agent_id": properties, "to_agent_id": financial, "subject": "Hot tub repair invoice approval", "body": "Seed invoice approval request for property maintenance." + seed_tag, "priority": "normal", "related_entity": "properties"}))
    created.append(create_message({"from_agent_id": media, "to_agent_id": holdings, "subject": "Client X campaign launch status", "body": "Seed launch status message for Client X." + seed_tag, "priority": "high", "related_entity": "media", "references": {"tracked_item_ids": [tracked_id(media, "Client X campaign launch")], "briefing_id": None}}))
    created.append(create_message({"from_agent_id": financial, "to_agent_id": holdings, "subject": "Re: Q2 estimated tax planning", "body": "Seed reply confirming planning review." + seed_tag, "priority": "normal", "in_reply_to": msg1["id"], "related_entity": "holdings"}))
    return created
