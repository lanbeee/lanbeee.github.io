// Needle focused sessions call the live on-device model only.
// The host locks create versus edit and the item. The model may only copy
// supporting words from the original request. Those words are validated here.
// Nothing in this file scans the request to invent a setting the model omitted.

const ASSISTANT_FOCUS_FAMILY_ALIAS = {
  name:'identity', identity:'identity', emoji:'identity', priority:'identity', kind:'identity',
  frequency:'recurrence', rhythm:'recurrence', recurrence:'recurrence', times:'recurrence',
  date:'dates', dates:'dates', due:'dates', deadline:'dates',
  schedule:'schedule', weekdays:'schedule', hours:'schedule', window:'schedule', days:'schedule',
  duration:'effort', effort:'effort', length:'effort',
  place:'places', places:'places', location:'places',
  weather:'weather',
  option:'alternatives', alternatives:'alternatives',
  order:'order', before:'order', after:'order',
  topic:'organization', topics:'organization', organization:'organization', pin:'organization', link:'organization',
  event:'event', appointment:'event',
  exception:'exception', cancel:'exception',
  reminder:'reminders', reminders:'reminders', alarm:'reminders'
};

const ASSISTANT_FOCUS_OUTSIDE_ALIAS = {
  complete:'log', log:'log', done:'log', delete:'delete', remove:'delete',
  question:'question', ask:'question', planner:'planner', agenda:'planner',
  other:'other_item', extra:'extra_item', another:'other_item', calendar:'calendar_write'
};

const ASSISTANT_FOCUS_EXTRACT_FIELDS = {
  identity:[['name','name'],['kind','kind'],['habitKind','habit'],['emoji','emoji'],['emojiBgColor','color'],['priority','priority']],
  recurrence:[['timesPerPeriod','times'],['periodDays','period'],['repeatMode','mode'],['conditionTrigger','trigger'],['conditionRadiusM','radius']],
  dates:[['dueDate','due'],['dueTime','time'],['hardDue','hard'],['planByDate','planBy'],['earlyWindowDays','early'],['delayAllowanceDays','late']],
  schedule:[['allowedWeekdays','weekdays'],['allowedMonthDays','monthDays'],['allowedWindow','window'],['allowedTimeFixedStart','fixed'],['preferredWeekdays','preferredDays'],['preferredMonthDays','preferredMonthDays'],['preferredWindow','preferredWindow']],
  effort:[['durationMinutes','duration'],['breakable','split'],['minChunkMinutes','chunk'],['minGapMinutes','gap'],['timerAutoStopMinutes','timer'],['autoMarkMinutes','auto'],['trackValue','value']],
  places:[['places','places'],['anywhereAllowed','anywhere'],['locationPrefs','prefs']],
  weather:[['weatherRules','rules'],['showWeather','show'],['showWeatherAtLocation','atPlace'],['weatherLocationId','forecastPlace'],['weatherProfile','profile']],
  alternatives:[['scheduleOptions','options']],
  order:[['scheduleLinks','order']],
  organization:[['topics','topics'],['pinned','pinned'],['snoozedUntil','snooze'],['sharedDisplay','display'],['links','links']],
  event:[['appointmentRepeat','repeat'],['appointmentStartDate','date'],['appointmentWeekdays','weekdays'],['appointmentUntil','until'],['appointmentStartMinute','time']],
  exception:[['exceptionTime','time'],['exceptionDuration','duration'],['exceptionEmoji','emoji'],['exceptionColor','color'],['exceptionCancelled','cancelled'],['exceptionReset','reset']],
  reminders:[['reminderStart','start'],['reminderEnd','end'],['reminderTravelStart','travelStart'],['reminderTravelEnd','travelEnd'],['reminderMissed','missed'],['reminderTravelLead','travelLead'],['reminderStartLead','startLead'],['reminderMissedLead','missedLead'],['reminderReset','reset']]
};

function assistantFocusPackTool(name, description, properties, required){
  const schema = {type:'object', properties, required:required || []};
  const parameters = typeof assistantNeedleSchema === 'function' ? assistantNeedleSchema(schema) : schema;
  return {name, description:String(description || '').slice(0, 180), parameters};
}

function assistantFocusRequestLine(record, text){
  return `Extract the ${record} record from this text: ${text}`;
}

function assistantFocusArgs(raw){
  const calls = [...(raw && raw.function_calls || []), ...(raw && raw.suppressed_calls || [])];
  let args = calls[0] && calls[0].arguments || {};
  if(typeof args === 'string'){
    try{ args = JSON.parse(args); }catch(_){ args = {}; }
  }
  if(!args || typeof args !== 'object')args = {};
  return {args, confidence:raw && raw.confidence, raw};
}

function assistantFocusSplitEvidence(text){
  return String(text || '').split(';').map(part => {
    const mark = part.indexOf(':');
    if(mark < 1)return null;
    return {label:part.slice(0, mark).trim().toLowerCase(), phrase:part.slice(mark + 1).trim()};
  }).filter(row => row && row.phrase);
}

function assistantFocusApplicable(session){
  const kind = session.kind;
  const allowed = new Set();
  ASSISTANT_FOCUS_FAMILIES.forEach(family => {
    if(family === 'event' || family === 'exception'){
      if(kind === 'event')allowed.add(family);
      return;
    }
    if(kind === 'event' && (family === 'recurrence' || family === 'dates' || family === 'schedule' || family === 'alternatives' || family === 'order'))return;
    if(assistantFocusFields(family).some(field => field.kinds.includes(kind)))allowed.add(family);
  });
  return allowed;
}

