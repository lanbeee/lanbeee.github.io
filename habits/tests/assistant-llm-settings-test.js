// Live Qwen reliability for draft_item settings. Parser suites are not enough:
// "use AI instead" must actually land the named fields from the model.
// Skips when no qwen3.8 is reachable. ASSISTANT_LIVE=1 fails on skip;
// ASSISTANT_LIVE=full adds the longer battery.
const { chromium, BASE, waitForAssistant } = require('./helpers/planner-test-helpers');

const FROZEN = Date.parse('2026-09-17T13:24:00'); // Thursday
const DISABLE_LIVE = process.env.ASSISTANT_LIVE === '0';
const REQUIRE_LIVE = Boolean(process.env.ASSISTANT_LIVE) && !DISABLE_LIVE;
const LIVE_FULL = process.env.ASSISTANT_LIVE === 'full';

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

const CORE = [
  {
    id:'create-identity-rhythm',
    prompt:'Create a 45 minute limit habit called Kettlebells, topics health and fitness, every Tuesday and Friday, priority urgent.',
    expect:{
      outType:'preview',
      name:/kettlebell/i,
      kind:'habit',
      habitKind:'reduce',
      duration:45,
      priority:0,
      weekdaysIncludes:[2, 5],
      topicsIncludes:['health', 'fitness']
    }
  },
  {
    id:'create-later-of-window',
    prompt:'Add a 30 minute Maghrib stroll allowed later of 6pm and sunset until isha.',
    expect:{
      outType:'preview',
      name:/stroll|maghrib|walk/i,
      duration:30,
      windowStartMinutes:18 * 60,
      windowCombine:'later',
      windowSecond:'maghrib',
      windowEnd:'isha'
    }
  },
  {
    id:'create-sunrise-whichever-window',
    prompt:'Create a 5 times a week Study habit (1 hour long) which will be from 15 min before sunrise to 2 hours after sunrise or 9 AM whichever is earlier',
    expect:{
      outType:'preview',
      name:/study/i,
      kind:'habit',
      duration:60,
      times:5,
      windowStartAnchor:'sunrise',
      windowStartOffset:-15,
      windowEndOffset:120,
      windowEndCombine:'earlier',
      windowEndSecondMinutes:9 * 60
    }
  },
  {
    id:'create-hard-due-task',
    prompt:'Remind me to file taxes on 2026-09-20. That due day is firm, no late days. Priority urgent.',
    expect:{
      outType:'preview',
      name:/tax/i,
      kind:'task',
      dueKey:'2026-09-20',
      hardDue:true,
      delayDays:0,
      priority:0
    }
  },
  {
    id:'create-place-weather-order',
    prompt:'Add a 20 minute Stretch at Home, prefer Home high and avoid Gym, using Dry weather, right after Walk the same day.',
    expect:{
      outType:'preview',
      name:/stretch/i,
      duration:20,
      placesIncludes:['Home'],
      prefHome:'high',
      prefGym:'avoid',
      weather:/dry/i,
      orderDir:'after',
      orderName:/walk/i,
      sameDay:true
    },
    nice:{ orderAdj:'direct' }
  },
  {
    id:'edit-split-pin-emoji',
    focus:'Strength',
    prompt:'Pin it, split it into 20 minute chunks, turn auto-mark off, and use a purple 💪.',
    expect:{
      outType:'preview',
      name:/strength/i,
      pinned:true,
      breakable:true,
      minChunk:20,
      autoMarkOff:true
    },
    nice:{ emoji:'💪', color:'purple' }
  },
  {
    id:'edit-month-days-pref',
    focus:'Strength',
    prompt:'Change Strength so it is only on the 1st and 15th, and prefer Tuesday.',
    expect:{
      outType:'preview',
      name:/strength/i,
      monthDaysIncludes:[1, 15],
      preferredWeekdaysIncludes:[2]
    }
  },
  {
    id:'edit-link',
    focus:'Strength',
    prompt:'Add this link to Strength: https://example.com/lift',
    expect:{
      outType:'preview',
      name:/strength/i,
      url:/example\.com\/lift/
    }
  },
  {
    id:'create-weekend',
    prompt:'Add a hike habit every weekend.',
    expect:{
      outType:'preview',
      name:/hike/i,
      kind:'habit',
      weekdaysIncludes:[0, 6]
    }
  }
];

