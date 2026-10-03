// Uses the same synthetic complex fixtures as the cold cutoff diagnostics.
// Simulate the production clock-only replay path, no completions or edits.
async function runPlannerForecastAudit(){
  const RealDate=Date,base=dayStart(Date.now()),initial=base+9*3600000;
  let clock=initial;
  class FrozenDate extends RealDate{
    constructor(...args){super(...(args.length ? args : [clock]));}
    static now(){return clock;}
  }
  const report={cases:[],probes:0,forecastMs:0,lateWarnings:0,drops:0,replays:0,checked:0,leadChecks:0,lateLeadChecks:0,
    rebuiltChecks:0,returnedAfterDrop:0,withheldWarnings:0};
  globalThis.Date=FrozenDate;
  try{
    await ensureGlpk();
    const scenarios=plannerCutoffAuditScenarios(base,initial);
    const linkedSettings=scenarios[0].settings;
    scenarios.push({name:'linked-priority-pair',settings:linkedSettings,data:[
      {hid:'pair-before',name:'Synthetic linked predecessor',type:'keepup',target:1,priority:3,durationMinutes:10,
        allowedTimeStart:540,allowedTimeEnd:780,createdAt:base-86400000,logs:[],
        scheduleLinks:[{anchorHid:'pair-anchor',direction:'before',adjacency:'direct',requireSameDay:true}]},
      {hid:'pair-anchor',name:'Synthetic narrow anchor',type:'keepup',target:1,priority:0,durationMinutes:20,
        allowedTimeStart:600,allowedTimeEnd:660,createdAt:base-86400000,logs:[]},
      {hid:'pair-flex',name:'Synthetic flexible competitor',type:'keepup',target:1,priority:5,durationMinutes:45,
        allowedTimeStart:540,allowedTimeEnd:780,createdAt:base-86400000,logs:[]} ]});
    for(const scenario of scenarios)for(const exact of [false,true]){
      clock=initial;localStorage.clear();sortSettings=scenario.settings;
      const data=normalize(scenario.data);
      localStorage.setItem(KEY,JSON.stringify(data));
      localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(scenario.settings));
      const build=opts=>exact ? buildWeekAgendaAsync(data,scenario.settings,7,opts) : buildWeekAgenda(data,scenario.settings,7,opts);
      const original=await build({});
      const owners=data.map(h=>h.hid);
      const prefs={enabled:true,items:Object.fromEntries(owners.map(hid=>[`item:${hid}`,{missed:'notification'}]))};
      const cutoffs=original.days[0].timeline.filter(r=>r.kind==='fill' && Number.isFinite(r.dropAt)).map(r=>r.dropAt);
      const clocks=[initial,...cutoffs.map(t=>Math.max(initial,t-5*60000))];
      const samples=[...new Set(clocks)].sort((a,b)=>a-b);
      const selected=samples.length<=4 ? samples : [samples[0],samples[1],samples[Math.floor(samples.length/2)],samples.at(-1)];
      const records=[];let lastForecast={probes:0};
      for(const sample of selected){
        clock=sample;
        const week=await build({day0Only:true,reuseIncumbent:true,memoDays:memoDaysFromWeek(original)});
        if(dayStart(ceilToMinutes(clock+1,5)+1)!==base || !week.days[0].timeline.some(r=>['fill','scheduled'].includes(r.kind)))continue;
        const plan=agendaForecastPlanKey(week,data);
        const firstSubject=week.days[0].timeline.find(r=>['fill','scheduled'].includes(r.kind));
        const forecast=await forecastAgendaRisks(week,data,scenario.settings,exact?'exact':'fast',
          {owners:[firstSubject.h?.hid || data[firstSubject.i]?.hid]});
        if(Date.now()!==sample || agendaForecastPlanKey(week,data)!==plan)throw new Error('Lookahead mutated current clock/agenda');
        if(forecast.probes!==1 || forecast.futureWeek.days.length!==1)throw new Error('Only one today build allowed');
        forecast.revision=scenario.name;applyAgendaRiskForecast(week,forecast,data);week.forecastRevision=scenario.name;
        const events=nativeReminderEvents(week,data,scenario.settings,prefs,clock).filter(e=>!e.slipped && e.reminderEdge==='missed');
        const futureSet=new Set(forecast.futureWeek.days[0].timeline.filter(r=>['fill','scheduled'].includes(r.kind))
          .map(r=>agendaForecastIdentity(r,data)));
        // Independently run the normal planner a minute after the projected
        // drop, rather than only comparing the forecast to its own cache.
        clock=forecast.targetAt+60000;
        const after=await build({day0Only:!forecast.requiresWeekReplan,reuseIncumbent:true,
          memoDays:memoDaysFromWeek(week),incumbentSolveStatus:week.plannerSolveStatus,glpkLimitSeconds:4});
        const afterSet=new Set(after.days[0].timeline.filter(r=>['fill','scheduled'].includes(r.kind))
          .map(r=>agendaForecastIdentity(r,data)));
        for(const key of Object.keys(forecast.risks)){
          report.rebuiltChecks++;if(afterSet.has(key))report.returnedAfterDrop++;
        }
        clock=sample;
        report.probes+=forecast.probes;report.replays+=forecast.replayProbes;report.forecastMs+=forecast.elapsedMs;
        const reused=consumeAgendaDropForecast(week,data,scenario.name,forecast.targetAt);
        if(forecast.requiresWeekReplan){
          if(reused)throw new Error('A dropped movable must reopen full-week planning');
        }else if(!reused || reused.days.length!==7 || agendaForecastPlanKey(reused,data)!==agendaForecastPlanKey(forecast.futureWeek,data))
          throw new Error('Future agenda was not reused exactly with far days preserved');
        if(consumeAgendaDropForecast(week,data,scenario.name+'-edit',forecast.targetAt))throw new Error('Stale edit reused');
        const expected=new Set();
        for(const row of week.days[0].timeline.filter(r=>['fill','scheduled'].includes(r.kind))){
          const key=agendaForecastIdentity(row,data),h=row.h || data[row.i];
          if(futureSet.has(key))continue;
          report.drops++;
          if(!forecast.risks[key])report.withheldWarnings++;
          const canWarn=Boolean(forecast.risks[key])
            && clock+2000>=nativeReminderAllowedWarningAt(h,row,week.days[0],scenario.settings,clock);
          if(canWarn)expected.add(key);
          const event=events.find(e=>e.owner===`item:${h.hid}` && (!e.completion ||
            (e.completion.scheduleOptionId || 'main')===(row.scheduleOptionId || 'main')));
          const timely=!canWarn || Boolean(event && event.at===clock+2000 && event.agendaAt===forecast.targetAt);
          if(!timely)report.lateWarnings++;
          report.leadChecks++;if(!timely)report.lateLeadChecks++;
          records.push({key,firstAbsent:forecast.targetAt,warningAt:event?.at,timely,allowedGuard:!canWarn,
            returnedOnIndependentRebuild:afterSet.has(key)});
        }
        for(const event of events){
          if(event.agendaAt!==forecast.targetAt || event.at!==clock+2000)throw new Error('Warning outside five-minute horizon');
          if(!report.deliverySample)report.deliverySample=event;
        }
        if(events.length!==new Set([...expected].map(key=>{
          const h=data.find(h=>key.startsWith(h.hid+':'));
          return h?.breakable ? h.hid : key;
        })).size)throw new Error('Warning count differs from actual future losses');
        report.checked++;lastForecast=forecast;
      }
      // Keep the shared Pixel report compact: the actual reusable day is
      // checked above, rather than serialized for every synthetic fixture.
      const {futureWeek,...diagnostics}=lastForecast;
      report.cases.push({scenario:scenario.name,engine:exact?'GLPK':'Fast',forecast:diagnostics,records});
    }
    return report;
  }finally{globalThis.Date=RealDate;}
}

