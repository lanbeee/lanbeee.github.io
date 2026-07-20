const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async () => {
  const name = `Calendar open mobile ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  page.on('console', msg => {
    if (msg.type() === 'error') console.error(msg.text());
  });
  page.on('pageerror', err => {
    throw err;
  });
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const key = 'tings_v2';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const filtered = existing.filter(item => item.name !== name);
    filtered.push({
      name,
      type: 'task',
      target: null,
      dueDate: dayStart,
      hardDue: false,
      eventTime: scheduled,
      logs: [],
      emoji: '🧪',
      pinned: false,
      sample: false,
      snoozedUntil: null,
      topics: ['qa'],
      durationMinutes: 25,
      flexibilityDays: 0,
      createdAt: Date.now()
    });
    localStorage.setItem(key, JSON.stringify(filtered));
  }, { name, scheduled, dayStart });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last().click();
  await page.locator('#day-logs-sheet.open').waitFor();
  await page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]').click();
  await page.locator('#detail-sheet.open').waitFor();
  await page.locator('#detail-name', { hasText: name }).waitFor();
  const daySheetOpen = await page.locator('#day-logs-sheet.open').count();
  if (daySheetOpen) throw new Error('day logs sheet still covers detail on mobile');
  await browser.close();
  console.log('Mobile calendar open regression passed');
})().catch(async err => {
  console.error(err);
  process.exit(1);
});
