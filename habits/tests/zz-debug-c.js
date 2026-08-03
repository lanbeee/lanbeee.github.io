// zz-debug-c.js — replicate test scenario C with console forwarding
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function cdpTapWithDrift(client, x, y, driftX, driftY = 0){
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  const steps = 6;
  for(let i = 1; i <= steps; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x + (driftX * i) / steps, y:y + (driftY * i) / steps, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
    await sleep(12);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:x + driftX, y:y + driftY, id:0}], modifiers:0 });
  await sleep(80);
}
async function closeFreeSheet(page){
  if(await page.locator('#free-time-sheet.open').count()){
    await page.locator('#free-time-close').click({ force:true });
    await page.waitForSelector('#free-time-sheet:not(.open)', { timeout:3000 }).catch(()=>{});
    await sleep(150);
  }
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

  // ── Scenario A (exact tap on mid pill) ──
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  const midIdx = Math.min(freeCount - 1, 2);
  const midPill = page.locator('.free-pill').nth(midIdx);
  await midPill.scrollIntoViewIfNeeded();
  await sleep(200);
  await page.evaluate(() => window.scrollBy(0, -40));
  await sleep(150);
  let box = await page.locator(`.free-pill >> nth=${midIdx}`).boundingBox();
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:box.x + box.width/2, y:box.y + box.height/2, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  await sleep(40);
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:box.x + box.width/2, y:box.y + box.height/2, id:0}], modifiers:0 });
  await sleep(50);
  console.log('A open:', await page.locator('#free-time-sheet.open').count());
  await closeFreeSheet(page);

  // ── Scenario B (sticky stuck header tap) ──
  const sticky = await page.evaluate(async () => {
    const headers = [...document.querySelectorAll('#list .section-header.has-pill')];
    for(const header of headers){
      header.scrollIntoView({ block:'start' });
      await new Promise(r => setTimeout(r, 30));
      window.scrollBy(0, 48);
      await new Promise(r => setTimeout(r, 60));
      const r = header.getBoundingClientRect();
      const pill = header.querySelector('.free-pill');
      if(!pill)continue;
      if(Math.abs(r.top) <= 2 || r.top < 8){
        const pr = pill.getBoundingClientRect();
        return { ok:true, x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 };
      }
    }
    return { ok:false };
  });
  console.log('B sticky:', sticky);
  if(sticky.ok){
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:sticky.x, y:sticky.y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    await sleep(40);
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:sticky.x, y:sticky.y, id:0}], modifiers:0 });
    await sleep(50);
    console.log('B open:', await page.locator('#free-time-sheet.open').count());
    await closeFreeSheet(page);
  }

  // ── Scenario C (drift tap) ──
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  const driftIdx = Math.min(freeCount - 1, 1);
  const driftTarget = await page.evaluate((idx) => {
    const pill = document.querySelectorAll('.free-pill')[idx];
    if(!pill)return { ok:false, tag:'missing' };
    pill.scrollIntoView({ block:'center', inline:'nearest' });
    const mid = (window.innerHeight || 844) * 0.4;
    let r = pill.getBoundingClientRect();
    window.scrollBy(0, r.top + r.height / 2 - mid);
    r = pill.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const el = document.elementFromPoint(x, y);
    return { ok: !!(el && el.closest && el.closest('.free-pill')), x, y, tag: el ? (el.className || el.tagName) : 'none', scrollY: window.scrollY };
  }, driftIdx);
  console.log('C target:', driftTarget);
  await cdpTapWithDrift(client, driftTarget.x, driftTarget.y, 20, 4);
  console.log('C open:', await page.locator('#free-time-sheet.open').count());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
