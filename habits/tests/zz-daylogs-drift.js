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
    { hid:'h1', name:'Habit One', emoji:'🧪', type:'habit', target:1, logs:[now - dayMs], lastLog:now - dayMs, durationMinutes:25, createdAt:now - 10*dayMs }
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

  // open the overview, tap a calendar day to open day-logs
  await page.locator('#open-overview').click();
  await page.waitForSelector('#overview-sheet.open', { timeout:5000 });
  await sleep(400);
  const dayClicked = await page.evaluate(() => {
    const day = document.querySelector('#overview-calendar [data-log-day]');
    if(!day)return false;
    day.click();
    return true;
  });
  console.log('day clicked:', dayClicked);
  await sleep(400);
  console.log('day-logs sheet open:', await page.locator('#day-logs-sheet.open').count());
  // find a day with entries and step into the item view
  const stepped = await page.evaluate(() => {
    const day = document.querySelector('#overview-calendar .cal-day.has-entry');
    if(!day)return false;
    day.click();
    return true;
  });
  console.log('stepped day:', stepped);
  await sleep(400);
  await page.evaluate(() => { const r = document.querySelector('[data-day-item]'); if(r) r.click(); });
  await sleep(300);
  console.log('body html snippet:', (await page.evaluate(() => document.querySelector('#day-logs-body').innerHTML.slice(0, 400))).replace(/\n/g,' '));
  const btnBox = await page.locator('[data-open-day-item]').first().boundingBox().catch(()=>null);
  if(!btnBox){ console.log('no open button found'); process.exit(0); }
  const x = btnBox.x + btnBox.width/2, y = btnBox.y + btnBox.height/2;
  console.log('open btn at', Math.round(x), Math.round(y));
  // drift tap 20px down
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= 6; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{x, y: y + (20*i)/6, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
    await sleep(12);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x, y: y + 20, id:0}], modifiers:0 });
  await sleep(200);
  console.log('detail sheet opened by drift tap on "open":', await page.locator('#detail-sheet.open').count());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
