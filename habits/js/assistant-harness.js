// Guided Qwen3.8 loop: the model understands every natural-language request,
// then calls validated tools. Deterministic code validates arguments, reads
// authoritative app state, and stages writes; it never chooses semantic intent.

function assistantSystemPrompt(){
  return [
    'You are the Tings assistant. Understand the request, then call tools; do not guess app data or save anything yourself.',
    '',
    'PRIORITIES',
    '1. Call the final tool directly when you can. classify_intent is optional.',
    '2. Treat tool results as authoritative. Never invent or recalculate names, dates, times, totals, priorities, frequencies, history, weather, or schedule facts.',
    '3. Handle every part of a compound request. Emit several tool calls when independent parts are clear; after results, call more tools if a part remains. On any read used to choose a later action, set purpose prepare_action; then finish with the requested draft or action tool. A setting drafted in that same response is only staged, because it has not seen the result. After the result, call the action the user asked for. Do not invent a task or habit they did not ask for. If the staged setting is the whole action, call draft_setting again with the same name.',
    '4. If a saved-item name is missing or ambiguous, call find_item or ask_user. Never guess the item or create a replacement.',
    '',
    'READS AND ACTIONS',
    'Use answer_schedule for agendas, missed items, free time, freest day, open windows, and what-if conflicts. Use answer_items for questions across saved tasks/habits. For arbitrary filters, rankings, ordinals, counts, or duration math, put the whole operation in conditions + sortBy/sortOrder + position/limit + aggregate; Tings must compute it. Example: second most overdue missed = answer_schedule query missed, sortBy overdue_days, sortOrder desc, position 2. Importance is P0-P5 (lower is more important); urgency is the app attention score (higher is more urgent). Use answer_weather for forecast facts and weather fit. query hours finds the time: lowest wind after 5pm is sortBy wind, sortOrder asc, position 1; relatively hot with very low wind is conditions on temperature and wind. query compare scores two times, including 1 hour before sunset, and can use a habit weather profile. query item with start checks that habit in the window even when it is not already planned. Use answer_settings for saved configuration, and lookup_item for one item’s next time, last completion, history, stats, or planner reason.',
    'Use complete_item to log or undo completion, plan_item for one-day plan changes, and delete_item to remove an item. These tools preview changes for confirmation.',
    '',
    'CREATION AND EDITING',
    'A task is one-off; a habit repeats; a setting is a weather profile, place, busy time, or topic. Use draft_item once for one task/habit and include every requested field. Use a short title, flat fields, and omit unspecified fields. Use draft_batch once for several items. Use draft_setting for settings. Recurring meetings are habits. Weather conditions belong in weatherText even when no profile exists; draft_item will create and attach that profile on save.',
    'currentDraft is the item being edited. “it”, “this”, and “that” refer to currentDraft, otherwise recent.referent when appropriate. A question about it uses lookup_item; done uses complete_item; plan/unplan uses plan_item; remove uses delete_item. A named saved place may update placeNames on the current item; do not turn it into a new item.',
    '',
    'GROUNDING',
    'Resolve relative dates using catalog.date. sunset means maghrib. placeNames may contain only places the user named that exist in catalog.places; omit the field otherwise. recent contains the previous request, verified answer, items, and referent. "those", "these", and "them" mean recent.items. Rank that list by repeating the same read with sortBy and position. Do not query every saved habit for a list you already returned.',
    'If the request is genuinely ambiguous, ask one short question. A whole-week reschedule, deleting everything, or anything that is not one task, habit, setting, read, complete, plan, or delete is unsupported: call classify_intent with intent unsupported. Do not ask which item to move and do not answer that in prose. If tool JSON fails, retry with a smaller flat object.'
  ].join('\n');
}

function assistantUnsupportedText(){
  return 'I can add or change tasks, habits, weather profiles, places, busy times, and topics; answer schedule, weather, item-status, history, stats, and settings questions; explain planner choices; and preview completing, correcting, planning, unplanning, or removing an item before it is saved.';
}

// Name-clarification chips start a fresh turn, so remember which action the
// original request was heading toward. Classify/extract have to infer it.
const ASSISTANT_CONFUSION_CHOICES = ['task', 'habit', "what's today", 'schedule question', 'weather', 'log done'];

function assistantCanClarify(session, required){
  const max = typeof ASSISTANT_MAX_CLARIFY === 'number' ? ASSISTANT_MAX_CLARIFY : 2;
  return (session && session.clarifyCount || 0) < max;
}

function assistantGiveUpClarify(session, parsed){
  return {
    type:'say',
    text:'I still do not follow. Try one short request, or add it from +.',
    thinking:parsed && parsed.thinking,
    gaveUp:true,
    session
  };
}

function assistantConfusionQuestion(parsed){
  const spoken = String(parsed && parsed.content || '').trim();
  if(spoken.length >= 12 && spoken.length <= 180 && /[?？]$/.test(spoken)
    && !(typeof assistantLooksLikeToolNarration === 'function' && assistantLooksLikeToolNarration(spoken))){
    return spoken;
  }
  return 'I am not sure what you want. A one-off task, a repeating habit, something already on your list, or a schedule or weather question?';
}

function assistantClarifyOutcome(session, parsed, opts){
  const required = Boolean(opts && opts.required);
  const question = String((opts && opts.question) || '').trim();
  const choices = Array.isArray(opts && opts.choices) ? opts.choices.map(v => String(v).trim()).filter(Boolean).slice(0, 6) : [];
  if(!question)return assistantGiveUpClarify(session, parsed);
  if(!assistantCanClarify(session, required))return assistantGiveUpClarify(session, parsed);
  session.clarifyCount = (session.clarifyCount || 0) + 1;
  if(opts && Object.prototype.hasOwnProperty.call(opts, 'awaiting'))session.awaiting = opts.awaiting || null;
  if(opts && opts.request)session.clarifyingRequest = opts.request;
  assistantTracePush(session, {
    t:'ask',
    n:session.clarifyCount,
    required,
    question:question.slice(0, 160)
  });
  return {
    type:'ask',
    question,
    choices,
    thinking:parsed && parsed.thinking,
    draft:session.draft,
    session
  };
}

function assistantAwaitingFromAsk(step, text){
  if(step === 'complete' || step === 'plan' || step === 'delete' || step === 'lookup' || step === 'query')return step;
  return null;
}

function assistantLooksLikeNameReply(text){
  const s = String(text || '').trim();
  if(!s || s.length > 60 || /[?]/.test(s))return false;
  return s.split(/\s+/).filter(Boolean).length <= 4;
}

// The legacy fast path deliberately handles only simple "today" and item
// lookups. Natural query phrasing can resemble those intents ("what do I have
// tomorrow?", "do I have time?", "what should I do if it is windy?"). Defer
// those turns to the model so it can select the read-only query tools instead
// of returning an unrelated local answer. Creation/edit requests are excluded:
// weather clauses on a new habit still belong in draft_item.
function assistantQueryRouteHint(text, parsed){
  const s = typeof assistantNormText === 'function'
    ? assistantNormText(text)
    : String(text || '').trim().toLowerCase();
  if(typeof assistantLooksLikeListAnalysis === 'function' && assistantLooksLikeListAnalysis(s)
    && /\b(?:miss|agenda|tomorrow|today|habit|task)\b/.test(s))return 'schedule-query';
  if(typeof assistantLooksLikeMissedQuestion === 'function' && assistantLooksLikeMissedQuestion(s))return 'schedule-query';
  const intent = parsed && parsed.intent;
  if(intent !== 'ask_today' && intent !== 'lookup_item' && intent !== 'ask_schedule')return null;
  const weather = /\b(?:weather|forecast|rain(?:ing|y)?|snow(?:ing|y)?|freez(?:e|ing)|wind(?:y|s)?|gusts?|temperature|temps?|degrees?|humid(?:ity)?|uv|sunny|cloudy|storm(?:y)?|hot|warm|cold|cool|dry)\b/.test(s);
  if(weather)return 'weather-query';
  const availability = /\b(?:free(?:st)?(?:\s+time)?|available|availability|open\s+(?:time|window|slot)|have\s+time|make\s+room|fit\s+(?:it|this|that)|miss\s+anything|agenda|schedule)\b/.test(s);
  if(availability)return 'schedule-query';
  const anotherDay = /\b(?:tomorrow|tommorow|tmrw|next\s+week|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|\d{4}-\d{2}-\d{2})\b/.test(s);
  if(anotherDay && (intent === 'ask_today' || /\bwhat\s+do\s+i\s+have\b/.test(s)))return 'schedule-query';
  const genericSchedule = /\bdo\s+i\s+have\s+(?:anything|something|plans?|tasks?|appointments?)\b/.test(s);
  return genericSchedule ? 'schedule-query' : null;
}

function assistantUserEnvelope(text, catalog, draft, parsed, opts){
  const compact = Boolean(opts && opts.compact);
  const habitLimit = compact ? 6 : 12;
  const payload = {
    request:String(text || '').trim(),
    catalog:{
      date:catalog.date || null,
      today:compact
        ? {next:(catalog.today && catalog.today.next) || null}
        : catalog.today,
      places:(catalog.places || []).slice(0, compact ? 6 : 12).map(item => ({name:item.name})),
      weather:(catalog.weather || []).slice(0, 4).map(item => ({name:item.name})),
      topics:(catalog.topics || []).slice(0, compact ? 6 : 12),
      habits:(catalog.habits || []).slice(0, habitLimit).map(item => ({name:item.name, type:item.type})),
      anchors:catalog.anchors,
      aliases:catalog.aliases
    }
  };
  const current = typeof assistantCompactDraft === 'function' ? assistantCompactDraft(draft) : null;
  if(current)payload.currentDraft = current;
  if(opts && opts.recent)payload.recent = opts.recent;
  return JSON.stringify(payload);
}

function assistantDraftSettingSteerText(){
  return 'Call draft_setting. kind is weather, location, busy, or topic. name is a short title. Weather rules go in weatherText as one string (example: "not raining, wind under 25, above 15C, prefer higher temperature"). A follow-up patches currentDraft.rules — "prefer higher temperature" keeps the other bounds. Place address in address. Busy window in windowText. Do not call draft_item for a weather profile, place, busy time, or topic.';
}

function assistantDraftBatchSteerText(){
  return 'Call draft_batch once with every item from the request. Several items — a list, a pasted schedule, two habits, errands plus places — belong in one draft_batch. One item, even with a long instruction, is draft_item. Recurring meetings are kind habit. Skip a row that is TBA with no days and no times. Unknown place names go in places with a dummy address — do not ask. name is a short title. Do not call draft_item for each row.';
}

function assistantWideExtractSteerText(){
  return 'Call one tool. Several items → draft_batch once with every item and any new places. One item, even a long detailed instruction → draft_item. A weather profile, place, busy time, or topic → draft_setting. Recurring meetings are habits. Skip TBA rows that have no days and no times. Unknown places in a batch may use a dummy address — do not ask. name is a short title.';
}

function assistantDraftItemSteerText(intent, factsHint){
  const hint = factsHint || '';
  if(intent === 'create_setting')return assistantDraftSettingSteerText() + hint;
  if(intent === 'create_habit'){
    return 'Call draft_item with kind habit. name is a short title only. Put every other field the user said in that one call as flat strings — do not nest objects. Strings are ok: rhythm "five times a week", windowText "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier", order "right after Walk, same day". If they asked you to pick time, weather, or duration, fill those. placeNames only from catalog.places; omit placeNames if they did not name a saved place. If they named weather conditions and catalog.weather has no match, put those conditions in weatherText — Tings creates a profile.' + hint;
  }
  if(intent === 'create_task'){
    return 'Call draft_item with kind task. name is a short title only. Put every other field the user said in that one call as flat strings — do not nest objects. A firm due day is hardDue true. Default due is today if they did not name a day. If they asked you to pick time, weather, or duration, fill those. placeNames only from catalog.places; omit placeNames if they did not name a saved place. If they named weather conditions and catalog.weather has no match, put those conditions in weatherText — Tings creates a profile.' + hint;
  }
  return 'Call draft_item with every field the user named as flat strings. name is a short title. Put the window in windowText as one string. Do not nest objects.' + hint;
}

function assistantRepairText(step, error){
  const tool = assistantStepTools(step)[0];
  const err = String(error || 'invalid arguments');
  if(typeof assistantIsBrokenToolJson === 'function' && assistantIsBrokenToolJson(err)){
    if(step === 'extract' || tool === 'draft_item' || tool === 'draft_setting'){
      if(tool === 'draft_setting'){
        return 'The last tool JSON was cut off or nested (' + err + '). Do not call a tool. Reply with one JSON object: kind (weather, location, busy, or topic), name, and weatherText or address or windowText as flat strings.';
      }
      return 'The last tool JSON was cut off or nested (' + err + '). Do not call a tool. Reply with one JSON object of draft_item fields. name is a 1-3 word title. windowText is one string (example: "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier"). rhythm "five times a week". No nested objects.';
    }
    return 'The last tool JSON was cut off (' + err + '). Call ' + tool + ' again with a small JSON object. Do not nest.';
  }
  if(step === 'extract' || tool === 'draft_item'){
    return 'That tool call was invalid (' + err + '). ' + assistantDraftItemSteerText(null) + ' JSON only inside the tool.';
  }
  return `That tool call was invalid (${err}). Think again, then call ${tool} with valid arguments. JSON only inside the tool.`;
}

