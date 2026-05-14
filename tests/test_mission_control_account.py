from __future__ import annotations

import base64
import json
from pathlib import Path

from fastapi.testclient import TestClient

from hermes_cli import briefings as briefings_service
from hermes_cli import messages as messages_service
from hermes_cli import mission_control_server as server
from hermes_cli import reactive_worker
from hermes_cli import tracked_items as tracked_items_service


def _patch_paths(tmp_path, monkeypatch):
    home = tmp_path / "mission_control"
    runtime = tmp_path / "runtime"
    state_path = home / "state.json"

    def _assert_tmp_state_path():
        resolved = state_path.resolve()
        assert tmp_path.resolve() in resolved.parents
        assert server.MISSION_CONTROL_HOME.resolve() not in resolved.parents

    def _test_write_state(state):
        _assert_tmp_state_path()
        home.mkdir(parents=True, exist_ok=True)
        tmp = state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(state_path)

    monkeypatch.setattr(server, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(server, "MISSION_CONTROL_HOME", home)
    monkeypatch.setattr(server, "RUNTIME_DIR", runtime)
    monkeypatch.setattr(server, "_write_state", _test_write_state)
    monkeypatch.setattr(tracked_items_service, "TRACKED_ITEMS_DIR", runtime / "tracked-items")
    monkeypatch.setattr(messages_service, "MESSAGES_DIR", runtime / "messages")
    monkeypatch.setattr(messages_service, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(briefings_service, "BRIEFINGS_DIR", runtime / "briefings")
    monkeypatch.setattr(briefings_service, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(reactive_worker, "REACTIVE_SWEEPS_DIR", runtime / "reactive-sweeps")
    return state_path, runtime


def _client():
    return TestClient(server.app), {"Authorization": f"Bearer {server.SESSION_TOKEN}"}


def _seed_state(state_path: Path):
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(
        json.dumps(
            {
                "entities": [{"id": "entity_1", "name": "Umbrella", "parent_id": None}],
                "agents": [{"id": "agent_1", "name": "Agent One", "role": "Ops"}],
                "tracked_items": {"agent_1": [{"id": "tracked_1", "title": "Track"}]},
                "messages": {"agent_1": [{"id": "message_1", "body": "Hello"}]},
                "briefings": [{"id": "briefing_1"}],
                "reactive_sweeps_audit": [{"id": "sweep_1"}],
                "user": {"display_name": "Legacy David", "avatar_color": "#123456", "preferences": {"timezone": "America/Chicago"}},
            }
        ),
        encoding="utf-8",
    )


def test_patch_account_validates_display_name_length_and_hex_color(tmp_path, monkeypatch):
    state_path, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()

    assert client.patch("/api/account", json={"display_name": ""}, headers=headers).status_code == 422
    assert client.patch("/api/account", json={"display_name": "x" * 65}, headers=headers).status_code == 422
    assert client.patch("/api/account", json={"avatar_color": "blue"}, headers=headers).status_code == 422
    assert client.patch("/api/account", json={"avatar_color": "#12345g"}, headers=headers).status_code == 422

    ok = client.patch(
        "/api/account",
        json={"display_name": "David", "avatar_color": "#ffbd38", "preferences": {"timezone": "America/New_York"}},
        headers=headers,
    )
    assert ok.status_code == 200
    assert ok.json() == {"display_name": "David", "avatar_color": "#ffbd38", "preferences": {"timezone": "America/New_York"}}


def test_patch_account_validates_avatar_image_format_and_size(tmp_path, monkeypatch):
    state_path, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()

    assert client.patch("/api/account", json={"avatar_image": "not-a-data-uri"}, headers=headers).status_code == 422
    assert client.patch("/api/account", json={"avatar_image": "data:image/gif;base64,R0lGODlh"}, headers=headers).status_code == 422
    assert client.patch("/api/account", json={"avatar_image": "data:image/png;base64,%%%"}, headers=headers).status_code == 422
    oversized = "data:image/png;base64," + base64.b64encode(b"x" * (301 * 1024)).decode("ascii")
    assert client.patch("/api/account", json={"avatar_image": oversized}, headers=headers).status_code == 422


def test_patch_account_persists_valid_base64_png_and_clears_null(tmp_path, monkeypatch):
    state_path, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()
    avatar = "data:image/png;base64," + base64.b64encode(b"png-payload").decode("ascii")

    persisted = client.patch("/api/account", json={"avatar_image": avatar}, headers=headers)
    assert persisted.status_code == 200
    assert persisted.json()["avatar_image"] == avatar
    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved["account"]["avatar_image"] == avatar

    cleared = client.patch("/api/account", json={"avatar_image": None}, headers=headers)
    assert cleared.status_code == 200
    assert "avatar_image" not in cleared.json()
    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert "avatar_image" not in saved["account"]


def test_get_account_returns_avatar_image_when_set(tmp_path, monkeypatch):
    state_path, _ = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    client, headers = _client()
    avatar = "data:image/png;base64," + base64.b64encode(b"png-payload").decode("ascii")

    assert client.patch("/api/account", json={"avatar_image": avatar}, headers=headers).status_code == 200
    response = client.get("/api/account", headers=headers)
    assert response.status_code == 200
    assert response.json()["avatar_image"] == avatar


def test_get_account_export_returns_expected_top_level_keys(tmp_path, monkeypatch):
    state_path, runtime = _patch_paths(tmp_path, monkeypatch)
    _seed_state(state_path)
    (runtime / "tracked-items").mkdir(parents=True)
    (runtime / "tracked-items" / "agent_2.json").write_text(json.dumps([{"id": "tracked_2"}]), encoding="utf-8")
    (runtime / "messages").mkdir(parents=True)
    (runtime / "messages" / "agent_2.json").write_text(json.dumps([{"id": "message_2"}]), encoding="utf-8")
    (runtime / "briefings").mkdir(parents=True)
    (runtime / "briefings" / "briefing_2.json").write_text(json.dumps({"id": "briefing_2"}), encoding="utf-8")
    (runtime / "reactive-sweeps").mkdir(parents=True)
    (runtime / "reactive-sweeps" / "agent_2.json").write_text(json.dumps([{"id": "sweep_2"}]), encoding="utf-8")

    client, headers = _client()
    response = client.get("/api/account/export", headers=headers)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert "attachment;" in response.headers["content-disposition"]
    assert "mission-control-export-" in response.headers["content-disposition"]
    payload = response.json()
    assert set(payload) == {
        "entities",
        "agents",
        "tracked_items",
        "messages",
        "briefings",
        "reactive_sweeps_audit",
        "account",
        "export_metadata",
    }
    assert payload["account"]["display_name"] == "Legacy David"
    assert payload["export_metadata"]["schema_version"]
    assert payload["export_metadata"]["host_hostname"]
