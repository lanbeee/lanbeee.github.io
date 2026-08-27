// ─────────────────────────────────────────────────────────────────────────
// SCHEDULES — PURE. Compute allowed/preferred day sets for a habit and answer
// eligibility queries. These are the highest-value functions to port verbatim
// because the calendar view, scoring, and add-habit preview all depend on them.
// ─────────────────────────────────────────────────────────────────────────

function scheduledDays(h){
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
    const options = normalizeHabitScheduleOptions(h.scheduleOptions);
    const weekdays = options.some(option=>!option.weekdays.length)
      ? []
      : [...new Set(options.flatMap(option=>option.weekdays))].sort((a,b)=>a-b);
    return {weekdays,monthDays:[]};
  }
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
  return Boolean(schedule.weekdays.length || schedule.monthDays.length
    || (typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)));
}
const SCHEDULE_OPPORTUNITY_RATE_CACHE = new Map();
// PURE (memoized): average eligible calendar dates per day. Weekday-only
// schedules have an exact seven-day rate. Month-day schedules use one complete
// 400-year Gregorian cycle so February/leap years, 30/31-day months, and
// weekday + month-day intersections all have a stable exact rate.
function scheduledOpportunityRate(h){
  const schedule = scheduledDays(h);
  const effectiveWeekdays = schedule.weekdays;
  if(!effectiveWeekdays.length && !schedule.monthDays.length)return 1;
  if(!schedule.monthDays.length)return effectiveWeekdays.length / 7;
  const key = `${effectiveWeekdays.join(',')}|${schedule.monthDays.join(',')}`;
  if(SCHEDULE_OPPORTUNITY_RATE_CACHE.has(key))return SCHEDULE_OPPORTUNITY_RATE_CACHE.get(key);
  const weekdays = new Set(effectiveWeekdays);
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
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h))return true;
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
function formatTimeShort(minutes){
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2,'0')}${ampm}`;
}
function timeWindowSummary(h){
  if(!hasTimeWindow(h))return '';
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
    const count = normalizeHabitScheduleOptions(h.scheduleOptions).length;
    return `${count} time/place ${count === 1 ? 'option' : 'options'}`;
  }
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
