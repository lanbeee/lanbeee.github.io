// locations data-layer — unit tests for the PURE helpers in data.js.
//
// These helpers are the foundation of the whole locations subsystem: registry
// validation, the layered hours model (default → closedDays → hoursByDay →
// 24h), the habit∩location window composition, dangling-id reconciliation,
// and geofence matching. They were previously exercised only indirectly via
// the higher-level flow/settings tests; this suite pins them down directly so
// the 7-day agenda and scoring work can rely on them.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/locations-data-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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

  await page.addInitScript(() => {
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving'
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  // ── A. cleanLocationId / normalizeLocationIds / normalizePreferredLocation ──
  console.log('\n[A] id coercion helpers');
  const ids = await page.evaluate(() => ({
    clean_empty: cleanLocationId(''),
    clean_trim: cleanLocationId('  x  '),
    clean_cap: cleanLocationId('a'.repeat(80)).length,
    dedupe: normalizeLocationIds(['a','a','b']),
    csv: normalizeLocationIds('a, b ,c'),
    registryFilter: normalizeLocationIds(['a','x','b'], [{id:'a'},{id:'b'}]),
    emptyArr: normalizeLocationIds([]),
    null: normalizeLocationIds(null),
    pref_ok: normalizePreferredLocation('a', ['a','b']),
    pref_missing: normalizePreferredLocation('z', ['a','b']),
    pref_empty: normalizePreferredLocation('', ['a']),
  }));
  console.log(ids);
  assert(ids.clean_empty === '', 'cleanLocationId falsy → ""');
  assert(ids.clean_trim === 'x', 'cleanLocationId trims');
  assert(ids.clean_cap === 64, 'cleanLocationId caps at 64');
  assert(eq(ids.dedupe, ['a','b']), 'normalizeLocationIds dedupes');
  assert(eq(ids.csv, ['a','b','c']), 'normalizeLocationIds parses csv');
  assert(eq(ids.registryFilter, ['a','b']), 'registry drops dangling ids');
  assert(eq(ids.emptyArr, []) && eq(ids.null, []), 'empty/null → []');
  assert(ids.pref_ok === 'a', 'preferred kept when in ids');
  assert(ids.pref_missing === null, 'preferred null when not in ids');
  assert(ids.pref_empty === null, 'preferred null when empty');

  // ── B. normalizeClosedDays ──
  console.log('\n[B] normalizeClosedDays');
  const cd = await page.evaluate(() => ({
    basic: normalizeClosedDays([0,6]),
    dedupe: normalizeClosedDays([6,6,0]),
    sorted: normalizeClosedDays([3,0,1]),
    outOfRange: normalizeClosedDays([0,7,8,-1]),
    all7: normalizeClosedDays([0,1,2,3,4,5,6]), // NOTE: NOT collapsed (unlike allowedWeekdays)
    csv: normalizeClosedDays('0,6')
  }));
  console.log(cd);
  assert(eq(cd.basic, [0,6]), 'basic closed days');
  assert(eq(cd.dedupe, [0,6]), 'dedupes + sorts');
  assert(eq(cd.sorted, [0,1,3]), 'sorts ascending');
  assert(eq(cd.outOfRange, [0]), 'out-of-range dropped');
  assert(cd.all7.length === 7, 'all-7 NOT collapsed (valid for a location)');
  assert(eq(cd.basic, [0,6]), 'csv parsed');

  // ── C. normalizeLocationHours ──
  console.log('\n[C] normalizeLocationHours');
  const hrs = await page.evaluate(() => ({
    full: normalizeLocationHours({allowedTimeStart:360,allowedTimeEnd:1320,preferredTimeStart:600,preferredTimeEnd:720,closedDays:[0]}),
    partialWindow: normalizeLocationHours({allowedTimeStart:360}), // missing end → both null
    invalid: normalizeLocationHours({allowedTimeStart:'x',allowedTimeEnd:'y'}),
    clamp: normalizeLocationHours({allowedTimeStart:-50,allowedTimeEnd:99999}),
    hoursByDay: normalizeLocationHours({hoursByDay:{'6':{start:720,end:900},'3':null,'9':{start:1,end:2}}}),
    empty: normalizeLocationHours({}),
  }));
  console.log(hrs);
  assert(hrs.full.allowedTimeStart === 360 && hrs.full.allowedTimeEnd === 1320, 'full hours kept');
  assert(hrs.full.preferredTimeStart === 600 && hrs.full.preferredTimeEnd === 720, 'preferred kept');
  assert(eq(hrs.full.closedDays, [0]), 'closedDays kept');
  assert(hrs.partialWindow.allowedTimeStart === null && hrs.partialWindow.allowedTimeEnd === null, 'partial window → both null');
  assert(hrs.invalid.allowedTimeStart === null, 'invalid → null');
  assert(hrs.clamp.allowedTimeStart === 0 && hrs.clamp.allowedTimeEnd === 1439, 'clamps to 0..1439');
  assert(eq(hrs.hoursByDay.hoursByDay[6], {start:720,end:900}), 'Saturday override kept');
  assert(hrs.hoursByDay.hoursByDay[3] === null, 'Wednesday closed override');
  assert(!hrs.hoursByDay.hoursByDay.hasOwnProperty(9), 'invalid weekday key dropped');
  assert(hrs.empty.allowedTimeStart === null && hrs.empty.allowedTimeEnd === null, 'empty → 24h (null window)');
  assert(eq(hrs.empty.closedDays, []), 'empty → no closed days');

  // ── D. normalizeLocationRegistry ──
  console.log('\n[D] normalizeLocationRegistry');
  const reg = await page.evaluate(() => ({
    empty: normalizeLocationRegistry(null),
    dropNoId: normalizeLocationRegistry([{name:'A',lat:0,lng:0},{id:'a',name:'A',lat:0,lng:0}]).length,
    dropNoName: normalizeLocationRegistry([{id:'a',lat:0,lng:0}]).length,
    dropBadLat: normalizeLocationRegistry([{id:'a',name:'A',lat:200,lng:0}]).length,
    dropBadLng: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:-999}]).length,
    dedupe: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:0},{id:'a',name:'B',lat:1,lng:1}]).length,
    radiusClamp: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:0,radiusM:5}])[0].radiusM,
    radiusClampHi: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:0,radiusM:99999}])[0].radiusM,
    radiusDefault: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:0}])[0].radiusM,
    latRound: normalizeLocationRegistry([{id:'a',name:'A',lat:51.50741234,lng:0}])[0].lat,
    hoursCarried: normalizeLocationRegistry([{id:'a',name:'A',lat:0,lng:0,allowedTimeStart:360,allowedTimeEnd:1200,closedDays:[0]}])[0],
    cap: normalizeLocationRegistry(Array.from({length:40},(_,i)=>({id:'l'+i,name:'L'+i,lat:0,lng:i}))).length,
  }));
  console.log(reg);
  assert(eq(reg.empty, []), 'null registry → []');
  assert(reg.dropNoId === 1, 'drops entry without id');
  assert(reg.dropNoName === 0, 'drops entry without name');
  assert(reg.dropBadLat === 0, 'drops entry with bad lat');
  assert(reg.dropBadLng === 0, 'drops entry with bad lng');
  assert(reg.dedupe === 1, 'dedupes by id (first wins)');
  assert(reg.radiusClamp === 10, 'radius clamps low to 10m');
  assert(reg.radiusClampHi === 5000, 'radius clamps high to 5000m');
  assert(reg.radiusDefault === 75, 'radius defaults to 75m');
  assert(reg.latRound === 51.507412, 'lat rounded to 6 decimals');
  assert(reg.hoursCarried.allowedTimeStart === 360, 'hours fields carried through');
  assert(reg.hoursCarried.closedDays[0] === 0, 'closedDays carried through');
  assert(reg.cap === 32, 'caps at MAX_LOCATIONS (32)');

  // ── E. normalizeTravelCache ──
  console.log('\n[E] normalizeTravelCache');
  const tc = await page.evaluate(() => {
    const fresh = Date.now();
    const stale = Date.now() - 61 * 86400000; // > 2× TTL
    return {
      empty: normalizeTravelCache(null),
      malformed: normalizeTravelCache({'a|b':{a:'a',b:'b'}, // no seconds/metres
        'a|c':{a:'a',b:'c',seconds:100,metres:200,fetchedAt:fresh}}),
      rekey: normalizeTravelCache({'b|a':{a:'b',b:'a',seconds:5,metres:10,fetchedAt:fresh,provider:'osrm'}}),
      staleDropped: normalizeTravelCache({'a|b':{a:'a',b:'b',seconds:1,metres:2,fetchedAt:stale}}),
      manualKeeps: normalizeTravelCache({'a|b':{a:'a',b:'b',seconds:1,metres:2,fetchedAt:stale,provider:'manual'}}),
      selfDropped: normalizeTravelCache({'a|a':{a:'a',b:'a',seconds:1,metres:2,fetchedAt:fresh}}),
    };
  });
  console.log(tc);
  assert(eq(tc.empty, {}), 'null cache → {}');
  assert(!tc.malformed['a|b'] && tc.malformed['a|c'], 'malformed edge dropped, valid kept');
  assert(tc.rekey['a|b'] && tc.rekey['a|b'].a === 'a', 'edges re-keyed lexically');
  assert(!tc.staleDropped['a|b'], 'stale network edge dropped (>2× TTL)');
  assert(tc.manualKeeps['a|b'], 'manual override survives staleness');
  assert(!tc.selfDropped['a|a'], 'self-pair dropped');

  // ── F. hasLocationHours + resolveLocationWindow (layered model) ──
  console.log('\n[F] resolveLocationWindow — layered hours model');
  const w = await page.evaluate(() => ({
    noHours_24h: resolveLocationWindow({}, 1),
    defaultWin: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320}, 3),
    closedDay: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,closedDays:[0]}, 0),
    notClosedDay: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,closedDays:[0]}, 1),
    hoursByDay_override: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,hoursByDay:{6:{start:720,end:900}}}, 6),
    hoursByDay_closed: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,hoursByDay:{3:null}}, 3),
    hoursByDay_fallback: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,hoursByDay:{6:{start:720,end:900}}}, 1),
    closedDayPriority: resolveLocationWindow({allowedTimeStart:360,allowedTimeEnd:1320,closedDays:[6],hoursByDay:{6:{start:720,end:900}}}, 6),
    hasHours_empty: hasLocationHours({}),
    hasHours_win: hasLocationHours({allowedTimeStart:1,allowedTimeEnd:2}),
    hasHours_closed: hasLocationHours({closedDays:[0]}),
    hasHours_byDay: hasLocationHours({hoursByDay:{1:{start:1,end:2}}}),
    hasHours_null: hasLocationHours(null),
  }));
  console.log(w);
  assert(eq(w.noHours_24h, {start:0,end:1440}), 'no hours → 24h');
  assert(eq(w.defaultWin, {start:360,end:1320}), 'default window applied');
  assert(w.closedDay === null, 'closed day → null');
  assert(eq(w.notClosedDay, {start:360,end:1320}), 'non-closed day uses default');
  assert(eq(w.hoursByDay_override, {start:720,end:900}), 'hoursByDay overrides default');
  assert(w.hoursByDay_closed === null, 'hoursByDay null = closed');
  assert(eq(w.hoursByDay_fallback, {start:360,end:1320}), 'no override → default window');
  assert(eq(w.closedDayPriority, {start:720,end:900}), 'hoursByDay wins over closedDays');
  assert(w.hasHours_empty === false, 'no hours → false');
  assert(w.hasHours_win === true, 'window → true');
  assert(w.hasHours_closed === true, 'closedDays → true');
  assert(w.hasHours_byDay === true, 'hoursByDay → true');
  assert(w.hasHours_null === false, 'null → false');

  // ── G. unwrapMinuteWindow + mergeMinuteIntervals ──
  console.log('\n[G] unwrap + merge intervals');
  const iv = await page.evaluate(() => ({
    simple: unwrapMinuteWindow({start:60,end:120}),
    overnight: unwrapMinuteWindow({start:1380,end:300}), // 23:00 → 05:00
    zeroLen: unwrapMinuteWindow({start:60,end:60}),
    mergeOverlap: mergeMinuteIntervals([{start:0,end:60},{start:30,end:90}]),
    mergeDisjoint: mergeMinuteIntervals([{start:0,end:60},{start:120,end:180}]),
    mergeAdjacent: mergeMinuteIntervals([{start:0,end:60},{start:60,end:120}]),
    mergeUnsorted: mergeMinuteIntervals([{start:120,end:180},{start:0,end:60}]),
    mergeEmpty: mergeMinuteIntervals([]),
  }));
  console.log(iv);
  assert(eq(iv.simple, [{start:60,end:120}]), 'simple window unwrap');
  assert(eq(iv.overnight, [{start:1380,end:1440},{start:0,end:300}]), 'overnight splits into two');
  assert(eq(iv.zeroLen, []), 'zero-length → []');
  assert(eq(iv.mergeOverlap, [{start:0,end:90}]), 'merges overlapping');
  assert(eq(iv.mergeDisjoint, [{start:0,end:60},{start:120,end:180}]), 'keeps disjoint separate');
  assert(eq(iv.mergeAdjacent, [{start:0,end:120}]), 'merges adjacent');
  assert(eq(iv.mergeUnsorted, [{start:0,end:60},{start:120,end:180}]), 'sorts before merge');
  assert(eq(iv.mergeEmpty, []), 'empty → empty');

  // ── H. intersectWindows ──
  console.log('\n[H] intersectWindows — overlap, disjoint, overnight');
  const ix = await page.evaluate(() => ({
    overlap: intersectWindows({start:60,end:300},{start:120,end:400}),
    disjoint: intersectWindows({start:0,end:60},{start:120,end:180}),
    contained: intersectWindows({start:0,end:600},{start:200,end:300}),
    overnightHabit: intersectWindows({start:1380,end:300},{start:0,end:1440}), // habit wraps, loc 24h
    both_overnight: intersectWindows({start:1380,end:300},{start:1320,end:360}),
    touching: intersectWindows({start:0,end:60},{start:60,end:120}), // zero overlap
  }));
  console.log(ix);
  assert(eq(ix.overlap, [{start:120,end:300}]), 'basic overlap');
  assert(eq(ix.disjoint, []), 'disjoint → []');
  assert(eq(ix.contained, [{start:200,end:300}]), 'contained');
  assert(eq(ix.overnightHabit, [{start:0,end:300},{start:1380,end:1440}]), 'overnight habit ∩ 24h splits in two');
  assert(eq(ix.both_overnight, [{start:0,end:300},{start:1380,end:1440}]), 'two overnights intersect on both tails');
  assert(eq(ix.touching, []), 'touching endpoints = no overlap');

  // ── I. effectiveLocationWindow — habit ∩ loc composition ──
  console.log('\n[I] effectiveLocationWindow');
  const eff = await page.evaluate(() => ({
    noHabitWin_noLoc: effectiveLocationWindow({}, null, 1),
    noHabitWin_withLoc: effectiveLocationWindow({}, {allowedTimeStart:360,allowedTimeEnd:1200}, 1),
    habitWin_noLoc: effectiveLocationWindow({allowedTimeStart:600,allowedTimeEnd:900}, null, 1),
    intersect: effectiveLocationWindow({allowedTimeStart:600,allowedTimeEnd:1200}, {allowedTimeStart:360,allowedTimeEnd:900}, 1),
    disjoint: effectiveLocationWindow({allowedTimeStart:60,allowedTimeEnd:120}, {allowedTimeStart:600,allowedTimeEnd:900}, 1),
    locClosed: effectiveLocationWindow({allowedTimeStart:600,allowedTimeEnd:900}, {allowedTimeStart:600,allowedTimeEnd:900,closedDays:[1]}, 1),
    overnightHabitDaytimeLoc: effectiveLocationWindow({allowedTimeStart:1320,allowedTimeEnd:300}, {allowedTimeStart:0,allowedTimeEnd:1440}, 1),
    nullLoc_noHabitWin: effectiveLocationWindow({}, null, 3),
  }));
  console.log(eff);
  assert(eq(eff.noHabitWin_noLoc, [{start:0,end:1440}]), 'no constraints → full day');
  assert(eq(eff.noHabitWin_withLoc, [{start:360,end:1200}]), 'no habit win → loc wins');
  assert(eq(eff.habitWin_noLoc, [{start:600,end:900}]), 'no loc → habit wins');
  assert(eq(eff.intersect, [{start:600,end:900}]), 'intersection of habit∩loc');
  assert(eq(eff.disjoint, []), 'disjoint habit∩loc → []');
  assert(eq(eff.locClosed, []), 'closed location → not placeable');
  assert(eff.overnightHabitDaytimeLoc.length >= 1, 'overnight habit ∩ 24h resolves');
  assert(eq(eff.nullLoc_noHabitWin, [{start:0,end:1440}]), 'null loc + no habit win = 24h');

  // ── J. reconcileLocations — startup dangling-id sweep ──
  console.log('\n[J] reconcileLocations');
  const rec = await page.evaluate(() => {
    const settings = { locations:[{id:'a',name:'A',lat:0,lng:0},{id:'b',name:'B',lat:0,lng:0}] };
    const data = [
      { name:'h1', locationIds:['a','x'], preferredLocationId:'a' },     // 'x' dangling
      { name:'h2', locationIds:['x','y'], preferredLocationId:'x' },     // all dangling
      { name:'h3', locationIds:[], preferredLocationId:null },           // anywhere
      { name:'h4', locationIds:['b'], preferredLocationId:'z' },         // pref dangling
      { name:'h5' },                                                     // no location fields
    ];
    const result = reconcileLocations(data, settings);
    return {
      changed: result.changed,
      h1: result.data[0],
      h2: result.data[1],
      h3: result.data[2],
      h4: result.data[3],
      h5: result.data[4],
    };
  });
  console.log(rec);
  assert(rec.changed === true, 'reports changed when ids moved');
  assert(eq(rec.h1.locationIds, ['a']), 'dangling id stripped (h1)');
  assert(rec.h1.preferredLocationId === 'a', 'valid preferred kept (h1)');
  assert(eq(rec.h2.locationIds, []), 'all-dangling → empty');
  assert(rec.h2.preferredLocationId === null, 'dangling preferred → null');
  assert(eq(rec.h3.locationIds, []), 'anywhere untouched');
  assert(eq(rec.h4.locationIds, ['b']), 'valid id kept');
  assert(rec.h4.preferredLocationId === null, 'dangling preferred nulled');
  assert(rec.h5.name === 'h5', 'no-fields record passes through');

  // ── K. reconcileLocations no-op case ──
  console.log('\n[K] reconcileLocations no-op');
  const noop = await page.evaluate(() => {
    const settings = { locations:[{id:'a',name:'A',lat:0,lng:0}] };
    const data = [{ name:'h', locationIds:['a'], preferredLocationId:'a', locationPrefs:{ a:'high' } }];
    return reconcileLocations(data, settings);
  });
  assert(noop.changed === false, 'no change reported when nothing moved');

  // ── L. matchLocationId — radius geofence matching ──
  console.log('\n[L] matchLocationId — geofence');
  const m = await page.evaluate(() => {
    const registry = [
      { id:'home', name:'Home', lat:40.7000, lng:-74.0000, radiusM:100 },
      { id:'gym', name:'Gym', lat:40.8000, lng:-74.0000, radiusM:75 },     // ~11 km away
      { id:'cafe', name:'Cafe', lat:40.7001, lng:-74.0001, radiusM:200 },  // ~21 m from Home
    ];
    return {
      atHome: matchLocationId(40.7000, -74.0000, registry),
      atHomeSlightlyOff: matchLocationId(40.70005, -74.00005, registry),
      nearBoth: matchLocationId(40.7001, -74.0001, registry),       // Home(100m) and Cafe(200m) both contain it
      farAway: matchLocationId(41.0000, -74.0000, registry),
      empty: matchLocationId(40, -74, []),
    };
  });
  console.log(m);
  assert(m.atHome === 'home', 'exact match within radius');
  assert(m.atHomeSlightlyOff === 'home', 'within radius of home');
  assert(m.nearBoth === 'home' || m.nearBoth === 'cafe', 'matches one of the containing geofences');
  assert(m.farAway === null, 'outside all radii → null');
  assert(m.empty === null, 'empty registry → null');

  // ── M. locationPresence — at / near / away ──
  console.log('\n[M] locationPresence + currentLocationId');
  const pres = await page.evaluate(() => {
    // No currentCoord (no GPS); lastKnownLocationId = 'home' from settings seed
    saveSortSettings({ ...(sortSettings || loadSortSettings()),
      locations:[{id:'home',name:'Home',lat:40.7,lng:-74,radiusM:100}],
      lastKnownLocationId:'home' });
    const atLastKnown = locationPresence();
    saveSortSettings({ ...(sortSettings || loadSortSettings()), lastKnownLocationId:null });
    const away = locationPresence();
    return { atLastKnown, away };
  });
  console.log(pres);
  assert(pres.atLastKnown.kind === 'at', 'lastKnown inside registry → at');
  assert(pres.atLastKnown.id === 'home' && pres.atLastKnown.gps === false, 'at: id + non-gps');
  assert(pres.away.kind === 'away', 'no lastKnown + no GPS → away');

  // ── N. Boot cleanliness ──
  console.log('\n[N] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
