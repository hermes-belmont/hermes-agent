from __future__ import annotations

import json
import os
import secrets
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_hermes_home

HERMES_HOME = get_hermes_home()
MISSION_CONTROL_HOME = HERMES_HOME / "mission_control"
STATE_PATH = MISSION_CONTROL_HOME / "state.json"
MIGRATION_BACKUP_PATH = MISSION_CONTROL_HOME / "state.json.pre_slice_8a_migration_backup"
RUNTIME_DIR = HERMES_HOME / "runtime"
MESSAGES_DIR = RUNTIME_DIR / "messages"
TRACKED_ITEMS_DIR = RUNTIME_DIR / "tracked-items"
BRIEFINGS_DIR = RUNTIME_DIR / "briefings"
AGENT_PURGE_AUDIT_LOG = RUNTIME_DIR / "agent-purge-audit.log"

ENTITY_TYPES = {"trust", "llc", "corp", "personal", "other"}
MESSAGING_POLICIES = {"open", "restricted", "isolated"}
POLICY_RANK = {"open": 0, "restricted": 1, "isolated": 2}
BRIEFING_AGENT_IDS = {
    "agent_ab9825e9ca",
    "agent_69215fd621",
    "agent_2fbf94bf93",
    "agent_aa2e50d113",
    "agent_b61326ba1c",
}

DEFAULT_ENTITY_TREE = [
    {"key": "trust", "name": "Umbrella Corporation Trust", "type": "trust", "parent_key": None, "display_order": 0},
    {"key": "holdings", "name": "Umbrella Holdings Group, LLC", "type": "llc", "parent_key": "trust", "display_order": 0},
    {"key": "media", "name": "Umbrella Media, LLC", "type": "llc", "parent_key": "holdings", "display_order": 0},
    {"key": "properties", "name": "Umbrella Properties, LLC", "type": "llc", "parent_key": "holdings", "display_order": 1},
    {"key": "customs", "name": "Umbrella Customs, LLC", "type": "llc", "parent_key": "holdings", "display_order": 2},
    {"key": "unassigned", "name": "Unassigned", "type": "other", "parent_key": None, "display_order": 99},
]

ENTITY_ALIASES = {
    "Umbrella Media": "Umbrella Media, LLC",
    "Umbrella Labs": "Unassigned",
    "": "Unassigned",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(payload)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    tmp.replace(path)
    try:
        fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"agents": [], "entities": [], "conversations": [], "audit_log": []}
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"agents": [], "entities": [], "conversations": [], "audit_log": []}
    return data if isinstance(data, dict) else {"agents": [], "entities": [], "conversations": [], "audit_log": []}


def save_state(state: dict[str, Any]) -> dict[str, Any]:
    state["updated_at"] = now_iso()
    atomic_write_json(STATE_PATH, state)
    return state


def backup_state_once() -> None:
    if STATE_PATH.exists() and not MIGRATION_BACKUP_PATH.exists():
        MIGRATION_BACKUP_PATH.write_text(STATE_PATH.read_text(encoding="utf-8"), encoding="utf-8")


def default_entities() -> list[dict[str, Any]]:
    created = now_iso()
    key_to_id: dict[str, str] = {item["key"]: new_id("ent") for item in DEFAULT_ENTITY_TREE}
    entities: list[dict[str, Any]] = []
    for item in DEFAULT_ENTITY_TREE:
        parent_key = item["parent_key"]
        entities.append({
            "id": key_to_id[item["key"]],
            "name": item["name"],
            "type": item["type"],
            "parent_id": key_to_id[parent_key] if parent_key else None,
            "display_order": item["display_order"],
            "description": "",
            "messaging_policy": "open",
            "metadata": {"ein": None, "state": None, "formation_date": None},
            "created_at": created,
            "updated_at": created,
            "deleted_at": None,
            "purge_at": None,
        })
    return entities


