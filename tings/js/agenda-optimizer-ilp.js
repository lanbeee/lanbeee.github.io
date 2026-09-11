
function optimizerWeight(c){
  const score = Number(c && c.scarcity);
  let scarceBonus = 0;
  if(typeof isScarceScore === 'function' && isScarceScore(score)){
    const softWindow = score >= 500000;
    const local = softWindow ? score - 500000 : score;
    const feasibleSlots = Math.max(0,Math.floor(local / 10000));
    const slackMinutes = Math.max(0,local % 10000);
    const tightness = Math.max(0,60 - Math.min(60,slackMinutes / 3));
    scarceBonus = (softWindow ? 30 : 100) + tightness - Math.min(30,feasibleSlots * 5);
  }
  const pri = c.priority != null ? c.priority : 2;
  const pinnedBonus = c && c.pinned === true ? 200 : 0;
  const urgencyBonus = Math.min(50,Math.max(0,Number(c && c.urgency) || 0) / 4);
  // P0 is the user's critical lane. Protect an occurrence that either exists
  // on only one horizon day (Friday-only Juma) or is independently due every
  // day (prayers) from being traded for several flexible lower-priority fills.
  // The bonus is selection-only; hard feasibility, travel and ordering still
  // decide where it can go.
  const criticalOccurrenceBonus = typeof mustPlaceCriticalOccurrence === 'function'
    && mustPlaceCriticalOccurrence(c)
    ? 1200 : 0;
  // Delay tie-break (caps at 5): among otherwise-equal candidates the one with
  // less permission to run late wins. The early window is intentionally absent
  // here; allowing early work cannot make it easier to postpone.
  const delay = typeof habitDelayAllowanceDays === 'function'
    ? habitDelayAllowanceDays(c && c.h) : 0;
  const delayTiebreak = Math.min(5,delay * 0.5);
  // Hard-window tightness outranks ordinary priority; pinned and urgent items
  // still receive explicit value rather than depending on source array order.
  return 100 + pinnedBonus + criticalOccurrenceBonus + scarceBonus
    + (5 - Math.min(5,Math.max(0,pri))) * 5
    + urgencyBonus
    - delayTiebreak;
}

// Soft boost so temporary day-order / doing-now still matter in the ILP objective.
const ORDER_BEFORE_WEIGHT_BONUS = 35;
const DOING_NOW_WEIGHT_BONUS = 220;
const DIRECT_ORDER_GAP_PENALTY = 0.4; // per minute of gap after predecessor end

function doingNowForDay(state){
  if(!state || typeof getDoingNow !== 'function')return null;
  const doing = getDoingNow();
  if(!doing || !doing.hid)return null;
  if(doing.dayBase !== state.dayBase)return null;
  if(typeof isDoingNowActive === 'function' && !isDoingNowActive(doing))return null;
  return doing;
}

function orderBoostForCandidate(c,dayBase){
  if(!c || !c.h || !c.h.hid || typeof plannerOrderConstraintsForDay !== 'function')return 0;
  let boost = 0;
  for(const e of plannerOrderConstraintsForDay(dayBase)){
    if(e.beforeHid === c.h.hid)boost += e.adjacency === 'direct' ? ORDER_BEFORE_WEIGHT_BONUS * 1.5 : ORDER_BEFORE_WEIGHT_BONUS;
    if(e.afterHid === c.h.hid)boost -= 8; // slight nudge so successors yield early slots
  }
  return boost;
}

function applyEarlyBeforeWeights(opts,state){
  if(!opts || !opts.length || !state || typeof plannerOrderConstraintsForDay !== 'function')return;
  const edges = plannerOrderConstraintsForDay(state.dayBase);
  // Skip early-ASAP boost when this hid is a direct predecessor of a timed /
  // scarce successor — those should pack late against the partner instead.
  const packLate = new Set();
  const byHid = new Map(opts.filter(o=>o && o.fill && o.fill.h).map(o=>[o.fill.h.hid,o]));
  for(const e of edges){
    if(!e || e.adjacency !== 'direct' || !e.beforeHid)continue;
    const afterOpt = byHid.get(e.afterHid);
    const afterH = afterOpt && afterOpt.fill && afterOpt.fill.h;
    const scarceAfter = afterH && (
      (typeof hasTimeWindow === 'function' && hasTimeWindow(afterH))
      || (typeof hasDaySchedule === 'function' && hasDaySchedule(afterH))
    );
    if(scarceAfter)packLate.add(e.beforeHid);
  }
  const beforeHids = new Set(edges.map(e=>e.beforeHid).filter(Boolean));
  if(!beforeHids.size)return;
  const origin = state.startClock || state.dayBase;
  for(const o of opts){
    const hid = o && o.fill && o.fill.h && o.fill.h.hid;
    if(!hid || !beforeHids.has(hid) || !o.fit)continue;
    if(packLate.has(hid))continue;
    const delayMin = Math.max(0,(o.fit.placeStart - origin) / 60000);
    o.weight += Math.max(0,48 - Math.min(48,delayMin));
  }
}

function applyDoingNowWeight(o,doing){
  if(!doing || !o || !o.fill || !o.fill.h || o.fill.h.hid !== doing.hid || !o.fit)return;
  const delayMin = Math.max(0,(o.fit.placeStart - doing.startedAt) / 60000);
  o.weight += DOING_NOW_WEIGHT_BONUS - Math.min(DOING_NOW_WEIGHT_BONUS,delayMin);
}

function priorPlacementsForDay(prior,dayBase){
  if(!Array.isArray(prior) || !prior.length)return [];
  const hasDay = prior.some(p=>p && Number.isFinite(Number(p.dayBase)));
  if(!hasDay || !Number.isFinite(Number(dayBase)))return prior.filter(Boolean);
  return prior.filter(p=>p && Number(p.dayBase) === Number(dayBase));
}

function matchPriorPlacement(c,prior){
  if(!c || !Array.isArray(prior) || !prior.length)return null;
  for(let i = 0;i < prior.length;i += 1){
    const p = prior[i];
    if(!p)continue;
    if(Number.isFinite(Number(p.i)) && p.i === c.i)return p;
  }
  const hid = c.h && c.h.hid;
  if(!hid)return null;
  for(let i = 0;i < prior.length;i += 1){
    const p = prior[i];
    if(p && p.hid === hid)return p;
  }
  return null;
}

// Soft MIP-start: prefer the previous plan's clock/location when it is still a
// feasible option. Bonus is small so route polish can still merge extra trips.
// Never large enough to drop an item (candidate baseWeight stays dominant).
function applyPriorPlacementWeights(opts,prior,dayBase){
  if(!opts || !opts.length)return;
  const dayPrior = priorPlacementsForDay(prior,dayBase);
  if(!dayPrior.length)return;
  const PRIOR_SLOT_BONUS = 6;
  for(const o of opts){
    if(!o || !o.fit || !o.c)continue;
    const p = matchPriorPlacement(o.c,dayPrior);
    if(!p || !Number.isFinite(Number(p.start)))continue;
    if(p.locId && o.fit.locId && p.locId !== o.fit.locId)continue;
    const delayMin = Math.abs((Number(o.fit.placeStart) || 0) - Number(p.start)) / 60000;
    if(delayMin > 20)continue;
    o.weight += PRIOR_SLOT_BONUS * (1 - delayMin / 20);
  }
}

function restorePriorPlacementOptions(opts,allOptions,prior,dayBase){
  if(!opts || !allOptions || !allOptions.length)return opts;
  const dayPrior = priorPlacementsForDay(prior,dayBase);
  if(!dayPrior.length)return opts;
  const kept = new Set(opts);
  for(const p of dayPrior){
    let best = null;
    let bestAbs = Infinity;
    for(const o of allOptions){
      if(!o || !o.fit || !o.c)continue;
      const hid = o.fill && o.fill.h && o.fill.h.hid;
      if(o.c.i !== p.i && !(p.hid && hid === p.hid))continue;
      if(p.locId && o.fit.locId && p.locId !== o.fit.locId)continue;
      const d = Math.abs((Number(o.fit.placeStart) || 0) - Number(p.start));
      if(d < bestAbs){
        bestAbs = d;
        best = o;
      }
    }
    if(best && bestAbs <= 2 * 60000 && !kept.has(best)){
      opts.push(best);
      kept.add(best);
    }
  }
  return opts;
}

function agendaPriorPlacementsFromTimeline(timeline,dayBase){
  if(!Array.isArray(timeline))return [];
  const base = Number.isFinite(Number(dayBase)) ? Number(dayBase) : null;
  return timeline.filter(row=>row && row.kind === 'fill' && row.i != null).map(row=>{
    const item = {
      i:row.i,
      hid:row.h && row.h.hid || '',
      start:Number(row.start) || 0,
      end:Number(row.end) || 0,
      locId:row.locationId || null
    };
    if(base != null)item.dayBase = base;
    return item;
  });
}

function agendaPriorPlacementsFromWeek(week){
  if(!week || !Array.isArray(week.days))return [];
  const out = [];
  for(const day of week.days){
    if(!day)continue;
    const rows = agendaPriorPlacementsFromTimeline(day.timeline,day.dayBase);
    for(let i = 0;i < rows.length;i += 1)out.push(rows[i]);
  }
  return out;
}

function memoDaysFromWeek(week){
  if(!week || !Array.isArray(week.days))return [];
  const strip = item=>{
    if(!item || typeof item !== 'object')return item;
    const out = {...item};
    delete out.h;
    return out;
  };
  return week.days.map(day=>({
    dayBase:Number(day && day.dayBase) || 0,
    usedMinutes:day && day.usedMinutes,
    remainingMinutes:day && day.remainingMinutes,
    travelSeconds:(day && day.travelSeconds) || 0,
    timeline:Array.isArray(day && day.timeline)
      ? day.timeline.map(row=>{
        return strip(row);
      })
      : [],
    agendaItems:Array.isArray(day && day.agendaItems)
      ? day.agendaItems.map(strip) : []
  }));
}

// Replay the last day's non-breakable fills onto a clone. Returns chosen
// options when that packing is still feasible; otherwise null so GLPK runs.
function replayPriorFixedChoices(state,dayCandidates,priorPlacements,deferrable){
  if(!state || typeof tryPlaceOnDay !== 'function' || typeof commitPlacement !== 'function')return null;
  if(!Array.isArray(dayCandidates) || !dayCandidates.length)return null;
  if(typeof doingNowForDay === 'function' && doingNowForDay(state))return null;
  const dayPrior = priorPlacementsForDay(priorPlacements,state.dayBase);
  if(!dayPrior.length)return null;
  const candByI = new Map();
  const candByHid = new Map();
  for(const c of dayCandidates){
    if(!c || (c.h && c.h.breakable))continue;
    candByI.set(c.i,c);
    if(c.h && c.h.hid)candByHid.set(c.h.hid,c);
  }
  const startClock = Number(state.startClock) || 0;
  const remaining = dayPrior.filter(p=>{
    const end = Number(p.end) || Number(p.start) || 0;
    return end > startClock;
  }).sort((a,b)=>(Number(a.start) || 0) - (Number(b.start) || 0));
  if(!remaining.length)return null;
  // A still-due non-breakable whose last slot has already ended is unfinished
  // work, not a successful replay. Skipping it as "day-choosing" would drop it
  // from today while frozen far days never receive it.
  for(const p of dayPrior){
    const end = Number(p.end) || Number(p.start) || 0;
    if(end > startClock)continue;
    const c = candByI.has(p.i) ? candByI.get(p.i) : (p.hid ? candByHid.get(p.hid) : null);
    if(!c || (c.h && c.h.breakable))continue;
    return null;
  }
  const clone = typeof clonePlacementState === 'function'
    ? clonePlacementState(state)
    : null;
  if(!clone)return null;
  const chosen = [];
  const placed = new Set();
  for(const p of remaining){
    const c = candByI.has(p.i) ? candByI.get(p.i) : (p.hid ? candByHid.get(p.hid) : null);
    if(!c)continue;
    if(placed.has(c.i) || clone.placed.has(c.i)){
      placed.add(c.i);
      continue;
    }
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    if(p.locId)fill.locationId = p.locId;
    const probe = clonePlacementState(clone);
    probe.startClock = Math.max(Number(clone.startClock) || 0,Number(p.start) || 0);
    const fit = tryPlaceOnDay(probe,fill,{allowNetwork:false});
    if(!fit)return null;
    const priorStart = Number(p.start) || 0;
    if(priorStart >= startClock + 60000){
      if(Math.abs((Number(fit.placeStart) || 0) - priorStart) > 2 * 60000)return null;
      if(p.locId && fit.locId && p.locId !== fit.locId)return null;
    }
    commitPlacement(clone,fill,fit);
    chosen.push({fill,fit});
    placed.add(c.i);
  }
  if(!chosen.length)return null;
  for(const c of dayCandidates){
    if(!c || (c.h && c.h.breakable))continue;
    if(placed.has(c.i))continue;
    if(deferrable && deferrable.has(c.i))continue;
    const stillDue = remaining.some(p=>p.i === c.i || (p.hid && c.h && p.hid === c.h.hid));
    if(stillDue)return null;
    if(c.pinned)return null;
    if(typeof mustPlaceCriticalOccurrence === 'function' && mustPlaceCriticalOccurrence(c))return null;
    if(typeof isDayChoosingWeekCandidate === 'function' && isDayChoosingWeekCandidate(c))continue;
    return null;
  }
  chosen.solveStatus = 'reused';
  chosen.solveDiagnostics = {
    selectionStatus:'reused',
    routePolishStatus:'not-needed',
    reusedCount:chosen.length,
    candidateCount:dayCandidates.length
  };
  return chosen;
}

