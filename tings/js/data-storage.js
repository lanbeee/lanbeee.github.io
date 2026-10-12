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
function plannerPerfCountTryPlace(){
  _plannerPerfTryPlace += 1;
}
function plannerPerfResetTryPlace(){
  _plannerPerfTryPlace = 0;
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

// PURE: creation profiles share field semantics, but never share mutable state.
function normalizeNewItemDefaults(raw = {}){
  const autoMarkMinutes = normalizeAutoMark(raw.autoMarkMinutes);
  return {
    target:clampRhythmValue(raw.target ?? 7),
    priority:clampPriority(raw.priority ?? DEFAULT_PRIORITY),
    durationMinutes:clampDuration(raw.durationMinutes),
    earlyWindowDays:clampFlexibility(raw.earlyWindowDays),
    delayAllowanceDays:clampDelayAllowance(raw.delayAllowanceDays),
    breakable:Boolean(raw.breakable),
    minChunkMinutes:clampMinChunk(raw.minChunkMinutes),
    topics:normalizeTopics(raw.topics),
    autoMarkMode:['manual','duration','minutes'].includes(raw.autoMarkMode)
      ? raw.autoMarkMode : (autoMarkMinutes !== null ? 'minutes' : 'manual'),
    autoMarkMinutes,
    dueDateMode:['none','today','tomorrow'].includes(raw.dueDateMode) ? raw.dueDateMode : 'today',
    allowedWeekdays:normalizeAllowedWeekdays(raw.allowedWeekdays),
    allowedTimeStart:normalizeTimeMinutes(raw.allowedTimeStart),
    allowedTimeEnd:normalizeTimeMinutes(raw.allowedTimeEnd),
    locationIds:normalizeLocationIds(raw.locationIds),
    anywhereAllowed:raw.anywhereAllowed !== false
  };
}

function newItemDefaults(settings,type){
  const habit = {};
  for(const key of ['target','priority','durationMinutes','earlyWindowDays','delayAllowanceDays',
    'breakable','minChunkMinutes','topics','autoMarkMode','autoMarkMinutes','allowedWeekdays',
    'allowedTimeStart','allowedTimeEnd','locationIds','anywhereAllowed']){
    habit[key] = settings['default' + key[0].toUpperCase() + key.slice(1)];
  }
  const normalized = normalizeNewItemDefaults(habit);
  return type === 'task' ? normalizeNewItemDefaults(settings.taskDefaults || normalized) : normalized;
}

function normalizeCreationSettings(settings){
  // Old backups may specify minutes without the newer mode field.
  if(settings.defaultAutoMarkMode == null){
    settings.defaultAutoMarkMode = settings.defaultAutoMarkMinutes != null ? 'minutes' : 'manual';
  }
  const habit = newItemDefaults(settings,'keepup');
  settings.taskDefaults = normalizeNewItemDefaults(settings.taskDefaults || habit);
  for(const key of Object.keys(habit)){
    if(key === 'dueDateMode')continue;
    settings['default' + key[0].toUpperCase() + key.slice(1)] = habit[key];
  }
  settings.defaultType = ['keepup','reduce','zero','task'].includes(settings.defaultType) ? settings.defaultType : 'keepup';
}

function defaultAutoMarkMinutes(profile,durationMinutes = profile.durationMinutes){
  return profile.autoMarkMode === 'duration' ? durationMinutes
    : profile.autoMarkMode === 'minutes' ? profile.autoMarkMinutes : null;
}

function defaultTaskDueDate(profile,now = Date.now()){
  if(profile.dueDateMode === 'none')return null;
  const day = new Date(now);
  if(profile.dueDateMode === 'tomorrow')day.setDate(day.getDate() + 1);
  return dayStart(day.getTime());
}

// Card presets only change annotations; the planner never reads these fields.
const CARD_DETAIL_KEYS = [
  'showPinnedOnCards','showTaskDateOnCards','showPlansOnCards',
  'showDayScheduleOnCards','showTimeWindowOnCards','showSnoozedUntilOnCards',
  'showDurationOnCards','showRepetitionOnCards','showFlexibilityOnCards',
  'showTopicsOnCards','showLocationOnCards','showRemindersOnCards',
  'showStatusOnCards','showEarlyOnCards','showCueOnCards','showOrderPillsOnCards'
];
function cardDetailPatch(mode,settings = {}){
  if(!['simple','detailed','custom'].includes(mode))return null;
  const custom = settings.customCardDetails || settings;
  const detailedExtras = ['showDayScheduleOnCards','showTimeWindowOnCards',
    'showDurationOnCards','showTopicsOnCards','showLocationOnCards'];
  return Object.fromEntries(CARD_DETAIL_KEYS.map(key=>[
    key,mode === 'custom' && typeof custom[key] === 'boolean' ? custom[key]
      : Boolean(DEFAULT_SORT_SETTINGS[key]) || (mode === 'detailed' && detailedExtras.includes(key))
  ]));
}
function normalizeCardDetails(settings){
  if(!['simple','detailed','custom'].includes(settings.cardDetailLevel))settings.cardDetailLevel = 'simple';
  if(settings.cardDetailLevel === 'custom'){
    // Snapshot edits so switching through a preset does not lose custom choices.
    settings.customCardDetails = cardDetailPatch('custom',{...settings,customCardDetails:null});
  }else if(settings.customCardDetails){
    settings.customCardDetails = cardDetailPatch('custom',settings);
  }
  Object.assign(settings,cardDetailPatch(settings.cardDetailLevel,settings));
  settings.showSampleOnCards = true;
}

function loadSortSettings(){
  try{
    const saved = Storage.read(SORT_SETTINGS_KEY) || {};
    const migrated = saved && !saved.preset && Object.keys(saved).length ? {...saved,preset:'custom'} : saved;
    const merged = {...DEFAULT_SORT_SETTINGS,...SORT_PRESETS.todayFirst,...migrated,preset:'todayFirst'};
    // v2 makes model-first routing the default for existing installs too. Once
    // the user changes the toggle, updateSortSetting persists this version and
    // Natural-language routing is always model-first. Keep the persisted keys
    // only so older backups continue to import cleanly.
    merged.localAssistantModelOnly = true;
    merged.localAssistantRoutingVersion = 3;
    if(saved && !Object.prototype.hasOwnProperty.call(saved,'stopMode')){
      merged.stopMode = saved.keepStopsQuiet ? 'quiet' : DEFAULT_SORT_SETTINGS.stopMode;
    }
    delete merged.keepStopsQuiet;
    delete merged.requireConfirm;
    delete merged.focusSearchOnOpen;
    delete merged.showWeekOnHome;
    delete merged.homeExtraMode;
    // Agenda inclusion and planned-item promotion are always enabled.
    for(const key of ['plansFirst','showScheduledTasksInAgenda','showDueTasksInAgenda','showPlannedItemsInAgenda','showDueHabitsInAgenda'])delete merged[key];
    merged.reminders = false;
    merged.topics = normalizeTopics(merged.topics);
    merged.locations = normalizeLocationRegistry(merged.locations);
    merged.travel = normalizeTravelCache(merged.travel);
    merged.defaultTravelMode = normalizeTravelMode(merged.defaultTravelMode);
    merged.mapBaseLayer = merged.mapBaseLayer === 'satellite' ? 'satellite' : 'street';
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
    const savedEarlyDefault = Object.prototype.hasOwnProperty.call(saved,'defaultEarlyWindowDays')
      ? saved.defaultEarlyWindowDays
      : saved.defaultFlexibilityDays;
    merged.defaultEarlyWindowDays = clampFlexibility(
      savedEarlyDefault != null ? savedEarlyDefault : merged.defaultEarlyWindowDays
    );
    merged.defaultDelayAllowanceDays = clampDelayAllowance(merged.defaultDelayAllowanceDays);
    delete merged.defaultFlexibilityDays;
    merged.defaultBreakable = Boolean(merged.defaultBreakable);
    merged.defaultMinChunkMinutes = clampMinChunk(merged.defaultMinChunkMinutes);
    merged.defaultTopics = normalizeTopics(merged.defaultTopics);
    merged.defaultAutoMarkMinutes = Number.isFinite(merged.defaultAutoMarkMinutes) && merged.defaultAutoMarkMinutes >= 0 ? Math.round(merged.defaultAutoMarkMinutes) : null;
    if(!Object.prototype.hasOwnProperty.call(saved,'defaultAutoMarkMode'))merged.defaultAutoMarkMode = null;
    normalizeCreationSettings(merged);
    // Calm-card defaults: fresh installs get the quieter card (no insight
    // decorations, no compact rows). An install saved before the default
    // flipped has settings on disk without these keys — keep the fuller look
    // it already had. Saved explicit values always win.
    const legacyCalmDefault = key => Boolean(saved && Object.keys(saved).length
      && !Object.prototype.hasOwnProperty.call(saved,key));
    merged.showAgendaTimesOnCards = normalizeAgendaTimeMode(merged.showAgendaTimesOnCards);
    merged.showTrailOnCards = legacyCalmDefault('showTrailOnCards') || Boolean(merged.showTrailOnCards);
    // Minimal mode is opt-in: the default is the fuller surface, and a saved
    // explicit value always wins (see config.js minimalMode).
    merged.minimalMode = Boolean(merged.minimalMode);
    merged.colorPalette = ['default','neutral','sage','sky','lavender','sand'].includes(merged.colorPalette) ? merged.colorPalette : 'default';
    merged.soundEffects = merged.soundEffects !== false;
    merged.compactMode = legacyCalmDefault('compactMode') || Boolean(merged.compactMode);
    merged.fontScale = ['small','medium','large'].includes(merged.fontScale) ? merged.fontScale : 'medium';
    merged.themeMode = ['light','dark','system'].includes(merged.themeMode) ? merged.themeMode : 'system';
    merged.homeCityName = typeof merged.homeCityName === 'string' ? merged.homeCityName.trim() : '';
    merged.homeCityLat = Number.isFinite(merged.homeCityLat) ? merged.homeCityLat : null;
    merged.homeCityLng = Number.isFinite(merged.homeCityLng) ? merged.homeCityLng : null;
    merged.homeCityCountry = typeof merged.homeCityCountry === 'string'
      ? merged.homeCityCountry.trim().toUpperCase().slice(0,2) : '';
    merged.weatherTempUnit = typeof normalizeWeatherTempUnit === 'function'
      ? normalizeWeatherTempUnit(merged.weatherTempUnit) : 'auto';
    merged.weatherPrecipUnit = typeof normalizeWeatherPrecipUnit === 'function'
      ? normalizeWeatherPrecipUnit(merged.weatherPrecipUnit) : 'auto';
    merged.weatherWindUnit = typeof normalizeWeatherWindUnit === 'function'
      ? normalizeWeatherWindUnit(merged.weatherWindUnit) : 'auto';
    merged.weatherProfiles = typeof normalizeWeatherProfiles === 'function'
      ? normalizeWeatherProfiles(merged.weatherProfiles) : [];
    merged.showWeatherTemperatureRanges = Boolean(merged.showWeatherTemperatureRanges);
    merged.showWeatherOnBusyTimes = Boolean(merged.showWeatherOnBusyTimes);
    merged.showWeatherOnTravel = merged.showWeatherOnTravel !== false;
    delete merged.showWeatherOnHabits;
    delete merged.showWeatherOnTasks;
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
    merged.localAssistant = Boolean(merged.localAssistant);
    merged.localAssistantProvider = typeof normalizeLocalAssistantProvider === 'function'
      ? normalizeLocalAssistantProvider(merged.localAssistantProvider) : 'auto';
    merged.localAssistantUrl = typeof normalizeLocalAssistantUrl === 'function'
      ? normalizeLocalAssistantUrl(merged.localAssistantUrl) : '';
    merged.localAssistantModel = typeof normalizeLocalAssistantModel === 'function'
      ? normalizeLocalAssistantModel(merged.localAssistantModel) : '';
    merged.localAssistantDebug = Boolean(merged.localAssistantDebug);
    merged.agendaOptimizer = agendaPlannerForcedFast()
      ? false
      : Boolean(merged.agendaOptimizer);
    merged.agendaScoreWeights = normalizeAgendaScoreWeights(merged.agendaScoreWeights);
    // Worker-only location hints are request-scoped. Older builds could leave
    // them in saved settings, making a stale GPS coordinate look live forever.
    delete merged._plannerCurrentCoord;
    delete merged._plannerLiveLocationId;
    delete merged._weatherContext;
    if(typeof weatherPlannerContext === 'function')merged._weatherContext = weatherPlannerContext(merged);
    // Prefer worker-side GLPK warm. Main-thread preload only when workers cannot run.
    if(merged.agendaOptimizer && typeof preloadAgendaOptimizer === 'function'
      && typeof agendaPlannerWorkerAvailable === 'function' && !agendaPlannerWorkerAvailable()){
      try{ preloadAgendaOptimizer(); }catch(_){}
    }
    normalizeCardDetails(merged);
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
  if(!Object.prototype.hasOwnProperty.call(settings,'defaultAutoMarkMode'))next.defaultAutoMarkMode = null;
  delete next.keepStopsQuiet;
  delete next.showWeekOnHome;
  delete next.homeExtraMode;
  // Agenda inclusion and planned-item promotion are always enabled.
  for(const key of ['plansFirst','showScheduledTasksInAgenda','showDueTasksInAgenda','showPlannedItemsInAgenda','showDueHabitsInAgenda'])delete next[key];
  next.reminders = false;
  next.topics = normalizeTopics(next.topics);
  next.locations = normalizeLocationRegistry(next.locations);
  next.travel = normalizeTravelCache(next.travel);
  next.defaultTravelMode = normalizeTravelMode(next.defaultTravelMode);
  next.mapBaseLayer = next.mapBaseLayer === 'satellite' ? 'satellite' : 'street';
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
  next.defaultEarlyWindowDays = clampFlexibility(
    next.defaultEarlyWindowDays != null ? next.defaultEarlyWindowDays : next.defaultFlexibilityDays
  );
  next.defaultDelayAllowanceDays = clampDelayAllowance(next.defaultDelayAllowanceDays);
  delete next.defaultFlexibilityDays;
  next.defaultBreakable = Boolean(next.defaultBreakable);
  next.defaultMinChunkMinutes = clampMinChunk(next.defaultMinChunkMinutes);
  next.defaultTopics = normalizeTopics(next.defaultTopics);
  next.defaultAutoMarkMinutes = Number.isFinite(next.defaultAutoMarkMinutes) && next.defaultAutoMarkMinutes >= 0 ? Math.round(next.defaultAutoMarkMinutes) : null;
  normalizeCreationSettings(next);
  next.showAgendaTimesOnCards = normalizeAgendaTimeMode(next.showAgendaTimesOnCards);
  next.showTrailOnCards = next.showTrailOnCards !== false;
  next.minimalShowTrailOnCards = Boolean(next.minimalShowTrailOnCards);
  next.minimalMode = Boolean(next.minimalMode);
  next.colorPalette = ['default','neutral','sage','sky','lavender','sand'].includes(next.colorPalette) ? next.colorPalette : 'default';
  next.soundEffects = next.soundEffects !== false;
  next.compactMode = Boolean(next.compactMode);
  next.fontScale = ['small','medium','large'].includes(next.fontScale) ? next.fontScale : 'medium';
  next.themeMode = ['light','dark','system'].includes(next.themeMode) ? next.themeMode : 'system';
  next.homeCityName = typeof next.homeCityName === 'string' ? next.homeCityName.trim() : '';
  next.homeCityLat = Number.isFinite(next.homeCityLat) ? next.homeCityLat : null;
  next.homeCityLng = Number.isFinite(next.homeCityLng) ? next.homeCityLng : null;
  next.homeCityCountry = typeof next.homeCityCountry === 'string'
    ? next.homeCityCountry.trim().toUpperCase().slice(0,2) : '';
  next.weatherTempUnit = typeof normalizeWeatherTempUnit === 'function'
    ? normalizeWeatherTempUnit(next.weatherTempUnit) : 'auto';
  next.weatherPrecipUnit = typeof normalizeWeatherPrecipUnit === 'function'
    ? normalizeWeatherPrecipUnit(next.weatherPrecipUnit) : 'auto';
  next.weatherWindUnit = typeof normalizeWeatherWindUnit === 'function'
    ? normalizeWeatherWindUnit(next.weatherWindUnit) : 'auto';
  next.weatherProfiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles(next.weatherProfiles) : [];
  next.showWeatherTemperatureRanges = Boolean(next.showWeatherTemperatureRanges);
  next.showWeatherOnBusyTimes = Boolean(next.showWeatherOnBusyTimes);
  next.showWeatherOnTravel = next.showWeatherOnTravel !== false;
  delete next.showWeatherOnHabits;
  delete next.showWeatherOnTasks;
  if(!next.homeCityName && typeof next.prayerCityName === 'string' && next.prayerCityName.trim()){
    next.homeCityName = next.prayerCityName.trim();
    next.homeCityLat = Number.isFinite(next.prayerCityLat) ? next.prayerCityLat : null;
    next.homeCityLng = Number.isFinite(next.prayerCityLng) ? next.prayerCityLng : null;
  }
  delete next.prayerCityName;
  delete next.prayerCityLat;
  delete next.prayerCityLng;
  next.prayerIslamicNames = Boolean(next.prayerIslamicNames);
  next.localAssistant = Boolean(next.localAssistant);
  next.localAssistantProvider = typeof normalizeLocalAssistantProvider === 'function'
    ? normalizeLocalAssistantProvider(next.localAssistantProvider) : 'auto';
  next.localAssistantUrl = typeof normalizeLocalAssistantUrl === 'function'
    ? normalizeLocalAssistantUrl(next.localAssistantUrl) : '';
  next.localAssistantModel = typeof normalizeLocalAssistantModel === 'function'
    ? normalizeLocalAssistantModel(next.localAssistantModel) : '';
  next.localAssistantDebug = Boolean(next.localAssistantDebug);
  next.agendaOptimizer = agendaPlannerForcedFast()
    ? false
    : Boolean(next.agendaOptimizer);
  next.agendaScoreWeights = normalizeAgendaScoreWeights(next.agendaScoreWeights);
  delete next._plannerCurrentCoord;
  delete next._plannerLiveLocationId;
  delete next._weatherContext;
  normalizeCardDetails(next);
  Storage.write(SORT_SETTINGS_KEY, next);
  // Derived, not persisted. Reattach it on the live object so a travel-cache
  // or settings write cannot blank the day-header forecast until the next load.
  try{
    if(typeof weatherPlannerContext === 'function')next._weatherContext = weatherPlannerContext(next);
  }catch(_){}
  sortSettings = next;
}