function assistantQueryListHint(){
  return 'Do not calculate, filter, rank, count, or rewrite factual results yourself. If the user requested an analysis that this result did not already compute, call answer_schedule or answer_items again with the complete conditions, sortBy/sortOrder, position/limit, and aggregate. Example: second most overdue = sortBy overdue_days, sortOrder desc, position 2. If they asked another independent question, call its matching tool now. Call lookup_item only for history, stats, or why on one exact saved name.';
}

function assistantFollowupSteerText(){
  return 'recent is the previous turn (their last request, your last answer, recent.items, and recent.referent). This message may continue that thread or ask something else. "it" / "that" / "the one" is currentDraft or recent.referent. "those" / "these" / "them" is recent.items from that turn, not every saved habit. To rank that list, call the same read again — answer_schedule with the same date or query — and set sortBy, sortOrder, and position. Do not call answer_items over the whole library for "those". Do not guess names or numbers.';
}

function assistantQueryContinueHint(){
  return 'Review the original request clause by clause. If this lookup was research for creating or changing something, call draft_item, draft_batch, or draft_setting now with the chosen fields. Otherwise call the next matching tool for every unfinished part. Only answer when every requested read and action is handled. Use tool data verbatim; do not invent names or numbers. "it"/"that"/"the one" is currentDraft or recent.referent.';
}

function assistantWriteContinueHint(){
  return 'If they also asked a question, call the matching answer_schedule / answer_weather / answer_items / lookup_item tool now. If this was only the complete, plan, or delete request, do not call a tool.';
}

function assistantDraftKey(row){
  const name = typeof assistantNormText === 'function'
    ? assistantNormText(row && row.name)
    : String(row && row.name || '').toLowerCase();
  return `${row && row.kind || ''}:${name}`;
}

function assistantStageTurnDraft(session, draft){
  if(!session || !draft || !draft.name)return;
  const list = Array.isArray(session.turnDrafts) ? session.turnDrafts.slice() : [];
  const key = assistantDraftKey(draft);
  const idx = list.findIndex(row => assistantDraftKey(row) === key);
  if(idx >= 0)list[idx] = draft;
  else list.push(draft);
  session.turnDrafts = list;
}

function assistantPublishTurnDrafts(session){
  if(!session)return;
  if(typeof assistantRelinkStagedWeather === 'function')assistantRelinkStagedWeather(session);
  const staged = Array.isArray(session.turnDrafts) ? session.turnDrafts.filter(row => row && row.name) : [];
  if(!staged.length)return;
  const merged = [];
  const index = new Map();
  const add = (row, replace) => {
    if(!row || !row.name)return;
    const key = assistantDraftKey(row);
    if(index.has(key)){
      if(replace)merged[index.get(key)] = row;
      return;
    }
    index.set(key, merged.length);
    merged.push(row);
  };
  staged.forEach(row => add(row, true));
  (Array.isArray(session.drafts) ? session.drafts : []).forEach(row => add(row, false));
  if(merged.length > 1)session.drafts = merged;
  session.draft = merged.find(row => row.kind === 'habit' || row.kind === 'task') || merged[merged.length - 1];
}

function assistantQueuedCreate(queuedCalls){
  const next = Array.isArray(queuedCalls) ? queuedCalls[0] : null;
  return Boolean(next && (next.name === 'draft_item' || next.name === 'draft_setting' || next.name === 'draft_batch'));
}

// A draft_setting emitted in the same response as a prepare_action read has
// not seen that result, so it cannot be the action the read was preparing.
// Keep the research open until a later item, batch, or write consumes it.
function assistantActionClearsResearch(session, call){
  if(!session || !session.researchPending || !call)return true;
  return !(call.name === 'draft_setting' && session.researchPending.gen === session._responseGen);
}

function assistantDraftShouldContinue(session, call, queuedCalls){
  if(!call || (call.name !== 'draft_item' && call.name !== 'draft_setting'))return false;
  if(Array.isArray(queuedCalls) && queuedCalls.length)return true;
  return Boolean(session && session.researchPending);
}

function assistantResultPreview(call, result, session, settings){
  if(!result || !result.ok)return null;
  const draftPreview = assistantDraftSummary(session && session.draft, settings) || null;
  if(call && (call.name === 'draft_item' || call.name === 'draft_setting' || call.name === 'draft_batch')){
    return draftPreview || result.text || result.summary || null;
  }
  return result.text || result.summary || null;
}

function assistantIsReadTool(name){
  return name === 'answer_weather' || name === 'answer_schedule' || name === 'answer_items'
    || name === 'answer_settings' || name === 'lookup_item';
}

function assistantIsWriteTool(name){
  return name === 'complete_item' || name === 'plan_item' || name === 'delete_item';
}

function assistantIsActionTool(name){
  return assistantIsWriteTool(name) || name === 'draft_item' || name === 'draft_setting' || name === 'draft_batch';
}

// A fully specified list analysis already has its final wording and facts from
// deterministic code. Do not spend another model pass asking it to restate the
// result; that only creates an opportunity to corrupt or repeat the query.
// Queued sibling tools still run first, and prepare_action reads must continue
// until their requested write succeeds.
function assistantReadCallIsTerminal(call, result){
  if(!call || !result || !result.ok)return false;
  if(call.args && call.args.purpose === 'prepare_action')return false;
  const args = call.args || {};
  if(call.name === 'answer_weather'){
    const query = String(args.query || '').toLowerCase();
    return query === 'hours' || query === 'compare'
      || Boolean(args.sortBy || args.position || args.compareStart
        || (Array.isArray(args.conditions) && args.conditions.length)
        || (query === 'item' && (args.start || args.end)));
  }
  if(call.name !== 'answer_schedule' && call.name !== 'answer_items')return false;
  return Boolean(
    args.select || args.sortBy || args.position || args.aggregate
    || args.limit || (Array.isArray(args.conditions) && args.conditions.length)
  );
}

function assistantToolCallKey(call){
  let args = '';
  try{ args = JSON.stringify(call && call.args || {}); }catch(_){ args = String(call && call.args || ''); }
  return `${(call && call.name) || ''}:${args}`;
}

function assistantCompactRecentItems(items){
  return (Array.isArray(items) ? items : []).slice(0, 12).map(item => {
    if(!item || typeof item !== 'object')return null;
    const name = String(item.name || '').trim();
    if(!name)return null;
    const out = {name:name.slice(0, 48)};
    if(item.hid)out.hid = item.hid;
    if(item.priority)out.priority = item.priority;
    if(item.priorityRank != null)out.priorityRank = item.priorityRank;
    if(item.frequency)out.frequency = item.frequency;
    if(item.timesPerWeek != null)out.timesPerWeek = item.timesPerWeek;
    if(item.durationMinutes != null)out.durationMinutes = item.durationMinutes;
    if(item.urgency != null)out.urgency = item.urgency;
    if(item.overdueDays != null)out.overdueDays = item.overdueDays;
    if(item.dueInDays != null)out.dueInDays = item.dueInDays;
    if(item.status)out.status = item.status;
    if(item.clock)out.clock = item.clock;
    if(item.missed)out.missed = item.missed;
    return out;
  }).filter(Boolean);
}

function assistantEnvelopeRecent(session){
  const recent = session && session.recent;
  if(!recent)return null;
  const out = {};
  if(recent.request)out.request = recent.request;
  if(recent.say)out.answer = recent.say;
  if(recent.referent)out.referent = recent.referent;
  if(Array.isArray(recent.items) && recent.items.length)out.items = recent.items.slice(0, 12);
  if(Array.isArray(recent.tools) && recent.tools.length)out.tools = recent.tools.slice(-6);
  return Object.keys(out).length ? out : null;
}

function assistantRememberGrounded(session, result, call){
  if(!session || !result)return;
  const text = String(result.text || result.summary || '').trim();
  if(text)session.lastGroundedText = text;
  if(call && (assistantIsReadTool(call.name) || result.noChange) && text){
    session.lastReadText = text;
    session.lastReadParts = (session.lastReadParts || []).concat([text]).slice(-8);
  }
  if(!session.recent || typeof session.recent !== 'object')session.recent = {};
  const tools = Array.isArray(session.recent.tools) ? session.recent.tools.slice() : [];
  if(call && call.name)tools.push(call.name);
  session.recent.tools = tools.slice(-8);
  if(text)session.recent.say = text.slice(0, 400);
  const items = Array.isArray(result.items)
    ? result.items
    : (result.item ? [result.item] : null);
  if(items && items.length)session.recent.items = assistantCompactRecentItems(items);
  if(result.item && result.item.name)session.recent.referent = result.item.name;
  else if(call && call.name === 'lookup_item' && call.args && call.args.name)session.recent.referent = String(call.args.name).slice(0, 48);
}

function assistantRememberTurn(session, text, out){
  if(!session || !out)return;
  const prev = session.recent && typeof session.recent === 'object' ? session.recent : {};
  const say = String(out.text || out.summary || out.question || prev.say || '').trim();
  session.recent = {
    request:String(text || '').slice(0, 240),
    say:say.slice(0, 400),
    type:out.type || null,
    focus:session.draft && session.draft.name || null,
    items:Array.isArray(prev.items) ? prev.items : null,
    referent:(session.draft && session.draft.hid && session.draft.name) || prev.referent || null,
    tools:Array.isArray(prev.tools) ? prev.tools : null
  };
}

function assistantTakeQueuedCall(queued, allowed){
  if(!Array.isArray(queued) || !queued.length)return null;
  // Research must run before a dependent draft even when the model returned
  // both calls in the opposite order. The draft can then use the authoritative
  // result already present in the transcript.
  const researchIdx = queued.findIndex(item => item && assistantIsReadTool(item.name) && allowed.has(item.name));
  if(researchIdx >= 0)return queued.splice(researchIdx, 1)[0];
  const preferFinal = queued.findIndex(item => item && item.name && item.name !== 'classify_intent' && allowed.has(item.name));
  if(preferFinal >= 0)return queued.splice(preferFinal, 1)[0];
  const allowedIdx = queued.findIndex(item => item && allowed.has(item.name));
  if(allowedIdx >= 0)return queued.splice(allowedIdx, 1)[0];
  return queued.shift();
}

function assistantDropClassifyCalls(queued){
  if(!Array.isArray(queued))return queued;
  for(let i = queued.length - 1; i >= 0; i -= 1){
    if(queued[i] && queued[i].name === 'classify_intent')queued.splice(i, 1);
  }
  return queued;
}

function assistantPendingWriteOutcome(session, parsed, extraText){
  const thinking = parsed && parsed.thinking;
  const extra = String(extraText || '').trim();
  const actions = Array.isArray(session.pendingActions)
    ? session.pendingActions.filter(action => action && action.pending)
    : [];
  if(actions.length > 1){
    const summaries = actions.map(action => action.summary).filter(Boolean);
    return {
      type:'actions',
      text:summaries.join(' '),
      actions,
      alsoText:extra && summaries.indexOf(extra) < 0 ? extra : null,
      thinking,
      session
    };
  }
  if(actions.length === 1){
    const action = actions[0];
    const also = extra && extra !== action.summary ? extra : '';
    if(action.kind === 'complete'){
      return {
        type:'complete',
        text:action.summary,
        alreadyDone:Boolean(action.alreadyDone),
        completeAction:action.pending.action || 'log',
        pendingComplete:action.pending,
        alsoText:also || null,
        thinking,
        session
      };
    }
    if(action.kind === 'plan'){
      return {
        type:'plan',
        text:action.summary,
        pendingPlan:action.pending,
        planAction:action.pending.action || 'add',
        alsoText:also || null,
        thinking,
        session
      };
    }
    if(action.kind === 'delete'){
      return {
        type:'delete',
        text:action.summary,
        pendingDelete:action.pending,
        alsoText:also || null,
        thinking,
        session
      };
    }
  }
  const also = extra && extra !== String((session.pendingOutcome && session.pendingOutcome.text) || '') ? extra : '';
  if(session.chainWrite === 'complete' && session.pendingComplete){
    const pending = session.pendingComplete;
    return {
      type:'complete',
      text:(session.pendingOutcome && session.pendingOutcome.text) || pending.summary,
      alreadyDone:Boolean(session.pendingOutcome && session.pendingOutcome.alreadyDone),
      completeAction:pending.action || 'log',
      pendingComplete:pending,
      alsoText:also || null,
      thinking,
      session
    };
  }
  if(session.chainWrite === 'plan' && session.pendingPlan){
    const pending = session.pendingPlan;
    return {
      type:'plan',
      text:(session.pendingOutcome && session.pendingOutcome.text) || pending.summary,
      pendingPlan:pending,
      planAction:pending.action || 'add',
      alsoText:also || null,
      thinking,
      session
    };
  }
  if(session.chainWrite === 'delete' && session.pendingDelete){
    return {
      type:'delete',
      text:session.pendingOutcome && session.pendingOutcome.text,
      pendingDelete:session.pendingDelete,
      alsoText:also || null,
      thinking,
      session
    };
  }
  return null;
}

