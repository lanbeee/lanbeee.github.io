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
 * free-form text note.
 * @typedef {(number|{ts:number,plan:true}|{ts:number,value?:number,minutes?:number,note?:string})} LogEntry
 */

/**
 * A habit. Stored in the habits array under the `tings_v2` localStorage key.
 * The same record shape expresses all four item kinds via `type`; the fields
 * below marked with TaskFields only carry meaning for that type.
 * @typedef {Object} Habit
 * @property {string} name                    — display name (max 60 chars)
 * @property {'keepup'|'reduce'|'zero'|'task'} type  — build / limit / stop / one-off
 * @property {number|null} target             — rhythm in days (may be fractional, e.g. 3.5 = 2×/7d); null when type in zero/task
 * @property {LogEntry[]} logs                — sorted actual + planned entries (max 500)
 * @property {string} emoji                   — grapheme cluster(s), '' means default icon
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
 * @property {number} flexibilityDays         — buffer added to (or subtracted from) target; 0-60. For tasks: days-before-due it starts surfacing.
 * @property {number} durationMinutes         — planned session length; 1-720
 * @property {boolean} breakable              — when true, planner may split duration into chunks of at least minChunkMinutes
 * @property {number} minChunkMinutes         — minimum chunk length when breakable; 15-720
 * @property {number|null} timerAutoStopMinutes — optional live-timer auto-stop (null = use durationMinutes)
 * @property {number|null} autoMarkMinutes — when set, the item logs itself this many minutes after its scheduled time (or timer start). null = manual.
 * @property {boolean} trackValue             — when true, logging offers a free-form numeric value field
 * @property {number} priority                — 0 (P0 critical) .. 5 (P5 someday). Manual; drives who claims today's agenda capacity first.
 * @property {number|null} lastLog            — derived: most recent actual log timestamp
 * @property {number|null} createdAt          — ms timestamp set at creation; secondary sort key + "added Nd ago" copy. null on legacy records.
 * @property {number|null} planByDate         — keepup/reduce only: one-off soft "do by" day (ms day-start). Week planner may place it any day on/before this date; cleared on the next actual log. null = none.
 *
 * — TaskFields (additional semantics when type === 'task') —
 * @property {number|null} dueDate            — ms day-level timestamp, or null for a "someday" task
 * @property {number|null} eventTime          — ms timestamp at the exact minute when this task is scheduled; null = no fixed time (dated or someday)
 * @property {boolean} hardDue                — computed: true when dueDate is set and flexibilityDays is 0 (firm deadline, escalates urgency past it)
 *
 * — LocationFields (optional, on every type; empty locationIds = anywhere) —
 * @property {string[]} locationIds           — allowed Location ids (empty = anywhere, the default)
 * @property {Object<string,'avoid'|'little'|'high'>} locationPrefs — soft preference among allowed ids
 * @property {string|null} preferredLocationId — legacy single preferred (migrated into locationPrefs.high); kept for reads
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
 * @property {boolean} showScheduledTasksInAgenda              — include fixed-time tasks in Today agenda
 * @property {boolean} showDueTasksInAgenda                    — include untimed tasks due today in Today agenda
 * @property {boolean} showPlannedItemsInAgenda                — include planned-today items in Today agenda
 * @property {boolean} showDueHabitsInAgenda                   — include ready habits in Today agenda
 * @property {boolean} reachAssist                             — pull-down-at-top gesture lowers first cards
 * @property {'keepup'|'reduce'|'zero'} defaultType            — type prefilled in the add-habit sheet
 * @property {number} defaultTarget                            — rhythm prefilled in the add-habit sheet
 * @property {string[]} topics                                 — master topic list (max 24)
 * @property {Location[]} locations                            — master location registry (max 32)
 * @property {Object<string,TravelEdge>} travel                — cached travel edges, keyed "idA|idB" (lexically ordered)
 * @property {'driving'|'walking'|'bicycling'|'transit'} defaultTravelMode — mode used for travel-time lookups
 * @property {string|null} lastKnownLocationId                 — matched location id from the last geolocation fix (never stores raw coords)
 * @property {boolean} locationOptIn                           — user granted geolocation; used to resume watch on launch
 * @property {string|null} pinnedLocationId                    — manually-pinned "I am at" id; takes precedence over auto detection so a manual pick isn't immediately overwritten by the next GPS fix
 * @property {number[]} availabilityMinutes                    — 7 entries, minutes free per weekday (Sun-Sat)
 * @property {Object<string,number>} availabilityOverrides     — 'YYYY-MM-DD' -> minutes; wins over weekly
 * @property {{label:string,days:number[],start:number,end:number}[]} blockedTimes — recurring unavailable blocks
 * @property {Object<string,string[]>} cancelledBlocks — day-key → cancelled block signatures for that date only
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
    merged.lastKnownLocationId = cleanLocationId(merged.lastKnownLocationId) || null;
    merged.locationOptIn = Boolean(merged.locationOptIn);
    merged.pinnedLocationId = cleanLocationId(merged.pinnedLocationId) || null;
    merged.availabilityMinutes = normalizeAvailability(merged.availabilityMinutes);
    merged.availabilityOverrides = normalizeAvailabilityOverrides(merged.availabilityOverrides);
    merged.blockedTimes = normalizeBlockedTimes(merged.blockedTimes);
    merged.cancelledBlocks = normalizeCancelledBlocks(merged.cancelledBlocks);
    return merged;
  }catch{
    return {...DEFAULT_SORT_SETTINGS};
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
  next.lastKnownLocationId = cleanLocationId(next.lastKnownLocationId) || null;
  next.locationOptIn = Boolean(next.locationOptIn);
  next.pinnedLocationId = cleanLocationId(next.pinnedLocationId) || null;
  next.availabilityMinutes = normalizeAvailability(next.availabilityMinutes);
  next.availabilityOverrides = normalizeAvailabilityOverrides(next.availabilityOverrides);
  next.blockedTimes = normalizeBlockedTimes(next.blockedTimes);
  next.cancelledBlocks = normalizeCancelledBlocks(next.cancelledBlocks);
  sortSettings = next;
  Storage.write(SORT_SETTINGS_KEY, sortSettings);
}

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION — PURE (no I/O). Validates and coerces raw parsed JSON into
// the canonical Habit / Settings shapes declared above.
// ─────────────────────────────────────────────────────────────────────────

function normalize(items){
  return items.map(raw => {
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
    // a number = the item logs itself that many minutes after its scheduled
    // time (tasks) or timer start. Legacy markDone:false maps to 0 (auto at
    // the trigger); legacy events default to 0 too.
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
    const locationPrefs = normalizeLocationPrefs(raw.locationPrefs, locationIds, raw.preferredLocationId);
    const preferredLocationId = primaryPreferredLocationId(locationPrefs, locationIds);
    const isRhythmHabit = type === 'keepup' || type === 'reduce';
    const breakable = Boolean(raw.breakable);
    const h = {
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
      flexibilityDays,
      durationMinutes:clampDuration(raw.durationMinutes),
      breakable,
      minChunkMinutes:clampMinChunk(raw.minChunkMinutes),
      timerAutoStopMinutes:normalizeTimerAutoStop(raw.timerAutoStopMinutes),
      trackValue:Boolean(raw.trackValue),
      priority:clampPriority(raw.priority),
      locationIds,
      locationPrefs,
      preferredLocationId
    };
    h.lastLog = latestActualLog(h.logs);
    return h;
  });
}

// PURE: true when this item will log itself (no tap required) once its trigger
// fires. Replaces direct checks against the old markDone === false flag.
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
    updateQuotaBar(sizeKb(next));
    return true;
  }catch(e){
    try{
      const pruned = pruneForStorage(normalize(data),QUOTA_HARD_KB - 360);
      const str = JSON.stringify(pruned);
      Storage.writeRaw(KEY, str);
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

// HYBRID: auto-complete event-style items (markDone === false) whose time has
// passed. Two shapes: timed tasks (log at eventTime) and scheduled build-habits
// (log each passed scheduled weekday/monthday day). Adds completion logs,
// cancels scheduled pushes for tasks, and re-renders. Idempotent — safe on a
// timer. Returns the number of items it completed.
function sweepAutoDoneTasks(){
  const data = load();
  const now = Date.now();
  const todayStart = dayStart(now);
  const completedSigs = [];
  let changed = false;
  let count = 0;
  data.forEach(h=>{
    if(h.autoMarkMinutes === null)return;
    if(h.type === 'task'){
      // Trigger: fixed time, or when the task enters the agenda window.
      const trigger = h.eventTime ?? (h.dueDate !== null
        ? dayStart(h.dueDate) - (h.flexibilityDays || 0) * 86400000
        : null);
      if(trigger === null)return;
      if(trigger + (h.autoMarkMinutes || 0) * 60000 >= now)return;
      if(h.lastLog !== null)return; // already done (manual check-off or prior sweep)
      const logs = normalizeLogs(h.logs);
      logs.push(trigger);
      h.logs = normalizeLogs(logs);
      h.lastLog = latestActualLog(h.logs);
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
  if(!changed)return 0;
  save(data);
  if(typeof cancelPush === 'function')completedSigs.forEach(sig=>cancelPush(sig));
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  return count;
}

// ─────────────────────────────────────────────────────────────────────────
// NORMALIZATION PRIMITIVES — PURE. Coercion helpers used by normalize() and
// also called directly from view/settings code. Each is self-contained.
// ─────────────────────────────────────────────────────────────────────────

function sizeKb(data){return Math.round((JSON.stringify(data).length * 2) / 1024);}
function clampRhythmValue(value){
  const n = Number(value);
  if(!Number.isFinite(n))return 7;
  const rounded = Math.round(n * 2) / 2;
  return Math.max(MIN_RHYTHM_DAYS,Math.min(MAX_RHYTHM_DAYS,rounded));
}
/** PURE: split a (possibly fractional) target into {times, days} for UI. */
function rhythmParts(target){
  const t = clampRhythmValue(target);
  if(Math.abs(t - Math.round(t)) < 0.01)return {times:1,days:Math.max(1,Math.round(t))};
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
/** PURE: card/meta label for a rhythm target. */
function formatRhythmLabel(target){
  if(target == null)return '';
  const {times,days} = rhythmParts(target);
  return times === 1 ? `${days}d` : `${times}×/${days}d`;
}
function clampFlexibility(value){
  return Math.max(0,Math.min(60,parseInt(value,10) || DEFAULT_FLEXIBILITY_DAYS));
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
/** PURE: split total minutes into chunks; leftover below min stays as last chunk. */
function planChunks(totalMinutes,minChunkMinutes){
  const total = clampDuration(totalMinutes);
  const min = clampMinChunk(minChunkMinutes);
  if(total <= min)return [total];
  const chunks = [];
  let left = total;
  while(left > min){
    chunks.push(min);
    left -= min;
  }
  if(left > 0)chunks.push(left);
  return chunks;
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
/** PURE: remaining minutes for a breakable item (full duration when nothing logged). */
function remainingDurationMinutes(h){
  const total = clampDuration(h && h.durationMinutes);
  if(!h || !h.breakable)return total;
  return Math.max(0,total - loggedChunkMinutes(h));
}
/** PURE: next chunk sizes still needed for a breakable item. */
function remainingChunks(h){
  const left = remainingDurationMinutes(h);
  if(left <= 0)return [];
  if(!h || !h.breakable)return [left];
  return planChunks(left,h.minChunkMinutes);
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
    return {label,days,start,end,locationId};
  }).filter(Boolean).slice(0,24);
}
/** PURE: stable signature for a blocked-time instance on a given day. */
function blockedInstanceKey(label,startMin,endMin){
  return `${String(label || 'blocked').slice(0,24)}|${startMin}|${endMin}`;
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
// PURE: normalize the home blocked/travel presentation mode.
function normalizeHomeExtraMode(value){
  return (value === 'cards12h' || value === 'text12h') ? value : 'cards';
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
function effectiveLocationWindow(h,loc,weekday){
  const locWin = loc ? resolveLocationWindow(loc,weekday) : {start:0,end:1440};
  if(!locWin)return [];
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
function effectiveAvailabilityMinutes(key,settings = sortSettings){
  const normalized = {...DEFAULT_SORT_SETTINGS,...settings};
  const overrides = normalizeAvailabilityOverrides(normalized.availabilityOverrides);
  if(Object.prototype.hasOwnProperty.call(overrides,key))return overrides[key];
  const d = new Date(`${key}T12:00:00`);
  const weekly = normalizeAvailability(normalized.availabilityMinutes);
  return weekly[d.getDay()] ?? 0;
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
// touching storage. LogEntry = number | {ts:number,plan:true} (see typedef).
// ─────────────────────────────────────────────────────────────────────────

function logTime(log){
  return typeof log === 'number' ? log : Number(log?.ts) || 0;
}
function isPlanLog(log){
  return Boolean(log && typeof log === 'object' && log.plan);
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
function normalizeLogs(logs){
  if(!Array.isArray(logs))return [];
  return logs
    .map(log=>{
      const ts = logTime(log);
      if(!ts)return null;
      if(isPlanLog(log) || (typeof log === 'number' && ts > Date.now()))return {ts,plan:true};
      if(typeof log === 'object'){
        const entry = {ts};
        const value = logValue(log);
        const minutes = logMinutes(log);
        const note = logNote(log);
        if(value !== null)entry.value = value;
        if(minutes !== null)entry.minutes = minutes;
        if(note)entry.note = note;
        if(entry.value !== undefined || entry.minutes !== undefined || entry.note !== undefined)return entry;
      }
      return ts;
    })
    .filter(Boolean)
    .sort((a,b)=>logTime(a)-logTime(b))
    .slice(-MAX_LOGS);
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
  return dateKey(ts) > dateKey(Date.now()) ? {ts,plan:true} : ts;
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

function daysSince(ts){return ts ? Math.floor((Date.now() - ts) / 86400000) : null;}
function dayDistance(ts){return ts ? Math.round((Date.now() - ts) / 86400000) : null;}
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
function hasPreferredDays(h){
  const pref = preferredDays(h);
  return Boolean(pref.weekdays.length || pref.monthDays.length);
}
function hasTimeWindow(h){
  return Number.isFinite(h.allowedTimeStart) && Number.isFinite(h.allowedTimeEnd);
}
function hasPreferredTimeWindow(h){
  return Number.isFinite(h.preferredTimeStart) && Number.isFinite(h.preferredTimeEnd);
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

function avgInterval(logs){
  const sorted = actualLogs(logs);
  if(sorted.length < 2)return null;
  let sum = 0;
  for(let i=1;i<sorted.length;i++)sum += sorted[i] - sorted[i-1];
  return Math.round(sum / (sorted.length - 1) / 86400000);
}
