const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium,BASE}=require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();await page.goto(BASE,{waitUntil:'load'});
    await page.addScriptTag({url:new URL('tests/helpers/planner-cutoff-audit.js',BASE).href});
    const report=await page.evaluate(()=>runPlannerCutoffAudit());
    fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/planner-cutoff-audit.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.summary));
    assert.equal(report.summary.projectionErrors,0,'every configured warning follows its published cutoff minus the chosen lead');
    assert.equal(report.summary.suddenDropErrors,0,'sudden edits warn every dropped actionable item');
    assert.equal(report.summary.missingCutoffs,0,'every displayed occurrence has a finite prediction');
    assert.equal(report.summary.mismatches,0,'predicted cutoff must agree with full rebuilds a minute before and after; see test-results/planner-cutoff-audit.json');
  }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
