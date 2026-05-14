from __future__ import annotations

import json
from pathlib import Path

import pytest

from hermes_cli import briefings, tracked_items


def test_parse_agent_response_extracts_json_items():
    raw = 'prefix {"items":[{"title":"Tax filing","due":"Friday","priority":"high","reason":"Deadline"}],"notes_for_david":"Review docs"} suffix'

    items, notes, outgoing, error = briefings.parse_agent_response(raw)

    assert error is None
    assert outgoing is None
    assert items == [{"title": "Tax filing", "due": "Friday", "priority": "high", "reason": "Deadline", "source": "agent_inference"}]
    assert notes == "Review docs"


def test_run_briefing_sweep_persists_json_and_markdown(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({
        "agents": [
            {"id": "agent_2fbf94bf93", "name": "Customs Director"},
            {"id": "agent_finance", "name": "Financial Analyst"},
        ],
        "conversations": [],
        "audit_log": [],
    }))
    monkeypatch.setattr(briefings, "BRIEFINGS_DIR", tmp_path / "briefings")
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(briefings, "CONFIG_PATH", tmp_path / "briefings-config.json")
    monkeypatch.setattr(briefings, "LOCK_PATH", tmp_path / "briefings.lock")
    monkeypatch.setattr(briefings, "RUN_STATUS_PATH", tmp_path / "briefings-run-status.json")
    monkeypatch.setattr(briefings, "DEFAULT_AGENT_IDS", ["agent_2fbf94bf93", "agent_finance"])

    def fake_query(agent, prompt, timeout_seconds=90):
        return '{"items":[{"title":"Call vendor","due":"Tomorrow","priority":"medium","reason":"Keep timeline moving"}],"notes_for_david":"No blockers"}'

    monkeypatch.setattr(briefings, "query_agent_with_timeout", fake_query)

    result = briefings.run_briefing_sweep("manual")

    assert result["triggered_by"] == "manual"
    assert result["summary"]["total_items"] == 2
    assert result["summary"]["by_agent"] == {"Customs Director": 1, "Financial Analyst": 1}
    assert (tmp_path / "briefings" / f"{result['id']}.json").exists()
    markdown = (tmp_path / "briefings" / f"{result['id']}.md").read_text()
    assert "# Daily Briefing" in markdown
    assert "Call vendor" in markdown


def test_classify_briefing_error_known_modes():
    cases = [
        ({"error_detail": "HTTP 429: rate limit exceeded"}, "Provider rate-limited (429)"),
        ({"error_detail": "HTTP 401: unauthorized authentication failed"}, "Provider auth failed (401)"),
        ({"error": "Request timed out waiting for provider"}, "Provider timed out"),
        ({"exit_code": 1, "error_detail": ""}, "Agent process exited (code 1)"),
        ({"timed_out": True, "timeout_seconds": 90}, "Agent process killed (timeout after 90s)"),
        ({"invalid_json": True, "raw_response": "not json"}, "Invalid JSON in agent response"),
        ({"error": "Something strange happened"}, "Unknown error"),
    ]

    for payload, expected in cases:
        classified = briefings.classify_briefing_error(**payload)
        assert classified["error_class"] == expected


def test_agent_result_preserves_subprocess_stderr(monkeypatch):
    target = {"label": "Customs Director", "agent_id": "agent_2fbf94bf93", "agent": {"id": "agent_2fbf94bf93", "name": "Customs Director"}}

    def fake_query(agent, prompt, timeout_seconds=90):
        raise briefings.AgentSubprocessError("worker failed", stderr="Traceback: No module named yaml", exit_code=1)

    monkeypatch.setattr(briefings, "query_agent_with_timeout", fake_query)

    result = briefings._agent_result(target)

    assert result["error_class"] == "Unknown error"
    assert result["error_detail"] == "Traceback: No module named yaml"
    assert result["exit_code"] == 1


