function homeListFingerprint(now = Date.now()){
  const data = typeof load === 'function' ? load() : [];
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  // Live-coord freshness — only changes when the user has crossed a coarse
  // ~100m bucket or the current-coord travel cache updated (e.g., an OSRM
  // result refined a haversine floor). Skips renders for sub-bucket GPS
  // jitter so the list doesn't thrash on every watch tick.
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const habitSig = data.map(h=>[
    h.name, h.type, h.lastLog, h.dueDate, h.eventTime,
    h.pinned ? 1 : 0, h.snoozedUntil || '',
    (h.locationIds || []).join(','),
    h.durationMinutes, h.priority, habitEarlyWindowDays(h), habitDelayAllowanceDays(h),
    h.breakable ? 1 : 0,
    h.minChunkMinutes || '',
    typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0,
    h.allowedTimeStart, h.allowedTimeEnd,
    h.allowedTimeStartAnchor || '', h.allowedTimeStartOffsetMin || 0,
    h.allowedTimeEndAnchor || '', h.allowedTimeEndOffsetMin || 0,
    (h.allowedWeekdays || []).join(','),
    (h.preferredWeekdays || []).join(',')
  ].join('~')).join(';');
  return [
    Math.floor(now / 60000),
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    s.preset || '',
    weekOnHomeEnabled(s) ? 1 : 0,
    s.agendaOptimizer ? 1 : 0,
    s.showSnoozed ? 1 : 0,
    typeof searchQuery === 'string' ? searchQuery : '',
    typeof homeTopicFilter === 'string' ? homeTopicFilter : '',
    typeof homeLocationFilter === 'string' ? homeLocationFilter : '',
    travelSig,
    coordSig,
    currentEdgeSig,
    habitSig,
    (typeof habitTimer !== 'undefined' && habitTimer) ? `timer:${habitTimer.idx}:${habitTimer.startedAt}` : '',
    JSON.stringify(s.cancelledBlocks || {}),
    JSON.stringify(s.blockedTimeOverrides || {}),
    JSON.stringify(s.availabilityOverrides || {}),
    JSON.stringify(s.availabilityMinutes || []),
    JSON.stringify(s.blockedTimes || []),
    s.prayerMethod || '', s.prayerMadhab || ''
  ].join('\n');
}

let _homeListFingerprint = '';
let _homeRenderedWeek = null;
let _fastHomeRefreshToken = 0;
let _optimizerHomeRequestKey = '';
let _optimizerHomeRequestToken = 0;
let _optimizerHomeReadyKey = '';
let _optimizerHomeReadyWeek = null;
let _optimizerHomeReadyDirtyKey = '';
let _optimizerHomeRefinementKey = '';
let _optimizerHomeRefinementDoneKey = '';
let _optimizerHomeRefinementToken = 0;
let _optimizerHomeRefinementPass = 0;
let _optimizerHomeRefinementRetryTimer = null;
let _optimizerHomeRefinementIdleTimer = null;
let _optimizerHomeRefinementIdleCallback = false;
let _optimizerHomeRefinementTrackedDirty = '';
let _optimizerHomeProvenDayKeys = new Set();
let _idlePlannerRefreshTimer = null;
let _homeEarlyMapCache = {key:'',map:null};

// PURE: translate optimizer/runtime provenance into one quiet home-header cue.
// "Optimal" is deliberately reserved for a GLPK proof. A refined feasible
// result is the best plan found in the deeper budget, but is not mislabeled as
// mathematically optimal.
function homePlannerRuntimeState(week = _homeRenderedWeek){
  const settings = (typeof sortSettings !== 'undefined' && sortSettings)
    || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const exact = Boolean(settings && settings.agendaOptimizer)
    && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast());
  if(!exact)return {state:'hidden',label:'',detail:'Fast graph planner selected',running:false};
  if(_optimizerHomeRequestKey){
    return {
      state:'planning',label:'planning',running:true,
      detail:'GLPK is building a new agenda; the visible plan may still change.'
    };
  }
  if(_optimizerHomeRefinementKey){
    return {
      state:'refining',label:'refining',running:true,
      detail:'GLPK is refining the current feasible agenda in the background.'
    };
  }
  if(!week || !Array.isArray(week.days)){
    return {state:'planning',label:'planning',running:true,detail:'GLPK is preparing the agenda.'};
  }
  let refinementFinished = Boolean(week.refined);
  try{
    const liveRefinementKey = `${dateKey(Date.now())}\n${homePlannerDirtyKey(load())}`;
    refinementFinished = refinementFinished || _optimizerHomeRefinementDoneKey === liveRefinementKey;
  }catch(_){ /* provenance remains usable without storage access */ }
  const status = week.plannerSolveStatus || (week.optimized ? 'feasible' : 'fallback');
  if(week.optimized && status === 'optimal'){
    return {
      state:'optimal',label:'optimal',running:false,
      detail:'GLPK proved the fixed-item agenda optimal; breakable gap fill and route reconciliation are complete.'
    };
  }
  if(week.optimized && refinementFinished){
    return {
      state:'refined',label:'refined',running:false,
      detail:'Background refinement finished with the best feasible agenda found; optimality was not proved.'
    };
  }
  if(week.optimized && status === 'feasible'){
    return {
      state:'feasible',label:'feasible',running:false,
      detail:'A valid GLPK agenda is ready, but optimality was not proved within the foreground time budget.'
    };
  }
  return {
    state:'fallback',label:'fallback',running:false,
    detail:'GLPK did not return a usable result for every day, so part or all of this agenda used the fast fallback.'
  };
}

// WRITE: status changes often preserve every placement, so update the tiny cue
// without forcing a list repaint or moving the card currently being read.
function applyHomePlannerStatusIndicator(button,state = homePlannerRuntimeState()){
  if(!button)return;
  button.hidden = !state || state.state === 'hidden';
  if(button.hidden)return;
  button.dataset.plannerState = state.state;
  button.title = state.detail;
  button.setAttribute('aria-label',`agenda ${state.label}: ${state.detail}`);
}

function syncHomePlannerStatusIndicators(){
  if(typeof document === 'undefined')return;
  const state = homePlannerRuntimeState();
  document.querySelectorAll('.planner-state-indicator').forEach(button=>{
    applyHomePlannerStatusIndicator(button,state);
  });
}

// PURE: the visible scheduling result, without solver bookkeeping. Comparing
// this after a background solve lets the current DOM stay mounted when GLPK
// returns the same days, order, and times as the plan already on screen.
function homeAgendaPlanSignature(week,data = (typeof load === 'function' ? load() : [])){
  if(!week || !Array.isArray(week.days))return '';
  return week.days.map(day=>{
    const rows = Array.isArray(day.timeline) ? day.timeline : [];
    const rowSig = rows.map(row=>{
      const h = row && row.i != null ? data[row.i] : null;
      return [
        row && row.kind || '',
        h && h.hid || '',
        Number.isFinite(Number(row && row.start)) ? Math.round(Number(row.start) / 60000) : '',
        Number.isFinite(Number(row && row.end)) ? Math.round(Number(row.end) / 60000) : '',
        row && row.from || '',
        row && row.to || '',
        row && row.locationId || '',
        row && row.label || '',
        row && row.chunkMinutes != null ? Math.round(Number(row.chunkMinutes) || 0) : ''
      ].join('~');
    }).join(';');
    return `${day.dayKey || dateKey(day.dayBase)}:${rowSig}`;
  }).join('\n');
}

