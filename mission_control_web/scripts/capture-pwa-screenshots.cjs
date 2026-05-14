const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');

const base = 'http://127.0.0.1:9120';
const outDir = path.resolve(__dirname, '../public/preview');

async function waitForApp(page) {
  await page.goto(`${base}/#/settings/account`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[aria-label="Install desktop app"]', { timeout: 20000 });
}

(async () => {
  await fs.mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await waitForApp(page);
  await page.screenshot({ path: path.join(outDir, 'slice-10c-sidebar-download-icon.png'), fullPage: true });
  await page.getByLabel('Install desktop app').click();
  await page.waitForSelector('role=dialog', { timeout: 10000 });
  await page.screenshot({ path: path.join(outDir, 'slice-10c-install-modal-default.png'), fullPage: true });
  await page.close();

  const installedPage = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await installedPage.addInitScript(() => {
    const originalMatchMedia = window.matchMedia?.bind(window);
    window.matchMedia = (query) => {
      if (query === '(display-mode: standalone)') {
        return {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        };
      }
      return originalMatchMedia ? originalMatchMedia(query) : {
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    };
  });
  await waitForApp(installedPage);
  await installedPage.getByLabel('Install desktop app').click();
  await installedPage.waitForSelector('text=Mission Control is installed', { timeout: 10000 });
  await installedPage.screenshot({ path: path.join(outDir, 'slice-10c-install-modal-installed.png'), fullPage: true });

  await browser.close();
  console.log(outDir);
})();
