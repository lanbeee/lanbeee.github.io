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

function bulkResolveOpportunityTrigger(original,projected){
  if(!isOpportunityHabit(projected))return true;
  const inputs = ['locationIds','weatherProfileMode','weatherProfileId','weatherLocationId'];
  if(inputs.every(field=>bulkSameValue(original[field],projected[field])))return true;
  const trigger = bulkOpportunityTrigger(projected);
  if(!trigger)return false;
  projected.conditionTrigger = trigger;
  return true;
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

// Phone reminders live in device-local storage, not on the habit record.
// Bulk review stages them here and commits once; a missing stage means the
// caller is only enumerating fields and must not write.
let bulkReminderOriginal = null;
let bulkReminderStage = null;

function bulkLiveReminderPrefs(){
  return window.TingsNative?.isNative ? nativeReminderPreferences() : {...NATIVE_REMINDER_DEFAULTS,items:{}};
}

function bulkBeginReminderStage(){
  bulkReminderOriginal = bulkClone(bulkLiveReminderPrefs());
  bulkReminderStage = bulkClone(bulkReminderOriginal);
  if(!bulkReminderStage.items)bulkReminderStage.items = {};
}

function bulkEndReminderStage(){
  bulkReminderOriginal = null;
  bulkReminderStage = null;
}

function bulkReminderPrefs(phase){
  if(phase === 'after')return bulkReminderStage || bulkReminderOriginal || bulkLiveReminderPrefs();
  if(bulkReminderOriginal)return bulkReminderOriginal;
  return bulkLiveReminderPrefs();
}

function bulkReminderOwnerKey(record){
  return `item:${record && record.hid || ''}`;
}

function bulkReminderChoice(record,phase){
  const prefs = bulkReminderPrefs(phase);
  const owner = bulkReminderOwnerKey(record);
  if(typeof nativeReminderChoices === 'function')return nativeReminderChoices(prefs,owner) || {};
  return prefs.items[owner] || {};
}

function bulkReminderModeName(mode){
  return mode === 'alarm' ? 'alarm' : mode === 'notification' ? 'notification' : 'off';
}

// Names for the notification-sound picker. The editor replaces this with the
// phone's live list, including saved custom files, when that list is available.
var bulkSoundCatalog = [
  {id:'inherit',name:'Use the default'},
  {id:'default',name:'Phone default'},
  {id:'calm',name:'Calm'},
  {id:'warm',name:'Warm'},
  {id:'deep',name:'Deep'},
  {id:'gentle',name:'Gentle'},
  {id:'silent',name:'Silent'}
];

function bulkSetSoundCatalog(choices){
  if(Array.isArray(choices) && choices.length)bulkSoundCatalog = choices;
}

function bulkSoundLabel(id){
  if(!id || id === 'inherit')return 'the default';
  const found = bulkSoundCatalog.find(choice=>choice.id === id);
  if(found && found.id !== 'inherit')return found.name;
  return String(id).startsWith('lib:') ? 'Custom sound' : 'the default';
}

function bulkReminderEdgesFor(record){
  if(!record || record.type === 'zero')return [];
  if(typeof isEventItem === 'function' && isEventItem(record))return ['start','startSecond','end'];
  const edges = ['start','end','travelStart','travelEnd'];
  if(record.type === 'task' && record.dueDate != null)edges.splice(2,0,'due');
  if(typeof isOpportunityHabit !== 'function' || !isOpportunityHabit(record))edges.push('missed');
  return edges;
}

function bulkReminderEdgeApplies(record,edge){
  if(edge === 'startLead' || edge === 'secondLead')return Boolean(record) && record.type !== 'zero' && typeof isEventItem === 'function' && isEventItem(record);
  if(edge === 'dueWhen')return bulkReminderEdgesFor(record).includes('due');
  if(edge === 'missedLead')return bulkReminderEdgesFor(record).includes('missed');
  return bulkReminderEdgesFor(record).includes(edge);
}

function bulkReminderEdgeBlock(record,edge){
  if(!record || record.type === 'zero')return 'stop items have no phone reminders';
  if(typeof isEventItem === 'function' && isEventItem(record))return 'events use start and end reminders';
  if(edge === 'startSecond' || edge === 'startLead' || edge === 'secondLead')return 'events only';
  if(edge === 'due' || edge === 'dueWhen'){
    if(record.type !== 'task')return 'tasks only';
    if(record.dueDate == null)return 'needs a due date';
  }
  if((edge === 'missed' || edge === 'missedLead') && typeof isOpportunityHabit === 'function' && isOpportunityHabit(record)){
    return 'not used when this is planned only if conditions fit';
  }
  return 'not available for this item';
}

function bulkLeadOptions(preset){
  if(preset === 'event' || preset === 'eventSecond'){
    return typeof NATIVE_EVENT_REMINDER_LEADS !== 'undefined'
      ? NATIVE_EVENT_REMINDER_LEADS
      : [[0,'at the start'],[5,'5 min before'],[10,'10 min before'],[15,'15 min before'],[30,'30 min before'],[60,'1 hour before'],[120,'2 hours before'],[1440,'1 day before'],[2880,'2 days before']];
  }
  if(preset === 'travel')return [[0,'when you leave'],[5,'5 min before'],[10,'10 min before'],[15,'15 min before'],[30,'30 min before'],[60,'1 hour before']];
  if(preset === 'missed')return [[5,'5 min before'],[15,'15 min before']];
  if(preset === 'dueDays')return [[0,'on the due date'],[1,'1 day before'],[2,'2 days before'],[7,'1 week before']];
  return [];
}

function bulkLeadDefault(preset){
  if(preset === 'eventSecond')return 1440;
  if(preset === 'missed')return 15;
  return 0;
}

function bulkLeadText(preset,value){
  const found = bulkLeadOptions(preset).find(([minutes])=>minutes === Number(value));
  return found ? found[1] : 'not set';
}

function bulkEffectiveLead(choice,field,preset){
  if(field === 'startLeadMinutes' && typeof nativeMeetingLeadMinutes === 'function')return nativeMeetingLeadMinutes(choice,false);
  if(field === 'secondStartLeadMinutes' && typeof nativeMeetingLeadMinutes === 'function')return nativeMeetingLeadMinutes(choice,true);
  if(field === 'travelLeadMinutes' && typeof nativeReminderLeadMinutes === 'function')return nativeReminderLeadMinutes(choice);
  if(field === 'missedLeadMinutes' && typeof nativeReminderMissedLeadMinutes === 'function')return nativeReminderMissedLeadMinutes(choice);
  if(field === 'dueDaysBefore' && typeof nativeDueReminderDays === 'function')return nativeDueReminderDays(choice);
  if(field === 'dueMinute' && typeof nativeDueReminderMinute === 'function')return nativeDueReminderMinute(choice);
  const fallback = bulkLeadDefault(preset);
  const options = bulkLeadOptions(preset === 'dueDays' ? 'dueDays' : preset);
  const n = Number(choice && choice[field]);
  return options.some(([minutes])=>minutes === n) ? n : fallback;
}

function bulkWhen(value){
  const day = typeof parseDateInput === 'function' ? parseDateInput(value && value.date) : null;
  if(day == null || dateKey(day) !== value.date || timeInputToMinutes(value.time) == null)return null;
  const timestamp = bulkTaskTime(dayStart(day),value.time);
  return bulkTaskClock(timestamp) === value.time ? timestamp : null;
}

function bulkWriteReminder(record,patch,removeKeys){
  if(!bulkReminderStage || !record)return ['@reminder'];
  const owner = bulkReminderOwnerKey(record);
  const choice = {...(bulkReminderStage.items[owner] || {})};
  const keys = new Set([...(removeKeys || []),...Object.keys(patch || {})]);
  if(choice.dates){
    const dates = {...choice.dates};
    for(const day of Object.keys(dates)){
      const entry = {...dates[day]};
      let dirty = false;
      for(const key of keys){
        if(Object.prototype.hasOwnProperty.call(entry,key)){delete entry[key];dirty = true;}
      }
      if(!dirty)continue;
      if(Object.keys(entry).length)dates[day] = entry;
      else delete dates[day];
    }
    if(Object.keys(dates).length)choice.dates = dates;
    else delete choice.dates;
  }
  Object.assign(choice,patch || {});
  for(const key of removeKeys || [])delete choice[key];
  bulkReminderStage.items[owner] = choice;
  return ['@reminder'];
}

function bulkSaveWithReminders(data,prefs){
  let previous;
  if(prefs){
    try{
      previous = localStorage.getItem(NATIVE_REMINDERS_KEY);
      localStorage.setItem(NATIVE_REMINDERS_KEY,JSON.stringify(prefs));
    }catch(_){return false;}
  }
  if(data && !save(data)){
    if(prefs){
      if(previous == null)localStorage.removeItem(NATIVE_REMINDERS_KEY);
      else localStorage.setItem(NATIVE_REMINDERS_KEY,previous);
    }
    return false;
  }
  if(prefs){
    nativeReminderLastSignature = '';
    void reconcileNativeReminders();
    void reconcileNativeQuiet();
    queueNativeBackgroundSnapshot();
  }
  return true;
}

// Merge the original values back by field, including individual date overrides.
function bulkUndoReminderFields(current,before,after){
  const value = {...current};
  let changed = false;
  let conflicts = 0;
  const keys = new Set([...Object.keys(before || {}),...Object.keys(after || {})]);
  for(const key of keys){
    if(bulkSameValue(before?.[key],after?.[key]))continue;
    if(key === 'dates'){
      const days = new Set([...Object.keys(before?.dates || {}),...Object.keys(after?.dates || {})]);
      const dates = {...value.dates};
      for(const day of days){
        const result = bulkUndoReminderFields(dates[day],before?.dates?.[day],after?.dates?.[day]);
        conflicts += result.conflicts;
        if(!result.changed)continue;
        changed = true;
        if(Object.keys(result.value).length)dates[day] = result.value;
        else delete dates[day];
      }
      if(Object.keys(dates).length)value.dates = dates;
      else delete value.dates;
    }else if(!bulkSameValue(value[key],after?.[key])){
      conflicts += 1;
    }else{
      changed = true;
      if(before?.[key] === undefined)delete value[key];
      else value[key] = before[key];
    }
  }
  return {value,changed,conflicts};
}

function bulkReminderEffect(record,keys,prefs = bulkReminderStage || bulkLiveReminderPrefs()){
  const owner = bulkReminderOwnerKey(record);
  const choice = typeof nativeReminderChoices === 'function' ? (nativeReminderChoices(prefs,owner) || {}) : (prefs.items[owner] || {});
  const effect = {};
  for(const key of keys){
    if(['start','startSecond','end','due','travelStart','travelEnd','missed'].includes(key))effect[key] = choice[key] || 'off';
    else if(key === 'dnd')effect.dnd = prefs.items[owner]?.dnd === true;
    else if(key === 'startLeadMinutes')effect[key] = bulkEffectiveLead(choice,key,'event');
    else if(key === 'secondStartLeadMinutes')effect[key] = bulkEffectiveLead(choice,key,'eventSecond');
    else if(key === 'travelLeadMinutes')effect[key] = bulkEffectiveLead(choice,key,'travel');
    else if(key === 'missedLeadMinutes')effect[key] = bulkEffectiveLead(choice,key,'missed');
    else if(key === 'dueDaysBefore')effect[key] = bulkEffectiveLead(choice,key,'dueDays');
    else if(key === 'dueMinute')effect[key] = bulkEffectiveLead(choice,key,'dueMinute');
    else if(key === 'sound')effect.sound = (typeof nativeReminderSoundId === 'function' ? nativeReminderSoundId(choice) : '') || null;
    else effect[key] = choice[key] ?? null;
  }
  const overrides = {};
  for(const [day,patch] of Object.entries(prefs.items[owner]?.dates || {})){
    if(!patch)continue;
    const hit = {};
    for(const key of keys)if(Object.prototype.hasOwnProperty.call(patch,key))hit[key] = patch[key];
    if(Object.keys(hit).length)overrides[day] = hit;
  }
  return {effect,overrides};
}

function bulkReminderModeOp(id,label,edge,hint){
  return {
    id,group:'Reminders',label,hint,nativeOnly:true,store:'reminders',reminderMode:true,
    choices:[BULK_KEEP,{key:'off',label:'Off'},{key:'notification',label:'Notification'},{key:'alarm',label:'Alarm'}],
    valueKind:'none',
    applies:h=>bulkReminderEdgeApplies(h,edge),
    blockedReason:h=>bulkReminderEdgeBlock(h,edge),
    reminderKeys:()=>[edge],
    current:(h,phase)=>bulkReminderModeName(bulkReminderChoice(h,phase)[edge]),
    plan:()=>({ok:true}),
    apply:(h,op)=>bulkWriteReminder(h,{[edge]:op === 'alarm' ? 'alarm' : op === 'notification' ? 'notification' : 'off'}),
    changeLabel:(h,op)=>`${label} → ${bulkReminderModeName(op)}`
  };
}

function bulkReminderLeadOp(id,label,field,preset,appliesEdge,hint){
  return {
    id,group:'Reminders',label,hint,nativeOnly:true,store:'reminders',
    choices:bulkKeepSet(),
    valueKind:'choice',leadPreset:preset,
    applies:h=>bulkReminderEdgeApplies(h,appliesEdge),
    blockedReason:h=>bulkReminderEdgeBlock(h,appliesEdge === 'start' ? 'startLead' : appliesEdge === 'startSecond' ? 'secondLead' : appliesEdge === 'missed' ? 'missedLead' : appliesEdge),
    reminderKeys:()=>[field],
    current:(h,phase)=>bulkLeadText(preset,bulkEffectiveLead(bulkReminderChoice(h,phase),field,preset)),
    plan:(h,op,value)=>bulkLeadOptions(preset).some(([minutes])=>minutes === Number(value)) ? {ok:true} : {ok:false,error:'pick a lead time'},
    apply:(h,op,value)=>bulkWriteReminder(h,{[field]:Number(value)}),
    changeLabel:(h,op,value)=>`${label} → ${bulkLeadText(preset,value)}`
  };
}

function bulkReminderCatalog(){
  return [
    {
      id:'reminderAll',group:'Reminders',label:'Every reminder',nativeOnly:true,store:'reminders',reminderMode:true,
      hint:'Notification or ringing alarm for every reminder this item can use. Saved on this phone. A different choice on one date is replaced.',
      choices:[BULK_KEEP,{key:'off',label:'All off'},{key:'notification',label:'All notifications'},{key:'alarm',label:'All alarms'}],
      valueKind:'none',
      applies:h=>bulkReminderEdgesFor(h).length > 0,
      blockedReason:h=>bulkReminderEdgeBlock(h,'start'),
      reminderKeys:h=>bulkReminderEdgesFor(h),
      current(h,phase){
        const edges = bulkReminderEdgesFor(h);
        const choice = bulkReminderChoice(h,phase);
        const modes = edges.map(edge=>choice[edge] || 'off');
        if(!modes.length)return 'none';
        if(modes.every(mode=>mode === 'off'))return 'all off';
        if(modes.every(mode=>mode === 'notification'))return 'all notifications';
        if(modes.every(mode=>mode === 'alarm'))return 'all alarms';
        return 'mixed';
      },
      plan:()=>({ok:true}),
      apply(h,op){
        const mode = op === 'alarm' ? 'alarm' : op === 'notification' ? 'notification' : 'off';
        const patch = {};
        for(const edge of bulkReminderEdgesFor(h))patch[edge] = mode;
        return bulkWriteReminder(h,patch);
      },
      changeLabel:(h,op)=>`Every reminder → ${op === 'alarm' ? 'all alarms' : op === 'notification' ? 'all notifications' : 'all off'}`
    },
    bulkReminderModeOp('reminderStart','When it starts','start','Notification or ringing alarm at the start. Saved on this phone.'),
    bulkReminderModeOp('reminderEnd','When it ends','end','Notification or ringing alarm at the end. Saved on this phone.'),
    bulkReminderModeOp('reminderDue','On the due date','due','Notification or ringing alarm for a task deadline. Needs a due date.'),
    {
      id:'reminderDueWhen',group:'Reminders',label:'Due-date reminder time',nativeOnly:true,store:'reminders',
      hint:'Which day and local time the deadline alert uses. Notification or alarm is chosen separately.',
      choices:bulkKeepSet(),
      valueKind:'dueReminder',
      applies:h=>bulkReminderEdgeApplies(h,'due'),
      blockedReason:h=>bulkReminderEdgeBlock(h,'dueWhen'),
      reminderKeys:()=>['dueDaysBefore','dueMinute'],
      current(h,phase){
        const choice = bulkReminderChoice(h,phase);
        return `${bulkLeadText('dueDays',bulkEffectiveLead(choice,'dueDaysBefore','dueDays'))} at ${minutesToTimeInput(bulkEffectiveLead(choice,'dueMinute','dueMinute'))}`;
      },
      plan(h,op,value){
        if(![0,1,2,7].includes(Number(value && value.days)))return {ok:false,error:'pick a reminder day'};
        if(timeInputToMinutes(value && value.time) == null)return {ok:false,error:'pick a reminder time'};
        return {ok:true};
      },
      apply(h,op,value){
        return bulkWriteReminder(h,{
          dueDaysBefore:Number(value.days),
          dueMinute:timeInputToMinutes(value.time)
        });
      },
      changeLabel:(h,op,value)=>`Due-date reminder time → ${bulkLeadText('dueDays',value && value.days)} at ${value && value.time}`
    },
    bulkReminderModeOp('reminderSecond','Second reminder','startSecond','A second notification or alarm before an event.'),
    bulkReminderLeadOp('reminderStartLead','First reminder lead','startLeadMinutes','event','startLead','How early the first event reminder arrives.'),
    bulkReminderLeadOp('reminderSecondLead','Second reminder lead','secondStartLeadMinutes','eventSecond','secondLead','How early the second event reminder arrives.'),
    bulkReminderModeOp('reminderTravelStart','When you leave','travelStart','Notification or ringing alarm at departure.'),
    bulkReminderModeOp('reminderTravelEnd','When you arrive','travelEnd','Notification or ringing alarm at arrival.'),
    bulkReminderLeadOp('reminderTravelLead','Departure lead','travelLeadMinutes','travel','travelStart','How early the departure reminder arrives.'),
    bulkReminderModeOp('reminderMissed','If it may not fit','missed','A warning before the item drops off the agenda. Uses exact timing.'),
    bulkReminderLeadOp('reminderMissedLead','Drop-warning lead','missedLeadMinutes','missed','missed','How early the drop warning arrives.'),
    {
      id:'reminderSound',group:'Reminders',label:'Notification sound',nativeOnly:true,store:'reminders',
      hint:'Tone for this item’s notifications. The default follows Settings. Saved phone sounds and audio files are listed too, and a new one chosen here is used for every selected item. Ringing alarms keep the phone’s alarm tone. Saved on this phone.',
      choices:bulkKeepSet([{key:'clear',label:'Use the default'}]),
      valueKind:'sound',
      valueless:['clear'],
      applies:h=>Boolean(h) && h.type !== 'zero',
      blockedReason:h=>!h || h.type === 'zero' ? 'stop items have no phone reminders' : 'not available for this item',
      reminderKeys:()=>['sound'],
      current:(h,phase)=>bulkSoundLabel(nativeReminderSoundId(bulkReminderChoice(h,phase))),
      plan:(h,op,value)=>op === 'clear' || !value || value === 'inherit' || nativeReminderSoundKnown(value) ? {ok:true} : {ok:false,error:'pick a notification sound'},
      apply:(h,op,value)=>op === 'clear' || !value || value === 'inherit' ? bulkWriteReminder(h,{},['sound']) : bulkWriteReminder(h,{sound:value}),
      changeLabel:(h,op,value)=>op === 'clear' || !value || value === 'inherit' ? 'Notification sound → the default' : `Notification sound → ${bulkSoundLabel(value)}`
    },
    {
      id:'reminderDnd',group:'Reminders',label:'Silence the phone',nativeOnly:true,requiresQuiet:true,store:'reminders',
      hint:'Do Not Disturb while this session is in progress. Needs Do Not Disturb access on this phone.',
      choices:bulkOnOff(),
      valueKind:'none',
      applies:h=>Boolean(h) && h.type !== 'zero' && !(typeof isEventItem === 'function' && isEventItem(h)),
      blockedReason:h=>!h || h.type === 'zero' ? 'stop items have no phone reminders' : 'events keep the phone’s current sound',
      reminderKeys:()=>['dnd'],
      current:(h,phase)=>bulkReminderPrefs(phase).items[bulkReminderOwnerKey(h)]?.dnd === true ? 'on' : 'off',
      plan:()=>({ok:true}),
      apply:(h,op)=>bulkWriteReminder(h,{dnd:op === 'on'}),
      changeLabel:(h,op)=>`Silence the phone → ${op === 'on' ? 'on' : 'off'}`
    }
  ];
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
//   store:'reminders' stages device-local phone reminders instead of record fields
//   nativeOnly        hidden outside the Android app
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
    id:'conditionTrigger',group:'Repeat and dates',label:'Plan this when',
    hint:'Weather, or being near a place. Only for a habit that is planned when conditions fit.',
    choices:[BULK_KEEP,{key:'weather',label:'The weather matches'},{key:'location',label:'Near a place'}],
    valueKind:'none',
    applies:h=>isOpportunityHabit(h) && !bulkAppointmentOwned(h),
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : 'only when this is planned if conditions fit',
    current:h=>h.conditionTrigger === 'location' ? 'near a place' : 'the weather',
    plan:(h,op)=>{
      if(op === 'location' && !habitPrefLocationIds(h).length)return {ok:false,error:'add a place before using distance'};
      if(op === 'weather' && !weatherHabitHasActiveGuidance(h,sortSettings || loadSortSettings()))return {ok:false,error:'add weather guidance before using weather'};
      return {ok:true};
    },
    apply:(h,op)=>{h.conditionTrigger = op === 'location' ? 'location' : 'weather';return ['conditionTrigger'];},
    changeLabel:(h,op)=>`Plan this when → ${op === 'location' ? 'near a place' : 'the weather'}`
  },
  {
    id:'conditionRadius',group:'Repeat and dates',label:'How close',
    hint:'Meters from the place. Used when the trigger is a nearby place.',
    choices:bulkKeepSet(),
    valueKind:'number',
    numberMin:1,numberMax:100000,numberUnit:'m',
    applies:h=>isOpportunityHabit(h) && h.conditionTrigger === 'location' && !bulkAppointmentOwned(h),
    blockedReason:h=>{
      if(bulkAppointmentOwned(h))return 'owned by its event schedule';
      if(!isOpportunityHabit(h))return 'only when this is planned if conditions fit';
      return 'only when the trigger is a nearby place';
    },
    current:h=>`${typeof opportunityRadius === 'function' ? opportunityRadius(h) : (h.conditionRadiusM || 200)} m`,
    plan:(h,op,value)=>{
      const meters = Number(value);
      if(!Number.isFinite(meters) || meters < 1 || meters > 100000)return {ok:false,error:'distance must be 1–100000 m'};
      return {ok:true};
    },
    apply:(h,op,value)=>{h.conditionRadiusM = Math.round(Math.max(1,Math.min(100000,Number(value))));return ['conditionRadiusM'];},
    changeLabel:(h,op,value)=>`How close → ${Math.round(Number(value))} m`
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
    id:'planBy',group:'Repeat and dates',label:'Plan-by date',
    hint:'A day this habit should be done by. Not used when it is planned only if conditions fit.',
    choices:bulkKeepSet({key:'clear',label:'Clear'}),
    valueKind:'date',
    valueless:['clear'],
    applies:h=>(h.type === 'keepup' || h.type === 'reduce') && !isOpportunityHabit(h) && !bulkAppointmentOwned(h),
    blockedReason:h=>bulkAppointmentOwned(h) ? 'owned by its event schedule' : isOpportunityHabit(h) ? 'not used when this is planned only if conditions fit' : 'habits only',
    current:h=>h.planByDate == null ? 'no date' : new Date(h.planByDate).toLocaleDateString(undefined,{month:'short',day:'numeric'}),
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      if(parseDateInput(value) == null)return {ok:false,error:'pick a date'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      h.planByDate = op === 'clear' ? null : dayStart(parseDateInput(value));
      return ['planByDate'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Clear plan-by date' : `Plan-by date → ${new Date(parseDateInput(value)).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`
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
    id:'locationTypes',group:'Places and weather',label:'Place types & setting',
    hint:'Allow any saved place of a type (grocery, gym, cafe…) or setting (indoor, outdoor).',
    choices:[BULK_KEEP,{key:'add',label:'Add'},{key:'remove',label:'Remove'},{key:'replace',label:'Replace'},{key:'clear',label:'Clear'}],
    valueless:['clear'],
    valueKind:'placetypes',
    applies:h=>!bulkAppointmentOwned(h),
    blockedReason:()=>'owned by its event schedule',
    current:h=>{
      const types = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(h.locationTypes) : [];
      if(!types.length)return 'none';
      return types.map(k=>typeof locationTypeKeyLabel === 'function' ? locationTypeKeyLabel(k) : k).join(', ');
    },
    plan:(h,op,value)=>{
      const types = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(value) : [];
      if((op === 'add' || op === 'remove' || op === 'replace') && !types.length)return {ok:false,error:'pick a place type or setting'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      const nextTypes = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(value) : [];
      const cur = new Set(typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(h.locationTypes) : []);
      if(op === 'clear')cur.clear();
      else if(op === 'replace'){ cur.clear(); nextTypes.forEach(t=>cur.add(t)); }
      else if(op === 'add')nextTypes.forEach(t=>cur.add(t));
      else if(op === 'remove')nextTypes.forEach(t=>cur.delete(t));
      h.locationTypes = [...cur];
      if(h.locationTypes.length && h.anywhereAllowed && op === 'replace')h.anywhereAllowed = false;
      if(!h.locationTypes.length && !(h.locationIds && h.locationIds.length))h.anywhereAllowed = true;
      return ['locationTypes','anywhereAllowed'];
    },
    changeLabel:(h,op,value)=>{
      const names = (typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(value) : [])
        .map(k=>typeof locationTypeKeyLabel === 'function' ? locationTypeKeyLabel(k) : k).join(', ');
      if(op === 'clear')return 'Clear place types';
      if(op === 'add')return `Add place type ${names}`;
      if(op === 'remove')return `Remove place type ${names}`;
      return `Place types → ${names}`;
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
    hint:'Hide until a date and time, or show a hidden item again.',
    choices:[BULK_KEEP,{key:'until',label:'Hide until'},{key:'clear',label:'Show now'}],
    valueKind:'datetime',
    valueless:['clear'],
    applies:()=>true,
    current:h=>h.snoozedUntil && Date.now() < h.snoozedUntil ? new Date(h.snoozedUntil).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'shown',
    plan:(h,op,value)=>{
      if(op === 'clear')return {ok:true};
      const ts = bulkWhen(value);
      if(ts == null)return {ok:false,error:'pick a date and time'};
      if(ts <= Date.now())return {ok:false,error:'pick a future time'};
      return {ok:true};
    },
    apply:(h,op,value)=>{
      h.snoozedUntil = op === 'clear' ? null : bulkWhen(value);
      return ['snoozedUntil'];
    },
    changeLabel:(h,op,value)=>op === 'clear' ? 'Snooze → show now' : `Snooze → hide until ${value && value.date} ${value && value.time}`
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
  },
  ...bulkReminderCatalog()
];

function bulkOpById(id){
  return BULK_FIELD_OPS.find(op=>op.id === id) || null;
}

function bulkGroupOrder(){
  const groups = [];
  for(const op of BULK_FIELD_OPS)if(!groups.includes(op.group))groups.push(op.group);
  return groups;
}

// Prerequisites run before the settings that read them. Phone reminders run
// last so a due date or a switch to “when conditions fit” is already applied.
function bulkApplyOrder(){
  const late = ['repeatMode','rhythm','planBy','conditionTrigger','conditionRadius'];
  const reminderIds = BULK_FIELD_OPS.filter(op=>op.store === 'reminders').map(op=>op.id);
  const skip = new Set(late.concat(reminderIds));
  return BULK_FIELD_OPS.map(op=>op.id).filter(id=>!skip.has(id)).concat(late).concat(reminderIds);
}

// Fields each op may touch, for staleness detection between review and apply.
function bulkOpTouchedFields(opDesc){
  // Phone reminders are not habit fields. Calling apply() would also write the
  // review stage if one is open, so field enumeration stops here.
  if(opDesc.store === 'reminders')return ['@reminder'];
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
    case 'choice':return bulkLeadDefault(opDesc.leadPreset);
    case 'dueReminder':return {days:0,time:'09:00'};
    case 'datetime':return {date:'2026-01-02',time:'09:00'};
    case 'sound':return 'calm';
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
