// ─────────────────────────────────────────────────────────────────────────
// LOCATIONS — registry CRUD + per-location hours editor (settings sheet).
// Mirrors the blocked-time controls: an inline list of richly-structured
// rows, each editable in place, persisted through updateSortSetting.
// ─────────────────────────────────────────────────────────────────────────

// Tracks which location rows have their "per-day / best time" expander open, so
// the state survives the list re-render that follows each patch.
const expandedLocationMores = new Set();
// Tracks locations where "24h" was just unchecked but a full custom window
// hasn't been committed yet, so a patch elsewhere on the sheet (this row or
// another) doesn't silently flip the checkbox back on and hide the inputs
// out from under the user mid-edit.
const pendingLocationHoursEdit = new Set();
function clearLocationHoursEditing(index){
  pendingLocationHoursEdit.delete(index);
}

// PURE: keep a Set of row indices aligned with the locations array after a
// removal — drops the removed index and shifts every later index down by
// one. Shared by every per-row transient UI state (expanders, mid-edit
// flags) so none of them can point at the wrong row after a delete.
function reindexSetAfterRemoval(set,removedIndex){
  const shifted = [...set].filter(i=>i !== removedIndex).map(i=>i > removedIndex ? i - 1 : i);
  set.clear();
  shifted.forEach(i=>set.add(i));
}

// RENDER: the full location registry list.
function renderLocationControls(){
  const wrap = $('location-list');
  if(!wrap)return;
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const displayLocations = locations
    .map((loc,index)=>({loc,index}))
    .sort((a,b)=>compareLocationNames(a.loc,b.loc));
  const empty = $('location-empty-hint');
  if(empty)empty.hidden = locations.length > 0;
  const summary = $('location-list-summary');
  if(summary)summary.textContent = locations.length
    ? `${locations.length} saved ${locations.length === 1 ? 'place' : 'places'}`
    : 'No saved places';
  wrap.innerHTML = displayLocations.map(({loc,index})=>locationRowMarkup(loc,index)).join('');
  // Restore "more" expansion across re-renders.
  expandedLocationMores.forEach(i=>{
    const body = wrap.querySelector(`[data-location-more="${i}"]`);
    if(body)body.hidden = false;
  });
}

// RENDER: rebuild ONE location row in place. Used after every field-level
// patch so editing location B can never disturb whatever the user is
// mid-typing into location A (or into a different field on this same row —
// expandedLocationMores / pendingLocationHoursEdit are consulted by
// locationRowMarkup so that state survives the rebuild). Falls back to a
// full-list render if the row isn't there yet, which should not normally
// happen since add/remove already re-render the whole list themselves.
function rerenderLocationRow(index){
  const wrap = $('location-list');
  const row = wrap && wrap.querySelector(`[data-location-row="${index}"]`);
  const loc = normalizeLocationRegistry(sortSettings.locations)[index];
  if(!wrap || !row || !loc){ renderLocationControls(); return; }
  row.outerHTML = locationRowMarkup(loc,index);
}

