from __future__ import annotations

import fcntl
import json
import os
import plistlib
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from hermes_cli.config import get_hermes_home
from hermes_cli import messages, tracked_items
from hermes_cli import entities as entities_service
from run_agent import AIAgent

STANDARD_BRIEFING_PROMPT = """Daily briefing check-in.

Prompt context:
{prompt_context_json}

The prompt_context object always includes active_items_for_briefing. It may include unread inter-agent message summaries when they exist.

AGENT ROSTER
{agent_roster_json}

OUTGOING MESSAGES INSTRUCTIONS
You MAY produce an outgoing_messages array in your JSON response. The array is optional.
Send a message when you need another agent's input, attention, or coordination on something you cannot resolve from your own context.
Do NOT send messages just to acknowledge or summarize. Only send when there is a real ask or a real signal.
Cap outgoing_messages at 3 messages per briefing. If you have more candidates, send only the top 3.
You may reply to messages in your inbox using in_reply_to set to that message's id from inbox_summary_for_briefing.
You may NOT message yourself.
Each outgoing_messages entry must use this shape:
{{
  "to_agent_id": "agent_xxx",
  "subject": "string max 200 chars",
  "body": "string",
  "priority": "low" | "normal" | "high",
  "related_entity": "trust" | "holdings" | "media" | "properties" | "customs" | null,
  "tracked_item_ids": ["..."] (optional),
  "in_reply_to": "msg_xxx" (optional, must match an inbox_summary_for_briefing entry)
}}

For recurrence-only tracked items with no specific due date, determine relevance based on the recurrence pattern and today's date ({today_iso}).
Do not mark messages read. If you reply to a message, the parent remains unread until explicitly marked read elsewhere.

Based on these tracked items, unread inter-agent message summaries when present, your memory of relevant context, and anything else you are aware of, what is coming up in the next 7 days that requires David's attention, action, or awareness?

Return each briefing item with: title, due date or relevance window, priority (low/medium/high), reason (one sentence), and source — either the id of a tracked item this maps to, or "agent_inference" if you are surfacing something not in the tracked list.

If nothing is pressing, say so explicitly. Reply in compact JSON only:
{{
  "items": [
    {{ "title": string, "due": string, "priority": "low" | "medium" | "high", "reason": string, "source": string }}
  ],
  "notes_for_david": string (optional),
  "outgoing_messages": [
    {{ "to_agent_id": string, "subject": string, "body": string, "priority": "low" | "normal" | "high", "related_entity": string | null, "tracked_item_ids": [string] (optional), "in_reply_to": string (optional) }}
  ] (optional)
}}"""

DEFAULT_AGENT_IDS: list[str] = [
    "agent_2fbf94bf93",
    "agent_aa2e50d113",
    "agent_b61326ba1c",
    "agent_69215fd621",
    "agent_ab9825e9ca",
]

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
HERMES_HOME = get_hermes_home()
RUNTIME_DIR = HERMES_HOME / "runtime"
BRIEFINGS_DIR = RUNTIME_DIR / "briefings"
CONFIG_PATH = RUNTIME_DIR / "briefings-config.json"
LOCK_PATH = RUNTIME_DIR / "briefings.lock"
LOG_DIR = RUNTIME_DIR / "logs"
MISSION_CONTROL_STATE_PATH = HERMES_HOME / "mission_control" / "state.json"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / "com.hermes.briefing-sweep.plist"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
RUN_STATUS_PATH = RUNTIME_DIR / "briefings-run-status.json"
_FALLBACK_THREAD: threading.Thread | None = None
_FALLBACK_STOP = threading.Event()


ERROR_CLASS_RATE_LIMITED = "Provider rate-limited (429)"
ERROR_CLASS_AUTH_FAILED = "Provider auth failed (401)"
ERROR_CLASS_PROVIDER_TIMEOUT = "Provider timed out"
ERROR_CLASS_KILLED_TIMEOUT = "Agent process killed (timeout after 90s)"
ERROR_CLASS_INVALID_JSON = "Invalid JSON in agent response"
ERROR_CLASS_UNKNOWN = "Unknown error"


