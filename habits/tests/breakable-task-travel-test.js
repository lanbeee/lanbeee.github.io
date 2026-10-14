// Flexible home work must not turn one remote task into repeated round trips.
const assert = require('node:assert/strict');
const {
  chromium, BASE, baseHabit, plannerSettings, runPlannerPair, FAST_ONLY
} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgendaAsync === 'function');
    const today = new Date(2026,9,14).getTime();
    const now = today + 9 * 3600000;
    const settings = plannerSettings([
      {label:'sleep',days:[],start:0,end:540,locationId:'home'},
      {label:'night',days:[],start:1080,end:1440}
    ],{
      lastKnownLocationId:'home',defaultTravelMode:'driving',
      locations:[
        {id:'home',name:'Home',lat:43,lng:-79},
        {id:'far',name:'Workshop',lat:43.1,lng:-79.1}
      ],
      travel:{'far|home':{
        a:'far',b:'home',seconds:900,metres:6000,provider:'manual',fetchedAt:now
      }}
    });
    // Travel reads the mounted settings, including the saved 15-minute override.
    await page.evaluate(settings=>{sortSettings = settings;},settings);
    const task = baseHabit({
      hid:'task',name:'Remote task',type:'task',target:null,dueDate:today,
      durationMinutes:240,breakable:true,minChunkMinutes:30,priority:1,
      locationIds:['far'],anywhereAllowed:false
    });
    const homeItems = [[9,13],[12,16],[15,18]].map(([start,end],i)=>baseHabit({
      hid:'home'+i,name:'Home '+i,target:1,durationMinutes:30,priority:1,
      allowedTimeStart:start*60,allowedTimeEnd:end*60,
      locationIds:['home'],anywhereAllowed:false,createdAt:today-86400000
    }));
    const check = (label,result,minutes,visits,windows,numDays=1)=>{
      for(const engine of FAST_ONLY ? ['fast'] : ['fast','glpk']){
        const plan = result[engine];
        assert.ok(plan && !plan.error,`${label}: ${engine} returns an agenda`);
        if(engine === 'glpk')assert.ok(plan.optimized,`${label}: uses GLPK`);
        const rows = plan.rows.flat();
        const chunks = rows.filter(row=>['fill','scheduled'].includes(row.kind) && row.i === 0);
        assert.equal(chunks.reduce((sum,row)=>sum+(row.end-row.start)/60000,0),minutes,
          `${label}: ${engine} preserves the lifetime task budget`);
        if(visits != null){
          assert.equal(chunks.length,visits,`${label}: ${engine} uses ${visits} visit(s)`);
          assert.equal(rows.filter(row=>row.kind === 'travel').length,visits*2,
            `${label}: ${engine} only travels out and back for each required visit`);
          assert.ok(rows.filter(row=>row.kind === 'travel').every(row=>row.end-row.start===900000),
            `${label}: ${engine} preserves 15-minute travel legs`);
        }
        for(let day=0;day<numDays;day++){
          const dayBase = today+day*86400000;
          for(let i=0;i<windows.length;i++){
            const home = plan.rows[day].filter(row=>row.kind === 'fill' && row.i === i+1);
            assert.equal(home.length,1,`${label}: ${engine} retains every home item on day ${day}`);
            assert.ok(home[0].start>=dayBase+windows[i][0]*3600000
              && home[0].end<=dayBase+windows[i][1]*3600000,
              `${label}: ${engine} respects each home window`);
          }
          const work = plan.rows[day].filter(row=>['fill','scheduled','travel'].includes(row.kind));
          for(let i=1;i<work.length;i++)assert.ok(work[i].start>=work[i-1].end,
            `${label}: ${engine} has no work/travel overlap`);
        }
      }
    };
    check('flexible home work',await runPlannerPair(page,[task,...homeItems],settings,now,1,true),
      240,1,[[9,13],[12,16],[15,18]]);
    const timed = await runPlannerPair(page,
      [{...task,durationMinutes:150,eventTime:today+10*3600000},...homeItems],settings,now,1,true);
    check('fixed remote first start',timed,150,1,[[9,13],[12,16],[15,18]]);
    for(const engine of FAST_ONLY ? ['fast'] : ['fast','glpk']){
      assert.equal(timed[engine].rows[0].find(row=>row.i === 0).start,today+10*3600000,
        `${engine} keeps the remote task's entered first start`);
    }
    const fixedHome = {...homeItems[1],allowedTimeEnd:12*60+30};
    check('unavoidable home interruption',await runPlannerPair(page,
      [{...task,allowedTimeStart:9*60,allowedTimeEnd:15*60},homeItems[0],fixedHome,homeItems[2]],settings,now,1,true),
      240,2,[[9,13],[12,12.5],[15,18]]);
    check('cross-day lifetime budget',await runPlannerPair(page,
      [{...task,durationMinutes:480,dueDate:today+86400000,earlyWindowDays:1},...homeItems],
      settings,now,2,true),480,null,[[9,13],[12,16],[15,18]],2);
    const active = await page.evaluate(({data,settings,today,now})=>{
      const RealDate = Date;
      globalThis.Date = class extends RealDate{
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      try{
        const state = createDayPlacementState(buildDayAgenda(data,settings,today),settings,
          {dayBase:today,now,weekMode:true});
        const candidates = data.map((h,i)=>({h,i,priority:1}));
        for(const fill of candidates.slice(1)){
          const fit = tryPlaceOnDay(state,fill,{settings,allowNetwork:false});
          commitPlacement(state,fill,fit);
        }
        placeBreakableSessions(state,candidates[0],{settings,allowNetwork:false});
        const chunks = state.fills.filter(entry=>entry.fill.i === 0);
        setDoingNow('task',now,today,{completionMode:'manual'});
        const snapshot = ()=>JSON.stringify(state.fills.map(entry=>({
          i:entry.fill.i,start:entry.fit.placeStart,end:entry.fit.placeEnd,loc:entry.fit.locId
        })));
        const before = snapshot();
        const improved = compactFastTravelRoutes([state],candidates,settings,{onlySplitTasks:true});
        return {split:chunks.length>1,improved,unchanged:before === snapshot()};
      }finally{clearDoingNow();globalThis.Date = RealDate;}
    },{data:[task,...homeItems],settings,today,now});
    assert.ok(active.split && active.improved === 0 && active.unchanged,
      'route cleanup preserves the clocks and location of active split work');
    console.log('PASS: both planners consolidate remote split tasks, preserve necessary returns and lifetime budgets');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
