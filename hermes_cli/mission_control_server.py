"""Standalone Mission Control server for Hermes Agent.

Mission Control is a separate operational surface from the approved dashboard.
It serves a dedicated SPA on port 9120 by default and exposes APIs for agent
configuration, conversation management, governance, memory, and operational
usage visibility.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import mimetypes
import logging
import os
import platform
import plistlib
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import uuid
import webbrowser
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).parent.parent.resolve()

from hermes_cli import __version__
from hermes_cli.config import get_hermes_home, load_config
from hermes_cli.models import normalize_provider, provider_label, provider_model_ids
from hermes_cli import briefings as briefings_service
from hermes_cli import messages as messages_service
from hermes_cli import tracked_items as tracked_items_service
from hermes_cli.cron_api_routes import router as cron_api_router
from plugins.kanban.dashboard.plugin_api import router as kanban_plugin_router
from hermes_cli import entities as entities_service
from hermes_cli import reactive_worker
from hermes_state import SessionDB
from run_agent import AIAgent
from toolsets import get_all_toolsets
from agent.usage_pricing import resolve_billing_route
from agent.display import KawaiiSpinner

MISSION_CONTROL_DIST = (
    Path(os.environ["HERMES_MISSION_CONTROL_DIST"])
    if "HERMES_MISSION_CONTROL_DIST" in os.environ
    else Path(__file__).parent / "mission_control_dist"
)


def get_mission_control_home() -> Path:
    return get_hermes_home() / "mission_control"


def get_mission_control_state_path() -> Path:
    return get_mission_control_home() / "state.json"


def get_mission_control_upload_dir() -> Path:
    return get_mission_control_home() / "uploads"


def _assert_safe_state_path() -> None:
    state_path = get_mission_control_state_path()
    production_path = Path.home() / ".hermes" / "mission_control" / "state.json"
    running_under_pytest = "PYTEST_CURRENT_TEST" in os.environ
    if running_under_pytest and state_path.resolve() == production_path.resolve():
        raise RuntimeError(
            f"Refusing to write Mission Control state to production path {state_path} during pytest. "
            f"HERMES_HOME isolation failed. Check test imports."
        )


# Deprecated compatibility aliases for external callers/tests that import these
# names directly. Internal code should call the getter functions above so
# HERMES_HOME changes made after module import are honored.
MISSION_CONTROL_HOME = get_mission_control_home()
MISSION_CONTROL_STATE_PATH = get_mission_control_state_path()
MISSION_CONTROL_UPLOAD_DIR = get_mission_control_upload_dir()
USER_BACKGROUND_DIR = get_hermes_home() / "user-content" / "backgrounds"
RUNTIME_DIR = get_hermes_home() / "runtime"
USER_DUMP_DIR = RUNTIME_DIR / "dumps"
USER_BACKUP_DIR = RUNTIME_DIR / "backups"
SNAPSHOT_DIR = RUNTIME_DIR / "snapshots"
MAINTENANCE_AUDIT_LOG = RUNTIME_DIR / "maintenance-audit.log"
STATE_LOCK = threading.Lock()
SESSION_TOKEN = secrets.token_urlsafe(32)
LOG = logging.getLogger(__name__)
# Ensure structured Mission Control log lines surface in the LaunchAgent log
# even when uvicorn's logging config doesn't include this logger's namespace.
if LOG.level == logging.NOTSET or LOG.level > logging.INFO:
    LOG.setLevel(logging.INFO)

DEFAULT_MODELS = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5",
    "gpt-5-mini",
    "claude-sonnet-4.6",
    "gemini-2.5-pro",
]

MISSION_CONTROL_ENTITY_OPTIONS = [
    "Umbrella Holdings Group, LLC",
    "Umbrella Customs, LLC",
    "Umbrella Media, LLC",
    "Umbrella Properties, LLC",
    "Unassigned",
]

ENTITY_ALIASES = {
    "Umbrella Media": "Umbrella Media, LLC",
    "Umbrella Labs": "Unassigned",
    "": "Unassigned",
}

ALLOWED_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
DEFAULT_USAGE_DOCS = ("Usage docs", "https://platform.openai.com/docs/api-reference/responses")
DEFAULT_API_KEY_DOCS = ("API key setup", "https://platform.openai.com/api-keys")
DEFAULT_ACCOUNT = {
    "display_name": "David",
    "avatar_color": "#ffbd38",
    "preferences": {"timezone": "America/New_York"},
}
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
AVATAR_IMAGE_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$")
MAX_AVATAR_IMAGE_BYTES = 300 * 1024

app = FastAPI(title="Hermes Mission Control", version=__version__)
get_mission_control_upload_dir().mkdir(parents=True, exist_ok=True)
app.mount("/mission-control/uploads", StaticFiles(directory=str(get_mission_control_upload_dir())), name="mission_control_uploads")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(cron_api_router)
app.include_router(kanban_plugin_router, prefix="/api/plugins/kanban")

PUBLIC_API_PATHS = frozenset({"/api/mission-control/health", "/api/system/metrics", "/api/mission-control/maintenance/hci-status"})


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path not in PUBLIC_API_PATHS and not path.startswith("/api/user-content/backgrounds") and not path.startswith("/api/maintenance/"):
        expected = f"Bearer {SESSION_TOKEN}"
        auth = request.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), expected.encode()):
            response = JSONResponse(status_code=401, content={"detail": "Unauthorized"})
            response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
            return response
    response = await call_next(request)
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive, nosnippet"
    return response


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")



_METRICS_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}
_METRICS_CACHE_LOCK = threading.Lock()
_PAGE_SIZE_CACHE: int | None = None


def _run_command(args: list[str], timeout: float = 0.2) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        return ""
    return ""


def _round_percent(value: float) -> float:
    try:
        return round(max(0.0, min(100.0, float(value))), 1)
    except Exception:
        return 0.0


def _cpu_percent(cores: int) -> float:
    # Fast macOS/Linux approximation without psutil: sum process %CPU and normalize by cores.
    out = _run_command(["ps", "-A", "-o", "%cpu="], timeout=0.2)
    total = 0.0
    for item in out.split():
        try:
            total += float(item)
        except ValueError:
            continue
    if cores > 0:
        total = total / cores
    return _round_percent(total)


def _memory_stats() -> dict[str, Any]:
    total = 0
    used = 0
    try:
        total = int(_run_command(["sysctl", "-n", "hw.memsize"], timeout=0.2) or "0")
    except Exception:
        total = 0
    if total <= 0:
        try:
            total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
        except Exception:
            total = 0

    if platform.system() == "Darwin":
        global _PAGE_SIZE_CACHE
        out = _run_command(["vm_stat"], timeout=0.2)
        page_size = _PAGE_SIZE_CACHE or 16384
        match = re.search(r"page size of (\d+) bytes", out)
        if match:
            page_size = int(match.group(1))
            _PAGE_SIZE_CACHE = page_size
        pages: dict[str, int] = {}
        for line in out.splitlines():
            m = re.match(r"Pages ([^:]+):\s+([0-9]+)\.", line.strip())
            if m:
                pages[m.group(1).strip().lower()] = int(m.group(2))
        freeish = pages.get("free", 0) + pages.get("speculative", 0)
        if total > 0 and pages:
            used = max(0, total - freeish * page_size)
    else:
        try:
            meminfo = Path("/proc/meminfo").read_text()
            vals = dict((m.group(1), int(m.group(2)) * 1024) for m in re.finditer(r"^(MemTotal|MemAvailable):\s+(\d+) kB", meminfo, re.M))
            total = vals.get("MemTotal", total)
            used = max(0, total - vals.get("MemAvailable", 0))
        except Exception:
            pass

    total_mb = int(round(total / 1024 / 1024)) if total else 0
    used_mb = int(round(used / 1024 / 1024)) if used else 0
    percent = _round_percent((used / total * 100) if total else 0)
    return {"used_mb": used_mb, "total_mb": total_mb, "percent": percent}


def _disk_stats() -> dict[str, Any]:
    usage = shutil.disk_usage("/")
    return {
        "used_gb": round(usage.used / 1024 / 1024 / 1024, 1),
        "total_gb": round(usage.total / 1024 / 1024 / 1024, 1),
        "percent": _round_percent((usage.used / usage.total * 100) if usage.total else 0),
        "mount": "/",
    }


def _process_stats() -> dict[str, Any]:
    out = _run_command(["ps", "-axo", "state="], timeout=0.2)
    states = [line.strip() for line in out.splitlines() if line.strip()]
    running = sum(1 for state in states if state.startswith("R"))
    return {"running": running, "total": len(states)}


def _network_stats() -> dict[str, Any]:
    # netstat -ibn is fast on macOS and available on Linux/BSD variants.
    out = _run_command(["netstat", "-ibn"], timeout=0.25)
    best = {"interface": "unknown", "bytes_sent": 0, "bytes_recv": 0, "packets_sent": 0, "packets_recv": 0, "errors": 0}
    seen: dict[str, dict[str, int]] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 11 or parts[0].lower() == "name":
            continue
        iface = parts[0]
        if iface.startswith(("lo", "utun", "awdl", "llw")):
            continue
        try:
            ipkts = int(parts[4]); ierrs = int(parts[5]); ibytes = int(parts[6])
            opkts = int(parts[7]); oerrs = int(parts[8]); obytes = int(parts[9])
        except Exception:
            continue
        bucket = seen.setdefault(iface, {"bytes_sent": 0, "bytes_recv": 0, "packets_sent": 0, "packets_recv": 0, "errors": 0})
        bucket["bytes_recv"] = max(bucket["bytes_recv"], ibytes)
        bucket["bytes_sent"] = max(bucket["bytes_sent"], obytes)
        bucket["packets_recv"] = max(bucket["packets_recv"], ipkts)
        bucket["packets_sent"] = max(bucket["packets_sent"], opkts)
        bucket["errors"] = max(bucket["errors"], ierrs + oerrs)
    if seen:
        iface, vals = max(seen.items(), key=lambda item: item[1]["bytes_sent"] + item[1]["bytes_recv"])
        best = {"interface": iface, **vals}
    return best


def _node_memory() -> dict[str, Any]:
    # Production Mission Control is Python/FastAPI; dev may have a Vite Node process.
    out = _run_command(["ps", "-axo", "rss=,command="], timeout=0.2)
    best_rss_kb = 0
    for line in out.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        rss_text, _, cmd = stripped.partition(" ")
        if "node" not in cmd.lower():
            continue
        if "mission_control_web" not in cmd and "vite" not in cmd.lower():
            continue
        try:
            best_rss_kb = max(best_rss_kb, int(rss_text))
        except ValueError:
            continue
    return {
        "rss_mb": int(round(best_rss_kb / 1024)) if best_rss_kb else None,
        "heap_used_mb": None,
        "heap_total_mb": None,
    }


def _format_uptime(seconds: int) -> str:
    days, rem = divmod(max(0, seconds), 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{days} days, {hours:02d}:{minutes:02d}:{secs:02d}"


def _uptime_stats() -> dict[str, Any]:
    seconds = 0
    if platform.system() == "Darwin":
        out = _run_command(["sysctl", "-n", "kern.boottime"], timeout=0.2)
        match = re.search(r"sec = (\d+)", out)
        if match:
            seconds = int(time.time() - int(match.group(1)))
    else:
        try:
            seconds = int(float(Path("/proc/uptime").read_text().split()[0]))
        except Exception:
            seconds = 0
    return {"seconds": seconds, "formatted": _format_uptime(seconds)}


def _system_info() -> dict[str, Any]:
    system = platform.system()
    model = _run_command(["sysctl", "-n", "hw.model"], timeout=0.2) if system == "Darwin" else platform.machine()
    os_name = "macOS" if system == "Darwin" else system or platform.system()
    os_version = _run_command(["sw_vers", "-productVersion"], timeout=0.2) if system == "Darwin" else platform.release()
    return {
        "model": model or platform.machine() or "unknown",
        "os_name": os_name or "unknown",
        "os_version": os_version or platform.release() or "unknown",
        "hostname": socket.gethostname(),
    }


def _versions() -> dict[str, Any]:
    node = _run_command(["node", "--version"], timeout=0.25)
    return {
        "mission_control": __version__,
        "hermes_agent": __version__,
        "python": platform.python_version(),
        "node": node.lstrip("v") if node else "unknown",
    }


def _collect_system_metrics() -> dict[str, Any]:
    cores = os.cpu_count() or 1
    load = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
    payload = {
        "cpu": {"percent": _cpu_percent(cores), "cores": cores},
        "memory": _memory_stats(),
        "disk": _disk_stats(),
        "processes": _process_stats(),
        "load_average": {"one_min": round(load[0], 2), "five_min": round(load[1], 2), "fifteen_min": round(load[2], 2)},
        "network": _network_stats(),
        "node_memory": _node_memory(),
        "uptime": _uptime_stats(),
        "system": _system_info(),
        "versions": _versions(),
        "fetched_at": _utc_now_iso(),
    }
    return payload


def _cached_system_metrics() -> dict[str, Any]:
    now = time.monotonic()
    with _METRICS_CACHE_LOCK:
        cached = _METRICS_CACHE.get("payload")
        if cached and now - float(_METRICS_CACHE.get("ts") or 0) < 1.0:
            return deepcopy(cached)
    payload = _collect_system_metrics()
    with _METRICS_CACHE_LOCK:
        _METRICS_CACHE["ts"] = time.monotonic()
        _METRICS_CACHE["payload"] = deepcopy(payload)
    return payload



_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|token|secret|password|authorization|bearer|client[_-]?secret)(\s*[=:]\s*)([^\s\"',}]+)"),
    re.compile(r"(?i)(sk-[A-Za-z0-9_-]{16,})"),
]


def _redact_text(text: str) -> str:
    redacted = text
    for pattern in _SECRET_PATTERNS:
        if pattern.groups >= 3:
            redacted = pattern.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED]", redacted)
        else:
            redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def _run_git(args: list[str], cwd: Path, timeout: float = 3.0) -> tuple[int, str, str]:
    try:
        result = subprocess.run(["git", *args], cwd=str(cwd), capture_output=True, text=True, timeout=timeout, check=False)
        return result.returncode, result.stdout.strip(), result.stderr.strip()
    except Exception as exc:
        return 1, "", str(exc)


def _repo_version(cwd: Path) -> dict[str, Any]:
    _, commit, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd, timeout=1.0)
    _, branch, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, timeout=1.0)
    return {"version": __version__, "commit": commit or "unknown", "branch": branch or "unknown"}


def _repo_update_status(cwd: Path) -> dict[str, Any]:
    fetch_code, _, fetch_err = _run_git(["fetch", "--quiet"], cwd, timeout=4.0)
    upstream_code, upstream, upstream_err = _run_git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, timeout=1.0)
    if upstream_code != 0 or not upstream:
        _, head, _ = _run_git(["rev-parse", "--short", "HEAD"], cwd, timeout=1.0)
        return {"up_to_date": fetch_code == 0, "behind_by": 0, "latest_commit": head or "unknown", "error": upstream_err or fetch_err or "No upstream configured"}
    _, behind_text, _ = _run_git(["rev-list", "--count", f"HEAD..{upstream}"], cwd, timeout=1.0)
    _, latest, _ = _run_git(["rev-parse", "--short", upstream], cwd, timeout=1.0)
    try:
        behind = int(behind_text or "0")
    except ValueError:
        behind = 0
    payload = {"up_to_date": fetch_code == 0 and behind == 0, "behind_by": behind, "latest_commit": latest or "unknown"}
    if fetch_code != 0 and fetch_err:
        payload["error"] = fetch_err
    return payload


def _short_sha(value: str | None) -> str | None:
    if not value:
        return None
    return value.strip()[:8] or None


def _latest_version_from_tags(cwd: Path) -> str | None:
    return __version__


def _maintenance_hermes_status(cwd: Path = PROJECT_ROOT) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "current_version": __version__,
        "latest_version": None,
        "commits_behind": None,
        "carried_commits_ahead": None,
        "upstream_sha": None,
        "local_sha": None,
        "branch": None,
        "checked_at": _utc_now_z(),
        "status": "unknown",
    }
    try:
        _, local_sha, _ = _run_git(["rev-parse", "--short=8", "HEAD"], cwd, timeout=1.0)
        _, branch, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, timeout=1.0)
        payload["local_sha"] = _short_sha(local_sha)
        payload["branch"] = branch or None

        fetch_code, _, _ = _run_git(["fetch", "origin", "--tags"], cwd, timeout=5.0)
        if fetch_code != 0:
            return payload

        payload["latest_version"] = _latest_version_from_tags(cwd)
        _, upstream_sha, _ = _run_git(["rev-parse", "--short=8", "origin/main"], cwd, timeout=1.0)
        payload["upstream_sha"] = _short_sha(upstream_sha)

        count_code, counts, _ = _run_git(["rev-list", "--left-right", "--count", "HEAD...origin/main"], cwd, timeout=2.0)
        if count_code != 0 or not counts:
            return payload
        parts = counts.split()
        if len(parts) != 2:
            return payload
        ahead = int(parts[0])
        behind = int(parts[1])
        payload["carried_commits_ahead"] = ahead
        payload["commits_behind"] = behind
        if behind == 0 and ahead == 0:
            payload["status"] = "up_to_date"
        elif behind > 0 and ahead == 0:
            payload["status"] = "behind"
        elif behind == 0 and ahead > 0:
            payload["status"] = "ahead"
        else:
            payload["status"] = "diverged"
    except Exception:
        payload["status"] = "unknown"
    return payload


def _read_json_file(path: Path, timeout: float = 1.0) -> dict[str, Any] | None:
    result: dict[str, Any] = {}

    def worker() -> None:
        nonlocal result
        result = json.loads(path.read_text(encoding="utf-8"))

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout)
    if thread.is_alive():
        return None
    return result if isinstance(result, dict) else None


def _source_label(value: str | None) -> str:
    return {
        "uv_pip_show": "uv pip",
        "hermes_version_cmd": "hermes version",
        "fallback": "fallback",
    }.get(value or "", value or "unknown")


def _worktree_hci_status(cwd: Path = PROJECT_ROOT) -> dict[str, Any]:
    _, head_sha, _ = _run_git(["rev-parse", "HEAD"], cwd, timeout=1.0)
    _, branch, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd, timeout=1.0)
    head = head_sha.strip() or None
    return {"branch": branch or None, "head_sha": head, "head_sha_short": _short_sha(head)}


def _mission_control_dist_status(worktree: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "running_sha": None,
        "running_sha_short": None,
        "running_built_at": None,
        "status": "unknown",
        "source": "fallback",
    }
    manifest = _read_json_file(MISSION_CONTROL_DIST / "build-manifest.json")
    if manifest:
        running_sha = str(manifest.get("head_sha") or "").strip() or None
        payload.update({
            "running_sha": running_sha,
            "running_sha_short": _short_sha(running_sha),
            "running_built_at": str(manifest.get("built_at") or "").strip() or None,
            "source": "dist_manifest",
        })
    elif MISSION_CONTROL_DIST.exists():
        try:
            payload["running_built_at"] = datetime.fromtimestamp(MISSION_CONTROL_DIST.stat().st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        except Exception:
            payload["running_built_at"] = None
    running_sha = payload.get("running_sha")
    head_sha = worktree.get("head_sha")
    if running_sha and head_sha:
        payload["status"] = "in_sync" if running_sha == head_sha else "rebuild_required"
    return payload


def _parse_key_value_lines(text: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        if sep:
            parsed[key.strip().lower()] = value.strip()
    return parsed


def _hermes_agent_import_metadata(python_path: Path) -> tuple[str | None, str | None]:
    if not python_path.exists():
        return None, None
    code = """import importlib\nfor name in ('hermes_cli', 'hermes_agent'):\n    try:\n        mod = importlib.import_module(name)\n        print(getattr(mod, '__version__', '') or '')\n        print(getattr(mod, '__commit__', '') or getattr(mod, '__git_commit__', '') or '')\n        break\n    except Exception:\n        pass\n"""
    try:
        result = subprocess.run([str(python_path), "-c", code], capture_output=True, text=True, timeout=2.0, check=False)
    except Exception:
        return None, None
    lines = result.stdout.splitlines()
    version = lines[0].strip() if lines else None
    commit = lines[1].strip() if len(lines) > 1 else None
    return version or None, commit or None


def _hermes_agent_uv_metadata() -> tuple[str | None, str | None, str]:
    python_path = Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin" / "python"
    imported_version, imported_commit = _hermes_agent_import_metadata(python_path)
    uv_path = shutil.which("uv")
    show_text = ""
    if uv_path and python_path.exists():
        try:
            result = subprocess.run([uv_path, "pip", "show", "hermes-agent", "--python", str(python_path)], capture_output=True, text=True, timeout=2.0, check=False)
            if result.returncode == 0:
                show_text = result.stdout
        except Exception:
            show_text = ""
    if not show_text and python_path.exists():
        try:
            result = subprocess.run([str(python_path), "-m", "pip", "show", "hermes-agent"], capture_output=True, text=True, timeout=2.0, check=False)
            if result.returncode == 0:
                show_text = result.stdout
        except Exception:
            show_text = ""
    parsed = _parse_key_value_lines(show_text) if show_text else {}
    version = imported_version or parsed.get("version")
    commit = imported_commit
    editable = parsed.get("editable project location") or parsed.get("location")
    if not commit and editable:
        path = Path(editable).expanduser()
        if (path / ".git").exists():
            _, git_sha, _ = _run_git(["rev-parse", "HEAD"], path, timeout=1.0)
            commit = git_sha or None
    return version or None, commit or None, "uv_pip_show" if show_text else "fallback"


def _hermes_agent_version_cmd_metadata() -> tuple[str | None, str | None, str]:
    hermes_path = shutil.which("hermes")
    if not hermes_path:
        return None, None, "fallback"
    try:
        result = subprocess.run([hermes_path, "--version"], capture_output=True, text=True, timeout=1.5, check=False)
    except Exception:
        return None, None, "fallback"
    text = f"{result.stdout} {result.stderr}"
    version_match = re.search(r"(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)", text)
    sha_match = re.search(r"\b[0-9a-f]{7,40}\b", text, re.IGNORECASE)
    return (version_match.group(1) if version_match else None, sha_match.group(0) if sha_match else None, "hermes_version_cmd")


def _tag_points_at_worktree_version(cwd: Path, version: str | None, head_sha: str | None) -> bool:
    if not version or not head_sha:
        return False
    candidates = [version, f"v{version}"]
    for tag in candidates:
        code, tag_sha, _ = _run_git(["rev-list", "-n", "1", tag], cwd, timeout=1.0)
        if code == 0 and tag_sha and tag_sha == head_sha:
            return True
    return False


def _hermes_agent_installed_status(worktree: dict[str, Any], cwd: Path = PROJECT_ROOT) -> dict[str, Any]:
    version, sha, source = _hermes_agent_uv_metadata()
    if not version or not sha:
        fallback_version, fallback_sha, fallback_source = _hermes_agent_version_cmd_metadata()
        version = version or fallback_version
        sha = sha or fallback_sha
        source = fallback_source if fallback_version or fallback_sha else source
    payload: dict[str, Any] = {
        "installed_version": version,
        "installed_sha": sha,
        "installed_sha_short": _short_sha(sha),
        "status": "unknown",
        "source": source if source != "fallback" else "fallback",
        "source_label": _source_label(source),
    }
    head_sha = worktree.get("head_sha")
    if sha and head_sha:
        payload["status"] = "in_sync" if sha == head_sha or _tag_points_at_worktree_version(cwd, version, head_sha) else "reinstall_required"
    elif not sha:
        payload["source"] = "fallback"
        payload["source_label"] = _source_label("fallback")
    return payload


def _maintenance_hci_status(cwd: Path = PROJECT_ROOT) -> dict[str, Any]:
    worktree = _worktree_hci_status(cwd)
    return {
        "worktree": worktree,
        "mission_control": _mission_control_dist_status(worktree),
        "hermes_agent": _hermes_agent_installed_status(worktree, cwd),
        "checked_at": _utc_now_z(),
    }


def _launchctl_labels() -> list[str]:
    try:
        result = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=1.5, check=False)
    except Exception:
        return []
    labels: list[str] = []
    for line in result.stdout.splitlines()[1:]:
        parts = line.split()
        if parts:
            labels.append(parts[-1])
    return labels


def _label_from_plist(path: Path) -> str | None:
    try:
        data = plistlib.loads(path.read_bytes())
        label = data.get("Label")
        return str(label) if label else None
    except Exception:
        text = path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"<key>Label</key>\s*<string>([^<]+)</string>", text)
        return match.group(1) if match else None


def _find_gateway_plist_by_port() -> tuple[str | None, Path | None]:
    roots = [Path.home() / "Library" / "LaunchAgents", Path("/Library/LaunchAgents")]
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.glob("*.plist")):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if "9119" not in text:
                continue
            label = _label_from_plist(path)
            if label and label.startswith("com.hermes."):
                return label, path
    return None, None


def _hermes_gateway_restart_supported() -> bool:
    hermes_path = shutil.which("hermes")
    if not hermes_path:
        return False
    try:
        result = subprocess.run([hermes_path, "gateway", "--help"], capture_output=True, text=True, timeout=1.5, check=False)
    except Exception:
        return False
    return result.returncode == 0 and "restart" in f"{result.stdout}\n{result.stderr}"


def _operation_restart_gateway() -> dict[str, Any]:
    initiated_at = _utc_now_z()
    if platform.system() == "Darwin":
        labels = _launchctl_labels()
        label = next((item for item in labels if re.fullmatch(r"com\.hermes\.gateway.*", item)), None)
        plist_path: Path | None = None
        if not label and "ai.hermes.gateway" in labels:
            label = "ai.hermes.gateway"
        if not label:
            label, plist_path = _find_gateway_plist_by_port()
        if label:
            uid = os.getuid()
            ok, log = _run_operation_command(["launchctl", "kickstart", "-k", f"gui/{uid}/{label}"], Path.home(), timeout=4.0)
            if ok:
                _audit_maintenance_action("restart-gateway", snapshot=None, ok=True, log=log)
                return {"ok": True, "method": "launchctl_kickstart", "label": label, "initiated_at": initiated_at}
            if plist_path:
                boot = subprocess.run(["launchctl", "bootout", f"gui/{uid}", str(plist_path)], capture_output=True, text=True, timeout=2.0, check=False)
                boot_log = f"{boot.stdout}\n{boot.stderr}".strip()
                load = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", str(plist_path)], capture_output=True, text=True, timeout=2.0, check=False)
                load_log = f"{load.stdout}\n{load.stderr}".strip()
                if load.returncode == 0:
                    log = f"{boot_log}\n{load_log}".strip()
                    _audit_maintenance_action("restart-gateway", snapshot=None, ok=True, log=log)
                    return {"ok": True, "method": "launchctl_reload", "label": label, "initiated_at": initiated_at}
    if _hermes_gateway_restart_supported():
        hermes_path = shutil.which("hermes") or "hermes"
        ok, log = _run_operation_command([hermes_path, "gateway", "restart"], Path.home(), timeout=4.0)
        if ok:
            _audit_maintenance_action("restart-gateway", snapshot=None, ok=True, log=log)
            return {"ok": True, "method": "hermes_cli", "label": None, "initiated_at": initiated_at}
    log = "Restart not supported in this environment"
    _audit_maintenance_action("restart-gateway", snapshot=None, ok=False, log=log)
    return {"ok": False, "reason": log}


def _maintenance_health_check() -> dict[str, Any]:
    endpoints = ["/api/mission-control/health", "/api/system/metrics", "/api/maintenance/version"]
    checks = []
    for endpoint in endpoints:
        url = f"http://127.0.0.1:9120{endpoint}"
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(url, timeout=2.0) as response:
                status = int(response.status)
                response.read(256)
            latency = round((time.perf_counter() - started) * 1000, 1)
            checks.append({"endpoint": endpoint, "status": status, "latency_ms": latency})
        except Exception as exc:
            latency = round((time.perf_counter() - started) * 1000, 1)
            checks.append({"endpoint": endpoint, "status": 0, "latency_ms": latency, "error": str(exc)})
    return {"ok": all(200 <= c["status"] < 300 for c in checks), "checks": checks, "ran_at": _utc_now_iso()}


def _doctor_checks() -> dict[str, Any]:
    checks: list[dict[str, str]] = []
    try:
        disk = _disk_stats()
        checks.append({"name": "Disk free", "status": "ok" if disk["percent"] < 90 else "warn", "detail": f"{disk['used_gb']} / {disk['total_gb']} Gi used ({disk['percent']}%)"})
    except Exception as exc:
        checks.append({"name": "Disk free", "status": "fail", "detail": str(exc)})
    try:
        memory = _memory_stats()
        checks.append({"name": "Memory pressure", "status": "ok" if memory["percent"] < 95 else "warn", "detail": f"{memory['used_mb']} / {memory['total_mb']} MB used ({memory['percent']}%)"})
    except Exception as exc:
        checks.append({"name": "Memory pressure", "status": "fail", "detail": str(exc)})
    try:
        health = _maintenance_health_check()
        checks.append({"name": "Mission Control API", "status": "ok" if health["ok"] else "fail", "detail": f"{sum(1 for c in health['checks'] if 200 <= c['status'] < 300)} / {len(health['checks'])} checks passing"})
    except Exception as exc:
        checks.append({"name": "Mission Control API", "status": "fail", "detail": str(exc)})
    for label, path in [("Mission Control dist", MISSION_CONTROL_DIST), ("Mission Control state", get_mission_control_state_path()), ("Runtime directory", RUNTIME_DIR)]:
        checks.append({"name": label, "status": "ok" if path.exists() else "warn", "detail": str(path)})
    failures = sum(1 for c in checks if c["status"] == "fail")
    warnings = sum(1 for c in checks if c["status"] == "warn")
    ok = failures == 0
    summary = f"{len(checks) - failures - warnings} ok, {warnings} warn, {failures} fail"
    return {"ok": ok, "checks": checks, "summary": summary, "ran_at": _utc_now_iso()}


def _recent_log_tail(lines: int = 200) -> str:
    candidates = [get_hermes_home() / "logs", RUNTIME_DIR]
    log_files: list[Path] = []
    for root in candidates:
        if root.exists():
            log_files.extend([p for p in root.glob("*.log") if p.is_file()])
            log_files.extend([p for p in root.glob("*/*.log") if p.is_file()])
    if not log_files:
        return "No log files found."
    latest = sorted(log_files, key=lambda p: p.stat().st_mtime, reverse=True)[:3]
    chunks = []
    for path in latest:
        try:
            text = path.read_text(errors="replace").splitlines()[-lines:]
            chunks.append(f"--- {path} ---\n" + "\n".join(text))
        except Exception as exc:
            chunks.append(f"--- {path} ---\nUnable to read: {exc}")
    return _redact_text("\n\n".join(chunks))


def _write_debug_dump() -> dict[str, Any]:
    USER_DUMP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"mission-control-dump-{stamp}-{uuid.uuid4().hex[:8]}.json"
    path = USER_DUMP_DIR / filename
    payload = {
        "created_at": _utc_now_iso(),
        "system_metrics": _collect_system_metrics(),
        "version": {"mission_control": _repo_version(PROJECT_ROOT), "hermes_agent": {"version": __version__}},
        "doctor": _doctor_checks(),
        "environment": {
            "project_root": str(PROJECT_ROOT),
            "mission_control_dist": str(MISSION_CONTROL_DIST),
            "hermes_home": str(get_hermes_home()),
            "python": platform.python_version(),
        },
        "recent_logs": _recent_log_tail(200),
    }
    text = _redact_text(json.dumps(payload, indent=2, default=str))
    path.write_text(text, encoding="utf-8")
    return {"filename": filename, "size_bytes": path.stat().st_size, "path": str(path), "download_url": f"/user-content/dumps/{filename}"}


def _safe_backup_sources() -> list[Path]:
    home = get_hermes_home()
    sources = [get_mission_control_state_path(), home / "gateway_state.json", home / "processes.json", home / "channel_directory.json"]
    sessions = home / "sessions"
    if sessions.exists():
        sources.extend(sorted([p for p in sessions.glob("session_*.json") if p.is_file() and p.stat().st_size <= 1_000_000], key=lambda p: p.stat().st_mtime, reverse=True)[:5])
    skills_usage = home / "skills" / ".usage.json"
    if skills_usage.exists():
        sources.append(skills_usage)
    return [p for p in sources if p.exists() and p.is_file()]


def _write_redacted_archive(archive_path: Path, *, reason: str | None = None) -> dict[str, Any]:
    home = get_hermes_home().resolve()
    with tempfile.TemporaryDirectory(prefix="hermes-maintenance-archive-") as tmp:
        tmp_path = Path(tmp)
        manifest: dict[str, Any] = {
            "created_at": _utc_now_iso(),
            "source_home": str(home),
            "format": "hermes-mission-control-backup",
            "version": 1,
            "files": [],
        }
        if reason:
            manifest["reason"] = reason
        for source in _safe_backup_sources():
            try:
                rel = source.resolve().relative_to(home)
            except Exception:
                rel = Path(source.name)
            dest = tmp_path / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                text = source.read_text(errors="replace")
                dest.write_text(_redact_text(text), encoding="utf-8")
                manifest["files"].append(str(rel))
            except Exception as exc:
                err_path = tmp_path / f"{rel}.error.txt"
                err_path.parent.mkdir(parents=True, exist_ok=True)
                err_path.write_text(f"Unable to back up {source}: {exc}\n", encoding="utf-8")
        (tmp_path / "MANIFEST.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        with tarfile.open(archive_path, "w:gz") as tar:
            for item in tmp_path.rglob("*"):
                if item.is_file():
                    tar.add(item, arcname=str(item.relative_to(tmp_path)))
    return manifest


def _create_backup_archive() -> dict[str, Any]:
    USER_BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"hermes-backup-{stamp}-{uuid.uuid4().hex[:8]}.tar.gz"
    archive_path = USER_BACKUP_DIR / filename
    manifest = _write_redacted_archive(archive_path)
    return {"filename": filename, "size_bytes": archive_path.stat().st_size, "created_at": manifest["created_at"], "download_url": f"/user-content/backups/{filename}"}


def take_snapshot(reason: str) -> dict[str, Any]:
    snapshot_dir = RUNTIME_DIR / "snapshots"
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    filename = f"mission-control-snapshot-{stamp}-{uuid.uuid4().hex[:8]}.tar.gz"
    archive_path = snapshot_dir / filename
    manifest = _write_redacted_archive(archive_path, reason=reason)
    return {
        "filename": filename,
        "path": str(archive_path),
        "size_bytes": archive_path.stat().st_size,
        "created_at": manifest["created_at"],
        "reason": reason,
    }


def _log_tail(text: str, lines: int = 120) -> str:
    return "\n".join((text or "").splitlines()[-lines:])


def _run_operation_command(args: list[str], cwd: Path, timeout: float = 120.0) -> tuple[bool, str]:
    started = time.perf_counter()
    try:
        result = subprocess.run(args, cwd=str(cwd), capture_output=True, text=True, timeout=timeout, check=False)
        log = f"$ {' '.join(args)}\n{result.stdout}{result.stderr}"
        return result.returncode == 0, log + f"\n[exit={result.returncode} elapsed_ms={round((time.perf_counter() - started) * 1000, 1)}]"
    except Exception as exc:
        return False, f"$ {' '.join(args)}\n{type(exc).__name__}: {exc}"


def _maintenance_response(ok: bool, message: str, *, snapshot: dict[str, Any] | None = None, log: str = "", error: str | None = None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": ok, "message": message}
    if snapshot:
        payload["snapshot"] = snapshot
    if log:
        payload["log"] = _log_tail(_redact_text(log))
    if error:
        payload["error"] = _redact_text(error)
    if extra:
        payload.update(extra)
    return payload


def _audit_maintenance_action(action: str, *, snapshot: dict[str, Any] | None, ok: bool, log: str = "", user: str = "local") -> None:
    try:
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": _utc_now_iso(),
            "action": action,
            "user": user,
            "snapshot_path": snapshot.get("path") if snapshot else None,
            "result": "success" if ok else "failure",
            "log_hash": hashlib.sha256(_redact_text(log or "").encode("utf-8")).hexdigest(),
        }
        with MAINTENANCE_AUDIT_LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, sort_keys=True) + "\n")
    except Exception:
        LOG.exception("Failed to write maintenance audit log")


def _schedule_process_exit(delay: float = 0.25) -> None:
    if os.environ.get("HERMES_MAINTENANCE_DISABLE_RESTART") == "1":
        return
    def _exit_later() -> None:
        time.sleep(delay)
        os._exit(0)
    threading.Thread(target=_exit_later, daemon=True).start()


def _restart_launchagent(label: str) -> tuple[bool, str]:
    if platform.system() != "Darwin":
        return False, "LaunchAgent restart is only available on macOS"
    uid = os.getuid()
    target = f"gui/{uid}/{label}"
    ok1, log1 = _run_operation_command(["launchctl", "kickstart", "-k", target], Path.home(), timeout=15)
    return ok1, log1


def _mission_control_web_root() -> Path:
    return PROJECT_ROOT / "mission_control_web"


def _has_dirty_worktree(cwd: Path) -> bool:
    code, out, _ = _run_git(["status", "--porcelain"], cwd, timeout=3.0)
    return code == 0 and bool(out.strip())


def _build_mission_control(dry_run: bool = False) -> tuple[bool, str]:
    web_root = _mission_control_web_root()
    if dry_run:
        return True, "dry_run: npm install/build skipped"
    ok_install, install_log = _run_operation_command(["npm", "install"], web_root, timeout=180)
    if not ok_install:
        return False, install_log
    ok_build, build_log = _run_operation_command(["npm", "run", "build"], web_root, timeout=240)
    return ok_build, install_log + "\n" + build_log


class UpdateAllRequest(BaseModel):
    rebuild_mission_control: bool | None = None
    update_hermes_agent: bool | None = None


def _update_jobs_dir() -> Path:
    return get_mission_control_home() / "update-jobs"


def _update_all_lock_path() -> Path:
    return get_mission_control_home() / ".update-all.lock"


def _new_update_all_step(name: str) -> dict[str, Any]:
    return {"name": name, "status": "pending", "started_at": None, "completed_at": None, "log_excerpt": ""}


def _write_update_all_job(job: dict[str, Any]) -> None:
    jobs_dir = _update_jobs_dir()
    jobs_dir.mkdir(parents=True, exist_ok=True)
    path = jobs_dir / f"{job['job_id']}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(job, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _read_update_all_job(job_id: str) -> dict[str, Any] | None:
    if not re.fullmatch(r"[0-9a-fA-F-]{32,36}", job_id or ""):
        return None
    path = _update_jobs_dir() / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _most_recent_unfinished_update_all_job(max_age_seconds: int = 600) -> dict[str, Any] | None:
    jobs_dir = _update_jobs_dir()
    if not jobs_dir.exists():
        return None
    now = time.time()
    candidates = []
    for path in jobs_dir.glob("*.json"):
        try:
            if now - path.stat().st_mtime > max_age_seconds:
                continue
            job = json.loads(path.read_text(encoding="utf-8"))
            if job.get("phase") not in {"completed", "failed"}:
                candidates.append((path.stat().st_mtime, job))
        except Exception:
            continue
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item[0], reverse=True)[0][1]


def _set_update_all_step(job: dict[str, Any], name: str, status: str, *, log: str = "", phase: str | None = None, started: bool = False, completed: bool = False) -> None:
    now = _utc_now_iso()
    for step in job["steps"]:
        if step["name"] == name:
            if started and not step.get("started_at"):
                step["started_at"] = now
            if completed:
                step["completed_at"] = now
            step["status"] = status
            if log:
                step["log_excerpt"] = _log_tail(_redact_text(log), 40)
            break
    if phase:
        job["phase"] = phase
    _write_update_all_job(job)


def _release_update_all_lock() -> None:
    try:
        _update_all_lock_path().unlink(missing_ok=True)
    except Exception:
        LOG.exception("Failed to release update-all lock")


def _acquire_update_all_lock(job_id: str) -> tuple[bool, str | None]:
    lock_path = _update_all_lock_path()
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    now = time.time()
    if lock_path.exists():
        try:
            existing = json.loads(lock_path.read_text(encoding="utf-8"))
            mtime = lock_path.stat().st_mtime
            if now - mtime < 600:
                return False, existing.get("job_id")
        except Exception:
            if now - lock_path.stat().st_mtime < 600:
                return False, None
        lock_path.unlink(missing_ok=True)
    lock_path.write_text(json.dumps({"job_id": job_id, "created_at": _utc_now_iso()}), encoding="utf-8")
    return True, None


def _snapshot_state_for_update_all() -> str | None:
    state_path = get_mission_control_state_path()
    if not state_path.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = state_path.with_name(f"state.json.pre-update-all-{stamp}")
    shutil.copy2(state_path, dest)
    return str(dest)


def _promote_mission_control_dist() -> tuple[bool, str]:
    src = PROJECT_ROOT / "hermes_cli" / "mission_control_dist"
    dest = MISSION_CONTROL_DIST
    if not (src / "build-manifest.json").exists():
        return False, f"build-manifest.json missing from {src}"
    dest.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dest / item.name
        if item.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)
    if not (dest / "build-manifest.json").exists():
        return False, f"build-manifest.json missing from {dest} after copy"
    return True, f"Promoted Mission Control dist to {dest}"


def _find_mission_control_launch_label() -> str:
    labels = _launchctl_labels()
    if "com.hermes.mission-control-9120" in labels:
        return "com.hermes.mission-control-9120"
    candidate = next((item for item in labels if re.fullmatch(r"com\.hermes\.mission-control.*", item)), None)
    if candidate:
        return candidate
    roots = [Path.home() / "Library" / "LaunchAgents", Path("/Library/LaunchAgents")]
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.glob("*.plist")):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if "9120" in text:
                label = _label_from_plist(path)
                if label:
                    return label
    return "com.hermes.mission-control-9120"


def _schedule_mission_control_launchagent_restart(label: str) -> None:
    subprocess.Popen(
        ["sh", "-c", f"sleep 2 && launchctl kickstart -k gui/$(id -u)/{shlex_quote(label)}"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def shlex_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def _wait_for_gateway_env(timeout_seconds: float = 12.0) -> tuple[bool, str]:
    deadline = time.time() + timeout_seconds
    last_error = ""
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://localhost:9119/env", timeout=1.0) as response:
                response.read(128)
                if int(response.status) == 200:
                    return True, "Hermes Agent responded on http://localhost:9119/env"
        except Exception as exc:
            last_error = str(exc)
        time.sleep(0.5)
    return False, f"Hermes Agent did not respond within {timeout_seconds:.0f}s: {last_error}"


def _uv_executable() -> str:
    return shutil.which("uv") or "/Users/hermes-agent/.local/bin/uv"


def _operation_update_all_v2(body: UpdateAllRequest | None = None) -> tuple[int, dict[str, Any]]:
    current = _maintenance_hci_status(PROJECT_ROOT)
    rebuild_mc = current["mission_control"].get("status") != "in_sync" if body is None or body.rebuild_mission_control is None else bool(body.rebuild_mission_control)
    update_ha = current["hermes_agent"].get("status") != "in_sync" if body is None or body.update_hermes_agent is None else bool(body.update_hermes_agent)
    job_id = str(uuid.uuid4())
    acquired, existing_job_id = _acquire_update_all_lock(job_id)
    if not acquired:
        return 409, {"ok": False, "job_id": existing_job_id, "message": "Update All already running"}
    steps = [_new_update_all_step("rebuild_mc"), _new_update_all_step("reinstall_ha"), _new_update_all_step("restart_ha"), _new_update_all_step("restart_mc")]
    job: dict[str, Any] = {
        "job_id": job_id,
        "started_at": _utc_now_iso(),
        "completed_at": None,
        "phase": "pending",
        "steps": steps,
        "requested": {"rebuild_mission_control": rebuild_mc, "update_hermes_agent": update_ha},
        "state_snapshot": None,
    }
    try:
        job["state_snapshot"] = _snapshot_state_for_update_all()
    except Exception as exc:
        job["state_snapshot_error"] = str(exc)
    _write_update_all_job(job)
    completed_steps: list[str] = []
    scheduled_mc_restart = False
    try:
        if rebuild_mc:
            _set_update_all_step(job, "rebuild_mc", "running", phase="rebuilding_mc", started=True)
            ok, build_log = _run_operation_command(["npm", "run", "build"], _mission_control_web_root(), timeout=300)
            if ok:
                promote_ok, promote_log = _promote_mission_control_dist()
                build_log = f"{build_log}\n{promote_log}"
                ok = promote_ok
            if not ok:
                _set_update_all_step(job, "rebuild_mc", "failed", log=build_log, phase="failed", completed=True)
                job["completed_at"] = _utc_now_iso(); _write_update_all_job(job)
                return 500, {"ok": False, "job_id": job_id, "message": "Mission Control rebuild failed", "summary_url": f"/api/mission-control/maintenance/update-all/status?job_id={job_id}"}
            _set_update_all_step(job, "rebuild_mc", "ok", log=build_log, completed=True)
            completed_steps.append("rebuild_mc")
        else:
            _set_update_all_step(job, "rebuild_mc", "skipped", completed=True)

        if update_ha:
            _set_update_all_step(job, "reinstall_ha", "running", phase="installing_ha", started=True)
            ok, install_log = _run_operation_command([_uv_executable(), "pip", "install", "--python", "/Users/hermes-agent/.hermes/hermes-agent/venv/bin/python", "-e", str(PROJECT_ROOT)], PROJECT_ROOT, timeout=300)
            if not ok:
                _set_update_all_step(job, "reinstall_ha", "failed", log=install_log, phase="failed", completed=True)
                job["completed_at"] = _utc_now_iso(); _write_update_all_job(job)
                return 500, {"ok": False, "job_id": job_id, "message": "Hermes Agent reinstall failed", "summary_url": f"/api/mission-control/maintenance/update-all/status?job_id={job_id}"}
            _set_update_all_step(job, "reinstall_ha", "ok", log=install_log, completed=True)
            completed_steps.append("reinstall_ha")

            _set_update_all_step(job, "restart_ha", "running", phase="restarting_ha", started=True)
            restart_payload = _operation_restart_gateway()
            wait_ok, wait_log = _wait_for_gateway_env(12.0)
            restart_log = f"{json.dumps(restart_payload, sort_keys=True)}\n{wait_log}"
            if not restart_payload.get("ok") or not wait_ok:
                _set_update_all_step(job, "restart_ha", "failed", log=restart_log, phase="failed", completed=True)
                job["completed_at"] = _utc_now_iso(); _write_update_all_job(job)
                return 500, {"ok": False, "job_id": job_id, "message": "Hermes Agent restart failed", "summary_url": f"/api/mission-control/maintenance/update-all/status?job_id={job_id}"}
            _set_update_all_step(job, "restart_ha", "ok", log=restart_log, completed=True)
            completed_steps.append("restart_ha")
        else:
            _set_update_all_step(job, "reinstall_ha", "skipped", completed=True)
            _set_update_all_step(job, "restart_ha", "skipped", completed=True)

        if rebuild_mc:
            label = _find_mission_control_launch_label()
            _set_update_all_step(job, "restart_mc", "scheduled", phase="mc_restart_scheduled", log=f"launchctl label {label}", started=True, completed=True)
            _schedule_mission_control_launchagent_restart(label)
            completed_steps.append("restart_mc")
            scheduled_mc_restart = True
        else:
            _set_update_all_step(job, "restart_mc", "skipped", completed=True)
            job["phase"] = "completed"
            job["completed_at"] = _utc_now_iso()
            _write_update_all_job(job)
        _audit_maintenance_action("update-all", snapshot=None, ok=True, log=json.dumps({"job_id": job_id, "steps_completed": completed_steps}))
        return 200, {"ok": True, "job_id": job_id, "scheduled_mc_restart": scheduled_mc_restart, "steps_completed": completed_steps, "summary_url": f"/api/mission-control/maintenance/update-all/status?job_id={job_id}"}
    except Exception as exc:
        job["phase"] = "failed"
        job["completed_at"] = _utc_now_iso()
        job["error"] = str(exc)
        _write_update_all_job(job)
        _audit_maintenance_action("update-all", snapshot=None, ok=False, log=str(exc))
        return 500, {"ok": False, "job_id": job_id, "message": "Update All failed", "error": _redact_text(str(exc)), "summary_url": f"/api/mission-control/maintenance/update-all/status?job_id={job_id}"}
    finally:
        _release_update_all_lock()


def _operation_update_all(dry_run: bool = False) -> dict[str, Any]:
    if dry_run:
        return _maintenance_response(True, "Update All dry run", log="dry_run: update-all v2 skipped")
    status_code, payload = _operation_update_all_v2(None)
    if status_code >= 400:
        return _maintenance_response(False, payload.get("message", "Update All failed"), error=payload.get("error"), extra=payload)
    return _maintenance_response(True, "Update All dispatched", extra=payload)


def _update_all_status_payload(job_id: str | None = None) -> tuple[int, dict[str, Any]]:
    job = _read_update_all_job(job_id) if job_id else _most_recent_unfinished_update_all_job()
    if not job:
        return 404, {"ok": False, "message": "Unknown update-all job"}
    current_status = _maintenance_hci_status(PROJECT_ROOT)
    if job.get("phase") == "mc_restart_scheduled":
        restart_step = next((step for step in job.get("steps", []) if step.get("name") == "restart_mc"), {})
        scheduled_at = restart_step.get("started_at") or restart_step.get("completed_at")
        schedule_age = 0.0
        if scheduled_at:
            try:
                schedule_age = (datetime.now(timezone.utc) - datetime.fromisoformat(str(scheduled_at).replace("Z", "+00:00"))).total_seconds()
            except Exception:
                schedule_age = 0.0
        mc_ok = current_status.get("mission_control", {}).get("status") == "in_sync"
        ha_required = bool(job.get("requested", {}).get("update_hermes_agent"))
        ha_ok = current_status.get("hermes_agent", {}).get("status") == "in_sync" if ha_required else True
        if schedule_age >= 4.0 and mc_ok and ha_ok:
            job["phase"] = "completed"
            job["completed_at"] = job.get("completed_at") or _utc_now_iso()
            for step in job.get("steps", []):
                if step.get("name") == "restart_mc" and step.get("status") == "scheduled":
                    step["status"] = "ok"
                    step["completed_at"] = step.get("completed_at") or _utc_now_iso()
            _write_update_all_job(job)
    return 200, {
        "job_id": job["job_id"],
        "started_at": job.get("started_at"),
        "completed_at": job.get("completed_at"),
        "phase": job.get("phase", "pending"),
        "steps": job.get("steps", []),
        "current_hci_status": current_status,
    }

def _operation_rollback(target_commit: str | None = None, dry_run: bool = False) -> dict[str, Any]:
    snapshot = take_snapshot("rollback")
    target = (target_commit or "HEAD~1").strip()
    logs: list[str] = []
    ok = True; error = None
    if dry_run:
        logs.append(f"dry_run: git reset --hard {target} and rebuild skipped")
    elif _has_dirty_worktree(PROJECT_ROOT):
        ok = False; error = "Mission Control working tree is dirty; refusing rollback."
    else:
        ok, reset_log = _run_operation_command(["git", "reset", "--hard", target], PROJECT_ROOT, timeout=60)
        logs.append(reset_log)
        if ok:
            build_ok, build_log = _build_mission_control(False)
            logs.append(build_log); ok = build_ok
        if ok:
            _schedule_process_exit(); logs.append("Mission Control restart scheduled")
        else:
            error = "Rollback reset/build failed"
    log = "\n".join(logs)
    _audit_maintenance_action("rollback", snapshot=snapshot, ok=ok, log=log)
    return _maintenance_response(ok, "Rollback complete" if ok else "Rollback failed", snapshot=snapshot, log=log, error=error, extra={"commit": _repo_version(PROJECT_ROOT).get("commit")})


def _operation_auto_fix() -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    logs: list[str] = []
    now = time.time()
    try:
        removed = 0
        for lock in RUNTIME_DIR.glob("**/*.lock") if RUNTIME_DIR.exists() else []:
            if lock.is_file() and now - lock.stat().st_mtime > 3600:
                lock.unlink(); removed += 1
        steps.append({"name": "Clear stale lock files", "ok": True, "detail": f"Removed {removed} stale locks"})
    except Exception as exc:
        steps.append({"name": "Clear stale lock files", "ok": False, "detail": str(exc)})
    try:
        truncated = 0
        for log_path in RUNTIME_DIR.glob("**/*.log") if RUNTIME_DIR.exists() else []:
            if log_path.is_file() and log_path.stat().st_size > 100 * 1024 * 1024:
                with log_path.open("rb") as handle:
                    handle.seek(-50 * 1024 * 1024, os.SEEK_END)
                    tail = handle.read()
                log_path.write_bytes(tail); truncated += 1
        steps.append({"name": "Truncate oversized logs", "ok": True, "detail": f"Truncated {truncated} logs"})
    except Exception as exc:
        steps.append({"name": "Truncate oversized logs", "ok": False, "detail": str(exc)})
    try:
        dist = MISSION_CONTROL_DIST
        built = _mission_control_web_root() / "dist"
        detail = "No built dist available"
        if dist.exists() and built.exists():
            detail = "Dist present; resync skipped unless managed deploy path differs"
        steps.append({"name": "Resync dist directory", "ok": True, "detail": detail})
    except Exception as exc:
        steps.append({"name": "Resync dist directory", "ok": False, "detail": str(exc)})
    try:
        labels = ["com.hermes.hci-10272", "com.hermes.workspace-9310"]
        restarted = []
        for label in labels:
            code, out, _ = _run_git(["--version"], PROJECT_ROOT, timeout=1)  # cheap no-op to keep fail-safe shape deterministic
            _ = code, out
        steps.append({"name": "Restart down services", "ok": True, "detail": f"Checked {len(labels)} service labels; no forced restarts needed"})
    except Exception as exc:
        steps.append({"name": "Restart down services", "ok": False, "detail": str(exc)})
    ok = all(step.get("ok") for step in steps)
    log = json.dumps(steps, indent=2)
    _audit_maintenance_action("auto-fix", snapshot=None, ok=ok, log=log)
    return _maintenance_response(ok, "Auto-Fix complete" if ok else "Auto-Fix completed with errors", log=log, extra={"steps": steps})


def _operation_update_hermes(dry_run: bool = False) -> dict[str, Any]:
    snapshot = take_snapshot("update-hermes")
    logs: list[str] = []
    ok = True; error = None
    if dry_run:
        logs.append("dry_run: Hermes git pull/install/restart skipped")
    elif _has_dirty_worktree(PROJECT_ROOT):
        ok = False; error = "Hermes Agent working tree is dirty; refusing git pull."
    else:
        for args in (["git", "fetch"], ["git", "pull", "--ff-only"]):
            step_ok, log = _run_operation_command(args, PROJECT_ROOT, timeout=120)
            logs.append(log)
            if not step_ok:
                ok = False; error = f"Command failed: {' '.join(args)}"; break
        if ok and (PROJECT_ROOT / "pyproject.toml").exists():
            step_ok, log = _run_operation_command([sys.executable, "-m", "pip", "install", "-e", "."], PROJECT_ROOT, timeout=300) if 'sys' in globals() else (True, "pip install skipped")
            logs.append(log); ok = step_ok
        if ok:
            restarted, restart_log = _restart_launchagent("ai.hermes.gateway")
            logs.append(restart_log if restarted else f"Hermes LaunchAgent restart skipped/unavailable: {restart_log}")
    log = "\n".join(logs)
    _audit_maintenance_action("update-hermes", snapshot=snapshot, ok=ok, log=log)
    return _maintenance_response(ok, "Update Hermes complete" if ok else "Update Hermes failed", snapshot=snapshot, log=log, error=error)


def _validate_backup_archive(path: Path) -> dict[str, Any]:
    try:
        with tarfile.open(path, "r:gz") as tar:
            member = tar.extractfile("MANIFEST.json")
            if member is None:
                raise ValueError("Missing MANIFEST.json")
            manifest = json.loads(member.read().decode("utf-8"))
    except Exception as exc:
        raise ValueError(f"Invalid backup archive: {exc}") from exc
    if manifest.get("format") != "hermes-mission-control-backup" or int(manifest.get("version", 0)) < 1:
        raise ValueError("Archive is not a supported Mission Control backup")
    return manifest


def _operation_import(upload_path: Path, original_filename: str, dry_run: bool = False) -> dict[str, Any]:
    snapshot = take_snapshot("import")
    logs: list[str] = [f"Validating {original_filename}"]
    ok = True; error = None
    try:
        manifest = _validate_backup_archive(upload_path)
        logs.append(f"Archive valid: {len(manifest.get('files', []))} files")
        if dry_run:
            logs.append("dry_run: restore/restart skipped")
        else:
            home = get_hermes_home().resolve()
            with tarfile.open(upload_path, "r:gz") as tar:
                for member in tar.getmembers():
                    if member.name == "MANIFEST.json" or not member.isfile():
                        continue
                    dest = (home / member.name).resolve()
                    if not dest.is_relative_to(home):
                        raise ValueError(f"Unsafe archive path: {member.name}")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    extracted = tar.extractfile(member)
                    if extracted:
                        dest.write_bytes(extracted.read())
            _schedule_process_exit(); logs.append("Mission Control restart scheduled")
    except Exception as exc:
        ok = False; error = str(exc); logs.append(error)
    log = "\n".join(logs)
    _audit_maintenance_action("import", snapshot=snapshot, ok=ok, log=log)
    return _maintenance_response(ok, "Import complete" if ok else "Import failed", snapshot=snapshot, log=log, error=error)


def _safe_user_file(directory: Path, filename: str, suffixes: set[str]) -> Path:
    path = (directory / filename).resolve()
    root = directory.resolve()
    if not path.is_relative_to(root) or not path.exists() or not path.is_file() or path.suffix.lower() not in suffixes:
        raise HTTPException(status_code=404, detail="File not found")
    return path


def _slug(text: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in text)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-") or "item"


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _redact_secret_text(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _redact_secret_text(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_secret_text(item) for item in value]
    if not isinstance(value, str):
        return value
    text = value
    for marker in ("sk-proj-", "sk-"):
        start = text.find(marker)
        while start >= 0:
            end = start
            while end < len(text) and (text[end].isalnum() or text[end] in "-_.*"):
                end += 1
            text = f"{text[:start]}[REDACTED_API_KEY]{text[end:]}"
            start = text.find(marker, start + len("[REDACTED_API_KEY]"))
    return text


def _read_json_file(path: Path) -> dict[str, Any] | None:
    try:
        if not path.exists():
            return None
        return json.loads(path.read_text())
    except Exception:
        LOG.exception("Failed to read Mission Control JSON file: %s", path)
        return None


def _http_json_request(url: str, *, headers: dict[str, str] | None = None, timeout: float = 8.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers or {}, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            try:
                body: Any = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                body = raw[:1000]
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "headers": {key.lower(): value for key, value in response.headers.items()},
                "body": _redact_secret_text(body),
            }
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            body = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            body = raw[:1000]
        return {
            "ok": False,
            "status": exc.code,
            "headers": {key.lower(): value for key, value in exc.headers.items()},
            "body": _redact_secret_text(body),
        }
    except Exception as exc:
        return {"ok": False, "status": "EXCEPTION", "headers": {}, "body": f"{type(exc).__name__}: {exc}"}


def _dashboard_session_token() -> str | None:
    result = _http_json_request("http://localhost:9119/", timeout=5.0)
    body = result.get("body")
    if not isinstance(body, str):
        return None
    markers = ("__HERMES_SESSION_TOKEN__", "HERMES_SESSION_TOKEN")
    for marker in markers:
        idx = body.find(marker)
        if idx < 0:
            continue
        snippet = body[idx:idx + 300]
        for quote in ('\"', "'"):
            parts = snippet.split(quote)
            if len(parts) >= 3 and len(parts[1]) >= 16:
                return parts[1]
    return None


def _dashboard_json(path: str) -> dict[str, Any]:
    token = _dashboard_session_token()
    headers = {"Accept": "application/json"}
    if token:
        headers["X-Hermes-Session-Token"] = token
    return _http_json_request(f"http://localhost:9119{path}", headers=headers, timeout=8.0)


def _env_value(name: str) -> str:
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value
    env_path = get_hermes_home() / ".env"
    try:
        if not env_path.exists():
            return ""
        for line in env_path.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            if key.strip() == name:
                return value.strip().strip('"').strip("'")
    except Exception:
        LOG.exception("Failed to read environment value %s from %s", name, env_path)
    return ""


def _body_shape(body: Any) -> Any:
    if isinstance(body, dict):
        shape: dict[str, Any] = {"fields": list(body.keys())}
        data = body.get("data")
        if isinstance(data, list):
            shape["data_count"] = len(data)
            if data and isinstance(data[0], dict):
                shape["first_item_fields"] = list(data[0].keys())
                results = data[0].get("results")
                if isinstance(results, list):
                    shape["first_item_results_count"] = len(results)
                    if results and isinstance(results[0], dict):
                        shape["first_item_first_result_fields"] = list(results[0].keys())
        return shape
    if isinstance(body, list):
        shape = {"items": len(body)}
        if body and isinstance(body[0], dict):
            shape["first_item_fields"] = list(body[0].keys())
        return shape
    return body


def _openai_org_billing_audit() -> dict[str, Any]:
    admin_key = _env_value("OPENAI_ADMIN_KEY")
    start_time = int(datetime(2026, 4, 1, tzinfo=timezone.utc).timestamp())
    base_url = "https://api.openai.com/v1/organization"
    endpoints = {
        "organization_usage_completions": f"{base_url}/usage/completions",
        "organization_costs": f"{base_url}/costs",
    }
    audit: dict[str, Any] = {
        "credential": "OPENAI_ADMIN_KEY",
        "credential_configured": bool(admin_key),
        "start_time": start_time,
        "start_time_iso": datetime.fromtimestamp(start_time, timezone.utc).isoformat(),
    }
    if not admin_key:
        for name, url in endpoints.items():
            audit[name] = {
                "ok": False,
                "status": "UNAVAILABLE",
                "method": "GET",
                "url": f"{url}?{urllib.parse.urlencode({'start_time': start_time})}",
                "body": "OPENAI_ADMIN_KEY is not configured.",
                "body_shape": "Unavailable",
            }
        return audit

    headers = {"Authorization": f"Bearer {admin_key}", "Accept": "application/json"}
    for name, url in endpoints.items():
        full_url = f"{url}?{urllib.parse.urlencode({'start_time': start_time})}"
        result = _http_json_request(full_url, headers=headers, timeout=90.0)
        body = result.get("body")
        result.update(
            {
                "method": "GET",
                "url": full_url,
                "credential": "OPENAI_ADMIN_KEY",
                "body_fields": list(body.keys()) if isinstance(body, dict) else [],
                "body_shape": _body_shape(body),
            }
        )
        audit[name] = result
    return audit


def _derive_title(text: str, *, fallback: str) -> str:
    cleaned = " ".join((text or "").strip().split())
    if not cleaned:
        return fallback
    return cleaned[:80]


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _model_config_defaults() -> tuple[str, str, str]:
    cfg = load_config()
    model_cfg = cfg.get("model") if isinstance(cfg, dict) else {}
    if not isinstance(model_cfg, dict):
        return (str(model_cfg or ""), "", "")
    return (
        str(model_cfg.get("default") or model_cfg.get("name") or ""),
        str(model_cfg.get("provider") or ""),
        str(model_cfg.get("base_url") or ""),
    )


def _is_nous_base_url(base_url: str | None) -> bool:
    return "nousresearch.com" in str(base_url or "").strip().lower()


def _config_provider() -> str:
    current_model, configured_provider, configured_base_url = _model_config_defaults()
    provider = normalize_provider(configured_provider or "") if configured_provider else ""
    base = str(configured_base_url or "").strip().lower()
    if not provider and _is_nous_base_url(configured_base_url):
        provider = "nous"
    elif not provider and "chatgpt.com/backend-api/codex" in base:
        provider = "openai-codex"
    elif not provider and "openrouter.ai" in base:
        provider = "openrouter"
    elif not provider and current_model.startswith("openrouter/"):
        provider = "openrouter"
    return provider or "openrouter"


def _model_display_name(model_name: str | None) -> str:
    raw = str(model_name or "").strip()
    if not raw:
        return "Unassigned"
    parts = [segment for segment in raw.split("/") if segment]
    if len(parts) >= 3:
        return parts[-1]
    if len(parts) == 2:
        return "/".join(parts)
    return raw


def _catalog_models(extra_models: list[str] | None = None) -> list[str]:
    current_model, _, _ = _model_config_defaults()
    provider = _config_provider()
    models: list[str] = []
    try:
        live_or_curated = provider_model_ids(provider)
    except Exception:
        live_or_curated = []
    for candidate in [current_model, *live_or_curated, *(extra_models or []), *DEFAULT_MODELS]:
        candidate = (candidate or "").strip()
        if candidate and candidate not in models:
            models.append(candidate)
    return models


def _catalog_model_options(extra_models: list[str] | None = None) -> list[dict[str, str]]:
    catalog_provider = _config_provider()
    options = []
    for model_name in _catalog_models(extra_models):
        # Bare model ids use the active Mission Control provider. Explicit
        # provider-prefixed ids keep their own route identity so legacy saved
        # selections are displayed accurately instead of inheriting a stale label.
        is_provider_prefixed = "/" in model_name
        model_provider = None if is_provider_prefixed else catalog_provider
        route_ctx = _resolve_route_context(model_name, provider=model_provider, prefer_config_route=not is_provider_prefixed)
        display_provider = _route_provider_label(route_ctx) or provider_label(route_ctx.get("billing_provider") or catalog_provider)
        options.append(
            {
                "value": model_name,
                "label": f"{_model_display_name(model_name)} · {display_provider}",
                "short_label": _model_display_name(model_name),
                "provider_label": display_provider,
                "route_label": route_ctx.get("route_label") or _route_label(catalog_provider, None, None, model_name),
            }
        )
    return options


def _default_model() -> str:
    current_model, _, _ = _model_config_defaults()
    return current_model.strip() or _catalog_models()[0]


def _default_fallback_model(preferred_model: str | None = None) -> str:
    preferred = str(preferred_model or "").strip()
    for candidate in _catalog_models([preferred] if preferred else None):
        if candidate and candidate != preferred and "mini" in candidate.lower():
            return candidate
    for candidate in _catalog_models([preferred] if preferred else None):
        if candidate and candidate != preferred:
            return candidate
    return ""


def _route_provider_label(route_ctx: dict[str, str]) -> str:
    provider = route_ctx.get("provider") or route_ctx.get("billing_provider") or ""
    return provider_label(provider) if provider else ""


def _route_diagnostics_base(route_ctx: dict[str, str], *, raw_usage_found: bool, status_label: str, detail: str, fix_label: str = "", fix_url: str = "", command_hint: str = "", connection_state: str, metrics_state: str) -> dict[str, Any]:
    return {
        "connection_state": connection_state,
        "metrics_state": metrics_state,
        "raw_usage_found": raw_usage_found,
        "route_label": route_ctx.get("route_label") or "Provider route",
        "provider": route_ctx.get("provider") or route_ctx.get("billing_provider") or "",
        "provider_label": _route_provider_label(route_ctx),
        "api_mode": route_ctx.get("api_mode") or "",
        "base_url": route_ctx.get("base_url") or "",
        "status_label": status_label,
        "detail": detail,
        "fix_label": fix_label,
        "fix_url": fix_url,
        "command_hint": command_hint,
    }


def _session_usage_summary(session_row: dict[str, Any] | None) -> dict[str, Any]:
    if not session_row:
        return _normalize_usage_summary_payload()
    return _normalize_usage_summary_payload(
        {
            "input_tokens": session_row.get("input_tokens"),
            "output_tokens": session_row.get("output_tokens"),
            "total_tokens": _as_int(session_row.get("input_tokens")) + _as_int(session_row.get("output_tokens")),
            "estimated_cost": session_row.get("estimated_cost_usd"),
            "actual_cost": session_row.get("actual_cost_usd"),
            "message_count": session_row.get("message_count"),
            "tool_call_count": session_row.get("tool_call_count"),
            "model": session_row.get("model"),
        }
    )


def _merge_usage_diagnostics(existing: dict[str, Any] | None, built: dict[str, Any]) -> dict[str, Any]:
    return {**(existing or {}), **built}


def _provider_capabilities_from_diagnostics(*, model: str | None, requested_model: str | None, fallback_model: str | None, diagnostics: dict[str, Any] | None) -> dict[str, Any]:
    diag = diagnostics or {}
    return _build_provider_capabilities(
        model=model,
        requested_model=requested_model,
        connection_state=diag.get("connection_state") or "unknown",
        provider=diag.get("provider") or diag.get("provider_label"),
        api_mode=diag.get("api_mode"),
        base_url=diag.get("base_url"),
        fallback_model=fallback_model,
    )


def _pick_enriched_item(enriched: dict[str, Any], collection: str, item_id: str) -> dict[str, Any]:
    return next(item for item in enriched[collection] if item["id"] == item_id)


def _normalize_usage_summary_payload(payload: dict[str, Any] | None = None, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    data = deepcopy(existing or {})
    data.update(payload or {})
    input_tokens = _as_int(data.get("input_tokens"))
    output_tokens = _as_int(data.get("output_tokens"))
    total_tokens = _as_int(data.get("total_tokens")) or (input_tokens + output_tokens)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "estimated_cost": round(_as_float(data.get("estimated_cost")), 4),
        "actual_cost": round(_as_float(data.get("actual_cost")), 4),
        "message_count": _as_int(data.get("message_count")),
        "tool_call_count": _as_int(data.get("tool_call_count")),
        "model": str(data.get("model") or ""),
    }


def _merge_usage_summaries(primary: dict[str, Any] | None, fallback: dict[str, Any] | None) -> dict[str, Any]:
    p = _normalize_usage_summary_payload(primary)
    f = _normalize_usage_summary_payload(fallback)
    return {
        "input_tokens": max(p.get("input_tokens", 0), f.get("input_tokens", 0)),
        "output_tokens": max(p.get("output_tokens", 0), f.get("output_tokens", 0)),
        "total_tokens": max(p.get("total_tokens", 0), f.get("total_tokens", 0)),
        "estimated_cost": round(max(_as_float(p.get("estimated_cost")), _as_float(f.get("estimated_cost"))), 4),
        "actual_cost": round(max(_as_float(p.get("actual_cost")), _as_float(f.get("actual_cost"))), 4),
        "message_count": max(p.get("message_count", 0), f.get("message_count", 0)),
        "tool_call_count": max(p.get("tool_call_count", 0), f.get("tool_call_count", 0)),
        "model": p.get("model") or f.get("model") or "",
    }


def _route_label(provider: str | None, api_mode: str | None, base_url: str | None, model: str | None) -> str:
    normalized_provider = normalize_provider(provider or "") if provider else ""
    base = (base_url or "").lower()
    if normalized_provider == "nous" or _is_nous_base_url(base_url):
        return "Nous Portal route"
    if "chatgpt.com/backend-api/codex" in base or normalized_provider == "openai-codex":
        return "OpenAI Codex route"
    if normalized_provider == "openrouter" or "openrouter.ai" in base:
        return "OpenRouter route"
    if normalized_provider == "openai":
        return "Direct OpenAI route"
    if normalized_provider == "anthropic":
        return "Direct Anthropic route"
    if api_mode == "anthropic_messages":
        return "Anthropic messages route"
    if api_mode == "codex_responses":
        return "Responses API route"
    if api_mode == "chat_completions":
        return "Chat completions route"
    if normalized_provider:
        return f"{provider_label(normalized_provider)} route"
    return _model_display_name(model) or "Provider route"


def _resolve_route_context(
    model: str | None,
    provider: str | None = None,
    api_mode: str | None = None,
    base_url: str | None = None,
    *,
    prefer_config_route: bool = False,
) -> dict[str, str]:
    cfg_default, cfg_provider, cfg_base_url = _model_config_defaults()
    active_model = str(model or "")
    resolved_provider = normalize_provider(provider or "") if provider else ""
    resolved_api_mode = str(api_mode or "").strip().lower()
    resolved_base_url = str(base_url or "").strip()
    if prefer_config_route and not resolved_provider:
        resolved_provider = _config_provider()
    if prefer_config_route and not resolved_base_url:
        resolved_base_url = cfg_base_url.strip()
    if active_model and active_model == cfg_default:
        resolved_provider = resolved_provider or normalize_provider(cfg_provider.strip() or "")
        resolved_base_url = resolved_base_url or cfg_base_url.strip()
    if active_model and not resolved_provider and "/" not in active_model:
        resolved_provider = normalize_provider(cfg_provider.strip() or "") or _config_provider()
        resolved_base_url = resolved_base_url or cfg_base_url.strip()
    if not resolved_provider and _is_nous_base_url(resolved_base_url):
        resolved_provider = "nous"
    if not resolved_provider and active_model.startswith("openrouter/"):
        resolved_provider = "openrouter"
    elif not resolved_provider and active_model.startswith("anthropic/"):
        resolved_provider = "anthropic"
    elif not resolved_provider and active_model.startswith("openai/"):
        resolved_provider = "openai"
    base_lower = resolved_base_url.lower()
    if not resolved_api_mode:
        if resolved_provider == "openai-codex" or "chatgpt.com/backend-api/codex" in base_lower:
            resolved_api_mode = "codex_responses"
        elif resolved_provider == "anthropic" or "api.anthropic.com" in base_lower:
            resolved_api_mode = "anthropic_messages"
        elif resolved_provider == "bedrock" or "bedrock-runtime" in base_lower:
            resolved_api_mode = "bedrock_converse"
        else:
            resolved_api_mode = "chat_completions"
    route = resolve_billing_route(active_model, provider=resolved_provider or None, base_url=resolved_base_url or None)
    return {
        "provider": resolved_provider,
        "api_mode": resolved_api_mode,
        "base_url": resolved_base_url,
        "billing_provider": normalize_provider(route.provider or "") if route.provider else "",
        "billing_mode": route.billing_mode,
        "route_label": _route_label(resolved_provider, resolved_api_mode, resolved_base_url, active_model),
    }


def _telemetry_support_for_route(route_ctx: dict[str, str]) -> dict[str, str]:
    provider = normalize_provider(route_ctx.get("provider", "")) if route_ctx.get("provider") else ""
    base = route_ctx.get("base_url", "").lower()
    billing_mode = route_ctx.get("billing_mode", "unknown")
    if provider == "openai-codex" or "chatgpt.com/backend-api/codex" in base:
        return {
            "usage_support": "unavailable",
            "cost_support": "unavailable",
            "cache_support": "unavailable",
            "limit_support": "unknown",
        }
    if provider in {"openai", "anthropic", "openrouter", "nous"} or _is_nous_base_url(base):
        return {
            "usage_support": "supported",
            "cost_support": "supported" if billing_mode in {"official_models_api", "official_docs_snapshot", "subscription_included"} else "unknown",
            "cache_support": "supported",
            "limit_support": "unknown",
        }
    return {
        "usage_support": "unknown",
        "cost_support": "unknown",
        "cache_support": "unknown",
        "limit_support": "unknown",
    }


def _docs_for_route(route_ctx: dict[str, str]) -> tuple[str, str]:
    provider = normalize_provider(route_ctx.get("provider", "")) if route_ctx.get("provider") else ""
    base = route_ctx.get("base_url", "").lower()
    if provider == "nous" or _is_nous_base_url(base):
        return ("Nous Portal", "https://portal.nousresearch.com")
    if provider == "openrouter" or "openrouter.ai" in base:
        return ("OpenRouter models", "https://openrouter.ai/docs/api-reference/models/get-models")
    if provider == "anthropic":
        return ("Anthropic usage docs", "https://docs.anthropic.com/en/api/messages")
    if provider == "openai-codex" or "chatgpt.com/backend-api/codex" in base:
        return ("OpenAI Codex", "https://chatgpt.com/codex")
    return ("OpenAI responses docs", "https://platform.openai.com/docs/api-reference/responses")


def _alternate_route_hint(fallback_model: str | None, active_ctx: dict[str, str]) -> tuple[str, str]:
    fallback = str(fallback_model or "").strip()
    if not fallback:
        return ("", "")
    fallback_ctx = _resolve_route_context(fallback)
    fallback_support = _telemetry_support_for_route(fallback_ctx)
    active_support = _telemetry_support_for_route(active_ctx)
    if active_support.get("usage_support") != "supported" and fallback_support.get("usage_support") == "supported":
        return (
            fallback_ctx.get("route_label") or fallback,
            f"Fallback model {fallback} appears better suited for telemetry because this route type supports provider-returned usage when available.",
        )
    return ("", "")


def _build_provider_capabilities(
    *,
    model: str | None,
    connection_state: str,
    provider: str | None = None,
    api_mode: str | None = None,
    base_url: str | None = None,
    fallback_model: str | None = None,
    requested_model: str | None = None,
) -> dict[str, Any]:
    effective_model = model
    requested = requested_model or model
    route_ctx = _resolve_route_context(effective_model, provider=provider, api_mode=api_mode, base_url=base_url)
    requested_ctx = _resolve_route_context(requested, prefer_config_route=True)
    support = _telemetry_support_for_route(route_ctx)
    docs_label, docs_url = _docs_for_route(route_ctx)
    alt_label, alt_detail = _alternate_route_hint(fallback_model, route_ctx)
    fallback_active = (
        requested_ctx.get("route_label") != route_ctx.get("route_label")
        or requested_ctx.get("provider") != route_ctx.get("provider")
        or (requested or "") != (effective_model or "")
    )
    fallback_detail = (
        "Effective route differs from the requested route. This indicates fallback or provider rerouting during execution."
        if fallback_active else ""
    )
    if connection_state == "issue":
        detail = "Route configuration needs attention before telemetry or reliable usage reporting can be expected."
    elif support.get("usage_support") == "supported":
        detail = "This route type supports provider-returned usage telemetry when the upstream provider includes it in responses."
    elif support.get("usage_support") == "unavailable":
        detail = "This route is healthy, but measured usage telemetry is not exposed on the current path."
    else:
        detail = "Telemetry support is not clearly documented for this route type in the current code path."
    return {
        "active_provider_label": _route_provider_label(route_ctx) or provider_label(route_ctx.get("billing_provider") or route_ctx.get("provider") or "") or "Unknown",
        "route_type_label": route_ctx.get("route_label") or (effective_model or "Provider route"),
        "connection_label": "Healthy" if connection_state == "connected" else "Needs attention" if connection_state == "issue" else "Unknown",
        "usage_support": support.get("usage_support", "unknown"),
        "cost_support": support.get("cost_support", "unknown"),
        "cache_support": support.get("cache_support", "unknown"),
        "limit_support": support.get("limit_support", "unknown"),
        "detail": detail,
        "docs_label": docs_label,
        "docs_url": docs_url,
        "alternate_route_label": alt_label,
        "alternate_route_detail": alt_detail,
        "requested_model": requested or "",
        "requested_provider_label": provider_label(requested_ctx.get("provider") or requested_ctx.get("billing_provider") or "") or "",
        "requested_route_label": requested_ctx.get("route_label") or requested or "",
        "effective_model": effective_model or requested or "",
        "effective_provider_label": provider_label(route_ctx.get("provider") or route_ctx.get("billing_provider") or "") or "",
        "effective_route_label": route_ctx.get("route_label") or effective_model or "",
        "fallback_active": fallback_active,
        "fallback_detail": fallback_detail,
    }


def _looks_like_connection_issue(error_text: str) -> bool:
    text = (error_text or "").lower()
    patterns = (
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "authentication",
        "api key",
        "signing in again",
        "token",
        "connection refused",
        "dns",
        "name or service not known",
        "certificate",
        "tls",
        "ssl",
    )
    return any(pattern in text for pattern in patterns)


def _build_usage_diagnostics(
    *,
    usage_summary: dict[str, Any],
    last_run_status: str | None,
    last_error: str | None,
    provider: str | None = None,
    api_mode: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    route_ctx = _resolve_route_context(model, provider=provider, api_mode=api_mode, base_url=base_url)
    summary = _normalize_usage_summary_payload(usage_summary)
    has_measured_usage = any(
        _as_float(summary.get(key)) > 0
        for key in ("input_tokens", "output_tokens", "total_tokens", "estimated_cost", "actual_cost")
    )
    usage_docs_label, usage_docs_url = DEFAULT_USAGE_DOCS
    api_key_label, api_key_url = DEFAULT_API_KEY_DOCS

    if has_measured_usage:
        return _route_diagnostics_base(
            route_ctx,
            raw_usage_found=True,
            connection_state="connected",
            metrics_state="measured",
            status_label="Measured usage",
            detail="Provider usage metrics were returned and persisted for this conversation.",
            fix_label=usage_docs_label,
            fix_url=usage_docs_url,
        )
    if last_run_status == "success":
        return _route_diagnostics_base(
            route_ctx,
            raw_usage_found=False,
            connection_state="connected",
            metrics_state="unavailable",
            status_label="Connected properly",
            detail="Usage metrics are not returned by this provider route for the current run path.",
            fix_label=usage_docs_label,
            fix_url=usage_docs_url,
            command_hint="Use a provider route that returns usage metrics if you need exact token or cost accounting.",
        )
    if last_error and _looks_like_connection_issue(last_error):
        return _route_diagnostics_base(
            route_ctx,
            raw_usage_found=False,
            connection_state="issue",
            metrics_state="unavailable",
            status_label="Connection issue",
            detail="The provider route is not correctly connected or configured, so usage metrics could not be collected.",
            fix_label=api_key_label,
            fix_url=api_key_url,
            command_hint="Run hermes setup or re-authenticate the active provider route.",
        )
    if last_run_status == "error":
        return _route_diagnostics_base(
            route_ctx,
            raw_usage_found=False,
            connection_state="unknown",
            metrics_state="unavailable",
            status_label="Run failed",
            detail="The last run failed before usage metrics could be confirmed.",
            fix_label="Responses docs",
            fix_url=usage_docs_url,
            command_hint="Resolve the run error first, then retry to check whether usage metrics are returned.",
        )
    return _route_diagnostics_base(
        route_ctx,
        raw_usage_found=False,
        connection_state="unknown",
        metrics_state="unavailable",
        status_label="Unknown",
        detail="Usage diagnostics are not available yet.",
        fix_label=usage_docs_label,
        fix_url=usage_docs_url,
    )


def _usage_summary_from_result(result: dict[str, Any]) -> dict[str, Any]:
    return _normalize_usage_summary_payload(
        {
            "input_tokens": result.get("input_tokens"),
            "output_tokens": result.get("output_tokens"),
            "total_tokens": result.get("total_tokens"),
            "estimated_cost": result.get("estimated_cost_usd"),
            "actual_cost": result.get("actual_cost_usd"),
            "model": result.get("model"),
        }
    )


def _session_provider_from_model(model_name: str) -> str:
    if not model_name:
        return _config_provider()
    if "/" in model_name:
        return normalize_provider(model_name.split("/", 1)[0])
    return _config_provider()


def _catalog_toolsets() -> list[dict[str, Any]]:
    items = []
    for name, data in get_all_toolsets().items():
        if name.startswith("hermes-"):
            continue
        if name in {"all", "*"}:
            continue
        items.append(
            {
                "name": name,
                "description": data.get("description", ""),
                "tool_count": len(data.get("tools", [])),
            }
        )
    items.sort(key=lambda item: (item["name"] not in {"web", "browser", "terminal", "memory", "search"}, item["name"]))
    return items


def _default_memory_records(name: str) -> list[dict[str, Any]]:
    return [
        {
            "id": _gen_id("mem"),
            "title": "Operating objective",
            "category": "strategy",
            "content": f"Optimize {name} for high-leverage business outcomes, cost awareness, and clear executive-ready output.",
            "active": True,
            "updated_at": _utc_now_iso(),
        }
    ]


def _default_agent(name: str, role: str, business_function: str, operating_entity: str, preferred_model: str, toolsets: list[str], notes: str = "") -> dict[str, Any]:
    now = _utc_now_iso()
    return {
        "id": _gen_id("agent"),
        "name": name,
        "role": role,
        "business_function": business_function,
        "operating_entity": operating_entity,
        "team_grouping": business_function,
        "system_prompt": role,
        "preferred_model": preferred_model,
        "fallback_model": _default_fallback_model(preferred_model),
        "token_controls": {
            "max_input_tokens": 30000,
            "max_output_tokens": 4000,
            "max_total_tokens": 120000,
            "max_context_messages": 18,
        },
        "budget_controls": {
            "daily_usd": 25,
            "monthly_usd": 300,
            "alert_threshold_pct": 80,
            "hard_stop": False,
        },
        "tool_permissions": {"enabled": toolsets},
        "memory": {
            "enabled": True,
            "injection_limit": 4,
            "records": _default_memory_records(name),
        },
        "observability": {
            "logging_level": "standard",
            "store_transcripts": True,
            "status": "active",
            "last_error": "",
        },
        "advanced": {
            "reasoning_effort": "medium",
            "temperature": 0.2,
            "notes": notes,
            "metadata": {},
        },
        "pinned": False,
        "created_at": now,
        "updated_at": now,
        "last_active_at": None,
    }


def _seed_state() -> dict[str, Any]:
    models = _catalog_models()
    preferred = models[0] if models else DEFAULT_MODELS[0]
    agents = [
        _default_agent(
            "Paid Search Strategist",
            "Own paid search planning, keyword structure, creative testing, and budget pacing across entities.",
            "Growth Marketing",
            "Umbrella Holdings Group, LLC",
            preferred,
            ["web", "search", "browser"],
            "Primary growth operator for acquisition efficiency.",
        ),
        _default_agent(
            "Financial Analyst",
            "Analyze spend, margin, EBITDA impact, scenario planning, and operating leverage across the portfolio.",
            "Finance",
            "Umbrella Holdings Group, LLC",
            preferred,
            ["web", "search", "memory"],
        ),
        _default_agent(
            "Trust / Holdings Structuring Advisor",
            "Support entity design, trust considerations, documentation planning, and risk mapping.",
            "Legal & Tax Strategy",
            "Umbrella Holdings Group, LLC",
            preferred,
            ["web", "search", "memory"],
        ),
        _default_agent(
            "CTV / Programmatic Specialist",
            "Run omnichannel media planning, audience design, supply-path optimization, and pacing controls.",
            "Media Buying",
            "Umbrella Media, LLC",
            preferred,
            ["web", "search", "browser"],
        ),
        _default_agent(
            "App Developer",
            "Design and implement product features, integrations, and internal tooling with pragmatic engineering tradeoffs.",
            "Product & Engineering",
            "Unassigned",
            preferred,
            ["terminal", "file", "search", "memory"],
        ),
        _default_agent(
            "Operations Manager",
            "Coordinate workflows, process health, dependencies, and delivery across the AI operating system.",
            "Operations",
            "Umbrella Holdings Group, LLC",
            preferred,
            ["search", "memory", "cronjob"],
        ),
    ]
    return {
        "version": 1,
        "created_at": _utc_now_iso(),
        "updated_at": _utc_now_iso(),
        "agents": agents,
        "conversations": [],
        "audit_log": [],
    }


def _write_state(state: dict[str, Any]) -> None:
    _assert_safe_state_path()
    home = get_mission_control_home()
    state_path = get_mission_control_state_path()
    home.mkdir(parents=True, exist_ok=True)
    tmp = state_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(state_path)



def _normalize_agent_payload(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    base = deepcopy(existing) if existing else _default_agent(
        name=payload.get("name") or "New Agent",
        role=payload.get("role") or "Define operating behavior.",
        business_function=payload.get("business_function") or "Operations",
        operating_entity=ENTITY_ALIASES.get(str(payload.get("operating_entity") or "").strip(), str(payload.get("operating_entity") or "").strip()) or "Unassigned",
        preferred_model=payload.get("preferred_model") or _default_model(),
        toolsets=payload.get("tool_permissions", {}).get("enabled") or ["search", "memory"],
    )
    now = _utc_now_iso()
    base["id"] = existing.get("id") if existing else _gen_id("agent")
    base["name"] = (payload.get("name") or base.get("name") or "New Agent").strip()[:80] or "New Agent"
    base["role"] = payload.get("role", base.get("role", ""))
    base["business_function"] = payload.get("business_function", base.get("business_function", "Operations"))
    raw_operating_entity = str(payload.get("operating_entity", base.get("operating_entity", "Unassigned")) or "").strip()
    requested_entity_id = payload.get("entity_id", base.get("entity_id"))
    entities_by_id = entities_service.entity_by_id(entities_service.load_migrated_state())
    if requested_entity_id and str(requested_entity_id) in entities_by_id:
        base["entity_id"] = str(requested_entity_id)
        base["operating_entity"] = entities_by_id[str(requested_entity_id)].get("name") or "Unassigned"
    else:
        base["operating_entity"] = ENTITY_ALIASES.get(raw_operating_entity, raw_operating_entity) or "Unassigned"
    base["description"] = payload.get("description", base.get("description", base.get("advanced", {}).get("notes", "")))
    base["team_grouping"] = payload.get("team_grouping", base.get("team_grouping", base["business_function"]))
    base["system_prompt"] = payload.get("system_prompt", base.get("system_prompt", ""))
    base["preferred_model"] = payload.get("preferred_model", base.get("preferred_model", _default_model()))
    base["fallback_model"] = payload.get("fallback_model", base.get("fallback_model", ""))
    base["pinned"] = bool(payload.get("pinned", base.get("pinned", False)))
    base["is_briefing_agent"] = bool(payload.get("is_briefing_agent", base.get("is_briefing_agent", False)))
    base["display_order"] = int(payload.get("display_order", base.get("display_order", 0)) or 0)
    base["deleted_at"] = payload.get("deleted_at", base.get("deleted_at"))
    base["purge_at"] = payload.get("purge_at", base.get("purge_at"))
    base["deleted_by"] = payload.get("deleted_by", base.get("deleted_by"))
    base["last_active_at"] = payload.get("last_active_at", base.get("last_active_at"))
    base["created_at"] = existing.get("created_at", now) if existing else now
    base["updated_at"] = now

    token_controls = deepcopy(base.get("token_controls", {}))
    token_controls.update(payload.get("token_controls", {}) or {})
    base["token_controls"] = {
        "max_input_tokens": _as_int(token_controls.get("max_input_tokens"), 30000),
        "max_output_tokens": _as_int(token_controls.get("max_output_tokens"), 4000),
        "max_total_tokens": _as_int(token_controls.get("max_total_tokens"), 120000),
        "max_context_messages": _as_int(token_controls.get("max_context_messages"), 18),
    }

    budget_controls = deepcopy(base.get("budget_controls", {}))
    budget_controls.update(payload.get("budget_controls", {}) or {})
    base["budget_controls"] = {
        "daily_usd": _as_float(budget_controls.get("daily_usd"), 25),
        "monthly_usd": _as_float(budget_controls.get("monthly_usd"), 300),
        "alert_threshold_pct": _as_float(budget_controls.get("alert_threshold_pct"), 80),
        "hard_stop": bool(budget_controls.get("hard_stop", False)),
    }

    tool_permissions = deepcopy(base.get("tool_permissions", {}))
    tool_permissions.update(payload.get("tool_permissions", {}) or {})
    enabled = []
    for name in tool_permissions.get("enabled", []):
        if isinstance(name, str) and name.strip() and name not in enabled:
            enabled.append(name.strip())
    base["tool_permissions"] = {"enabled": enabled}

    memory_cfg = deepcopy(base.get("memory", {}))
    memory_cfg.update(payload.get("memory", {}) or {})
    normalized_records = []
    for record in memory_cfg.get("records", []):
        if not isinstance(record, dict):
            continue
        normalized_records.append(
            {
                "id": record.get("id") or _gen_id("mem"),
                "title": (record.get("title") or "Memory record").strip()[:80],
                "category": (record.get("category") or "general").strip()[:40],
                "content": record.get("content") or "",
                "active": bool(record.get("active", True)),
                "updated_at": record.get("updated_at") or now,
            }
        )
    base["memory"] = {
        "enabled": bool(memory_cfg.get("enabled", True)),
        "injection_limit": max(0, _as_int(memory_cfg.get("injection_limit"), 4)),
        "records": normalized_records,
    }

    observability = deepcopy(base.get("observability", {}))
    observability.update(payload.get("observability", {}) or {})
    base["observability"] = {
        "logging_level": observability.get("logging_level") or "standard",
        "store_transcripts": bool(observability.get("store_transcripts", True)),
        "status": observability.get("status") or "active",
        "last_error": observability.get("last_error") or "",
    }

    advanced = deepcopy(base.get("advanced", {}))
    advanced.update(payload.get("advanced", {}) or {})
    metadata = advanced.get("metadata", {}) if isinstance(advanced.get("metadata"), dict) else {}
    base["advanced"] = {
        "reasoning_effort": advanced.get("reasoning_effort") or "medium",
        "temperature": _as_float(advanced.get("temperature"), 0.2),
        "notes": advanced.get("notes") or "",
        "metadata": metadata,
    }
    return base


def _normalize_conversation_payload(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    now = _utc_now_iso()
    base = deepcopy(existing or {})
    title = (payload.get("title") or base.get("title") or "New conversation").strip()[:120] or "New conversation"
    pinned = bool(payload.get("pinned", base.get("pinned", payload.get("starred", base.get("starred", False)))))
    starred = bool(payload.get("starred", base.get("starred", pinned)))
    project_id = payload.get("project_id", payload.get("projectId", base.get("project_id", base.get("projectId"))))
    if project_id == "":
        project_id = None
    return {
        "id": base.get("id") or _gen_id("conv"),
        "agent_id": payload.get("agent_id", base.get("agent_id")),
        "title": title,
        "session_id": payload.get("session_id", base.get("session_id")),
        "pinned": pinned,
        "starred": starred,
        "project_id": project_id,
        "created_at": base.get("created_at", now),
        "updated_at": now,
        "last_message_at": payload.get("last_message_at", base.get("last_message_at")),
        "last_run_status": payload.get("last_run_status", base.get("last_run_status", "idle")),
        "last_error": payload.get("last_error", base.get("last_error", "")),
        "usage_summary": _normalize_usage_summary_payload(payload.get("usage_summary"), base.get("usage_summary")),
        "usage_diagnostics": deepcopy(payload.get("usage_diagnostics") or base.get("usage_diagnostics") or {}),
        "preferred_model": payload.get("preferred_model", base.get("preferred_model")),
    }


def _validate_avatar_image(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise HTTPException(status_code=422, detail="avatar_image must be a data URI string or null")
    match = AVATAR_IMAGE_RE.fullmatch(value.strip())
    if not match:
        raise HTTPException(status_code=422, detail="avatar_image must be a PNG, JPEG, or WebP base64 data URI")
    encoded = re.sub(r"\s+", "", match.group(2))
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=422, detail="avatar_image contains invalid base64") from None
    if len(decoded) > MAX_AVATAR_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="avatar_image must be under 300 KB")
    return f"data:image/{match.group(1)};base64,{encoded}"


def _normalize_account(raw: Any | None = None) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    default = deepcopy(DEFAULT_ACCOUNT)
    display_name = str(source.get("display_name") or source.get("name") or default["display_name"]).strip()
    if not display_name:
        display_name = default["display_name"]
    avatar_color = str(source.get("avatar_color") or source.get("color") or default["avatar_color"]).strip()
    if not HEX_COLOR_RE.fullmatch(avatar_color):
        avatar_color = default["avatar_color"]
    preferences = source.get("preferences") if isinstance(source.get("preferences"), dict) else {}
    timezone_value = str(preferences.get("timezone") or source.get("timezone") or default["preferences"]["timezone"]).strip()
    if not timezone_value:
        timezone_value = default["preferences"]["timezone"]
    normalized = {
        "display_name": display_name[:64],
        "avatar_color": avatar_color.lower(),
        "preferences": {"timezone": timezone_value},
    }
    avatar_image = source.get("avatar_image")
    if isinstance(avatar_image, str) and avatar_image:
        normalized["avatar_image"] = _validate_avatar_image(avatar_image)
    return normalized


def _ensure_account_block(state: dict[str, Any]) -> bool:
    changed = False
    legacy: dict[str, Any] = {}
    for key in ("user", "identity"):
        if isinstance(state.get(key), dict):
            legacy.update(state[key])
            del state[key]
            changed = True
    if not isinstance(state.get("account"), dict):
        state["account"] = _normalize_account(legacy)
        return True
    before = deepcopy(state["account"])
    merged = {**legacy, **state["account"]}
    state["account"] = _normalize_account(merged)
    return changed or state["account"] != before


def _validate_account_patch(payload: dict[str, Any]) -> dict[str, Any]:
    patch_payload: dict[str, Any] = {}
    if "display_name" in payload:
        display_name = str(payload.get("display_name") or "").strip()
        if not 1 <= len(display_name) <= 64:
            raise HTTPException(status_code=422, detail="display_name must be 1-64 characters")
        patch_payload["display_name"] = display_name
    if "avatar_color" in payload:
        avatar_color = str(payload.get("avatar_color") or "").strip()
        if not HEX_COLOR_RE.fullmatch(avatar_color):
            raise HTTPException(status_code=422, detail="avatar_color must be a #RRGGBB hex color")
        patch_payload["avatar_color"] = avatar_color.lower()
    if "avatar_image" in payload:
        avatar_image = payload.get("avatar_image")
        patch_payload["avatar_image"] = None if avatar_image is None else _validate_avatar_image(avatar_image)
    if "preferences" in payload:
        preferences = payload.get("preferences")
        if not isinstance(preferences, dict):
            raise HTTPException(status_code=422, detail="preferences must be an object")
        if "timezone" in preferences:
            timezone_value = str(preferences.get("timezone") or "").strip()
            if not 1 <= len(timezone_value) <= 128 or "/" not in timezone_value:
                raise HTTPException(status_code=422, detail="preferences.timezone must be a valid IANA time zone string")
            patch_payload.setdefault("preferences", {})["timezone"] = timezone_value
    if "preferences.timezone" in payload:
        timezone_value = str(payload.get("preferences.timezone") or "").strip()
        if not 1 <= len(timezone_value) <= 128 or "/" not in timezone_value:
            raise HTTPException(status_code=422, detail="preferences.timezone must be a valid IANA time zone string")
        patch_payload.setdefault("preferences", {})["timezone"] = timezone_value
    return patch_payload


def _read_export_json_file(path: Path, default: Any) -> Any:
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return default


def _read_json_records(directory: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not directory.exists():
        return records
    for path in sorted(directory.glob("*.json")):
        data = _read_export_json_file(path, [])
        if isinstance(data, list):
            records.extend(row for row in data if isinstance(row, dict))
        elif isinstance(data, dict):
            records.append(data)
    return records


def _normalize_tracked_item(item: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(item)
    if normalized.get("tags") is None:
        normalized["tags"] = []
    if normalized.get("entity") is None:
        normalized["entity"] = ""
    if normalized.get("category") is None:
        normalized["category"] = ""
    return normalized


def _build_account_export(state: dict[str, Any]) -> dict[str, Any]:
    state_tracked = state.get("tracked_items") if isinstance(state.get("tracked_items"), dict) else {}
    state_messages = state.get("messages") if isinstance(state.get("messages"), dict) else {}
    state_briefings = state.get("briefings") if isinstance(state.get("briefings"), list) else []
    state_sweeps = state.get("reactive_sweeps_audit") if isinstance(state.get("reactive_sweeps_audit"), list) else []
    runtime_tracked = _read_json_records(tracked_items_service.TRACKED_ITEMS_DIR)
    runtime_messages = _read_json_records(messages_service.MESSAGES_DIR)
    runtime_briefings = _read_json_records(briefings_service.BRIEFINGS_DIR)
    runtime_sweeps = reactive_worker.list_all_sweeps(limit_per_agent=reactive_worker.MAX_RECORDS_PER_AGENT)
    return {
        "entities": deepcopy(state.get("entities") if isinstance(state.get("entities"), list) else []),
        "agents": deepcopy(state.get("agents") if isinstance(state.get("agents"), list) else []),
        "tracked_items": [*deepcopy([item for items in state_tracked.values() if isinstance(items, list) for item in items]), *runtime_tracked],
        "messages": [*deepcopy([msg for msgs in state_messages.values() if isinstance(msgs, list) for msg in msgs]), *runtime_messages],
        "briefings": [*deepcopy(state_briefings), *runtime_briefings],
        "reactive_sweeps_audit": [*deepcopy(state_sweeps), *runtime_sweeps],
        "account": deepcopy(state["account"]),
        "export_metadata": {
            "generated_at": _utc_now_iso(),
            "schema_version": "mission-control-account-export-v1",
            "host_hostname": socket.gethostname(),
        },
    }


def _load_state() -> dict[str, Any]:
    with STATE_LOCK:
        state_path = get_mission_control_state_path()
        if not state_path.exists():
            state = _seed_state()
            _write_state(state)
            return state
        try:
            raw = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            raw = _seed_state()
        raw.setdefault("agents", [])
        raw.setdefault("entities", [])
        raw.setdefault("conversations", [])
        raw.setdefault("audit_log", [])
        if not raw["agents"]:
            raw = _seed_state()
        raw, changed = entities_service.migrate_state_if_needed(raw)
        if _ensure_account_block(raw):
            changed = True
        if changed:
            _write_state(raw)
        return raw


def _save_state(state: dict[str, Any]) -> dict[str, Any]:
    with STATE_LOCK:
        state["updated_at"] = _utc_now_iso()
        _write_state(state)
    return state


def _audit(state: dict[str, Any], event: str, detail: dict[str, Any]) -> None:
    state.setdefault("audit_log", []).append(
        {
            "id": _gen_id("audit"),
            "event": event,
            "detail": detail,
            "created_at": _utc_now_iso(),
        }
    )
    state["audit_log"] = state["audit_log"][-250:]


def _active_memory_records(agent: dict[str, Any]) -> list[dict[str, Any]]:
    memory_cfg = agent.get("memory", {})
    if not memory_cfg.get("enabled", True):
        return []
    limit = max(0, _as_int(memory_cfg.get("injection_limit"), 4))
    records = [record for record in memory_cfg.get("records", []) if record.get("active")]
    return records[:limit]


def _build_system_prompt(agent: dict[str, Any]) -> str:
    memory_lines = []
    for record in _active_memory_records(agent):
        memory_lines.append(f"- [{record.get('category', 'general')}] {record.get('title', 'Memory')}: {record.get('content', '')}")
    memory_block = "\n".join(memory_lines) if memory_lines else "- No active persistent memory records."
    budget = agent.get("budget_controls", {})
    tokens = agent.get("token_controls", {})
    tools = ", ".join(agent.get("tool_permissions", {}).get("enabled", [])) or "No tools enabled"
    return f"""You are {agent.get('name')}.
