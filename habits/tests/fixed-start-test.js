const assert = require('node:assert/strict');
const {chromium,BASE,FAST_ONLY,baseHabit,openEveningSettings,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch();
  try{
    const context = await browser.newContext({serviceWorkers:'block'});
    await context.clock.setFixedTime(new Date('2026-10-13T08:00:00-04:00'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(BASE,{waitUntil:'networkidle'});
    const glpkOk = await glpkAvailable(page);
    const settings = openEveningSettings();
    const fixed = props=>baseHabit({hid:'class',name:'Class',target:1,priority:0,
      allowedTimeFixedStart:true,allowedTimeStart:603,durationMinutes:90,...props});
    async function plan(data,cfg=settings,count=2){
      return page.evaluate(async ({data,cfg,count,glpkOk})=>{
        const old = sortSettings;
        sortSettings = cfg;
        const summarize = week=>({optimized:week.optimized,days:week.days.map(day=>
          day.timeline.filter(row=>row.kind==='fill').map(row=>({
            name:row.h.name,start:(row.start-day.dayBase)/60000,end:(row.end-day.dayBase)/60000,
            place:row.locationId,option:row.scheduleOptionId
          })))});
        try{
          const result = {fast:summarize(buildWeekAgenda(data,{...cfg,agendaOptimizer:false},count))};
          if(glpkOk)result.glpk=summarize(await buildWeekAgendaAsync(data,{...cfg,agendaOptimizer:true},count));
          return result;
        }finally{sortSettings=old;}
      },{data,cfg,count,glpkOk});
    }

    let result = await plan([fixed({preferredTimeStart:720,preferredTimeEnd:900})]);
    for(const [engine,week] of Object.entries(result)){
      assert.equal(week.days[0][0]?.start,603,engine+' keeps the exact off-grid start');
      assert.equal(week.days[0][0]?.end,693,engine+' derives finish from duration');
      assert.equal(week.days[1][0]?.start,603,engine+' repeats at the same clock');
      if(engine==='glpk')assert.equal(week.optimized,true,'uses GLPK rather than fallback');
    }
    result = await plan([fixed({durationMinutes:45})]);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0][0]?.end,648,engine+' updates finish with duration');

    result = await plan([fixed({}),baseHabit({hid:'flex',name:'Flexible',target:1})],
      {...settings,blockedTimes:[...settings.blockedTimes,{label:'Conflict',days:[],start:603,end:615}]});
    for(const [engine,week] of Object.entries(result)){
      assert.ok(!week.days[0].some(row=>row.name==='Class'),engine+' does not move a conflicting fixed start');
      assert.ok(week.days[0].some(row=>row.name==='Flexible'),engine+' still schedules flexible work');
    }

    const campus={id:'campus',name:'Campus',lat:40,lng:-74,allowedTimeStart:540,allowedTimeEnd:1020};
    const studio={id:'studio',name:'Studio',lat:40,lng:-74};
    const options=baseHabit({hid:'options',name:'Sessions',target:1,priority:0,durationMinutes:45,
      anywhereAllowed:false,locationIds:[],scheduleOptions:[
        {id:'tuesday-class',weekdays:[2],fixedStart:true,start:603,end:null,locationId:'campus'},
        {id:'wednesday-class',weekdays:[3],fixedStart:true,start:667,end:null,locationId:'studio'}
      ]});
    result = await plan([options],{...settings,locations:[campus,studio]});
    for(const [engine,week] of Object.entries(result)){
      assert.equal(week.days[0][0]?.start,603,engine+' uses Tuesday fixed start');
      assert.equal(week.days[0][0]?.place,'campus',engine+' couples time and venue');
      assert.equal(week.days[1][0]?.start,667,engine+' uses Wednesday fixed start');
      assert.equal(week.days[1][0]?.place,'studio',engine+' uses the Wednesday venue');
    }
    result = await plan([options],{...settings,locations:[{...campus,allowedTimeStart:615},studio]});
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0].length,0,engine+' does not slide to venue opening');

    const home={id:'home',name:'Home',lat:40.001,lng:-74};
    const travelSettings={...settings,locations:[home,campus],lastKnownLocationId:'home',
      travel:{'campus|home':{a:'campus',b:'home',seconds:1200,metres:1500,provider:'manual'}}};
    result=await plan([fixed({anywhereAllowed:false,locationIds:['campus']})],travelSettings,1);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0][0]?.start,603,engine+' travel arrives by the fixed start');
    result=await plan([fixed({anywhereAllowed:false,locationIds:['campus']})],
      {...travelSettings,blockedTimes:[{label:'Before class',days:[],start:0,end:600}]},1);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0].length,0,engine+' travel cannot push the class late');

    result=await plan([baseHabit({hid:'prepare',name:'Prepare',target:1,priority:0,durationMinutes:30}),
      fixed({scheduleLinks:[{anchorHid:'prepare',direction:'after',adjacency:'direct',requireSameDay:true}]})],settings,1);
    for(const [engine,week] of Object.entries(result)){
      assert.equal(week.days[0].find(row=>row.name==='Class')?.start,603,engine+' direct link keeps the fixed class start');
      const predecessor=week.days[0].find(row=>row.name==='Prepare');
      assert.ok(predecessor && predecessor.end<=603,engine+' keeps the linked predecessor before the class');
    }

    result = await plan([fixed({allowedTimeStart:0,durationMinutes:45})],{...settings,blockedTimes:[]},2);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[1][0]?.start,0,engine+' midnight is an exact start on the next day');

    const relative = fixed({allowedTimeStart:null,allowedTimeStartAnchor:'maghrib',allowedTimeStartOffsetMin:15,durationMinutes:30});
    const city = {...settings,homeCityLat:40.7,homeCityLng:-74,homeCityName:'Test city'};
    const expected = await page.evaluate(({h,cfg})=>{
      const old=sortSettings;sortSettings=cfg;
      try{return resolveHabitTimeField(h,'allowedTimeStart',dayStart(Date.now()));}
      finally{sortSettings=old;}
    },{h:relative,cfg:city});
    result=await plan([relative],city,1);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0][0]?.start,expected,engine+' fixes the resolved relative start');

    result=await plan([fixed({breakable:true,minChunkMinutes:30,durationMinutes:120})],
      {...settings,blockedTimes:[...settings.blockedTimes,{label:'Pause',days:[],start:643,end:663}]},1);
    for(const [engine,week] of Object.entries(result)){
      assert.equal(week.days[0][0]?.start,603,engine+' breakable first chunk starts exactly');
      assert.ok(week.days[0].every(row=>row.end<=723),engine+' chunks stay inside the duration-wide window');
    }

    const checks=await page.evaluate(h=>{
      const normalized=normalize([{...h,allowedTimeStart:0,allowedTimeEnd:0}])[0];
      const base=dayStart(Date.now()),start=base+603*60000;
      const row={kind:'fill',h,start,end:start+90*60000};
      const options=normalizeHabitScheduleOptions([
        {start:600,end:null,fixedStart:true,locationId:null},
        {start:600,end:660,locationId:null}
      ]);
      return {midnight:normalized.allowedTimeStart,summary:timeWindowSummary(h),
        shift:shiftAgendaFillToNow([row],0,start+60000),
        tick:homeAgendaTickPlan({days:[{dayBase:base,timeline:[row]}]},start+60000).kind,
        expired:windowStillDoableToday({...h,breakable:true},start+1),
        options:options.length,legacyFixed:options[1].fixedStart===true};
    },fixed({}));
    assert.equal(checks.midnight,0,'normalization preserves a fixed midnight start');
    assert.equal(checks.summary,'starts 10:03am','card summary describes an exact start');
    assert.equal(checks.shift,null,'cached agenda cannot slide the class');
    assert.equal(checks.tick,'keep','minute tick keeps an ongoing class at its original clock');
    assert.equal(checks.expired,false,'breakables cannot start late');
    assert.equal(checks.options,2,'fixed and flexible windows remain distinct');
    assert.equal(checks.legacyFixed,false,'legacy windows stay flexible');

    await context.clock.setFixedTime(new Date('2026-10-13T10:01:30-04:00'));
    result=await plan([fixed({})],settings,1);
    for(const [engine,week] of Object.entries(result))assert.equal(week.days[0][0]?.start,603,engine+' does not round away an imminent off-grid class');
    const workers=await page.evaluate(async ({h,cfg,glpkOk})=>{
      const result={};
      for(const mode of glpkOk ? ['fast','exact'] : ['fast']){
        // Workers use the real clock; tomorrow is a stable future opportunity
        // independently of Playwright's page-only frozen Date.
        const week=await buildWeekAgendaOffMain([h],cfg,2,mode);
        const row=week.days[1].timeline.find(row=>row.kind==='fill');
        result[mode]=row ? (row.start-week.days[1].dayBase)/60000 : null;
      }
      return result;
    },{h:fixed({}),cfg:settings,glpkOk});
    for(const [engine,start] of Object.entries(workers))assert.equal(start,603,engine+' worker enforces fixed starts');
    await context.clock.setFixedTime(new Date('2026-10-13T10:43:00-04:00'));
    const partialAt=new Date('2026-10-13T10:43:00-04:00').getTime();
    result=await plan([fixed({breakable:true,minChunkMinutes:30,lastLog:partialAt,
      logs:[{ts:partialAt,minutes:40}]})],settings,1);
    for(const [engine,week] of Object.entries(result)){
      assert.equal(week.days[0][0]?.start,643,engine+' resumes after a logged first chunk');
      assert.equal(week.days[0][0]?.end,693,engine+' keeps the original finish after partial completion');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS fixed starts, duration, conflicts, weekdays, venues, relative times, chunks, persistence and ticks'+(FAST_ONLY?' (Fast)':glpkOk?' (Fast + GLPK)':' (GLPK unavailable)'));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