function assistantFocusSystem(session){
  const which = session.operation === 'create'
    ? `Create one ${session.kind} only.`
    : `Edit only ${session.source && session.source.name || 'this item'}.`;
  return `${which} Copy the user's exact words into the record.`;
}

async function assistantFocusLiveExtract(spec){
  if(typeof assistantNeedleEnsureReady !== 'function' || typeof assistantNeedleRequest !== 'function'){
    throw new Error('Needle is not available on this page.');
  }
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  await assistantNeedleEnsureReady();
  const ready = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
  const result = await assistantNeedleRequest('focus', {
    system:spec.system,
    request:spec.request,
    tools:spec.tools || [spec.tool]
  });
  if(result && typeof result === 'object')result._readyMs = ready;
  return result;
}

function assistantFocusEnsure(session){
  if(!assistantFocusAlive(session)){
    const error = new DOMException('Cancelled', 'AbortError');
    throw error;
  }
}

function assistantFocusNoteTiming(session, family, started, ready){
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  session.timing.passes.push({family, ms:Math.round(now - started)});
  if(ready && !session.timing.init)session.timing.init = Math.round(ready);
}

async function assistantFocusModel(session, spec, extract){
  assistantFocusEnsure(session);
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const raw = await extract(spec);
  assistantFocusEnsure(session);
  assistantFocusNoteTiming(session, spec.family, started, raw && raw._readyMs);
  const parsed = assistantFocusArgs(raw);
  session.trace = session.trace || [];
  session.trace.push({
    family:spec.family,
    args:parsed.args,
    confidence:parsed.confidence,
    calls:(raw && raw.function_calls || []).map(call => call.name),
    suppressed:(raw && raw.suppressed_calls || []).map(call => call.name),
    content:raw && raw.content || '',
    reasoning:raw && raw.reasoning || ''
  });
  return parsed;
}

function assistantFocusReadEvidence(args){
  return args.evidence || args.families || args.text || args.missing || '';
}

function assistantFocusFamilyHasSignal(family, phrase){
  if(!phrase)return false;
  if(family === 'recurrence'){
    const rhythm = typeof assistantParseRhythm === 'function' ? assistantParseRhythm(phrase) : null;
    return Boolean(rhythm && (rhythm.timesPerPeriod || rhythm.periodDays));
  }
  if(family === 'effort'){
    return /\b(?:minute|minutes|min|hour|hours)\b/i.test(phrase)
      && typeof assistantParseDuration === 'function' && assistantParseDuration(phrase) != null;
  }
  if(family === 'schedule'){
    const days = typeof assistantParseWeekdaySchedule === 'function' ? assistantParseWeekdaySchedule(phrase) : null;
    const window = typeof assistantParseWindowFromText === 'function' ? assistantParseWindowFromText(phrase) : null;
    return Boolean((days && days.length) || window);
  }
  return true;
}

function assistantFocusUnlabeled(phrase, allowed){
  const out = [];
  const add = family => { if(allowed.has(family))out.push({family, phrase}); };
  const rhythm = typeof assistantParseRhythm === 'function' ? assistantParseRhythm(phrase) : null;
  if(rhythm && (rhythm.timesPerPeriod || rhythm.periodDays))add('recurrence');
  if(typeof assistantParseDuration === 'function' && assistantParseDuration(phrase))add('effort');
  const days = typeof assistantParseWeekdaySchedule === 'function' ? assistantParseWeekdaySchedule(phrase) : null;
  const window = typeof assistantParseWindowFromText === 'function' ? assistantParseWindowFromText(phrase) : null;
  if((days && days.length) || window)add('schedule');
  return out;
}

function assistantFocusCollectFamilies(session, evidence){
  const allowed = assistantFocusApplicable(session);
  const families = [];
  const outside = [];
  assistantFocusSplitEvidence(evidence).forEach(row => {
    const key = row.label.replace(/\s+/g, '');
    if(!assistantFocusPhraseIn((session.currentRequest || session.originalRequest), row.phrase))return;
    const family = ASSISTANT_FOCUS_FAMILY_ALIAS[key];
    if(family && allowed.has(family)){
      families.push({family, phrase:row.phrase});
      return;
    }
    const blocked = ASSISTANT_FOCUS_OUTSIDE_ALIAS[key];
    if(blocked)outside.push({kind:blocked, phrase:row.phrase});
  });
  if(!families.length){
    String(evidence || '').split(';').map(part => part.trim()).filter(Boolean).forEach(phrase => {
      if(!assistantFocusPhraseIn((session.currentRequest || session.originalRequest), phrase))return;
      assistantFocusUnlabeled(phrase, allowed).forEach(row => families.push(row));
    });
  }
  return {families, outside};
}

function assistantFocusBlockOutside(session, outside){
  outside.forEach(row => {
    const already = session.unresolved.some(item => item.field === row.kind && item.question.includes(row.phrase));
    if(already)return;
    assistantFocusUnresolve(session, {
      field:row.kind,
      family:'request',
      question:`This editor only changes the open item. I will not do this: “${row.phrase}”.`,
      choices:[{id:row.kind, label:'skip that part'}]
    });
  });
}

function assistantFocusSameParsed(left, right){
  if(!left || !right || !left.ok || !right.ok)return false;
  return JSON.stringify(left.value) === JSON.stringify(right.value) && left.op === right.op;
}

