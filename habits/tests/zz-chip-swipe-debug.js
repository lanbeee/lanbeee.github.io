// zz-chip-swipe-debug.js — replicate verify [2] drag then [3] swipe, trace chip clicks
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:600 }, isMobile:true, hasTouch:true });
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,200)));
  page.on('console', m => { if(m.text().includes('sgdbg'))console.log('PAGECONSOLE:', m.text()); });
  const client = await page.context().newCDPSession(page);
  const now = Date.now(); const dayMs = 86400000;
  const seedData = [];
  for(let i = 0; i < 14; i++) seedData.push({ hid:`tap-${i}`, name:`Tap Habit ${i}`, emoji:'🧪', type:'habit', target:1, logs:[], durationMinutes:25, createdAt:now - dayMs * (i + 2) });
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
  await page.evaluate(() => { document.querySelector('.ting-card').click(); });
  await page.waitForSelector('#detail-sheet.open', { timeout:5000 });
  await sleep(500);

  async function chipPoint(){
    return page.evaluate(() => {
      const chip = document.querySelector('#detail-weekday-chips button');
      chip.scrollIntoView({ block:'center', inline:'center' });
      const r = chip.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2, wasOn: chip.classList.contains('on') };
    });
  }
  async function drag(x, y, dx, dy, steps = 12, stepMs = 16){
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    for(let i = 1; i <= steps; i++){
      await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x + (dx*i)/steps, y:y + (dy*i)/steps, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
      await sleep(stepMs);
    }
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:x + dx, y:y + dy, id:0}], modifiers:0 });
    await sleep(250);
  }

  // [2]-style vertical drag on the chip
  let p = await chipPoint();
  console.log('[2] drag from', JSON.stringify(p));
  await drag(p.x, p.y, 0, -160, 12, 16);
  let st = await page.evaluate(() => document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]').scrollTop);
  console.log('after [2]: page scrollTop =', st);

  // instrument BEFORE the swipe
  await page.evaluate(() => {
    window.__chipEvents = [];
    window.__origToggle = window.toggleScheduleChip;
    if(window.toggleScheduleChip){
      window.toggleScheduleChip = function(e){
        window.__chipEvents.push({ name: 'TOGGLE-CALL', t: Math.round(performance.now()), trusted: e && e.isTrusted, stack: new Error().stack.split('\n').slice(1,5).join(' | ') });
        return window.__origToggle.apply(this, arguments);
      };
    }
    const proto = Element.prototype;
    const origClick = proto.click;
    proto.click = function(...args){
      window.__chipEvents.push({ name: 'CLICK-CALL', cls: (this.className || this.tagName).toString().slice(0,30), t: Math.round(performance.now()), stack: new Error().stack.split('\n').slice(1,6).join(' | ') });
      return origClick.apply(this, args);
    };
    for(const type of ['pointerdown','pointerup','pointercancel','click','touchstart','touchend','touchmove']){
      document.addEventListener(type, e => {
        const near = e.target.closest && e.target.closest('#detail-weekday-chips button');
        if(near)window.__chipEvents.push({ name: 'DOC:' + type, trusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY), t: Math.round(e.timeStamp), target: (e.target.className || e.target.tagName).toString().slice(0,40) });
      }, true);
    }
    const pager = document.querySelector('#detail-sheet .detail-pager');
    pager.addEventListener('scroll', () => {
      window.__chipEvents.push({ name: 'PAGER-SCROLL', t: Math.round(performance.now()), sl: Math.round(pager.scrollLeft) });
    }, { capture:true, passive:true });
    document.addEventListener('pointerdown', e => {
      window.__downChip = e.target.closest ? e.target.closest('#detail-weekday-chips button') : null;
    }, true);
    document.addEventListener('click', e => {
      const chip = e.target.closest ? e.target.closest('#detail-weekday-chips button') : null;
      if(chip)window.__chipEvents.push({ name: 'CLICK-CHIP-SAME', same: chip === window.__downChip, t: Math.round(e.timeStamp) });
    }, true);
    const origDispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function(ev){
      if(ev.type === 'click' && this.closest && this.closest('#detail-weekday-chips button')){
        window.__chipEvents.push({ name: 'DISPATCH:click', trusted: ev.isTrusted, t: Math.round(ev.timeStamp), stack: new Error().stack.split('\n').slice(1,8).join(' | ') });
      }
      return origDispatch.apply(this, arguments);
    };
  });

  // [3]-style horizontal swipe on the chip
  p = await chipPoint();
  console.log('[3] swipe from', JSON.stringify(p));
  const before = await page.evaluate(() => document.querySelector('#detail-sheet .detail-pager').scrollLeft);
  await drag(p.x, p.y, -280, 0, 12, 12);
  const after = await page.evaluate(before => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const c = document.querySelector('#detail-weekday-chips button');
    return {
      scrollLeft: pager.scrollLeft, before,
      on: c.classList.contains('on'),
      events: window.__chipEvents
    };
  }, before);
  console.log(JSON.stringify(after, null, 2));
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
