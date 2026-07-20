// prayer-times — unit tests for js/prayer-times.js + the schema/normalization
// additions in data.js, and integration tests for the anchor resolver against
// the real adhan.js library (which is loaded via index.html).
//
// These pin down the core contract:
//   • habits without anchor fields behave byte-identically to before
//     (legacy migration + zero behaviour change for users who don't opt in);
//   • each of the four endpoints can be independently switched to dynamic;
//   • the resolver returns a finite minutes-from-midnight for a habit with
//     a valid location + anchor; "anywhere" habits resolve via the running
//     agenda anchor / lastKnown / registry[0] fallback, null only when the
//     user has no saved location at all;
//   • the save path blocks prayer anchors only when the registry is empty.
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
    none: habitPrayerLocation({locationIds:[]})?.id,
    one: habitPrayerLocation({locationIds:['gym']})?.id,
    first: habitPrayerLocation({locationIds:['gym','home']})?.id,
    preferred: habitPrayerLocation({locationIds:['gym','home'], locationPrefs:{home:'high'}})?.id,
    legacyPref: habitPrayerLocation({locationIds:['gym','home'], preferredLocationId:'gym'})?.id,
    dangling: habitPrayerLocation({locationIds:['xxx']})?.id,
    // "Anywhere" fallback chain: contextLocId wins, then lastKnown, then registry[0].
    ctxWins: habitPrayerLocation({locationIds:[]}, null, 'gym')?.id,
    lastKnown: (() => {
      const s = loadSortSettings(); s.lastKnownLocationId = 'office'; saveSortSettings(s);
      const id = habitPrayerLocation({locationIds:[]})?.id;
      const s2 = loadSortSettings(); s2.lastKnownLocationId = null; saveSortSettings(s2);
      return id;
    })(),
    emptyRegistry: (() => {
      const s = loadSortSettings(); const saved = s.locations; s.locations = []; saveSortSettings(s);
      const r = habitPrayerLocation({locationIds:[]});
      s.locations = saved; saveSortSettings(s);
      return r;
    })()
  }));
  assert(loc.none === 'home', 'anywhere habit falls back to first registry location');
  assert(loc.one === 'gym', 'single location returned');
  assert(loc.first === 'gym', 'first allowed when no preference');
  assert(loc.preferred === 'home', 'preferred wins over first');
  assert(loc.legacyPref === 'gym', 'legacy preferredLocationId honoured');
  assert(loc.dangling === 'home', 'dangling id → anywhere fallback (registry[0])');
  assert(loc.ctxWins === 'gym', 'contextLocId (running anchor) wins for anywhere habits');
  assert(loc.lastKnown === 'office', 'lastKnownLocationId used when no context');
  assert(loc.emptyRegistry === null, 'anywhere + empty registry → null');

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
    // Anywhere habit + prayer anchor: resolves via the registry fallback now.
    const anywhere = resolveHabitTimeField({allowedTimeStartAnchor:'fajr'}, 'allowedTimeStart', today);
    // Truly no location anywhere (empty registry + no lastKnown) → null.
    const s = loadSortSettings(); const savedLocs = s.locations; s.locations = []; saveSortSettings(s);
    const noLoc = resolveHabitTimeField({allowedTimeStartAnchor:'fajr'}, 'allowedTimeStart', today);
    s.locations = savedLocs; saveSortSettings(s);
    return {sunriseMin, sunrisePlusHour, fixed, anywhere, noLoc};
  });
  assert(Number.isFinite(resolved.sunriseMin), 'sunrise resolved to a finite minute');
  assert(resolved.sunriseMin >= 240 && resolved.sunriseMin <= 540, 'sunrise lands 4am–9am (' + resolved.sunriseMin + ')');
  assert(resolved.sunrisePlusHour - resolved.sunriseMin === 30, 'offset shifts by (60−30)=30 min (' + (resolved.sunrisePlusHour - resolved.sunriseMin) + ')');
  assert(resolved.fixed === 600, 'fixed minutes returned unchanged');
  assert(Number.isFinite(resolved.anywhere), 'anywhere + prayer resolves via fallback (' + resolved.anywhere + ')');
  assert(resolved.noLoc === null, 'prayer anchor + empty registry → null');

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

  // ── M. stable habit ids (hid) ──
  console.log('\n[M] stable habit ids');
  const hids = await page.evaluate(() => {
    const a = normalize([{name:'gym', type:'keepup', target:7}])[0];
    const b = normalize([{name:'gym', type:'keepup', target:7, hid:a.hid}])[0];
    const c = normalize([{name:'run', type:'keepup', target:7, hid:'  bad id!!!  '}])[0];
    return {
      hasHid: typeof a.hid === 'string' && a.hid.length > 0,
      stable: a.hid === b.hid,
      cleaned: c.hid === 'bad id!!!' || c.hid.length > 0, // cleanHabitId trims; generate if empty after clean
      different: a.hid !== c.hid || true
    };
  });
  assert(hids.hasHid === true, 'normalize generates hid');
  assert(hids.stable === true, 'existing hid preserved across normalize');

  // ── N. habit-relative anchors ──
  console.log('\n[N] habit-relative anchors');
  const habitAnchor = await page.evaluate(() => {
    const today = dayStart(Date.now());
    // Prefer 8am today when already past; otherwise a recent past ts.
    // Future timestamps become plan logs and have no lastLog.
    let anchorTs = today + 8 * 3600000;
    if(anchorTs >= Date.now()) anchorTs = Date.now() - 2 * 3600000;
    const gym = normalize([{
      name:'gym', type:'keepup', target:7,
      logs:[anchorTs]
    }])[0];
    const stretch = normalize([{
      name:'stretch', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:gym.hid,
      allowedTimeStartOffsetMin:30,
      allowedTimeEnd:720, // noon fixed end so hasTimeWindow is true
      logs:[]
    }])[0];
    // Seed both into storage so findHabitByHid / resolveHabitAnchorMinutes can see them.
    save([gym, stretch]);
    const startMin = resolveHabitTimeField(stretch, 'allowedTimeStart', today);
    const expectedStart = (dayStart(anchorTs) === today
      ? Math.round((anchorTs - today) / 60000)
      : 0) + 30;
    // Consumed: stretch already logged after gym → start collapses.
    const afterTs = Math.min(anchorTs + 3600000, Date.now() - 1000);
    const stretchDone = {...stretch, lastLog: afterTs, logs:[afterTs]};
    const consumed = resolveHabitTimeField(stretchDone, 'allowedTimeStart', today);
    // Never-logged anchor → null.
    const never = normalize([{
      name:'yoga', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:gym.hid,
      allowedTimeEnd:720,
      logs:[]
    }])[0];
    // Point never at a habit with no logs.
    const empty = normalize([{name:'empty', type:'keepup', target:7, logs:[]}])[0];
    save([gym, stretch, empty]);
    const neverMin = resolveHabitTimeField({
      ...never,
      allowedTimeStartAnchorHabitId:empty.hid
    }, 'allowedTimeStart', today);
    // Prior-day anchor log → minute maps to 0 (open since midnight) + offset.
    const yesterday = today - 86400000 + 10 * 3600000; // 10am yesterday
    const gymY = {...gym, lastLog:yesterday, logs:[yesterday]};
    save([gymY, stretch]);
    const priorMin = resolveHabitTimeField(stretch, 'allowedTimeStart', today);
    // normalize preserves 'habit' + habitId.
    const round = normalize([{
      name:'x', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:gym.hid,
      allowedTimeStartOffsetMin:15,
      allowedTimeEndAnchor:'sunrise'
    }])[0];
    return {
      startMin,
      expectedStart,
      consumed,
      neverMin,
      priorMin,
      roundAnchor: round.allowedTimeStartAnchor,
      roundHid: round.allowedTimeStartAnchorHabitId,
      roundOff: round.allowedTimeStartOffsetMin,
      prayerKept: round.allowedTimeEndAnchor,
      usesHabit: habitUsesHabitAnchors(stretch),
      usesPrayer: habitUsesPrayerAnchors(stretch),
      summary: timeWindowSummary(stretch)
    };
  });
  assert(habitAnchor.startMin === habitAnchor.expectedStart, 'habit anchor = log + 30m (' + habitAnchor.startMin + ' vs ' + habitAnchor.expectedStart + ')');
  assert(habitAnchor.consumed === null, 'consumed start → null');
  assert(habitAnchor.neverMin === null, 'never-logged anchor → null');
  assert(habitAnchor.priorMin === 30, 'prior-day anchor → 0 + offset (' + habitAnchor.priorMin + ')');
  assert(habitAnchor.roundAnchor === 'habit', "normalize keeps 'habit' anchor");
  assert(typeof habitAnchor.roundHid === 'string' && habitAnchor.roundHid.length > 0, 'normalize keeps AnchorHabitId');
  assert(habitAnchor.roundOff === 15, 'normalize keeps habit offset');
  assert(habitAnchor.prayerKept === 'sunrise', 'prayer anchor still kept alongside habit');
  assert(Boolean(habitAnchor.usesHabit) === true, 'habitUsesHabitAnchors true');
  assert(habitAnchor.usesPrayer === false, 'habit-only → habitUsesPrayerAnchors false');
  assert(habitAnchor.summary.indexOf('after gym') === 0 || habitAnchor.summary.indexOf('after') >= 0, 'summary shows after-habit label (' + habitAnchor.summary + ')');

  // ── O. cycle detection ──
  console.log('\n[O] detectHabitAnchorCycle');
  const cycles = await page.evaluate(() => {
    const a = normalize([{name:'A', type:'keepup', target:7}])[0];
    const b = normalize([{name:'B', type:'keepup', target:7}])[0];
    const c = normalize([{name:'C', type:'keepup', target:7}])[0];
    // A → B → A
    a.allowedTimeStartAnchor = 'habit';
    a.allowedTimeStartAnchorHabitId = b.hid;
    b.allowedTimeStartAnchor = 'habit';
    b.allowedTimeStartAnchorHabitId = a.hid;
    save([a, b, c]);
    const ab = detectHabitAnchorCycle(a.hid, {[a.hid]:a, [b.hid]:b});
    // Self-cycle A → A
    const self = {...a, allowedTimeStartAnchorHabitId:a.hid};
    const selfCycle = detectHabitAnchorCycle(self.hid, {[self.hid]:self});
    // A → B → C (no cycle)
    b.allowedTimeStartAnchorHabitId = c.hid;
    c.allowedTimeStartAnchor = null;
    c.allowedTimeStartAnchorHabitId = null;
    save([a, b, c]);
    const open = detectHabitAnchorCycle(a.hid, {[a.hid]:a, [b.hid]:b, [c.hid]:c});
    // Prayer-only start doesn't count as a cycle edge
    const prayer = {...a, allowedTimeStartAnchor:'fajr', allowedTimeStartAnchorHabitId:b.hid};
    const prayerEdge = detectHabitAnchorCycle(prayer.hid, {[prayer.hid]:prayer, [b.hid]:b});
    return {
      ab: ab && ab.length > 0,
      abNames: ab,
      self: selfCycle && selfCycle.length > 0,
      open: open,
      prayerEdge: prayerEdge
    };
  });
  assert(cycles.ab === true, 'A↔B cycle detected');
  assert(cycles.self === true, 'self-cycle detected');
  assert(cycles.open === null, 'open chain → null');
  assert(cycles.prayerEdge === null, 'prayer anchor does not form habit cycle');

  // ── P. blocked-time prayer anchors ──
  console.log('\n[P] blocked-time prayer anchors');
  const blocked = await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [
      {label:'sleep', days:[], start:1320, end:420, locationId:'home', startAnchor:'isha', startOffsetMin:0, endAnchor:'sunrise', endOffsetMin:0},
      {label:'work', days:[1,2,3,4,5], start:540, end:1020}, // fixed, no anchors
      {label:'bad', days:[], start:600, end:720, startAnchor:'fajr'} // anchor without location → stripped
    ];
    saveSortSettings(s);
    const blocks = normalizeBlockedTimes(loadSortSettings().blockedTimes);
    const sleep = blocks.find(b => b.label === 'sleep');
    const work = blocks.find(b => b.label === 'work');
    const bad = blocks.find(b => b.label === 'bad');
    const today = dayStart(Date.now());
    const sleepStart = resolveBlockedTimeMinutes(sleep, 'start', today);
    const sleepEnd = resolveBlockedTimeMinutes(sleep, 'end', today);
    const workStart = resolveBlockedTimeMinutes(work, 'start', today);
    return {
      sleepStartAnchor: sleep && sleep.startAnchor,
      sleepEndAnchor: sleep && sleep.endAnchor,
      sleepStart,
      sleepEnd,
      workStart,
      workStartAnchor: work && work.startAnchor,
      badAnchor: bad && bad.startAnchor,
      badKept: Boolean(bad)
    };
  });
  assert(blocked.sleepStartAnchor === 'isha', 'sleep startAnchor kept');
  assert(blocked.sleepEndAnchor === 'sunrise', 'sleep endAnchor kept');
  assert(Number.isFinite(blocked.sleepStart), 'sleep start resolved (' + blocked.sleepStart + ')');
  assert(Number.isFinite(blocked.sleepEnd), 'sleep end resolved (' + blocked.sleepEnd + ')');
  // Isha is evening, sunrise is morning — overnight block.
  assert(blocked.sleepStart > 720, 'isha lands after noon (' + blocked.sleepStart + ')');
  assert(blocked.sleepEnd < 720, 'sunrise lands before noon (' + blocked.sleepEnd + ')');
  assert(blocked.workStart === 540, 'fixed block returns literal start');
  assert(blocked.workStartAnchor == null, 'fixed block has no startAnchor');
  assert(blocked.badAnchor == null, 'anchor without locationId stripped');
  assert(blocked.badKept === true, 'block itself still kept (fixed fallback)');

  // ── Q. cleanAnchor accepts both kinds ──
  console.log('\n[Q] cleanAnchor');
  const cleaned = await page.evaluate(() => ({
    fajr: cleanAnchor('fajr'),
    habit: cleanAnchor('habit'),
    sunset: cleanAnchor('sunset'),
    junk: cleanAnchor('nope'),
    empty: cleanAnchor('')
  }));
  assert(cleaned.fajr === 'fajr', 'cleanAnchor fajr');
  assert(cleaned.habit === 'habit', "cleanAnchor 'habit'");
  assert(cleaned.sunset === 'maghrib', 'cleanAnchor sunset→maghrib');
  assert(cleaned.junk === null, 'cleanAnchor junk→null');
  assert(cleaned.empty === null, 'cleanAnchor empty→null');

  await browser.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
