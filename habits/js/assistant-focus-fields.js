// One baseline + field proposals for both Add and Edit. Retrieval nominates jobs;
// only grounded model output can supply a value. All inference uses the same
// three leased runtimes, including embeddings and coverage checks.
const ASSISTANT_FIELD_SEARCH = {
  name:'detail-habit-message', kind:'detail-type-seg', habitKind:'detail-mode-seg', emoji:'detail-emoji', emojiBgColor:'detail-emoji-bg', priority:'detail-priority-seg',
  frequency:'detail-frequency-presets', repeatMode:'detail-frequency-presets', conditionTrigger:'detail-frequency-presets', conditionRadiusM:'detail-frequency-presets',
  dueDate:'detail-due-date', dueTime:'detail-due-time', hardDue:'detail-due-date', planByDate:'detail-due-date', earlyWindowDays:'detail-early-window', delayAllowanceDays:'detail-delay-allowance',
  allowedWeekdays:'detail-weekday-chips', preferredWeekdays:'detail-preferred-weekday-chips', allowedMonthDays:'detail-monthday-toggle', preferredMonthDays:'detail-preferred-monthday-toggle',
  allowedWindow:'detail-allowed-time-row', preferredWindow:'detail-preferred-time-row', allowedTimeFixedStart:'detail-time-kind',
  durationMinutes:'detail-duration', breakable:'detail-breakable', minChunkMinutes:'detail-min-chunk', minGapMinutes:'detail-min-gap', timerAutoStopMinutes:'detail-timer-auto-stop', autoMarkMinutes:'detail-auto-mark', trackValue:'detail-track-value',
  places:'detail-places-label', anywhereAllowed:'detail-places-label', locationPrefs:'detail-place-chips', weatherProfile:'detail-weather-profile', weatherRules:'detail-weather-profile', showWeather:'detail-show-weather', showWeatherAtLocation:'detail-show-weather-location', weatherLocationId:'detail-weather-location',
  scheduleOptions:'detail-habit-option-add', scheduleLinks:'detail-schedule-link-add', topics:'detail-topic-chips', pinned:'detail-pinned', snoozedUntil:'detail-snooze', sharedDisplay:'detail-shared-display', links:'detail-link-add'
};
// Signals select original-text windows, never executable values. Broader shared
// aliases and embeddings supply additional candidates beyond these strong cues.
const ASSISTANT_FIELD_SIGNALS = {
  name:/\b(?:rename|named?|called?|title)\b/i,
  kind:/\b(?:convert|turn|change|make)\b.{0,24}\b(?:habit|task)\b/i,
  habitKind:/\b(?:build|limit|reduce|stop)\b/i,
  emoji:/\p{Extended_Pictographic}|\b(?:emoji|icon)\b/iu,
  emojiBgColor:/\b(?:colou?r|red|blue|green|purple|orange|yellow|pink)\b|\b(?:set|change|use) (?:the |a )?background\b/i,
  priority:/\b(?:priority|p[0-5]|urgent|critical|someday)\b/i,
  frequency:/\b(?:every|each (?:day|week)|daily|weekly|once|twice|thrice|\w+ times? (?:a|per|in)|\d+ times?)\b/i,
  repeatMode:/\b(?:opportunity|routine|when (?:it fits|conditions)|regular rhythm)\b/i,
  conditionTrigger:/\b(?:trigger|nearby|proximity)\b/i,
  conditionRadiusM:/\b(?:radius|\d+\s*(?:meters?|metres?))\b/i,
  dueDate:/\b(?:due|deadline|(?:plan|do|finish)(?: (?:this|it))? by|plan (?:this |it )?for|tomorrow|today|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  dueTime:/\b(?:at|start(?:ing)?(?: at)?|by)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midnight)\b/i,
  hardDue:/\b(?:hard|strict|firm|must finish|no delay)\b/i,
  planByDate:/\b(?:do|finish|plan)(?: (?:this|it))? by\b/i,
  earlyWindowDays:/\b(?:early (?:window|allowance)|\w+ days? (?:early|earlier|in advance)|(?:early|earlier|in advance)(?: by)? \w+ days?)\b/i,
  delayAllowanceDays:/\b(?:late|delay|postpone)\b/i,
  allowedWeekdays:/\b(?:weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|any day)\b/i,
  preferredWeekdays:/\bprefer\w*\b.{0,35}\b(?:weekdays?|weekends?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  allowedMonthDays:/\b(?:month days?|days? of (?:the )?month|\d+(?:st|nd|rd|th))\b/i,
  preferredMonthDays:/\bprefer\w*\b.{0,35}\b(?:month|\d+(?:st|nd|rd|th))\b/i,
  allowedWindow:/\b(?:(?:before|after|between|from)\s+(?:\d[\d:]*(?:\s*[ap]m)?|sunrise|sunset|noon|midnight|fajr|dhuhr|zuhr|asr|maghrib|isha)|morning|evening|overnight|any time|clear (?:the )?(?:hours|window))\b/i,
  preferredWindow:/\bprefer\w*\b.{0,40}\b(?:hours?|morning|evening|before|after|between|from)\b/i,
  allowedTimeFixedStart:/\b(?:fixed|exact)(?: start| time)?\b/i,
  durationMinutes:/\b(?:(?:for\s+)?(?:\d+(?:\.\d+)?|half an?|one(?: and a half)?|two|three|four|five|ten|fifteen|twenty|thirty|forty five|sixty)\s*(?:minutes?|mins?|hours?)|duration|long|twice as long)\b/i,
  breakable:/\b(?:split(?:ting)?|breakable|unbreakable|continuous|uninterrupted|chunks?)\b/i,
  minChunkMinutes:/\b(?:minimum chunk|shortest session|chunks? (?:of|at least)|\d+[- ]minute chunks?)\b/i,
  minGapMinutes:/\b(?:(?:\d+|one|two|five|ten|fifteen|twenty|thirty)\s*[- ]?minutes?\s+gap|gap|apart|between sessions|spacing)\b/i,
  timerAutoStopMinutes:/\b(?:timer|auto stop|stop timer)\b/i,
  autoMarkMinutes:/\b(?:auto.?mark|automatic completion|automatically (?:complete|mark)|manual completion)\b/i,
  trackValue:/\b(?:track|log)\b.{0,20}\b(?:value|weight|note|measurement)\b/i,
  places:/\b(?:at (?:home|work)|place|location|venue)\b/i,
  anywhereAllowed:/\b(?:anywhere|any place)\b/i,
  locationPrefs:/\b(?:prefer|avoid|favou?rite)\b.{0,30}\b(?:place|location|home|work)\b/i,
  weatherProfile:/\b(?:weather profile|use .{0,20} weather)\b/i,
  weatherRules:/\b(?:temperature|rain|wind|gust|humidity|uv|feels like|dry weather)\b/i,
  showWeather:/\b(?:show|hide|display)\b.{0,18}\b(?:weather|forecast)\b/i,
  showWeatherAtLocation:/\b(?:weather|forecast)\b.{0,20}\b(?:item.?s place|this place)\b/i,
  weatherLocationId:/\b(?:forecast|weather) (?:at|in|for)\b/i,
  scheduleOptions:/\b(?:alternatives?|options?|either)\b|\bor\b.{0,40}\b(?:at|before|after|from)\b/i,
  scheduleLinks:/\b(?:right|directly|immediately) (?:before|after)\b|\b(?:order|adjacen|partner|same day)\w*\b/i,
  topics:/\b(?:topics?|tags?|categor\w*)\b/i,
  pinned:/\b(?:pin|pinned|unpin|unpinned)\b/i,
  snoozedUntil:/\b(?:snooze|unsnooze|unhide|hide until)\b/i,
  sharedDisplay:/\b(?:shared display|view only)\b/i,
  links:/https?:\/\/|www\.|\b(?:link|url|shortcut|whatsapp|facetime)\b/i,
  appointmentRepeat:/\b(?:repeat|weekly|once|every week)\b/i,
  appointmentStartDate:/\b(?:date|today|tomorrow|\d{4}-\d{2}-\d{2})\b/i,
  appointmentWeekdays:/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays?)\b/i,
  appointmentUntil:/\b(?:until|through|end date)\b/i,
  appointmentStartMinute:/\b(?:at|start)\s+(?:\d|noon|midnight)/i,
  exceptionTime:/\b(?:at|time|start)\b/i, exceptionDuration:/\b(?:minutes?|hours?|duration|long)\b/i,
  exceptionEmoji:/\p{Extended_Pictographic}|\bemoji\b/iu, exceptionColor:/\bcolou?r\b/i,
  exceptionCancelled:/\b(?:cancel|skip|restore|uncancel)\b/i, exceptionReset:/\b(?:reset|usual values)\b/i,
  reminderStart:/\b(?:start reminder|remind.{0,12}start)\b/i, reminderEnd:/\b(?:end reminder|remind.{0,12}(?:end|finish))\b/i,
  reminderTravelStart:/\b(?:depart|travel start)\w*\b/i, reminderTravelEnd:/\b(?:arriv|travel end)\w*\b/i,
  reminderMissed:/\b(?:drop warning|missed|cutoff)\b/i, reminderTravelLead:/\b(?:depart|travel)\w*.{0,35}\b(?:before|lead)\b|\b(?:remind|alarm|notif)\w*.{0,35}\bbefore (?:depart|travel)\w*\b/i,
  reminderStartLead:/\b(?:remind|alarm|notif)\w*.{0,35}\bbefore\b/i, reminderMissedLead:/\b(?:drop|missed).{0,25}\b(?:before|lead)\b/i,
  reminderReset:/\b(?:usual|default|reset) reminders?\b/i
};
const ASSISTANT_FIELD_HINTS = {
  name:'Item title only. Exclude create verbs, dates, frequency and other settings.',
  frequency:'Complete repetition phrase, including count and period. Exclude session length.',
  durationMinutes:'Length of one session. Exclude frequency, chunk length, gap and timer.',
  allowedWindow:'Required allowed hours, preserving before/after, anchors and offsets. Exclude preferences.',
  preferredWindow:'Preferred hours, not a required restriction.',
  allowedWeekdays:'Allowed weekdays.',
  preferredWeekdays:'Preferred weekdays only, not a required restriction.',
  pinned:'Words asking to pin or unpin the item.',
  topics:'Requested topic names only.',
  kind:'Explicit conversion to habit or task; leave empty otherwise.',
  breakable:'Words requesting split sessions or uninterrupted sessions.',
  scheduleOptions:'All alternatives together; preserve which place goes with which time.',
  scheduleLinks:'Before or after another named item, preserving adjacency and same-day qualifiers.',
  dueDate:'Task due date, including requests saying plan by. Preserve the complete date phrase; exclude clock time.'
};

