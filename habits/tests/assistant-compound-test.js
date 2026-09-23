// Live Qwen compound / follow-up / multi-part questions.
// No scripted complete() mocks — the model must call tools and answer from
// Tings data. Skips when no qwen3.8 is reachable unless ASSISTANT_LIVE is set.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

const DISABLE_LIVE = process.env.ASSISTANT_LIVE === '0';
const REQUIRE_LIVE = Boolean(process.env.ASSISTANT_LIVE) && !DISABLE_LIVE;
const LIVE_FULL = process.env.ASSISTANT_LIVE === 'full';
const LIVE_CASE = String(process.env.ASSISTANT_CASE || '').trim();

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

function toolsOf(got){
  return (got && got.tools) || [];
}
function dump(got){
  return JSON.stringify({
    type:got && got.type,
    text:got && got.text,
    alsoText:got && got.alsoText,
    tools:got && got.tools,
    toolArgs:got && got.toolArgs,
    steps:got && got.steps,
    llmCalls:got && got.llmCalls,
    path:got && got.path,
    error:got && got.error
  });
}

const CORE = [
  {
    id:'missed-today',
    prompt:'What did I miss today?',
    expectType:['say'],
    toolsAny:['answer_schedule'],
    textAll:[/Take meds/i, /Sort laundry/i],
    textNone:[/library book/i]
  },
  {
    id:'most-important-missed',
    prompt:"What's the most important thing that I missed today?",
    expectType:['say'],
    toolsAny:['answer_schedule'],
    textAll:[/Take meds/i],
    textNone:[/library book/i],
    pick:/Take meds/i,
    notPick:/Sort laundry is the most important|the most important.{0,12}Sort laundry/i
  },
  {
    id:'second-most-overdue-missed',
    prompt:"What's the thing that I missed today and is second most overdue?",
    expectType:['say'],
    toolsAny:['answer_schedule'],
    textAll:[/Sort laundry/i, /1 day overdue/i],
    textNone:[/^Missed:/i],
    notPick:/2nd most overdue.{0,30}Take meds/i
  },
  {
    id:'most-frequent-tomorrow',
    prompt:"What's the most frequent habit from tomorrow's agenda?",
    expectType:['say'],
    toolsAny:['answer_schedule'],
    textAll:[/Brush teeth/i],
    notPick:/Deep clean is the most frequent/
  },
  {
    id:'tomorrow-and-amma-last',
    prompt:"What's on tomorrow, and when did I last call Amma?",
    expectType:['say'],
    toolsAll:['answer_schedule','lookup_item'],
    textAll:[/Call Amma/i, /last completed|Last completed|completed|completion|tomorrow|Recent/i],
    textNone:[/library book/i]
  },
  {
    id:'weather-and-agenda',
    prompt:"What's the weather tomorrow and what's on my agenda then?",
    expectType:['say'],
    toolsAll:['answer_weather','answer_schedule'],
    textAll:[/Brush teeth|Deep clean|Call Amma/i, /Test City|rain|forecast|°C|weather/i]
  },
  {
    id:'two-lookups',
    prompt:'When am I supposed to call Amma next, and when is Evening walk?',
    expectType:['say'],
    toolsAny:['lookup_item'],
    textAll:[/(Call Amma|Evening walk)/i]
  },
  {
    id:'habits-and-progress',
    prompt:'What habits do I have, and how am I doing today?',
    expectType:['say'],
    toolsAny:['answer_items'],
    textAll:[/Take meds|Brush teeth|Call Amma|Evening walk|Deep clean|Sort laundry/i]
  },
  {
    id:'complete-and-tomorrow',
    prompt:'Mark Evening walk done, and what is on tomorrow?',
    expectType:['complete','say'],
    toolsAll:['complete_item','answer_schedule'],
    textAll:[/Evening walk/i, /Brush teeth|Deep clean|Call Amma/i]
  }
];

