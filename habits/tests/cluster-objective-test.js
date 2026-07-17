// Co-location / objective-ordering regression suite.
//
// The week planner must honour this priority, in order:
//   1. HARD CONSTRAINTS  — capacity, blocked/scheduled slots, location hours,
//      closed-days, allowed windows, hard-pinned items. Never violated.
//   2. MINIMUM TRAVEL     — co-located far errands share one trip (one commute
//      + short hop), never duplicated into two home round-trips.
//   3. ASAP / HIGH-PRIORITY — when travel is unaffected, do things sooner and
//      favour higher priority. Flexible items may defer to save a commute; a
//      hard-pinned/critical item never defers.
//   4. PREFERENCES        — preferred location/time/weekday are soft tiebreakers
//      only; they never beat travel or urgency.
//
// This file exists so the exact bug the user hit (two far-from-home but close-
// to-each-other items, one a habit and one a task, getting split across days)
// can never silently return, and so the priority ordering above stays honest.
//
// Travel uses walking mode (pure haversine, no network) so proximity — and thus
// the cluster advantage — is deterministic and offline-safe.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/cluster-objective-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond,msg){ if(cond){ pass += 1; console.log('  ok: ' + msg); } else { fail += 1; console.error('  FAIL: ' + msg); } }

// Freeze the clock at 06:00 local so "today" always has a full open slot,
// regardless of when CI runs. Keeps ASAP/today behaviour deterministic.
const sixAm = (() => { const d = new Date(); d.setHours(6,0,0,0); return d.getTime(); })();
function dayStartOf(n){ const d = new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n).getTime(); }

// Build an init script: freeze clock at 6am + seed habits & settings.
function seedScript(habits, settingsOverrides = {}){
  const settings = {
    preset:'todayFirst', topics:[], travel:{}, defaultTravelMode:'walking',
    availabilityMinutes:[600,600,600,600,600,600,600],
    blockedTimes:[{ label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:360, locationId:'home' }],
    lastKnownLocationId:'home', locationWeight:80, showWeekOnHome:true,
    ...settingsOverrides,
  };
  return `(function(){
    const R=Date,frozen=${sixAm};
    function F(...a){return a.length?new R(...a):new R(frozen);}
    F.now=()=>frozen;F.parse=R.parse;F.UTC=R.UTC;F.prototype=R.prototype;
    Object.setPrototypeOf(F,R);window.Date=F;
    localStorage.setItem('tings_v2', ${JSON.stringify(JSON.stringify(habits))});
    localStorage.setItem('tings_app_settings_v2', ${JSON.stringify(JSON.stringify(settings))});
  })();`;
}

// Standard places. Home alone in the city; FarA/FarB/FarC are ~28km out but
// within ~500m of each other (the far cluster).
const PLACES = [
  { id:'home', name:'Home', lat:40.700, lng:-74.000 },
  { id:'farA', name:'FarA', lat:40.950, lng:-74.000 },
  { id:'farB', name:'FarB', lat:40.954, lng:-74.004 },
  { id:'farC', name:'FarC', lat:40.952, lng:-74.003 },
];

