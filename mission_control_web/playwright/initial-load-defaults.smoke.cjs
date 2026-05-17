const { test, expect } = require('@playwright/test');
const { setupAuthedPage, expectCleanPage, apiFetch } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';

async function getSettingsDefaultModel(page) {
  const info = await apiFetch(page, 'http://127.0.0.1:9119/api/model/info');
  return info.model_slug || info.model || 'gpt-5.5';
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