function assistantFocusDurationSlot(phrase){
  const text = String(phrase || '').toLowerCase();
  if(/\bgap\b|\bbetween sessions\b|\bapart\b/.test(text))return 'minGapMinutes';
  if(/\btimer\b/.test(text))return 'timerAutoStopMinutes';
  if(/\bauto(?:matic)?\b|\bmanual\b/.test(text))return 'autoMarkMinutes';
  if(/\bchunk\b|\bshortest\b|\bsplit\b/.test(text))return 'minChunkMinutes';
  return 'durationMinutes';
}

function assistantFocusPhraseParsed(fieldId, phrase, session){
  if(fieldId === 'appointmentRepeat' && /\b(?:once|weekly|every week)\b/i.test(phrase))return assistantFocusNormalize(fieldId, phrase, session);
  if(fieldId === 'timesPerPeriod' || fieldId === 'periodDays'){
    const rhythm = typeof assistantParseRhythm === 'function' ? assistantParseRhythm(phrase) : null;
    if(!rhythm)return null;
    const value = fieldId === 'timesPerPeriod' ? rhythm.timesPerPeriod : rhythm.periodDays;
    return value ? {ok:true, op:'set', value} : null;
  }
  if(fieldId === 'durationMinutes' || fieldId === 'minChunkMinutes' || fieldId === 'minGapMinutes' || fieldId === 'exceptionDuration' || fieldId === 'timerAutoStopMinutes' || fieldId === 'autoMarkMinutes'){
    if((String(phrase).match(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|ten|twenty|thirty|sixty)\s*(?:minute|minutes|min|hour|hours)\b/gi) || []).length > 1)return null;
    if(fieldId !== 'exceptionDuration' && fieldId !== assistantFocusDurationSlot(phrase))return null;
    const mins = typeof assistantParseDuration === 'function' ? assistantParseDuration(phrase) : null;
    if(mins == null)return null;
    return assistantFocusNormalize(fieldId, String(mins), session);
  }
  if(fieldId === 'allowedWeekdays' || fieldId === 'preferredWeekdays' || fieldId === 'appointmentWeekdays'){
    const days = typeof assistantParseWeekdaySchedule === 'function' ? assistantParseWeekdaySchedule(phrase) : null;
    if(!days || !days.length)return null;
    return {ok:true, op:'set', value:days};
  }
  if(fieldId === 'allowedWindow' || fieldId === 'preferredWindow'){
    const window = typeof assistantParseWindowFromText === 'function' ? assistantParseWindowFromText(phrase) : null;
    return window ? {ok:true, op:'set', value:window} : null;
  }
  return null;
}

function assistantFocusPreferField(fieldId, phrase){
  const prefer = /\bprefer/.test(String(phrase || '').toLowerCase());
  if(fieldId === 'allowedWeekdays' && prefer)return 'preferredWeekdays';
  if(fieldId === 'preferredWeekdays' && !prefer)return null;
  if(fieldId === 'allowedWindow' && prefer)return 'preferredWindow';
  if(fieldId === 'preferredWindow' && !prefer)return null;
  if(fieldId === 'allowedMonthDays' && prefer)return 'preferredMonthDays';
  if(fieldId === 'preferredMonthDays' && !prefer)return null;
  return fieldId;
}

function assistantFocusStageParsed(session, fieldId, parsed, phrase, confidence, repaired){
  if(!parsed || !parsed.ok)return false;
  const field = assistantFocusField(fieldId);
  if(!field)return false;
  if(fieldId === 'name'){
    if(!assistantFocusPhraseIn((session.currentRequest || session.originalRequest), parsed.value))return false;
    if(session.operation === 'edit' && session.source && assistantFocusNorm(session.source.name) === assistantFocusNorm(parsed.value))return false;
  }
  if(fieldId === 'weatherProfile' && session.dependencies.weatherProfile && (parsed.op === 'clear' || parsed.value.profileId !== session.dependencies.weatherProfile.id)){
    session.dependencies.weatherProfile = null;
    session.changes = session.changes.filter(change => change.field !== 'weatherRules');
  }
  const state = assistantFocusState(session, assistantFocusMaterialize(session));
  if(!assistantFocusFieldApplies(field, state))return false;
  assistantFocusStage(session, {
    op:parsed.op,
    field:fieldId,
    value:parsed.value,
    source:phrase,
    origin:'extracted',
    uncertain:repaired || (confidence != null && confidence < 0.7)
  });
  return true;
}

function assistantFocusReminderFieldGrounded(fieldId, phrase){
  const text = String(phrase).toLowerCase();
  if(fieldId === 'reminderTravelStart')return /\b(?:travel|depart(?:ure)?)\b/.test(text) && !/\b(?:arrival|arrive)\b/.test(text);
  if(fieldId === 'reminderTravelEnd')return /\b(?:arrival|arrive)\b/.test(text) || /\btravel\b/.test(text) && /\bend\b/.test(text);
  if(fieldId === 'reminderMissed' || fieldId === 'reminderMissedLead')return /\b(?:missed|drop|warning)\b/.test(text);
  if(fieldId === 'reminderTravelLead')return /\b(?:travel|depart(?:ure)?)\b/.test(text) && /\b(?:lead|before)\b/.test(text);
  if(fieldId === 'reminderStartLead')return /\b(?:lead|before)\b/.test(text) && !/\b(?:travel|depart(?:ure)?|missed|drop)\b/.test(text);
  if(fieldId === 'reminderReset')return /\b(?:usual|default|reset)\b/.test(text);
  if(fieldId === 'reminderEnd')return /\b(?:end|finish)\b/.test(text) && !/\btravel\b/.test(text);
  if(fieldId === 'reminderStart')return /\bstart\b/.test(text) && !/\b(?:travel|depart(?:ure)?)\b/.test(text);
  return true;
}

