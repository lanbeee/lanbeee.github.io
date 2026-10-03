// Fast planner: bounded search in a DAG of partial day schedules. A vertex is
// (committed placements, pending occurrences); an edge inserts one occurrence
// through the shared hard-constraint fitter. Different insertion orders reach
// different clocks/routes. Unlike irreversible greedy packing, a blocked edge
// can reopen earlier decisions and retain several alternative paths.
//
// Occurrence/day eligibility remains with the week orchestrator. Search moves
// occurrences within their assigned day only, so it cannot change cadence or
// spend extra delay. Ordinary insertion freezes linked/active/weather-locked
// work and split sessions; the separate bounded repair below treats a linked
// group atomically. No ILP, time grid, network requests or timed search cutoff.
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
        // Weather + travel rank rearrangements; uncapped ASAP is only a
        // tie-break so a wet 9am cannot beat a dry afternoon.
        const contextCost = trial.fills.reduce((sum,entry)=>{
          const c = byIndex.get(entry.fill.i);
          const importance = 6 - Math.max(0,Math.min(5,Number(c && c.priority) || 0))
            + Math.max(0,Number(c && c.urgency) || 0) / 100;
          return sum + importance * (entry.fit.placeStart - trial.startClock) / 60000;
        },0);
        const cost = trial.fills.reduce((sum,entry)=>sum
          + (typeof weatherPenaltyForFit === 'function'
            ? weatherPenaltyForFit(entry.fill,entry.fit,trial,opts.settings) : 0),0)
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

// Recover an overdue sparse occurrence together with its must-do subjects.
// Only this coupled group moves; unrelated clocks and later required partners
// remain intact. All probes share the build's bounded graph budget.
function pullFastLinkedOccurrenceForward(c,earlier,later,candidates,states,settings,budget){
  if(!budget || budget.linkRemaining <= 0)return false;
  const byHid = new Map(candidates.map(item=>[item.h.hid,item]));
  const group = new Map([[c.h.hid,c]]);
  for(const member of group.values()){
    for(const {candidate:subject} of sameDaySubjectsForAnchor(member.h.hid,candidates)){
      if(!subject.eligible || !subject.eligible.has(earlier.dayBase))continue;
      group.set(subject.h.hid,subject);
    }
    if(group.size > 4)return false;
  }
  if(group.size < 2)return false;
  const hids = new Set(group.keys());
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  for(const member of group.values()){
    if(member.h.breakable || member.pinned || !candidateMatchesPinnedDay(member,earlier)
      || !member.eligible.has(earlier.dayBase)
      || (doing && doing.hid === member.h.hid)
      || states.some(state=>weatherLockedPlacement(member,state,settings)))return false;
    // Moving only the first occurrence preserves subsequent cadence spacing.
    if(states.some(state=>state.dayBase < earlier.dayBase
      && state.fills.some(entry=>entry.fill.i === member.i)))return false;
  }
  const laterMembers = later.fills.filter(entry=>hids.has(entry.fill.h.hid));
  // Daily obligations belong to their date; do not transfer one to today.
  if(laterMembers.some(entry=>isIndependentDailyOccurrence(byHid.get(entry.fill.h.hid))))return false;
  const laterEdges = plannerOrderConstraintsForDay(later.dayBase);
  const laterPresent = hid=>later.fills.some(entry=>entry.fill.h.hid === hid)
    || scheduleAnchorCommitForDay(hid,later.dayBase);
  // An OR-linked subject may also be needed by a different partner later.
  // Leave that occurrence intact rather than stealing it for today's pair.
  if(laterEdges.some(edge=>edge.requiresPair && hids.has(edge.subjectHid)
    && !hids.has(edge.anchorHid) && laterPresent(edge.anchorHid)))return false;
  const laterTrial = fastLinkedGroupBase(later,hids);
  if(!laterTrial || persistentLinkViolationsForState(laterTrial).size)return false;
  const earlierTrial = fitFastLinkedGroup(earlier,group,settings,budget);
  if(!earlierTrial)return false;
  applyPlacementState(earlier,earlierTrial);
  earlier.day.linkOmissions=earlierTrial.day.linkOmissions;
  applyPlacementState(later,laterTrial);
  budget.linkAccepted=(budget.linkAccepted || 0)+1;
  return true;
}