function applyDirectOrderGapWeights(opts,dayBase){
  if(!opts || !opts.length || typeof plannerOrderConstraintsForDay !== 'function')return;
  const edges = plannerOrderConstraintsForDay(dayBase).filter(e=>e.adjacency === 'direct');
  if(!edges.length)return;
  const byHid = new Map();
  for(const o of opts){
    const hid = o && o.fill && o.fill.h && o.fill.h.hid;
    if(!hid)continue;
    if(!byHid.has(hid))byHid.set(hid,[]);
    byHid.get(hid).push(o);
  }
  for(const e of edges){
    const befores = byHid.get(e.beforeHid) || [];
    const afters = byHid.get(e.afterHid) || [];
    if(!befores.length || !afters.length)continue;
    for(const b of afters){
      let bestGap = Infinity;
      for(const a of befores){
        if(b.fit.placeStart + 60000 < a.fit.placeEnd)continue;
        bestGap = Math.min(bestGap,(b.fit.placeStart - a.fit.placeEnd) / 60000);
      }
      if(bestGap < Infinity)b.weight -= Math.min(480,bestGap) * DIRECT_ORDER_GAP_PENALTY;
    }
    // Pack flexible predecessors against scarce successors (Shower just before Juma).
    for(const a of befores){
      let bestGap = Infinity;
      for(const b of afters){
        if(b.fit.placeStart + 60000 < a.fit.placeEnd)continue;
        bestGap = Math.min(bestGap,(b.fit.placeStart - a.fit.placeEnd) / 60000);
      }
      if(bestGap < Infinity)a.weight -= Math.min(480,bestGap) * DIRECT_ORDER_GAP_PENALTY * 1.5;
    }
  }
}

// A breakable predecessor is committed before the fixed-duration GLPK pass.
// Reward successor options that begin close to its final chunk; pairwise GLPK
// rows cannot express this because the predecessor is no longer a solver var.
function applyPlacedOrderWeights(opts,state){
  if(!opts || !opts.length || !state || typeof plannerOrderConstraintsForDay !== 'function')return;
  const placedEnd = new Map();
  const placedStart = new Map();
  for(const entry of state.fills || []){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(!hid || !entry.fit)continue;
    placedEnd.set(hid,Math.max(placedEnd.get(hid) || 0,Number(entry.fit.placeEnd) || 0));
    const start = Number(entry.fit.placeStart) || 0;
    placedStart.set(hid,placedStart.has(hid) ? Math.min(placedStart.get(hid),start) : start);
  }
  if(!placedEnd.size && !placedStart.size)return;
  for(const edge of plannerOrderConstraintsForDay(state.dayBase)){
    if(edge.adjacency !== 'direct')continue;
    if(placedEnd.has(edge.beforeHid)){
      const end = placedEnd.get(edge.beforeHid);
      for(const o of opts){
        const hid = o && o.fill && o.fill.h && o.fill.h.hid;
        if(hid !== edge.afterHid || !o.fit)continue;
        const gapMin = Math.max(0,(o.fit.placeStart - end) / 60000);
        o.weight -= Math.min(480,gapMin) * DIRECT_ORDER_GAP_PENALTY;
      }
    }
    if(placedStart.has(edge.afterHid)){
      const start = placedStart.get(edge.afterHid);
      for(const o of opts){
        const hid = o && o.fill && o.fill.h && o.fill.h.hid;
        if(hid !== edge.beforeHid || !o.fit)continue;
        if(o.fit.placeEnd > start + 60000){
          o.weight -= 80;
          continue;
        }
        const gapMin = Math.max(0,(start - o.fit.placeEnd) / 60000);
        o.weight -= Math.min(480,gapMin) * DIRECT_ORDER_GAP_PENALTY * 1.5;
      }
    }
  }
}

function appendOrderConstraintRows(GLPK,subjectTo,opts,dayBase,state = null){
  if(!opts || !opts.length || typeof plannerOrderConstraintsForDay !== 'function')return;
  const edges = plannerOrderConstraintsForDay(dayBase);
  if(!edges.length)return;
  const byHid = new Map();
  opts.forEach((o,idx)=>{
    const hid = o && o.fill && o.fill.h && o.fill.h.hid;
    if(!hid)return;
    if(!byHid.has(hid))byHid.set(hid,[]);
    byHid.get(hid).push(idx);
  });
  let orderClash = 0;
  let directClash = 0;
  const committedEnd = new Map();
  for(const entry of state && state.fills || []){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(!hid || !entry.fit)continue;
    committedEnd.set(hid,Math.max(
      committedEnd.get(hid) || 0,
      Number(entry.fit.placeEnd) || 0
    ));
  }
  // Multi-parent right-after is OR'd: hard interloper AND across several
  // direct predecessors of the same afterHid is unsatisfiable when more than
  // one parent is selected. Soft gap weights + post-check OR still pull adjacency.
  const directPredCount = new Map();
  for(const e of edges){
    if(!e || e.adjacency !== 'direct' || !e.afterHid || !e.beforeHid)continue;
    directPredCount.set(e.afterHid,(directPredCount.get(e.afterHid) || 0) + 1);
  }
  for(const e of edges){
    const beforeIdxs = byHid.get(e.beforeHid) || [];
    const afterIdxs = byHid.get(e.afterHid) || [];
    const skipHardDirect = e.adjacency === 'direct'
      && (directPredCount.get(e.afterHid) || 0) > 1;
    for(const ai of beforeIdxs){
      for(const bi of afterIdxs){
        const A = opts[ai];
        const B = opts[bi];
        if(!A || !B || !A.fit || !B.fit)continue;
        // sometime + direct: never start the successor before the predecessor ends.
        if(B.fit.placeStart + 60000 < A.fit.placeEnd){
          subjectTo.push({
            name:`ord_${orderClash++}`,
            vars:[{name:A.varName,coef:1},{name:B.varName,coef:1}],
            bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
          });
        }
        if(skipHardDirect)continue;
        if(e.adjacency === 'direct' && B.fit.placeStart >= A.fit.placeEnd){
          const between = [];
          for(let ci = 0;ci < opts.length;ci += 1){
            if(ci === ai || ci === bi)continue;
            const C = opts[ci];
            if(!C || !C.fit || C.c.i === A.c.i || C.c.i === B.c.i)continue;
            if(C.fit.placeStart + 60000 < A.fit.placeEnd)continue;
            if(C.fit.placeEnd > B.fit.placeStart + 60000)continue;
            between.push({name:C.varName,coef:1});
          }
          if(between.length){
            // When both linked options are selected, no third movable fill may
            // occupy the space between "right above" and "right below".
            subjectTo.push({
              name:`ord_direct_${directClash++}`,
              vars:[
                {name:A.varName,coef:1},
                {name:B.varName,coef:1},
                ...between
              ],
              bnds:{type:GLPK.GLP_UP,ub:2,lb:0}
            });
          }
        }
      }
    }
    if(skipHardDirect)continue;
    if(e.adjacency === 'direct' && !beforeIdxs.length && committedEnd.has(e.beforeHid)){
      const predEnd = committedEnd.get(e.beforeHid);
      for(const bi of afterIdxs){
        const B = opts[bi];
        if(!B || !B.fit || B.fit.placeStart < predEnd)continue;
        const between = [];
        for(let ci = 0;ci < opts.length;ci += 1){
          if(ci === bi)continue;
          const C = opts[ci];
          if(!C || !C.fit || C.c.i === B.c.i)continue;
          if(C.fit.placeStart + 60000 < predEnd)continue;
          if(C.fit.placeEnd > B.fit.placeStart + 60000)continue;
          between.push({name:C.varName,coef:1});
        }
        if(between.length){
          subjectTo.push({
            name:`ord_direct_placed_${directClash++}`,
            vars:[{name:B.varName,coef:1},...between],
            bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
          });
        }
      }
    }
  }
}

function orderAwareOptimizerSort(dayBase){
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const preds = new Map(); // hid → set of beforeHids that must precede it
  const beforeBoost = new Map();
  if(typeof plannerOrderConstraintsForDay === 'function'){
    for(const e of plannerOrderConstraintsForDay(dayBase)){
      if(!preds.has(e.afterHid))preds.set(e.afterHid,new Set());
      preds.get(e.afterHid).add(e.beforeHid);
      beforeBoost.set(e.beforeHid,(beforeBoost.get(e.beforeHid) || 0) + (e.adjacency === 'direct' ? 2 : 1));
    }
  }
  return (a,b)=>{
    const ah = a && a.h && a.h.hid;
    const bh = b && b.h && b.h.hid;
    if(doing && doing.dayBase === dayBase){
      if(ah === doing.hid && bh !== doing.hid)return -1;
      if(bh === doing.hid && ah !== doing.hid)return 1;
    }
    const criticalA = typeof mustPlaceCriticalOccurrence === 'function'
      && mustPlaceCriticalOccurrence(a);
    const criticalB = typeof mustPlaceCriticalOccurrence === 'function'
      && mustPlaceCriticalOccurrence(b);
    if(criticalA !== criticalB)return criticalA ? -1 : 1;
    // Prefer placing a predecessor before its successor.
    if(ah && bh){
      if(preds.get(bh) && preds.get(bh).has(ah))return -1;
      if(preds.get(ah) && preds.get(ah).has(bh))return 1;
    }
    const wa = beforeBoost.get(ah) || 0;
    const wb = beforeBoost.get(bh) || 0;
    if(wa !== wb)return wb - wa;
    return optimizerWeight(b) - optimizerWeight(a);
  };
}

function optimizerWindowsForCandidate(candidate,state){
  if(!candidate || !candidate.h || !state)return [];
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(candidate.h)){
    const windows = typeof fillDayWindows === 'function'
      ? fillDayWindows(candidate.h,state.dayBase,state.seedLocId)
      : null;
    return windows || [];
  }
  if(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(candidate.h)){
    const window = fillPreferredWindow(candidate.h,state.dayBase,state.seedLocId);
    return window ? [window] : [];
  }
  return [];
}

// Every allowed location is a real optimizer alternative. Previously
// tryPlaceOnDay picked one location greedily while options were enumerated;
// GLPK could optimize times only, then reconciliation changed the location
// (and sometimes the time) after the solve. An explicit null is the valid
// anchor-preserving choice for an anywhere-allowed habit.
function optimizerLocationVariants(fill,state){
  if(!fill || !fill.h || !state)return [undefined];
  const ids = typeof habitLocationIdsForDay === 'function'
    ? habitLocationIdsForDay(fill.h,state.dayBase,state.registry || [])
    : (typeof normalizeLocationIds === 'function'
      ? normalizeLocationIds(fill.h.locationIds,state.registry || [])
      : (Array.isArray(fill.h.locationIds) ? fill.h.locationIds.filter(Boolean) : []));
  if(!ids.length)return [null];
  const anywhereAllowed = typeof habitHasAnywhereForDay === 'function'
    ? habitHasAnywhereForDay(fill.h,state.dayBase,state.registry || [])
    : Boolean(fill.h.anywhereAllowed);
  return anywhereAllowed ? [null,...ids] : ids;
}

