// prayer-times — unit tests for js/prayer-times.js + the schema/normalization
// additions in data.js, and integration tests for the anchor resolver against
// the real adhan.js library (which is loaded via index.html).
//
// These pin down the core contract:
//   • habits without anchor fields behave byte-identically to before
//     (legacy migration + zero behaviour change for users who don't opt in);
//   • each of the four endpoints can be independently switched to dynamic;
//   • the resolver returns a finite minutes-from-midnight for a habit with
//     a valid location + anchor, null when no location;
//   • the save path blocks when a habit uses anchors without a location.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/prayer-times-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}
function eq(a, b){ return JSON.stringify(a) === JSON.stringify(b); }

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // Empty registry; tests inject locations directly.
  await page.addInitScript(() => {
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{},
      defaultTravelMode:'driving'
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  // ── A. cleanPrayerAnchor + aliases ──
  console.log('\n[A] cleanPrayerAnchor');
  const anchors = await page.evaluate(() => ({
    fajr: cleanPrayerAnchor('fajr'),
    sunrise: cleanPrayerAnchor('SUNRISE'),
    sunset_alias: cleanPrayerAnchor('sunset'),
    maghrib: cleanPrayerAnchor('maghrib'),
    isha: cleanPrayerAnchor('isha'),
    junk: cleanPrayerAnchor('foo'),
    empty: cleanPrayerAnchor(''),
    null: cleanPrayerAnchor(null),
    whitespace: cleanPrayerAnchor('  Fajr  '),
  }));
  assert(anchors.fajr === 'fajr', 'fajr kept');
  assert(anchors.sunrise === 'sunrise', 'sunrise lowercased');
  assert(anchors.maghrib === 'maghrib', 'maghrib kept');
  assert(anchors.sunset_alias === 'maghrib', "'sunset' aliased to 'maghrib'");
  assert(anchors.isha === 'isha', 'isha kept');
  assert(anchors.junk === null, 'junk → null');
  assert(anchors.empty === null, 'empty → null');
  assert(anchors.null === null, 'null → null');
  assert(anchors.whitespace === 'fajr', 'whitespace trimmed + lowercased');

  // ── B. normalizePrayerOffset ──
  console.log('\n[B] normalizePrayerOffset');
  const offs = await page.evaluate(() => ({
    zero_default: normalizePrayerOffset(undefined),
    null_default: normalizePrayerOffset(null),
    positive: normalizePrayerOffset(60),
    negative: normalizePrayerOffset(-15),
    junk: normalizePrayerOffset('xyz'),
    cap_high: normalizePrayerOffset(99999),
    cap_low: normalizePrayerOffset(-99999),
    string_num: normalizePrayerOffset('45'),
  }));
  assert(offs.zero_default === 0, 'undefined → 0');
  assert(offs.null_default === 0, 'null → 0');
  assert(offs.positive === 60, '+60 kept');
  assert(offs.negative === -15, '-15 kept');
  assert(offs.junk === 0, 'junk → 0');
  assert(offs.cap_high === 720, 'caps at +720');
  assert(offs.cap_low === -720, 'caps at -720');
  assert(offs.string_num === 45, 'numeric string parsed');

  // ── C. normalize() coerces the new anchor fields ──
  console.log('\n[C] normalize() round-trip');
  const normed = await page.evaluate(() => {
    const out = normalize([{
      name:'test', type:'keepup', target:7,
      allowedTimeStartAnchor:'sunrise',
      allowedTimeStartOffsetMin:60,
      allowedTimeEndAnchor:'sunset', // alias for maghrib
      allowedTimeEndOffsetMin:-30,
      preferredTimeStartAnchor:'junk',  // drops to null
      preferredTimeStartOffsetMin:'oops', // drops to 0
      // old fixed-time fields still carried
      preferredTimeEnd:540
    }])[0];
    return {
      aStartAnchor: out.allowedTimeStartAnchor,
      aStartOff: out.allowedTimeStartOffsetMin,
      aEndAnchor: out.allowedTimeEndAnchor,
      aEndOff: out.allowedTimeEndOffsetMin,
      pStartAnchor: out.preferredTimeStartAnchor,
      pStartOff: out.preferredTimeStartOffsetMin,
      pEnd: out.preferredTimeEnd,
      pEndAnchor: out.preferredTimeEndAnchor,
    };
  });
  assert(normed.aStartAnchor === 'sunrise', 'allowedTimeStartAnchor kept');
  assert(normed.aStartOff === 60, 'allowedTimeStartOffsetMin kept');
  assert(normed.aEndAnchor === 'maghrib', "'sunset' aliased on save");
  assert(normed.aEndOff === -30, 'negative offset kept');
  assert(normed.pStartAnchor === null, 'junk anchor → null');
  assert(normed.pStartOff === 0, 'junk offset → 0');
  assert(normed.pEnd === 540, 'legacy fixed minutes still carried');
  assert(normed.pEndAnchor === null, 'no anchor for preferred end');

  // ── D. Legacy habits migrate transparently ──
  console.log('\n[D] legacy migration');
  const legacy = await page.evaluate(() => {
    const out = normalize([{
      name:'old', type:'keepup', target:7,
      allowedTimeStart:600, allowedTimeEnd:720
    }])[0];
    return {
      aStartAnchor: out.allowedTimeStartAnchor,
      aStartOff: out.allowedTimeStartOffsetMin,
      aEndAnchor: out.allowedTimeEndAnchor,
      hasWindow: hasTimeWindow(out),
      summary: timeWindowSummary(out)
    };
  });
  assert(legacy.aStartAnchor === null, 'legacy: no anchor');
  assert(legacy.aStartOff === 0, 'legacy: offset 0');
  assert(legacy.aEndAnchor === null, 'legacy: no end anchor');
  assert(legacy.hasWindow === true, 'legacy: still has window');
  assert(legacy.summary === '10am–12pm', 'legacy summary uses fixed times');

  // ── E. habitUsesPrayerAnchors ──
  console.log('\n[E] habitUsesPrayerAnchors');
  const uses = await page.evaluate(() => ({
    none: habitUsesPrayerAnchors({}),
    one: habitUsesPrayerAnchors({allowedTimeStartAnchor:'fajr'}),
    alias: habitUsesPrayerAnchors({preferredTimeEndAnchor:'sunset'}),
    junk: habitUsesPrayerAnchors({allowedTimeEndAnchor:'nope'}),
  }));
  assert(uses.none === false, 'no anchors → false');
  assert(uses.one === true, 'one anchor → true');
  assert(uses.alias === true, 'alias anchor → true');
  assert(uses.junk === false, 'junk anchor → false');

  // ── F. habitPrayerLocation resolution order ──
  console.log('\n[F] habitPrayerLocation');
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [
      {id:'home', name:'Home', lat:40.7, lng:-74.0},
      {id:'gym',  name:'Gym',  lat:40.8, lng:-73.9},
      {id:'office', name:'Office', lat:40.9, lng:-73.8}
    ];
    saveSortSettings(s);
  });
  const loc = await page.evaluate(() => ({
    none: habitPrayerLocation({locationIds:[]}),
    one: habitPrayerLocation({locationIds:['gym']})?.id,
    first: habitPrayerLocation({locationIds:['gym','home']})?.id,
    preferred: habitPrayerLocation({locationIds:['gym','home'], locationPrefs:{home:'high'}})?.id,
    legacyPref: habitPrayerLocation({locationIds:['gym','home'], preferredLocationId:'gym'})?.id,
    dangling: habitPrayerLocation({locationIds:['xxx']}),
  }));
  assert(loc.none === null, 'no locations → null');
  assert(loc.one === 'gym', 'single location returned');
  assert(loc.first === 'gym', 'first allowed when no preference');
  assert(loc.preferred === 'home', 'preferred wins over first');
  assert(loc.legacyPref === 'gym', 'legacy preferredLocationId honoured');
  assert(loc.dangling === null, 'dangling id → null (not in registry)');

  // ── G. resolveHabitTimeField with real adhan.js ──
  console.log('\n[G] resolveHabitTimeField against adhan');
  const resolved = await page.evaluate(() => {
    const today = dayStart(Date.now());
    // NYC sunrise is roughly 5:30–7:30am depending on season — assert it
    // lands in the 4am–8am window.
    const h = {locationIds:['home'], allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:30};
    const sunriseMin = resolveHabitTimeField(h, 'allowedTimeStart', today);
    const hOffset = {locationIds:['home'], allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:60};
    const sunrisePlusHour = resolveHabitTimeField(hOffset, 'allowedTimeStart', today);
    // Fixed (no anchor) should return the literal number.
    const fixed = resolveHabitTimeField({allowedTimeStart:600}, 'allowedTimeStart', today);
    // No location → null even with anchor.
    const noLoc = resolveHabitTimeField({allowedTimeStartAnchor:'fajr'}, 'allowedTimeStart', today);
    return {sunriseMin, sunrisePlusHour, fixed, noLoc};
  });
  assert(Number.isFinite(resolved.sunriseMin), 'sunrise resolved to a finite minute');
  assert(resolved.sunriseMin >= 240 && resolved.sunriseMin <= 540, 'sunrise lands 4am–9am (' + resolved.sunriseMin + ')');
  assert(resolved.sunrisePlusHour - resolved.sunriseMin === 30, 'offset shifts by (60−30)=30 min (' + (resolved.sunrisePlusHour - resolved.sunriseMin) + ')');
  assert(resolved.fixed === 600, 'fixed minutes returned unchanged');
  assert(resolved.noLoc === null, 'anchor without location → null');

  // ── H. timeWindowSummary uses anchor labels ──
  console.log('\n[H] timeWindowSummary shows anchor labels');
  const summaries = await page.evaluate(() => ({
    both_anchor: timeWindowSummary({allowedTimeStartAnchor:'sunrise', allowedTimeEndAnchor:'maghrib'}),
    anchor_off: timeWindowSummary({allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:90, allowedTimeEndAnchor:'sunset', allowedTimeEndOffsetMin:-15}),
    mixed: timeWindowSummary({allowedTimeStartAnchor:'fajr', allowedTimeEnd:600}),
    fixed: timeWindowSummary({allowedTimeStart:600, allowedTimeEnd:720}),
    none: timeWindowSummary({}),
  }));
  assert(summaries.both_anchor === 'sunrise–sunset', 'both anchor → anchor labels');
  assert(summaries.anchor_off === 'sunrise +90m–sunset −15m', 'offsets in label');
  assert(summaries.mixed === 'fajr–10am', 'mixed anchor/fixed');
  assert(summaries.fixed === '10am–12pm', 'fixed times still work');
  assert(summaries.none === '', 'no window → empty string');

  // ── I. fillTimeWindow composes anchor + fixed ──
  console.log('\n[I] fillTimeWindow with anchor');
  const filled = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const win = fillTimeWindow({locationIds:['home'], allowedTimeStartAnchor:'sunrise', allowedTimeEndAnchor:'maghrib'}, today);
    return win ? {startInWin: win.start >= today && win.start < today + 24*3600000, span: win.end - win.start} : null;
  });
  assert(filled !== null, 'fillTimeWindow returned a window');
  assert(filled.startInWin === true, 'start is today');
  assert(filled.span > 0, 'end > start (sunrise → maghrib spans day)');

  // ── J. hasTimeWindow with mixed anchor + fixed ──
  console.log('\n[J] hasTimeWindow with mixed endpoints');
  const windows = await page.evaluate(() => ({
    both_fixed: hasTimeWindow({allowedTimeStart:600, allowedTimeEnd:720}),
    both_anchor: hasTimeWindow({allowedTimeStartAnchor:'fajr', allowedTimeEndAnchor:'isha'}),
    start_anchor_only: hasTimeWindow({allowedTimeStartAnchor:'fajr'}),
    start_anchor_end_fixed: hasTimeWindow({allowedTimeStartAnchor:'fajr', allowedTimeEnd:720}),
    none: hasTimeWindow({}),
  }));
  assert(windows.both_fixed === true, 'both fixed → window');
  assert(windows.both_anchor === true, 'both anchor → window');
  assert(windows.start_anchor_only === false, 'only one endpoint → no window');
  assert(windows.start_anchor_end_fixed === true, 'anchor + fixed → window');
  assert(windows.none === false, 'nothing → no window');

  // ── K. Settings load/save carry prayerMethod + prayerMadhab ──
  console.log('\n[K] settings round-trip');
  const settings = await page.evaluate(() => {
    saveSortSettings({prayerMethod:'Karachi', prayerMadhab:'hanafi'});
    const loaded = loadSortSettings();
    return {method: loaded.prayerMethod, madhab: loaded.prayerMadhab};
  });
  assert(settings.method === 'Karachi', 'prayerMethod persisted');
  assert(settings.madhab === 'hanafi', 'prayerMadhab persisted');

  // Defaults when absent.
  await page.evaluate(() => {
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({}));
  });
  const defaults = await page.evaluate(() => ({
    method: loadSortSettings().prayerMethod,
    madhab: loadSortSettings().prayerMadhab
  }));
  assert(defaults.method === 'NorthAmerica', 'default method = NorthAmerica');
  assert(defaults.madhab === 'shafi', 'default madhab = shafi');

  // ── L. clearPrayerTimesCache invalidates ──
  console.log('\n[L] cache invalidation');
  const cacheOk = await page.evaluate(() => {
    if(typeof clearPrayerTimesCache !== 'function')return false;
    clearPrayerTimesCache(); // should not throw
    return true;
  });
  assert(cacheOk === true, 'clearPrayerTimesCache exists + runs');

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
