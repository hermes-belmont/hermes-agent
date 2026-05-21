const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const base = 'http://127.0.0.1:9120';
const out = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview';
fs.mkdirSync(out, { recursive: true });

async function waitTracking(page) {
  await page.goto(`${base}/#/kanban`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Kanban' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
}

async function openAdd(page) {
  await page.getByRole('button', { name: /Add Item/i }).first().click();
  await page.getByRole('heading', { name: /Add Item/i }).waitFor({ timeout: 10000 });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

  await waitTracking(page);
  await page.evaluate(() => localStorage.removeItem('mc.tracking.lastUsedAgent.v1'));
  await openAdd(page);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('select')).some(s => s.options[0]?.textContent?.includes('Select agent') && s.value === ''));
  await page.screenshot({ path: path.join(out, 'slice-6-2-1-add-item-default-prompt.png'), fullPage: true });

  await page.locator('span').filter({ has: page.getByRole('button', { name: /^Save$/ }) }).click({ force: true });
  await page.getByText('Pick an agent before saving.').waitFor({ timeout: 5000 });
  await page.screenshot({ path: path.join(out, 'slice-6-2-1-add-item-validation-error.png'), fullPage: true });

  await page.locator('select').filter({ hasText: 'Select agent...' }).selectOption('agent_ab9825e9ca');
  await page.getByLabel('Title').fill('Slice 6.2.1 last-used screenshot temp');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(1000);
  await openAdd(page);
  await page.screenshot({ path: path.join(out, 'slice-6-2-1-add-item-last-used-preselected.png'), fullPage: true });
  await page.getByRole('button', { name: /^Cancel$/ }).click();

  await waitTracking(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, 'slice-6-2-1-tracking-labels-after.png'), fullPage: true });

  await page.goto(`${base}/#/cron`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(out, 'slice-6-2-1-briefing-labels-after.png'), fullPage: true });

  await page.evaluate(async () => {
    const payload = await fetch('/api/tracked-items').then(r => r.json());
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    for (const item of items) {
      if (item.title === 'Slice 6.2.1 last-used screenshot temp') {
        await fetch(`/api/tracked-items/${item.id}`, { method: 'DELETE' });
      }
    }
  });

  await browser.close();
})();
