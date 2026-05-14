const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = 'http://127.0.0.1:9120';
const out = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview';
fs.mkdirSync(out, { recursive: true });

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    localStorage.setItem('mission-control-theme-v1', t);
    localStorage.setItem('mission-control-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

async function waitTracking(page) {
  await page.goto(`${base}/#/tracking`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Tracking' }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(700);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });

  await waitTracking(page);
  await page.screenshot({ path: path.join(out, 'slice-6-2-tracking-list-default.png'), fullPage: true });

  await setTheme(page, 'charizard');
  await waitTracking(page);
  await page.screenshot({ path: path.join(out, 'slice-6-2-tracking-list-charizard.png'), fullPage: true });

  await setTheme(page, 'daylight');
  await waitTracking(page);
  await page.screenshot({ path: path.join(out, 'slice-6-2-tracking-list-daylight.png'), fullPage: true });

  await page.setViewportSize({ width: 375, height: 900 });
  await waitTracking(page);
  await page.screenshot({ path: path.join(out, 'slice-6-2-tracking-list-mobile-375.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await waitTracking(page);
  await page.getByRole('button', { name: /Add Item/i }).first().click();
  await page.getByRole('heading', { name: /Add Item/i }).waitFor();
  await page.screenshot({ path: path.join(out, 'slice-6-2-add-item-modal.png'), fullPage: true });
  await page.getByRole('button', { name: /^Cancel$/i }).click();

  await waitTracking(page);
  await page.getByRole('button', { name: /Edit/i }).first().click();
  await page.getByRole('heading', { name: /Edit Item/i }).waitFor();
  await page.screenshot({ path: path.join(out, 'slice-6-2-edit-item-modal.png'), fullPage: true });
  await page.getByRole('button', { name: /^Cancel$/i }).click();

  await waitTracking(page);
  await page.getByRole('button', { name: /^Active$/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'slice-6-2-tracking-empty-state.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.goto(`${base}/#/briefings`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Tracked source').first().waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(out, 'slice-6-2-briefings-with-real-items.png'), fullPage: true });

  await browser.close();
})();
