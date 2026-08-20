// ─────────────────────────────────────────────────────────────────────────
// STORAGE — IMPURE (touches localStorage). Swappable via js/storage.js.
// In the RN port these functions move into src/data/storage.ts backed by MMKV;
// the rest of the file (pure helpers below) ports verbatim.
// ─────────────────────────────────────────────────────────────────────────

function load(){
  return normalize(Storage.read(KEY) || []);
}

// Test/debug override: `?planner=fast` exercises the whole app without loading
// or calling GLPK. It is intentionally sessionless—the user's saved optimizer
// preference is untouched when the query parameter is removed.
function agendaPlannerForcedFast(){
  try{
    return typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('planner') === 'fast';
  }catch{
    return false;
  }
}

// Workers (and dynamic import of glpk.mjs) are blocked on file://. Main-thread
// GLPK preload only pays off in that fallback; otherwise the worker warms its own.
function agendaPlannerWorkerAvailable(){
  try{
    if(typeof Worker !== 'function')return false;
    if(typeof location !== 'undefined' && location.protocol === 'file:')return false;
    return true;
  }catch{
    return false;
  }
}

// Bumped whenever persisted planner inputs change. Combined with a cheap live
// location/travel signature (see homePlannerDirtyKey) so background refreshes
// can skip a full replan when only the wall-clock minute bucket moved.
// Persisted so disk-cache keys survive cold open after the first save of the day.
const PLANNER_REVISION_KEY = 'tings_planner_revision_v1';
let _plannerDataRevision = (()=>{
  try{
    const n = Number(localStorage.getItem(PLANNER_REVISION_KEY));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }catch{
    return 0;
  }
})();
function bumpPlannerDataRevision(){
  _plannerDataRevision += 1;
  try{ localStorage.setItem(PLANNER_REVISION_KEY,String(_plannerDataRevision)); }catch(_){}
  if(typeof endPlannerSolveCaches === 'function'){
    try{ endPlannerSolveCaches(); }catch(_){}
  }
  return _plannerDataRevision;
}
function plannerDataRevision(){
  return _plannerDataRevision;
}

// ?perf=1 — console.table phase timings for cold-open / planner work.
function plannerPerfEnabled(){
  try{
    return typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('perf') === '1';
  }catch{
    return false;
  }
}
const _plannerPerfMarks = [];
let _plannerPerfTryPlace = 0;
function plannerPerfMark(name){
  if(!plannerPerfEnabled())return;
  try{
    if(typeof performance !== 'undefined' && performance.mark)performance.mark(name);
  }catch(_){}
  _plannerPerfMarks.push({name,t:typeof performance !== 'undefined' ? performance.now() : Date.now()});
  // Bound growth in long ?perf=1 sessions.
  if(_plannerPerfMarks.length > 200)_plannerPerfMarks.splice(0,_plannerPerfMarks.length - 100);
}
function plannerPerfMeasure(name,startMark,endMark){
  if(!plannerPerfEnabled())return;
  try{
    if(typeof performance !== 'undefined' && performance.measure){
      performance.measure(name,startMark,endMark);
    }
  }catch(_){}
}
function plannerPerfCountTryPlace(){
  _plannerPerfTryPlace += 1;
}
function plannerPerfResetTryPlace(){
  _plannerPerfTryPlace = 0;
}
function plannerPerfTryPlaceCount(){
  return _plannerPerfTryPlace;
}
function plannerPerfDump(label = 'planner'){
  if(!plannerPerfEnabled())return;
  const rows = [];
  for(let i = 1;i < _plannerPerfMarks.length;i += 1){
    rows.push({
      phase:_plannerPerfMarks[i].name,
      ms:Math.round((_plannerPerfMarks[i].t - _plannerPerfMarks[i - 1].t) * 10) / 10
    });
  }
  if(_plannerPerfTryPlace)rows.push({phase:'tryPlaceOnDay_calls',ms:_plannerPerfTryPlace});
  try{ console.table(rows); }catch(_){ console.log(label,rows); }
}