// PURE: quality tuple for accepting a background refinement. Hard recurring
// P0/pinned rows already visible anywhere in the week may never vanish, and
// total week work may not shrink. An in-progress row may only be extended,
// never moved, truncated, or dropped. Today's P0 breakable minutes then
// outrank today's raw minutes; travel is only a final tiebreak.
function homeAgendaRefinementQuality(week,data,settings){
  const days = week && Array.isArray(week.days) ? week.days : [];
  const required = new Map();
  let p0BreakableMinutes = 0;
  let totalFillMinutes = 0;
  let weekTotalFillMinutes = 0;
  let overdueMinutes = 0;
  let travelSeconds = 0;
  const activeRows = [];
  const now = Date.now();
  for(let dayOffset = 0;dayOffset < days.length;dayOffset += 1){
    const rows = Array.isArray(days[dayOffset].timeline) ? days[dayOffset].timeline : [];
    const occurrenceOrdinals = new Map();
    for(const row of rows){
      if(!row)continue;
      if(row.kind === 'travel'){
        travelSeconds += Number(row.seconds)
          || Math.max(0,(Number(row.end) - Number(row.start)) / 1000);
        continue;
      }
      if(row.kind !== 'fill' || row.i == null)continue;
      const h = data[row.i];
      if(!h)continue;
      const minutes = Math.max(0,(Number(row.end) - Number(row.start)) / 60000);
      weekTotalFillMinutes += minutes;
      if(dayOffset === 0)totalFillMinutes += minutes;
      const priority = typeof effectivePriority === 'function'
        ? effectivePriority(h) : Math.max(0,Math.min(5,Number(h.priority) || 2));
      if(dayOffset === 0 && priority === 0 && h.breakable)p0BreakableMinutes += minutes;
      const pinned = typeof isWeekPinnedToday === 'function'
        ? isWeekPinnedToday(h,settings || {}) : false;
      if((priority === 0 && !h.breakable) || pinned){
        const ordinal = (occurrenceOrdinals.get(row.i) || 0) + 1;
        occurrenceOrdinals.set(row.i,ordinal);
        const occurrence = row.occurrenceKey || `${row.i}:occurrence-${ordinal}`;
        const key = `${dayOffset}:${occurrence}`;
        required.set(key,(required.get(key) || 0) + minutes);
      }
      const urgency = typeof weekUrgency === 'function' ? weekUrgency(h) : 0;
      if(dayOffset === 0 && urgency >= 100)overdueMinutes += minutes;
      if(dayOffset === 0 && Number(row.start) <= now + 1000 && Number(row.end) > now){
        activeRows.push({
          i:row.i,
          start:Math.round(Number(row.start) / 60000),
          end:Math.round(Number(row.end) / 60000),
          loc:row.locationId || ''
        });
      }
    }
  }
  return {
    required,p0BreakableMinutes,totalFillMinutes,weekTotalFillMinutes,
    overdueMinutes,travelSeconds,activeRows
  };
}

// PURE: a baseline in-progress row survives into a candidate when the same
// habit keeps running from the same start at the same location. Extending the
// end is allowed (more of the ongoing session); moving, truncating, or
// dropping it is not.
function homeAgendaActiveRowPreserved(before,candidate){
  return candidate.i === before.i
    && candidate.start === before.start
    && candidate.loc === before.loc
    && candidate.end >= before.end;
}

function homeAgendaRefinementIsBetter(baseline,candidate,data,settings){
  if(!baseline || !candidate)return false;
  const before = homeAgendaRefinementQuality(baseline,data,settings);
  const after = homeAgendaRefinementQuality(candidate,data,settings);
  if(before.activeRows.some(row=>
    !after.activeRows.some(candidateRow=>homeAgendaActiveRowPreserved(row,candidateRow))
  ))return false;
  for(const [idx,minutes] of before.required){
    if((after.required.get(idx) || 0) + 0.01 < minutes)return false;
  }
  if(after.weekTotalFillMinutes + 0.01 < before.weekTotalFillMinutes)return false;
  if(Math.abs(after.p0BreakableMinutes - before.p0BreakableMinutes) > 0.01){
    return after.p0BreakableMinutes > before.p0BreakableMinutes;
  }
  if(Math.abs(after.totalFillMinutes - before.totalFillMinutes) > 0.01){
    return after.totalFillMinutes > before.totalFillMinutes;
  }
  if(Math.abs(after.overdueMinutes - before.overdueMinutes) > 0.01){
    return after.overdueMinutes > before.overdueMinutes;
  }
  if(Math.abs(after.travelSeconds - before.travelSeconds) > 0.5){
    return after.travelSeconds < before.travelSeconds;
  }
  return false;
}

function homeAgendaNeedsBackgroundRefinement(week,data,settings){
  if(!week || !week.optimized)return false;
  // A refined feasible week is not a GLPK proof. Keep searching while the app
  // is open. Missing provenance is treated as feasible, not as a proof.
  // A fixed-item proof can still leave a daily P0 breakable short when reserved
  // minutes were split below min-chunk, so that case keeps searching too.
  const proven = (week.plannerSolveStatus || 'feasible') === 'optimal';
  const day = week.days && week.days[0];
  if(proven){
    if(!day)return false;
  }else if(!day){
    return true;
  }
  const placed = new Map();
  for(const row of day.timeline || []){
    if(row && row.kind === 'fill' && row.i != null){
      placed.set(row.i,(placed.get(row.i) || 0)
        + Math.max(0,(Number(row.end) - Number(row.start)) / 60000));
    }
  }
  for(let i = 0;i < data.length;i += 1){
    const h = data[i];
    if(!h || !h.breakable)continue;
    const priority = typeof effectivePriority === 'function' ? effectivePriority(h) : Number(h.priority);
    if(priority !== 0)continue;
    const eligible = typeof isWeekCandidate === 'function'
      ? isWeekCandidate(h,settings,day.dayBase,day.weekday) : true;
    if(!eligible)continue;
    const need = typeof todayCandidateLoadMinutes === 'function'
      ? todayCandidateLoadMinutes(h,day.dayBase) : Number(h.durationMinutes) || 0;
    if((placed.get(i) || 0) + 0.01 < need)return true;
  }
  return !proven;
}

function homeAgendaProvenDayKeys(week){
  const solves = week && week.plannerDiagnostics && Array.isArray(week.plannerDiagnostics.daySolves)
    ? week.plannerDiagnostics.daySolves : [];
  const keys = [];
  for(const solve of solves){
    if(!solve || solve.phase !== 'fixed-pack' || !solve.dayKey)continue;
    if(solve.status === 'optimal')keys.push(solve.dayKey);
  }
  return keys;
}

// An unchanged packing keeps every proof already established for that exact
// packing. A later time-limited run can add proofs, but merely returning
// feasible/fallback does not invalidate an earlier GLPK proof for the same
// rows and unchanged planner revision.
function mergeHomeAgendaSamePlanProvenance(incumbent,candidate){
  if(!incumbent || !candidate)return candidate;
  const rank = status=>status === 'optimal' ? 2 : (status === 'feasible' ? 1 : 0);
  const incumbentStatus = incumbent.plannerSolveStatus || (incumbent.optimized ? 'feasible' : 'fallback');
  const candidateStatus = candidate.plannerSolveStatus || (candidate.optimized ? 'feasible' : 'fallback');
  const preservedKeys = new Set(homeAgendaProvenDayKeys(incumbent));
  const incumbentSolves = incumbent.plannerDiagnostics
    && Array.isArray(incumbent.plannerDiagnostics.daySolves)
    ? incumbent.plannerDiagnostics.daySolves : [];
  const incumbentDiagnostics = incumbent.plannerDiagnostics || {};
  const candidateDiagnostics = candidate.plannerDiagnostics || {};
  const candidateSolves = Array.isArray(candidateDiagnostics.daySolves)
    ? candidateDiagnostics.daySolves : [];
  const mergedSolves = candidateSolves.filter(solve=>!(
    solve && solve.phase === 'fixed-pack' && preservedKeys.has(solve.dayKey)
      && solve.status !== 'optimal'
  ));
  const representedProofs = new Set(mergedSolves.filter(solve=>
    solve && solve.phase === 'fixed-pack' && solve.status === 'optimal'
  ).map(solve=>solve.dayKey));
  for(const solve of incumbentSolves){
    if(!solve || solve.phase !== 'fixed-pack' || solve.status !== 'optimal'
      || representedProofs.has(solve.dayKey))continue;
    mergedSolves.push({...solve,selectionStatus:'preserved-identical-proof'});
    representedProofs.add(solve.dayKey);
  }
  return {
    ...candidate,
    plannerSolveStatus:rank(incumbentStatus) > rank(candidateStatus)
      ? incumbentStatus : candidateStatus,
    plannerDiagnostics:{...incumbentDiagnostics,...candidateDiagnostics,daySolves:mergedSolves}
  };
}

