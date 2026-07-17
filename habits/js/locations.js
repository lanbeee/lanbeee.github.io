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
// ASYNC: turn a typed address into a ranked list of {name,address,lat,lng}
// candidates. Tries Photon first (browser-friendly), then Nominatim. Returns
// [] on any failure so the caller can show "no matches".
async function geocodeSearch(query,{ limit = 5 } = {}){
  const q = String(query || '').trim();
  if(!q)return [];
  const photon = await geocodeSearchPhoton(q,limit);
  if(photon.length)return photon;
  return geocodeSearchNominatim(q,limit);
}

async function fetchJsonWithTimeout(url,timeoutMs = GEOCODE_FETCH_TIMEOUT_MS){
  const res = await Promise.race([
    fetch(url,{ headers:{ 'Accept':'application/json' } }),
    new Promise((_,reject) => setTimeout(() => reject(new Error('geocode-timeout')),timeoutMs))
  ]);
  if(!res || !res.ok)throw new Error('geocode-http');
  return res.json();
}

function normalizeGeocodeHit(name,address,lat,lng){
  const la = Number(lat);
  const ln = Number(lng);
  if(!Number.isFinite(la) || la < -90 || la > 90 || !Number.isFinite(ln) || ln < -180 || ln > 180)return null;
  return {
    name:String(name || '').trim().slice(0,48) || 'Place',
    address:String(address || '').trim().slice(0,120),
    lat:la, lng:ln
  };
}

async function geocodeSearchPhoton(query,limit){
  try{
    const url = `${PHOTON_BASE}/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`;
    const json = await fetchJsonWithTimeout(url);
    const features = json && Array.isArray(json.features) ? json.features : [];
    return features.map(f=>{
      const props = f && f.properties || {};
      const coords = f && f.geometry && f.geometry.coordinates;
      const lng = coords && coords[0];
      const lat = coords && coords[1];
      const parts = [props.name, props.street, props.housenumber, props.city || props.town || props.village, props.state, props.country]
        .filter(Boolean);
      const address = parts.join(', ') || props.name || '';
      const name = props.name || props.street || (address.split(',')[0] || 'Place');
      return normalizeGeocodeHit(name,address,lat,lng);
    }).filter(Boolean);
  }catch{
    return [];
  }
}

async function geocodeSearchNominatim(query,limit){
  try{
    const url = `${NOMINATIM_BASE}/search?format=json&limit=${limit}&addressdetails=1&q=${encodeURIComponent(query)}`;
    const json = await fetchJsonWithTimeout(url);
    if(!Array.isArray(json))return [];
    return json.map(r=>{
      const display = String(r.display_name || '');
      const comma = display.indexOf(',');
      const name = (comma >= 0 ? display.slice(0,comma) : display).trim();
      return normalizeGeocodeHit(name,display,r.lat,r.lon);
    }).filter(Boolean);
  }catch{
    return [];
  }
}

// ASYNC: reverse-geocode a pin into {name,address,lat,lng} (or null).
async function reverseGeocode(lat,lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return null;
  const photon = await reverseGeocodePhoton(lat,lng);
  if(photon)return photon;
  return reverseGeocodeNominatim(lat,lng);
}

async function reverseGeocodePhoton(lat,lng){
  try{
    const url = `${PHOTON_BASE}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&lang=en`;
    const json = await fetchJsonWithTimeout(url);
    const f = json && Array.isArray(json.features) && json.features[0];
    if(!f)return null;
    const props = f.properties || {};
    const parts = [props.name, props.street, props.housenumber, props.city || props.town || props.village, props.state, props.country]
      .filter(Boolean);
    const address = parts.join(', ') || '';
    const name = props.name || props.street || (address.split(',')[0] || '');
    return normalizeGeocodeHit(name || 'Place',address,lat,lng);
  }catch{
    return null;
  }
}

