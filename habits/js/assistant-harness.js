// Guided Qwen3.8 loop: think, then tool calls that actually create or change
// items. Clear phrasing can still be applied locally; the model fills the rest.

function assistantSystemPrompt(){
  return [
    'You are the Tings assistant in this app on this computer.',
    'Think, then call a tool. Do not save. Do not invent habit JSON.',
    'create_task = one-off. create_habit = repeating. ask_today = what is on today or next.',
    'complete_item = already did it. lookup_item = when is it / did I do it.',
    'draft_item creates or changes an item. Put every field the user said in that one call: name, durationMinutes, rhythm, timesPerPeriod, periodDays, weekdays, due, dueTime, windowText, weatherProfile, weatherText, placeNames, priority.',
    'Prefer plain strings: rhythm "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend", "five times a week". weekdays "Tue, Wed, Fri" or weekdays/weekends.',
    'If currentDraft is set, "it" / "this" / "that" is that item. Keep its name and hid. Call draft_item with only the new fields.',
    'Copy extractedFacts into the tool. Use catalog place and weather names. sunset means maghrib.',
    'If a name is ambiguous, call ask_user with one short question.',
    'Never put reasoning inside tool arguments.'
  ].join(' ');
}

function assistantUserEnvelope(text, catalog, draft, parsed, opts){
  const compact = Boolean(opts && opts.compact);
  const habitLimit = compact ? 6 : 12;
  const payload = {
    request:String(text || '').trim(),
    catalog:{
      today:compact
        ? {next:(catalog.today && catalog.today.next) || null}
        : catalog.today,
      places:(catalog.places || []).slice(0, compact ? 6 : 12).map(item => ({name:item.name})),
      weather:(catalog.weather || []).slice(0, 4).map(item => ({name:item.name})),
      habits:(catalog.habits || []).slice(0, habitLimit).map(item => ({name:item.name, type:item.type})),
      anchors:catalog.anchors,
      aliases:catalog.aliases
    }
  };
  const facts = typeof assistantCompactFacts === 'function' ? assistantCompactFacts(parsed) : null;
  if(facts)payload.extractedFacts = facts;
  const current = typeof assistantCompactDraft === 'function' ? assistantCompactDraft(draft) : null;
  if(current)payload.currentDraft = current;
  return JSON.stringify(payload);
}

