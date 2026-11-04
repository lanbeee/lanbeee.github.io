// ─────────────────────────────────────────────────────────────────────────
// SCHEDULES — PURE. Compute allowed/preferred day sets for a habit and answer
// eligibility queries. These are the highest-value functions to port verbatim
// because the calendar view, scoring, and add-habit preview all depend on them.
// ─────────────────────────────────────────────────────────────────────────

function scheduledDays(h){
  const general = typeof habitSimpleAllowedDays === 'function'
    ? habitSimpleAllowedDays(h)
    : {
      weekdays:normalizeAllowedWeekdays(h && h.allowedWeekdays),
      monthDays:normalizeAllowedMonthDays(h && h.allowedMonthDays)
    };
  const options = typeof normalizeHabitScheduleOptions === 'function'
    ? normalizeHabitScheduleOptions(h && h.scheduleOptions)
    : [];
  const hasGeneral = typeof hasGeneralAllowedSchedule === 'function'
    ? hasGeneralAllowedSchedule(h)
    : !options.length;
  if(!options.length)return general;
  const optionAllDays = options.some(option=>!option.weekdays.length);
  const optionWeekdays = optionAllDays
    ? []
    : [...new Set(options.flatMap(option=>option.weekdays))].sort((a,b)=>a-b);
  if(!hasGeneral)return {weekdays:optionWeekdays,monthDays:[]};
  if(general.monthDays.length){
    const weekdays = (!general.weekdays.length || optionAllDays)
      ? []
      : [...new Set([...general.weekdays,...optionWeekdays])].sort((a,b)=>a-b);
    return {weekdays,monthDays:[]};
  }
  if(!general.weekdays.length || optionAllDays)return {weekdays:[],monthDays:[]};
  return {
    weekdays:[...new Set([...general.weekdays,...optionWeekdays])].sort((a,b)=>a-b),
    monthDays:[]
  };
}
function preferredDays(h){
  return {
    weekdays:normalizeAllowedWeekdays(h.preferredWeekdays),
    monthDays:normalizeAllowedMonthDays(h.preferredMonthDays),
    ordinalWeekdays:normalizeOrdinalWeekdays(h.preferredOrdinalWeekdays)
  };
}
function hasDaySchedule(h){
  const schedule = scheduledDays(h);
  return Boolean(schedule.weekdays.length || schedule.monthDays.length || normalizeOrdinalWeekdays(h.allowedOrdinalWeekdays).length
    || (typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)));
}
const SCHEDULE_OPPORTUNITY_RATE_CACHE = new Map();
// PURE (memoized): average eligible calendar dates per day. Weekday-only
// schedules have an exact seven-day rate. Month-day schedules use one complete
// 400-year Gregorian cycle so February/leap years, 30/31-day months, and
// weekday + month-day intersections all have a stable exact rate.
function scheduledOpportunityRate(h){
  const general=habitSimpleAllowedDays(h),options=normalizeHabitScheduleOptions(h.scheduleOptions),hasGeneral=hasGeneralAllowedSchedule(h);
  const key=JSON.stringify([general,options.map(o=>[o.weekdays,o.ordinalWeekdays]),hasGeneral]);
  if(SCHEDULE_OPPORTUNITY_RATE_CACHE.has(key))return SCHEDULE_OPPORTUNITY_RATE_CACHE.get(key);
  if(!options.length && !general.monthDays.length && !general.ordinalWeekdays.length)return general.weekdays.length ? general.weekdays.length/7 : 1;
  let count=0;
  for(let year=2000;year<2400;year++)for(let month=0;month<12;month++){
    const last=new Date(year,month+1,0).getDate();
    for(let day=1;day<=last;day++){
      const d=new Date(year,month,day,12),wd=d.getDay(),ts=d.getTime();
      const hit=(weekdays,monthDays,rules)=>(!weekdays.length || weekdays.includes(wd)) && (!monthDays.length || monthDays.includes(day)) && matchesOrdinalWeekdays(rules,ts);
      if((hasGeneral && hit(general.weekdays,general.monthDays,general.ordinalWeekdays)) || options.some(o=>hit(o.weekdays,[],o.ordinalWeekdays)))count++;
    }
  }
  const rate=count/146097;SCHEDULE_OPPORTUNITY_RATE_CACHE.set(key,rate);return rate;
}
// PURE: true when the requested completion rate consumes every eligible date.
// Examples: 3x/7d on Tue/Fri/Sat, 2x/7d on Fri/Sat, or 2x/30d on month days
// 1 and 2. In these cases calendar-gap spacing must yield to the constrained
// schedule, including adjacent eligible dates.
function rhythmFillsEveryEligibleDay(h){
  if(isOpportunityHabit(h))return false;
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
  return Boolean(pref.weekdays.length || pref.monthDays.length || pref.ordinalWeekdays.length);
}
function hasTimeWindow(h){
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h))return true;
  if(typeof hasSimpleAllowedTimeWindow === 'function')return hasSimpleAllowedTimeWindow(h);
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
  if(!pref.weekdays.length && !pref.monthDays.length && !pref.ordinalWeekdays.length)return false;
  const d = new Date(ts);
  if(pref.weekdays.length && !pref.weekdays.includes(d.getDay()))return false;
  if(pref.monthDays.length && !pref.monthDays.includes(d.getDate()))return false;
  if(!matchesOrdinalWeekdays(pref.ordinalWeekdays,ts))return false;
  return true;
}
function isDateEligibleForHabit(h,ts = Date.now()){
  if(isLocalAppointment(h))return Boolean(appointmentOccurrence(h,dateKey(ts)));
  const optionHit = typeof hasHabitScheduleOptions === 'function'
    && hasHabitScheduleOptions(h)
    && typeof habitScheduleOptionsForDay === 'function'
    && habitScheduleOptionsForDay(h,typeof dayStart === 'function' ? dayStart(ts) : ts).length > 0;
  const hasGeneral = typeof hasGeneralAllowedSchedule === 'function'
    ? hasGeneralAllowedSchedule(h)
    : !optionHit;
  if(hasGeneral){
    const generalHit = typeof isDateEligibleForGeneralSchedule === 'function'
      ? isDateEligibleForGeneralSchedule(h,ts)
      : true;
    return generalHit || optionHit;
  }
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h))return optionHit;
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
    const ts = offsetCalendarDay(base,offset);
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
// day-of schedule (if any) allows it. The early window only moves readiness
// toward the present; delayAllowanceDays is handled by week placement.
function taskReadyDate(h){
  if(h.type !== 'task')return null;
  const when = taskWhen(h);
  if(when === null)return null;
  const window = Math.max(0,habitEarlyWindowDays(h));
  return offsetCalendarDay(when,-window);
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
  if(h.allowedTimeFixedStart === true && !hasHabitScheduleOptions(h)){
    const start = cleanAnchor(h.allowedTimeStartAnchor)
      ? habitEndpointLabel(h,'allowedTimeStart') : formatTimeShort(h.allowedTimeStart);
    return `starts ${start}`;
  }
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
    const count = normalizeHabitScheduleOptions(h.scheduleOptions).length;
    const optionLabel = `${count} time/place ${count === 1 ? 'option' : 'options'}`;
    if(typeof hasSimpleAllowedTimeWindow === 'function' && hasSimpleAllowedTimeWindow(h)){
      const startAnchor = cleanAnchor(h.allowedTimeStartAnchor);
      const endAnchor = cleanAnchor(h.allowedTimeEndAnchor);
      const general = h.allowedTimeFixedStart === true
        ? timeWindowSummary(habitBoundToGeneralSchedule(h))
        : startAnchor || endAnchor
        ? `${startAnchor
          ? (typeof habitEndpointLabel === 'function' ? habitEndpointLabel(h,'allowedTimeStart') : prayerAnchorLabel(startAnchor,h.allowedTimeStartOffsetMin))
          : formatTimeShort(h.allowedTimeStart)}–${endAnchor
          ? (typeof habitEndpointLabel === 'function' ? habitEndpointLabel(h,'allowedTimeEnd') : prayerAnchorLabel(endAnchor,h.allowedTimeEndOffsetMin))
          : formatTimeShort(h.allowedTimeEnd)}`
        : `${formatTimeShort(h.allowedTimeStart)}–${formatTimeShort(h.allowedTimeEnd)}`;
      return `${general} + ${optionLabel}`;
    }
    return optionLabel;
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
  if(normalizeOrdinalWeekdays(h.allowedOrdinalWeekdays).length)parts.push(ordinalWeekdaySummary(h.allowedOrdinalWeekdays));
  const tw = timeWindowSummary(h);
  if(tw)parts.push(tw);
  return parts.join(' ');
}
function preferredSummary(h){
  const pref = preferredDays(h);
  const parts = [];
  if(pref.weekdays.length)parts.push(pref.weekdays.map(weekdayShort).join('/'));
  if(pref.monthDays.length)parts.push(pref.monthDays.map(monthOrdinal).join('/'));
  if(pref.ordinalWeekdays.length)parts.push(ordinalWeekdaySummary(pref.ordinalWeekdays));
  return parts.join(' and ');
}
