// Guided Qwen3.8 loop: think, then tool calls that actually create or change
// items. Clear phrasing can still be applied locally; the model fills the rest.

function assistantSystemPrompt(){
  return [
    'You are the Tings assistant in this app on this computer.',
    'Think, then call a tool. Do not save. Do not invent habit JSON.',
    'create_task = one-off. create_habit = repeating. create_setting = a weather profile, place, busy time, or topic. ask_today = what is on today or next.',
    'complete_item = already did it. lookup_item = when is it / did I do it.',
    'draft_item creates or changes an item. Put every setting the user named in that one call and omit the rest. name is a short title only — never copy the rest of the request into name. Identity: name, newName, habitKind (build/limit/stop), emoji, emojiColor, topics, priority. Schedule: rhythm, timesPerPeriod, periodDays, weekdays, monthDays, preferredWeekdays, preferredMonthDays, due, dueTime, hardDue, planBy, windowText, preferredWindowText, earlyDays, delayDays, before, after, order, option. Effort: durationMinutes, breakable, minChunkMinutes, autoMarkMinutes, trackValue. Place/weather: placeNames, anywhere, placePrefs, weatherProfile, weatherText, showWeather, weatherAtPlace, weatherPlace. Other: pinned, snooze, sharedDisplay, sharedComplete, links. If they name weather conditions and catalog.weather has no match, still set weatherText — Tings will create a profile.',
    'draft_setting creates or changes a weather profile, place, busy time, or topic. kind is weather, location, busy, or topic. "Create a weather profile for barbecuing" → kind weather, name Barbecuing. Weather rules go in weatherText as one string.',
    'Example: "45 minute limit habit called Kettlebells, topics health, every Tuesday and Friday, urgent" → name "Kettlebells", habitKind "limit", durationMinutes 45, topics "health", rhythm "every Tuesday and Friday", priority 0.',
    'Example: "Stretch at Home, prefer Home high, right after Walk same day, later of 6pm and sunset until isha" → name "Stretch", placeNames "Home", placePrefs "Home high", order "right after Walk, same day", windowText "later of 6pm and sunset until isha".',
    'If currentDraft is a weather profile, place, busy time, or topic, call draft_setting with only the new fields. If currentDraft is a habit or task, "it" / "this" / "that" is that item. Keep its name and hid. Call draft_item with only the new fields. "Add the location home" or "use home and mom\'s house" sets placeNames on currentDraft — it is not a new item. Do not classify unclear when currentDraft is set.',
    'If extractedFacts is present, copy those fields into the tool, but resolve dates yourself: catalog.date is today (ISO date + weekday), so relative phrases like "day after tomorrow" or "two days after tomorrow" become an exact due YYYY-MM-DD. If extractedFacts is absent, read the request yourself. You may fill duration, windowText, and weatherText when they asked you to pick those. placeNames must be catalog.places names the user named — never invent backyard, park, or any place that is not in catalog.places. If they did not name a saved place, omit placeNames. sunset means maghrib.',
    'If a name is ambiguous, call ask_user with one short question.',
    'On extract, call draft_item with flat strings only. Do not nest window or place objects. If a tool call is invalid or cut off, retry that tool with smaller string arguments — Tings will steer you.'
  ].join(' ');
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
  // Local facts are only attached when the fast path fully consumed the
  // utterance; a partial parse must not poison the model with a wrong due.
  const facts = parsed && parsed.factsTrusted !== false && typeof assistantCompactFacts === 'function'
    ? assistantCompactFacts(parsed)
    : null;
  if(facts)payload.extractedFacts = facts;
  const current = typeof assistantCompactDraft === 'function' ? assistantCompactDraft(draft) : null;
  if(current)payload.currentDraft = current;
  return JSON.stringify(payload);
}

