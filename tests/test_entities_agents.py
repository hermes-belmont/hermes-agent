from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from hermes_cli import entities as entities_service
from hermes_cli import messages
from hermes_cli import mission_control_server as server


def _patch_paths(tmp_path, monkeypatch):
    home = tmp_path / "mission_control"
    runtime = tmp_path / "runtime"
    state_path = home / "state.json"
    backup_path = home / "state.json.pre_slice_8a_migration_backup"
    monkeypatch.setattr(server, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(entities_service, "MISSION_CONTROL_HOME", home)
    monkeypatch.setattr(entities_service, "STATE_PATH", state_path)
    monkeypatch.setattr(entities_service, "MIGRATION_BACKUP_PATH", backup_path)
    monkeypatch.setattr(entities_service, "RUNTIME_DIR", runtime)
    monkeypatch.setattr(entities_service, "MESSAGES_DIR", runtime / "messages")
    monkeypatch.setattr(entities_service, "TRACKED_ITEMS_DIR", runtime / "tracked-items")
    monkeypatch.setattr(entities_service, "BRIEFINGS_DIR", runtime / "briefings")
    monkeypatch.setattr(entities_service, "AGENT_PURGE_AUDIT_LOG", runtime / "agent-purge-audit.log")
    monkeypatch.setattr(server.entities_service, "STATE_PATH", state_path)
    monkeypatch.setattr(server.entities_service, "MIGRATION_BACKUP_PATH", backup_path)
    monkeypatch.setattr(server.entities_service, "MESSAGES_DIR", runtime / "messages")
    monkeypatch.setattr(server.entities_service, "TRACKED_ITEMS_DIR", runtime / "tracked-items")
    monkeypatch.setattr(server.entities_service, "BRIEFINGS_DIR", runtime / "briefings")
    monkeypatch.setattr(server.entities_service, "AGENT_PURGE_AUDIT_LOG", runtime / "agent-purge-audit.log")
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MESSAGES_DIR", runtime / "messages")
    monkeypatch.setattr(server.messages_service, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(server.messages_service, "MESSAGES_DIR", runtime / "messages")
    return state_path, backup_path, runtime


def _seed_state(state_path: Path):
    agents = [
        {"id": "agent_ab9825e9ca", "name": "Media Director", "role": "Media", "operating_entity": "Umbrella Media, LLC"},
        {"id": "agent_69215fd621", "name": "Properties Director", "role": "Properties", "operating_entity": "Umbrella Properties, LLC"},
        {"id": "agent_2fbf94bf93", "name": "Customs Director", "role": "Customs", "operating_entity": "Umbrella Customs, LLC"},
        {"id": "agent_aa2e50d113", "name": "Holdings Director", "role": "Holdings", "operating_entity": "Umbrella Holdings Group, LLC"},
        {"id": "agent_b61326ba1c", "name": "Trust Director", "role": "Trust", "operating_entity": "Umbrella Corporation Trust"},
        {"id": "agent_ops", "name": "Ops", "role": "Ops", "operating_entity": "Umbrella Holdings Group, LLC"},
        {"id": "agent_lab", "name": "Lab", "role": "Lab", "operating_entity": "Unknown Labs"},
        {"id": "agent_a", "name": "A", "role": "A", "operating_entity": "Umbrella Media, LLC"},
        {"id": "agent_b", "name": "B", "role": "B", "operating_entity": "Umbrella Customs, LLC"},
    ]
    state_path.parent.mkdir(parents=True)
    state_path.write_text(json.dumps({"agents": agents, "conversations": [], "audit_log": []}), encoding="utf-8")


def _client():
    return TestClient(server.app), {"Authorization": f"Bearer {server.SESSION_TOKEN}"}


def test_migration_creates_default_tree_and_is_idempotent(tmp_path, monkeypatch):
    state_path, backup_path, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)

    state, changed = entities_service.migrate_state_if_needed(entities_service.load_state())
    second, changed_again = entities_service.migrate_state_if_needed(entities_service.load_state())

    assert changed is True
    assert changed_again is False
    assert backup_path.exists()
    assert [entity["name"] for entity in state["entities"]] == [entity["name"] for entity in second["entities"]]
    assert {entity["name"] for entity in state["entities"]} >= {"Umbrella Corporation Trust", "Umbrella Holdings Group, LLC", "Umbrella Media, LLC", "Umbrella Customs, LLC", "Unassigned"}
    briefing = {agent["id"]: agent["is_briefing_agent"] for agent in state["agents"]}
    assert all(briefing[agent_id] for agent_id in entities_service.BRIEFING_AGENT_IDS)
    assert next(agent for agent in state["agents"] if agent["id"] == "agent_lab")["operating_entity"] == "Unassigned"


def test_migration_preserves_explicit_briefing_agent_flags(tmp_path, monkeypatch):
    state_path, _, _ = _patch_paths(tmp_path, monkeypatch)
    state_path.parent.mkdir(parents=True)
    state_path.write_text(json.dumps({
        "agents": [
            {"id": "agent_custom", "name": "Custom", "role": "Custom", "operating_entity": "Umbrella Holdings Group, LLC", "is_briefing_agent": True},
            {"id": "agent_ops", "name": "Ops", "role": "Ops", "operating_entity": "Umbrella Holdings Group, LLC", "is_briefing_agent": False},
        ],
        "conversations": [],
        "audit_log": [],
    }), encoding="utf-8")

    state, _ = entities_service.migrate_state_if_needed(entities_service.load_state())
    briefing = {agent["id"]: agent["is_briefing_agent"] for agent in state["agents"]}

    assert briefing["agent_custom"] is True
    assert briefing["agent_ops"] is False


def test_entity_and_agent_crud_duplicate_move_delete_restore_and_purge(tmp_path, monkeypatch):
    state_path, _, runtime = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()

    tree = client.get("/api/entities/tree", headers=headers)
    assert tree.status_code == 200
    holdings = next(entity for entity in client.get("/api/entities", headers=headers).json() if entity["name"] == "Umbrella Holdings Group, LLC")
    customs = next(entity for entity in client.get("/api/entities", headers=headers).json() if entity["name"] == "Umbrella Customs, LLC")

    created = client.post("/api/agents", json={"name": "Test Agent", "role": "Test", "entity_id": holdings["id"], "preferred_model": "gpt-5.5"}, headers=headers)
    assert created.status_code == 200
    agent = created.json()
    assert agent["entity_id"] == holdings["id"]

    duplicate = client.post(f"/api/agents/{agent['id']}/duplicate", headers=headers)
    assert duplicate.status_code == 200
    copy = duplicate.json()
    assert copy["name"].endswith(" (copy)")
    assert copy["is_briefing_agent"] is False

    moved = client.post(f"/api/agents/{copy['id']}/move", json={"entity_id": customs["id"]}, headers=headers)
    assert moved.status_code == 200
    assert moved.json()["entity_id"] == customs["id"]
    assert moved.json()["display_order"] >= 0

    deleted = client.delete(f"/api/agents/{copy['id']}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["deleted_at"] and deleted.json()["purge_at"]
    trash = client.get("/api/agents/trash", headers=headers)
    assert trash.status_code == 200
    assert trash.json()[0]["purges_in_days"] >= 0

    restored = client.post(f"/api/agents/{copy['id']}/restore", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None

    client.delete(f"/api/agents/{copy['id']}", headers=headers)
    state = entities_service.load_state()
    for state_agent in state["agents"]:
        if state_agent["id"] == copy["id"]:
            state_agent["purge_at"] = "2000-01-01T00:00:00+00:00"
    entities_service.save_state(state)
    (runtime / "messages").mkdir(parents=True)
    (runtime / "tracked-items").mkdir(parents=True)
    (runtime / "messages" / f"{copy['id']}.json").write_text("[]", encoding="utf-8")
    (runtime / "tracked-items" / f"{copy['id']}.json").write_text("[]", encoding="utf-8")

    purged = client.post("/api/agents/purge-now", headers=headers)
    assert purged.status_code == 200
    assert copy["id"] in purged.json()["purged_agent_ids"]
    assert not (runtime / "messages" / f"{copy['id']}.json").exists()
    assert not (runtime / "tracked-items" / f"{copy['id']}.json").exists()
    assert (runtime / "agent-purge-audit.log").read_text(encoding="utf-8")


def test_entity_delete_guardrails_and_cycle_prevention(tmp_path, monkeypatch):
    state_path, _, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()
    entities = client.get("/api/entities", headers=headers).json()
    trust = next(entity for entity in entities if entity["type"] == "trust")
    holdings = next(entity for entity in entities if entity["name"] == "Umbrella Holdings Group, LLC")
    media = next(entity for entity in entities if entity["name"] == "Umbrella Media, LLC")

    assert client.delete(f"/api/entities/{trust['id']}", headers=headers).status_code == 403
    blocked = client.delete(f"/api/entities/{holdings['id']}", headers=headers)
    assert blocked.status_code == 400
    assert "children" in str(blocked.json())
    cycle = client.post(f"/api/entities/{holdings['id']}/move", json={"parent_id": media["id"]}, headers=headers)
    assert cycle.status_code == 400


def test_messaging_policy_blocks_cross_llc_and_allows_vertical(tmp_path, monkeypatch):
    state_path, _, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()
    entities = client.get("/api/entities", headers=headers).json()
    media = next(entity for entity in entities if entity["name"] == "Umbrella Media, LLC")
    customs = next(entity for entity in entities if entity["name"] == "Umbrella Customs, LLC")
    holdings = next(entity for entity in entities if entity["name"] == "Umbrella Holdings Group, LLC")
    client.put(f"/api/entities/{media['id']}", json={"messaging_policy": "restricted"}, headers=headers)
    client.put(f"/api/entities/{customs['id']}", json={"messaging_policy": "restricted"}, headers=headers)
    client.put(f"/api/entities/{holdings['id']}", json={"messaging_policy": "restricted"}, headers=headers)

    blocked = client.post("/api/messages", json={"from_agent_id": "agent_ab9825e9ca", "to_agent_id": "agent_2fbf94bf93", "subject": "Cross", "body": "No"}, headers=headers)
    assert blocked.status_code == 400
    assert blocked.json()["error"] == "messaging_policy_blocked"
    assert "sender_policy:restricted recipient_policy:restricted" in blocked.json()["detail"]

    allowed = client.post("/api/messages", json={"from_agent_id": "agent_aa2e50d113", "to_agent_id": "agent_2fbf94bf93", "subject": "Vertical", "body": "Yes"}, headers=headers)
    assert allowed.status_code == 200
