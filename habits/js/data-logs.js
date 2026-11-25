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
function logOccurrenceKey(log){
  if(!log || typeof log !== 'object' || isPlanLog(log))return '';
  return String(log.occurrenceKey || '').slice(0,160);
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
        const occurrenceKey = logOccurrenceKey(log);
        const optionId = String(log.scheduleOptionId || '').slice(0,64);
        const scheduledDay = /^\d{4}-\d{2}-\d{2}$/.test(String(log.scheduledDay || ''))
          ? String(log.scheduledDay) : '';
        if(occurrenceKey)entry.occurrenceKey = occurrenceKey;
        if(optionId)entry.scheduleOptionId = optionId;
        if(scheduledDay)entry.scheduledDay = scheduledDay;
        if(log.source === 'location_visit' && /^[0-9a-f]{32}$/.test(log.visitId || ''))entry.visitId = log.visitId;
        if(log.source === 'calendar')entry.source = 'calendar';
        if(['shared_display','native_alarm','native_widget','location_visit'].includes(log.source) && /^[0-9a-f]{32}$/.test(String(log.operationId || ''))){
          entry.source = log.source;
          entry.operationId = String(log.operationId);
        }
        if(entry.value !== undefined || entry.minutes !== undefined || entry.note !== undefined
          || entry.source || entry.occurrenceKey)return entry;
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
  const occurrenceKey = String(opts.occurrenceKey || '').slice(0,160);
  const optionId = String(opts.scheduleOptionId || '').slice(0,64);
  const scheduledDay = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.scheduledDay || ''))
    ? String(opts.scheduledDay) : '';
  if(occurrenceKey)entry.occurrenceKey = occurrenceKey;
  if(optionId)entry.scheduleOptionId = optionId;
  if(scheduledDay)entry.scheduledDay = scheduledDay;
  if(['shared_display','native_alarm','native_widget','location_visit'].includes(opts.source) && /^[0-9a-f]{32}$/.test(String(opts.operationId || ''))){
    entry.source = opts.source;
    entry.operationId = String(opts.operationId);
  }
  if(opts.source === 'location_visit' && /^[0-9a-f]{32}$/.test(opts.visitId || ''))entry.visitId = opts.visitId;
  if(entry.value === undefined && entry.minutes === undefined && entry.note === undefined
    && !entry.source && !entry.occurrenceKey)return ts;
  return entry;
}
function makeLog(ts){
  return dateKey(ts) > dateKey(Date.now()) ? makePlanLog(ts) : ts;
}
function latestActualLog(logs){
  const actual = actualLogs(logs);
  return actual.length ? actual[actual.length - 1] : null;
}

function hasPlannedEntryForDay(h,key){
  return plannedLogs(h.logs).some(ts=>dateKey(ts) === key);
}

function hasScheduledMarkerForDay(h,key){
  if(typeof habitPlanMarkers === 'function'){
    return habitPlanMarkers(h).some(marker=>dateKey(marker.ts) === key);
  }
  return (
    (isTimedTask(h) && h.lastLog === null && dateKey(h.eventTime) === key)
    || (h.type === 'task' && h.eventTime === null && h.dueDate !== null
      && h.lastLog === null && dateKey(h.dueDate) === key)
    || ((h.type === 'keepup' || h.type === 'reduce') && h.planByDate
      && dateKey(h.planByDate) === key)
  );
}

function hasPlannedToday(h){
  const today = dateKey(Date.now());
  return hasPlannedEntryForDay(h,today) || hasScheduledMarkerForDay(h,today);
}

function nextPlannedLog(h){
  return plannedLogs(h.logs)[0] || null;
}

function intervalValues(h,limit = null){
  const logs = actualLogs(h.logs);
  if(!logs.length)return [];
  const intervals = [];
  for(let i = 1;i < logs.length;i += 1){
    intervals.push(Math.max(1,Math.round((logs[i] - logs[i - 1]) / 86400000)));
  }
  intervals.push(Math.max(1,daysSince(logs[logs.length - 1]) || 1));
  return limit ? intervals.slice(-limit) : intervals;
}