function fastLinkedGroupBase(state,hids){
  const trial=cloneFastGraphState(state);
  const keep=trial.fills.filter(entry=>!hids.has(entry.fill.h.hid));
  const clocks=keep.map(entry=>[entry.fill.i,entry.fill.chunkIndex,
    entry.fit.placeStart,entry.fit.placeEnd,entry.fit.locId]);
  trial.rows=trial.rows.filter(row=>row.kind === 'scheduled');
  trial.fills=[];trial.placed=new Set();trial.usedMinutes=0;
  trial.remaining=trial.totalMinutes;trial.prevLocId=trial.seedLocId;
  for(const entry of keep)commitPlacement(trial,entry.fill,entry.fit);
  if(!clocks.every(([i,chunk,start,end,loc])=>trial.fills.some(entry=>entry.fill.i===i
    && entry.fill.chunkIndex===chunk && entry.fit.placeStart===start
    && entry.fit.placeEnd===end && entry.fit.locId===loc)))return null;
  syncDayAgendaItemsFromFills(trial);
  return trial;
}

function fitFastLinkedGroup(state,group,settings,budget,leading = []){
  const hids=new Set(group.keys());
  // This neighborhood handles one ordinary occurrence per item/date. Keep
  // separate-option repetitions and split/active sessions with their existing
  // occurrence-aware packing, rather than collapsing them to one row.
  if([...group.values()].some(c=>normalizeHabitScheduleOptions(c.h.scheduleOptions)
    .some(option=>habitScheduleOptionSameDayMode(option)==='separate')
    || state.fills.filter(entry=>entry.fill.i===c.i).length>1))return null;
  const base=fastLinkedGroupBase(state,hids);
  if(!base)return null;
  const frozen = base.fills.map(entry=>[entry.fill.i,entry.fill.chunkIndex,
    entry.fit.placeStart,entry.fit.placeEnd,entry.fit.locId]);
  const keepsClocks = trial=>frozen.every(([i,chunk,start,end,loc])=>trial.fills.some(entry=>
    entry.fill.i===i && entry.fill.chunkIndex===chunk && entry.fit.placeStart===start
      && entry.fit.placeEnd===end && entry.fit.locId===loc));
  const ordered = reorderAgendaItemsByOrderConstraints(
    [...group.values()].sort((a,b)=>Number(leading.includes(b.i))-Number(leading.includes(a.i))
      || compareScarcityThenPriority(a,b)),state.dayBase);
  // Keep a direct successor ahead of loose successors released by the same
  // predecessor (A -> B -> optional C, with B sometime before D).
  for(const edge of plannerOrderConstraintsForDay(state.dayBase)){
    if(edge.adjacency!=='direct')continue;
    const before=ordered.findIndex(c=>c.h.hid===edge.beforeHid);
    const after=ordered.findIndex(c=>c.h.hid===edge.afterHid);
    if(before<0 || after<=before+1)continue;
    const proposed=ordered.slice();
    proposed.splice(before+1,0,proposed.splice(after,1)[0]);
    const index=new Map(proposed.map((c,i)=>[c.h.hid,i]));
    if(plannerOrderConstraintsForDay(state.dayBase).every(e=>!index.has(e.beforeHid)
      || !index.has(e.afterHid) || index.get(e.beforeHid)<index.get(e.afterHid))){
      ordered.splice(0,ordered.length,...proposed);
    }
  }
  // These neighbors have no links; claim their narrow windows before the
  // flexible chain so its travel cannot strand a previously accepted row.
  ordered.sort((a,b)=>Number(leading.includes(b.i))-Number(leading.includes(a.i)));
  let frontier=[{state:base,cost:0}];
  for(const member of ordered){
    const next=[];
    for(const node of frontier){
      const seen=new Set();
      // Gap boundaries plus the normal scored choice retain minute precision.
      // Earliest probes keep hard weather checks but can override soft time
      // preferences when those preferences would strand the required partner.
      const probes=[null,...remainingPlacementGaps(node.state).slice(0,4)];
      for(const gap of probes){
        if(budget.linkRemaining <= 0)break;
        budget.linkRemaining--;
        const trial=cloneFastGraphState(node.state);
        const fill={h:member.h,i:member.i,priority:member.priority,scarcity:member.scarcity};
        const slots=trial.slots;
        if(gap)trial.slots=slots.map(slot=>({...slot,start:Math.max(slot.start,gap.start),
          end:Math.min(slot.end,gap.end)})).filter(slot=>slot.end>slot.start);
        const fit=tryPlaceOnDay(trial,fill,{settings,allowNetwork:false,earliestFromAnchor:Boolean(gap)});
        trial.slots=slots;
        if(!fit)continue;
        const key=`${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
        if(seen.has(key))continue;
        seen.add(key);
        const clock=[fit.placeStart,fit.placeEnd,fit.locId];
        commitPlacement(trial,fill,fit);
        if(!keepsClocks(trial) || trial.usedMinutes>trial.totalMinutes+1e-6
          || fit.placeStart!==clock[0] || fit.placeEnd!==clock[1] || fit.locId!==clock[2])continue;
        const weather=weatherPenaltyForFit(fill,fit,trial,settings) || 0;
        const preference=weekPreferencePenalty(member.h,fit,trial,trial.registry);
        next.push({state:trial,cost:node.cost+weather+preference+(fit.placeStart-trial.startClock)/60000});
      }
    }
    next.sort((a,b)=>a.cost-b.cost);
    frontier=next.slice(0,2);
    if(!frontier.length)return null;
  }
  const accepted=frontier.find(node=>!persistentLinkViolationsForState(node.state).size);
  if(!accepted)return null;
  syncDayAgendaItemsFromFills(accepted.state);
  accepted.state.day.linkOmissions=(state.day.linkOmissions || []).filter(item=>!hids.has(item.subjectHid));
  return accepted.state;
}

// Before invariant cleanup removes a broken subject, try its small connected
// group atomically. Existing partners stay selected; absent OR anchors are not
// made mandatory. Fixed/active/planned/weather-locked endpoints stay frozen.
function repairFastLinkedGroups(states,candidates,settings,budget){
  if(!budget || budget.linkRemaining<=0)return;
  const byHid=new Map(candidates.map(c=>[c.h.hid,c]));
  const doing=typeof getDoingNow==='function' ? getDoingNow() : null;
  for(const state of states){
    const violations=persistentLinkViolationsForState(state);
    if(!violations.size)continue;
    const edges=plannerOrderConstraintsForDay(state.dayBase);
    const present=new Set(state.fills.map(entry=>entry.fill.h.hid));
    for(const hid of violations.keys()){
      if(budget.linkRemaining<=0)return;
      const root=byHid.get(hid);
      if(!root || !root.eligible.has(state.dayBase))continue;
      const group=new Map([[hid,root]]);
      for(const member of group.values()){
        for(const edge of edges){
          const other=edge.beforeHid===member.h.hid ? edge.afterHid
            : edge.afterHid===member.h.hid ? edge.beforeHid : null;
          if(other && present.has(other) && byHid.has(other))group.set(other,byHid.get(other));
        }
        if(group.size>4)break;
      }
      if(group.size<2 || group.size>4)continue;
      if([...group.values()].some(c=>c.h.breakable || c.pinned || !c.eligible.has(state.dayBase)
        || (doing && doing.hid===c.h.hid) || weatherLockedPlacement(c,state,settings)))continue;
      let trial=fitFastLinkedGroup(state,group,settings,budget);
      if(!trial && budget.linkRemaining>0){
        // A narrow unlinked meal/work session can occupy the chain's only
        // usable interval. Reopen at most two such neighbors, retaining both.
        const linked=new Set(edges.flatMap(e=>[e.beforeHid,e.afterHid]));
        const blockers=state.fills.filter(entry=>{
          const c=byHid.get(entry.fill.h.hid);
          return c && !linked.has(c.h.hid) && !c.h.breakable && !c.pinned
            && !mustPlaceCriticalOccurrence(c) && !(doing && doing.hid===c.h.hid)
            && !weatherLockedPlacement(c,state,settings);
        }).sort((a,b)=>a.fit.placeStart-b.fit.placeStart).slice(0,2);
        for(const entry of blockers)group.set(entry.fill.h.hid,byHid.get(entry.fill.h.hid));
        if(blockers.length)trial=fitFastLinkedGroup(state,group,settings,budget,blockers.map(entry=>entry.fill.i));
      }
      if(!trial)continue;
      applyPlacementState(state,trial);state.day.linkOmissions=trial.day.linkOmissions;
      budget.linkAccepted=(budget.linkAccepted || 0)+1;
    }
  }
}

// Insert an unplaced day-choice without rebuilding the week from scratch.
// Direct/graph insertion first; if the day is full, eject one movable to
// another eligible day so the new item can claim the gap.
function insertUnplacedFastGraphChoices(unplaced,candidates,states,settings,frozen,budget){
  let accepted = 0;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));
  const placed = (idx)=>states.some(state=>(state.fills || [])
    .some(entry=>entry && entry.fill && entry.fill.i === idx));
  for(const c of unplaced){
    if(!c || placed(c.i))continue;
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    for(const state of states){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(typeof weatherShouldDeferCandidate === 'function'
        && weatherShouldDeferCandidate(c,state,settings,states))continue;
      if(typeof clusterFlexPartnerPlacedForDay === 'function'
        && !clusterFlexPartnerPlacedForDay(c,state))continue;
      const proposal = fastGraphPlacement(state,fill,{settings,allowNetwork:true},
        candidates,states,budget);
      if(!proposal)continue;
      if(proposal.replacement)applyPlacementState(state,proposal.replacement);
      else commitPlacement(state,fill,proposal.fit);
      state.day.agendaItems.push({
        h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:proposal.fit.locId
      });
      accepted += 1;
      break;
    }
    if(placed(c.i) || typeof rebuildDayFromFills !== 'function')continue;
    let parked = false;
    for(const state of states){
      if(parked)break;
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      const victims = (state.fills || []).filter(entry=>{
        const vc = byIndex.get(entry && entry.fill && entry.fill.i);
        return vc && !frozen(vc) && typeof isMovableWeekCandidate === 'function'
          && isMovableWeekCandidate(vc,state.dayBase);
      }).slice(0,4);
      for(const victim of victims){
        const vc = byIndex.get(victim.fill.i);
        if(!vc)continue;
        const keep = (state.fills || []).filter(entry=>entry !== victim).map(entry=>({
          h:entry.fill.h,i:entry.fill.i,priority:entry.fill.priority,scarcity:entry.fill.scarcity
        }));
        const rebuilt = rebuildDayFromFills(state,keep,candidates,{settings,allowNetwork:true});
        if(!rebuilt)continue;
        const uFit = tryPlaceOnDay(rebuilt,fill,{settings,allowNetwork:true});
        if(!uFit)continue;
        commitPlacement(rebuilt,fill,uFit);
        const vFill = {h:vc.h,i:vc.i,priority:vc.priority,scarcity:vc.scarcity};
        for(const other of states){
          if(other === state)continue;
          if(vc.eligible && !vc.eligible.has(other.dayBase))continue;
          if(other.placed && other.placed.has(vc.i))continue;
          const vFit = tryPlaceOnDay(other,vFill,{settings,allowNetwork:true});
          if(!vFit)continue;
          applyPlacementState(state,rebuilt);
          if(typeof syncDayAgendaItemsFromFills === 'function')syncDayAgendaItemsFromFills(state);
          commitPlacement(other,vFill,vFit);
          other.day.agendaItems.push({
            h:vc.h,i:vc.i,priority:vc.priority,scarcity:vc.scarcity,locationId:vFit.locId
          });
          accepted += 1;
          parked = true;
          break;
        }
        if(parked)break;
      }
    }
  }
  return accepted;
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
  // Whole-week rebuilds are for recovering an unplaced day-choice, not for
  // retiming work that already has a feasible home. On a full backup the 24
  // rebuilds cost ~2s and accept nothing once venues are enumerated.
  const placedIds = new Set();
  for(const state of states){
    for(const entry of state.fills || []){
      if(entry && entry.fill && entry.fill.i != null)placedIds.add(entry.fill.i);
    }
  }
  const unplacedPinned = candidates.filter(c=>c && c.pinned && !placedIds.has(c.i));
  const unplacedChoices = choices.filter(c=>!placedIds.has(c.i));
  if(!unplacedChoices.length && !unplacedPinned.length)return diagnostics;
  // Residual whole-week rebuilds only run when a cheap insert/eject left a
  // day-choice unplaced. Eight evaluations keep a large week under a second.
  const maxEvaluations = Math.max(0,Math.min(8,options.maxEvaluations ?? 8));
  if(maxEvaluations <= 0)return diagnostics;
  const insertBudget = {remaining:192,searches:0,accepted:0};
  diagnostics.accepted += insertUnplacedFastGraphChoices(
    unplacedPinned.concat(unplacedChoices),candidates,states,settings,frozen,insertBudget);
  const stillUnplaced = unplacedChoices.filter(c=>
    !states.some(state=>(state.fills || []).some(entry=>entry && entry.fill && entry.fill.i === c.i)));
  if(!stillUnplaced.length)return diagnostics;
  // Full-week rebuilds recover tight crafted puzzles. On a real-sized week they
  // replay the whole horizon and still miss infeasible leftovers; skip them.
  if(candidates.length > 16)return diagnostics;
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
        Math.round((state.dayBase-origin)/86400000),c.urgency,c.pinned,c.pinnedDay,state.dayBase)
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
          {remaining:48,searches:0,accepted:0},decisions);
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

// Selection repair for a congested day's independent daily occurrences.
// Unlike keep-all insertion, partial paths may choose a different subset. Day
// choices, fractional/sparse cadence, split pools and linked groups stay with
// their existing orchestrators. No full-week rebuild or coarse clock rounding.
function improveFastGraphDaySelections(candidates,states,settings,options = {}){
  const maxProbes = Math.max(0,Math.min(1024,options.maxProbes == null ? 768 : options.maxProbes));
  const diagnostics = {probes:0,accepted:0,budgetExhausted:false};
  if(!maxProbes)return diagnostics;
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));
  const quality = state=>{
    const priority = Array(6).fill(0);
    let weather = 0;
    for(const entry of state.fills){
      const c = byIndex.get(entry.fill.i);
      priority[c ? c.priority : effectivePriority(entry.fill.h)] += entry.fit.durMin;
      weather += typeof weatherPenaltyForFit === 'function'
        ? weatherPenaltyForFit(entry.fill,entry.fit,state,settings) || 0 : 0;
    }
    for(let i=1;i<6;i++)priority[i] += priority[i-1];
    return {priority,weather,travel:dayRouteCostSeconds(state)};
  };
  const compare = (a,b)=>{
    for(let i=0;i<6;i++)if(a.priority[i] !== b.priority[i])return b.priority[i]-a.priority[i];
    return a.weather-b.weather || a.travel-b.travel;
  };
  for(const state of states){
    if(diagnostics.probes >= maxProbes)break;
    const linked = new Set();
    for(const edge of plannerOrderConstraintsForDay(state.dayBase) || []){
      linked.add(edge.beforeHid);linked.add(edge.afterHid);
    }
    const independent = c=>c && c.h && !c.h.breakable && c.h.type !== 'task'
      && Number(c.h.target) === 1 && !linked.has(c.h.hid)
      && !(doing && doing.hid === c.h.hid) && !c.pinned
      && !fillIsPlannedOnDay(c.h,state.dayBase,settings)
      && !(typeof weatherLockedPlacement === 'function' && weatherLockedPlacement(c,state,settings));
    const present = new Set(state.fills.map(entry=>entry.fill.i));
    const missing = candidates.filter(c=>independent(c) && !present.has(c.i)
      && c.eligible.has(state.dayBase) && candidateMatchesPinnedDay(c,state));
    if(!missing.length)continue;
    const optional = state.fills.filter(entry=>{
      const c = byIndex.get(entry.fill.i);
      return independent(c) && !mustPlaceCriticalOccurrence(c);
    });
    if(!optional.length)continue;
    // Reopen the blockers closest to the missing windows; the rest retain
    // exact clocks. The candidate cap is per neighborhood, not per whole week.
    const missingWindows = missing.flatMap(c=>fillDayWindows(c.h,state.dayBase,state.seedLocId) || []);
    const distance = entry=>missingWindows.length ? Math.min(...missingWindows.map(w=>
      Math.max(0,w.start-entry.fit.placeEnd,entry.fit.placeStart-w.end))) : 0;
    optional.sort((a,b)=>distance(a)-distance(b) || a.fill.i-b.fill.i);
    const moving = optional.slice(0,8);
    const movingIds = new Set(moving.map(entry=>entry.fill.i));
    const fixed = state.fills.filter(entry=>!movingIds.has(entry.fill.i));
    const pool = moving.map(entry=>byIndex.get(entry.fill.i)).concat(missing.slice(0,4));
    const base = cloneFastGraphState(state);
    base.rows = base.rows.filter(row=>row.kind === 'scheduled');
    base.fills = [];base.placed = new Set();base.remaining = state.totalMinutes;
    base.usedMinutes = 0;base.prevLocId = state.seedLocId;base.day.agendaItems = [];
    for(const entry of fixed)commitPlacement(base,{...entry.fill},{...entry.fit});
    const frozenClocksFit = trial=>fixed.every(entry=>trial.fills.some(other=>
      other.fill.i === entry.fill.i && other.fill.chunkIndex === entry.fill.chunkIndex
      && other.fit.placeStart === entry.fit.placeStart && other.fit.placeEnd === entry.fit.placeEnd
      && other.fit.locId === entry.fit.locId));
    if(!frozenClocksFit(base))continue;
    const before = quality(state);
    let best = null;
    let frontier = [{state:base,pending:pool,quality:quality(base),key:''}];
    const dayLimit = Math.min(maxProbes,diagnostics.probes+384);
    for(let depth=0;depth<pool.length && diagnostics.probes<dayLimit;depth++){
      const next = [],seen = new Set();
      for(const node of frontier){
        for(const c of node.pending){
          if(diagnostics.probes >= dayLimit)break;
          diagnostics.probes++;
          const trial = cloneFastGraphState(node.state);
          const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
          const fit = tryPlaceOnDay(trial,fill,{settings,allowNetwork:false});
          if(!fit)continue;
          const clocks = trial.fills.map(entry=>[entry,entry.fit.placeStart,entry.fit.placeEnd,entry.fit.locId]);
          const proposed = [fit.placeStart,fit.placeEnd,fit.locId];
          commitPlacement(trial,fill,fit);
          if(fit.placeStart !== proposed[0] || fit.placeEnd !== proposed[1] || fit.locId !== proposed[2])continue;
          if(clocks.some(([entry,start,end,loc])=>entry.fit.placeStart!==start
            || entry.fit.placeEnd!==end || entry.fit.locId!==loc))continue;
          if(!frozenClocksFit(trial) || trial.usedMinutes>trial.totalMinutes+1e-6)continue;
          const key = trial.fills.map(entry=>`${entry.fill.i}:${entry.fit.placeStart}:${entry.fit.locId || ''}`).sort().join('|');
          if(seen.has(key))continue;
          seen.add(key);
          const score = quality(trial);
          // Every priority prefix is preserved; extra low-priority minutes
          // cannot purchase a lost urgent occurrence or worse travel/weather.
          if(score.priority[5]>before.priority[5]+1e-6
            && score.priority.every((minutes,i)=>minutes>=before.priority[i]-1e-6)
            && score.weather<=before.weather+1e-6 && score.travel<=before.travel+1e-6
            && (!best || compare(score,best.quality)<0))best = {state:trial,quality:score};
          next.push({state:trial,pending:node.pending.filter(other=>other!==c),quality:score,key});
        }
      }
      next.sort((a,b)=>compare(a.quality,b.quality) || (a.key<b.key?-1:a.key>b.key?1:0));
      frontier = next.slice(0,8);
      if(!frontier.length)break;
    }
    if(best){
      syncDayAgendaItemsFromFills(best.state);
      applyPlacementState(state,best.state);
      diagnostics.accepted++;
    }
  }
  diagnostics.budgetExhausted = diagnostics.probes>=maxProbes;
  return diagnostics;
}
