// Agenda option packer (ILP via GLPK). It is the default week-planning path and
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
// Shared background solve budget. The UI renders a fast preview while this
// worker runs, so do not abandon an exact day solve merely to meet a foreground
// paint deadline. Near days take a larger share; unused time rolls forward.
const AGENDA_OPTIMIZER_WEEK_SOLVE_BUDGET_MS = 45000;
const AGENDA_OPTIMIZER_DAY_SOLVE_MIN_MS = 1000;
const AGENDA_OPTIMIZER_DAY_SOLVE_MAX_MS = 12000;
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
  try{
    if(typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope){
      urls.push(new URL('../lib/js/glpk.mjs',self.location.href).href);
    }
  }catch(_){}
  try{ urls.push(new URL('./lib/js/glpk.mjs',location.href).href); }catch(_){}
  // De-dupe while preserving order.
  return urls.filter((url,i)=>url && urls.indexOf(url) === i);
}

let _plannerWorker = null;
let _plannerWorkerSeq = 0;
let _plannerWorkerWarmed = false;
let _plannerWorkerWarmPromise = null;
const _plannerWorkerRequests = new Map();

// Only the planner-relevant persisted keys. Avoid shipping the multi-KB home
// agenda cache and unrelated app keys on every request.
const PLANNER_WORKER_STORAGE_KEYS = [
  typeof ORDER_CONSTRAINTS_KEY !== 'undefined' ? ORDER_CONSTRAINTS_KEY : 'tings_order_constraints_v1',
  typeof AUTO_CHUNK_PLAN_KEY !== 'undefined' ? AUTO_CHUNK_PLAN_KEY : 'tings_auto_chunk_plans_v1',
  typeof TODAY_SUGGESTED_KEY !== 'undefined' ? TODAY_SUGGESTED_KEY : 'tings_today_suggested_v1'
];

function plannerWorkerStorageSnapshot(){
  const snapshot = {};
  try{
    for(const key of PLANNER_WORKER_STORAGE_KEYS){
      const value = localStorage.getItem(key);
      if(value != null)snapshot[key] = value;
    }
  }catch(_){}
  return snapshot;
}

function ensureAgendaPlannerWorker(){
  if(_plannerWorker)return _plannerWorker;
  if(typeof Worker !== 'function')return null;
  // Workers (and dynamic import of glpk.mjs) are blocked on file:// — fall back
  // to the main-thread heuristic. Serve over http(s) for the full planner.
  if(typeof agendaPlannerWorkerAvailable === 'function' && !agendaPlannerWorkerAvailable())return null;
  plannerPerfMark('planner-worker-spawn-start');
  let worker;
  try{
    worker = new Worker('./js/agenda-planner-worker.js');
  }catch(err){
    console.warn('[agenda-optimizer] planner worker unavailable',err && err.message || err);
    return null;
  }
  worker.addEventListener('message',event=>{
    const message = event.data || {};
    const request = _plannerWorkerRequests.get(message.id);
    if(!request)return;
    _plannerWorkerRequests.delete(message.id);
    if(message.error)request.reject(new Error(message.error));
    else if(message.ready){
      _plannerWorkerWarmed = true;
      request.resolve(true);
    }else request.resolve(message.week);
  });
  worker.addEventListener('error',error=>{
    // A superseded worker may report its termination after its replacement is
    // already active. It must not reject the replacement's request map.
    if(_plannerWorker !== worker)return;
    const pending = [..._plannerWorkerRequests.values()];
    _plannerWorkerRequests.clear();
    _plannerWorker = null;
    _plannerWorkerWarmed = false;
    worker.terminate();
    pending.forEach(request=>request.reject(
      new Error(error && error.message ? error.message : 'agenda planner worker failed')
    ));
  });
  _plannerWorker = worker;
  plannerPerfMark('planner-worker-spawn-end');
  return worker;
}

