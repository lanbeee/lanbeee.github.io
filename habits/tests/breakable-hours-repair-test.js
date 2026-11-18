const assert = require('node:assert/strict');
const {chromium, BASE, baseHabit, plannerSettings} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE,{waitUntil:'networkidle'});
    const settings = plannerSettings([]);
    const habits = [
      baseHabit({hid:'work',name:'Focused hours',target:1,priority:0,breakable:true,
        durationMinutes:80,minChunkMinutes:60,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'first',name:'Flexible visit',type:'task',target:null,priority:2,
        durationMinutes:15,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'second',name:'Flexible pickup',type:'task',target:null,priority:3,
        durationMinutes:15,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'anchor',name:'Narrow daily anchor',target:1,priority:0,
        durationMinutes:15,allowedTimeStart:525,allowedTimeEnd:540}),
      baseHabit({hid:'warmup',name:'Flexible daily anchor',target:1,priority:0,
        durationMinutes:15,allowedTimeStart:510,allowedTimeEnd:540,
        preferredTimeStart:525,preferredTimeEnd:540})
    ];
    const results = await page.evaluate(({habits,settings})=>{
      const RealDate = Date;
      const now = new RealDate(2026,10,17,8).getTime();
      const firstDay = dayStart(now);
      const secondDay = offsetCalendarDay(firstDay,1);
      const clock = (day,minute)=>day + minute * 60000;
      globalThis.Date = class extends RealDate{
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      beginPlannerSolveCaches(habits);
      try{
        const makeState = (dayBase)=>createDayPlacementState({
          dayBase,weekday:new Date(dayBase).getDay(),agendaItems:[],scheduled:[],totalMinutes:250,
          slots:[{start:clock(dayBase,510),end:clock(dayBase,690)}]
        },settings);
        const place = (state,c,start)=>{
          const fill = {h:c.h,i:c.i,priority:c.priority};
          const fit = auditFillFitInGap(state,fill,{
            start:clock(state.dayBase,start),end:clock(state.dayBase,start+c.h.durationMinutes)
          },state.remaining);
          if(!fit)throw new Error(`Invalid test fixture for ${c.h.name}`);
          fit.placeKey = c.i;
          commitPlacement(state,fill,fit);
        };
        const trial = ({strict = false, unavailable = false} = {})=>{
          const source = makeState(firstDay);
          const target = makeState(secondDay);
          const candidates = habits.map((habit,i)=>{
            const h = {...habit};
            if(i === 1 || i === 2)h.dueDate = strict && i === 2 ? firstDay : secondDay;
            const days = i === 0 || i > 2 || (unavailable && i === 2)
              ? [firstDay] : [firstDay,secondDay];
            return {h,i,priority:h.priority,eligible:new Set(days)};
          });
          // The whole-day greedy replay tries the flexible anchor first and
          // can consume the narrow anchor's only valid time.
          place(source,candidates[4],510);
          place(source,candidates[3],525);
          place(source,candidates[1],555);
          place(source,candidates[2],590);
          placeBreakableSessions(source,{h:candidates[0].h,i:0,priority:0},{settings});
          const summarize = state=>state.fills.map(({fill,fit})=>[
            fill.i,Math.round((fit.placeStart-state.dayBase)/60000),fit.durMin
          ]).sort((a,b)=>a[1]-b[1]);
          const before = summarize(source);
          const moves = repairWeekPlacedHours(candidates,[source,target],settings);
          return {before,moves,source:summarize(source),target:summarize(target)};
        };
        const repair = trial();
        const strict = trial({strict:true});
        const unavailable = trial({unavailable:true});
        saveOrderConstraintsForDrop(firstDay,[{
          beforeHid:'anchor',afterHid:'first',adjacency:'sometime'
        }]);
        beginPlannerSolveCaches(habits);
        const linked = trial();
        const week = rows=>({days:[
          {timeline:[]},{timeline:rows},{timeline:[]}
        ]});
        const futureFill = (i,start,minutes)=>({
          kind:'fill',i,start:clock(secondDay,start),end:clock(secondDay,start + minutes)
        });
        const before = week([futureFill(1,540,15)]);
        const after = week([futureFill(0,540,80),futureFill(1,620,15)]);
        return {repair,strict,unavailable,linked,
          futureRefinement:homeAgendaRefinementIsBetter(before,after,habits,settings)};
      }finally{
        endPlannerSolveCaches();
        globalThis.Date = RealDate;
      }
    },{habits,settings});
    assert.deepEqual(results.repair.before,[[4,510,15],[3,525,15],[1,555,15],[2,590,15]]);
    assert.equal(results.repair.moves,2);
    assert.deepEqual(results.repair.source,[[4,510,15],[3,525,15],[0,540,80]]);
    assert.deepEqual(results.repair.target.map(row=>row[0]).sort(),[1,2]);
    for(const control of [results.strict,results.unavailable,results.linked]){
      assert.equal(control.moves,0);
      assert.deepEqual(control.source,control.before);
      assert.deepEqual(control.target,[]);
    }
    assert.equal(results.futureRefinement,true);
    console.log('Two blockers move together without changing anchors. Deadlines, links and missing destinations prevent a move. Future P0 gains qualify for refinement.');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
