import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://127.0.0.1:9120';
const publicDir = path.resolve('public/preview');
const distDir = path.resolve('../hermes_cli/mission_control_dist/preview');
fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

async function copy(name) {
  fs.copyFileSync(path.join(publicDir, name), path.join(distDir, name));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(publicDir, name), fullPage: true });
  await copy(name);
}
async function api(page, method, url, body) {
  return await page.evaluate(async ({ method, url, body }) => {
    const token = window.__HERMES_SESSION_TOKEN__;
    const res = await fetch(url, { method, headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return await res.json();
  }, { method, url, body });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await page.goto(base + '/#/agents', { waitUntil: 'networkidle' });
await page.waitForSelector('text=AGENTS');
const entities = await api(page, 'GET', base + '/api/entities');
const agents = await api(page, 'GET', base + '/api/agents');
const ids = entities.map(e => e.id);
await page.evaluate((ids) => {
  localStorage.setItem('mc.agents.expandedEntities.v1', JSON.stringify(ids));
  localStorage.setItem('mc.agents.viewMode.v1', 'active');
}, ids);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=MEDIA DIRECTOR');
await shot(page, 'slice-8a-agents-tree-default.png');
await shot(page, 'slice-8a-nav-with-agents.png');

await page.getByText('MEDIA DIRECTOR', { exact: true }).first().click();
await page.waitForSelector('text=Agent inspector');
await shot(page, 'slice-8a-agent-inspector.png');

await page.getByRole('button', { name: /Add Agent/i }).click();
await page.waitForSelector('text=Add Agent');
await shot(page, 'slice-8a-add-agent-modal.png');
await page.getByText('Cancel').last().click();

await page.getByText('Umbrella Customs, LLC', { exact: true }).first().click();
await page.waitForSelector('text=Entity inspector');
await shot(page, 'slice-8a-entity-inspector-policy.png');

await page.getByText('MEDIA DIRECTOR', { exact: true }).first().click();
const agentRow = page.getByText('MEDIA DIRECTOR', { exact: true }).first().locator('xpath=ancestor::div[contains(@class,"group")][1]');
await agentRow.hover();
await agentRow.getByText('Move').click();
await page.waitForSelector('text=Move Agent');
await shot(page, 'slice-8a-move-agent-dropdown.png');
await page.getByText('Cancel').last().click();

await agentRow.hover();
await agentRow.locator('button').last().click();
await page.waitForSelector('text=Move MEDIA DIRECTOR to trash?');
await shot(page, 'slice-8a-delete-confirm.png');
await page.getByText('Cancel').last().click();

const unassigned = entities.find(e => e.name === 'Unassigned');
const trashAgent = await api(page, 'POST', base + '/api/agents', { name: 'Slice 8a Screenshot Trash Agent', entity_id: unassigned.id, role: 'Screenshot', is_briefing_agent: false });
await api(page, 'DELETE', base + `/api/agents/${trashAgent.id}`);
await page.evaluate(() => localStorage.setItem('mc.agents.viewMode.v1', 'trash'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=Slice 8a Screenshot Trash Agent');
await shot(page, 'slice-8a-trash-view.png');
await api(page, 'POST', base + `/api/agents/${trashAgent.id}/restore`);
await api(page, 'DELETE', base + `/api/agents/${trashAgent.id}`);

const customs = entities.find(e => e.name === 'Umbrella Customs, LLC');
await api(page, 'PUT', base + `/api/entities/${customs.id}`, { messaging_policy: 'restricted' });
await page.evaluate((ids) => { localStorage.setItem('mc.agents.viewMode.v1', 'active'); localStorage.setItem('mc.agents.expandedEntities.v1', JSON.stringify(ids)); }, ids);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=RESTRICTED');
await shot(page, 'slice-8a-policy-restricted-tree.png');
await api(page, 'PUT', base + `/api/entities/${customs.id}`, { messaging_policy: 'open' });

await browser.close();
console.log('captured', fs.readdirSync(publicDir).filter(f => f.startsWith('slice-8a-')).join('\n'));
