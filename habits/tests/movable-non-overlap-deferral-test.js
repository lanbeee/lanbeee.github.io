// Movable that fits in a gap NOT overlapping a daily-breakable reservation must
// place TODAY (not defer to tomorrow), while the daily breakable is still
// protected inside its own window.
//
// This is the "Throw trash" regression: a sparse/plan-by/task movable fits in an
// evening gap that lies outside the "Work" breakable's 9:00–19:30 window, yet the
// planner used to defer it to tomorrow because `fastPathDefersMovable` compared
// the movable's full duration against breakable-spare measured only INSIDE the
// reservation window. The fix (`movableFitsOutsideReservations`) lets it place.
//
// Every scenario runs twice — GLPK optimizer and fast scarcity — same invariants.
// Soft-passes the GLPK column if WASM cannot load.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/movable-non-overlap-deferral-test.js
//
// Case matrix:
//   [1]  core repro — plan-by movable fits evening → places TODAY
//   [2]  one-shot task movable fits evening → places TODAY
//   [3]  higher-priority (P1) movable fits evening → places TODAY (priority-independent)
//   [4]  sparse weekly rhythm movable (overdue) fits evening → places TODAY
//   [5]  CONTROL no-evening (windowedSettings) → movable still DEFERS (legit)
//   [6]  two movables both fit evening → both place TODAY (chain in the gap)
//   [7]  loose before-Dinner link still uses the clean evening gap
//   [8]  in-window short gap before linked successor stays available; audit is critical
//   [9]  zero-flex due rhythm is pulled back from a later feasible incumbent
//   [10] early and delay permissions remain directionally independent for
//        tasks and sparse rhythms, without demoting strict P0 work
//
const {
  chromium, BASE, atTime, baseHabit:base,
  openEveningSettings, windowedSettings,
  glpkAvailable, runPlannerPair, minutesOnDay, placedAnywhere
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

// Day is open 9:00–22:00 with a lunch block, so there IS evening time (19:30–22:00)
// that lies OUTSIDE the Work breakable's 9:00–19:30 window — the gap the bug ignored.
// availabilityMinutes is high so the window — not the budget — binds (scenario 7
// lowers today's budget explicitly).
// Windowed day 9:00–18:45 with NO evening — every open minute is inside Work's
// window, so a movable has nowhere to hide. Used by the control scenario.
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil:'networkidle' });

  const glpkOk = await glpkAvailable(page);

  console.log('\n[10] early window and delay allowance are independent');
  {
    const policy = await page.evaluate(()=>{
      const today = dayStart(Date.now());
      const due = {
        name:'Directional task',type:'task',target:null,dueDate:today,
        eventTime:null,earlyWindowDays:7,delayAllowanceDays:0,
        durationMinutes:30,breakable:false
      };
      const allowed = {...due,delayAllowanceDays:2};
      const strictCandidate = {h:due,i:0,pinned:false};
      const allowedCandidate = {h:allowed,i:1,pinned:false};
      return {
        early:habitEarlyWindowDays(due),
        strictDelay:habitDelayAllowanceDays(due),
        strictToday:mustPlaceOccurrenceByDay(strictCandidate,today),
        strictMovable:isMovableWeekCandidate(strictCandidate,today),
        allowedToday:mustPlaceOccurrenceByDay(allowedCandidate,today),
        allowedMovable:isMovableWeekCandidate(allowedCandidate,today),
        allowedLastDay:mustPlaceOccurrenceByDay(allowedCandidate,today + 2*86400000)
      };
    });
    assert(policy.early === 7 && policy.strictDelay === 0,
      `large early window grants no delay (${JSON.stringify(policy)})`);
    assert(policy.strictToday && !policy.strictMovable,
      'zero delay makes the due-today occurrence non-deferrable');
    assert(!policy.allowedToday && policy.allowedMovable && policy.allowedLastDay,
      'explicit delay keeps it movable only until its last allowed day');

    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const strict = base({
      name:'Strict directional task',type:'task',target:null,dueDate:todayBase,
      earlyWindowDays:7,delayAllowanceDays:0,durationMinutes:30,priority:2,
      createdAt:now - 86400000
    });
    const strictResult = await runBoth([work(),strict],openEveningSettings(),now);
    for(const [label,r] of [['glpk',strictResult.glpk],['fast',strictResult.fast]]){
      if(label === 'glpk' && !glpkOk)continue;
      assert(minutesOnDay(r,0,'Strict directional task') === 30,
        `${label}: early-only due task stays today`);
    }

    const mayDelay = base({
      name:'Delay-permitted task',type:'task',target:null,dueDate:todayBase,
      earlyWindowDays:0,delayAllowanceDays:2,durationMinutes:30,priority:2,
      createdAt:now - 86400000
    });
    const delayedResult = await runBoth([work(),mayDelay],windowedSettings(),now);
    for(const [label,r] of [['glpk',delayedResult.glpk],['fast',delayedResult.fast]]){
      if(label === 'glpk' && !glpkOk)continue;
      assert(minutesOnDay(r,0,'Delay-permitted task') === 0
        && (minutesOnDay(r,1,'Delay-permitted task') === 30
          || minutesOnDay(r,2,'Delay-permitted task') === 30),
      `${label}: explicit delay permits a later placement when today cannot spare it`);
    }

    // Sparse rhythms are structurally day-choosing whenever target > 1. This
    // pair proves that structural classification alone cannot grant deferral:
    // with identical cadence, priority and capacity, only delayAllowanceDays
    // decides whether the due P0 occurrence may wait. Work is P1 here so the
    // strict P0 occurrence wins when the day is packed; when delay is explicit,
    // the occurrence waits and Work retains today's capacity.
    const rhythmWork = base({
      name:'Rhythm Work',type:'keepup',target:1,durationMinutes:360,
      breakable:true,minChunkMinutes:60,priority:1,
      allowedTimeStart:540,allowedTimeEnd:1125
    });
    const strictRhythm = base({
      name:'Strict sparse rhythm',type:'keepup',target:3,
      lastLog:todayBase - 3*86400000,logs:[todayBase - 3*86400000],
      earlyWindowDays:7,delayAllowanceDays:0,durationMinutes:30,priority:0,
      createdAt:now - 30*86400000
    });
    const strictRhythmResult = await runBoth(
      [rhythmWork,strictRhythm],windowedSettings(),now
    );
    for(const [label,r] of [['glpk',strictRhythmResult.glpk],['fast',strictRhythmResult.fast]]){
      if(label === 'glpk' && !glpkOk)continue;
      assert(minutesOnDay(r,0,'Strict sparse rhythm') === 30,
        `${label}: zero-delay due P0 sparse rhythm is not deferred`);
    }

    const delayedRhythm = {
      ...strictRhythm,name:'Delay-permitted sparse rhythm',delayAllowanceDays:2
    };
    const delayedRhythmResult = await runBoth(
      [rhythmWork,delayedRhythm],windowedSettings(),now
    );
    for(const [label,r] of [['glpk',delayedRhythmResult.glpk],['fast',delayedRhythmResult.fast]]){
      if(label === 'glpk' && !glpkOk)continue;
      assert(minutesOnDay(r,0,'Delay-permitted sparse rhythm') === 0
        && (minutesOnDay(r,1,'Delay-permitted sparse rhythm') === 30
          || minutesOnDay(r,2,'Delay-permitted sparse rhythm') === 30),
      `${label}: explicit delay alone lets the P0 sparse rhythm wait`);
      assert(minutesOnDay(r,0,'Rhythm Work') >= 285,
        `${label}: permitted deferral does not unnecessarily displace today's P1 habit`);
    }
  }

  // Run a scenario through both paths. `now` freezes the clock partway through the
  // day so TODAY is the binding target and an evening gap still lies ahead.
  async function runBoth(data, settings, now){
    return runPlannerPair(page, data, settings, now);
  }

  // Shared "Work" breakable: 6h daily inside 9:00–19:30. With now=14:00, today's
  // in-window time (14:00–19:30 = 330m) is short of the 360m target, so Work
  // carries a live deficit → the reservation is active — exactly the Throw-trash
  // setup. Full days fit Work comfortably, so a clean alternative day exists
  // (without the fix the movable would defer there).
  function work(){
    return base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
      breakable:true, minChunkMinutes:60, priority:0,
      allowedTimeStart:540, allowedTimeEnd:1170 });
  }

  // ════════════════════════════════════════════════════════════════════════
  // [9] A time-limited feasible solve may assign a strict due rhythm later.
  // If it fits today's finished agenda without moving anything, that later
  // assignment is dominated and must be pulled back to today.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[9] strict due rhythm pulls forward into an untouched gap');
  {
    const repaired = await page.evaluate(() => {
      const today = dayStart(Date.now());
      const now = today + 11 * 3600000;
      const RealDate = Date;
      function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
      FrozenDate.now = ()=>now;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;
      try{
        const settings = {
          ...loadSortSettings(),blockedTimes:[],locations:[],travel:{},
          availabilityMinutes:Array(7).fill(600),availabilityOverrides:{}
        };
        settings.availabilityOverrides[dateKey(today)] = 600;
        settings.availabilityOverrides[dateKey(today + 3*86400000)] = 600;
        const data = normalize([{
          hid:'strict-trash',name:'Throw Trash',type:'reduce',target:3.5,
          flexibilityDays:0,durationMinutes:10,priority:2,
          logs:[today - 4*86400000],lastLog:today - 4*86400000,
          scheduleLinks:[]
        }]);
        const laterBase = today + 3*86400000;
        const makeState = dayBase=>{
          const day = buildDayAgenda([],settings,dayBase,{now,weekMode:true});
          return createDayPlacementState(day,settings,{dayBase,weekday:new Date(dayBase).getDay(),weekMode:true});
        };
        const todayState = makeState(today);
        const laterState = makeState(laterBase);
        const candidate = {
          h:data[0],i:0,pinned:false,priority:2,urgency:100,scarcity:null,
          eligible:new Set([today,laterBase])
        };
        candidate.scarcity = scarcityScore(candidate,[todayState,laterState]);
        const fill = {h:data[0],i:0,priority:2,scarcity:candidate.scarcity};
        const laterFit = tryPlaceOnDay(laterState,fill,{settings,allowNetwork:false});
        if(!laterFit)return {error:'control could not place later'};
        commitPlacement(laterState,fill,laterFit);
        syncDayAgendaItemsFromFills(laterState);
        const moved = pullStrictDueMovablesForward([candidate],[todayState,laterState],settings);
        const has = state=>(state.fills || []).some(entry=>entry.fill && entry.fill.i === 0);
        return {moved,today:has(todayState),later:has(laterState)};
      }finally{
        globalThis.Date = RealDate;
      }
    });
    assert(!repaired.error,`strict-due repair control builds (${repaired.error || 'ok'})`);
    assert(repaired.moved === 1 && repaired.today && !repaired.later,
      `strict due row moves from later assignment into today's untouched gap (${JSON.stringify(repaired)})`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // [7] Loose order link — an overdue 90m Cooking may move later as long as it
  // remains before Dinner. GLPK used to exempt every linked item from clean-
  // gap steering, chose an earlier fit overlapping Work's final hour, and the
  // hours repair consequently deferred Cooking. Only direct links need that
  // exemption; a sometime link should keep both Cooking and Work today.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7] loose before-Dinner link uses clean evening gap today');
  {
    const now = atTime(14);
    const dinner = base({
      hid:'dinner', name:'Dinner', type:'keepup', target:1,
      durationMinutes:15, priority:1,
      allowedTimeStart:1275, allowedTimeEnd:1320
    });
    const cooking = base({
      hid:'cooking', name:'Cooking', type:'keepup', target:7,
      durationMinutes:90, priority:4,
      lastLog:now - 13*86400000,
      allowedTimeStart:840, allowedTimeEnd:1305,
      scheduleLinks:[{
        anchorHid:'dinner', direction:'before',
        adjacency:'sometime', requireSameDay:false
      }]
    });
    const res = await runBoth([work(),cooking,dinner],openEveningSettings(),now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: linked week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Cooking') >= 90,
        `${label}: overdue Cooking stays TODAY (got ${minutesOnDay(r,0,'Cooking')})`);
      assert(minutesOnDay(r,0,'Dinner') >= 15,
        `${label}: Dinner stays TODAY (got ${minutesOnDay(r,0,'Dinner')})`);
      assert(minutesOnDay(r,0,'Work') >= 300,
        `${label}: Work remains protected (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [1] Core repro — plan-by movable fits the evening gap → places TODAY.
  // Without the fix it defers to tomorrow (clean alternative day exists).
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1] core repro — plan-by movable places today in evening gap');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      work(),
      base({ name:'Throw Trash', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Throw Trash') >= 30, `${label}: Throw Trash placed TODAY (got ${minutesOnDay(r,0,'Throw Trash')})`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work still gets its window today — not shorted (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [2] One-shot task movable fits the evening gap → places TODAY.
  // Tasks are movables too; same rule.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2] one-shot task movable places today in evening gap');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      work(),
      base({ name:'Call Plumber', type:'task', durationMinutes:30, priority:2,
        dueDate:todayBase + 5*86400000, flexibilityDays:5, hardDue:false,
        target:null, createdAt:now - 86400000 })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Call Plumber') >= 30, `${label}: Call Plumber placed TODAY (got ${minutesOnDay(r,0,'Call Plumber')})`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work not shorted (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [3] Higher-priority (P1) movable fits the evening gap → places TODAY.
  // When the movable fits a non-reservation gap, priority is irrelevant — it
  // places today without needing to steal a breakable chunk.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3] higher-priority movable places today (priority-independent)');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      work(),
      base({ name:'Important', type:'keepup', target:30, durationMinutes:45, priority:1,
        planByDate:todayBase + 5*86400000 })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Important') >= 45, `${label}: Important placed TODAY (got ${minutesOnDay(r,0,'Important')})`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work not shorted by higher-pri movable (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [4] Sparse weekly rhythm movable (overdue) fits the evening gap → TODAY.
  // Mirrors "Throw trash 2×/7d" that is due today. lastLog is null → due now.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[4] sparse weekly rhythm (overdue) places today in evening gap');
  {
    const now = atTime(14);
    const data = [
      work(),
      base({ name:'Laundry', type:'keepup', target:7, durationMinutes:30, priority:2,
        lastLog:null })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Laundry') >= 30, `${label}: Laundry placed TODAY (got ${minutesOnDay(r,0,'Laundry')})`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work not shorted (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [5] CONTROL — no evening (windowedSettings). Every open minute is inside
  // Work's window, so the movable has no non-reservation gap. It must still
  // DEFER (not be force-placed into Work's window). Proves the fix only frees
  // genuinely non-overlapping gaps.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[5] CONTROL no-evening — movable still defers (legit protection)');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      // Work window 9:00–18:45 = the entire windowed open day.
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Throw Trash', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Throw Trash') === 0, `${label}: no evening → Throw Trash NOT force-placed today (got ${minutesOnDay(r,0,'Throw Trash')})`);
      assert(minutesOnDay(r,0,'Work') >= 285, `${label}: Work keeps its window (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [6] Two movables both fit the evening gap → both place TODAY. The evening
  // (19:30–22:00 = 150m) holds both 30m items with room to spare.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[6] two movables both fit evening → both place today');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      work(),
      base({ name:'Throw Trash', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 5*86400000 }),
      base({ name:'Water Plants', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Throw Trash') >= 30, `${label}: Throw Trash placed TODAY (got ${minutesOnDay(r,0,'Throw Trash')})`);
      assert(minutesOnDay(r,0,'Water Plants') >= 30, `${label}: Water Plants placed TODAY (got ${minutesOnDay(r,0,'Water Plants')})`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work not shorted with two movables (got ${minutesOnDay(r,0,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [8] Exact production semantics without personal data. Work needs 51m with
  // a 45m minimum chunk; Exercise/Shower begin at 17:00, leaving only a 25m
  // pre-chain gap. A 10m sparse movable ordered before Shower belongs in that
  // otherwise-unusable sliver. GLPK used to delete every in-Work-window option
  // merely because an after-19:00 option existed, then the order row rejected
  // that late option. Fast steering had the matching risk. A deliberately bad
  // rendered snapshot also verifies that the audit treats this dominated,
  // due-today deferral as a critical miss rather than "placed elsewhere".
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[8] short pre-successor gap places today; bad snapshot audits critical');
  {
    const now = atTime(16,33);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const homeSettings = openEveningSettings({blockedTimes:[
      {label:'sleep',days:[],start:0,end:420},
      {label:'night',days:[],start:1320,end:1440}
    ]});
    const data = [
      base({
        hid:'long-event',name:'Committed afternoon',type:'task',target:null,
        eventTime:todayBase + 420*60000,durationMinutes:573,priority:0
      }),
      base({
        hid:'work',name:'Work',type:'keepup',target:1,priority:0,
        durationMinutes:360,breakable:true,minChunkMinutes:45,
        allowedTimeStart:510,allowedTimeEnd:1140,
        lastLog:todayBase + 510*60000,
        logs:[{ts:todayBase + 510*60000,minutes:309}]
      }),
      base({
        hid:'exercise',name:'Exercise',type:'keepup',target:1,priority:1,
        durationMinutes:45,allowedTimeStart:1020,allowedTimeEnd:1065,
        lastLog:todayBase - 86400000,logs:[todayBase - 86400000]
      }),
      base({
        hid:'shower',name:'Shower',type:'keepup',target:1,priority:1,
        durationMinutes:5,allowedTimeStart:1065,allowedTimeEnd:1070,
        lastLog:todayBase - 86400000,logs:[todayBase - 86400000],
        scheduleLinks:[{
          anchorHid:'exercise',direction:'after',adjacency:'direct',requireSameDay:true
        }]
      }),
      base({
        hid:'trash',name:'Throw Trash',type:'reduce',target:3.5,priority:2,
        durationMinutes:10,lastLog:todayBase - 4*86400000,
        logs:[todayBase - 4*86400000],
        scheduleLinks:[{
          anchorHid:'shower',direction:'before',adjacency:'sometime',requireSameDay:false
        }]
      })
    ];
    const res = await runBoth(data,homeSettings,now);
    for(const [label,r] of [['glpk',res.glpk],['fast',res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error,`${label}: linked short-gap week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Throw Trash') === 10,
        `${label}: Throw Trash uses today's pre-Shower sliver (got ${minutesOnDay(r,0,'Throw Trash')}; ${JSON.stringify(r.days)})`);
      assert(minutesOnDay(r,0,'Work') === 51,
        `${label}: exact remaining Work deficit is preserved (got ${minutesOnDay(r,0,'Work')})`);
      assert(minutesOnDay(r,0,'Exercise') === 45 && minutesOnDay(r,0,'Shower') === 5,
        `${label}: linked Exercise/Shower chain remains intact`);
    }

    const audit = await page.evaluate(({data,settings,now,todayBase})=>{
      const RealDate = Date;
      function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
      FrozenDate.now = ()=>now;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;
      try{
        const week = buildWeekAgenda(data,{...settings,agendaOptimizer:false},7);
        const trashIndex = data.findIndex(h=>h.hid === 'trash');
        const today = week.days[0];
        const trashRow = (today.timeline || []).find(row=>row.kind === 'fill' && row.i === trashIndex);
        if(!trashRow)return {error:'planner did not produce the control Trash row'};
        const minutes = Math.round((trashRow.end - trashRow.start) / 60000);
        today.timeline = today.timeline.filter(row=>row !== trashRow);
        today.homeDisplayedTimeline = (today.homeDisplayedTimeline || today.timeline)
          .filter(row=>!(row.kind === 'fill' && row.i === trashIndex));
        today.agendaItems = (today.agendaItems || []).filter(item=>item.i !== trashIndex);
        today.usedMinutes = Math.max(0,(today.usedMinutes || 0) - minutes);
        today.remainingMinutes = Math.max(0,(today.totalMinutes || 0) - today.usedMinutes);
        const tomorrow = week.days[1];
        if(!(tomorrow.timeline || []).some(row=>row.kind === 'fill' && row.i === trashIndex)){
          const start = tomorrow.dayBase + 420*60000;
          tomorrow.timeline = [...(tomorrow.timeline || []),{
            ...trashRow,start,end:start + 10*60000
          }];
          tomorrow.homeDisplayedTimeline = tomorrow.timeline;
        }
        week.optimized = true;
        const report = buildDayCapacityScorecard(data,settings,todayBase,now,{
          weekMode:true,weekSnapshot:week
        });
        return {
          criticalMissCount:report.criticalMissCount,
          missedOpportunityCount:report.missedOpportunityCount,
          statuses:report.placementGaps.map(gap=>gap.status),
          explanations:report.placementGaps.map(gap=>gap.explanation),
          text:formatDayCapacityScorecardText(report,'today agenda audit','synthetic bad snapshot')
        };
      }finally{
        globalThis.Date = RealDate;
      }
    },{data,settings:homeSettings,now,todayBase});
    assert(!audit.error,`audit control builds (${audit.error || 'ok'})`);
    assert(audit.criticalMissCount > 0 && audit.missedOpportunityCount > 0
      && audit.statuses.includes('critical-miss'),
    `audit promotes the due elsewhere assignment to a critical miss: ${JSON.stringify(audit)}`);
    assert((audit.explanations || []).some(text=>text.includes('without moving any committed row'))
      && audit.text.includes('CRITICAL MISS'),
    'audit explains why the elsewhere assignment is a dominated placement');
  }

  // ════════════════════════════════════════════════════════════════════════
  // Boot cleanliness
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[clean] page errors');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`) + (glpkOk ? '' : ' (GLPK unavailable — glpk column skipped)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
