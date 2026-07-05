const { chromium } = require('playwright');
(async () => {
  const name = `Verify2 ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await page.context().newCDPSession(page);
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    existing.push({ name, type:'task', target:null, dueDate:dayStart, hardDue:false, eventTime:scheduled, logs:[], emoji:'🧪', pinned:false, sample:false, snoozedUntil:null, topics:['qa'], durationMinutes:25, flexibilityDays:0, createdAt:Date.now() });
    localStorage.setItem('tings_v2', JSON.stringify(existing));
  }, { name, scheduled, dayStart });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(200);
  const planCell = page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  await planCell.tap();
  await page.locator('#day-logs-sheet.open').waitFor();

  for(const d of [4, 8, 15, 22, 30]){
    const openBtn = page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]');
    const b = await openBtn.boundingBox();
    await cdpDrift(client, b.x + b.width/2, b.y + b.height/2, d);
    await page.waitForTimeout(250);
    const detail = await page.locator('#detail-sheet.open').count();
    console.log(`TAP drift ${d}px -> detail open: ${detail}`);
    await page.evaluate(()=>{document.getElementById('detail-sheet').classList.remove('open');document.body.classList.remove('fullpage-open');});
  }
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
async function cdpDrift(c,x,y,d){await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});const s=6;for(let i=1;i<=s;i++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(d*i)/s,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,16));}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:x+d,y,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,80));}
