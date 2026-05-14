# Mission Control Implementation Plan

> For Hermes: Use subagent-driven-development skill to implement this plan task-by-task.

Goal: Ship a standalone Mission Control app on localhost:9120 with a separate FastAPI + Vite surface for agent operations, chat, governance, persistence, and observability.

Architecture: Add a new mission_control_web Vite app and a new hermes_cli/mission_control_server.py backend. Persist Mission Control agent + conversation metadata in ~/.hermes/mission_control/state.json while reusing Hermes SessionDB for actual transcript/token/cost storage. Keep Dashboard unchanged on 9119 and reuse only style patterns, not Dashboard internals.

Tech Stack: FastAPI, uvicorn, React 19, TypeScript, Vite, Tailwind v4, existing Hermes AIAgent + SessionDB.

---

### Task 1: Inspect live repo patterns and select low-risk integration points
Objective: Reuse stack and visual primitives without coupling Mission Control to Dashboard internals.
Files:
- Inspect: web/package.json, web/src/App.tsx, web/src/index.css, web/src/lib/api.ts, hermes_cli/web_server.py, hermes_cli/chat_api.py, hermes_state.py, hermes_cli/main.py
- Create: docs/plans/2026-04-19-mission-control.md

### Task 2: Create Mission Control backend surface
Objective: Add a separate FastAPI app with dedicated endpoints, storage, and SPA mounting.
Files:
- Create: hermes_cli/mission_control_server.py
- Modify: hermes_cli/main.py

### Task 3: Create standalone Mission Control frontend shell
Objective: Add a dedicated Vite app with Dashboard-aligned styling and a 3-panel layout.
Files:
- Create: mission_control_web/package.json
- Create: mission_control_web/tsconfig.json
- Create: mission_control_web/tsconfig.app.json
- Create: mission_control_web/tsconfig.node.json
- Create: mission_control_web/eslint.config.js
- Create: mission_control_web/vite.config.ts
- Create: mission_control_web/src/*

### Task 4: Implement vertical slices end-to-end
Objective: Ship usable CRUD, conversation navigation, chat, config editing, persistence, and governance views.
Files:
- Create: mission_control_web/src/lib/api.ts, lib/types.ts, lib/utils.ts
- Create: mission_control_web/src/components/*
- Create: mission_control_web/src/App.tsx, main.tsx, index.css
- Modify: hermes_cli/mission_control_server.py

### Task 5: Build and validate
Objective: Confirm Mission Control builds, serves on 9120, and core flows work without affecting Dashboard on 9119.
Files:
- Run: npm install/build/lint for mission_control_web
- Run: python -m py_compile hermes_cli/mission_control_server.py hermes_cli/main.py
- Run: local HTTP smoke tests for 9119 and 9120