function assistantFocusApplyModelField(session, fieldId, rawValue, phrase, confidence, repaired){
  const target = assistantFocusPreferField(fieldId, phrase);
  if(target === 'appointmentUntil' && !/\b(?:until|end|through)\b/i.test(phrase))return false;
  if((target === 'emoji' || target === 'exceptionEmoji') && !/\b(?:emoji|icon|mark)\b|\p{Extended_Pictographic}/iu.test(phrase))return false;
  if(target === 'name' && session.operation === 'edit' && !/\b(?:rename|name|call|title)\b/i.test(phrase) && !session.unresolved.some(item => item.field === 'name'))return false;
  if(!target || target.startsWith('reminder') && !assistantFocusReminderFieldGrounded(target, phrase))return false;
  if(['durationMinutes','minChunkMinutes','minGapMinutes','timerAutoStopMinutes','autoMarkMinutes'].includes(target)
    && target !== assistantFocusDurationSlot(phrase)
    && (String(phrase).match(/\b(?:minute|minutes|min|hour|hours)\b/gi) || []).length < 2)return false;
  const text = rawValue == null ? '' : String(rawValue).trim();
  const fromPhrase = assistantFocusPhraseParsed(target, phrase, session);
  const fromModel = text ? assistantFocusNormalize(target, text, session) : null;
  const copiedPhrase = text && assistantFocusNorm(text) === assistantFocusNorm(phrase);
  const valueInPhrase = Boolean(text) && !copiedPhrase && assistantFocusPhraseIn(phrase, text);
  const contextualLength = target === 'locationPrefs' && /\b(?:prefer|avoid|high|little|low)\b/i.test(phrase) || ['minChunkMinutes','minGapMinutes','timerAutoStopMinutes','autoMarkMinutes'].includes(target) && assistantFocusDurationSlot(phrase) === target;
  const stray = (valueInPhrase || copiedPhrase) && !contextualLength && assistantFocusStrayValue(target, text);
  if(target === 'name' && !stray && fromModel && fromModel.ok && (valueInPhrase || copiedPhrase) && assistantFocusNorm(fromModel.value) !== assistantFocusNorm((session.currentRequest || session.originalRequest))){
    return assistantFocusStageParsed(session, target, fromModel, phrase, confidence, repaired);
  }
  if(!stray && valueInPhrase && fromModel && fromModel.ok && fromPhrase && fromPhrase.ok && !assistantFocusSameParsed(fromModel, fromPhrase)){
    assistantFocusUnresolve(session, {
      field:target,
      family:(assistantFocusField(target) || {}).family || '',
      question:`${(assistantFocusField(target) || {}).label || target} doesn’t match “${phrase}”.`
    });
    return false;
  }
  if(fromPhrase && (stray || !valueInPhrase || !fromModel || !fromModel.ok || assistantFocusSameParsed(fromModel, fromPhrase))){
    return assistantFocusStageParsed(session, target, fromPhrase, phrase, confidence, repaired);
  }
  if(!stray && fromModel && fromModel.ok && (valueInPhrase || copiedPhrase)){
    return assistantFocusStageParsed(session, target, fromModel, phrase, confidence, repaired);
  }
  return false;
}

function assistantFocusStrayValue(fieldId, text){
  if(fieldId === 'topics' && /https?:\/\/|www\.|[a-z][a-z0-9+.-]*:/i.test(text))return true;
  if(fieldId === 'locationPrefs' && !/\b(?:prefer|avoid|high|little|low|favorite|favourite)\b/i.test(text))return true;
  if(fieldId === 'links' && !/https?:\/\/|www\.|[a-z][a-z0-9+.-]*:|\b(?:call|whatsapp|facetime)\b|^\+?\d[\d\s().-]{3,}$/i.test(text))return true;
  const duration = typeof assistantParseDuration === 'function' && /\b(?:minute|minutes|min|hour|hours)\b/i.test(text) && assistantParseDuration(text) != null;
  const weekdays = typeof assistantParseWeekdaySchedule === 'function' && assistantParseWeekdaySchedule(text);
  const window = typeof assistantParseWindowFromText === 'function' && assistantParseWindowFromText(text);
  const rhythm = typeof assistantParseRhythm === 'function' && assistantParseRhythm(text);
  if(fieldId === 'name' && (duration || window || (rhythm && (rhythm.timesPerPeriod || rhythm.periodDays))))return true;
  if((fieldId === 'allowedMonthDays' || fieldId === 'preferredMonthDays') && (duration || weekdays || window || rhythm))return true;
  if(['breakable','trackValue','pinned','allowedTimeFixedStart','repeatMode','conditionTrigger'].includes(fieldId) && (duration || (weekdays && weekdays.length) || window || rhythm))return true;
  if(['minChunkMinutes','minGapMinutes','timerAutoStopMinutes','autoMarkMinutes'].includes(fieldId) && fieldId !== assistantFocusDurationSlot(text))return true;
  return false;
}

