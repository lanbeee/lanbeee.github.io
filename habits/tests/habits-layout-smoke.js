const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async()=>{
  const browser = await chromium.launch();
  const cases = [
    {name:'mobile', viewport:{width:390,height:844}, isMobile:true},
    {name:'desktop', viewport:{width:1280,height:900}, isMobile:false}
  ];

  for(const testCase of cases){
    const page = await browser.newPage({viewport:testCase.viewport,isMobile:testCase.isMobile});
    const errors = [];
    page.on('console', msg => { if(msg.type() === 'error')errors.push(msg.text()); });
    page.on('pageerror', err => errors.push(err.message));
    // Stub + unregister any service worker so a leftover SW from a previous
    // test run can't serve stale cached assets and trip a console error.
    // Also start from a clean localStorage so the test is deterministic.
    await page.addInitScript(() => {
      try{
        if(navigator.serviceWorker){
          navigator.serviceWorker.register = () => Promise.resolve({
            unregister:() => Promise.resolve(true),
            update:() => Promise.resolve()
          });
          navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
        }
      }catch{ /* ignore */ }
      try{
        localStorage.setItem('tings_v2', JSON.stringify([]));
        localStorage.setItem('tings_app_settings_v2', JSON.stringify({
          preset:'todayFirst', topics:[], locations:[], travel:{},
          defaultTravelMode:'driving', blockedTimes:[]
        }));
      }catch{ /* ignore */ }
    });
    // networkidle (not domcontentloaded) so external scripts — adhan, leaflet —
    // are loaded and main.js has wired its handlers before we drive the UI.
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    const addButton = testCase.name === 'desktop' ? '#bar-open-add' : '#open-add';
    await page.locator(addButton).waitFor({state:'visible'});
    await page.locator(addButton).click();
    await page.waitForSelector('#add-sheet.open');
    await page.locator('#type-seg [data-v="task"]').click();
    await page.locator('#task-due-row').waitFor({state:'visible'});
    await page.locator('#ting-due-time').waitFor({state:'visible'});
    // Wait for the sheet's open animation to settle (boundingBox stabilises)
    // instead of a fixed timeout — survives slower hosts without bloating the
    // happy-path runtime.
    await page.waitForFunction(()=>{
      const el = document.querySelector('#add-sheet .sheet');
      if(!el)return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, null, { timeout:3000 });
    const box = await page.locator('#add-sheet .sheet').boundingBox();
    if(!box || box.width <= 0 || box.height <= 0)throw new Error(`${testCase.name}: add sheet is not measurable`);
    await page.screenshot({path:`/private/tmp/habits-${testCase.name}.png`,fullPage:true});
    if(errors.length)throw new Error(`${testCase.name}: ${errors.join('\n')}`);
    await page.close();
  }
  await browser.close();
  console.log('Layout smoke passed');
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
