// free-time-fit — read-only what-if analysis from the open-time sheet.
// Verifies already-open, same-day rearrangement, fixed conflict, and spill.
// HABITS_URL=http://127.0.0.1:4183/ node tests/free-time-fit-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4183/';

let pass = 0, fail = 0;
function assert(condition,message){
  if(condition){ pass += 1; console.log(`  ok: ${message}`); }
  else { fail += 1; console.error(`  FAIL: ${message}`); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const pageErrors = [];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  const now = Date.now();
  const tomorrowDate = new Date(now);
  tomorrowDate.setHours(0,0,0,0);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const weekday = tomorrowDate.getDay();
  const names = ['Deep work','Exercise','Read','Admin','Study','Journal'];
  const data = names.map((name,index)=>({
    hid:`fit-${index}`,name,emoji:'🧠',type:'keepup',target:3,durationMinutes:60,
    allowedWeekdays:[weekday],logs:[{ts:tomorrowDate.getTime() + 12 * 3600000 + index,plan:true}],
    createdAt:now - 86400000
  }));
  const settings = {
    preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:false,
    topics:[],locations:[],travel:{},defaultTravelMode:'driving',
    blockedTimes:[
      {label:'sleep',start:0,end:420},
      {label:'meeting',start:540,end:1020},
      {label:'sleep',start:1320,end:1440}
    ]
  };
  await page.addInitScript(({data,settings})=>{
    try{
      navigator.serviceWorker.register=()=>Promise.resolve({update:()=>Promise.resolve()});
    }catch(_){ /* no-op */ }
    localStorage.setItem('tings_v2',JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
  },{data,settings});
  await page.goto(baseUrl,{waitUntil:'load'});
  await page.waitForTimeout(1500);
  await page.locator('.section-header:has-text("tomorrow") .free-pill').click();

  assert(await page.locator('.free-fit-checker').count() === 1,'open-time sheet includes a compact what-if checker');
  assert(await page.locator('.free-day-seg[type="button"]').count() > 0,'timeline sections are tappable');
  assert(await page.locator('.free-fit-toggle').getAttribute('aria-expanded') === 'false','what-if controls are collapsed by default');
  assert(await page.locator('.free-fit-body').isHidden(),'time fields stay hidden until requested');
  await page.locator('.free-fit-toggle').click();
  assert(await page.locator('.free-fit-toggle').getAttribute('aria-expanded') === 'true','compact row expands the checker');
  assert(await page.locator('.free-fit-body').isVisible(),'expanded checker reveals time controls');
  await page.locator('.free-fit-toggle').click();
  assert(await page.locator('.free-fit-body').isHidden(),'expanded checker can be collapsed again');
  await page.locator('.free-fit-toggle').click();

  async function check(start,end){
    await page.locator('.free-fit-start').fill(start);
    await page.locator('.free-fit-end').fill(end);
    await page.locator('.free-fit-run').click();
    await page.waitForFunction(()=>!document.querySelector('.free-fit-run')?.disabled,{timeout:20000});
    return page.locator('.free-fit-result').innerText();
  }

  const open = await check('21:00','22:00');
  assert(/already open/i.test(open),`recognizes existing space: "${open.replace(/\n/g,' · ')}"`);

  const rearranged = await check('17:00','18:00');
  assert(/can be made open/i.test(rearranged) && /keep everything on this day/i.test(rearranged),`finds same-day rearrangement: "${rearranged.replace(/\n/g,' · ')}"`);

  const fixed = await check('09:00','10:00');
  assert(/not movable/i.test(fixed) && /meeting/i.test(fixed),`identifies fixed conflict: "${fixed.replace(/\n/g,' · ')}"`);

  const spill = await check('17:00','22:00');
  assert(/spill|push .* out of this day/i.test(spill),`warns when the window displaces work: "${spill.replace(/\n/g,' · ')}"`);
  assert(pageErrors.length === 0,`no page errors (${pageErrors.join(', ') || 'none'})`);

  await browser.close();
  console.log(`\n${pass + fail} assertions: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error=>{ console.error(error.stack || error); process.exit(1); });
