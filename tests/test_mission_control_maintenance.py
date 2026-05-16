from pathlib import Path
import tarfile

from hermes_cli import mission_control_server as server


def test_take_snapshot_writes_redacted_archive_under_runtime_snapshots(tmp_path, monkeypatch):
    runtime = tmp_path / "runtime"
    state = tmp_path / "mission_control" / "state.json"
    state.parent.mkdir(parents=True)
    state.write_text('{"token":"sk-testsecret1234567890","safe":"ok"}', encoding="utf-8")

    monkeypatch.setattr(server, "RUNTIME_DIR", runtime)
    monkeypatch.setattr(server, "MISSION_CONTROL_STATE_PATH", state)
    monkeypatch.setattr(server, "_safe_backup_sources", lambda: [state])

    snapshot = server.take_snapshot("unit-test")

    archive = Path(snapshot["path"])
    assert archive.parent == runtime / "snapshots"
    assert archive.exists()
    assert snapshot["reason"] == "unit-test"
    assert snapshot["size_bytes"] > 0
    with tarfile.open(archive, "r:gz") as tar:
        manifest = tar.extractfile("MANIFEST.json").read().decode("utf-8")
        state_text = tar.extractfile("state.json").read().decode("utf-8")
    assert "unit-test" in manifest
    assert "sk-testsecret" not in state_text
    assert "[REDACTED]" in state_text