class AgentSubprocessError(RuntimeError):
    def __init__(self, message: str, *, stdout: str = "", stderr: str = "", exit_code: int | None = None, timed_out: bool = False, timeout_seconds: int = 90):
        super().__init__(message)
        self.stdout = stdout
        self.stderr = stderr
        self.exit_code = exit_code
        self.timed_out = timed_out
        self.timeout_seconds = timeout_seconds


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _date_id() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _read_json(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


@contextmanager
def _briefing_lock():
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("w") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("A briefing sweep is already running") from exc
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def _load_state() -> dict[str, Any]:
    return _read_json(MISSION_CONTROL_STATE_PATH, {"agents": []})


def _migrated_state() -> dict[str, Any]:
    state, _ = entities_service.migrate_state_if_needed(_load_state(), persist=False)
    return state


def _registry_agents() -> list[dict[str, Any]]:
    state = _migrated_state()
    agents = state.get("agents") if isinstance(state, dict) else []
    return [agent for agent in agents if isinstance(agent, dict) and not agent.get("deleted_at")]


def registry_label_for_agent(agent_id: str, fallback: str | None = None) -> str:
    for agent in _registry_agents():
        if str(agent.get("id") or "") == str(agent_id):
            name = str(agent.get("name") or "").strip()
            return name or (fallback or str(agent_id))
    return fallback or str(agent_id)


def build_agent_roster(agent_id: str) -> list[dict[str, Any]]:
    roster: list[dict[str, Any]] = []
    state = _migrated_state()
    agents = state.get("agents") if isinstance(state, dict) else []
    for agent in agents if isinstance(agents, list) else []:
        if not isinstance(agent, dict) or agent.get("deleted_at"):
            continue
        candidate_id = str(agent.get("id") or "").strip()
        if not candidate_id or candidate_id == agent_id:
            continue
        ok, _detail = entities_service.messaging_policy_check(state, agent_id, candidate_id)
        if not ok:
            continue
        roster.append({
            "agent_id": candidate_id,
            "label": str(agent.get("name") or candidate_id),
            "business_function": agent.get("business_function") or agent.get("role") or None,
            "operating_entity": agent.get("operating_entity"),
        })
    return roster


def build_prompt_sections(agent_id: str, active_items: list[dict[str, Any]] | None = None, today: datetime | None = None) -> dict[str, Any]:
    prompt_context = build_prompt_context(agent_id, active_items)
    return {
        "prompt_context": prompt_context,
        "agent_roster": build_agent_roster(agent_id),
        "today_iso": (today or datetime.now(timezone.utc)).date().isoformat(),
    }


def _label_matches(agent: dict[str, Any], label: str) -> bool:
    needle = label.lower()
    fields = [agent.get("name"), agent.get("role"), agent.get("business_function"), agent.get("operating_entity")]
    return any(needle in str(value or "").lower() for value in fields)


def resolve_agent_targets(config_agents: list[str] | None = None) -> list[dict[str, Any]]:
    registry = _registry_agents()
    by_id = {str(agent.get("id")): agent for agent in registry if agent.get("id")}
    resolved: list[dict[str, Any]] = []
    targets = [agent_id for agent_id in DEFAULT_AGENT_IDS if not config_agents or agent_id in config_agents]
    for configured_id in targets:
        agent = by_id.get(configured_id)
        status = "ok"
        resolved_id = configured_id
        if not agent:
            status = "missing"
        label = registry_label_for_agent(resolved_id, resolved_id) if agent else resolved_id
        resolved.append({"label": label, "agent_id": resolved_id, "configured_agent_id": configured_id, "status": status, "agent": agent})
    return resolved


def default_config() -> dict[str, Any]:
    return {"enabled": True, "time_local": "08:00", "days_of_week": DAYS[:], "agents": DEFAULT_AGENT_IDS[:]}


def load_config() -> dict[str, Any]:
    data = _read_json(CONFIG_PATH, {})
    cfg = {**default_config(), **(data if isinstance(data, dict) else {})}
    cfg["days_of_week"] = [d for d in cfg.get("days_of_week", DAYS) if d in DAYS] or DAYS[:]
    cfg["agents"] = [str(a) for a in cfg.get("agents", [])] or default_config()["agents"]
    cfg["agent_status"] = [{k: v for k, v in item.items() if k != "agent"} for item in resolve_agent_targets(cfg["agents"])]
    cfg["schedule_mode"] = active_schedule_mode()
    return cfg


def _validate_time(value: str) -> str:
    if not re.fullmatch(r"[0-2]\d:[0-5]\d", value or ""):
        raise ValueError("time_local must be HH:MM")
    hour = int(value.split(":", 1)[0])
    if hour > 23:
        raise ValueError("time_local hour must be 00-23")
    return value


def save_config(payload: dict[str, Any]) -> dict[str, Any]:
    cfg = default_config()
    cfg.update(payload or {})
    cfg["enabled"] = bool(cfg.get("enabled", True))
    cfg["time_local"] = _validate_time(str(cfg.get("time_local") or "08:00"))
    days = cfg.get("days_of_week") or DAYS[:]
    if not isinstance(days, list) or any(day not in DAYS for day in days):
        raise ValueError("days_of_week must contain mon/tue/wed/thu/fri/sat/sun")
    cfg["days_of_week"] = days
    agents = cfg.get("agents") or []
    if not isinstance(agents, list):
        raise ValueError("agents must be a list")
    live_ids = {str(agent.get("id")) for agent in _registry_agents() if agent.get("id")}
    target_ids = set(DEFAULT_AGENT_IDS)
    for agent_id in agents:
        if agent_id not in live_ids and agent_id not in target_ids:
            raise ValueError(f"Unknown briefing agent id: {agent_id}")
    cfg["agents"] = [str(agent_id) for agent_id in agents]
    _write_json(CONFIG_PATH, cfg)
    configure_scheduler(cfg)
    return load_config()


def parse_agent_response(raw: str) -> tuple[list[dict[str, str]], str | None, list[Any] | None, str | None]:
    text = (raw or "").strip()
    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.insert(0, text[start:end + 1])
    last_error = None
    for candidate in candidates:
        try:
            data = json.loads(candidate)
            items_raw = data.get("items", []) if isinstance(data, dict) else []
            items: list[dict[str, str]] = []
            if isinstance(items_raw, list):
                for item in items_raw:
                    if not isinstance(item, dict):
                        continue
                    title = str(item.get("title") or "").strip()
                    if not title:
                        continue
                    priority = str(item.get("priority") or "low").strip().lower()
                    if priority not in {"low", "medium", "high"}:
                        priority = "medium"
                    source = str(item.get("source") or "agent_inference").strip()[:120]
                    items.append({
                        "title": title[:160],
                        "due": str(item.get("due") or item.get("relevance_window") or "").strip()[:120],
                        "priority": priority,
                        "reason": str(item.get("reason") or "").strip()[:300],
                        "source": source or "agent_inference",
                    })
            notes = data.get("notes_for_david") if isinstance(data, dict) else None
            outgoing_raw = data.get("outgoing_messages") if isinstance(data, dict) and "outgoing_messages" in data else None
            return items, str(notes).strip() if notes else None, outgoing_raw, None
        except Exception as exc:
            last_error = str(exc)
    return [], None, None, f"Invalid JSON response: {last_error or 'unable to parse'}"


def _system_prompt(agent: dict[str, Any]) -> str:
    return f"You are {agent.get('name')}. Role: {agent.get('role', '')}. Reply exactly as requested."


def query_agent(agent: dict[str, Any], prompt: str, timeout_seconds: int = 90) -> str:
    runtime_agent = AIAgent(
        model=agent.get("preferred_model") or None,
        quiet_mode=True,
        enabled_toolsets=agent.get("tool_permissions", {}).get("enabled") or [],
        max_tokens=1200,
        platform="mission-control-briefing",
        skip_context_files=True,
        skip_memory=True,
    )
    result = runtime_agent.run_conversation(user_message=prompt, system_message=_system_prompt(agent))
    final = str(result.get("final_response") or "")
    if result.get("failed") and not final:
        raise RuntimeError(str(result.get("error") or "Agent run failed"))
    if final.lower().startswith("api call failed") or "http 429" in final.lower():
        raise RuntimeError(final)
    return final


def _process_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value or "")


