// Progressive render — fast first paint, full agenda on the next frame.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/progressive-render-test.js
//
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror',e=>pageErrors.push(String(e)));

  const failures = [];
  function check(name,cond,detail){
    if(cond){ console.log(`  ok  - ${name}`); }
    else { failures.push(`${name}${detail ? ' :: ' + detail : ''}`); console.log(`  FAIL- ${name}${detail ? ' :: ' + detail : ''}`); }
  }

  await page.addInitScript(()=>{
    window.__progressiveObs = { saw:false, final:false };
    const attachObs = ()=>{
      const list = document.getElementById('list');
      if(!list || list.__progressiveObsAttached)return;
      list.__progressiveObsAttached = true;
      new MutationObserver(()=>{
        if(list.classList.contains('is-progressive'))window.__progressiveObs.saw = true;
        else if(window.__progressiveObs.saw)window.__progressiveObs.final = true;
      }).observe(list,{ attributes:true, attributeFilter:['class'] });
    };
    attachObs();
    document.addEventListener('DOMContentLoaded',attachObs,{ once:true });
    const today = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Morning task', type:'task', dueDate:today, durationMinutes:30, locationIds:['home'], priority:2 },
      { name:'Office errand', type:'task', dueDate:today, durationMinutes:45, locationIds:['office'], priority:2 },
      { name:'Evening habit', type:'keepup', target:7, logs:[today - 2*86400000], durationMinutes:20, locationIds:['home'], priority:2 }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst',
      showWeekOnHome:true,
      topics:[],
      locations:[
        { id:'home', name:'Home', lat:40.700, lng:-74.000 },
        { id:'office', name:'Office', lat:40.705, lng:-73.995 }
      ],
      travel:{},
      defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[],
      lastKnownLocationId:'home',
      locationOptIn:false
    }));
  });

  await page.goto(BASE,{ waitUntil:'load' });
  await page.waitForTimeout(500);

  const sawProgressive = await page.evaluate(()=>{
    const obs = window.__progressiveObs || {};
    const list = document.getElementById('list');
    return {
      saw:Boolean(obs.saw),
      final:Boolean(obs.final) || !list?.classList.contains('is-progressive'),
      cards:list ? list.querySelectorAll('.ting-card').length : 0
    };
  });

  check('progressive class appeared during load', sawProgressive.saw, JSON.stringify(sawProgressive));
  check('progressive class cleared after full render', sawProgressive.final, JSON.stringify(sawProgressive));
  check('cards rendered after progressive pass', sawProgressive.cards >= 3, JSON.stringify(sawProgressive));

  // Reopen path: visibilitychange should schedule another progressive refresh.
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{ configurable:true, get:()=>true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{ configurable:true, get:()=>false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  const afterReopen = await page.evaluate(()=>({
    progressive:document.getElementById('list')?.classList.contains('is-progressive'),
    cards:document.querySelectorAll('#list .ting-card').length
  }));
  check('reopen refresh leaves cards on screen', afterReopen.cards >= 3, JSON.stringify(afterReopen));
  check('reopen refresh finishes (not stuck progressive)', !afterReopen.progressive, JSON.stringify(afterReopen));

  check('no pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  if(failures.length){
    console.log(`\n${failures.length} FAILURES:`);
    failures.forEach(f=>console.log(' • ' + f));
    process.exit(1);
  }
  console.log('\nPASS — progressive render behaviour verified');
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