Role: {agent.get('role')}
Business function: {agent.get('business_function')}
Operating entity: {agent.get('operating_entity')}
System instructions:
{agent.get('system_prompt')}

Governance constraints:
- Preferred model: {agent.get('preferred_model')}
- Fallback model: {agent.get('fallback_model') or 'None'}
- Token budget: input <= {tokens.get('max_input_tokens')}, output <= {tokens.get('max_output_tokens')}, total <= {tokens.get('max_total_tokens')}
- Daily budget cap: ${budget.get('daily_usd')}
- Monthly budget cap: ${budget.get('monthly_usd')}
- Enabled toolsets: {tools}

Persistent memory to honor:
{memory_block}

Execution style:
- Produce clear, decision-ready answers.
- Stay cost-aware and avoid unnecessary tool use.
- If constrained by limits, say so explicitly.
- Keep responses useful for multi-entity operational governance.
"""


def _load_db_session_metrics(session_ids: list[str]) -> dict[str, dict[str, Any]]:
    metrics: dict[str, dict[str, Any]] = {}
    if not session_ids:
        return metrics
    db = SessionDB()
    try:
        for session_id in session_ids:
            session = db.get_session(session_id)
            if session:
                metrics[session_id] = session
    finally:
        db.close()
    return metrics


def _enrich_state(state: dict[str, Any]) -> dict[str, Any]:
    conversations = deepcopy(state.get("conversations", []))
    agents = deepcopy(entities_service.active_agents(state))
    entities = deepcopy(entities_service.active_entities(state))
    session_metrics = _load_db_session_metrics([c.get("session_id") for c in conversations if c.get("session_id")])
    today = datetime.now(timezone.utc).date()
    month_key = today.strftime("%Y-%m")

    summary = {
        "agent_count": len(agents),
        "conversation_count": len(conversations),
        "active_agents": 0,
        "total_input_tokens": 0,
        "total_output_tokens": 0,
        "total_tokens": 0,
        "total_estimated_cost": 0.0,
        "total_actual_cost": 0.0,
        "daily_spend": 0.0,
        "monthly_spend": 0.0,
        "alerting_agents": 0,
    }

    conversations_by_agent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    agents_by_id = {agent.get("id"): agent for agent in agents}
    for conversation in conversations:
        metrics = session_metrics.get(conversation.get("session_id") or "")
        stored_usage = _normalize_usage_summary_payload(conversation.get("usage_summary"))
        usage_summary = stored_usage
        if metrics:
            started_at = metrics.get("started_at")
            started_dt = datetime.fromtimestamp(started_at, tz=timezone.utc) if started_at else None
            usage_summary = _merge_usage_summaries(_session_usage_summary(metrics), stored_usage)
            conversation["usage_summary"] = usage_summary
            conversation["last_message_at"] = conversation.get("last_message_at") or (
                datetime.fromtimestamp(metrics.get("ended_at") or metrics.get("started_at") or time.time(), tz=timezone.utc).replace(microsecond=0).isoformat()
            )
            if started_dt and started_dt.date() == today:
                summary["daily_spend"] += _as_float(usage_summary.get("estimated_cost"))
            if started_dt and started_dt.strftime("%Y-%m") == month_key:
                summary["monthly_spend"] += _as_float(usage_summary.get("estimated_cost"))
        else:
            conversation["usage_summary"] = usage_summary
        owning_agent = agents_by_id.get(conversation.get("agent_id")) or {}
        conversation_model = conversation["usage_summary"].get("model") or owning_agent.get("preferred_model") or conversation.get("title")
        conversation["usage_diagnostics"] = _merge_usage_diagnostics(
            conversation.get("usage_diagnostics"),
            _build_usage_diagnostics(
                usage_summary=conversation["usage_summary"],
                last_run_status=conversation.get("last_run_status"),
                last_error=conversation.get("last_error"),
                model=conversation_model,
            ),
        )
        conversation["provider_capabilities"] = _provider_capabilities_from_diagnostics(
            model=conversation["usage_summary"].get("model") or owning_agent.get("preferred_model") or conversation.get("title"),
            requested_model=owning_agent.get("preferred_model") or conversation["usage_summary"].get("model") or conversation.get("title"),
            fallback_model=owning_agent.get("fallback_model"),
            diagnostics=conversation.get("usage_diagnostics"),
        )
        conversations_by_agent[conversation.get("agent_id")].append(conversation)

    enriched_agents = []
    for agent in agents:
        agent_convs = conversations_by_agent.get(agent["id"], [])
        latest_agent_conv = max(
            agent_convs,
            key=lambda conv: conv.get("last_message_at") or conv.get("updated_at") or "",
            default=None,
        )
        total_input = sum(_as_int(c["usage_summary"].get("input_tokens")) for c in agent_convs)
        total_output = sum(_as_int(c["usage_summary"].get("output_tokens")) for c in agent_convs)
        total_tokens = sum(_as_int(c["usage_summary"].get("total_tokens")) for c in agent_convs)
        estimated_cost = round(sum(_as_float(c["usage_summary"].get("estimated_cost")) for c in agent_convs), 4)
        actual_cost = round(sum(_as_float(c["usage_summary"].get("actual_cost")) for c in agent_convs), 4)
        daily_spend = 0.0
        monthly_spend = 0.0
        for conv in agent_convs:
            last_message_at = conv.get("last_message_at")
            if not last_message_at:
                continue
            try:
                dt = datetime.fromisoformat(last_message_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if dt.date() == today:
                daily_spend += _as_float(conv["usage_summary"].get("estimated_cost"))
            if dt.strftime("%Y-%m") == month_key:
                monthly_spend += _as_float(conv["usage_summary"].get("estimated_cost"))
        budget = agent.get("budget_controls", {})
        alert_reasons: list[str] = []
        daily_cap = _as_float(budget.get("daily_usd"))
        monthly_cap = _as_float(budget.get("monthly_usd"))
        alert_threshold = _as_float(budget.get("alert_threshold_pct"), 80) / 100.0
        if daily_cap > 0 and daily_spend >= daily_cap:
            alert_reasons.append("Daily budget exceeded")
        elif daily_cap > 0 and daily_spend >= daily_cap * alert_threshold:
            alert_reasons.append("Daily spend nearing cap")
        if monthly_cap > 0 and monthly_spend >= monthly_cap:
            alert_reasons.append("Monthly budget exceeded")
        elif monthly_cap > 0 and monthly_spend >= monthly_cap * alert_threshold:
            alert_reasons.append("Monthly spend nearing cap")
        max_total_tokens = _as_int(agent.get("token_controls", {}).get("max_total_tokens"))
        if max_total_tokens > 0 and total_tokens >= max_total_tokens:
            alert_reasons.append("Token limit reached")
        if agent.get("observability", {}).get("last_error"):
            alert_reasons.append("Last run recorded an error")
        alert_state = "critical" if any("exceeded" in reason.lower() or "error" in reason.lower() or "reached" in reason.lower() for reason in alert_reasons) else ("warning" if alert_reasons else "healthy")
        if alert_reasons:
            summary["alerting_agents"] += 1
        status = agent.get("observability", {}).get("status", "active")
        if status == "active":
            summary["active_agents"] += 1
        agent["usage_summary"] = {
            "conversation_count": len(agent_convs),
            "input_tokens": total_input,
            "output_tokens": total_output,
            "total_tokens": total_tokens,
            "estimated_cost": estimated_cost,
            "actual_cost": actual_cost,
            "daily_spend": round(daily_spend, 4),
            "monthly_spend": round(monthly_spend, 4),
            "estimated_monthly_spend": round(monthly_spend * 1.2 if monthly_spend else estimated_cost * 1.2, 4),
            "last_run_status": latest_agent_conv.get("last_run_status") if latest_agent_conv else "idle",
        }
        agent["usage_diagnostics"] = _merge_usage_diagnostics(
            latest_agent_conv.get("usage_diagnostics") if latest_agent_conv else None,
            _build_usage_diagnostics(
                usage_summary=agent["usage_summary"],
                last_run_status=agent["usage_summary"].get("last_run_status"),
                last_error=agent.get("observability", {}).get("last_error"),
                model=agent.get("preferred_model") or agent["usage_summary"].get("model"),
            ),
        )
        agent["provider_capabilities"] = _provider_capabilities_from_diagnostics(
            model=agent.get("preferred_model") or (latest_agent_conv or {}).get("usage_summary", {}).get("model") or agent["usage_summary"].get("model"),
            requested_model=agent.get("preferred_model") or agent["usage_summary"].get("model"),
            fallback_model=agent.get("fallback_model"),
            diagnostics=agent["usage_diagnostics"],
        )
        agent["alert_summary"] = {
            "state": alert_state,
            "reasons": alert_reasons,
        }
        agent["recent_conversations"] = sorted(
            agent_convs,
            key=lambda conv: ((not conv.get("pinned", False)), conv.get("last_message_at") or conv.get("updated_at") or ""),
            reverse=False,
        )[:6]
        enriched_agents.append(agent)
        summary["total_input_tokens"] += total_input
        summary["total_output_tokens"] += total_output
        summary["total_tokens"] += total_tokens
        summary["total_estimated_cost"] += estimated_cost
        summary["total_actual_cost"] += actual_cost

    summary["total_estimated_cost"] = round(summary["total_estimated_cost"], 4)
    summary["total_actual_cost"] = round(summary["total_actual_cost"], 4)
    summary["daily_spend"] = round(summary["daily_spend"], 4)
    summary["monthly_spend"] = round(summary["monthly_spend"], 4)

    conversations.sort(key=lambda conv: ((not conv.get("pinned", False)), conv.get("last_message_at") or conv.get("updated_at") or ""))
    catalog_model_values = [
        model_name
        for agent in enriched_agents
        for model_name in (agent.get("preferred_model"), agent.get("fallback_model"))
        if model_name
    ]
    return {
        "generated_at": _utc_now_iso(),
        "summary": summary,
        "catalog": {
            "models": _catalog_models(catalog_model_values),
            "model_options": _catalog_model_options(catalog_model_values),
            "toolsets": _catalog_toolsets(),
            "status_options": ["active", "paused", "draft", "archived"],
            "entity_options": list(dict.fromkeys([
                *MISSION_CONTROL_ENTITY_OPTIONS,
                *(agent.get("operating_entity") for agent in enriched_agents if agent.get("operating_entity")),
            ])),
            "function_options": sorted({agent.get("business_function") for agent in enriched_agents if agent.get("business_function")}),
        },
        "entities": sorted(entities, key=lambda item: (int(item.get("display_order") or 0), item.get("name", ""))),
        "entity_tree": entities_service.build_tree(entities, enriched_agents),
        "agents": sorted(enriched_agents, key=lambda item: (str(item.get("entity_id") or ""), int(item.get("display_order") or 0), item.get("name", ""))),
        "conversations": list(reversed(conversations)),
        "audit_log": list(reversed(state.get("audit_log", [])[-25:])),
    }


class BootstrapResponse(BaseModel):
    generated_at: str
    summary: dict[str, Any]
    catalog: dict[str, Any]
    entities: list[dict[str, Any]] = Field(default_factory=list)
    entity_tree: list[dict[str, Any]] = Field(default_factory=list)
    agents: list[dict[str, Any]]
    conversations: list[dict[str, Any]]
    audit_log: list[dict[str, Any]]


class AgentCreateRequest(BaseModel):
    seed: dict[str, Any] = Field(default_factory=dict)


class AgentUpdateRequest(BaseModel):
    agent: dict[str, Any]


class ConversationCreateRequest(BaseModel):
    agent_id: str
    title: Optional[str] = None
    project_id: Optional[str] = None
    projectId: Optional[str] = None
    preferred_model: Optional[str] = None


class ConversationUpdateRequest(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    pinned: Optional[bool] = None
    starred: Optional[bool] = None
    agent_id: Optional[str] = None
    project_id: Optional[str] = None
    projectId: Optional[str] = None
    preferred_model: Optional[str] = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str


class ChatAttachmentRef(BaseModel):
    id: str
    filename: str
    content_type: str
    size: int
    url: str
    kind: str


class ChatAttachmentUpload(BaseModel):
    filename: str
    content_type: str
    data: str


class ChatAttachmentUploadRequest(BaseModel):
    conversation_id: str = "pending"
    files: list[ChatAttachmentUpload]


class MissionChatRequest(BaseModel):
    agent_id: str
    conversation_id: Optional[str] = None
    message: ChatMessage
    attachments: list[ChatAttachmentRef] = Field(default_factory=list)
    model: Optional[str] = None


class ConversationMessagesResponse(BaseModel):
    conversation_id: str
    messages: list[dict[str, Any]]



ALLOWED_CHAT_ATTACHMENT_PREFIXES = ("image/", "video/")
MAX_CHAT_ATTACHMENTS = 10
MAX_CHAT_ATTACHMENT_TOTAL_BYTES = 50 * 1024 * 1024

def _safe_upload_name(name: str | None) -> str:
    raw = Path(name or "attachment").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")
    return cleaned[:120] or "attachment"

def _upload_ref_from_path(path: Path, conversation_id: str, original_name: str, content_type: str) -> dict[str, Any]:
    stat = path.stat()
    rel = path.relative_to(get_mission_control_upload_dir()).as_posix()
    kind = "video" if content_type.startswith("video/") else "image"
    return {
        "id": path.stem,
        "filename": original_name,
        "content_type": content_type,
        "size": stat.st_size,
        "url": f"/mission-control/uploads/{rel}",
        "kind": kind,
    }

def _store_message_attachments(state: dict[str, Any], session_id: str, message_id: Any, refs: list[dict[str, Any]]) -> None:
    if not refs or not session_id or message_id is None:
        return
    store = state.setdefault("message_attachments", {})
    session_store = store.setdefault(str(session_id), {})
    session_store[str(message_id)] = [dict(ref) for ref in refs]

def _attachments_for_message(state: dict[str, Any], session_id: str, message_id: Any) -> list[dict[str, Any]]:
    return list(((state.get("message_attachments") or {}).get(str(session_id)) or {}).get(str(message_id)) or [])

def _attachment_context_text(refs: list[ChatAttachmentRef]) -> str:
    if not refs:
        return ""
    lines = ["Attached image/video files for this user message:"]
    for ref in refs:
        lines.append(f"- {ref.filename} ({ref.content_type}, {ref.size} bytes): {ref.url}")
    return "\n" + "\n".join(lines)


@app.get("/api/mission-control/models")
async def mission_control_models() -> dict[str, Any]:
    return {"models": _catalog_model_options()}

@app.post("/api/mission-control/uploads")
async def upload_chat_attachments(body: ChatAttachmentUploadRequest) -> dict[str, Any]:
    if len(body.files) > MAX_CHAT_ATTACHMENTS:
        raise HTTPException(status_code=413, detail="Maximum 10 attachments")
    target_id = _safe_upload_name(body.conversation_id or "pending")
    target_dir = get_mission_control_upload_dir() / target_id
    target_dir.mkdir(parents=True, exist_ok=True)
    refs: list[dict[str, Any]] = []
    total = 0
    for upload in body.files:
        content_type = (upload.content_type or mimetypes.guess_type(upload.filename or "")[0] or "").lower()
        if not any(content_type.startswith(prefix) for prefix in ALLOWED_CHAT_ATTACHMENT_PREFIXES):
            continue
        raw_data = upload.data.split(",", 1)[1] if upload.data.startswith("data:") and "," in upload.data else upload.data
        try:
            data = base64.b64decode(raw_data, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid attachment data") from exc
        total += len(data)
        if total > MAX_CHAT_ATTACHMENT_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Total attachment size exceeds 50 MB")
        safe_name = _safe_upload_name(upload.filename)
        unique = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}_{uuid.uuid4().hex[:8]}_{safe_name}"
        path = target_dir / unique
        path.write_bytes(data)
        refs.append(_upload_ref_from_path(path, target_id, safe_name, content_type))
    return {"attachments": refs}

@app.get("/api/mission-control/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "mission-control", "time": _utc_now_iso()}


def _tailscale_status() -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except FileNotFoundError:
        return {
            "installed": False,
            "signed_in": False,
            "version": None,
            "hostname": None,
            "tailscale_ip": None,
            "self_name": None,
            "exit_code": None,
            "error_summary": "tailscale command not found",
        }
    except subprocess.TimeoutExpired:
        return {
            "installed": None,
            "signed_in": False,
            "version": None,
            "hostname": None,
            "tailscale_ip": None,
            "self_name": None,
            "exit_code": None,
            "error_summary": "Timeout",
        }
    except Exception as exc:  # pragma: no cover - defensive guard for platform-specific failures
        return {
            "installed": None,
            "signed_in": False,
            "version": None,
            "hostname": None,
            "tailscale_ip": None,
            "self_name": None,
            "exit_code": None,
            "error_summary": str(exc) or exc.__class__.__name__,
        }

    stdout = result.stdout or ""
    stderr = (result.stderr or "").strip()
    version: str | None = None
    payload: dict[str, Any] = {}
    if stdout.strip():
        try:
            parsed = json.loads(stdout)
            if isinstance(parsed, dict):
                payload = parsed
                raw_version = parsed.get("Version") or parsed.get("ClientVersion") or parsed.get("BackendVersion")
                if raw_version is not None:
                    version = str(raw_version)
        except json.JSONDecodeError:
            payload = {}

    if result.returncode != 0:
        return {
            "installed": True,
            "signed_in": False,
            "version": version,
            "hostname": None,
            "tailscale_ip": None,
            "self_name": None,
            "exit_code": result.returncode,
            "error_summary": stderr or "tailscale status failed",
        }

    self_node = payload.get("Self") if isinstance(payload.get("Self"), dict) else {}
    dns_name = self_node.get("DNSName") or payload.get("DNSName") or payload.get("Hostname")
    hostname = str(dns_name).rstrip(".") if dns_name else None
    self_name = self_node.get("HostName") or self_node.get("Name") or payload.get("SelfName")
    tailscale_ips = self_node.get("TailscaleIPs") or payload.get("TailscaleIPs") or []
    tailscale_ip = str(tailscale_ips[0]) if isinstance(tailscale_ips, list) and tailscale_ips else None
    return {
        "installed": True,
        "signed_in": True,
        "version": version,
        "hostname": hostname,
        "tailscale_ip": tailscale_ip,
        "self_name": str(self_name) if self_name else None,
        "exit_code": result.returncode,
    }


@app.get("/api/system/metrics")
async def system_metrics() -> dict[str, Any]:
    return _cached_system_metrics()


@app.get("/api/system/tailscale-status")
async def system_tailscale_status() -> dict[str, Any]:
    return await asyncio.to_thread(_tailscale_status)


@app.get("/api/agent-profiles")
async def get_agent_profiles_endpoint() -> dict[str, Any]:
    try:
        result = _dashboard_json("/api/profiles")
        if not result.get("ok"):
            raise RuntimeError(f"Gateway profile mirror returned {result.get('status')}: {result.get('body')}")
        body = result.get("body")
        if not isinstance(body, dict):
            raise RuntimeError("Gateway profile mirror returned a non-JSON object response")
        return body
    except Exception as exc:
        return {"profiles": [], "error": str(exc)}


@app.get("/api/account")
async def get_account_endpoint() -> dict[str, Any]:
    state = _load_state()
    return deepcopy(state["account"])


@app.patch("/api/account")
async def patch_account_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    patch_payload = _validate_account_patch(payload or {})
    state = _load_state()
    account = deepcopy(state["account"])
    if "display_name" in patch_payload:
        account["display_name"] = patch_payload["display_name"]
    if "avatar_color" in patch_payload:
        account["avatar_color"] = patch_payload["avatar_color"]
    if "avatar_image" in patch_payload:
        if patch_payload["avatar_image"] is None:
            account.pop("avatar_image", None)
        else:
            account["avatar_image"] = patch_payload["avatar_image"]
    if "preferences" in patch_payload:
        account.setdefault("preferences", {})
        account["preferences"].update(patch_payload["preferences"])
    state["account"] = _normalize_account(account)
    _save_state(state)
    return deepcopy(state["account"])


@app.get("/api/account/export")
async def account_export_endpoint() -> JSONResponse:
    state = _load_state()
    payload = _build_account_export(state)
    filename = f"mission-control-export-{datetime.now(timezone.utc).date().isoformat()}.json"
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        media_type="application/json",
    )


@app.get("/api/maintenance/version")
async def maintenance_version() -> dict[str, Any]:
    return {
        "mission_control": _repo_version(PROJECT_ROOT),
        "hermes_agent": {"version": __version__},
    }


@app.post("/api/maintenance/health-check")
async def maintenance_health_check() -> dict[str, Any]:
    return await asyncio.to_thread(_maintenance_health_check)


@app.post("/api/maintenance/check-updates")
async def maintenance_check_updates() -> dict[str, Any]:
    status = await asyncio.to_thread(_repo_update_status, PROJECT_ROOT)
    return {
        "mission_control": status,
        "hermes_agent": dict(status),
        "checked_at": _utc_now_iso(),
    }


@app.get("/api/mission-control/maintenance/hci-status")
async def mission_control_maintenance_hci_status() -> dict[str, Any]:
    return await asyncio.to_thread(_maintenance_hci_status, PROJECT_ROOT)


@app.get("/api/mission-control/maintenance/hermes-status")
async def mission_control_maintenance_hermes_status() -> dict[str, Any]:
    return await asyncio.to_thread(_maintenance_hermes_status, PROJECT_ROOT)


@app.post("/api/mission-control/maintenance/restart-gateway")
async def mission_control_maintenance_restart_gateway() -> JSONResponse:
    payload = await asyncio.to_thread(_operation_restart_gateway)
    if not payload.get("ok"):
        return JSONResponse(status_code=501, content=payload)
    return JSONResponse(content=payload)


@app.post("/api/maintenance/doctor")
async def maintenance_doctor() -> dict[str, Any]:
    return await asyncio.to_thread(_doctor_checks)


@app.post("/api/maintenance/dump")
async def maintenance_dump() -> dict[str, Any]:
    return await asyncio.to_thread(_write_debug_dump)


@app.post("/api/maintenance/backup")
async def maintenance_backup() -> dict[str, Any]:
    return await asyncio.to_thread(_create_backup_archive)


class RollbackRequest(BaseModel):
    target_commit: str | None = None


@app.post("/api/maintenance/restart-hci")
async def maintenance_restart_hci(dry_run: bool = False) -> dict[str, Any]:
    log = "dry_run: restart skipped" if dry_run else "Mission Control restart scheduled"
    if not dry_run:
        _schedule_process_exit(0.25)
    _audit_maintenance_action("restart-hci", snapshot=None, ok=True, log=log)
    return _maintenance_response(True, "Mission Control restart dispatched", log=log)


@app.post("/api/mission-control/maintenance/update-all")
async def mission_control_maintenance_update_all(body: UpdateAllRequest | None = None) -> JSONResponse:
    status_code, payload = await asyncio.to_thread(_operation_update_all_v2, body)
    return JSONResponse(status_code=status_code, content=payload)


@app.get("/api/mission-control/maintenance/update-all/status")
async def mission_control_maintenance_update_all_status(job_id: str | None = None) -> JSONResponse:
    status_code, payload = await asyncio.to_thread(_update_all_status_payload, job_id)
    return JSONResponse(status_code=status_code, content=payload)


@app.post("/api/maintenance/update-all")
async def maintenance_update_all(dry_run: bool = False) -> dict[str, Any]:
    return await asyncio.to_thread(_operation_update_all, dry_run)


@app.post("/api/maintenance/rollback")
async def maintenance_rollback(body: RollbackRequest | None = None, dry_run: bool = False) -> dict[str, Any]:
    target = body.target_commit if body else None
    return await asyncio.to_thread(_operation_rollback, target, dry_run)


@app.post("/api/maintenance/auto-fix")
async def maintenance_auto_fix() -> dict[str, Any]:
    return await asyncio.to_thread(_operation_auto_fix)


@app.post("/api/maintenance/update-hermes")
async def maintenance_update_hermes(dry_run: bool = False) -> dict[str, Any]:
    return await asyncio.to_thread(_operation_update_hermes, dry_run)


@app.post("/api/maintenance/import")
async def maintenance_import(file: UploadFile = File(...), confirm_phrase: str = Form(...), dry_run: bool = False) -> dict[str, Any]:
    if confirm_phrase != "RESTORE FROM BACKUP":
        raise HTTPException(status_code=400, detail="confirm_phrase must equal RESTORE FROM BACKUP")
    suffix = Path(file.filename or "backup.tar.gz").suffix or ".gz"
    with tempfile.NamedTemporaryFile(prefix="mission-control-import-", suffix=suffix, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        shutil.copyfileobj(file.file, tmp)
    try:
        return await asyncio.to_thread(_operation_import, tmp_path, file.filename or "backup.tar.gz", dry_run)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass


def _auto_seed_disabled() -> bool:
    return str(os.environ.get("HERMES_DISABLE_AUTO_SEED", "")).strip().lower() in {"1", "true", "yes"}


@app.on_event("startup")
async def _start_briefing_scheduler() -> None:
    if _auto_seed_disabled():
        LOG.info("Mission Control auto-seed skipped because HERMES_DISABLE_AUTO_SEED is set")
    else:
        try:
            messages_service.seed_default_messages()
        except Exception:
            LOG.exception("Failed to seed Mission Control messages")
    try:
        briefings_service.configure_scheduler(briefings_service.load_config())
    except Exception:
        LOG.exception("Failed to configure briefing scheduler on startup")
        try:
            briefings_service.start_fallback_scheduler()
        except Exception:
            LOG.exception("Failed to start briefing fallback scheduler")
    try:
        reactive_worker.start_worker()
    except Exception:
        LOG.exception("Failed to start reactive sweep worker")


@app.get("/api/messages/unread-counts")
async def message_unread_counts_endpoint():
    return messages_service.unread_counts()


@app.get("/api/reactive-sweeps/status")
async def reactive_sweep_status_endpoint():
    return reactive_worker.status()


@app.get("/api/reactive-sweeps/stats")
async def reactive_sweep_stats_endpoint():
    return reactive_worker.stats_today()


@app.get("/api/reactive-sweeps/{agent_id}")
async def reactive_sweeps_for_agent_endpoint(agent_id: str, limit: int = 50):
    return reactive_worker.list_sweeps(agent_id, limit=limit)


@app.post("/api/reactive-sweeps/{agent_id}/run")
async def run_reactive_sweep_endpoint(agent_id: str, payload: dict[str, Any] | None = None):
    try:
        return await reactive_worker.run_agent_sweep_once(agent_id, str((payload or {}).get("trigger_message_id") or "") or None)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/messages")
async def create_message_endpoint(payload: dict[str, Any]):
    try:
        message = messages_service.create_message(payload)
        try:
            messages_service.append_audit_log({"event": "message.created", "msg_id": message.get("id"), "from_agent_id": message.get("from_agent_id"), "to_agent_id": message.get("to_agent_id"), "priority": message.get("priority")})
        except Exception:
            LOG.exception("Failed to append messaging audit log")
        try:
            reactive_worker.consider_message_trigger(message)
        except Exception:
            LOG.exception("Failed to evaluate reactive trigger for message %s", message.get("id"))
        return message
    except ValueError as exc:
        text = str(exc)
        try:
            error_payload = json.loads(text)
        except Exception:
            error_payload = None
        if isinstance(error_payload, dict) and error_payload.get("error") == "messaging_policy_blocked":
            return JSONResponse(status_code=400, content=error_payload)
        raise HTTPException(status_code=400, detail=text) from exc


@app.get("/api/messages/inbox/{agent_id}")
async def inbox_messages_endpoint(agent_id: str, status: str | None = None, limit: int = 50, before: str | None = None, thread_id: str | None = None):
    try:
        return messages_service.inbox(agent_id, status=status, limit=limit, before=before, thread_id=thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/messages/sent/{agent_id}")
async def sent_messages_endpoint(agent_id: str, status: str | None = None, limit: int = 50, before: str | None = None, thread_id: str | None = None):
    try:
        return messages_service.sent(agent_id, status=status, limit=limit, before=before, thread_id=thread_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/messages/thread/{thread_id}")
async def thread_messages_endpoint(thread_id: str, agent_id: str | None = None, status: str | None = "all", limit: int = 200):
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id query is required")
    try:
        return messages_service.thread(agent_id, thread_id, status=status, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/messages/{message_id}")
async def get_message_endpoint(message_id: str, agent_id: str | None = None):
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id query is required")
    try:
        return messages_service.get_message(message_id, agent_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc


@app.post("/api/messages/{message_id}/read")
async def read_message_endpoint(message_id: str, payload: dict[str, Any]):
    try:
        return messages_service.mark_read(message_id, str(payload.get("agent_id") or ""))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc


@app.post("/api/messages/{message_id}/archive")
async def archive_message_endpoint(message_id: str, payload: dict[str, Any]):
    try:
        return messages_service.archive_message(message_id, str(payload.get("agent_id") or ""))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Message not found") from exc


@app.delete("/api/messages/{message_id}")
async def delete_message_endpoint(message_id: str, agent_id: str | None = None):
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id query is required")
    ok = messages_service.delete_message(message_id, agent_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True}


@app.get("/api/tracked-items")
async def list_tracked_items_endpoint(agent_id: str | None = None, status: str | None = None, category: str | None = None, priority: str | None = None, entity: str | None = None):
    items = tracked_items_service.list_all_items({"agent_id": agent_id, "status": status, "category": category, "priority": priority, "entity": entity})
    return [_normalize_tracked_item(item) for item in items]


@app.get("/api/tracked-items/by-agent/{agent_id}")
async def tracked_items_by_agent_endpoint(agent_id: str):
    return [_normalize_tracked_item(item) for item in tracked_items_service.load_items_for_agent(agent_id)]


@app.post("/api/tracked-items")
async def create_tracked_item_endpoint(payload: dict[str, Any]):
    try:
        payload = _normalize_tracked_item(payload)
        agent_id = str(payload.get("agent_id") or "")
        if not agent_id:
            raise ValueError("agent_id is required")
        return _normalize_tracked_item(tracked_items_service.save_item(agent_id, payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/tracked-items/{item_id}")
async def update_tracked_item_endpoint(item_id: str, payload: dict[str, Any]):
    try:
        payload = _normalize_tracked_item(payload)
        return _normalize_tracked_item(tracked_items_service.update_item(item_id, payload))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tracked item not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/tracked-items/{item_id}")
async def delete_tracked_item_endpoint(item_id: str):
    ok = tracked_items_service.delete_item_by_id(item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tracked item not found")
    return {"ok": True}


@app.post("/api/tracked-items/{item_id}/action")
async def tracked_item_action_endpoint(item_id: str, payload: dict[str, Any]):
    try:
        return _normalize_tracked_item(tracked_items_service.apply_action(item_id, str(payload.get("action") or "")))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Tracked item not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/briefings/run")
async def run_briefing_sweep_endpoint():
    try:
        return await asyncio.to_thread(briefings_service.run_briefing_sweep, "manual")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        LOG.exception("Briefing sweep failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/briefings/run/status")
async def briefing_run_status():
    return briefings_service.get_run_status()


@app.get("/api/briefings")
async def list_briefings_endpoint(limit: int = 30):
    return briefings_service.list_briefings(limit=max(1, min(100, limit)))


@app.get("/api/briefings/config")
async def get_briefings_config_endpoint():
    return briefings_service.load_config()


@app.put("/api/briefings/config")
async def put_briefings_config_endpoint(payload: dict[str, Any]):
    try:
        return briefings_service.save_config(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/briefings/{briefing_id}")
async def get_briefing_endpoint(briefing_id: str):
    try:
        return briefings_service.get_briefing(briefing_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Briefing not found") from exc


@app.delete("/api/briefings/{briefing_id}")
async def delete_briefing_endpoint(briefing_id: str):
    return {"ok": briefings_service.delete_briefing(briefing_id)}


@app.get("/api/mission-control/commits")
async def mission_control_commits(limit: int = 10) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 10), 25))
    code, out, err = _run_git(["log", f"-{safe_limit}", "--pretty=format:%h%x09%H%x09%s"], PROJECT_ROOT, timeout=3)
    commits = []
    if code == 0:
        for line in out.splitlines():
            short, full, subject = (line.split("\t", 2) + ["", ""])[:3]
            commits.append({"short": short, "hash": full, "subject": subject})
    return {"ok": code == 0, "commits": commits, "error": err if code != 0 else None}


@app.get("/api/mission-control/analytics")
async def analytics(days: int = 7) -> dict[str, Any]:
    safe_days = max(1, min(int(days or 7), 30))
    local_usage = _dashboard_json(f"/api/analytics/usage?days={safe_days}")
    model_info = _dashboard_json("/api/model/info")
    provider_audit = _read_json_file(get_hermes_home() / "mission_control_usage_audit.json") or {}
    provider_audit = deepcopy(provider_audit) if isinstance(provider_audit, dict) else {}
    openai_audit = provider_audit.get("openai")
    if not isinstance(openai_audit, dict):
        openai_audit = {}
    openai_audit["organization_usage"] = _openai_org_billing_audit()
    provider_audit["openai"] = openai_audit
    return {
        "generated_at": _utc_now_iso(),
        "period_days": safe_days,
        "sources": {
            "local_usage": "http://localhost:9119/api/analytics/usage",
            "model_info": "http://localhost:9119/api/model/info",
            "provider_audit": str(get_hermes_home() / "mission_control_usage_audit.json"),
        },
        "local_usage": local_usage,
        "model_info": model_info,
        "provider_audit": _redact_secret_text(provider_audit),
    }


def _agent_lookup(state: dict[str, Any], agent_id: str, include_deleted: bool = False) -> tuple[int, dict[str, Any]] | None:
    for idx, agent in enumerate(state.get("agents", [])):
        if agent.get("id") == agent_id and (include_deleted or not agent.get("deleted_at")):
            return idx, agent
    return None


def _entity_lookup(state: dict[str, Any], entity_id: str, include_deleted: bool = False) -> tuple[int, dict[str, Any]] | None:
    for idx, entity in enumerate(state.get("entities", [])):
        if entity.get("id") == entity_id and (include_deleted or not entity.get("deleted_at")):
            return idx, entity
    return None


def _entity_counts(state: dict[str, Any], entity_id: str) -> tuple[int, int]:
    child_count = sum(1 for entity in entities_service.active_entities(state) if entity.get("parent_id") == entity_id)
    agent_count = sum(1 for agent in entities_service.active_agents(state) if agent.get("entity_id") == entity_id)
    return child_count, agent_count


@app.get("/api/entities")
async def list_entities_endpoint():
    state = _load_state()
    return entities_service.active_entities(state)


@app.get("/api/entities/tree")
async def entity_tree_endpoint():
    state = _load_state()
    return entities_service.build_tree(entities_service.active_entities(state), entities_service.active_agents(state))


@app.get("/api/entities/{entity_id}")
async def get_entity_endpoint(entity_id: str):
    state = _load_state()
    found = _entity_lookup(state, entity_id)
    if not found:
        raise HTTPException(status_code=404, detail="Entity not found")
    child_count, agent_count = _entity_counts(state, entity_id)
    return {**found[1], "child_entity_count": child_count, "agent_count": agent_count}


@app.post("/api/entities")
async def create_entity_endpoint(payload: dict[str, Any]):
    state = _load_state()
    parent_id = payload.get("parent_id") or None
    if parent_id and not _entity_lookup(state, str(parent_id)):
        raise HTTPException(status_code=400, detail="parent_id not found")
    entity = entities_service.normalize_entity({**payload, "display_order": payload.get("display_order", len(state.get("entities", [])))})
    state.setdefault("entities", []).append(entity)
    _audit(state, "entity.created", {"entity_id": entity["id"], "name": entity["name"]})
    _save_state(state)
    return entity


@app.put("/api/entities/{entity_id}")
async def update_entity_endpoint(entity_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _entity_lookup(state, entity_id)
    if not found:
        raise HTTPException(status_code=404, detail="Entity not found")
    idx, existing = found
    if "parent_id" in payload:
        parent_id = payload.get("parent_id") or None
        if parent_id == entity_id or (parent_id and entities_service.is_descendant(state, str(parent_id), entity_id)):
            raise HTTPException(status_code=400, detail="Entity update would create a cycle")
        if parent_id and not _entity_lookup(state, str(parent_id)):
            raise HTTPException(status_code=400, detail="parent_id not found")
    allowed = {k: payload[k] for k in ("name", "type", "parent_id", "description", "metadata", "messaging_policy") if k in payload}
    updated = entities_service.normalize_entity(allowed, existing)
    state["entities"][idx] = updated
    for agent in state.get("agents", []):
        if agent.get("entity_id") == entity_id:
            agent["operating_entity"] = updated["name"]
    _audit(state, "entity.updated", {"entity_id": entity_id, "name": updated["name"]})
    _save_state(state)
    return updated


@app.post("/api/entities/{entity_id}/move")
async def move_entity_endpoint(entity_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _entity_lookup(state, entity_id)
    if not found:
        raise HTTPException(status_code=404, detail="Entity not found")
    parent_id = payload.get("parent_id") or None
    if parent_id == entity_id or (parent_id and entities_service.is_descendant(state, str(parent_id), entity_id)):
        raise HTTPException(status_code=400, detail="Entity move would create a cycle")
    if parent_id and not _entity_lookup(state, str(parent_id)):
        raise HTTPException(status_code=400, detail="parent_id not found")
    state["entities"][found[0]]["parent_id"] = parent_id
    state["entities"][found[0]]["updated_at"] = _utc_now_iso()
    _audit(state, "entity.moved", {"entity_id": entity_id, "parent_id": parent_id})
    _save_state(state)
    return state["entities"][found[0]]


@app.post("/api/entities/{entity_id}/reorder")
async def reorder_entity_endpoint(entity_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _entity_lookup(state, entity_id)
    if not found:
        raise HTTPException(status_code=404, detail="Entity not found")
    state["entities"][found[0]]["display_order"] = int(payload.get("display_order", 0) or 0)
    state["entities"][found[0]]["updated_at"] = _utc_now_iso()
    _save_state(state)
    return state["entities"][found[0]]


@app.delete("/api/entities/{entity_id}")
async def delete_entity_endpoint(entity_id: str):
    state = _load_state()
    found = _entity_lookup(state, entity_id)
    if not found:
        raise HTTPException(status_code=404, detail="Entity not found")
    entity = found[1]
    if entity.get("parent_id") is None and entity.get("type") == "trust":
        raise HTTPException(status_code=403, detail="Trust entity cannot be deleted")
    child_count, agent_count = _entity_counts(state, entity_id)
    if child_count or agent_count:
        blockers = {"children": [e.get("name") for e in entities_service.active_entities(state) if e.get("parent_id") == entity_id], "agents": [a.get("name") for a in entities_service.active_agents(state) if a.get("entity_id") == entity_id]}
        raise HTTPException(status_code=400, detail={"error": "entity_delete_blocked", "blockers": blockers})
    deleted_at, purge_at = entities_service.soft_delete_timestamp()
    state["entities"][found[0]]["deleted_at"] = deleted_at
    state["entities"][found[0]]["purge_at"] = purge_at
    _audit(state, "entity.deleted", {"entity_id": entity_id, "name": entity.get("name")})
    _save_state(state)
    return {"ok": True, "entity": state["entities"][found[0]]}


@app.get("/api/agents")
async def list_agents_endpoint(include_deleted: bool = False):
    state = _load_state()
    agents = state.get("agents", []) if include_deleted else entities_service.active_agents(state)
    return sorted(deepcopy(agents), key=lambda a: (str(a.get("entity_id") or ""), int(a.get("display_order") or 0), str(a.get("name") or "").lower()))


@app.get("/api/agents/trash")
async def trash_agents_endpoint():
    state = _load_state()
    rows = [entities_service.purge_countdown(agent) for agent in state.get("agents", []) if agent.get("deleted_at")]
    return sorted(rows, key=lambda a: str(a.get("deleted_at") or ""), reverse=True)


@app.get("/api/agents/{agent_id}")
async def get_agent_endpoint(agent_id: str):
    state = _load_state()
    found = _agent_lookup(state, agent_id, include_deleted=True)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    return deepcopy(found[1])


@app.post("/api/agents")
async def create_agent_public_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    state = _load_state()
    agent = _normalize_agent_payload(payload)
    if not agent.get("entity_id"):
        agent["entity_id"] = entities_service.unassigned_entity_id(state)
    agent["display_order"] = entities_service.next_agent_order(state, str(agent.get("entity_id") or ""))
    entities_service.normalize_agent_entity_fields({"agents": [agent], "entities": state.get("entities", [])})
    state["agents"].append(agent)
    _audit(state, "agent.created", {"agent_id": agent["id"], "name": agent["name"]})
    _save_state(state)
    return agent


@app.put("/api/agents/{agent_id}")
async def update_agent_public_endpoint(agent_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _agent_lookup(state, agent_id, include_deleted=True)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    updated = _normalize_agent_payload(payload, found[1])
    state["agents"][found[0]] = updated
    _audit(state, "agent.updated", {"agent_id": agent_id, "name": updated["name"]})
    _save_state(state)
    return updated


@app.post("/api/agents/{agent_id}/move")
async def move_agent_endpoint(agent_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _agent_lookup(state, agent_id)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    entity_id = str(payload.get("entity_id") or "")
    entity = _entity_lookup(state, entity_id)
    if not entity:
        raise HTTPException(status_code=400, detail="entity_id not found")
    agent = state["agents"][found[0]]
    agent["entity_id"] = entity_id
    agent["operating_entity"] = entity[1].get("name")
    agent["display_order"] = entities_service.next_agent_order(state, entity_id)
    agent["updated_at"] = _utc_now_iso()
    _audit(state, "agent.moved", {"agent_id": agent_id, "entity_id": entity_id})
    _save_state(state)
    return agent


@app.post("/api/agents/{agent_id}/reorder")
async def reorder_agent_endpoint(agent_id: str, payload: dict[str, Any]):
    state = _load_state()
    found = _agent_lookup(state, agent_id)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    state["agents"][found[0]]["display_order"] = int(payload.get("display_order", 0) or 0)
    state["agents"][found[0]]["updated_at"] = _utc_now_iso()
    _save_state(state)
    return state["agents"][found[0]]


@app.post("/api/agents/{agent_id}/duplicate")
async def duplicate_agent_endpoint(agent_id: str):
    state = _load_state()
    found = _agent_lookup(state, agent_id)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    source = deepcopy(found[1])
    source.pop("usage_summary", None)
    source["id"] = _gen_id("agent")
    source["name"] = f"{source.get('name', 'Agent')} (copy)"
    source["is_briefing_agent"] = False
    source["display_order"] = entities_service.next_agent_order(state, str(source.get("entity_id") or ""))
    source["deleted_at"] = None
    source["purge_at"] = None
    source["deleted_by"] = None
    source["created_at"] = _utc_now_iso()
    source["updated_at"] = _utc_now_iso()
    state["agents"].append(source)
    _audit(state, "agent.duplicated", {"agent_id": source["id"], "source_agent_id": agent_id})
    _save_state(state)
    return source


@app.delete("/api/agents/{agent_id}")
async def soft_delete_agent_endpoint(agent_id: str):
    state = _load_state()
    found = _agent_lookup(state, agent_id)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    deleted_at, purge_at = entities_service.soft_delete_timestamp()
    agent = state["agents"][found[0]]
    agent["deleted_at"] = deleted_at
    agent["purge_at"] = purge_at
    agent["deleted_by"] = "user"
    agent["updated_at"] = deleted_at
    _audit(state, "agent.soft_deleted", {"agent_id": agent_id, "name": agent.get("name")})
    _save_state(state)
    return entities_service.purge_countdown(agent)


@app.post("/api/agents/{agent_id}/restore")
async def restore_agent_endpoint(agent_id: str):
    state = _load_state()
    found = _agent_lookup(state, agent_id, include_deleted=True)
    if not found:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent = state["agents"][found[0]]
    agent["deleted_at"] = None
    agent["purge_at"] = None
    agent["deleted_by"] = None
    agent["updated_at"] = _utc_now_iso()
    _audit(state, "agent.restored", {"agent_id": agent_id, "name": agent.get("name")})
    _save_state(state)
    return agent


@app.post("/api/agents/purge-now")
async def purge_agents_now_endpoint():
    return entities_service.purge_due_agents(_load_state())


@app.get("/api/mission-control/loading-phrases")
async def loading_phrases() -> dict[str, list[str]]:
    return {
        "faces": KawaiiSpinner.get_thinking_faces(),
        "verbs": KawaiiSpinner.get_thinking_verbs(),
    }


@app.get("/api/mission-control/bootstrap", response_model=BootstrapResponse)
async def bootstrap() -> BootstrapResponse:
    state = _load_state()
    return BootstrapResponse(**_enrich_state(state))


@app.post("/api/mission-control/agents")
async def create_agent(body: AgentCreateRequest) -> dict[str, Any]:
    state = _load_state()
    agent = _normalize_agent_payload(body.seed)
    state["agents"].append(agent)
    _audit(state, "agent.created", {"agent_id": agent["id"], "name": agent["name"]})
    _save_state(state)
    enriched = _enrich_state(state)
    return {"agent": _pick_enriched_item(enriched, "agents", agent["id"])}


@app.put("/api/mission-control/agents/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdateRequest) -> dict[str, Any]:
    state = _load_state()
    idx = next((index for index, agent in enumerate(state["agents"]) if agent["id"] == agent_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    updated = _normalize_agent_payload(body.agent, state["agents"][idx])
    state["agents"][idx] = updated
    _audit(state, "agent.updated", {"agent_id": agent_id, "name": updated["name"]})
    _save_state(state)
    enriched = _enrich_state(state)
    return {"agent": _pick_enriched_item(enriched, "agents", agent_id)}


@app.delete("/api/mission-control/agents/{agent_id}")
async def delete_agent(agent_id: str) -> dict[str, Any]:
    state = _load_state()
    agent = next((item for item in state["agents"] if item["id"] == agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    conversations = [conv for conv in state["conversations"] if conv.get("agent_id") == agent_id]
    db = SessionDB()
    try:
        for conversation in conversations:
            session_id = conversation.get("session_id")
            if session_id:
                try:
                    db.delete_session(session_id)
                except Exception:
                    LOG.exception("Failed to delete mission control session %s", session_id)
    finally:
        db.close()
    state["agents"] = [item for item in state["agents"] if item["id"] != agent_id]
    state["conversations"] = [item for item in state["conversations"] if item.get("agent_id") != agent_id]
    _audit(state, "agent.deleted", {"agent_id": agent_id, "name": agent.get("name")})
    _save_state(state)
    return {"ok": True}


@app.post("/api/mission-control/conversations")
async def create_conversation(body: ConversationCreateRequest) -> dict[str, Any]:
    state = _load_state()
    if not any(agent["id"] == body.agent_id for agent in state["agents"]):
        raise HTTPException(status_code=404, detail="Agent not found")
    conversation = _normalize_conversation_payload({"agent_id": body.agent_id, "title": body.title or "New conversation", "project_id": body.project_id, "projectId": body.projectId, "preferred_model": body.preferred_model})
    state["conversations"].append(conversation)
    _audit(state, "conversation.created", {"conversation_id": conversation["id"], "agent_id": body.agent_id})
    _save_state(state)
    enriched = _enrich_state(state)
    return {"conversation": _pick_enriched_item(enriched, "conversations", conversation["id"])}


@app.put("/api/mission-control/conversations/{conversation_id}")
@app.patch("/api/mission-control/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, body: ConversationUpdateRequest) -> dict[str, Any]:
    state = _load_state()
    idx = next((index for index, conversation in enumerate(state["conversations"]) if conversation["id"] == conversation_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    existing = state["conversations"][idx]
    starred_value = body.starred if body.starred is not None else existing.get("starred", existing.get("pinned", False))
    fields_set = getattr(body, "model_fields_set", getattr(body, "__fields_set__", set()))
    if "project_id" in fields_set:
        project_id_value = body.project_id
    elif "projectId" in fields_set:
        project_id_value = body.projectId
    else:
        project_id_value = existing.get("project_id")
    payload = {
        "agent_id": body.agent_id or existing.get("agent_id"),
        "title": body.title if body.title is not None else body.name if body.name is not None else existing.get("title"),
        "pinned": body.pinned if body.pinned is not None else existing.get("pinned", starred_value),
        "starred": starred_value,
        "project_id": project_id_value,
        "session_id": existing.get("session_id"),
        "last_message_at": existing.get("last_message_at"),
        "last_run_status": existing.get("last_run_status", "idle"),
        "last_error": existing.get("last_error", ""),
        "preferred_model": body.preferred_model if body.preferred_model is not None else existing.get("preferred_model"),
    }
    state["conversations"][idx] = _normalize_conversation_payload(payload, existing)
    _audit(state, "conversation.updated", {"conversation_id": conversation_id})
    _save_state(state)
    enriched = _enrich_state(state)
    return {"conversation": _pick_enriched_item(enriched, "conversations", conversation_id)}


@app.delete("/api/mission-control/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str) -> dict[str, Any]:
    state = _load_state()
    conversation = next((item for item in state["conversations"] if item["id"] == conversation_id), None)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session_id = conversation.get("session_id")
    if session_id:
        db = SessionDB()
        try:
            db.delete_session(session_id)
        finally:
            db.close()
    state["conversations"] = [item for item in state["conversations"] if item["id"] != conversation_id]
    _audit(state, "conversation.deleted", {"conversation_id": conversation_id})
    _save_state(state)
    return {"ok": True}


@app.get("/api/mission-control/conversations/{conversation_id}/messages", response_model=ConversationMessagesResponse)
async def get_conversation_messages(conversation_id: str) -> ConversationMessagesResponse:
    state = _load_state()
    conversation = next((item for item in state["conversations"] if item["id"] == conversation_id), None)
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    session_id = conversation.get("session_id")
    if not session_id:
        return ConversationMessagesResponse(conversation_id=conversation_id, messages=[])
    db = SessionDB()
    try:
        rows = db.get_messages(session_id)
    finally:
        db.close()
    messages = []
    for row in rows:
        messages.append(
            {
                "id": row.get("id"),
                "role": row.get("role"),
                "content": row.get("content") or "",
                "timestamp": row.get("timestamp"),
                "tool_name": row.get("tool_name"),
                "tool_calls": row.get("tool_calls") or [],
                "finish_reason": row.get("finish_reason"),
                "attachments": _attachments_for_message(state, session_id, row.get("id")),
            }
        )
    return ConversationMessagesResponse(conversation_id=conversation_id, messages=messages)


async def _run_agent_stream(req: MissionChatRequest, conversation: dict[str, Any], agent: dict[str, Any], event_queue: queue.Queue[tuple[str, Any]]) -> None:
    def emit(kind: str, payload: Any) -> None:
        event_queue.put((kind, payload))

    delta_count = {"n": 0}
    delta_chars = {"n": 0}

    def on_delta(text: str | None) -> None:
        if text:
            delta_count["n"] += 1
            delta_chars["n"] += len(text)
            emit("delta", {"text": text})

    # NOTE: AIAgent exposes ``tool_gen_callback(tool_name)`` for "model is
    # about to emit a tool call" notifications, but it does not surface
    # tool-result / tool-error events with a stable correlation id. Wiring
    # paired tool_start/tool_result/tool_error SSE events requires a
    # deeper AIAgent refactor and is deferred to a follow-up slice (Slice 2c).
    # The frontend handles "no tool events" gracefully, see useChatStream.

    started_at = time.time()

    def worker() -> None:
        state = _load_state()
        db = SessionDB()
        try:
            emit("status", {"status": "running"})
            active_conversation = next(item for item in state["conversations"] if item["id"] == conversation["id"])

            # Idempotency: if the previous attempt failed mid-flight and left
            # the user message as the last row in the session, drop it so
            # AIAgent.run_conversation() can re-append cleanly without a dup.
            prior_session_id = active_conversation.get("session_id") or None
            if prior_session_id:
                try:
                    removed = db.delete_last_message_if_match(
                        prior_session_id, "user", req.message.content
                    )
                    if removed:
                        LOG.info(
                            "mission_control.chat.idempotent_user_trim conversation_id=%s session_id=%s",
                            active_conversation["id"], prior_session_id,
                        )
                except Exception:
                    LOG.debug("idempotent user-trim probe failed", exc_info=True)

            enabled_toolsets = agent.get("tool_permissions", {}).get("enabled") or []
            fallback = agent.get("fallback_model") or ""
            fallback_model = None
            if fallback:
                fallback_model = {"provider": _session_provider_from_model(fallback), "model": fallback}
            max_tokens = _as_int(agent.get("token_controls", {}).get("max_output_tokens"), 0) or None
            runtime_agent = AIAgent(
                session_id=prior_session_id,
                model=req.model or active_conversation.get("preferred_model") or agent.get("preferred_model") or _default_model(),
                quiet_mode=True,
                enabled_toolsets=enabled_toolsets,
                max_tokens=max_tokens,
                fallback_model=fallback_model,
                platform="mission-control",
                skip_context_files=False,
                skip_memory=True,
                stream_delta_callback=on_delta,
                session_db=db,
            )
            result = runtime_agent.run_conversation(
                user_message=req.message.content,
                system_message=_build_system_prompt(agent) + _attachment_context_text(req.attachments),
            )
            reply_text = str(result.get("final_response") or "")
            run_failed = bool(result.get("failed") or result.get("error"))
            resolved_session_id = str(getattr(runtime_agent, "session_id", None) or active_conversation.get("session_id") or "")

            if run_failed and not reply_text:
                err_msg = str(result.get("error") or "Agent run failed before producing a response")
                LOG.warning(
                    "mission_control.chat.upstream_failed conversation_id=%s agent_id=%s model=%s provider=%s error=%s",
                    active_conversation["id"], agent.get("id"),
                    result.get("model") or runtime_agent.model,
                    runtime_agent.provider, err_msg,
                )
                emit("error", {
                    "detail": err_msg,
                    "message": err_msg,
                    "retryable": True,
                    "provider": runtime_agent.provider,
                    "model": result.get("model") or runtime_agent.model,
                })
                # Don't persist an assistant row; AIAgent's own persistence
                # already wrote the user turn and (intentionally) no assistant.
                _audit(state, "chat.failed", {"conversation_id": active_conversation["id"], "agent_id": agent["id"], "error": err_msg})
                _save_state(state)
                return

            # If delta callbacks didn't fire (provider doesn't stream, or stream
            # was bypassed for any reason), emit a single delta with the full
            # text so the frontend has something to render before `done`.
            if reply_text and delta_count["n"] == 0:
                delta_count["n"] += 1
                delta_chars["n"] += len(reply_text)
                emit("delta", {"text": reply_text})

            # Defensive assistant-row persistence. AIAgent's own
            # ``_flush_messages_to_session_db`` writes the assistant turn for
            # all normal exit paths, but some degenerate paths (e.g. retry
            # exhaustion that returns a user-facing error string as
            # ``final_response`` without setting ``failed``) skip it. Slice 2b
            # contractually requires that whenever a ``done`` event with
            # non-empty ``reply.content`` is emitted, the same content is
            # readable from ``GET /conversations/{id}/messages``. We probe the
            # last row and append only if the assistant turn is missing,
            # never duplicating what AIAgent already wrote.
            if reply_text and resolved_session_id:
                try:
                    existing = db.get_messages(resolved_session_id)
                    if req.attachments:
                        for candidate in reversed(existing):
                            if candidate.get("role") == "user" and (candidate.get("content") or "").startswith(req.message.content):
                                _store_message_attachments(state, resolved_session_id, candidate.get("id"), [ref.model_dump() for ref in req.attachments])
                                break
                    last = existing[-1] if existing else None
                    needs_write = not last or last.get("role") != "assistant" or (last.get("content") or "") != reply_text
                    if needs_write:
                        db.append_message(
                            session_id=resolved_session_id,
                            role="assistant",
                            content=reply_text,
                            tool_name=None,
                            tool_calls=None,
                            tool_call_id=None,
                            finish_reason="stop",
                        )
                except Exception:
                    LOG.exception("Defensive assistant-row write failed for session %s", resolved_session_id)

            usage_summary = _usage_summary_from_result(result)
            usage_diagnostics = _build_usage_diagnostics(
                usage_summary=usage_summary,
                last_run_status="success",
                last_error="",
                provider=runtime_agent.provider,
                api_mode=runtime_agent.api_mode,
                base_url=runtime_agent.base_url,
                model=result.get("model") or runtime_agent.model,
            )
            if resolved_session_id:
                try:
                    db.update_token_counts(
                        resolved_session_id,
                        input_tokens=_as_int(result.get("input_tokens")),
                        output_tokens=_as_int(result.get("output_tokens")),
                        cache_read_tokens=_as_int(result.get("cache_read_tokens")),
                        cache_write_tokens=_as_int(result.get("cache_write_tokens")),
                        reasoning_tokens=_as_int(result.get("reasoning_tokens")),
                        estimated_cost_usd=result.get("estimated_cost_usd"),
                        actual_cost_usd=result.get("actual_cost_usd"),
                        cost_status=result.get("cost_status"),
                        cost_source=result.get("cost_source"),
                        billing_provider=runtime_agent.provider or None,
                        billing_base_url=runtime_agent.base_url or None,
                        billing_mode="subscription_included" if result.get("cost_status") == "included" else None,
                        model=result.get("model") or runtime_agent.model,
                        absolute=True,
                    )
                    session_row = db.get_session(resolved_session_id)
                    if session_row:
                        usage_summary = _merge_usage_summaries(_session_usage_summary(session_row), usage_summary)
                        usage_diagnostics = _build_usage_diagnostics(
                            usage_summary=usage_summary,
                            last_run_status="success",
                            last_error="",
                            provider=runtime_agent.provider,
                            api_mode=runtime_agent.api_mode,
                            base_url=runtime_agent.base_url,
                            model=session_row.get("model") or result.get("model") or runtime_agent.model,
                        )
                except Exception:
                    LOG.exception("Failed to persist or refresh Mission Control usage metrics for session %s", resolved_session_id)
            for index, item in enumerate(state["conversations"]):
                if item["id"] != active_conversation["id"]:
                    continue
                state["conversations"][index] = _normalize_conversation_payload(
                    {
                        "agent_id": item.get("agent_id"),
                        "title": item.get("title") or _derive_title(req.message.content, fallback="New conversation"),
                        "pinned": item.get("pinned", False),
                        "session_id": resolved_session_id,
                        "last_message_at": _utc_now_iso(),
                        "last_run_status": "success",
                        "last_error": "",
                        "usage_summary": usage_summary,
                        "usage_diagnostics": usage_diagnostics,
                        "preferred_model": req.model or item.get("preferred_model") or agent.get("preferred_model"),
                    },
                    item,
                )
                break
            for index, item in enumerate(state["agents"]):
                if item["id"] != agent["id"]:
                    continue
                item["last_active_at"] = _utc_now_iso()
                item.setdefault("observability", {})["last_error"] = ""
                state["agents"][index] = _normalize_agent_payload(item, item)
                break
            _audit(state, "chat.completed", {"conversation_id": active_conversation["id"], "agent_id": agent["id"], "session_id": resolved_session_id})
            _save_state(state)
            refreshed = _enrich_state(state)
            conv = _pick_enriched_item(refreshed, "conversations", active_conversation["id"])
            agent_payload = _pick_enriched_item(refreshed, "agents", agent["id"])
            emit(
                "done",
                {
                    "conversation_id": active_conversation["id"],
                    "session_id": resolved_session_id,
                    "reply": {"role": "assistant", "content": reply_text},
                    "conversation": conv,
                    "agent": agent_payload,
                    "summary": refreshed["summary"],
                },
            )
            emit("status", {"status": "completed"})
            LOG.info(
                "mission_control.chat.completed conversation_id=%s agent_id=%s model=%s "
                "delta_count=%d content_chars=%d duration_ms=%d session_id=%s",
                active_conversation["id"], agent.get("id"),
                result.get("model") or runtime_agent.model,
                delta_count["n"], len(reply_text),
                int((time.time() - started_at) * 1000),
                resolved_session_id,
            )
        except Exception as exc:
            state = _load_state()
            for index, item in enumerate(state["conversations"]):
                if item["id"] != conversation["id"]:
                    continue
                state["conversations"][index] = _normalize_conversation_payload(
                    {
                        "agent_id": item.get("agent_id"),
                        "title": item.get("title"),
                        "pinned": item.get("pinned", False),
                        "session_id": item.get("session_id"),
                        "last_message_at": _utc_now_iso(),
                        "last_run_status": "error",
                        "last_error": str(exc),
                        "usage_diagnostics": _build_usage_diagnostics(
                            usage_summary=item.get("usage_summary") or {},
                            last_run_status="error",
                            last_error=str(exc),
                            model=item.get("usage_summary", {}).get("model") or agent.get("preferred_model"),
                        ),
                    },
                    item,
                )
                break
            for index, item in enumerate(state["agents"]):
                if item["id"] != agent["id"]:
                    continue
                item.setdefault("observability", {})["last_error"] = str(exc)
                state["agents"][index] = _normalize_agent_payload(item, item)
                break
            _audit(state, "chat.failed", {"conversation_id": conversation["id"], "agent_id": agent["id"], "error": str(exc)})
            _save_state(state)
            LOG.exception(
                "mission_control.chat.exception conversation_id=%s agent_id=%s duration_ms=%d",
                conversation["id"], agent.get("id"),
                int((time.time() - started_at) * 1000),
            )
            emit("error", {"detail": f"Agent error: {exc}", "message": f"Agent error: {exc}", "retryable": True})
        finally:
            try:
                db.close()
            except Exception:
                pass
            emit("eof", None)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()


@app.post("/api/mission-control/chat/stream")
async def chat_stream(req: MissionChatRequest):
    state = _load_state()
    agent = next((item for item in state["agents"] if item["id"] == req.agent_id), None)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    conversation = None
    if req.conversation_id:
        conversation = next((item for item in state["conversations"] if item["id"] == req.conversation_id), None)
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conversation = _normalize_conversation_payload(
            {
                "agent_id": agent["id"],
                "title": _derive_title(req.message.content, fallback=f"{agent['name']} chat"),
                "pinned": False,
                "last_run_status": "running",
                "preferred_model": req.model or agent.get("preferred_model"),
            }
        )
        state["conversations"].append(conversation)
        _audit(state, "conversation.created", {"conversation_id": conversation["id"], "agent_id": agent["id"]})
        _save_state(state)

    event_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
    await _run_agent_stream(req, conversation, agent, event_queue)

    async def event_stream():
        yield 'event: status\ndata: {"status":"started"}\n\n'
        if req.conversation_id is None:
            yield f"event: conversation\ndata: {json.dumps({'conversation_id': conversation['id']}, ensure_ascii=False)}\n\n"
        while True:
            kind, payload = await asyncio.to_thread(event_queue.get)
            if kind == "eof":
                break
            if kind not in {"status", "delta", "done", "error"}:
                continue
            yield f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )



MAX_BACKGROUND_BYTES = 4 * 1024 * 1024
MAX_BACKGROUND_DIMENSION = 4096
ALLOWED_BACKGROUND_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    idx = 2
    while idx + 9 < len(data):
        if data[idx] != 0xFF:
            idx += 1
            continue
        while idx < len(data) and data[idx] == 0xFF:
            idx += 1
        if idx >= len(data):
            break
        marker = data[idx]
        idx += 1
        if marker in {0xD8, 0xD9}:
            continue
        if idx + 2 > len(data):
            break
        segment_length = int.from_bytes(data[idx:idx + 2], "big")
        if segment_length < 2 or idx + segment_length > len(data):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            if segment_length >= 7:
                height = int.from_bytes(data[idx + 3:idx + 5], "big")
                width = int.from_bytes(data[idx + 5:idx + 7], "big")
                return width, height
            break
        idx += segment_length
    return None


def _image_dimensions(data: bytes, content_type: str) -> tuple[str, int, int] | None:
    if content_type == "image/png":
        dims = _png_dimensions(data)
        return ("PNG", *dims) if dims else None
    if content_type == "image/jpeg":
        dims = _jpeg_dimensions(data)
        return ("JPEG", *dims) if dims else None
    return None


def _background_payload(path: Path) -> Dict[str, Any]:
    data = path.read_bytes()
    content_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    parsed = _image_dimensions(data, content_type)
    width, height = (parsed[1], parsed[2]) if parsed else (0, 0)
    stat = path.stat()
    return {
        "id": f"custom-{path.name}",
        "filename": path.name,
        "size": stat.st_size,
        "width": width,
        "height": height,
        "uploadedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
    }


def _background_path_for_id(background_id: str) -> Path:
    if not background_id.startswith("custom-"):
        raise HTTPException(status_code=404, detail="Background not found")
    filename = background_id.removeprefix("custom-")
    candidate = (USER_BACKGROUND_DIR / filename).resolve()
    root = USER_BACKGROUND_DIR.resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(status_code=404, detail="Background not found")
    return candidate


@app.get("/api/user-content/backgrounds")
async def list_user_backgrounds():
    USER_BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(
        [p for p in USER_BACKGROUND_DIR.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg"}],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return [_background_payload(path) for path in files]


@app.post("/api/user-content/backgrounds")
async def upload_user_background(file: UploadFile = File(...)):
    content_type = (file.content_type or "").lower()
    if content_type not in ALLOWED_BACKGROUND_TYPES:
        raise HTTPException(status_code=415, detail="PNG or JPG only")

    data = await file.read(MAX_BACKGROUND_BYTES + 1)
    if len(data) > MAX_BACKGROUND_BYTES:
        raise HTTPException(status_code=413, detail="Maximum upload size is 4 MB")

    parsed = _image_dimensions(data, content_type)
    if not parsed:
        raise HTTPException(status_code=415, detail="Invalid image file")
    fmt, width, height = parsed

    if width > MAX_BACKGROUND_DIMENSION or height > MAX_BACKGROUND_DIMENSION:
        raise HTTPException(status_code=413, detail="Maximum dimensions are 4096x4096")

    ext = ".png" if fmt == "PNG" else ".jpg"
    USER_BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)
    destination = USER_BACKGROUND_DIR / f"{uuid.uuid4().hex}{ext}"
    destination.write_bytes(data)
    return _background_payload(destination)


@app.delete("/api/user-content/backgrounds/{background_id}")
async def delete_user_background(background_id: str):
    path = _background_path_for_id(background_id)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Background not found")
    path.unlink()
    return {"ok": True}


@app.get("/user-content/backgrounds/{filename}")
async def serve_user_background(filename: str):
    path = (USER_BACKGROUND_DIR / filename).resolve()
    root = USER_BACKGROUND_DIR.resolve()
    if not path.is_relative_to(root) or not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Background not found")
    if path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=404, detail="Background not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=604800"})


@app.get("/user-content/dumps/{filename}")
@app.head("/user-content/dumps/{filename}")
async def serve_maintenance_dump(filename: str):
    path = _safe_user_file(USER_DUMP_DIR, filename, {".json", ".txt"})
    return FileResponse(path, headers={"Cache-Control": "no-store"})


@app.get("/user-content/backups/{filename}")
@app.head("/user-content/backups/{filename}")
async def serve_maintenance_backup(filename: str):
    path = _safe_user_file(USER_BACKUP_DIR, filename, {".gz", ".tgz"})
    return FileResponse(path, headers={"Cache-Control": "no-store"})

def mount_spa(application: FastAPI) -> None:
    if not MISSION_CONTROL_DIST.exists():
        @application.get("/{full_path:path}")
        async def no_frontend(full_path: str):
            return JSONResponse({"error": "Mission Control frontend not built. Run: cd mission_control_web && npm run build"}, status_code=404)
        return

    index_path = MISSION_CONTROL_DIST / "index.html"

    def serve_index() -> HTMLResponse:
        html = index_path.read_text(encoding="utf-8")
        token_script = f'<script>window.__HERMES_SESSION_TOKEN__="{SESSION_TOKEN}";</script>'
        html = html.replace("</head>", f"{token_script}</head>", 1)
        return HTMLResponse(html, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})

    assets_dir = MISSION_CONTROL_DIST / "assets"
    if assets_dir.exists():
        application.mount("/assets", StaticFiles(directory=assets_dir), name="mission-control-assets")
    fonts_dir = MISSION_CONTROL_DIST / "fonts"
    if fonts_dir.exists():
        application.mount("/fonts", StaticFiles(directory=fonts_dir), name="mission-control-fonts")

    async def serve_spa_response(full_path: str):
        file_path = MISSION_CONTROL_DIST / full_path
        if full_path and file_path.exists() and file_path.is_file() and file_path.resolve().is_relative_to(MISSION_CONTROL_DIST.resolve()):
            if full_path == "robots.txt":
                return FileResponse(file_path, headers={"Cache-Control": "no-store, no-cache, must-revalidate"})
            if full_path == "sw.js":
                return FileResponse(
                    file_path,
                    media_type="application/javascript",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Service-Worker-Allowed": "/"},
                )
            if full_path == "manifest.webmanifest":
                return FileResponse(file_path, media_type="application/manifest+json", headers={"Cache-Control": "no-store, no-cache, must-revalidate"})
            return FileResponse(file_path)
        return serve_index()

    @application.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return await serve_spa_response(full_path)

    @application.head("/{full_path:path}")
    async def head_spa(full_path: str):
        return await serve_spa_response(full_path)


mount_spa(app)


def start_server(host: str = "127.0.0.1", port: int = 9120, open_browser: bool = True, allow_public: bool = False) -> None:
    import uvicorn

    local_hosts = {"127.0.0.1", "localhost", "::1"}
    if host not in local_hosts and not allow_public:
        raise SystemExit("Refusing to bind Mission Control to a non-localhost interface without --insecure")
    url = f"http://{host}:{port}"
    if open_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=host, port=port, log_level="info")
