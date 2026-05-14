from __future__ import annotations

import json
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_hermes_home

TRACKED_ITEMS_DIR = get_hermes_home() / "runtime" / "tracked-items"

VALID_ENTITIES = {"trust", "holdings", "media", "properties", "customs", None}
VALID_CATEGORIES = {"deadline", "milestone", "recurring", "issue", "watch"}
VALID_RECURRENCES = {"daily", "weekly", "monthly", "quarterly", "annual", None}
VALID_PRIORITIES = {"low", "medium", "high"}
VALID_STATUSES = {"active", "snoozed", "done", "dismissed"}
VALID_SOURCES = {"manual", "chat", "import"}
STATUS_ACTIONS = {"snooze": "snoozed", "done": "done", "dismiss": "dismissed", "reactivate": "active"}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _now_iso() -> str:
    return _now().isoformat()


def _path(agent_id: str) -> Path:
    safe = "".join(ch for ch in str(agent_id) if ch.isalnum() or ch in {"_", "-"})
    if not safe:
        raise ValueError("agent_id is required")
    return TRACKED_ITEMS_DIR / f"{safe}.json"


def _atomic_write(path: Path, data: list[dict[str, Any]]) -> None:
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
        dir_fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except OSError:
        pass


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    return data if isinstance(data, list) else []


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value))
        except ValueError as exc:
            raise ValueError("due_date must be ISO date") from exc


def _normalize_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = [part.strip() for part in value.split(",")]
    elif isinstance(value, list):
        raw = [str(part).strip() for part in value]
    else:
        raise ValueError("tags must be a list")
    return [tag[:40] for tag in raw if tag][:12]


def _validate_enum(field: str, value: Any, allowed: set[Any]) -> Any:
    if value not in allowed:
        allowed_text = ", ".join(sorted(str(item) for item in allowed if item is not None))
        raise ValueError(f"{field} must be one of: {allowed_text}")
    return value


