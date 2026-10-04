const assert=require('assert'),fs=require('fs');
const {chromium,BASE}=require('./helpers/planner-test-helpers');
const {eveningPackingScenario,lateEveningPackingScenario}=require('./helpers/planner-quality-fixtures');
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
    delete oneWay.dayMinutes.errand;
    const kept=await page.evaluate(runPlannerQualityScenario,{scenario:oneWay,workerSource:source,engines:['fast'],repeat:false});
    const protectedRun=kept.engines.fast[0];
    assert.deepStrictEqual(protectedRun.violations,[]);
    assert.deepStrictEqual(independentViolations(oneWay,protectedRun),[]);
    assert(!protectedRun.rows.some(r=>r.hid==='errand' && r.day===0),
      'today recovery cannot turn a cheaper one-way future visit into a round trip');
    assert.strictEqual(protectedRun.rows.filter(r=>r.hid==='errand').length,1);
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
    console.log('PASS evening packing: due and optional recovery, weather, venue, travel cost guard, cadence, deterministic budget and replay retention');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
