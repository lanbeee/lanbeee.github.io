const assert=require('assert');
const {chromium,BASE,baseHabit,openEveningSettings}=require('./helpers/planner-test-helpers');
const {qualityScenarios}=require('./helpers/planner-quality-fixtures');
const {independentViolations}=require('./helpers/planner-quality-validation');
const {runPlannerQualityScenario}=require('./helpers/planner-quality-runner');
const fs=require('fs'),path=require('path');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
    const page=await context.newPage();await page.goto(BASE);await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    const controls=await page.evaluate(({base,settings})=>{
      const RealDate=Date,now=new Date(2026,8,14,9).getTime();
      globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      const dayBase=dayStart(now);
      try{
        const h={...base,hid:'pool',name:'Pool',type:'task',target:null,breakable:true,durationMinutes:60,minChunkMinutes:15,
          dueDate:dayBase+86400000,earlyWindowDays:1,allowedTimeStart:540,allowedTimeEnd:660};
        const c={h,i:0,priority:2,eligible:new Set([dayBase,dayBase+86400000])};
        const state=createDayPlacementState(buildDayAgenda([h],settings,dayBase),settings,{now,dayBase,weekMode:true});
        const fill={h,i:0,priority:2,chunkMinutes:30,chunkIndex:0,placeKey:'0:0'};
        const fit=tryPlaceOnDay(state,fill,{settings,allowNetwork:false});commitPlacement(state,fill,fit);
        const agendaBefore=JSON.stringify(state.day.agendaItems);
        const replay=rebuildDayFromFills(state,[fill],[c],{settings,allowNetwork:false});
        const replayIsolated=JSON.stringify(state.day.agendaItems)===agendaBefore;
        const reservations=dailyBreakableReservations(state,[c]);
        let cached,edited,venueFresh,blocksFresh;
        const dynamic={...base,hid:'window',allowedTimeStart:547,allowedTimeEnd:554};
        const loc={id:'home',name:'Home',lat:40.7,lng:-74,allowedTimeStart:540,allowedTimeEnd:660};
        beginPlannerSolveCaches([dynamic]);
        try{
          const first=fillDayWindows(dynamic,dayBase,'home');first[0].start=0;
          cached=fillDayWindows(dynamic,dayBase,'home')[0].start;
          const win=resolveLocationWindow(loc,1);win.start=0;venueFresh=resolveLocationWindow(loc,1).start;
          const blocked=agendaBlockedIntervals(dateKey(dayBase),settings,dayBase,dayBase+86400000);blocked[0].end=0;
          blocksFresh=agendaBlockedIntervals(dateKey(dayBase),settings,dayBase,dayBase+86400000)[0].end>0;
        }finally{endPlannerSolveCaches();}
        dynamic.allowedTimeStart=548;
        beginPlannerSolveCaches([dynamic]);
        try{edited=fillDayWindows(dynamic,dayBase,'home')[0].start;}finally{endPlannerSolveCaches();}
        const originalTravel=travelEdgeBetweenIds;
        let routeCalls=0;
        travelEdgeBetweenIds=(...args)=>{routeCalls++;return originalTravel(...args);};
        try{
          const registry=Array.from({length:3},(_,i)=>({id:'site'+i,name:'Site'+i,lat:40.7+i*.001,lng:-74}));
          routeCandidateOrders({...state,registry,seedLocId:'site0',fills:Array.from({length:16},(_,i)=>({
            fill:{h:{...base,hid:'route'+i,locationIds:['site'+i%3]},i},fit:{placeStart:now+i*60000,placeEnd:now+(i+1)*60000}
          }))});
        }finally{travelEdgeBetweenIds=originalTravel;}
        const values=[3,1,1,2,NaN];
        return {replayIsolated,replayMinutes:placedBreakableMinutes(replay,0),reservations:reservations.length,cached,edited,
          venueFresh,blocksFresh,dayBase,routeCalls,percentile:weatherPercentile(2,values),
          zoneDay:weatherDayKey(new RealDate('2026-09-14T01:00:00Z').getTime(),'America/New_York')};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{base:baseHabit({}),settings:openEveningSettings({blockedTimes:[{label:'night',days:[],start:0,end:540},{label:'end',days:[],start:1080,end:1440}]})});
    assert.strictEqual(controls.replayMinutes,30,'task replay preserves day allocation from the shared lifetime pool');
    assert(controls.replayIsolated,'speculative rebuild does not modify incumbent day items');
    assert.strictEqual(controls.reservations,0,'one-shot split task does not create daily reservations');
    assert.strictEqual(controls.cached,controls.dayBase+547*60000,'window cache cannot be changed by a caller');
    assert.strictEqual(controls.edited,controls.dayBase+548*60000,'a new solve observes edits to the same item');
    assert.strictEqual(controls.venueFresh,540,'venue cache cannot be changed by a caller');
    assert(controls.blocksFresh,'blocked cache cannot be changed by a caller');
    assert(controls.routeCalls<=512,`route transitions are reused: ${controls.routeCalls} lookups`);
    assert.strictEqual(controls.percentile,2/3,'binary percentile retains duplicate/NaN semantics');
    assert.strictEqual(controls.zoneDay,'2026-09-13','weather formatter respects timezone boundaries');
    const source=fs.readFileSync(path.join(__dirname,'helpers/planner-quality-worker.js'),'utf8');
    const expected={'selection-trap':165,'long-block-trap':270,'short-hole-trap':255};
    for(const s of qualityScenarios().filter(s=>s.id in expected || ['mixed-35','mixed-50'].includes(s.id))){
      const result=await page.evaluate(runPlannerQualityScenario,{scenario:s,workerSource:source,engines:['fast'],repeat:true});
      const [first,repeat]=result.engines.fast;
      assert.deepStrictEqual([...first.violations,...independentViolations(s,first)],[],s.id+' must be legal');
      assert.deepStrictEqual(repeat.rows,first.rows,s.id+' is deterministic');
      if(s.id in expected)assert(first.workMinutes>=expected[s.id],s.id+' repairs the valid GLPK selection witness');
      assert(first.selection.probes<=768 && first.graph.probes<=768,'insertion and selection share the whole-build probe budget');
      if(s.id in expected)assert(first.selection.accepted>0,'crowded day changes its selected subset');
    }
    console.log('PASS specialization: task pools, revision isolation, route lookup bound, selection recovery and complex-week legality');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
