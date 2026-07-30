// Timer + home session progress regressions (scenario tree coverage).
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/timer-session-test.js
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
    const day = (n) => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
    };
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{},
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showWeekOnHome:false, agendaOptimizer:false,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
    }));
    localStorage.setItem('tings_v2', JSON.stringify([
      {
        name:'Walk timer', hid:'timer-walk', type:'keepup', target:1,
        logs:[], emoji:'🚶', pinned:true, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:30, priority:2,
        breakable:false, autoMarkMinutes:null, timerAutoStopMinutes:30,
        createdAt:Date.now() - 86400000, lastLog:null
      },
      {
        name:'Auto task', hid:'timer-auto', type:'task', target:null,
        logs:[], emoji:'✅', pinned:false, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:15, priority:2,
        dueDate: day(0), hardDue:false, eventTime: Date.now() - 5*60000,
        autoMarkMinutes:20, breakable:false,
        createdAt:Date.now() - 86400000, lastLog:null
      },
      {
        name:'Done task', hid:'timer-done', type:'task', target:null,
        logs:[{ts:Date.now() - 3600000}], emoji:'✔️', pinned:false, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:15, priority:2,
        dueDate: day(0), hardDue:false, eventTime:null,
        autoMarkMinutes:null, breakable:false,
        createdAt:Date.now() - 86400000, lastLog:Date.now() - 3600000
      },
      {
        name:'Quit habit', hid:'timer-quit', type:'zero', target:7,
        logs:[], emoji:'🚭', pinned:false, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:5, priority:2,
        breakable:false, autoMarkMinutes:null,
        createdAt:Date.now() - 86400000, lastLog:null
      },
      {
        name:'Breakable report', hid:'timer-report', type:'task', target:null,
        logs:[{ts:Date.now() - 7200000, minutes:30}], emoji:'📝', pinned:true, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:90, priority:2, minChunkMinutes:15,
        dueDate: day(0), hardDue:false, eventTime:null,
        autoMarkMinutes:null, breakable:true,
        createdAt:Date.now() - 86400000, lastLog:Date.now() - 7200000
      },
      {
        name:'Breakable build', hid:'timer-build', type:'keepup', target:1,
        logs:[], emoji:'🧱', pinned:true, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:60, priority:2, minChunkMinutes:15,
        breakable:true, autoMarkMinutes:null, timerAutoStopMinutes:45,
        createdAt:Date.now() - 86400000, lastLog:null
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
  await page.waitForTimeout(500);

  console.log('\n[A] startHabitTimer + home session bar');
  const started = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Walk timer');
    const ok = startHabitTimer(idx);
    const card = document.querySelector(`.ting-card[data-real="${idx}"]`);
    const info = card?.querySelector('.ting-info');
    const cue = card?.querySelector('.ting-cue');
    const bar = card?.querySelector('[data-session-progress]');
    const cueRect = cue?.getBoundingClientRect();
    const barRect = bar?.getBoundingClientRect();
    const overlap = cueRect && barRect
      ? !(barRect.top >= cueRect.bottom - 1 || cueRect.top >= barRect.bottom - 1)
      : false;
    return {
      ok,
      running: Boolean(habitTimer && habitTimer.idx === idx),
      habitHid:load()[idx]?.hid || null,
      doingHid: getDoingNow()?.hid || null,
      bar: !!bar,
      hasSessionClass: info?.classList.contains('has-session-progress') || false,
      hasBreakableClass: info?.classList.contains('has-breakable-progress') || false,
      overlap,
      timerBtn: [...document.querySelectorAll('[data-action="timer"]')].map(b => b.getAttribute('aria-label')),
      label: document.querySelector(`.ting-card[data-real="${idx}"] .session-progress-label`)?.textContent || '',
    };
  });
  console.log(started);
  assert(started.ok && started.running, 'startHabitTimer starts global timer');
  assert(started.doingHid === started.habitHid, 'timer and doing-now share the same active habit');
  assert(started.bar, 'home card shows session progress bar while timer runs');
  assert(started.hasSessionClass && !started.hasBreakableClass, 'session cards use has-session-progress, not breakable grid');
  assert(!started.overlap, 'session bar does not overlap cue text');
  assert(started.timerBtn.some(a => /stop session/i.test(a)), 'swipe exposes stop session while running');
  assert(/now · \d+m left/.test(started.label), 'session label uses the unified doing-now countdown');

  const exclusive = await page.evaluate(() => {
    const otherIdx = load().findIndex(h => h.name === 'Breakable build');
    const blocked = startHabitTimer(otherIdx);
    return {
      blocked,
      timerName:load()[habitTimer?.idx]?.name || null,
      doingName:load().find(h=>h.hid === getDoingNow()?.hid)?.name || null
    };
  });
  assert(!exclusive.blocked && exclusive.timerName === 'Walk timer' && exclusive.doingName === 'Walk timer',
    'another timer cannot start while a different habit owns the active session');

  const doingExclusive = await page.evaluate(() => {
    clearHabitTimerSilent();
    const data = load();
    const walkIdx = data.findIndex(h=>h.name === 'Walk timer');
    const build = data.find(h=>h.name === 'Breakable build');
    setDoingNow(build.hid,Date.now(),dayStart(Date.now()),{sessionMinutes:45});
    const blocked = startHabitTimer(walkIdx);
    const owner = load().find(h=>h.hid === getDoingNow()?.hid);
    clearDoingNow();
    return {blocked,owner:owner?.name || null};
  });
  assert(!doingExclusive.blocked && doingExclusive.owner === 'Breakable build',
    'a timer cannot start for a different habit while doing-now is active');

  console.log('\n[A4] done task / zero ineligible');
  const a4 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const doneIdx = load().findIndex(h => h.name === 'Done task');
    const zeroIdx = load().findIndex(h => h.name === 'Quit habit');
    const doneH = load()[doneIdx];
    const zeroH = load()[zeroIdx];
    return {
      doneEligible: habitTimerEligible(doneH),
      zeroEligible: habitTimerEligible(zeroH),
      doneStart: startHabitTimer(doneIdx),
      zeroStart: startHabitTimer(zeroIdx),
      doneSwipe: !!document.querySelector(`.swipe-row[data-real-idx="${doneIdx}"] [data-action="timer"]`),
      zeroSwipe: !!document.querySelector(`.swipe-row[data-real-idx="${zeroIdx}"] [data-action="timer"]`),
    };
  });
  console.log(a4);
  assert(!a4.doneEligible && !a4.doneStart && !a4.doneSwipe, 'done task cannot start timer / no swipe');
  assert(!a4.zeroEligible && !a4.zeroStart && !a4.zeroSwipe, 'zero habit cannot start timer / no swipe');

  console.log('\n[A6] breakable crown card still shows timer bar while running');
  const a6 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Breakable build');
    const ok = startHabitTimer(idx);
    if(typeof render === 'function')render();
    const card = document.querySelector(`.ting-card[data-real="${idx}"]`);
    return {
      ok,
      breakable: card?.classList.contains('breakable-card') || false,
      crown: !!card?.querySelector('.breakable-progress'),
      bar: !!card?.querySelector('[data-session-progress]'),
      isTimer: card?.querySelector('[data-session-progress]')?.classList.contains('is-timer') || false,
    };
  });
  console.log(a6);
  assert(a6.ok && a6.breakable && a6.crown, 'breakable card shows crown while timing');
  assert(a6.bar && a6.isTimer, 'breakable card also shows timer session bar');

  console.log('\n[A7] partial breakable task stays eligible');
  const a7 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Breakable report');
    const h = load()[idx];
    const rem = remainingDurationMinutes(h);
    const eligible = habitTimerEligible(h);
    const ok = startHabitTimer(idx);
    return {
      lastLog: h.lastLog !== null,
      rem,
      done: isTaskDone(h),
      eligible,
      ok,
      running: Boolean(habitTimer && habitTimer.idx === idx),
    };
  });
  console.log(a7);
  assert(a7.lastLog && a7.rem > 0 && !a7.done, 'partial breakable task has remaining minutes');
  assert(a7.eligible && a7.ok && a7.running, 'partial breakable task can start timer');

  console.log('\n[B] auto-stop logs minutes for non-breakable');
  const autoStop = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Walk timer');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    save(data);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 2 * 60000;
    habitTimer.autoStopMs = 1000;
    tickHabitTimer();
    const h = load()[idx];
    const last = normalizeLogs(h.logs).slice(-1)[0];
    const minutes = last && typeof last === 'object' ? last.minutes : null;
    return {
      timerGone: !habitTimer,
      lastLog: h.lastLog !== null,
      minutes,
      log: last,
    };
  });
  console.log(autoStop);
  assert(autoStop.timerGone && autoStop.lastLog, 'auto-stop clears timer and logs habit');
  assert(autoStop.minutes >= 1, 'auto-stop stores session minutes on non-breakable');

  console.log('\n[B3] logTingAt clears running timer');
  const b3 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Walk timer');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    save(data);
    startHabitTimer(idx);
    logTingAt(idx, Date.now() - 3600000);
    return { timerGone: !habitTimer, lastLog: load()[idx].lastLog !== null };
  });
  console.log(b3);
  assert(b3.timerGone && b3.lastLog, 'logTingAt clears timer and logs');

  console.log('\n[B4/F3] sweep completing task clears timer immediately');
  const b4 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Auto task');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    data[idx].eventTime = Date.now() - 60 * 60000;
    data[idx].autoMarkMinutes = 5;
    save(data);
    startHabitTimer(idx);
    const startedAt = Date.now() - 6 * 60000;
    setDoingNow(data[idx].hid,startedAt,dayStart(Date.now()),{
      sessionMinutes:5,
      endsAt:startedAt + 5 * 60000,
      oneShotAutoMark:true
    });
    habitTimer.startedAt = startedAt;
    habitTimer.autoStopMs = 5 * 60000;
    const swept = sweepAutoDoneTasks();
    return {
      swept,
      timerGone: !habitTimer,
      done: isTaskDone(load()[idx]),
      sheetOpen: document.getElementById('value-log-sheet')?.classList.contains('open') || false,
    };
  });
  console.log(b4);
  assert(b4.swept >= 1 && b4.done, 'sweep auto-completes pending task');
  assert(b4.timerGone && !b4.sheetOpen, 'sweep clears timer without opening session sheet');

  console.log('\n[B7] nuke clears timer for deleted habit');
  const b7 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Walk timer');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    save(data);
    startHabitTimer(idx);
    doNuke(idx);
    return {
      timerGone: !habitTimer,
      removed: load().findIndex(h => h.name === 'Walk timer') < 0,
    };
  });
  console.log(b7);
  assert(b7.removed && b7.timerGone, 'nuke removes habit and clears its timer');

  console.log('\n[C] pending auto-complete bar on task');
  const autoBar = await page.evaluate(() => {
    // Re-seed auto task if nuked walk shifted indices — find by name or recreate
    let idx = load().findIndex(h => h.name === 'Auto task');
    if(idx < 0){
      const data = load();
      data.push({
        name:'Auto task', type:'task', target:null,
        logs:[], emoji:'✅', pinned:false, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:15, priority:2,
        dueDate: Date.now(), hardDue:false, eventTime: Date.now() - 5*60000,
        autoMarkMinutes:20, breakable:false,
        createdAt:Date.now() - 86400000, lastLog:null
      });
      save(data);
      idx = data.length - 1;
    }
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    data[idx].eventTime = Date.now() - 5*60000;
    data[idx].autoMarkMinutes = 20;
    save(data);
    if(typeof render === 'function')render();
    const h = load()[idx];
    const win = pendingAutoMarkWindow(h);
    const el = document.querySelector(`.ting-card[data-real="${idx}"] [data-session-progress]`);
    return {
      hasWindow: Boolean(win),
      bar: !!el,
      isAuto: el?.classList.contains('is-auto') || false,
      label: el?.querySelector('.session-progress-label')?.textContent || '',
    };
  });
  console.log(autoBar);
  assert(autoBar.hasWindow, 'pending auto-mark window exists for due task');
  assert(autoBar.bar && autoBar.isAuto, 'home card shows auto-complete progress bar');
  assert(/auto in \d+m/i.test(autoBar.label), 'auto bar label shows time remaining');

  console.log('\n[C5] manual stop stores capped timerSessionMinutes');
  const c5 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Breakable report');
    const data = load();
    // Ensure partial: 30 of 90 done
    data[idx].logs = [{ts:Date.now() - 7200000, minutes:30}];
    data[idx].lastLog = data[idx].logs[0].ts;
    save(data);
    const rem = remainingDurationMinutes(load()[idx]);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 120 * 60000; // 120m elapsed > remaining
    stopHabitTimer(true, true);
    return {
      rem,
      sheetMinutes: valueLogMinutes,
      sheetOpen: document.getElementById('value-log-sheet')?.classList.contains('open') || false,
    };
  });
  console.log(c5);
  assert(c5.sheetOpen && c5.sheetMinutes === c5.rem, 'session sheet minutes capped to remaining for breakable');

  console.log('\n[D] manual stop still opens session sheet');
  const manual = await page.evaluate(() => {
    document.getElementById('value-log-cancel')?.click();
    if(habitTimer)clearHabitTimerSilent();
    let idx = load().findIndex(h => h.name === 'Walk timer');
    if(idx < 0){
      const data = load();
      data.unshift({
        name:'Walk timer', type:'keepup', target:1,
        logs:[], emoji:'🚶', pinned:true, sample:false, snoozedUntil:null,
        topics:[], locationIds:[], durationMinutes:30, priority:2,
        breakable:false, autoMarkMinutes:null, timerAutoStopMinutes:30,
        createdAt:Date.now() - 86400000, lastLog:null
      });
      save(data);
      idx = 0;
      if(typeof render === 'function')render();
    }
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    save(data);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 3 * 60000;
    stopHabitTimer(true, true);
    return {
      sheet: document.getElementById('value-log-sheet')?.classList.contains('open') || false,
      timerGone: !habitTimer,
      minutes: valueLogMinutes,
    };
  });
  console.log(manual);
  assert(manual.timerGone && manual.sheet, 'manual stop opens session confirm sheet');
  assert(manual.minutes === 3, 'manual stop session minutes match elapsed');

  console.log('\n[D3] finishValueLog no-ops if task already done');
  const d3 = await page.evaluate(() => {
    document.getElementById('value-log-cancel')?.click();
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Auto task');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    data[idx].eventTime = Date.now() - 5*60000;
    data[idx].autoMarkMinutes = 20;
    save(data);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 2 * 60000;
    stopHabitTimer(true, true);
    // Complete via direct log while sheet open
    const before = normalizeLogs(load()[idx].logs).length;
    logTing(idx, {});
    const mid = normalizeLogs(load()[idx].logs).length;
    // Stale confirm Log should not add another entry
    document.getElementById('value-log-save')?.click();
    const after = normalizeLogs(load()[idx].logs).length;
    return {
      before,
      mid,
      after,
      sheetOpen: document.getElementById('value-log-sheet')?.classList.contains('open') || false,
      done: isTaskDone(load()[idx]),
    };
  });
  console.log(d3);
  assert(d3.mid === d3.before + 1 && d3.after === d3.mid, 'stale session Log does not double-entry');
  assert(d3.done && !d3.sheetOpen, 'task done and sheet closed after race');

  console.log('\n[D4] value-log blocked while session confirm open');
  const d4 = await page.evaluate(() => {
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Breakable report');
    const data = load();
    data[idx].logs = [{ts:Date.now() - 7200000, minutes:30}];
    data[idx].lastLog = data[idx].logs[0].ts;
    data[idx].trackValue = true;
    save(data);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 5 * 60000;
    stopHabitTimer(true, true);
    const sessionOpen = valueLogMinutes != null;
    const otherIdx = load().findIndex(h => h.name === 'Auto task');
    // Attempt plain value prompt while session open
    openValueLogSheet(otherIdx, null, null);
    return {
      sessionOpen,
      stillSession: valueLogMinutes != null,
      stillIdx: valueLogIdx === idx,
    };
  });
  console.log(d4);
  assert(d4.sessionOpen && d4.stillSession && d4.stillIdx, 'session confirm not overwritten by value prompt');

  console.log('\n[E] discard restores auto bar on auto-mark task (no log)');
  const discard = await page.evaluate(() => {
    document.getElementById('value-log-cancel')?.click();
    if(habitTimer)clearHabitTimerSilent();
    const idx = load().findIndex(h => h.name === 'Auto task');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    data[idx].eventTime = Date.now() - 5*60000;
    data[idx].autoMarkMinutes = 20;
    data[idx].trackValue = false;
    save(data);
    startHabitTimer(idx);
    habitTimer.startedAt = Date.now() - 2 * 60000;
    stopHabitTimer(true, true);
    const beforeLogs = normalizeLogs(load()[idx].logs).length;
    document.getElementById('value-log-cancel')?.click();
    const h = load()[idx];
    const el = document.querySelector(`.ting-card[data-real="${idx}"] [data-session-progress]`);
    return {
      beforeLogs,
      afterLogs: normalizeLogs(h.logs).length,
      lastLog: h.lastLog,
      autoBar: el?.classList.contains('is-auto') || false,
      label: el?.querySelector('.session-progress-label')?.textContent || '',
      sheetClosed: !document.getElementById('value-log-sheet')?.classList.contains('open'),
    };
  });
  console.log(discard);
  assert(discard.afterLogs === discard.beforeLogs && discard.lastLog === null, 'discard creates no log entry');
  assert(discard.sheetClosed, 'discard closes session sheet');
  assert(discard.autoBar && /auto in \d+m/i.test(discard.label), 'discard restores pending auto-complete bar');

  console.log('\n[F] timer prefers timer bar over auto bar; no mid-run autoMarkAt');
  const dual = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Auto task');
    const data = load();
    data[idx].logs = [];
    data[idx].lastLog = null;
    save(data);
    startHabitTimer(idx);
    const el = document.querySelector(`.ting-card[data-real="${idx}"] [data-session-progress]`);
    return {
      isTimer: el?.classList.contains('is-timer') || false,
      isAuto: el?.classList.contains('is-auto') || false,
      autoMarkAt: habitTimer && Object.prototype.hasOwnProperty.call(habitTimer, 'autoMarkAt')
        ? habitTimer.autoMarkAt
        : undefined,
      label: el?.querySelector('.session-progress-label')?.textContent || '',
    };
  });
  console.log(dual);
  assert(dual.isTimer && !dual.isAuto, 'running timer shows timer bar, not auto bar');
  assert(dual.autoMarkAt === undefined || dual.autoMarkAt === null, 'timer does not arm mid-run autoMarkAt');
  assert(/now · \d+m left/.test(dual.label), 'timer label matches doing-now while running on auto-mark task');

  console.log('\n[G] logging elsewhere clears timer without second prompt');
  const pulseClear = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Auto task');
    if(!habitTimer)startHabitTimer(idx);
    logTing(idx, {});
    return {
      timerGone: !habitTimer,
      sheetOpen: document.getElementById('value-log-sheet')?.classList.contains('open') || false,
      done: load()[idx].lastLog !== null,
    };
  });
  console.log(pulseClear);
  assert(pulseClear.timerGone && pulseClear.done, 'logging clears running timer');
  assert(!pulseClear.sheetOpen, 'logging does not open a second session sheet');

  console.log('\n[F5] create tip explains unified session behavior');
  const f5 = await page.evaluate(() => {
    const tip = document.getElementById('ting-auto-mark-help')?.textContent || '';
    return { tip, unified: /session/i.test(tip) && /logs it/i.test(tip) };
  });
  console.log(f5);
  assert(f5.unified, 'auto-mark tip explains that an active session logs at its end');

  if(pageErrors.length){
    console.error('page errors:', pageErrors.join('\n'));
    assert(false, 'no page errors');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail) process.exit(1);
  console.log('TIMER SESSION TEST PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
