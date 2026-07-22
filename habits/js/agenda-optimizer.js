// Exact agenda packer (ILP via GLPK). It is the default week-planning path and
// lazy-loads on demand; the scarcity heuristic in today-view.js is the explicit
// off-mode and the timeout/error fallback.
//
// Per day: enumerate feasible start options via tryPlaceOnDay, then solve a
// set-packing ILP that maximizes weighted placements subject to no overlaps and
// the day's capacity. Fixed-duration work is packed first; breakable work then
// fills the remaining gaps continuous-first. This keeps a broad work window from
// winning one large binary choice and erasing a narrow habit inside that window.

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

function optimizerWindowForCandidate(candidate,state){
  if(!candidate || !candidate.h || !state)return null;
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(candidate.h)){
    return fillTimeWindow(candidate.h,state.dayBase,state.seedLocId);
  }
  if(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(candidate.h)){
    return fillPreferredWindow(candidate.h,state.dayBase,state.seedLocId);
  }
  return null;
}

// PURE: all useful feasible fits for a fill on this day. In addition to each
// open-slot start, enumerate starts immediately before/after competing windows.
// Those boundary options let GLPK move flexible work out of a narrow window
// without paying for a minute-by-minute grid on mobile.
function listPlaceFitsOnDay(state,fill,dayCandidates = []){
  if(typeof tryPlaceOnDay !== 'function')return [];
  const scan = ()=>{
    const fits = [];
    const seen = new Set();
    const durationMs = fillDurationMinutes(fill) * 60000;
    const windowEdges = [];
    for(const candidate of dayCandidates){
      const win = optimizerWindowForCandidate(candidate,state);
      if(!win)continue;
      windowEdges.push(win.start - durationMs,win.start,win.end - durationMs,win.end);
    }
    for(const slot of state.slots || []){
      const anchors = [slot.start,state.startClock,...windowEdges]
        .filter(ts=>Number.isFinite(ts) && ts < slot.end)
        .sort((a,b)=>a-b);
      for(const anchor of anchors){
        const clone = clonePlacementState(state);
        clone.slots = [slot];
        clone.startClock = Math.max(state.startClock,slot.start,anchor);
        const fit = tryPlaceOnDay(clone,fill,{allowNetwork:false});
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
function solveDayPackingIlp(GLPK,state,dayCandidates){
  const options = [];
  for(const c of dayCandidates){
    // Breakable budgets are continuous resources, not one all-or-nothing event.
    // They are fitted after this exact fixed-duration solve has reserved narrow
    // windows, then split only when a continuous placement is impossible.
    if(c.h && c.h.breakable)continue;
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const fits = listPlaceFitsOnDay(state,fill,dayCandidates);
    for(const fit of fits){
      options.push({c,fill,fit,weight:optimizerWeight(c)});
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
  if(Array.isArray(packed) && packed.length === 0)return [];
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
  const oneShotPlaced = new Set();
  let total = 0;
  for(const state of dayStates){
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
    const fixedCands = dayCands.filter(c=>!(c.h && c.h.breakable));
    if(!fixedCands.length)continue;
    let chosen;
    try{
      chosen = await withTimeout(packDayWithOptimizer(state,fixedCands),AGENDA_OPTIMIZER_TIMEOUT_MS);
    }catch(_){
      return false;
    }
    if(!chosen)return false;
    for(const {fill,fit} of chosen){
      if(fill.h && fill.h.breakable){
        const chunkIndex = state.fills.filter(f=>f.fill && f.fill.i === fill.i).length;
        fill.chunkMinutes = fit.durMin;
        fill.chunkIndex = chunkIndex;
        fill.placeKey = `${fill.i}:${chunkIndex}`;
        fit.placeKey = fill.placeKey;
      }
      commitPlacement(state,fill,fit);
      if(fill.h && fill.h.breakable)state.placed.add(fill.i);
      state.day.agendaItems.push({
        h:fill.h,i:fill.i,priority:fill.priority,scarcity:fill.scarcity,
        locationId:fit.locId,
        chunkMinutes:fill.chunkMinutes != null ? fill.chunkMinutes : null,
        chunkIndex:fill.chunkIndex != null ? fill.chunkIndex : null
      });
      total += 1;
      const c = candidates.find(x=>x.i === fill.i);
      if(c && c.h && c.h.type === 'task')oneShotPlaced.add(c.i);
      if(c && c.h && c.h.type !== 'task'
        && Number.isFinite(Number(c.h.target))){
        virtualLogs.set(c.i,state.dayBase);
      }
    }
  }
  // A bounded recovery pass catches a fixed item whose only usable start became
  // visible after the ILP commits. It runs before flexible work consumes gaps.
  if(typeof rescueLeftoverWeekFits === 'function'){
    total += rescueLeftoverWeekFits(
      candidates.filter(c=>c && c.h && !c.h.breakable),
      dayStates,
      settings
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
  const breakableCandidates = candidates
    .filter(c=>c && c.h && c.h.breakable)
    .sort((a,b)=>optimizerWeight(b) - optimizerWeight(a));
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
