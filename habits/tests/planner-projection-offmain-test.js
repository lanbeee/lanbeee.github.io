/**
 * Focused regression coverage for the off-main missed-item projection (the
 * async greedy week build that keeps the ~1s synchronous rebuild out of the
 * opening path).
 *
 *   1. Parity — buildWeekAgendaOffMain({greedy:true,nowTs}) on the real
 *      planner worker matches the synchronous buildWeekAgenda projection at
 *      the same frozen clock, including a multi-occurrence (scheduleOptions)
 *      habit and a window-closed missed habit; the recorded landing map
 *      equals the synchronous map with the same mounted-week merge.
 *   2. Staleness — data changing while a solve is in flight must not record
 *      the stale result; the projection re-solves against the new data.
 *   3. Midnight — the expectation-map memo is invalidated across midnight
 *      even when data and settings are unchanged, while the recorded
 *      snapshot still satisfies the pill without a rebuild.
 *   4. Failure — a persistently failing worker cannot leave the missed pill
 *      hidden or retry forever: deferral retries are bounded at 3, then the
 *      historical synchronous build returns (the freeze is the fallback) and
 *      the pill repaints.
 *
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/planner-projection-offmain-test.js
 */
const { chromium } = require('playwright');
const { BASE, baseHabit, plannerSettings } = require('./helpers/planner-test-helpers');

function assert(cond,msg){ if(!cond)throw new Error(msg); }

const DAY = 86400000;
// Wed Oct 7 2026 10:15 — the 6–9am walk window and the 9–10am morning
// occurrence are already closed, so both project as missed expectations.
const now = new Date(2026,9,7,10,15).getTime();
const eve = new Date(2026,9,6,23,55).getTime();
const midnight = new Date(2026,9,7,0,5).getTime();

const habitRepeat = baseHabit({hid:'repeat-1', name:'Practice', type:'keepup',
  target:1/3, priority:1, durationMinutes:15, createdAt:now - 30*DAY,
  scheduleOptions:[
    {id:'morning', weekdays:[], start:540, end:600, locationId:null, sameDayMode:'alternative'},
    {id:'afternoon', weekdays:[], start:840, end:900, locationId:null, sameDayMode:'separate'},
    {id:'evening', weekdays:[], start:1080, end:1140, locationId:null, sameDayMode:'separate'}
  ]});
const habitWalk = baseHabit({hid:'walk-1', name:'Walk', type:'keepup', target:1,
  priority:1, durationMinutes:30, allowedTimeStart:360, allowedTimeEnd:540,
  lastLog:now - 2*DAY, logs:[now - 2*DAY], createdAt:now - 30*DAY});
const habitRead = baseHabit({hid:'read-1', name:'Read', type:'keepup', target:1,
  priority:1, durationMinutes:30,
  lastLog:now - 2*DAY, logs:[now - 2*DAY], createdAt:now - 30*DAY});

const settings = plannerSettings(
  [{label:'sleep', days:[], start:0, end:420}],
  {showWeekOnHome:true, agendaOptimizer:false}
);

async function newPage(browser, opts = {}){
  const page = await browser.newPage({viewport:{width:390, height:844}, isMobile:true, hasTouch:true});
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.__errors = errors;
  return page;
}

// Frozen page clock, mutable via window.testClock.
async function freezeClock(page, clockTs, seed){
  await page.addInitScript(({clockTs, seed}) => {
    const RealDate = Date;
    window.testClock = clockTs;
    window.Date = class extends RealDate {
      constructor(...args){ super(...(args.length ? args : [window.testClock])); }
      static now(){ return window.testClock; }
    };
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
      }
    }catch(_){}
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
    if(seed)dataSeed(seed);
    function dataSeed({data, appSettings}){
      localStorage.setItem('tings_v2', JSON.stringify(data));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(appSettings));
    }
  }, {clockTs, seed});
}

