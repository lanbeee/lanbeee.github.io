const { webkit } = require('playwright');

(async () => {
  const name = `CalOpenWK ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message}`));
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const key = 'tings_v2';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = existing.filter(item => item.name !== name);
    filtered.push({
      name, type: 'task', target: null, dueDate: dayStart, hardDue: false,
      eventTime: scheduled, logs: [], emoji: '🧪', pinned: false, sample: false,
      snoozedUntil: null, topics: ['qa'], durationMinutes: 25, flexibilityDays: 0, createdAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(filtered));
  }, { name, scheduled, dayStart });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(300);
  const planCell = await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  console.log('tapping plan cell');
  await planCell.tap();
  await page.locator('#day-logs-sheet.open').waitFor();
  console.log('day-logs-sheet opened');
  const openBtn = page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]');
  console.log('openBtn visible:', await openBtn.isVisible());
  await openBtn.tap();
  await page.waitForTimeout(800);
  const detailOpen = await page.locator('#detail-sheet.open').count();
  const daySheetOpen = await page.locator('#day-logs-sheet.open').count();
  console.log('AFTER TAP: detail-sheet open =', detailOpen, '| day-logs-sheet open =', daySheetOpen);
  if (daySheetOpen) console.log('FAIL: day logs sheet still covers detail');
  console.log('--- logs ---');
  console.log(logs.slice(-15).join('\n'));
  await browser.close();
})().catch(async err => { console.error(err); process.exit(1); });
