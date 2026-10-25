const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = vm.createContext({console,performance,Date});
vm.runInContext(fs.readFileSync(__dirname+'/../js/agenda-optimizer-ilp.js','utf8'),context);
const GLPK = {GLP_UP:3,GLP_FX:5};
const option = (i,start,end,c=i)=>({c:{i:c},fit:{placeStart:start,placeEnd:end},varName:`y${i}`});
function rowsFor(opts){
  const rows=[];context.appendOptimizerOverlapCliques(GLPK,rows,opts);return rows;
}
// Exhaustively compare integer feasibility with the old all-pairs model.
// Include repeated candidates, identical clocks, nesting, and touching edges.
let seed=7491;
const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let fixture=0;fixture<100;fixture++){
  const opts=Array.from({length:9},(_,i)=>{const start=rand(12);return option(i,start,start+1+rand(8),rand(5));});
  const rows=rowsFor(opts);
  for(let mask=0;mask<(1<<opts.length);mask++){
    const selected=opts.filter((_,i)=>mask&(1<<i));
    const unique=new Set(selected.map(o=>o.c.i)).size===selected.length;
    const pairwise=unique && selected.every((a,i)=>selected.slice(i+1).every(b=>
      !(a.fit.placeStart<b.fit.placeEnd && b.fit.placeStart<a.fit.placeEnd)));
    const names=new Set(selected.map(o=>o.varName));
    const clique=unique && rows.every(row=>row.vars.reduce((n,v)=>n+Number(names.has(v.name)),0)<=1);
    assert.strictEqual(clique,pairwise,`fixture ${fixture} mask ${mask}`);
  }
}
assert.strictEqual(rowsFor([option(0,0,10),option(1,10,20)]).length,0,'touching is legal');
const dense=rowsFor(Array.from({length:2000},(_,i)=>option(i,0,60)));
assert.strictEqual(dense.length,1,'one clique replaces 1,999,000 pair rows');
assert.strictEqual(dense[0].vars.length,2000);
assert(3*0.5>dense[0].bnds.ub,'clique cuts fractional triangle allowed by pair rows');
// Isolate solver return handling: both stages must prove their optimum, and
// a failed polish must retain the original feasible placement.
(async()=>{
  for(const selection of [2,5])for(const polish of [2,5,1]){
    const initial={result:{status:selection,vars:{y0:1,z:1}}};
    context.ensureGlpk=async()=>({...GLPK,solve:()=>({result:{status:polish,vars:{y0:1,z:0}}})});
    context.solveDayPackingIlp=()=>({
      result:initial,opts:[{c:{i:0},fill:{h:{hid:'a'}},fit:{placeStart:0},weight:1,varName:'y0'}],
      problem:{objective:{vars:[{name:'y0',coef:1},{name:'z',coef:0}]},subjectTo:[]},
      candidateOptionNames:[[0,['y0']]],routeObjectiveVars:[{name:'z',coef:-1}],nativeLimitSeconds:4
    });
    context.optimizerWeight=()=>1;
    const result=await context.packDayWithOptimizer({},[],[],new Set());
    assert.strictEqual(result.solveStatus,selection===5 && polish===5?'optimal':'feasible');
    assert.strictEqual(result.length,1,'polish preserves selected work');
    assert.strictEqual(result.solveDiagnostics.routePolishApplied,polish===2 || polish===5);
  }
  const {chromium,BASE}=require('./helpers/planner-test-helpers');
  const {qualityScenarios}=require('./helpers/planner-quality-fixtures');
  const {runPlannerQualityScenario}=require('./helpers/planner-quality-runner');
  const {independentViolations}=require('./helpers/planner-quality-validation');
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York',serviceWorkers:'block'});
    await page.goto(BASE);await page.waitForFunction(()=>typeof buildWeekAgendaAsync==='function');
    const workerSource=fs.readFileSync(__dirname+'/helpers/planner-quality-worker.js','utf8');
    for(const scenario of qualityScenarios().filter(s=>['mixed-35','mixed-50'].includes(s.id))){
      const result=await page.evaluate(runPlannerQualityScenario,{scenario,workerSource,engines:['exact'],repeat:true});
      for(const run of result.engines.exact){
        assert(run.optimized,'GLPK incumbent, not fallback');
        assert.deepStrictEqual(run.violations,[]);
        assert.deepStrictEqual(independentViolations(scenario,run),[]);
        assert(run.workMinutes>=(scenario.id==='mixed-35'?2095:2375),'retain complete-agenda work after clique reformulation');
        if(scenario.id==='mixed-35')assert.strictEqual(run.totals['task-27'],20,'recover split task tail exposed by later repairs');
      }
    }
  }finally{await browser.close();}
  console.log('PASS optimizer cliques: 51,200 exhaustive subsets, dense compression, and route proof provenance');
})().catch(error=>{console.error(error);process.exitCode=1;});
