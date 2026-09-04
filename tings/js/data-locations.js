// ─────────────────────────────────────────────────────────────────────────
// LOCATIONS — PURE. Registry validation, the layered hours model, and the
// habit∩location window composition. No I/O; these port verbatim to RN.
// ─────────────────────────────────────────────────────────────────────────

// PURE: trim + cap a location id. Empty string when falsy.
function cleanLocationId(value){
  return String(value || '').trim().slice(0,64);
}
// PURE: trim + cap a stable habit id. Empty string when falsy.
function cleanHabitId(value){
  return String(value || '').trim().slice(0,64);
}

// PURE: normalize one persistent Schedule relationship.
function normalizeScheduleLink(value,subjectHid,fallbackDirection = null){
  if(!value || typeof value !== 'object')return null;
  const anchorHid = cleanHabitId(value.anchorHid);
  if(!anchorHid || anchorHid === cleanHabitId(subjectHid))return null;
  const direction = value.direction === 'before' || value.direction === 'after'
    ? value.direction
    : (fallbackDirection === 'before' || fallbackDirection === 'after' ? fallbackDirection : null);
  if(!direction)return null;
  return {
    anchorHid,
    direction,
    adjacency:value.adjacency === 'direct' ? 'direct' : 'sometime',
    requireSameDay:Boolean(value.requireSameDay)
  };
}

// PURE: coerce legacy {before,after} object or modern array into ScheduleLink[].
function coerceScheduleLinksSource(value){
  if(Array.isArray(value))return value;
  if(value && typeof value === 'object'){
    // Modern accidental shape: {links:[...]}
    if(Array.isArray(value.links))return value.links;
    const out = [];
    if(value.after)out.push({...value.after,direction:value.after.direction || 'after'});
    if(value.before)out.push({...value.before,direction:value.before.direction || 'before'});
    return out;
  }
  return [];
}

// PURE: normalize the recurring relationship list and conservatively
// migrate old zero-offset, standalone "start after habit" expressions.
function normalizeScheduleLinksWithMigration(raw,subjectHid){
  const source = coerceScheduleLinksSource(raw && raw.scheduleLinks);
  const links = [];
  const seen = new Set();
  for(const entry of source){
    const link = normalizeScheduleLink(entry,subjectHid,entry && entry.direction);
    if(!link)continue;
    const key = `${link.direction}:${link.anchorHid}`;
    if(seen.has(key))continue;
    seen.add(key);
    links.push(link);
  }
  const migratedFields = [];
  const hasAfter = links.some(l=>l.direction === 'after');
  if(!hasAfter){
    for(const field of ['allowedTimeStart','preferredTimeStart']){
      const anchorHid = cleanHabitId(raw && raw[field + 'AnchorHabitId']);
      const cleanStandalone = raw && raw[field + 'Anchor'] === 'habit'
        && normalizePrayerOffset(raw[field + 'OffsetMin']) === 0
        && !cleanTimeCombine(raw[field + 'Combine'])
        && !cleanAnchor(raw[field + 'Anchor2'])
        && anchorHid && anchorHid !== cleanHabitId(subjectHid);
      if(!cleanStandalone)continue;
      links.push({anchorHid,direction:'after',adjacency:'sometime',requireSameDay:false});
      migratedFields.push(field);
      break;
    }
  }
  const afterLink = links.find(l=>l.direction === 'after');
  // If allowed + preferred carried the same clean link, clear both copies.
  if(afterLink){
    for(const field of ['allowedTimeStart','preferredTimeStart']){
      const same = raw && raw[field + 'Anchor'] === 'habit'
        && cleanHabitId(raw[field + 'AnchorHabitId']) === afterLink.anchorHid
        && normalizePrayerOffset(raw[field + 'OffsetMin']) === 0
        && !cleanTimeCombine(raw[field + 'Combine'])
        && !cleanAnchor(raw[field + 'Anchor2']);
      if(same && !migratedFields.includes(field))migratedFields.push(field);
    }
  }
  return {links,migratedFields};
}