// Planner-worker stub whose responses wait for an explicit release, in post
// order, so a solve can be held open while the page's data changes. Every
// response is built from its own message.data exactly like the real worker.
async function installDeferredWorkerStub(page){
  await page.addInitScript(() => {
    if(typeof globalThis.Worker !== 'function' || globalThis.__tingsPlannerStubInstalled)return;
    globalThis.__tingsPlannerStubInstalled = true;
    const RealWorker = globalThis.Worker;
    globalThis.Worker = class extends RealWorker {
      constructor(url, options){
        if(String(url).includes('agenda-planner-worker')){
          const listeners = {message:[], error:[]};
          const queue = [];
          const fire = (type,data)=>{ for(const cb of [...(listeners[type] || [])]){ try{ cb({data,type}); }catch(_){} } };
          globalThis.__projectionHarness = {
            posts:0,
            pending:() => queue.length,
            release(){
              const message = queue.shift();
              if(!message)return 0;
              setTimeout(() => {
                let week = null, error = null;
                try{
                  if(typeof buildWeekAgenda !== 'function')throw new Error('buildWeekAgenda unavailable');
                  const stubSettings = {...(message.settings || {}), agendaOptimizer:false};
                  week = message.greedy
                    ? buildWeekAgenda(message.data, stubSettings, message.numDays || 7, {fullToday:true,fastGraph:false,skipDropAnnotation:true})
                    : buildWeekAgenda(message.data, stubSettings, message.numDays || 7, {});
                }catch(err){ error = String(err && err.message ? err.message : err); }
                fire('message', error ? {id:message.id, error} : {id:message.id, week});
              }, 0);
              return queue.length;
            }
          };
          const fake = {
            addEventListener(type,cb){ if(listeners[type])listeners[type].push(cb); },
            removeEventListener(type,cb){ if(listeners[type])listeners[type] = listeners[type].filter(fn => fn !== cb); },
            terminate(){},
            postMessage(message){
              if(!message || typeof message !== 'object')return;
              if(message.warm){ setTimeout(() => fire('message', {id:message.id, ready:true}), 0); return; }
              globalThis.__projectionHarness.posts += 1;
              queue.push(message);
            }
          };
          return fake;
        }
        super(url, options);
      }
    };
  });
}

// Planner-worker stub that fails every real request immediately.
async function installFailingWorkerStub(page){
  await page.addInitScript(() => {
    if(typeof globalThis.Worker !== 'function' || globalThis.__tingsPlannerStubInstalled)return;
    globalThis.__tingsPlannerStubInstalled = true;
    globalThis.__plannerErrors = 0;
    globalThis.__plannerGreedyErrors = 0;
    const RealWorker = globalThis.Worker;
    globalThis.Worker = class extends RealWorker {
      constructor(url, options){
        if(String(url).includes('agenda-planner-worker')){
          const listeners = {message:[], error:[]};
          const fire = (type,data)=>{ for(const cb of [...(listeners[type] || [])]){ try{ cb({data,type}); }catch(_){} } };
          const fake = {
            addEventListener(type,cb){ if(listeners[type])listeners[type].push(cb); },
            removeEventListener(type,cb){ if(listeners[type])listeners[type] = listeners[type].filter(fn => fn !== cb); },
            terminate(){},
            postMessage(message){
              if(!message || typeof message !== 'object')return;
              if(message.warm){ setTimeout(() => fire('message', {id:message.id, ready:true}), 0); return; }
              globalThis.__plannerErrors += 1;
              if(message.greedy)globalThis.__plannerGreedyErrors += 1;
              setTimeout(() => fire('message', {id:message.id, error:'planner worker exploded'}), 0);
            }
          };
          return fake;
        }
        super(url, options);
      }
    };
  });
}

