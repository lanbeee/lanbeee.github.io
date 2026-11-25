// Focused-session question answering. Deterministic only: every answer is
// built from app data, the current draft, or the small explanation table
// below. A question never stages a change, writes storage, resolves a
// clarification, or consumes a model pass — ordinary edits keep their exact
// existing path (assistantFocusRunFieldTurn), and a polite edit phrased as a
// question ("Could you set it to 20 minutes?") still routes to the edit
// pipeline because of the edit-signal guard.

const ASSISTANT_FOCUS_CAPABILITY_INTRO =
  'I mainly help you edit this item. You can also ask about its settings, history, or how to use Tings.';
const ASSISTANT_FOCUS_EXAMPLES =
  'For example: “make it 20 minutes”, “only on weekdays”, “remind me at the start”, or “when did I last complete this?”.';

// Conservative edit-intent guard. Anything matching this goes to the normal
// extraction pipeline; punctuation alone never decides.
function assistantFocusEditSignal(text){
  const request = String(text || '');
  if(!request)return false;
  const value = /\b(?:\d|mon(?:day)?|tues?(?:day)?|wed(?:nesday|s)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|am\b|pm\b|noon|midnight|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|p[0-5]\b|anywhere|home|work|errands?|off\b|on\b)/i;
  const verb = /\b(?:set|change|make|switch|turn|move|keep|rename|convert|reset|clear|remove|drop|delete|add|include|exclude|tag|mark|restrict|limit)\b/i;
  const politeEdit = /^(?:(?:hi|hey|hello)[,!]?\s+)?(?:please\s+)?(?:can|could|would|will)\s+(?:you|u|we)\s+(?:please\s+)?(?:set|change|make|switch|turn|move|keep|rename|convert|reset|clear|remove|drop|delete|add|include|exclude|tag|mark|restrict|limit|assign|file|block|offer)\b/i;
  const imperative = /^(?:please\s+)?(?:also\s+|then\s+|and\s+)*(?:set|change|make|switch|turn|move|keep|rename|convert|reset|clear|remove|drop|delete|add|include|exclude|tag|mark|restrict|limit)\b/i;
  // An explicit "to <value>" clause after an edit verb is decisive even when
  // framed mid-sentence ("What's the duration, and can you change it to 20 minutes?").
  const verbToValue = /\b(?:set|change|make|switch|move|turn|keep|convert|reset)\b[^.!?;]{0,40}?\bto\b[^.!?;]{0,32}?(?:\b\w)/i;
  if(politeEdit.test(request))return true;
  if(imperative.test(request))return true;
  if(verb.test(request) && value.test(request) && verbToValue.test(request))return true;
  return false;
}

// History questions ("Did I log it today?") must win over the log/plan action
// cues, which otherwise match the same verbs.
function assistantFocusHistoryIntent(text){
  const request = String(text || '').toLowerCase();
  if(/\b(?:how many times|how often did i|how many (?:days|streaks))\b/.test(request)
    || /\bdid i\b.{0,40}\b(?:times|this week|last week)\b/.test(request)){
    const period = request.match(/\b(?:today|yesterday|(?:this|last) (?:week|month))\b/)?.[0];
    const window = request.match(/\b(?:past|last) (\d+) days?\b/)?.[1];
    return {kind:'history', which:'count', period, window:window ? Number(window) : null};
  }
  if(/\b(?:when|what) (?:did|was) i last\b/.test(request)
    || /\blast time i\b/.test(request)
    || /\bwhen did i (?:log|do|complete|finish|check)\b/.test(request))return {kind:'history', which:'last'};
  if(/\b(?:did|have) i\b/.test(request) && /\b(?:log|do|complete|finish|check off|check)\b/.test(request)){
    if(/\btoday\b/.test(request))return {kind:'history', which:'today'};
    if(/\byesterday\b/.test(request))return {kind:'history', which:'day', offset:-1};
    return {kind:'history', which:'last'};
  }
  if(/\b(?:have|has) (?:i|it) (?:been )?(?:logged|done|completed)\b/.test(request) && /\btoday\b/.test(request))
    return {kind:'history', which:'today'};
  return null;
}

