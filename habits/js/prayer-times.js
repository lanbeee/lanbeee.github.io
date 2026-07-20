// Prayer-time dynamic anchors for habit time windows.
//
// Lets a habit's allowed/preferred time endpoint be tied to a prayer time
// (Fajr / Sunrise / Dhuhr / Asr / Maghrib / Isha) for the habit's location,
// with a signed minute offset (e.g. sunrise +30, maghrib -15).
//
// The resolver is a pure function of {coords, date, method, madhab}; we cache
// PrayerTimes objects per {lat,lng,dateKey,method,madhab} so a single day's
// many reads (every hasTimeWindow / fillTimeWindow / windowStillDoableToday
// call across every visible habit) cost exactly one adhan computation.
//
// Loaded after data.js (consumes normalizeLocationRegistry / cleanLocationId)
// and before today-view.js / detail-view.js. Reads the global `sortSettings`
// the same way locations.js and reminders.js do — the resolver helpers stay
// PURE-with-globals, matching the existing convention.
//
// Annotated for the React Native port (R6): PURE/IMPURE tags below.

// PURE: validate a prayer anchor key against the known set. 'sunset' is
// accepted as an alias for 'maghrib' so the UI can label it either way.
function cleanPrayerAnchor(value){
  const v = String(value || '').trim().toLowerCase();
  if(v === 'sunset')return 'maghrib';
  return PRAYER_ANCHORS.includes(v) ? v : null;
}

// PURE: signed-minute offset, clamped to ±PRAYER_OFFSET_MAX_MIN. Empty/invalid → 0.
function normalizePrayerOffset(value){
  const n = parseInt(value,10);
  if(!Number.isFinite(n))return 0;
  return Math.max(-PRAYER_OFFSET_MAX_MIN, Math.min(PRAYER_OFFSET_MAX_MIN, n));
}

// PURE: validate the method key; falls back to DEFAULT_PRAYER_METHOD.
function normalizePrayerMethod(value){
  const v = String(value || '').trim();
  return PRAYER_METHODS.some(m => m.key === v) ? v : DEFAULT_PRAYER_METHOD;
}

// PURE: validate the madhab key; falls back to DEFAULT_PRAYER_MADHAB.
function normalizePrayerMadhab(value){
  return value === 'hanafi' ? 'hanafi' : DEFAULT_PRAYER_MADHAB;
}

// PURE: true iff any of the four anchor fields on the habit is set. Used by
// the save path to enforce "dynamic times require a location on the habit."
function habitUsesPrayerAnchors(h){
  if(!h)return false;
  return Boolean(
    cleanPrayerAnchor(h.allowedTimeStartAnchor)
    || cleanPrayerAnchor(h.allowedTimeEndAnchor)
    || cleanPrayerAnchor(h.preferredTimeStartAnchor)
    || cleanPrayerAnchor(h.preferredTimeEndAnchor)
  );
}

// PURE: build the adhan.CalculationMethod params object from settings. Each
// method has its own factory on adhan.CalculationMethod; Madhab is applied
// after construction. Returns null when adhan isn't loaded (the resolver
// then degrades gracefully — fixed minutes still work).
function prayerParams(settings){
  if(typeof adhan === 'undefined')return null;
  const s = settings || sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const methodKey = normalizePrayerMethod(s.prayerMethod);
  const factory = adhan.CalculationMethod && adhan.CalculationMethod[methodKey];
  if(typeof factory !== 'function')return null;
  const params = factory();
  if(adhan.Madhab && (normalizePrayerMadhab(s.prayerMadhab) === 'hanafi')){
    params.madhab = adhan.Madhab.Hanafi;
  }else if(adhan.Madhab){
    params.madhab = adhan.Madhab.Shafi;
  }
  return params;
}

// PURE: the Location to use for prayer-time calculation on this habit.
// Per the spec: the user said the location tied to the habit must be there
// and the first allowed/preferred location should be used. Resolution order:
//   1. habit's preferred (high/little/legacy) location, if it's still allowed
//   2. first entry in habit.locationIds
//   3. null — caller decides (save path blocks; reader treats anchor as unset)
function habitPrayerLocation(h, settings){
  if(!h)return null;
  const s = settings || sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const registry = normalizeLocationRegistry(s.locations);
  const ids = normalizeLocationIds(h.locationIds, registry);
  if(!ids.length)return null;
  const prefId = primaryPreferredLocationId(h.locationPrefs, ids)
    || normalizePreferredLocation(h.preferredLocationId, ids);
  const id = prefId || ids[0];
  return registry.find(l => l.id === id) || null;
}

// ── PrayerTimes cache ───────────────────────────────────────────────────
// One adhan.PrayerTimes per {lat,lng,dateKey,method,madhab} per page lifetime.
// A day's worth of habit reads is dozens of hasTimeWindow/fillTimeWindow
// calls; without this each one would recompute sun position. The cache is
// tiny (one entry per active day — usually 1, at most ~3 around midnight).
let _prayerCache = new Map();  // key → {times, method, madhab}

