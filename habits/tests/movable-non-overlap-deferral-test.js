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
