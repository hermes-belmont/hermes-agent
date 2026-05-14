from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from hermes_cli import tracked_items


def _patch_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(tracked_items, "TRACKED_ITEMS_DIR", tmp_path / "tracked-items")


def test_schema_validation_rejects_invalid_enums(tmp_path, monkeypatch):
    _patch_dir(tmp_path, monkeypatch)
    base = {"agent_id": "agent_a", "title": "Valid", "category": "watch", "priority": "medium", "status": "active"}
    for field, value in [("category", "bad"), ("priority", "urgent"), ("status", "open"), ("recurrence", "biweekly")]:
        payload = dict(base)
        payload[field] = value
        with pytest.raises(ValueError, match=field):
            tracked_items.save_item("agent_a", payload)


def test_atomic_write_read_round_trip(tmp_path, monkeypatch):
    _patch_dir(tmp_path, monkeypatch)
    saved = tracked_items.save_item("agent_a", {
        "agent_id": "agent_a",
        "entity": "media",
        "title": "Client launch",
        "description": "Launch campaign",
        "category": "deadline",
        "due_date": "2026-05-18",
        "priority": "high",
        "status": "active",
        "tags": ["launch"],
        "source": "manual",
    })
    loaded = tracked_items.load_items_for_agent("agent_a")
    assert loaded == [saved]
    assert saved["id"]
    assert saved["created_at"]
    assert not list((tmp_path / "tracked-items").glob("*.tmp"))


def test_active_items_for_briefing_date_filter_logic(tmp_path, monkeypatch):
    _patch_dir(tmp_path, monkeypatch)
    today = datetime(2026, 5, 13, tzinfo=timezone.utc)
    monkeypatch.setattr(tracked_items, "_now", lambda: today)
    near = tracked_items.save_item("agent_a", {"agent_id": "agent_a", "title": "Near", "category": "deadline", "due_date": "2026-05-20", "priority": "medium", "status": "active"})
    far = tracked_items.save_item("agent_a", {"agent_id": "agent_a", "title": "Far", "category": "deadline", "due_date": "2026-07-20", "priority": "medium", "status": "active"})
    recurring = tracked_items.save_item("agent_a", {"agent_id": "agent_a", "title": "Monthly close", "category": "recurring", "recurrence": "monthly", "priority": "high", "status": "active"})
    snoozed = tracked_items.save_item("agent_a", {"agent_id": "agent_a", "title": "Snoozed", "category": "watch", "priority": "low", "status": "snoozed"})

    active_ids = {item["id"] for item in tracked_items.active_items_for_briefing("agent_a")}
    assert near["id"] in active_ids
    assert recurring["id"] in active_ids
    assert far["id"] not in active_ids
    assert snoozed["id"] not in active_ids


def test_status_action_updates_item(tmp_path, monkeypatch):
    _patch_dir(tmp_path, monkeypatch)
    item = tracked_items.save_item("agent_a", {"agent_id": "agent_a", "title": "Thing", "category": "watch", "priority": "medium", "status": "active"})
    updated = tracked_items.apply_action(item["id"], "done")
    assert updated["status"] == "done"
    assert updated["updated_at"] >= item["updated_at"]
