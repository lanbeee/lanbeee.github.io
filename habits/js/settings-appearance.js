// ── Appearance ──────────────────────────────────────────────────────────
function isMinimalMode(){
  return Boolean(sortSettings && sortSettings.minimalMode);
}

function applyAppearanceSettings(){
  const s = sortSettings || {};
  document.body.classList.toggle('compact-mode', !!s.compactMode);
  document.body.classList.toggle('minimal-mode', !!s.minimalMode);
  document.documentElement.dataset.fontScale = s.fontScale || 'medium';
  const mode = s.themeMode || 'system';
  const root = document.documentElement;
  if(mode === 'system'){
    root.removeAttribute('data-theme');
    root.style.removeProperty('color-scheme');
  }else{
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if(meta)meta.content = mode === 'system' ? 'light dark' : mode;
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

// ASYNC: if home city is unset, set it from a place's coordinates (reverse
// geocode → "City, Country"). Never overwrites an existing city. Used when
// the user adds a place so they don't also have to type a general city.
async function maybeInferHomeCityFromPlace(lat,lng){
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return false;
  let name = 'Home area';
  try{
    if(typeof reverseGeocodeCity === 'function'){
      const city = await reverseGeocodeCity(lat,lng);
      if(city && city.name)name = city.name;
    }
  }catch{ /* keep fallback name */ }
  // User may have set a city while the reverse lookup was in flight.
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
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
    updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng});
    if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
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
  updateSortSetting({homeCityName:'', homeCityLat:null, homeCityLng:null});
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