function assistantLooksLikeToolNarration(text){
  const s = String(text || '').trim();
  if(!s)return false;
  return /\b(?:i(?:['’]?ll| will)|let me|i am going to|i['’]m going to)\s+(?:look|fetch|check|get|call|find|search|pull|grab)\b/i.test(s);
}

function assistantHasRecentContext(session){
  const recent = session && session.recent;
  if(!recent || typeof recent !== 'object')return false;
  return Boolean(
    (Array.isArray(recent.items) && recent.items.length)
    || recent.referent
    || recent.say
  );
}

function assistantCanFinalize(session){
  return Boolean(session && !session.researchPending && ((Array.isArray(session.pendingActions) && session.pendingActions.length)
    || session.chainWrite || session.lastGroundedText || session.lastReadText));
}

function assistantQueuePendingAction(session, kind, result){
  if(!session || !result)return null;
  const key = kind === 'complete' ? 'pendingComplete'
    : kind === 'plan' ? 'pendingPlan'
    : kind === 'delete' ? 'pendingDelete'
    : null;
  const pending = key && result[key];
  if(!pending)return null;
  const action = {
    kind,
    pending,
    summary:String(result.summary || pending.summary || '').trim(),
    alreadyDone:Boolean(result.alreadyDone)
  };
  if(!Array.isArray(session.pendingActions))session.pendingActions = [];
  session.pendingActions.push(action);
  session[key] = pending;
  session.chainWrite = kind;
  session.pendingOutcome = {text:action.summary, alreadyDone:action.alreadyDone};
  return action;
}

function assistantFinalizeFromAnswer(session, parsed, fallbackText){
  let content = String((parsed && parsed.content) || '').trim();
  if(typeof assistantLooksLikeToolNarration === 'function' && assistantLooksLikeToolNarration(content))content = '';
  const readGrounded = String(Array.isArray(session.lastReadParts) && session.lastReadParts.length
    ? session.lastReadParts.join('\n\n')
    : session.lastReadText || '').trim();
  const grounded = String(fallbackText || readGrounded || session.lastGroundedText || '').trim();
  // Read tools own factual wording. The model may orchestrate more calls, but
  // its prose must never replace computed schedule/weather/item facts. This
  // also makes compound answers safe: every verified tool answer is preserved.
  const authoritative = readGrounded || grounded;
  const extra = authoritative || content;
  const write = assistantPendingWriteOutcome(session, parsed, extra);
  if(write){
    const summary = String((session.pendingOutcome && session.pendingOutcome.text) || write.text || '').trim();
    if(write.alsoText === write.text || write.alsoText === summary)write.alsoText = null;
    return write;
  }
  const text = authoritative || content;
  if(text)return {type:'say', text, thinking:parsed && parsed.thinking, session};
  return {
    type:'error',
    text:'I could not turn that into a Tings action. Try a shorter request, or add it from +.',
    thinking:parsed && parsed.thinking,
    session
  };
}

function assistantIsTransientModelError(err){
  const msg = String(err && err.message || err || '');
  return /Failed to fetch|NetworkError|Load failed|fetch failed|timed?\s*out|ECONNRESET|EPIPE|\b50[234]\b/i.test(msg);
}

function assistantPartialFailure(session, err){
  const parts = Array.isArray(session && session.lastReadParts)
    ? session.lastReadParts.filter(Boolean)
    : [];
  const partial = String(parts.join('\n\n') || (session && session.lastGroundedText) || '').trim();
  const reason = err
    ? assistantFriendlyError(err)
    : 'I could not finish the action that this research was meant to support.';
  const prefix = partial ? `I got partway through and verified this:\n\n${partial}\n\n` : '';
  return {
    type:'error',
    text:`${prefix}${reason} I could not verify that the whole request finished, so I did not treat this as complete.`,
    partial:true,
    session
  };
}

function assistantTryMissedTurn(text, session, context){
  if(typeof assistantLooksLikeListAnalysis === 'function' && assistantLooksLikeListAnalysis(text))return null;
  if(typeof assistantLooksLikeMissedQuestion !== 'function' || !assistantLooksLikeMissedQuestion(text))return null;
  if(typeof assistantAnswerMissed !== 'function')return null;
  if(!session.parsed){
    session.parsed = typeof assistantParseUtterance === 'function'
      ? assistantParseUtterance(text, context.catalog, context.now)
      : {intent:'ask_schedule', confident:true, text};
  }
  assistantTracePush(session, {t:'path', path:'local', via:'missed-list'});
  session.intent = 'ask_schedule';
  const missed = assistantAnswerMissed(context);
  if(typeof assistantRememberGrounded === 'function'){
    assistantRememberGrounded(session, missed, {name:'answer_schedule', args:{query:'missed'}});
  }
  assistantTracePush(session, {t:'tool', step:'local', name:'answer_schedule', args:{query:'missed'}});
  assistantTracePush(session, {t:'result', name:'answer_schedule', ok:true, preview:missed && missed.text});
  return {type:'say', text:missed.text, session};
}

function assistantNeedToolText(step){
  if(step === 'extract')return 'You thought but did not call a tool. Call draft_batch if they listed several items, otherwise draft_item or draft_setting. If the request is confusing, call ask_user with one short question instead of guessing.';
  if(step === 'query')return 'You thought but did not call a tool. Call every matching answer_weather, answer_schedule, answer_items, answer_settings, or lookup_item tool now. Several parts in one request means several tool calls.';
  if(step === 'answer')return 'Review the original request. If a read has purpose prepare_action, call the required draft_item, draft_batch, draft_setting, complete_item, plan_item, or delete_item now. Otherwise call any unfinished read tool, or answer in 1-2 sentences using only tool data. Do not invent names or numbers. If you still cannot tell what they meant, call ask_user.';
  if(step === 'classify')return 'You thought but did not call a tool. Call the matching tool now. If the request is confusing, call ask_user with one short question instead of guessing.';
  const tool = assistantStepTools(step)[0];
  return `You thought but did not call a tool. Call ${tool} now.`;
}

function assistantBuildCompactUser(session, request, extras){
  const payload = {
    compacted:true,
    request:String(request || (session.parsed && session.parsed.text) || ''),
    intent:session.intent || (session.parsed && session.parsed.intent) || null,
    currentDraft:typeof assistantCompactDraft === 'function' ? assistantCompactDraft(session.draft) : null,
    extractedFacts:session.parsed && session.parsed.factsTrusted !== false && typeof assistantCompactFacts === 'function'
      ? assistantCompactFacts(session.parsed)
      : null,
    note:'Older thinking and tool traces were dropped to free context. "it" means currentDraft. Call the next tool.'
  };
  if(extras && extras.repair)payload.continueWith = extras.repair;
  return JSON.stringify(payload);
}

function assistantCapReplayThinking(messages, maxChars){
  const list = Array.isArray(messages) ? messages : [];
  let lastAssistant = -1;
  for(let i = list.length - 1; i >= 0; i -= 1){
    if(list[i] && list[i].role === 'assistant'){
      lastAssistant = i;
      break;
    }
  }
  for(let i = 0; i < list.length; i += 1){
    const msg = list[i];
    if(!msg || msg.role !== 'assistant' || !msg.thinking)continue;
    if(i !== lastAssistant){
      delete msg.thinking;
      continue;
    }
    msg.thinking = assistantTrimThinking(msg.thinking, maxChars != null ? maxChars : ASSISTANT_THINKING_REPLAY_MAX);
  }
}

function assistantCompactSessionMessages(session, request){
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const system = messages.find(msg => msg && msg.role === 'system')
    || {role:'system', content:assistantSystemPrompt()};
  const repair = typeof assistantLastSteeringText === 'function' ? assistantLastSteeringText(messages) : '';
  session.messages = [
    {role:'system', content:system.content},
    {role:'user', content:assistantBuildCompactUser(session, request, {repair})}
  ];
  session.contextCompacted = (session.contextCompacted || 0) + 1;
  return session.messages;
}

function assistantMaybeCompact(session, tools, request){
  if(!session)return {compacted:false, used:0, limit:0, ratio:0};
  const limit = session.contextLimit || ASSISTANT_DEFAULT_CONTEXT_TOKENS;
  if(Array.isArray(session.messages))assistantCapReplayThinking(session.messages);
  const estimated = typeof assistantPromptTokens === 'function'
    ? assistantPromptTokens(session.messages, tools)
    : 0;
  const used = Math.max(estimated, session.contextMeasured || 0);
  const ratio = limit > 0 ? used / limit : 0;
  session.contextUsed = used;
  session.contextLimit = limit;
  session.contextRatio = ratio;
  if(typeof assistantShouldCompact !== 'function' || !assistantShouldCompact(used, limit)){
    return {compacted:false, used, limit, ratio};
  }
  assistantCompactSessionMessages(session, request);
  const after = typeof assistantPromptTokens === 'function'
    ? assistantPromptTokens(session.messages, tools)
    : 0;
  session.contextUsed = after;
  session.contextMeasured = 0;
  session.contextRatio = limit > 0 ? after / limit : 0;
  return {compacted:true, used:after, before:used, limit, ratio:session.contextRatio};
}

function assistantNoteContextUsage(session, raw, tools){
  if(!session)return;
  const measured = typeof assistantReadPromptTokens === 'function' ? assistantReadPromptTokens(raw) : 0;
  if(measured)session.contextMeasured = measured;
  if(raw && Number.isFinite(Number(raw._contextLimit)) && Number(raw._contextLimit) > 0){
    session.contextLimit = Math.round(Number(raw._contextLimit));
  }
  const limit = session.contextLimit || ASSISTANT_DEFAULT_CONTEXT_TOKENS;
  session.contextLimit = limit;
  const estimated = typeof assistantPromptTokens === 'function'
    ? assistantPromptTokens(session.messages, tools)
    : 0;
  session.contextUsed = Math.max(estimated, measured || 0);
  session.contextRatio = limit > 0 ? session.contextUsed / limit : 0;
}

function assistantCreateSession(){
  return {draft:null, drafts:null, messages:[], llmCalls:0, repairs:0, clarifyCount:0, intent:null, awaiting:null, pendingActions:[], pendingComplete:null, pendingPlan:null, pendingDelete:null, pendingEdit:null, parsed:null, debug:[], bulk:false, wide:false, recent:null};
}

function assistantDebugEnabled(){
  if(typeof sortSettings !== 'undefined' && sortSettings && sortSettings.localAssistantDebug)return true;
  if(typeof loadSortSettings === 'function'){
    const s = loadSortSettings();
    return Boolean(s && s.localAssistantDebug);
  }
  return false;
}

// Natural language is always interpreted by the model. Deterministic code
// validates tool arguments and computes answers, but never chooses intent.
function assistantModelOnlyEnabled(){
  return true;
}

function assistantTraceClip(value, max){
  if(value == null)return value;
  const limit = max != null ? max : 800;
  if(typeof value === 'string')return value.length > limit ? `${value.slice(0, limit)}…` : value;
  try{
    const text = JSON.stringify(value);
    if(text.length <= limit)return value;
    return JSON.parse(JSON.stringify(value, (key, val) => {
      if(typeof val === 'string' && val.length > 240)return `${val.slice(0, 240)}…`;
      return val;
    }));
  }catch(_){
    return String(value).slice(0, limit);
  }
}

function assistantTracePush(session, event){
  if(!session || !event)return;
  if(!Array.isArray(session.debug))session.debug = [];
  const row = Object.assign({at:Date.now()}, event);
  session.debug.push(row);
  if(session.debug.length > 48)session.debug.splice(0, session.debug.length - 48);
  if(typeof assistantDebugEnabled === 'function' && assistantDebugEnabled()){
    try{ console.debug('[tings assistant]', row.t || 'event', row); }catch(_){}
  }
  if(typeof session.onDebug === 'function'){
    try{ session.onDebug(session.debug, row); }catch(_){}
  }
}

function assistantDebugJson(value){
  if(value == null || value === '')return '';
  if(typeof value === 'string')return value;
  try{ return JSON.stringify(value); }catch(_){ return String(value); }
}

function assistantFormatDebugLine(ev){
  if(!ev)return '';
  switch(ev.t){
    case 'turn':
      return `you: ${ev.text || ''}${ev.focus ? `  [focus ${ev.focus}]` : ''}${ev.forceLlm ? '  [force llm]' : ''}`;
    case 'parse':
      return `parse ${assistantDebugJson(ev.facts) || '{}'}${ev.awaiting ? `  awaiting=${ev.awaiting}` : ''}${ev.forceLlm ? '  [force llm]' : ''}`;
    case 'path':
      return `path ${ev.path || '?'}${ev.via ? ` via ${ev.via}` : ''}${ev.intent ? `  intent=${ev.intent}` : ''}${ev.type ? `  type=${ev.type}` : ''}`;
    case 'step':
      return `model step ${ev.step}  tools ${(ev.tools || []).join(', ')}`;
    case 'compact':
      return `compact ${ev.before} → ${ev.used} / ${ev.limit}`;
    case 'model': {
      const tools = (ev.tools || []).map(call => call.name + (call.parseError ? '!' : '')).join(', ') || 'none';
      const think = ev.thinking ? `\nthink ${String(ev.thinking).replace(/\s+/g, ' ').slice(0, 280)}` : '';
      const tokens = ev.tokens ? `  tokens ${ev.tokens}/${ev.limit || '?'}` : '';
      const ms = ev.ms != null ? `  ${ev.ms}ms` : '';
      const evald = ev.evalTokens ? `  ${ev.evalTokens} gen tok` : '';
      return `model ${ev.step || ''}  tools ${tools}${ms}${evald}${tokens}${think}`;
    }
    case 'tool':
      return `call ${ev.name}${ev.step ? ` @${ev.step}` : ''}  ${assistantDebugJson(ev.args)}`;
    case 'result':
      return `result ${ev.name}  ${ev.ok ? 'ok' : 'fail'}${ev.error ? `  ${ev.error}` : ''}${ev.ask ? `  ask ${ev.ask}` : ''}${ev.preview ? `  ${ev.preview}` : ''}`;
    case 'repair':
      return `repair${ev.gaveUp ? ' gave up' : ''}${ev.n ? ` #${ev.n}` : ''}  ${ev.error || ''}`;
    case 'ask':
      return `ask${ev.required ? ' required' : ''}  #${ev.n || 1}  ${ev.question || ''}`;
    case 'error':
      return `error @${ev.step || '?'}  ${ev.error || ''}`;
    case 'done':
      return `done ${ev.type || '?'}${ev.intent ? `  ${ev.intent}` : ''}  llm ${ev.llmCalls || 0}${ev.totalMs != null ? `  ${(ev.totalMs / 1000).toFixed(1)}s` : ''}${ev.text ? `  ${String(ev.text).slice(0, 160)}` : ''}`;
    default:
      return `${ev.t} ${assistantDebugJson(ev)}`;
  }
}

function assistantFormatDebug(events){
  return (Array.isArray(events) ? events : []).map(assistantFormatDebugLine).filter(Boolean).join('\n');
}

function assistantFinishDebug(session, out){
  if(!out)out = {type:'error', text:'empty reply'};
  if(session && !out.session)out.session = session;
  if(session){
    assistantTracePush(session, {
      t:'done',
      type:out.type,
      intent:session.intent || (session.parsed && session.parsed.intent) || null,
      llmCalls:session.llmCalls || 0,
      repairs:session.repairs || 0,
      tokens:session.contextUsed || 0,
      limit:session.contextLimit || 0,
      totalMs:session.turnStartedAt ? Date.now() - session.turnStartedAt : null,
      draft:typeof assistantCompactDraft === 'function' ? assistantCompactDraft(out.draft || session.draft) : null,
      text:out.summary || out.text || out.question || ''
    });
    out.debug = session.debug.slice();
    out.debugText = typeof assistantFormatDebug === 'function' ? assistantFormatDebug(out.debug) : '';
    session.onDebug = null;
  }
  return out;
}

function assistantApplyLocalPatch(session, parsed, context){
  const draft = session && session.draft;
  if(!draft || !parsed || !assistantHasPatchFields(parsed))return null;
  const actionable = assistantHasPatchFields(parsed, draft);
  const args = assistantCompactFacts(parsed) || parsed;
  assistantTracePush(session, {t:'tool', step:'local', name:'draft_item', args:assistantTraceClip(args, 600)});
  const before = assistantDraftFingerprint(draft);
  assistantPatchDraftFromParsed(draft, parsed, context.catalog, context.settings);
  const changed = assistantDraftFingerprint(draft) !== before;
  if(!changed && !actionable){
    assistantTracePush(session, {t:'result', name:'draft_item', ok:false, error:'no-op patch'});
    return null;
  }
  session.draft = draft;
  session.intent = typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(draft.kind)
    ? 'create_setting'
    : (draft.kind === 'habit' ? 'create_habit' : 'create_task');
  session.awaiting = null;
  session.pendingEdit = null;
  assistantTracePush(session, {
    t:'result',
    name:'draft_item',
    ok:true,
    preview:assistantDraftSummary(draft, context.settings)
  });
  return assistantPreviewResult(session, context);
}

function assistantOpenNamedDraft(session, context, name, parsed){
  const found = assistantFindHabit(context.data, name);
  if(!found.ok){
    session.awaiting = 'edit';
    session.pendingEdit = parsed || session.parsed;
    session.intent = 'edit_item';
    return {type:'ask', question:found.ask, choices:(found.matches || []).map(item => item.name), session};
  }
  assistantFocusHabit(session, found, context);
  session.awaiting = null;
  session.pendingEdit = null;
  session.intent = session.draft.kind === 'habit' ? 'create_habit' : 'create_task';
  return assistantApplyLocalPatch(session, parsed, context);
}

function assistantAskWhichItem(session, context, parsed){
  const names = ((context.catalog && context.catalog.habits) || []).slice(0, 6).map(item => item.name).filter(Boolean);
  session.awaiting = names.length ? 'edit' : null;
  session.pendingEdit = parsed || session.parsed;
  session.intent = 'edit_item';
  return {
    type:'ask',
    question:names.length ? 'Which item should I change?' : 'Add something first, then I can change it.',
    choices:names,
    session
  };
}

function assistantResolveAwaitingEdit(text, parsed, session, context){
  const pending = session.pendingEdit || parsed;
  const draft = session.draft && session.draft.name ? session.draft : null;
  const named = parsed.itemName && !assistantIsPronounName(parsed.itemName) ? parsed.itemName : null;
  const hasPatch = assistantHasPatchFields(parsed);
  const looksEdit = assistantLooksLikeEdit(text);
  if(draft && (hasPatch || looksEdit) && (!named
    || assistantNamesMatch(named, draft.name)
    || assistantMentionsFocus(text, parsed, draft))){
    session.awaiting = null;
    session.pendingEdit = null;
    return hasPatch ? assistantApplyLocalPatch(session, parsed, context) : null;
  }
  const lookup = named || (!hasPatch && !looksEdit ? text : null);
  if(lookup){
    const found = assistantFindHabit(context.data, lookup);
    if(found.ok){
      session.awaiting = null;
      session.pendingEdit = null;
      assistantFocusHabit(session, found, context);
      const patchFrom = hasPatch ? parsed : pending;
      return assistantHasPatchFields(patchFrom) ? assistantApplyLocalPatch(session, patchFrom, context) : null;
    }
    if(!hasPatch && !looksEdit){
      session.awaiting = 'edit';
      session.pendingEdit = pending;
      return {type:'ask', question:found.ask, choices:(found.matches || []).map(item => item.name), session};
    }
  }
  session.awaiting = null;
  session.pendingEdit = pending;
  return null;
}

function assistantShouldLocalCreate(parsed, session){
  if(parsed && parsed.intent === 'create_setting'){
    if(typeof assistantLooksLikeSettingFollowup === 'function' && assistantLooksLikeSettingFollowup(parsed.text)
      && session && session.draft && typeof assistantIsItemKind === 'function' && assistantIsItemKind(session.draft.kind)){
      return false;
    }
    return Boolean(parsed.confident && parsed.settingKind && parsed.itemName);
  }
  if(!parsed || (parsed.intent !== 'create_task' && parsed.intent !== 'create_habit') || !parsed.itemName)return false;
  if(typeof assistantLooksLikeSettingFollowup === 'function' && assistantLooksLikeSettingFollowup(parsed.text))return false;
  const draft = session && session.draft && session.draft.name ? session.draft : null;
  if(!draft)return true;
  const s = typeof assistantNormText === 'function' ? assistantNormText(parsed.text) : String(parsed.text || '');
  // A focused item means "add …" is usually a setting. Only start a second
  // item when they clearly said remind/create/new.
  if(!/\b(?:remind me|don't forget|dont forget|create |new task|new habit)\b/.test(s))return false;
  return typeof assistantIsNewCreate === 'function' && assistantIsNewCreate(parsed, draft);
}

function assistantTryFocusFollowup(text, parsed, session, context){
  if(!parsed)return null;
  if(session.awaiting === 'edit')return assistantResolveAwaitingEdit(text, parsed, session, context);
  const draft = session.draft && session.draft.name ? session.draft : null;
  const hasPatch = assistantHasPatchFields(parsed);
  const named = parsed.itemName && !assistantIsPronounName(parsed.itemName) ? parsed.itemName : null;
  if(!draft){
    if(parsed.intent === 'edit_item' && named && hasPatch)return assistantOpenNamedDraft(session, context, named, parsed);
    if(parsed.intent === 'edit_item' && !named && hasPatch)return assistantAskWhichItem(session, context, parsed);
    return null;
  }
  if(parsed.intent === 'edit_item' && named
    && !assistantNamesMatch(named, draft.name)
    && !assistantMentionsFocus(text, parsed, draft)){
    if(!hasPatch)return null;
    return assistantOpenNamedDraft(session, context, named, parsed);
  }
  if(assistantIsNewCreate(parsed, draft))return null;
  if(parsed.intent === 'ask_today' && parsed.confident)return null;
  if(parsed.intent === 'unsupported' && parsed.confident)return null;
  if(!assistantIsFollowupOnFocus(text, parsed, draft))return null;
  if(parsed.intent === 'complete_item')return assistantLocalComplete(session, context, draft.name);
  if(parsed.intent === 'lookup_item')return assistantLocalLookup(session, context, draft.name);
  if(!hasPatch)return null;
  return assistantApplyLocalPatch(session, parsed, context);
}

function assistantPreviewResult(session, context, thinking){
  const batch = Array.isArray(session.drafts) && session.drafts.length > 1;
  const drafts = batch
    ? session.drafts.filter(row => row && row.name)
    : (session.draft && session.draft.name ? [session.draft] : []);
  if(!drafts.length){
    return {type:'error', text:'I could not get a name for that item.', thinking, session};
  }
  session.draft = drafts.find(row => row.kind === 'habit' || row.kind === 'task') || drafts[0];
  session.drafts = drafts;
  session.awaiting = null;
  const settings = context && context.settings;
  const summary = drafts.length > 1
    ? drafts.map(row => assistantDraftSummary(row, settings)).join('\n')
    : assistantDraftSummary(session.draft, settings);
  return {
    type:'preview',
    draft:session.draft,
    drafts,
    summary,
    thinking,
    session
  };
}

function assistantLocalCreate(session, context, parsed, intent){
  const kind = intent === 'create_habit' ? 'habit' : 'task';
  const name = parsed.itemName;
  if(!name)return null;
  const args = {
    kind,
    name,
    durationMinutes:parsed.durationMinutes,
    due:parsed.due,
    dueTime:parsed.dueTime,
    priority:parsed.priority,
    timesPerPeriod:parsed.rhythm && parsed.rhythm.timesPerPeriod,
    periodDays:parsed.rhythm && parsed.rhythm.periodDays,
    weekdays:parsed.rhythm && parsed.rhythm.weekdays,
    window:parsed.window || undefined,
    place:parsed.places && parsed.places.length ? {names:parsed.places, anywhere:false} : undefined,
    weather:parsed.weather ? {mode:'profile', profile:parsed.weather} : undefined,
    weatherText:parsed.weatherHints && parsed.weatherHints.mentioned ? parsed.text : undefined
  };
  const traceArgs = {};
  Object.keys(args).forEach(key => {
    if(args[key] != null && args[key] !== '')traceArgs[key] = args[key];
  });
  assistantTracePush(session, {t:'tool', step:'local', name:'draft_item', args:assistantTraceClip(traceArgs, 600)});
  const applied = assistantApplyDraftItem(
    args,
    session.draft,
    context.catalog,
    context.now,
    context.settings,
    context.data,
    parsed && parsed.text
  );
  if(!applied.ok){
    assistantTracePush(session, {t:'result', name:'draft_item', ok:false, error:applied.error || 'apply failed'});
    return null;
  }
  session.draft = applied.draft;
  assistantTracePush(session, {
    t:'result',
    name:'draft_item',
    ok:true,
    preview:assistantDraftSummary(applied.draft, context.settings)
  });
  session.intent = intent;
  if(applied.draft.weatherNeedAsk){
    session.awaiting = 'weather';
    return {
      type:'ask',
      question:applied.draft.weatherNeedAsk.question,
      choices:applied.draft.weatherNeedAsk.choices,
      session,
      draft:applied.draft
    };
  }
  return assistantPreviewResult(session, context);
}

function assistantLocalSetting(session, context, parsed){
  const kind = parsed.settingKind;
  const name = parsed.itemName;
  if(!kind || !name)return null;
  const args = {
    kind,
    name,
    weatherText:parsed.weatherHints && parsed.weatherHints.mentioned ? parsed.text : undefined,
    address:parsed.address || undefined,
    window:parsed.window || undefined,
    days:parsed.rhythm && parsed.rhythm.weekdays
  };
  const traceArgs = {};
  Object.keys(args).forEach(key => {
    if(args[key] != null && args[key] !== '')traceArgs[key] = args[key];
  });
  assistantTracePush(session, {t:'tool', step:'local', name:'draft_setting', args:assistantTraceClip(traceArgs, 600)});
  const applied = assistantApplyDraftSetting(
    args,
    session.draft,
    context.catalog,
    context.now,
    context.settings,
    parsed && parsed.text
  );
  if(!applied.ok){
    assistantTracePush(session, {t:'result', name:'draft_setting', ok:false, error:applied.error || 'apply failed'});
    return null;
  }
  session.draft = applied.draft;
  assistantTracePush(session, {
    t:'result',
    name:'draft_setting',
    ok:true,
    preview:assistantDraftSummary(applied.draft, context.settings)
  });
  session.intent = 'create_setting';
  if(applied.draft.weatherNeedAsk){
    session.awaiting = 'weather';
    return {
      type:'ask',
      question:applied.draft.weatherNeedAsk.question,
      choices:applied.draft.weatherNeedAsk.choices,
      session,
      draft:applied.draft
    };
  }
  return assistantPreviewResult(session, context);
}

function assistantLocalComplete(session, context, name){
  assistantTracePush(session, {t:'tool', step:'local', name:'complete_item', args:{name:String(name || '')}});
  const found = typeof assistantFindHabitSmart === 'function'
    ? assistantFindHabitSmart(context.data, name, session && session.parsed && session.parsed.text)
    : assistantFindHabit(context.data, name);
  if(!found.ok){
    assistantTracePush(session, {t:'result', name:'complete_item', ok:false, ask:found.ask || 'which item?'});
    session.awaiting = 'complete';
    session.intent = 'complete_item';
    session.clarifyingRequest = (session.parsed && session.parsed.text) || name || session.clarifyingRequest;
    return {type:'ask', question:found.ask, choices:found.choices || (found.matches || []).map(item => item.name), session};
  }
  const preview = assistantCompletePreview(found, null);
  assistantTracePush(session, {t:'result', name:'complete_item', ok:true, preview:preview.summary});
  session.pendingComplete = preview.pendingComplete;
  session.intent = 'complete_item';
  session.awaiting = null;
  if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
  return {type:'complete', text:preview.summary, alreadyDone:preview.alreadyDone, completeAction:preview.pendingComplete && preview.pendingComplete.action || 'log', pendingComplete:preview.pendingComplete, session};
}

function assistantLocalLookup(session, context, name){
  assistantTracePush(session, {t:'tool', step:'local', name:'lookup_item', args:{name:String(name || '')}});
  const found = typeof assistantFindHabitSmart === 'function'
    ? assistantFindHabitSmart(context.data, name, session && session.parsed && session.parsed.text)
    : assistantFindHabit(context.data, name);
  if(!found.ok){
    assistantTracePush(session, {t:'result', name:'lookup_item', ok:false, ask:found.ask || 'which item?'});
    session.awaiting = 'lookup';
    session.intent = 'lookup_item';
    session.clarifyingRequest = (session.parsed && session.parsed.text) || name || session.clarifyingRequest;
    return {type:'ask', question:found.ask, choices:found.choices || (found.matches || []).map(item => item.name), session};
  }
  session.awaiting = null;
  session.intent = 'lookup_item';
  const text = assistantLookupText(found, context, null, session && session.parsed && session.parsed.text);
  assistantTracePush(session, {t:'result', name:'lookup_item', ok:true, preview:text});
  if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
  return {type:'say', text, session};
}

function assistantTryLocalTurn(text, session, context){
  const parsed = typeof assistantParseUtterance === 'function'
    ? assistantParseUtterance(text, context.catalog, context.now)
    : {intent:'unclear', confident:false};
  session.parsed = parsed;
  assistantTracePush(session, {
    t:'parse',
    facts:typeof assistantCompactFacts === 'function' ? assistantCompactFacts(parsed) : {intent:parsed.intent, name:parsed.itemName},
    awaiting:session.awaiting || null,
    focus:session.draft && session.draft.name ? session.draft.name : null
  });

  if(session.awaiting === 'location-pick' && Array.isArray(session.locationHits) && session.draft){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-location'});
    const raw = assistantNormText(text);
    const hits = session.locationHits;
    const hit = hits.find(item => assistantNormText(item.address || '') === raw || assistantNormText(item.name || '') === raw)
      || hits.find(item => assistantNormText(item.address || '').includes(raw) || assistantNormText(item.name || '').includes(raw));
    if(!hit)return {type:'ask', question:'Which place is that?', choices:hits.map(item => item.address || item.name), session};
    session.draft.lat = hit.lat;
    session.draft.lng = hit.lng;
    session.draft.address = hit.address || session.draft.address;
    session.awaiting = null;
    session.locationHits = null;
    return assistantPreviewResult(session, context);
  }
  if(session.awaiting === 'complete'){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-complete'});
    return assistantLocalComplete(session, context, text);
  }
  if(session.awaiting === 'lookup'){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-lookup'});
    return assistantLocalLookup(session, context, text);
  }
  if(session.awaiting === 'query'){
    // A follow-up like "the gym one" refines the pending query; the model
    // has the transcript and calls answer_weather / answer_schedule again.
    assistantTracePush(session, {t:'path', path:'llm', via:'awaiting-query'});
    return null;
  }
  if(session.awaiting === 'weather' && session.draft){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-weather'});
    const raw = assistantNormText(text);
    const applied = (raw === 'no weather' || raw === 'none' || raw === 'skip')
      ? assistantApplyWeather(session.draft, {mode:'none'}, context.catalog)
      : assistantApplyWeather(session.draft, {mode:'profile', profile:text}, context.catalog);
    if(!applied.ok)return {type:'ask', question:applied.ask || applied.error, choices:applied.choices, session};
    session.draft = applied.draft;
    session.awaiting = null;
    return assistantPreviewResult(session, context);
  }

  if(typeof assistantRequestNeedsModel === 'function' && assistantRequestNeedsModel(text)){
    parsed.factsTrusted = false;
    assistantTracePush(session, {
      t:'path',
      path:'llm',
      via:typeof assistantLooksLikeMultiItem === 'function' && assistantLooksLikeMultiItem(text) ? 'multi-item' : 'long-request'
    });
    return null;
  }

  const missedTurn = typeof assistantTryMissedTurn === 'function'
    ? assistantTryMissedTurn(text, session, context)
    : null;
  if(missedTurn)return missedTurn;

  const queryRoute = assistantQueryRouteHint(text, parsed);
  if(queryRoute){
    parsed.factsTrusted = false;
    assistantTracePush(session, {t:'path', path:'llm', via:queryRoute, intent:parsed.intent});
    return null;
  }

  const focused = Boolean(session.draft && session.draft.name);
  const focusedItem = focused && typeof assistantIsItemKind === 'function' && assistantIsItemKind(session.draft.kind);
  // A focused habit/task is the model's job. Do not parser-patch "use home",
  // "make it 45 minutes", or "change it" — extract + draft_item with currentDraft.
  if(focusedItem)parsed.factsTrusted = false;
  if(!focusedItem){
    const settingFollow = focused && typeof assistantLooksLikeSettingFollowup === 'function'
      && assistantLooksLikeSettingFollowup(text);
    if(!settingFollow){
      const follow = assistantTryFocusFollowup(text, parsed, session, context);
      if(follow){
        assistantTracePush(session, {t:'path', path:'local', via:'focus-followup', type:follow.type});
        return follow;
      }
    }
  }

  if(parsed.intent === 'lookup_item' && parsed.confident){
    assistantTracePush(session, {t:'path', path:'local', via:'lookup'});
    const name = parsed.itemName || (session.draft && session.draft.name) || text;
    return assistantLocalLookup(session, context, name);
  }
  if(parsed.intent === 'complete_item' && parsed.confident){
    assistantTracePush(session, {t:'path', path:'local', via:'complete'});
    const name = parsed.itemName || (session.draft && session.draft.name) || text;
    return assistantLocalComplete(session, context, name);
  }

  if(!parsed.confident){
    parsed.factsTrusted = false;
    assistantTracePush(session, {t:'path', path:'llm', via:'parser-unconfident', intent:parsed.intent});
    return null;
  }
  if(parsed.intent === 'ask_today'){
    assistantTracePush(session, {t:'path', path:'local', via:'ask-today'});
    session.intent = 'ask_today';
    const compact = /\bnext\b/i.test(parsed.text) && !/\b(today|due|left|plan)\b/i.test(parsed.text);
    return {type:'today', text:assistantFormatToday(context.catalog, {compact}), session};
  }
  if(parsed.intent === 'unsupported'){
    assistantTracePush(session, {t:'path', path:'local', via:'unsupported'});
    session.intent = 'unsupported';
    return {
      type:'say',
      text:assistantUnsupportedText(),
      session
    };
  }

  // The fast path must prove it consumed every structural token. Any residue
  // (unknown dates, clocks, rhythms, negation) means it guessed — the model
  // decides instead. See assistantFastPathRisk in assistant-parse.js.
  const risk = typeof assistantFastPathRisk === 'function'
    ? assistantFastPathRisk(parsed.text || text, parsed)
    : null;
  const settingReady = parsed.intent === 'create_setting' && parsed.confident && parsed.settingKind && parsed.itemName;
  if(risk && !settingReady){
    parsed.factsTrusted = false;
    assistantTracePush(session, {t:'path', path:'llm', via:'parser-risk', risk});
    return null;
  }
  if(assistantShouldLocalCreate(parsed, session)){
    assistantTracePush(session, {t:'path', path:'local', via:'create', intent:parsed.intent});
    if(parsed.intent === 'create_setting')return assistantLocalSetting(session, context, parsed);
    return assistantLocalCreate(session, context, parsed, parsed.intent);
  }
  if(focused){
    parsed.factsTrusted = false;
    assistantTracePush(session, {t:'path', path:'llm', via:'focus-continue', intent:parsed.intent});
    return null;
  }
  assistantTracePush(session, {t:'path', path:'llm', via:'no-local-handler', intent:parsed.intent});
  return null;
}

async function assistantCallStep(session, step, complete, onProgress, context){
  const repairing = session.repairs > 0;
  const jsonFallback = Boolean(session.jsonFallback) && step === 'extract';
  if(jsonFallback)session.jsonFallback = false;
  const tools = jsonFallback ? [] : assistantOllamaTools(assistantStepTools(step));
  onProgress && onProgress({phase:'think', step});
  assistantTracePush(session, {t:'step', step, tools:jsonFallback ? [] : assistantStepTools(step), format:jsonFallback ? 'json' : null});
  if(jsonFallback){
    // Native tool JSON failed. Leave the tool-call transcript so Ollama
    // does not keep emitting tool_calls; constrain a fresh JSON object.
    const request = (session.parsed && session.parsed.text) || '';
    const current = typeof assistantCompactDraft === 'function' ? assistantCompactDraft(session.draft) : null;
    const setting = session.intent === 'create_setting'
      || (typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft && session.draft.kind));
    const catalog = (context && context.catalog) || {};
    session.messages = [
      {role:'system', content:setting
        ? 'Reply with one JSON object and nothing else. No markdown, no tools. kind is weather, location, busy, or topic. name is a short title. weatherText, address, and windowText are flat strings. Only keys the user named.'
        : (assistantWideSession(session)
          ? 'Reply with one JSON object and nothing else. No markdown, no tools. If they asked for several items, keys are places (array of {name, address}) and items (array of habits/tasks with the same fields as draft_item). If this is one item, use draft_item fields only. Skip TBA rows with no days and no times. Dummy addresses are fine for new places in a batch.'
          : 'Reply with one JSON object and nothing else. No markdown, no tools. Only keys the user named — do not invent places, topics, duration, or order unless they asked you to pick time, weather, or duration. placeNames only from catalog.places; omit placeNames if they did not name a saved place. If currentDraft is set, keep its name and kind and only add the new fields (placeNames, windowText, rhythm). Keys you may use: kind (habit or task), name (short title), durationMinutes, rhythm, windowText, due (today/tomorrow/YYYY-MM-DD), hardDue (true if that due day is firm), weekdays, placeNames, order, weatherText. windowText is one string, e.g. "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier". Do not nest objects.')},
      {role:'user', content:JSON.stringify({
        request,
        currentDraft:current,
        catalog:{
          date:catalog.date || null,
          places:(catalog.places || []).map(item => item && item.name).filter(Boolean),
          weather:(catalog.weather || []).map(item => item && item.name).filter(Boolean)
        }
      })}
    ];
  }else if(typeof assistantMaybeCompact === 'function'){
    const request = (session.parsed && session.parsed.text) || '';
    const compact = assistantMaybeCompact(session, tools, request);
    if(compact && compact.compacted){
      assistantTracePush(session, {t:'compact', before:compact.before, used:compact.used, limit:compact.limit, ratio:compact.ratio});
    }
  }
  const repairingThinkOff = repairing;
  session.llmCalls += 1;
  const stepStartedAt = Date.now();
  const raw = await complete({
    messages:session.messages,
    tools,
    think:!repairingThinkOff,
    format:jsonFallback ? 'json' : undefined,
    maxPredict:repairingThinkOff
      ? (typeof ASSISTANT_TOOL_TOKENS === 'number' ? ASSISTANT_TOOL_TOKENS : 2048) + 256
      : assistantStepPredict(step, session),
    temperature:repairingThinkOff ? 0.1 : undefined,
    step
  });
  if(typeof assistantNoteContextUsage === 'function')assistantNoteContextUsage(session, raw, tools);
  const parsed = assistantParseReply(raw, step);
  assistantTracePush(session, {
    t:'model',
    step,
    ms:Date.now() - stepStartedAt,
    promptTokens:(raw && raw.prompt_eval_count) || null,
    evalTokens:(raw && raw.eval_count) || null,
    thinking:assistantTraceClip(parsed.thinking, 600),
    content:assistantTraceClip(parsed.content, 300),
    tools:(parsed.toolCalls || []).map(call => ({
      name:call.name,
      args:assistantTraceClip(call.args, 500),
      parseError:call.parseError || null
    })),
    tokens:session.contextUsed || 0,
    limit:session.contextLimit || 0
  });
  return parsed;
}

function assistantPushToolResult(session, parsed, rawCalls, result, opts){
  if(!(opts && opts.replay === false)){
    session.messages.push(assistantReplayMessage(parsed, rawCalls));
  }
  session.messages.push({
    role:'tool',
    content:JSON.stringify(result)
  });
}

function assistantPushChainResult(session, parsed, result){
  const already = session._replayed === parsed;
  assistantPushToolResult(session, parsed, parsed && parsed.toolCalls, result, already ? {replay:false} : undefined);
  session._replayed = parsed;
}

function assistantHandleIntent(session, context, intent, thinking){
  session.intent = intent;
  if(intent === 'ask_today'){
    const compact = session.parsed && /\bnext\b/i.test(session.parsed.text) && !/\b(today|due|left|plan)\b/i.test(session.parsed.text);
    return {type:'today', text:assistantFormatToday(context.catalog, {compact}), thinking, session};
  }
  if(intent === 'edit_item')return null;
  if(intent === 'unclear'){
    if(session.draft && session.draft.name)return null;
    if(assistantWideSession(session))return null;
    return assistantClarifyOutcome(session, {thinking}, {
      question:'That was unclear. Do you want a one-off task, a repeating habit, what is on today, weather or schedule info, or to log something done?',
      choices:ASSISTANT_CONFUSION_CHOICES,
      awaiting:null
    });
  }
  if(intent === 'unsupported'){
    return {
      type:'say',
      text:assistantUnsupportedText(),
      thinking,
      session
    };
  }
  return null;
}

function assistantRecoverLocalDraft(text, session, context){
  const parsed = session.parsed && (session.parsed.itemName || session.parsed.window || session.parsed.intent === 'edit_item')
    ? session.parsed
    : (typeof assistantParseUtterance === 'function'
      ? assistantParseUtterance(text, context.catalog, context.now)
      : null);
  if(parsed)session.parsed = parsed;
  if(!parsed)return null;
  const follow = assistantTryFocusFollowup(text, parsed, session, context);
  if(follow)return follow;
  if(assistantShouldLocalCreate(parsed, session)){
    if(parsed.intent === 'create_setting')return assistantLocalSetting(session, context, parsed);
    return assistantLocalCreate(session, context, parsed, parsed.intent);
  }
  if(parsed.intent === 'complete_item'){
    return assistantLocalComplete(session, context, parsed.itemName || text);
  }
  if(parsed.intent === 'lookup_item'){
    return assistantLocalLookup(session, context, parsed.itemName || text);
  }
  if(parsed.intent === 'ask_today'){
    session.intent = 'ask_today';
    return {type:'today', text:assistantFormatToday(context.catalog), session};
  }
  return null;
}

function assistantIsBrokenToolJson(err){
  const msg = String(err && err.message || err || '');
  return /can't find closing|looks like object|invalid character|unexpected end of json|unterminated/i.test(msg);
}

async function runAssistantTurn(userText, opts = {}){
  const complete = opts.complete || (typeof assistantComplete === 'function' ? assistantComplete : null);
  const context = opts.context || assistantBuildContext();
  const session = opts.session || assistantCreateSession();
  const onProgress = opts.onProgress || (()=>{});
  const text = String(userText || '').trim();
  if(!text)return {type:'error', text:'Type something first.'};
  const turnStartedAt = Date.now();
  // Entry points (add sheet, detail page) pass the intent or item in, so the
  // classify call is provably unnecessary — the turn starts at extract.
  const entryIntent = opts.startIntent === 'create_habit' || opts.startIntent === 'create_task' || opts.startIntent === 'create_setting'
    ? opts.startIntent
    : null;
  session.turnStartedAt = turnStartedAt;
  if((!session.draft || !session.draft.name) && opts.draft && opts.draft.name)session.draft = opts.draft;
  session.llmCalls = 0;
  session.repairs = 0;
  session.modelRetries = 0;
  session.contextUsed = 0;
  session.contextMeasured = 0;
  session.contextRatio = 0;
  session.debug = [];
  session.analyzeList = false;
  session.analyzePasses = 0;
  session.lastGroundedText = null;
  session.lastReadText = null;
  session.lastReadParts = [];
  session.answerAttempts = 0;
  session.researchPending = null;
  session.turnDrafts = null;
  session._responseGen = 0;
  session.executedToolKeys = [];
  session.pendingActions = [];
  session.chainWrite = null;
  session.pendingOutcome = null;
  session.onDebug = typeof opts.onDebug === 'function' ? opts.onDebug : null;
  // The model selects draft_item vs draft_batch. Regexes must not decide how
  // many requests the user made or which semantic route to take.
  session.wide = false;
  session.bulk = false;
  session.contextLimit = opts.contextLimit || session.contextLimit || (typeof assistantGuessContextLimit === 'function'
    ? assistantGuessContextLimit(opts.model)
    : ASSISTANT_DEFAULT_CONTEXT_TOKENS);
  assistantTracePush(session, {
    t:'turn',
    text,
    forceLlm:Boolean(opts.forceLlm),
    modelOnly:!opts.forceLlm && assistantModelOnlyEnabled(),
    focus:session.draft && session.draft.name ? session.draft.name : null,
    entry:opts.entry || null,
    startIntent:entryIntent,
    wide:session.wide === true
  });
  const done = out => {
    if(out && out.type && out.type !== 'ask' && out.type !== 'error' && !out.gaveUp){
      session.awaiting = null;
      session.clarifyingRequest = null;
      session.clarifyCount = 0;
    }
    if(typeof assistantRememberTurn === 'function')assistantRememberTurn(session, text, out);
    return assistantFinishDebug(session, out);
  };

  // Never seed the model with parser guesses. The original text is enough for
  // the LLM; tools remain the authority for names, dates, app data, and writes.
  session.parsed = {text, intent:'unclear', confident:false, factsTrusted:false};
  assistantTracePush(session, {
    t:'parse',
    facts:null,
    factsTrusted:false,
    forceLlm:opts.forceLlm === true,
    modelOnly:true
  });
  assistantTracePush(session, {t:'path', path:'llm', via:opts.forceLlm ? 'force' : 'model-only'});

  if(typeof complete !== 'function')return done({type:'error', text:'Local assistant client is missing.', session});

  session.messages = [
    {role:'system', content:assistantSystemPrompt()},
    {role:'user', content:assistantUserEnvelope(text, context.catalog, session.draft, session.parsed, {
      compact:(session.contextRatio || 0) >= ASSISTANT_CONTEXT_COMPACT_AT,
      recent:typeof assistantEnvelopeRecent === 'function' ? assistantEnvelopeRecent(session) : null
    })}
  ];
  let step = 'classify';
  const hasQueryRecent = Boolean(session.recent && (
    (Array.isArray(session.recent.items) && session.recent.items.length)
    || session.recent.referent
  ));
  if(session.awaiting === 'complete')step = 'complete';
  else if(session.awaiting === 'plan')step = 'plan';
  else if(session.awaiting === 'delete')step = 'delete';
  else if(session.awaiting === 'lookup')step = 'lookup';
  else if(session.awaiting === 'query' || session.awaiting === 'answer')step = session.awaiting === 'answer' ? 'answer' : 'query';
  else if(hasQueryRecent && !entryIntent){
    session.messages.push({role:'user', content:assistantFollowupSteerText()});
  }
  else if(session.draft && session.draft.name){
    step = 'extract';
    const setting = typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind);
    session.messages.push({
      role:'user',
      content:setting
        ? 'The user is changing currentDraft (a settings row). Call draft_setting with only the new fields as flat strings. Keep the same kind and name. weatherText is a patch that merges onto currentDraft.rules; currentDraft.rules lists the existing weather rules. Example: "prefer higher temperature" sets temperature prefer-higher and keeps wind and rain.'
        : 'The user is changing currentDraft only if this is a settings change; otherwise they are referring to it. If this is a question about when/last/history/stats/why, call lookup_item with currentDraft.name. If the spoken name may not match, call find_item. If several saved items could fit, call ask_user — do not guess and do not create. If it logs or corrects a completion, call complete_item; if it plans/unplans one day, call plan_item; if it removes the whole item, call delete_item. Only a settings change calls draft_item with new flat fields. Keep the same name and hid. extractedFacts is absent — read the request yourself. Place replies like "use home and mom\'s house" are placeNames from catalog.places.'
    });
  }else if(session.parsed && session.parsed.intent === 'create_setting' && !session.wide){
    step = 'extract';
    session.intent = 'create_setting';
    session.messages.push({role:'user', content:assistantDraftSettingSteerText()});
  }else if(session.wide && !entryIntent){
    step = 'extract';
    if(!(session.draft && session.draft.name))session.draft = null;
    assistantTracePush(session, {t:'path', path:'llm', via:typeof assistantLooksLikeMultiItem === 'function' && assistantLooksLikeMultiItem(text) ? 'multi-item' : 'long-request'});
    session.messages.push({role:'user', content:assistantWideExtractSteerText()});
  }else if(entryIntent){
    // Context entry: the surface already knows what kind of thing this is,
    // so extract runs first with the matching steer and classify is skipped.
    // Provenance stays auditable via the entry-add / entry-detail path row.
    const trustFacts = typeof assistantTrustParsedFacts === 'function' && assistantTrustParsedFacts(session.parsed);
    const factsHint = trustFacts
      ? ' Copy extractedFacts.'
      : ' extractedFacts is absent — read the request yourself.';
    step = 'extract';
    session.intent = entryIntent;
    assistantTracePush(session, {t:'path', path:'llm', via:'entry' + (opts.entry ? '-' + opts.entry : ''), intent:entryIntent});
    session.messages.push({role:'user', content:session.wide
      ? assistantWideExtractSteerText() + factsHint
      : (entryIntent === 'create_setting'
        ? assistantDraftSettingSteerText() + factsHint
        : assistantDraftItemSteerText(entryIntent, factsHint))});
  }
  if(session.clarifyingRequest && session.clarifyingRequest !== text
    && (session.awaiting || assistantLooksLikeNameReply(text))){
    session.messages.push({
      role:'user',
      content:'Earlier they asked: "' + session.clarifyingRequest + '". They just named the item. Continue that same action with this exact saved title. Do not create a new item.'
    });
  }

  const maxCalls = assistantWideSession(session)
    ? (typeof ASSISTANT_MAX_LLM_CALLS_BATCH === 'number' ? ASSISTANT_MAX_LLM_CALLS_BATCH : 12)
    : ASSISTANT_MAX_LLM_CALLS;
  let parsed = null;
  let queuedCalls = [];
  while(session.llmCalls < maxCalls || queuedCalls.length){
    if(!queuedCalls.length){
      if(session.llmCalls >= maxCalls)break;
      try{
        parsed = await assistantCallStep(session, step, complete, onProgress, context);
        session.modelRetries = 0;
      }catch(err){
        const errText = String(err && err.message || err);
        assistantTracePush(session, {t:'error', step, error:assistantTraceClip(errText, 300)});
        // Invalid/truncated tool JSON is a harness turn, not a dead end: steer
        // and retry the same step, the way Pi / little-coder keep the loop in flow.
        if(assistantIsBrokenToolJson(err) && session.repairs < ASSISTANT_MAX_REPAIRS){
          session.repairs += 1;
          session.jsonFallback = step === 'extract';
          assistantTracePush(session, {t:'repair', step, error:errText, n:session.repairs, via:'broken-json'});
          session.messages.push({role:'user', content:assistantRepairText(step, errText)});
          continue;
        }
        const retryCap = typeof ASSISTANT_MAX_MODEL_RETRIES === 'number' ? ASSISTANT_MAX_MODEL_RETRIES : 1;
        if(assistantIsTransientModelError(err) && session.modelRetries < retryCap && session.llmCalls < maxCalls){
          session.modelRetries += 1;
          assistantTracePush(session, {t:'retry', step, error:assistantTraceClip(errText, 160), n:session.modelRetries});
          continue;
        }
        if(assistantCanFinalize(session) || session.lastGroundedText || session.lastReadText){
          assistantTracePush(session, {t:'path', path:'llm', via:'partial-after-error', step});
          return done(assistantPartialFailure(session, err));
        }
        return done({type:'error', text:assistantFriendlyError(err), session});
      }
      queuedCalls = (parsed.toolCalls || []).slice();
      session._responseGen = (session._responseGen || 0) + 1;
      session._replayed = null;
    }
    const allowed = new Set(assistantStepTools(step));
    let call = assistantTakeQueuedCall(queuedCalls, allowed);
    if(call && call.name && call.name !== 'classify_intent')assistantDropClassifyCalls(queuedCalls);
    if(!call || call.parseError){
      const spoken = parsed && parsed.content && String(parsed.content).trim();
      const narration = typeof assistantLooksLikeToolNarration === 'function' && assistantLooksLikeToolNarration(spoken);
      const canKeepGoing = (step === 'answer' || session.analyzeList || session.lastGroundedText || session.chainWrite)
        && (session.answerAttempts || 0) < 2
        && session.llmCalls < maxCalls;
      if(canKeepGoing && narration){
        session.answerAttempts = (session.answerAttempts || 0) + 1;
        if(parsed)session.messages.push(assistantReplayMessage(parsed));
        session.messages.push({
          role:'user',
          content:'Do not describe the tool call. Call the next matching tool for the rest of the request now, or answer from the tool data you already have. Never invent names or numbers.'
        });
        queuedCalls = [];
        step = 'answer';
        continue;
      }
      if(assistantCanFinalize(session)){
        return done(assistantFinalizeFromAnswer(session, parsed));
      }
      if(session.repairs >= ASSISTANT_MAX_REPAIRS){
        assistantTracePush(session, {t:'repair', step, error:call && call.parseError || 'no tool', gaveUp:true});
        if(assistantCanFinalize(session))return done(assistantFinalizeFromAnswer(session, parsed));
        if(session.researchPending)return done(assistantPartialFailure(session));
        if(assistantWideSession(session)){
          return done({type:'error', text:'I could not turn that into a Tings action. Try a shorter request, or add it from +.', thinking:parsed && parsed.thinking, session});
        }
        return done(assistantClarifyOutcome(session, parsed, {
          question:assistantConfusionQuestion(parsed),
          choices:ASSISTANT_CONFUSION_CHOICES,
          awaiting:assistantAwaitingFromAsk(step, text),
          request:text
        }));
      }
      session.repairs += 1;
      if(call && call.parseError && assistantIsBrokenToolJson(call.parseError) && step === 'extract'){
        session.jsonFallback = true;
      }
      assistantTracePush(session, {t:'repair', step, error:call && call.parseError || 'no tool', n:session.repairs});
      session.messages.push(assistantReplayMessage(parsed));
      session.messages.push({role:'user', content:call && call.parseError
        ? assistantRepairText(step, call.parseError)
        : assistantNeedToolText(step)});
      queuedCalls = [];
      continue;
    }
    const callKey = assistantToolCallKey(call);
    if((session.executedToolKeys || []).indexOf(callKey) >= 0){
      // The model repeated a setting that was staged before it saw this
      // research. That is the signal the setting is the action — do not
      // invent a task or habit to consume the read.
      if(call.name === 'draft_setting' && session.researchPending
        && Array.isArray(session.turnDrafts) && session.turnDrafts.length){
        session.researchPending = null;
        assistantPublishTurnDrafts(session);
        return done(assistantPreviewResult(session, context, parsed && parsed.thinking));
      }
      if(queuedCalls.length)continue;
      if(assistantCanFinalize(session))return done(assistantFinalizeFromAnswer(session, parsed));
      if(session.repairs >= ASSISTANT_MAX_REPAIRS)return done(assistantPartialFailure(session));
      session.repairs += 1;
      session.messages.push({role:'user', content:'That research already ran. Do not repeat it. Call the create, change, complete, plan, or delete tool it was preparing for.'});
      queuedCalls = [];
      step = 'answer';
      continue;
    }
    if(!allowed.has(call.name)){
      if(call.name === 'draft_item' && (step === 'classify' || step === 'extract')){
        step = 'extract';
      }else if(call.name === 'draft_setting' && (step === 'classify' || step === 'extract')){
        step = 'extract';
      }else if(call.name === 'draft_batch' && (step === 'classify' || step === 'extract')){
        step = 'extract';
      }else if(call.name === 'complete_item' && (step === 'classify' || step === 'complete' || step === 'query' || step === 'answer')){
        step = step === 'query' || step === 'answer' ? 'answer' : 'complete';
      }else if(call.name === 'plan_item' && (step === 'classify' || step === 'plan' || step === 'query' || step === 'answer')){
        step = step === 'query' || step === 'answer' ? 'answer' : 'plan';
      }else if(call.name === 'delete_item' && (step === 'classify' || step === 'delete' || step === 'query' || step === 'answer')){
        step = step === 'query' || step === 'answer' ? 'answer' : 'delete';
      }else if(call.name === 'lookup_item' && (step === 'classify' || step === 'lookup' || step === 'query' || step === 'answer')){
        step = (step === 'query' || step === 'answer' || session.analyzeList) ? 'answer' : 'lookup';
      }else if(call.name === 'find_item' && (step === 'classify' || step === 'extract' || step === 'lookup' || step === 'complete' || step === 'plan' || step === 'delete' || step === 'query' || step === 'answer')){
        // fall through
      }else if(session.draft && session.draft.name && (call.name === 'set_window' || call.name === 'set_weather' || call.name === 'set_place')){
        step = 'extract';
      }else if(call.name === 'ask_user'){
        // fall through
      }else{
        if(session.repairs >= ASSISTANT_MAX_REPAIRS){
          return done({type:'error', text:`I needed ${assistantStepTools(step)[0]}, not ${call.name}. Try again in one sentence.`, thinking:parsed.thinking, session});
        }
        session.repairs += 1;
        assistantPushToolResult(session, parsed, parsed.toolCalls, {
          ok:false,
          error:`unexpected tool ${call.name}`,
          expected:assistantStepTools(step)
        });
        continue;
      }
    }

    session.executedToolKeys = (session.executedToolKeys || []).concat([callKey]);
    assistantTracePush(session, {t:'tool', step, name:call.name, args:assistantTraceClip(call.args, 600)});
    // Query tools (answer_schedule) may await a what-if week rebuild; the
    // other tools return plain objects, so the await is free for them.
    const result = await assistantExecuteTool(call.name, call.args, session, context);
    assistantTracePush(session, {
      t:'result',
      name:call.name,
      ok:Boolean(result && result.ok),
      error:result && result.error || null,
      ask:result && result.ask || null,
      preview:assistantResultPreview(call, result, session, context.settings)
    });
    if(!result.ok){
      if(result.ask){
        assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:false, error:result.error, ask:result.ask});
        const fromTool = call.name === 'complete_item' ? 'complete'
          : call.name === 'plan_item' ? 'plan'
          : call.name === 'delete_item' ? 'delete'
          : call.name === 'lookup_item' ? 'lookup'
          : call.name === 'find_item' && ['complete','plan','delete','lookup'].includes(String(call.args && call.args.action || ''))
            ? String(call.args.action)
          : (call.name === 'draft_item' || call.name === 'draft_setting') ? 'edit'
          : call.name === 'set_place' ? 'place'
          : (call.name === 'answer_weather' || call.name === 'answer_schedule' || call.name === 'answer_items' || call.name === 'answer_settings') ? 'query'
            : assistantAwaitingFromAsk(step, text);
        session.awaiting = fromTool || session.awaiting || null;
        session.clarifyingRequest = text || session.clarifyingRequest || null;
        return done(assistantClarifyOutcome(session, parsed, {
          required:true,
          question:result.ask,
          choices:result.choices || (result.candidates || []).map(item => item.name) || (result.matches || []).map(item => item.name),
          awaiting:fromTool || session.awaiting,
          request:text
        }));
      }
      if(session.repairs >= ASSISTANT_MAX_REPAIRS){
        return done({type:'error', text:result.error || 'That did not match a Tings field.', thinking:parsed.thinking, session});
      }
      session.repairs += 1;
      assistantPushToolResult(session, parsed, parsed.toolCalls, result);
      session.messages.push({role:'user', content:assistantRepairText(step, result.error || 'invalid arguments')});
      continue;
    }

    session.repairs = 0;

    if(assistantIsReadTool(call.name) && call.args && call.args.purpose === 'prepare_action'){
      session.researchPending = {tool:call.name, args:call.args, gen:session._responseGen || 0};
    }else if(assistantIsActionTool(call.name) && assistantActionClearsResearch(session, call)){
      session.researchPending = null;
    }

    if(result.noChange){
      const noChangeText = result.text || result.summary || 'Nothing changed.';
      assistantRememberGrounded(session, {text:noChangeText, noChange:true}, call);
      assistantPushChainResult(session, parsed, {
        ok:true,
        noChange:true,
        text:noChangeText,
        hint:assistantQueryContinueHint()
      });
      session.analyzeList = true;
      session.awaiting = 'answer';
      step = 'answer';
      if(queuedCalls.length)continue;
      continue;
    }

    if(call.name === 'classify_intent'){
      queuedCalls = [];
      const guessed = session.parsed || {};
      const trustFacts = typeof assistantTrustParsedFacts === 'function' && assistantTrustParsedFacts(session.parsed);
      let intent = trustFacts && typeof assistantPreferIntent === 'function'
        ? assistantPreferIntent(result.intent, guessed)
        : result.intent;
      if(guessed.intent === 'create_setting' && guessed.confident
        && (intent === 'unsupported' || intent === 'unclear' || intent === 'create_task')){
        intent = 'create_setting';
      }
      assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, intent});
      if(intent === 'ask_today' || intent === 'ask_weather' || intent === 'ask_schedule' || intent === 'ask_items' || intent === 'ask_settings'){
        // Query step: the model fills day/window/name, Tings computes the
        // answer from live plan + forecast data. Never guessed by the model.
        step = 'query';
        session.messages.push({role:'user', content:intent === 'ask_weather'
          ? 'Call answer_weather. query day = a date. query window = a span; omit end for the rest of the day. query hours = which time matches: sortBy wind, sortOrder asc, position 1 is lowest wind; conditions AND together, for example temperature relative high and wind relative very_low. query item = a saved item’s weather fit; include start for "after 5pm" even if it is not planned. query compare = start versus compareStart, such as 5pm versus 1 hour before sunset, with name when the habit’s rules should decide. Resolve dates against catalog.date.'
          : intent === 'ask_schedule' || intent === 'ask_today'
            ? 'Call answer_schedule. query free = open time, freest = freest week day, conflict = what a start/end window displaces, missed = today’s missed-pill list, day = a day agenda, week = overview. Put every requested filter/rank/ordinal/count into conditions + sortBy/sortOrder + position/limit + aggregate so Tings computes it. Example: second most overdue missed = query missed, sortBy overdue_days, sortOrder desc, position 2. If they asked several independent things, call a tool for each. Use lookup_item only for history/stats/why. Resolve dates against catalog.date.'
            : intent === 'ask_items'
              ? 'Call answer_items. Use list for saved-item questions and put all AND filters in conditions, ranking in sortBy/sortOrder, an ordinal in position, and counts or duration math in aggregate. Importance sorts ascending (P0 first); urgency sorts descending. Use progress only for a concise today summary.'
              : 'Call answer_settings for places, weather, topics, or busy times.'});
        continue;
      }
      const handled = assistantHandleIntent(session, context, intent, parsed.thinking);
      if(handled)return done(handled);
      const factsHint = trustFacts
        ? ' Copy extractedFacts.'
        : ' extractedFacts is absent — read the request yourself.';
      if(intent === 'create_setting'){
        step = 'extract';
        session.messages.push({role:'user', content:assistantDraftSettingSteerText() + factsHint});
        continue;
      }
      if(session.wide && (intent === 'create_habit' || intent === 'create_task' || intent === 'unclear')){
        step = 'extract';
        session.messages.push({role:'user', content:assistantWideExtractSteerText() + factsHint});
        continue;
      }
      if(intent === 'edit_item' || (session.draft && session.draft.name && (intent === 'create_task' || intent === 'create_habit' || intent === 'unclear'))){
        step = 'extract';
        session.messages.push({
          role:'user',
          content:'The user refers to currentDraft if it is set, or an existing named item. Questions about when/last/history/stats/why use lookup_item; completion or correction uses complete_item; one-day plan changes use plan_item; whole-item removal uses delete_item. Only a settings change calls draft_item with every new field in one flat call. Strings are ok: rhythm "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend", windowText "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier". Keep the same name and hid. Place replies like "use home and mom\'s house" are placeNames from catalog.places.' + factsHint
        });
        continue;
      }
      if(intent === 'complete_item'){
        if(trustFacts && session.parsed && session.parsed.itemName){
          const local = assistantLocalComplete(session, context, session.parsed.itemName);
          if(local)return done({...local, thinking:parsed.thinking});
        }
        step = 'complete';
        session.messages.push({role:'user', content:'Call complete_item with the catalog or spoken item name.'});
        continue;
      }
      if(intent === 'plan_item'){
        step = 'plan';
        session.messages.push({role:'user', content:'Call plan_item with the existing item name and date. action add creates or replaces that day’s one-day plan; action remove unplans that date. Include time only for a fixed appointment and place only when the user named a saved catalog place.'});
        continue;
      }
      if(intent === 'delete_item'){
        step = 'delete';
        session.messages.push({role:'user', content:'Call delete_item with the existing item name. Tings will ask for confirmation.'});
        continue;
      }
      if(intent === 'lookup_item'){
        if(trustFacts && session.parsed && session.parsed.itemName){
          const local = assistantLocalLookup(session, context, session.parsed.itemName);
          return done({...local, thinking:parsed.thinking});
        }
        step = 'lookup';
        session.messages.push({role:'user', content:'Call lookup_item with the item name. If the spoken name may not match a saved title, call find_item first. If several saved items could fit, call ask_user instead of guessing.'});
        continue;
      }
      step = 'extract';
      session.messages.push({
        role:'user',
        content:session.wide
          ? assistantWideExtractSteerText() + factsHint
          : assistantDraftItemSteerText(intent, factsHint)
      });
      continue;
    }

    if(call.name === 'ask_user'){
      assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, waiting:true});
      return done(assistantClarifyOutcome(session, parsed, {
        question:result.ask,
        choices:result.choices,
        awaiting:assistantAwaitingFromAsk(step, text) || session.awaiting || null,
        request:text
      }));
    }

    if(call.name === 'complete_item'){
      if(!result.alreadyDone)assistantQueuePendingAction(session, 'complete', result);
      assistantRememberGrounded(session, {text:result.summary}, call);
      assistantPushChainResult(session, parsed, {
        ok:true,
        summary:result.summary,
        pending:'complete',
        hint:assistantWriteContinueHint()
      });
      if(queuedCalls.length)continue;
      session.analyzePasses = (session.analyzePasses || 0) + 1;
      if(session.analyzePasses > 6)return done(assistantFinalizeFromAnswer(session, parsed));
      session.analyzeList = true;
      session.awaiting = 'answer';
      step = 'answer';
      continue;
    }
    if(call.name === 'plan_item'){
      assistantQueuePendingAction(session, 'plan', result);
      assistantRememberGrounded(session, {text:result.summary}, call);
      assistantPushChainResult(session, parsed, {
        ok:true,
        summary:result.summary,
        pending:'plan',
        hint:assistantWriteContinueHint()
      });
      if(queuedCalls.length)continue;
      session.analyzePasses = (session.analyzePasses || 0) + 1;
      if(session.analyzePasses > 6)return done(assistantFinalizeFromAnswer(session, parsed));
      session.analyzeList = true;
      session.awaiting = 'answer';
      step = 'answer';
      continue;
    }
    if(call.name === 'delete_item'){
      assistantQueuePendingAction(session, 'delete', result);
      assistantRememberGrounded(session, {text:result.summary}, call);
      assistantPushChainResult(session, parsed, {
        ok:true,
        summary:result.summary,
        pending:'delete',
        hint:assistantWriteContinueHint()
      });
      if(queuedCalls.length)continue;
      session.analyzePasses = (session.analyzePasses || 0) + 1;
      if(session.analyzePasses > 6)return done(assistantFinalizeFromAnswer(session, parsed));
      session.analyzeList = true;
      session.awaiting = 'answer';
      step = 'answer';
      continue;
    }
    if(call.name === 'lookup_item' || call.name === 'answer_weather' || call.name === 'answer_schedule' || call.name === 'answer_items' || call.name === 'answer_settings'){
      assistantRememberGrounded(session, result, call);
      if(!queuedCalls.length && !session.researchPending && assistantReadCallIsTerminal(call, result)){
        return done(assistantFinalizeFromAnswer(session, parsed, result.text));
      }
      session.analyzePasses = (session.analyzePasses || 0) + 1;
      if(session.analyzePasses > 6){
        if(session.researchPending)return done(assistantPartialFailure(session));
        return done(assistantFinalizeFromAnswer(session, parsed, result.text));
      }
      assistantPushChainResult(session, parsed, {
        ok:true,
        text:result.text,
        items:Array.isArray(result.items) ? result.items : undefined,
        item:result.item || null,
        hint:Array.isArray(result.items) && result.items.length
          ? assistantQueryListHint()
          : assistantQueryContinueHint()
      });
      session.analyzeList = true;
      session.awaiting = 'answer';
      step = 'answer';
      if(queuedCalls.length)continue;
      continue;
    }
    if(call.name === 'find_item'){
      assistantPushChainResult(session, parsed, {
        ok:true,
        matches:result.matches || [],
        hint:(result.matches && result.matches.length)
          ? 'Call lookup_item, complete_item, plan_item, or delete_item with the exact saved name. If several still fit, call ask_user — do not guess.'
          : 'No saved item is close to that name. If they asked about an existing item, say you cannot find it. If they asked to create one, call draft_item.'
      });
      if(queuedCalls.length)continue;
      if(step === 'query' || step === 'answer' || session.analyzeList){
        step = 'answer';
        session.analyzeList = true;
      }
      continue;
    }

    if(call.name === 'draft_batch'){
      (Array.isArray(session.drafts) ? session.drafts : []).forEach(row => assistantStageTurnDraft(session, row));
      if(queuedCalls.length){
        const stagedSummary = (session.drafts || []).map(row => assistantDraftSummary(row, context.settings)).filter(Boolean).join('\n');
        if(assistantQueuedCreate(queuedCalls))session.draft = null;
        assistantPushChainResult(session, parsed, {
          ok:true,
          preview:stagedSummary,
          staged:true
        });
        continue;
      }
    }
    if((call.name === 'draft_item' || call.name === 'draft_setting') && session.draft && session.draft.name){
      assistantStageTurnDraft(session, session.draft);
    }
    const keepDrafting = assistantDraftShouldContinue(session, call, queuedCalls);
    const draftNeedsAnswer = (call.name === 'draft_item' && result.ask && !session.bulk)
      || Boolean(session.draft && session.draft.weatherNeedAsk);
    if(keepDrafting && !draftNeedsAnswer){
      const stagedSummary = assistantDraftSummary(session.draft, context.settings);
      const stagedSetting = session.draft && typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind);
      if(session.draft && (stagedSetting || assistantQueuedCreate(queuedCalls))){
        session.draft = null;
      }
      assistantPushChainResult(session, parsed, queuedCalls.length ? {
        ok:true,
        preview:stagedSummary,
        staged:true
      } : {
        ok:true,
        preview:stagedSummary,
        staged:true,
        hint:'This draft is staged for the same confirmation. It has not seen the prepare_action result, so that research is still open. Call the action the user asked for, and use the research when that action depends on a day, time, or duration. If an item should use a staged weather profile, set weatherProfile to that profile name. Do not invent a task or habit they did not ask for. If this staged setting is the whole action, call draft_setting again with the same name.'
      });
      if(!queuedCalls.length){
        session.analyzeList = true;
        session.awaiting = 'answer';
        step = 'answer';
      }
      continue;
    }

    assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, preview:assistantDraftSummary(session.draft, context.settings)});

    if(call.name === 'draft_item' && result.ask && !session.bulk){
      return done({
        type:'ask',
        question:result.ask,
        choices:result.choices || (result.matches || []).map(item => item && item.name).filter(Boolean),
        thinking:parsed.thinking,
        draft:session.draft,
        session
      });
    }
    assistantPublishTurnDrafts(session);
    if(call.name === 'draft_batch' || (Array.isArray(session.drafts) && session.drafts.length > 1)){
      return done(assistantPreviewResult(session, context, parsed.thinking));
    }
    if(session.wide && !session.bulk && typeof assistantLooksLikeMultiItem === 'function' && assistantLooksLikeMultiItem(text)
      && (call.name === 'draft_item' || call.name === 'draft_setting') && !session.batchSteer){
      session.batchSteer = true;
      session.messages.push({role:'user', content:assistantWideExtractSteerText() + ' If they asked for several items, call draft_batch with the row you just drafted plus every remaining item. If this really is one item, call draft_item again with the same fields.'});
      continue;
    }
    if(session.draft && session.draft.weatherNeedAsk){
      return done(assistantClarifyOutcome(session, parsed, {
        required:true,
        question:session.draft.weatherNeedAsk.question,
        choices:session.draft.weatherNeedAsk.choices,
        awaiting:'weather',
        request:text
      }));
    }

    return done(assistantPreviewResult(session, context, parsed.thinking));
  }
  if(session.researchPending)return done(assistantPartialFailure(session));
  if(session.lastGroundedText || session.chainWrite || (session.pendingActions && session.pendingActions.length)){
    return done(assistantFinalizeFromAnswer(session, parsed));
  }
  if(assistantWideSession(session)){
    return done({type:'error', text:'That took too many steps. Try a shorter request, or add it from +.', session});
  }
  return done(assistantClarifyOutcome(session, parsed, {
    question:assistantConfusionQuestion(parsed),
    choices:ASSISTANT_CONFUSION_CHOICES,
    awaiting:assistantAwaitingFromAsk(step, text),
    request:text
  }));
}

