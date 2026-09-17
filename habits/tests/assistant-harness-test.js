// Local assistant harness: parse/repair, catalogs, draft save. Fake LLM by
// default; optional live Qwen3.8 if Ollama is reachable from the page.
const { chromium, BASE } = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  not ok: ' + msg); }
}

async function launchBrowser(){
  const attempts = [
    { headless:true, channel:'chrome' },
    { headless:true },
    { headless:true, args:['--disable-gpu'] }
  ];
  let lastErr = null;
  for(const opts of attempts){
    try{ return await chromium.launch(opts); }
    catch(err){ lastErr = err; }
  }
  throw lastErr || new Error('chromium.launch failed');
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[A] parse + think + tool_calls');
  const parse = await page.evaluate(() => {
    const thinkOnly = assistantParseReply({
      message:{ role:'assistant', content:'', thinking:'walk is a one-off', tool_calls:[
        { id:'call_1', function:{ name:'classify_intent', arguments:{ intent:'create_task', reason:'one-off walk' } } }
      ] }
    });
    const fenced = extractJsonObject('Sure.\n```json\n{"intent":"create_habit",}\n```');
    const truncated = extractJsonObject('{"kind":"habit","name":"outside exercise","timesPerPeriod":3,"weather":{"mode":"profile"');
    const sunset = assistantCleanAnchor('sunset');
    const clock = assistantParseClock('7pm');
    return {
      tool:thinkOnly.toolCalls[0] && thinkOnly.toolCalls[0].name,
      intent:thinkOnly.toolCalls[0] && thinkOnly.toolCalls[0].args.intent,
      thinking:thinkOnly.thinking.includes('one-off'),
      fencedOk:fenced.ok && fenced.value.intent === 'create_habit',
      truncatedOk:truncated.ok && truncated.value.name === 'outside exercise' && truncated.value.timesPerPeriod === 3,
      friendly:assistantFriendlyError('{"error":"Value looks like object, but can\'t find closing \'}\' symbol"}'),
      sunset,
      clock
    };
  });
  assert(parse.tool === 'classify_intent' && parse.intent === 'create_task', 'Ollama think+tool_calls parse');
  assert(parse.thinking, 'thinking field is kept');
  assert(parse.fencedOk, 'fenced JSON with trailing comma still parses');
  assert(parse.truncatedOk, 'truncated nested JSON is repaired enough to keep name and rhythm');
  assert(/stumbled|shorter/i.test(parse.friendly), 'Ollama brace error is shown in plain language');
  assert(parse.sunset === 'maghrib', 'sunset aliases to maghrib');
  assert(parse.clock === 19 * 60, '7pm becomes 19:00');

  console.log('\n[B] catalog redacts addresses');
  const catalog = await page.evaluate(() => {
    const data = [{ name:'Walk', type:'keepup', logs:[{ ts:1, note:'secret' }], durationMinutes:30 }];
    const settings = {
      locations:[{ id:'loc1', name:'Home', address:'123 Secret Rd', lat:40.7, lng:-74 }],
      weatherProfiles:[{ id:'wp1', name:'Dry' }]
    };
    const cat = assistantCatalog(data, settings, Date.now());
    return {
      blob:JSON.stringify(cat),
      place:cat.places[0] && cat.places[0].name,
      weather:cat.weather[0] && cat.weather[0].name
    };
  });
  assert(catalog.place === 'Home' && catalog.weather === 'Dry', 'catalog has place and weather names');
  assert(!/Secret Rd|40\.7|secret/i.test(catalog.blob), 'catalog omits address, coords, and notes');

  console.log('\n[C] draft window + save');
  const saved = await page.evaluate(() => {
    localStorage.removeItem(KEY);
    const draft = assistantEmptyDraft();
    const catalog = assistantCatalog([], {
      weatherProfiles:[{ id:'dry-1', name:'Dry' }],
      locations:[{ id:'home-1', name:'Home' }]
    }, Date.now());
    const item = assistantApplyDraftItem({
      kind:'task',
      name:'Evening walk',
      durationMinutes:45,
      due:'today',
      window:{ start:{ kind:'anchor', anchor:'sunset', offsetMin:0 }, end:{ kind:'anchor', anchor:'sunrise', offsetMin:0 } },
      weather:{ mode:'profile', profile:'Dry' },
      place:{ names:['Home'], anywhere:false }
    }, draft, catalog, Date.now());
    const settings = { ...DEFAULT_SORT_SETTINGS, weatherProfiles:[{ id:'dry-1', name:'Dry' }], locations:[{ id:'home-1', name:'Home' }] };
    saveSortSettings(settings);
    const commit = item.ok ? assistantCommitDraft(item.draft) : { ok:false, error:item.error };
    const habit = commit.ok ? load()[commit.index] : null;
    return {
      ok:item.ok && commit.ok,
      summary:item.ok ? assistantDraftSummary(item.draft, settings) : item.error,
      start:habit && habit.allowedTimeStartAnchor,
      end:habit && habit.allowedTimeEndAnchor,
      duration:habit && habit.durationMinutes,
      weather:habit && habit.weatherProfileId,
      place:habit && habit.locationIds && habit.locationIds[0],
      type:habit && habit.type
    };
  });
  assert(saved.ok && saved.type === 'task', 'commit saves a task');
  assert(saved.start === 'maghrib' && saved.end === 'sunrise', 'sunset window becomes maghrib → sunrise');
  assert(saved.duration === 45 && saved.weather === 'dry-1' && saved.place === 'home-1', 'duration, weather, and place land on the habit');
  assert(/Evening walk/.test(saved.summary) && /Maghrib/i.test(saved.summary), 'preview summary uses Tings language');

  console.log('\n[D] guided repair then preview');
  const turn = await page.evaluate(async () => {
    const replies = [
      { message:{ role:'assistant', content:'A walk sounds nice.', thinking:'hmm' } },
      { message:{ role:'assistant', thinking:'classify now', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }
      ] } },
      { message:{ role:'assistant', thinking:'fill draft', tool_calls:[
        { function:{ name:'draft_item', arguments:{ kind:'task', name:'Pharmacy', durationMinutes:20, due:'today' } } }
      ] } }
    ];
    globalThis.__assistantTestComplete = async () => replies.shift();
    saveSortSettings({ ...DEFAULT_SORT_SETTINGS, localAssistant:true, locations:[], weatherProfiles:[] });
    const out = await runAssistantTurn('Remind me to go to the pharmacy for 20 minutes', { forceLlm:true });
    return { type:out.type, summary:out.summary, name:out.draft && out.draft.name, leftover:replies.length };
  });
  assert(turn.type === 'preview' && turn.name === 'Pharmacy', 'prose is repaired into a draft_item preview');
  assert(turn.leftover === 0, 'classify + extract consumed the scripted replies');

  console.log('\n[E] settings chrome');
  const ui = await page.evaluate(() => {
    saveSortSettings({ ...loadSortSettings(), localAssistant:false });
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    const off = {
      hidden:document.getElementById('open-assistant')?.hidden,
      pressed:document.getElementById('setting-local-assistant')?.getAttribute('aria-pressed')
    };
    saveSortSettings({ ...loadSortSettings(), localAssistant:true });
    syncLocalAssistantControls();
    return {
      off,
      onHidden:document.getElementById('open-assistant')?.hidden,
      onPressed:document.getElementById('setting-local-assistant')?.getAttribute('aria-pressed'),
      setupHidden:document.getElementById('assistant-setup-fields')?.hidden,
      sheet:Boolean(document.getElementById('assistant-sheet')),
      privacy:Boolean(document.getElementById('privacy-assistant-body')),
      debugToggle:Boolean(document.getElementById('setting-local-assistant-debug')),
      debugSheet:Boolean(document.getElementById('assistant-debug-toggle')),
      modelOnlyToggle:Boolean(document.getElementById('setting-local-assistant-model-only')),
      modelOnlyPressed:document.getElementById('setting-local-assistant-model-only')?.getAttribute('aria-pressed')
    };
  });
  assert(ui.off.hidden === true && ui.off.pressed === 'false', 'chat button hidden while assistant is off');
  assert(ui.onHidden === false && ui.onPressed === 'true' && ui.setupHidden === false, 'enabling shows the button and setup fields');
  assert(ui.sheet && ui.privacy, 'assistant sheet and privacy copy exist');
  assert(ui.debugToggle && ui.debugSheet, 'debug switch exists in settings and on the chat');
  assert(ui.modelOnlyToggle && ui.modelOnlyPressed === 'false', 'always-use-Qwen toggle exists and is off by default');
  const reach = await page.evaluate(() => {
    const getInit = assistantFetchInit('http://127.0.0.1:11434/api/tags', {method:'GET'});
    const postInit = assistantFetchInit('http://127.0.0.1:11434/api/chat', {
      method:'POST',
      body:JSON.stringify({model:'qwen'})
    });
    const publicFail = assistantFriendlyError('Failed to fetch', 'https://lanbeee.github.io');
    const public403 = assistantFriendlyError('Ollama 403', 'https://lanbeee.github.io');
    const allow = assistantOllamaOriginsAllowText('https://lanbeee.github.io', 'mac');
    if(typeof syncAssistantOriginHelp === 'function')syncAssistantOriginHelp();
    return {
      getSpace:getInit.targetAddressSpace,
      getHasType:Boolean(getInit.headers && getInit.headers['Content-Type']),
      postSpace:postInit.targetAddressSpace,
      postType:postInit.headers && postInit.headers['Content-Type'],
      publicFail,
      public403,
      allow,
      pageOrigin:assistantPublicPageOrigin(),
      guide:Boolean(document.getElementById('assistant-reach-guide')),
      guideLead:(document.getElementById('assistant-reach-lead')?.textContent || ''),
      guideCmd:(document.getElementById('assistant-reach-cmd')?.textContent || ''),
      stepCount:document.querySelectorAll('#assistant-reach-guide li').length,
      copyBtn:Boolean(document.getElementById('assistant-copy-origins')),
      originHelpGone:!document.getElementById('assistant-origin-help'),
      guideRestart:(document.getElementById('assistant-reach-step-restart')?.textContent || '')
    };
  });
  assert(reach.getSpace === 'loopback' && reach.postSpace === 'loopback', 'loopback fetches declare targetAddressSpace');
  assert(!reach.getHasType && reach.postType === 'application/json', 'JSON content-type is only set when there is a body');
  assert(/Settings → local assistant/i.test(reach.publicFail) && /quit and reopen Ollama/i.test(reach.publicFail), 'GitHub Pages fetch error points at the in-app steps');
  assert(/Settings → local assistant/i.test(reach.public403), '403 points at the in-app steps');
  assert(reach.allow === 'launchctl setenv OLLAMA_ORIGINS "https://lanbeee.github.io"', 'Mac allow command is the launchctl line');
  assert(!reach.pageOrigin && reach.guide && reach.stepCount === 4 && reach.copyBtn && reach.originHelpGone, 'settings shows a four-step reach guide');
  assert(/already allowed|GitHub Pages/i.test(reach.guideLead) && /launchctl setenv OLLAMA_ORIGINS "https:\/\/lanbeee\.github\.io"/.test(reach.guideCmd), 'loopback page still shows the GitHub Pages command');
  assert(/Fully quit Ollama/i.test(reach.guideRestart) && /does nothing until/i.test(reach.guideRestart), 'reach guide says the allow command needs a full Ollama quit');

  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
  await page.locator('#settings-assistant-head').click();
  const expanded = await page.locator('#settings-assistant-head').getAttribute('aria-expanded');
  assert(expanded === 'true', 'settings local assistant section opens');
  const guideVisible = await page.locator('#assistant-reach-guide').isVisible();
  const guideTitle = await page.locator('#assistant-reach-guide .settings-sublabel').textContent();
  assert(guideVisible && /Reach the model/i.test(guideTitle || ''), 'reach guide is visible in Settings');

  console.log('\n[F] compact model context at 60%');
  const compact = await page.evaluate(() => {
    const replay = assistantReplayMessage({content:'', thinking:'z'.repeat(5000), toolCalls:[]});
    const session = assistantCreateSession();
    session.contextLimit = 800;
    session.draft = {
      kind:'habit',
      name:'outside exercise',
      durationMinutes:30,
      timesPerPeriod:3,
      periodDays:7,
      window:{start:{kind:'anchor', anchor:'maghrib', offsetMin:-120}, end:{kind:'anchor', anchor:'maghrib', offsetMin:0}}
    };
    session.parsed = {
      text:'Change it to be allowed between 2 hours before sunset and till sunset',
      intent:'edit_item',
      window:session.draft.window
    };
    session.intent = 'create_habit';
    session.messages = [
      {role:'system', content:assistantSystemPrompt()},
      {role:'user', content:'x'.repeat(1200)},
      {role:'assistant', thinking:'y'.repeat(4000), content:'', tool_calls:[{id:'1', type:'function', function:{name:'classify_intent', arguments:'{"intent":"create_habit"}'}}]},
      {role:'tool', content:'{"ok":true,"intent":"create_habit"}'},
      {role:'user', content:'Call set_window. sunset means maghrib. Use kind clock or anchor.'}
    ];
    const before = assistantPromptTokens(session.messages, []);
    const out = assistantMaybeCompact(session, [], session.parsed.text);
    const small = assistantCreateSession();
    small.contextLimit = 32768;
    small.messages = [
      {role:'system', content:'sys'},
      {role:'user', content:'short'}
    ];
    const skip = assistantMaybeCompact(small, [], 'short');
    return {
      should:assistantShouldCompact(19661, 32768),
      shouldNot:assistantShouldCompact(1000, 32768),
      ollamaTokens:assistantReadPromptTokens({prompt_eval_count:4096}),
      openAiTokens:assistantReadPromptTokens({usage:{prompt_tokens:99}}),
      replayLen:replay.thinking.length,
      before,
      after:assistantPromptTokens(session.messages, []),
      compacted:out.compacted,
      roles:session.messages.map(msg => msg.role),
      blob:session.messages.map(msg => msg.content).join('\n'),
      skipCompacted:skip.compacted,
      oldThinking:session.messages.some(msg => msg.thinking),
      replayMax:ASSISTANT_THINKING_REPLAY_MAX
    };
  });
  assert(compact.should && !compact.shouldNot, '60% of the window is the compact trigger');
  assert(compact.ollamaTokens === 4096 && compact.openAiTokens === 99, 'prompt token counts are read from Ollama and LM Studio');
  assert(compact.replayLen <= compact.replayMax + 1, 'replayed thinking is capped');
  assert(compact.compacted && compact.after < compact.before, 'over-budget traces are compacted smaller');
  assert(compact.roles.join(',') === 'system,user', 'compact keeps system + one summary user');
  assert(/outside exercise/.test(compact.blob) && /set_window|maghrib/.test(compact.blob), 'compact keeps the focused habit and the next tool hint');
  assert(!compact.oldThinking, 'compact drops thinking traces');
  assert(!compact.skipCompacted, 'short prompts stay as-is under 60%');

  const compactTurn = await page.evaluate(async () => {
    const replies = [
      {message:{thinking:'t'.repeat(2500), tool_calls:[{function:{name:'classify_intent', arguments:{intent:'create_task'}}}]}, prompt_eval_count:700},
      {message:{thinking:'ok', tool_calls:[{function:{name:'draft_item', arguments:{kind:'task', name:'Pharmacy', durationMinutes:20, due:'today'}}}]}}
    ];
    let sawCompact = false;
    const out = await runAssistantTurn('Remind me to go to the pharmacy for 20 minutes', {
      forceLlm:true,
      contextLimit:1000,
      complete:async req => {
        if((req.messages || []).some(msg => /"compacted":true/.test(String(msg.content || ''))))sawCompact = true;
        return replies.shift();
      }
    });
    return {type:out.type, name:out.draft && out.draft.name, sawCompact, leftover:replies.length, compacted:out.session && out.session.contextCompacted};
  });
  assert(compactTurn.type === 'preview' && compactTurn.name === 'Pharmacy', 'forced turn still drafts after compact');
  assert(compactTurn.sawCompact && compactTurn.compacted >= 1, 'second model call received a compacted transcript');

  console.log('\n[H] draft_item upserts any mix of fields');
  const upsert = await page.evaluate(async () => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      defaultDurationMinutes:30,
      locations:[{id:'home-1', name:'Home'}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    const data = (typeof normalize === 'function' ? normalize : (x=>x))([{
      name:'outside exercise', type:'keepup', target:7/3, durationMinutes:30, logs:[], lastLog:null
    }]);
    save(data);
    const context = assistantBuildContext(Date.now());
    const found = assistantFindHabit(load(), 'outside exercise');
    const session = assistantCreateSession();
    assistantFocusHabit(session, found, context);
    session.parsed = assistantParseUtterance('Change it to five times a week', context.catalog, Date.now());
    const tool = assistantExecuteTool('draft_item', {rhythm:'five times a week'}, session, context);
    const toolSnap = {ok:tool.ok, times:tool.draft && tool.draft.timesPerPeriod, days:tool.draft && tool.draft.periodDays, hid:tool.draft && tool.draft.hid, name:tool.draft && tool.draft.name};
    session.parsed = assistantParseUtterance('Change it to every Tuesday', context.catalog, Date.now());
    const tuesday = assistantExecuteTool('draft_item', {rhythm:'every Tuesday'}, session, context);
    const tueSnap = {ok:tuesday.ok, times:tuesday.draft && tuesday.draft.timesPerPeriod, days:tuesday.draft && tuesday.draft.periodDays, weekdays:tuesday.draft && tuesday.draft.allowedWeekdays};
    session.parsed = assistantParseUtterance('Change it to every Tuesday, Wednesday and Friday', context.catalog, Date.now());
    const list = assistantExecuteTool('draft_item', {rhythm:'every Tuesday, Wednesday and Friday'}, session, context);
    const listSnap = {ok:list.ok, times:list.draft && list.draft.timesPerPeriod, weekdays:list.draft && list.draft.allowedWeekdays};
    session.parsed = assistantParseUtterance('Change it to every two days', context.catalog, Date.now());
    const twoDays = assistantExecuteTool('draft_item', {rhythm:'every two days'}, session, context);
    const twoSnap = {ok:twoDays.ok, times:twoDays.draft && twoDays.draft.timesPerPeriod, days:twoDays.draft && twoDays.draft.periodDays, weekdays:twoDays.draft && twoDays.draft.allowedWeekdays};
    session.parsed = assistantParseUtterance('Change it to three times in eight days', context.catalog, Date.now());
    const eight = assistantExecuteTool('draft_item', {rhythm:'three times in eight days'}, session, context);
    const eightSnap = {ok:eight.ok, times:eight.draft && eight.draft.timesPerPeriod, days:eight.draft && eight.draft.periodDays};
    session.parsed = assistantParseUtterance('Change it to every weekend', context.catalog, Date.now());
    const weekend = assistantExecuteTool('draft_item', {rhythm:'every weekend'}, session, context);
    const weekendSnap = {ok:weekend.ok, times:weekend.draft && weekend.draft.timesPerPeriod, weekdays:weekend.draft && weekend.draft.allowedWeekdays};
    const llmReplies = [
      {message:{thinking:'edit', tool_calls:[{function:{name:'draft_item', arguments:{kind:'habit', rhythm:'every Tuesday'}}}]}}
    ];
    const session2 = assistantCreateSession();
    assistantFocusHabit(session2, found, context);
    const forced = await runAssistantTurn('Can you change the outside exercise to every Tuesday', {
      forceLlm:true,
      session:session2,
      context,
      complete:async () => llmReplies.shift()
    });
    return {
      toolOk:toolSnap.ok,
      toolTimes:toolSnap.times,
      toolDays:toolSnap.days,
      toolHid:toolSnap.hid,
      toolName:toolSnap.name,
      tueOk:tueSnap.ok,
      tueTimes:tueSnap.times,
      tueWeekdays:tueSnap.weekdays,
      listOk:listSnap.ok,
      listTimes:listSnap.times,
      listWeekdays:listSnap.weekdays,
      twoOk:twoSnap.ok,
      twoTimes:twoSnap.times,
      twoDays:twoSnap.days,
      twoWeekdays:twoSnap.weekdays,
      eightOk:eightSnap.ok,
      eightTimes:eightSnap.times,
      eightDays:eightSnap.days,
      weekendOk:weekendSnap.ok,
      weekendTimes:weekendSnap.times,
      weekendWeekdays:weekendSnap.weekdays,
      forcedType:forced.type,
      forcedTimes:forced.draft && forced.draft.timesPerPeriod,
      forcedWeekdays:forced.draft && forced.draft.allowedWeekdays,
      forcedName:forced.draft && forced.draft.name,
      leftover:llmReplies.length
    };
  });
  assert(upsert.toolOk && upsert.toolTimes === 5 && upsert.toolDays === 7, 'draft_item rhythm string updates the focused habit');
  assert(/outside exercise/i.test(upsert.toolName || '') && upsert.toolHid, 'upsert keeps the existing item identity');
  assert(upsert.tueOk && upsert.tueTimes === 1 && JSON.stringify(upsert.tueWeekdays) === JSON.stringify([2]), 'draft_item "every Tuesday" pins Tuesday');
  assert(upsert.listOk && upsert.listTimes === 3 && JSON.stringify(upsert.listWeekdays) === JSON.stringify([2,3,5]), 'draft_item weekday list is Tue/Wed/Fri');
  assert(upsert.twoOk && upsert.twoTimes === 1 && upsert.twoDays === 2, 'draft_item "every two days" is 1× / 2d');
  assert(JSON.stringify(upsert.twoWeekdays || []) === JSON.stringify([]), 'count cadence clears a weekday pin');
  assert(upsert.eightOk && upsert.eightTimes === 3 && upsert.eightDays === 8, 'draft_item "three times in eight days"');
  assert(upsert.weekendOk && upsert.weekendTimes === 1 && JSON.stringify(upsert.weekendWeekdays) === JSON.stringify([0,6]), 'draft_item "every weekend" is Sat/Sun');
  assert(upsert.forcedType === 'preview' && upsert.forcedTimes === 1 && JSON.stringify(upsert.forcedWeekdays) === JSON.stringify([2]), 'forced LLM draft_item call applies every Tuesday');
  assert(/outside exercise/i.test(upsert.forcedName || '') && upsert.leftover === 0, 'tool call used the focused outside exercise');

  console.log('\n[I] assistant debug trace');
  const debugTrace = await page.evaluate(async () => {
    saveSortSettings({ ...DEFAULT_SORT_SETTINGS, localAssistant:true, localAssistantDebug:true, locations:[], weatherProfiles:[] });
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    const local = await runAssistantTurn('Remind me to call mom');
    const replies = [
      { message:{ thinking:'classify now', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'fill draft', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Pharmacy', durationMinutes:20, due:'today' } } }] } }
    ];
    const llm = await runAssistantTurn('Remind me to go to the pharmacy for 20 minutes', {
      forceLlm:true,
      complete:async () => replies.shift()
    });
    return {
      debugPressed:document.getElementById('setting-local-assistant-debug')?.getAttribute('aria-pressed'),
      sheetPressed:document.getElementById('assistant-debug-toggle')?.getAttribute('aria-pressed'),
      bodyClass:document.body.classList.contains('assistant-debug-on'),
      localTypes:(local.debug || []).map(ev => ev.t),
      localText:local.debugText || '',
      localPath:((local.debug || []).find(ev => ev.t === 'path') || {}).path,
      localTool:((local.debug || []).find(ev => ev.t === 'tool') || {}).name,
      llmTypes:(llm.debug || []).map(ev => ev.t),
      llmTools:(llm.debug || []).filter(ev => ev.t === 'tool').map(ev => ev.name),
      llmDraft:((llm.debug || []).find(ev => ev.t === 'tool' && ev.name === 'draft_item') || {}).args,
      llmThink:/think /i.test(llm.debugText || '')
    };
  });
  assert(debugTrace.debugPressed === 'true' && debugTrace.sheetPressed === 'true' && debugTrace.bodyClass, 'debug switch is on');
  assert(debugTrace.localPath === 'local' && debugTrace.localTool === 'draft_item', 'local turn records path and draft_item');
  assert(/parse /.test(debugTrace.localText) && /path local/.test(debugTrace.localText), 'local debug text has parse and path');
  assert(debugTrace.llmTools.includes('classify_intent') && debugTrace.llmTools.includes('draft_item'), 'llm debug lists classify and draft_item');
  assert(debugTrace.llmDraft && /Pharmacy/i.test(JSON.stringify(debugTrace.llmDraft)), 'llm debug keeps draft_item args');
  assert(debugTrace.llmThink, 'llm debug includes thinking');
  assert(debugTrace.localTypes.includes('done') && debugTrace.llmTypes.includes('done'), 'both paths finish with a done event');

  await page.evaluate(() => {
    if(typeof openAssistantSheet === 'function')openAssistantSheet();
  });
  await page.waitForSelector('#assistant-sheet.open');
  await page.evaluate(() => {
    if(typeof clearAssistantChat === 'function')clearAssistantChat();
  });
  await page.locator('#assistant-input').fill('Remind me to call mom');
  await page.locator('#assistant-send').click();
  await page.waitForSelector('#assistant-thread .assistant-bubble-debug .assistant-debug-log');
  const debugUi = await page.locator('#assistant-thread .assistant-bubble-debug .assistant-debug-log').last().textContent();
  assert(/parse /.test(debugUi) && /path local/.test(debugUi) && /call draft_item/.test(debugUi), 'chat debug card shows parse, path, and tool');

  console.log('\n[J] complicated phrasing routes to the model, not the fast path');
  const route = await page.evaluate(async () => {
    saveSortSettings({ ...DEFAULT_SORT_SETTINGS, localAssistant:true, localAssistantDebug:true });
    const calls = [];
    const script = [
      { message:{ thinking:'relative date', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'draft', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Meeting', due:'2026-09-19', dueTime:'13:00' } } }] } }
    ];
    const out = await runAssistantTurn('Can you add a meeting for day after tomorrow at 1 p.m.?', {
      complete:async req => {
        calls.push((req.messages || []).map(msg => String(msg.content || '')).join('\n'));
        return script.shift();
      }
    });
    const envelope = calls[0] || '';
    const pathEvent = (out.debug || []).find(ev => ev.t === 'path') || {};
    const drafted = out.draft || {};
    return {
      type:out.type,
      llmCalls:calls.length,
      path:pathEvent.path,
      via:pathEvent.via,
      risk:pathEvent.risk,
      name:drafted.name,
      dueKey:typeof dateKey === 'function' && drafted.dueDate != null ? dateKey(drafted.dueDate) : null,
      dueTime:drafted.dueTime,
      envHasDate:/"date":\{"iso":"\d{4}-\d{2}-\d{2}"/.test(envelope),
      envHasFacts:/"extractedFacts":\{/.test(envelope)
    };
  });
  assert(route.type === 'preview' && route.llmCalls === 2, 'day after tomorrow goes to the model and drafts');
  assert(route.path === 'llm' && route.via === 'parser-risk' && route.risk === 'relative-date', 'trace shows the relative-date risk route');
  assert(route.name === 'Meeting' && route.dueKey === '2026-09-19' && route.dueTime === '13:00', 'model draft carries the right date and time');
  assert(route.envHasDate, 'envelope includes today ISO date');
  assert(!route.envHasFacts, 'untrusted local facts are withheld from the model');

  const routeTime = await page.evaluate(async () => {
    const script = [
      { message:{ thinking:'t', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'draft', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Meeting', due:'2026-09-19', windowText:'from 11:30 am to 1 pm' } } }] } }
    ];
    const out = await runAssistantTurn('Create a meeting for two days after tomorrow, from eleven thirty a.m. to one p.m.', {
      complete:async () => script.shift()
    });
    const w = out.draft && out.draft.window || {};
    return {
      type:out.type,
      name:out.draft && out.draft.name,
      start:w.start && (w.start.clock || w.start.anchor),
      end:w.end && (w.end.clock || w.end.anchor)
    };
  });
  assert(routeTime.type === 'preview' && /meeting/i.test(routeTime.name || ''), 'two days after tomorrow also goes to the model');
  assert(routeTime.start === '11:30' && routeTime.end === '13:00', 'model windowText becomes an 11:30-13:00 window');

  const riskTable = await page.evaluate(() => {
    const now = Date.now();
    const catalog = assistantCatalog([], { locations:[], weatherProfiles:[] }, now);
    const riskOf = text => assistantFastPathRisk(text, assistantParseUtterance(text, catalog, now));
    return {
      negation:riskOf('I did not do the laundry'),
      minutes:riskOf('I did 30 minutes of work'),
      relative:riskOf('remind me to pay in two weeks'),
      simple0:riskOf('remind me to call mom'),
      simple1:riskOf('add a walk between 5pm and 7pm'),
      simple2:riskOf('I already did Walk')
    };
  });
  assert(riskTable.negation === 'negation' && riskTable.minutes === 'minutes' && riskTable.relative === 'relative-date', 'risk audit flags negation, minutes, relative dates');
  assert(riskTable.simple0 === null && riskTable.simple1 === null && riskTable.simple2 === null, 'simple phrasing still passes the audit');

  const staysLocal = await page.evaluate(async () => {
    try{
      const out = await runAssistantTurn('Remind me to call mom', {
        complete:async () => { throw new Error('LLM must not run for simple phrasing'); }
      });
      return { type:out.type, name:out.draft && out.draft.name };
    }catch(err){
      return { type:'threw', text:String(err && err.message || err) };
    }
  });
  assert(staysLocal.type === 'preview' && /mom/i.test(staysLocal.name || ''), 'simple create never reaches the model');

  console.log('\n[G] live Qwen3.8 think+tools (optional)');
  const live = await page.evaluate(async () => {
    try{
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if(!res.ok)return { skipped:true, reason:'tags '+res.status };
      const tags = await res.json();
      const names = (tags.models || []).map(row => row.name);
      if(!names.some(name => /qwen3\.8/i.test(name)))return { skipped:true, reason:'no qwen3.8' };
      const catalog = assistantCatalog([], { locations:[], weatherProfiles:[] }, Date.now());
      const raw = await fetch('http://127.0.0.1:11434/api/chat', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body:JSON.stringify({
          model:pickAssistantModel(names, 'qwen3.8:27b-mlx'),
          stream:false,
          think:true,
          keep_alive:'10m',
          options:{ temperature:0.2, num_predict:1200 },
          messages:[
            { role:'system', content:assistantSystemPrompt() },
            { role:'user', content:assistantUserEnvelope('Create a 45 minute walk after sunset', catalog, null) }
          ],
          tools:assistantOllamaTools(['classify_intent'])
        })
      });
      if(!raw.ok)return { skipped:true, reason:'chat '+raw.status };
      const body = await raw.json();
      const parsed = assistantParseReply(body);
      const call = parsed.toolCalls && parsed.toolCalls[0];
      return {
        skipped:false,
        thinking:Boolean(parsed.thinking),
        tool:call && call.name,
        intent:call && call.args && call.args.intent,
        toolCount:(parsed.toolCalls || []).length,
        rawKeys:body.message ? Object.keys(body.message) : [],
        rawToolNames:((body.message && body.message.tool_calls) || []).map(row => row && row.function && row.function.name)
      };
    }catch(err){
      return { skipped:true, reason:String(err && err.message || err) };
    }
  });
    if(live.skipped){
    console.log('  skip: ' + live.reason);
  }else{
    assert(live.thinking, 'live Qwen returned a thinking trace');
    assert(live.tool === 'classify_intent', 'live Qwen called classify_intent');
    assert(live.intent === 'create_task' || live.intent === 'create_habit', 'live classify is a create intent');
  }

  console.log('\n[K] always-use-Qwen setting and use-AI-instead retry');
  const modelOnlyTurn = await page.evaluate(async () => {
    const script = [
      { message:{ thinking:'classify', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'draft', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Mom call', due:'today' } } }] } }
    ];
    patchLocalAssistant({ localAssistant:true, localAssistantModelOnly:true });
    const out = await runAssistantTurn('Remind me to call mom', {
      complete:async () => script.shift()
    });
    const pathEvent = (out.debug || []).find(ev => ev.t === 'path') || {};
    const res = {
      type:out.type,
      fastPath:out.fastPath === true,
      path:pathEvent.path,
      via:pathEvent.via,
      name:out.draft && out.draft.name,
      togglePressed:document.getElementById('setting-local-assistant-model-only')?.getAttribute('aria-pressed')
    };
    patchLocalAssistant({ localAssistantModelOnly:false });
    return res;
  });
  assert(modelOnlyTurn.type === 'preview' && modelOnlyTurn.name === 'Mom call', 'model-only setting sends simple phrasing to the model');
  assert(modelOnlyTurn.fastPath !== true && modelOnlyTurn.path === 'llm' && modelOnlyTurn.via === 'setting', 'trace shows the model-only route');
  assert(modelOnlyTurn.togglePressed === 'true', 'always-use-Qwen toggle reflects the setting');

  const retryUi = await page.evaluate(async () => {
    if(typeof clearAssistantChat === 'function')clearAssistantChat();
    const replies = [
      { message:{ thinking:'classify', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'draft', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Ring mom', due:'today' } } }] } }
    ];
    window.assistantComplete = async () => replies.shift();
    await sendAssistantMessage('Remind me to call mom');
    await new Promise(resolve => setTimeout(resolve, 60));
    const retryBtn = document.querySelector('#assistant-thread [data-assistant-retry]');
    const before = document.querySelectorAll('#assistant-thread .assistant-bubble').length;
    let after = before;
    if(retryBtn){
      retryBtn.click();
      for(let i = 0; i < 40 && after <= before; i += 1){
        await new Promise(resolve => setTimeout(resolve, 50));
        after = document.querySelectorAll('#assistant-thread .assistant-bubble').length;
      }
    }
    return {
      hadRetry:Boolean(retryBtn),
      label:retryBtn ? retryBtn.textContent.trim() : '',
      rowGone:!retryBtn || !retryBtn.isConnected,
      before,
      after,
      lastPreview:Array.from(document.querySelectorAll('#assistant-thread .assistant-preview-name')).pop()?.textContent || ''
    };
  });
  assert(retryUi.hadRetry && /use AI instead/i.test(retryUi.label), 'fast-path preview offers use AI instead');
  assert(retryUi.rowGone && retryUi.after > retryUi.before, 'retry re-runs the utterance through the model');
  assert(/Ring mom/i.test(retryUi.lastPreview), 'retry preview comes from the model, not the fast path');

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