// RENDER: one location row — name, pin, hours, radius always visible;
// closed days + preferred/per-day hours live behind More.
function locationRowMarkup(loc,i){
  // hoursSaved: is there an actual saved window? Controls the values shown.
  // hoursOpenUI: should the fields render enabled / checkbox unchecked? Also
  // true while the user has unchecked "All day" but not yet committed a window,
  // so a patch elsewhere on the sheet can't silently re-collapse this row.
  const hoursSaved = Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd);
  const hoursOpenUI = hoursSaved || pendingLocationHoursEdit.has(i);
  const startVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeStart) : '';
  const endVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeEnd) : '';
  const closedSet = new Set(Array.isArray(loc.closedDays) ? loc.closedDays : []);
  const prefSet = Number.isFinite(loc.preferredTimeStart) && Number.isFinite(loc.preferredTimeEnd);
  const prefStart = prefSet ? minutesToTimeInput(loc.preferredTimeStart) : '';
  const prefEnd = prefSet ? minutesToTimeInput(loc.preferredTimeEnd) : '';
  const moreOpen = expandedLocationMores.has(i);
  const radius = Number.isFinite(loc.radiusM) ? Math.round(loc.radiusM) : DEFAULT_LOCATION_RADIUS_M;
  const closedCount = closedSet.size;
  const moreSummary = [
    closedCount ? `closed ${closedCount}d` : null,
    prefSet ? 'preferred time' : null
  ].filter(Boolean).join(' · ');
  return `<div class="location-row" data-location-row="${i}">
    <div class="location-row-head">
      <span class="location-row-icon" aria-hidden="true"><i class="ti ti-map-pin"></i></span>
      <input type="text" class="location-name" data-loc-name="${i}" aria-label="place name" maxlength="48" value="${escapeHtml(loc.name)}" />
      <button class="mini-text-btn location-remove-btn" type="button" data-loc-remove="${i}" aria-label="remove ${escapeHtml(loc.name)}"><i class="ti ti-trash" aria-hidden="true"></i><span>remove</span></button>
    </div>
    <div class="location-meta">
      <input type="text" class="location-address" data-loc-address="${i}" aria-label="address" maxlength="120" value="${escapeHtml(loc.address)}" placeholder="address (optional)" />
      <button class="mini-text-btn location-pin-btn" type="button" data-loc-edit-pin="${i}" title="edit pin on map">
        <i class="ti ti-map-pin" aria-hidden="true"></i> edit map
      </button>
    </div>
    <div class="location-hours">
      <span class="loc-field-label">hours</span>
      <input type="time" step="900" data-loc-start="${i}" aria-label="open from" value="${startVal}" ${hoursOpenUI ? '' : 'disabled'} />
      <span class="loc-sep">–</span>
      <input type="time" step="900" data-loc-end="${i}" aria-label="open until" value="${endVal}" ${hoursOpenUI ? '' : 'disabled'} />
      <button type="button" class="loc-allday ${hoursOpenUI ? '' : 'on'}" data-loc-allday="${i}" aria-pressed="${hoursOpenUI ? 'false' : 'true'}">All day</button>
    </div>
    <div class="location-radius">
      <span class="loc-field-label">nearby</span>
      <input type="number" data-loc-radius="${i}" aria-label="how close in metres" min="10" max="2000" step="5" inputmode="numeric" value="${radius}" />
      <span class="loc-unit">m</span>
      <span class="loc-hint">how close means you’re here</span>
    </div>
    <button class="mini-text-btn loc-more-toggle" type="button" data-loc-more="${i}" aria-expanded="${moreOpen}">${moreOpen ? '▾' : '▸'} more options${moreSummary ? ` · ${moreSummary}` : ''}</button>
    <div class="location-more" data-location-more="${i}" ${moreOpen ? '' : 'hidden'}>
      <div class="location-days">
        <span class="loc-field-label">closed</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const on = closedSet.has(day);
          return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-loc-closed-day="${day}" data-loc-index="${i}" aria-pressed="${on}">${label}</button>`;
        }).join('')}
      </div>
      <div class="loc-pref">
        <span class="loc-field-label">prefer</span>
        <input type="time" step="900" data-loc-pref-start="${i}" aria-label="prefer from" value="${prefStart}" />
        <span class="loc-sep">–</span>
        <input type="time" step="900" data-loc-pref-end="${i}" aria-label="prefer until" value="${prefEnd}" />
        <button class="mini-text-btn" type="button" data-loc-pref-clear="${i}">clear</button>
      </div>
      <div class="loc-perday">
        <span class="loc-field-label">by day</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const hd = loc.hoursByDay && loc.hoursByDay[day];
          const isClosed = hd === null;
          const ds = hd && Number.isFinite(hd.start) ? minutesToTimeInput(hd.start) : '';
          const de = hd && Number.isFinite(hd.end) ? minutesToTimeInput(hd.end) : '';
          return `<div class="perday-row">
            <span class="perday-label">${label}</span>
            <input type="time" step="900" data-loc-day-start="${day}" data-loc-day-idx="${i}" value="${ds}" ${isClosed ? 'disabled' : ''} />
            <span class="loc-sep">–</span>
            <input type="time" step="900" data-loc-day-end="${day}" data-loc-day-idx="${i}" value="${de}" ${isClosed ? 'disabled' : ''} />
            <label class="perday-closed"><input type="checkbox" data-loc-day-closed="${day}" data-loc-day-idx="${i}" ${isClosed ? 'checked' : ''} /> closed</label>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

// HYBRID: patch one location and persist. Re-renders only that row — sibling
// rows (and any mid-edit state on this one, like an unchecked-but-uncommitted
// "24h" box) are left completely alone.
function saveLocationPatch(index,patch){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(!locations[index])return;
  locations[index] = {...locations[index],...patch};
  updateSortSetting({locations},{renderNow:false});
  // A renamed row may move alphabetically. `change` fires after editing is
  // complete, so a full list rebuild is safe and makes the order immediate.
  if(Object.prototype.hasOwnProperty.call(patch,'name'))renderLocationControls();
  else rerenderLocationRow(index);
  render();
}

// HYBRID: add a location to the registry (called by the geocode pick, GPS, or a
// manual entry). Generates a stable opaque id. Enforces MAX_LOCATIONS.
// Returns the new id on success, or null on failure (so callers — e.g. the
// detail-pane "+ new place" flow — can auto-select the freshly created place).
// When no home city is set yet, infers one from the new place's coordinates.
function addLocation({name,address,lat,lng,emoji}){
  const cleanName = String(name || '').trim().slice(0,48);
  if(!cleanName){ showToast('enter a name'); return null; }
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){ showToast('missing coordinates'); return null; }
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(locations.length >= MAX_LOCATIONS){ showToast(`limit ${MAX_LOCATIONS} locations`); return null; }
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  locations.push({
    id, name:cleanName,
    address:String(address || '').trim().slice(0,120),
    lat, lng,
    emoji:String(emoji || '').slice(0,4),
    radiusM:DEFAULT_LOCATION_RADIUS_M
  });
  updateSortSetting({locations},{renderNow:false});
  renderLocationControls();
  render();
  showToast(`added ${cleanName}`);
  if(typeof maybeInferHomeCityFromPlace === 'function')maybeInferHomeCityFromPlace(lat,lng);
  return id;
}

// PURE: habits that still reference a place id (locationIds / preferred / prefs).
function habitsUsingLocationId(locId, data){
  const id = cleanLocationId(locId);
  if(!id)return [];
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(!h)return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds : [];
    if(ids.some(x => cleanLocationId(x) === id))return true;
    if(cleanLocationId(h.preferredLocationId) === id)return true;
    if(h.locationPrefs && typeof h.locationPrefs === 'object' && Object.prototype.hasOwnProperty.call(h.locationPrefs, id)){
      return true;
    }
    return false;
  });
}

// PURE: habits that rely on home city for prayer windows (anchors, no places).
function habitsUsingHomeCity(data){
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(typeof habitUsesPrayerAnchors !== 'function' || !habitUsesPrayerAnchors(h))return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds.filter(Boolean) : [];
    return ids.length === 0;
  });
}

// PURE: short toast listing habit names that block a destructive settings action.
function habitsInUseToast(prefix, habits){
  const names = (habits || []).map(h=>{
    if(typeof sampleDisplayName === 'function'){
      const n = sampleDisplayName(h);
      if(n)return n;
    }
    return (h && h.name) || 'habit';
  }).filter(Boolean);
  if(!names.length)return prefix;
  const shown = names.slice(0,4);
  const more = names.length > shown.length ? ` +${names.length - shown.length}` : '';
  return `${prefix}: ${shown.join(', ')}${more}`;
}

// HYBRID: remove a location, prune its travel edges, and sweep the dangling id
// off every habit (locationIds + preferredLocationId). Resets any location
// filter that pointed at it (Phase 5 globals, guarded). Blocked when any habit
// still references the place — user must clear those habits first.
function removeLocation(index){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const removed = locations[index];
  if(!removed)return;
  const users = habitsUsingLocationId(removed.id);
  if(users.length){
    const label = removed.name || 'place';
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast(`can't remove ${label} — still used by`, users));
    }
    return;
  }
  reindexSetAfterRemoval(expandedLocationMores,index);
  reindexSetAfterRemoval(pendingLocationHoursEdit,index);
  locations.splice(index,1);
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    if(edge.a !== removed.id && edge.b !== removed.id)travel[key] = edge;
  }
  updateSortSetting({locations,travel},{renderNow:false});
  const {data,changed} = reconcileLocations(load(),{...sortSettings,locations,travel});
  if(changed)save(data);
  if(typeof homeLocationFilter !== 'undefined' && homeLocationFilter === removed.id)homeLocationFilter = 'all';
  if(typeof overviewLocationFilter !== 'undefined' && overviewLocationFilter === removed.id)overviewLocationFilter = 'all';
  renderLocationControls();
  refreshOpenViews();
}

