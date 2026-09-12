function buildWeekAgenda(data,settings,numDays = 7,opts = {}){
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
    if(h.type === 'task' && h.eventTime !== null)continue; // timed → scheduled rows
    const pinned = isWeekPinnedToday(h,settings);
    const eligible = new Set();
    for(const day of days){
      if(pinned && !day.isToday)continue;
      if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,day.dayBase))continue;
      if(isWeekCandidate(h,settings,day.dayBase,day.weekday) || (pinned && day.isToday)){
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
  const graphBudget = {remaining:graphSeedBudget,searches:0,accepted:0};
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
  if(distinctLocs.size > 1){
    days.forEach(d=>{ d.agendaItems = []; });
    dayStates = makeStates();
    assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints,graphBudget);
  }

  placeAdditionalSameDayOccurrences(candidates,dayStates,settings);
  const weekGraphDiagnostics = useFastGraph
    ? improveFastGraphWeek(candidates,dayStates,graphSeeds,settings)
    : {evaluated:0,accepted:0,depth:0,budgetExhausted:false};
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
  if(typeof endPlannerSolveCaches === 'function')endPlannerSolveCaches();
  return { days, totalTravelSeconds, candidateCount:candidates.length,
    fastPlannerAlgorithm:'bounded-state-graph',
    fastWeekGraphDiagnostics:weekGraphDiagnostics,
    fastGraphDiagnostics:{searches:graphBudget.searches,accepted:graphBudget.accepted,
      probes:graphSeedBudget - graphBudget.remaining,budgetExhausted:useFastGraph && graphBudget.remaining === 0} };
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