def test_briefing_pipeline_injects_tracked_items_and_marks_briefed(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_2fbf94bf93", "name": "Customs Director"}], "conversations": [], "audit_log": []}))
    monkeypatch.setattr(briefings, "BRIEFINGS_DIR", tmp_path / "briefings")
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(briefings, "CONFIG_PATH", tmp_path / "briefings-config.json")
    monkeypatch.setattr(briefings, "LOCK_PATH", tmp_path / "briefings.lock")
    monkeypatch.setattr(briefings, "RUN_STATUS_PATH", tmp_path / "briefings-run-status.json")
    monkeypatch.setattr(briefings, "DEFAULT_AGENT_IDS", ["agent_2fbf94bf93"])
    monkeypatch.setattr(tracked_items, "TRACKED_ITEMS_DIR", tmp_path / "tracked-items")
    item = tracked_items.save_item("agent_2fbf94bf93", {"agent_id": "agent_2fbf94bf93", "title": "Restock listings on Amazon FBA Q3", "description": "Review inventory risk", "category": "recurring", "recurrence": "monthly", "priority": "high", "status": "active", "tags": ["seed"]})
    seen_prompts = []

    def fake_query(agent, prompt, timeout_seconds=90):
        seen_prompts.append(prompt)
        return {"response": json.dumps({"items": [{"title": "Restock listings on Amazon FBA Q3", "due": "this week", "priority": "high", "reason": "Monthly recurrence is relevant", "source": item["id"]}], "notes_for_david": "Seed surfaced"}), "stdout": "", "stderr": "", "exit_code": 0}

    monkeypatch.setattr(briefings, "query_agent_with_timeout", fake_query)

    result = briefings.run_briefing_sweep("manual")

    assert "Daily briefing check-in" in seen_prompts[0]
    assert item["id"] in seen_prompts[0]
    agent_result = result["agents"][0]
    assert agent_result["tracked_items_count"] == 1
    assert agent_result["briefed_items_count"] == 1
    assert agent_result["inferred_items_count"] == 0
    refreshed = tracked_items.load_items_for_agent("agent_2fbf94bf93")[0]
    assert refreshed["last_briefed_at"] is not None

def test_registry_label_lookup_uses_registry_and_falls_back(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_ab9825e9ca", "name": "Holdings Operator"}]}))
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)

    assert briefings.registry_label_for_agent("agent_ab9825e9ca", "Fallback Label") == "Holdings Operator"
    assert briefings.registry_label_for_agent("missing", "Fallback Label") == "Fallback Label"


def test_resolve_agent_targets_uses_registry_label_not_hardcoded(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_ab9825e9ca", "name": "Registry Holdings Label"}]}))
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)

    targets = briefings.resolve_agent_targets(["agent_ab9825e9ca"])

    assert targets[0]["label"] == "Registry Holdings Label"
    assert targets[0]["label"] != "Holdings Operator"


def test_config_validation_rejects_unknown_agent(tmp_path, monkeypatch):
    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_ok", "name": "Known"}]}))
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(briefings, "CONFIG_PATH", tmp_path / "briefings-config.json")

    with pytest.raises(ValueError, match="Unknown briefing agent id"):
        briefings.save_config({"enabled": True, "time_local": "08:00", "days_of_week": ["mon"], "agents": ["missing"]})


def test_briefing_pipeline_injects_inbox_summary_when_unread_exists(tmp_path, monkeypatch):
    from hermes_cli import messages

    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_a", "name": "Sender Agent"}, {"id": "agent_b", "name": "Recipient Agent"}], "conversations": [], "audit_log": []}))
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path / "messages")
    messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Decision needed", "body": "Please review", "priority": "high", "related_entity": "holdings"})

    prompt_context = briefings.build_prompt_context("agent_b", [])

    assert prompt_context["active_items_for_briefing"] == []
    summary = prompt_context["inbox_summary_for_briefing"][0]
    assert summary["id"].startswith("msg_")
    assert summary["thread_id"].startswith("thread_")
    assert summary["from_agent_id"] == "agent_a"
    assert summary["from_agent_label"] == "Sender Agent"
    assert summary["subject"] == "Decision needed"
    assert summary["priority"] == "high"
    assert summary["related_entity"] == "holdings"
    prompt = briefings.build_briefing_prompt("agent_b", [])
    assert "inbox_summary_for_briefing" in prompt
    assert "Sender Agent" in prompt


def test_briefing_pipeline_omits_inbox_summary_when_empty(tmp_path, monkeypatch):
    from hermes_cli import messages

    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"agents": [{"id": "agent_b", "name": "Recipient Agent"}], "conversations": [], "audit_log": []}))
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path / "messages")

    prompt_context = briefings.build_prompt_context("agent_b", [])

    assert "inbox_summary_for_briefing" not in prompt_context
    prompt = briefings.build_briefing_prompt("agent_b", [])
    assert '"inbox_summary_for_briefing"' not in prompt



