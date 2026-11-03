// Editable fields Needle may stage for one habit, task, or local event.
// Derived history, ids, import metadata, and OS permission state are omitted.
// `persist` names the saved record key. List and window fields use the writers
// in assistant-focus.js because one control maps to several record keys.

const ASSISTANT_FOCUS_FAMILIES = [
  'identity','recurrence','dates','schedule','effort','places','weather',
  'alternatives','order','organization','event','exception','reminders'
];

const ASSISTANT_FOCUS_FIELDS = [
  {id:'name', label:'Name', family:'identity', kinds:['habit','task','event'], persist:'name', clear:false},
  {id:'kind', label:'Habit or task', family:'identity', kinds:['habit','task'], persist:'type', clear:false},
  {id:'habitKind', label:'Build, limit, or stop', family:'identity', kinds:['habit'], persist:'type', clear:false},
  {id:'emoji', label:'Emoji', family:'identity', kinds:['habit','task','event'], persist:'emoji', clear:true},
  {id:'emojiBgColor', label:'Color', family:'identity', kinds:['habit','task','event'], persist:'emojiBgColor', clear:true},
  {id:'priority', label:'Priority', family:'identity', kinds:['habit','task'], persist:'priority', clear:false},

  {id:'timesPerPeriod', label:'Times per period', family:'recurrence', kinds:['habit'], persist:'target', clear:false},
  {id:'periodDays', label:'Period length', family:'recurrence', kinds:['habit'], persist:'target', clear:false},
  {id:'repeatMode', label:'Routine or opportunity', family:'recurrence', kinds:['habit'], persist:'repeatMode', clear:false},
  {id:'conditionTrigger', label:'Weather or location trigger', family:'recurrence', kinds:['habit'], persist:'conditionTrigger', clear:false, when:'opportunity'},
  {id:'conditionRadiusM', label:'Proximity radius', family:'recurrence', kinds:['habit'], persist:'conditionRadiusM', clear:false, when:'opportunity'},

  {id:'dueDate', label:'Due date', family:'dates', kinds:['task'], persist:'dueDate', clear:true},
  {id:'dueTime', label:'Start time', family:'dates', kinds:['task'], persist:'eventTime', clear:true},
  {id:'hardDue', label:'Hard deadline', family:'dates', kinds:['task'], persist:'delayAllowanceDays', clear:false},
  {id:'planByDate', label:'Do-by date', family:'dates', kinds:['habit'], persist:'planByDate', clear:true, when:'routine'},
  {id:'earlyWindowDays', label:'Early allowance', family:'dates', kinds:['habit','task'], persist:'earlyWindowDays', clear:false},
  {id:'delayAllowanceDays', label:'Late allowance', family:'dates', kinds:['habit','task'], persist:'delayAllowanceDays', clear:false},

  {id:'allowedWeekdays', label:'Allowed weekdays', family:'schedule', kinds:['habit','task'], persist:'allowedWeekdays', clear:true},
  {id:'allowedMonthDays', label:'Allowed month days', family:'schedule', kinds:['habit','task'], persist:'allowedMonthDays', clear:true},
  {id:'allowedWindow', label:'Allowed hours', family:'schedule', kinds:['habit','task'], persist:'allowedTimeStart', clear:true},
  {id:'allowedTimeFixedStart', label:'Fixed start', family:'schedule', kinds:['habit','task'], persist:'allowedTimeFixedStart', clear:false},
  {id:'preferredWeekdays', label:'Preferred weekdays', family:'schedule', kinds:['habit','task'], persist:'preferredWeekdays', clear:true},
  {id:'preferredMonthDays', label:'Preferred month days', family:'schedule', kinds:['habit','task'], persist:'preferredMonthDays', clear:true},
  {id:'preferredWindow', label:'Preferred hours', family:'schedule', kinds:['habit','task'], persist:'preferredTimeStart', clear:true},

  {id:'durationMinutes', label:'Duration', family:'effort', kinds:['habit','task','event'], persist:'durationMinutes', clear:false, unless:'zero'},
  {id:'breakable', label:'Splitting', family:'effort', kinds:['habit','task'], persist:'breakable', clear:false},
  {id:'minChunkMinutes', label:'Shortest session', family:'effort', kinds:['habit','task'], persist:'minChunkMinutes', clear:false, when:'breakable'},
  {id:'minGapMinutes', label:'Minimum gap', family:'effort', kinds:['habit','task'], persist:'minGapMinutes', clear:true},
  {id:'timerAutoStopMinutes', label:'Timer target', family:'effort', kinds:['habit','task'], persist:'timerAutoStopMinutes', clear:true},
  {id:'autoMarkMinutes', label:'Automatic completion', family:'effort', kinds:['habit','task'], persist:'autoMarkMinutes', clear:true},
  {id:'trackValue', label:'Value tracking', family:'effort', kinds:['habit','task'], persist:'trackValue', clear:false},

  {id:'places', label:'Places', family:'places', kinds:['habit','task','event'], persist:'locationIds', clear:true},
  {id:'anywhereAllowed', label:'Anywhere', family:'places', kinds:['habit','task'], persist:'anywhereAllowed', clear:false},
  {id:'locationPrefs', label:'Place preferences', family:'places', kinds:['habit','task'], persist:'locationPrefs', clear:true},

  {id:'weatherProfile', label:'Weather profile', family:'weather', kinds:['habit','task'], persist:'weatherProfileId', clear:true},
  {id:'weatherRules', label:'Weather rules', family:'weather', kinds:['habit','task'], persist:'weatherProfileId', clear:false},
  {id:'showWeather', label:'Show forecast', family:'weather', kinds:['habit','task'], persist:'showWeather', clear:false},
  {id:'showWeatherAtLocation', label:'Forecast at the place', family:'weather', kinds:['habit','task'], persist:'showWeatherAtLocation', clear:false},
  {id:'weatherLocationId', label:'Forecast place', family:'weather', kinds:['habit','task'], persist:'weatherLocationId', clear:true},

  {id:'scheduleOptions', label:'Schedule alternatives', family:'alternatives', kinds:['habit','task'], persist:'scheduleOptions', clear:true},
  {id:'scheduleLinks', label:'Order', family:'order', kinds:['habit','task'], persist:'scheduleLinks', clear:true},

  {id:'topics', label:'Topics', family:'organization', kinds:['habit','task','event'], persist:'topics', clear:true},
  {id:'pinned', label:'Pinned', family:'organization', kinds:['habit','task','event'], persist:'pinned', clear:false},
  {id:'snoozedUntil', label:'Snooze', family:'organization', kinds:['habit','task'], persist:'snoozedUntil', clear:true},
  {id:'sharedDisplay', label:'Shared display', family:'organization', kinds:['habit','task','event'], persist:'showOnSharedDisplay', clear:false},
  {id:'links', label:'Links', family:'organization', kinds:['habit','task','event'], persist:'links', clear:true},

  {id:'appointmentRepeat', label:'Repeats', family:'event', kinds:['event'], persist:'appointment', clear:false, scope:'series'},
  {id:'appointmentStartDate', label:'Start date', family:'event', kinds:['event'], persist:'appointment', clear:false, scope:'series'},
  {id:'appointmentWeekdays', label:'Repeat weekdays', family:'event', kinds:['event'], persist:'appointment', clear:false, scope:'series'},
  {id:'appointmentUntil', label:'End date', family:'event', kinds:['event'], persist:'appointment', clear:true, scope:'series'},
  {id:'appointmentStartMinute', label:'Start time', family:'event', kinds:['event'], persist:'appointment', clear:false, scope:'series'},

  {id:'exceptionTime', label:'Time on this date', family:'exception', kinds:['event'], persist:'appointment', clear:false, scope:'occurrence'},
  {id:'exceptionDuration', label:'Duration on this date', family:'exception', kinds:['event'], persist:'appointment', clear:false, scope:'occurrence'},
  {id:'exceptionEmoji', label:'Emoji on this date', family:'exception', kinds:['event'], persist:'appointment', clear:true, scope:'occurrence'},
  {id:'exceptionColor', label:'Color on this date', family:'exception', kinds:['event'], persist:'appointment', clear:true, scope:'occurrence'},
  {id:'exceptionCancelled', label:'This date', family:'exception', kinds:['event'], persist:'appointment', clear:false, scope:'occurrence'},
  {id:'exceptionReset', label:'Use the usual values', family:'exception', kinds:['event'], persist:'appointment', clear:false, scope:'occurrence'},

  {id:'reminderStart', label:'Start reminder', family:'reminders', kinds:['habit','task','event'], persist:'reminders', clear:false},
  {id:'reminderEnd', label:'End reminder', family:'reminders', kinds:['habit','task','event'], persist:'reminders', clear:false},
  {id:'reminderTravelStart', label:'Travel departure reminder', family:'reminders', kinds:['habit','task'], persist:'reminders', clear:false},
  {id:'reminderTravelEnd', label:'Travel arrival reminder', family:'reminders', kinds:['habit','task'], persist:'reminders', clear:false},
  {id:'reminderMissed', label:'Drop warning', family:'reminders', kinds:['habit','task'], persist:'reminders', clear:false, unless:'opportunity'},
  {id:'reminderTravelLead', label:'Departure lead', family:'reminders', kinds:['habit','task'], persist:'reminders', clear:false},
  {id:'reminderStartLead', label:'Event lead', family:'reminders', kinds:['event'], persist:'reminders', clear:false},
  {id:'reminderMissedLead', label:'Drop-warning lead', family:'reminders', kinds:['habit','task'], persist:'reminders', clear:false, unless:'opportunity'},
  {id:'reminderReset', label:'Use the usual reminders', family:'reminders', kinds:['habit','task','event'], persist:'reminders', clear:false, scope:'occurrence'}
];

