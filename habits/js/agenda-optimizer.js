// Exact agenda packer (ILP via GLPK). It is the default week-planning path and
// lazy-loads on demand; the scarcity heuristic in today-view.js is the explicit
// off-mode and the timeout/error fallback.
//
// Lex objective across the week (hours first, then soft score):
//   1. HARD CONSTRAINTS — capacity, blocks, windows, pinned items
//   2. MAXIMIZE PLACED HOURS / doability (week-holistic repair)
//   3. MIN TRAVEL / cluster
//   4. ASAP / HIGH-PRIORITY
//   5. PREFERENCES
//
// Per day: enumerate feasible start options via tryPlaceOnDay, then solve a
// set-packing ILP that maximizes weighted placements subject to no overlaps and
// the day's capacity. Fixed-duration work is packed first; breakable work then
// fills the remaining gaps continuous-first. A week-level repair pass then
// peels can-wait movables off short daily breakables so total hours rise.
// This keeps a broad work window from winning one large binary choice and
// erasing a narrow habit inside that window.

// Cold WASM/worker bring-up can exceed a tight budget on first open.
const AGENDA_OPTIMIZER_LOAD_TIMEOUT_MS = 12000;
// Shared week solve budget. Near days take a larger share; unused time rolls
// forward. Far days still get a small floor so they can try GLPK briefly.
const AGENDA_OPTIMIZER_WEEK_SOLVE_BUDGET_MS = 12000;
const AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS = 600;
const AGENDA_OPTIMIZER_DAY_SOLVE_MAX_MS = 4500;
let _glpkPromise = null;
let _glpkInstance = null;

function preloadAgendaOptimizer(){
  return ensureGlpk().catch(()=>null);
}

function glpkCandidateUrls(){
  const urls = [];
  try{
    const el = document.querySelector('script[src*="agenda-optimizer.js"]');
    if(el && el.src)urls.push(new URL('../lib/js/glpk.mjs',el.src).href);
  }catch(_){}
  try{ urls.push(new URL('./lib/js/glpk.mjs',location.href).href); }catch(_){}
  // De-dupe while preserving order.
  return urls.filter((url,i)=>url && urls.indexOf(url) === i);
}

function ensureGlpk(){
  if(_glpkInstance)return Promise.resolve(_glpkInstance);
  if(_glpkPromise)return _glpkPromise;
  _glpkPromise = (async ()=>{
    let lastErr = null;
    for(const url of glpkCandidateUrls()){
      try{
        const mod = await import(url);
        const GLPK = await (mod.default || mod)();
        if(!GLPK || typeof GLPK.solve !== 'function'){
          throw new Error('GLPK module missing solve()');
        }
        _glpkInstance = GLPK;
        return GLPK;
      }catch(err){
        lastErr = err;
        console.warn('[agenda-optimizer] GLPK load failed for',url,err && err.message || err);
      }
    }
    _glpkPromise = null;
    throw lastErr || new Error('GLPK unavailable');
  })();
  return _glpkPromise;
}

function withTimeout(promise,ms){
  return new Promise((resolve,reject)=>{
    const t = setTimeout(()=>reject(new Error('agenda optimizer timed out')),ms);
    promise.then(
      v=>{ clearTimeout(t); resolve(v); },
      e=>{ clearTimeout(t); reject(e); }
    );
  });
}

// Today/tomorrow keep most of the remaining week budget; later offsets decay.
function daySolveWeight(dayOffset){
  return Math.pow(0.7,Math.max(0,dayOffset));
}