def _setup_outgoing_briefing(tmp_path, monkeypatch):
    from hermes_cli import messages

    state_path = tmp_path / "mission_control" / "state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({
        "agents": [
            {"id": "agent_a", "name": "Agent A", "business_function": "Ops", "operating_entity": "holdings"},
            {"id": "agent_b", "name": "Agent B", "business_function": "Finance", "operating_entity": "holdings"},
            {"id": "agent_c", "name": "Agent C", "business_function": "Media", "operating_entity": "media"},
        ]
    }))
    monkeypatch.setattr(briefings, "BRIEFINGS_DIR", tmp_path / "briefings")
    monkeypatch.setattr(briefings, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(briefings, "CONFIG_PATH", tmp_path / "briefings-config.json")
    monkeypatch.setattr(briefings, "LOCK_PATH", tmp_path / "briefings.lock")
    monkeypatch.setattr(briefings, "RUN_STATUS_PATH", tmp_path / "briefings-run-status.json")
    monkeypatch.setattr(briefings, "DEFAULT_AGENT_IDS", ["agent_a"])
    monkeypatch.setattr(messages, "MISSION_CONTROL_STATE_PATH", state_path)
    monkeypatch.setattr(messages, "MESSAGES_DIR", tmp_path / "messages")
    monkeypatch.setattr(messages, "MESSAGING_AUDIT_LOG_PATH", tmp_path / "messaging-audit.log")
    monkeypatch.setattr(tracked_items, "TRACKED_ITEMS_DIR", tmp_path / "tracked-items")
    return messages


def _run_one_agent_outgoing(tmp_path, monkeypatch, outgoing_messages):
    messages = _setup_outgoing_briefing(tmp_path, monkeypatch)

    def fake_query(agent, prompt, timeout_seconds=90):
        return {"response": json.dumps({"items": [], "outgoing_messages": outgoing_messages}), "stdout": "", "stderr": "", "exit_code": 0}

    monkeypatch.setattr(briefings, "query_agent_with_timeout", fake_query)
    return briefings.run_briefing_sweep("manual"), messages


def test_agent_response_valid_outgoing_message_sent_and_audited(tmp_path, monkeypatch):
    result, messages = _run_one_agent_outgoing(tmp_path, monkeypatch, [{"to_agent_id": "agent_b", "subject": "Need input", "body": "Please review", "priority": "high", "related_entity": "holdings"}])

    agent_result = result["agents"][0]
    assert agent_result["outgoing_messages_count"] == 1
    sent = agent_result["outgoing_messages_sent"][0]
    assert sent["to_agent_label"] == "Agent B"
    assert messages.inbox("agent_b")["messages"][0]["subject"] == "Need input"
    audit = (tmp_path / "messaging-audit.log").read_text().strip().splitlines()
    assert json.loads(audit[-1])["status"] == "sent"


def test_agent_response_three_valid_messages_all_sent(tmp_path, monkeypatch):
    outgoing = [{"to_agent_id": "agent_b", "subject": f"Need input {i}", "body": "Please review"} for i in range(3)]
    result, messages = _run_one_agent_outgoing(tmp_path, monkeypatch, outgoing)

    assert result["agents"][0]["outgoing_messages_count"] == 3
    assert messages.inbox("agent_b")["total"] == 3


def test_agent_response_four_messages_truncates_fourth(tmp_path, monkeypatch):
    outgoing = [{"to_agent_id": "agent_b", "subject": f"Need input {i}", "body": "Please review"} for i in range(4)]
    result, messages = _run_one_agent_outgoing(tmp_path, monkeypatch, outgoing)

    agent_result = result["agents"][0]
    assert agent_result["outgoing_messages_count"] == 3
    assert messages.inbox("agent_b")["total"] == 3
    assert agent_result["outgoing_messages_rejected"] == [{"to_agent_id": "agent_b", "subject": "Need input 3", "reason": "exceeded cap of 3, truncated"}]


def test_agent_response_self_send_and_unknown_rejected(tmp_path, monkeypatch):
    outgoing = [
        {"to_agent_id": "agent_a", "subject": "Self", "body": "No"},
        {"to_agent_id": "missing", "subject": "Unknown", "body": "No"},
    ]
    result, _messages = _run_one_agent_outgoing(tmp_path, monkeypatch, outgoing)

    rejected = result["agents"][0]["outgoing_messages_rejected"]
    assert [item["reason"] for item in rejected] == ["self-send rejected", "to_agent_id not in registry"]
    assert result["agents"][0]["outgoing_messages_count"] == 0


def test_agent_response_valid_in_reply_to_inherits_thread(tmp_path, monkeypatch):
    messages = _setup_outgoing_briefing(tmp_path, monkeypatch)
    parent = messages.create_message({"from_agent_id": "agent_b", "to_agent_id": "agent_a", "subject": "Parent", "body": "Please reply"})

    def fake_query(agent, prompt, timeout_seconds=90):
        return {"response": json.dumps({"items": [], "outgoing_messages": [{"to_agent_id": "agent_b", "subject": "Re: Parent", "body": "Replying", "in_reply_to": parent["id"]}]}), "stdout": "", "stderr": "", "exit_code": 0}

    monkeypatch.setattr(briefings, "query_agent_with_timeout", fake_query)
    result = briefings.run_briefing_sweep("manual")

    sent_id = result["agents"][0]["outgoing_messages_sent"][0]["msg_id"]
    reply = messages.get_message(sent_id, "agent_b")
    assert reply["thread_id"] == parent["thread_id"]
    assert reply["in_reply_to"] == parent["id"]
    assert messages.get_message(parent["id"], "agent_a")["status"] == "sent"


def test_agent_response_in_reply_to_not_in_inbox_rejected(tmp_path, monkeypatch):
    messages = _setup_outgoing_briefing(tmp_path, monkeypatch)
    not_in_inbox = messages.create_message({"from_agent_id": "agent_a", "to_agent_id": "agent_b", "subject": "Sent by A", "body": "Not A inbox"})

    result, _messages = _run_one_agent_outgoing(tmp_path, monkeypatch, [{"to_agent_id": "agent_b", "subject": "Re", "body": "No", "in_reply_to": not_in_inbox["id"]}])

    assert result["agents"][0]["outgoing_messages_rejected"][0]["reason"] == "in_reply_to not in inbox"


def test_empty_outgoing_messages_no_audit_entries(tmp_path, monkeypatch):
    result, _messages = _run_one_agent_outgoing(tmp_path, monkeypatch, [])

    assert result["agents"][0]["outgoing_messages_count"] == 0
    assert result["agents"][0]["outgoing_messages_sent"] == []
    assert not (tmp_path / "messaging-audit.log").exists()


def test_malformed_outgoing_messages_rejected_but_briefing_succeeds(tmp_path, monkeypatch):
    result, _messages = _run_one_agent_outgoing(tmp_path, monkeypatch, {"not": "an array"})

    agent_result = result["agents"][0]
    assert agent_result["status"] == "ok"
    assert agent_result["outgoing_messages_rejected"][0]["reason"] == "outgoing_messages must be an array"

    result2, _messages2 = _run_one_agent_outgoing(tmp_path / "second", monkeypatch, [{"to_agent_id": "agent_b", "body": "Missing subject"}])
    assert result2["agents"][0]["outgoing_messages_rejected"][0]["reason"] == "subject missing"


def test_briefing_summary_outgoing_messages_total_matches_agent_counts(tmp_path, monkeypatch):
    result, _messages = _run_one_agent_outgoing(tmp_path, monkeypatch, [
        {"to_agent_id": "agent_b", "subject": "One", "body": "Body"},
        {"to_agent_id": "agent_c", "subject": "Two", "body": "Body"},
    ])

    assert result["summary"]["outgoing_messages_total"] == sum(agent["outgoing_messages_count"] for agent in result["agents"])


def test_prompt_includes_agent_roster_and_outgoing_message_instructions(tmp_path, monkeypatch):
    _setup_outgoing_briefing(tmp_path, monkeypatch)

    prompt = briefings.build_briefing_prompt("agent_a", [])

    assert "AGENT ROSTER" in prompt
    assert '"agent_id": "agent_b"' in prompt
    assert '"label": "Agent B"' in prompt
    assert "OUTGOING MESSAGES INSTRUCTIONS" in prompt
    assert "You may NOT message yourself." in prompt
    assert '"outgoing_messages"' in prompt
