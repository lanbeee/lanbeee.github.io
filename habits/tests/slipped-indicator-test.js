// slipped-indicator — tests for the "slipped" day-ahead projection feature:
//
//   1. Snapshot seeding: first render records today's suggested hids.
//   2. Within-day drop: item leaves today section → pill appears.
//   3. Day rollover: yesterday's projection becomes baseline → slipped shows.
//   4. Completion excludes: logging an item removes it from slipped.
//   5. Projection refresh: data change (fingerprint) recomputes projection.
//   6. Snoozed items: excluded — a deliberate snooze is not a miss.
//   7. Empty today: pill still renders when all today items drop out.
//  12. Overdue weekly/task still missed when the planner catch-up-places them tomorrow.
//  13. Morning-only window, first open after it closed → missed.
//  14. Off-day/impossible overdue work is never swept into Missed.
//  15. A dated planner expectation survives a skipped app day.
//  16. A row actually shown today remains missed if a cold solve drops it.
//  17. Yesterday's dated row is not missed while today's window is still open.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/slipped-indicator-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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

  // Late wall-clock: windowStillDoableToday needs duration fit before midnight,
  // and missing flexibilityDays normalizes to DEFAULT_EARLY_WINDOW_DAYS (1), which
  // bumps effectiveTarget so "daily" seeds stop counting as today. Freeze mid-
  // morning like agenda-order / day-capacity suites.
  const testClock = new Date();
  testClock.setHours(10,0,0,0);
  await page.addInitScript(clock => {
    const RealDate = window.Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(clock); }
    FrozenDate.now = ()=>clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
  }, testClock.getTime());

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
    // This suite exercises slipped-item interaction, not the first-run tour.
    // Mark the coach complete before boot so its delayed offer cannot cover a
    // pill between assertions on a slow/full-matrix run.
    localStorage.setItem('tings_coach_essentials_v2', 'done');
    localStorage.setItem('tings_coach_install_v2', 'done');
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', showWeekOnHome:false, agendaOptimizer:false,
      topics:[], locations:[], travel:{}, defaultTravelMode:'driving', blockedTimes:[]
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot');

  // ══════════════════════════════════════════════════════════════════════
  // A. Snapshot seeding
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] Snapshot seeding');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'seed-1', name:'Run', emoji:'🏃', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'seed-2', name:'Read', emoji:'📚', type:'keepup', target:2, logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  let snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  assert(snap && snap.day, 'snapshot created with day field');
  assert(snap && snap.hids && Object.keys(snap.hids).length >= 1, 'snapshot records today hids');
  assert(snap && snap.projection && snap.projection.day, 'projection stored for tomorrow');
  assert(snap && snap.projection && snap.projection.fingerprint, 'projection has fingerprint');

  // ══════════════════════════════════════════════════════════════════════
  // B. Within-day drop
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] Within-day drop');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'drop-1', name:'Swim', emoji:'🏊', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  let pill = await page.$('.dropped-pill');
  assert(!pill, 'no pill when item is still in today');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill appears after window closes');
  if(pill){
    const text = await pill.textContent();
    assert(text.includes('1'), 'pill shows count of 1');
    assert(/missed/i.test(text), `pill uses missed wording: "${text}"`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // C. Day rollover with projection baseline
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] Day rollover with projection baseline');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'roll-x', name:'Walk', emoji:'🚶', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'roll-y', name:'Deep Work', emoji:'🎯', type:'keepup', target:5, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'roll-z', name:'Errand', emoji:'🧾', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:360, allowedTimeEnd:540 },
    ]));
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids: {},
      projection: { day:'stale', hids:['roll-x','roll-y','roll-z'], fingerprint:'old' }
    }));
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows on day rollover');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const items = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(items.some(i => i.includes('Errand')), 'Errand shown as missed (due today, window closed)');
    assert(!items.some(i => i.includes('Deep Work')), 'Deep Work NOT missed (upcoming, was never due today)');
    assert(!items.some(i => i.includes('Walk')), 'Walk NOT missed (still in today section)');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // D. Completion excludes from slipped
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] Completion excludes from slipped');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    // roll-z (Errand) is the true miss from section C; logging it must clear
    // the pill even though roll-y (upcoming) is still not in today's list.
    data[2].logs.push(Date.now());
    data[2].lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(!pill, 'pill gone after completing the slipped item');

  // ══════════════════════════════════════════════════════════════════════
  // E. Projection refresh on data change
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] Projection refresh on data change');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'proj-a', name:'Stretch', emoji:'🤸', type:'keepup', target:1, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'proj-b', name:'Exercise', emoji:'💪', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  const projBefore = snap?.projection?.hids || [];
  assert(projBefore.includes('proj-a'), 'proj-a (daily, logged today) in tomorrow projection');

  // Log proj-a again (simulating doing it twice) — daysSince=0, tomorrow daysSince=1>=1 still due
  // Instead: change target to 7 → tomorrow daysSince=1 < 7, not due → leaves projection
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].target = 7;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  const projAfter = snap?.projection?.hids || [];
  assert(!projAfter.includes('proj-a'), 'proj-a removed from projection after target changed to 7d');

  // ══════════════════════════════════════════════════════════════════════
  // F. Snoozed items are not misses
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[F] Snoozed items excluded from missed');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'snz-1', name:'Meditate', emoji:'🧘', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
      { hid:'snz-2', name:'Walk', emoji:'🚶', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'snz-3', name:'Run', emoji:'🏃', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    // Snooze Meditate and let its window close: without the snooze it would be
    // a true miss, but the user deliberately moved it out of today.
    data[0].snoozedUntil = Date.now() + 86400000;
    data[0].allowedTimeEnd = 1;
    // Run keeps its window closed with no snooze → genuine miss.
    data[2].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows for the true miss alongside a snoozed item');
  if(pill){
    const text = await pill.textContent();
    assert(text.includes('1'), `pill counts only the true miss: "${text}"`);
    await pill.click();
    await page.waitForTimeout(300);
    const names = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(names.some(i => i.includes('Run')), 'Run (not snoozed, window closed) shown as missed');
    assert(!names.some(i => i.includes('Meditate')), 'Meditate NOT missed (deliberately snoozed)');
    const tags = await page.$$eval('#slipped-sheet .dropped-tag', els => els.map(el => el.textContent.trim()));
    assert(!tags.some(t => t.includes('snoozed')), 'no snoozed tag in the missed list');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // G. Empty today section still shows pill
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[G] Empty today section fallback');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'empty-1', name:'Yoga', emoji:'🧘', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
      { hid:'empty-2', name:'Journal', emoji:'📝', type:'keepup', target:7, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  // Close the only today item's window — today section becomes empty
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill renders even with empty today section');
  const todayHeader = await page.$('.section-header.has-dropped');
  assert(Boolean(todayHeader), 'today header inserted as fallback');

  // ══════════════════════════════════════════════════════════════════════
  // H. Tap item opens detail
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[H] Tap dropped item opens detail');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const item = await page.$('#slipped-sheet .dropped-item');
    if(item){
      await item.click();
      await page.waitForTimeout(500);
      const detailOpen = await page.evaluate(() => {
        const sheet = document.getElementById('detail-sheet');
        return sheet && sheet.classList.contains('open');
      });
      assert(detailOpen, 'detail sheet opens on item tap');
    }
  }
  // Close detail sheet so it doesn't block subsequent interactions
  await page.evaluate(() => { closeSheet('detail-sheet'); });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════════════
  // I. Missed from yesterday section renders
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[I] Missed from yesterday section');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'miss-a', name:'Yoga', emoji:'🧘', type:'keepup', target:1, flexibilityDays:0, durationMinutes:15, logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1 },
      { hid:'miss-b', name:'Run', emoji:'🏃', type:'keepup', target:1, flexibilityDays:0, durationMinutes:15, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const t = new Date(now);
    const today = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids: {},
      projection: { day:today, hids:['miss-a','miss-b'], fingerprint:'old' }
    }));
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  // miss-a has closed window (allowedTimeEnd:1) so it's overdue, not in today
  // miss-b is daily logged yesterday → daysSince=1 >= target=1 → due today → in today section
  // So only miss-a should appear as missed (miss-b is in today, excluded)
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const missedHead = await page.$('#slipped-sheet .slipped-section-head');
    assert(Boolean(missedHead), 'section header rendered in slipped sheet');
    const allItems = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(allItems.some(i => i.includes('Yoga')), 'Yoga (overdue, window closed) shown');
    assert(!allItems.some(i => i.includes('Run')), 'Run (in today section) NOT shown as missed');
    const tags = await page.$$eval('#slipped-sheet .dropped-tag', els => els.map(el => el.textContent.trim()));
    assert(tags.some(t => t.includes('today')), 'missed occurrence keeps its expected-day tag');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    // No pill means no slipped items, but missed section should still be accessible
    // via the sheet if we force-open it. For this test, pill absence means no baseline slipped.
    assert(false, 'expected pill for missed-from-yesterday scenario');
  }

  // ══════════════════════════════════════════════════════════════════════
  // J. Completion removes from missed section
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[J] Completion removes from missed');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].logs.push(Date.now());
    data[0].lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const allItems = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(!allItems.some(i => i.includes('Yoga')), 'Yoga gone after completion');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    assert(true, 'no pill after all items completed (missed section empty)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // K. No baseline → no missed section
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[K] No baseline hides missed section');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'nobase-1', name:'Swim', emoji:'🏊', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const missedHeads = await page.$$eval('#slipped-sheet .slipped-section-head', els => els.map(el => el.textContent));
    assert(!missedHeads.some(t => /yesterday|still open/i.test(t)), 'no missed-from-yesterday section when baseline is null');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    assert(true, 'no pill when no baseline (expected)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // L. Overdue work stays missed even if planned tomorrow
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[L] Overdue weekly/task still missed when catch-up is tomorrow');
  const overduePolicy = await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const later = new Set(['overdue-week','overdue-task','open-week']);
    const weeklyOverdue = {
      hid:'overdue-week', name:'Weekly Review', type:'keepup', target:7,
      logs:[now-8*dayMs], lastLog:now-8*dayMs, createdAt:now-30*dayMs,
      flexibilityDays:0, durationMinutes:30, pinned:false, snoozedUntil:null,
      allowedTimeStart:360, allowedTimeEnd:540
    };
    const taskOverdue = {
      hid:'overdue-task', name:'File taxes', type:'task', target:null,
      logs:[], lastLog:null, createdAt:now-30*dayMs, dueDate:now-dayMs,
      flexibilityDays:0, durationMinutes:30, pinned:false, snoozedUntil:null,
      allowedTimeStart:360, allowedTimeEnd:540, eventTime:null
    };
    const weeklyOpen = {
      hid:'open-week', name:'Deep Work', type:'keepup', target:7,
      logs:[now-8*dayMs], lastLog:now-8*dayMs, createdAt:now-30*dayMs,
      flexibilityDays:0, durationMinutes:15, pinned:false, snoozedUntil:null,
      allowedTimeStart:0, allowedTimeEnd:1439
    };
    return {
      overdueWeekly: isMissedOccurrence(weeklyOverdue, later, now),
      overdueTask: isMissedOccurrence(taskOverdue, later, now),
      stillDoableWeekly: isMissedOccurrence(weeklyOpen, later, now)
    };
  });
  assert(overduePolicy.overdueWeekly, 'overdue weekly remains missed despite later-day placement');
  assert(overduePolicy.overdueTask, 'overdue task remains missed despite later-day placement');
  assert(!overduePolicy.stillDoableWeekly, 'still-doable weekly assigned later is not a miss');

  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'anchor-today', name:'Walk', emoji:'🚶', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'overdue-week', name:'Weekly Review', emoji:'📋', type:'keepup', target:7, logs:[now-8*dayMs,{ts:now+dayMs+12*3600000,plan:true}], lastLog:now-8*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:30, pinned:false, allowedTimeStart:360, allowedTimeEnd:540 },
      { hid:'overdue-task', name:'File taxes', emoji:'🧾', type:'task', target:null, logs:[{ts:now+dayMs+12*3600000,plan:true}], lastLog:null, createdAt:now-30*dayMs, dueDate:now-dayMs, flexibilityDays:0, durationMinutes:30, pinned:false, allowedTimeStart:360, allowedTimeEnd:540, eventTime:null, markDone:true }
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows for overdue weekly/task even if tomorrow catch-up exists');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const names = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(names.some(i => i.includes('Weekly Review')), 'Weekly Review (overdue, window closed) shown as missed');
    assert(names.some(i => i.includes('File taxes')), 'File taxes (overdue task) shown as missed');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // M. Morning-only window, first open after it closed
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[M] Morning-only window shows as missed after first open later in the day');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    // 6:00–9:00 allowed window; the frozen clock is 10:00, so this is the
    // same state as opening the app in the afternoon without having done it.
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'morning-walk', name:'Morning Walk', emoji:'🚶', type:'keepup', target:1, logs:[], lastLog:null, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:30, pinned:false, allowedTimeStart:360, allowedTimeEnd:540 }
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows on first open after the morning window closed');
  if(pill){
    const text = await pill.textContent();
    assert(/missed/i.test(text), `pill uses missed wording: "${text}"`);
    await pill.click();
    await page.waitForTimeout(300);
    const names = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(names.some(i => i.includes('Morning Walk')), 'Morning Walk listed as missed');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    settings.showWeekOnHome = true;
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    // Paint week-on-home on the frozen main-thread clock. The planner worker
    // would use wall time and still think a 6–9am window is ahead.
    const week = buildWeekAgenda(load(), sortSettings, 7);
    render({__fromOptimizer:true,__optimizedWeek:week});
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'week-on-home: morning miss still has a today missed pill when today has no remaining rows');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const names = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(names.some(i => i.includes('Morning Walk')), 'week-on-home: Morning Walk listed as missed');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // N. Planner proof excludes off-day and impossible overdue work
  console.log('\n[N] Missed requires a committed or reconstructable planner row');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const todayWeekday = new Date(now).getDay();
    const otherWeekday = (todayWeekday + 1) % 7;
    const offDay = Array.from({length:40},(_,i)=>({
      hid:`off-day-${i}`, name:`Off-day ${i}`, emoji:'🗓️', type:'keepup', target:1,
      logs:[now-4*dayMs], lastLog:now-4*dayMs, createdAt:now-30*dayMs,
      flexibilityDays:0, durationMinutes:30, pinned:false,
      allowedWeekdays:[otherWeekday], allowedTimeStart:360, allowedTimeEnd:540
    }));
    const valid = {
      hid:'valid-morning', name:'Valid Morning', emoji:'☀️', type:'keepup', target:1,
      logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs,
      flexibilityDays:0, durationMinutes:30, pinned:false,
      allowedWeekdays:[todayWeekday], allowedTimeStart:360, allowedTimeEnd:540
    };
    const fullyBlocked = {
      hid:'fully-blocked', name:'Fully Blocked', emoji:'🚫', type:'keepup', target:1,
      logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs,
      flexibilityDays:0, durationMinutes:30, pinned:false,
      allowedWeekdays:[todayWeekday], allowedTimeStart:720, allowedTimeEnd:780
    };
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    settings.showWeekOnHome = false;
    settings.blockedTimes = [{label:'unavailable',days:[todayWeekday],start:720,end:780}];
    localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
    localStorage.setItem('tings_v2',JSON.stringify([...offDay,fullyBlocked,valid]));
    localStorage.removeItem('tings_today_suggested_v1');
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(1000);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'the genuinely feasible morning item is still found on a first evening open');
  if(pill){
    assert((await pill.textContent()).trim() === '1 missed','40 off-day items and one impossible item do not inflate the count');
    await pill.click();
    await page.waitForTimeout(250);
    const names = await page.$$eval('#slipped-sheet .dropped-name',els=>els.map(el=>el.textContent.trim()));
    assert(names.length === 1 && names[0] === 'Valid Morning',`only planner-backed miss is listed: ${names.join(', ')}`);
    await page.click('#slipped-close');
  }

  // O. A skipped app day keeps its dated planner expectation
  console.log('\n[O] Dated expectation survives a skipped app day');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const key = ts=>{
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };
    const twoDaysAgo = key(now - 2*dayMs);
    const yesterday = key(now - dayMs);
    const yesterdayWeekday = new Date(now - dayMs).getDay();
    localStorage.setItem('tings_v2',JSON.stringify([{
      hid:'skipped-day', name:'Skipped-day plan', emoji:'📌', type:'keepup', target:1,
      logs:[now-5*dayMs], lastLog:now-5*dayMs, createdAt:now-40*dayMs,
      flexibilityDays:0, durationMinutes:20, pinned:false,
      allowedWeekdays:[yesterdayWeekday], allowedTimeStart:600, allowedTimeEnd:720
    }]));
    localStorage.setItem('tings_today_suggested_v1',JSON.stringify({
      day:twoDaysAgo,
      hids:{},
      projection:{day:yesterday,hids:['skipped-day'],fingerprint:'prior-plan'}
    }));
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    settings.blockedTimes = [];
    localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(1000);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill),'a planner row is not forgotten just because the app stayed closed the next day');
  if(pill){
    await pill.click();
    await page.waitForTimeout(250);
    const row = await page.locator('#slipped-sheet .dropped-item:has-text("Skipped-day plan")').count();
    const tag = await page.locator('#slipped-sheet .dropped-item:has-text("Skipped-day plan") .dropped-tag').textContent();
    assert(row === 1,'skipped-day expected item appears once');
    assert(/yesterday/i.test(tag),'skipped-day miss keeps its dated label');
    await page.click('#slipped-close');
  }

  // P. A previously rendered row is stronger evidence than an open clock
  // window. This is the cold-open case where the exact optimizer moves an item
  // later in the week even though the morning agenda showed it today.
  console.log('\n[P] Cold solve cannot erase a row the user actually saw today');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const today = todayIso();
    localStorage.setItem('tings_v2',JSON.stringify([{
      hid:'cold-drop', name:'Throw trash', emoji:'🚮', type:'reduce', target:3.5,
      logs:[now-5*dayMs], lastLog:now-5*dayMs, createdAt:now-40*dayMs,
      flexibilityDays:0, durationMinutes:10, pinned:false,
      allowedTimeStart:null, allowedTimeEnd:null
    }]));
    localStorage.setItem('tings_today_suggested_v1',JSON.stringify({
      day:today,
      hids:{'cold-drop':{name:'Throw trash',first:now-2*3600000}},
      projection:null,
      expectations:{
        [today]:{hids:['cold-drop'],fingerprint:'morning-plan',recordedAt:now-2*3600000}
      }
    }));
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    settings.blockedTimes = [];
    localStorage.setItem('tings_app_settings_v2',JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    _homeRenderedWeek = null;
    const list = document.getElementById('list');
    list.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'section-header';
    header.dataset.label = 'today';
    header.textContent = 'today';
    list.appendChild(header);
    // Empty current set models the cold exact plan assigning the item later.
    attachDroppedIndicator(header,list,[]);
  });
  await page.waitForTimeout(250);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill),'previously displayed anytime row appears as missed after a cold-plan drop');
  if(pill){
    assert((await pill.textContent()).trim() === '1 missed','cold-plan drop adds exactly one missed item');
    await pill.click();
    await page.waitForTimeout(200);
    const names = await page.$$eval('#slipped-sheet .dropped-name',els=>els.map(el=>el.textContent.trim()));
    assert(names.length === 1 && names[0] === 'Throw trash','the dropped rendered row is preserved precisely');
    await page.click('#slipped-close');
  }

  // Q. Calendar midnight is not an opportunity ending. A yesterday-dated
  // daily whose window is still open today must not dump into Missed — this
  // is the 2am "18 missed" case. A morning window that has already closed
  // today remains a real miss.
  console.log('\n[Q] Yesterday expectation is not missed while still doable today');
  const rolloverPolicy = await page.evaluate(() => {
    const tenAm = Date.now();
    const twoAm = dayStart(tenAm) + 2 * 3600000;
    const yesterday = dateKey(twoAm - 86400000);
    const daily = {
      hid:'am-daily', name:'Fajr-like', type:'keepup', target:1,
      logs:[twoAm-2*86400000], lastLog:twoAm-2*86400000, createdAt:twoAm-30*86400000,
      flexibilityDays:0, durationMinutes:15, pinned:false, snoozedUntil:null
    };
    const morning = {
      hid:'am-morning', name:'Breakfast-like', type:'keepup', target:1,
      logs:[twoAm-2*86400000], lastLog:twoAm-2*86400000, createdAt:twoAm-30*86400000,
      flexibilityDays:0, durationMinutes:15, pinned:false, snoozedUntil:null,
      allowedTimeStart:360, allowedTimeEnd:540
    };
    return {
      dailyAtTwo: isMissedOccurrence(daily, new Set(), twoAm, yesterday),
      morningAtTwo: isMissedOccurrence(morning, new Set(), twoAm, yesterday),
      dailyAtTen: isMissedOccurrence(daily, new Set(), tenAm, yesterday),
      morningAtTen: isMissedOccurrence(morning, new Set(), tenAm, yesterday)
    };
  });
  assert(!rolloverPolicy.dailyAtTwo, 'all-day daily is not missed at 2am just because yesterday ended');
  assert(!rolloverPolicy.morningAtTwo, 'morning window still ahead is not missed at 2am');
  assert(!rolloverPolicy.dailyAtTen, 'all-day daily is not missed at 10am while still doable today');
  assert(rolloverPolicy.morningAtTen, 'closed morning window from yesterday remains missed at 10am');

  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const yesterday = dateKey(now - dayMs);
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'roll-daily', name:'Dinner', emoji:'🍽️', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false },
      { hid:'roll-morning', name:'Breakfast', emoji:'🍳', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, flexibilityDays:0, durationMinutes:15, pinned:false, allowedTimeStart:360, allowedTimeEnd:540 }
    ]));
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids: {},
      projection: { day: todayIso(), hids:['roll-daily','roll-morning'], fingerprint:'stale-open' },
      expectations: {
        [yesterday]: { hids:['roll-daily','roll-morning'], fingerprint:'stale-open', recordedAt: now-6*3600000 }
      }
    }));
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    settings.blockedTimes = [];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    if(typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'closed morning item still produces a missed pill');
  if(pill){
    assert((await pill.textContent()).trim() === '1 missed', 'still-doable yesterday daily does not inflate the missed count');
    await pill.click();
    await page.waitForTimeout(250);
    const names = await page.$$eval('#slipped-sheet .dropped-name', els => els.map(el => el.textContent.trim()));
    assert(names.includes('Breakfast'), 'closed morning window is listed as missed');
    assert(!names.includes('Dinner'), 'still-doable daily is not listed as missed after midnight');
    await page.click('#slipped-close');
  }

  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n────────────────────────────────────────');
  console.log(`  ${pass} passed, ${fail} failed`);
  if(pageErrors.length){
    console.log('  pageerrors:');
    pageErrors.forEach(e => console.log('    ' + e));
  }
  await browser.close();
  process.exit(fail > 0 || pageErrors.length > 0 ? 1 : 0);
})();