// A foreground edit must not wait behind an exact solve for data that no
// longer exists. Terminate that worker and reject its promises; the caller can
// immediately create a fresh worker for a fast preview of the new state.
function cancelAgendaPlannerWorkerRequests(reason = 'planner request superseded'){
  const worker = _plannerWorker;
  if(!worker)return false;
  const pending = [..._plannerWorkerRequests.values()];
  _plannerWorkerRequests.clear();
  _plannerWorker = null;
  _plannerWorkerWarmed = false;
  try{ worker.terminate(); }catch(_){}
  const error = new Error(reason);
  pending.forEach(request=>request.reject(error));
  return true;
}

// Idle warm: parse worker scripts + compile GLPK inside the worker so the first
// real request does not pay cold bring-up on the critical path. Exact mode only —
// fast mode never loads GLPK.
function warmAgendaPlannerWorker(){
  if(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast()){
    return Promise.resolve(false);
  }
  const settings = typeof sortSettings !== 'undefined' ? sortSettings : null;
  if(settings && settings.agendaOptimizer === false)return Promise.resolve(false);
  const worker = ensureAgendaPlannerWorker();
  if(!worker)return Promise.resolve(false);
  if(_plannerWorkerWarmed)return Promise.resolve(true);
  if(_plannerWorkerWarmPromise)return _plannerWorkerWarmPromise;
  const id = ++_plannerWorkerSeq;
  plannerPerfMark('planner-worker-warm-start');
  _plannerWorkerWarmPromise = new Promise(resolve=>{
    _plannerWorkerRequests.set(id,{
      resolve:()=>{
        plannerPerfMark('planner-worker-warm-end');
        _plannerWorkerWarmPromise = null;
        resolve(true);
      },
      reject:()=>{
        _plannerWorkerWarmPromise = null;
        resolve(false);
      }
    });
    try{ worker.postMessage({id,warm:true}); }
    catch(_){
      _plannerWorkerRequests.delete(id);
      _plannerWorkerWarmPromise = null;
      resolve(false);
    }
  });
  return _plannerWorkerWarmPromise;
}

function leanAgendaWeek(week){
  if(!week || !Array.isArray(week.days))return week;
  if(week.__lean)return week;
  const strip = row=>{
    if(!row || typeof row !== 'object')return row;
    const out = {...row};
    delete out.h;
    return out;
  };
  return {
    days:week.days.map(day=>({
      ...day,
      timeline:Array.isArray(day.timeline) ? day.timeline.map(strip) : day.timeline,
      agendaItems:Array.isArray(day.agendaItems) ? day.agendaItems.map(strip) : day.agendaItems
    })),
    totalTravelSeconds:week.totalTravelSeconds,
    candidateCount:week.candidateCount,
    optimized:week.optimized,
    __lean:true
  };
}

// Re-attach habit refs from data indices after a lean worker/cache week arrives.
function rehydrateAgendaWeekHabits(week,data){
  if(!week || !Array.isArray(week.days) || !Array.isArray(data))return week;
  for(const day of week.days){
    for(const row of day.timeline || []){
      if(row && row.i != null)row.h = data[row.i] || null;
    }
    for(const item of day.agendaItems || []){
      if(item && item.i != null)item.h = data[item.i] || null;
    }
  }
  if(week.__lean)delete week.__lean;
  return week;
}

// ASYNC: construct a week without occupying the UI thread. The worker receives
// a compact storage snapshot (order constraints, auto-chunks, today-suggested).
function buildWeekAgendaOffMain(data,settings,numDays = 7,mode = 'fast',opts = {}){
  const worker = ensureAgendaPlannerWorker();
  if(!worker)return Promise.reject(new Error('agenda planner worker unavailable'));
  const id = ++_plannerWorkerSeq;
  plannerPerfMark('planner-request-post');
  return new Promise((resolve,reject)=>{
    _plannerWorkerRequests.set(id,{
      resolve:week=>{
        plannerPerfMark('planner-response');
        resolve(week);
      },
      reject
    });
    worker.postMessage({
      id,
      data,
      settings,
      numDays,
      mode,
      dirtyKey:opts.dirtyKey || (typeof homePlannerDirtyKey === 'function' ? homePlannerDirtyKey(data) : ''),
      day0Only:Boolean(opts.day0Only),
      storage:plannerWorkerStorageSnapshot()
    });
  });
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
  const ids = typeof normalizeLocationIds === 'function'
    ? normalizeLocationIds(fill.h.locationIds,state.registry || [])
    : (Array.isArray(fill.h.locationIds) ? fill.h.locationIds.filter(Boolean) : []);
  if(!ids.length)return [null];
  return fill.h.anywhereAllowed ? [null,...ids] : ids;
}

