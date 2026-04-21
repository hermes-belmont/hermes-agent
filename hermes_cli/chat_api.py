"""HTTP chat API for the Hermes dashboard.

Provides:
- POST /api/chat         : standard request/response chat
- POST /api/chat/stream  : SSE streaming deltas for real-time rendering

Both endpoints route through local ``run_agent.AIAgent`` so the dashboard uses
same model + tool behavior as the rest of Hermes.
"""

from __future__ import annotations

import asyncio
import json
import queue
import threading
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from hermes_cli.config import get_hermes_home, load_config

router = APIRouter()


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str


class ChatRequest(BaseModel):
    session_id: Optional[str] = Field(
        None,
        description="Existing Hermes session id. If omitted, a new persistent session is created.",
    )
    message: ChatMessage = Field(..., description="Message to send")


class ChatResponse(BaseModel):
    session_id: str
    reply: ChatMessage


class ChatSessionMetadataItem(BaseModel):
    pinned: bool = False
    custom_title: str | None = None


class ChatSessionMetadataResponse(BaseModel):
    items: dict[str, ChatSessionMetadataItem]


class ChatSessionMetadataUpdate(BaseModel):
    pinned: bool | None = None
    custom_title: str | None = None


_CHAT_METADATA_LOCK = threading.Lock()
_CHAT_METADATA_PATH = Path(get_hermes_home()) / "chat_session_metadata.json"


def _read_chat_session_metadata() -> dict[str, dict[str, Any]]:
    if not _CHAT_METADATA_PATH.exists():
        return {}
    try:
        payload = json.loads(_CHAT_METADATA_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    cleaned: dict[str, dict[str, Any]] = {}
    for session_id, raw in payload.items():
        if not isinstance(session_id, str) or not isinstance(raw, dict):
            continue
        cleaned[session_id] = {
            "pinned": bool(raw.get("pinned", False)),
            "custom_title": raw.get("custom_title") if isinstance(raw.get("custom_title"), str) and raw.get("custom_title").strip() else None,
        }
    return cleaned



def _write_chat_session_metadata(items: dict[str, dict[str, Any]]) -> None:
    _CHAT_METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    normalized = {
        session_id: {
            "pinned": bool(meta.get("pinned", False)),
            "custom_title": meta.get("custom_title") if meta.get("custom_title") else None,
        }
        for session_id, meta in items.items()
    }
    _CHAT_METADATA_PATH.write_text(
        json.dumps(normalized, indent=2, sort_keys=True),
        encoding="utf-8",
    )



def delete_session_metadata_entry(session_id: str) -> None:
    with _CHAT_METADATA_LOCK:
        items = _read_chat_session_metadata()
        if session_id in items:
            items.pop(session_id, None)
            _write_chat_session_metadata(items)


@router.get("/api/chat/session-metadata", response_model=ChatSessionMetadataResponse)
async def get_chat_session_metadata() -> ChatSessionMetadataResponse:
    with _CHAT_METADATA_LOCK:
        items = _read_chat_session_metadata()
    return ChatSessionMetadataResponse(items=items)


@router.put("/api/chat/session-metadata/{session_id}")
async def update_chat_session_metadata(session_id: str, body: ChatSessionMetadataUpdate):
    with _CHAT_METADATA_LOCK:
        items = _read_chat_session_metadata()
        current = items.get(session_id, {"pinned": False, "custom_title": None})
        if body.pinned is not None:
            current["pinned"] = bool(body.pinned)
        if body.custom_title is not None:
            trimmed = body.custom_title.strip()
            current["custom_title"] = trimmed or None
        items[session_id] = current
        _write_chat_session_metadata(items)
    return {"ok": True, "meta": current}


@router.delete("/api/chat/session-metadata/{session_id}")
async def delete_chat_session_metadata(session_id: str):
    delete_session_metadata_entry(session_id)
    return {"ok": True}


def _resolve_model_from_config() -> str:
    """Resolve primary model from Hermes config (string or dict form)."""
    cfg = load_config()
    model_cfg = cfg.get("model", "")
    if isinstance(model_cfg, dict):
        return str(model_cfg.get("default") or model_cfg.get("name") or "")
    return str(model_cfg or "")


def _run_agent_once(
    *,
    user_text: str,
    session_id: str | None,
    stream_delta_callback=None,
) -> dict[str, Any]:
    """Run one agent turn and return normalized output payload."""
    model_name = _resolve_model_from_config()
    kwargs: dict[str, Any] = {
        "session_id": session_id,
        "quiet_mode": True,
        "stream_delta_callback": stream_delta_callback,
    }
    if model_name:
        kwargs["model"] = model_name

    from run_agent import AIAgent

    agent = AIAgent(**kwargs)
    result = agent.run_conversation(user_message=user_text)
    reply_text = result.get("final_response", "(no response)")
    resolved_session_id = str(getattr(agent, "session_id", None) or session_id or "")
    return {
        "session_id": resolved_session_id,
        "reply": {
            "role": "assistant",
            "content": str(reply_text),
        },
    }


@router.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest) -> ChatResponse:
    """Non-streaming chat endpoint."""
    try:
        payload = await asyncio.to_thread(
            _run_agent_once,
            user_text=req.message.content,
            session_id=req.session_id,
            stream_delta_callback=None,
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Agent error: {exc}") from exc

    return ChatResponse(
        session_id=payload["session_id"],
        reply=ChatMessage(role="assistant", content=payload["reply"]["content"]),
    )


@router.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    """SSE chat endpoint with incremental delta events.

    Events:
    - event: status, data: {"status":"started"|"running"|"completed"}
    - event: delta,  data: {"text":"..."}
    - event: done,   data: {"session_id":"...","reply":{...}}
    - event: error,  data: {"detail":"..."}
    """

    event_queue: queue.Queue[tuple[str, Any]] = queue.Queue()

    def emit(kind: str, payload: Any) -> None:
        event_queue.put((kind, payload))

    def on_delta(text: str | None) -> None:
        if not isinstance(text, str) or not text:
            return
        emit("delta", {"text": text})

    def worker() -> None:
        try:
            emit("status", {"status": "running"})
            payload = _run_agent_once(
                user_text=req.message.content,
                session_id=req.session_id,
                stream_delta_callback=on_delta,
            )
            emit("done", payload)
            emit("status", {"status": "completed"})
        except Exception as exc:  # pragma: no cover - defensive fallback
            emit("error", {"detail": f"Agent error: {exc}"})
        finally:
            emit("eof", None)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()

    async def event_stream():
        # Open the stream immediately so the frontend can flip into streaming state.
        yield "event: status\ndata: {\"status\":\"started\"}\n\n"

        while True:
            kind, payload = await asyncio.to_thread(event_queue.get)
            if kind == "eof":
                break
            if kind not in {"status", "delta", "done", "error"}:
                continue
            serialized = json.dumps(payload, ensure_ascii=False)
            yield f"event: {kind}\ndata: {serialized}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
