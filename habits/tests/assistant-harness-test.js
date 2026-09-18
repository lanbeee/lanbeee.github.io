// Local assistant harness: parse/repair, catalogs, draft save. Fake LLM by
// default; optional live Qwen3.8 if Ollama is reachable from the page.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

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
  await waitForAssistant(page);

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

  console.log('\n[D2] broken tool JSON stays in the loop and is steered');
  const steered = await page.evaluate(async () => {
    const prompt = 'Create a 5 times a week Study habit (1 hour long) which will be from 15 min before sunrise to 2 hours after sunrise or 9 AM whichever is earlier';
    const calls = [];
    const out = await runAssistantTurn(prompt, {
      forceLlm:true,
      complete:async (req) => {
        calls.push({
          step:req.step,
          think:req.think,
          format:req.format || null,
          tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean),
          lastUser:String((req.messages || []).filter(m => m && m.role === 'user').slice(-1)[0] && (req.messages || []).filter(m => m && m.role === 'user').slice(-1)[0].content || '').slice(0, 240)
        });
        if(req.step === 'classify'){
          return {message:{role:'assistant', thinking:'habit', tool_calls:[{function:{name:'classify_intent', arguments:{intent:'create_habit'}}}]}};
        }
        if(calls.filter(row => row.step === 'extract').length === 1){
          throw new Error("Value looks like object, but can't find closing '}' symbol");
        }
        return {message:{role:'assistant', content:JSON.stringify({
          kind:'habit',
          name:'Study',
          durationMinutes:60,
          rhythm:'five times a week',
          windowText:'from 15 min before sunrise to 2 hours after sunrise or 9 AM whichever is earlier'
        })}};
      }
    });
    const end = out.draft && out.draft.window && out.draft.window.end;
    return {
      type:out.type,
      name:out.draft && out.draft.name,
      duration:out.draft && out.draft.durationMinutes,
      times:out.draft && out.draft.timesPerPeriod,
      startOff:out.draft && out.draft.window && out.draft.window.start && out.draft.window.start.offsetMin,
      endCombine:end && end.combine,
      endSecond:end && end.second && end.second.minutes,
      repairs:out.session && out.session.repairs,
      calls,
      debug:out.debugText || '',
      extractTools:calls.find(row => row.step === 'extract') && calls.find(row => row.step === 'extract').tools,
      steeredFlat:/FLAT strings|windowText|do not nest/i.test(calls.map(row => row.lastUser).join('\n'))
    };
  });
  assert(steered.type === 'preview' && /study/i.test(steered.name || ''), 'extract JSON failure still drafts Study after a steered retry');
  assert(steered.duration === 60 && steered.times === 5, 'retry kept 1 hour and 5× / week');
  assert(steered.startOff === -15 && steered.endCombine === 'earlier' && steered.endSecond === 9 * 60, 'windowText after repair is sunrise−15 to earlier of sunrise+2h and 9am');
  assert(/broken-json|repair/i.test(steered.debug), 'debug shows a repair turn, not a stumble');
  assert(steered.extractTools && steered.extractTools.indexOf('draft_item') >= 0 && steered.extractTools.indexOf('set_window') < 0, 'extract only offers draft_item, not nested set_window');
  assert(steered.steeredFlat, 'repair tells the model to use flat windowText strings');
  assert(steered.calls.filter(row => row.step === 'extract').some(row => row.think === false), 'repair turns thinking off so the tool JSON still fits');
  assert(steered.calls.filter(row => row.step === 'extract').some(row => row.format === 'json' && (!row.tools || !row.tools.length)), 'repair drops native tools and asks for a JSON object');

  console.log('\n[D3] focused follow-up stays on the model with currentDraft');
  const followLoc = await page.evaluate(async () => {
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      defaultDurationMinutes:30,
      locations:[{id:'home-1', name:'Sample Home', lat:51.5, lng:-0.12}],
      weatherProfiles:[]
    });
    const now = Date.now();
    const context = assistantBuildContext(now);
    const catalog = context.catalog;
    const parsed = assistantParseUtterance('Add the location home.', catalog, now);
    const session = assistantCreateSession();
    session.draft = {
      kind:'habit',
      name:'Study',
      durationMinutes:60,
      timesPerPeriod:5,
      periodDays:7,
      window:{
        start:{kind:'anchor', anchor:'sunrise', offsetMin:-15},
        end:{kind:'anchor', anchor:'sunrise', offsetMin:120, combine:'earlier', second:{kind:'clock', minutes:9*60, clock:'09:00'}}
      }
    };
    const wouldCreate = assistantShouldLocalCreate(parsed, session);
    const calls = [];
    const out = await runAssistantTurn('Add the location home.', {
      session,
      context,
      complete:async req => {
        const user = (req.messages || []).filter(m => m && m.role === 'user').map(m => String(m.content || '')).join('\n');
        calls.push({
          step:req.step,
          tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean),
          hasDraft:/"currentDraft":\{/.test(user) && /"name":"Study"/.test(user),
          hasFacts:/"extractedFacts":\{/.test(user)
        });
        return {message:{thinking:'place', tool_calls:[{function:{name:'draft_item', arguments:{placeNames:'Home'}}}]}};
      }
    });
    const pathEv = (out.debug || []).find(ev => ev.t === 'path') || {};
    const forced = await runAssistantTurn('Add the location home.', {
      forceLlm:true,
      session:Object.assign(assistantCreateSession(), {draft:session.draft}),
      context,
      complete:async req => {
        calls.push({forcedStep:req.step});
        return {message:{thinking:'place', tool_calls:[{function:{name:'draft_item', arguments:{placeNames:'Sample Home'}}}]}};
      }
    });
    return {
      intent:parsed.intent,
      itemName:parsed.itemName,
      places:parsed.places && parsed.places.slice(),
      wouldCreate,
      type:out.type,
      name:out.draft && out.draft.name,
      kind:out.draft && out.draft.kind,
      place:out.draft && out.draft.places && out.draft.places.names && out.draft.places.names[0],
      times:out.draft && out.draft.timesPerPeriod,
      path:pathEv.path,
      via:pathEv.via,
      firstStep:calls[0] && calls[0].step,
      hasDraft:calls[0] && calls[0].hasDraft,
      hasFacts:calls[0] && calls[0].hasFacts,
      forcedType:forced.type,
      forcedName:forced.draft && forced.draft.name,
      forcedPlace:forced.draft && forced.draft.places && forced.draft.places.names && forced.draft.places.names[0],
      forcedStep:calls.find(row => row.forcedStep) && calls.find(row => row.forcedStep).forcedStep
    };
  });
  assert(followLoc.intent === 'edit_item' && followLoc.itemName == null, 'add-the-location is an edit, not a new task name');
  assert(followLoc.places && /home/i.test(followLoc.places.join(' ')), 'parser still resolves Home/Sample Home for salvage');
  assert(followLoc.wouldCreate !== true, 'focused add-location is not a local create');
  assert(followLoc.type === 'preview' && followLoc.name === 'Study' && followLoc.kind === 'habit', 'follow-up keeps the Study habit');
  assert(/home/i.test(followLoc.place || '') && followLoc.times === 5, 'model sets the place on Study and keeps 5× / week');
  assert(followLoc.path === 'llm' && followLoc.via === 'focus-continue', 'debug stays on the model, not local via create');
  assert(followLoc.firstStep === 'extract' && followLoc.hasDraft === true && followLoc.hasFacts !== true, 'extract sees currentDraft Study and withholds parser facts');
  assert(followLoc.forcedType === 'preview' && followLoc.forcedName === 'Study' && /home/i.test(followLoc.forcedPlace || ''), 'use-AI-instead keeps the unsaved Study draft');
  assert(followLoc.forcedStep === 'extract', 'force llm on a focused follow-up skips classify so it cannot say unclear');

  console.log('\n[D4] unknown places keep currentDraft so the next line is extract, not classify');
  const keptPlace = await page.evaluate(async () => {
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[
        {id:'home-1', name:'Sample Home', lat:51.5, lng:-0.12},
        {id:'mom-1', name:"Sample Mom's house", lat:51.51, lng:-0.13}
      ],
      weatherProfiles:[]
    });
    save([]);
    const now = Date.now();
    const context = assistantBuildContext(now);
    const session = assistantCreateSession();
    const first = await runAssistantTurn(
      'Create a habit for barbecue once in a week and select appropriate time, best weather and appropriate duration etc',
      {
        session,
        context,
        forceLlm:true,
        complete:async req => {
          if(req.step === 'classify'){
            return {message:{thinking:'habit', tool_calls:[{function:{name:'classify_intent', arguments:{intent:'create_habit'}}}]}};
          }
          return {message:{thinking:'draft', tool_calls:[{function:{name:'draft_item', arguments:{
            kind:'habit',
            name:'Weekly Barbecue',
            durationMinutes:120,
            rhythm:'weekly',
            windowText:'from 15 minutes before sunset to 2 hours after sunset',
            weatherText:'sunny and mild',
            placeNames:['backyard', 'rooftop']
          }}}]}};
        }
      }
    );
    const followCalls = [];
    const follow = await runAssistantTurn('Use home and mom\'s house', {
      session:first.session || session,
      context:assistantBuildContext(now),
      complete:async req => {
        const user = (req.messages || []).filter(m => m && m.role === 'user').map(m => String(m.content || '')).join('\n');
        followCalls.push({
          step:req.step,
          hasDraft:/"currentDraft":\{/.test(user) && /Weekly Barbecue/.test(user),
          hasFacts:/"extractedFacts":\{/.test(user)
        });
        if(req.step === 'classify')throw new Error('place follow-up should skip classify');
        return {message:{thinking:'places', tool_calls:[{function:{name:'draft_item', arguments:{
          placeNames:['Sample Home', "Sample Mom's house"]
        }}}]}};
      }
    });
    const names = follow.draft && follow.draft.places && follow.draft.places.names || [];
    return {
      firstType:first.type,
      firstName:first.draft && first.draft.name,
      firstDuration:first.draft && first.draft.durationMinutes,
      firstPlaces:first.draft && first.draft.places && first.draft.places.names,
      firstAsk:/saved place/i.test(first.question || ''),
      awaiting:first.session && first.session.awaiting,
      followType:follow.type,
      followName:follow.draft && follow.draft.name,
      followDuration:follow.draft && follow.draft.durationMinutes,
      followPlaces:names.slice(),
      followStep:followCalls[0] && followCalls[0].step,
      followDraft:followCalls[0] && followCalls[0].hasDraft,
      followFacts:followCalls[0] && followCalls[0].hasFacts,
      followText:follow.text || follow.error || follow.question || ''
    };
  });
  assert(keptPlace.firstType === 'ask' && keptPlace.firstAsk, 'invented places ask for a saved place');
  assert(keptPlace.firstName === 'Weekly Barbecue' && keptPlace.firstDuration === 120, 'the barbecue draft is kept while asking');
  assert(!keptPlace.firstPlaces || !keptPlace.firstPlaces.length, 'unknown backyard/rooftop are not attached');
  assert(!keptPlace.awaiting, 'does not switch to local awaiting-place');
  assert(keptPlace.followType === 'preview' && keptPlace.followName === 'Weekly Barbecue' && keptPlace.followDuration === 120, 'follow-up previews the same habit');
  assert(keptPlace.followPlaces.includes('Sample Home') && keptPlace.followPlaces.some(name => /mom/i.test(name)), 'draft_item uses catalog place names from the model');
  assert(keptPlace.followStep === 'extract' && keptPlace.followDraft === true && keptPlace.followFacts !== true, 'follow-up is extract with currentDraft and no parser facts');

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
    const lanInit = assistantFetchInit('http://192.168.1.12:11434/api/tags', {method:'GET'});
    const tailInit = assistantFetchInit('https://nabeel-macbook.tail123.ts.net/api/tags', {method:'GET'});
    if(typeof syncAssistantOriginHelp === 'function')syncAssistantOriginHelp();
    return {
      getSpace:getInit.targetAddressSpace,
      getHasType:Boolean(getInit.headers && getInit.headers['Content-Type']),
      postSpace:postInit.targetAddressSpace,
      postType:postInit.headers && postInit.headers['Content-Type'],
      lanSpace:lanInit.targetAddressSpace,
      tailSpace:tailInit.targetAddressSpace,
      publicFail,
      public403,
      allow,
      setup:assistantOllamaSetupCommands('https://lanbeee.github.io', 'mac'),
      loopback:normalizeLocalAssistantUrl('http://127.0.0.1:11434'),
      bareLan:normalizeLocalAssistantUrl('192.168.1.12:11434'),
      lanNoPort:normalizeLocalAssistantUrl('http://10.0.0.8'),
      cgnat:normalizeLocalAssistantUrl('http://100.64.1.2:11434'),
      magic:normalizeLocalAssistantUrl('https://nabeel-macbook.tail123.ts.net'),
      bareMagic:normalizeLocalAssistantUrl('nabeel-macbook.tail123.ts.net'),
      openai:normalizeLocalAssistantUrl('https://api.openai.com'),
      publicIp:normalizeLocalAssistantUrl('http://8.8.8.8:11434'),
      pageOrigin:assistantPublicPageOrigin(),
      guide:Boolean(document.getElementById('assistant-reach-guide')),
      guideLead:(document.getElementById('assistant-reach-lead')?.textContent || ''),
      guideCmd:(document.getElementById('assistant-reach-cmd')?.textContent || ''),
      stepCount:document.querySelectorAll('#assistant-reach-guide li').length,
      copyBtn:Boolean(document.getElementById('assistant-copy-origins')),
      originHelpGone:!document.getElementById('assistant-origin-help'),
      guideRestart:(document.getElementById('assistant-reach-step-restart')?.textContent || ''),
      guideListen:(document.getElementById('assistant-reach-step-listen')?.textContent || ''),
      guidePhone:(document.getElementById('assistant-reach-step-phone')?.textContent || ''),
      urlType:document.getElementById('assistant-url')?.getAttribute('type'),
      csp:(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '')
    };
  });
  assert(reach.getSpace === 'loopback' && reach.postSpace === 'loopback', 'loopback fetches declare targetAddressSpace');
  assert(reach.lanSpace === 'local' && reach.tailSpace === 'local', 'LAN and Tailscale fetches declare local address space');
  assert(!reach.getHasType && reach.postType === 'application/json', 'JSON content-type is only set when there is a body');
  assert(/https:\/\/\*\.ts\.net/.test(reach.csp), 'CSP allows private Tailscale HTTPS model endpoints');
  assert(/Settings → local assistant/i.test(reach.publicFail) && /quit and reopen Ollama/i.test(reach.publicFail), 'GitHub Pages fetch error points at the in-app steps');
  assert(/Settings → local assistant/i.test(reach.public403), '403 points at the in-app steps');
  assert(reach.allow === 'launchctl setenv OLLAMA_ORIGINS "https://lanbeee.github.io"', 'Mac allow command is the launchctl line');
  assert(/OLLAMA_HOST "0\.0\.0\.0:11434"/.test(reach.setup), 'setup commands also listen on the network');
  assert(reach.loopback === 'http://127.0.0.1:11434', 'loopback URL still saves');
  assert(reach.bareLan === 'http://192.168.1.12:11434', 'bare LAN IP plus port is saved like Immich');
  assert(reach.lanNoPort === 'http://10.0.0.8:11434', 'LAN URL without a port defaults to 11434');
  assert(reach.cgnat === 'http://100.64.1.2:11434' && reach.magic === 'https://nabeel-macbook.tail123.ts.net'
    && reach.bareMagic === 'https://nabeel-macbook.tail123.ts.net', 'Tailscale IP and MagicDNS URLs save; bare MagicDNS defaults to HTTPS');
  assert(reach.openai === '' && reach.publicIp === '', 'public cloud and public IPs are rejected');
  assert(!reach.pageOrigin && reach.guide && reach.stepCount === 6 && reach.copyBtn && reach.originHelpGone, 'settings shows a six-step reach guide');
  assert(reach.urlType === 'text', 'address field is text so a phone can save a LAN URL');
  assert(/already allowed|phone/i.test(reach.guideLead) && /launchctl setenv OLLAMA_ORIGINS "https:\/\/lanbeee\.github\.io"/.test(reach.guideCmd), 'loopback page still shows the GitHub Pages command');
  assert(/OLLAMA_HOST/.test(reach.guideCmd), 'reach guide includes the listen command');
  assert(/Fully quit Ollama/i.test(reach.guideRestart) && /do(?:es)? nothing until/i.test(reach.guideRestart), 'reach guide says the allow command needs a full Ollama quit');
  assert(/tailscale serve --bg 11434/i.test(reach.guideListen) && /https:\/\/.*ts\.net/i.test(reach.guidePhone), 'reach guide explains the private HTTPS phone route');

  const savedUrl = await page.evaluate(() => {
    saveSortSettings({ ...loadSortSettings(), localAssistant:true, localAssistantUrl:'' });
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    const el = document.getElementById('assistant-url');
    el.value = '192.168.4.20:11434';
    el.dispatchEvent(new Event('change', {bubbles:true}));
    const okShown = el.value;
    const okStored = (typeof assistantSettings === 'function' ? assistantSettings().url : '');
    const okStatus = document.getElementById('assistant-conn-status')?.textContent || '';
    el.value = 'https://api.openai.com/v1';
    el.dispatchEvent(new Event('change', {bubbles:true}));
    return {
      okShown,
      okStored,
      okStatus,
      rejectedShown:el.value,
      rejectedStored:(typeof assistantSettings === 'function' ? assistantSettings().url : ''),
      rejectedStatus:document.getElementById('assistant-conn-status')?.textContent || ''
    };
  });
  assert(savedUrl.okShown === 'http://192.168.4.20:11434' && savedUrl.okStored === 'http://192.168.4.20:11434', 'phone can save a LAN address');
  assert(/Saved/i.test(savedUrl.okStatus), 'saving a laptop URL confirms it stuck');
  assert(savedUrl.rejectedShown === 'https://api.openai.com/v1' && savedUrl.rejectedStored === 'http://192.168.4.20:11434', 'rejected cloud URL is not written');
  assert(/not saved/i.test(savedUrl.rejectedStatus), 'rejected URL explains why it did not save');

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

  console.log('\n[F] compact model context at 85%');
  const compact = await page.evaluate(() => {
    const replay = assistantReplayMessage({content:'', thinking:'z'.repeat(ASSISTANT_THINKING_REPLAY_MAX + 400), toolCalls:[]});
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
      {role:'user', content:'Call draft_item with windowText. sunset means maghrib.'}
    ];
    const before = assistantPromptTokens(session.messages, []);
    const out = assistantMaybeCompact(session, [], session.parsed.text);
    const small = assistantCreateSession();
    small.contextLimit = ASSISTANT_DEFAULT_CONTEXT_TOKENS;
    small.messages = [
      {role:'system', content:'sys'},
      {role:'user', content:'short'}
    ];
    const skip = assistantMaybeCompact(small, [], 'short');
    const win = ASSISTANT_DEFAULT_CONTEXT_TOKENS;
    const at = ASSISTANT_CONTEXT_COMPACT_AT;
    return {
      at,
      win,
      guess:assistantGuessContextLimit('qwen3.8:27b-mlx'),
      fromShow:assistantContextFromShow({
        model_info:{ 'qwen3.context_length':32768 },
        parameters:'num_ctx                       131072\nnum_gpu 99'
      }),
      classifyPredict:assistantStepPredict('classify'),
      extractPredict:assistantStepPredict('extract'),
      should:assistantShouldCompact(Math.ceil(win * at), win),
      shouldNot:assistantShouldCompact(Math.floor(win * at) - 1, win),
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
  assert(compact.at === 0.85 && compact.win === 131072, 'compact waits until 85% of a 128k window');
  assert(compact.guess === 131072 && compact.fromShow === 131072, 'Qwen guess and Ollama num_ctx are 128k');
  assert(compact.classifyPredict >= 4096 && compact.extractPredict >= 6144, 'generation budget leaves room to think before the tool call');
  assert(compact.should && !compact.shouldNot, '85% of the window is the compact trigger');
  assert(compact.ollamaTokens === 4096 && compact.openAiTokens === 99, 'prompt token counts are read from Ollama and LM Studio');
  assert(compact.replayLen <= compact.replayMax + 1, 'replayed thinking is capped');
  assert(compact.compacted && compact.after < compact.before, 'over-budget traces are compacted smaller');
  assert(compact.roles.join(',') === 'system,user', 'compact keeps system + one summary user');
  assert(/outside exercise/.test(compact.blob) && /maghrib/.test(compact.blob), 'compact keeps the focused habit and its window');
  assert(!compact.oldThinking, 'compact drops thinking traces');
  assert(!compact.skipCompacted, 'short prompts stay as-is under 85%');

  const compactTurn = await page.evaluate(async () => {
    const replies = [
      {message:{thinking:'t'.repeat(2500), tool_calls:[{function:{name:'classify_intent', arguments:{intent:'create_task'}}}]}, prompt_eval_count:900},
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

  console.log('\n[H2] draft_item can set every item setting');
  const fields = await page.evaluate(() => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      defaultDurationMinutes:30,
      defaultBreakable:false,
      defaultTopics:['inbox'],
      locations:[{id:'home-1', name:'Home', lat:51.5, lng:-0.12},{id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    const seed = (typeof normalize === 'function' ? normalize : (x=>x))([
      {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
      {name:'outside exercise', type:'reduce', target:7/3, durationMinutes:30, logs:[], lastLog:null, topics:['health'], breakable:true, minChunkMinutes:15, earlyWindowDays:2, delayAllowanceDays:1, emoji:'🏃', emojiBgColor:'teal', pinned:true}
    ]);
    save(seed);
    const now = Date.now();
    const context = assistantBuildContext(now);
    const found = assistantFindHabit(load(), 'outside exercise');
    const session = assistantCreateSession();
    assistantFocusHabit(session, found, context);
    const tool = assistantExecuteTool('draft_item', {
      habitKind:'limit',
      emoji:'💪',
      emojiColor:'amber',
      topics:'health, fitness',
      monthDays:'1, 15',
      preferredWeekdays:'Saturday',
      preferredWindowText:'between 8am and 10am',
      earlyDays:3,
      delayDays:0,
      breakable:'split into 20 minutes',
      autoMarkMinutes:'manual',
      trackValue:true,
      pinned:true,
      showWeather:true,
      weatherAtPlace:true,
      weatherPlace:'Home',
      placePrefs:'Home high, Gym avoid',
      after:'Walk',
      order:'right after Walk, same day',
      links:'https://example.com/workout',
      option:'Tue 9am-11am at Gym'
    }, session, context);
    const commit = tool.ok ? assistantCommitDraft(tool.draft) : {ok:false, error:tool.error};
    const habit = commit.ok ? load()[commit.index] : null;
    const partner = load().find(item => item && item.name === 'Walk');
    session.parsed = assistantParseUtterance('Change it to five times a week', context.catalog, now);
    const rhythmOnly = assistantExecuteTool('draft_item', {rhythm:'five times a week'}, session, {
      ...context,
      data:load(),
      catalog:assistantCatalog(load(), context.settings, now)
    });
    const afterRhythm = rhythmOnly.ok ? assistantCommitDraft(rhythmOnly.draft) : {ok:false};
    const kept = afterRhythm.ok ? load()[afterRhythm.index] : null;
    const taskSession = assistantCreateSession();
    const task = assistantExecuteTool('draft_item', {
      kind:'task',
      name:'File taxes',
      due:'tomorrow',
      hardDue:true,
      snooze:'2 hours',
      sharedDisplay:false,
      sharedComplete:false
    }, taskSession, assistantBuildContext(now));
    const taskCommit = task.ok ? assistantCommitDraft(task.draft) : {ok:false};
    const taskHabit = taskCommit.ok ? load()[taskCommit.index] : null;
    const later = assistantParseWindowFromText('later of 6pm and sunset until isha');
    return {
      toolOk:tool.ok,
      ask:tool.ask || null,
      error:tool.error || commit.error || null,
      type:habit && habit.type,
      emoji:habit && habit.emoji,
      emojiBg:habit && habit.emojiBgColor,
      topics:habit && habit.topics,
      monthDays:habit && habit.allowedMonthDays,
      prefDays:habit && habit.preferredWeekdays,
      prefStart:habit && habit.preferredTimeStart,
      prefEnd:habit && habit.preferredTimeEnd,
      early:habit && habit.earlyWindowDays,
      delay:habit && habit.delayAllowanceDays,
      breakable:habit && habit.breakable,
      chunk:habit && habit.minChunkMinutes,
      autoMark:habit && habit.autoMarkMinutes,
      track:habit && habit.trackValue,
      pinned:habit && habit.pinned,
      showWeather:habit && habit.showWeather,
      weatherAt:habit && habit.showWeatherAtLocation,
      weatherPlace:habit && habit.weatherLocationId,
      prefHome:habit && habit.locationPrefs && habit.locationPrefs['home-1'],
      prefGym:habit && habit.locationPrefs && habit.locationPrefs['gym-1'],
      linkKind:habit && habit.scheduleLinks && habit.scheduleLinks[0] && habit.scheduleLinks[0].direction,
      linkHid:habit && habit.scheduleLinks && habit.scheduleLinks[0] && habit.scheduleLinks[0].anchorHid,
      linkAdj:habit && habit.scheduleLinks && habit.scheduleLinks[0] && habit.scheduleLinks[0].adjacency,
      sameDay:habit && habit.scheduleLinks && habit.scheduleLinks[0] && habit.scheduleLinks[0].requireSameDay,
      partnerHid:partner && partner.hid,
      url:habit && habit.links && habit.links[0] && habit.links[0].value,
      optionLoc:habit && habit.scheduleOptions && habit.scheduleOptions[0] && habit.scheduleOptions[0].locationId,
      optionStart:habit && habit.scheduleOptions && habit.scheduleOptions[0] && habit.scheduleOptions[0].start,
      optionDays:habit && habit.scheduleOptions && habit.scheduleOptions[0] && habit.scheduleOptions[0].weekdays,
      keptType:kept && kept.type,
      keptTopics:kept && kept.topics,
      keptBreakable:kept && kept.breakable,
      keptPinned:kept && kept.pinned,
      keptTimes:kept && typeof rhythmParts === 'function' ? rhythmParts(kept.target).times : null,
      taskOk:taskCommit.ok,
      taskDelay:taskHabit && taskHabit.delayAllowanceDays,
      taskHard:taskHabit && taskHabit.hardDue,
      taskShared:taskHabit && taskHabit.showOnSharedDisplay,
      taskComplete:taskHabit && taskHabit.allowSharedDisplayCompletion,
      snoozed:taskHabit && taskHabit.snoozedUntil != null,
      laterStart:later && later.start && later.start.kind,
      laterCombine:later && later.start && later.start.combine,
      laterSecond:later && later.start && later.start.second && later.start.second.anchor,
      laterEnd:later && later.end && later.end.anchor,
      schemaKeys:Object.keys(ASSISTANT_TOOL_DEFS.draft_item.parameters.properties)
    };
  });
  assert(fields.toolOk && !fields.ask && !fields.error, 'full-settings draft_item applies without asking (' + (fields.error || fields.ask || '') + ')');
  assert(fields.type === 'reduce', 'habitKind limit saves as reduce');
  assert(fields.emoji === '💪' && fields.emojiBg === 'amber', 'emoji and color save');
  assert(JSON.stringify(fields.topics) === JSON.stringify(['health','fitness']), 'topics save');
  assert(JSON.stringify(fields.monthDays) === JSON.stringify([1,15]), 'month days save');
  assert(JSON.stringify(fields.prefDays) === JSON.stringify([6]), 'preferred Saturday saves');
  assert(fields.prefStart === 8 * 60 && fields.prefEnd === 10 * 60, 'preferred window saves');
  assert(fields.early === 3 && fields.delay === 0, 'early/delay days save');
  assert(fields.breakable === true && fields.chunk === 20, 'breakable split and min chunk save');
  assert(fields.autoMark === null && fields.track === true && fields.pinned === true, 'manual auto-mark, track value, and pin save');
  assert(fields.showWeather === true && fields.weatherAt === true && fields.weatherPlace === 'home-1', 'weather card settings save');
  assert(fields.prefHome === 'high' && fields.prefGym === 'avoid', 'place preferences save');
  assert(fields.linkKind === 'after' && fields.linkHid === fields.partnerHid && fields.linkAdj === 'direct' && fields.sameDay === true, 'order link is direct after Walk, same day');
  assert(/example\.com\/workout/.test(fields.url || ''), 'action link saves');
  assert(fields.optionLoc === 'gym-1' && fields.optionStart === 9 * 60 && JSON.stringify(fields.optionDays) === JSON.stringify([2]), 'specific Tue 9am Gym option saves');
  assert(fields.keptType === 'reduce' && JSON.stringify(fields.keptTopics) === JSON.stringify(['health','fitness']) && fields.keptBreakable === true && fields.keptPinned === true, 'a rhythm-only follow-up keeps the other settings');
  assert(fields.keptTimes === 5, 'rhythm-only follow-up still updates cadence');
  assert(fields.taskOk && fields.taskDelay === 0 && fields.taskHard === true, 'hard due sets delay 0');
  assert(fields.taskShared === false && fields.taskComplete === false && fields.snoozed, 'shared-display flags and snooze save');
  assert(fields.laterStart === 'clock' && fields.laterCombine === 'later' && fields.laterSecond === 'maghrib' && fields.laterEnd === 'isha', 'later-of window text parses');
  assert(fields.schemaKeys.includes('habitKind') && fields.schemaKeys.includes('breakable') && fields.schemaKeys.includes('order') && fields.schemaKeys.includes('links') && fields.schemaKeys.includes('option'), 'draft_item schema lists the extra settings');

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

  console.log('\n[L] use-AI-instead does not copy parser guesses into the model');
  const forceFacts = await page.evaluate(async () => {
    const calls = [];
    const script = [
      { message:{ thinking:'c', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'d', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Mom call', due:'today' } } }] } }
    ];
    const out = await runAssistantTurn('Remind me to call mom', {
      forceLlm:true,
      complete:async req => {
        calls.push((req.messages || []).map(msg => String(msg.content || '')).join('\n'));
        return script.shift();
      }
    });
    const parseEv = (out.debug || []).find(ev => ev.t === 'parse') || {};
    return {
      type:out.type,
      name:out.draft && out.draft.name,
      fastPath:out.fastPath === true,
      hasFacts:/"extractedFacts":\{/.test(calls[0] || ''),
      factsTrusted:parseEv.factsTrusted === true,
      leftover:script.length
    };
  });
  assert(forceFacts.type === 'preview' && /mom/i.test(forceFacts.name || '') && forceFacts.leftover === 0, 'forced simple phrasing still drafts via the model');
  assert(forceFacts.fastPath !== true && forceFacts.hasFacts !== true && forceFacts.factsTrusted !== true, 'use AI instead withholds extractedFacts');

  const noMerge = await page.evaluate(async () => {
    const script = [
      { message:{ thinking:'c', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'d', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Pharmacy', due:'today' } } }] } }
    ];
    const out = await runAssistantTurn('Remind me to go to the pharmacy for 20 minutes', {
      forceLlm:true,
      complete:async () => script.shift()
    });
    return {name:out.draft && out.draft.name, duration:out.draft && out.draft.durationMinutes};
  });
  assert(/pharmacy/i.test(noMerge.name || ''), 'forced draft keeps the model name');
  assert(noMerge.duration == null, 'untrusted parser duration is not merged into the model draft');

  const riskNoMerge = await page.evaluate(async () => {
    const script = [
      { message:{ thinking:'c', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }] } },
      { message:{ thinking:'d', tool_calls:[{ function:{ name:'draft_item', arguments:{ kind:'task', name:'Contractor', due:'2026-10-01' } } }] } }
    ];
    const out = await runAssistantTurn('remind me to pay the contractor in two weeks for 20 minutes', {
      complete:async () => script.shift()
    });
    const dueKey = out.draft && out.draft.dueDate != null && typeof dateKey === 'function'
      ? dateKey(out.draft.dueDate)
      : null;
    const pathEvent = (out.debug || []).find(ev => ev.t === 'path') || {};
    return {
      type:out.type,
      name:out.draft && out.draft.name,
      duration:out.draft && out.draft.durationMinutes,
      dueKey,
      via:pathEvent.via,
      risk:pathEvent.risk
    };
  });
  assert(riskNoMerge.type === 'preview' && /contractor/i.test(riskNoMerge.name || ''), 'relative-date risk still drafts from the model');
  assert(riskNoMerge.via === 'parser-risk' && riskNoMerge.risk === 'relative-date', 'two weeks is the relative-date route');
  assert(riskNoMerge.dueKey === '2026-10-01' && riskNoMerge.duration == null, 'model due wins; parser minutes are not patched on');

  console.log('\n[S] settings create + weather propose on items');
  const settings = await page.evaluate(async () => {
    const jsonHabit = assistantParseReply({
      message:{ role:'assistant', content:'{"name":"Barbecue","weatherText":"not raining"}' }
    }, 'extract');
    const jsonSetting = assistantParseReply({
      message:{ role:'assistant', content:'{"kind":"weather","name":"Barbecuing","weatherText":"not raining"}' }
    }, 'extract');
    const catalog = assistantCatalog([], { weatherProfiles:[], locations:[] }, Date.now());
    const asHabit = assistantParseUtterance('Create a habit for barbecuing only if it is not raining', catalog, Date.now());
    const asProfile = assistantParseUtterance('Create a weather profile for barbecuing', catalog, Date.now());
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      weatherProfiles:[],
      locations:[]
    });
    save([]);
    const llm = async () => { throw new Error('LLM should not run for barbecuing profile'); };
    const local = await runAssistantTurn('Create a weather profile for barbecuing', { complete:llm });
    const script = [
      { message:{ thinking:'c', tool_calls:[{ function:{ name:'classify_intent', arguments:{ intent:'create_habit' } } }] } },
      { message:{ thinking:'d', tool_calls:[{ function:{ name:'draft_item', arguments:{
        kind:'habit', name:'Barbecue', rhythm:'once a week', weatherText:'only if it is not raining'
      } } }] } }
    ];
    const model = await runAssistantTurn('Create a weekly barbecue habit only if it is not raining', {
      forceLlm:true,
      complete:async () => script.shift()
    });
    const saved = model.type === 'preview' ? assistantCommitDraft(model.draft) : {ok:false, error:model.error || model.type};
    const habit = saved.ok ? load()[saved.index] : null;
    const profile = (loadSortSettings().weatherProfiles || []).find(row => row && row.id === (habit && habit.weatherProfileId));
    const miss = assistantApplyDraftItem({
      kind:'task',
      name:'Picnic',
      weatherProfile:'Windy picnic',
      weatherText:'not too windy and not raining'
    }, assistantEmptyDraft(), assistantCatalog([], {weatherProfiles:[]}, Date.now()), Date.now(), loadSortSettings(), []);
    const missSaved = miss.ok ? assistantCommitDraft(miss.draft) : {ok:false, error:miss.error};
    const picnic = missSaved.ok ? load()[missSaved.index] : null;
    const picnicProfile = (loadSortSettings().weatherProfiles || []).find(row => row && row.id === (picnic && picnic.weatherProfileId));
    const namedDry = assistantApplyDraftItem({
      kind:'habit',
      name:'Stretch',
      weatherText:'Dry'
    }, assistantEmptyDraft(), {
      weather:[{id:'dry-1', name:'Dry'}],
      places:[]
    }, Date.now(), {weatherProfiles:[{id:'dry-1', name:'Dry'}]}, []);
    return {
      jsonHabit:jsonHabit.toolCalls && jsonHabit.toolCalls[0] && jsonHabit.toolCalls[0].name,
      jsonSetting:jsonSetting.toolCalls && jsonSetting.toolCalls[0] && jsonSetting.toolCalls[0].name,
      habitIntent:asHabit.intent,
      profileIntent:asProfile.intent,
      profileKind:asProfile.settingKind,
      localType:local.type,
      localKind:local.draft && local.draft.kind,
      localName:local.draft && local.draft.name,
      modelType:model.type,
      modelName:model.draft && model.draft.name,
      modelWeather:model.draft && model.draft.weather && model.draft.weather.name,
      savedOk:saved.ok,
      weatherId:habit && habit.weatherProfileId,
      rainMax:profile && (profile.rules || []).some(rule => rule.metric === 'precipitation_probability' && rule.max === 20),
      missOk:miss.ok && missSaved.ok,
      picnicName:picnicProfile && picnicProfile.name,
      picnicWind:picnicProfile && (picnicProfile.rules || []).some(rule => rule.metric === 'wind_speed_10m'),
      picnicRain:picnicProfile && (picnicProfile.rules || []).some(rule => rule.metric === 'precipitation_probability'),
      namedDryOk:namedDry.ok && namedDry.draft && namedDry.draft.weather && namedDry.draft.weather.name === 'Dry' && namedDry.draft.weather.profileId === 'dry-1'
    };
  });
  assert(settings.jsonHabit === 'draft_item', 'weatherText JSON without kind is an item draft');
  assert(settings.jsonSetting === 'draft_setting', 'kind weather JSON is a setting draft');
  assert(settings.habitIntent === 'create_habit', 'habit + weather conditions is create_habit');
  assert(settings.profileIntent === 'create_setting' && settings.profileKind === 'weather', 'weather profile for barbecuing is create_setting');
  assert(settings.localType === 'preview' && settings.localKind === 'weather' && /barbecu/i.test(settings.localName || ''), 'barbecuing profile previews locally');
  assert(settings.modelType === 'preview' && /barbecue/i.test(settings.modelName || ''), 'model habit+weatherText still previews');
  assert(settings.savedOk && settings.weatherId && settings.rainMax, 'saving the habit creates a covering weather profile');
  assert(settings.missOk && /picnic|windy|outdoor|calm/i.test(settings.picnicName || ''), 'unknown weatherProfile name still creates a profile');
  assert(settings.picnicWind && settings.picnicRain, 'proposed picnic profile keeps wind and rain rules');
  assert(settings.namedDryOk, 'weatherText Dry attaches the catalog Dry profile');

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
