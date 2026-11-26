// Manual day plans must survive flexible packing and audit future cadence
// against the earlier occurrences already present in the displayed week.
const assert = require('node:assert/strict');
const {chromium,BASE} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage({timezoneId:'America/New_York'});
    await page.goto(BASE,{waitUntil:'networkidle'});
    const result = await page.evaluate(async()=>{
      const now = new Date(2026,10,26,0,15).getTime();
      const RealDate = Date;
      globalThis.Date = class extends RealDate {
        constructor(...args){ super(...(args.length ? args : [now])); }
        static now(){ return now; }
      };
      try{
        const today = dayStart(now), tomorrow = offsetCalendarDay(today,1);
        const settings = {...loadSortSettings(),agendaOptimizer:true,locations:[],travel:{},
          lastKnownLocationId:null,availabilityMinutes:Array(7).fill(1440),
          availabilityOverrides:{},blockedTimes:[{label:'Sleep',days:[],start:0,end:420}]};
        const habit = extra=>normalize([{name:'item',type:'keepup',target:1,
          durationMinutes:5,priority:0,lastLog:today-86400000,logs:[today-86400000],
          ...extra}])[0];
        const data = [
          habit({name:'Visit',target:14,priority:2,durationMinutes:200,
            lastLog:today-6*86400000,logs:[today-6*86400000,{ts:tomorrow,plan:true}],
            allowedTimeStart:660,allowedTimeEnd:1424,delayAllowanceDays:3}),
          habit({name:'Midday',allowedTimeStart:735,allowedTimeEnd:780,durationMinutes:20}),
          habit({name:'Afternoon',allowedTimeStart:863,allowedTimeEnd:988}),
          habit({name:'Sunset',allowedTimeStart:1004,allowedTimeEnd:1043,durationMinutes:7}),
          habit({name:'Evening',allowedTimeStart:1087,allowedTimeEnd:1400,durationMinutes:10}),
          habit({name:'Dinner',priority:1,allowedTimeStart:1230,allowedTimeEnd:1410,durationMinutes:15}),
          habit({name:'Flexible',priority:2,allowedTimeStart:863,allowedTimeEnd:1439,durationMinutes:60}),
          habit({name:'Earlier sparse',priority:2,target:7,lastLog:today-8*86400000,
            logs:[today-8*86400000],durationMinutes:32})
        ];
        save(data);
        const engines = [];
        const exactAvailable = Boolean(await ensureGlpk().catch(()=>null));
        for(const worker of [false,true])for(const exact of exactAvailable ? [false,true] : [false]){
          const week = worker
            ? await buildWeekAgendaOffMain(data,settings,7,exact ? 'exact' : 'fast',{nowTs:now})
            : exact
            ? await buildWeekAgendaAsync(data,settings,7)
            : buildWeekAgenda(data,settings,7);
          rehydrateAgendaWeekHabits(week,data);
          const day = week.days[1];
          const audit = buildDayCapacityScorecard(data,settings,tomorrow,now,
            {weekMode:true,weekSnapshot:week});
          engines.push({exact,worker,visitMinutes:day.timeline.filter(row=>row.kind==='fill' && row.i===0)
            .reduce((sum,row)=>sum+(row.end-row.start)/60000,0),
            earlyVisit:week.days[0].timeline.some(row=>row.kind==='fill' && row.i===0),
            sparsePlacedEarlier:week.days[0].timeline.some(row=>row.kind==='fill' && row.i===7),
            sparseInAudit:audit.unplacedItems.some(row=>row.i===7),
            planTrace:audit.plannerTrace?.find(row=>row.i===0)?.inputs,
            critical:day.timeline.filter(row=>row.kind==='fill' && row.i>=1 && row.i<=4).length,
            planInsideWindow:day.timeline.filter(row=>row.kind==='fill' && row.i===0)
              .every(row=>row.start>=tomorrow+660*60000 && row.end<=tomorrow+1424*60000)});
        }
        return engines;
      }finally{ globalThis.Date = RealDate; }
    });
    for(const engine of result){
      const name = (engine.exact ? 'GLPK' : 'Fast')+(engine.worker ? ' Worker' : ' direct');
      assert.equal(engine.visitMinutes,200,name+' places the complete manual plan before cadence is due');
      assert.equal(engine.earlyVisit,false,name+' retains the requested calendar day');
      assert.equal(engine.critical,4,name+' retains all narrow daily commitments');
      assert(engine.planInsideWindow,name+' respects the allowed plan window');
      assert(engine.sparsePlacedEarlier,name+' fixture places the sparse occurrence earlier');
      assert.equal(engine.sparseInAudit,false,name+' audit advances cadence after the earlier occurrence');
      assert(engine.planTrace?.includes('planned for this day'),name+' trace identifies the selected-day plan');
    }
    console.log('PASS manual day-plan placement and future-day audit in both engines');
  }finally{ await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
