const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');

const base = 'http://127.0.0.1:9120';
const publicDir = path.resolve(__dirname, '../public/preview');
const distDir = path.resolve(__dirname, '../../hermes_cli/mission_control_dist/preview');
const avatarPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAaUlEQVR4nO3PQQ0AIBDAsAP/nuGNAvZoFSzZnpl33+8BHJt0BSAWsEC2AqCFbAXACtkKgBWyFQArZCsAVshWAKyQrQBYIVsBsEK2AmCFbAXACtkKgBWyFQArZCsAVshWAKyQrQBYIVsB8AJAXQKcQj+VRgAAAABJRU5ErkJggg==';
const avatarDataUri = `data:image/png;base64,${avatarPngBase64}`;

async function ensureDirs() {
  await fs.mkdir(publicDir, { recursive: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function installAccountRoute(page, account) {
  await page.route('**/api/account', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(account) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(account) });
  });
}

async function saveShot(page, name, options = {}) {
  const publicPath = path.join(publicDir, name);
  const distPath = path.join(distDir, name);
  await page.screenshot({ path: publicPath, ...options });
  await fs.copyFile(publicPath, distPath);
}

(async () => {
  await ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });

  const page = await context.newPage();
  await installAccountRoute(page, { display_name: 'David', avatar_color: '#f97316', preferences: { timezone: 'America/New_York' } });
  await page.goto(`${base}/#/settings/account`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[aria-label="Upload Avatar"]', {
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(avatarPngBase64, 'base64'),
  });
  await page.waitForSelector('text=Custom avatar active. Remove to use color.');
  const identity = page.locator('section', { hasText: 'Identity' }).first();
  await saveShot(page, 'slice-10d-account-avatar-upload.png', { clip: await identity.boundingBox() });
  await page.close();

  const sidebarPage = await context.newPage();
  await installAccountRoute(sidebarPage, { display_name: 'David', avatar_color: '#f97316', avatar_image: avatarDataUri, preferences: { timezone: 'America/New_York' } });
  await sidebarPage.goto(`${base}/#/agents`, { waitUntil: 'networkidle' });
  await sidebarPage.waitForSelector('[aria-label="Account settings"] img');
  await saveShot(sidebarPage, 'slice-10d-sidebar-with-custom-avatar.png', { clip: { x: 0, y: 0, width: 300, height: 1000 } });
  await sidebarPage.close();

  const maintenancePage = await context.newPage();
  await maintenancePage.goto(`${base}/#/maintenance`, { waitUntil: 'networkidle' });
  await maintenancePage.waitForSelector('a[href="https://github.com/NousResearch/hermes-agent/releases"]');
  const hermesCard = maintenancePage.locator('article', { hasText: 'Hermes Update' }).first();
  await saveShot(maintenancePage, 'slice-10d-maintenance-hermes-link.png', { clip: await hermesCard.boundingBox() });
  await maintenancePage.close();

  await browser.close();
  console.log(publicDir);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