const EXTRA = [
  {
    id:'edit-preferred-window',
    focus:'Strength',
    prompt:'Give Strength a preferred window between 5pm and 7pm.',
    expect:{
      outType:'preview',
      preferredStartMinutes:17 * 60,
      preferredEndMinutes:19 * 60
    }
  },
  {
    id:'edit-early-delay',
    focus:'Strength',
    prompt:'Allow Strength 2 early days and 1 late day.',
    expect:{
      outType:'preview',
      earlyDays:2,
      delayDays:1
    }
  },
  {
    id:'create-snooze-shared',
    prompt:'Remind me to call the bank today, snooze it for 2 hours, and keep it off the shared display.',
    expect:{
      outType:'preview',
      name:/bank/i,
      kind:'task',
      snoozed:true,
      sharedDisplay:false
    }
  },
  {
    id:'create-option',
    prompt:'Add a 30 minute Gym visit every Tuesday from 9am to 11am at Gym.',
    expect:{
      outType:'preview',
      name:/gym/i,
      duration:30,
      weekdaysIncludes:[2],
      optionLoc:'gym-1',
      optionStart:9 * 60
    }
  },
  {
    id:'edit-weather-card',
    focus:'Strength',
    prompt:'Show the forecast on Strength and use the Home place for that forecast.',
    expect:{
      outType:'preview',
      showWeather:true,
      weatherPlace:'home-1'
    }
  },
  {
    id:'edit-track-value',
    focus:'Strength',
    prompt:'Log a numeric value on Strength.',
    expect:{
      outType:'preview',
      trackValue:true
    }
  },
  {
    id:'edit-rename',
    focus:'Strength',
    prompt:'Rename Strength to Evening strength.',
    expect:{
      outType:'preview',
      name:/evening strength/i
    }
  }
];

function includesAll(hay, needles){
  const list = Array.isArray(hay) ? hay : [];
  return (needles || []).every(n => {
    if(typeof n === 'string'){
      return list.some(v => String(v).toLowerCase() === n.toLowerCase());
    }
    return list.includes(n);
  });
}