def test_maintenance_hci_status_distinguishes_dist_and_installed_agent(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()
    dist.joinpath("build-manifest.json").write_text(
        '{"built_at":"2026-05-16T17:00:00Z","head_sha":"abc123456789","head_sha_short":"abc12345","branch":"mission-control-work"}',
        encoding="utf-8",
    )

    def fake_run_git(args, cwd, timeout=3.0):
        if args == ["rev-parse", "HEAD"]:
            return 0, "abc123456789", ""
        if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
            return 0, "mission-control-work", ""
        if args == ["rev-list", "-n", "1", "v0.14.0"]:
            return 128, "", "missing"
        if args == ["rev-list", "-n", "1", "0.14.0"]:
            return 128, "", "missing"
        return 1, "", "unexpected"

    monkeypatch.setattr(server, "MISSION_CONTROL_DIST", dist)
    monkeypatch.setattr(server, "_run_git", fake_run_git)
    monkeypatch.setattr(server, "_hermes_agent_uv_metadata", lambda: ("0.14.0", "def987654321", "uv_pip_show"))
    monkeypatch.setattr(server, "_hermes_agent_version_cmd_metadata", lambda: (None, None, "fallback"))

    payload = server._maintenance_hci_status(tmp_path)

    assert payload["worktree"]["head_sha_short"] == "abc12345"
    assert payload["mission_control"]["running_sha_short"] == "abc12345"
    assert payload["mission_control"]["status"] == "in_sync"
    assert payload["mission_control"]["source"] == "dist_manifest"
    assert payload["hermes_agent"]["installed_version"] == "0.14.0"
    assert payload["hermes_agent"]["installed_sha_short"] == "def98765"
    assert payload["hermes_agent"]["status"] == "reinstall_required"
    assert payload["hermes_agent"]["source"] == "uv_pip_show"


def test_maintenance_hci_status_unknown_without_manifest_or_agent_sha(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    dist.mkdir()

    def fake_run_git(args, cwd, timeout=3.0):
        if args == ["rev-parse", "HEAD"]:
            return 0, "abc123456789", ""
        if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
            return 0, "mission-control-work", ""
        return 1, "", "unexpected"

    monkeypatch.setattr(server, "MISSION_CONTROL_DIST", dist)
    monkeypatch.setattr(server, "_run_git", fake_run_git)
    monkeypatch.setattr(server, "_hermes_agent_uv_metadata", lambda: ("0.14.0", None, "fallback"))
    monkeypatch.setattr(server, "_hermes_agent_version_cmd_metadata", lambda: (None, None, "fallback"))

    payload = server._maintenance_hci_status(tmp_path)

    assert payload["mission_control"]["running_sha"] is None
    assert payload["mission_control"]["status"] == "unknown"
    assert payload["mission_control"]["source"] == "fallback"
    assert payload["hermes_agent"]["installed_sha"] is None
    assert payload["hermes_agent"]["status"] == "unknown"
    assert payload["hermes_agent"]["source"] == "fallback"



def test_update_all_endpoint_runs_rebuild_reinstall_and_schedules_restart(tmp_path, monkeypatch):
    home = tmp_path / "home"
    mc_home = home / "mission_control"
    state = mc_home / "state.json"
    state.parent.mkdir(parents=True)
    state.write_text('{"version":1}', encoding="utf-8")
    dist = mc_home / "dist"
    dist.mkdir(parents=True)
    source_dist = tmp_path / "repo" / "hermes_cli" / "mission_control_dist"
    source_dist.mkdir(parents=True)
    source_dist.joinpath("build-manifest.json").write_text('{"head_sha":"abc","head_sha_short":"abc"}', encoding="utf-8")
    web_root = tmp_path / "repo" / "mission_control_web"
    web_root.mkdir(parents=True)

    monkeypatch.setattr(server, "PROJECT_ROOT", tmp_path / "repo")
    monkeypatch.setattr(server, "MISSION_CONTROL_DIST", dist)
    monkeypatch.setattr(server, "get_mission_control_home", lambda: mc_home)
    monkeypatch.setattr(server, "get_mission_control_state_path", lambda: state)
    monkeypatch.setattr(server, "_mission_control_web_root", lambda: web_root)
    monkeypatch.setattr(server, "_maintenance_hci_status", lambda cwd=server.PROJECT_ROOT: {
        "worktree": {"branch": "mission-control-work", "head_sha": "abc", "head_sha_short": "abc"},
        "mission_control": {"running_sha": "old", "running_sha_short": "old", "running_built_at": None, "status": "rebuild_required", "source": "dist_manifest"},
        "hermes_agent": {"installed_version": "0.14.0", "installed_sha": "old", "installed_sha_short": "old", "status": "reinstall_required", "source": "uv_pip_show", "source_label": "uv pip"},
        "checked_at": "now",
    })
    commands = []
    def fake_run(args, cwd, timeout=120.0):
        commands.append(args)
        return True, "$ " + " ".join(args)
    monkeypatch.setattr(server, "_run_operation_command", fake_run)
    monkeypatch.setattr(server, "_operation_restart_gateway", lambda: {"ok": True, "method": "launchctl_kickstart", "label": "ai.hermes.gateway"})
    monkeypatch.setattr(server, "_wait_for_gateway_env", lambda timeout_seconds=12.0: (True, "ok"))
    monkeypatch.setattr(server, "_find_mission_control_launch_label", lambda: "com.hermes.mission-control-9120")
    scheduled = []
    monkeypatch.setattr(server, "_schedule_mission_control_launchagent_restart", lambda label: scheduled.append(label))

    status_code, payload = server._operation_update_all_v2(None)

    assert status_code == 200
    assert payload["ok"] is True
    assert payload["scheduled_mc_restart"] is True
    assert (dist / "build-manifest.json").exists()
    assert ["npm", "run", "build"] in commands
    assert any(cmd[1:4] == ["pip", "install", "--python"] for cmd in commands)
    assert scheduled == ["com.hermes.mission-control-9120"]
    assert not (mc_home / ".update-all.lock").exists()
    job_status, job_payload = server._update_all_status_payload(payload["job_id"])
    assert job_status == 200
    assert job_payload["job_id"] == payload["job_id"]
    assert {step["name"]: step["status"] for step in job_payload["steps"]}["restart_mc"] in {"scheduled", "ok"}


def test_update_all_endpoint_returns_409_for_fresh_lock(tmp_path, monkeypatch):
    mc_home = tmp_path / "mission_control"
    mc_home.mkdir(parents=True)
    monkeypatch.setattr(server, "get_mission_control_home", lambda: mc_home)
    monkeypatch.setattr(server, "_maintenance_hci_status", lambda cwd=server.PROJECT_ROOT: {
        "worktree": {"branch": "mission-control-work", "head_sha": "abc", "head_sha_short": "abc"},
        "mission_control": {"running_sha": "old", "running_sha_short": "old", "running_built_at": None, "status": "rebuild_required", "source": "dist_manifest"},
        "hermes_agent": {"installed_version": "0.14.0", "installed_sha": "abc", "installed_sha_short": "abc", "status": "in_sync", "source": "uv_pip_show"},
        "checked_at": "now",
    })
    (mc_home / ".update-all.lock").write_text('{"job_id":"existing-job"}', encoding="utf-8")

    status_code, payload = server._operation_update_all_v2(None)

    assert status_code == 409
    assert payload["job_id"] == "existing-job"


def test_update_all_status_unknown_returns_404(tmp_path, monkeypatch):
    mc_home = tmp_path / "mission_control"
    mc_home.mkdir(parents=True)
    monkeypatch.setattr(server, "get_mission_control_home", lambda: mc_home)

    status_code, payload = server._update_all_status_payload("00000000-0000-0000-0000-000000000000")

    assert status_code == 404
    assert payload["ok"] is False
