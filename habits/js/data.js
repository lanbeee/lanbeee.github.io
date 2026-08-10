// Local storage, normalization, quota pruning, and date/text helpers.
//
// ─────────────────────────────────────────────────────────────────────────
// DATA SCHEMAS — JSDoc typedefs
// Source of truth for Habit and Settings shapes. Mirrors the normalize()
// output below. When porting to React Native, these become TypeScript
// interfaces in src/types/ with no field changes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single log entry. Either a bare timestamp (ms) for an actual occurrence,
 * a planned-future entry, or an enriched actual with optional numeric value
 * (e.g. weight), minutes (chunk progress on breakable items), and/or a
 * free-form text note. Day plans may carry `timed` (hard clock) and
 * `locationId` (one-day place override); plan-by (`planByDate`) is separate.
 * @typedef {(number|{ts:number,plan:true,timed?:true,locationId?:string}|{ts:number,value?:number,minutes?:number,note?:string})} LogEntry
 */

/**
 * A habit. Stored in the habits array under the `tings_v2` localStorage key.
 * The same record shape expresses all four item kinds via `type`; the fields
 * below marked with TaskFields only carry meaning for that type.
 * @typedef {Object} Habit
 * @property {string} hid                     — stable opaque id (crypto.randomUUID()), never user-displayed. Used by other habits' time anchors. Generated on first normalize; legacy records get one transparently.
 * @property {string} name                    — display name (max 60 chars)
 * @property {'keepup'|'reduce'|'zero'|'task'} type  — build / limit / stop / one-off
 * @property {number|null} target             — rhythm in days (may be fractional, e.g. 3.5 = 2×/7d); null when type in zero/task
 * @property {LogEntry[]} logs                — sorted actual + planned entries (max 500)
 * @property {string} emoji                   — grapheme cluster(s), '' means default icon
 * @property {string} emojiBgColor            — curated token for emoji icon background: ''|teal|amber|red|purple|blue|green
 * @property {boolean} pinned                 — stays above auto-sorted habits
 * @property {boolean} sample                 — true if created by the sort-lab sample builder
 * @property {number|null} snoozedUntil       — ms timestamp; habit hidden on home until then
 * @property {string[]} topics                — user-defined tags (max 24, each max 32 chars)
 * @property {number[]} allowedWeekdays       — 0=Sun … 6=Sat; empty means every day
 * @property {number[]} allowedMonthDays      — 1-31; empty means every day
 * @property {number[]} preferredWeekdays     — like allowedWeekdays, but for the "preferred" set
 * @property {number[]} preferredMonthDays    — like allowedMonthDays, but for the "preferred" set
 * @property {number|null} allowedTimeStart   — minutes since midnight; null = unrestricted
 * @property {number|null} allowedTimeEnd     — minutes since midnight; null = unrestricted
 * @property {number|null} preferredTimeStart — minutes since midnight; null = unrestricted
 * @property {number|null} preferredTimeEnd   — minutes since midnight; null = unrestricted
 *
 * — Prayer-time anchors (optional; mutually exclusive per-endpoint with the fixed minutes above) —
 * When `*Anchor` is set it overrides the matching fixed-minutes field for that endpoint, and the
 * resolved minute is computed from the habit's location for the current day (see js/prayer-times.js).
 * @property {string|null} allowedTimeStartAnchor   — 'fajr'|'sunrise'|'dhuhr'|'asr'|'maghrib'|'isha'|'habit'|null
 * @property {number}      allowedTimeStartOffsetMin — signed minutes vs the anchor (e.g. +60 = an hour after)
 * @property {string|null} allowedTimeEndAnchor
 * @property {number}      allowedTimeEndOffsetMin
 * @property {string|null} preferredTimeStartAnchor
 * @property {number}      preferredTimeStartOffsetMin
 * @property {string|null} preferredTimeEndAnchor
 * @property {number}      preferredTimeEndOffsetMin
 *
 * — Persistent planner order (optional; recurring, unlike drag reorder) —
 * @property {ScheduleLink[]} scheduleLinks   — OR list of before/after relationships; any number
 *
 * — Habit-relative anchors (optional; only meaningful when *Anchor = 'habit') —
 * When an anchor field is set to 'habit', the matching *AnchorHabitId references another habit's
 * stable `hid`. The endpoint resolves to that habit's most-recent log time + the signed offset,
 * with one rule that prevents re-firing: if THIS habit's own last log is on/after the anchor
 * habit's last log, the window collapses (the anchor has already been "consumed"). See js/prayer-times.js.
 * @property {string|null} allowedTimeStartAnchorHabitId
 * @property {string|null} allowedTimeEndAnchorHabitId
 * @property {string|null} preferredTimeStartAnchorHabitId
 * @property {string|null} preferredTimeEndAnchorHabitId
 *
 * — Combined expressions (optional; "later of" / "earlier of" two anchors) —
 * When `*Combine` is 'later' or 'earlier' and `*Anchor2` is set, the endpoint resolves to
 * max/min of the primary and secondary expressions. `*DayOffset` / `*DayOffset2` are 0 or 1
 * (next calendar day) so "sunrise − 8h +1d" means tonight relative to tomorrow's sunrise.
 * @property {'later'|'earlier'|null} allowedTimeStartCombine
 * @property {string|null} allowedTimeStartAnchor2
 * @property {number}      allowedTimeStartOffsetMin2
 * @property {string|null} allowedTimeStartAnchorHabitId2
 * @property {number|null} allowedTimeStartFixedMin2 — minutes 0..1439 when Anchor2 === 'fixed'
 * @property {number}      allowedTimeStartDayOffset
 * @property {number}      allowedTimeStartDayOffset2
 * @property {'later'|'earlier'|null} allowedTimeEndCombine
 * @property {string|null} allowedTimeEndAnchor2
 * @property {number}      allowedTimeEndOffsetMin2
 * @property {string|null} allowedTimeEndAnchorHabitId2
 * @property {number|null} allowedTimeEndFixedMin2
 * @property {number}      allowedTimeEndDayOffset
 * @property {number}      allowedTimeEndDayOffset2
 * @property {'later'|'earlier'|null} preferredTimeStartCombine
 * @property {string|null} preferredTimeStartAnchor2
 * @property {number}      preferredTimeStartOffsetMin2
 * @property {string|null} preferredTimeStartAnchorHabitId2
 * @property {number|null} preferredTimeStartFixedMin2
 * @property {number}      preferredTimeStartDayOffset
 * @property {number}      preferredTimeStartDayOffset2
 * @property {'later'|'earlier'|null} preferredTimeEndCombine
 * @property {string|null} preferredTimeEndAnchor2
 * @property {number}      preferredTimeEndOffsetMin2
 * @property {string|null} preferredTimeEndAnchorHabitId2
 * @property {number|null} preferredTimeEndFixedMin2
 * @property {number}      preferredTimeEndDayOffset
 * @property {number}      preferredTimeEndDayOffset2
 * @property {number} flexibilityDays         — buffer added to (or subtracted from) target; 0-60. For tasks: days-before-due it starts surfacing.
 * @property {number} durationMinutes         — planned session length; 1-720
 * @property {boolean} breakable              — when true, planner may split work across sessions; prefers one continuous run of remaining duration, and never schedules a split piece below minChunkMinutes (except a finish-up when remaining < min). Keepup/reduce: fresh duration budget each rhythm day. Tasks: one-shot pool across the week until logged minutes cover duration.
 * @property {number} minChunkMinutes         — hard minimum session length when splitting a breakable item; 15-720. Not a preferred/suggested chunk size.
 * @property {number|null} timerAutoStopMinutes — optional manual-session target (legacy field name; null = use durationMinutes)
 * @property {number|null} autoMarkMinutes — null = manual. Non-breakables complete after their trigger plus this delay; breakables reconcile captured agenda chunks after their end plus this delay.
 * @property {boolean} trackValue             — when true, logging offers a free-form numeric value field
 * @property {number} priority                — 0 (P0 critical) .. 5 (P5 someday). Manual; drives who claims today's agenda capacity first.
 * @property {number|null} lastLog            — derived: most recent actual log timestamp
 * @property {number|null} createdAt          — ms timestamp set at creation; secondary sort key + "added Nd ago" copy. null on legacy records.
 * @property {number|null} planByDate         — keepup/reduce only: one-off soft "do by" day (ms day-start). Week planner may place it any day on/before this date; cleared on the next actual log. null = none.
 * @property {string|null} externalId         — stable id from an external calendar/PDF import; null for Tings-native items. Used to de-dupe on re-import.
 * @property {'pdf'|'msgraph'|'gcal'|null} source — which importer produced this row; null for Tings-native items.
 * @property {number|null} importedAt         — ms timestamp of last import overwrite; null when not imported.
 *
 * — TaskFields (additional semantics when type === 'task') —
 * @property {number|null} dueDate            — ms day-level timestamp, or null for a "someday" task
 * @property {number|null} eventTime          — ms timestamp at the exact minute when this task is scheduled; null = no fixed time (dated or someday)
 * @property {boolean} hardDue                — computed: true when dueDate is set and flexibilityDays is 0 (firm deadline, escalates urgency past it)
 *
 * — LocationFields (optional, on every type) —
 * @property {string[]} locationIds           — selected allowed/preferred Location ids
 * @property {boolean} anywhereAllowed         — may also be done outside selected places
 * @property {Object<string,'avoid'|'little'|'high'>} locationPrefs — soft preference among allowed ids
 * @property {string|null} preferredLocationId — legacy single preferred (migrated into locationPrefs.high); kept for reads
 */

/**
 * A recurring planner relationship, stored from the subject habit's point of
 * view. Direct links allow required travel/fixed blocks, but no movable card.
 * Multiple links on one subject are OR'd: plan with whichever partner lands
 * that day. A subject may be right-after several anchors; one anchor may have
 * only one right-after successor.
 * `requireSameDay` means must-do on days with the partner (pull + require when
 * the partner is present); other days stay unconstrained.
 * @typedef {Object} ScheduleLink
 * @property {string} anchorHid
 * @property {'before'|'after'} direction
 * @property {'sometime'|'direct'} adjacency
 * @property {boolean} requireSameDay
 */

/**
 * App-wide sort/display settings. Stored under `tings_app_settings_v2`.
 * Composed from SORT_PRESETS[preset] plus the fields below.
 * @typedef {Object} Settings
 * @property {'balanced'|'build'|'planned'|'todayFirst'|'custom'} preset
 * @property {'balanced'|'build'|'space'} focus                 — inherited from the preset
 * @property {boolean} plansFirst                              — let planned habits rise
 * @property {number} planWindowDays                           — 1-14, look-ahead for plan signal
 * @property {number} planWeight                               — 0-200, multiplies plan signal
 * @property {number} dueWeight                                — 0-200
 * @property {number} progressWeight                           — 0-200
 * @property {number} trendWeight                              — 0-200
 * @property {number} rhythmWeight                             — 0-200
 * @property {number} buildWeight                              — 0-200, scales build-type habits
 * @property {number} limitWeight                              — 0-200, scales limit-type habits
 * @property {number} stopWeight                               — 0-200, scales stop-type habits
 * @property {number} newWeight                                — 0-200, scales never-logged habits
 * @property {'quiet'|'gentle'|'rise'} newBuildMode            — handling for new build habits
 * @property {'relative'|'date'|'short'} dueMode               — how build-habit urgency is computed
 * @property {number} buildLookAheadDays                       — 1-14
 * @property {number} buildRiseAt                              — 40-110, urgency % where build habits rise
 * @property {'quiet'|'overdue'|'near'|'active'} limitMode    — limit-habit policy selector
 * @property {'quiet'|'watch'|'recent'|'active'} stopMode      — stop-habit policy selector
 * @property {number} rhythmBias                               — -100 to 100, favours shorter or longer rhythms
 * @property {boolean} showSnoozed                             — render snoozed habits faded on home
 * @property {boolean} showSampleOnCards                       — show sample marker chip on home cards
 * @property {boolean} showPinnedOnCards                       — show pinned chip on home cards
 * @property {boolean} showTaskDateOnCards                     — show task due/scheduled chip on home cards
 * @property {boolean} showPlansOnCards                        — show planned-entry chip on home cards
 * @property {boolean} showDayScheduleOnCards                  — show weekday/monthday schedule chip on home cards
 * @property {boolean} showTimeWindowOnCards                   — show time-window chip on home cards
 * @property {boolean} showSnoozedUntilOnCards                 — show snoozed-until chip on home cards
 * @property {boolean} showDurationOnCards                     — show duration chip on home cards
 * @property {boolean} showRepetitionOnCards                   — show rhythm chip on home cards
 * @property {boolean} showFlexibilityOnCards                  — show flexibility chip on home cards
 * @property {boolean} showTopicsOnCards                       — show topic labels on home cards
 * @property {boolean} showLocationOnCards                     — show location pin labels on home cards
 * @property {string} showAgendaTimesOnCards                   — agenda time on home cards: 'time' | 'icon' | 'hide'
 * @property {boolean} showTrailOnCards                        — show two-week activity dots on home cards
 * @property {boolean} showCueOnCards                          — show one-line status on home cards
 * @property {boolean} showOrderPillsOnCards                   — show before/after, doing-now, linked marks on home cards
 * @property {boolean} minimalMode                             — visual-only: emoji/title/cue/repetition on cards; stripped detail & overview
 * @property {boolean} showScheduledTasksInAgenda              — include fixed-time tasks in Today agenda
 * @property {boolean} showDueTasksInAgenda                    — include untimed tasks due today in Today agenda
 * @property {boolean} showPlannedItemsInAgenda                — include planned-today items in Today agenda
 * @property {boolean} showDueHabitsInAgenda                   — include ready habits in Today agenda
 * @property {boolean} showWeekOnHome                          — day-by-day week plan on home
 * @property {boolean} agendaOptimizer                         — default ILP packer for tight windows (lazy GLPK)
 * @property {{travel:number,cluster:number,day:number,asap:number,scarce:number,preference:number}} agendaScoreWeights — unified placement score weights
 * @property {boolean} reachAssist                             — pull-down-at-top gesture lowers first cards
 * @property {'keepup'|'reduce'|'zero'} defaultType            — type prefilled in the add-habit sheet
 * @property {number} defaultTarget                            — rhythm prefilled in the add-habit sheet
 * @property {string[]} topics                                 — master topic list (max 24)
 * @property {Location[]} locations                            — master location registry (max 32)
 * @property {Object<string,TravelEdge>} travel                — cached travel edges, keyed "idA|idB" (lexically ordered)
 * @property {'driving'|'walking'|'bicycling'|'transit'} defaultTravelMode — mode used for travel-time lookups
 * @property {string} prayerMethod                          — adhan.CalculationMethod key (default 'NorthAmerica')
 * @property {'shafi'|'hanafi'} prayerMadhab                — Asr school (default 'shafi')
 * @property {string|null} lastKnownLocationId                 — matched location id from the last geolocation fix (never stores raw coords)
 * @property {boolean} locationOptIn                           — user granted geolocation; used to resume watch on launch
 * @property {string|null} pinnedLocationId                    — manually-pinned "I am at" id; takes precedence over auto detection so a manual pick isn't immediately overwritten by the next GPS fix
 * @property {number[]} availabilityMinutes                    — legacy weekly minutes (Sun-Sat); unused for packing (default is full day / overrides)
 * @property {Object<string,number>} availabilityOverrides     — 'YYYY-MM-DD' -> minutes; wins over weekly
 * @property {{label:string,days:number[],start:number,end:number,locationId:?string,startAnchor:?string,startOffsetMin:number,startCombine:?string,startAnchor2:?string,startOffsetMin2:number,startFixedMin2:?number,startDayOffset:number,startDayOffset2:number,endAnchor:?string,endOffsetMin:number,endCombine:?string,endAnchor2:?string,endOffsetMin2:number,endFixedMin2:?number,endDayOffset:number,endDayOffset2:number}[]} blockedTimes — recurring unavailable blocks. Anchor fields mirror habits (prayer + fixed secondary; later/earlier-of + +1d supported).
 * @property {Object<string,string[]>} cancelledBlocks — day-key → cancelled block signatures for that date only
 * @property {string|null} calendarCreditHabitId — breakable habit hid that receives imported meeting minutes as progress credit; null = none
 * @property {'skip'|'tasks'} calendarAllDayMode — how PDF/calendar all-day events are imported: skip them, or land as dated untimed tasks
 * @property {2|3|7} completedTaskRetentionDays — auto-delete completed tasks older than this many days
 * @property {0|12|30|60} habitLogKeepCount — keep newest N actual logs per non-task habit (0 = off)
 * @property {number} lastRetentionCleanupAt — ms timestamp of last monthly auto cleanup (0 = never)
 */

