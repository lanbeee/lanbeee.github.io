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
const AGENDA_PLANNER_WORKER_REQUEST_TIMEOUT_MS = 65000;
const AGENDA_PLANNER_WORKER_ASSET_VERSION = 'v98';
const AGENDA_OPTIMIZER_REFINEMENT_BUDGET_MS = 40000;
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
    // A versioned URL prevents an installed PWA from reusing the previous
    // deployment's long-lived Worker script after the page shell updates.
    worker = new Worker(`./js/agenda-planner-worker.js?${AGENDA_PLANNER_WORKER_ASSET_VERSION}`);
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
    plannerSolveStatus:week.plannerSolveStatus,
    refined:Boolean(week.refined),
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
    const timeoutId = setTimeout(()=>{
      if(!_plannerWorkerRequests.has(id))return;
      if(_plannerWorker === worker){
        cancelAgendaPlannerWorkerRequests('planner worker timed out');
      }else{
        _plannerWorkerRequests.delete(id);
        reject(new Error('planner worker timed out'));
      }
    },AGENDA_PLANNER_WORKER_REQUEST_TIMEOUT_MS);
    _plannerWorkerRequests.set(id,{
      resolve:week=>{
        clearTimeout(timeoutId);
        plannerPerfMark('planner-response');
        resolve(week);
      },
      reject:error=>{
        clearTimeout(timeoutId);
        reject(error);
      }
    });
    try{
      worker.postMessage({
        id,
        data,
        settings,
        numDays,
        mode,
        dirtyKey:opts.dirtyKey || (typeof homePlannerDirtyKey === 'function' ? homePlannerDirtyKey(data) : ''),
        day0Only:Boolean(opts.day0Only),
        refine:Boolean(opts.refine),
        refineBudgetMs:Math.max(0,Math.round(Number(opts.refineBudgetMs) || 0)),
        storage:plannerWorkerStorageSnapshot()
      });
    }catch(error){
      clearTimeout(timeoutId);
      _plannerWorkerRequests.delete(id);
      reject(error);
    }
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