// HYBRID: update one location's hoursByDay[weekday] from the per-day editor.
// closed=true → null (closed that day); both times set → {start,end}; otherwise
// the override is dropped so the day falls back to the default window.
function saveLocationDayPatch(index,weekday,{start,end,closed}){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const loc = locations[index];
  if(!loc)return;
  const hoursByDay = {...(loc.hoursByDay || {})};
  if(closed){
    hoursByDay[weekday] = null;
  }else if(start !== null && end !== null){
    hoursByDay[weekday] = {start,end};
  }else{
    delete hoursByDay[weekday];
  }
  saveLocationPatch(index,{hoursByDay});
}

// HANDLER: toggle the "more" expander on a location row.
function toggleLocationMore(index){
  const body = document.querySelector(`[data-location-more="${index}"]`);
  const btn = document.querySelector(`[data-loc-more="${index}"]`);
  if(!body)return;
  const opening = body.hidden;
  body.hidden = !opening;
  if(opening)expandedLocationMores.add(index); else expandedLocationMores.delete(index);
  if(btn){
    btn.setAttribute('aria-expanded',String(opening));
    btn.innerHTML = (opening ? '▾' : '▸') + ' hours by day &amp; preferred time';
  }
}

// ── Location map picker (Leaflet) ───────────────────────────────────────
let pickerMap = null;
let pickerMarker = null;
let pickerEditIndex = null;
let pickerReverseTimer = null;
let pickerSuppressReverse = false;
let pickerDragging = false;
let pendingPickerResults = [];
let pickerMapGen = 0;
let pickerSearchGen = 0;