(async () => {
  const browser = await chromium.launch({headless:true});

  // ---------------------------------------------------------------
  // 1. Worker output matches the synchronous projection at the same
  //    frozen clock (real planner worker, multi-occurrence fixture).
  // ---------------------------------------------------------------
  {
    const page = await newPage(browser);
    await freezeClock(page, now);
    await page.goto(BASE, {waitUntil:'load'});
    await page.waitForTimeout(700); // boot settles (renders + chunk-plan writes)
    const r = await page.evaluate(async ({habitRepeat, habitWalk, settings, now}) => {
      window.testClock = now;
      localStorage.setItem('tings_v2', JSON.stringify(normalize([habitRepeat, habitWalk])));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
      localStorage.removeItem(TODAY_SUGGESTED_KEY);
      if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
      const data = normalize([habitRepeat, habitWalk]);
      const fp = missedPlannerFingerprint(data, settings);
      // Synchronous reference from a cold memo — a real main-thread build.
      _expectationMapMemo = null;
      const syncMap = computePlannerExpectationMap(data, settings, 7, true);
      const syncWeek = buildWeekAgenda(data, settings, 7, {fullToday:true,fastGraph:false,skipDropAnnotation:true});
      const syncRaw = projectionMapFromWeek(data, syncWeek);
      // Worker build with the clock pinned to the same frozen instant.
      let workerErr = null, workerRaw = null, defaultClockRaw = null;
      try{
        const workerWeek = await buildWeekAgendaOffMain(data, settings, 7, 'fast', {greedy:true, nowTs:now});
        workerRaw = projectionMapFromWeek(data, workerWeek);
        const defaultClockWeek = await buildWeekAgendaOffMain(data, settings, 7, 'fast', {greedy:true});
        defaultClockRaw = projectionMapFromWeek(data, defaultClockWeek);
      }catch(err){ workerErr = String(err && err.message || err); }
      let diffDay = null;
      for(const key of Object.keys(syncRaw)){
        if(JSON.stringify(syncRaw[key]) !== JSON.stringify((workerRaw || {})[key])){ diffDay = key; break; }
      }
      // Landing parity: the async map must equal the sync map plus the exact
      // mounted-week merge the synchronous path applies.
      _expectationMapMemo = null;
      const landed = await ensurePlannerProjectionAsync(data, settings, fp, []);
      const rendered = renderedPlannerExpectationMap(data, now, true);
      const expected = {...syncMap};
      const today = dateKey(now);
      for(const [day,entry] of Object.entries(rendered)){
        if(day === today && expected[day]){
          const prior = expected[day];
          expected[day] = {hids:[...new Set([...prior.hids,...entry.hids])],
            renderedHids:entry.renderedHids,
            occurrences:normalizeSuggestedOccurrences([...prior.occurrences,...entry.occurrences])};
        }else{
          expected[day] = entry;
        }
      }
      const todayRaw = syncRaw[today] || {};
      const occKeys = [...new Set((todayRaw.occurrences || []).map(row => row.occurrenceKey))];
      const snap = JSON.parse(localStorage.getItem(TODAY_SUGGESTED_KEY) || 'null');
      return {
        workerErr, diffDay,
        syncDayCount:Object.keys(syncRaw).length,
        workerDayCount:workerRaw ? Object.keys(workerRaw).length : 0,
        rawParity:JSON.stringify(syncRaw) === JSON.stringify(workerRaw),
        defaultClockParity:JSON.stringify(syncRaw) === JSON.stringify(defaultClockRaw),
        occKeys,
        walkExpectedToday:(todayRaw.hids || []).includes('walk-1'),
        landedParity:JSON.stringify(landed) === JSON.stringify(expected),
        landedIsNull:landed === null,
        recordedToday:snap && snap.expectations && snap.expectations[today] ? snap.expectations[today].hids : null,
        recordedFp:snap && snap.expectations && snap.expectations[today] ? snap.expectations[today].fingerprint : null,
        fp
      };
    }, {habitRepeat, habitWalk, settings, now});
    assert(!r.workerErr, `worker build failed: ${r.workerErr}`);
    assert(r.syncDayCount === 7 && r.workerDayCount === 7,
      `both builds cover 7 days (sync ${r.syncDayCount}, worker ${r.workerDayCount})`);
    assert(r.rawParity, `worker projection diverges from the synchronous projection on day ${r.diffDay}`);
    assert(r.defaultClockParity, 'worker requests inherit the page clock when no timestamp override is supplied');
    assert(r.occKeys.length >= 2,
      `multi-occurrence habit projects multiple keyed occurrences today (got ${r.occKeys.length}: ${r.occKeys.join(', ')})`);
    assert(r.walkExpectedToday, 'window-closed habit still projects as expected on today (fullToday)');
    assert(r.landedParity && !r.landedIsNull, 'async landing map equals the merged synchronous map');
    assert((r.recordedToday || []).includes('repeat-1') && (r.recordedToday || []).includes('walk-1'),
      `landing records today's expectations (got ${JSON.stringify(r.recordedToday)})`);
    assert(r.recordedFp === r.fp, 'landing records the projection fingerprint');
    assert(page.__errors.length === 0, `parity page errors: ${page.__errors.join(' | ')}`);
    await page.close();
    console.log('  ok: worker greedy projection matches the synchronous projection at the same frozen clock');
    console.log('  ok: multi-occurrence occurrences and window-closed misses project identically');
    console.log('  ok: async landing records the merged map and fingerprint');
  }

  // ---------------------------------------------------------------
  // 2. Data changing mid-solve: the stale result is discarded, the
  //    projection re-solves against the new data (bounded — 2 posts).
  // ---------------------------------------------------------------
  {
    const page = await newPage(browser);
    await freezeClock(page, now);
    await installDeferredWorkerStub(page);
    await page.goto(BASE, {waitUntil:'load'});
    await page.waitForTimeout(500);
    const r = await page.evaluate(async ({habitRepeat, habitWalk, settings, now}) => {
      window.testClock = now;
      const tick = ms => new Promise(res => setTimeout(res, ms));
      const harness = globalThis.__projectionHarness;
      // Drain whatever boot kicked, then start the scenario from a clean slate.
      for(let i = 0;i < 6 && harness.pending() > 0;i += 1){
        while(harness.pending() > 0)harness.release();
        await tick(30);
      }
      _expectationMapMemo = null; _projectionAsync = null;
      _projectionChainDepth = 0; _projectionWanted = false;
      localStorage.removeItem(TODAY_SUGGESTED_KEY);
      const data1 = normalize([habitRepeat, habitWalk]);
      const data2 = normalize([habitRepeat]);          // walk removed mid-solve
      localStorage.setItem('tings_v2', JSON.stringify(data1));
      if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
      const fp1 = missedPlannerFingerprint(data1, settings);
      const postsBefore = harness.posts;
      const p1 = ensurePlannerProjectionAsync(data1, settings, fp1, []);
      localStorage.setItem('tings_v2', JSON.stringify(data2));   // edit lands mid-solve
      const pendingAfterKick = harness.pending();
      harness.release();                               // the stale result arrives
      const staleOutcome = await p1;
      const pendingAfterChain = harness.pending();
      harness.release();                               // the re-solve for data2 arrives
      await tick(40);
      const fresh = peekPlannerExpectationMap(load(), settings, 7, true);
      const today = todayIso();
      const todayHids = fresh && fresh[today] ? fresh[today].hids : null;
      const snap = JSON.parse(localStorage.getItem(TODAY_SUGGESTED_KEY) || 'null');
      return {
        pendingAfterKick, staleOutcome, pendingAfterChain,
        memoWarm:Boolean(fresh),
        memoHasWalk:Boolean(todayHids && todayHids.includes('walk-1')),
        memoHasRepeat:Boolean(todayHids && todayHids.includes('repeat-1')),
        recordedToday:snap && snap.expectations && snap.expectations[today] ? snap.expectations[today].hids : null,
        posts:harness.posts - postsBefore,
        fingerprintMoved:missedPlannerFingerprint(load(), settings) !== fp1
      };
    }, {habitRepeat, habitWalk, settings, now});
    assert(r.fingerprintMoved, 'fixture sanity: the mid-solve edit changes the fingerprint');
    assert(r.pendingAfterKick === 1, `one solve in flight after the kick (got ${r.pendingAfterKick})`);
    assert(r.staleOutcome === null, `stale result is discarded, not recorded (got ${JSON.stringify(r.staleOutcome)})`);
    assert(r.pendingAfterChain === 1, `exactly one re-solve follows the stale landing (got ${r.pendingAfterChain})`);
    assert(r.posts === 2, `staleness costs exactly two worker posts (got ${r.posts})`);
    assert(r.memoWarm && r.memoHasRepeat && !r.memoHasWalk,
      `memo converges on the new data (repeat ${r.memoHasRepeat}, stale walk ${r.memoHasWalk})`);
    assert(!(r.recordedToday || []).includes('walk-1') && (r.recordedToday || []).includes('repeat-1'),
      `recorded snapshot reflects the new data only (got ${JSON.stringify(r.recordedToday)})`);
    assert(page.__errors.length === 0, `staleness page errors: ${page.__errors.join(' | ')}`);
    await page.close();
    console.log('  ok: a mid-solve data change discards the stale projection and re-solves once');
  }

  // ---------------------------------------------------------------
  // 3. Crossing midnight invalidates the memo even with unchanged
  //    data + settings; the recorded snapshot still feeds the pill
  //    without a rebuild until an explicit projection is requested.
  // ---------------------------------------------------------------
  {
    const page = await newPage(browser);
    await freezeClock(page, eve);
    await page.goto(BASE, {waitUntil:'load'});
    await page.waitForTimeout(700);
    const s1 = await page.evaluate(({habitRepeat, habitWalk, settings, eve}) => {
      window.testClock = eve;
      _expectationMapMemo = null; _projectionAsync = null;
      _projectionChainDepth = 0; _projectionWanted = false;
      localStorage.setItem('tings_v2', JSON.stringify(normalize([habitRepeat, habitWalk])));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
      localStorage.removeItem(TODAY_SUGGESTED_KEY);
      if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
      const data = normalize([habitRepeat, habitWalk]);
      let builds = 0;
      const orig = buildWeekAgenda;
      buildWeekAgenda = (...a) => { builds += 1; return orig(...a); };
      window.__buildCount = () => builds;
      collectDroppedItems(data, settings, [], eve);            // sync data-API path
      return {
        warmBeforeMidnight:Boolean(peekPlannerExpectationMap(data, settings, 7, true)),
        buildsBefore:window.__buildCount()
      };
    }, {habitRepeat, habitWalk, settings, eve});
    assert(s1.warmBeforeMidnight, 'sync projection warms the memo before midnight');
    assert(s1.buildsBefore === 1, `exactly one build before midnight (got ${s1.buildsBefore})`);
    const s2 = await page.evaluate(({habitRepeat, habitWalk, settings, midnight}) => {
      window.testClock = midnight;                             // same data + settings
      const data = normalize([habitRepeat, habitWalk]);
      const stale = peekPlannerExpectationMap(data, settings, 7, true);
      const missed = collectDroppedItems(data, settings, [], midnight);
      const buildsNoRebuild = window.__buildCount();
      const fresh = computePlannerExpectationMap(data, settings, 7, true);
      return {
        staleMemoSurvived:Boolean(stale),
        missedIsArray:Array.isArray(missed),
        buildsNoRebuild,
        buildsAfterExplicit:window.__buildCount(),
        freshHasNewToday:Boolean(fresh[todayIso()]),
        memoWarmAgain:Boolean(peekPlannerExpectationMap(data, settings, 7, true))
      };
    }, {habitRepeat, habitWalk, settings, midnight});
    assert(s2.staleMemoSurvived === false,
      'expectation-map memo must be invalidated across midnight with unchanged data and settings');
    assert(s2.buildsNoRebuild === 1,
      `recorded expectations satisfy the pill after midnight without a rebuild (builds ${s2.buildsNoRebuild})`);
    assert(s2.missedIsArray, 'pill computation still works from the recorded snapshot after midnight');
    assert(s2.buildsAfterExplicit === 2, `an explicit projection request after midnight rebuilds (builds ${s2.buildsAfterExplicit})`);
    assert(s2.freshHasNewToday, 'rebuilt map keys the new day');
    assert(s2.memoWarmAgain, 'memo is warm again after the midnight rebuild');
    assert(page.__errors.length === 0, `midnight page errors: ${page.__errors.join(' | ')}`);
    await page.close();
    console.log('  ok: midnight invalidates the memo; the recorded snapshot avoids a rebuild');
  }

  // ---------------------------------------------------------------
  // 4. A persistently failing worker: the pill is not left hidden,
  //    retries are bounded, and recovery is the historical sync build.
  // ---------------------------------------------------------------
  {
    const page = await newPage(browser);
    await freezeClock(page, now, {data:[habitRead, habitWalk], appSettings:settings});
    await installFailingWorkerStub(page);
    await page.goto(BASE, {waitUntil:'load'});
    await page.waitForTimeout(600);
    const boot = await page.evaluate(() => ({
      greedyErrors:window.__plannerGreedyErrors,
      pill:Boolean(document.querySelector('.dropped-pill'))
    }));
    assert(boot.greedyErrors === 0, `no projection is posted from the deferred first paint (got ${boot.greedyErrors})`);
    await page.evaluate(() => {
      let syncBuilds = 0;
      const orig = buildWeekAgenda;
      buildWeekAgenda = (...a) => { syncBuilds += 1; return orig(...a); };
      window.__syncBuilds = () => syncBuilds;
      // The full home render that follows a week plan landing (the app's own
      // path once any week is available). This is the render that carries
      // todayHids and therefore the missed pill.
      render({__optimizedWeek:buildWeekAgenda(load(), sortSettings, 7)});
    });
    // The render defers, the stub fails it; each failure repaint re-kicks
    // (bounded) and the third failure repaints through the sync branch.
    await page.waitForSelector('.dropped-pill', {timeout:15000});
    const state = await page.evaluate(() => ({
      pill:(document.querySelector('.dropped-pill')?.textContent || '').replace(/\s+/g,' ').trim(),
      greedyErrors:window.__plannerGreedyErrors,
      failures:_projectionDeferFailures,
      pending:plannerProjectionPending(),
      wanted:_projectionWanted
    }));
    assert(state.pill === '1 missed', `missed pill recovers despite the dead worker (got "${state.pill}")`);
    assert(state.greedyErrors === 3, `deferral retries are bounded at 3 worker attempts (got ${state.greedyErrors})`);
    assert(state.failures === 3, `deferral failure counter exhausted (got ${state.failures})`);
    assert(!state.pending && !state.wanted, 'nothing is left pending after recovery');

    // With retries exhausted, a stale render must recover synchronously.
    const recovered = await page.evaluate(() => {
      const data = load();
      data.find(h => h.hid === 'walk-1').durationMinutes = 35;   // fingerprint moves
      localStorage.setItem('tings_v2', JSON.stringify(data));
      render({__optimizedWeek:buildWeekAgenda(load(), sortSettings, 7)});
      return {
        pill:(document.querySelector('.dropped-pill')?.textContent || '').replace(/\s+/g,' ').trim(),
        greedyErrors:window.__plannerGreedyErrors,
        syncBuilds:window.__syncBuilds(),
        pending:plannerProjectionPending()
      };
    });
    assert(recovered.syncBuilds >= 1, 'exhausted retries recover via a synchronous projection build');
    assert(recovered.greedyErrors === state.greedyErrors, `no further worker attempts once retries are exhausted (got ${recovered.greedyErrors})`);
    assert(recovered.pill === '1 missed', `pill repaints after the synchronous recovery (got "${recovered.pill}")`);
    assert(!recovered.pending, 'nothing pending after the sync recovery');

    await page.waitForTimeout(1200);
    const later = await page.evaluate(() => ({
      greedyErrors:window.__plannerGreedyErrors,
      pill:(document.querySelector('.dropped-pill')?.textContent || '').replace(/\s+/g,' ').trim()
    }));
    assert(later.greedyErrors === state.greedyErrors, `no endless retry cycle (greedy errors grew to ${later.greedyErrors})`);
    assert(later.pill === '1 missed', `pill stays painted (got "${later.pill}")`);
    assert(page.__errors.length === 0, `failure page errors: ${page.__errors.join(' | ')}`);
    await page.close();
    console.log('  ok: worker failure repaints the pill via bounded retries, then the sync build');
    console.log('  ok: failure recovery brings back the synchronous freeze (by design, 3-strike fallback)');
  }

  await browser.close();
  console.log('\nplanner-projection-offmain-test: PASS');
})().catch(err => {
  console.error('\nplanner-projection-offmain-test: FAIL —', err.message);
  process.exit(1);
});
