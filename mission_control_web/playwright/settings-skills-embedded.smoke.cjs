const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('Settings Skills embeds Hermes Agent skills page', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);
  await page.goto(`${BASE_URL}/#/settings/skills`, { waitUntil: 'networkidle' });

  const iframe = page.locator('iframe[title="Hermes Agent Skills"]');
  await expect(iframe).toBeVisible();
  await expect(iframe).toHaveAttribute('src', 'http://localhost:9119/skills?embed=1');

  const frame = page.frameLocator('iframe[title="Hermes Agent Skills"]');
  await expect(frame.locator('[data-dashboard-embed="skills"]')).toBeVisible({ timeout: 10000 });
  await expect(frame.getByText('Skills', { exact: true })).toBeVisible();
  await expect(frame.getByText(/\d+\/\d+ ENABLED/i)).toBeVisible();
  await expect(frame.getByRole('button', { name: /^All \(/i })).toBeVisible();
  await expect(frame.getByRole('button', { name: /^General\b/i })).toBeVisible();

  await expectCleanPage(page);
});
