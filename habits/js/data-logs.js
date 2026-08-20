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