function checkExpect(prefix, got, spec){
  const d = got.draft || {};
  const misses = [];
  const note = (key, extra) => misses.push(extra != null ? `${key}=${JSON.stringify(extra)}` : key);
  if(spec.outType && got.type !== spec.outType)note('type', got.type);
  if(spec.name && !spec.name.test(d.name || ''))note('name', d.name);
  if(spec.kind && d.kind !== spec.kind)note('kind', d.kind);
  if(spec.habitKind && d.habitKind !== spec.habitKind)note('habitKind', d.habitKind);
  if(spec.duration != null && d.duration !== spec.duration)note('duration', d.duration);
  if(spec.times != null && d.times !== spec.times)note('times', d.times);
  if(spec.priority != null && d.priority !== spec.priority)note('priority', d.priority);
  if(spec.weekdaysIncludes && !includesAll(d.weekdays, spec.weekdaysIncludes))note('weekdays', d.weekdays);
  if(spec.topicsIncludes && !includesAll(d.topics, spec.topicsIncludes))note('topics', d.topics);
  if(spec.monthDaysIncludes && !includesAll(d.monthDays, spec.monthDaysIncludes))note('monthDays', d.monthDays);
  if(spec.preferredWeekdaysIncludes && !includesAll(d.preferredWeekdays, spec.preferredWeekdaysIncludes)){
    note('preferredWeekdays', d.preferredWeekdays);
  }
  if(spec.windowStartMinutes != null && !(d.windowStart && d.windowStart.minutes === spec.windowStartMinutes)){
    note('windowStart', d.windowStart);
  }
  if(spec.windowCombine && !(d.windowStart && d.windowStart.combine === spec.windowCombine)){
    note('windowCombine', d.windowStart && d.windowStart.combine);
  }
  if(spec.windowSecond && !(d.windowStart && d.windowStart.second === spec.windowSecond)){
    note('windowSecond', d.windowStart && d.windowStart.second);
  }
  if(spec.windowEnd && !(d.windowEnd && (d.windowEnd.anchor === spec.windowEnd || d.windowEnd.clock === spec.windowEnd))){
    note('windowEnd', d.windowEnd);
  }
  if(spec.windowStartAnchor && !(d.windowStart && d.windowStart.anchor === spec.windowStartAnchor)){
    note('windowStartAnchor', d.windowStart);
  }
  if(spec.windowStartOffset != null && !(d.windowStart && d.windowStart.offsetMin === spec.windowStartOffset)){
    note('windowStartOffset', d.windowStart);
  }
  if(spec.windowEndOffset != null && !(d.windowEnd && d.windowEnd.offsetMin === spec.windowEndOffset)){
    note('windowEndOffset', d.windowEnd);
  }
  if(spec.windowEndCombine && !(d.windowEnd && d.windowEnd.combine === spec.windowEndCombine)){
    note('windowEndCombine', d.windowEnd && d.windowEnd.combine);
  }
  if(spec.windowEndSecondMinutes != null && !(d.windowEnd && d.windowEnd.secondMinutes === spec.windowEndSecondMinutes)){
    note('windowEndSecond', d.windowEnd);
  }
  if(spec.preferredStartMinutes != null && !(d.preferredStart && d.preferredStart.minutes === spec.preferredStartMinutes)){
    note('preferredStart', d.preferredStart);
  }
  if(spec.preferredEndMinutes != null && !(d.preferredEnd && d.preferredEnd.minutes === spec.preferredEndMinutes)){
    note('preferredEnd', d.preferredEnd);
  }
  if(spec.placesIncludes && !includesAll(d.places, spec.placesIncludes))note('places', d.places);
  if(spec.prefHome && (!d.prefs || d.prefs['home-1'] !== spec.prefHome))note('prefHome', d.prefs);
  if(spec.prefGym && (!d.prefs || d.prefs['gym-1'] !== spec.prefGym))note('prefGym', d.prefs);
  if(spec.weather && !spec.weather.test(String(d.weather || '')))note('weather', d.weather);
  if(spec.orderDir && d.orderDir !== spec.orderDir)note('orderDir', d.orderDir);
  if(spec.orderName && !spec.orderName.test(String(d.orderName || '')))note('orderName', d.orderName);
  if(spec.orderAdj && d.orderAdj !== spec.orderAdj)note('orderAdj', d.orderAdj);
  if(spec.sameDay != null && d.sameDay !== spec.sameDay)note('sameDay', d.sameDay);
  if(spec.pinned != null && d.pinned !== spec.pinned)note('pinned', d.pinned);
  if(spec.breakable != null && d.breakable !== spec.breakable)note('breakable', d.breakable);
  if(spec.minChunk != null && d.minChunk !== spec.minChunk)note('minChunk', d.minChunk);
  if(spec.autoMarkOff && !(d.autoMark === null || d.autoMark === 0))note('autoMark', d.autoMark);
  if(spec.autoMark !== undefined && !spec.autoMarkOff && d.autoMark !== spec.autoMark)note('autoMark', d.autoMark);
  if(spec.emoji && d.emoji !== spec.emoji)note('emoji', d.emoji);
  if(spec.color && d.color !== spec.color)note('color', d.color);
  if(spec.url && !spec.url.test(String(d.url || '')))note('url', d.url);
  if(spec.dueKey && d.dueKey !== spec.dueKey)note('dueKey', d.dueKey);
  if(spec.hardDue != null && d.hardDue !== spec.hardDue)note('hardDue', d.hardDue);
  if(spec.delayDays != null && d.delayDays !== spec.delayDays)note('delayDays', d.delayDays);
  if(spec.earlyDays != null && d.earlyDays !== spec.earlyDays)note('earlyDays', d.earlyDays);
  if(spec.snoozed != null && d.snoozed !== spec.snoozed)note('snoozed', d.snoozed);
  if(spec.sharedDisplay != null && d.sharedDisplay !== spec.sharedDisplay)note('sharedDisplay', d.sharedDisplay);
  if(spec.showWeather != null && d.showWeather !== spec.showWeather)note('showWeather', d.showWeather);
  if(spec.weatherPlace && d.weatherPlace !== spec.weatherPlace)note('weatherPlace', d.weatherPlace);
  if(spec.trackValue != null && d.trackValue !== spec.trackValue)note('trackValue', d.trackValue);
  if(spec.optionLoc && d.optionLoc !== spec.optionLoc)note('optionLoc', d.optionLoc);
  if(spec.optionStart != null && d.optionStart !== spec.optionStart)note('optionStart', d.optionStart);
  if(got.fastPath)note('fastPath', true);
  if(got.path && got.path !== 'llm')note('path', got.path);
  if(got.envelopeHasFacts)note('extractedFacts leaked');
  if(got.habitOk === false)note('commit', got.habitError);
  return misses;
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

  console.log('\n[probe] local Qwen3.8');
  const probe = DISABLE_LIVE ? {skipped:true, reason:'ASSISTANT_LIVE=0'} : await page.evaluate(async () => {
    try{
      delete globalThis.__assistantTestComplete;
      saveSortSettings({
        ...DEFAULT_SORT_SETTINGS,
        localAssistant:true,
        localAssistantDebug:true,
        locations:[{id:'home-1', name:'Home', lat:51.5, lng:-0.12},{id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}],
        weatherProfiles:[{id:'dry-1', name:'Dry'}]
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
  }else{
    console.log('  model: ' + probe.provider + ' ' + probe.model);
    const wanted = LIVE_FULL ? CORE.concat(EXTRA) : CORE;
    console.log('\n[live] draft_item settings via forceLlm (' + wanted.length + ')');
    page.setDefaultTimeout(20 * 60 * 1000);
    const live = await page.evaluate(async ({cases, now}) => {
      delete globalThis.__assistantTestComplete;

      function endSnap(end){
        if(!end || typeof end !== 'object')return null;
        return {
          kind:end.kind,
          minutes:end.minutes,
          clock:end.clock,
          anchor:end.anchor,
          offsetMin:end.offsetMin || 0,
          combine:end.combine || null,
          second:end.second ? (end.second.anchor || end.second.clock || end.second.minutes) : null,
          secondMinutes:end.second && end.second.kind === 'clock' ? end.second.minutes : null
        };
      }

      function optionSnap(draft){
        const opt = Array.isArray(draft.scheduleOptions) && draft.scheduleOptions[0];
        if(!opt)return {optionLoc:null, optionStart:null};
        return {
          optionLoc:opt.locationId || opt.locId || null,
          optionStart:opt.start != null ? opt.start : (opt.startMinutes != null ? opt.startMinutes : null)
        };
      }

      function draftSnap(draft){
        if(!draft)return null;
        const link = (draft.scheduleLinks || [])[0] || null;
        const url = (draft.links || [])[0] || null;
        const opt = optionSnap(draft);
        return {
          name:draft.name,
          kind:draft.kind,
          habitKind:draft.habitKind,
          duration:draft.durationMinutes,
          priority:draft.priority,
          topics:draft.topics,
          emoji:draft.emoji,
          color:draft.emojiBgColor,
          weekdays:draft.allowedWeekdays,
          monthDays:draft.allowedMonthDays,
          preferredWeekdays:draft.preferredWeekdays,
          preferredMonthDays:draft.preferredMonthDays,
          times:draft.timesPerPeriod,
          period:draft.periodDays,
          windowStart:endSnap(draft.window && draft.window.start),
          windowEnd:endSnap(draft.window && draft.window.end),
          preferredStart:endSnap(draft.preferredWindow && draft.preferredWindow.start),
          preferredEnd:endSnap(draft.preferredWindow && draft.preferredWindow.end),
          places:draft.places && draft.places.names,
          prefs:draft.locationPrefs || null,
          weather:draft.weather && draft.weather.name,
          showWeather:draft.showWeather,
          weatherPlace:draft.weatherLocationId || null,
          breakable:draft.breakable,
          minChunk:draft.minChunkMinutes,
          autoMark:draft.autoMarkMinutes === undefined ? undefined : draft.autoMarkMinutes,
          pinned:draft.pinned,
          trackValue:draft.trackValue,
          hardDue:draft.hardDue,
          delayDays:draft.delayAllowanceDays,
          earlyDays:draft.earlyWindowDays,
          dueKey:draft.dueDate != null && typeof dateKey === 'function' ? dateKey(draft.dueDate) : null,
          snoozed:draft.snoozedUntil != null,
          sharedDisplay:draft.showOnSharedDisplay,
          orderDir:link && link.direction,
          orderName:link && (link.name || ''),
          orderAdj:link && link.adjacency,
          sameDay:link && Boolean(link.requireSameDay),
          url:url && url.value,
          optionLoc:opt.optionLoc,
          optionStart:opt.optionStart
        };
      }

      function seed(){
        saveSortSettings({
          ...DEFAULT_SORT_SETTINGS,
          localAssistant:true,
          localAssistantDebug:true,
          defaultDurationMinutes:30,
          defaultBreakable:false,
          defaultTopics:['inbox'],
          topics:['health', 'fitness', 'inbox'],
          locations:[
            {id:'home-1', name:'Home', lat:51.5, lng:-0.12},
            {id:'gym-1', name:'Gym', lat:51.51, lng:-0.13}
          ],
          weatherProfiles:[{id:'dry-1', name:'Dry'}]
        });
        const raw = [
          {name:'Walk', type:'keepup', target:1, durationMinutes:20, logs:[], lastLog:null},
          {name:'Strength', type:'keepup', target:1, durationMinutes:30, logs:[], lastLog:null, topics:['inbox']}
        ];
        const data = typeof normalize === 'function' ? normalize(raw) : raw;
        save(data);
        return assistantBuildContext(now);
      }

      const results = [];
      for(const row of cases){
        const context = seed();
        const session = assistantCreateSession();
        if(row.focus){
          const found = assistantFindHabit(context.data, row.focus);
          if(found && found.ok)assistantFocusHabit(session, found, context);
        }
        let out;
        try{
          out = await runAssistantTurn(row.prompt, {forceLlm:true, session, context});
        }catch(err){
          results.push({
            id:row.id,
            type:'threw',
            text:String(err && err.message || err),
            fastPath:false,
            path:'error',
            envelopeHasFacts:false,
            draft:null,
            habitOk:false
          });
          continue;
        }
        const firstUser = (out.session && out.session.messages || []).find(msg => msg && msg.role === 'user');
        const envelopeHasFacts = /"extractedFacts":\{/.test(String(firstUser && firstUser.content || ''));
        const pathEvent = (out.debug || []).find(ev => ev.t === 'path') || {};
        const toolEv = (out.debug || []).find(ev => ev.t === 'tool' && ev.name === 'draft_item') || {};
        let habitOk = null;
        let habitError = null;
        if(out.type === 'preview' && out.draft){
          const commit = assistantCommitDraft(out.draft);
          habitOk = Boolean(commit && commit.ok);
          habitError = commit && commit.error || null;
        }
        results.push({
          id:row.id,
          type:out.type,
          text:out.text || out.question || out.summary || '',
          fastPath:out.fastPath === true,
          path:pathEvent.path || null,
          via:pathEvent.via || null,
          tools:(out.debug || []).filter(ev => ev.t === 'tool').map(ev => ev.name),
          args:toolEv.args || null,
          envelopeHasFacts,
          factsTrusted:((out.debug || []).find(ev => ev.t === 'parse') || {}).factsTrusted === true,
          draft:draftSnap(out.draft),
          habitOk,
          habitError,
          llmCalls:out.session && out.session.llmCalls,
          debugText:out.debugText || ''
        });
      }
      return results;
    }, {cases:wanted, now:FROZEN});

    for(const spec of wanted){
      const got = live.find(row => row.id === spec.id) || {type:'missing'};
      const requiredMiss = checkExpect(spec.id, got, spec.expect || {});
      const niceMiss = spec.nice ? checkExpect(spec.id, got, spec.nice) : [];
      const extra = got.args ? ' args=' + JSON.stringify(got.args).slice(0, 400) : '';
      const why = got.type !== 'preview' ? ` type=${got.type} ${got.text || ''}` : '';
      assert(!requiredMiss.length, spec.id + (requiredMiss.length ? ' missing ' + requiredMiss.join(', ') : '') + why + extra);
      if(niceMiss.length){
        console.log('  note: ' + spec.id + ' optional ' + niceMiss.join(', '));
      }
      if(got.llmCalls != null)console.log('    ' + spec.id + ' llmCalls=' + got.llmCalls + ' via=' + (got.via || '?'));
      if(got.type === 'error' && got.debugText)console.log('    debug: ' + String(got.debugText).split('\n').slice(-8).join(' / '));
    }
  }

  assert(!errors.length, 'no page errors (' + errors.join(' | ') + ')');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
