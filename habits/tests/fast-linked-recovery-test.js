// Atomic linked recovery: due-day movement, no-space rollback and frozen plans.
const assert=require('assert');
const {chromium,BASE,baseHabit,openEveningSettings,runPlannerPair,glpkAvailable}=require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
    const page=await context.newPage();await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    const result=await page.evaluate(({base,settings})=>{
      const RealDate=Date,now=new Date(2026,9,3,16,28).getTime();
      globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
      const day=dayStart(now);
      try{
        const make=({end=1439,planned=false,closedWindow=false}={})=>{
          const data=normalize([
            {...base,hid:'activity',name:'Activity',target:3,logs:[day-3*86400000],priority:1,
              durationMinutes:45,preferredTimeStart:1020,preferredTimeEnd:1380},
            {...base,hid:'recovery',name:'Recovery',target:2.5,logs:[day-86400000],priority:2,
              durationMinutes:5,earlyWindowDays:3,scheduleLinks:[
                {anchorHid:'activity',direction:'after',adjacency:'direct',requireSameDay:true}
              ]},
            {...base,hid:'neighbor',name:'Neighbor',target:1,logs:[day-86400000],priority:2,
              durationMinutes:60,allowedTimeStart:988,allowedTimeEnd:1100}
          ]);
          const cfg={...settings,blockedTimes:[{label:'morning',days:[],start:0,end:988},
            {label:'night',days:[],start:end,end:1440}]};
          const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:100,pinned:planned && i===0,
            pinnedDay:planned && i===0 ? day+86400000 : null,eligible:new Set([day,day+86400000,day+3*86400000])}));
          if(closedWindow){
            // A closed allowed window must reject recovery.
            data[1].allowedTimeStart=0;data[1].allowedTimeEnd=30;
          }
          save(data);saveSortSettings(cfg);Object.assign(sortSettings,cfg);beginPlannerSolveCaches(data);
          const states=[day,day+86400000,day+3*86400000].map(dayBase=>createDayPlacementState(
            buildDayAgenda(data,cfg,dayBase,{weekMode:true,now}),cfg,{dayBase,now,weekMode:true}));
          const put=(state,c)=>{const fill={h:c.h,i:c.i,priority:c.priority};
            const fit=tryPlaceOnDay(state,fill,{settings:cfg,allowNetwork:false});
            if(!fit)throw new Error('fixture placement failed');commitPlacement(state,fill,fit);syncDayAgendaItemsFromFills(state);};
          put(states[0],candidates[2]);put(states[1],candidates[0]);
          if(!closedWindow)put(states[1],candidates[1]);
          // A later cadence occurrence must survive moving the first pair.
          if(!closedWindow){put(states[2],candidates[0]);put(states[2],candidates[1]);}
          const before=states.map(s=>JSON.stringify(s.fills));
          const neighbor=states[0].fills.map(e=>[e.fill.i,e.fit.placeStart,e.fit.placeEnd]);
          const budget={remaining:0,linkRemaining:96,linkAccepted:0};
          const moved=pullStrictDueMovablesForward(candidates,states,cfg,budget);
          const rows=states.map(s=>s.fills.map(e=>({hid:e.fill.h.hid,start:e.fit.placeStart,end:e.fit.placeEnd})));
          const unchanged=states.every((s,i)=>JSON.stringify(s.fills)===before[i]);
          const frozen=neighbor.every(([i,start,end])=>states[0].fills.some(e=>e.fill.i===i && e.fit.placeStart===start && e.fit.placeEnd===end));
          endPlannerSolveCaches();return {moved,rows,unchanged,frozen,probes:96-budget.linkRemaining,
            paired:rows[0].some(a=>a.hid==='activity' && rows[0].some(b=>b.hid==='recovery' && b.start===a.end))};
        };
        return {normal:make(),tight:make({end:1097}),planned:make({planned:true}),closedWindow:make({closedWindow:true})};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{base:baseHabit({}),settings:openEveningSettings()});
    assert(result.normal.paired,'due sparse occurrence and required partner move to today together');
    assert.strictEqual(result.normal.moved,1);
    assert(result.normal.frozen,'unrelated committed clocks are preserved');
    assert(!result.normal.rows[1].some(r=>['activity','recovery'].includes(r.hid)),'old pair is removed atomically');
    assert(result.normal.rows[2].some(r=>r.hid==='activity') && result.normal.rows[2].some(r=>r.hid==='recovery'),'subsequent cadence pair survives');
    assert(result.tight.unchanged,'too-short day rolls back both dates');
    assert(result.planned.unchanged,'explicit future plan stays on its date');
    assert(result.closedWindow.unchanged,'closed partner window cannot produce a half pair');
    for(const item of Object.values(result))assert(item.probes<=96,'coupled recovery obeys its shared budget');
    const chain=await page.evaluate(({base,settings})=>{
      const RealDate=Date,now=new Date(2026,9,6,10,34).getTime(),ms=86400000;
      globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
      const day=dayStart(now);
      try{
        const make=({reverse=false,daily=false,end=1399,planned=false,closedWindow=false,protectLater=false,
          linkedExtra=false,missingExtraPartner=false}={})=>{
          const data=normalize([
            {...base,hid:'activity',name:'Activity',type:'reduce',target:daily?1:3,logs:[day-(daily?1:3)*ms],
              priority:1,durationMinutes:45,preferredTimeStart:1020,preferredTimeEnd:1380,
              scheduleLinks:reverse?[{anchorHid:'recovery',direction:'before',adjacency:'direct',requireSameDay:true}]:[]},
            {...base,hid:'recovery',name:'Recovery',target:daily?1:2.5,logs:[day-ms],earlyWindowDays:3,
              priority:2,durationMinutes:5,scheduleLinks:reverse?[]:[
                {anchorHid:'activity',direction:'after',adjacency:'direct',requireSameDay:true}]},
            {...base,hid:'finish',name:'Finish',target:7,logs:[day-7*ms],priority:4,durationMinutes:10,
              scheduleLinks:[{anchorHid:'recovery',direction:'after',adjacency:'direct',requireSameDay:false}]},
            {...base,hid:'work',name:'Work',target:1,logs:[day-ms],priority:0,durationMinutes:360,
              breakable:true,minChunkMinutes:45,allowedTimeStart:510,allowedTimeEnd:1200},
            ...(protectLater?[{...base,hid:'source-obligation',name:'Source obligation',target:1,
              logs:[day-ms],durationMinutes:10,scheduleLinks:[
                {anchorHid:'recovery',direction:'after',adjacency:'sometime',requireSameDay:true}]}]:[]),
            ...(linkedExtra?[{...base,hid:'extra-partner',name:'Extra partner',type:'reduce',target:3,
              logs:[day-3*ms],durationMinutes:10}]:[])
          ]);
          if(linkedExtra)data[1].scheduleLinks.push({anchorHid:'extra-partner',direction:'before',
            adjacency:'sometime',requireSameDay:true});
          const cfg={...settings,blockedTimes:[{label:'night',days:[],start:end,end:1440}]};
          save(data);saveSortSettings(cfg);Object.assign(sortSettings,cfg);beginPlannerSolveCaches(data);
          const states=[day,day+ms,day+4*ms,...(linkedExtra?[day+5*ms]:[])].map(dayBase=>createDayPlacementState(
            buildDayAgenda(data,cfg,dayBase,{weekMode:true,now}),cfg,{dayBase,now,weekMode:true}));
          const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:100,pinned:planned && i===2,
            pinnedDay:planned && i===2?day:null,eligible:new Set(states.map(s=>s.dayBase))}));
          const put=(state,i,start)=>{
            const fill={h:data[i],i,priority:data[i].priority},slots=state.slots;
            if(start!=null)state.slots=slots.map(s=>({...s,start:Math.max(s.start,state.dayBase+start*60000)}))
              .filter(s=>s.end>s.start);
            const fit=tryPlaceOnDay(state,fill,{settings:cfg,allowNetwork:false,earliestFromAnchor:true});
            state.slots=slots;
            if(!fit)throw new Error('chain fixture placement failed');
            commitPlacement(state,fill,fit);syncDayAgendaItemsFromFills(state);
          };
          put(states[0],2,635);put(states[0],3,645);
          for(const state of states.slice(1,3)){put(state,0);put(state,1);}
          if(linkedExtra){
            put(states[3],1);if(!missingExtraPartner)put(states[3],4);
            candidates[4].eligible=new Set([day+5*ms]);
          }
          if(protectLater){for(const state of states.slice(1))put(state,4);
            candidates[4].eligible=new Set([day+ms,day+4*ms]);}
          if(closedWindow){data[1].allowedTimeStart=0;data[1].allowedTimeEnd=30;}
          const before=states.map(s=>JSON.stringify(s.fills));
          const work=states[0].fills.find(e=>e.fill.i===3);
          const diagnostics=improveFastGraphTodayChoices(candidates,states,cfg,{maxProbes:96});
          const unchanged=states.every((s,i)=>JSON.stringify(s.fills)===before[i]);
          const rows=states.map(s=>finalizePlacementRows(s).filter(r=>r.kind==='fill')
            .map(r=>({hid:r.h.hid,start:r.start,end:r.end})));
          const a=rows[0].find(r=>r.hid==='activity'),b=rows[0].find(r=>r.hid==='recovery'),c=rows[0].find(r=>r.hid==='finish');
          return {diagnostics,rows,paired:Boolean(a && b && c && a.end===b.start && b.end===c.start),
            unchanged,
            workFrozen:rows[0].some(r=>r.hid==='work' && r.start===work.fit.placeStart && r.end===work.fit.placeEnd),
            violations:states.map(s=>[...persistentLinkViolationsForState(s)])};
        };
        return {normal:make(),reverse:make({reverse:true}),daily:make({daily:true}),tight:make({end:1040}),
          planned:make({planned:true}),closedWindow:make({closedWindow:true}),protectLater:make({protectLater:true}),
          linkedExtra:make({linkedExtra:true}),missingExtraPartner:make({linkedExtra:true,missingExtraPartner:true})};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{base:baseHabit({}),settings:openEveningSettings()});
    for(const mode of ['normal','reverse','daily','linkedExtra']){
      const r=chain[mode];
      assert(r.paired,mode+' recovers the entire chain despite an early claimed successor');
      assert(r.workFrozen,mode+' retains all daily Work and its clocks');
      assert(r.rows[2].some(row=>row.hid==='activity') && r.rows[2].some(row=>row.hid==='recovery'),
        mode+' retains the later cadence cycle');
      assert(r.violations.every(v=>!v.length),mode+' preserves every persistent link');
    }
    assert(!chain.normal.rows[1].some(r=>['activity','recovery'].includes(r.hid)),
      'sparse recovery transfers rather than duplicates the source pair');
    assert(chain.daily.rows[1].some(r=>r.hid==='activity') && chain.daily.rows[1].some(r=>r.hid==='recovery'),
      'daily recovery adds today without stealing tomorrow\'s obligations');
    assert(chain.linkedExtra.rows[3].some(r=>r.hid==='recovery') && chain.linkedExtra.rows[3].some(r=>r.hid==='extra-partner'),
      'existing must-do rep beside a reduce partner survives despite a shorter-than-rhythm gap');
    for(const mode of ['tight','planned','closedWindow','protectLater','missingExtraPartner'])
      assert(chain[mode].unchanged,mode+' rolls back both dates atomically');
    for(const r of Object.values(chain))assert(r.diagnostics.probes<=96,'chain recovery shares the capped budget');
    // Complete week regression: the greedy seed claims Finish today and the
    // pair tomorrow. GLPK's incumbent and Fast's final recovery both fit all
    // three today without reducing the protected daily breakable.
    const now=Date.parse('2026-10-06T10:34:00-04:00'),day=now-634*60000,ms=86400000;
    const data=[
      baseHabit({hid:'activity',name:'Activity',type:'reduce',target:3,delayAllowanceDays:1,
        preferredWeekdays:[3],logs:[day-3*ms],priority:1,durationMinutes:45,
        preferredTimeStart:1020,preferredTimeEnd:1380}),
      baseHabit({hid:'recovery',name:'Recovery',target:2.5,earlyWindowDays:3,delayAllowanceDays:3,
        logs:[day-3*ms],priority:2,durationMinutes:5,scheduleLinks:[
          {anchorHid:'activity',direction:'after',adjacency:'direct',requireSameDay:true}]}),
      baseHabit({hid:'finish',name:'Finish',target:7,logs:[day-7*ms],priority:4,durationMinutes:10,
        scheduleLinks:[{anchorHid:'recovery',direction:'after',adjacency:'direct',requireSameDay:false}]}),
      baseHabit({hid:'work',name:'Work',target:1,logs:[day-ms],priority:0,durationMinutes:360,
        breakable:true,minChunkMinutes:45,allowedTimeStart:510,allowedTimeEnd:1200})
    ];
    const cfg=openEveningSettings({blockedTimes:[{label:'night',days:[],start:1399,end:1440}]});
    await page.evaluate(({data,cfg})=>{save(normalize(data));saveSortSettings(cfg);Object.assign(sortSettings,cfg);},{data,cfg});
    const glpkOk=await glpkAvailable(page);
    const pair=await runPlannerPair(page,data,cfg,now);
    for(const [mode,r] of Object.entries(pair)){
      if(!r || (mode==='glpk' && !glpkOk))continue;
      if(mode==='glpk')assert(r.optimized,'reference is a real GLPK incumbent');
      assert.deepStrictEqual(r.days[0],{Work:360,Activity:45,Recovery:5,Finish:10},mode+' fits the complete chain today');
    }
    console.log('PASS linked recovery: due pair, cadence preservation, frozen neighbors, atomic rollback and plans');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
