// Uses the same synthetic complex fixtures as the cold cutoff diagnostics.
// Simulate the production clock-only replay path, no completions or edits.
async function runPlannerForecastAudit(){
  const RealDate=Date,base=dayStart(Date.now()),initial=base+9*3600000;
  let clock=initial;
  class FrozenDate extends RealDate{
    constructor(...args){super(...(args.length ? args : [clock]));}
    static now(){return clock;}
  }
  const report={cases:[],probes:0,forecastMs:0,lateWarnings:0,drops:0,replays:0,checked:0,leadChecks:0,lateLeadChecks:0};
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
      let week=await build({}),original=week;
      const owners=data.map(h=>h.hid);
      const forecast=await forecastAgendaRisks(week,data,scenario.settings,exact?'exact':'fast',{owners});
      applyAgendaRiskForecast(week,forecast,data);
      week.forecastRevision=scenario.name;
      report.probes+=forecast.probes;report.forecastMs+=forecast.elapsedMs;
      const prefs={enabled:true,items:Object.fromEntries(owners.map(hid=>[`item:${hid}`,{missed:'notification',missedLeadMinutes:5}]))};
      let events=nativeReminderEvents(week,data,scenario.settings,prefs,clock);
      if(!report.deliverySample)report.deliverySample=events.find(e=>e.reminderEdge==='missed' && e.agendaAt-e.at>=5*60000);
      const leadEvents=Object.fromEntries([5,10,15,30,60].map(lead=>[lead,nativeReminderEvents(week,data,scenario.settings,
        {enabled:true,items:Object.fromEntries(owners.map(hid=>[`item:${hid}`,{missed:'notification',missedLeadMinutes:lead}]))},clock)]));
      const records=new Map();
      for(const row of week.days[0].timeline.filter(r=>r.kind==='fill')){
        const key=agendaForecastIdentity(row,data);
        if(!records.has(key))records.set(key,{key,scheduleOptionId:row.scheduleOptionId || 'main',firstAbsent:null,
          warningAt:leadEvents[5].find(e=>e.owner===`item:${row.h.hid}` && e.reminderEdge==='missed' && (!e.completion ||
            (e.completion.scheduleOptionId || 'main')===(row.scheduleOptionId || 'main')))?.at,
          initialRisk:row.riskAt,staticCutoff:row.dropAt,warningByLead:Object.fromEntries([5,10,15,30,60].map(lead=>
            [lead,leadEvents[lead].find(e=>e.owner===`item:${row.h.hid}` && e.reminderEdge==='missed' && (!e.completion ||
              (e.completion.scheduleOptionId || 'main')===(row.scheduleOptionId || 'main')))?.at]))});
      }
      for(clock=initial+5*60000;clock<base+18*3600000;clock+=5*60000){
        const prior=week;
        const needsFarDays=agendaClockRefreshNeedsFarDays(prior.days[0],clock,data);
        week=await build({dirtyKey:scenario.name,day0Only:!needsFarDays,reuseIncumbent:!needsFarDays,
          memoDays:memoDaysFromWeek(prior),priorPlacements:agendaPriorPlacementsFromWeek(prior)});
        report.replays+=Boolean(week.plannerDiagnostics?.clockReplay);
        week.forecastRevision=scenario.name;
        events=nativeReminderEvents(week,data,scenario.settings,prefs,clock,prior);
        const present=new Set(week.days[0].timeline.filter(r=>r.kind==='fill').map(r=>agendaForecastIdentity(r,data)));
        for(const r of records.values()){
          if(r.firstAbsent!=null)continue;
          if(!present.has(r.key)){
            r.firstAbsent=clock;report.drops++;
            r.timely=Number.isFinite(r.warningAt) && r.warningAt<=Math.max(initial+2000,clock-5*60000+1000);
            if(!r.timely)report.lateWarnings++;
            for(const [lead,at] of Object.entries(r.warningByLead)){
              report.leadChecks++;
              if(!Number.isFinite(at) || at>Math.max(initial+2000,clock-Number(lead)*60000+1000))report.lateLeadChecks++;
            }
          }else{
            const owner=`item:${r.key.split(':')[0]}`;
            const event=events.find(e=>e.owner===owner && e.reminderEdge==='missed' && !e.slipped
              && (!e.completion || (e.completion.scheduleOptionId || 'main')===r.scheduleOptionId));
            // Earliest scheduled warning is retained by receipt history even
            // after delivery; later projection cannot postpone that warning.
            if(event)r.warningAt=Math.min(r.warningAt ?? Infinity,event.at);
            if(event)for(const lead of [5,10,15,30,60])r.warningByLead[lead]=Math.min(r.warningByLead[lead] ?? Infinity,
              Math.max(clock+2000,event.agendaAt-lead*60000));
          }
        }
        report.checked++;
        if([...records.values()].every(r=>r.firstAbsent!=null))break;
      }
      report.cases.push({scenario:scenario.name,engine:exact?'GLPK':'Fast',forecast,
        records:[...records.values()].map(r=>({...r,warningMinute:(r.warningAt-base)/60000,
          firstAbsentMinute:r.firstAbsent==null?null:(r.firstAbsent-base)/60000}))});
      // Forecast execution must not move actual placements or the real clock.
      if(Date.now()!==clock || !original.days.length)throw new Error('Simulation leaked');
    }
    return report;
  }finally{globalThis.Date=RealDate;}
}
