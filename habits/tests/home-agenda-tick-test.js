// While-open home tick: most minutes reuse or slide the last plan. A GLPK
// re-solve is only for an imminent next row whose last packing no longer fits,
// and never lengthens cold open.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/home-agenda-tick-test.js
const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true });
  const failures = [];
  function check(name,cond,detail){
    if(cond)console.log('  ok  - ' + name);
    else {
      failures.push(name + (detail ? ' :: ' + detail : ''));
      console.log('  FAIL- ' + name + (detail ? ' :: ' + detail : ''));
    }
  }

  await page.goto(BASE,{ waitUntil:'load' });

  const source = await page.evaluate(() => {
    const ilp = String(solveDayPackingIlp);
    const assign = String(assignWeekCandidatesOptimized);
    const tick = String(homeAgendaTickPlan);
    const idle = String(scheduleIdlePlannerWarmAndBuild);
    const refinement = String(scheduleHomeAgendaRefinement);
    const queue = String(queueOptimizedHomeRender);
    const tickFn = String(tickHomeAgendaWhileOpen);
    return {
      coldOpenFourSeconds:ilp.includes(': 4)'),
      tickReplanGate:ilp.includes('solveOptions.tickReplan'),
      replaySkip:assign.includes('replayPriorFixedChoices')
        && assign.includes("status:'reused'"),
      provenReplay:assign.includes('reused-optimal')
        && assign.includes('provenDayKeys'),
      priorAnchors:ilp.includes('priorPlacementsForDay'),
      idleKeep:idle.includes("plan.kind === 'keep'")
        && idle.includes('adoptHomeAgendaReadyState'),
      idleRefines:idle.includes('maybeScheduleHomeAgendaRefinement'),
      refinementWaitsForIdle:refinement.includes('requestIdleCallback')
        && refinement.includes('HOME_AGENDA_REFINEMENT_IDLE_TIMEOUT_MS'),
      hiddenIdleNoop:idle.includes("document.visibilityState === 'hidden'"),
      tickRefines:tickFn.includes('maybeScheduleHomeAgendaRefinement'),
      memoDays:queue.includes('memoDaysFromWeek')
        && queue.includes('agendaPriorPlacementsFromWeek'),
      cancelRefineForSolve:queue.includes('planner request superseded refinement'),
      tickHelper:typeof homeAgendaTickPlan === 'function'
        && typeof shiftAgendaFillToNow === 'function'
        && typeof replayPriorFixedChoices === 'function'
        && typeof maybeScheduleHomeAgendaRefinement === 'function'
        && typeof homeAgendaProvenDayKeys === 'function',
      overhead:typeof travelLegCostSeconds === 'function'
        && typeof TRAVEL_LEG_OVERHEAD_SECONDS === 'number'
        && TRAVEL_LEG_OVERHEAD_SECONDS >= 60,
      imminentMs:typeof HOME_AGENDA_IMMINENT_MS === 'number' ? HOME_AGENDA_IMMINENT_MS : 0,
      tickMentionsKeep:tick.includes("kind:'keep'"),
      laterBudget:typeof HOME_AGENDA_REFINEMENT_LATER_BUDGET_MS === 'number'
        && HOME_AGENDA_REFINEMENT_LATER_BUDGET_MS > HOME_AGENDA_REFINEMENT_FIRST_BUDGET_MS
    };
  });
  check('cold-open GLPK cap remains 4 seconds',source.coldOpenFourSeconds,JSON.stringify(source));
  check('extra GLPK seconds require tickReplan',source.tickReplanGate,JSON.stringify(source));
  check('tick/day0 skip GLPK when the last packing still fits',source.replaySkip,JSON.stringify(source));
  check('prior clocks are injected as ILP options',source.priorAnchors,JSON.stringify(source));
  check('idle cache refresh keeps or slides instead of a full-week solve',source.idleKeep,JSON.stringify(source));
  check('idle keep still schedules background refinement when not a GLPK proof',source.idleRefines,JSON.stringify(source));
  check('deep refinement waits for an idle interval',source.refinementWaitsForIdle,JSON.stringify(source));
  check('an idle callback does no planner work after the page is hidden',source.hiddenIdleNoop,JSON.stringify(source));
  check('while-open keep ticks keep searching toward a proof',source.tickRefines,JSON.stringify(source));
  check('later refine passes reuse days already proved optimal',source.provenReplay,JSON.stringify(source));
  check('a real re-solve cancels in-flight refinement',source.cancelRefineForSolve,JSON.stringify(source));
  check('later while-open refine passes get a larger budget',source.laterBudget,JSON.stringify(source));
  check('day0Only sends the mounted week so far days are reused',source.memoDays,JSON.stringify(source));
  check('tick helpers are on the page',source.tickHelper,JSON.stringify(source));
  check('travel overhead is a real per-leg cost',source.overhead,JSON.stringify(source));

  const now = Date.now();
  const dayBase = new Date();
  dayBase.setHours(0,0,0,0);
  const at = (h,m = 0) => dayBase.getTime() + (h * 60 + m) * 60000;
  const week = {
    days:[{
      dayBase:dayBase.getTime(),
      timeline:[
        {kind:'fill',i:0,h:{name:'Exercise',hid:'ex'},start:at(7,0),end:at(7,20),locationId:'home'},
        {kind:'fill',i:1,h:{name:'Errand',hid:'er'},start:at(7,32),end:at(7,47),locationId:'walmart'}
      ]
    }]
  };

  const far = await page.evaluate(({week,now}) => homeAgendaTickPlan(week,now),{
    week,now:at(2,9)
  });
  check('hours before the next fill keeps the last plan',far.kind === 'keep',JSON.stringify(far));

  const stale = await page.evaluate(({week,now}) => homeAgendaTickPlan(week,now),{
    week,now:at(10,0)
  });
  check('an unfinished fill from earlier today forces a re-solve',
    stale.kind === 'imminent-solve',JSON.stringify(stale));

  const imminent = await page.evaluate(({week,now}) => homeAgendaTickPlan(week,now),{
    week,now:at(6,58)
  });
  check('a couple of minutes before the next fill asks for a re-solve',
    imminent.kind === 'imminent-solve',JSON.stringify(imminent));

  const late = await page.evaluate(({week,now}) => homeAgendaTickPlan(week,now),{
    week,now:at(7,3)
  });
  check('a few minutes late slides only the next fill',
    late.kind === 'clock-shift'
      && late.timeline
      && late.timeline[0].start === at(7,3)
      && late.timeline[0].end === at(7,23)
      && late.timeline[1].start === at(7,32),
    JSON.stringify(late));

  const clash = await page.evaluate(({week,now}) => homeAgendaTickPlan(week,now),{
    week,now:at(7,14)
  });
  check('a slide that would hit the following row asks for a re-solve',
    clash.kind === 'imminent-solve',JSON.stringify(clash));

  const prior = await page.evaluate(() => {
    const opts = [
      {c:{i:0},fill:{h:{hid:'ex'}},fit:{placeStart:1000,locId:'home'},weight:10},
      {c:{i:0},fill:{h:{hid:'ex'}},fit:{placeStart:1000 + 5 * 60000,locId:'home'},weight:10}
    ];
    applyPriorPlacementWeights(opts,[{i:0,hid:'ex',start:1000,locId:'home'}]);
    return {first:opts[0].weight,second:opts[1].weight};
  });
  check('prior placements prefer the last chosen clock',
    prior.first > prior.second,JSON.stringify(prior));

  const weekPriors = await page.evaluate(({week}) => {
    const rows = agendaPriorPlacementsFromWeek(week);
    return {count:rows.length,days:rows.map(r=>r.dayBase),hids:rows.map(r=>r.hid)};
  },{week:{
    days:[
      {dayBase:dayBase.getTime(),timeline:week.days[0].timeline},
      {dayBase:dayBase.getTime() + 86400000,timeline:[
        {kind:'fill',i:2,h:{hid:'t2'},start:at(9,0),end:at(9,30),locationId:'home'}
      ]}
    ]
  }});
  check('week priors keep a dayBase on every fill',
    weekPriors.count === 3 && weekPriors.days[2] === dayBase.getTime() + 86400000,
    JSON.stringify(weekPriors));

  const replay = await page.evaluate(({now,dayBase}) => {
    const settings = {
      preset:'todayFirst',agendaOptimizer:true,defaultTravelMode:'walking',
      lastKnownLocationId:'home',
      locations:[{id:'home',name:'Home',lat:40.7,lng:-74}],
      travel:{},blockedTimes:[{label:'sleep',days:[],start:0,end:380}],
      availabilityMinutes:[720,720,720,720,720,720,720]
    };
    const h = {
      hid:'ex',name:'Exercise',type:'keepup',target:1,durationMinutes:20,
      lastLog:now - 86400000,logs:[now - 86400000],
      locationIds:['home'],anywhereAllowed:false,priority:2,
      flexibilityDays:0,breakable:false,pinned:false,eventTime:null,dueDate:null
    };
    const data = [h];
    const day = buildDayAgenda(data,settings,dayBase,{weekMode:true,now});
    const state = createDayPlacementState(day,settings,{dayBase,weekMode:true,now,startClock:now});
    const c = {h,i:0,priority:2,scarcity:1};
    const start = now + 60 * 60000;
    const prior = [{i:0,hid:'ex',start,end:start + 20 * 60000,locId:'home',dayBase}];
    const ok = replayPriorFixedChoices(state,[c],prior,new Set());
    const blockedState = createDayPlacementState(day,settings,{dayBase,weekMode:true,now,startClock:now});
    blockedState.slots = [{start:blockedState.startClock,end:start}];
    const blocked = replayPriorFixedChoices(blockedState,[c],prior,new Set());
    return {
      reused:Boolean(ok && ok.length === 1 && ok.solveStatus === 'reused'),
      start:ok && ok[0] && ok[0].fit && ok[0].fit.placeStart,
      want:start,
      blockedIsNull:blocked == null
    };
  },{now:at(6,0),dayBase:dayBase.getTime()});
  check('replay recommits the last start when that slot is still free',
    replay.reused && Math.abs(replay.start - replay.want) < 2 * 60000,
    JSON.stringify(replay));
  check('replay refuses when the last start is now blocked',
    replay.blockedIsNull,JSON.stringify(replay));

  const idleDispatch = await page.evaluate(async()=>{
    const saved = {
      requestIdleCallback:window.requestIdleCallback,
      cancelIdleCallback:window.cancelIdleCallback,
      buildWeekAgendaOffMain:window.buildWeekAgendaOffMain,
      settings:sortSettings,
      rendered:_homeRenderedWeek,
      ready:_optimizerHomeReadyWeek,
      requestKey:_optimizerHomeRequestKey,
      refinementKey:_optimizerHomeRefinementKey,
      doneKey:_optimizerHomeRefinementDoneKey,
      pass:_optimizerHomeRefinementPass,
      tracked:_optimizerHomeRefinementTrackedDirty
    };
    let idleCallback = null;
    let builds = 0;
    const data = load();
    const baseline = {
      optimized:true,plannerSolveStatus:'feasible',refined:false,
      days:[{dayBase:dayStart(Date.now()),timeline:[],agendaItems:[]}]
    };
    try{
      sortSettings = {...loadSortSettings(),agendaOptimizer:true};
      _homeRenderedWeek = baseline;
      _optimizerHomeReadyWeek = baseline;
      _optimizerHomeRequestKey = '';
      _optimizerHomeRefinementKey = '';
      _optimizerHomeRefinementDoneKey = '';
      _optimizerHomeRefinementPass = 0;
      _optimizerHomeRefinementTrackedDirty = '';
      window.requestIdleCallback = callback=>{
        idleCallback = callback;
        return 4242;
      };
      window.cancelIdleCallback = ()=>{};
      window.buildWeekAgendaOffMain = ()=>{
        builds += 1;
        return Promise.resolve({...baseline,plannerSolveStatus:'optimal',refined:true});
      };
      const scheduled = scheduleHomeAgendaRefinement(data,sortSettings,baseline);
      const beforeIdle = builds;
      if(idleCallback)idleCallback({didTimeout:false,timeRemaining:()=>20});
      await new Promise(resolve=>setTimeout(resolve,0));
      return {scheduled,beforeIdle,afterIdle:builds};
    }finally{
      cancelHomeAgendaRefinement();
      window.requestIdleCallback = saved.requestIdleCallback;
      window.cancelIdleCallback = saved.cancelIdleCallback;
      window.buildWeekAgendaOffMain = saved.buildWeekAgendaOffMain;
      sortSettings = saved.settings;
      _homeRenderedWeek = saved.rendered;
      _optimizerHomeReadyWeek = saved.ready;
      _optimizerHomeRequestKey = saved.requestKey;
      _optimizerHomeRefinementKey = saved.refinementKey;
      _optimizerHomeRefinementDoneKey = saved.doneKey;
      _optimizerHomeRefinementPass = saved.pass;
      _optimizerHomeRefinementTrackedDirty = saved.tracked;
    }
  });
  check('background solve is posted only after the idle callback runs',
    idleDispatch.scheduled && idleDispatch.beforeIdle === 0 && idleDispatch.afterIdle === 1,
    JSON.stringify(idleDispatch));

  await browser.close();
  if(failures.length){
    console.error('\nFAILED ' + failures.length);
    process.exit(1);
  }
  console.log('\nPASS — home agenda tick');
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
