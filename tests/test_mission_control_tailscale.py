from __future__ import annotations

import hashlib
import json
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from hermes_cli import mission_control_server as server


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


@pytest.fixture(autouse=True)
def assert_real_state_unchanged():
    before = _sha256(server.MISSION_CONTROL_STATE_PATH)
    yield
    after = _sha256(server.MISSION_CONTROL_STATE_PATH)
    assert after == before


def _client():
    return TestClient(server.app), {"Authorization": f"Bearer {server.SESSION_TOKEN}"}


def test_tailscale_status_reports_not_installed(monkeypatch):
    def missing_binary(*_args, **_kwargs):
        raise FileNotFoundError("tailscale")

    monkeypatch.setattr(server.subprocess, "run", missing_binary)
    client, headers = _client()

    response = client.get("/api/system/tailscale-status", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "installed": False,
        "signed_in": False,
        "version": None,
        "hostname": None,
        "tailscale_ip": None,
        "self_name": None,
        "exit_code": None,
        "error_summary": "tailscale command not found",
    }


def test_tailscale_status_reports_signed_in(monkeypatch):
    payload = {
        "Version": "1.78.3",
        "Self": {
            "DNSName": "machine-name.tailnet.ts.net.",
            "HostName": "machine-name",
            "TailscaleIPs": ["100.64.0.10"],
        },
    }

    def successful_status(*_args, **_kwargs):
        return SimpleNamespace(returncode=0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr(server.subprocess, "run", successful_status)
    client, headers = _client()

    response = client.get("/api/system/tailscale-status", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "installed": True,
        "signed_in": True,
        "version": "1.78.3",
        "hostname": "machine-name.tailnet.ts.net",
        "tailscale_ip": "100.64.0.10",
        "self_name": "machine-name",
        "exit_code": 0,
    }


def test_tailscale_status_reports_signed_out(monkeypatch):
    def logged_out(*_args, **_kwargs):
        return SimpleNamespace(returncode=1, stdout=json.dumps({"Version": "1.78.3"}), stderr="Logged out")

    monkeypatch.setattr(server.subprocess, "run", logged_out)
    client, headers = _client()

    response = client.get("/api/system/tailscale-status", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "installed": True,
        "signed_in": False,
        "version": "1.78.3",
        "hostname": None,
        "tailscale_ip": None,
        "self_name": None,
        "exit_code": 1,
        "error_summary": "Logged out",
    }


def test_tailscale_status_reports_timeout(monkeypatch):
    def timeout(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(cmd=["tailscale", "status", "--json"], timeout=3)

    monkeypatch.setattr(server.subprocess, "run", timeout)
    client, headers = _client()

    response = client.get("/api/system/tailscale-status", headers=headers)

    assert response.status_code == 200
    assert response.json() == {
        "installed": None,
        "signed_in": False,
        "version": None,
        "hostname": None,
        "tailscale_ip": None,
        "self_name": None,
        "exit_code": None,
        "error_summary": "Timeout",
    }
