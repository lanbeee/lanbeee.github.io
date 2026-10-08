const assert=require('assert'),fs=require('fs');
const {chromium,BASE,baseHabit}=require('./helpers/planner-test-helpers');
const {eveningPackingScenario,lateEveningPackingScenario,closingErrandWeatherScenario}=require('./helpers/planner-quality-fixtures');
const {runPlannerQualityScenario}=require('./helpers/planner-quality-runner');
const {independentViolations}=require('./helpers/planner-quality-validation');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
    const page=await context.newPage();await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    const scenario=eveningPackingScenario(),source=fs.readFileSync(__dirname+'/helpers/planner-quality-worker.js','utf8');
    const result=await page.evaluate(runPlannerQualityScenario,{scenario,workerSource:source,repeat:true});
    for(const mode of ['fast','exact']){
      const [first,repeat]=result.engines[mode];
      if(mode==='exact')assert(first.optimized,'reference must be a real GLPK incumbent');
      assert.deepStrictEqual(first.violations,[],mode+' shared feasibility');
      assert.deepStrictEqual(independentViolations(scenario,first),[],mode+' independent legality');
      const today=first.rows.filter(r=>r.day===0 && r.kind==='fill');
      assert.strictEqual(today.length,9,mode+' fits all nine evening items');
      const outdoor=today.find(r=>r.hid==='outdoor'),errand=today.find(r=>r.hid==='errand');
      const day=scenario.now-1108*60000;
      assert(outdoor.end<=day+1200*60000,'outdoor work stays before hard weather cutoff');
      assert(errand.end<=day+1200*60000,'errand finishes before venue closes');
      assert(first.rows.filter(r=>r.day===0 && r.kind==='travel').length>=2,'both directions of travel are retained');
      if(mode==='fast'){
        assert.deepStrictEqual(repeat.rows,first.rows,'Fast is deterministic');
        assert(first.graph.probes<=768,'same whole-build probe budget');
      }
    }
    const late=lateEveningPackingScenario();
    const recovered=await page.evaluate(runPlannerQualityScenario,{scenario:late,workerSource:source,repeat:true});
    for(const [mode,runs] of Object.entries(recovered.engines)){
      for(const r of runs){
        assert.deepStrictEqual(r.violations,[],mode+' late shared legality');
        assert.deepStrictEqual(independentViolations(late,r),[],mode+' late independent legality');
        assert.strictEqual(r.rows.filter(x=>x.day===0 && x.kind==='fill').length,9,mode+' late packs nine');
        assert.strictEqual(r.rows.filter(x=>x.hid==='errand').length,1,'move, never duplicate the errand');
        assert(r.rows.find(x=>x.day===0 && x.hid==='outdoor').end<=late.dayBase+1200*60000);
        assert(r.rows.find(x=>x.day===0 && x.hid==='errand').end<=late.dayBase+1260*60000);
        if(mode==='fast')assert(r.graph.probes<=768,'recovery shares the existing budget');
        else assert(r.optimized,'late reference really uses GLPK');
      }
      if(mode==='fast')assert.deepStrictEqual(runs[0].rows,runs[1].rows,'late Fast deterministic');
    }
    assert(recovered.engines.fast[0].todayChoices.accepted>0,'packed-week recovery is exercised');
    const oneWay=lateEveningPackingScenario();
    oneWay.id='late-evening-preserve-cheaper-future-route';
    oneWay.settings.blockedTimes=oneWay.settings.blockedTimes.filter(b=>b.label!=='sleep');
    oneWay.settings.agendaScoreWeights={travel:100};
    delete oneWay.dayMinutes.errand;
    const kept=await page.evaluate(runPlannerQualityScenario,{scenario:oneWay,workerSource:source,engines:['fast'],repeat:false});
    const protectedRun=kept.engines.fast[0];
    assert.deepStrictEqual(protectedRun.violations,[]);
    assert.deepStrictEqual(independentViolations(oneWay,protectedRun),[]);
    assert(!protectedRun.rows.some(r=>r.hid==='errand' && r.day===0),
      'an expensive extra round trip cannot outweigh the saved clock/day delay');
    assert.strictEqual(protectedRun.rows.filter(r=>r.hid==='errand').length,1);
    const closing=closingErrandWeatherScenario();
    const closingResult=await page.evaluate(runPlannerQualityScenario,
      {scenario:closing,workerSource:source,repeat:true});
    for(const [mode,runs] of Object.entries(closingResult.engines)){
      for(const r of runs){
        if(mode==='exact')assert(r.optimized,'closing-venue reference really uses GLPK');
        assert.deepStrictEqual(r.violations,[],mode+' closing shared legality');
        assert.deepStrictEqual(independentViolations(closing,r),[],mode+' closing independent legality');
        const today=r.rows.filter(row=>row.day===0 && row.kind==='fill');
        assert.strictEqual(today.length,5,mode+' fits the five outstanding items');
        assert(!today.some(row=>row.hid==='wash'),'completed wash is not a pending placement');
        const walk=today.find(row=>row.hid==='walk'),errand=today.find(row=>row.hid==='errand');
        assert.strictEqual(walk.start,closing.now,'retain the best weather slot');
        assert(errand.start>=walk.end+6*60000,'errand follows walk with outbound travel');
        assert(errand.end<=closing.dayBase+1230*60000,'errand finishes before closing');
        assert.strictEqual(r.rows.filter(row=>row.hid==='errand').length,1,'transfer never duplicates errand');
        if(mode==='fast')assert(r.graph.probes<=768,'rejected proposals share the existing budget');
      }
      if(mode==='fast')assert.deepStrictEqual(runs[0].rows,runs[1].rows,'closing recovery deterministic');
    }
    assert(closingResult.engines.fast[0].todayChoices.accepted>0,'weather-preserving alternative is searched');
    const shortTrip=closingErrandWeatherScenario();
    shortTrip.settings.blockedTimes=shortTrip.settings.blockedTimes.filter(b=>b.label!=='sleep')
      .map(({locationId,...block})=>block);
    const tripResult=await page.evaluate(runPlannerQualityScenario,
      {scenario:shortTrip,workerSource:source,repeat:false});
    for(const [mode,[r]] of Object.entries(tripResult.engines)){
      assert.deepStrictEqual(r.violations,[]);
      assert.deepStrictEqual(independentViolations(shortTrip,r),[],mode+' short extra trip is legal');
      assert(r.rows.some(row=>row.hid==='errand' && row.day===0),
        mode+' short round trip is worth avoiding the wait for a cheaper future visit');
    }
    assert(tripResult.engines.fast[0].todayChoices.accepted>0,'weighted travel tradeoff is exercised');
    for(const zeroDelay of [false,true]){
      const costly=closingErrandWeatherScenario();
      costly.settings.blockedTimes=costly.settings.blockedTimes.filter(b=>b.label!=='sleep')
        .map(({locationId,...block})=>block);
      if(zeroDelay)costly.settings.agendaScoreWeights={day:0,asap:0};
      else costly.settings.travel['home|shop'].seconds=12*60;
      delete costly.dayMinutes.errand;
      const checked=await page.evaluate(runPlannerQualityScenario,
        {scenario:costly,workerSource:source,engines:['fast'],repeat:false});
      const r=checked.engines.fast[0];
      assert.deepStrictEqual(r.violations,[]);
      assert.deepStrictEqual(independentViolations(costly,r),[]);
      assert(!r.rows.some(row=>row.hid==='errand' && row.day===0),zeroDelay
        ? 'zero delay weights cannot pay for extra travel'
        : 'a longer trip defers under the ordinary default weights');
      assert.strictEqual(r.rows.filter(row=>row.hid==='errand').length,1);
      assert.deepStrictEqual(r.totals,tripResult.engines.fast[0].totals,'tradeoff retains every weekly minute');
    }
    const sourceVenues=await page.evaluate(({scenario,base})=>{
      const RealDate=Date;
      globalThis.Date=class extends RealDate{
        constructor(...args){super(...(args.length?args:[scenario.now]));}
        static now(){return scenario.now;}
      };
      const day=scenario.dayBase+86400000,settings=scenario.settings;
      const data=normalize([
        {...base,hid:'source-errand',name:'Synthetic source errand',type:'task',target:null,
          dueDate:day,earlyWindowDays:1,durationMinutes:30,allowedTimeStart:600,allowedTimeEnd:1230,
          anywhereAllowed:false,locationIds:['shop']},
        {...base,hid:'source-neighbor',name:'Synthetic source neighbor',target:1,durationMinutes:10,
          allowedTimeStart:631,allowedTimeEnd:641,anywhereAllowed:true,locationIds:['home','shop'],
          locationPrefs:{home:'little',shop:'little'}}
      ]);
      save(data);saveSortSettings(settings);Object.assign(sortSettings,settings);
      beginPlannerSolveCaches(data);
      try{
        const state=createDayPlacementState(buildDayAgenda(data,settings,day,{weekMode:true,now:scenario.now}),
          settings,{dayBase:day,now:scenario.now,weekMode:true});
        for(let i=0;i<data.length;i++){
          const fill={h:data[i],i,priority:2},fit=tryPlaceOnDay(state,fill,{settings,allowNetwork:false});
          if(!fit)throw new Error('source venue fixture failed');
          commitPlacement(state,fill,fit);
        }
        reconcileCommittedTravel(state);
        const neighbor=state.fills.find(e=>e.fill.i===1),before=JSON.stringify(state.fills);
        const frozen=fastLinkedGroupBase(state,new Set(['source-errand']));
        const flexible=fastLinkedGroupBase(state,new Set(['source-errand']),{keepLocations:false});
        if(frozen)reconcileCommittedTravel(frozen);
        if(flexible)reconcileCommittedTravel(flexible);
        const protectedRecovery=[];
        for(const protection of ['plan','weather']){
          const cfg={...settings,_weatherContext:{...settings._weatherContext,locks:protection==='weather'
            ? [{hid:'source-neighbor',start:neighbor.fit.placeStart,end:neighbor.fit.placeEnd,locationId:'shop'}] : []}};
          const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:100,
            pinned:protection==='plan' && i===1,pinnedDay:i===1 ? day : null,
            eligible:new Set(i===0 ? [scenario.dayBase,day] : [day])}));
          const today=createDayPlacementState(buildDayAgenda(data,cfg,scenario.dayBase,{weekMode:true,now:scenario.now}),
            cfg,{dayBase:scenario.dayBase,now:scenario.now,weekMode:true});
          const later=cloneFastGraphState(state);later.settings=cfg;
          const diagnostics=improveFastGraphTodayChoices(candidates,[today,later],cfg,{maxProbes:96});
          const retained=later.fills.find(e=>e.fill.i===1);
          protectedRecovery.push({protection,accepted:diagnostics.accepted,
            transferred:today.fills.some(e=>e.fill.i===0),location:retained?.fit.locId,
            start:retained?.fit.placeStart,end:retained?.fit.placeEnd});
        }
        return {originalLocation:neighbor.fit.locId,originalStart:neighbor.fit.placeStart,
          originalEnd:neighbor.fit.placeEnd,protectedRecovery,
          frozenLocation:frozen?.fills[0].fit.locId,flexibleLocation:flexible?.fills[0].fit.locId,
          flexibleStart:flexible?.fills[0].fit.placeStart,remainingCount:flexible?.fills.length,
          unchanged:JSON.stringify(state.fills)===before};
      }finally{endPlannerSolveCaches();globalThis.Date=RealDate;}
    },{scenario:closing,base:baseHabit({})});
    assert.strictEqual(sourceVenues.originalLocation,'shop');
    assert.strictEqual(sourceVenues.frozenLocation,'shop','coupled-group replay freezes neighboring venues');
    assert.strictEqual(sourceVenues.flexibleLocation,'home','ordinary source may drop the errand detour');
    assert.strictEqual(sourceVenues.flexibleStart,sourceVenues.originalStart,'source clock stays fixed');
    assert.strictEqual(sourceVenues.remainingCount,1,'remove only the transferred occurrence');
    assert(sourceVenues.unchanged,'source replay is transactional');
    for(const r of sourceVenues.protectedRecovery){
      assert(r.transferred && r.accepted===1,r.protection+' neighbor must not block a legal errand transfer');
      assert.strictEqual(r.location,'shop',r.protection+' source venue is frozen during replay');
      assert.strictEqual(r.start,sourceVenues.originalStart);
      assert.strictEqual(r.end,sourceVenues.originalEnd);
    }
    const tight=closingErrandWeatherScenario();
    tight.data.find(h=>h.hid==='critical').allowedTimeEnd=1213;
    delete tight.dayMinutes.errand;
    const rejected=await page.evaluate(runPlannerQualityScenario,
      {scenario:tight,workerSource:source,engines:['fast'],repeat:false});
    const tightRun=rejected.engines.fast[0];
    assert.deepStrictEqual(tightRun.violations,[]);
    assert.deepStrictEqual(independentViolations(tight,tightRun),[]);
    assert(!tightRun.rows.some(row=>row.hid==='errand' && row.day===0),
      'equal-work transfer waits when weather loss outweighs the timing benefit');
    assert.strictEqual(tightRun.rows.find(row=>row.hid==='walk' && row.day===0).start,tight.now);
    assert(tightRun.graph.probes<=768,'failed alternative search stays bounded');
    const mild=closingErrandWeatherScenario();
    mild.settings.agendaScoreWeights={day:2};
    mild.data.find(h=>h.hid==='critical').allowedTimeEnd=1213;
    mild.settings.weatherProfiles[0].rules[0].importance='low';
    mild.settings.weatherProfiles[0].rules.push(
      {metric:'uv_index',relative:'low',hard:false,importance:'high'},
      {metric:'precipitation_probability',relative:'low',hard:false,importance:'high'});
    for(const samples of [mild.settings._weatherContext.samples,mild.settings._weatherContext.places.home.samples])
      for(const sample of samples){sample.uv_index=1;sample.precipitation_probability=0;}
    const softened=await page.evaluate(runPlannerQualityScenario,
      {scenario:mild,workerSource:source,engines:['fast'],repeat:true});
    for(const r of softened.engines.fast){
      assert.deepStrictEqual(r.violations,[]);
      assert.deepStrictEqual(independentViolations(mild,r),[]);
      assert(r.rows.some(row=>row.hid==='errand' && row.day===0),'small soft weather loss can yield to timing');
      assert(r.rows.find(row=>row.hid==='walk' && row.day===0).start>mild.now,'weather preference can flex');
      assert.deepStrictEqual(r.totals,tightRun.totals,'soft tradeoff retains all weekly work');
    }
    assert.deepStrictEqual(softened.engines.fast[0].rows,softened.engines.fast[1].rows);
    const selectionWeather=await page.evaluate(({scenario,base})=>{
      const RealDate=Date,day=scenario.dayBase,now=day+540*60000;
      globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};
      const run=mode=>{
        const profiles=[{id:'warm',name:'Warm',rules:[{metric:'temperature_2m',relative:'high',
          min:mode==='hard'?21:null,max:null,hard:mode==='hard'}]}];
        const samples=Array.from({length:24},(_,i)=>({ts:day+i*3600000,temperature_2m:i===9?21:20,source:'weekly'}));
        const cfg={...scenario.settings,lastKnownLocationId:'home',
          locations:[{id:'home',name:'Home',isHome:true,lat:40.7,lng:-74},{id:'shop',name:'Shop',lat:40.701,lng:-74}],
          travel:{'home|shop':{a:'home',b:'shop',seconds:360,metres:500,provider:'manual',fetchedAt:now}},
          blockedTimes:[{label:'morning',days:[],start:0,end:540},{label:'end',days:[],start:672,end:1440}],
          weatherProfiles:profiles,_weatherContext:{profiles,samples,places:{home:{samples,timezone:'America/New_York'}},timezone:'America/New_York',
            locks:mode==='lock'?[{hid:'selection-walk',start:now,end:now+60*60000}]:[]}};
        const data=normalize([
          {...base,hid:'selection-walk',name:'Synthetic walk',target:1,priority:2,durationMinutes:60,
            logs:[day-86400000],allowedTimeStart:540,allowedTimeEnd:672,locationIds:['home'],anywhereAllowed:false,
            weatherProfileMode:'profile',weatherProfileId:'warm'},
          {...base,hid:'selection-errand',name:'Synthetic errand',target:1,priority:2,durationMinutes:60,
            logs:[day-86400000],allowedTimeStart:546,allowedTimeEnd:606,locationIds:['shop'],anywhereAllowed:false}
        ]);
        save(data);saveSortSettings(cfg);Object.assign(sortSettings,cfg);beginPlannerSolveCaches(data);
        try{
          const state=createDayPlacementState(buildDayAgenda(data,cfg,day,{weekMode:true,now}),cfg,{dayBase:day,now,weekMode:true});
          const candidates=data.map((h,i)=>({h,i,priority:2,urgency:100,eligible:new Set([day])}));
          const fit=tryPlaceOnDay(state,candidates[0],{settings:cfg,allowNetwork:false});
          if(!fit)throw new Error('weather selection fixture failed');
          commitPlacement(state,candidates[0],fit);syncDayAgendaItemsFromFills(state);
          const before=weatherPenaltyForFit(candidates[0],fit,state,cfg);
          const diagnostics=improveFastGraphDaySelections(candidates,[state],cfg,{maxProbes:768});
          const walk=state.fills.find(e=>e.fill.i===0);
          return {diagnostics,count:state.fills.length,minutes:state.fills.reduce((n,e)=>n+e.fit.durMin,0),
            walkStart:walk?.fit.placeStart,travel:dayRouteCostSeconds(state),
            weatherBefore:before,weatherAfter:weatherPenaltyForFit(walk.fill,walk.fit,state,cfg)};
        }finally{endPlannerSolveCaches();}
      };
      try{return {soft:run('soft'),repeat:run('soft'),hard:run('hard'),lock:run('lock'),now};}
      finally{globalThis.Date=RealDate;}
    },{scenario:closing,base:baseHabit({})});
    assert.strictEqual(selectionWeather.soft.count,2,'more work takes precedence over soft temperature preference');
    assert.strictEqual(selectionWeather.soft.minutes,120,'retain old work and add the missing hour');
    assert(selectionWeather.soft.weatherAfter>selectionWeather.soft.weatherBefore,'test exercises a real soft weather deterioration');
    assert(selectionWeather.soft.travel>0,'more work can justify an added feasible trip');
    assert(selectionWeather.soft.diagnostics.accepted>0);
    assert.deepStrictEqual(selectionWeather.soft,selectionWeather.repeat,'weather selection remains deterministic');
    for(const mode of ['hard','lock']){
      assert.strictEqual(selectionWeather[mode].count,1,mode+' cannot be traded for more work');
      assert.strictEqual(selectionWeather[mode].walkStart,selectionWeather.now);
      assert.strictEqual(selectionWeather[mode].diagnostics.accepted,0);
    }
    for(const mode of ['soft','hard','lock'])assert(selectionWeather[mode].diagnostics.probes<=768);
    const guard=await page.evaluate(()=>{
      const day=dayStart(Date.now()),h={hid:'due',type:'keepup',target:3,lastLog:day-4*86400000,logs:[]};
      const c={h,i:0,priority:2};
      const state=(dayBase,amount=1)=>({dayBase,fills:Array.from({length:amount},()=>({fill:{h,i:0},fit:{durMin:30}}))});
      return {
        postponed:fastGraphReplayRetainsWork([state(day),state(day+86400000,0)],[state(day,0),state(day+86400000)],[c]),
        retained:fastGraphReplayRetainsWork([state(day)],[state(day)],[c]),
        dropped:fastGraphReplayRetainsWork([state(day)],[state(day,0)],[c])
      };
    });
    assert(!guard.postponed,'a weekly count cannot conceal postponing a due occurrence');
    assert(guard.retained && !guard.dropped,'replay retains all previously selected work');
    console.log('PASS evening packing: due and optional recovery, weather-preserving alternatives, completed work, venue, travel cost guard, cadence, deterministic budget and replay retention');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
