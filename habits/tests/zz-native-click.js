const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
async function drag(client, x, y, dx, dy, steps = 12, stepMs = 16){
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= steps; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x + (dx*i)/steps, y:y + (dy*i)/steps, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
    await sleep(stepMs);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:x + dx, y:y + dy, id:0}], modifiers:0 });
  await sleep(250);
}
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:600 }, isMobile:true, hasTouch:true });
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
  await page.waitForSelector('.ting-card', { timeout:10000 });
  await sleep(600);
  await page.evaluate(() => { document.querySelector('.ting-card').click(); });
  await page.waitForSelector('#detail-sheet.open', { timeout:5000 });
  await sleep(500);

  await page.evaluate(() => {
    window.__clicks = [];
    const origClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function(){
      if(this.matches && this.matches('#detail-weekday-chips button')){
        window.__clicks.push({ type:'synthetic-click', stack: new Error().stack.split('\n').slice(1,6).join(' | ') });
      }
      return origClick.apply(this, arguments);
    };
    document.addEventListener('click', e => {
      const btn = e.target.closest && e.target.closest('#detail-weekday-chips button');
      if(btn) window.__clicks.push({ type:'click-event', trusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY), scrollY: window.scrollY });
    }, true);
  });

  const chipInfo = await page.evaluate(() => {
    const pageEl = document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]');
    const chip = pageEl.querySelector('#detail-weekday-chips button');
    chip.scrollIntoView({ block:'center', inline:'center' });
    const r = chip.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2, scrollTop: pageEl.scrollTop, wasOn: chip.classList.contains('on') };
  });
  await sleep(250);
  await drag(client, chipInfo.x, chipInfo.y, 0, -160);
  const res = await page.evaluate(() => {
    const pageEl = document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]');
    const c = document.querySelector('#detail-weekday-chips button');
    return { scrollTop: pageEl.scrollTop, on: c.classList.contains('on'), clicks: window.__clicks };
  });
  console.log('chip wasOn before:', chipInfo.wasOn);
  console.log('after drag:', JSON.stringify(res));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
