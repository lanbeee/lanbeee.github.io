// Local storage, normalization, quota pruning, and date/text helpers.
//
// ─────────────────────────────────────────────────────────────────────────
// DATA SCHEMAS — JSDoc typedefs
// Source of truth for Habit and Settings shapes. Mirrors the normalize()
// output below. When porting to React Native, these become TypeScript
// interfaces in src/types/ with no field changes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * A single log entry. Either a timestamp (ms since epoch) for an actual
 * occurrence, or a planned-future entry wrapping that timestamp.
 * @typedef {(number|{ts:number,plan:true})} LogEntry
 */

/**
 * A habit. Stored in the habits array under the `tings_v2` localStorage key.
 * The same record shape expresses all four item kinds via `type`; the fields
 * below marked with TaskFields only carry meaning for that type.
 * @typedef {Object} Habit
 * @property {string} name                    — display name (max 60 chars)
 * @property {'keepup'|'reduce'|'zero'|'task'} type  — build / limit / stop / one-off
 * @property {number|null} target             — rhythm in days; null when type in zero/task
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
 * @property {number|null} lastLog            — derived: most recent actual log timestamp
 * @property {number|null} createdAt          — ms timestamp set at creation; secondary sort key + "added Nd ago" copy. null on legacy records.
 *
 * — TaskFields (additional semantics when type === 'task') —
 * @property {number|null} dueDate            — ms day-level timestamp, or null for a "someday" task
 * @property {number|null} eventTime          — ms timestamp at the exact minute when this task is scheduled; null = no fixed time (dated or someday)
 * @property {boolean} hardDue                — true when dueDate is a real deadline (escalates urgency past it)
 * @property {boolean} markDone               — true (default) when you must tap to complete it; false = event-style, auto-completes once eventTime passes
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
 * @property {boolean} showScheduledTasksInAgenda              — include fixed-time tasks in Today agenda
 * @property {boolean} showDueTasksInAgenda                    — include untimed tasks due today in Today agenda
 * @property {boolean} showPlannedItemsInAgenda                — include planned-today items in Today agenda
 * @property {boolean} showDueHabitsInAgenda                   — include ready habits in Today agenda
 * @property {boolean} reachAssist                             — pull-down-at-top gesture lowers first cards
 * @property {'keepup'|'reduce'|'zero'} defaultType            — type prefilled in the add-habit sheet
 * @property {number} defaultTarget                            — rhythm prefilled in the add-habit sheet
 * @property {string[]} topics                                 — master topic list (max 24)
 * @property {number[]} availabilityMinutes                    — 7 entries, minutes free per weekday (Sun-Sat)
 * @property {Object<string,number>} availabilityOverrides     — 'YYYY-MM-DD' -> minutes; wins over weekly
 * @property {{label:string,days:number[],start:number,end:number}[]} blockedTimes — recurring unavailable blocks
 */

/**
 * Day-of-week + day-of-month schedule pair returned by scheduledDays()/preferredDays().
 * Empty arrays mean "no restriction in this dimension".
 * @typedef {Object} DaySchedule
 * @property {number[]} weekdays    — 0=Sun … 6=Sat
 * @property {number[]} monthDays   — 1-31
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
    merged.availabilityMinutes = normalizeAvailability(merged.availabilityMinutes);
    merged.availabilityOverrides = normalizeAvailabilityOverrides(merged.availabilityOverrides);
    merged.blockedTimes = normalizeBlockedTimes(merged.blockedTimes);
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
  next.availabilityMinutes = normalizeAvailability(next.availabilityMinutes);
  next.availabilityOverrides = normalizeAvailabilityOverrides(next.availabilityOverrides);
  next.blockedTimes = normalizeBlockedTimes(next.blockedTimes);
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
    const hardDue = type === 'task' ? Boolean(raw.hardDue) : false;
    // markDone: explicit values are preserved for every type. Default is
    // event-style (false) for legacy events, manual (true) for everything else.
    const markDone = Object.prototype.hasOwnProperty.call(raw,'markDone')
      ? Boolean(raw.markDone)
      : !wasEvent;
    const logs = normalizeLogs(raw.logs);
    // A past legacy event has already happened — record it as a completed entry so it
    // fades into history instead of nagging as an overdue task.
    if(wasEvent && eventTime !== null && eventTime < Date.now() && !logs.some(l=>logTime(l) === eventTime)){
      logs.push(eventTime);
    }
    const h = {
      name: raw.name || '',
      type,
      target: (type === 'zero' || type === 'task')
        ? null
        : clampRhythmValue(raw.target || 7),
      dueDate,
      hardDue,
      markDone,
      eventTime,
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
      flexibilityDays:clampFlexibility(raw.flexibilityDays),
      durationMinutes:clampDuration(raw.durationMinutes)
    };
    h.lastLog = latestActualLog(h.logs);
    return h;
  });
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
    if(h.markDone !== false)return;
    if(h.type === 'task'){
      if(h.eventTime === null || h.eventTime >= now)return;
      if(h.lastLog !== null)return; // already done (manual check-off or prior sweep)
      const logs = normalizeLogs(h.logs);
      logs.push(h.eventTime);
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
  const n = parseInt(value,10);
  if(isNaN(n))return 7;
  return Math.max(1,Math.min(MAX_RHYTHM_DAYS,n));
}
function clampFlexibility(value){
  return Math.max(0,Math.min(60,parseInt(value,10) || DEFAULT_FLEXIBILITY_DAYS));
}
function clampDuration(value){
  return Math.max(1,Math.min(720,parseInt(value,10) || DEFAULT_DURATION_MINUTES));
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
    return {label,days,start,end};
  }).filter(Boolean).slice(0,24);
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
function normalizeLogs(logs){
  if(!Array.isArray(logs))return [];
  return logs
    .map(log=>{
      const ts = logTime(log);
      if(!ts)return null;
      if(isPlanLog(log) || (typeof log === 'number' && ts > Date.now()))return {ts,plan:true};
      return ts;
    })
    .filter(Boolean)
    .sort((a,b)=>logTime(a)-logTime(b))
    .slice(-MAX_LOGS);
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
