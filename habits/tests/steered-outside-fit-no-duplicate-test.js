// A movable steered OUTSIDE a daily-breakable reservation must place exactly
// ONCE. The steering branch in tryPlaceOnDay (and GLPK's injected outside
// options) returns probe fits built by auditFillFitInGap, which stamp a private
// `audit:${i}` placeKey so the placed-set check inside the probe clone cannot
// reject the audit. Committing that key meant `state.placed` never learned the
// occurrence's real key (`fill.i`), so later passes gated on
// `state.placed.has(fill.i)` — chiefly rebalanceScarcePlacements — placed the
// SAME occurrence again: two rows for one 30-minute habit (60 committed
// minutes), reconciled to identical clock times in the published timeline.
//
// The fix re-keys the probe fits in placementFitsOutsideReservations to the
// occurrence's real key, matching the existing convention (rescueDailyGapFits
// re-keys its audit fits before committing).
//
// Every scenario runs twice — GLPK optimizer and fast scarcity — same invariants.
// Soft-passes the GLPK column if WASM cannot load.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/steered-outside-fit-no-duplicate-test.js
//
// Case matrix:
//   [1] core repro — scarce sparse-rhythm movable steered into the evening gap
//       places today exactly once (was: steered 19:30 row + rebalance ASAP row)
//   [2] one-shot task movable steered into the evening gap — exactly once
//   [3] CONTROL — steered movable still places today (the fix must not defer it)
//       and Work keeps its protected window
//
const {
  chromium, BASE, atTime, baseHabit:base,
  openEveningSettings,
  glpkAvailable, runPlannerPair, minutesOnDay
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil:'networkidle' });

  const glpkOk = await glpkAvailable(page);

  try{

  // Shared daily breakable: Work 6h inside 9:00–19:30. At now=14:00 the
  // remaining in-window time (330m) is short of the 360m target, so the
  // reservation is ACTIVE and the movable's ASAP fit (14:00) overlaps it.
  // Evening 19:30–22:00 is the clean outside gap the steering should use.
  function work(){
    return base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
      breakable:true, minChunkMinutes:60, priority:0,
      allowedTimeStart:540, allowedTimeEnd:1170 });
  }

  // A movable whose allowed window (9:00–21:00) makes it BOTH scarce (hard
  // window → rebalanceScarcePlacements scans it) and steerable (ASAP fit at
  // 14:00 overlaps Work's 9:00–19:30 reservation; a 30m fit fits 19:30–21:00).
  function scarceMovable(props){
    return base(Object.assign({ durationMinutes:30, priority:2,
      allowedTimeStart:540, allowedTimeEnd:1260 }, props));
  }

  // Run a scenario through both engines on the shared page.
  async function runBoth(data, settings, now){
    return runPlannerPair(page, data, settings, now);
  }

  function assertSingleOccurrence(label, r, name){
    assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
    const day0 = minutesOnDay(r,0,name);
    assert(day0 === 30,
      `${label}: ${name} places TODAY exactly once (got ${day0}m; 60m = duplicated occurrence)`);
    for(let offset = 0;offset < (r.days || []).length;offset += 1){
      const day = r.days[offset];
      if((day[name] || 0) > 30){
        assert(false, `${label}: ${name} at most one 30m occurrence per day (day ${offset}: ${day[name]}m)`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [1] Core repro — scarce sparse rhythm steered outside Work's window.
  // Pre-fix: committed under the leaked `audit:N` key, then
  // rebalanceScarcePlacements re-placed it at the ASAP slot → 60m today.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1] steered sparse rhythm places today exactly once');
  {
    const now = atTime(14);
    const study = scarceMovable({ name:'Study', type:'keepup', target:2.5,
      lastLog:now - 10*86400000 });
    const res = await runBoth([work(),study],openEveningSettings(),now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assertSingleOccurrence(label, r, 'Study');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [2] One-shot task movable — tasks take the same steered path through
  // tryPlaceOnDay; the outside option GLPK injects for them carries the same
  // probe key.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2] steered one-shot task places today exactly once');
  {
    const now = atTime(14);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const errand = scarceMovable({ name:'Errand', type:'task', target:null,
      dueDate:todayBase + 5*86400000, flexibilityDays:5, hardDue:false,
      createdAt:now - 86400000 });
    const res = await runBoth([work(),errand],openEveningSettings(),now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assertSingleOccurrence(label, r, 'Errand');
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [3] CONTROL — the fix must not change steering outcomes: the movable still
  // places TODAY (in the clean evening gap) and Work still reaches its target.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3] control — steered movable still today, Work protected');
  {
    const now = atTime(14);
    const study = scarceMovable({ name:'Study', type:'keepup', target:2.5,
      lastLog:now - 10*86400000 });
    const res = await runBoth([work(),study],openEveningSettings(),now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(minutesOnDay(r,0,'Study') >= 30, `${label}: Study still places TODAY (got ${minutesOnDay(r,0,'Study')}m)`);
      assert(minutesOnDay(r,0,'Work') >= 300, `${label}: Work still protected (got ${minutesOnDay(r,0,'Work')}m)`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed${pageErrors.length ? `, ${pageErrors.length} page errors` : ''}`);
  if(pageErrors.length)console.error(pageErrors);
  if(fail)process.exitCode = 1;
  }finally{
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