def normalize_item(agent_id: str, payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("tracked item payload must be an object")
    now = _now_iso()
    base = dict(existing or {})
    item_agent_id = str(payload.get("agent_id") or base.get("agent_id") or agent_id)
    title = str(payload.get("title", base.get("title", "")) or "").strip()
    if not title:
        raise ValueError("title is required")
    due_value = payload.get("due_date", base.get("due_date"))
    due_date = _parse_date(due_value)
    recurrence = payload.get("recurrence", base.get("recurrence"))
    if recurrence == "":
        recurrence = None
    category = str(payload.get("category", base.get("category", "watch")) or "watch")
    priority = str(payload.get("priority", base.get("priority", "medium")) or "medium")
    status = str(payload.get("status", base.get("status", "active")) or "active")
    entity = payload.get("entity", base.get("entity"))
    if entity == "":
        entity = None
    source = str(payload.get("source", base.get("source", "manual")) or "manual")
    _validate_enum("entity", entity, VALID_ENTITIES)
    _validate_enum("category", category, VALID_CATEGORIES)
    _validate_enum("recurrence", recurrence, VALID_RECURRENCES)
    _validate_enum("priority", priority, VALID_PRIORITIES)
    _validate_enum("status", status, VALID_STATUSES)
    _validate_enum("source", source, VALID_SOURCES)
    return {
        "id": str(base.get("id") or payload.get("id") or uuid.uuid4()),
        "agent_id": item_agent_id,
        "entity": entity,
        "title": title[:180],
        "description": (str(payload.get("description", base.get("description")) or "").strip() or None),
        "category": category,
        "due_date": due_date.isoformat() if due_date else None,
        "recurrence": recurrence,
        "priority": priority,
        "status": status,
        "tags": _normalize_tags(payload.get("tags", base.get("tags", []))),
        "notes": (str(payload.get("notes", base.get("notes")) or "").strip() or None),
        "source": source,
        "created_at": str(base.get("created_at") or payload.get("created_at") or now),
        "updated_at": now,
        "last_briefed_at": payload.get("last_briefed_at", base.get("last_briefed_at")),
    }


def load_items_for_agent(agent_id: str) -> list[dict[str, Any]]:
    return _read(_path(agent_id))


def _write_items_for_agent(agent_id: str, items: list[dict[str, Any]]) -> None:
    _atomic_write(_path(agent_id), items)


def save_item(agent_id: str, item: dict[str, Any]) -> dict[str, Any]:
    existing_items = load_items_for_agent(agent_id)
    item_id = item.get("id")
    idx = next((i for i, candidate in enumerate(existing_items) if candidate.get("id") == item_id), None) if item_id else None
    normalized = normalize_item(agent_id, item, existing_items[idx] if idx is not None else None)
    if idx is None:
        existing_items.append(normalized)
    else:
        existing_items[idx] = normalized
    _write_items_for_agent(agent_id, existing_items)
    return normalized


def update_item(item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    for item in list_all_items():
        if item.get("id") == item_id:
            return save_item(str(item["agent_id"]), {**item, **patch, "id": item_id})
    raise FileNotFoundError(item_id)


def delete_item(agent_id: str, item_id: str) -> bool:
    items = load_items_for_agent(agent_id)
    kept = [item for item in items if item.get("id") != item_id]
    if len(kept) == len(items):
        return False
    _write_items_for_agent(agent_id, kept)
    return True


def delete_item_by_id(item_id: str) -> bool:
    for item in list_all_items():
        if item.get("id") == item_id:
            return delete_item(str(item["agent_id"]), item_id)
    return False


def list_all_items(filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    TRACKED_ITEMS_DIR.mkdir(parents=True, exist_ok=True)
    filters = {k: v for k, v in (filters or {}).items() if v not in (None, "", "all")}
    rows: list[dict[str, Any]] = []
    for path in sorted(TRACKED_ITEMS_DIR.glob("*.json")):
        rows.extend(_read(path))
    for field, value in filters.items():
        rows = [item for item in rows if str(item.get(field)) == str(value)]
    return sorted(rows, key=lambda item: (item.get("due_date") or "9999-12-31", item.get("priority") != "high", item.get("updated_at") or ""))


def active_items_for_briefing(agent_id: str) -> list[dict[str, Any]]:
    today = _now().date()
    cutoff = today + timedelta(days=14)
    active: list[dict[str, Any]] = []
    for item in load_items_for_agent(agent_id):
        if item.get("status") != "active":
            continue
        recurrence = item.get("recurrence")
        due = _parse_date(item.get("due_date")) if item.get("due_date") else None
        if due is None or due <= cutoff or recurrence is not None:
            active.append(item)
    return active


def mark_briefed(item_ids: set[str], timestamp: str | None = None) -> None:
    if not item_ids:
        return
    ts = timestamp or _now_iso()
    by_agent: dict[str, list[dict[str, Any]]] = {}
    changed: set[str] = set()
    for item in list_all_items():
        agent_id = str(item.get("agent_id"))
        if item.get("id") in item_ids:
            item = {**item, "last_briefed_at": ts, "updated_at": ts}
            changed.add(agent_id)
        by_agent.setdefault(agent_id, []).append(item)
    for agent_id in changed:
        _write_items_for_agent(agent_id, by_agent[agent_id])


def apply_action(item_id: str, action: str) -> dict[str, Any]:
    if action not in STATUS_ACTIONS:
        raise ValueError("action must be one of: snooze, done, dismiss, reactivate")
    return update_item(item_id, {"status": STATUS_ACTIONS[action]})


def compact_for_prompt(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact = []
    for item in items:
        description = item.get("description")
        compact.append({
            "id": item.get("id"),
            "title": item.get("title"),
            "description": str(description)[:200] if description else None,
            "category": item.get("category"),
            "due_date": item.get("due_date"),
            "recurrence": item.get("recurrence"),
            "priority": item.get("priority"),
            "tags": item.get("tags") or [],
        })
    return compact


def seed_default_items(agent_targets: list[dict[str, Any]] | None = None, force: bool = False) -> list[dict[str, Any]]:
    from hermes_cli.briefings import DEFAULT_AGENT_TARGETS

    targets = agent_targets or DEFAULT_AGENT_TARGETS
    by_label = {target["label"]: target["agent_id"] for target in targets}
    today = _now().date()
    seed_note = "Seed data for Slice 6.2 review; fake illustrative item, safe to remove later."
    definitions = {
        "Customs Director": [
            {"entity": "customs", "title": "Restock listings on Amazon FBA Q3", "description": "Review inventory position and FBA listing health for Q3 restock planning.", "category": "recurring", "recurrence": "monthly", "priority": "high", "tags": ["seed", "amazon", "fba"]},
            {"entity": "customs", "title": "Renew HTS classification review", "description": "Annual customs classification sanity check for top SKUs.", "category": "deadline", "due_date": (today + timedelta(days=45)).isoformat(), "recurrence": "annual", "priority": "medium", "tags": ["seed", "hts"]},
        ],
        "Media Director": [
            {"entity": "media", "title": "Client X campaign launch", "description": "Illustrative launch checklist for a paid media campaign going live soon.", "category": "deadline", "due_date": (today + timedelta(days=5)).isoformat(), "priority": "high", "tags": ["seed", "launch"]},
            {"entity": "media", "title": "Monthly content batch delivery", "description": "Recurring content asset delivery review.", "category": "recurring", "recurrence": "monthly", "priority": "medium", "tags": ["seed", "content"]},
        ],
        "Properties Director": [
            {"entity": "properties", "title": "Hot tub maintenance, Property A", "description": "Quarterly service and guest-readiness check.", "category": "recurring", "recurrence": "quarterly", "priority": "medium", "tags": ["seed", "maintenance"]},
            {"entity": "properties", "title": "Owner statement review", "description": "Monthly statement review for rental property performance.", "category": "recurring", "recurrence": "monthly", "priority": "medium", "tags": ["seed", "statements"]},
        ],
        "Financial Analyst": [
            {"entity": "holdings", "title": "Q2 estimated tax payment", "description": "Illustrative estimated tax planning checkpoint.", "category": "deadline", "due_date": (today + timedelta(days=30)).isoformat(), "priority": "high", "tags": ["seed", "tax"]},
            {"entity": "holdings", "title": "Monthly bookkeeping close", "description": "Monthly close checklist and variance scan.", "category": "recurring", "recurrence": "monthly", "priority": "medium", "tags": ["seed", "bookkeeping"]},
        ],
        "Holdings Operator": [
            {"entity": "holdings", "title": "Florida Sunbiz annual report", "description": "Annual report watch item for Florida entity compliance.", "category": "recurring", "due_date": (today + timedelta(days=120)).isoformat(), "recurrence": "annual", "priority": "medium", "tags": ["seed", "compliance"]},
            {"entity": "holdings", "title": "Operating agreement review", "description": "Annual governance document review.", "category": "recurring", "recurrence": "annual", "priority": "low", "tags": ["seed", "governance"]},
        ],
    }
    saved: list[dict[str, Any]] = []
    for label, items in definitions.items():
        agent_id = by_label.get(label)
        if not agent_id:
            continue
        existing_titles = {item.get("title") for item in load_items_for_agent(agent_id)}
        for payload in items:
            if not force and payload["title"] in existing_titles:
                continue
            saved.append(save_item(agent_id, {"agent_id": agent_id, "status": "active", "source": "manual", "notes": seed_note, **payload}))
    return saved
