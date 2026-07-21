// Phase 3 — locations settings UI end-to-end.
//
// Exercises the full registry manager: geocode add, manual hour editing,
// closed-days, per-day overrides, preferred time, 24h toggle, GPS add, and the
// dangling-id sweep on remove. Network (Nominatim) and geolocation are mocked
// so the suite is deterministic and offline-safe.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/locations-settings-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

async function openSettings(page){
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    // Avoid stale SW-cached JS during local test runs.
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
      if(window.caches?.keys){
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving'
    }));
    // Mock fetch for Nominatim geocoding.
    window.__mockRoutes = {};
    const realFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      for(const key of Object.keys(window.__mockRoutes)){
        if(url.indexOf(key) >= 0){
          const spec = window.__mockRoutes[key];
          if(spec === 'REJECT')return Promise.reject(new Error('mock-reject'));
          return Promise.resolve(new Response(JSON.stringify(spec.json), {
            status:spec.status || 200, headers:{ 'Content-Type':'application/json' }
          }));
        }
      }
      return realFetch(input, init);
    };
    // Mock geolocation (returns a fixed NYC coordinate).
    navigator.geolocation.getCurrentPosition = (ok,_err) => ok({
      coords:{ latitude:40.7589, longitude:-73.9851, accuracy:50 }, timestamp:Date.now()
    });
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  // ── A. The locations section exists and starts empty ──
  console.log('\n[A] locations section — empty state');
  await openSettings(page);
  await page.locator('#settings-locations-head').click();
  await page.waitForSelector('#settings-locations-body:not([hidden])');
  const emptyVisible = await page.locator('#location-empty-hint').isVisible();
  assert(emptyVisible, 'empty hint shown when no locations');

  // ── B. Add a location via map picker + geocode ──
  console.log('\n[B] add via map picker (mocked Photon)');
  await page.evaluate(() => { window.__mockRoutes = {
    'photon.komoot.io': { json:{
      type:'FeatureCollection',
      features:[
        { type:'Feature', geometry:{ type:'Point', coordinates:[-0.1276,51.5034] },
          properties:{ name:'10 Downing Street', city:'London', country:'United Kingdom', street:'Downing Street' } },
        { type:'Feature', geometry:{ type:'Point', coordinates:[0.1178,52.1227] },
          properties:{ name:'Downing College', city:'Cambridge', country:'United Kingdom' } }
      ]
    }},
    'nominatim.openstreetmap.org': { json:[
      { display_name:'10 Downing Street, Westminster, London', lat:'51.5034', lon:'-0.1276' }
    ]}
  };});
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-name').fill('Office');
  await page.locator('#picker-search').fill('10 Downing Street');
  await page.locator('#picker-search-btn').click();
  await page.waitForSelector('#picker-results .location-result');
  const resultCount = await page.locator('#picker-results .location-result').count();
  assert(resultCount === 2, 'geocode returned 2 candidates');
  // Pick the first (London).
  await page.locator('#picker-results .location-result').first().click();
  await page.waitForTimeout(200);
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const rows = await page.locator('#location-list .location-row').count();
  assert(rows === 1, 'one location row rendered after pick');
  const name0 = await page.locator('[data-loc-name="0"]').inputValue();
  assert(name0 === 'Office', 'location name = typed name (Office)');
  const persisted = await page.evaluate(() => {
    const s = loadSortSettings();
    const loc = s.locations[0];
    return { count:s.locations.length, id:loc.id, name:loc.name, lat:loc.lat, lng:loc.lng };
  });
  console.log(persisted);
  assert(persisted.count === 1 && persisted.name === 'Office', 'location persisted to settings');
  assert(Math.abs(persisted.lat - 51.5034) < 0.001, 'lat from geocode result');
  assert(persisted.id && persisted.id.length > 8, 'stable id generated');

  // ── C. Uncheck All day → default 09–17, then set 11:00–17:00 ──
  console.log('\n[C] default open window (11:00–17:00)');
  await page.locator('[data-loc-allday="0"]').click();
  await page.waitForTimeout(150);
  const afterUncheck = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    const btn = document.querySelector('[data-loc-allday="0"]');
    return {
      start:loc.allowedTimeStart,
      end:loc.allowedTimeEnd,
      on:!!(btn && btn.classList.contains('on')),
      startDisabled:!!document.querySelector('[data-loc-start="0"]')?.disabled
    };
  });
  console.log(afterUncheck);
  assert(afterUncheck.on === false, 'All day turns off and stays off');
  assert(afterUncheck.start === 540 && afterUncheck.end === 1020, 'uncheck applies default 09:00–17:00');
  assert(afterUncheck.startDisabled === false, 'hours inputs enabled after uncheck');
  await page.locator('[data-loc-start="0"]').fill('11:00');
  await page.locator('[data-loc-end="0"]').fill('17:00');
  await page.locator('[data-loc-end="0"]').blur();
  await page.waitForTimeout(200);
  const hrs = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    return { start:loc.allowedTimeStart, end:loc.allowedTimeEnd };
  });
  console.log(hrs);
  assert(hrs.start === 660 && hrs.end === 1020, 'open window persisted as 660/1020');

  // ── C2. Radius is editable ──
  console.log('\n[C2] radius edit');
  const radiusBefore = await page.evaluate(() => loadSortSettings().locations[0].radiusM);
  assert(radiusBefore === 75, 'default radius is 75m (got ' + radiusBefore + ')');
  await page.locator('[data-loc-radius="0"]').fill('120');
  await page.locator('[data-loc-radius="0"]').blur();
  await page.waitForTimeout(150);
  const radiusAfter = await page.evaluate(() => loadSortSettings().locations[0].radiusM);
  assert(radiusAfter === 120, 'radius persisted as 120m');

  // ── D. Toggle a closed day (Sunday) — behind More ──
  console.log('\n[D] closed day (Sunday)');
  await page.locator('[data-loc-more="0"]').click();
  await page.waitForSelector('[data-location-more="0"]:not([hidden])');
  await page.locator('[data-loc-closed-day="0"][data-loc-index="0"]').click();   // Sun = 0
  await page.waitForTimeout(150);
  const cd = await page.evaluate(() => loadSortSettings().locations[0].closedDays);
  console.log(cd);
  assert(JSON.stringify(cd) === JSON.stringify([0]), 'Sunday added to closedDays');
  // Toggle it back off.
  await page.locator('[data-loc-closed-day="0"][data-loc-index="0"]').click();
  await page.waitForTimeout(150);
  const cdOff = await page.evaluate(() => loadSortSettings().locations[0].closedDays);
  assert(JSON.stringify(cdOff) === JSON.stringify([]), 'Sunday removed from closedDays');

  // ── E. Per-day override + preferred time (More already open) ──
  console.log('\n[E] per-day override + preferred time');
  if(await page.locator('[data-location-more="0"]').isHidden()){
    await page.locator('[data-loc-more="0"]').click();
    await page.waitForSelector('[data-location-more="0"]:not([hidden])');
  }
  // Saturday (6) override: 12:00–15:00
  await page.locator('[data-loc-day-start="6"][data-loc-day-idx="0"]').fill('12:00');
  await page.locator('[data-loc-day-end="6"][data-loc-day-idx="0"]').fill('15:00');
  await page.locator('[data-loc-day-end="6"][data-loc-day-idx="0"]').blur();
  await page.waitForTimeout(150);
  // Preferred: 14:00–16:00
  await page.locator('[data-loc-pref-start="0"]').fill('14:00');
  await page.locator('[data-loc-pref-end="0"]').fill('16:00');
  await page.locator('[data-loc-pref-end="0"]').blur();
  await page.waitForTimeout(150);
  const more = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    return { sat:loc.hoursByDay[6], prefStart:loc.preferredTimeStart, prefEnd:loc.preferredTimeEnd };
  });
  console.log(more);
  assert(JSON.stringify(more.sat) === JSON.stringify({ start:720, end:900 }), 'Saturday per-day override persisted');
  assert(more.prefStart === 840 && more.prefEnd === 960, 'preferred window persisted');

  // ── F. Per-day "closed" checkbox ──
  console.log('\n[F] per-day closed (Wednesday)');
  await page.evaluate(() => {
    const c = document.querySelector('[data-loc-day-closed="3"][data-loc-day-idx="0"]');
    if(!c.checked){ c.click(); saveLocationDayPatch(0,3,{closed:true}); }
  });
  await page.waitForTimeout(150);
  const wed = await page.evaluate(() => loadSortSettings().locations[0].hoursByDay[3]);
  assert(wed === null, 'Wednesday override = null (closed)');
  // Uncheck → override dropped (falls back to default).
  await page.evaluate(() => {
    const c = document.querySelector('[data-loc-day-closed="3"][data-loc-day-idx="0"]');
    if(c.checked){ c.click(); saveLocationDayPatch(0,3,{closed:false}); }
  });
  await page.waitForTimeout(150);
  const wedOff = await page.evaluate(() => loadSortSettings().locations[0].hoursByDay[3]);
  assert(wedOff === undefined, 'Wednesday override dropped after uncheck');

  // ── G. All day toggle clears / restores a window ──
  console.log('\n[G] All day toggle');
  await page.locator('[data-loc-allday="0"]').click(); // turn on all day
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    const btn = document.querySelector('[data-loc-allday="0"]');
    return { start:loc.allowedTimeStart, end:loc.allowedTimeEnd, on:!!(btn && btn.classList.contains('on')) };
  });
  console.log(cleared);
  assert(cleared.on === true, 'All day turns on');
  assert(cleared.start === null && cleared.end === null, 'All day clears the window');
  // Turn off → default 09:00–17:00
  await page.locator('[data-loc-allday="0"]').click();
  await page.waitForTimeout(200);
  const restored = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    const btn = document.querySelector('[data-loc-allday="0"]');
    return { start:loc.allowedTimeStart, end:loc.allowedTimeEnd, on:!!(btn && btn.classList.contains('on')) };
  });
  assert(restored.on === false, 'All day turns off again');
  assert(restored.start === 540 && restored.end === 1020, 'turning off restores 09:00–17:00');
  await page.locator('[data-loc-start="0"]').fill('09:00');
  await page.locator('[data-loc-end="0"]').fill('21:00');
  await page.locator('[data-loc-end="0"]').blur();
  await page.waitForTimeout(150);

  // ── H. GPS add via picker ──
  console.log('\n[H] add via GPS (mocked geolocation) in picker');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-name').fill('Gym');
  await page.locator('#picker-gps').click();
  await page.waitForTimeout(400);
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const gps = await page.evaluate(() => {
    const s = loadSortSettings();
    const gym = s.locations.find(l => l.name === 'Gym');
    return gym ? { lat:gym.lat, lng:gym.lng, optIn:s.locationOptIn } : null;
  });
  console.log(gps);
  assert(gps && Math.abs(gps.lat - 40.7589) < 0.001, 'GPS location added with mocked coords');
  assert(gps.optIn === true, 'locationOptIn persisted after grant');
  assert(await page.locator('#location-list .location-row').count() === 2, 'two locations now in registry');

  // ── H1. Pan map → pin follows center; Pin button snaps ──
  console.log('\n[H1] drop pin at map center after pan');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.waitForTimeout(200);
  const beforeDrop = await page.evaluate(() => ({
    lat:Number(document.querySelector('#picker-lat')?.value),
    lng:Number(document.querySelector('#picker-lng')?.value)
  }));
  // Pan only — moveend should auto-sync the pin to the crosshair.
  await page.evaluate(() => {
    if(!pickerMap)throw new Error('no map');
    pickerMap.setView([41.8781,-87.6298],15,{animate:false});
  });
  await page.waitForTimeout(200);
  const afterPan = await page.evaluate(() => ({
    lat:Number(document.querySelector('#picker-lat')?.value),
    lng:Number(document.querySelector('#picker-lng')?.value),
    marker:pickerMarker ? pickerMarker.getLatLng() : null
  }));
  console.log({ beforeDrop, afterPan });
  assert(Math.abs(afterPan.lat - 41.8781) < 0.002, 'pan moveend snaps pin lat');
  assert(Math.abs(afterPan.lng - (-87.6298)) < 0.002, 'pan moveend snaps pin lng');
  assert(await page.locator('#picker-drop-pin').textContent().then(t => t.trim() === 'Pin'), 'Pin button label is short');
  // Explicit Pin after another pan (with stop) still works.
  await page.evaluate(() => {
    pickerMap.setView([34.0522,-118.2437],14,{animate:false});
  });
  await page.waitForTimeout(100);
  await page.locator('#picker-drop-pin').click();
  await page.waitForTimeout(100);
  const afterDrop = await page.evaluate(() => ({
    lat:Number(document.querySelector('#picker-lat')?.value),
    lng:Number(document.querySelector('#picker-lng')?.value)
  }));
  assert(Math.abs(afterDrop.lat - 34.0522) < 0.002, 'Pin button uses map center lat');
  assert(Math.abs(afterDrop.lng - (-118.2437)) < 0.002, 'Pin button uses map center lng');
  await page.locator('#picker-cancel').click();
  await page.waitForTimeout(100);

  // Settings enable-location control + rationale sheet.
  console.log('\n[H2] settings enable location control');
  await page.evaluate(() => {
    // Reset opt-in so the rationale sheet shows again.
    if(typeof stopLocationWatch === 'function')stopLocationWatch();
    currentCoord = null;
    updateSortSetting({locationOptIn:false},{renderNow:false,sync:false});
    renderLocationAccessControl();
  });
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => ({
    optIn:loadSortSettings().locationOptIn,
    hasCoord:!!currentCoord,
    btn:document.querySelector('#location-access-enable')?.textContent
  }));
  console.log(before);
  assert(before.optIn === false && !before.hasCoord, 'opt-in cleared before re-enable');
  await page.locator('#location-access-enable').click();
  await page.waitForSelector('#location-permission-sheet.open');
  // Click Allow (user-gesture path iOS requires); mock geo resolves sync.
  await page.locator('#location-permission-allow').click();
  await page.waitForTimeout(150);
  const accessAfter = await page.evaluate(() => ({
    optIn:loadSortSettings().locationOptIn,
    hasCoord:!!currentCoord,
    statusText:document.querySelector('#location-access-status')?.textContent || '',
    sheetOpen:document.querySelector('#location-permission-sheet')?.classList.contains('open')
  }));
  console.log(accessAfter);
  assert(accessAfter.optIn === true, 'enable location → allow sets locationOptIn');
  assert(accessAfter.hasCoord === true, 'enable location → allow sets currentCoord');
  assert(/on/i.test(accessAfter.statusText), 'access status shows on');
  assert(accessAfter.sheetOpen === false, 'permission sheet closes after allow');

  // ── I. Dangling-id sweep on remove ──
  console.log('\n[I] remove location → dangling-id sweep');
  // Seed a habit referencing the first location's id.
  const firstId = await page.evaluate(() => loadSortSettings().locations[0].id);
  await page.evaluate(id => {
    const data = load();
    data.push({ name:'sweep-test', type:'keepup', target:7, logs:[], locationIds:[id], preferredLocationId:id });
    save(data);
  }, firstId);
  // Remove the first location (index 0).
  await page.locator('[data-loc-remove="0"]').click();
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => {
    const s = loadSortSettings();
    const h = load().find(x => x.name === 'sweep-test');
    return { locCount:s.locations.length, habitLocIds:h.locationIds, habitPref:h.preferredLocationId };
  });
  console.log(after);
  assert(after.locCount === 1, 'registry down to 1 after remove');
  assert(JSON.stringify(after.habitLocIds) === JSON.stringify([]), 'removed id swept off the habit');
  assert(after.habitPref === null, 'preferred referencing removed location nulled');

  // ── J. Travel edges referencing the removed location are pruned ──
  console.log('\n[J] travel-edge prune on remove');
  const edges = await page.evaluate(() => {
    const s = loadSortSettings();
    return { count:Object.keys(s.travel || {}).length };
  });
  assert(edges.count === 0, 'no travel edges linger referencing the removed location');

  // ── K. Name + address inline edit ──
  console.log('\n[K] inline name/address edit');
  await page.locator('[data-loc-name="0"]').fill('Gym Pro');
  await page.locator('[data-loc-name="0"]').blur();
  await page.waitForTimeout(150);
  await page.locator('[data-loc-address="0"]').fill('123 Fitness Ave');
  await page.locator('[data-loc-address="0"]').blur();
  await page.waitForTimeout(150);
  const edited = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    return { name:loc.name, address:loc.address };
  });
  console.log(edited);
  assert(edited.name === 'Gym Pro', 'name edit persisted');
  assert(edited.address === '123 Fitness Ave', 'address edit persisted');

  // ── L. Boot cleanliness ──
  console.log('\n[L] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
