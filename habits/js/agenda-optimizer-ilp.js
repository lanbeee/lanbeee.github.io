
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
  // Flexibility tie-break (caps at 5, well under the priority/urgency/scarcity
  // bands): among otherwise-equal candidates the lower-flex habit wins, since a
  // stricter rhythm leaves less slack. Pure tie-break — never overrides a real
  // priority, scarcity, or urgency gap.
  const flex = Math.max(0,Math.min(60,parseInt(c && c.h && c.h.flexibilityDays,10) || 0));
  const flexTiebreak = Math.min(5,flex * 0.5);
  // Hard-window tightness outranks ordinary priority; pinned and urgent items
  // still receive explicit value rather than depending on source array order.
  return 100 + pinnedBonus + criticalOccurrenceBonus + scarceBonus
    + (5 - Math.min(5,Math.max(0,pri))) * 5
    + urgencyBonus
    - flexTiebreak;
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
      const anchors = [slot.start,state.startClock,...windowEdges]
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
    // ASAP scoring keeps only the earliest 16 fits — that erases afternoon
    // pack-before-Juma options before GLPK can prefer them. Pin fits that end
    // near a direct successor window so right-after stays in the solver.
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
    const isPinnedAbut = (fit)=>{
      if(!fit)return false;
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
    const pinned = fits.filter(isPinnedAbut)
      .sort((a,b)=>(a.score || 0) - (b.score || 0) || a.placeStart - b.placeStart);
    const rest = fits.filter(f=>!isPinnedAbut(f))
      .sort((a,b)=>(a.score || 0) - (b.score || 0) || a.placeStart - b.placeStart);
    const out = [];
    const outSeen = new Set();
    for(const fit of pinned.concat(rest)){
      const key = `${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
      if(outSeen.has(key))continue;
      outSeen.add(key);
      out.push(fit);
      // Always keep every pinned abut; fill remaining slots from ASAP rest.
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
      && isMovableWeekCandidate(c)
      && !(c.h && c.h.hid && directOrderLinkedHids.has(c.h.hid))
      && typeof placementFitsOutsideReservations === 'function'){
      const outside = placementFitsOutsideReservations(state,fill,reservationWindows);
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
      }
    }
    const baseWeight = optimizerWeight(c) + orderBoostForCandidate(c,state.dayBase);
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
          - Math.min(1440,delayMin) * 0.001
          - boundedFitScore * 0.01,
        movable:typeof isMovableWeekCandidate === 'function' && isMovableWeekCandidate(c)};
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

  applyDirectOrderGapWeights(opts,state.dayBase);
  applyPlacedOrderWeights(opts,state);
  applyEarlyBeforeWeights(opts,state);

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
      || (typeof mustPlaceCriticalOccurrence === 'function'
        && mustPlaceCriticalOccurrence(candidate))
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
  // penalty is soft and capped below the minimum placement weight (~100), so it
  // only reorders — it can never drop a placeable task, and hard windows/pins
  // (structural constraints) still win. Per the documented lex order this is
  // MINIMUM TRAVEL outranking ASAP/PRIORITY, which is exactly "travel time IS
  // time — extra trips are unacceptable."
  // Today's start place — pin, geofence, lastKnown seed, or closest saved
  // place when the seed is the ephemeral GPS coordinate. Future days keep
  // null so the committed-route DP is not perturbed. Requiring liveLocationId
  // (pin/geofence only) was the production miss: lastKnown=Walmart still
  // drew "travel to Home" while GLPK sent the user home first, then back.
  const seedLoc = (typeof todaySequencingLocationId === 'function'
    ? todaySequencingLocationId(state)
    : ((state.liveLocId && state.seedLocId === state.liveLocId)
      ? state.seedLocId : null)) || null;
  if(seedLoc && typeof travelEdgeBetweenIds === 'function'){
    const TRAVEL_PAIR_COEF = 0.01;   // 1s of saved commute ≈ 0.01 objective weight
    const TRAVEL_PAIR_CAP = 80;      // < min baseWeight (~100): reorder only
    const TRAVEL_PAIR_FLOOR = 12;    // still decisive over priority/ASAP deltas
    let tpIdx = 0;
    // A null fit.locId is the anchor-preserving "anywhere" option, but when the
    // habit HAS allowed locations the reconciled route still lands it at its
    // preferred place (e.g. Lunch→Home). Such options must not escape the
    // away-and-back penalty — that was the Walmart miss: GLPK picked the
    // higher-weight null options for Lunch/Quran, paid zero travel-pair
    // penalty, and the route painted Home→Walmart→Home anyway. Resolve null
    // to the habit's preferred allowed place (the same reconciliation
    // scheduled rows use); truly location-free habits stay null (anywhere
    // includes the seed, so they are not provably away).
    const awayLocForOption = (o) => {
      if(!o || !o.fit)return null;
      if(o.fit.locId)return o.fit.locId;
      const h = o.c && o.c.h;
      if(!h || !Array.isArray(h.locationIds) || !h.locationIds.length)return null;
      if(typeof pickHabitLocationId !== 'function')return null;
      const resolved = pickHabitLocationId(h,null,state.registry,state.mode);
      return resolved || null;
    };
    for(let ai = 0; ai < opts.length; ai += 1){
      const A = opts[ai];
      const aLoc = awayLocForOption(A);
      if(!aLoc || aLoc === seedLoc)continue;            // A must be AWAY from seed
      const savedSec = Math.max(0,Number(travelEdgeBetweenIds(
        seedLoc,aLoc,state.registry,state.mode,{allowNetwork:false}
      ).seconds) || 0);
      if(savedSec <= 0)continue;                         // co-located: no away-and-back risk
      const pen = Math.max(TRAVEL_PAIR_FLOOR,
        Math.min(TRAVEL_PAIR_CAP,savedSec * TRAVEL_PAIR_COEF));
      for(let bi = 0; bi < opts.length;bi += 1){
        if(bi === ai)continue;
        const B = opts[bi];
        const bLoc = B && B.fit && B.fit.locId;
        if(!bLoc || bLoc !== seedLoc)continue;           // B must be AT-SEED
        if(A.c.i === B.c.i)continue;                     // different candidates
        if(!(A.fit.placeStart < B.fit.placeStart))continue; // A scheduled before B
        const z = `tp_${tpIdx++}`;
        binaries.push(z);
        vars.push({name:z,coef:-pen});
        subjectTo.push({
          name:`${z}_ubA`,
          vars:[{name:z,coef:1},{name:A.varName,coef:-1}],
          bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
        });
        subjectTo.push({
          name:`${z}_ubB`,
          vars:[{name:z,coef:1},{name:B.varName,coef:-1}],
          bnds:{type:GLPK.GLP_UP,ub:0,lb:0}
        });
        subjectTo.push({
          name:`${z}_lb`,
          vars:[{name:z,coef:1},{name:A.varName,coef:-1},{name:B.varName,coef:-1}],
          bnds:{type:GLPK.GLP_LO,ub:0,lb:-1}
        });
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
  const nativeLimitSeconds = solveOptions.refine
    ? Math.max(4,Math.min(30,Math.floor(((Number(solveOptions.solveBudgetMs)
      || Number(solveOptions.refineBudgetMs)
      || AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS) - 750) / 1000)))
    : 4;
  const result = GLPK.solve(problem,{
    msglev:GLPK.GLP_MSG_OFF,
    presol:true,
    tmlim:nativeLimitSeconds
  });
  // glpk.js may return a Promise or a sync result depending on build.
  return {result,opts};
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
  const {result:raw,opts} = packed;
  const result = await resolveSolve(raw);
  const status = result && result.result && result.result.status;
  // GLP_OPT=5, GLP_FEAS=2. A time-limited incumbent is safe to publish because
  // critical one-day/daily P0 occurrences are hard rows above. Retaining it is
  // preferable to replacing the whole day with a greedy chain; the latter can
  // consume Juma's only weekly window while arranging flexible predecessors.
  if(status !== 5 && status !== 2)return null;
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
  return chosen;
}

// Scarcity-order placement for one day when ILP times out or is infeasible.
// Keeps the rest of the week on the optimizer path instead of aborting entirely.
// Honours the same can-wait / packed-priority deferral as the ILP reserve.
function packDayWithHeuristic(state,dayCandidates,allCandidates,dayStates){
  if(typeof tryPlaceOnDay !== 'function' || typeof commitPlacement !== 'function')return [];
  const doing = doingNowForDay(state);
  const seqLoc = typeof todaySequencingLocationId === 'function'
    ? todaySequencingLocationId(state) : null;
  const byWeight = orderAwareOptimizerSort(state.dayBase);
  const ordered = dayCandidates.slice().sort((a,b)=>{
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
    if(typeof fastPathDefersMovable === 'function'
      && fastPathDefersMovable(c,state,pool,states))continue;
    let fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const placeOpts = {
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
    ? Math.max(5000,Math.min(
        AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS,
        Number(solveOptions.refineBudgetMs) || AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS
      ))
    : AGENDA_OPTIMIZER_WEEK_SOLVE_BUDGET_MS;
  let plannerSolveStatus = 'optimal';
  const dayWeights = dayStates.map((_,offset)=>daySolveWeight(offset));

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
        if(left <= 0)continue;
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
    let fixedCands = dayCands.filter(c=>!(c.h && c.h.breakable));
    if(!fixedCands.length)continue;

    // GLPK deliberately solves fixed-duration work first and normally fills
    // breakables afterward. A drag chain such as A → breakable X → B needs a
    // small staged pass instead: place fixed ancestors, fill X, then let GLPK
    // solve B and the rest around those committed chunks.
    const dayEdges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
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
              ...solveOptions,solveBudgetMs:earlyMs
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
        earlyChosen = packDayWithHeuristic(state,stagedFixed,candidates,dayStates);
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
      if(left <= 0)continue;
      const beforeCount = state.fills.length;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      if(placeBreakableSessions(state,fill,{
        settings,
        allowNetwork:true,
        remainingMinutes:left
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
    const deferrable = new Set();
    if(typeof isMovableWeekCandidate === 'function'
      && typeof movableCapacityForDay === 'function'){
      for(const c of fixedCands){
        if(!isMovableWeekCandidate(c))continue;
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
    }
    const solveMs = solveOptions.refine
      ? Math.max(5000,Math.min(
          AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS,
          Number(solveOptions.refineBudgetMs) || AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS,
          budgetLeft
        ))
      : daySolveTimeoutMs(dayOffset,budgetLeft,dayWeights.slice(dayOffset));
    let chosen = null;
    let usedHeuristic = false;
    // Far days still enter GLPK while budget remains; structural dayOffset>=3
    // cutoff was reverted — it skipped exact packing for scarce far-day windows.
    if(budgetLeft < AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS){
      usedHeuristic = true;
    }else{
      const solveStarted = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      try{
        chosen = await withTimeout(
          packDayWithOptimizer(state,fixedCands,candidates,deferrable,{
            ...solveOptions,solveBudgetMs:solveMs
          }),
          solveMs
        );
      }catch(err){
        console.warn('[agenda-optimizer] day solve timed out — using fast pack for this day:',err && err.message || err);
        chosen = null;
        usedHeuristic = true;
      }
      const spent = Math.max(0,((typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now()) - solveStarted);
      budgetLeft = Math.max(0,budgetLeft - spent);
    }
    if(!chosen){
      plannerSolveStatus = 'fallback';
      if(!usedHeuristic){
        console.warn('[agenda-optimizer] day solve infeasible — using fast pack for this day');
      }
      const heuristicChosen = packDayWithHeuristic(state,fixedCands,candidates,dayStates);
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
        todayBase,registry,mode,weights,candidates,pinned:c.pinned === true
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
  return {ok:total >= 0,plannerSolveStatus};
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
  const reuseFarDays = Boolean(
    opts.day0Only
    && dirtyKey
    && _plannerWeekDayMemo.dirtyKey === dirtyKey
    && _plannerWeekDayMemo.todayBase === todayBase
    && Array.isArray(_plannerWeekDayMemo.days)
    && _plannerWeekDayMemo.days.length
  );

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
    if(!candidates[i].eligible || !candidates[i].eligible.size)candidates.splice(i,1);
  }
  for(const c of candidates)c.scarcity = scarcityScore(c,dayStates);

  const solveStates = reuseFarDays ? dayStates.slice(0,1) : dayStates;
  plannerPerfMark('planner-exact-solve-start');
  const solveSummary = await assignWeekCandidatesOptimized(
    candidates,solveStates,settings,opts
  );
  plannerPerfMark('planner-exact-solve-end');
  if(!solveSummary || !solveSummary.ok){
    // Packing timed out or a day was infeasible — use the fast planner quietly.
    // The "unavailable" toast is reserved for GLPK failing to load.
    return buildWeekAgenda(data,settings,numDays,opts);
  }

  let totalTravelSeconds = 0;
  for(let d = 0;d < days.length;d += 1){
    const day = days[d];
    if(reuseFarDays && d > 0){
      const memoDay = _plannerWeekDayMemo.days[d];
      if(memoDay){
        day.timeline = memoDay.timeline;
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
  const week = {
    days,totalTravelSeconds,candidateCount:candidates.length,optimized:true,
    plannerSolveStatus:solveSummary.plannerSolveStatus || 'feasible',
    refined:Boolean(opts.refine)
  };
  if(dirtyKey){
    _plannerWeekDayMemo = {
      dirtyKey,
      todayBase,
      days:days.map(day=>({
        timeline:day.timeline,
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