def classify_briefing_error(
    *,
    error: str = "",
    error_detail: str = "",
    raw_response: str = "",
    exit_code: int | None = None,
    timed_out: bool = False,
    timeout_seconds: int = 90,
    invalid_json: bool = False,
) -> dict[str, str]:
    combined = "\n".join(str(value or "") for value in (error, error_detail, raw_response)).lower()
    if timed_out:
        return {"error_class": f"Agent process killed (timeout after {timeout_seconds}s)", "error_detail": error_detail or error or f"Timed out after {timeout_seconds} seconds"}
    if "429" in combined or "rate limit" in combined or "rate-limited" in combined:
        return {"error_class": ERROR_CLASS_RATE_LIMITED, "error_detail": error_detail or error}
    if "401" in combined or "unauthorized" in combined or "authentication" in combined or "auth failed" in combined:
        return {"error_class": ERROR_CLASS_AUTH_FAILED, "error_detail": error_detail or error}
    if invalid_json:
        detail = (raw_response or error_detail or error or "")[:200]
        return {"error_class": ERROR_CLASS_INVALID_JSON, "error_detail": detail}
    if "timed out" in combined or "timeout" in combined:
        return {"error_class": ERROR_CLASS_PROVIDER_TIMEOUT, "error_detail": error_detail or error}
    if exit_code is not None and exit_code != 0 and not (error_detail or "").strip():
        return {"error_class": f"Agent process exited (code {exit_code})", "error_detail": ""}
    return {"error_class": ERROR_CLASS_UNKNOWN, "error_detail": error_detail or error}


