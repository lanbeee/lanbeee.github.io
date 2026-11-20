// GLPK seed-pack: a fully-required day whose sparse option enumeration offers
// no co-selectable compatible set used to relax its hard rows and then
// maximize ITEM count over minutes — an "optimal" 40-minute short-item pack
// that silently dropped a feasible 70-minute due task (Fast placed all 110
// minutes on the same inputs). `optimizerSeedPackStarts` now witnesses one
// legal day packing (prior clocks when they cover the required rows, else a
// bounded greedy on a cloned state) and offers those clocks per candidate as
// ordinary options. GLPK stays free to choose better ones; days whose
// witness cannot cover every required candidate keep the baseline options.
//
// Case matrix:
//   [1] core repro — 70m task + eight 5m tasks in a 2h evening: GLPK places
//       all 110 minutes on the first ordinary solve with no relax pass
//   [2] shuffled data order — witness ordering is duration-based, not
//       input-order based
//   [3] uneven durations — 70/15/10 + shorts still pack 110 minutes
//   [4] travel — the long task at an away venue keeps all minutes placed
//       with travel to the venue retained
//   [5] direct link — a direct-linked short pair stays adjacent while the
//       long task places (witness respects dependency order)
//   [6] negative control — long task with exactly one legal start (18:30)
//       still places at that clock; a data-order witness would destroy it
//   [7] witness-incomplete day — overcapacity keeps the baseline relaxed
//       path: the seed must not fire when the required rows cannot all be
//       witnessed
//   [8] prior clocks — reuse a complete packing, then edit the long item's
//       window and duration and verify that its old start cannot bypass them
//   [9] isolation — an earlier away seed must not mutate committed route fits
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/glpk-seed-pack-test.js
//
const {
  chromium, BASE, atTime, baseHabit:base,
  plannerSettings, glpkAvailable, runPlannerPair, placedAnywhere
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function eveningTasks(nowMs, durations, names, overrides = {}){
  return durations.map((durationMinutes, i) => base(Object.assign({
    hid: 'seed-' + (names && names[i] ? names[i] : 't' + i),
    name: (names && names[i] ? names[i] : 'task' + i),
    type: 'task', target: null,
    durationMinutes,
    dueDate: nowMs, createdAt: nowMs - 86400000,
    allowedTimeStart: 1080, allowedTimeEnd: 1200
  }, overrides)));
}

const eveningSettings = plannerSettings([
  { label:'before', days:[], start:0, end:1080 },
  { label:'after', days:[], start:1200, end:1440 }
]);

function totalMinutes(result){
  return (result.days || []).reduce((sum, d) =>
    sum + Object.values(d).reduce((a, b) => a + b, 0), 0);
}

function fillRows(result, dayOffset, dataIndex){
  // runPlannerPair details: result.rows is one array of timeline rows per day.
  return (((result || {}).rows || [])[dayOffset] || []).filter(row =>
    row.kind === 'fill' && (dataIndex == null || row.i === dataIndex));
}

function noOverlap(result, dayOffset){
  const rows = fillRows(result, dayOffset).slice().sort((a, b) => a.start - b.start);
  for(let i = 1;i < rows.length;i += 1){
    if(rows[i].start < rows[i - 1].end - 1)return false;
  }
  return true;
}

async function runPair(page, data, settings, nowMs, numDays = 1){
  // travelBetween reads the page settings; mirror the production worker's
  // settings scope so this fixture uses its manual route rather than a
  // haversine estimate from the empty test page.
  const previous = await page.evaluate(() => sortSettings);
  await page.evaluate(settings => { sortSettings = settings; }, settings);
  try{
    return await runPlannerPair(page, data, settings, nowMs, numDays, true);
  }finally{
    await page.evaluate(previous => { sortSettings = previous; }, previous);
  }
}

async function glpkDiagnostics(page, data, settings, nowMs, opts = {}){
  return page.evaluate(async ({data, settings, now, opts}) => {
    const RealDate = Date;
    function FrozenDate(...args){
      return args.length === 0 ? new RealDate(now) : new RealDate(...args);
    }
    FrozenDate.now = () => now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    try{
      const week = await buildWeekAgendaAsync(
        data, Object.assign({}, settings, {agendaOptimizer:true}), 1, opts);
      const solves = (week.plannerDiagnostics && week.plannerDiagnostics.daySolves) || [];
      return {
        optimized: Boolean(week.optimized),
        statuses: solves.map(s => s.status),
        rows: week.days[0].timeline.filter(row => row.kind === 'fill')
          .map(row => ({i:row.i, start:row.start, end:row.end})),
        relaxed: solves.map(s => Boolean(s.relaxedRequiredOccurrences)),
        options: solves.map(s => s.optionCount || 0)
      };
    }finally{ globalThis.Date = RealDate; }
  }, {data, settings, now: nowMs, opts});
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  try{
    const context = await browser.newContext({ timezoneId:'America/New_York', serviceWorkers:'block' });
    const page = await context.newPage();
    page.on('pageerror', e => { fail += 1; console.error('  pageerror: ' + e); });
    await page.goto(BASE, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => typeof buildWeekAgendaAsync === 'function');

    const glpkOk = await glpkAvailable(page);

    console.log('\n[1] core repro: 70m task + eight 5m tasks in a 120-minute evening');
    {
      const nowMs = atTime(17, 50);
      const names = ['long70','s1','s2','s3','s4','s5','s6','s7','s8'];
      const data = eveningTasks(nowMs, [70,5,5,5,5,5,5,5,5], names);
      const r = await runPair(page, data, eveningSettings, nowMs);
      assert(placedAnywhere(r.fast, 'long70') === 70 && totalMinutes(r.fast) === 110,
        `Fast parity keeps its 110 minutes (${totalMinutes(r.fast)}m)`);
      if(glpkOk){
        assert(r.glpk.optimized, 'first plan uses GLPK rather than heuristic fallback');
        assert(placedAnywhere(r.glpk, 'long70') === 70,
          `GLPK places the 70-minute due task (${placedAnywhere(r.glpk, 'long70')}m)`);
        assert(totalMinutes(r.glpk) === 110,
          `GLPK places all 110 minutes (${totalMinutes(r.glpk)}m)`);
        assert(noOverlap(r.glpk, 0), 'published GLPK rows do not overlap');
        const diag = await glpkDiagnostics(page, data, eveningSettings, nowMs);
        assert(diag.optimized && diag.statuses.length > 0
          && diag.statuses.every(status => status === 'optimal' || status === 'feasible')
          && !diag.relaxed.some(Boolean),
          'first ordinary solve keeps the strict required rows (no relax pass)');
      }else{
        console.log('  skip: GLPK column unavailable on this page');
      }
    }

    console.log('\n[2] shuffled data order packs the same evening');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      const names = ['s1','s2','s3','s4','s5','s6','s7','s8','long70'];
      const data = eveningTasks(nowMs, [5,5,5,5,5,5,5,5,70], names);
      const r = await runPair(page, data, eveningSettings, nowMs);
      assert(placedAnywhere(r.glpk, 'long70') === 70,
        'witness is duration-based, not input-order based (long task placed)');
      assert(totalMinutes(r.glpk) === 110, `all 110 minutes placed (${totalMinutes(r.glpk)}m)`);
    }

    console.log('\n[3] uneven durations still pack 110 minutes');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      const data = eveningTasks(nowMs, [70,15,10,5,5,5]);
      const r = await runPair(page, data, eveningSettings, nowMs);
      assert(totalMinutes(r.glpk) === 110, `all 110 minutes placed (${totalMinutes(r.glpk)}m)`);
    }

    console.log('\n[4] the long task at an away venue keeps every minute placed');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      const data = eveningTasks(nowMs, [70,5,5,5,5]);
      const long = data[0];
      long.anywhereAllowed = false;
      long.locationIds = ['shop'];
      const settings = plannerSettings([
        { label:'before', days:[], start:0, end:1080 },
        { label:'after', days:[], start:1200, end:1440 }
      ], {
        lastKnownLocationId:'home',
        locations: [
          { id:'home', name:'Home', isHome:true, lat:40.7, lng:-74 },
          { id:'shop', name:'Shop', lat:40.701, lng:-74 }
        ],
        travel: {
          'home|shop': { a:'home', b:'shop', seconds:600, metres:800,
            provider:'manual', fetchedAt: nowMs }
        }
      });
      const r = await runPair(page, data, settings, nowMs);
      assert(placedAnywhere(r.glpk, 'task0') === 70,
        `away-venue 70-minute task places (${placedAnywhere(r.glpk, 'task0')}m)`);
      assert(totalMinutes(r.glpk) === 90, `all 90 work minutes placed (${totalMinutes(r.glpk)}m)`);
      const longRows = fillRows(r.glpk, 0, 0);
      assert(longRows.length === 1 && longRows[0].locationId === 'shop',
        `long task sits at the away venue (${longRows[0] ? longRows[0].locationId : 'missing'})`);
      const travelRows = (((r.glpk || {}).rows || [])[0] || [])
        .filter(row => row.kind === 'travel');
      assert(r.glpk.travelSeconds >= 600 && travelRows.length >= 1,
        `travel to the venue is retained (${travelRows.length} rows, ` +
        `${r.glpk.travelSeconds}s)`);
    }

    console.log('\n[5] a direct-linked short pair stays adjacent beside the long task');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      const names = ['long70','s1','s2','s3','s4','s5','s6','s7','s8'];
      const data = eveningTasks(nowMs, [70,5,5,5,5,5,5,5,5], names);
      data[2].scheduleLinks = [{ anchorHid:'seed-s3', direction:'before',
        adjacency:'direct', requireSameDay:true }];
      const r = await runPair(page, data, eveningSettings, nowMs);
      assert(totalMinutes(r.glpk) === 110, `all 110 minutes placed (${totalMinutes(r.glpk)}m)`);
      const s2 = fillRows(r.glpk, 0, 2);
      const s3 = fillRows(r.glpk, 0, 3);
      assert(s2.length === 1 && s3.length === 1, 'direct pair both placed on day 0');
      if(s2.length && s3.length){
        const gapMin = (s3[0].start - s2[0].end) / 60000;
        assert(gapMin >= 0 && gapMin <= 1,
          `direct pair s2->s3 is ordered and adjacent (gap ${gapMin}m)`);
      }
    }

    console.log('\n[6] negative control: exactly one legal start (18:30) is still found');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      const dayStart = nowMs - 1070 * 60000;
      const names = ['long70','s1','s2','s3','s4','s5','s6','s7','s8'];
      const data = eveningTasks(nowMs, [70,5,5,5,5,5,5,5,5], names);
      // Window 18:30–19:40 with a 70-minute task: the only legal start is
      // 18:30. A data-order witness (shorts first at 18:00) destroys that
      // start; duration-first keeps it.
      data[0].allowedTimeStart = 1110;
      data[0].allowedTimeEnd = 1180;
      const r = await runPair(page, data, eveningSettings, nowMs);
      assert(placedAnywhere(r.glpk, 'long70') === 70,
        `single-start 70-minute task places (${placedAnywhere(r.glpk, 'long70')}m)`);
      const rows = fillRows(r.glpk, 0, 0);
      const clockMin = rows.length ? (rows[0].start - dayStart) / 60000 : -1;
      assert(Math.abs(clockMin - 1110) < 1,
        `long task sits at its only legal start 18:30 (start ${clockMin}m)`);
      assert(totalMinutes(r.glpk) === 110,
        `all 110 minutes placed around it (${totalMinutes(r.glpk)}m)`);
    }

    console.log('\n[7] witness-incomplete day keeps the baseline relaxed path');
    if(!glpkOk){
      console.log('  skip: GLPK column unavailable on this page');
    }else{
      const nowMs = atTime(17, 50);
      // 190 minutes of required work in a 120-minute window: no legal packing
      // exists, so the witness cannot cover the required rows and the seed
      // must not fire. The relaxed path then places a feasible subset.
      const data = eveningTasks(nowMs, [70,20,20,20,20,5,5,5,5]);
      const r = await runPair(page, data, eveningSettings, nowMs);
      const total = totalMinutes(r.glpk);
      assert(r.glpk.optimized, 'still a real GLPK incumbent');
      assert(total <= 120, `never exceeds the open window (${total}m)`);
      assert(total >= 95, `relaxed incumbent keeps most of the window (${total}m)`);
      assert(noOverlap(r.glpk, 0), 'published rows do not overlap');
      if(glpkOk){
        const diag = await glpkDiagnostics(page, data, eveningSettings, nowMs);
        assert(diag.relaxed.some(Boolean),
          'unwitnessable day still takes the ordinary relaxed path');
      }
    }

    console.log('\n[8] prior clocks remain legal after a window edit');
    if(glpkOk){
      const nowMs = atTime(17, 50);
      const data = eveningTasks(nowMs, [70,5,5,5,5,5,5,5,5]);
      const first = await glpkDiagnostics(page, data, eveningSettings, nowMs);
      const warm = await glpkDiagnostics(page, data, eveningSettings, nowMs,
        {priorPlacements:first.rows});
      assert(warm.optimized && warm.rows.length === 9 && !warm.relaxed.some(Boolean),
        'prior packing preserves all nine items on replan');
      data[0].durationMinutes = 60;
      data[0].allowedTimeStart = 1110;
      data[0].allowedTimeEnd = 1170;
      const edited = await glpkDiagnostics(page, data, eveningSettings, nowMs,
        {priorPlacements:first.rows});
      const long = edited.rows.find(row => row.i === 0);
      const clockStart = new Date(nowMs);
      clockStart.setHours(18, 30, 0, 0);
      assert(edited.optimized && long && long.start === clockStart.getTime()
        && long.end - long.start === 60 * 60000,
        'stale prior start cannot bypass the edited hard window or duration');
    }else{
      console.log('  skip: GLPK column unavailable on this page');
    }

    console.log('\n[9] seed route reconciliation cannot mutate committed work');
    if(glpkOk){
      const nowMs = atTime(17, 50);
      const data = eveningTasks(nowMs, [10,10]);
      data[0].anywhereAllowed = false;
      data[0].locationIds = ['home'];
      data[0].allowedTimeStart = 1140;
      data[0].allowedTimeEnd = 1150;
      data[1].anywhereAllowed = false;
      data[1].locationIds = ['shop'];
      const isolated = await page.evaluate(({data, settings, now}) => {
        const RealDate = Date;
        function FrozenDate(...args){
          return args.length ? new RealDate(...args) : new RealDate(now);
        }
        Object.setPrototypeOf(FrozenDate, RealDate);
        FrozenDate.prototype = RealDate.prototype;
        FrozenDate.now = () => now;
        globalThis.Date = FrozenDate;
        const previous = sortSettings;
        settings = {...settings, lastKnownLocationId:'home', locations:[
          {id:'home', name:'Home', isHome:true, lat:40.7, lng:-74},
          {id:'shop', name:'Shop', lat:40.701, lng:-74}
        ], travel:{'home|shop':{a:'home', b:'shop', seconds:600, provider:'manual'}}};
        sortSettings = settings;
        try{
          const dayBase = dayStart(now);
          const state = createDayPlacementState({dayBase, totalMinutes:120, agendaItems:[]}, settings,
            {now, dayBase, startClock:dayBase + 1080 * 60000});
          const existing = {h:data[0], i:0, priority:2, scarcity:0};
          const fit = tryPlaceOnDay(state, existing, {allowNetwork:false});
          if(!fit)return {setup:false};
          commitPlacement(state, existing, fit);
          const snapshot = () => JSON.stringify({rows:state.rows, fills:state.fills,
            day:state.day, remaining:state.remaining, usedMinutes:state.usedMinutes,
            prevLocId:state.prevLocId, placed:[...state.placed]});
          const before = snapshot();
          const seed = optimizerSeedPackStarts(state,
            [{h:data[1], i:1, priority:2, scarcity:0}], new Set([1]), []);
          return {setup:true, seeded:seed.length === 1, unchanged:before === snapshot()};
        }finally{sortSettings = previous; globalThis.Date = RealDate;}
      }, {data, settings:eveningSettings, now:nowMs});
      assert(isolated.setup && isolated.seeded, 'seed inserts an earlier away item beside committed work');
      assert(isolated.unchanged, 'speculative route changes leave the original state unchanged');
    }

    console.log(`\nglpk seed pack: ${pass} passed, ${fail} failed` +
      (glpkOk ? '' : ' (GLPK column soft-skipped where marked)'));
    process.exitCode = fail ? 1 : 0;
  }finally{
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
