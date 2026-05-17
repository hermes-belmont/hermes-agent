const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('Settings Models embeds Hermes Agent model settings', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL, { viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE_URL}/#/settings/models`, { waitUntil: 'networkidle' });

  const iframe = page.locator('iframe[title="Hermes Agent Models"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', 'http://localhost:9119/models?embed=1');

  const frame = page.frameLocator('iframe[title="Hermes Agent Models"]');
  await expect(frame.getByText('MODEL SETTINGS')).toBeVisible({ timeout: 10000 });

  await expectCleanPage(page, {
    ignoreRequests: [
      /http:\/\/localhost:9119\/api\//,
      /http:\/\/127\.0\.0\.1:9119\/api\//,
    ],
  });
});
