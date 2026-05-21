const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('legacy briefings and tracking hashes redirect to cron and kanban', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);

  await page.goto(`${BASE_URL}/#/briefings`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/cron$/);
  await expect(page.getByRole('heading', { name: 'Briefings (CRON)' })).toBeVisible({ timeout: 15000 });

  await page.goto(`${BASE_URL}/#/tracking`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/kanban$/);
  await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible({ timeout: 15000 });

  await expectCleanPage(page);
});

test('canonical cron and kanban hashes load renamed sections', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);

  await page.goto(`${BASE_URL}/#/cron`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/cron$/);
  await expect(page.getByRole('heading', { name: 'Briefings (CRON)' })).toBeVisible({ timeout: 15000 });

  await page.goto(`${BASE_URL}/#/kanban`, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/#\/kanban$/);
  await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible({ timeout: 15000 });

  await expectCleanPage(page);
});

test('sidebar navigation lands on canonical cron and kanban hashes', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);

  await page.getByRole('button', { name: 'Briefings (CRON)' }).click();
  await expect(page).toHaveURL(/#\/cron$/);
  await expect(page.getByRole('heading', { name: 'Briefings (CRON)' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Kanban' }).click();
  await expect(page).toHaveURL(/#\/kanban$/);
  await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible({ timeout: 15000 });

  await expectCleanPage(page);
});
