// Within-day "you are HERE" sequencing regression suite.
//
// cluster-objective-test.js locks down WEEK-level clustering (two far errands
// share a DAY). This file locks down the WITHIN-DAY case the user actually hit:
//
//   "I was standing at location A with a task planned there. The app told me to
//    go HOME first, then come BACK to A, then go home again — 2 extra trips."
//
// The correct behaviour follows the documented lex priority
// (hard > placed-hours > MIN TRAVEL > ASAP/priority > preference): when you are
// already at a location, the task there costs 0 travel and must be done FIRST.
// Sending you away and back is never acceptable — travel minimization IS time
// minimization.
//
// It also covers opportunistic pull-forward: a flexible habit whose location you
// happen to be at right now should be pulled into TODAY (0 travel) instead of
// being left for its due day (which would force a separate trip).
//
// Travel uses walking mode (pure haversine, no network) so the commute cost —
// and thus the at-location advantage — is deterministic and offline-safe.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/at-location-first-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){ if(cond){ pass += 1; console.log('  ok: ' + msg); } else { fail += 1; console.error('  FAIL: ' + msg); } }

// Freeze the clock at 10:00 local — well past the sleep block — so "you are at
// farA right now" is coherent (awake, full open day ahead).
const tenAm = (() => { const d = new Date(); d.setHours(10,0,0,0); return d.getTime(); })();
function dayStartOf(n){ const d = new Date(); return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n).getTime(); }

