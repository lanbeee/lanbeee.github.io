// Focused create/edit session: one habit, task, or local event.
// Omission preserves the saved value. Writes go through the same normalizers
// as the manual editors and land on the current record, not a rebuilt draft.

const ASSISTANT_FOCUS_REMINDER_KEY = 'tings_native_reminders_v1';
const ASSISTANT_FOCUS_LEADS = [0, 5, 10, 15, 30, 60];
const ASSISTANT_FOCUS_MISSED_LEADS = [5, 15];
const ASSISTANT_FOCUS_REMINDER_MODES = ['off', 'notification', 'alarm'];
let _assistantFocusEpoch = 1;

function assistantFocusClone(value){
  if(value == null)return value;
  if(typeof structuredClone === 'function'){
    try{ return structuredClone(value); }catch(_){}
  }
  return JSON.parse(JSON.stringify(value));
}

function assistantFocusNorm(text){
  return String(text || '').toLowerCase().replace(/\bminutes?\b/g, 'min').replace(/\bhours?\b/g, 'hour').replace(/[^\p{L}\p{N}\p{S}:+#]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function assistantFocusPhraseIn(request, phrase){
  const p = assistantFocusNorm(phrase);
  if(!p)return false;
  if(p.length < 2 && !/\d/.test(p))return false;
  return assistantFocusNorm(request).includes(p);
}

function assistantFocusNameRejected(name, request){
  const left = assistantFocusNorm(name);
  const right = assistantFocusNorm(request);
  if(!left || !right)return false;
  return left.split(' ').length > 6 && (left === right || right.startsWith(left));
}

function assistantFocusInvalidate(){
  _assistantFocusEpoch += 1;
  if(typeof _assistantSession !== 'undefined' && _assistantSession && _assistantSession.focus){
    _assistantSession.focus.epoch = -1;
    _assistantSession.focus.interpretationApproved = null;
  }
  if(typeof document !== 'undefined'){
    document.querySelectorAll('[data-focus-save],[data-focus-edit],[data-focus-choice],[data-focus-field]').forEach(el => {
      el.disabled = true;
    });
  }
}

function assistantFocusAlive(session){
  return Boolean(session && session.epoch === _assistantFocusEpoch);
}

function assistantFocusBlank(session){
  if(session.createBaseline)return assistantFocusClone(session.createBaseline);
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : {};
  const kind = session.kind;
  const defaults = newItemDefaults(settings, kind === 'task' ? 'task' : 'keepup');
  const record = {
    hid:session.draftId,
    name:'',
    type:kind === 'task' ? 'task' : 'keepup',
    repeatMode:'routine',
    conditionTrigger:'weather',
    conditionRadiusM:200,
    target:kind === 'habit' ? defaults.target : null,
    dueDate:null,
    hardDue:false,
    autoMarkMinutes:settings.defaultAutoMarkMinutes != null ? settings.defaultAutoMarkMinutes : null,
    eventTime:null,
    appointment:null,
    planByDate:null,
    createdAt:session.now || Date.now(),
    logs:[],
    emoji:'',
    emojiBgColor:'',
    pinned:false,
    showOnSharedDisplay:true,
    allowSharedDisplayCompletion:kind !== 'event',
    sample:false,
    snoozedUntil:null,
    topics:Array.isArray(settings.defaultTopics) ? settings.defaultTopics.slice() : [],
    allowedWeekdays:[],
    allowedMonthDays:[],
    preferredWeekdays:[],
    preferredMonthDays:[],
    allowedTimeStart:null,
    allowedTimeEnd:null,
    allowedTimeFixedStart:false,
    preferredTimeStart:null,
    preferredTimeEnd:null,
    allowedTimeStartAnchor:null,
    allowedTimeStartOffsetMin:0,
    allowedTimeEndAnchor:null,
    allowedTimeEndOffsetMin:0,
    preferredTimeStartAnchor:null,
    preferredTimeStartOffsetMin:0,
    preferredTimeEndAnchor:null,
    preferredTimeEndOffsetMin:0,
    scheduleLinks:[],
    earlyWindowDays:settings.defaultEarlyWindowDays || 0,
    delayAllowanceDays:settings.defaultDelayAllowanceDays || 0,
    durationMinutes:defaults.durationMinutes,
    breakable:Boolean(settings.defaultBreakable),
    minChunkMinutes:settings.defaultMinChunkMinutes || 15,
    minGapMinutes:0,
    timerAutoStopMinutes:null,
    tapStartsSession:false,
    trackValue:false,
    priority:defaults.priority,
    locationIds:[],
    anywhereAllowed:true,
    locationPrefs:{},
    preferredLocationId:null,
    weatherProfileMode:'inherit',
    weatherProfileId:null,
    weatherLocationId:null,
    showWeather:false,
    showWeatherAtLocation:false,
    scheduleOptions:[],
    links:[],
    source:null,
    externalId:null,
    importedAt:null
  };
  if(kind !== 'event'){
    for(const key of ['earlyWindowDays','delayAllowanceDays','breakable','minChunkMinutes','topics',
      'allowedWeekdays','allowedTimeStart','allowedTimeEnd','locationIds','anywhereAllowed']){
      record[key] = assistantFocusClone(defaults[key]);
    }
    record.autoMarkMinutes = defaults.autoMarkMode === 'duration' ? defaults.durationMinutes
      : defaults.autoMarkMode === 'minutes' ? defaults.autoMarkMinutes : null;
  }
  const form = session.addForm && session.addForm.record;
  session.formKeys = [];
  if(form && typeof form === 'object'){
    const skip = new Set(['name','hid','logs','lastLog','createdAt','source','externalId','importedAt','sample']);
    Object.keys(form).forEach(key => {
      if(skip.has(key) || form[key] === undefined)return;
      record[key] = assistantFocusClone(form[key]);
      session.formKeys.push(key);
    });
    record.hid = session.draftId;
    record.name = '';
    record.logs = [];
    record.createdAt = session.now || Date.now();
  }
  for(const [key, fallback] of [['durationMinutes',defaults.durationMinutes],['target',defaults.target]]){
    if(key === 'target' && kind !== 'habit')continue;
    if(!Number.isFinite(record[key]) || record[key] <= 0){
      record[key] = fallback;
      session.formKeys = session.formKeys.filter(field => field !== key);
    }
  }
  if(kind === 'event'){
    record.allowSharedDisplayCompletion = false;
    record.breakable = false;
    record.autoMarkMinutes = null;
    if(!record.appointment)record.appointment = {repeat:'once', startDate:'', startMinute:null, weekdays:[], until:'', exceptions:{}};
    record.priority = settings.defaultPriority != null ? settings.defaultPriority : 2;
  }
  // Keep the reviewed defaults stable across jobs, follow-ups and Save, even
  // when another tab changes creation settings while this draft is open.
  if(session.operation === 'create')session.createBaseline = assistantFocusClone(record);
  return record;
}

function assistantFocusOpen(opts){
  opts = opts || {};
  const operation = opts.operation === 'create' ? 'create' : 'edit';
  const kind = opts.kind === 'task' || opts.kind === 'event' ? opts.kind : 'habit';
  let source = null;
  if(operation === 'edit'){
    const data = typeof load === 'function' ? load() : [];
    const item = data.find(row => row && row.hid === opts.targetId);
    if(!item)return null;
    if(assistantFocusImported(item))return null;
    source = assistantFocusClone(item);
  }
  const once = source && source.appointment && source.appointment.repeat === 'once';
  const session = {
    id:`focus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    epoch:_assistantFocusEpoch,
    operation,
    kind,
    targetId:operation === 'edit' ? opts.targetId : null,
    draftId:operation === 'create' ? (typeof generateHabitId === 'function' ? generateHabitId() : `h-${Date.now().toString(36)}`) : (source && source.hid),
    entry:opts.entry || null,
    occurrenceDate:opts.occurrenceDate || '',
    eventScope:kind === 'event' && (once || operation === 'create') ? 'series' : null,
    scopeSource:kind === 'event' && (once || operation === 'create') ? 'once' : null,
    source,
    addForm:opts.addForm || null,
    formKeys:[],
    requestText:'',
    originalRequest:'',
    requests:[],
    changes:[],
    unresolved:[],
    dependencies:{topics:[], weatherProfile:null},
    reminders:null,
    watched:null,
    interpretationApproved:null,
    needsInterpretation:false,
    correctionError:'',
    pendingFamilies:[],
    continuationError:'',
    repairs:{},
    timing:{init:0, families:0, extract:0, repair:0, validate:0, total:0, passes:[]},
    savedFingerprint:'',
    savedResult:null,
    saving:null,
    now:opts.now || Date.now(),
    notes:[]
  };
  if(operation === 'create')assistantFocusBlank(session);
  return session;
}

function assistantFocusEssentialFields(session, record){
  const ids = ['name','durationMinutes'];
  if(session.kind === 'habit' && record.type !== 'zero')ids.push('timesPerPeriod','periodDays');
  if(session.kind === 'event')ids.push('appointmentStartDate','appointmentStartMinute','appointmentRepeat');
  return ids.filter(id => assistantFocusFieldApplies(id, assistantFocusState(session, record)));
}

function assistantFocusCreateIssues(session){
  if(session.operation !== 'create')return [];
  const record = assistantFocusMaterialize(session);
  const issues = [];
  if(!String(record.name || '').trim())issues.push({field:'name',family:'identity',question:'What should the item be called?'});
  if(record.type !== 'zero' && (!Number.isFinite(record.durationMinutes) || record.durationMinutes <= 0)){
    issues.push({field:'durationMinutes',family:'effort',question:'How long should one session last?'});
  }
  if(session.kind === 'habit' && record.type !== 'zero' && (!Number.isFinite(record.target) || record.target <= 0)){
    issues.push({field:'timesPerPeriod',family:'recurrence',question:'How often should it repeat?'});
  }
  // Events cannot safely invent a date or clock when neither the form nor the
  // request supplied one. Duration and recurrence still have ordinary defaults.
  if(session.kind === 'event' && !normalizeAppointment(record.appointment)){
    issues.push({field:'appointmentStartDate',family:'event',question:'The event needs a date, a start time, and repeat weekdays when applicable.'});
  }
  return issues;
}

function assistantFocusDraftIssues(session){
  const issues=assistantFocusCreateIssues(session);
  const record=assistantFocusMaterialize(session);
  // A time without a date cannot be represented by eventTime. Do not show a
  // successful clock proposal and then silently discard it during Save.
  if(record.type==='task' && record.dueDate==null && session.changes.some(change=>change.field==='dueTime'&&change.op==='set')){
    issues.push({field:'dueDate',family:'dates',question:'Which date should this start time apply to?'});
  }
  return issues;
}

function assistantFocusContinueSavedCreate(session){
  if(session?.operation!=='create' || !session.savedResult)return;
  // A follow-up belongs to the item just created. Rebase on its current saved
  // record so later logs and unrelated edits survive, with the same identity.
  const item=load().find(row=>row.hid===session.savedResult.hid);
  const baseline=item || assistantFocusMaterialize(session);
  session.operation='edit';
  session.targetId=session.savedResult.hid;
  session.source=assistantFocusClone(baseline);
  session.changes=[];
  session.dependencies={topics:[],weatherProfile:null};
  session.watched=null;
  session.savedFingerprint='';
}

function assistantFocusEffectiveKind(session){
  if(!session || session.kind === 'event')return session ? session.kind : 'habit';
  const change = session.changes.find(row => row.field === 'kind' && row.op === 'set');
  if(session.operation === 'edit' && change && (change.value === 'habit' || change.value === 'task'))return change.value;
  return session.kind;
}

function assistantFocusState(session, record){
  const kind = assistantFocusEffectiveKind(session);
  const type = record ? record.type : (kind === 'task' ? 'task' : 'keepup');
  return {
    kind,
    effectiveKind:kind,
    type:record && record.type || type,
    repeatMode:record && record.repeatMode || 'routine',
    breakable:Boolean(record && record.breakable),
    scope:session && session.eventScope || null
  };
}

function assistantFocusLive(session){
  if(!session || session.operation !== 'edit' || !session.targetId)return null;
  const data = typeof load === 'function' ? load() : [];
  return data.find(row => row && row.hid === session.targetId) || null;
}

function assistantFocusBaseline(session){
  if(session.operation === 'edit' && session.source)return assistantFocusClone(session.source);
  return assistantFocusBlank(session);
}

function assistantFocusWriteOrder(field){
  if(field === 'kind')return 0;
  if(field === 'habitKind')return 1;
  if(field === 'repeatMode')return 2;
  if(field === 'timesPerPeriod' || field === 'periodDays')return 3;
  if(field === 'allowedWindow' || field === 'preferredWindow')return 10;
  if(field === 'allowedTimeFixedStart')return 11;
  if(field === 'places' || field === 'weatherProfile')return 12;
  if(field === 'locationPrefs' || field === 'weatherRules')return 13;
  if(field === 'dueDate' || field === 'planByDate' || field === 'appointmentStartDate')return 40;
  if(field === 'dueTime' || field === 'appointmentStartMinute')return 45;
  if(String(field || '').startsWith('appointment'))return 20;
  if(String(field || '').startsWith('exception'))return 30;
  return 50;
}

function assistantFocusStage(session, change){
  if(!session || !change || !change.field)return null;
  const next = {
    op:change.op || 'set',
    field:change.field,
    value:change.value,
    source:change.source || '',
    origin:change.origin || 'extracted',
    uncertain:Boolean(change.uncertain),
    family:(assistantFocusField(change.field) || {}).family || change.family || ''
  };
  const index = session.changes.findIndex(row => row.field === next.field);
  if(index >= 0)session.changes.splice(index, 1, next);
  else session.changes.push(next);
  session.unresolved = session.unresolved.filter(row => row.field !== next.field);
  session.interpretationApproved = null;
  session.savedFingerprint = '';
  return next;
}

function assistantFocusUnresolve(session, item){
  if(!session || !item)return;
  session.unresolved = session.unresolved.filter(row => row.field !== item.field);
  session.unresolved.push({
    field:item.field || 'request',
    family:item.family || '',
    question:item.question || 'I need a clearer value for that setting.',
    choices:item.choices || [],
    blocking:item.blocking !== false
  });
  session.interpretationApproved = null;
  session.savedFingerprint = '';
}

function assistantFocusDropFamily(session, family){
  if(!session)return;
  session.changes = session.changes.filter(row => row.family !== family && !(family === 'reminders' && String(row.field).startsWith('reminder')));
  session.unresolved = session.unresolved.filter(row => row.family !== family && row.field !== family);
  if(family === 'reminders')session.reminders = null;
  if(family === 'weather')session.dependencies.weatherProfile = null;
  session.interpretationApproved = null;
}

function assistantFocusSetScope(session, scope, date){
  if(!session)return {ok:false};
  if(scope !== 'series' && scope !== 'occurrence')return {ok:false, error:'Choose this date or all dates.'};
  if(scope === 'occurrence'){
    const key = date || session.occurrenceDate;
    if(!key || typeof appointmentDateKey === 'function' && !appointmentDateKey(key)){
      return {ok:false, error:'Choose the date this change applies to.'};
    }
    session.occurrenceDate = key;
  }
  session.eventScope = scope;
  session.scopeSource = 'choice';
  session.unresolved = session.unresolved.filter(row => row.field !== 'eventScope');
  session.interpretationApproved = null;
  return {ok:true};
}

function assistantFocusNormalize(fieldId, raw, session){
  const field = assistantFocusField(fieldId);
  if(!field)return {ok:false, error:'That setting is not editable here.'};
  const text = raw == null ? '' : String(raw).trim();
  const cleared = !session?._fieldLiteral && /^(clear|none|any|off|manual)$/i.test(text);
  if(!text || (cleared && field.clear)){
    if(!field.clear)return {ok:false, error:`${field.label} needs a value.`};
    return {ok:true, op:'clear', value:null};
  }
  const fail = (error) => ({ok:false, error});
  if(fieldId === 'name'){
    const name = text.slice(0, typeof ASSISTANT_NAME_MAX === 'number' ? ASSISTANT_NAME_MAX : 60);
    if(assistantFocusNameRejected(name, session && (session.originalRequest || session.requestText))){
      return fail('That looks like the whole description. What should the item be called?');
    }
    return {ok:true, op:'set', value:name};
  }
  if(fieldId === 'kind'){
    const target=text.replace(/\s+instead of\b[\s\S]*$/i,'').replace(/^.*\b(?:to|into|as)\s+(?:a\s+)?(?=(?:habit|task)\b)/i,'');
    const kinds=[...target.toLowerCase().matchAll(/\b(habit|task)\b/g)];
    const kind=new Set(kinds.map(match=>match[1])).size===1?kinds[0][1]:'';
    if(!kind)return fail('Choose habit or task.');
    if(session && session.operation === 'create' && kind !== session.kind){
      return fail(`This add sheet is for a ${session.kind}. I won’t create a ${kind} instead.`);
    }
    if(session && session.kind === 'event')return fail('An event stays an event. Habit and task conversion is for those items.');
    return {ok:true, op:'set', value:kind};
  }
  if(fieldId === 'habitKind'){
    const habitKind = typeof assistantParseHabitKind === 'function' ? assistantParseHabitKind(text) : null;
    if(!habitKind)return fail('Use build, limit, or stop.');
    return {ok:true, op:'set', value:habitKind};
  }
  if(fieldId === 'emoji' || fieldId === 'exceptionEmoji'){
    const symbols = typeof markSegments === 'function' ? markSegments(text).filter(part => /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3/u.test(part)) : [];
    const mark = symbols.length ? symbols.slice(0,2).join('') : text;
    if(!symbols.length&&!/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3/u.test(text))return fail('Choose an emoji, or remove it.');
    const emoji = typeof assistantParseEmoji === 'function' ? assistantParseEmoji(mark) : mark;
    return {ok:true, op:text.toLowerCase() === 'none' ? 'clear' : 'set', value:emoji || ''};
  }
  if(fieldId === 'emojiBgColor' || fieldId === 'exceptionColor'){
    const color = typeof assistantParseEmojiColor === 'function' ? assistantParseEmojiColor(text) : text;
    if(color == null && text.toLowerCase() !== 'none')return fail('Use one of the item colors, or none.');
    return {ok:true, op:text.toLowerCase() === 'none' ? 'clear' : 'set', value:color || ''};
  }
  if(fieldId === 'priority'){
    const priority = typeof assistantParsePriority === 'function' ? assistantParsePriority(text) : null;
    if(priority == null)return fail('Priority must be 0–5, urgent, or someday.');
    return {ok:true, op:'set', value:priority};
  }
  if(fieldId === 'timesPerPeriod'){
    const times = typeof assistantParseCount === 'function' ? assistantParseCount(text, 1, 30) : parseInt(text, 10);
    if(!times)return fail('How many times should it happen in that period?');
    return {ok:true, op:'set', value:times};
  }
  if(fieldId === 'periodDays'){
    const days = typeof assistantParseCount === 'function' ? assistantParseCount(text, 1, 183) : parseInt(text, 10);
    if(!days)return fail('How many days are in that period?');
    return {ok:true, op:'set', value:days};
  }
  if(fieldId === 'repeatMode'){
    const mode = /opportunit|when conditions|when it fits|when the chance/.test(text.toLowerCase()) ? 'opportunity' : (/routine|regular/.test(text.toLowerCase()) ? 'routine' : '');
    if(!mode)return fail('Choose a regular rhythm or only when conditions fit.');
    return {ok:true, op:'set', value:mode};
  }
  if(fieldId === 'conditionTrigger'){
    const trigger = /location|near|place/.test(text.toLowerCase()) ? 'location' : (/weather/.test(text.toLowerCase()) ? 'weather' : '');
    if(!trigger)return fail('The trigger is the weather, or being near a place.');
    return {ok:true, op:'set', value:trigger};
  }
  if(fieldId === 'conditionRadiusM'){
    const radius = parseInt(text, 10);
    if(!Number.isInteger(radius) || radius < 1 || radius > 100000)return fail('Use a radius from 1 to 100000 meters.');
    return {ok:true, op:'set', value:radius};
  }
  if(fieldId === 'dueDate' || fieldId === 'planByDate' || fieldId === 'appointmentStartDate' || fieldId === 'appointmentUntil'){
    const due = typeof assistantParseDue === 'function' ? assistantParseDue(text, session && session.now) : null;
    if(due == null)return fail('Use today, tomorrow, a weekday, or YYYY-MM-DD.');
    const key = typeof dateKey === 'function' ? dateKey(due) : '';
    return {ok:true, op:'set', value:fieldId === 'dueDate' || fieldId === 'planByDate' ? due : key};
  }
  if(fieldId === 'dueTime' || fieldId === 'appointmentStartMinute' || fieldId === 'exceptionTime'){
    const mins = typeof assistantParseClock === 'function' ? assistantParseClock(text) : null;
    if(mins == null)return fail('Use a clock time such as 6pm or 18:00.');
    return {ok:true, op:'set', value:mins};
  }
  if(fieldId === 'tapStartsSession' || fieldId === 'reminderDnd' || fieldId === 'hardDue' || fieldId === 'breakable' || fieldId === 'trackValue' || fieldId === 'pinned' || fieldId === 'anywhereAllowed' || fieldId === 'showWeather' || fieldId === 'showWeatherAtLocation'){
    const flag = typeof assistantParseBool === 'function' ? assistantParseBool(text) : null;
    if(flag == null)return fail('Say yes or no.');
    return {ok:true, op:'set', value:flag === true};
  }
  if(fieldId === 'earlyWindowDays' || fieldId === 'delayAllowanceDays'){
    const days = typeof assistantParseFlexDays === 'function' ? assistantParseFlexDays(text) : parseInt(text, 10);
    if(days == null || days < 0 || days > 60)return fail('Use 0 to 60 days.');
    return {ok:true, op:'set', value:days};
  }
  if(fieldId === 'allowedWeekdays' || fieldId === 'preferredWeekdays' || fieldId === 'appointmentWeekdays'){
    const days = typeof assistantNormalizeWeekdaysArg === 'function' ? assistantNormalizeWeekdaysArg(text) : null;
    if(!days)return fail('Name the weekdays, or say any day.');
    return {ok:true, op:days.length ? 'set' : 'clear', value:days};
  }
  if(fieldId === 'allowedMonthDays' || fieldId === 'preferredMonthDays'){
    const days = typeof assistantParseMonthDays === 'function' ? assistantParseMonthDays(text) : null;
    if(!days)return fail('Name the days of the month, or say any.');
    return {ok:true, op:days.length ? 'set' : 'clear', value:days};
  }
  if(fieldId === 'allowedOrdinalWeekdays' || fieldId === 'preferredOrdinalWeekdays'){
    const rules=assistantParseOrdinalWeekdays(text);
    if(!rules)return fail('Which weekday and week of the month? For example, the last Friday of each month.');
    return {ok:true,op:rules.length?'set':'clear',value:rules};
  }
  if(fieldId === 'allowedWindow' || fieldId === 'preferredWindow'){
    const window = typeof assistantParseWindowFromText === 'function' ? (assistantParseWindowFromText(text,true) || (/^\d/.test(text) ? assistantParseWindowFromText(`from ${text}`,true) : null)) : null;
    if(!window)return fail('I couldn’t read that time window.');
    return {ok:true, op:'set', value:window};
  }
  if(fieldId === 'allowedTimeFixedStart'){
    const flag = typeof assistantParseBool === 'function' ? assistantParseBool(text) : null;
    if(flag == null)return fail('Say whether the start time is fixed.');
    return {ok:true, op:'set', value:flag === true};
  }
  if(fieldId === 'durationMinutes' || fieldId === 'minChunkMinutes' || fieldId === 'minGapMinutes' || fieldId === 'exceptionDuration'){
    const mins = typeof assistantParseDuration === 'function' ? assistantParseDuration(text) : parseInt(text, 10);
    if(mins == null || mins < 0)return fail('Use a length such as 30 minutes or 1.5 hours.');
    if(fieldId === 'minGapMinutes')return {ok:true, op:mins === 0 ? 'clear' : 'set', value:typeof clampMinGapMinutes === 'function' ? clampMinGapMinutes(mins) : mins};
    if(fieldId !== 'exceptionDuration' && mins < 1)return fail('Use a length of at least one minute.');
    const clamped = fieldId === 'minChunkMinutes' && typeof clampMinChunk === 'function'
      ? clampMinChunk(mins)
      : (typeof clampDuration === 'function' ? clampDuration(mins) : mins);
    return {ok:true, op:'set', value:clamped};
  }
  if(fieldId === 'timerAutoStopMinutes'){
    const mins = typeof assistantParseDuration === 'function' ? assistantParseDuration(text) : parseInt(text, 10);
    if(mins == null)return fail('Use a timer target in minutes, or off.');
    return {ok:true, op:'set', value:typeof normalizeTimerAutoStop === 'function' ? normalizeTimerAutoStop(mins) : mins};
  }
  if(fieldId === 'autoMarkMinutes'){
    const parsed = typeof assistantParseAutoMark === 'function' ? assistantParseAutoMark(text) : null;
    if(parsed === undefined)return fail('Say when it should complete itself, or manual.');
    return {ok:true, op:parsed == null ? 'clear' : 'set', value:parsed};
  }
  if(fieldId === 'sharedDisplay'){
    const mode = /hidden|off/.test(text.toLowerCase()) ? 'hidden' : (/view/.test(text.toLowerCase()) ? 'view' : (/complete|done|mark/.test(text.toLowerCase()) ? 'complete' : ''));
    if(!mode)return fail('Shared display can be hidden, view only, or mark done.');
    if(mode === 'complete' && session && assistantFocusEffectiveKind(session) === 'event'){
      return fail('Events don’t track attendance, so a shared display can view them but not mark them done.');
    }
    return {ok:true, op:'set', value:mode};
  }
  if(fieldId === 'snoozedUntil'){
    const until = typeof assistantParseSnoozeUntil === 'function' ? assistantParseSnoozeUntil(text, session && session.now) : undefined;
    if(until === undefined)return fail('Say how long to snooze, or off.');
    return {ok:true, op:until == null ? 'clear' : 'set', value:until};
  }
  if(fieldId === 'appointmentRepeat'){
    const repeat = /week/.test(text.toLowerCase()) ? 'weekly' : (/once|one|single event/.test(text.toLowerCase()) ? 'once' : '');
    if(!repeat)return fail('An event repeats once, or every week.');
    return {ok:true, op:'set', value:repeat};
  }
  if(fieldId === 'exceptionCancelled'){
    const restore = /restore|uncancel|bring back/.test(text.toLowerCase());
    const cancel = /cancel|skip/.test(text.toLowerCase());
    if(!restore && !cancel)return fail('Cancel this date, or restore it.');
    return {ok:true, op:'set', value:cancel && !restore};
  }
  if(fieldId === 'exceptionReset' || fieldId === 'reminderReset'){
    return {ok:true, op:'set', value:true};
  }
  if(String(fieldId).startsWith('reminder') && fieldId !== 'reminderReset' && !/Lead/.test(fieldId)){
    const allOff=typeof assistantFieldAllRemindersOff==='function'&&assistantFieldAllRemindersOff(text);
    if(!allOff&&!/\bno reminders?\b/i.test(text)&&/\b(?:not|never|don.t|without)\b/i.test(text))return fail('Choose off, notification, or ringing alarm.');
    const mode = /\bno reminders?\b/i.test(text)||allOff?'off':ASSISTANT_FOCUS_REMINDER_MODES.find(item => new RegExp(`\\b${item === 'notification' ? 'notif\\w*' : item}\\b`,'i').test(text))
      ||(/\bring(?:ing)?\b/i.test(text)?'alarm':null)
      || (/\b(?:remind|warn|alert|notify)\b/i.test(text)?'notification':null);
    if(!mode)return fail('Choose off, notification, or ringing alarm.');
    return {ok:true, op:'set', value:mode};
  }
  if(fieldId === 'reminderTravelLead' || fieldId === 'reminderStartLead' || fieldId === 'reminderMissedLead'){
    const mins = parseInt(text, 10);
    const allowed = fieldId === 'reminderMissedLead' ? ASSISTANT_FOCUS_MISSED_LEADS : ASSISTANT_FOCUS_LEADS;
    if(!allowed.includes(mins))return fail(`Use one of these lead times: ${allowed.join(', ')} minutes.`);
    return {ok:true, op:'set', value:mins};
  }
  const settings = assistantFocusSettings();
  const places = settings.locations || [];
  const matchPlace = name => {
    const exact = places.find(place => place.id === name);
    if(exact)return {ok:true, item:exact};
    const found = assistantMatchByName(places, name);
    if(found.ok || found.error === 'AMBIGUOUS')return found;
    const matches = assistantMatchCatalogNames(places, name);
    return matches.length === 1 ? {ok:true, item:matches[0]} : (matches.length ? {ok:false, error:'AMBIGUOUS', matches} : found);
  };
  const unknown = (found, label) => ({ok:false, error:`Choose a saved ${label}.`,
    choices:(found.matches || []).slice(0, 4).map(item => ({id:item.id, label:item.name}))});
  if(fieldId === 'places' || fieldId === 'weatherLocationId'){
    const names = fieldId === 'places' ? text.split(/[,;]|\band\b/i).map(name => name.trim()).filter(Boolean) : [text];
    const ids = [];
    for(const name of names){
      const found = matchPlace(name);
      if(!found.ok)return unknown(found, 'place');
      ids.push(found.item.id);
    }
    return {ok:true, op:'set', value:fieldId === 'places' ? ids : ids[0]};
  }
  if(fieldId === 'topics'){
    const topics = assistantParseTopicsArg(session?._fieldLiteral ? text.split(',') : text);
    return topics && topics.length ? {ok:true, op:'set', value:topics} : fail('Name at least one topic.');
  }
  if(fieldId === 'links'){
    if(!/https?:\/\/|www\.|[a-z][a-z0-9+.-]*:|\b(?:call|whatsapp|facetime)\b|^\+?\d[\d\s().-]{3,}$/i.test(text))return fail('Use an explicit web, phone, or app link.');
    const urls = text.match(/(?:https?:\/\/|www\.)[^\s,;]+/gi);
    const links = assistantParseLinksArg(urls || text.split(/[,;]\s*/));
    return links && links.length ? {ok:true, op:'set', value:links} : fail('Use a valid web, phone, or app link.');
  }
  if(fieldId === 'locationPrefs'){
    const rows = assistantParsePlacePrefsText(text.replace(/\s+as (?:the |a )?(?:place|location)\s*$/i, ''));
    if(!rows)return fail('Use prefer or avoid followed by a saved place.');
    const prefs = {};
    for(const row of rows){
      const found = matchPlace(row.name);
      if(!found.ok)return unknown(found, 'place');
      prefs[found.item.id] = row.level;
    }
    return {ok:true, op:'set', value:prefs};
  }
  if(fieldId === 'weatherProfile'){
    if(/^(inherit|use (?:the )?place.?s weather)$/i.test(text))return {ok:true, op:'set', value:{mode:'inherit', profileId:null}};
    const profiles = settings.weatherProfiles || [];
    const exact = profiles.find(profile => profile.id === text);
    const found = exact ? {ok:true, item:exact} : assistantMatchByName(profiles, text);
    if(!found.ok)return unknown(found, 'weather profile');
    return {ok:true, op:'set', value:{mode:'profile', profileId:found.item.id}};
  }
  if(fieldId === 'weatherRules'){
    const parsed = assistantParseWeatherRulesFromText(text);
    return parsed && parsed.rules && parsed.rules.length ? {ok:true, op:'set', value:parsed.rules} : fail('Describe a weather rule such as temperature above 10 C.');
  }
  if(fieldId === 'scheduleOptions'){
    const options = [];
    for(const part of text.split(';').map(part => part.trim()).filter(Boolean)){
      const parsed = assistantParseScheduleOptionText(part, {places}) || (/^\d/.test(part) ? assistantParseScheduleOptionText(`from ${part}`, {places}) : null);
      if(!parsed || !parsed.option)return fail('Give each alternative a start and end time, with optional weekdays and place.');
      options.push(parsed.option);
    }
    return options.length ? {ok:true, op:'set', value:normalizeHabitScheduleOptions(options)} : fail('Describe a schedule alternative.');
  }
  if(fieldId === 'scheduleLinks'){
    const orderText = (text.match(/\b(?:before|after)\s+.+/i) || [text])[0];
    const parsed = assistantParseOrderText(orderText);
    if(!parsed || !parsed.links)return fail('Use before or after followed by an item name.');
    const modifiers = assistantParseOrderModifiers(text);
    const data = load().filter(item => item.hid !== session.targetId);
    const links = [];
    for(const link of parsed.links){
      const row = {...link, ...modifiers};
      let found = assistantResolveOrderLink(row.name, data, row, [], null);
      if(!found?.ok&&found?.error!=='AMBIGUOUS'){
        const bare=row.name.replace(/\s+(?:workout|habit|task|event)$/i,'');
        if(bare!==row.name)found=assistantResolveOrderLink(bare,data,row,[],null);
      }
      if(!found || !found.ok)return fail(found && found.ask || 'Choose a saved item for the order.');
      links.push(found.link);
    }
    return {ok:true, op:'set', value:links};
  }
  return fail('I can’t apply that setting yet.');
}

function assistantFocusStageWeatherRules(session, rules){
  const settings = assistantFocusSettings();
  const currentId = session.source && session.source.weatherProfileId;
  const shared = load().some(item => item.hid !== session.targetId && item.weatherProfileId === currentId);
  const staged = session.dependencies.weatherProfile;
  const edit = currentId && !shared;
  const id = staged && staged.id || (edit ? currentId : `wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`);
  session.dependencies.weatherProfile = {
    mode:edit ? 'edit' : 'create', id,
    name:edit ? ((settings.weatherProfiles || []).find(profile => profile.id === currentId) || {}).name || 'Weather' : 'Weather for this item',
    rules:assistantFocusClone(rules)
  };
}

function assistantFocusCorrect(session, fieldId, raw){
  if(!session)return {ok:false, error:'Nothing is open to edit.'};
  assistantFocusContinueSavedCreate(session);
  if(fieldId === 'occurrenceDate'){
    const set = assistantFocusSetScope(session, 'occurrence', raw);
    session.correctionError = set.ok ? '' : set.error;
    return set;
  }
  const parsed = assistantFocusNormalize(fieldId, raw, session);
  if(!parsed.ok){
    session.correctionError = parsed.error;
    if(parsed.choices && parsed.choices.length)assistantFocusUnresolve(session, {field:fieldId, family:(assistantFocusField(fieldId) || {}).family, question:parsed.error, choices:parsed.choices});
    session.interpretationApproved = null;
    return parsed;
  }
  session.correctionError = '';
  if(fieldId === 'topics'){
    const known = new Set((assistantFocusSettings().topics || []).map(topic => topic.toLowerCase()));
    session.dependencies.topics = (parsed.value || []).filter(topic => !known.has(topic.toLowerCase()));
  }
  if(fieldId === 'weatherRules'){
    assistantFocusStageWeatherRules(session, parsed.value);
  }else if(fieldId === 'weatherProfile')session.dependencies.weatherProfile = null;
  assistantFocusStage(session, {
    op:parsed.op,
    field:fieldId,
    value:parsed.value,
    source:'correction',
    origin:'correction',
    uncertain:false
  });
  return {ok:true, change:session.changes.find(row => row.field === fieldId)};
}

function assistantFocusChoose(session, fieldId, value){
  const question = session.unresolved.find(item => item.field === fieldId);
  const choice = question && question.choices.find(row => (typeof row === 'string' ? row : row.id) === value);
  if(!choice)return {ok:false, error:'That choice is no longer available.'};
  if(fieldId === 'weatherRules' && ['use-profile','use-rules'].includes(value)
    || fieldId === 'hardDue' && ['hard-deadline','allow-delay'].includes(value)){
    const drop = value === 'use-profile' ? 'weatherRules' : value === 'use-rules' ? 'weatherProfile'
      : value === 'hard-deadline' ? 'delayAllowanceDays' : 'hardDue';
    session.changes = session.changes.filter(change => change.field !== drop);
    if(value === 'use-profile')session.dependencies.weatherProfile = null;
    session.unresolved = session.unresolved.filter(item => item !== question);
    session.interpretationApproved = null;
    session.savedFingerprint = '';
    return {ok:true};
  }
  if(question.family === 'request'){
    session.unresolved = session.unresolved.filter(item => item !== question);
    return {ok:true};
  }
  if(fieldId === 'places' && session.placeResolution){
    const pending = session.placeResolution;
    pending.ids.push(value);
    pending.questions.shift();
    if(pending.questions.length){
      assistantFocusUnresolve(session, pending.questions[0]);
      return {ok:true};
    }
    assistantFocusStage(session, {field:'places', value:[...new Set(pending.ids)], origin:'correction', source:'choice'});
    session.placeResolution = null;
    session.correctionError = '';
    return {ok:true};
  }
  const result = assistantFocusCorrect(session, fieldId, value);
  return result;
}

function assistantFocusClearEndpoint(record, prefix){
  if(typeof assistantClearEndpointFields === 'function'){
    assistantClearEndpointFields(record, prefix);
    return;
  }
  record[prefix] = null;
  record[prefix + 'Anchor'] = null;
  record[prefix + 'OffsetMin'] = 0;
  record[prefix + 'AnchorHabitId'] = null;
  record[prefix + 'Combine'] = null;
  record[prefix + 'Anchor2'] = null;
  record[prefix + 'OffsetMin2'] = 0;
  record[prefix + 'AnchorHabitId2'] = null;
  record[prefix + 'FixedMin2'] = null;
  record[prefix + 'DayOffset'] = 0;
  record[prefix + 'DayOffset2'] = 0;
}

function assistantFocusApplyWindow(record, window, role, data){
  const startPrefix = role === 'preferred' ? 'preferredTimeStart' : 'allowedTimeStart';
  const endPrefix = role === 'preferred' ? 'preferredTimeEnd' : 'allowedTimeEnd';
  if(!window){
    assistantFocusClearEndpoint(record, startPrefix);
    assistantFocusClearEndpoint(record, endPrefix);
    return;
  }
  if(typeof assistantWriteWindowToRecord === 'function'){
    assistantWriteWindowToRecord(record, window, role, data);
    return;
  }
  if(window.start && window.start.kind === 'clock')record[startPrefix] = window.start.minutes;
  if(window.end && window.end.kind === 'clock')record[endPrefix] = window.end.minutes;
}

function assistantFocusApplyTarget(record, scratch){
  if(record.type === 'task' || record.type === 'zero' || record.appointment){
    if(record.type === 'task' || record.type === 'zero')record.target = record.appointment ? record.target : null;
    return;
  }
  if(scratch.times == null && scratch.days == null && scratch.mode == null)return;
  const parts = typeof rhythmParts === 'function' && record.target != null ? rhythmParts(record.target) : {times:1, days:7};
  const times = scratch.times != null ? scratch.times : parts.times;
  const days = scratch.days != null ? scratch.days : parts.days;
  if(record.repeatMode === 'opportunity')record.target = days;
  else record.target = typeof targetFromRhythmParts === 'function' ? targetFromRhythmParts(times, days) : days / times;
}

function assistantFocusExceptionEntry(record, key){
  if(!record.appointment)return null;
  if(!record.appointment.exceptions || typeof record.appointment.exceptions !== 'object')record.appointment.exceptions = {};
  if(!record.appointment.exceptions[key])record.appointment.exceptions[key] = {};
  return record.appointment.exceptions[key];
}

function assistantFocusScopedField(fieldId, session){
  if(session.kind !== 'event' || session.eventScope !== 'occurrence')return fieldId;
  return {durationMinutes:'exceptionDuration', emoji:'exceptionEmoji', emojiBgColor:'exceptionColor', appointmentStartMinute:'exceptionTime'}[fieldId] || fieldId;
}

function assistantFocusWrite(record, change, session, scratch, data){
  change = Object.assign({}, change, {field:assistantFocusScopedField(change.field, session)});
  const op = change.op;
  const value = change.value;
  if(change.field === 'name')record.name = op === 'clear' ? '' : String(value || '').slice(0, 60);
  else if(change.field === 'kind'){
    if(value === 'task'){
      record.type = 'task';
      record.target = null;
      record.repeatMode = 'routine';
    }else if(record.type === 'task'){
      record.type = 'keepup';
      record.dueDate = null;
      record.eventTime = null;
      record.hardDue = false;
    }
  }else if(change.field === 'habitKind'){
    record.type = value;
    if(value === 'zero' || value === 'task')record.target = null;
    if(value !== 'keepup')record.repeatMode = 'routine';
  }else if(change.field === 'emoji')record.emoji = op === 'clear' ? '' : (typeof cleanMark === 'function' ? cleanMark(value) : value);
  else if(change.field === 'emojiBgColor')record.emojiBgColor = op === 'clear' ? '' : value;
  else if(change.field === 'priority')record.priority = value;
  else if(change.field === 'timesPerPeriod')scratch.times = value;
  else if(change.field === 'periodDays')scratch.days = value;
  else if(change.field === 'repeatMode'){
    record.repeatMode = value;
    scratch.mode = value;
  }else if(change.field === 'conditionTrigger')record.conditionTrigger = value;
  else if(change.field === 'conditionRadiusM')record.conditionRadiusM = value;
  else if(change.field === 'dueDate'){
    record.dueDate = op === 'clear' ? null : value;
    // A date-only edit moves an existing clock time with the task. Otherwise
    // its fixed session would remain on the old day despite the new review.
    if(record.eventTime != null){
      const clock = new Date(record.eventTime);
      record.eventTime = record.dueDate == null ? null : parseTaskWhen(dateKey(record.dueDate), assistantClockLabel(clock.getHours()*60+clock.getMinutes()));
    }
  }
  else if(change.field === 'dueTime'){
    if(op === 'clear' || record.dueDate == null)record.eventTime = null;
    else if(typeof parseTaskWhen === 'function'){
      const key = typeof dateKey === 'function' ? dateKey(record.dueDate) : '';
      const label = typeof assistantClockLabel === 'function' ? assistantClockLabel(value) : value;
      record.eventTime = parseTaskWhen(key, label);
    }
  }else if(change.field === 'hardDue'){
    record.hardDue = value === true;
    if(value === true)record.delayAllowanceDays = 0;
    else if(!record.delayAllowanceDays)record.delayAllowanceDays = 1;
  }else if(change.field === 'planByDate')record.planByDate = op === 'clear' ? null : value;
  else if(change.field === 'earlyWindowDays')record.earlyWindowDays = value;
  else if(change.field === 'delayAllowanceDays'){
    record.delayAllowanceDays = value;
    record.hardDue = record.type === 'task' && record.dueDate != null && value === 0;
  }else if(change.field === 'allowedWeekdays')record.allowedWeekdays = op === 'clear' ? [] : value.slice();
  else if(change.field === 'allowedMonthDays')record.allowedMonthDays = op === 'clear' ? [] : value.slice();
  else if(change.field === 'preferredWeekdays')record.preferredWeekdays = op === 'clear' ? [] : value.slice();
  else if(change.field === 'preferredMonthDays')record.preferredMonthDays = op === 'clear' ? [] : value.slice();
  else if(change.field === 'allowedOrdinalWeekdays' || change.field === 'preferredOrdinalWeekdays')record[change.field] = op === 'clear' ? [] : value.map(rule=>({...rule}));
  else if(change.field === 'allowedWindow'){
    if(op === 'clear')assistantFocusApplyWindow(record, null, 'allowed', data);
    else assistantFocusApplyWindow(record, value, 'allowed', data);
    if(!session.changes.some(row => row.field === 'allowedTimeFixedStart'))record.allowedTimeFixedStart = false;
  }else if(change.field === 'preferredWindow'){
    if(op === 'clear')assistantFocusApplyWindow(record, null, 'preferred', data);
    else assistantFocusApplyWindow(record, value, 'preferred', data);
  }else if(change.field === 'allowedTimeFixedStart'){
    record.allowedTimeFixedStart = value === true;
    if(value === true){
      assistantFocusClearEndpoint(record, 'allowedTimeEnd');
      record.allowedTimeEnd = null;
    }
  }else if(change.field === 'durationMinutes')record.durationMinutes = value;
  else if(change.field === 'breakable')record.breakable = value === true;
  else if(change.field === 'minChunkMinutes')record.minChunkMinutes = value;
  else if(change.field === 'minGapMinutes')record.minGapMinutes = op === 'clear' ? 0 : value;
  else if(change.field === 'timerAutoStopMinutes')record.timerAutoStopMinutes = op === 'clear' ? null : value;
  else if(change.field === 'autoMarkMinutes')record.autoMarkMinutes = op === 'clear' ? null : value;
  else if(change.field === 'tapStartsSession')record.tapStartsSession = value === true;
  else if(change.field === 'trackValue')record.trackValue = value === true;
  else if(change.field === 'places')record.locationIds = op === 'clear' ? [] : value.slice();
  else if(change.field === 'anywhereAllowed')record.anywhereAllowed = value === true;
  else if(change.field === 'locationPrefs'){
    record.locationPrefs = op === 'clear' ? {} : Object.assign({}, value);
    record.locationIds = [...new Set((record.locationIds || []).concat(Object.keys(record.locationPrefs)))];
  }
  else if(change.field === 'weatherProfile'){
    record.weatherProfileMode = op === 'clear' ? 'none' : value.mode;
    record.weatherProfileId = value && value.mode === 'profile' ? value.profileId : null;
  }else if(change.field === 'weatherRules' && session.dependencies.weatherProfile){
    record.weatherProfileMode = 'profile';
    record.weatherProfileId = session.dependencies.weatherProfile.id;
  }else if(change.field === 'showWeather')record.showWeather = value === true;
  else if(change.field === 'showWeatherAtLocation')record.showWeatherAtLocation = value === true;
  else if(change.field === 'weatherLocationId')record.weatherLocationId = op === 'clear' ? null : value;
  else if(change.field === 'scheduleOptions')record.scheduleOptions = op === 'clear' ? [] : value.slice();
  else if(change.field === 'scheduleLinks')record.scheduleLinks = op === 'clear' ? [] : value.slice();
  else if(change.field === 'topics')record.topics = op === 'clear' ? [] : value.slice();
  else if(change.field === 'pinned')record.pinned = value === true;
  else if(change.field === 'snoozedUntil')record.snoozedUntil = op === 'clear' ? null : value;
  else if(change.field === 'sharedDisplay'){
    record.showOnSharedDisplay = value !== 'hidden';
    record.allowSharedDisplayCompletion = value === 'complete';
  }else if(change.field === 'links')record.links = op === 'clear' ? [] : value.slice();
  else if(change.field === 'appointmentRepeat' && record.appointment)record.appointment.repeat = value;
  else if(change.field === 'appointmentStartDate' && record.appointment)record.appointment.startDate = value;
  else if(change.field === 'appointmentWeekdays' && record.appointment)record.appointment.weekdays = value.slice();
  else if(change.field === 'appointmentUntil' && record.appointment)record.appointment.until = op === 'clear' ? '' : value;
  else if(change.field === 'appointmentStartMinute' && record.appointment)record.appointment.startMinute = value;
  else if(String(change.field).startsWith('exception') && record.appointment){
    const key = session.occurrenceDate || record.appointment.startDate;
    if(!key)return;
    if(change.field === 'exceptionReset'){
      delete record.appointment.exceptions[key];
      return;
    }
    const entry = assistantFocusExceptionEntry(record, key);
    if(!entry)return;
    if(change.field === 'exceptionTime')entry.startMinute = value;
    else if(change.field === 'exceptionDuration')entry.durationMinutes = value;
    else if(change.field === 'exceptionEmoji'){
      if(op === 'clear')delete entry.emoji;
      else entry.emoji = value;
    }else if(change.field === 'exceptionColor'){
      if(op === 'clear')delete entry.emojiBgColor;
      else entry.emojiBgColor = value;
    }else if(change.field === 'exceptionCancelled'){
      if(value === true)entry.cancelled = true;
      else{
        delete entry.cancelled;
        if(!Object.keys(entry).length)delete record.appointment.exceptions[key];
      }
    }
  }
}

function assistantFocusMaterialize(session, baseline){
  const data = typeof load === 'function' ? load() : [];
  const record = baseline ? assistantFocusClone(baseline) : assistantFocusBaseline(session);
  if(record.appointment){
    record.appointment = assistantFocusClone(record.appointment);
    record.appointment.exceptions = Object.assign({}, record.appointment.exceptions || {});
  }
  const scratch = {times:null, days:null, mode:null};
  const ordered = session.changes.map((change, index) => ({change, index}))
    .sort((a, b) => assistantFocusWriteOrder(a.change.field) - assistantFocusWriteOrder(b.change.field) || a.index - b.index);
  ordered.forEach(row => assistantFocusWrite(record, row.change, session, scratch, data));
  assistantFocusApplyTarget(record, scratch);
  if(record.appointment && typeof normalizeAppointment === 'function'){
    const normalized = normalizeAppointment(record.appointment);
    if(normalized)record.appointment = normalized;
  }
  if(typeof primaryPreferredLocationId === 'function'){
    record.preferredLocationId = primaryPreferredLocationId(record.locationPrefs, record.locationIds);
  }
  // Review and Save share the persistence normalizer: derived deadline flags,
  // flexibility aliases, event projections and order-link defaults must agree.
  // Include saved partners so normalization retains valid order references.
  if(typeof normalize!=='function')return record;
  const normalized=normalize([record,...data.filter(item=>item.hid!==record.hid)]);
  // Switching weekly/one-off recurrence projects the record's type and date.
  // Settle their derived flags too, before persistence normalizes it again.
  return record.appointment?normalize(normalized)[0]:normalized[0];
}

function assistantFocusFormatWeekdays(days){
  if(!days || !days.length)return 'any day';
  return days.map(day => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day] || day).join(', ');
}

function assistantFocusFormatEndpoint(end, data){
  if(!end || end.kind === 'unset')return 'open';
  let label = '';
  if(end.kind === 'clock')label = typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(end.minutes) : String(end.minutes);
  else if(end.kind === 'anchor')label = end.anchor;
  else if(end.kind === 'habit'){
    const match = (data || []).find(item => item && item.hid === end.habitId);
    label = match && match.name || end.habitName || 'another item';
  }
  if(end.offsetMin)label += end.offsetMin > 0 ? ` + ${end.offsetMin} min` : ` − ${Math.abs(end.offsetMin)} min`;
  if(end.dayOffset === 1)label += ', next day';
  if(end.combine && end.second)label += ` (${end.combine} of ${assistantFocusFormatEndpoint(end.second, data)})`;
  return label;
}

function assistantFocusFormatWindow(record, role, data){
  const prefix = role === 'preferred' ? 'preferredTime' : 'allowedTime';
  if(role !== 'preferred' && record.allowedTimeFixedStart && record.allowedTimeStart != null){
    const clock = typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(record.allowedTimeStart) : record.allowedTimeStart;
    return `fixed start ${clock}`;
  }
  const start = typeof assistantEndpointFromHabit === 'function' ? assistantEndpointFromHabit(record, prefix + 'Start') : null;
  const end = typeof assistantEndpointFromHabit === 'function' ? assistantEndpointFromHabit(record, prefix + 'End') : null;
  if((!start || start.kind === 'unset') && (!end || end.kind === 'unset'))return 'any time';
  return `${assistantFocusFormatEndpoint(start, data)} to ${assistantFocusFormatEndpoint(end, data)}`;
}

function assistantFocusFormatValue(fieldId, record, session, staged){
  fieldId = assistantFocusScopedField(fieldId, session);
  const data = typeof load === 'function' ? load() : [];
  if(!record)return '—';
  if(fieldId === 'name')return record.name || '—';
  if(fieldId === 'kind')return record.appointment ? 'event' : (record.type === 'task' ? 'task' : 'habit');
  if(fieldId === 'habitKind')return record.type === 'reduce' ? 'limit' : (record.type === 'zero' ? 'stop' : 'build');
  if(fieldId === 'emoji')return record.emoji || 'none';
  if(fieldId === 'emojiBgColor')return record.emojiBgColor || 'none';
  if(fieldId === 'priority')return `P${record.priority}`;
  if(fieldId === 'timesPerPeriod' || fieldId === 'periodDays'){
    if(record.target == null)return '—';
    const parts = typeof rhythmParts === 'function' ? rhythmParts(record.target) : null;
    if(!parts)return String(record.target);
    return fieldId === 'timesPerPeriod' ? `${parts.times}` : `${parts.days} days`;
  }
  if(fieldId === 'repeatMode')return record.repeatMode === 'opportunity' ? 'when conditions fit' : 'regular rhythm';
  if(fieldId === 'conditionTrigger')return record.conditionTrigger === 'location' ? 'near a place' : 'weather';
  if(fieldId === 'conditionRadiusM')return `${record.conditionRadiusM || 200} m`;
  if(fieldId === 'dueDate')return record.dueDate ? (typeof dateKey === 'function' ? dateKey(record.dueDate) : String(record.dueDate)) : 'none';
  if(fieldId === 'dueTime')return record.eventTime ? new Date(record.eventTime).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'}) : 'none';
  if(fieldId === 'hardDue')return record.hardDue ? 'firm due date' : 'late days allowed';
  if(fieldId === 'planByDate')return record.planByDate ? (typeof dateKey === 'function' ? dateKey(record.planByDate) : String(record.planByDate)) : 'none';
  if(fieldId === 'earlyWindowDays')return `${record.earlyWindowDays || 0} days early`;
  if(fieldId === 'delayAllowanceDays')return `${record.delayAllowanceDays || 0} days late`;
  if(fieldId === 'allowedWeekdays')return assistantFocusFormatWeekdays(record.allowedWeekdays);
  if(fieldId === 'preferredWeekdays')return assistantFocusFormatWeekdays(record.preferredWeekdays);
  if(fieldId === 'allowedMonthDays')return record.allowedMonthDays && record.allowedMonthDays.length ? record.allowedMonthDays.join(', ') : 'any';
  if(fieldId === 'preferredMonthDays')return record.preferredMonthDays && record.preferredMonthDays.length ? record.preferredMonthDays.join(', ') : 'any';
  if(fieldId === 'allowedOrdinalWeekdays' || fieldId === 'preferredOrdinalWeekdays')return ordinalWeekdaySummary(record[fieldId]) || 'any';
  if(fieldId === 'allowedWindow' || fieldId === 'allowedTimeFixedStart')return assistantFocusFormatWindow(record, 'allowed', data);
  if(fieldId === 'preferredWindow')return assistantFocusFormatWindow(record, 'preferred', data);
  if(fieldId === 'durationMinutes')return `${record.durationMinutes} min`;
  if(fieldId === 'breakable')return record.breakable ? 'split into sessions' : 'one session';
  if(fieldId === 'minChunkMinutes')return `${record.minChunkMinutes} min`;
  if(fieldId === 'minGapMinutes')return record.minGapMinutes ? `${record.minGapMinutes} min` : 'no gap';
  if(fieldId === 'timerAutoStopMinutes')return record.timerAutoStopMinutes ? `${record.timerAutoStopMinutes} min` : 'off';
  if(fieldId === 'autoMarkMinutes')return record.autoMarkMinutes == null ? 'manual' : `${record.autoMarkMinutes} min after the start`;
  if(fieldId === 'tapStartsSession')return record.tapStartsSession ? 'tap starts a session' : 'tap logs completion';
  if(fieldId === 'trackValue')return record.trackValue ? 'log a value' : 'off';
  if(fieldId === 'places')return record.locationIds && record.locationIds.length ? record.locationIds.join(', ') : 'no place';
  if(fieldId === 'anywhereAllowed')return record.anywhereAllowed === false ? 'only the saved places' : 'anywhere is allowed';
  if(fieldId === 'locationPrefs')return Object.keys(record.locationPrefs || {}).length ? JSON.stringify(record.locationPrefs) : 'none';
  if(fieldId === 'weatherProfile' || fieldId === 'weatherRules'){
    if(record.weatherProfileMode === 'none')return 'ignore weather rules';
    if(record.weatherProfileMode !== 'profile')return 'use the place’s weather';
    return record.weatherProfileId || 'profile';
  }
  if(fieldId === 'showWeather')return record.showWeather ? 'show the forecast' : 'hide the forecast';
  if(fieldId === 'showWeatherAtLocation')return record.showWeatherAtLocation ? 'forecast at the place' : 'forecast at home';
  if(fieldId === 'weatherLocationId')return record.weatherLocationId || 'home city';
  if(fieldId === 'scheduleOptions')return (record.scheduleOptions || []).map(assistantFocusFormatOption).join('\n') || 'none';
  if(fieldId === 'scheduleLinks')return (record.scheduleLinks || []).map(link => `${link.direction} ${link.anchorHid} (${link.adjacency || 'sometime'}${link.requireSameDay ? ', same day' : ''})`).join('\n') || 'none';
  if(fieldId === 'topics')return (record.topics || []).join(', ') || 'none';
  if(fieldId === 'pinned')return record.pinned ? 'pinned' : 'not pinned';
  if(fieldId === 'snoozedUntil')return record.snoozedUntil ? new Date(record.snoozedUntil).toLocaleString() : 'not snoozed';
  if(fieldId === 'sharedDisplay')return record.showOnSharedDisplay === false ? 'hidden' : (record.allowSharedDisplayCompletion === false ? 'view only' : 'mark done');
  if(fieldId === 'links')return (record.links || []).map(link => `${link.kind}: ${link.value}`).join('\n') || 'none';
  if(fieldId === 'appointmentRepeat')return record.appointment ? record.appointment.repeat : '—';
  if(fieldId === 'appointmentStartDate')return record.appointment ? record.appointment.startDate : '—';
  if(fieldId === 'appointmentWeekdays')return record.appointment ? assistantFocusFormatWeekdays(record.appointment.weekdays) : '—';
  if(fieldId === 'appointmentUntil')return record.appointment && record.appointment.until ? record.appointment.until : 'none';
  if(fieldId === 'appointmentStartMinute')return record.appointment ? (typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(record.appointment.startMinute) : String(record.appointment.startMinute)) : '—';
  if(String(fieldId).startsWith('exception')){
    const key = session && (session.occurrenceDate || (record.appointment && record.appointment.startDate));
    const entry = key && record.appointment && record.appointment.exceptions ? record.appointment.exceptions[key] : null;
    if(fieldId === 'exceptionReset')return entry ? 'custom date' : 'series values';
    if(!entry)return 'series values';
    if(fieldId === 'exceptionCancelled')return entry.cancelled ? 'cancelled' : 'kept';
    if(fieldId === 'exceptionTime')return entry.startMinute != null ? (typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(entry.startMinute) : entry.startMinute) : 'series time';
    if(fieldId === 'exceptionDuration')return entry.durationMinutes != null ? `${entry.durationMinutes} min` : 'series duration';
    if(fieldId === 'exceptionEmoji')return entry.emoji || 'series emoji';
    if(fieldId === 'exceptionColor')return entry.emojiBgColor || 'series color';
  }
  if(String(fieldId).startsWith('reminder')){
    const prefs = typeof nativeReminderPreferences === 'function' ? nativeReminderPreferences() : {items:{}};
    const owner = prefs.items && prefs.items[`item:${session.targetId || session.draftId}`] || {};
    const date = session.eventScope === 'occurrence' ? session.occurrenceDate : '';
    let choice = Object.assign({}, owner, date && owner.dates && owner.dates[date]);
    const patch = assistantFocusReminderPatch(session);
    if(staged)choice = Object.assign({}, patch.reset && date ? owner : choice, patch.patch);
    const edge = {reminderStart:'start', reminderEnd:'end', reminderTravelStart:'travelStart', reminderTravelEnd:'travelEnd', reminderMissed:'missed'};
    const lead = {reminderStartLead:'startLeadMinutes', reminderTravelLead:'travelLeadMinutes', reminderMissedLead:'missedLeadMinutes'};
    if(fieldId === 'reminderDnd')return choice.dnd ? 'DND during session' : 'DND off';
    if(edge[fieldId])return {off:'off', notification:'notification', alarm:'ringing alarm'}[choice[edge[fieldId]] || 'off'];
    if(lead[fieldId])return `${choice[lead[fieldId]] ?? (fieldId === 'reminderMissedLead' ? 15 : 0)} min before`;
    if(fieldId === 'reminderReset')return staged ? 'use the series reminders' : (date && owner.dates && owner.dates[date] ? 'custom reminders for this date' : 'use the series reminders');
  }
  return '';
}

function assistantFocusFormatOption(option){
  if(!option)return '';
  const days = assistantFocusFormatWeekdays(option.weekdays || []);
  const start = option.start != null && typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(option.start) : (option.startAnchor || 'start');
  const end = option.end != null && typeof assistantFriendlyClock === 'function' ? assistantFriendlyClock(option.end) : (option.endAnchor || 'end');
  return `${option.sameDayMode || 'alternative'}: ${days}, ${start}–${end}${option.locationId ? `, place ${option.locationId}` : ''}`;
}

function assistantFocusFormatRule(rule){
  const metric = typeof WEATHER_METRICS !== 'undefined' && WEATHER_METRICS[rule.metric] ? WEATHER_METRICS[rule.metric] : {label:rule.metric, unit:''};
  const bits = [metric.label || rule.metric];
  if(rule.min != null)bits.push(`minimum ${rule.min}${metric.unit || ''}`);
  if(rule.max != null)bits.push(`maximum ${rule.max}${metric.unit || ''}`);
  if(rule.relative && rule.relative !== 'none')bits.push(`prefer ${rule.relative}`);
  bits.push(rule.hard ? 'hard limit' : 'soft preference');
  bits.push(`${rule.importance || 'medium'} importance`);
  bits.push(rule.boundMode === 'percentile' ? 'percentile bounds' : 'absolute bounds');
  return bits.join(', ');
}

function assistantFocusOrigin(session, fieldId, changed){
  if(changed){
    const change = session.changes.find(row => row.field === fieldId);
    return change && change.origin || 'extracted';
  }
  if(session.operation === 'create' && session.formKeys && session.formKeys.includes((assistantFocusField(fieldId) || {}).persist))return 'form';
  if(session.operation === 'create')return 'default';
  return 'preserved';
}

function assistantFocusReviewModel(session){
  const before = session.operation === 'edit' ? session.source : assistantFocusBlank(session);
  const after = assistantFocusMaterialize(session);
  const state = assistantFocusState(session, after);
  const touched = new Set(session.changes.map(change => change.family));
  const rows = [];
  const seen = new Set();
  const essentials = new Set(assistantFocusEssentialFields(session, after));
  session.changes.forEach(change => {
    if(seen.has(change.field))return;
    seen.add(change.field);
    rows.push({
      id:change.field,
      label:(assistantFocusField(change.field) || {}).label || change.field,
      family:change.family,
      origin:change.origin || 'extracted',
      source:change.source || '',
      before:assistantFocusFormatValue(change.field, before, session),
      after:assistantFocusFormatValue(change.field, after, session, true),
      uncertain:Boolean(change.uncertain)
    });
  });
  if(session.operation === 'edit'){
    ASSISTANT_FOCUS_FIELDS.forEach(field => {
      if(seen.has(field.id) || !touched.has(field.family))return;
      if(!assistantFocusFieldApplies(field, state))return;
      rows.push({
        id:field.id,
        label:field.label,
        family:field.family,
        origin:'preserved',
        source:'',
        before:assistantFocusFormatValue(field.id, before, session),
        after:assistantFocusFormatValue(field.id, after, session),
        uncertain:false
      });
    });
  }else{
    ASSISTANT_FOCUS_FIELDS.forEach(field => {
      if(seen.has(field.id) || !assistantFocusFieldApplies(field, state))return;
      const origin = assistantFocusOrigin(session, field.id, false);
      const afterText = assistantFocusFormatValue(field.id, after, session);
      if(origin === 'default' && (afterText === '—' || afterText === 'none' || afterText === 'not pinned' || afterText === 'off'))return;
      if(essentials.has(field.id) || origin === 'form' || session.formKeys.includes(field.persist)){
        rows.push({
          id:field.id, label:field.label, family:field.family, origin:session.formKeys.includes(field.persist) ? 'form' : 'default',
          source:'', before:'—', after:afterText, uncertain:false
        });
      }
    });
  }
  session.unresolved.forEach(item => {
    rows.push({
      id:item.field,
      label:(assistantFocusField(item.field) || {}).label || item.field,
      family:item.family,
      origin:'needed',
      source:'',
      before:'',
      after:item.question,
      uncertain:true
    });
  });
  const notes = [];
  if(session.eventScope === 'occurrence'){
    notes.push(session.occurrenceDate ? `This date only · ${session.occurrenceDate}` : 'This date only');
  }else if(session.kind === 'event' && session.eventScope === 'series'){
    const exceptions = after.appointment && Object.keys(after.appointment.exceptions || {}).length;
    notes.push(exceptions ? 'Whole series. Other dates keep their own changes.' : 'Whole series.');
  }
  const profile = session.dependencies && session.dependencies.weatherProfile;
  const weatherRules = profile && Array.isArray(profile.rules) ? profile.rules.map(assistantFocusFormatRule) : [];
  session.needsInterpretation = session.changes.some(change => change.origin === 'extracted' && change.uncertain) || session.scopeSource === 'request' && session.changes.some(change => change.uncertain);
  session.watched = assistantFocusClone(assistantFocusWatch(session.operation === 'edit' ? session.source : after, session));
  return {
    title:after.name || (session.source && session.source.name) || 'New item',
    operation:session.operation,
    kind:session.kind,
    scope:session.eventScope,
    occurrenceDate:session.occurrenceDate || '',
    rows,
    notes,
    topics:session.dependencies.topics.slice(),
    weatherProfile:profile ? {name:profile.name, mode:profile.mode, rules:weatherRules} : null,
    pending:session.pendingFamilies.slice(),
    question:session.unresolved[0] || null,
    canSave:assistantFocusCanSave(session),
    needsInterpretation:session.needsInterpretation && session.interpretationApproved !== assistantFocusFingerprint(session)
  };
}

function assistantFocusWatch(record, session){
  const watch = {};
  if(!record)return watch;
  const baseline = assistantFocusBaseline(session);
  const draft = assistantFocusMaterialize(session);
  Object.keys(draft).forEach(key => {
    if(JSON.stringify(baseline[key]) !== JSON.stringify(draft[key]))watch[key] = assistantFocusClone(record[key]);
  });
  // Even a no-op proposal watches its field: another editor can change it
  // between this preview and Save. Composite controls watch all their keys.
  session.changes.forEach(change => {
    const id = assistantFocusScopedField(change.field, session);
    const field = assistantFocusField(id);
    if(!field || field.persist === 'reminders')return;
    let keys = [field.persist];
    if(id === 'allowedWindow' || id === 'allowedTimeFixedStart')keys = Object.keys(draft).filter(key => key.startsWith('allowedTime'));
    if(id === 'preferredWindow')keys = Object.keys(draft).filter(key => key.startsWith('preferredTime'));
    if(id === 'sharedDisplay')keys = ['showOnSharedDisplay','allowSharedDisplayCompletion'];
    if(id === 'weatherProfile' || id === 'weatherRules')keys = ['weatherProfileMode','weatherProfileId'];
    keys.forEach(key => {watch[key] = assistantFocusClone(record[key]);});
  });
  return watch;
}

function assistantFocusFingerprint(session){
  return JSON.stringify({
    id:session.targetId || session.draftId,
    operation:session.operation,
    kind:session.kind,
    scope:session.eventScope,
    date:session.occurrenceDate,
    changes:session.changes.map(change => [change.op, change.field, change.value, change.origin]),
    topics:session.dependencies.topics,
    weather:session.dependencies.weatherProfile,
    reminders:session.reminders
  });
}

function assistantFocusCanSave(session){
  if(!assistantFocusAlive(session))return false;
  if(session._focusInFlight)return false;
  if(session.unresolved.length || session.pendingFamilies.length || session.correctionError || session.continuationError)return false;
  if(session.operation === 'edit' && !session.changes.length)return false;
  if(session.operation === 'create' && !session.changes.some(change => change.field === 'name' && change.op === 'set' && change.value))return false;
  if(assistantFocusDraftIssues(session).length)return false;
  if(session.kind === 'event' && session.eventScope == null)return false;
  return true;
}

function assistantFocusApprove(session){
  if(!session)return false;
  session.interpretationApproved = assistantFocusFingerprint(session);
  session.needsInterpretation = session.changes.some(change => change.origin === 'extracted' && change.uncertain);
  return true;
}

function assistantFocusEscape(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function assistantFocusRhythmText(record){
  if(!record || record.type === 'zero' || record.type === 'task' || record.appointment)return '';
  if(record.target == null)return '';
  const parts = typeof rhythmParts === 'function' ? rhythmParts(record.target) : null;
  if(!parts)return '';
  if(record.repeatMode === 'opportunity')return `when conditions fit · once / ${parts.days}d`;
  if(parts.days === 1 && parts.times === 1)return 'daily';
  if(parts.days === 7)return `${parts.times}× / week`;
  return `${parts.times}× / ${parts.days}d`;
}

function assistantFocusDiffText(row, session){
  if(!row)return '';
  const after = String(row.after || '').trim();
  const before = String(row.before || '').trim();
  if(session && session.operation === 'edit' && (row.origin === 'extracted' || row.origin === 'correction') && before && before !== '—' && before !== after){
    return `${before} → ${after}`;
  }
  return after;
}

function assistantFocusWeekdayChip(session, key){
  const after = assistantFocusMaterialize(session);
  const days = after && after[key];
  const afterText = typeof assistantWeekdaySummary === 'function' && assistantWeekdaySummary(days) || assistantFocusFormatWeekdays(days);
  if(session.operation !== 'edit' || !session.source)return afterText === 'any day' ? '' : afterText;
  const beforeDays = session.source[key];
  const beforeText = typeof assistantWeekdaySummary === 'function' && assistantWeekdaySummary(beforeDays) || assistantFocusFormatWeekdays(beforeDays) || 'any day';
  if(!afterText || afterText === beforeText)return afterText === 'any day' ? '' : afterText;
  return `${beforeText || 'any day'} → ${afterText}`;
}

function assistantFocusVisibleOrigin(row){
  if(!row)return 'kept';
  if(row.origin === 'extracted' || row.origin === 'correction')return 'changed';
  if(row.origin === 'form')return 'form';
  if(row.origin === 'default')return 'default';
  return 'kept';
}

// Create still saves add-form values and new-item defaults. The summary lists
// only what this request set, matching an edit.
function assistantFocusListedOrigin(session, origin){
  if(session && session.operation === 'create')return origin === 'changed';
  return origin !== 'form' && origin !== 'default';
}

function assistantFocusChangeChipText(row, session){
  const value = assistantFocusDiffText(row, session);
  if(!value || value === '—' || value === 'none' || value === 'not pinned' || value === 'off')return '';
  const label = String(row.label || '').trim();
  const bare = value.split('→').pop().trim().toLowerCase();
  const name = label.toLowerCase();
  if(!label || bare === name || bare.includes(name) || name.includes(bare))return value;
  return `${label} · ${value}`;
}

function assistantFocusReviewBits(session, model){
  const after = assistantFocusMaterialize(session);
  const state = assistantFocusState(session, after);
  const byId = new Map(model.rows.map(row => [row.id, row]));
  const folded = new Set(['name']);
  const essentials = [];
  const pushEssential = (id, text, origin) => {
    const clean = String(text || '').trim();
    if(!clean || clean === '—' || clean === 'none' || clean === 'undefined min' || clean === 'null min')return;
    essentials.push({id, text:clean, origin:origin || 'kept'});
    folded.add(id);
  };
  if(assistantFocusFieldApplies('durationMinutes', state)){
    const row = byId.get('durationMinutes');
    if(row && row.origin === 'needed')folded.add('durationMinutes');
    else{
      const origin = row ? assistantFocusVisibleOrigin(row) : 'kept';
      if(assistantFocusListedOrigin(session, origin))pushEssential('durationMinutes', row ? assistantFocusDiffText(row, session) : assistantFocusFormatValue('durationMinutes', after, session), origin);
      else folded.add('durationMinutes');
    }
  }
  const rhythmIds = ['timesPerPeriod', 'periodDays', 'repeatMode'];
  const rhythmRows = rhythmIds.map(id => byId.get(id)).filter(Boolean);
  if(session.kind === 'habit' && after.type !== 'zero'){
    if(rhythmRows.some(row => row.origin === 'needed'))rhythmIds.forEach(id => folded.add(id));
    else{
      let text = assistantFocusRhythmText(after);
      const changed = rhythmRows.some(row => row.origin === 'extracted' || row.origin === 'correction');
      if(changed && session.operation === 'edit' && session.source){
        const beforeText = assistantFocusRhythmText(session.source);
        if(beforeText && beforeText !== text)text = `${beforeText} → ${text}`;
      }
      const origin = changed ? 'changed'
        : rhythmRows.some(row => row.origin === 'form') ? 'form'
        : session.operation === 'create' ? 'default'
        : 'kept';
      if(text){
        if(assistantFocusListedOrigin(session, origin))essentials.push({id:'rhythm', text, origin});
        rhythmIds.forEach(id => folded.add(id));
      }
    }
  }
  if(session.kind === 'task'){
    const row = byId.get('dueDate');
    if(row && row.origin === 'needed')folded.add('dueDate');
    else if(row || after.dueDate){
      const origin = row ? assistantFocusVisibleOrigin(row) : 'kept';
      if(assistantFocusListedOrigin(session, origin))pushEssential('dueDate', row ? assistantFocusDiffText(row, session) : assistantFocusFormatValue('dueDate', after, session), origin);
      else folded.add('dueDate');
    }
  }
  ['appointmentStartDate', 'appointmentStartMinute', 'appointmentRepeat'].forEach(id => {
    if(!assistantFocusFieldApplies(id, state))return;
    const row = byId.get(id);
    if(row && row.origin === 'needed'){folded.add(id);return;}
    const origin = row ? assistantFocusVisibleOrigin(row) : 'kept';
    if(assistantFocusListedOrigin(session, origin))pushEssential(id, row ? assistantFocusDiffText(row, session) : assistantFocusFormatValue(id, after, session), origin);
    else folded.add(id);
  });
  const changes = [];
  model.rows.forEach(row => {
    if(folded.has(row.id))return;
    if(row.origin !== 'extracted' && row.origin !== 'correction')return;
    // Staged custom rules get one dedicated chip below; a row here would only duplicate it.
    if(model.weatherProfile && (row.id === 'weatherProfile' || row.id === 'weatherRules'))return;
    const text = row.id === 'allowedWeekdays' || row.id === 'preferredWeekdays'
      ? assistantFocusWeekdayChip(session, row.id)
      : row.id === 'weatherProfile' || row.id === 'weatherRules'
        ? assistantFocusWeatherSelectionText(row)
        : assistantFocusChangeChipText(row, session);
    if(!text)return;
    changes.push({id:row.id, text, origin:'changed'});
  });
  if(model.weatherProfile)changes.push(assistantFocusWeatherRulesChip(model.weatherProfile));
  return {essentials, changes};
}

function assistantFocusProfileName(id){
  return ((assistantFocusSettings().weatherProfiles || []).find(profile => profile && profile.id === id) || {}).name || '';
}

// A saved profile picked by id renders as that id; name it, or fall through to the plain chip.
function assistantFocusWeatherSelectionText(row){
  const name = assistantFocusProfileName(String(row.after || '').trim());
  return name ? `weather profile “${name}”` : assistantFocusChangeChipText(row, null);
}

function assistantFocusWeatherRulesChip(profile){
  const count = (profile.rules || []).length;
  const rules = count ? ` · ${count} ${count === 1 ? 'rule' : 'rules'}` : '';
  const text = profile.mode === 'edit'
    ? `updated “${profile.name}” weather rules${rules}`
    : `custom weather rules${rules}`;
  return {id:'weatherRules', text, origin:'changed'};
}

// Reuse the field catalog's detail targets, with explicit destinations for
// grouped rhythm chips, event controls, and native-only reminders.
function assistantFocusDetailSelector(field, session){
  if(field === 'planByDate')return null; // No editable detail control yet.
  if(field === 'name' && session.eventScope === 'occurrence')return null;
  if(field.startsWith('reminder')){
    if(!window.TingsNative?.isNative)return null;
    const edges = {reminderStart:'start', reminderEnd:'end', reminderTravelStart:'travelStart', reminderTravelEnd:'travelEnd', reminderMissed:'missed'};
    if(edges[field])return `#detail-native-reminders [data-reminder-edge="${edges[field]}"]`;
    return ({reminderDnd:'#detail-native-reminders [aria-label="DND during session"]', reminderTravelLead:'#detail-native-reminders [data-reminder-lead]', reminderMissedLead:'#detail-native-reminders [data-reminder-missed-lead]', reminderStartLead:'#detail-native-reminders [aria-label="event reminder timing"]', reminderReset:'#detail-native-reminders'})[field] || null;
  }
  if(session.kind === 'event'){
    const event = {
      durationMinutes:'detail-appt-duration', places:'detail-appt-place',
      appointmentRepeat:'detail-appt-repeat', appointmentStartDate:'detail-appt-date',
      appointmentStartMinute:'detail-appt-time', appointmentWeekdays:'detail-appt-weekly', appointmentUntil:'detail-appt-until',
      exceptionTime:'detail-appt-time', exceptionDuration:'detail-appt-duration',
      exceptionEmoji:'detail-emoji', exceptionColor:'detail-emoji-bg',
      exceptionCancelled:'detail-appt-skip', exceptionReset:'detail-appt-reset'
    };
    if(event[field])return `#${event[field]}`;
  }
  const id = ({rhythm:'detail-frequency-presets', timesPerPeriod:'detail-times', periodDays:'detail-days',
    conditionTrigger:'detail-condition-trigger', conditionRadiusM:'detail-condition-radius', hardDue:'detail-delay-allowance'})[field]
    || (typeof ASSISTANT_FIELD_SEARCH !== 'undefined' && ASSISTANT_FIELD_SEARCH[field]);
  return id ? `#${id}` : null;
}

function assistantFocusFieldHtml(field, text, className, session){
  const value = `<span class="focus-field-text">${assistantFocusEscape(text)}</span>`;
  if(!assistantFocusDetailSelector(field, session))return `<span class="${className}">${value}</span>`;
  const label = assistantFocusField(field)?.label || (field === 'rhythm' ? 'How often' : field);
  const disabled = session._focusInFlight || (session.operation === 'create' && !String(assistantFocusMaterialize(session).name || '').trim());
  return `<button type="button" class="${className} focus-field" data-focus-field="${assistantFocusEscape(field)}" aria-label="${assistantFocusEscape(`Edit ${label} in details: ${text}`)}" title="${assistantFocusEscape(`Edit ${label} in details`)}" ${disabled ? 'disabled' : ''}>${value}<i class="ti ti-chevron-right" aria-hidden="true"></i></button>`;
}

function assistantFocusChipHtml(chip, session){
  const suffix = chip.origin === 'default' ? '<small>default</small>' : chip.origin === 'form' ? '<small>add form</small>' : '';
  const changed = chip.origin === 'changed' ? ' is-changed' : '';
  const html = assistantFocusFieldHtml(chip.id, chip.text, `assistant-chip${changed}`, session);
  return suffix ? html.replace(/<\/(button|span)>$/, `${suffix}</$1>`) : html;
}

function assistantFocusWorkLabel(job){
  if(!job)return '';
  if(job.def && job.def.label)return String(job.def.label);
  const family = String(job.family || '');
  if(family === 'families' || job.id === '$discover')return 'the request';
  if(family === 'retrieval' || job.id === '$retrieve')return 'related settings';
  if(family === 'completeness' || job.id === '$coverage')return 'the rest';
  if(family === 'scope' || job.id === '$scope')return 'which dates';
  return family;
}

function assistantFocusRunProgress(session){
  const open = new Set(['queued', 'running', 'waiting', 'retryable_failed']);
  const jobs = (session.jobs || []).filter(job => job && job.status && job.status !== 'superseded');
  const visible = jobs.filter(job => job.def || !String(job.id || '').startsWith('$'));
  const done = visible.filter(job => !open.has(job.status)).length;
  const running = jobs.filter(job => job.status === 'running').map(assistantFocusWorkLabel).filter(Boolean);
  const pending = (session.pendingFamilies || []).map(name => String(name || '').trim()).filter(Boolean);
  return {
    done,
    total:visible.length,
    what:running.slice(0, 2).join(', ') || pending[0] || ''
  };
}

function assistantFocusActivityHtml(session, model){
  if(session._focusInFlight){
    const progress = assistantFocusRunProgress(session);
    const what = progress.what ? `Reading ${progress.what}` : 'Reading…';
    const known = progress.total > 0;
    const meter = known
      ? `<div class="focus-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${Math.min(progress.done, progress.total)}" aria-label="${assistantFocusEscape(what)}"><span style="width:${Math.round(Math.min(progress.done, progress.total) / progress.total * 100)}%"></span></div>`
      : `<div class="focus-meter is-busy" role="progressbar" aria-label="${assistantFocusEscape(what)}"><span></span></div>`;
    return `<div class="focus-progress"><p class="focus-note">${assistantFocusEscape(what)}</p>${meter}</div>`;
  }
  if(model.pending.length || session.continuationError){
    const text = session.continuationError || `Still reading: ${model.pending.join(', ')}.`;
    return `<p class="focus-note">${assistantFocusEscape(text)} <button type="button" class="btn" data-focus-choice="resume">continue</button></p>`;
  }
  return '';
}

function assistantFocusReviewHtml(session){
  const model = assistantFocusReviewModel(session);
  const bits = assistantFocusReviewBits(session, model);
  const essentials = bits.essentials.length
    ? `<div class="assistant-chip-row" aria-label="Essentials">${bits.essentials.map(chip => assistantFocusChipHtml(chip, session)).join('')}</div>`
    : '';
  const changes = bits.changes.length
    ? `<div class="assistant-chip-row" aria-label="Changed">${bits.changes.map(chip => assistantFocusChipHtml(chip, session)).join('')}</div>`
    : '';
  const notes = model.notes.map(note => `<p class="focus-note">${assistantFocusEscape(note)}</p>`).join('');
  const pending = assistantFocusActivityHtml(session, model);
  const question = model.question ? `<div class="focus-ask"><p>${assistantFocusEscape(model.question.question)}</p>${(model.question.choices || []).map(choice => {
    const id = typeof choice === 'string' ? choice : choice.id;
    const label = typeof choice === 'string' ? choice : choice.label;
    return `<button type="button" class="btn" data-focus-choice="${assistantFocusEscape(model.question.field || 'choice')}" data-focus-value="${assistantFocusEscape(id)}">${assistantFocusEscape(label)}</button>`;
  }).join('')}</div>` : '';
  const save = `<button type="button" class="btn primary" data-focus-save ${model.canSave ? '' : 'disabled'}>save</button>`;
  const editing = !session._focusInFlight && (session.operation === 'edit' || String(model.title || '').trim());
  const edit = `<button type="button" class="btn" data-focus-edit ${editing ? '' : 'disabled'}>edit</button>`;
  // Save writes a staged change. Edit opens those staged changes. Neither
  // applies to the summary shown before the user has asked for anything.
  const readyForActions = !session._focusInFlight && (session.changes.length || session.unresolved.length);
  const actions = readyForActions ? `<div class="btn-row">${save}${edit}</div>` : '';
  return `<div class="focus-review" data-focus-review>
      <div class="focus-review-head">
        <p class="focus-kicker">${assistantFocusEscape(model.operation === 'create' ? 'New' : 'Edit')} ${assistantFocusEscape(model.kind)}</p>
        <p class="assistant-preview-name">${assistantFocusFieldHtml('name', model.title, 'focus-name', session)}</p>
      </div>
      ${essentials}${changes}${pending}${question}${notes}
      <p class="focus-status" data-focus-status role="status">${assistantFocusEscape(session.correctionError || '')}</p>
      ${actions}
    </div>`;
}

function assistantFocusSettings(){
  return typeof loadSortSettings === 'function' ? loadSortSettings() : {};
}

function assistantFocusPreflight(session, record){
  const data = typeof load === 'function' ? load() : [];
  const settings = assistantFocusSettings();
  if(session.operation === 'create' && data.some(item=>item.hid===record.hid)){
    return {ok:false,error:'This item was already created. Review it as an edit before saving again.'};
  }
  if(session.operation === 'create' && data.length >= (typeof MAX_TINGS === 'number' ? MAX_TINGS : 300)){
    return {ok:false, error:`${typeof MAX_TINGS === 'number' ? MAX_TINGS : 300} habits max`};
  }
  if(session.operation === 'edit' && !assistantFocusLive(session)){
    return {ok:false, error:`${session.source && session.source.name || 'That item'} is no longer on the list.`};
  }
  if(session.operation === 'edit' && session.watched){
    const live = assistantFocusLive(session);
    if(JSON.stringify(assistantFocusWatch(live, session)) !== JSON.stringify(session.watched)){
      session.source = assistantFocusClone(live);
      session.interpretationApproved = null;
      return {ok:false, stale:true, error:`${live.name} changed after this preview. Review the updated change before saving.`};
    }
  }
  const places = typeof normalizeLocationRegistry === 'function'
    ? normalizeLocationRegistry(settings.locations)
    : (settings.locations || []);
  const placeIds = new Set(places.map(place => place && place.id).filter(Boolean));
  for(const id of record.locationIds || []){
    if(!placeIds.has(id))return {ok:false, error:'A selected place is no longer saved. Nothing was saved.'};
  }
  if(record.weatherLocationId && !placeIds.has(record.weatherLocationId)){
    return {ok:false, error:'The forecast place is no longer saved. Nothing was saved.'};
  }
  for(const link of record.scheduleLinks || []){
    if(!data.some(item => item && item.hid === link.anchorHid && item.hid !== record.hid)){
      return {ok:false, error:'An item used for ordering is no longer saved. Nothing was saved.'};
    }
  }
  if(session.kind === 'event' && session.eventScope === 'occurrence'){
    const allowed = new Set(['durationMinutes','emoji','emojiBgColor','appointmentStartMinute']);
    const invalid = session.changes.find(change => !allowed.has(change.field) && !change.field.startsWith('exception') && !change.field.startsWith('reminder'));
    if(invalid)return {ok:false, error:`${(assistantFocusField(invalid.field) || {}).label || invalid.field} applies to all dates. Choose all dates or remove that change.`};
    if(!session.occurrenceDate || !appointmentOccursOn(record, session.occurrenceDate))return {ok:false, error:'Choose a date when this event occurs.'};
  }
  if(session.kind === 'event'){
    const appointment = typeof normalizeAppointment === 'function' ? normalizeAppointment(record.appointment) : record.appointment;
    if(!appointment)return {ok:false, error:'The event needs a date, a start time, and at least one weekday when it repeats. Nothing was saved.'};
    record.appointment = appointment;
  }
  const profile = session.dependencies.weatherProfile;
  if(profile && profile.mode === 'create'){
    const existing = typeof normalizeWeatherProfiles === 'function' ? normalizeWeatherProfiles(settings.weatherProfiles) : (settings.weatherProfiles || []);
    if(existing.length >= (typeof MAX_WEATHER_PROFILES === 'number' ? MAX_WEATHER_PROFILES : 8)){
      return {ok:false, error:'The weather profile list is full. Nothing was saved.'};
    }
  }
  if(session.dependencies.topics.length){
    const current = typeof normalizeTopics === 'function' ? normalizeTopics(settings.topics) : (settings.topics || []);
    const merged = current.concat(session.dependencies.topics);
    const unique = [];
    merged.forEach(topic => {
      if(!unique.some(item => item.toLowerCase() === String(topic).toLowerCase()))unique.push(topic);
    });
    if(unique.length > 24)return {ok:false, error:'The topic list is full. Nothing was saved.'};
  }
  if(session.changes.some(change => String(change.field).startsWith('reminder'))){
    if(!(typeof window !== 'undefined' && window.TingsNative && window.TingsNative.isNative)){
      return {ok:false, error:'Phone reminders are available in the Android app. Nothing was saved, and the draft is still here.'};
    }
  }
  if(!record.name || !String(record.name).trim())return {ok:false, error:'It still needs a name. Nothing was saved.'};
  if(assistantFocusNameRejected(record.name, session.originalRequest || session.requestText)){
    return {ok:false, error:'The name is still the whole description. Nothing was saved.'};
  }
  return {ok:true, settings, data};
}

function assistantFocusReminderPatch(session){
  const patch = {};
  const lead = {reminderTravelLead:'travelLeadMinutes', reminderStartLead:'startLeadMinutes', reminderMissedLead:'missedLeadMinutes'};
  const edge = {reminderStart:'start', reminderEnd:'end', reminderTravelStart:'travelStart', reminderTravelEnd:'travelEnd', reminderMissed:'missed'};
  let reset = false;
  session.changes.forEach(change => {
    if(edge[change.field])patch[edge[change.field]] = change.value;
    if(lead[change.field])patch[lead[change.field]] = change.value;
    if(change.field === 'reminderReset')reset = true;
    if(change.field === 'reminderDnd')patch.dnd = change.value === true;
  });
  return {patch, reset};
}

async function assistantFocusReminderPermission(patch){
  const api = window.TingsNative && window.TingsNative.notifications;
  if(!api)return {ok:false, error:'Phone reminders are available in the Android app. Nothing was saved.'};
  if(Object.hasOwn(patch.patch||{},'dnd')){
    const quiet=window.TingsNative?.quiet;
    if(!quiet)return {ok:false,error:'Do Not Disturb is not available on this device. Nothing was saved.'};
    if(patch.patch.dnd&&!(await quiet.status()).granted)return {ok:false,error:'Allow Do Not Disturb access in the phone settings first. Nothing was saved.'};
  }
  const modes = Object.values(patch.patch || {});
  const needsDisplay = modes.some(mode => mode === 'notification' || mode === 'alarm');
  const needsExact = modes.includes('alarm') || patch.patch.missed && patch.patch.missed !== 'off';
  if(needsDisplay && api.permissions){
    let permission = await api.permissions();
    if(permission.display !== 'granted' && api.requestPermissions)permission = await api.requestPermissions();
    if(!permission || permission.display !== 'granted'){
      return {ok:false, denied:true, error:'Notifications were not allowed. The reminder is still unresolved and nothing was saved.'};
    }
  }
  if(needsExact && api.exactAlarmPermission){
    let exact = await api.exactAlarmPermission();
    if(exact.exact_alarm !== 'granted' && api.requestExactAlarmPermission)exact = await api.requestExactAlarmPermission();
    if(!exact || exact.exact_alarm !== 'granted'){
      return {ok:false, denied:true, error:'Exact timing access was not allowed. The reminder is still unresolved and nothing was saved.'};
    }
  }
  return {ok:true};
}

function assistantFocusWriteReminders(session, hid){
  const staged = assistantFocusReminderPatch(session);
  if(!Object.keys(staged.patch).length && !staged.reset)return;
  const raw = localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY);
  const prefs = raw ? JSON.parse(raw) : {version:4, enabled:false, items:{}};
  if(!prefs.items || typeof prefs.items !== 'object')prefs.items = {};
  const owner = `item:${hid}`;
  const choice = Object.assign({}, prefs.items[owner]);
  const date = session.eventScope === 'occurrence' ? session.occurrenceDate : '';
  const overrides = ['start','end','startLeadMinutes','travelStart','travelEnd','travelLeadMinutes','missed','missedLeadMinutes'];
  if(staged.reset && date){
    const dates = Object.assign({}, choice.dates);
    const entry = Object.assign({}, dates[date]);
    overrides.forEach(key => delete entry[key]);
    Object.assign(entry, staged.patch);
    if(Object.keys(entry).length)dates[date] = entry;
    else delete dates[date];
    choice.dates = dates;
  }else if(staged.reset){
    overrides.forEach(key => delete choice[key]);
    Object.assign(choice, staged.patch);
  }else if(date){
    choice.dates = Object.assign({}, choice.dates, {[date]:Object.assign({}, choice.dates && choice.dates[date], staged.patch)});
  }else Object.assign(choice, staged.patch);
  if(Object.values(staged.patch).some(mode => mode === 'notification' || mode === 'alarm'))prefs.enabled = true;
  prefs.items[owner] = choice;
  prefs.version = 4;
  localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY, JSON.stringify(prefs));
}

