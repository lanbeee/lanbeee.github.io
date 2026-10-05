const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    await page.addScriptTag({url:'/tests/helpers/planner-cutoff-audit.js'});
    await page.addScriptTag({url:'/tests/helpers/planner-forecast-audit.js'});
    const report=await page.evaluate(()=>runPlannerForecastAudit());
    fs.mkdirSync('test-results',{recursive:true});
    fs.writeFileSync('test-results/planner-forecast-audit.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify({cases:report.cases.length,drops:report.drops,lateWarnings:report.lateWarnings,
      replays:report.replays,probes:report.probes,forecastMs:report.forecastMs,
      confirmedChecks:report.confirmedChecks,cachedMismatch:report.cachedMismatch}));
    assert.equal(report.cases.length,26);
    assert(report.replays>0,'both engines use complete feasible clock replay');
    assert(report.cases.every(c=>c.forecast.probes===1),'shared batch has a fixed probe cap');
    assert.equal(report.lateWarnings,0,'fifteen-minute warnings match exactly the cached future agenda losses');
    assert.equal(report.lateLeadChecks,0,'every allowed warning uses the same fifteen-minute duration');
    assert.equal(report.cachedMismatch,0,'confirmed losses are absent from the reusable normal week');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
