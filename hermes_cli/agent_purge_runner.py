from __future__ import annotations

import json

from hermes_cli import entities as entities_service


def main() -> int:
    result = entities_service.purge_due_agents()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
