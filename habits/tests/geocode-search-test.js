// Place search sends a home-city focus by default, and only the area the user
// picked when they choose This map. Anywhere sends the text alone.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/geocode-search-test.js
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const HOME = {lat:31.52, lng:74.35};
const SAVED = {lat:25.04, lng:67.08};
const GPS = {lat:40.7589, lng:-73.9851};

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function paramsOf(url){
  return new URL(url).searchParams;
}

async function runSearch(page){
  const before = await page.evaluate(() => window.__geocodeUrls.length);
  await page.locator('#picker-search-btn').click();
  await page.waitForFunction(start => window.__geocodeUrls.length >= start + 2, before);
  await page.waitForFunction(() => document.querySelector('#picker-search-btn')?.textContent?.trim() === 'search');
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  await page.addInitScript(() => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
      if(window.caches?.keys) caches.keys().then(keys => keys.forEach(key => caches.delete(key)));
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics:[], travel:{}, defaultTravelMode:'driving',
      homeCityName:'Lahore, Pakistan', homeCityLat:31.52, homeCityLng:74.35, homeCityCountry:'PK',
      locations:[{id:'saved-karachi', name:'Karachi stop', lat:25.04, lng:67.08, address:'Karachi'}]
    }));
    window.__geocodeUrls = [];
    window.__mockRoutes = {};
    const realFetch = window.fetch.bind(window);
    window.fetch = function(input, init){
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if(/photon\.komoot\.io|nominatim\.openstreetmap\.org/.test(url) && !/\/reverse/.test(url)){
        window.__geocodeUrls.push(url);
      }
      const keys = Object.keys(window.__mockRoutes).sort((a, b) => b.length - a.length);
      for(const key of keys){
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

  await page.addInitScript(()=>{
    // Exercise the existing-user picker outside first-run onboarding.
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__mockRoutes = {
      'photon.komoot.io': {json:{type:'FeatureCollection', features:[
        {type:'Feature', geometry:{type:'Point', coordinates:[74.36, 31.53]}, properties:{name:'Central Library', city:'Lahore', country:'Pakistan', type:'library'}},
        {type:'Feature', geometry:{type:'Point', coordinates:[-0.12, 51.5]}, properties:{name:'Central Library', city:'London', country:'United Kingdom', type:'library'}}
      ]}},
      'nominatim.openstreetmap.org': {json:[
        {display_name:'Central Library, Lahore, Pakistan', lat:'31.53', lon:'74.36', type:'library', address:{country_code:'pk'}}
      ]}
    };
  });

  console.log('\n[A] picker opens on the home city when GPS is off');
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  await page.locator('#settings-locations-head').click();
  await page.waitForSelector('#settings-locations-body:not([hidden])');
  await page.locator('#loc-open-picker').click();
  await page.waitForSelector('#location-picker-sheet.open');
  const opened = await page.evaluate(() => ({
    lat:Number(document.querySelector('#picker-lat').value),
    lng:Number(document.querySelector('#picker-lng').value),
    scope:document.querySelector('[data-picker-scope="near"]')?.getAttribute('aria-pressed'),
    hint:document.querySelector('#picker-scope-hint')?.textContent || ''
  }));
  assert(Math.abs(opened.lat - HOME.lat) < 0.01 && Math.abs(opened.lng - HOME.lng) < 0.01, 'pin opens on the home city (' + opened.lat + ',' + opened.lng + ')');
  assert(opened.scope === 'true', 'Near home is selected when the picker opens');
  assert(/Lahore/i.test(opened.hint), 'hint names the saved city');

  console.log('\n[B] near-home search uses the city, not GPS or a saved place');
  await page.evaluate(gps => { currentCoord = {lat:gps.lat, lng:gps.lng, accuracy:30}; }, GPS);
  await page.evaluate(() => { window.__geocodeUrls = []; });
  await page.locator('#picker-search').fill('Central Library');
  await runSearch(page);
  const near = await page.evaluate(() => window.__geocodeUrls.slice());
  const photonNear = near.find(url => url.includes('photon.komoot.io'));
  const nominatimNear = near.find(url => url.includes('nominatim.openstreetmap.org'));
  const photonParams = paramsOf(photonNear);
  const nominatimParams = paramsOf(nominatimNear);
  assert(photonParams.get('q') === 'Central Library', 'place-name query is not rewritten with the city');
  assert(Math.abs(Number(photonParams.get('lat')) - HOME.lat) < 0.001, 'Photon bias latitude is the home city');
  assert(Math.abs(Number(photonParams.get('lon')) - HOME.lng) < 0.001, 'Photon bias longitude is the home city');
  assert(photonParams.get('zoom') === '11', 'Photon bias uses city-scale zoom');
  assert(!photonNear.includes('40.7359') && !photonNear.includes('40.7589') && !photonNear.includes('25.04'), 'near-home request skips the New York pin, GPS, and saved place');
  assert(!nominatimNear.includes('40.7589') && !nominatimNear.includes('25.04'), 'Nominatim viewbox skips GPS and the saved place');
  assert(nominatimParams.get('bounded') === '0', 'near home boosts the area without hard-filtering it');
  assert(!nominatimParams.has('city'), 'a place name does not send a structured city');
  const firstName = await page.locator('#picker-results .location-result b').first().innerText();
  assert(/Central Library/i.test(firstName), 'a result is shown');
  const distanceText = await page.locator('#picker-results .location-result small').first().innerText();
  assert(/km|m|here/i.test(distanceText), 'result shows a distance from the focus (' + distanceText + ')');

  console.log('\n[C] a panned map sends the coarsened center');
  await page.evaluate(gps => {
    window.__geocodeUrls = [];
    pickerMap.setView([gps.lat, gps.lng], 15, {animate:false});
  }, GPS);
  await runSearch(page);
  const panned = await page.evaluate(() => window.__geocodeUrls.find(url => url.includes('photon.komoot.io')) || '');
  const pannedParams = paramsOf(panned);
  const pannedLat = Number(pannedParams.get('lat'));
  const pannedLon = Number(pannedParams.get('lon'));
  assert(Math.abs(pannedLat - 40.76) < 0.001, 'panned map sends the coarsened latitude (' + pannedLat + ')');
  assert(Math.abs(pannedLon - (-73.99)) < 0.001, 'panned map sends the coarsened longitude (' + pannedLon + ')');
  assert(!panned.includes(String(GPS.lat)), 'the precise map center is not sent');
  assert(!panned.includes(String(HOME.lat)), 'home city is not the bias after a pan');
  const movedHint = await page.locator('#picker-scope-hint').innerText();
  assert(/moved the map/i.test(movedHint), 'the hint says the moved map is the focus');

  console.log('\n[D] a street query includes the city on the first request');
  await page.evaluate(() => {
    window.__geocodeUrls = [];
    window.__mockRoutes['photon.komoot.io'] = {json:{type:'FeatureCollection', features:[
      {type:'Feature', geometry:{type:'Point', coordinates:[74.33, 31.55]}, properties:{name:'12 Mall Road', street:'Mall Road', housenumber:'12', city:'Lahore', country:'Pakistan', type:'house'}}
    ]}};
    window.__mockRoutes['nominatim.openstreetmap.org'] = {json:[
      {display_name:'12 Mall Road, Lahore, Pakistan', lat:'31.55', lon:'74.33', type:'house', address:{country_code:'pk'}}
    ]};
  });
  await page.locator('#picker-scope-near').click();
  await page.locator('#picker-search').fill('12 Mall Road');
  await runSearch(page);
  const streetUrls = await page.evaluate(() => window.__geocodeUrls.slice());
  const streetPhoton = paramsOf(streetUrls.find(url => url.includes('photon.komoot.io')));
  const streetNominatim = paramsOf(streetUrls.find(url => url.includes('nominatim.openstreetmap.org')));
  assert(/12 Mall Road/i.test(streetPhoton.get('q') || '') && /Lahore/i.test(streetPhoton.get('q') || ''), 'Photon street query includes the home city');
  assert(streetNominatim.get('street') === '12 Mall Road', 'Nominatim street field is the typed address');
  assert(streetNominatim.get('city') === 'Lahore', 'Nominatim city is the saved city');
  assert(!streetNominatim.has('q'), 'structured street search does not also send a free query');
  assert(streetUrls.length === 2, 'a hit on the first pass does not widen (' + streetUrls.length + ' requests)');

  console.log('\n[E] This map sends the visible bounds and does not add the city');
  await page.evaluate(home => { window.__geocodeUrls = []; pickerMap.setView([home.lat, home.lng], 15, {animate:false}); }, HOME);
  await page.locator('#picker-scope-map').click();
  const mapHint = await page.locator('#picker-scope-hint').innerText();
  assert(/map below/i.test(mapHint), 'This map explains that it uses the map on screen');
  await page.locator('#picker-search').fill('12 Mall Road');
  await runSearch(page);
  const mapUrls = await page.evaluate(() => window.__geocodeUrls.slice());
  const mapPhoton = paramsOf(mapUrls.find(url => url.includes('photon.komoot.io')) || 'https://photon.komoot.io/api/');
  const mapNominatim = paramsOf(mapUrls.find(url => url.includes('nominatim.openstreetmap.org')) || 'https://nominatim.openstreetmap.org/search');
  const bounds = await page.evaluate(() => {
    const box = pickerMap.getBounds();
    return {south:box.getSouth(), north:box.getNorth(), west:box.getWest(), east:box.getEast()};
  });
  const bbox = (mapPhoton.get('bbox') || '').split(',').map(Number);
  assert(bbox.length === 4, 'Photon receives a bbox');
  assert(Math.abs(bbox[0] - bounds.west) < 0.02 && Math.abs(bbox[1] - bounds.south) < 0.02, 'bbox matches the visible map');
  assert(!mapPhoton.has('lat'), 'This map does not also send a soft bias point');
  assert(!/Lahore/i.test(mapPhoton.get('q') || ''), 'This map does not append the home city');
  assert(mapNominatim.get('bounded') === '1', 'Nominatim treats the map as a hard area');
  assert(!mapNominatim.has('city'), 'This map does not send the home city name');

  console.log('\n[F] Anywhere sends the query alone');
  await page.evaluate(() => { window.__geocodeUrls = []; });
  await page.locator('#picker-scope-any').click();
  const anyHint = await page.locator('#picker-scope-hint').innerText();
  assert(/location stays on this phone/i.test(anyHint), 'Anywhere says the location stays on the phone');
  await page.locator('#picker-search').fill('Central Library');
  await runSearch(page);
  const anyUrls = await page.evaluate(() => window.__geocodeUrls.slice());
  assert(anyUrls.length >= 2, 'Anywhere still asks both providers');
  for(const url of anyUrls){
    const params = paramsOf(url);
    assert(!params.has('lat') && !params.has('lon') && !params.has('viewbox') && !params.has('bbox'), 'Anywhere omits location parameters');
    assert(!/Lahore/i.test(params.get('q') || '') && !params.has('city'), 'Anywhere does not add the city (' + url + ')');
  }

  console.log('\n[G] a far Photon page does not hide a nearer Nominatim address');
  const ranked = await page.evaluate(async home => {
    sortSettings.homeCityLat = home.lat;
    sortSettings.homeCityLng = home.lng;
    sortSettings.homeCityName = 'Lahore, Pakistan';
    window.__mockRoutes = {
      'photon.komoot.io': {json:{type:'FeatureCollection', features:Array.from({length:8}, (_, i) => ({
        type:'Feature',
        geometry:{type:'Point', coordinates:[-0.1 - i * 0.01, 51.5]},
        properties:{name:'Mall Library', city:'London', country:'United Kingdom', type:'library'}
      }))}},
      'nominatim.openstreetmap.org': {json:[
        {display_name:'Mall Library, Lahore, Pakistan', lat:String(home.lat + 0.01), lon:String(home.lng + 0.01), type:'library', address:{country_code:'pk'}}
      ]}
    };
    const hits = await geocodeSearch('Mall Library', {limit:6});
    return {name:hits[0] && hits[0].name, lat:hits[0] && hits[0].lat, count:hits.length};
  }, HOME);
  assert(ranked.count >= 1 && Math.abs(ranked.lat - (HOME.lat + 0.01)) < 0.001, 'the nearer Nominatim hit ranks first (' + JSON.stringify(ranked) + ')');

  console.log('\n[H] both providers failing is unavailable, not no matches');
  await page.evaluate(() => {
    window.__geocodeUrls = [];
    window.__mockRoutes = {
      'photon.komoot.io': {status:403, json:{error:'blocked'}},
      'nominatim.openstreetmap.org': {status:403, json:{error:'blocked'}}
    };
  });
  await page.locator('#picker-scope-near').click();
  await page.locator('#picker-search').fill('Central Library');
  await runSearch(page);
  const unavailable = await page.locator('#picker-results').innerText();
  assert(/unavailable/i.test(unavailable), 'a 403 is shown as search unavailable (' + unavailable + ')');

  if(pageErrors.length){
    fail += 1;
    console.error('  FAIL: page errors\n' + pageErrors.join('\n'));
  }
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