function assistantFieldCatalog(){
  const defs = ASSISTANT_FOCUS_FIELDS.filter(f=>!['timesPerPeriod','periodDays'].includes(f.id)).map(f=>({...f, fields:[f.id]}));
  defs.splice(6,0,{id:'frequency',label:'Frequency',family:'recurrence',kinds:['habit'],fields:['timesPerPeriod','periodDays']});
  return defs.map(f=>{
    const search = ITEM_DETAIL_SEARCH_FIELDS.find(row=>row[0] === ASSISTANT_FIELD_SEARCH[f.id]);
    const pair = (ASSISTANT_FOCUS_EXTRACT_FIELDS[f.family] || []).find(row=>row[0]===f.id);
    return {...f,key:f.id==='frequency'?'frequency':pair?.[1] || f.id,
      signal:ASSISTANT_FIELD_SIGNALS[f.id], aliases:search ? `${search[1]} ${search[2]}` : f.label,
      hint:ASSISTANT_FIELD_HINTS[f.id] || `The requested ${f.label.toLowerCase()} setting only.`};
  });
}

function assistantFieldApplicable(def, session){
  // Prerequisites are checked when proposals merge, allowing the extraction to
  // run before a kind/mode/splitting change has been validated.
  const kind = assistantFocusEffectiveKind(session);
  if(def.family==='exception' && !['exceptionCancelled','exceptionReset'].includes(def.id))return false;
  if(def.family==='exception' && (session.operation==='create'||session.eventScope==='series'))return false;
  return def.kinds.includes(kind) || session._fieldKindChanging && def.kinds.some(k=>k==='habit'||k==='task');
}

function assistantFieldContexts(request){
  if(request.length<=1000)return [request];
  const contexts=[];let start=0;
  while(start<request.length){
    let end=Math.min(request.length,start+1000);
    if(end<request.length){const space=request.lastIndexOf(' ',end);if(space>start+500)end=space;}
    contexts.push(request.slice(start,end));
    if(end===request.length)break;
    const overlap=Math.max(start+1,end-150),space=request.indexOf(' ',overlap);
    start=space>=overlap&&space<end?space+1:overlap;
  }
  return contexts;
}

function assistantFieldSpans(request){
  const spans=[];
  const add=(start,end)=>{while(start<end && /\s/.test(request[start]))start++;while(end>start && /\s/.test(request[end-1]))end--;
    if(end<=start)return;
    if(end-start>600){
      const words=Array.from(request.slice(start,end).matchAll(/\S+/g));
      for(let i=0;i<words.length;i+=22){
        const last=words[Math.min(words.length-1,i+29)];
        spans.push({start:start+words[i].index,end:start+last.index+last[0].length,text:request.slice(start+words[i].index,start+last.index+last[0].length)});
        if(i+30>=words.length)break;
      }
    }else if(!spans.some(s=>s.start===start&&s.end===end))spans.push({start,end,text:request.slice(start,end)});};
  let start=0;
  // Keep URLs, decimals and clocks intact. Every piece retains source offsets.
  for(const match of request.matchAll(/[,;\n]+|[.!?](?=\s|$)|\s+and\s+(?=(?:tag|use|pin|set|show|hide|add|make|prefer)\b)/gi)){
    // A comma before an explicit year belongs to its date, not a new setting.
    if(match[0]===',' && /\b[a-z]+\s+\d{1,2}(?:st|nd|rd|th)?$/i.test(request.slice(start,match.index)) && /^\s*\d{4}\b/.test(request.slice(match.index+1)))continue;
    add(start,match.index);start=match.index+match[0].length;
  }
  add(start,request.length);
  return spans.length ? spans : [{start:0,end:request.length,text:request}];
}

