const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');

const base = 'http://127.0.0.1:9120';
const publicDir = path.resolve(__dirname, '../public/preview');
const distDir = path.resolve(__dirname, '../../hermes_cli/mission_control_dist/preview');

async function ensureDirs() {
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function saveShot(page, name, options = {}) {
  const publicPath = path.join(publicDir, name);
  const distPath = path.join(distDir, name);
  await page.screenshot({ path: publicPath, ...options });
  await fs.copyFile(publicPath, distPath);
}

async function routeAccount(page) {
  await page.route('**/api/account', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ display_name: 'David', avatar_color: '#ff9800', preferences: { timezone: 'America/New_York' } }),
    });
  });
}

async function routeTailscale(page, payload) {
  await page.route('**/api/system/tailscale-status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

(async () => {
  await ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

  const page = await context.newPage();
  await routeAccount(page);
  await routeTailscale(page, { installed: false, signed_in: false, version: null, hostname: null, tailscale_ip: null, exit_code: null, error_summary: 'tailscale command not found' });
  await page.goto(`${base}/#/settings/desktop-remote`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-slice10e="desktop-app"]');
  await saveShot(page, 'slice-10e-desktop-remote-overview.png', { fullPage: true });

  const desktopSection = page.locator('[data-slice10e="desktop-app"]').first();
  await saveShot(page, 'slice-10e-desktop-app-section.png', { clip: await desktopSection.boundingBox() });

  const remoteSection = page.locator('[data-slice10e="remote-access"]').first();
  await saveShot(page, 'slice-10e-tailscale-not-installed.png', { clip: await remoteSection.boundingBox() });
  await page.close();

  const connectedPage = await context.newPage();
  await routeAccount(connectedPage);
  await routeTailscale(connectedPage, {
    installed: true,
    signed_in: true,
    version: '1.78.3',
    hostname: 'machine-name.tailnet.ts.net',
    tailscale_ip: '100.64.0.10',
    self_name: 'machine-name',
    exit_code: 0,
  });
  await connectedPage.goto(`${base}/#/settings/desktop-remote`, { waitUntil: 'networkidle' });
  await connectedPage.getByRole('button', { name: /Check status/i }).click();
  await connectedPage.waitForSelector('text=Connected as machine-name.tailnet.ts.net');
  const connectedRemote = connectedPage.locator('[data-slice10e="remote-access"]').first();
  await saveShot(connectedPage, 'slice-10e-tailscale-connected.png', { clip: await connectedRemote.boundingBox() });
  await connectedPage.close();

  await browser.close();
  console.log(publicDir);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
