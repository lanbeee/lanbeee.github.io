// Smooth home refresh — no progressive flicker, fingerprint skip for no-ops.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/progressive-render-test.js
//
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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
    window.__progressiveObs = { saw:false };
    const attachObs = ()=>{
      const list = document.getElementById('list');
      if(!list || list.__progressiveObsAttached)return;
      list.__progressiveObsAttached = true;
      new MutationObserver(()=>{
        if(list.classList.contains('is-progressive'))window.__progressiveObs.saw = true;
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
  await page.waitForTimeout(400);

  const loadState = await page.evaluate(()=>{
    const list = document.getElementById('list');
    return {
      sawProgressive:Boolean(window.__progressiveObs && window.__progressiveObs.saw),
      progressiveNow:Boolean(list && list.classList.contains('is-progressive')),
      cards:list ? list.querySelectorAll('.ting-card').length : 0,
      hasFingerprint:typeof homeListFingerprint === 'function',
      hasRenderIfChanged:typeof renderHomeIfChanged === 'function'
    };
  });
  check('cold load does not use is-progressive', !loadState.sawProgressive && !loadState.progressiveNow, JSON.stringify(loadState));
  check('cards render on cold load', loadState.cards >= 3, JSON.stringify(loadState));
  check('homeListFingerprint + renderHomeIfChanged exist', loadState.hasFingerprint && loadState.hasRenderIfChanged, JSON.stringify(loadState));

  const skip = await page.evaluate(()=>{
    const before = document.querySelectorAll('#list .ting-card').length;
    const skipped = renderHomeIfChanged() === false;
    const after = document.querySelectorAll('#list .ting-card').length;
    const forced = renderHomeIfChanged(true) === true;
    return { before, after, skipped, forced, cardsAfterForce:document.querySelectorAll('#list .ting-card').length };
  });
  check('unchanged fingerprint skips re-render', skip.skipped && skip.before === skip.after, JSON.stringify(skip));
  check('force:true still re-renders', skip.forced && skip.cardsAfterForce >= 3, JSON.stringify(skip));

  // Reopen should stay sync (no progressive class).
  await page.evaluate(()=>{
    window.__progressiveObs.saw = false;
    Object.defineProperty(document,'hidden',{ configurable:true, get:()=>true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{ configurable:true, get:()=>false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  const afterReopen = await page.evaluate(()=>({
    sawProgressive:Boolean(window.__progressiveObs && window.__progressiveObs.saw),
    progressive:document.getElementById('list')?.classList.contains('is-progressive'),
    cards:document.querySelectorAll('#list .ting-card').length
  }));
  check('reopen does not use is-progressive', !afterReopen.sawProgressive && !afterReopen.progressive, JSON.stringify(afterReopen));
  check('reopen keeps cards on screen', afterReopen.cards >= 3, JSON.stringify(afterReopen));

  check('no pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  if(failures.length){
    console.log(`\n${failures.length} FAILURES:`);
    failures.forEach(f=>console.log(' • ' + f));
    process.exit(1);
  }
  console.log('\nPASS — smooth home refresh verified');
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