function loadSortSettings(){
  try{
    const saved = Storage.read(SORT_SETTINGS_KEY) || {};
    const migrated = saved && !saved.preset && Object.keys(saved).length ? {...saved,preset:'custom'} : saved;
    const merged = {...DEFAULT_SORT_SETTINGS,...SORT_PRESETS.todayFirst,...migrated,preset:'todayFirst'};
    if(saved && !Object.prototype.hasOwnProperty.call(saved,'stopMode')){
      merged.stopMode = saved.keepStopsQuiet ? 'quiet' : DEFAULT_SORT_SETTINGS.stopMode;
    }
    delete merged.keepStopsQuiet;
    delete merged.requireConfirm;
    delete merged.focusSearchOnOpen;
    merged.reminders = false;
    merged.topics = normalizeTopics(merged.topics);
    merged.locations = normalizeLocationRegistry(merged.locations);
    merged.travel = normalizeTravelCache(merged.travel);
    merged.defaultTravelMode = normalizeTravelMode(merged.defaultTravelMode);
    merged.prayerMethod = normalizePrayerMethod(merged.prayerMethod);
    merged.prayerMadhab = normalizePrayerMadhab(merged.prayerMadhab);
    merged.lastKnownLocationId = cleanLocationId(merged.lastKnownLocationId) || null;
    merged.locationOptIn = Boolean(merged.locationOptIn);
    merged.pinnedLocationId = cleanLocationId(merged.pinnedLocationId) || null;
    merged.availabilityMinutes = normalizeAvailability(merged.availabilityMinutes);
    merged.availabilityOverrides = normalizeAvailabilityOverrides(merged.availabilityOverrides);
    merged.blockedTimes = normalizeBlockedTimes(merged.blockedTimes);
    merged.cancelledBlocks = normalizeCancelledBlocks(merged.cancelledBlocks);
    merged.blockedTimeOverrides = normalizeBlockedTimeOverrides(merged.blockedTimeOverrides);
    merged.calendarCreditHabitId = (typeof cleanHabitId === 'function' ? cleanHabitId(merged.calendarCreditHabitId) : '') || null;
    merged.calendarAllDayMode = normalizeCalendarAllDayMode(merged.calendarAllDayMode);
    merged.completedTaskRetentionDays = normalizeCompletedTaskRetentionDays(merged.completedTaskRetentionDays);
    merged.habitLogKeepCount = normalizeHabitLogKeepCount(merged.habitLogKeepCount);
    merged.lastRetentionCleanupAt = normalizeRetentionCleanupAt(merged.lastRetentionCleanupAt);
    merged.defaultPriority = clampPriority(merged.defaultPriority);
    merged.defaultDurationMinutes = clampDuration(merged.defaultDurationMinutes);
    merged.defaultFlexibilityDays = clampFlexibility(merged.defaultFlexibilityDays);
    merged.defaultBreakable = Boolean(merged.defaultBreakable);
    merged.defaultMinChunkMinutes = clampMinChunk(merged.defaultMinChunkMinutes);
    merged.defaultTopics = normalizeTopics(merged.defaultTopics);
    merged.defaultAutoMarkMinutes = Number.isFinite(merged.defaultAutoMarkMinutes) && merged.defaultAutoMarkMinutes > 0 ? Math.round(merged.defaultAutoMarkMinutes) : null;
    merged.showStatusOnCards = merged.showStatusOnCards !== false;
    merged.showEarlyOnCards = merged.showEarlyOnCards !== false;
    merged.showAgendaTimesOnCards = normalizeAgendaTimeMode(merged.showAgendaTimesOnCards);
    merged.showTrailOnCards = merged.showTrailOnCards !== false;
    merged.showCueOnCards = merged.showCueOnCards !== false;
    merged.showOrderPillsOnCards = merged.showOrderPillsOnCards !== false;
    // Minimal mode defaults on, but only for a fresh install. An existing
    // install that was saved before the default flipped has settings on disk
    // without the key, and must keep the full surface it already had.
    merged.minimalMode = saved && Object.keys(saved).length
      && !Object.prototype.hasOwnProperty.call(saved,'minimalMode')
      ? false
      : Boolean(merged.minimalMode);
    merged.compactMode = Boolean(merged.compactMode);
    merged.fontScale = ['small','medium','large'].includes(merged.fontScale) ? merged.fontScale : 'medium';
    merged.themeMode = ['light','dark','system'].includes(merged.themeMode) ? merged.themeMode : 'system';
    merged.homeCityName = typeof merged.homeCityName === 'string' ? merged.homeCityName.trim() : '';
    merged.homeCityLat = Number.isFinite(merged.homeCityLat) ? merged.homeCityLat : null;
    merged.homeCityLng = Number.isFinite(merged.homeCityLng) ? merged.homeCityLng : null;
    // Migrate legacy prayer-city fields into home city.
    if(!merged.homeCityName && typeof merged.prayerCityName === 'string' && merged.prayerCityName.trim()){
      merged.homeCityName = merged.prayerCityName.trim();
      merged.homeCityLat = Number.isFinite(merged.prayerCityLat) ? merged.prayerCityLat : null;
      merged.homeCityLng = Number.isFinite(merged.prayerCityLng) ? merged.prayerCityLng : null;
    }
    if(!Number.isFinite(merged.homeCityLat) && Number.isFinite(merged.prayerCityLat) && Number.isFinite(merged.prayerCityLng)){
      merged.homeCityLat = merged.prayerCityLat;
      merged.homeCityLng = merged.prayerCityLng;
      if(!merged.homeCityName)merged.homeCityName = typeof merged.prayerCityName === 'string' ? merged.prayerCityName.trim() : '';
    }
    delete merged.prayerCityName;
    delete merged.prayerCityLat;
    delete merged.prayerCityLng;
    merged.prayerIslamicNames = Boolean(merged.prayerIslamicNames);
    merged.agendaOptimizer = agendaPlannerForcedFast()
      ? false
      : Boolean(merged.agendaOptimizer);
    merged.agendaScoreWeights = normalizeAgendaScoreWeights(merged.agendaScoreWeights);
    // Worker-only location hints are request-scoped. Older builds could leave
    // them in saved settings, making a stale GPS coordinate look live forever.
    delete merged._plannerCurrentCoord;
    delete merged._plannerLiveLocationId;
    // Prefer worker-side GLPK warm. Main-thread preload only when workers cannot run.
    if(merged.agendaOptimizer && typeof preloadAgendaOptimizer === 'function'
      && typeof agendaPlannerWorkerAvailable === 'function' && !agendaPlannerWorkerAvailable()){
      try{ preloadAgendaOptimizer(); }catch(_){}
    }
    return merged;
  }catch{
    return {
      ...DEFAULT_SORT_SETTINGS,
      agendaOptimizer:agendaPlannerForcedFast()
        ? false
        : Boolean(DEFAULT_SORT_SETTINGS.agendaOptimizer)
    };
  }
}

