// Fast planner: bounded search in a DAG of partial day schedules. A vertex is
// (committed placements, pending occurrences); an edge inserts one occurrence
// through the shared hard-constraint fitter. Different insertion orders reach
// different clocks/routes. Unlike irreversible greedy packing, a blocked edge
// can reopen earlier decisions and retain several alternative paths.
//
// Occurrence/day eligibility remains with the week orchestrator. Search moves
// occurrences within their assigned day only, so it cannot change cadence or
// spend extra delay. Links, active work, weather locks and split sessions are
// frozen. No ILP, time grid, network requests or wall-clock-dependent cutoff.
function cloneFastGraphState(state){
  return {
    ...clonePlacementState(state),
    rows:state.rows.map(row=>({...row})),
    fills:state.fills.map(entry=>({...entry,fill:{...entry.fill},fit:{...entry.fit}})),
    day:{...state.day,agendaItems:(state.day.agendaItems || []).map(item=>({...item}))},
    _committedRoutePlan:null
  };
}

function fastGraphPlacement(state,fill,opts,candidates,dayStates,budget){
  const direct = tryPlaceOnDay(state,fill,opts);
  if(direct)return {fit:direct,replacement:null};
  if(!budget || budget.remaining <= 0 || fill.h.breakable || state.placed.has(fill.i))return null;
  // Rearrangement can save travel, but cannot manufacture work minutes.
  const workMinutes = state.fills.reduce((sum,entry)=>sum + fillDurationMinutes(entry.fill),0);
  if(workMinutes + fillDurationMinutes(fill) > state.totalMinutes)return null;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));
  const linked = new Set();
  for(const edge of plannerOrderConstraintsForDay(state.dayBase) || []){
    linked.add(edge.beforeHid);
    linked.add(edge.afterHid);
  }
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const locked = f=>f.h.breakable || linked.has(f.h.hid)
    || (doing && doing.hid === f.h.hid)
    || (typeof weatherLockedPlacement === 'function'
      && weatherLockedPlacement(byIndex.get(f.i) || f,state,opts.settings));
  if(locked(fill))return null;

  // Bound the neighborhood, keeping all other occurrences at their clocks.
  // Tight/nearby placements are the useful blockers; stable index breaks ties.
  const windows = typeof fillDayWindows === 'function'
    ? fillDayWindows(fill.h,state.dayBase,state.seedLocId) || [] : [];
  const distance = entry=>windows.length ? Math.min(...windows.map(window=>
    Math.max(0,window.start - entry.fit.placeEnd,entry.fit.placeStart - window.end)))
    : Math.abs(entry.fit.placeStart - state.startClock);
  const movable = state.fills.filter(entry=>!locked(entry.fill)).sort((a,b)=>
    distance(a) - distance(b) || a.fit.placeStart - b.fit.placeStart
    || a.fill.i - b.fill.i).slice(0,7);
  if(!movable.length)return null;
  const moving = new Set(movable.map(entry=>entry.fill.i));
  const fixed = state.fills.filter(entry=>!moving.has(entry.fill.i));
  const base = cloneFastGraphState(state);
  base.rows = base.rows.filter(row=>row.kind === 'scheduled');
  base.fills = [];
  base.placed = new Set();
  base.remaining = Math.max(0,Number(state.totalMinutes) || 0);
  base.usedMinutes = 0;
  base.prevLocId = state.seedLocId;
  base.day.agendaItems = [];
  for(const entry of fixed){
    commitPlacement(base,{...entry.fill},{...entry.fit});
  }
  const pending = [fill,...movable.map(entry=>entry.fill)].map(f=>({...f}));
  let frontier = [{state:base,pending,cost:0}];
  let probes = 0;
  const maxProbes = Math.min(192,budget.remaining);
  budget.searches += 1;
  // Beam search retains distinct partial schedules. Merging equivalent states
  // avoids exploring all permutations of independent insertions.
  for(let depth = 0;depth < pending.length;depth += 1){
    const next = [];
    const seen = new Set();
    for(const node of frontier){
      for(let i = 0;i < node.pending.length;i += 1){
        if(probes >= maxProbes)break;
        probes += 1;
        budget.remaining -= 1;
        const trial = cloneFastGraphState(node.state);
        const item = {...node.pending[i]};
        const candidate = byIndex.get(item.i);
        // Re-evaluate reservation capacity after each changed placement.
        if(candidate && isMovableWeekCandidate(candidate,trial.dayBase)
          && fastPathDefersMovable(candidate,trial,candidates,
            dayStates.map(day=>day === state ? trial : day)))continue;
        const fit = tryPlaceOnDay(trial,item,{...opts,allowNetwork:false,
          doingNowStart:undefined,urgency:candidate ? candidate.urgency : opts.urgency});
        if(!fit)continue;
        const prior = trial.fills.map(entry=>[entry,entry.fit.placeStart,entry.fit.placeEnd,entry.fit.locId]);
        const proposedClock = [fit.placeStart,fit.placeEnd,fit.locId];
        commitPlacement(trial,item,fit);
        // A feasible edge must not rely on reconciliation pushing a previously
        // checked occurrence beyond its own slot/window or changing its venue.
        if(fit.placeStart !== proposedClock[0] || fit.placeEnd !== proposedClock[1]
          || fit.locId !== proposedClock[2])continue;
        if(prior.some(([entry,start,end,loc])=>entry.fit.placeStart !== start
          || entry.fit.placeEnd !== end || entry.fit.locId !== loc))continue;
        const rest = node.pending.filter((_,index)=>index !== i);
        const key = trial.fills.map(entry=>
          `${entry.fill.i}:${entry.fit.placeStart}:${entry.fit.placeEnd}:${entry.fit.locId || ''}`
        ).sort().join('|');
        if(seen.has(key))continue;
        seen.add(key);
        // ASAP with travel charged in minutes. Existing priority/urgency and
        // preferences still choose each feasible edge's time and location.
        const contextCost = trial.fills.reduce((sum,entry)=>{
          const c = byIndex.get(entry.fill.i);
          const importance = 6 - Math.max(0,Math.min(5,Number(c && c.priority) || 0))
            + Math.max(0,Number(c && c.urgency) || 0) / 100;
          return sum + importance * (entry.fit.placeStart - trial.startClock) / 60000;
        },0);
        const cost = trial.fills.reduce((sum,entry)=>sum
          + (entry.fit.placeEnd - trial.startClock) / 60000,0)
          + dayTravelSecondsFromState(trial) / 60;
        next.push({state:trial,pending:rest,cost,contextCost,key});
      }
    }
    next.sort((a,b)=>a.cost - b.cost || a.contextCost - b.contextCost
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    frontier = next.slice(0,6);
    if(!frontier.length)break;
  }
  for(const node of frontier){
    if(node.pending.length)continue;
    const trial = node.state;
    // Route reconciliation can adjust earlier entries: frozen rows must keep
    // both their original clocks and location before a branch is publishable.
    if(fixed.some(entry=>!trial.fills.some(other=>other.fill.i === entry.fill.i
      && other.fill.chunkIndex === entry.fill.chunkIndex
      && other.fit.placeStart === entry.fit.placeStart
      && other.fit.placeEnd === entry.fit.placeEnd
      && other.fit.locId === entry.fit.locId)))continue;
    if(trial.usedMinutes > trial.totalMinutes + 1e-6)continue;
    if(trial.rows.some(row=>row.kind === 'travel'
      && row.end - row.start + 1 < (Number(row.seconds) || 0) * 1000))continue;
    const incoming = trial.fills.find(entry=>entry.fill.i === fill.i);
    if(!incoming)continue;
    syncDayAgendaItemsFromFills(trial);
    budget.accepted += 1;
    return {fit:incoming.fit,replacement:trial};
  }
  return null;
}

