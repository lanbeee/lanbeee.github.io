// Plan-by / movable deferral vs daily recurring breakable Work.
//
// The user's rule: do everything as early as possible, BUT defer a movable
// candidate (plan-by item, one-shot task, sparse rhythm) to a quieter eligible
// day when placing it on the current busy day would leave a daily recurring
// breakable (e.g. "Work 6h, M-F, 9:00–18:45") unable to reach its target.
// A movable whose only viable day is this one still places here (no drop).
//
// Every scenario is run twice — once through the GLPK optimizer
// (buildWeekAgendaAsync with agendaOptimizer:true) and once through the fast
// scarcity planner (buildWeekAgenda with agendaOptimizer:false) — and both
// must satisfy the same invariants. Soft-passes if GLPK cannot load.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/plan-by-deferral-test.js
//
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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
  const glpkOk = await page.evaluate(async () => {
    if(typeof ensureGlpk !== 'function')return false;
    try { const G = await ensureGlpk(); return !!G && typeof G.solve === 'function'; }
    catch(_){ return false; }
  });

  // Run a scenario through both paths. `now` freezes the clock so "today" is
  // closed (19:00, past the 18:45 window) and errands can't escape forward.
  async function runBoth(data, settings, now){
    return await page.evaluate(async ({ data, settings, now }) => {
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
      try{
        const w = await buildWeekAgendaAsync(data, Object.assign({}, settings, { agendaOptimizer:true }), 7);
        glpk = { optimized: !!w.optimized, days: summarize(w) };
      }catch(e){ glpk = { error: String(e && e.message || e) }; }
      try{
        const w = buildWeekAgenda(data, Object.assign({}, settings, { agendaOptimizer:false }), 7);
        fast = { days: summarize(w) };
      }catch(e){ fast = { error: String(e && e.message || e) }; }
      globalThis.Date = orig;
      return { glpk, fast };
    }, { data, settings, now });
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
  // Scenario 7 — not god-tier: priority overrides the daily breakable.
  // A higher-priority movable (Crisis, pri 0) whose only viable day is tomorrow
  // MUST place even though it breaches Work (pri 1). The breakable is protected
  // from LOW-priority slack, not from genuinely more important commitments.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[7] not god-tier — higher-priority Crisis displaces Work');
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
      assert(minutesOnDay(r,1,'Crisis') >= 300, `${label}: higher-priority Crisis fully placed (got ${minutesOnDay(r,1,'Crisis')})`);
      assert(minutesOnDay(r,1,'Work') <= 260, `${label}: Work yields to the more important Crisis (got ${minutesOnDay(r,1,'Work')})`);
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
  // Boot cleanliness
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[clean] page errors');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`) + (glpkOk ? '' : ' (GLPK unavailable — glpk column skipped)'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