function assistantFocusRestore(snapshot){
  if(!snapshot)return;
  if(snapshot.itemKey != null){
    const data = typeof load === 'function' ? load() : [];
    if(snapshot.created){
      const index = data.findIndex(item => item && item.hid === snapshot.createdHid);
      if(index >= 0)data.splice(index, 1);
      if(typeof save === 'function')save(typeof normalize === 'function' ? normalize(data) : data);
    }else if(snapshot.item){
      const index = data.findIndex(item => item && item.hid === snapshot.item.hid);
      if(index >= 0)data[index] = snapshot.item;
      else data.push(snapshot.item);
      if(typeof save === 'function')save(typeof normalize === 'function' ? normalize(data) : data);
    }
  }
  if(snapshot.settings){
    const settings = assistantFocusSettings();
    if(typeof saveSortSettings === 'function')saveSortSettings(Object.assign({}, settings, snapshot.settings));
  }
  if(Object.prototype.hasOwnProperty.call(snapshot, 'reminders')){
    if(snapshot.reminders == null)localStorage.removeItem(ASSISTANT_FOCUS_REMINDER_KEY);
    else localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY, snapshot.reminders);
  }
}

// Reverse only values still equal to what this action wrote. This also works
// for nested appointment exceptions and reminder owners without replacing peers.
function assistantFocusReverse(current, before, after){
  if(JSON.stringify(before) === JSON.stringify(after))return assistantFocusClone(current);
  if(JSON.stringify(current) === JSON.stringify(after))return assistantFocusClone(before);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if(!object(current) || !object(before) && before != null || !object(after) && after != null)return assistantFocusClone(current);
  const result = assistantFocusClone(current);
  new Set([...Object.keys(before || {}), ...Object.keys(after || {})]).forEach(key => {
    const value = assistantFocusReverse(current[key], before && before[key], after && after[key]);
    if(value === undefined)delete result[key];
    else result[key] = value;
  });
  return result;
}

