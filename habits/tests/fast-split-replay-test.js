const assert=require('assert');
const {chromium,BASE,baseHabit,plannerSettings,runPlannerPair,glpkAvailable}=require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York',serviceWorkers:'block'});
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    const now=Date.parse('2026-10-20T07:41:00-04:00'),day=now-461*60000,ms=86400000;
    const data=[
      baseHabit({hid:'review',name:'Weekly review',target:7,logs:[day-8*ms],
        durationMinutes:30,allowedTimeStart:1305,allowedTimeEnd:780,priority:2}),
      baseHabit({hid:'work',name:'Daily work',target:1,logs:[day-ms],priority:0,
        durationMinutes:360,breakable:true,minChunkMinutes:45,
        allowedTimeStart:520,allowedTimeEnd:910}),
      baseHabit({hid:'midday',name:'Midday break',target:1,logs:[day-ms],priority:1,
        durationMinutes:30,allowedTimeStart:780,allowedTimeEnd:810}),
      baseHabit({hid:'morning',name:'Morning break',target:1,logs:[day-ms],priority:1,
        durationMinutes:10,allowedTimeStart:510,allowedTimeEnd:520})
    ];
    const settings=plannerSettings([
      {label:'morning',days:[],start:0,end:480},
      {label:'night',days:[],start:1080,end:1440}
    ]);
    const result=await page.evaluate(({data,settings,now})=>{
      const RealDate=Date;
      globalThis.Date=class extends RealDate{
        constructor(...args){super(...(args.length?args:[now]));}
        static now(){return now;}
      };
      try{
        data=normalize(data);save(data);saveSortSettings(settings);sortSettings=settings;
        beginPlannerSolveCaches(data);
        const day=dayStart(now);
        const make=()=>{
          const states=[day,day+86400000].map(dayBase=>createDayPlacementState(
            buildDayAgenda(data,settings,dayBase,{weekMode:true,now}),
            settings,{dayBase,now,weekMode:true}));
          const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:130,
            eligible:new Set(states.map(s=>s.dayBase))}));
          for(const state of states){
            for(const i of [2,3]){
              const fill={h:data[i],i,priority:data[i].priority};
              commitPlacement(state,fill,tryPlaceOnDay(state,fill,{settings,allowNetwork:false}));
            }
            placeBreakableSessions(state,{h:data[1],i:1,priority:0},{settings,allowNetwork:false});
          }
          const fill={h:data[0],i:0,priority:2};
          commitPlacement(states[1],fill,tryPlaceOnDay(states[1],fill,{settings,allowNetwork:false}));
          states.forEach(syncDayAgendaItemsFromFills);
          return {states,candidates,fill};
        };
        const {states,candidates,fill}=make();
        const chunks=states.map(s=>s.fills.filter(e=>e.fill.i===1).length);
        const before=JSON.stringify(states[1]);
        const replay=rebuildDayFromFills(states[1],states[1].fills.map(e=>e.fill),candidates,
          {settings,allowNetwork:false});
        const replayIsolated=JSON.stringify(states[1])===before;
        const direct=tryPlaceOnDay(states[0],fill,{settings,allowNetwork:false});
        // Recovery of an existing gap must also work with no graph budget.
        const budget={remaining:0,searches:0,accepted:0};
        const moved=pullStrictDueMovablesForward(candidates,states,settings,budget);
        const rows=states.map(s=>s.fills.filter(e=>e.fill.i===0)
          .map(e=>[(e.fit.placeStart-s.dayBase)/60000,(e.fit.placeEnd-s.dayBase)/60000]));
        const minutes=states.map(s=>placedBreakableMinutes(s,1));
        const again=pullStrictDueMovablesForward(candidates,states,settings,budget);
        // A physically short gap still fails transactionally.
        const tight=make();
        tight.states[0].startClock=day+481*60000;
        const tightBefore=tight.states.map(s=>JSON.stringify(s));
        const rejected=pullStrictDueMovablesForward(tight.candidates,tight.states,settings,budget);
        return {chunks,replayOk:!!replay,replayIsolated,
          replayMinutes:replay && placedBreakableMinutes(replay,1),direct:!!direct,
          moved,rows,minutes,again,searches:budget.searches,rejected,
          tightUnchanged:tight.states.every((s,i)=>JSON.stringify(s)===tightBefore[i])};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{data,settings,now});
    assert(result.chunks.every(n=>n===2),'fixture splits both daily allocations into two chunks');
    assert(result.replayOk,'replaying multiple chunks of one rhythm must not reject a feasible day');
    assert(result.replayIsolated,'speculative replay leaves its incumbent unchanged');
    assert.strictEqual(result.replayMinutes,360,'replay spends the daily budget only once');
    assert(result.direct,'today has a feasible untouched gap');
    assert.strictEqual(result.moved,1,'recover the overdue occurrence from the split-work day');
    assert.deepStrictEqual(result.rows,[[[480,510]],[]],'move once into 8:00–8:30; remove tomorrow’s copy');
    assert.deepStrictEqual(result.minutes,[360,360],'retain all daily work on both dates');
    assert.strictEqual(result.again,0,'recovery is idempotent');
    assert.strictEqual(result.searches,0,'direct-gap recovery needs no graph search');
    assert.strictEqual(result.rejected,0,'a 29-minute gap cannot hold 30 minutes');
    assert(result.tightUnchanged,'failed recovery leaves both dates intact');

    const glpkOk=await glpkAvailable(page);
    for(const minute of [31,36,41]){
      const pair=await runPlannerPair(page,data,settings,day+(420+minute)*60000,3);
      for(const [mode,r] of Object.entries(pair)){
        if(!r || (mode==='glpk' && !glpkOk))continue;
        assert(!r.error,mode+': '+r.error);
        if(mode==='glpk')assert(r.optimized,'comparison uses a real GLPK incumbent');
        assert.strictEqual(r.days[0]['Weekly review'],30,mode+' fits the due occurrence at 7:'+minute);
        for(const d of r.days)assert.strictEqual(d['Daily work'],360,mode+' retains daily work');
      }
    }
    console.log('PASS split-rhythm replay: overdue gap recovery, daily budgets, isolation, rollback and both engines');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