function destroyLocationPickerMap(){
  pickerMapGen += 1;
  if(pickerReverseTimer){ clearTimeout(pickerReverseTimer); pickerReverseTimer = null; }
  pickerDragging = false;
  if(pickerMap){
    try{
      pickerMap.stop();
      pickerMap.off();
      pickerMap.remove();
    }catch{ /* ignore */ }
    pickerMap = null;
    pickerMarker = null;
  }
  const el = $('picker-map');
  if(el){
    el.innerHTML = '';
    if(el._leaflet_id)delete el._leaflet_id;
  }
}

function pickerPanTo(lat,lng,zoom){
  if(!pickerMap || !Number.isFinite(lat) || !Number.isFinite(lng))return;
  try{
    const opts = { animate:false };
    if(Number.isFinite(zoom))pickerMap.setView([lat,lng],zoom,opts);
    else pickerMap.panTo([lat,lng],opts);
  }catch{ /* map mid-teardown */ }
}

function pickerSetCoords(lat,lng,{ reverse = true, pan = true, nameFromSearch = null, addressFromSearch = null } = {}){
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return;
  const latEl = $('picker-lat');
  const lngEl = $('picker-lng');
  if(latEl)latEl.value = String(Math.round(lat * 1e6) / 1e6);
  if(lngEl)lngEl.value = String(Math.round(lng * 1e6) / 1e6);
  try{
    if(pickerMarker)pickerMarker.setLatLng([lat,lng]);
  }catch{ /* ignore */ }
  if(pan)pickerPanTo(lat,lng);
  if(addressFromSearch){
    const hint = $('picker-address-hint');
    if(hint)hint.textContent = addressFromSearch;
  }
  if(nameFromSearch){
    const nameEl = $('picker-name');
    if(nameEl && !nameEl.value.trim())nameEl.value = nameFromSearch;
  }
  if(!reverse || pickerSuppressReverse)return;
  if(pickerReverseTimer)clearTimeout(pickerReverseTimer);
  const gen = pickerMapGen;
  pickerReverseTimer = setTimeout(async ()=>{
    pickerReverseTimer = null;
    if(gen !== pickerMapGen)return;
    const result = await reverseGeocode(lat,lng);
    if(gen !== pickerMapGen || !result)return;
    const hint = $('picker-address-hint');
    if(hint)hint.textContent = result.address || '';
    const nameEl = $('picker-name');
    if(nameEl && !nameEl.value.trim() && result.name)nameEl.value = result.name;
  },450);
}