function assistantFocusUndo(snapshot){
  if(!snapshot)return {ok:false};
  const data = typeof load === 'function' ? load() : [];
  const index = data.findIndex(item => item && item.hid === (snapshot.createdHid || snapshot.item && snapshot.item.hid));
  if(snapshot.created){
    if(index >= 0 && JSON.stringify(data[index]) !== JSON.stringify(snapshot.itemAfter))return {ok:false, error:'This item changed after it was added. Keep those edits or remove it manually.'};
    if(index >= 0)data.splice(index, 1);
  }else if(snapshot.item && index >= 0){
    data[index] = assistantFocusReverse(data[index], snapshot.item, snapshot.itemAfter);
  }
  const next = typeof normalize === 'function' ? normalize(data) : data;
  if(typeof save === 'function' && !save(next))return {ok:false, error:'could not undo'};
  const settings = assistantFocusSettings();
  const usedTopics = new Set(next.flatMap(item => item.topics || []).concat(settings.defaultTopics || [], settings.taskDefaults && settings.taskDefaults.topics || []).map(topic => topic.toLowerCase()));
  const oldTopics = new Set((snapshot.topicsBefore || []).map(topic => topic.toLowerCase()));
  const createdTopics = new Set((snapshot.createdTopics || []).map(topic => topic.toLowerCase()).filter(topic => !oldTopics.has(topic)));
  const topics = (settings.topics || []).filter(topic => !createdTopics.has(topic.toLowerCase()) || usedTopics.has(topic.toLowerCase()));
  const usedProfiles = new Set(next.map(item => item.weatherProfileId).filter(Boolean));
  const beforeProfiles = snapshot.profilesBefore || [];
  const afterProfiles = snapshot.profilesAfter || beforeProfiles;
  const profiles = (settings.weatherProfiles || []).flatMap(profile => {
    const before = beforeProfiles.find(row => row.id === profile.id);
    const after = afterProfiles.find(row => row.id === profile.id);
    const shared = next.some(item => item.hid !== snapshot.createdHid && item.weatherProfileId === profile.id) || (settings.locations || []).some(place => place.weatherProfileId === profile.id);
    if(!after || JSON.stringify(before) === JSON.stringify(after) || (!before && usedProfiles.has(profile.id)) || shared)return [profile];
    const restored = assistantFocusReverse(profile, before, after);
    return restored ? [restored] : [];
  });
  if(typeof saveSortSettings === 'function' && (JSON.stringify(topics) !== JSON.stringify(settings.topics) || JSON.stringify(profiles) !== JSON.stringify(settings.weatherProfiles))){
    saveSortSettings(Object.assign({}, settings, {topics, weatherProfiles:profiles}));
  }
  if(Object.prototype.hasOwnProperty.call(snapshot, 'remindersAfter')){
    const current = JSON.parse(localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY) || '{}');
    const before = JSON.parse(snapshot.reminders || '{}');
    const after = JSON.parse(snapshot.remindersAfter || '{}');
    const restored = assistantFocusReverse(current, before, after);
    // Enabling reminders is global: keep it on if a later action still uses it.
    if(current.enabled && JSON.stringify(current.items) !== JSON.stringify(after.items))restored.enabled = true;
    restored.version = 4;
    if(!restored.items)restored.items = {};
    localStorage.setItem(ASSISTANT_FOCUS_REMINDER_KEY, JSON.stringify(restored));
  }
  if(typeof reconcileNativeReminders === 'function')void reconcileNativeReminders();
  if(typeof reconcileNativeQuiet === 'function')void reconcileNativeQuiet();
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  else if(typeof render === 'function')render();
  return {ok:true};
}

