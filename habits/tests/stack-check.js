const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const name = `Stack ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const ex = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    ex.push({ name, type:'task', target:null, dueDate:dayStart, hardDue:false, eventTime:scheduled, logs:[], emoji:'🧪', pinned:false, sample:false, snoozedUntil:null, topics:['qa'], durationMinutes:25, flexibilityDays:0, createdAt:Date.now() });
    localStorage.setItem('tings_v2', JSON.stringify(ex));
  }, { name, scheduled, dayStart });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(200);
  await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last().tap();
  await page.locator('#day-logs-sheet.open').waitFor();
  await page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]').tap();
  await page.waitForTimeout(500);

  const overviewOpen = await page.locator('#overview-sheet.open').count();
  const detailOpen = await page.locator('#detail-sheet.open').count();
  // What's actually painted at viewport center?
  const topEl = await page.evaluate(()=>{
    const el = document.elementFromPoint(195, 400);
    return el ? (el.closest('.sheet-wrap')?.id || el.id || el.tagName) : 'nothing';
  });
  // Is the detail-name visible (not covered)?
  const detailNameVisible = await page.locator('#detail-name').isVisible();
  console.log(JSON.stringify({ overviewOpen, detailOpen, topEl, detailNameVisible }));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