function saveSortSettings(settings){
  const next = {...DEFAULT_SORT_SETTINGS,...SORT_PRESETS.todayFirst,...settings,preset:'todayFirst'};
  delete next.keepStopsQuiet;
  next.reminders = false;
  next.topics = normalizeTopics(next.topics);
  next.locations = normalizeLocationRegistry(next.locations);
  next.travel = normalizeTravelCache(next.travel);
  next.defaultTravelMode = normalizeTravelMode(next.defaultTravelMode);
  next.prayerMethod = normalizePrayerMethod(next.prayerMethod);
  next.prayerMadhab = normalizePrayerMadhab(next.prayerMadhab);
  next.lastKnownLocationId = cleanLocationId(next.lastKnownLocationId) || null;
  next.locationOptIn = Boolean(next.locationOptIn);
  next.pinnedLocationId = cleanLocationId(next.pinnedLocationId) || null;
  next.availabilityMinutes = normalizeAvailability(next.availabilityMinutes);
  next.availabilityOverrides = normalizeAvailabilityOverrides(next.availabilityOverrides);
  next.blockedTimes = normalizeBlockedTimes(next.blockedTimes);
  next.cancelledBlocks = normalizeCancelledBlocks(next.cancelledBlocks);
  next.blockedTimeOverrides = normalizeBlockedTimeOverrides(next.blockedTimeOverrides);
  next.calendarCreditHabitId = (typeof cleanHabitId === 'function' ? cleanHabitId(next.calendarCreditHabitId) : '') || null;
  next.calendarAllDayMode = normalizeCalendarAllDayMode(next.calendarAllDayMode);
  next.completedTaskRetentionDays = normalizeCompletedTaskRetentionDays(next.completedTaskRetentionDays);
  next.habitLogKeepCount = normalizeHabitLogKeepCount(next.habitLogKeepCount);
  next.lastRetentionCleanupAt = normalizeRetentionCleanupAt(next.lastRetentionCleanupAt);
  next.defaultPriority = clampPriority(next.defaultPriority);
  next.defaultDurationMinutes = clampDuration(next.defaultDurationMinutes);
  next.defaultFlexibilityDays = clampFlexibility(next.defaultFlexibilityDays);
  next.defaultBreakable = Boolean(next.defaultBreakable);
  next.defaultMinChunkMinutes = clampMinChunk(next.defaultMinChunkMinutes);
  next.defaultTopics = normalizeTopics(next.defaultTopics);
  next.defaultAutoMarkMinutes = Number.isFinite(next.defaultAutoMarkMinutes) && next.defaultAutoMarkMinutes > 0 ? Math.round(next.defaultAutoMarkMinutes) : null;
  next.showStatusOnCards = next.showStatusOnCards !== false;
  next.showEarlyOnCards = next.showEarlyOnCards !== false;
  next.showAgendaTimesOnCards = normalizeAgendaTimeMode(next.showAgendaTimesOnCards);
  next.showTrailOnCards = next.showTrailOnCards !== false;
  next.showCueOnCards = next.showCueOnCards !== false;
  next.showOrderPillsOnCards = next.showOrderPillsOnCards !== false;
  next.minimalMode = Boolean(next.minimalMode);
  next.compactMode = Boolean(next.compactMode);
  next.fontScale = ['small','medium','large'].includes(next.fontScale) ? next.fontScale : 'medium';
  next.themeMode = ['light','dark','system'].includes(next.themeMode) ? next.themeMode : 'system';
  next.homeCityName = typeof next.homeCityName === 'string' ? next.homeCityName.trim() : '';
  next.homeCityLat = Number.isFinite(next.homeCityLat) ? next.homeCityLat : null;
  next.homeCityLng = Number.isFinite(next.homeCityLng) ? next.homeCityLng : null;
  if(!next.homeCityName && typeof next.prayerCityName === 'string' && next.prayerCityName.trim()){
    next.homeCityName = next.prayerCityName.trim();
    next.homeCityLat = Number.isFinite(next.prayerCityLat) ? next.prayerCityLat : null;
    next.homeCityLng = Number.isFinite(next.prayerCityLng) ? next.prayerCityLng : null;
  }
  delete next.prayerCityName;
  delete next.prayerCityLat;
  delete next.prayerCityLng;
  next.prayerIslamicNames = Boolean(next.prayerIslamicNames);
  next.agendaOptimizer = agendaPlannerForcedFast()
    ? false
    : Boolean(next.agendaOptimizer);
  next.agendaScoreWeights = normalizeAgendaScoreWeights(next.agendaScoreWeights);
  delete next._plannerCurrentCoord;
  delete next._plannerLiveLocationId;
  sortSettings = next;
  Storage.write(SORT_SETTINGS_KEY, sortSettings);
}

