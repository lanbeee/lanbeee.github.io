// locations.js — unit tests for the travel-time provider layer.
//
// Runs the real app in a headless browser and exercises the locations module
// in-place. Network is fully mocked (no real OSRM/Nominatim calls) so the
// suite is deterministic and offline-safe. Mirrors the e2e harness pattern
// used by tests/habits-e2e.js.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/locations-test.js
//
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

const LOC_A = { id:'loc-a', name:'A', lat:51.5074, lng:-0.1278 };   // London
const LOC_B = { id:'loc-b', name:'B', lat:48.8566, lng:2.3522 };    // Paris  (~344 km)
const LOC_C = { id:'loc-c', name:'C', lat:40.7128, lng:-74.0060 };  // NYC City Hall
const LOC_D = { id:'loc-d', name:'D', lat:40.7589, lng:-73.9851 };  // NYC Times Sq (~5.4 km)

// Mirror of the constants defined in js/locations.js. Top-level `const`
// declarations live in the page's lexical scope but aren't surfaced on
// `window`, so the Node test runner can't read them by name — duplicate the
// literal values here and assert against the duplicates.
const CURRENT_COORD_ID = '__current__';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

// Fetch mock controller installed via addInitScript. `window.__mockRoutes` maps
// a URL substring to either {status,json} (HTTP-ish) or the literal 'REJECT'.
// Unmatched URLs fall through to the real network (we avoid any in tests).
async function setMock(page, routes){
  await page.evaluate(r => { window.__mockRoutes = r; }, routes || {});
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    // Seed an empty registry + empty travel cache so locations.js has clean state.
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving'
    }));
    // Install the fetch mock BEFORE any module runs.
    window.__mockRoutes = {};
    const realFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      for(const key of Object.keys(window.__mockRoutes)){
        if(url.indexOf(key) >= 0){
          const spec = window.__mockRoutes[key];
          if(spec === 'REJECT')return Promise.reject(new Error('mock-reject'));
          return Promise.resolve(new Response(JSON.stringify(spec.json), {
            status:spec.status || 200,
            headers:{ 'Content-Type':'application/json' }
          }));
        }
      }
      return realFetch(input, init);
    };
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  // ── A. PURE: haversineMetres against known great-circle distances ──
  console.log('\n[A] haversineMetres — known distances');
  const hav = await page.evaluate(([a,b,c,d]) => ({
    londonParis: haversineMetres(a.lat,a.lng,b.lat,b.lng),
    parisLondon: haversineMetres(b.lat,b.lng,a.lat,a.lng),
    nycPair: haversineMetres(c.lat,c.lng,d.lat,d.lng),
    zero: haversineMetres(c.lat,c.lng,c.lat,c.lng)
  }), [LOC_A,LOC_B,LOC_C,LOC_D]);
  console.log(hav);
  assert(Math.abs(hav.londonParis - 343500) < 1500, 'London→Paris ≈ 344 km (got ' + hav.londonParis + ')');
  assert(hav.londonParis === hav.parisLondon, 'symmetric: A→B === B→A');
  assert(Math.abs(hav.nycPair - 5420) < 200, 'NYC pair ≈ 5.4 km (got ' + hav.nycPair + ')');
  assert(hav.zero === 0, 'same point = 0 m');

  // ── B. PURE: haversineTravelSeconds per mode ──
  console.log('\n[B] haversineTravelSeconds — per-mode speed');
  const secs = await page.evaluate(() => ({
    driving: haversineTravelSeconds(10000,'driving'),    // 10 km @ 40 km/h ≈ 900 s
    walking: haversineTravelSeconds(10000,'walking'),    // 10 km @ 5 km/h  ≈ 7200 s
    bicycling: haversineTravelSeconds(10000,'bicycling'),// 10 km @ 15 km/h ≈ 2400 s
    transit: haversineTravelSeconds(10000,'transit'),    // 10 km @ 20 km/h ≈ 1800 s
    badMode: haversineTravelSeconds(10000,'teleport')    // unknown -> driving default
  }));
  console.log(secs);
  assert(Math.abs(secs.driving - 900) < 2, 'driving 10km ≈ 900s');
  assert(Math.abs(secs.walking - 7200) < 5, 'walking 10km ≈ 7200s');
  assert(Math.abs(secs.bicycling - 2400) < 5, 'bicycling 10km ≈ 2400s');
  assert(Math.abs(secs.transit - 1800) < 5, 'transit 10km ≈ 1800s');
  assert(secs.badMode === secs.driving, 'unknown mode falls back to driving');

  // ── C. PURE: edgeKey symmetry + haversineEdge shape ──
  console.log('\n[C] edgeKey + haversineEdge');
  const ek = await page.evaluate(([a,b]) => ({
    ab: edgeKey(a.id,b.id),
    ba: edgeKey(b.id,a.id),
    self: edgeKey(a.id,a.id),
    edge: haversineEdge(a,b,'driving')
  }), [LOC_A,LOC_B]);
  console.log(ek);
  assert(ek.ab === ek.ba, 'edgeKey symmetric');
  assert(ek.ab === 'loc-a|loc-b', 'lexically ordered key (got ' + ek.ab + ')');
  assert(ek.self === 'loc-a|loc-a', 'self-pair key');
  assert(ek.edge.provider === 'haversine' && ek.edge.fetchedAt === 0, 'haversineEdge marked floor');
  assert(ek.edge.seconds > 0 && ek.edge.metres > 0, 'haversineEdge has positive time+distance');
  assert(ek.edge.a === 'loc-a' && ek.edge.b === 'loc-b', 'haversineEdge ids lexically ordered');

  // ── D. ASYNC: fetchEdge — OSRM success path (driving) ──
  console.log('\n[D] fetchEdge — OSRM success');
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:780, distance:5800 }] } } });
  const ok = await page.evaluate(async ([a,b]) => fetchEdge(a,b,'driving'), [LOC_C,LOC_D]);
  console.log(ok);
  assert(ok.provider === 'osrm', 'OSRM success → provider osrm');
  assert(ok.seconds === 780 && ok.metres === 5800, 'OSRM success → routed values');

  // ── E. ASYNC: fetchEdge — OSRM failure → haversine fallback ──
  console.log('\n[E] fetchEdge — OSRM failure falls back to haversine');
  await setMock(page, { 'router.project-osrm.org': 'REJECT' });
  const fb = await page.evaluate(async ([a,b]) => {
    const got = await fetchEdge(a,b,'driving');
    const refMetres = haversineMetres(a.lat,a.lng,b.lat,b.lng);
    const refSecs = haversineTravelSeconds(refMetres,'driving');
    return { got, refMetres, refSecs };
  }, [LOC_C,LOC_D]);
  console.log(fb);
  assert(fb.got.provider === 'haversine', 'OSRM reject → provider haversine');
  assert(fb.got.metres === fb.refMetres, 'fallback uses haversine distance');
  assert(fb.got.seconds === fb.refSecs, 'fallback uses driving-speed seconds');

  // ── F. ASYNC: fetchEdge — malformed OSRM body → haversine fallback ──
  console.log('\n[F] fetchEdge — malformed OSRM body falls back');
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[] } } });
  const mal = await page.evaluate(async ([a,b]) => fetchEdge(a,b,'driving'), [LOC_C,LOC_D]);
  assert(mal.provider === 'haversine', 'empty routes array → haversine');

  // ── G. ASYNC: fetchEdge — non-driving mode skips network entirely ──
  console.log('\n[G] fetchEdge — non-driving uses haversine, no network');
  await setMock(page, { 'router.project-osrm.org': 'REJECT' }); // would fail if called
  const walk = await page.evaluate(async ([a,b]) => {
    const got = await fetchEdge(a,b,'walking');
    const refSecs = haversineTravelSeconds(haversineMetres(a.lat,a.lng,b.lat,b.lng),'walking');
    return { got, refSecs };
  }, [LOC_C,LOC_D]);
  console.log(walk);
  assert(walk.got.provider === 'haversine', 'walking → haversine (no OSRM call)');
  assert(walk.got.seconds === walk.refSecs, 'walking uses walking-speed seconds');

  // ── H. ASYNC: refreshEdge writes to cache + invokes hook ──
  console.log('\n[H] refreshEdge — writes cache, fires hook');
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:900, distance:6100 }] } } });
  const refreshed = await page.evaluate(async ([a,b]) => {
    let hook = null;
    onTravelRefresh = e => { hook = e; };
    const edge = await refreshEdge(a,b,'driving');
    const fromCache = sortSettings.travel[edgeKey(a.id,b.id)];
    onTravelRefresh = null;
    return { edge, fromCache, hook };
  }, [LOC_A,LOC_B]);
  console.log(refreshed);
  assert(refreshed.edge.provider === 'osrm', 'refreshEdge fetched OSRM');
  assert(refreshed.edge.fetchedAt > 0, 'refreshEdge stamped fetchedAt');
  assert(refreshed.fromCache && refreshed.fromCache.seconds === 900, 'edge landed in sortSettings.travel');
  assert(refreshed.hook && refreshed.hook.seconds === 900, 'onTravelRefresh hook fired with the edge');

  // ── I. SYNC: travelBetween — fresh cache hit returns immediately ──
  console.log('\n[I] travelBetween — fresh cache hit (no network)');
  await setMock(page, { 'router.project-osrm.org':'REJECT' }); // any call would fail
  const hit = await page.evaluate(([a,b]) => travelBetween(a,b,'driving'), [LOC_A,LOC_B]);
  console.log(hit);
  assert(hit && hit.seconds === 900 && hit.provider === 'osrm', 'fresh cache returned without re-fetch');

  // ── J. SYNC: travelBetween — missing cache returns haversine + kicks refresh ──
  console.log('\n[J] travelBetween — missing cache returns haversine floor');
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:1234, distance:7000 }] } } });
  const floor = await page.evaluate(([a,b]) => {
    delete sortSettings.travel[edgeKey(a.id,b.id)];   // ensure uncached
    const before = travelBetween(a,b,'driving');        // sync: must be haversine
    const refSecs = haversineTravelSeconds(haversineMetres(a.lat,a.lng,b.lat,b.lng),'driving');
    return { before_provider: before.provider, before_seconds: before.seconds, refSecs };
  }, [LOC_C,LOC_D]);
  console.log(floor);
  assert(floor.before_provider === 'haversine', 'no cache → haversine floor returned synchronously');
  assert(floor.before_seconds === floor.refSecs, 'floor uses driving-speed seconds');
  // The background refresh fires; after a tick the cache should hold the OSRM result.
  await page.waitForTimeout(150);
  const warmed = await page.evaluate(([a,b]) => {
    const e = sortSettings.travel[edgeKey(a.id,b.id)];
    return e ? { provider:e.provider, seconds:e.seconds } : null;
  }, [LOC_C,LOC_D]);
  console.log(warmed);
  assert(warmed && warmed.provider === 'osrm' && warmed.seconds === 1234, 'background refresh warmed the cache');

  // ── K. SYNC: travelBetween — stale cache returns stale + kicks refresh ──
  console.log('\n[K] travelBetween — stale cache: return stale, refresh in background');
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:4321, distance:8888 }] } } });
  const stale = await page.evaluate(([a,b]) => {
    const key = edgeKey(a.id,b.id);
    sortSettings.travel[key] = { a:a.id, b:b.id, seconds:111, metres:222, provider:'osrm', fetchedAt: Date.now() - (31 * 86400000) }; // 31 days old
    const got = travelBetween(a,b,'driving'); // stale → returns stale immediately
    return { got_seconds: got.seconds, got_provider: got.provider };
  }, [LOC_A,LOC_B]);
  console.log(stale);
  assert(stale.got_seconds === 111, 'stale cache returned immediately (111)');
  assert(stale.got_provider === 'osrm', 'stale provider preserved');
  await page.waitForTimeout(150);
  const revalidated = await page.evaluate(([a,b]) => sortSettings.travel[edgeKey(a.id,b.id)].seconds, [LOC_A,LOC_B]);
  assert(revalidated === 4321, 'stale edge revalidated to 4321 in background');

  // ── L. ASYNC: geocodeSearch — parses Photon results (primary) ──
  console.log('\n[L] geocodeSearch — Photon parsing + filtering');
  await setMock(page, {
    'photon.komoot.io': { status:200, json:{
      type:'FeatureCollection',
      features:[
        { type:'Feature', geometry:{ type:'Point', coordinates:[-0.1276,51.5034] },
          properties:{ name:'10 Downing Street', city:'London', country:'UK' } },
        { type:'Feature', geometry:{ type:'Point', coordinates:[2.2945,48.8584] },
          properties:{ name:'Eiffel Tower', city:'Paris', country:'France' } },
        { type:'Feature', geometry:{ type:'Point', coordinates:['bad',0] },
          properties:{ name:'Bad' } }
      ]
    }},
    'nominatim.openstreetmap.org': { status:200, json:[] }
  });
  const geo = await page.evaluate(q => geocodeSearch(q), '10 downing');
  console.log(geo);
  assert(geo.length === 2, 'invalid-lat result filtered (2 survive)');
  assert(geo[0].name === '10 Downing Street', 'name from Photon properties');
  assert(geo[0].lat === 51.5034 && geo[0].lng === -0.1276, 'lat/lng parsed as numbers');
  assert(geo[0].address.length > 0, 'address carried through');

  // ── M. ASYNC: geocodeSearch — empty query + failure both return [] ──
  console.log('\n[M] geocodeSearch — empty query + failure');
  await setMock(page, {
    'photon.komoot.io':'REJECT',
    'nominatim.openstreetmap.org':'REJECT'
  });
  const empty = await page.evaluate(() => geocodeSearch('   '));
  const failed = await page.evaluate(() => geocodeSearch('anything'));
  assert(empty.length === 0, 'empty query → []');
  assert(failed.length === 0, 'network failure → [] (no throw)');

  // ── N. PERSIST: flushTravelCache writes the cache to localStorage ──
  console.log('\n[N] flushTravelCache — persists to localStorage');
  const persisted = await page.evaluate(() => {
    flushTravelCache();
    const raw = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    return { keys: Object.keys(raw.travel || {}), hasA: Boolean(raw.travel && raw.travel['loc-a|loc-b']) };
  });
  console.log(persisted);
  assert(persisted.hasA, 'travel cache persisted to localStorage via flushTravelCache');

  // ── P. CURRENT-COORD: pure helpers (currentCoordLocation, isCurrentCoordAwayFromSaved) ──
  console.log('\n[P] currentCoordLocation + isCurrentCoordAwayFromSaved');
  // Test locations used for the current-coord scenarios.
  const HOME = { id:'loc-home', name:'Home', lat:40.7400, lng:-74.0000 };
  const OFFICE = { id:'loc-office', name:'Office', lat:40.7500, lng:-74.0100 };  // ~1.3 km from Home
  await page.evaluate(([home,office]) => {
    sortSettings.locations = [home,office];
    sortSettings.lastKnownLocationId = null;
    sortSettings.pinnedLocationId = null;
    currentCoord = null;
  }, [HOME,OFFICE]);
  const noCoord = await page.evaluate(() => ({
    loc: currentCoordLocation(),
    away: isCurrentCoordAwayFromSaved()
  }));
  console.log(noCoord);
  assert(noCoord.loc === null, 'no currentCoord → currentCoordLocation() null');
  assert(noCoord.away === false, 'no currentCoord → not "away" (no fix to anchor with)');

  // GPS fix 30 m from Home — inside the 75 m geofence → matched, not away.
  await page.evaluate(home => {
    applyGeoPosition({ coords:{ latitude:home.lat + 0.00027, longitude:home.lng } },{ updateAnchor:false });
  }, HOME);
  const atHome = await page.evaluate(() => ({
    loc: currentCoordLocation(),
    away: isCurrentCoordAwayFromSaved()
  }));
  console.log(atHome);
  assert(atHome.loc && atHome.loc.id === CURRENT_COORD_ID, 'currentCoordLocation returns synthetic id');
  assert(atHome.away === false, 'inside Home radius → not away from saved');

  // GPS fix ~5 km away from both — outside every radius → away.
  await page.evaluate(() => {
    applyGeoPosition({ coords:{ latitude:40.7900, longitude:-73.9700 } },{ updateAnchor:false }); // ~5-6 km NE
  });
  const away = await page.evaluate(() => ({
    loc: currentCoordLocation(),
    away: isCurrentCoordAwayFromSaved()
  }));
  console.log(away);
  assert(away.loc && Number.isFinite(away.loc.lat), 'currentCoordLocation carries the live lat');
  assert(away.away === true, '5+ km from any saved → away');

  // ── Q. CURRENT-COORD: travelFromCurrent — haversine floor + bg OSRM refresh ──
  console.log('\n[Q] travelFromCurrent — haversine floor + background OSRM');
  await page.evaluate(() => { clearCurrentCoordEdgeCache(); });
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:999, distance:9123 }] } } });
  const firstRead = await page.evaluate(([office]) => {
    const here = currentCoordLocation();
    const refMetres = haversineMetres(here.lat,here.lng,office.lat,office.lng);
    const refSecs = haversineTravelSeconds(refMetres,'driving');
    const got = travelFromCurrent(office,'driving');
    return { got_provider:got.provider, got_seconds:got.seconds, refMetres, refSecs };
  }, [OFFICE]);
  console.log(firstRead);
  assert(firstRead.got_provider === 'haversine', 'first read returns haversine floor synchronously');
  assert(firstRead.got_seconds === firstRead.refSecs, 'floor seconds match great-circle distance');
  // Background OSRM lands and overwrites the cache.
  await page.waitForTimeout(150);
  const sigAfter = await page.evaluate(() => currentCoordEdgeSignature(), []);
  console.log('  sig after bg refresh: ' + sigAfter);
  assert(/osrm/.test(sigAfter), 'signature reflects OSRM provider after refresh');
  // Second read at the same coord → cached OSRM edge, NO new fetch.
  await setMock(page, { 'router.project-osrm.org':'REJECT' }); // any new call would fail
  const secondRead = await page.evaluate(([office]) => {
    const got = travelFromCurrent(office,'driving');
    return { provider:got.provider, seconds:got.seconds };
  }, [OFFICE]);
  console.log(secondRead);
  assert(secondRead.provider === 'osrm' && secondRead.seconds === 999, 'second read returns cached OSRM edge (no refetch)');

  // ── R. CURRENT-COORD: travelFromCurrent — movement threshold reuses cache ──
  console.log('\n[R] travelFromCurrent — small movement reuses cache');
  // Move the user ~50 m (well under CURRENT_COORD_RECOMPUTE_METRES=500).
  await page.evaluate(() => {
    const here = currentCoordLocation();
    applyGeoPosition({ coords:{ latitude:here.lat + 0.0005, longitude:here.lng } },{ updateAnchor:false });
  });
  await setMock(page, { 'router.project-osrm.org':'REJECT' }); // would fail if it tried to refetch
  const smallMove = await page.evaluate(([office]) => {
    const got = travelFromCurrent(office,'driving');
    return { provider:got.provider, seconds:got.seconds };
  }, [OFFICE]);
  console.log(smallMove);
  assert(smallMove.provider === 'osrm' && smallMove.seconds === 999, 'small movement reuses cached OSRM edge');

  // ── S. CURRENT-COORD: travelFromCurrent — significant movement invalidates cache ──
  console.log('\n[S] travelFromCurrent — significant movement recomputes');
  // Move the user ~700 m (beyond CURRENT_COORD_RECOMPUTE_METRES=500).
  await page.evaluate(() => {
    const here = currentCoordLocation();
    applyGeoPosition({ coords:{ latitude:here.lat + 0.0063, longitude:here.lng } },{ updateAnchor:false });
  });
  await setMock(page, { 'router.project-osrm.org': { status:200, json:{ routes:[{ duration:2222, distance:14000 }] } } });
  const bigMoveSync = await page.evaluate(([office]) => {
    const here = currentCoordLocation();
    const refMetres = haversineMetres(here.lat,here.lng,office.lat,office.lng);
    const refSecs = haversineTravelSeconds(refMetres,'driving');
    const got = travelFromCurrent(office,'driving');
    return { got_provider:got.provider, got_seconds:got.seconds, refSecs };
  }, [OFFICE]);
  console.log(bigMoveSync);
  assert(bigMoveSync.got_provider === 'haversine', 'beyond threshold → haversine floor returned synchronously');
  assert(bigMoveSync.got_seconds === bigMoveSync.refSecs, 'recomputed floor reflects new distance');
  await page.waitForTimeout(150);
  const bigMoveBg = await page.evaluate(([office]) => {
    const got = travelFromCurrent(office,'driving');
    return { provider:got.provider, seconds:got.seconds };
  }, [OFFICE]);
  console.log(bigMoveBg);
  assert(bigMoveBg.provider === 'osrm' && bigMoveBg.seconds === 2222, 'background refresh lands new OSRM edge');

  // ── T. CURRENT-COORD: non-driving modes skip OSRM entirely ──
  console.log('\n[T] travelFromCurrent — walking skips OSRM');
  await page.evaluate(() => { clearCurrentCoordEdgeCache(); });
  await setMock(page, { 'router.project-osrm.org':'REJECT' }); // would fail if called
  const walkEdge = await page.evaluate(([office]) => {
    const here = currentCoordLocation();
    const refMetres = haversineMetres(here.lat,here.lng,office.lat,office.lng);
    const refSecs = haversineTravelSeconds(refMetres,'walking');
    const got = travelFromCurrent(office,'walking');
    return { provider:got.provider, seconds:got.seconds, refSecs };
  }, [OFFICE]);
  console.log(walkEdge);
  assert(walkEdge.provider === 'haversine', 'walking → haversine (no OSRM call)');
  assert(walkEdge.seconds === walkEdge.refSecs, 'walking uses walking-speed seconds');

  // ── U. CURRENT-COORD: clearCurrentCoordEdgeCache drops the in-memory cache ──
  console.log('\n[U] clearCurrentCoordEdgeCache — cache eviction');
  await page.evaluate(() => { clearCurrentCoordEdgeCache(); });
  const sigCleared = await page.evaluate(() => currentCoordEdgeSignature());
  assert(sigCleared === '', 'signature empty after clear');
  // Cache is NOT persisted to localStorage.
  const lsPeek = await page.evaluate(cid => {
    const raw = JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}');
    return Object.keys(raw.travel || {}).filter(k => k.indexOf(cid) >= 0);
  }, CURRENT_COORD_ID);
  console.log('  persisted current-coord keys: ' + JSON.stringify(lsPeek));
  assert(lsPeek.length === 0, 'current-coord edges never persisted to localStorage');

  // ── V. CURRENT-COORD: buildCurrentCoordTravelLeg — week-branch leg builder ──
  console.log('\n[V] buildCurrentCoordTravelLeg — synthetic-leg decision tree');
  await page.evaluate(() => { clearCurrentCoordEdgeCache(); });
  const legAway = await page.evaluate(([office,home]) => {
    const here = currentCoordLocation();
    const registry = normalizeLocationRegistry(sortSettings.locations);
    const mode = normalizeTravelMode(sortSettings.defaultTravelMode);
    // First location-bearing row in chronological order.
    const seq = [{ kind:'fill', i:0, locationId:office.id, start:Date.now() + 3600000 }];
    const leg = buildCurrentCoordTravelLeg(seq,registry,mode,Date.now());
    return { here, leg, mode };
  }, [OFFICE,HOME]);
  console.log(legAway);
  assert(legAway.leg !== null, 'leg built when user is away from saved locations');
  assert(legAway.leg.row.from === CURRENT_COORD_ID, 'leg.from is the synthetic current-coord id');
  assert(legAway.leg.row.to === OFFICE.id, 'leg.to is the first row\'s location');
  assert(legAway.leg.row.fromCurrentCoord === true, 'leg carries the fromCurrentCoord flag');
  assert(legAway.leg.row.seconds > 0, 'leg has a positive travel time');

  // User walks up to the office (inside its radius) → leg suppressed.
  const legAtOffice = await page.evaluate(([office]) => {
    applyGeoPosition({ coords:{ latitude:office.lat + 0.0002, longitude:office.lng } },{ updateAnchor:false });
    const registry = normalizeLocationRegistry(sortSettings.locations);
    const mode = normalizeTravelMode(sortSettings.defaultTravelMode);
    const seq = [{ kind:'fill', i:0, locationId:office.id, start:Date.now() + 3600000 }];
    return buildCurrentCoordTravelLeg(seq,registry,mode,Date.now());
  }, [OFFICE]);
  console.log(legAtOffice);
  assert(legAtOffice === null, 'leg suppressed when user is inside a saved location (regular chain handles it)');

  // User away but next task too close (< 250 m) → leg suppressed.
  const legTooClose = await page.evaluate(([office]) => {
    applyGeoPosition({ coords:{ latitude:office.lat + 0.001, longitude:office.lng } },{ updateAnchor:false }); // ~110 m E
    const registry = normalizeLocationRegistry(sortSettings.locations);
    const mode = normalizeTravelMode(sortSettings.defaultTravelMode);
    const seq = [{ kind:'fill', i:0, locationId:office.id, start:Date.now() + 3600000 }];
    return buildCurrentCoordTravelLeg(seq,registry,mode,Date.now());
  }, [OFFICE]);
  console.log(legTooClose);
  assert(legTooClose === null, 'leg suppressed when distance < CURRENT_COORD_TRAVEL_CARD_MIN_METRES');

  // No location-bearing row → nothing to anchor to.
  const legNoTarget = await page.evaluate(() => {
    const registry = normalizeLocationRegistry(sortSettings.locations);
    const mode = normalizeTravelMode(sortSettings.defaultTravelMode);
    const seq = [{ kind:'fill', i:0, locationId:null, start:Date.now() + 3600000 }];
    return buildCurrentCoordTravelLeg(seq,registry,mode,Date.now());
  });
  assert(legNoTarget === null, 'leg suppressed when no row carries a saved location');

  // No currentCoord → no leg.
  await page.evaluate(() => { currentCoord = null; });
  const legNoGps = await page.evaluate(([office]) => {
    const registry = normalizeLocationRegistry(sortSettings.locations);
    const mode = normalizeTravelMode(sortSettings.defaultTravelMode);
    const seq = [{ kind:'fill', i:0, locationId:office.id, start:Date.now() + 3600000 }];
    return buildCurrentCoordTravelLeg(seq,registry,mode,Date.now());
  }, [OFFICE]);
  assert(legNoGps === null, 'leg suppressed when no live GPS fix');

  // ── W. Boot cleanliness ──
  console.log('\n[W] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors during run (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
