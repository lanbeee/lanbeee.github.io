// Synthetic paired-engine audit: one normal 15-minute future result, reused
// exactly. Estimates intentionally remain armed without forecast verification.
async function runPlannerForecastAudit(closed=false){
  const RealDate=Date,base=dayStart(Date.now()),initial=base+9*3600000;
  let clock=initial;
  class FrozenDate extends RealDate{constructor(...args){super(...(args.length ? args : [clock]));}static now(){return clock;}}
  const report={cases:[],probes:0,forecastMs:0,lateWarnings:0,drops:0,replays:0,checked:0,
    leadChecks:0,lateLeadChecks:0,confirmedChecks:0,cachedMismatch:0,estimated:0,withheldWarnings:0};
  globalThis.Date=FrozenDate;
  try{
    await ensureGlpk();
    const scenarios=plannerCutoffAuditScenarios(base,initial);
    if(!closed)scenarios.push({name:'linked-priority-pair',settings:scenarios[0].settings,data:[
      {hid:'pair-before',name:'Linked predecessor',type:'keepup',target:1,priority:3,durationMinutes:10,
        allowedTimeStart:540,allowedTimeEnd:780,createdAt:base-86400000,logs:[],
        scheduleLinks:[{anchorHid:'pair-anchor',direction:'before',adjacency:'direct',requireSameDay:true}]},
      {hid:'pair-anchor',name:'Narrow anchor',type:'keepup',target:1,priority:0,durationMinutes:20,
        allowedTimeStart:600,allowedTimeEnd:660,createdAt:base-86400000,logs:[]},
      {hid:'pair-flex',name:'Flexible competitor',type:'keepup',target:1,priority:5,durationMinutes:45,
        allowedTimeStart:540,allowedTimeEnd:780,createdAt:base-86400000,logs:[]}]});
    for(const scenario of scenarios)for(const exact of [false,true]){
      clock=initial;localStorage.clear();sortSettings=scenario.settings;
      const data=normalize(scenario.data);localStorage.setItem(KEY,JSON.stringify(data));
      localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(scenario.settings));
      const build=opts=>exact ? buildWeekAgendaAsync(data,scenario.settings,7,opts) : buildWeekAgenda(data,scenario.settings,7,opts);
      const original=await build({}),owners=data.map(h=>h.hid);
      const prefs={enabled:true,items:Object.fromEntries(owners.map(hid=>[`item:${hid}`,{missed:'alarm'}]))};
      const cutoffs=original.days[0].timeline.filter(r=>r.kind==='fill' && Number.isFinite(r.dropAt)).map(r=>r.dropAt);
      const samples=[...new Set([initial,...cutoffs.slice(0,3).map(at=>Math.max(initial,at-10*60000))])];
      let lastForecast;
      for(const sample of samples){
        clock=sample;
        const week=await build({reuseIncumbent:true,memoDays:memoDaysFromWeek(original)});
        if(!week.days[0].timeline.some(r=>['fill','scheduled'].includes(r.kind)))continue;
        const plan=agendaForecastPlanKey(week,data);
        const packet=await (closed ? forecastClosedAgendaRisks : forecastAgendaRisks)(week,data,scenario.settings,exact?'exact':'fast',{owners});
        const forecast=closed ? packet.nearForecast : packet;
        forecast.revision=scenario.name;forecast.warningAt=sample+2000;
        applyAgendaRiskForecast(week,forecast,data);week.forecastRevision=scenario.name;
        if(clock!==sample || Date.now()!==sample || plan!==agendaForecastPlanKey(week,data))throw new Error('Simulation mutated source');
        if(forecast.probes!==1 || forecast.futureWeek.days.length!==7)throw new Error(`Must use one normal week build ${scenario.name} ${exact} ${new RealDate(sample).toISOString()} probes=${forecast.probes} days=${forecast.futureWeek?.days.length}`);
        const reused=consumeAgendaDropForecast(week,data,scenario.name,forecast.targetAt);
        if(!reused || agendaForecastPlanKey(reused,data)!==agendaForecastPlanKey(forecast.futureWeek,data))throw new Error('Normal future result not reused');
        if(consumeAgendaDropForecast(week,data,scenario.name+'-edit',forecast.targetAt))throw new Error('Stale revision reused');
        const events=nativeReminderEvents(week,data,scenario.settings,prefs,sample).filter(e=>e.reminderEdge==='missed');
        for(const event of events){
          if(event.delivery!=='alarm' || event.at>=event.agendaAt)throw new Error('Invalid drop alarm');
          if(event.estimated){report.estimated++;continue;}
          report.leadChecks++;
          if(event.at!==sample+2000 || event.agendaAt!==forecast.targetAt){report.lateLeadChecks++;report.lateWarnings++;}
          if(!report.deliverySample)report.deliverySample=event;
        }
        const futureKeys=new Set(forecast.futureWeek.days[0].timeline.filter(r=>['fill','scheduled'].includes(r.kind)).map(r=>agendaForecastIdentity(r,data)));
        for(const [key,risk] of Object.entries(forecast.risks)){
          report.drops++;report.confirmedChecks++;
          if(futureKeys.has(key))report.cachedMismatch++;
          if(risk.at!==forecast.targetAt)throw new Error('Loss outside shared 15-minute sample');
        }
        if(!report.deliverySample && events.length)report.deliverySample=events[0];
        report.probes++;report.replays+=forecast.replayProbes;report.forecastMs+=forecast.elapsedMs;report.checked++;lastForecast=forecast;
      }
      const {futureWeek,...diagnostics}=lastForecast;
      report.cases.push({scenario:scenario.name,engine:exact?'GLPK':'Fast',forecast:diagnostics});
    }
    return report;
  }finally{globalThis.Date=RealDate;}
}
async function runPlannerClosedForecastAudit(){
  const full=await runPlannerForecastAudit(true);
  return {cases:full.cases.map(c=>({...c,probes:1})),warnings:full.estimated+full.leadChecks,
    estimated:full.estimated,cachedMismatch:full.cachedMismatch,probes:full.probes,
    verificationProbes:0,elapsedMs:full.forecastMs,deliverySample:full.deliverySample};
}
