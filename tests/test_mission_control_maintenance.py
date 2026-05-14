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
