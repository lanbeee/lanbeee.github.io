// One baseline + field proposals for both Add and Edit. Retrieval nominates jobs;
// only grounded model output can supply a value. All inference uses the same
// three leased runtimes, including embeddings and coverage checks.
const ASSISTANT_FIELD_SEARCH = {
  name:'detail-habit-message', kind:'detail-type-seg', habitKind:'detail-mode-seg', emoji:'detail-emoji', emojiBgColor:'detail-emoji-bg', priority:'detail-priority-seg',
  frequency:'detail-frequency-presets', repeatMode:'detail-frequency-presets', conditionTrigger:'detail-condition-trigger', conditionRadiusM:'detail-condition-radius',
  dueDate:'detail-due-date', dueTime:'detail-due-time', hardDue:'detail-due-date', planByDate:'detail-due-date', earlyWindowDays:'detail-early-window', delayAllowanceDays:'detail-delay-allowance',
  allowedWeekdays:'detail-weekday-chips', preferredWeekdays:'detail-preferred-weekday-chips', allowedMonthDays:'detail-monthday-toggle', preferredMonthDays:'detail-preferred-monthday-toggle',
  allowedOrdinalWeekdays:'detail-ordinal-rules', preferredOrdinalWeekdays:'detail-preferred-ordinal-rules',
  allowedWindow:'detail-allowed-time-row', preferredWindow:'detail-preferred-time-row', allowedTimeFixedStart:'detail-time-kind',
  tapStartsSession:'detail-tap-session', durationMinutes:'detail-duration', breakable:'detail-breakable', minChunkMinutes:'detail-min-chunk', minGapMinutes:'detail-min-gap', timerAutoStopMinutes:'detail-timer-auto-stop', autoMarkMinutes:'detail-auto-mark', trackValue:'detail-track-value',
  places:'detail-places-label', anywhereAllowed:'detail-places-label', locationPrefs:'detail-place-chips', weatherProfile:'detail-weather-profile', weatherRules:'detail-weather-profile', showWeather:'detail-show-weather', showWeatherAtLocation:'detail-show-weather-location', weatherLocationId:'detail-weather-location',
  scheduleOptions:'detail-habit-option-add', scheduleLinks:'detail-schedule-link-add', topics:'detail-topic-chips', pinned:'detail-pinned', snoozedUntil:'detail-snooze', sharedDisplay:'detail-shared-display', links:'detail-link-add'
};
// Signals select original-text windows, never executable values. Broader shared
// aliases and embeddings supply additional candidates beyond these strong cues.
const ASSISTANT_FIELD_TEXT_INSTRUCTIONS = {
  name:{signal:/\b(?:rename|named?|called|title|call (?:it|this|that))\b/i,
    prefix:/^(?:(?:name|title)\s+(?:should be|is)|(?:rename|name)(?:\s+(?:it|this|that))?(?:\s+(?:to|as))?|call\s+(?:it|this|that)(?:\s+(?:to|as))?|called|named|title)\s*:?\s*/i},
  topics:{signal:/\b(?:topics?|tags?|categor\w*|(?:put|file|group)\s+(?:it\s+|this\s+|that\s+)?(?:under|into|in))\b/i,
    prefix:/^(?:(?:(?:add|use|set|with)\s+)?(?:topics?|tags?|categor(?:y|ies))(?:\s+(?:it|this|that|as|to))?|(?:put|file|group|categorize|categorise)(?:\s+(?:it|this|that))?\s+(?:under|into|in))\s*:?\s*/i}
};
// Literal names and references must retain words such as "Please" or "Instead".
// Structured values may shed conversational framing, never semantic modifiers.
const ASSISTANT_FIELD_LITERAL_VALUES = new Set(['name','topics','places','locationPrefs','weatherProfile','weatherLocationId','links','scheduleLinks','scheduleOptions']);
// Explicit setting assignments own their values, even when the value has the
// wrong unit. Retrieval must not reinterpret "duration: three times a week"
// as permission to change frequency. This is field validation, not item routing.
const ASSISTANT_FIELD_ASSIGNMENT_ALIASES = {
  durationMinutes:'duration|session length', frequency:'frequency|rhythm|how often',
  minChunkMinutes:'minimum chunk|chunk length', minGapMinutes:'minimum gap|gap',
  timerAutoStopMinutes:'timer target|timer auto stop', autoMarkMinutes:'automatic completion|auto.?mark'
};
const ASSISTANT_FIELD_ASSIGNMENTS = [...ASSISTANT_FOCUS_FIELDS.filter(field=>!['timesPerPeriod','periodDays','exceptionCancelled'].includes(field.id)),{id:'frequency',label:'Frequency'}]
  .filter(field=>!ASSISTANT_FIELD_LITERAL_VALUES.has(field.id))
  .map(field=>({...field,pattern:new RegExp(`\\b(?:${ASSISTANT_FIELD_ASSIGNMENT_ALIASES[field.id]||field.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})\\s*(?:(?:to|is|of)\\b\\s*|[:=]\\s*|(?=\\d))`,'i')}));
