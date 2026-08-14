// Regression guards for Home's real Worker boundary, daily rescue, and the
// Day Agenda Audit's accounting/classification.
//
// HABITS_URL=http://127.0.0.1:4181/ node tests/planner-worker-daily-audit-regression-test.js
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
let pass = 0;
function assert(value,message){
  if(!value)throw new Error(message);
  pass += 1;
  console.log('  ok: ' + message);
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});

  const result = await page.evaluate(async()=>{
    const baseHabit = extra=>normalize([{
      name:'item',type:'keepup',target:1,flexibilityDays:0,durationMinutes:5,
      breakable:false,minChunkMinutes:5,allowedTimeStart:null,allowedTimeEnd:null,
      preferredTimeStart:null,preferredTimeEnd:null,lastLog:null,logs:[],emoji:'',
      pinned:false,sample:false,snoozedUntil:null,topics:[],allowedWeekdays:[],
      allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],dueDate:null,
      eventTime:null,planByDate:null,hardDue:false,createdAt:Date.now()-86400000,
      locationIds:[],anywhereAllowed:true,priority:1,...extra
    }])[0];
    const settings = {
      ...loadSortSettings(),agendaOptimizer:true,showWeekOnHome:true,
      availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],
      availabilityOverrides:{},blockedTimes:[],locations:[
        {id:'home',name:'Home',lat:40,lng:-74,radiusM:100},
        {id:'away',name:'Away',lat:41,lng:-75,radiusM:100}
      ],travel:{},defaultTravelMode:'walking',lastKnownLocationId:'home',
      _plannerCurrentCoord:{lat:41,lng:-75},_plannerLiveLocationId:'away'
    };

    // These hints may be attached to one Worker request, but never persisted.
    saveSortSettings(settings);
    const loaded = loadSortSettings();
    const rawSaved = Storage.read(SORT_SETTINGS_KEY) || {};

    const today = dayStart(Date.now());
    const first = today + 86400000;
    const second = first + 86400000;
    const daily = baseHabit({name:'Daily',target:1,lastLog:today,logs:[today]});
    const sparse = baseHabit({name:'Sparse',target:7,lastLog:today-8*86400000,logs:[today-8*86400000]});
    const data = [daily,sparse];
    const makeState = dayBase=>{
      const day = buildDayAgenda(data,loaded,dayBase,{weekMode:true});
      return createDayPlacementState(day,loaded,{dayBase,weekday:new Date(dayBase).getDay(),weekMode:true});
    };
    const states = [makeState(first),makeState(second)];
    const dailyCandidate = {h:daily,i:0,pinned:false,priority:1,scarcity:null,eligible:new Set([first,second])};
    const sparseCandidate = {h:sparse,i:1,pinned:false,priority:1,scarcity:null,eligible:new Set([first])};

    // Existing rows deliberately use custom keys, matching optimizer/rebuild
    // states that previously fooled rescue into duplicating an occurrence.
    for(const [state,candidate,key] of [
      [states[1],dailyCandidate,'daily:custom'],
      [states[0],sparseCandidate,'sparse:custom']
    ]){
      const fill = {h:candidate.h,i:candidate.i,priority:1,scarcity:null,placeKey:key};
      const fit = tryPlaceOnDay(state,fill,{allowNetwork:false,settings:loaded});
      fit.placeKey = key;
      commitPlacement(state,fill,fit);
    }
    rescueLeftoverWeekFits([dailyCandidate,sparseCandidate],states,loaded,{
      allCandidates:[dailyCandidate,sparseCandidate]
    });
    const counts = states.map(state=>[0,1].map(i=>(state.fills||[])
      .filter(entry=>entry.fill.i===i).length));

    // A later daily row is a separate occurrence, not an assignment satisfying
    // today. The audit must call the empty today gap missed, not explained-away.
    const auditDaily = baseHabit({name:'Audit daily',target:1,lastLog:today-86400000,logs:[today-86400000],durationMinutes:1});
    const auditSettings = {...loaded,locations:[],lastKnownLocationId:null};
    const todayDay = buildDayAgenda([auditDaily],auditSettings,today,{weekMode:true});
    const tomorrowDay = buildDayAgenda([auditDaily],auditSettings,today+86400000,{weekMode:true});
    todayDay.timeline = [];
    todayDay.homeDisplayedTimeline = [];
    todayDay.usedMinutes = 0;
    todayDay.remainingMinutes = todayDay.totalMinutes;
    const tomorrowStart = tomorrowDay.slots[0].start;
    tomorrowDay.timeline = [{kind:'fill',i:0,start:tomorrowStart,end:tomorrowStart+60000,locationId:null}];
    tomorrowDay.homeDisplayedTimeline = tomorrowDay.timeline;
    tomorrowDay.usedMinutes = 1;
    tomorrowDay.remainingMinutes = tomorrowDay.totalMinutes-1;
    const unplacedReport = buildDayCapacityScorecard(
      [auditDaily],auditSettings,today,Date.now(),
      {weekMode:true,weekSnapshot:{days:[todayDay,tomorrowDay],optimized:true}}
    );

    // Duplicate rendered rows must be capped to the eligible item's requested
    // load and must not inflate WORK PLACED above 100%.
    const slot = todayDay.slots.find(item=>item.end-item.start>=60000);
    const start = slot.start;
    const duplicateDay = {...todayDay};
    duplicateDay.timeline = [
      {kind:'fill',i:0,start,end:start+60000,locationId:null},
      {kind:'fill',i:0,start,end:start+60000,locationId:null}
    ];
    duplicateDay.homeDisplayedTimeline = duplicateDay.timeline;
    duplicateDay.usedMinutes = 2;
    duplicateDay.remainingMinutes = duplicateDay.totalMinutes-2;
    const duplicateReport = buildDayCapacityScorecard(
      [auditDaily],auditSettings,today,Date.now(),
      {weekMode:true,weekSnapshot:{days:[duplicateDay,tomorrowDay],optimized:true}}
    );

    // Exercise the actual Home Worker, not only the direct planners.
    const nowMinute = Math.ceil((Date.now()-today)/60000/5)*5;
    const workerDaily = baseHabit({
      name:'Worker daily',target:1,durationMinutes:1,
      lastLog:today-86400000,logs:[today-86400000],
      allowedTimeStart:nowMinute+5,allowedTimeEnd:nowMinute+60
    });
    const workerEvent = baseHabit({
      name:'Worker later Home event',type:'task',target:null,
      eventTime:today+(nowMinute+120)*60000,durationMinutes:5,
      locationIds:['home'],anywhereAllowed:false,lastLog:null,logs:[]
    });
    setPlannerCurrentCoord(null);
    const nullCoordCleared = currentCoordLocation()===null;
    const workerWeek = await buildWeekAgendaOffMain(
      [workerDaily,workerEvent],auditSettings,2,
      auditSettings.agendaOptimizer ? 'exact' : 'fast'
    );
    rehydrateAgendaWeekHabits(workerWeek,[workerDaily,workerEvent]);
    const workerTodayCount = (workerWeek.days[0].timeline||[])
      .filter(row=>row.kind==='fill'&&row.i===0).length;

    return {
      loadedHasCoord:Object.prototype.hasOwnProperty.call(loaded,'_plannerCurrentCoord'),
      loadedHasLive:Object.prototype.hasOwnProperty.call(loaded,'_plannerLiveLocationId'),
      savedHasCoord:Object.prototype.hasOwnProperty.call(rawSaved,'_plannerCurrentCoord'),
      savedHasLive:Object.prototype.hasOwnProperty.call(rawSaved,'_plannerLiveLocationId'),
      counts,
      unplacedReason:unplacedReport.unplacedItems[0]&&unplacedReport.unplacedItems[0].reason,
      missed:unplacedReport.missedOpportunityCount,
      gapStatuses:unplacedReport.placementGaps.map(gap=>gap.status),
      duplicatePlaced:duplicateReport.placedLoadMinutes,
      duplicateOutstanding:duplicateReport.outstandingLoad,
      duplicateCoverage:duplicateReport.eligibleCoverage,
      nullCoordCleared,
      workerTodayCount
    };
  });

  assert(!result.loadedHasCoord&&!result.loadedHasLive,
    'load strips stale request-only location hints');
  assert(!result.savedHasCoord&&!result.savedHasLive,
    'save never persists request-only location hints');
  assert(result.counts[0][0]===1&&result.counts[1][0]===1,
    'daily rescue backfills the earlier occurrence while preserving tomorrow');
  assert(result.counts[0][1]===1,
    'custom placement keys do not duplicate an existing sparse occurrence');
  assert(!/^assigned /.test(result.unplacedReason||''),
    'audit does not label a missed daily occurrence assigned elsewhere');
  assert(result.missed>0&&result.gapStatuses.includes('missed'),
    'audit reports the feasible empty daily gap as missed');
  assert(result.duplicatePlaced===result.duplicateOutstanding&&result.duplicateCoverage===1,
    'audit caps duplicate rows to eligible requested load');
  assert(result.nullCoordCleared,
    'a missing Worker coordinate clears live GPS instead of becoming (0, 0)');
  assert(result.workerTodayCount===1,
    'real Home Worker keeps an early daily window before a later Home event');
  assert(errors.length===0,'no page errors');

  await browser.close();
  console.log(`${pass} assertions passed`);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
