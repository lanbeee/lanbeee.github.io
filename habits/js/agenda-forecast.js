// Shared by both engines, the visible app and Android's background worker.
// A risk estimate is evidence for a warning, never authority to delete work.
const AGENDA_FORECAST_MAX_PROBES = 1;
const AGENDA_FORECAST_TIMEOUT_MS = 5000;

function agendaForecastIdentity(row,data){
  return `${row.hid || row.h?.hid || data[row.i]?.hid}:${row.scheduleOptionId || 'main'}`;
}
function agendaForecastPlanKey(week,data){
  return JSON.stringify((week.days?.[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
    .map(r=>[agendaForecastIdentity(r,data),r.start,r.end,r.locationId || null]));
}
function agendaClockRefreshNeedsFarDays(day,now,data = []){
  return (day?.timeline || []).some(row=>{
    if(row.kind!=='fill')return false;
    const h=row.h || data[row.i];
    const expired=row.end<=now || (Number.isFinite(row.dropAt) && row.dropAt<=now);
    return expired && (!h || !h.type || h.type==='task' || Number(h.target)>1);
  });
}

// Clock-only rebuilds can cheaply keep ALL displayed unfinished work. This is
// transactional: invalid context uses the normal engine. An expired ordinary
// occurrence may leave while feasible selected work stays, with priority intact.
// Linked/option groups use the engine's existing coupled placement policy.
function replayAgendaClockWeek(data,settings,count,opts = {}){
  if(!opts.reuseIncumbent || opts.refine || !opts.memoDays?.length)return null;
  const now=Date.now(),prior=opts.memoDays[0];
  if(prior.dayBase!==dayStart(now) || opts.memoDays.length<count)return null;
  if(data.some(h=>h.snoozedUntil && h.snoozedUntil<=now
    && (!prior.plannedAt || h.snoozedUntil>prior.plannedAt)))return null;
  if(plannerOrderConstraintsForDay(prior.dayBase).length || doingNowForDay({dayBase:prior.dayBase}))return null;
  const rows=(prior.timeline || []).filter(r=>r.kind==='fill');
  if(!rows.length || rows.length>64)return null;
  const started=performance.now(),day=buildDayAgenda(data,settings,prior.dayBase,{weekMode:true,now});
  const state=createDayPlacementState(day,settings,{now,weekMode:true});
  const omitted=[];
  beginPlannerSolveCaches(data);
  try{
    // On clock-only refreshes, preserve selection ahead of soft clock scores.
    // A genuinely expired row need not evict its still-feasible siblings.
    // Priority wins when delay has made keeping the whole pack impossible.
    for(const row of rows.slice().sort((a,b)=>effectivePriority(data[a.i])-effectivePriority(data[b.i]) || a.start-b.start)){
      if(performance.now()-started>12)return null;
      const h=data[row.i];
      if(!h || (row.hid && h.hid!==row.hid) || hasHabitScheduleOptions(h))return null;
      if(completedOnDay(h,prior.dayBase) || (h.snoozedUntil && now<h.snoozedUntil))return null;
      const pinnedDay=plannerPinnedDayBase(h,settings,prior.dayBase);
      if(!weekFillEligibleOnDay(h,settings,prior.dayBase,day.weekday,pinnedDay))return null;
      const fill={h,i:row.i,priority:effectivePriority(h),locationId:row.locationId,
        scarcity:prior.agendaItems?.find(item=>item.i===row.i)?.scarcity,chunkIndex:row.chunkIndex,
        placeKey:`replay:${row.i}:${row.start}`,occurrenceKey:row.occurrenceKey,
        chunkMinutes:h.breakable ? (row.end-row.start)/60000 : undefined};
      const probe=clonePlacementState(state);
      probe.startClock=Math.max(state.startClock,row.start);
      const fit=tryPlaceOnDay(probe,fill,{allowNetwork:false,settings,replayEarliest:true});
      if(!fit){omitted.push(row);continue;}
      commitPlacement(state,fill,fit);
      // Preserve warning evidence across a clock tick; it cannot slide away.
      const placedRow=state.rows.find(r=>r.kind==='fill' && r.i===row.i && r.start===fit.placeStart && r.end===fit.placeEnd);
      Object.assign(placedRow,{riskAt:row.riskAt,
        riskReason:row.riskReason,riskCheckedAt:row.riskCheckedAt,riskValidated:row.riskValidated,dropAt:row.dropAt});
    }
    day.timeline=finalizePlacementRows(state);
    // A full-week refresh must reconsider days for unfinished movable work.
    // Do not hide that obligation behind a frozen far-day replay.
    if(!opts.day0Only && omitted.some(row=>data[row.i]?.type==='task' || Number(data[row.i]?.target)>1))return null;
    day.agendaItems=state.fills.map(entry=>({...entry.fill,start:entry.fit.placeStart,end:entry.fit.placeEnd}));
    day.usedMinutes=state.usedMinutes;
    day.remainingMinutes=Math.max(0,day.totalMinutes-state.usedMinutes);
    day.travelSeconds=day.timeline.filter(r=>r.kind==='travel').reduce((n,r)=>n+(r.seconds || 0),0);
    const days=[day,...opts.memoDays.slice(1,count)];
    const placementKey=timeline=>JSON.stringify((timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
      .map(r=>[r.i,r.start,r.end,r.locationId || null,r.scheduleOptionId || null]));
    const unchanged=placementKey(day.timeline)===placementKey(prior.timeline);
    return {days,totalTravelSeconds:days.reduce((n,d)=>n+(d.travelSeconds || 0),0),
      optimized:false,plannerSolveStatus:unchanged ? opts.incumbentSolveStatus || 'feasible' : 'feasible',fastPlannerAlgorithm:'bounded-state-graph',
      plannerDiagnostics:{clockReplay:true,omitted:omitted.length,solveDurationMs:Math.round(performance.now()-started)}};
  }finally{endPlannerSolveCaches();}
}

// One rolling lookahead, in the existing worker. Completed work is never
// assumed; this is the agenda we can display at targetAt if inputs stay put.
const AGENDA_DROP_WARNING_MINUTES = 5;
function agendaForecastSelectionConfirmed(week){
  return week.plannerDiagnostics?.clockReplay || week.plannerSolveStatus==='optimal'
    || (week.plannerDiagnostics?.daySolves || []).some(day=>day.dayKey===week.days?.[0]?.dayKey
      && day.phase==='fixed-pack' && day.status==='optimal');
}
async function forecastAgendaRisks(week,data,settings,mode,opts = {}){
  const RealDate=Date,now=RealDate.now();
  // The planner rounds starts to five-minute slots. Include the first instant
  // after the next boundary: sampling exactly on it can still show a final
  // feasible start and miss the loss one millisecond later.
  const targetAt=opts.targetAt ?? (ceilToMinutes(now+1,AGENDA_DROP_WARNING_MINUTES)+1);
  const day=week.days?.[0];
  const result={risks:{},probes:0,replayProbes:0,elapsedMs:0,budgetExhausted:false,
    checkedAt:now,targetAt,planKey:agendaForecastPlanKey(week,data)};
  if(!day || day.dayBase!==dayStart(now) || dayStart(targetAt)!==day.dayBase)return result;
  const enabled=new Set(opts.owners || []);
  const subjects=(day.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind));
  if(!subjects.some(r=>enabled.has(r.hid || r.h?.hid || data[r.i]?.hid)))return result;
  // One build covers every displayed occurrence. Changing a per-item delivery
  // choice can use this evidence immediately without another planner run.
  const started=performance.now(),savedMemo=_plannerWeekDayMemo;
  let planningAt=targetAt;
  class PlanningDate extends RealDate{
    constructor(...args){super(...(args.length ? args : [planningAt]));}
    static now(){return planningAt;}
  }
  globalThis.Date=PlanningDate;
  try{
    // Far days remain cached. This build asks only about today's remaining
    // opportunity; ordinary full-week planning still owns task deferral.
    const buildOpts={dirtyKey:'drop-lookahead',day0Only:true,reuseIncumbent:true,
      memoDays:memoDaysFromWeek(week),priorPlacements:agendaPriorPlacementsFromWeek(week),
      incumbentSolveStatus:week.plannerSolveStatus || '',glpkLimitSeconds:4};
    const future=mode==='exact' ? await buildWeekAgendaAsync(data,settings,1,buildOpts)
      : buildWeekAgenda(data,settings,1,buildOpts);
    result.probes=1;result.replayProbes=Number(Boolean(future.plannerDiagnostics?.clockReplay));
    result.futureWeek=leanAgendaWeek(future);
    const present=new Set((future.days[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
      .map(r=>agendaForecastIdentity(r,data)));
    // Moving unfinished tasks/sparse rhythms to another day still needs the
    // normal full-week planner. A today-only warning must not freeze that work
    // out of tomorrow by replacing its original today row prematurely.
    result.requiresWeekReplan=(day.timeline || []).some(row=>{
      const h=row.h || data[row.i];
      return row.kind==='fill' && !present.has(agendaForecastIdentity(row,data))
        && h && (h.type==='task' || Number(h.target)>1);
    });
    for(const row of subjects){
      const key=agendaForecastIdentity(row,data);
      if(!present.has(key))result.risks[key]={at:targetAt,absentAt:targetAt,reason:'five-minute-loss',validated:true};
    }
    if(result.requiresWeekReplan && opts.verifyMovableLoss!==false){
      // A today-only pack can lose a task which the actual full-week refresh
      // restores. Confirm its selection before issuing the warning.
      planningAt=targetAt+60000;
      const checked=mode==='exact' ? await buildWeekAgendaAsync(data,settings,7,{...buildOpts,day0Only:false})
        : buildWeekAgenda(data,settings,7,{...buildOpts,day0Only:false});
      result.verificationProbes=1;
      const returned=new Set((checked.days[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
        .map(r=>agendaForecastIdentity(r,data)));
      for(const row of subjects){
        const key=agendaForecastIdentity(row,data);
        if(returned.has(key) || (mode==='exact' && !agendaForecastSelectionConfirmed(checked)))delete result.risks[key];
      }
    }
  }finally{
    globalThis.Date=RealDate;_plannerWeekDayMemo=savedMemo;endPlannerSolveCaches();
    result.elapsedMs=Math.round(performance.now()-started);
  }
  return result;
}

// Closed Android pre-schedules alerts between its existing periodic refreshes.
// All samples run in one worker, today only. A loss must also survive a normal
// rebuild from the original agenda a minute after the predicted clock; chained
// simulations alone are not sufficient evidence for a queued warning.
async function forecastClosedAgendaRisks(week,data,settings,mode,opts = {}){
  const RealDate=Date,now=Date.now(),started=performance.now(),step=5*60000;
  const result={kind:'closed',checkedAt:now,throughAt:now,planKey:agendaForecastPlanKey(week,data),
    risks:{},probes:0,verificationProbes:0,replayProbes:0,elapsedMs:0,budgetExhausted:false};
  let current=week;
  const enabled=new Set(opts.owners || []);
  const tracked=new Set((week.days?.[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind)
    && enabled.has(r.hid || r.h?.hid || data[r.i]?.hid)).map(r=>agendaForecastIdentity(r,data)));
  if(!(week.days?.[0]?.timeline || []).some(r=>enabled.has(r.hid || r.h?.hid || data[r.i]?.hid)))return result;
  const first=ceilToMinutes(now+1,5)+1;
  for(let i=0;i<12;i++){
    const targetAt=first+i*step;
    if(dayStart(targetAt+60000)!==dayStart(now))break;
    // No new work after one second. The parent additionally enforces five
    // seconds including the last four-second solve and worker startup.
    if(performance.now()-started>=1000){result.budgetExhausted=true;break;}
    const probe=await forecastAgendaRisks(current,data,settings,mode,{owners:opts.owners,targetAt,verifyMovableLoss:false});
    if(!probe.futureWeek)break;
    const losses=Object.entries(probe.risks).filter(([key])=>tracked.has(key) && !result.risks[key]);
    if(losses.length){
      if(performance.now()-started>=1000){result.budgetExhausted=true;break;}
      const savedMemo=_plannerWeekDayMemo;
      let checkAt=targetAt+60000;
      class CheckDate extends RealDate{
        constructor(...args){super(...(args.length ? args : [checkAt]));}
        static now(){return checkAt;}
      }
      globalThis.Date=CheckDate;
      let checked,before;
      try{
        // Full-week reconsideration is required for a dropped movable, as in
        // the actual home/background refresh. It may restore the task today.
        const buildOpts={dirtyKey:'closed-drop-check',day0Only:!probe.requiresWeekReplan
            && !agendaClockRefreshNeedsFarDays(week.days[0],checkAt,data),reuseIncumbent:true,
          memoDays:memoDaysFromWeek(week),priorPlacements:agendaPriorPlacementsFromWeek(week),
          incumbentSolveStatus:week.plannerSolveStatus || '',glpkLimitSeconds:4};
        checked=mode==='exact' ? await buildWeekAgendaAsync(data,settings,7,buildOpts)
          : buildWeekAgenda(data,settings,7,buildOpts);
        result.verificationProbes++;
        if(performance.now()-started>=1000){result.budgetExhausted=true;break;}
        // Verify the other side of the boundary too. A chained pack may lose
        // the item later than a normal refresh; that is uncertain timing and
        // must not queue a misleading advance alert.
        checkAt=targetAt-60000;
        const beforeOpts={...buildOpts,day0Only:!agendaClockRefreshNeedsFarDays(week.days[0],checkAt,data)};
        before=mode==='exact' ? await buildWeekAgendaAsync(data,settings,7,beforeOpts)
          : buildWeekAgenda(data,settings,7,beforeOpts);
        result.verificationProbes++;
      }finally{globalThis.Date=RealDate;_plannerWeekDayMemo=savedMemo;endPlannerSolveCaches();}
      const present=new Set((checked.days[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
        .map(r=>agendaForecastIdentity(r,data)));
      const beforeSet=new Set((before.days[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
        .map(r=>agendaForecastIdentity(r,data)));
      for(const [key,risk] of losses)if(!present.has(key)
        && beforeSet.has(key)
        && (mode!=='exact' || agendaForecastSelectionConfirmed(checked))){
        result.risks[key]={...risk,warningAt:targetAt-step,verified:true};
      }
    }
    if(!i)result.nearForecast=probe;
    result.probes++;result.replayProbes+=probe.replayProbes;
    result.throughAt=targetAt;result.elapsedMs=Math.round(performance.now()-started);
    opts.progress?.({...result,risks:{...result.risks}});
    current={...probe.futureWeek,days:probe.futureWeek.days.map(day=>({...day,
      timeline:(day.timeline || []).map(r=>({...r})),agendaItems:(day.agendaItems || []).map(r=>({...r}))}))};
    rehydrateAgendaWeekHabits(current,data);
  }
  result.elapsedMs=Math.round(performance.now()-started);
  return result;
}

// Called only by Android's disposable background page, never the visible UI.
function forecastClosedAgendaOffMain(week,data,settings,mode,revision,owners){
  if(!owners.length || _plannerWorkerRequests.size || _agendaForecastRequest)return Promise.resolve(null);
  const worker=ensureAgendaPlannerWorker();if(!worker)return Promise.resolve(null);
  const id=++_plannerWorkerSeq;
  return new Promise(resolve=>{
    let partial=null;
    const finish=result=>{
      clearTimeout(timer);
      if(result){
        result.revision=revision;result.warningAt=Date.now()+2000;
        if(result.nearForecast)Object.assign(result.nearForecast,{revision,warningAt:result.warningAt});
      }
      resolve(result);
    };
    const timer=setTimeout(()=>{
      _plannerWorkerRequests.delete(id);
      cancelAgendaPlannerWorkerRequests('closed lookahead deadline');
      finish(partial && {...partial,budgetExhausted:true});
    },AGENDA_FORECAST_TIMEOUT_MS);
    _plannerWorkerRequests.set(id,{resolve:finish,reject:()=>finish(partial),progress:result=>{partial=result;}});
    worker.postMessage({id,closedForecast:true,week:leanAgendaWeek(week),data,settings,mode,owners,
      storage:plannerWorkerStorageSnapshot()});
  });
}

function applyAgendaRiskForecast(week,forecast,data){
  if(forecast.planKey!==agendaForecastPlanKey(week,data) || !forecast.futureWeek)return week;
  // No static-fit or exhausted-budget fallback: only an actual future loss
  // creates a warning. Old multi-hour evidence must not survive migration.
  for(const row of week.days?.[0]?.timeline || []){
    const risk=forecast.risks[agendaForecastIdentity(row,data)];
    row.riskAt=risk?.at;row.riskReason=risk?.reason;
    row.riskCheckedAt=forecast.checkedAt;row.riskValidated=Boolean(risk);
    row.riskAbsentAt=risk?.absentAt;
  }
  week.dropForecast={...forecast};
  week.forecastDiagnostics={probes:forecast.probes,replayProbes:forecast.replayProbes,
    elapsedMs:forecast.elapsedMs,checkedAt:forecast.checkedAt};
  return week;
}

// A changed edit, location/weather revision or refinement invalidates reuse.
// Clock-only slides explicitly carry the matching source signature forward.
function reusableAgendaDropForecast(week,data,revision,now=Date.now()){
  const forecast=week?.dropForecast;
  return forecast?.futureWeek && forecast.revision===revision
    && forecast.planKey===agendaForecastPlanKey(week,data)
    && dayStart(now)===week.days?.[0]?.dayBase
    && now<=forecast.targetAt+60000 ? forecast : null;
}
function consumeAgendaDropForecast(week,data,revision,now=Date.now()){
  const forecast=reusableAgendaDropForecast(week,data,revision,now);
  if(!forecast || now<forecast.targetAt || forecast.requiresWeekReplan)return null;
  const future=forecast.futureWeek;
  const today={...future.days[0],timeline:(future.days[0].timeline || []).map(r=>({...r})),
    agendaItems:(future.days[0].agendaItems || []).map(r=>({...r}))};
  const combined={...future,days:[today,...week.days.slice(1)],
    optimized:Boolean(future.optimized && week.optimized),
    plannerSolveStatus:future.plannerSolveStatus==='optimal' && week.plannerSolveStatus==='optimal'
      ? 'optimal' : 'feasible',
    plannerDiagnostics:{...future.plannerDiagnostics,daySolves:[
      ...(future.plannerDiagnostics?.daySolves || [{dayKey:today.dayKey,phase:'fixed-pack',status:future.plannerSolveStatus || 'feasible'}]),
      ...(week.plannerDiagnostics?.daySolves || []).filter(s=>s.dayKey!==today.dayKey)]},
    totalTravelSeconds:(future.days[0]?.travelSeconds || 0)+week.days.slice(1).reduce((n,d)=>n+(d.travelSeconds || 0),0)};
  rehydrateAgendaWeekHabits(combined,data);
  return combined;
}

let _agendaForecastRequest=null;
const _agendaForecastCache=new Map();
function cancelAgendaRiskForecast(reason='forecast superseded'){
  if(!_agendaForecastRequest)return;
  const request=_agendaForecastRequest;_agendaForecastRequest=null;
  clearTimeout(request.timer);
  cancelAgendaPlannerWorkerRequests(reason);
  request.resolve(null);
}
function forecastAgendaOffMain(week,data,settings,mode,revision,owners){
  if(!owners.length)return Promise.resolve(null);
  const enabled=new Set(owners);
  if(!(week.days?.[0]?.timeline || []).some(row=>['fill','scheduled'].includes(row.kind)
    && enabled.has(row.hid || row.h?.hid || data[row.i]?.hid)))return Promise.resolve(null);
  const key=`${dateKey(Date.now())}:${revision}:${owners.slice().sort().join(',')}`;
  const planKey=agendaForecastPlanKey(week,data),cached=_agendaForecastCache.get(key);
  if(cached && cached.targetAt>Date.now() && cached.planKey===planKey)return Promise.resolve(cached);
  if(_plannerWorkerRequests.size || _agendaForecastRequest)return Promise.resolve(null);
  const worker=ensureAgendaPlannerWorker();
  if(!worker)return Promise.resolve(null);
  const id=++_plannerWorkerSeq;
  return new Promise(resolve=>{
    const finish=forecast=>{
      if(_agendaForecastRequest?.id!==id)return;
      clearTimeout(_agendaForecastRequest.timer);_agendaForecastRequest=null;
      if(forecast){
        forecast.revision=revision;forecast.warningAt=Date.now()+2000;
        if(_agendaForecastCache.size>=8)_agendaForecastCache.delete(_agendaForecastCache.keys().next().value);
        _agendaForecastCache.set(key,forecast);
      }
      resolve(forecast);
    };
    _agendaForecastRequest={id,resolve,timer:setTimeout(()=>{
      // Failed lookaheads produce no alerts. Back off for one lookahead period
      // instead of repeatedly terminating/reloading WASM on a dense agenda.
      const failure={risks:{},probes:0,checkedAt:Date.now(),targetAt:Date.now()+300000,
        planKey,revision,elapsedMs:AGENDA_FORECAST_TIMEOUT_MS,budgetExhausted:true};
      if(_agendaForecastCache.size>=8)_agendaForecastCache.delete(_agendaForecastCache.keys().next().value);
      _agendaForecastCache.set(key,failure);
      cancelAgendaRiskForecast('lookahead deadline');
    },AGENDA_FORECAST_TIMEOUT_MS)};
    _plannerWorkerRequests.set(id,{resolve:finish,reject:()=>finish(null)});
    worker.postMessage({id,forecast:true,week:leanAgendaWeek(week),data,settings,mode,owners,
      storage:plannerWorkerStorageSnapshot()});
  });
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')cancelAgendaRiskForecast('page hidden');
});
