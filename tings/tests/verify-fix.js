const { chromium } = require('playwright');
(async () => {
  const name = `Verify ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const client = await page.context().newCDPSession(page);
  // many habits → tall day-logs list so the sheet actually scrolls
  await page.addInitScript(({ name, scheduled, dayStart }) => {
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    for(let i=0;i<14;i++){
      existing.push({ name:`${name} ${i}`, type:'task', target:null, dueDate:dayStart, hardDue:false,
        eventTime:scheduled, logs:[], emoji:'🧪', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], durationMinutes:25, flexibilityDays:0, createdAt:Date.now()+i });
    }
    localStorage.setItem('tings_v2', JSON.stringify(existing));
  }, { name, scheduled, dayStart });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(200);
  const planCell = page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  await planCell.tap();
  await page.locator('#day-logs-sheet.open').waitFor();
  const sheet = await page.$('#day-logs-sheet .sheet');

  for(const d of [4, 8, 15, 22, 30]){
    const openBtn = page.locator('#day-logs-list .overview-item', { hasText: `${name} 0` }).locator('[data-open-day-item]');
    const b = await openBtn.boundingBox();
    await cdpDrift(client, b.x + b.width/2, b.y + b.height/2, d);
    await page.waitForTimeout(250);
    const detail = await page.locator('#detail-sheet.open').count();
    console.log(`TAP drift ${d}px -> detail open: ${detail}`);
    await page.evaluate(()=>{document.getElementById('detail-sheet').classList.remove('open');document.body.classList.remove('fullpage-open');});
  }

  // Now a REAL scroll swipe on the list should NOT fire a click.
  console.log('--- real scroll test ---');
  const beforeScroll = await sheet.evaluate(el=>el.scrollTop);
  const firstItem = page.locator('#day-logs-list .overview-item', { hasText: `${name} 0` });
  const fb = await firstItem.boundingBox();
  // fast vertical swipe of 120px
  await cdpDriftV(client, fb.x + 30, fb.y + 10, 120);
  await page.waitForTimeout(300);
  const afterScroll = await sheet.evaluate(el=>el.scrollTop);
  const detailAfter = await page.locator('#detail-sheet.open').count();
  console.log(`scroll: before=${beforeScroll} after=${afterScroll} detailOpen=${detailAfter}`);

  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
async function cdpTap(c,x,y){await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,40));await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x,y,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,80));}
async function cdpDrift(c,x,y,d){await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});const s=6;for(let i=1;i<=s;i++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(d*i)/s,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,16));}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x:x+d,y,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,80));}
async function cdpDriftV(c,x,y,d){await c.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});const s=8;for(let i=1;i<=s;i++){await c.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(d*i)/s,radiusX:10,radiusY:10,force:1,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,16));}await c.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{x,y:y+d,id:0}],modifiers:0,timestamp:Date.now()});await new Promise(r=>setTimeout(r,80));}
