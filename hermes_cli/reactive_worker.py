from __future__ import annotations

import asyncio
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_hermes_home
from hermes_cli import messages
from hermes_cli import entities as entities_service
from hermes_cli import respond_sweep

HERMES_HOME = get_hermes_home()
RUNTIME_DIR = HERMES_HOME / "runtime"
REACTIVE_SWEEPS_DIR = RUNTIME_DIR / "reactive-sweeps"
MISSION_CONTROL_STATE_PATH = HERMES_HOME / "mission_control" / "state.json"
RATE_LIMIT_PER_24H = 5
MAX_RECORDS_PER_AGENT = 200

_queue: asyncio.Queue[str] | None = None
_worker_task: asyncio.Task | None = None
_locks: dict[str, asyncio.Lock] = {}
_running_agents: set[str] = set()
_pending_trigger_ids: dict[str, set[str]] = {}
_loop_blocked_by_date: dict[str, int] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _now_iso() -> str:
    return _now().isoformat()


def _new_id() -> str:
    return f"rsw_{secrets.token_hex(4)}"


def _path(agent_id: str) -> Path:
    safe = "".join(ch for ch in str(agent_id) if ch.isalnum() or ch in {"_", "-"})
    if not safe:
        raise ValueError("agent_id is required")
    return REACTIVE_SWEEPS_DIR / f"{safe}.json"


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else default
    except Exception:
        return default
    return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def list_sweeps(agent_id: str, limit: int = 50) -> list[dict[str, Any]]:
    return _read_json(_path(agent_id), [])[: max(1, min(int(limit or 50), MAX_RECORDS_PER_AGENT))]


def list_all_sweeps(limit_per_agent: int = MAX_RECORDS_PER_AGENT) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not REACTIVE_SWEEPS_DIR.exists():
        return []
    for path in REACTIVE_SWEEPS_DIR.glob("*.json"):
        data = _read_json(path, [])
        if isinstance(data, list):
            rows.extend(record for record in data[:limit_per_agent] if isinstance(record, dict))
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return rows


def _local_date_key(dt: datetime | None = None) -> str:
    return (dt or _now()).astimezone().date().isoformat()


def _start_of_today_local() -> datetime:
    local_now = _now().astimezone()
    return local_now.replace(hour=0, minute=0, second=0, microsecond=0)


def _parse_datetime(value: Any) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value))
    except Exception:
        return None
    if parsed.tzinfo is None:
        return parsed.astimezone()
    return parsed


def record_loop_blocked(now: datetime | None = None) -> None:
    key = _local_date_key(now)
    _loop_blocked_by_date[key] = _loop_blocked_by_date.get(key, 0) + 1


def stats_today() -> dict[str, Any]:
    start = _start_of_today_local()
    today: list[dict[str, Any]] = []
    for record in list_all_sweeps():
        created = _parse_datetime(record.get("created_at"))
        if created and created.astimezone() >= start:
            today.append(record)
    by_agent: dict[str, int] = {}
    for record in today:
        agent_id = str(record.get("agent_id") or "")
        if agent_id:
            by_agent[agent_id] = by_agent.get(agent_id, 0) + 1
    completed_latencies = [int(record.get("latency_ms")) for record in today if record.get("status") == "completed" and isinstance(record.get("latency_ms"), int)]
    avg_latency = int(sum(completed_latencies) / len(completed_latencies)) if completed_latencies else 0
    status_payload = status()
    return {
        "total_today": len(today),
        "by_agent_today": by_agent,
        "rate_limited_today": sum(1 for record in today if record.get("status") == "rate_limited"),
        "avg_latency_ms": avg_latency,
        "loop_blocked_today": _loop_blocked_by_date.get(_local_date_key(), 0),
        "active_in_flight": len(status_payload.get("running_agents") or []),
        "queue_size": int(status_payload.get("queue_size") or 0),
    }


def append_sweep_record(agent_id: str, record: dict[str, Any]) -> dict[str, Any]:
    rows = [record, *list_sweeps(agent_id, MAX_RECORDS_PER_AGENT)]
    rows.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    _write_json(_path(agent_id), rows[:MAX_RECORDS_PER_AGENT])
    return record


