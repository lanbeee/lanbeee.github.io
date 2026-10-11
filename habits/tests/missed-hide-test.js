/**
 * Hide a missed row until local midnight: it leaves the "N missed" count,
 * is not a snooze, can be shown again, and expires after 12:00 AM.
 *
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/missed-hide-test.js
 */
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function assert(cond, msg){
  if(!cond)throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  const clock = new Date();
  clock.setHours(10, 0, 0, 0);
  const now = clock.getTime();
  const dayMs = 86400000;

  await page.addInitScript(clockTs => {
    window.testClock = clockTs;
    const RealDate = window.Date;
    window.Date = class extends RealDate {
      constructor(...args){ super(...(args.length ? args : [window.testClock])); }
      static now(){ return window.testClock; }
    };
    window.Date.parse = RealDate.parse;
    window.Date.UTC = RealDate.UTC;
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_coach_essentials_v2', 'done');
    localStorage.setItem('tings_coach_install_v2', 'done');
  }, now);

  await page.goto(BASE, { waitUntil:'load' });
  await page.waitForTimeout(200);

  const settings = {
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false,
    topics:[], locations:[], travel:{}, defaultTravelMode:'driving',
    blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
  };
  const habits = [
    { hid:'read-1', name:'Read', emoji:'📚', type:'keepup', target:2, durationMinutes:30,
      lastLog:now - 3 * dayMs, logs:[now - 3 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:null, dueDate:null, priority:1 },
    { hid:'walk-1', name:'Walk', emoji:'🚶', type:'keepup', target:1, durationMinutes:30,
      allowedTimeStart:360, allowedTimeEnd:540,
      lastLog:now - 2 * dayMs, logs:[now - 2 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:null, dueDate:null, priority:1 },
    { hid:'stretch-1', name:'Stretch', emoji:'🧘', type:'keepup', target:1, durationMinutes:15,
      allowedTimeStart:360, allowedTimeEnd:540,
      lastLog:now - 2 * dayMs, logs:[now - 2 * dayMs], createdAt:now - 30 * dayMs,
      flexibilityDays:0, pinned:false, snoozedUntil:null, dueDate:null, priority:1 }
  ];

  await page.evaluate(({ habits, settings }) => {
    localStorage.setItem('tings_v2', JSON.stringify(habits));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    localStorage.removeItem('tings_today_suggested_v1');
    localStorage.removeItem('tings_missed_hidden_v1');
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    render({ __optimizedWeek:buildWeekAgenda(load(), sortSettings, 7) });
  }, { habits, settings });

  await page.waitForSelector('.dropped-pill', { timeout:10000 });
  assert(await page.locator('.dropped-pill').textContent() === '2 missed', 'pill starts at 2 missed');
  console.log('  ok: pill starts at 2 missed');

  await page.locator('.dropped-pill').click();
  await page.locator('#slipped-sheet.open .dropped-item').first().waitFor();
  assert(await page.locator('#slipped-sheet .dropped-item').count() === 2, 'sheet lists both misses');
  assert(await page.locator('#slipped-sheet .dropped-hide').count() === 2, 'each row has a hide control');

  await page.locator('#slipped-sheet .dropped-item:has-text("Walk") .dropped-hide').click();
  await page.waitForFunction(() => {
    const pill = document.querySelector('.dropped-pill');
    return pill && pill.textContent.trim() === '1 missed';
  }, null, { timeout:5000 });
  assert(await page.locator('#slipped-sheet .dropped-item:not(.is-hidden) .dropped-name').textContent() === 'Stretch',
    'Walk left the missed section');
  assert(await page.locator('#slipped-sheet .dropped-item.is-hidden .dropped-name').textContent() === 'Walk',
    'Walk moved to hidden until tonight');
  assert(await page.locator('.slipped-section-head').nth(1).textContent() === 'hidden until tonight',
    'hidden section is labeled');

  const afterHide = await page.evaluate(() => {
    const walk = load().find(h => h.name === 'Walk');
    const names = [...document.querySelectorAll('.ting-name')].map(el => el.textContent.trim());
    return { snoozedUntil:walk && walk.snoozedUntil, names, homeHasWalk:names.includes('Walk') };
  });
  assert(afterHide.snoozedUntil == null, 'hide is not a snooze');
  assert(afterHide.homeHasWalk, 'Walk remains on Home');
  console.log('  ok: hiding one drops the count and is not snooze');

  await page.locator('#slipped-sheet .dropped-item:has-text("Stretch") .dropped-hide').click();
  await page.waitForSelector('.dropped-pill.is-quiet', { timeout:5000 });
  const quiet = await page.evaluate(() => {
    const pill = document.querySelector('.dropped-pill');
    return {
      quiet:pill && pill.classList.contains('is-quiet'),
      label:pill && pill.getAttribute('aria-label'),
      text:(pill && pill.textContent || '').replace(/\s+/g, ' ').trim(),
      sheetOpen:document.getElementById('slipped-sheet').classList.contains('open'),
      hiddenCount:document.querySelectorAll('#slipped-sheet .dropped-item.is-hidden').length
    };
  });
  assert(quiet.quiet, 'amber count is replaced by the quiet chip');
  assert(quiet.label === 'hidden until tonight', 'quiet chip is labeled for assistive text');
  assert(!/missed/i.test(quiet.text), 'quiet chip has no missed count copy');
  assert(quiet.sheetOpen && quiet.hiddenCount === 2, 'sheet stays open on the hidden section');
  console.log('  ok: hiding all replaces N missed with a quiet chip');

  await page.locator('#slipped-sheet .dropped-item:has-text("Walk") .dropped-show').click();
  await page.waitForFunction(() => {
    const pill = document.querySelector('.dropped-pill');
    return pill && !pill.classList.contains('is-quiet') && pill.textContent.trim() === '1 missed';
  }, null, { timeout:5000 });
  assert(await page.locator('#slipped-sheet .dropped-item:not(.is-hidden) .dropped-name').textContent() === 'Walk',
    'showing Walk restores it to the missed section');
  console.log('  ok: show restores the count');

  await page.locator('#slipped-sheet .dropped-item:has-text("Walk") .dropped-hide').click();
  await page.locator('#action-undo').click();
  await page.waitForFunction(() => {
    const pill = document.querySelector('.dropped-pill');
    return pill && pill.textContent.trim() === '1 missed';
  }, null, { timeout:5000 });
  assert(await page.locator('#slipped-sheet .dropped-item:not(.is-hidden):has-text("Walk")').count() === 1,
    'undo restores the hidden row');
  console.log('  ok: undo toast restores the row');

  const clocks = await page.evaluate(() => {
    const dropped = collectDroppedItems(load(), sortSettings, []);
    const walk = dropped.find(row => row.name === 'Walk');
    hideMissedRow(walk);
    const morning = Date.now();
    const late = dayStart(morning) + 23 * 3600000 + 59 * 60000;
    const next = dayStart(morning) + 86400000 + 60000;
    const stretch = dropped.find(row => row.name === 'Stretch');
    const morningRow = { hid:'repeat', expectedDay:todayIso(), occurrenceKey:'morning', name:'Practice' };
    const afternoonRow = { hid:'repeat', expectedDay:todayIso(), occurrenceKey:'afternoon', name:'Practice' };
    hideMissedRow(morningRow);
    const split = partitionDroppedItems([morningRow, afternoonRow]);
    const visible = partitionDroppedItems(dropped).visible.map(row => row.name);
    let assistantText = '';
    if(typeof assistantAnswerMissed === 'function'){
      const ctx = typeof assistantBuildContext === 'function'
        ? assistantBuildContext()
        : { data:load(), settings:sortSettings, now:Date.now() };
      assistantText = (assistantAnswerMissed(ctx) || {}).text || '';
    }
    return {
      activeNow:missedHideIsActive(walk, morning),
      activeLate:missedHideIsActive(walk, late),
      activeNext:!missedHideIsActive(walk, next),
      hiddenIds:split.hidden.map(row => row.occurrenceKey),
      visibleIds:split.visible.map(row => row.occurrenceKey),
      visibleNames:visible,
      assistantText
    };
  });
  assert(clocks.activeNow && clocks.activeLate, 'hide stays in effect through 23:59');
  assert(clocks.activeNext, 'hide expires after local midnight');
  assert(clocks.hiddenIds.length === 1 && clocks.hiddenIds[0] === 'morning',
    'hiding morning does not hide afternoon');
  assert(clocks.visibleIds.length === 1 && clocks.visibleIds[0] === 'afternoon',
    'afternoon stays in the missed count');
  assert(!clocks.visibleNames.includes('Walk'), 'partition omits the hidden Walk');
  if(clocks.assistantText){
    assert(!/Walk/i.test(clocks.assistantText), 'assistant missed list omits hidden names');
  }
  console.log('  ok: midnight expiry, per-session identity, assistant omits hidden names');

  assert(errors.length === 0, `unexpected page errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('\nmissed-hide-test: PASS');
})().catch(err => {
  console.error('\nmissed-hide-test: FAIL —', err.message);
  process.exit(1);
});
