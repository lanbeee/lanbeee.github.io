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
    const report=await page.evaluate(()=>runPlannerClosedForecastAudit());
    fs.mkdirSync('test-results',{recursive:true});
    fs.writeFileSync('test-results/planner-closed-forecast-audit.json',JSON.stringify(report,null,2));
    assert.equal(report.cases.length,24);
    assert(report.warnings>0,'complex future losses produce closed-app warnings');
    assert.equal(report.returned,0,'no queued warning may return on an independent production rebuild');
    assert.equal(report.alreadyAbsent,0,'warned items must still fit a minute before the predicted cutoff');
    assert(report.cases.every(c=>c.probes<=12),'closed preparation has a fixed today-only cap');
    console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
