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
      const revision=homePlannerDirtyKey(data);
      const first=await forecastAgendaOffMain(week,data,settings,'fast',revision,owners);
      const again=await forecastAgendaOffMain(week,data,settings,'fast',revision,owners);
      applyAgendaRiskForecast(week,first,data);week.forecastRevision=revision;
      const oldNow=Date.now,oldRender=render,oldQueue=queueOptimizedHomeRender,oldMounted=_homeRenderedWeek;
      let renders=0,solves=0,reusedByTick=false;
      try{
        _homeRenderedWeek=week;_optimizerHomeRequestKey='';
        render=opts=>{renders++;_homeRenderedWeek=opts.__optimizedWeek;};
        queueOptimizedHomeRender=()=>{solves++;};
        Date.now=()=>first.targetAt;
        tickHomeAgendaWhileOpen();
        reusedByTick=renders===1 && solves===0 && _homeRenderedWeek.days.length===7
          && agendaForecastPlanKey(_homeRenderedWeek,data)===agendaForecastPlanKey(first.futureWeek,data);
      }finally{Date.now=oldNow;render=oldRender;queueOptimizedHomeRender=oldQueue;_homeRenderedWeek=oldMounted;}
      const invalidated=!consumeAgendaDropForecast(week,data,revision+'changed',first.targetAt)
        && !consumeAgendaDropForecast(week,data,revision,first.targetAt-1)
        && !consumeAgendaDropForecast(week,data,revision,first.targetAt+60001);
      const provenanceWeek={...week,optimized:true,plannerSolveStatus:'feasible',
        plannerDiagnostics:{daySolves:[{dayKey:week.days[1].dayKey,phase:'fixed-pack',status:'feasible'}]},
        dropForecast:{...week.dropForecast,normalWeek:false,futureWeek:{...first.futureWeek,optimized:true,plannerSolveStatus:'optimal'}}};
      const provenance=consumeAgendaDropForecast(provenanceWeek,data,revision,first.targetAt);
      const lean=leanAgendaWeek(week);
      const persisted=Boolean(lean.dropForecast?.futureWeek && !lean.dropForecast.futureWeek.days[0].timeline.some(r=>r.h));
      plannerPerfResetTryPlace();
      const preferences={enabled:true,items:Object.fromEntries(owners.map(hid=>[`item:${hid}`,{missed:'notification'}]))};
      for(let i=0;i<20;i++)nativeReminderEvents(week,data,settings,preferences,clock+i*1000);
      const uiPlacements=_plannerPerfTryPlace;
      const untouched=plan===agendaForecastPlanKey(week,data);
      const pending=forecastAgendaOffMain(week,data,settings,'fast','cancel-test',owners);
      cancelAgendaRiskForecast('test cancellation');
      const cancelled=await pending;
      const recovered=await buildWeekAgendaOffMain(data,settings,7,'fast');
      const none=await forecastAgendaOffMain(week,data,settings,'fast','disabled-test',[]);
      // Simulate a stuck worker without burning a real solve for five seconds.
      const realWorker=_plannerWorker;
      let terminated=false;
      _plannerWorker={postMessage(){},terminate(){terminated=true;}};
      const stuck=forecastAgendaOffMain(week,data,settings,'fast','timeout-test',owners);
      const exhausted=await stuck;
      _plannerWorker=realWorker;
      const exhaustedAgain=await forecastAgendaOffMain(week,data,settings,'fast','timeout-test',owners);
      let closedTerminated=false;
      _plannerWorker={postMessage(message){
        _plannerWorkerRequests.get(message.id).progress({kind:'closed',checkedAt:Date.now(),throughAt:Date.now()+300000,
          planKey:plan,risks:{},probes:1,verificationProbes:0});
      },terminate(){closedTerminated=true;}};
      const closedPartial=await forecastClosedAgendaOffMain(week,data,settings,'fast','closed-timeout',owners);
      _plannerWorker=realWorker;
      return {first,reusedByTick,invalidated,provenance,persisted,uiPlacements,reused:first===again,untouched,clockReal:Date.now()>=clock,cancelled,
        recovered:recovered.days.length,pending:_plannerWorkerRequests.size,none,terminated,
        retained:!exhaustedAgain.futureWeek && Object.keys(exhaustedAgain.risks).length===0,
        exhaustedCached:exhausted===null && exhaustedAgain.budgetExhausted,budgetExhausted:exhaustedAgain.budgetExhausted,
        closedTerminated,closedPartial};
    });
    assert(result.first,'real worker returns evidence');
    assert(result.first.probes===1);
    assert(result.first.elapsedMs<=5000,'production request has a hard wall-time cap');
    assert(result.reusedByTick,'the real home tick displays the cached today result without another solve');
    assert(result.invalidated && result.persisted,'reuse rejects changed/early/stale input and persists only lean future rows');
    assert.equal(result.provenance.plannerSolveStatus,'feasible','today-only optimal output cannot certify unproved far days');
    assert(result.provenance.plannerDiagnostics.daySolves.some(s=>s.status==='feasible'),'far-day solve evidence is preserved');
    assert.equal(result.uiPlacements,0,'twenty reminder checks do no placement on the UI thread');
    assert(result.reused,'unchanged inputs reuse the same evidence without more computation');
    assert(result.untouched && result.clockReal,'simulation does not change real rows or clock');
    assert.equal(result.cancelled,null);
    assert.equal(result.pending,0);
    assert.equal(result.recovered,7,'foreground planning works after terminating a forecast');
    assert.equal(result.none,null,'no before-Missed choices means no forecasting');
    assert(result.terminated && result.retained && result.budgetExhausted,'deadline terminates work without manufacturing an early warning');
    assert(result.exhaustedCached,'budget exhaustion is cached, rather than retried every minute');
    assert(result.closedTerminated && result.closedPartial.budgetExhausted,'closed preparation terminates unfinished computation');
    assert.equal(result.closedPartial.probes,1,'only completed closed samples survive the deadline');
    assert.equal(Object.keys(result.closedPartial.risks).length,0,'unfinished verification cannot manufacture closed warnings');
    console.log(`PASS: real worker forecast ${result.first.elapsedMs}ms, ${result.first.probes} solves, ${result.first.replayProbes} cheap replays; cache, cancellation and isolation`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
