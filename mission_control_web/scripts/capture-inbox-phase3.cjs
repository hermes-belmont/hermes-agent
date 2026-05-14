const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseURL = 'http://127.0.0.1:9120';
const outDir = path.resolve(__dirname, '..', 'public', 'preview');
fs.mkdirSync(outDir, { recursive: true });

async function prepPage(browser, viewport = { width: 1440, height: 980 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${baseURL}/#/inbox`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('mc.inbox.selectedAgentId.v1', 'agent_ab9825e9ca');
    localStorage.setItem('mc.inbox.viewMode.v1', 'inbox');
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=Holdings Operator', { timeout: 15000 });
  return { context, page };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
  console.log(name);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // Empty detail state on first Inbox open.
    let env = await prepPage(browser);
    await shot(env.page, 'slice-7-phase-3-inbox-empty-state.png');
    await env.context.close();

    // Holdings selected, list visible with unread badges.
    env = await prepPage(browser);
    await shot(env.page, 'slice-7-phase-3-inbox-holdings-operator.png');
    await env.context.close();

    // Nav badge.
    env = await prepPage(browser);
    await shot(env.page, 'slice-7-phase-3-nav-unread-badge.png');
    await env.context.close();

    // Detail before auto mark-read fires; close immediately after screenshot.
    env = await prepPage(browser);
    await env.page.getByText('FBA Q3 restock budget request').first().click();
    await env.page.waitForSelector('text=From Customs Director → To Holdings Operator', { timeout: 3000 });
    await shot(env.page, 'slice-7-phase-3-message-detail-unread.png');
    await env.context.close();

    // Thread detail for Q2 reply; allow thread block to render.
    env = await prepPage(browser);
    await env.page.getByText('Re: Q2 estimated tax planning').first().click();
    await env.page.waitForSelector('text=Thread (2 messages)', { timeout: 8000 });
    await shot(env.page, 'slice-7-phase-3-message-detail-thread.png');
    await env.context.close();

    // Sent view for Holdings.
    env = await prepPage(browser);
    await env.page.getByRole('button', { name: 'sent', exact: true }).click();
    await env.page.waitForSelector('text=Q2 estimated tax planning', { timeout: 8000 });
    await shot(env.page, 'slice-7-phase-3-sent-view.png');
    await env.context.close();

    // Archive flow: open already-read verification message and archive to show archived status.
    env = await prepPage(browser);
    await env.page.getByText('Slice 7 curl verification').first().click();
    await env.page.waitForSelector('text=Archive', { timeout: 8000 });
    await env.page.getByRole('button', { name: 'Archive', exact: true }).click();
    await env.page.waitForSelector('text=Archived', { timeout: 8000 });
    await shot(env.page, 'slice-7-phase-3-archive-confirm.png');
    await env.context.close();

    // Mobile drilldown message list with back button.
    env = await prepPage(browser, { width: 390, height: 844 });
    await env.page.getByText('Holdings Operator').first().click();
    await env.page.waitForSelector('text=Agents', { timeout: 8000 });
    await shot(env.page, 'slice-7-phase-3-mobile-drilldown.png');
    await env.context.close();
  } finally {
    await browser.close();
  }
})();
