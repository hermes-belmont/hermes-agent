const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const previewDir = '/Users/hermes-agent/.hermes/hermes-agent/mission_control_web/public/preview';
fs.mkdirSync(previewDir, { recursive: true });

const briefing = {
  id: '2026-05-13',
  generated_at: '2026-05-13T12:48:11+00:00',
  triggered_by: 'manual',
  duration_ms: 33625,
  summary: {
    total_items: 0,
    high_priority_count: 0,
    by_agent: {
      'Customs Director': 0,
      'Media Director': 0,
      'Properties Director': 0,
      'Financial Analyst': 0,
      'Holdings Operator': 0,
    },
  },
  agents: [
    {
      agent_id: 'agent_2fbf94bf93',
      label: 'Customs Director',
      status: 'error',
      latency_ms: 412,
      raw_response_preview: '',
      parsed_items: [],
      notes_for_david: null,
      error: 'Provider rate-limited (429)',
      error_class: 'Provider rate-limited (429)',
      error_detail: 'HTTP 429: The usage limit has been reached',
    },
    {
      agent_id: 'agent_aa2e50d113',
      label: 'Media Director',
      status: 'error',
      latency_ms: 389,
      raw_response_preview: '',
      parsed_items: [],
      notes_for_david: null,
      error: 'Provider auth failed (401)',
      error_class: 'Provider auth failed (401)',
      error_detail: 'HTTP 401: Unauthorized provider credential',
    },
    {
      agent_id: 'agent_b61326ba1c',
      label: 'Properties Director',
      status: 'timeout',
      latency_ms: 90000,
      raw_response_preview: '',
      parsed_items: [],
      notes_for_david: null,
      error: 'Agent process killed (timeout after 90s)',
      error_class: 'Agent process killed (timeout after 90s)',
      error_detail: 'Timed out after 90 seconds',
    },
    {
      agent_id: 'agent_69215fd621',
      label: 'Financial Analyst',
      status: 'error',
      latency_ms: 234,
      raw_response_preview: 'not-json',
      parsed_items: [],
      notes_for_david: null,
      error: 'Invalid JSON in agent response',
      error_class: 'Invalid JSON in agent response',
      error_detail: 'not-json',
    },
    {
      agent_id: 'agent_ab9825e9ca',
      label: 'Holdings Operator',
      status: 'error',
      latency_ms: 117,
      raw_response_preview: '',
      parsed_items: [],
      notes_for_david: null,
      error: 'Unknown error',
      error_class: 'Unknown error',
      error_detail: 'Traceback: No module named yaml',
    },
  ],
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  await page.route('**/api/briefings/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    enabled: true,
    time_local: '08:00',
    days_of_week: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    agents: ['agent_2fbf94bf93', 'agent_aa2e50d113', 'agent_b61326ba1c', 'agent_69215fd621', 'agent_ab9825e9ca'],
    agent_status: briefing.agents.map(a => ({ label: a.label, agent_id: a.agent_id, configured_agent_id: a.agent_id, status: 'ok' })),
    schedule_mode: 'launchagent',
  }) }));
  await page.route('**/api/briefings/2026-05-13', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(briefing) }));
  await page.route('**/api/briefings', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: briefing.id, generated_at: briefing.generated_at, triggered_by: briefing.triggered_by, summary: briefing.summary }]) }));
  await page.goto('http://127.0.0.1:9120/#/cron', { waitUntil: 'networkidle' });
  await page.getByTestId('briefings-view').waitFor({ timeout: 15000 });
  await page.screenshot({ path: path.join(previewDir, 'slice-6-1-briefings-classified-errors.png'), fullPage: true });
  await browser.close();
})();
