// sleep-block-dynamic — tests for a blocked sleep time using prayer anchors
// to dynamically set the block 8 hours before sunrise.
//
// Because sunrise is early morning, 8 hours before falls in the previous day.
// The resolver returns a positive minute value (1300-1440 range) for the
// previous-day start, so the block wraps overnight with two segments:
//   segment 1: midnight → sunrise (morning tail)
//   segment 2: sunrise−8h → midnight (previous-day evening start)
// Total duration is always 480 minutes regardless of sunrise time.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/sleep-block-dynamic-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
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
  // A. resolveBlockedTimeMinutes — sunrise-8h to sunrise
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] resolveBlockedTimeMinutes — sunrise − 8h to sunrise');
  const resolved = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [{
      label:'sleep', days:[0,1,2,3,4,5,6],
      start:0, end:420,
      locationId:'home',
      startAnchor:'sunrise', startOffsetMin:-480,
      endAnchor:'sunrise', endOffsetMin:0
    }];
    saveSortSettings(s);
    if(typeof sortSettings !== 'undefined'){
      Object.assign(sortSettings, loadSortSettings());
    }
    const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    // Raw resolve is dayBase-relative (sunrise−8h is negative). Fold into the
    // overnight clock form the agenda uses (evening start > morning end).
    const rawStart = resolveBlockedTimeMinutes(block, 'start', today);
    const rawEnd = resolveBlockedTimeMinutes(block, 'end', today);
    const folded = foldBlockedMinutes(rawStart, rawEnd);
    const startMin = folded.startMin;
    const endMin = folded.endMin;
    // Duration should be 480 (8h) regardless of sunrise time.
    // Overnight wrap: from startMin (evening) through midnight to endMin.
    const overnightDur = (1440 - startMin) + endMin;
    return {
      startAnchor: block.startAnchor,
      endAnchor: block.endAnchor,
      rawStart, rawEnd,
      startMin, endMin,
      overnightDur,
      rawDur: rawEnd - rawStart
    };
  });
  assert(resolved.startAnchor === 'sunrise', 'startAnchor is sunrise');
  assert(resolved.endAnchor === 'sunrise', 'endAnchor is sunrise');
  assert(Number.isFinite(resolved.rawStart), 'raw start resolves (' + resolved.rawStart + ')');
  assert(resolved.rawStart < 0, 'raw sunrise−8h is before dayBase (' + resolved.rawStart + ')');
  assert(Number.isFinite(resolved.startMin), 'folded start is a number (' + resolved.startMin + ')');
  assert(Number.isFinite(resolved.endMin), 'folded end is a number (' + resolved.endMin + ')');
  // Folded startMin is in the previous day's evening (1200-1440 range).
  assert(resolved.startMin > 1200 && resolved.startMin <= 1440,
    'folded startMin is previous-day evening (' + resolved.startMin + ')');
  // endMin is sunrise in the morning (300-600 range).
  assert(resolved.endMin > 270 && resolved.endMin < 600,
    'endMin is sunrise in morning (' + resolved.endMin + ')');
  // The block wraps overnight so startMin > endMin.
  assert(resolved.startMin > resolved.endMin,
    'startMin (' + resolved.startMin + ') > endMin (' + resolved.endMin + ') = overnight wrap');
  // Total duration is exactly 480 minutes (8 hours) — both raw and folded.
  assert(resolved.rawDur === 480, 'raw duration is 480 min (' + resolved.rawDur + ')');
  assert(resolved.overnightDur === 480,
    'overnight duration is 480 min (' + resolved.overnightDur + ')');

  // ══════════════════════════════════════════════════════════════════════
  // B. agendaBlockedIntervals — the block appears in the agenda
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] agendaBlockedIntervals with sunrise-8h sleep');
  const agenda = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const d = new Date(today);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const settings = loadSortSettings();
    const blocks = agendaBlockedIntervals(dayKey, settings, today, today + 86400000);
    const sleep = blocks.filter(b => b.label === 'sleep');
    const block = normalizeBlockedTimes(settings.blockedTimes)[0];
    const rawBed = resolveBlockedTimeMinutes(block, 'start', today);
    const rawWake = resolveBlockedTimeMinutes(block, 'end', today);
    const folded = foldBlockedMinutes(rawBed, rawWake);
    const bedMin = folded.startMin;
    const wakeMin = folded.endMin;
    const firstOpen = dayFirstOpenMinute(
      normalizeBlockedTimes(settings.blockedTimes),
      d.getDay()
    );
    // The overnight block covers: midnight→wake (morning tail) and
    // bed→midnight (evening start). At minute=60 (1am) we're inside
    // the morning tail: minute < wakeMin.
    const locAtMidnight = blockLocationAtMinute(
      normalizeBlockedTimes(settings.blockedTimes),
      60, // 1am — inside the overnight tail (minute < wakeMin)
      d.getDay()
    );
    // At 5 minutes before sunrise, also inside the overnight tail.
    const locAtWake = blockLocationAtMinute(
      normalizeBlockedTimes(settings.blockedTimes),
      Math.max(0, wakeMin - 5),
      d.getDay()
    );
    // At bedtime (bedMin), inside the evening segment.
    const locAtBed = blockLocationAtMinute(
      normalizeBlockedTimes(settings.blockedTimes),
      bedMin,
      d.getDay()
    );
    // Total blocked minutes across both segments.
    const totalMinutes = sleep.reduce((sum, b) => {
      const segStart = Math.max(0, Math.round((b.start - today) / 60000));
      const segEnd = Math.min(1440, Math.round((b.end - today) / 60000));
      return sum + (segEnd - segStart);
    }, 0);
    return {
      sleepParts: sleep.length,
      sleepLoc: sleep[0] && sleep[0].locationId,
      sleepLabel: sleep[0] && sleep[0].label,
      // Morning tail: starts at midnight (0), ends at sunrise.
      morningEnd: sleep.find(b => Math.round((b.start - today) / 60000) === 0)?.endMin,
      // Evening segment: starts at bedMin, ends at midnight (1440).
      eveningStart: sleep.find(b => b.endMin === 1440)?.startMin,
      firstOpen,
      locAtMidnight,
      locAtWake,
      locAtBed,
      totalMinutes
    };
  });
  assert(agenda.sleepParts === 2, 'sleep block splits into 2 overnight segments (' + agenda.sleepParts + ')');
  assert(agenda.sleepLabel === 'sleep', 'sleep block labelled "sleep"');
  assert(agenda.sleepLoc === 'home', 'sleep interval carries locationId');
  assert(Number.isFinite(agenda.morningEnd), 'morning tail has finite end (' + agenda.morningEnd + ')');
  assert(agenda.morningEnd === resolved.endMin, 'morning tail ends at sunrise (' + agenda.morningEnd + ' vs ' + resolved.endMin + ')');
  assert(agenda.eveningStart === resolved.startMin, 'evening segment starts at bed time (' + agenda.eveningStart + ' vs ' + resolved.startMin + ')');
  // Total duration across both segments is 480 min.
  assert(agenda.totalMinutes === 480, 'total blocked time is 480 min (' + agenda.totalMinutes + ')');
  // First open minute is at sunrise (morning tail ends).
  assert(agenda.firstOpen === resolved.endMin, 'firstOpen = sunrise (' + agenda.firstOpen + ' vs ' + resolved.endMin + ')');
  assert(agenda.locAtMidnight === 'home', 'location at 1am → home');
  assert(agenda.locAtWake === 'home', 'location before sunrise → home');
  assert(agenda.locAtBed === 'home', 'location at bedtime → home');

  // ══════════════════════════════════════════════════════════════════════
  // C. Fixed fallback — when anchor can't resolve, fixed start/end used
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] fixed fallback when anchor unresolvable');
  const fallback = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const s = loadSortSettings();
    // Location removed → normalize strips anchors → falls back to fixed.
    s.blockedTimes = [{
      label:'sleep', days:[0,1,2,3,4,5,6],
      start:0, end:420,
      locationId:null,
      startAnchor:'sunrise', startOffsetMin:-480,
      endAnchor:'sunrise', endOffsetMin:0
    }];
    saveSortSettings(s);
    const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    // resolveBlockedTimeMinutes falls back to block.start/block.end when
    // anchor is stripped (no location → no anchor).
    const startMin = resolveBlockedTimeMinutes(block, 'start', today);
    const endMin = resolveBlockedTimeMinutes(block, 'end', today);
    return {
      startMin, endMin,
      startAnchor: block.startAnchor,
      endAnchor: block.endAnchor,
      start: block.start,
      end: block.end
    };
  });
  // Anchors stripped because no location.
  assert(fallback.startAnchor == null, 'startAnchor stripped without location');
  assert(fallback.endAnchor == null, 'endAnchor stripped without location');
  // Falls back to fixed values.
  assert(fallback.startMin === 0, 'start falls back to midnight (0)');
  assert(fallback.endMin === 420, 'end falls back to 7am (420)');

  // ══════════════════════════════════════════════════════════════════════
  // D. Normalization round-trip
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] normalizeBlockedTimes round-trip');
  const norm = await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [{
      label:'sleep', days:[0,1,2,3,4,5,6],
      start:0, end:420,
      locationId:'home',
      startAnchor:'sunrise', startOffsetMin:-480,
      endAnchor:'sunrise', endOffsetMin:0
    }];
    saveSortSettings(s);
    const blocks = normalizeBlockedTimes(loadSortSettings().blockedTimes);
    const block = blocks[0];
    return {
      label: block.label,
      start: block.start,
      end: block.end,
      locationId: block.locationId,
      startAnchor: block.startAnchor,
      startOffsetMin: block.startOffsetMin,
      endAnchor: block.endAnchor,
      endOffsetMin: block.endOffsetMin,
      // When all 7 days are set, normalize returns [] (empty = all days).
      days: block.days
    };
  });
  assert(norm.label === 'sleep', 'label preserved');
  assert(norm.startAnchor === 'sunrise', 'startAnchor preserved');
  assert(norm.startOffsetMin === -480, 'startOffsetMin -480 preserved');
  assert(norm.endAnchor === 'sunrise', 'endAnchor preserved');
  assert(norm.endOffsetMin === 0, 'endOffsetMin 0 preserved');
  assert(norm.locationId === 'home', 'locationId preserved');
  // All 7 days → normalize collapses to [] (empty = unrestricted, meaning all days).
  assert(norm.days.length === 0, 'all 7 days → collapsed to [] (unrestricted)');
  // Fixed fallback values preserved.
  assert(norm.start === 0, 'fixed start preserved');
  assert(norm.end === 420, 'fixed end preserved');

  // ══════════════════════════════════════════════════════════════════════
  // E. Cancel / restore block instance
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] cancel / restore sleep block');
  const cancel = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const d = new Date(today);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const settings = loadSortSettings();
    const block = normalizeBlockedTimes(settings.blockedTimes)[0];
    // Cancel signature must match the folded minutes agendaBlockedIntervals uses.
    const folded = foldBlockedMinutes(
      resolveBlockedTimeMinutes(block, 'start', today),
      resolveBlockedTimeMinutes(block, 'end', today)
    );
    const startMin = folded.startMin;
    const endMin = folded.endMin;
    // Before cancel.
    const beforeCancel = agendaBlockedIntervals(dayKey, settings, today, today + 86400000);
    const sleepBefore = beforeCancel.filter(b => b.label === 'sleep');
    // Cancel the instance (uses label + folded startMin/endMin as signature).
    cancelBlockedInstance(dayKey, 'sleep', startMin, endMin);
    const settingsAfterCancel = loadSortSettings();
    const afterCancel = agendaBlockedIntervals(dayKey, settingsAfterCancel, today, today + 86400000);
    const sleepAfter = afterCancel.filter(b => b.label === 'sleep');
    // Restore.
    restoreBlockedInstance(dayKey, 'sleep', startMin, endMin);
    const settingsAfterRestore = loadSortSettings();
    const afterRestore = agendaBlockedIntervals(dayKey, settingsAfterRestore, today, today + 86400000);
    const sleepAfterRestore = afterRestore.filter(b => b.label === 'sleep');
    return {
      beforeCount: sleepBefore.length,
      afterCount: sleepAfter.length,
      restoredCount: sleepAfterRestore.length,
      cancelled: isBlockedCancelled(dayKey, 'sleep', startMin, endMin, settingsAfterCancel),
      restored: isBlockedCancelled(dayKey, 'sleep', startMin, endMin, settingsAfterRestore)
    };
  });
  assert(cancel.beforeCount >= 1, 'sleep block present before cancel (' + cancel.beforeCount + ')');
  assert(cancel.afterCount === 0, 'sleep block removed after cancel');
  assert(cancel.cancelled === true, 'cancellation recorded');
  assert(cancel.restoredCount >= 1, 'sleep block restored (' + cancel.restoredCount + ')');
  assert(cancel.restored === false, 'cancellation cleared after restore');

  // ══════════════════════════════════════════════════════════════════════
  // F. Duration always 480 regardless of sunrise time (NYC across seasons)
  // ══════════════════════════════════════════════════════════════════════
  // Note: adhan.js returns Date objects interpreted in the runtime's local
  // timezone. Testing locations in different timezones (e.g. NYC vs Makkah)
  // would produce shifted minutes-from-midnight values. We test that the
  // *duration* is always 480 min regardless of sunrise time.
  console.log('\n[F] duration always 480 min regardless of sunrise time');
  const dur = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    // Test 3 scenarios: sunrise with different offsets to shift the resolved
    // times, verifying the duration is always 480.
    const scenarios = [
      {label:'now', startOffset:-480, endOffset:0},
      {label:'earlier', startOffset:-600, endOffset:-120}, // still 8h span, shifted
      {label:'later', startOffset:-360, endOffset:120}     // still 8h span
    ];
    const results = [];
    for(const sc of scenarios){
      s.blockedTimes = [{
        label:'sleep', days:[0,1,2,3,4,5,6],
        start:0, end:420, locationId:'home',
        startAnchor:'sunrise', startOffsetMin:sc.startOffset,
        endAnchor:'sunrise', endOffsetMin:sc.endOffset
      }];
      saveSortSettings(s);
      if(typeof sortSettings !== 'undefined'){
        Object.assign(sortSettings, loadSortSettings());
      }
      const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
      const startMin = resolveBlockedTimeMinutes(block, 'start', today);
      const endMin = resolveBlockedTimeMinutes(block, 'end', today);
      const isOvernight = startMin > endMin;
      const dur = isOvernight ? (1440 - startMin) + endMin : endMin - startMin;
      results.push({
        label: sc.label + ' start=' + sc.startOffset + ' end=' + sc.endOffset,
        startMin, endMin, duration: dur, overnight: isOvernight
      });
    }
    return results;
  });
  assert(dur.length === 3, 'tested ' + dur.length + ' scenarios');
  for(const r of dur){
    assert(r.duration === 480, r.label + ' duration exactly 480 (' + r.duration + ')');
  }
  // The different offsets should produce different start/end minutes.
  assert(dur[0].startMin !== dur[1].startMin, 'different offsets → different resolved startMins');

  assert(pageErrors.length === 0, 'no page errors during run (' + pageErrors.length + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