// `precomputed` optionally carries gap intervals already derived from a
// render's own logs scan (parity with intervalValues' semantics is the
// caller's duty; the detail summary test pins it). Existing callers unchanged.
function intervalToneSummary(h,precomputed = null){
  const intervals = precomputed || intervalValues(h,14);
  if(!intervals.length)return {hit:0,warn:0,miss:0,label:'no gap history'};
  const counts = intervals.reduce((acc,days)=>{
    const cls = intervalTone(h,days) || 'miss';
    acc[cls] = (acc[cls] || 0) + 1;
    return acc;
  },{hit:0,warn:0,miss:0});
  const total = intervals.length || 1;
  const hit = Math.round(counts.hit / total * 100);
  const warn = Math.round(counts.warn / total * 100);
  const miss = Math.max(0,100 - hit - warn);
  const label = counts.hit >= counts.warn + counts.miss
    ? 'mostly good'
    : counts.miss > counts.hit ? 'needs care' : 'mixed';
  return {hit,warn,miss,label};
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
// Local calendar arithmetic keeps day-based flexibility at midnight across DST.
function offsetCalendarDay(ts,offset){
  const date = new Date(dayStart(ts));
  date.setDate(date.getDate() + offset);
  return date.getTime();
}
function dayStart(ts){
  const d = new Date(ts);
  return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
}
/** PURE: sorted YYYY-MM-DD dates marked as snoozed on a habit. */
function habitSnoozedDates(h){
  if(!h || !Array.isArray(h.snoozedDates) || !h.snoozedDates.length)return [];
  return typeof normalizeSnoozedDates === 'function'
    ? normalizeSnoozedDates(h.snoozedDates)
    : h.snoozedDates.filter(k=>typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k));
}
/** PURE: today-or-future YYYY-MM-DD dates marked as snoozed on a habit. */
function habitUpcomingSnoozedDates(h, now = Date.now()){
  const today = dateKey(now);
  return habitSnoozedDates(h).filter(key=>key >= today);
}
/** PURE: true when a habit's snoozedDates explicitly includes dayTs's calendar date. */
function habitHasSnoozedDate(h, dayTs){
  if(!h || !Array.isArray(h.snoozedDates) || !h.snoozedDates.length)return false;
  const key = typeof dayTs === 'string' ? dayTs : dateKey(dayTs);
  return h.snoozedDates.includes(key);
}
/** PURE: true while a habit is hidden right now by an active snooze or today's snoozedDates. */
function habitIsSnoozed(h, now = Date.now()){
  if(!h)return false;
  if(h.snoozedUntil && now < h.snoozedUntil)return true;
  return habitHasSnoozedDate(h, now);
}
/** PURE: true when a habit is snoozed on a specific calendar day (planner gate). */
function habitIsSnoozedOnDay(h, dayTs, now = Date.now()){
  if(!h)return false;
  if(h.snoozedUntil && now < h.snoozedUntil)return true;
  return habitHasSnoozedDate(h, dayTs);
}
/** PURE: timestamp when a currently snoozed habit next becomes active, or null. */
function habitSnoozeReturnTs(h, now = Date.now()){
  if(!habitIsSnoozed(h, now))return null;
  let ts = (h.snoozedUntil && now < h.snoozedUntil) ? h.snoozedUntil : null;
  const dates = habitSnoozedDates(h);
  if(dates.length){
    const set = new Set(dates);
    if(set.has(dateKey(now))){
      let cursor = dayStart(now);
      let guard = 0;
      while(set.has(dateKey(cursor)) && guard < 400){
        const next = new Date(cursor);
        next.setDate(next.getDate() + 1);
        cursor = dayStart(next.getTime());
        guard += 1;
      }
      if(!ts || cursor > ts)ts = cursor;
    }
    if(ts != null && set.has(dateKey(ts))){
      let cursor = dayStart(ts);
      let guard = 0;
      while(set.has(dateKey(cursor)) && guard < 400){
        const next = new Date(cursor);
        next.setDate(next.getDate() + 1);
        cursor = dayStart(next.getTime());
        guard += 1;
      }
      if(cursor > ts)ts = cursor;
    }
  }
  return ts;
}
/** PURE: remove a single calendar day from h.snoozedDates (returns true if changed). */
function clearSnoozedDateForDay(h, ts = Date.now()){
  if(!h || !Array.isArray(h.snoozedDates) || !h.snoozedDates.length)return false;
  const key = typeof ts === 'string' ? ts : dateKey(ts);
  const next = h.snoozedDates.filter(k=>k !== key);
  if(next.length === h.snoozedDates.length)return false;
  h.snoozedDates = next;
  return true;
}
/** PURE: local timestamp for a picked YYYY-MM-DD date and optional HH:MM time (rejects DST gaps). */
function parseSnoozeDateUntil(dateStr, timeStr = ''){
  const cleanDate = String(dateStr || '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate))return null;
  const [y,m,d] = cleanDate.split('-').map(Number);
  const cleanTime = String(timeStr || '').trim();
  let hours = 0, minutes = 0;
  if(cleanTime){
    if(!/^\d{2}:\d{2}$/.test(cleanTime))return null;
    [hours,minutes] = cleanTime.split(':').map(Number);
    if(hours < 0 || hours > 23 || minutes < 0 || minutes > 59)return null;
  }
  const dt = new Date(y,m - 1,d,hours,minutes,0,0);
  if(dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d)return null;
  if(dt.getHours() !== hours || dt.getMinutes() !== minutes)return null;
  return dt.getTime();
}
/** PURE: midnight at the start of tomorrow — “until the end of today”. */
function snoozeUntilEndOfDay(now = Date.now()){
  return dayStart(now) + 86400000;
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

// PURE: finds an exact actual/planned log entry
function findEntryByKind(logs,ts,plan){
  return logs.findIndex(log=>logTime(log) === ts && isPlanLog(log) === Boolean(plan));
}

// PURE: picks the plan that should be consumed by a real entry on the same day.
function planToConsumeForEntry(logs,entryTs){
  const key = dateKey(entryTs);
  const planned = normalizeLogs(logs)
    .filter(log=>isPlanLog(log) && dateKey(logTime(log)) === key)
    .map(logTime);
  if(!planned.length)return null;
  return planned.sort((a,b)=>Math.abs(a - entryTs) - Math.abs(b - entryTs))[0];
}

// Shared completion mutation for interactive and headless callers. Persistence,
// transport and feedback belong to the caller; occurrence identity stays here.
function recordHabitCompletion(h,opts = {}){
  const now=opts.at;
  const logs=normalizeLogs(h.logs);
  const consumedPlanTs=opts.consumePlan === false ? null : planToConsumeForEntry(logs,now);
  const entryTs=opts.preserveTimestamp ? now : snapLogTimestamp(h,now);
  const entry=makeActualLog(entryTs,opts);
  if(consumedPlanTs !== null){
    const pos=findEntryByKind(logs,consumedPlanTs,true);
    if(pos>=0)logs.splice(pos,1);
  }
  h.logs=normalizeLogs([...logs,entry]);
  h.lastLog=latestActualLog(h.logs);
  h.snoozedUntil=null;
  clearSnoozedDateForDay(h,entryTs);
  if(typeof clearPlanByDateOnLog==='function')clearPlanByDateOnLog(h);
  if(typeof pruneOrderConstraintsOnLog==='function')pruneOrderConstraintsOnLog(h);
  return {entry,entryTs,consumedPlanTs};
}