function assistantFocusPreviewReminders(session, hid){
  const staged = assistantFocusReminderPatch(session);
  if(!Object.keys(staged.patch).length)return;
  const owner = `item:${hid}`;
  Object.entries(staged.patch).forEach(([key, value]) => {
    const edge = document.querySelector(`select[data-reminder-owner="${CSS.escape(owner)}"][data-reminder-edge="${CSS.escape(key)}"]`);
    if(edge)edge.value = value;
    if(key==='dnd'){
      const toggle=document.querySelector('#detail-native-reminders [aria-label="DND during session"]');
      if(toggle)toggle.checked=value===true;
    }
    if(key === 'travelLeadMinutes'){
      const lead = document.querySelector(`select[data-reminder-lead="${CSS.escape(owner)}"]`);
      if(lead)lead.value = String(value);
    }
    if(key === 'missedLeadMinutes' || key === 'startLeadMinutes'){
      const lead = document.querySelector(`select[data-reminder-missed-lead="${CSS.escape(owner)}"]`)
        || document.querySelector('[aria-label="event reminder timing"]');
      if(lead)lead.value = String(value);
    }
  });
}

function assistantFocusEditDraft(session){
  if(!session || session._focusInFlight)return {ok:false, error:'Still reading that request.'};
  assistantFocusContinueSavedCreate(session);
  const record = assistantFocusMaterialize(session);
  const reminders = session.changes.some(change => String(change.field).startsWith('reminder'))
    ? {hid:record.hid, session:{changes:session.changes.slice(), eventScope:session.eventScope, occurrenceDate:session.occurrenceDate}}
    : null;
  if(session.operation === 'edit'){
    const data = typeof load === 'function' ? load() : [];
    const index = data.findIndex(item => item && item.hid === session.targetId);
    if(index < 0 || typeof openDetailUnsaved !== 'function')return {ok:false, error:'That item is no longer on the list.'};
    if(!openDetailUnsaved(index, record))return {ok:false, error:'The detail editor is unavailable.'};
    if(session.kind === 'event' && session.eventScope === 'occurrence' && $('detail-appt-scope')){
      $('detail-appt-scope').value = 'date';
      $('detail-appt-occurrence').value = session.occurrenceDate;
      $('detail-appt-scope').dispatchEvent(new Event('change'));
    }
    detailUnsavedReminders = reminders;
    assistantFocusPreviewReminders(session, record.hid || session.targetId);
    return {ok:true};
  }
  if(typeof openDetailUnsavedCreate !== 'function' || !openDetailUnsavedCreate(record)){
    return {ok:false, error:'The detail editor needs a name first.'};
  }
  detailUnsavedReminders = reminders;
  assistantFocusPreviewReminders(session, record.hid);
  return {ok:true};
}

