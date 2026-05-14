const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:9120/#/inbox', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('mc.inbox.selectedAgentId.v1', 'agent_ab9825e9ca');
    localStorage.setItem('mc.inbox.viewMode.v1', 'inbox');
  });
  await page.reload({ waitUntil: 'networkidle' });
  const before = await page.evaluate(async () => {
    const response = await fetch('/api/messages/unread-counts', { headers: { Authorization: `Bearer ${window.__HERMES_SESSION_TOKEN__}` } });
    return response.json();
  });
  await page.getByText('Client X campaign launch status').first().click();
  await page.waitForResponse((response) => response.url().includes('/api/messages/') && response.url().includes('/read') && response.request().method() === 'POST', { timeout: 5000 });
  await page.waitForTimeout(250);
  const after = await page.evaluate(async () => {
    const response = await fetch('/api/messages/unread-counts', { headers: { Authorization: `Bearer ${window.__HERMES_SESSION_TOKEN__}` } });
    return response.json();
  });
  console.log(JSON.stringify({ before, after, holdings_before: before.agent_ab9825e9ca, holdings_after: after.agent_ab9825e9ca }, null, 2));
  await context.close();
  await browser.close();
})();