def _load_state() -> dict[str, Any]:
    try:
        if MISSION_CONTROL_STATE_PATH.exists():
            data = json.loads(MISSION_CONTROL_STATE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {"agents": [], "entities": []}
    except Exception:
        pass
    return {"agents": [], "entities": []}


def _migrated_state() -> dict[str, Any]:
    state, _ = entities_service.migrate_state_if_needed(_load_state(), persist=False)
    return state


def _agent(agent_id: str) -> dict[str, Any] | None:
    for agent in entities_service.active_agents(_migrated_state()):
        if str(agent.get("id") or "") == str(agent_id):
            return agent
    return None


def is_rate_limited(agent_id: str, now: datetime | None = None) -> bool:
    cutoff = (now or _now()) - timedelta(hours=24)
    count = 0
    for record in list_sweeps(agent_id, MAX_RECORDS_PER_AGENT):
        if record.get("status") not in {"completed", "running", "failed"}:
            continue
        try:
            created = datetime.fromisoformat(str(record.get("created_at")))
        except Exception:
            continue
        if created >= cutoff:
            count += 1
    return count >= RATE_LIMIT_PER_24H


def _rate_limited_record(agent_id: str, trigger_message_id: str) -> dict[str, Any]:
    now = _now_iso()
    record = {
        "id": _new_id(),
        "agent_id": agent_id,
        "status": "rate_limited",
        "trigger_message_ids": [trigger_message_id],
        "started_at": None,
        "completed_at": now,
        "latency_ms": None,
        "outgoing_messages_sent": [],
        "outgoing_messages_rejected": [],
        "notes_for_david": "Reactive sweep rate limit reached; deferred to next daily briefing.",
        "error": None,
        "error_class": None,
        "created_at": now,
    }
    return append_sweep_record(agent_id, record)


def qualifies_for_trigger(message: dict[str, Any]) -> tuple[bool, str]:
    agent_id = str(message.get("to_agent_id") or "")
    agent = _agent(agent_id)
    if not agent:
        return False, "recipient_inactive"
    if message.get("priority") != "high":
        return False, "priority_not_high"
    if message.get("status") != "sent":
        return False, "status_not_sent"
    if bool(message.get("sent_from_reactive_sweep")):
        record_loop_blocked()
        return False, "sent_from_reactive_sweep"
    return True, "qualified"


def consider_message_trigger(message: dict[str, Any]) -> dict[str, Any]:
    ok, reason = qualifies_for_trigger(message)
    if not ok:
        return {"triggered": False, "reason": reason}
    agent_id = str(message["to_agent_id"])
    message_id = str(message["id"])
    messages.mark_queued_for_reactive(message_id, True)
    message["queued_for_reactive"] = True
    if is_rate_limited(agent_id):
        _rate_limited_record(agent_id, message_id)
        return {"triggered": False, "reason": "rate_limited"}
    if agent_id in _running_agents:
        _pending_trigger_ids.setdefault(agent_id, set()).add(message_id)
        return {"triggered": False, "reason": "coalesced"}
    enqueue(agent_id, message_id)
    return {"triggered": True, "reason": "queued"}


def enqueue(agent_id: str, trigger_msg_id: str) -> dict[str, Any]:
    global _queue
    _pending_trigger_ids.setdefault(agent_id, set()).add(trigger_msg_id)
    if _queue is not None:
        _queue.put_nowait(agent_id)
    return {"queued": True, "agent_id": agent_id, "trigger_message_id": trigger_msg_id}


def _lock(agent_id: str) -> asyncio.Lock:
    if agent_id not in _locks:
        _locks[agent_id] = asyncio.Lock()
    return _locks[agent_id]


def _trigger_messages(agent_id: str, trigger_message_id: str | None = None) -> list[dict[str, Any]]:
    queued = messages.queued_reactive_messages(agent_id)
    by_id = {str(msg.get("id")): msg for msg in queued if msg.get("id")}
    if trigger_message_id and trigger_message_id not in by_id:
        try:
            msg = messages.get_message(trigger_message_id, agent_id)
            by_id[trigger_message_id] = msg
        except Exception:
            pass
    return sorted(by_id.values(), key=lambda msg: str(msg.get("sent_at") or ""))


async def run_agent_sweep_once(agent_id: str, trigger_message_id: str | None = None) -> dict[str, Any]:
    async with _lock(agent_id):
        if is_rate_limited(agent_id):
            return _rate_limited_record(agent_id, trigger_message_id or "")
        _running_agents.add(agent_id)
        started = time.perf_counter()
        now = _now_iso()
        sweep_id = _new_id()
        trigger_messages = _trigger_messages(agent_id, trigger_message_id)
        trigger_ids = [str(msg.get("id")) for msg in trigger_messages if msg.get("id")]
        record = {
            "id": sweep_id,
            "agent_id": agent_id,
            "status": "running",
            "trigger_message_ids": trigger_ids,
            "started_at": now,
            "completed_at": None,
            "latency_ms": None,
            "outgoing_messages_sent": [],
            "outgoing_messages_rejected": [],
            "notes_for_david": None,
            "error": None,
            "error_class": None,
            "created_at": now,
        }
        try:
            result = await asyncio.wait_for(asyncio.to_thread(respond_sweep.run_respond_sweep, agent_id, trigger_messages), timeout=respond_sweep.RESPOND_SWEEP_TIMEOUT_SECONDS)
            sent, rejected = respond_sweep.validate_and_send_outgoing(agent_id, sweep_id, result.get("outgoing_messages") or [])
            record["status"] = "completed"
            record["outgoing_messages_sent"] = sent
            record["outgoing_messages_rejected"] = rejected
            note = result.get("notes_for_david")
            record["notes_for_david"] = str(note)[:200] if note else None
            if trigger_ids:
                messages.mark_reactive_triggered(trigger_ids, sweep_id)
        except Exception as exc:
            record["status"] = "failed"
            record["error"] = str(exc)
            record["error_class"] = type(exc).__name__
        finally:
            record["completed_at"] = _now_iso()
            record["latency_ms"] = int((time.perf_counter() - started) * 1000)
            append_sweep_record(agent_id, record)
            _pending_trigger_ids.pop(agent_id, None)
            _running_agents.discard(agent_id)
        # If a message arrived after context gathering, schedule a fresh pass.
        if messages.queued_reactive_messages(agent_id) and not is_rate_limited(agent_id):
            enqueue(agent_id, "")
        return record


async def _worker_loop() -> None:
    assert _queue is not None
    while True:
        agent_id = await _queue.get()
        try:
            if agent_id in _running_agents:
                continue
            await run_agent_sweep_once(agent_id, next(iter(_pending_trigger_ids.get(agent_id, {""}))))
        except Exception:
            pass
        finally:
            _queue.task_done()


def start_worker() -> None:
    global _queue, _worker_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _queue is None:
        _queue = asyncio.Queue()
    if _worker_task is None or _worker_task.done():
        _worker_task = loop.create_task(_worker_loop())


def status() -> dict[str, Any]:
    return {"running_agents": sorted(_running_agents), "queue_size": _queue.qsize() if _queue is not None else 0}


def reset_for_tests() -> None:
    global _queue, _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
    _queue = None
    _worker_task = None
    _locks.clear()
    _running_agents.clear()
    _pending_trigger_ids.clear()
    _loop_blocked_by_date.clear()