function assistantDraftSettingSteerText(){
  return 'Call draft_setting. kind is weather, location, busy, or topic. name is a short title. Weather rules go in weatherText as one string (example: "not raining, wind under 25, above 15C"). Place address in address. Busy window in windowText. Do not call draft_item for a weather profile, place, busy time, or topic.';
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

function assistantNeedToolText(step){
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
  return {draft:null, messages:[], llmCalls:0, repairs:0, intent:null, awaiting:null, pendingComplete:null, pendingEdit:null, parsed:null, debug:[]};
}

function assistantDebugEnabled(){
  if(typeof sortSettings !== 'undefined' && sortSettings && sortSettings.localAssistantDebug)return true;
  if(typeof loadSortSettings === 'function'){
    const s = loadSortSettings();
    return Boolean(s && s.localAssistantDebug);
  }
  return false;
}

// "always use Qwen" setting: the local fast path never answers.
function assistantModelOnlyEnabled(){
  if(typeof sortSettings !== 'undefined' && sortSettings && sortSettings.localAssistantModelOnly)return true;
  if(typeof loadSortSettings === 'function'){
    const s = loadSortSettings();
    return Boolean(s && s.localAssistantModelOnly);
  }
  return false;
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
      return `model ${ev.step || ''}  tools ${tools}${tokens}${think}`;
    }
    case 'tool':
      return `call ${ev.name}${ev.step ? ` @${ev.step}` : ''}  ${assistantDebugJson(ev.args)}`;
    case 'result':
      return `result ${ev.name}  ${ev.ok ? 'ok' : 'fail'}${ev.error ? `  ${ev.error}` : ''}${ev.ask ? `  ask ${ev.ask}` : ''}${ev.preview ? `  ${ev.preview}` : ''}`;
    case 'repair':
      return `repair${ev.gaveUp ? ' gave up' : ''}${ev.n ? ` #${ev.n}` : ''}  ${ev.error || ''}`;
    case 'error':
      return `error @${ev.step || '?'}  ${ev.error || ''}`;
    case 'done':
      return `done ${ev.type || '?'}${ev.intent ? `  ${ev.intent}` : ''}  llm ${ev.llmCalls || 0}${ev.text ? `  ${String(ev.text).slice(0, 160)}` : ''}`;
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
  if(!session.draft || !session.draft.name){
    return {type:'error', text:'I could not get a name for that item.', thinking, session};
  }
  session.awaiting = null;
  return {
    type:'preview',
    draft:session.draft,
    summary:assistantDraftSummary(session.draft, context.settings),
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
  const found = assistantFindHabit(context.data, name);
  if(!found.ok){
    assistantTracePush(session, {t:'result', name:'complete_item', ok:false, ask:found.ask || 'which item?'});
    session.awaiting = 'complete';
    session.intent = 'complete_item';
    return {type:'ask', question:found.ask, choices:(found.matches || []).map(item => item.name), session};
  }
  const preview = assistantCompletePreview(found, null);
  assistantTracePush(session, {t:'result', name:'complete_item', ok:true, preview:preview.summary});
  session.pendingComplete = preview.pendingComplete;
  session.intent = 'complete_item';
  session.awaiting = null;
  if(typeof assistantMaybeFocusFound === 'function')assistantMaybeFocusFound(session, found, context);
  return {type:'complete', text:preview.summary, alreadyDone:preview.alreadyDone, pendingComplete:preview.pendingComplete, session};
}

function assistantLocalLookup(session, context, name){
  assistantTracePush(session, {t:'tool', step:'local', name:'lookup_item', args:{name:String(name || '')}});
  const found = assistantFindHabit(context.data, name);
  if(!found.ok){
    assistantTracePush(session, {t:'result', name:'lookup_item', ok:false, ask:found.ask || 'which item?'});
    session.awaiting = 'lookup';
    session.intent = 'lookup_item';
    return {type:'ask', question:found.ask, choices:(found.matches || []).map(item => item.name), session};
  }
  session.awaiting = null;
  session.intent = 'lookup_item';
  const text = assistantLookupText(found, context);
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
      text:'I can add a task, habit, weather profile, place, busy time, or topic, tell you what is on today, look one up, or log something done. I cannot reschedule the week or delete items.',
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
  if(parsed.intent === 'complete_item'){
    assistantTracePush(session, {t:'path', path:'local', via:'complete'});
    const name = parsed.itemName || (session.draft && session.draft.name) || text;
    return assistantLocalComplete(session, context, name);
  }
  if(parsed.intent === 'lookup_item'){
    assistantTracePush(session, {t:'path', path:'local', via:'lookup'});
    const name = parsed.itemName || (session.draft && session.draft.name) || text;
    return assistantLocalLookup(session, context, name);
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
        : 'Reply with one JSON object and nothing else. No markdown, no tools. Only keys the user named — do not invent places, topics, duration, or order unless they asked you to pick time, weather, or duration. placeNames only from catalog.places; omit placeNames if they did not name a saved place. If currentDraft is set, keep its name and kind and only add the new fields (placeNames, windowText, rhythm). Keys you may use: kind (habit or task), name (short title), durationMinutes, rhythm, windowText, due (today/tomorrow/YYYY-MM-DD), hardDue (true if that due day is firm), weekdays, placeNames, order, weatherText. windowText is one string, e.g. "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier". Do not nest objects.'},
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
  const raw = await complete({
    messages:session.messages,
    tools,
    think:!repairingThinkOff,
    format:jsonFallback ? 'json' : undefined,
    maxPredict:repairingThinkOff
      ? (typeof ASSISTANT_TOOL_TOKENS === 'number' ? ASSISTANT_TOOL_TOKENS : 2048) + 256
      : assistantStepPredict(step),
    temperature:repairingThinkOff ? 0.1 : undefined,
    step
  });
  if(typeof assistantNoteContextUsage === 'function')assistantNoteContextUsage(session, raw, tools);
  const parsed = assistantParseReply(raw, step);
  assistantTracePush(session, {
    t:'model',
    step,
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

function assistantPushToolResult(session, parsed, rawCalls, result){
  session.messages.push(assistantReplayMessage(parsed, rawCalls));
  session.messages.push({
    role:'tool',
    content:JSON.stringify(result)
  });
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
    session.awaiting = null;
    return {
      type:'ask',
      question:'Do you want a one-off task, a repeating habit, what is on today, or to log something done?',
      choices:['task', 'habit', "what's today", 'log done'],
      thinking,
      session
    };
  }
  if(intent === 'unsupported'){
    return {
      type:'say',
      text:'I can add a task, habit, weather profile, place, busy time, or topic, tell you what is on today, look one up, or log something done. I cannot reschedule the week or delete items.',
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
  if((!session.draft || !session.draft.name) && opts.draft && opts.draft.name)session.draft = opts.draft;
  session.llmCalls = 0;
  session.repairs = 0;
  session.contextUsed = 0;
  session.contextMeasured = 0;
  session.contextRatio = 0;
  session.debug = [];
  session.onDebug = typeof opts.onDebug === 'function' ? opts.onDebug : null;
  session.contextLimit = opts.contextLimit || session.contextLimit || (typeof assistantGuessContextLimit === 'function'
    ? assistantGuessContextLimit(opts.model)
    : ASSISTANT_DEFAULT_CONTEXT_TOKENS);
  assistantTracePush(session, {
    t:'turn',
    text,
    forceLlm:Boolean(opts.forceLlm),
    modelOnly:!opts.forceLlm && assistantModelOnlyEnabled(),
    focus:session.draft && session.draft.name ? session.draft.name : null
  });
  const done = out => assistantFinishDebug(session, out);

  const forceModel = Boolean(opts.forceLlm) || assistantModelOnlyEnabled();

  if(!forceModel){
    const local = assistantTryLocalTurn(text, session, context);
    if(local){
      local.fastPath = true;
      return done(local);
    }
  }else{
    session.parsed = typeof assistantParseUtterance === 'function'
      ? assistantParseUtterance(text, context.catalog, context.now)
      : null;
    if(session.parsed){
      // "use AI instead" never copies the parse. Always-use-Qwen still
      // withholds facts when the residue audit says the parse guessed.
      if(opts.forceLlm){
        session.parsed.factsTrusted = false;
      }else if(typeof assistantFastPathRisk === 'function'){
        const risk = assistantFastPathRisk(session.parsed.text || text, session.parsed);
        if(risk)session.parsed.factsTrusted = false;
      }
    }
    assistantTracePush(session, {
      t:'parse',
      facts:typeof assistantTrustParsedFacts === 'function' && assistantTrustParsedFacts(session.parsed) && typeof assistantCompactFacts === 'function'
        ? assistantCompactFacts(session.parsed)
        : null,
      factsTrusted:typeof assistantTrustParsedFacts === 'function' ? assistantTrustParsedFacts(session.parsed) : false,
      forceLlm:opts.forceLlm === true,
      modelOnly:opts.forceLlm !== true
    });
    assistantTracePush(session, {t:'path', path:'llm', via:opts.forceLlm ? 'force' : 'setting'});
  }

  if(typeof complete !== 'function')return done({type:'error', text:'Local assistant client is missing.', session});

  session.messages = [
    {role:'system', content:assistantSystemPrompt()},
    {role:'user', content:assistantUserEnvelope(text, context.catalog, session.draft, session.parsed, {
      compact:(session.contextRatio || 0) >= ASSISTANT_CONTEXT_COMPACT_AT
    })}
  ];
  let step = 'classify';
  if(session.awaiting === 'complete')step = 'complete';
  else if(session.awaiting === 'lookup')step = 'lookup';
  else if(session.draft && session.draft.name){
    step = 'extract';
    const setting = typeof assistantIsSettingKind === 'function' && assistantIsSettingKind(session.draft.kind);
    session.messages.push({
      role:'user',
      content:setting
        ? 'The user is changing currentDraft (a settings row). Call draft_setting with only the new fields as flat strings. Keep the same kind and name.'
        : 'The user is changing currentDraft. Call draft_item with only the new fields as flat strings — do not nest objects. Keep the same name and hid. extractedFacts is absent — read the request yourself. Place replies like "use home and mom\'s house" are placeNames from catalog.places.'
    });
  }else if(session.parsed && session.parsed.intent === 'create_setting'){
    step = 'extract';
    session.intent = 'create_setting';
    session.messages.push({role:'user', content:assistantDraftSettingSteerText()});
  }

  while(session.llmCalls < ASSISTANT_MAX_LLM_CALLS){
    let parsed;
    try{
      parsed = await assistantCallStep(session, step, complete, onProgress, context);
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
      const recovered = assistantRecoverLocalDraft(text, session, context);
      if(recovered){
        assistantTracePush(session, {t:'path', path:'local', via:'recover-after-error', type:recovered.type});
        return done(recovered);
      }
      return done({type:'error', text:assistantFriendlyError(err), session});
    }
    const allowed = new Set(assistantStepTools(step));
    const call = (parsed.toolCalls || []).find(item => allowed.has(item.name))
      || (parsed.toolCalls || [])[0];

    if(!call || call.parseError){
      if(session.repairs >= ASSISTANT_MAX_REPAIRS){
        assistantTracePush(session, {t:'repair', step, error:call && call.parseError || 'no tool', gaveUp:true});
        const recovered = assistantRecoverLocalDraft(text, session, context);
        if(recovered)return done(recovered);
        return done({type:'error', text:'I could not turn that into a Tings action. Try a shorter request, or add it from +.', thinking:parsed.thinking, session});
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
      continue;
    }
    if(!allowed.has(call.name)){
      if(call.name === 'draft_item' && (step === 'classify' || step === 'extract')){
        step = 'extract';
      }else if(call.name === 'draft_setting' && (step === 'classify' || step === 'extract')){
        step = 'extract';
      }else if(call.name === 'complete_item' && (step === 'classify' || step === 'complete')){
        step = 'complete';
      }else if(call.name === 'lookup_item' && (step === 'classify' || step === 'lookup')){
        step = 'lookup';
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

    assistantTracePush(session, {t:'tool', step, name:call.name, args:assistantTraceClip(call.args, 600)});
    const result = assistantExecuteTool(call.name, call.args, session, context);
    assistantTracePush(session, {
      t:'result',
      name:call.name,
      ok:Boolean(result && result.ok),
      error:result && result.error || null,
      ask:result && result.ask || null,
      preview:result && result.ok ? (assistantDraftSummary(session.draft, context.settings) || result.text || result.summary || null) : null
    });
    if(!result.ok){
      if(result.ask){
        assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:false, error:result.error, ask:result.ask});
        if(call.name === 'complete_item')session.awaiting = 'complete';
        if(call.name === 'lookup_item')session.awaiting = 'lookup';
        if(call.name === 'set_place')session.awaiting = 'place';
        return done({type:'ask', question:result.ask, choices:result.choices || (result.matches || []).map(item => item.name), thinking:parsed.thinking, draft:session.draft, session});
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

    if(call.name === 'classify_intent'){
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
      if(intent === 'edit_item' || (session.draft && session.draft.name && (intent === 'create_task' || intent === 'create_habit' || intent === 'unclear'))){
        step = 'extract';
        session.messages.push({
          role:'user',
          content:'The user is changing currentDraft if it is set, or an existing named item. Call draft_item with every new field in one call as flat strings — do not nest objects. Strings are ok: rhythm "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend", windowText "from 15 minutes before sunrise to 2 hours after sunrise or 9am, whichever is earlier". Keep the same name and hid. Place replies like "use home and mom\'s house" are placeNames from catalog.places.' + factsHint
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
      if(intent === 'lookup_item'){
        if(trustFacts && session.parsed && session.parsed.itemName){
          const local = assistantLocalLookup(session, context, session.parsed.itemName);
          return done({...local, thinking:parsed.thinking});
        }
        step = 'lookup';
        session.messages.push({role:'user', content:'Call lookup_item with the item name.'});
        continue;
      }
      step = 'extract';
      session.messages.push({
        role:'user',
        content:assistantDraftItemSteerText(intent, factsHint)
      });
      continue;
    }

    if(call.name === 'ask_user'){
      assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, waiting:true});
      if(step === 'complete')session.awaiting = 'complete';
      else if(step === 'lookup')session.awaiting = 'lookup';
      return done({type:'ask', question:result.ask, choices:result.choices, thinking:parsed.thinking, draft:session.draft, session});
    }

    if(call.name === 'complete_item'){
      return done({
        type:'complete',
        text:result.summary,
        alreadyDone:result.alreadyDone,
        pendingComplete:result.pendingComplete,
        thinking:parsed.thinking,
        session
      });
    }
    if(call.name === 'lookup_item'){
      return done({type:'say', text:result.text, thinking:parsed.thinking, session});
    }

    assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, preview:assistantDraftSummary(session.draft, context.settings)});

    if(call.name === 'draft_item' && result.ask){
      return done({
        type:'ask',
        question:result.ask,
        choices:result.choices || (result.matches || []).map(item => item && item.name).filter(Boolean),
        thinking:parsed.thinking,
        draft:session.draft,
        session
      });
    }
    if(session.draft && session.draft.weatherNeedAsk){
      session.awaiting = 'weather';
      return done({
        type:'ask',
        question:session.draft.weatherNeedAsk.question,
        choices:session.draft.weatherNeedAsk.choices,
        thinking:parsed.thinking,
        draft:session.draft,
        session
      });
    }

    return done(assistantPreviewResult(session, context, parsed.thinking));
  }
  return done({type:'error', text:'That took too many steps. Try a shorter request, or add it from +.', session});
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
