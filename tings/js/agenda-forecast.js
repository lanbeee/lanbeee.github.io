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
const AGENDA_DROP_WARNING_MINUTES = 15;
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
    // Use the normal week path once, including movable reassignment. Memoized
    // far days and clock replay keep compatible work cheap. Cache this exact
    // result for adoption; a today-only omission is never the final result.
    const buildOpts={dirtyKey:'drop-lookahead',day0Only:false,reuseIncumbent:true,
      memoDays:memoDaysFromWeek(week),priorPlacements:agendaPriorPlacementsFromWeek(week),
      incumbentSolveStatus:week.plannerSolveStatus || '',glpkLimitSeconds:4};
    const future=mode==='exact' ? await buildWeekAgendaAsync(data,settings,7,buildOpts)
      : buildWeekAgenda(data,settings,7,buildOpts);
    result.probes=1;result.replayProbes=Number(Boolean(future.plannerDiagnostics?.clockReplay));
    result.futureWeek=leanAgendaWeek(future);result.normalWeek=true;
    result.selectionConfirmed=mode!=='exact' || Boolean(agendaForecastSelectionConfirmed(future));
    const present=new Set((future.days[0]?.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
      .map(r=>agendaForecastIdentity(r,data)));
    result.requiresWeekReplan=false;
    for(const row of subjects){
      const key=agendaForecastIdentity(row,data);
      if(!present.has(key) && result.selectionConfirmed)result.risks[key]={at:targetAt,absentAt:targetAt,reason:'fifteen-minute-loss',validated:true};
    }
  }finally{
    globalThis.Date=RealDate;_plannerWeekDayMemo=savedMemo;endPlannerSolveCaches();
    result.elapsedMs=Math.round(performance.now()-started);
  }
  return result;
}

// Closed and foreground execution use the same single fifteen-minute build.
// Estimates already cover the rest of today; no multi-hour forecast sweep.
async function forecastClosedAgendaRisks(week,data,settings,mode,opts = {}){
  const forecast=await forecastAgendaRisks(week,data,settings,mode,opts);
  const {futureWeek,...diagnostics}=forecast;
  const result={...diagnostics,kind:'closed',throughAt:futureWeek ? forecast.targetAt : forecast.checkedAt,
    verificationProbes:0,nearForecast:forecast};
  opts.progress?.(result);
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
  // Only a completed future loss marks confirmation. Current dropAt remains
  // available independently for the early estimated native schedule.
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
  if(forecast.normalWeek){
    const combined=structuredClone(forecast.futureWeek);
    rehydrateAgendaWeekHabits(combined,data);return combined;
  }
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
      // Failed lookaheads retain estimated alarms. Back off for one period
      // instead of repeatedly terminating/reloading WASM on a dense agenda.
      const failure={risks:{},probes:0,checkedAt:Date.now(),targetAt:Date.now()+AGENDA_DROP_WARNING_MINUTES*60000,
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