function homeAgendaRefinementBudgetMs(week,pass = 0){
  const now = Date.now();
  const day = week && week.days && week.days[0];
  const nextHardStart = (day && day.timeline || [])
    .filter(row=>row && row.kind === 'scheduled' && Number(row.start) > now)
    .reduce((best,row)=>Math.min(best,Number(row.start)),Infinity);
  const firstCap = typeof HOME_AGENDA_REFINEMENT_FIRST_BUDGET_MS === 'number'
    ? HOME_AGENDA_REFINEMENT_FIRST_BUDGET_MS : 30000;
  const laterCap = typeof HOME_AGENDA_REFINEMENT_LATER_BUDGET_MS === 'number'
    ? HOME_AGENDA_REFINEMENT_LATER_BUDGET_MS : 55000;
  const cap = pass > 0 ? laterCap : firstCap;
  const untilBoundary = Number.isFinite(nextHardStart)
    ? nextHardStart - now - 5000 : cap;
  if(untilBoundary < 6000)return 0;
  const floor = pass > 0 ? 12000 : 5000;
  return Math.max(floor,Math.min(cap,Math.round(untilBoundary)));
}

function resetHomeAgendaRefinementProgress(dirtyKey){
  if(_optimizerHomeRefinementTrackedDirty === dirtyKey)return;
  _optimizerHomeRefinementTrackedDirty = dirtyKey;
  _optimizerHomeRefinementPass = 0;
  _optimizerHomeRefinementDoneKey = '';
  _optimizerHomeProvenDayKeys = new Set();
}

function absorbHomeAgendaProvenDayKeys(week){
  const solves = week && week.plannerDiagnostics && Array.isArray(week.plannerDiagnostics.daySolves)
    ? week.plannerDiagnostics.daySolves : [];
  for(const solve of solves){
    if(!solve || solve.phase !== 'fixed-pack' || !solve.dayKey)continue;
    if(solve.status === 'optimal')_optimizerHomeProvenDayKeys.add(solve.dayKey);
    else if(solve.status === 'feasible' || solve.status === 'fallback'){
      _optimizerHomeProvenDayKeys.delete(solve.dayKey);
    }
  }
}

function cancelHomeAgendaRefinement(reason){
  if(_optimizerHomeRefinementRetryTimer != null){
    clearTimeout(_optimizerHomeRefinementRetryTimer);
    _optimizerHomeRefinementRetryTimer = null;
  }
  if(_optimizerHomeRefinementIdleTimer != null){
    if(_optimizerHomeRefinementIdleCallback && typeof cancelIdleCallback === 'function'){
      cancelIdleCallback(_optimizerHomeRefinementIdleTimer);
    }else{
      clearTimeout(_optimizerHomeRefinementIdleTimer);
    }
    _optimizerHomeRefinementIdleTimer = null;
    _optimizerHomeRefinementIdleCallback = false;
  }
  if(!_optimizerHomeRefinementKey)return false;
  ++_optimizerHomeRefinementToken;
  _optimizerHomeRefinementKey = '';
  syncHomePlannerStatusIndicators();
  if(reason && typeof cancelAgendaPlannerWorkerRequests === 'function'){
    cancelAgendaPlannerWorkerRequests(reason);
  }
  return true;
}

function queueHomeAgendaRefinementRetry(data,settings,week){
  if(_optimizerHomeRefinementRetryTimer != null){
    clearTimeout(_optimizerHomeRefinementRetryTimer);
  }
  const retryMs = typeof HOME_AGENDA_REFINEMENT_RETRY_MS === 'number'
    ? HOME_AGENDA_REFINEMENT_RETRY_MS : 8000;
  _optimizerHomeRefinementRetryTimer = setTimeout(()=>{
    _optimizerHomeRefinementRetryTimer = null;
    if(typeof document !== 'undefined' && document.visibilityState === 'hidden')return;
    scheduleHomeAgendaRefinement(
      typeof load === 'function' ? load() : data,
      (typeof sortSettings !== 'undefined' && sortSettings) || settings,
      _homeRenderedWeek || week
    );
  },retryMs);
}

function maybeScheduleHomeAgendaRefinement(week = _homeRenderedWeek){
  if(!week || !Array.isArray(week.days))return false;
  if(typeof document !== 'undefined' && document.visibilityState === 'hidden')return false;
  const data = typeof load === 'function' ? load() : [];
  const settings = (typeof sortSettings !== 'undefined' && sortSettings)
    || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  if(!settings || !settings.agendaOptimizer)return false;
  if(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())return false;
  return scheduleHomeAgendaRefinement(data,settings,week);
}

