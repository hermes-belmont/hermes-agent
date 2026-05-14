const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = 'http://127.0.0.1:9120/#/briefings';
const previewDir = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview';
const briefingDir = '/Users/hermes-agent/.hermes/runtime/briefings';
const holdDir = '/Users/hermes-agent/.hermes/runtime/briefings-screenshot-hold';
fs.mkdirSync(previewDir, { recursive: true });

function moveBriefingsAway() {
  fs.mkdirSync(briefingDir, { recursive: true });
  fs.rmSync(holdDir, { recursive: true, force: true });
  fs.mkdirSync(holdDir, { recursive: true });
  for (const file of fs.readdirSync(briefingDir)) {
    if (file.endsWith('.json') || file.endsWith('.md')) fs.renameSync(path.join(briefingDir, file), path.join(holdDir, file));
  }
}
function restoreBriefings() {
  fs.mkdirSync(briefingDir, { recursive: true });
  if (!fs.existsSync(holdDir)) return;
  for (const file of fs.readdirSync(holdDir)) fs.renameSync(path.join(holdDir, file), path.join(briefingDir, file));
  fs.rmSync(holdDir, { recursive: true, force: true });
}
async function prep(page, theme = 'default') {
  await page.goto('http://127.0.0.1:9120/', { waitUntil: 'domcontentloaded' });
  await page.evaluate((theme) => {
    localStorage.setItem('mission-control-theme', theme);
    localStorage.setItem('mc.theme.v1', theme);
    localStorage.setItem('mission-control-active-view', 'briefings');
  }, theme);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="briefings-view"]', { timeout: 10000 });
}
async function shot(page, name, options = {}) {
  await page.screenshot({ path: path.join(previewDir, name), fullPage: true, ...options });
  console.log(name);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    let page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });

    moveBriefingsAway();
    await prep(page, 'default');
    await shot(page, 'slice-6-briefings-empty-state.png');

    await page.route('**/api/briefings/run', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'stub', generated_at: new Date().toISOString(), triggered_by: 'manual', duration_ms: 10000, agents: [], summary: { total_items: 0, high_priority_count: 0, by_agent: {} } }) });
    });
    await page.getByRole('button', { name: 'Run Now' }).first().click();
    await page.waitForSelector('text=Running briefing sweep', { timeout: 5000 });
    await shot(page, 'slice-6-briefings-run-in-progress.png');
    await page.unroute('**/api/briefings/run');
    await page.close();

    restoreBriefings();
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await prep(page, 'default');
    await shot(page, 'slice-6-briefings-detail-default.png');
    await page.getByRole('button', { name: 'Configure' }).click();
    await page.waitForSelector('text=Configure Briefings');
    await shot(page, 'slice-6-briefings-config-drawer.png');
    await page.close();

    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await prep(page, 'charizard');
    await shot(page, 'slice-6-briefings-detail-charizard.png');
    await page.close();

    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await prep(page, 'daylight');
    await shot(page, 'slice-6-briefings-detail-daylight.png');
    await page.close();

    page = await browser.newPage({ viewport: { width: 375, height: 900 }, isMobile: true, deviceScaleFactor: 1 });
    await prep(page, 'default');
    await shot(page, 'slice-6-briefings-mobile-375.png');
    await page.close();
  } finally {
    restoreBriefings();
    await browser.close();
  }
})().catch((err) => { console.error(err); restoreBriefings(); process.exit(1); });
