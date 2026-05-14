const { chromium } = require('playwright');
const path = require('path');

const base = 'http://127.0.0.1:9120';
const outDir = path.resolve(__dirname, '../public/preview');

async function waitText(page, text, timeout = 15000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout });
}

async function clickText(page, text) {
  await page.getByText(text, { exact: false }).first().click();
}

async function openInboxMessage(page, agentLabel, subject) {
  await page.goto(`${base}/#/inbox`, { waitUntil: 'networkidle' });
  await waitText(page, 'INTER-AGENT MESSAGES');
  await clickText(page, agentLabel);
  await waitText(page, subject, 25000);
  await clickText(page, subject);
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });

  await openInboxMessage(page, 'Financial Analyst', 'Slice 9 reactive activation verification');
  await waitText(page, 'REACTIVE TRIGGERED');
  await page.screenshot({ path: path.join(outDir, 'slice-9-inbox-badge-triggered.png'), fullPage: true });

  await openInboxMessage(page, 'Holdings Operator', 'Re: Slice 9 reactive activation verification');
  await waitText(page, 'SENT FROM REACTIVE SWEEP');
  await page.screenshot({ path: path.join(outDir, 'slice-9-inbox-badge-sent-from.png'), fullPage: true });

  await page.goto(`${base}/#/monitor?reactive=rsw_5d49ea89`, { waitUntil: 'networkidle' });
  await waitText(page, 'REACTIVE ACTIVITY');
  await waitText(page, 'rsw_5d49ea89');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'slice-9-monitor-reactive-section.png'), fullPage: true });

  await page.goto(`${base}/#/monitor?reactive=rsw_5b9472e2`, { waitUntil: 'networkidle' });
  await waitText(page, 'rate_limited');
  await waitText(page, 'rsw_5b9472e2');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'slice-9-rate-limit-record.png'), fullPage: true });

  await browser.close();
})();
