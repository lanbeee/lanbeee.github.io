// Shared by both engines, the visible app and Android's background worker.
// A risk estimate is evidence for a warning, never authority to delete work.
const AGENDA_FORECAST_MAX_PROBES = 6;
const AGENDA_FORECAST_BUDGET_MS = 500;
const AGENDA_FORECAST_TIMEOUT_MS = 900;

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

// Read-only future runs use a simulated planning clock, while performance.now
// and native GLPK limits continue to measure real CPU/wall time. This function
// runs only in the serialized planner worker (or isolated test context).
async function forecastAgendaRisks(week,data,settings,mode,opts = {}){
  const RealDate=Date,now=RealDate.now(),day=week.days?.[0];
  const result={risks:{},probes:0,replayProbes:0,elapsedMs:0,budgetExhausted:false,checkedAt:now,
    planKey:agendaForecastPlanKey(week,data)};
  if(!day || day.dayBase!==dayStart(now))return result;
  const rows=(day.timeline || []).filter(r=>['fill','scheduled'].includes(r.kind));
  const owners=new Set(opts.owners || []);
  // Fixed clocks already have an exact end boundary; do not spend battery
  // simulating them or keep probing after every flexible subject was lost.
  const subjects=rows.filter(r=>r.kind==='fill' && !r.hard && owners.has(r.hid || r.h?.hid || data[r.i]?.hid));
  if(!subjects.length)return result;
  const maxProbes=Math.min(AGENDA_FORECAST_MAX_PROBES,Math.max(0,opts.maxProbes ?? AGENDA_FORECAST_MAX_PROBES));
  const budget=Math.min(AGENDA_FORECAST_BUDGET_MS,Math.max(0,opts.budgetMs ?? AGENDA_FORECAST_BUDGET_MS));
  // Include near-term clocks and real agenda boundaries. One solve examines
  // every opted-in occurrence; no per-item solves or optimizer binary search.
  const clocks=[5,30,90,180,300,540].map(m=>ceilToMinutes(now+m*60000,5));
  for(const row of subjects)for(const t of [row.start,row.dropAt]){
    if(Number.isFinite(t) && t>now && t<day.dayBase+86400000)clocks.push(ceilToMinutes(t+60000,5));
  }
  const boundaries=[...new Set(clocks)].filter(t=>t<day.dayBase+86400000).sort((a,b)=>a-b);
  const samples=maxProbes ? [...new Set(Array.from({length:maxProbes},(_,i)=>
    boundaries[Math.round(i*(boundaries.length-1)/Math.max(1,maxProbes-1))]))] : [];
  const started=performance.now(),savedMemo=_plannerWeekDayMemo;
  let clock=now,lastPresent=now,prior=week;
  class PlanningDate extends RealDate{
    constructor(...args){super(...(args.length ? args : [clock]));}
    static now(){return clock;}
  }
  try{
    globalThis.Date=PlanningDate;
    // A future rebuild can use another route origin when a block/venue ends.
    // Reserve one outstanding observed travel leg rather than assuming the
    // original location witness stays exact across sparse probes.
    const travelMargin=(day.timeline || []).filter(r=>r.kind==='travel')
      .reduce((n,r)=>Math.max(n,Number(r.seconds) || (r.end-r.start)/1000),0)*1000;
    const publish=(waitingForSolve=false)=>{
      const progress={...result,risks:Object.fromEntries(Object.entries(result.risks).map(([key,risk])=>
        [key,{...risk,at:risk.at-travelMargin}]))};
      // A hard parent timeout may interrupt this next full build. Its partial
      // result must still cover unresolved work beyond the validated frontier.
      if(waitingForSolve)for(const row of subjects){
        const key=agendaForecastIdentity(row,data);
        if(!progress.risks[key])progress.risks[key]={at:lastPresent+1-travelMargin,reason:'forecast-budget-frontier'};
      }
      progress.travelMarginMs=travelMargin;
      opts.onProgress?.(progress);
    };
    publish();
    clock=now;
    // Most clock steps are placement replays, not optimizer runs. Reuse this
    // same production fast path to inspect five-minute boundaries without
    // paying for ILP solves. Coupled/unsupported cases use sparse full probes.
    const cheap=replayAgendaClockWeek(data,settings,week.days.length,{
      reuseIncumbent:true,day0Only:true,memoDays:memoDaysFromWeek(week)});
    const horizon=Math.min(day.dayBase+86400000,Math.max(now,...subjects.map(r=>Number(r.dropAt) || Number(r.end)))+5*60000);
    const scan=cheap ? Array.from({length:Math.max(0,Math.ceil((horizon-ceilToMinutes(now+1,5))/300000))},
      (_,i)=>ceilToMinutes(now+1,5)+i*300000) : samples;
    let allReplay=Boolean(cheap);
    for(const at of scan){
      if(performance.now()-started>=budget){result.budgetExhausted=true;break;}
      clock=at;
      const needsFarDays=agendaClockRefreshNeedsFarDays(prior.days[0],at,data);
      const buildOpts={dirtyKey:'forecast',day0Only:!needsFarDays,reuseIncumbent:!needsFarDays,
        memoDays:memoDaysFromWeek(prior),priorPlacements:agendaPriorPlacementsFromWeek(prior),
        forecast:true};
      let future=cheap && !needsFarDays && replayAgendaClockWeek(data,settings,week.days.length,buildOpts);
      if(future)result.replayProbes++;
      else{
        allReplay=false;
        if(result.probes>=maxProbes){result.budgetExhausted=true;break;}
        publish(true);
        future=mode==='exact' ? await buildWeekAgendaAsync(data,settings,week.days.length,buildOpts)
          : buildWeekAgenda(data,settings,week.days.length,buildOpts);
        result.probes++;
      }
      const present=new Set((future.days[0].timeline || []).filter(r=>['fill','scheduled'].includes(r.kind))
        .map(r=>agendaForecastIdentity(r,data)));
      for(const row of subjects){
        const key=agendaForecastIdentity(row,data);
        if(!present.has(key) && (!result.risks[key] || !result.risks[key].absentAt))result.risks[key]={
          // Loss is somewhere in this interval. Warn from its earlier side.
          at:Math.min(lastPresent+1,result.risks[key]?.at ?? Infinity),absentAt:at,
          reason:allReplay ? 'clock-replay-loss' : 'future-loss-interval',validated:allReplay};
      }
      lastPresent=at;prior=future;
      publish();
      if(subjects.every(row=>result.risks[agendaForecastIdentity(row,data)]?.absentAt))break;
    }
    if(result.budgetExhausted && cheap){
      for(const row of subjects.filter(r=>r.kind==='fill')){
        const key=agendaForecastIdentity(row,data);
        if(!result.risks[key])result.risks[key]={at:lastPresent+1,reason:'forecast-budget-frontier'};
      }
      publish();
    }
    if(!result.budgetExhausted && allReplay){
      for(const row of subjects.filter(r=>r.kind==='fill')){
        const key=agendaForecastIdentity(row,data);
        if(!result.risks[key])result.risks[key]={at:lastPresent+1,reason:'validated-replay-frontier',validated:true};
      }
      publish();
    }
    for(const risk of Object.values(result.risks))risk.at-=travelMargin;
    result.travelMarginMs=travelMargin;
  }finally{
    globalThis.Date=RealDate;_plannerWeekDayMemo=savedMemo;endPlannerSolveCaches();
    result.elapsedMs=Math.round(performance.now()-started);
  }
  return result;
}

