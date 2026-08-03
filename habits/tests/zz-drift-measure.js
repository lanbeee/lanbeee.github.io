// zz-drift-measure.js — log every synthesized forgiving click during the pill test
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function cdpTap(client, x, y){
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  await sleep(40);
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x, y, id:0}], modifiers:0 });
  await sleep(50);
}
async function cdpTapWithDrift(client, x, y, driftX, driftY = 0){
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  const steps = 6;
  for(let i = 1; i <= steps; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x + (driftX * i) / steps, y:y + (driftY * i) / steps, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
    await sleep(12);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:x + driftX, y:y + driftY, id:0}], modifiers:0 });
  await sleep(60);
}
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  page.on('console', m => { if(m.text().includes('[sgdbg]'))console.log('CONSOLE:', m.text()); });
  const client = await page.context().newCDPSession(page);
  const now = Date.now();
  const dayMs = 86400000;
  const seedData = [];
  for(let i = 0; i < 14; i++){
    seedData.push({ hid:`tap-${i}`, name:`Tap Habit ${i}`, emoji:'🧪', type:'habit', target:1, logs:[], durationMinutes:25, createdAt:now - dayMs * (i + 2) });
  }
  const seedSettings = { preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false, topics:[], locations:[], travel:{}, defaultTravelMode:'driving', blockedTimes:[{label:'sleep', start:0, end:420},{label:'work', start:540, end:1020},{label:'sleep', start:1320, end:1440}] };
  await page.addInitScript(({ data, settings }) => {
    try{
      if(navigator.serviceWorker){ navigator.serviceWorker.register = () => Promise.resolve({ unregister:() => Promise.resolve(true), update:() => Promise.resolve() }); navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())); }
    }catch{ }
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { data:seedData, settings:seedSettings });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForSelector('.free-pill', { timeout:10000 });
  await sleep(800);
  const freeCount = await page.locator('.free-pill').count();

  // C: drift tap
  const driftIdx = Math.min(freeCount - 1, 1);
  const driftTarget = await page.evaluate((idx) => {
    const pill = document.querySelectorAll('.free-pill')[idx];
    pill.scrollIntoView({ block:'center', inline:'nearest' });
    const mid = (window.innerHeight || 844) * 0.4;
    let r = pill.getBoundingClientRect();
    window.scrollBy(0, r.top + r.height / 2 - mid);
    r = pill.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
  }, driftIdx);
  console.log('C target width:', driftTarget.w);
  await cdpTapWithDrift(client, driftTarget.x, driftTarget.y, 20, 4);
  await sleep(200);

  // D: near-miss
  const nearPill = page.locator('.free-pill').nth(Math.min(1, freeCount - 1));
  await nearPill.scrollIntoViewIfNeeded();
  await sleep(150);
  const nearBox = await nearPill.boundingBox();
  const startX = nearBox.x - 10;
  const startY = nearBox.y + nearBox.height / 2;
  const endX = nearBox.x + nearBox.width / 2;
  console.log('D nearBox width:', nearBox.width, 'drift:', endX - startX);
  await cdpTapWithDrift(client, startX, startY, endX - startX, 0);
  await sleep(200);

  // D2: sticky + drift 16px
  const stickyDrift = await page.evaluate(async () => {
    const headers = [...document.querySelectorAll('#list .section-header.has-pill')];
    const first = headers[0];
    first.scrollIntoView({ block:'start' });
    window.scrollBy(0, 80);
    await new Promise(r => setTimeout(r, 150));
    const pill = first.querySelector('.free-pill');
    const pr = pill.getBoundingClientRect();
    return { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 };
  });
  await sleep(150);
  await cdpTapWithDrift(client, stickyDrift.x, stickyDrift.y, 16, 4);
  await sleep(200);

  // F: missed pill exact + drift
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    if(!existing.some(h => h && h.hid === 'roll-y')){
      existing.push({ hid:'roll-y', name:'Deep Work', emoji:'🎯', type:'keepup', target:5, logs:[now - dayMs], lastLog:now - dayMs, createdAt:now - 30 * dayMs, pinned:false });
      localStorage.setItem('tings_v2', JSON.stringify(existing));
    }
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({ day: yesterday, hids:{ 'roll-y':{ first:now - dayMs, name:'Deep Work' } }, projection:{ day:'stale', hids:['roll-y'], fingerprint:'old' } }));
    if(typeof _droppedDayBaselineDay !== 'undefined')_droppedDayBaselineDay = null;
    if(typeof _droppedDayBaseline !== 'undefined')_droppedDayBaseline = null;
    render();
  });
  await page.waitForSelector('.dropped-pill', { timeout:5000 });
  await page.evaluate(() => {
    const header = document.querySelector('.section-header.has-dropped');
    if(header)header.scrollIntoView({ block:'center' });
  });
  await sleep(300);
  const missBox = await page.locator('.dropped-pill').first().boundingBox();
  console.log('F box width:', missBox.width);
  await cdpTapWithDrift(client, missBox.x + missBox.width/2, missBox.y + missBox.height/2, 12, 3);
  await sleep(200);
  await cdpTapWithDrift(client, missBox.x + missBox.width/2, missBox.y + missBox.height/2, 18, 3);
  await sleep(200);

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
