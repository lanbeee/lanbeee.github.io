// Fast heuristic first paint, then optional GLPK upgrade.
// Cards appear immediately; the optimized week may replace them once.
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
    window.__progressiveObs = { saw:false, cardsSeen:false, destructive:0 };
    const attachObs = ()=>{
      const list = document.getElementById('list');
      if(!list || list.__progressiveObsAttached)return;
      list.__progressiveObsAttached = true;
      new MutationObserver(records=>{
        const state = window.__progressiveObs;
        records.forEach(record=>{
          if(record.type === 'attributes' && list.classList.contains('is-progressive'))state.saw = true;
          if(record.type !== 'childList')return;
          if(state.cardsSeen && record.removedNodes.length)state.destructive += 1;
          if([...record.addedNodes].some(node=>node.nodeType === 1
            && (node.matches?.('.ting-card,.swipe-row') || node.querySelector?.('.ting-card')))){
            state.cardsSeen = true;
          }
        });
      }).observe(list,{ childList:true, attributes:true, attributeFilter:['class'] });
    };
    attachObs();
    document.addEventListener('DOMContentLoaded',attachObs,{ once:true });
    const today = Date.now();
    const tomorrowMorning = new Date(today);
    tomorrowMorning.setHours(0,0,0,0);
    tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
    tomorrowMorning.setHours(10,0,0,0);
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Morning task', type:'task', dueDate:today, durationMinutes:30, locationIds:['home'], priority:2 },
      { name:'Office errand', type:'task', dueDate:today, durationMinutes:45, locationIds:['office'], priority:2 },
      { name:'Evening habit', type:'keepup', target:7, logs:[today - 2*86400000], durationMinutes:20, locationIds:['home'], priority:2 },
      { name:'Tomorrow review', type:'task', dueDate:tomorrowMorning.getTime(), eventTime:tomorrowMorning.getTime(), durationMinutes:30, locationIds:['home'], priority:2 }
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
  // Fast path: cards must appear without waiting on GLPK.
  await page.waitForSelector('#list .ting-card',{ timeout:3000 });
  const early = await page.evaluate(()=>({
    cards:document.querySelectorAll('#list .ting-card').length,
    progressive:document.getElementById('list')?.classList.contains('is-progressive'),
    sawProgressive:Boolean(window.__progressiveObs && window.__progressiveObs.saw),
    optimized:Boolean(_homeRenderedWeek && _homeRenderedWeek.optimized)
  }));
  check('cards appear before GLPK finishes', early.cards >= 3, JSON.stringify(early));
  check('fast paint does not use is-progressive', !early.sawProgressive && !early.progressive, JSON.stringify(early));

  await page.waitForFunction(()=>Boolean(typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek?.optimized),null,{ timeout:15000 });
  await page.waitForTimeout(100);

  const loadState = await page.evaluate(()=>{
    const list = document.getElementById('list');
    return {
      sawProgressive:Boolean(window.__progressiveObs && window.__progressiveObs.saw),
      progressiveNow:Boolean(list && list.classList.contains('is-progressive')),
      cards:list ? list.querySelectorAll('.ting-card').length : 0,
      optimizerDefault:loadSortSettings().agendaOptimizer,
      optimized:Boolean(typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek?.optimized),
      destructiveRenders:Number(window.__progressiveObs?.destructive || 0),
      hasFingerprint:typeof homeListFingerprint === 'function',
      hasRenderIfChanged:typeof renderHomeIfChanged === 'function',
      hasPlanSignature:typeof homeAgendaPlanSignature === 'function'
    };
  });
  check('cold load does not use is-progressive', !loadState.sawProgressive && !loadState.progressiveNow, JSON.stringify(loadState));
  check('GLPK optimizer is the default planner', loadState.optimizerDefault && loadState.optimized, JSON.stringify(loadState));
  // One heuristic→optimized replace is expected; more churn is not.
  check('cold load upgrades at most once', loadState.destructiveRenders <= 1, JSON.stringify(loadState));
  check('cards render on cold load', loadState.cards >= 3, JSON.stringify(loadState));
  check('background comparison helpers exist',
    loadState.hasFingerprint && loadState.hasRenderIfChanged && loadState.hasPlanSignature,
    JSON.stringify(loadState));

  const skip = await page.evaluate(()=>{
    const before = document.querySelectorAll('#list .ting-card').length;
    const skipped = renderHomeIfChanged() === false;
    const after = document.querySelectorAll('#list .ting-card').length;
    const forced = renderHomeIfChanged(true) === true;
    return { before, after, skipped, forced, cardsAfterForce:document.querySelectorAll('#list .ting-card').length };
  });
  check('unchanged fingerprint skips re-render', skip.skipped && skip.before === skip.after, JSON.stringify(skip));
  check('force:true still performs a refresh check', skip.forced && skip.cardsAfterForce >= 3, JSON.stringify(skip));

  // GLPK refresh: invalidate the solved-result cache so this performs a real
  // asynchronous solve. An identical result must keep the exact DOM nodes.
  const glpkBefore = await page.evaluate(()=>{
    window.__stableGlpkNode = document.querySelector('#list .swipe-row');
    const destructive = Number(window.__progressiveObs?.destructive || 0);
    _optimizerHomeReadyKey = '';
    _optimizerHomeReadyWeek = null;
    _homeListFingerprint = 'stale-for-glpk-refresh-test';
    const started = renderHomeIfChanged(true);
    return {started,destructive};
  });
  await page.waitForFunction(()=>_optimizerHomeRequestKey === '',null,{timeout:15000});
  const glpkAfter = await page.evaluate(()=>({
    sameNode:window.__stableGlpkNode === document.querySelector('#list .swipe-row'),
    destructive:Number(window.__progressiveObs?.destructive || 0),
    optimized:Boolean(_homeRenderedWeek?.optimized)
  }));
  check('GLPK identical background solve keeps mounted cards',
    glpkBefore.started && glpkAfter.sameNode && glpkAfter.destructive === glpkBefore.destructive && glpkAfter.optimized,
    JSON.stringify({glpkBefore,glpkAfter}));

  // Fast planner refresh: use the same stale fingerprint path with GLPK off.
  // The sync recalculation should also compare off-screen and preserve nodes.
  const fastRefresh = await page.evaluate(()=>{
    sortSettings = {...sortSettings,agendaOptimizer:false};
    render();
    const node = document.querySelector('#list .swipe-row');
    const destructive = Number(window.__progressiveObs?.destructive || 0);
    _homeListFingerprint = 'stale-for-fast-refresh-test';
    const started = renderHomeIfChanged(true);
    return {
      started,
      sameNode:node === document.querySelector('#list .swipe-row'),
      before:destructive,
      after:Number(window.__progressiveObs?.destructive || 0),
      optimized:Boolean(_homeRenderedWeek?.optimized)
    };
  });
  check('fast identical background calculation keeps mounted cards',
    fastRefresh.started && fastRefresh.sameNode && fastRefresh.after === fastRefresh.before && !fastRefresh.optimized,
    JSON.stringify(fastRefresh));

  // A genuine repaint must keep the day/item currently being read at the same
  // viewport offset instead of sorting the user back to the top.
  const anchor = await page.evaluate(()=>{
    const tomorrow = dateKey(dayStart(Date.now()) + 86400000);
    const header = document.querySelector(`#list .section-header[data-capacity-day="${tomorrow}"]`);
    if(!header)return {found:false};
    header.scrollIntoView({block:'start',behavior:'instant'});
    const beforeTop = header.getBoundingClientRect().top;
    const beforeScroll = window.scrollY;
    render({__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
    const afterHeader = document.querySelector(`#list .section-header[data-capacity-day="${tomorrow}"]`);
    return {
      found:Boolean(afterHeader),
      beforeTop,
      afterTop:afterHeader ? afterHeader.getBoundingClientRect().top : null,
      beforeScroll,
      afterScroll:window.scrollY
    };
  });
  check('genuine plan repaint preserves the day being read',
    anchor.found && anchor.beforeScroll > 0 && Math.abs(anchor.afterTop - anchor.beforeTop) <= 2 && anchor.afterScroll > 0,
    JSON.stringify(anchor));

  // Restore the default GLPK mode for the reopen assertions below.
  await page.evaluate(()=>{
    sortSettings = {...sortSettings,agendaOptimizer:true};
    _optimizerHomeReadyKey = '';
    _optimizerHomeReadyWeek = null;
    render();
  });
  await page.waitForFunction(()=>Boolean(_homeRenderedWeek?.optimized),null,{timeout:15000});

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
    failures.forEach(f=>console.log(' -',f));
    process.exit(1);
  }
  console.log('\nPASS — smooth home refresh verified');
})().catch(err=>{ console.error(err); process.exit(1); });