/**
 * Day-of-week + day-of-month schedule pair returned by scheduledDays()/preferredDays().
 * Empty arrays mean "no restriction in this dimension".
 * @typedef {Object} DaySchedule
 * @property {number[]} weekdays    — 0=Sun … 6=Sat
 * @property {number[]} monthDays   — 1-31
 */

/**
 * A physical location. Entries live in the `locations` array on Settings.
 * Habits reference these by `id` via their `locationIds` field. The hours
 * fields reuse the exact encoding habits already use (minutes-from-midnight;
 * `allowedTimeEnd <= allowedTimeStart` means an overnight wrap). A location
 * with no hours fields is treated as open 24h every day.
 * @typedef {Object} Location
 * @property {string} id                    — stable opaque id, never user-displayed
 * @property {string} name                  — display name ("Home"), max 48 chars
 * @property {string} address               — optional human address, max 120 chars ('' when none)
 * @property {number} lat                   — WGS84 latitude, -90..90
 * @property {number} lng                   — WGS84 longitude, -180..180
 * @property {number} radiusM               — geofence radius in metres for "you are here" matching
 * @property {string} emoji                 — optional pin emoji ('' when none)
 * @property {number|null} allowedTimeStart — minutes-from-midnight, open-window start (null = no window / 24h)
 * @property {number|null} allowedTimeEnd   — minutes-from-midnight, open-window end (null = no window / 24h)
 * @property {number|null} preferredTimeStart — soft hint: best arrival-time start
 * @property {number|null} preferredTimeEnd   — soft hint: best arrival-time end
 * @property {number[]} closedDays          — weekday numbers (0=Sun..6=Sat) entirely closed, [] = none
 * @property {Object<string,{start:number,end:number}|null>} hoursByDay — per-weekday override {0..6:{start,end}|null}; absent day falls back to the default window
 */

/**
 * Cached travel time + distance between two locations. Stored in the `travel`
 * map on Settings, keyed `"${a}|${b}"` with the two ids lexically ordered so
 * A→B and B→A hit the same edge (routing is assumed symmetric in v1).
 * @typedef {Object} TravelEdge
 * @property {string} a          — location id (lexically smaller of the pair)
 * @property {string} b          — location id (lexically larger of the pair)
 * @property {number} seconds    — travel time in seconds
 * @property {number} metres     — travel distance in metres
 * @property {'osrm'|'google'|'haversine'|'manual'} provider — which provider produced this edge (manual = user override)
 * @property {number} fetchedAt  — ms timestamp of the fetch (used for TTL)
 */

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
    merged.minimalMode = Boolean(merged.minimalMode);
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
  sortSettings = next;
  Storage.write(SORT_SETTINGS_KEY, sortSettings);
}

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION — PURE (no I/O). Validates and coerces raw parsed JSON into
// the canonical Habit / Settings shapes declared above.
// ─────────────────────────────────────────────────────────────────────────

function normalize(items){
  const normalized = items.map(raw => {
    // Tasks and legacy events are now a single one-off type. Legacy 'event' records
    // migrate to 'task' with eventTime preserved (a timed task = appointment).
    let type = raw.type || 'keepup';
    const wasEvent = type === 'event';
    if(wasEvent)type = 'task';
    const eventTime = type === 'task' ? clampTimestamp(raw.eventTime) : null;
    let dueDate = type === 'task' ? clampDayTimestamp(raw.dueDate) : null;
    if(wasEvent && eventTime !== null && dueDate === null)dueDate = clampDayTimestamp(eventTime);
    const flexibilityDays = clampFlexibility(raw.flexibilityDays);
    // hardDue is now inferred: a task with a due date and no flexibility is a
    // firm deadline (escalates urgency past it and fires reminders). Any
    // flexibility > 0 means the deadline is soft.
    const hardDue = type === 'task' && dueDate !== null && flexibilityDays === 0;
    // autoMarkMinutes replaces the legacy markDone toggle. null/empty = manual;
    // a number = automatic logging with this delay. Breakables use planner
    // chunk ends; other items use their scheduled trigger. Legacy
    // markDone:false maps to 0 (auto at the trigger); legacy events do too.
    const legacyAuto = wasEvent || raw.markDone === false;
    const autoMarkMinutes = raw.autoMarkMinutes != null
      ? normalizeAutoMark(raw.autoMarkMinutes)
      : (legacyAuto ? 0 : null);
    const logs = normalizeLogs(raw.logs);
    // A past legacy event has already happened — record it as a completed entry so it
    // fades into history instead of nagging as an overdue task.
    if(wasEvent && eventTime !== null && eventTime < Date.now() && !logs.some(l=>logTime(l) === eventTime)){
      logs.push(eventTime);
    }
    // Location ids are de-duped here; the dangling-id sweep (dropping ids no
    // longer present in the registry) happens once at startup via
    // reconcileLocations(), after both habits and settings have loaded.
    const locationIds = normalizeLocationIds(raw.locationIds);
    const anywhereAllowed = raw.anywhereAllowed == null ? locationIds.length === 0 : Boolean(raw.anywhereAllowed);
    const locationPrefs = normalizeLocationPrefs(raw.locationPrefs, locationIds, raw.preferredLocationId);
    const preferredLocationId = primaryPreferredLocationId(locationPrefs, locationIds);
    const isRhythmHabit = type === 'keepup' || type === 'reduce';
    const breakable = Boolean(raw.breakable);
    // Stable habit id. Used by other habits' time anchors ("habit B's window opens
    // when habit A is logged"). Generated once on first normalize; legacy records
    // get one transparently so the feature can opt-in on any habit.
    const hid = cleanHabitId(raw.hid) || generateHabitId();
    const scheduleLinkMigration = normalizeScheduleLinksWithMigration(raw,hid);
    const h = {
      hid,
      name: raw.name || '',
      type,
      target: (type === 'zero' || type === 'task')
        ? null
        : clampRhythmValue(raw.target || 7),
      dueDate,
      hardDue,
      autoMarkMinutes,
      eventTime,
      planByDate: isRhythmHabit ? clampDayTimestamp(raw.planByDate) : null,
      createdAt: raw.createdAt || null,
      logs,
      emoji: raw.emoji || '',
      emojiBgColor:normalizeEmojiBgColor(raw.emojiBgColor),
      pinned:Boolean(raw.pinned),
      sample:Boolean(raw.sample),
      snoozedUntil: raw.snoozedUntil || null,
      topics:normalizeTopics(raw.topics),
      allowedWeekdays:normalizeAllowedWeekdays(raw.allowedWeekdays),
      allowedMonthDays:normalizeAllowedMonthDays(raw.allowedMonthDays),
      preferredWeekdays:normalizeAllowedWeekdays(raw.preferredWeekdays),
      preferredMonthDays:normalizeAllowedMonthDays(raw.preferredMonthDays),
      allowedTimeStart:normalizeTimeMinutes(raw.allowedTimeStart),
      allowedTimeEnd:normalizeTimeMinutes(raw.allowedTimeEnd),
      preferredTimeStart:normalizeTimeMinutes(raw.preferredTimeStart),
      preferredTimeEnd:normalizeTimeMinutes(raw.preferredTimeEnd),
      // cleanAnchor accepts prayer keys AND 'habit'. Falls back to cleanPrayerAnchor
      // only if prayer-times.js hasn't loaded yet (shouldn't happen at runtime).
      allowedTimeStartAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.allowedTimeStartAnchor) : cleanPrayerAnchor(raw.allowedTimeStartAnchor),
      allowedTimeStartOffsetMin:normalizePrayerOffset(raw.allowedTimeStartOffsetMin),
      allowedTimeEndAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.allowedTimeEndAnchor) : cleanPrayerAnchor(raw.allowedTimeEndAnchor),
      allowedTimeEndOffsetMin:normalizePrayerOffset(raw.allowedTimeEndOffsetMin),
      preferredTimeStartAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.preferredTimeStartAnchor) : cleanPrayerAnchor(raw.preferredTimeStartAnchor),
      preferredTimeStartOffsetMin:normalizePrayerOffset(raw.preferredTimeStartOffsetMin),
      preferredTimeEndAnchor:typeof cleanAnchor === 'function' ? cleanAnchor(raw.preferredTimeEndAnchor) : cleanPrayerAnchor(raw.preferredTimeEndAnchor),
      preferredTimeEndOffsetMin:normalizePrayerOffset(raw.preferredTimeEndOffsetMin),
      // Habit-id refs only stick when the matching anchor is actually 'habit'.
      allowedTimeStartAnchorHabitId:(raw.allowedTimeStartAnchor === 'habit' ? cleanHabitId(raw.allowedTimeStartAnchorHabitId) : '') || null,
      allowedTimeEndAnchorHabitId:(raw.allowedTimeEndAnchor === 'habit' ? cleanHabitId(raw.allowedTimeEndAnchorHabitId) : '') || null,
      preferredTimeStartAnchorHabitId:(raw.preferredTimeStartAnchor === 'habit' ? cleanHabitId(raw.preferredTimeStartAnchorHabitId) : '') || null,
      preferredTimeEndAnchorHabitId:(raw.preferredTimeEndAnchor === 'habit' ? cleanHabitId(raw.preferredTimeEndAnchorHabitId) : '') || null,
      scheduleLinks:scheduleLinkMigration.links,
      // Combined expressions (later/earlier of two) + optional +1d day shift.
      ...normalizeCombineFields(raw, 'allowedTimeStart'),
      ...normalizeCombineFields(raw, 'allowedTimeEnd'),
      ...normalizeCombineFields(raw, 'preferredTimeStart'),
      ...normalizeCombineFields(raw, 'preferredTimeEnd'),
      flexibilityDays,
      durationMinutes:clampDuration(raw.durationMinutes),
      breakable,
      minChunkMinutes:clampMinChunk(raw.minChunkMinutes),
      timerAutoStopMinutes:normalizeTimerAutoStop(raw.timerAutoStopMinutes),
      trackValue:Boolean(raw.trackValue),
      priority:clampPriority(raw.priority),
      locationIds,
      anywhereAllowed,
      locationPrefs,
      preferredLocationId,
      externalId: typeof raw.externalId === 'string' ? raw.externalId.slice(0,256) || null : null,
      source: (raw.source === 'pdf' || raw.source === 'msgraph' || raw.source === 'gcal') ? raw.source : null,
      importedAt: Number.isFinite(Number(raw.importedAt)) ? Number(raw.importedAt) : null
    };
    // Only zero-offset, uncombined start anchors have an exact planner-order
    // equivalent. Move those out of Dynamic timing; preserve all other habit
    // expressions as explicit legacy completion-trigger timing.
    for(const field of scheduleLinkMigration.migratedFields){
      h[field + 'Anchor'] = null;
      h[field + 'OffsetMin'] = 0;
      h[field + 'AnchorHabitId'] = null;
      h[field + 'Combine'] = null;
      h[field + 'Anchor2'] = null;
      h[field + 'OffsetMin2'] = 0;
      h[field + 'AnchorHabitId2'] = null;
      h[field + 'FixedMin2'] = null;
      h[field + 'DayOffset'] = 0;
      h[field + 'DayOffset2'] = 0;
    }
    // Migration: a degenerate 0/0 fixed window with no anchor is the signature
    // of the Number(null)===0 render bug in detail-view.js (an empty time
    // input rendered as "00:00" and got saved back as 0/0). hasTimeWindow
    // treated 0/0 as a valid 24h window, which silently shadowed rhythm
    // placement for affected habits. Collapse it back to "no window set".
    if(h.allowedTimeStart === 0 && h.allowedTimeEnd === 0
      && !h.allowedTimeStartAnchor && !h.allowedTimeEndAnchor){
      h.allowedTimeStart = null;
      h.allowedTimeEnd = null;
    }
    if(h.preferredTimeStart === 0 && h.preferredTimeEnd === 0
      && !h.preferredTimeStartAnchor && !h.preferredTimeEndAnchor){
      h.preferredTimeStart = null;
      h.preferredTimeEnd = null;
    }
    h.lastLog = latestActualLog(h.logs);
    return h;
  });
  const validHids = new Set(normalized.map(h=>h.hid));
  for(const h of normalized){
    h.scheduleLinks = normalizeScheduleLinks(h.scheduleLinks,h.hid)
      .filter(link=>validHids.has(link.anchorHid));
  }
  return normalized;
}

// PURE: true when this item has automatic logging enabled. Breakables use each
// captured agenda chunk end; other items keep their event/day trigger.
function isAutoMark(h){
  return Boolean(h) && h.autoMarkMinutes !== null;
}

// PURE: the effective "when" for a one-off task — its fixed time if set, else its due date. null = someday.
function taskWhen(h){
  if(h.type !== 'task')return null;
  return h.eventTime !== null ? h.eventTime : h.dueDate;
}
// PURE: a task with a fixed clock time (an appointment), as opposed to dated/someday.
function isTimedTask(h){
  return h.type === 'task' && h.eventTime !== null;
}
// PURE: one-off soft "plan by" date on a rhythm habit (keepup/reduce).
function habitPlanByDate(h){
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return null;
  return h.planByDate != null ? clampDayTimestamp(h.planByDate) : null;
}
// PURE: Sunday (or today if already Sunday) — handy "end of this week" preset.
function endOfWeekDate(now = Date.now()){
  const base = dayStart(now);
  const weekday = new Date(base).getDay();
  const add = weekday === 0 ? 0 : 7 - weekday;
  return base + add * 86400000;
}
// HYBRID-safe: clear a habit's one-off plan-by after an actual log fulfills it.
function clearPlanByDateOnLog(h){
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return;
  if(h.planByDate != null)h.planByDate = null;
}

