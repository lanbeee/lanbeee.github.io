// Plan-by / movable deferral vs daily recurring breakables.
//
// Rules under test (lex, week-holistic):
//   1. Hard constraints always win.
//   2. Maximize placed hours — daily breakables are use-it-or-lose-it.
//   3. Can-wait movable (clean alternative day) NEVER steals a daily breakable
//      chunk — priority irrelevant (higher/equal/lower all defer).
//   4. Packed week (no clean alternative): ONLY strictly higher priority may
//      take a breakable chunk; equal/lower stay unplaced (or spare-only).
//   5. ASAP when the item fits in spare without breaching the breakable.
//   6. Protection is by shape (breakable + target≤1), not by the name "Work".
//   7. One-shot tasks are movables too (same can-wait / packed-priority rules).
//   8. Must-place narrow dailies (prayers) survive inside the breakable window.
//
// Every scenario runs twice — GLPK optimizer and fast scarcity — same
// invariants. Soft-passes the GLPK column if WASM cannot load.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/plan-by-deferral-test.js
//
// Case matrix:
//   [1]  busy day, can-wait errands spread, Work full
//   [2]  errands fit in spare → ASAP, no over-defer
//   [3]  no-alt that fits in spare → places, Work full
//   [4]  several can-wait movables, at most one on busy day
//   [5]  narrow daily prayer survives + Work full
//   [6]  prayer footprint shrinks spare correctly
//   [7]  packed + higher pri → may take Work chunk
//   [7b] can-wait + higher pri → still defers
//   [7c] packed + lower pri → must not steal Work
//   [7d] packed + equal pri → must not steal Work
//   [7e] can-wait + equal pri → still defers
//   [8]  max doability + front-load
//   [9]  fragmentation / hours repair
//   [10] daily breakable named Study (not Work) protected
//   [11] one-shot task can-wait defers for Work
//   [12] packed lower-pri that fits in spare still places (spare-only OK)
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