function normalizeScheduleLinks(value,subjectHid){
  const source = coerceScheduleLinksSource(value);
  const links = [];
  const seen = new Set();
  for(const entry of source){
    const fallback = entry && (entry.direction === 'before' || entry.direction === 'after')
      ? entry.direction : null;
    const link = normalizeScheduleLink(entry,subjectHid,fallback);
    if(!link)continue;
    const key = `${link.direction}:${link.anchorHid}`;
    if(seen.has(key))continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

/** PURE: same-day links on a subject (OR partners for pull/gating). */
function sameDayScheduleLinks(hOrLinks,subjectHid = null){
  const links = Array.isArray(hOrLinks)
    ? normalizeScheduleLinks(hOrLinks,subjectHid)
    : normalizeScheduleLinks(hOrLinks && hOrLinks.scheduleLinks,subjectHid || (hOrLinks && hOrLinks.hid));
  return links.filter(link=>link && link.requireSameDay);
}

// PURE: coerce the later/earlier-of + dayOffset fields for one habit endpoint
// prefix (e.g. 'allowedTimeStart'). Secondary fields only stick when Combine
// is set and Anchor2 is a real anchor (prayer, habit, or fixed clock); otherwise
// they're cleared so stale secondaries don't linger after the user picks "just this".
function normalizeCombineFields(raw, prefix){
  const cleanA = typeof cleanAnchor === 'function' ? cleanAnchor : cleanPrayerAnchor;
  const combine = typeof cleanTimeCombine === 'function' ? cleanTimeCombine(raw[prefix + 'Combine']) : null;
  const anchor2 = combine ? cleanA(raw[prefix + 'Anchor2']) : null;
  const dayOff = typeof normalizeAnchorDayOffset === 'function'
    ? normalizeAnchorDayOffset(raw[prefix + 'DayOffset']) : 0;
  const dayOff2 = (anchor2 && anchor2 !== 'fixed' && typeof normalizeAnchorDayOffset === 'function')
    ? normalizeAnchorDayOffset(raw[prefix + 'DayOffset2']) : 0;
  const fixedMin2 = anchor2 === 'fixed'
    ? (normalizeTimeMinutes(raw[prefix + 'FixedMin2']) ?? 1200)
    : null;
  return {
    [prefix + 'Combine']: combine && anchor2 ? combine : null,
    [prefix + 'Anchor2']: anchor2,
    [prefix + 'OffsetMin2']: anchor2 && anchor2 !== 'fixed'
      ? normalizePrayerOffset(raw[prefix + 'OffsetMin2']) : 0,
    [prefix + 'AnchorHabitId2']: (anchor2 === 'habit' ? cleanHabitId(raw[prefix + 'AnchorHabitId2']) : '') || null,
    [prefix + 'FixedMin2']: fixedMin2,
    [prefix + 'DayOffset']: dayOff,
    [prefix + 'DayOffset2']: dayOff2
  };
}
// IMPURE (reads crypto + Date): mint a fresh habit id. Mirrors the location-id
// pattern in settings.js — crypto.randomUUID when available, temporal fallback
// otherwise. The fallback is unique enough for personal use; the cost of a
// collision would be a habit anchor silently pointing at the wrong habit.
function generateHabitId(){
  if(typeof crypto !== 'undefined' && crypto.randomUUID)return crypto.randomUUID();
  return `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}
// PURE: coerce raw locationIds into a de-duped array. When `registry` is
// provided, ids absent from it are dropped (the dangling-id sweep); when it is
// omitted (as during normalize(), before settings have loaded), only de-dupe
// runs and reconcileLocations() finishes the job at startup.
function normalizeLocationIds(value,registry){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const valid = Array.isArray(registry) ? new Set(registry.map(l=>l && l.id).filter(Boolean)) : null;
  const seen = new Set();
  return items.map(id=>cleanLocationId(id)).filter(id=>{
    if(!id || seen.has(id))return false;
    if(valid && !valid.has(id))return false;
    seen.add(id);
    return true;
  });
}

const MAX_HABIT_SCHEDULE_OPTIONS = 32;

function cleanLocationPrefLevel(value){
  return LOCATION_PREF_LEVELS.includes(value) ? value : null;
}

function habitSimpleAllowedDays(h){
  return {
    weekdays:normalizeAllowedWeekdays(h && h.allowedWeekdays),
    monthDays:normalizeAllowedMonthDays(h && h.allowedMonthDays)
  };
}

function hasSimpleAllowedDays(h){
  const schedule = habitSimpleAllowedDays(h);
  return Boolean(schedule.weekdays.length || schedule.monthDays.length);
}

function hasSimpleAllowedTimeWindow(h){
  if(!h)return false;
  const startSet = Number.isFinite(h.allowedTimeStart)
    || (typeof cleanAnchor === 'function' && cleanAnchor(h.allowedTimeStartAnchor));
  const endSet = Number.isFinite(h.allowedTimeEnd)
    || (typeof cleanAnchor === 'function' && cleanAnchor(h.allowedTimeEndAnchor));
  return Boolean(startSet && endSet);
}

const HABIT_SCHEDULE_OPTION_TIME_SUFFIXES = [
  'Anchor','OffsetMin','Combine','Anchor2','OffsetMin2','FixedMin2','DayOffset','DayOffset2'
];

// PURE: normalize one endpoint on a specific time/place row. Primary dynamic
// values are prayer anchors; the optional second expression may also be a
// fixed clock. Completion-relative habit anchors belong to the recurring
// order editor and are intentionally not introduced by these rows.
function normalizeHabitScheduleOptionEndpoint(raw,prefix){
  const anchor = typeof cleanPrayerAnchor === 'function'
    ? cleanPrayerAnchor(raw && raw[prefix + 'Anchor']) : null;
  if(!anchor){
    const fixed = normalizeTimeMinutes(raw && raw[prefix]);
    return fixed == null ? null : {[prefix]:fixed};
  }
  const combine = typeof cleanTimeCombine === 'function'
    ? cleanTimeCombine(raw && raw[prefix + 'Combine']) : null;
  const anchor2 = combine
    ? (raw && raw[prefix + 'Anchor2'] === 'fixed'
      ? 'fixed'
      : (typeof cleanPrayerAnchor === 'function'
        ? cleanPrayerAnchor(raw && raw[prefix + 'Anchor2']) : null))
    : null;
  const out = {
    [prefix]:null,
    [prefix + 'Anchor']:anchor,
    [prefix + 'OffsetMin']:normalizePrayerOffset(raw && raw[prefix + 'OffsetMin']),
    [prefix + 'DayOffset']:typeof normalizeAnchorDayOffset === 'function'
      ? normalizeAnchorDayOffset(raw && raw[prefix + 'DayOffset']) : 0
  };
  if(combine && anchor2){
    out[prefix + 'Combine'] = combine;
    out[prefix + 'Anchor2'] = anchor2;
    out[prefix + 'OffsetMin2'] = anchor2 === 'fixed'
      ? 0 : normalizePrayerOffset(raw && raw[prefix + 'OffsetMin2']);
    out[prefix + 'FixedMin2'] = anchor2 === 'fixed'
      ? (normalizeTimeMinutes(raw && raw[prefix + 'FixedMin2']) ?? 1200) : null;
    out[prefix + 'DayOffset2'] = anchor2 === 'fixed'
      ? 0
      : (typeof normalizeAnchorDayOffset === 'function'
        ? normalizeAnchorDayOffset(raw && raw[prefix + 'DayOffset2']) : 0);
  }
  return out;
}

function habitScheduleOptionEndpointIsDynamic(option,prefix){
  return Boolean(option && typeof cleanPrayerAnchor === 'function'
    && cleanPrayerAnchor(option[prefix + 'Anchor']));
}

// PURE: stable expression identity used to de-duplicate exact rows while
// still allowing one place to appear at several fixed or dynamic times.
function habitScheduleOptionTimeKey(option,prefix){
  if(!habitScheduleOptionEndpointIsDynamic(option,prefix))return String(option[prefix]);
  return HABIT_SCHEDULE_OPTION_TIME_SUFFIXES
    .map(suffix=>String(option[prefix + suffix] ?? ''))
    .join(':');
}

// PURE: one specific weekday/time/place window. These extend the general
// allowed schedule rather than replacing it. Multiple rows may use the same
// location at different times. Empty weekdays means every day; null
// locationId means an anywhere option. Optional `pref` overrides the place
// ranking for that instance only.
function normalizeHabitScheduleOptions(value,registry){
  if(!Array.isArray(value))return [];
  const valid = Array.isArray(registry)
    ? new Set(normalizeLocationRegistry(registry).map(loc=>loc.id))
    : null;
  const out = [];
  const seen = new Set();
  for(const raw of value){
    if(!raw || typeof raw !== 'object')continue;
    const startFields = normalizeHabitScheduleOptionEndpoint(raw,'start');
    const endFields = normalizeHabitScheduleOptionEndpoint(raw,'end');
    if(!startFields || !endFields)continue;
    const cleanedLocationId = cleanLocationId(raw.locationId);
    const locationId = cleanedLocationId || null;
    if(locationId && valid && !valid.has(locationId))continue;
    const weekdays = normalizeAllowedWeekdays(raw.weekdays);
    const pref = cleanLocationPrefLevel(raw.pref);
    const option = {weekdays,...startFields,...endFields,locationId};
    const key = `${weekdays.join(',')}|${habitScheduleOptionTimeKey(option,'start')}|${habitScheduleOptionTimeKey(option,'end')}|${locationId || ''}`;
    if(seen.has(key))continue;
    seen.add(key);
    out.push(pref ? {...option,pref} : option);
    if(out.length >= MAX_HABIT_SCHEDULE_OPTIONS)break;
  }
  return out;
}

function hasHabitScheduleOptions(h){
  return Boolean(h && Array.isArray(h.scheduleOptions) && h.scheduleOptions.length);
}

// PURE: places named by option rows. Cards/search/prayer still union this
// with the general locationIds; the planner treats option places as valid
// only inside their own windows.
function habitScheduleOptionLocationState(value,registry){
  const options = normalizeHabitScheduleOptions(value,registry);
  return {
    options,
    locationIds:normalizeLocationIds(options.map(option=>option.locationId).filter(Boolean),registry),
    anywhereAllowed:options.some(option=>option.locationId === null)
  };
}

function habitPrefLocationIds(h,registry){
  const optionState = habitScheduleOptionLocationState(h && h.scheduleOptions,registry);
  return normalizeLocationIds([
    ...normalizeLocationIds(h && h.locationIds,registry),
    ...optionState.locationIds
  ],registry);
}

function habitDisplayLocationIds(h,registry){
  return habitPrefLocationIds(h,registry);
}

function habitDisplayAnywhereAllowed(h,registry){
  const optionState = habitScheduleOptionLocationState(h && h.scheduleOptions,registry);
  return Boolean(h && h.anywhereAllowed) || optionState.anywhereAllowed;
}

// PURE: the general allowed time/days/places still apply when options exist,
// unless the stored places are only the derived summary from an older
// options-only habit (no explicit general time or extra places).
function hasGeneralAllowedSchedule(h,registry){
  if(!h)return false;
  if(!hasHabitScheduleOptions(h))return true;
  if(hasSimpleAllowedTimeWindow(h) || hasSimpleAllowedDays(h))return true;
  const optionState = habitScheduleOptionLocationState(h.scheduleOptions,registry);
  const generalIds = normalizeLocationIds(h.locationIds,registry);
  const optionIds = new Set(optionState.locationIds);
  if(generalIds.some(id=>!optionIds.has(id)))return true;
  return Boolean(h.anywhereAllowed) && generalIds.length > 0 && !optionState.anywhereAllowed;
}

function isDateEligibleForGeneralSchedule(h,ts = Date.now()){
  if(!hasGeneralAllowedSchedule(h))return false;
  const schedule = habitSimpleAllowedDays(h);
  const d = new Date(ts);
  if(schedule.weekdays.length && !schedule.weekdays.includes(d.getDay()))return false;
  if(schedule.monthDays.length && !schedule.monthDays.includes(d.getDate()))return false;
  return true;
}

// PURE: project a row's start/end expression into the ordinary allowed-time
// field names so every existing planner primitive can resolve it unchanged.
function habitScheduleOptionAllowedTimeFields(option){
  const out = {};
  for(const [source,target] of [['start','allowedTimeStart'],['end','allowedTimeEnd']]){
    out[target] = option && option[source] != null ? option[source] : null;
    out[target + 'Anchor'] = habitScheduleOptionEndpointIsDynamic(option,source)
      ? cleanPrayerAnchor(option[source + 'Anchor']) : null;
    out[target + 'OffsetMin'] = out[target + 'Anchor']
      ? normalizePrayerOffset(option[source + 'OffsetMin']) : 0;
    const combine = out[target + 'Anchor'] && typeof cleanTimeCombine === 'function'
      ? cleanTimeCombine(option[source + 'Combine']) : null;
    const anchor2 = combine
      ? (option[source + 'Anchor2'] === 'fixed'
        ? 'fixed' : cleanPrayerAnchor(option[source + 'Anchor2']))
      : null;
    out[target + 'Combine'] = combine && anchor2 ? combine : null;
    out[target + 'Anchor2'] = anchor2;
    out[target + 'OffsetMin2'] = anchor2 && anchor2 !== 'fixed'
      ? normalizePrayerOffset(option[source + 'OffsetMin2']) : 0;
    out[target + 'AnchorHabitId'] = null;
    out[target + 'AnchorHabitId2'] = null;
    out[target + 'FixedMin2'] = anchor2 === 'fixed'
      ? (normalizeTimeMinutes(option[source + 'FixedMin2']) ?? 1200) : null;
    out[target + 'DayOffset'] = out[target + 'Anchor']
      ? normalizeAnchorDayOffset(option[source + 'DayOffset']) : 0;
    out[target + 'DayOffset2'] = anchor2 && anchor2 !== 'fixed'
      ? normalizeAnchorDayOffset(option[source + 'DayOffset2']) : 0;
  }
  return out;
}

function habitBoundToGeneralSchedule(h){
  return {...(h || {}),scheduleOptions:[]};
}

function habitBoundToScheduleOption(h,option){
  const normalized = normalizeHabitScheduleOptions([option])[0];
  if(!normalized)return habitBoundToGeneralSchedule(h);
  const pref = cleanLocationPrefLevel(normalized.pref);
  const locationId = normalized.locationId;
  const locationPrefs = {...((h && h.locationPrefs) || {})};
  if(pref && locationId)locationPrefs[locationId] = pref;
  return {
    ...(h || {}),
    ...habitScheduleOptionAllowedTimeFields(normalized),
    scheduleOptions:[],
    allowedWeekdays:normalized.weekdays,
    allowedMonthDays:[],
    locationIds:locationId ? [locationId] : [],
    anywhereAllowed:locationId == null,
    locationPrefs,
    _scheduleOptionPref:pref,
    preferredLocationId:pref === 'high' && locationId
      ? locationId
      : (h && h.preferredLocationId) || null
  };
}

function habitSchedulePlacementVariants(fill,dayBase,registry){
  const h = fill && fill.h;
  if(!h || fill._scheduleOptionBound || !hasHabitScheduleOptions(h))return null;
  const variants = [];
  if(hasGeneralAllowedSchedule(h,registry) && isDateEligibleForGeneralSchedule(h,dayBase)){
    const generalFill = {
      ...fill,
      h:habitBoundToGeneralSchedule(h),
      _scheduleOptionBound:true
    };
    if(!(Object.prototype.hasOwnProperty.call(fill,'locationId') && fill.locationId !== undefined)){
      delete generalFill.locationId;
    }
    variants.push(generalFill);
  }
  const hasLocationProperty = Object.prototype.hasOwnProperty.call(fill,'locationId');
  const explicitLocation = hasLocationProperty && fill.locationId !== undefined
    ? fill.locationId : undefined;
  for(const option of habitScheduleOptionsForDay(h,dayBase,explicitLocation)){
    variants.push({
      ...fill,
      h:habitBoundToScheduleOption(h,option),
      locationId:option.locationId,
      _scheduleOptionBound:true
    });
  }
  return variants;
}

// PURE: specific rows that apply on this calendar day.
function habitScheduleOptionsForDay(h,dayBase,locationId = undefined){
  const options = normalizeHabitScheduleOptions(h && h.scheduleOptions);
  if(!options.length)return [];
  const weekday = new Date(dayBase).getDay();
  return options.filter(option=>{
    if(option.weekdays.length && !option.weekdays.includes(weekday))return false;
    return locationId === undefined || option.locationId === locationId;
  });
}

// PURE: saved places that are real alternatives on this day. Unlike
// h.locationIds this may contain the same location represented by several
// separate clock windows; ids are de-duped only for route enumeration.
function habitLocationIdsForDay(h,dayBase,registry){
  const valid = Array.isArray(registry)
    ? new Set(normalizeLocationRegistry(registry).map(loc=>loc.id))
    : null;
  const seen = new Set();
  const ids = [];
  const add = id=>{
    if(!id || (valid && !valid.has(id)) || seen.has(id))return;
    seen.add(id);
    ids.push(id);
  };
  if(hasGeneralAllowedSchedule(h,registry) && isDateEligibleForGeneralSchedule(h,dayBase)){
    for(const id of normalizeLocationIds(h && h.locationIds,registry))add(id);
  }else if(!hasHabitScheduleOptions(h)){
    return normalizeLocationIds(h && h.locationIds,registry);
  }
  for(const option of habitScheduleOptionsForDay(h,dayBase))add(option.locationId);
  return ids;
}

function habitHasAnywhereScheduleOptionForDay(h,dayBase){
  return hasHabitScheduleOptions(h)
    && habitScheduleOptionsForDay(h,dayBase,null).length > 0;
}

function habitHasAnywhereForDay(h,dayBase,registry){
  if(hasGeneralAllowedSchedule(h,registry) && isDateEligibleForGeneralSchedule(h,dayBase)
    && h && h.anywhereAllowed)return true;
  if(!hasHabitScheduleOptions(h) && h && h.anywhereAllowed)return true;
  return habitHasAnywhereScheduleOptionForDay(h,dayBase);
}
// PURE: null unless `value` is an id present in `ids`.
function normalizePreferredLocation(value,ids){
  const id = cleanLocationId(value);
  if(!id)return null;
  const allowed = Array.isArray(ids) ? ids : [];
  return allowed.includes(id) ? id : null;
}
/** PURE: coerce locationPrefs; migrates legacy preferredLocationId → high. */
function normalizeLocationPrefs(rawPrefs,ids,legacyPreferred){
  const allowed = Array.isArray(ids) ? ids : [];
  const allowedSet = new Set(allowed);
  const out = {};
  if(rawPrefs && typeof rawPrefs === 'object' && !Array.isArray(rawPrefs)){
    for(const [id,level] of Object.entries(rawPrefs)){
      const clean = cleanLocationId(id);
      if(!clean || !allowedSet.has(clean))continue;
      if(LOCATION_PREF_LEVELS.includes(level))out[clean] = level;
    }
  }
  const legacy = normalizePreferredLocation(legacyPreferred,allowed);
  if(legacy && !out[legacy])out[legacy] = 'high';
  return out;
}
/** PURE: preference level for a location id on a habit (null = neutral allowed). */
function locationPrefLevel(h,locationId){
  if(!h)return null;
  const instanceLevel = cleanLocationPrefLevel(h._scheduleOptionPref);
  if(instanceLevel)return instanceLevel;
  const id = cleanLocationId(locationId);
  if(!id)return null;
  const level = h.locationPrefs && h.locationPrefs[id];
  return LOCATION_PREF_LEVELS.includes(level) ? level : null;
}
/** PURE: soft score nudge for a location preference level. */
function locationPrefScore(level){
  return LOCATION_PREF_SCORE[level] || 0;
}
/** PURE: best single preferred id (high > little); null if none. */
function primaryPreferredLocationId(prefs,ids){
  const allowed = Array.isArray(ids) ? ids : [];
  const map = prefs && typeof prefs === 'object' ? prefs : {};
  const high = allowed.find(id=>map[id] === 'high');
  if(high)return high;
  const little = allowed.find(id=>map[id] === 'little');
  return little || null;
}
/** PURE: snap minutes-from-midnight to the time-picker grid (15 min). */
function snapTimeMinutes(value,step = TIME_PICKER_STEP_MINUTES){
  const n = normalizeTimeMinutes(value);
  if(n === null)return null;
  const s = Math.max(1,parseInt(step,10) || TIME_PICKER_STEP_MINUTES);
  return Math.max(0,Math.min(1439,Math.round(n / s) * s));
}
// PURE: weekday list for closedDays. Unlike normalizeAllowedWeekdays this does
// NOT collapse all-7 to [] (a location closed every day is valid, if unusual).
function normalizeClosedDays(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return items.map(day=>parseInt(day,10)).filter(day=>{
    if(!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day))return false;
    seen.add(day);
    return true;
  }).sort((a,b)=>a-b);
}
// PURE: coerce one location's hours fields into canonical shape. A window is
// kept only when both endpoints are finite; otherwise both endpoints null out.
function normalizeLocationHours(raw){
  const r = raw && typeof raw === 'object' ? raw : {};
  let start = normalizeTimeMinutes(r.allowedTimeStart);
  let end = normalizeTimeMinutes(r.allowedTimeEnd);
  if(start === null || end === null){ start = null; end = null; }
  let prefStart = normalizeTimeMinutes(r.preferredTimeStart);
  let prefEnd = normalizeTimeMinutes(r.preferredTimeEnd);
  if(prefStart === null || prefEnd === null){ prefStart = null; prefEnd = null; }
  const closedDays = normalizeClosedDays(r.closedDays);
  const hoursByDay = {};
  if(r.hoursByDay && typeof r.hoursByDay === 'object' && !Array.isArray(r.hoursByDay)){
    for(const key of Object.keys(r.hoursByDay)){
      const day = Number(key);
      if(!Number.isInteger(day) || day < 0 || day > 6)continue;
      const hd = r.hoursByDay[key];
      if(hd === null){ hoursByDay[day] = null; continue; }
      const hs = normalizeTimeMinutes(hd && hd.start);
      const he = normalizeTimeMinutes(hd && hd.end);
      if(hs === null || he === null)continue;       // invalid override -> fall back to default
      hoursByDay[day] = {start:hs,end:he};
    }
  }
  return {allowedTimeStart:start,allowedTimeEnd:end,preferredTimeStart:prefStart,preferredTimeEnd:prefEnd,closedDays,hoursByDay};
}
// PURE: coerce the raw locations array into the canonical registry. Invalid
// entries (no id, no name, bad coords) are dropped; duplicates by id collapse.
function normalizeLocationRegistry(value){
  if(!Array.isArray(value))return [];
  const seen = new Set();
  const out = [];
  for(const raw of value){
    if(!raw || typeof raw !== 'object')continue;
    const id = cleanLocationId(raw.id);
    if(!id || seen.has(id))continue;
    const name = String(raw.name || '').trim().slice(0,48);
    if(!name)continue;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if(!Number.isFinite(lat) || lat < -90 || lat > 90)continue;
    if(!Number.isFinite(lng) || lng < -180 || lng > 180)continue;
    seen.add(id);
    const radius = Number(raw.radiusM);
    const address = String(raw.address || '').trim().slice(0,120);
    const emoji = String(raw.emoji || '').slice(0,4);
    out.push({
      id,
      name,
      address,
      lat:Math.round(lat * 1e6) / 1e6,
      lng:Math.round(lng * 1e6) / 1e6,
      radiusM:Number.isFinite(radius) ? Math.max(10,Math.min(5000,radius)) : DEFAULT_LOCATION_RADIUS_M,
      emoji,
      ...normalizeLocationHours(raw)
    });
  }
  return out.slice(0,MAX_LOCATIONS);
}
// PURE: predictable, human-facing order for every location picker/list.
// Keep the stored registry order untouched: planner fallbacks and references
// are keyed by id, while editing UIs still need their original array index.
function compareLocationNames(a,b){
  return String(a?.name || '').localeCompare(String(b?.name || ''),undefined,{
    sensitivity:'base',numeric:true
  }) || String(a?.id || '').localeCompare(String(b?.id || ''));
}
function locationsForDisplay(value){
  return normalizeLocationRegistry(value).slice().sort(compareLocationNames);
}
// PURE: coerce the cached travel map. Drops edges with bad numbers, stale
// fetchedAt (older than 2× TTL), or malformed keys; re-keys each edge with the
// lexically-ordered pair so A→B and B→A collide. Caps at MAX_TRAVEL_EDGES.
function normalizeTravelCache(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  const cutoff = Date.now() - TRAVEL_TTL_MS * 2;
  const out = {};
  let count = 0;
  for(const key of Object.keys(value)){
    if(count >= MAX_TRAVEL_EDGES)break;
    const edge = value[key];
    if(!edge || typeof edge !== 'object')continue;
    const a = cleanLocationId(edge.a);
    const b = cleanLocationId(edge.b);
    if(!a || !b || a === b)continue;
    const seconds = Number(edge.seconds);
    const metres = Number(edge.metres);
    if(!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(metres) || metres < 0)continue;
    const provider = edge.provider === 'osrm' || edge.provider === 'google' || edge.provider === 'manual'
      ? edge.provider
      : 'haversine';
    let fetchedAt = Number(edge.fetchedAt);
    // Manual overrides never expire; network edges drop after 2× TTL.
    if(provider === 'manual'){
      if(!Number.isFinite(fetchedAt))fetchedAt = Date.now();
    }else if(!Number.isFinite(fetchedAt) || fetchedAt < cutoff){
      continue;
    }
    const [lo,hi] = a < b ? [a,b] : [b,a];
    out[`${lo}|${hi}`] = {a:lo,b:hi,seconds:Math.round(seconds),metres:Math.round(metres),provider,fetchedAt:Math.round(fetchedAt)};
    count += 1;
  }
  return out;
}
// PURE: clamp a travel mode to the known set.
function normalizeTravelMode(value){
  return TRAVEL_MODES.includes(value) ? value : DEFAULT_TRAVEL_MODE;
}
/** PURE: all-day calendar import policy. */
function normalizeCalendarAllDayMode(value){
  return value === 'tasks' ? 'tasks' : 'skip';
}
// PURE: normalize the home blocked/travel presentation mode.
function normalizeHomeExtraMode(value){
  return value === 'cards12h' ? 'cards12h' : 'cards';
}
// PURE: normalize the agenda-time presentation mode on home cards.
function normalizeAgendaTimeMode(value){
  return value === 'icon' ? 'icon' : (value === 'hide' ? 'hide' : 'time');
}
/** PURE: completed-task auto-delete window in days (2 | 3 | 7). */
function normalizeCompletedTaskRetentionDays(value){
  const n = parseInt(value,10);
  return (typeof COMPLETED_TASK_RETENTION_DAYS !== 'undefined' && COMPLETED_TASK_RETENTION_DAYS.includes(n))
    ? n
    : 7;
}
/** PURE: keep newest N actual logs per non-task habit; 0 disables trimming. */
function normalizeHabitLogKeepCount(value){
  const n = parseInt(value,10);
  return (typeof HABIT_LOG_KEEP_COUNTS !== 'undefined' && HABIT_LOG_KEEP_COUNTS.includes(n))
    ? n
    : 30;
}
/** PURE: last auto-cleanup timestamp (ms), or 0. */
function normalizeRetentionCleanupAt(value){
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
/** PURE: whether the monthly auto-cleanup gate is due. */
function shouldRunRetentionCleanup(settings, now = Date.now()){
  const last = normalizeRetentionCleanupAt(settings && settings.lastRetentionCleanupAt);
  const interval = typeof RETENTION_CLEANUP_INTERVAL_MS === 'number'
    ? RETENTION_CLEANUP_INTERVAL_MS
    : 30 * 86400000;
  return !last || (now - last) >= interval;
}
// PURE: true iff the location has any hours constraint at all. Locations with
// no hours resolve to 24h every day and skip all window math — the "Home"
// case stays literally zero-cost.
function hasLocationHours(loc){
  if(!loc)return false;
  if(Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd))return true;
  if(Array.isArray(loc.closedDays) && loc.closedDays.length)return true;
  if(loc.hoursByDay && typeof loc.hoursByDay === 'object' && Object.keys(loc.hoursByDay).length)return true;
  return false;
}
// PURE: resolve a location's open window for a given weekday (0=Sun..6=Sat),
// implementing the layered model: hoursByDay[day] → closedDays → default
// allowedTimeStart/End → 24h. Returns {start,end} minutes (0..1440) or null
// when the location is closed that day. A 24h result is {start:0,end:1440}.
function resolveLocationWindow(loc,weekday){
  if(!loc || !hasLocationHours(loc))return {start:0,end:1440};
  if(loc.hoursByDay && Object.prototype.hasOwnProperty.call(loc.hoursByDay,weekday)){
    const hd = loc.hoursByDay[weekday];
    return hd ? {start:hd.start,end:hd.end} : null;
  }
  if(Array.isArray(loc.closedDays) && loc.closedDays.includes(weekday))return null;
  if(Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd)){
    return {start:loc.allowedTimeStart,end:loc.allowedTimeEnd};
  }
  return {start:0,end:1440};
}
// PURE: unwrap a minutes window (which may wrap overnight, end <= start) into
// a list of plain [0,1440) intervals with end > start.
function unwrapMinuteWindow(win){
  if(!win || !Number.isFinite(win.start) || !Number.isFinite(win.end))return [];
  if(win.end > win.start)return [{start:win.start,end:win.end}];
  if(win.end === win.start)return [];                 // zero-length
  return [{start:win.start,end:1440},{start:0,end:win.end}];
}
// PURE: merge a list of minute intervals (sorted, non-overlapping).
function mergeMinuteIntervals(intervals){
  if(!intervals.length)return [];
  const sorted = [...intervals].sort((a,b)=>a.start - b.start);
  const merged = [{start:sorted[0].start,end:sorted[0].end}];
  for(let i = 1;i < sorted.length;i += 1){
    const last = merged[merged.length - 1];
    if(sorted[i].start <= last.end)last.end = Math.max(last.end,sorted[i].end);
    else merged.push({start:sorted[i].start,end:sorted[i].end});
  }
  return merged;
}
// PURE: intersection of two minutes windows (each possibly overnight), as a
// merged list of {start,end} intervals. Empty array = no overlap at all.
function intersectWindows(a,b){
  const ai = unwrapMinuteWindow(a);
  const bi = unwrapMinuteWindow(b);
  const out = [];
  for(const x of ai){
    for(const y of bi){
      const start = Math.max(x.start,y.start);
      const end = Math.min(x.end,y.end);
      if(end > start)out.push({start,end});
    }
  }
  return mergeMinuteIntervals(out);
}
// PURE: the feasible minute-intervals today for a habit at a location — the
// intersection of the habit's own window and the location's resolved window.
// Returns a merged interval list (possibly empty = not placeable here today).
// A habit with no own window inherits the location's window; a location with
// no hours is 24h. Pass loc=null to get the habit's own window only.
//
// Prayer anchors: when the habit's allowedTimeStart/End are tied to a prayer
// anchor, the resolved minute is computed for the habit's resolved location
// (NOT the location passed in here — that may be a different allowed
// location). If the habit has no usable location yet (e.g. mid-save), the
// anchor endpoints degrade to "unset" and the window collapses to empty.
function habitSimpleWindowIntervals(h,locWin,dayBase){
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const startAnchor = typeof cleanAnchor === 'function' ? cleanAnchor(h && h.allowedTimeStartAnchor) : null;
  const endAnchor = typeof cleanAnchor === 'function' ? cleanAnchor(h && h.allowedTimeEndAnchor) : null;
  if(startAnchor || endAnchor){
    const rawStart = resolveHabitTimeField(h,'allowedTimeStart',base);
    const rawEnd = resolveHabitTimeField(h,'allowedTimeEnd',base);
    if(rawStart == null || rawEnd == null)return [];
    const folded = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawStart,rawEnd)
      : {startMin:rawStart,endMin:rawEnd};
    const habitWin = folded.startMin === folded.endMin
      ? {start:0,end:1440}
      : {start:folded.startMin,end:folded.endMin};
    return intersectWindows(habitWin,locWin);
  }
  if(!hasSimpleAllowedTimeWindow(h)){
    return locWin.end > locWin.start ? [locWin] : unwrapMinuteWindow(locWin);
  }
  const habitWin = h.allowedTimeStart === h.allowedTimeEnd
    ? {start:0,end:1440}
    : {start:h.allowedTimeStart,end:h.allowedTimeEnd};
  return intersectWindows(habitWin,locWin);
}

function habitOptionWindowIntervals(h,locationId,locWin,dayBase){
  const intervals = [];
  for(const option of habitScheduleOptionsForDay(h,dayBase,locationId)){
    const bound = habitBoundToScheduleOption(h,option);
    intervals.push(...habitSimpleWindowIntervals(bound,locWin,dayBase));
  }
  return intervals;
}

function habitGeneralAppliesAtLocation(h,loc,dayBase,registry){
  if(!hasGeneralAllowedSchedule(h,registry))return false;
  if(!isDateEligibleForGeneralSchedule(h,dayBase != null ? dayBase : Date.now()))return false;
  const locationId = loc ? loc.id : null;
  if(locationId)return normalizeLocationIds(h && h.locationIds,registry).includes(locationId);
  return Boolean(h && h.anywhereAllowed) || !normalizeLocationIds(h && h.locationIds,registry).length;
}

// PURE: the feasible minute-intervals today for a habit at a location — the
// union of the general allowed window (every allowed place) and any specific
// time/place rows, each intersected with the venue's opening hours.
function effectiveLocationWindow(h,loc,weekday,dayBase){
  const locWin = loc ? resolveLocationWindow(loc,weekday) : {start:0,end:1440};
  if(!locWin)return [];
  const locationId = loc ? loc.id : null;
  const intervals = [];
  if(habitGeneralAppliesAtLocation(h,loc,dayBase)){
    intervals.push(...habitSimpleWindowIntervals(h,locWin,dayBase));
  }
  if(hasHabitScheduleOptions(h)){
    intervals.push(...habitOptionWindowIntervals(h,locationId,locWin,dayBase));
  }
  if(intervals.length)return mergeMinuteIntervals(intervals);
  if(hasHabitScheduleOptions(h) || hasGeneralAllowedSchedule(h))return [];
  return habitSimpleWindowIntervals(h,locWin,dayBase);
}
// PURE: startup sweep — drop any locationIds from each habit that are no longer
// in the registry, and prune locationPrefs / preferredLocationId accordingly.
// Returns {data,changed} so the caller persists only when something moved.
function reconcileLocations(data,settings){
  const registry = normalizeLocationRegistry(settings && settings.locations);
  const valid = new Set(registry.map(l=>l.id));
  let changed = false;
  const next = (Array.isArray(data) ? data : []).map(h=>{
    const prev = Array.isArray(h.locationIds) ? h.locationIds : [];
    const optionState = habitScheduleOptionLocationState(h.scheduleOptions,registry);
    const scheduleOptions = optionState.options;
    const locationIds = normalizeLocationIds(prev.filter(id=>valid.has(id)),registry);
    const anywhereAllowed = Boolean(h.anywhereAllowed);
    const prefIds = normalizeLocationIds([...locationIds,...optionState.locationIds],registry);
    const locationPrefs = normalizeLocationPrefs(h.locationPrefs,prefIds,h.preferredLocationId);
    const preferredLocationId = primaryPreferredLocationId(locationPrefs,prefIds);
    const weatherLocationId = valid.has(cleanLocationId(h.weatherLocationId)) ? cleanLocationId(h.weatherLocationId) : null;
    const prevPref = h.preferredLocationId || null;
    const prevPrefs = JSON.stringify(h.locationPrefs || {});
    const moved = locationIds.length !== prev.length
      || preferredLocationId !== prevPref
      || JSON.stringify(locationPrefs) !== prevPrefs
      || anywhereAllowed !== Boolean(h.anywhereAllowed)
      || JSON.stringify(scheduleOptions) !== JSON.stringify(h.scheduleOptions || [])
      || weatherLocationId !== (h.weatherLocationId || null);
    if(moved)changed = true;
    return moved ? {...h,locationIds,anywhereAllowed,locationPrefs,preferredLocationId,scheduleOptions,weatherLocationId} : h;
  });
  return {data:next,changed};
}
