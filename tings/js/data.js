// Local storage, normalization, quota pruning, and date/text helpers.

function load(){
  try{return normalize(JSON.parse(localStorage.getItem(KEY)) || []);}
  catch{return [];}
}

function loadSortSettings(){
  try{
    const saved = JSON.parse(localStorage.getItem(SORT_SETTINGS_KEY)) || {};
    const migrated = saved && !saved.preset && Object.keys(saved).length ? {...saved,preset:'custom'} : saved;
    const merged = {...DEFAULT_SORT_SETTINGS,...migrated};
    if(saved && !Object.prototype.hasOwnProperty.call(saved,'stopMode')){
      merged.stopMode = saved.keepStopsQuiet ? 'quiet' : DEFAULT_SORT_SETTINGS.stopMode;
    }
    if(merged.preset && merged.preset !== 'custom' && !SORT_PRESETS[merged.preset])merged.preset = 'custom';
    delete merged.keepStopsQuiet;
    delete merged.requireConfirm;
    delete merged.focusSearchOnOpen;
    merged.topics = normalizeTopics(merged.topics);
    merged.availabilityMinutes = normalizeAvailability(merged.availabilityMinutes);
    merged.availabilityOverrides = normalizeAvailabilityOverrides(merged.availabilityOverrides);
    return merged;
  }catch{
    return {...DEFAULT_SORT_SETTINGS};
  }
}

function saveSortSettings(settings){
  const next = {...DEFAULT_SORT_SETTINGS,...settings};
  delete next.keepStopsQuiet;
  next.topics = normalizeTopics(next.topics);
  next.availabilityMinutes = normalizeAvailability(next.availabilityMinutes);
  next.availabilityOverrides = normalizeAvailabilityOverrides(next.availabilityOverrides);
  sortSettings = next;
  localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(sortSettings));
}

function normalize(items){
  return items.map(h => ({
    name: h.name || '',
    type: h.type || 'keepup',
    target: h.type === 'zero' ? null : clampRhythmValue(h.target || 7),
    logs: normalizeLogs(h.logs),
    emoji: h.emoji || '',
    pinned:Boolean(h.pinned),
    sample:Boolean(h.sample),
    snoozedUntil: h.snoozedUntil || null,
    topics:normalizeTopics(h.topics),
    allowedWeekdays:normalizeAllowedWeekdays(h.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(h.allowedMonthDays),
    flexibilityDays:clampFlexibility(h.flexibilityDays),
    durationMinutes:clampDuration(h.durationMinutes)
  })).map(h => ({...h,lastLog:latestActualLog(h.logs)}));
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
    localStorage.setItem(KEY,str);
    updateQuotaBar(sizeKb(next));
    return true;
  }catch(e){
    try{
      const pruned = pruneForStorage(normalize(data),QUOTA_HARD_KB - 360);
      const str = JSON.stringify(pruned);
      localStorage.setItem(KEY,str);
      updateQuotaBar(sizeKb(pruned));
      showToast('old dense activity compacted');
      return true;
    }catch{
      alert('storage full - remove some habits first');
      return false;
    }
  }
}

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
function daysSince(ts){return ts ? Math.floor((Date.now() - ts) / 86400000) : null;}
function dayDistance(ts){return ts ? Math.round((Date.now() - ts) / 86400000) : null;}
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
function scheduledDays(h){
  return {
    weekdays:normalizeAllowedWeekdays(h.allowedWeekdays),
    monthDays:normalizeAllowedMonthDays(h.allowedMonthDays)
  };
}
function hasDaySchedule(h){
  const schedule = scheduledDays(h);
  return Boolean(schedule.weekdays.length || schedule.monthDays.length);
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
function scheduleSummary(h){
  const schedule = scheduledDays(h);
  const parts = [];
  if(schedule.weekdays.length)parts.push(schedule.weekdays.map(weekdayShort).join('/'));
  if(schedule.monthDays.length)parts.push(schedule.monthDays.map(monthOrdinal).join('/'));
  return parts.join(' and ');
}
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
