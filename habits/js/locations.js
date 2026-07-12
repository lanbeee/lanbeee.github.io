// Locations — physical-place registry, travel-time provider layer, and geocoding.
//
// This module is the one genuinely new subsystem topics never had: it computes
// the *cost of moving* between two saved locations and caches the result so we
// never pay for the same pair twice. The Today agenda (Phase 6) consults this
// to sequence the day spatially; the registry/hours math lives in data.js.
//
// Provider ladder (most-preferred → floor):
//   1. OSRM (default, no key)  — real road route, driving only on the public demo server
//   2. Google Maps Directions  — enabled by MAPS_API_KEY in config.js (Phase 2 slot)
//   3. Haversine               — pure lat/lng great-circle; always available, never blocks
//
// Every network result is cached in sortSettings.travel (keyed by the lexically-
// ordered id pair) with a 30-day TTL and persisted through the normal settings
// save path. The service worker (sw.js MAPS_CACHE) double-covers the raw HTTP
// responses. The agenda reads synchronously via travelBetween(), which returns
// the best edge it has *right now* (fresh cache → stale cache → haversine) and
// fires a background refresh when the cache is stale — the render path never
// awaits the network.
//
// Annotated for the React Native port, matching list-view/today-view:
//   - PURE    -> plain helper (ports verbatim)
//   - ASYNC   -> I/O function (becomes an async RN module method)
//   - HANDLER -> UI callback (not present in this module; UI lives in settings.js)

// ─────────────────────────────────────────────────────────────────────────
// PURE — distance + travel-time math. No I/O, no deps beyond config constants.
// ─────────────────────────────────────────────────────────────────────────

// Average cruise speed per travel mode, in metres/second. Used only to convert
// a *distance* into an approximate *time* when no routed result is available
// (non-driving modes, or any haversine fallback). Driving uses the routed OSRM
// duration directly when the call succeeds.
const TRAVEL_MODE_SPEED_MS = { driving:11.1111, walking:1.3889, bicycling:4.167, transit:5.556 };

// PURE: great-circle distance between two WGS84 points, in metres.
function haversineMetres(aLat,aLng,bLat,bLng){
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1,Math.sqrt(h))));
}

// PURE: approximate travel seconds from a straight-line distance, using a
// mode-appropriate average speed. The instant floor before any network edge
// exists and the permanent fallback when the network is unavailable.
function haversineTravelSeconds(metres,mode){
  const speed = TRAVEL_MODE_SPEED_MS[mode] || TRAVEL_MODE_SPEED_MS[DEFAULT_TRAVEL_MODE];
  return Math.round(metres / speed);
}

