const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';
const DEFAULT_MODEL_STORAGE_KEY = 'mc.defaultModel.v1';

async function getSettingsDefaultModel(page) {
  const model = await page.evaluate((key) => localStorage.getItem(key), DEFAULT_MODEL_STORAGE_KEY);
  return model || 'gpt-5.5';
}

test('initial workspace load defaults to Hermes Direct and settings default model', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);
  const defaultModel = await getSettingsDefaultModel(page);

  await page.evaluate(() => {
    localStorage.setItem('mission-control-active-project-v1', 'project-mission-control');
    localStorage.setItem('mission-control-model-preference', 'claude-sonnet-4.6');
  });

  await page.goto(`${BASE_URL}/#/`, { waitUntil: 'networkidle' });

  await expect(page).toHaveTitle('Hermes Workspace (Corporate)');
  await expect(page.getByRole('heading', { name: 'Begin a session' })).toBeVisible();
  await expect(page.getByText(`Hermes (Direct) · ${defaultModel}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hermes (Direct)', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Medium', exact: true })).toBeVisible();
  await expect(page.getByTestId('model-chip')).toContainText(defaultModel);
  await expect(page.locator('[data-testid="chat-project-label"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="project-row"][data-active="true"]')).toHaveCount(0);

  await expectCleanPage(page);
});