const ASSISTANT_FIELD_CLOCK_VALUE = /^(?:(?:at|start(?:s|ing)?(?: at)?|time)\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\d{1,2}:\d{2}\b|noon\b|midnight\b)/i;
// Complete temporal expressions are shared boundary metadata. A window owns
// both endpoints and every anchor offset; none of those quantities is effort.
const ASSISTANT_FIELD_ENDPOINT = `(?:(?:${assistantSpokenQuantitySource()})\\s+(?:before|after)\\s+)?(?:${ASSISTANT_ANCHOR_WORD}|midnight|\\d{1,2}(?::\\d{2}(?:\\s*[ap]m)?|\\s*[ap]m))`;
const ASSISTANT_FIELD_RANGE = `${ASSISTANT_FIELD_ENDPOINT}(?:\\s*(?:plus|minus|[+−])\\s*(?:${assistantSpokenQuantitySource()}))?\\s*(?:to|until|till|through|[–-])\\s*${ASSISTANT_FIELD_ENDPOINT}`;
const ASSISTANT_FIELD_OFFSET = `(?:(?:${assistantSpokenQuantitySource()})\\s+(?:before|after)\\s+(?:${ASSISTANT_ANCHOR_WORD})|(?:${ASSISTANT_ANCHOR_WORD})\\s*(?:plus|minus|[+−-])\\s*(?:${assistantSpokenQuantitySource()}))`;
const ASSISTANT_FIELD_LENGTHS = new Set(['minChunkMinutes','minGapMinutes','durationMinutes','exceptionDuration','timerAutoStopMinutes','autoMarkMinutes']);
const ASSISTANT_FIELD_EFFORT_CACHE = new Map();
const ASSISTANT_FIELD_SIGNALS = {
  name:ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.signal,
  kind:/\b(?:convert|turn|change|make|want)\b.{0,24}\b(?:habit|task)\b/i,
  habitKind:/\b(?:build|limit|reduce|stop)\b/i,
  emoji:/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3|\b(?:emoji|icon)\b/iu,
  emojiBgColor:/\b(?:colou?r|red|blue|green|purple|orange|yellow|pink)\b|\b(?:set|change|use) (?:the |a )?background\b/i,
  priority:/\b(?:(?:high|low|normal|medium|important)\s+priority|priority|p[0-5]|urgent|critical|someday)\b/i,
  frequency:new RegExp(`\\b(?:frequency|rhythm|how often|every|each(?=\\s+(?:(?:${assistantIntegerSource()}|${assistantOrdinalSource()}|other)\\s+)?(?:days?|weeks?)\\b)|daily|weekly|once|twice|thrice|(?:${assistantIntegerSource()})\\s*(?:x|times?|sessions?|occurrences?|repetitions?)|(?:${assistantIntegerSource()})\\s*\\/\\s*(?:days?|weeks?|wk)|(?:${assistantIntegerSource()})\\s*(?:x|times?|sessions?)?\\s+(?:a|per|in|every|each)\\s+(?:days?|weeks?)\\b)\\b`,'i'),
  repeatMode:/\b(?:opportunity|routine|when (?:it fits|conditions|the chance)|regular rhythm)\b/i,
  conditionTrigger:/\b(?:trigger|nearby|proximity|only when (?:the weather matches|[^,;]*\bnear a place)|only when[^,;]*\bat a location)\b/i,
  conditionRadiusM:/\b(?:radius|\d+\s*(?:meters?|metres?))\b/i,
  dueDate:/\b(?:due|deadline|(?:plan|do|finish(?:ed)?)(?: (?:this|it))? by|plan (?:this |it )?for|tomorrow|today|next (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i,
  dueTime:/\b(?:start (?:time|clock)|(?:change|set) (?:the )?time|\d{1,2}\.\d{2}\s*[ap]m|(?:at|start(?:ing)?(?: at)?|by)\s+(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|noon|midnight|half past|quarter (?:past|to)))\b/i,
  hardDue:/\b(?:hard|strict|firm|non[ -]negotiable|must finish|no delay|cannot slip|(?:not|never) allow[^,;]*\bslip|(?:soft|flexible) (?:due date|deadline))\b/i,
  planByDate:/\b(?:(?:do|finish|plan(?:ned)?)(?: (?:this|it))? by|plan-by)\b/i,
  earlyWindowDays:/\b(?:early|in advance)\b|\b(?:days?|weeks?) (?:earlier|before)\b/i,
  delayAllowanceDays:/\b(?:late|delay|postpone|slip|grace period)\b/i,
  allowedWeekdays:new RegExp(`\\b(?:all days|weekdays?|weekends?|(?:${ASSISTANT_WEEKDAY_TOKEN})s?|any day)\\b`,'i'),
  preferredWeekdays:new RegExp(`\\bprefer\\w*\\b.{0,35}\\b(?:weekdays?|weekends?|(?:${ASSISTANT_WEEKDAY_TOKEN})s?)\\b`,'i'),
  allowedMonthDays:new RegExp(`\\b(?:month(?:ly)?\\s*days?|days? of (?:the )?month|(?:${assistantOrdinalSource()}|${assistantIntegerSource()})(?:\\s+(?:and|or)\\s+(?:the\\s+)?(?:${assistantOrdinalSource()}|${assistantIntegerSource()}))*\\s+(?:day\\s+)?of\\s+(?:(?:the|each|every)\\s+)?month|(?:on|prefer(?:red)?(?: doing it on)?)\\s+(?:the\\s+)?(?:${assistantOrdinalSource()})(?!\\s+(?:${ASSISTANT_WEEKDAY_TOKEN})s?\\b))\\b`,'i'),
  preferredMonthDays:new RegExp(`\\bprefer\\w*\\b[^,;]*\\b(?:month(?:ly)?|${assistantOrdinalSource()})\\b`,'i'),
  allowedOrdinalWeekdays:new RegExp(`\\b${ASSISTANT_ORDINAL_WEEKDAY}`,'i'),
  preferredOrdinalWeekdays:new RegExp(`\\bprefer\\w*\\b[^,;]*\\b${ASSISTANT_ORDINAL_WEEKDAY}`,'i'),
  allowedWindow:new RegExp(`\\b(?:${ASSISTANT_FIELD_RANGE}|${ASSISTANT_FIELD_OFFSET}|(?:from|between)\\s+(?:the\\s+)?(?:(?:later|earlier)\\s+of|whichever is (?:later|earlier))|(?:no later than|no earlier than)\\s+${ASSISTANT_FIELD_ENDPOINT}|(?:${assistantSpokenQuantitySource()})\\s+(?:before|after)\\s+(?:${ASSISTANT_ANCHOR_WORD})|(?:time\\s+)?window|(?:allowed|preferred)\\s+(?:time(?: window)?|hours)|(?:before|after|between|from)\\s+(?:\\d[\\d:]*(?:\\s*[ap]m)?|${ASSISTANT_ANCHOR_WORD}|midnight)|(?:every|each|this|in(?: the)?|during(?: the)?)\\s+(?:morning|afternoon|evening)|(?:morning|afternoon|evening|overnight)(?=\\s*(?:$|[,;.!?]))|(?:at|during|in|not|never|except|without)\\s+(?:the\\s+)?night(?:time)?|any time|clear (?:the )?(?:hours|window))\\b`,'i'),
  preferredWindow:new RegExp(`\\bprefer\\w*\\b.{0,40}\\b(?:${ASSISTANT_FIELD_RANGE}|hours?|morning|afternoon|evening|night|nighttime|before|after|between|from)\\b`,'i'),
  allowedTimeFixedStart:/\b(?:fixed|exact)(?: start| time)?\b|\bpin (?:the )?start time\b/i,
  durationMinutes:new RegExp(`(?<!\\w)(?:(?:for\\s+)?${assistantSpokenQuantitySource()}|for\\s+\\w+\\s+(?:minutes?|hours?)|double (?:it|the duration)|duration|long|twice as long)\\b`,'i'),
  tapStartsSession:/\b(?:start with a tap|tap to start|tap (?:starts?|starting)|tapping[^,;]*\b(?:start|session)|start[^,;]*\b(?:tap|tapping))\b/i,
  reminderDnd:/\bdnd\b|\bdo not disturb\b|\b(?:silence|mute) (?:my |the )?phone\b/i,
  breakable:/\b(?:split(?:ting|table)?|breakable|unbreakable|continuous|uninterrupted|chunks?)\b/i,
  minChunkMinutes:/\b(?:minimum chunk|shortest session|(?:minimum|smallest) (?:block|time per piece)|minimum block size|pieces shorter than|chunks?\b[^,;]*\b(?:minimum|at least|minutes?|hours?)|(?:pieces|chunks?)\s+minimum|\d+[- ]minute chunks?)\b/i,
  minGapMinutes:new RegExp(`(?<!\\w)(?:(?:${assistantSpokenQuantitySource()})\\s+gap|gap|apart|between (?:two |the )?sessions|spacing|separate (?:any )?(?:two |the )?sessions|rest between (?:blocks|sessions))\\b`,'i'),
  timerAutoStopMinutes:/\b(?:timer|auto[ -]?stop|stop timer)\b/i,
  autoMarkMinutes:/\b(?:auto[ -]?(?:mark|complete|completion)|automatic completion|automatically (?:complete|mark)|(?:mark|log|complete)[^,;]*\bautomatically|consider it done|manual completion)\b/i,
  trackValue:/\b(?:track|log|record|recording|capture|enter|ask|enable)\b.{0,35}\b(?:value|number|numeric|weight|note|measurement|reading)\b|\bvalue tracking\b/i,
  places:/\b(?:at (?:home|work)|place|location|venue)\b/i,
  anywhereAllowed:/\b(?:anywhere|wherever|any (?:place|location)|(?:no|regardless of) (?:place|location|geographic)|(?:not|doesn['’]t) require a (?:particular|specific) place|only (?:at|in) (?:the )?saved places)\b/i,
  locationPrefs:/\b(?:prefer|avoid|favou?rite)\b.{0,30}\b(?:place|location|home|work)\b|\bworks? best(?: for me)?\b/i,
  weatherProfile:/\b(?:weather profile|(?:use|apply|choose) .{0,20} weather)\b/i,
  weatherRules:/\b(?:temperature|precipitation|rain|wind|gust|humidity|uv|feels like|dry weather|(?:warmer|colder|hotter|cooler) than)\b/i,
  showWeather:/\b(?:show|hide|display|include|see)\b.{0,25}\b(?:weather|forecast)\b/i,
  showWeatherAtLocation:/\b(?:weather|forecast)\b.{0,40}\b(?:(?:the|this|item.?s|activity|assigned|item) (?:place|location)|wherever this item takes place)\b|\b(?:item.?s|item) (?:place|location)\b[^,;]*\b(?:weather|forecast)\b/i,
  weatherLocationId:/\b(?:weather\s+)?(?:forecast|weather)\s+(?:at|in|for)\b|\buse\b[^,;]*\bfor (?:the )?(?:forecast|weather)\b/i,
  scheduleOptions:/\b(?:alternative(?:s|ly)?|options?|either)\b|\bor\b.{0,40}\b(?:at|before|after|from)\b/i,
  scheduleLinks:/\b(?:right|directly|immediately) (?:before|after)\b|\b(?:order|adjacen|partner|same day)\w*\b/i,
  topics:ASSISTANT_FIELD_TEXT_INSTRUCTIONS.topics.signal,
  pinned:/\b(?:pin|pinned|unpin|unpinned)\b/i,
  snoozedUntil:/\b(?:snooze|unsnooze|unhide|hide(?: (?:it|this|that))? until|push (?:it|this|that) back|(?:put (?:it|this|that)(?: task)? on hold|do not show (?:it|this|that)(?: again)?|pause showing (?:it|this|that)) until|bring (?:it|this|that) back)\b/i,
  sharedDisplay:/\b(?:shared (?:display|screen)|view only)\b/i,
  links:/https?:\/\/|www\.|\b(?:link|url|shortcut|whatsapp|facetime)\b/i,
  appointmentRepeat:/\b(?:repeat|weekly|once|every week|single event|one[ -](?:time|off))\b/i,
  appointmentStartDate:/\b(?:date|start day|today|tomorrow|\d{4}-\d{2}-\d{2}|(?:starts?|begins?)(?: repeating)? (?:on|from)|(?:begin|start) (?:the )?(?:event )?series (?:on|from)|start it from|series (?:should )?begin)\b/i,
  appointmentWeekdays:new RegExp(`\\b(?:(?:${ASSISTANT_WEEKDAY_TOKEN})s?|weekdays?|weekends?)\\b`,'i'),
  appointmentUntil:/\b(?:until|through|end date|last date for repeats|recurrence cutoff date|end the (?:series|repeating schedule) on|series (?:should )?stop after)\b/i,
  appointmentStartMinute:/\b(?:start (?:time|clock)|\d{1,2}\.\d{2}\s*[ap]m|\d{1,2}:\d{2}(?=\s+start\b)|(?:at|start|start to)\s+(?:\d{1,2}(?::\d{2})?\s*(?:[ap]m)?|noon|midnight|half past|quarter (?:past|to))|(?:occurrence|date)[^;]*\b(?:\d{1,2}(?::\d{2})?\s*[ap]m|half past|quarter (?:past|to)|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) in the (?:morning|afternoon|evening)))\b/i,
  exceptionTime:/\b(?:at|time|start)\b/i, exceptionDuration:/\b(?:minutes?|hours?|duration|long)\b/i,
  exceptionEmoji:/\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\ufe0f?\u20e3|\bemoji\b/iu, exceptionColor:/\bcolou?r\b/i,
  exceptionCancelled:/\b(?:cancel|skip|restore|uncancel)\b/i, exceptionReset:/\b(?:reset|usual values|back to the regular|follow the series again)\b/i,
  reminderStart:/\b(?:(?:start|beginning) (?:reminder|alert|alarm)|(?:remind|alarm|alert|notify)[^,;]*\b(?:start|begin)\w*|remind me(?! to\b)|no reminders|(?:use|with) (?:an? )?(?:alarm|notifications?))\b/i, reminderEnd:/\b(?:(?:end|finish) (?:reminder|alert|alarm)|(?:remind|alarm|alert|notify)[^,;]*\b(?:end|finish)\w*)\b/i,
  reminderTravelStart:/\b(?:depart|travel start)\w*\b|\b(?:remind|alert|notify)[^,;]*\b(?:leave|leaving)\b/i, reminderTravelEnd:/\b(?:arriv|travel end)\w*\b/i,
  reminderMissed:/\b(?:drop warning|missed|cutoff)\b|\bwarn[^,;]*\b(?:fall behind|miss)\b/i, reminderTravelLead:/\b(?:depart|travel|leav)\w*[^,;]*\b(?:before|lead)\b|\b(?:remind|alarm|notif|alert|heads[ -]?up)\w*[^,;]*\bbefore (?:depart|travel|leav)\w*\b/i,
  reminderStartLead:/\b(?:remind|alarm|notif|alert)\w*[^,;]*\b(?:before|lead)\b/i, reminderMissedLead:/\b(?:drop|missed).{0,25}\b(?:before|lead)\b/i,
  reminderReset:/\b(?:usual|default|reset) reminders?\b|\breset (?:the )?reminders?\b/i
};
const ASSISTANT_FIELD_HINTS = {
  name:'Item title only. Exclude create verbs, dates, frequency and other settings.',
  frequency:'Complete repetition phrase, including count and period. Exclude session length.',
  allowedMonthDays:'Days of the month, including spelled-out ordinal dates. Exclude repetition intervals.',
  preferredMonthDays:'Preferred days of the month, including spelled-out ordinal dates.',
  allowedOrdinalWeekdays:'Monthly weekday rule, including the ordinal, weekday and calendar month. For example last Friday of every month. Exclude simple weekdays and month dates.',
  preferredOrdinalWeekdays:'Preferred monthly weekday rule, including ordinal, weekday and month.',
  reminderTravelLead:'How long before departure to remind, including the number or fraction and its time unit.',
  reminderStartLead:'How long before the event start to remind, including the number or fraction and its time unit.',
  reminderMissedLead:'Missed warning lead time, including the number or fraction and its time unit.',
  durationMinutes:'Length of one session. Exclude frequency, chunk length, gap and timer.',
  minChunkMinutes:'Smallest permitted block of work when splitting a session. Exclude total session length and rest between sessions.',
  minGapMinutes:'Rest or spacing between two sessions. Exclude session length, chunk length and frequency.',
  timerAutoStopMinutes:'Elapsed time at which the running timer stops itself. Exclude habit mode and marking the item done.',
  autoMarkMinutes:'Logged time needed to automatically mark the item complete. Exclude session length, timer stopping and frequency.',
  tapStartsSession:'Whether tapping the item starts a session instead of immediately logging completion.',
  reminderDnd:'Whether Do Not Disturb silences the phone during this item’s session. Not a reminder or a session duration.',
  trackValue:'Whether each completion records a number or measurement, rather than just a checkmark.',
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
    let signal=ASSISTANT_FIELD_SIGNALS[f.id];
    // Saved place names are retrieval vocabulary only. A locative or a
    // preference must introduce them; an item's title is not its location.
    const names=(assistantFocusSettings().locations||[]).map(place=>String(place.name||'').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).filter(Boolean);
    if(names.length&&['places','locationPrefs'].includes(f.id)){
      const qualifier=f.id==='places'?'(?:at|in|near)':'(?:prefer\\w*|avoid|favou?rite)';
      signal=new RegExp(`(?:${signal.source})|\\b${qualifier}\\s+(?:the\\s+)?(?:${names.join('|')})(?=\\s|[.,;!?]|$)`,'i');
    }
    return {...f,key:f.id==='frequency'?'frequency':pair?.[1] || f.id,
      signal, labelSignal:f.id==='exceptionCancelled'?null:new RegExp(`\\b${f.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+')}\\b`,'i'), aliases:search ? `${search[1]} ${search[2]}` : f.label,
      hint:ASSISTANT_FIELD_HINTS[f.id] || `The requested ${f.label.toLowerCase()} setting only.`};
  });
}

function assistantFieldApplicable(def, session){
  // Prerequisites are checked when proposals merge, allowing the extraction to
  // run before a kind/mode/splitting change has been validated.
  const kind = assistantFocusEffectiveKind(session);
  if(kind==='task'&&['allowedWindow','allowedTimeFixedStart'].includes(def.id)&&assistantFieldFixedClock(session.currentRequest)!=null)return false;
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
  for(const match of request.matchAll(/[,;\n]+|[.!?](?=\s|$)|\s+and\s+(?=(?:tag|use|pin|set|show|hide|add|make|rename|remind|alert|notify|warn|prefer\w*)\b)/gi)){
    if(match[0]==='.'&&/\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|[ap]\.m)$/i.test(request.slice(start,match.index)))continue;
    // A comma before an explicit year belongs to its date, not a new setting.
    if(match[0]===',' && new RegExp(`\\b(?:${Object.keys(ASSISTANT_MONTH_NAMES).join('|')})\\s+(?:\\d{1,2}(?:st|nd|rd|th)?|${assistantOrdinalSource()})$`,'i').test(request.slice(start,match.index)) && /^\s*\d{4}\b/.test(request.slice(match.index+1)))continue;
    if(match[0]===','&&/^\s*but (?:the )?other days are (?:fine|okay|ok|allowed)\b/i.test(request.slice(match.index+1)))continue;
    if(match[0]===','&&/\banywhere\b/i.test(request.slice(start,match.index))&&/^\s*not just at (?:a )?saved place\b/i.test(request.slice(match.index+1)))continue;
    // A comma inside a calendar list or a combined time range does not
    // separate settings. Keep the complete instruction for its field reader.
    if(match[0]===','&&/^\s*(?:if possible|(?:for |just |only )?this(?: one)? (?:occurrence|date|time)(?: only)?)$/i.test(request.slice(start,match.index)))continue;
    // A restatement of the same start policy is part of that instruction.
    if(match[0]===','&&/\b(?:start|time)\b/i.test(request.slice(start,match.index))
      &&/\b(?:exact|fixed|flexible)\b/i.test(request.slice(start,match.index))
      &&/^\s*not (?:flexible|fixed|exact)(?:[.!?]|$)/i.test(request.slice(match.index+1)))continue;
    if(match[0]===','&&/^\s*(?:on (?:the )?)?same day\b/i.test(request.slice(match.index+1))&&/\b(?:before|after)\b/i.test(request.slice(start,match.index)))continue;
    if(match[0]===',' && (new RegExp(`^\\s*(?:${ASSISTANT_WEEKDAY_TOKEN})\\b`,'i').test(request.slice(match.index+1))
      && new RegExp(`\\b(?:${ASSISTANT_WEEKDAY_TOKEN})\\b`,'i').test(request.slice(start,match.index))
      || /^\s*(?:until|till|to)\b/i.test(request.slice(match.index+1)) && /\b(?:later|earlier)\b/i.test(request.slice(start,match.index))))continue;
    add(start,match.index);start=match.index+match[0].length;
  }
  add(start,request.length);
  return spans.length ? spans : [{start:0,end:request.length,text:request}];
}

// Shared instruction ownership. Apply these policies to candidate retrieval,
// source boundaries, model evidence and coverage alike. They never supply values.
const ASSISTANT_FIELD_OWNERSHIP = [
  {fields:['frequency'], when:/\bmonth(?:ly)?\b/i},
  {fields:['allowedWeekdays','preferredWeekdays','allowedMonthDays','preferredMonthDays'], when:new RegExp(`\\b${ASSISTANT_ORDINAL_WEEKDAY}`,'i')},
  {fields:['allowedMonthDays','preferredMonthDays'], when:/\b(?:due|deadline|start (?:date|day)|end date|finished by|series (?:should )?begin|(?:begin|start) (?:the )?(?:event )?series)\b/i, unless:/\b(?:each|every) month\b/i},
  {fields:['allowedWeekdays'], when:new RegExp(`\\b(?:every|each)\\s+(?:${assistantOrdinalSource()})\\s+(?:${ASSISTANT_WEEKDAY_TOKEN})\\b`,'i')},
  {fields:['frequency','allowedWeekdays','allowedWindow','allowedMonthDays','allowedOrdinalWeekdays'], when:/\bprefer/i, beforeCue:true},
  {fields:['allowedWindow','preferredWindow'], when:new RegExp(`${ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.signal.source}.*\\b(?:morning|afternoon|evening|night|nighttime)\\b`,'i'), unless:/\b(?:before|after|between|from|only|in the)\b/i},
  {fields:['scheduleLinks'], when:new RegExp(`${ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.signal.source}.*\\b(?:before|after)\\b`,'i')},
  {fields:['allowedWindow'], when:new RegExp(`\\b(?:before|after)\\s+(?:${assistantDurationNumberSource()})(?:\\s+(?:or|and)\\s+(?:${assistantDurationNumberSource()}))*\\s*(?:minutes?|mins?|hours?|days?|weeks?)\\b`,'i')},
  {fields:['habitKind'], when:/\btimer\b|\b(?:stop using|limit (?:it|this|that) to)\b/i},
  {fields:['dueDate','appointmentStartDate','appointmentUntil'], when:/\b(?:snooze|hide until|push (?:it|this|that) back|this (?:one )?(?:date|occurrence))\b/i, unless:/\b(?:due|start date|end date)\b/i},
  {fields:['dueDate'], when:/\b(?:(?:hard|strict|firm) deadline|deadline (?:hard|strict|firm)|cannot slip)\b/i, unless:/\d|today|tomorrow|next\b/i},
  {fields:['delayAllowanceDays'], when:/\bcannot slip\b/i},
  {fields:['appointmentRepeat'], require:/\b(?:weekly|once|every week|one[ -](?:time|off)|single event)\b/i},
  {fields:['allowedMonthDays','preferredMonthDays'], when:new RegExp(`\\b(?:every|each)\\s+(?:${assistantOrdinalSource()})\\s+(?:days?|weeks?)\\b`,'i'), unless:/\bmonth\b/i},
  {fields:['durationMinutes','allowedWindow'], when:/\b(?:radius|meters?|metres?|trigger area)\b/i},
  {fields:['places'], when:/\b(?:radius|meters?|metres?|trigger area)\b/i},
  {fields:['conditionTrigger'], when:/\b(?:radius|meters?|metres?|trigger area)\b/i},
  {fields:['appointmentStartDate'], when:/\b(?:until|through|end date|last date for repeats|recurrence cutoff date)\b/i, unless:/\bstart(?:s|ing)?\b/i},
  {fields:['places'], when:/\b(?:trigger|prefer|avoid|weather|forecast|anywhere|wherever|any (?:place|location)|no (?:place|location|geographic) restriction|regardless of location|(?:not|doesn['’]t) require a (?:particular|specific) place|works? best|only when[^,;]*\bat a location)\b/i},
  {fields:['places'], when:/\bplace (?:it|this) (?:outside|within|between)\b/i},
  {fields:['locationPrefs'], when:new RegExp(`\\b(?:(?:${ASSISTANT_WEEKDAY_TOKEN})s?|month(?:ly)?)\\b`,'i'), unless:/\b(?:place|location|home)\b/i},
  {fields:['anywhereAllowed'], when:/\b(?:weather|forecast)\b/i},
  {fields:['allowedWindow','preferredWindow'], when:/\bthis (?:one )?(?:occurrence|date)\b/i},
  {fields:['showWeather','weatherLocationId'], when:/\b(?:the|this|item.?s|activity|assigned|item) (?:place|location)\b|\bwherever this item takes place\b/i},
  {fields:['showWeather'], when:/\b(?:weather\s+)?(?:forecast|weather)\s+(?:at|in|for)\b/i},
  {fields:['weatherRules'], when:/\bweather profile\b/i},
  {fields:['allowedWindow','preferredWindow'], when:/\b(?:early|grace) (?:time )?window\b|\bstart (?:time|clock)\b|\b(?:change|set) (?:the )?time\b/i},
  {fields:['allowedWindow','preferredWindow'], when:/\b(?:half past|quarter (?:past|to))\b/i, unless:/\b(?:between|from|until)\b/i},
  {fields:['pinned'], when:/\bpin (?:the )?start time\b/i},
  {fields:['allowedWindow','preferredWindow'], when:/\b(?:remind|alarm|notification)\b/i, beforeCue:true, unless:/\b(?:allowed|preferred)\s+(?:time|hours|window)\b/i},
  {fields:['reminderStart','reminderEnd','reminderTravelStart','reminderTravelEnd','reminderMissed'], require:/\b(?:off|notifications?|notify|alarm|alert|remind|reminders|warn)\b/i},
  {fields:['reminderStart','reminderEnd'], when:/\b(?:travel|depart|arrival|leav)\w*/i},
  {fields:['reminderStart'], when:/\bremind[^,;]*\b(?:end|finish)\w*\b/i, unless:/\bstart\b/i},
  {fields:['reminderStartLead'], when:/\b(?:travel|depart|leav|missed|drop)\w*/i},
  {fields:['breakable'], when:/\b(?:minimum chunk|shortest session|(?:minimum|smallest) (?:block|time per piece)|pieces shorter than)\b/i, unless:/\bsplit\b(?! it into pieces shorter than)/i},
  {fields:['allowedWeekdays','allowedWindow','places'], when:/\b(?:options?|alternative(?:s|ly)?)\b/i}
];
const ASSISTANT_FIELD_READERS = {
  appointmentStartDate:{retainPrefix:true}, appointmentUntil:{retainPrefix:true},
  name:{retainPrefix:true}, repeatMode:{retainPrefix:true}, conditionTrigger:{retainPrefix:true}, allowedWeekdays:{shares:['frequency']}, appointmentWeekdays:{shares:['allowedWeekdays','preferredWeekdays','frequency']}, conditionRadiusM:{retainPrefix:true},
  places:{retainPrefix:true}, locationPrefs:{retainPrefix:true}, weatherRules:{retainPrefix:true},
  allowedWindow:{shares:['dueTime','appointmentStartMinute','allowedTimeFixedStart']},
  preferredWindow:{shares:['dueTime','appointmentStartMinute','allowedWindow']},
  earlyWindowDays:{retainPrefix:true}, delayAllowanceDays:{retainPrefix:true},
  tapStartsSession:{retainPrefix:true}, reminderDnd:{retainPrefix:true},
  hardDue:{retainPrefix:true}, anywhereAllowed:{retainPrefix:true}, trackValue:{retainPrefix:true},
  showWeatherAtLocation:{retainPrefix:true}, weatherLocationId:{retainPrefix:true}, sharedDisplay:{retainPrefix:true},
  reminderStart:{retainPrefix:true}, reminderEnd:{retainPrefix:true}, reminderTravelStart:{retainPrefix:true}, reminderTravelEnd:{retainPrefix:true}, reminderMissed:{retainPrefix:true},
  timerAutoStopMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes','autoMarkMinutes']},
  autoMarkMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  scheduleLinks:{retainPrefix:true},
  reminderTravelLead:{retainPrefix:true}, reminderStartLead:{retainPrefix:true}, reminderMissedLead:{retainPrefix:true},
  minChunkMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  minGapMinutes:{retainPrefix:true, shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  breakable:{shares:['durationMinutes','breakable','minChunkMinutes','minGapMinutes']},
  frequency:{retainPrefix:true,shares:['allowedWeekdays']},
  appointmentRepeat:{shares:['frequency']},
};

function assistantFieldReminderLead(text){
  if((!/\b(?:lead|before(?:hand)?|ahead|early|earlier|advance)\b/i.test(text)&&!assistantDurationHits(text).length) || !/\b(?:remind\w*|alarm|notif\w*|alert|warn\w*|heads[ -]?up|depart\w*|travel|missed|drop.warning)\b/i.test(text))return null;
  return /\b(?:depart|travel|leav)\w*\b/i.test(text)?'reminderTravelLead'
    :/\b(?:missed|drop.warning)\b/i.test(text)?'reminderMissedLead':'reminderStartLead';
}

// A single quantity cannot be both a session length and a chunk/gap/timer
// target. Apply the same ownership before retrieval, boundary cuts and merge.
// Multiple quantities keep their own boundaries and are validated separately.
function assistantFieldEffortOwner(text){
  if(ASSISTANT_FIELD_EFFORT_CACHE.has(text))return ASSISTANT_FIELD_EFFORT_CACHE.get(text);
  const hits=assistantDurationHits(text);
  const joined=hits.length===2&&hits[0].unit==='h'&&hits[1].unit==='m'
    && /^[\s,]*(?:and[\s,]*)?$/.test(assistantNormalizeDurationText(text).slice(hits[0].end,hits[1].index));
  const owners=hits.length>1&&!joined?[]:['minChunkMinutes','minGapMinutes','timerAutoStopMinutes','autoMarkMinutes'].filter(id=>ASSISTANT_FIELD_SIGNALS[id].test(text));
  const owner=owners.length===1?owners[0]:owners.length?'ambiguous':null;
  if(text.length<=2000){
    if(ASSISTANT_FIELD_EFFORT_CACHE.size>=128)ASSISTANT_FIELD_EFFORT_CACHE.delete(ASSISTANT_FIELD_EFFORT_CACHE.keys().next().value);
    ASSISTANT_FIELD_EFFORT_CACHE.set(text,owner);
  }
  return owner;
}

const ASSISTANT_FIELD_CLEAR_LABELS = {
  emoji:'emoji|icon', emojiBgColor:'(?:background\\s+)?colou?r|background',
  dueDate:'due date|deadline(?: date)?', dueTime:'(?:scheduled )?(?:start[ -]time|clock time)(?: field)?', planByDate:'(?:soft )?(?:plan|do)[ -]by(?: target)?(?: date)?',
  allowedWeekdays:'(?:allowed )?(?:weekdays?|days of the week)|(?:day[ -]of[ -]week|weekday|day) restrictions?', preferredWeekdays:'preferred (?:weekdays?|days(?: of the week)?)|day[ -]of[ -]week preferences?',
  allowedMonthDays:'(?:allowed )?month days|day[ -]of[ -]month restrictions?', preferredMonthDays:'preferred month days|preferred dates within the month',
  allowedOrdinalWeekdays:'(?:allowed )?monthly weekday rules|ordinal weekday restrictions?', preferredOrdinalWeekdays:'(?:preferred monthly weekday rules|ordinal weekday preferences)',
  allowedWindow:'(?:allowed )?(?:hours|time(?: window)?|window|time restriction)', preferredWindow:'preferred (?:hours|time(?: window)?|window)',
  topics:'topics?|tags?|topic tags', places:'places?|locations?', locationPrefs:'(?:place|location) preferences', weatherProfile:'(?:a |the )?weather profile',
  links:'links?|urls?', scheduleLinks:'order(?: constraints?)?|schedule links', scheduleOptions:'(?:(?:extra )?(?:schedule|scheduling) )?(?:alternatives|options)|alternative time slots',
  snoozedUntil:'snooze', timerAutoStopMinutes:'timer target|automatic timer stop|timer auto[ -]stop', autoMarkMinutes:'automatic completion',
  minGapMinutes:'(?:minimum )?(?:gap|spacing between sessions)|required rest between sessions', weatherLocationId:'(?:(?:separate )?weather )?forecast (?:place|location)|(?:separate )?weather (?:place|location)',
  appointmentUntil:'(?:(?:event )?series )?end date|recurrence cutoff date'
};
const ASSISTANT_FIELD_CLEAR_CACHE = new Map();

function assistantFieldClearOwners(text){
  if(ASSISTANT_FIELD_CLEAR_CACHE.has(text))return ASSISTANT_FIELD_CLEAR_CACHE.get(text);
  const ids=Object.keys(ASSISTANT_FIELD_CLEAR_LABELS).filter(id=>assistantFieldClear({id},text));
  if(ASSISTANT_FIELD_CLEAR_CACHE.size>=128)ASSISTANT_FIELD_CLEAR_CACHE.delete(ASSISTANT_FIELD_CLEAR_CACHE.keys().next().value);
  ASSISTANT_FIELD_CLEAR_CACHE.set(text,ids);
  return ids;
}

function assistantFieldClear(def,text){
  if(!assistantFocusField(def.id)?.clear)return false;
  const label=ASSISTANT_FIELD_CLEAR_LABELS[def.id]||(def.label||assistantFocusField(def.id).label).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let value=assistantFieldDialogue(text).text.replace(/[.!?]$/,'').trim();
  const owner='(?:(?:the|its|my|all|any|an?)\\s+|(?:this\\s+)?(?:item|task|habit)(?:[’\']s)?\\s+)*';
  const suffix='(?:\\s+(?:off|anymore|restriction|for (?:this|the) (?:item|task|habit)))?';
  if(new RegExp(`^(?:clear|remove|delete|drop|unset|reset|disable|get rid of|take away|stop using|don['’]t use|do not use|(?:use )?no|take)\\s+${owner}(?:${label})${suffix}$`,'i').test(value))return true;
  if(new RegExp(`^(?:leave|keep)\\s+${owner}(?:${label})\\s+(?:empty|blank|unset)$`,'i').test(value))return true;
  if(new RegExp(`^(?:(?:this|the) (?:item|task|habit) (?:should have no|no longer has)|I (?:have no|no longer have))\\s+${owner}(?:${label})(?: anymore)?$`,'i').test(value))return true;
  if(['emoji','emojiBgColor'].includes(def.id)){
    const mark=def.id==='emoji'?'emoji|icon':'(?:background )?colou?r';
    if(new RegExp(`^(?:clear|remove) (?:the )?(?:${mark}) override for this (?:occurrence|date)$`,'i').test(value)
      ||new RegExp(`^(?:clear|remove) (?:just )?this (?:date|occurrence)['’]s custom (?:${mark})$`,'i').test(value)
      ||new RegExp(`^let this (?:occurrence|date) inherit the series (?:${mark})$`,'i').test(value))return true;
  }
  return def.id==='allowedWeekdays'&&/^(?:(?:allow|use|go back to)\s+)?(?:any (?:day|weekday)(?: of the week)?|all days|every day)(?: (?:is|are) fine)?$/i.test(value)
    ||def.id==='allowedMonthDays'&&/^any (?:date|day) (?:in|of) the month(?: is fine)?$/i.test(value)
    ||def.id==='allowedWindow'&&/^(?:no time restrictions?|any time(?: of day)?(?: is fine)?|remove all restrictions on the time of day)$/i.test(value)
    ||def.id==='timerAutoStopMinutes'&&/^let the timer run without an automatic cutoff$/i.test(value)
    ||def.id==='autoMarkMinutes'&&/^(?:switch back to manual completion|(?:do not|don['’]t) mark (?:it|this) done automatically anymore)$/i.test(value)
    ||def.id==='snoozedUntil'&&/^(?:unsnooze(?: (?:it|this))?|show (?:it|this)(?: task| item| habit)? again now)$/i.test(value)
    ||def.id==='appointmentUntil'&&/^let the series repeat without an end date$/i.test(value);
}

// An exact start with a clock supplies both the hour and its fixed policy.
// Tasks/events already have a fixed start; habits use the allowed-time control.
function assistantFieldFixedClock(text){
  const value=assistantFieldDialogue(text).text.replace(/[.!?]+$/,'');
  const match=value.match(/^(?:(?:use|set|make|change)\s+(?:(?:it|this)\s+(?:to\s+)?)?)?(?:an?\s+|the\s+)?(?:fixed|exact) start(?: time)?(?:\s+(?:to|at|of|is))?\s+(.+)$/i)
    ||value.match(/^(?:start|begin)(?:\s+(?:it|this))?\s+exactly(?:\s+at)?\s+(.+)$/i)
    ||value.match(/^(?:start|begin)(?:\s+(?:it|this))?\s+at\s+(.+?)\s+(?:exactly|sharp|on the dot)$/i);
  return match?assistantParseClock(match[1]):null;
}

// Start policy has no clock operand. Preserve the complete policy rather than
// inventing a time/window or treating "not flexible" as another instruction.
function assistantFieldStartPolicy(text){
  if(!/\bstart(?:[ -]time)?\b/i.test(text))return null;
  if(assistantDurationHits(text).length||/\d|\b(?:noon|midnight|sunrise|sunset)\b/i.test(text))return null;
  const policy=text.replace(/\b(?:should|must|is|be)\s+not\s+(?:be\s+)?(fixed|exact|flexible)\b/gi,'not $1').replace(/\binstead of (?:a |the )?(?:flexible|fixed|exact)(?: (?:window|start|time))?\b/gi,'');
  const fixed=/\b(?:fixed|exact(?:ly)?|non[ -]flexible|not flexible|(?:do not|don['’]t) slide)\b/i.test(policy.replace(/\bnot (?:fixed|exact)\b/gi,''));
  const flexible=/\b(?:flexible|not fixed|not exact)\b/i.test(policy.replace(/\b(?:non[ -]|not )flexible\b/gi,''));
  if(fixed&&flexible)return 'conflict';
  return fixed?true:flexible?false:null;
}

function assistantFieldAllRemindersOff(text){
  return /^(?:remove|disable|turn off|no)\s+(?:all\s+)?reminders?(?:\s+(?:for\s+)?(?:this|it))?$/i.test(text.trim());
}

function assistantFieldPreference(text){
  return /\bprefer\w*\b|\b(?:ideally|if possible|when possible|favou?r\w*|work best|works best)\b/i.test(text);
}

// These policies describe boolean settings, not dates or place assignments.
// They still require the model to select the original instruction as evidence.
function assistantFieldDeadlinePolicy(text){
  if(!/\b(?:due|deadline|slip|delay)\b/i.test(text))return null;
  const negated=/\bnot (?:hard|strict|firm)\b/gi;
  const positive=text.replace(negated,'');
  const noSlip=/\b(?:do not|don['’]t|never) allow[^,;]*\bslip\b/gi;
  const strict=/\b(?:hard|strict|firm|non[ -]negotiable|cannot slip|no delay)\b/i.test(positive)||noSlip.test(positive);
  const flexible=/\b(?:soft|flexible|allow[^,;]*\b(?:slip|late))\b/i.test(text.replace(noSlip,''))||new RegExp(negated.source,'i').test(text);
  if(!strict&&!flexible)return null;
  if(/\b(?:not|never|don.t|without)\b/i.test(positive.replace(noSlip,''))||strict&&flexible)return 'conflict';
  return strict?true:flexible?false:null;
}

function assistantFieldAnywherePolicy(text){
  const denial=/\b(?:not anywhere|(?:do not|don['’]t|never) allow[^,;]*\banywhere)\b/gi;
  const unrestricted=/\b(?:anywhere|wherever I am|any (?:place|location)|no (?:place|location|geographic) restrictions?|regardless of location|(?:does not|doesn['’]t) require a (?:particular|specific) place)\b/i.test(text.replace(denial,''));
  const restricted=new RegExp(denial.source,'i').test(text)||/\bonly (?:at|in) (?:the )?saved places\b/i.test(text);
  if(restricted&&unrestricted)return 'conflict';
  const polarity=text.replace(/\b(?:does not|doesn['’]t) require a (?:particular|specific) place\b|\bno (?:place|location|geographic) restrictions?\b|\bnot just at (?:a )?saved place\b/gi,'');
  if(unrestricted&&!restricted&&/\b(?:no|not|never|don.t|cannot|can.t|without|except|only)\b/i.test(polarity))return 'conflict';
  return restricted?false:unrestricted?true:null;
}

function assistantFieldRelevant(def, text){
  const target=assistantEditTarget(text);
  if(target!==text&&!def.signal?.test(target)&&!assistantFieldClear(def,target))return false;
  text=target;
  if(['minGapMinutes','allowedWindow'].includes(def.id)&&assistantParseWeekdaySet(text))return false;
  if(def.id==='kind'&&ASSISTANT_FIELD_SIGNALS.habitKind.test(text)&&!/(?:convert|turn|change|make)\b[^,;]*\b(?:to|into|a)\s+(?:habit|task)\b/i.test(text))return false;
  const literal=assistantFieldLiteralOwner(text);
  if(literal && literal.id!==def.id && !assistantFieldMentioned(def,text.slice(0,literal.start)))return false;
  if(!literal&&ASSISTANT_FIELD_SIGNALS.tapStartsSession.test(text)&&['dueTime','appointmentStartMinute','allowedWindow','durationMinutes','reminderStart'].includes(def.id))return false;
  if(!literal&&ASSISTANT_FIELD_SIGNALS.reminderDnd.test(text)&&def.id!=='reminderDnd')return false;
  if(def.id==='frequency'&&ASSISTANT_FIELD_SIGNALS.repeatMode.test(text)&&!assistantParseRhythm(text))return false;
  if(def.id==='weatherRules'&&ASSISTANT_FIELD_SIGNALS.weatherProfile.test(text)
    &&(assistantFocusSettings().weatherProfiles||[]).some(profile=>assistantFocusPhraseIn(text,profile.name))
    &&! /\b(?:temperature|precipitation|rain|wind|gust|humidity|uv|feels like|above|below|warmer|colder)\b/i.test(text))return false;
  const clears=assistantFieldClearOwners(text);
  if(clears.length&&!clears.includes(def.id))return false;
  if(assistantFieldStartPolicy(text)!=null&&['dueTime','appointmentStartMinute','allowedWindow','preferredWindow','pinned'].includes(def.id))return false;
  if(['dueDate','appointmentStartDate','appointmentUntil'].includes(def.id)&&ASSISTANT_FIELD_SIGNALS.snoozedUntil.test(text))return false;
  if(def.id==='places'&&assistantFieldAnywherePolicy(text)!=null&&/\bsaved places\b/i.test(text))return false;
  if(['dueDate','planByDate','delayAllowanceDays'].includes(def.id)&&assistantFieldDeadlinePolicy(text)!=null
    &&!new RegExp(`\\d|\\b(?:today|tomorrow|next|${ASSISTANT_WEEKDAY_TOKEN}|${Object.keys(ASSISTANT_MONTH_NAMES).join('|')})\\b`,'i').test(text))return false;
  if(def.id==='frequency'&&ASSISTANT_FIELD_SIGNALS.trackValue.test(text)&&/\b(?:each|every) (?:completion|check[ -]?in|log)\b/i.test(text))return false;
  const lead=assistantFieldReminderLead(text);
  if(lead && (ASSISTANT_FIELD_LENGTHS.has(def.id)||['allowedWindow','preferredWindow','dueTime','appointmentStartMinute','earlyWindowDays','breakable','trackValue'].includes(def.id)))return false;
  if(lead && /Lead$/.test(def.id) && def.id!==lead)return false;
  if(lead && /^reminder/.test(def.id) && !/Lead$/.test(def.id) && def.id!=='reminderReset'
    && !/\b(?:off|notifications?|alarm)\b/i.test(text))return false;
  const effort=assistantFieldEffortOwner(text);
  if(effort&&def.id==='durationMinutes')return false;
  if(effort&&['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id))return false;
  if(effort&&def.id==='frequency'&&!/\b(?:every|daily|weekly|times? (?:a|per|each))\b/i.test(text))return false;
  if(effort&&ASSISTANT_FIELD_LENGTHS.has(def.id)&&def.id!==effort)return false;
  if(['frequency','allowedWeekdays','allowedMonthDays','allowedOrdinalWeekdays','allowedWindow'].includes(def.id)
    && assistantFieldPreference(text))return false;
  const assignments=ASSISTANT_FIELD_ASSIGNMENTS.map(row=>({...row,match:row.pattern.exec(text)})).filter(row=>row.match).sort((a,b)=>a.match.index-b.match.index);
  const cue=assistantFieldCue(def,text);
  const owner=assignments.filter(row=>!cue || row.match.index<=cue.index).at(-1);
  if(owner && owner.id!==def.id && !(def.id==='name'&&!cue&&assignments[0].match.index>0)
    && !(['dueTime','appointmentStartMinute','exceptionTime'].includes(owner.id) && ['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id))){
    // A sibling instruction after a conjunction owns its own value. Lists and
    // mixed quantities inside the assigned value retain the original owner.
    const between=text.slice(owner.match.index+owner.match[0].length,cue?.index??text.length);
    const complete=cue && assistantFieldAssignmentComplete(owner.id,between);
    if(!complete && !/[,;\n]|\band\b(?=\s+(?:(?:set|change|use|make|pin|prefer)\b|\w+\s+(?:to\b|is\b|[:=])))/i.test(between))return false;
  }
  return ASSISTANT_FIELD_OWNERSHIP.every(rule=>{
    const scope=rule.beforeCue&&cue?text.slice(0,cue.index+cue[0].length):text;
    return !rule.fields.includes(def.id)
      || (rule.require ? rule.require.test(scope) : !rule.when.test(scope) || Boolean(rule.unless?.test(scope)));
  });
}

function assistantFieldAssignmentComplete(id,text){
  // Boundary metadata only: a complete assigned value can be followed by a
  // sibling instruction without a conjunction ("duration to 20 minutes at
  // 6pm"). These reads never stage values or recover a declined extraction.
  if(ASSISTANT_FIELD_LENGTHS.has(id))return assistantDurationHits(text).length>0;
  if(id==='frequency')return Boolean(assistantParseRhythm(text));
  if(['dueTime','appointmentStartMinute','exceptionTime'].includes(id))return assistantParseClock(text)!=null;
  if(['dueDate','planByDate','appointmentStartDate','appointmentUntil'].includes(id))return assistantParseDue(text)!=null;
  if(id==='priority')return assistantParsePriority(text)!=null;
  if(ASSISTANT_FIELD_QUANTITIES[id])return assistantFieldQuantity({id,label:id},text).ok;
  return false;
}

function assistantFieldMentioned(def,text){
  return Boolean(assistantFieldCue(def,text));
}

function assistantFieldCue(def,text,from=0){
  if(from===0){
    if(['allowedWindow','allowedTimeFixedStart','dueTime','appointmentStartMinute'].includes(def.id)&&assistantFieldFixedClock(text)!=null)return /^.*$/s.exec(text);
    const target=assistantEditTarget(text);
    if(target!==text)return assistantFieldCue(def,target)?/^.*$/s.exec(text):null;
    if(['allowedWeekdays','appointmentWeekdays'].includes(def.id)&&def.signal?.test(text)&&assistantParseWeekdaySet(text))return /^.*$/s.exec(text);
  }
  if(from===0&&def.id==='hardDue'&&assistantFieldDeadlinePolicy(text)!=null)return /^.*$/s.exec(text);
  if(from===0&&def.id==='allowedTimeFixedStart'&&assistantFieldStartPolicy(text)!=null)return /^.*$/s.exec(text);
  if(from===0&&assistantFieldReminderLead(text)===def.id)return /^.*$/s.exec(text);
  if(from===0&&(assistantFieldClear(def,text)||assistantFieldAllRemindersOff(text)&&/^reminder(?:Start|End|TravelStart|TravelEnd|Missed)$/.test(def.id)))return /^.*$/s.exec(text);
  const preferred={preferredWeekdays:'allowedWeekdays',preferredMonthDays:'allowedMonthDays',preferredOrdinalWeekdays:'allowedOrdinalWeekdays',preferredWindow:'allowedWindow'}[def.id];
  if(from===0&&preferred&&assistantFieldPreference(text)&&ASSISTANT_FIELD_SIGNALS[preferred].test(text))return /^.*$/s.exec(text);
  const signal=def.signal;
  if(signal){
    // A quantity attached to a solar/prayer anchor is a window offset. It
    // cannot also nominate a session length or cut that window's evidence.
    const offsets=def.id==='durationMinutes'?Array.from(text.matchAll(new RegExp(`(?<!\\w)${ASSISTANT_FIELD_OFFSET}\\b`,'gi'))):[];
    for(const match of text.matchAll(new RegExp(signal.source,signal.flags.replace(/g/g,'')+'g'))){
      if(match.index<from)continue;
      if(!offsets.some(offset=>match.index<offset.index+offset[0].length&&match.index+match[0].length>offset.index))return match;
    }
  }
  for(const pattern of [def.labelSignal,ASSISTANT_FIELD_ASSIGNMENTS.find(field=>field.id===def.id)?.pattern]){
    if(!pattern)continue;
    const match=Array.from(text.matchAll(new RegExp(pattern.source,pattern.flags.replace(/g/g,'')+'g'))).find(match=>match.index>=from);
    if(match)return match;
  }
  return null;
}

function assistantFieldLiteralOwner(text){
  for(const [id,instruction] of Object.entries(ASSISTANT_FIELD_TEXT_INSTRUCTIONS)){
    const cue=instruction.signal.exec(text);
    if(!cue || id==='name' && /^(?:called|named)$/i.test(cue[0]))continue;
    const source=text.slice(cue.index),value=assistantFieldStripPrefix(source,instruction.prefix);
    if(value && value!==source)return {id,start:text.length-value.length,instructionStart:cue.index};
  }
  return null;
}

function assistantFieldDialogue(text){
  let start=0,end=text.length,match;
  // These only mark dialogue boundaries. Negation, alternatives, preferences,
  // ordinals, units and before/after qualifiers remain in the evidence.
  const leading=/^(?:(?:hi|hello|hey|um|please|actually|okay|ok|instead)\b[,\s]*|(?:can|could|would)\s+(?:you|u)\s+|the\s+|(?:make|change|set|move)\s+(?:it|this|that)(?:\s+to)?\s+)/i;
  while((match=leading.exec(text.slice(start,end)))&&match[0].length)start+=match[0].length;
  const trailing=/(?:^|\s)(?:please|pls|instead|thanks)[.!?]*$/i;
  while((match=trailing.exec(text.slice(start,end)))&&match[0].length)end=start+match.index;
  while(start<end&&/\s/.test(text[start]))start++;
  while(end>start&&/\s/.test(text[end-1]))end--;
  return {start,end,text:text.slice(start,end)};
}

function assistantFieldSource(def, request, spans){
  const meaningful=span=>{
    if(!assistantFieldRelevant(def,span.text))return false;
    if(def.id==='places' && /^trigger (?:is )?location$/i.test(span.text))return false;
    if(def.id==='durationMinutes'){
      const length=assistantFieldCue(def,span.text);
      if(!length&&def.signal.test(span.text))return false;
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
    if(def.id==='name'&&!ASSISTANT_FIELD_SIGNALS.name.test(text)){
      const cue=ASSISTANT_FIELD_SIGNALS.allowedWindow.exec(text);
      if(cue&&/^(?:allowed|preferred?|only|time|hours|window)?\s*$/i.test(text.slice(0,cue.index)))n=-1;
    }
    return n;
  };
  const ranked=spans.map(span=>({span,score:score(span)})).sort((a,b)=>b.score-a.score || a.span.start-b.span.start);
  const threshold=ranked.some(row=>row.score>=20)?20:1;
  const selected=ranked.filter(row=>row.score>=threshold).map(row=>row.span).sort((a,b)=>a.start-b.start);
  const source=selected.length ? selected : [ranked[0].span];
  return source.flatMap(span=>{
    const own=assistantFieldCue(def,span.text);
    if(!own && def.id!=='name')return [span];
    // Keep quantities preceding their labels and qualifiers such as immediately.
    const reader=ASSISTANT_FIELD_READERS[def.id]||{};
    const whole=reader.retainPrefix&&(!ASSISTANT_FIELD_LENGTHS.has(def.id)||assistantDurationHits(span.text).length<2)
      ||def.id==='appointmentStartMinute'&&/\bthis (?:one )?(?:occurrence|date)\b/i.test(span.text);
    let start=whole||assistantFieldClear(def,span.text)?0:own.index, end=span.text.length;
    if(['allowedOrdinalWeekdays','preferredOrdinalWeekdays'].includes(def.id)){
      const month= /\b(?:month['’]s|monthly(?:\s+rule(?:\s+should be)?)?)\s*$/i.exec(span.text.slice(0,start));
      if(month)start=month.index;
    }
    const sign=span.text.slice(0,start).match(/[-+−]\s*$/);
    if(sign)start-=sign[0].length;
    const instruction=ASSISTANT_FIELD_TEXT_INSTRUCTIONS[def.id];
    const named=instruction && own && assistantFieldStripPrefix(span.text.slice(own.index),instruction.prefix);
    if(named && named!==span.text.slice(own.index))start=span.text.length-named.length;
    // A leading length belongs to the session, while the title follows it.
    // Keep the remaining original words available to the name extractor.
    if(def.id==='name' && !named){
      const length=ASSISTANT_FIELD_SIGNALS.durationMinutes.exec(span.text);
      if(length && /^(?:please\s+)?(?:add|create|make)\s+(?:a|an)\s*$/i.test(span.text.slice(0,length.index)))start=length.index+length[0].length;
    }
    const prefix=span.text.slice(0,start);
    // Earlier windows cannot pull a later session-length excerpt back across
    // its boundary. A temporal qualifier immediately before the length still
    // belongs to that length and must remain available for validation.
    const temporal=def.id==='durationMinutes'
      ?/\b(?:before|after|between|from|until|through|earlier|later)\s*$/i
      :/\b(?:before|after|between|from|until|through|earlier|later)\b/i;
    if(/\b(?:no|not|never|don.t|without|or|minus|negative|prefer|avoid|keep|unchanged|clear|remove|drop|rid|off)\b/i.test(prefix)||temporal.test(prefix))start=0;
    // Retrieval boundaries, not values: keep the untouched source between
    // setting cues. Coupled lengths (chunks/gaps/timers) keep their units.
    for(const [id,signal] of Object.entries(ASSISTANT_FIELD_SIGNALS)){
      if(!assistantFieldRelevant({id,signal},span.text))continue;
      if(id==='dueDate' && def.id==='name'&&!named){const date=signal.exec(span.text);if(date&&date.index>start)end=Math.min(end,date.index);continue;}
      if(!id.startsWith('reminder')&&!['name','frequency','durationMinutes','dueTime','appointmentStartMinute','allowedWeekdays','allowedOrdinalWeekdays','preferredOrdinalWeekdays','allowedWindow','preferredWindow','allowedMonthDays','preferredMonthDays','topics','priority','pinned','emoji','links','minGapMinutes','minChunkMinutes','timerAutoStopMinutes','autoMarkMinutes'].includes(id))continue;
      if(id===def.id || ['kind','habitKind','emojiBgColor','dueDate','allowedTimeFixedStart','preferredWeekdays'].includes(id))continue;
      if(named && def.id==='name')continue;
      if(reader.shares?.includes(id))continue;
      if(['frequency','allowedWindow'].includes(def.id)&&['frequency','allowedWindow'].includes(id) && /\bevery (?:morning|afternoon|evening|night)\b/i.test(span.text))continue;
      if(def.id.startsWith('reminder') && ['durationMinutes','dueTime','appointmentStartMinute','allowedWindow'].includes(id))continue;
      if(/Lead$/.test(def.id)&&id.startsWith('reminder'))continue;
      const other=assistantFieldCue({id,signal},span.text,own?own.index+own[0].length:start);
      if(other && other.index>=(own?own.index+own[0].length:start) && (other.index>start||def.id==='name'&&!own))end=Math.min(end,other.index);
    }
    // A connector leading into a sibling setting belongs to that sibling,
    // whether the preceding value is a title or a structured restriction.
    if((def.id==='name'||!ASSISTANT_FIELD_LITERAL_VALUES.has(def.id)) && end<span.text.length){
      const narrative=def.id==='name'?`|allowed|preferred${!named?'|happens|occurs|repeats|runs|lasts':''}`:'';
      const dangling=new RegExp(`\\s+(?:on|in|at|for|before|after|during|from|every|each|with|to|by|and${narrative})(?:\\s+the)?\\s*$`,'i').exec(span.text.slice(start,end));
      if(dangling)end=start+dangling.index;
    }
    // A clock is a scalar, not all prose up to the next field. Keep the exact
    // clock token as evidence; retain alternatives/negation for validation.
    if(['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id)){
      const clock=ASSISTANT_FIELD_CLOCK_VALUE.exec(span.text.slice(start,end));
      if(clock){
        const tail=span.text.slice(start+clock[0].length,end);
        if(!/\b(?:not|never|except|instead|or)\b|\d|\b(?:noon|midnight)\b/i.test(tail))end=start+clock[0].length;
      }
    }
    while(start<end && /\s/.test(span.text[start]))start++;
    while(end>start && /\s/.test(span.text[end-1]))end--;
    if(!ASSISTANT_FIELD_LITERAL_VALUES.has(def.id)){
      const dialogue=assistantFieldDialogue(span.text.slice(start,end));
      end=start+dialogue.end;start+=dialogue.start;
    }
    const text=span.text.slice(start,end);
    if(!text&&def.id==='name')return [];
    if(def.id==='name'&&!named&&/^(?:only|allowed|preferred?|time|hours|window)\s*$/i.test(text))return [];
    // A title cut down to dialogue framing alone ("make it") names nothing;
    // dropping the span keeps a follow-up correction from reopening the name.
    // Explicit naming instructions keep their literal words, including "Please".
    if(def.id==='name' && !assistantFieldLiteralOwner(request)
      && /^(?:(?:please|actually|okay|ok|instead)\b[,\s]*)?(?:(?:make|change|set|move|rename|call|end)\s+)?(?:it|this|that)\.?$/i.test(text))return null;
    const selected=text?{start:span.start+start,end:span.start+end,text,context:span.text}:span;
    // A setting may reappear after a sibling setting in the same sentence.
    // Retain every such instruction so incompatible values ask, rather than
    // silently losing the trailing restriction. Names use only their title.
    const tail=span.text.slice(end);
    const trailingClockLabel=['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id)&&/^\s*(?:start (?:time|clock)|time)\s*$/i.test(tail);
    const more=def.id!=='name'&&!trailingClockLabel&&end>0&&end<span.text.length&&assistantFieldCue(def,tail)
      ?assistantFieldSource(def,request,[{start:span.start+end,end:span.end,text:tail}]):[];
    return [selected,...more];
  }).filter(Boolean);
}

function assistantFieldEnqueue(state, id, reason, source){
  const def=state.catalog.find(d=>d.id===id);
  if(!def || !assistantFieldApplicable(def,state.session))return;
  // Changing a lead time on Edit preserves the existing delivery mode.
  // Create can explicitly request its first reminder without naming a mode.
  if(state.session.operation==='edit'&&['reminderStart','reminderEnd','reminderTravelStart','reminderTravelEnd','reminderMissed'].includes(id)
    && /\b(?:before|lead)\b/i.test(state.request)&&!/\b(?:off|notifications?|alarm)\b/i.test(state.request))return;
  const prior=state.jobs.find(j=>j.id===id&&j.request!==state.request&&j.status==='queued');
  if(prior && !['explicit','coverage','semantic'].includes(reason))return prior;
  const existing=state.jobs.find(j=>j.id===id && j.revision===state.revision && j.request===state.request);
  if(existing){
    if(['explicit','coverage','reference'].includes(reason))existing.required=true;
    if(reason==='semantic'&&source?.length){
      const spans=existing.semantic?(existing.refreshSpans||existing.spans).slice():[];
      for(const span of source)if(!spans.some(old=>old.start===span.start&&old.end===span.end))spans.push(span);
      if(!existing.semantic||spans.length!==(existing.refreshSpans||existing.spans).length){
        existing.semantic=true;
        if(['running','waiting'].includes(existing.status))existing.refreshSpans=spans;
        else {existing.spans=spans;existing.status='queued';existing.result=null;}
      }
    }
    return existing;
  }
  let spans=source || (id==='scheduleOptions'?[{start:0,end:state.request.length,text:state.request}]:assistantFieldSource(def,state.request,state.spans));
  spans=spans.filter(span=>!(state.unavailableSpans||[]).some(owned=>span.start>=owned.start&&span.end<=owned.end));
  if(state.followup && id!==state.followup.field)spans=spans.filter(span=>!state.followup.spans.some(owned=>span.start>=owned.start&&span.end<=owned.end));
  spans=spans.filter(span=>!(state.referenceUnresolved||[]).some(owned=>span.start>=owned.start&&span.end<=owned.end));
  if(!spans.length)return;
  const baseline=assistantFocusMaterialize(state.session);
  if(id==='appointmentRepeat'&&state.session.operation==='edit'&&baseline.appointment?.repeat==='weekly'
    &&new RegExp(`\\bweekly on (?:${ASSISTANT_WEEKDAY_TOKEN})s?\\b`,'i').test(state.request))return;
  const row={id,family:def.family,def,request:state.request,spans,revision:state.revision,status:'queued',attempts:0,
    required:['explicit','coverage','reference'].includes(reason),reason,baseline:{durationMinutes:baseline.durationMinutes}};
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
    if(assistantFieldMentioned(def,text) && assistantFieldSource(def,text,state.spans).some(s=>assistantFieldMentioned(def,s.context||s.text)))assistantFieldEnqueue(state,def.id,'explicit');
  });
  // One request can switch every edge off without resetting inherited values.
  // Each edge still gets its own model-selected original-source evidence.
  if(assistantFieldAllRemindersOff(text))for(const id of ['reminderStart','reminderEnd','reminderTravelStart','reminderTravelEnd','reminderMissed']){
    assistantFieldEnqueue(state,id,'explicit',[{start:0,end:text.length,text}]);
  }
  // Creation checks its essentials. Edit keeps its baseline; omitted essentials
  // are not instructions to reread or change those settings. Explicit signals,
  // retrieval and replies to field questions still nominate jobs in both modes.
  if(state.session.operation==='create'){
    for(const id of ['name','frequency','durationMinutes']){
      if(id==='name'&&assistantFocusMaterialize(state.session).name)continue;
      assistantFieldEnqueue(state,id,'core');
    }
    if(state.session.kind==='task')for(const id of ['dueDate','dueTime'])assistantFieldEnqueue(state,id,'core');
    if(state.session.kind==='event')for(const id of ['appointmentStartDate','appointmentStartMinute','appointmentRepeat'])assistantFieldEnqueue(state,id,'core');
  }
  if(state.session.kind==='event' && state.session.operation==='edit' && !state.session.eventScope)state.jobs.push({id:'$scope',family:'scope',status:'queued',attempts:0,revision:state.revision});
  // A named saved place or order partner is also retrieval evidence. It never
  // selects a value, and the extractor still has to quote the instruction.
  for(const place of assistantFocusSettings().locations || []){
    const def=state.catalog.find(d=>d.id==='places');
    if(assistantFocusPhraseIn(text,place.name)&&state.spans.some(span=>assistantFocusPhraseIn(span.text,place.name)&&assistantFieldMentioned(def,span.text)&&assistantFieldRelevant(def,span.text)))assistantFieldEnqueue(state,'places','explicit');
  }
  const order=state.catalog.find(def=>def.id==='scheduleLinks');
  const orderSpans=state.spans.filter(span=>/\b(?:before|after)\b/i.test(span.text)
    && assistantFieldRelevant(order,span.text)
    && load().some(item=>item.hid!==state.session.targetId&&assistantFocusPhraseIn(span.text.slice(span.text.search(/\b(?:before|after)\b/i)),item.name)));
  if(orderSpans.length)assistantFieldEnqueue(state,'scheduleLinks','explicit',assistantFieldSource(order,text,orderSpans));
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
      const hits=candidates.filter(d=>assistantFieldMentioned(d,row.phrase)&&assistantFieldRelevant(d,row.phrase));
      if(hits.length)for(const def of hits)assistantFieldEnqueue(state,def.id,'discovery');
      else (state.coverageRequests ||= []).push(row);
    }
  }
}

// A new paraphrase need not match a keyword to request a setting. For an
// unrecognized discovered clause, select a field from its bounded family menu
// instead of running every sibling extractor. This selection supplies no value:
// the field still has to quote the original clause and pass its typed validator.
async function assistantFieldRoute(state,row,candidates,extract){
  if(assistantFieldCovered(state,row))return;
  const start=state.request.toLowerCase().indexOf(row.phrase.toLowerCase());
  if(start<0)return;
  const key=`${row.family}:${start}:${row.phrase.length}`;
  state.routed ||= new Set();if(state.routed.has(key))return;
  (state.coverageRequests ||= []).push(row);
  const context=assistantFieldClause(state,row.phrase);
  const defs=candidates.filter(def=>assistantFieldRelevant(def,context)&&assistantFieldRelevant(def,row.phrase));
  for(let offset=0;offset<defs.length;offset+=12){
    const menu=defs.slice(offset,offset+12);
    const call=await assistantFocusModel(state.session,{family:'field-routing',revision:state.revision,
      system:`${assistantFocusSystem(state.session)} Select the requested setting, or empty if none. ${menu.map(def=>`${def.id}: ${def.hint}`).join('; ')}`,
      request:assistantFocusRequestLine('field',row.phrase),
      tool:assistantFocusPackTool('field','Select one requested setting.',{field:{type:'string',enum:[...menu.map(def=>def.id),'']}},['field'])},extract);
    assistantFocusEnsure(state.session,state.revision);
    if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
    const def=menu.find(def=>def.id===call.args.field);
    if(!def)continue;
    const text=state.request.slice(start,start+row.phrase.length);
    const job=assistantFieldEnqueue(state,def.id,'semantic',[{start,end:start+text.length,text,context}]);
    if(job)job.semantic=true;
  }
  state.routed.add(key);
}

async function assistantFieldRetrieve(state, rank){
  const defs=state.catalog.filter(d=>assistantFieldApplicable(d,state.session));
  const queries=[...new Set([...assistantFieldContexts(state.request),...state.spans.map(s=>s.text)])];
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
  return /\b(?:earlier|previous(?:ly)?|original|first|last|same|that|again|mentioned|said|told|actually|instead)\b/i.test(text);
}

async function assistantFieldFollowup(state, priorFields, extract){
  if(priorFields.length!==1 || !assistantFieldReference(state.request))return null;
  const def=state.catalog.find(d=>d.id===priorFields[0]);
  if(!def || ASSISTANT_FIELD_LITERAL_VALUES.has(def.id))return null;
  // A bare scalar correction inherits the last setting. Explicit sibling
  // instructions in other clauses still route normally. Ownership retains the
  // original clause offsets, so a correction cannot hide a second instruction.
  const calendar=['dueDate','planByDate','appointmentStartDate','appointmentUntil','allowedWeekdays','preferredWeekdays','appointmentWeekdays'];
  const selected=[];state.referenceUnresolved=[];
  const priorEvidence=(state.session.fieldEvidence||[]).filter(row=>row.id===def.id&&row.span.requestIndex===state.session.requests.length-2).map(row=>row.span.text);
  const previous=priorEvidence.join('; ')||state.session.requests.at(-2)||'';
  for(const span of state.spans){
    const content=assistantFieldDialogue(span.text).text;
    if(!content || state.catalog.some(other=>other.id!==def.id && assistantFieldMentioned(other,content)
      && !(calendar.includes(def.id)&&calendar.includes(other.id))))continue;
    const candidates=[def,...state.catalog.filter(other=>other.id!==def.id&&assistantFieldMentioned(other,content)&&assistantFieldApplicable(other,state.session))];
    const labels=[...new Set(candidates.map(d=>d.label).concat('Another setting'))];
    if(previous.length>1800){state.referenceUnresolved.push(span);continue;}
    const spec={family:'reference',revision:state.revision,
      system:`${assistantFocusSystem(state.session)} Previous user evidence: ${previous}. Previously changed setting: ${def.label}. Identify which setting the current instruction refers to. A bare correction refers to the preceding setting; an explicit new setting takes precedence.`,
      request:assistantFocusRequestLine('field',span.text),
      tool:assistantFocusPackTool('field','Identify the setting referred to by the current instruction.',{field:{type:'string',enum:labels}},['field'])};
    let call;
    for(let attempt=0;attempt<2;attempt++){
      try{call=await assistantFocusModel(state.session,spec,extract);break;}
      catch(error){
        assistantFocusEnsure(state.session,state.revision);
        if(attempt || !/stopped unexpectedly|took too long|runtime failed|memory|allocation|out of bounds/i.test(String(error.message||error)))throw error;
        state.session.trace.push({family:'reference',error:String(error.message||error),attempt:attempt+1});
      }
    }
    if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
    // This model decision only owns an instruction's scope. Extraction must
    // still select original evidence, and validation still checks the value.
    const chosen=candidates.find(candidate=>candidate.label===call.args.field);
    if(chosen)selected.push({field:chosen.id,span});
    else state.referenceUnresolved.push(span);
  }
  const fields=new Set(selected.map(row=>row.field));
  if(fields.size===1)return {field:selected[0].field,spans:selected.map(row=>row.span)};
  state.referenceUnresolved.push(...selected.map(row=>row.span));
  return null;
}

function assistantFieldPrepare(state){
  const session=state.session,request=state.request,priorFields=state.priorFields;
  // Events have no priority control. Ask about the named unsupported setting
  // before a generic router can reinterpret it as a date or title request.
  if(assistantFocusEffectiveKind(session)==='event'){
    state.unavailableSpans=state.spans.filter(span=>ASSISTANT_FIELD_SIGNALS.priority.test(span.text)&&!assistantFieldLiteralOwner(span.text));
    if(state.unavailableSpans.length)assistantFocusUnresolve(session,{field:'priority',family:'identity',question:'Priority is available for habits and tasks, but not events.'});
  }
  if(state.referenceUnresolved?.length)assistantFocusUnresolve(session,{field:'request',family:'request',question:'Which setting should that correction change?'});
  assistantFieldCandidates(state);
  if(state.followup){
    const def=state.catalog.find(d=>d.id===state.followup.field);
    assistantFieldEnqueue(state,def.id,'reference',assistantFieldSource(def,request,state.followup.spans));
  }
  const explicitSibling=state.jobs.some(job=>job.request===request&&job.reason==='explicit'&&job.id!==priorFields[0]);
  if(assistantFieldReference(request)&&priorFields.length===1&&!explicitSibling)assistantFieldEnqueue(state,priorFields[0],'reference');
  // Bare replies to a field question still require model-selected evidence.
  const question=session.unresolved[0];
  const questionField=question&&state.catalog.find(def=>def.id===question.field||def.fields.includes(question.field));
  // A routing guess is not authority to rename an item on the next turn.
  // Even a genuine title question must not consume a later setting request.
  // Edit replies repeat the naming instruction; Create still accepts a title.
  const nameReply=session.operation==='create'||ASSISTANT_FIELD_SIGNALS.name.test(request);
  if(questionField&&(questionField.id!=='name'||nameReply))assistantFieldEnqueue(state,questionField.id,'explicit');
  state.jobs.unshift({id:'$discover',family:'families',status:'queued',attempts:0,revision:state.revision});
  state.jobs.splice(2,0,{id:'$retrieve',family:'retrieval',status:'queued',attempts:0,revision:state.revision});
  state.needsCandidates=false;
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
  conditionRadiusM:{min:1,max:100000,label:'meters',units:{meter:1,meters:1,metre:1,metres:1,m:1,kilometer:1000,kilometers:1000,kilometre:1000,kilometres:1000,km:1000}},
  earlyWindowDays:{min:0,max:60,label:'days',units:{day:1,days:1,week:7,weeks:7}},
  delayAllowanceDays:{min:0,max:60,label:'days',units:{day:1,days:1,week:7,weeks:7}},
  reminderTravelLead:{min:0,max:60,label:'minutes',units:{minute:1,minutes:1,min:1,mins:1,hour:60,hours:60,hr:60,hrs:60}},
  reminderStartLead:{min:0,max:60,label:'minutes',units:{minute:1,minutes:1,min:1,mins:1,hour:60,hours:60,hr:60,hrs:60}},
  reminderMissedLead:{min:0,max:60,label:'minutes',units:{minute:1,minutes:1,min:1,mins:1,hour:60,hours:60,hr:60,hrs:60}}
};

function assistantFieldQuantity(def, text){
  const limits=ASSISTANT_FIELD_QUANTITIES[def.id];
  const value=assistantParseQuantity(text,limits.units,limits.min,limits.max);
  if(/\b(?:not|never|don.t|without|or)\b/i.test(text) || value==null)return {ok:false,error:`Specify one value for ${def.label.toLowerCase()}, from ${limits.min} to ${limits.max} ${limits.label}.`};
  return {ok:true,value:String(value)};
}

function assistantFieldStripPrefix(text, pattern){
  // Setting labels and connectors are whole tokens. An optional "to", "as"
  // or "it" must not consume the beginning of the model-selected value.
  // Backtracking leaves a connector intact unless it ends at a token boundary.
  return text.replace(new RegExp(`(?:${pattern.source})(?:(?<=[\\s:])|(?=$|\\s|:))`,pattern.flags),'').trim();
}

function assistantFieldNormalize(def,text,session){
  if(!ASSISTANT_FIELD_LITERAL_VALUES.has(def.id))text=assistantEditTarget(text);
  if(['kind','habitKind'].includes(def.id)&&/\b(?:not|never|don.t|without|or)\b/i.test(text))return {ok:false,error:'Which item type should I use? Please state the type to change to.'};
  const fixedClock=assistantFieldFixedClock(text);
  if(fixedClock!=null){
    if(def.id==='allowedTimeFixedStart')return {ok:true,changes:[{field:def.id,op:'set',value:true}]};
    if(def.id==='allowedWindow')return {ok:true,changes:[{field:def.id,op:'set',value:{start:{kind:'clock',minutes:fixedClock,clock:assistantClockLabel(fixedClock)},end:{kind:'unset'}}}]};
    if(['dueTime','appointmentStartMinute'].includes(def.id))return {ok:true,changes:[{field:def.id,op:'set',value:fixedClock}]};
  }
  const instructionSource=session?._fieldSource||text,literal=assistantFieldLiteralOwner(instructionSource);
  if(literal?.id===def.id && /\b(?:do not|don.t|never)\s*$/i.test(instructionSource.slice(0,literal.instructionStart)))return {ok:false,error:`Should I keep ${def.label.toLowerCase()} unchanged, or change it?`};
  if(assistantFieldClear(def,text))return {ok:true,changes:[{field:def.id,op:'clear',value:null}]};
  const policy=def.id==='hardDue'?assistantFieldDeadlinePolicy(text):def.id==='anywhereAllowed'?assistantFieldAnywherePolicy(text):null;
  if(policy!=null)return policy==='conflict'?{ok:false,error:`Please clarify ${def.label.toLowerCase()}; the instruction contains conflicting choices.`}
    :{ok:true,changes:[{field:def.id,op:'set',value:policy}]};
  if(def.id==='allowedTimeFixedStart'&&assistantFieldStartPolicy(text)!=null){
    const policy=assistantFieldStartPolicy(text);
    return policy==='conflict'?{ok:false,error:'Should the start time be exact or flexible?'}:{ok:true,changes:[{field:def.id,op:'set',value:policy}]};
  }
  // Scope wording qualifies the same scalar; it is not a second value.
  if(['durationMinutes','exceptionDuration','dueTime','appointmentStartMinute','exceptionTime'].includes(def.id)){
    text=text.replace(/^(?:(?:for|just|only)\s+)?this(?: one)? (?:occurrence|date|time)(?: only)?\s*[:,]?\s*/i,'');
    text=assistantFieldDialogue(text).text;
  }
  if(def.id==='weatherRules'&&(/\bnot\s+(?:warmer|hotter|colder|cooler|above|below|over|under|at least|at most)\b/i.test(instructionSource)
    ||/\b(?:skip|avoid)\b[^,;]*\b(?:when|if)\b[^,;]*\b(?:temperature|warmer|hotter|colder|cooler)\b/i.test(instructionSource)))return {ok:false,error:'Describe the weather conditions when this item is allowed, such as temperature below 20 C.'};
  // Positive bounds and comparator operands contain "no" / "or" without
  // negating a restriction. All other negatives and alternatives still ask.
  let restrictionText=['allowedWindow','preferredWindow'].includes(def.id)
    ?text.replace(/\bno (?:later|earlier) than\b/gi,'').replace(/\b((?:later|earlier) of|whichever is (?:later|earlier):?)\s+(.+?)\s+or\s+/gi,'$1 $2 and '):text;
  if(['preferredWeekdays','preferredMonthDays','preferredOrdinalWeekdays'].includes(def.id)){
    restrictionText=restrictionText.replace(/\s+without restricting (?:the )?other days\b/gi,'');
    text=restrictionText;
  }
  if(['allowedWeekdays','allowedWindow'].includes(def.id)){
    restrictionText=restrictionText.replace(/^(?:do not|don['’]t) (?:schedule|place) (?:it|this) outside (?:the )?(.+)$/i,'$1');
    text=text.replace(/^(?:do not|don['’]t) (?:schedule|place) (?:it|this) outside (?:the )?(.+)$/i,'$1');
  }
  if(['allowedWeekdays','preferredWeekdays','appointmentWeekdays'].includes(def.id)){
    text=text.replace(/^(?:(?:set|change|use)\s+)?(?:(?:the|my)\s+)?(?:(?:allowed|preferred|repeat)\s+)?(?:weekdays|days of the week)\s+(?:to|as|is|should be)\s+/i,'');
    if(def.id==='appointmentWeekdays')text=text.replace(/^(?:repeat\s+)?weekly\s+(?:on\s+)?/i,'');
    if(def.id==='preferredWeekdays')text=text.replace(/^(?:i(?:'d| would) like (?:it|this) on|prefer(?:red|ably)?|favou?r|give)\s+/i,'')
      .replace(/\s+(?:if possible|work best(?:,? but other days are (?:fine|okay|allowed))?|higher scheduling preference)$/i,'');
    restrictionText=text;
  }
  if(['allowedWeekdays','preferredWeekdays','allowedMonthDays','preferredMonthDays'].includes(def.id)){
    const token=def.id.endsWith('Weekdays')?`(?:${ASSISTANT_WEEKDAY_TOKEN})s?`:`(?:${assistantOrdinalSource()}|${assistantIntegerSource()})`;
    restrictionText=restrictionText.replace(new RegExp(`\\b(${token})\\s+or\\s+(?=(?:the\\s+)?${token}\\b)`,'gi'),'$1 and ');
    text=restrictionText;
  }
  if(['allowedWeekdays','preferredWeekdays','appointmentWeekdays','frequency'].includes(def.id)&&assistantParseWeekdaySet(text))restrictionText='';
  if(['allowedWindow','preferredWindow','allowedWeekdays','preferredWeekdays','allowedMonthDays','preferredMonthDays','allowedOrdinalWeekdays','preferredOrdinalWeekdays','frequency','dueDate','dueTime','places','weatherProfile'].includes(def.id)
    && /\b(?:no|not|never|don.t|except|without|or)\b/i.test(restrictionText))return {ok:false,error:'Please clarify the positive restriction or clear this setting.'};
  if(!ASSISTANT_FIELD_LITERAL_VALUES.has(def.id))text=assistantFieldDialogue(text).text;
  if(!text)return {ok:false,error:`What value should I use for ${def.label||def.id}?`};
  const clearLabel=assistantFieldStripPrefix(text,/^clear(?:\s+the)?\s+/i);
  const clearCue=def.signal?.exec(clearLabel);
  if(assistantFocusField(def.id)?.clear && clearLabel!==text && (clearLabel.toLowerCase()===def.label.toLowerCase()
    || clearCue?.index===0&&clearCue[0].length===clearLabel.length))return {ok:true,changes:[{field:def.id,op:'clear',value:null}]};
  if(def.id==='frequency'){
    if(/\b(?:minus|negative)\b|[-+−]\s*\d/i.test(text))return {ok:false,error:'Specify one positive repetition count and period.'};
    const rhythm=assistantParseRhythm(text);
    if(!rhythm?.timesPerPeriod || !rhythm.periodDays)return {ok:false,error:'How often should it repeat?'};
    // On Edit, weekdays alone restrict availability; they must not silently
    // replace an existing frequency.
    if(session.operation==='edit' && !ASSISTANT_FIELD_SIGNALS.frequency.test(text))return {ok:false,error:'Specify a repetition count and period.'};
    return {ok:true,changes:[{field:'timesPerPeriod',op:'set',value:rhythm.timesPerPeriod},{field:'periodDays',op:'set',value:rhythm.periodDays}]};
  }
  let value=text;
  if(['allowedMonthDays','preferredMonthDays','allowedOrdinalWeekdays','preferredOrdinalWeekdays'].includes(def.id)){
    value=assistantFieldStripPrefix(value,/^my\s+(?=preferred\b)/i);
    value=assistantFieldStripPrefix(value,/^(?:restrict|limit)(?:\s+(?:it|this|that))?\s+to\s+/i);
    value=assistantFieldStripPrefix(value,/^(?:ideally|just)\s+/i).replace(/\s+(?:if possible|when possible)$/i,'');
    value=value.replace(/^prefer(?:red)?\s+(?:doing it\s+)?(?:on\s+)?/i,'').replace(/^i prefer doing it on\s+/i,'');
  }
  if(['preferredWindow','allowedWindow'].includes(def.id)){
    value=assistantFieldStripPrefix(value,/^(?:if possible\s*,?\s*)?(?:keep|fit)\s+(?:it|this)\s+/i);
    value=assistantFieldStripPrefix(value,/^within\s+/i).replace(/\s+only$/i,'');
  }
  if(def.id==='scheduleOptions' && /\bor\b/i.test(text))return {ok:false,error:'Please give each alternative separately with its time and place.'};
  if(def.id==='name')value=assistantFieldStripPrefix(text,/^(?:create|add)(?: a| an)? (?:habit|task|event)(?: (?:called|named|to))?\s+/i);
  if(def.id==='name')value=assistantFieldStripPrefix(value,/^from now on\s+(?=(?:call|rename|name)\b)/i);
  if(def.id==='name')value=assistantFieldStripPrefix(value,ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.prefix).replace(/^['"]|['"]$/g,'').trim();
  if(def.id==='name')value=assistantFieldStripPrefix(value,/^(?:remind me to|remember to|i (?:need|want) to)\s+/i);
  // A create title drops its verb and kind noun ("add a workout habit" is
  // Workout). Explicit called/named titles keep every literal word, and a
  // "make it …" reference is not a create title. When nothing remains but a
  // kind noun, keep the stripped value so the generic-title guard asks.
  if(def.id==='name' && session && session.operation==='create' && !ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.signal.test(session._fieldSource||'')){
    const headed=assistantFieldStripPrefix(value,/^(?:please\s+)?(?:create|add|make)\s+(?:(?:a|an|the)\s+)?(?!(?:it|this|that)\b)/i);
    if(headed!==value)value=headed.replace(/\s+(?:habit|task|event|reminder|limit)\s*$/i,'').trim();
  }
  if(def.id==='name' && assistantFieldLiteralOwner(session?._fieldSource||'')?.id!=='name'
    && /\b(?:\d+\s*(?:minutes?|hours?)|every (?:day|week|other)|daily|weekly)\b/i.test(value))return {ok:false,error:'Please give just the item title.'};
  if(def.id==='name' && (!value || !ASSISTANT_FIELD_TEXT_INSTRUCTIONS.name.signal.test(instructionSource)
    && /^(?:create|add|(?:new\s+)?(?:habit|task|event|reminder)|rename|name|it)$/i.test(value)))return {ok:false,error:'Name the item.'};
  if(def.id==='priority'){
    if(/\b(?:not|never|don.t|without|or)\b/i.test(value))return {ok:false,error:'Which priority should I use?'};
    value=assistantFieldStripPrefix(value,/^(?:(?:set|change|use)\s+)?priority(?:\s+(?:to|is))?\s*:?\s*/i);
    if(/^[+-]?\d/.test(value)&&!/^\d$/.test(value)||/^\d$/.test(value)&&Number(value)>5)return {ok:false,error:'Priority must be 0–5.'};
  }
  if(def.id==='conditionRadiusM')value=assistantFieldStripPrefix(text,/^(?:(?:set|change)\s+)?(?:radius(?: of)?|within)(?:\s+to)?\s+/i);
  if(['dueDate','planByDate','appointmentStartDate','appointmentUntil'].includes(def.id)){
    value=assistantFieldStripPrefix(text,/^(?:(?:change|set|move)\s+(?:(?:the|its)\s+)?)?(?:(?:plan(?:ned)?|do|finish(?:ed)?)(?: (?:this|it))? by|(?:plan|do)-by(?: date)?|plan (?:this |it )?for|due(?: date| day)?(?: on)?|deadline(?: date)?|on|by|until|through|start(?:s|ing)?(?: date| it)?(?: on| from)?|end (?:the )?series on|date)(?:\s+(?:to|on|is|should be))?\s*:?\s*/i);
    value=assistantFieldStripPrefix(value,/^(?:(?:set|use)\s+)?(?:(?:a|the)\s+)?(?:hard|strict|firm|soft|flexible)\s+(?:due date|deadline)(?:\s+(?:to|for|on))?\s+/i);
    value=assistantFieldStripPrefix(value,/^for\s+/i);
    if(['appointmentStartDate','appointmentUntil'].includes(def.id)){
      const conventional=value;
      value=assistantFieldDialogue(text).text;
      value=assistantFieldStripPrefix(value,/^(?:(?:set|change|move)\s+)?(?:the\s+)?(?:(?:event\s+)?series\s+|recurrence\s+)?(?:start (?:date|day)|end date|cutoff date|first date of the series|last date for repeats)(?:\s+(?:to|is|should be))?\s+(?:now\s+)?/i);
      value=assistantFieldStripPrefix(value,/^(?:(?:begin|start)(?:\s+repeating)?(?:\s+(?:the\s+)?(?:event\s+)?series)?\s+(?:on|from)|(?:the\s+)?series\s+(?:should\s+)?(?:begin\s+on|stop\s+after)|end\s+(?:the\s+)?(?:series|repeating schedule)\s+on)\s+/i);
      value=assistantFieldStripPrefix(value,/^(?:repeat\s+)?(?:until|through)\s+/i);
      value=value.replace(/^use\s+(.+?)\s+as\s+(?:the\s+)?series\s+(?:start|end)\s+date$/i,'$1');
      if(value===assistantFieldDialogue(text).text)value=conventional;
    }
    if(/\bweek\b/i.test(value)&&!/^next week$/i.test(value))return {ok:false,error:'Which exact date should I use? Please give a date such as 2027-01-07.'};
  }
  if(['dueTime','appointmentStartMinute','exceptionTime'].includes(def.id)){
    text=text.replace(/^(?:start|begin)\s+(?:(?:this|the|my)\s+)?(?:task|event|habit)\s+(?:at|to)\s+/i,'');
    value=assistantFieldStripPrefix(text,/^(?:(?:move|shift|set|change)\s+(?:(?:this|the|its|one)\s+)*(?:occurrence|date|start|time)(?:\s+(?:time|clock|to))?|(?:for\s+)?this(?:\s+one)?\s+(?:occurrence|date)(?:\s+only)?\s*[:,]?|occurrence|date|(?:at|start(?:s|ing)?(?:\s+(?:time|clock))?|time))(?:\s+(?:to|at|is|should (?:be|read)))?\s*:?\s*/i);
    value=assistantFieldStripPrefix(value,/^(?:move\s+it\s+to|to)\s+/i);
    value=value.replace(/\s+(?:instead|start(?: time)?)$/i,'').trim();
  }
  if(['emojiBgColor','exceptionColor'].includes(def.id))value=assistantFieldStripPrefix(text,/^(?:(?:use|set|change)\s+)?(?:(?:a|an|the)\s+)?(?:(?:emoji\s+)?(?:background(?:\s+colou?r)?|colou?r)\s*(?:to|as|:)?)?\s*/i).replace(/\s+for\s+(?:the\s+)?(?:card\s+)?background$/i,'').replace(/\s+(?:colou?r|background)$/i,'').trim();
  if(def.id==='topics'){
    value=assistantFieldStripPrefix(text,ASSISTANT_FIELD_TEXT_INSTRUCTIONS.topics.prefix).replace(/\s+(?:topic|tag)$/i,'');
    if(/\b(?:in|into|under)\s+the\b/i.test(instructionSource))value=value.replace(/^the\s+/i,'');
  }
  if(def.id==='topics')value=assistantFieldStripPrefix(value,/^(?:it|as|to)\s+/i);
  if(def.id==='topics' && (!value || /\p{Extended_Pictographic}|\b(?:minutes?|hours?|priority|emoji|tag it)\b/iu.test(value)))return {ok:false,error:'Name the requested topics.'};
  const booleans=['tapStartsSession','reminderDnd','pinned','breakable','trackValue','hardDue','anywhereAllowed','showWeather','showWeatherAtLocation','allowedTimeFixedStart'];
  if(booleans.includes(def.id) && assistantParseBool(value)==null){
    const polarity=value.replace(def.id==='reminderDnd'?/\bdo not disturb\b/gi:/$^/g,'DND').replace(/\bno (?:shorter|less) than\b/gi,'at least')
      .replace(def.id==='trackValue'?/\bcheck(?:ed|ing)? (?:it|this|that) off\b/gi:/$^/g,'');
    const negative=/\b(?:no|not|never|don.t|disable|off|unpin|unpinned|unbreakable|uninterrupted|continuous|hide)\b/i.test(polarity);
    const positive=def.signal?.test(value)||session._fieldSemantic&&/\b(?:enable|include|record|capture|show|allow|keep|use)\b/i.test(value);
    if(positive)value=negative?'false':'true';
    if(def.id==='breakable'&&/\b(?:does not|doesn['’]t|doesnt) need (?:one |an? )?(?:uninterrupted|continuous) session\b/i.test(text))value='true';
    if(def.id==='anywhereAllowed'&&/\bno (?:place|location) restrictions?\b/i.test(text))value='true';
  }
  // Convert only the model's quoted relative expression, using the baseline
  // duration supplied to this job; a relative edit never changes that baseline.
  if(def.id==='durationMinutes' && /^(?:twice as long|double (?:it|the duration))$/i.test(value))value=String((session._fieldBaseline||assistantFocusMaterialize(session)).durationMinutes*2);
  if(['places','weatherLocationId'].includes(def.id))value=assistantFieldStripPrefix(value,/^(?:(?:restrict|limit)(?:\s+(?:it|this|that))?\s+to\s+(?:the\s+)?|(?:(?:use|add|set|at|in|place|location|venue)(?: (?:the|to))?\s+)+)/i).replace(/\s+(?:as )?(?:the )?(?:place|location)$/i,'').trim();
  if(def.id==='weatherLocationId'&&/\b(?:show|display)\b[^,;]*\b(?:forecast|weather)\b[^,;]*\bplace\b/i.test(instructionSource))return {ok:false,error:'Should the forecast follow this item’s place, or use a separate weather location?'};
  if(def.id==='weatherProfile')value=assistantFieldStripPrefix(value,/^(?:(?:use|apply)\s+(?:the\s+)?|weather profile\s+|profile\s+)/i).replace(/\s+(?:weather profile|weather|profile)$/i,'').trim();
  if(def.id==='weatherLocationId'){
    value=assistantFieldStripPrefix(text,/^(?:(?:show|use|set)\s+(?:the\s+)?)?(?:weather\s+)?(?:forecast|weather)\s+(?:for|at|in)\s+/i);
    value=assistantFieldStripPrefix(value,/^use\s+(?:the\s+)?/i).replace(/\s+for\s+(?:the\s+)?(?:forecast|weather)$/i,'');
  }
  if(def.id==='locationPrefs')value=value.replace(/\s+works? best(?: for me)?$/i,'').replace(/^the\s+/i,'');
  if(def.id==='snoozedUntil'){
    value=assistantFieldStripPrefix(value,/^(?:snooze|hide|push)(?:\s+(?:it|this|that))?(?:\s+(?:task|habit|item))?(?:\s+back)?\s+(?:until|to|for)\s+/i);
    value=assistantFieldStripPrefix(value,/^(?:bring\s+(?:it|this|that)\s+back|put\s+(?:it|this|that)(?:\s+(?:task|habit|item))?\s+on\s+hold\s+until|(?:do not|don['’]t)\s+show\s+(?:it|this|that)(?:\s+again)?\s+until|pause\s+showing\s+(?:it|this|that)\s+until)\s+/i);
  }
  if(def.id==='appointmentStartDate')value=value.replace(/^(?:the\s+)?series\s+starts?\s+(?:on|from)\s+/i,'').replace(/\s+now$/i,'');
  if(def.id==='sharedDisplay'&&/\b(?:show|appear|visible|display)\b/i.test(text)&&!/\b(?:view|complete|mark|hidden|hide|off|not|never|don.t)\b/i.test(text)){
    // Showing an existing item preserves its current completion permission.
    value=assistantFocusMaterialize(session).allowSharedDisplayCompletion?'complete':'view';
  }
  if(ASSISTANT_FIELD_QUANTITIES[def.id]){
    const quantity=assistantFieldQuantity(def,text);if(!quantity.ok)return quantity;
    value=quantity.value;
  }
  if(!ASSISTANT_FIELD_LITERAL_VALUES.has(def.id))value=assistantFieldDialogue(value).text;
  if(!String(value).trim())return {ok:false,error:`What value should I use for ${def.label.toLowerCase()}?`};
  const lengthField=ASSISTANT_FIELD_LENGTHS.has(def.id);
  if(lengthField){
    if(def.id==='minChunkMinutes')value=value.replace(/^(?:do not|don['’]t) split (?:it|this) into pieces shorter than\s+/i,'at least ');
    const restriction=value.replace(/\bno (?:shorter|less) than\b/gi,'at least');
    if(/\b(?:no|not|never|don.t|without|except)\b/i.test(restriction))return {ok:false,error:'Specify the length to use, or explicitly clear this setting.'};
    if(/(?<!\w)[-+−]\s*(?:\d|[a-z])|\b(?:minus|negative|or)\b/i.test(value))return {ok:false,error:'Specify one non-negative length, including its unit.'};
    const normalized=assistantNormalizeDurationText(value),hits=assistantDurationHitsFromNormalized(normalized);
    const joined=hits.length===2 && hits[0].unit==='h' && hits[1].unit==='m'
      && /^[\s,]*(?:and[\s,]*)?$/.test(normalized.slice(hits[0].end,hits[1].index));
    if(hits.length>1&&!joined)return {ok:false,error:'There is more than one length in that instruction.'};
  }
  const parsed=assistantFocusNormalize(def.id,value,{...session,_fieldLiteral:literal?.id===def.id&&ASSISTANT_FIELD_LITERAL_VALUES.has(def.id)});
  const length=lengthField?assistantParseDuration(value):null;
  if(def.id==='autoMarkMinutes'&&parsed.ok&&parsed.op==='clear'&&!/\b(?:manual|off|none|clear|disable)\b/i.test(value))return {ok:false,error:'Specify a completion length, or choose manual completion.'};
  if(length!=null&&parsed.ok&&parsed.op==='set'&&parsed.value!==length)return {ok:false,error:`That length is outside the supported range for ${def.label.toLowerCase()}.`};
  return parsed.ok ? {ok:true,changes:[{field:def.id,...parsed}]} : parsed;
}

async function assistantFieldExtract(state,row,extract){
  const def=row.def,session=state.session;
  const normalizeContext={...session,_fieldBaseline:row.baseline,_fieldSemantic:row.semantic===true};
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
      system:`${assistantFocusSystem(session)} Read only ${def.label}: ${def.hint} Leave empty when the excerpt does not request this setting. ${referenceOnly?`Copy exact words from the selected earlier user evidence. Current instruction: ${span.context||span.text}. Do not extract the reference wording itself.`:history.context}`,
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
      if(selected.request===row.request && !row.semantic && !['name','frequency','durationMinutes','dueDate','dueTime','appointmentStartDate','appointmentStartMinute','places','weatherProfile'].includes(def.id) && !assistantFieldMentioned(def,selectedEvidence) && !session.unresolved.some(issue=>issue.field===def.id))continue;
      if(def.id==='kind' && !ASSISTANT_FIELD_SIGNALS.kind.test(selectedEvidence))continue;
      if(def.id==='name' && (session.operation==='edit'||assistantFocusMaterialize(session).name) && !ASSISTANT_FIELD_SIGNALS.name.test(selectedEvidence))continue;
      if(!assistantFieldRelevant(def,selectedEvidence))continue;
      if(def.id==='places'&&!assistantFieldMentioned(def,selectedEvidence)&&!session.unresolved.some(issue=>issue.field==='places'))continue;

      if(def.id==='preferredWeekdays' || def.id==='preferredWindow' || def.id==='preferredMonthDays' || def.id==='preferredOrdinalWeekdays'){
        if(!assistantFieldPreference(selectedEvidence))continue;
      }
      const parsed=assistantFieldNormalize(def,text,{...normalizeContext,_fieldSource:selectedEvidence});
      if(!parsed.ok)invalid.push(parsed);
      if(parsed.ok)values.push({changes:parsed.changes,source:text,span:selected,instructionSpan:span,uncertain:call.confidence==null||call.confidence<0.7||Boolean(call.raw.suppressed_calls?.includes(result))});
    }
  }
  const unique=values.filter((v,i)=>!values.slice(0,i).some(other=>JSON.stringify(v.changes)===JSON.stringify(other.changes)));
  // One readable excerpt must not hide another unreadable instruction for
  // the same requested setting. Keep the question until every part validates.
  if((row.required||row.semantic)&&invalid.length)return {status:'needs_input',...invalid[0]};
  if(unique.length>1)return {status:'needs_input',error:`I found conflicting values for ${def.label.toLowerCase()}. Which should I use?`};
  if(unique.length)return {status:'extracted',...unique[0]};
  if(history.ambiguous)return {status:'needs_input',error:`Which earlier value for ${def.label.toLowerCase()} should I use? Please repeat it or specify the first or last value.`};
  const choices=invalid.find(result=>result.choices?.length);
  if(choices)return {status:'needs_input',error:choices.error,choices:choices.choices};
  if(row.required&&invalid.length)return {status:'needs_input',error:invalid[0].error};
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
  // Discovery can add a grounded semantic nomination while an embedding-only
  // read is in flight. Discard that earlier result and read the exact clause;
  // a completed decline must not swallow a later required instruction.
  if(row.refreshSpans){row.spans=row.refreshSpans;row.refreshSpans=null;row.result=null;row.status='queued';return;}
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
      const hits=defs.filter(d=>assistantFieldMentioned(d,row.phrase)&&assistantFieldRelevant(d,row.phrase));
      const targets=hits.length?hits:defs;
      // Discovery of a group is not proof that each sibling was requested.
      // Keep a coverage obligation for the original phrase, instead of making
      // every field in an uncertain group a required extraction.
      (state.coverageRequests ||= []).push(row);
      if(!hits.length)continue;
      for(const def of targets){
        const existing=state.jobs.find(j=>j.id===def.id&&j.request===state.request);
        if(!existing)assistantFieldEnqueue(state,def.id,hits.length?'coverage':'discovery');
      }
    }
  }
}

// Account for source clauses, not the family's routing label. A guessed group
// cannot create a second obligation for an instruction already read correctly.
function assistantFieldClause(state,phrase){
  const start=state.request.toLowerCase().indexOf(phrase.toLowerCase());
  return state.spans.find(span=>span.start<=start&&span.end>=start+phrase.length)?.text||phrase;
}

function assistantFieldCovered(state,row){
  if((state.unavailableSpans||[]).some(span=>assistantFocusPhraseIn(span.text,row.phrase)))return true;
  const context=assistantFieldClause(state,row.phrase);
  const defs=state.catalog.filter(def=>assistantFieldApplicable(def,state.session)
    &&assistantFieldMentioned(def,context)&&assistantFieldRelevant(def,context)
    &&state.jobs.some(job=>job.id===def.id&&job.request===state.request&&job.required));
  const jobs=state.jobs.filter(job=>job.request===state.request&&(job.proposal&&job.status==='staged'||job.preserved));
  const covers=job=>[job.source,job.proposal?.instructionSpan?.text,job.proposal?.instructionSpan?.context,...(job.preserved?job.spans.map(span=>span.context||span.text):[])]
    .some(source=>source&&(assistantFocusPhraseIn(row.phrase,source)||assistantFocusPhraseIn(source,row.phrase)));
  return defs.length?defs.every(def=>jobs.some(job=>job.id===def.id&&covers(job))):jobs.some(covers);
}

async function assistantFieldFallback(state,extract,opts){
  // Finish explicit/embedding reads before routing unknown clauses. Otherwise
  // a speculative sibling can block an ordinary, already understood edit.
  const pending=[...(state.coverageRequests||[])];
  for(const span of state.spans){
    const phrase=span.text;
    if(/^(?:hi|hello|hey|thanks|thank you|please|okay|ok|um|actually|instead)[.!?]*$/i.test(phrase)
      ||/^(?:I(?:'m| am) editing (?:this|the) item|everything else (?:should )?stay(?:s)? (?:as it is|the same)|(?:keep|leave) (?:everything|anything) else (?:unchanged|as is|alone))[.!?]*$/i.test(phrase))continue;
    if(!pending.some(row=>assistantFocusPhraseIn(row.phrase,phrase)))pending.push({phrase});
  }
  for(const row of pending){
    if(assistantFieldCovered(state,row))continue;
    // A declared but invalid setting already has a precise question. Never
    // reinterpret that value through a different field's permissive parser.
    if(state.jobs.some(job=>job.required&&job.status==='needs_input'&&job.spans?.some(span=>
      assistantFocusPhraseIn(row.phrase,span.context||span.text)||assistantFocusPhraseIn(span.context||span.text,row.phrase))))continue;
    let family=row.family;
    if(!family){
      const families=[...new Set(state.catalog.filter(def=>assistantFieldApplicable(def,state.session)&&assistantFieldRelevant(def,row.phrase)).map(def=>def.family))];
      const call=await assistantFocusModel(state.session,{family:'family-routing',revision:state.revision,
        system:`Select the setting group requested by this clause. Choose conversation only for background or thanks without an edit; empty means the instruction is unclear. ${families.map(id=>`${id}: ${ASSISTANT_FOCUS_GROUP_HINTS[id]}`).join('; ')}`,
        request:assistantFocusRequestLine('family',row.phrase),tool:assistantFocusPackTool('family','Select a setting group.',{family:{type:'string',enum:[...families,'conversation','']}},['family'])},extract);
      assistantFocusEnsure(state.session,state.revision);
      if(call.raw._needleIssue)throw new Error(call.raw._needleIssue);
      if(call.args.family==='conversation')continue;
      family=families.includes(call.args.family)?call.args.family:null;
    }
    if(!family){
      assistantFocusUnresolve(state.session,{field:'request',family:'request',question:`Which setting should change in “${row.phrase}”?`});
      continue;
    }
    const nomination={family,phrase:row.phrase};
    await assistantFieldRoute(state,nomination,state.catalog.filter(def=>def.family===family&&assistantFieldApplicable(def,state.session)),extract);
    await assistantFieldSchedule(state,extract,opts);
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
            else if(job.id==='$fallback'){await assistantFieldFallback(state,extract,opts);job.status='staged';}
            else {const result=await assistantFieldExtract(state,job,extract);assistantFieldMerge(state,job,result);}
            break;
          }catch(error){
            assistantFocusEnsure(state.session,state.revision);
            job.error=String(error.message||error);
            state.session.trace.push({family:job.family,jobId:job.id,error:job.error,attempt:job.attempts});
            // A deterministic decoding error needs new wording, not an
            // unbounded Continue loop over the identical source/schema.
            if(/malformed function_calls JSON/i.test(job.error)||error instanceof SyntaxError){
              const required=job.required||job.id.startsWith('$');
              job.status=required?'needs_input':'not_mentioned';
              if(required)assistantFocusUnresolve(state.session,{field:job.def?.id||'request',family:job.def?.family||'request',question:job.def?`Please rephrase ${job.def.label.toLowerCase()}; I couldn’t read that wording reliably.`:'Please rephrase the request; I couldn’t read all its settings reliably.'});
              break;
            }
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
    state={request,revision:session.requestRevision,catalog:assistantFieldCatalog(),spans:assistantFieldSpans(request),jobs:unfinished,priorFields,needsCandidates:true};
    Object.defineProperty(state,'session',{value:session});
    unfinished.forEach(j=>{j.revision=state.revision;});
    session._fieldState=state;session.jobs=state.jobs;session.trace=session.trace||[];
    state.coverage=false;
  }else if(state){
    state.jobs.filter(j=>j.status==='retryable_failed').forEach(j=>{j.status='queued';});
  }
  if(!state)return {type:'focus',empty:true};
  const started=performance.now();
  session.continuationError='';
  try{
    if(state.needsCandidates){
      state.followup=await assistantFieldFollowup(state,state.priorFields,extract);
      assistantFocusEnsure(session,state.revision);
      assistantFieldPrepare(state);
    }
    await assistantFieldSchedule(state,extract,opts);
    if(!state.coverage && !state.jobs.some(j=>j.status==='retryable_failed')){
      state.jobs.push({id:'$coverage',family:'completeness',status:'queued',attempts:0,revision:state.revision});state.coverage=true;
      await assistantFieldSchedule(state,extract,opts);
    }
    if(!state.fallback&&!state.jobs.some(j=>j.status==='retryable_failed')){
      state.jobs.push({id:'$fallback',family:'routing',status:'queued',attempts:0,revision:state.revision});state.fallback=true;
      await assistantFieldSchedule(state,extract,opts);
    }
    assistantFocusEnsure(session,state.revision);
    const retryPending=state.jobs.some(job=>job.status==='retryable_failed');
    for(const row of retryPending?[]:state.coverageRequests||[]){
      const covered=assistantFieldCovered(state,row);
      if(!covered&&!session.unresolved.some(issue=>issue.family===row.family)){
        const nominees=state.jobs.filter(job=>job.def&&job.request===state.request&&job.family===row.family
          &&job.spans.some(span=>assistantFocusPhraseIn(row.phrase,span.context||span.text)||assistantFocusPhraseIn(span.context||span.text,row.phrase)));
        let nominee=nominees.length===1?nominees[0]:null;
        if(nominee?.id==='name'&&!ASSISTANT_FIELD_SIGNALS.name.test(assistantFieldClause(state,row.phrase)))nominee=null;
        // An unfulfilled, singly nominated instruction asks about that field.
        // Its question survives unrelated follow-ups and accepts a bare reply.
        assistantFocusUnresolve(session,{field:nominee?.id==='frequency'?'timesPerPeriod':nominee?.id||'request',family:nominee?.family||'request',question:`I still need to account for “${row.phrase}”. Please clarify that setting.`});
      }
    }
    if(retryPending)session.continuationError='Your draft is kept. Continue to retry the unfinished settings.';
    const change=id=>session.changes.find(c=>c.field===id);
    const proposed=id=>state.jobs.some(j=>j.id===id&&j.request===state.request&&j.proposal);
    if(proposed('weatherRules') && proposed('weatherProfile'))assistantFocusUnresolve(session,{field:'weatherRules',family:'weather',question:'Use the saved weather profile or custom weather rules? Please choose one.',choices:[{id:'use-profile',label:'saved profile'},{id:'use-rules',label:'custom rules'}]});
    if(proposed('hardDue') && proposed('delayAllowanceDays') && change('hardDue')?.value===true && change('delayAllowanceDays')?.value>0)assistantFocusUnresolve(session,{field:'hardDue',family:'dates',question:'Should this be a hard deadline or allow a delay?',choices:[{id:'hard-deadline',label:'hard deadline'},{id:'allow-delay',label:'allow delay'}]});
    assistantFocusFinishScope(session);
    for(const issue of assistantFocusDraftIssues(session)){
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
