# Mission Control LLM Handoff Pack

## Purpose

This document is a continuation handoff for an LLM or Hermes Agent session to pick up exactly where the previous Mission Control work ended. It consolidates the product intent, current system state, architecture, paths, runtime targets, validation results, known caveats, and recommended next steps.

Use this as the source context before making any further changes.

---

## 1. Product Intent

Mission Control is a premium operating console for **true Agents** that help build, operate, and scale businesses under an LLC / holdings-company model.

It is **not** a sub-agent manager. Avoid these terms:

- sub-agent
- sub agent
- subagent

Preferred framing:

- Agent
- Operating entity
- Business function
- Persistent memory
- Operating continuity
- Tools / permissions
- Model routing
- Route / provider transparency
- Status / reliability
- Lifecycle

The conceptual structure is:

- Parent organization / holdings company
- Operating entities
- Business functions
- Durable Agents
- Persistent memory
- Model routing
- Tool permissions
- Status / reliability
- Lifecycle controls
- Conversation workspace

The UI should feel like an executive-grade operating system for Agents, not a toy chatbot dashboard.

---

## 2. Canonical URLs and Runtime Targets

### Canonical Mission Control target

```text
http://localhost:9120
```

### Dashboard reference target

```text
http://localhost:9119
```

Dashboard is a separate product surface. It was used as the visual reference for Mission Control styling, but must remain untouched unless explicitly requested.

### External Mission Control URL

```text
https://app.umbrellacorporation.co
```

CloudFlare Tunnel external URL, gated by CloudFlare Zero Trust Access.

### Important runtime correction already made

Earlier, `localhost:9120` was incorrectly being served by a Vite dev shell proxying API calls to the Dashboard server on `localhost:9119`, which caused:

```text
POST /api/mission-control/conversations -> 405 Method Not Allowed
POST /api/mission-control/chat/stream -> 405 Method Not Allowed
```

Hermes fixed this. `localhost:9120` now serves the real Mission Control server.

If those 405 failures appear again, first verify whether `localhost:9120` is really serving the Mission Control backend or a Vite proxy layer.

---

## 3. Core Local Paths

### Source repo

```text
/Users/hermes-agent/.hermes/hermes-agent
```

### Mission Control frontend source

```text
/Users/hermes-agent/.hermes/hermes-agent/mission_control_web
```

### Mission Control backend

```text
/Users/hermes-agent/.hermes/hermes-agent/hermes_cli/mission_control_server.py
```

### Mission Control dist output

```text
/Users/hermes-agent/.hermes/hermes-agent/hermes_cli/mission_control_dist
```

### Runtime frontend mirror

```text
/Users/hermes-agent/.hermes/runtime/mission_control_web
```

During earlier phases, Hermes mirrored frontend changes here because the live process was served from runtime. Future agents should inspect the active listener/runtime before assuming the live path.

### Desktop UI working copy

```text
/Users/hermes-agent/Desktop/Mission Control UI Working Copy
```

Primary editable working copy path:

```text
/Users/hermes-agent/Desktop/Mission Control UI Working Copy/02 - Editable Working Copy/mission_control_web
```

### Stable checkpoint folder

```text
/Users/hermes-agent/Desktop/mission-control-stable-checkpoint-2026-04-28
```

Latest checkpoint archive:

```text
/Users/hermes-agent/Desktop/mission-control-stable-checkpoint-2026-04-28/mission-control-stable-checkpoint-2026-04-28.tar.gz
```

Latest SHA256 file:

```text
/Users/hermes-agent/Desktop/mission-control-stable-checkpoint-2026-04-28/mission-control-stable-checkpoint-2026-04-28.tar.gz.sha256
```

Latest checkpoint hash:

```text
f082bab5765f20bc91060249faa7317196f97dbb5185cb31817dce3175007bc1
```

---

## 4. Google Drive / Desktop Handoff Workflow

Hermes does **not** have reliable authenticated Google Drive access.

Established workflow:

1. Hermes prepares or refreshes files on the Desktop.
2. The user manually replaces the matching Google Drive folders.
3. If Google Drive has newer files, the user manually copies them back to the Desktop working copy.
4. Hermes then syncs Desktop → local repo if needed.
5. Continue development from the local repo.

