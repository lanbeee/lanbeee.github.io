// debug-drift.js — reproduce scenario C failure and log the scroll snapshot
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
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
  console.log('free pills:', freeCount);

  // instrument the pointerup path
  await page.evaluate(() => {
    window.__dbg = [];
    const orig = PointerEvent.prototype.constructor;
    document.addEventListener('pointerup', e => {
      const b = window.__lastBP;
      window.__dbg.push({ type:'pointerup', x:Math.round(e.clientX), y:Math.round(e.clientY), time:Date.now() });
    }, true);
    // patch: wrap the pointerdown capture to stash the snapshot
    document.addEventListener('pointerdown', e => {
      window.__dbg.push({ type:'pointerdown', x:Math.round(e.clientX), y:Math.round(e.clientY), time:Date.now(), target: (e.target.className || e.target.tagName) });
    }, true);
    // snapshot scrollers by hijacking buttonPointer creation: simpler to read at up
  });

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
  console.log('drift target:', driftTarget);

  // snapshot the actual scrollers the handler would record, right before the gesture
  const snap = await page.evaluate(({x,y}) => {
    const el = document.elementFromPoint(x,y);
    const btn = el && el.closest('button');
    if(!btn)return { error:'no button' };
    const scrollers = [];
    for(let e = btn.parentElement; e; e = e.parentElement){
      if((e.scrollHeight > e.clientHeight + 1) || (e.scrollWidth > e.clientWidth + 1)){
        scrollers.push({ tag:e.tagName, cls:e.className, scrollHeight:e.scrollHeight, clientHeight:e.clientHeight, scrollTop:e.scrollTop, scrollWidth:e.scrollWidth, clientWidth:e.clientWidth, scrollLeft:e.scrollLeft });
      }
      if(e === document.documentElement)break;
    }
    return { scrollers, scrollY: window.scrollY };
  }, { x:driftTarget.x, y:driftTarget.y });
  console.log(JSON.stringify(snap, null, 1));

  // finger drift 20px x, 4px y like the test
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x:driftTarget.x, y:driftTarget.y, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
  await sleep(40);
  for(let i = 1; i <= 6; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:driftTarget.x + (20*i)/6, y:driftTarget.y + (4*i)/6, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
    await sleep(12);
  }
  const afterMove = await page.evaluate(() => ({ scrollY: window.scrollY }));
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{ x:driftTarget.x + 20, y:driftTarget.y + 4, id:0 }], modifiers:0 });
  await sleep(80);
  const afterUp = await page.evaluate(() => ({ scrollY: window.scrollY }));
  console.log('after move:', afterMove, 'after up:', afterUp);
  const open = await page.locator('#free-time-sheet.open').count();
  console.log('sheet open:', open);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
