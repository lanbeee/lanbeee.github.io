const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  page.on('console', m => console.log('CONSOLE:', m.type(), m.text().slice(0,300)));
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,500)));
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
  await page.waitForTimeout(4000);
  const state = await page.evaluate(() => ({
    pills: document.querySelectorAll('.free-pill').length,
    listKids: document.querySelector('#list')?.children.length,
    bodyLen: document.body.innerHTML.length,
    title: document.title
  }));
  console.log('STATE:', JSON.stringify(state));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
