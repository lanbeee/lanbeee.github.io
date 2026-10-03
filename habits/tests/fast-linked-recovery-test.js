// Atomic linked recovery: due-day movement, no-space rollback and frozen plans.
const assert=require('assert');
const {chromium,BASE,baseHabit,openEveningSettings}=require('./helpers/planner-test-helpers');
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
    console.log('PASS linked recovery: due pair, cadence preservation, frozen neighbors, atomic rollback and plans');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
