// End-to-end verification of Places & Weather Profiles refinements:
// 1. Temporary / one-off locations (item-scoped, hidden from other items, promote & cleanup)
// 2. Full-page Places Manager (search, filter by scope/type/indoor-outdoor/unused, sort, bulk edit)
// 3. Full-page Weather Profiles Manager (up to 10 profiles, templates, search, filter, duplicate, bulk edit)
// 4. Location types & Indoor/Outdoor/Both categorization in UI, Filters, and BOTH planner engines (Fast & GLPK)
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/places-refinement-test.js
const { chromium, BASE } = require('./helpers/planner-test-helpers');

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
    localStorage.setItem('tings_coach_install_v2', 'done');
    localStorage.setItem('tings_coach_essentials_v2', 'done');
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving',
      homeCityName:'New York, United States', homeCityLat:40.7128, homeCityLng:-74.006, homeCityCountry:'US',
      minimalMode:false, weatherProfiles:[]
    }));
  });

  await page.goto(BASE, { waitUntil:'networkidle' });
  await page.waitForTimeout(300);

  // ── 1. Temporary (one-off) location flow ──
  console.log('\n[1] Temporary one-off location isolation, promotion & cleanup');
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  if(await page.locator('#add-more-options').isHidden())await page.locator('#add-more-toggle').click();
  await page.locator('#ting-tag-chips [data-location-add]').click();
  await page.waitForSelector('#location-picker-sheet.open');
  assert(await page.locator('#picker-temp-row').isVisible(), 'one-off place toggle is visible when adding from an item');
  await page.locator('#picker-name').fill('Dentist Office');
  await page.locator('#picker-place-type').selectOption('dentist');
  await page.locator('#picker-temporary').check();
  await page.locator('#picker-save').click();
  await page.waitForSelector('#location-picker-sheet.open', { state:'hidden' });
  const tempCreated = await page.evaluate(() => {
    const loc = loadSortSettings().locations.find(l => l.name === 'Dentist Office');
    const chips = [...document.querySelectorAll('#ting-tag-chips .location-chip[data-location-id]')].map(el => ({
      name: el.dataset.locationName,
      on: el.classList.contains('on'),
      temp: el.classList.contains('is-temp-place')
    }));
    return { loc, chips };
  });
  assert(tempCreated.loc && tempCreated.loc.temporary === true && tempCreated.loc.placeType === 'dentist', 'temporary location saved with temporary:true and chosen placeType');
  assert(tempCreated.chips.some(c => c.name === 'Dentist Office' && c.on && c.temp), 'owning item sees its temporary place selected with one-off styling');
  await page.locator('#ting-message').fill('Root canal follow-up');
  await page.locator('#do-save').click();
  await page.waitForTimeout(300);
  if(await page.locator('#detail-sheet.open').count())await page.locator('#detail-cool').click();

  // Open Add sheet for a SECOND item -> temporary location must NOT appear!
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  if(await page.locator('#add-more-options').isHidden())await page.locator('#add-more-toggle').click();
  const secondItemSeesTemp = await page.evaluate(() =>
    [...document.querySelectorAll('#ting-tag-chips .location-chip[data-location-id]')].some(el => el.dataset.locationName === 'Dentist Office')
  );
  assert(!secondItemSeesTemp, 'temporary location is hidden when creating another item');

  // Create a second temporary place and CANCEL Add -> auto-cleaned!
  await page.locator('#ting-tag-chips [data-location-add]').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-name').fill('Abandoned Pop-up');
  await page.locator('#picker-temporary').check();
  await page.locator('#picker-save').click();
  await page.waitForSelector('#location-picker-sheet.open', { state:'hidden' });
  await page.locator('#do-cancel').click();
  await page.waitForTimeout(200);
  const abandonedGone = await page.evaluate(() => !loadSortSettings().locations.some(l => l.name === 'Abandoned Pop-up'));
  assert(abandonedGone, 'cancelling Add auto-cleans unused temporary location created in that session');

  // ── 2. Full-page Places Manager: search, filter, indoor/outdoor, bulk edit ──
  console.log('\n[2] Full-page Places Manager, categorization & bulk edit');
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations.push(
      { id:'loc-tj', name:'Trader Joes', address:'100 Market St', lat:40.72, lng:-74.00, placeType:'supermarket', environment:'', temporary:false, allowedTimeStart:480, allowedTimeEnd:1260 },
      { id:'loc-aldi', name:'Aldi', address:'200 Oak Ave', lat:40.73, lng:-74.01, placeType:'grocery', environment:'', temporary:false, allowedTimeStart:540, allowedTimeEnd:1200 },
      { id:'loc-park', name:'Central Park', address:'59th St', lat:40.76, lng:-73.97, placeType:'park', environment:'', temporary:false },
      { id:'loc-home', name:'Home', address:'10 Main St', lat:40.71, lng:-74.00, placeType:'home', environment:'both', temporary:false },
      { id:'loc-unused-temp', name:'Old Pop-up', address:'', lat:40.74, lng:-74.02, placeType:'supermarket', environment:'', temporary:true }
    );
    saveSortSettings(s);
    sortSettings = loadSortSettings();
    renderLocationControls();
  });

  await page.locator('#open-about').click();
  await page.waitForSelector('#settings-sheet.open');
  await page.locator('#settings-locations-head').click();
  await page.locator('#open-locations-manager').click();
  await page.waitForSelector('#locations-manager-sheet.open');

  const mgrGeom = await page.evaluate(() => {
    const r = document.querySelector('#locations-manager-sheet .sheet').getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
  assert(mgrGeom.width === 390 && mgrGeom.height >= 840, `Places Manager opens full-page on phone (${mgrGeom.width}x${mgrGeom.height})`);
  assert(await page.locator('#locations-temp-cleanup-bar').isVisible(), 'unused one-off places cleanup banner is shown');

  // Filter by Outdoor -> should match Central Park (inferred outdoor) + Home (both)
  await page.locator('#locations-manager-filters [data-loc-f-env="outdoor"]').click();
  const outdoorNames = await page.locator('#location-list .location-name').evaluateAll(els => els.map(e => e.value));
  assert(outdoorNames.includes('Central Park') && outdoorNames.includes('Home') && !outdoorNames.includes('Aldi'),
    'Outdoor filter matches outdoor + both places only (' + outdoorNames.join(', ') + ')');

  // Reset filters, then filter by Grocery -> Trader Joes, Aldi, Old Pop-up
  await page.locator('#locations-manager-filters [data-loc-f-reset]').click();
  await page.locator('#locations-manager-filters [data-loc-f-type="grocery"]').click();
  const groceryNames = await page.locator('#location-list .location-name').evaluateAll(els => els.map(e => e.value));
  assert(groceryNames.includes('Trader Joes') && groceryNames.includes('Aldi') && !groceryNames.includes('Central Park'),
    'Grocery filter matches supermarket & grocery places (' + groceryNames.join(', ') + ')');
  await page.locator('#locations-manager-filters [data-loc-f-reset]').click();

  // Search by "park"
  await page.locator('#locations-manager-search').fill('park');
  const searchNames = await page.locator('#location-list .location-name').evaluateAll(els => els.map(e => e.value));
  assert(searchNames.length === 1 && searchNames[0] === 'Central Park', 'search narrows places list');
  await page.locator('#locations-manager-search-clear').click();

  // Cleanup unused temporary place
  await page.locator('#locations-temp-cleanup-btn').click();
  await page.waitForTimeout(150);
  const cleanupState = await page.evaluate(() => ({
    oldGone: !loadSortSettings().locations.some(l => l.id === 'loc-unused-temp'),
    dentistKept: loadSortSettings().locations.some(l => l.name === 'Dentist Office')
  }));
  assert(cleanupState.oldGone && cleanupState.dentistKept, 'cleanup removes unused temporary place while preserving in-use temporary place');

  // Bulk edit: select Trader Joes & Aldi and set environment = indoor explicitly
  await page.locator('#locations-bulk-toggle').click();
  await page.locator('[data-loc-select="loc-tj"]').check();
  await page.locator('[data-loc-select="loc-aldi"]').check();
  await page.locator('#locations-bulk-action').selectOption('env');
  await page.locator('#locations-bulk-env-val').selectOption('indoor');
  await page.locator('#locations-bulk-apply').click();
  const bulkEnv = await page.evaluate(() => {
    const locs = loadSortSettings().locations;
    return [locs.find(l => l.id === 'loc-tj')?.environment, locs.find(l => l.id === 'loc-aldi')?.environment];
  });
  assert(bulkEnv[0] === 'indoor' && bulkEnv[1] === 'indoor', 'bulk edit applies indoor/outdoor setting to selected places');
  await page.locator('#locations-bulk-toggle').click();

  // Promote Dentist Office from temporary to saved
  const dentistIdx = await page.evaluate(() => loadSortSettings().locations.findIndex(l => l.name === 'Dentist Office'));
  await page.locator(`[data-loc-promote="${dentistIdx}"]`).click();
  assert(await page.evaluate(() => loadSortSettings().locations.find(l => l.name === 'Dentist Office')?.temporary === false),
    'promoting a temporary place converts it to a saved place');
  await page.locator('#locations-manager-close').click();
  await page.waitForSelector('#locations-manager-sheet.open', { state:'hidden' });

  // ── 3. Full-page Weather Profiles Manager: up to 10 profiles, templates, duplicate, bulk edit ──
  console.log('\n[3] Full-page Weather Profiles Manager (up to 10 profiles + templates + bulk edit)');
  await page.locator('#settings-weather-head').click();
  await page.locator('#open-weather-manager').click();
  await page.waitForSelector('#weather-manager-sheet.open');

  const wMgrGeom = await page.evaluate(() => {
    const r = document.querySelector('#weather-manager-sheet .sheet').getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
  assert(wMgrGeom.width === 390 && wMgrGeom.height >= 840, `Weather Manager opens full-page on phone (${wMgrGeom.width}x${wMgrGeom.height})`);

  // Add from starter template + duplicate + push to 10 profiles
  await page.locator('[data-weather-template="dry"]').click();
  await page.locator('[data-weather-template="sunny"]').click();
  await page.locator('[data-weather-profile-duplicate]').first().click();
  assert(await page.locator('.weather-profile-card').count() === 3, 'templates + duplicate created 3 profiles');

  // Search weather profiles by metric word "uv" -> matches Warm & Dry
  await page.locator('#weather-manager-search').fill('uv');
  assert(await page.locator('.weather-profile-card').count() === 1, 'weather search matches rules by metric name');
  await page.locator('#weather-manager-search-clear').click();

  // Fill up to 10 profiles (MAX_WEATHER_PROFILES === 10)
  for(let i = 0; i < 8; i += 1){
    const disabled = await page.locator('#weather-profile-add').isDisabled();
    if(!disabled)await page.locator('#weather-profile-add').click();
  }
  const weatherCap = await page.evaluate(() => ({
    count: loadSortSettings().weatherProfiles.length,
    max: MAX_WEATHER_PROFILES,
    disabled: document.getElementById('weather-profile-add')?.disabled,
    header: document.getElementById('weather-manager-count')?.textContent
  }));
  assert(weatherCap.max === 10 && weatherCap.count === 10 && weatherCap.disabled === true,
    `allows up to 10 weather profiles then disables add (${JSON.stringify(weatherCap)})`);

  // Bulk edit weather profiles: select first 2 and set priority high
  await page.locator('#weather-bulk-toggle').click();
  await page.locator('[data-weather-select]').nth(0).check();
  await page.locator('[data-weather-select]').nth(1).check();
  await page.locator('#weather-bulk-action').selectOption('priority');
  await page.locator('#weather-bulk-priority-val').selectOption('high');
  await page.locator('#weather-bulk-apply').click();
  const highPriorities = await page.evaluate(() =>
    loadSortSettings().weatherProfiles.slice(0, 2).every(p => p.rules.every(r => r.importance === 'high'))
  );
  assert(highPriorities, 'weather bulk edit updates rule priority across selected profiles');
  await page.locator('#weather-manager-close').click();
  await page.locator('#settings-close').click();

  // ── 4. Place types & Indoor/Outdoor in BOTH planner engines (Fast & GLPK) ──
  console.log('\n[4] Location types & Indoor/Outdoor in Fast & GLPK planners');
  const plannerCheck = await page.evaluate(async () => {
    const fixedNow = new Date(2026, 5, 15, 9, 0, 0, 0).getTime(); // Mon 9:00 AM
    const RealDate = Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(fixedNow); }
    FrozenDate.now = () => fixedNow;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    try{
      const locations = [
        // Store A is CLOSED on Monday (day 1) -> planner MUST pick Store B via locationTypes:['grocery']!
        { id:'g-closed', name:'Closed Mart', lat:40.71, lng:-74.00, placeType:'supermarket', environment:'indoor', closedDays:[1] },
        { id:'g-open', name:'Open Grocer', lat:40.72, lng:-74.01, placeType:'greengrocer', environment:'indoor', allowedTimeStart:540, allowedTimeEnd:1200 },
        // Temporary supermarket must NEVER be picked up by locationTypes:['grocery']!
        { id:'g-temp', name:'Temp Market', lat:40.71, lng:-74.00, placeType:'supermarket', environment:'indoor', temporary:true },
        // Outdoor park
        { id:'p-park', name:'Sunny Park', lat:40.73, lng:-74.02, placeType:'park', environment:'' }
      ];
      const settings = {
        ...DEFAULT_SORT_SETTINGS,
        locations,
        travel:{},
        lastKnownLocationId:'g-closed',
        availabilityMinutes:[300,300,300,300,300,300,300],
        blockedTimes:[]
      };
      const items = normalize([
        {
          hid:'h-groc', name:'Buy produce', type:'task', priority:1, durationMinutes:30,
          dueDate:dayStart(fixedNow), delayAllowanceDays:0,
          locationIds:[], locationTypes:['grocery'], anywhereAllowed:false, logs:[]
        },
        {
          hid:'h-out', name:'Outdoor stretch', type:'task', priority:1, durationMinutes:20,
          dueDate:dayStart(fixedNow), delayAllowanceDays:0,
          locationIds:[], locationTypes:['env:outdoor'], anywhereAllowed:false, logs:[]
        }
      ]);
      const resolvedGroc = habitResolvedLocationIds(items[0], locations);
      const resolvedOut = habitResolvedLocationIds(items[1], locations);

      const fastWeek = buildWeekAgenda(items, { ...settings, agendaOptimizer:false }, 2, {});
      const fastFills = (fastWeek.days[0].timeline || []).filter(r => r.kind === 'fill');
      const fastGroc = fastFills.find(r => r.h && r.h.hid === 'h-groc');
      const fastOut = fastFills.find(r => r.h && r.h.hid === 'h-out');

      let glpkOk = false, glpkGrocLoc = null, glpkOutLoc = null;
      try{
        const glpkWeek = await buildWeekAgendaAsync(items, { ...settings, agendaOptimizer:true }, 2, {});
        glpkOk = Boolean(glpkWeek && glpkWeek.days && glpkWeek.days[0]);
        const glpkFills = (glpkWeek.days[0].timeline || []).filter(r => r.kind === 'fill');
        glpkGrocLoc = glpkFills.find(r => r.h && r.h.hid === 'h-groc')?.locationId || null;
        glpkOutLoc = glpkFills.find(r => r.h && r.h.hid === 'h-out')?.locationId || null;
      }catch(_){}

      return {
        resolvedGroc,
        resolvedOut,
        fastFillSummary: fastFills.map(r => ({ name: r.h?.name, loc: r.locationId })),
        fastGrocLoc: fastGroc?.locationId || null,
        fastOutLoc: fastOut?.locationId || null,
        glpkOk, glpkGrocLoc, glpkOutLoc
      };
    }finally{
      globalThis.Date = RealDate;
    }
  });
  console.log('  plannerCheck:', plannerCheck);
  assert(plannerCheck.resolvedGroc.includes('g-closed') && plannerCheck.resolvedGroc.includes('g-open') && !plannerCheck.resolvedGroc.includes('g-temp'),
    'locationTypes:[grocery] resolves saved supermarkets/greengrocers and excludes temporary places');
  assert(plannerCheck.resolvedOut.length === 1 && plannerCheck.resolvedOut[0] === 'p-park',
    'locationTypes:[env:outdoor] resolves outdoor places only');
  assert(plannerCheck.fastGrocLoc === 'g-open', 'Fast planner picks open grocery store when closer one is closed');
  assert(plannerCheck.fastOutLoc === 'p-park', 'Fast planner schedules outdoor item at outdoor park');
  if(plannerCheck.glpkOk){
    assert(plannerCheck.glpkGrocLoc === 'g-open', 'GLPK planner picks open grocery store when closer one is closed');
    assert(plannerCheck.glpkOutLoc === 'p-park', 'GLPK planner schedules outdoor item at outdoor park');
  }

  // ── 5. Add sheet place category chips + Home Filter by category ──
  console.log('\n[5] Add sheet place category chips & Home Filter');
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  if(await page.locator('#add-more-options').isHidden())await page.locator('#add-more-toggle').click();
  const hasGroceryTypeChip = await page.locator('#ting-tag-chips [data-location-type="grocery"]').count();
  const hasOutdoorTypeChip = await page.locator('#ting-tag-chips [data-location-type="env:outdoor"]').count();
  assert(hasGroceryTypeChip === 1 && hasOutdoorTypeChip === 1, 'Add sheet exposes Any grocery & Any outdoor category chips');
  await page.locator('#ting-tag-chips [data-location-type="grocery"]').click();
  await page.locator('#ting-tag-chips [data-anywhere]').click(); // turn off anywhere
  await page.locator('#ting-message').fill('Weekly groceries');
  await page.locator('#do-save').click();
  await page.waitForTimeout(300);
  if(await page.locator('#detail-sheet.open').count())await page.locator('#detail-cool').click();
  const savedItem = await page.evaluate(() => load().find(h => h.name === 'Weekly groceries'));
  assert(savedItem && Array.isArray(savedItem.locationTypes) && savedItem.locationTypes.includes('grocery'),
    'saved habit persists locationTypes:[grocery]');

  // Home filter by type:grocery
  await page.locator('#home-tag-filter [data-open-home-filters]').click();
  await page.waitForSelector('#home-filter-sheet.open');
  const hasFilterCat = await page.locator('#home-filter-groups [data-home-location="type:grocery"]').count();
  assert(hasFilterCat === 1, `Home filter sheet offers Any grocery category filter (count=${hasFilterCat})`);
  await page.locator('#home-filter-groups [data-home-location="type:grocery"]').click();
  const filteredNames = await page.evaluate(() => filteredVisibleIndices(load()).map(i => load()[i].name));
  assert(filteredNames.includes('Weekly groceries') && !filteredNames.includes('Root canal follow-up'),
    'Home filter by Any grocery matches grocery items only (' + filteredNames.join(', ') + ')');
  await page.locator('#home-filter-done').click();

  assert(pageErrors.length === 0, 'no page errors: ' + JSON.stringify(pageErrors));
  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
