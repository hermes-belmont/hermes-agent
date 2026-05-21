const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('cron jobs tab opens create modal and preserves tab state', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);

  await page.goto(`${BASE_URL}/#/cron`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Briefings (CRON)' })).toBeVisible({ timeout: 15000 });

  await page.getByRole('tab', { name: 'CRON Jobs' }).click();
  await expect(page.getByTestId('cron-jobs-panel')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Scheduled CRON Jobs/)).toBeVisible();

  await page.getByRole('button', { name: /New Job/i }).click();
  await expect(page.getByRole('dialog', { name: /Create Job/i })).toBeVisible();
  await expect(page.getByPlaceholder('Daily research summary')).toBeVisible();
  await expect(page.getByText('Choose a preset or enter a custom schedule string below.')).toBeVisible();
  await expect(page.getByPlaceholder('What should Hermes Agent do?')).toBeVisible();
  await expect(page.getByPlaceholder('research, writing, synthesis')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Local' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Telegram/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Discord/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlimited' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set count' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: /Create Job/i })).toBeHidden();
  await expect(page.getByRole('tab', { name: 'CRON Jobs' })).toHaveAttribute('aria-selected', 'true');

  await expectCleanPage(page);
});