function optimizerFitsForFill(state,fill,dayCandidates,candidateBoundaryEdges){
  const out = [];
  const seen = new Map();
  const variants = typeof habitSchedulePlacementVariants === 'function'
    ? habitSchedulePlacementVariants(fill,state.dayBase,state.registry)
    : null;
  const locatedFills = variants
    ? variants.flatMap(variant=>{
      if(Object.prototype.hasOwnProperty.call(variant,'locationId') && variant.locationId !== undefined){
        return [variant];
      }
      return optimizerLocationVariants(variant,state).map(locationId=>({...variant,locationId}));
    })
    : optimizerLocationVariants(fill,state).map(locationId=>({...fill,locationId}));
  for(const locatedFill of locatedFills){
    for(const fit of listPlaceFitsOnDay(
      state,locatedFill,dayCandidates,candidateBoundaryEdges
    )){
      const key = `${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
      if(!seen.has(key)){
        seen.set(key,out.length);
        out.push(fit);
        continue;
      }
      // A specific row may overlap the general window at the same place and
      // time. Keep the better-scored fit so its per-instance preference is not
      // erased merely because the general variant was enumerated first.
      const index = seen.get(key);
      if((Number(fit.score) || 0) < (Number(out[index].score) || 0))out[index] = fit;
    }
  }
  return out;
}

// PURE: all useful feasible fits for a fill on this day. In addition to each
// open-slot start, enumerate starts immediately before/after competing windows.
// Those boundary options let GLPK move flexible work out of a narrow window
// without paying for a minute-by-minute grid on mobile.
function listPlaceFitsOnDay(state,fill,dayCandidates = [],candidateBoundaryEdges = []){
  if(typeof tryPlaceOnDay !== 'function')return [];
  const doing = doingNowForDay(state);
  let placeFill = fill;
  const doingOpts = (doing && fill && fill.h && fill.h.hid === doing.hid)
    ? {allowNetwork:false,doingNowStart:Math.min(Number(doing.startedAt) || Date.now(), Date.now())}
    : {allowNetwork:false};
  if(doingOpts.doingNowStart != null){
    const sessionMin = Math.max(1,Number(doing.sessionMinutes)
      || (typeof doingNowSessionMinutesFor === 'function'
        ? doingNowSessionMinutesFor(fill.h)
        : clampDuration(fill.h.durationMinutes)));
    placeFill = {...fill, chunkMinutes:sessionMin};
  }
  const scan = ()=>{
    const fits = [];
    const seen = new Set();
    const durationMs = fillDurationMinutes(placeFill) * 60000;
    const windowEdges = candidateBoundaryEdges.slice();
    for(const candidate of dayCandidates){
      for(const win of optimizerWindowsForCandidate(candidate,state)){
        windowEdges.push(win.start - durationMs,win.start,win.end - durationMs,win.end);
      }
    }
    // Linked fills need staggered starts — otherwise each partner only gets
    // the same ASAP option and pairwise order rows forbid co-selection. Do not
    // put every unrelated fill on this grid merely because the day contains
    // one link: that multiplied option generation and made ordinary seven-day
    // replans consume the entire solve budget.
    const orderEdges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
    const placeHid = placeFill && placeFill.h && placeFill.h.hid;
    const linkedFill = placeHid && orderEdges.some(edge=>
      edge && (edge.beforeHid === placeHid || edge.afterHid === placeHid));
    // Preserve successor starts that can actually follow a direct predecessor.
    // Without these paired anchors, the per-fill ASAP slice can keep only early
    // successor options while a preferred-time predecessor keeps only late
    // options. The ILP then sees no valid pair even though the day has hours of
    // room (for example Exercise 5:10–5:55 → Shower 5:55–6:00).
    const predecessorEnds = [];
    if(placeHid && orderEdges.length){
      for(const edge of orderEdges){
        if(!edge || edge.adjacency !== 'direct' || edge.afterHid !== placeHid)continue;
        for(const candidate of dayCandidates){
          if(!candidate || !candidate.h || candidate.h.hid !== edge.beforeHid)continue;
          const predFill = {
            h:candidate.h,
            i:candidate.i,
            priority:candidate.priority,
            scarcity:candidate.scarcity
          };
          const probe = tryPlaceOnDay(state,predFill,{allowNetwork:false});
          if(probe && Number.isFinite(probe.placeEnd))predecessorEnds.push(probe.placeEnd);
          const predDurationMs = clampDuration(candidate.h.durationMinutes) * 60000;
          for(const win of optimizerWindowsForCandidate(candidate,state)){
            if(Number.isFinite(win.start))predecessorEnds.push(win.start + predDurationMs);
          }
        }
        for(const entry of state.fills || []){
          const ph = entry && entry.fill && entry.fill.h;
          if(ph && ph.hid === edge.beforeHid && entry.fit
            && Number.isFinite(entry.fit.placeEnd)){
            predecessorEnds.push(entry.fit.placeEnd);
          }
        }
      }
      windowEdges.push(...predecessorEnds);
    }
    const doingFill = doing && placeHid === doing.hid;
    const routeLocationIds = placeFill && placeFill.h
      ? (typeof habitLocationIdsForDay === 'function'
        ? habitLocationIdsForDay(placeFill.h,state.dayBase,state.registry)
        : (Array.isArray(placeFill.h.locationIds) ? placeFill.h.locationIds : []))
      : [];
    const routeAnchorDay = Boolean(routeLocationIds.length
      && (state.rows || []).some(row=>row && row.kind === 'scheduled' && row.locationId));
    if(linkedFill || doingFill){
      const step = 30 * 60000;
      // Cap the stepped grid by THIS fill's latest relevant window end — not
      // Math.min across every candidate (that erased late-window options).
      let gridEnd = state.dayBase + 86400000;
      const ownWindows = optimizerWindowsForCandidate(
        {h:placeFill.h,i:placeFill.i},state
      );
      if(ownWindows.length){
        let ownEnd = 0;
        for(const win of ownWindows){
          if(Number.isFinite(win.end))ownEnd = Math.max(ownEnd,win.end);
        }
        if(ownEnd > 0)gridEnd = Math.min(gridEnd,ownEnd);
      }
      let cursor = Math.max(state.startClock, doing && fill && fill.h && fill.h.hid === doing.hid
        ? doing.startedAt : state.startClock);
      let guards = 0;
      while(cursor < gridEnd && guards < 24){
        windowEdges.push(cursor);
        cursor += step;
        guards += 1;
      }
      // Also chain after other candidates' durations from startClock.
      let chain = state.startClock;
      for(const candidate of dayCandidates){
        if(!candidate || !candidate.h || candidate.h === fill.h)continue;
        const otherDur = clampDuration(candidate.h.durationMinutes) * 60000;
        chain += otherDur;
        windowEdges.push(chain);
      }
      // Direct-order partners: seed starts that abut the successor window /
      // already-committed successor so keepup anchors can pack right before.
      // Include travel slack seeds — mosque partners need leave-by room.
      const fillHid = placeFill && placeFill.h && placeFill.h.hid;
      for(const edge of orderEdges){
        if(!edge || edge.adjacency !== 'direct' || edge.beforeHid !== fillHid)continue;
        for(const candidate of dayCandidates){
          if(!candidate || !candidate.h || candidate.h.hid !== edge.afterHid)continue;
          for(const win of optimizerWindowsForCandidate(candidate,state)){
            for(const slackMin of [0,5,10,15,30,45,60]){
              windowEdges.push(win.start - durationMs - slackMin * 60000);
            }
            windowEdges.push(win.start);
          }
        }
        for(const entry of state.fills || []){
          const ph = entry && entry.fill && entry.fill.h;
          if(!ph || ph.hid !== edge.afterHid || !entry.fit)continue;
          for(const slackMin of [0,5,10,15,30,45,60]){
            windowEdges.push(entry.fit.placeStart - durationMs - slackMin * 60000);
          }
          windowEdges.push(entry.fit.placeStart);
        }
      }
    }
    for(const slot of state.slots || []){
      // Fixed-location anchors create distinct route segments. A small
      // half-hour grid in each open segment gives GLPK enough chained starts
      // to put several flexible errands on the same side of the anchor. Keep
      // this conditional and bounded; ordinary days retain the sparse edge
      // enumeration above.
      const routeAnchors = [];
      if(routeAnchorDay){
        const step = 30 * 60000;
        for(let n = 0;n < 8;n += 1)routeAnchors.push(slot.start + n * step);
      }
      const anchors = [slot.start,state.startClock,...windowEdges,...routeAnchors]
        .filter(ts=>Number.isFinite(ts) && ts < slot.end)
        .sort((a,b)=>a-b);
      for(const anchor of anchors){
        const clone = clonePlacementState(state);
        clone.slots = [slot];
        clone.startClock = Math.max(state.startClock,slot.start,anchor);
        const fit = tryPlaceOnDay(clone,placeFill,doingOpts);
        if(!fit)continue;
        const key = `${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
        if(seen.has(key))continue;
        seen.add(key);
        fits.push(fit);
      }
    }
    // ASAP scoring keeps only the earliest 16 fits. Preserve one feasible
    // option from every open slot as well: a fixed-location appointment splits
    // the day into route alternatives, and GLPK cannot choose the cheaper side
    // of that anchor if every post-appointment option was trimmed here before
    // the model was built. Direct-link abutments receive the same protection.
    const fillHid = placeFill && placeFill.h && placeFill.h.hid;
    const successorStarts = [];
    if(fillHid && orderEdges.length){
      for(const edge of orderEdges){
        if(!edge || edge.adjacency !== 'direct' || edge.beforeHid !== fillHid)continue;
        for(const candidate of dayCandidates){
          if(!candidate || !candidate.h || candidate.h.hid !== edge.afterHid)continue;
          for(const win of optimizerWindowsForCandidate(candidate,state)){
            if(Number.isFinite(win.start))successorStarts.push(win.start);
          }
        }
        for(const entry of state.fills || []){
          const ph = entry && entry.fill && entry.fill.h;
          if(!ph || ph.hid !== edge.afterHid || !entry.fit)continue;
          successorStarts.push(entry.fit.placeStart);
        }
      }
    }
    const fitsBySlot = new Map();
    for(const fit of fits){
      const key = Number(fit && fit.slotStart);
      if(!Number.isFinite(key))continue;
      if(!fitsBySlot.has(key))fitsBySlot.set(key,[]);
      fitsBySlot.get(key).push(fit);
    }
    const slotBoundaryFits = new Set();
    for(const slotFits of fitsBySlot.values()){
      slotFits.sort((a,b)=>a.placeStart - b.placeStart
        || (a.score || 0) - (b.score || 0));
      const keep = routeAnchorDay ? 8 : 1;
      slotFits.slice(0,keep).forEach(fit=>slotBoundaryFits.add(fit));
    }
    const isPinnedRouteOrAbut = (fit)=>{
      if(!fit)return false;
      if(slotBoundaryFits.has(fit))return true;
      const beforeSuccessor = successorStarts.some(start=>{
        if(fit.placeEnd > start + 60000)return false;
        const gapMin = Math.max(0,(start - fit.placeEnd) / 60000);
        return gapMin <= 90;
      });
      if(beforeSuccessor)return true;
      return predecessorEnds.some(end=>{
        if(fit.placeStart + 60000 < end)return false;
        const gapMin = Math.max(0,(fit.placeStart - end) / 60000);
        return gapMin <= 90;
      });
    };
    const pinned = fits.filter(isPinnedRouteOrAbut)
      .sort((a,b)=>(a.score || 0) - (b.score || 0) || a.placeStart - b.placeStart);
    const rest = fits.filter(f=>!isPinnedRouteOrAbut(f))
      .sort((a,b)=>(a.score || 0) - (b.score || 0) || a.placeStart - b.placeStart);
    const out = [];
    const outSeen = new Set();
    for(const fit of pinned.concat(rest)){
      const key = `${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
      if(outSeen.has(key))continue;
      outSeen.add(key);
      out.push(fit);
      // Always keep every protected route/abut fit; fill the rest by score.
      if(out.length >= Math.max(16,pinned.length))break;
    }
    return out;
  };
  return typeof withTravelNetworkPaused === 'function' ? withTravelNetworkPaused(scan) : scan();
}

function fitsOverlap(a,b){
  return a.placeStart < b.placeEnd && b.placeStart < a.placeEnd;
}

// Presence after a fit for route checks: location-tied work wins; otherwise the
// inbound anchor the option was generated against (anywhere keeps prior place).
function fitPresenceLocId(fit){
  if(!fit)return null;
  return fit.locId || fit.prevLocId || null;
}

// Work∩work, or earlier work intersecting inbound travel into the later option
// from the earlier presence. Matches homeDaySequence / reconcileCommittedTravel
// paint: travel is [late.placeStart − edge, late.placeStart]. Without this,
// GLPK can co-select Home@4:25–4:30 and Spresh@4:31–5:01 and the UI draws the
// commute over the Home fill.
function fitsExclusiveClash(a,b,state){
  if(!a || !b)return false;
  if(fitsOverlap(a,b))return true;
  let early = a;
  let late = b;
  if(a.placeStart > b.placeStart
    || (a.placeStart === b.placeStart && a.placeEnd > b.placeEnd)){
    early = b;
    late = a;
  }
  const fromLoc = fitPresenceLocId(early);
  const toLoc = late.locId || null;
  if(!fromLoc || !toLoc || fromLoc === toLoc)return false;
  if(typeof travelEdgeBetweenIds !== 'function')return false;
  const edge = travelEdgeBetweenIds(
    fromLoc,
    toLoc,
    (state && state.registry) || [],
    state && state.mode,
    {allowNetwork:false}
  );
  const travelMs = Math.max(0,Number(edge && edge.seconds) || 0) * 1000;
  if(travelMs <= 0)return false;
  return early.placeEnd > late.placeStart - travelMs;
}

// Solve set-packing ILP for one day. Returns array of {fill, fit} or null on failure.
function solveDayPackingIlp(GLPK,state,dayCandidates,allCandidates,deferrable,solveOptions = {}){
  const options = [];
  const doing = doingNowForDay(state);
  const requiredOccurrenceIndices = solveOptions.requiredOccurrenceIndices instanceof Set
    ? solveOptions.requiredOccurrenceIndices : new Set();
  // One cheap probe per candidate exposes actual earliest completion
  // boundaries after blocks/startClock (not merely the end of its allowed
  // window). Other candidates can then start immediately after a short item:
  // Fajr 5:35–5:37 creates a 5:37 option for Call Amma even when Fajr itself
  // remains allowed until sunrise at 5:58.
  // Daily-breakable reservation windows for this day. Breakables are fitted
  // AFTER this fixed solve, so they are absent from `dayCandidates`; without
  // help, a movable only gets in-window options (all capped by the reserve) and
  // is wrongly deferred even when it fits in a free gap touching no reservation.
  // The option loop below injects outside-reservation fits for movables.
  const reservationWindows = (typeof dailyBreakableReservations === 'function'
    && typeof breakableReservationWindows === 'function'
    && Array.isArray(allCandidates))
    ? dailyBreakableReservations(state,allCandidates).flatMap(r=>breakableReservationWindows(r))
    : [];
  // Direct/right-next links must stay adjacent to their partner, so they are
  // exempt from outside-reservation steering. A loose "sometime before/after"
  // link may still move later within its valid side of the partner; blocking
  // that case made Cooking overlap the end of Work, then hours repair moved it
  // to tomorrow even though a clean evening slot existed before Dinner.
  const directOrderLinkedHids = (typeof plannerOrderConstraintsForDay === 'function')
    ? new Set(plannerOrderConstraintsForDay(state.dayBase)
        .filter(e=>e && e.adjacency === 'direct')
        .flatMap(e=>[e.beforeHid,e.afterHid].filter(Boolean)))
    : new Set();
  const candidateBoundaryEdges = [];
  for(const c of dayCandidates){
    if(!c || !c.h || c.h.breakable)continue;
    const probeFill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const probe = tryPlaceOnDay(state,probeFill,{allowNetwork:false});
    if(probe){
      candidateBoundaryEdges.push(probe.placeStart,probe.placeEnd);
    }
  }
  // Last plan's clocks must be enumerated options. Sparse window-edge
  // probes otherwise miss 11:05 grocery and the prior-weight bonus never fires.
  const dayPrior = priorPlacementsForDay(solveOptions.priorPlacements,state.dayBase);
  for(const p of dayPrior){
    if(Number.isFinite(Number(p.start)))candidateBoundaryEdges.push(Number(p.start));
    if(Number.isFinite(Number(p.end)))candidateBoundaryEdges.push(Number(p.end));
  }
  for(const c of dayCandidates){
    // Breakable budgets are continuous resources, not one all-or-nothing event.
    // They are fitted after this exact fixed-duration solve has reserved narrow
    // windows, then split only when a continuous placement is impossible.
    if(c.h && c.h.breakable)continue;
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    let fits = optimizerFitsForFill(
      state,fill,dayCandidates,candidateBoundaryEdges
    );
    // Inject fits in free gaps touching no reservation (movables only). Breakables
    // are fitted after this solve so the normal enumerator never anchors after
    // their windows; this gives GLPK the outside option the reserve already
    // exempts, so a movable that fits in the evening places today instead of
    // being deferred. Several fits are injected so multiple movables can chain.
    if(reservationWindows.length && typeof isMovableWeekCandidate === 'function'
      && (requiredOccurrenceIndices.has(c.i) || isMovableWeekCandidate(c,state.dayBase))
      && !(c.h && c.h.hid && directOrderLinkedHids.has(c.h.hid))
      && typeof placementFitsOutsideReservations === 'function'){
      let outside = placementFitsOutsideReservations(state,fill,reservationWindows);
      if(requiredOccurrenceIndices.has(c.i)
        && typeof outsideFitKeepsEarlySuccessors === 'function'){
        outside = outside.filter(fit=>outsideFitKeepsEarlySuccessors(
          state,fill,fit,allCandidates || dayCandidates
        ));
      }
      if(outside.length){
        // Keep the ordinary in-window options too. The reserve row below caps
        // their aggregate footprint; deleting them here made an outside option
        // look usable before order rows were known, then left no option at all
        // when that outside fit was after a linked successor. GLPK can now use a
        // harmless short gap while still preferring/limiting clean alternatives.
        const seen = new Set(fits.map(f=>f.placeStart+':'+f.placeEnd));
        for(const f of outside){
          const key = f.placeStart+':'+f.placeEnd;
          if(!seen.has(key)){ seen.add(key); fits.push(f); }
        }
        // A due occurrence and a daily breakable are both commitments. When a
        // clean compatible gap exists, publishing a time-limited incumbent
        // that overlaps the breakable is dominated, so keep only clean fits.
        if(requiredOccurrenceIndices.has(c.i))fits = outside;
      }
    }
    const baseWeight = optimizerWeight(c) + orderBoostForCandidate(c,state.dayBase);
    const weatherDefers = deferrable && deferrable.has(c.i)
      && typeof weatherShouldDeferCandidate === 'function'
      && weatherShouldDeferCandidate(c,state,state.settings || (typeof sortSettings !== 'undefined' ? sortSettings : null),solveOptions.dayStates || []);
    const earliestStart = fits.reduce(
      (min,fit)=>Math.min(min,fit.placeStart),Infinity);
    for(const fit of fits){
      // Same candidate, same duration, same hard feasibility: prefer the
      // earliest option by a small deterministic tiebreak. Without this GLPK
      // may choose an arbitrary later slot after a narrow item claims the
      // candidate's original start (for example Call Amma after Fajr).
      const delayMin = Number.isFinite(earliestStart)
        ? Math.max(0,(fit.placeStart - earliestStart) / 60000)
        : 0;
      fit.optimizerDelayMinutes = delayMin;
      // Keep candidate selection dominant, but let GLPK compare location,
      // preference, scarce-window and initial travel quality instead of being
      // indifferent among same-time location variants. The route reconciler
      // then solves the complete selected chain exactly.
      const boundedFitScore = Math.max(-1000,Math.min(1000,Number(fit.score) || 0));
      const option = {c,fill,fit,
        weight:baseWeight
          - (weatherDefers ? baseWeight + 50 : 0)
          - Math.min(1440,delayMin) * 0.001
          - boundedFitScore * 0.01,
        // A due lower/equal-priority occurrence is still structurally a
        // day-choosing candidate and must remain in the breakable reserve row
        // when it was not promoted to a hard selection. Only a required
        // occurrence that may legitimately claim this day is exempt.
        movable:!requiredOccurrenceIndices.has(c.i)
          && typeof isDayChoosingWeekCandidate === 'function'
          && isDayChoosingWeekCandidate(c)};
      applyDoingNowWeight(option,doing);
      options.push(option);
    }
  }
  if(!options.length)return [];

  // Cap option count so mobile stays responsive. Keep at least one option per
  // candidate before taking second/third alternatives; a global weight slice
  // could otherwise erase every option for a lower-priority habit.
  const MAX_OPTS = 180;
  let opts = options;
  // "Doing Now" is an explicit user command, not an objective preference.
  // Keep only its earliest feasible start so a time-limited MIP solution
  // cannot return a merely-feasible plan that puts ordinary peers ahead of
  // the active session. Location variants at that same start remain available
  // for the complete-day route reconciliation.
  if(doing && doing.hid){
    const doingOptions = opts.filter(o=>o && o.fill && o.fill.h
      && o.fill.h.hid === doing.hid && o.fit);
    const earliestDoingStart = doingOptions.reduce(
      (min,o)=>Math.min(min,o.fit.placeStart),Infinity);
    if(Number.isFinite(earliestDoingStart)){
      opts = opts.filter(o=>!(o && o.fill && o.fill.h && o.fill.h.hid === doing.hid)
        || (o.fit && o.fit.placeStart === earliestDoingStart));
    }
  }
  if(opts.length > MAX_OPTS){
    const groups = new Map();
    for(const option of opts){
      if(!groups.has(option.c.i))groups.set(option.c.i,[]);
      groups.get(option.c.i).push(option);
    }
    for(const group of groups.values()){
      group.sort((a,b)=>b.weight - a.weight || a.fit.placeStart - b.fit.placeStart);
    }
    opts = [];
    let round = 0;
    let added = true;
    while(opts.length < MAX_OPTS && added){
      added = false;
      for(const group of groups.values()){
        if(opts.length >= MAX_OPTS)break;
        if(group[round]){
          opts.push(group[round]);
          added = true;
        }
      }
      round += 1;
    }
  }
  restorePriorPlacementOptions(opts,options,solveOptions.priorPlacements,state.dayBase);

  applyDirectOrderGapWeights(opts,state.dayBase);
  applyPlacedOrderWeights(opts,state);
  applyEarlyBeforeWeights(opts,state);
  applyPriorPlacementWeights(opts,solveOptions.priorPlacements,state.dayBase);

  const vars = [];
  const binaries = [];
  const generals = [];
  opts.forEach((o,idx)=>{
    const name = `y${idx}`;
    o.varName = name;
    vars.push({name,coef:o.weight});
    binaries.push(name);
  });

  const subjectTo = [];
  // At most one option per candidate. A visible order link is a promise: when
  // a linked candidate has feasible options, require one of them so unrelated
  // work moves or drops instead of silently defeating the reorder.
  const byCand = new Map();
  const optionNamesByHid = new Map();
  opts.forEach((o,idx)=>{
    if(!byCand.has(o.c.i))byCand.set(o.c.i,[]);
    byCand.get(o.c.i).push(o.varName);
    const hid = o && o.fill && o.fill.h && o.fill.h.hid;
    if(hid){
      if(!optionNamesByHid.has(hid))optionNamesByHid.set(hid,[]);
      optionNamesByHid.get(hid).push(o.varName);
    }
  });
  // Cluster-flex eligibility is conditional, not a free extra day. If an
  // early candidate is selected, at least one native-due partner that
  // justified the saved-trip claim must also be selected on this day. This
  // prevents an infeasible/dropped partner from leaving an orphan early trip.
  let clusterPairRow = 0;
  for(const c of dayCandidates){
    const partnerIds = typeof clusterFlexPartnerIndicesForDay === 'function'
      ? clusterFlexPartnerIndicesForDay(c,state.dayBase) : [];
    if(!partnerIds.length)continue;
    if(typeof clusterFlexPartnerPlacedForDay === 'function'
      && clusterFlexPartnerPlacedForDay(c,state))continue;
    const ownNames = byCand.get(c.i) || [];
    if(!ownNames.length)continue;
    const partnerNames = [...new Set(partnerIds.flatMap(i=>byCand.get(i) || []))];
    subjectTo.push({
      name:`cluster_pair_${clusterPairRow++}`,
      vars:[
        ...ownNames.map(name=>({name,coef:1})),
        ...partnerNames.map(name=>({name,coef:-1}))
      ],
      bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
    });
  }
  const requiredHids = new Set();
  const dayOrderEdges = typeof plannerOrderConstraintsForDay === 'function'
    ? plannerOrderConstraintsForDay(state.dayBase) : [];
  for(const edge of dayOrderEdges){
    // One-day reorder is an explicit promise for both visible cards. Recurring
    // links only couple selection when their own same-day switch is enabled.
    if(!edge.persistent || edge.temporaryUpgrade){
      requiredHids.add(edge.beforeHid);
      requiredHids.add(edge.afterHid);
    }
  }
  for(const [i,names] of byCand){
    const candidate = dayCandidates.find(c=>c && c.i === i);
    const required = candidate && candidate.h && (
      requiredHids.has(candidate.h.hid)
      || (doing && candidate.h.hid === doing.hid)
      || (typeof weatherLockedPlacement === 'function'
        && weatherLockedPlacement(candidate,state,state.settings || sortSettings))
      || (typeof mustPlaceCriticalOccurrence === 'function'
        && mustPlaceCriticalOccurrence(candidate))
      || requiredOccurrenceIndices.has(i)
    );
    subjectTo.push({
      name:`cand_${i}`,
      vars:names.map(n=>({name:n,coef:1})),
      bnds:required
        ? {type:GLPK.GLP_FX,ub:1,lb:1}
        : {type:GLPK.GLP_UP,ub:1,lb:0}
    });
  }
  let schedulePairRow = 0;
  // Must-do persistent links: each present anchor forces its subject
  // (anchor ⇒ subject). Subject alone remains allowed.
  for(const edge of dayOrderEdges){
    if(!edge.persistent || !edge.requiresPair || !edge.subjectHid || !edge.anchorHid)continue;
    const subjectNames = optionNamesByHid.get(edge.subjectHid) || [];
    if(!subjectNames.length)continue;
    const subjectCommitted = typeof scheduleAnchorCommitForDay === 'function'
      && scheduleAnchorCommitForDay(edge.subjectHid,state.dayBase);
    if(subjectCommitted)continue;
    const anchorCommitted = typeof scheduleAnchorCommitForDay === 'function'
      && scheduleAnchorCommitForDay(edge.anchorHid,state.dayBase);
    if(anchorCommitted){
      // Partner already done/placed today → subject must take one option.
      subjectTo.push({
        name:`schedule_must_${schedulePairRow++}`,
        vars:subjectNames.map(name=>({name,coef:1})),
        bnds:{type:GLPK.GLP_FX,ub:1,lb:1}
      });
      continue;
    }
    const anchorNames = optionNamesByHid.get(edge.anchorHid) || [];
    if(!anchorNames.length)continue;
    // anchor ⇒ subject  →  sum(anchor) - sum(subject) ≤ 0
    subjectTo.push({
      name:`schedule_must_${schedulePairRow++}`,
      vars:[
        ...anchorNames.map(name=>({name,coef:1})),
        ...subjectNames.map(name=>({name,coef:-1}))
      ],
      bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
    });
  }
  // Availability is a real aggregate constraint. tryPlaceOnDay validates one
  // option at a time, so without this row GLPK could choose several individually
  // legal options whose combined minutes exceed the day budget.
  const capacity = Math.max(0,Number(state.remaining) || 0);
  const normalBudgetOptions = opts.filter(o=>o.fit.durMin + o.fit.travelMin <= capacity);
  if(normalBudgetOptions.length){
    subjectTo.push({
      name:'day_capacity',
      vars:normalBudgetOptions.map(o=>({
        name:o.varName,
        coef:o.fit.durMin + o.fit.travelMin
      })),
      bnds:{type:GLPK.GLP_UP,ub:capacity,lb:0}
    });
  }
  // Preserve the existing first-item exception for a single item longer than
  // the configured budget, but never allow another item beside it.
  const oversized = opts.filter(o=>o.fit.durMin + o.fit.travelMin > capacity);
  let budgetClash = 0;
  for(const big of oversized){
    for(const other of opts){
      if(big === other || big.c.i === other.c.i)continue;
      subjectTo.push({
        name:`budget_exclusive_${budgetClash++}`,
        vars:[{name:big.varName,coef:1},{name:other.varName,coef:1}],
        bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
      });
    }
  }
  // Pairwise exclusive intervals (work + inbound travel into the later option).
  // Bucket by coarse time bands first so far-apart options never emit rows.
  // Pad each option one band earlier so pairs that only clash on commute still
  // share a bucket when their work intervals sit near a band boundary.
  let clash = 0;
  const BAND_MS = 3 * 3600000;
  const bands = new Map();
  for(let i = 0;i < opts.length;i += 1){
    const placeStart = Number(opts[i].fit.placeStart) || 0;
    const placeEnd = Number(opts[i].fit.placeEnd) || placeStart;
    const start = placeStart - BAND_MS;
    const end = placeEnd;
    const from = Math.floor(start / BAND_MS);
    const to = Math.floor((Math.max(end,start + 1) - 1) / BAND_MS);
    for(let b = from;b <= to;b += 1){
      if(!bands.has(b))bands.set(b,[]);
      bands.get(b).push(i);
    }
  }
  const seenPairs = new Set();
  for(const idxs of bands.values()){
    for(let ai = 0;ai < idxs.length;ai += 1){
      for(let bi = ai + 1;bi < idxs.length;bi += 1){
        const a = idxs[ai];
        const b = idxs[bi];
        if(opts[a].c.i === opts[b].c.i)continue;
        const pairKey = a < b ? `${a}:${b}` : `${b}:${a}`;
        if(seenPairs.has(pairKey))continue;
        seenPairs.add(pairKey);
        if(!fitsExclusiveClash(opts[a].fit,opts[b].fit,state))continue;
        subjectTo.push({
          name:`ov_${clash++}`,
          vars:[{name:opts[a].varName,coef:1},{name:opts[b].varName,coef:1}],
          bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
        });
      }
    }
  }
  // Temporary same-day order links: forbid successor options that start before
  // a predecessor option ends (sometime + direct).
  appendOrderConstraintRows(GLPK,subjectTo,opts,state.dayBase,state);

  // Daily-breakable reservation (week-holistic hours, then priority when packed):
  //   - Can-wait movables (in `deferrable`) are always capped at spare.
  //   - Packed-week movables (not in `deferrable`): only a strictly higher
  //     priority item is exempt and may displace the breakable; equal/lower
  //     stay under the spare cap (unplaced rather than shorting the daily).
  if(typeof movableCapacityForDay === 'function'
    && typeof dailyBreakableReservations === 'function'
    && typeof fitOverlapWithReservationsMs === 'function'){
    const allCands = Array.isArray(allCandidates) ? allCandidates : dayCandidates;
    const reservations = dailyBreakableReservations(state,allCands);
    if(reservations.length){
      const cap = movableCapacityForDay(state,allCands);
      if(Number.isFinite(cap)){
        const movableRows = [];
        for(const o of opts){
          if(!o.movable)continue;
          const hasCleanAlt = !!(deferrable && deferrable.has(o.c.i));
          const beats = typeof movablePriorityBeatsReservations === 'function'
            && movablePriorityBeatsReservations(o.c,reservations,o.fit);
          // Only packed + higher priority may fully displace the breakable.
          if(!hasCleanAlt && beats)continue;
          let overlapsReserve = false;
          for(const r of reservations){
            const windows = typeof breakableReservationWindows === 'function'
              ? breakableReservationWindows(r)
              : (r.window ? [r.window] : []);
            if(!windows.some(win=>
              o.fit.placeEnd > win.start && o.fit.placeStart < win.end))continue;
            overlapsReserve = true;
            break;
          }
          if(!overlapsReserve)continue;
          const overlapMin = Math.round(
            fitOverlapWithReservationsMs(o.fit,reservations) / 60000);
          if(overlapMin > 0)movableRows.push({name:o.varName,coef:overlapMin});
        }
        if(movableRows.length){
          subjectTo.push({
            name:'movable_breakable_reserve',
            vars:movableRows,
            bnds:{type:GLPK.GLP_UP,ub:Math.round(cap),lb:0}
          });
        }
      }
    }
  }

  // ── Tier-3 travel: never send the user away from their current location and
  // back. The route DP (optimalCommittedLocationRoute) finds the cheapest travel
  // chain for FIXED times but cannot reorder, and every per-option objective
  // term is symmetric in the sum — so GLPK is otherwise indifferent between
  // [at-seed first → one commute out] and [away first → away-and-back], and the
  // tie-break can paint two extra legs (the exact bug: "I was at FarA, it sent
  // me Home then back to FarA then Home again").
  //
  // Model the sequencing cost directly: for each AWAY option (loc ≠ seed)
  // scheduled BEFORE an AT-SEED option (loc = seed), pay a penalty proportional
  // to the saved commute. Linearize the joint "both selected" condition with one
  // auxiliary binary z = y_away ∧ y_atseed (standard 3-row relaxation). The
  // route term is activated only in the frozen-selection pass below, so it can
  // reorder but cannot drop a placeable task; hard windows and pins remain
  // structural constraints. Per the documented lex order this makes MINIMUM
  // TRAVEL outrank ASAP/PRIORITY once the work set is fixed.
  // Today's start place — pin, geofence, lastKnown seed, or closest saved
  // place when the seed is the ephemeral GPS coordinate. Future days keep
  // null so the committed-route DP is not perturbed. Requiring liveLocationId
  // (pin/geofence only) was the production miss: lastKnown=Walmart still
  // drew "travel to Home" while GLPK sent the user home first, then back.
  // Resolve a model option to the saved place where route reconciliation will
  // actually land it. A null option for a habit with allowed locations is not
  // necessarily locationless: the reconciler will choose one of those places.
  const routeLocForOption = (o) => {
    if(!o || !o.fit)return null;
    if(o.fit.locId)return o.fit.locId;
    const h = o.c && o.c.h;
    if(!h || !Array.isArray(h.locationIds) || !h.locationIds.length)return null;
    if(typeof pickHabitLocationId !== 'function')return null;
    return pickHabitLocationId(h,null,state.registry,state.mode,state.dayBase) || null;
  };
  // Route coefficients are applied in a second lexicographic GLPK pass after
  // candidate selection is frozen. Keeping them out of the first objective is
  // what makes "never drop work merely to save a trip" a structural guarantee
  // instead of relying on a fragile coefficient cap.
  const routeObjectiveVars = [];
  const seedLoc = (typeof todaySequencingLocationId === 'function'
    ? todaySequencingLocationId(state)
    : ((state.liveLocId && state.seedLocId === state.liveLocId)
      ? state.seedLocId : null)) || null;
  if(seedLoc && typeof travelEdgeBetweenIds === 'function'){
    const TRAVEL_PAIR_COEF = 0.1;    // 1s of saved commute ≈ 0.1 objective weight
    const TRAVEL_PAIR_CAP = 80;      // bound route vs same-item clock preferences
    const TRAVEL_PAIR_FLOOR = 12;    // still decisive over priority/ASAP deltas
    let tpIdx = 0;
    // One z per (away option × seed candidate), not per seed clock option.
    // At most one option per candidate is selected, so pairing every Breakfast
    // start with every Walmart start exploded to thousands of binaries and the
    // 2-second polish pass returned no-incumbent on real days.
    const seedOptionsByCandidate = new Map();
    for(let bi = 0; bi < opts.length; bi += 1){
      const B = opts[bi];
      const bLoc = routeLocForOption(B);
      if(!bLoc || bLoc !== seedLoc)continue;
      if(!seedOptionsByCandidate.has(B.c.i))seedOptionsByCandidate.set(B.c.i,[]);
      seedOptionsByCandidate.get(B.c.i).push(B);
    }
    for(let ai = 0; ai < opts.length; ai += 1){
      const A = opts[ai];
      const aLoc = routeLocForOption(A);
      if(!aLoc || aLoc === seedLoc)continue;            // A must be AWAY from seed
      const driveSec = Math.max(0,Number(travelEdgeBetweenIds(
        seedLoc,aLoc,state.registry,state.mode,{allowNetwork:false}
      ).seconds) || 0);
      const savedSec = typeof travelLegCostSeconds === 'function'
        ? travelLegCostSeconds(driveSec,seedLoc,aLoc) : driveSec;
      if(savedSec <= 0)continue;                         // co-located: no away-and-back risk
      const pen = Math.max(TRAVEL_PAIR_FLOOR,
        Math.min(TRAVEL_PAIR_CAP,savedSec * TRAVEL_PAIR_COEF));
      for(const [candI,seedOpts] of seedOptionsByCandidate){
        if(candI === A.c.i)continue;
        const later = seedOpts.filter(B=>A.fit.placeStart < B.fit.placeStart);
        if(!later.length)continue;
        const z = `tp_${tpIdx++}`;
        binaries.push(z);
        vars.push({name:z,coef:0});
        routeObjectiveVars.push({name:z,coef:-pen});
        subjectTo.push({
          name:`${z}_ubA`,
          vars:[{name:z,coef:1},{name:A.varName,coef:-1}],
          bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
        });
        subjectTo.push({
          name:`${z}_ubB`,
          vars:[{name:z,coef:1},...later.map(B=>({name:B.varName,coef:-1}))],
          bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
        });
        subjectTo.push({
          name:`${z}_lb`,
          vars:[{name:z,coef:1},{name:A.varName,coef:-1},...later.map(B=>({name:B.varName,coef:-1}))],
          bnds:{type:GLPK.GLP_LO,ub:0,lb:-1}
        });
      }
    }
  }

  // A fixed-location appointment can divide one nearby errand cluster into two
  // visits even when every errand would fit on the same side. Per-option travel
  // is blind to that interaction: each option sees a plausible inbound leg,
  // while the committed route becomes stores→Home→stores. Model the split
  // directly in GLPK. For each fixed anchor and connected location cluster,
  // side binaries indicate whether any selected option lies before/after the
  // anchor; their conjunction pays only the extra route seconds introduced by
  // crossing the anchor. This is generic route cost—no item/place names and no
  // post-solve relocation—and runs only after candidate selection is frozen.
  if(typeof travelEdgeBetweenIds === 'function'){
    const hardAnchors = (state.rows || []).filter(row=>
      row && row.kind === 'scheduled' && row.locationId
      && Number.isFinite(Number(row.start)) && Number.isFinite(Number(row.end)));
    const SPLIT_ROUTE_NEAR_SECONDS = typeof CLUSTER_FLEX_NEAR_SECONDS !== 'undefined'
      ? CLUSTER_FLEX_NEAR_SECONDS : 15 * 60;
    const SPLIT_ROUTE_COEF = 0.1;
    // Bound each anchor's route influence relative to same-item clock hints.
    const splitRouteCap = Math.max(1,80 / Math.max(1,hardAnchors.length));
    const splitRouteFloor = Math.min(12,splitRouteCap);
    let splitIdx = 0;
    for(const hard of hardAnchors){
      const located = opts.map((option,index)=>({
        option,index,locId:routeLocForOption(option)
      })).filter(item=>item.locId && item.locId !== hard.locationId);
      const locIds = [...new Set(located.map(item=>item.locId))];
      const unseen = new Set(locIds);
      const components = [];
      while(unseen.size){
        const first = unseen.values().next().value;
        unseen.delete(first);
        const component = [first];
        for(let cursor = 0;cursor < component.length;cursor += 1){
          const here = component[cursor];
          for(const other of [...unseen]){
            const seconds = Math.max(0,Number(travelEdgeBetweenIds(
              here,other,state.registry,state.mode,{allowNetwork:false}
            ).seconds) || 0);
            if(here !== other && (seconds <= 0 || seconds > SPLIT_ROUTE_NEAR_SECONDS))continue;
            unseen.delete(other);
            component.push(other);
          }
        }
        components.push(new Set(component));
      }
      for(const component of components){
        const before = located.filter(item=>component.has(item.locId)
          && item.option.fit.placeEnd <= hard.start);
        const after = located.filter(item=>component.has(item.locId)
          && item.option.fit.placeStart >= hard.end);
        if(!before.length || !after.length)continue;
        // A candidate cannot be on both sides simultaneously, so a one-item
        // component cannot create a split trip by itself.
        const beforeCandidates = new Set(before.map(item=>item.option.c.i));
        if(!after.some(item=>!beforeCandidates.has(item.option.c.i)))continue;
        let minimumExtraSeconds = Infinity;
        for(const left of before){
          for(const right of after){
            if(left.option.c.i === right.option.c.i)continue;
            const toAnchor = Math.max(0,Number(travelEdgeBetweenIds(
              left.locId,hard.locationId,state.registry,state.mode,{allowNetwork:false}
            ).seconds) || 0);
            const fromAnchor = Math.max(0,Number(travelEdgeBetweenIds(
              hard.locationId,right.locId,state.registry,state.mode,{allowNetwork:false}
            ).seconds) || 0);
            const joined = Math.max(0,Number(travelEdgeBetweenIds(
              left.locId,right.locId,state.registry,state.mode,{allowNetwork:false}
            ).seconds) || 0);
            const extraDrive = Math.max(0,toAnchor + fromAnchor - joined);
            const extraLegs = (left.locId !== hard.locationId ? 1 : 0)
              + (hard.locationId !== right.locId ? 1 : 0)
              - (left.locId !== right.locId ? 1 : 0);
            const extraOverhead = extraLegs > 0
              && typeof TRAVEL_LEG_OVERHEAD_SECONDS === 'number'
              ? extraLegs * TRAVEL_LEG_OVERHEAD_SECONDS
              : 0;
            minimumExtraSeconds = Math.min(
              minimumExtraSeconds,
              extraDrive + extraOverhead
            );
          }
        }
        if(!Number.isFinite(minimumExtraSeconds) || minimumExtraSeconds <= 0)continue;
        const penalty = Math.max(splitRouteFloor,
          Math.min(splitRouteCap,minimumExtraSeconds * SPLIT_ROUTE_COEF));
        if(penalty <= 0)continue;
        const beforeVar = `split_before_${splitIdx}`;
        const afterVar = `split_after_${splitIdx}`;
        const splitVar = `split_route_${splitIdx}`;
        splitIdx += 1;
        binaries.push(beforeVar,afterVar,splitVar);
        vars.push({name:beforeVar,coef:0},{name:afterVar,coef:0},{name:splitVar,coef:0});
        routeObjectiveVars.push({name:splitVar,coef:-penalty});
        for(const item of before){
          subjectTo.push({
            name:`${beforeVar}_has_${item.index}`,
            vars:[{name:beforeVar,coef:1},{name:item.option.varName,coef:-1}],
            bnds:{type:GLPK.GLP_LO,ub:0,lb:0}
          });
        }
        for(const item of after){
          subjectTo.push({
            name:`${afterVar}_has_${item.index}`,
            vars:[{name:afterVar,coef:1},{name:item.option.varName,coef:-1}],
            bnds:{type:GLPK.GLP_LO,ub:0,lb:0}
          });
        }
        subjectTo.push(
          {
            name:`${beforeVar}_only_if_selected`,
            vars:[
              {name:beforeVar,coef:1},
              ...before.map(item=>({name:item.option.varName,coef:-1}))
            ],
            bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
          },
          {
            name:`${afterVar}_only_if_selected`,
            vars:[
              {name:afterVar,coef:1},
              ...after.map(item=>({name:item.option.varName,coef:-1}))
            ],
            bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
          }
        );
        subjectTo.push(
          {
            name:`${splitVar}_ub_before`,
            vars:[{name:splitVar,coef:1},{name:beforeVar,coef:-1}],
            bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
          },
          {
            name:`${splitVar}_ub_after`,
            vars:[{name:splitVar,coef:1},{name:afterVar,coef:-1}],
            bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
          },
          {
            name:`${splitVar}_lb`,
            vars:[
              {name:splitVar,coef:1},
              {name:beforeVar,coef:-1},
              {name:afterVar,coef:-1}
            ],
            bnds:{type:GLPK.GLP_LO,ub:0,lb:-1}
          }
        );
      }
    }
  }

  const problem = {
    name:'AgendaDayPack',
    objective:{
      direction:GLPK.GLP_MAX,
      name:'obj',
      vars
    },
    subjectTo,
    binaries,
    generals
  };

  // Keep each day bounded inside GLPK itself. An outer Promise timeout cannot
  // cancel glpk.js's nested Worker; without the native limit a timed-out solve
  // kept running and every later day queued behind it, routinely consuming the
  // full 45-second week budget.
  // Cold open / ordinary solves stay at 4s — that wait is already the product
  // limit. The while-open tick may raise it when the next row is imminent.
  // Background refinement may raise it further after a usable agenda is mounted.
  const nativeLimitSeconds = solveOptions.refine
    ? Math.max(4,Math.min(
        50,
        Number(solveOptions.refineNativeCapSeconds) > 0
          ? Number(solveOptions.refineNativeCapSeconds)
          : 30,
        Math.floor(((Number(solveOptions.solveBudgetMs)
          || Number(solveOptions.refineBudgetMs)
          || AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS) - 750) / 1000)
      ))
    : (solveOptions.tickReplan
      ? Math.max(4,Math.min(10,Math.round(Number(solveOptions.glpkLimitSeconds)
        || (typeof HOME_AGENDA_TICK_GLPK_LIMIT_SECONDS === 'number'
          ? HOME_AGENDA_TICK_GLPK_LIMIT_SECONDS : 10))))
      : 4);
  const result = GLPK.solve(problem,{
    msglev:GLPK.GLP_MSG_OFF,
    presol:true,
    tmlim:nativeLimitSeconds
  });
  // glpk.js may return a Promise or a sync result depending on build.
  return {
    result,opts,problem,
    candidateOptionNames:[...byCand.entries()],
    routeObjectiveVars,
    nativeLimitSeconds
  };
}

async function resolveSolve(maybe){
  if(maybe && typeof maybe.then === 'function')return maybe;
  return maybe;
}

async function packDayWithOptimizer(state,dayCandidates,allCandidates,deferrable,solveOptions = {}){
  const GLPK = await ensureGlpk();
  const packed = solveDayPackingIlp(
    GLPK,state,dayCandidates,allCandidates,deferrable,solveOptions
  );
  if(Array.isArray(packed) && packed.length === 0)return [];
  const {result:raw,opts,problem,candidateOptionNames,routeObjectiveVars,nativeLimitSeconds} = packed;
  let result = await resolveSolve(raw);
  let status = result && result.result && result.result.status;
  // GLP_OPT=5, GLP_FEAS=2. A time-limited incumbent is safe to publish because
  // critical one-day/daily P0 occurrences are hard rows above. Retaining it is
  // preferable to replacing the whole day with a greedy chain; the latter can
  // consume Juma's only weekly window while arranging flexible predecessors.
  if(status !== 5 && status !== 2)return null;
  // A full day can find a valid incumbent before proving its route objective.
  // Give GLPK a second, much smaller search: freeze exactly which candidates
  // the incumbent selected, then optimize their existing clock/location
  // options. This cannot drop work or weaken any hard policy row, and unlike a
  // post-solve compactor it is still the same ILP model making the arrangement.
  // It is especially valuable on mobile, where the first four-second solve can
  // spend nearly all its budget establishing selection feasibility.
  const selectionStatus = status === 5 ? 'optimal' : 'feasible';
  let routePolishStatus = 'not-needed';
  let routePolishApplied = false;
  let routeObjectiveBefore = null;
  let routeObjectiveAfter = null;
  const incumbentVars = (result.result && result.result.vars) || {};
  const hasRouteObjective = Array.isArray(routeObjectiveVars)
    && routeObjectiveVars.length > 0;
  if(hasRouteObjective && Array.isArray(candidateOptionNames)){
    // Until the frozen-selection route pass returns an optimum, the complete
    // result is only feasible even when candidate selection itself was proved.
    status = 2;
    routePolishStatus = 'no-incumbent';
    const frozenSelectionRows = candidateOptionNames.map(([candidateIndex,names],rowIndex)=>{
      const selected = names.some(name=>(incumbentVars[name] || 0) > 0.5) ? 1 : 0;
      return {
        name:`route_polish_cand_${candidateIndex}_${rowIndex}`,
        vars:names.map(name=>({name,coef:1})),
        bnds:{type:GLPK.GLP_FX,ub:selected,lb:selected}
      };
    });
    const routeCoefficients = new Map(routeObjectiveVars.map(item=>[item.name,item.coef]));
    const polishProblem = {
      ...problem,
      name:'AgendaDayRoutePolish',
      objective:{
        ...problem.objective,
        vars:problem.objective.vars.map(item=>routeCoefficients.has(item.name)
          ? {...item,coef:routeCoefficients.get(item.name)} : item)
      },
      subjectTo:[...problem.subjectTo,...frozenSelectionRows]
    };
    try{
      const polished = await resolveSolve(GLPK.solve(polishProblem,{
        msglev:GLPK.GLP_MSG_OFF,
        presol:true,
        tmlim:Number(nativeLimitSeconds) > 4
          ? Math.max(2,Math.min(6,Number(nativeLimitSeconds) - 2)) : 2
      }));
      const polishedStatus = polished && polished.result && polished.result.status;
      if(polishedStatus === 5 || polishedStatus === 2){
        routePolishStatus = polishedStatus === 5 ? 'optimal' : 'feasible';
        const objectiveValue = solved=>{
          const values = (solved && solved.result && solved.result.vars) || {};
          return polishProblem.objective.vars.reduce((sum,item)=>
            sum + (Number(item.coef) || 0) * (Number(values[item.name]) || 0),0);
        };
        routeObjectiveBefore = objectiveValue(result);
        routeObjectiveAfter = objectiveValue(polished);
        const improves = routeObjectiveAfter > routeObjectiveBefore + 1e-7;
        if(improves){
          result = polished;
          routePolishApplied = true;
        }
        // "Optimal" now means both candidate selection and the frozen-set
        // clock/route arrangement were proved; otherwise retain FEAS provenance.
        status = status === 5 && polishedStatus === 5 ? 5 : 2;
      }
    }catch{
      routePolishStatus = 'error';
      // The original feasible incumbent remains valid and publishable.
    }
  }
  const vars = (result.result && result.result.vars) || {};
  const chosen = [];
  opts.forEach(o=>{
    if((vars[o.varName] || 0) > 0.5){
      // Preserve objective values already computed by this solve. The day
      // header audit can then expose them without rerunning GLPK or recording
      // its branch-by-branch search.
      o.fit.optimizerWeight = o.weight;
      o.fit.optimizerCandidateWeight = optimizerWeight(o.c);
      chosen.push({fill:o.fill,fit:o.fit});
    }
  });
  chosen.sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  chosen.solveStatus = status === 5 ? 'optimal' : 'feasible';
  chosen.solveDiagnostics = {
    selectionStatus,
    routePolishStatus,
    routePolishApplied,
    routeObjectiveBefore,
    routeObjectiveAfter,
    candidateCount:Array.isArray(candidateOptionNames) ? candidateOptionNames.length : dayCandidates.length,
    optionCount:opts.length,
    routeTermCount:Array.isArray(routeObjectiveVars) ? routeObjectiveVars.length : 0
  };
  return chosen;
}

// Scarcity-order placement for one day when ILP times out or is infeasible.
// Keeps the rest of the week on the optimizer path instead of aborting entirely.
// Honours the same can-wait / packed-priority deferral as the ILP reserve.
function packDayWithHeuristic(state,dayCandidates,allCandidates,dayStates,packOptions = {}){
  if(typeof tryPlaceOnDay !== 'function' || typeof commitPlacement !== 'function')return [];
  const doing = doingNowForDay(state);
  const seqLoc = typeof todaySequencingLocationId === 'function'
    ? todaySequencingLocationId(state) : null;
  const byWeight = orderAwareOptimizerSort(state.dayBase);
  const requiredOccurrenceIndices = packOptions.requiredOccurrenceIndices instanceof Set
    ? packOptions.requiredOccurrenceIndices : new Set();
  const ordered = dayCandidates.slice().sort((a,b)=>{
    const dailyA = typeof isIndependentDailyOccurrence === 'function'
      && isIndependentDailyOccurrence(a);
    const dailyB = typeof isIndependentDailyOccurrence === 'function'
      && isIndependentDailyOccurrence(b);
    if(dailyA !== dailyB)return dailyA ? -1 : 1;
    const requiredA = requiredOccurrenceIndices.has(a && a.i);
    const requiredB = requiredOccurrenceIndices.has(b && b.i);
    if(requiredA !== requiredB)return requiredA ? -1 : 1;
    if(seqLoc && typeof habitMatchesSequencingLocation === 'function'){
      const la = habitMatchesSequencingLocation(a && a.h, seqLoc);
      const lb = habitMatchesSequencingLocation(b && b.h, seqLoc);
      if(la !== lb){
        const atC = la ? a : b;
        const awayC = la ? b : a;
        const canWait = typeof sequencingAwayCanWait !== 'function'
          || sequencingAwayCanWait(awayC, atC, state);
        if(canWait)return la ? -1 : 1;
      }
    }
    const aNeedsB = typeof clusterFlexDependsOnCandidate === 'function'
      && clusterFlexDependsOnCandidate(a,b);
    const bNeedsA = typeof clusterFlexDependsOnCandidate === 'function'
      && clusterFlexDependsOnCandidate(b,a);
    if(aNeedsB !== bNeedsA)return aNeedsB ? 1 : -1;
    return byWeight(a,b);
  });
  const pool = Array.isArray(allCandidates) && allCandidates.length ? allCandidates : dayCandidates;
  const states = Array.isArray(dayStates) && dayStates.length ? dayStates : [state];
  const chosen = [];
  const reservationWindows = (typeof dailyBreakableReservations === 'function'
    && typeof breakableReservationWindows === 'function')
    ? dailyBreakableReservations(state,pool).flatMap(r=>breakableReservationWindows(r))
    : [];
  for(const c of ordered){
    if(state.placed.has(c.i))continue;
    if(typeof clusterFlexPartnerPlacedForDay === 'function'
      && !clusterFlexPartnerPlacedForDay(c,state))continue;
    if(!requiredOccurrenceIndices.has(c.i)
      && typeof fastPathDefersMovable === 'function'
      && fastPathDefersMovable(c,state,pool,states))continue;
    if(typeof weatherShouldDeferCandidate === 'function'
      && weatherShouldDeferCandidate(c,state,state.settings || sortSettings,states))continue;
    let fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const placeOpts = {
      settings:state.settings || sortSettings,
      allowNetwork:true,reservationWindows,reservationCandidates:pool
    };
    if(doing && fill.h && fill.h.hid === doing.hid){
      placeOpts.doingNowStart = Math.min(Number(doing.startedAt) || Date.now(), Date.now());
      const sessionMin = Math.max(1,Number(doing.sessionMinutes)
        || (typeof doingNowSessionMinutesFor === 'function'
          ? doingNowSessionMinutesFor(fill.h)
          : clampDuration(fill.h.durationMinutes)));
      fill = {...fill, chunkMinutes:sessionMin};
    }
    const fit = tryPlaceOnDay(state,fill,placeOpts);
    if(!fit)continue;
    chosen.push({fill,fit});
    commitPlacement(state,fill,fit);
    state.day.agendaItems.push({
      h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity,
      locationId:fit.locId,
      chunkMinutes:null,
      chunkIndex:null
    });
  }
  return chosen;
}

// Assign candidates onto dayStates using per-day ILP packing. Individual days
// can fall back to the scarcity heuristic; the returned summary records that
// provenance so the UI can decide whether to request a deeper refinement.
function combinedPlannerSolveStatus(a,b){
  const rank = status=>status === 'fallback' ? 0 : (status === 'optimal' ? 2 : 1);
  const left = a === 'fallback' || a === 'feasible' || a === 'optimal' ? a : 'feasible';
  const right = b === 'fallback' || b === 'feasible' || b === 'optimal' ? b : 'feasible';
  return rank(left) <= rank(right) ? left : right;
}

// Conservative look-ahead for refinement budgeting. A day with no eligible
// non-breakable work cannot consume a fixed-pack solve, so it must not dilute
// the time available to earlier hard days. Day-choosing candidates still count
// on every eligible future day because the current solve may defer them there.
function refinementDayMayNeedFixedSolve(state,candidates,oneShotPlaced){
  if(!state || !Array.isArray(candidates))return false;
  return candidates.some(c=>{
    if(!c || !c.h || c.h.breakable)return false;
    if(c.h.type === 'task' && oneShotPlaced && oneShotPlaced.has(c.i))return false;
    if(state.placed && state.placed.has(c.i))return false;
    return !c.eligible || c.eligible.has(state.dayBase);
  });
}

async function assignWeekCandidatesOptimized(candidates,dayStates,settings,solveOptions = {}){
  for(const c of candidates){
    if(c.scarcity == null && typeof scarcityScore === 'function'){
      c.scarcity = scarcityScore(c,dayStates);
    }
  }
  // Chronological days so rhythm virtual lastLog advances naturally.
  const virtualLogs = new Map();
  const virtualCompletionCounts = new Map();
  const oneShotPlaced = new Set();
  let total = 0;
  let budgetLeft = solveOptions.refine
    ? Math.max(5000, Number(solveOptions.refineBudgetMs) > 0
        ? Number(solveOptions.refineBudgetMs)
        : AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS)
    : AGENDA_OPTIMIZER_WEEK_SOLVE_BUDGET_MS;
  let plannerSolveStatus = 'optimal';
  const daySolves = [];
  const dayWeights = dayStates.map((_,offset)=>daySolveWeight(offset));
  const provenDays = new Set(
    solveOptions.refine && Array.isArray(solveOptions.provenDayKeys)
      ? solveOptions.provenDayKeys.filter(Boolean)
      : []
  );
  const memoFutureBreakableMinutes = solveOptions.memoFutureBreakableMinutes
    && typeof solveOptions.memoFutureBreakableMinutes === 'object'
    ? solveOptions.memoFutureBreakableMinutes : {};
  const futureBreakableMinutesFor = c=>Math.max(
    0,Number(memoFutureBreakableMinutes[c && c.i]) || 0
  );

  const collectDeferrable = (state,fixedCands)=>{
    const deferrable = new Set();
    if(typeof isMovableWeekCandidate !== 'function'
      || typeof movableCapacityForDay !== 'function')return deferrable;
    for(const c of fixedCands){
      const reference = virtualLogs.has(c.i) ? virtualLogs.get(c.i) : undefined;
      const completionOffset = virtualCompletionCounts.get(c.i) || 0;
      if(!isMovableWeekCandidate(c,state.dayBase,reference,completionOffset))continue;
      if(!c.eligible)continue;
      const dur = clampDuration(c.h.durationMinutes);
      for(let j = 0;j < dayStates.length;j += 1){
        if(dayStates[j] === state)continue;
        if(!c.eligible.has(dayStates[j].dayBase))continue;
        if(movableCapacityForDay(dayStates[j],candidates) >= dur){
          deferrable.add(c.i);
          break;
        }
      }
    }
    return deferrable;
  };

  const recordFixedChoices = (state,chosen)=>{
    for(const {fill,fit} of chosen || []){
      commitPlacement(state,fill,fit);
      state.day.agendaItems.push({
        h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity,
        locationId:fit.locId,chunkMinutes:null,chunkIndex:null
      });
      total += 1;
      const c = candidates.find(x=>x.i === fill.i);
      if(c && c.h && c.h.type === 'task')oneShotPlaced.add(c.i);
      if(c && c.h && c.h.type !== 'task' && Number.isFinite(Number(c.h.target))){
        virtualLogs.set(c.i,state.dayBase);
        virtualCompletionCounts.set(c.i,(virtualCompletionCounts.get(c.i) || 0) + 1);
      }
    }
  };

  const recordBreakableAdds = (state,c,beforeCount)=>{
    const added = state.fills.slice(beforeCount);
    for(const entry of added){
      state.day.agendaItems.push({
        h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,
        locationId:entry.fit.locId,
        chunkMinutes:entry.fit.durMin,
        chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
      });
      total += 1;
    }
    return added.length;
  };

  for(let dayOffset = 0;dayOffset < dayStates.length;dayOffset += 1){
    const state = dayStates[dayOffset];
    const dayCands = [];
    for(const c of candidates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(c.pinned && !state.isTodayDay)continue;
      if(c.h && c.h.type === 'task' && oneShotPlaced.has(c.i))continue;
      const rhythmHabit = !!(c.h && c.h.type !== 'task'
        && Number.isFinite(Number(c.h && c.h.target)));
      const breakableRhythm = !!(c.h && c.h.breakable && rhythmHabit);
      if(rhythmHabit && virtualLogs.has(c.i)){
        const vLog = virtualLogs.get(c.i);
        const spaced = typeof rhythmEligibleOnDay === 'function'
          && rhythmEligibleOnDay(
            c.h,vLog,state.dayBase,state.weekday,
            virtualCompletionCounts.get(c.i) || 0
          );
        const afterLast = state.dayBase > (typeof dayStart === 'function' ? dayStart(vLog) : vLog);
        const linkExtra = afterLast && typeof keepupAllowsLinkExtraOnDay === 'function'
          && keepupAllowsLinkExtraOnDay(c.h,state.dayBase,candidates);
        if(!spaced && !linkExtra)continue;
      }
      if(c.h && c.h.breakable && c.h.type === 'task'){
        const left = typeof breakableMinutesLeft === 'function'
          ? breakableMinutesLeft(c.h,c.i,dayStates)
          : (typeof remainingDurationMinutes === 'function' ? remainingDurationMinutes(c.h) : 0);
        if(left - futureBreakableMinutesFor(c) <= 0)continue;
        dayCands.push(c);
        continue;
      }
      if(breakableRhythm){
        if(state.placed.has(c.i))continue;
        const left = typeof breakableMinutesLeft === 'function'
          ? breakableMinutesLeft(c.h,c.i,state)
          : (typeof breakableBudgetMinutes === 'function'
            ? breakableBudgetMinutes(c.h,state.dayBase) : 0);
        if(left <= 0)continue;
        dayCands.push(c);
        continue;
      }
      if(state.placed.has(c.i))continue;
      dayCands.push(c);
    }
    const requiredOccurrenceIndices = new Set();
    if(typeof mustPlaceOccurrenceByDay === 'function'){
      for(const c of dayCands){
        const hasVirtual = virtualLogs.has(c.i);
        const reference = hasVirtual ? virtualLogs.get(c.i) : undefined;
        const completionOffset = virtualCompletionCounts.get(c.i) || 0;
        if((typeof requiredOccurrenceCanClaimDay === 'function'
          && requiredOccurrenceCanClaimDay(c,state,candidates,reference,completionOffset))
          || (typeof requiredOccurrenceCanClaimDay !== 'function'
            && mustPlaceOccurrenceByDay(c,state.dayBase,reference,completionOffset))){
          requiredOccurrenceIndices.add(c.i);
        }
      }
    }
    let fixedCands = dayCands.filter(c=>!(c.h && c.h.breakable));
    if(!fixedCands.length)continue;

    // A later refine pass should not spend GLPK on a day already proved
    // optimal. Replay that packing; if the clocks no longer fit, fall through
    // and search again.
    if(solveOptions.refine && provenDays.has(dateKey(state.dayBase))){
      const replayed = replayPriorFixedChoices(
        state,fixedCands,solveOptions.priorPlacements,collectDeferrable(state,fixedCands)
      );
      if(replayed && replayed.length){
        daySolves.push({
          dayKey:dateKey(state.dayBase),phase:'fixed-pack',status:'optimal',
          elapsedMs:0,...(replayed.solveDiagnostics || {}),
          selectionStatus:'reused-optimal'
        });
        recordFixedChoices(state,replayed);
        continue;
      }
    }

    // GLPK deliberately solves fixed-duration work first and normally fills
    // breakables afterward. A drag chain such as A → breakable X → B needs a
    // small staged pass instead: place fixed ancestors, fill X, then let GLPK
    // solve B and the rest around those committed chunks.
    const dayEdges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
    // A one-day drag/reorder is a stronger explicit promise than inferred due
    // work. If the day is overloaded, keep the linked visible pair hard and
    // let unrelated due candidates compete normally instead of making the
    // entire model infeasible (which would discard the order guarantee in the
    // heuristic fallback). Persistent rhythm links do not suppress ordinary
    // due enforcement; they are coupling policy rather than a one-day promise.
    const explicitCommitmentHids = new Set();
    for(const edge of dayEdges){
      if(!edge || (edge.persistent && !edge.temporaryUpgrade))continue;
      if(edge.beforeHid)explicitCommitmentHids.add(edge.beforeHid);
      if(edge.afterHid)explicitCommitmentHids.add(edge.afterHid);
    }
    if(explicitCommitmentHids.size){
      for(const i of [...requiredOccurrenceIndices]){
        const c = dayCands.find(item=>item && item.i === i);
        if(!c || !c.h || !explicitCommitmentHids.has(c.h.hid)){
          requiredOccurrenceIndices.delete(i);
        }
      }
    }
    const byHid = new Map(dayCands
      .filter(c=>c && c.h && c.h.hid)
      .map(c=>[c.h.hid,c]));
    const stagedBreakHids = new Set();
    for(const edge of dayEdges){
      const before = byHid.get(edge.beforeHid);
      const after = byHid.get(edge.afterHid);
      if(before && before.h && before.h.breakable && after){
        stagedBreakHids.add(edge.beforeHid);
      }
      if(after && after.h && after.h.breakable && before){
        stagedBreakHids.add(edge.afterHid);
      }
    }
    const stagedFixedHids = new Set();
    let expanded = true;
    while(expanded){
      expanded = false;
      for(const edge of dayEdges){
        if(!stagedBreakHids.has(edge.afterHid) && !stagedFixedHids.has(edge.afterHid))continue;
        const pred = byHid.get(edge.beforeHid);
        if(!pred || !pred.h)continue;
        const target = pred.h.breakable ? stagedBreakHids : stagedFixedHids;
        if(!target.has(edge.beforeHid)){
          target.add(edge.beforeHid);
          expanded = true;
        }
      }
    }

    const stagedFixed = fixedCands.filter(c=>stagedFixedHids.has(c.h && c.h.hid));
    if(stagedFixed.length){
      let earlyChosen = null;
      const earlyStarted = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      if(budgetLeft >= AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS){
        const earlyMs = Math.max(
          AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS,
          Math.min(AGENDA_OPTIMIZER_DAY_SOLVE_MAX_MS,Math.round(budgetLeft / 3))
        );
        try{
          earlyChosen = await withTimeout(
            packDayWithOptimizer(state,stagedFixed,candidates,new Set(),{
              ...solveOptions,solveBudgetMs:earlyMs,requiredOccurrenceIndices
            }),
            earlyMs
          );
        }catch{ earlyChosen = null; }
      }
      const earlySpent = Math.max(0,((typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now()) - earlyStarted);
      budgetLeft = Math.max(0,budgetLeft - earlySpent);
      if(!earlyChosen){
        plannerSolveStatus = 'fallback';
        daySolves.push({
          dayKey:dateKey(state.dayBase),phase:'linked-stage',status:'fallback',
          candidateCount:stagedFixed.length,elapsedMs:Math.round(earlySpent)
        });
        earlyChosen = packDayWithHeuristic(
          state,stagedFixed,candidates,dayStates,{requiredOccurrenceIndices}
        );
        // The heuristic commits its choices itself.
        for(const {fill} of earlyChosen){
          total += 1;
          const c = candidates.find(x=>x.i === fill.i);
          if(c && c.h && c.h.type === 'task')oneShotPlaced.add(c.i);
          if(c && c.h && c.h.type !== 'task' && Number.isFinite(Number(c.h.target))){
            virtualLogs.set(c.i,state.dayBase);
          }
        }
      }else{
        daySolves.push({
          dayKey:dateKey(state.dayBase),phase:'linked-stage',status:earlyChosen.solveStatus || 'feasible',
          elapsedMs:Math.round(earlySpent),...(earlyChosen.solveDiagnostics || {})
        });
        if(earlyChosen.solveStatus === 'feasible' && plannerSolveStatus === 'optimal'){
          plannerSolveStatus = 'feasible';
        }
        recordFixedChoices(state,earlyChosen);
      }
      const stagedIdxs = new Set(
        state.fills
          .filter(entry=>entry && entry.fill && stagedFixed.some(c=>c.i === entry.fill.i))
          .map(entry=>entry.fill.i)
      );
      fixedCands = fixedCands.filter(c=>!stagedIdxs.has(c.i));
    }

    let stagedBreakables = dayCands.filter(c=>
      c && c.h && c.h.breakable && stagedBreakHids.has(c.h.hid)
    );
    stagedBreakables = reorderAgendaItemsByOrderConstraints(stagedBreakables,state.dayBase);
    for(const c of stagedBreakables){
      // Do not jump over a same-day predecessor that could not be placed.
      const predecessors = dayEdges.filter(e=>e.afterHid === c.h.hid && byHid.has(e.beforeHid));
      const ready = predecessors.every(edge=>
        state.fills.some(entry=>entry && entry.fill && entry.fill.h
          && entry.fill.h.hid === edge.beforeHid)
      );
      if(!ready)continue;
      const left = typeof breakableMinutesLeft === 'function'
        ? breakableMinutesLeft(c.h,c.i,c.h.type === 'task' ? dayStates : state)
        : clampDuration(c.h.durationMinutes);
      const availableLeft = Math.max(0,left - (c.h.type === 'task' ? futureBreakableMinutesFor(c) : 0));
      if(availableLeft <= 0)continue;
      const beforeCount = state.fills.length;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      if(placeBreakableSessions(state,fill,{
        settings,
        allowNetwork:true,
        remainingMinutes:availableLeft
      })){
        recordBreakableAdds(state,c,beforeCount);
      }
    }

    if(!fixedCands.length)continue;
    // A movable candidate is only "deferrable" from this day when another
    // eligible day can still take it without breaching its own breakables —
    // otherwise forcing deferral would drop the item entirely. The reservation
    // constraint below applies solely to deferrable movables, so a plan-by item
    // whose only viable day is this busy one still places here.
    const deferrable = collectDeferrable(state,fixedCands);
    let unprovenLeft = 1;
    for(let later = dayOffset + 1;later < dayStates.length;later += 1){
      if(!provenDays.has(dateKey(dayStates[later].dayBase))
        && refinementDayMayNeedFixedSolve(dayStates[later],candidates,oneShotPlaced)){
        unprovenLeft += 1;
      }
    }
    const solveMs = solveOptions.refine
      ? (typeof refineUnprovenSolveTimeoutMs === 'function'
        ? refineUnprovenSolveTimeoutMs(budgetLeft,unprovenLeft)
        : Math.min(
            Number(solveOptions.refineBudgetMs) > 0
              ? Number(solveOptions.refineBudgetMs)
              : AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS,
            budgetLeft
          ))
      : daySolveTimeoutMs(dayOffset,budgetLeft,dayWeights.slice(dayOffset));
    let chosen = null;
    let usedHeuristic = false;
    let spent = 0;
    // Far days still enter GLPK while budget remains; structural dayOffset>=3
    // cutoff was reverted — it skipped exact packing for scarce far-day windows.
    // Replay only when this request asked to reuse, or day0Only copied memo
    // days. tickReplan alone raises the GLPK cap for an imminent row; it must
    // not freeze tomorrow when unfinished morning work reopened the week.
    const canReuseIncumbent = !solveOptions.refine
      && (solveOptions.day0Only || solveOptions.reuseIncumbent);
    if(canReuseIncumbent){
      const replayed = replayPriorFixedChoices(
        state,fixedCands,solveOptions.priorPlacements,deferrable
      );
      if(replayed && replayed.length){
        daySolves.push({
          dayKey:dateKey(state.dayBase),phase:'fixed-pack',status:'reused',
          elapsedMs:0,...(replayed.solveDiagnostics || {})
        });
        recordFixedChoices(state,replayed);
        plannerSolveStatus = combinedPlannerSolveStatus(
          plannerSolveStatus,solveOptions.incumbentSolveStatus || 'feasible'
        );
        continue;
      }
    }
    if(budgetLeft < AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS
      || (solveOptions.refine && solveMs < AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS)){
      usedHeuristic = true;
    }else{
      const refineNativeCapSeconds = unprovenLeft <= 1 ? 50 : 30;
      const solveStarted = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      try{
        chosen = await withTimeout(
          packDayWithOptimizer(state,fixedCands,candidates,deferrable,{
            ...solveOptions,dayStates,solveBudgetMs:solveMs,requiredOccurrenceIndices,
            refineNativeCapSeconds
          }),
          solveMs
        );
      }catch(err){
        console.warn('[agenda-optimizer] day solve timed out — using fast pack for this day:',err && err.message || err);
        chosen = null;
        usedHeuristic = true;
      }
      spent = Math.max(0,((typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now()) - solveStarted);
      budgetLeft = Math.max(0,budgetLeft - spent);
    }
    if(!chosen){
      plannerSolveStatus = 'fallback';
      daySolves.push({
        dayKey:dateKey(state.dayBase),phase:'fixed-pack',status:'fallback',
        candidateCount:fixedCands.length,elapsedMs:Math.round(spent),
        reason:usedHeuristic ? 'time-budget' : 'no-usable-incumbent'
      });
      if(!usedHeuristic){
        console.warn('[agenda-optimizer] day solve infeasible — using fast pack for this day');
      }
      const heuristicChosen = packDayWithHeuristic(
        state,fixedCands,candidates,dayStates,{requiredOccurrenceIndices}
      );
      for(const {fill} of heuristicChosen){
        total += 1;
        const c = candidates.find(x=>x.i === fill.i);
        if(c && c.h && c.h.type === 'task')oneShotPlaced.add(c.i);
        if(c && c.h && c.h.type !== 'task'
          && Number.isFinite(Number(c.h.target))){
          virtualLogs.set(c.i,state.dayBase);
        }
      }
      continue;
    }
    daySolves.push({
      dayKey:dateKey(state.dayBase),phase:'fixed-pack',status:chosen.solveStatus || 'feasible',
      elapsedMs:Math.round(spent),...(chosen.solveDiagnostics || {})
    });
    if(chosen.solveStatus === 'feasible' && plannerSolveStatus === 'optimal'){
      plannerSolveStatus = 'feasible';
    }
    recordFixedChoices(state,chosen);
  }
  // A bounded recovery pass catches a fixed item whose only usable start became
  // visible after the ILP commits. It runs before flexible work consumes gaps.
  if(typeof rescueLeftoverWeekFits === 'function'){
    total += rescueLeftoverWeekFits(
      candidates.filter(c=>c && c.h && !c.h.breakable),
      dayStates,
      settings,
      {allCandidates:candidates}
    );
  }

  // Leftover: tasks keep a cross-day adaptive pool; rhythm breakables fill
  // remaining gaps on each eligible day with that day's budget.
  const registry = dayStates[0] ? dayStates[0].registry
    : (typeof normalizeLocationRegistry === 'function'
      ? normalizeLocationRegistry(settings.locations) : []);
  const mode = dayStates[0] ? dayStates[0].mode
    : (typeof normalizeTravelMode === 'function'
      ? normalizeTravelMode(settings.defaultTravelMode) : 'walk');
  const weights = typeof resolveAgendaScoreWeights === 'function'
    ? resolveAgendaScoreWeights(settings) : null;
  const todayBase = dayStates[0] ? dayStates[0].dayBase
    : (typeof dayStart === 'function' ? dayStart(Date.now()) : Date.now());
  let breakableCandidates = candidates
    .filter(c=>c && c.h && c.h.breakable)
    .sort((a,b)=>optimizerWeight(b) - optimizerWeight(a));
  for(const state of dayStates){
    breakableCandidates = reorderAgendaItemsByOrderConstraints(
      breakableCandidates,
      state.dayBase
    );
  }
  for(const c of breakableCandidates){
    if(!c || !c.h || !c.h.breakable)continue;
    if(c.h.type === 'task' && typeof placeBreakableAcrossWeek === 'function'){
      total += placeBreakableAcrossWeek(c,dayStates,settings,null,{
        todayBase,registry,mode,weights,candidates,pinned:c.pinned === true,
        preplannedMinutes:futureBreakableMinutesFor(c)
      });
      continue;
    }
    if(typeof isBreakableRhythmHabit === 'function' && isBreakableRhythmHabit(c.h)
      && typeof placeBreakableSessions === 'function'){
      let vLog = virtualLogs.has(c.i) ? virtualLogs.get(c.i) : c.h.lastLog;
      let rhythmPlacementCount = 0;
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(c.pinned && !state.isTodayDay)continue;
        if(state.placed.has(c.i)){
          vLog = state.dayBase;
          rhythmPlacementCount += 1;
          continue;
        }
        // c.eligible already accounts for today's partial breakable budget.
        // Only apply rhythm spacing after this optimizer pass has placed a
        // session; otherwise a new partial log makes lastLog=today and wrongly
        // removes the rest of today's budget from the agenda.
        if(rhythmPlacementCount > 0 && vLog != null && typeof rhythmEligibleOnDay === 'function'){
          const spaced = rhythmEligibleOnDay(c.h,vLog,state.dayBase,state.weekday,rhythmPlacementCount);
          const afterLast = state.dayBase > (typeof dayStart === 'function' ? dayStart(vLog) : vLog);
          const linkExtra = afterLast && typeof keepupAllowsLinkExtraOnDay === 'function'
            && keepupAllowsLinkExtraOnDay(c.h,state.dayBase,candidates);
          if(!spaced && !linkExtra)continue;
        }
        const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
        const before = state.fills.length;
        if(!placeBreakableSessions(state,fill,{settings,weights,allowNetwork:true}))continue;
        const added = state.fills.slice(before);
        for(const entry of added){
          state.day.agendaItems.push({
            h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:entry.fit.locId,
            chunkMinutes:entry.fit.durMin,
            chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
          });
          total += 1;
        }
        vLog = state.dayBase;
        virtualLogs.set(c.i,state.dayBase);
        rhythmPlacementCount += 1;
      }
    }
  }
  // Week-holistic hours repair: move can-wait items off short daily breakables.
  if(typeof repairWeekPlacedHours === 'function'){
    total += repairWeekPlacedHours(candidates,dayStates,settings,{
      deep:Boolean(solveOptions.refine),
      maxContiguityTrials:solveOptions.refine ? 28 : 0,
      maxContiguityVictims:3
    });
  }
  if(typeof pullStrictDueMovablesForward === 'function'){
    pullStrictDueMovablesForward(candidates,dayStates,settings);
  }
  if(typeof enforcePersistentLinkInvariants === 'function'){
    enforcePersistentLinkInvariants(dayStates,candidates,settings);
  }
  // Route/hours/link repair can expose a usable gap after the first rescue.
  if(typeof rescueDailyGapFits === 'function'){
    total += rescueDailyGapFits(candidates,dayStates,settings);
  }
  if(typeof enforcePersistentLinkInvariants === 'function'){
    enforcePersistentLinkInvariants(dayStates,candidates,settings);
  }
  return {ok:total >= 0,plannerSolveStatus,daySolves};
}

let _plannerWeekDayMemo = {dirtyKey:'',todayBase:0,days:null};

async function buildWeekAgendaAsync(data,settings,numDays = 7,opts = {}){
  // Always able to fall back to the sync scarcity heuristic.
  if(!settings || !settings.agendaOptimizer
    || (typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())){
    return buildWeekAgenda(data,settings,numDays,opts);
  }
  if(typeof beginPlannerSolveCaches === 'function')beginPlannerSolveCaches(data);
  if(typeof plannerPerfResetTryPlace === 'function')plannerPerfResetTryPlace();
  plannerPerfMark('planner-exact-start');
  try{
  plannerPerfMark('planner-glpk-warm-start');
  try{
    await withTimeout(ensureGlpk(),AGENDA_OPTIMIZER_LOAD_TIMEOUT_MS);
  }catch(err){
    // Silent fallback — the fast planner still builds a usable week.
    console.warn('[agenda-optimizer] GLPK unavailable:',err && err.message || err);
    return buildWeekAgenda(data,settings,numDays,opts);
  }
  plannerPerfMark('planner-glpk-warm-end');

  const dirtyKey = opts.dirtyKey || '';
  const todayBase = dayStart(Date.now());
  if(opts.day0Only && Array.isArray(opts.memoDays) && opts.memoDays.length){
    const memoToday = Number(opts.memoDays[0] && opts.memoDays[0].dayBase);
    if(memoToday === todayBase){
      _plannerWeekDayMemo = {
        dirtyKey,
        todayBase,
        days:opts.memoDays
      };
      if(typeof rehydrateAgendaWeekHabits === 'function'){
        rehydrateAgendaWeekHabits({days:_plannerWeekDayMemo.days},data);
      }
    }
  }
  const reuseFarDays = Boolean(
    opts.day0Only
    && dirtyKey
    && _plannerWeekDayMemo.dirtyKey === dirtyKey
    && _plannerWeekDayMemo.todayBase === todayBase
    && Array.isArray(_plannerWeekDayMemo.days)
    && _plannerWeekDayMemo.days.length
  );
  if((!Array.isArray(opts.priorPlacements) || !opts.priorPlacements.length)
    && reuseFarDays){
    opts = {
      ...opts,
      priorPlacements:typeof agendaPriorPlacementsFromWeek === 'function'
        ? agendaPriorPlacementsFromWeek({days:_plannerWeekDayMemo.days})
        : agendaPriorPlacementsFromTimeline(
          _plannerWeekDayMemo.days[0] && _plannerWeekDayMemo.days[0].timeline,
          _plannerWeekDayMemo.days[0] && _plannerWeekDayMemo.days[0].dayBase
        )
    };
  }

  const count = Math.max(1,Math.min(14,Math.round(numDays) || 7));
  const days = [];
  for(let offset = 0;offset < count;offset += 1){
    const dayBase = todayBase + offset * 86400000;
    days.push(buildDayAgenda(data,settings,dayBase,{weekMode:true}));
  }
  const dayStates = days.map(day=>createDayPlacementState(day,settings,{
    dayBase:day.dayBase,
    weekday:day.weekday,
    weekMode:true
  }));

  const candidates = [];
  const seen = new Set();
  for(let i = 0;i < data.length;i += 1){
    if(seen.has(i))continue;
    const h = data[i];
    if(h.type === 'task' && h.eventTime !== null)continue;
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
      : (typeof normalizeScheduleLinks === 'function'
        && normalizeScheduleLinks(h.scheduleLinks,h.hid).some(l=>l && l.requireSameDay));
    const isSameDayAnchor = data.some(other=>{
      if(!other || other === h)return false;
      const links = typeof sameDayScheduleLinks === 'function'
        ? sameDayScheduleLinks(other)
        : (typeof normalizeScheduleLinks === 'function'
          ? normalizeScheduleLinks(other.scheduleLinks,other.hid).filter(l=>l && l.requireSameDay)
          : []);
      return links.some(l=>l && l.anchorHid === h.hid);
    });
    if(!eligible.size && !hasSameDayLinks && !isSameDayAnchor)continue;
    seen.add(i);
    candidates.push({
      h,i,pinned,
      priority:effectivePriority(h),
      score:attentionScore(h,i,settings),
      urgency:pinned ? Math.max(200,weekUrgency(h)) : weekUrgency(h),
      eligible
    });
  }
  if(typeof applyPersistentLinkEligibility === 'function'){
    applyPersistentLinkEligibility(candidates,dayStates,settings);
  }
  if(typeof applyClusterFlexEligibility === 'function'){
    applyClusterFlexEligibility(candidates,dayStates,settings);
  }
  for(let i = candidates.length - 1;i >= 0;i -= 1){
    const h = candidates[i] && candidates[i].h;
    const snoozed = h && h.snoozedUntil && Date.now() < h.snoozedUntil;
    if(snoozed || !candidates[i].eligible || !candidates[i].eligible.size)candidates.splice(i,1);
  }
  const memoFutureBreakableMinutes = {};
  if(reuseFarDays){
    const todayMemoCounts = new Map();
    const futureMemoCounts = new Map();
    const addCount = (map,row)=>{
      if(!row || row.kind !== 'fill' || row.i == null)return;
      map.set(row.i,(map.get(row.i) || 0) + 1);
    };
    for(const row of _plannerWeekDayMemo.days[0] && _plannerWeekDayMemo.days[0].timeline || []){
      addCount(todayMemoCounts,row);
    }
    for(const day of _plannerWeekDayMemo.days.slice(1)){
      for(const row of day && day.timeline || []){
        addCount(futureMemoCounts,row);
        if(row && row.kind === 'fill' && row.i != null){
          const h = data[row.i];
          if(h && h.type === 'task' && h.breakable){
            memoFutureBreakableMinutes[row.i] = (memoFutureBreakableMinutes[row.i] || 0)
              + Math.max(0,(Number(row.end) - Number(row.start)) / 60000);
          }
        }
      }
    }
    // Later memo days are commitments during a today-only refresh. A one-shot
    // or sparse occurrence that was intentionally assigned later must not be
    // selected a second time today when the old today packing cannot replay.
    for(let i = candidates.length - 1;i >= 0;i -= 1){
      const c = candidates[i];
      if((todayMemoCounts.get(c.i) || 0) > 0 || !(futureMemoCounts.get(c.i) > 0))continue;
      if(typeof isDayChoosingWeekCandidate === 'function' && isDayChoosingWeekCandidate(c)){
        candidates.splice(i,1);
      }
    }
  }
  for(const c of candidates)c.scarcity = scarcityScore(c,dayStates);

  const solveStates = reuseFarDays ? dayStates.slice(0,1) : dayStates;
  plannerPerfMark('planner-exact-solve-start');
  const solveStarted = (typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now();
  const solveSummary = await assignWeekCandidatesOptimized(
    candidates,solveStates,settings,{...opts,memoFutureBreakableMinutes}
  );
  const solveDurationMs = Math.max(0,((typeof performance !== 'undefined' && performance.now)
    ? performance.now() : Date.now()) - solveStarted);
  plannerPerfMark('planner-exact-solve-end');
  if(!solveSummary || !solveSummary.ok){
    // Packing timed out or a day was infeasible — use the fast planner quietly.
    // The "unavailable" toast is reserved for GLPK failing to load.
    return buildWeekAgenda(data,settings,numDays,opts);
  }
  const additionalOpts = reuseFarDays ? {
    horizonDays:dayStates.length,
    horizonStart:dayStates[0] && dayStates[0].dayBase,
    horizonEnd:dayStates[dayStates.length - 1] && (dayStates[dayStates.length - 1].dayBase + 86400000),
    extraPlannedFor:c=>{
      const memoDays = _plannerWeekDayMemo && Array.isArray(_plannerWeekDayMemo.days)
        ? _plannerWeekDayMemo.days : [];
      return memoDays.slice(1).reduce((sum,day)=>sum + (day.timeline || []).filter(row=>
        row && row.kind === 'fill' && row.i === c.i && row.chunkMinutes == null
      ).length,0);
    }
  } : null;
  placeAdditionalSameDayOccurrences(candidates,solveStates,settings,additionalOpts);
  annotateAgendaOccurrenceKeys(candidates,solveStates);

  let totalTravelSeconds = 0;
  for(let d = 0;d < days.length;d += 1){
    const day = days[d];
    if(reuseFarDays && d > 0){
      const memoDay = _plannerWeekDayMemo.days[d];
      if(memoDay){
        day.timeline = memoDay.timeline;
        day.agendaItems = memoDay.agendaItems || [];
        day.usedMinutes = memoDay.usedMinutes;
        day.remainingMinutes = memoDay.remainingMinutes;
        day.travelSeconds = memoDay.travelSeconds || 0;
        totalTravelSeconds += day.travelSeconds;
        continue;
      }
    }
    const state = dayStates[d];
    day.timeline = finalizePlacementRows(state);
    day.usedMinutes = state.usedMinutes;
    day.remainingMinutes = Math.max(0,(Number(day.totalMinutes) || 0) - state.usedMinutes);
    day.travelSeconds = day.timeline.filter(r=>r.kind === 'travel').reduce((s,r)=>s + (r.seconds || 0),0);
    totalTravelSeconds += day.travelSeconds;
  }
  const plannerSolveStatus = reuseFarDays
    ? combinedPlannerSolveStatus(
        solveSummary.plannerSolveStatus || 'feasible',
        opts.incumbentSolveStatus || 'feasible'
      )
    : (solveSummary.plannerSolveStatus || 'feasible');
  const week = {
    days,totalTravelSeconds,candidateCount:candidates.length,optimized:true,
    plannerSolveStatus,
    refined:Boolean(opts.refine),
    plannerDiagnostics:{
      solveDurationMs:Math.round(solveDurationMs),
      requestedRefinement:Boolean(opts.refine),
      refinePass:Math.max(0,Math.round(Number(opts.refinePass) || 0)),
      daySolves:solveSummary.daySolves || []
    }
  };
  if(dirtyKey){
    _plannerWeekDayMemo = {
      dirtyKey,
      todayBase,
      days:days.map(day=>({
        dayBase:day.dayBase,
        timeline:day.timeline,
        agendaItems:day.agendaItems,
        usedMinutes:day.usedMinutes,
        remainingMinutes:day.remainingMinutes,
        travelSeconds:day.travelSeconds
      }))
    };
  }
  plannerPerfMark('planner-exact-end');
  if(typeof plannerPerfDump === 'function')plannerPerfDump('exact');
  return week;
  }finally{
    if(typeof endPlannerSolveCaches === 'function')endPlannerSolveCaches();
  }
}
