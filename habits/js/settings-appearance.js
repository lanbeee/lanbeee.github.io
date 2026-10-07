// ── Appearance ──────────────────────────────────────────────────────────
function isMinimalMode(){
  return Boolean(sortSettings && sortSettings.minimalMode);
}

const headerBrandDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');

// Theme controls day/night; dawn/dusk overrides it using the existing local
// solar calculator. No location permission or network request is needed.
function headerBrandVariant(now = Date.now(), settings = sortSettings || {}){
  const dark = settings.themeMode === 'dark'
    || ((!settings.themeMode || settings.themeMode === 'system') && headerBrandDarkMedia.matches);
  const base = dark ? 'night' : 'day';
  const date = new Date(now);
  if(!Number.isFinite(date.getTime()))return base;
  let sunrise = new Date(date.getFullYear(),date.getMonth(),date.getDate(),6).getTime();
  let sunset = new Date(date.getFullYear(),date.getMonth(),date.getDate(),18).getTime();
  const validPlace = p => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
  const home = {lat:settings.homeCityLat,lng:settings.homeCityLng};
  const place = validPlace(home) ? home
    : (Array.isArray(settings.locations) ? settings.locations : []).find(validPlace);
  if(place && typeof prayerParams === 'function' && typeof prayerTimesFor === 'function'){
    try{
      const params = prayerParams(settings);
      const times = params && prayerTimesFor({latitude:place.lat,longitude:place.lng},date,params);
      const rise = times?.sunrise?.getTime(), set = times?.maghrib?.getTime();
      if(Number.isFinite(rise) && Number.isFinite(set) && set > rise){
        sunrise = rise;
        sunset = set;
      }
    }catch{ /* Missing/invalid solar times keep the local-clock fallback. */ }
  }
  const twilight = 45 * 60 * 1000;
  return Math.abs(date.getTime() - sunrise) <= twilight
    || Math.abs(date.getTime() - sunset) <= twilight ? 'twilight' : base;
}

function syncHeaderBrand(){
  const variant = headerBrandVariant();
  const src = `./icons/tings-app-icon${variant === 'day' ? '' : '-' + variant}.svg`;
  document.querySelectorAll('[data-header-brand]').forEach(img=>{
    if(img.getAttribute('src') !== src)img.setAttribute('src',src);
  });
}

headerBrandDarkMedia.addEventListener('change',syncHeaderBrand);

function applyAppearanceSettings(){
  const s = sortSettings || {};
  document.body.classList.toggle('compact-mode', !!s.compactMode);
  document.body.classList.toggle('minimal-mode', !!s.minimalMode);
  document.documentElement.dataset.fontScale = s.fontScale || 'medium';
  const mode = s.themeMode || 'system';
  const root = document.documentElement;
  root.dataset.palette = s.colorPalette || 'default';
  if(mode === 'system'){
    root.removeAttribute('data-theme');
    root.style.removeProperty('color-scheme');
  }else{
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if(meta)meta.content = mode === 'system' ? 'light dark' : mode;
  syncHeaderBrand();
  if(typeof invalidateCrownRidgeCache === 'function')invalidateCrownRidgeCache();
  if(typeof applyDetailMinimalMode === 'function')applyDetailMinimalMode();
  applyAddMinimalMode();
}

// Visual-only: collapse add-sheet chrome (emoji bg, more options) in minimal mode.
function applyAddMinimalMode(){
  const minimal = isMinimalMode();
  const sheet = $('add-sheet');
  if(sheet)sheet.classList.toggle('minimal-add', minimal);
  if(!minimal)return;
  const body = $('add-more-options');
  const toggle = $('add-more-toggle');
  if(body)body.hidden = true;
  if(toggle)toggle.setAttribute('aria-expanded','false');
}

// ── Home city (general area for prayer, weather, etc.) ───────────────────
function syncHomeCityStatus(){
  const el = $('home-city-status');
  if(!el)return;
  if(sortSettings.homeCityName && Number.isFinite(sortSettings.homeCityLat)){
    el.textContent = `${sortSettings.homeCityName} (${sortSettings.homeCityLat.toFixed(2)}, ${sortSettings.homeCityLng.toFixed(2)})`;
  }else{
    el.textContent = 'No city set.';
  }
}

// ASYNC: if home city is unset, set it from coordinates (reverse geocode →
// "City, Country"). Never overwrites an existing city — GPS movement and later
// place adds must not relocate prayer/weather. Used once for a new user: first
// GPS grant, or the first saved place if they never turned location on.
async function maybeInferHomeCityFromPlace(lat,lng){
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  const coarse = typeof coarsenLatLngForCity === 'function' ? coarsenLatLngForCity(lat,lng) : null;
  if(!coarse)return false;
  lat = coarse.lat;
  lng = coarse.lng;
  let name = 'Home area';
  let countryCode = '';
  try{
    if(typeof reverseGeocodeCity === 'function'){
      const city = await reverseGeocodeCity(lat,lng);
      if(city && city.name)name = city.name;
      countryCode = String(city && city.countryCode || '').trim().toUpperCase().slice(0,2);
    }
  }catch{ /* keep fallback name */ }
  // User may have set a city while the reverse lookup was in flight.
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng, homeCityCountry:countryCode});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  if(typeof refreshWeatherForecast === 'function')void refreshWeatherForecast({force:true});
  syncHomeCityStatus();
  if(typeof showToast === 'function')showToast(`city: ${name}`);
  return true;
}

