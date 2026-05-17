const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

test('Mission Control chat landing renders with injected session token auth', async ({ browser }) => {
  const page = await setupAuthedPage(browser, 'http://127.0.0.1:9120');

  await expect(page.getByText('Begin a session')).toBeVisible({ timeout: 15000 });
  await expectCleanPage(page);
});