// IMPURE: cache read/put. `date` is a Date for the day to resolve (time-of-day
// ignored — adhan.PrayerTimes takes a date and computes for that calendar day).
// Returns the adhan.PrayerTimes instance, or null if adhan is missing / coords
// are invalid.
function prayerTimesFor(coords, date, params){
  if(typeof adhan === 'undefined' || !adhan.Coordinates || !adhan.PrayerTimes)return null;
  if(!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude))return null;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dateKey = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`;
  const methodKey = params && params.method ? String(params.method) : '?';
  const madhabKey = params && params.madhab ? String(params.madhab) : '?';
  const cacheKey = `${coords.latitude.toFixed(4)},${coords.longitude.toFixed(4)}|${dateKey}|${methodKey}|${madhabKey}`;
  const cached = _prayerCache.get(cacheKey);
  if(cached)return cached.times;
  let times;
  try{
    const c = new adhan.Coordinates(coords.latitude, coords.longitude);
    times = new adhan.PrayerTimes(c, day, params);
  }catch(_){
    times = null;
  }
  _prayerCache.set(cacheKey, {times, method:methodKey, madhab:madhabKey});
  // Bound the cache so a long-lived session crossing many days (or a user
  // flipping through the calendar) can't grow it unbounded.
  if(_prayerCache.size > 64)_prayerCache.delete(_prayerCache.keys().next().value);
  return times;
}

// IMPURE (cache reset): drop everything. Called when settings (method/madhab)
// change or when a registry edit moves a location's pin — both invalidate
// every cached computation.
function clearPrayerTimesCache(){
  _prayerCache.clear();
}

// PURE: resolve an anchor + offset to milliseconds-since-midnight for a given
// PrayerTimes instance. Returns null when the anchor is unknown or adhan
// failed. Result is unbounded: an offset can push the moment past 24h or
// below 0, and callers handle wrap (overnight) at their layer.
function anchorMs(times, anchor, offsetMin){
  if(!times || !cleanPrayerAnchor(anchor))return null;
  const a = cleanPrayerAnchor(anchor);
  const t = a === 'fajr' ? times.fajr
    : a === 'sunrise' ? times.sunrise
    : a === 'dhuhr' ? times.dhuhr
    : a === 'asr' ? times.asr
    : a === 'maghrib' ? times.maghrib
    : a === 'isha' ? times.isha
    : null;
  if(!(t instanceof Date) || !Number.isFinite(t.getTime()))return null;
  return t.getTime() + normalizePrayerOffset(offsetMin) * 60000;
}

// PURE (with sortSettings global): resolve a habit time endpoint to a
// minutes-from-midnight value for the given day, or null when nothing is set.
//
// `fieldName` is one of: 'allowedTimeStart' | 'allowedTimeEnd' |
// 'preferredTimeStart' | 'preferredTimeEnd'. The function checks the matching
// `fieldName + 'Anchor'` field first; if an anchor is set, it computes the
// prayer time + offset for the habit's resolved location on that day. When no
// anchor is set it falls back to the fixed numeric field — preserving the
// existing behaviour byte-for-byte for habits that don't use dynamic times.
//
// `dayBase` is a ms day-start timestamp (from dayStart()). Pass null/now to
// mean "today".
function resolveHabitTimeField(h, fieldName, dayBase){
  if(!h)return null;
  const anchor = cleanPrayerAnchor(h[fieldName + 'Anchor']);
  if(!anchor){
    const n = Number(h[fieldName]);
    return Number.isFinite(n) ? n : null;
  }
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const date = new Date(base);
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = habitPrayerLocation(h, settings);
  if(!loc)return null; // no usable location → treat as unset (save path blocks)
  const params = prayerParams(settings);
  const times = prayerTimesFor({latitude:loc.lat, longitude:loc.lng}, date, params);
  if(!times)return null;
  const ms = anchorMs(times, anchor, h[fieldName + 'OffsetMin']);
  if(ms == null)return null;
  // Convert absolute ms → minutes-from-midnight for this day, preserving
  // out-of-range values so overnight wrap (e.g. isha + 90 can land after
  // midnight) composes correctly with the existing window math.
  const midnight = new Date(ms);
  const midnightBase = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate()).getTime();
  return Math.round((ms - midnightBase) / 60000);
}

// PURE: a short, stable label for an anchor+offset, used in card chips and the
// detail header so the user sees "sunrise +30" instead of "6:23am" (which
// would lie the moment the date or location changes).
function prayerAnchorLabel(anchor, offsetMin){
  const a = cleanPrayerAnchor(anchor);
  if(!a)return '';
  const label = a === 'maghrib' ? 'sunset' : a;
  const off = normalizePrayerOffset(offsetMin);
  if(off === 0)return label;
  const sign = off > 0 ? '+' : '−';
  const abs = Math.abs(off);
  if(abs % 60 === 0)return `${label} ${sign}${abs / 60}h`;
  return `${label} ${sign}${abs}m`;
}

// PURE: true if the anchor field is set on the habit for this endpoint (i.e.
// the endpoint is in dynamic mode). Used by the renderer to decide which UI
// (fixed input vs anchor picker) to show.
function endpointIsDynamic(h, fieldName){
  return Boolean(cleanPrayerAnchor(h && h[fieldName + 'Anchor']));
}