### Google Drive folder

```text
Hermes Mission Control
```

It contains:

```text
Mission Control UI Working Copy
mission-control-stable-checkpoint-2026-04-28
```

Rule: when replacing Google Drive content, prefer **replace**, not merge, to avoid stale files.

---

## 5. Current Export / Checkpoint Status

The latest export was completed and validated.

Desktop folders refreshed:

```text
/Users/hermes-agent/Desktop/Mission Control UI Working Copy
/Users/hermes-agent/Desktop/mission-control-stable-checkpoint-2026-04-28
```

The UI working copy includes:

```text
eslint.config.js
index.html
package-lock.json
package.json
public/favicon.ico
public/fonts/Collapse-Bold.woff2
public/fonts/Collapse-Regular.woff2
public/fonts/CourierPrime-Bold.woff2
public/fonts/CourierPrime-Regular.woff2
public/fonts/Mondwest-Regular.woff2
public/fonts/RulesCompressed-Medium.woff2
public/fonts/RulesCompressed-Regular.woff2
public/fonts/RulesExpanded-Bold.woff2
public/fonts/RulesExpanded-Regular.woff2
public/theme-backgrounds/theme-1.png
public/theme-backgrounds/theme-2.png
public/theme-backgrounds/theme-3.png
public/theme-backgrounds/theme-4.png
public/theme-backgrounds/theme-5.png
src/App.tsx
src/components/ui/button.tsx
src/components/ui/card.tsx
src/components/ui/input.tsx
src/index.css
src/lib/api.ts
src/lib/themes.ts
src/lib/types.ts
src/lib/utils.ts
src/main.tsx
tsconfig.app.json
tsconfig.json
tsconfig.node.json
vite.config.ts
```

No requested files were missing in the latest export.

The export excluded bulky or generated content such as:

```text
.git
node_modules
__pycache__
.pytest_cache
.mypy_cache
.ruff_cache
.cache
.turbo
coverage
dist
build
.artifacts
.DS_Store
tmp_validation.mjs
tmp_validate_*.mjs
mission_control_dist
venv
.venv
```

---

## 6. Current UI State

Mission Control has been visually aligned closer to the Dashboard UI while preserving Mission Control functionality.

Current visual direction:

- dark premium operating-console aesthetic
- flatter panels
- thinner borders
- less pill-like components
- more rectangular buttons / inputs
- tighter spacing
- denser command-center rhythm
- stronger left navigation / agent rail
- more table/list/row-like structure where appropriate
- retained premium theme backgrounds
- retained pulsing status indicators
- retained Settings sheet pattern
- retained mobile drawer behavior

### Dashboard-inspired changes completed

The Dashboard-inspired pass included:

- reduced global card roundness
- reduced oversized glass / bubble feel
- tighter card header/content spacing
- less pill-like buttons and inputs
- denser Agents rail
- flatter transcript container
- cleaner composer surface
- denser Settings sections
- preserved themes and backend behavior

### Chat readability fixed

Chat messages were previously too small.

Current measured message typography:

Desktop / laptop:

```text
message body: ~16.5px
line-height: ~26.4px
wrapping: overflow-wrap: anywhere
```

Mobile:

```text
message body: ~16px
line-height: ~25.6px
wrapping: overflow-wrap: anywhere
```

This passed readability validation across desktop, 13-inch / 110% style viewport, and mobile.

---

## 7. Current Theme System

Background-enabled themes have been restored.

Themes include:

- Hermes Teal
- Midnight
- Ember
- Mono
- Cyberpunk
- Rosé

Theme assets exist under:

```text
mission_control_web/public/theme-backgrounds/
```

Expected files:

```text
theme-1.png
theme-2.png
theme-3.png
theme-4.png
theme-5.png
```

Themes are selectable in Settings and persist locally.

Do not remove the theme system. If visual updates are needed, tune carefully rather than flattening the UI again.

---

## 8. Status Indicator System

Status dots were upgraded to subtle premium pulse indicators.

State meaning:

- Green = healthy / stable
- Yellow = warning / needs attention / idle / rerouted
- Red = broken / error / critical
- Blue may be used for processing where already present

The pulse animation is intentionally tasteful, not flashy.

Reduced-motion behavior was implemented:

- under `prefers-reduced-motion`, pulse animation should be disabled.

Preserve this system.

---

## 9. Settings IA / Agent Operating Model

Settings was reorganized to feel like an operating system for true Agents.

Current conceptual groupings:

- Agent architecture
- Agent identity
- Model routing
- Tools / permissions
- Persistent memory / context
- Status / reliability
- Route / provider transparency
- Lifecycle
- Themes

### Persistent memory is central

Persistent memory was elevated into a first-class continuity layer.

Key framing currently used:

- Operating continuity ledger
- Memory records in scope
- Injected into each run
- Persistent memory / context
- Operating record
- Durable context

Memory should feel like durable operating context, not casual notes.

Memory ties to:

- Agent identity
- Operating entity
- Business function
- Model routing
- Tools / permissions
- Execution continuity

### Avoid sub-agent language

A scan was run and found no matches for:

```text
sub-agent
sub agent
subagent
```

Maintain that.

---

## 10. Model Catalog and Routing State

A model synchronization issue was fixed.

Problem:

- Settings Preferred Model was switched to `gpt-5.5`
- Workspace still showed `Model gpt-5.4`

Root cause:

- workspace model display prioritized stale conversation/provider/usage metadata instead of the selected agent’s saved `preferred_model`.

Fix:

- workspace/model-chip display now prefers the selected agent’s saved `preferred_model`
- selector population uses `bootstrap.catalog.model_options`
- save/reload/new conversation/message send were validated

Current behavior:

- `gpt-5.5` is selectable
- `gpt-5.4` remains if still present in configured catalog
- changing Preferred Model to `gpt-5.5` updates visible labels without hard refresh
- reload persists the saved model
- new conversations inherit/use/display the correct model
- message sending still works after model changes

Important provider detail:

- Local configured provider is currently `OpenAI Codex`, not Nous Portal.
- Hermes intentionally did **not** relabel bare active-route models as Nous Portal because that would misrepresent the actual route.
- Explicit `openrouter/...` options remain labeled OpenRouter when the internal value is explicitly OpenRouter-prefixed.
- Do not relabel provider options unless the actual configured provider/route supports it.

---

## 11. Backend / API Functionality State

Mission Control backend functionality currently works.

Critical workflows validated:

- page load / bootstrap
- conversation creation
- conversation selection
- sequential message sending
- Settings open/close
- theme switching
- memory/settings safe interaction
- dropdown/select behavior
- checkbox/toggle behavior
- mobile drawer open/close
- mobile Settings open/close

Previously broken route issue was fixed:

```text
POST /api/mission-control/conversations
POST /api/mission-control/chat/stream
```

Both now return success in validated flows.

---

## 12. Recent Validation Results

### Real-use stress pass after blocking fixes

Passed:

- desktop repeated page/bootstrap loads
- desktop concurrent loads
- repeated conversation creation
- repeated conversation selection
- sequential message sending in same conversation
- Settings open/close repetition
- theme switching
- memory/settings safe interaction
- mobile repeated bootstrap loads
- mobile drawer open/close repetition
- mobile settings/theme/memory interaction

Reported:

- failed scenarios: none
- console errors: none
- API failures: none
- request failures: none
- malformed/stuck UI states: none

Classification:

```text
stable enough for continued use
```

### Post-visual-regression stress pass

Passed after Dashboard-inspired visual changes.

Validated:

- desktop page load
- 13-inch / 110% style viewport
- mobile viewport
- conversation creation
- conversation selection
- sequential message sending
- Settings open/close
- theme switching
- memory/settings interaction
- mobile drawer open/close
- mobile Settings open/close
- no horizontal overflow
- no malformed card/button/input geometry
- no console errors
- no request failures
- button/card/input primitive changes did not regress functionality

Classification:

```text
ready for checkpoint/export
```

### Latest checkpoint/export validation

Passed:

- frontend lint
- frontend build
- backend syntax validation
- `http://localhost:9120` health check
- `http://localhost:9119` separation check
- UI working copy source/copy diff check
- archive SHA256 validation
- forbidden archive entries check

---

## 13. Known Non-Blocking Observations

No current blockers at the latest checkpoint.

Known optimization opportunities:

1. Bootstrap/page-load latency
   - Real backend-backed loads may take around 1.2s–1.4s in repeated runs.
   - Not broken, but could be optimized later.

2. Sequential send latency
   - Works correctly.
   - End-to-end duration can be the heaviest scenario due to model round trips.
   - Monitor as transcripts grow.

3. State growth / conversation-list scaling
   - Repeated creation/selection passed.
   - As conversation count grows, bootstrap payload and agent rail may become next pressure points.

4. Long-run memory/settings mutation persistence
   - Safe interaction passed.
   - A deeper test should explicitly save/reload repeated config edits.

5. Multi-agent concurrency
   - Light concurrency passed.
   - Heavier parallel real-use sessions could be a future test area.

6. Native checkbox visual size
   - 16x16 boxes inside larger label rows.
   - Interaction passed, not a blocker.

---

## 14. Recommended Next Step

The latest state is stable and checkpointed. Do **not** continue product/UI changes unless the user asks.

Recommended next phases:

### Option A — Start real usage

Mission Control is stable enough for continued real use.

### Option B — Broader endurance / scale testing

If the user wants to stress test further, run a scale/endurance test focused on:

- long transcripts
- many conversations
- many Agents
- repeated config save/reload
- persistent memory record creation/editing
- concurrent sessions
- Tailscale-accessed sessions
- mobile real-device behavior
- prolonged model sending sessions

### Option C — Performance optimization

If speed becomes a concern, focus on:

- bootstrap payload size
- initial render timing
- conversation list virtualization/pagination if necessary
- deferred loading of lower-priority Settings sections
- model send latency instrumentation

### Option D — Provider / telemetry hardening

If token/cost tracking is prioritized, revisit:

- provider-returned usage metadata
- route telemetry support
- true cost accounting
- cached-token telemetry
- remaining limit telemetry

Do not fabricate token/cost data. If providers do not return usage, UI should state that truthfully.

---

## 15. Safe Prompt Template for Future Hermes Work

```text
Continue from the current local filesystem/runtime state. Do not restart from scratch unless required for validation.

Treat http://localhost:9120 as the canonical Mission Control target.
Dashboard at http://localhost:9119 must remain untouched.

Do not do broad redesign.
Do not do unrelated backend refactors.
Do not change provider credentials.
Do not introduce sub-agent language.
Do not paste full source files in the final response.

Your next slice is:
[small precise slice name]

Implement only this slice.

Scope:
[precise bullet list]

Validation:
- verify localhost:9120 loads
- verify localhost:9119 remains separate
- verify conversation creation still works if any core UI/API is touched
- verify message sending still works if any core UI/API is touched
- verify no console errors
- verify no request failures
- verify no overflow/malformed geometry
- run lint/build where applicable

Return:
1. current state summary
2. findings
3. exact scope implemented
4. files changed
5. validation commands/tests and results
6. blockers/tradeoffs
7. whether ready for continued use/checkpoint
```

---

## 16. Useful Validation Commands

### Frontend lint

```bash
cd /Users/hermes-agent/.hermes/hermes-agent/mission_control_web
npm run lint
```

### Frontend build

```bash
cd /Users/hermes-agent/.hermes/hermes-agent/mission_control_web
npm run build
```

### Backend syntax

```bash
cd /Users/hermes-agent/.hermes/hermes-agent
./venv/bin/python -m py_compile hermes_cli/mission_control_server.py hermes_cli/main.py
```

### Mission Control health

```bash
curl http://localhost:9120
```

### Dashboard separation

```bash
curl http://localhost:9119
```

### Listener check

```bash
lsof -nP -iTCP:9120 -sTCP:LISTEN
```

### Search for forbidden sub-agent wording

```bash
grep -RniE "sub-agent|sub agent|subagent" /Users/hermes-agent/.hermes/hermes-agent/mission_control_web/src /Users/hermes-agent/.hermes/runtime/mission_control_web/src
```