function assistantFocusCoverPhrase(session, family, phrase, confidence, repaired){
  const pairs = ASSISTANT_FOCUS_EXTRACT_FIELDS[family] || [];
  pairs.forEach(([fieldId]) => {
    if(session.changes.some(change => change.field === fieldId && change.source === phrase) || session.unresolved.some(item => item.field === fieldId))return;
    const parsed = assistantFocusPhraseParsed(assistantFocusPreferField(fieldId, phrase) || fieldId, phrase, session);
    const target = assistantFocusPreferField(fieldId, phrase);
    if(target && parsed)assistantFocusStageParsed(session, target, parsed, phrase, confidence, repaired);
  });
}

function assistantFocusPlaces(session, args, phrase, confidence, repaired){
  const raw = String(args.places || args.place || '').trim();
  if(!raw)return false;
  if(/^(anywhere|any place)$/i.test(raw)){
    return assistantFocusStageParsed(session, 'anywhereAllowed', {ok:true, op:'set', value:true}, phrase, confidence, repaired);
  }
  if(/^(no place|none|clear)$/i.test(raw)){
    return assistantFocusStageParsed(session, 'places', {ok:true, op:'clear', value:null}, phrase, confidence, repaired);
  }
  const names = raw.split(/[,;]|\band\b/i).map(name => name.trim()).filter(Boolean);
  const catalog = assistantFocusSettings().locations || [];
  const ids = [], questions = [];
  for(const name of names){
    if(!assistantFocusPhraseIn(phrase, name))return false;
    const found = assistantMatchByName(catalog, name);
    if(found.ok){ids.push(found.item.id);continue;}
    questions.push({field:'places', family:'places',
      question:found.error === 'AMBIGUOUS' ? `Which saved place is “${name}”?` : `I don’t have a saved place named “${name}”. Pick one that already exists.`,
      choices:(found.matches || catalog).slice(0, 4).map(item => ({id:item.id, label:item.name}))});
  }
  if(questions.length){
    session.placeResolution = {ids, questions};
    assistantFocusUnresolve(session, questions[0]);
    return true;
  }
  session.placeResolution = null;
  return ids.length ? assistantFocusStageParsed(session, 'places', {ok:true, op:'set', value:ids}, phrase, confidence, repaired) : false;
}

function assistantFocusWeather(session, args, phrase, confidence, repaired){
  const source = String(args.rules || args.rule || phrase || '');
  if(!assistantFocusPhraseIn((session.currentRequest || session.originalRequest), source) && !assistantFocusPhraseIn((session.currentRequest || session.originalRequest), phrase))return false;
  const parsed = typeof assistantParseWeatherRulesFromText === 'function' ? assistantParseWeatherRulesFromText(source) : null;
  if(!parsed || !parsed.rules || !parsed.rules.length)return false;
  assistantFocusStageWeatherRules(session, parsed.rules);
  assistantFocusStage(session, {
    op:'set', field:'weatherRules', value:parsed.rules,
    source:phrase, origin:'extracted', uncertain:repaired || (confidence != null && confidence < 0.7)
  });
  return true;
}

function assistantFocusTopics(session, args, phrase, confidence, repaired){
  const raw = String(args.topics || args.topic || '').trim();
  if(!raw || !assistantFocusPhraseIn(phrase, raw))return false;
  const parsed = assistantFocusNormalize('topics', raw, session);
  if(!parsed.ok)return false;
  const known = new Set((assistantFocusSettings().topics || []).map(topic => topic.toLowerCase()));
  session.dependencies.topics = (parsed.value || []).filter(topic => !known.has(topic.toLowerCase()));
  return assistantFocusStageParsed(session, 'topics', parsed, phrase, confidence, repaired);
}

function assistantFocusOrder(session, phrase, confidence, repaired){
  if(typeof assistantResolveOrderLink !== 'function' || typeof assistantParseOrderModifiers !== 'function')return false;
  const direction = /\bbefore\b/i.test(phrase) ? 'before' : (/\bafter\b/i.test(phrase) ? 'after' : '');
  if(/^(none|off|clear)$/i.test(phrase.trim()))return assistantFocusStageParsed(session, 'scheduleLinks', {ok:true, op:'clear', value:null}, phrase, confidence, repaired);
  if(!direction || typeof assistantParseOrderName !== 'function')return false;
  const name = assistantParseOrderName(phrase);
  if(!name || !assistantFocusPhraseIn((session.currentRequest || session.originalRequest), name))return false;
  const data = (typeof load === 'function' ? load() : []).filter(item => item && item.hid !== session.targetId);
  const link = assistantResolveOrderLink(name, data, assistantParseOrderModifiers(phrase), [], null);
  if(!link || link.ok === false){
    assistantFocusUnresolve(session, {field:'scheduleLinks', family:'order', question:link && link.ask || `Which item should this come ${direction}?`});
    return true;
  }
  const row = Object.assign({direction}, link.link || link);
  assistantFocusStage(session, {op:'set', field:'scheduleLinks', value:[row], source:phrase, origin:'extracted', uncertain:repaired || (confidence != null && confidence < 0.7)});
  return true;
}

