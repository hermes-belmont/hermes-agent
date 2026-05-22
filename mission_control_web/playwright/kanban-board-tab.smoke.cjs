const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

test('kanban board tab opens create modal and returns to watch items', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);

  await page.goto(`${BASE_URL}/#/kanban`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Kanban' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('tab', { name: 'Watch Items' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible({ timeout: 15000 });
  for (const label of ['Triage', 'Todo', 'Scheduled', 'Ready', 'Running', 'Blocked', 'Review', 'Done']) {
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
  }

  await page.getByRole('button', { name: /New Task/i }).click();
  await expect(page.getByRole('dialog', { name: /New Task/i })).toBeVisible();
  await expect(page.getByPlaceholder('Form Umbrella Media operating agreement')).toBeVisible();
  await expect(page.getByPlaceholder('What needs to happen?')).toBeVisible();
  await expect(page.getByPlaceholder('Profile name or @worker')).toBeVisible();
  await expect(page.getByText('Tenant or workspace identifier. Leave blank for default.')).toBeVisible();
  for (const label of ['Triage', 'Todo', 'Scheduled', 'Ready', 'Running', 'Blocked', 'Review', 'Done']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Low' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Medium' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'High' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: /New Task/i })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Board' })).toBeVisible();

  await page.getByRole('tab', { name: 'Watch Items' }).click();
  await expect(page.getByRole('tab', { name: 'Watch Items' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Add Item/i })).toBeVisible({ timeout: 15000 });

  await expectCleanPage(page);
});
