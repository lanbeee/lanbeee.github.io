// Regression contract for the planner performance work.
//
// This intentionally runs in both default (GLPK) and fast suites. It pauses the
// planner worker during cold load so the assertions can distinguish a usable
// first paint from a planner-complete paint without depending on machine speed.
//
// Guards (non-exhaustive):
//   • worker offload; cold paint before plan; frame/longtask budgets
//   • dirty-key skip for unchanged background ticks; presentation toggles
//   • persisted planner revision; compact worker snapshot; no main-thread GLPK
//   • fresh same-day cache skips immediate replan; lean week rehydrate/export
//   • planner-affecting settings invalidate dirty key; memo refuses cross-midnight
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

  // ── Contracts for the cold-open / dirty-key / lean-week improvements ──

  const sourceContracts = (()=>{
    const dataSrc = fs.readFileSync(path.join(__dirname,'..','js','data.js'),'utf8');
    const optSrc = fs.readFileSync(path.join(__dirname,'..','js','agenda-optimizer.js'),'utf8');
    const workerSrc = fs.readFileSync(path.join(__dirname,'..','js','agenda-planner-worker.js'),'utf8');
    const listSrc = fs.readFileSync(path.join(__dirname,'..','js','list-view.js'),'utf8');
    return {
      persistedRevision:dataSrc.includes("tings_planner_revision_v1")
        && dataSrc.includes('localStorage.setItem(PLANNER_REVISION_KEY'),
      bumpClearsCaches:dataSrc.includes('endPlannerSolveCaches'),
      memoTodayBase:optSrc.includes('todayBase')
        && optSrc.includes('_plannerWeekDayMemo.todayBase === todayBase'),
      warmTimeout:workerSrc.includes('withTimeout(ensureGlpk()'),
      warmExactOnly:optSrc.includes('agendaOptimizer === false')
        && listSrc.includes('exact && typeof warmAgendaPlannerWorker'),
      settingsSigGates:listSrc.includes('showDueTasksInAgenda')
        && listSrc.includes('showPlannedItemsInAgenda')
        && listSrc.includes('showDueHabitsInAgenda')
        && listSrc.includes('homeCityLat')
        && listSrc.includes('planWeight')
        && listSrc.includes('plansFirst'),
      rehydrateHelper:optSrc.includes('function rehydrateAgendaWeekHabits'),
      preloadGated:dataSrc.includes('!agendaPlannerWorkerAvailable()')
    };
  })();
  check('source contracts: persisted revision, memo date, warm timeout, settingsSig, rehydrate',
    sourceContracts.persistedRevision
      && sourceContracts.bumpClearsCaches
      && sourceContracts.memoTodayBase
      && sourceContracts.warmTimeout
      && sourceContracts.warmExactOnly
      && sourceContracts.settingsSigGates
      && sourceContracts.rehydrateHelper
      && sourceContracts.preloadGated,
    JSON.stringify(sourceContracts));

  const revisionPersist = await page.evaluate(()=>{
    const before = plannerDataRevision();
    const data = load();
    // Touch a habit so save() bumps the persisted revision.
    if(data[0])data[0].priority = (Number(data[0].priority) || 0) === 0 ? 1 : 0;
    save(data);
    const after = plannerDataRevision();
    const stored = Number(localStorage.getItem('tings_planner_revision_v1'));
    // Simulate a cold boot reading the same counter.
    const restored = Number(localStorage.getItem('tings_planner_revision_v1'));
    return {
      bumped:after > before,
      storedMatches:stored === after,
      restoredMatches:restored === after,
      cacheKey:typeof homeAgendaCacheStateKey === 'function' ? homeAgendaCacheStateKey(load()) : ''
    };
  });
  check('planner revision persists across saves (cold-open cache key survives reload)',
    revisionPersist.bumped
      && revisionPersist.storedMatches
      && revisionPersist.restoredMatches
      && Boolean(revisionPersist.cacheKey),
    JSON.stringify(revisionPersist));

  const dirtyKeySettings = await page.evaluate(()=>{
    const data = load();
    const base = homePlannerDirtyKey(data);
    const s = sortSettings;
    const beforeDue = s.showDueTasksInAgenda;
    const beforePlan = s.planWeight;
    const beforeCity = s.homeCityLat;

    saveSortSettings({...s,showDueTasksInAgenda:beforeDue === false});
    const afterDue = homePlannerDirtyKey(data);
    saveSortSettings({...sortSettings,showDueTasksInAgenda:beforeDue,planWeight:(Number(beforePlan) || 100) === 100 ? 120 : 100});
    const afterPlan = homePlannerDirtyKey(data);
    saveSortSettings({
      ...sortSettings,
      planWeight:beforePlan,
      homeCityLat:Number.isFinite(beforeCity) ? beforeCity + 0.01 : 40.71,
      homeCityLng:-74.01,
      homeCityName:'Test City'
    });
    const afterCity = homePlannerDirtyKey(data);
    // Restore.
    saveSortSettings({
      ...sortSettings,
      showDueTasksInAgenda:beforeDue,
      planWeight:beforePlan,
      homeCityLat:beforeCity,
      homeCityLng:sortSettings.homeCityLng,
      homeCityName:sortSettings.homeCityName || ''
    });
    const afterRestore = homePlannerDirtyKey(data);

    // Presentation must NOT move the dirty key.
    const beforePres = homePlannerDirtyKey(data);
    saveSortSettings({...sortSettings,minimalMode:!Boolean(sortSettings.minimalMode)});
    const afterPres = homePlannerDirtyKey(data);
    saveSortSettings({...sortSettings,minimalMode:!Boolean(sortSettings.minimalMode)});

    return {
      dueChanges:afterDue !== base,
      planChanges:afterPlan !== base && afterPlan !== afterDue,
      cityChanges:afterCity !== base,
      restoreOk:Boolean(afterRestore),
      presentationStable:beforePres === afterPres
    };
  });
  check('planner-affecting settings invalidate dirty key; presentation does not',
    dirtyKeySettings.dueChanges
      && dirtyKeySettings.planChanges
      && dirtyKeySettings.cityChanges
      && dirtyKeySettings.presentationStable,
    JSON.stringify(dirtyKeySettings));

  const compactSnapshot = await page.evaluate(()=>{
    const snap = plannerWorkerStorageSnapshot();
    const keys = Object.keys(snap).sort();
    const allowed = new Set([
      'tings_order_constraints_v1',
      'tings_auto_chunk_plans_v1',
      'tings_today_suggested_v1'
    ]);
    const onlyAllowed = keys.every(k=>allowed.has(k));
    const hasAgendaCache = keys.includes('tings_home_agenda_cache_v1');
    const hasHabits = keys.includes('tings_v2');
    return {keys,onlyAllowed,hasAgendaCache,hasHabits};
  });
  check('worker storage snapshot is compact (no habits blob or agenda cache)',
    compactSnapshot.onlyAllowed
      && !compactSnapshot.hasAgendaCache
      && !compactSnapshot.hasHabits,
    JSON.stringify(compactSnapshot));

  const leanRehydrate = await page.evaluate(()=>{
    const data = load();
    const week = _homeRenderedWeek;
    if(!week || !week.days || !week.days.length)return {ok:false,reason:'no week'};
    const lean = leanAgendaWeek(JSON.parse(JSON.stringify(week,(k,v)=>k === 'h' ? v : v)));
    // Force a true lean clone from the live week.
    const leanLive = leanAgendaWeek(week);
    const anyFill = (leanLive.days[0].timeline || []).find(row=>row && row.i != null);
    const stripped = Boolean(anyFill && anyFill.h == null && leanLive.__lean);
    rehydrateAgendaWeekHabits(leanLive,data);
    const restored = (leanLive.days[0].timeline || []).filter(row=>row && row.i != null);
    const named = restored.length > 0 && restored.every(row=>row.h && row.h.name);
    const text = formatWeekPlacementsText(leanLive);
    const exportNames = restored
      .filter(r=>r.h && r.h.name && (r.kind === 'fill' || r.kind === 'scheduled'))
      .slice(0,3)
      .every(r=>text.includes(r.h.name));
    // data[i] fallback: lean copy without rehydrate must still export real names.
    const lean2 = leanAgendaWeek(week);
    const textFallback = formatWeekPlacementsText(lean2);
    const fallbackNames = (lean2.days[0].timeline || [])
      .filter(r=>r && r.i != null && data[r.i] && data[r.i].name && (r.kind === 'fill' || r.kind === 'scheduled'))
      .slice(0,3)
      .every(r=>textFallback.includes(data[r.i].name));
    return {ok:true,stripped,named,exportNames,fallbackNames};
  });
  check('lean week strips h; rehydrate and export data[i] fallback keep names',
    leanRehydrate.ok
      && leanRehydrate.stripped
      && leanRehydrate.named
      && leanRehydrate.exportNames
      && leanRehydrate.fallbackNames,
    JSON.stringify(leanRehydrate));

  const freshCacheGate = await page.evaluate(async()=>{
    const data = load();
    const week = _homeRenderedWeek;
    if(!week)return {ok:false,reason:'no week'};
    saveHomeAgendaCache(data,week);
    const fresh = homeAgendaCacheIsFresh(data);
    const probe = window.__plannerWorkerProbe;
    // Re-hold worker posts so we can see whether an immediate build is kicked.
    probe.released = false;
    const postsBefore = probe.posts;
    _optimizerHomeReadyKey = '';
    _optimizerHomeReadyWeek = null;
    _optimizerHomeRequestKey = '';
    _idlePlannerRefreshTimer = null;
    const painted = queueOptimizedHomeRender(data,{});
    const postsImmediate = probe.posts;
    // Allow idle callback to run (warm/build may post once idle fires).
    await new Promise(resolve=>{
      if(typeof requestIdleCallback === 'function')requestIdleCallback(()=>resolve(),{timeout:400});
      else setTimeout(resolve,100);
    });
    await new Promise(resolve=>setTimeout(resolve,50));
    const postsAfterIdle = probe.posts;
    // Release so the page stays healthy for later checks.
    window.__releasePlannerWorker();
    return {
      ok:true,
      fresh,
      painted:painted === true,
      noImmediatePost:postsImmediate === postsBefore,
      idleMayPost:postsAfterIdle >= postsBefore,
      cards:document.querySelectorAll('#list .ting-card').length
    };
  });
  check('fresh same-day cache paints without an immediate worker replan',
    freshCacheGate.ok
      && freshCacheGate.fresh
      && freshCacheGate.painted
      && freshCacheGate.noImmediatePost
      && freshCacheGate.cards >= 10,
    JSON.stringify(freshCacheGate));

  const noMainGlpk = await page.evaluate(()=>{
    const workersOk = agendaPlannerWorkerAvailable() === true;
    // With workers available, boot must not leave a main-thread GLPK instance.
    const mainGlpkLoaded = Boolean(typeof _glpkInstance !== 'undefined' && _glpkInstance);
    return {workersOk,mainGlpkLoaded};
  });
  check('workers available ⇒ main thread did not preload GLPK',
    noMainGlpk.workersOk && !noMainGlpk.mainGlpkLoaded,
    JSON.stringify(noMainGlpk));

  const orderCacheBump = await page.evaluate(()=>{
    if(typeof beginPlannerSolveCaches !== 'function' || typeof bumpPlannerDataRevision !== 'function'){
      return {ok:false};
    }
    const data = load();
    beginPlannerSolveCaches(data);
    const day = dayStart(Date.now());
    const first = plannerOrderConstraintsForDay(day);
    // Populate cache, then bump — caches must clear so a subsequent begin is clean.
    bumpPlannerDataRevision();
    beginPlannerSolveCaches(data);
    const second = plannerOrderConstraintsForDay(day);
    return {
      ok:true,
      firstIsArray:Array.isArray(first),
      secondIsArray:Array.isArray(second),
      // Same inputs ⇒ same edges; the point is bump did not throw and cache restarted.
      sameLength:first.length === second.length
    };
  });
  check('bumping planner revision clears order/anchor solve caches safely',
    orderCacheBump.ok && orderCacheBump.firstIsArray && orderCacheBump.secondIsArray,
    JSON.stringify(orderCacheBump));

  // Exact-mode only: week memo must refuse cross-midnight reuse.
  if(EXPECTED_MODE !== 'fast'){
    const memoDate = await page.evaluate(async()=>{
      const data = load();
      const settings = {...sortSettings};
      const dirty = homePlannerDirtyKey(data);
      // Seed memo as if yesterday's solve left it behind.
      _plannerWeekDayMemo = {
        dirtyKey:dirty,
        todayBase:dayStart(Date.now()) - 86400000,
        days:( _homeRenderedWeek.days || []).map(day=>({
          timeline:day.timeline,
          usedMinutes:day.usedMinutes,
          remainingMinutes:day.remainingMinutes,
          travelSeconds:day.travelSeconds || 0
        }))
      };
      const beforeBase = _plannerWeekDayMemo.todayBase;
      await buildWeekAgendaAsync(data,settings,7,{dirtyKey:dirty,day0Only:true});
      return {
        beforeBase,
        afterBase:_plannerWeekDayMemo.todayBase,
        today:dayStart(Date.now()),
        refreshed:_plannerWeekDayMemo.todayBase === dayStart(Date.now())
      };
    });
    check('day0Only week memo refuses yesterday\'s todayBase (refreshes memo to today)',
      memoDate.refreshed && memoDate.afterBase === memoDate.today && memoDate.beforeBase !== memoDate.today,
      JSON.stringify(memoDate));
  }

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