function weekOverridesFromWeekly(frozen, weekly, days = 14){
  const out = {};
  const start = new Date(frozen);
  start.setHours(12, 0, 0, 0);
  for(let i = 0; i < days; i++){
    const d = new Date(start.getTime() + i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    out[key] = weekly[d.getDay()];
  }
  return out;
}

function seedScript(habits, settingsOverrides = {}){
  const weekly = settingsOverrides.availabilityMinutes || [600,600,600,600,600,600,600];
  const overrides = Object.assign(
    weekOverridesFromWeekly(tenAm, weekly),
    settingsOverrides.availabilityOverrides || {}
  );
  const settings = {
    preset:'todayFirst', topics:[], travel:{}, defaultTravelMode:'walking',
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],
    availabilityOverrides:overrides,
    blockedTimes:[{ label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' }],
    lastKnownLocationId:'home', locationWeight:80, showWeekOnHome:true,
    ...settingsOverrides,
    availabilityOverrides: Object.assign(overrides, settingsOverrides.availabilityOverrides || {}),
  };
  return `(function(){
    const R=Date,frozen=${tenAm};
    function F(...a){return a.length?new R(...a):new R(frozen);}
    F.now=()=>frozen;F.parse=R.parse;F.UTC=R.UTC;F.prototype=R.prototype;
    Object.setPrototypeOf(F,R);window.Date=F;
    localStorage.setItem('tings_v2', ${JSON.stringify(JSON.stringify(habits))});
    localStorage.setItem('tings_app_settings_v2', ${JSON.stringify(JSON.stringify(settings))});
  })();`;
}

// Home alone in the city; FarA ~28km out. A real commute either direction.
const PLACES = [
  { id:'home', name:'Home', lat:40.700, lng:-74.000 },
  { id:'farA', name:'FarA', lat:40.950, lng:-74.000 },
];

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // The scenario must hold on BOTH planner paths: the GLPK optimizer (the
  // production default) and the fast heuristic (used when GLPK is off,
  // unavailable, or timed out — a real user configuration). Fast is always
  // available; GLPK is checked and its block soft-skips when absent.
  await page.goto(baseUrl, { waitUntil:'load' });
  const glpkOk = await page.evaluate(async () => {
    if(typeof ensureGlpk !== 'function')return false;
    if(loadSortSettings().agendaOptimizer === false)return false;
    try{ return !!(await ensureGlpk()); }catch(_){ return false; }
  });

  // `path`: 'fast' (sync heuristic buildWeekAgenda) or 'glpk' (buildWeekAgendaAsync).
  async function todaySequence(path){
    return await page.evaluate(async (useGlpk) => {
      const w = useGlpk
        ? await buildWeekAgendaAsync(load(), loadSortSettings(), 7)
        : buildWeekAgenda(load(), loadSortSettings(), 7);
      const today = w.days[0];
      const commutes = (today.timeline || []).filter(r => r.kind === 'travel')
        .map(r => `${r.from}->${r.to}`);
      return {
        optimized: Boolean(w.optimized),
        commutes,
        travelSeconds: today.travelSeconds,
        fills: (today.timeline || []).filter(r => r.kind === 'fill')
          .map(r => ({ name:r.h.name, loc:r.locationId, start:r.start })),
      };
    }, path === 'glpk');
  }

  async function checkBoth(label, habits, settingsOverrides, fn){
    console.log('\n[' + label + ']');
    await page.addInitScript(seedScript(habits, settingsOverrides));
    await page.goto(baseUrl, { waitUntil:'load' });
    await page.waitForTimeout(300);
    for(const path of ['fast', ...(glpkOk ? ['glpk'] : [])]){
      const t = await todaySequence(path);
      fn(t, path);
    }
  }

  // ── 1. THE EXACT USER BUG: at farA, farA task + home task → farA FIRST ──
  // You are at farA (live pin). Two equal-priority flexible tasks are due
  // today, one at farA and one at home. Doing farA first costs 0 inbound travel;
  // then a single farA->home commute. The buggy order (home first) would force
  // home->farA->home = two extra legs.
  await checkBoth('1. at-location task is done first (no away-and-back)', [
    { name:'farA task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['farA'], priority:2, flexibilityDays:0 },
    { name:'home task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['home'], priority:2, flexibilityDays:0 },
  ], { locations:PLACES, pinnedLocationId:'farA' }, (t, path) => {
    const firstFill = t.fills[0];
    assert(firstFill && firstFill.loc === 'farA',
      `[${path}] first today fill is at farA (you are here) — got ${firstFill && firstFill.loc}`);
    const commuteIntoFarA = t.commutes.filter(c => c.endsWith('->farA'));
    assert(commuteIntoFarA.length === 0,
      `[${path}] no away-then-back: zero commutes INTO farA today (got ${JSON.stringify(commuteIntoFarA)})`);
    assert(t.commutes.length <= 1,
      `[${path}] at most one commute today (got ${JSON.stringify(t.commutes)})`);
  });

  // ── 2. Same as 1 but the HOME task is HIGHER priority ──
  // Travel (tier 3) outranks priority (tier 4) per the documented order, so
  // even a higher-priority home task must NOT create an away-and-back when the
  // farA task could be done now for free. Both still place (placed-hours > all);
  // only the ORDER flips to save the commute.
  await checkBoth('2. at-location task first even vs higher-priority away task', [
    { name:'farA task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['farA'], priority:2, flexibilityDays:0 },
    { name:'home task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['home'], priority:0, flexibilityDays:0 },
  ], { locations:PLACES, pinnedLocationId:'farA' }, (t, path) => {
    const firstFill = t.fills[0];
    assert(firstFill && firstFill.loc === 'farA',
      `[${path}] first today fill is at farA despite lower priority — got ${firstFill && firstFill.loc}`);
    const commuteIntoFarA = t.commutes.filter(c => c.endsWith('->farA'));
    assert(commuteIntoFarA.length === 0,
      `[${path}] no away-and-back even when away task is higher priority (got ${JSON.stringify(commuteIntoFarA)})`);
  });

  // ── 3. Opposite anchor: at HOME, home task + farA task → home FIRST ──
  // Symmetry check. At home, the home task is free; do it first, then ONE
  // home->farA commute. Never home->farA->home->... before the home task.
  await checkBoth('3. at home → home task first (symmetric)', [
    { name:'farA task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['farA'], priority:2, flexibilityDays:0 },
    { name:'home task', type:'task', dueDate: dayStartOf(0), durationMinutes:30, locationIds:['home'], priority:2, flexibilityDays:0 },
  ], { locations:PLACES, pinnedLocationId:'home' }, (t, path) => {
    const firstFill = t.fills[0];
    assert(firstFill && firstFill.loc === 'home',
      `[${path}] first today fill is at home (you are here) — got ${firstFill && firstFill.loc}`);
    assert(t.commutes.length <= 1,
      `[${path}] at most one commute today (got ${JSON.stringify(t.commutes)})`);
  });

  // ── 4. PULL-FORWARD: flexible farA habit done TODAY because you are at farA ──
  // Left on a later day it would cost a separate round trip; pulled forward it
  // costs 0. Holds on both paths (fast ASAP + GLPK travel score both favour the
  // 0-travel day once presence knows you're there).
  {
    console.log('\n[4. flexible at-location habit pulled forward to today]');
    await page.addInitScript(seedScript([
      { name:'farA flex habit', type:'keepup', target:7, logs:[Date.now()-8*86400000], durationMinutes:30, locationIds:['farA'], priority:2 },
    ], { locations:PLACES, pinnedLocationId:'farA' }));
    await page.goto(baseUrl, { waitUntil:'load' });
    await page.waitForTimeout(300);
    for(const path of ['fast', ...(glpkOk ? ['glpk'] : [])]){
      const placed = await page.evaluate(async (useGlpk) => {
        const w = useGlpk
          ? await buildWeekAgendaAsync(load(), loadSortSettings(), 7)
          : buildWeekAgenda(load(), loadSortSettings(), 7);
        return w.days.map(d => ({
          offset: Math.round((d.dayBase - dayStart(Date.now()))/86400000),
          has: (d.timeline || []).some(r => r.kind === 'fill' && r.h.name === 'farA flex habit'),
        })).filter(d => d.has).map(d => d.offset);
      }, path === 'glpk');
      assert(placed.includes(0), `[${path}] flexible farA habit pulled into TODAY because you're there (got days ${JSON.stringify(placed)})`);
    }
  }

  // ── 5. Boot cleanliness ──
  console.log('\n[5. boot cleanliness]');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