---

## 17. Recovery Notes

If `POST /api/mission-control/conversations` or `POST /api/mission-control/chat/stream` returns `405` again:

1. Check whether `localhost:9120` is serving the real Python/FastAPI Mission Control server or a Vite dev proxy.
2. Confirm `/Users/hermes-agent/.hermes/scripts/start-mission-control-9120.sh`.
3. Confirm LaunchAgent `com.hermes.mission-control-9120`.
4. Confirm `/api` is not being proxied to Dashboard `localhost:9119`.
5. Re-normalize the runtime if needed.

Do not assume the backend routes are missing. They already existed and worked when the correct server served them.

---

## 18. Current Done State

At the end of the chat:

- Mission Control UI is visually aligned closer to Dashboard.
- Chat readability is fixed.
- Theme backgrounds are restored.
- Status dots pulse subtly.
- Persistent memory is central.
- Agents are framed as durable true Agents, not sub-agents.
- Model display sync is fixed.
- `localhost:9120` is canonical.
- Dashboard remains separate at `localhost:9119`.
- Real-use stress testing passed.
- Post-visual-regression stress testing passed.
- Stable checkpoint/export is complete.
- Desktop folders are ready for Google Drive replacement.
- CloudFlare Tunnel is live. `app.umbrellacorporation.co` points to `localhost:9120`.
- CloudFlare Zero Trust Access is active. Only `david@umbrellacorporation.co` is currently authorized. `jack@umbrellacorporation.co` is to be added in a future slice.
- `localhost:9119` remains unexposed externally.
- Analytics panel is live with Hermes local usage, provider route, OpenAI billing (admin key), and rate limit status.
- Nous Dashboard embedded as iframe in Dashboard tab.
- LLC branch agent structure implemented: Umbrella Holdings Group LLC (parent), Umbrella Customs LLC / Umbrella Media LLC / Umbrella Properties LLC (operating entities).
- Director agents created for each entity.
- Workspace stat cards removed.
- Agent-specific Settings wired to workspace SETTINGS.
- Global Settings AGENTS management section added.
- Delete agent capability added.
- Starter prompts customized per director agent.
- Agent rail rebuilt with entity grouping, drag handles, and compact + create button.
- Chat window bottom-anchored, composer fixed at bottom, messages stack from bottom upward.
- Dynamic Prompts bubble integrated into composer bar.
- Sessions drawer added to workspace header.
- OPTIONS button replaces unlabeled ... menu.
- Analytics panel scroll fixed -- all sections reachable.
- Agent name truncation improved in rail cards.
- Full UI checkpoint taken 2026-04-29.
- Analytics HTTP status labels removed from UI.
- Nous Portal card updated with clickable links to localhost:9119/analytics and portal.nousresearch.com/usage.
- Codex Analytics card added to Rate Limit Status section with link to chatgpt.com/codex/cloud/settings/analytics.
- Full UI checkpoint taken 2026-04-30.
- Current checkpoint hash is:

```text
14a76b571f553f502936a0d98bb25c7c9508a194e23b427d304833579ceea07f
```

The next LLM should treat this as a stable, usable build unless the user reports new issues.

---

## 19. CloudFlare Tunnel Configuration

Tunnel name: `hermes-mission-control`
Tunnel ID: `aaa16572-4820-4888-bd7b-2cf15d6d138a`
Account ID: `1279249364da94ff9eab98d82e5a767c`
Zone ID: `b8e743cdd958cbd43eeef7958d982904`
Domain: `umbrellacorporation.co`
External URL: `https://app.umbrellacorporation.co`
Points to: `localhost:9120`
Config file: `/Users/hermes-agent/.cloudflared/config.yml`
Credentials file: `/Users/hermes-agent/.cloudflared/aaa16572-4820-4888-bd7b-2cf15d6d138a.json`
Start script: `/Users/hermes-agent/.hermes/scripts/start-cloudflare-tunnel.sh`
LaunchAgent: `com.hermes.cloudflare-tunnel`
Plist: `~/Library/LaunchAgents/com.hermes.cloudflare-tunnel.plist`
Log: `/Users/hermes-agent/.hermes/logs/cloudflare-tunnel.log`
Error log: `/Users/hermes-agent/.hermes/logs/cloudflare-tunnel-error.log`

