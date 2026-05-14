"""Smoke tests for the Mission Control chat/stream SSE contract.

Slice 2b regression coverage: when the underlying AIAgent run is stubbed,
the endpoint must emit at least one ``delta`` event with the assistant
content and a ``done`` event whose ``reply.content`` matches.
"""
from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient


def _stub_agent(monkeypatch, *, reply: str = "hello", failed: bool = False) -> None:
    """Patch AIAgent inside mission_control_server so run_conversation()
    returns a canned reply (optionally fires the streaming callback)."""
    from hermes_cli import mission_control_server as mcs

    class _StubAgent:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._on_delta = kwargs.get("stream_delta_callback")
            self.session_id = kwargs.get("session_id") or "test-session"
            self.model = kwargs.get("model") or "stub-model"
            self.provider = "stub"
            self.api_mode = "chat_completions"
            self.base_url = "stub://"

        def run_conversation(self, user_message: str, system_message: str = None, **_: Any) -> dict[str, Any]:
            if failed:
                return {"final_response": "", "failed": True, "error": "upstream 401"}
            if self._on_delta:
                # simulate streaming a couple of tokens
                self._on_delta(reply[:2])
                self._on_delta(reply[2:])
            return {"final_response": reply, "model": self.model}

    monkeypatch.setattr(mcs, "AIAgent", _StubAgent)


def _read_sse(text: str) -> list[tuple[str, Any]]:
    events: list[tuple[str, Any]] = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        ev = "message"
        data = ""
        for line in block.split("\n"):
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        try:
            data_json = json.loads(data) if data else None
        except json.JSONDecodeError:
            data_json = data
        events.append((ev, data_json))
    return events


@pytest.fixture
def mc_app(monkeypatch, tmp_path):
    # Isolate state file
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli import mission_control_server as mcs
    # Force a fresh state
    if hasattr(mcs, "_STATE_CACHE"):
        mcs._STATE_CACHE = None  # type: ignore[attr-defined]
    return mcs


def test_stream_emits_delta_and_done_with_assistant_content(mc_app, monkeypatch):
    _stub_agent(monkeypatch, reply="hello")
    client = TestClient(mc_app.app)
    state = mc_app._load_state()
    if not state["agents"]:
        pytest.skip("no seeded agents in this environment")
    agent_id = state["agents"][0]["id"]
    auth_headers = {"Authorization": f"Bearer {mc_app.SESSION_TOKEN}"}

    with client.stream(
        "POST",
        "/api/mission-control/chat/stream",
        headers=auth_headers,
        json={"agent_id": agent_id, "message": {"role": "user", "content": "hi"}},
    ) as resp:
        assert resp.status_code == 200
        body = "".join(chunk.decode() for chunk in resp.iter_raw())

    events = _read_sse(body)
    kinds = [e[0] for e in events]
    assert "delta" in kinds, f"no delta event; got {kinds}"
    delta_text = "".join(
        (e[1] or {}).get("text", "") for e in events if e[0] == "delta"
    )
    done = next((e[1] for e in events if e[0] == "done"), None)
    assert done is not None, "missing done event"
    assert done["reply"]["content"] == "hello"
    assert delta_text == "hello"


def test_stream_surfaces_upstream_failure_as_error_event(mc_app, monkeypatch):
    _stub_agent(monkeypatch, reply="", failed=True)
    client = TestClient(mc_app.app)
    state = mc_app._load_state()
    if not state["agents"]:
        pytest.skip("no seeded agents in this environment")
    agent_id = state["agents"][0]["id"]
    auth_headers = {"Authorization": f"Bearer {mc_app.SESSION_TOKEN}"}

    with client.stream(
        "POST",
        "/api/mission-control/chat/stream",
        headers=auth_headers,
        json={"agent_id": agent_id, "message": {"role": "user", "content": "boom"}},
    ) as resp:
        body = "".join(chunk.decode() for chunk in resp.iter_raw())

    events = _read_sse(body)
    kinds = [e[0] for e in events]
    assert "error" in kinds, f"expected error event on upstream failure; got {kinds}"
    assert "done" not in kinds, "must not emit done after upstream failure"
