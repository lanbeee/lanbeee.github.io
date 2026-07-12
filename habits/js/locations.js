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
function edgeIsFresh(edge,now = Date.now()){
  return Boolean(edge) && Number.isFinite(edge.fetchedAt) && (now - edge.fetchedAt) < TRAVEL_TTL_MS;
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
async function refreshEdge(locA,locB,mode){
  const m = normalizeTravelMode(mode);
  const result = await fetchEdge(locA,locB,m);
  const [a,b] = locA.id < locB.id ? [locA.id,locB.id] : [locB.id,locA.id];
  const stored = { a, b, seconds:result.seconds, metres:result.metres, provider:result.provider, fetchedAt:Date.now() };
  const s = sortSettings || (sortSettings = {});
  if(!s.travel)s.travel = {};
  s.travel[edgeKey(a,b)] = stored;
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
  if(locA && locB && locA.id && locB.id && locA.id !== locB.id)refreshEdge(locA,locB,m);
  return cached || haversineEdge(locA,locB,m);
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