function scheduleHomeAgendaRefinement(data,settings,baselineWeek){
  if(!homeAgendaNeedsBackgroundRefinement(baselineWeek,data,settings))return false;
  if(typeof buildWeekAgendaOffMain !== 'function')return false;
  if(_optimizerHomeRequestKey)return false;
  if(typeof document !== 'undefined' && document.visibilityState === 'hidden')return false;
  const dirtyKey = homePlannerDirtyKey(data);
  resetHomeAgendaRefinementProgress(dirtyKey);
  const refinementKey = `${dateKey(Date.now())}\n${dirtyKey}`;
  if(_optimizerHomeRefinementKey)return false;
  if(_optimizerHomeRefinementDoneKey === refinementKey)return false;
  const maxPasses = typeof HOME_AGENDA_REFINEMENT_MAX_PASSES === 'number'
    ? HOME_AGENDA_REFINEMENT_MAX_PASSES : 4;
  if(_optimizerHomeRefinementPass >= maxPasses){
    _optimizerHomeRefinementDoneKey = refinementKey;
    return false;
  }
  const budgetMs = homeAgendaRefinementBudgetMs(baselineWeek,_optimizerHomeRefinementPass);
  if(budgetMs <= 0)return false;
  if(_optimizerHomeRefinementRetryTimer != null){
    clearTimeout(_optimizerHomeRefinementRetryTimer);
    _optimizerHomeRefinementRetryTimer = null;
  }
  absorbHomeAgendaProvenDayKeys(baselineWeek);
  const token = ++_optimizerHomeRefinementToken;
  _optimizerHomeRefinementKey = refinementKey;
  syncHomePlannerStatusIndicators();
  const deadline = Date.now() + budgetMs + 8000;
  const run = ()=>{
    _optimizerHomeRefinementIdleTimer = null;
    _optimizerHomeRefinementIdleCallback = false;
    if(token !== _optimizerHomeRefinementToken)return;
    if(typeof document !== 'undefined' && document.visibilityState === 'hidden'){
      _optimizerHomeRefinementKey = '';
      syncHomePlannerStatusIndicators();
      return;
    }
    if(homePlannerDirtyKey(load()) !== dirtyKey){
      _optimizerHomeRefinementKey = '';
      syncHomePlannerStatusIndicators();
      return;
    }
    const refineSettings = {...settings};
    const livePlannerLocationId = typeof liveLocationId === 'function' ? liveLocationId() : null;
    if(livePlannerLocationId)refineSettings._plannerLiveLocationId = livePlannerLocationId;
    void buildWeekAgendaOffMain(data,refineSettings,7,'exact',{
      dirtyKey,
      day0Only:false,
      refine:true,
      refinePass:_optimizerHomeRefinementPass,
      refineBudgetMs:budgetMs,
      provenDayKeys:[..._optimizerHomeProvenDayKeys],
      priorPlacements:typeof agendaPriorPlacementsFromWeek === 'function'
        ? agendaPriorPlacementsFromWeek(baselineWeek || _homeRenderedWeek)
        : []
    }).then(week=>{
      if(token !== _optimizerHomeRefinementToken)return;
      _optimizerHomeRefinementKey = '';
      _optimizerHomeRefinementPass += 1;
      if(Date.now() > deadline || homePlannerDirtyKey(load()) !== dirtyKey){
        syncHomePlannerStatusIndicators();
        return;
      }
      if(!week || !Array.isArray(week.days)){
        _optimizerHomeRefinementDoneKey = refinementKey;
        syncHomePlannerStatusIndicators();
        return;
      }
      const liveData = load();
      if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,liveData);
      const incumbent = _homeRenderedWeek || baselineWeek;
      const samePlan = homeAgendaPlanSignature(incumbent,liveData) === homeAgendaPlanSignature(week,liveData);
      if(samePlan)week = mergeHomeAgendaSamePlanProvenance(incumbent,week);
      const better = homeAgendaRefinementIsBetter(incumbent,week,liveData,sortSettings || settings);
      // Only absorb proofs from a week we actually keep. A rejected pass that
      // proved day 0 while heuristic-packing later days would otherwise freeze
      // the incumbent's day 0 and never apply the better packing.
      if(better || samePlan)absorbHomeAgendaProvenDayKeys(week);
      if(!better){
        // A proof/status improvement with identical placements is still useful
        // audit/cache metadata, but it should not repaint the DOM.
        if(samePlan){
          _homeRenderedWeek = week;
          _optimizerHomeReadyWeek = week;
          _optimizerHomeReadyKey = optimizerHomeStateKey(liveData);
          _optimizerHomeReadyDirtyKey = dirtyKey;
          saveHomeAgendaCache(liveData,week);
        }
      }else{
        render({__fromBackgroundRefresh:true,__fromOptimizer:true,__optimizedWeek:week});
        const stableData = load();
        _optimizerHomeReadyWeek = week;
        _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
        _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
        saveHomeAgendaCache(stableData,week);
        _homeListFingerprint = homeListFingerprint();
      }
      const mounted = _homeRenderedWeek || week;
      const stillNeeds = homeAgendaNeedsBackgroundRefinement(mounted,load(),sortSettings || settings);
      const passesLeft = _optimizerHomeRefinementPass < maxPasses;
      if(stillNeeds && passesLeft
        && !(typeof document !== 'undefined' && document.visibilityState === 'hidden')){
        queueHomeAgendaRefinementRetry(liveData,settings,mounted);
      }else{
        _optimizerHomeRefinementDoneKey = refinementKey;
      }
      syncHomePlannerStatusIndicators();
    }).catch(()=>{
      if(token !== _optimizerHomeRefinementToken)return;
      _optimizerHomeRefinementKey = '';
      _optimizerHomeRefinementPass += 1;
      const passesLeft = _optimizerHomeRefinementPass < maxPasses;
      if(passesLeft
        && !(typeof document !== 'undefined' && document.visibilityState === 'hidden')){
        queueHomeAgendaRefinementRetry(data,settings,baselineWeek);
      }else{
        _optimizerHomeRefinementDoneKey = refinementKey;
      }
      syncHomePlannerStatusIndicators();
    });
  };
  // Refinement is deliberately opportunistic: the usable incumbent is already
  // mounted, so wait for a quiet main-thread interval before asking the worker
  // to consume CPU. The timeout guarantees eventual progress on browsers that
  // rarely report idle time while animations/timers are active.
  const idleTimeout = typeof HOME_AGENDA_REFINEMENT_IDLE_TIMEOUT_MS === 'number'
    ? HOME_AGENDA_REFINEMENT_IDLE_TIMEOUT_MS : 1500;
  if(typeof requestIdleCallback === 'function'){
    _optimizerHomeRefinementIdleCallback = true;
    _optimizerHomeRefinementIdleTimer = requestIdleCallback(run,{timeout:idleTimeout});
  }else{
    _optimizerHomeRefinementIdleTimer = setTimeout(run,Math.min(250,idleTimeout));
  }
  return true;
}

// Phone browsers may otherwise keep the nested GLPK worker consuming battery
// after the user locks the screen. Only refinement is cancelled here; the
// first usable agenda is already mounted by the time this flag is set.
if(typeof document !== 'undefined' && document.addEventListener){
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)return;
    cancelHomeAgendaRefinement('background refinement paused while hidden');
  });
}

function homeReadingScrollHost(list){
  if(!list)return null;
  const pane = list.closest('.pane-list');
  return pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : null;
}

