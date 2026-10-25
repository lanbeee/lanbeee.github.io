const assert=require('assert');
const {chromium,BASE,baseHabit,openEveningSettings,runPlannerPair,glpkAvailable}=require('./helpers/planner-test-helpers');
const {qualityScenarios}=require('./helpers/planner-quality-fixtures');
const {independentViolations}=require('./helpers/planner-quality-validation');
const {runPlannerQualityScenario}=require('./helpers/planner-quality-runner');
const fs=require('fs'),path=require('path');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
    const page=await context.newPage();await page.goto(BASE);await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    // A narrow early task can win the scarcity seed without owning today.
    // Recover the single-day deadline by moving that blocker, retaining both.
    const now=new Date('2026-09-14T09:00:00-04:00').getTime(),day=now-9*3600000;
    const deadlineSettings=openEveningSettings({blockedTimes:[
      {label:'night',days:[],start:0,end:540},{label:'end',days:[],start:720,end:1440}
    ]});
    const later=baseHabit({hid:'later',name:'Later',type:'task',target:null,
      dueDate:day+86400000,earlyWindowDays:1,delayAllowanceDays:0,createdAt:day-86400000,
      durationMinutes:60,allowedTimeStart:600,allowedTimeEnd:660,priority:2});
    const urgent=baseHabit({hid:'urgent',name:'Urgent',type:'task',target:null,
      dueDate:day,earlyWindowDays:0,delayAllowanceDays:0,createdAt:day-86400000,
      durationMinutes:120,allowedTimeStart:540,allowedTimeEnd:720,priority:2});
    const glpkOk=await glpkAvailable(page);
    for(const priority of [2,0]){
      const data=[{...later,priority},urgent];
      const result=await runPlannerPair(page,data,deadlineSettings,now,2,true);
      for(const mode of ['fast',...(glpkOk?['glpk']:[])]){
        const r=result[mode];
        if(mode==='glpk')assert(r.optimized,'deadline witness uses a real GLPK solution');
        assert.strictEqual(r.days[0].Urgent,120,mode+' recovers due-today work without dropping higher-priority early work');
        assert.strictEqual(r.days[1].Later,60,mode+' retains early work on its deadline day');
        assert.strictEqual(r.rows[0].find(row=>row.i===1).start,now,'urgent uses the contiguous morning slot');
        assert.strictEqual(r.rows[1].find(row=>row.i===0).start,day+86400000+600*60000,
          'blocker moves to a valid window tomorrow');
      }
      const repeated=await runPlannerPair(page,data,deadlineSettings,now,2,true);
      assert.deepStrictEqual(repeated.fast,result.fast,'deadline recovery is deterministic');
    }
    const reserve=baseHabit({hid:'reserve',name:'Protected work',type:'keepup',target:1,
      durationMinutes:120,breakable:true,minChunkMinutes:60,priority:2,
      allowedTimeStart:540,allowedTimeEnd:720,createdAt:day-86400000});
    const protectedResult=await runPlannerPair(page,[later,urgent,reserve],deadlineSettings,now,2);
    const appointment={...later,hid:'fixed',name:'Fixed appointment',dueDate:day,
      eventTime:day+600*60000,earlyWindowDays:0};
    const fixedResult=await runPlannerPair(page,[appointment,urgent],deadlineSettings,now,2,true);
    const noAlternative=await runPlannerPair(page,
      [{...later,dueDate:day,earlyWindowDays:0,priority:0},urgent],deadlineSettings,now,2);
    for(const mode of ['fast',...(glpkOk?['glpk']:[])]){
      assert.strictEqual(protectedResult[mode].days[0]['Protected work'],120,
        mode+' deadline recovery preserves equal-priority breakable protection');
      assert(!protectedResult[mode].days[0].Urgent,'no urgent insertion through protected time');
      const fixed=fixedResult[mode].rows[0].find(row=>row.kind==='scheduled');
      assert(fixed && fixed.start===appointment.eventTime,'fixed appointment retains its literal clock');
      assert(!fixedResult[mode].days[0].Urgent,'fixed appointment cannot be moved for the deadline');
      assert.strictEqual(noAlternative[mode].days[0].Later,60,'higher-priority blocker retains its deadline');
      assert(!noAlternative[mode].days[0].Urgent,'repair cannot park a blocker beyond its last day');
    }
    // Two individually insufficient ejections must be explored together.
    // Observe the cheap repair so a whole-week replay cannot mask a regression.
    await page.evaluate(()=>{
      const original=insertUnplacedFastGraphChoices;
      window.deadlineRepairProbes=[];
      insertUnplacedFastGraphChoices=(...args)=>{
        const budget=args[5],before=budget.remaining;
        const accepted=original(...args);
        window.deadlineRepairProbes.push({accepted,spent:before-budget.remaining,left:budget.remaining});
        return accepted;
      };
      window.restoreDeadlineRepair=()=>{insertUnplacedFastGraphChoices=original;};
    });
    try{
      const pair=[
        {...later,hid:'early-a',name:'Early A',durationMinutes:30,allowedTimeStart:570,allowedTimeEnd:600},
        {...later,hid:'early-b',name:'Early B',durationMinutes:30,allowedTimeStart:630,allowedTimeEnd:660},
        {...urgent,durationMinutes:150}
      ];
      const recovered=await runPlannerPair(page,pair,deadlineSettings,now,2,true);
      assert.strictEqual(recovered.fast.days[0].Urgent,150,'two blockers release the contiguous deadline slot');
      assert.strictEqual(recovered.fast.days[1]['Early A'],30,'first blocker retained tomorrow');
      assert.strictEqual(recovered.fast.days[1]['Early B'],30,'second blocker retained tomorrow');
      const probes=await page.evaluate(()=>window.deadlineRepairProbes);
      assert(probes.some(p=>p.accepted>0),'bounded insertion/ejection recovers the pair without a week rebuild');
      assert(probes.every(p=>p.spent<=192 && p.left>=0),'all cheap repair probes share the deterministic cap');
      const repeated=await runPlannerPair(page,pair,deadlineSettings,now,2,true);
      assert.deepStrictEqual(repeated.fast,recovered.fast,'pair recovery is deterministic');
      const closed={...deadlineSettings,blockedTimes:[...deadlineSettings.blockedTimes,
        {label:'tomorrow closed',days:[2],start:540,end:720}]};
      const failed=await runPlannerPair(page,pair,closed,now,2,true);
      assert(!failed.fast.days[0].Urgent,'cannot evict blockers when neither destination is feasible');
      assert.strictEqual(failed.fast.days[0]['Early A'],30,'failed transaction retains first blocker');
      assert.strictEqual(failed.fast.days[0]['Early B'],30,'failed transaction retains second blocker');
    }finally{await page.evaluate(()=>window.restoreDeadlineRepair());}
    const transferGuards=await page.evaluate(({base,settings})=>{
      const RealDate=Date,now=new RealDate(2026,8,14,9).getTime(),ms=86400000;
      globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
      try{
        const day=dayStart(now);
        const check=(laterOffset,target=2)=>{
          const data=normalize([
            {...base,hid:'sparse',name:'Sparse',type:'keepup',target,lastLog:day-ms,
              logs:[day-ms],earlyWindowDays:2,delayAllowanceDays:0,durationMinutes:30,
              allowedTimeStart:570,allowedTimeEnd:600},
            {...base,hid:'urgent',name:'Urgent',type:'task',target:null,dueDate:day,
              durationMinutes:150,allowedTimeStart:540,allowedTimeEnd:720},
            {...base,hid:'neighbor',name:'Neighbor',type:'task',target:null,dueDate:day,
              durationMinutes:30,allowedTimeStart:690,allowedTimeEnd:720}
          ]);
          save(data);saveSortSettings(settings);Object.assign(sortSettings,settings);beginPlannerSolveCaches(data);
          const dates=[day,day+ms,day+laterOffset*ms];
          const candidates=data.map((h,i)=>({h,i,priority:2,urgency:100,
            eligible:new Set(i===0?dates:[day]),pinned:i===2}));
          const states=dates.map(dayBase=>createDayPlacementState(
            buildDayAgenda(data,settings,dayBase,{weekMode:true,now}),settings,{dayBase,now,weekMode:true}));
          const put=(state,c)=>{
            const fill={h:c.h,i:c.i,priority:2};
            const fit=tryPlaceOnDay(state,fill,{settings,allowNetwork:false});
            if(!fit)throw new Error('transfer guard fixture cannot fit');
            commitPlacement(state,fill,fit);syncDayAgendaItemsFromFills(state);
          };
          put(states[0],candidates[0]);put(states[0],candidates[2]);put(states[2],candidates[0]);
          const before=JSON.stringify(states.map(s=>s.fills));
          const clock=state=>{const e=state.fills.find(e=>e.fill.i===2);
            return [e.fit.placeStart,e.fit.placeEnd,e.fit.locId];};
          const neighbor=JSON.stringify(clock(states[0]));
          const budget={remaining:192,searches:0,accepted:0};
          const accepted=insertUnplacedFastGraphChoices([candidates[1]],candidates,states,settings,c=>c.pinned,budget);
          return {accepted,unchanged:before===JSON.stringify(states.map(s=>s.fills)),
            neighbor:neighbor===JSON.stringify(clock(states[0])),
            sparse:states.map(s=>s.fills.filter(e=>e.fill.i===0).length),remaining:budget.remaining};
        };
        return {valid:check(3),invalid:check(2),early:check(4,3)};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{base:baseHabit({priority:2,createdAt:day-86400000}),settings:deadlineSettings});
    assert.strictEqual(transferGuards.valid.accepted,1,'sparse blocker can move when subsequent cadence remains valid');
    assert.deepStrictEqual(transferGuards.valid.sparse,[0,1,1],'both sparse occurrences survive');
    assert(transferGuards.valid.neighbor,'pinned neighbor retains its clock and venue during ejection');
    assert.strictEqual(transferGuards.invalid.accepted,0,'reject moving a sparse blocker too close to its next occurrence');
    assert(transferGuards.invalid.unchanged,'cadence rejection leaves the incumbent untouched');
    assert.strictEqual(transferGuards.early.accepted,1,'initial early-window permission survives cadence validation');
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