function assistantRepairText(step, error){
  const tool = assistantStepTools(step)[0];
  return `That tool call was invalid (${error}). Think again, then call ${tool} with valid arguments. JSON only inside the tool.`;
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
    extractedFacts:typeof assistantCompactFacts === 'function' ? assistantCompactFacts(session.parsed) : null,
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

function assistantFollowupStep(parsed){
  if(parsed && parsed.rhythm)return 'extract';
  if(parsed && parsed.durationMinutes != null)return 'extract';
  if(parsed && parsed.window)return 'window';
  if(parsed && parsed.weatherHints && parsed.weatherHints.mentioned)return 'weather';
  if(parsed && parsed.places && parsed.places.length)return 'place';
  return 'extract';
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
  if(parsed && assistantHasPatchFields(parsed)){
    const actionable = typeof assistantHasActionablePatch !== 'function' || assistantHasActionablePatch(parsed, session.draft);
    if(typeof assistantPatchChangedDraft === 'function'){
      const changed = assistantPatchChangedDraft(session.draft, parsed, context.catalog, context.settings);
      if(changed || actionable)return assistantPreviewResult(session, context);
      return null;
    }
    if(typeof assistantPatchDraftFromParsed === 'function' && actionable){
      assistantPatchDraftFromParsed(session.draft, parsed, context.catalog, context.settings);
      return assistantPreviewResult(session, context);
    }
  }
  return null;
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
  const hasPatch = typeof assistantHasPatchFields === 'function' && assistantHasPatchFields(parsed);
  const looksEdit = typeof assistantLooksLikeEdit === 'function' && assistantLooksLikeEdit(text);
  if(draft && (hasPatch || looksEdit) && (!named
    || (typeof assistantNamesMatch === 'function' && assistantNamesMatch(named, draft.name))
    || (typeof assistantMentionsFocus === 'function' && assistantMentionsFocus(text, parsed, draft)))){
    session.awaiting = null;
    session.pendingEdit = null;
    if(hasPatch){
      const actionable = typeof assistantHasActionablePatch !== 'function' || assistantHasActionablePatch(parsed, draft);
      if(typeof assistantPatchChangedDraft === 'function'){
        const changed = assistantPatchChangedDraft(draft, parsed, context.catalog, context.settings);
        if(changed || actionable){
          session.draft = draft;
          session.intent = draft.kind === 'habit' ? 'create_habit' : 'create_task';
          return assistantPreviewResult(session, context);
        }
        return null;
      }
      if(actionable && typeof assistantPatchDraftFromParsed === 'function'){
        assistantPatchDraftFromParsed(draft, parsed, context.catalog, context.settings);
        session.draft = draft;
        session.intent = draft.kind === 'habit' ? 'create_habit' : 'create_task';
        return assistantPreviewResult(session, context);
      }
    }
    return null;
  }
  const lookup = named || (!hasPatch && !looksEdit ? text : null);
  if(lookup){
    const found = assistantFindHabit(context.data, lookup);
    if(found.ok){
      session.awaiting = null;
      session.pendingEdit = null;
      assistantFocusHabit(session, found, context);
      const patchFrom = hasPatch ? parsed : pending;
      if(typeof assistantHasPatchFields === 'function' && assistantHasPatchFields(patchFrom)){
        const actionable = typeof assistantHasActionablePatch !== 'function' || assistantHasActionablePatch(patchFrom, session.draft);
        if(typeof assistantPatchChangedDraft === 'function'){
          const changed = assistantPatchChangedDraft(session.draft, patchFrom, context.catalog, context.settings);
          if(changed || actionable){
            session.intent = session.draft.kind === 'habit' ? 'create_habit' : 'create_task';
            return assistantPreviewResult(session, context);
          }
          return null;
        }
        if(actionable && typeof assistantPatchDraftFromParsed === 'function'){
          assistantPatchDraftFromParsed(session.draft, patchFrom, context.catalog, context.settings);
          session.intent = session.draft.kind === 'habit' ? 'create_habit' : 'create_task';
          return assistantPreviewResult(session, context);
        }
      }
      return null;
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

function assistantTryFocusFollowup(text, parsed, session, context){
  if(!parsed)return null;
  if(session.awaiting === 'edit')return assistantResolveAwaitingEdit(text, parsed, session, context);
  const draft = session.draft && session.draft.name ? session.draft : null;
  const hasPatch = typeof assistantHasPatchFields === 'function' && assistantHasPatchFields(parsed);
  const named = parsed.itemName && !assistantIsPronounName(parsed.itemName) ? parsed.itemName : null;
  if(!draft){
    if(parsed.intent === 'edit_item' && named && hasPatch)return assistantOpenNamedDraft(session, context, named, parsed);
    if(parsed.intent === 'edit_item' && !named && hasPatch)return assistantAskWhichItem(session, context, parsed);
    return null;
  }
  if(parsed.intent === 'edit_item' && named
    && !(typeof assistantNamesMatch === 'function' && assistantNamesMatch(named, draft.name))
    && !(typeof assistantMentionsFocus === 'function' && assistantMentionsFocus(text, parsed, draft))){
    if(!hasPatch)return null;
    return assistantOpenNamedDraft(session, context, named, parsed);
  }
  if(typeof assistantIsNewCreate === 'function' && assistantIsNewCreate(parsed, draft))return null;
  if(parsed.intent === 'ask_today' && parsed.confident)return null;
  if(parsed.intent === 'unsupported' && parsed.confident)return null;
  const follow = typeof assistantIsFollowupOnFocus === 'function'
    ? assistantIsFollowupOnFocus(text, parsed, draft)
    : false;
  if(!follow)return null;
  if(parsed.intent === 'complete_item'){
    return assistantLocalComplete(session, context, draft.name);
  }
  if(parsed.intent === 'lookup_item'){
    return assistantLocalLookup(session, context, draft.name);
  }
  if(!hasPatch)return null;
  const actionable = typeof assistantHasActionablePatch !== 'function' || assistantHasActionablePatch(parsed, draft);
  const patchArgs = typeof assistantCompactFacts === 'function' ? assistantCompactFacts(parsed) : parsed;
  assistantTracePush(session, {t:'tool', step:'local', name:'draft_item', args:assistantTraceClip(patchArgs, 600)});
  if(typeof assistantPatchChangedDraft === 'function'){
    const changed = assistantPatchChangedDraft(draft, parsed, context.catalog, context.settings);
    if(!changed && !actionable){
      assistantTracePush(session, {t:'result', name:'draft_item', ok:false, error:'no-op patch'});
      return null;
    }
  }else if(typeof assistantPatchDraftFromParsed === 'function'){
    if(!actionable){
      assistantTracePush(session, {t:'result', name:'draft_item', ok:false, error:'no-op patch'});
      return null;
    }
    assistantPatchDraftFromParsed(draft, parsed, context.catalog, context.settings);
  }
  session.draft = draft;
  assistantTracePush(session, {
    t:'result',
    name:'draft_item',
    ok:true,
    preview:assistantDraftSummary(draft, context.settings)
  });
  session.intent = draft.kind === 'habit' ? 'create_habit' : 'create_task';
  session.awaiting = null;
  return assistantPreviewResult(session, context);
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
    weather:parsed.weather ? {mode:'profile', profile:parsed.weather} : undefined
  };
  const traceArgs = {};
  Object.keys(args).forEach(key => {
    if(args[key] != null && args[key] !== '')traceArgs[key] = args[key];
  });
  assistantTracePush(session, {t:'tool', step:'local', name:'draft_item', args:assistantTraceClip(traceArgs, 600)});
  const applied = assistantApplyDraftItem(args, session.draft, context.catalog, context.now);
  if(!applied.ok){
    assistantTracePush(session, {t:'result', name:'draft_item', ok:false, error:applied.error || 'apply failed'});
    return null;
  }
  assistantEnrichDraft(applied.draft, parsed, context.catalog, context.settings);
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

  if(session.awaiting === 'complete'){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-complete'});
    return assistantLocalComplete(session, context, text);
  }
  if(session.awaiting === 'lookup'){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-lookup'});
    return assistantLocalLookup(session, context, text);
  }
  if(session.awaiting === 'place' && session.draft){
    assistantTracePush(session, {t:'path', path:'local', via:'awaiting-place'});
    const applied = assistantApplyPlace(session.draft, {names:[text], anywhere:false}, context.catalog);
    if(!applied.ok)return {type:'ask', question:applied.ask || applied.error, session};
    session.draft = applied.draft;
    session.awaiting = null;
    return assistantPreviewResult(session, context);
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

  const follow = assistantTryFocusFollowup(text, parsed, session, context);
  if(follow){
    assistantTracePush(session, {t:'path', path:'local', via:'focus-followup', type:follow.type});
    return follow;
  }

  if(!parsed.confident){
    assistantTracePush(session, {t:'path', path:'llm', via:'parser-unconfident', intent:parsed.intent});
    return null;
  }
  if(parsed.intent === 'ask_today'){
    assistantTracePush(session, {t:'path', path:'local', via:'ask-today'});
    session.intent = 'ask_today';
    const compact = /\bnext\b/i.test(parsed.text) && !/\b(today|due|left|plan)\b/i.test(parsed.text);
    return {type:'today', text:assistantFormatToday(context.catalog, {compact}), session};
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
  if(parsed.intent === 'unsupported'){
    assistantTracePush(session, {t:'path', path:'local', via:'unsupported'});
    session.intent = 'unsupported';
    return {
      type:'say',
      text:'I can add a task or habit, tell you what is on today, look one up, or log something done. I cannot reschedule the week or delete items.',
      session
    };
  }
  if((parsed.intent === 'create_task' || parsed.intent === 'create_habit') && parsed.itemName){
    assistantTracePush(session, {t:'path', path:'local', via:'create', intent:parsed.intent});
    return assistantLocalCreate(session, context, parsed, parsed.intent);
  }
  assistantTracePush(session, {t:'path', path:'llm', via:'no-local-handler', intent:parsed.intent});
  return null;
}

async function assistantCallStep(session, step, complete, onProgress){
  const tools = assistantOllamaTools(assistantStepTools(step));
  onProgress && onProgress({phase:'think', step});
  assistantTracePush(session, {t:'step', step, tools:assistantStepTools(step)});
  if(typeof assistantMaybeCompact === 'function'){
    const request = (session.parsed && session.parsed.text) || '';
    const compact = assistantMaybeCompact(session, tools, request);
    if(compact && compact.compacted){
      assistantTracePush(session, {t:'compact', before:compact.before, used:compact.used, limit:compact.limit, ratio:compact.ratio});
    }
  }
  const raw = await complete({
    messages:session.messages,
    tools,
    think:true,
    maxPredict:assistantStepPredict(step),
    step
  });
  session.llmCalls += 1;
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
    if(session.draft && session.draft.name && session.parsed
      && typeof assistantLooksLikeEdit === 'function'
      && assistantLooksLikeEdit(session.parsed.text)){
      return null;
    }
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
      text:'I can add a task or habit, tell you what is on today, look one up, or log something done. I cannot reschedule the week or delete items.',
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
  if((parsed.intent === 'create_task' || parsed.intent === 'create_habit') && parsed.itemName){
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
    focus:session.draft && session.draft.name ? session.draft.name : null
  });
  const done = out => assistantFinishDebug(session, out);

  if(!opts.forceLlm){
    const local = assistantTryLocalTurn(text, session, context);
    if(local)return done(local);
  }else{
    session.parsed = typeof assistantParseUtterance === 'function'
      ? assistantParseUtterance(text, context.catalog, context.now)
      : null;
    assistantTracePush(session, {
      t:'parse',
      facts:typeof assistantCompactFacts === 'function' ? assistantCompactFacts(session.parsed) : null,
      forceLlm:true
    });
    assistantTracePush(session, {t:'path', path:'llm', via:'force'});
  }

  if(typeof complete !== 'function')return done({type:'error', text:'Local assistant client is missing.', session});

  session.messages = [
    {role:'system', content:assistantSystemPrompt()},
    {role:'user', content:assistantUserEnvelope(text, context.catalog, session.draft, session.parsed, {
      compact:(session.contextRatio || 0) >= ASSISTANT_CONTEXT_COMPACT_AT
    })}
  ];
  let step = 'classify';
  if(session.awaiting === 'place')step = 'place';
  else if(session.awaiting === 'window')step = 'window';
  else if(session.awaiting === 'weather')step = 'weather';
  else if(session.awaiting === 'complete')step = 'complete';
  else if(session.awaiting === 'lookup')step = 'lookup';
  else if(session.draft && session.draft.name)step = assistantFollowupStep(session.parsed);

  while(session.llmCalls < ASSISTANT_MAX_LLM_CALLS){
    let parsed;
    try{
      parsed = await assistantCallStep(session, step, complete, onProgress);
    }catch(err){
      assistantTracePush(session, {t:'error', step, error:assistantTraceClip(String(err && err.message || err), 300)});
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
      }else if(call.name === 'complete_item' && (step === 'classify' || step === 'complete')){
        step = 'complete';
      }else if(call.name === 'lookup_item' && (step === 'classify' || step === 'lookup')){
        step = 'lookup';
      }else if(session.draft && session.draft.name && (call.name === 'set_window' || call.name === 'set_weather' || call.name === 'set_place' || call.name === 'draft_item')){
        step = call.name === 'draft_item' ? 'extract' : call.name.replace('set_', '');
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
      const intent = typeof assistantPreferIntent === 'function'
        ? assistantPreferIntent(result.intent, guessed)
        : result.intent;
      assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, intent});
      const handled = assistantHandleIntent(session, context, intent, parsed.thinking);
      if(handled)return done(handled);
      if(intent === 'edit_item' || (session.draft && session.draft.name && (intent === 'create_task' || intent === 'create_habit' || intent === 'unclear'))){
        step = 'extract';
        session.messages.push({
          role:'user',
          content:'The user is changing currentDraft if it is set, or an existing named item. Call draft_item with every new field in one call. Strings are ok: rhythm "every Tuesday, Wednesday and Friday", "every two days", "three times in eight days", "every weekend". Keep the same name and hid. Copy extractedFacts.'
        });
        continue;
      }
      if(intent === 'complete_item'){
        if(session.parsed && session.parsed.itemName){
          const local = assistantLocalComplete(session, context, session.parsed.itemName);
          if(local && local.type !== 'ask')return done({...local, thinking:parsed.thinking});
          if(local && local.type === 'ask')return done({...local, thinking:parsed.thinking});
        }
        step = 'complete';
        session.messages.push({role:'user', content:'Call complete_item with the catalog or spoken item name.'});
        continue;
      }
      if(intent === 'lookup_item'){
        if(session.parsed && session.parsed.itemName){
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
        content:intent === 'create_habit'
          ? 'Call draft_item with kind habit. Put every field the user said in that one call (name, rhythm, weekdays, durationMinutes, windowText, weatherText, placeNames). Copy extractedFacts. Strings are ok: rhythm "every Tuesday", "every two days", "three times in eight days".'
          : 'Call draft_item with kind task. Put every field the user said in that one call. Copy extractedFacts. Default due is today if they did not name a day.'
      });
      continue;
    }

    if(call.name === 'ask_user'){
      assistantPushToolResult(session, parsed, parsed.toolCalls, {ok:true, waiting:true});
      if(step === 'complete')session.awaiting = 'complete';
      else if(step === 'lookup')session.awaiting = 'lookup';
      else if(step === 'place')session.awaiting = 'place';
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
      return done({type:'ask', question:result.ask, thinking:parsed.thinking, draft:session.draft, session});
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

    const follow = assistantMissingFollowups(session.draft);
    if(follow.length){
      step = follow[0];
      session.awaiting = step;
      session.messages.push({
        role:'user',
        content:step === 'window'
          ? 'Call set_window. sunset means maghrib. Use kind clock or anchor.'
          : step === 'weather'
            ? 'Call set_weather using a catalog profile name, inherit, or none.'
            : 'Call set_place using catalog place names only.'
      });
      continue;
    }

    return done(assistantPreviewResult(session, context, parsed.thinking));
  }
  return done({type:'error', text:'That took too many steps. Try a shorter request, or add it from +.', session});
}

function assistantReachErrorText(pageOrigin){
  const origin = pageOrigin == null
    ? (typeof assistantPublicPageOrigin === 'function' ? assistantPublicPageOrigin() : '')
    : String(pageOrigin || '');
  if(origin){
    return `Cannot reach the local model from this website. Open Settings → local assistant and follow the steps. Keep Ollama running.`;
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
