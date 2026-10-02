const assert=require('node:assert/strict');
const {chromium}=require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'UTC'});
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'load'});
    const result=await page.evaluate(async()=>{
      const now=Date.now(),settings={...loadSortSettings(),agendaOptimizer:false,locations:[],travel:{},
        blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},availabilityMinutes:Array(7).fill(1440)};
      const data=normalize(Array.from({length:12},(_,i)=>({hid:`worker-${i}`,name:`Synthetic ${i}`,type:'keepup',
        target:1,priority:i%6,durationMinutes:1,createdAt:now-86400000,logs:[]})));
      localStorage.setItem(KEY,JSON.stringify(data));sortSettings=settings;
      const week=await buildWeekAgendaOffMain(data,settings,7,'fast');
      rehydrateAgendaWeekHabits(week,data);
      const plan=agendaForecastPlanKey(week,data),clock=Date.now();
      const owners=data.map(h=>h.hid);
      const first=await forecastAgendaOffMain(week,data,settings,'fast','worker-test',owners);
      const again=await forecastAgendaOffMain(week,data,settings,'fast','worker-test',owners);
      const untouched=plan===agendaForecastPlanKey(week,data);
      const pending=forecastAgendaOffMain(week,data,settings,'fast','cancel-test',owners);
      cancelAgendaRiskForecast('test cancellation');
      const cancelled=await pending;
      const recovered=await buildWeekAgendaOffMain(data,settings,7,'fast');
      const none=await forecastAgendaOffMain(week,data,settings,'fast','disabled-test',[]);
      // Simulate a stuck worker without burning a real solve for 900 ms.
      const realWorker=_plannerWorker;
      let terminated=false;
      _plannerWorker={postMessage(){},terminate(){terminated=true;}};
      const stuck=forecastAgendaOffMain(week,data,settings,'fast','timeout-test',owners);
      _plannerWorkerRequests.get(_agendaForecastRequest.id).progress({risks:{'worker-0:main':{at:clock+600000}},
        probes:1,replayProbes:1,checkedAt:clock});
      const exhausted=await stuck;
      _plannerWorker=realWorker;
      const exhaustedAgain=await forecastAgendaOffMain(week,data,settings,'fast','timeout-test',owners);
      return {first,reused:first===again,untouched,clockReal:Date.now()>=clock,cancelled,
        recovered:recovered.days.length,pending:_plannerWorkerRequests.size,none,terminated,
        retained:exhausted.risks['worker-0:main'].at===clock+600000,
        exhaustedCached:exhausted===exhaustedAgain,budgetExhausted:exhausted.budgetExhausted};
    });
    assert(result.first,'real worker returns evidence');
    assert(result.first.probes<=6);
    assert(result.first.elapsedMs<=900,'production request has a hard wall-time cap');
    assert(result.reused,'unchanged inputs reuse the same evidence without more computation');
    assert(result.untouched && result.clockReal,'simulation does not change real rows or clock');
    assert.equal(result.cancelled,null);
    assert.equal(result.pending,0);
    assert.equal(result.recovered,7,'foreground planning works after terminating a forecast');
    assert.equal(result.none,null,'no before-Missed choices means no forecasting');
    assert(result.terminated && result.retained && result.budgetExhausted,'deadline terminates work and preserves partial evidence');
    assert(result.exhaustedCached,'budget exhaustion is cached, rather than retried every minute');
    console.log(`PASS: real worker forecast ${result.first.elapsedMs}ms, ${result.first.probes} solves, ${result.first.replayProbes} cheap replays; cache, cancellation and isolation`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