function assistantReachErrorText(pageOrigin){
  const origin = pageOrigin == null
    ? (typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '')
    : String(pageOrigin || '');
  const url = typeof assistantSettings === 'function' ? assistantSettings().url : '';
  const lan = url && typeof assistantUrlIsLoopback === 'function' && !assistantUrlIsLoopback(url);
  if(origin && lan){
    return 'Cannot reach that laptop address. On the laptop, allow this website in Ollama and fully quit and reopen it. Then run “tailscale serve --bg 11434” and paste the printed https://…ts.net URL here. Plain http:// is blocked from the secure phone app.';
  }
  if(origin){
    return `Cannot reach the local model from this website. Open Settings → local assistant, run the allow command, then fully quit and reopen Ollama.`;
  }
  return 'Cannot reach the local model. Keep Ollama running on this computer.';
}

function assistantFriendlyError(err, pageOrigin){
  let msg = String(err && err.message || err || '');
  try{
    const parsed = JSON.parse(msg);
    if(parsed && parsed.error)msg = String(parsed.error);
  }catch(_){}
  if(/local network access is blocked/i.test(msg))return msg;
  if(/Failed to fetch|NetworkError|Load failed/i.test(msg)){
    return assistantReachErrorText(pageOrigin);
  }
  if(/403/.test(msg)){
    const origin = pageOrigin == null
      ? (typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '')
      : String(pageOrigin || '');
    if(origin)return 'Ollama blocked this website. Open Settings → local assistant and follow the allow steps, then quit and reopen Ollama.';
    return 'Ollama blocked this website. Open Settings → local assistant and follow the allow steps.';
  }
  if(/404/.test(msg))return 'That model is not on this computer. Tap list models and pick a Qwen3.8 tag.';
  if(/aborted|AbortError/i.test(msg))return 'Cancelled.';
  if(assistantIsBrokenToolJson(msg)){
    return 'The local model stumbled on that sentence. Try it shorter, or add it from +.';
  }
  return msg || 'The local model did not answer.';
}