async function setHomeCity(){
  const input = $('home-city-input');
  if(!input)return;
  const query = input.value.trim();
  if(!query)return;
  const status = $('home-city-status');
  if(status)status.textContent = 'Looking up…';
  try{
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`);
    const json = await res.json();
    const feat = json.features && json.features[0];
    if(!feat){
      if(status)status.textContent = 'City not found. Try a different spelling.';
      return;
    }
    const [lng,lat] = feat.geometry.coordinates;
    const name = feat.properties.name || query;
    // ISO country code comes free with the geocode result and drives the
    // 'auto' display units for temperature, precipitation, and wind
    // (see weatherTempUnit/weatherPrecipUnit/weatherWindUnit in config.js).
    const countryCode = String(feat.properties.countrycode || '').trim().toUpperCase().slice(0,2);
    updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng, homeCityCountry:countryCode});
    if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
    if(typeof refreshWeatherForecast === 'function')void refreshWeatherForecast({force:true});
    input.value = '';
    syncHomeCityStatus();
    if(typeof showToast === 'function')showToast(`city: ${name}`);
  }catch(_){
    if(status)status.textContent = 'Lookup failed. Check your connection.';
  }
}

// PURE: blocked-time blocks whose prayer anchors resolve only via the home
// city (no place on the block) — clearing the city would silently freeze them
// to their fixed fallback clock.
function blocksUsingHomeCity(){
  const blocks = typeof normalizeBlockedTimes === 'function'
    ? normalizeBlockedTimes(sortSettings && sortSettings.blockedTimes)
    : (Array.isArray(sortSettings && sortSettings.blockedTimes) ? sortSettings.blockedTimes : []);
  return blocks.filter(b =>
    !b.locationId && (cleanPrayerAnchor(b.startAnchor) || cleanPrayerAnchor(b.endAnchor))
  );
}

function clearHomeCity(){
  const users = habitsUsingHomeCity();
  if(users.length){
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast("can't clear city — still used by", users));
    }
    return;
  }
  const blocks = blocksUsingHomeCity();
  if(blocks.length){
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast("can't clear city — busy time needs it", blocks));
    }
    return;
  }
  updateSortSetting({homeCityName:'', homeCityLat:null, homeCityLng:null, homeCityCountry:''});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  syncHomeCityStatus();
}

// ── Default topics chips ────────────────────────────────────────────────
function renderDefaultTopicsChips(){
  const wrap = $('default-topics-chips');
  if(!wrap)return;
  const allTopics = Array.isArray(sortSettings.topics) ? sortSettings.topics : [];
  const selected = Array.isArray(sortSettings.defaultTopics) ? sortSettings.defaultTopics : [];
  if(!allTopics.length){
    wrap.innerHTML = '<p class="field-hint">Add topics in the Topics section first.</p>';
    return;
  }
  wrap.innerHTML = allTopics.map(t=>{
    const on = selected.includes(t);
    return `<button type="button" class="topic-filter${on ? ' on' : ''}" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
  }).join('');
}

function toggleDefaultTopic(topic){
  const current = Array.isArray(sortSettings.defaultTopics) ? [...sortSettings.defaultTopics] : [];
  const idx = current.indexOf(topic);
  if(idx >= 0)current.splice(idx,1);
  else current.push(topic);
  updateSortSetting({defaultTopics:current});
  renderDefaultTopicsChips();
}
