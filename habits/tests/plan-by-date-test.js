// One-off "plan by" date on rhythm habits (keepup/reduce).
//
// Covers the full surface of the planByDate feature:
//   - data layer: habitPlanByDate / endOfWeekDate / clearPlanByDateOnLog /
//     normalize (type stripping, day-clamping, garbage tolerance)
//   - scoring: todayCategory escalation on/after the deadline
//   - today agenda: includeInTodayAgenda, weekUrgency, isWeekCandidate bounds
//   - card presentation: cardCue countdown + cardMeta plan-by pill
//   - side effects: actual log clears it, plan log does NOT
//   - overview: buildDayTally marks the deadline day
//   - UI: the plan-by field lives on the calendar (month) page of the detail
//     sheet, not the schedule page; set/save/reopen round-trip; "this week"
//     and "clear" buttons; hidden for task/zero types
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/plan-by-date-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

const DAY = 86400000;
// Local-midnight timestamp `daysFromNow` days ahead (negative = past).
function dayStartOf(daysFromNow){
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysFromNow).getTime();
}

// Minimal clean-slate seed. One baseline habit so the app boots; the per-test
// habit(s) are pushed inside page.evaluate so timestamps are page-side.
function seedScript(){
  return `(function(){
    localStorage.removeItem('tings_v2');
    localStorage.removeItem('tings_app_settings_v2');
    const settings = {
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showWeekOnHome:true,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
    };
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'baseline', type:'keepup', target:7, logs:[Date.now()-2*86400000], durationMinutes:10, priority:2 }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // ════════════════════════════════════════════════════════════════════════
  // A. Data layer — habitPlanByDate / endOfWeekDate / clearPlanByDateOnLog
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[A] data layer — habitPlanByDate + endOfWeekDate + clearPlanByDateOnLog');
  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(200);
  const dataLayer = await page.evaluate(() => {
    const mk = (over) => Object.assign({
      name:'x', type:'keepup', target:7, logs:[], durationMinutes:10, priority:2,
      planByDate:null, dueDate:null, eventTime:null,
    }, over || {});
    const keepup = mk({ type:'keepup', planByDate:dayStart(Date.now() + 3*86400000) });
    const reduce = mk({ type:'reduce',  planByDate:dayStart(Date.now() + 3*86400000) });
    const zero   = mk({ type:'zero',    planByDate:dayStart(Date.now() + 3*86400000) });
    const task   = mk({ type:'task',    planByDate:dayStart(Date.now() + 3*86400000) });
    // endOfWeekDate: should land on the upcoming Sunday (or today if Sunday).
    const dow = new Date().getDay();
    const expectedEowOffset = dow === 0 ? 0 : 7 - dow;
    const eow = endOfWeekDate();
    // clearPlanByDateOnLog behaviour across types. For non-rhythm types it's
    // a no-op (leaves planByDate untouched) — normalize() is what strips it.
    const clearTs = dayStart(Date.now() + 3*86400000);
    const cleared = [keepup, reduce, zero, task].map(h => {
      const copy = JSON.parse(JSON.stringify(h));
      copy.planByDate = clearTs; // plant a value to detect no-op vs clear
      clearPlanByDateOnLog(copy);
      return { type:copy.type, planByDate:copy.planByDate };
    });
    return {
      habitPlanByDate: {
        keepup: habitPlanByDate(keepup),
        reduce: habitPlanByDate(reduce),
        zero:   habitPlanByDate(zero),
        task:   habitPlanByDate(task),
        nullInput: habitPlanByDate(null),
        emptyObj:  habitPlanByDate({}),
      },
      eow: {
        offset: Math.round((eow - dayStart(Date.now())) / 86400000),
        expected: expectedEowOffset,
        isMidnight: eow === dayStart(eow),
      },
      clearTs,
      cleared,
    };
  });
  console.log(dataLayer);
  assert(dataLayer.habitPlanByDate.keepup !== null, 'habitPlanByDate returns timestamp for keepup');
  assert(dataLayer.habitPlanByDate.reduce !== null, 'habitPlanByDate returns timestamp for reduce');
  assert(dataLayer.habitPlanByDate.zero === null, 'habitPlanByDate returns null for zero');
  assert(dataLayer.habitPlanByDate.task === null, 'habitPlanByDate returns null for task');
  assert(dataLayer.habitPlanByDate.nullInput === null, 'habitPlanByDate handles null input');
  assert(dataLayer.habitPlanByDate.emptyObj === null, 'habitPlanByDate handles empty object');
  assert(dataLayer.eow.offset === dataLayer.eow.expected, `endOfWeekDate is upcoming Sunday (offset ${dataLayer.eow.offset} vs ${dataLayer.eow.expected})`);
  assert(dataLayer.eow.isMidnight, 'endOfWeekDate lands on local midnight');
  assert(dataLayer.cleared.find(c => c.type === 'keepup').planByDate === null, 'clearPlanByDateOnLog clears keepup');
  assert(dataLayer.cleared.find(c => c.type === 'reduce').planByDate === null, 'clearPlanByDateOnLog clears reduce');
  assert(dataLayer.cleared.find(c => c.type === 'zero').planByDate === dataLayer.clearTs, 'clearPlanByDateOnLog is a safe no-op for zero (leaves field untouched)');
  assert(dataLayer.cleared.find(c => c.type === 'task').planByDate === dataLayer.clearTs, 'clearPlanByDateOnLog is a safe no-op for task (leaves field untouched)');

  // ════════════════════════════════════════════════════════════════════════
  // B. normalize — type stripping, day-clamping, garbage tolerance
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[B] normalize — type stripping, day-clamping, garbage tolerance');
  const normalized = await page.evaluate(() => {
    const raw = [
      { name:'keepup with planby', type:'keepup', planByDate:dayStart(Date.now()) + 1234567 }, // non-midnight
      { name:'reduce with planby', type:'reduce', planByDate:dayStart(Date.now() + 5*86400000) },
      { name:'zero with planby',   type:'zero',   planByDate:dayStart(Date.now() + 5*86400000) }, // must be stripped
      { name:'task with planby',   type:'task',   planByDate:dayStart(Date.now() + 5*86400000) }, // must be stripped
      { name:'keepup garbage nan', type:'keepup', planByDate:'not-a-number' },
      { name:'keepup garbage neg', type:'keepup', planByDate:-100 },
      { name:'keepup garbage huge',type:'keepup', planByDate:Date.now() + 100*365*86400000 }, // ~100y out
      { name:'keepup no planby',   type:'keepup' }, // absent → null
    ];
    const out = normalize(raw);
    return {
      keepupClamped: out[0].planByDate === dayStart(out[0].planByDate),
      reduceKept:    out[1].planByDate !== null,
      zeroStripped:  out[2].planByDate === null,
      taskStripped:  out[3].planByDate === null,
      nanNull:       out[4].planByDate === null,
      negNull:       out[5].planByDate === null,
      hugeNull:      out[6].planByDate === null,
      absentNull:    out[7].planByDate === null,
    };
  });
  console.log(normalized);
  assert(normalized.keepupClamped, 'normalize clamps planByDate to local midnight');
  assert(normalized.reduceKept, 'normalize keeps planByDate on reduce');
  assert(normalized.zeroStripped, 'normalize strips planByDate from zero type');
  assert(normalized.taskStripped, 'normalize strips planByDate from task type');
  assert(normalized.nanNull, 'normalize drops non-numeric planByDate');
  assert(normalized.negNull, 'normalize drops negative planByDate');
  assert(normalized.hugeNull, 'normalize drops absurdly-far-future planByDate');
  assert(normalized.absentNull, 'normalize defaults absent planByDate to null');

  // ════════════════════════════════════════════════════════════════════════
  // C. Scoring — todayCategory escalation on/after the deadline
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[C] scoring — todayCategory escalates on/after plan-by deadline');
  const scoring = await page.evaluate(() => {
    const settings = loadSortSettings();
    // target:30 + last log 5d ago → rhythm NOT due (5 < 30). plan-by is the only
    // thing that can pull this into the today/overdue bucket.
    const base = { name:'longhabit', type:'keepup', target:30, logs:[Date.now()-5*86400000], durationMinutes:10, priority:2, flexibilityDays:0 };
    const mk = (planByOffset) => {
      const h = Object.assign({}, base);
      h.planByDate = planByOffset === null ? null : dayStart(Date.now() + planByOffset*86400000);
      return normalize([h])[0];
    };
    const cat = (h) => todayCategory(h, settings);
    return {
      future:  cat(mk(5)),   // plan-by in 5 days → upcoming
      today:   cat(mk(0)),   // plan-by today → today (0)
      overdue: cat(mk(-2)),  // plan-by 2d ago → today/overdue
      none:    cat(mk(null)),// no plan-by, rhythm not due → upcoming
    };
  });
  console.log(scoring);
  assert(scoring.future === 2, `plan-by in future stays upcoming (cat 2, got ${scoring.future})`);
  assert(scoring.today === 0 || scoring.today === 1, `plan-by today escalates to today/overdue (cat 0|1, got ${scoring.today})`);
  assert(scoring.overdue === 0 || scoring.overdue === 1, `plan-by overdue escalates to today/overdue (cat 0|1, got ${scoring.overdue})`);
  assert(scoring.none === 2, `no plan-by and rhythm not due stays upcoming (cat 2, got ${scoring.none})`);

  // ════════════════════════════════════════════════════════════════════════
  // D. Today agenda — includeInTodayAgenda + weekUrgency
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[D] today agenda — includeInTodayAgenda + weekUrgency');
  const todayAg = await page.evaluate(() => {
    const settings = loadSortSettings();
    const mk = (over) => Object.assign({
      name:'ph', type:'keepup', target:30, logs:[Date.now()-5*86400000],
      durationMinutes:10, priority:2, flexibilityDays:0,
      allowedWeekdays:[], allowedMonthDays:[],
    }, over || {});
    const withPlan = (offset, overrides) => {
      const base = mk(offset !== null ? { planByDate:dayStart(Date.now()+offset*86400000) } : {});
      const h = Object.assign(base, overrides || {});
      return normalize([h])[0];
    };
    return {
      includeFuture:  includeInTodayAgenda(withPlan(5),  settings),
      includeToday:   includeInTodayAgenda(withPlan(0),  settings),
      includeOverdue: includeInTodayAgenda(withPlan(-3), settings),
      includeNone:    includeInTodayAgenda(withPlan(null),settings),
      urgencyFuture3: weekUrgency(withPlan(3)),
      urgencyFuture1: weekUrgency(withPlan(1)),
      urgencyToday:   weekUrgency(withPlan(0)),
      urgencyOverdue: weekUrgency(withPlan(-2)),
      // A habit whose allowedWeekdays excludes today shouldn't be in today's
      // agenda even when plan-by is today.
      wrongDay: (() => {
        const todayDow = new Date().getDay();
        const otherDow = (todayDow + 1) % 7;
        return includeInTodayAgenda(withPlan(0, { allowedWeekdays:[otherDow] }), settings);
      })(),
    };
  });
  console.log(todayAg);
  assert(todayAg.includeFuture === false, 'plan-by future NOT in today agenda');
  assert(todayAg.includeToday === true, 'plan-by today included in today agenda');
  assert(todayAg.includeOverdue === true, 'plan-by overdue included in today agenda');
  assert(todayAg.includeNone === false, 'no plan-by and rhythm not due NOT in today agenda');
  assert(todayAg.urgencyToday > todayAg.urgencyFuture3, 'weekUrgency(today) > weekUrgency(future)');
  assert(todayAg.urgencyOverdue >= todayAg.urgencyToday, 'weekUrgency(overdue) >= weekUrgency(today)');
  assert(todayAg.urgencyFuture1 > todayAg.urgencyFuture3, 'weekUrgency(1d) > weekUrgency(3d)');
  assert(todayAg.wrongDay === false, 'plan-by today but weekday-excluded NOT in today agenda');

  // ════════════════════════════════════════════════════════════════════════
  // E. Week planner — isWeekCandidate bounds (overdue / today / future)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[E] week planner — isWeekCandidate bounds');
  const weekCand = await page.evaluate(() => {
    const settings = loadSortSettings();
    const mk = (planByOffset) => normalize([Object.assign({
      name:'ph', type:'keepup', target:30, logs:[Date.now()-5*86400000],
      durationMinutes:10, priority:2, flexibilityDays:0,
      planByDate: dayStart(Date.now() + planByOffset*86400000),
    })])[0];
    const todayBase = dayStart(Date.now());
    const dayBase = (offset) => todayBase + offset*86400000;
    const weekday = (offset) => new Date(dayBase(offset)).getDay();
    const elig = (h, offset) => isWeekCandidate(h, settings, dayBase(offset), weekday(offset));
    const past = mk(-2);
    const todayPlan = mk(0);
    const future = mk(3); // deadline 3 days out
    return {
      // Overdue: any day in the week window is a candidate.
      overdueYesterday: elig(past, -1),
      overdueToday:     elig(past, 0),
      overdueLater:     elig(past, 4),
      // Plan-by today: only today, not later days.
      planToday:        elig(todayPlan, 0),
      planTodayNext:    elig(todayPlan, 1),
      // Plan-by in 3 days: today through day 3 only.
      futureToday:      elig(future, 0),
      futureDay2:       elig(future, 2),
      futureDay3:       elig(future, 3),
      futureDay4:       elig(future, 4), // past deadline → no
    };
  });
  console.log(weekCand);
  assert(weekCand.overdueToday === true, 'overdue plan-by eligible today');
  assert(weekCand.overdueLater === true, 'overdue plan-by eligible on a later day');
  assert(weekCand.planToday === true, 'plan-by-today eligible today');
  assert(weekCand.planTodayNext === false, 'plan-by-today NOT eligible tomorrow (past deadline)');
  assert(weekCand.futureToday === true, 'plan-by-future eligible today');
  assert(weekCand.futureDay2 === true, 'plan-by-future eligible mid-window');
  assert(weekCand.futureDay3 === true, 'plan-by-future eligible on deadline day');
  assert(weekCand.futureDay4 === false, 'plan-by-future NOT eligible past deadline');

  // ════════════════════════════════════════════════════════════════════════
  // F. Card presentation — cardCue countdown + cardMeta plan-by pill
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[F] card presentation — cardCue + cardMeta plan-by pill');
  const card = await page.evaluate(() => {
    const settings = loadSortSettings();
    const mk = (planByOffset, over) => normalize([Object.assign({
      name:'ph', type:'keepup', target:30, logs:[Date.now()-5*86400000],
      durationMinutes:10, priority:2, flexibilityDays:0,
      planByDate: planByOffset === null ? null : dayStart(Date.now() + planByOffset*86400000),
    }, over || {})])[0];
    return {
      cueOverdue: cardCue(mk(-2)),
      cueToday:   cardCue(mk(0)),
      cueTomorrow:cardCue(mk(1)),
      cue3day:    cardCue(mk(3)),
      cue10day:   cardCue(mk(10)),
      cueNone:    cardCue(mk(null)),
      metaHasPill:  cardMeta(mk(0)).includes('context-pill due'),
      metaNoRhythm: !/ti-repeat/.test(cardMeta(mk(0))),
      metaRhythmWhenNoPlan: /ti-repeat/.test(cardMeta(mk(null))),
    };
  });
  console.log(card);
  assert(/plan by/i.test(card.cueOverdue) && /overdue/i.test(card.cueOverdue), `overdue cue says "plan by … overdue" (got "${card.cueOverdue}")`);
  assert(/plan by today/i.test(card.cueToday), `today cue says "plan by today" (got "${card.cueToday}")`);
  assert(/plan by tomorrow/i.test(card.cueTomorrow), `tomorrow cue says "plan by tomorrow" (got "${card.cueTomorrow}")`);
  assert(/plan by in 3d/i.test(card.cue3day), `3-day cue says "plan by in 3d" (got "${card.cue3day}")`);
  assert(/plan by/i.test(card.cue10day), `10-day cue mentions plan by (got "${card.cue10day}")`);
  assert(!/plan by/i.test(card.cueNone), `no-plan cue does not mention plan by (got "${card.cueNone}")`);
  assert(card.metaHasPill, 'cardMeta renders a "due"-style pill for plan-by');
  assert(card.metaNoRhythm, 'cardMeta hides the rhythm pill when plan-by is set');
  assert(card.metaRhythmWhenNoPlan, 'cardMeta shows rhythm pill when no plan-by is set');

  // ════════════════════════════════════════════════════════════════════════
  // G. Logging clears planByDate — actual log yes, future plan log NO
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[G] logging — actual log clears planByDate, plan log does NOT');
  const logBehavior = await page.evaluate(() => {
    // Seed two habits with plan-by today.
    save([
      { name:'actual',  type:'keepup', target:30, logs:[Date.now()-5*86400000], durationMinutes:10, priority:2, planByDate:dayStart(Date.now()) },
      { name:'planned', type:'keepup', target:30, logs:[Date.now()-5*86400000], durationMinutes:10, priority:2, planByDate:dayStart(Date.now()) },
    ]);
    const data = load();
    const iActual  = data.findIndex(h => h.name === 'actual');
    const iPlanned = data.findIndex(h => h.name === 'planned');
    // Actual log now.
    logTing(iActual);
    // Plan log for 4 days from now.
    const futureTs = dayStart(Date.now()) + 4*86400000 + 10*3600000;
    logTingAt(iPlanned, futureTs);
    const after = load();
    return {
      actualPlanBy:  after.find(h => h.name === 'actual').planByDate,
      actualLastLog: after.find(h => h.name === 'actual').lastLog,
      plannedPlanBy: after.find(h => h.name === 'planned').planByDate,
      plannedHasFuturePlan: plannedLogs(after.find(h => h.name === 'planned').logs).includes(futureTs),
    };
  });
  console.log(logBehavior);
  assert(logBehavior.actualPlanBy === null, 'actual log clears planByDate');
  assert(logBehavior.actualLastLog !== null, 'actual log sets lastLog');
  assert(logBehavior.plannedPlanBy !== null, 'plan log does NOT clear planByDate');
  assert(logBehavior.plannedHasFuturePlan, 'plan log adds a future planned entry');

  // ════════════════════════════════════════════════════════════════════════
  // H. reduce type behaves the same as keepup
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[H] reduce type — plan-by behaves the same as keepup');
  const reduceCase = await page.evaluate(() => {
    const settings = loadSortSettings();
    const h = normalize([{
      name:'limit', type:'reduce', target:7, logs:[Date.now()-2*86400000],
      durationMinutes:10, priority:2, flexibilityDays:0,
      planByDate: dayStart(Date.now()),
    }])[0];
    return {
      planBy: habitPlanByDate(h),
      cat: todayCategory(h, settings),
      include: includeInTodayAgenda(h, settings),
      cue: /plan by/i.test(cardCue(h)),
    };
  });
  console.log(reduceCase);
  assert(reduceCase.planBy !== null, 'habitPlanByDate works on reduce');
  assert(reduceCase.cat === 0 || reduceCase.cat === 1, 'reduce with plan-by today escalates category');
  assert(reduceCase.include === true, 'reduce with plan-by today included in today agenda');
  assert(reduceCase.cue === true, 'reduce card cue mentions plan by');

  // ════════════════════════════════════════════════════════════════════════
  // I. Overview day tally — plan-by marks the deadline day
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[I] overview — buildDayTally marks the plan-by day');
  const tally = await page.evaluate(() => {
    const planBy = dayStart(Date.now() + 4*86400000);
    save([{ name:'tallyhabit', type:'keepup', target:30, logs:[], durationMinutes:10, priority:2, planByDate:planBy }]);
    const data = load();
    const tally = buildDayTally(data, () => true); // include all days
    const key = dateKey(planBy);
    const entries = tally.map.get(key) || [];
    return {
      plannedCount: tally.planned,
      keyPresent: tally.map.has(key),
      entryScheduled: entries.some(e => e.scheduled && e.planned && e.name === 'tallyhabit'),
    };
  });
  console.log(tally);
  assert(tally.plannedCount >= 1, 'buildDayTally counts the plan-by entry as planned');
  assert(tally.keyPresent, 'plan-by day is present in the tally map');
  assert(tally.entryScheduled, 'plan-by entry is tagged planned+scheduled');

  // ════════════════════════════════════════════════════════════════════════
  // J. UI flow — plan-by field on the calendar page, round-trip, buttons
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[J] UI — plan-by lives on calendar page; set/save/reopen; this-week + clear');
  // Seed a clean keepup habit and open its detail sheet.
  await page.evaluate(() => {
    save([{ name:'uihabit', type:'keepup', target:7, logs:[Date.now()-3*86400000], durationMinutes:15, priority:2, planByDate:null }]);
  });
  await page.evaluate(() => { if(typeof render === 'function')render(); });
  await page.waitForTimeout(150);
  // Open detail for 'uihabit' directly via the global helper (reliable across
  // layouts — DOM card clicks are flaky when the sheet is already open).
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'uihabit');
    openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(150);

  const uiSetup = await page.evaluate(() => {
    const row = document.getElementById('detail-plan-by-row');
    return {
      rowVisible: row && !row.hidden,
      rowInMonthPage: row ? !!row.closest('.month-card') : false,
      rowNotInSchedulePage: row ? !row.closest('.tune-section') : false,
      inputExists: !!document.getElementById('detail-plan-by-date'),
      weekBtnExists: !!document.getElementById('detail-plan-by-week'),
      clearBtnExists: !!document.getElementById('detail-plan-by-clear'),
      hintInMonthPage: document.getElementById('detail-plan-by-hint') ? !!document.getElementById('detail-plan-by-hint').closest('.month-card') : false,
    };
  });
  console.log(uiSetup);
  assert(uiSetup.rowVisible, 'plan-by row visible for keepup habit');
  assert(uiSetup.rowInMonthPage, 'plan-by row lives on the calendar (month) page');
  assert(uiSetup.rowNotInSchedulePage, 'plan-by row NOT on the schedule page');
  assert(uiSetup.inputExists, 'plan-by date input present');
  assert(uiSetup.weekBtnExists, '"this week" button present');
  assert(uiSetup.clearBtnExists, '"clear" button present');
  assert(uiSetup.hintInMonthPage, 'plan-by hint on the month page');

  // Click "this week" → input gets end-of-week value → save → reopen → persisted.
  const targetEow = await page.evaluate(() => endOfWeekDate());
  await page.locator('#detail-plan-by-week').click();
  await page.waitForTimeout(80);
  const eowValue = await page.locator('#detail-plan-by-date').inputValue();
  await page.locator('#detail-save').click();
  await page.waitForTimeout(150);
  // Re-open and confirm persistence.
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'uihabit');
    openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(120);
  const persisted = await page.evaluate(() => {
    const h = load().find(x => x.name === 'uihabit');
    return {
      storedPlanBy: h ? h.planByDate : 'missing',
      inputValue: document.getElementById('detail-plan-by-date').value,
      clearBtnVisible: !document.getElementById('detail-plan-by-clear').hidden,
      weekBtnHidden: document.getElementById('detail-plan-by-week').hidden,
    };
  });
  console.log({ targetEow, eowValue, persisted });
  assert(persisted.storedPlanBy === targetEow, `"this week" persists planByDate as end-of-week (${targetEow})`);
  assert(persisted.clearBtnVisible && persisted.weekBtnHidden, 'clear button shown + this-week button hidden once a date is set');

  // Now click "clear" → save → reopen → null.
  await page.locator('#detail-plan-by-clear').click();
  await page.waitForTimeout(80);
  await page.locator('#detail-save').click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'uihabit');
    openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(120);
  const cleared = await page.evaluate(() => {
    const h = load().find(x => x.name === 'uihabit');
    return { storedPlanBy: h ? h.planByDate : 'missing', inputValue: document.getElementById('detail-plan-by-date').value };
  });
  console.log(cleared);
  assert(cleared.storedPlanBy === null, '"clear" persists planByDate as null');
  assert(cleared.inputValue === '', 'input cleared after clear-and-save');
  await page.evaluate(() => closeDetail());
  await page.waitForTimeout(120);

  // ════════════════════════════════════════════════════════════════════════
  // K. UI — plan-by row hidden for task and zero types
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[K] UI — plan-by row hidden for task and zero types');
  for(const [typeName, seed] of [
    ['task', { name:'uitask', type:'task', dueDate:dayStartOf(2), durationMinutes:15, priority:2 }],
    ['zero', { name:'uistop', type:'zero', logs:[Date.now()-3*86400000], durationMinutes:15, priority:2 }],
  ]){
    await page.evaluate((s) => {
      const data = load().filter(h => h.name !== s.name);
      data.push(s);
      save(data);
    }, seed);
    await page.evaluate(() => { if(typeof render === 'function')render(); });
    await page.waitForTimeout(150);
    const result = await page.evaluate((nm) => {
      const idx = load().findIndex(h => h.name === nm);
      openDetail(idx);
      return {
        type: load()[idx].type,
        rowHidden: document.getElementById('detail-plan-by-row').hidden,
        rowStillInMonthPage: !!document.getElementById('detail-plan-by-row').closest('.month-card'),
      };
    }, seed.name);
    await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
    await page.waitForTimeout(120);
    console.log(`  ${typeName}: ${JSON.stringify(result)}`);
    assert(result.rowHidden === true, `plan-by row hidden for ${typeName} type`);
    assert(result.rowStillInMonthPage === true, `${typeName} plan-by row still in month-card page (just hidden)`);
    await page.evaluate(() => closeDetail());
    await page.waitForTimeout(120);
  }

  // ════════════════════════════════════════════════════════════════════════
  // L. Calendar marker — plan-by day shows as a planned dot in the detail month
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[L] detail calendar — plan-by day rendered as a planned marker');
  const marker = await page.evaluate(() => {
    // Plan-by ~10 days out so it falls inside the visible month.
    const planBy = dayStart(Date.now() + 10*86400000);
    const data = load().filter(h => h.name !== 'markerhabit');
    data.push({ name:'markerhabit', type:'keepup', target:60, logs:[], durationMinutes:10, priority:2, planByDate:planBy });
    save(data);
    const idx = load().findIndex(h => h.name === 'markerhabit');
    openDetail(idx);
    return { planBy, key:dateKey(planBy), month: new Date(planBy).getMonth(), year:new Date(planBy).getFullYear() };
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(150);
  // If the marker fell outside the current month frame, navigate forward.
  await page.evaluate((target) => {
    // Walk detailMonthOffset forward until the plan-by month is in frame.
    for(let guard = 0; guard < 13; guard += 1){
      const cur = new Date();
      const offset = typeof detailMonthOffset === 'number' ? detailMonthOffset : 0;
      const framed = new Date(cur.getFullYear(), cur.getMonth() + offset, 1);
      if(framed.getFullYear() === target.year && framed.getMonth() === target.month)return;
      const btn = document.getElementById('detail-next-month');
      if(btn)btn.click();
    }
  }, marker);
  await page.waitForTimeout(150);
  const dayCell = await page.evaluate((key) => {
    const cells = [...document.querySelectorAll('#detail-calendar .cal-day')];
    const cell = cells.find(c => c.dataset && c.dataset.entryDay === key);
    if(!cell)return { found:false };
    const planDot = cell.querySelector('.cal-dot.plan');
    return {
      found:true,
      hasEntry: cell.classList.contains('has-entry'),
      hasPlanDot: !!planDot,
    };
  }, marker.key);
  console.log({ marker, dayCell });
  // The marker only lands in-frame if the plan-by month is reachable; when it is,
  // the day cell must carry a planned marker dot.
  if(dayCell.found){
    assert(dayCell.hasEntry, 'plan-by day marked as having an entry in the detail calendar');
    assert(dayCell.hasPlanDot, 'plan-by day has a planned-tone dot in the detail calendar');
  }else{
    console.log('  (skip: plan-by day outside reachable month frame)');
  }
  await page.evaluate(() => closeDetail());
  await page.waitForTimeout(100);

  // ════════════════════════════════════════════════════════════════════════
  // M. Boot cleanliness
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[M] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
