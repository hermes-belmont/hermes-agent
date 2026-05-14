from __future__ import annotations

import json
import sys

from hermes_cli.briefings import run_briefing_sweep


def main() -> int:
    if "--check-import" in sys.argv[1:]:
        print(json.dumps({"ok": True, "mode": "check-import", "runner": "hermes_cli.briefings_runner"}, ensure_ascii=False))
        return 0
    try:
        briefing = run_briefing_sweep(triggered_by="scheduled")
        print(json.dumps({"ok": True, "id": briefing.get("id"), "summary": briefing.get("summary")}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