def _python_executable() -> str:
    candidates = [PROJECT_ROOT / "venv" / "bin" / "python", PROJECT_ROOT / ".venv" / "bin" / "python"]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return sys.executable


def _subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME)
    env["HOME"] = str(Path.home())
    existing_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(PROJECT_ROOT) if not existing_pythonpath else f"{PROJECT_ROOT}{os.pathsep}{existing_pythonpath}"
    env["PATH"] = f"{PROJECT_ROOT / 'venv' / 'bin'}{os.pathsep}{PROJECT_ROOT / '.venv' / 'bin'}{os.pathsep}" + env.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
    return env


def query_agent_with_timeout(agent: dict[str, Any], prompt: str, timeout_seconds: int = 90) -> dict[str, Any]:
    payload = json.dumps({"agent": agent, "prompt": prompt, "timeout_seconds": timeout_seconds}, ensure_ascii=False)
    cmd = [_python_executable(), "-m", "hermes_cli.briefing_agent_worker"]
    try:
        completed = subprocess.run(cmd, input=payload, capture_output=True, text=True, timeout=timeout_seconds, cwd=str(PROJECT_ROOT), env=_subprocess_env())
    except subprocess.TimeoutExpired as exc:
        raise AgentSubprocessError(
            f"Timed out after {timeout_seconds} seconds",
            stdout=_process_text(exc.stdout),
            stderr=_process_text(exc.stderr),
            exit_code=None,
            timed_out=True,
            timeout_seconds=timeout_seconds,
        ) from exc
    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    response = ""
    worker_error = ""
    try:
        data = json.loads(stdout.strip().splitlines()[-1]) if stdout.strip() else {}
        response = str(data.get("response") or "") if isinstance(data, dict) else ""
        worker_error = str(data.get("error") or "") if isinstance(data, dict) else ""
    except Exception:
        worker_error = "Unable to parse briefing worker stdout"
    if completed.returncode != 0 or worker_error:
        raise AgentSubprocessError(worker_error or f"Agent process exited with code {completed.returncode}", stdout=stdout, stderr=stderr, exit_code=completed.returncode)
    return {"ok": True, "response": response, "stdout": stdout, "stderr": stderr, "exit_code": completed.returncode, "timed_out": False}


