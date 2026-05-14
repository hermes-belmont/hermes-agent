from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from hermes_cli import messages
from hermes_cli import mission_control_server as server
from hermes_cli import reactive_worker
from hermes_cli import respond_sweep


def _patch_reactive(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text(json.dumps({
        "entities": [
            {"id": "ent_a", "name": "Entity A", "type": "llc", "parent_id": None, "display_order": 0, "description": "", "messaging_policy": "open", "metadata": {}, "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00", "deleted_at": None, "purge_at": None},
        ],
        "agents": [
            {"id": "agent_a", "name": "Agent A", "entity_id": "ent_a", "operating_entity": "Entity A", "is_briefing_agent": True, "deleted_at": None, "preferred_model": "test/model", "tool_permissions": {"enabled": []}, "token_controls": {}},
            {"id": "agent_b", "name": "Agent B", "entity_id": "ent_a", "operating_entity": "Entity A", "is_briefing_agent": True, "deleted_at": None, "preferred_model": "test/model", "tool_permissions": {"enabled": []}, "token_controls": {}},
            {"id": "agent_c", "name": "Agent C", "entity_id": "ent_a", "operating_entity": "Entity A", "is_briefing_agent": False, "deleted_at": "2026-01-02T00:00:00+00:00", "preferred_model": "test/model", "tool_permissions": {"enabled": []}, "token_controls": {}},
        ],
    }))
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(server.messages_service, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(server.messages_service, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(reactive_worker.messages, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(reactive_worker.messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(reactive_worker, "REACTIVE_SWEEPS_DIR", tmp_path / "reactive-sweeps")
    monkeypatch.setattr(reactive_worker, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(respond_sweep.messages, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(respond_sweep.messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(respond_sweep, "MISSION_CONTROL_STATE_PATH", state_path)
    reactive_worker.reset_for_tests()
    return state_path


def _client():
    return TestClient(server.app), {"Authorization": f"Bearer {server.SESSION_TOKEN}"}


def test_high_priority_message_enqueues_reactive_sweep_and_marks_message(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    enqueued: list[tuple[str, str]] = []
    monkeypatch.setattr(reactive_worker, "enqueue", lambda agent_id, trigger_msg_id: enqueued.append((agent_id, trigger_msg_id)) or {"queued": True})
    client, headers = _client()

    response = client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Urgent", "body": "Body", "priority": "high"}, headers=headers)

    assert response.status_code == 200
    msg = response.json()
    assert msg["sent_from_reactive_sweep"] is False
    assert msg["triggered_reactive_sweep"] is False
    assert msg["queued_for_reactive"] is True
    assert msg["reactive_sweep_id"] is None
    assert enqueued == [("agent_b", msg["id"])]


def test_low_priority_and_reactive_origin_do_not_trigger(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    enqueued: list[tuple[str, str]] = []
    monkeypatch.setattr(reactive_worker, "enqueue", lambda agent_id, trigger_msg_id: enqueued.append((agent_id, trigger_msg_id)) or {"queued": True})
    client, headers = _client()

    assert client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Normal", "body": "Body", "priority": "normal"}, headers=headers).status_code == 200
    assert client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Loop", "body": "Body", "priority": "high", "sent_from_reactive_sweep": True}, headers=headers).status_code == 200

    assert enqueued == []


def test_running_sweep_coalesces_new_trigger_without_second_enqueue(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    reactive_worker._running_agents.add("agent_b")
    enqueued: list[tuple[str, str]] = []
    monkeypatch.setattr(reactive_worker, "enqueue", lambda agent_id, trigger_msg_id: enqueued.append((agent_id, trigger_msg_id)) or {"queued": True})
    client, headers = _client()

    response = client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Urgent", "body": "Body", "priority": "high"}, headers=headers)

    assert response.status_code == 200
    msg = response.json()
    assert msg["queued_for_reactive"] is True
    assert enqueued == []


def test_rate_limited_trigger_persists_auditable_record(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    for idx in range(5):
        reactive_worker.append_sweep_record("agent_b", {"id": f"rsw_done_{idx}", "agent_id": "agent_b", "status": "completed", "trigger_message_ids": [], "started_at": now.isoformat(), "completed_at": now.isoformat(), "latency_ms": 1, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": None, "error_class": None, "created_at": (now - timedelta(minutes=idx)).isoformat()})
    enqueued: list[tuple[str, str]] = []
    monkeypatch.setattr(reactive_worker, "enqueue", lambda agent_id, trigger_msg_id: enqueued.append((agent_id, trigger_msg_id)) or {"queued": True})
    client, headers = _client()

    response = client.post("/api/messages", json={"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Urgent", "body": "Body", "priority": "high"}, headers=headers)

    assert response.status_code == 200
    msg = response.json()
    assert enqueued == []
    records = reactive_worker.list_sweeps("agent_b")
    assert records[0]["status"] == "rate_limited"
    assert records[0]["trigger_message_ids"] == [msg["id"]]


def test_worker_processes_sweep_sends_loop_safe_reply_and_marks_triggers(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    trigger = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Urgent", "body": "Body", "priority": "high"})
    messages.mark_queued_for_reactive(trigger["id"], True)

    def fake_run(agent_id, trigger_messages):
        return {"outgoing_messages": [{"to_agent_id": "agent_a", "subject": "Re: Urgent", "body": "Handled", "priority": "high", "related_entity": None, "tracked_item_ids": [], "in_reply_to": trigger["id"]}], "notes_for_david": "Handled quickly"}

    monkeypatch.setattr(respond_sweep, "run_respond_sweep", fake_run)

    record = asyncio.run(reactive_worker.run_agent_sweep_once("agent_b", trigger["id"]))

    assert record["status"] == "completed"
    assert record["trigger_message_ids"] == [trigger["id"]]
    assert record["outgoing_messages_sent"][0]["to_agent_id"] == "agent_a"
    sent_msg_id = record["outgoing_messages_sent"][0]["msg_id"]
    sent = messages.get_message(sent_msg_id, "agent_a")
    assert sent["sent_from_reactive_sweep"] is True
    updated = messages.get_message(trigger["id"], "agent_b")
    assert updated["triggered_reactive_sweep"] is True
    assert updated["reactive_sweep_id"] == record["id"]


def test_reactive_sweep_endpoints_list_and_manual_run(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    monkeypatch.setattr(respond_sweep, "run_respond_sweep", lambda agent_id, trigger_messages: {"outgoing_messages": [], "notes_for_david": None})
    client, headers = _client()
    msg = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Urgent", "body": "Body", "priority": "high"})
    messages.mark_queued_for_reactive(msg["id"], True)

    run_response = client.post("/api/reactive-sweeps/agent_b/run", json={"trigger_message_id": msg["id"]}, headers=headers)
    list_response = client.get("/api/reactive-sweeps/agent_b", headers=headers)

    assert run_response.status_code == 200
    assert run_response.json()["status"] == "completed"
    assert list_response.status_code == 200
    assert list_response.json()[0]["id"] == run_response.json()["id"]


def test_reactive_sweep_stats_endpoint_counts_today_records(tmp_path, monkeypatch):
    _patch_reactive(tmp_path, monkeypatch)
    client, headers = _client()
    local_now = datetime.now().astimezone().replace(microsecond=0)
    yesterday = local_now - timedelta(days=1, minutes=5)
    reactive_worker.append_sweep_record("agent_a", {"id": "rsw_completed_a", "agent_id": "agent_a", "status": "completed", "trigger_message_ids": [], "started_at": local_now.isoformat(), "completed_at": local_now.isoformat(), "latency_ms": 100, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": None, "error_class": None, "created_at": local_now.isoformat()})
    reactive_worker.append_sweep_record("agent_a", {"id": "rsw_failed_a", "agent_id": "agent_a", "status": "failed", "trigger_message_ids": [], "started_at": local_now.isoformat(), "completed_at": local_now.isoformat(), "latency_ms": 900, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": "boom", "error_class": "RuntimeError", "created_at": local_now.isoformat()})
    reactive_worker.append_sweep_record("agent_b", {"id": "rsw_completed_b", "agent_id": "agent_b", "status": "completed", "trigger_message_ids": [], "started_at": local_now.isoformat(), "completed_at": local_now.isoformat(), "latency_ms": 300, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": None, "error_class": None, "created_at": local_now.isoformat()})
    reactive_worker.append_sweep_record("agent_b", {"id": "rsw_rate_limited_b", "agent_id": "agent_b", "status": "rate_limited", "trigger_message_ids": [], "started_at": None, "completed_at": local_now.isoformat(), "latency_ms": None, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": None, "error_class": None, "created_at": local_now.isoformat()})
    reactive_worker.append_sweep_record("agent_b", {"id": "rsw_old_b", "agent_id": "agent_b", "status": "completed", "trigger_message_ids": [], "started_at": yesterday.isoformat(), "completed_at": yesterday.isoformat(), "latency_ms": 999, "outgoing_messages_sent": [], "outgoing_messages_rejected": [], "notes_for_david": None, "error": None, "error_class": None, "created_at": yesterday.isoformat()})
    reactive_worker._running_agents.add("agent_a")
    reactive_worker._loop_blocked_by_date[local_now.date().isoformat()] = 2

    response = client.get("/api/reactive-sweeps/stats", headers=headers)

    assert response.status_code == 200
    stats = response.json()
    assert stats["total_today"] == 4
    assert stats["by_agent_today"] == {"agent_a": 2, "agent_b": 2}
    assert stats["rate_limited_today"] == 1
    assert stats["avg_latency_ms"] == 200
    assert stats["loop_blocked_today"] == 2
    assert stats["active_in_flight"] == 1
    assert stats["queue_size"] == 0