const ASSISTANT_FOCUS_FIELD_INDEX = Object.fromEntries(ASSISTANT_FOCUS_FIELDS.map(field => [field.id, field]));

function assistantFocusField(id){
  return ASSISTANT_FOCUS_FIELD_INDEX[id] || null;
}

function assistantFocusFields(family){
  return ASSISTANT_FOCUS_FIELDS.filter(field => !family || field.family === family);
}

function assistantFocusKindOf(item){
  if(!item)return 'habit';
  if(typeof isLocalAppointment === 'function' && isLocalAppointment(item))return 'event';
  return item.type === 'task' ? 'task' : 'habit';
}

function assistantFocusImported(item){
  return Boolean(item && ['device','pdf','ics','gcal','msgraph'].includes(item.source));
}

function assistantFocusContextKind(ctx){
  const kind = ctx && (ctx.effectiveKind || ctx.kind) || 'habit';
  const type = ctx && ctx.type || (kind === 'task' ? 'task' : 'keepup');
  const repeatMode = ctx && ctx.repeatMode || 'routine';
  return {kind, type, repeatMode, breakable:Boolean(ctx && ctx.breakable), scope:ctx && ctx.scope || null};
}

function assistantFocusFieldApplies(field, ctx){
  const spec = typeof field === 'string' ? assistantFocusField(field) : field;
  if(!spec)return false;
  const state = assistantFocusContextKind(ctx);
  if(!spec.kinds.includes(state.kind))return false;
  if(spec.when === 'opportunity' && state.repeatMode !== 'opportunity')return false;
  if(spec.when === 'routine' && (state.repeatMode === 'opportunity' || state.type === 'zero'))return false;
  if(spec.when === 'breakable' && !state.breakable)return false;
  if(spec.unless === 'zero' && state.type === 'zero')return false;
  if(spec.unless === 'opportunity' && state.repeatMode === 'opportunity')return false;
  if(spec.scope && state.scope && spec.scope !== state.scope && !(spec.id === 'appointmentStartMinute' && state.scope === 'occurrence'))return false;
  return true;
}

function assistantFocusCoverageLedger(){
  return ASSISTANT_FOCUS_FIELDS.map(field => ({
    id:field.id,
    label:field.label,
    family:field.family,
    kinds:field.kinds.slice(),
    persist:field.persist,
    clear:field.clear === true,
    scope:field.scope || null
  }));
}