function save(data){
  try{
    let next = normalize(data);
    let str = JSON.stringify(next);
    const kb = Math.round((str.length * 2) / 1024);
    if(kb >= QUOTA_HARD_KB){
      next = pruneForStorage(next,QUOTA_HARD_KB - 120);
      str = JSON.stringify(next);
    }
    Storage.writeRaw(KEY, str);
    bumpPlannerDataRevision();
    updateQuotaBar(sizeKb(next));
    return true;
  }catch(e){
    try{
      const pruned = pruneForStorage(normalize(data),QUOTA_HARD_KB - 360);
      const str = JSON.stringify(pruned);
      Storage.writeRaw(KEY, str);
      bumpPlannerDataRevision();
      updateQuotaBar(sizeKb(pruned));
      showToast('old dense activity compacted');
      return true;
    }catch{
      alert('storage full - remove some habits first');
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// BACKUP — export/import the full local dataset as a portable JSON file.
// Everything else in this app lives only in this browser's localStorage, so
// this is the sole way data survives clearing site data, a new phone, or a
// browser switch. Treat the shape as a small versioned contract.
// ─────────────────────────────────────────────────────────────────────────
const BACKUP_VERSION = 1;

// PURE: build a plain-object snapshot of everything worth backing up.
function buildBackup(){
  return {
    app:'tings',
    version:BACKUP_VERSION,
    exportedAt:Date.now(),
    habits:load(),
    settings:loadSortSettings()
  };
}

// PURE: validate a parsed backup payload (accepts either the wrapped
// {habits,settings} shape or a bare habits array from an older export).
// Returns {ok:true,habits,settings} or {ok:false,reason}.
function parseBackup(raw){
  let obj;
  try{ obj = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch{ return {ok:false,reason:'That file is not valid JSON.'}; }
  if(!obj || typeof obj !== 'object')return {ok:false,reason:'That file is not a valid backup.'};
  const habitsRaw = Array.isArray(obj.habits) ? obj.habits : (Array.isArray(obj) ? obj : null);
  if(!habitsRaw)return {ok:false,reason:'No habits found in that file.'};
  let habits;
  try{ habits = normalize(habitsRaw); }
  catch{ return {ok:false,reason:'That file could not be read as habits.'}; }
  const settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : null;
  return {ok:true,habits,settings};
}

// HYBRID: replace all local data with a validated backup. Returns
// {ok:true,count} or {ok:false,reason}.
function restoreBackup(raw){
  const parsed = parseBackup(raw);
  if(!parsed.ok)return parsed;
  const trimmed = parsed.habits.slice(0,MAX_TINGS);
  if(!save(trimmed))return {ok:false,reason:'Could not save that backup on this device.'};
  if(parsed.settings)saveSortSettings(parsed.settings);
  return {ok:true,count:trimmed.length};
}

// Ephemeral agenda commitments used by breakable auto-log. This is kept out of
// the habit backup intentionally: it is a device-local snapshot of what this
// particular agenda showed, not user-authored history.
const AUTO_CHUNK_PLAN_KEY = 'tings_auto_chunk_plans_v1';

function loadAutoChunkPlans(){
  const raw = Storage.read(AUTO_CHUNK_PLAN_KEY);
  if(!raw || typeof raw !== 'object' || !raw.groups || typeof raw.groups !== 'object')return {groups:{}};
  return {groups:raw.groups};
}

function saveAutoChunkPlans(plans){
  const next = plans && plans.groups ? plans : {groups:{}};
  const current = Storage.read(AUTO_CHUNK_PLAN_KEY);
  if(JSON.stringify(current || {groups:{}}) === JSON.stringify(next))return false;
  try{ Storage.write(AUTO_CHUNK_PLAN_KEY,next); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

const TODAY_SUGGESTED_KEY = 'tings_today_suggested_v1';

// Temporary same-day agenda precedence links (device-local; not in habit backup).
// dayBase → edges; each edge says beforeHid should be planned before afterHid that day.
const ORDER_CONSTRAINTS_KEY = 'tings_order_constraints_v1';

/**
 * @typedef {Object} OrderConstraint
 * @property {string} id
 * @property {number} dayBase
 * @property {string} beforeHid
 * @property {string} afterHid
 * @property {'sometime'|'direct'} adjacency
 * @property {number} createdAt
 */

/**
 * @typedef {Object} DoingNowState
 * @property {string} hid
 * @property {number} startedAt
 * @property {number} dayBase
 * @property {number} sessionMinutes — snapshotted target length at start
 * @property {number} targetAt — startedAt + sessionMinutes
 * @property {number|null} endsAt — auto-complete deadline; null for manual sessions
 * @property {'manual'|'auto'} completionMode
 * @property {boolean} oneShotAutoMark — compatibility mirror of completionMode
 */

function yesterdayIso(){
  return dateKey(Date.now() - 86400000);
}

function newOrderConstraintId(){
  return `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

function normalizeOrderAdjacency(raw){
  return raw === 'direct' ? 'direct' : 'sometime';
}

function normalizeOrderConstraint(raw){
  if(!raw || typeof raw !== 'object')return null;
  const dayBase = clampDayTimestamp(raw.dayBase);
  const beforeHid = typeof raw.beforeHid === 'string' ? raw.beforeHid.trim() : '';
  const afterHid = typeof raw.afterHid === 'string' ? raw.afterHid.trim() : '';
  if(dayBase == null || !beforeHid || !afterHid || beforeHid === afterHid)return null;
  return {
    id:typeof raw.id === 'string' && raw.id ? raw.id : newOrderConstraintId(),
    dayBase,
    beforeHid,
    afterHid,
    adjacency:normalizeOrderAdjacency(raw.adjacency),
    createdAt:Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now()
  };
}

/** PURE: minutes to run for a doing-now session (snapshotted at confirm). */
function doingNowSessionMinutesFor(h,now = Date.now()){
  if(!h)return typeof DEFAULT_DURATION_MINUTES === 'number' ? DEFAULT_DURATION_MINUTES : 30;
  if(h.breakable && typeof remainingDurationMinutes === 'function'){
    const left = remainingDurationMinutes(h,dayStart(now));
    if(left > 0)return left;
  }
  return clampDuration(h.durationMinutes);
}

function normalizeDoingNow(raw,todayBase = dayStart(Date.now())){
  if(!raw || typeof raw !== 'object')return null;
  const hid = typeof raw.hid === 'string' ? raw.hid.trim() : '';
  const dayBase = clampDayTimestamp(raw.dayBase);
  const startedAt = Number(raw.startedAt);
  if(!hid || dayBase == null || !Number.isFinite(startedAt))return null;
  if(dayBase !== todayBase)return null;
  const sessionMinutes = Math.max(1,Math.min(720,Math.round(Number(raw.sessionMinutes) || 0) || 30));
  // Records written before completionMode existed are intentionally restored
  // as manual. That safe migration prevents an old timer from unexpectedly
  // logging a habit after the app updates.
  const completionMode = raw.completionMode === 'auto' ? 'auto' : 'manual';
  const targetAt = Number.isFinite(Number(raw.targetAt))
    ? Number(raw.targetAt)
    : Number.isFinite(Number(raw.endsAt))
    ? Number(raw.endsAt)
    : startedAt + sessionMinutes * 60000;
  const endsAt = completionMode === 'auto' ? targetAt : null;
  return {
    hid,
    startedAt,
    dayBase,
    sessionMinutes,
    targetAt,
    endsAt,
    completionMode,
    oneShotAutoMark:completionMode === 'auto'
  };
}

function loadOrderConstraintStore(now = Date.now()){
  const raw = Storage.read(ORDER_CONSTRAINTS_KEY);
  const todayBase = dayStart(now);
  const edges = [];
  const seen = new Set();
  const list = raw && Array.isArray(raw.edges) ? raw.edges
    : (raw && raw.byDay && typeof raw.byDay === 'object'
      ? Object.values(raw.byDay).flatMap(v=>Array.isArray(v) ? v : [])
      : []);
  for(const item of list){
    const edge = normalizeOrderConstraint(item);
    if(!edge)continue;
    if(edge.dayBase < todayBase)continue; // past days drop
    const key = `${edge.dayBase}|${edge.beforeHid}|${edge.afterHid}`;
    if(seen.has(key))continue;
    seen.add(key);
    edges.push(edge);
  }
  const doingNow = normalizeDoingNow(raw && raw.doingNow,todayBase);
  return {edges,doingNow};
}

function saveOrderConstraintStore(store){
  const next = {
    edges:Array.isArray(store && store.edges) ? store.edges.map(normalizeOrderConstraint).filter(Boolean) : [],
    doingNow:store && store.doingNow ? normalizeDoingNow(store.doingNow) : null
  };
  const current = Storage.read(ORDER_CONSTRAINTS_KEY);
  if(JSON.stringify(current || {edges:[],doingNow:null}) === JSON.stringify(next))return false;
  try{ Storage.write(ORDER_CONSTRAINTS_KEY,next); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

function orderConstraintsForDay(dayBase,store = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const src = store || loadOrderConstraintStore();
  return (src.edges || []).filter(e=>e.dayBase === base);
}

// PURE: recurring Schedule relationships expressed as the same directed edge
// shape used by one-day reorder. They are intentionally not stored in the
// device-local reorder store.
function persistentOrderConstraintsForDay(dayBase,data = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const items = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  const valid = new Set(items.filter(Boolean).map(h=>cleanHabitId(h.hid)).filter(Boolean));
  const edges = [];
  for(const h of items){
    const subjectHid = cleanHabitId(h && h.hid);
    if(!subjectHid)continue;
    const links = normalizeScheduleLinks(h.scheduleLinks,subjectHid);
    links.forEach((link,linkIdx)=>{
      if(!link || !valid.has(link.anchorHid))return;
      const direction = link.direction;
      edges.push({
        id:`schedule:${subjectHid}:${direction}:${link.anchorHid}:${linkIdx}`,
        dayBase:base,
        beforeHid:direction === 'before' ? subjectHid : link.anchorHid,
        afterHid:direction === 'before' ? link.anchorHid : subjectHid,
        adjacency:link.adjacency,
        persistent:true,
        requiresPair:link.requireSameDay,
        requireSameDay:link.requireSameDay,
        subjectHid,
        anchorHid:link.anchorHid,
        direction
      });
    });
  }
  return edges;
}

// IMPURE by default (reads saved habits): the planner-facing edge set. A
// persistent relationship wins over a contradictory stale one-day edge.
function agendaOrderConstraintsForDay(dayBase,data = null,store = null){
  const merged = persistentOrderConstraintsForDay(dayBase,data).map(edge=>({...edge}));
  for(const edge of orderConstraintsForDay(dayBase,store)){
    const same = merged.find(item=>item.beforeHid === edge.beforeHid && item.afterHid === edge.afterHid);
    if(same){
      // A compatible one-day drag may strengthen recurring "before" to
      // "right before" for this date, and retains reorder's explicit pair.
      if(edge.adjacency === 'direct')same.adjacency = 'direct';
      same.requiresPair = true;
      same.temporaryUpgrade = true;
      continue;
    }
    const reverse = merged.some(item=>item.beforeHid === edge.afterHid && item.afterHid === edge.beforeHid);
    if(reverse)continue;
    merged.push({...edge,persistent:false,requiresPair:true});
  }
  return merged;
}

function getDoingNow(store = null){
  const src = store || loadOrderConstraintStore();
  return src.doingNow || null;
}

/** PURE: whether this active-focus session auto-completes at its target. */
function doingNowAutoCompletes(doing){
  return Boolean(doing && doing.completionMode === 'auto');
}

/** True while a doing-now session is active. Manual sessions do not expire. */
function isDoingNowActive(doing = null,now = Date.now()){
  const d = doing || getDoingNow();
  if(!d || !d.hid)return false;
  if(d.dayBase !== dayStart(now))return false;
  if(doingNowAutoCompletes(d) && Number.isFinite(d.endsAt) && now >= d.endsAt)return false;
  return true;
}

/**
 * Start an active-focus session. opts.sessionMinutes snapshots the target
 * duration at start. Manual is the safe default; auto mode completes once
 * when the target passes.
 * dayBase must be today's calendar day; startedAt may be earlier (even
 * before midnight) so expired sessions near day boundaries still sweep.
 */
function setDoingNow(hid,startedAt = Date.now(),dayBase = dayStart(Date.now()),opts = {}){
  const todayBase = dayStart(Date.now());
  const nextDay = clampDayTimestamp(dayBase);
  if(!hid || nextDay !== todayBase)return null;
  const start = Number(startedAt) || Date.now();
  const sessionMinutes = Math.max(1,Math.min(720,Math.round(Number(opts.sessionMinutes) || 0) || 30));
  const completionMode = opts.completionMode === 'auto'
    || (opts.completionMode == null && opts.oneShotAutoMark === true)
    ? 'auto'
    : 'manual';
  const targetAt = Number.isFinite(Number(opts.targetAt))
    ? Number(opts.targetAt)
    : Number.isFinite(Number(opts.endsAt))
      ? Number(opts.endsAt)
    : start + sessionMinutes * 60000;
  const store = loadOrderConstraintStore();
  store.doingNow = {
    hid:String(hid),
    startedAt:start,
    dayBase:todayBase,
    sessionMinutes,
    targetAt,
    endsAt:completionMode === 'auto' ? targetAt : null,
    completionMode,
    oneShotAutoMark:completionMode === 'auto'
  };
  saveOrderConstraintStore(store);
  return store.doingNow;
}

function clearDoingNow(hid = null){
  const store = loadOrderConstraintStore();
  if(!store.doingNow)return false;
  if(hid != null && store.doingNow.hid !== hid)return false;
  store.doingNow = null;
  return saveOrderConstraintStore(store);
}

/** Upsert one day-scoped edge; replaces any existing same before→after that day. */
function upsertOrderConstraint({dayBase,beforeHid,afterHid,adjacency = 'sometime'}){
  const edge = normalizeOrderConstraint({
    id:newOrderConstraintId(),
    dayBase,
    beforeHid,
    afterHid,
    adjacency,
    createdAt:Date.now()
  });
  if(!edge)return null;
  const store = loadOrderConstraintStore();
  store.edges = (store.edges || []).filter(e=>!(
    e.dayBase === edge.dayBase && e.beforeHid === edge.beforeHid && e.afterHid === edge.afterHid
  ));
  store.edges.push(edge);
  saveOrderConstraintStore(store);
  return edge;
}

/** Write the chosen edges for a drop; replaces same-day pairs among touched hids. */
function saveOrderConstraintsForDrop(dayBase,edges){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const store = loadOrderConstraintStore();
  const incoming = (edges || []).map(e=>normalizeOrderConstraint({...e,dayBase:base})).filter(Boolean);
  const touch = new Set();
  for(const e of incoming){
    touch.add(e.beforeHid);
    touch.add(e.afterHid);
  }
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(!touch.size)return true;
    // Replace any prior same-day edge that touches the moved cluster pairs.
    return !(touch.has(e.beforeHid) && touch.has(e.afterHid));
  });
  for(const e of incoming)store.edges.push(e);
  saveOrderConstraintStore(store);
  return incoming;
}

function removeOrderConstraint(id){
  if(!id)return false;
  const store = loadOrderConstraintStore();
  const next = (store.edges || []).filter(e=>e.id !== id);
  if(next.length === store.edges.length)return false;
  store.edges = next;
  return saveOrderConstraintStore(store);
}

function clearOrderConstraintsForHid(hid){
  if(!hid)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  const beforeDoing = store.doingNow;
  store.edges = (store.edges || []).filter(e=>e.beforeHid !== hid && e.afterHid !== hid);
  if(store.doingNow && store.doingNow.hid === hid)store.doingNow = null;
  if(store.edges.length === beforeLen && store.doingNow === beforeDoing)return false;
  return saveOrderConstraintStore(store);
}

function clearOrderConstraintsForDay(dayBase,hid = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  const beforeDoing = store.doingNow;
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(hid == null)return false;
    return e.beforeHid !== hid && e.afterHid !== hid;
  });
  if(store.doingNow && store.doingNow.dayBase === base && (hid == null || store.doingNow.hid === hid)){
    store.doingNow = null;
  }
  if(store.edges.length === beforeLen && store.doingNow === beforeDoing)return false;
  return saveOrderConstraintStore(store);
}

/** Clear only reorder edges for a day, preserving an active doing-now session. */
function clearOrderEdgesForDay(dayBase,hid = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(hid == null)return false;
    return e.beforeHid !== hid && e.afterHid !== hid;
  });
  return store.edges.length !== beforeLen ? saveOrderConstraintStore(store) : false;
}

/** Drop edges / doing-now when a habit completes or is deleted. */
function pruneOrderConstraintsForHabit(h,data = null,now = Date.now()){
  if(!h || !h.hid)return false;
  const store = loadOrderConstraintStore(now);
  const todayBase = dayStart(now);
  let changed = false;
  const done = h.type === 'task'
    ? (typeof isTaskDone === 'function' ? isTaskDone(h) : Boolean(h.lastLog))
    : completedToday(h,now);
  const stillExists = Array.isArray(data) ? data.some(item=>item && item.hid === h.hid) : true;
  const shouldDrop = !stillExists || done;
  if(!shouldDrop && !(store.doingNow && store.doingNow.hid === h.hid))return false;
  const nextEdges = (store.edges || []).filter(e=>{
    if(e.beforeHid !== h.hid && e.afterHid !== h.hid)return true;
    if(!stillExists){ changed = true; return false; }
    if(done){
      // Tasks are one-shot: drop every day. Rhythm habits only drop today/past.
      if(h.type === 'task' || e.dayBase <= todayBase){ changed = true; return false; }
    }
    return true;
  });
  if(nextEdges.length !== store.edges.length){
    store.edges = nextEdges;
    changed = true;
  }
  if(store.doingNow && store.doingNow.hid === h.hid && (done || !stillExists)){
    store.doingNow = null;
    changed = true;
  }
  return changed ? saveOrderConstraintStore(store) : false;
}

function pruneOrderConstraintsOnLog(h,now = Date.now()){
  return pruneOrderConstraintsForHabit(h,null,now);
}

function orderConstraintsForHid(hid,store = null){
  if(!hid)return [];
  const src = store || loadOrderConstraintStore();
  return (src.edges || []).filter(e=>e.beforeHid === hid || e.afterHid === hid);
}

function habitHasOrderConstraints(hid,store = null){
  return orderConstraintsForHid(hid,store).length > 0;
}

function orderConstraintPillsForHid(hid,dayBase,data = null,store = null){
  if(!hid)return [];
  const edges = agendaOrderConstraintsForDay(dayBase,data,store);
  const findOther = (otherHid)=>{
    if(!Array.isArray(data))return null;
    return data.find(item=>item && item.hid === otherHid) || null;
  };
  const nameOf = (other)=>{
    const hit = findOther(other);
    return hit ? hit.name : other;
  };
  const pills = [];
  for(const e of edges){
    if(e.afterHid === hid){
      const other = findOther(e.beforeHid);
      pills.push({
        id:e.id,
        kind:'after',
        adjacency:e.adjacency,
        otherHid:e.beforeHid,
        otherEmoji:other && other.emoji ? String(other.emoji).trim() : '',
        otherBg:normalizeEmojiBgColor(other && other.emojiBgColor),
        otherName:nameOf(e.beforeHid),
        dayBase:e.dayBase,
        persistent:Boolean(e.persistent),
        label:(e.adjacency === 'direct' ? `right after ${nameOf(e.beforeHid)}` : `after ${nameOf(e.beforeHid)}`)
          + (e.persistent ? ' · recurring' : '')
      });
    }
    if(e.beforeHid === hid){
      const other = findOther(e.afterHid);
      pills.push({
        id:e.id,
        kind:'before',
        adjacency:e.adjacency,
        otherHid:e.afterHid,
        otherEmoji:other && other.emoji ? String(other.emoji).trim() : '',
        otherBg:normalizeEmojiBgColor(other && other.emojiBgColor),
        otherName:nameOf(e.afterHid),
        dayBase:e.dayBase,
        persistent:Boolean(e.persistent),
        label:(e.adjacency === 'direct' ? `right before ${nameOf(e.afterHid)}` : `before ${nameOf(e.afterHid)}`)
          + (e.persistent ? ' · recurring' : '')
      });
    }
  }
  return pills;
}

// PURE: validate the complete persistent graph after applying an in-flight
// edit. Returns a concise user-facing error rather than silently saving a
// relationship the planners cannot honor.
function validateScheduleLinkGraph(items){
  const data = Array.isArray(items) ? items : [];
  const byHid = new Map(data.filter(Boolean).map(h=>[cleanHabitId(h.hid),h]));
  const edges = [];
  for(const h of data){
    const subject = cleanHabitId(h && h.hid);
    if(!subject)continue;
    const links = normalizeScheduleLinks(h.scheduleLinks,subject);
    const seenAnchors = new Map(); // anchorHid → direction
    for(const link of links){
      if(!link)continue;
      const prevDir = seenAnchors.get(link.anchorHid);
      if(prevDir && prevDir !== link.direction){
        const name = byHid.get(link.anchorHid)?.name || 'that habit';
        return {ok:false,message:`choose either before or after ${name}, not both`};
      }
      if(prevDir === link.direction){
        const name = byHid.get(link.anchorHid)?.name || 'that habit';
        return {ok:false,message:`${name} is already linked`};
      }
      seenAnchors.set(link.anchorHid,link.direction);
      const anchor = byHid.get(link.anchorHid);
      if(!anchor)return {ok:false,message:'one linked habit no longer exists'};
      edges.push({
        beforeHid:link.direction === 'before' ? subject : link.anchorHid,
        afterHid:link.direction === 'before' ? link.anchorHid : subject,
        adjacency:link.adjacency
      });
    }
  }

  const next = new Map();
  const directNext = new Map();
  for(const edge of edges){
    if(!next.has(edge.beforeHid))next.set(edge.beforeHid,new Set());
    next.get(edge.beforeHid).add(edge.afterHid);
    if(edge.adjacency !== 'direct')continue;
    // One habit may have only one right-after successor (two movable cards
    // cannot both sit immediately after the same parent). Multiple right-before
    // parents are allowed and OR'd on the subject (shower after exercise OR haircut).
    if(directNext.has(edge.beforeHid) && directNext.get(edge.beforeHid) !== edge.afterHid){
      const name = byHid.get(edge.beforeHid)?.name || 'a habit';
      return {ok:false,message:`${name} already has a right-after habit`};
    }
    directNext.set(edge.beforeHid,edge.afterHid);
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = hid=>{
    if(visiting.has(hid))return true;
    if(visited.has(hid))return false;
    visiting.add(hid);
    for(const child of next.get(hid) || []){
      if(walk(child))return true;
    }
    visiting.delete(hid);
    visited.add(hid);
    return false;
  };
  for(const hid of byHid.keys()){
    if(walk(hid))return {ok:false,message:'habit order creates a cycle'};
  }
  return {ok:true,message:''};
}

// PURE: whether a proposed temporary edge contradicts a recurring link.
function temporaryOrderConflict(dayBase,edges,data = null){
  const permanent = persistentOrderConstraintsForDay(dayBase,data);
  const graph = new Set(permanent.map(e=>`${e.beforeHid}>${e.afterHid}`));
  for(const edge of edges || []){
    if(graph.has(`${edge.afterHid}>${edge.beforeHid}`)){
      return permanent.find(e=>e.beforeHid === edge.afterHid && e.afterHid === edge.beforeHid) || null;
    }
  }
  return null;
}

function dataFingerprint(data){
  return data.map(h=>[h.hid,h.lastLog,h.snoozedUntil,h.target,h.allowedWeekdays,h.allowedTimeStart,h.allowedTimeEnd,h.dueDate,h.planByDate,JSON.stringify(h.scheduleLinks || [])].join(':')).join('|');
}

function loadTodaySuggested(){
  const raw = Storage.read(TODAY_SUGGESTED_KEY);
  const today = todayIso();
  if(!raw || typeof raw !== 'object' || typeof raw.hids !== 'object')
    return {day:today,hids:{},projection:null,prevProjection:null};
  if(raw.day === today)return raw;
  if(raw.day === yesterdayIso())
    return {day:today,hids:{},projection:raw.projection || null,prevProjection:raw.projection || null};
  return {day:today,hids:{},projection:null,prevProjection:null};
}

function saveTodaySuggested(snapshot){
  const current = Storage.read(TODAY_SUGGESTED_KEY);
  if(JSON.stringify(current) === JSON.stringify(snapshot))return false;
  try{ Storage.write(TODAY_SUGGESTED_KEY,snapshot); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

function recordTodaySuggested(data,currentHids,now = Date.now(),projectionHids = null,fingerprint = null){
  const snap = loadTodaySuggested();
  let changed = false;
  const validHids = new Set(data.filter(h=>h && h.hid).map(h=>h.hid));
  for(const hid of Object.keys(snap.hids)){
    if(!validHids.has(hid)){ delete snap.hids[hid]; changed = true; }
  }
  for(const hid of currentHids){
    if(!snap.hids[hid]){
      const h = data.find(item=>item && item.hid === hid);
      snap.hids[hid] = {first:now,name:h ? h.name : ''};
      changed = true;
    }
  }
  if(projectionHids && fingerprint){
    const tomorrow = dateKey(now + 86400000);
    if(!snap.projection || snap.projection.day !== tomorrow || snap.projection.fingerprint !== fingerprint){
      snap.projection = {day:tomorrow,hids:projectionHids,fingerprint};
      changed = true;
    }
  }
  delete snap.prevProjection;
  if(changed)saveTodaySuggested(snap);
  return snap;
}

function completedToday(h,now = Date.now()){
  if(!h)return false;
  if(h.type === 'task')return isTaskDone(h);
  // A breakable habit is only "done" when its full daily budget is met — a
  // partial chunk log must not hide the card from the home list.
  if(h.breakable && typeof breakableProgressMinutes === 'function'
    && typeof breakableTotalMinutes === 'function'){
    const base = dayStart(now);
    const total = breakableTotalMinutes(h);
    return total > 0 && breakableProgressMinutes(h,base) >= total;
  }
  const start = dayStart(now);
  const end = start + 86400000;
  return actualLogs(h.logs).some(ts=>ts >= start && ts < end);
}

/**
 * PURE: day-scoped sibling of completedToday. The agenda asks this before it
 * offers work, so a habit the logs already show as finished for `dayBase`
 * stays off the plan even when a stale plan entry for that day survives (one
 * tap only consumes a single plan, and a habit can be planned more than once
 * a day by different order links).
 */
function completedOnDay(h,dayBase){
  if(!h)return false;
  if(h.type === 'task')return isTaskDone(h);
  const start = dayStart(dayBase != null ? dayBase : Date.now());
  if(h.breakable && typeof breakableProgressMinutes === 'function'
    && typeof breakableTotalMinutes === 'function'){
    const total = breakableTotalMinutes(h);
    return total > 0 && breakableProgressMinutes(h,start) >= total;
  }
  const end = start + 86400000;
  return actualLogs(h.logs).some(ts=>ts >= start && ts < end);
}

function autoChunkPlanScope(h,dayBase){
  if(!h || !h.hid)return null;
  return h.type === 'task' ? `task:${h.hid}` : `day:${h.hid}:${dateKey(dayBase)}`;
}

/**
 * HYBRID: remember future breakable rows that the agenda actually presented.
 * Rows that have already started stay stable while future rows follow replans.
 * A cold open never invents credit for work that was never shown to the user.
 */
function syncAutoMarkChunkPlans(data,week,now = Date.now()){
  if(!Array.isArray(data) || !week || !Array.isArray(week.days))return false;
  const plans = loadAutoChunkPlans();
  const current = new Map();
  const autoHids = new Set(data.filter(h=>h && h.breakable && isAutoMark(h)).map(h=>h.hid));

  week.days.forEach(day=>{
    const dayBase = day && day.dayBase != null ? day.dayBase : dayStart(now);
    (day && Array.isArray(day.timeline) ? day.timeline : []).forEach(row=>{
      if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled') || row.i == null)return;
      const h = data[row.i];
      if(!h || !h.breakable || !isAutoMark(h) || !h.hid)return;
      const scope = autoChunkPlanScope(h,dayBase);
      if(!scope)return;
      if(!current.has(scope))current.set(scope,{hid:h.hid,type:h.type,dayBase:h.type === 'task' ? null : dayBase,total:breakableTotalMinutes(h),rows:[]});
      current.get(scope).rows.push({
        start:Number(row.start) || 0,
        end:Number(row.end) || 0,
        minutes:Math.max(1,Math.round(Number(row.chunkMinutes) || ((Number(row.end) - Number(row.start)) / 60000) || 1))
      });
    });
  });

  const staleBefore = now - 8 * 86400000;
  for(const [scope,group] of Object.entries(plans.groups)){
    if(!group || !autoHids.has(group.hid)){ delete plans.groups[scope]; continue; }
    const retained = Array.isArray(group.rows)
      ? group.rows.filter(row=>Number(row.end) >= staleBefore && Number(row.start) <= now)
      : [];
    if(retained.length)plans.groups[scope] = {...group,rows:retained};
    else if(!current.has(scope))delete plans.groups[scope];
  }

  for(const [scope,nextGroup] of current){
    const h = data.find(item=>item && item.hid === nextGroup.hid);
    if(!h)continue;
    const old = plans.groups[scope];
    const preserved = old && Array.isArray(old.rows)
      ? old.rows.filter(row=>Number(row.start) <= now && Number(row.end) >= staleBefore)
      : [];
    const dayBase = nextGroup.dayBase != null ? nextGroup.dayBase : dayStart(now);
    const done = breakableProgressMinutes(h,dayBase);
    let target = Math.max(done,...preserved.map(row=>Math.max(0,Number(row.targetMinutes) || 0)));
    const total = breakableTotalMinutes(h);
    const preservedKeys = new Set(preserved.map(row=>`${row.start}:${row.end}`));
    const future = nextGroup.rows
      .filter(row=>row.end > now && row.end > row.start && !preservedKeys.has(`${row.start}:${row.end}`))
      .sort((a,b)=>a.start - b.start)
      .map(row=>{
        const amount = Math.max(0,Math.min(row.minutes,total - target));
        target += amount;
        return {...row,targetMinutes:target};
      })
      .filter(row=>row.targetMinutes > done);
    const rows = [...preserved,...future]
      .sort((a,b)=>a.end - b.end)
      .filter((row,index,all)=>index === 0 || row.start !== all[index - 1].start || row.end !== all[index - 1].end);
    if(rows.length)plans.groups[scope] = {...nextGroup,total,rows};
    else delete plans.groups[scope];
  }
  return saveAutoChunkPlans(plans);
}

/**
 * HYBRID: credit every due planner chunk up to its stored cumulative target.
 * Manual logs made before the deadline already count toward that target, so a
 * later sweep adds only the uncovered minutes. Due rows are removed once read,
 * making foreground and interval sweeps idempotent.
 */
function sweepAutoMarkedBreakableChunks(now = Date.now(),opts = {}){
  const plans = loadAutoChunkPlans();
  const data = load();
  let changedData = false;
  let changedPlans = false;
  let credited = 0;
  const completedSigs = [];

  for(const [scope,group] of Object.entries(plans.groups)){
    const h = data.find(item=>item && item.hid === group.hid);
    if(!h || !h.breakable || !isAutoMark(h)){
      delete plans.groups[scope];
      changedPlans = true;
      continue;
    }
    const delayMs = Math.max(0,Number(h.autoMarkMinutes) || 0) * 60000;
    const rows = Array.isArray(group.rows) ? group.rows.slice().sort((a,b)=>a.end - b.end) : [];
    const keep = [];
    for(const row of rows){
      const dueAt = Number(row.end) + delayMs;
      if(!Number.isFinite(dueAt) || dueAt > now){ keep.push(row); continue; }
      const dayBase = h.type === 'task' ? dayStart(now) : (group.dayBase != null ? group.dayBase : dayStart(row.end));
      const done = breakableProgressMinutes(h,dayBase);
      const target = Math.max(0,Math.min(breakableTotalMinutes(h),Math.round(Number(row.targetMinutes) || 0)));
      const delta = Math.max(0,target - done);
      if(delta > 0){
        const rawLogTs = Math.min(now,Math.max(1,Number(row.end) || dueAt));
        const logTs = h.type === 'task' ? rawLogTs : snapLogTimestamp(h,rawLogTs);
        h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(logTs,{minutes:delta,note:'agenda auto-log'})]);
        h.lastLog = latestActualLog(h.logs);
        h.snoozedUntil = null;
        clearPlanByDateOnLog(h);
        if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
        changedData = true;
        credited += 1;
      }
      changedPlans = true;
    }
    if(keep.length)plans.groups[scope] = {...group,rows:keep};
    else delete plans.groups[scope];
    if(h.type === 'task' && isTaskDone(h) && typeof reminderSignature === 'function')completedSigs.push(reminderSignature(h));
  }

  if(changedData)save(data);
  if(changedPlans)saveAutoChunkPlans(plans);
  if(changedData && typeof cancelPush === 'function')completedSigs.forEach(sig=>cancelPush(sig));
  if(changedData && opts.refresh !== false && typeof refreshOpenViews === 'function')refreshOpenViews();
  if(changedData && opts.toast !== false && typeof showToast === 'function'){
    showToast(credited === 1 ? 'agenda chunk auto-logged' : `${credited} agenda chunks auto-logged`);
  }
  return credited;
}

// HYBRID: auto-complete event-style items (markDone === false) whose time has
// passed. Two shapes: timed tasks (log at eventTime) and scheduled build-habits
// (log each passed scheduled weekday/monthday day). Adds completion logs,
// cancels scheduled pushes for tasks, and re-renders. Idempotent — safe on a
// timer. Returns the number of items it completed.
function effectiveAutoMarkTrigger(h,now = Date.now()){
  if(!h)return null;
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  if(doing && doing.hid === h.hid && doing.dayBase === dayStart(now)
    && doingNowAutoCompletes(doing)){
    return doing.startedAt;
  }
  if(h.type === 'task'){
    return h.eventTime ?? (h.dueDate !== null
      ? dayStart(h.dueDate) - (h.flexibilityDays || 0) * 86400000
      : null);
  }
  return null;
}

/** PURE: end of a doing-now one-shot auto window (startedAt + session). */
function doingNowAutoMarkDeadline(doing){
  if(!doing || !doingNowAutoCompletes(doing))return null;
  if(Number.isFinite(doing.endsAt))return doing.endsAt;
  if(Number.isFinite(doing.targetAt))return doing.targetAt;
  const mins = Math.max(1,Number(doing.sessionMinutes) || 30);
  return Number(doing.startedAt) + mins * 60000;
}

/**
 * HYBRID: when a doing-now one-shot session has reached endsAt, auto-log once
 * even if the habit is normally manual. Clears doing-now afterward.
 */
function sweepDoingNowOneShot(now = Date.now(),opts = {}){
  const doing = getDoingNow();
  if(!doingNowAutoCompletes(doing))return 0;
  const deadline = doingNowAutoMarkDeadline(doing);
  if(!Number.isFinite(deadline) || deadline > now)return 0;
  const data = load();
  const h = data.find(item=>item && item.hid === doing.hid);
  if(!h){
    clearDoingNow();
    return 0;
  }
  if(h.type === 'task' && isTaskDone(h)){
    clearDoingNow(h.hid);
    return 0;
  }
  if(h.type !== 'task' && completedToday(h,now)){
    clearDoingNow(h.hid);
    return 0;
  }

  let changed = false;
  const sessionMins = Math.max(1,Number(doing.sessionMinutes) || 30);
  if(h.breakable){
    const dayBase = h.type === 'task' ? dayStart(now) : (doing.dayBase || dayStart(now));
    const left = typeof breakableBudgetMinutes === 'function' ? breakableBudgetMinutes(h,dayBase) : sessionMins;
    const delta = Math.max(0,Math.min(sessionMins,left));
    if(delta > 0){
      const logTs = Math.min(now,Math.max(doing.startedAt,deadline));
      const snapped = h.type === 'task' ? logTs : (typeof snapLogTimestamp === 'function' ? snapLogTimestamp(h,logTs) : logTs);
      h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(snapped,{minutes:delta,note:'doing-now auto-log'})]);
      h.lastLog = latestActualLog(h.logs);
      h.snoozedUntil = null;
      clearPlanByDateOnLog(h);
      changed = true;
    }
  }else{
    const logTs = Math.min(now,Math.max(doing.startedAt,deadline));
    const snapped = h.type === 'task' ? logTs : (typeof snapLogTimestamp === 'function' ? snapLogTimestamp(h,logTs) : logTs);
    h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(snapped,{
      minutes:sessionMins,
      note:'doing-now auto-log'
    })]);
    h.lastLog = latestActualLog(h.logs);
    h.snoozedUntil = null;
    clearPlanByDateOnLog(h);
    changed = true;
  }

  clearDoingNow(h.hid);
  if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
  if(!changed)return 0;
  save(data);
  // A unified timer/doing-now session has one completion owner. If the
  // persisted deadline sweep wins the race, retire the matching live timer so
  // its next tick cannot create a second log (especially for rhythm habits).
  if(typeof habitTimer !== 'undefined' && habitTimer){
    const timerHabit = data[habitTimer.idx];
    if(timerHabit && timerHabit.hid === h.hid && typeof clearHabitTimerSilent === 'function'){
      clearHabitTimerSilent();
    }
  }
  if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)
    && typeof cancelPush === 'function' && typeof reminderSignature === 'function'){
    cancelPush(reminderSignature(h));
  }
  if(opts.refresh !== false && typeof refreshOpenViews === 'function')refreshOpenViews();
  if(opts.toast !== false && typeof showToast === 'function')showToast('doing-now auto-logged');
  return 1;
}

function sweepAutoDoneTasks(){
  const oneShotCount = sweepDoingNowOneShot(Date.now(),{refresh:false,toast:true});
  const chunkCount = sweepAutoMarkedBreakableChunks(Date.now(),{refresh:false,toast:true});
  const data = load();
  const now = Date.now();
  const todayStart = dayStart(now);
  const completedSigs = [];
  let changed = false;
  let count = 0;
  data.forEach(h=>{
    // Doing-now one-shot is handled above; still allow normal auto-mark path
    // for habits that already have autoMarkMinutes set.
    if(h.autoMarkMinutes === null)return;
    if(h.breakable)return; // breakables are reconciled against placed chunks above
    if(h.type === 'task'){
      // Trigger: auto-completing doing-now override, fixed time, or when the
      // task enters the agenda window. Manual sessions never change the
      // scheduled auto-mark deadline.
      const trigger = effectiveAutoMarkTrigger(h,now);
      if(trigger === null)return;
      // Auto Doing now uses its session deadline; manual active focus leaves
      // the habit's normal scheduled auto-mark behavior untouched.
      const doing = getDoingNow();
      const doingOwns = doing && doing.hid === h.hid && doing.dayBase === dayStart(now)
        && doingNowAutoCompletes(doing);
      const dueAt = doingOwns
        ? doingNowAutoMarkDeadline(doing)
        : trigger + (h.autoMarkMinutes || 0) * 60000;
      if(dueAt == null || dueAt >= now)return;
      if(h.lastLog !== null)return; // already done (manual check-off or prior sweep)
      const logs = normalizeLogs(h.logs);
      logs.push(trigger);
      h.logs = normalizeLogs(logs);
      h.lastLog = latestActualLog(h.logs);
      if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
      if(doingOwns)clearDoingNow(h.hid);
      changed = true;
      count += 1;
      if(typeof reminderSignature === 'function')completedSigs.push(reminderSignature(h));
      return;
    }
    if(h.type === 'keepup'){
      // Recurring-event habit: back-fill a log for each passed scheduled day
      // that has no entry yet. Only fires when an explicit day schedule is set.
      if(!hasDaySchedule(h))return;
      const anchor = h.lastLog !== null ? h.lastLog : (h.createdAt || now);
      const floor = todayStart - 60 * 86400000; // cap to avoid huge back-fills
      let cursor = Math.max(dayStart(anchor) + 86400000, floor);
      const taken = new Set(normalizeLogs(h.logs).map(l=>dateKey(logTime(l))));
      const toAdd = [];
      while(cursor < todayStart){
        if(isDateEligibleForHabit(h,cursor) && !taken.has(dateKey(cursor))){
          toAdd.push(cursor + 12 * 3600000); // noon, same local day
        }
        cursor += 86400000;
      }
      if(toAdd.length){
        h.logs = normalizeLogs([...normalizeLogs(h.logs), ...toAdd]);
        h.lastLog = latestActualLog(h.logs);
        changed = true;
        count += toAdd.length;
      }
    }
  });
  if(!changed){
    if(chunkCount > 0 || oneShotCount > 0){
      if(typeof syncTimerAfterExternalCompletion === 'function')syncTimerAfterExternalCompletion();
      if(typeof refreshOpenViews === 'function')refreshOpenViews();
    }
    return chunkCount + oneShotCount;
  }
  save(data);
  if(typeof cancelPush === 'function')completedSigs.forEach(sig=>cancelPush(sig));
  // Snappy clear: drop a running timer / open session sheet if this sweep
  // just completed that habit (instead of waiting for the next 250ms tick).
  if(typeof syncTimerAfterExternalCompletion === 'function')syncTimerAfterExternalCompletion();
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  return count + chunkCount + oneShotCount;
}

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION PRIMITIVES — PURE. Coercion helpers used by normalize() and
// also called directly from view/settings code. Each is self-contained.
// ─────────────────────────────────────────────────────────────────────────

function sizeKb(data){return Math.round((JSON.stringify(data).length * 2) / 1024);}
function clampRhythmValue(value){
  const n = Number(value);
  if(!Number.isFinite(n))return 7;
  return Math.max(MIN_RHYTHM_DAYS,Math.min(MAX_RHYTHM_DAYS,n));
}
/** PURE: split a (possibly fractional) target into {times, days} for UI. */
function rhythmParts(target){
  const t = clampRhythmValue(target);
  if(Math.abs(t - Math.round(t)) < 0.01)return {times:1,days:Math.max(1,Math.round(t))};
  // Exact rational first: a target like 7/3 must round-trip back to 3×/7d
  // instead of being approximated as 2×/5d by the tolerance pass below.
  for(let times = 2; times <= 30; times += 1){
    const days = Math.round(t * times);
    if(days >= 1 && days <= MAX_RHYTHM_DAYS && Math.abs(days / times - t) < 1e-9){
      return {times,days};
    }
  }
  // Approximate fit for legacy/non-rational targets (smallest times first).
  for(let times = 2; times <= 14; times += 1){
    const days = Math.round(t * times);
    if(days >= 1 && days <= MAX_RHYTHM_DAYS && Math.abs(days / times - t) < 0.051){
      return {times,days};
    }
  }
  const days = Math.max(1,Math.min(MAX_RHYTHM_DAYS,Math.round(t * 2)));
  return {times:2,days};
}
/** PURE: build target days from "times in N days". */
function targetFromRhythmParts(times,days){
  const t = Math.max(1,Math.min(30,parseInt(times,10) || 1));
  const d = Math.max(1,Math.min(MAX_RHYTHM_DAYS,parseInt(days,10) || 7));
  return clampRhythmValue(d / t);
}
/**
 * PURE: integer calendar gap for the next completion in a fractional rhythm.
 * Alternating rounded cumulative boundaries preserves the requested average:
 * 5x/8d becomes 2,1,2,1,2 days instead of rounding 1.6 up to 2 every time.
 * `completionOffset` advances the phase for virtual week-plan placements.
 */
function rhythmCadenceGapDays(h,completionOffset = 0){
  const target = clampRhythmValue(h && h.target);
  const {times,days} = rhythmParts(target);
  if(times <= 1)return Math.max(1,days);
  const storedCount = h && Array.isArray(h.logs)
    ? actualLogs(h.logs).length
    : 0;
  const knownCount = Math.max(storedCount,h && h.lastLog != null ? 1 : 0);
  const offset = Math.max(0,Math.round(Number(completionOffset) || 0));
  const phase = Math.max(0,knownCount - 1 + offset) % times;
  const start = Math.round((phase * days) / times);
  const end = Math.round(((phase + 1) * days) / times);
  return Math.max(1,end - start);
}
/** PURE: initial due gap with keepup/reduce flexibility applied. */
function effectiveRhythmCadenceGapDays(h){
  const gap = rhythmCadenceGapDays(h,0);
  const flex = clampFlexibility(h && h.flexibilityDays);
  if(h && h.type === 'keepup')return gap + flex;
  if(h && h.type === 'reduce')return Math.max(1,gap - flex);
  return gap;
}
/** PURE: card/meta label for a rhythm target. */
function formatRhythmLabel(target){
  if(target == null)return '';
  const {times,days} = rhythmParts(target);
  return times === 1 ? `${days}d` : `${times}×/${days}d`;
}
function clampFlexibility(value){
  const n = parseInt(value,10);
  return Math.max(0,Math.min(60,Number.isNaN(n) ? DEFAULT_FLEXIBILITY_DAYS : n));
}
function clampDuration(value){
  return Math.max(1,Math.min(720,parseInt(value,10) || DEFAULT_DURATION_MINUTES));
}
function clampTimes(value){
  return Math.max(1,Math.min(30,parseInt(value,10) || 1));
}
function clampMinChunk(value){
  return Math.max(TIME_PICKER_STEP_MINUTES,Math.min(720,parseInt(value,10) || DEFAULT_MIN_CHUNK_MINUTES));
}
function normalizeTimerAutoStop(value){
  if(value === null || value === undefined || value === '')return null;
  const n = parseInt(value,10);
  if(!Number.isFinite(n) || n <= 0)return null;
  return Math.max(1,Math.min(720,n));
}
// PURE: coercion for the auto-mark-minutes field. Empty/invalid → null (manual).
function normalizeAutoMark(value){
  if(value === null || value === undefined || value === '')return null;
  const n = parseInt(value,10);
  if(!Number.isFinite(n) || n < 0)return null;
  return Math.min(10080,n); // up to a week, in minutes
}
/**
 * PURE: ideal continuous session plan for remaining work (no calendar).
 * Splitting is a placement concern — this returns a single chunk of `total`
 * (or [] when empty). `minChunkMinutes` is unused here but kept for call-site
 * compatibility; the hard floor is enforced by isValidChunkMinutes / placement.
 */
function planChunks(totalMinutes,_minChunkMinutes){
  const total = Math.max(0,Math.round(Number(totalMinutes) || 0));
  if(total <= 0)return [];
  return [clampDuration(total)];
}
/**
 * PURE: whether `piece` is a valid session size for `remaining` given min floor.
 * Finish-up: when remaining < min, only exactly remaining is allowed.
 * Otherwise piece must be in [min, remaining].
 */
function isValidChunkMinutes(piece,remaining,minChunkMinutes){
  const rem = Math.max(0,Math.round(Number(remaining) || 0));
  const min = clampMinChunk(minChunkMinutes);
  const p = Math.round(Number(piece) || 0);
  if(rem <= 0 || p <= 0 || p > rem)return false;
  if(rem < min)return p === rem;
  return p >= min;
}
/** PURE: minutes already logged toward a breakable session (sum of log.minutes). */
function loggedChunkMinutes(h){
  if(!h)return 0;
  return normalizeLogs(h.logs).reduce((sum,log)=>{
    if(isPlanLog(log))return sum;
    const m = Number(log && log.minutes);
    return sum + (Number.isFinite(m) && m > 0 ? m : 0);
  },0);
}
/**
 * PURE: breakable minutes logged on one calendar day (for daily keepup/reduce
 * budgets). Tasks ignore this and use lifetime remaining instead.
 */
function loggedChunkMinutesOnDay(h,dayBase){
  if(!h)return 0;
  const start = dayStart(dayBase != null ? dayBase : Date.now());
  const end = start + 86400000;
  return normalizeLogs(h.logs).reduce((sum,log)=>{
    if(isPlanLog(log))return sum;
    const ts = logTime(log);
    if(!ts || ts < start || ts >= end)return sum;
    const m = Number(log && log.minutes);
    return sum + (Number.isFinite(m) && m > 0 ? m : 0);
  },0);
}
/**
 * PURE: breakable keepup/reduce with a target — place on each rhythm day with
 * a fresh daily duration budget (not a one-shot pool across the week).
 */
function isBreakableRhythmHabit(h){
  return !!(h && h.breakable && h.type !== 'task'
    && Number.isFinite(Number(h && h.target)));
}
/**
 * PURE: minutes of breakable work still needed.
 * - Tasks: lifetime remaining (duration − all logged minutes).
 * - Keepup/reduce: today's budget (duration − minutes logged today).
 */
function breakableBudgetMinutes(h,dayBase){
  const total = clampDuration(h && h.durationMinutes);
  if(!h || !h.breakable)return total;
  if(h.type === 'task')return Math.max(0,total - loggedChunkMinutes(h));
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  return Math.max(0,total - loggedChunkMinutesOnDay(h,base));
}
/** PURE: remaining minutes for a breakable item (full duration when nothing logged). */
function remainingDurationMinutes(h,dayBase){
  if(!h || !h.breakable)return clampDuration(h && h.durationMinutes);
  if(h.type === 'task')return breakableBudgetMinutes(h);
  return breakableBudgetMinutes(h,dayBase != null ? dayBase : dayStart(Date.now()));
}
/**
 * PURE: smallest session that still makes progress on a breakable item.
 * Finish-up when remaining < min; otherwise the min-chunk floor.
 */
function minViableSessionMinutes(h,dayBase){
  const left = remainingDurationMinutes(h,dayBase);
  if(left <= 0)return 0;
  if(!h || !h.breakable)return left;
  const min = clampMinChunk(h.minChunkMinutes);
  return left < min ? left : min;
}
/** PURE: ideal next chunk sizes (continuous: one block of remaining). */
function remainingChunks(h,dayBase){
  const left = remainingDurationMinutes(h,dayBase);
  if(left <= 0)return [];
  if(!h || !h.breakable)return [left];
  return planChunks(left,h.minChunkMinutes);
}
/** PURE: minutes already completed toward the breakable budget. */
function breakableProgressMinutes(h,dayBase){
  if(!h || !h.breakable)return 0;
  if(h.type === 'task')return loggedChunkMinutes(h);
  return loggedChunkMinutesOnDay(h,dayBase != null ? dayBase : dayStart(Date.now()));
}
/** PURE: total breakable budget (duration). */
function breakableTotalMinutes(h){
  return clampDuration(h && h.durationMinutes);
}
/**
 * PURE: instant-tap amount for a breakable log. A real partial agenda piece is
 * meaningful, so use it when present. A continuous placement often equals the
 * entire remaining budget; in that case fall back to the minimum as a quick-log
 * step rather than treating the minimum as the preferred session length.
 */
function suggestedBreakableLogMinutes(h,chunkMinutes,dayBase){
  if(!h || !h.breakable)return 0;
  const rem = breakableBudgetMinutes(h,dayBase);
  if(rem <= 0)return 0;
  const min = clampMinChunk(h.minChunkMinutes);
  if(rem < min)return rem;
  let suggested = Math.round(Number(chunkMinutes));
  if(!Number.isFinite(suggested) || suggested <= 0 || suggested >= rem){
    suggested = min;
  }
  return Math.max(1,Math.min(suggested,rem));
}
/**
 * PURE: minutes to log when the user dragged the progress slider to a target.
 * Returns delta above committed progress, or 0 when target is not ahead.
 */
function breakableSliderDeltaMinutes(h,targetMinutes,dayBase){
  if(!h || !h.breakable)return 0;
  const total = breakableTotalMinutes(h);
  const done = breakableProgressMinutes(h,dayBase);
  const target = Math.max(0,Math.min(total,Math.round(Number(targetMinutes) || 0)));
  return Math.max(0,target - done);
}
/**
 * PURE: 0–100 progress percent for slider display (committed minutes / total).
 */
function breakableProgressPercent(h,dayBase){
  const total = breakableTotalMinutes(h);
  if(total <= 0)return 0;
  const done = breakableProgressMinutes(h,dayBase);
  return Math.max(0,Math.min(100,Math.round((done / total) * 100)));
}
/**
 * PURE: split committed breakable progress into manual vs calendar-sourced
 * minutes. Used by the 3-color status bar on breakable cards.
 */
function breakableProgressBreakdown(h,dayBase){
  const total = breakableTotalMinutes(h);
  if(!h || !h.breakable || total <= 0)return {manual:0,calendar:0,total:0};
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const start = h.type === 'task' ? 0 : dayStart(base);
  const end = h.type === 'task' ? Infinity : start + 86400000;
  let calendar = 0;
  normalizeLogs(h.logs).forEach(log=>{
    if(isPlanLog(log))return;
    const ts = logTime(log);
    if(!ts || ts < start || ts >= end)return;
    const m = Number(log && log.minutes);
    if(!Number.isFinite(m) || m <= 0)return;
    if(isCalendarCreditLog(log))calendar += m;
  });
  const done = breakableProgressMinutes(h,dayBase);
  const manual = Math.max(0,done - calendar);
  return {manual,calendar,total};
}
/** PURE: minutes for a 0–100 slider percent of the breakable budget. */
function breakableMinutesFromPercent(h,percent){
  const total = breakableTotalMinutes(h);
  const p = Math.max(0,Math.min(100,Number(percent) || 0));
  return Math.max(0,Math.min(total,Math.round(total * p / 100)));
}
/**
 * MUTATES habit logs so breakable progress equals targetMinutes (day scope for
 * keepup/reduce, lifetime for tasks). Returns {mode:'add'|'set'|'noop', delta, minutes}.
 * Caller must save. For mode 'add', caller should logTing the delta instead of
 * using this — this function handles 'set' (rewrite) when target < done, and
 * can also set exactly when building a consolidated entry.
 */
function rewriteBreakableProgress(h,targetMinutes,dayBase){
  if(!h || !h.breakable)return { mode:'noop', delta:0, minutes:0 };
  const total = breakableTotalMinutes(h);
  const target = Math.max(0,Math.min(total,Math.round(Number(targetMinutes) || 0)));
  const done = breakableProgressMinutes(h,dayBase);
  const delta = target - done;
  if(delta === 0)return { mode:'noop', delta:0, minutes:target };
  if(delta > 0)return { mode:'add', delta, minutes:target };
  // Reduce: drop minute-bearing actuals in scope, keep plans + non-minute actuals.
  const logs = normalizeLogs(h.logs);
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const start = dayStart(base);
  const end = start + 86400000;
  const kept = logs.filter(log=>{
    if(isPlanLog(log))return true;
    if(logMinutes(log) === null)return true;
    if(h.type === 'task')return false;
    const ts = logTime(log);
    return !ts || ts < start || ts >= end;
  });
  if(target > 0){
    const ts = (typeof snapLogTimestamp === 'function')
      ? snapLogTimestamp(h,Date.now())
      : Date.now();
    kept.push(makeActualLog(ts,{ minutes:target }));
  }
  h.logs = normalizeLogs(kept);
  h.lastLog = latestActualLog(h.logs);
  return { mode:'set', delta, minutes:target };
}
/** PURE: task fully complete? Breakable tasks need chunk minutes to cover duration
 *  (or a full log without minutes). Non-breakable: any actual log. */
function isTaskDone(h){
  if(!h || h.type !== 'task')return false;
  if(h.lastLog === null)return false;
  if(!h.breakable)return true;
  const logs = normalizeLogs(h.logs).filter(log=>!isPlanLog(log));
  if(!logs.length)return false;
  if(logs.some(log=>logMinutes(log) === null))return true;
  return remainingDurationMinutes(h) <= 0;
}
// PURE: coerce a raw priority into the 0–5 band (P0 critical → P5 someday).
// Missing/out-of-range values fall back to DEFAULT_PRIORITY so legacy records
// migrate seamlessly.
function clampPriority(value){
  const n = parseInt(value,10);
  if(Number.isNaN(n))return DEFAULT_PRIORITY;
  return Math.max(0,Math.min(PRIORITY_LABELS.length - 1,n));
}
// PURE: effective priority for an item, bounded to 0..5.
function effectivePriority(h){
  return clampPriority(h && h.priority);
}
function clampTimestamp(value){
  const n = Number(value);
  if(!Number.isFinite(n) || n <= 0)return null;
  const MS_YEAR = 365 * 86400000;
  if(n < Date.now() - 10 * MS_YEAR || n > Date.now() + 10 * MS_YEAR)return null;
  return Math.round(n);
}
function clampDayTimestamp(value){
  const ts = clampTimestamp(value);
  return ts === null ? null : dayStart(ts);
}
function cleanTopic(value){
  return String(value || '').trim().replace(/\s+/g,' ').slice(0,32);
}
function normalizeTopics(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  return items.map(cleanTopic).filter(topic=>{
    const key = topic.toLowerCase();
    if(!topic || seen.has(key))return false;
    seen.add(key);
    return true;
  }).slice(0,24);
}
function normalizeAllowedWeekdays(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const days = items.map(day=>parseInt(day,10)).filter(day=>{
    if(!Number.isInteger(day) || day < 0 || day > 6 || seen.has(day))return false;
    seen.add(day);
    return true;
  }).sort((a,b)=>a-b);
  return days.length === 7 ? [] : days;
}
function normalizeAllowedMonthDays(value){
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const days = items.map(day=>parseInt(day,10)).filter(day=>{
    if(!Number.isInteger(day) || day < 1 || day > 31 || seen.has(day))return false;
    seen.add(day);
    return true;
  }).sort((a,b)=>a-b);
  return days.length === 31 ? [] : days;
}
function normalizeTimeMinutes(value){
  const n = parseInt(value,10);
  if(Number.isNaN(n))return null;
  return Math.max(0,Math.min(1439,n));
}
function normalizeAgendaScoreWeights(value){
  const defaults = (typeof DEFAULT_SORT_SETTINGS !== 'undefined' && DEFAULT_SORT_SETTINGS.agendaScoreWeights)
    ? DEFAULT_SORT_SETTINGS.agendaScoreWeights
    : { travel:1, cluster:1, day:1, asap:0.12, scarce:0.05, preference:1.5 };
  const src = value && typeof value === 'object' ? value : {};
  const out = {};
  for(const key of Object.keys(defaults)){
    const n = Number(src[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? n : defaults[key];
  }
  return out;
}
function normalizeAvailability(value){
  const src = Array.isArray(value) ? value : DEFAULT_AVAILABILITY_MINUTES;
  return WEEKDAY_LABELS.map((_,i)=>Math.max(0,Math.min(1440,parseInt(src[i],10) || 0)));
}
function normalizeAvailabilityOverrides(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  return Object.entries(value).reduce((acc,[key,minutes])=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key))return acc;
    acc[key] = Math.max(0,Math.min(1440,parseInt(minutes,10) || 0));
    return acc;
  },{});
}
function normalizeBlockedTimes(value){
  const src = Array.isArray(value) ? value : DEFAULT_BLOCKED_TIMES;
  return src.map((raw,idx)=>{
    const label = cleanTopic(raw?.label || `blocked ${idx + 1}`).slice(0,24) || 'blocked';
    const days = normalizeAllowedWeekdays(raw?.days);
    const start = normalizeTimeMinutes(raw?.start);
    const end = normalizeTimeMinutes(raw?.end);
    if(start === null || end === null || start === end)return null;
    // Optional location tie: a block tagged with a location tells the week
    // agenda where you already are during that span (sleep→Home, work→Office).
    // Stripped to a clean id; absent = location-agnostic (busy, place unknown).
    const locationId = cleanLocationId(raw?.locationId) || null;
    // Prayer anchors mirror habits: when set, the matching start/end is
    // resolved via adhan against the block's locationId — or, when the block
    // has no place, against the home city (Settings → Locations). Blocked
    // times do NOT support habit-anchors (they're a settings-level recurring
    // block, not tied to a habit's log stream).
    const startAnchor = cleanPrayerAnchor(raw?.startAnchor);
    const endAnchor = cleanPrayerAnchor(raw?.endAnchor);
    // Anchors are kept even without a place; resolution falls back to the
    // home city at runtime (see resolveBlockedTimeMinutes). With neither, the
    // resolved value is null and callers use the fixed clock fallback.
    const safeStartAnchor = startAnchor;
    const safeEndAnchor = endAnchor;
    const startCombine = safeStartAnchor && typeof cleanTimeCombine === 'function'
      ? cleanTimeCombine(raw?.startCombine) : null;
    const startAnchor2 = startCombine
      ? (typeof cleanBlockedAnchor2 === 'function'
        ? cleanBlockedAnchor2(raw?.startAnchor2)
        : cleanPrayerAnchor(raw?.startAnchor2))
      : null;
    const endCombine = safeEndAnchor && typeof cleanTimeCombine === 'function'
      ? cleanTimeCombine(raw?.endCombine) : null;
    const endAnchor2 = endCombine
      ? (typeof cleanBlockedAnchor2 === 'function'
        ? cleanBlockedAnchor2(raw?.endAnchor2)
        : cleanPrayerAnchor(raw?.endAnchor2))
      : null;
    const dayOff = typeof normalizeAnchorDayOffset === 'function' ? normalizeAnchorDayOffset : (v => 0);
    return {
      label,days,start,end,locationId,
      startAnchor:safeStartAnchor,
      startOffsetMin:normalizePrayerOffset(raw?.startOffsetMin),
      startCombine:startCombine && startAnchor2 ? startCombine : null,
      startAnchor2,
      startOffsetMin2:startAnchor2 && startAnchor2 !== 'fixed' ? normalizePrayerOffset(raw?.startOffsetMin2) : 0,
      startFixedMin2:startAnchor2 === 'fixed' ? (normalizeTimeMinutes(raw?.startFixedMin2) ?? 1200) : null,
      startDayOffset:dayOff(raw?.startDayOffset),
      startDayOffset2:startAnchor2 && startAnchor2 !== 'fixed' ? dayOff(raw?.startDayOffset2) : 0,
      endAnchor:safeEndAnchor,
      endOffsetMin:normalizePrayerOffset(raw?.endOffsetMin),
      endCombine:endCombine && endAnchor2 ? endCombine : null,
      endAnchor2,
      endOffsetMin2:endAnchor2 && endAnchor2 !== 'fixed' ? normalizePrayerOffset(raw?.endOffsetMin2) : 0,
      endFixedMin2:endAnchor2 === 'fixed' ? (normalizeTimeMinutes(raw?.endFixedMin2) ?? 1200) : null,
      endDayOffset:dayOff(raw?.endDayOffset),
      endDayOffset2:endAnchor2 && endAnchor2 !== 'fixed' ? dayOff(raw?.endDayOffset2) : 0
    };
  }).filter(Boolean).slice(0,24);
}
/** PURE: stable signature for a blocked-time instance on a given day. */
function blockedInstanceKey(label,startMin,endMin){
  return `${String(label || 'blocked').slice(0,24)}|${startMin}|${endMin}`;
}
/** PURE: validate per-day, per-instance blocked-time clock edits. */
function normalizeBlockedTimeOverrides(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  const out = {};
  for(const [dayKey,entries] of Object.entries(value)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !entries || typeof entries !== 'object' || Array.isArray(entries))continue;
    const clean = {};
    for(const [signature,raw] of Object.entries(entries)){
      const start = normalizeTimeMinutes(raw && raw.start);
      const end = normalizeTimeMinutes(raw && raw.end);
      if(!signature || start === null || end === null || start === end)continue;
      clean[String(signature).slice(0,96)] = {start,end};
    }
    if(Object.keys(clean).length)out[dayKey] = clean;
  }
  return out;
}
/** PURE: actual minute span of a blocked-time instance. Overnight blocks
 *  (end <= start, e.g. 22:00→02:00) wrap past midnight and occupy the
 *  complement (1440 − start + end). Same-day blocks are just end − start. */
function blockDurationMinutes(startMin,endMin){
  const s = Math.max(0,Math.min(1440,Number(startMin) || 0));
  const e = Math.max(0,Math.min(1440,Number(endMin) || 0));
  if(s === e)return 0;
  return e > s ? e - s : (1440 - s) + e;
}
/** PURE: coerce cancelled block map; drop keys older than 21 days. */
function normalizeCancelledBlocks(value){
  if(!value || typeof value !== 'object' || Array.isArray(value))return {};
  const cutoff = dayStart(Date.now()) - 21 * 86400000;
  const out = {};
  for(const [key,list] of Object.entries(value)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key))continue;
    const ts = Date.parse(`${key}T12:00:00`);
    if(!Number.isFinite(ts) || ts < cutoff)continue;
    const items = Array.isArray(list) ? list : [];
    const seen = new Set();
    out[key] = items.map(String).filter(sig=>{
      if(!sig || seen.has(sig))return false;
      seen.add(sig);
      return true;
    }).slice(0,48);
  }
  return out;
}
/** PURE: true if this block instance was cancelled for dayKey. */
function isBlockedCancelled(dayKey,label,startMin,endMin,settings){
  const map = normalizeCancelledBlocks(settings && settings.cancelledBlocks);
  const list = map[dayKey] || [];
  return list.includes(blockedInstanceKey(label,startMin,endMin));
}
/** HYBRID: cancel one block occurrence for a day; frees agenda for that instance. */
function cancelBlockedInstance(dayKey,label,startMin,endMin){
  const settings = loadSortSettings();
  const map = normalizeCancelledBlocks(settings.cancelledBlocks);
  const key = blockedInstanceKey(label,startMin,endMin);
  const list = new Set(map[dayKey] || []);
  list.add(key);
  map[dayKey] = [...list];
  saveSortSettings({...settings,cancelledBlocks:map});
  return true;
}
/** HYBRID: undo a cancel — re-block the instance so the agenda avoids that time again. */
function restoreBlockedInstance(dayKey,label,startMin,endMin){
  const settings = loadSortSettings();
  const map = normalizeCancelledBlocks(settings.cancelledBlocks);
  if(!map[dayKey])return false;
  const key = blockedInstanceKey(label,startMin,endMin);
  map[dayKey] = map[dayKey].filter(k=>k !== key);
  if(!map[dayKey].length)delete map[dayKey];
  saveSortSettings({...settings,cancelledBlocks:map});
  return true;
}

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
  const id = cleanLocationId(locationId);
  if(!id || !h)return null;
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
function effectiveLocationWindow(h,loc,weekday,dayBase){
  const locWin = loc ? resolveLocationWindow(loc,weekday) : {start:0,end:1440};
  if(!locWin)return [];
  // Both prayer anchors and habit anchors are dynamic; resolve through the
  // shared resolver. Habit anchors ignore the passed-in location (they use
  // the anchor habit's log); prayer anchors use the habit's resolved location
  // — NOT the location passed in here, which may be a different allowed one.
  // dayBase must be the day being placed (not Date.now): otherwise a located
  // habit's sunrise window is resolved for today and stamped onto tomorrow,
  // which can miss the open post-sleep gap even when the real window is clear.
  const base = dayBase != null ? dayBase : dayStart(Date.now());
  const startAnchor = cleanAnchor(h && h.allowedTimeStartAnchor);
  const endAnchor = cleanAnchor(h && h.allowedTimeEndAnchor);
  if(startAnchor || endAnchor){
    const startMin = resolveHabitTimeField(h,'allowedTimeStart',base);
    const endMin = resolveHabitTimeField(h,'allowedTimeEnd',base);
    if(startMin == null || endMin == null)return [];
    return intersectWindows({start:startMin,end:endMin},locWin);
  }
  if(!hasTimeWindow(h))return locWin.end > locWin.start ? [locWin] : unwrapMinuteWindow(locWin);
  return intersectWindows({start:h.allowedTimeStart,end:h.allowedTimeEnd},locWin);
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
    const locationIds = prev.filter(id=>valid.has(id));
    const locationPrefs = normalizeLocationPrefs(h.locationPrefs,locationIds,h.preferredLocationId);
    const preferredLocationId = primaryPreferredLocationId(locationPrefs,locationIds);
    const prevPref = h.preferredLocationId || null;
    const prevPrefs = JSON.stringify(h.locationPrefs || {});
    const moved = locationIds.length !== prev.length
      || preferredLocationId !== prevPref
      || JSON.stringify(locationPrefs) !== prevPrefs;
    if(moved)changed = true;
    return moved ? {...h,locationIds,locationPrefs,preferredLocationId} : h;
  });
  return {data:next,changed};
}

const RETENTION_TIME_FIELDS = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];

/** PURE: habit ids referenced as dynamic-time or schedule-link anchors. */
function collectReferencedHabitIds(data,settings = null){
  const refs = new Set();
  const credit = cleanHabitId(settings && settings.calendarCreditHabitId);
  if(credit)refs.add(credit);
  (Array.isArray(data) ? data : []).forEach(h=>{
    if(!h)return;
    RETENTION_TIME_FIELDS.forEach(field=>{
      const id1 = cleanHabitId(h[field + 'AnchorHabitId']);
      const id2 = cleanHabitId(h[field + 'AnchorHabitId2']);
      if(id1)refs.add(id1);
      if(id2)refs.add(id2);
    });
    const links = normalizeScheduleLinks(h.scheduleLinks,h.hid);
    links.forEach(link=>{ if(link && link.anchorHid)refs.add(link.anchorHid); });
  });
  return refs;
}

/** PURE: drop schedule-link / habit-anchor pointers to removed habit ids. */
function scrubRemovedHabitReferences(data,removedIds){
  const gone = removedIds instanceof Set ? removedIds : new Set(removedIds || []);
  if(!gone.size)return Array.isArray(data) ? data : [];
  return (Array.isArray(data) ? data : []).map(h=>{
    if(!h)return h;
    let next = h;
    let touched = false;
    RETENTION_TIME_FIELDS.forEach(field=>{
      ['','2'].forEach(suffix=>{
        const key = field + 'AnchorHabitId' + suffix;
        const id = cleanHabitId(next[key]);
        if(id && gone.has(id)){
          if(!touched){ next = {...next}; touched = true; }
          next[key] = null;
          if(next[field + 'Anchor' + suffix] === 'habit')next[field + 'Anchor' + suffix] = null;
        }
      });
    });
    const links = normalizeScheduleLinks(next.scheduleLinks,next.hid);
    const scrubbed = links.filter(link=>link && !gone.has(link.anchorHid));
    if(scrubbed.length !== links.length){
      if(!touched){ next = {...next}; touched = true; }
      next.scheduleLinks = scrubbed;
    }
    return next;
  });
}

/** PURE: keep newest N actual log entries; always preserve plan logs. */
function trimHabitActualLogs(h,keepCount){
  if(!h || h.type === 'task' || !(keepCount > 0))return {habit:h,trimmed:0};
  const logs = normalizeLogs(h.logs);
  const actual = [];
  const plans = [];
  logs.forEach(log=>{
    if(isPlanLog(log))plans.push(log);
    else actual.push(log);
  });
  if(actual.length <= keepCount)return {habit:h,trimmed:0};
  actual.sort((a,b)=>logTime(a) - logTime(b));
  const kept = actual.slice(-keepCount);
  const nextLogs = normalizeLogs([...kept,...plans]);
  return {
    habit:{...h,logs:nextLogs,lastLog:latestActualLog(nextLogs)},
    trimmed:actual.length - keepCount
  };
}

/**
 * PURE: hard-delete expired completed tasks and trim non-task habit logs.
 * Protects habits still used as dynamic-time or schedule-link anchors.
 * @returns {{data:Habit[],changed:boolean,removedTasks:Habit[],trimmedLogs:number,trimmedHabits:number}}
 */
function runRetentionCleanup(data,settings,now = Date.now()){
  const retentionDays = normalizeCompletedTaskRetentionDays(settings && settings.completedTaskRetentionDays);
  const keepCount = normalizeHabitLogKeepCount(settings && settings.habitLogKeepCount);
  const cutoff = now - retentionDays * 86400000;
  const items = Array.isArray(data) ? data : [];
  const protectedIds = collectReferencedHabitIds(items,settings);
  const removedTasks = [];
  const survivors = [];
  items.forEach(h=>{
    if(!h)return;
    if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)){
      const doneAt = Number(h.lastLog) || 0;
      const hid = cleanHabitId(h.hid);
      if(doneAt > 0 && doneAt <= cutoff && hid && !protectedIds.has(hid)){
        removedTasks.push(h);
        return;
      }
    }
    survivors.push(h);
  });
  let next = survivors;
  if(removedTasks.length){
    next = scrubRemovedHabitReferences(survivors,new Set(removedTasks.map(h=>cleanHabitId(h.hid))));
  }
  let trimmedLogs = 0;
  let trimmedHabits = 0;
  if(keepCount > 0){
    next = next.map(h=>{
      const result = trimHabitActualLogs(h,keepCount);
      if(result.trimmed > 0){
        trimmedLogs += result.trimmed;
        trimmedHabits += 1;
      }
      return result.habit;
    });
  }
  return {
    data:next,
    changed:removedTasks.length > 0 || trimmedLogs > 0,
    removedTasks,
    trimmedLogs,
    trimmedHabits
  };
}
function effectiveAvailabilityMinutes(key,settings = sortSettings){
  const normalized = {...DEFAULT_SORT_SETTINGS,...settings};
  const overrides = normalizeAvailabilityOverrides(normalized.availabilityOverrides);
  // Weekly availabilityMinutes is unused for packing — default is a full day
  // (1440). Open slots after busy times still cap via min(budget, slots).
  if(Object.prototype.hasOwnProperty.call(overrides,key))return overrides[key];
  return 1440;
}
function retentionWeight(h,log){
  if(isPlanLog(log))return Infinity;
  const ageDays = Math.max(0,calendarDayDiff(logTime(log)) * -1);
  const target = h.target || (h.type === 'zero' ? 30 : 7);
  const actualCount = actualLogs(h.logs).length;
  if(ageDays <= 120)return Infinity;
  const rareBonus = Math.min(220,target * 3) + Math.max(0,16 - actualCount) * 18;
  const densePenalty = Math.max(0,actualCount - 36) * 7;
  return rareBonus - densePenalty - ageDays;
}
function pruneForStorage(items,targetKb){
  const next = normalize(items).map(h=>({...h,logs:normalizeLogs(h.logs)}));
  let guard = 0;
  while(sizeKb(next) > targetKb && guard < 5000){
    guard += 1;
    let candidate = null;
    next.forEach((h,habitIndex)=>{
      const logs = normalizeLogs(h.logs);
      if(actualLogs(logs).length <= 12)return;
      logs.forEach((log,logIndex)=>{
        if(isPlanLog(log))return;
        const weight = retentionWeight({...h,logs},log);
        if(weight === Infinity)return;
        if(!candidate || weight < candidate.weight){
          candidate = {habitIndex,logIndex,weight};
        }
      });
    });
    if(!candidate)break;
    next[candidate.habitIndex].logs.splice(candidate.logIndex,1);
    next[candidate.habitIndex].lastLog = latestActualLog(next[candidate.habitIndex].logs);
  }
  return next;
}
// ─────────────────────────────────────────────────────────────────────────
// LOG ENTRIES — PURE. Helpers that operate on a habit's logs array without
// touching storage. LogEntry = number | {ts,plan:true,timed?,locationId?} |
// {ts,value?,minutes?,note?} (see typedef).
// ─────────────────────────────────────────────────────────────────────────

function logTime(log){
  return typeof log === 'number' ? log : Number(log?.ts) || 0;
}
function isPlanLog(log){
  return Boolean(log && typeof log === 'object' && log.plan);
}
/** PURE: day plan locked to a clock (hard agenda appointment). */
function planTimed(log){
  return Boolean(isPlanLog(log) && log.timed);
}
/** PURE: optional one-day location override on a plan log. */
function planLocationId(log){
  if(!isPlanLog(log))return null;
  const id = String(log.locationId || '').trim();
  return id || null;
}
/** PURE: build a day plan log; timed/locationId only when explicitly set. */
function makePlanLog(ts,opts = {}){
  const entry = {ts,plan:true};
  if(opts.timed)entry.timed = true;
  const loc = opts.locationId != null ? String(opts.locationId).trim() : '';
  if(loc)entry.locationId = loc;
  return entry;
}
/** PURE: normalized plan log objects (preserves timed / locationId). */
function planLogEntries(logs){
  return normalizeLogs(logs).filter(isPlanLog);
}
/** PURE: first timed plan on a calendar day, or null. */
function timedPlanLogForDay(h,key){
  if(!h || !key)return null;
  return planLogEntries(h.logs || []).find(log=>planTimed(log) && dateKey(logTime(log)) === key) || null;
}
/** PURE: first plan log on a calendar day (prefer timed). */
function planLogForDay(h,key){
  if(!h || !key)return null;
  const plans = planLogEntries(h.logs || []).filter(log=>dateKey(logTime(log)) === key);
  if(!plans.length)return null;
  return plans.find(planTimed) || plans[0];
}
/** PURE: one-day location override from a day plan (timed or untimed). */
function dayPlanLocationId(h,key){
  const plan = planLogForDay(h,key);
  return plan ? planLocationId(plan) : null;
}
/** PURE: habit has a hard timed plan on the given day base. */
function hasTimedPlanForDay(h,dayBase){
  return Boolean(timedPlanLogForDay(h,dateKey(dayBase)));
}
function logValue(log){
  if(!log || typeof log !== 'object' || isPlanLog(log))return null;
  const n = Number(log.value);
  return Number.isFinite(n) ? n : null;
}
function logMinutes(log){
  if(!log || typeof log !== 'object' || isPlanLog(log))return null;
  const n = Number(log.minutes);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** PURE: free-form text note on an actual log entry (trimmed, max 200 chars). */
function logNote(log){
  if(!log || typeof log !== 'object' || isPlanLog(log))return '';
  return String((log && log.note) || '').slice(0,MAX_NOTE_CHARS).trim();
}
/** PURE: true when a log is imported-calendar progress credit (not a manual session). */
function isCalendarCreditLog(log){
  return Boolean(log && typeof log === 'object' && !isPlanLog(log) && log.source === 'calendar');
}
function normalizeLogs(logs){
  if(!Array.isArray(logs))return [];
  return logs
    .map(log=>{
      const ts = logTime(log);
      if(!ts)return null;
      if(isPlanLog(log) || (typeof log === 'number' && ts > Date.now())){
        const entry = {ts,plan:true};
        if(isPlanLog(log) && log.timed)entry.timed = true;
        const locId = isPlanLog(log) ? planLocationId(log) : null;
        if(locId)entry.locationId = locId;
        return entry;
      }
      if(typeof log === 'object'){
        const entry = {ts};
        const value = logValue(log);
        const minutes = logMinutes(log);
        const note = logNote(log);
        if(value !== null)entry.value = value;
        if(minutes !== null)entry.minutes = minutes;
        if(note)entry.note = note;
        if(log.source === 'calendar')entry.source = 'calendar';
        if(entry.value !== undefined || entry.minutes !== undefined || entry.note !== undefined || entry.source)return entry;
      }
      return ts;
    })
    .filter(Boolean)
    .sort((a,b)=>logTime(a)-logTime(b))
    .slice(-MAX_LOGS);
}
// PURE: snap a timestamp to the start of the habit's eligibility window for
// the log's day. Used at log time so a daily habit logged late (e.g. 11pm
// for a 6am–10am window) is recorded at 6am — the next-day rhythm check
// (`daysSince >= target`) then resolves correctly inside the narrow allowed
// window instead of silently staying "0 days since" until 24h have elapsed.
// Habits with no time window snap to the start of the calendar day.
// Tasks and zero-type keep their actual ts (one-off events whose time
// carries its own meaning; zero-types have no rhythm).
//
// Edge case: if the user logs BEFORE today's window has opened (e.g. 5am for
// a 6am–10am window), the snapped ts would fall into the future. That would
// be filtered out by `actualLogs()` (which keeps only logTime <= Date.now()),
// hiding the log until the window opens. We keep the actual ts in that case
// rather than push the log into the future or move it to yesterday.
function snapLogTimestamp(h,ts){
  if(!h)return ts;
  if(h.type === 'task' || h.type === 'zero')return ts;
  const dayBase = dayStart(ts);
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(h)){
    const startMin = typeof resolveHabitTimeField === 'function'
      ? resolveHabitTimeField(h,'allowedTimeStart',dayBase)
      : h.allowedTimeStart;
    if(startMin != null && Number.isFinite(startMin)){
      const snapped = dayBase + startMin * 60000;
      // Only snap when the window start is on/before the log ts — never push
      // a log into the future (would be hidden by actualLogs) or backwards
      // to yesterday.
      if(snapped <= ts)return snapped;
    }
  }
  return dayBase <= ts ? dayBase : ts;
}
/** PURE: build an actual log entry, optionally with value / chunk minutes / note. */
function makeActualLog(ts,opts = {}){
  const entry = {ts};
  const value = Number(opts.value);
  const minutes = Number(opts.minutes);
  if(Number.isFinite(value))entry.value = value;
  if(Number.isFinite(minutes) && minutes > 0)entry.minutes = Math.round(minutes);
  const note = String(opts.note || opts.text || '').slice(0,MAX_NOTE_CHARS).trim();
  if(note)entry.note = note;
  if(entry.value === undefined && entry.minutes === undefined && entry.note === undefined)return ts;
  return entry;
}
function makeLog(ts){
  return dateKey(ts) > dateKey(Date.now()) ? makePlanLog(ts) : ts;
}
function sameLog(log,ts,planOnly = false){
  return logTime(log) === ts && (!planOnly || isPlanLog(log));
}
function latestActualLog(logs){
  const actual = actualLogs(logs);
  return actual.length ? actual[actual.length - 1] : null;
}
function actualLogs(logs){
  return normalizeLogs(logs).filter(log=>!isPlanLog(log) && logTime(log) <= Date.now()).map(logTime).sort((a,b)=>a-b);
}
function plannedLogs(logs){
  return normalizeLogs(logs).filter(isPlanLog).map(logTime).sort((a,b)=>a-b);
}
function sampleActual(daysAgo,hour = 9){
  if(daysAgo === 0){
    const d = new Date();
    d.setHours(0,1,0,0);
    return d.getTime() <= Date.now() ? d.getTime() : Date.now() - 60000;
  }
  const d = new Date();
  d.setHours(hour,0,0,0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}
function samplePlan(daysFromNow,hour = 18){
  if(daysFromNow === 0){
    const d = new Date();
    d.setHours(23,59,0,0);
    return d.getTime() > Date.now() ? d.getTime() : Date.now() + 60000;
  }
  const d = new Date();
  d.setHours(hour,0,0,0);
  d.setDate(d.getDate() + daysFromNow);
  return d.getTime();
}
function sampleLogs(actualDays = [],plannedDays = []){
  return [
    ...actualDays.map(days=>sampleActual(days)),
    ...plannedDays.map(days=>samplePlan(days))
  ].sort((a,b)=>a-b);
}
// ─────────────────────────────────────────────────────────────────────────
// DATES — PURE. Time-of-day helpers used by scoring, views, and schedules.
// All take a ms timestamp; none read the DOM. `Date.now()` is the only
// impurity and is acceptable (clock reads port cleanly to RN).
// ─────────────────────────────────────────────────────────────────────────

// Calendar-day age (not rolling 24h). A log from yesterday 9pm is 1 day old
// at 6am today — so daily habits become due each morning even when the prior
// session was less than 24 hours ago. Rolling Math.floor(ms/86400000) made
// those habits look "not due" until the clock caught up, while a manual plan
// still placed them (hasPlannedForDay bypasses the age check).
function daysSince(ts){
  if(!ts)return null;
  return Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
}
function dayDistance(ts){
  if(!ts)return null;
  return Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
}
function daysUntil(ts){return ts ? Math.floor((dayStart(ts) - dayStart(Date.now())) / 86400000) : null;}
function dayStart(ts){
  const d = new Date(ts);
  return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
}
function entryWhen(ts){
  const days = dayDistance(ts);
  if(days === null)return 'not yet';
  if(days < 0)return `in ${Math.abs(days)}d`;
  if(days === 0)return 'today';
  return `${days}d ago`;
}
function todayIso(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function dateKey(ts){
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function monthOrdinal(day){
  const suffix = day % 10 === 1 && day % 100 !== 11 ? 'st'
    : day % 10 === 2 && day % 100 !== 12 ? 'nd'
      : day % 10 === 3 && day % 100 !== 13 ? 'rd'
        : 'th';
  return `${day}${suffix}`;
}
function weekdayShort(day){
  return WEEKDAY_LABELS[day] || '';
}
// ─────────────────────────────────────────────────────────────────────────
// SCHEDULES — PURE. Compute allowed/preferred day sets for a habit and answer
// eligibility queries. These are the highest-value functions to port verbatim
// because the calendar view, scoring, and add-habit preview all depend on them.
// ─────────────────────────────────────────────────────────────────────────

function scheduledDays(h){
  return {
    weekdays:normalizeAllowedWeekdays(h.allowedWeekdays),
    monthDays:normalizeAllowedMonthDays(h.allowedMonthDays)
  };
}
function preferredDays(h){
  return {
    weekdays:normalizeAllowedWeekdays(h.preferredWeekdays),
    monthDays:normalizeAllowedMonthDays(h.preferredMonthDays)
  };
}
function hasDaySchedule(h){
  const schedule = scheduledDays(h);
  return Boolean(schedule.weekdays.length || schedule.monthDays.length);
}
const SCHEDULE_OPPORTUNITY_RATE_CACHE = new Map();
// PURE (memoized): average eligible calendar dates per day. Weekday-only
// schedules have an exact seven-day rate. Month-day schedules use one complete
// 400-year Gregorian cycle so February/leap years, 30/31-day months, and
// weekday + month-day intersections all have a stable exact rate.
function scheduledOpportunityRate(h){
  const schedule = scheduledDays(h);
  if(!schedule.weekdays.length && !schedule.monthDays.length)return 1;
  if(!schedule.monthDays.length)return schedule.weekdays.length / 7;
  const key = `${schedule.weekdays.join(',')}|${schedule.monthDays.join(',')}`;
  if(SCHEDULE_OPPORTUNITY_RATE_CACHE.has(key))return SCHEDULE_OPPORTUNITY_RATE_CACHE.get(key);
  const weekdays = new Set(schedule.weekdays);
  let opportunities = 0;
  for(let year = 2000;year < 2400;year += 1){
    for(let month = 0;month < 12;month += 1){
      for(const monthDay of schedule.monthDays){
        const date = new Date(Date.UTC(year,month,monthDay));
        if(date.getUTCFullYear() !== year || date.getUTCMonth() !== month)continue;
        if(weekdays.size && !weekdays.has(date.getUTCDay()))continue;
        opportunities += 1;
      }
    }
  }
  const rate = opportunities / 146097; // days in a 400-year Gregorian cycle
  SCHEDULE_OPPORTUNITY_RATE_CACHE.set(key,rate);
  return rate;
}
// PURE: true when the requested completion rate consumes every eligible date.
// Examples: 3x/7d on Tue/Fri/Sat, 2x/7d on Fri/Sat, or 2x/30d on month days
// 1 and 2. In these cases calendar-gap spacing must yield to the constrained
// schedule, including adjacent eligible dates.
function rhythmFillsEveryEligibleDay(h){
  if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return false;
  const target = Number(h.target);
  if(!Number.isFinite(target) || target <= 0)return false;
  if(!hasDaySchedule(h))return false;
  const opportunityRate = scheduledOpportunityRate(h);
  if(opportunityRate <= 0)return false;
  const requestedRate = 1 / target;
  return requestedRate + 1e-9 >= opportunityRate;
}
function hasPreferredDays(h){
  const pref = preferredDays(h);
  return Boolean(pref.weekdays.length || pref.monthDays.length);
}
function hasTimeWindow(h){
  // Dynamic (prayer or habit) anchors count as a set window even when the
  // fixed minutes are null — they'll resolve to a real minute at render time.
  const startSet = Number.isFinite(h.allowedTimeStart) || cleanAnchor(h.allowedTimeStartAnchor);
  const endSet = Number.isFinite(h.allowedTimeEnd) || cleanAnchor(h.allowedTimeEndAnchor);
  return Boolean(startSet && endSet);
}
function hasPreferredTimeWindow(h){
  const startSet = Number.isFinite(h.preferredTimeStart) || cleanAnchor(h.preferredTimeStartAnchor);
  const endSet = Number.isFinite(h.preferredTimeEnd) || cleanAnchor(h.preferredTimeEndAnchor);
  return Boolean(startSet && endSet);
}
function isPreferredDay(h,ts = Date.now()){
  const pref = preferredDays(h);
  if(!pref.weekdays.length && !pref.monthDays.length)return false;
  const d = new Date(ts);
  if(pref.weekdays.length && !pref.weekdays.includes(d.getDay()))return false;
  if(pref.monthDays.length && !pref.monthDays.includes(d.getDate()))return false;
  return true;
}
function isDateEligibleForHabit(h,ts = Date.now()){
  const schedule = scheduledDays(h);
  if(!schedule.weekdays.length && !schedule.monthDays.length)return true;
  const d = new Date(ts);
  if(schedule.weekdays.length && !schedule.weekdays.includes(d.getDay()))return false;
  if(schedule.monthDays.length && !schedule.monthDays.includes(d.getDate()))return false;
  return true;
}
function nextEligibleDate(h,fromTs = Date.now(),lookAheadDays = 370){
  if(!hasDaySchedule(h))return dayStart(fromTs);
  const base = dayStart(fromTs);
  for(let offset = 0;offset <= lookAheadDays;offset++){
    const ts = base + offset * 86400000;
    if(isDateEligibleForHabit(h,ts))return ts;
  }
  return null;
}
function nextEligibleDistance(h,fromTs = Date.now()){
  const next = nextEligibleDate(h,fromTs);
  return next === null ? null : Math.round((next - dayStart(fromTs)) / 86400000);
}
// Task readiness — mirrors nextEligibleDate's composition with day schedules.
// A task surfaces as relevant once today is on/after its readyDate AND the
// day-of schedule (if any) allows it. flexibilityDays flips direction for
// tasks: days-before-due it starts surfacing, not a rhythm buffer.
function taskReadyDate(h){
  if(h.type !== 'task')return null;
  const when = taskWhen(h);
  if(when === null)return null;
  const window = Math.max(0,clampFlexibility(h.flexibilityDays));
  return when - window * 86400000;
}
function isTaskReady(h,ts = Date.now()){
  if(h.type !== 'task')return false;
  if(h.lastLog !== null)return false; // completed tasks are never "ready"
  if(taskWhen(h) === null)return true; // someday tasks are always "ready" (scored separately)
  const ready = taskReadyDate(h);
  if(ready !== null && dayStart(ts) < ready)return false;
  return !hasDaySchedule(h) || isDateEligibleForHabit(h,ts);
}
function formatTimeShort(minutes){
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}
function timeWindowSummary(h){
  if(!hasTimeWindow(h))return '';
  // When either endpoint is an anchor (prayer OR habit), show anchor labels
  // (e.g. "sunrise +30 – after gym", or "later of isha +15m · sunrise −8h +1d").
  // Resolved clock times would mislead the moment the date or location changes.
  const startAnchor = cleanAnchor(h.allowedTimeStartAnchor);
  const endAnchor = cleanAnchor(h.allowedTimeEndAnchor);
  if(startAnchor || endAnchor){
    const s = startAnchor
      ? (typeof habitEndpointLabel === 'function' ? habitEndpointLabel(h, 'allowedTimeStart') : prayerAnchorLabel(startAnchor, h.allowedTimeStartOffsetMin))
      : formatTimeShort(h.allowedTimeStart);
    const e = endAnchor
      ? (typeof habitEndpointLabel === 'function' ? habitEndpointLabel(h, 'allowedTimeEnd') : prayerAnchorLabel(endAnchor, h.allowedTimeEndOffsetMin))
      : formatTimeShort(h.allowedTimeEnd);
    return `${s}–${e}`;
  }
  return `${formatTimeShort(h.allowedTimeStart)}–${formatTimeShort(h.allowedTimeEnd)}`;
}
function scheduleSummary(h){
  const schedule = scheduledDays(h);
  const parts = [];
  if(schedule.weekdays.length)parts.push(schedule.weekdays.map(weekdayShort).join('/'));
  if(schedule.monthDays.length)parts.push(schedule.monthDays.map(monthOrdinal).join('/'));
  const tw = timeWindowSummary(h);
  if(tw)parts.push(tw);
  return parts.join(' ');
}
function preferredSummary(h){
  const pref = preferredDays(h);
  const parts = [];
  if(pref.weekdays.length)parts.push(pref.weekdays.map(weekdayShort).join('/'));
  if(pref.monthDays.length)parts.push(pref.monthDays.map(monthOrdinal).join('/'));
  return parts.join(' and ');
}
// ─────────────────────────────────────────────────────────────────────────
// FORMATTING + MISC — MOSTLY PURE. scheduleSummary/preferredSummary return
// human-readable strings; escapeHtml is the only DOM-aware function here and
// only exists to support innerHTML rendering in the view layer.
// ─────────────────────────────────────────────────────────────────────────

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function markSegments(value){
  const text = value.trim();
  if(Intl.Segmenter){
    return [...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(item=>item.segment);
  }
  return Array.from(text);
}

function cleanMark(value){
  return markSegments(value).slice(0,2).join('');
}

/** Curated emoji tile backgrounds — maps to CSS --{token}-bg / --{token}-icon. */
const EMOJI_BG_COLOR_TOKENS = ['teal','amber','red','purple','blue','green','pink','orange','indigo','cyan','lime','slate'];

function normalizeEmojiBgColor(value){
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMOJI_BG_COLOR_TOKENS.includes(token) ? token : '';
}

/** PURE: CSS custom-property pair for an emoji tile (or null when unset). */
function emojiBgStyleVars(token){
  const color = normalizeEmojiBgColor(token);
  if(!color)return null;
  return {
    bg:`var(--${color}-bg)`,
    icon:`var(--${color}-icon)`,
    token:color
  };
}

/** Inline style fragment for a pulse / mark with optional emoji bg. */
function emojiBgInlineStyle(h,fallbackBg = '',fallbackColor = ''){
  const vars = emojiBgStyleVars(h && h.emojiBgColor);
  if(vars){
    return `background:${vars.bg};color:${vars.icon};--emoji-bg:${vars.bg};`;
  }
  const parts = [];
  if(fallbackBg)parts.push(`background:${fallbackBg}`);
  if(fallbackColor)parts.push(`color:${fallbackColor}`);
  return parts.join(';');
}

function avgInterval(logs){
  const sorted = actualLogs(logs);
  if(sorted.length < 2)return null;
  let sum = 0;
  for(let i=1;i<sorted.length;i++)sum += sorted[i] - sorted[i-1];
  return Math.round(sum / (sorted.length - 1) / 86400000);
}
