function buildWeekAgenda(data,settings,numDays = 7,opts = {}){
  if(typeof replayAgendaClockWeek==='function'){
    const replay=replayAgendaClockWeek(data,settings,numDays,opts);
    if(replay)return replay;
  }
  const planningNow = opts.now != null ? Number(opts.now) : Date.now();
  const todayBase = dayStart(planningNow);
  const count = Math.max(1,Math.min(14,Math.round(numDays) || 7));
  const days = [];
  for(let offset = 0;offset < count;offset += 1){
    const dayBase = todayBase + offset * 86400000;
    days.push(buildDayAgenda(data,settings,dayBase,{
      weekMode:true,
      now:planningNow,
      fullDay:Boolean(opts.fullToday && offset === 0)
    }));
  }
  const makeStates = () => days.map(day=>createDayPlacementState(day,settings,{
    dayBase:day.dayBase,
    weekday:day.weekday,
    weekMode:true,
    now:planningNow,
    startClock:opts.fullToday && day.isToday
      ? day.dayBase + dayFirstOpenMinute(
        normalizeBlockedTimes(settings.blockedTimes),day.weekday,day.dayBase
      ) * 60000
      : undefined
  }));

  const candidates = [];
  const seen = new Set();
  for(let i = 0;i < data.length;i += 1){
    if(seen.has(i))continue;
    const h = data[i];
    if(typeof isFixedTimedTask === 'function' ? isFixedTimedTask(h)
      : (h.type === 'task' && h.eventTime !== null && !h.breakable))continue;
    const pinnedDay = typeof plannerPinnedDayBase === 'function'
      ? plannerPinnedDayBase(h,settings,todayBase,opts.fullToday ? {keepDueTodayForMissed:true} : null)
      : (isWeekPinnedToday(h,settings) ? todayBase : null);
    const pinned = pinnedDay != null;
    const eligible = new Set();
    for(const day of days){
      if(weekFillEligibleOnDay(h,settings,day.dayBase,day.weekday,pinnedDay)){
        eligible.add(day.dayBase);
      }
    }
    const hasSameDayLinks = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(h).length > 0
      : normalizeScheduleLinks(h.scheduleLinks,h.hid).some(l=>l && l.requireSameDay);
    const isSameDayAnchor = data.some(other=>{
      if(!other || other === h)return false;
      const links = typeof sameDayScheduleLinks === 'function'
        ? sameDayScheduleLinks(other)
        : normalizeScheduleLinks(other.scheduleLinks,other.hid).filter(l=>l && l.requireSameDay);
      return links.some(l=>l && l.anchorHid === h.hid);
    });
    // Keep same-day-linked habits and their anchors even with an empty set so
    // bidirectional pull can add flex-allowed partner days.
    if(!eligible.size && !hasSameDayLinks && !isSameDayAnchor)continue;
    seen.add(i);
    candidates.push({
      h, i,
      pinned,
      pinnedDay,
      priority:effectivePriority(h),
      score:attentionScore(h,i,settings),
      urgency:pinned ? Math.max(200,weekUrgency(h)) : weekUrgency(h),
      eligible
    });
  }
  // Opened before link eligibility: that pass reads committed anchors/subjects
  // out of the solve snapshot, and should hit the same cache as placement.
  if(typeof beginPlannerSolveCaches === 'function')beginPlannerSolveCaches(data);
  if(typeof plannerPerfResetTryPlace === 'function')plannerPerfResetTryPlace();

  // Eligibility needs the same origin-aware placement context as the exact
  // engine. In particular, a same-location pair at today's current/last-known
  // place is not a travel-saving cluster.
  try{
  let dayStates = makeStates();
  applyPersistentLinkEligibility(candidates,dayStates,settings);
  if(typeof applyClusterFlexEligibility === 'function'){
    applyClusterFlexEligibility(candidates,dayStates,settings);
  }
  for(let i = candidates.length - 1;i >= 0;i -= 1){
    const h = candidates[i] && candidates[i].h;
    const snoozed = h && h.snoozedUntil && Date.now() < h.snoozedUntil;
    if(snoozed || !candidates[i].eligible || !candidates[i].eligible.size)candidates.splice(i,1);
  }

  // Main-thread callers (missed-item projection, some audits) only need a
  // feasible hid/day map. Skip the Fast week-graph search during render: even
  // the cheap leftover pass is wasted work for a hid-per-day expectation map.
  const useFastGraph = opts.fastGraph !== false;
  const graphSeedBudget = useFastGraph ? 768 : 0;
  const graphSeeds = useFastGraph ? dayStates.map(cloneFastGraphState) : [];
  // Leave room for changing a crowded daily selection: keep-all permutations
  // alone can spend the entire budget on a set that cannot coexist.
  const selectionCandidates = candidates.filter(c=>!c.h.breakable && c.h.type !== 'task'
    && Number(c.h.target)===1 && !c.pinned && !mustPlaceCriticalOccurrence(c));
  const linkedBudget = useFastGraph && candidates.some(c=>sameDayScheduleLinks(c.h).length) ? 96 : 0;
  const insertionBudget = (useFastGraph && selectionCandidates.length>1 ? 384 : graphSeedBudget)-linkedBudget;
  const graphBudget = {remaining:insertionBudget,searches:0,accepted:0,linkRemaining:linkedBudget,linkAccepted:0};
  // Pass 1 — graph placement discovery of each location's natural day.
  assignWeekCandidatesByPlacement(candidates,dayStates,settings,null,graphBudget);
  const locHints = collectLocationHints(dayStates);

  // Pass 2 — re-place from clean states, pulled toward co-located partners.
  // Skip when ≤1 distinct location (no clustering to discover).
  const distinctLocs = new Set();
  for(const c of candidates){
    for(const id of (c.h && c.h.locationIds) || []){
      if(id)distinctLocs.add(id);
    }
  }
  if(distinctLocs.size > 1 && needsFastColocationReplay(candidates,dayStates,locHints)){
    // Discovery can consume the graph budget. A cheaper clustering replay
    // must not silently discard work that required that search to fit.
    const incumbent = dayStates.map(cloneFastGraphState);
    const occurrenceCounts = candidates.map(c=>c.unplacedOccurrenceCount);
    days.forEach(d=>{ d.agendaItems = []; });
    dayStates = makeStates();
    assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints,graphBudget);
    if(!fastGraphReplayRetainsWork(incumbent,dayStates,candidates)){
      dayStates = incumbent;
      for(let i=0;i<days.length;i++){
        const omissions = dayStates[i].day.linkOmissions;
        dayStates[i].day = days[i];
        syncDayAgendaItemsFromFills(dayStates[i]);
        days[i].linkOmissions = omissions;
      }
      candidates.forEach((c,i)=>{ c.unplacedOccurrenceCount = occurrenceCounts[i]; });
    }
  }

  placeAdditionalSameDayOccurrences(candidates,dayStates,settings);
  const weekGraphDiagnostics = useFastGraph
    ? improveFastGraphWeek(candidates,dayStates,graphSeeds,settings)
    : {evaluated:0,accepted:0,depth:0,budgetExhausted:false};
  const linkedProbes = linkedBudget-graphBudget.linkRemaining;
  const insertionProbes = insertionBudget-graphBudget.remaining+linkedProbes;
  const selectionDiagnostics = useFastGraph
    ? improveFastGraphDaySelections(candidates,dayStates,settings,{maxProbes:graphSeedBudget-insertionProbes})
    : {probes:0,accepted:0,budgetExhausted:false};
  const todayChoiceDiagnostics = useFastGraph
    ? improveFastGraphTodayChoices(candidates,dayStates,settings,
      {maxProbes:graphSeedBudget-insertionProbes-selectionDiagnostics.probes})
    : {probes:0,accepted:0};
  annotateAgendaOccurrenceKeys(candidates,dayStates);

  let totalTravelSeconds = 0;
  for(let d = 0;d < days.length;d += 1){
    const state = dayStates[d];
    const day = days[d];
    day.timeline = finalizePlacementRows(state);
    if(opts.diagnostics){
      day.placementDiagnostics = buildPlacementDiagnostics(
        candidates.filter(candidate=>candidate.eligible.has(day.dayBase)),
        state
      );
    }
    day.usedMinutes = state.usedMinutes;
    day.remainingMinutes = Math.max(0,(Number(day.totalMinutes) || 0) - state.usedMinutes);
    day.travelSeconds = day.timeline.filter(r=>r.kind === 'travel').reduce((s,r)=>s + (r.seconds || 0),0);
    totalTravelSeconds += day.travelSeconds;
  }
  if(!opts.skipDropAnnotation)annotateAgendaDropTimes(days,data,settings);
  return { days, totalTravelSeconds, candidateCount:candidates.length,
    fastPlannerAlgorithm:'bounded-state-graph',
    fastWeekGraphDiagnostics:weekGraphDiagnostics,
    fastSelectionDiagnostics:selectionDiagnostics,
    fastTodayChoiceDiagnostics:todayChoiceDiagnostics,
    fastGraphDiagnostics:{searches:graphBudget.searches,accepted:graphBudget.accepted,
      linkedProbes,linkedAccepted:graphBudget.linkAccepted,
      probes:insertionProbes+selectionDiagnostics.probes+todayChoiceDiagnostics.probes,
      budgetExhausted:useFastGraph && insertionProbes+selectionDiagnostics.probes+todayChoiceDiagnostics.probes>=graphSeedBudget} };
  }finally{
    if(typeof endPlannerSolveCaches === 'function')endPlannerSolveCaches();
  }
}

// PURE: format a timestamp as a short clock label
function agendaTimeLabel(ts){
  return new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

// RENDER: the separate #home-week-plan block is retired — week planning now
// lives inside the main home list as day sections (today / tomorrow / …).
// Keep this as a no-op clearer so older callers and empty-state paths stay safe.
function renderWeekOnHome(){
  const wrap = $('home-week-plan');
  if(!wrap)return;
  wrap.innerHTML = '';
  wrap.hidden = true;
}
