const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,plannerSettings,runPlannerPair,minutesOnDay,placedAnywhere,FAST_ONLY,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(BASE,{waitUntil:'networkidle'});
    const exact=await glpkAvailable(page);
    const now=new Date(2026,2,2,9).getTime(),day=new Date(2026,2,2).getTime(),D=86400000;
    const profile={id:'dry',name:'Dry',rules:[{metric:'precipitation_probability',max:30,min:null,hard:false,relative:'none'}]};
    const context={profiles:[profile],timezone:'America/New_York',weeklyFetchedAt:now,samples:Array.from({length:7*24},(_,i)=>({ts:day+i*3600000,precipitation_probability:10,source:'weekly'}))};
    const settings=plannerSettings([{label:'sleep',days:[],start:0,end:540},{label:'night',days:[],start:1080,end:1440}],{weatherProfiles:[profile],_weatherContext:context});
    const optional=(props={})=>baseHabit({hid:'optional',name:'Optional',repeatMode:'opportunity',weatherProfileMode:'profile',weatherProfileId:'dry',earlyWindowDays:60,delayAllowanceDays:0,createdAt:now,...props});
    let checks=0;
    async function pair(data,cfg=settings,count=7){
      const result=await runPlannerPair(page,data,cfg,now,count);
      for(const [engine,week] of Object.entries(result)){
        if(!week || engine==='glpk' && !exact)continue;
        assert(!week.error,`${engine}: ${week.error}`);
        if(engine==='glpk')assert(week.optimized,'GLPK must produce an incumbent');
      }
      return [result.fast,exact ? result.glpk : null].filter(Boolean);
    }
    async function check(name,data,cfg,test,count=7){
      for(const week of await pair(data,cfg,count))test(week);
      checks++;console.log('ok: '+name);
    }
    await check('once per seven days, including virtual placements',[optional()],settings,w=>{assert.equal(minutesOnDay(w,0,'Optional'),30);assert.equal(placedAnywhere(w,'Optional'),30);});
    await check('cooldown cannot be shortened by early flexibility',[optional({lastLog:day-6*D,logs:[day-6*D]})],settings,w=>{assert.equal(minutesOnDay(w,0,'Optional'),0);assert.equal(minutesOnDay(w,1,'Optional'),30);});
    await check('repeats on the minimum gap across the week',[optional({target:3})],settings,w=>{assert.deepEqual(w.days.map(x=>x.Optional || 0),[30,0,0,30,0,0,30]);});
    await check('soft weather limits become eligibility conditions even for P0',[optional({priority:0})],{...settings,_weatherContext:{...context,samples:context.samples.map(x=>({...x,precipitation_probability:x.ts<day+D ? 90 : 10}))}},w=>{assert.equal(minutesOnDay(w,0,'Optional'),0);assert.equal(minutesOnDay(w,1,'Optional'),30);});
    await check('unknown forecast waits',[optional()],{...settings,_weatherContext:null},w=>assert.equal(placedAnywhere(w,'Optional'),0));
    await check('stale forecast waits',[optional()],{...settings,_weatherContext:{...context,weeklyFetchedAt:now-9*3600000}},w=>assert.equal(placedAnywhere(w,'Optional'),0));
    await check('no configured trigger waits',[optional({weatherProfileMode:'none',weatherProfileId:null})],settings,w=>assert.equal(placedAnywhere(w,'Optional'),0));
    const locations=[{id:'home',name:'Home',lat:40,lng:-74},{id:'park',name:'Park',lat:40.01,lng:-74}];
    const atHome={...settings,locations,pinnedLocationId:'home',lastKnownLocationId:'home'};
    const atPark={...atHome,pinnedLocationId:'park',lastKnownLocationId:'park'};
    const placeItem=optional({weatherProfileMode:'none',weatherProfileId:null,locationIds:['park'],anywhereAllowed:false});
    await check('place-only does not arrange a trip',[placeItem],atHome,w=>assert.equal(placedAnywhere(w,'Optional'),0));
    await check('current place activates the item',[placeItem],atPark,w=>assert.equal(minutesOnDay(w,0,'Optional'),30));
    const visit=baseHabit({hid:'visit',name:'Visit',type:'task',target:null,dueDate:day,eventTime:day+10*3600000,locationIds:['park'],anywhereAllowed:false});
    await check('existing future visit activates the item',[visit,placeItem],atHome,w=>assert.equal(minutesOnDay(w,0,'Optional'),30));
    await check('upcoming visit can include the item before its appointment',[visit,{...placeItem,allowedTimeStart:570,allowedTimeEnd:600}],atHome,w=>assert.equal(minutesOnDay(w,0,'Optional'),30));
    await check('place and weather must both match',[visit,optional({locationIds:['park'],anywhereAllowed:false})],{...atHome,_weatherContext:{...context,places:{park:{timezone:context.timezone,weeklyFetchedAt:now,samples:context.samples.map(x=>({...x,precipitation_probability:90}))}}}},w=>assert.equal(placedAnywhere(w,'Optional'),0));
    const short={...settings,blockedTimes:[{label:'before',days:[],start:0,end:540},{label:'after',days:[],start:570,end:1440}]};
    const lower=baseHabit({hid:'lower',name:'Lower',target:1,priority:3});
    await check('matching high priority item receives agenda time',[lower,optional({priority:0})],short,w=>{assert.equal(minutesOnDay(w,0,'Optional'),30);assert.equal(minutesOnDay(w,0,'Lower'),0);},1);
    await check('displaced task uses its remaining allowed days',[
      baseHabit({hid:'task',name:'Flexible task',type:'task',target:null,dueDate:day,earlyWindowDays:0,delayAllowanceDays:2,priority:3}),
      optional({priority:0})],short,w=>{assert.equal(minutesOnDay(w,0,'Optional'),30);assert.equal(minutesOnDay(w,1,'Flexible task'),30);});
    await check('higher priority critical occurrence stays protected',[{...lower,priority:0},optional({priority:1})],short,w=>{assert.equal(minutesOnDay(w,0,'Lower'),30);assert.equal(minutesOnDay(w,0,'Optional'),0);},1);
    await check('explicit plan stays protected',[{...lower,logs:[{ts:day,plan:true}]},optional({priority:0})],short,w=>{assert.equal(minutesOnDay(w,0,'Lower'),30);assert.equal(minutesOnDay(w,0,'Optional'),0);},1);
    await check('split optional session respects its full daily budget',[optional({breakable:true,durationMinutes:60,minChunkMinutes:30})],{...short,blockedTimes:[{label:'before',days:[],start:0,end:540},{label:'gap',days:[],start:570,end:600},{label:'after',days:[],start:630,end:1440}]},w=>assert.equal(minutesOnDay(w,0,'Optional'),60),1);
    await check('explicit plans also respect the repeat limit',[optional({lastLog:day-D,logs:[day-D,{ts:day+10*3600000,plan:true,timed:true}]})],settings,w=>assert.equal(minutesOnDay(w,0,'Optional'),0));
    await check('partial split completion continues today without reopening tomorrow',[
      optional({breakable:true,durationMinutes:60,minChunkMinutes:30,lastLog:day+8*3600000,
        logs:[{ts:day+8*3600000,minutes:30}]})],settings,w=>{assert.equal(minutesOnDay(w,0,'Optional'),30);assert.equal(placedAnywhere(w,'Optional'),30);});
    await check('specific option keeps its place and weather conditions',[
      optional({weatherProfileMode:'none',weatherProfileId:null,scheduleOptions:[{id:'option',weekdays:[],start:600,end:720,locationId:'park',weatherProfileMode:'profile',weatherProfileId:'dry'}]})
    ],{...atPark,_weatherContext:{...context,places:{park:{timezone:context.timezone,weeklyFetchedAt:now,samples:context.samples}}}},w=>assert.equal(minutesOnDay(w,0,'Optional'),30));
    await check('direct link respects the placed partner',[
      visit,{...placeItem,scheduleLinks:[{id:'link',direction:'after',anchorHid:'visit',adjacency:'direct',requireSameDay:true}]}
    ],atHome,w=>assert.equal(minutesOnDay(w,0,'Optional'),30));
    const beforeTravel=await runPlannerPair(page,[visit],atHome,now,1,true);
    const withTravel=await runPlannerPair(page,[visit,{...placeItem,allowedTimeStart:570,allowedTimeEnd:600}],atHome,now,1,true);
    for(const engine of ['fast','glpk']){
      if(!withTravel[engine] || engine==='glpk' && !exact)continue;
      assert(withTravel[engine].travelSeconds<=beforeTravel[engine].travelSeconds,'existing visit adds no travel');
      assert.deepEqual(withTravel[engine].rows[0].find(row=>row.kind==='scheduled'),beforeTravel[engine].rows[0].find(row=>row.kind==='scheduled'),'appointment clock and place remain fixed');
    }
    checks++;
    const worker=await page.evaluate(async ({data,settings,now})=>{
      const week=await buildWeekAgendaOffMain(data,settings,7,'fast',{now});
      return week.days.flatMap(day=>day.timeline || []).filter(row=>row.i===0 && row.kind==='fill').length;
    },{data:[placeItem],settings:{...atPark,blockedTimes:[{label:'sleep',days:[],start:0,end:540,locationId:'park'}]},now});
    assert.equal(worker,1,'shared worker retains conditional mode and maximum gap');checks++;
    const facts=await page.evaluate(({h,now})=>{
      const orig=Date.now;Date.now=()=>now;
      try{return {missed:isMissedOccurrence(h,[],now),category:todayCategory(h,loadSortSettings()),cue:cardCue(h),progress:progressScore(h),normalized:normalize([h])[0],ordinary:normalize([{name:'Routine',type:'keepup',target:7}])[0].repeatMode};}finally{Date.now=orig;}
    },{h:optional({lastLog:day-100*D,logs:[day-100*D],target:0.2}),now});
    assert.equal(facts.missed,false);assert.equal(facts.category,2);assert.equal(facts.progress,null);assert(!/overdue|missed/i.test(facts.cue));assert.equal(facts.normalized.target,1);assert.equal(facts.ordinary,'routine');checks++;
    assert.deepEqual(errors,[]);
    console.log(`${checks} opportunity scenarios passed${exact ? ' (Fast + GLPK)' : ' (Fast; GLPK unavailable or disabled)'}`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
