// Timed day plans: hard clock + optional location.
//
// Locks:
//   - normalizeLogs preserves timed + locationId
//   - planTingOnDay sets timed only when a time is entered
//   - movePlanTo preserves timed + locationId
//   - timed plans appear as hard scheduled agenda rows at that clock
//   - detail calendar opens the day sheet for unmarked days (no auto-log)
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/timed-day-plan-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function seedScript(){
  return `(function(){
    const now = Date.now();
    const day = (n, hour = 12, minute = 0) => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, hour, minute, 0, 0).getTime();
    };
    const settings = {
      preset:'todayFirst', topics:['qa'], locations:[
        { id:'home', name:'Home', lat:40.7, lng:-74.0 },
        { id:'gym', name:'Gym', lat:40.71, lng:-74.01 }
      ], travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      availabilityOverrides:{},
      showWeekOnHome:true,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
      agendaOptimizer:false,
    };
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    localStorage.setItem('tings_v2', JSON.stringify([
      {
        name:'Timed Plan Habit', type:'keepup', target:3,
        logs:[day(-4)],
        emoji:'⏱️', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], locationIds:['home','gym'], preferredLocationId:'home',
        durationMinutes:30, priority:2,
        preferredTimeStart:8 * 60, preferredTimeEnd:9 * 60,
        createdAt:now - 10*86400000, lastLog:day(-4)
      },
      {
        name:'Empty Day Habit', type:'keepup', target:7,
        logs:[day(-2)],
        emoji:'📭', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], locationIds:['home'], durationMinutes:15, priority:3,
        createdAt:now - 5*86400000, lastLog:day(-2)
      }
    ]));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[A] normalizeLogs + planTingOnDay timed/location');
  const saveShape = await page.evaluate(() => {
    const data = load();
    const idx = data.findIndex(h => h.name === 'Timed Plan Habit');
    const key = todayIso();
    planTingOnDay(idx, key, '15:45', { openAction:false, locationId:'gym' });
    const after = load()[idx];
    const plan = normalizeLogs(after.logs).find(isPlanLog);
    const roundTrip = normalizeLogs([{ ts:plan.ts, plan:true, timed:true, locationId:'gym', junk:1 }])[0];
    const untimedOk = planTingOnDay(
      data.findIndex(h => h.name === 'Empty Day Habit'),
      key,
      '',
      { openAction:false }
    );
    const untimed = normalizeLogs(load().find(h => h.name === 'Empty Day Habit').logs).find(isPlanLog);
    return {
      timed: Boolean(plan && plan.timed),
      hours: new Date(plan.ts).getHours(),
      minutes: new Date(plan.ts).getMinutes(),
      locationId: plan && plan.locationId,
      roundTripTimed: Boolean(roundTrip && roundTrip.timed),
      roundTripLoc: roundTrip && roundTrip.locationId,
      roundTripJunk: roundTrip && Object.prototype.hasOwnProperty.call(roundTrip, 'junk'),
      untimedOk,
      untimedHasTimed: Boolean(untimed && untimed.timed),
      helpers: typeof timedPlanLogForDay === 'function' && typeof hasTimedPlanForDay === 'function'
    };
  });
  console.log(saveShape);
  assert(saveShape.helpers, 'timed plan helpers exist');
  assert(saveShape.timed, 'planTingOnDay with time sets timed');
  assert(saveShape.hours === 15 && saveShape.minutes === 45, 'plan clock is 15:45');
  assert(saveShape.locationId === 'gym', 'plan locationId is gym');
  assert(saveShape.roundTripTimed && saveShape.roundTripLoc === 'gym', 'normalizeLogs keeps timed + locationId');
  assert(!saveShape.roundTripJunk, 'normalizeLogs strips unknown plan fields');
  assert(saveShape.untimedOk && !saveShape.untimedHasTimed, 'empty time does not set timed');

  console.log('\n[B] timed plan is a hard scheduled agenda row');
  const agenda = await page.evaluate(() => {
    const data = load();
    const settings = loadSortSettings();
    const today = buildTodayAgenda(data, settings);
    const timeline = buildTodayTimeline(today);
    const rows = timeline.filter(r => r.kind === 'scheduled' && r.h && r.h.name === 'Timed Plan Habit');
    const fills = timeline.filter(r => r.kind === 'fill' && r.h && r.h.name === 'Timed Plan Habit');
    const start = rows[0] ? new Date(rows[0].start) : null;
    return {
      scheduledCount: rows.length,
      fillCount: fills.length,
      hour: start ? start.getHours() : null,
      minute: start ? start.getMinutes() : null,
      locationId: rows[0] ? rows[0].locationId : null,
      collect: collectScheduledAgendaEvents(data, todayIso(), settings)
        .filter(ev => ev.h.name === 'Timed Plan Habit')
        .map(ev => ({ fromTimedPlan: !!ev.fromTimedPlan, locationId: ev.locationId || null,
          hour: new Date(ev.eventTime).getHours(), minute: new Date(ev.eventTime).getMinutes() }))
    };
  });
  console.log(agenda);
  assert(agenda.scheduledCount === 1, 'timed plan appears once as scheduled');
  assert(agenda.fillCount === 0, 'timed plan is not also soft-filled');
  assert(agenda.hour === 15 && agenda.minute === 45, 'scheduled row starts at 15:45');
  assert(agenda.locationId === 'gym', 'scheduled row uses plan location');
  assert(agenda.collect.length === 1 && agenda.collect[0].fromTimedPlan, 'collectScheduledAgendaEvents includes timed plan');

  console.log('\n[C] movePlanTo preserves timed + locationId');
  const moved = await page.evaluate(() => {
    const data = load();
    const idx = data.findIndex(h => h.name === 'Timed Plan Habit');
    const fromKey = todayIso();
    const toBase = dayStart(Date.now()) + 86400000;
    const toKey = dateKey(toBase);
    movePlanTo(idx, fromKey, toKey);
    const plan = normalizeLogs(load()[idx].logs).find(log => isPlanLog(log) && dateKey(logTime(log)) === toKey);
    return {
      timed: Boolean(plan && plan.timed),
      locationId: plan && plan.locationId,
      hour: plan ? new Date(logTime(plan)).getHours() : null,
      minute: plan ? new Date(logTime(plan)).getMinutes() : null,
      day: plan ? dateKey(logTime(plan)) : null,
      toKey
    };
  });
  console.log(moved);
  assert(moved.timed && moved.locationId === 'gym', 'moved plan keeps timed + location');
  assert(moved.hour === 15 && moved.minute === 45, 'moved plan keeps clock');
  assert(moved.day === moved.toKey, 'moved plan lands on next day');

  console.log('\n[D] detail calendar unmarked day opens sheet (no auto-log)');
  const detailTap = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Empty Day Habit');
    const before = normalizeLogs(load()[idx].logs).filter(log => !isPlanLog(log)).length;
    openDetail(idx);
    const key = dateKey(dayStart(Date.now()) + 5 * 86400000);
    // Simulate detail-calendar tap handler: always open scoped day sheet.
    dayLogsKey = key;
    dayLogsScopeIndex = idx;
    dayLogsStep = 'item';
    dayLogsItemIndex = idx;
    dayLogsMoving = false;
    renderDayLogs(key);
    openSheet('day-logs-sheet');
    const after = normalizeLogs(load()[idx].logs).filter(log => !isPlanLog(log)).length;
    const body = document.getElementById('day-logs-body')?.innerText || '';
    return {
      before,
      after,
      sheetOpen: document.getElementById('day-logs-sheet')?.classList.contains('open'),
      hasLogAction: !!document.querySelector('[data-log-day-item]'),
      hasPlanAction: !!document.querySelector('#day-logs-plan'),
      hasLocationField: !!document.getElementById('day-log-location'),
      body
    };
  });
  console.log({
    before: detailTap.before,
    after: detailTap.after,
    sheetOpen: detailTap.sheetOpen,
    hasLogAction: detailTap.hasLogAction,
    hasPlanAction: detailTap.hasPlanAction
  });
  assert(detailTap.sheetOpen, 'detail day sheet opens');
  assert(detailTap.after === detailTap.before, 'unmarked day tap does not auto-log');
  assert(!detailTap.hasLogAction, 'scoped future sheet does not offer Log for this day');
  assert(detailTap.hasPlanAction, 'scoped sheet offers Plan this item');

  const addFields = await page.evaluate(() => {
    setDayLogsStep('add');
    return {
      hasTime: !!document.getElementById('day-log-time'),
      hasLocation: !!document.getElementById('day-log-location'),
      locationOptions: [...document.querySelectorAll('#day-log-location option')].map(o => o.value)
    };
  });
  assert(addFields.hasTime, 'add step has time input');
  assert(addFields.hasLocation, 'add step has location select when habit has places');
  assert(addFields.locationOptions.includes('home'), 'location select lists habit places');

  console.log('\n[E] untimed plan with location is honored on agenda');
  const untimedLoc = await page.evaluate(() => {
    const data = load();
    // Use the multi-location habit; preferred is home, plan forces gym without a time.
    const idx = data.findIndex(h => h.name === 'Timed Plan Habit');
    const h = data[idx];
    // Drop any leftover plans from earlier sections (moved to tomorrow, etc.).
    h.logs = normalizeLogs(h.logs).filter(log => !isPlanLog(log));
    save(data);
    const key = todayIso();
    planTingOnDay(idx, key, '', { openAction:false, locationId:'gym' });
    const plan = planLogForDay(load()[idx], key);
    const settings = loadSortSettings();
    const today = buildTodayAgenda(load(), settings);
    const timeline = buildTodayTimeline(today);
    const fills = timeline.filter(r => r.kind === 'fill' && r.h && r.h.name === 'Timed Plan Habit');
    const scheduled = timeline.filter(r => r.kind === 'scheduled' && r.h && r.h.name === 'Timed Plan Habit');
    return {
      helpers: typeof dayPlanLocationId === 'function' && typeof planLogForDay === 'function',
      savedLoc: plan && plan.locationId,
      timed: Boolean(plan && plan.timed),
      preferred: load()[idx].preferredLocationId || null,
      dayPlanLoc: dayPlanLocationId(load()[idx], key),
      fillCount: fills.length,
      fillLoc: fills[0] ? fills[0].locationId : null,
      scheduledCount: scheduled.length,
      meta: (()=>{
        dayLogsScopeIndex = null;
        const rows = collectDayLogRows(key);
        const row = rows.find(r => r.h.name === 'Timed Plan Habit');
        return row ? dayRowMeta(row) : '';
      })()
    };
  });
  console.log(untimedLoc);
  assert(untimedLoc.helpers, 'day plan location helpers exist');
  assert(untimedLoc.savedLoc === 'gym' && !untimedLoc.timed, 'untimed plan stores locationId');
  assert(untimedLoc.preferred === 'home', 'habit preferred location is home (not gym)');
  assert(untimedLoc.dayPlanLoc === 'gym', 'dayPlanLocationId reads untimed plan location');
  assert(untimedLoc.scheduledCount === 0, 'untimed plan is not a hard scheduled row');
  assert(untimedLoc.fillCount === 1, 'untimed plan appears as soft fill');
  assert(untimedLoc.fillLoc === 'gym', 'soft fill uses plan location over preferred');
  assert(/Gym/i.test(untimedLoc.meta), 'day meta shows untimed plan location');

  console.log('\n[F] past day rejects new plans; future day rejects logs');
  const dateGates = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Empty Day Habit');
    const pastKey = dateKey(dayStart(Date.now()) - 3 * 86400000);
    const futureKey = dateKey(dayStart(Date.now()) + 4 * 86400000);
    const pastPlan = planTingOnDay(idx, pastKey, '', { openAction:false, locationId:'home' });
    const futureLog = logTingAt(idx, new Date(`${futureKey}T12:00:00`).getTime());
    return { pastPlan, futureLog, canPlanPast: dayLogsCanPlan(pastKey), canLogFuture: dayLogsCanLog(futureKey) };
  });
  assert(!dateGates.pastPlan && !dateGates.canPlanPast, 'past days cannot take plans');
  assert(!dateGates.futureLog && !dateGates.canLogFuture, 'future days cannot take logs');

  if(pageErrors.length){
    console.error('page errors:', pageErrors.join('\n'));
    assert(false, 'no page errors');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail) process.exit(1);
  console.log('TIMED DAY PLAN TEST PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
