const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async () => {
  const name = `CDPTouch ${Date.now()}`;
  const now = new Date();
  const scheduled = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 15, 0, 0).getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGEERROR] ${err.message || err}`));

  const client = await page.context().newCDPSession(page);

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
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(300);

  // Open day logs via real CDP touch on the plan cell
  const planCell = await page.locator('#overview-calendar [data-log-day]').filter({ has: page.locator('.cal-dot.plan') }).last();
  const cellBox = await planCell.boundingBox();
  await cdpTap(client, cellBox.x + cellBox.width/2, cellBox.y + cellBox.height/2);
  await page.locator('#day-logs-sheet.open').waitFor();
  console.log('day-logs-sheet opened via CDP touch');

  const openBtn = page.locator('#day-logs-list .overview-item', { hasText: name }).locator('[data-open-day-item]');
  await openBtn.waitFor();
  const btnBox = await openBtn.boundingBox();
  console.log('open button box:', JSON.stringify(btnBox));

  // Realistic phone tap: finger down, drift ~22px, up (forgiving-button path)
  console.log('=== CDP touch with 22px drift on OPEN button ===');
  await cdpTapWithDrift(client, btnBox.x + btnBox.width/2, btnBox.y + btnBox.height/2, 22);
  await page.waitForTimeout(1000);

  let detailOpen = await page.locator('#detail-sheet.open').count();
  let daySheetOpen = await page.locator('#day-logs-sheet.open').count();
  console.log('RESULT (drift 22): detail open =', detailOpen, '| day-logs open =', daySheetOpen);
  console.log('--- logs ---');
  console.log(logs.slice(-12).join('\n'));
  await browser.close();
})().catch(async err => { console.error(err); process.exit(1); });

async function cdpTap(client, x, y){
  await sendTouch(client, [
    {x, y, id: 0}
  ], [{x, y, id: 0}], 50);
}

async function cdpTapWithDrift(client, x, y, drift){
  // press
  await client.send('Input.dispatchTouchEvent', {
    type:'touchStart',
    touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}],
    modifiers:0, timestamp:Date.now()
  });
  // drift in steps
  const steps = 6;
  for(let i=1;i<=steps;i++){
    await client.send('Input.dispatchTouchEvent', {
      type:'touchMove',
      touchPoints:[{x:x + (drift*i)/steps, y, radiusX:10, radiusY:10, force:1, id:0}],
      modifiers:0, timestamp:Date.now()
    });
    await sleep(15);
  }
  await client.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[{x:x+drift, y, id:0}],
    modifiers:0, timestamp:Date.now()
  });
  await sleep(50);
}

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function sendTouch(client, start, end, gap){
  await client.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:start.map(p=>({...p,radiusX:10,radiusY:10,force:1})), modifiers:0, timestamp:Date.now()});
  await sleep(gap);
  await client.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:end.map(p=>({x:p.x,y:p.y,id:p.id})), modifiers:0, timestamp:Date.now()});
  await sleep(50);
}
