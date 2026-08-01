// Regression contract for the planner performance work.
//
// This intentionally runs in both default (GLPK) and fast suites. It pauses the
// planner worker during cold load so the assertions can distinguish a usable
// first paint from a planner-complete paint without depending on machine speed.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/planner-performance-regression-test.js
//   HABITS_URL='http://127.0.0.1:4181/?planner=fast' HABITS_PLANNER_MODE=fast \
//     node tests/planner-performance-regression-test.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const EXPECTED_MODE = process.env.HABITS_PLANNER_MODE || (BASE.includes('planner=fast') ? 'fast' : 'default');

(async()=>{
  const failures = [];
  const check = (name,condition,detail='')=>{
    if(condition)console.log(`  ok  - ${name}`);
    else{
      failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
      console.log(`  FAIL- ${name}${detail ? ` :: ${detail}` : ''}`);
    }
  };

  // Offline startup must be able to construct the same worker-backed planner.
  const sw = fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  check('planner worker is available to the offline app shell',
    sw.includes("'./js/agenda-planner-worker.js'"));

  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({
    viewport:{width:390,height:844},
    isMobile:true,
    hasTouch:true,
    serviceWorkers:'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',error=>pageErrors.push(String(error)));

  await page.addInitScript(({expectedMode})=>{
    const now = Date.now();
    const day = new Date(now);
    day.setHours(0,0,0,0);
    const dayBase = day.getTime();
    const tasks = Array.from({length:18},(_,i)=>({
      hid:`perf-task-${i}`,
      name:`Planner performance task ${i + 1}`,
      type:'task',
      dueDate:dayBase + 20 * 60 * 60 * 1000,
      durationMinutes:20 + (i % 3) * 10,
      logs:[],
      lastLog:null,
      priority:i % 4,
      locationIds:['home'],
      anywhereAllowed:false,
      allowedTimeStart:7 * 60,
      allowedTimeEnd:22 * 60
    }));
    tasks.push({
      hid:'perf-breakable',
      name:'Planner performance work',
      type:'task',
      dueDate:dayBase + 20 * 60 * 60 * 1000,
      durationMinutes:240,
      breakable:true,
      minChunkMinutes:30,
      logs:[],
      lastLog:null,
      priority:0,
      locationIds:['home'],
      anywhereAllowed:false,
      allowedTimeStart:9 * 60,
      allowedTimeEnd:18 * 60
    });

    localStorage.clear();
    localStorage.setItem('tings_v2',JSON.stringify(tasks));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:expectedMode !== 'fast',
      homeExtraMode:'cards',
      minimalMode:false,
      showStatusOnCards:true,
      showEarlyOnCards:true,
      availabilityMinutes:[720,720,720,720,720,720,720],
      availabilityOverrides:{},
      blockedTimes:[],
      topics:[],
      travel:{},
      locations:[{id:'home',name:'Home',lat:40.700,lng:-74.000}],
      lastKnownLocationId:'home',
      locationOptIn:false
    }));

    // Capture startup long tasks before deferred app scripts execute.
    window.__plannerPerfLongTasks = [];
    try{
      const observer = new PerformanceObserver(list=>{
        list.getEntries().forEach(entry=>window.__plannerPerfLongTasks.push(entry.duration));
      });
      observer.observe({type:'longtask',buffered:true});
    }catch(_){}

    // Hold only the agenda-planner worker's outbound requests. The home screen
    // must become usable while that worker has not even started planning.
    const NativeWorker = window.Worker;
    const probe = window.__plannerWorkerProbe = {
      created:0,
      posts:0,
      held:[],
      released:false
    };
    window.Worker = class PlannerPerformanceWorker extends NativeWorker{
      constructor(url,options){
        super(url,options);
        this.__isAgendaPlanner = String(url).includes('agenda-planner-worker.js');
        if(this.__isAgendaPlanner)probe.created += 1;
      }
      postMessage(message,transfer){
        if(this.__isAgendaPlanner && !probe.released){
          probe.posts += 1;
          probe.held.push({worker:this,message,transfer});
          return;
        }
        if(transfer === undefined)return super.postMessage(message);
        return super.postMessage(message,transfer);
      }
    };
    window.__releasePlannerWorker = ()=>{
      probe.released = true;
      const held = probe.held.splice(0);
      held.forEach(({worker,message,transfer})=>{
        if(transfer === undefined)NativeWorker.prototype.postMessage.call(worker,message);
        else NativeWorker.prototype.postMessage.call(worker,message,transfer);
      });
    };
  },{expectedMode:EXPECTED_MODE});

  await page.goto(BASE,{waitUntil:'load'});
  await page.waitForSelector('#list .ting-card',{timeout:5000});
  await page.waitForFunction(()=>window.__plannerWorkerProbe?.posts > 0,null,{timeout:5000});

  const cold = await page.evaluate(async()=>{
    const frameStarted = performance.now();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const probe = window.__plannerWorkerProbe;
    return {
      cards:document.querySelectorAll('#list .ting-card').length,
      workerCreated:probe.created,
      workerPosts:probe.posts,
      held:probe.held.length,
      plannerMounted:Boolean(typeof _homeRenderedWeek !== 'undefined' && _homeRenderedWeek?.days),
      frameDelay:performance.now() - frameStarted,
      longestTask:Math.max(0,...(window.__plannerPerfLongTasks || [])),
      fastMode:Boolean(sortSettings && !sortSettings.agendaOptimizer)
    };
  });
  check('cold load delegates planning to the dedicated worker',
    cold.workerCreated === 1 && cold.workerPosts >= 1 && cold.held >= 1,
    JSON.stringify(cold));
  check('cold load paints usable cards before planning completes',
    cold.cards >= 10 && !cold.plannerMounted,
    JSON.stringify(cold));
  check('cold first paint leaves the event loop responsive',
    cold.frameDelay < 250 && cold.longestTask < 750,
    JSON.stringify(cold));
  check('test exercises the requested planner mode',
    cold.fastMode === (EXPECTED_MODE === 'fast'),
    JSON.stringify({expected:EXPECTED_MODE,actualFast:cold.fastMode}));

  await page.evaluate(()=>window.__releasePlannerWorker());
  await page.waitForFunction(()=>Boolean(
    typeof _homeRenderedWeek !== 'undefined'
    && Array.isArray(_homeRenderedWeek?.days)
    && _homeRenderedWeek.days.length
  ),null,{timeout:20000});

  const dirtyKeyContract = await page.evaluate(()=>{
    const data = load();
    const a = homePlannerDirtyKey(data);
    const b = homePlannerDirtyKey(data);
    // Minute bucket must not be part of the dirty key — only the revision/live sig.
    const hasWarm = typeof warmAgendaPlannerWorker === 'function';
    const hasCompactSnapshot = typeof plannerWorkerStorageSnapshot === 'function'
      && !JSON.stringify(plannerWorkerStorageSnapshot()).includes('tings_home_agenda_cache_v1');
    const workerGatedPreload = typeof agendaPlannerWorkerAvailable === 'function'
      && agendaPlannerWorkerAvailable() === true;
    return {
      stable:a === b && Boolean(a),
      hasWarm,
      hasCompactSnapshot,
      workerGatedPreload,
      readyDirty:typeof _optimizerHomeReadyDirtyKey === 'string' && _optimizerHomeReadyDirtyKey.length > 0
    };
  });
  check('dirty key is stable and worker warm/compact snapshot APIs exist',
    dirtyKeyContract.stable
      && dirtyKeyContract.hasWarm
      && dirtyKeyContract.hasCompactSnapshot
      && dirtyKeyContract.workerGatedPreload
      && dirtyKeyContract.readyDirty,
    JSON.stringify(dirtyKeyContract));

  const dirtySkip = await page.evaluate(()=>{
    const original = buildWeekAgendaOffMain;
    let calls = 0;
    buildWeekAgendaOffMain=(...args)=>{calls += 1; return original(...args);};
    // Align ready markers with the live dirty key so the tick is a pure no-op.
    _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(load());
    _optimizerHomeReadyKey = optimizerHomeStateKey(load());
    _optimizerHomeRequestKey = '';
    const started = performance.now();
    const result = queueOptimizedHomeRender(load(),{__backgroundRefresh:true});
    const elapsed = performance.now() - started;
    buildWeekAgendaOffMain=original;
    return {calls,result,elapsed};
  });
  check('unchanged dirty key skips background worker replan',
    dirtySkip.calls === 0 && dirtySkip.result === false && dirtySkip.elapsed < 250,
    JSON.stringify(dirtySkip));

  // The 12-hour/all-cards control is presentation only. It must reuse the
  // mounted week and must not enter any planner, including a synchronous one.
  const displayOnly = await page.evaluate(()=>{
    const original = {
      offMain:buildWeekAgendaOffMain,
      fast:buildWeekAgenda,
      exact:buildWeekAgendaAsync
    };
    const calls = {offMain:0,fast:0,exact:0};
    buildWeekAgendaOffMain=(...args)=>{calls.offMain += 1; return original.offMain(...args);};
    buildWeekAgenda=(...args)=>{calls.fast += 1; return original.fast(...args);};
    buildWeekAgendaAsync=(...args)=>{calls.exact += 1; return original.exact(...args);};

    const week = _homeRenderedWeek;
    const beforeKey = homePlannerStateKey(load(),dayStart(Date.now()));
    const current = normalizeHomeExtraMode(sortSettings.homeExtraMode);
    const next = current === 'cards' ? 'cards12h' : 'cards';
    const target = document.querySelector(`#home-extra-seg [data-seg-value="${next}"]`);
    const started = performance.now();
    target.click();
    const elapsed = performance.now() - started;
    const afterKey = homePlannerStateKey(load(),dayStart(Date.now()));

    buildWeekAgendaOffMain=original.offMain;
    buildWeekAgenda=original.fast;
    buildWeekAgendaAsync=original.exact;
    return {
      calls,
      elapsed,
      sameWeek:week === _homeRenderedWeek,
      samePlannerKey:beforeKey === afterKey,
      selected:target.classList.contains('on'),
      saved:normalizeHomeExtraMode(sortSettings.homeExtraMode),
      next
    };
  });
  check('display-only setting reuses the mounted plan without planner calls',
    displayOnly.calls.offMain === 0
      && displayOnly.calls.fast === 0
      && displayOnly.calls.exact === 0
      && displayOnly.sameWeek
      && displayOnly.samePlannerKey
      && displayOnly.selected
      && displayOnly.saved === displayOnly.next,
    JSON.stringify(displayOnly));
  check('display-only setting responds immediately',
    displayOnly.elapsed < 250,
    JSON.stringify(displayOnly));

  // New presentation toggles must follow the same contract. This specifically
  // guards against adding a setting and accidentally routing it through the
  // seven-day planner again.
  const minimalOnly = await page.evaluate(()=>{
    const original = {
      offMain:buildWeekAgendaOffMain,
      fast:buildWeekAgenda,
      exact:buildWeekAgendaAsync
    };
    const calls = {offMain:0,fast:0,exact:0};
    buildWeekAgendaOffMain=(...args)=>{calls.offMain += 1; return original.offMain(...args);};
    buildWeekAgenda=(...args)=>{calls.fast += 1; return original.fast(...args);};
    buildWeekAgendaAsync=(...args)=>{calls.exact += 1; return original.exact(...args);};

    const week = _homeRenderedWeek;
    const beforeKey = homePlannerStateKey(load(),dayStart(Date.now()));
    const target = document.querySelector('[data-setting-toggle="minimalMode"]');
    const started = performance.now();
    target.click();
    const elapsed = performance.now() - started;
    const afterKey = homePlannerStateKey(load(),dayStart(Date.now()));

    buildWeekAgendaOffMain=original.offMain;
    buildWeekAgenda=original.fast;
    buildWeekAgendaAsync=original.exact;
    return {
      calls,
      elapsed,
      sameWeek:week === _homeRenderedWeek,
      samePlannerKey:beforeKey === afterKey,
      selected:target.getAttribute('aria-pressed') === 'true',
      saved:Boolean(sortSettings.minimalMode)
    };
  });
  check('presentation toggle cannot invalidate or invoke the planner',
    minimalOnly.calls.offMain === 0
      && minimalOnly.calls.fast === 0
      && minimalOnly.calls.exact === 0
      && minimalOnly.sameWeek
      && minimalOnly.samePlannerKey
      && minimalOnly.selected
      && minimalOnly.saved,
    JSON.stringify(minimalOnly));
  check('presentation toggle responds immediately',
    minimalOnly.elapsed < 250,
    JSON.stringify(minimalOnly));

  // A short minimize/restore is below the freshness threshold. The delayed
  // reopen callback may update light UI, but it must not request a new plan.
  const briefResume = await page.evaluate(async()=>{
    const originalRefresh = renderHomeIfChanged;
    const originalOffMain = buildWeekAgendaOffMain;
    let refreshCalls = 0;
    let plannerCalls = 0;
    renderHomeIfChanged=(...args)=>{refreshCalls += 1; return originalRefresh(...args);};
    buildWeekAgendaOffMain=(...args)=>{plannerCalls += 1; return originalOffMain(...args);};

    openSheet('settings-sheet');
    const settings = document.querySelector('.settings-sheet');
    settings.scrollTop = Math.min(250,Math.max(0,settings.scrollHeight - settings.clientHeight));
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
    const started = performance.now();
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const frameDelay = performance.now() - started;
    await new Promise(resolve=>setTimeout(resolve,350));
    const beforeScroll = settings.scrollTop;
    settings.scrollTop = Math.min(
      settings.scrollHeight - settings.clientHeight,
      settings.scrollTop + 40
    );

    renderHomeIfChanged=originalRefresh;
    buildWeekAgendaOffMain=originalOffMain;
    return {
      refreshCalls,
      plannerCalls,
      frameDelay,
      beforeScroll,
      afterScroll:settings.scrollTop,
      open:document.getElementById('settings-sheet').classList.contains('open')
    };
  });
  check('brief foreground restore skips agenda replanning',
    briefResume.refreshCalls === 0 && briefResume.plannerCalls === 0,
    JSON.stringify(briefResume));
  check('settings stay responsive and scrollable after restore',
    briefResume.open
      && briefResume.frameDelay < 250
      && briefResume.afterScroll >= briefResume.beforeScroll,
    JSON.stringify(briefResume));

  // Force a genuinely stale refresh, but replace the worker call with a
  // controlled pending promise. renderHomeIfChanged must return and yield a
  // frame while the old cards remain mounted; neither main-thread planner may
  // be called.
  const background = await page.evaluate(async()=>{
    const original = {
      offMain:buildWeekAgendaOffMain,
      fast:buildWeekAgenda,
      exact:buildWeekAgendaAsync
    };
    const calls = {offMain:0,fast:0,exact:0};
    let finish;
    const pending = new Promise(resolve=>{finish=resolve;});
    buildWeekAgendaOffMain=()=>{calls.offMain += 1; return pending;};
    buildWeekAgenda=()=>{calls.fast += 1; throw new Error('synchronous fast planner called');};
    buildWeekAgendaAsync=()=>{calls.exact += 1; throw new Error('main-thread exact planner called');};

    _optimizerHomeReadyKey = '';
    _optimizerHomeReadyWeek = null;
    _optimizerHomeRequestKey = '';
    _homeListFingerprint = 'forced-stale-performance-regression';
    const node = document.querySelector('#list .swipe-row');
    const startedAt = performance.now();
    const started = renderHomeIfChanged(true);
    const callElapsed = performance.now() - startedAt;
    const frameStarted = performance.now();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    const frameDelay = performance.now() - frameStarted;
    const sameNodeWhilePending = node === document.querySelector('#list .swipe-row');

    finish(_homeRenderedWeek);
    await Promise.resolve();
    buildWeekAgendaOffMain=original.offMain;
    buildWeekAgenda=original.fast;
    buildWeekAgendaAsync=original.exact;
    return {calls,started,callElapsed,frameDelay,sameNodeWhilePending};
  });
  check('stale background refresh uses only the off-main planner',
    background.started
      && background.calls.offMain === 1
      && background.calls.fast === 0
      && background.calls.exact === 0,
    JSON.stringify(background));
  check('pending background plan does not block or replace mounted cards',
    background.callElapsed < 250
      && background.frameDelay < 250
      && background.sameNodeWhilePending,
    JSON.stringify(background));

  check('no page errors',pageErrors.length === 0,JSON.stringify(pageErrors));

  await browser.close();
  if(failures.length){
    console.log(`\n${failures.length} FAILURES:`);
    failures.forEach(failure=>console.log(' -',failure));
    process.exit(1);
  }
  console.log(`\nPASS — planner performance regressions guarded (${EXPECTED_MODE})`);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
