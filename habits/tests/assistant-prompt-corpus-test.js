// Vigorous local-assistant corpus: utterance parse, local turns on the
// regular (non-clone) app, complete/lookup, and optional live Qwen.
const { chromium, BASE } = require('./helpers/planner-test-helpers');
const {
  ASSISTANT_FROZEN_NOW,
  ASSISTANT_PARSE_CASES,
  ASSISTANT_LIVE_CORE,
  ASSISTANT_LIVE_EXTRA
} = require('./helpers/assistant-prompt-corpus');

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

function expectedDueKey(token){
  const base = new Date(ASSISTANT_FROZEN_NOW);
  base.setHours(0, 0, 0, 0);
  const key = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  if(token === 'today')return key(base);
  if(token === 'tomorrow'){
    const d = new Date(base); d.setDate(d.getDate() + 1); return key(d);
  }
  if(token === 'friday'){
    const d = new Date(base); d.setDate(d.getDate() + 1); return key(d);
  }
  if(token === 'nextMonday'){
    const d = new Date(base); d.setDate(d.getDate() + 4); return key(d);
  }
  if(token === 'nextWeek'){
    const d = new Date(base); d.setDate(d.getDate() + 7); return key(d);
  }
  return token;
}

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport:{ width:1280, height:800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE, { waitUntil:'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(400);

  console.log('\n[owner] assistant is on the regular app, not clone-gated');
  const owner = await page.evaluate(() => {
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      locations:[{id:'home-1', name:'Home'}, {id:'gym-1', name:'Gym'}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    const replica = typeof replicaDisplayRequested === 'function' && replicaDisplayRequested();
    return {
      replica,
      hidden:document.getElementById('open-assistant')?.hidden,
      barHidden:document.getElementById('bar-open-assistant')?.hidden,
      settingsOn:document.getElementById('setting-local-assistant')?.getAttribute('aria-pressed'),
      hint:(document.querySelector('#settings-assistant-body small') || {}).textContent || '',
      bodyClass:document.body.classList.contains('assistant-on'),
      displayMode:document.body.classList.contains('replica-display-mode')
    };
  });
  assert(!owner.replica && !owner.displayMode, 'no replica enrollment on a fresh local app');
  assert(owner.hidden === false && owner.bodyClass, 'chat button shows on the regular app');
  assert(/regular Tings app|not only a personal clone/i.test(owner.hint), 'settings copy says regular app, not clone-only');

  console.log('\n[parse] utterance corpus (' + ASSISTANT_PARSE_CASES.length + ')');
  const parsedRows = await page.evaluate(({cases, now}) => {
    const catalog = assistantCatalog([], {
      locations:[{id:'home-1', name:'Home'}, {id:'gym-1', name:'Gym'}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    }, now);
    return cases.map(row => {
      const parsed = assistantParseUtterance(row.prompt, catalog, now);
      return {
        id:row.id,
        intent:parsed.intent,
        confident:parsed.confident,
        name:parsed.itemName,
        durationMinutes:parsed.durationMinutes,
        due:parsed.due,
        dueTime:parsed.dueTime,
        windowStart:parsed.window && parsed.window.start,
        windowEnd:parsed.window && parsed.window.end,
        places:parsed.places,
        weather:parsed.weather,
        weatherHints:parsed.weatherHints,
        rhythm:parsed.rhythm,
        weekdays:parsed.rhythm && parsed.rhythm.weekdays,
        priority:parsed.priority,
        windowStartOffset:parsed.window && parsed.window.start && parsed.window.start.offsetMin,
        windowEndOffset:parsed.window && parsed.window.end && parsed.window.end.offsetMin,
        newName:parsed.newName
      };
    });
  }, {cases:ASSISTANT_PARSE_CASES, now:ASSISTANT_FROZEN_NOW});

  for(const spec of ASSISTANT_PARSE_CASES){
    const got = parsedRows.find(row => row.id === spec.id);
    if(!got){
      assert(false, spec.id + ' missing parse result');
      continue;
    }
    assert(got.intent === spec.intent, spec.id + ' intent=' + got.intent);
    if(spec.name){
      const name = String(got.name || '').toLowerCase();
      assert(name.includes(String(spec.name).toLowerCase()) || String(spec.name).toLowerCase().includes(name),
        spec.id + ' name~' + spec.name + ' got=' + got.name);
    }
    if(spec.noName){
      assert(!got.name, spec.id + ' name should be empty got=' + got.name);
    }
    if(spec.durationMinutes != null){
      assert(got.durationMinutes === spec.durationMinutes, spec.id + ' duration=' + got.durationMinutes);
    }
    if(spec.due){
      assert(got.due === expectedDueKey(spec.due), spec.id + ' due=' + got.due);
    }
    if(spec.dueTime){
      assert(got.dueTime === spec.dueTime, spec.id + ' dueTime=' + got.dueTime);
    }
    if(spec.windowStart){
      assert(got.windowStart && got.windowStart.anchor === spec.windowStart, spec.id + ' windowStart=' + (got.windowStart && got.windowStart.anchor));
    }
    if(spec.windowEnd){
      assert(got.windowEnd && got.windowEnd.anchor === spec.windowEnd, spec.id + ' windowEnd=' + (got.windowEnd && got.windowEnd.anchor));
    }
    if(spec.windowStartClock != null){
      assert(got.windowStart && got.windowStart.minutes === spec.windowStartClock, spec.id + ' windowStartClock=' + (got.windowStart && got.windowStart.minutes));
    }
    if(spec.windowEndClock != null){
      assert(got.windowEnd && got.windowEnd.minutes === spec.windowEndClock, spec.id + ' windowEndClock=' + (got.windowEnd && got.windowEnd.minutes));
    }
    if(spec.windowStartOffset != null){
      assert(got.windowStart && got.windowStart.offsetMin === spec.windowStartOffset, spec.id + ' windowStartOffset=' + (got.windowStart && got.windowStart.offsetMin));
    }
    if(spec.windowEndOffset != null){
      assert((got.windowEnd && got.windowEnd.offsetMin || 0) === spec.windowEndOffset, spec.id + ' windowEndOffset=' + (got.windowEnd && got.windowEnd.offsetMin));
    }
    if(spec.newName){
      assert(String(got.newName || '').toLowerCase() === String(spec.newName).toLowerCase(), spec.id + ' newName=' + got.newName);
    }
    if(spec.places){
      assert(JSON.stringify(got.places) === JSON.stringify(spec.places), spec.id + ' places=' + JSON.stringify(got.places));
    }
    if(spec.weather){
      assert(got.weather === spec.weather, spec.id + ' weather=' + got.weather);
    }
    if(spec.weatherHints){
      assert(got.weatherHints && got.weatherHints.notRaining === Boolean(spec.weatherHints.notRaining), spec.id + ' notRaining=' + (got.weatherHints && got.weatherHints.notRaining));
      assert(got.weatherHints && got.weatherHints.notFreezing === Boolean(spec.weatherHints.notFreezing), spec.id + ' notFreezing=' + (got.weatherHints && got.weatherHints.notFreezing));
    }
    if(spec.timesPerPeriod != null){
      assert(got.rhythm && got.rhythm.timesPerPeriod === spec.timesPerPeriod && got.rhythm.periodDays === spec.periodDays,
        spec.id + ' rhythm=' + JSON.stringify(got.rhythm));
    }
    if(spec.weekdays){
      assert(JSON.stringify(got.weekdays || []) === JSON.stringify(spec.weekdays), spec.id + ' weekdays=' + JSON.stringify(got.weekdays));
    }
    if(spec.noDue){
      assert(!got.due, spec.id + ' due should be empty got=' + got.due);
    }
    if(spec.priority != null){
      assert(got.priority === spec.priority, spec.id + ' priority=' + got.priority);
    }
  }

  console.log('\n[local] create / today / complete / lookup without LLM');
  const local = await page.evaluate(async ({now}) => {
    localStorage.removeItem(KEY);
    const settings = {
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      defaultDurationMinutes:30,
      locations:[{id:'home-1', name:'Home'}, {id:'gym-1', name:'Gym'}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    };
    saveSortSettings(settings);
    const walk = (typeof normalize === 'function' ? normalize : (x=>x))([{
      name:'Walk', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null
    }, {
      name:'Pharmacy', type:'task', dueDate:now, durationMinutes:20, logs:[], lastLog:null
    }]);
    save(walk);
    const context = assistantBuildContext(now);
    const llm = async () => { throw new Error('LLM should not run for clear phrasing'); };
    const create = await runAssistantTurn('remind me to call mom tomorrow', {context, complete:llm});
    const habit = await runAssistantTurn('I should walk every day after sunset', {context, complete:llm});
    const today = await runAssistantTurn("what's next", {context, complete:llm});
    const lookup = await runAssistantTurn('when is Pharmacy', {context, complete:llm});
    const complete = await runAssistantTurn('I already did Walk', {context, complete:llm});
    const outdoor = await runAssistantTurn("Add an outside exercise to be done three times a week and only if it's not raining, and if it's not freezing.", {context, complete:llm});
    const outdoorSaved = outdoor.type === 'preview' ? assistantCommitDraft(outdoor.draft) : {ok:false};
    const outdoorHabit = outdoorSaved.ok ? load().find(h => /outside exercise/i.test(h.name)) : null;
    const outdoorProfile = (loadSortSettings().weatherProfiles || []).find(profile => profile.id === (outdoorHabit && outdoorHabit.weatherProfileId));
    const commit = complete.type === 'complete' ? assistantCommitComplete(complete.pendingComplete) : {ok:false};
    const after = load();
    const walkRow = after.find(h => h.name === 'Walk');
    const savedCreate = create.type === 'preview' ? assistantCommitDraft(create.draft) : {ok:false};
    return {
      createType:create.type,
      createName:create.draft && create.draft.name,
      createDue:create.draft && create.draft.dueDate,
      habitType:habit.type,
      habitKind:habit.draft && habit.draft.kind,
      habitWindow:habit.draft && habit.draft.window && habit.draft.window.start && habit.draft.window.start.anchor,
      todayType:today.type,
      todayText:today.text,
      lookupType:lookup.type,
      lookupText:lookup.text,
      completeType:complete.type,
      completeName:complete.pendingComplete && complete.pendingComplete.name,
      commitOk:commit.ok,
      walkLogged:Boolean(walkRow && walkRow.lastLog),
      savedCreateOk:savedCreate.ok,
      savedName:savedCreate.ok && load().some(h => /call mom/i.test(h.name)),
      outdoorType:outdoor.type,
      outdoorKind:outdoor.draft && outdoor.draft.kind,
      outdoorName:outdoor.draft && outdoor.draft.name,
      outdoorTimes:outdoor.draft && outdoor.draft.timesPerPeriod,
      outdoorDays:outdoor.draft && outdoor.draft.periodDays,
      outdoorWeather:outdoor.draft && outdoor.draft.weather && outdoor.draft.weather.name,
      outdoorSummary:outdoor.summary,
      outdoorSavedOk:outdoorSaved.ok,
      outdoorTarget:outdoorHabit && outdoorHabit.target,
      outdoorWeatherId:outdoorHabit && outdoorHabit.weatherProfileId,
      outdoorRainMax:outdoorProfile && (outdoorProfile.rules || []).some(rule => rule.metric === 'precipitation_probability' && rule.max === 20 && rule.hard),
      outdoorTempMin:outdoorProfile && (outdoorProfile.rules || []).some(rule => rule.metric === 'temperature_2m' && rule.min === 1 && rule.hard)
    };
  }, {now:ASSISTANT_FROZEN_NOW});
  assert(local.createType === 'preview' && /mom/i.test(local.createName || ''), 'local create preview for remind me');
  assert(local.habitType === 'preview' && local.habitKind === 'habit' && local.habitWindow === 'maghrib', 'daily walk after sunset is a habit with maghrib');
  assert(local.todayType === 'today', 'what is next uses today intent locally');
  assert(/^(Next:|Nothing is on today)/i.test(String(local.todayText || '').trim()), 'what is next answers in one short line');
  assert(/Pharmacy/i.test(local.lookupText || ''), 'lookup names the pharmacy');
  assert(local.completeType === 'complete' && /Walk/i.test(local.completeName || ''), 'I already did Walk previews a log');
  assert(local.commitOk && local.walkLogged, 'confirming complete actually logs Walk');
  assert(local.savedCreateOk && local.savedName, 'confirming create saves call mom');
  assert(local.outdoorType === 'preview' && local.outdoorKind === 'habit' && /outside exercise/i.test(local.outdoorName || ''), 'outside exercise is a local habit preview');
  assert(local.outdoorTimes === 3 && local.outdoorDays === 7, 'outside exercise is 3× / week');
  assert(/Outdoor/i.test(local.outdoorWeather || '') && /3× \/ week/.test(local.outdoorSummary || ''), 'preview names Outdoor weather and 3× / week');
  assert(local.outdoorSavedOk && local.outdoorRainMax && local.outdoorTempMin && local.outdoorWeatherId, 'save creates a skip-rain-and-freeze weather profile');

  console.log('\n[focus] follow-ups on "it" update the same item after save');
  const focus = await page.evaluate(async ({now}) => {
    localStorage.removeItem(KEY);
    saveSortSettings({
      ...DEFAULT_SORT_SETTINGS,
      localAssistant:true,
      defaultDurationMinutes:30,
      locations:[{id:'home-1', name:'Home'}, {id:'gym-1', name:'Gym'}],
      weatherProfiles:[{id:'dry-1', name:'Dry'}]
    });
    save((typeof normalize === 'function' ? normalize : (x=>x))([{
      name:'Walk', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null
    }]));
    const llm = async () => { throw new Error('LLM should not run for focused follow-ups'); };
    const context = assistantBuildContext(now);
    const session = assistantCreateSession();
    const created = await runAssistantTurn("Add an outside exercise to be done three times a week and only if it's not raining, and if it's not freezing.", {context, complete:llm, session});
    const windowed = await runAssistantTurn('Change it to be allowed between 2 hours before sunset and till sunset', {context, complete:llm, session});
    const saved = windowed.type === 'preview' ? assistantCommitDraft(windowed.draft) : {ok:false};
    session.draft = saved.habit && typeof assistantHabitToDraft === 'function'
      ? assistantHabitToDraft(saved.habit, saved.index, loadSortSettings())
      : session.draft;
    const laterContext = assistantBuildContext(now);
    const longer = await runAssistantTurn('make it 45 minutes', {context:laterContext, complete:llm, session});
    const savedAgain = longer.type === 'preview' ? assistantCommitDraft(longer.draft) : {ok:false};
    const named = await runAssistantTurn('change Walk to 20 minutes', {context:assistantBuildContext(now), complete:llm, session:assistantCreateSession()});
    const namedSaved = named.type === 'preview' ? assistantCommitDraft(named.draft) : {ok:false};
    const five = await runAssistantTurn('Can you change the outside exercise to five times a week', {context:assistantBuildContext(now), complete:llm, session});
    const fiveSnap = {type:five.type, times:five.draft && five.draft.timesPerPeriod, days:five.draft && five.draft.periodDays, question:five.question || five.text || ''};
    const fiveSaved = five.type === 'preview' ? assistantCommitDraft(five.draft) : {ok:false};
    const itFive = await runAssistantTurn('Change it to five times a week', {context:assistantBuildContext(now), complete:llm, session});
    const itFiveSnap = {type:itFive.type, times:itFive.draft && itFive.draft.timesPerPeriod, question:itFive.question || itFive.text || ''};
    const tuesday = await runAssistantTurn('Can you change the outside exercise to every Tuesday', {context:assistantBuildContext(now), complete:llm, session});
    const tueSnap = {
      type:tuesday.type,
      days:tuesday.draft && (tuesday.draft.allowedWeekdays || []).slice(),
      times:tuesday.draft && tuesday.draft.timesPerPeriod,
      summary:tuesday.summary,
      question:tuesday.question || tuesday.text || ''
    };
    const tueSaved = tuesday.type === 'preview' ? assistantCommitDraft(tuesday.draft) : {ok:false};
    const tueWedFri = await runAssistantTurn('Change it to every Tuesday, Wednesday and Friday', {context:assistantBuildContext(now), complete:llm, session});
    const listSnap = {
      type:tueWedFri.type,
      days:tueWedFri.draft && (tueWedFri.draft.allowedWeekdays || []).slice(),
      times:tueWedFri.draft && tueWedFri.draft.timesPerPeriod,
      summary:tueWedFri.summary
    };
    const listSaved = tueWedFri.type === 'preview' ? assistantCommitDraft(tueWedFri.draft) : {ok:false};
    const data = load();
    const outdoor = data.find(h => /outside exercise/i.test(h.name));
    const walk = data.find(h => h.name === 'Walk');
    return {
      createdType:created.type,
      windowType:windowed.type,
      windowStart:windowed.draft && windowed.draft.window && windowed.draft.window.start,
      windowEnd:windowed.draft && windowed.draft.window && windowed.draft.window.end,
      savedOk:saved.ok,
      hid:saved.habit && saved.habit.hid,
      longerType:longer.type,
      longerMins:longer.draft && longer.draft.durationMinutes,
      longerHid:longer.draft && longer.draft.hid,
      savedAgainOk:savedAgain.ok,
      updated:savedAgain.updated,
      outdoorCount:data.filter(h => /outside exercise/i.test(h.name)).length,
      outdoorMins:outdoor && outdoor.durationMinutes,
      outdoorStart:outdoor && outdoor.allowedTimeStartAnchor,
      outdoorStartOff:outdoor && outdoor.allowedTimeStartOffsetMin,
      outdoorEnd:outdoor && outdoor.allowedTimeEndAnchor,
      namedType:named.type,
      namedName:named.draft && named.draft.name,
      namedMins:named.draft && named.draft.durationMinutes,
      namedHid:named.draft && named.draft.hid,
      namedUpdated:namedSaved.updated,
      walkMins:walk && walk.durationMinutes,
      walkCount:data.filter(h => h.name === 'Walk').length,
      fiveType:fiveSnap.type,
      fiveTimes:fiveSnap.times,
      fiveDays:fiveSnap.days,
      fiveQuestion:fiveSnap.question,
      fiveSavedOk:fiveSaved.ok,
      fiveUpdated:fiveSaved.updated,
      itFiveType:itFiveSnap.type,
      itFiveTimes:itFiveSnap.times,
      itFiveQuestion:itFiveSnap.question,
      tueType:tueSnap.type,
      tueDays:tueSnap.days,
      tueTimes:tueSnap.times,
      tueSummary:tueSnap.summary,
      tueQuestion:tueSnap.question,
      tueSavedOk:tueSaved.ok,
      tueSavedDays:tueSaved.habit && tueSaved.habit.allowedWeekdays,
      listType:listSnap.type,
      listDays:listSnap.days,
      listTimes:listSnap.times,
      listSummary:listSnap.summary,
      listSavedDays:listSaved.habit && listSaved.habit.allowedWeekdays
    };
  }, {now:ASSISTANT_FROZEN_NOW});
  assert(focus.createdType === 'preview' && focus.windowType === 'preview', 'create then "change it" stays local');
  assert(focus.windowStart && focus.windowStart.anchor === 'maghrib' && focus.windowStart.offsetMin === -120, 'follow-up window starts 2h before maghrib');
  assert(focus.windowEnd && focus.windowEnd.anchor === 'maghrib', 'follow-up window ends at sunset');
  assert(focus.savedOk && focus.longerType === 'preview' && focus.longerMins === 45 && focus.longerHid === focus.hid, 'after save, "make it 45 minutes" still means that habit');
  assert(focus.savedAgainOk && focus.updated && focus.outdoorCount === 1 && focus.outdoorMins === 45, 'second save updates in place, no duplicate');
  assert(focus.outdoorStart === 'maghrib' && focus.outdoorStartOff === -120 && focus.outdoorEnd === 'maghrib', 'saved habit keeps the sunset window');
  assert(focus.namedType === 'preview' && /walk/i.test(focus.namedName || '') && focus.namedMins === 20, 'change Walk to 20 minutes finds Walk without a focused bar');
  assert(focus.namedUpdated && focus.walkCount === 1 && focus.walkMins === 20, 'named edit updates Walk in place');
  assert(focus.fiveType === 'preview' && focus.fiveTimes === 5 && focus.fiveDays === 7, 'change outside exercise to five times a week patches rhythm');
  assert(!/do not see that on your list|What should I change/i.test(focus.fiveQuestion), 'named frequency edit does not ask which item');
  assert(focus.fiveSavedOk && focus.fiveUpdated, 'five-times save updates the same habit');
  assert(focus.itFiveType === 'preview' && focus.itFiveTimes === 5, '"change it to five times a week" patches the focused habit');
  assert(!/do not see that on your list/i.test(focus.itFiveQuestion), '"change it" is not treated as a missing item name');
  assert(focus.tueType === 'preview' && JSON.stringify(focus.tueDays) === JSON.stringify([2]) && focus.tueTimes === 1, 'change to every Tuesday pins Tuesday');
  assert(/every tue/i.test(focus.tueSummary || ''), 'preview says every tue, not the old 3× / week');
  assert(!/What should I change|do not see that on your list/i.test(focus.tueQuestion), 'Tuesday edit does not ask which item');
  assert(focus.tueSavedOk && JSON.stringify(focus.tueSavedDays) === JSON.stringify([2]), 'save writes allowedWeekdays Tuesday');
  assert(focus.listType === 'preview' && JSON.stringify(focus.listDays) === JSON.stringify([2,3,5]) && focus.listTimes === 3, 'Tuesday, Wednesday and Friday becomes those three days');
  assert(/tue.*wed.*fri/i.test(focus.listSummary || ''), 'preview lists tue, wed and fri');
  assert(JSON.stringify(focus.listSavedDays) === JSON.stringify([2,3,5]), 'save writes Tue/Wed/Fri');

  console.log('\n[flows] scripted LLM repair still works when forced');
  const forced = await page.evaluate(async () => {
    const replies = [
      { message:{ role:'assistant', content:'A walk sounds nice.', thinking:'hmm' } },
      { message:{ role:'assistant', thinking:'classify now', tool_calls:[
        { function:{ name:'classify_intent', arguments:{ intent:'create_task' } } }
      ] } },
      { message:{ role:'assistant', thinking:'fill draft', tool_calls:[
        { function:{ name:'draft_item', arguments:{ kind:'task', name:'Pharmacy', durationMinutes:20, due:'today' } } }
      ] } }
    ];
    const out = await runAssistantTurn('Remind me to go to the pharmacy for 20 minutes', {
      forceLlm:true,
      complete:async () => replies.shift()
    });
    return {type:out.type, name:out.draft && out.draft.name, leftover:replies.length, duration:out.draft && out.draft.durationMinutes};
  });
  assert(forced.type === 'preview' && forced.name === 'Pharmacy', 'forceLlm repair still drafts Pharmacy');
  assert(forced.leftover === 0 && forced.duration === 20, 'forceLlm consumed classify+extract and kept 20 min');

  const recovered = await page.evaluate(async () => {
    const prompt = "Add an outside exercise to be done three times a week and only if it's not raining, and if it's not freezing.";
    const out = await runAssistantTurn(prompt, {
      forceLlm:true,
      complete:async () => { throw new Error("Value looks like object, but can't find closing '}' symbol"); }
    });
    return {type:out.type, name:out.draft && out.draft.name, kind:out.draft && out.draft.kind, times:out.draft && out.draft.timesPerPeriod, weather:out.draft && out.draft.weather && out.draft.weather.name};
  });
  assert(recovered.type === 'preview' && /outside exercise/i.test(recovered.name || '') && recovered.kind === 'habit', 'broken Ollama JSON falls back to the local draft');
  assert(recovered.times === 3 && /Outdoor/i.test(recovered.weather || ''), 'fallback keeps 3× / week and Outdoor weather');

  console.log('\n[a11y] sheet copy is short and confirm-gated');
  const a11y = await page.evaluate(() => {
    saveSortSettings({...loadSortSettings(), localAssistant:true});
    syncLocalAssistantControls();
    openAssistantSheet();
    const thread = document.getElementById('assistant-thread');
    const head = document.querySelector('#assistant-sheet .assistant-head');
    const sub = document.querySelector('#assistant-sheet .assistant-sub');
    const input = document.getElementById('assistant-input');
    const clear = document.getElementById('assistant-clear');
    const send = document.getElementById('assistant-send');
    const focus = document.getElementById('assistant-focus');
    const kicker = document.getElementById('assistant-focus-kicker');
    return {
      open:document.getElementById('assistant-sheet')?.classList.contains('open'),
      fullpage:document.body.classList.contains('fullpage-open'),
      title:document.getElementById('assistant-title')?.textContent,
      welcome:thread && thread.textContent,
      head:head && head.textContent,
      sub:sub && sub.textContent,
      kicker:kicker && kicker.textContent,
      placeholder:input && input.getAttribute('placeholder'),
      clearLabel:clear && clear.getAttribute('aria-label'),
      clearText:clear && clear.textContent,
      sendLabel:send && send.getAttribute('aria-label'),
      suggestions:[...document.querySelectorAll('#assistant-thread .assistant-suggest')].map(btn => btn.textContent),
      focusHidden:focus && focus.hidden
    };
  });
  assert(a11y.open && a11y.fullpage, 'assistant sheet opens as a full-page chat');
  assert(/ask Tings/i.test(a11y.title || ''), 'sheet title matches the launch label');
  assert(/Nothing is saved until you confirm/i.test(a11y.welcome || ''), 'welcome says confirm-before-save');
  assert(/regular Tings app|this computer/i.test(a11y.head || ''), 'sheet header is not clone-only');
  assert(/mom|change it/i.test(a11y.placeholder || ''), 'placeholder uses everyday phrasing');
  assert(/clear chat/i.test(a11y.clearLabel || '') && /clear chat/i.test(a11y.clearText || ''), 'header has a clear chat button');
  assert(/top bar|working on|"it"/i.test(a11y.sub || a11y.kicker || ''), 'working-on bar is the item "it" refers to');
  assert(/send/i.test(a11y.sendLabel || ''), 'composer send control is labeled');
  assert(a11y.suggestions.length >= 3, 'welcome offers tap-to-send starters');
  assert(a11y.focusHidden, 'working-on bar stays hidden until there is an item');

  const focusUi = await page.evaluate(async () => {
    localStorage.removeItem(KEY);
    saveSortSettings({...loadSortSettings(), localAssistant:true, defaultDurationMinutes:30});
    if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
    openAssistantSheet();
    const llm = async () => { throw new Error('LLM should not run for working-on bar'); };
    const out = await runAssistantTurn('remind me to call mom', {complete:llm});
    await handleAssistantOutcome(out);
    const afterPreview = {
      barHidden:document.getElementById('assistant-focus')?.hidden,
      draftClass:document.getElementById('assistant-focus')?.classList.contains('is-draft'),
      name:document.getElementById('assistant-focus-name')?.textContent,
      sheetOpen:document.getElementById('assistant-sheet')?.classList.contains('open'),
      kicker:document.getElementById('assistant-focus-kicker')?.textContent,
      chips:document.querySelectorAll('.assistant-bubble-preview .assistant-chip').length
    };
    commitAssistantDraft(false);
    const afterSave = {
      barHidden:document.getElementById('assistant-focus')?.hidden,
      name:document.getElementById('assistant-focus-name')?.textContent,
      sheetOpen:document.getElementById('assistant-sheet')?.classList.contains('open'),
      savedCopy:/Still working on/i.test(document.getElementById('assistant-thread')?.innerText || ''),
      kicker:document.getElementById('assistant-focus-kicker')?.textContent,
      previewButtons:document.querySelectorAll('.assistant-bubble-preview .assistant-preview-actions').length,
      savedName:load().some(h => /call mom/i.test(h.name))
    };
    document.getElementById('assistant-focus-done')?.click();
    const afterDone = {
      barHidden:document.getElementById('assistant-focus')?.hidden,
      name:document.getElementById('assistant-focus-name')?.textContent || ''
    };
    return {afterPreview, afterSave, afterDone};
  });
  assert(focusUi.afterPreview.sheetOpen && focusUi.afterPreview.barHidden === false && /mom/i.test(focusUi.afterPreview.name || ''), 'preview pins the new item on the working-on bar');
  assert(/draft/i.test(focusUi.afterPreview.kicker || '') && focusUi.afterPreview.draftClass, 'unsaved item is labeled as a draft');
  assert(focusUi.afterPreview.chips >= 1, 'preview shows the draft as chips, not a run-on line');
  assert(focusUi.afterSave.sheetOpen && focusUi.afterSave.barHidden === false && /working on/i.test(focusUi.afterSave.kicker || '') && focusUi.afterSave.savedCopy && focusUi.afterSave.savedName, 'save keeps the sheet open and stays on that item');
  assert(focusUi.afterSave.previewButtons === 0, 'saved preview drops the save buttons');
  assert(focusUi.afterDone.barHidden, 'done clears the working-on bar');

  const cleared = await page.evaluate(async () => {
    await sendAssistantMessage("what's next");
    const beforeUsers = document.querySelectorAll('#assistant-thread .assistant-bubble-user').length;
    document.getElementById('assistant-input').value = 'leftover draft';
    clearAssistantChat();
    return {
      beforeUsers,
      afterUsers:document.querySelectorAll('#assistant-thread .assistant-bubble-user').length,
      afterBubbles:document.querySelectorAll('#assistant-thread .assistant-bubble').length,
      afterWelcome:/Nothing is saved until you confirm/i.test(document.getElementById('assistant-thread')?.innerText || ''),
      stillOpen:document.getElementById('assistant-sheet')?.classList.contains('open'),
      input:document.getElementById('assistant-input')?.value || '',
      focusHidden:document.getElementById('assistant-focus')?.hidden
    };
  });
  assert(cleared.beforeUsers >= 1 && cleared.afterUsers === 0 && cleared.afterBubbles === 1 && cleared.afterWelcome, 'clear chat restores the welcome and drops the thread');
  assert(cleared.stillOpen && cleared.input === '' && cleared.focusHidden, 'clear chat keeps the sheet open, empties the box, and clears the working-on bar');
  await page.evaluate(() => closeAssistantSheet());

  console.log('\n[live] Qwen classify battery (optional)');
  const liveWanted = [...ASSISTANT_LIVE_CORE];
  if(process.env.ASSISTANT_LIVE === 'full')liveWanted.push(...ASSISTANT_LIVE_EXTRA);
  const live = await page.evaluate(async ({prompts}) => {
    try{
      const res = await fetch('http://127.0.0.1:11434/api/tags');
      if(!res.ok)return {skipped:true, reason:'tags '+res.status};
      const tags = await res.json();
      const names = (tags.models || []).map(row => row.name);
      if(!names.some(name => /qwen3\.8/i.test(name)))return {skipped:true, reason:'no qwen3.8'};
      const model = pickAssistantModel(names, 'qwen3.8:27b-mlx');
      const catalog = assistantCatalog([
        {name:'Walk', type:'keepup'},
        {name:'Pharmacy', type:'task'}
      ], {locations:[{id:'home-1', name:'Home'}], weatherProfiles:[]}, Date.now());
      const results = [];
      for(const row of prompts){
        const raw = await fetch('http://127.0.0.1:11434/api/chat', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            model,
            stream:false,
            think:true,
            keep_alive:'10m',
            options:{temperature:0.1, num_predict:800},
            messages:[
              {role:'system', content:assistantSystemPrompt()},
              {role:'user', content:assistantUserEnvelope(row.prompt, catalog, null, assistantParseUtterance(row.prompt, catalog, Date.now()))}
            ],
            tools:assistantOllamaTools(['classify_intent'])
          })
        });
        if(!raw.ok){
          results.push({prompt:row.prompt, ok:false, reason:'chat '+raw.status});
          continue;
        }
        const body = await raw.json();
        const parsed = assistantParseReply(body);
        const call = parsed.toolCalls && parsed.toolCalls[0];
        const guessed = assistantParseUtterance(row.prompt, catalog, Date.now());
        const rawIntent = call && call.args && call.args.intent;
        const intent = typeof assistantPreferIntent === 'function'
          ? assistantPreferIntent(rawIntent, guessed)
          : rawIntent;
        const toolOk = call && (call.name === 'classify_intent' || call.name === 'draft_item');
        const intentOk = row.intent.includes(intent)
          || (call && call.name === 'draft_item' && (row.intent.includes('create_task') || row.intent.includes('create_habit')));
        results.push({
          prompt:row.prompt,
          ok:Boolean(toolOk && intentOk),
          intent,
          rawIntent,
          thinking:Boolean(parsed.thinking),
          tool:call && call.name
        });
      }
      return {skipped:false, model, results};
    }catch(err){
      return {skipped:true, reason:String(err && err.message || err)};
    }
  }, {prompts:liveWanted});
  if(live.skipped){
    console.log('  skip: ' + live.reason);
  }else{
    for(const row of live.results){
      assert(row.ok, 'live "' + row.prompt + '" → ' + (row.intent || row.tool || row.reason));
    }
    const thinking = live.results.filter(row => row.thinking).length;
    assert(thinking >= Math.ceil(live.results.length / 2), 'live Qwen returned thinking on most prompts');
  }

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