function homeReadingElementKey(el){
  if(!el)return '';
  if(el.classList.contains('swipe-row')){
    return `row:${el.dataset.hid || el.dataset.realIdx || ''}:${el.dataset.dayBase || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.classList.contains('section-header')){
    return `section:${el.dataset.capacityDay || el.dataset.label || ''}`;
  }
  if(el.classList.contains('travel-card') || el.classList.contains('travel-text')){
    return `travel:${el.dataset.travelFrom || ''}:${el.dataset.travelTo || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.dataset && el.dataset.blockedGroup)return `blocked:${el.dataset.blockedGroup}`;
  return '';
}

// READ: remember the item the user is currently reading and its viewport
// offset. The raw scroll position is retained as a fallback if that item is
// legitimately removed by the new plan.
function captureHomeReadingPosition(list){
  if(!list || !list.children.length)return null;
  const host = homeReadingScrollHost(list);
  const scrollTop = host ? host.scrollTop : window.scrollY;
  if(scrollTop <= 1)return null;
  const hostRect = host ? host.getBoundingClientRect() : {top:0,bottom:window.innerHeight};
  const top = Math.max(0,hostRect.top);
  const bottom = Math.min(window.innerHeight,hostRect.bottom);
  const candidates = Array.from(list.children);
  const anchor = candidates.find(el=>{
    const rect = el.getBoundingClientRect();
    return rect.bottom > top + 1 && rect.top < bottom;
  });
  if(!anchor)return {host,scrollTop,key:'',offset:0};
  return {
    host,
    scrollTop,
    key:homeReadingElementKey(anchor),
    hid:anchor.dataset && anchor.dataset.hid || '',
    dayKey:anchor.dataset && (anchor.dataset.capacityDay || (anchor.dataset.dayBase ? dateKey(Number(anchor.dataset.dayBase)) : '')) || '',
    offset:anchor.getBoundingClientRect().top - top
  };
}

// WRITE: put the same semantic row back under the user's eyes after a genuine
// plan change. This prevents a background refresh from jumping them to the top
// or losing tomorrow while still allowing rows to move when the plan changed.
function restoreHomeReadingPosition(snapshot,list){
  if(!snapshot || !list)return;
  const host = homeReadingScrollHost(list);
  const top = Math.max(0,host ? host.getBoundingClientRect().top : 0);
  const children = Array.from(list.children);
  let anchor = snapshot.key
    ? children.find(el=>homeReadingElementKey(el) === snapshot.key)
    : null;
  if(!anchor && snapshot.hid){
    anchor = children.find(el=>el.dataset && el.dataset.hid === snapshot.hid);
  }
  if(!anchor && snapshot.dayKey){
    anchor = children.find(el=>el.dataset && (
      el.dataset.capacityDay === snapshot.dayKey
      || (el.dataset.dayBase && dateKey(Number(el.dataset.dayBase)) === snapshot.dayKey)
    ));
  }
  if(anchor){
    const delta = anchor.getBoundingClientRect().top - top - snapshot.offset;
    if(Math.abs(delta) > 0.5){
      if(host)host.scrollTop += delta;
      else window.scrollBy({top:delta,left:0,behavior:'instant'});
    }
    return;
  }
  if(host)host.scrollTop = Math.min(snapshot.scrollTop,Math.max(0,host.scrollHeight - host.clientHeight));
  else window.scrollTo({
    top:Math.min(snapshot.scrollTop,Math.max(0,document.documentElement.scrollHeight - window.innerHeight)),
    left:0,
    behavior:'instant'
  });
}

const HOME_PLANNER_ALGORITHM_VERSION = 20;

// PURE: planner dirty signature without the wall-clock minute bucket. Background
// refreshes use this so a clock tick alone cannot force a full worker replan.
function homePlannerDirtyKey(data = (typeof load === 'function' ? load() : [])){
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const rev = typeof plannerDataRevision === 'function' ? plannerDataRevision() : 0;
  // Planner-relevant settings only — presentation (minimalMode, homeExtraMode,
  // showScheduledTasksInAgenda, showStatusOnCards, …) omitted.
  const settingsSig = JSON.stringify({
    agendaOptimizer:Boolean(s.agendaOptimizer),
    showWeekOnHome:Boolean(s.showWeekOnHome),
    // Candidate gates (isWeekCandidate) — toggles must invalidate the plan.
    showDueTasksInAgenda:s.showDueTasksInAgenda !== false,
    showPlannedItemsInAgenda:s.showPlannedItemsInAgenda !== false,
    showDueHabitsInAgenda:s.showDueHabitsInAgenda !== false,
    availabilityMinutes:s.availabilityMinutes || [],
    availabilityOverrides:s.availabilityOverrides || {},
    blockedTimes:s.blockedTimes || [],
    cancelledBlocks:s.cancelledBlocks || {},
    blockedTimeOverrides:s.blockedTimeOverrides || {},
    agendaScoreWeights:s.agendaScoreWeights || null,
    prayerMethod:s.prayerMethod || '',
    prayerMadhab:s.prayerMadhab || '',
    // Prayer/location windows resolve from home city coords.
    homeCityLat:Number.isFinite(s.homeCityLat) ? s.homeCityLat : null,
    homeCityLng:Number.isFinite(s.homeCityLng) ? s.homeCityLng : null,
    focus:s.focus || '',
    defaultTravelMode:s.defaultTravelMode || '',
    locations:(s.locations || []).map(l=>({
      id:l.id,lat:l.lat,lng:l.lng,
      allowedTimeStart:l.allowedTimeStart,allowedTimeEnd:l.allowedTimeEnd,
      preferredTimeStart:l.preferredTimeStart,preferredTimeEnd:l.preferredTimeEnd,
      closedDays:l.closedDays,hoursByDay:l.hoursByDay,weatherProfileId:l.weatherProfileId || null
    })),
    weatherProfiles:(s.weatherProfiles || []).map(p=>p && p.id).filter(Boolean).join('|'),
    weatherRevision:s._weatherContext && s._weatherContext.revision || '',
    // attentionScore / sort-lab inputs (isSortSettingKey list).
    plansFirst:Boolean(s.plansFirst),
    planWindowDays:s.planWindowDays || 0,
    planWeight:s.planWeight || 0,
    dueWeight:s.dueWeight || 0,
    progressWeight:s.progressWeight || 0,
    trendWeight:s.trendWeight || 0,
    rhythmWeight:s.rhythmWeight || 0,
    buildWeight:s.buildWeight || 0,
    limitWeight:s.limitWeight || 0,
    stopWeight:s.stopWeight || 0,
    newWeight:s.newWeight || 0,
    newBuildMode:s.newBuildMode || '',
    dueMode:s.dueMode || '',
    buildLookAheadDays:s.buildLookAheadDays || 0,
    buildRiseAt:s.buildRiseAt || 0,
    limitMode:s.limitMode || '',
    stopMode:s.stopMode || '',
    rhythmBias:s.rhythmBias || 0
  });
  return [
    `algorithm:${HOME_PLANNER_ALGORITHM_VERSION}`,
    rev,
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    travelSig,
    coordSig,
    currentEdgeSig,
    settingsSig,
    Array.isArray(data) ? data.length : 0
  ].join('\n');
}

// The lightweight home fingerprint deliberately omits some low-frequency
// fields. Optimizer reuse needs an exact key so edits to any habit, window,
// location, score weight, or travel edge can never reuse a stale schedule.
// Prefer the dirty-counter + live sig for request dedupe; keep a compact
// persisted digest for same-day disk cache identity (day-stable via dayStart).
function homePlannerStateKey(data,fingerprintNow = Date.now()){
  const dirty = homePlannerDirtyKey(data);
  // Include a coarse time bucket only for live optimizer keys (not dayStart),
  // so a genuine "now moved" reopen can still refresh day 0 via day0Only.
  const isDayStable = fingerprintNow === dayStart(fingerprintNow);
  const timePart = isDayStable ? 'day' : String(Math.floor(fingerprintNow / 60000));
  return `${dirty}\n${timePart}`;
}

function optimizerHomeStateKey(data){
  return homePlannerStateKey(data);
}

const HOME_AGENDA_CACHE_VERSION = 3;
const HOME_AGENDA_CACHE_KEY = 'tings_home_agenda_cache_v3';
const HOME_AGENDA_CACHE_FRESH_MS = 10 * 60 * 1000;
const HOME_COLD_BOOT_SKELETON_MAX_MS = 60 * 1000;

// Older keys may contain a week solved by a previous Worker even when the page
// scripts have updated. They are derived data only, so remove them eagerly.
try{
  localStorage.removeItem('tings_home_agenda_cache_v1');
  localStorage.removeItem('tings_home_agenda_cache_v2');
}catch(_){}

function showHomeAgendaLoading(){
  const list = $('list');
  if(!list || list.querySelector('.home-loading'))return;
  list.innerHTML = '<div class="home-loading" role="status" aria-label="loading agenda"><span></span><span></span><span></span></div>';
}

function homeAgendaCacheStateKey(data){
  return homePlannerStateKey(data,dayStart(Date.now()));
}

function readHomeAgendaCacheRecord(data){
  try{
    const cached = Storage.read(HOME_AGENDA_CACHE_KEY);
    if(!cached || cached.version !== HOME_AGENDA_CACHE_VERSION || !cached.week)return null;
    if(cached.key !== homeAgendaCacheStateKey(data))return null;
    if(dateKey(cached.savedAt) !== dateKey(Date.now()))return null;
    return cached;
  }catch(_){
    return null;
  }
}

function cachedHomeAgenda(data){
  try{
    const cached = readHomeAgendaCacheRecord(data);
    if(!cached)return null;
    const week = cached.week;
    for(const day of week.days || []){
      for(const row of day.timeline || []){
        if(row && row.i != null)row.h = data[row.i] || null;
      }
      for(const item of day.agendaItems || []){
        if(item && item.i != null)item.h = data[item.i] || null;
      }
    }
    return week;
  }catch(_){
    return null;
  }
}

function homeAgendaCacheIsFresh(data){
  const cached = readHomeAgendaCacheRecord(data);
  if(!cached)return false;
  return (Date.now() - Number(cached.savedAt || 0)) <= HOME_AGENDA_CACHE_FRESH_MS;
}

function saveHomeAgendaCache(data,week){
  if(!week || !Array.isArray(week.days))return;
  try{
    plannerPerfMark('planner-cache-write-start');
    // Habit records are already persisted once and every planner row carries
    // its stable data index. Omitting repeated `h` objects keeps this cache
    // small even for histories with hundreds of logs.
    const leanWeek = week.__lean ? week : leanAgendaWeek(week);
    if(leanWeek && leanWeek.__lean)delete leanWeek.__lean;
    Storage.write(HOME_AGENDA_CACHE_KEY,{
      version:HOME_AGENDA_CACHE_VERSION,
      savedAt:Date.now(),
      key:homeAgendaCacheStateKey(data),
      week:leanWeek
    });
    plannerPerfMark('planner-cache-write-end');
  }catch(_){}
}

// View-only state such as an expanded blocked group does not change placement.
// Repaint from the already solved week so the interaction responds immediately
// even if travel-cache background writes changed the next optimizer key.
function renderHomePresentationOnly(){
  if(!sortSettings && typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  if(_homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
    render({__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
    return;
  }
  render();
}

// ASYNC COORDINATOR: keep week planning outside the UI thread in both modes.
// A same-day cached or currently mounted week provides a stable view while the
// worker solves. A first-ever cold open keeps its skeleton until that result.
function adoptHomeAgendaReadyState(week,data,claimLiveKey){
  if(!week || !Array.isArray(week.days))return;
  _optimizerHomeReadyWeek = week;
  _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(data);
  if(claimLiveKey)_optimizerHomeReadyKey = optimizerHomeStateKey(data);
}

function scheduleIdlePlannerWarmAndBuild(data,opts){
  if(_idlePlannerRefreshTimer != null)return;
  const run = ()=>{
    _idlePlannerRefreshTimer = null;
    if(typeof document !== 'undefined' && document.visibilityState === 'hidden')return;
    // Warm is fire-and-forget and exact-mode only — never block the replan
    // behind a GLPK compile (especially in fast mode).
    const exact = Boolean(
      (typeof sortSettings !== 'undefined' && sortSettings && sortSettings.agendaOptimizer)
      && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())
    );
    if(exact && typeof warmAgendaPlannerWorker === 'function'){
      void warmAgendaPlannerWorker();
    }
    const live = typeof load === 'function' ? load() : data;
    // Fresh cache already is a solved week. Keep or slide it on idle so cold
    // open does not immediately spend the 4s GLPK budget. A day-0 re-solve
    // only runs when the clock actually needs a new packing. If that mounted
    // plan is still only feasible, spend idle time on background refinement.
    let reuseFarDays = true;
    if(_homeRenderedWeek && typeof homeAgendaTickPlan === 'function'){
      const plan = homeAgendaTickPlan(_homeRenderedWeek,Date.now());
      if(plan.kind === 'keep' || plan.kind === 'clock-shift'){
        if(typeof tickHomeAgendaWhileOpen === 'function')tickHomeAgendaWhileOpen();
        adoptHomeAgendaReadyState(_homeRenderedWeek,live,true);
        _homeListFingerprint = homeListFingerprint();
        if(exact)maybeScheduleHomeAgendaRefinement(_homeRenderedWeek);
        return;
      }
      if(plan.reuseFarDays === false)reuseFarDays = false;
    }
    queueOptimizedHomeRender(live,{
      ...(opts || {}),
      __backgroundRefresh:true,
      __fromIdleRefresh:true,
      __skipFreshnessGate:true,
      __forceReplan:true,
      __reuseFarDays:reuseFarDays
    });
  };
  if(typeof requestIdleCallback === 'function'){
    _idlePlannerRefreshTimer = requestIdleCallback(run,{timeout:200});
  }else{
    _idlePlannerRefreshTimer = setTimeout(run,50);
  }
}

// Unfinished morning work, weather, and location changes must reopen later
// days. Clock-driven keep/shift/imminent ticks of the same revision may reuse.
function homeAgendaClockRefreshMayReuseFarDays(opts){
  if(!opts)return true;
  if(opts.__reuseFarDays === false)return false;
  if(opts.__weatherChanged || opts.__locationChanged)return false;
  return true;
}

// Only a clock-driven refresh of the same planner revision may replay the
// mounted packing. Forced weather/location/data refreshes need a real solve so
// their changed costs and deferral signals can affect the agenda. An unfinished
// fill that may need another day also cannot replay tomorrow's clocks.
function homeAgendaShouldReuseIncumbent(day0Only,opts,dirtyKey,priorPlacements){
  if(!homeAgendaClockRefreshMayReuseFarDays(opts))return false;
  if(day0Only)return true;
  if(!Array.isArray(priorPlacements) || !priorPlacements.length)return false;
  if(_optimizerHomeReadyDirtyKey !== dirtyKey)return false;
  return Boolean(opts && (opts.__tickReplan || opts.__fromIdleRefresh));
}

function queueOptimizedHomeRender(data,opts){
  plannerPerfMark('planner-queue-start');
  const key = optimizerHomeStateKey(data);
  const dirtyKey = homePlannerDirtyKey(data);
  const exactMode = Boolean(sortSettings && sortSettings.agendaOptimizer);
  if(_optimizerHomeReadyKey === key && _optimizerHomeReadyWeek){
    if(opts && opts.__backgroundRefresh
      && homeAgendaPlanSignature(_homeRenderedWeek,data) === homeAgendaPlanSignature(_optimizerHomeReadyWeek,data)){
      _homeRenderedWeek = _optimizerHomeReadyWeek;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(data,_homeRenderedWeek);
      _homeListFingerprint = homeListFingerprint();
      return false;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:_optimizerHomeReadyWeek});
    _homeListFingerprint = homeListFingerprint();
    return true;
  }
  // Background tick: dirty key unchanged → skip the worker entirely.
  // Forced reopen (hidden ≥60s) still replans; may use day0Only when dirty matches.
  if(opts && opts.__backgroundRefresh && !opts.__forceReplan
    && _optimizerHomeReadyDirtyKey
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek){
    _homeListFingerprint = homeListFingerprint();
    return false;
  }
  if(_optimizerHomeRequestKey === key){
    // Request de-dupe must not swallow a foreground presentation change made
    // while that solve is active. Repaint from the stable mounted plan; do not
    // start or publish another scheduling result.
    if(!(opts && opts.__backgroundRefresh)
      && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
      render({...opts,__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
      _homeListFingerprint = homeListFingerprint();
      return true;
    }
    return false;
  }
  // A save/log/add can invalidate an exact solve that is still running. Do not
  // queue the user's new plan behind obsolete work: terminate it and let this
  // foreground request start a fresh solve.
  if(_optimizerHomeRequestKey && _optimizerHomeRequestKey !== key
    && (!(opts && opts.__backgroundRefresh) || (opts && opts.__locationChanged))){
    ++_optimizerHomeRequestToken;
    _optimizerHomeRequestKey = '';
    syncHomePlannerStatusIndicators();
    if(typeof cancelAgendaPlannerWorkerRequests === 'function'){
      cancelAgendaPlannerWorkerRequests('planner state changed during solve');
    }
  }

  // Background refreshes keep the current DOM. Direct/cold renders use the
  // latest compatible plan, avoiding both a blank launch and reordered phases.
  let paintedFromCache = false;
  if(!(opts && opts.__backgroundRefresh)){
    plannerPerfMark('planner-cache-read');
    const cached = cachedHomeAgenda(data);
    if(cached){
      render({...opts,__fromOptimizer:true,__optimizedWeek:cached});
      paintedFromCache = !(opts && opts.__skipFreshnessGate);
      // Seed day0Only without claiming the live minute key, so idle can still
      // refresh today when the clock has moved, while far days reuse this week.
      adoptHomeAgendaReadyState(cached,data,false);
    }else if(_homeRenderedWeek && $('list')?.querySelector('.ting-card')){
      // A done/log/add render keeps the existing agenda mounted. The action has
      // already been persisted; replace the agenda only when its new solve is
      // ready instead of flashing an unplanned intermediate list.
    }else if(!$('list')?.querySelector('.home-loading')){
      // No compatible agenda exists to keep mounted. Stay in the intentional
      // boot animation until planning resolves instead of flashing an unordered
      // due-list between two planned states.
      showHomeAgendaLoading();
    }
    // Cold open with no cache keeps the HTML skeleton until the worker result.
    _homeListFingerprint = homeListFingerprint();
    plannerPerfMark('planner-first-paint');
  }

  // Compatible same-day cache: paint now and let idle keep/shift or day-0
  // reuse own any clock update so cold open does not pay a full-week GLPK.
  if(paintedFromCache && !(opts && opts.__skipFreshnessGate)){
    scheduleIdlePlannerWarmAndBuild(data,opts);
    return true;
  }

  // A foreground or imminent re-solve must not wait behind background
  // refinement, even when the dirty revision is unchanged.
  if(_optimizerHomeRefinementKey){
    cancelHomeAgendaRefinement('planner request superseded refinement');
  }

  const token = ++_optimizerHomeRequestToken;
  _optimizerHomeRequestKey = key;
  syncHomePlannerStatusIndicators();
  const settings = {...(sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {}))};
  // The planner runs in a Worker, where the page's ephemeral GPS coordinate is
  // intentionally unavailable. Carry only its matched saved-place id across
  // the boundary so a plan requested after "I'm at Walmart" starts there
  // immediately, even before lastKnownLocationId has been persisted.
  const livePlannerLocationId = typeof liveLocationId === 'function' ? liveLocationId() : null;
  if(livePlannerLocationId)settings._plannerLiveLocationId = livePlannerLocationId;
  const livePlannerCoord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  if(livePlannerCoord && typeof isCurrentCoordAwayFromSaved === 'function'
    && isCurrentCoordAwayFromSaved(settings.locations)){
    settings._plannerCurrentCoord = {lat:livePlannerCoord.lat,lng:livePlannerCoord.lng};
  }
  const day0Only = Boolean(
    opts && opts.__forceReplan
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek
    && homeAgendaClockRefreshMayReuseFarDays(opts)
  );
  const sourceWeek = _homeRenderedWeek || _optimizerHomeReadyWeek;
  const priorPlacements = Array.isArray(opts && opts.__priorPlacements)
    ? opts.__priorPlacements
    : (typeof agendaPriorPlacementsFromWeek === 'function'
      ? agendaPriorPlacementsFromWeek(sourceWeek)
      : (typeof agendaPriorPlacementsFromTimeline === 'function'
        ? agendaPriorPlacementsFromTimeline(
          sourceWeek && sourceWeek.days && sourceWeek.days[0]
            && sourceWeek.days[0].timeline || [],
          sourceWeek && sourceWeek.days && sourceWeek.days[0] && sourceWeek.days[0].dayBase
        )
        : []));
  const buildOpts = {
    dirtyKey,
    day0Only,
    reuseIncumbent:homeAgendaShouldReuseIncumbent(
      day0Only,opts,dirtyKey,priorPlacements
    ),
    tickReplan:Boolean(opts && opts.__tickReplan),
    glpkLimitSeconds:opts && opts.__tickReplan
      ? (typeof HOME_AGENDA_TICK_GLPK_LIMIT_SECONDS === 'number'
        ? HOME_AGENDA_TICK_GLPK_LIMIT_SECONDS : 10)
      : 0,
    incumbentSolveStatus:sourceWeek && sourceWeek.plannerSolveStatus || '',
    priorPlacements,
    memoDays:day0Only && typeof memoDaysFromWeek === 'function'
      ? memoDaysFromWeek(sourceWeek)
      : []
  };
  if(!exactMode)buildOpts.fastGraph = true;
  const optimizerBuild = typeof buildWeekAgendaOffMain === 'function'
    ? buildWeekAgendaOffMain(data,settings,7,exactMode ? 'exact' : 'fast',buildOpts)
    : buildWeekAgendaAsync(data,settings,7,buildOpts);
  // Keep the intentional cold-open animation, but never indefinitely. If a
  // phone's Worker/WASM bring-up stalls, reveal the usable grouped list after
  // a bounded wait; the exact result still replaces it when it arrives.
  const coldBootTimer = $('list')?.querySelector('.home-loading')
    ? setTimeout(()=>{
        if(token !== _optimizerHomeRequestToken)return;
        if($('list')?.querySelector('.home-loading'))render({...opts,deferAgenda:true});
      },HOME_COLD_BOOT_SKELETON_MAX_MS)
    : null;
  void optimizerBuild.then(week=>{
    if(coldBootTimer != null)clearTimeout(coldBootTimer);
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    syncHomePlannerStatusIndicators();
    const live = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : null);
    if(!live)return;
    if(key !== optimizerHomeStateKey(load())){
      if(opts && opts.__backgroundRefresh)queueOptimizedHomeRender(load(),opts);
      else render(opts);
      return;
    }
    if(!week || !Array.isArray(week.days))return;
    const liveData = load();
    // Worker posts a lean week (no `h`). Re-attach before any consumer reads names.
    if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,liveData);
    // In exact mode a timed-out solve returns the heuristic fallback. A cached
    // planned week can stay mounted; on a first-ever load, use that fallback
    // rather than leaving the user on the unplanned basic list.
    if(exactMode && !week.optimized){
      if(!_homeRenderedWeek){
        render({...opts,__fromOptimizer:true,__optimizedWeek:week});
        // Rendering may persist automatic chunk plans and bump the planner
        // revision. Cache only after those writes so the record is not stale
        // the instant it is created.
        saveHomeAgendaCache(load(),week);
        _homeListFingerprint = homeListFingerprint();
      }
      return;
    }
    _optimizerHomeReadyWeek = week;
    if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
      _homeRenderedWeek = week;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
      const stableData = load();
      _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
      _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
      saveHomeAgendaCache(stableData,week);
      _homeListFingerprint = homeListFingerprint();
      if(exactMode && !(opts && opts.__weatherChanged))scheduleHomeAgendaRefinement(stableData,settings,week);
      syncHomePlannerStatusIndicators();
      if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
      return;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:week});
    const stableData = load();
    // Rendering can persist automatic chunk plans. Claim/cache the state after
    // that revision bump so a background tick or location refresh does not
    // immediately launch the same solve again.
    _optimizerHomeReadyKey = optimizerHomeStateKey(stableData);
    _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(stableData);
    saveHomeAgendaCache(stableData,week);
    _homeListFingerprint = homeListFingerprint();
    if(exactMode && !(opts && opts.__weatherChanged))scheduleHomeAgendaRefinement(stableData,settings,week);
    if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
  }).catch(()=>{
    if(coldBootTimer != null)clearTimeout(coldBootTimer);
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    syncHomePlannerStatusIndicators();
    // Keep the fast planner already on screen. A cold open still sitting on
    // the skeleton animation gets the basic list instead of loading forever.
    // (If the skeleton behavior is disabled above, this guard never fires:
    // the deferAgenda paint has already replaced the skeleton.)
    if($('list')?.querySelector('.home-loading'))render({...opts,deferAgenda:true});
  });
  return true;
}

