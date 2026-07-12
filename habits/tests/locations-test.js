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

  // ── L. ASYNC: geocodeSearch — parses Nominatim results ──
  console.log('\n[L] geocodeSearch — Nominatim parsing + filtering');
  await setMock(page, { 'nominatim.openstreetmap.org': { status:200, json:[
    { display_name:'10 Downing Street, Westminster, London', lat:'51.5034', lon:'-0.1276' },
    { display_name:'Eiffel Tower, Paris', lat:'48.8584', lon:'2.2945' },
    { display_name:'Bad', lat:'not-a-number', lon:'0' }   // invalid lat -> filtered
  ]}});
  const geo = await page.evaluate(q => geocodeSearch(q), '10 downing');
  console.log(geo);
  assert(geo.length === 2, 'invalid-lat result filtered (2 survive)');
  assert(geo[0].name === '10 Downing Street', 'name = first comma segment');
  assert(geo[0].lat === 51.5034 && geo[0].lng === -0.1276, 'lat/lng parsed as numbers');
  assert(geo[0].address.length > 0, 'address carried through');

  // ── M. ASYNC: geocodeSearch — empty query + failure both return [] ──
  console.log('\n[M] geocodeSearch — empty query + failure');
  await setMock(page, { 'nominatim.openstreetmap.org':'REJECT' });
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

  // ── O. Boot cleanliness ──
  console.log('\n[O] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors during run (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