function daySolveTimeoutMs(dayOffset,budgetLeft,weightsFromHere){
  const weightSum = weightsFromHere.reduce((sum,w)=>sum + w,0) || 1;
  const share = budgetLeft * (daySolveWeight(dayOffset) / weightSum);
  return Math.max(
    AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS,
    Math.min(AGENDA_OPTIMIZER_DAY_SOLVE_MAX_MS,Math.round(share))
  );
}

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
  // Hard-window tightness outranks ordinary priority; pinned and urgent items
  // still receive explicit value rather than depending on source array order.
  return 100 + pinnedBonus + scarceBonus
    + (5 - Math.min(5,Math.max(0,pri))) * 5
    + urgencyBonus;
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
  const beforeHids = new Set(plannerOrderConstraintsForDay(state.dayBase).map(e=>e.beforeHid));
  if(!beforeHids.size)return;
  const origin = state.startClock || state.dayBase;
  for(const o of opts){
    const hid = o && o.fill && o.fill.h && o.fill.h.hid;
    if(!hid || !beforeHids.has(hid) || !o.fit)continue;
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
      if(bestGap < Infinity)b.weight -= Math.min(120,bestGap) * DIRECT_ORDER_GAP_PENALTY;
    }
  }
}

// A breakable predecessor is committed before the fixed-duration GLPK pass.
// Reward successor options that begin close to its final chunk; pairwise GLPK
// rows cannot express this because the predecessor is no longer a solver var.
function applyPlacedOrderWeights(opts,state){
  if(!opts || !opts.length || !state || typeof plannerOrderConstraintsForDay !== 'function')return;
  const placedEnd = new Map();
  for(const entry of state.fills || []){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(!hid || !entry.fit)continue;
    placedEnd.set(hid,Math.max(placedEnd.get(hid) || 0,Number(entry.fit.placeEnd) || 0));
  }
  if(!placedEnd.size)return;
  for(const edge of plannerOrderConstraintsForDay(state.dayBase)){
    if(edge.adjacency !== 'direct' || !placedEnd.has(edge.beforeHid))continue;
    const end = placedEnd.get(edge.beforeHid);
    for(const o of opts){
      const hid = o && o.fill && o.fill.h && o.fill.h.hid;
      if(hid !== edge.afterHid || !o.fit)continue;
      const gapMin = Math.max(0,(o.fit.placeStart - end) / 60000);
      o.weight -= Math.min(120,gapMin) * DIRECT_ORDER_GAP_PENALTY;
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
  for(const e of edges){
    const beforeIdxs = byHid.get(e.beforeHid) || [];
    const afterIdxs = byHid.get(e.afterHid) || [];
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
    // Temporary order links need staggered starts — otherwise every fill only
    // gets the same ASAP option and pairwise order rows forbid co-selection.
    const orderEdges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
    if(orderEdges.length || doing){
      const step = 30 * 60000;
      const dayEnd = state.dayBase + 86400000;
      let cursor = Math.max(state.startClock, doing && fill && fill.h && fill.h.hid === doing.hid
        ? doing.startedAt : state.startClock);
      let guards = 0;
      while(cursor < dayEnd && guards < 24){
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
    return fits
      .sort((a,b)=>(a.score || 0) - (b.score || 0) || a.placeStart - b.placeStart)
      .slice(0,16);
  };
  return typeof withTravelNetworkPaused === 'function' ? withTravelNetworkPaused(scan) : scan();
}

function fitsOverlap(a,b){
  return a.placeStart < b.placeEnd && b.placeStart < a.placeEnd;
}

// Solve set-packing ILP for one day. Returns array of {fill, fit} or null on failure.
function solveDayPackingIlp(GLPK,state,dayCandidates,allCandidates,deferrable){
  const options = [];
  const doing = doingNowForDay(state);
  // One cheap probe per candidate exposes actual earliest completion
  // boundaries after blocks/startClock (not merely the end of its allowed
  // window). Other candidates can then start immediately after a short item:
  // Fajr 5:35–5:37 creates a 5:37 option for Call Amma even when Fajr itself
  // remains allowed until sunrise at 5:58.
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
    const fits = listPlaceFitsOnDay(state,fill,dayCandidates,candidateBoundaryEdges);
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
      const option = {c,fill,fit,weight:baseWeight - Math.min(1440,delayMin) * 0.001,
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
  if(options.length > MAX_OPTS){
    const groups = new Map();
    for(const option of options){
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
    const required = candidate && candidate.h && requiredHids.has(candidate.h.hid);
    subjectTo.push({
      name:`cand_${i}`,
      vars:names.map(n=>({name:n,coef:1})),
      bnds:required
        ? {type:GLPK.GLP_FX,ub:1,lb:1}
        : {type:GLPK.GLP_UP,ub:1,lb:0}
    });
  }
  let schedulePairRow = 0;
  for(const edge of dayOrderEdges){
    if(!edge.persistent || !edge.requiresPair || !edge.subjectHid || !edge.anchorHid)continue;
    const subjectNames = optionNamesByHid.get(edge.subjectHid) || [];
    if(!subjectNames.length)continue;
    const anchorNames = optionNamesByHid.get(edge.anchorHid) || [];
    const committed = typeof scheduleAnchorCommitForDay === 'function'
      ? scheduleAnchorCommitForDay(edge.anchorHid,state.dayBase) : null;
    if(committed)continue;
    subjectTo.push({
      name:`schedule_pair_${schedulePairRow++}`,
      vars:[
        ...subjectNames.map(name=>({name,coef:1})),
        ...anchorNames.map(name=>({name,coef:-1}))
      ],
      // subject selected implies anchor selected. The independently eligible
      // anchor may still remain when the dependent cannot fit.
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
  // Pairwise non-overlap for overlapping fits (dense but N<=180 and bounded).
  let clash = 0;
  for(let a = 0;a < opts.length;a += 1){
    for(let b = a + 1;b < opts.length;b += 1){
      if(opts[a].c.i === opts[b].c.i)continue;
      if(!fitsOverlap(opts[a].fit,opts[b].fit))continue;
      subjectTo.push({
        name:`ov_${clash++}`,
        vars:[{name:opts[a].varName,coef:1},{name:opts[b].varName,coef:1}],
        bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
      });
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

  const result = GLPK.solve(problem,{msglev:GLPK.GLP_MSG_OFF,presol:true});
  // glpk.js may return a Promise or a sync result depending on build.
  return {result,opts};
}

async function resolveSolve(maybe){
  if(maybe && typeof maybe.then === 'function')return maybe;
  return maybe;
}

async function packDayWithOptimizer(state,dayCandidates,allCandidates,deferrable){
  const GLPK = await ensureGlpk();
  const packed = solveDayPackingIlp(GLPK,state,dayCandidates,allCandidates,deferrable);
  if(Array.isArray(packed) && packed.length === 0)return [];
  const {result:raw,opts} = packed;
  const result = await resolveSolve(raw);
  const status = result && result.result && result.result.status;
  // GLP_OPT=5, GLP_FEAS=2
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
  return chosen;
}

// Scarcity-order placement for one day when ILP times out or is infeasible.
// Keeps the rest of the week on the optimizer path instead of aborting entirely.
// Honours the same can-wait / packed-priority deferral as the ILP reserve.
function packDayWithHeuristic(state,dayCandidates,allCandidates,dayStates){
  if(typeof tryPlaceOnDay !== 'function' || typeof commitPlacement !== 'function')return [];
  const doing = doingNowForDay(state);
  const ordered = dayCandidates.slice().sort(orderAwareOptimizerSort(state.dayBase));
  const pool = Array.isArray(allCandidates) && allCandidates.length ? allCandidates : dayCandidates;
  const states = Array.isArray(dayStates) && dayStates.length ? dayStates : [state];
  const chosen = [];
  for(const c of ordered){
    if(state.placed.has(c.i))continue;
    if(typeof fastPathDefersMovable === 'function'
      && fastPathDefersMovable(c,state,pool,states))continue;
    let fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const placeOpts = {allowNetwork:true};
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

// Assign candidates onto dayStates using per-day ILP packing. Falls back by
// returning false so the caller can run the scarcity heuristic instead.
async function assignWeekCandidatesOptimized(candidates,dayStates,settings){
  for(const c of candidates){
    if(c.scarcity == null && typeof scarcityScore === 'function'){
      c.scarcity = scarcityScore(c,dayStates);
    }
  }
  // Chronological days so rhythm virtual lastLog advances naturally.
  const virtualLogs = new Map();
  const oneShotPlaced = new Set();
  let total = 0;
  let budgetLeft = AGENDA_OPTIMIZER_WEEK_SOLVE_BUDGET_MS;
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
        if(typeof rhythmEligibleOnDay === 'function'
          && !rhythmEligibleOnDay(c.h,vLog,state.dayBase,state.weekday))continue;
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
            packDayWithOptimizer(state,stagedFixed,candidates,new Set()),
            earlyMs
          );
        }catch{ earlyChosen = null; }
      }
      const earlySpent = Math.max(0,((typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now()) - earlyStarted);
      budgetLeft = Math.max(0,budgetLeft - earlySpent);
      if(!earlyChosen){
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
    const solveMs = daySolveTimeoutMs(dayOffset,budgetLeft,dayWeights.slice(dayOffset));
    let chosen = null;
    let usedHeuristic = false;
    if(budgetLeft < AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS){
      usedHeuristic = true;
    }else{
      const solveStarted = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      try{
        chosen = await withTimeout(packDayWithOptimizer(state,fixedCands,candidates,deferrable),solveMs);
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
        if(rhythmPlacementCount > 0 && vLog != null && typeof rhythmEligibleOnDay === 'function'
          && !rhythmEligibleOnDay(c.h,vLog,state.dayBase,state.weekday))continue;
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
    total += repairWeekPlacedHours(candidates,dayStates,settings);
  }
  if(typeof enforcePersistentLinkInvariants === 'function'){
    enforcePersistentLinkInvariants(dayStates,candidates,settings);
  }
  return total >= 0;
}

async function buildWeekAgendaAsync(data,settings,numDays = 7){
  // Always able to fall back to the sync scarcity heuristic.
  if(!settings || !settings.agendaOptimizer){
    return buildWeekAgenda(data,settings,numDays);
  }
  try{
    await withTimeout(ensureGlpk(),AGENDA_OPTIMIZER_LOAD_TIMEOUT_MS);
  }catch(err){
    // Silent fallback — the fast planner still builds a usable week.
    console.warn('[agenda-optimizer] GLPK unavailable:',err && err.message || err);
    return buildWeekAgenda(data,settings,numDays);
  }

  const todayBase = dayStart(Date.now());
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
      if(isWeekCandidate(h,settings,day.dayBase,day.weekday) || (pinned && day.isToday)){
        eligible.add(day.dayBase);
      }
    }
    if(!eligible.size)continue;
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
    applyPersistentLinkEligibility(candidates,dayStates);
  }
  for(const c of candidates)c.scarcity = scarcityScore(c,dayStates);

  const ok = await assignWeekCandidatesOptimized(candidates,dayStates,settings);
  if(!ok){
    // Packing timed out or a day was infeasible — use the fast planner quietly.
    // The "unavailable" toast is reserved for GLPK failing to load.
    return buildWeekAgenda(data,settings,numDays);
  }

  let totalTravelSeconds = 0;
  for(let d = 0;d < days.length;d += 1){
    const state = dayStates[d];
    const day = days[d];
    day.timeline = finalizePlacementRows(state);
    day.usedMinutes = state.usedMinutes;
    day.remainingMinutes = Math.max(0,(Number(day.totalMinutes) || 0) - state.usedMinutes);
    day.travelSeconds = day.timeline.filter(r=>r.kind === 'travel').reduce((s,r)=>s + (r.seconds || 0),0);
    totalTravelSeconds += day.travelSeconds;
  }
  return {days,totalTravelSeconds,candidateCount:candidates.length,optimized:true};
}