const today = Date.now();
const homeRoutine = { name:'home routine', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:10, locationIds:['home'], priority:2 };

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  async function run(label, habits, settingsOverrides, fn){
    console.log('\n[' + label + ']');
    await page.addInitScript(seedScript(habits, settingsOverrides));
    await page.goto(baseUrl, { waitUntil:'load' });
    await page.waitForTimeout(300);
    await fn();
  }

  // Shared evaluator: build the week and return a plain (serializable) summary.
  // Helpers below operate on this summary in Node — functions can't cross the
  // page.evaluate boundary.
  async function week(){
    const raw = await page.evaluate(() => {
      const w = buildWeekAgenda(load(), loadSortSettings(), 7);
      const s = loadSortSettings();
      const reg = normalizeLocationRegistry(s.locations);
      const mode = s.defaultTravelMode;
      const days = w.days.map(d => ({
        offset: Math.round((d.dayBase - dayStart(Date.now()))/86400000),
        fills: d.timeline.filter(r=>r.kind==='fill').map(r=>({name:r.h.name, loc:r.locationId})),
        travel: d.timeline.filter(r=>r.kind==='travel').map(r=>({from:r.from, to:r.to})),
        travelSeconds: d.travelSeconds,
      }));
      return {
        totalTravel: w.totalTravelSeconds,
        homeToFar: travelEdgeBetweenIds('home','farA',reg,mode).seconds,
        farAToFarB: travelEdgeBetweenIds('farA','farB',reg,mode).seconds,
        days,
      };
    });
    const dayOf = (name) => {
      for(const d of raw.days) if(d.fills.some(f=>f.name===name)) return d.offset;
      return null;
    };
    const hasTravelBetween = (offset,a,b) => {
      const d = raw.days.find(x=>x.offset===offset);
      return !!d && d.travel.some(t => (t.from===a&&t.to===b)||(t.from===b&&t.to===a));
    };
    const travelOn = (offset) => {
      const d = raw.days.find(x=>x.offset===offset);
      return d ? d.travelSeconds : 0;
    };
    return { ...raw, dayOf, hasTravelBetween, travelOn };
  }

  // ── 1. Mixed habit + task, far + co-located, different urgency → ONE day ──
  // The exact user bug: a flexible overdue habit + a day-pinned task, both far
  // and near each other. Must share a day with a direct far→far hop.
  await run('1. mixed habit+task far+co-located cluster', [
    homeRoutine,
    { name:'farA habit', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB task',  type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA habit'), b = w.dayOf('farB task');
    assert(a !== null && b !== null, 'both far items get placed');
    assert(a === b, `farA habit + farB task share one day (got farA@d${a}, farB@d${b})`);
    assert(w.hasTravelBetween(a,'farA','farB'), 'cluster day chains farA↔farB directly (not via home)');
    assert(w.travelOn(a) <= w.homeToFar + w.farAToFarB + 60, 'cluster day travel ≈ one commute + short hop');
  });

  // ── 2. Both due today, ample room → grouped on today AND chained ──
  // Min-travel and ASAP together: when today has room, both land today (ASAP)
  // and still chain farA↔farB (min travel).
  await run('2. both due today (ample slot) cluster on today', [
    homeRoutine,
    { name:'farA habit', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB task',  type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA habit'), b = w.dayOf('farB task');
    assert(a === 0 && b === 0, `both far items land TODAY (ASAP) — farA@d${a}, farB@d${b}`);
    assert(w.hasTravelBetween(0,'farA','farB'), 'today chains farA↔farB directly');
  });

  // ── 3. Three co-located far items → all on the SAME day (transitive) ──
  await run('3. three co-located far items cluster transitively', [
    homeRoutine,
    { name:'farA item', type:'task', dueDate: dayStartOf(3), durationMinutes:20, locationIds:['farA'], priority:2 },
    { name:'farB item', type:'task', dueDate: dayStartOf(3), durationMinutes:20, locationIds:['farB'], priority:2 },
    { name:'farC item', type:'task', dueDate: dayStartOf(3), durationMinutes:20, locationIds:['farC'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA item'), b = w.dayOf('farB item'), c = w.dayOf('farC item');
    assert(a !== null && b !== null && c !== null, 'all three far items get placed');
    assert(a === b && b === c, `all three share one day (farA@d${a}, farB@d${b}, farC@d${c})`);
  });

  // ── 4. Flexible far item DEFERS to join a day-pinned far partner ──
  // The two-pass core: an overdue habit (eligible any day) should follow its
  // co-located task that is only eligible later in the week, instead of greedily
  // grabbing today and forcing two commutes.
  await run('4. flexible far item defers to join day-pinned far partner', [
    homeRoutine,
    { name:'farA habit', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB task',  type:'task', dueDate: dayStartOf(4), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA habit'), b = w.dayOf('farB task');
    assert(a !== null && b !== null, 'both placed');
    assert(a === b, `flexible farA habit joins farB task on its day (farA@d${a}, farB@d${b})`);
    assert(b === 4, `farB task lands on its due day (d4, got d${b})`);
    assert(w.totalTravel < w.homeToFar * 1.6, `one trip, not two (travel ${w.totalTravel} < 1.6× commute ${w.homeToFar})`);
  });

  // ── 5. Near-home item is NOT pulled into a far cluster ──
  // The co-location hint must only fire for genuinely far clusters. A home item
  // due today stays today even when a far cluster sits on another day.
  await run('5. near-home item not over-deferred by far cluster', [
    { name:'home habit', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['home'], priority:2 },
    { name:'farA task', type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB task', type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const h = w.dayOf('home habit');
    assert(h === 0, `home habit stays TODAY (ASAP), not dragged to the far cluster (got d${h})`);
  });

  // ── 6. HARD CONSTRAINT beats min-travel: hard-pinned task won't defer ──
  // A P0 hard-deadline task due today at farA is pinned to today. Even though a
  // co-located farB partner is due tomorrow (grouping would save a commute), the
  // pin wins — it stays today. Constraints > travel.
  await run('6. hard-pinned task does not defer to chase a far cluster', [
    homeRoutine,
    { name:'farA critical', type:'task', dueDate: dayStartOf(0), hardDue:true, durationMinutes:30, locationIds:['farA'], priority:0 },
    { name:'farB later',    type:'task', dueDate: dayStartOf(1), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA critical');
    assert(a === 0, `hard-due P0 task stays TODAY despite a far partner tomorrow (got d${a})`);
  });

  // ── 7. Quantitative min-travel: grouped < 55% of split baseline ──
  await run('7. grouped travel < 55% of split baseline', [
    homeRoutine,
    { name:'farA errand', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB errand', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const splitBaseline = w.homeToFar * 4; // home→farA→home + home→farB→home
    assert(w.totalTravel < splitBaseline * 0.55, `grouped travel (${w.totalTravel}s) < 55% of split (${splitBaseline}s)`);
  });

  // ── 8. CLOSED-DAY constraint honoured (constraints > travel) ──
  // Two overdue far habits (eligible ANY day, so without the constraint they'd
  // grab today via ASAP) whose locations are closed today. The closed-day must
  // force them off today onto the next open day, and they still cluster there.
  // This proves the hard constraint beats both min-travel and ASAP.
  await run('8. closed-day defers the whole cluster', [
    homeRoutine,
    { name:'farA closed', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB closed', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farB'], priority:2 },
  ], {
    locations:PLACES.map(p => p.id === 'farA' || p.id === 'farB'
      ? { ...p, allowedTimeStart:420, allowedTimeEnd:1320, closedDays:[new Date(sixAm).getDay()] }
      : p),
  }, async () => {
    const w = await week();
    const a = w.dayOf('farA closed'), b = w.dayOf('farB closed');
    assert(a !== null && b !== null, `both far habits get placed despite today being closed (farA@d${a}, farB@d${b})`);
    assert(a !== 0 && b !== 0, `neither placed on the closed day today — forced off ASAP day (farA@d${a}, farB@d${b})`);
    assert(a === b, `still cluster on the next open day (farA@d${a}, farB@d${b})`);
  });

  // ── 9. PREFERENCES are the weakest priority (preferences < travel) ──
  // farA habit has a soft preferred weekday = today; farB task is due +4d. The
  // preferred-weekday nudge would keep farA on today, but joining farB saves a
  // whole commute. Min-travel must win → farA defers to cluster with farB.
  await run('9. soft preferred-weekday yields to min-travel clustering', [
    homeRoutine,
    { name:'farA habit', type:'keepup', target:1, logs:[today-2*86400000], durationMinutes:30, locationIds:['farA'], priority:2, preferredWeekdays:[new Date(sixAm).getDay()] },
    { name:'farB task',  type:'task', dueDate: dayStartOf(4), durationMinutes:30, locationIds:['farB'], priority:2 },
  ], { locations:PLACES }, async () => {
    const w = await week();
    const a = w.dayOf('farA habit'), b = w.dayOf('farB task');
    assert(a !== null && b !== null, 'both placed');
    assert(a === b, `preferred-weekday habit still clusters with farB instead of chasing today (farA@d${a}, farB@d${b})`);
    assert(w.totalTravel < w.homeToFar * 1.6, `one trip, not two (travel ${w.totalTravel} < 1.6× commute ${w.homeToFar})`);
  });

  // ── 10. Boot cleanliness ──
  console.log('\n[10. boot cleanliness]');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
