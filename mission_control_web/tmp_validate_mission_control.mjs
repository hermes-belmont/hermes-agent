import { chromium, devices } from 'playwright';

const desktopPath = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/.artifacts/mission-control-desktop.png';
const desktopSettingsPath = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/.artifacts/mission-control-desktop-settings.png';
const mobilePath = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/.artifacts/mission-control-mobile.png';
const mobileSettingsPath = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/.artifacts/mission-control-mobile-settings.png';

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await desktop.newPage();
await page.goto('http://127.0.0.1:9120', { waitUntil: 'networkidle' });
await page.screenshot({ path: desktopPath, fullPage: false });
await page.getByRole('button', { name: 'Open settings' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: desktopSettingsPath, fullPage: false });

const desktopData = await page.evaluate(() => {
  const bodyOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  const title = document.querySelector('h1')?.textContent || null;
  const hasRefresh = Array.from(document.querySelectorAll('button')).some((el) => /refresh/i.test(el.textContent || '') || /refresh/i.test(el.getAttribute('aria-label') || ''));
  const healthyText = document.body.innerText.includes('Healthy');
  const settingsOpen = !!document.querySelector('[aria-label="Close settings"]');
  return { bodyOverflow, title, hasRefresh, healthyText, settingsOpen };
});
await desktop.close();

const mobile = await browser.newContext({ ...devices['iPhone 13 Pro'] });
const mobilePage = await mobile.newPage();
await mobilePage.goto('http://127.0.0.1:9120', { waitUntil: 'networkidle' });
await mobilePage.screenshot({ path: mobilePath, fullPage: false });
await mobilePage.getByRole('button', { name: 'Open settings' }).click();
await mobilePage.waitForTimeout(300);
await mobilePage.screenshot({ path: mobileSettingsPath, fullPage: false });
const mobileData = await mobilePage.evaluate(() => {
  const bodyOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
  const hasRefresh = Array.from(document.querySelectorAll('button')).some((el) => /refresh/i.test(el.textContent || '') || /refresh/i.test(el.getAttribute('aria-label') || ''));
  const drawerButton = !!Array.from(document.querySelectorAll('button')).find((el) => /open agents navigation/i.test(el.getAttribute('aria-label') || ''));
  return { bodyOverflow, hasRefresh, drawerButton };
});
await mobile.close();
await browser.close();

console.log(JSON.stringify({ desktopData, mobileData, screenshots: { desktopPath, desktopSettingsPath, mobilePath, mobileSettingsPath } }, null, 2));
