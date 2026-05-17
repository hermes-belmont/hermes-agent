const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('Settings Config embeds Hermes Agent config editor', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL, { viewport: { width: 1440, height: 1000 } });

  await page.goto(`${BASE_URL}/#/settings/config`, { waitUntil: 'networkidle' });

  const iframe = page.locator('iframe[title="Hermes Agent Config"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', 'http://localhost:9119/config?embed=1');

  const frame = page.frameLocator('iframe[title="Hermes Agent Config"]');
  await expect(frame.getByText('CONFIG.YAML')).toBeVisible({ timeout: 10000 });
  await expect(frame.getByRole('complementary', { name: 'Filters' })).toBeVisible();
  await expect(frame.getByRole('button', { name: /General\s+9/ })).toBeVisible();

  await expectCleanPage(page, {
    ignoreRequests: [
      /http:\/\/localhost:9119\/api\//,
      /http:\/\/127\.0\.0\.1:9119\/api\//,
    ],
  });
});