function applyAgendaRiskForecast(week,forecast,data){
  const samePlan=forecast.planKey===agendaForecastPlanKey(week,data);
  for(const row of week.days?.[0]?.timeline || []){
    const risk=forecast.risks[agendaForecastIdentity(row,data)];
    if(!risk)continue;
    const validated=Boolean(risk.validated && samePlan);
    row.riskAt=validated ? risk.at : Math.min(Number.isFinite(row.riskAt) ? row.riskAt : Infinity,risk.at);
    row.riskReason=risk.reason;row.riskCheckedAt=forecast.checkedAt;
    row.riskValidated=validated;
    row.riskAbsentAt=risk.absentAt;
  }
  week.forecastDiagnostics={probes:forecast.probes,replayProbes:forecast.replayProbes,elapsedMs:forecast.elapsedMs,
    budgetExhausted:forecast.budgetExhausted,checkedAt:forecast.checkedAt};
  return week;
}

let _agendaForecastRequest=null;
const _agendaForecastCache=new Map();
function cancelAgendaRiskForecast(reason='forecast superseded'){
  if(!_agendaForecastRequest)return;
  const request=_agendaForecastRequest;_agendaForecastRequest=null;
  clearTimeout(request.timer);
  // Termination also cancels a synchronous solve, rather than merely hiding
  // its result. No real planning is queued behind this optional request.
  cancelAgendaPlannerWorkerRequests(reason);
  request.resolve(request.partial || null);
}
function forecastAgendaOffMain(week,data,settings,mode,revision,owners){
  if(!owners.length)return Promise.resolve(null);
  const enabled=new Set(owners);
  if(!(week.days?.[0]?.timeline || []).some(row=>row.kind==='fill' && !row.hard
    && enabled.has(row.hid || row.h?.hid || data[row.i]?.hid)))return Promise.resolve(null);
  const key=`${dateKey(Date.now())}:${revision}:${owners.slice().sort().join(',')}`;
  const cached=_agendaForecastCache.get(key);
  if(cached)return Promise.resolve(cached);
  // Do not compete with foreground work or quality refinement.
  if(_plannerWorkerRequests.size || _agendaForecastRequest)return Promise.resolve(null);
  const worker=ensureAgendaPlannerWorker();
  if(!worker)return Promise.resolve(null);
  const id=++_plannerWorkerSeq;
  return new Promise(resolve=>{
    const finish=forecast=>{
      if(_agendaForecastRequest?.id!==id)return;
      clearTimeout(_agendaForecastRequest.timer);_agendaForecastRequest=null;
      if(forecast){
        // At most one batch per input revision. Limit memory across edits.
        if(_agendaForecastCache.size>=8)_agendaForecastCache.delete(_agendaForecastCache.keys().next().value);
        _agendaForecastCache.set(key,forecast);
      }
      resolve(forecast);
    };
    _agendaForecastRequest={id,resolve,timer:setTimeout(()=>{
      // Cache exhaustion too: repeated minute ticks must not burn more CPU
      // retrying a large fixture that exceeded the optional budget.
      const partial=_agendaForecastRequest?.partial || {risks:{},probes:0,checkedAt:Date.now()};
      partial.elapsedMs=AGENDA_FORECAST_TIMEOUT_MS;partial.budgetExhausted=true;
      if(_agendaForecastCache.size>=8)_agendaForecastCache.delete(_agendaForecastCache.keys().next().value);
      _agendaForecastCache.set(key,partial);
      cancelAgendaRiskForecast('forecast budget exhausted');
    },AGENDA_FORECAST_TIMEOUT_MS)};
    _plannerWorkerRequests.set(id,{resolve:finish,reject:()=>finish(null),progress:partial=>{
      if(_agendaForecastRequest?.id===id)_agendaForecastRequest.partial=partial;
    }});
    worker.postMessage({id,forecast:true,week:leanAgendaWeek(week),data,settings,mode,owners,
      storage:plannerWorkerStorageSnapshot()});
  });
}
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden')cancelAgendaRiskForecast('page hidden');
});