// Closed delivery checks a wider bounded horizon but queues only losses which
// also survive an independent ordinary rebuild. No phone/app storage is used.
async function runPlannerClosedForecastAudit(){
  const RealDate=Date,base=dayStart(Date.now()),initial=base+9*3600000;
  let clock=initial;
  class FrozenDate extends RealDate{
    constructor(...args){super(...(args.length ? args : [clock]));}
    static now(){return clock;}
  }
  const report={cases:[],warnings:0,returned:0,alreadyAbsent:0,probes:0,verificationProbes:0,elapsedMs:0};
  globalThis.Date=FrozenDate;
  try{
    await ensureGlpk();
    for(const scenario of plannerCutoffAuditScenarios(base,initial))for(const exact of [false,true]){
      clock=initial;localStorage.clear();sortSettings=scenario.settings;
      const data=normalize(scenario.data);
      localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(scenario.settings));
      const mode=exact?'exact':'fast',build=opts=>exact ? buildWeekAgendaAsync(data,scenario.settings,7,opts)
        : buildWeekAgenda(data,scenario.settings,7,opts);
      const original=await build({});
      const firstCutoff=Math.min(...original.days[0].timeline.filter(r=>r.kind==='fill' && Number.isFinite(r.dropAt)).map(r=>r.dropAt));
      clock=Number.isFinite(firstCutoff) ? Math.max(initial,firstCutoff-20*60000) : initial;
      const sample=clock,week=await build({day0Only:true,reuseIncumbent:true,memoDays:memoDaysFromWeek(original)});
      const plan=agendaForecastPlanKey(week,data);
      const forecast=await forecastClosedAgendaRisks(week,data,scenario.settings,mode,{owners:data.map(h=>h.hid)});
      if(clock!==sample || Date.now()!==sample || plan!==agendaForecastPlanKey(week,data))throw new Error('Closed simulation mutated live context');
      if(forecast.probes>12 || dayStart(forecast.throughAt)!==base)throw new Error('Closed horizon exceeded today or probe cap');
      report.probes+=forecast.probes;report.verificationProbes+=forecast.verificationProbes;report.elapsedMs+=forecast.elapsedMs;
      const prefs={enabled:true,items:Object.fromEntries(data.map((h,i)=>['item:'+h.hid,{missed:i%2?'alarm':'notification'}]))};
      forecast.revision='closed-audit';forecast.warningAt=sample+2000;
      week.closedDropForecast=forecast;week.forecastRevision=forecast.revision;
      const events=nativeReminderEvents(week,data,scenario.settings,prefs,sample).filter(e=>e.reminderEdge==='missed');
      for(const [key,risk] of Object.entries(forecast.risks)){
        if(!risk.verified || risk.warningAt!==risk.at-5*60000)throw new Error('Unverified/early closed alert');
        clock=risk.at-60000;
        const before=await build({day0Only:!agendaClockRefreshNeedsFarDays(week.days[0],clock,data),reuseIncumbent:true,
          memoDays:memoDaysFromWeek(week),incumbentSolveStatus:week.plannerSolveStatus,glpkLimitSeconds:4});
        if(!before.days[0].timeline.some(r=>['fill','scheduled'].includes(r.kind) && agendaForecastIdentity(r,data)===key))report.alreadyAbsent++;
        clock=risk.at+60000;
        const after=await build({day0Only:!agendaClockRefreshNeedsFarDays(week.days[0],clock,data),reuseIncumbent:true,
          memoDays:memoDaysFromWeek(week),incumbentSolveStatus:week.plannerSolveStatus,glpkLimitSeconds:4});
        if(after.days[0].timeline.some(r=>['fill','scheduled'].includes(r.kind) && agendaForecastIdentity(r,data)===key))report.returned++;
      }
      clock=sample;
      for(const event of events){
        if(event.agendaAt-event.at>5*60000 || event.at<sample || event.agendaAt>forecast.throughAt)throw new Error('Wrong closed warning clock');
        if(!report.deliverySample)report.deliverySample=event;
      }
      report.warnings+=events.length;
      report.cases.push({scenario:scenario.name,engine:mode,probes:forecast.probes,verificationProbes:forecast.verificationProbes,
        warnings:events.length,budgetExhausted:forecast.budgetExhausted});
    }
    return report;
  }finally{globalThis.Date=RealDate;}
}