async function reverseGeocodeNominatim(lat,lng){
  try{
    const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;
    const json = await fetchJsonWithTimeout(url);
    const display = String(json && json.display_name || '');
    if(!display)return { name:'', address:'', lat, lng };
    const comma = display.indexOf(',');
    return normalizeGeocodeHit(
      (comma >= 0 ? display.slice(0,comma) : display).trim(),
      display,
      lat, lng
    );
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
//
// iOS / PWA notes:
//   • Must run in a secure context (HTTPS or localhost).
//   • The first prompt must be triggered by a direct user gesture (tap).
//     Do not await network/UI work before calling getCurrentPosition.
//   • Once granted, later quiet resumes (watch / page load) are allowed.
//   • navigator.permissions.query({name:'geolocation'}) is unreliable on iOS
//     — we treat it as optional and always fall back to getCurrentPosition.
// ─────────────────────────────────────────────────────────────────────────

let currentCoord = null;
let geoWatchId = null;
let locationPermissionPending = null;
let locationAllowCallback = null;

function isIosDevice(){
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalonePwa(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

// PURE: optional Permissions API probe (often "unknown" on iOS).
async function queryLocationPermission(){
  try{
    if(!navigator.permissions || !navigator.permissions.query)return 'unknown';
    const result = await navigator.permissions.query({name:'geolocation'});
    return result && result.state ? result.state : 'unknown';
  }catch{
    return 'unknown';
  }
}

// PURE: human help when the OS blocks location.
function locationDeniedHelpMessage(){
  if(isIosDevice()){
    if(isStandalonePwa()){
      return 'Location is off for Tings. On iPhone: Settings → Privacy & Security → Location Services → enable for this app (or Safari Websites → your site), then tap Enable location again.';
    }
    return 'Location is off. On iPhone: Settings → Safari → Location (or Settings → Privacy & Security → Location Services → Safari Websites), allow access, then try again.';
  }
  return 'Location permission denied. Enable it for this site in your browser settings, then try again.';
}

function setLocationOptIn(on){
  const s = sortSettings || loadSortSettings();
  const next = Boolean(on);
  if(s.locationOptIn === next)return;
  if(typeof updateSortSetting === 'function')updateSortSetting({locationOptIn:next},{renderNow:false});
  else saveSortSettings({...s,locationOptIn:next});
}

function applyGeoPosition(pos,{updateAnchor = true} = {}){
  if(!pos || !pos.coords)return null;
  currentCoord = { lat:pos.coords.latitude, lng:pos.coords.longitude };
  if(updateAnchor){
    const id = matchLocationId(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
    if(id)setManualLocationId(id);
  }
  return currentCoord;
}

function startLocationWatch(){
  if(!navigator.geolocation || geoWatchId != null)return;
  geoWatchId = navigator.geolocation.watchPosition(
    p=>{
      applyGeoPosition(p,{updateAnchor:true});
      const matched = matchLocationId(currentCoord.lat,currentCoord.lng,(sortSettings || {}).locations);
      if(matched){
        if(typeof render === 'function')render();
        if(typeof renderLocationAccessControl === 'function')renderLocationAccessControl();
      }
    },
    ()=>{},
    {enableHighAccuracy:false, maximumAge:120000, timeout:20000}
  );
}

function stopLocationWatch(){
  if(geoWatchId != null && navigator.geolocation){
    try{ navigator.geolocation.clearWatch(geoWatchId); }catch{ /* ignore */ }
  }
  geoWatchId = null;
}

// IMPURE: request permission + one-shot fix + start a low-power watch.
// MUST be called from a user-gesture handler on the first ask (iOS/PWA).
// Returns: 'granted' | 'denied' | 'unavailable' | 'timeout' | 'insecure' | 'unsupported'
function requestLocationAccess(opts = {}){
  const quiet = Boolean(opts.quiet);
  if(!window.isSecureContext){
    if(!quiet && typeof showToast === 'function')showToast('Location needs HTTPS (or localhost)');
    return Promise.resolve('insecure');
  }
  if(!navigator.geolocation){
    if(!quiet && typeof showToast === 'function')showToast('Location not supported on this device');
    return Promise.resolve('unsupported');
  }
  if(locationPermissionPending)return locationPermissionPending;

  // Call getCurrentPosition immediately — do not await anything first (iOS
  // requires the prompt to stay inside the user-gesture chain). Clear the
  // pending slot in finally so a sync success/error mock cannot leave a
  // resolved promise stuck here (assignment runs after the sync callback).
  const pending = new Promise(resolve=>{
    navigator.geolocation.getCurrentPosition(
      pos=>{
        applyGeoPosition(pos,{updateAnchor:opts.updateAnchor !== false});
        setLocationOptIn(true);
        startLocationWatch();
        if(!quiet && typeof showToast === 'function')showToast('location on');
        if(typeof renderLocationAccessControl === 'function')renderLocationAccessControl();
        if(typeof render === 'function')render();
        resolve('granted');
      },
      err=>{
        const code = err && err.code;
        let status = 'denied';
        if(code === 2)status = 'unavailable';
        else if(code === 3)status = 'timeout';
        if(status === 'denied')setLocationOptIn(false);
        if(!quiet && typeof showToast === 'function'){
          if(status === 'denied')showToast(locationDeniedHelpMessage());
          else if(status === 'timeout')showToast('location timed out — try again outdoors or with Wi‑Fi');
          else showToast('could not read your location');
        }
        if(typeof renderLocationAccessControl === 'function')renderLocationAccessControl();
        resolve(status);
      },
      {
        // First fix: allow a bit more time; high accuracy helps outdoor pins.
        enableHighAccuracy:opts.enableHighAccuracy !== false,
        timeout:opts.timeout || 20000,
        maximumAge:opts.maximumAge != null ? opts.maximumAge : 15000
      }
    );
  });
  locationPermissionPending = pending;
  pending.finally(()=>{
    if(locationPermissionPending === pending)locationPermissionPending = null;
  });
  return pending;
}

// IMPURE: after a prior grant, quietly resume watching (safe on iOS).
function resumeLocationWatchIfOptedIn(){
  const s = sortSettings || loadSortSettings();
  if(!s.locationOptIn)return;
  if(!window.isSecureContext || !navigator.geolocation)return;
  requestLocationAccess({quiet:true,enableHighAccuracy:false,maximumAge:120000,timeout:15000});
}

// HYBRID: first-time rationale sheet, then request on the Allow tap (keeps
// the user-gesture chain intact for iOS). If already opted in, requests now.
function ensureLocationAccess(opts = {}){
  const s = sortSettings || loadSortSettings();
  if(s.locationOptIn || currentCoord){
    return requestLocationAccess({...opts,quiet:opts.quiet});
  }
  // Show rationale; Allow button calls requestLocationAccess in its click.
  locationAllowCallback = typeof opts.onGranted === 'function' ? opts.onGranted : null;
  openLocationPermissionSheet();
  return Promise.resolve('prompt');
}

function openLocationPermissionSheet(){
  const sheet = $('location-permission-sheet');
  if(!sheet || typeof openSheet !== 'function'){
    // No sheet — fall through to direct prompt (still needs a gesture).
    requestLocationAccess();
    return;
  }
  const copy = $('location-permission-copy');
  if(copy){
    copy.textContent = isStandalonePwa()
      ? 'Tings uses your location to mark where you are and shape today’s plan. Coordinates stay on this device and are never uploaded.'
      : 'Tings uses your location to mark where you are and shape today’s plan. Your browser will ask for permission next. Coordinates stay on this device.';
  }
  openSheet('location-permission-sheet');
}

function closeLocationPermissionSheet(){
  if(typeof closeSheet === 'function')closeSheet('location-permission-sheet');
  locationAllowCallback = null;
}

async function confirmLocationPermissionAllow(){
  // Still inside the Allow tap — call Geolocation immediately.
  const status = await requestLocationAccess({quiet:false});
  const cb = locationAllowCallback;
  closeLocationPermissionSheet();
  if(status === 'granted' && typeof cb === 'function')cb();
  return status;
}

// RENDER: settings row showing location access state + enable button.
function renderLocationAccessControl(){
  const statusEl = $('location-access-status');
  const btn = $('location-access-enable');
  if(!statusEl && !btn)return;
  const s = sortSettings || loadSortSettings();
  let label = 'not enabled';
  if(!window.isSecureContext)label = 'needs HTTPS';
  else if(!navigator.geolocation)label = 'not supported';
  else if(currentCoord)label = 'on · reading location';
  else if(s.locationOptIn)label = 'on · waiting for fix';
  else label = 'off · tap to enable';
  if(statusEl)statusEl.textContent = label;
  if(btn){
    btn.hidden = !window.isSecureContext || !navigator.geolocation;
    btn.textContent = (s.locationOptIn || currentCoord) ? 'refresh location' : 'enable location';
  }
}

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
  const dest = $('travel-edit-dest');
  if(dest){
    const addr = to.address ? escapeHtml(to.address) : '';
    const coords = `${Number(to.lat).toFixed(5)}, ${Number(to.lng).toFixed(5)}`;
    dest.innerHTML = `<div class="travel-dest-name">${escapeHtml(to.name)}</div>${addr ? `<div class="travel-dest-addr">${addr}</div>` : ''}<div class="travel-dest-coords">${escapeHtml(coords)}</div>`;
  }
  const input = $('travel-edit-minutes');
  if(input)input.value = String(mins);
  openSheet('travel-edit-sheet');
}

/** HANDLER: open destination in system maps. */
function openTravelDestinationInMaps(){
  const to = typeof locationById === 'function' ? locationById(travelEditToId) : null;
  if(!to)return;
  const q = to.address
    ? encodeURIComponent(to.address)
    : `${to.lat},${to.lng}`;
  const url = `https://maps.apple.com/?daddr=${q}`;
  window.open(url,'_blank','noopener');
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
}

function openPresencePicker(){
  renderPresencePickerBody();
  openSheet('presence-picker-sheet');
}