// Immediate feedback for a saved travel override. The optimized replan still
// runs, but the tapped edge shows its edited value while GLPK is working.
function markHomeTravelEdgeEdited(fromId,toId,minutes){
  const mins = Math.max(1,Math.round(Number(minutes) || 1));
  document.querySelectorAll('#list .travel-card').forEach(card=>{
    const sameEdge = (card.dataset.travelFrom === fromId && card.dataset.travelTo === toId)
      || (card.dataset.travelFrom === toId && card.dataset.travelTo === fromId);
    if(!sameEdge)return;
    card.classList.add('is-edited');
    const copy = card.querySelector('span');
    if(copy)copy.textContent = copy.textContent.replace(/\b\d+\s+min\b/,`${mins} min`);
    if(!card.querySelector('.travel-edit-mark')){
      const icon = document.createElement('i');
      icon.className = 'ti ti-pencil travel-edit-mark';
      icon.setAttribute('aria-hidden','true');
      card.appendChild(icon);
    }
  });
}

function nextPendingAgendaIndex(rows,now){
  if(!Array.isArray(rows))return -1;
  for(let i = 0;i < rows.length;i += 1){
    const row = rows[i];
    if(row && (row.kind === 'fill' || row.kind === 'scheduled') && Number(row.end) > now){
      return i;
    }
  }
  return -1;
}