function syncPickerPinToMapCenter({ reverse = true } = {}){
  if(!pickerMap || pickerDragging)return;
  let center = null;
  try{ center = pickerMap.getCenter(); }catch{ return; }
  if(!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))return;
  let cur = null;
  try{ cur = pickerMarker && pickerMarker.getLatLng(); }catch{ cur = null; }
  if(cur && Math.abs(cur.lat - center.lat) < 1e-7 && Math.abs(cur.lng - center.lng) < 1e-7)return;
  pickerSetCoords(center.lat,center.lng,{reverse,pan:false});
}

function ensureLocationPickerMap(lat,lng){
  const el = $('picker-map');
  if(!el || typeof L === 'undefined')return;
  const startLat = Number.isFinite(lat) ? lat : 40.7359;
  const startLng = Number.isFinite(lng) ? lng : -74.0036;
  if(!pickerMap){
    pickerMap = L.map(el,{
      zoomControl:true,
      attributionControl:true,
      zoomAnimation:false,
      fadeAnimation:false,
      markerZoomAnimation:false
    }).setView([startLat,startLng],15,{animate:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'&copy; OpenStreetMap'
    }).addTo(pickerMap);
    // The fixed center target is the one pin the user positions. Keep an
    // invisible marker only as a lightweight coordinate holder for existing
    // map-sync code; showing both produced two competing pins on small maps.
    pickerMarker = L.marker([startLat,startLng],{ opacity:0,interactive:false }).addTo(pickerMap);
    pickerMap.on('click',e=>{
      pickerSetCoords(e.latlng.lat,e.latlng.lng,{reverse:true});
    });
    // After a pan/zoom, snap the pin to the crosshair (map center).
    pickerMap.on('moveend',()=>syncPickerPinToMapCenter({reverse:true}));
  }else{
    pickerPanTo(startLat,startLng,pickerMap.getZoom() || 15);
    try{ if(pickerMarker)pickerMarker.setLatLng([startLat,startLng]); }catch{ /* ignore */ }
  }
  const gen = pickerMapGen;
  setTimeout(()=>{ try{ if(pickerMap && gen === pickerMapGen)pickerMap.invalidateSize(); }catch{ /* ignore */ } },80);
  setTimeout(()=>{ try{ if(pickerMap && gen === pickerMapGen)pickerMap.invalidateSize(); }catch{ /* ignore */ } },320);
}

