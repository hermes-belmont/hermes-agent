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