// Shared instruction ownership. Apply these policies to candidate retrieval,
// source boundaries, model evidence and coverage alike. They never supply values.
const ASSISTANT_FIELD_OWNERSHIP = [
  {fields:['allowedWeekdays','allowedWindow','allowedMonthDays'], when:/\bprefer/i},
  {fields:['allowedWindow'], when:/\b(?:rename|named?|called?)\b.*\b(?:morning|evening)\b/i, unless:/\b(?:before|after|between|from|only|in the)\b/i},
  {fields:['allowedWindow'], when:/\b(?:before|after)\s+\d+(?:\.\d+)?\s*(?:minutes?|hours?|days?)\b/i},
  {fields:['habitKind'], when:/\bstop (?:the )?timer\b/i},
  {fields:['dueDate'], when:/\b(?:hard|strict|firm) deadline\b/i, unless:/\d|today|tomorrow|next\b/i},
  {fields:['appointmentRepeat'], require:/\b(?:weekly|once|every week|one.?off)\b/i},
  {fields:['appointmentStartDate'], when:/\b(?:until|through|end date)\b/i, unless:/\bstart(?:s|ing)?\b/i},
  {fields:['places'], when:/\b(?:trigger|prefer|avoid|weather|forecast)\b/i},
  {fields:['showWeather','weatherLocationId'], when:/\b(?:this place|item.?s place)\b/i},
  {fields:['durationMinutes','allowedWindow'], when:/\b(?:remind|alarm|notif|missed|warning)\w*[^,;]*\b(?:lead|\w+\s*(?:minutes?|mins?|hours?)\s+before)\b/i},
  {fields:['reminderStart','reminderEnd','reminderTravelStart','reminderTravelEnd','reminderMissed'], require:/\b(?:off|notification|alarm)\b/i},
  {fields:['reminderStart','reminderEnd'], when:/\b(?:travel|depart|arrival)\w*/i},
  {fields:['reminderStartLead'], when:/\b(?:travel|depart|missed|drop)\w*/i},
  {fields:['breakable'], when:/\b(?:minimum chunk|shortest session)\b/i, unless:/\bsplit/i},
  {fields:['allowedWeekdays','allowedWindow','places'], when:/\b(?:options?|alternatives?)\b/i}
];
const ASSISTANT_FIELD_READERS = {
  name:{retainPrefix:true}, conditionRadiusM:{retainPrefix:true},
  earlyWindowDays:{retainPrefix:true}, delayAllowanceDays:{retainPrefix:true},
  timerAutoStopMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes','autoMarkMinutes']},
  autoMarkMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  scheduleLinks:{retainPrefix:true},
  reminderTravelLead:{retainPrefix:true}, reminderStartLead:{retainPrefix:true}, reminderMissedLead:{retainPrefix:true},
  minChunkMinutes:{shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  minGapMinutes:{shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  breakable:{shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  appointmentRepeat:{shares:['frequency']}
};

function assistantFieldRelevant(def, text){
  return ASSISTANT_FIELD_OWNERSHIP.every(rule=>!rule.fields.includes(def.id)
    || (rule.require ? rule.require.test(text) : !rule.when.test(text) || Boolean(rule.unless?.test(text))));
}

function assistantFieldSource(def, request, spans){
  const meaningful=span=>{
    if(!assistantFieldRelevant(def,span.text))return false;
    if(def.id==='places' && /^trigger (?:is )?location$/i.test(span.text))return false;
    if(def.id==='durationMinutes'){
      const length=def.signal.exec(span.text);
      for(const id of ['minGapMinutes','minChunkMinutes','timerAutoStopMinutes','autoMarkMinutes']){
        const setting=ASSISTANT_FIELD_SIGNALS[id].exec(span.text);
        if(setting && (!length || setting.index<=length.index))return false;
      }
    }
    return true;
  };
  spans=spans.filter(meaningful);
  if(!spans.length)return [];
  const score=span=>{
    const text=span.text;
    let n=def.signal?.test(text)?20:0;
    const words=new Set(assistantFocusNorm(def.aliases).split(' ').filter(w=>w.length>3));
    for(const word of words)if(new RegExp(`\\b${word}\\b`,'i').test(text))n++;
    if(def.id==='name' && span===spans[0])n+=5;
    return n;
  };
  const ranked=spans.map(span=>({span,score:score(span)})).sort((a,b)=>b.score-a.score || a.span.start-b.span.start);
  const threshold=ranked.some(row=>row.score>=20)?20:1;
  const selected=ranked.filter(row=>row.score>=threshold).map(row=>row.span).sort((a,b)=>a.start-b.start);
  const source=selected.length ? selected : [spans[0]];
  return source.map(span=>{
    const own=def.signal?.exec(span.text);
    if(!own && def.id!=='name')return span;
    // Keep quantities preceding their labels and qualifiers such as immediately.
    const reader=ASSISTANT_FIELD_READERS[def.id]||{};
    const whole=reader.retainPrefix;
    let start=whole?0:own.index, end=span.text.length;
    const named=def.id==='name' && /\b(?:called|named)\s+|\brename(?: it)?(?: to)?\s+/i.exec(span.text);
    if(named)start=named.index+named[0].length;
    if(/\b(?:no|not|never|don.t|without|prefer|avoid|keep|unchanged)\b/i.test(span.text.slice(0,start)))start=0;
    // Retrieval boundaries, not values: keep the untouched source between
    // setting cues. Coupled lengths (chunks/gaps/timers) keep their units.
    for(const [id,signal] of Object.entries(ASSISTANT_FIELD_SIGNALS)){
      if(!assistantFieldRelevant({id,signal},span.text))continue;
      if(id==='dueDate' && def.id==='name'){const date=signal.exec(span.text);if(date&&date.index>start)end=Math.min(end,date.index);continue;}
      if(!['name','frequency','durationMinutes','dueTime','appointmentStartMinute','allowedWeekdays','allowedWindow','topics','priority','pinned','emoji','links','minGapMinutes','minChunkMinutes','timerAutoStopMinutes','autoMarkMinutes'].includes(id))continue;
      if(id===def.id || ['kind','habitKind','emojiBgColor','dueDate','allowedTimeFixedStart','preferredWeekdays','preferredWindow','preferredMonthDays'].includes(id))continue;
      if(reader.shares?.includes(id))continue;
      if(def.id.startsWith('reminder') && ['durationMinutes','dueTime','appointmentStartMinute','allowedWindow'].includes(id))continue;
      const other=signal.exec(span.text);
      if(other && other.index>=(own?own.index+own[0].length:start) && other.index>start)end=Math.min(end,other.index);
    }
    while(start<end && /\s/.test(span.text[start]))start++;
    while(end>start && /\s/.test(span.text[end-1]))end--;
    const text=span.text.slice(start,end);
    return text?{start:span.start+start,end:span.start+end,text,context:span.text}:span;
  });
}

function assistantFieldEnqueue(state, id, reason, source){
  const def=state.catalog.find(d=>d.id===id);
  if(!def || !assistantFieldApplicable(def,state.session))return;
  const prior=state.jobs.find(j=>j.id===id&&j.request!==state.request&&j.status==='queued');
  if(prior && !['explicit','coverage'].includes(reason))return prior;
  const existing=state.jobs.find(j=>j.id===id && j.revision===state.revision && j.request===state.request);
  if(existing){if(['explicit','coverage','reference'].includes(reason))existing.required=true;return existing;}
  const spans=source || (id==='scheduleOptions'?[{start:0,end:state.request.length,text:state.request}]:assistantFieldSource(def,state.request,state.spans));
  if(!spans.length)return;
  const row={id,family:def.family,def,request:state.request,spans,revision:state.revision,status:'queued',attempts:0,
    required:['explicit','coverage','reference'].includes(reason),reason,baseline:{durationMinutes:assistantFocusMaterialize(state.session).durationMinutes}};
  const baseline=assistantFocusMaterialize(state.session);
  row.contextValues=def.fields.map(id=>`${assistantFocusField(id)?.label||id}: ${assistantFocusFormatValue(id,baseline,state.session)}`).join('; ');
  // Replace only work for this setting; unrelated interrupted fields keep their
  // frozen text. Completed draft values remain until a valid replacement lands.
  state.jobs.filter(j=>j.id===id&&j.status==='queued').forEach(j=>{j.status='superseded';});
  state.jobs.push(row);return row;
}

async function assistantFieldScope(state,extract){
  const session=state.session;
  const tool=assistantFocusPackTool('scope','Extract the scope record.',{scope:{type:'string',description:'Exact words choosing this date or all dates, or empty',enum:[state.request,'']}},['scope']);
  const call=await assistantFocusModel(session,{family:'event-scope',revision:state.revision,request:assistantFocusRequestLine('scope',state.request),tool},extract);
  if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
  const evidence=String(call.args.scope||'');
  if(evidence!==state.request)return;
  const scope=/\b(?:all dates|whole series|entire series|every occurrence)\b/i.test(evidence)?'series':/\b(?:this date|this occurrence|just (?:this|on)|only on)\b/i.test(evidence)?'occurrence':null;
  if(scope)assistantFocusEventScope(session,{scope,scopePhrase:evidence},evidence);
}

function assistantFieldCandidates(state){
  const text=state.request;
  state.catalog.filter(d=>assistantFieldApplicable(d,state.session)).forEach(def=>{
    if(def.signal?.test(text) && assistantFieldSource(def,text,state.spans).some(s=>def.signal.test(s.context||s.text)))assistantFieldEnqueue(state,def.id,'explicit');
  });
  for(const id of ['name','frequency','durationMinutes'])assistantFieldEnqueue(state,id,'core');
  if(state.session.kind==='task')for(const id of ['dueDate','dueTime'])assistantFieldEnqueue(state,id,'core');
  if(state.session.kind==='event' && state.session.operation==='edit' && !state.session.eventScope)state.jobs.push({id:'$scope',family:'scope',status:'queued',attempts:0,revision:state.revision});
  if(state.session.kind==='event')for(const id of ['appointmentStartDate','appointmentStartMinute','appointmentRepeat'])assistantFieldEnqueue(state,id,'core');
  // A named saved place or order partner is also retrieval evidence. It never
  // selects a value, and the extractor still has to quote the instruction.
  for(const place of assistantFocusSettings().locations || []){
    const def=state.catalog.find(d=>d.id==='places');
    if(assistantFocusPhraseIn(text,place.name)&&state.spans.some(span=>assistantFocusPhraseIn(span.text,place.name)&&assistantFieldRelevant(def,span.text)))assistantFieldEnqueue(state,'places','explicit');
  }
  if(/\b(?:before|after)\b/i.test(text) && load().some(item=>item.hid!==state.session.targetId&&assistantFocusPhraseIn(text,item.name)))assistantFieldEnqueue(state,'scheduleLinks','explicit');
}

async function assistantFieldDiscover(state, extract){
  const session=state.session;
  for(const context of assistantFieldContexts(state.request)){
    const call=await assistantFocusModel(session,{family:'families',revision:state.revision,
      system:'Find requested setting groups. Copy exact words; do not summarize.',
      request:assistantFocusRequestLine('families',context),
      tool:assistantFocusPackTool('families','Extract the families record.',{evidence:{type:'string',description:'family: exact words; family: exact words'},outside:{type:'string',description:'other action: exact words, or empty'}},['evidence'])},extract);
    assistantFocusEnsure(session,state.revision);
    if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
    const found=assistantFocusGroupsFromCall(session,call);
    assistantFocusBlockOutside(session,found.outside);
    assistantFocusSplitEvidence(call.args.outside).forEach(row=>{
      if(assistantFocusPhraseIn(state.request,row.phrase))assistantFocusBlockOutside(session,[{kind:ASSISTANT_FOCUS_OUTSIDE_ALIAS[row.label]||'question',phrase:row.phrase}]);
    });
    for(const row of found.families){
      const candidates=state.catalog.filter(d=>d.family===row.family && assistantFieldApplicable(d,session));
      const hits=candidates.filter(d=>d.signal?.test(row.phrase));
      for(const def of hits.length ? hits : candidates)assistantFieldEnqueue(state,def.id,'discovery');
    }
  }
}

async function assistantFieldRetrieve(state, rank){
  const defs=state.catalog.filter(d=>assistantFieldApplicable(d,state.session));
  const queries=[...assistantFieldContexts(state.request),...state.spans.map(s=>s.text)];
  for(let offset=0;offset<queries.length;offset+=13){
    const raw=await rank({queries:queries.slice(offset,offset+13),fields:defs.map(d=>({id:d.id,text:`${d.label}. ${d.hint} ${d.aliases}`}))});
    assistantFocusEnsure(state.session,state.revision);
    state.session.trace.push({family:'retrieval',ranking:raw.rankings,workerLane:raw._workerLane});
    for(const list of raw.rankings || [])for(const row of list.slice(0,3)){
      if(Number.isFinite(row.score))assistantFieldEnqueue(state,row.id,'embedding');
    }
  }
}

function assistantFieldTool(def, span, history=[]){
  return assistantFocusPackTool(def.key,`Extract the ${def.key} record.`,{
    [def.key]:{type:'string',description:`${def.hint} Exact source evidence, or empty.`,enum:[...new Set([span.text,...history.map(source=>source.text),''])]}
  },[def.key]);
}

function assistantFieldReference(text){
  return /\b(?:earlier|previous(?:ly)?|original|first|last|same|that|again|mentioned|said|told)\b/i.test(text);
}

function assistantFieldHistory(state,row){
  const sources=[];
  // Keep original messages and offsets, not model paraphrases or summaries.
  // Only excerpts relevant to this field enter its fresh worker context.
  const currentIndex=state.session.requests.lastIndexOf(row.request);
  for(let index=0;index<currentIndex;index++){
    const request=state.session.requests[index];
    for(const span of assistantFieldSource(row.def,request,assistantFieldSpans(request))){
      if(row.def.signal?.test(span.context||span.text))sources.push({...span,request,requestIndex:index});
    }
  }
  for(const evidence of state.session.fieldEvidence||[]){
    if(evidence.id!==row.id||evidence.span.requestIndex>=currentIndex)continue;
    if(!sources.some(span=>span.requestIndex===evidence.span.requestIndex&&span.start===evidence.span.start&&span.end===evidence.span.end))sources.push({...evidence.span});
  }
  sources.sort((a,b)=>a.requestIndex-b.requestIndex||a.start-b.start);
  const reference=assistantFieldReference(row.request)&&row.required;
  const modified=/\b(?:not|never|don.t|without|except|or|next|more|less|longer|shorter|double|twice|half|increase|decrease)\b/i.test(row.request);
  const candidates=sources.filter(span=>assistantFieldNormalize(row.def,span.text,state.session).ok);
  let choices=reference&&!modified?candidates:[];
  if(/\b(?:first|original)\b/i.test(row.request))choices=choices.slice(0,1);
  else if(/\b(?:last|most recent)\b/i.test(row.request))choices=choices.slice(-1);
  const values=new Set(choices.map(span=>JSON.stringify(assistantFieldNormalize(row.def,span.text,state.session).changes)));
  const ambiguous=values.size>1||choices.length>8||choices.reduce((n,span)=>n+span.text.length,0)>1800;
  if(ambiguous)choices=[];
  // Old wording is context, never an instruction to rerun another setting.
  // Excerpts are bounded; explicit references that exceed the budget ask which.
  const contextSources=[];let size=0;
  for(const span of sources.slice().reverse()){
    if(contextSources.length===8||size+span.text.length>1800)break;
    contextSources.unshift(span);size+=span.text.length;
  }
  const context=contextSources.map(span=>`Earlier user message ${span.requestIndex+1}: ${span.text}`).join('\n');
  return {choices,ambiguous,context:state.session.requests.length>1?`Current draft ${row.contextValues}.\n${context}\nCurrent instruction has precedence. Earlier wording may supply a value only when the current instruction refers back to it.`:''};
}

const ASSISTANT_FIELD_QUANTITIES = {
  conditionRadiusM:{min:1,max:100000},earlyWindowDays:{min:0,max:60},delayAllowanceDays:{min:0,max:60},
  reminderTravelLead:{min:0,max:60},reminderStartLead:{min:0,max:60},reminderMissedLead:{min:0,max:60}
};

function assistantFieldQuantity(def, text){
  const limits=ASSISTANT_FIELD_QUANTITIES[def.id];
  const matches=text.match(new RegExp(`\\b(?:zero|${assistantDurationNumberSource()})\\b`,'gi'))||[];
  const value=matches.length===1 ? (matches[0].toLowerCase()==='zero'?0:assistantParseNumberPhrase(matches[0])) : null;
  if(/\b(?:not|never|don.t|without|or)\b|(?:^|\s)-\s*\d/i.test(text) || !Number.isInteger(value) || value<limits.min || value>limits.max)return {ok:false,error:`Specify one value for ${def.label.toLowerCase()}, from ${limits.min} to ${limits.max}.`};
  return {ok:true,value:String(value)};
}

function assistantFieldNormalize(def,text,session){
  if(['allowedWindow','preferredWindow','allowedWeekdays','preferredWeekdays','allowedMonthDays','preferredMonthDays','frequency','dueDate','dueTime','places','weatherProfile'].includes(def.id)
    && /\b(?:no|not|never|don.t|except|without|or)\b/i.test(text))return {ok:false,error:'Please clarify the positive restriction or clear this setting.'};
  if(def.id==='frequency'){
    const rhythm=assistantParseRhythm(text);
    if(!rhythm?.timesPerPeriod || !rhythm.periodDays)return {ok:false,error:'How often should it repeat?'};
    // On Edit, weekdays alone restrict availability; they must not silently
    // replace an existing frequency.
    if(session.operation==='edit' && !ASSISTANT_FIELD_SIGNALS.frequency.test(text))return {ok:false,error:'Specify a repetition count and period.'};
    return {ok:true,changes:[{field:'timesPerPeriod',op:'set',value:rhythm.timesPerPeriod},{field:'periodDays',op:'set',value:rhythm.periodDays}]};
  }
  let value=text;
  if(def.id==='scheduleOptions' && /\bor\b/i.test(text))return {ok:false,error:'Please give each alternative separately with its time and place.'};
  if(def.id==='name')value=text.replace(/^(?:(?:create|add)(?: a| an)? (?:habit|task|event)(?: (?:called|named))?|(?:rename|name)(?: it| this)?(?: to| as)?|call (?:it|this)(?: to| as)?)\s+/i,'').replace(/^['"]|['"]$/g,'').trim();
  if(def.id==='name')value=value.replace(/^(?:remind me to|remember to|i (?:need|want) to)\s+/i,'');
  if(def.id==='name' && /\b(?:\d+\s*(?:minutes?|hours?)|every (?:day|week|other)|daily|weekly)\b/i.test(value))return {ok:false,error:'Please give just the item title.'};
  if(def.id==='name' && (!value || /^(?:create|add|habit|task|event|rename|name|it)$/i.test(value)))return {ok:false,error:'Name the item.'};
  if(def.id==='conditionRadiusM')value=text.replace(/^(?:(?:set|change)\s+)?(?:radius(?: of)?|within)(?:\s+to)?\s+/i,'');
  if(['dueDate','planByDate','appointmentStartDate','appointmentUntil'].includes(def.id)){
    value=text.replace(/^(?:(?:change|set|move)\s+(?:the\s+)?)?(?:(?:plan|do|finish)(?: (?:this|it))? by|plan (?:this |it )?for|due(?: date)?(?: on)?|on|by|until|through|start(?:s|ing)?(?: on)?|date)(?:\s+(?:to|on))?\s*/i,'').trim();
    if(/\bweek\b/i.test(value)&&!/^next week$/i.test(value))return {ok:false,error:'Which exact date should I use? Please give a date such as 2027-01-07.'};
  }
  if(['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id))value=text.replace(/^(?:at|start(?:s|ing)?(?: at)?|time)\s+/i,'');
  if(['emojiBgColor','exceptionColor'].includes(def.id))value=text.replace(/^(?:(?:use|set|change)\s+)?(?:(?:a|an|the)\s+)?(?:(?:emoji\s+)?(?:background(?:\s+colou?r)?|colou?r)\s*(?:to|as|:)?)?\s*/i,'').replace(/\s+(?:colou?r|background)$/i,'').trim();
  if(def.id==='topics')value=text.replace(/^(?:(?:add|use|set|with)\s+)?(?:topics?|tags?|categor(?:y|ies))(?:\s+(?:it|as|to))?\s*:?\s*/i,'').replace(/\s+(?:topic|tag)$/i,'').replace(/^(?:it|as|to)\s+/i,'').trim();
  if(def.id==='topics' && (!value || /\p{Extended_Pictographic}|\b(?:minutes?|hours?|priority|emoji|tag it)\b/iu.test(value)))return {ok:false,error:'Name the requested topics.'};
  const booleans=['pinned','breakable','trackValue','hardDue','anywhereAllowed','showWeather','showWeatherAtLocation','allowedTimeFixedStart'];
  if(booleans.includes(def.id) && assistantParseBool(value)==null){
    const negative=/\b(?:no|not|never|don.t|disable|off|unpin|unpinned|unbreakable|uninterrupted|continuous|hide)\b/i.test(value);
    const positive=def.signal?.test(value);
    if(positive)value=negative?'false':'true';
  }
  // Convert only the model's quoted relative expression, using the baseline
  // duration supplied to this job; a relative edit never changes that baseline.
  if(def.id==='durationMinutes' && /^(?:twice as long|double (?:it|the duration))$/i.test(value))value=String((session._fieldBaseline||assistantFocusMaterialize(session)).durationMinutes*2);
  if(['places','weatherLocationId'].includes(def.id))value=value.replace(/^(?:(?:use|add|set|at|in|place|location|venue)(?: (?:the|to))?\s+)+/i,'').replace(/\s+(?:as )?(?:the )?(?:place|location)$/i,'').trim();
  if(def.id==='weatherProfile')value=value.replace(/^(?:use|weather profile|profile)\s+/i,'').replace(/\s+(?:weather|profile)$/i,'').trim();
  if(ASSISTANT_FIELD_QUANTITIES[def.id]){
    const quantity=assistantFieldQuantity(def,text);if(!quantity.ok)return quantity;
    value=quantity.value;
  }
  if(!String(value).trim())return {ok:false,error:`What value should I use for ${def.label.toLowerCase()}?`};
  if(['minChunkMinutes','minGapMinutes','durationMinutes','timerAutoStopMinutes'].includes(def.id)){
    const normalized=assistantNormalizeDurationText(value),hits=assistantDurationHitsFromNormalized(normalized);
    const joined=hits.length===2 && hits[0].unit==='h' && hits[1].unit==='m'
      && /^[\s,]*(?:and[\s,]*)?$/.test(normalized.slice(hits[0].end,hits[1].index));
    if(hits.length>1&&!joined)return {ok:false,error:'There is more than one length in that instruction.'};
  }
  const parsed=assistantFocusNormalize(def.id,value,session);
  return parsed.ok ? {ok:true,changes:[{field:def.id,...parsed}]} : parsed;
}

async function assistantFieldExtract(state,row,extract){
  const def=row.def,session=state.session;
  const normalizeContext={...session,_fieldBaseline:row.baseline};
  if(row.spans.length>12)return {status:row.required?'needs_input':'not_mentioned',error:`There are many instructions for ${def.label.toLowerCase()}. Please clarify this setting.`};
  const values=[],invalid=[];
  const history=assistantFieldHistory(state,row);
  let preserved=false;
  for(const span of row.spans){
    const evidence=span.context||span.text;
    if(!assistantFieldRelevant(def,evidence))continue;
    const referenceOnly=history.choices.length&&!assistantFieldNormalize(def,span.text,normalizeContext).ok;
    const modelSpan=referenceOnly?history.choices[0]:span;
    const modelSources=referenceOnly?history.choices.slice(1):[];
    const call=await assistantFocusModel(session,{family:def.family,jobId:row.id,revision:state.revision,
      system:referenceOnly?`Copy exact words from the selected earlier user evidence. Current instruction: ${span.context||span.text}. Do not extract the reference wording itself.`:`Copy the user exact words into the record. Leave empty if absent. ${history.context}`,
      context:history.context,
      request:assistantFocusRequestLine(def.key,referenceOnly?history.choices.map(source=>source.text).join('; '):span.text),tool:assistantFieldTool(def,modelSpan,modelSources)},extract);
    if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
    const calls=[...(call.raw.function_calls||[]),...(call.raw.suppressed_calls||[])];
    for(const result of calls){
      if(result.name && result.name!==def.key)continue;
      const args=typeof result.arguments==='string'?JSON.parse(result.arguments):result.arguments||{};
      const text=String(args[def.key]||'').trim();
      if(!text)continue;
      // Enforce the evidence enum again on the host. A shortened reply can
      // drop a negation, preference or endpoint even when its words are grounded.
      const selected=text===span.text?{...span,request:row.request}:history.choices.find(source=>source.text===text);
      if(!selected || selected.request.slice(selected.start,selected.end)!==selected.text)continue;
      if(/\b(?:keep (?:the )?(?:current|existing|same)|preserve|unchanged|don.t change|do not change|leave.+(?:alone|same|as is))\b/i.test(text)){preserved=true;continue;}
      // A concrete new value cannot be replaced by a historical one. History
      // helps resolve an actual reference, not override the latest correction.
      if(selected.request!==row.request && assistantFieldNormalize(def,span.text,normalizeContext).ok)continue;
      const selectedEvidence=selected.context||selected.text;
      if(selected.request===row.request && !['name','frequency','durationMinutes','dueDate','dueTime','appointmentStartDate','appointmentStartMinute','places','weatherProfile'].includes(def.id) && !def.signal?.test(selectedEvidence) && !session.unresolved.some(issue=>issue.field===def.id))continue;
      if(def.id==='kind' && !ASSISTANT_FIELD_SIGNALS.kind.test(selectedEvidence))continue;
      if(def.id==='name' && session.operation==='edit' && !ASSISTANT_FIELD_SIGNALS.name.test(selectedEvidence) && !session.unresolved.some(r=>r.field==='name'))continue;
      if(def.id==='allowedWeekdays' && /\bprefer/i.test(selectedEvidence))continue;
      if(def.id==='allowedWindow' && /\bprefer/i.test(selectedEvidence))continue;
      if(def.id==='preferredWeekdays' || def.id==='preferredWindow' || def.id==='preferredMonthDays'){
        if(!/\bprefer/i.test(selectedEvidence))continue;
      }
      if(def.id==='durationMinutes' && /\b(?:gaps?|chunks?|timer|auto.?mark|between sessions)\b/i.test(span.text))continue;
      const parsed=assistantFieldNormalize(def,text,normalizeContext);
      if(!parsed.ok)invalid.push(parsed);
      if(parsed.ok)values.push({changes:parsed.changes,source:text,span:selected,instructionSpan:span,uncertain:call.confidence==null||call.confidence<0.7||Boolean(call.raw.suppressed_calls?.includes(result))});
    }
  }
  const unique=values.filter((v,i)=>!values.slice(0,i).some(other=>JSON.stringify(v.changes)===JSON.stringify(other.changes)));
  if(unique.length>1)return {status:'needs_input',error:`I found conflicting values for ${def.label.toLowerCase()}. Which should I use?`};
  if(unique.length)return {status:'extracted',...unique[0]};
  if(history.ambiguous)return {status:'needs_input',error:`Which earlier value for ${def.label.toLowerCase()} should I use? Please repeat it or specify the first or last value.`};
  const choices=invalid.find(result=>result.choices?.length);
  if(choices)return {status:'needs_input',error:choices.error,choices:choices.choices};
  return {status:row.required&&!preserved?'needs_input':'not_mentioned',preserved,error:`Please specify ${def.label.toLowerCase()}; I couldn’t extract it reliably.`};
}

function assistantFieldDependencies(row,state){
  const order=['kind','habitKind','repeatMode'];
  const own=order.indexOf(row.id);
  const controls=own>=0?order.slice(0,own):order.slice();
  if(row.id==='minChunkMinutes')controls.push('breakable');
  if(row.id==='weatherRules')controls.push('weatherProfile');
  if(row.id==='scheduleOptions')controls.push('places','weatherRules','weatherProfile');
  return state.jobs.filter(job=>job!==row&&controls.includes(job.id)&&!['superseded','not_mentioned','staged'].includes(job.status) && !state.session.changes.some(c=>job.def?.fields.includes(c.field)&&c.origin==='correction'));
}

function assistantFieldMerge(state,row,result){
  assistantFocusEnsure(state.session,state.revision);
  const session=state.session;
  if(result.status!=='extracted'){
    row.status=result.status;row.preserved=Boolean(result.preserved);
    if(row.preserved)session.unresolved=session.unresolved.filter(issue=>!row.def.fields.includes(issue.field)&&issue.field!==row.id);
    if(result.status==='needs_input')assistantFocusUnresolve(session,{field:row.id==='frequency'?'timesPerPeriod':row.id,family:row.family,question:result.error,choices:result.choices||[]});
    return;
  }
  const dependencies=assistantFieldDependencies(row,state);
  if(dependencies.length){row.status='waiting';row.result=result;return;}
  const context={...session,currentRequest:result.span.request||row.request};
  const applicable=result.changes.every(change=>assistantFocusFieldApplies(change.field,assistantFocusState(session,assistantFocusMaterialize(session))));
  if(!applicable && !row.required){row.status='not_mentioned';return;}
  if(!applicable){row.status='needs_input';assistantFocusUnresolve(session,{field:row.id,family:row.family,question:`${row.def.label} doesn’t apply to this item’s current settings.`});return;}
  for(const change of result.changes){
    if(change.field==='weatherRules')assistantFocusStageWeatherRules(session,change.value);
    if(change.field==='topics'){
      const known=new Set((assistantFocusSettings().topics||[]).map(t=>t.toLowerCase()));
      session.dependencies.topics=(change.value||[]).filter(t=>!known.has(t.toLowerCase()));
    }
    if(!assistantFocusStageParsed(context,change.field,{...change,ok:true},result.source,result.uncertain?0:1,false))continue;
    session.changes=context.changes;session.unresolved=context.unresolved;
    session.interpretationApproved=null;session.savedFingerprint='';
  }
  row.status='staged';row.fields=result.changes.map(c=>c.field);row.source=result.source;row.proposal=result;
  const span={...result.span,requestIndex:result.span.requestIndex??session.requests.lastIndexOf(row.request)};
  session.fieldEvidence ||= [];
  if(!session.fieldEvidence.some(e=>e.id===row.id&&e.span.requestIndex===span.requestIndex&&e.span.start===span.start&&e.span.end===span.end))session.fieldEvidence.push({id:row.id,span});
  session.unresolved=session.unresolved.filter(r=>!row.def.fields.includes(r.field)&&r.field!==row.id);
  row.result=null;
}

async function assistantFieldCoverage(state,extract){
  const session=state.session;
  const staged=state.jobs.filter(j=>j.status==='staged').map(j=>`${j.def?.label||j.family}: ${j.proposal?.instructionSpan?.text||j.source||''}`).join('; ');
  for(const context of assistantFieldContexts(state.request)){
    const call=await assistantFocusModel(session,{family:'completeness',revision:state.revision,
      system:`Already extracted: ${staged.slice(0,1400)||'nothing'}. Find a missing setting and its exact words. Leave missing empty if complete.`,
      request:assistantFocusRequestLine('missing',context),tool:assistantFocusPackTool('missing','Extract the missing record.',{missing:{type:'string',description:'family: exact missing instruction, or empty'}},['missing'])},extract);
    assistantFocusEnsure(session,state.revision);
    if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
    const found=assistantFocusGroupsFromCall(session,call);assistantFocusBlockOutside(session,found.outside);
    for(const row of found.families){
      const defs=state.catalog.filter(d=>d.family===row.family&&assistantFieldApplicable(d,session));
      const hits=defs.filter(d=>d.signal?.test(row.phrase)&&assistantFieldRelevant(d,row.phrase));
      const targets=hits.length?hits:defs;
      // Discovery of a group is not proof that each sibling was requested.
      // Keep a coverage obligation for the original phrase, instead of making
      // every field in an uncertain group a required extraction.
      (state.coverageRequests ||= []).push(row);
      for(const def of targets){
        const existing=state.jobs.find(j=>j.id===def.id&&j.request===state.request);
        if(!existing)assistantFieldEnqueue(state,def.id,hits.length?'coverage':'discovery');
      }
    }
  }
}

function assistantFieldReportProgress(state, opts, phase, step){
  const open = ['queued','running','waiting','retryable_failed'];
  state.session.pendingFamilies = state.jobs.filter(job => open.includes(job.status)).map(job => job.def?.label || job.family);
  if(opts.onProgress)opts.onProgress({phase, step:step || state.session.pendingFamilies[0] || '', pending:state.session.pendingFamilies.slice()});
}

async function assistantFieldSchedule(state,extract,opts){
  const active=new Set();
  const launch=job=>{
    job.status='running';
    assistantFieldReportProgress(state, opts, 'think', job.def?.label || job.family);
    const task=(async()=>{
      try{
        for(let attempt=0;attempt<2;attempt++){
          job.attempts++;
          try{
            if(job.id==='$discover'){await assistantFieldDiscover(state,extract);job.status='staged';}
            else if(job.id==='$scope'){await assistantFieldScope(state,extract);job.status='staged';}
            else if(job.id==='$retrieve'){await assistantFieldRetrieve(state,opts.rank || (payload=>assistantNeedleFocusRequest(payload,'rankFields')));job.status='staged';}
            else if(job.id==='$coverage'){await assistantFieldCoverage(state,extract);job.status='staged';}
            else {const result=await assistantFieldExtract(state,job,extract);assistantFieldMerge(state,job,result);}
            break;
          }catch(error){
            assistantFocusEnsure(state.session,state.revision);
            job.error=String(error.message||error);
            state.session.trace.push({family:job.family,jobId:job.id,error:job.error,attempt:job.attempts});
            if(!attempt && /stopped unexpectedly|took too long|runtime failed|memory|allocation|out of bounds/i.test(job.error))continue;
            job.status='retryable_failed';break;
          }
        }
      }finally{
        active.delete(task);
      }
      assistantFocusEnsure(state.session,state.revision);
      for(const waiting of state.jobs.filter(j=>j.status==='waiting')){
        if(!assistantFieldDependencies(waiting,state).length)assistantFieldMerge(state,waiting,waiting.result);
      }
      const activeJob = state.jobs.find(row => row.status === 'running');
      assistantFieldReportProgress(state, opts, 'staged', activeJob && (activeJob.def?.label || activeJob.family) || job.def?.label || job.family);
    })();
    active.add(task);return task;
  };
  while(true){
    assistantFocusEnsure(state.session,state.revision);
    while(active.size<3){
      const next=state.jobs.find(j=>j.status==='queued');if(!next)break;launch(next);
    }
    if(!active.size)break;
    await Promise.race(active);
  }
}

async function assistantFocusRunFieldTurn(session,text,opts){
  opts=opts||{};
  const extract=opts.extract||assistantFocusLiveExtract;
  let state=session._fieldState;
  if(!opts.resume){
    const request=String(text||'').trim();if(!request)return {type:'focus',empty:true};
    const priorFields=(state?.jobs||[]).filter(j=>j.proposal&&j.request===state.request).map(j=>j.id);
    const unfinished=(state?.jobs||[]).filter(j=>!j.id.startsWith('$')&&['queued','running','waiting','retryable_failed'].includes(j.status)).map(j=>({...j,status:'queued',result:null}));
    (state?.jobs||[]).filter(j=>j.status==='running').forEach(j=>{j.status='superseded';});
    session.requests.push(request);session.currentRequest=request;session.originalRequest=session.requests.join('\n');session.requestText=session.originalRequest;
    session.unresolved=session.unresolved.filter(row=>row.field!=='request');
    session.requestRevision=(session.requestRevision||0)+1;
    session._fieldKindChanging=ASSISTANT_FIELD_SIGNALS.kind.test(request);
    state={request,revision:session.requestRevision,catalog:assistantFieldCatalog(),spans:assistantFieldSpans(request),jobs:unfinished};
    Object.defineProperty(state,'session',{value:session});
    unfinished.forEach(j=>{j.revision=state.revision;});
    session._fieldState=state;session.jobs=state.jobs;session.trace=session.trace||[];
    assistantFieldCandidates(state);
    if(assistantFieldReference(request)&&priorFields.length===1)assistantFieldEnqueue(state,priorFields[0],'reference');
    // A reply to a field question still needs model evidence, but need not
    // repeat the setting name (for example a bare date after “which date?”).
    const question=session.unresolved[0];
    const questionField=question&&state.catalog.find(def=>def.id===question.field||def.fields.includes(question.field));
    if(questionField)assistantFieldEnqueue(state,questionField.id,'explicit');
    state.jobs.unshift({id:'$discover',family:'families',status:'queued',attempts:0,revision:state.revision});
    // Embeddings use a lease from the same pool. Test callers may supply a
    // deterministic rank adapter; production always uses the pinned runtime.
    state.jobs.splice(2,0,{id:'$retrieve',family:'retrieval',status:'queued',attempts:0,revision:state.revision});
    state.coverage=false;
  }else if(state){
    state.jobs.filter(j=>j.status==='retryable_failed').forEach(j=>{j.status='queued';});
  }
  if(!state)return {type:'focus',empty:true};
  const started=performance.now();
  session.continuationError='';
  try{
    await assistantFieldSchedule(state,extract,opts);
    if(!state.coverage && !state.jobs.some(j=>j.status==='retryable_failed')){
      state.jobs.push({id:'$coverage',family:'completeness',status:'queued',attempts:0,revision:state.revision});state.coverage=true;
      await assistantFieldSchedule(state,extract,opts);
    }
    assistantFocusEnsure(session,state.revision);
    for(const row of state.coverageRequests||[]){
      const covered=state.jobs.some(job=>job.status==='staged'&&job.request===state.request
        &&[job.source,job.proposal?.instructionSpan?.text].some(source=>source&&(assistantFocusPhraseIn(row.phrase,source)||assistantFocusPhraseIn(source,row.phrase))));
      if(!covered&&!session.unresolved.some(issue=>issue.family===row.family))assistantFocusUnresolve(session,{field:`coverage:${row.family}`,family:'request',question:`I still need to account for “${row.phrase}”. Please clarify that setting.`});
    }
    if(state.jobs.some(j=>j.status==='retryable_failed'))session.continuationError='Your draft is kept. Continue to retry the unfinished settings.';
    const change=id=>session.changes.find(c=>c.field===id);
    const proposed=id=>state.jobs.some(j=>j.id===id&&j.request===state.request&&j.proposal);
    if(proposed('weatherRules') && proposed('weatherProfile'))assistantFocusUnresolve(session,{field:'weatherRules',family:'weather',question:'Use the saved weather profile or custom weather rules? Please choose one.',choices:[{id:'use-profile',label:'saved profile'},{id:'use-rules',label:'custom rules'}]});
    if(proposed('hardDue') && proposed('delayAllowanceDays') && change('hardDue')?.value===true && change('delayAllowanceDays')?.value>0)assistantFocusUnresolve(session,{field:'hardDue',family:'dates',question:'Should this be a hard deadline or allow a delay?',choices:[{id:'hard-deadline',label:'hard deadline'},{id:'allow-delay',label:'allow delay'}]});
    assistantFocusFinishScope(session);
    for(const issue of assistantFocusCreateIssues(session)){
      if(!session.unresolved.some(row=>row.field===issue.field))assistantFocusUnresolve(session,issue);
    }
    const handled=state.jobs.some(job=>job.request===state.request&&(job.status==='staged'&&job.proposal||job.preserved));
    if(!handled&&!session.unresolved.length)assistantFocusUnresolve(session,{field:'request',family:'request',question:'Which setting should change?'});
  }catch(error){
    if(error.name==='AbortError'||session.requestRevision!==state.revision)return {type:'focus',cancelled:true,session};
    session.continuationError='Your draft is kept. Continue to retry the unfinished settings.';
    session.trace.push({family:'scheduler',error:String(error.message||error)});
  }
  session.timing.total+=Math.round(performance.now()-started);
  return {type:'focus',session,html:assistantFocusReviewHtml(session)};
}
