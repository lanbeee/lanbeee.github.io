// Assistant read/action tools. The model may call a final tool on its first
// pass; Tings computes answers from live app data and confirms destructive
// actions. Fake LLM by default; direct handler calls are deterministic.
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
  assert(conflictTurn.steps.length === 2 && conflictTurn.steps[0].step === 'classify' && conflictTurn.steps[1].step === 'query',
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
  assert(directTools.calls.length === 2 && directTools.calls.every(row => row.step === 'classify'),
    'answer and delete tools can be selected on the first model pass');
  assert(directTools.calls[0].tools.includes('answer_items') && directTools.calls[1].tools.includes('delete_item'),
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
    && focusedAction.offered.includes('delete_item') && focusedAction.offered.includes('complete_item') && focusedAction.offered.includes('lookup_item'),
    'focused follow-ups can delete, complete, or look up “it” through model tools');

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
    save([{hid:'t1', name:'Return library book', type:'task', dueDate:base - 2 * dayMs}, {hid:'h9', name:'Morning stretch', type:'habit'}]);
    const savedWeek = _homeRenderedWeek;
    _homeRenderedWeek = {days:fakeDays};
    const missed = await assistantAnswerSchedule({query:'missed'}, assistantBuildContext());
    const day = await assistantAnswerSchedule({query:'day', date:'today'}, assistantBuildContext());
    const week = await assistantAnswerSchedule({query:'week'}, assistantBuildContext());
    _homeRenderedWeek = savedWeek;
    save([]);
    refreshHomeWeekForAssistant();
    saveSortSettings({...loadSortSettings(), blockedTimes:[]});
    refreshHomeWeekForAssistant();
    return {
      freest:freest.text, free:free.text, durationFree:durationFree.text, derivedWindow:derivedWindow.text,
      missed:missed.text, day:day.text, week:week.text,
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
  assert(/Return library book/.test(scheduleHandlers.missed) && /Morning stretch/.test(scheduleHandlers.missed),
    `missed reports overdue plus earlier-today open rows: ${scheduleHandlers.missed}`);
  assert(/Morning stretch/.test(scheduleHandlers.day) && /5pm|pm/.test(scheduleHandlers.day),
    `day agenda lists rows with clocks: ${scheduleHandlers.day}`);
  assert(/Today/.test(scheduleHandlers.week) && /open/.test(scheduleHandlers.week),
    `week overview summarizes every day: ${scheduleHandlers.week}`);

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
      && assistantValidateClassify({intent:'ask_schedule'}).ok;
    const weird = await assistantAnswerSchedule({query:'everything'}, assistantBuildContext());
    const weatherWeird = assistantAnswerWeather({query:'everything'}, assistantBuildContext());
    return {ok, vague:weird.text, weatherVague:weatherWeird.text};
  });
  assert(contract.ok, 'classify accepts the two new intents');
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