def normalize_metadata(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    return {
        "ein": data.get("ein") or None,
        "state": data.get("state") or None,
        "formation_date": data.get("formation_date") or None,
    }


def normalize_entity(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    base = deepcopy(existing or {})
    timestamp = now_iso()
    entity_type = str(payload.get("type", base.get("type", "other")) or "other").strip().lower()
    policy = str(payload.get("messaging_policy", base.get("messaging_policy", "open")) or "open").strip().lower()
    return {
        "id": base.get("id") or new_id("ent"),
        "name": str(payload.get("name", base.get("name", "New Entity")) or "New Entity").strip()[:120] or "New Entity",
        "type": entity_type if entity_type in ENTITY_TYPES else "other",
        "parent_id": payload.get("parent_id", base.get("parent_id")) or None,
        "display_order": int(payload.get("display_order", base.get("display_order", 0)) or 0),
        "description": str(payload.get("description", base.get("description", "")) or ""),
        "messaging_policy": policy if policy in MESSAGING_POLICIES else "open",
        "metadata": normalize_metadata(payload.get("metadata", base.get("metadata", {}))),
        "created_at": base.get("created_at") or timestamp,
        "updated_at": payload.get("updated_at", base.get("updated_at")) or timestamp,
        "deleted_at": base.get("deleted_at"),
        "purge_at": base.get("purge_at"),
    }


def active_entities(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [entity for entity in state.get("entities", []) if not entity.get("deleted_at")]


def active_agents(state: dict[str, Any]) -> list[dict[str, Any]]:
    return [agent for agent in state.get("agents", []) if not agent.get("deleted_at")]


def entity_by_id(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(entity.get("id")): entity for entity in state.get("entities", []) if entity.get("id")}


def entity_name_map(state: dict[str, Any]) -> dict[str, str]:
    return {str(entity.get("name")): str(entity.get("id")) for entity in state.get("entities", []) if entity.get("id")}


def unassigned_entity_id(state: dict[str, Any]) -> str | None:
    for entity in state.get("entities", []):
        if entity.get("name") == "Unassigned":
            return str(entity.get("id"))
    return state.get("entities", [{}])[-1].get("id") if state.get("entities") else None


def normalize_agent_entity_fields(state: dict[str, Any]) -> bool:
    changed = False
    name_to_id = entity_name_map(state)
    by_id = entity_by_id(state)
    fallback = unassigned_entity_id(state)
    now = now_iso()
    for agent in state.get("agents", []):
        raw_name = str(agent.get("operating_entity") or "").strip()
        canonical_name = ENTITY_ALIASES.get(raw_name, raw_name) or "Unassigned"
        entity_id = agent.get("entity_id") or name_to_id.get(canonical_name) or fallback
        if agent.get("entity_id") != entity_id:
            agent["entity_id"] = entity_id
            changed = True
        resolved = by_id.get(str(entity_id or ""))
        mirror = resolved.get("name") if resolved else canonical_name
        if agent.get("operating_entity") != mirror:
            agent["operating_entity"] = mirror
            changed = True
        if "description" not in agent:
            agent["description"] = agent.get("advanced", {}).get("notes") or ""
            changed = True
        if "is_briefing_agent" not in agent:
            agent["is_briefing_agent"] = str(agent.get("id")) in BRIEFING_AGENT_IDS
            changed = True
        for key in ("deleted_at", "purge_at", "deleted_by"):
            if key not in agent:
                agent[key] = None
                changed = True
        if "display_order" not in agent:
            agent["display_order"] = 0
            changed = True
        if "created_at" not in agent:
            agent["created_at"] = now
            changed = True
        if "updated_at" not in agent:
            agent["updated_at"] = now
            changed = True
    # Alphabetical display_order per entity when first migrated or duplicate order zeros.
    grouped: dict[str, list[dict[str, Any]]] = {}
    for agent in state.get("agents", []):
        grouped.setdefault(str(agent.get("entity_id") or ""), []).append(agent)
    for rows in grouped.values():
        needs_order = any(int(agent.get("display_order") or 0) == 0 for agent in rows) and len({int(agent.get("display_order") or 0) for agent in rows}) <= 1
        if needs_order:
            for index, agent in enumerate(sorted(rows, key=lambda a: str(a.get("name") or "").lower())):
                if agent.get("display_order") != index:
                    agent["display_order"] = index
                    changed = True
    return changed


def migrate_state_if_needed(state: dict[str, Any], persist: bool = True) -> tuple[dict[str, Any], bool]:
    changed = False
    if not isinstance(state.get("entities"), list) or not state.get("entities"):
        backup_state_once()
        state["entities"] = default_entities()
        changed = True
    normalized_entities = []
    for entity in state.get("entities", []):
        if isinstance(entity, dict):
            normalized = normalize_entity(entity, entity)
            if normalized != entity:
                changed = True
            normalized_entities.append(normalized)
    state["entities"] = normalized_entities
    if normalize_agent_entity_fields(state):
        changed = True
    state.setdefault("conversations", [])
    state.setdefault("audit_log", [])
    if changed and persist:
        save_state(state)
    return state, changed


def load_migrated_state() -> dict[str, Any]:
    state, _ = migrate_state_if_needed(load_state())
    return state


def is_descendant(state: dict[str, Any], child_id: str, ancestor_id: str) -> bool:
    by_id = entity_by_id(state)
    current = by_id.get(child_id)
    seen: set[str] = set()
    while current and current.get("parent_id"):
        parent_id = str(current.get("parent_id"))
        if parent_id in seen:
            return False
        if parent_id == ancestor_id:
            return True
        seen.add(parent_id)
        current = by_id.get(parent_id)
    return False


def in_vertical_chain(state: dict[str, Any], left_id: str | None, right_id: str | None) -> bool:
    if not left_id or not right_id:
        return False
    if left_id == right_id:
        return True
    return is_descendant(state, left_id, right_id) or is_descendant(state, right_id, left_id)


def messaging_policy_check(state: dict[str, Any], from_agent_id: str, to_agent_id: str) -> tuple[bool, str | None]:
    agents = {str(agent.get("id")): agent for agent in active_agents(state)}
    sender = agents.get(str(from_agent_id))
    recipient = agents.get(str(to_agent_id))
    if not sender or not recipient:
        return False, "Unknown agent id"
    entities = entity_by_id(state)
    sender_entity_id = str(sender.get("entity_id") or "")
    recipient_entity_id = str(recipient.get("entity_id") or "")
    sender_entity = entities.get(sender_entity_id) or {}
    recipient_entity = entities.get(recipient_entity_id) or {}
    sender_policy = str(sender_entity.get("messaging_policy") or "open")
    recipient_policy = str(recipient_entity.get("messaging_policy") or "open")
    restrictive = sender_policy if POLICY_RANK.get(sender_policy, 0) >= POLICY_RANK.get(recipient_policy, 0) else recipient_policy
    same = sender_entity_id == recipient_entity_id
    vertical = in_vertical_chain(state, sender_entity_id, recipient_entity_id)
    allowed = True
    if restrictive == "isolated":
        allowed = same
    elif restrictive == "restricted":
        allowed = vertical
    if allowed:
        return True, None
    detail = f"sender_policy:{sender_policy} recipient_policy:{recipient_policy} blocks send from {sender_entity_id} to {recipient_entity_id}"
    return False, detail


def can_message(from_agent_id: str, to_agent_id: str) -> bool:
    ok, _ = messaging_policy_check(load_migrated_state(), from_agent_id, to_agent_id)
    return ok


def assert_can_message(from_agent_id: str, to_agent_id: str) -> None:
    ok, detail = messaging_policy_check(load_migrated_state(), from_agent_id, to_agent_id)
    if not ok:
        if detail == "Unknown agent id":
            raise ValueError(detail)
        raise ValueError(json.dumps({"error": "messaging_policy_blocked", "detail": detail}))


def build_tree(entities: list[dict[str, Any]], agents: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    nodes = [{**deepcopy(entity), "children": [], "agents": []} for entity in entities]
    by_id = {node["id"]: node for node in nodes}
    if agents is not None:
        for agent in sorted(agents, key=lambda a: (int(a.get("display_order") or 0), str(a.get("name") or "").lower())):
            node = by_id.get(str(agent.get("entity_id") or ""))
            if node is not None:
                node["agents"].append(deepcopy(agent))
    roots = []
    for node in sorted(nodes, key=lambda e: (int(e.get("display_order") or 0), str(e.get("name") or "").lower())):
        parent_id = node.get("parent_id")
        if parent_id and parent_id in by_id:
            by_id[parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


def next_agent_order(state: dict[str, Any], entity_id: str) -> int:
    orders = [int(agent.get("display_order") or 0) for agent in state.get("agents", []) if agent.get("entity_id") == entity_id and not agent.get("deleted_at")]
    return (max(orders) + 1) if orders else 0


def purge_due_agents(state: dict[str, Any] | None = None) -> dict[str, Any]:
    state = state or load_migrated_state()
    now = datetime.now(timezone.utc)
    purged: list[dict[str, Any]] = []
    remaining = []
    for agent in state.get("agents", []):
        purge_at = agent.get("purge_at")
        due = False
        if purge_at:
            try:
                due = datetime.fromisoformat(str(purge_at).replace("Z", "+00:00")) <= now
            except ValueError:
                due = False
        if due:
            agent_id = str(agent.get("id"))
            _hard_delete_agent_artifacts(agent_id)
            purged.append({"agent_id": agent_id, "name": agent.get("name"), "purged_at": now_iso()})
        else:
            remaining.append(agent)
    state["agents"] = remaining
    for entry in purged:
        state.setdefault("audit_log", []).append({"id": new_id("audit"), "event": "agent.purged", "detail": entry, "created_at": entry["purged_at"]})
        AGENT_PURGE_AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with AGENT_PURGE_AUDIT_LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    if purged:
        save_state(state)
    return {
        "purged_agent_ids": [entry["agent_id"] for entry in purged],
        "purged_count": len(purged),
        "audit_log_path": str(AGENT_PURGE_AUDIT_LOG),
    }


def _hard_delete_agent_artifacts(agent_id: str) -> None:
    safe = "".join(ch for ch in str(agent_id) if ch.isalnum() or ch in {"_", "-"})
    for directory in (MESSAGES_DIR, TRACKED_ITEMS_DIR):
        for suffix in (".json", ".json.bak", ".json.tmp"):
            try:
                (directory / f"{safe}{suffix}").unlink(missing_ok=True)
            except Exception:
                pass
    if BRIEFINGS_DIR.exists():
        for path in BRIEFINGS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            changed = False
            for section in data.get("agents", []) if isinstance(data, dict) else []:
                if section.get("agent_id") == agent_id:
                    section["agent_id"] = None
                    section["label"] = f"Purged agent ({agent_id})"
                    section["parsed_items"] = []
                    section["prompt_context"] = None
                    section["outgoing_messages_sent"] = []
                    section["outgoing_messages_rejected"] = []
                    changed = True
            if changed:
                atomic_write_json(path, data)


def purge_countdown(agent: dict[str, Any]) -> dict[str, Any]:
    purge_at = agent.get("purge_at")
    days = None
    if purge_at:
        try:
            delta = datetime.fromisoformat(str(purge_at).replace("Z", "+00:00")) - datetime.now(timezone.utc)
            days = max(0, int((delta.total_seconds() + 86399) // 86400))
        except ValueError:
            days = None
    return {**deepcopy(agent), "purges_in_days": days}


def soft_delete_timestamp(days: int = 30) -> tuple[str, str]:
    deleted = datetime.now(timezone.utc).replace(microsecond=0)
    return deleted.isoformat(), (deleted + timedelta(days=days)).isoformat()