// Day is carved to the Work window 9:00 (540) .. 18:45 (1125) via sleep/evening
// blocks, with a daily lunch block, so every candidate must compete inside that
// window. availabilityMinutes is set high so the window — not the budget — is
// the binding constraint.
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

  // Confirm GLPK availability up front; soft-pass the GLPK column if missing.
  const glpkOk = !FAST_ONLY && await page.evaluate(async () => {
    if(typeof ensureGlpk !== 'function')return false;
    try { const G = await ensureGlpk(); return !!G && typeof G.solve === 'function'; }
    catch(_){ return false; }
  });

  // Run a scenario through both paths. `now` freezes the clock so "today" is
  // closed (19:00, past the 18:45 window) and errands can't escape forward.
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
  function errandCountOnDay(res, offset, names){
    const d = (res && res.days && res.days[offset]) || {};
    return names.reduce((n,nm) => n + (d[nm] > 0 ? 1 : 0), 0);
  }
  function placedAnywhere(res, name){
    return ((res && res.days) || []).reduce((s,d) => s + (d[name] || 0), 0);
  }
  function weekTotal(res, name){
    return ((res && res.days) || []).reduce((s,d) => s + (d[name] || 0), 0);
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 1 — core deprioritization (the user's Wednesday).
  // Tomorrow has a scheduled Clinic; two plan-by errands together exceed the
  // Work-window slack. Work must hit 6h, at most one errand lands tomorrow,
  // both errands still place within their plan-by windows later in the week.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1] core deprioritization — Work protected, errands spread');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:60, priority:1,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Oil Change', type:'keepup', target:30, durationMinutes:120, priority:2,
        planByDate:todayBase + 4*86400000 }),
      base({ name:'Indian Grocery', type:'keepup', target:30, durationMinutes:60, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const errands = ['Oil Change','Indian Grocery'];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h on busy tomorrow (got ${minutesOnDay(r,1,'Work')})`);
      assert(errandCountOnDay(r,1,errands) <= 1, `${label}: at most one errand tomorrow (got ${errandCountOnDay(r,1,errands)})`);
      for(const nm of errands){
        assert(placedAnywhere(r,nm) > 0, `${label}: ${nm} placed somewhere in the week`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 2 — do-as-early-as-possible (reservation must not over-defer).
  // Same busy tomorrow, but the two errands together FIT inside the slack.
  // Both should land on tomorrow alongside a full Work block — the reservation
  // only kicks in when there is a genuine conflict.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2] no over-defer — errands that fit still place ASAP');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:60, priority:1,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Errand A', type:'keepup', target:30, durationMinutes:60, priority:2,
        planByDate:todayBase + 4*86400000 }),
      base({ name:'Errand B', type:'keepup', target:30, durationMinutes:60, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const errands = ['Errand A','Errand B'];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work still hits 6h (got ${minutesOnDay(r,1,'Work')})`);
      assert(errandCountOnDay(r,1,errands) === 2, `${label}: both errands place ASAP tomorrow (got ${errandCountOnDay(r,1,errands)})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 3 — no alternative day (must not drop the item).
  // One plan-by errand whose only viable day is tomorrow (plan-by = tomorrow,
  // today's window is closed). It fits the slack, so it must place tomorrow —
  // the reservation must not wrongly exclude a no-alternative movable.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3] no alternative day — plan-by-tomorrow item still places');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Urgent', type:'keepup', target:30, durationMinutes:120, priority:2,
        planByDate:todayBase + 1*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Urgent') >= 120, `${label}: no-alternative Urgent places tomorrow (got ${minutesOnDay(r,1,'Urgent')})`);
      assert(minutesOnDay(r,1,'Work') >= 359, `${label}: Work still reaches target with the urgent item (got ${minutesOnDay(r,1,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 4 — several movables defer around one daily breakable.
  // Three plan-by errands (90 min each) compete with Work on a busy tomorrow
  // whose slack fits only one. Work must still hit 6h, at most one errand lands
  // tomorrow, and all three errands place somewhere across the quieter week.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[4] several movables — Work protected, errands spread');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:60, priority:1,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Errand A', type:'keepup', target:30, durationMinutes:90, priority:2,
        planByDate:todayBase + 5*86400000 }),
      base({ name:'Errand B', type:'keepup', target:30, durationMinutes:90, priority:2,
        planByDate:todayBase + 5*86400000 }),
      base({ name:'Errand C', type:'keepup', target:30, durationMinutes:90, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const errands = ['Errand A','Errand B','Errand C'];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h (got ${minutesOnDay(r,1,'Work')})`);
      assert(errandCountOnDay(r,1,errands) <= 1, `${label}: at most one errand tomorrow (got ${errandCountOnDay(r,1,errands)})`);
      for(const nm of errands){
        assert(placedAnywhere(r,nm) > 0, `${label}: ${nm} placed somewhere in the week`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 5 — scarce narrow non-breakable still survives the breakable.
  // Zuhr is a 10-min habit in a tight 13:48–13:58 window inside Work's broad
  // window. The reservation protects Work from errands, but must NOT let Work
  // (or the errand) erase the narrow daily prayer. Verifies the must-place
  // footprint subtraction and the existing narrow-window invariant together.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[5] scarce narrow habit survives breakable + errand');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Zuhr', type:'keepup', target:1, durationMinutes:10, priority:5,
        allowedTimeStart:828, allowedTimeEnd:838 }),
      base({ name:'Errand', type:'keepup', target:30, durationMinutes:60, priority:2,
        planByDate:todayBase + 4*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Zuhr') >= 10, `${label}: narrow Zuhr placed (got ${minutesOnDay(r,1,'Zuhr')})`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work still hits 6h (got ${minutesOnDay(r,1,'Work')})`);
      assert(placedAnywhere(r,'Errand') > 0, `${label}: Errand placed somewhere in the week`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 6 — realistic footprint: daily prayers subtracted from slack.
  // Three short daily prayers live inside the Work window. Their combined
  // footprint reduces the errand slack, so a single 120-min errand plus a
  // 120-min errand over-subscribe tomorrow and must defer one — while Work and
  // every prayer still place. Guards the must-place virtual-placement branch.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[6] realistic footprint — prayers + Work + errands');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Morning', type:'keepup', target:1, durationMinutes:10, priority:5,
        allowedTimeStart:560, allowedTimeEnd:570 }),
      base({ name:'Noon', type:'keepup', target:1, durationMinutes:10, priority:5,
        allowedTimeStart:830, allowedTimeEnd:840 }),
      base({ name:'Eve', type:'keepup', target:1, durationMinutes:10, priority:5,
        allowedTimeStart:1040, allowedTimeEnd:1050 }),
      base({ name:'Oil Change', type:'keepup', target:30, durationMinutes:120, priority:2,
        planByDate:todayBase + 4*86400000 }),
      base({ name:'Indian Grocery', type:'keepup', target:30, durationMinutes:120, priority:2,
        planByDate:todayBase + 5*86400000 })
    ];
    const errands = ['Oil Change','Indian Grocery'];
    const res = await runBoth(data, windowedSettings(), now);
    // Free = 585 - lunch 30 - prayers 30 = 525. Work 360 → slack 165.
    // Two 120-min errands (240) > 165 → at most one tomorrow.
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Morning') + minutesOnDay(r,1,'Noon') + minutesOnDay(r,1,'Eve') >= 30,
        `${label}: all three daily prayers placed (got M${minutesOnDay(r,1,'Morning')} N${minutesOnDay(r,1,'Noon')} E${minutesOnDay(r,1,'Eve')})`);
      assert(errandCountOnDay(r,1,errands) <= 1, `${label}: at most one errand tomorrow (got ${errandCountOnDay(r,1,errands)})`);
      for(const nm of errands){
        assert(placedAnywhere(r,nm) > 0, `${label}: ${nm} placed somewhere in the week`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7 — packed week + higher priority: may take a breakable chunk.
  // Crisis (pri 0) plan-by is tomorrow only — no clean alternative. It MUST
  // place even though it breaches Work (pri 1), because priority wins when
  // the week is packed. Dropping Crisis would hide a more important item.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7] packed + higher priority — Crisis may take a Work chunk');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:1,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Crisis', type:'keepup', target:30, durationMinutes:300, priority:0,
        planByDate:todayBase + 1*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Crisis') >= 300, `${label}: packed higher-pri Crisis fully placed (got ${minutesOnDay(r,1,'Crisis')})`);
      assert(minutesOnDay(r,1,'Work') <= 260, `${label}: Work yields to higher-pri Crisis (got ${minutesOnDay(r,1,'Work')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7c — packed week + lower priority: may NOT take a Work chunk.
  // Errand (pri 3) plan-by is tomorrow only — no clean alternative — but it
  // is lower priority than Work (pri 0). Stay unplaced (or spare-only) rather
  // than shorting the daily breakable.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7c] packed + lower priority — Errand must not steal Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Errand', type:'keepup', target:30, durationMinutes:300, priority:3,
        planByDate:todayBase + 1*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work stays full vs lower-pri packed Errand (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Errand') <= 200, `${label}: lower-pri Errand does not take a full Work-stealing block (got ${minutesOnDay(r,1,'Errand')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7b — can-wait beats priority: higher-priority Oil still defers.
  // Oil is P0 (higher than Work P1) but plan-by is later and quieter days
  // exist. Placing Oil tomorrow would steal Work forever; deferring Oil keeps
  // both → more things done. Priority must NOT override "can wait → waits".
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7b] can-wait — higher-priority Oil still defers for Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:1,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:120, priority:2,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Oil Change', type:'keepup', target:30, durationMinutes:120, priority:0,
        planByDate:todayBase + 4*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h; can-wait Oil must not steal (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Oil Change') === 0, `${label}: higher-priority Oil defers off busy day (got ${minutesOnDay(r,1,'Oil Change')})`);
      assert(placedAnywhere(r,'Oil Change') >= 120, `${label}: Oil still places later in the week (got ${placedAnywhere(r,'Oil Change')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7d — packed week + equal priority: may NOT take a Work chunk.
  // Peer is P0 like Work, plan-by tomorrow only. Equal is not strictly higher,
  // so Peer must not displace Work.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7d] packed + equal priority — Peer must not steal Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Peer', type:'keepup', target:30, durationMinutes:300, priority:0,
        planByDate:todayBase + 1*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work stays full vs equal-pri packed Peer (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Peer') <= 200, `${label}: equal-pri Peer does not take a full Work-stealing block (got ${minutesOnDay(r,1,'Peer')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 7e — can-wait + equal priority: still defers.
  // Same priority as Work, but quieter days exist → wait, keep both.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7e] can-wait + equal priority — Peer still defers for Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:120, priority:2,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Peer', type:'keepup', target:30, durationMinutes:120, priority:0,
        planByDate:todayBase + 4*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h; equal-pri can-wait Peer must not steal (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Peer') === 0, `${label}: equal-pri Peer defers off busy day (got ${minutesOnDay(r,1,'Peer')})`);
      assert(placedAnywhere(r,'Peer') >= 120, `${label}: Peer still places later (got ${placedAnywhere(r,'Peer')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 8 — maximum doability: nothing droppable is dropped, front-loaded.
  // A packed week where every plan-by item is achievable somewhere. Asserts the
  // TOTAL placed minutes per item across the week hits its full target (no
  // unnecessary drops) and that earlier days carry more errand load than later
  // ones (ASAP / do-as-early-as-possible).
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[8] maximum doability — everything placed, front-loaded');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:60, priority:1,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Read', type:'keepup', target:30, durationMinutes:60, priority:2,
        planByDate:todayBase + 6*86400000 }),
      base({ name:'Call', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 6*86400000 })
    ];
    const errands = ['Read','Call'];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      // Full doability: every errand reaches 100% of its duration somewhere.
      assert(weekTotal(r,'Read') >= 60, `${label}: Read fully placed (got ${weekTotal(r,'Read')})`);
      assert(weekTotal(r,'Call') >= 30, `${label}: Call fully placed (got ${weekTotal(r,'Call')})`);
      assert(weekTotal(r,'Work') >= 360*5, `${label}: Work gets its full daily target on 5 days (got ${weekTotal(r,'Work')})`);
      // Front-loading: the first errand-bearing day is as early as possible.
      let firstErrandDay = -1;
      for(let o = 0;o < 7;o++){
        if(errandCountOnDay(r,o,errands) > 0){ firstErrandDay = o; break; }
      }
      assert(firstErrandDay === 1, `${label}: errands front-load to the earliest day (1; got ${firstErrandDay})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 9 — fragmentation / hours repair (Wednesday-style).
  // Blood Test (scheduled 90m) + two can-wait errands (90m each) sit in the
  // Work window. Raw spare minutes may look fine, but minChunk=60 means a
  // mid-window errand can leave Work short. Holistic packing must still hit
  // Work 6h and place both errands somewhere in the week (max hours).
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[9] fragmentation — Work hours recovered, errands still placed');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Blood Test', type:'task', durationMinutes:90, priority:1,
        eventTime:at(1,10,30), createdAt:now - 86400000 }),
      base({ name:'Oil Change', type:'keepup', target:30, durationMinutes:120, priority:0,
        planByDate:todayBase + 4*86400000 }),
      base({ name:'Indian Grocery', type:'keepup', target:30, durationMinutes:90, priority:3,
        planByDate:todayBase + 5*86400000 })
    ];
    const errands = ['Oil Change','Indian Grocery'];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h after hours repair (got ${minutesOnDay(r,1,'Work')})`);
      for(const nm of errands){
        assert(placedAnywhere(r,nm) > 0, `${label}: ${nm} still placed somewhere (max hours)`);
      }
      assert(weekTotal(r,'Work') + weekTotal(r,'Oil Change') + weekTotal(r,'Indian Grocery')
        >= 360 + 120 + 90,
        `${label}: week hours cover Work+errands (got W${weekTotal(r,'Work')} O${weekTotal(r,'Oil Change')} G${weekTotal(r,'Indian Grocery')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 10 — protection is by shape, not the name "Work".
  // A daily breakable called Study must get the same can-wait protection.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[10] name-agnostic — Study (daily breakable) protected like Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Study', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:1,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:120, priority:2,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Oil Change', type:'keepup', target:30, durationMinutes:120, priority:0,
        planByDate:todayBase + 4*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Study') >= 360, `${label}: Study hits 6h (got ${minutesOnDay(r,1,'Study')})`);
      assert(minutesOnDay(r,1,'Oil Change') === 0, `${label}: can-wait Oil defers off Study's busy day (got ${minutesOnDay(r,1,'Oil Change')})`);
      assert(placedAnywhere(r,'Oil Change') >= 120, `${label}: Oil still places later (got ${placedAnywhere(r,'Oil Change')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 11 — one-shot task is a movable: can-wait defers for Work.
  // A P0 due-task with flexibility can land later in the week; it must not
  // steal tomorrow's Work when quieter days remain.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[11] one-shot task can-wait — defers for Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const at = (o,h,m) => (todayBase + o*86400000) + h*3600000 + m*60000;
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:1,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Clinic', type:'task', durationMinutes:120, priority:2,
        eventTime:at(1,10,0), createdAt:now - 86400000 }),
      base({ name:'Deadline Task', type:'task', durationMinutes:120, priority:0,
        dueDate:todayBase + 4*86400000, flexibilityDays:4, hardDue:false,
        target:null, createdAt:now - 86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work hits 6h vs can-wait task (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Deadline Task') === 0, `${label}: can-wait task defers off busy day (got ${minutesOnDay(r,1,'Deadline Task')})`);
      assert(placedAnywhere(r,'Deadline Task') >= 120, `${label}: task still places later (got ${placedAnywhere(r,'Deadline Task')})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Scenario 12 — packed lower-pri that FITs in spare still places.
  // Errand is tomorrow-only and lower priority, but 90m fits inside Work's
  // spare — it must place ASAP without shorting Work (not over-blocked).
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[12] packed lower-pri spare-fit — places without shorting Work');
  {
    const now = atTime(19);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:360,
        breakable:true, minChunkMinutes:60, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1125 }),
      base({ name:'Errand', type:'keepup', target:30, durationMinutes:90, priority:3,
        planByDate:todayBase + 1*86400000 })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,1,'Work') >= 360, `${label}: Work stays full (got ${minutesOnDay(r,1,'Work')})`);
      assert(minutesOnDay(r,1,'Errand') >= 90, `${label}: spare-fit Errand still places tomorrow (got ${minutesOnDay(r,1,'Errand')})`);
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