const FOLLOWUPS = [
  {
    id:'missed-then-most-important',
    turns:[
      {
        prompt:'What did I miss today?',
        expectType:['say'],
        toolsAny:['answer_schedule'],
        textAll:[/Take meds/i]
      },
      {
        prompt:"Which of those is the most important?",
        expectType:['say'],
        textAll:[/Take meds/i],
        needRecent:true,
        notPick:/Sort laundry is the most important|the most important.{0,12}Sort laundry/i
      }
    ]
  },
  {
    id:'amma-next-then-last',
    turns:[
      {
        prompt:'When am I supposed to call Amma next?',
        expectType:['say'],
        toolsAny:['lookup_item'],
        textAll:[/Call Amma/i]
      },
      {
        prompt:'When did I do it last?',
        expectType:['say'],
        toolsAny:['lookup_item'],
        textAll:[/Call Amma|last|completion|completed/i],
        needRecent:true
      }
    ]
  },
  {
    id:'important-missed-then-last',
    turns:[
      {
        prompt:"What's the most important thing that I missed today?",
        expectType:['say'],
        toolsAny:['answer_schedule'],
        textAll:[/Take meds/i]
      },
      {
        prompt:'When did I last do that one?',
        expectType:['say'],
        toolsAny:['lookup_item'],
        textAll:[/Take meds|last|completion|completed/i],
        needRecent:true
      }
    ]
  },
  {
    id:'tomorrow-then-most-frequent',
    turns:[
      {
        prompt:"What do I have tomorrow?",
        expectType:['say'],
        toolsAny:['answer_schedule'],
        textAll:[/Brush teeth|Deep clean|Call Amma/i]
      },
      {
        prompt:'Which of those is the most frequent?',
        expectType:['say'],
        textAll:[/Brush teeth/i],
        needRecent:true,
        notPick:/Deep clean is the most frequent/
      }
    ]
  }
];

const EXTRA = [
  {
    id:'places-and-tomorrow',
    prompt:'What places do I have saved, and what is on tomorrow?',
    expectType:['say'],
    toolsAll:['answer_settings','answer_schedule'],
    textAll:[/Home/i, /Brush teeth|Deep clean|Call Amma/i]
  },
  {
    id:'longest-tomorrow',
    prompt:"What's the longest thing on tomorrow's agenda?",
    expectType:['say'],
    toolsAny:['answer_schedule'],
    textAll:[/Deep clean/i],
    notPick:/Brush teeth is the longest|longest.{0,40}Brush teeth/i
  },
  {
    id:'missed-and-weather',
    prompt:'What did I miss today, and should I run given the weather?',
    expectType:['say'],
    toolsAll:['answer_schedule','answer_weather'],
    textAll:[/Take meds|Sort laundry/i, /weather|rain|wind|temperature|°C|run/i]
  },
  {
    id:'plan-and-missed',
    prompt:'Plan Call Amma for tomorrow, and what did I miss today?',
    expectType:['plan','say','complete'],
    toolsAll:['plan_item','answer_schedule'],
    textAll:[/Call Amma/i, /Take meds|Sort laundry/i]
  }
];

