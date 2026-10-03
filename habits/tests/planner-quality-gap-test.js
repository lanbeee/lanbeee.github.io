// Planner specialization corpus + feature controls. --require-target measures
// speed/placement; --require-parity is the stricter replacement-quality gate.
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const {chromium,BASE}=require('./helpers/planner-test-helpers');
const {qualityScenarios}=require('./helpers/planner-quality-fixtures');
const {independentViolations}=require('./helpers/planner-quality-validation');
const {runPlannerQualityScenario}=require('./helpers/planner-quality-runner');
const workerSource=fs.readFileSync(path.join(__dirname,'helpers/planner-quality-worker.js'),'utf8');
function witnessMinutes(s){
  if(!s.witness)return 0;
  let previous=0,total=0;
  for(const [i,start] of s.witness){const h=s.data[i];
    assert(start>=h.allowedTimeStart && start+h.durationMinutes<=h.allowedTimeEnd,'hand-checkable witness stays in window');
    assert(start>=previous,'witness does not overlap');previous=start+h.durationMinutes;total+=h.durationMinutes;
  }return total;
}
// Validate the independent checker with deliberately corrupted schedules;
// a broken audit must not make a planner replacement look safe.
function validateChecker(){
  const s=qualityScenarios().find(s=>s.id==='off-grid-windows');
  const base=s.now-540*60000;
  const rows=s.data.map(h=>({hid:h.hid,kind:h.eventTime?'scheduled':'fill',day:0,
    start:h.eventTime || base+h.allowedTimeStart*60000,
    end:(h.eventTime || base+h.allowedTimeStart*60000)+h.durationMinutes*60000}));
  const valid={rows,totals:Object.fromEntries(s.data.map(h=>[h.hid,h.durationMinutes]))};
  assert.deepStrictEqual(independentViolations(s,valid),[],'checker accepts manual legal witness');
  const change=fn=>{const copy=JSON.parse(JSON.stringify(valid));fn(copy);return independentViolations(s,copy);};
  assert(change(r=>{r.rows[0].end+=60000;}).some(e=>e.startsWith('duration:')),'detect changed duration');
  assert(change(r=>{r.rows[0].start-=60000;r.rows[0].end-=60000;}).some(e=>e.startsWith('early:')),'detect window violation');
  assert(change(r=>{r.rows[2].start+=60000;r.rows[2].end+=60000;}).some(e=>e.startsWith('fixed-clock:')),'detect moved appointment');
  assert(change(r=>{r.rows.push({...r.rows[2]});}).some(e=>e.startsWith('duplicate-task:')),'detect duplicate task');
  assert(change(r=>{r.rows[0].start=base;r.rows[0].end=base+7*60000;}).some(e=>e.startsWith('block:')),'detect blocked hours');
}
(async()=>{
  validateChecker();
  assert(!(process.argv.includes('--fast-only') && process.argv.includes('--require-parity')),'Parity requires both engines; omit --fast-only');
  const requireTarget=process.argv.includes('--require-target');
  assert(!(requireTarget && process.argv.includes('--fast-only')),'Target gate needs a valid GLPK reference');
  const onDevice=process.argv.includes('--device');
  const device=onDevice?await require('./helpers/planner-quality-device').connectQualityDevice():null;
  const browser=onDevice?null:await chromium.launch({headless:true});
  const report={generatedAt:new Date().toISOString(),target:onDevice?'Android WebView':'desktop Chromium',environment:device?.environment,results:[]};
  const failures=[];
  try{
    let page;
    if(browser){
      const context=await browser.newContext({timezoneId:'America/New_York',serviceWorkers:'block'});
      page=await context.newPage();await page.goto(BASE);await page.waitForFunction(()=>typeof buildWeekAgenda==='function');
    }
    const evaluate=device?device.evaluate:(fn,args)=>page.evaluate(fn,args);
    const engines=process.argv.includes('--fast-only')?['fast']:['fast','exact'];
    const output=path.join(__dirname,`../test-results/planner-quality-${onDevice?'device':'desktop'}.json`);
    const persist=()=>{fs.mkdirSync(path.dirname(output),{recursive:true});
      fs.writeFileSync(output,JSON.stringify({...report,failures},null,2));};
    const timeoutMs=Math.max(1000,Number(process.env.QUALITY_TIMEOUT_MS) || 75000);
    const selected=qualityScenarios().filter(s=>!process.env.QUALITY_CASE || process.env.QUALITY_CASE.split(',').some(filter=>s.id.includes(filter)));
    assert(selected.length,'no matching fixtures');
    for(const s of selected){
      let result;
      try{result=await evaluate(runPlannerQualityScenario,{scenario:s,workerSource,engines,
        repeat:!process.argv.includes('--no-repeat'),timeoutMs});}
      catch(error){failures.push(`${s.id}: ${error.message}`);report.results.push({id:s.id,items:s.data.length,error:error.message});persist();console.error(`${s.id}: ${error.message}`);continue;}
      const fast=result.engines.fast[0],exact=result.engines.exact?.[0];
      const check=(condition,description)=>{if(!condition)failures.push(`${s.id}: ${description}`);};
      const fastMaxMs=Number(process.env.QUALITY_FAST_MAX_MS) || 0;
      if(fastMaxMs)check(fast.elapsedMs<=fastMaxMs,`Fast cold rebuild exceeds ${fastMaxMs}ms`);
      for(const engine of engines){
        for(const run of result.engines[engine])check(!run.violations.length && !independentViolations(s,run).length,
          `${engine} illegal: ${[...run.violations,...independentViolations(s,run)].join(', ')}`);
        if(engine==='fast' && result.engines[engine].length>1)check(JSON.stringify(result.engines[engine][0].rows)===JSON.stringify(result.engines[engine][1].rows),'Fast differs on identical warm rebuild');
      }
      if(exact)check(exact.optimized && ['optimal','feasible'].includes(exact.status),'GLPK silently fell back / unavailable');
      const witness=witnessMinutes(s);if(witness && exact)check(exact.rows.filter(r=>r.kind!=='travel').length>=s.witness.length,'GLPK places fewer occurrences than witness');
      const deficit=exact?Math.max(0,exact.workMinutes-fast.workMinutes):null;
      if(process.argv.includes('--require-parity') && exact){
        check(fast.directGapMinutes<=exact.directGapMinutes+1e-6,'Fast increases direct-link gaps');
        check(fast.workMinutes>=exact.workMinutes,'Fast loses useful minutes');
        for(let p=0;p<6;p++)check(fast.priorityMinutes.slice(0,p+1).reduce((a,b)=>a+b,0)
          >=exact.priorityMinutes.slice(0,p+1).reduce((a,b)=>a+b,0)-1e-6,`Fast loses cumulative P0–P${p} minutes`);
        check(fast.travelMinutes<=exact.travelMinutes+1e-6,'Fast adds travel');
        check(fast.weatherPenalty<=exact.weatherPenalty+1e-6,'Fast worsens weather score');
      }
      const legality=Object.fromEntries(engines.map(engine=>[engine,result.engines[engine].map(run=>
        [...run.violations,...independentViolations(s,run)])]));
      report.results.push({id:s.id,items:s.data.length,days:s.days,witnessMinutes:witness,legality,...result});persist();
      console.log(`${s.id}: Fast ${fast.workMinutes}m / ${Math.round(fast.elapsedMs)}ms; ${exact?`GLPK ${exact.workMinutes}m / ${Math.round(exact.elapsedMs)}ms (${exact.status}); gap ${deficit}m`:'GLPK not run'}`);
    }
    const pairs=report.results.filter(s=>s.engines && s.engines.exact && s.engines.exact[0].optimized
      && ['optimal','feasible'].includes(s.engines.exact[0].status)
      && Object.values(s.legality).every(runs=>runs.every(errors=>!errors.length)));
    const totalMs=(engine,run)=>pairs.reduce((sum,s)=>sum+s.engines[engine][Math.min(run,s.engines[engine].length-1)].elapsedMs,0);
    const priorityRatio=s=>{
      const f=s.engines.fast[0],e=s.engines.exact[0];
      return Math.min(1,...e.priorityMinutes.map((_,p)=>{
        const reference=e.priorityMinutes.slice(0,p+1).reduce((a,b)=>a+b,0);
        return reference ? f.priorityMinutes.slice(0,p+1).reduce((a,b)=>a+b,0)/reference : 1;
      }));
    };
    report.target={referenceCases:pairs.length,totalCases:report.results.length,
      firstSpeedup:pairs.length ? totalMs('exact',0)/totalMs('fast',0) : null,
      repeatSpeedup:pairs.length ? totalMs('exact',1)/totalMs('fast',1) : null,
      worstPriorityPlacementRatio:pairs.length ? Math.min(...pairs.map(priorityRatio)) : null,
      totalPlacementRatio:pairs.length ? pairs.reduce((sum,s)=>sum+s.engines.fast[0].workMinutes,0)
        /pairs.reduce((sum,s)=>sum+s.engines.exact[0].workMinutes,0) : null};
    if(requireTarget){
      if(pairs.length!==report.results.length)failures.push('Target requires legal, optimized GLPK references for every selected case');
      if(!(report.target.firstSpeedup>=5 && report.target.repeatSpeedup>=5))failures.push('Target aggregate rebuild speedup below 5x');
      if(!(report.target.worstPriorityPlacementRatio>=0.95))failures.push('Target loses more than 5% of a priority prefix');
    }
    persist();
    console.log('Target metrics: '+JSON.stringify(report.target));
  }finally{if(browser)await browser.close();if(device)device.close();}
  assert(!failures.length,failures.join('\n'));
  console.log('PASS — legality/oracles; target metrics recorded. Use --require-target or --require-parity for additional gates.');
})().catch(e=>{console.error(e);process.exit(1);});
