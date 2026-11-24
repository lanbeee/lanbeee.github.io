// Snooze until a picked date (optional clock time, month navigation) and
// multi-day per-date snooze (UI + both Fast and GLPK planner engines).
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/snooze-dates-test.js
const {
  chromium, BASE, atTime, baseHabit:base,
  openEveningSettings, glpkAvailable, runPlannerPair, minutesOnDay
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function isoOffset(baseDate, deltaDays){
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + deltaDays, 12, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Daily read', hid:'daily-read', type:'keepup', target:1, logs:[], emoji:'📖', pinned:false, snoozedUntil:null, snoozedDates:[], createdAt:Date.now() }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', minimalMode:false, showSnoozed:true, showSnoozedUntilOnCards:true, showWeekOnHome:false
    }));
  });

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForSelector('#open-add');
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  async function habitState(){
    return page.evaluate(() => {
      const h = load().find(item => item.hid === 'daily-read');
      return {
        snoozedUntil:h ? h.snoozedUntil : null,
        snoozedDates:h ? (h.snoozedDates || []) : [],
        isSnoozed:typeof habitIsSnoozed === 'function' ? habitIsSnoozed(h) : false,
        returnTs:typeof habitSnoozeReturnTs === 'function' ? habitSnoozeReturnTs(h) : null,
        todayKey:dateKey(Date.now())
      };
    });
  }

  async function resetSnooze(){
    await page.evaluate(() => {
      const data = load();
      const h = data.find(item => item.hid === 'daily-read');
      if(h){ h.snoozedUntil = null; h.snoozedDates = []; h.logs = []; h.lastLog = null; }
      save(data);
      render();
    });
  }

  async function openHabitSnooze(){
    await page.evaluate(() => {
      const idx = load().findIndex(h => h.hid === 'daily-read');
      openSnooze(idx);
    });
    await page.waitForSelector('#snooze-sheet.open', { timeout:3000 });
  }

  async function clickCalDay(key){
    for(let guard = 0; guard < 14; guard += 1){
      const cell = page.locator(`#snooze-cal-grid [data-snooze-cal-day="${key}"]`);
      if(await cell.count() > 0){
        await cell.click();
        return true;
      }
      await page.locator('#snooze-cal-next').click();
    }
    return false;
  }

  const nowDate = new Date();
  const todayKey = isoOffset(nowDate, 0);
  const d1Key = isoOffset(nowDate, 1);
  const d2Key = isoOffset(nowDate, 2);
  const d3Key = isoOffset(nowDate, 3);
  const d4Key = isoOffset(nowDate, 4);

  // ── A. Snooze until a picked date (day after tomorrow) ──
  console.log('\n[A] snooze until picked date (day after tomorrow)');
  await openHabitSnooze();
  const initialCal = await page.evaluate(() => ({
    mode:document.querySelector('[data-snooze-cal-mode].on')?.dataset.snoozeCalMode,
    applyDisabled:document.getElementById('snooze-dates-apply')?.disabled === true,
    prevDisabled:document.getElementById('snooze-cal-prev')?.disabled === true
  }));
  assert(initialCal.mode === 'until', 'opens in until date mode by default');
  assert(initialCal.applyDisabled, 'apply button disabled before a date is picked');
  assert(initialCal.prevDisabled, 'previous month disabled on current month');

  assert(await clickCalDay(d2Key), 'picked day after tomorrow on inline calendar');
  const rangeState = await page.evaluate(({ todayKey, d1Key, d2Key }) => {
    const dayEl = k => document.querySelector(`#snooze-cal-grid [data-snooze-cal-day="${k}"]`);
    return {
      todayInRange:dayEl(todayKey)?.classList.contains('in-range') === true || dayEl(todayKey) === null,
      d1InRange:dayEl(d1Key)?.classList.contains('in-range') === true || dayEl(d1Key) === null,
      d2Selected:dayEl(d2Key)?.classList.contains('selected') === true,
      applyDisabled:document.getElementById('snooze-dates-apply')?.disabled === false
    };
  }, { todayKey, d1Key, d2Key });
  assert(rangeState.d2Selected, 'picked return date is highlighted as selected');
  assert(rangeState.todayInRange && rangeState.d1InRange, 'days before return date are shaded in range');
  assert(rangeState.applyDisabled, 'apply button enables once a future date is picked');

  await page.locator('#snooze-dates-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  let state = await habitState();
  const expectedD2Ts = await page.evaluate(k => parseSnoozeDateUntil(k, ''), d2Key);
  assert(state.isSnoozed && state.snoozedUntil === expectedD2Ts, 'snoozedUntil equals midnight at start of day after tomorrow');

  // Undo restores un-snoozed state
  await page.locator('#action-undo').click();
  state = await habitState();
  assert(!state.isSnoozed && state.snoozedUntil === null, 'undo clears picked-date snooze');

  // ── B. Snooze until picked date with optional return time + DST safety ──
  console.log('\n[B] snooze until picked date with optional return time');
  await openHabitSnooze();
  assert(await clickCalDay(d1Key), 'picked tomorrow');
  await page.locator('#snooze-until-time').fill('14:30');
  await page.locator('#snooze-dates-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  const expectedD1TimeTs = await page.evaluate(k => parseSnoozeDateUntil(k, '14:30'), d1Key);
  assert(state.snoozedUntil === expectedD1TimeTs, 'optional return time sets exact local timestamp');

  const dstGap = await page.evaluate(() => parseSnoozeDateUntil('2027-03-14', '02:30'));
  assert(dstGap === null, 'parseSnoozeDateUntil rejects spring-forward DST gap time');

  // ── C. Pick multiple non-contiguous future days (active today, skipped later) ──
  console.log('\n[C] multi-day snooze for future non-contiguous days');
  await resetSnooze();
  await openHabitSnooze();
  await page.locator('[data-snooze-cal-mode="days"]').click();
  assert(await clickCalDay(d1Key), 'selected tomorrow in pick days mode');
  assert(await clickCalDay(d3Key), 'selected day+3 in pick days mode');
  await page.locator('#snooze-dates-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(state.snoozedDates.join(',') === `${d1Key},${d3Key}`, 'saved multiple non-contiguous snoozedDates');
  assert(!state.isSnoozed, 'habit stays active today when only future dates are snoozed');

  // Detail action reflects upcoming snoozed days
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'daily-read');
    openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  const detailSub = await page.evaluate(() => document.querySelector('#detail-snooze small')?.textContent || '');
  assert(/2 upcoming days/i.test(detailSub), 'detail snooze subtitle summarizes 2 upcoming snoozed days');

  // Reopening snooze sheet opens directly to pick days mode with saved dates selected
  await page.evaluate(() => { closeSheet('detail-sheet'); });
  await openHabitSnooze();
  const reopenState = await page.evaluate(({ d1Key, d3Key }) => ({
    mode:document.querySelector('[data-snooze-cal-mode].on')?.dataset.snoozeCalMode,
    d1On:document.querySelector(`#snooze-cal-grid [data-snooze-cal-day="${d1Key}"]`)?.classList.contains('selected') === true || true,
    selectedCount:snoozeCalSelectedDates.size,
    hasBoth:snoozeCalSelectedDates.has(d1Key) && snoozeCalSelectedDates.has(d3Key)
  }), { d1Key, d3Key });
  assert(reopenState.mode === 'days' && reopenState.hasBoth, 'reopening snooze sheet shows saved snoozedDates in pick days mode');

  // ── D. Snooze today + future days: hides today, returnTs spans contiguous days, show-now preserves future days ──
  console.log('\n[D] snooze today + tomorrow + day+3, unsnooze today preserves future days');
  await page.locator('#snooze-cal-prev').click().catch(() => {});
  assert(await clickCalDay(todayKey), 'toggled today on in pick days mode');
  await page.locator('#snooze-dates-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(state.isSnoozed, 'habit is snoozed today when today is in snoozedDates');
  assert(state.returnTs === expectedD2Ts, 'returnTs advances past contiguous snoozed days (today + tomorrow -> day+2)');

  // Unsnooze clears today while keeping future marked days
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'daily-read');
    doUnsnooze(idx);
  });
  state = await habitState();
  assert(!state.isSnoozed, 'show now makes habit visible today');
  assert(state.snoozedDates.join(',') === `${d1Key},${d3Key}`, 'unsnoozing today preserves future snoozed dates');

  // Undo restores today into snoozedDates
  await page.locator('#action-undo').click();
  state = await habitState();
  assert(state.isSnoozed && state.snoozedDates.join(',') === `${todayKey},${d1Key},${d3Key}`, 'undo hide restores today in snoozedDates');

  // Completing today clears today from snoozedDates while preserving future marked days
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'daily-read');
    logTing(idx);
  });
  state = await habitState();
  assert(!state.isSnoozed && state.snoozedDates.join(',') === `${d1Key},${d3Key}`, 'logging today clears today from snoozedDates and keeps future days');

  // Clearing all marked days via the sheet
  await openHabitSnooze();
  await page.locator('#snooze-dates-clear').click();
  await page.locator('#snooze-dates-apply').click();
  await page.waitForFunction(() => !document.getElementById('snooze-sheet')?.classList.contains('open'));
  state = await habitState();
  assert(state.snoozedDates.length === 0, 'clearing all days saves empty snoozedDates');
  await page.locator('#action-undo').click();
  state = await habitState();
  assert(state.snoozedDates.join(',') === `${d1Key},${d3Key}`, 'undo restores cleared snoozedDates');

  // ── E. Planner parity (GLPK + Fast): snoozedDates skips only marked days ──
  console.log('\n[E] both planner engines skip snoozedDates and schedule active days');
  const frozenNow = atTime(9);
  const frozenDate = new Date(frozenNow);
  const pDay0 = isoOffset(frozenDate, 0);
  const pDay1 = isoOffset(frozenDate, 1);
  const pDay2 = isoOffset(frozenDate, 2);
  const pDay3 = isoOffset(frozenDate, 3);
  const settings = openEveningSettings({
    availabilityMinutes:Array(7).fill(360),
    locations:[{ id:'shared', name:'Shared place', lat:40, lng:-75 }],
    travel:{}
  });
  const anchor = base({
    hid:'anchor', name:'Daily anchor', type:'keepup', target:1,
    durationMinutes:20, priority:1, locationIds:['shared'], anywhereAllowed:false
  });
  const futureSkipped = base({
    hid:'future-skip', name:'Skip Wed and Fri', type:'keepup', target:1,
    durationMinutes:20, priority:1, locationIds:['shared'], anywhereAllowed:false,
    snoozedDates:[pDay1, pDay3],
    // Linked to anchor on same day — snoozedDates must still win on day 1 and day 3!
    scheduleLinks:[{ anchorHid:'anchor', direction:'after', adjacency:'sometime', requireSameDay:true }]
  });
  const todayAndLaterSkipped = base({
    hid:'today-skip', name:'Skip Today and Thu', type:'keepup', target:1,
    durationMinutes:20, priority:1,
    snoozedDates:[pDay0, pDay2]
  });

  const glpkOk = await glpkAvailable(page);
  const result = await runPlannerPair(page, [anchor, futureSkipped, todayAndLaterSkipped], settings, frozenNow);
  for(const [label, week] of [['GLPK', result.glpk], ['Fast', result.fast]]){
    if(label === 'GLPK' && !glpkOk){ console.log('  skip: GLPK unavailable'); continue; }
    assert(!week.error, `${label}: week builds without error ${week.error || ''}`);
    assert(minutesOnDay(week, 0, 'Skip Wed and Fri') === 20, `${label}: future-snoozed item scheduled on day 0`);
    assert(minutesOnDay(week, 1, 'Skip Wed and Fri') === 0, `${label}: snoozed day 1 skipped despite same-day link and shared place`);
    assert(minutesOnDay(week, 2, 'Skip Wed and Fri') === 20, `${label}: active day 2 scheduled`);
    assert(minutesOnDay(week, 3, 'Skip Wed and Fri') === 0, `${label}: snoozed day 3 skipped`);
    assert(minutesOnDay(week, 4, 'Skip Wed and Fri') === 20, `${label}: active day 4 scheduled`);

    assert(minutesOnDay(week, 0, 'Skip Today and Thu') === 0, `${label}: today skipped when today in snoozedDates`);
    assert(minutesOnDay(week, 1, 'Skip Today and Thu') === 20, `${label}: tomorrow scheduled when only today+day2 snoozed`);
    assert(minutesOnDay(week, 2, 'Skip Today and Thu') === 0, `${label}: day 2 skipped when in snoozedDates`);
    assert(minutesOnDay(week, 3, 'Skip Today and Thu') === 20, `${label}: day 3 scheduled`);
  }

  assert(pageErrors.length === 0, 'no page errors throughout test (' + pageErrors.join(' | ') + ')');

  await browser.close();
  console.log(`\nsnooze-dates-test: ${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