// Week graph: vertices are complete feasible weeks plus a set of day-choice
// decisions. An edge changes one candidate's first day and rebuilds the WHOLE
// week, including cadence, links, reservations, splits and travel. A small beam
// retains neutral/worse intermediate weeks so two decisions can improve jointly.
function improveFastGraphWeek(candidates,states,seeds,settings,options = {}){
  const diagnostics = {evaluated:0,accepted:0,depth:0,budgetExhausted:false};
  if(states.length < 2)return diagnostics;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));
  const linked = new Set();
  for(const state of states)for(const edge of plannerOrderConstraintsForDay(state.dayBase) || []){
    linked.add(edge.beforeHid); linked.add(edge.afterHid);
  }
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const frozenIds = new Set(candidates.filter(c=>c.pinned || linked.has(c.h.hid)
    || (doing && doing.hid === c.h.hid)
    || states.some(state=>typeof weatherLockedPlacement === 'function'
      && weatherLockedPlacement(c,state,settings))).map(c=>c.i));
  const frozen = c=>frozenIds.has(c.i);
  const choices = candidates.filter(c=>isDayChoosingWeekCandidate(c)
    && c.eligible.size > 1 && !frozen(c));
  if(!choices.length)return diagnostics;
  const origin = states[0].dayBase;
  const weights = resolveAgendaScoreWeights(settings);
  const summarize = week=>{
    // Score the same reconciled routes that will be published, including
    // return legs and location-chain optimization.
    for(const state of week)finalizePlacementRows(state);
    const retained = new Map();
    const fixed = [];
    let count = 0, minutes = 0, cost = (weights.travel || 0) * weekTravelSecondsFromStates(week) / 60, context = 0;
    for(const state of week)for(const entry of state.fills){
      const c = byIndex.get(entry.fill.i);
      if(!c)continue;
      const duration = fillDurationMinutes(entry.fill);
      // Daily work is an obligation on that particular date. Sparse work can
      // change date but cannot lose an occurrence/minute already in the plan.
      const daily = c.h.type !== 'task' && (Number(c.h.target) <= 1
        || (typeof rhythmFillsEveryEligibleDay === 'function' && rhythmFillsEveryEligibleDay(c.h)));
      const key = `${c.i}:${daily ? state.dayBase : 'week'}`;
      retained.set(key,(retained.get(key) || 0) + (c.h.breakable ? duration : 1));
      if(frozen(c))fixed.push(`${state.dayBase}:${c.i}:${entry.fit.placeStart}:${entry.fit.placeEnd}:${entry.fit.locId || ''}`);
      if(!c.h.breakable)count += 1;
      minutes += duration;
      // Within-day clock pressure is smaller than a whole-day postponement.
      // Otherwise moving a late-afternoon item to tomorrow morning looks ASAP.
      const delay = (weights.day || 0) * flexAwareDayPenalty(c.h,
        Math.round((state.dayBase-origin)/86400000),c.urgency,c.pinned)
        + (weights.asap || 0) / 8 * (entry.fit.placeEnd-state.startClock)/3600000;
      // Splitting work must not multiply its completion/day cost.
      const portion = c.h.breakable ? duration / Math.max(1,Number(c.h.durationMinutes) || duration) : 1;
      cost += portion * (delay + (typeof weatherPenaltyForFit === 'function'
        ? weatherPenaltyForFit(entry.fill,entry.fit,state,settings) : 0));
      context += portion * (6 - Math.min(5,Math.max(0,c.priority)) + c.urgency/100) * delay
        + (weights.preference || 0) * weekPreferencePenalty(c.h,entry.fit,state,state.registry);
    }
    return {retained,fixed:fixed.sort().join('|'),rank:[-count,-minutes,cost,context]};
  };
  const compare = (a,b)=>{
    for(let i=0;i<a.rank.length;i++)if(Math.abs(a.rank[i]-b.rank[i])>1e-6)return a.rank[i]-b.rank[i];
    return 0;
  };
  const baseline = summarize(states);
  const preserves = summary=>summary.fixed === baseline.fixed
    && [...baseline.retained].every(([key,value])=>(summary.retained.get(key) || 0) >= value-1e-6);
  let best = {states,summary:baseline,decisions:new Map()};
  let frontier = [best];
  const seen = new Set(['']);
  // Fixed work budget: three layers, eight whole-week evaluations per layer.
  // Rebuilds use their own 96-probe day repair budget, independent of the seed.
  const maxEvaluations = Math.max(0,Math.min(24,options.maxEvaluations ?? 24));
  const maxDepth = Math.max(0,Math.min(3,options.maxDepth ?? 3));
  for(let depth=0;depth<maxDepth && diagnostics.evaluated<maxEvaluations;depth++){
    const next = [];
    const branches = frontier.map(node=>{
      const moves = [];
      for(const c of choices){
        if(node.decisions.has(c.i))continue;
        const source = node.states.find(state=>state.fills.some(entry=>entry.fill.i === c.i));
        for(const target of node.states){
          if(!c.eligible.has(target.dayBase) || source === target)continue;
          // Rank promising edges: moving earlier or freeing a crowded day.
          const pressure = source ? source.usedMinutes/Math.max(1,source.totalMinutes) : 1;
          const room = 1-target.usedMinutes/Math.max(1,target.totalMinutes);
          const earlier = source && target.dayBase < source.dayBase ? 1 : 0;
          moves.push({c,target,score:earlier + pressure + room});
        }
      }
      moves.sort((a,b)=>b.score-a.score || a.c.i-b.c.i || a.target.dayBase-b.target.dayBase);
      return {node,moves};
    });
    let layerEvaluations = 0;
    while(layerEvaluations<8 && diagnostics.evaluated<maxEvaluations && branches.some(branch=>branch.moves.length)){
      for(const branch of branches){
        if(layerEvaluations>=8 || diagnostics.evaluated>=maxEvaluations)break;
        const move = branch.moves.shift();
        if(!move)continue;
        const decisions = new Map(branch.node.decisions);
        decisions.set(move.c.i,move.target.dayBase);
        const key = [...decisions].sort((a,b)=>a[0]-b[0]).map(pair=>pair.join(':')).join('|');
        if(seen.has(key))continue;
        seen.add(key);
        layerEvaluations++; diagnostics.evaluated++;
        const trial = seeds.map(cloneFastGraphState);
        const trialCandidates = candidates.map(c=>({...c,eligible:new Set(c.eligible)}));
        assignWeekCandidatesByPlacement(trialCandidates,trial,settings,collectLocationHints(branch.node.states),
          {remaining:96,searches:0,accepted:0},decisions);
        placeAdditionalSameDayOccurrences(trialCandidates,trial,settings);
        const summary = summarize(trial);
        const node = {states:trial,summary,decisions,candidates:trialCandidates};
        // Keep intermediate vertices even if they lose work. Only a complete,
        // improvement-only replacement may be published to the caller.
        next.push(node);
        if(preserves(summary) && compare(summary,best.summary)<0){
          best = node; diagnostics.accepted++;
        }
      }
    }
    if(!next.length)break;
    diagnostics.depth = depth+1;
    next.sort((a,b)=>compare(a.summary,b.summary));
    frontier = next.slice(0,3);
  }
  diagnostics.budgetExhausted = diagnostics.evaluated >= maxEvaluations;
  if(best.states !== states){
    for(let i=0;i<states.length;i++){
      applyPlacementState(states[i],best.states[i]);
      states[i].day.linkOmissions = (best.states[i].day.linkOmissions || []).map(item=>({...item}));
    }
    for(const c of best.candidates)byIndex.get(c.i).unplacedOccurrenceCount = c.unplacedOccurrenceCount;
  }
  return diagnostics;
}