function checkTurn(spec, got, label){
  assert(got && !got.error, `${label} ran (${got && got.error || 'ok'})`);
  if(!got || got.error){
    console.error('    ' + dump(got));
    return;
  }
  if(spec.expectType){
    assert(spec.expectType.includes(got.type),
      `${label} type ${got.type} in [${spec.expectType.join(',')}]  ${dump(got)}`);
  }
  if(spec.toolsAny && spec.toolsAny.length){
    const hit = spec.toolsAny.some(name => toolsOf(got).includes(name));
    assert(hit, `${label} called ${spec.toolsAny.join('|')}  tools=${toolsOf(got).join(',')}`);
  }
  if(spec.toolsAll && spec.toolsAll.length){
    const missing = spec.toolsAll.filter(name => !toolsOf(got).includes(name));
    assert(!missing.length, `${label} called ${spec.toolsAll.join('+')}  missing=${missing.join(',')} tools=${toolsOf(got).join(',')}`);
  }
  const blob = `${got.text || ''} ${got.alsoText || ''}`;
  for(const re of spec.textAll || []){
    assert(re.test(blob), `${label} text matches ${re}: ${blob.slice(0, 220)}`);
  }
  for(const re of spec.textNone || []){
    assert(!re.test(blob), `${label} text avoids ${re}: ${blob.slice(0, 220)}`);
  }
  if(spec.pick){
    assert(spec.pick.test(blob), `${label} picks the grounded item: ${blob.slice(0, 220)}`);
  }
  if(spec.notPick){
    assert(!spec.notPick.test(blob), `${label} does not pick the wrong item: ${blob.slice(0, 220)}`);
  }
  if(spec.needRecent){
    assert(got.recent && (got.recent.items || got.recent.referent || got.recent.answer),
      `${label} follow-up envelope has recent  ${JSON.stringify(got.recent)}`);
  }
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

  console.log('\n[probe] local Qwen3.8');
  const probe = DISABLE_LIVE ? {skipped:true, reason:'ASSISTANT_LIVE=0'} : await page.evaluate(async () => {
    try{
      delete globalThis.__assistantTestComplete;
      saveSortSettings({
        ...DEFAULT_SORT_SETTINGS,
        localAssistant:true,
        localAssistantDebug:true,
        localAssistantModelOnly:true
      });
      const found = await assistantListModels(true);
      const names = found.models || [];
      if(!names.some(name => /qwen3\.8/i.test(name))){
        return {skipped:true, reason:'no qwen3.8', names};
      }
      return {
        skipped:false,
        provider:found.provider,
        origin:found.origin,
        model:pickAssistantModel(names, (typeof assistantSettings === 'function' && assistantSettings().model) || 'qwen3.8:27b-mlx')
      };
    }catch(err){
      return {skipped:true, reason:String(err && err.message || err)};
    }
  });

  if(probe.skipped){
    if(REQUIRE_LIVE){
      assert(false, 'ASSISTANT_LIVE set but no model: ' + probe.reason);
    }else{
      console.log('  skip: ' + probe.reason);
    }
    assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
    await browser.close();
    console.log(`\nassistant-compound-test: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
    return;
  }

  console.log('  model: ' + probe.provider + ' ' + probe.model);
  page.setDefaultTimeout(40 * 60 * 1000);

  const wantedAll = LIVE_FULL ? CORE.concat(EXTRA) : CORE;
  const wanted = LIVE_CASE ? wantedAll.filter(spec => spec.id === LIVE_CASE) : wantedAll;
  console.log('\n[live] compound / multi-part via real Ollama (' + wanted.length + ')');

  for(const spec of wanted){
    console.log('\n[live] ' + spec.id);
    const got = await page.evaluate(async ({model, prompt}) => {
      delete globalThis.__assistantTestComplete;
      if(!globalThis.__assistantCompoundFrozen){
        const RealDate = Date;
        const frozen = (typeof dayStart === 'function' ? dayStart(RealDate.now()) : RealDate.now()) + 10 * 3600000;
        function FrozenDate(...args){
          if(!args.length)return new RealDate(frozen);
          return new RealDate(...args);
        }
        FrozenDate.now = () => frozen;
        FrozenDate.parse = RealDate.parse;
        FrozenDate.UTC = RealDate.UTC;
        globalThis.Date = FrozenDate;
        globalThis.__assistantCompoundFrozen = true;
      }
      function seed(){
        try{ _droppedDayBaseline = null; _droppedDayBaselineDay = null; }catch(_){}
        try{ localStorage.removeItem('tings_today_suggested_v1'); }catch(_){}
        const now = Date.now();
        const base = dayStart(now);
        const dayMs = 86400000;
        const today = todayIso();
        const profile = {id:'dry', name:'Dry', rules:[
          {metric:'precipitation_probability', max:40, min:null, hard:true, relative:'none'}
        ]};
        saveSortSettings({
          ...DEFAULT_SORT_SETTINGS,
          localAssistant:true,
          localAssistantDebug:true,
          localAssistantModelOnly:true,
          localAssistantModel:model,
          localAssistantReasoning:'low',
          minimalMode:false,
          homeCityName:'Test City',
          homeCityLat:40.7,
          homeCityLng:-74,
          weatherProfiles:[profile],
          locations:[{id:'home', name:'Home', lat:40.7, lng:-74}],
          blockedTimes:[]
        });
        const meds = {
          hid:'miss-p0', name:'Take meds', type:'keepup', target:1, priority:0,
          durationMinutes:10, createdAt:now - 30 * dayMs,
          logs:[typeof makeActualLog === 'function' ? makeActualLog(now - 2 * dayMs) : now - 2 * dayMs],
          lastLog:now - 2 * dayMs
        };
        const laundry = {
          hid:'miss-p5', name:'Sort laundry', type:'keepup', target:7, priority:5,
          durationMinutes:20, createdAt:now - 30 * dayMs,
          logs:[typeof makeActualLog === 'function' ? makeActualLog(now - 8 * dayMs) : now - 8 * dayMs],
          lastLog:now - 8 * dayMs
        };
        const lastAmma = base - 3 * dayMs + 20 * 3600000;
        const amma = {
          hid:'call-amma', name:'Call Amma', type:'keepup', target:7, priority:1,
          durationMinutes:20, logs:[typeof makeActualLog === 'function' ? makeActualLog(lastAmma) : {t:lastAmma, kind:'actual'}],
          lastLog:lastAmma
        };
        const walk = {hid:'walk', name:'Evening walk', type:'habit', target:1, priority:2, durationMinutes:30, logs:[]};
        const brush = {hid:'brush', name:'Brush teeth', type:'keepup', target:1, priority:3, durationMinutes:5, logs:[]};
        const deep = {hid:'deep', name:'Deep clean', type:'keepup', target:7, priority:0, durationMinutes:45, logs:[]};
        const overdue = {hid:'t-overdue', name:'Return library book', type:'task', dueDate:base - 2 * dayMs, logs:[]};
        const run = {hid:'w1', name:'Run', type:'habit', weatherProfileId:'dry', durationMinutes:30, logs:[]};
        save([meds, laundry, amma, walk, brush, deep, overdue, run]);
        const days = [];
        for(let k = 0; k < 7; k += 1){
          const dayBase = base + k * dayMs;
          let timeline = [];
          if(k === 0){
            timeline = [
              {kind:'fill', i:3, h:walk, start:dayBase + 18 * 3600000, end:dayBase + 18 * 3600000 + 30 * 60000}
            ];
          }
          if(k === 1){
            timeline = [
              {kind:'fill', i:4, h:brush, start:dayBase + 8 * 3600000, end:dayBase + 8 * 3600000 + 5 * 60000},
              {kind:'fill', i:5, h:deep, start:dayBase + 10 * 3600000, end:dayBase + 10 * 3600000 + 45 * 60000},
              {kind:'fill', i:2, h:amma, start:dayBase + 18 * 3600000, end:dayBase + 18 * 3600000 + 20 * 60000}
            ];
          }
          days.push({dayBase, isToday:k === 0, timeline});
        }
        _homeRenderedWeek = {days};
        const fingerprint = typeof missedPlannerFingerprint === 'function'
          ? missedPlannerFingerprint(load(), loadSortSettings())
          : 'test-missed';
        const tomorrow = dateKey(now + dayMs);
        saveTodaySuggested({
          day:today,
          hids:{
            'miss-p0':{first:now - 3600000, name:'Take meds'},
            'miss-p5':{first:now - 3600000, name:'Sort laundry'}
          },
          projection:{day:tomorrow, hids:['brush','deep','call-amma'], fingerprint},
          expectations:{
            [today]:{hids:['miss-p0','miss-p5'], fingerprint, recordedAt:now - 3600000},
            [tomorrow]:{hids:['brush','deep','call-amma'], fingerprint, recordedAt:now - 3600000}
          }
        });
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
        weatherCacheWrite({ weekly:{
          lat:40.7, lng:-74, fetchedAt:now - 600000, timezone:tz, samples,
          days:[0,1,2,3,4,5,6].map(offset => mkDay(offset, 2, 18, 28, 10))
        } });
        loadSortSettings();
        _homeRenderedWeek = {days};
        return assistantBuildContext();
      }
      function summarize(out){
        const debug = (out && out.debug) || [];
        const tools = debug.filter(row => row.t === 'tool').map(row => row.name);
        const toolArgs = debug.filter(row => row.t === 'tool').map(row => ({name:row.name, args:row.args}));
        const steps = debug.filter(row => row.t === 'step').map(row => row.step);
        const path = debug.find(row => row.t === 'path') || {};
        let recent = null;
        const msgs = (out.session && out.session.messages) || [];
        for(const msg of msgs){
          if(!msg || msg.role !== 'user')continue;
          try{
            const parsed = JSON.parse(msg.content);
            if(parsed && parsed.recent)recent = parsed.recent;
            if(parsed && parsed.request)break;
          }catch(_){}
        }
        if(!recent && out.session && out.session.recent)recent = out.session.recent;
        return {
          type:out.type,
          text:out.text || out.summary || out.question || '',
          alsoText:out.alsoText || '',
          pendingName:(out.pendingComplete && out.pendingComplete.name)
            || (out.pendingPlan && out.pendingPlan.name)
            || (out.pendingDelete && out.pendingDelete.name)
            || null,
          tools,
          toolArgs,
          steps,
          llmCalls:out.session && out.session.llmCalls,
          path:path.path,
          via:path.via,
          recent,
          focus:out.session && out.session.draft && out.session.draft.name
        };
      }
      try{
        const context = seed();
        const session = assistantCreateSession();
        const out = await runAssistantTurn(prompt, {forceLlm:true, session, context});
        return summarize(out);
      }catch(err){
        return {error:String(err && err.message || err)};
      }
    }, {model:probe.model, prompt:spec.prompt});
    checkTurn(spec, got, spec.id);
    if(got && !got.error){
      console.log('    ' + (got.type || '?') + '  tools=' + toolsOf(got).join(',') + '  ' + String(got.text || '').slice(0, 160));
    }
  }

  const followups = LIVE_CASE ? FOLLOWUPS.filter(spec => spec.id === LIVE_CASE) : FOLLOWUPS;
  console.log('\n[live] follow-up turns via real Ollama (' + followups.length + ')');
  for(const spec of followups){
    console.log('\n[live] ' + spec.id);
    const turns = await page.evaluate(async ({model, prompts}) => {
      delete globalThis.__assistantTestComplete;
      if(!globalThis.__assistantCompoundFrozen){
        const RealDate = Date;
        const frozen = (typeof dayStart === 'function' ? dayStart(RealDate.now()) : RealDate.now()) + 10 * 3600000;
        function FrozenDate(...args){
          if(!args.length)return new RealDate(frozen);
          return new RealDate(...args);
        }
        FrozenDate.now = () => frozen;
        FrozenDate.parse = RealDate.parse;
        FrozenDate.UTC = RealDate.UTC;
        globalThis.Date = FrozenDate;
        globalThis.__assistantCompoundFrozen = true;
      }
      function seed(){
        try{ _droppedDayBaseline = null; _droppedDayBaselineDay = null; }catch(_){}
        try{ localStorage.removeItem('tings_today_suggested_v1'); }catch(_){}
        const now = Date.now();
        const base = dayStart(now);
        const dayMs = 86400000;
        const today = todayIso();
        const profile = {id:'dry', name:'Dry', rules:[
          {metric:'precipitation_probability', max:40, min:null, hard:true, relative:'none'}
        ]};
        saveSortSettings({
          ...DEFAULT_SORT_SETTINGS,
          localAssistant:true,
          localAssistantDebug:true,
          localAssistantModelOnly:true,
          localAssistantModel:model,
          localAssistantReasoning:'low',
          minimalMode:false,
          homeCityName:'Test City',
          homeCityLat:40.7,
          homeCityLng:-74,
          weatherProfiles:[profile],
          locations:[{id:'home', name:'Home', lat:40.7, lng:-74}],
          blockedTimes:[]
        });
        const meds = {
          hid:'miss-p0', name:'Take meds', type:'keepup', target:1, priority:0,
          durationMinutes:10, createdAt:now - 30 * dayMs, logs:[typeof makeActualLog === 'function' ? makeActualLog(now - 2 * dayMs) : {t:now - 2 * dayMs}],
          lastLog:now - 2 * dayMs
        };
        const laundry = {
          hid:'miss-p5', name:'Sort laundry', type:'keepup', target:7, priority:5,
          durationMinutes:20, createdAt:now - 30 * dayMs,
          logs:[typeof makeActualLog === 'function' ? makeActualLog(now - 8 * dayMs) : {t:now - 8 * dayMs}],
          lastLog:now - 8 * dayMs
        };
        const lastAmma = base - 3 * dayMs + 20 * 3600000;
        const amma = {
          hid:'call-amma', name:'Call Amma', type:'keepup', target:7, priority:1,
          durationMinutes:20, logs:[typeof makeActualLog === 'function' ? makeActualLog(lastAmma) : {t:lastAmma, kind:'actual'}],
          lastLog:lastAmma
        };
        const walk = {hid:'walk', name:'Evening walk', type:'habit', target:1, priority:2, durationMinutes:30, logs:[]};
        const brush = {hid:'brush', name:'Brush teeth', type:'keepup', target:1, priority:3, durationMinutes:5, logs:[]};
        const deep = {hid:'deep', name:'Deep clean', type:'keepup', target:7, priority:0, durationMinutes:45, logs:[]};
        save([meds, laundry, amma, walk, brush, deep]);
        const days = [];
        for(let k = 0; k < 7; k += 1){
          const dayBase = base + k * dayMs;
          let timeline = [];
          if(k === 0){
            timeline = [{kind:'fill', i:3, h:walk, start:dayBase + 18 * 3600000, end:dayBase + 18 * 3600000 + 30 * 60000}];
          }
          if(k === 1){
            timeline = [
              {kind:'fill', i:4, h:brush, start:dayBase + 8 * 3600000, end:dayBase + 8 * 3600000 + 5 * 60000},
              {kind:'fill', i:5, h:deep, start:dayBase + 10 * 3600000, end:dayBase + 10 * 3600000 + 45 * 60000},
              {kind:'fill', i:2, h:amma, start:dayBase + 18 * 3600000, end:dayBase + 18 * 3600000 + 20 * 60000}
            ];
          }
          days.push({dayBase, isToday:k === 0, timeline});
        }
        _homeRenderedWeek = {days};
        const fingerprint = typeof missedPlannerFingerprint === 'function'
          ? missedPlannerFingerprint(load(), loadSortSettings())
          : 'test-missed';
        const tomorrow = dateKey(now + dayMs);
        saveTodaySuggested({
          day:today,
          hids:{
            'miss-p0':{first:now - 3600000, name:'Take meds'},
            'miss-p5':{first:now - 3600000, name:'Sort laundry'}
          },
          projection:{day:tomorrow, hids:['brush','deep','call-amma'], fingerprint},
          expectations:{
            [today]:{hids:['miss-p0','miss-p5'], fingerprint, recordedAt:now - 3600000},
            [tomorrow]:{hids:['brush','deep','call-amma'], fingerprint, recordedAt:now - 3600000}
          }
        });
        _homeRenderedWeek = {days};
        return assistantBuildContext();
      }
      function summarize(out){
        const debug = (out && out.debug) || [];
        const tools = debug.filter(row => row.t === 'tool').map(row => row.name);
        const toolArgs = debug.filter(row => row.t === 'tool').map(row => ({name:row.name, args:row.args}));
        const steps = debug.filter(row => row.t === 'step').map(row => row.step);
        let recent = null;
        const msgs = (out.session && out.session.messages) || [];
        for(const msg of msgs){
          if(!msg || msg.role !== 'user')continue;
          try{
            const parsed = JSON.parse(msg.content);
            if(parsed && parsed.recent){ recent = parsed.recent; break; }
          }catch(_){}
        }
        if(!recent && out.session && out.session.recent)recent = {
          request:out.session.recent.request,
          answer:out.session.recent.say,
          items:out.session.recent.items,
          referent:out.session.recent.referent
        };
        return {
          type:out.type,
          text:out.text || out.summary || out.question || '',
          alsoText:out.alsoText || '',
          tools,
          toolArgs,
          steps,
          llmCalls:out.session && out.session.llmCalls,
          recent,
          focus:out.session && out.session.draft && out.session.draft.name
        };
      }
      try{
        const context = seed();
        const session = assistantCreateSession();
        const results = [];
        for(const prompt of prompts){
          const out = await runAssistantTurn(prompt, {forceLlm:true, session, context:assistantBuildContext()});
          results.push(summarize(out));
        }
        return results;
      }catch(err){
        return [{error:String(err && err.message || err)}];
      }
    }, {model:probe.model, prompts:spec.turns.map(row => row.prompt)});
    spec.turns.forEach((turn, i) => {
      const got = turns[i] || {error:'missing turn'};
      checkTurn(turn, got, spec.id + '#' + (i + 1));
      if(got && !got.error){
        console.log('    #' + (i + 1) + ' ' + (got.type || '?') + '  tools=' + toolsOf(got).join(',') + '  ' + String(got.text || '').slice(0, 160));
      }
    });
  }

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\nassistant-compound-test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
