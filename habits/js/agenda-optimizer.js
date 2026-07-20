// Optional exact agenda packer (ILP via GLPK). Lazy-loaded only when
// settings.agendaOptimizer is on — the default path stays the scarcity
// heuristic in today-view.js.
//
// Per day: enumerate feasible start options via tryPlaceOnDay, then solve a
// set-packing ILP that maximizes weighted placements (scarce + high priority
// preferred) subject to no overlapping sessions. Results are committed through
// the same commitPlacement path as the heuristic.

const AGENDA_OPTIMIZER_TIMEOUT_MS = 2000;
const AGENDA_OPTIMIZER_GLPK_URL = '../lib/js/glpk.mjs';

let _glpkPromise = null;
let _glpkInstance = null;
let _optimizerToastShown = false;

function preloadAgendaOptimizer(){
  return ensureGlpk().catch(()=>null);
}

function ensureGlpk(){
  if(_glpkInstance)return Promise.resolve(_glpkInstance);
  if(_glpkPromise)return _glpkPromise;
  _glpkPromise = import(AGENDA_OPTIMIZER_GLPK_URL)
    .then(mod=> (mod.default || mod)())
    .then(GLPK=>{
      _glpkInstance = GLPK;
      return GLPK;
    })
    .catch(err=>{
      _glpkPromise = null;
      throw err;
    });
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

function optimizerWeight(c){
  const scarceBonus = (typeof isScarceScore === 'function' && isScarceScore(c.scarcity)) ? 50 : 0;
  const pri = c.priority != null ? c.priority : 2;
  // Higher weight for scarce + higher priority (lower P number).
  return 100 + scarceBonus + (5 - Math.min(5,Math.max(0,pri))) * 5;
}

// PURE: all feasible fits for a fill on this day (same gates as tryPlaceOnDay).
function listPlaceFitsOnDay(state,fill){
  if(typeof tryPlaceOnDay !== 'function')return [];
  const scan = ()=>{
    const fits = [];
    // Walk each open slot in isolation so we enumerate alternatives even when
    // earliest-fit would hide later ones.
    for(const slot of state.slots || []){
      const clone = clonePlacementState(state);
      clone.slots = [slot];
      const fit = tryPlaceOnDay(clone,fill,{preferLatest:false,allowNetwork:false});
      if(fit)fits.push(fit);
    }
    return fits;
  };
  return typeof withTravelNetworkPaused === 'function' ? withTravelNetworkPaused(scan) : scan();
}

function fitsOverlap(a,b){
  return a.placeStart < b.placeEnd && b.placeStart < a.placeEnd;
}

// Solve set-packing ILP for one day. Returns array of {fill, fit} or null on failure.
function solveDayPackingIlp(GLPK,state,dayCandidates){
  const options = [];
  for(const c of dayCandidates){
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const fits = listPlaceFitsOnDay(state,fill);
    for(const fit of fits){
      options.push({c,fill,fit,weight:optimizerWeight(c)});
    }
  }
  if(!options.length)return [];

  // Cap option count so mobile stays responsive.
  const MAX_OPTS = 120;
  const opts = options.length > MAX_OPTS
    ? options.slice().sort((a,b)=>b.weight - a.weight || a.fit.placeStart - b.fit.placeStart).slice(0,MAX_OPTS)
    : options;

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
  // At most one option per candidate.
  const byCand = new Map();
  opts.forEach((o,idx)=>{
    if(!byCand.has(o.c.i))byCand.set(o.c.i,[]);
    byCand.get(o.c.i).push(o.varName);
  });
  for(const [i,names] of byCand){
    subjectTo.push({
      name:`cand_${i}`,
      vars:names.map(n=>({name:n,coef:1})),
      bnds:{type:GLPK.GLP_UP,ub:1,lb:0}
    });
  }
  // Pairwise non-overlap for overlapping fits (dense but N≤120 → ok).
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

async function packDayWithOptimizer(state,dayCandidates){
  const GLPK = await ensureGlpk();
  const packed = solveDayPackingIlp(GLPK,state,dayCandidates);
  const {result:raw,opts} = packed;
  const result = await resolveSolve(raw);
  const status = result && result.result && result.result.status;
  // GLP_OPT=5, GLP_FEAS=2
  if(status !== 5 && status !== 2)return null;
  const vars = (result.result && result.result.vars) || {};
  const chosen = [];
  opts.forEach(o=>{
    if((vars[o.varName] || 0) > 0.5)chosen.push({fill:o.fill,fit:o.fit});
  });
  chosen.sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
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
  let total = 0;
  for(const state of dayStates){
    const dayCands = [];
    for(const c of candidates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(c.pinned && !state.isTodayDay)continue;
      const rhythmHabit = !!(c.h && c.h.type !== 'task' && !c.h.breakable
        && Number.isFinite(Number(c.h && c.h.target)));
      if(rhythmHabit && virtualLogs.has(c.i)){
        const vLog = virtualLogs.get(c.i);
        if(typeof rhythmEligibleOnDay === 'function'
          && !rhythmEligibleOnDay(c.h,vLog,state.dayBase,state.weekday))continue;
      }
      if(state.placed.has(c.i))continue;
      dayCands.push(c);
    }
    if(!dayCands.length)continue;
    let chosen;
    try{
      chosen = await withTimeout(packDayWithOptimizer(state,dayCands),AGENDA_OPTIMIZER_TIMEOUT_MS);
    }catch(_){
      return false;
    }
    if(!chosen)return false;
    for(const {fill,fit} of chosen){
      commitPlacement(state,fill,fit);
      state.day.agendaItems.push({
        h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity,
        locationId:fit.locId
      });
      total += 1;
      const c = candidates.find(x=>x.i === fill.i);
      if(c && c.h && c.h.type !== 'task' && !c.h.breakable){
        virtualLogs.set(c.i,state.dayBase);
      }
    }
  }
  return total >= 0;
}

async function buildWeekAgendaAsync(data,settings,numDays = 7){
  // Always able to fall back to the sync scarcity heuristic.
  if(!settings || !settings.agendaOptimizer){
    return buildWeekAgenda(data,settings,numDays);
  }
  try{
    await withTimeout(ensureGlpk(),AGENDA_OPTIMIZER_TIMEOUT_MS);
  }catch(_){
    maybeToastOptimizerFallback();
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
  for(const c of candidates)c.scarcity = scarcityScore(c,dayStates);

  const ok = await assignWeekCandidatesOptimized(candidates,dayStates,settings);
  if(!ok){
    maybeToastOptimizerFallback();
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

function maybeToastOptimizerFallback(){
  if(_optimizerToastShown)return;
  _optimizerToastShown = true;
  if(typeof showToast === 'function'){
    try{ showToast('Schedule optimizer unavailable — using fast planner'); }catch(_){}
  }
}
