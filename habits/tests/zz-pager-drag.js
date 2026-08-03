const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,200)));
  const client = await page.context().newCDPSession(page);
  const now = Date.now();
  const dayMs = 86400000;
  const seedData = [
    { hid:'h1', name:'Habit One', emoji:'🧪', type:'habit', target:1, logs:[now - dayMs], lastLog:now - dayMs, durationMinutes:25, createdAt:now - 10*dayMs },
    { hid:'h2', name:'Habit Two', emoji:'🧪', type:'habit', target:1, logs:[now - dayMs], lastLog:now - dayMs, durationMinutes:25, createdAt:now - 10*dayMs }
  ];
  const seedSettings = { preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false, topics:[], locations:[], travel:{}, defaultTravelMode:'driving', blockedTimes:[] };
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
  await sleep(400);

  const pagerInfo = await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const pages = [...pager.querySelectorAll('.detail-page')].filter(p=>!p.hidden);
    return {
      scrollLeft: pager.scrollLeft,
      clientWidth: pager.clientWidth,
      scrollWidth: pager.scrollWidth,
      pages: pages.map(p => p.dataset.detailNav),
      firstPageHeight: pages[0].scrollHeight,
      firstPageClient: pages[0].clientHeight
    };
  });
  console.log('pager:', JSON.stringify(pagerInfo));

  // swipe left 260 starting from middle of the pager
  const swipe = await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const r = pager.getBoundingClientRect();
    return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.5, before: pager.scrollLeft };
  });
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:swipe.x, y:swipe.y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= 12; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:swipe.x - (260*i)/12, y:swipe.y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    await sleep(16);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:swipe.x - 260, y:swipe.y, id:0}], modifiers:0 });
  await sleep(400);
  const after = await page.evaluate(() => document.querySelector('#detail-sheet .detail-pager').scrollLeft);
  console.log('pager after swipe:', after, '(before', swipe.before + ')');

  // vertical drag inside first page starting on empty area
  const v = await page.evaluate(() => {
    const pageEl = document.querySelector('#detail-sheet .detail-page');
    return { scrollTop: pageEl.scrollTop, scrollHeight: pageEl.scrollHeight, clientHeight: pageEl.clientHeight, x: 195, y: 500 };
  });
  console.log('page scroll metrics:', JSON.stringify(v));
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:v.x, y:v.y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= 12; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x:v.x, y:v.y - (140*i)/12, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    await sleep(16);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:v.x, y:v.y - 140, id:0}], modifiers:0 });
  await sleep(300);
  const afterV = await page.evaluate(() => document.querySelector('#detail-sheet .detail-page').scrollTop);
  console.log('page scrollTop after drag:', afterV, '(before', v.scrollTop + ')');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