Important tunnel boundary:

- `localhost:9120` is exposed externally through `https://app.umbrellacorporation.co`.
- `localhost:9119` is **not** exposed via this tunnel.
- Dashboard remains separate and local-only at `localhost:9119`.

CloudFlare API token reference:

- Token name: `Hermes Mission Control Tunnel`
- Token value: intentionally omitted. Do not store the token value in this document.

## 20. CloudFlare Zero Trust Access Configuration

Zero Trust org auth domain: `umbrellacorporationtrust.cloudflareaccess.com`

This was an existing Zero Trust organization and was reused. It was not created by Hermes.

Access Application:

- Name: `Mission Control`
- ID: `3fb295b0-a1bd-453e-b2b0-960aee2861a6`
- Domain: `app.umbrellacorporation.co`
- Session duration: `24h`

Access Policy:

- Name: `Authorized operators`
- ID: `aff10e13-ae78-46e8-8674-054f391a7c30`
- Decision: `allow`
- Precedence: `1`

Currently authorized emails:

- `david@umbrellacorporation.co`

Pending addition for a future slice:

- `jack@umbrellacorporation.co`

Identity provider:

- `onetimepin` email OTP

Login flow summary:

1. User visits `https://app.umbrellacorporation.co`.
2. CloudFlare redirects to `umbrellacorporationtrust.cloudflareaccess.com`.
3. User enters their authorized email.
4. CloudFlare sends a one-time PIN to that email.
5. User enters the PIN.
6. CloudFlare sets a 24h session cookie.
7. User is redirected to Mission Control.

How to add Jack later:

PATCH policy `aff10e13-ae78-46e8-8674-054f391a7c30` on app `3fb295b0-a1bd-453e-b2b0-960aee2861a6` and add `jack@umbrellacorporation.co` to the `include` array alongside `david@umbrellacorporation.co`.

How to adjust session duration:

PATCH the Access Application or use the Zero Trust dashboard under Applications > Mission Control > Settings > Session Duration.

---

## 21. Current Agent Structure

Current persisted agent roster from `/Users/hermes-agent/.hermes/mission_control/state.json`:

| Agent | Operating entity | Function | Model | System prompt exists |
|---|---|---|---|---|
| Paid Search Strategist | Umbrella Media, LLC | Growth Marketing | `gpt-5.4` | Yes |
| Financial Analyst | Umbrella Holdings Group, LLC | Finance | `gpt-5.4` | Yes |
| Trust / Holdings Structuring Advisor | Umbrella Holdings Group, LLC | Legal & Tax Strategy | `gpt-5.4` | Yes |
| CTV / Programmatic Specialist | Umbrella Media, LLC | Media Buying | `gpt-5.4` | Yes |
| App Developer | Unassigned | Product & Engineering | `gpt-5.5` | Yes |
| Operations Manager | Umbrella Holdings Group, LLC | Operations | `gpt-5.4` | Yes |
| CUSTOMS DIRECTOR | Umbrella Customs, LLC | E-Commerce Operations | `gpt-5.5` | Yes |
| MEDIA DIRECTOR | Umbrella Media, LLC | Media Operations | `gpt-5.5` | Yes |
| PROPERTIES DIRECTOR | Umbrella Properties, LLC | Property Operations | `gpt-5.5` | Yes |

Entity structure currently represented:

- `Umbrella Holdings Group, LLC` — parent / holdings entity.
- `Umbrella Customs, LLC` — e-commerce operating entity.
- `Umbrella Media, LLC` — agency / media operating entity.
- `Umbrella Properties, LLC` — short-term rental / property operating entity.
- `Unassigned` — holding area for agents not yet assigned to an operating entity.

---

## 22. Pending Items

- Director agent first sessions not yet started. Next: Financial Analyst, Customs Director, Properties Director, Media Director.
- App Developer in UNASSIGNED pending deletion by owner.
- Jack CloudFlare Access gate pending Umbrella Media LLC formation.
- Nous subscription renews 2026-05-08.
