from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hermes_cli import messages
from hermes_cli import mission_control_server as server


def _patch_messages(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(json.dumps({
        "agents": [
            {"id": "agent_a", "name": "Agent A"},
            {"id": "agent_b", "name": "Agent B"},
            {"id": "agent_c", "name": "Agent C"},
        ]
    }))
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(server.messages_service, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(server.messages_service, "MISSION_CONTROL_STATE_PATH", state_path)
    return state_path


def test_message_creation_writes_to_both_files_atomically(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)

    msg = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"})

    sender_file = tmp_path / "messages" / "agent_a.json"
    recipient_file = tmp_path / "messages" / "agent_b.json"
    assert json.loads(sender_file.read_text()) == [msg]
    assert json.loads(recipient_file.read_text()) == [msg]
    assert list((tmp_path / "messages").glob("*.bak"))
    assert not list((tmp_path / "messages").glob("*.tmp"))


def test_reply_inherits_thread_id_and_sets_in_reply_to(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    parent = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"})

    reply = messages.create_message({"from_agent_id": "agent_b", "to_agent_id": "agent_a", "subject": "Re: Hello", "body": "Reply", "in_reply_to": parent["id"]})

    assert reply["thread_id"] == parent["thread_id"]
    assert reply["in_reply_to"] == parent["id"]


def test_reply_with_mismatched_thread_is_rejected(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    parent = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"})

    with pytest.raises(ValueError, match="thread_id mismatch"):
        messages.create_message({"from_agent_id": "agent_b", "to_agent_id": "agent_a", "subject": "Re", "body": "Reply", "in_reply_to": parent["id"], "thread_id": "thread_deadbeef"})


def test_self_send_and_unknown_agent_rejected(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="cannot send to itself"):
        messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_a", "subject": "No", "body": "Body"})
    with pytest.raises(ValueError, match="Unknown agent id"):
        messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "missing", "subject": "No", "body": "Body"})


def test_mark_read_changes_status_only_by_recipient(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    msg = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"})

    with pytest.raises(PermissionError):
        messages.mark_read(msg["id"], "agent_a")
    updated = messages.mark_read(msg["id"], "agent_b")

    assert updated["status"] == "read"
    assert updated["read_at"] is not None
    assert messages.get_message(msg["id"], "agent_a")["status"] == "sent"


def test_archive_sets_archived_at_on_one_side_only(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    msg = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"})

    archived = messages.archive_message(msg["id"], "agent_a")

    assert archived["status"] == "archived"
    assert archived["archived_at"] is not None
    assert messages.get_message(msg["id"], "agent_b")["status"] == "sent"
    assert messages.get_message(msg["id"], "agent_b")["archived_at"] is None


def test_unread_counts_match_reality_before_and_after_read(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    one = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "1", "body": "Body"})
    messages.create_message({"from_agent_id": "agent_c", "to_agent_id": "agent_b", "subject": "2", "body": "Body"})
    messages.create_message({"from_agent_id": "agent_b", "to_agent_id": "agent_a", "subject": "3", "body": "Body"})

    assert messages.unread_counts() == {"agent_a": 1, "agent_b": 2, "agent_c": 0}
    messages.mark_read(one["id"], "agent_b")
    assert messages.unread_counts() == {"agent_a": 1, "agent_b": 1, "agent_c": 0}


def test_inbox_pagination_with_limit_and_before_cursor(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    created = [messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": str(i), "body": "Body"}) for i in range(3)]

    page = messages.inbox("agent_b", limit=2)
    assert [m["id"] for m in page["messages"]] == [created[2]["id"], created[1]["id"]]
    next_page = messages.inbox("agent_b", limit=2, before=page["messages"][-1]["id"])
    assert [m["id"] for m in next_page["messages"]] == [created[0]["id"]]


def test_api_endpoints_cover_create_read_counts_and_get(tmp_path, monkeypatch):
    _patch_messages(tmp_path, monkeypatch)
    client = TestClient(server.app)
    headers = {"Authorization": f"Bearer {server.SESSION_TOKEN}"}

    response = client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Hello", "body": "Body"}, headers=headers)
    assert response.status_code == 200
    msg = response.json()
    assert client.get(f"/api/messages/{msg['id']}?agent_id=agent_b", headers=headers).json()["id"] == msg["id"]
    assert client.get("/api/messages/unread-counts", headers=headers).json()["agent_b"] == 1
    assert client.post(f"/api/messages/{msg['id']}/read", json={"agent_id": "agent_b"}, headers=headers).json()["status"] == "read"
    assert client.get("/api/messages/unread-counts", headers=headers).json()["agent_b"] == 0
