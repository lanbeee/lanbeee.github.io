const { webkit } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';
(async () => {
  const browser = await webkit.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const name = `WK ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const ex = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    ex.push({ name, type:'task', target:null, dueDate:dayStart, hardDue:false, eventTime:scheduled, logs:[], emoji:'🧪', pinned:false, sample:false, snoozedUntil:null, topics:['qa'], durationMinutes:25, flexibilityDays:0, createdAt:Date.now() });
    localStorage.setItem('tings_v2', JSON.stringify(ex));
  }, { name, scheduled, dayStart });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // Feature 2: nav visible + label
  await page.locator('#open-overview').click();
  await page.waitForTimeout(250);
  const label = await page.locator('#overview-calendar-label').textContent();
  const nav = await page.locator('#overview-prev-month').isVisible();
  console.log('WK recent label:', JSON.stringify(label), 'nav:', nav);
  if(label !== 'last 14 days' || !nav) throw new Error('recent nav UI broken on webkit');
  await page.locator('#overview-prev-month').click();
  await page.waitForTimeout(150);
  const label2 = await page.locator('#overview-calendar-label').textContent();
  console.log('WK prev label:', JSON.stringify(label2));
  if(label2 === 'last 14 days') throw new Error('prev nav did not shift on webkit');

  // Feature 1: open button via clean tap (webkit clean tap)
  await page.locator('#overview-next-month').click(); // back to default
  await page.waitForTimeout(150);
  await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last().tap();
  await page.locator('#day-logs-sheet.open').waitFor();
  await page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]').tap();
  await page.locator('#detail-sheet.open').waitFor();
  const nm = await page.locator('#detail-name', { hasText: name }).count();
  console.log('WK open -> detail name shown:', nm);
  if(!nm) throw new Error('open did not reach detail on webkit');

  console.log('WEBKIT CHECK PASSED');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
