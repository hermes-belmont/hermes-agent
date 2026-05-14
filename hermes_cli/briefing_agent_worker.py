from __future__ import annotations

import json
import sys
import traceback

from hermes_cli.briefings import parse_agent_response, query_agent


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    agent = payload.get("agent") or {}
    prompt = str(payload.get("prompt") or "")
    timeout_seconds = int(payload.get("timeout_seconds") or 90)
    try:
        response = query_agent(agent, prompt, timeout_seconds=timeout_seconds)
        parsed_items, notes_for_david, outgoing_messages, parse_error = parse_agent_response(response)
        print(json.dumps({
            "ok": True,
            "response": response,
            "parsed_items": parsed_items,
            "notes_for_david": notes_for_david,
            "outgoing_messages": outgoing_messages,
            "parse_error": parse_error,
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