// PURE: the cache key for an id pair, lexically ordered so A→B and B→A collide.
function edgeKey(aId,bId){
  const a = cleanLocationId(aId);
  const b = cleanLocationId(bId);
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// PURE: a synthetic non-cached edge straight from haversine. Used as the
// instant floor when nothing is cached and as the fallback after a failed
// fetch. fetchedAt:0 signals "never routed" so a real refresh is always due.
function haversineEdge(locA,locB,mode){
  const m = normalizeTravelMode(mode);
  const metres = haversineMetres(locA.lat,locA.lng,locB.lat,locB.lng);
  const [a,b] = locA.id < locB.id ? [locA.id,locB.id] : [locB.id,locA.id];
  return { a, b, seconds:haversineTravelSeconds(metres,m), metres, provider:'haversine', fetchedAt:0 };
}

// PURE: is the given cached edge still fresh enough to use without a refresh?
// Manual overrides stay fresh forever until the user resets them.
function edgeIsFresh(edge,now = Date.now()){
  if(!edge)return false;
  if(edge.provider === 'manual')return true;
  return Number.isFinite(edge.fetchedAt) && (now - edge.fetchedAt) < TRAVEL_TTL_MS;
}

// ─────────────────────────────────────────────────────────────────────────
// ASYNC — provider ladder. Each returns {seconds,metres,provider}. Never throws;
// any failure collapses to a haversine result so callers can treat the network
// as a pure optimization.
// ─────────────────────────────────────────────────────────────────────────

// ASYNC: resolve one edge through the provider ladder. Driving tries OSRM
// (real road route); every other mode and every failure falls back to
// haversine distance + the mode's average speed. Bounded by
// TRAVEL_FETCH_TIMEOUT_MS so a slow server can never stall the agenda.
async function fetchEdge(locA,locB,mode){
  const m = normalizeTravelMode(mode);
  if(m !== 'driving'){
    const metres = haversineMetres(locA.lat,locA.lng,locB.lat,locB.lng);
    return { seconds:haversineTravelSeconds(metres,m), metres, provider:'haversine' };
  }
  try{
    const url = `${OSRM_BASE}/route/v1/driving/${locA.lng},${locA.lat};${locB.lng},${locB.lat}?overview=false`;
    const res = await Promise.race([
      fetch(url),
      new Promise((_,reject) => setTimeout(() => reject(new Error('osrm-timeout')),TRAVEL_FETCH_TIMEOUT_MS))
    ]);
    if(!res.ok)throw new Error('osrm-http-' + res.status);
    const json = await res.json();
    const route = json && json.routes && json.routes[0];
    if(!route || typeof route.duration !== 'number' || typeof route.distance !== 'number')throw new Error('osrm-no-route');
    return { seconds:Math.round(route.duration), metres:Math.round(route.distance), provider:'osrm' };
  }catch{
    const metres = haversineMetres(locA.lat,locA.lng,locB.lat,locB.lng);
    return { seconds:haversineTravelSeconds(metres,'driving'), metres, provider:'haversine' };
  }
}

// ASYNC: fetch a fresh edge and write it into the in-memory cache + persist.
// Returns the stored TravelEdge (with a/b ids and fetchedAt). Fire-and-forget
// from travelBetween(); may also be awaited to warm the cache explicitly.
async function refreshEdge(locA,locB,mode,{force = false} = {}){
  const m = normalizeTravelMode(mode);
  const [a,b] = locA.id < locB.id ? [locA.id,locB.id] : [locB.id,locA.id];
  const key = edgeKey(a,b);
  const s = sortSettings || (sortSettings = {});
  if(!s.travel)s.travel = {};
  // Never overwrite a user-edited travel time unless force (reset to estimate).
  if(!force && s.travel[key] && s.travel[key].provider === 'manual')return s.travel[key];
  const result = await fetchEdge(locA,locB,m);
  const stored = { a, b, seconds:result.seconds, metres:result.metres, provider:result.provider, fetchedAt:Date.now() };
  s.travel[key] = stored;
  persistTravelDebounced();
  if(typeof onTravelRefresh === 'function')onTravelRefresh(stored);
  return stored;
}

// SYNC (the public read path): best-available edge for a pair, right now.
//   fresh cache  → return cached
//   stale cache  → kick background refreshEdge, return the stale value
//   no cache     → kick background refreshEdge, return a haversine floor
// Never throws, never blocks, never returns null. The agenda reads this on
// every render; refreshed edges land on the next render via onTravelRefresh.
function travelBetween(locA,locB,mode){
  const m = normalizeTravelMode(mode);
  const s = sortSettings || {};
  const cached = s.travel && s.travel[edgeKey(locA.id,locB.id)];
  if(edgeIsFresh(cached))return cached;
  // Manual edges are always fresh; do not kick a network refresh over them.
  if(cached && cached.provider === 'manual')return cached;
  if(locA && locB && locA.id && locB.id && locA.id !== locB.id)refreshEdge(locA,locB,m);
  return cached || haversineEdge(locA,locB,m);
}

// PURE: whether a cached edge is a user override.
function isManualTravelEdge(edge){
  return Boolean(edge && edge.provider === 'manual');
}

// IMPURE: save a user-edited travel time (minutes) between two locations.
function setManualTravelMinutes(locA,locB,minutes){
  if(!locA || !locB || locA.id === locB.id)return null;
  const secs = Math.max(60,Math.round(Number(minutes) * 60));
  const [a,b] = locA.id < locB.id ? [locA.id,locB.id] : [locB.id,locA.id];
  const key = edgeKey(a,b);
  const s = sortSettings || (sortSettings = {});
  if(!s.travel)s.travel = {};
  const prev = s.travel[key];
  const metres = (prev && Number.isFinite(prev.metres))
    ? prev.metres
    : haversineMetres(locA.lat,locA.lng,locB.lat,locB.lng);
  const stored = { a, b, seconds:secs, metres, provider:'manual', fetchedAt:Date.now() };
  s.travel[key] = stored;
  if(typeof saveSortSettings === 'function')saveSortSettings(s);
  if(typeof onTravelRefresh === 'function')onTravelRefresh(stored);
  return stored;
}

// IMPURE: clear a manual override and re-fetch an estimate.
async function resetTravelEdge(locA,locB,mode){
  if(!locA || !locB)return null;
  const s = sortSettings || (sortSettings = {});
  if(s.travel)delete s.travel[edgeKey(locA.id,locB.id)];
  return refreshEdge(locA,locB,mode,{force:true});
}

// ─────────────────────────────────────────────────────────────────────────
// ASYNC — geocoding (address → lat/lng). Used by the add-location flow in the
// settings manager. Default Nominatim (no key); Google fallback slot reserved.
// ─────────────────────────────────────────────────────────────────────────

// ASYNC: turn a typed address into a ranked list of {name,address,lat,lng}
// candidates. Returns [] on any failure so the caller can show "no matches".
// The caller confirms the right candidate before creating the location —
// geocoding ambiguity is common and a silent wrong pin corrupts every edge.
async function geocodeSearch(query,{ limit = 5 } = {}){
  const q = String(query || '').trim();
  if(!q)return [];
  try{
    const url = `${NOMINATIM_BASE}/search?format=json&limit=${limit}&addressdetails=1&q=${encodeURIComponent(q)}`;
    const res = await Promise.race([
      fetch(url,{ headers:{ 'Accept':'application/json' } }),
      new Promise((_,reject) => setTimeout(() => reject(new Error('nominatim-timeout')),TRAVEL_FETCH_TIMEOUT_MS))
    ]);
    if(!res.ok)return [];
    const json = await res.json();
    if(!Array.isArray(json))return [];
    return json.map(r=>{
      const display = String(r.display_name || '');
      const comma = display.indexOf(',');
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      return {
        name:(comma >= 0 ? display.slice(0,comma) : display).trim().slice(0,48),
        address:display.slice(0,120),
        lat, lng
      };
    }).filter(r => Number.isFinite(r.lat) && r.lat >= -90 && r.lat <= 90 && Number.isFinite(r.lng) && r.lng >= -180 && r.lng <= 180);
  }catch{
    return [];
  }
}

// ASYNC: reverse-geocode a pin into {name,address,lat,lng} (or null).
async function reverseGeocode(lat,lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return null;
  try{
    const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const res = await Promise.race([
      fetch(url,{ headers:{ 'Accept':'application/json' } }),
      new Promise((_,reject) => setTimeout(() => reject(new Error('nominatim-timeout')),TRAVEL_FETCH_TIMEOUT_MS))
    ]);
    if(!res.ok)return null;
    const json = await res.json();
    const display = String(json && json.display_name || '');
    if(!display)return { name:'', address:'', lat, lng };
    const comma = display.indexOf(',');
    return {
      name:(comma >= 0 ? display.slice(0,comma) : display).trim().slice(0,48),
      address:display.slice(0,120),
      lat, lng
    };
  }catch{
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// CACHE PERSISTENCE — debounced writes through the normal settings path so a
// burst of edge refreshes coalesces into one localStorage write.
// ─────────────────────────────────────────────────────────────────────────

let persistTravelTimer = null;

// IMPURE: coalesce travel-cache writes. Multiple refreshEdge calls within the
// window produce a single saveSortSettings() call, keeping localStorage churn
// bounded even while warming a full matrix.
function persistTravelDebounced(){
  if(persistTravelTimer)return;
  persistTravelTimer = setTimeout(() => {
    persistTravelTimer = null;
    try{ if(typeof saveSortSettings === 'function')saveSortSettings(sortSettings); }catch{ /* best-effort */ }
  },2000);
}

// Hook the render layer can set to re-render after a background refresh lands.
// today-view/main wire this in Phase 6; harmless until then.
let onTravelRefresh = null;

// IMPURE: flush any pending travel-cache write immediately (used on teardown /
// before a backup export so the cache on disk matches memory).
function flushTravelCache(){
  if(persistTravelTimer){ clearTimeout(persistTravelTimer); persistTravelTimer = null; }
  try{ if(typeof saveSortSettings === 'function')saveSortSettings(sortSettings); }catch{ /* best-effort */ }
}

// ─────────────────────────────────────────────────────────────────────────
// GEOLOCATION — opt-in live position → matched location id. Raw coords are
// ephemeral (never persisted); only the matched id is written as
// lastKnownLocationId.
// ─────────────────────────────────────────────────────────────────────────

let currentCoord = null;
let geoWatchId = null;

// PURE: nearest registry location within its radiusM, or null.
function matchLocationId(lat,lng,registry){
  const locs = normalizeLocationRegistry(registry);
  let best = null;
  let bestDist = Infinity;
  for(const loc of locs){
    const d = haversineMetres(lat,lng,loc.lat,loc.lng);
    const radius = Number.isFinite(loc.radiusM) ? loc.radiusM : DEFAULT_LOCATION_RADIUS_M;
    if(d <= radius && d < bestDist){
      bestDist = d;
      best = loc.id;
    }
  }
  return best;
}

// PURE: closest registry location by haversine (ignores radius), or null.
function closestLocation(lat,lng,registry){
  const locs = normalizeLocationRegistry(registry);
  let best = null;
  let bestDist = Infinity;
  for(const loc of locs){
    const d = haversineMetres(lat,lng,loc.lat,loc.lng);
    if(d < bestDist){
      bestDist = d;
      best = loc;
    }
  }
  return best ? { loc:best, metres:bestDist } : null;
}

// PURE: presence for UI — at (inside radius or manual lastKnown), near (GPS
// outside all radii), or away. Shared by home status chip + I-am-at picker.
function locationPresence(registry){
  const locs = normalizeLocationRegistry(registry != null ? registry : (sortSettings || {}).locations);
  const lastKnown = cleanLocationId((sortSettings || {}).lastKnownLocationId);
  if(currentCoord){
    const atId = matchLocationId(currentCoord.lat,currentCoord.lng,locs);
    if(atId){
      const loc = locs.find(l=>l.id === atId);
      const metres = loc ? haversineMetres(currentCoord.lat,currentCoord.lng,loc.lat,loc.lng) : 0;
      return { kind:'at', id:atId, name:loc ? loc.name : 'place', metres, gps:true };
    }
    const near = closestLocation(currentCoord.lat,currentCoord.lng,locs);
    if(near){
      return { kind:'near', id:near.loc.id, name:near.loc.name, metres:near.metres, gps:true };
    }
    return { kind:'away', id:null, name:null, metres:null, gps:true };
  }
  if(lastKnown){
    const loc = locs.find(l=>l.id === lastKnown);
    if(loc)return { kind:'at', id:loc.id, name:loc.name, metres:null, gps:false };
  }
  return { kind:'away', id:null, name:null, metres:null, gps:false };
}

// PURE: current matched location id (from live coord or lastKnown fallback).
// Inside a geofence → that place. Otherwise prefer lastKnown (manual pick /
// previous match). Only if neither exists, fall back to the nearest place so
// a first GPS fix can still seed the agenda.
function currentLocationId(){
  if(currentCoord){
    const id = matchLocationId(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
    if(id)return id;
  }
  const last = cleanLocationId((sortSettings || {}).lastKnownLocationId);
  if(last)return last;
  if(currentCoord){
    const near = closestLocation(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
    if(near)return near.loc.id;
  }
  return null;
}

// IMPURE: set the manual "I am at" anchor (persists id only).
function setManualLocationId(id){
  const clean = cleanLocationId(id) || null;
  const s = sortSettings || loadSortSettings();
  if(s.lastKnownLocationId === clean)return;
  if(typeof updateSortSetting === 'function')updateSortSetting({lastKnownLocationId:clean},{renderNow:false});
  else saveSortSettings({...s,lastKnownLocationId:clean});
  if(typeof onTravelRefresh === 'function')onTravelRefresh({manual:true});
}

// IMPURE: request permission + start a low-power watch. On deny, falls back to
// the manual picker (caller renders it). Returns a promise of
// 'granted' | 'denied' | 'unsupported'.
function requestLocationAccess(){
  if(!navigator.geolocation)return Promise.resolve('unsupported');
  return new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(
      pos=>{
        currentCoord = { lat:pos.coords.latitude, lng:pos.coords.longitude };
        const id = matchLocationId(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
        if(id)setManualLocationId(id);
        if(geoWatchId == null){
          geoWatchId = navigator.geolocation.watchPosition(
            p=>{
              currentCoord = { lat:p.coords.latitude, lng:p.coords.longitude };
              const matched = matchLocationId(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
              if(matched && matched !== (sortSettings || {}).lastKnownLocationId){
                setManualLocationId(matched);
                if(typeof renderTodayAgenda === 'function')renderTodayAgenda();
                if(typeof render === 'function')render();
              }
            },
            ()=>{},
            {enableHighAccuracy:false, maximumAge:120000, timeout:15000}
          );
        }
        resolve('granted');
      },
      ()=>resolve('denied'),
      {enableHighAccuracy:false, timeout:10000, maximumAge:60000}
    );
  });
}

// RENDER: "I am at" chip row for the Today sheet (manual fallback / override).
function renderIAmAtPicker(){
  const wrap = $('iam-at-row');
  if(!wrap)return;
  const registry = normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
  if(!registry.length){
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  const presence = locationPresence(registry);
  const current = currentLocationId();
  wrap.hidden = false;
  const status = presence.kind === 'at'
    ? `at ${presence.name}`
    : presence.kind === 'near'
      ? `near ${presence.name}`
      : 'away';
  wrap.innerHTML = `<span class="loc-field-label">I am at <b class="iam-at-status ${presence.kind}">${escapeHtml(status)}</b></span>` + registry.map(loc=>{
    const on = current === loc.id;
    const gpsAt = presence.gps && presence.kind === 'at' && presence.id === loc.id;
    return `<button type="button" class="topic-chip location-chip ${on ? 'on' : ''} ${gpsAt ? 'gps-matched' : ''}" data-iam-at="${escapeHtml(loc.id)}">${escapeHtml(loc.name)}</button>`;
  }).join('') + `<button type="button" class="mini-text-btn" id="iam-at-gps">use GPS</button>`;
}

// RENDER: compact presence picker used from the home status chip.
function renderPresencePickerBody(){
  const wrap = $('presence-picker-chips');
  if(!wrap)return;
  const registry = normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
  const current = currentLocationId();
  const presence = locationPresence(registry);
  if(!registry.length){
    wrap.innerHTML = '<p class="field-hint">Add places in settings first.</p>';
    return;
  }
  wrap.innerHTML = registry.map(loc=>{
    const on = current === loc.id;
    const gpsAt = presence.gps && presence.kind === 'at' && presence.id === loc.id;
    return `<button type="button" class="topic-chip location-chip ${on ? 'on' : ''} ${gpsAt ? 'gps-matched' : ''}" data-presence-pick="${escapeHtml(loc.id)}"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(loc.name)}</button>`;
  }).join('') + `<button type="button" class="topic-chip location-chip" data-presence-gps="1"><i class="ti ti-current-location" aria-hidden="true"></i>use GPS</button>`;
}

// ── Travel-time editor sheet ─────────────────────────────────────────────
let travelEditFromId = null;
let travelEditToId = null;

function openTravelEditSheet(fromId,toId){
  const from = typeof locationById === 'function' ? locationById(fromId) : null;
  const to = typeof locationById === 'function' ? locationById(toId) : null;
  if(!from || !to || from.id === to.id)return;
  travelEditFromId = from.id;
  travelEditToId = to.id;
  const mode = normalizeTravelMode((sortSettings || {}).defaultTravelMode);
  const edge = travelBetween(from,to,mode);
  const mins = Math.max(1,Math.round((edge.seconds || 0) / 60));
  const copy = $('travel-edit-copy');
  if(copy)copy.textContent = `${from.name} → ${to.name}`;
  const modeEl = $('travel-edit-mode');
  if(modeEl){
    const label = edge.provider === 'manual' ? 'edited time' : `${mode} estimate`;
    modeEl.textContent = label;
  }
  const input = $('travel-edit-minutes');
  if(input)input.value = String(mins);
  openSheet('travel-edit-sheet');
}

function closeTravelEditSheet(){
  closeSheet('travel-edit-sheet');
  travelEditFromId = null;
  travelEditToId = null;
}

function saveTravelEditFromSheet(){
  const from = typeof locationById === 'function' ? locationById(travelEditFromId) : null;
  const to = typeof locationById === 'function' ? locationById(travelEditToId) : null;
  const mins = Number(($('travel-edit-minutes') && $('travel-edit-minutes').value) || NaN);
  if(!from || !to || !Number.isFinite(mins) || mins < 1){ showToast('enter minutes'); return; }
  setManualTravelMinutes(from,to,Math.min(240,Math.round(mins)));
  showToast('travel time saved');
  closeTravelEditSheet();
  if(typeof render === 'function')render();
  if(typeof renderTodayAgenda === 'function')renderTodayAgenda();
}

async function resetTravelEditFromSheet(){
  const from = typeof locationById === 'function' ? locationById(travelEditFromId) : null;
  const to = typeof locationById === 'function' ? locationById(travelEditToId) : null;
  if(!from || !to)return;
  const mode = normalizeTravelMode((sortSettings || {}).defaultTravelMode);
  showToast('updating estimate…');
  const edge = await resetTravelEdge(from,to,mode);
  const input = $('travel-edit-minutes');
  if(input && edge)input.value = String(Math.max(1,Math.round((edge.seconds || 0) / 60)));
  const modeEl = $('travel-edit-mode');
  if(modeEl)modeEl.textContent = `${mode} estimate`;
  showToast('estimate restored');
  if(typeof render === 'function')render();
  if(typeof renderTodayAgenda === 'function')renderTodayAgenda();
}

function openPresencePicker(){
  renderPresencePickerBody();
  openSheet('presence-picker-sheet');
}