function assistantFocusApplyFamily(session, family, call, repaired){
  const args = call.args || {};
  const phrase = String(args.phrase || args.evidence || args.source || '').trim();
  if(!assistantFocusPhraseIn((session.currentRequest || session.originalRequest), phrase))return {ok:false, reason:'phrase'};
  const confidence = call.confidence;
  let staged = false;
  if(family === 'event')assistantFocusEventScope(session, args, phrase);
  if(family === 'places')staged = assistantFocusPlaces(session, args, phrase, confidence, repaired) || staged;
  else if(family === 'weather')staged = assistantFocusWeather(session, args, phrase, confidence, repaired) || staged;
  else if(family === 'organization')staged = assistantFocusTopics(session, args, phrase, confidence, repaired) || staged;
  else if(family === 'order')staged = assistantFocusOrder(session, assistantFocusPhraseIn(phrase, args.order) ? args.order : phrase, confidence, repaired) || staged;
  (ASSISTANT_FOCUS_EXTRACT_FIELDS[family] || []).forEach(([fieldId, key]) => {
    if(fieldId === 'places' || fieldId === 'topics' || fieldId === 'scheduleLinks' || fieldId === 'weatherRules')return;
    if(fieldId === 'weatherProfile' && staged)return;
    if(args[key] == null || !String(args[key]).trim())return;
    if(assistantFocusApplyModelField(session, fieldId, args[key], phrase, confidence, repaired))staged = true;
  });
  assistantFocusCoverPhrase(session, family, phrase, confidence, repaired);
  const after = session.changes.some(change => change.family === family) || session.unresolved.some(item => item.family === family);
  return {ok:after || staged, phrase};
}

function assistantFocusToolFor(family, session){
  const properties = {};
  const hints = {
    name:'item title words only, copied from the user, or empty',
    times:'how many times, copied from the user, or empty',
    period:'period such as a week or every day, copied from the user, or empty',
    duration:'length such as 20 minutes, copied from the user, or empty'
  };
  (ASSISTANT_FOCUS_EXTRACT_FIELDS[family] || []).forEach(([, key]) => {
    properties[key] = {type:'string', description:hints[key] || `${key}, copied from the user, or empty`};
  });
  if(family === 'identity' && session.operation === 'create'){
    return assistantFocusPackTool(`add_${session.kind}`, `Create a new ${session.kind}. Extract its title.`, {name:{type:'string',description:'Title of the item, excluding dates, clocks, frequency, and settings.'}}, ['name']);
  }
  if(family === 'event')properties.scope = {type:'string', enum:['series','occurrence'], description:'all dates or this date, only if the user said so'};
  return assistantFocusPackTool(ASSISTANT_FOCUS_GROUP_TOOLS[family] || family, `Extract the ${family} record.`, properties, Object.keys(properties));
}

function assistantFocusEventScope(session, args, phrase){
  if(session.kind !== 'event')return;
  if(session.operation === 'create'){session.eventScope = 'series'; return;}
  if(!session.source || !session.source.appointment)return;
  if(session.source.appointment.repeat === 'once')return;
  const scope = args && (args.scope === 'series' || args.scope === 'occurrence') ? args.scope : '';
  const scopePhrase = args && (args.scopePhrase || phrase);
  if(scope && assistantFocusPhraseIn((session.currentRequest || session.originalRequest), scopePhrase)){
    session.eventScope = scope;
    session.scopeSource = 'request';
    if(scope === 'occurrence' && !session.occurrenceDate){
      assistantFocusUnresolve(session, {field:'eventScope', family:'event', question:'Which date should this change?'});
    }
    return;
  }
  if(session.eventScope)return;
  const choices = [{id:'series', label:'all dates'}];
  if(session.occurrenceDate)choices.unshift({id:'occurrence', label:`this date (${session.occurrenceDate})`});
  else choices.push({id:'occurrence', label:'one date'});
  assistantFocusUnresolve(session, {
    field:'eventScope',
    family:'event',
    question:'Should this change this date or all dates?',
    choices
  });
}

async function assistantFocusExtractOne(session, row, extract, opts){
  const spec = {
    family:row.family,
    system:opts.repair
      ? 'The last record did not match the user. Copy only words that appear in their text. Leave a field empty when they did not say it.'
      : assistantFocusSystem(session),
    request:session.currentRequest || session.originalRequest,
    tool:assistantFocusToolFor(row.family, session)
  };
  if(opts.onProgress)opts.onProgress({phase:'think', step:row.family, pending:session.pendingFamilies.slice()});
  const call = await assistantFocusModel(session, spec, extract);
  const spoken = String(call.args.phrase || '').trim();
  const spokenOk = assistantFocusPhraseIn((session.currentRequest || session.originalRequest), spoken) && assistantFocusFamilyHasSignal(row.family, spoken);
  call.args.phrase = spokenOk ? spoken : (session.currentRequest || session.originalRequest);
  const before = JSON.stringify([session.changes, session.unresolved]);
  const applied = assistantFocusApplyFamily(session, row.family, call, Boolean(opts.repair));
  if(row.family === 'event')assistantFocusEventScope(session, call.args, call.args.phrase || row.phrase);
  if(row.family === 'places' && session.eventScope === 'occurrence' && session.changes.some(change => change.field === 'places')){
    assistantFocusUnresolve(session, {
      field:'places',
      family:'places',
      question:'One date can change the time, duration, emoji, or color. A place change applies to the whole series, or skip it.',
      choices:[{id:'series-place', label:'change the series place'}, {id:'skip-place', label:'skip the place'}]
    });
  }
  const progressed = before !== JSON.stringify([session.changes, session.unresolved]);
  if(!applied.ok && !session.repairs[row.family]){
    session.repairs[row.family] = 1;
    session.timing.repair += 1;
    await assistantFocusExtractOne(session, row, extract, Object.assign({}, opts, {repair:true}));
  }
  const covered = (ASSISTANT_FOCUS_EXTRACT_FIELDS[row.family] || []).some(([fieldId]) => {
    const target = assistantFocusPreferField(fieldId, row.phrase);
    const expected = target && assistantFocusPhraseParsed(target, row.phrase, session);
    const staged = session.changes.find(change => change.field === target);
    return expected && expected.ok && staged && JSON.stringify(expected.value) === JSON.stringify(staged.value);
  });
  if(!applied.ok && opts.repair || opts.missing && !progressed && !covered){
    assistantFocusUnresolve(session, {field:`missing:${row.family}`, family:row.family,
      question:`I still need a value for “${row.phrase}”. Please restate that setting.`});
  }else if(progressed){
    session.unresolved = session.unresolved.filter(item => item.field !== `missing:${row.family}`);
  }
  session._focusDone = session._focusDone || [];
  if(!session._focusDone.includes(row.family))session._focusDone.push(row.family);
}