def build_prompt_context(agent_id: str, active_items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    context = {
        "active_items_for_briefing": tracked_items.compact_for_prompt(active_items if active_items is not None else tracked_items.active_items_for_briefing(agent_id))
    }
    inbox_summary = messages.unread_summary_for_briefing(agent_id, limit=10)
    if inbox_summary:
        context["inbox_summary_for_briefing"] = inbox_summary
    return context


def build_briefing_prompt(agent_id: str, active_items: list[dict[str, Any]] | None = None, today: datetime | None = None) -> str:
    sections = build_prompt_sections(agent_id, active_items, today)
    return STANDARD_BRIEFING_PROMPT.format(
        prompt_context_json=json.dumps(sections["prompt_context"], ensure_ascii=False, separators=(",", ":")),
        agent_roster_json=json.dumps(sections["agent_roster"], ensure_ascii=False, indent=2),
        today_iso=sections["today_iso"],
    )


def _raw_preview(raw: str) -> str:
    return " ".join((raw or "").split())[:500]


def _set_run_status(payload: dict[str, Any]) -> None:
    _write_json(RUN_STATUS_PATH, {"updated_at": _utc_now_iso(), **payload})


def get_run_status() -> dict[str, Any]:
    return _read_json(RUN_STATUS_PATH, {"running": False, "agents": []})


def _agent_result(target: dict[str, Any]) -> dict[str, Any]:
    label = target["label"]
    agent_id = target["agent_id"]
    tracked_active = tracked_items.active_items_for_briefing(agent_id)
    tracked_ids = {str(item.get("id")) for item in tracked_active if item.get("id")}
    tracking_meta = {"tracked_items_count": len(tracked_active), "briefed_items_count": 0, "inferred_items_count": 0}
    if not target.get("agent"):
        classified = classify_briefing_error(error="Agent not found in live registry")
        return {"agent_id": agent_id, "label": label, "status": "error", "latency_ms": 0, "raw_response_preview": "", "parsed_items": [], "notes_for_david": None, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"], **tracking_meta}
    started = time.perf_counter()
    try:
        prompt_context = build_prompt_context(agent_id, tracked_active)
        prompt = build_briefing_prompt(agent_id, tracked_active)
        query_result = query_agent_with_timeout(target["agent"], prompt, 90)
        latency = int((time.perf_counter() - started) * 1000)
        if isinstance(query_result, dict):
            raw = str(query_result.get("response") or "")
            stdout = str(query_result.get("stdout") or "")
            stderr = str(query_result.get("stderr") or "")
            exit_code = query_result.get("exit_code")
        else:
            raw = str(query_result or "")
            stdout = ""
            stderr = ""
            exit_code = 0
        items, notes, outgoing_raw, parse_error = parse_agent_response(raw)
        sources = [str(item.get("source") or "agent_inference") for item in items]
        briefed_count = sum(1 for source in sources if source in tracked_ids)
        inferred_count = sum(1 for source in sources if source == "agent_inference" or source not in tracked_ids)
        tracking_meta = {"tracked_items_count": len(tracked_active), "briefed_items_count": briefed_count, "inferred_items_count": inferred_count}
        messaging_meta = {"outgoing_messages_raw": outgoing_raw, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "outgoing_messages_count": 0}
        if parse_error:
            classified = classify_briefing_error(error=parse_error, raw_response=raw, invalid_json=True)
            return {"agent_id": agent_id, "label": label, "status": "error", "latency_ms": latency, "prompt_context": prompt_context, "raw_response_preview": _raw_preview(raw), "parsed_items": [], "notes_for_david": notes, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"], "stdout": stdout, "stderr": stderr, "exit_code": exit_code, **tracking_meta, **messaging_meta}
        return {"agent_id": agent_id, "label": label, "status": "ok", "latency_ms": latency, "prompt_context": prompt_context, "raw_response_preview": _raw_preview(raw), "parsed_items": items, "notes_for_david": notes, "error": None, "error_class": None, "error_detail": None, "stdout": stdout, "stderr": stderr, "exit_code": exit_code, **tracking_meta, **messaging_meta}
    except AgentSubprocessError as exc:
        classified = classify_briefing_error(error=str(exc), error_detail=exc.stderr, exit_code=exc.exit_code, timed_out=exc.timed_out, timeout_seconds=exc.timeout_seconds)
        return {"agent_id": agent_id, "label": label, "status": "timeout" if exc.timed_out else "error", "latency_ms": int((time.perf_counter() - started) * 1000), "raw_response_preview": "", "parsed_items": [], "notes_for_david": None, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"], "stdout": exc.stdout, "stderr": exc.stderr, "exit_code": exc.exit_code, **tracking_meta}
    except TimeoutError:
        classified = classify_briefing_error(timed_out=True, timeout_seconds=90)
        return {"agent_id": agent_id, "label": label, "status": "timeout", "latency_ms": int((time.perf_counter() - started) * 1000), "raw_response_preview": "", "parsed_items": [], "notes_for_david": None, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"], **tracking_meta}
    except Exception as exc:
        classified = classify_briefing_error(error=str(exc))
        return {"agent_id": agent_id, "label": label, "status": "error", "latency_ms": int((time.perf_counter() - started) * 1000), "raw_response_preview": "", "parsed_items": [], "notes_for_david": None, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"], **tracking_meta}


def _result_message_identity(raw: Any) -> dict[str, Any]:
    return {
        "to_agent_id": raw.get("to_agent_id") if isinstance(raw, dict) else None,
        "subject": raw.get("subject") if isinstance(raw, dict) else None,
    }


def _audit_outgoing(briefing_id: str, from_agent_id: str, raw: Any, status: str, msg_id: str | None = None, reason: str | None = None) -> None:
    ident = _result_message_identity(raw)
    messages.append_audit_log({
        "briefing_id": briefing_id,
        "from_agent_id": from_agent_id,
        "to_agent_id": ident.get("to_agent_id"),
        "subject": ident.get("subject"),
        "status": status,
        "msg_id": msg_id,
        "reason": reason,
    })


def _reject_outgoing(result: dict[str, Any], briefing_id: str, raw: Any, reason: str) -> None:
    result.setdefault("outgoing_messages_rejected", []).append({**_result_message_identity(raw), "reason": reason})
    _audit_outgoing(briefing_id, str(result.get("agent_id") or ""), raw, "rejected", reason=reason)


def _tracked_ids_for_agent(agent_id: str) -> set[str]:
    return {str(item.get("id")) for item in tracked_items.load_items_for_agent(agent_id) if item.get("id")}


def _inbox_messages_for_reply(agent_id: str) -> dict[str, dict[str, Any]]:
    rows = messages.inbox(agent_id, status="sent,read", limit=200).get("messages") or []
    return {str(message.get("id")): message for message in rows if message.get("id")}


def _validate_outgoing_message(from_agent_id: str, raw: Any, registry_ids: set[str], tracked_ids: set[str], inbox_by_id: dict[str, dict[str, Any]]) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(raw, dict):
        return None, "outgoing message must be an object"
    to_agent_id = str(raw.get("to_agent_id") or "").strip()
    if not to_agent_id:
        return None, "to_agent_id missing"
    if to_agent_id not in registry_ids:
        return None, "to_agent_id not in registry"
    if to_agent_id == from_agent_id:
        return None, "self-send rejected"
    ok, detail = entities_service.messaging_policy_check(_migrated_state(), from_agent_id, to_agent_id)
    if not ok:
        return None, f"policy_blocked: {detail}"
    subject = str(raw.get("subject") or "").strip()
    if not subject:
        return None, "subject missing"
    if len(subject) > 200:
        return None, "subject over 200 chars"
    body = str(raw.get("body") or "").strip()
    if not body:
        return None, "body missing"
    priority = str(raw.get("priority") or "normal").strip().lower()
    if priority not in messages.VALID_PRIORITIES:
        return None, "priority invalid"
    related_entity = raw.get("related_entity")
    if related_entity == "":
        related_entity = None
    if related_entity not in messages.VALID_RELATED_ENTITIES:
        return None, "related_entity invalid"
    tracked_item_ids_raw = raw.get("tracked_item_ids") or []
    if not isinstance(tracked_item_ids_raw, list):
        return None, "tracked_item_ids must be an array"
    tracked_item_ids = [str(item) for item in tracked_item_ids_raw if str(item or "").strip()]
    if any(item_id not in tracked_ids for item_id in tracked_item_ids):
        return None, "tracked_item_ids must belong to this agent"
    in_reply_to = raw.get("in_reply_to") or None
    if in_reply_to:
        parent = inbox_by_id.get(str(in_reply_to))
        if not parent:
            return None, "in_reply_to not in inbox"
        supplied_thread_id = raw.get("thread_id")
        if supplied_thread_id and str(supplied_thread_id) != str(parent.get("thread_id")):
            return None, "thread mismatch"
    payload = {
        "from_agent_id": from_agent_id,
        "to_agent_id": to_agent_id,
        "subject": subject,
        "body": body,
        "priority": priority,
        "related_entity": related_entity,
        "references": {"tracked_item_ids": tracked_item_ids, "briefing_id": None},
        "in_reply_to": str(in_reply_to) if in_reply_to else None,
    }
    return payload, None


def process_outgoing_messages(results: list[dict[str, Any]], briefing_id: str) -> None:
    registry_ids = {str(agent.get("id")) for agent in _registry_agents() if agent.get("id")}
    for result in results:
        result.setdefault("outgoing_messages_sent", [])
        result.setdefault("outgoing_messages_rejected", [])
        result.setdefault("outgoing_messages_count", 0)
        raw_messages = result.pop("outgoing_messages_raw", None)
        from_agent_id = str(result.get("agent_id") or "")
        if raw_messages is None:
            continue
        if not isinstance(raw_messages, list):
            _reject_outgoing(result, briefing_id, {"to_agent_id": None, "subject": None}, "outgoing_messages must be an array")
            continue
        candidates = raw_messages[:3]
        for truncated in raw_messages[3:]:
            _reject_outgoing(result, briefing_id, truncated, "exceeded cap of 3, truncated")
        tracked_ids = _tracked_ids_for_agent(from_agent_id)
        inbox_by_id = _inbox_messages_for_reply(from_agent_id)
        for raw in candidates:
            payload, reason = _validate_outgoing_message(from_agent_id, raw, registry_ids, tracked_ids, inbox_by_id)
            if reason or not payload:
                _reject_outgoing(result, briefing_id, raw, reason or "invalid outgoing message")
                continue
            try:
                sent = messages.create_message(payload)
            except Exception as exc:
                _reject_outgoing(result, briefing_id, raw, str(exc))
                continue
            result["outgoing_messages_sent"].append({
                "msg_id": sent["id"],
                "to_agent_id": sent["to_agent_id"],
                "to_agent_label": registry_label_for_agent(str(sent["to_agent_id"]), str(sent["to_agent_id"])),
                "subject": sent["subject"],
                "priority": sent["priority"],
                "in_reply_to": sent.get("in_reply_to"),
            })
            result["outgoing_messages_count"] = len(result["outgoing_messages_sent"])
            _audit_outgoing(briefing_id, from_agent_id, raw, "sent", msg_id=sent["id"])


def _summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    by_agent = {item["label"]: len(item.get("parsed_items") or []) for item in results}
    all_items = [parsed for item in results for parsed in item.get("parsed_items") or []]
    return {
        "total_items": len(all_items),
        "high_priority_count": sum(1 for item in all_items if item.get("priority") == "high"),
        "outgoing_messages_total": sum(int(item.get("outgoing_messages_count") or 0) for item in results),
        "by_agent": by_agent,
    }


def render_markdown(briefing: dict[str, Any]) -> str:
    lines = [f"# Daily Briefing — {briefing['id']}", "", f"Generated: {briefing['generated_at']}", f"Triggered by: {briefing['triggered_by']}", "", f"Total items: {briefing['summary']['total_items']} · High priority: {briefing['summary']['high_priority_count']}", ""]
    for agent in briefing.get("agents", []):
        lines.extend([f"## {agent['label']} — {agent['status'].upper()} ({agent.get('latency_ms', 0)} ms)", ""])
        if agent.get("error"):
            lines.extend([f"Error: {agent['error']}", ""])
        items = agent.get("parsed_items") or []
        if not items:
            lines.extend(["No pressing items reported.", ""])
        for item in items:
            lines.extend([f"- **{item['title']}** — {item.get('due') or 'No date'} — `{item.get('priority', 'low')}`", f"  - {item.get('reason') or 'No reason provided.'}"])
        if agent.get("notes_for_david"):
            lines.extend(["", f"Notes for David: {agent['notes_for_david']}"])
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def prune_old_briefings(days: int = 90) -> None:
    cutoff = datetime.now() - timedelta(days=days)
    if not BRIEFINGS_DIR.exists():
        return
    for path in BRIEFINGS_DIR.glob("*.json"):
        try:
            date = datetime.strptime(path.stem, "%Y-%m-%d")
        except ValueError:
            continue
        if date < cutoff:
            path.unlink(missing_ok=True)
            path.with_suffix(".md").unlink(missing_ok=True)


def run_briefing_sweep(triggered_by: str = "manual") -> dict[str, Any]:
    if triggered_by not in {"manual", "scheduled"}:
        triggered_by = "manual"
    started = time.perf_counter()
    with _briefing_lock():
        if triggered_by == "scheduled":
            prune_old_briefings()
        cfg = load_config()
        targets = resolve_agent_targets(cfg.get("agents"))
        _set_run_status({"running": True, "triggered_by": triggered_by, "agents": [{"label": t["label"], "status": "pending"} for t in targets]})
        results: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=min(5, max(1, len(targets)))) as executor:
            future_map = {executor.submit(_agent_result, target): target for target in targets}
            for future in as_completed(future_map, timeout=480):
                try:
                    result = future.result(timeout=1)
                except Exception as exc:
                    target = future_map[future]
                    classified = classify_briefing_error(error=str(exc))
                    result = {"agent_id": target["agent_id"], "label": target["label"], "status": "error", "latency_ms": 0, "raw_response_preview": "", "parsed_items": [], "notes_for_david": None, "error": classified["error_class"], "error_class": classified["error_class"], "error_detail": classified["error_detail"]}
                results.append(result)
                _set_run_status({"running": True, "triggered_by": triggered_by, "agents": [{"label": t["label"], "status": next((r["status"] for r in results if r["label"] == t["label"]), "pending")} for t in targets]})
        order = {target["label"]: i for i, target in enumerate(targets)}
        results.sort(key=lambda item: order.get(item["label"], 99))
        matched_sources = {
            str(parsed.get("source"))
            for result in results
            for parsed in (result.get("parsed_items") or [])
            if parsed.get("source") and parsed.get("source") != "agent_inference"
        }
        generated_at = _utc_now_iso()
        tracked_items.mark_briefed(matched_sources, generated_at)
        briefing_id = _date_id()
        process_outgoing_messages(results, briefing_id)
        briefing = {"id": briefing_id, "generated_at": generated_at, "triggered_by": triggered_by, "duration_ms": int((time.perf_counter() - started) * 1000), "agents": results, "summary": _summary(results)}
        BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)
        _write_json(BRIEFINGS_DIR / f"{briefing['id']}.json", briefing)
        (BRIEFINGS_DIR / f"{briefing['id']}.md").write_text(render_markdown(briefing), encoding="utf-8")
        _set_run_status({"running": False, "last_briefing_id": briefing["id"], "agents": [{"label": r["label"], "status": r["status"]} for r in results]})
        return briefing


def list_briefings(limit: int = 30) -> list[dict[str, Any]]:
    BRIEFINGS_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(BRIEFINGS_DIR.glob("*.json"), key=lambda p: p.name, reverse=True)[:limit]:
        data = _read_json(path, None)
        if isinstance(data, dict):
            rows.append({"id": data.get("id") or path.stem, "generated_at": data.get("generated_at"), "summary": data.get("summary") or {}, "triggered_by": data.get("triggered_by")})
    return rows


def get_briefing(briefing_id: str) -> dict[str, Any]:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", briefing_id):
        raise FileNotFoundError(briefing_id)
    path = BRIEFINGS_DIR / f"{briefing_id}.json"
    data = _read_json(path, None)
    if not isinstance(data, dict):
        raise FileNotFoundError(briefing_id)
    return data


def delete_briefing(briefing_id: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", briefing_id):
        return False
    removed = False
    for suffix in (".json", ".md"):
        path = BRIEFINGS_DIR / f"{briefing_id}{suffix}"
        if path.exists():
            path.unlink()
            removed = True
    return removed


def _plist_payload(cfg: dict[str, Any]) -> dict[str, Any]:
    hour, minute = [int(part) for part in cfg["time_local"].split(":", 1)]
    day_map = {"sun": 1, "mon": 2, "tue": 3, "wed": 4, "thu": 5, "fri": 6, "sat": 7}
    intervals = [{"Hour": hour, "Minute": minute, "Weekday": day_map[day]} for day in cfg.get("days_of_week", DAYS)]
    python = _python_executable()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return {
        "Label": "com.hermes.briefing-sweep",
        "ProgramArguments": [python, "-m", "hermes_cli.briefings_runner"],
        "WorkingDirectory": str(PROJECT_ROOT),
        "EnvironmentVariables": {"HERMES_HOME": str(HERMES_HOME), "PYTHONPATH": str(PROJECT_ROOT)},
        "StartCalendarInterval": intervals,
        "StandardOutPath": str(LOG_DIR / "briefing-sweep.log"),
        "StandardErrorPath": str(LOG_DIR / "briefing-sweep.error.log"),
        "RunAtLoad": False,
    }


def configure_scheduler(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    if not cfg.get("enabled", True):
        try:
            subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(PLIST_PATH)], capture_output=True, text=True, timeout=5)
        except Exception:
            pass
        return {"mode": "disabled", "label": "com.hermes.briefing-sweep", "plist": str(PLIST_PATH)}
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with PLIST_PATH.open("wb") as handle:
        plistlib.dump(_plist_payload(cfg), handle)
    bootout = subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}", str(PLIST_PATH)], capture_output=True, text=True, timeout=5)
    bootstrap = subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(PLIST_PATH)], capture_output=True, text=True, timeout=8)
    if bootstrap.returncode == 0:
        return {"mode": "launchagent", "label": "com.hermes.briefing-sweep", "plist": str(PLIST_PATH), "message": "registered"}
    start_fallback_scheduler()
    return {"mode": "fallback", "label": "com.hermes.briefing-sweep", "plist": str(PLIST_PATH), "error": (bootstrap.stderr or bootout.stderr or "launchctl registration failed").strip()}


def active_schedule_mode() -> str:
    try:
        result = subprocess.run(["launchctl", "print", f"gui/{os.getuid()}/com.hermes.briefing-sweep"], capture_output=True, text=True, timeout=2)
        if result.returncode == 0:
            return "launchagent"
    except Exception:
        pass
    return "fallback" if _FALLBACK_THREAD and _FALLBACK_THREAD.is_alive() else "unregistered"


def start_fallback_scheduler() -> None:
    global _FALLBACK_THREAD
    if _FALLBACK_THREAD and _FALLBACK_THREAD.is_alive():
        return
    _FALLBACK_STOP.clear()

    def worker() -> None:
        last_key = ""
        while not _FALLBACK_STOP.wait(30):
            cfg = load_config()
            if not cfg.get("enabled", True):
                continue
            now = datetime.now()
            if DAYS[now.weekday()] not in cfg.get("days_of_week", DAYS):
                continue
            if now.strftime("%H:%M") != cfg.get("time_local"):
                continue
            key = now.strftime("%Y-%m-%d-%H-%M")
            if key == last_key:
                continue
            last_key = key
            try:
                run_briefing_sweep("scheduled")
            except Exception:
                pass

    _FALLBACK_THREAD = threading.Thread(target=worker, name="briefing-fallback-scheduler", daemon=True)
    _FALLBACK_THREAD.start()