function optimizerFitsForFill(state,fill,dayCandidates,candidateBoundaryEdges){
  const out = [];
  const seen = new Set();
  for(const locationId of optimizerLocationVariants(fill,state)){
    const locatedFill = {...fill,locationId};
    for(const fit of listPlaceFitsOnDay(
      state,locatedFill,dayCandidates,candidateBoundaryEdges
    )){
      const key = `${fit.placeStart}:${fit.placeEnd}:${fit.locId || ''}`;
      if(seen.has(key))continue;
      seen.add(key);
      out.push(fit);
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
    // Temporary order links need staggered starts — otherwise every fill only
    // gets the same ASAP option and pairwise order rows forbid co-selection.
    const orderEdges = typeof plannerOrderConstraintsForDay === 'function'
      ? plannerOrderConstraintsForDay(state.dayBase) : [];
    if(orderEdges.length || doing){
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
      if(!fit || !successorStarts.length)return false;
      return successorStarts.some(start=>{
        if(fit.placeEnd > start + 60000)return false;
        const gapMin = Math.max(0,(start - fit.placeEnd) / 60000);
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
    const fits = optimizerFitsForFill(
      state,fill,dayCandidates,candidateBoundaryEdges
    );
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
  const seedLoc = state.seedLocId || null;
  // Only fire on a GENUINELY LIVE location (geolocation / manual pin), not a
  // static last-known default. The "do the at-location task first, never
  // away-and-back" override is only meaningful when we actually know where the
  // user is right now; on static/future-day seeds the committed-route DP already
  // minimizes travel, and firing here would perturb its carefully-routed layouts.
  if(state.liveLocId && seedLoc && seedLoc === state.liveLocId
    && typeof travelEdgeBetweenIds === 'function'){
    const TRAVEL_PAIR_COEF = 0.01;   // 1s of saved commute ≈ 0.01 objective weight
    const TRAVEL_PAIR_CAP = 80;      // < min baseWeight (~100): reorder only
    const TRAVEL_PAIR_FLOOR = 12;    // still decisive over priority/ASAP deltas
    let tpIdx = 0;
    for(let ai = 0; ai < opts.length; ai += 1){
      const A = opts[ai];
      const aLoc = A && A.fit && A.fit.locId;
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
  const virtualCompletionCounts = new Map();
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
    // Far days still enter GLPK while budget remains; structural dayOffset>=3
    // cutoff was reverted — it skipped exact packing for scarce far-day windows.
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
    total += repairWeekPlacedHours(candidates,dayStates,settings);
  }
  if(typeof enforcePersistentLinkInvariants === 'function'){
    enforcePersistentLinkInvariants(dayStates,candidates,settings);
  }
  return total >= 0;
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
  for(let i = candidates.length - 1;i >= 0;i -= 1){
    if(!candidates[i].eligible || !candidates[i].eligible.size)candidates.splice(i,1);
  }
  for(const c of candidates)c.scarcity = scarcityScore(c,dayStates);

  const solveStates = reuseFarDays ? dayStates.slice(0,1) : dayStates;
  plannerPerfMark('planner-exact-solve-start');
  const ok = await assignWeekCandidatesOptimized(candidates,solveStates,settings);
  plannerPerfMark('planner-exact-solve-end');
  if(!ok){
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
  const week = {days,totalTravelSeconds,candidateCount:candidates.length,optimized:true};
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
