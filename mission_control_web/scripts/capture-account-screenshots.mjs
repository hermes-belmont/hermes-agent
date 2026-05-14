import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';

const outDir = path.resolve(process.cwd(), 'public/preview');
await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('console error:', msg.text());
});
await page.goto('http://127.0.0.1:9120/#/settings/account', { waitUntil: 'networkidle' });
await page.waitForSelector('text=Authentication is currently disabled', { timeout: 10000 });
await page.screenshot({ path: path.join(outDir, 'slice-10b-account-overview.png'), fullPage: true });

const input = page.locator('input[aria-label="Display name"]');
await input.focus();
await input.fill('David Umbrella');
await page.screenshot({ path: path.join(outDir, 'slice-10b-account-identity-edit.png'), fullPage: true });

const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download State Backup/i }).click();
const download = await downloadPromise;
await download.path().catch(() => null);
await page.waitForSelector('text=/Downloaded mission-control-export-.*\\.json\\./', { timeout: 10000 });
await page.screenshot({ path: path.join(outDir, 'slice-10b-account-export.png'), fullPage: true });

await browser.close();
console.log(outDir);
