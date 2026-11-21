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
  ['timesPerPeriod', /\bhow often\b|\bhow frequently\b|\bhow many times (?:a|per|an|each)\b|\bfrequency\b/i],
  ['dueTime', /\bwhat time\b.{0,24}\b(?:due|deadline)\b|\bdue time\b/i],
  ['dueDate', /\bwhen is it due\b|\bwhat(?:'s| is) the due\b|\bdue date\b|\bdeadline\b|\bwhen(?:'s| is) (?:it|this) due\b/i],
  ['planByDate', /\b(?:do|done|finish|plan) by\b|\bplan[- ]by\b/i],
  ['places', /\bwhere\b|\bwhich (?:places?|locations?)\b|\bwhat locations?\b/i],
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
  if(!/^(?:what|whats|when|whens|where|which|who|whose|why|how|is|are|was|were|am)\b/i.test(request))return null;
  for(const [fieldId, pattern] of ASSISTANT_FOCUS_FIELD_READS){
    if(!pattern.test(request))continue;
    const field = assistantFocusField(fieldId);
    if(!field || !assistantFocusFieldApplies(field, session))continue;
    return {kind:'field', field:fieldId};
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
  const shaped = /\?\s*$/.test(request) || /^(?:what|whats|whens|when|where|which|who|whose|why|how|is|are|was|were|does|do|did|can|could|should|would|will|has|have|am)\b/i.test(request)
    || /\bwhat does\b.{0,40}\bmean\b/i.test(request);
  if(!shaped)return null;
  if(assistantFocusEditSignal(request))return null;
  const history = assistantFocusHistoryIntent(request);
  if(history)return history;
  const state = assistantFocusStateIntent(request);
  if(state)return state;
  for(const entry of ASSISTANT_FOCUS_EXPLAIN){
    if(entry.re.test(request))return {kind:'help', id:entry.id};
  }
  // A concrete quantity is a value being offered, not a question ("What
  // about 30 minutes?" after a staged 20). Reading questions keep their own
  // patterns ("how long", "how many minutes") above.
  if(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|an?)\s*(?:min(?:ute)?s?|hours?|hrs?|days?|weeks?|months?|reps?|times)\b/i.test(request)
    && !/^(?:how|when|where|which|who|why|did|do|does|is|are|was|were|have|has)\b/i.test(request))return null;
  if(/\b\d+(?:\.\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?)\b/i.test(request))return null;
  const plan = assistantFocusPlanIntent(request);
  if(plan)return plan;
  if(typeof assistantActionCue === 'function' && assistantActionCue(request))return null;
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
  if(fieldId === 'kind' && session.operation === 'create')fieldId = 'kind';
  const stagedChange = (session.changes || []).find(change => assistantFocusScopedField(change.field, session) === fieldId);
  const field = assistantFocusField(fieldId);
  const label = field && field.label ? field.label.toLowerCase() : fieldId;
  const savedText = assistantFocusFormatValue(fieldId, record || assistantFocusBlank(session), session);
  const isReminder = String(fieldId).startsWith('reminder');
  if(isReminder && !(typeof window !== 'undefined' && window.TingsNative && window.TingsNative.isNative)){
    return 'Phone reminders are part of the mobile app, so this browser view doesn’t set them. Everything else still edits here.';
  }
  const saved = savedText && savedText !== '—' && savedText !== 'none' ? savedText : 'not set';
  const draftPrefix = session.operation === 'create' ? 'Planned for the new item: ' : '';
  if(stagedChange){
    const stagedText = assistantFocusFormatValue(fieldId, assistantFocusMaterialize(session), session, true);
    return `${draftPrefix}Saved: ${saved}. Staged for this save: ${stagedText}. Saving still applies the staged value.`;
  }
  if(fieldId === 'durationMinutes')return `${draftPrefix}It's set to ${saved}.`;
  if(fieldId === 'timesPerPeriod' || fieldId === 'periodDays'){
    const rhythm = typeof assistantFocusRhythmText === 'function' && record ? assistantFocusRhythmText(record) : '';
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

function assistantFocusQuestionAnswer(intent, session, request){
  switch(intent.kind){
    case 'field':return {text:assistantFocusSavedValueAnswer(intent.field, session)};
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
