const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const base = 'http://127.0.0.1:9120';
  const out = path.resolve(__dirname, '../public/preview/slice-9-rate-limit-record-detail.png');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  await page.goto(`${base}/#/monitor?reactive=rsw_5b9472e2`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.innerText.includes('REACTIVE ACTIVITY'), null, { timeout: 20000 });
  await page.waitForFunction(() => document.body.innerText.includes('rsw_5b9472e2') && document.body.innerText.includes('"status": "rate_limited"'), null, { timeout: 20000 });
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
})();
