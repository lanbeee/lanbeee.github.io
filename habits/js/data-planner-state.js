const AUTO_CHUNK_PLAN_KEY = 'tings_auto_chunk_plans_v1';

function loadAutoChunkPlans(){
  const raw = Storage.read(AUTO_CHUNK_PLAN_KEY);
  if(!raw || typeof raw !== 'object' || !raw.groups || typeof raw.groups !== 'object')return {groups:{}};
  return {groups:raw.groups};
}

function saveAutoChunkPlans(plans){
  const next = plans && plans.groups ? plans : {groups:{}};
  const current = Storage.read(AUTO_CHUNK_PLAN_KEY);
  if(JSON.stringify(current || {groups:{}}) === JSON.stringify(next))return false;
  try{ Storage.write(AUTO_CHUNK_PLAN_KEY,next); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

const TODAY_SUGGESTED_KEY = 'tings_today_suggested_v1';

// Temporary same-day agenda precedence links (device-local; not in habit backup).
// dayBase → edges; each edge says beforeHid should be planned before afterHid that day.
const ORDER_CONSTRAINTS_KEY = 'tings_order_constraints_v1';

/**
 * @typedef {Object} OrderConstraint
 * @property {string} id
 * @property {number} dayBase
 * @property {string} beforeHid
 * @property {string} afterHid
 * @property {'sometime'|'direct'} adjacency
 * @property {number} createdAt
 */

/**
 * @typedef {Object} DoingNowState
 * @property {string} hid
 * @property {number} startedAt
 * @property {number} dayBase
 * @property {number} sessionMinutes — snapshotted target length at start
 * @property {number} targetAt — startedAt + sessionMinutes
 * @property {number|null} endsAt — auto-complete deadline; null for manual sessions
 * @property {'manual'|'auto'} completionMode
 * @property {boolean} oneShotAutoMark — compatibility mirror of completionMode
 */

function yesterdayIso(){
  return dateKey(Date.now() - 86400000);
}

function newOrderConstraintId(){
  return `oc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

function normalizeOrderAdjacency(raw){
  return raw === 'direct' ? 'direct' : 'sometime';
}

function normalizeOrderConstraint(raw){
  if(!raw || typeof raw !== 'object')return null;
  const dayBase = clampDayTimestamp(raw.dayBase);
  const beforeHid = typeof raw.beforeHid === 'string' ? raw.beforeHid.trim() : '';
  const afterHid = typeof raw.afterHid === 'string' ? raw.afterHid.trim() : '';
  if(dayBase == null || !beforeHid || !afterHid || beforeHid === afterHid)return null;
  return {
    id:typeof raw.id === 'string' && raw.id ? raw.id : newOrderConstraintId(),
    dayBase,
    beforeHid,
    afterHid,
    adjacency:normalizeOrderAdjacency(raw.adjacency),
    createdAt:Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now()
  };
}

/** PURE: minutes to run for a doing-now session (snapshotted at confirm). */
function doingNowSessionMinutesFor(h,now = Date.now()){
  if(!h)return typeof DEFAULT_DURATION_MINUTES === 'number' ? DEFAULT_DURATION_MINUTES : 30;
  if(h.breakable && typeof remainingDurationMinutes === 'function'){
    const left = remainingDurationMinutes(h,dayStart(now));
    if(left > 0)return left;
  }
  return clampDuration(h.durationMinutes);
}

function normalizeDoingNow(raw,todayBase = dayStart(Date.now())){
  if(!raw || typeof raw !== 'object')return null;
  const hid = typeof raw.hid === 'string' ? raw.hid.trim() : '';
  const dayBase = clampDayTimestamp(raw.dayBase);
  const startedAt = Number(raw.startedAt);
  if(!hid || dayBase == null || !Number.isFinite(startedAt))return null;
  if(dayBase !== todayBase)return null;
  const sessionMinutes = Math.max(1,Math.min(720,Math.round(Number(raw.sessionMinutes) || 0) || 30));
  // Records written before completionMode existed are intentionally restored
  // as manual. That safe migration prevents an old timer from unexpectedly
  // logging a habit after the app updates.
  const completionMode = raw.completionMode === 'auto' ? 'auto' : 'manual';
  const targetAt = Number.isFinite(Number(raw.targetAt))
    ? Number(raw.targetAt)
    : Number.isFinite(Number(raw.endsAt))
    ? Number(raw.endsAt)
    : startedAt + sessionMinutes * 60000;
  const endsAt = completionMode === 'auto' ? targetAt : null;
  return {
    hid,
    startedAt,
    dayBase,
    sessionMinutes,
    targetAt,
    endsAt,
    completionMode,
    oneShotAutoMark:completionMode === 'auto'
  };
}

function loadOrderConstraintStore(now = Date.now()){
  const raw = Storage.read(ORDER_CONSTRAINTS_KEY);
  const todayBase = dayStart(now);
  const edges = [];
  const seen = new Set();
  const list = raw && Array.isArray(raw.edges) ? raw.edges
    : (raw && raw.byDay && typeof raw.byDay === 'object'
      ? Object.values(raw.byDay).flatMap(v=>Array.isArray(v) ? v : [])
      : []);
  for(const item of list){
    const edge = normalizeOrderConstraint(item);
    if(!edge)continue;
    if(edge.dayBase < todayBase)continue; // past days drop
    const key = `${edge.dayBase}|${edge.beforeHid}|${edge.afterHid}`;
    if(seen.has(key))continue;
    seen.add(key);
    edges.push(edge);
  }
  const doingNow = normalizeDoingNow(raw && raw.doingNow,todayBase);
  return {edges,doingNow};
}

function saveOrderConstraintStore(store){
  const next = {
    edges:Array.isArray(store && store.edges) ? store.edges.map(normalizeOrderConstraint).filter(Boolean) : [],
    doingNow:store && store.doingNow ? normalizeDoingNow(store.doingNow) : null
  };
  const current = Storage.read(ORDER_CONSTRAINTS_KEY);
  if(JSON.stringify(current || {edges:[],doingNow:null}) === JSON.stringify(next))return false;
  try{ Storage.write(ORDER_CONSTRAINTS_KEY,next); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

function orderConstraintsForDay(dayBase,store = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const src = store || loadOrderConstraintStore();
  return (src.edges || []).filter(e=>e.dayBase === base);
}

// PURE: recurring Schedule relationships expressed as the same directed edge
// shape used by one-day reorder. They are intentionally not stored in the
// device-local reorder store.
function persistentOrderConstraintsForDay(dayBase,data = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const items = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  const valid = new Set(items.filter(Boolean).map(h=>cleanHabitId(h.hid)).filter(Boolean));
  const edges = [];
  for(const h of items){
    const subjectHid = cleanHabitId(h && h.hid);
    if(!subjectHid)continue;
    const links = normalizeScheduleLinks(h.scheduleLinks,subjectHid);
    links.forEach((link,linkIdx)=>{
      if(!link || !valid.has(link.anchorHid))return;
      const direction = link.direction;
      edges.push({
        id:`schedule:${subjectHid}:${direction}:${link.anchorHid}:${linkIdx}`,
        dayBase:base,
        beforeHid:direction === 'before' ? subjectHid : link.anchorHid,
        afterHid:direction === 'before' ? link.anchorHid : subjectHid,
        adjacency:link.adjacency,
        persistent:true,
        requiresPair:link.requireSameDay,
        requireSameDay:link.requireSameDay,
        subjectHid,
        anchorHid:link.anchorHid,
        direction
      });
    });
  }
  return edges;
}

// IMPURE by default (reads saved habits): the planner-facing edge set. A
// persistent relationship wins over a contradictory stale one-day edge.
function agendaOrderConstraintsForDay(dayBase,data = null,store = null){
  const merged = persistentOrderConstraintsForDay(dayBase,data).map(edge=>({...edge}));
  for(const edge of orderConstraintsForDay(dayBase,store)){
    const same = merged.find(item=>item.beforeHid === edge.beforeHid && item.afterHid === edge.afterHid);
    if(same){
      // A compatible one-day drag may strengthen recurring "before" to
      // "right before" for this date, and retains reorder's explicit pair.
      if(edge.adjacency === 'direct')same.adjacency = 'direct';
      same.requiresPair = true;
      same.temporaryUpgrade = true;
      continue;
    }
    const reverse = merged.some(item=>item.beforeHid === edge.afterHid && item.afterHid === edge.beforeHid);
    if(reverse)continue;
    merged.push({...edge,persistent:false,requiresPair:true});
  }
  return merged;
}

function getDoingNow(store = null){
  const src = store || loadOrderConstraintStore();
  return src.doingNow || null;
}

/** PURE: whether this active-focus session auto-completes at its target. */
function doingNowAutoCompletes(doing){
  return Boolean(doing && doing.completionMode === 'auto');
}

/** True while a doing-now session is active. Manual sessions do not expire. */
function isDoingNowActive(doing = null,now = Date.now()){
  const d = doing || getDoingNow();
  if(!d || !d.hid)return false;
  if(d.dayBase !== dayStart(now))return false;
  if(doingNowAutoCompletes(d) && Number.isFinite(d.endsAt) && now >= d.endsAt)return false;
  return true;
}

/**
 * Start an active-focus session. opts.sessionMinutes snapshots the target
 * duration at start. Manual is the safe default; auto mode completes once
 * when the target passes.
 * dayBase must be today's calendar day; startedAt may be earlier (even
 * before midnight) so expired sessions near day boundaries still sweep.
 */
function setDoingNow(hid,startedAt = Date.now(),dayBase = dayStart(Date.now()),opts = {}){
  const todayBase = dayStart(Date.now());
  const nextDay = clampDayTimestamp(dayBase);
  if(!hid || nextDay !== todayBase)return null;
  const start = Number(startedAt) || Date.now();
  const sessionMinutes = Math.max(1,Math.min(720,Math.round(Number(opts.sessionMinutes) || 0) || 30));
  const completionMode = opts.completionMode === 'auto'
    || (opts.completionMode == null && opts.oneShotAutoMark === true)
    ? 'auto'
    : 'manual';
  const targetAt = Number.isFinite(Number(opts.targetAt))
    ? Number(opts.targetAt)
    : Number.isFinite(Number(opts.endsAt))
      ? Number(opts.endsAt)
    : start + sessionMinutes * 60000;
  const store = loadOrderConstraintStore();
  store.doingNow = {
    hid:String(hid),
    startedAt:start,
    dayBase:todayBase,
    sessionMinutes,
    targetAt,
    endsAt:completionMode === 'auto' ? targetAt : null,
    completionMode,
    oneShotAutoMark:completionMode === 'auto'
  };
  saveOrderConstraintStore(store);
  return store.doingNow;
}

function clearDoingNow(hid = null){
  const store = loadOrderConstraintStore();
  if(!store.doingNow)return false;
  if(hid != null && store.doingNow.hid !== hid)return false;
  store.doingNow = null;
  return saveOrderConstraintStore(store);
}

/** Upsert one day-scoped edge; replaces any existing same before→after that day. */
function upsertOrderConstraint({dayBase,beforeHid,afterHid,adjacency = 'sometime'}){
  const edge = normalizeOrderConstraint({
    id:newOrderConstraintId(),
    dayBase,
    beforeHid,
    afterHid,
    adjacency,
    createdAt:Date.now()
  });
  if(!edge)return null;
  const store = loadOrderConstraintStore();
  store.edges = (store.edges || []).filter(e=>!(
    e.dayBase === edge.dayBase && e.beforeHid === edge.beforeHid && e.afterHid === edge.afterHid
  ));
  store.edges.push(edge);
  saveOrderConstraintStore(store);
  return edge;
}

/** Write the chosen edges for a drop; replaces same-day pairs among touched hids. */
function saveOrderConstraintsForDrop(dayBase,edges){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return [];
  const store = loadOrderConstraintStore();
  const incoming = (edges || []).map(e=>normalizeOrderConstraint({...e,dayBase:base})).filter(Boolean);
  const touch = new Set();
  for(const e of incoming){
    touch.add(e.beforeHid);
    touch.add(e.afterHid);
  }
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(!touch.size)return true;
    // Replace any prior same-day edge that touches the moved cluster pairs.
    return !(touch.has(e.beforeHid) && touch.has(e.afterHid));
  });
  for(const e of incoming)store.edges.push(e);
  saveOrderConstraintStore(store);
  return incoming;
}

function removeOrderConstraint(id){
  if(!id)return false;
  const store = loadOrderConstraintStore();
  const next = (store.edges || []).filter(e=>e.id !== id);
  if(next.length === store.edges.length)return false;
  store.edges = next;
  return saveOrderConstraintStore(store);
}

function clearOrderConstraintsForHid(hid){
  if(!hid)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  const beforeDoing = store.doingNow;
  store.edges = (store.edges || []).filter(e=>e.beforeHid !== hid && e.afterHid !== hid);
  if(store.doingNow && store.doingNow.hid === hid)store.doingNow = null;
  if(store.edges.length === beforeLen && store.doingNow === beforeDoing)return false;
  return saveOrderConstraintStore(store);
}

function clearOrderConstraintsForDay(dayBase,hid = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  const beforeDoing = store.doingNow;
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(hid == null)return false;
    return e.beforeHid !== hid && e.afterHid !== hid;
  });
  if(store.doingNow && store.doingNow.dayBase === base && (hid == null || store.doingNow.hid === hid)){
    store.doingNow = null;
  }
  if(store.edges.length === beforeLen && store.doingNow === beforeDoing)return false;
  return saveOrderConstraintStore(store);
}

/** Clear only reorder edges for a day, preserving an active doing-now session. */
function clearOrderEdgesForDay(dayBase,hid = null){
  const base = clampDayTimestamp(dayBase);
  if(base == null)return false;
  const store = loadOrderConstraintStore();
  const beforeLen = store.edges.length;
  store.edges = (store.edges || []).filter(e=>{
    if(e.dayBase !== base)return true;
    if(hid == null)return false;
    return e.beforeHid !== hid && e.afterHid !== hid;
  });
  return store.edges.length !== beforeLen ? saveOrderConstraintStore(store) : false;
}

/** Drop edges / doing-now when a habit completes or is deleted. */
function pruneOrderConstraintsForHabit(h,data = null,now = Date.now()){
  if(!h || !h.hid)return false;
  const store = loadOrderConstraintStore(now);
  const todayBase = dayStart(now);
  let changed = false;
  const done = h.type === 'task'
    ? (typeof isTaskDone === 'function' ? isTaskDone(h) : Boolean(h.lastLog))
    : completedToday(h,now);
  const stillExists = Array.isArray(data) ? data.some(item=>item && item.hid === h.hid) : true;
  const shouldDrop = !stillExists || done;
  if(!shouldDrop && !(store.doingNow && store.doingNow.hid === h.hid))return false;
  const nextEdges = (store.edges || []).filter(e=>{
    if(e.beforeHid !== h.hid && e.afterHid !== h.hid)return true;
    if(!stillExists){ changed = true; return false; }
    if(done){
      // Tasks are one-shot: drop every day. Rhythm habits only drop today/past.
      if(h.type === 'task' || e.dayBase <= todayBase){ changed = true; return false; }
    }
    return true;
  });
  if(nextEdges.length !== store.edges.length){
    store.edges = nextEdges;
    changed = true;
  }
  if(store.doingNow && store.doingNow.hid === h.hid && (done || !stillExists)){
    store.doingNow = null;
    changed = true;
  }
  return changed ? saveOrderConstraintStore(store) : false;
}

function pruneOrderConstraintsOnLog(h,now = Date.now()){
  return pruneOrderConstraintsForHabit(h,null,now);
}

function orderConstraintsForHid(hid,store = null){
  if(!hid)return [];
  const src = store || loadOrderConstraintStore();
  return (src.edges || []).filter(e=>e.beforeHid === hid || e.afterHid === hid);
}

function habitHasOrderConstraints(hid,store = null){
  return orderConstraintsForHid(hid,store).length > 0;
}

function orderConstraintPillsForHid(hid,dayBase,data = null,store = null){
  if(!hid)return [];
  const edges = agendaOrderConstraintsForDay(dayBase,data,store);
  const findOther = (otherHid)=>{
    if(!Array.isArray(data))return null;
    return data.find(item=>item && item.hid === otherHid) || null;
  };
  const nameOf = (other)=>{
    const hit = findOther(other);
    return hit ? hit.name : other;
  };
  const pills = [];
  for(const e of edges){
    if(e.afterHid === hid){
      const other = findOther(e.beforeHid);
      pills.push({
        id:e.id,
        kind:'after',
        adjacency:e.adjacency,
        otherHid:e.beforeHid,
        otherEmoji:other && other.emoji ? String(other.emoji).trim() : '',
        otherBg:normalizeEmojiBgColor(other && other.emojiBgColor),
        otherName:nameOf(e.beforeHid),
        dayBase:e.dayBase,
        persistent:Boolean(e.persistent),
        label:(e.adjacency === 'direct' ? `right after ${nameOf(e.beforeHid)}` : `after ${nameOf(e.beforeHid)}`)
          + (e.persistent ? ' · recurring' : '')
      });
    }
    if(e.beforeHid === hid){
      const other = findOther(e.afterHid);
      pills.push({
        id:e.id,
        kind:'before',
        adjacency:e.adjacency,
        otherHid:e.afterHid,
        otherEmoji:other && other.emoji ? String(other.emoji).trim() : '',
        otherBg:normalizeEmojiBgColor(other && other.emojiBgColor),
        otherName:nameOf(e.afterHid),
        dayBase:e.dayBase,
        persistent:Boolean(e.persistent),
        label:(e.adjacency === 'direct' ? `right before ${nameOf(e.afterHid)}` : `before ${nameOf(e.afterHid)}`)
          + (e.persistent ? ' · recurring' : '')
      });
    }
  }
  return pills;
}

// PURE: validate the complete persistent graph after applying an in-flight
// edit. Returns a concise user-facing error rather than silently saving a
// relationship the planners cannot honor.
function validateScheduleLinkGraph(items){
  const data = Array.isArray(items) ? items : [];
  const byHid = new Map(data.filter(Boolean).map(h=>[cleanHabitId(h.hid),h]));
  const edges = [];
  for(const h of data){
    const subject = cleanHabitId(h && h.hid);
    if(!subject)continue;
    const links = normalizeScheduleLinks(h.scheduleLinks,subject);
    const seenAnchors = new Map(); // anchorHid → direction
    for(const link of links){
      if(!link)continue;
      const prevDir = seenAnchors.get(link.anchorHid);
      if(prevDir && prevDir !== link.direction){
        const name = byHid.get(link.anchorHid)?.name || 'that habit';
        return {ok:false,message:`choose either before or after ${name}, not both`};
      }
      if(prevDir === link.direction){
        const name = byHid.get(link.anchorHid)?.name || 'that habit';
        return {ok:false,message:`${name} is already linked`};
      }
      seenAnchors.set(link.anchorHid,link.direction);
      const anchor = byHid.get(link.anchorHid);
      if(!anchor)return {ok:false,message:'one linked habit no longer exists'};
      edges.push({
        beforeHid:link.direction === 'before' ? subject : link.anchorHid,
        afterHid:link.direction === 'before' ? link.anchorHid : subject,
        adjacency:link.adjacency
      });
    }
  }

  const next = new Map();
  const directNext = new Map();
  for(const edge of edges){
    if(!next.has(edge.beforeHid))next.set(edge.beforeHid,new Set());
    next.get(edge.beforeHid).add(edge.afterHid);
    if(edge.adjacency !== 'direct')continue;
    // One habit may have only one right-after successor (two movable cards
    // cannot both sit immediately after the same parent). Multiple right-before
    // parents are allowed and OR'd on the subject (shower after exercise OR haircut).
    if(directNext.has(edge.beforeHid) && directNext.get(edge.beforeHid) !== edge.afterHid){
      const name = byHid.get(edge.beforeHid)?.name || 'a habit';
      return {ok:false,message:`${name} already has a right-after habit`};
    }
    directNext.set(edge.beforeHid,edge.afterHid);
  }

  const visiting = new Set();
  const visited = new Set();
  const walk = hid=>{
    if(visiting.has(hid))return true;
    if(visited.has(hid))return false;
    visiting.add(hid);
    for(const child of next.get(hid) || []){
      if(walk(child))return true;
    }
    visiting.delete(hid);
    visited.add(hid);
    return false;
  };
  for(const hid of byHid.keys()){
    if(walk(hid))return {ok:false,message:'habit order creates a cycle'};
  }
  return {ok:true,message:''};
}

// PURE: whether a proposed temporary edge contradicts a recurring link.
function temporaryOrderConflict(dayBase,edges,data = null){
  const permanent = persistentOrderConstraintsForDay(dayBase,data);
  const graph = new Set(permanent.map(e=>`${e.beforeHid}>${e.afterHid}`));
  for(const edge of edges || []){
    if(graph.has(`${edge.afterHid}>${edge.beforeHid}`)){
      return permanent.find(e=>e.beforeHid === edge.afterHid && e.afterHid === edge.beforeHid) || null;
    }
  }
  return null;
}

function dataFingerprint(data){
  return data.map(h=>[h.hid,h.lastLog,h.snoozedUntil,h.target,h.allowedWeekdays,h.allowedTimeStart,h.allowedTimeEnd,h.dueDate,h.planByDate,JSON.stringify(h.scheduleLinks || [])].join(':')).join('|');
}

function loadTodaySuggested(){
  const raw = Storage.read(TODAY_SUGGESTED_KEY);
  const today = todayIso();
  if(!raw || typeof raw !== 'object' || typeof raw.hids !== 'object')
    return {day:today,hids:{},projection:null,prevProjection:null};
  if(raw.day === today)return raw;
  if(raw.day === yesterdayIso())
    return {day:today,hids:{},projection:raw.projection || null,prevProjection:raw.projection || null};
  return {day:today,hids:{},projection:null,prevProjection:null};
}

function saveTodaySuggested(snapshot){
  const current = Storage.read(TODAY_SUGGESTED_KEY);
  if(JSON.stringify(current) === JSON.stringify(snapshot))return false;
  try{ Storage.write(TODAY_SUGGESTED_KEY,snapshot); bumpPlannerDataRevision(); return true; }
  catch{ return false; }
}

function recordTodaySuggested(data,currentHids,now = Date.now(),projectionHids = null,fingerprint = null){
  const snap = loadTodaySuggested();
  let changed = false;
  const validHids = new Set(data.filter(h=>h && h.hid).map(h=>h.hid));
  for(const hid of Object.keys(snap.hids)){
    if(!validHids.has(hid)){ delete snap.hids[hid]; changed = true; }
  }
  for(const hid of currentHids){
    if(!snap.hids[hid]){
      const h = data.find(item=>item && item.hid === hid);
      snap.hids[hid] = {first:now,name:h ? h.name : ''};
      changed = true;
    }
  }
  if(projectionHids && fingerprint){
    const tomorrow = dateKey(now + 86400000);
    if(!snap.projection || snap.projection.day !== tomorrow || snap.projection.fingerprint !== fingerprint){
      snap.projection = {day:tomorrow,hids:projectionHids,fingerprint};
      changed = true;
    }
  }
  if(changed)saveTodaySuggested(snap);
  return snap;
}

function completedToday(h,now = Date.now()){
  if(!h)return false;
  if(h.type === 'task')return isTaskDone(h);
  // A breakable habit is only "done" when its full daily budget is met — a
  // partial chunk log must not hide the card from the home list.
  if(h.breakable && typeof breakableProgressMinutes === 'function'
    && typeof breakableTotalMinutes === 'function'){
    const base = dayStart(now);
    const total = breakableTotalMinutes(h);
    return total > 0 && breakableProgressMinutes(h,base) >= total;
  }
  const start = dayStart(now);
  const end = start + 86400000;
  return actualLogs(h.logs).some(ts=>ts >= start && ts < end);
}

/**
 * PURE: day-scoped sibling of completedToday. The agenda asks this before it
 * offers work, so a habit the logs already show as finished for `dayBase`
 * stays off the plan even when a stale plan entry for that day survives (one
 * tap only consumes a single plan, and a habit can be planned more than once
 * a day by different order links).
 */
function completedOnDay(h,dayBase){
  if(!h)return false;
  if(h.type === 'task')return isTaskDone(h);
  const start = dayStart(dayBase != null ? dayBase : Date.now());
  if(h.breakable && typeof breakableProgressMinutes === 'function'
    && typeof breakableTotalMinutes === 'function'){
    const total = breakableTotalMinutes(h);
    return total > 0 && breakableProgressMinutes(h,start) >= total;
  }
  const end = start + 86400000;
  return actualLogs(h.logs).some(ts=>ts >= start && ts < end);
}

function autoChunkPlanScope(h,dayBase){
  if(!h || !h.hid)return null;
  return h.type === 'task' ? `task:${h.hid}` : `day:${h.hid}:${dateKey(dayBase)}`;
}

/**
 * HYBRID: remember future breakable rows that the agenda actually presented.
 * Rows that have already started stay stable while future rows follow replans.
 * A cold open never invents credit for work that was never shown to the user.
 */
function syncAutoMarkChunkPlans(data,week,now = Date.now()){
  if(!Array.isArray(data) || !week || !Array.isArray(week.days))return false;
  const plans = loadAutoChunkPlans();
  const current = new Map();
  const autoHids = new Set(data.filter(h=>h && h.breakable && isAutoMark(h)).map(h=>h.hid));

  week.days.forEach(day=>{
    const dayBase = day && day.dayBase != null ? day.dayBase : dayStart(now);
    (day && Array.isArray(day.timeline) ? day.timeline : []).forEach(row=>{
      if(!row || (row.kind !== 'fill' && row.kind !== 'scheduled') || row.i == null)return;
      const h = data[row.i];
      if(!h || !h.breakable || !isAutoMark(h) || !h.hid)return;
      const scope = autoChunkPlanScope(h,dayBase);
      if(!scope)return;
      if(!current.has(scope))current.set(scope,{hid:h.hid,type:h.type,dayBase:h.type === 'task' ? null : dayBase,total:breakableTotalMinutes(h),rows:[]});
      current.get(scope).rows.push({
        start:Number(row.start) || 0,
        end:Number(row.end) || 0,
        minutes:Math.max(1,Math.round(Number(row.chunkMinutes) || ((Number(row.end) - Number(row.start)) / 60000) || 1))
      });
    });
  });

  const staleBefore = now - 8 * 86400000;
  for(const [scope,group] of Object.entries(plans.groups)){
    if(!group || !autoHids.has(group.hid)){ delete plans.groups[scope]; continue; }
    const retained = Array.isArray(group.rows)
      ? group.rows.filter(row=>Number(row.end) >= staleBefore && Number(row.start) <= now)
      : [];
    if(retained.length)plans.groups[scope] = {...group,rows:retained};
    else if(!current.has(scope))delete plans.groups[scope];
  }

  for(const [scope,nextGroup] of current){
    const h = data.find(item=>item && item.hid === nextGroup.hid);
    if(!h)continue;
    const old = plans.groups[scope];
    const preserved = old && Array.isArray(old.rows)
      ? old.rows.filter(row=>Number(row.start) <= now && Number(row.end) >= staleBefore)
      : [];
    const dayBase = nextGroup.dayBase != null ? nextGroup.dayBase : dayStart(now);
    const done = breakableProgressMinutes(h,dayBase);
    let target = Math.max(done,...preserved.map(row=>Math.max(0,Number(row.targetMinutes) || 0)));
    const total = breakableTotalMinutes(h);
    const preservedKeys = new Set(preserved.map(row=>`${row.start}:${row.end}`));
    const future = nextGroup.rows
      .filter(row=>row.end > now && row.end > row.start && !preservedKeys.has(`${row.start}:${row.end}`))
      .sort((a,b)=>a.start - b.start)
      .map(row=>{
        const amount = Math.max(0,Math.min(row.minutes,total - target));
        target += amount;
        return {...row,targetMinutes:target};
      })
      .filter(row=>row.targetMinutes > done);
    const rows = [...preserved,...future]
      .sort((a,b)=>a.end - b.end)
      .filter((row,index,all)=>index === 0 || row.start !== all[index - 1].start || row.end !== all[index - 1].end);
    if(rows.length)plans.groups[scope] = {...nextGroup,total,rows};
    else delete plans.groups[scope];
  }
  return saveAutoChunkPlans(plans);
}

/**
 * HYBRID: credit every due planner chunk up to its stored cumulative target.
 * Manual logs made before the deadline already count toward that target, so a
 * later sweep adds only the uncovered minutes. Due rows are removed once read,
 * making foreground and interval sweeps idempotent.
 */
function sweepAutoMarkedBreakableChunks(now = Date.now(),opts = {}){
  const plans = loadAutoChunkPlans();
  const data = load();
  let changedData = false;
  let changedPlans = false;
  let credited = 0;
  const completedSigs = [];

  for(const [scope,group] of Object.entries(plans.groups)){
    const h = data.find(item=>item && item.hid === group.hid);
    if(!h || !h.breakable || !isAutoMark(h)){
      delete plans.groups[scope];
      changedPlans = true;
      continue;
    }
    const delayMs = Math.max(0,Number(h.autoMarkMinutes) || 0) * 60000;
    const rows = Array.isArray(group.rows) ? group.rows.slice().sort((a,b)=>a.end - b.end) : [];
    const keep = [];
    for(const row of rows){
      const dueAt = Number(row.end) + delayMs;
      if(!Number.isFinite(dueAt) || dueAt > now){ keep.push(row); continue; }
      const dayBase = h.type === 'task' ? dayStart(now) : (group.dayBase != null ? group.dayBase : dayStart(row.end));
      const done = breakableProgressMinutes(h,dayBase);
      const target = Math.max(0,Math.min(breakableTotalMinutes(h),Math.round(Number(row.targetMinutes) || 0)));
      const delta = Math.max(0,target - done);
      if(delta > 0){
        const rawLogTs = Math.min(now,Math.max(1,Number(row.end) || dueAt));
        const logTs = h.type === 'task' ? rawLogTs : snapLogTimestamp(h,rawLogTs);
        h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(logTs,{minutes:delta,note:'agenda auto-log'})]);
        h.lastLog = latestActualLog(h.logs);
        h.snoozedUntil = null;
        clearPlanByDateOnLog(h);
        if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
        changedData = true;
        credited += 1;
      }
      changedPlans = true;
    }
    if(keep.length)plans.groups[scope] = {...group,rows:keep};
    else delete plans.groups[scope];
    if(h.type === 'task' && isTaskDone(h) && typeof reminderSignature === 'function')completedSigs.push(reminderSignature(h));
  }

  if(changedData)save(data);
  if(changedPlans)saveAutoChunkPlans(plans);
  if(changedData && typeof cancelPush === 'function')completedSigs.forEach(sig=>cancelPush(sig));
  if(changedData && opts.refresh !== false && typeof refreshOpenViews === 'function')refreshOpenViews();
  if(changedData && opts.toast !== false && typeof showToast === 'function'){
    showToast(credited === 1 ? 'agenda chunk auto-logged' : `${credited} agenda chunks auto-logged`);
  }
  return credited;
}

// HYBRID: auto-complete event-style items (markDone === false) whose time has
// passed. Two shapes: timed tasks (log at eventTime) and scheduled build-habits
// (log each passed scheduled weekday/monthday day). Adds completion logs,
// cancels scheduled pushes for tasks, and re-renders. Idempotent — safe on a
// timer. Returns the number of items it completed.
function effectiveAutoMarkTrigger(h,now = Date.now()){
  if(!h)return null;
  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  if(doing && doing.hid === h.hid && doing.dayBase === dayStart(now)
    && doingNowAutoCompletes(doing)){
    return doing.startedAt;
  }
  if(h.type === 'task'){
    return h.eventTime ?? (h.dueDate !== null
      ? dayStart(h.dueDate) - (h.flexibilityDays || 0) * 86400000
      : null);
  }
  return null;
}

/** PURE: end of a doing-now one-shot auto window (startedAt + session). */
function doingNowAutoMarkDeadline(doing){
  if(!doing || !doingNowAutoCompletes(doing))return null;
  if(Number.isFinite(doing.endsAt))return doing.endsAt;
  if(Number.isFinite(doing.targetAt))return doing.targetAt;
  const mins = Math.max(1,Number(doing.sessionMinutes) || 30);
  return Number(doing.startedAt) + mins * 60000;
}

/**
 * HYBRID: when a doing-now one-shot session has reached endsAt, auto-log once
 * even if the habit is normally manual. Clears doing-now afterward.
 */
function sweepDoingNowOneShot(now = Date.now(),opts = {}){
  const doing = getDoingNow();
  if(!doingNowAutoCompletes(doing))return 0;
  const deadline = doingNowAutoMarkDeadline(doing);
  if(!Number.isFinite(deadline) || deadline > now)return 0;
  const data = load();
  const h = data.find(item=>item && item.hid === doing.hid);
  if(!h){
    clearDoingNow();
    return 0;
  }
  if(h.type === 'task' && isTaskDone(h)){
    clearDoingNow(h.hid);
    return 0;
  }
  if(h.type !== 'task' && completedToday(h,now)){
    clearDoingNow(h.hid);
    return 0;
  }

  let changed = false;
  const sessionMins = Math.max(1,Number(doing.sessionMinutes) || 30);
  if(h.breakable){
    const dayBase = h.type === 'task' ? dayStart(now) : (doing.dayBase || dayStart(now));
    const left = typeof breakableBudgetMinutes === 'function' ? breakableBudgetMinutes(h,dayBase) : sessionMins;
    const delta = Math.max(0,Math.min(sessionMins,left));
    if(delta > 0){
      const logTs = Math.min(now,Math.max(doing.startedAt,deadline));
      const snapped = h.type === 'task' ? logTs : (typeof snapLogTimestamp === 'function' ? snapLogTimestamp(h,logTs) : logTs);
      h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(snapped,{minutes:delta,note:'doing-now auto-log'})]);
      h.lastLog = latestActualLog(h.logs);
      h.snoozedUntil = null;
      clearPlanByDateOnLog(h);
      changed = true;
    }
  }else{
    const logTs = Math.min(now,Math.max(doing.startedAt,deadline));
    const snapped = h.type === 'task' ? logTs : (typeof snapLogTimestamp === 'function' ? snapLogTimestamp(h,logTs) : logTs);
    h.logs = normalizeLogs([...normalizeLogs(h.logs),makeActualLog(snapped,{
      minutes:sessionMins,
      note:'doing-now auto-log'
    })]);
    h.lastLog = latestActualLog(h.logs);
    h.snoozedUntil = null;
    clearPlanByDateOnLog(h);
    changed = true;
  }

  clearDoingNow(h.hid);
  if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
  if(!changed)return 0;
  save(data);
  // A unified timer/doing-now session has one completion owner. If the
  // persisted deadline sweep wins the race, retire the matching live timer so
  // its next tick cannot create a second log (especially for rhythm habits).
  if(typeof habitTimer !== 'undefined' && habitTimer){
    const timerHabit = data[habitTimer.idx];
    if(timerHabit && timerHabit.hid === h.hid && typeof clearHabitTimerSilent === 'function'){
      clearHabitTimerSilent();
    }
  }
  if(h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)
    && typeof cancelPush === 'function' && typeof reminderSignature === 'function'){
    cancelPush(reminderSignature(h));
  }
  if(opts.refresh !== false && typeof refreshOpenViews === 'function')refreshOpenViews();
  if(opts.toast !== false && typeof showToast === 'function')showToast('doing-now auto-logged');
  return 1;
}

function sweepAutoDoneTasks(){
  const oneShotCount = sweepDoingNowOneShot(Date.now(),{refresh:false,toast:true});
  const chunkCount = sweepAutoMarkedBreakableChunks(Date.now(),{refresh:false,toast:true});
  const data = load();
  const now = Date.now();
  const todayStart = dayStart(now);
  const completedSigs = [];
  let changed = false;
  let count = 0;
  data.forEach(h=>{
    // Doing-now one-shot is handled above; still allow normal auto-mark path
    // for habits that already have autoMarkMinutes set.
    if(h.autoMarkMinutes === null)return;
    if(h.breakable)return; // breakables are reconciled against placed chunks above
    if(h.type === 'task'){
      // Trigger: auto-completing doing-now override, fixed time, or when the
      // task enters the agenda window. Manual sessions never change the
      // scheduled auto-mark deadline.
      const trigger = effectiveAutoMarkTrigger(h,now);
      if(trigger === null)return;
      // Auto Doing now uses its session deadline; manual active focus leaves
      // the habit's normal scheduled auto-mark behavior untouched.
      const doing = getDoingNow();
      const doingOwns = doing && doing.hid === h.hid && doing.dayBase === dayStart(now)
        && doingNowAutoCompletes(doing);
      const dueAt = doingOwns
        ? doingNowAutoMarkDeadline(doing)
        : trigger + (h.autoMarkMinutes || 0) * 60000;
      if(dueAt == null || dueAt >= now)return;
      if(h.lastLog !== null)return; // already done (manual check-off or prior sweep)
      const logs = normalizeLogs(h.logs);
      logs.push(trigger);
      h.logs = normalizeLogs(logs);
      h.lastLog = latestActualLog(h.logs);
      if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
      if(doingOwns)clearDoingNow(h.hid);
      changed = true;
      count += 1;
      if(typeof reminderSignature === 'function')completedSigs.push(reminderSignature(h));
      return;
    }
    if(h.type === 'keepup'){
      // Recurring-event habit: back-fill a log for each passed scheduled day
      // that has no entry yet. Only fires when an explicit day schedule is set.
      if(!hasDaySchedule(h))return;
      const anchor = h.lastLog !== null ? h.lastLog : (h.createdAt || now);
      const floor = todayStart - 60 * 86400000; // cap to avoid huge back-fills
      let cursor = Math.max(dayStart(anchor) + 86400000, floor);
      const taken = new Set(normalizeLogs(h.logs).map(l=>dateKey(logTime(l))));
      const toAdd = [];
      while(cursor < todayStart){
        if(isDateEligibleForHabit(h,cursor) && !taken.has(dateKey(cursor))){
          toAdd.push(cursor + 12 * 3600000); // noon, same local day
        }
        cursor += 86400000;
      }
      if(toAdd.length){
        h.logs = normalizeLogs([...normalizeLogs(h.logs), ...toAdd]);
        h.lastLog = latestActualLog(h.logs);
        changed = true;
        count += toAdd.length;
      }
    }
  });
  if(!changed){
    if(chunkCount > 0 || oneShotCount > 0){
      if(typeof syncTimerAfterExternalCompletion === 'function')syncTimerAfterExternalCompletion();
      if(typeof refreshOpenViews === 'function')refreshOpenViews();
    }
    return chunkCount + oneShotCount;
  }
  save(data);
  if(typeof cancelPush === 'function')completedSigs.forEach(sig=>cancelPush(sig));
  // Snappy clear: drop a running timer / open session sheet if this sweep
  // just completed that habit (instead of waiting for the next 250ms tick).
  if(typeof syncTimerAfterExternalCompletion === 'function')syncTimerAfterExternalCompletion();
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  return count + chunkCount + oneShotCount;
}