// HYBRID: open add/edit place picker with map pin. `opts.onCreated(id)` fires
// once after a brand-new place is saved, so callers (e.g. the detail-pane
// "+ new place" pill) can auto-select it on the habit they came from.
let pickerOnCreated = null;
function openLocationPicker(opts = {}){
  pickerSearchGen += 1;
  pickerEditIndex = Number.isInteger(opts.index) ? opts.index : null;
  pickerOnCreated = typeof opts.onCreated === 'function' ? opts.onCreated : null;
  const title = $('location-picker-title');
  if(title)title.textContent = pickerEditIndex != null ? 'edit place' : 'add place';
  const saveBtn = $('picker-save');
  if(saveBtn)saveBtn.textContent = pickerEditIndex != null ? 'save changes' : 'add place';
  const nameEl = $('picker-name');
  const searchEl = $('picker-search');
  const searchBtn = $('picker-search-btn');
  const results = $('picker-results');
  const hint = $('picker-address-hint');
  if(nameEl)nameEl.value = opts.name || '';
  if(searchEl)searchEl.value = opts.address || '';
  if(searchBtn){ searchBtn.disabled = false; searchBtn.textContent = 'search'; }
  if(results){ results.hidden = true; results.innerHTML = ''; }
  if(hint)hint.textContent = opts.address || '';
  pendingPickerResults = [];
  pickerSuppressReverse = true;
  openSheet('location-picker-sheet');
  const lat = Number.isFinite(opts.lat) ? opts.lat : (currentCoord ? currentCoord.lat : 40.7359);
  const lng = Number.isFinite(opts.lng) ? opts.lng : (currentCoord ? currentCoord.lng : -74.0036);
  ensureLocationPickerMap(lat,lng);
  pickerSetCoords(lat,lng,{reverse:!Number.isFinite(opts.lat),addressFromSearch:opts.address || null});
  pickerSuppressReverse = false;
}

function closeLocationPicker(){
  pickerSearchGen += 1;
  closeSheet('location-picker-sheet');
  destroyLocationPickerMap();
  pickerEditIndex = null;
  pickerOnCreated = null;
}