function shiftAgendaFillToNow(rows,idx,now){
  const row = rows[idx];
  if(!row || row.kind !== 'fill')return null;
  const newStart = typeof ceilToMinutes === 'function' ? ceilToMinutes(now,1) : Math.ceil(now / 60000) * 60000;
  const delta = newStart - Number(row.start);
  if(!(delta > 0))return null;
  const maxShift = typeof HOME_AGENDA_SHIFT_MAX_MS === 'number' ? HOME_AGENDA_SHIFT_MAX_MS : 15 * 60 * 1000;
  if(delta > maxShift)return null;
  let prevEnd = null;
  for(let i = idx - 1;i >= 0;i -= 1){
    if(rows[i] && (rows[i].kind === 'fill' || rows[i].kind === 'scheduled')){
      prevEnd = Number(rows[i].end);
      break;
    }
  }
  const inbound = idx > 0 && rows[idx - 1] && rows[idx - 1].kind === 'travel' ? rows[idx - 1] : null;
  if(inbound && prevEnd != null && Number(inbound.start) + delta < prevEnd - 1)return null;
  let nextStart = Infinity;
  for(let i = idx + 1;i < rows.length;i += 1){
    if(rows[i] && (rows[i].kind === 'fill' || rows[i].kind === 'scheduled')){
      nextStart = Number(rows[i].start);
      break;
    }
  }
  const outbound = rows[idx + 1] && rows[idx + 1].kind === 'travel' ? rows[idx + 1] : null;
  const outboundDur = outbound ? Number(outbound.end) - Number(outbound.start) : 0;
  if(Number(row.end) + delta + outboundDur > nextStart + 1)return null;
  const start = inbound ? idx - 1 : idx;
  const end = outbound ? idx + 1 : idx;
  return rows.map((entry,i)=>{
    if(i < start || i > end)return entry;
    return {...entry,start:Number(entry.start) + delta,end:Number(entry.end) + delta};
  });
}

