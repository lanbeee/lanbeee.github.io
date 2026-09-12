const assert = require('assert');
const {chromium,BASE,baseHabit,openEveningSettings} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof fastGraphPlacement === 'function');
    const settings = openEveningSettings({blockedTimes:[
      {label:'night',days:[],start:0,end:540},
      {label:'end',days:[],start:720,end:1440}
    ]});
    const data = [
      baseHabit({hid:'a',name:'A',type:'task',durationMinutes:60,allowedTimeStart:540,allowedTimeEnd:720}),
      baseHabit({hid:'b',name:'B',type:'task',durationMinutes:60,allowedTimeStart:600,allowedTimeEnd:720}),
      baseHabit({hid:'c',name:'C',type:'task',durationMinutes:60,allowedTimeStart:540,allowedTimeEnd:600})
    ];
    const result = await page.evaluate(({settings,data})=>{
      const dayBase = dayStart(Date.now());
      const now = dayBase + 540*60000;
      data.forEach(h=>h.dueDate=dayBase);
      const day = buildDayAgenda(data,settings,dayBase,{weekMode:true,now,fullDay:true});
      const state = createDayPlacementState(day,settings,{dayBase,now,startClock:now,weekMode:true});
      const candidates = data.map((h,i)=>({h,i,priority:2,urgency:100,eligible:new Set([dayBase])}));
      beginPlannerSolveCaches(data);
      try{
        for(const fill of candidates.slice(0,2))commitPlacement(state,fill,tryPlaceOnDay(state,fill,{settings}));
        const before = JSON.stringify(state);
        const direct = tryPlaceOnDay(state,candidates[2],{settings});
        const budget = {remaining:768,searches:0,accepted:0};
        const proposal = fastGraphPlacement(state,candidates[2],{settings},candidates,[state],budget);
        const again = fastGraphPlacement(state,candidates[2],{settings},candidates,[state],{remaining:768,searches:0,accepted:0});
        const summary = p=>p && p.replacement && p.replacement.fills.map(e=>[e.fill.i,(e.fit.placeStart-dayBase)/60000,(e.fit.placeEnd-dayBase)/60000]).sort();
        // Impossible extra work must leave the incumbent untouched too.
        const impossible = {...candidates[2],h:{...data[2],durationMinutes:240}};
        const failed = fastGraphPlacement(state,impossible,{settings},candidates,[state],{remaining:768,searches:0,accepted:0});
        const originalOrder = plannerOrderConstraintsForDay;
        let linked;
        try{
          plannerOrderConstraintsForDay = ()=>[{beforeHid:'a',afterHid:'b',adjacency:'direct'}];
          linked = fastGraphPlacement(state,candidates[2],{settings},candidates,[state],{remaining:768,searches:0,accepted:0});
        }finally{plannerOrderConstraintsForDay=originalOrder;}
        const exhausted = fastGraphPlacement(state,candidates[2],{settings},candidates,[state],{remaining:0,searches:0,accepted:0});
        return {direct:Boolean(direct),rows:summary(proposal),repeat:summary(again),
          linked:Boolean(linked),unchanged:before===JSON.stringify(state),failed:Boolean(failed),exhausted:Boolean(exhausted),budget};
      }finally{endPlannerSolveCaches();}
    },{settings,data});
    assert.strictEqual(result.direct,false,'greedy insertion is blocked');
    assert.deepStrictEqual(result.rows,[[0,600,660],[1,660,720],[2,540,600]],'graph moves two earlier decisions and retains all work');
    assert.deepStrictEqual(result.repeat,result.rows,'deterministic graph path');
    assert(result.unchanged,'speculative branches do not mutate the incumbent');
    assert(!result.failed && !result.exhausted,'infeasible/exhausted search preserves incumbent');
    assert(!result.linked,'graph cannot separate a direct linked pair to make room');
    assert(result.budget.remaining>=0 && result.budget.accepted===1,'bounded search finds a complete path');
    const integration = await page.evaluate(({settings,base})=>{
      const RealDate = Date;
      const now = new RealDate(2026,8,14,9).getTime();
      class FrozenDate extends RealDate {
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      }
      const graph = fastGraphPlacement;
      globalThis.Date = FrozenDate;
      try{
        settings.blockedTimes[1].start = 840;
        const specs = [[60,630,720],[30,570,630],[90,630,810],[30,600,720],[60,540,690]];
        const data = specs.map(([durationMinutes,allowedTimeStart,allowedTimeEnd],i)=>({
          ...base,hid:`chain-${i}`,name:`chain-${i}`,type:'task',target:null,priority:3,
          dueDate:dayStart(now),durationMinutes,allowedTimeStart,allowedTimeEnd
        }));
        const rows = week=>week.days[0].timeline.filter(row=>row.kind === 'fill')
          .map(row=>[row.i,(row.start-dayStart(now))/60000,(row.end-dayStart(now))/60000]);
        fastGraphPlacement = (state,fill,opts)=>{
          const fit = tryPlaceOnDay(state,fill,opts);
          return fit ? {fit,replacement:null} : null;
        };
        const greedy = rows(buildWeekAgenda(data,settings,1));
        fastGraphPlacement = graph;
        const started = performance.now();
        const week = buildWeekAgenda(data,settings,1);
        const elapsed = performance.now()-started;
        const next = rows(week);
        const repeat = rows(buildWeekAgenda(data,settings,1));
        return {greedy,next,repeat,elapsed,diagnostics:week.fastGraphDiagnostics,
          legal:next.every(([i,start,end])=>start>=specs[i][1] && end<=specs[i][2])
            && next.every((row,i)=>!i || next[i-1][2]<=row[1])};
      }finally{globalThis.Date=RealDate;fastGraphPlacement=graph;}
    },{settings,base:baseHabit({})});
    assert.strictEqual(integration.greedy.length,4,'fixture exposes the original fast planner omission');
    assert.strictEqual(integration.next.length,5,'public week planner recovers all five tasks');
    assert(integration.legal,'public result respects windows and non-overlap');
    assert.deepStrictEqual(integration.repeat,integration.next,'public planner is deterministic');
    console.log(`Graph integration: 4 → 5 tasks, ${integration.diagnostics.probes} probes, ${integration.elapsed.toFixed(1)}ms`);
    const holistic = await page.evaluate(({base,settings})=>{
      const RealDate = Date;
      const now = new RealDate(2026,8,14,9).getTime();
      globalThis.Date = class extends RealDate {
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      const graph = improveFastGraphWeek;
      try{
        const specs = [
          [90,570,720,0,[1,2,3]], [90,540,660,1,[1,2]],
          [90,630,720,1,[1,2,3]], [30,600,660,0,[1,2]],
          [30,570,720,2,[1,2,3]], [90,540,660,1,[1,2]],
          [60,630,720,1,[1,2,3]]
        ];
        const data = specs.map(([durationMinutes,allowedTimeStart,allowedTimeEnd,priority,allowedWeekdays],i)=>({
          ...base,hid:`week-${i}`,name:`week-${i}`,type:'task',target:null,
          dueDate:dayStart(now)+2*86400000,earlyWindowDays:2,
          durationMinutes,allowedTimeStart,allowedTimeEnd,priority,allowedWeekdays
        }));
        const rows = week=>week.days.map(day=>day.timeline.filter(row=>row.kind === 'fill')
          .map(row=>[row.i,(row.start-day.dayBase)/60000,(row.end-day.dayBase)/60000]));
        improveFastGraphWeek = ()=>({});
        const seed = rows(buildWeekAgenda(data,settings,7));
        improveFastGraphWeek = graph;
        const started = performance.now();
        const week = buildWeekAgenda(data,settings,7);
        const elapsed = performance.now()-started;
        const result = rows(week);
        const repeat = rows(buildWeekAgenda(data,settings,7));
        improveFastGraphWeek = (...args)=>graph(...args,{maxEvaluations:0});
        const exhausted = rows(buildWeekAgenda(data,settings,7));
        const legal = result.every((day,offset)=>day.every(([i,start,end],j)=>{
          const spec = specs[i];
          return offset<=2 && spec[4].includes(offset+1) && start>=spec[1]
            && end<=spec[2] && end-start===spec[0] && (!j || day[j-1][2]<=start);
        }));
        return {seed,result,repeat,exhausted,legal,elapsed,diagnostics:week.fastWeekGraphDiagnostics};
      }finally{globalThis.Date=RealDate;improveFastGraphWeek=graph;}
    },{base:baseHabit({}),settings});
    assert.strictEqual(holistic.seed.flat().length,6,'day-local seed misses a task');
    assert.strictEqual(holistic.result.flat().length,7,'whole-week search recovers the seventh task');
    assert.strictEqual(new Set(holistic.result.flat().map(row=>row[0])).size,7,'one-shot tasks are not duplicated across days');
    assert(holistic.legal,'whole-week result respects hours, weekdays, duration, early/deadline window and non-overlap');
    assert.deepStrictEqual(holistic.result,holistic.repeat,'whole-week graph is deterministic');
    assert.deepStrictEqual(holistic.seed,holistic.exhausted,'zero week-search budget preserves seed');
    assert(holistic.diagnostics.evaluated<=24 && holistic.diagnostics.depth<=3,'whole-week search is bounded');
    const cadence = await page.evaluate(({base,settings})=>{
      const RealDate = Date;
      const now = new RealDate(2026,8,14,9).getTime();
      globalThis.Date = class extends RealDate {
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      try{
        const data = [
          {...base,hid:'sparse',name:'Sparse',target:3,durationMinutes:60,
            allowedTimeStart:540,allowedTimeEnd:600},
          {...base,hid:'daily',name:'Daily',target:1,durationMinutes:30,
            allowedTimeStart:600,allowedTimeEnd:630},
          {...base,hid:'work',name:'Work',target:1,durationMinutes:60,
            breakable:true,minChunkMinutes:30,allowedTimeStart:630,allowedTimeEnd:720}
        ];
        const week = buildWeekAgenda(data,settings,7);
        return week.days.map(day=>day.timeline.filter(row=>row.kind === 'fill')
          .map(row=>[row.i,(row.end-row.start)/60000]));
      }finally{globalThis.Date=RealDate;}
    },{base:baseHabit({}),settings});
    assert.deepStrictEqual(cadence.flatMap((day,i)=>day.some(row=>row[0]===0)?[i]:[]),[0,3,6],
      'scarcity repair and whole-week search preserve sparse cadence');
    assert(cadence.every(day=>day.filter(row=>row[0]===1).length===1),'daily occurrences remain independent');
    assert(cadence.every(day=>day.filter(row=>row[0]===2).reduce((sum,row)=>sum+row[1],0)===60),
      'whole-week search retains the breakable budget on each day');
    console.log(`Week graph: 6 → 7 tasks, ${holistic.diagnostics.evaluated} complete weeks, ${holistic.elapsed.toFixed(1)}ms`);
    console.log('PASS day and week graphs: recovery, hard windows, uniqueness, determinism and exhausted budgets');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
