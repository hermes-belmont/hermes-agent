async function setupAuthedPage(browser, baseURL, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
    serviceWorkers: options.serviceWorkers ?? 'block',
  });
  const page = await context.newPage();
  attachPageDiagnostics(page);

  const target = `${baseURL.replace(/\/$/, '')}/#/`;
  await page.goto(target, { waitUntil: options.waitUntil ?? 'networkidle' });
  await ensureInjectedSessionToken(page);
  return page;
}

function attachPageDiagnostics(page) {
  page.__missionControlDiagnostics = { consoleErrors: [], failedRequests: [] };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      page.__missionControlDiagnostics.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    page.__missionControlDiagnostics.consoleErrors.push(error.message);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure();
    page.__missionControlDiagnostics.failedRequests.push(`${request.method()} ${request.url()} ${failure?.errorText ?? 'request failed'}`);
  });

  page.on('response', async (response) => {
    const request = response.request();
    if (!response.url().includes('/api/') || response.status() < 400) return;
    page.__missionControlDiagnostics.failedRequests.push(`${request.method()} ${response.url()} ${response.status()}`);
  });
}

async function ensureInjectedSessionToken(page) {
  const token = await page.evaluate(() => window.__HERMES_SESSION_TOKEN__ || null);
  if (!token) {
    throw new Error('Mission Control session token was not injected into window.__HERMES_SESSION_TOKEN__. Do not fetch /__hermes/session-token; load the SPA index first and use the injected token.');
  }
  return token;
}

async function apiFetch(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const token = window.__HERMES_SESSION_TOKEN__;
    const response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${init.method || 'GET'} ${path} ${response.status}: ${text}`);
    }
    if (!contentType.includes('application/json')) {
      throw new Error(`${init.method || 'GET'} ${path} returned ${contentType || 'unknown content type'}: ${text.slice(0, 120)}`);
    }
    return text ? JSON.parse(text) : null;
  }, { path, init });
}

async function expectCleanPage(page, options = {}) {
  await page.waitForTimeout(options.settleMs ?? 250);
  const diagnostics = page.__missionControlDiagnostics ?? { consoleErrors: [], failedRequests: [] };
  const ignoredConsole = options.ignoreConsole ?? [];
  const ignoredRequests = options.ignoreRequests ?? [];
  const consoleErrors = diagnostics.consoleErrors.filter((entry) => !ignoredConsole.some((pattern) => matches(pattern, entry)));
  const failedRequests = diagnostics.failedRequests.filter((entry) => !ignoredRequests.some((pattern) => matches(pattern, entry)));

  if (consoleErrors.length || failedRequests.length) {
    throw new Error([
      consoleErrors.length ? `Console errors:\n${consoleErrors.join('\n')}` : '',
      failedRequests.length ? `Failed requests:\n${failedRequests.join('\n')}` : '',
    ].filter(Boolean).join('\n\n'));
  }
}

function matches(pattern, value) {
  return pattern instanceof RegExp ? pattern.test(value) : String(value).includes(String(pattern));
}

module.exports = {
  setupAuthedPage,
  ensureInjectedSessionToken,
  apiFetch,
  expectCleanPage,
};
