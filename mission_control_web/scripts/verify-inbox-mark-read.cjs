const { chromium } = require('playwright');
const { setupAuthedPage, apiFetch } = require('../playwright/lib/auth.cjs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await setupAuthedPage(browser, 'http://127.0.0.1:9120', { viewport: { width: 1440, height: 980 } });
  await page.goto('http://127.0.0.1:9120/#/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('mc.inbox.selectedAgentId.v1', 'agent_ab9825e9ca');
    localStorage.setItem('mc.inbox.viewMode.v1', 'inbox');
  });
  await page.reload({ waitUntil: 'networkidle' });
  const before = await apiFetch(page, '/api/messages/unread-counts');
  await page.getByText('Client X campaign launch status').first().click();
  await page.waitForResponse((response) => response.url().includes('/api/messages/') && response.url().includes('/read') && response.request().method() === 'POST', { timeout: 5000 });
  await page.waitForTimeout(250);
  const after = await apiFetch(page, '/api/messages/unread-counts');
  console.log(JSON.stringify({ before, after, holdings_before: before.agent_ab9825e9ca, holdings_after: after.agent_ab9825e9ca }, null, 2));
  await page.context().close();
  await browser.close();
})();