// PURE: decide what the 60-second home loop should do with the last plan.
//   keep            — next item is still well in the future; reuse the week
//   clock-shift     — next fill started in the past; slide it by a few minutes
//   imminent-solve  — next row is a couple of minutes away, or a slide would clash
function homeAgendaTickPlan(week,now = Date.now()){
  const day = week && Array.isArray(week.days) ? week.days[0] : null;
  if(!day || !Array.isArray(day.timeline))return {kind:'keep'};
  const todayBase = typeof dayStart === 'function' ? dayStart(now) : now;
  if(Number(day.dayBase) && Number(day.dayBase) !== todayBase)return {kind:'imminent-solve'};
  // A cached fill that has passed without a matching log is unfinished work,
  // not reusable history. Repack it instead of keeping a stale morning plan
  // merely because the next still-future row is hours away.
  if(day.timeline.some(row=>row && row.kind === 'fill' && Number(row.end) <= now)){
    // Unfinished work may need another day. Do not freeze tomorrow's memo.
    return {kind:'imminent-solve',reuseFarDays:false};
  }
  const idx = nextPendingAgendaIndex(day.timeline,now);
  if(idx < 0)return {kind:'keep'};
  const row = day.timeline[idx];
  const until = Number(row.start) - now;
  const imminentMs = typeof HOME_AGENDA_IMMINENT_MS === 'number' ? HOME_AGENDA_IMMINENT_MS : 3 * 60 * 1000;
  if(typeof getDoingNow === 'function' && typeof isDoingNowActive === 'function'){
    const doing = getDoingNow();
    if(doing && isDoingNowActive(doing) && row.h && row.h.hid === doing.hid)return {kind:'keep'};
  }
  if(row.kind === 'scheduled'){
    return until <= imminentMs ? {kind:'imminent-solve'} : {kind:'keep'};
  }
  if(until > imminentMs)return {kind:'keep'};
  if(until > 0)return {kind:'imminent-solve'};
  const timeline = shiftAgendaFillToNow(day.timeline,idx,now);
  if(!timeline)return {kind:'imminent-solve'};
  return {kind:'clock-shift',timeline};
}

function tickHomeAgendaWhileOpen(){
  if(!_homeRenderedWeek || !Array.isArray(_homeRenderedWeek.days))return false;
  const plan = homeAgendaTickPlan(_homeRenderedWeek,Date.now());
  if(plan.kind === 'keep'){
    maybeScheduleHomeAgendaRefinement(_homeRenderedWeek);
    return true;
  }
  if(plan.kind === 'clock-shift'){
    const week = {
      ..._homeRenderedWeek,
      days:_homeRenderedWeek.days.map((day,index)=>index === 0
        ? {...day,timeline:plan.timeline,homeDisplayedTimeline:null}
        : day)
    };
    render({__fromOptimizer:true,__fromBackgroundRefresh:true,__optimizedWeek:week});
    _homeRenderedWeek = week;
    _optimizerHomeReadyWeek = week;
    const data = typeof load === 'function' ? load() : [];
    if(typeof saveHomeAgendaCache === 'function')saveHomeAgendaCache(data,week);
    _homeListFingerprint = homeListFingerprint();
    maybeScheduleHomeAgendaRefinement(week);
    return true;
  }
  if(plan.kind === 'imminent-solve'){
    if(_optimizerHomeRequestKey)return true;
    const data = typeof load === 'function' ? load() : [];
    queueOptimizedHomeRender(data,{
      __backgroundRefresh:true,
      __forceReplan:true,
      __tickReplan:true,
      __reuseFarDays:plan.reuseFarDays !== false,
      __priorPlacements:typeof agendaPriorPlacementsFromWeek === 'function'
        ? agendaPriorPlacementsFromWeek(_homeRenderedWeek)
        : (typeof agendaPriorPlacementsFromTimeline === 'function'
          ? agendaPriorPlacementsFromTimeline(
            _homeRenderedWeek.days[0] && _homeRenderedWeek.days[0].timeline,
            _homeRenderedWeek.days[0] && _homeRenderedWeek.days[0].dayBase
          )
          : [])
    });
    return true;
  }
  return false;
}

// RENDER: sync home list only when the freshness key moved. Background paths
// (travel refresh, while-open loop, quiet location updates) should call this
// instead of render() so an unchanged agenda never rebuilds the DOM.
function renderHomeIfChanged(force,opts = {}){
  const fp = homeListFingerprint();
  if(!force && fp === _homeListFingerprint)return false;
  const data = load();
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const canCompareWeek = Boolean(
    _homeRenderedWeek
    && Array.isArray(_homeRenderedWeek.days)
    && settings
    && settings.preset === 'todayFirst'
    && weekOnHomeEnabled(settings)
    && !(typeof searchQuery === 'string' && searchQuery.trim())
  );

  if(canCompareWeek){
    // Claim this state before starting work so a travel burst or visibility
    // event cannot enqueue the same recalculation repeatedly.
    _homeListFingerprint = fp;
    if(settings.agendaOptimizer && typeof buildWeekAgendaAsync === 'function'){
      queueOptimizedHomeRender(data,{
        __backgroundRefresh:true,
        __forceReplan:Boolean(force),
        __weatherChanged:Boolean(opts.__weatherChanged),
        __locationChanged:Boolean(opts.locationChanged)
      });
      return true;
    }
    if(!settings.agendaOptimizer && typeof buildWeekAgendaOffMain === 'function'){
      const token = ++_fastHomeRefreshToken;
      const requestedFingerprint = fp;
      const settingsSnapshot = {...settings};
      void buildWeekAgendaOffMain(data,settingsSnapshot,7,'fast',{fastGraph:true}).then(week=>{
        if(token !== _fastHomeRefreshToken || !week || !Array.isArray(week.days))return;
        const liveData = load();
        // A real edit/location update arrived while the worker was planning.
        // Discard this stale result and let the latest state schedule its own.
        if(requestedFingerprint !== homeListFingerprint()){
          renderHomeIfChanged();
          return;
        }
        if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
          _homeRenderedWeek = week;
          if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
          _homeListFingerprint = homeListFingerprint();
          return;
        }
        render({__fromBackgroundRefresh:true,__optimizedWeek:week});
        _homeListFingerprint = homeListFingerprint();
      }).catch(()=>{
        if(token !== _fastHomeRefreshToken)return;
        // Workers are widely available in the supported browsers. If creation
        // is blocked, keep the current plan instead of freezing touch input
        // with the old synchronous comparison path.
      });
      return true;
    }
  }
  const didRender = render();
  if(didRender !== false)_homeListFingerprint = homeListFingerprint();
  return true;
}

// Compat alias — progressive two-phase paint was retired because phase-1 order
// differed from agenda order and caused visible flicker. Callers that still
// name renderProgressive get a single sync render.