async function searchPickerLocations(){
  const searchEl = $('picker-search');
  const resultsWrap = $('picker-results');
  const btn = $('picker-search-btn');
  if(!searchEl || !resultsWrap)return;
  const q = searchEl.value.trim();
  if(!q){ showToast('enter a place or address'); searchEl.focus(); return; }
  const searchGen = ++pickerSearchGen;
  resultsWrap.hidden = false;
  resultsWrap.setAttribute('aria-busy','true');
  resultsWrap.innerHTML = '<p class="field-hint location-search-status"><i class="ti ti-loader-2" aria-hidden="true"></i> Searching…</p>';
  if(btn){ btn.disabled = true; btn.textContent = 'searching…'; }
  try{
    const found = await geocodeSearch(q,{limit:6});
    if(searchGen !== pickerSearchGen)return;
    pendingPickerResults = found;
  }catch{
    pendingPickerResults = [];
  }
  if(searchGen !== pickerSearchGen)return;
  resultsWrap.removeAttribute('aria-busy');
  if(btn){ btn.disabled = false; btn.textContent = 'search'; }
  if(!pendingPickerResults.length){
    resultsWrap.innerHTML = '<p class="field-hint location-search-status"><b>No matches.</b> Try a nearby landmark, a fuller address, coordinates, or move the map.</p>';
    showToast('no address matches');
    return;
  }
  resultsWrap.innerHTML = `<p class="location-results-label">choose a result</p>` + pendingPickerResults.map((r,idx)=>`<button type="button" class="location-result" data-picker-result="${idx}">
    <span class="location-result-mark"><i class="ti ti-map-pin" aria-hidden="true"></i></span><span><b>${escapeHtml(r.name)}</b><small>${escapeHtml(r.address)}</small></span><i class="ti ti-chevron-right location-result-arrow" aria-hidden="true"></i>
  </button>`).join('');
  resultsWrap.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function pickPickerResult(idx){
  const r = pendingPickerResults[idx];
  if(!r)return;
  const nameEl = $('picker-name');
  if(nameEl && !nameEl.value.trim())nameEl.value = r.name;
  pickerSetCoords(r.lat,r.lng,{reverse:false,nameFromSearch:r.name,addressFromSearch:r.address});
  pickerPanTo(r.lat,r.lng,Math.max((pickerMap && pickerMap.getZoom()) || 15,16));
  const resultsWrap = $('picker-results');
  if(resultsWrap){ resultsWrap.hidden = true; resultsWrap.innerHTML = ''; }
  showToast(`${r.name} selected — adjust the map if needed`);
}

function applyPickerCoordsInputs(){
  const lat = Number(($('picker-lat') && $('picker-lat').value) || NaN);
  const lng = Number(($('picker-lng') && $('picker-lng').value) || NaN);
  if(!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180){
    showToast('enter valid lat / lng');
    return;
  }
  pickerSetCoords(lat,lng,{reverse:true});
}

function centerPickerOnGps(){
  // Direct request from this tap — the button itself is the user gesture +
  // rationale ("move pin to my location"). Avoid stacking a second sheet over
  // the map picker (breaks iOS hit-testing).
  requestLocationAccess({quiet:false,updateAnchor:false,enableHighAccuracy:true}).then(status=>{
    if(status !== 'granted' || !currentCoord)return;
    pickerSetCoords(currentCoord.lat,currentCoord.lng,{reverse:true});
    pickerPanTo(currentCoord.lat,currentCoord.lng,Math.max((pickerMap && pickerMap.getZoom()) || 15,16));
    showToast('pin moved to your location');
  });
}

function saveLocationPicker(){
  const name = (($('picker-name') && $('picker-name').value) || '').trim();
  const lat = Number(($('picker-lat') && $('picker-lat').value) || NaN);
  const lng = Number(($('picker-lng') && $('picker-lng').value) || NaN);
  const address = (($('picker-address-hint') && $('picker-address-hint').textContent) || '').trim().slice(0,120);
  if(!name){ showToast('enter a name'); $('picker-name')?.focus(); return; }
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){ showToast('drop a pin on the map'); return; }
  if(pickerEditIndex != null){
    saveLocationPatch(pickerEditIndex,{name,address,lat,lng});
    showToast('pin updated');
    closeLocationPicker();
    return;
  }
  const id = addLocation({name,address,lat,lng});
  if(id){
    // Capture before closeLocationPicker clears the one-shot callback.
    const cb = pickerOnCreated;
    closeLocationPicker();
    if(typeof cb === 'function')cb(id);
  }
}

// HYBRID: commit the default open-window pair. Both present → set both; both
// empty → 24h; exactly one present → hold (leave the DOM as-is so the user can
// finish typing the other half, since an incomplete window normalizes to 24h).
function commitLocationHours(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-start]');
  const eEl = row.querySelector('[data-loc-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:s,allowedTimeEnd:e});
  }else if(s === null && e === null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:null,allowedTimeEnd:null});
  }
  // else: exactly one filled — hold. pendingLocationHoursEdit keeps the
  // fields open/enabled through any unrelated re-render until this resolves.
}

// HYBRID: commit the preferred-time pair (same incomplete-pair rule).
function commitLocationPref(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-pref-start]');
  const eEl = row.querySelector('[data-loc-pref-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationPatch(index,{preferredTimeStart:s,preferredTimeEnd:e});
  else if(s === null && e === null)saveLocationPatch(index,{preferredTimeStart:null,preferredTimeEnd:null});
}

// HYBRID: commit one per-day override pair. Both present → {start,end}; both
// empty → override dropped (falls back to default); exactly one → hold.
function commitLocationDayHours(index,weekday){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector(`[data-loc-day-start="${weekday}"]`);
  const eEl = row.querySelector(`[data-loc-day-end="${weekday}"]`);
  const cEl = row.querySelector(`[data-loc-day-closed="${weekday}"]`);
  if(cEl && cEl.checked){ saveLocationDayPatch(index,weekday,{closed:true}); return; }
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationDayPatch(index,weekday,{start:s,end:e,closed:false});
  else if(s === null && e === null)saveLocationDayPatch(index,weekday,{closed:false});
}

// HYBRID: patch sort state and re-sync UI
