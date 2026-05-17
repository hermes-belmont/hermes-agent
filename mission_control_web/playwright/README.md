# Mission Control Playwright smokes

## Auth pattern

Mission Control does not authenticate browser smokes through a cookie, storage state, or a `GET /__hermes/session-token` API route.

The working pattern is:

1. Navigate to the live Mission Control SPA first, usually `http://127.0.0.1:9120/#/`.
2. The FastAPI SPA fallback injects `window.__HERMES_SESSION_TOKEN__` into `index.html` before serving it.
3. Any direct API call from a smoke script should run in the page context and send `Authorization: Bearer ${window.__HERMES_SESSION_TOKEN__}`.

Do not fetch `/__hermes/session-token` from Playwright. There is no registered `/__hermes/*` server route in the Mission Control FastAPI app. That path falls through to the SPA catch-all and returns HTML, which causes JSON parse failures such as:

```text
Unexpected token '<', "<!doctype "... is not valid JSON
```

The reusable helper in `playwright/lib/auth.cjs` implements the working pattern:

```js
const { setupAuthedPage, apiFetch, expectCleanPage } = require('./lib/auth.cjs');

const page = await setupAuthedPage(browser, 'http://127.0.0.1:9120');
const bootstrap = await apiFetch(page, '/api/mission-control/bootstrap');
await expectCleanPage(page);
```

## Setup

Install the Playwright test runner and browser once from `mission_control_web`:

```bash
cd mission_control_web
npm install --include=dev
npx playwright install chromium
```

This repository's npm config may omit dev dependencies by default. Use `--include=dev` when installing locally so `eslint`, `tsc`, `vite`, and `@playwright/test` are available.

## Run the example smoke

From `mission_control_web`:

```bash
npx playwright test playwright/example.smoke.cjs --browser=chromium
```

Equivalent from the repository root:

```bash
cd mission_control_web && npx playwright test playwright/example.smoke.cjs --browser=chromium
```

The smoke loads `http://127.0.0.1:9120/#/`, asserts the chat landing renders `Begin a session`, and fails on console errors, failed requests, or missing injected token.