const ASSISTANT_FOCUS_GROUP_HINTS = {
  identity:'name, emoji, color, priority, or habit/task type',
  recurrence:'how often, frequency, routine, opportunity, or proximity trigger',
  dates:'due date, deadline, early or late allowance',
  schedule:'allowed or preferred weekdays, month days, and hours',
  effort:'duration, splitting, shortest session, gap, timer, or tracking',
  places:'saved places, anywhere, and place preferences',
  weather:'weather profile, weather rules, temperature, rain, or forecast',
  alternatives:'alternative schedules or separate sessions',
  order:'before or after another item',
  organization:'topics, pinning, snooze, links, or shared display',
  event:'event start date, repeat, weekdays, end date, or start time',
  exception:'one event date cancellation, time, duration, emoji, or reset',
  reminders:'notification, alarm, reminder mode or lead time'
};

const ASSISTANT_FOCUS_GROUP_TOOLS = {
  identity:'rename_item', recurrence:'change_frequency', dates:'change_due_date',
  schedule:'change_availability', effort:'change_duration', places:'change_location',
  weather:'change_weather', alternatives:'change_schedule_options', order:'change_order',
  organization:'change_topics', event:'change_event', exception:'change_event_occurrence', reminders:'change_reminders'
};

function assistantFocusGroupTools(session){
  return [...assistantFocusApplicable(session)].map(family => assistantFocusPackTool(
    ASSISTANT_FOCUS_GROUP_TOOLS[family], `Change ${ASSISTANT_FOCUS_GROUP_HINTS[family]}.`,
    {phrase:{type:'string', description:'exact supporting words from the user'}}, ['phrase']
  )).concat([assistantFocusPackTool('outside', 'A question, logging, deletion, planner action, or another item.',
    {phrase:{type:'string', description:'exact words asking the other action'}}, ['phrase'])]);
}

function assistantFocusGroupsFromCall(session, call){
  const found = assistantFocusCollectFamilies(session, assistantFocusReadEvidence(call.args));
  const tools = Object.fromEntries(Object.entries(ASSISTANT_FOCUS_GROUP_TOOLS).map(([family,name]) => [name,family]));
  const calls = [...(call.raw && call.raw.function_calls || []), ...(call.raw && call.raw.suppressed_calls || [])];
  calls.forEach(row => {
    const family = tools[row.name];
    if(!family && row.name !== 'outside')return;
    const args = typeof row.arguments === 'string' ? (()=>{try{return JSON.parse(row.arguments);}catch(_){return {};}})() : row.arguments || {};
    const request = session.currentRequest || session.originalRequest;
    const phrase = assistantFocusPhraseIn(request, args.phrase) ? args.phrase : request;
    // This is routing only. A paraphrased routing phrase never supplies a
    // setting: a separate extraction must still ground each executable value.
    if(family === 'alternatives' && !/\b(?:alternative|alternatives|option|options|separate)\b/i.test(request))return;
    if(family && assistantFocusApplicable(session).has(family))found.families.push({family, phrase});
    else if(row.name === 'outside')found.outside.push({kind:'question',phrase});
  });
  return found;
}

