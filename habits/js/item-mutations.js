// Bulk item mutation layer. Field operations, applicability, validation and
// diffs shared by the bulk add and bulk edit flows. Every function is pure
// with respect to the records passed in; DOM work stays in bulk-add.js and
// bulk-edit.js.
//
// Representation rules: an operation is {id, op, value}. op === 'keep' means
// unchanged and is never applied. null / false / [] can all be intentional
// values, so nothing here decides "should I apply this" by truthiness — only
// the explicit op key matters. apply() replaces the values it changes and returns the names of those
// fields so a preview can compare them without cloning unrelated fields.

function bulkClone(value){
  if(typeof structuredClone === 'function')return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function bulkSameValue(a,b){
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// Calendar imports own their mapped fields: a re-import rewrites them, so
// bulk edits there would be silently lost. Personalization (icon, topics,
// places, snooze…) stays available. Device items are handled at the picker.
function bulkImportOwnedFields(record){
  if(!record || !record.source || record.source === 'device')return new Set();
  const fields = new Set(['name','eventTime','dueDate','autoMarkMinutes','durationMinutes']);
  if(record.source !== 'ics'){
    fields.add('breakable');
    fields.add('priority');
  }
  return fields;
}

const bulkImportOwnedCache = {};
function bulkOpImportOwned(opId){
  if(!(opId in bulkImportOwnedCache)){
    const opDesc = bulkOpById(opId);
    const touched = opDesc ? bulkOpTouchedFields(opDesc) : [];
    bulkImportOwnedCache[opId] = touched;
  }
  return bulkImportOwnedCache[opId];
}

function bulkOpBlocked(record,opDesc){
  if(isDeviceCalendarTask(record))return 'managed by your phone calendar';
  const owned = bulkImportOwnedFields(record);
  if(owned.size && bulkOpImportOwned(opDesc.id).some(field=>owned.has(field)))return 'owned by the calendar import';
  return '';
}

// How many of the selected items an operation can touch, with reasons for the
// rest. data is the full saved list; records are the selected raw records.
function bulkApplicability(opDesc,records,data,value){
  let ok = 0;
  const excluded = {};
  for(const record of records){
    const reason = bulkOpUnavailable(record,opDesc,data,value);
    if(reason)excluded[reason] = (excluded[reason] || 0) + 1;
    else ok += 1;
  }
  return {ok,excluded};
}

function bulkOpUnavailable(record,desc,data,value){
  return bulkOpBlocked(record,desc)
    || (!desc.applies(record,data,value) ? desc.blockedReason?.(record,value) || 'not available for this item' : '');
}

// Local calendar appointments carry their own rule object; normalize() forces
// time, effort and recurrence fields from it, so bulk edits to those fields
// would be silently discarded. Everything else stays editable.
function bulkAppointmentOwned(record){
  return Boolean(record && record.appointment);
}

const BULK_WINDOW_FIELDS = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];

// Replace one time-window endpoint family. Setting fixed minutes must clear
// the whole anchor/offset/combine family for that endpoint — leaving any of
// them behind would keep the old anchor in charge after save().
function bulkWriteTimeEndpoint(record,prefix,fixedStart,endMinutes){
  const patch = {
    [prefix]:endMinutes,
    [prefix + 'Anchor']:null,
    [prefix + 'OffsetMin']:0,
    [prefix + 'AnchorHabitId']:null,
    [prefix + 'Combine']:null,
    [prefix + 'Anchor2']:null,
    [prefix + 'OffsetMin2']:0,
    [prefix + 'AnchorHabitId2']:null,
    [prefix + 'FixedMin2']:null,
    [prefix + 'DayOffset']:0,
    [prefix + 'DayOffset2']:0
  };
  if(prefix === 'allowedTimeStart' && typeof fixedStart === 'boolean'){
    patch.allowedTimeFixedStart = fixedStart;
  }
  Object.assign(record,patch);
  return Object.keys(patch);
}

function bulkClearTimeEndpoint(record,prefix){
  return bulkWriteTimeEndpoint(record,prefix,prefix === 'allowedTimeStart' ? false : undefined,null);
}

// ─────────────────────────────────────────────────────────────────────────
// Operation catalog. Order matters: common settings render first.
// ─────────────────────────────────────────────────────────────────────────
const BULK_KEEP = {key:'keep',label:'Keep unchanged'};

function bulkExtraOps(extra){
  if(!extra)return [];
  return Array.isArray(extra) ? extra : [extra];
}

function bulkOnOff(extra){
  return [BULK_KEEP,{key:'on',label:'On'},{key:'off',label:'Off'},...bulkExtraOps(extra)];
}

function bulkKeepSet(extra){
  return [BULK_KEEP,{key:'set',label:'Set'},...bulkExtraOps(extra)];
}

// Preserve unrelated topics: add/remove reconcile around the existing list.
function bulkApplyTopics(record,op,value){
  const current = Array.isArray(record.topics) ? record.topics.map(cleanTopic).filter(Boolean) : [];
  let next = current;
  if(op === 'add'){
    const add = (Array.isArray(value) ? value : [value]).map(cleanTopic).filter(Boolean);
    next = current.slice();
    for(const topic of add)if(!next.some(t=>t.toLowerCase() === topic.toLowerCase()))next.push(topic);
  }else if(op === 'remove'){
    const drop = new Set((Array.isArray(value) ? value : [value]).map(v=>cleanTopic(v).toLowerCase()).filter(Boolean));
    next = current.filter(topic=>!drop.has(topic.toLowerCase()));
  }else if(op === 'replace'){
    next = Array.isArray(value) ? value : [];
  }else if(op === 'clear'){
    next = [];
  }
  record.topics = normalizeTopics(next);
  return ['topics'];
}

function bulkCleanPlaceId(value){
  return typeof cleanLocationId === 'function' ? cleanLocationId(value) : String(value || '').trim().slice(0,48);
}

// Removing a place reconciles its preference without touching other places;
// the saved normalize() drops prefs for places the item no longer allows.
function bulkApplyPlaces(record,op,value){
  const current = Array.isArray(record.locationIds) ? record.locationIds.map(bulkCleanPlaceId).filter(Boolean) : [];
  let next = current;
  if(op === 'add'){
    const add = (Array.isArray(value) ? value : [value]).map(bulkCleanPlaceId).filter(Boolean);
    next = current.slice();
    for(const id of add)if(!next.includes(id))next.push(id);
    record.locationIds = next;
    return ['locationIds'];
  }
  if(op === 'remove'){
    const drop = new Set((Array.isArray(value) ? value : [value]).map(bulkCleanPlaceId).filter(Boolean));
    next = current.filter(id=>!drop.has(id));
    const prefs = record.locationPrefs && typeof record.locationPrefs === 'object' ? {...record.locationPrefs} : {};
    let prefsChanged = false;
    for(const id of drop)if(id in prefs){delete prefs[id];prefsChanged = true;}
    if(prefsChanged)record.locationPrefs = prefs;
    if(!next.length)record.anywhereAllowed = true;
  }else if(op === 'replace'){
    next = (Array.isArray(value) ? value : []).map(bulkCleanPlaceId).filter(Boolean);
  }else if(op === 'anywhere'){
    next = [];
    record.anywhereAllowed = true;
    record.locationPrefs = {};
    record.preferredLocationId = null;
  }
  record.locationIds = next;
  const allowed = habitPrefLocationIds(record);
  record.locationPrefs = normalizeLocationPrefs(record.locationPrefs,allowed);
  record.preferredLocationId = primaryPreferredLocationId(record.locationPrefs,allowed);
  return ['locationIds','anywhereAllowed','locationPrefs','preferredLocationId'];
}

function bulkWeekdayLabel(days){
  if(!Array.isArray(days) || days.length === 0 || days.length === 7)return 'every day';
  return WEEKDAY_LABELS.filter((_,day)=>days.includes(day)).join(' ');
}

function bulkApplyWeekdays(record,field,op,value){
  record[field] = op === 'clear' ? [] : normalizeAllowedWeekdays(value);
  return [field];
}

function bulkMonthDayLabel(days){
  if(!Array.isArray(days) || !days.length)return 'any date';
  return days.join(', ');
}

function bulkApplyMonthDays(record,field,op,value){
  record[field] = op === 'clear' ? [] : normalizeAllowedMonthDays(value);
  return [field];
}

function bulkOrdinalLabel(rules){
  if(!Array.isArray(rules) || !rules.length)return 'none';
  const names = {1:'first',2:'second',3:'third',4:'fourth',5:'fifth','-1':'last'};
  return rules.map(rule=>`${names[rule.ordinal] || rule.ordinal} ${WEEKDAY_LABELS[rule.weekday] || '?'}`).join(', ');
}

function bulkApplyOrdinals(record,field,op,value){
  record[field] = op === 'clear' ? [] : normalizeOrdinalWeekdays(value);
  return [field];
}

function bulkMinutesLabel(minutes){
  return minutes == null ? 'not set' : minutes + ' min';
}

function bulkTimeLabel(record,prefix){
  const anchored = Boolean(record[prefix + 'Anchor']);
  const minutes = record[prefix];
  if(minutes == null && !anchored)return null;
  if(anchored)return 'from ' + record[prefix + 'Anchor'];
  return minutesToTimeInput(minutes);
}

function bulkWindowLabel(record){
  const start = bulkTimeLabel(record,'allowedTimeStart');
  const end = bulkTimeLabel(record,'allowedTimeEnd');
  if(start == null && end == null)return 'no window';
  return `${start ?? 'any'} – ${end ?? 'any'}`;
}

function bulkPreferredWindowLabel(record){
  const start = bulkTimeLabel(record,'preferredTimeStart');
  const end = bulkTimeLabel(record,'preferredTimeEnd');
  if(start == null && end == null)return 'no preferred window';
  return `${start ?? 'any'} – ${end ?? 'any'}`;
}

function bulkPlacesLabel(record){
  const ids = Array.isArray(record.locationIds) ? record.locationIds : [];
  if(!ids.length)return record.anywhereAllowed === false ? 'no place set' : 'anywhere';
  const names = (typeof locationOptions === 'function' ? locationOptions() : []);
  return ids.map(id=>names.find(loc=>loc.id === id)?.name || id).join(', ') + (record.anywhereAllowed ? ' + anywhere' : '');
}

function bulkTopicsLabel(record){
  const topics = Array.isArray(record.topics) ? record.topics : [];
  return topics.length ? topics.join(', ') : 'none';
}

function bulkRhythmLabel(record){
  if(record.type === 'task')return 'one-off';
  if(isOpportunityHabit(record))return `at most once every ${opportunityGapDays(record)} day${opportunityGapDays(record) === 1 ? '' : 's'}`;
  const parts = rhythmParts(record.target);
  if(parts.times === 1 && parts.days === 1)return 'daily';
  if(parts.times === 1)return `every ${parts.days} days`;
  return `${parts.times}× every ${parts.days} days`;
}

function bulkOpportunityTrigger(record){
  const hasPlace = habitPrefLocationIds(record).length > 0;
  const hasWeather = weatherHabitHasActiveGuidance(record,sortSettings || loadSortSettings());
  const current = opportunityTrigger(record);
  if((current === 'location' && hasPlace) || (current === 'weather' && hasWeather))return current;
  return hasPlace ? 'location' : hasWeather ? 'weather' : null;
}

function bulkDueLabel(record){
  if(record.type !== 'task')return '';
  if(record.dueDate == null)return 'no date';
  const when = new Date(record.dueDate);
  const date = when.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  return record.eventTime != null ? `${date} ${bulkTaskClock(record.eventTime)}` : date;
}

function bulkTaskClock(timestamp){
  const local = new Date(timestamp);
  return minutesToTimeInput(local.getHours() * 60 + local.getMinutes());
}

function bulkTaskTime(day,clock){
  const local = new Date(day);
  const minutes = timeInputToMinutes(clock);
  local.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return local.getTime();
}

function bulkDurationLabel(record){
  return bulkMinutesLabel(record.durationMinutes);
}

function bulkBoolLabel(value){
  return value ? 'on' : 'off';
}

function bulkAutoMarkLabel(record){
  if(record.autoMarkMinutes == null)return 'manual';
  if(record.autoMarkMinutes === 0)return 'right after the session';
  return bulkMinutesLabel(record.autoMarkMinutes);
}

function bulkWeatherProfileLabel(record){
  if(record.weatherProfileMode === 'none')return 'ignore weather rules';
  if(record.weatherProfileMode === 'profile'){
    const profiles = sortSettings?.weatherProfiles || [];
    return profiles.find(p=>p.id === record.weatherProfileId)?.name || 'saved profile';
  }
  return "the place's weather";
}

function bulkPriorityLabel(record){
  return PRIORITY_LABELS[clampPriority(record.priority)] || 'P2';
}

function bulkColorLabel(record){
  return record.emojiBgColor || 'default';
}

function bulkEmojiLabel(record){
  return record.emoji || 'default icon';
}

// ─────────────────────────────────────────────────────────────────────────
// The catalog. Each entry:
//   id            stable op id used in bulk-edit state
//   group         display group
//   label / hint  copy for the editor row
//   common        true renders before the rest
//   choices       operation select options
//   valueKind     which value control the editor renders (none = op only)
//   applies(h)    whether the op can touch this record
//   blockedReason(h)  why not, for the applicability line
//   current(h)    current-value display for context
//   plan(h,op,value,data)  {ok, error?, warning?} per-item validation
//   apply(h,op,value,data) touched field names (mutates h)
// ─────────────────────────────────────────────────────────────────────────
const BULK_FIELD_OPS = [
  {
    id:'priority',group:'Organization',label:'Priority',common:true,
    hint:'When time is limited, higher-priority items get time first.',
    choices:bulkKeepSet(),
    valueKind:'priority',
    applies:()=>true,
    current:h=>bulkPriorityLabel(h),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>{h.priority = clampPriority(value);return ['priority'];},
    changeLabel:(h,op,value)=>`Priority → ${PRIORITY_LABELS[clampPriority(value)]}`
  },
  {
    id:'topics',group:'Organization',label:'Topics',common:true,
    hint:'Adding or removing keeps every other topic on the item.',
    choices:[BULK_KEEP,{key:'add',label:'Add'},{key:'remove',label:'Remove'},{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'topics',
    applies:()=>true,
    current:h=>bulkTopicsLabel(h),
    plan:(h,op,value)=>{
      if(op === 'add' && !(Array.isArray(value) && value.filter(cleanTopic).length))return {ok:false,error:'pick a topic to add'};
      if(op === 'remove' && !(Array.isArray(value) && value.filter(cleanTopic).length))return {ok:false,error:'pick a topic to remove'};
      return {ok:true};
    },
    apply:(h,op,value)=>bulkApplyTopics(h,op,value),
    changeLabel:(h,op,value)=>{
      const names = (Array.isArray(value) ? value : []).filter(cleanTopic).map(t=>`“${t}”`).join(', ');
      if(op === 'add')return `Add topic ${names}`;
      if(op === 'remove')return `Remove topic ${names}`;
      if(op === 'replace')return `Replace topics with ${names || 'none'}`;
      return 'Clear topics';
    }
  },
  {
    id:'duration',group:'Effort',label:'Duration',common:true,
    hint:'Changing duration is checked against minimum chunk and fixed times.',
    choices:bulkKeepSet(),
    valueKind:'number',
    numberMin:1,numberMax:720,
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkDurationLabel(h),
    plan:(h,op,value)=>{
      const minutes = Number(value);
      if(!Number.isFinite(minutes) || minutes < 1 || minutes > 720)return {ok:false,error:'duration must be 1–720 minutes'};
      const warnings = [];
      if(h.minChunkMinutes != null && h.minChunkMinutes > minutes)warnings.push('minimum chunk drops to the new duration');
      if(h.allowedTimeFixedStart && h.allowedTimeStart != null && h.allowedTimeEnd != null
        && h.allowedTimeEnd - h.allowedTimeStart < minutes)warnings.push('window is shorter than the duration');
      return {ok:true,warnings};
    },
    apply:(h,op,value)=>{
      const fields = ['durationMinutes'];
      const minutes = clampDuration(value);
      h.durationMinutes = minutes;
      if(h.minChunkMinutes != null && h.minChunkMinutes > minutes){h.minChunkMinutes = minutes;fields.push('minChunkMinutes');}
      return fields;
    },
    changeLabel:(h,op,value)=>`Duration → ${clampDuration(value)} min`
  },
  {
    id:'pinned',group:'Organization',label:'Pinned',common:true,
    hint:'Pinned items stay at the top of the Home list.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:()=>true,
    current:h=>bulkBoolLabel(Boolean(h.pinned)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.pinned = op === 'on';return ['pinned'];},
    changeLabel:(h,op)=>`Pinned → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'emoji',group:'Organization',label:'Emoji',common:true,
    hint:'Set the icon shown on cards.',
    choices:bulkKeepSet(),
    valueKind:'emoji',
    applies:()=>true,
    current:h=>bulkEmojiLabel(h),
    plan:(h,op,value)=>cleanMark(value) ? {ok:true} : {ok:false,error:'type or pick an emoji'},
    apply:(h,op,value)=>{h.emoji = cleanMark(value);return ['emoji'];},
    changeLabel:(h,op,value)=>`Emoji → ${cleanMark(value) || 'default'}`
  },
  {
    id:'color',group:'Organization',label:'Icon background',common:true,
    hint:'Color behind the emoji tile.',
    choices:bulkKeepSet(),
    valueKind:'color',
    applies:()=>true,
    current:h=>bulkColorLabel(h),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>{h.emojiBgColor = normalizeEmojiBgColor(value);return ['emojiBgColor'];},
    changeLabel:(h,op,value)=>`Icon background → ${normalizeEmojiBgColor(value) || 'default'}`
  },
  {
    id:'breakable',group:'Effort',label:'Split into shorter sessions',
    hint:'Breakable items can be done in chunks.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>!bulkAppointmentOwned(h) && h.type !== 'zero',
    blockedReason:h=>h.type === 'zero' ? 'stop items are single entries' : 'owned by its event schedule',
    current:h=>bulkBoolLabel(Boolean(h.breakable)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.breakable = op === 'on';return ['breakable'];},
    changeLabel:(h,op)=>`Breakable → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'minChunk',group:'Effort',label:'Minimum chunk',
    hint:'Shortest session when splitting. Clear removes the limit.',
    choices:bulkKeepSet({key:'clear',label:'Clear'}),
    valueKind:'number',
    numberMin:15,numberMax:720,
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkMinutesLabel(h.minChunkMinutes),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const minutes = Number(value);
      if(!Number.isFinite(minutes) || minutes < 15 || minutes > 720)return {ok:false,error:'chunk must be 15–720 minutes'};
      if(h.durationMinutes != null && minutes > h.durationMinutes)return {ok:false,error:'chunk is longer than the duration'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      if(op === 'clear'){h.minChunkMinutes = null;return ['minChunkMinutes'];}
      h.minChunkMinutes = clampMinChunk(value);
      return ['minChunkMinutes'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Minimum chunk → none' : `Minimum chunk → ${clampMinChunk(value)} min`
  },
  {
    id:'minGap',group:'Effort',label:'Minimum gap between sessions',
    hint:'Spacing between chunks or repeats.',
    choices:bulkKeepSet({key:'clear',label:'Clear'}),
    valueKind:'number',
    numberMin:0,numberMax:720,
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>h.minGapMinutes ? bulkMinutesLabel(h.minGapMinutes) : 'none',
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const minutes = Number(value);
      if(value == null || !Number.isFinite(minutes) || minutes < 0 || minutes > 720)return {ok:false,error:'gap must be 0–720 minutes'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      if(op === 'clear'){h.minGapMinutes = 0;return ['minGapMinutes'];}
      h.minGapMinutes = clampMinGapMinutes(value);
      return ['minGapMinutes'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Minimum gap → none' : `Minimum gap → ${clampMinGapMinutes(value)} min`
  },
  {
    id:'rhythm',group:'Repeat and dates',label:'Rhythm',
    hint:'How often a habit should happen.',
    choices:bulkKeepSet(),
    valueKind:'rhythm',
    applies:h=>(h.type === 'keepup' || h.type === 'reduce') && !bulkAppointmentOwned(h),
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : h.type === 'task' ? 'one-off tasks have no rhythm' : '',
    current:h=>bulkRhythmLabel(h),
    plan:(h,op,value)=>{
      const times = Number(value && value.times),days = Number(value && value.days);
      if(!Number.isFinite(times) || times < 1 || times > 30 || !Number.isFinite(days) || days < 1 || days > 183)return {ok:false,error:'rhythm must be 1–30 times over 1–183 days'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const target = targetFromRhythmParts(value.times,value.days);
      h.target = isOpportunityHabit(h) ? Math.ceil(target) : target;
      return ['target'];
    },
    changeLabel:(h,op,value)=>{
      const target = targetFromRhythmParts(value.times,value.days);
      return `Repeat → ${bulkRhythmLabel({...h,target})}`;
    }
  },
  {
    id:'repeatMode',group:'Repeat and dates',label:'Plan when conditions fit',
    hint:'Opportunity habits are planned only when their conditions hold.',
    choices:[BULK_KEEP,{key:'routine',label:'Plan regularly'},{key:'opportunity',label:'When conditions fit'}],
    valueKind:'none',
    applies:h=>h.type === 'keepup' && !bulkAppointmentOwned(h),
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : 'build habits only',
    current:h=>isOpportunityHabit(h) ? 'when conditions fit' : 'regularly',
    plan:(h,op,value)=>{
      if(op !== 'opportunity')return {ok:true};
      if(!bulkOpportunityTrigger(h))return {ok:false,error:'needs a place or weather guidance as its trigger'};
      return {ok:true};
    },
    apply:(h,op)=>{
      h.repeatMode = op === 'opportunity' ? 'opportunity' : 'routine';
      if(op === 'opportunity'){
        h.planByDate = null;
        h.conditionTrigger = bulkOpportunityTrigger(h);
      }
      return ['repeatMode','planByDate','conditionTrigger'];
    },
    changeLabel:(h,op)=>`Repeat → ${op === 'opportunity' ? 'when conditions fit' : 'regularly'}`
  },
  {
    id:'dueDate',group:'Repeat and dates',label:'Due date',
    hint:'Tasks only. Clearing the date also clears a fixed start time.',
    choices:bulkKeepSet({key:'clear',label:'Clear'}),
    valueKind:'date',
    applies:h=>h.type === 'task' && !bulkAppointmentOwned(h),
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : 'tasks only',
    current:h=>bulkDueLabel(h),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const ts = parseDateInput(value);
      if(ts == null)return {ok:false,error:'pick a date'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const fields = ['dueDate','eventTime','hardDue'];
      if(op === 'clear'){
        // A dependent start time cannot survive without its day.
        h.dueDate = null;
        h.eventTime = null;
        h.hardDue = false;
        return fields;
      }
      const ts = parseDateInput(value);
      const day = dayStart(ts);
      // A fixed start time keeps its wall-clock minutes on the moved day.
      const clock = h.eventTime != null ? bulkTaskClock(h.eventTime) : '';
      h.dueDate = day;
      h.eventTime = clock ? bulkTaskTime(day,clock) : null;
      h.hardDue = h.delayAllowanceDays === 0;
      return fields;
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Clear due date' : `Due date → ${new Date(parseDateInput(value)).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`
  },
  {
    id:'eventTime',group:'Repeat and dates',label:'Start time',
    hint:'Fixed clock time for a task with a date.',
    choices:bulkKeepSet({key:'clear',label:'Clear'}),
    valueKind:'time',
    applies:h=>h.type === 'task' && !bulkAppointmentOwned(h) && h.dueDate != null,
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : h.type !== 'task' ? 'tasks only' : 'needs a due date first',
    current:h=>h.eventTime != null ? bulkTaskClock(h.eventTime) : 'no time',
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const minutes = timeInputToMinutes(value);
      if(minutes == null)return {ok:false,error:'pick a time'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const fields = ['eventTime','hardDue'];
      if(op === 'clear'){h.eventTime = null;return fields;}
      h.eventTime = bulkTaskTime(h.dueDate,value);
      return fields;
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Clear start time' : `Start time → ${value}`
  },
  {
    id:'earlyWindow',group:'Repeat and dates',label:'Early window',
    hint:'Days a task may be planned before its due date.',
    choices:bulkKeepSet(),
    valueKind:'number',
    numberMin:0,numberMax:60,numberUnit:'days',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkMinutesLabel(h.earlyWindowDays).replace(' min',' days'),
    plan:(h,op,value)=>{
      const days = Number(value);
      if(value == null || !Number.isFinite(days) || days < 0 || days > 60)return {ok:false,error:'early window must be 0–60 days'};
      return {ok:true};
    },
    apply:(h,op,value)=>{h.earlyWindowDays = clampFlexibility(value);h.flexibilityDays = h.earlyWindowDays;return ['earlyWindowDays','flexibilityDays'];},
    changeLabel:(h,op,value)=>`Early window → ${clampFlexibility(value)} days`
  },
  {
    id:'delayAllowance',group:'Repeat and dates',label:'Delay allowance',
    hint:'Days after the due date a task may still be planned.',
    choices:bulkKeepSet(),
    valueKind:'number',
    numberMin:0,numberMax:60,numberUnit:'days',
    applies:h=>h.type === 'task' && !bulkAppointmentOwned(h),
    blockedReason:h=>'tasks only',
    current:h=>(h.delayAllowanceDays || 0) + ' days',
    plan:(h,op,value)=>{
      const days = Number(value);
      if(value == null || !Number.isFinite(days) || days < 0 || days > 60)return {ok:false,error:'delay allowance must be 0–60 days'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      h.delayAllowanceDays = clampDelayAllowance(value);
      h.hardDue = h.type === 'task' && h.dueDate != null && h.delayAllowanceDays === 0;
      return ['delayAllowanceDays','hardDue'];
    },
    changeLabel:(h,op,value)=>`Delay allowance → ${clampDelayAllowance(value)} days`
  },
  {
    id:'allowedWeekdays',group:'Availability',label:'Allowed weekdays',
    hint:'Empty means every day. Clear returns to every day.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Every day'}],
    valueKind:'weekdays',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkWeekdayLabel(h.allowedWeekdays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyWeekdays(h,'allowedWeekdays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Allowed weekdays → every day' : `Allowed weekdays → ${bulkWeekdayLabel(value)}`
  },
  {
    id:'preferredWeekdays',group:'Availability',label:'Preferred weekdays',
    hint:'Soft preference used when the agenda has room.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'weekdays',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkWeekdayLabel(h.preferredWeekdays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyWeekdays(h,'preferredWeekdays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Preferred weekdays → none' : `Preferred weekdays → ${bulkWeekdayLabel(value)}`
  },
  {
    id:'allowedMonthDays',group:'Availability',label:'Allowed month days',
    hint:'Dates of the month this can happen.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Any date'}],
    valueKind:'monthdays',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkMonthDayLabel(h.allowedMonthDays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyMonthDays(h,'allowedMonthDays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Allowed month days → any date' : `Allowed month days → ${bulkMonthDayLabel(value)}`
  },
  {
    id:'preferredMonthDays',group:'Availability',label:'Preferred month days',
    hint:'Best dates of the month.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'monthdays',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkMonthDayLabel(h.preferredMonthDays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyMonthDays(h,'preferredMonthDays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Preferred month days → none' : `Preferred month days → ${bulkMonthDayLabel(value)}`
  },
  {
    id:'allowedOrdinals',group:'Availability',label:'Allowed monthly weekdays',
    hint:'Like “last Friday” or “first Monday” of each month.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'ordinal',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkOrdinalLabel(h.allowedOrdinalWeekdays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyOrdinals(h,'allowedOrdinalWeekdays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Allowed monthly weekdays → none' : `Allowed monthly weekdays → ${bulkOrdinalLabel(value)}`
  },
  {
    id:'preferredOrdinals',group:'Availability',label:'Preferred monthly weekdays',
    hint:'Best “nth weekday” of each month.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'ordinal',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkOrdinalLabel(h.preferredOrdinalWeekdays),
    plan:()=>({ok:true}),
    apply:(h,op,value)=>bulkApplyOrdinals(h,'preferredOrdinalWeekdays',op,value),
    changeLabel:(h,op,value)=>op === 'clear' ? 'Preferred monthly weekdays → none' : `Preferred monthly weekdays → ${bulkOrdinalLabel(value)}`
  },
  {
    id:'allowedTime',group:'Availability',label:'Allowed time window',
    hint:'Hours this may be planned in. Replacing keeps preferred windows and per-day options.',
    choices:[BULK_KEEP,{key:'window',label:'Time window'},{key:'fixed',label:'Fixed start'},{key:'clear',label:'No window'}],
    valueKind:'window',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkWindowLabel(h),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const start = timeInputToMinutes(value && value.start);
      const end = timeInputToMinutes(value && value.end);
      if(start == null || end == null)return {ok:false,error:'pick a start and end time'};
      if(start === end)return {ok:false,error:'start and end cannot match'};
      const warnings = [];
      if(Array.isArray(h.scheduleOptions) && h.scheduleOptions.length)warnings.push('specific time and place options still apply');
      if(op === 'fixed' && h.durationMinutes != null && Math.abs(end - start) < h.durationMinutes)warnings.push('window is shorter than the duration');
      return {ok:true,warnings};
    },
    apply:(h,op,value)=>{
      const fields = [];
      if(op === 'clear'){
        fields.push(...bulkClearTimeEndpoint(h,'allowedTimeStart'));
        fields.push(...bulkClearTimeEndpoint(h,'allowedTimeEnd'));
        return [...new Set(fields)];
      }
      const start = timeInputToMinutes(value.start);
      const end = timeInputToMinutes(value.end);
      const fixed = op === 'fixed';
      fields.push(...bulkWriteTimeEndpoint(h,'allowedTimeStart',fixed,start));
      fields.push(...bulkWriteTimeEndpoint(h,'allowedTimeEnd',undefined,end));
      return [...new Set(fields)];
    },
    changeLabel:(h,op,value)=>{
      if(op === 'clear')return 'Allowed time window → none';
      const start = timeInputToMinutes(value && value.start),end = timeInputToMinutes(value && value.end);
      return `Allowed time window → ${minutesToTimeInput(start)} – ${minutesToTimeInput(end)}${op === 'fixed' ? ' (fixed start)' : ''}`;
    }
  },
  {
    id:'preferredTime',group:'Availability',label:'Preferred time window',
    hint:'Best hours, used when the day has room.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueKind:'window',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkPreferredWindowLabel(h),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const start = timeInputToMinutes(value && value.start);
      const end = timeInputToMinutes(value && value.end);
      if(start == null || end == null)return {ok:false,error:'pick a start and end time'};
      if(start === end)return {ok:false,error:'start and end cannot match'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const fields = [];
      if(op === 'clear'){
        fields.push(...bulkClearTimeEndpoint(h,'preferredTimeStart'));
        fields.push(...bulkClearTimeEndpoint(h,'preferredTimeEnd'));
        return [...new Set(fields)];
      }
      fields.push(...bulkWriteTimeEndpoint(h,'preferredTimeStart',undefined,timeInputToMinutes(value.start)));
      fields.push(...bulkWriteTimeEndpoint(h,'preferredTimeEnd',undefined,timeInputToMinutes(value.end)));
      return [...new Set(fields)];
    },
    changeLabel:(h,op,value)=>{
      if(op === 'clear')return 'Preferred time window → none';
      return `Preferred time window → ${minutesToTimeInput(timeInputToMinutes(value && value.start))} – ${minutesToTimeInput(timeInputToMinutes(value && value.end))}`;
    }
  },
  {
    id:'places',group:'Places and weather',label:'Places',common:true,
    hint:'Adding or removing keeps other places. Clear makes the item available anywhere.',
    choices:[BULK_KEEP,{key:'add',label:'Add'},{key:'remove',label:'Remove'},{key:'replace',label:'Replace'},{key:'anywhere',label:'Anywhere'}],
    valueKind:'places',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkPlacesLabel(h),
    plan:(h,op,value)=>{
      const ids = (Array.isArray(value) ? value : []).map(bulkCleanPlaceId).filter(Boolean);
      if((op === 'add' || op === 'remove' || op === 'replace') && !ids.length)return {ok:false,error:'pick a place'};
      if(ids.some(id=>!locationById(id)))return {ok:false,error:'pick a saved place'};
      const warnings = [];
      if(op === 'anywhere' && Array.isArray(h.scheduleOptions) && h.scheduleOptions.some(row=>row.locationId))warnings.push('options pinned to places still apply');
      return {ok:true,warnings};
    },
    apply:(h,op,value)=>bulkApplyPlaces(h,op,value),
    changeLabel:(h,op,value)=>{
      const names = (Array.isArray(value) ? value : []).map(bulkCleanPlaceId).map(id=>(typeof locationOptions === 'function' ? locationOptions() : []).find(loc=>loc.id === id)?.name || id).join(', ');
      if(op === 'add')return `Add place ${names}`;
      if(op === 'remove')return `Remove place ${names}`;
      if(op === 'replace')return `Places → ${names || 'none'}`;
      return 'Places → anywhere';
    }
  },
  {
    id:'placePref',group:'Places and weather',label:'Place preference',
    hint:'How much the planner should prefer one of the item’s places.',
    choices:[BULK_KEEP,{key:'set',label:'Set'}],
    valueKind:'placepref',
    applies:(h,data,value)=>!bulkAppointmentOwned(h) && (value?.locationId
      ? habitPrefLocationIds(h).includes(value.locationId) : habitPrefLocationIds(h).length > 0),
    blockedReason:(h,value)=>bulkAppointmentOwned(h) ? 'owned by its event schedule'
      : value?.locationId ? 'does not use the selected place' : 'needs a place on the item',
    current:h=>{
      const prefs = h.locationPrefs && typeof h.locationPrefs === 'object' ? h.locationPrefs : {};
      const entries = Object.entries(prefs);
      if(!entries.length)return 'no preference';
      const names = (typeof locationOptions === 'function' ? locationOptions() : []);
      return entries.map(([id,level])=>`${names.find(loc=>loc.id === id)?.name || id}: ${level}`).join(', ');
    },
    plan:(h,op,value)=>{
      const id = bulkCleanPlaceId(value && value.locationId);
      if(!id)return {ok:false,error:'pick a place'};
      if(!['avoid','little','high'].includes(value && value.level))return {ok:false,error:'pick a preference'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const id = bulkCleanPlaceId(value.locationId);
      const prefs = h.locationPrefs && typeof h.locationPrefs === 'object' ? {...h.locationPrefs} : {};
      prefs[id] = value.level;
      h.locationPrefs = prefs;
      h.preferredLocationId = primaryPreferredLocationId(prefs,habitPrefLocationIds(h));
      return ['locationPrefs','preferredLocationId'];
    },
    changeLabel:(h,op,value)=>`Place preference → ${(typeof locationOptions === 'function' ? locationOptions() : []).find(loc=>loc.id === bulkCleanPlaceId(value && value.locationId))?.name || ''} ${value && value.level}`
  },
  {
    id:'weatherProfile',group:'Places and weather',label:'Weather guidance',
    hint:'Conditions this item prefers.',
    choices:[BULK_KEEP,{key:'replace',label:'Replace'}],
    valueKind:'profile',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkWeatherProfileLabel(h),
    plan:(h,op,value)=>{
      const mode = value && value.mode;
      if(!['inherit','none','profile'].includes(mode))return {ok:false,error:'pick weather guidance'};
      if(mode === 'profile' && !sortSettings?.weatherProfiles?.some(profile=>profile.id === value.id))return {ok:false,error:'pick a saved profile'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      h.weatherProfileMode = value.mode;
      h.weatherProfileId = value.mode === 'profile' ? cleanWeatherProfileId(value.id) || null : null;
      return ['weatherProfileMode','weatherProfileId'];
    },
    changeLabel:(h,op,value)=>{
      const profiles = sortSettings?.weatherProfiles || [];
      const label = value.mode === 'none' ? 'ignore weather rules' : value.mode === 'inherit' ? "the place's weather" : profiles.find(p=>p.id === value.id)?.name || 'saved profile';
      return `Weather guidance → ${label}`;
    }
  },
  {
    id:'weatherLocation',group:'Places and weather',label:'Weather forecast place',
    hint:'Which forecast an unplaced item checks.',
    choices:[BULK_KEEP,{key:'set',label:'Set'},{key:'clear',label:'Home city'}],
    valueKind:'place',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>h.weatherLocationId ? ((typeof locationOptions === 'function' ? locationOptions() : []).find(loc=>loc.id === h.weatherLocationId)?.name || h.weatherLocationId) : 'home city',
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      if(!locationById(bulkCleanPlaceId(value)))return {ok:false,error:'pick a saved place'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      if(op === 'clear'){h.weatherLocationId = null;return ['weatherLocationId'];}
      h.weatherLocationId = bulkCleanPlaceId(value) || null;
      return ['weatherLocationId'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Weather forecast place → home city' : `Weather forecast place → ${(typeof locationOptions === 'function' ? locationOptions() : []).find(loc=>loc.id === bulkCleanPlaceId(value))?.name || ''}`
  },
  {
    id:'showWeather',group:'Places and weather',label:'Show weather',
    hint:'Weather badge on the item’s cards.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkBoolLabel(Boolean(h.showWeather)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.showWeather = op === 'on';return ['showWeather'];},
    changeLabel:(h,op)=>`Show weather → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'showWeatherAtLocation',group:'Places and weather',label:'Use the item’s place for weather',
    hint:'Off checks the home city forecast.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkBoolLabel(Boolean(h.showWeatherAtLocation)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.showWeatherAtLocation = op === 'on';return ['showWeatherAtLocation'];},
    changeLabel:(h,op)=>`Use the item’s place for weather → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'autoMark',group:'Completion',label:'Auto mark done',
    hint:'Mark done automatically after a set time. Clear returns to manual.',
    choices:[BULK_KEEP,{key:'set',label:'Set'},{key:'clear',label:'Manual'}],
    valueKind:'number',
    numberMin:0,numberMax:10080,
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>bulkAutoMarkLabel(h),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const minutes = Number(value);
      if(value == null || !Number.isFinite(minutes) || minutes < 0 || minutes > 10080)return {ok:false,error:'minutes must be 0–10080'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      if(op === 'clear'){h.autoMarkMinutes = null;return ['autoMarkMinutes'];}
      h.autoMarkMinutes = normalizeAutoMark(value);
      return ['autoMarkMinutes'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Auto mark done → manual' : `Auto mark done → ${normalizeAutoMark(value) === 0 ? 'after the session' : normalizeAutoMark(value) + ' min'}`
  },
  {
    id:'sessionTarget',group:'Completion',label:'Session target',
    hint:'Timer stops after this many minutes.',
    choices:[BULK_KEEP,{key:'set',label:'Set'},{key:'clear',label:'Clear'}],
    valueKind:'number',
    numberMin:1,numberMax:720,
    applies:h=>!isEventItem(h) && !bulkAppointmentOwned(h),
    blockedReason:h=>'events have no sessions',
    current:h=>h.timerAutoStopMinutes ? bulkMinutesLabel(h.timerAutoStopMinutes) : 'none',
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const minutes = Number(value);
      if(!Number.isFinite(minutes) || minutes < 1 || minutes > 720)return {ok:false,error:'session target must be 1–720 minutes'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      if(op === 'clear'){h.timerAutoStopMinutes = null;return ['timerAutoStopMinutes'];}
      h.timerAutoStopMinutes = normalizeTimerAutoStop(value);
      return ['timerAutoStopMinutes'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Session target → none' : `Session target → ${normalizeTimerAutoStop(value)} min`
  },
  {
    id:'tapSession',group:'Completion',label:'Tap starts a session',
    hint:'Card tap starts the timer instead of logging.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>!isEventItem(h) && !bulkAppointmentOwned(h),
    blockedReason:h=>'events have no sessions',
    current:h=>bulkBoolLabel(Boolean(h.tapStartsSession)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.tapStartsSession = op === 'on';return ['tapStartsSession'];},
    changeLabel:(h,op)=>`Tap starts a session → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'trackValue',group:'Completion',label:'Log a value or note',
    hint:'Completion asks for a number or note.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>!isEventItem(h),
    blockedReason:h=>'events have no sessions',
    current:h=>bulkBoolLabel(Boolean(h.trackValue)),
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.trackValue = op === 'on';return ['trackValue'];},
    changeLabel:(h,op)=>`Log a value or note → ${op === 'on' ? 'on' : 'off'}`
  },
  {
    id:'snooze',group:'Visibility',label:'Snooze',
    hint:'Clearing shows the item again immediately.',
    choices:[BULK_KEEP,{key:'clear',label:'Show now'}],
    valueKind:'none',
    applies:h=>Boolean(h.snoozedUntil),
    blockedReason:h=>'not snoozed',
    current:h=>h.snoozedUntil && Date.now() < h.snoozedUntil ? 'hidden for now' : 'shown',
    plan:()=>({ok:true}),
    apply:h=>{h.snoozedUntil = null;return ['snoozedUntil'];},
    changeLabel:()=>'Snooze → show now'
  },
  {
    id:'sharedDisplay',group:'Visibility',label:'Shared display',
    hint:'Whether the item appears on a paired shared display.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>h.type !== 'zero' && !isEventItem(h),
    blockedReason:h=>'stop items and events stay off shared displays',
    current:h=>h.showOnSharedDisplay === false ? 'hidden' : 'shown',
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.showOnSharedDisplay = op === 'on';return ['showOnSharedDisplay'];},
    changeLabel:(h,op)=>`Shared display → ${op === 'on' ? 'shown' : 'hidden'}`
  },
  {
    id:'sharedCompletion',group:'Visibility',label:'Shared display completion',
    hint:'Allow marking done from a paired display.',
    choices:bulkOnOff(),
    valueKind:'none',
    applies:h=>h.type !== 'zero' && !isEventItem(h),
    blockedReason:h=>'stop items and events cannot be completed remotely',
    current:h=>h.allowSharedDisplayCompletion === false ? 'off' : 'on',
    plan:()=>({ok:true}),
    apply:(h,op)=>{h.allowSharedDisplayCompletion = op === 'on';return ['allowSharedDisplayCompletion'];},
    changeLabel:(h,op)=>`Shared display completion → ${op === 'on' ? 'on' : 'off'}`
  }
];

function bulkOpById(id){
  return BULK_FIELD_OPS.find(op=>op.id === id) || null;
}

function bulkGroupOrder(){
  const groups = [];
  for(const op of BULK_FIELD_OPS)if(!groups.includes(op.group))groups.push(op.group);
  return groups;
}

// Fields each op may touch, for staleness detection between review and apply.
function bulkOpTouchedFields(opDesc){
  const probe = bulkClone({hid:'probe',type:'keepup',priority:2,topics:[],locationIds:[],locationPrefs:{},anywhereAllowed:true,weatherProfileMode:'inherit',earlyWindowDays:0,delayAllowanceDays:0,durationMinutes:20});
  const touched = new Set();
  for(const op of opDesc.choices){
    if(op.key === 'keep')continue;
    try{
      for(const field of opDesc.apply(probe,op.key,bulkSampleValue(opDesc,op.key),[]) )touched.add(field);
    }catch(_){}
  }
  return [...touched];
}

// A representative value per value kind, only good enough to enumerate the
// fields an operation writes.
function bulkSampleValue(opDesc,op){
  switch(opDesc.valueKind){
    case 'topics':case 'places':return op === 'add' || op === 'remove' ? ['x'] : [];
    case 'number':return opDesc.numberMin != null && opDesc.numberMin > 0 ? opDesc.numberMin : 0;
    case 'date':return '2026-01-01';
    case 'time':return '09:00';
    case 'window':return {start:'09:00',end:'10:00'};
    case 'rhythm':return {times:1,days:1};
    case 'emoji':return '🙂';
    case 'color':return 'teal';
    case 'placepref':return {locationId:'x',level:'high'};
    case 'profile':return {mode:'inherit',id:''};
    case 'place':return 'x';
    default:return null;
  }
}

// Whether any other record points at this hid through order links or
// habit-relative time anchors. Referenced items must survive a batch-add
// undo even if they have no logs yet.
function bulkHidReferenced(data,hid){
  if(!hid)return false;
  const anchorFields = BULK_WINDOW_FIELDS.map(prefix=>[prefix + 'AnchorHabitId',prefix + 'AnchorHabitId2']).flat();
  return data.some(record=>record.hid === hid ? false
    : (Array.isArray(record.scheduleLinks) && record.scheduleLinks.some(link=>link && link.anchorHid === hid)
      || anchorFields.some(field=>record[field] === hid)));
}
