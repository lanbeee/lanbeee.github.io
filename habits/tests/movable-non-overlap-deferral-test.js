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
//
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function atTime(hour, minute = 0){
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}
function base(props){
  return Object.assign({
    name:'item', type:'keepup', target:7, flexibilityDays:0, durationMinutes:30,
    allowedTimeStart:null, allowedTimeEnd:null, preferredTimeStart:null, preferredTimeEnd:null,
    allowedTimeStartAnchor:null, allowedTimeEndAnchor:null,
    lastLog:null, logs:[], emoji:'', pinned:false, sample:false, snoozedUntil:null,
    topics:[], allowedWeekdays:[], allowedMonthDays:[], preferredWeekdays:[], preferredMonthDays:[],
    dueDate:null, eventTime:null, hardDue:false, createdAt:Date.now(),
    breakable:false, minChunkMinutes:30, planByDate:null
  }, props);
}

// Day is open 9:00–22:00 with a lunch block, so there IS evening time (19:30–22:00)
// that lies OUTSIDE the Work breakable's 9:00–19:30 window — the gap the bug ignored.
// availabilityMinutes is high so the window — not the budget — binds (scenario 7
// lowers today's budget explicitly).
function openEveningSettings(extra){
  return Object.assign({
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440], availabilityOverrides:{},
    showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
    locations:[], travel:{}, defaultTravelMode:'walking',
    blockedTimes:[
      {label:'sleep',days:[],start:0,end:540},
      {label:'night',days:[],start:1320,end:1440},
      {label:'lunch',days:[],start:780,end:810}
    ]
  }, extra || {});
}

// Windowed day 9:00–18:45 with NO evening — every open minute is inside Work's
// window, so a movable has nowhere to hide. Used by the control scenario.
function windowedSettings(extra){
  return Object.assign({
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440], availabilityOverrides:{},
    showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
    locations:[], travel:{}, defaultTravelMode:'walking',
    blockedTimes:[
      {label:'sleep',days:[],start:0,end:540},
      {label:'evening',days:[],start:1125,end:1440},
      {label:'lunch',days:[],start:720,end:750}
    ]
  }, extra || {});
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil:'networkidle' });

  const glpkOk = !FAST_ONLY && await page.evaluate(async () => {
    if(typeof ensureGlpk !== 'function')return false;
    try { const G = await ensureGlpk(); return !!G && typeof G.solve === 'function'; }
    catch(_){ return false; }
  });

  // Run a scenario through both paths. `now` freezes the clock partway through the
  // day so TODAY is the binding target and an evening gap still lies ahead.
  async function runBoth(data, settings, now){
    return await page.evaluate(async ({ data, settings, now, fastOnly }) => {
      const RealDate = Date;
      function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
      FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
      Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FD;
      const summarize = (week) => (week.days || []).map(day => {
        const fills = (day.timeline || []).filter(r => r.kind === 'fill');
        const byName = {};
        for(const f of fills){
          const m = Math.round((f.end - f.start) / 60000);
          byName[f.h.name] = (byName[f.h.name] || 0) + m;
        }
        return byName;
      });
      let glpk = null, fast = null;
      if(!fastOnly){
        try{
          const w = await buildWeekAgendaAsync(data, Object.assign({}, settings, { agendaOptimizer:true }), 7);
          glpk = { optimized: !!w.optimized, days: summarize(w) };
        }catch(e){ glpk = { error: String(e && e.message || e) }; }
      }
      try{
        const w = buildWeekAgenda(data, Object.assign({}, settings, { agendaOptimizer:false }), 7);
        fast = { days: summarize(w) };
      }catch(e){ fast = { error: String(e && e.message || e) }; }
      globalThis.Date = orig;
      return { glpk, fast };
    }, { data, settings, now, fastOnly:FAST_ONLY });
  }

  function minutesOnDay(res, offset, name){
    const d = (res && res.days && res.days[offset]) || {};
    return d[name] || 0;
  }
  function placedAnywhere(res, name){
    return ((res && res.days) || []).reduce((s,d) => s + (d[name] || 0), 0);
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
  // Boot cleanliness
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[clean] page errors');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`) + (glpkOk ? '' : ' (GLPK unavailable — glpk column skipped)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