// Pending-edit state questions. Checked before the undo action cue so
// "Can I undo it?" explains instead of starting an action.
function assistantFocusStateIntent(text){
  const request = String(text || '').toLowerCase();
  if(/\bwhat did i (?:ask|tell|say)\b/.test(request)
    || /\bwhat (?:did|have) you (?:change|stage)/.test(request)
    || /\bwhat(?:'s| is) staged\b/.test(request)
    || /\bwhat(?:'s| is) pending\b/.test(request))return {kind:'state', which:'staged'};
  if(/\bdid you (?:already )?(?:save|apply)\b/.test(request)
    || /\bwas (?:that|it|this) saved\b/.test(request)
    || /\bis (?:that|it|this) saved\b/.test(request)
    || /\bhave you saved\b/.test(request))return {kind:'state', which:'saved'};
  if(/\bwhat happens if i (?:tap|press|hit|click) save\b/.test(request)
    || /\bwhat does save do\b/.test(request))return {kind:'state', which:'saveEffect'};
  if(/^(?:can|could|may) i undo\b/.test(request)
    || /^how (?:do|can) i undo\b/.test(request)
    || /^how (?:do|can) i revert\b/.test(request))return {kind:'state', which:'undo'};
  return null;
}

// The maintained app-explanation set. Patterns are specific on purpose; the
// wording matches what the UI actually does (verified controls).
const ASSISTANT_FOCUS_EXPLAIN = [
  {id:'anywhere', re:/\bwhat does anywhere mean\b|\banywhere\b[^.?!]{0,12}\bmean\b|\bwhat(?:'s| is|s) (?:the )?anywhere\b/i, text:()=>
    'Anywhere lets this happen away from its saved places too. When it is off, it can only happen at the saved places.'},
  {id:'preferredPlace', re:/\b(?:what(?:'s| is|s) a|what does) (?:preferred (?:place|location)|place preference|prefer\w* (?:place|location))\b|\bpreferred (?:place|location)s?\b[^.?!]{0,12}\bmean\b/i, text:()=>
    'A preferred place is ranked higher when the planner fits the day: it picks preferred places first, then the rest. Preferences never remove a place.'},
  {id:'dueVsPlan', re:/\b(?:difference|differ) between.{0,30}(?:due|plan)|\bis the due date the same as\b|\bdue date\b[^.?!]{0,24}\b(?:one-day|day plan|one day plan)\b|\b(?:one-day|day) plan\b[^.?!]{0,24}\bdue\b/i, text:()=>
    'A due date is the deadline a task must be done by (a habit’s do-by date is the soft version). A one-day plan just puts it on one specific day’s agenda; it does not set a deadline.'},
  {id:'capability', re:/\bwhat can you do\b|\bwhat can i (?:ask|do here)\b|\bwho are you\b|\bwhat are you\b|\bwhat do you do\b|\bwhat(?:'s| is) this (?:chat|box) for\b/i, text:()=>
    `${ASSISTANT_FOCUS_CAPABILITY_INTRO} ${ASSISTANT_FOCUS_EXAMPLES}`},
  {id:'examples', re:/\b(?:give|show|got) (?:me )?(?:an example|examples?|some examples)\b|\bcan you give me an example\b/i, text:()=>
    `Try: ${ASSISTANT_FOCUS_EXAMPLES}`},
  {id:'otherItem', re:/\b(?:can you|could you|will you)\b.{0,20}\b(?:another|different|other|second) (?:habit|task|item|one)\b|\bedit (?:another|a different) (?:habit|task|item)\b/i, text:()=>
    'This chat only changes the item it was opened from. Open that other item and ask there — its Summary has the same assistant.'},
  {id:'offline', re:/\boffline\b|\bwithout (?:the )?internet\b|\binternet (?:needed|connection)\b|\b(?:need|use) (?:a )?(?:wifi|wi-fi|data|network)\b|\bon[- ]device\b/i, text:()=>
    'Yes. Needle runs on this device after you download it once (Settings → assistant download), so editing and these answers work without a connection.'},
  {id:'didSave', re:/\bdid you (?:already )?save\b|\bwas (?:that|it|this) saved\b/i, text:session=>
    session.savedResult
      ? 'Yes — that save went through. If it was just now, the toast at the bottom has an undo button for it.'
      : session.changes.length
        ? 'Your proposed changes are waiting for you to tap Save.'
        : 'There’s no edit waiting to be saved. Summary shows this item’s current saved settings.'},
  {id:'undo', re:/^(?:can|could|may) i undo\b|^how (?:do|can) i undo\b|^how (?:do|can) i revert\b/i, text:()=>
    'Yes. Right after this chat saves or logs something, the toast at the bottom shows an undo button that reverses exactly that change.'},
  {id:'saveEffect', re:/\bwhat happens if i (?:tap|press|hit|click) save\b|\bwhat does save do\b/i, text:session=>{
    const rows = (session.changes || []).map(change => {
      const field = assistantFocusField(assistantFocusScopedField(change.field, session));
      const before = assistantFocusFormatValue(change.field, session.operation === 'edit' ? session.source : assistantFocusBlank(session), session);
      const after = assistantFocusFormatValue(change.field, assistantFocusMaterialize(session), session, true);
      return `${field && field.label || change.field}: ${before} → ${after}`;
    });
    return rows.length
      ? `Save writes the staged values to this item: ${rows.join('; ')}. Questions never save anything.`
      : 'Save writes the staged values to this item. Right now nothing is staged, so a question has nothing to save.';
  }},
  {id:'staged', re:/\bwhat did i (?:ask|tell|say)\b|\bwhat (?:did|have) you (?:change|stage)/i, text:session=>{
    const rows = (session.changes || []).map(change => {
      const field = assistantFocusField(assistantFocusScopedField(change.field, session));
      const after = assistantFocusFormatValue(change.field, assistantFocusMaterialize(session), session, true);
      return `${field && field.label || change.field} → ${after}`;
    });
    if(session.savedResult)return 'That earlier request was already saved. Nothing else is staged right now.';
    return rows.length
      ? `You asked for: ${rows.join('; ')}. Nothing is saved until you tap Save.`
      : 'Nothing yet — no change is staged from your requests so far.';
  }},
  {id:'quickStart', re:/\b(?:replay|see|watch|start|find|where(?:'s| is))?.{0,6}\bquick start\b|\breplay the (?:intro|tour|coach)\b/i, text:()=>
    'Open the About sheet from the top of Settings and tap “quick start” to replay the intro tour.'},
  {id:'addFirst', re:/\bhow do i add\b|\badd (?:my|a|the) (?:first |new )?(?:habit|task|item)\b|\bwhere (?:do i|can i) (?:add|create) (?:a|my|new)/i, text:()=>
    'Tap the add button on the home list, give it a name, and pick the essentials. It saves right away and opens its details — where this assistant can finish the rest.'},
  {id:'habitVsTask', re:/\b(?:difference|differ) between.{0,40}\b(?:habit|task|event)\b|\bwhat(?:'s| is|s) the difference between (?:a )?(?:habit|task|event)\b|\bhabit(?:,)? task(?:,)? (?:and|or) event\b/i, text:()=>
    'A habit repeats on a rhythm you keep up. A task is one-off with a due date. An event sits at a fixed time, on one date or a weekly series.'},
  {id:'whatIsTings', re:/\bwhat is tings (?:for|about)\b|\bwhat does tings do\b|\bwhat(?:'s| is|s) tings\b/i, text:()=>
    'Tings is a day planner for habits, tasks, and events: it fits what you need into your real free time. Private by default — everything stays on this device.'},
  {id:'swipe', re:/\bswipe\b.{0,40}\b(?:left|right|card)\b|\b(?:left|right) swipe\b|\bswiping\b/i, text:()=>
    'On a home card, swipe right for actions: start a session, plan or log, history (and ask AI). Swipe left for visibility: snooze or show, pin, quiet reminders, remove.'},
  {id:'settingsNav', re:/\b(?:where (?:are|do i find|can i find|do i change)|how do i change) (?:the )?app settings\b|\bapp settings\b|\bwhere(?:'s| is) (?:the )?settings\b/i, text:()=>
    'The Settings tab holds app-wide options. For this item’s own settings, use the search box here on the Summary tab, or just ask me.'},
  {id:'searchVsAsk', re:/\b(?:when|should i) (?:to )?use (?:search|the search|ask|the assistant)\b|\bsearch or ask\b|\bsearch vs\b/i, text:()=>
    'Use Search to open a setting’s controls. Describe a change here to get an edit you can review and save.'},
  {id:'editFromSummary', re:/^how (?:do|can) i (?:change|edit|update) (?:a |an |the |this )?(?:setting|item|habit|task|event)\b/i, text:()=>
    'Tap a setting on Summary to open its controls, or use Search to find it. You can also tell me what to change here, then review and save the proposal.'},
  {id:'editAnother', re:/\b(?:can|could) (?:you|this chat) (?:be used to )?edit (?:another|a different|other) (?:habit|task|item)\b/i, text:()=>
    'No — this chat stays on the item it was opened from. Open the other item and ask there.'},
  {id:'plannerWhy', re:/\bwhy (?:isn[’'t]+|is not|isnt|wasn[’'t]+|was not|wasnt|didn[’'t]+|did not|didnt)\b.{0,60}\b(?:schedul|plan|shown|appear|come up|fit)|\bwhy (?:didn[’'t]+|did not|didnt) (?:it|this|the planner)\b.{0,40}\b(?:schedul|plan|show|appear|fit)/i,
    text:null} // built from live evidence in assistantFocusQuestionAnswer
];

// Item-field reads. Ordered most-specific first; each entry is guarded by the
// field's own applicability so a task question never answers with habit data.
const ASSISTANT_FOCUS_FIELD_READS = [
  ['appointmentStartMinute', /\b(?:what|which) time\b.{0,24}\b(?:start|begin|begins)\b|\bstart time\b/i],
  ['durationMinutes', /\bhow (?:long|much time)\b|\bduration\b|\bsession length\b|\bhow many minutes\b|\bhow long (?:does|is|it)\b/i],
  ['allowedWeekdays', /\b(?:which|what) days\b|\b(?:which|what) weekdays?\b|\bdays of the week\b|\bon which days\b|\bset for\b/i],
  ['allowedWindow', /\b(?:which|what) (?:times?|hours?|window)\b|\btime of day\b|\bhours (?:is it|can it)\b/i],
  ['allowedTimeFixedStart', /\b(?:is the |is it a |a )?start (?:time )?(?:fixed|exact|pinned)\b|\bfixed start\b/i],
  ['timesPerPeriod', /\bhow often\b|\bhow frequently\b|\bhow many times (?:a|per|an|each)\b|\bfrequency\b/i],
  ['dueTime', /\bwhat time\b.{0,24}\b(?:due|deadline)\b|\bdue time\b/i],
  ['earlyWindowDays', /\bhow early\b|\b(?:how many )?days early\b|\bearly window\b|\bcan it (?:start|be planned) early\b/i],
  ['delayAllowanceDays', /\bhow late\b|\b(?:how many )?days late\b|\bdelay allowance\b|\bgrace period\b|\bhow many days after\b/i],
  ['hardDue', /\b(?:due (?:date|deadline) (?:is|hard|firm|strict)|hard (?:deadline|due))\b/i],
  ['dueDate', /\bwhen is it due\b|\bwhat(?:'s| is) the due\b|\bdue date\b|\bdeadline\b|\bwhen(?:'s| is) (?:it|this) due\b/i],
  ['planByDate', /\b(?:do|done|finish|plan) by\b|\bplan[- ]by\b/i],
  ['places', /\bwhere\b|\bwhich (?:places?|locations?)\b|\bwhat locations?\b/i],
  ['autoCompleteOnVisit', /\b(?:mark done on visit|visit completion|auto.?complete on visit)\b/i],
  ['anywhereAllowed', /\banywhere\b/i],
  ['locationPrefs', /\b(?:place|location) (?:preferences?|ranking|order|preference)/i],
  ['topics', /\btopics?\b|\btags?\b/i],
  ['reminderDnd', /\bdnd\b|\bdo not disturb\b/i],
  ['reminderSound', /\b(?:notification|alert) (?:sound|tone)\b|\bringtone\b|\b(?:sound|tone|chime)\b/i],
  ['reminderStart', /\b(?:is there a )?reminder\b|\bnotifications?\b|\balert(?:s| me)?\b|\balarm\b/i],
  ['priority', /\bpriority\b|\bwhich p[0-5]\b|\bwhat p[0-5]\b/i],
  ['pinned', /\bpinned?\b/i],
  ['snoozedUntil', /\bsnooz/i],
  ['repeatMode', /\brepeat mode\b|\b(?:routine|opportunity)\b/i],
  ['conditionTrigger', /\b(?:trigger|condition)\b/i],
  ['conditionRadiusM', /\b(?:how close|radius|distance)\b/i],
  ['breakable', /\b(?:split|break)(?:ting|table)?\b.{0,20}\bsessions?\b|\bsplitting\b/i],
  ['minChunkMinutes', /\bchunk\b/i],
  ['minGapMinutes', /\bgap\b|\bbetween sessions\b/i],
  ['timerAutoStopMinutes', /\btimer\b/i],
  ['autoMarkMinutes', /\bauto(?:matic|ally)?\b.{0,16}\b(?:mark|complete|completion)\b/i],
  ['trackValue', /\b(?:track|record|log) (?:a )?(?:value|weight|number|reading)\b/i],
  ['tapStartsSession', /\btap\b.{0,20}\b(?:start|session)\b|\bstart with a tap\b/i],
  ['emoji', /\bemoji\b|\bicon\b/i],
  ['emojiBgColor', /\b(?:colou?r|background)\b/i],
  ['scheduleLinks', /\b(?:what|which) (?:comes|runs|goes|happens) (?:first|next|before|after)\b|\bordered? (?:after|relative to)\b.{0,24}\b(?:other|another|each)\b|\b(?:does|do) .{0,24}\b(?:come|go) (?:before|after)\b/i],
  ['links', /\b(?:links?|url|website|web page)\b/i],
  ['sharedDisplay', /\bshared display\b/i],
  ['weatherProfile', /\bweather profile\b/i],
  ['weatherRules', /\bweather rules?\b/i],
  ['showWeather', /\b(?:show|hide|see) (?:the )?forecast\b|\bforecast (?:shown|visible)\b/i],
  ['weatherLocationId', /\bforecast (?:place|location)\b/i],
  ['scheduleOptions', /\b(?:alternatives?|alternate times?)\b/i],
  ['appointmentWeekdays', /\b(?:which|what) (?:days|weekdays)\b.{0,20}\b(?:repeat|event)\b/i],
  ['appointmentRepeat', /\b(?:how|what) (?:often|frequency).{0,20}\bevent\b|\b(?:does|is) this event repeat/i],
  ['appointmentUntil', /\b(?:until|end date)\b.{0,20}\bevent\b|\bevent (?:repeat )?(?:end|until)\b/i],
  ['name', /\b(?:what(?:'s| is|s) (?:its|this|the) name|what is it called|what(?:'s| is) it called)\b/i],
  ['kind', /\bis (?:this|it) a (?:habit|task|event)\b|\bhabit or task\b/i]
];

function assistantFocusFieldIntent(text, session){
  const request = String(text || '');
  // Reads only fire on lookup-shaped openings ("What's the duration?", "Is
  // there a reminder?"). Imperative wordings that happen to name a field —
  // "Do Not Disturb during session", "Do this at LocationA only" — are edits
  // and must reach the normal pipeline, so "do/does/can" openings never read.
  if(!/^(?:what|whats|whens|when|where|which|who|whose|why|how|is|are|was|were|am)\b/i.test(request))return null;
  const eventRhythm = session.kind === 'event' && /^how often\b/i.test(request);
  const matches = eventRhythm ? [] : assistantFocusFieldHelpMatches(request, session);
  if(matches.length){
    const pick = assistantFocusFieldHelpPick(matches);
    if(pick.entry)return pick.entry.applies
      ? {kind:'field', field:pick.entry.ids[0]}
      : {kind:'fieldNA', entry:pick.entry};
    return {kind:'fieldAmbiguous', labels:pick.ambiguous};
  }
  for(const [fieldId, pattern] of ASSISTANT_FOCUS_FIELD_READS){
    if(!pattern.test(request))continue;
    const field = assistantFocusField(fieldId);
    if(!field || !assistantFocusFieldApplies(field, assistantFocusHelpContext(session)))continue;
    return {kind:'field', field:fieldId};
  }
  return null;
}

// ---- field-aware help -----------------------------------------------------
// One help entry per setting lives in ASSISTANT_GUIDE_HELP (fields file):
// [description, example, detail]. Questions match a field by its exact label
// or a small deliberate alias set below. Broad search words ("time", "days",
// "location") are aliases nowhere — alone they can never select an answer.
// The matcher builds lazily on the first question-shaped request, so ordinary
// edits pay only for the existing question check.

const ASSISTANT_FIELD_QUESTION_ALIASES = {
  earlyWindowDays:['early window', 'early allowance', 'days early'],
  delayAllowanceDays:['delay allowance', 'late allowance', 'grace period', 'days late', 'late days'],
  hardDue:['hard deadline', 'firm deadline', 'strict deadline', 'hard due date', 'soft deadline', 'flexible due date', 'firm due date'],
  allowedTimeFixedStart:['fixed start or time window', 'fixed start time', 'fixed start', 'exact start', 'time kind'],
  allowedWindow:['allowed hours', 'allowed time window', 'time window', 'time of day'],
  allowedWeekdays:['allowed days', 'allowed weekdays'],
  preferredWeekdays:['preferred days', 'preferred weekdays', 'best days'],
  allowedMonthDays:['allowed month days', 'allowed dates', 'days of the month'],
  preferredMonthDays:['preferred month days', 'preferred dates'],
  allowedOrdinalWeekdays:['allowed monthly weekdays'],
  preferredOrdinalWeekdays:['preferred monthly weekdays'],
  preferredWindow:['preferred hours', 'preferred time window'],
  durationMinutes:['duration', 'session length', 'how long a session is'],
  breakable:['splitting', 'split sessions', 'breakable', 'chunks'],
  minChunkMinutes:['minimum chunk', 'shortest session', 'chunk length', 'minimum chunk size'],
  minGapMinutes:['minimum gap', 'gap between sessions', 'spacing between sessions'],
  timerAutoStopMinutes:['timer target', 'timer auto stop', 'session target'],
  autoMarkMinutes:['automatic completion', 'auto mark', 'auto completion'],
  tapStartsSession:['start with a tap', 'tap to start'],
  trackValue:['value tracking', 'track a value', 'log a value'],
  places:['places', 'allowed places', 'saved places', 'locations'],
  autoCompleteOnVisit:['mark done on visit', 'visit completion', 'auto complete on visit'],
  anywhereAllowed:['anywhere'],
  locationPrefs:['place preferences', 'preferred places', 'place ranking'],
  weatherProfile:['weather profile', 'weather guidance'],
  weatherRules:['weather rules', 'weather conditions'],
  showWeather:['show forecast', 'show weather'],
  showWeatherAtLocation:['forecast at the place', 'forecast at the activity place', 'use this item’s place for weather'],
  weatherLocationId:['forecast place', 'forecast location', 'anywhere forecast'],
  scheduleOptions:['schedule alternatives', 'alternatives', 'time and place options', 'add a time and place option'],
  scheduleLinks:['order links', 'item order', 'before or after', 'schedule order'],
  topics:['topics', 'tags'],
  pinned:['pinned', 'pin'],
  snoozedUntil:['snooze', 'snoozed until', 'hide until'],
  sharedDisplay:['shared display'],
  links:['links', 'add link or call'],
  name:['name', 'title'],
  kind:['habit or task'],
  habitKind:['build limit or stop', 'habit kind', 'build limit stop'],
  emojiBgColor:['emoji background'],
  priority:['priority', 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'importance'],
  repeatMode:['routine or opportunity', 'repeat mode', 'opportunity', 'routine'],
  conditionTrigger:['trigger', 'weather or location trigger'],
  conditionRadiusM:['radius', 'proximity radius'],
  dueDate:['due date', 'deadline'],
  dueTime:['due time', 'task start time'],
  planByDate:['do-by date', 'do by date', 'plan by date', 'finish by date'],
  appointmentRepeat:['event repeat', 'repeats for an event'],
  appointmentStartDate:['event start date'],
  appointmentWeekdays:['repeat weekdays'],
  appointmentUntil:['event end date'],
  appointmentStartMinute:['event start time', 'start time'],
  exceptionTime:['time on this date'],
  exceptionDuration:['duration on this date'],
  exceptionEmoji:['emoji on this date'],
  exceptionColor:['color on this date'],
  exceptionCancelled:['this date', 'skip this date'],
  exceptionReset:['use the usual values'],
  reminderDnd:['do not disturb', 'dnd', 'silence my phone'],
  reminderSound:['notification sound', 'reminder sound', 'ringtone'],
  reminderStart:['start reminder'],
  reminderStartLead:['event lead', 'start reminder lead'],
  reminderEnd:['end reminder'],
  reminderSecond:['second reminder', 'second event reminder'],
  reminderSecondLead:['second event lead'],
  reminderDue:['due-date reminder', 'due date reminder', 'deadline reminder'],
  reminderDueDays:['due-date reminder day', 'deadline reminder day'],
  reminderDueTime:['due-date reminder time', 'deadline reminder time'],
  reminderTravelStart:['departure reminder', 'travel reminder', 'leave reminder'],
  reminderTravelEnd:['arrival reminder'],
  reminderTravelLead:['departure lead'],
  reminderMissed:['drop warning', 'missed reminder'],
  reminderMissedLead:['drop-warning lead'],
  reminderReset:['usual reminders']
};

// Alternate labels for the same setting fold into one canonical entry, so
// "frequency", "times per period" and "rhythm" are one help entry.
const ASSISTANT_FIELD_QUESTION_ROWS = [
  ...ASSISTANT_FOCUS_FIELDS.filter(field => field.id !== 'periodDays').map(field => ({
    ids:[field.id], label:field.label, aliases:ASSISTANT_FIELD_QUESTION_ALIASES[field.id] || []
  })),
  {ids:['timesPerPeriod','periodDays'], label:'Frequency',
    aliases:['frequency', 'how often', 'times per period', 'period length', 'rhythm', 'how often it repeats', 'times per cycle', 'cycle days', 'repeat limit', 'cycle']}
];

let ASSISTANT_FIELD_HELP_MATCHERS = null;

function assistantFocusFieldQuestionMatchers(){
  if(ASSISTANT_FIELD_HELP_MATCHERS)return ASSISTANT_FIELD_HELP_MATCHERS;
  const escape = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  ASSISTANT_FIELD_HELP_MATCHERS = ASSISTANT_FIELD_QUESTION_ROWS.map(row => {
    const labelRe = new RegExp(`(?:^|[^a-z0-9])(?:${escape(row.label)})(?=$|[^a-z0-9])`, 'i');
    const aliasRe = row.aliases.length
      ? new RegExp(`(?:^|[^a-z0-9])(?:${row.aliases.map(escape).join('|')})(?=$|[^a-z0-9])`, 'i') : null;
    return {ids:row.ids, label:row.label, labelRe, aliasRe};
  });
  return ASSISTANT_FIELD_HELP_MATCHERS;
}

// Alternate labels of one setting ("Times per period" vs "Frequency") fold
// back into the same entry, so a question never splits it in two.
function assistantFocusFieldHelpMatches(request, session){
  const text = String(request || '');
  const subject = text.trim().replace(/^(?:what(?:['’]s|\s+(?:is|are|does|do))|explain|describe|tell me about)\s+(?:(?:the|my|its|this item’s)\s+)?/i, '')
    .replace(/(?:\s+(?:mean|show|do))?[?!.]+$/i, '').trim();
  const found = [];
  for(const row of assistantFocusFieldQuestionMatchers()){
    const score = row.labelRe.test(text) ? 2 : (row.aliasRe && row.aliasRe.test(text) ? 1 : 0);
    if(!score)continue;
    const exact = subject && (row.labelRe.exec(subject)?.[0] === subject || row.aliasRe?.exec(subject)?.[0] === subject);
    const rank = exact ? score + 2 : score;
    const existing = found.find(other => other.ids[0] === row.ids[0]);
    if(existing){
      if(rank > existing.score)existing.label = row.label;
      existing.score = Math.max(existing.score, rank);
      continue;
    }
    found.push({ids:row.ids, label:row.label, score:rank, applies:assistantFocusFieldHelpApplies(row.ids, session)});
  }
  return found.sort((a, b) => b.score - a.score || b.label.length - a.label.length || a.label.localeCompare(b.label));
}

function assistantFocusHelpContext(session, record = assistantFocusQuestionRecord(session)){
  const ctxRecord = record || (typeof assistantFocusBaseline === 'function' && session.operation === 'create'
    ? assistantFocusBaseline(session) : null);
  return typeof assistantFocusState === 'function' ? assistantFocusState(session, ctxRecord) : session;
}

function assistantFocusFieldHelpApplies(ids, session){
  if(ids[0] === 'frequency')return typeof assistantFocusEffectiveKind === 'function' && assistantFocusEffectiveKind(session) === 'habit';
  const field = assistantFocusField(ids[0]);
  if(!field)return true;
  const record = assistantFocusQuestionRecord(session);
  if(field.id === 'conditionRadiusM' && record?.conditionTrigger !== 'location')return false;
  return assistantFocusFieldApplies(field, assistantFocusHelpContext(session, record));
}

// "Flexibility" spans both day settings on purpose: a question about overall
// flexibility explains the day allowances, and a question about a flexible
// start time explains Fixed start vs Allowed time window.
function assistantFocusFlexibilityIntent(text){
  if(!/\bflexib\w*/i.test(text))return null;
  if(/\b(?:due date|deadline|hard|soft)\b/i.test(text))return null;
  if(/\b(?:start|time|clock|hours|window)\b/i.test(text))return {kind:'timeFlex'};
  return {kind:'flexibility'};
}

// Prefer the match that applies to this item, and an exact label match over a
// looser alias hit ("hard deadline" names Hard deadline even though it also
// contains the Due date alias "deadline"). Remaining ties on one shared label
// ("Start time" exists for tasks and events) merge into a combined entry so
// the answer covers both instead of picking arbitrarily.
function assistantFocusFieldHelpPick(matches){
  const best = matches[0].score;
  const strongest = matches.filter(row => row.score === best);
  const applied = strongest.filter(row => row.applies);
  let top = applied.length ? applied : strongest;
  if(top.length > 1){
    // A strictly longer label that contains a shorter one is the more
    // specific name: "Time on this date" beats the generic "This date".
    const specific = top.filter(row => !top.some(other => other !== row
      && other.label.toLowerCase().includes(row.label.toLowerCase())
      && other.label.length > row.label.length));
    if(specific.length)top = specific;
  }
  if(top.length === 1)return {entry:top[0]};
  const byLabel = [];
  for(const row of top){
    const existing = byLabel.find(other => other.label === row.label);
    if(existing)existing.rows.push(row);
    else byLabel.push({label:row.label, rows:[row]});
  }
  if(byLabel.length === 1){
    const group = byLabel[0];
    if(group.rows.length === 1)return {entry:group.rows[0]};
    return {entry:{ids:group.rows.map(row => row.ids[0]), label:group.label,
      score:Math.max(...group.rows.map(row => row.score)), applies:false}};
  }
  return {ambiguous:byLabel.slice(0, 3).map(row => row.label)};
}

// Two phases: "early" (flexibility, how-to-change) runs before the app
// explanation table so a question naming one setting wins over the generic
// "how do I change a setting" entry; "late" (compare, definition) runs after
// it so curated entries like the habit-vs-task comparison keep precedence.
function assistantFocusFieldHelpIntent(request, session, phase){
  const text = String(request || '').trim();
  if(phase !== 'late'){
    const flexible = assistantFocusFlexibilityIntent(text);
    if(flexible)return flexible;
    if(/^how\s+(?:(?:do|can|should) i\s+|to\s+)(?:change|edit|update|set|adjust|configure|find)\b/i.test(text)){
      const matches = assistantFocusFieldHelpMatches(text, session);
      if(!matches.length)return null;
      const pick = assistantFocusFieldHelpPick(matches);
      return pick.entry ? {kind:'howChange', entry:pick.entry} : {kind:'helpAmbiguous', labels:pick.ambiguous};
    }
    if(phase === 'early')return null;
  }
  if(/\b(?:difference|differ|vs\.?|versus|compare|comparing)\b/i.test(text)){
    const matches = assistantFocusFieldHelpMatches(text, session);
    if(matches.length >= 2)return {kind:'compare', a:matches[0], b:matches[1]};
  }
  if(/\b(?:mean|means|meant|explain\w*|tell me about|describe)\b/i.test(text)
    || /^what (?:does|do)\s+.+\s+(?:do|show)[?!.]*$/i.test(text)
    || /\bwhat(?:'s| is| are)\b[^.?!]{0,50}\bfor\b/i.test(text)
    || /\bhow does\b[^.?!]{0,40}\bwork\b/i.test(text)){
    const matches = assistantFocusFieldHelpMatches(text, session);
    if(!matches.length)return null;
    const pick = assistantFocusFieldHelpPick(matches);
    return pick.entry ? {kind:'definition', entry:pick.entry} : {kind:'helpAmbiguous', labels:pick.ambiguous};
  }
  return null;
}

function assistantFocusPlanIntent(text){
  const request = String(text || '').toLowerCase();
  if(/\b(?:when|what(?:'s| is)) (?:is|it) (?:this|it)? ?(?:next )?planned\b|\bnext planned\b|\bnext (?:one-day )?plan\b/.test(request))
    return {kind:'plan', which:'next'};
  if(/\b(?:is|am i|will) (?:this|it|that)? ?(?:be )?planned (?:for|on|in)\b/.test(request)
    || /\b(?:on|in) (?:the|my) (?:plan|agenda|schedule)\b/.test(request) && /\?$/.test(request)
    || /\bis (?:this|it) (?:on|in) (?:tomorrow|today)/.test(request))
    return {kind:'plan', which:'day'};
  return null;
}

// Full intent classification for a single request or clause. Returns null
// when the text is not a pure question (statement, edit, or action).
function assistantFocusQuestionIntent(text, session){
  const request = String(text || '').trim();
  if(!request)return null;
  const shaped = /\?\s*$/.test(request) || /^(?:what|whats|whens|when|where|which|who|whose|why|how|is|are|was|were|does|do|did|can|could|should|would|will|has|have|am|explain|describe|tell me about)\b/i.test(request)
    || /\bwhat does\b.{0,40}\bmean\b/i.test(request);
  if(!shaped)return null;
  if(assistantFocusEditSignal(request))return null;
  const history = assistantFocusHistoryIntent(request);
  if(history)return history;
  const state = assistantFocusStateIntent(request);
  if(state)return state;
  const action = typeof assistantActionCue === 'function' && assistantActionCue(request);
  if(action && !/^(?:what|how|where|explain|describe|tell me about)\b/i.test(request))return null;
  // Field-named how-to-change and flexibility wordings beat the app table.
  const earlyHelp = assistantFocusFieldHelpIntent(request, session, 'early');
  if(earlyHelp)return earlyHelp;
  for(const entry of ASSISTANT_FOCUS_EXPLAIN){
    if(entry.id === 'anywhere' && /\banywhere forecast\b/i.test(request))continue;
    if(entry.re.test(request))return {kind:'help', id:entry.id};
  }
  // Field help: definitions and comparisons. Runs before the quantity guard
  // so a question may name values ("difference between 2 days early and
  // 1 day late") — the edit-signal guard above already sent real offers down
  // the edit pipeline.
  const help = assistantFocusFieldHelpIntent(request, session, 'late');
  if(help)return help;
  // A concrete quantity is a value being offered, not a question ("What
  // about 30 minutes?" after a staged 20). Reading questions keep their own
  // patterns ("how long", "how many minutes") above.
  if(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|an?)\s*(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?|reps?|times)\b/i.test(request)
    && !/^(?:how|when|where|which|who|why|did|do|does|is|are|was|were|have|has)\b/i.test(request))return null;
  if(/\b\d+(?:\.\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?)\b/i.test(request))return null;
  const plan = assistantFocusPlanIntent(request);
  if(plan)return plan;
  if(assistantFocusFieldHelpMatches(request,session).some(row=>row.ids[0] === 'autoCompleteOnVisit')){
    const visitField = assistantFocusFieldIntent(request,session);
    if(visitField)return visitField;
  }
  if(action)return null;
  const field = assistantFocusFieldIntent(request, session);
  if(field)return field;
  // Unrecognized polite requests still need the normal edit parser.
  if(/^(?:(?:hi|hey|hello)[,!]?\s+)?(?:please\s+)?(?:can|could|would|will)\s+(?:you|u|we)\b/i.test(request))return null;
  if(/^(?:what|when|where|which|who|whose|why|how|is|are|was|were|does|did|has|have|am)\b/i.test(request))
    return {kind:'unknown'};
  return null;
}

// The mixed path: one request that stages an edit and also asks. Runs per
// clause after the normal pipeline has done its work. Returns the matched
// intent plus the clause that asked it, so the host can retire exactly that
// clause's uncovered-phrase question.
function assistantFocusMixedQuestion(request, session){
  const text = String(request || '').trim();
  if(!text)return null;
  const clauses = text.split(/(?:[;]|\n+|\s+and(?: then)?\s+|\s+then\s+)+/i)
    .map(part => part.trim()).filter(part => part.length > 2);
  for(const clause of clauses){
    const intent = assistantFocusQuestionIntent(clause, session);
    if(intent && intent.kind !== 'unknown')return {intent, clause};
  }
  return null;
}

function assistantFocusQuestionRecord(session){
  return (typeof assistantFocusLive === 'function' && assistantFocusLive(session)) || session.source || null;
}

function assistantFocusSavedValueAnswer(fieldId, session){
  const record = assistantFocusQuestionRecord(session);
  const base = record || assistantFocusBlank(session);
  const scopedField = assistantFocusScopedField(fieldId, session);
  const changed = new Set((session.changes || []).map(change => assistantFocusScopedField(change.field, session)));
  const related = {
    hardDue:['dueDate', 'delayAllowanceDays'],
    delayAllowanceDays:['hardDue'],
    timesPerPeriod:['periodDays', 'repeatMode'],
    periodDays:['timesPerPeriod', 'repeatMode'],
    allowedTimeFixedStart:['allowedWindow'],
    allowedWindow:['allowedTimeFixedStart']
  };
  const preview = changed.has(scopedField) || related[fieldId]?.some(id => changed.has(id))
    ? assistantFocusMaterialize(session) : null;
  const field = assistantFocusField(scopedField);
  const label = field && field.label ? field.label.toLowerCase() : fieldId;
  const isReminder = String(fieldId).startsWith('reminder');
  if(isReminder && !(typeof window !== 'undefined' && window.TingsNative && window.TingsNative.isNative)){
    return 'Phone reminders are part of the mobile app, so this browser view doesn’t set them. Everything else still edits here.';
  }
  const format = (item, staged) => {
    if(fieldId === 'hardDue' && !item.dueDate)return 'no due date';
    if(fieldId === 'weatherProfile' || fieldId === 'scheduleLinks')return assistantFocusSummaryText(fieldId, item, session);
    if(fieldId === 'timesPerPeriod' || fieldId === 'periodDays'){
      if(isOpportunityHabit(item)){
        const days = opportunityGapDays(item);
        return `at most once every ${days} day${days === 1 ? '' : 's'} when conditions match`;
      }
      return assistantFocusRhythmText(item) || 'not set';
    }
    return assistantFocusFormatValue(fieldId, item, session, staged);
  };
  const savedText = format(base, false);
  const saved = savedText && savedText !== '—' && savedText !== 'none' ? savedText : 'not set';
  const draftPrefix = session.operation === 'create' ? 'Planned for the new item: ' : '';
  if(preview && (fieldId === 'earlyWindowDays' || fieldId === 'delayAllowanceDays')){
    const readDays = fieldId === 'earlyWindowDays' ? habitEarlyWindowDays : habitDelayAllowanceDays;
    return `${draftPrefix}Saved: ${assistantFocusDayAllowanceSentence(fieldId, readDays(base))} Staged for this save: ${assistantFocusDayAllowanceSentence(fieldId, readDays(preview))} Saving still applies the staged value.`;
  }
  if(preview){
    const stagedText = format(preview, true);
    return `${draftPrefix}Saved: ${saved}. Staged for this save: ${stagedText}. Saving still applies the staged value.`;
  }
  if(fieldId === 'earlyWindowDays' || fieldId === 'delayAllowanceDays'){
    const days = fieldId === 'earlyWindowDays' ? habitEarlyWindowDays(base) : habitDelayAllowanceDays(base);
    const kind = typeof assistantFocusEffectiveKind === 'function' ? assistantFocusEffectiveKind(session) : 'habit';
    const noDue = kind === 'task' && base.dueDate == null
      ? ' This task has no due date yet, so there is no deadline to be early or late against.' : '';
    return `${draftPrefix}${assistantFocusDayAllowanceSentence(fieldId, days)}${noDue}`;
  }
  if(fieldId === 'allowedTimeFixedStart')return `${draftPrefix}The start rule: ${saved}.`;
  if(fieldId === 'durationMinutes')return `${draftPrefix}It's set to ${saved}.`;
  if(fieldId === 'timesPerPeriod' || fieldId === 'periodDays'){
    if(isOpportunityHabit(base))return `It can run ${saved}.`;
    const rhythm = saved === 'not set' ? '' : saved;
    return rhythm ? `${draftPrefix}It repeats ${rhythm}.` : `${draftPrefix}No repeat rhythm is set yet.`;
  }
  if(fieldId === 'allowedWeekdays')return saved === 'not set' ? 'No specific days — any day works.' : `${draftPrefix}It's set for ${saved}.`;
  if(fieldId === 'places')return saved === 'not set' ? 'No saved places — it can happen anywhere.' : `${draftPrefix}It's set for ${saved}.`;
  if(fieldId === 'anywhereAllowed')return `${draftPrefix}${saved}.`;
  if(fieldId === 'dueDate' || fieldId === 'planByDate'){
    const friendly = typeof assistantFocusSummaryText === 'function' && record
      ? assistantFocusSummaryText(fieldId, record, session) : '';
    const shown = friendly && friendly !== 'not set' && friendly !== 'none' ? friendly : saved;
    return saved === 'not set' || saved === 'none' ? `No ${label} yet.` : `${draftPrefix}Due ${shown}.`;
  }
  if(fieldId === 'topics')return saved === 'not set' ? 'No topics picked.' : `Topics: ${saved}.`;
  if(fieldId === 'reminderStart')return saved === 'off' ? 'No reminder is set.' : `Reminder: ${saved}.`;
  if(fieldId === 'priority')return `Priority ${saved}.`;
  return `${draftPrefix}${saved.charAt(0).toUpperCase()}${saved.slice(1)}.`;
}

function assistantFocusHistoryAnswer(intent, session){
  const record = assistantFocusQuestionRecord(session);
  if(!record)return 'Open the item to see its history.';
  const logs = typeof actualLogs === 'function' ? actualLogs(record.logs || []) : [];
  if(intent.which === 'today'){
    const today = typeof dateKey === 'function' ? dateKey(Date.now()) : '';
    const todays = logs.filter(ts => dateKey(ts) === today);
    if(!todays.length)return 'Not yet today.';
    return todays.length > 1 ? `Yes — ${todays.length} completions today.` : 'Yes — logged today.';
  }
  if(intent.which === 'count'){
    const now = new Date();
    let count = logs.length;
    let label = 'total';
    if(intent.period === 'today' || intent.period === 'yesterday'){
      const key = dateKey(offsetCalendarDay(now, intent.period === 'yesterday' ? -1 : 0));
      count = logs.filter(ts => dateKey(ts) === key).length;
      label = intent.period;
    }else if(intent.period){
      const previous = intent.period.startsWith('last');
      const month = intent.period.endsWith('month');
      const weekday = (now.getDay() + 6) % 7;
      const start = month ? new Date(now.getFullYear(), now.getMonth() - Number(previous), 1).getTime()
        : offsetCalendarDay(now, -weekday - (previous ? 7 : 0));
      const end = month ? new Date(now.getFullYear(), now.getMonth() + Number(!previous), 1).getTime()
        : offsetCalendarDay(start, 7);
      count = logs.filter(ts => ts >= start && ts < end).length;
      label = intent.period;
    }else if(intent.window > 0){
      const start = offsetCalendarDay(now, 1 - intent.window);
      count = logs.filter(ts => ts >= start).length;
      label = `in the last ${intent.window} days`;
    }
    return count ? `${count} completion${count === 1 ? '' : 's'} ${label}.` : `No completions ${label}.`;
  }
  if(intent.which === 'day'){
    const target = dateKey(offsetCalendarDay(Date.now(), intent.offset));
    const thatDay = logs.filter(ts => dateKey(ts) === target);
    return thatDay.length ? `Yes — logged ${intent.offset < 0 ? 'yesterday' : 'that day'}.` : `Not ${intent.offset < 0 ? 'yesterday' : 'that day'}.`;
  }
  if(!logs.length)return 'You haven’t logged this yet.';
  const last = logs[logs.length - 1];
  const when = typeof entryWhen === 'function' ? entryWhen(last) : '';
  const day = new Date(last).toLocaleDateString(undefined, {month:'short', day:'numeric'});
  return `Last completed ${when} (${day}).`;
}

function assistantFocusPlanAnswer(intent, session, request){
  const record = assistantFocusQuestionRecord(session);
  if(!record)return 'Open the item to see its plans.';
  if(intent.which === 'next'){
    const next = typeof nextPlannedLog === 'function' ? nextPlannedLog(record) : null;
    if(!next)return 'No upcoming plan.';
    const day = new Date(next).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
    const clock = new Date(next).getHours() || new Date(next).getMinutes()
      ? `, around ${new Date(next).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'})}` : '';
    return `Next planned: ${day}${clock}.`;
  }
  const phrases = typeof assistantActionDatePhrases === 'function' ? assistantActionDatePhrases(request) : [];
  let target = null;
  for(const phrase of phrases){
    const parsed = typeof assistantParseActionDate === 'function' ? assistantParseActionDate(phrase, Date.now(), 'plan') : null;
    if(parsed != null){target = parsed;break;}
  }
  if(target == null){
    if(/\btomorrow\b/i.test(request))target = offsetCalendarDay(Date.now(), 1);
    else if(/\btoday\b/i.test(request))target = dayStart(Date.now());
  }
  if(target == null)return 'Tell me which day — for example “planned for tomorrow?”.';
  const key = dateKey(target);
  const plan = typeof planLogForDay === 'function' ? planLogForDay(record, key) : null;
  const label = new Date(target).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
  if(!plan)return `Not planned for ${label}.`;
  if(planTimed(plan)){
    const clock = new Date(logTime(plan)).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    return `Planned for ${label} at ${clock}.`;
  }
  return `Planned for ${label}.`;
}

function assistantFocusPlannerWhyAnswer(session){
  const record = assistantFocusQuestionRecord(session);
  if(!record)return 'Open the item to check its schedule settings.';
  const now = Date.now();
  if(record.snoozedUntil && now < record.snoozedUntil){
    const until = new Date(record.snoozedUntil).toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric'});
    return `It's snoozed until ${until}, so it stays off the plan. Swipe left on its card and tap show to bring it back.`;
  }
  const dow = new Date(now).getDay();
  if((record.allowedWeekdays || []).length && !record.allowedWeekdays.includes(dow)){
    return `Today isn't one of its allowed days (${assistantFocusFormatValue('allowedWeekdays', record, session)}).`;
  }
  const dom = new Date(now).getDate();
  if((record.allowedMonthDays || []).length && !record.allowedMonthDays.includes(dom)){
    return `Today (the ${dom}) isn't in its allowed dates (${record.allowedMonthDays.join(', ')}).`;
  }
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(record)){
    const minute = new Date(now).getHours() * 60 + new Date(now).getMinutes();
    const start = typeof resolveHabitTimeField === 'function' ? resolveHabitTimeField(record, 'allowedTimeStart', dayStart(now)) : record.allowedTimeStart;
    const end = typeof resolveHabitTimeField === 'function' ? resolveHabitTimeField(record, 'allowedTimeEnd', dayStart(now)) : record.allowedTimeEnd;
    if(start != null && end != null && (minute < start || minute >= end)){
      return `Right now is outside its allowed hours (${assistantFocusFormatValue('allowedWindow', record, session)}). Check today's agenda for later slots.`;
    }
  }
  if(record.repeatMode === 'opportunity'){
    return `This habit is set to appear when its ${record.conditionTrigger === 'location' ? 'place condition' : 'weather condition'} matches. I can show you the rule, but I can’t verify why the planner left it out.`;
  }
  if(hasPlannedEntryForDay(record, dateKey(now)))return 'It is planned for today — check the agenda row.';
  return 'I can show you its schedule settings. I don’t have the planner’s reason for leaving it out.';
}

// ---- field-aware answers ---------------------------------------------------
// Definitions reuse the composer's help entry (one source per setting); reads
// use the live saved record plus the materialized preview for staged values.

function assistantFocusGuideText(id){
  const guideId = (id === 'timesPerPeriod' || id === 'periodDays') ? 'frequency' : id;
  const help = typeof ASSISTANT_GUIDE_HELP !== 'undefined' ? ASSISTANT_GUIDE_HELP[guideId] : null;
  return help ? {description:help[0] || '', example:help[1] || '', detail:help[2] || ''}
    : {description:'', example:'', detail:''};
}

function assistantFocusAvailabilityNote(entry, session){
  const id = entry.ids[0];
  if(entry.ids.length > 1){
    const kinds = [...new Set(entry.ids.flatMap(key => (assistantFocusField(key) || {kinds:[]}).kinds))];
    return `It applies to ${kinds.map(kind => `${kind}s`).join(' and ')} — each kind keeps its own copy of the setting.`;
  }
  if(id === 'frequency' || id === 'timesPerPeriod' || id === 'periodDays')
    return 'It applies only for habits — tasks are one-off.';
  const field = assistantFocusField(id);
  if(!field)return 'It does not apply to this item right now.';
  const state = assistantFocusHelpContext(session);
  const kind = state.kind || 'habit';
  const bits = [];
  if(!field.kinds.includes(kind))bits.push(`only for ${field.kinds.map(row => `${row}s`).join(' and ')}`);
  if(field.when === 'opportunity')bits.push('only for opportunity habits');
  if(id === 'conditionRadiusM')bits.push('only when the trigger is a place');
  if(field.when === 'routine')bits.push('only for routine habits');
  if(field.when === 'breakable')bits.push('only when Splitting is on');
  if(field.unless === 'zero')bits.push('not for stop habits');
  if(field.unless === 'opportunity')bits.push('not for opportunity habits');
  if(field.scope === 'occurrence')bits.push('only for a single date of a repeating event');
  if(field.family === 'reminders' && !(typeof window !== 'undefined' && window.TingsNative && window.TingsNative.isNative))
    bits.push('reminder controls live in the mobile app');
  if(!bits.length)return 'It does not apply to this item right now.';
  return `It applies ${bits.join(', and ')}.`;
}

function assistantFocusHelpDefinitionAnswer(entry, session){
  // A shared label whose owners are all out of scope here ("Start time" on a
  // habit) explains each owner instead of picking one arbitrarily.
  if(entry.applies === false && entry.ids.length > 1){
    const parts = entry.ids.map(key => {
      const guide = assistantFocusGuideText(key);
      const lead = guide.description || 'A setting of this item.';
      const field = assistantFocusField(key);
      const who = field ? field.kinds.map(kind => `${kind}s`).join(' and ') : '';
      return `${lead.charAt(0).toLowerCase()}${lead.slice(1).replace(/\.$/, '')} (for ${who})`;
    });
    return `${entry.label} — ${parts.join('; or ')}. It does not apply to this item right now.`;
  }
  const guide = assistantFocusGuideText(entry.ids[0]);
  if(entry.ids[0] === 'timesPerPeriod' && isOpportunityHabit(assistantFocusQuestionRecord(session))){
    return 'Repeat limit is the minimum number of calendar days between opportunities. When its weather or place condition matches, it can run after that gap. It can also wait longer.';
  }
  const lead = guide.description || 'A setting of this item.';
  const parts = [`${entry.label} — ${lead.charAt(0).toLowerCase()}${lead.slice(1)}`];
  if(guide.detail)parts.push(guide.detail);
  if(entry.applies === false)parts.push(assistantFocusAvailabilityNote(entry, session));
  return parts.join(' ');
}

function assistantFocusHowChangeAnswer(entry, session){
  const guide = assistantFocusGuideText(entry.ids[0]);
  const field = assistantFocusField(entry.ids[0]);
  const nativeOnly = field && field.family === 'reminders'
    && !(typeof window !== 'undefined' && window.TingsNative && window.TingsNative.isNative);
  if(nativeOnly)return `${entry.label} is set in the mobile app: open this item there and use its reminders section. On the phone you can also just tell me the change.`;
  const example = guide.example ? ` Or tell me the change — for example, “${guide.example}”.` : ' Or tell me the change here and review it before saving.';
  const availability = entry.applies === false ? ` ${assistantFocusAvailabilityNote(entry, session)}` : '';
  return `Tap “${entry.label}” on this item’s Summary to open its controls, or use Search.${availability}${example}`;
}

function assistantFocusCompareAnswer(a, b, session){
  const key = [a.ids[0], b.ids[0]].sort().join('|');
  const defA = assistantFocusHelpDefinitionAnswer(Object.assign({}, a, {applies:true}), session);
  const defB = assistantFocusHelpDefinitionAnswer(Object.assign({}, b, {applies:true}), session);
  const values = [a, b].filter(row => row.applies)
    .map(row => `${row.label}: ${assistantFocusSavedValueAnswer(row.ids[0], session)}`).join(' ');
  const head = {
    'delayAllowanceDays|earlyWindowDays':'They steer opposite ways — Early window moves days earlier, Delay allowance extends days later.',
    'allowedTimeFixedStart|allowedWindow':'A fixed start pins the clock; the window leaves the exact minute to the planner.',
    'allowedMonthDays|allowedWeekdays':'One limits the weekdays, the other the dates of the month.',
    'allowedWeekdays|preferredWeekdays':'Allowed days are hard gates; preferred days are only tried first and never required.',
    'dueDate|planByDate':'A due date is a task’s deadline; a do-by date is a habit’s finish-by target.',
    'delayAllowanceDays|hardDue':'Hard deadline is the switch — on means 0 late days; off, the delay allowance decides how many late days still count.'
  }[key];
  return [head, defA, defB, values].filter(Boolean).join(' ');
}

// Day allowances read through the planner's own helpers, so legacy
// flexibilityDays counts on the early side and clamping stays consistent.
function assistantFocusDayAllowanceSentence(fieldId, days){
  const early = fieldId === 'earlyWindowDays';
  if(early)return days > 0
    ? `It can be pulled forward by up to ${days} calendar day${days === 1 ? '' : 's'} when something fits better there.`
    : 'It has no early allowance before its due or rhythm day.';
  return days > 0
    ? `Up to ${days} calendar day${days === 1 ? '' : 's'} after the due or rhythm day still count as on time.`
    : 'It has no late days — after the due or rhythm day it counts as overdue, though catch-up can still place it.';
}

function assistantFocusFlexibilityAnswer(session){
  const kind = typeof assistantFocusEffectiveKind === 'function' ? assistantFocusEffectiveKind(session) : 'habit';
  if(kind === 'event'){
    return 'An event sits at a fixed time on its date — the planner does not move it earlier or later. Change the event’s start date or time to shift it, or cancel a single date from its occurrence editor.';
  }
  const record = assistantFocusQuestionRecord(session);
  if(!record && session.operation !== 'create')return 'Open the item to see its flexibility settings.';
  const base = record || assistantFocusBlank(session);
  const savedEarly = habitEarlyWindowDays(base);
  const savedDelay = habitDelayAllowanceDays(base);
  const flexTouched = (session.changes || []).some(change => ['earlyWindowDays', 'delayAllowanceDays', 'hardDue'].includes(change.field));
  const staged = flexTouched ? assistantFocusMaterialize(session) : null;
  const early = staged ? habitEarlyWindowDays(staged) : savedEarly;
  const delay = staged ? habitDelayAllowanceDays(staged) : savedDelay;
  const draftPrefix = session.operation === 'create' ? 'For the new item: ' : '';
  const earlyText = early > 0
    ? `Early window is ${early} — the planner may pull an occurrence forward by up to ${early} calendar day${early === 1 ? '' : 's'} when something fits better there, like an order link or a shorter trip.`
    : 'Early window is 0 — there is no allowance before its due or rhythm day.';
  const delayText = delay > 0
    ? `Delay allowance is ${delay} — up to ${delay} calendar day${delay === 1 ? '' : 's'} after the due or rhythm day still count as on time.`
    : 'Delay allowance is 0 — after the due or rhythm day it counts as overdue, though catch-up can still place it inside its allowed days, hours, and places.';
  const noDue = kind === 'task' && (staged || base).dueDate == null
    ? ' This item has no due date set, so these are the configured allowances — there is no specific deadline to be early or late against.' : '';
  const stagedNote = staged && (early !== savedEarly || delay !== savedDelay)
    ? `Saved: early ${savedEarly}, late ${savedDelay}. Staged for this save: early ${early}, late ${delay}. ` : '';
  return `${draftPrefix}${stagedNote}${earlyText} ${delayText} Its allowed days, hours, and places still apply.${noDue}`;
}

function assistantFocusTimeFlexAnswer(session){
  const kind = typeof assistantFocusEffectiveKind === 'function' ? assistantFocusEffectiveKind(session) : 'habit';
  if(kind === 'event'){
    return 'A fixed start pins the exact clock time; a time window gives the planner a range. An event always has a fixed start — its “starts at” time is exact, and there is no window for the planner to fit into.';
  }
  const record = assistantFocusQuestionRecord(session)
    || (session.operation === 'create' ? assistantFocusBlank(session) : null);
  if(!record)return 'Open the item to see its start-time settings.';
  const staged = (session.changes || []).some(change => ['allowedTimeFixedStart', 'allowedWindow', 'dueTime']
    .includes(assistantFocusScopedField(change.field, session))) ? assistantFocusMaterialize(session) : null;
  const view = staged || record;
  const timeText = item => item.eventTime != null && assistantFocusKindOf(item) === 'task'
    ? assistantFocusFormatValue('dueTime', item, session)
    : assistantFocusFormatValue('allowedWindow', item, session);
  const window = timeText(view);
  const timed = view.eventTime != null && assistantFocusKindOf(view) === 'task';
  const fixed = timed || (view.allowedTimeFixedStart && view.allowedTimeStart != null);
  const startText = timed ? window : fixed ? assistantFriendlyClock(view.allowedTimeStart) : '';
  const head = 'A fixed start pins the exact clock time; a time window gives the planner a range to fit the session inside.';
  const mine = fixed
    ? `This item is pinned to a fixed start${startText ? ` at ${startText}` : ''}.`
    : `This item has no fixed start — the planner fits it ${window === 'any time' ? 'any time of day' : `inside ${window}`}.`;
  const stagedNote = staged ? ` Saved: ${timeText(record)}. Staged for this save: ${window}.` : '';
  return `${head} ${mine}${stagedNote}`;
}

function assistantFocusAmbiguousAnswer(labels, session){
  return `That wording fits more than one setting: ${labels.join(', ')}. Name the one you mean — for example “what does ${labels[0]} mean?” — and I’ll read or explain it.`;
}

function assistantFocusFieldNAAnswer(entry, session){
  return `${entry.label} does not apply to this item right now. ${assistantFocusAvailabilityNote(entry, session)}`;
}

function assistantFocusQuestionAnswer(intent, session, request){
  switch(intent.kind){
    case 'field':return {text:assistantFocusSavedValueAnswer(intent.field, session)};
    case 'definition':return {text:assistantFocusHelpDefinitionAnswer(intent.entry, session)};
    case 'compare':return {text:assistantFocusCompareAnswer(intent.a, intent.b, session)};
    case 'howChange':return {text:assistantFocusHowChangeAnswer(intent.entry, session)};
    case 'flexibility':return {text:assistantFocusFlexibilityAnswer(session)};
    case 'timeFlex':return {text:assistantFocusTimeFlexAnswer(session)};
    case 'helpAmbiguous':case 'fieldAmbiguous':return {text:assistantFocusAmbiguousAnswer(intent.labels, session)};
    case 'fieldNA':return {text:assistantFocusFieldNAAnswer(intent.entry, session)};
    case 'history':return {text:assistantFocusHistoryAnswer(intent, session)};
    case 'plan':return {text:assistantFocusPlanAnswer(intent, session, request)};
    case 'capability':return {text:`${ASSISTANT_FOCUS_CAPABILITY_INTRO} ${ASSISTANT_FOCUS_EXAMPLES}`};
    case 'state':{
      const entry = ASSISTANT_FOCUS_EXPLAIN.find(row => row.id === (intent.which === 'staged' ? 'staged' : intent.which === 'saved' ? 'didSave' : intent.which === 'undo' ? 'undo' : 'saveEffect'));
      return {text:typeof entry.text === 'function' ? entry.text(session) : entry.text};
    }
    case 'help':{
      if(intent.id === 'plannerWhy')return {text:assistantFocusPlannerWhyAnswer(session)};
      const entry = ASSISTANT_FOCUS_EXPLAIN.find(row => row.id === intent.id);
      const text = typeof entry.text === 'function' ? entry.text(session) : entry.text;
      return text ? {text} : {text:`I don’t know that one yet. ${ASSISTANT_FOCUS_CAPABILITY_INTRO}`};
    }
    case 'why':return {text:assistantFocusPlannerWhyAnswer(session)};
    default:return {text:`I don’t know that one yet. ${ASSISTANT_FOCUS_CAPABILITY_INTRO}`};
  }
}

// Computed displays and action controls: not editable settings, so the answer
// explains the derivation or what the action does, with the live value where
// one is cheap to read. `q` is the coverage question and `probe` the regex a
// real answer must match — the coverage test drives both from this table.
// Editable settings come from the registry instead (assistantFocusCoverageLedger).
const ASSISTANT_FOCUS_EXTRAS = [
  {id:'computed-total-entries', label:'Total entries', kinds:['habit'], q:'What are my total entries?', probe:/completed entr/i,
    re:/\btotal entries\b|\btotal completions\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const count = record && actualLogs(record.logs).length;
      return count == null ? 'Total entries counts completed entries.'
        : `Total entries counts completed entries. This item has ${count}.`;
    }},
  {id:'computed-progress-stats', label:'Progress statistics', kinds:['habit','task'], q:'What do Progress statistics show?', probe:/score|entries/i,
    re:/\bprogress statistics\b/i,
    text:()=>'Progress statistics summarizes this item’s activity. It shows the score when available, and for habits it can include total entries, usual gap, and recent progress.'},
  {id:'action-add-app', label:'Add app', kinds:['habit','task','event'], q:'What does Add app do?', probe:/shortcut/i,
    re:/\badd (?:an )?app\b|\bapp shortcuts?\b/i,
    text:()=>'Add app puts a shortcut in this item’s Links. In the Actions editor, choose a suggested app or add a custom app with its name and link, then save the item.'},
  {id:'computed-score', label:'Score', kinds:['habit','task'], q:'What does the score mean?', probe:/rhythm|due|done/i,
    re:/\b(?:progress |status |on[- ]track )?score\b|\bwhat(?:'s| is) my (?:score|percent)/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const n = record && typeof progressScore === 'function' ? progressScore(record) : null;
      return `Score is a percentage. A routine habit’s score reflects the time since its last completion and its rhythm or stop goal. A task’s score reflects deadline timing or completed work${Number.isFinite(n) ? `. This item’s score is ${n}%` : ''}. Opportunity habits and events have no score.`;
    }},
  {id:'computed-streak', label:'Streak', kinds:['habit','task'], q:'What does the streak show?', probe:/usual gap|clear|in a row|done/i,
    re:/\bstreak\b|\bclear (?:days|stretch)\b|\bin a row\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const run = record && typeof currentRun === 'function' ? currentRun(record)?.num : null;
      return `Streak is computed from the logs, not a setting: a habit counts consecutive completions that each landed within its usual gap; limit and stop habits show clear days instead; a task shows days since done${Number.isFinite(run) ? ` — it is ${run} right now` : ''}.`;
    }},
  {id:'computed-usual-gap', label:'Usual gap', kinds:['habit'], q:'What is the usual gap?', probe:/average|between/i,
    re:/\busual gap\b|\baverage (?:gap|interval|days between)\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const gap = record ? avgInterval(record.logs) : null;
      return `Usual gap is the average number of days between this item’s completions, computed from its logs${Number.isFinite(gap) ? ` — it is ${gap} days right now` : ''}. Blank until there are at least two completions.`;
    }},
  {id:'computed-since-last', label:'Since last', kinds:['habit','task'], q:'What does since last mean?', probe:/most recent|never/i,
    re:/\bsince (?:the |my )?last\b|\bdays since\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const days = record && record.lastLog && typeof daysSince === 'function' ? daysSince(record.lastLog) : null;
      return `“Since last” is days since the most recent completion, read from the item’s last log${Number.isFinite(days) ? ` — it is ${days} right now` : ''}. Blank means it has never been logged.`;
    }},
  {id:'computed-last30', label:'Last 30 days', kinds:['habit','task'], q:'What does the last 30 days chip show?', probe:/30|expected/i,
    re:/\blast 30 days?\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      if(!record)return 'The last-30-days chip counts completed entries from the past 30 days.';
      const {count, good, expected} = recentWindowStats(record, 30);
      if(record.type === 'keepup' && !isOpportunityHabit(record)){
        return `Last 30 days is ${good}/${expected} on the chip. It shows completions in the past 30 days up to the expected number for this habit’s rhythm.`;
      }
      return `Last 30 days counts completed entries from the past 30 days. This item has ${count}.`;
    }},
  {id:'computed-pace', label:'Pace strip', kinds:['habit'], q:'What does the pace strip show?', probe:/gap|good|close/i,
    re:/\bpace\b|\binterval tone\b|\bfalling behind\b|\bkeeping up\b/i,
    text:session=>{
      const record = assistantFocusQuestionRecord(session);
      const tone = record && typeof intervalToneSummary === 'function' ? intervalToneSummary(record).label : '';
      return `The pace strip sums up the last 14 gaps between completions, binned as good, close, or care against the rhythm${tone ? ` — right now: ${tone}` : ''}. Computed from the logs on the history page.`;
    }},
  {id:'computed-gap-history', label:'Gap history', kinds:['habit'], q:'What does gap history show?', probe:/interval|bar|target/i,
    re:/\bgap (?:history|graph|chart|bars?)\b|\bthe graph\b|\bbar chart\b/i,
    text:()=>'Gap history draws the last 14 intervals — day gaps between completions, including the still-open one — as bars against the rhythm’s target line. Open the history page and switch to gaps. Tasks don’t have it.'},
  {id:'computed-calendar-history', label:'Calendar history', kinds:['habit','task'], q:'What does calendar history show?', probe:/14|entries|day/i,
    re:/\bcalendar (?:history|strip|page)\b|\bhistory (?:page|tab)\b/i,
    text:()=>'Calendar history shows a 14-day strip — the past week and the next six days — with chips for days with entries, planned entries, and what today’s agenda holds. Tap a day to open its log. Hidden for events and in minimal mode.'},
  {id:'computed-activity', label:'Activity row', kinds:['habit'], q:'What does the activity row show?', probe:/bucket|dot|entry/i,
    re:/\bactivity (?:row|dots|buckets|strip)\b/i,
    text:()=>'The activity row groups this item’s entries into 8 buckets sized to its rhythm (days, weeks, or months). A filled bucket means completions landed there; the caption shows the span. Computed from the logs.'},
  {id:'computed-cue', label:'Cue line', kinds:['habit','task','event'], q:'What does the cue line say?', probe:/status|next|computed|schedule/i,
    re:/\bcue line\b|\bcard cue\b|\bstatus line\b|\bline under the name\b/i,
    text:()=>'The line under the item’s name is a computed status cue: what is next, what is due or overdue, how long since the last one, or whether an opportunity is waiting on its condition. It updates from the schedule and logs.'},
  {id:'computed-trail', label:'Trail', kinds:['habit'], q:'What does the trail show?', probe:/14|dot|log/i,
    re:/\btrail\b|\b(?:the |little )?dots\b/i,
    text:()=>'The dots on a card are the trail: the last 14 days of entries, marking planned and completed days. Computed from the logs.'},
  {id:'computed-breakable-progress', label:'Breakable progress', kinds:['habit','task'], q:'What does breakable progress show?', probe:/minutes|duration/i,
    re:/\b(?:breakable|split) (?:progress|slider)\b|\bprogress (?:bar|slider)\b/i,
    text:()=>'The progress bar on a breakable item shows minutes logged toward its duration — manual sessions plus agenda chunks — as X/Ym. Computed; the Duration setting is the target side.'},
  {id:'action-export', label:'Export to calendar', kinds:['task'], q:'What does Export to calendar do?', probe:/ics|download/i,
    re:/\bexport\b.{0,24}\bcalendar\b|\bics\b|\bcalendar file\b/i,
    text:()=>'Export to calendar (on this task’s actions) downloads it as an .ics calendar file: a timed task becomes an event with a reminder; a due-only task an all-day event with a 1-day alarm. It is a one-time export — later changes here don’t update it — and it needs a time or due date first.'},
  {id:'action-share', label:'Share item', kinds:['habit','task','event'], q:'What does Share item do?', probe:/invite|link/i,
    re:/\bshare (?:this |the )?(?:item|habit|task|event)\b|\bshare item\b/i,
    text:()=>'Share item creates an encrypted invite link and offers it through the share sheet or clipboard. Someone who accepts the invite adds the item to their own Tings and tracks their completions separately.'},
  {id:'action-delete', label:'Remove item', kinds:['habit','task','event'], q:'What does Remove item do?', probe:/undo|delet|hid/i,
    re:/\b(?:remove|delete)\s+(?:this |the )?(?:item|habit|task|event|whole thing)\b|\bwhat does remove do\b/i,
    text:()=>'Remove item (after a confirm) deletes this item and stops planning it; the toast right after offers undo. Items from your phone calendar aren’t deleted — they are hidden per date or for the whole series instead.'},
  {id:'action-duplicate', label:'Duplicate item', kinds:['habit','task','event'], q:'What does Duplicate item do?', probe:/cop|new|without/i,
    re:/\bduplicate\b|\ba copy of this\b/i,
    text:()=>'Duplicate item copies this item’s settings into a new one without its logs, plans, external ids, or date overrides, and opens it unsaved so you can adjust.'},
  {id:'action-ignore-dates', label:'Ignore dates', kinds:['habit','task','event'], q:'What does Ignore dates do?', probe:/calendar|hidden|series/i,
    re:/\bignore (?:this |all |the )?dates?\b|\bcalendar ignore\b/i,
    text:()=>'Ignore dates applies to items imported from your phone calendar: “ignore this date” hides one occurrence from the plan; “ignore all dates” hides the whole series. The item stays in your calendar.'},
  {id:'action-ask-ai', label:'Change with AI', kinds:['habit','task','event'], q:'What does Change with AI do?', probe:/assistant|summary/i,
    re:/\bchange with ai\b|\bask ai\b/i,
    text:()=>'Change with AI opens this assistant on the item’s Summary tab. It needs the on-device assistant enabled and no unsaved edits waiting.'},
  {id:'action-timer', label:'Start or stop session', kinds:['habit','task'], q:'What does Start or stop session do?', probe:/timer|log|target/i,
    re:/\b(?:start|stop|begin)\b[^.?!]{0,12}\b(?:session|timer)\b|\bstart or stop session\b/i,
    text:()=>'Start session runs a timer on this item; stopping it logs the elapsed minutes, and it auto-stops and logs at the session target if one is set. With Value tracking on, stopping asks for the value.'},
  {id:'action-device-icon', label:'Calendar icon override', kinds:['habit','task','event'], q:'What does the calendar icon override do?', probe:/calendar|emoji|colou?r/i,
    re:/\busual icon\b|\bcalendar (?:icon|personalization)\b/i,
    text:()=>'For items from your phone calendar, the icon override keeps your own emoji and color for the series or a single date without changing the calendar event itself.'},
  {id:'action-todays-order', label:'Today’s order', kinds:['habit','task'], q:'What does Today’s order show?', probe:/drag|unlink|today/i,
    re:/\btoday(?:['’]s| is)? order\b|\breorder\b|\bdrag to reorder\b/i,
    text:()=>'Today’s order shows the day’s running order for linked work: drag to reorder just today, unlink a pair, or clear the day’s order. Standing before/after links live in the Order setting.'},
  {id:'action-log-entry', label:'Log an entry', kinds:['habit','task','event'], q:'What does Log an entry do?', probe:/completion|today/i,
    re:/\blog an entry\b|\blog a completion\b|\bwhat does logging (?:do|mean)\b/i,
    text:()=>'Log an entry records a completion for today (the pulse button, or “mark done”). With Value tracking on it asks for the number first. Planning a day is different: a plan is a reminder to do it, not a completion.'}
];

// Register the extras with the app-explanation set so questions flow through
// the same read-only path as every other answer, and expose the inventory for
// the coverage test (registry fields come from assistantFocusCoverageLedger).
ASSISTANT_FOCUS_EXPLAIN.push(...ASSISTANT_FOCUS_EXTRAS.map(row => ({id:row.id, re:row.re, text:row.text})));
if(typeof window !== 'undefined'){
  window.ASSISTANT_FOCUS_EXTRA_HELP = ASSISTANT_FOCUS_EXTRAS
    .map(({id, label, kinds, q, probe}) => ({id, label, kinds, q, probe}));
}
