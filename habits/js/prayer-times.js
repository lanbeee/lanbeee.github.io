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

// PURE: how two dynamic expressions combine on one endpoint.
//   null      — use the primary expression only (legacy / default)
//   'later'   — max(primary, secondary)  e.g. sleep = later of isha+15 · sunrise−8h
//   'earlier' — min(primary, secondary)
function cleanTimeCombine(value){
  const v = String(value || '').trim().toLowerCase();
  return v === 'later' || v === 'earlier' ? v : null;
}

// PURE: 0 = prayer on the agenda day, 1 = prayer on the next calendar day.
// Lets "sunrise − 8h" mean tonight (next morning's sunrise) rather than last night.
function normalizeAnchorDayOffset(value){
  const n = parseInt(value,10);
  return n === 1 ? 1 : 0;
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

// PURE: true iff any of the four anchor fields on the habit is set (prayer OR
// 'habit'). Used by the save path to enforce "dynamic times require a
// location on the habit" — but only when the anchors are prayer anchors
// (habit anchors don't need a location; the save path gates on this helper
// and then disambiguates with habitUsesHabitAnchors).
function habitUsesPrayerAnchors(h){
  if(!h)return false;
  const fields = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];
  return fields.some(f =>
    cleanPrayerAnchor(h[f + 'Anchor']) || cleanPrayerAnchor(h[f + 'Anchor2'])
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
//
// "Anywhere" habits (empty locationIds) with prayer anchors resolve against
// `contextLocId` — the running agenda anchor (last location before the task) —
// then fall back to the user's last known GPS location, then the first saved
// location. This lets a habit be place-agnostic yet still tie its dynamic
// time to wherever the user actually is in the day's plan.
function habitPrayerLocation(h, settings, contextLocId){
  if(!h)return null;
  const s = settings || sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const registry = normalizeLocationRegistry(s.locations);
  const ids = normalizeLocationIds(h.locationIds, registry);
  if(ids.length){
    const prefId = primaryPreferredLocationId(h.locationPrefs, ids)
      || normalizePreferredLocation(h.preferredLocationId, ids);
    const id = prefId || ids[0];
    return registry.find(l => l.id === id) || null;
  }
  const fbId = cleanLocationId(contextLocId) || cleanLocationId(s.lastKnownLocationId) || null;
  const fb = fbId ? registry.find(l => l.id === fbId) : null;
  return fb || registry[0] || null;
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

// PURE (with sortSettings global): resolve one prayer expression to minutes
// relative to dayBase (may be negative or >1440 when offset crosses midnight).
// `dayOffset` 1 means compute the prayer on the next calendar day — the usual
// way to say "8h before tomorrow's sunrise" for a tonight bedtime.
function resolvePrayerExprMinutes(coords, anchor, offsetMin, dayBase, dayOffset){
  if(!coords || !cleanPrayerAnchor(anchor))return null;
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const date = new Date(base + normalizeAnchorDayOffset(dayOffset) * 86400000);
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const params = prayerParams(settings);
  const times = prayerTimesFor({latitude:coords.latitude, longitude:coords.longitude}, date, params);
  if(!times)return null;
  const ms = anchorMs(times, anchor, offsetMin);
  if(ms == null)return null;
  return Math.round((ms - base) / 60000);
}

// PURE: combine two resolved minutes with 'later' (max) or 'earlier' (min).
// If either side is null, fall back to the other (partial combine still works).
function combineResolvedMinutes(a, b, combine){
  const mode = cleanTimeCombine(combine);
  if(a == null)return b;
  if(b == null)return a;
  if(mode === 'earlier')return Math.min(a, b);
  if(mode === 'later')return Math.max(a, b);
  return a;
}

// IMPURE (reads load/settings): resolve a single expression (primary or
// secondary) for a habit endpoint. `suffix` is '' for primary or '2' for the
// optional second expression used by later/earlier-of. `contextLocId` is the
// running agenda anchor used to resolve "anywhere" habits (see habitPrayerLocation).
function resolveHabitExprMinutes(h, fieldName, suffix, dayBase, contextLocId){
  const anchor = cleanAnchor(h[fieldName + 'Anchor' + suffix]);
  if(!anchor)return null;
  const offset = h[fieldName + 'OffsetMin' + suffix];
  const dayOff = h[fieldName + 'DayOffset' + suffix];
  if(anchor === 'habit'){
    // Habit-relative: dayOffset is ignored (logs are absolute timestamps).
    // Consume rule only applies to the primary start expression.
    const role = (suffix === '' && fieldName.endsWith('Start')) ? 'start' : 'end';
    return resolveHabitAnchorMinutes(
      h,
      h[fieldName + 'AnchorHabitId' + suffix],
      offset,
      role,
      dayBase
    );
  }
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = habitPrayerLocation(h, settings, contextLocId);
  if(!loc)return null;
  return resolvePrayerExprMinutes(
    {latitude:loc.lat, longitude:loc.lng},
    anchor, offset, dayBase, dayOff
  );
}

// PURE (with sortSettings global): resolve a habit time endpoint to a
// minutes-from-midnight value for the given day, or null when nothing is set.
//
// `fieldName` is one of: 'allowedTimeStart' | 'allowedTimeEnd' |
// 'preferredTimeStart' | 'preferredTimeEnd'. The function checks the matching
// `fieldName + 'Anchor'` field first; if an anchor is set (prayer OR 'habit'),
// it computes the resolved minute. When `*Combine` is 'later'/'earlier' and
// `*Anchor2` is set, the secondary expression is folded in (max/min).
// When no anchor is set it falls back to the fixed numeric field.
//
// `dayBase` is a ms day-start timestamp (from dayStart()). Pass null/now to
// mean "today". Result is minutes relative to dayBase (may be <0 or >1440).
//
// `contextLocId` optionally carries the running agenda anchor so "anywhere"
// habits with prayer anchors resolve against the last location before the
// task. Non-agenda callers omit it and get the lastKnown/registry fallback.
function resolveHabitTimeField(h, fieldName, dayBase, contextLocId){
  if(!h)return null;
  const anchor = cleanAnchor(h[fieldName + 'Anchor']);
  if(!anchor){
    // Number(null) === 0, so treat null/'' as unset — otherwise an absent
    // preferred/allowed time silently becomes midnight and week scoring
    // penalises any later placement (e.g. "now" on today) as a preference miss.
    const raw = h[fieldName];
    if(raw == null || raw === '')return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const primary = resolveHabitExprMinutes(h, fieldName, '', dayBase, contextLocId);
  const combine = cleanTimeCombine(h[fieldName + 'Combine']);
  if(!combine || !cleanAnchor(h[fieldName + 'Anchor2']))return primary;
  const secondary = resolveHabitExprMinutes(h, fieldName, '2', dayBase, contextLocId);
  return combineResolvedMinutes(primary, secondary, combine);
}

// PURE: a short, stable label for an anchor+offset, used in card chips and the
// detail header so the user sees "sunrise +30" instead of "6:23am" (which
// would lie the moment the date or location changes). Accepts both prayer
// anchors and 'habit' (which renders as the anchor habit's name).
// `dayOffset` 1 appends " +1d" so "sunrise −8h +1d" reads clearly.
function prayerAnchorLabel(anchor, offsetMin, anchorHabitName, dayOffset){
  const a = cleanAnchor(anchor);
  if(!a)return '';
  const label = a === 'maghrib' ? 'sunset'
    : a === 'habit' ? (anchorHabitName ? `after ${anchorHabitName}` : 'after anchor')
    : a;
  const off = normalizePrayerOffset(offsetMin);
  let out = label;
  if(off !== 0){
    const sign = off > 0 ? '+' : '−';
    const abs = Math.abs(off);
    out = abs % 60 === 0 ? `${label} ${sign}${abs / 60}h` : `${label} ${sign}${abs}m`;
  }
  if(normalizeAnchorDayOffset(dayOffset) === 1 && a !== 'habit')out += ' +1d';
  return out;
}

// PURE: label for a (possibly combined) habit endpoint.
function habitEndpointLabel(h, fieldName){
  if(!h)return '';
  const data = typeof load === 'function' ? load() : [];
  const a1 = cleanAnchor(h[fieldName + 'Anchor']);
  if(!a1)return '';
  const name1 = a1 === 'habit' ? (findHabitByHid(h[fieldName + 'AnchorHabitId'], data) || {}).name : null;
  const primary = prayerAnchorLabel(a1, h[fieldName + 'OffsetMin'], name1, h[fieldName + 'DayOffset']);
  const combine = cleanTimeCombine(h[fieldName + 'Combine']);
  const a2 = cleanAnchor(h[fieldName + 'Anchor2']);
  if(!combine || !a2)return primary;
  const name2 = a2 === 'habit' ? (findHabitByHid(h[fieldName + 'AnchorHabitId2'], data) || {}).name : null;
  const secondary = prayerAnchorLabel(a2, h[fieldName + 'OffsetMin2'], name2, h[fieldName + 'DayOffset2']);
  const word = combine === 'earlier' ? 'earlier of' : 'later of';
  return `${word} ${primary} · ${secondary}`;
}

// PURE: true if the anchor field is set on the habit for this endpoint (i.e.
// the endpoint is in dynamic mode). Used by the renderer to decide which UI
// (fixed input vs anchor picker) to show. Accepts both prayer anchors and
// the 'habit' anchor.
function endpointIsDynamic(h, fieldName){
  return Boolean(cleanAnchor(h && h[fieldName + 'Anchor']));
}

// ── Habit-relative anchors ───────────────────────────────────────────────
// A second anchor kind: "habit". When *Anchor === 'habit', the endpoint
// resolves to the most-recent-log time of another habit (referenced by hid
// via *AnchorHabitId), plus the signed offset, with one rule that prevents
// re-firing: if THIS habit's own lastLog is on/after the anchor habit's
// lastLog, the window collapses — the anchor has already been "consumed".
// Per the user's design: most-recent-today wins; else most-recent-ever; the
// consumed-since check is what keeps a dependent habit from re-triggering
// every render after the anchor log lands.

// PURE: true iff any of the four anchor fields is set to 'habit'. Used by
// the save path to gate cycle detection + the no-location check (habit
// anchors don't need a location, unlike prayer anchors).
function habitUsesHabitAnchors(h){
  if(!h)return false;
  const fields = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];
  return fields.some(f =>
    (h[f + 'Anchor'] === 'habit' && h[f + 'AnchorHabitId'])
    || (h[f + 'Anchor2'] === 'habit' && h[f + 'AnchorHabitId2'])
  );
}

// PURE: cleanPrayerAnchor returns null for 'habit' (it's not in PRAYER_ANCHORS).
// This helper accepts both kinds: returns 'fajr'|'sunrise'|...|'isha' OR 'habit'.
function cleanAnchor(value){
  const prayer = cleanPrayerAnchor(value);
  if(prayer)return prayer;
  return value === 'habit' ? 'habit' : null;
}

// IMPURE (reads load()): find a habit by hid in the current dataset. Returns
// null when missing (deleted anchor target). Used by the resolver.
function findHabitByHid(hid, data){
  const id = cleanHabitId(hid);
  if(!id)return null;
  const arr = data || (typeof load === 'function' ? load() : []);
  return (Array.isArray(arr) ? arr : []).find(h => h && cleanHabitId(h.hid) === id) || null;
}

// PURE: resolve a 'habit' anchor for one endpoint of habit h. Returns minutes-
// from-midnight (0..1440 for today; could be negative / >1440 with offset) or
// null when:
//   • the anchor habit can't be found (deleted)
//   • the anchor habit has never been logged
//   • (start anchor only) h has been logged at/after the anchor habit's last
//     log → the anchor has already fired + been consumed by h, window collapses
// Per the user's design, this rule prevents a dependent habit from being
// perpetually "open" once it has fired in response to the anchor.
//
// `fieldRole` is 'start' or 'end' — only the start anchor consumes; the end
// anchor is a plain closing event.
function resolveHabitAnchorMinutes(h, anchorHabitId, offsetMin, fieldRole, dayBase){
  const data = typeof load === 'function' ? load() : [];
  const anchor = findHabitByHid(anchorHabitId, data);
  if(!anchor)return null;
  const anchorLastLog = anchor.lastLog != null ? anchor.lastLog : latestActualLog(anchor.logs);
  if(anchorLastLog == null)return null; // anchor has never fired
  // "Already consumed" check — only for start anchors.
  if(fieldRole === 'start'){
    const ownLast = h && (h.lastLog != null ? h.lastLog : latestActualLog(h.logs));
    if(ownLast != null && ownLast >= anchorLastLog)return null;
  }
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const anchorDayStart = dayStart(anchorLastLog);
  // Map the anchor log onto today. If it was today → minute-of-day. If from a
  // prior day → 0 (window has been open since midnight; dependent is overdue).
  const minuteOnToday = anchorDayStart === base
    ? Math.round((anchorLastLog - anchorDayStart) / 60000)
    : 0;
  return minuteOnToday + normalizePrayerOffset(offsetMin);
}

// PURE (with sortSettings global + load()): cycle detection across the habit
// dataset. Returns the first cycle found as a list of habit names (for the
// toast), or null when the proposed patch doesn't create a cycle.
//
// A cycle is: starting from `subjectHid`, follow start-anchor pointers
// (habit-anchors only); if we revisit a hid we've already walked, it's a
// cycle. End/preferred anchors don't enter the start chain — they only close
// windows, they don't "open" anything, so a cycle through them can't
// deadlock the agenda. (We still walk them defensively to surface genuinely
// degenerate loops like A.start→B.start.)
function detectHabitAnchorCycle(subjectHid, proposedPatches){
  // proposedPatches: { [hid]: habitObject } — overrides for in-flight edits.
  const data = typeof load === 'function' ? load() : [];
  const patches = proposedPatches || {};
  const hidOf = cleanHabitId(subjectHid);
  if(!hidOf)return null;
  const visited = [];
  let currentHid = hidOf;
  let guard = 0;
  while(currentHid && guard < 64){
    guard += 1;
    const h = patches[currentHid] || findHabitByHid(currentHid, data);
    if(!h)break;
    // Only follow start-anchor edges that are actually in habit mode.
    if(h.allowedTimeStartAnchor !== 'habit')break;
    const nextId = cleanHabitId(h.allowedTimeStartAnchorHabitId);
    if(!nextId)break;
    if(nextId === hidOf){
      // Cycle closes back to the subject — return name chain for the toast.
      return [...visited.map(v => v.name), h.name || 'this', (patches[nextId] || findHabitByHid(nextId, data) || {}).name || 'this'];
    }
    if(visited.some(v => v.hid === nextId))return [...visited.map(v => v.name), h.name || '?'];
    visited.push({hid:currentHid, name:h.name || '?'});
    currentHid = nextId;
  }
  return null;
}

// ── Blocked-time anchors ─────────────────────────────────────────────────
// Blocked times live on Settings (recurring schedule blocks). They support
// prayer anchors only — habit-anchors are a habit-only concept. The block's
// own locationId provides the coords. When the anchor is set but the block
// has no locationId, normalize strips the anchor (defensive).

// PURE: fold dayBase-relative start/end (may be negative or >1440 from
// offsets / +1d) into a same-day overnight encoding the agenda already
// understands: both in roughly [0,1440), with end <= start meaning wrap.
//
// Examples:
//   sunrise−8h → sunrise     (−138, 342)  → (1302, 342) overnight
//   later-of … → sunrise+1d  (1332, 1782) → (1332, 342) overnight
//   10am → noon              (600, 720)   → (600, 720) same-day
function foldBlockedMinutes(startMin, endMin){
  const s0 = Number(startMin);
  const e0 = Number(endMin);
  if(!Number.isFinite(s0) || !Number.isFinite(e0))return {startMin:s0, endMin:e0};
  const dur = e0 - s0;
  if(dur > 0 && dur < 1440){
    if(s0 < 0 && e0 <= 1440)return {startMin:s0 + 1440, endMin:e0};
    if(s0 >= 0 && e0 > 1440)return {startMin:s0, endMin:e0 - 1440};
    if(s0 >= 0 && e0 <= 1440)return {startMin:s0, endMin:e0};
  }
  // Degenerate / multi-day: clock-wrap each side independently.
  const wrap = m => ((m % 1440) + 1440) % 1440;
  return {startMin:wrap(s0), endMin:wrap(e0)};
}

// PURE (with sortSettings global): resolve a blocked time endpoint to minutes-
// relative to dayBase for the given day, or null when the block has no anchor.
// Supports the same later/earlier-of combine + +1d dayOffset as habits
// (prayer anchors only — no habit-relative option on blocked times).
// Callers that need overnight agenda segments should run the pair through
// foldBlockedMinutes() so negative / >1440 values become a wrap encoding.
function resolveBlockedTimeMinutes(block, fieldName, dayBase){
  if(!block)return null;
  const anchor = cleanPrayerAnchor(block[fieldName + 'Anchor']);
  if(!anchor){
    const n = Number(block[fieldName]);
    return Number.isFinite(n) ? n : null;
  }
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const registry = normalizeLocationRegistry(settings.locations);
  const loc = block.locationId ? (registry.find(l => l.id === block.locationId) || null) : null;
  if(!loc)return null;
  const coords = {latitude:loc.lat, longitude:loc.lng};
  const primary = resolvePrayerExprMinutes(
    coords, anchor, block[fieldName + 'OffsetMin'], dayBase, block[fieldName + 'DayOffset']
  );
  const combine = cleanTimeCombine(block[fieldName + 'Combine']);
  const anchor2 = cleanPrayerAnchor(block[fieldName + 'Anchor2']);
  if(!combine || !anchor2)return primary;
  const secondary = resolvePrayerExprMinutes(
    coords, anchor2, block[fieldName + 'OffsetMin2'], dayBase, block[fieldName + 'DayOffset2']
  );
  return combineResolvedMinutes(primary, secondary, combine);
}
