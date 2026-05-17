const { test, expect } = require('@playwright/test');
const { setupAuthedPage, apiFetch, expectCleanPage } = require('./lib/auth.cjs');

const BASE_URL = 'http://127.0.0.1:9120';
const APP_DEVELOPER_ID = 'agent_0d5dac8717';
const HERMES_DIRECT_ID = 'agent_9afe71830d';
const MISSION_CONTROL_PROJECT_ID = 'project-mission-control';
const DEFAULT_MODEL_STORAGE_KEY = 'mc.defaultModel.v1';

async function getSettingsDefaultModel(page) {
  const model = await page.evaluate((key) => localStorage.getItem(key), DEFAULT_MODEL_STORAGE_KEY);
  return model || 'gpt-5.5';
}

test('sidebar New Chat defaults to Hermes Direct and no project', async ({ browser }) => {
  const page = await setupAuthedPage(browser, BASE_URL);
  const defaultModel = await getSettingsDefaultModel(page);

  await page.evaluate((projectId) => {
    localStorage.setItem('mission-control-active-project-v1', projectId);
    localStorage.setItem('mission-control-model-preference', 'claude-sonnet-4.6');
  }, MISSION_CONTROL_PROJECT_ID);

  const source = await apiFetch(page, '/api/mission-control/conversations', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: APP_DEVELOPER_ID,
      title: `Smoke App Developer Project ${Date.now()}`,
      project_id: MISSION_CONTROL_PROJECT_ID,
    }),
  });

  await page.reload({ waitUntil: 'networkidle' });
  await page.locator(`[data-testid="recent-row"][data-conversation-id="${source.conversation.id}"]`).getByRole('button').first().click();
  await expect(page.getByText('App Developer', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Mission Control', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'New Chat' }).click();

  await expect(page.getByRole('heading', { name: 'Begin a session' })).toBeVisible();
  await expect(page.getByText(`Hermes (Direct) · ${defaultModel}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hermes (Direct)', exact: true })).toBeVisible();
  await expect(page.getByTestId('model-chip')).toContainText(defaultModel);
  await expect(page.locator('[data-testid="chat-project-label"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="project-row"][data-active="true"]')).toHaveCount(0);

  const createResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith('/api/mission-control/conversations') && response.request().method() === 'POST',
  );
  const modelPatchPromise = page.waitForResponse((response) =>
    /\/api\/mission-control\/conversations\/[^/]+$/.test(response.url()) && response.request().method() === 'PATCH',
  ).catch(() => null);
  await page.getByPlaceholder('Ask anything...').fill(`New chat defaults smoke ${Date.now()}`);
  await page.getByRole('button', { name: 'Send message' }).click();
  const createResponse = await createResponsePromise;
  const payload = await createResponse.json();
  expect(payload.conversation.agent_id).toBe(HERMES_DIRECT_ID);
  expect(payload.conversation.project_id ?? null).toBeNull();
  await modelPatchPromise;

  await page.reload({ waitUntil: 'networkidle' });
  const recentRow = page.locator(`[data-testid="recent-row"][data-conversation-id="${payload.conversation.id}"]`);
  await expect(recentRow).toBeVisible();
  await page.getByRole('button', { name: `Conversation actions for ${payload.conversation.title}` }).click();
  await page.getByRole('menuitem', { name: 'Move to project' }).click();
  await expect(page.getByRole('dialog', { name: 'Change project' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'No project' })).toHaveClass(/border-\[var\(--warm-glow\)\]/);
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'New Chat' }).click();
  await expect(page.getByText(`Hermes (Direct) · ${defaultModel}`)).toBeVisible();
  await expect(page.locator('[data-testid="chat-project-label"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="project-row"][data-active="true"]')).toHaveCount(0);

  const refreshed = await apiFetch(page, `/api/mission-control/conversations/${payload.conversation.id}/messages`).catch(() => ({ messages: [] }));
  expect(Array.isArray(refreshed.messages)).toBe(true);
  await expectCleanPage(page, { ignoreRequests: [/api\/mission-control\/chat\/stream/] });
});