async function assistantFocusCommit(session){
  if(!assistantFocusCanSave(session))return {ok:false, error:session && session.unresolved[0] && session.unresolved[0].question || 'This change is not ready to save.'};
  const fingerprint = assistantFocusFingerprint(session);
  if(session.savedResult && session.savedFingerprint === fingerprint)return Object.assign({idempotent:true}, session.savedResult);
  if(session.saving)return session.saving;
  session.saving = assistantFocusCommitNow(session, fingerprint).finally(() => { session.saving = null; });
  return session.saving;
}

async function assistantFocusCommitNow(session, fingerprint){
  let record = assistantFocusMaterialize(session, assistantFocusLive(session));
  let preflight = assistantFocusPreflight(session, record);
  if(!preflight.ok)return preflight;
  const reminderStaged = assistantFocusReminderPatch(session);
  if(Object.keys(reminderStaged.patch).length || reminderStaged.reset){
    const permission = await assistantFocusReminderPermission(reminderStaged);
    if(!permission.ok)return permission;
  }
  // Permission dialogs yield to other edits. Re-read and validate before writing.
  if(!assistantFocusAlive(session))return {ok:false, error:'This editor is no longer open.'};
  if(assistantFocusFingerprint(session) !== fingerprint || !assistantFocusCanSave(session))return {ok:false, error:'The draft changed while checking reminders. Review it before saving.'};
  record = assistantFocusMaterialize(session, assistantFocusLive(session));
  preflight = assistantFocusPreflight(session, record);
  if(!preflight.ok)return preflight;
  const settings = assistantFocusSettings();
  const snapshot = {
    created:session.operation === 'create',
    createdHid:record.hid,
    item:session.operation === 'edit' ? assistantFocusClone(assistantFocusLive(session)) : null,
    itemKey:true,
    topicsBefore:assistantFocusClone(settings.topics || []),
    profilesBefore:assistantFocusClone(settings.weatherProfiles || []),
    createdTopics:session.dependencies.topics.slice(),
    settings:{topics:assistantFocusClone(settings.topics || []), weatherProfiles:assistantFocusClone(settings.weatherProfiles || [])},
    reminders:localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY)
  };
  try{
    let nextSettings = Object.assign({}, settings);
    if(session.dependencies.topics.length){
      nextSettings.topics = typeof normalizeTopics === 'function'
        ? normalizeTopics((settings.topics || []).concat(session.dependencies.topics))
        : (settings.topics || []).concat(session.dependencies.topics);
    }
    const profile = session.dependencies.weatherProfile;
    if(profile){
      const profiles = typeof normalizeWeatherProfiles === 'function'
        ? normalizeWeatherProfiles(settings.weatherProfiles)
        : (settings.weatherProfiles || []).slice();
      if(profile.mode === 'edit'){
        const index = profiles.findIndex(item => item && item.id === profile.id);
        if(index >= 0)profiles[index] = {id:profile.id, name:profile.name, rules:profile.rules};
      }else profiles.push({id:profile.id, name:profile.name, rules:profile.rules});
      nextSettings.weatherProfiles = typeof normalizeWeatherProfiles === 'function' ? normalizeWeatherProfiles(profiles) : profiles;
      record.weatherProfileMode = 'profile';
      record.weatherProfileId = profile.id;
    }
    snapshot.profilesAfter = assistantFocusClone(nextSettings.weatherProfiles || []);
    if((session.dependencies.topics.length || profile) && typeof saveSortSettings === 'function'){
      saveSortSettings(nextSettings);
    }
    const data = typeof load === 'function' ? load() : [];
    let index = session.operation === 'edit' ? data.findIndex(item => item && item.hid === session.targetId) : -1;
    if(session.operation === 'edit' && index < 0)throw new Error('that item is gone');
    let merged;
    if(index >= 0){
      const prev = data[index];
      merged = Object.assign({}, prev, record, {
        hid:prev.hid,
        logs:prev.logs,
        lastLog:prev.lastLog,
        createdAt:prev.createdAt,
        sample:prev.sample,
        externalId:prev.externalId,
        source:prev.source,
        importedAt:prev.importedAt
      });
      if(prev.source === 'ics' || prev.source === 'device'){
        merged.calendarSubject = prev.calendarSubject;
        merged.calendarStart = prev.calendarStart;
        merged.calendarEnd = prev.calendarEnd;
        merged.calendarSeriesId = prev.calendarSeriesId;
        merged.calendarId = prev.calendarId;
      }
      data[index] = merged;
    }else{
      merged = record;
      data.push(merged);
      index = data.length - 1;
    }
    const normalized = typeof normalize === 'function' ? normalize(data) : data;
    if(typeof save !== 'function' || !save(normalized))throw new Error('could not save');
    const saved = normalized.find(item => item && item.hid === merged.hid) || normalized[index];
    snapshot.itemAfter = assistantFocusClone(saved);
    if(Object.keys(reminderStaged.patch).length || reminderStaged.reset){
      assistantFocusWriteReminders(session, saved.hid);
      snapshot.remindersAfter = localStorage.getItem(ASSISTANT_FOCUS_REMINDER_KEY);
      if(typeof reconcileNativeRemindersNow === 'function')await reconcileNativeRemindersNow();
      else if(typeof reconcileNativeReminders === 'function')await reconcileNativeReminders();
      if(Object.hasOwn(reminderStaged.patch,'dnd')&&typeof reconcileNativeQuiet==='function')await reconcileNativeQuiet();
    }
    if(session.operation === 'edit')session.source = assistantFocusClone(saved);
    session.savedFingerprint = fingerprint;
    session.savedResult = {ok:true, hid:saved.hid, name:saved.name, index:normalized.indexOf(saved)};
    session.targetId = saved.hid;
    if(typeof showActionToast === 'function'){
      showActionToast(`${session.operation === 'create' ? 'Added' : 'Updated'} ${saved.name}`, {
        type:'focus-edit', undoLabel:'undo', snapshot
      });
    }
    if(typeof refreshOpenViews === 'function')refreshOpenViews();
    else if(typeof render === 'function')render();
    return session.savedResult;
  }catch(error){
    if(snapshot.itemAfter)assistantFocusUndo(snapshot);
    else assistantFocusRestore(snapshot);
    return {ok:false, error:error && error.message || 'could not save'};
  }
}
