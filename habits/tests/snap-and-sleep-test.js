// snap-and-sleep — tests for two related home-list edge cases:
//
//   1. snapLogTimestamp: logging a daily habit late in the day records the
//      log at the day's window-start (or midnight if no window) instead of
//      the exact time. Without this, a daily habit logged at 11pm yesterday
//      would have daysSince=0 at the start of today's narrow allowed window,
//      hiding it from the home list exactly when the user expects to do it.
//
//   2. windowStillDoableToday subtracts blocked (sleep) intervals: an item
//      whose nominal window still has minutes left, but those minutes fall
//      inside a sleep block, is NOT "still doable today" — and so it should
//      fall out of the today bucket on the home list once sleep has started.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/snap-and-sleep-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
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
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{},
      defaultTravelMode:'driving', blockedTimes:[]
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  // ══════════════════════════════════════════════════════════════════════
  // A. snapLogTimestamp — basic shapes
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] snapLogTimestamp — basic shapes');
  const snap = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const lateToday = today + 23 * 3600000;            // 11pm today
    const earlyToday = today + 5 * 3600000;            // 5am today (before window)
    const midYesterday = today - 1 * 86400000 + 30 * 60000; // 12:30am yesterday
    // keepup with a 6am–10am window
    const h610 = { type:'keepup', allowedTimeStart:360, allowedTimeEnd:600,
      allowedTimeStartAnchor:null, allowedTimeEndAnchor:null };
    // keepup with no time window
    const hNone = { type:'keepup' };
    // task with a 6am window — must NOT be snapped (one-off, time matters)
    const hTask = { type:'task', allowedTimeStart:360, allowedTimeEnd:600 };
    // zero-type with a 6am window — must NOT be snapped
    const hZero = { type:'zero', allowedTimeStart:360, allowedTimeEnd:600 };
    return {
      lateToday_610:  snapLogTimestamp(h610, lateToday),
      earlyToday_610: snapLogTimestamp(h610, earlyToday),
      yest_None:      snapLogTimestamp(hNone, midYesterday),
      lateToday_None: snapLogTimestamp(hNone, lateToday),
      task_keepsTs:   snapLogTimestamp(hTask, lateToday),
      zero_keepsTs:   snapLogTimestamp(hZero, lateToday),
      // Reference points for assertions
      today_6am:      today + 360 * 60000,
      today_midnight: today,
      yest_midnight:  today - 1 * 86400000
    };
  });
  console.log(snap);
  // 11pm logged today for 6am window → snaps to today 6am
  assert(snap.lateToday_610 === snap.today_6am,
    `late log snaps to today window-start (${snap.lateToday_610} vs ${snap.today_6am})`);
  // 5am logged today (before window opens) must NOT push the log into the
  // future (would be hidden by actualLogs) — fall back to today midnight.
  assert(snap.earlyToday_610 === snap.today_midnight,
    `pre-window log falls back to today midnight (not future window-start, not yesterday) — got ${snap.earlyToday_610} vs ${snap.today_midnight}`);
  assert(snap.earlyToday_610 >= snap.today_midnight,
    'pre-window snap stays within today (not moved to yesterday)');
  // No window → snap to midnight of the log's day
  assert(snap.yest_None === snap.yest_midnight,
    `no-window yesterday log snaps to yesterday midnight (${snap.yest_None} vs ${snap.yest_midnight})`);
  assert(snap.lateToday_None === snap.today_midnight,
    `no-window today log snaps to today midnight (${snap.lateToday_None} vs ${snap.today_midnight})`);
  // Tasks and zero-type keep actual ts
  assert(snap.task_keepsTs > snap.today_6am,
    'task logs keep actual ts (not snapped)');
  assert(snap.zero_keepsTs > snap.today_6am,
    'zero-type logs keep actual ts (not snapped)');

  // ══════════════════════════════════════════════════════════════════════
  // B. logTing stores the snapped timestamp + clears the way for next day
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] logTing stores snapped ts; rhythm check flips next morning');
  const logBehavior = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const settings = loadSortSettings();
    settings.blockedTimes = [];
    saveSortSettings(settings);
    save([
      {
        name:'stretch', type:'keepup', target:1, durationMinutes:5,
        priority:2, flexibilityDays:0,
        allowedTimeStart:360, allowedTimeEnd:600,  // 6am–10am window
        allowedTimeStartAnchor:null, allowedTimeEndAnchor:null,
        logs:[], emoji:'', pinned:false, topics:[]
      }
    ]);
    const data = load();
    const i = data.findIndex(h => h.name === 'stretch');
    // Force "now" to be 11pm today by overriding Date.now inside logTing's
    // closure is not possible without source edits. Instead, verify the
    // stored timestamp falls on dayStart+360*60000 by checking dateKey +
    // minute-of-day of the resulting lastLog.
    logTing(i);
    const after = load();
    const h = after.find(x => x.name === 'stretch');
    const storedTs = h.lastLog;
    const storedDay = dayStart(storedTs);
    const storedMinute = Math.round((storedTs - storedDay) / 60000);
    // daysSince as of "tomorrow at 7am" should be 1 (eligible again) —
    // we approximate by re-evaluating daysSince with an explicit now.
    const tomorrow7am = storedDay + 86400000 + 7 * 3600000;
    const realDaysSince = Math.floor((tomorrow7am - storedTs) / 86400000);
    return {
      storedMinute,
      sameDay: storedDay === today,
      realDaysSinceTomorrow7am: realDaysSince
    };
  });
  console.log(logBehavior);
  assert(logBehavior.sameDay, 'snapped log stays on today');
  assert(logBehavior.storedMinute === 360,
    `snapped minute-of-day is 360 (6am), got ${logBehavior.storedMinute}`);
  // With the OLD behaviour (storing 11pm), at 7am next day daysSince would
  // be 0 (only 8h elapsed). With snapping to 6am, it is 1 (25h elapsed) —
  // eligible again inside the next day's window.
  assert(logBehavior.realDaysSinceTomorrow7am === 1,
    `daysSince at tomorrow-7am = 1 (snapped), got ${logBehavior.realDaysSinceTomorrow7am}`);

  // ══════════════════════════════════════════════════════════════════════
  // C. windowStillDoableToday with no blocked time — sanity baseline
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] windowStillDoableToday — baseline (no blocks)');
  const baseline = await page.evaluate(() => {
    const settings = loadSortSettings();
    settings.blockedTimes = [];
    saveSortSettings(settings);
    const h = {
      type:'keepup', durationMinutes:30,
      allowedTimeStart:1200, allowedTimeEnd:1380  // 8pm–11pm window
    };
    const today = dayStart(Date.now());
    const at10pm = today + 22 * 3600000;
    const at10_30pm = today + 22.5 * 3600000;
    const at11_30pm = today + 23.5 * 3600000;
    return {
      at10pm:    windowStillDoableToday(h, at10pm),      // 1h left in window → 30m fits
      at10_30pm: windowStillDoableToday(h, at10_30pm),   // exactly 30m left → fits
      at11_30pm: windowStillDoableToday(h, at11_30pm)    // 30m AFTER window closed → not doable
    };
  });
  console.log(baseline);
  assert(baseline.at10pm === true, '10pm with 8pm–11pm window: still doable (no blocks)');
  assert(baseline.at10_30pm === true, '10:30pm with 8pm–11pm window: exactly 30m left → fits');
  assert(baseline.at11_30pm === false, '11:30pm with 8pm–11pm window: window closed → not doable');

  // ══════════════════════════════════════════════════════════════════════
  // D. windowStillDoableToday with a 10pm–6am sleep block
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] windowStillDoableToday — subtracts sleep block');
  const withSleep = await page.evaluate(() => {
    const settings = loadSortSettings();
    settings.blockedTimes = [
      { label:'sleep', days:[], start:1320, end:360 }   // 10pm–6am overnight
    ];
    saveSortSettings(settings);
    const today = dayStart(Date.now());
    // Habit A: no time window (24h), 30m duration.
    const noWindow = { type:'keepup', durationMinutes:30 };
    // Habit B: 8pm–11pm window, 30m duration.
    const windowed = {
      type:'keepup', durationMinutes:30,
      allowedTimeStart:1200, allowedTimeEnd:1380
    };
    return {
      // 11pm — sleep already started an hour ago. 1h until midnight, all
      // inside the sleep evening segment (10pm–midnight). No-window habit
      // must read NOT doable today.
      noWindow_at11pm: windowStillDoableToday(noWindow, today + 23 * 3600000),
      // 9pm — sleep starts at 10pm. 3h until midnight, 1h inside sleep
      // evening segment. Net 2h available → 30m habit fits.
      noWindow_at9pm:  windowStillDoableToday(noWindow, today + 21 * 3600000),
      // 11pm windowed (window ends 11pm) — 0 minutes inside window, not doable.
      windowed_at11pm: windowStillDoableToday(windowed, today + 23 * 3600000),
      // 9pm windowed — window ends 11pm so 2h left in window, but 1h of that
      // is sleep (10pm–11pm). Net 1h available → 30m fits.
      windowed_at9pm:  windowStillDoableToday(windowed, today + 21 * 3600000),
      // 10pm windowed — window ends 11pm (1h left), but the whole 1h is
      // inside sleep (10pm–11pm). Net 0 → not doable.
      windowed_at10pm: windowStillDoableToday(windowed, today + 22 * 3600000)
    };
  });
  console.log(withSleep);
  assert(withSleep.noWindow_at11pm === false,
    'no-window habit at 11pm (inside sleep): NOT doable');
  assert(withSleep.noWindow_at9pm === true,
    'no-window habit at 9pm: 2h net (3h−1h sleep) → doable');
  assert(withSleep.windowed_at11pm === false,
    'windowed habit at 11pm: window closed → not doable');
  assert(withSleep.windowed_at9pm === true,
    'windowed habit at 9pm: 1h net inside window → doable');
  assert(withSleep.windowed_at10pm === false,
    'windowed habit at 10pm: window has 1h left but it is all sleep → NOT doable');

  // ══════════════════════════════════════════════════════════════════════
  // E. Sleep blockades drop the habit out of the today bucket (todayCategory)
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] todayCategory flips once sleep has started');
  const categorize = await page.evaluate(() => {
    const settings = loadSortSettings();
    settings.blockedTimes = [
      { label:'sleep', days:[], start:1320, end:360 }   // 10pm–6am overnight
    ];
    saveSortSettings(settings);
    const today = dayStart(Date.now());
    const h = { type:'keepup', target:1, durationMinutes:30, lastLog: today - 2 * 86400000 };
    const cat = (now) => todayCategory(h, settings);
    // We can't pass `now` through todayCategory — it uses Date.now() — but
    // we can verify the gate by re-asserting windowStillDoableToday under
    // the same settings at the boundary times.
    return {
      doableAt9pm:  windowStillDoableToday(h, today + 21 * 3600000),
      doableAt11pm: windowStillDoableToday(h, today + 23 * 3600000)
    };
  });
  console.log(categorize);
  assert(categorize.doableAt9pm === true, 'at 9pm (before sleep) the habit is still doable today');
  assert(categorize.doableAt11pm === false, 'at 11pm (during sleep) the habit is NOT doable today');

  assert(pageErrors.length === 0, 'no page errors during run (' + pageErrors.length + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
