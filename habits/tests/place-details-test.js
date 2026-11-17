// Place details: venue type + opening hours auto-fill from OSM, recents, and
// the picked-hit address fix.
//
// When the user picks a search result, OSM's venue type (amenity=fitness_centre)
// and opening_hours flow into the place: a type chip in the settings row, a
// starter emoji, and — only when the place has no hours yet — the planner
// windows (default window, closed days, per-day overrides).
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/place-details-test.js
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

async function openSettings(page){
  await page.locator('#open-about').click();
  await page.waitForSelector('#settings-sheet.open');
}

async function openPicker(page){
  await openSettings(page);
  await page.locator('#settings-locations-head').click();
  await page.waitForSelector('#settings-locations-body:not([hidden])');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
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
      if(window.caches?.keys){
        caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'driving',
      homeCityName:'Lahore, Pakistan', homeCityLat:31.52, homeCityLng:74.35, homeCityCountry:'PK'
    }));
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
    const viewport = new EventTarget();
    Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,scale:1});
    Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    window.__mockRoutes = {};
    const realFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const keys = Object.keys(window.__mockRoutes).sort((a,b)=>b.length - a.length);
      for(const key of keys){
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
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  // ── A. parseOsmOpeningHours core cases ──
  console.log('\n[A] opening-hours parser');
  const parsed = await page.evaluate(() => ({
    weekly: parseOsmOpeningHours('Mo-Fr 09:00-17:00'),
    weeklyClosed: parseOsmOpeningHours('Mo-Sa 09:00-21:00; Su closed'),
    split: parseOsmOpeningHours('Mo-Fr 08:00-12:00,13:00-18:00'),
    perDay: parseOsmOpeningHours('Mo-Th 10:00-21:00; Fr-Sa 10:00-22:00; Su 11:00-18:00'),
    always: parseOsmOpeningHours('24/7'),
    seasonal: parseOsmOpeningHours('Apr-Sep Mo-Su 08:00-20:00'),
    openEnd: parseOsmOpeningHours('Mo-Su 06:00+'),
    holiday: parseOsmOpeningHours('Mo-Fr 09:00-17:00; PH off'),
    list: parseOsmOpeningHours('Mo,We,Fr 11:00-16:00'),
    midnight: parseOsmOpeningHours('Fr-Sa 22:00-02:00')
  }));
  assert(parsed.weekly.ok && parsed.weekly.defaultStart === 540 && parsed.weekly.defaultEnd === 1020,
    'Mo-Fr 09:00-17:00 -> default window 540-1020');
  assert(parsed.weekly.closedDays.join() === '0,6', 'unlisted weekend days are closed');
  assert(parsed.weeklyClosed.closedDays.join() === '0', 'explicit "Su closed"');
  assert(!parsed.split.ok, 'split shifts do not mark the closed gap as open');
  assert(parsed.perDay.ok && parsed.perDay.hoursByDay[0].start === 660 && parsed.perDay.hoursByDay[5].end === 1320
    && parsed.perDay.hoursByDay[1].start === 600,
    'per-day differences are preserved');
  assert(parsed.always.ok && parsed.always.defaultStart === 0 && parsed.always.defaultEnd === 1439 && !parsed.always.hoursByDay,
    '24/7 -> always open');
  assert(!parsed.seasonal.ok, 'seasonal rules are not guessed');
  assert(!parsed.openEnd.ok && !parsed.holiday.ok && !parsed.midnight.ok, 'unrepresentable hours do not become planner constraints');
  assert(parsed.list.ok && parsed.list.closedDays.join() === '0,2,4,6', 'weekday lists preserve the closed days');

  // ── B. pick a Nominatim hit that carries type + hours ──
  console.log('\n[B] pick a hit with venue type + opening hours');
  await page.evaluate(() => {
    window.__mockRoutes = {
      'photon.komoot.io': { json:{ type:'FeatureCollection', features:[] } },
      'nominatim.openstreetmap.org': { json:[
        { display_name:'Esporta Fitness, Amherst, New York, United States', lat:'42.9826', lon:'-78.8205',
          type:'fitness_centre', category:'leisure', osm_type:'W', osm_id:1064440645,
          address:{ country_code:'us' },
          extratags:{ opening_hours:'Mo-Fr 09:00-17:00' } }
      ] }
    };
  });
  await openPicker(page);
  await page.locator('#picker-search').fill('Esporta');
  // Let the typeahead pass drain, then run the full search.
  await page.waitForTimeout(700);
  await page.locator('#picker-search-btn').click();
  await page.waitForSelector('#picker-results .location-result');
  const rowText = await page.locator('#picker-results .location-result').first().innerText();
  assert(/saved/i.test(rowText) === false, 'an unsaved result has no saved badge');
  await page.locator('#picker-results .location-result').first().click();
  await page.waitForTimeout(400);
  const hintAfterPick = await page.locator('#picker-scope-hint').innerText();
  assert(!/moved the map/i.test(hintAfterPick), 'picking a result does not flip the scope hint');
  const factsText = await page.locator('#picker-place-facts').innerText();
  assert(/gym/i.test(factsText), 'fact card shows the venue type (' + factsText.replace(/\n/g,' ') + ')');
  assert(/Mon–Fri 9am–5pm/.test(factsText), 'fact card shows weekly hours in the venue’s local time');
  assert(await page.evaluate(()=>pickerHoursSummary(parseOsmOpeningHours('24/7'))) === 'Open 24 hours',
    '24/7 is shown as open around the clock');
  await page.locator('#picker-name').fill('Esporta');
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const s = loadSortSettings();
    const loc = s.locations[0];
    return {
      count:s.locations.length,
      placeType:loc.placeType,
      emoji:loc.emoji,
      allowed:[loc.allowedTimeStart, loc.allowedTimeEnd],
      closedDays:loc.closedDays,
      hoursByDay:loc.hoursByDay,
      address:loc.address
    };
  });
  assert(saved.count === 1, 'one location saved');
  assert(saved.placeType === 'fitness_centre', 'venue type persisted (' + saved.placeType + ')');
  assert(saved.emoji === '🏋️', 'starter emoji from the venue type (' + saved.emoji + ')');
  assert(saved.allowed.join() === '540,1020', 'planner window auto-filled from opening hours (' + saved.allowed + ')');
  assert(saved.closedDays.join() === '0,6', 'closed days auto-filled');
  assert(!saved.hoursByDay || !Object.keys(saved.hoursByDay).length, 'no per-day overrides when every day matches');
  assert(/Esporta Fitness/i.test(saved.address || ''), 'saved address is the picked hit, not a stale hint (' + saved.address + ')');

  // ── C. recents + saved badge ──
  console.log('\n[C] recents show on empty focus and re-pin the pick');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  const recents = await page.evaluate(() => recentPlacePicks().map(r => r.name));
  assert(recents.some(n => /Esporta/.test(n)), 'the pick landed in recents (' + JSON.stringify(recents) + ')');
  await page.locator('#picker-search').click();
  await page.waitForSelector('#picker-results .location-result');
  const recentRow = await page.locator('#picker-results .location-result').first().innerText();
  assert(/recent/i.test(await page.locator('#picker-results .location-results-label').innerText()),
    'recents panel is labelled');
  assert(/Esporta/.test(recentRow) && /saved/i.test(recentRow), 'a recent pick of a saved place is badged saved');
  await page.locator('#picker-results .location-result').first().click();
  await page.waitForTimeout(200);
  const rePinned = await page.evaluate(() => ({
    lat:Number(document.querySelector('#picker-lat').value),
    lng:Number(document.querySelector('#picker-lng').value)
  }));
  assert(Math.abs(rePinned.lat - 42.9826) < 1e-4 && Math.abs(rePinned.lng - (-78.8205)) < 1e-4,
    'tapping the recent re-pins the place');
  const savedBadgeOnMap = await page.evaluate(() => pickerSavedMarkers.length);
  assert(savedBadgeOnMap === 1, 'saved places show as map markers (' + savedBadgeOnMap + ')');
  await page.locator('#picker-cancel').click();
  await page.waitForTimeout(200);

  // ── D. Photon pick resolves type/hours through the OSM lookup ──
  console.log('\n[D] Photon pick -> Nominatim lookup for hours');
  await page.evaluate(() => {
    window.__mockRoutes = {
      'nominatim.openstreetmap.org/lookup': { json:[
        { display_name:'Planet Fitness, Amherst, New York, United States',
          category:'leisure', type:'fitness_centre',
          extratags:{ opening_hours:'Mo-Th 10:00-21:00; Fr-Sa 10:00-22:00; Su 11:00-18:00' } }
      ] },
      'nominatim.openstreetmap.org/reverse': { json:{ display_name:'Amherst, New York' } },
      'nominatim.openstreetmap.org': { json:[] },
      'photon.komoot.io': { json:{ type:'FeatureCollection', features:[
        { type:'Feature', geometry:{ type:'Point', coordinates:[-78.811, 42.9931] },
          properties:{ name:'Planet Fitness', city:'Amherst', state:'New York', country:'United States',
            osm_type:'W', osm_id:999001, osm_key:'leisure', osm_value:'fitness_centre' } }
      ] } }
    };
  });
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-search').fill('Planet Fitness');
  await page.waitForTimeout(700);
  await page.locator('#picker-search-btn').click();
  await page.waitForSelector('#picker-results .location-result');
  await page.locator('#picker-results .location-result').first().click();
  await page.waitForTimeout(600);
  const facts2 = await page.locator('#picker-place-facts').innerText();
  assert(/gym/i.test(facts2), 'lookup resolved the venue type (' + facts2.replace(/\n/g,' ') + ')');
  assert(/11am/i.test(facts2), 'per-day summary shows on the card (' + facts2.replace(/\n/g,' ') + ')');
  await page.locator('#picker-name').fill('Planet Fitness');
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const saved2 = await page.evaluate(() => {
    const loc = loadSortSettings().locations[1];
    return { placeType:loc.placeType, allowed:[loc.allowedTimeStart, loc.allowedTimeEnd],
      closedDays:loc.closedDays, saturday:loc.hoursByDay && loc.hoursByDay[6], sunday:loc.hoursByDay && loc.hoursByDay[0] };
  });
  assert(saved2.placeType === 'fitness_centre', 'type persisted from the lookup');
  assert(saved2.allowed.join() === '600,1320', 'union window across days (10:00-22:00)');
  assert(saved2.sunday && saved2.sunday.start === 660, 'per-day Sunday override stored');
  assert(saved2.saturday && saved2.saturday.end === 1320, 'per-day Saturday override stored');
  assert((saved2.closedDays || []).length === 0, 'no closed days when every day opens');

  // ── E. editing a place with hours never overwrites them ──
  console.log('\n[E] existing hours are not overwritten');
  await page.evaluate(() => {
    window.__mockRoutes['nominatim.openstreetmap.org'] = { json:[
      { display_name:'Other Gym, Amherst, New York, United States', lat:'42.99', lon:'-78.81',
        type:'fitness_centre', osm_type:'W', osm_id:555,
        address:{ country_code:'us' }, extratags:{ opening_hours:'Mo-Su 05:00-23:00' } }
    ] };
  });
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-search').fill('Other Gym');
  await page.waitForTimeout(700);
  await page.locator('#picker-search-btn').click();
  await page.waitForSelector('#picker-results .location-result');
  // Not picking — dismiss the search pane with a map tap (the card returns),
  // then drop the pin manually via apply coords (no hours source). The tap
  // point is computed below the panel's live bottom edge: the panel can grow
  // between measuring and clicking, and a tap on a row would pick instead.
  const tapBelowPanel = async () => {
    const pt = await page.evaluate(() => {
      const map = document.querySelector('.picker-map').getBoundingClientRect();
      const panel = document.querySelector('#picker-results').getBoundingClientRect();
      const y = Math.min(Math.max(panel.bottom + 60, map.top + 140), map.bottom - 20);
      return { x: map.left + 150, y };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(350);
    return page.evaluate(() => $('picker-results').hidden);
  };
  if(!await tapBelowPanel())await tapBelowPanel();
  await page.locator('#picker-name').fill('Manual place');
  await page.evaluate(() => pickerSetCoords(42.985, -78.805, {reverse:false}));
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const manual = await page.evaluate(() => {
    const loc = loadSortSettings().locations[2];
    return { allowed:[loc.allowedTimeStart, loc.allowedTimeEnd], closedDays:loc.closedDays || [] };
  });
  assert(manual.allowed.join() === ',' && manual.closedDays.length === 0,
    'a manual pin without OSM facts saves blank hours');
  const edited = await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations[0].allowedTimeStart = 300;
    s.locations[0].allowedTimeEnd = 1200;
    saveSortSettings(s);
    return true;
  });
  assert(edited, 'seeded custom hours on the first place');
  await page.evaluate(() => {
    window.__mockRoutes['photon.komoot.io'] = { json:{ type:'FeatureCollection', features:[] } };
    window.__mockRoutes['nominatim.openstreetmap.org/lookup'] = { json:[] };
  });
  await page.locator('[data-loc-edit-pin="0"]').click();
  await page.waitForSelector('#location-picker-sheet.open');
  await page.locator('#picker-search').fill('Other Gym');
  await page.waitForTimeout(700);
  await page.locator('#picker-search-btn').click();
  await page.waitForSelector('#picker-results .location-result');
  await page.locator('#picker-results .location-result').first().click();
  await page.waitForTimeout(400);
  await page.locator('#picker-save').click();
  await page.waitForTimeout(300);
  const preserved = await page.evaluate(() => {
    const loc = loadSortSettings().locations[0];
    return { allowed:[loc.allowedTimeStart, loc.allowedTimeEnd], type:loc.placeType };
  });
  assert(preserved.allowed.join() === '300,1200', 'custom hours survived the edit (' + preserved.allowed + ')');
  assert(preserved.type === 'fitness_centre', 'type still filled on edit');

  // ── F. keyboard reflow: search pane on top, fields stay reachable ──
  console.log('\n[F] keyboard reflow: search pane on top, card within reach');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  const mapHeight = () => page.evaluate(() =>
    Math.round(document.querySelector('.picker-map').getBoundingClientRect().height));
  const fullMap = await mapHeight();
  assert(fullMap >= 280, 'full map height when no field is focused (' + fullMap + ')');
  await page.locator('#picker-search').click();
  // Let the pane snap in (and the recents panel render) before measuring.
  await page.waitForTimeout(400);
  const searchState = await page.evaluate(() => {
    const sheet = $('location-picker-sheet');
    return {
      kbOpen: sheet.classList.contains('kb-open'),
      searching: sheet.classList.contains('searching'),
      mapH: Math.round(document.querySelector('.picker-map').getBoundingClientRect().height),
      searchTop: Math.round(document.querySelector('#picker-search').getBoundingClientRect().top),
      cardHidden: getComputedStyle(document.querySelector('.picker-card')).display === 'none',
      panelUp: !document.querySelector('#picker-results').hidden
    };
  });
  assert(searchState.kbOpen && searchState.searching, 'typing mode: kb-open + searching on the sheet');
  assert(searchState.searchTop >= 0 && searchState.searchTop < 220,
    'search field stays near the top of the viewport (' + searchState.searchTop + ')');
  assert(searchState.cardHidden, 'searching hides the bottom card, like the Maps search pane');
  assert(searchState.panelUp, 'suggestions/recents panel is up while searching');
  assert(searchState.mapH > fullMap, 'the map fills the pane behind the results (' + searchState.mapH + ' > ' + fullMap + ')');
  // A tap on the map itself dismisses the suggestions (Google Maps behavior).
  const tapPoint = await page.evaluate(() => {
    const map = document.querySelector('.picker-map').getBoundingClientRect();
    const panel = document.querySelector('#picker-results').getBoundingClientRect();
    const y = Math.min(Math.max(panel.bottom + 60, map.top + 140), map.bottom - 20);
    return { x: map.left + 200, y };
  });
  await page.mouse.click(tapPoint.x, tapPoint.y);
  await page.waitForTimeout(300);
  const dismissed = await page.evaluate(() => {
    const sheet = $('location-picker-sheet');
    return {
      panelHidden: document.querySelector('#picker-results').hidden,
      searching: sheet.classList.contains('searching'),
      kbOpen: sheet.classList.contains('kb-open'),
      cardBack: getComputedStyle(document.querySelector('.picker-card')).display !== 'none'
    };
  });
  assert(dismissed.panelHidden, 'tapping the map dismisses the suggestions panel');
  assert(!dismissed.searching && !dismissed.kbOpen, 'map tap drops the sheet back to browsing mode');
  assert(dismissed.cardBack, 'the bottom card returns after dismissal');
  await page.locator('#picker-name').click();
  assert(await page.locator('#picker-gps').isVisible(), 'focus alone does not hide the map controls');
  await page.evaluate(()=>{
    visualViewport.height = 480;
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(()=>$('location-picker-sheet').classList.contains('kb-visible'));
  const nameState = await page.evaluate(() => {
    const sheet = $('location-picker-sheet');
    const nameRect = document.querySelector('#picker-name').getBoundingClientRect();
    const saveRect = document.querySelector('#picker-save').getBoundingClientRect();
    return {
      searching: sheet.classList.contains('searching'),
      kbOpen: sheet.classList.contains('kb-open'),
      mapH: Math.round(document.querySelector('.picker-map').getBoundingClientRect().height),
      nameTop: Math.round(nameRect.top), saveTop: Math.round(saveRect.top),
      viewport: visualViewport.height
    };
  });
  assert(!nameState.searching && nameState.kbOpen, 'naming mode: searching off, keyboard mode on');
  assert(nameState.mapH < fullMap - 80, 'naming mode gives the map way (' + nameState.mapH + ' < ' + (fullMap - 80) + ')');
  assert(nameState.nameTop < nameState.viewport, 'name field inside the viewport (' + nameState.nameTop + ' < ' + nameState.viewport + ')');
  assert(nameState.saveTop < nameState.viewport, 'save button inside the viewport (' + nameState.saveTop + ' < ' + nameState.viewport + ')');
  await page.locator('#picker-cancel').click();
  await page.waitForTimeout(300);
  const afterClose = await page.evaluate(() => {
    const sheet = $('location-picker-sheet');
    return { kbOpen: sheet.classList.contains('kb-open'), searching: sheet.classList.contains('searching') };
  });
  assert(!afterClose.kbOpen && !afterClose.searching, 'closing the picker clears both modes');

  // A short phone viewport with the IME up, including a Safari-style pan.
  console.log('\n[G] compact layout with an obscured viewport');
  await page.setViewportSize({width:320,height:640});
  const viewport = (height, offsetTop = 0) => page.evaluate(({height,offsetTop})=>{
    Object.assign(visualViewport,{height,offsetTop,width:320});
    visualViewport.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('scroll'));
  },{height,offsetTop});
  const inView = (ids, top, bottom) => page.evaluate(({ids,top,bottom})=>ids.every(id=>{
    const r = $(id).getBoundingClientRect();
    return r.height && r.top >= top - 1 && r.bottom <= bottom + 1 && r.left >= 0 && r.right <= innerWidth;
  }),{ids,top,bottom});
  const pin = () => page.evaluate(()=>[$('picker-lat').value,$('picker-lng').value].join(','));
  await viewport(640);
  await page.locator('#loc-open-picker').click();
  await page.waitForFunction(()=>getSheetInner('location-picker-sheet').getAnimations().every(animation=>animation.playState !== 'running'));
  // The sheet entrance finishing is not the map height transition finishing;
  // measuring mid-transition pushed the docked footer below the fold.
  await page.waitForFunction(() => {
    const map = document.querySelector('.picker-map');
    if(!map)return false;
    const target = Math.min(window.innerHeight * 0.5, 400);
    return Math.abs(map.getBoundingClientRect().height - target) < 2;
  }, { timeout: 4000 }).catch(() => {});
  const startPin = await pin();
  assert(await page.locator('#picker-scope-near').isHidden(), 'search scopes stay out of the map until needed');
  assert(await inView(['picker-save','picker-cancel'],0,640), 'footer is visible on the narrow phone');
  assert(await page.evaluate(()=>['picker-zoom-in','picker-zoom-out','picker-gps'].every(id=>{
    const control = $(id);
    const box = control.getBoundingClientRect();
    return control.contains(document.elementFromPoint(box.x + box.width / 2,box.y + box.height / 2));
  })), 'search and layer controls leave all three map buttons tappable');
  await page.locator('#picker-search').click();
  await viewport(330,51);
  await page.waitForFunction(()=>parseFloat(getComputedStyle($('location-picker-sheet')).top) === 51);
  assert(await inView(['picker-search','picker-search-back','picker-search-btn','picker-results'],51,381),
    'search controls and scrollable results fit above the keyboard with viewport offset');
  await page.locator('#picker-search-back').click();
  assert(await pin() === startPin, 'back to map preserves the selected pin');
  await viewport(640);

  // Android already resizes the layout. Its transient visual viewport can
  // also report an IME inset and must not reduce available height twice.
  await page.locator('#picker-name').click();
  await page.evaluate(()=>{ window.TingsNative = {isNative:true,platform:'android'}; updateKeyboardLift(); });
  await page.setViewportSize({width:320,height:340});
  await viewport(140);
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--keyboard-viewport-bottom') === '100%');
  assert(await inView(['picker-name','picker-save'],0,340), 'name and save fit within the resized Android layout');
  await page.setViewportSize({width:320,height:640});
  await viewport(640);
  await page.locator('.picker-coords-details summary').click();
  await page.locator('#picker-lat').fill('0');
  await page.locator('#picker-lng').fill('-73.9');
  await page.setViewportSize({width:320,height:340});
  await viewport(140);
  await page.waitForFunction(()=>document.documentElement.clientHeight === 340);
  assert(await inView(['picker-lat','picker-lng','picker-apply-coords','picker-save'],0,340),
    'coordinate fields, Apply and save remain reachable together');
  await page.locator('#picker-apply-coords').click();
  assert(await pin() === '0,-73.9', 'Apply moves the pin to valid zero latitude');
  await page.setViewportSize({width:320,height:640});
  await viewport(640);
  await page.evaluate(()=>{ delete window.TingsNative; updateKeyboardLift(); });

  console.log('\n[H] stale responses and cancellation');
  await page.evaluate(()=>{
    const realSearch = geocodeSearch;
    geocodeSearch = (query,opts)=>query === 'Slow result' && !opts.photonOnly
      ? new Promise(resolve=>{ window.__finishSearch = ()=>resolve([{name:'Stale result',lat:42,lng:-79}]); })
      : realSearch(query,opts);
    window.__finishReverse = {};
    reverseGeocode = lat=>new Promise(resolve=>{ window.__finishReverse[lat] = resolve; });
  });
  await page.locator('#picker-search').fill('Slow result');
  await page.locator('#picker-search-btn').click();
  await page.waitForFunction(()=>window.__finishSearch);
  await page.locator('#picker-search-back').click();
  await page.locator('#picker-search').fill('0, -74');
  await page.locator('#picker-search-btn').click({timeout:2000});
  await page.waitForSelector('#picker-results .location-result');
  await page.evaluate(()=>window.__finishSearch());
  assert(/Pinned location/.test(await page.locator('#picker-results').innerText()), 'dismissing a request enables search and ignores its late results');
  await page.locator('#picker-results .location-result').first().click();
  await page.evaluate(()=>pickerSetCoords(41,-74));
  await page.waitForFunction(()=>window.__finishReverse[41]);
  await page.evaluate(()=>{
    pickerSetCoords(40,-74);
    window.__finishReverse[41]({address:'Old pin address',name:'Old name'});
  });
  assert(!(await page.locator('#picker-address-hint').innerText()).includes('Old pin'), 'moving a pin clears and rejects the old address');
  await page.locator('#picker-name').fill('Cancelled place');
  await page.waitForFunction(()=>window.__finishReverse[40]);
  await page.locator('#picker-save').click();
  await page.locator('#picker-cancel').click();
  await page.evaluate(()=>window.__finishReverse[40]({address:'New pin address',name:'New name'}));
  assert(!(await page.evaluate(()=>loadSortSettings().locations)).some(loc=>loc.name === 'Cancelled place'),
    'cancelling during the address lookup prevents a late save');
  await page.locator('#loc-open-picker').click();
  await page.locator('#picker-search').click();
  await page.keyboard.press('Escape');
  assert(await page.locator('#picker-cancel').isVisible(), 'Escape returns to the map from search');
  await page.keyboard.press('Escape');
  assert(await page.locator('#location-picker-sheet:not(.open)').count() === 1
    && await page.locator('#settings-sheet.open').count() === 1, 'Escape closes the picker and leaves Settings open');

  if(pageErrors.length){
    fail += 1;
    console.error('  FAIL: page errors\n' + pageErrors.join('\n'));
  }
  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
