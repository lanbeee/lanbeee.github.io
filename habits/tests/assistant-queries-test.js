// Assistant read/action tools. Direct handler calls are deterministic.
// Compound, ranking, and follow-up questions run against live Ollama in
// assistant-compound-test.js — do not script those answers here.
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
  const page = await browser.newPage({ viewport:{ width:1280, height:800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await waitForAssistant(page);

  // Rebuild the rendered week from current data so the query tools (which
  // prefer _homeRenderedWeek) never see a stale baseline.
  await page.evaluate(() => {
    globalThis.refreshHomeWeekForAssistant = () => {
      const data = load();
      const settings = loadSortSettings();
      const week = buildWeekAgenda(data, settings, 7);
      _homeRenderedWeek = week;
      if(typeof saveHomeAgendaCache === 'function')saveHomeAgendaCache(data, week);
      return Array.isArray(week && week.days) ? week.days.length : 0;
    };
    refreshHomeWeekForAssistant();
  });

  console.log('\n[seed] profile, home coords, and a fresh 7-day forecast');
  const seeded = await page.evaluate(() => {
    const profile = {id:'dry', name:'Dry', rules:[
      {metric:'precipitation_probability', max:40, min:null, hard:true, relative:'none'}
    ]};
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      minimalMode:false,
      homeCityName:'Test City',
      homeCityLat:40.7,
      homeCityLng:-74,
      weatherProfiles:[profile],
      blockedTimes:[]
    });
    const now = Date.now();
    const dayMs = 86400000;
    const base = dayStart(now);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const mkDay = (offset, code, lo, hi, chance) => ({
      key:new Date(base + 12 * 3600000 + offset * dayMs).toLocaleDateString('sv-SE'),
      ts:base + 12 * 3600000 + offset * dayMs, weather_code:code,
      temperature_2m_min:lo, temperature_2m_max:hi,
      apparent_temperature_min:lo - 1, apparent_temperature_max:hi + 1,
      precipitation_probability_max:chance, precipitation_sum:0.1,
      snowfall_sum:0, wind_speed_10m_max:9, wind_gusts_10m_max:15, uv_index_max:3
    });
    const samples = [];
    for(let h = 0; h < 24; h += 1){
      samples.push({
        ts:base + h * 3600000,
        temperature_2m:20, apparent_temperature:21,
        precipitation_probability:(h >= 17 && h < 19) ? 90 : 10,
        precipitation:0, snowfall:0,
        wind_speed_10m:9, wind_gusts_10m:15,
        uv_index:3, weather_code:2, is_day:1, source:'weekly'
      });
    }
    const bucket = { weekly:{
      lat:40.7, lng:-74, fetchedAt:now - 600000, timezone:tz, samples,
      days:[0,1,2,3,4,5,6].map(offset => mkDay(offset, 2, 18, 28, 10))
    } };
    weatherCacheWrite(bucket);
    globalThis.__queryTestWeatherBucket = bucket;
    loadSortSettings(); // rebuild settings._weatherContext from the cache
    return {
      hasContext:Boolean(weatherPlannerContext(loadSortSettings(), now)),
      summary:weatherDaySummary(weatherPlannerContext(loadSortSettings(), now), base, loadSortSettings(), now)
    };
  });
  assert(seeded.hasContext && seeded.summary && Number.isFinite(seeded.summary.high),
    'planner context + today summary resolve from the fabricated cache');
  globalThis.__restoreWeatherBucket = null;

  console.log('\n[turn] "If I add a task tomorrow 5 to 6 pm, am I going to miss anything else?"');
  const conflictTurn = await page.evaluate(async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    saveSortSettings({...loadSortSettings(), blockedTimes:[
      {label:'Family call', days:[tomorrow.getDay()], start:17 * 60 + 15, end:18 * 60}
    ]});
    refreshHomeWeekForAssistant();
    const replies = [
      { message:{ role:'assistant', thinking:'schedule question', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'ask_schedule' } } }
      ] } },
      { message:{ role:'assistant', thinking:'check the window', tool_calls:[
        { function:{ name:'answer_schedule', arguments:{ query:'conflict', date:'tomorrow', start:'5pm', end:'6pm' } } }
      ] } }
    ];
    const steps = [];
    const out = await runAssistantTurn('If I add a task tomorrow 5 to 6 pm, am I going to miss anything else?', {
      complete:async req => {
        steps.push({step:req.step, tools:(req.tools || []).map(row => row && row.function && row.function.name).filter(Boolean)});
        return replies.shift();
      }
    });
    return { type:out.type, text:out.text, steps, debug:out.debugText || '' };
  });
  assert(conflictTurn.type === 'say', 'turn answers with a say bubble');
  assert(conflictTurn.steps[0] && conflictTurn.steps[0].step === 'classify' && conflictTurn.steps[1] && conflictTurn.steps[1].step === 'query',
    'classify steers into the query step');
  assert(conflictTurn.steps[1] && conflictTurn.steps[1].tools.includes('answer_schedule')
    && conflictTurn.steps[1].tools.includes('answer_weather'),
    'query step declares both answer tools');
  assert(/Family call/.test(conflictTurn.text) && /fixed|clash/i.test(conflictTurn.text),
    `conflict answer names the fixed block: ${conflictTurn.text}`);

  console.log('\n[turn] the same window on a clear evening is open');
  const openTurn = await page.evaluate(async () => {
    saveSortSettings({...loadSortSettings(), blockedTimes:[]});
    refreshHomeWeekForAssistant();
    const replies = [
      { message:{ role:'assistant', thinking:'schedule question', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'ask_schedule' } } }
      ] } },
      { message:{ role:'assistant', thinking:'check the window', tool_calls:[
        { function:{ name:'answer_schedule', arguments:{ query:'conflict', date:'tomorrow', start:'5pm', end:'6pm' } } }
      ] } }
    ];
    const out = await runAssistantTurn('If I add a task tomorrow 5 to 6 pm, am I going to miss anything else?', {
      complete:async () => replies.shift()
    });
    return { type:out.type, text:out.text };
  });
  assert(openTurn.type === 'say' && /Nothing to miss/i.test(openTurn.text),
    `open window answers "nothing to miss": ${openTurn.text}`);

  console.log('\n[turn] vague conflict lists what the assistant can do');
  const vagueTurn = await page.evaluate(async () => {
    const replies = [
      { message:{ role:'assistant', thinking:'schedule question', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'ask_schedule' } } }
      ] } },
      { message:{ role:'assistant', thinking:'no window given', tool_calls:[
        { function:{ name:'answer_schedule', arguments:{ query:'conflict' } } }
      ] } }
    ];
    const out = await runAssistantTurn('Will it be a problem?', {
      complete:async () => replies.shift()
    });
    return { type:out.type, text:out.text };
  });
  assert(vagueTurn.type === 'say' && /time window/i.test(vagueTurn.text) && /freest/i.test(vagueTurn.text),
    'vague query answers honestly and enumerates capabilities');

  console.log('\n[turn] "What should I do given the weather?" is not answered locally');
  const weatherTurn = await page.evaluate(async () => {
    const replies = [
      { message:{ role:'assistant', thinking:'weather question', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'ask_weather' } } }
      ] } },
      { message:{ role:'assistant', thinking:'forecast it', tool_calls:[
        { function:{ name:'answer_weather', arguments:{ query:'day', date:'today' } } }
      ] } }
    ];
    const steps = [];
    const out = await runAssistantTurn('What should I do given the weather?', {
      complete:async req => {
        steps.push({step:req.step});
        return replies.shift();
      }
    });
    return { type:out.type, text:out.text, steps };
  });
  assert(weatherTurn.steps[0] && weatherTurn.steps[0].step === 'classify',
    'the weather ask_today lookalike still reaches the model');
  assert(weatherTurn.type === 'say' && /Test City|forecast/i.test(weatherTurn.text),
    `weather day answer is grounded in the forecast: ${weatherTurn.text}`);

  console.log('\n[grounding] model prose cannot overwrite factual tool results');
  const grounding = await page.evaluate(async () => {
    saveSortSettings({...loadSortSettings(), locations:[{id:'home', name:'Home', address:'1 Main St'}]});
    refreshHomeWeekForAssistant();
    const context = assistantBuildContext();
    const expectedFree = await assistantAnswerSchedule({query:'free', date:'today'}, context);
    const expectedPlaces = assistantAnswerSettings({kind:'places'}, context);
    const singleReplies = [
      {message:{thinking:'use computed schedule', tool_calls:[
        {function:{name:'answer_schedule', arguments:{query:'free', date:'today'}}}
      ]}},
      {message:{content:'You have 99 hours free in three overlapping gaps from 7pm to midnight.'}}
    ];
    const single = await runAssistantTurn('How much free time do I have today?', {
      context,
      complete:async () => singleReplies.shift()
    });
    const compoundReplies = [
      {message:{thinking:'answer both parts from tools', tool_calls:[
        {function:{name:'answer_schedule', arguments:{query:'free', date:'today'}}},
        {function:{name:'answer_settings', arguments:{kind:'places'}}}
      ]}},
      {message:{content:'You have 88 hours free and your saved place is Atlantis.'}}
    ];
    const compound = await runAssistantTurn('How much free time do I have today, and what places are saved?', {
      context,
      complete:async () => compoundReplies.shift()
    });
    const now = Date.now();
    save([{hid:'grounded-amma', name:'Call Amma', type:'habit', target:7,
      logs:[makeActualLog(now - 2 * 86400000)], lastLog:now - 2 * 86400000}]);
    refreshHomeWeekForAssistant();
    const followContext = assistantBuildContext();
    const expectedHistory = await assistantExecuteTool('lookup_item',
      {name:'Call Amma', query:'history'}, assistantCreateSession(), followContext);
    const followSession = assistantCreateSession();
    followSession.recent = {request:'When is Call Amma next?', referent:'Call Amma', say:'Call Amma is on your list.'};
    const followReplies = [
      {message:{content:'You have never called Amma.'}},
      {message:{thinking:'verify history', tool_calls:[
        {function:{name:'lookup_item', arguments:{name:'Call Amma', query:'history'}}}
      ]}},
      {message:{content:'You called yesterday at noon.'}}
    ];
    const follow = await runAssistantTurn('When did I do it last?', {
      context:followContext,
      session:followSession,
      complete:async () => followReplies.shift()
    });
    save([]);
    refreshHomeWeekForAssistant();
    return {
      expectedFree:expectedFree.text,
      expectedPlaces:expectedPlaces.text,
      expectedHistory:expectedHistory.text,
      single:{type:single.type, text:single.text},
      compound:{type:compound.type, text:compound.text},
      follow:{type:follow.type, text:follow.text, tools:(follow.debug || []).filter(row => row.t === 'tool').map(row => row.name)}
    };
  });
  assert(grounding.single.type === 'say' && grounding.single.text === grounding.expectedFree
    && !/99 hours|overlapping/i.test(grounding.single.text),
    `a fabricated rewrite is discarded: ${grounding.single.text}`);
  assert(grounding.compound.type === 'say'
    && grounding.compound.text === `${grounding.expectedFree}\n\n${grounding.expectedPlaces}`
    && !/88 hours|Atlantis/i.test(grounding.compound.text),
    `compound answers preserve each authoritative result: ${grounding.compound.text}`);
  assert(grounding.follow.type === 'say' && grounding.follow.text === grounding.expectedHistory
    && grounding.follow.tools.includes('lookup_item')
    && !/never called|yesterday at noon/i.test(grounding.follow.text),
    `follow-ups must refresh facts through a tool: ${grounding.follow.text}`);

  console.log('\n[routing] natural query wording bypasses the legacy local answers');
  const routedQueries = await page.evaluate(() => [
    'What should I do tomorrow?',
    'What do I have tomorrow?',
    'Do I have time tomorrow from 5pm to 6pm?',
    'How much free time do I have tomorrow?',
    'What should I do if it is windy?',
    'What should I do if it is hot?'
  ].map(text => {
    const session = assistantCreateSession();
    const local = assistantTryLocalTurn(text, session, assistantBuildContext());
    const path = session.debug.find(row => row.t === 'path');
    return {text, local:Boolean(local), path:path && path.path, via:path && path.via};
  }));
  assert(routedQueries.every(row => !row.local && row.path === 'llm'),
    `future-day, availability, and broad weather questions reach the model: ${JSON.stringify(routedQueries)}`);

  console.log('\n[model-first] direct tools bypass mandatory classification');
  const directTools = await page.evaluate(async () => {
    const seed = [
      {hid:'h-direct', name:'Morning walk', type:'habit', logs:[]},
      {hid:'t-direct', name:'Buy stamps', type:'task', dueDate:dayStart(Date.now()), logs:[]}
    ];
    save(seed);
    const calls = [];
    const listed = await runAssistantTurn('What habits do I have?', {
      complete:async req => {
        calls.push({step:req.step, tools:(req.tools || []).map(row => row.function.name)});
        return {message:{thinking:'list habits', tool_calls:[{function:{name:'answer_items', arguments:{query:'list', kind:'habit'}}}]}};
      }
    });
    const removed = await runAssistantTurn('Delete Buy stamps', {
      complete:async req => {
        calls.push({step:req.step, tools:(req.tools || []).map(row => row.function.name)});
        return {message:{thinking:'remove task safely', tool_calls:[{function:{name:'delete_item', arguments:{name:'Buy stamps'}}}]}};
      }
    });
    const before = load().some(row => row && row.hid === 't-direct');
    const committed = assistantCommitDelete(removed.session.pendingDelete);
    const after = load().some(row => row && row.hid === 't-direct');
    save([]);
    refreshHomeWeekForAssistant();
    return {calls, listedType:listed.type, listedText:listed.text, removedType:removed.type, removedText:removed.text, before, committed, after};
  });
  assert(directTools.calls.some(row => row.step === 'classify' && row.tools.includes('answer_items'))
    && directTools.calls.some(row => row.tools.includes('delete_item')),
    'answer and delete tools can be selected on the first model pass');
  assert(directTools.calls[0].tools.includes('answer_items') && directTools.calls.some(row => row.tools.includes('delete_item')),
    'first-pass tool surface includes important questions and actions');
  assert(directTools.listedType === 'say' && /Morning walk/.test(directTools.listedText),
    `direct item-list answer is grounded in saved data: ${directTools.listedText}`);
  assert(directTools.removedType === 'delete' && /Buy stamps/.test(directTools.removedText) && directTools.before,
    'delete tool previews without mutating data');
  assert(directTools.committed.ok && !directTools.after,
    'explicit confirmation removes the selected item');

  const focusedAction = await page.evaluate(async () => {
    save([{hid:'focused-delete', name:'Temporary focus', type:'task', dueDate:dayStart(Date.now()), logs:[]}]);
    const session = assistantCreateSession();
    session.draft = assistantHabitToDraft(load()[0], 0, loadSortSettings(), load());
    let offered = [];
    const out = await runAssistantTurn('delete it', {
      session,
      complete:async req => {
        offered = (req.tools || []).map(row => row.function.name);
        return {message:{thinking:'delete focused item', tool_calls:[{function:{name:'delete_item', arguments:{name:'Temporary focus'}}}]}};
      }
    });
    save([]);
    return {type:out.type, offered, pending:out.session.pendingDelete && out.session.pendingDelete.name};
  });
  assert(focusedAction.type === 'delete' && focusedAction.pending === 'Temporary focus'
    && focusedAction.offered.includes('delete_item') && focusedAction.offered.includes('complete_item')
    && focusedAction.offered.includes('lookup_item') && focusedAction.offered.includes('plan_item'),
    'focused follow-ups can delete, complete, look up, or plan “it” through model tools');

  console.log('\n[clarify] delete + ambiguous name keeps the delete action');
  const clarifyDelete = await page.evaluate(async () => {
    save([
      {hid:'call-amma', name:'Call Amma', type:'keepup', logs:[]},
      {hid:'call-baba', name:'Call Baba', type:'keepup', logs:[]}
    ]);
    const session = assistantCreateSession();
    const first = await runAssistantTurn('Delete call', {
      session,
      complete:async () => ({message:{thinking:'search', tool_calls:[{function:{name:'find_item', arguments:{query:'call', action:'delete'}}}]}})
    });
    const awaiting = first.session && first.session.awaiting;
    const clarifying = first.session && first.session.clarifyingRequest;
    const secondSteps = [];
    const second = await runAssistantTurn('Call Amma', {
      session,
      complete:async req => {
        secondSteps.push({
          step:req.step,
          tools:(req.tools || []).map(row => row.function.name),
          steer:(req.messages || []).map(row => row.content || '').join(' ')
        });
        return {message:{thinking:'delete the named one', tool_calls:[{function:{name:'delete_item', arguments:{name:'Call Amma'}}}]}};
      }
    });
    save([]);
    return {
      firstType:first.type,
      choices:first.choices,
      awaiting,
      clarifying,
      secondType:second.type,
      pending:second.pendingDelete && second.pendingDelete.name,
      secondSteps
    };
  });
  assert(clarifyDelete.firstType === 'ask'
    && (clarifyDelete.choices || []).includes('Call Amma')
    && (clarifyDelete.choices || []).includes('Call Baba')
    && clarifyDelete.awaiting === 'delete',
    `ambiguous delete asks and stays on delete: ${clarifyDelete.awaiting} / ${(clarifyDelete.choices || []).join(', ')}`);
  assert(clarifyDelete.secondSteps[0] && clarifyDelete.secondSteps[0].step === 'delete'
    && clarifyDelete.secondSteps[0].tools.includes('delete_item')
    && /Delete call/.test(clarifyDelete.secondSteps[0].steer),
    'the name-chip reply continues delete with the original request in context');
  assert(clarifyDelete.secondType === 'delete' && clarifyDelete.pending === 'Call Amma',
    'confirming the name previews removing that item');

  console.log('\n[clarify] a miss from find_item does not abort a create');
  const findThenCreate = await page.evaluate(async () => {
    save([]);
    const calls = [];
    const out = await runAssistantTurn('Add a Stretch habit every morning', {
      complete:async req => {
        calls.push(req.step);
        if(calls.length === 1){
          return {message:{thinking:'search first', tool_calls:[{function:{name:'find_item', arguments:{query:'Stretch'}}}]}};
        }
        return {message:{thinking:'create it', tool_calls:[{function:{name:'draft_item', arguments:{kind:'habit', name:'Stretch', rhythm:'every morning'}}}]}};
      }
    });
    return {type:out.type, name:out.draft && out.draft.name, calls};
  });
  assert(findThenCreate.type === 'preview' && findThenCreate.name === 'Stretch' && findThenCreate.calls.length >= 2,
    `empty find_item continues into create: ${findThenCreate.type} ${findThenCreate.name}`);

  console.log('\n[routing] model list/plan/delete intents are not overwritten by ask_today');
  const prefer = await page.evaluate(() => ({
    items:assistantPreferIntent('ask_items', {intent:'ask_today', confident:true}),
    del:assistantPreferIntent('delete_item', {intent:'ask_today', confident:true}),
    plan:assistantPreferIntent('plan_item', {intent:'lookup_item', confident:true}),
    lookup:assistantPreferIntent('create_task', {intent:'lookup_item', confident:true})
  }));
  assert(prefer.items === 'ask_items' && prefer.del === 'delete_item' && prefer.plan === 'plan_item',
    `grounded model intents win: ${JSON.stringify(prefer)}`);
  assert(prefer.lookup === 'lookup_item',
    'a question still wins over a create guess');

  console.log('\n[actions] one-day plans preview, replace, remove, and remain undoable');
  const planActions = await page.evaluate(async () => {
    const base = dayStart(Date.now());
    const tomorrow = dateKey(base + 86400000);
    save([{hid:'plan-walk', name:'Evening walk', type:'habit', target:1, logs:[]}]);
    saveSortSettings({...loadSortSettings(), locations:[{id:'home', name:'Home', lat:1, lng:1}]});
    const addSession = assistantCreateSession();
    const preview = await assistantExecuteTool('plan_item', {
      name:'Evening walk', action:'add', date:'tomorrow', time:'3pm', place:'Home'
    }, addSession, assistantBuildContext());
    const before = normalizeLogs(load()[0].logs).filter(isPlanLog).length;
    const added = assistantCommitPlan(addSession.pendingPlan);
    const addedPlans = normalizeLogs(load()[0].logs).filter(isPlanLog);

    const replaceSession = assistantCreateSession();
    const replacePreview = await assistantExecuteTool('plan_item', {
      name:'Evening walk', date:'tomorrow', time:'4:30pm'
    }, replaceSession, assistantBuildContext());
    const replaced = assistantCommitPlan(replaceSession.pendingPlan);
    const replacedPlans = normalizeLogs(load()[0].logs).filter(isPlanLog);

    const removeSession = assistantCreateSession();
    const removePreview = await assistantExecuteTool('plan_item', {
      name:'Evening walk', action:'remove', date:'tomorrow'
    }, removeSession, assistantBuildContext());
    const removed = assistantCommitPlan(removeSession.pendingPlan);
    const after = normalizeLogs(load()[0].logs).filter(isPlanLog).length;
    const emptySession = assistantCreateSession();
    const empty = await assistantExecuteTool('plan_item', {
      name:'Evening walk', action:'remove', date:'tomorrow'
    }, emptySession, assistantBuildContext());
    save([]);
    saveSortSettings({...loadSortSettings(), locations:[]});
    refreshHomeWeekForAssistant();
    return {
      tomorrow,before,preview,added,
      addedMeta:{count:addedPlans.length,timed:planTimed(addedPlans[0]),locationId:planLocationId(addedPlans[0]),hour:new Date(logTime(addedPlans[0])).getHours()},
      replacePreview,replaced,
      replacedMeta:{count:replacedPlans.length,hour:new Date(logTime(replacedPlans[0])).getHours(),minute:new Date(logTime(replacedPlans[0])).getMinutes()},
      removePreview,removed,after,empty
    };
  });
  assert(planActions.preview.ok && planActions.before === 0 && /Plan Evening walk/.test(planActions.preview.summary),
    'planning an existing item is a non-mutating confirmation preview');
  assert(planActions.added.ok && planActions.addedMeta.count === 1
    && planActions.addedMeta.timed && planActions.addedMeta.locationId === 'home'
    && planActions.addedMeta.hour === 15,
    'confirmed plan writes one timed, place-specific occurrence');
  assert(planActions.replacePreview.pendingPlan.replacing === 1 && planActions.replaced.ok
    && planActions.replacedMeta.count === 1 && planActions.replacedMeta.hour === 16 && planActions.replacedMeta.minute === 30,
    'planning the same day replaces rather than duplicates the occurrence');
  assert(planActions.removePreview.ok && planActions.removed.ok && planActions.after === 0,
    'unplanning also previews and removes only that day’s occurrence');
  assert(planActions.empty.ok && planActions.empty.noChange && /no one-day plan/i.test(planActions.empty.text),
    'unplanning a missing occurrence answers honestly without a write');

  console.log('\n[actions] rich completion logs and mark-not-done correction');
  const completionActions = await page.evaluate(async () => {
    save([{hid:'tracked-water', name:'Water', type:'habit', target:1, trackValue:true, logs:[]}]);
    const logSession = assistantCreateSession();
    const preview = await assistantExecuteTool('complete_item', {
      name:'Water', value:8, minutes:20, note:'after lunch'
    }, logSession, assistantBuildContext());
    const before = normalizeLogs(load()[0].logs).length;
    const logged = assistantCommitComplete(logSession.pendingComplete);
    const stored = normalizeLogs(load()[0].logs);
    const entry = stored[stored.length - 1];
    const undoSession = assistantCreateSession();
    const undoPreview = await assistantExecuteTool('complete_item', {
      name:'Water', action:'undo_today'
    }, undoSession, assistantBuildContext());
    const undone = assistantCommitComplete(undoSession.pendingComplete);
    const after = normalizeLogs(load()[0].logs).length;
    const emptySession = assistantCreateSession();
    const empty = await assistantExecuteTool('complete_item', {
      name:'Water', action:'undo_today'
    }, emptySession, assistantBuildContext());
    save([]);
    refreshHomeWeekForAssistant();
    return {
      preview,before,logged,minutes:logMinutes(entry),value:logValue(entry),note:logNote(entry),
      undoPreview,undone,after,empty
    };
  });
  assert(completionActions.preview.ok && completionActions.before === 0
    && /20m/.test(completionActions.preview.summary) && /value 8/.test(completionActions.preview.summary),
    'completion metadata is visible before saving');
  assert(completionActions.logged.ok && completionActions.minutes === 20
    && completionActions.value === 8 && completionActions.note === 'after lunch',
    'confirmed completion preserves minutes, tracked value, and note');
  assert(completionActions.undoPreview.ok && /not done/i.test(completionActions.undoPreview.summary)
    && completionActions.undone.ok && completionActions.after === 0,
    'mark-not-done previews and removes today’s latest completion');
  assert(completionActions.empty.ok && completionActions.empty.noChange && /no completion/i.test(completionActions.empty.text),
    'a second correction does not invent a completion');

  console.log('\n[answers] item summary, history, stats, and planner explanation');
  const itemAnswers = await page.evaluate(() => {
    const now = Date.now();
    save([{
      hid:'read-stats', name:'Read', type:'keepup', target:2, durationMinutes:30,
      snoozedUntil:now + 3600000,
      logs:[makeActualLog(now - 3 * 86400000,{minutes:30,note:'chapter one'}), makeActualLog(now,{value:42,note:'chapter two'})],
      lastLog:now
    }]);
    const context = assistantBuildContext(now);
    const found = assistantFindHabit(context.data, 'Read');
    const summary = assistantLookupText(found, context, {query:'summary'});
    const history = assistantLookupText(found, context, {query:'history'});
    const stats = assistantLookupText(found, context, {query:'stats'});
    const why = assistantLookupText(found, context, {query:'why', date:'today'});
    save([]);
    refreshHomeWeekForAssistant();
    return {summary,history,stats,why};
  });
  assert(/Settings:/.test(itemAnswers.summary) && /30 min/.test(itemAnswers.summary),
    `item summary includes real settings: ${itemAnswers.summary}`);
  assert(/2 completions/.test(itemAnswers.history) && /chapter two/.test(itemAnswers.history) && /value 42/.test(itemAnswers.history),
    `history lists recent entry metadata: ${itemAnswers.history}`);
  assert(/2 total entries/.test(itemAnswers.stats) && /last 30 days|on pace/i.test(itemAnswers.stats),
    `stats are computed from saved logs: ${itemAnswers.stats}`);
  assert(/snoozed until/i.test(itemAnswers.why),
    `planner explanation names a concrete blocker: ${itemAnswers.why}`);

  console.log('\n[names] ranked fuzzy match asks instead of guessing');
  const nameMatch = await page.evaluate(async () => {
    const now = Date.now();
    const base = dayStart(now);
    const lastTs = base - 3 * 86400000 + 20 * 3600000;
    const amma = {hid:'call-amma', name:'Call Amma', type:'keepup', target:7, durationMinutes:20, logs:[makeActualLog(lastTs)], lastLog:lastTs};
    const baba = {hid:'call-baba', name:'Call Baba', type:'keepup', target:7, durationMinutes:15, logs:[]};
    const walk = {hid:'evening-walk', name:'Evening walk', type:'habit', target:1, logs:[]};
    save([amma, baba, walk]);
    const days = [];
    for(let k = 0; k < 7; k += 1){
      const dayBase = base + k * 86400000;
      days.push({dayBase, isToday:k === 0, timeline:k === 1 ? [{kind:'fill', i:0, h:amma, start:dayBase + 18 * 3600000, end:dayBase + 18 * 3600000 + 20 * 60000}] : []});
    }
    const savedWeek = _homeRenderedWeek;
    _homeRenderedWeek = {days};
    const ammaHit = assistantFindHabit(load(), 'amma');
    const typoHit = assistantFindHabit(load(), 'call ama');
    const questionHit = assistantFindHabit(load(), 'When am I supposed to call Amma next?');
    const walkHit = assistantFindHabit(load(), 'walk');
    const callAsk = assistantFindHabit(load(), 'call');
    const missing = assistantFindHabit(load(), 'xyzzy');
    const ranked = assistantRankByName(assistantHabitRows(load()), 'amma', 5).map(row => row.name);
    const context = assistantBuildContext();
    const session = assistantCreateSession();
    const local = await assistantExecuteTool('lookup_item', {name:'Call Amma', query:'summary'}, session, context);
    const follow = await assistantExecuteTool('lookup_item', {name:'Call Amma', query:'history'}, session, context);
    const findAsk = await assistantExecuteTool('find_item', {query:'call'}, assistantCreateSession(), context);
    const lookupFrag = await assistantExecuteTool('lookup_item', {name:'amma'}, assistantCreateSession(), context);
    const hijack = await runAssistantTurn('When am I supposed to call Amma next?', {
      complete:async () => ({message:{thinking:'lookup the named item', tool_calls:[{function:{name:'lookup_item', arguments:{name:'Call Amma', query:'summary'}}}]}})
    });
    _homeRenderedWeek = savedWeek;
    save([]);
    refreshHomeWeekForAssistant();
    return {
      ammaHit:{ok:ammaHit.ok, name:ammaHit.name},
      typoHit:{ok:typoHit.ok, name:typoHit.name},
      questionHit:{ok:questionHit.ok, name:questionHit.name},
      walkHit:{ok:walkHit.ok, name:walkHit.name},
      callAsk:{ok:callAsk.ok, ask:callAsk.ask, choices:callAsk.choices},
      missing:{ok:missing.ok, ask:missing.ask, choices:missing.choices},
      ranked,
      local:{type:local && local.type, text:local && local.text, ask:local && local.question},
      follow:{type:follow && follow.type, text:follow && follow.text},
      findAsk:{ok:findAsk.ok, ask:findAsk.ask, choices:findAsk.choices},
      lookupFrag:{ok:lookupFrag.ok, text:lookupFrag.text},
      hijack:{type:hijack.type, text:hijack.text}
    };
  });
  assert(nameMatch.ammaHit.ok && nameMatch.ammaHit.name === 'Call Amma',
    'a distinctive fragment uniquely resolves Call Amma');
  assert(nameMatch.typoHit.ok && nameMatch.typoHit.name === 'Call Amma',
    'a close typo uniquely resolves Call Amma');
  assert(nameMatch.questionHit.ok && nameMatch.questionHit.name === 'Call Amma',
    'the whole question still resolves Call Amma');
  assert(nameMatch.walkHit.ok && nameMatch.walkHit.name === 'Evening walk',
    'a unique token resolves Evening walk');
  assert(!nameMatch.callAsk.ok && nameMatch.callAsk.choices
    && nameMatch.callAsk.choices.includes('Call Amma') && nameMatch.callAsk.choices.includes('Call Baba'),
    `an ambiguous “call” asks instead of guessing: ${nameMatch.callAsk.ask}`);
  assert(!nameMatch.missing.ok && !(nameMatch.missing.choices || []).length,
    'unknown names do not dump unrelated list items as choices');
  assert(nameMatch.ranked[0] === 'Call Amma',
    `ranked search puts Call Amma first: ${nameMatch.ranked.join(', ')}`);
  assert(nameMatch.local && nameMatch.local.text
    && /Next planned: tomorrow at 6pm/i.test(nameMatch.local.text)
    && /Last completed:/.test(nameMatch.local.text),
    `lookup summary answers next and last from app data: ${nameMatch.local && nameMatch.local.text}`);
  assert(nameMatch.follow && nameMatch.follow.text
    && /Call Amma has 1 completion/.test(nameMatch.follow.text),
    `an explicit history query stays on Call Amma: ${nameMatch.follow && nameMatch.follow.text}`);
  assert(!nameMatch.findAsk.ok && nameMatch.findAsk.choices
    && nameMatch.findAsk.choices.includes('Call Amma') && nameMatch.findAsk.choices.includes('Call Baba'),
    'find_item asks the user when several titles fit');
  assert(nameMatch.lookupFrag.ok && /Next planned: tomorrow at 6pm/i.test(nameMatch.lookupFrag.text),
    `lookup_item accepts the fragment “amma”: ${nameMatch.lookupFrag.text}`);
  assert(nameMatch.hijack.type === 'say' && /Next planned:|Last completed:/.test(nameMatch.hijack.text),
    `the model routes an item question to lookup_item: ${nameMatch.hijack.text}`);

  console.log('\n[handlers] item status and settings lists');
  const broadHandlers = await page.evaluate(() => {
    const base = dayStart(Date.now());
    save([
      {hid:'h1', name:'Read', type:'habit', topics:['Learning'], logs:[]},
      {hid:'t1', name:'Old errand', type:'task', dueDate:base - 86400000, logs:[]},
      {hid:'t2', name:'Finished task', type:'task', dueDate:base, logs:[makeActualLog(Date.now())], lastLog:Date.now()}
    ]);
    saveSortSettings({...loadSortSettings(),
      locations:[{id:'home', name:'Home', lat:1, lng:1}],
      weatherProfiles:[{id:'dry', name:'Dry', rules:[]}],
      topics:['Learning'],
      blockedTimes:[{label:'Work', days:[1], start:540, end:1020}]
    });
    const context = assistantBuildContext();
    const habits = assistantAnswerItems({query:'list', kind:'habit'}, context);
    const overdue = assistantAnswerItems({query:'list', kind:'task', status:'overdue'}, context);
    const progress = assistantAnswerItems({query:'progress'}, context);
    const places = assistantAnswerSettings({kind:'places'}, context);
    const weather = assistantAnswerSettings({kind:'weather'}, context);
    const topics = assistantAnswerSettings({kind:'topics'}, context);
    const busy = assistantAnswerSettings({kind:'busy'}, context);
    save([]);
    saveSortSettings({...loadSortSettings(), locations:[], weatherProfiles:[{id:'dry', name:'Dry', rules:[
      {metric:'precipitation_probability', max:40, min:null, hard:true, relative:'none'}
    ]}], topics:[], blockedTimes:[]});
    refreshHomeWeekForAssistant();
    return {habits:habits.text, overdue:overdue.text, progress:progress.text, places:places.text, weather:weather.text, topics:topics.text, busy:busy.text};
  });
  assert(/Read/.test(broadHandlers.habits) && /Old errand/.test(broadHandlers.overdue),
    'item lists filter by kind and overdue status');
  assert(/done today|still open|overdue/i.test(broadHandlers.progress),
    `progress answer summarizes live status: ${broadHandlers.progress}`);
  assert(/Home/.test(broadHandlers.places) && /Dry/.test(broadHandlers.weather)
    && /Learning/.test(broadHandlers.topics) && /Work/.test(broadHandlers.busy),
    'settings questions list places, weather profiles, topics, and busy times');

  console.log('\n[handlers] freest / free / missed / day / week compute from the plan');
  const scheduleHandlers = await page.evaluate(async () => {
    const now = Date.now();
    const base = dayStart(now);
    const dayMs = 86400000;
    const dow = offset => new Date(base + offset * dayMs).getDay();
    saveSortSettings({...loadSortSettings(), blockedTimes:[
      {label:'Block A', days:[dow(1)], start:9 * 60, end:17 * 60},
      {label:'Block B', days:[dow(2)], start:9 * 60, end:17 * 60}
    ]});
    refreshHomeWeekForAssistant();
    const context = assistantBuildContext();
    const freest = await assistantAnswerSchedule({query:'freest'}, context);
    const free = await assistantAnswerSchedule({query:'free', date:'tomorrow'}, context);
    const durationFree = await assistantAnswerSchedule({query:'free', date:'tomorrow', minutes:90}, context);
    const derivedWindow = await assistantAnswerSchedule({query:'free', date:'tomorrow', start:'7pm', minutes:45}, context);
    const dayLabel = ASSISTANT_WEEKDAY_LABELS[new Date(base + 3 * dayMs).getDay()];
    const rows = [{kind:'fill', i:0, h:{hid:'h9', name:'Morning stretch', type:'habit'}, start:now - 3600000, end:now - 1800000}];
    const fakeDays = [];
    for(let k = 0; k < 7; k += 1){
      fakeDays.push({dayBase:base + k * dayMs, isToday:k === 0, timeline:k === 0 ? rows.slice() : []});
    }
    save([{hid:'h9', name:'Morning stretch', type:'habit'}]);
    const savedWeek = _homeRenderedWeek;
    _homeRenderedWeek = {days:fakeDays};
    const day = await assistantAnswerSchedule({query:'day', date:'today'}, assistantBuildContext());
    const week = await assistantAnswerSchedule({query:'week'}, assistantBuildContext());
    _homeRenderedWeek = savedWeek;
    save([]);
    refreshHomeWeekForAssistant();
    saveSortSettings({...loadSortSettings(), blockedTimes:[]});
    refreshHomeWeekForAssistant();
    return {
      freest:freest.text, free:free.text, durationFree:durationFree.text, derivedWindow:derivedWindow.text,
      day:day.text, week:week.text,
      expectedFreest:dayLabel
    };
  });
  assert(scheduleHandlers.freest.toLowerCase().includes(scheduleHandlers.expectedFreest),
    `freest day is the first unconstrained day (${scheduleHandlers.expectedFreest}): ${scheduleHandlers.freest}`);
  assert(/16h/.test(scheduleHandlers.free) && /2 gaps/.test(scheduleHandlers.free),
    `free whole-day totals gaps around the block: ${scheduleHandlers.free}`);
  assert(/contiguous 1h 30m opening/i.test(scheduleHandlers.durationFree),
    `duration-only availability checks a contiguous gap: ${scheduleHandlers.durationFree}`);
  assert(/7pm–7:45pm/.test(scheduleHandlers.derivedWindow) && /open/i.test(scheduleHandlers.derivedWindow),
    `start + duration derives a concrete window: ${scheduleHandlers.derivedWindow}`);
  assert(/Morning stretch/.test(scheduleHandlers.day) && /\d{1,2}:\d{2}(?:am|pm)/i.test(scheduleHandlers.day),
    `day agenda lists rows with clocks: ${scheduleHandlers.day}`);
  assert(/Today/.test(scheduleHandlers.week) && /open/.test(scheduleHandlers.week),
    `week overview summarizes every day: ${scheduleHandlers.week}`);

  console.log('\n[handlers] missed uses the today-header pill list');
  const missedHandlers = await page.evaluate(async () => {
    const now = Date.now();
    const base = dayStart(now);
    const dayMs = 86400000;
    const today = todayIso();
    const meds = {
      hid:'miss-p0', name:'Take meds', type:'keepup', target:1, priority:0,
      durationMinutes:10, createdAt:now - 30 * dayMs, logs:[], lastLog:now - 2 * dayMs
    };
    const laundry = {
      hid:'miss-p5', name:'Sort laundry', type:'keepup', target:7, priority:5,
      durationMinutes:20, createdAt:now - 30 * dayMs, logs:[], lastLog:now - 8 * dayMs
    };
    const overdue = {hid:'t-overdue', name:'Return library book', type:'task', dueDate:base - 2 * dayMs, logs:[]};
    save([meds, laundry, overdue]);
    const fingerprint = missedPlannerFingerprint(load(), loadSortSettings());
    const tomorrow = dateKey(now + 86400000);
    const emptyDays = [];
    for(let k = 0; k < 7; k += 1){
      emptyDays.push({dayBase:base + k * dayMs, isToday:k === 0, timeline:[]});
    }
    const savedWeek = _homeRenderedWeek;
    _homeRenderedWeek = {days:emptyDays};
    saveTodaySuggested({
      day:today,
      hids:{
        'miss-p0':{first:now - 3600000, name:'Take meds'},
        'miss-p5':{first:now - 3600000, name:'Sort laundry'}
      },
      projection:{day:tomorrow, hids:[], fingerprint},
      expectations:{
        [today]:{hids:['miss-p0','miss-p5'], fingerprint, recordedAt:now - 3600000},
        [tomorrow]:{hids:[], fingerprint, recordedAt:now - 3600000}
      }
    });
    const dropped = collectDroppedItems(load(), loadSortSettings(), [], now).map(row => row.name);
    const missed = await assistantAnswerSchedule({query:'missed'}, assistantBuildContext());
    const mostImportant = await assistantAnswerSchedule({query:'missed', select:'most_important'}, assistantBuildContext());
    const mostFrequent = await assistantAnswerSchedule({query:'missed', select:'most_frequent'}, assistantBuildContext());
    const longest = await assistantAnswerSchedule({query:'missed', select:'longest'}, assistantBuildContext());
    const local = assistantTryMissedTurn('What did I miss today?', assistantCreateSession(), assistantBuildContext());
    _homeRenderedWeek = savedWeek;
    save([]);
    localStorage.removeItem('tings_today_suggested_v1');
    refreshHomeWeekForAssistant();
    return {
      dropped,
      text:missed.text,
      mostImportant:mostImportant.text,
      mostFrequent:mostFrequent.text,
      longest:longest.text,
      items:(missed.items || []).map(item => ({name:item.name, priority:item.priority, priorityRank:item.priorityRank, frequency:item.frequency})),
      localType:local && local.type,
      localText:local && local.text,
      localPath:(local && local.session && local.session.debug || []).find(row => row.t === 'path')
    };
  });
  assert(missedHandlers.dropped.includes('Take meds') && missedHandlers.dropped.includes('Sort laundry')
    && !missedHandlers.dropped.includes('Return library book'),
    `header missed list is planner-backed, not a raw overdue sweep: ${missedHandlers.dropped.join(', ')}`);
  assert(/Take meds/.test(missedHandlers.text) && /Sort laundry/.test(missedHandlers.text)
    && !/Return library book/.test(missedHandlers.text),
    `answer_schedule missed matches that pill list: ${missedHandlers.text}`);
  assert(missedHandlers.items.some(item => item.name === 'Take meds' && item.priority === 'P0' && item.priorityRank === 0),
    `missed items include priority facts: ${JSON.stringify(missedHandlers.items)}`);
  assert(/most important.*Take meds.*P0/i.test(missedHandlers.mostImportant),
    `priority ranking is computed by the tool: ${missedHandlers.mostImportant}`);
  assert(/most frequent.*Take meds.*daily/i.test(missedHandlers.mostFrequent),
    `frequency ranking is computed by the tool: ${missedHandlers.mostFrequent}`);
  assert(/longest.*Sort laundry.*20m/i.test(missedHandlers.longest),
    `duration ranking is computed by the tool: ${missedHandlers.longest}`);
  assert(missedHandlers.localType === 'say' && /Take meds/.test(missedHandlers.localText),
    `what did I miss today uses the header list locally: ${missedHandlers.localText}`);

  console.log('\n[handlers] weather day / window / item');
  const weatherHandlers = await page.evaluate(async () => {
    const now = Date.now();
    const base = dayStart(now);
    const context = assistantBuildContext();
    const day = assistantAnswerWeather({query:'day', date:'today'}, context);
    const window = assistantAnswerWeather({query:'window', date:'today', start:'5pm', end:'6pm'}, context);
    const run = {hid:'w1', name:'Run', type:'habit', weatherProfileId:'dry'};
    const rows = [{kind:'fill', i:0, h:run, start:base + 17 * 3600000, end:base + 18 * 3600000}];
    const fakeDays = [];
    for(let k = 0; k < 7; k += 1){
      fakeDays.push({dayBase:base + k * 86400000, isToday:k === 0, timeline:k === 0 ? rows : []});
    }
    save([run]);
    const savedWeek = _homeRenderedWeek;
    _homeRenderedWeek = {days:fakeDays};
    const item = assistantAnswerWeather({query:'item', name:'Run', date:'today'}, assistantBuildContext());
    const missing = assistantAnswerWeather({query:'item', name:'Nonexistent thing', date:'today'}, assistantBuildContext());
    _homeRenderedWeek = savedWeek;
    save([]);
    const bucket = weatherCacheRead();
    weatherCacheWrite({});
    loadSortSettings();
    const dry = assistantAnswerWeather({query:'day', date:'today'}, assistantBuildContext());
    weatherCacheWrite(bucket);
    loadSortSettings();
    return { day:day.text, window:window.text, item:item.text, missing:missing.text, dry:dry.text };
  });
  assert(/Test City/.test(weatherHandlers.day) && /rain chance/.test(weatherHandlers.day),
    `day answer names the city + rain chance: ${weatherHandlers.day}`);
  assert(/90%/.test(weatherHandlers.window) && /5pm/.test(weatherHandlers.window),
    `window answer uses the hourly samples: ${weatherHandlers.window}`);
  assert(/Run is planned today/.test(weatherHandlers.item) && /90%/.test(weatherHandlers.item),
    `item answer assesses the weather rules: ${weatherHandlers.item}`);
  assert(/cannot find|do not see/i.test(weatherHandlers.missing),
    'unknown item asks instead of guessing');
  assert(/forecast/i.test(weatherHandlers.dry) && !/Test City/.test(weatherHandlers.dry),
    'empty cache answers honestly instead of inventing weather');

  console.log('\n[contract] classify enum + unknown query kinds');
  const contract = await page.evaluate(async () => {
    const ok = assistantValidateClassify({intent:'ask_weather'}).ok
      && assistantValidateClassify({intent:'ask_schedule'}).ok
      && assistantValidateClassify({intent:'plan_item'}).ok;
    const weird = await assistantAnswerSchedule({query:'everything'}, assistantBuildContext());
    const weatherWeird = assistantAnswerWeather({query:'everything'}, assistantBuildContext());
    return {ok, vague:weird.text, weatherVague:weatherWeird.text};
  });
  assert(contract.ok, 'classify accepts the query and one-day-plan intents');
  assert(/vague/i.test(contract.vague) && /freest/i.test(contract.vague),
    'an unknown query kind falls back to the capability list');
  assert(/vague/i.test(contract.weatherVague) && /weather/i.test(contract.weatherVague),
    'an unknown weather query kind falls back to the capability list');

  assert(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);

  console.log(`\nassistant-queries-test: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