async function assistantFocusDetect(session, extract, opts){
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const spec = {
    family:'families',
    system:assistantFocusSystem(session),
    request:assistantFocusRequestLine('families', session.currentRequest || session.originalRequest),
    tool:assistantFocusPackTool('families', 'Extract the families record.', {evidence:{type:'string', description:'family: exact words; family: exact words'}, outside:{type:'string', description:'other action: exact words, or empty'}}, ['evidence'])
  };
  let call = await assistantFocusModel(session, spec, extract);
  let found = assistantFocusGroupsFromCall(session, call);
  const outside = assistantFocusSplitEvidence(call.args.outside || '');
  outside.forEach(row => {
    if(assistantFocusPhraseIn((session.currentRequest || session.originalRequest), row.phrase)){
      const kind = ASSISTANT_FOCUS_OUTSIDE_ALIAS[row.label.replace(/\s+/g, '')] || 'question';
      found.outside.push({kind, phrase:row.phrase});
    }
  });
  if(!found.families.length && !found.outside.length && !session.repairs.families){
    session.repairs.families = 1;
    call = await assistantFocusModel(session, {family:'families-route', system:assistantFocusSystem(session),
      request:session.currentRequest || session.originalRequest, tools:assistantFocusGroupTools(session)}, extract);
    const selected = assistantFocusGroupsFromCall(session, call);
    selected.families.forEach(row => {
      if(row.family === 'alternatives')found.families = found.families.filter(item => item.family !== 'schedule');
      found.families.push(row);
    });
    found.outside.push(...selected.outside);
  }
  assistantFocusBlockOutside(session, found.outside);
  if(session.operation === 'create' && !found.families.some(row => row.family === 'identity')){
    const evidence = String(assistantFocusReadEvidence(call.args) || '').trim();
    const phrase = assistantFocusPhraseIn((session.currentRequest || session.originalRequest), evidence)
      ? evidence
      : ((found.families[0] && found.families[0].phrase) || (session.currentRequest || session.originalRequest));
    if(phrase && assistantFocusPhraseIn((session.currentRequest || session.originalRequest), phrase)){
      found.families.unshift({family:'identity', phrase});
    }
  }
  if(!found.families.length && !found.outside.length)assistantFocusUnresolve(session, {field:'request', family:'request', question:'Which setting should change? Please name it and its value.'});
  else session.unresolved = session.unresolved.filter(item => item.field !== 'request');
  session._focusSelected = found.families.map(row => ({family:row.family}));
  const existing = Array.isArray(session._focusQueue) ? session._focusQueue : [];
  const queued = found.families.filter((row, index, rows) => !existing.concat(rows.slice(0,index)).some(item => item.family === row.family));
  session._focusQueue = queued.concat(existing);
  session.pendingFamilies = session._focusQueue.map(row => row.family);
  session.timing.families += Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
  if(opts.onProgress)opts.onProgress({phase:'think', step:'families', pending:session.pendingFamilies.slice()});
}

async function assistantFocusExtractPending(session, extract, opts){
  const queue = Array.isArray(session._focusQueue) ? session._focusQueue : [];
  const batch = queue.splice(0, 3);
  session.pendingFamilies = queue.map(row => row.family);
  for(const row of batch){
    assistantFocusEnsure(session);
    await assistantFocusExtractOne(session, row, extract, opts);
    session.pendingFamilies = queue.map(item => item.family);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function assistantFocusCompleteness(session, extract, opts){
  if(session.pendingFamilies.length || session._focusChecked)return;
  session._focusChecked = true;
  const staged = session.changes.map(change => change.field).join(', ').slice(0, 180);
  const call = await assistantFocusModel(session, {
    family:'completeness',
    system:`Already staged: ${staged || 'nothing'}. Name a missing setting group only when its exact words are in the user text. Leave missing empty when the request is complete.`,
    request:assistantFocusRequestLine('missing', session.currentRequest || session.originalRequest),
    tool:assistantFocusPackTool('missing', 'Extract the missing record.', {missing:{type:'string', description:'family: exact words, or empty'}}, ['missing'])
  }, extract);
  const found = assistantFocusGroupsFromCall(session, call);
  assistantFocusBlockOutside(session, found.outside);
  // A missing sibling field can belong to a group already extracted. Every
  // returned omission must either stage a value or remain explicitly blocked.
  if((session._focusSelected || []).some(row => row.family === 'alternatives')){
    found.families.forEach(row => {if(row.family === 'schedule')row.family = 'alternatives';});
  }
  const extra = found.families.filter((row, index, rows) => !rows.slice(0,index).some(item => item.family === row.family && item.phrase === row.phrase));
  for(const row of extra){
    await assistantFocusExtractOne(session, row, extract, Object.assign({}, opts, {missing:true}));
  }
}

function assistantFocusFinishScope(session){
  if(session.kind !== 'event')return;
  if(session.eventScope)return;
  if(session.source && session.source.appointment && session.source.appointment.repeat === 'once'){
    session.eventScope = 'series';
    session.scopeSource = 'once';
    return;
  }
  if(session.unresolved.some(item => item.field === 'eventScope'))return;
  assistantFocusEventScope(session, {}, '');
}

async function assistantFocusTurn(session, text, opts){
  opts = opts || {};
  if(!session)throw new Error('Open one item before asking Needle.');
  const extract = opts.extract || assistantFocusLiveExtract;
  if(!opts.resume){
    const spoken = String(text || '').trim();
    if(!spoken)return {type:'focus', empty:true};
    session.requests.push(spoken);
    session.originalRequest = session.requests.join('\n');
    session.currentRequest = spoken;
    session.requestText = session.originalRequest;
    session.repairs = {};
    session._focusDone = [];
    session._focusChecked = false;
    await assistantFocusDetect(session, extract, opts);
  }
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try{
    await assistantFocusExtractPending(session, extract, opts);
    if(!session.pendingFamilies.length)await assistantFocusCompleteness(session, extract, opts);
    assistantFocusFinishScope(session);
    if(!session.changes.length && !session.unresolved.length)assistantFocusUnresolve(session, {field:'request', family:'request', question:'I couldn’t read that setting safely. Please name the setting and its value.'});
    if(session.operation === 'create' && !session.changes.some(change => change.field === 'name' && change.op === 'set' && change.value)){
      if(!session.unresolved.some(item => item.field === 'name')){
        assistantFocusUnresolve(session, {field:'name', family:'identity', question:'What should the item be called?'});
      }
    }
  }catch(error){
    if(error && error.name === 'AbortError')return {type:'focus', cancelled:true, session};
    throw error;
  }
  session.timing.total += Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
  return {
    type:'focus',
    session,
    html:typeof assistantFocusReviewHtml === 'function' ? assistantFocusReviewHtml(session) : ''
  };
}
