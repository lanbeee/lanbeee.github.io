// Today agenda — a literal "what does today look like" timeline.
//
// Scheduled tasks are placed at their literal time. Tasks and habits fill the
// gaps in rank order, each shown with a *soft* estimated range so the
// list reads as "do these roughly in this order" rather than "be here at this
// exact minute." This is the one surface that combines scheduled tasks, tasks, and habits
// into something that can replace a calendar and a to-do list.
//
// Annotated for the React Native port, matching list-view/overview-view:
//   - RENDER  -> React functional component
//   - HANDLER -> onPress callback
//   - PURE    -> plain selector / helper

// PURE: today's scheduled tasks + rank-ordered fill items + remaining capacity. Items
// carry their index into `data` so the render layer never has to re-resolve a
// habit's position (which would break by-reference lookups after a re-load).
//
// Fill items compete in SCARCITY ORDER first (tight allowed windows before
// flexible all-day work), then priority within the same scarcity band. That way
// a narrow sunrise habit keeps its only gap even when a flexible P0 also wants
// the morning. Home list ranking is unchanged; scarcity only arbitrates agenda
// capacity and clock slots.
function buildTodayAgenda(data,settings){
  const todayKey = todayIso();
  const scheduled = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>settings.showScheduledTasksInAgenda !== false && h.type === 'task' && h.eventTime !== null && !isTaskDone(h) && dateKey(h.eventTime) === todayKey)
    .sort(({h:a},{h:b})=>a.eventTime - b.eventTime);
  const totalMinutes = effectiveAvailabilityMinutes(todayKey,settings);
  const slots = buildOpenAgendaSlots(todayKey,scheduled,settings);
  // The availability budget caps TASK minutes for the day, not open time.
  // It is also bounded by the day's actual open minutes so a heavily-blocked
  // day never promises more capacity than the calendar leaves room for.
  const slotMinutes = slots.reduce((sum,slot)=>sum + Math.max(0,(slot.end - slot.start) / 60000),0);
  const totalCap = Math.min(totalMinutes,slotMinutes);
  // Gather every eligible fill candidate in home rank order, score scarcity
  // against today's open slots, then sort scarcity → priority → home rank.
  const candidates = [];
  let homeRank = 0;
  for(const i of visibleIndices(data,settings)){
    const h = data[i];
    if(h.type === 'task' && isTaskDone(h))continue;
    if(h.type === 'task' && h.eventTime !== null)continue; // timed tasks are fixed blocks, not soft fills
    const dueToday = includeInTodayAgenda(h,settings);
    const earlyOk = !dueToday && typeof earlyReason === 'function' && Boolean(earlyReason(data,i,settings));
    if(!dueToday && !earlyOk)continue;
    candidates.push({h,i,priority:effectivePriority(h),rank:homeRank++});
  }
  const dayBase = dayStart(Date.now());
  const candidateHids = new Set(candidates.map(c=>c.h && c.h.hid).filter(Boolean));
  const linkOmissions = [];
  for(let i = candidates.length - 1;i >= 0;i -= 1){
    const candidate = candidates[i];
    const sameDayLinks = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(candidate.h)
      : normalizeScheduleLinks(candidate.h.scheduleLinks,candidate.h.hid).filter(l=>l && l.requireSameDay);
    if(!sameDayLinks.length)continue;
    // OR: keep when any same-day anchor is a candidate or already committed today.
    const anyAnchor = sameDayLinks.some(link=>
      candidateHids.has(link.anchorHid)
      || scheduleAnchorCommitForDay(link.anchorHid,dayBase,data)
    );
    if(anyAnchor)continue;
    const anchorName = data.find(h=>h && h.hid === sameDayLinks[0].anchorHid)?.name || 'anchor';
    linkOmissions.push({subjectHid:candidate.h.hid,reason:`waiting for ${anchorName} to be eligible this day`});
    candidates.splice(i,1);
  }
  const scarcityState = createDayPlacementState(
    {scheduled,agendaItems:[],totalMinutes:totalCap,slots,dayBase,weekday:new Date(dayBase).getDay(),isToday:true},
    settings,
    {dayBase,now:Date.now()}
  );
  for(const c of candidates)c.scarcity = scarcityScore(c,[scarcityState]);
  candidates.sort(compareScarcityThenPriority);
  // Capacity (including travel) is charged during location-aware placement in
  // buildTodayTimeline — duration-only pre-cuts would under-count travel.
  const agendaItems = candidates.map(({h,i,priority,scarcity})=>({h,i,priority,scarcity}));
  return { scheduled, agendaItems, totalMinutes:totalCap, usedMinutes:0, remainingMinutes:totalCap, slots, linkOmissions };
}

// PURE: applies user-facing Today agenda inclusion settings.
function includeInTodayAgenda(h,settings){
  if(hasPlannedToday(h) && settings.showPlannedItemsInAgenda !== false)return true;
  if(h.type === 'task'){
    const when = taskWhen(h);
    const left = when !== null ? daysUntil(when) : null;
    return settings.showDueTasksInAgenda !== false && left !== null && left <= 0 && windowStillDoableToday(h);
  }
  if(h.type === 'zero')return false;
  const scheduleDistance = hasDaySchedule(h) ? nextEligibleDistance(h) : 0;
  if(settings.showDueHabitsInAgenda !== false && scheduleDistance === 0 && windowStillDoableToday(h)){
    const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
    if(planBy != null){
      const left = daysUntil(planBy);
      // Soft plan-by: once the deadline day arrives (or is overdue), treat like
      // a due habit so today can absorb it — without needing the rhythm due.
      if(left !== null && left <= 0)return true;
    }
  }
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  // Breakable keepup/reduce: a partial log today must NOT clear the rest of
  // today's duration budget off the agenda (that looked like "all chunks done").
  if(h.breakable && settings.showDueHabitsInAgenda !== false
    && scheduleDistance === 0 && windowStillDoableToday(h)
    && typeof breakableBudgetMinutes === 'function'){
    const todayBase = dayStart(Date.now());
    if(breakableBudgetMinutes(h,todayBase) > 0){
      const startedToday = typeof loggedChunkMinutesOnDay === 'function'
        && loggedChunkMinutesOnDay(h,todayBase) > 0;
      if(startedToday || days === null || days >= target)return true;
    }
  }
  // Never-logged habits (days === null) are treated as due today: a freshly
  // created habit should enter the agenda so the user can do it, rather than
  // silently waiting for the first log. After the first log the normal
  // rhythm (days >= target) applies.
  return settings.showDueHabitsInAgenda !== false && (days === null || days >= target) && scheduleDistance === 0 && windowStillDoableToday(h);
}

// PURE: resolve a fill item's allowed time window for the current day, or null
// when the item has no restriction. Overnight windows (end <= start) extend
// into the next day so a 23:00-02:00 window still works as a single span.
//
// Prayer anchors: when start or end is tied to an anchor, the resolved minute
// is read via resolveHabitTimeField. `contextLocId` carries the running agenda
// anchor so "anywhere" habits resolve their prayer times against the last
// location before the task; absent it they fall back to lastKnown/registry.
function fillTimeWindow(h,dayBase,contextLocId){
  if(!hasTimeWindow(h))return null;
  const startMin = resolveHabitTimeField(h,'allowedTimeStart',dayBase,contextLocId);
  const endMin = resolveHabitTimeField(h,'allowedTimeEnd',dayBase,contextLocId);
  if(startMin == null || endMin == null)return null;
  const start = dayBase + startMin * 60000;
  let end = dayBase + endMin * 60000;
  if(end <= start)end += 24 * 3600000;
  return {start,end};
}

// PURE: strict allowed-time intervals that fall on this calendar day.
// A recurring overnight clock window contributes two pieces every day:
// midnight→end (the tail opened yesterday) and start→midnight (today's
// opening). This is the day-bounded counterpart to fillTimeWindow(), whose
// continuous start→next-day span remains useful for display/scoring.
function fillDayWindows(h,dayBase,contextLocId){
  if(!hasTimeWindow(h))return null;
  const rawStart = resolveHabitTimeField(h,'allowedTimeStart',dayBase,contextLocId);
  const rawEnd = resolveHabitTimeField(h,'allowedTimeEnd',dayBase,contextLocId);
  if(rawStart == null || rawEnd == null)return null;
  const folded = typeof foldBlockedMinutes === 'function'
    ? foldBlockedMinutes(rawStart,rawEnd)
    : {startMin:rawStart,endMin:rawEnd};
  const startMin = folded.startMin;
  const endMin = folded.endMin;
  if(!Number.isFinite(startMin) || !Number.isFinite(endMin))return null;
  const dayEnd = dayBase + 24 * 3600000;
  if(endMin > startMin){
    return [{start:dayBase + startMin * 60000,end:dayBase + endMin * 60000}];
  }
  // Preserve the existing equal-endpoint meaning (a 24-hour window).
  if(endMin === startMin)return [{start:dayBase,end:dayEnd}];
  return [
    {start:dayBase,end:dayBase + endMin * 60000},
    {start:dayBase + startMin * 60000,end:dayEnd}
  ].filter(win=>win.end > win.start);
}

// PURE: the soft preferred-time anchor for a fill item today, or null.
// preferredTimeStart/End is a HINT, not a constraint: the timeline nudges a
// fill toward this time when it fits, and otherwise falls back to the clock.
// Only the strict allowedTimeStart/End can drop/close an item. We anchor on
// preferredTimeStart (the "do it around this time" cue); end is not needed
// for a soft nudge.
function fillPreferredStart(h,dayBase,contextLocId){
  const s = resolveHabitTimeField(h,'preferredTimeStart',dayBase,contextLocId);
  if(s == null)return null;
  return dayBase + s * 60000;
}

// PURE: soft preferred window as {start,end} ms, or null. Used for scarcity
// packing so evening-preferring habits are not starved by morning ASAP flex
// that burns the whole availability budget while later open gaps stay empty.
function fillPreferredWindow(h,dayBase,contextLocId){
  if(typeof hasPreferredTimeWindow === 'function' && !hasPreferredTimeWindow(h))return null;
  const startMin = resolveHabitTimeField(h,'preferredTimeStart',dayBase,contextLocId);
  const endMin = resolveHabitTimeField(h,'preferredTimeEnd',dayBase,contextLocId);
  if(startMin == null || endMin == null)return null;
  const start = dayBase + startMin * 60000;
  let end = dayBase + endMin * 60000;
  if(end <= start)end += 24 * 3600000;
  return {start,end};
}

// PURE: is there still enough unexpired room today to fit a full session,
// considering the habit's own window ∩ each allowed location's hours? Habits
// with no time window and no location hours are always doable. preferred*
// hints are intentionally NOT consulted — only strict allowed windows can
// close a day. Keeps the home list ("today" vs "overdue") in sync with the
// location-aware agenda.
//
// Blocked intervals (sleep, work, anything in settings.blockedTimes) are
// subtracted from the remaining window: an item whose nominal window still
// has minutes left, but those minutes fall inside a block (e.g. 11pm for a
// 10pm–6am sleep), is NOT still doable today. This mirrors what
// buildOpenAgendaSlots does for the agenda timeline, so the home list agrees.
function windowStillDoableToday(h,now = Date.now()){
  const costMin = (h && h.breakable && typeof minViableSessionMinutes === 'function')
    ? minViableSessionMinutes(h)
    : clampDuration(h.durationMinutes);
  const cost = Math.max(0,costMin) * 60000;
  if(cost <= 0)return false;
  const dayBase = dayStart(now);
  const weekday = new Date(now).getDay();
  const settings = (sortSettings || loadSortSettings());
  const registry = normalizeLocationRegistry(settings.locations);
  const locIds = normalizeLocationIds(h.locationIds,registry);
  const dayEnd = dayBase + 24 * 3600000;
  const todayKey = dateKey(now);
  const blocked = (typeof agendaBlockedIntervals === 'function')
    ? agendaBlockedIntervals(todayKey,settings,dayBase,dayEnd)
    : [];
  const blockedMsIn = (from,to)=>blocked.reduce((sum,b)=>{
    if(b.end <= from || b.start >= to)return sum;
    return sum + (Math.min(b.end,to) - Math.max(b.start,from));
  },0);
  if(h.anywhereAllowed || !locIds.length){
    if(!hasTimeWindow(h)){
      // No restriction: count time left today minus any blocked span.
      const remaining = dayEnd - now - blockedMsIn(now,dayEnd);
      return remaining >= cost;
    }
    const windows = fillDayWindows(h,dayBase);
    if(!windows)return true;
    return windows.some(win=>{
      const from = Math.max(now,win.start);
      const remaining = win.end - from - blockedMsIn(from,win.end);
      return remaining >= cost;
    });
  }
  return locIds.some(id=>{
    const loc = registry.find(l=>l.id === id);
    const intervals = effectiveLocationWindow(h,loc,weekday,dayBase);
    if(!intervals.length)return false;
    return intervals.some(iv=>{
      const start = dayBase + iv.start * 60000;
      const end = dayBase + iv.end * 60000;
      const from = Math.max(now,start);
      const remaining = end - from - blockedMsIn(from,end);
      return remaining >= cost;
    });
  });
}

// PURE: travel edge between two location ids (or zero when either is null/same).
// opts.allowNetwork === false skips OSRM refresh (used by scarcity dry-runs).
function travelEdgeBetweenIds(fromId,toId,registry,mode,opts = {}){
  if(!fromId || !toId || fromId === toId)return {seconds:0,metres:0,provider:'none'};
  const a = registry.find(l=>l.id === fromId);
  const b = registry.find(l=>l.id === toId);
  if(!a || !b || typeof travelBetween !== 'function')return {seconds:0,metres:0,provider:'haversine'};
  return travelBetween(a,b,mode,opts);
}

/**
 * PURE: next location-bearing anchors after `afterTs` that homeDaySequence would
 * draw travel into — scheduled tasks, already-placed fills, and location-tied
 * blocked times. Sorted earliest-first.
 */
function hardLocationAnchorsAfter(state,afterTs){
  const anchors = [];
  const after = Number(afterTs) || 0;
  for(const row of state && state.rows || []){
    if(row.kind !== 'scheduled' || !row.locationId)continue;
    if(!(row.start > after))continue;
    anchors.push({start:row.start,locationId:row.locationId});
  }
  for(const entry of state && state.fills || []){
    const fit = entry && entry.fit;
    if(!fit || !fit.locId || !(fit.placeStart > after))continue;
    anchors.push({start:fit.placeStart,locationId:fit.locId});
  }
  for(const block of locationTiedBlockedIntervals(state)){
    if(!(block.start > after))continue;
    anchors.push({start:block.start,locationId:block.locationId});
  }
  anchors.sort((a,b)=>a.start - b.start);
  return anchors;
}

/**
 * PURE: location-tied blocked intervals for the placement day (empty when the
 * day context is missing). Shared by presence + outbound leave-by.
 */
function locationTiedBlockedIntervals(state){
  if(!state || !state.settings || state.dayBase == null)return [];
  if(typeof agendaBlockedIntervals !== 'function' || typeof dateKey !== 'function')return [];
  const dayKey = dateKey(state.dayBase);
  const dayEnd = state.dayBase + 24 * 3600000;
  return agendaBlockedIntervals(dayKey,state.settings,state.dayBase,dayEnd)
    .filter(b=>b && b.locationId);
}

/**
 * PURE: where homeDaySequence would consider the user to be at `atTs` — last
 * location-bearing scheduled / blocked / committed fill that has already
 * started. Falls back to the day's seed (presence / morning block).
 */
function locationPresenceAt(state,atTs,chron){
  let loc = state && state.seedLocId || null;
  const marks = [];
  const at = Number(atTs) || 0;
  for(const row of state && state.rows || []){
    if(row.kind !== 'scheduled' || !row.locationId)continue;
    if(!(row.start < at))continue;
    marks.push({start:row.start,locationId:row.locationId});
  }
  for(const block of locationTiedBlockedIntervals(state)){
    if(!(block.start < at))continue;
    marks.push({start:block.start,locationId:block.locationId});
  }
  for(const entry of chron || []){
    const fit = entry && entry.fit;
    if(!fit || !fit.locId || !(fit.placeStart < at))continue;
    marks.push({start:fit.placeStart,locationId:fit.locId});
  }
  if(!marks.length)return loc;
  marks.sort((a,b)=>a.start - b.start);
  return marks[marks.length - 1].locationId;
}

/**
 * PURE: latest placeEnd so outbound travel to the next different-location
 * hard/fill row still arrives on time. Matches the leave-by card homeDaySequence
 * inserts after placement. Returns null when no outbound commute is required.
 */
function outboundLeaveByMs(state,fromLocId,afterTs,opts = {}){
  if(!state || !fromLocId)return null;
  const next = hardLocationAnchorsAfter(state,afterTs)
    .find(a=>a.locationId && a.locationId !== fromLocId);
  if(!next)return null;
  const edge = travelEdgeBetweenIds(
    fromLocId,
    next.locationId,
    state.registry,
    state.mode,
    {allowNetwork:opts.allowNetwork !== false}
  );
  return next.start - (Number(edge.seconds) || 0) * 1000;
}

// PURE: choose a location id for a habit given the current anchor. Anywhere
// items return null (no travel, anchor unchanged). When several are allowed,
// prefer high/little preference, avoid last, then cheapest travel from anchor.
function pickHabitLocationId(h,anchorId,registry,mode){
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return null;
  if(ids.length === 1 && !h.anywhereAllowed)return ids[0];
  let best = null;
  let bestScore = h.anywhereAllowed ? 0 : Infinity;
  for(const id of ids){
    const edge = travelEdgeBetweenIds(anchorId,id,registry,mode);
    const pref = locationPrefLevel(h,id);
    // Convert preference into seconds-equivalent bias (negative = better).
    const prefBias = -locationPrefScore(pref) * 30;
    const score = (edge.seconds || 0) + prefBias + (anchorId && id === anchorId ? -60 : 0);
    if(score < bestScore){ bestScore = score; best = id; }
  }
  return best;
}

// PURE: within each priority band, greedy nearest-neighbour reorder. Revisiting
// a location later in the day is allowed — this is NOT a hard cluster-by-place
// pass. Items with no location stay zero-cost floaters.
// Soft day-order constraints (sometime/direct) bias candidate order first so
// "before" items claim slots ahead of "after" items when both are free.
function plannerOrderConstraintsForDay(dayBase,data = null){
  const key = String(dayStart(dayBase));
  if(data == null && _plannerOrderCache.has(key))return _plannerOrderCache.get(key);
  const edges = typeof agendaOrderConstraintsForDay === 'function'
    ? agendaOrderConstraintsForDay(dayBase,data != null ? data : _plannerSolveData)
    : (typeof orderConstraintsForDay === 'function' ? orderConstraintsForDay(dayBase) : []);
  if(data == null)_plannerOrderCache.set(key,edges);
  return edges;
}

// A completed/active/fixed anchor is a committed boundary even when it is not
// a movable candidate in the current placement pass.
function scheduleAnchorCommitForDay(hid,dayBase,data = null){
  const base = dayStart(dayBase);
  const cacheKey = `${hid}|${base}`;
  if(data == null && _plannerAnchorCache.has(cacheKey))return _plannerAnchorCache.get(cacheKey);
  const items = Array.isArray(data)
    ? data
    : (_plannerSolveData || (typeof load === 'function' ? load() : []));
  const h = items.find(item=>item && item.hid === hid);
  let result = null;
  if(h){
    const logs = typeof actualLogs === 'function' ? actualLogs(h.logs || []) : [];
    const todayLogs = logs.filter(ts=>dayStart(ts) === base);
    if(todayLogs.length){
      const ts = Math.max(...todayLogs);
      result = {start:ts,end:ts,kind:'completed'};
    }else{
      const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
      if(doing && doing.hid === hid && doing.dayBase === base
        && (typeof isDoingNowActive !== 'function' || isDoingNowActive(doing))){
        const start = Number(doing.startedAt) || Date.now();
        const end = Number(doing.targetAt) || start + Math.max(1,Number(doing.sessionMinutes) || 30) * 60000;
        result = {start,end,kind:'active'};
      }else if(h.type === 'task' && h.eventTime != null && dayStart(h.eventTime) === base){
        result = {start:h.eventTime,end:h.eventTime + clampDuration(h.durationMinutes) * 60000,kind:'scheduled'};
      }
    }
  }
  if(data == null)_plannerAnchorCache.set(cacheKey,result);
  return result;
}

let _plannerOrderCache = new Map();
let _plannerAnchorCache = new Map();
let _plannerSolveData = null;

function beginPlannerSolveCaches(data = null){
  _plannerOrderCache = new Map();
  _plannerAnchorCache = new Map();
  _plannerSolveData = Array.isArray(data) ? data : (typeof load === 'function' ? load() : null);
}

function endPlannerSolveCaches(){
  _plannerOrderCache = new Map();
  _plannerAnchorCache = new Map();
  _plannerSolveData = null;
}

function reorderAgendaItemsByOrderConstraints(items,dayBase){
  if(!Array.isArray(items) || items.length < 2)return Array.isArray(items) ? items.slice() : [];
  const edges = plannerOrderConstraintsForDay(dayBase);
  if(!edges.length)return items.slice();
  const indexByHid = new Map();
  items.forEach((item,idx)=>{
    const eligible = item && item.eligible;
    if(eligible && typeof eligible.has === 'function' && !eligible.has(dayBase))return;
    if(item && item.h && item.h.hid)indexByHid.set(item.h.hid,idx);
  });
  const preds = new Map(); // afterHid → Set(beforeHid)
  const weight = new Map(); // hid → direct boost
  for(const e of edges){
    if(!indexByHid.has(e.beforeHid) || !indexByHid.has(e.afterHid))continue;
    if(!preds.has(e.afterHid))preds.set(e.afterHid,new Set());
    preds.get(e.afterHid).add(e.beforeHid);
    if(e.adjacency === 'direct'){
      weight.set(e.beforeHid,(weight.get(e.beforeHid) || 0) + 2);
      weight.set(e.afterHid,(weight.get(e.afterHid) || 0) + 1);
    }else{
      weight.set(e.beforeHid,(weight.get(e.beforeHid) || 0) + 2);
      weight.set(e.afterHid,(weight.get(e.afterHid) || 0) + 1);
    }
  }
  if(!preds.size)return items.slice();
  const remaining = items.map((item,idx)=>({item,idx,hid:item && item.h && item.h.hid}));
  const out = [];
  const placed = new Set();
  while(remaining.length){
    let best = -1;
    let bestScore = Infinity;
    for(let i = 0;i < remaining.length;i += 1){
      const hid = remaining[i].hid;
      const need = preds.get(hid);
      if(need){
        let ready = true;
        for(const p of need){
          if(!placed.has(p) && remaining.some(r=>r.hid === p)){ ready = false; break; }
        }
        if(!ready)continue;
      }
      // Prefer constrained "before" items, then original order.
      const score = -(weight.get(hid) || 0) * 1000 + remaining[i].idx;
      if(score < bestScore){ bestScore = score; best = i; }
    }
    if(best < 0)best = 0;
    const picked = remaining.splice(best,1)[0];
    out.push(picked.item);
    if(picked.hid)placed.add(picked.hid);
  }
  return out;
}

function reorderAgendaItemsByLocation(items,settings,now = Date.now()){
  if(!Array.isArray(items) || !items.length)return [];
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  let anchor = (typeof currentLocationId === 'function' && currentLocationId())
    || settings.lastKnownLocationId
    || null;
  const bands = [];
  for(const item of items){
    const scarce = isScarceScore(item.scarcity)
      || (typeof hasTimeWindow === 'function' && hasTimeWindow(item.h))
      || (typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(item.h));
    const scarcityKey = scarce ? 0 : 1;
    const p = item.priority ?? effectivePriority(item.h);
    let band = bands.find(b=>b.scarcityKey === scarcityKey && b.priority === p);
    if(!band){ band = {scarcityKey,priority:p,items:[]}; bands.push(band); }
    band.items.push(item);
  }
  bands.sort((a,b)=>a.scarcityKey - b.scarcityKey || a.priority - b.priority);
  const out = [];
  for(const band of bands){
    const left = [...band.items];
    while(left.length){
      let bestIdx = 0;
      let bestScore = Infinity;
      for(let i = 0;i < left.length;i += 1){
        const locId = pickHabitLocationId(left[i].h,anchor,registry,mode);
        const edge = travelEdgeBetweenIds(anchor,locId,registry,mode);
        const score = edge.seconds;
        if(score < bestScore){ bestScore = score; bestIdx = i; }
      }
      const picked = left.splice(bestIdx,1)[0];
      const locationId = pickHabitLocationId(picked.h,anchor,registry,mode);
      out.push({...picked,locationId});
      if(locationId)anchor = locationId;
    }
  }
  return out;
}

// PURE: interleave scheduled tasks (hard time) and fill items (soft estimate)
// into a time-ordered row list. Placement is shared with the week planner so a
// day is never "assigned" unless real slots, blocks, travel, location hours,
// allowed windows, and availability minutes all accept the session.
//
// Generalised for any day via opts: {dayBase, weekday, startClock, now}.
function buildDayTimeline(agenda,opts = {}){
  const settings = sortSettings || loadSortSettings();
  const state = createDayPlacementState(agenda,settings,opts);
  const now = opts.now != null ? opts.now : Date.now();
  let ordered = reorderAgendaItemsByLocation(agenda.agendaItems || [],settings,now);
  ordered = reorderAgendaItemsByOrderConstraints(ordered,state.dayBase);
  // Doing-now item claims the earliest slot today (while session is active).
  const doingRaw = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const doing = doingRaw
    && doingRaw.dayBase === state.dayBase
    && doingRaw.hid
    && (typeof isDoingNowActive !== 'function' || isDoingNowActive(doingRaw,now))
    ? doingRaw : null;
  if(doing){
    const idx = ordered.findIndex(item=>item && item.h && item.h.hid === doing.hid);
    if(idx > 0){
      const [item] = ordered.splice(idx,1);
      ordered.unshift(item);
    }
  }
  for(const fill of ordered){
    let placeFill = fill;
    const placeOpts = {
      settings,
      urgency:typeof weekUrgency === 'function' ? weekUrgency(fill.h) : 0,
      weights:resolveAgendaScoreWeights(settings)
    };
    if(doing && fill.h && fill.h.hid === doing.hid){
      placeOpts.doingNowStart = Math.min(Number(doing.startedAt) || now, now);
      const sessionMin = Math.max(1,Number(doing.sessionMinutes)
        || (typeof doingNowSessionMinutesFor === 'function'
          ? doingNowSessionMinutesFor(fill.h,now)
          : clampDuration(fill.h.durationMinutes)));
      placeFill = {...fill, chunkMinutes:sessionMin};
    }
    if(!isScarceScore(fill.scarcity) && !(typeof hasTimeWindow === 'function' && hasTimeWindow(fill.h))){
      const spare = scarceWindowsToSpare(ordered,state.dayBase,state.seedLocId,state.dayBase);
      if(spare.length)placeOpts.spareWindows = spare;
    }
    if(placeFill.h && placeFill.h.breakable){
      placeBreakableSessions(state,placeFill,placeOpts);
      continue;
    }
    const fit = tryPlaceOnDay(state,placeFill,placeOpts);
    if(fit)commitPlacement(state,placeFill,fit);
  }
  // Classic today path: location-less, window-less leftovers may overflow past
  // the last open slot so the single-day agenda still surfaces a suggestion.
  if(!opts.weekMode){
    for(const fill of ordered){
      if(state.placed.has(fill.i))continue;
      if(fill.locationId)continue;
      if(fillTimeWindow(fill.h,state.dayBase))continue;
      const durMin = fill.h && fill.h.breakable
        ? (typeof remainingDurationMinutes === 'function'
          ? remainingDurationMinutes(fill.h)
          : (remainingChunks(fill.h)[0] || 0))
        : clampDuration(fill.h.durationMinutes);
      if(durMin <= 0)continue;
      if(durMin > state.remaining && state.usedMinutes > 0)continue;
      const overflowStart = state.slots.reduce((max,slot)=>Math.max(max,slot.end),Math.max(state.dayBase,state.startClock));
      const cost = durMin * 60000;
      const fit = {
        placeStart:overflowStart,
        placeEnd:overflowStart + cost,
        locId:null,
        edge:{seconds:0,metres:0,provider:'none'},
        travelMin:0,
        durMin,
        slotClock:overflowStart,
        preferredHit:false,
        placeKey:fill.h && fill.h.breakable ? `${fill.i}:0` : fill.i
      };
      if(fill.h && fill.h.breakable){
        fill.chunkMinutes = durMin;
        fill.chunkIndex = 0;
        fill.placeKey = fit.placeKey;
      }
      commitPlacement(state,fill,fit);
    }
  }
  enforcePersistentLinkInvariants([state],ordered,settings);
  agenda.usedMinutes = state.usedMinutes;
  agenda.remainingMinutes = Math.max(0,(Number(agenda.totalMinutes) || 0) - state.usedMinutes);
  if(opts.diagnostics)agenda.placementDiagnostics = buildPlacementDiagnostics(ordered,state);
  agenda.agendaItems = (agenda.agendaItems || []).filter(item=>state.placed.has(item.i));
  return finalizePlacementRows(state);
}

// PURE: today's timeline — thin wrapper over buildDayTimeline so the existing
// single-day callers are unchanged. Derives the day context from `now`.
function buildTodayTimeline(agenda,now = Date.now(),opts = {}){
  return buildDayTimeline(agenda,{...opts,now});
}

// PURE: total incomplete minutes represented by one today's-agenda candidate.
function todayCandidateLoadMinutes(h,dayBase){
  if(!h)return 0;
  if(h.breakable){
    if(typeof breakableBudgetMinutes === 'function')return h.type === 'task'
      ? breakableBudgetMinutes(h)
      : breakableBudgetMinutes(h,dayBase);
    if(typeof remainingDurationMinutes === 'function')return remainingDurationMinutes(h,dayBase);
  }
  return clampDuration(h.durationMinutes);
}

// PURE: clock when a committed fill's inbound travel begins (floored at
// `floorTs`). Matches homeDaySequence / reconcileCommittedTravel paint so open
// gaps never include minutes that will be drawn as commute.
function inboundOccupiedStart(fit,floorTs){
  const travelMs = Math.max(0,Number(fit && fit.edge && fit.edge.seconds) || 0) * 1000;
  const start = (Number(fit && fit.placeStart) || 0) - travelMs;
  return Math.max(Number(floorTs) || 0, start);
}

// PURE: open sub-intervals after every committed fill, used only to explain
// why a remaining candidate could not fit the final placement state.
function remainingPlacementGaps(state){
  if(!state || !Array.isArray(state.slots))return [];
  const chron = (state.fills || []).slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  const gaps = [];
  for(const slot of state.slots){
    let cursor = Math.max(slot.start,state.startClock);
    for(const entry of chron){
      const fit = entry && entry.fit;
      if(!fit || fit.placeStart >= slot.end || fit.placeEnd <= cursor)continue;
      const occupiedStart = inboundOccupiedStart(fit,slot.start);
      if(occupiedStart > cursor)gaps.push({start:cursor,end:Math.min(occupiedStart,slot.end)});
      cursor = Math.max(cursor,fit.placeEnd);
      if(cursor >= slot.end)break;
    }
    if(cursor < slot.end)gaps.push({start:cursor,end:slot.end});
  }
  return gaps.filter(g=>g.end > g.start);
}

function computeDayFreeGaps(day,settings,now = Date.now()){
  const empty = {gaps:[],busy:[],totalFreeMinutes:0,largestGapMinutes:0,nextGapStart:null,windowStart:null,windowEnd:null};
  if(!day || day.dayBase == null)return empty;
  const dayBase = day.dayBase;
  const dayEnd = dayBase + 86400000;
  const dayKey = dateKey(dayBase);
  const clipStart = day.isToday ? Math.max(dayBase,ceilToMinutes(now,5)) : dayBase;
  if(clipStart >= dayEnd)return empty;
  const occupied = agendaBlockedIntervals(dayKey,settings,dayBase,dayEnd)
    .map(b=>({start:b.start,end:b.end}));
  for(const row of day.timeline || []){
    if(row.kind === 'fill' || row.kind === 'scheduled' || row.kind === 'travel'){
      if(row.end > clipStart && row.start < dayEnd){
        occupied.push({start:Math.max(row.start,clipStart),end:Math.min(row.end,dayEnd)});
      }
    }
  }
  const merged = mergeIntervals(occupied
    .map(b=>({start:Math.max(dayBase,b.start),end:Math.min(dayEnd,b.end)}))
    .filter(b=>b.end > b.start));
  const gaps = [];
  let cursor = clipStart;
  for(const block of merged){
    if(block.start > cursor)gaps.push({start:cursor,end:block.start});
    cursor = Math.max(cursor,block.end);
  }
  if(cursor < dayEnd)gaps.push({start:cursor,end:dayEnd});
  const busy = merged
    .map(b=>({start:Math.max(b.start,clipStart),end:Math.min(b.end,dayEnd)}))
    .filter(b=>b.end > b.start);
  const totalFreeMinutes = gaps.reduce((s,g)=>s + Math.round((g.end - g.start) / 60000),0);
  const largestGapMinutes = gaps.reduce((m,g)=>Math.max(m,Math.round((g.end - g.start) / 60000)),0);
  const nextGapStart = gaps.length ? gaps[0].start : null;
  return {gaps,busy,totalFreeMinutes,largestGapMinutes,nextGapStart,windowStart:clipStart,windowEnd:dayEnd};
}

// PURE: can one remaining fill use this exact final gap? `ignoreBudget` keeps
// every other hard constraint intact while removing only the availability cap,
// which lets the audit distinguish a placement miss from an intentional cap.
function auditFillFitInGap(state,fill,gap,remainingMinutes,ignoreBudget = false){
  if(!state || !fill || !fill.h || !gap || gap.end <= gap.start)return null;
  const clone = clonePlacementState(state);
  clone.slots = [{start:gap.start,end:gap.end}];
  if(ignoreBudget)clone.remaining = 1000000;
  const auditFill = {...fill,placeKey:`audit:${fill.i}`};
  if(fill.h.breakable){
    const min = typeof clampMinChunk === 'function'
      ? clampMinChunk(fill.h.minChunkMinutes)
      : Math.max(1,Number(fill.h.minChunkMinutes) || 30);
    const result = largestFeasibleBreakableFit(
      clone,
      auditFill,
      remainingMinutes,
      min,
      {allowNetwork:false}
    );
    return result && result.fit || null;
  }
  return tryPlaceOnDay(clone,auditFill,{allowNetwork:false});
}

// PURE: inspect the exact final state produced by the placement engine. A gap
// is a missed opportunity only when an unplaced candidate still fits that gap
// with the current budget and every hard constraint enforced.
function buildPlacementGapAudit(ordered,state,items){
  const byIndex = new Map((ordered || []).map(fill=>[fill.i,fill]));
  const remaining = (items || []).filter(item=>item.remainingMinutes > 0);
  const gaps = remainingPlacementGaps(state).map(gap=>{
    const minutes = Math.max(0,Math.floor((gap.end - gap.start) / 60000));
    const feasibleCandidateIndices = [];
    const budgetLimitedCandidateIndices = [];
    for(const item of remaining){
      const fill = byIndex.get(item.i);
      if(!fill)continue;
      if(auditFillFitInGap(state,fill,gap,item.remainingMinutes,false)){
        feasibleCandidateIndices.push(item.i);
        continue;
      }
      if(auditFillFitInGap(state,fill,gap,item.remainingMinutes,true)){
        budgetLimitedCandidateIndices.push(item.i);
      }
    }
    return {start:gap.start,end:gap.end,minutes,feasibleCandidateIndices,budgetLimitedCandidateIndices};
  }).filter(gap=>gap.minutes > 0);
  return {
    openSlotMinutes:(state.slots || []).reduce((sum,slot)=>sum + Math.max(0,Math.floor((slot.end - Math.max(slot.start,state.startClock)) / 60000)),0),
    openGapMinutes:gaps.reduce((sum,gap)=>sum + gap.minutes,0),
    largestGapMinutes:gaps.reduce((max,gap)=>Math.max(max,gap.minutes),0),
    gaps
  };
}

function largestGapMinutes(gaps,window){
  return (gaps || []).reduce((max,gap)=>{
    const start = window ? Math.max(gap.start,window.start) : gap.start;
    const end = window ? Math.min(gap.end,window.end) : gap.end;
    return Math.max(max,Math.floor(Math.max(0,end - start) / 60000));
  },0);
}

// PURE: concise best-effort explanation against the final state. The scheduler
// remains authoritative; this only identifies the first hard constraint that
// makes the remaining minimum session impossible.
function explainUnplacedAgendaFill(state,fill,remainingLoad){
  const h = fill && fill.h;
  if(!state || !h)return 'not accepted by the placement pass';
  const remaining = Math.max(0,Math.round(Number(remainingLoad) || 0));
  const needed = h.breakable
    ? Math.min(remaining,typeof clampMinChunk === 'function' ? clampMinChunk(h.minChunkMinutes) : (h.minChunkMinutes || 30))
    : clampDuration(h.durationMinutes);
  if(needed <= 0)return 'no outstanding duration';
  const budget = Math.max(0,Math.floor(Number(state.remaining) || 0));
  if(state.usedMinutes > 0 && budget < needed){
    return `agenda budget has ${budget}m left; needs ${needed}m`;
  }

  const gaps = remainingPlacementGaps(state);
  const maxGap = largestGapMinutes(gaps);
  if(maxGap < needed)return `largest open gap is ${maxGap}m; needs ${needed}m`;

  const hardWindows = fillDayWindows(h,state.dayBase,state.seedLocId);
  if(hardWindows){
    const inWindow = hardWindows.reduce(
      (max,win)=>Math.max(max,largestGapMinutes(gaps,win)),0);
    if(inWindow < needed)return `allowed window has no ${needed}m open gap`;
  }

  const locIds = normalizeLocationIds(h.locationIds,state.registry);
  if(locIds.length){
    let locationGap = 0;
    for(const id of locIds){
      const loc = state.registry.find(item=>item.id === id);
      for(const iv of effectiveLocationWindow(h,loc,state.weekday,state.dayBase)){
        const win = {start:state.dayBase + iv.start * 60000,end:state.dayBase + iv.end * 60000};
        locationGap = Math.max(locationGap,largestGapMinutes(gaps,win));
      }
    }
    if(locationGap < needed)return `location hours leave no ${needed}m open gap`;
  }

  const locId = fill.locationId || pickHabitLocationId(h,state.seedLocId,state.registry,state.mode);
  if(locId){
    const edge = travelEdgeBetweenIds(state.seedLocId,locId,state.registry,state.mode,{allowNetwork:false});
    const travelMin = Math.ceil((edge.seconds || 0) / 60);
    if(travelMin > 0 && maxGap < needed + travelMin){
      return `${travelMin}m travel plus ${needed}m work does not fit`;
    }
  }
  return 'higher-ranked work claimed the compatible gap';
}

// PURE: compact summary attached to an agenda after its placement pass.
function buildPlacementDiagnostics(ordered,state){
  const placedByIndex = new Map();
  for(const entry of state.fills || []){
    const i = entry && entry.fill && entry.fill.i;
    if(i == null)continue;
    placedByIndex.set(i,(placedByIndex.get(i) || 0) + Math.max(0,Math.round(Number(entry.fit && entry.fit.durMin) || 0)));
  }
  const items = (ordered || []).map(fill=>{
    const loadMinutes = todayCandidateLoadMinutes(fill.h,state.dayBase);
    const placedMinutes = Math.min(loadMinutes,placedByIndex.get(fill.i) || 0);
    const remainingMinutes = Math.max(0,loadMinutes - placedMinutes);
    return {
      i:fill.i,
      loadMinutes,
      placedMinutes,
      remainingMinutes,
      reason:remainingMinutes > 0 ? explainUnplacedAgendaFill(state,fill,remainingMinutes) : ''
    };
  });
  const placements = (state.fills || []).map(entry=>({
    i:entry.fill.i,
    start:entry.fit.placeStart,
    end:entry.fit.placeEnd,
    minutes:Math.max(0,Math.round(Number(entry.fit.durMin) || 0)),
    travelMinutes:Math.max(0,Math.ceil((Number(entry.fit.edge && entry.fit.edge.seconds) || 0) / 60))
  })).sort((a,b)=>a.start - b.start);
  return {
    placedMinutes:[...placedByIndex.values()].reduce((sum,value)=>sum + value,0),
    travelMinutes:Math.max(0,Math.round(state.usedMinutes - [...placedByIndex.values()].reduce((sum,value)=>sum + value,0))),
    budgetMinutes:Math.max(0,Math.round(state.totalMinutes)),
    usedMinutes:Math.max(0,Math.round(state.usedMinutes)),
    remainingMinutes:Math.max(0,Math.round(state.remaining)),
    items,
    placements,
    gapAudit:buildPlacementGapAudit(ordered,state,items)
  };
}

// PURE: recover a final placement state from the exact day model rendered on
// Home. This is essential when the async optimizer replaced the fast planner:
// rebuilding would audit a different agenda than the cards the user sees.
function diagnosticsFromRenderedDay(data,settings,day){
  if(!day)return null;
  const slots = Array.isArray(day.slots) ? day.slots : [];
  const startClock = slots.length
    ? slots.reduce((min,slot)=>Math.min(min,slot.start),slots[0].start)
    : day.dayBase;
  const state = createDayPlacementState(day,settings,{
    dayBase:day.dayBase,
    weekday:day.weekday,
    startClock
  });
  const candidates = [];
  for(let i = 0;i < data.length;i += 1){
    const h = data[i];
    if(!h || (h.type === 'task' && h.eventTime !== null))continue;
    const pinned = isWeekPinnedToday(h,settings);
    if((pinned && day.isToday) || (!pinned && isWeekCandidate(h,settings,day.dayBase,day.weekday))){
      candidates.push({h,i,priority:effectivePriority(h)});
    }
  }

  const timeline = Array.isArray(day.timeline) ? day.timeline : [];
  const travels = timeline.filter(row=>row.kind === 'travel');
  const chunkCounts = new Map();
  state.fills = timeline.filter(row=>row.kind === 'fill').map(row=>{
    const h = data[row.i] || row.h;
    const chunkIndex = row.chunkIndex != null ? row.chunkIndex : (chunkCounts.get(row.i) || 0);
    chunkCounts.set(row.i,chunkIndex + 1);
    const placeKey = h && h.breakable ? `${row.i}:${chunkIndex}` : row.i;
    const travel = travels.find(item=>Math.abs(item.end - row.start) < 1000
      && (!row.locationId || !item.to || item.to === row.locationId));
    const seconds = Math.max(0,Number(travel && travel.seconds) || 0);
    const fill = {
      h,i:row.i,priority:effectivePriority(h),
      chunkMinutes:row.chunkMinutes != null ? row.chunkMinutes : Math.round((row.end - row.start) / 60000),
      chunkIndex,
      placeKey
    };
    const fit = {
      placeStart:row.start,
      placeEnd:row.end,
      locId:row.locationId || null,
      edge:{seconds,metres:Number(travel && travel.metres) || 0,provider:travel && travel.provider || 'snapshot'},
      travelMin:Math.ceil(seconds / 60),
      durMin:Math.max(0,Math.round((row.end - row.start) / 60000)),
      slotStart:row.start,
      prevLocId:travel && travel.from || null,
      placeKey
    };
    state.placed.add(placeKey);
    state.placed.add(row.i);
    return {fill,fit,slotStart:fit.slotStart};
  });
  state.usedMinutes = Math.max(0,Number(day.usedMinutes) || 0);
  state.remaining = Math.max(0,(Number(day.totalMinutes) || 0) - state.usedMinutes);
  return buildPlacementDiagnostics(candidates,state);
}

// PURE: compact same-day clock labels for the decision trace. These are the
// resolved windows the placer actually saw, including both pieces of a daily
// overnight window (for example 12:00 AM–1:00 PM and 9:45 PM–12:00 AM).
function plannerTraceWindowLabels(windows){
  return (windows || []).filter(win=>win && win.end > win.start).map(win=>
    `${agendaTimeLabel(win.start)}–${agendaTimeLabel(win.end)}`
  );
}

function plannerTraceScarcityInput(score){
  if(!Number.isFinite(score))return '';
  if(score >= SCARCITY_UNBOUNDED){
    return 'scarcity unbounded/flexible';
  }
  const preferredOnly = score >= 500000;
  const local = preferredOnly ? score - 500000 : score;
  const feasibleSlots = Math.max(0,Math.floor(local / 10000));
  const slackMinutes = Math.max(0,Math.round(local % 10000));
  return `scarcity ${preferredOnly ? 'preferred-window' : 'hard-window'}: ${feasibleSlots} feasible slot${feasibleSlots === 1 ? '' : 's'}, ${slackMinutes}m window slack`;
}

// PURE: earliest fit using clock geometry only. This intentionally does not
// pretend to reproduce location, travel, budget, ordering, or the whole-day
// optimizer objective. Comparing it with the selected start makes surprising
// delays visible while keeping the trace cheap and honest.
function plannerTraceEarliestClockFit(h,i,dayBase,dayEnd,rangeStart,rawBlocks,agendaRows,neededMinutes){
  if(!h || neededMinutes <= 0)return null;
  const windows = (typeof hasTimeWindow === 'function' && hasTimeWindow(h))
    ? (fillDayWindows(h,dayBase,null) || [])
    : [{start:dayBase,end:dayEnd}];
  if(!windows.length)return null;
  const occupied = [];
  for(const block of rawBlocks || []){
    occupied.push({start:block.start,end:block.end});
  }
  for(const row of agendaRows || []){
    if(row.i === i)continue;
    occupied.push({start:row.start,end:row.end});
  }
  const merged = mergeIntervals(occupied
    .map(block=>({
      start:Math.max(dayBase,block.start),
      end:Math.min(dayEnd,block.end)
    }))
    .filter(block=>block.end > block.start));
  const cost = neededMinutes * 60000;
  for(const window of windows){
    const start = Math.max(rangeStart,dayBase,window.start);
    const end = Math.min(dayEnd,window.end);
    if(end - start < cost)continue;
    let cursor = start;
    for(const block of merged){
      if(block.end <= cursor)continue;
      if(block.start >= end)break;
      if(block.start - cursor >= cost)return cursor;
      cursor = Math.max(cursor,block.end);
      if(cursor + cost > end)break;
    }
    if(cursor + cost <= end)return cursor;
  }
  return null;
}

// PURE: a readable planner decision trace assembled only when the hidden audit
// is requested. It exposes inputs, resolved constraints, ranking signals, and
// final outcomes; it is not a continuous log and does not rerun the optimizer.
function buildPlannerDecisionTrace(data,settings,context){
  const {
    agenda,agendaRows,dayBase,dayEnd,rangeStart,rawBlocks,eligible,
    unplacedItems,plannerEngine,candidateMeta:providedCandidateMeta
  } = context;
  const registry = typeof normalizeLocationRegistry === 'function'
    ? normalizeLocationRegistry(settings && settings.locations) : [];
  const unplacedByIndex = new Map((unplacedItems || []).map(item=>[item.i,item]));
  const placedByIndex = new Map();
  for(const row of agendaRows || []){
    if(row.kind !== 'fill' || row.i == null)continue;
    if(!placedByIndex.has(row.i))placedByIndex.set(row.i,[]);
    placedByIndex.get(row.i).push(row);
  }
  const candidateMeta = providedCandidateMeta instanceof Map
    ? providedCandidateMeta
    : new Map((agenda && agenda.agendaItems || [])
      .filter(item=>item && item.i != null)
      .map(item=>[item.i,item]));
  const constraints = typeof plannerOrderConstraintsForDay === 'function'
    ? plannerOrderConstraintsForDay(dayBase) : [];
  const nameByHid = new Map((data || [])
    .filter(h=>h && h.hid)
    .map(h=>[h.hid,h.name || 'item']));
  const trace = [];

  for(const row of (agendaRows || []).filter(item=>item.kind === 'scheduled')){
    trace.push({
      i:row.i,
      name:row.name,
      status:'fixed',
      selected:`${agendaTimeLabel(row.start)}–${agendaTimeLabel(row.end)}`,
      earliestClockFit:row.start,
      decision:'fixed event time; fills were packed around this hard reservation',
      inputs:[`duration ${Math.max(0,Math.round((row.end - row.start) / 60000))}m`],
      engine:'fixed schedule',
      score:null,
      scoreTerms:null,
      optimizerWeight:null
    });
  }

  for(const i of eligible || []){
    const h = data[i];
    if(!h)continue;
    const rows = (placedByIndex.get(i) || []).slice().sort((a,b)=>a.start - b.start);
    const meta = candidateMeta.get(i) || {};
    const unplaced = unplacedByIndex.get(i);
    const duration = todayCandidateLoadMinutes(h,dayBase);
    const minChunk = h.breakable
      ? (typeof clampMinChunk === 'function' ? clampMinChunk(h.minChunkMinutes) : Math.max(1,h.minChunkMinutes || 30))
      : duration;
    const hardWindows = (typeof hasTimeWindow === 'function' && hasTimeWindow(h))
      ? (fillDayWindows(h,dayBase,null) || []) : [];
    const preferredWindow = (typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(h))
      ? fillPreferredWindow(h,dayBase,null) : null;
    const hardLabels = plannerTraceWindowLabels(hardWindows);
    const preferredLabels = plannerTraceWindowLabels(preferredWindow ? [preferredWindow] : []);
    const locationIds = typeof normalizeLocationIds === 'function'
      ? normalizeLocationIds(h.locationIds,registry) : [];
    const locationNames = locationIds.map(id=>{
      const loc = registry.find(item=>item.id === id);
      return loc && loc.name || id;
    });
    const priority = effectivePriority(h);
    const urgency = typeof weekUrgency === 'function' ? weekUrgency(h) : 0;
    const attention = typeof attentionScore === 'function'
      ? attentionScore(h,i,settings) : null;
    const pinned = typeof isWeekPinnedToday === 'function'
      ? isWeekPinnedToday(h,settings) : Boolean(h.pinned);
    const orderInputs = [];
    if(h.hid){
      for(const edge of constraints){
        if(edge.beforeHid === h.hid){
          orderInputs.push(`before ${nameByHid.get(edge.afterHid) || 'linked item'}${edge.adjacency === 'direct' ? ' directly' : ''}`);
        }
        if(edge.afterHid === h.hid){
          orderInputs.push(`after ${nameByHid.get(edge.beforeHid) || 'linked item'}${edge.adjacency === 'direct' ? ' directly' : ''}`);
        }
      }
    }
    const inputs = [
      `duration ${duration}m${h.breakable ? `; breakable, ${minChunk}m minimum chunk` : ''}`,
      `${PRIORITY_LABELS[priority] || `P${priority}`} priority`,
      `urgency ${Math.round(urgency)}`,
      Number.isFinite(attention) ? `attention ${attention.toFixed(2)}` : '',
      plannerTraceScarcityInput(meta.scarcity),
      pinned ? 'pinned to today' : 'not pinned',
      hardLabels.length ? `allowed ${hardLabels.join('; ')}` : 'allowed any open scheduler time',
      preferredLabels.length ? `preferred ${preferredLabels.join('; ')}` : '',
      locationNames.length ? `locations ${locationNames.join(', ')}` : 'no location constraint',
      orderInputs.length ? `order ${orderInputs.join('; ')}` : ''
    ].filter(Boolean);
    const earliestClockFit = plannerTraceEarliestClockFit(
      h,i,dayBase,dayEnd,rangeStart,rawBlocks,agendaRows,minChunk
    );
    const first = rows[0] || null;
    const selected = rows.length
      ? rows.map(row=>`${agendaTimeLabel(row.start)}–${agendaTimeLabel(row.end)}`).join('; ')
      : 'not placed';
    let decision = '';
    if(!rows.length){
      decision = unplaced && unplaced.reason || 'not committed by the placement pass';
    }else{
      const adjacent = [];
      for(const block of rawBlocks || []){
        if(Math.abs(block.end - first.start) <= 60000)adjacent.push(block.label || 'blocked time');
      }
      for(const row of agendaRows || []){
        if(row.i === i)continue;
        if(Math.abs(row.end - first.start) <= 60000)adjacent.push(row.name);
      }
      if(rows.length > 1){
        decision = `split into ${rows.length} valid chunks`;
      }else if(earliestClockFit != null && Math.abs(first.start - earliestClockFit) <= 60000){
        decision = `selected the earliest open clock-fit boundary${adjacent.length ? ` after ${[...new Set(adjacent)].join(', ')}` : ''}`;
      }else if(earliestClockFit != null && first.start > earliestClockFit + 60000){
        decision = `selected ${agendaTimeLabel(first.start)}; an earlier clock-only fit begins ${agendaTimeLabel(earliestClockFit)}, so full location, travel, order, budget, and whole-day competition determined the later choice`;
      }else{
        decision = `selected a compatible non-overlapping slot${adjacent.length ? ` after ${[...new Set(adjacent)].join(', ')}` : ''}`;
      }
      if(unplaced && unplaced.remainingMinutes > 0){
        decision += `; ${unplaced.remainingMinutes}m remains because ${unplaced.reason}`;
      }
    }
    const scoreRow = rows.find(row=>Number.isFinite(row.plannerScore)
      || Number.isFinite(row.optimizerWeight)) || first;
    trace.push({
      i,
      name:h.name,
      status:rows.length ? (unplaced ? 'partial' : 'placed') : 'unplaced',
      selected,
      earliestClockFit,
      decision,
      inputs,
      engine:rows.length
        ? (Number.isFinite(scoreRow && scoreRow.optimizerWeight)
          ? 'exact optimizer'
          : (h.breakable ? 'continuous gap fill' : plannerEngine))
        : plannerEngine,
      score:Number.isFinite(scoreRow && scoreRow.plannerScore) ? scoreRow.plannerScore : null,
      scoreTerms:scoreRow && scoreRow.plannerScoreTerms || null,
      optimizerWeight:Number.isFinite(scoreRow && scoreRow.optimizerWeight)
        ? scoreRow.optimizerWeight : null,
      optimizerCandidateWeight:Number.isFinite(scoreRow && scoreRow.optimizerCandidateWeight)
        ? scoreRow.optimizerCandidateWeight : null,
      optimizerDelayMinutes:Number.isFinite(scoreRow && scoreRow.optimizerDelayMinutes)
        ? scoreRow.optimizerDelayMinutes : null,
      scarcity:Number.isFinite(meta.scarcity) ? meta.scarcity : null
    });
  }
  return trace.sort((a,b)=>{
    const aTime = a.status === 'unplaced' ? Infinity
      : ((agendaRows || []).find(row=>row.i === a.i)?.start ?? a.earliestClockFit ?? Infinity);
    const bTime = b.status === 'unplaced' ? Infinity
      : ((agendaRows || []).find(row=>row.i === b.i)?.start ?? b.earliestClockFit ?? Infinity);
    return aTime - bTime || String(a.name).localeCompare(String(b.name));
  });
}

// PURE: scorecard model for the hidden day-header diagnostic overlay. Classic
// home uses the single-day agenda; week home uses the same cross-day assignment
// that produced the visible day sections.
function buildDayCapacityScorecard(data,settings,dayBase = dayStart(Date.now()),now = Date.now(),opts = {}){
  dayBase = dayStart(dayBase);
  const dayEnd = dayBase + 24 * 3600000;
  const isToday = dayBase === dayStart(now);
  const rangeStart = isToday ? now : dayBase;
  const dayKey = dateKey(dayBase);
  const totalCapacity = Math.max(0,Math.round((dayEnd - rangeStart) / 60000));
  const rawBlocks = agendaBlockedIntervals(dayKey,settings,dayBase,dayEnd)
    .map(block=>({...block,start:Math.max(rangeStart,block.start),end:Math.min(dayEnd,block.end)}))
    .filter(block=>block.end > block.start);
  const mergedBlocks = mergeIntervals(rawBlocks.map(block=>({start:block.start,end:block.end})));
  const blockedMinutes = mergedBlocks.reduce((sum,block)=>sum + Math.round((block.end - block.start) / 60000),0);
  const netAvailable = Math.max(0,totalCapacity - blockedMinutes);

  let agenda;
  let diagnostics;
  let timeline = [];
  let week = null;
  if(opts.weekMode){
    const snapshot = opts.weekSnapshot && Array.isArray(opts.weekSnapshot.days)
      ? opts.weekSnapshot : null;
    const dayOffset = Math.max(0,Math.round((dayBase - dayStart(now)) / 86400000));
    week = snapshot || buildWeekAgenda(data,settings,Math.max(7,dayOffset + 1),{diagnostics:true});
    agenda = week.days.find(day=>day.dayBase === dayBase) || buildDayAgenda(data,settings,dayBase,{weekMode:true});
    diagnostics = snapshot
      ? diagnosticsFromRenderedDay(data,settings,agenda)
      : agenda.placementDiagnostics;
    diagnostics = diagnostics || {items:[],placedMinutes:0,travelMinutes:0};
    timeline = agenda.timeline || [];
  }else{
    agenda = buildTodayAgenda(data,settings);
    timeline = buildTodayTimeline(agenda,now,{diagnostics:true});
    diagnostics = agenda.placementDiagnostics || {items:[],placedMinutes:0,travelMinutes:0};
  }
  const scheduledMinutes = (agenda.scheduled || []).reduce((sum,event)=>{
    const start = Math.max(rangeStart,event.h.eventTime);
    const end = Math.min(dayEnd,event.h.eventTime + clampDuration(event.h.durationMinutes) * 60000);
    return sum + Math.max(0,Math.round((end - start) / 60000));
  },0);
  const diagByIndex = new Map(diagnostics.items.map(item=>[item.i,item]));
  const linkReasonByHid = new Map((agenda.linkOmissions || [])
    .filter(item=>item && item.subjectHid)
    .map(item=>[item.subjectHid,item.reason || 'linked placement could not be honored']));

  const eligible = visibleIndices(data,settings).filter(i=>{
    const h = data[i];
    if(!h || h.type === 'zero')return false;
    if(h.type === 'task' && (isTaskDone(h) || h.eventTime !== null))return false;
    if(!isToday && opts.weekMode){
      return isWeekCandidate(h,settings,dayBase,new Date(dayBase).getDay());
    }
    return includeInTodayAgenda(h,settings) && windowStillDoableToday(h,now);
  });
  const outstandingLoad = eligible.reduce((sum,i)=>sum + todayCandidateLoadMinutes(data[i],dayBase),0);
  const assignedDayByIndex = new Map();
  if(week){
    for(const day of week.days){
      for(const row of day.timeline || []){
        if(row.kind !== 'fill' || row.i == null)continue;
        let assigned = assignedDayByIndex.get(row.i);
        if(!assigned){ assigned = new Set(); assignedDayByIndex.set(row.i,assigned); }
        assigned.add(day.dayBase);
      }
    }
  }
  const assignmentLabel = (i)=>{
    const elsewhere = [...(assignedDayByIndex.get(i) || [])].find(base=>base !== dayBase);
    if(elsewhere == null)return '';
    return homeWeekDayLabel({
      dayBase:elsewhere,
      weekday:new Date(elsewhere).getDay(),
      isToday:elsewhere === dayStart(now),
      offset:Math.round((elsewhere - dayStart(now)) / 86400000)
    },now).toLowerCase();
  };
  const unplacedItems = eligible.map(i=>{
    const h = data[i];
    const loadMinutes = todayCandidateLoadMinutes(h,dayBase);
    const diag = diagByIndex.get(i) || {};
    const placedMinutes = Math.min(loadMinutes,Math.max(0,diag.placedMinutes || 0));
    const remainingMinutes = Math.max(0,loadMinutes - placedMinutes);
    const elsewhereLabel = assignmentLabel(i);
    return {
      i,
      name:h.name,
      type:h.type,
      priority:effectivePriority(h),
      loadMinutes,
      placedMinutes,
      remainingMinutes,
      reason:elsewhereLabel
        ? `assigned ${elsewhereLabel}`
        : (linkReasonByHid.get(h.hid) || diag.reason || (remainingMinutes > 0 ? 'not committed by the placement pass' : '')),
      window:typeof timeWindowSummary === 'function' && hasTimeWindow(h) ? timeWindowSummary(h) : ''
    };
  }).filter(item=>item.remainingMinutes > 0);

  const eligibleSet = new Set(eligible);
  const gapAudit = diagnostics.gapAudit || {openSlotMinutes:0,openGapMinutes:0,largestGapMinutes:0,gaps:[]};
  const placementGaps = (gapAudit.gaps || []).map(gap=>{
    const feasible = (gap.feasibleCandidateIndices || []).filter(i=>eligibleSet.has(i));
    const budgetLimited = (gap.budgetLimitedCandidateIndices || []).filter(i=>eligibleSet.has(i));
    const unassignedFeasible = feasible.filter(i=>!assignmentLabel(i));
    const status = unassignedFeasible.length
      ? 'missed'
      : (feasible.length ? 'assigned-elsewhere' : (budgetLimited.length ? 'budget-capped' : 'no-fit'));
    const candidateNames = (status === 'budget-capped' ? budgetLimited : feasible)
      .slice(0,3)
      .map(i=>data[i] && data[i].name)
      .filter(Boolean);
    let explanation = 'no remaining eligible item satisfies this gap';
    if(status === 'missed')explanation = `${candidateNames.join(', ')} can still fit with current constraints`;
    if(status === 'assigned-elsewhere')explanation = `${candidateNames.join(', ')} fits here but was assigned to another day`;
    if(status === 'budget-capped')explanation = `${candidateNames.join(', ')} fits the clock gap, but not the remaining agenda budget`;
    return {...gap,status,candidateNames,explanation};
  });
  const missedOpportunityCount = placementGaps.filter(gap=>gap.status === 'missed').length;
  const budgetCappedGapCount = placementGaps.filter(gap=>gap.status === 'budget-capped').length;
  const homeTimeline = Array.isArray(agenda.homeDisplayedTimeline)
    ? agenda.homeDisplayedTimeline
    : timeline;
  const mapAgendaRow = row=>({
    kind:row.kind,
    i:row.i != null ? row.i : null,
    name:row.kind === 'travel'
      ? `travel${row.toName ? ` to ${row.toName}` : ''}`
      : (row.h && row.h.name
        || (row.i != null && data[row.i] && data[row.i].name)
        || 'scheduled item'),
    start:row.start,
    end:row.end,
    minutes:Math.max(0,Math.round((row.end - row.start) / 60000)),
    locationId:row.locationId || null,
    plannerScore:Number.isFinite(row.plannerScore) ? row.plannerScore : null,
    plannerScoreTerms:row.plannerScoreTerms || null,
    optimizerWeight:Number.isFinite(row.optimizerWeight) ? row.optimizerWeight : null,
    optimizerCandidateWeight:Number.isFinite(row.optimizerCandidateWeight)
      ? row.optimizerCandidateWeight : null,
    optimizerDelayMinutes:Number.isFinite(row.optimizerDelayMinutes)
      ? row.optimizerDelayMinutes : null
  });
  const agendaRows = homeTimeline
    .filter(row=>row.kind === 'fill' || row.kind === 'scheduled' || row.kind === 'travel')
    .map(mapAgendaRow);
  const traceAgendaRows = timeline
    .filter(row=>row.kind === 'fill' || row.kind === 'scheduled' || row.kind === 'travel')
    .map(mapAgendaRow);
  const schedulerPlacementRowCount = timeline.filter(row=>row.kind === 'fill' || row.kind === 'scheduled').length;
  const displayedPlacementRowCount = homeTimeline.filter(row=>row.kind === 'fill' || row.kind === 'scheduled').length;

  const blockedByLabel = new Map();
  for(const block of rawBlocks){
    const label = block.label || 'blocked';
    blockedByLabel.set(label,(blockedByLabel.get(label) || 0) + Math.round((block.end - block.start) / 60000));
  }
  const placementRatio = netAvailable > 0 ? outstandingLoad / netAvailable : (outstandingLoad > 0 ? Infinity : 0);
  const plannerIsPreview = Boolean(week && !week.optimized && settings && settings.agendaOptimizer);
  const plannerEngine = week
    ? (week.optimized ? 'exact optimizer'
      : (plannerIsPreview ? 'fast preview/fallback' : 'fast scarcity planner'))
    : 'fast day planner';
  const traceCandidateMeta = new Map();
  const metaDays = week && Array.isArray(week.days) ? week.days : [agenda];
  for(const metaDay of metaDays){
    for(const item of metaDay && metaDay.agendaItems || []){
      if(item && item.i != null && !traceCandidateMeta.has(item.i)){
        traceCandidateMeta.set(item.i,item);
      }
    }
  }
  const plannerTrace = buildPlannerDecisionTrace(data,settings,{
    agenda,agendaRows:traceAgendaRows,dayBase,dayEnd,rangeStart,rawBlocks,eligible,
    unplacedItems,plannerEngine,candidateMeta:traceCandidateMeta
  });
  return {
    generatedAt:now,
    usesRenderedSnapshot:Boolean(opts.weekMode && opts.weekSnapshot),
    dayBase,
    dayKey,
    isToday,
    rangeStart,
    dayEnd,
    totalCapacity,
    blockedMinutes,
    netAvailable,
    outstandingLoad,
    placementRatio,
    surplusMinutes:netAvailable - outstandingLoad,
    scheduledMinutes,
    agendaBudgetMinutes:Math.max(0,Math.round(agenda.totalMinutes || 0)),
    agendaUsedMinutes:Math.max(0,Math.round(agenda.usedMinutes || 0)),
    placedLoadMinutes:Math.max(0,Math.round(diagnostics.placedMinutes || 0)),
    travelMinutes:Math.max(0,Math.round(diagnostics.travelMinutes || 0)),
    eligibleCount:eligible.length,
    eligibleCoverage:outstandingLoad > 0 ? Math.min(1,(diagnostics.placedMinutes || 0) / outstandingLoad) : 1,
    budgetUtilization:(agenda.totalMinutes || 0) > 0 ? Math.min(1,(agenda.usedMinutes || 0) / agenda.totalMinutes) : 0,
    placementBudgetRemaining:Math.max(0,Math.round(diagnostics.remainingMinutes || 0)),
    schedulerOpenMinutes:Math.max(0,Math.round(gapAudit.openSlotMinutes || 0)),
    openGapMinutes:Math.max(0,Math.round(gapAudit.openGapMinutes || 0)),
    largestGapMinutes:Math.max(0,Math.round(gapAudit.largestGapMinutes || 0)),
    missedOpportunityCount,
    budgetCappedGapCount,
    placementGaps,
    agendaRows,
    plannerEngine,
    plannerIsPreview,
    plannerTraceGeneratedOnDemand:true,
    plannerTrace,
    hiddenAgendaRowCount:Math.max(0,schedulerPlacementRowCount - displayedPlacementRowCount),
    unplacedItems,
    blockedBreakdown:[...blockedByLabel.entries()].map(([label,minutes])=>({label,minutes}))
  };
}

// PURE: mutable placement state for one day. Scheduled tasks are hard rows;
// fills commit only through tryPlaceOnDay / commitPlacement.
function createDayPlacementState(day,settings,opts = {}){
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  const now = opts.now != null ? opts.now : Date.now();
  const dayBase = opts.dayBase != null ? opts.dayBase : (day.dayBase != null ? day.dayBase : dayStart(now));
  const weekday = opts.weekday != null ? opts.weekday : (day.weekday != null ? day.weekday : new Date(dayBase).getDay());
  const isTodayDay = day.isToday != null ? day.isToday : dayStart(now) === dayBase;
  const blocks = normalizeBlockedTimes(settings.blockedTimes);
  const startClock = opts.startClock != null
    ? opts.startClock
    : (isTodayDay
      ? ceilToMinutes(now,5)
      : dayBase + dayFirstOpenMinute(blocks,weekday,dayBase) * 60000);
  const slots = (day.slots && day.slots.length)
    ? day.slots.map(s=>({start:s.start,end:s.end}))
    : [{start:startClock,end:dayBase + 24 * 3600000}];
  const rows = [];
  (day.scheduled || []).forEach(ev=>{
    const end = ev.h.eventTime + clampDuration(ev.h.durationMinutes) * 60000;
    const locIds = normalizeLocationIds(ev.h.locationIds,registry);
    const locationId = pickHabitLocationId(ev.h,null,registry,mode) || locIds[0] || null;
    rows.push({ kind:'scheduled', h:ev.h, i:ev.i, start:ev.h.eventTime, end, hard:true, locationId });
  });
  let prevLocId = isTodayDay
    ? ((typeof currentLocationId === 'function' && currentLocationId()) || settings.lastKnownLocationId || null)
    : (blockLocationAtMinute(blocks,Math.floor((startClock - dayBase) / 60000),weekday,dayBase)
      || blockLocationAtMinute(blocks,Math.max(0,dayFirstOpenMinute(blocks,weekday,dayBase) - 1),weekday,dayBase)
      || null);
  return {
    day,
    dayBase,
    weekday,
    isTodayDay,
    settings,
    registry,
    registryById:new Map(registry.map(loc=>[loc.id,loc])),
    mode,
    slots,
    startClock,
    remaining:Math.max(0,(Number(day.totalMinutes) || 0)),
    totalMinutes:Math.max(0,Number(day.totalMinutes) || 0),
    usedMinutes:0,
    seedLocId:prevLocId,
    prevLocId,
    rows,
    fills:[],
    placed:new Set()
  };
}

// PURE: snapshot mutable fields so week scoring can dry-run without commit.
function clonePlacementState(state){
  return {
    ...state,
    slots:state.slots,
    rows:state.rows.slice(),
    fills:state.fills.slice(),
    placed:new Set(state.placed),
    remaining:state.remaining,
    usedMinutes:state.usedMinutes,
    prevLocId:state.prevLocId,
    registryById:state.registryById
  };
}

// Sentinel: no hard window / unbounded slack. Scarcity sorts put these last.
const SCARCITY_UNBOUNDED = 1e9;

// PURE: session duration for a fill (chunk-aware).
function fillDurationMinutes(fill){
  if(!fill || !fill.h)return 0;
  if(fill.chunkMinutes != null)return Math.max(1,Math.round(fill.chunkMinutes));
  if(fill.h.breakable){
    const chunks = typeof remainingChunks === 'function' ? remainingChunks(fill.h) : [];
    return chunks[0] || clampDuration(fill.h.durationMinutes);
  }
  return clampDuration(fill.h.durationMinutes);
}

// PURE: minutes of allowed/preferred-window slack beyond the session duration,
// or SCARCITY_UNBOUNDED when the habit has neither. Hard allowed windows stay
// the tightest; preferred-only habits still beat pure flex so morning ASAP
// fills cannot blank an entire week of evening-preferring work.
function windowSlackMinutes(h,dayState,contextLocId){
  if(!h || !dayState)return SCARCITY_UNBOUNDED;
  const loc = contextLocId != null ? contextLocId : dayState.seedLocId;
  let win = null;
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(h)){
    win = fillTimeWindow(h,dayState.dayBase,loc);
  }else if(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(h)){
    win = fillPreferredWindow(h,dayState.dayBase,loc);
  }
  if(!win)return SCARCITY_UNBOUNDED;
  const span = Math.max(0,(win.end - win.start) / 60000);
  return Math.max(0,span - clampDuration(h.durationMinutes));
}

// PURE: how many distinct open slots could still fit this fill (dry-run).
// Pauses OSRM so scarcity scoring cannot stampede the travel network.
function feasibleStartCount(h,dayState,fillExtras = {}){
  if(!h || !dayState || !Array.isArray(dayState.slots))return 0;
  const fill = Object.assign({h,i:-1},fillExtras);
  const run = ()=>{
    let count = 0;
    for(const slot of dayState.slots){
      const clone = clonePlacementState(dayState);
      clone.slots = [slot];
      if(tryPlaceOnDay(clone,fill,{allowNetwork:false}))count += 1;
    }
    return count;
  };
  return typeof withTravelNetworkPaused === 'function' ? withTravelNetworkPaused(run) : run();
}

// PURE: lower = tighter. Combines feasible-slot count (primary) with window
// slack (secondary). Hard allowed windows beat preferred-only; both beat
// pure flex (unbounded), so availability is not burned ASAP in the morning
// while later open gaps (and the habits that want them) stay blank all week.
function scarcityScore(candidate,dayStates){
  const run = ()=>scarcityScoreInner(candidate,dayStates);
  return typeof withTravelNetworkPaused === 'function' ? withTravelNetworkPaused(run) : run();
}
function scarcityScoreInner(candidate,dayStates){
  const h = candidate && candidate.h;
  if(!h)return SCARCITY_UNBOUNDED;
  const hard = typeof hasTimeWindow === 'function' && hasTimeWindow(h);
  const soft = typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(h);
  if(!hard && !soft)return SCARCITY_UNBOUNDED;
  // Preferred-only sorts after every hard-window habit, before unbounded flex.
  const softBias = hard ? 0 : 500000;
  const states = Array.isArray(dayStates) ? dayStates : [];
  if(!states.length){
    const todayBase = dayStart(Date.now());
    const win = hard ? fillTimeWindow(h,todayBase,null) : fillPreferredWindow(h,todayBase,null);
    if(!win)return SCARCITY_UNBOUNDED;
    const slack = Math.max(0,(win.end - win.start) / 60000 - clampDuration(h.durationMinutes));
    return softBias + Math.min(slack,9999);
  }
  let minFeasible = Infinity;
  let minSlack = Infinity;
  let any = false;
  let anyFeasible = false;
  for(const state of states){
    if(candidate.eligible && !candidate.eligible.has(state.dayBase))continue;
    any = true;
    const fill = {h,i:candidate.i,priority:candidate.priority};
    const n = feasibleStartCount(h,state,fill);
    // A zero means this candidate cannot use that day at all; treating zero as
    // "most scarce" lets a broad multi-day item jump ahead of a genuinely
    // narrow item on a different feasible day. Rank by the tightest POSITIVE
    // option count, and put candidates with no feasible day at the back.
    if(n > 0){
      anyFeasible = true;
      if(n < minFeasible)minFeasible = n;
    }
    const slack = windowSlackMinutes(h,state);
    if(slack < minSlack)minSlack = slack;
  }
  if(!any)return SCARCITY_UNBOUNDED;
  if(!anyFeasible)return SCARCITY_UNBOUNDED;
  if(minSlack === Infinity)minSlack = SCARCITY_UNBOUNDED;
  return softBias + minFeasible * 10000 + Math.min(minSlack,9999);
}

function isScarceScore(score){
  return Number.isFinite(score) && score < SCARCITY_UNBOUNDED;
}

// PURE: pinned (planned-today) first, then scarcity ASC, priority ASC, urgency.
function compareScarcityThenPriority(a,b){
  const pinA = a.pinned === true;
  const pinB = b.pinned === true;
  if(pinA !== pinB)return pinA ? -1 : 1;
  const sa = a.scarcity != null ? a.scarcity : SCARCITY_UNBOUNDED;
  const sb = b.scarcity != null ? b.scarcity : SCARCITY_UNBOUNDED;
  if(sa !== sb)return sa - sb;
  const pa = a.priority != null ? a.priority : 2;
  const pb = b.priority != null ? b.priority : 2;
  if(pa !== pb)return pa - pb;
  const ua = a.urgency != null ? a.urgency : 0;
  const ub = b.urgency != null ? b.urgency : 0;
  if(ua !== ub)return ub - ua;
  const sca = a.score != null ? a.score : 0;
  const scb = b.score != null ? b.score : 0;
  if(sca !== scb)return scb - sca;
  return (a.rank || 0) - (b.rank || 0);
}

// PURE: allowed windows of scarce candidates on this day — flexible placement
// prefers slots that least overlap these so tight habits keep their gap even
// after they have already been committed (or while still waiting).
function scarceWindowsToSpare(candidates,dayBase,seedLocId,eligibleDayBase){
  const windows = [];
  if(!Array.isArray(candidates))return windows;
  for(const c of candidates){
    if(!c || !c.h)continue;
    const hard = typeof hasTimeWindow === 'function' && hasTimeWindow(c.h);
    const soft = typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(c.h);
    if(!isScarceScore(c.scarcity) && !hard && !soft)continue;
    if(eligibleDayBase != null && c.eligible && !c.eligible.has(eligibleDayBase))continue;
    const resolved = hard
      ? fillDayWindows(c.h,dayBase,seedLocId)
      : [fillPreferredWindow(c.h,dayBase,seedLocId)].filter(Boolean);
    if(resolved)windows.push(...resolved);
  }
  return windows;
}

function fitOverlapWithWindows(fit,windows){
  if(!fit || !windows || !windows.length)return 0;
  let overlap = 0;
  for(const w of windows){
    const start = Math.max(fit.placeStart,w.start);
    const end = Math.min(fit.placeEnd,w.end);
    if(end > start)overlap += end - start;
  }
  return overlap;
}

// PURE: default + settings weights for the unified agenda score (lower = better).
function resolveAgendaScoreWeights(settings){
  if(typeof normalizeAgendaScoreWeights === 'function'){
    return normalizeAgendaScoreWeights(settings && settings.agendaScoreWeights);
  }
  const w = settings && settings.agendaScoreWeights;
  return {
    travel:1, cluster:1, day:1, asap:8, scarce:0.05, preference:1,
    ...(w && typeof w === 'object' ? w : {})
  };
}

// PURE: single comparable placement score. Hard constraints are enforced
// before this runs; every soft signal is a weighted term here.
// terms: {
//   travelSeconds, clusterBonus, coLocHint, dayOffsetPenalty,
//   asapDelayMin, scarceOverlapMs, preferencePenalty, urgency, orderPenalty
// }
function scoreAgendaPlacement(terms,weights){
  const W = weights || resolveAgendaScoreWeights(null);
  const t = terms || {};
  const travel = Number(t.travelSeconds) || 0;
  const cluster = (Number(t.clusterBonus) || 0) + (Number(t.coLocHint) || 0);
  const dayPen = Number(t.dayOffsetPenalty) || 0;
  const urgency = Number(t.urgency) || 0;
  // Within-day ASAP: only the first ~90 minutes of delay matter, so a free
  // day's preferred evening time can still beat "right now", while nearer
  // slots stay ordered. Urgency scales the pressure; day-offset handles
  // today-vs-tomorrow ASAP.
  const asapDelay = Math.min(Math.max(0, Number(t.asapDelayMin) || 0), 90);
  const asap = asapDelay * (1 + urgency / 50);
  const scarce = Number(t.scarceOverlapMs) || 0;
  const pref = Number(t.preferencePenalty) || 0;
  const orderPen = Number(t.orderPenalty) || 0;
  return (W.travel || 0) * travel
    - (W.cluster || 0) * cluster
    + (W.day || 0) * dayPen
    + (W.asap || 0) * asap
    + (W.scarce || 0) * scarce
    + (W.preference || 0) * pref
    + orderPen;
}

// PURE: soft penalty when a fit would break same-day temporary order links.
// sometime: heavy if starting before the predecessor ends.
// direct: prefer the earliest slot after the predecessor (gap becomes cost).
function orderConstraintPenalty(fill,fit,state){
  if(!fill || !fill.h || !fill.h.hid || !fit || !state)return 0;
  const edges = plannerOrderConstraintsForDay(state.dayBase);
  if(!edges.length)return 0;
  const hid = fill.h.hid;
  const placedByHid = new Map();
  for(const entry of state.fills || []){
    const h = entry && entry.fill && entry.fill.h;
    if(h && h.hid && entry.fit)placedByHid.set(h.hid,entry.fit);
  }
  let pen = 0;
  for(const e of edges){
    if(e.afterHid !== hid)continue;
    const pred = placedByHid.get(e.beforeHid);
    if(!pred)continue;
    const predEnd = Number(pred.placeEnd) || 0;
    if(fit.placeStart + 60000 < predEnd){
      // Starting before the predecessor finishes — strong soft violation.
      pen += 8000 + Math.max(0,(predEnd - fit.placeStart) / 60000) * 40;
      continue;
    }
    if(e.adjacency === 'direct'){
      const gapMin = Math.max(0,(fit.placeStart - predEnd) / 60000);
      // Prefer next feasible slot; large gaps drift away from "right after".
      pen += Math.min(120,gapMin) * 6;
    }
  }
  return pen;
}

// PURE: among feasible fits on one day, pick the best by unified score.
function pickBestScoredFit(fits,fill,state,opts = {}){
  if(!fits || !fits.length)return null;
  // Doing-now: always take the earliest feasible start so it stays first.
  if(opts.doingNowStart != null){
    return fits.reduce((best,f)=>!best || f.placeStart < best.placeStart ? f : best,null);
  }
  const weights = opts.weights || resolveAgendaScoreWeights(opts.settings || (state && state.settings));
  const spare = opts.spareWindows || [];
  const urgency = opts.urgency != null ? opts.urgency
    : (typeof weekUrgency === 'function' ? weekUrgency(fill.h) : 0);
  const earliest = fits.reduce((m,f)=>Math.min(m,f.placeStart),fits[0].placeStart);
  let best = null;
  let bestScore = Infinity;
  let bestTerms = null;
  for(const fit of fits){
    const prefPen = typeof weekPreferencePenalty === 'function'
      ? weekPreferencePenalty(fill.h,fit,state,state.registry)
      : (fit.preferredHit ? -40 : 0);
    const terms = {
      travelSeconds:fit.edge && fit.edge.seconds || 0,
      clusterBonus:opts.clusterBonus != null ? opts.clusterBonus : 0,
      coLocHint:opts.coLocHint != null ? opts.coLocHint : 0,
      dayOffsetPenalty:opts.dayOffsetPenalty != null ? opts.dayOffsetPenalty : 0,
      asapDelayMin:(fit.placeStart - earliest) / 60000,
      scarceOverlapMs:fitOverlapWithWindows(fit,spare),
      preferencePenalty:prefPen,
      urgency,
      orderPenalty:orderConstraintPenalty(fill,fit,state)
    };
    const score = scoreAgendaPlacement(terms,weights);
    fit.score = score;
    if(score < bestScore){ bestScore = score; best = fit; bestTerms = terms; }
  }
  // These values were already calculated to choose the fit. Keeping them only
  // on the winning option makes the on-demand day audit explain the decision
  // without enabling a continuous planner log or adding another scoring pass.
  if(best)best.scoreTerms = bestTerms;
  return best;
}

// PURE: attempt to place a fill into this day's open slots under hard
// constraints — availability budget, blocked/scheduled slots, travel time,
// location hours ∩ habit allowed window. Soft choice among feasible fits
// uses the unified agenda score (ASAP, scarce-window overlap, preferences).
// opts.spareWindows: scarce windows to penalize overlapping (soft).
// opts.urgency / opts.weights / opts.settings: scoring context.
function tryPlaceOnDay(state,fill,opts = {}){
  if(typeof plannerPerfCountTryPlace === 'function')plannerPerfCountTryPlace();
  if(!state || !fill || !fill.h)return null;
  const placeKey = fill.placeKey != null ? fill.placeKey : fill.i;
  if(state.placed.has(placeKey))return null;
  const {dayBase,weekday,registry,mode,slots,startClock} = state;
  const registryLookup = id=>{
    if(!id)return null;
    if(state.registryById)return state.registryById.get(id) || null;
    return registry.find(l=>l.id === id) || null;
  };
  const remaining = state.remaining;
  const usedMinutes = state.usedMinutes;
  const resolveLoc = (anchor)=>fill.locationId || pickHabitLocationId(fill.h,anchor,registry,mode);
  const fits = [];

  // Chronological list of all committed fills, reused per gap so the travel
  // anchor reflects the location active at each gap's start (not just the
  // tail of the slot). The placement loop walks every open gap inside each
  // slot — including gaps BEFORE already-committed fills — so a scarce item
  // whose window opens earlier than a previously-placed one can still land
  // in its own gap instead of being pushed past the slot's end.
  const chron = state.fills.slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);

  // Temporary day-order: never start before a placed predecessor finishes.
  let orderFloor = 0;
  let orderCeiling = Infinity;
  if(fill.h && fill.h.hid){
    for(const e of plannerOrderConstraintsForDay(dayBase)){
      if(e.afterHid === fill.h.hid){
        const committed = scheduleAnchorCommitForDay(e.beforeHid,dayBase);
        if(committed)orderFloor = Math.max(orderFloor,committed.end);
        for(const entry of chron){
          const ph = entry && entry.fill && entry.fill.h;
          if(ph && ph.hid === e.beforeHid && entry.fit){
            orderFloor = Math.max(orderFloor, Number(entry.fit.placeEnd) || 0);
          }
        }
      }
      if(e.beforeHid === fill.h.hid){
        const committed = scheduleAnchorCommitForDay(e.afterHid,dayBase);
        if(committed)orderCeiling = Math.min(orderCeiling,committed.start);
        for(const entry of chron){
          const ph = entry && entry.fill && entry.fill.h;
          if(ph && ph.hid === e.afterHid && entry.fit){
            orderCeiling = Math.min(orderCeiling,Number(entry.fit.placeStart) || Infinity);
          }
        }
      }
    }
  }
  const doingFloor = opts.doingNowStart != null ? Number(opts.doingNowStart) || 0 : 0;

  for(const slot of slots){
    const lowerBound = Math.max(slot.start,startClock,orderFloor,doingFloor);
    const inSlot = chron
      .filter(c=>c.fit.placeStart >= slot.start && c.fit.placeStart < slot.end);
    // Build the open sub-intervals (gaps) within this slot. Carve inbound
    // travel into each committed fill so a later insert cannot sit under the
    // commute homeDaySequence will draw.
    const gaps = [];
    let cursor = lowerBound;
    for(const c of inSlot){
      const occupiedStart = inboundOccupiedStart(c.fit,slot.start);
      if(occupiedStart > cursor)gaps.push({start:cursor, end:Math.min(occupiedStart,slot.end)});
      cursor = Math.max(cursor, c.fit.placeEnd);
    }
    if(cursor < slot.end)gaps.push({start:cursor, end:slot.end});
    if(!gaps.length)continue;

    for(const gap of gaps){
      // Travel anchor = location homeDaySequence would already be at when this
      // gap opens (scheduled / blocked / prior fills), else the day seed.
      const anchor = locationPresenceAt(state,gap.start,chron);

      const locId = resolveLoc(anchor);
      if(locId){
        const loc = registryLookup(locId);
        const intervals = effectiveLocationWindow(fill.h,loc,weekday,dayBase);
        if(!intervals.length)continue;
      }
      const edge = travelEdgeBetweenIds(anchor,locId,registry,mode,{allowNetwork:opts.allowNetwork !== false});
      const travelMin = Math.ceil((edge.seconds || 0) / 60);
      const durMin = fillDurationMinutes(fill);
      if(durMin <= 0)return null;
      // Hard availability budget. The first fill of a day may still place when
      // travel+duration exceeds the remaining budget (same rule as the classic
      // timeline) — otherwise a long commute can never open a day. Later fills
      // must fit the leftover minutes.
      if(durMin + travelMin > remaining && usedMinutes > 0)continue;

      let placeStart = gap.start + (edge.seconds || 0) * 1000;
      let cap = gap.end;
      if(locId){
        const loc = registryLookup(locId);
        const intervals = effectiveLocationWindow(fill.h,loc,weekday,dayBase);
        const arriveMin = Math.floor((placeStart - dayBase) / 60000);
        let iv = intervals.find(x=>arriveMin >= x.start && arriveMin < x.end);
        if(!iv){
          iv = intervals.find(x=>x.start >= arriveMin) || intervals.find(x=>x.end > arriveMin);
          if(!iv)continue;
          placeStart = Math.max(placeStart, dayBase + iv.start * 60000);
        }
        cap = Math.min(cap, dayBase + iv.end * 60000);
      }else{
        const windows = fillDayWindows(fill.h,dayBase,anchor);
        const win = windows && (
          windows.find(x=>placeStart >= x.start && placeStart < x.end)
          || windows.find(x=>x.start >= placeStart)
        );
        if(win){
          placeStart = Math.max(placeStart,win.start);
          cap = Math.min(cap,win.end);
        }else if(windows){
          continue;
        }
      }
      // Placement must stay inside this open gap (blocks/scheduled already carved).
      placeStart = Math.max(placeStart,gap.start);
      if(placeStart >= gap.end)continue;
      // Reserve outbound commute to the next different-location hard/fill row
      // so placeEnd cannot overlap the leave-by window homeDaySequence draws.
      const presenceLocId = locId || anchor;
      const leaveBy = outboundLeaveByMs(state,presenceLocId,placeStart,opts);
      if(leaveBy != null)cap = Math.min(cap,leaveBy);
      cap = Math.min(cap,orderCeiling);
      const cost = durMin * 60000;
      let placeEnd = placeStart + cost;
      if(placeEnd > cap || placeEnd > gap.end)continue;
      if(placeStart < gap.start || placeStart >= gap.end)continue;
      const baseFit = {
        placeStart,
        placeEnd,
        locId,
        edge,
        travelMin,
        durMin,
        slotStart:slot.start,
        preferredHit:false,
        prevLocId:anchor,
        placeKey
      };
      fits.push(baseFit);
      // Preferred time is a second soft candidate — score picks vs ASAP/scarce.
      // Doing-now always wants the earliest start, so skip preferred alternatives.
      if(opts.doingNowStart != null)continue;
      const loc = locId ? registry.find(l=>l.id === locId) : null;
      const locPref = loc && Number.isFinite(loc.preferredTimeStart) ? dayBase + loc.preferredTimeStart * 60000 : null;
      const habitPref = fillPreferredStart(fill.h,dayBase,anchor);
      const prefTs = locPref || habitPref;
      if(prefTs !== null && prefTs > placeStart && prefTs + cost <= cap && prefTs + cost <= gap.end){
        fits.push({
          ...baseFit,
          placeStart:prefTs,
          placeEnd:prefTs + cost,
          preferredHit:true
        });
      }
    }
  }
  if(!fits.length)return null;
  return pickBestScoredFit(fits,fill,state,opts);
}

/** PURE: minutes already committed for habit index i on this day state. */
function placedBreakableMinutes(state,habitIndex){
  if(!state || !Array.isArray(state.fills))return 0;
  return state.fills.reduce((sum,entry)=>{
    if(!entry || !entry.fill || entry.fill.i !== habitIndex)return sum;
    return sum + (Number(entry.fit && entry.fit.durMin) || 0);
  },0);
}

// ─── Daily-breakable reservation ──────────────────────────────────────────
// A daily recurring breakable (e.g. "Work 6h every weekday, 9:00–18:45") has a
// per-day target it must still reach. Movable week candidates — plan-by items,
// one-shot tasks, sparse/flex rhythms — can satisfy their target on ANY of
// several eligible days, so they should never consume the slice of a busy day
// that a daily breakable needs to hit its target when a quieter day can take
// them instead. These helpers quantify that protection and are shared by both
// the fast scarcity planner and the GLPK optimizer so the two paths agree.

// PURE: is this week candidate "movable" — i.e. it places once and could be
// deferred to another eligible day? Daily rhythms (target ≤ 1) must place on
// every eligible day so they are NOT movable; pinned items stay on today.
function isMovableWeekCandidate(c){
  if(!c || !c.h)return false;
  if(c.pinned === true)return false;
  if(c.h.breakable)return false;            // breakables reserve capacity, not deferred
  if(c.h.type === 'task')return true;       // one-shot → chooses a day
  const target = Number(c.h && c.h.target);
  if(Number.isFinite(target) && target <= 1)return false; // daily rhythm, must place today
  return true;                              // sparse rhythm (target > 1) / plan-by
}

// PURE: daily-recurring breakable candidates eligible on state.dayBase, each
// with its time window (full day when none) and the minutes still needed to
// reach today's target. An empty list means "no daily breakable to protect".
function dailyBreakableReservations(state,candidates){
  if(!state || !Array.isArray(candidates))return [];
  const out = [];
  for(const c of candidates){
    if(!c || !c.h || !c.h.breakable)continue;
    if(!c.eligible || !c.eligible.has(state.dayBase))continue;
    const target = Number(c.h && c.h.target);
    if(!Number.isFinite(target) || target > 1)continue;   // only daily rhythms
    const budget = typeof breakableBudgetMinutes === 'function'
      ? breakableBudgetMinutes(c.h,state.dayBase) : clampDuration(c.h.durationMinutes);
    const placed = typeof placedBreakableMinutes === 'function'
      ? placedBreakableMinutes(state,c.i) : 0;
    const deficit = Math.max(0,budget - placed);
    if(deficit <= 0)continue;
    const windows = (typeof hasTimeWindow === 'function' && hasTimeWindow(c.h))
      ? fillDayWindows(c.h,state.dayBase,state.seedLocId) : null;
    out.push({
      i:c.i,
      priority:c.priority != null ? c.priority : 2,
      windows:windows || [{start:state.dayBase,end:state.dayBase + 86400000}],
      deficit,
      minChunk:typeof clampMinChunk === 'function'
        ? clampMinChunk(c.h.minChunkMinutes)
        : Math.max(15,c.h.minChunkMinutes || 30)
    });
  }
  return out;
}

function breakableReservationWindows(reservation){
  if(!reservation)return [];
  if(Array.isArray(reservation.windows))return reservation.windows;
  return reservation.window ? [reservation.window] : [];
}

// PURE: free segments inside [ws,we] ∩ state.slots, minus committed fills and
// scheduled rows. Same geometry the placer sees when hunting gaps.
function freeSegmentsInWindow(state,ws,we){
  if(!state || !Array.isArray(state.slots))return [];
  const blockers = [];
  for(const entry of state.fills || []){
    const fs = entry && entry.fit && entry.fit.placeStart;
    const fe = entry && entry.fit && entry.fit.placeEnd;
    if(fs != null && fe != null && fe > fs)blockers.push({start:fs,end:fe});
  }
  for(const row of state.rows || []){
    if(!row || row.kind !== 'scheduled')continue;
    if(row.end > row.start)blockers.push({start:row.start,end:row.end});
  }
  const out = [];
  for(const slot of state.slots){
    const s = Math.max(slot.start,ws);
    const e = Math.min(slot.end,we);
    if(e <= s)continue;
    let segs = [{start:s,end:e}];
    for(const block of blockers){
      if(block.end <= s || block.start >= e)continue;
      const next = [];
      for(const seg of segs){
        if(block.end <= seg.start || block.start >= seg.end){ next.push(seg); continue; }
        if(block.start <= seg.start && block.end >= seg.end)continue;
        if(block.start > seg.start && block.start < seg.end)next.push({start:seg.start,end:block.start});
        if(block.end > seg.start && block.end < seg.end)next.push({start:block.end,end:seg.end});
      }
      segs = next;
    }
    for(const seg of segs){
      if(seg.end > seg.start)out.push(seg);
    }
  }
  return out;
}

// PURE: minutes movables may still consume after Work is given first claim on
// usable free segments (largest-first). If Work cannot cover its deficit from
// usable chunks, spare is 0 — any further fragmentation would only hurt hours.
function movableSpareFromSegmentLengths(segMinutes,deficit,minChunkMinutes){
  const min = typeof clampMinChunk === 'function'
    ? clampMinChunk(minChunkMinutes) : Math.max(15,minChunkMinutes || 30);
  let need = Math.max(0,Math.round(Number(deficit) || 0));
  const segs = (segMinutes || []).map(m=>Math.max(0,Math.round(Number(m) || 0)))
    .filter(m=>m > 0)
    .sort((a,b)=>b - a);
  const leftover = [];
  for(const m of segs){
    if(need <= 0){ leftover.push(m); continue; }
    const take = Math.min(m,need);
    if(typeof isValidChunkMinutes === 'function'){
      if(!isValidChunkMinutes(take,need,min)){ leftover.push(m); continue; }
    }else if(need >= min && take < min){
      leftover.push(m); continue;
    }
    need -= take;
    const rem = m - take;
    if(rem > 0)leftover.push(rem);
  }
  if(need > 0)return 0;
  return leftover.reduce((sum,m)=>sum + m,0);
}

// PURE: free ms inside [ws,we] ∩ state.slots, minus committed fills. Mirrors
// the gap math in tryPlaceOnDay so the reservation sees the same open time the
// placer would actually find.
function freeMsInWindow(state,ws,we){
  return freeSegmentsInWindow(state,ws,we)
    .reduce((sum,seg)=>sum + (seg.end - seg.start),0);
}

// PURE: minutes a movable item is still allowed to consume on this day without
// starving a daily breakable of its target. Returns Infinity when no daily
// breakable needs protection. Must-place (non-movable) candidates are virtually
// placed first on a clone so their footprint (e.g. daily prayers inside the
// work window) is subtracted before spare is measured. Spare is the leftover
// after Work claims usable contiguous chunks (minChunk-aware), not raw free
// sum — so a 43m hole does not count as "room" next to a 60m min chunk.
function movableCapacityForDay(state,candidates){
  const reservations = dailyBreakableReservations(state,candidates);
  if(!reservations.length)return Infinity;
  const clone = clonePlacementState(state);
  for(const c of (candidates || [])){
    if(!c || !c.h)continue;
    if(c.h.breakable)continue;
    if(isMovableWeekCandidate(c))continue;          // movables don't reserve footprint
    if(c.eligible && !c.eligible.has(state.dayBase))continue;
    if(clone.placed.has(c.i))continue;
    const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
    const fit = typeof tryPlaceOnDay === 'function'
      ? tryPlaceOnDay(clone,fill,{allowNetwork:false}) : null;
    if(fit)commitPlacement(clone,fill,fit);
  }
  let spare = 0;
  for(const r of reservations){
    const segs = breakableReservationWindows(r).flatMap(
      win=>freeSegmentsInWindow(clone,win.start,win.end));
    const lengths = segs.map(seg=>Math.round((seg.end - seg.start) / 60000));
    const minChunk = r.minChunk != null ? r.minChunk
      : (typeof clampMinChunk === 'function' ? clampMinChunk(30) : 30);
    spare += movableSpareFromSegmentLengths(lengths,r.deficit,minChunk);
  }
  return Math.max(0,spare);
}

// PURE: ms of overlap between a fit and the reservation windows (reuses the
// existing fitOverlapWithWindows shape but maps reservation→window).
function fitOverlapWithReservationsMs(fit,reservations){
  if(!fit || !Array.isArray(reservations) || !reservations.length)return 0;
  return fitOverlapWithWindows(
    fit,reservations.flatMap(r=>breakableReservationWindows(r)));
}

// PURE: does this movable have another eligible day whose breakable-spare can
// take its full duration? If yes, it can wait — never steal today's breakable.
function movableHasCleanAlternativeDay(c,state,candidates,dayStates){
  if(!c || !c.h)return false;
  const dur = clampDuration(c.h.durationMinutes);
  for(const other of (dayStates || [])){
    if(other === state)continue;
    if(c.eligible && !c.eligible.has(other.dayBase))continue;
    if(typeof movableCapacityForDay !== 'function')continue;
    const otherCap = movableCapacityForDay(other,candidates);
    if(!Number.isFinite(otherCap) || otherCap >= dur)return true;
  }
  return false;
}

// PURE: strictly higher priority than every overlapping daily breakable
// (lower number wins). Used only when the week is packed and something must
// give — equal/lower priority may not take a breakable chunk.
function movablePriorityBeatsReservations(c,reservations,fit){
  if(!c || !Array.isArray(reservations) || !reservations.length)return false;
  const cp = c.priority != null ? c.priority : 2;
  let best = Infinity;
  for(const r of reservations){
    if(fit){
      const overlaps = breakableReservationWindows(r).some(
        win=>fit.placeEnd > win.start && fit.placeStart < win.end);
      if(!overlaps)continue;
    }
    if(r.priority < best)best = r.priority;
  }
  if(!Number.isFinite(best))return false;
  return cp < best;
}

// PURE: should the fast scarcity planner DEFER candidate `c` away from `state`
// for this pass?
//   - Fits in spare → place (ASAP).
//   - Would breach a daily breakable AND has a clean alternative day → defer
//     (can wait → waits; priority irrelevant).
//   - Week packed (no clean alternative) → priority decides: higher priority
//     may take a breakable chunk; equal/lower yields (stay unplaced rather
//     than short the daily).
function fastPathDefersMovable(c,state,candidates,dayStates){
  if(typeof isMovableWeekCandidate !== 'function' || !isMovableWeekCandidate(c))return false;
  if(typeof movableCapacityForDay !== 'function')return false;
  const cap = movableCapacityForDay(state,candidates);
  if(!Number.isFinite(cap))return false;                 // no daily breakable here
  const dur = clampDuration(c.h && c.h.durationMinutes);
  if(dur <= cap)return false;                             // fits without breaching
  if(movableHasCleanAlternativeDay(c,state,candidates,dayStates))return true;
  const reservations = typeof dailyBreakableReservations === 'function'
    ? dailyBreakableReservations(state,candidates) : [];
  if(movablePriorityBeatsReservations(c,reservations,null))return false; // packed + higher pri
  return true;                                            // packed + equal/lower — don't steal
}

/** PURE: remaining breakable work not yet placed on this day (or across dayStates). */
function breakableMinutesLeft(h,habitIndex,stateOrStates){
  const states = Array.isArray(stateOrStates) ? stateOrStates
    : (stateOrStates ? [stateOrStates] : []);
  // Tasks: lifetime budget shared across days. Rhythm keepup/reduce: per-day budget.
  const dayBase = states.length === 1 && states[0] && states[0].dayBase != null
    ? states[0].dayBase
    : null;
  const totalLeft = typeof breakableBudgetMinutes === 'function'
    ? (h && h.type === 'task'
      ? breakableBudgetMinutes(h)
      : breakableBudgetMinutes(h, dayBase != null ? dayBase : (typeof dayStart === 'function' ? dayStart(Date.now()) : Date.now())))
    : (typeof remainingDurationMinutes === 'function'
      ? remainingDurationMinutes(h) : clampDuration(h && h.durationMinutes));
  // For one-shot task placement across many days, subtract all placed pieces.
  // For a single-day state (rhythm daily), only subtract that day's commits.
  const placed = states.reduce((sum,st)=>sum + placedBreakableMinutes(st,habitIndex),0);
  return Math.max(0,totalLeft - placed);
}

/**
 * PURE: largest valid breakable session that fits a gap on this day.
 * Prefers bigger sessions (continuous as possible), then soft agenda score.
 * Returns {fit, fill} or null.
 */
function largestFeasibleBreakableFit(state,fill,remainingMinutes,minChunkMinutes,opts = {}){
  if(!state || !fill || !fill.h)return null;
  const rem = Math.max(0,Math.round(Number(remainingMinutes) || 0));
  const min = typeof clampMinChunk === 'function' ? clampMinChunk(minChunkMinutes) : Math.max(15,minChunkMinutes || 30);
  if(rem <= 0)return null;
  const {dayBase,weekday,registry,mode,slots,startClock} = state;
  const budgetLeft = state.remaining;
  const usedMinutes = state.usedMinutes;
  const resolveLoc = (anchor)=>fill.locationId || pickHabitLocationId(fill.h,anchor,registry,mode);
  const chron = state.fills.slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  const candidates = [];

  let orderFloor = 0;
  let orderCeiling = Infinity;
  if(fill.h && fill.h.hid){
    for(const e of plannerOrderConstraintsForDay(dayBase)){
      if(e.afterHid === fill.h.hid){
        const committed = scheduleAnchorCommitForDay(e.beforeHid,dayBase);
        if(committed)orderFloor = Math.max(orderFloor,committed.end);
        for(const entry of chron){
          const ph = entry && entry.fill && entry.fill.h;
          if(ph && ph.hid === e.beforeHid && entry.fit){
            orderFloor = Math.max(orderFloor, Number(entry.fit.placeEnd) || 0);
          }
        }
      }
      if(e.beforeHid === fill.h.hid){
        const committed = scheduleAnchorCommitForDay(e.afterHid,dayBase);
        if(committed)orderCeiling = Math.min(orderCeiling,committed.start);
        for(const entry of chron){
          const ph = entry && entry.fill && entry.fill.h;
          if(ph && ph.hid === e.afterHid && entry.fit){
            orderCeiling = Math.min(orderCeiling,Number(entry.fit.placeStart) || Infinity);
          }
        }
      }
    }
  }
  const doingFloor = opts.doingNowStart != null ? Number(opts.doingNowStart) || 0 : 0;

  for(const slot of slots){
    const lowerBound = Math.max(slot.start,startClock,orderFloor,doingFloor);
    const inSlot = chron.filter(c=>c.fit.placeStart >= slot.start && c.fit.placeStart < slot.end);
    const gaps = [];
    let cursor = lowerBound;
    for(const c of inSlot){
      const occupiedStart = inboundOccupiedStart(c.fit,slot.start);
      if(occupiedStart > cursor)gaps.push({start:cursor, end:Math.min(occupiedStart,slot.end)});
      cursor = Math.max(cursor, c.fit.placeEnd);
    }
    if(cursor < slot.end)gaps.push({start:cursor, end:slot.end});
    for(const gap of gaps){
      const anchor = locationPresenceAt(state,gap.start,chron);
      const locId = resolveLoc(anchor);
      if(locId){
        const loc = registry.find(l=>l.id === locId);
        const intervals = effectiveLocationWindow(fill.h,loc,weekday,dayBase);
        if(!intervals.length)continue;
      }
      const edge = travelEdgeBetweenIds(anchor,locId,registry,mode,{allowNetwork:opts.allowNetwork !== false});
      const travelMin = Math.ceil((edge.seconds || 0) / 60);
      let placeStart = gap.start + (edge.seconds || 0) * 1000;
      let cap = gap.end;
      if(locId){
        const loc = registry.find(l=>l.id === locId);
        const intervals = effectiveLocationWindow(fill.h,loc,weekday,dayBase);
        const arriveMin = Math.floor((placeStart - dayBase) / 60000);
        let iv = intervals.find(x=>arriveMin >= x.start && arriveMin < x.end);
        if(!iv){
          iv = intervals.find(x=>x.start >= arriveMin) || intervals.find(x=>x.end > arriveMin);
          if(!iv)continue;
          placeStart = Math.max(placeStart, dayBase + iv.start * 60000);
        }
        cap = Math.min(cap, dayBase + iv.end * 60000);
      }else{
        const windows = fillDayWindows(fill.h,dayBase,anchor);
        const win = windows && (
          windows.find(x=>placeStart >= x.start && placeStart < x.end)
          || windows.find(x=>x.start >= placeStart)
        );
        if(win){
          placeStart = Math.max(placeStart,win.start);
          cap = Math.min(cap,win.end);
        }else if(windows){
          continue;
        }
      }
      placeStart = Math.max(placeStart,gap.start);
      if(placeStart >= gap.end || placeStart >= cap)continue;
      // Reserve outbound commute to the next different-location hard/fill row.
      const presenceLocId = locId || anchor;
      const leaveBy = outboundLeaveByMs(state,presenceLocId,placeStart,opts);
      if(leaveBy != null)cap = Math.min(cap,leaveBy);
      cap = Math.min(cap,orderCeiling);
      if(placeStart >= cap)continue;
      const usableMs = Math.min(cap,gap.end) - placeStart;
      const usableMin = Math.floor(usableMs / 60000);
      if(usableMin <= 0)continue;
      let piece = Math.min(rem,usableMin);
      // Respect availability budget for later fills (same rule as tryPlaceOnDay).
      if(usedMinutes > 0){
        const budgetCap = Math.max(0,budgetLeft - travelMin);
        piece = Math.min(piece,budgetCap);
      }
      if(typeof isValidChunkMinutes === 'function'){
        if(!isValidChunkMinutes(piece,rem,min))continue;
      }else if(piece <= 0 || piece > rem || (rem >= min && piece < min)){
        continue;
      }
      const cost = piece * 60000;
      const placeEnd = placeStart + cost;
      if(placeEnd > cap || placeEnd > gap.end)continue;
      candidates.push({
        placeStart,
        placeEnd,
        locId,
        edge,
        travelMin,
        durMin:piece,
        maxDurMin:piece,
        slotStart:slot.start,
        preferredHit:false,
        prevLocId:anchor,
        placeKey:fill.placeKey != null ? fill.placeKey : fill.i
      });
    }
  }
  if(!candidates.length)return null;
  // Avoid manufacturing a tiny finish-up merely because the greedy pass took
  // too much from this gap. When another gap can hold a full minimum session,
  // reserve exactly that minimum instead. Example: 127m left with 119m and 80m
  // gaps at a 60m minimum becomes 67+60, not 119+8.
  if(rem >= min * 2){
    for(const candidate of candidates){
      const remainder = rem - candidate.durMin;
      if(remainder <= 0 || remainder >= min)continue;
      const adjusted = rem - min;
      if(adjusted < min || adjusted > candidate.maxDurMin)continue;
      const budgetAfter = Math.max(0,budgetLeft - candidate.travelMin - adjusted);
      const hasMinimumGap = candidates.some(other=>other !== candidate
        && other.maxDurMin >= min
        && (usedMinutes <= 0 || other.travelMin + min <= budgetAfter));
      if(!hasMinimumGap)continue;
      candidate.durMin = adjusted;
      candidate.placeEnd = candidate.placeStart + adjusted * 60000;
    }
  }
  // Prefer larger sessions first (continuous), then soft score among ties.
  candidates.sort((a,b)=>b.durMin - a.durMin);
  const topDur = candidates[0].durMin;
  const top = candidates.filter(c=>c.durMin === topDur);
  const best = pickBestScoredFit(top,fill,state,opts);
  if(!best)return null;
  return { fit:best, fill };
}

/**
 * PURE: place a breakable habit continuous-first on one day, then adaptive
 * largest-valid pieces until remaining work is scheduled or no gap fits.
 * Returns true when at least one session was committed.
 */
function placeBreakableSessions(state,fill,opts = {}){
  if(!state || !fill || !fill.h || !fill.h.breakable)return false;
  const min = typeof clampMinChunk === 'function'
    ? clampMinChunk(fill.h.minChunkMinutes)
    : (fill.h.minChunkMinutes || 30);
  const availableLeft = breakableMinutesLeft(fill.h,fill.i,state);
  let left = opts.remainingMinutes != null
    ? Math.min(availableLeft,Math.max(0,Math.round(Number(opts.remainingMinutes) || 0)))
    : availableLeft;
  let chunkIndex = 0;
  while(state.placed.has(`${fill.i}:${chunkIndex}`))chunkIndex += 1;
  let placedAny = false;
  while(left > 0){
    const sessionFill = {
      ...fill,
      chunkMinutes:left,
      chunkIndex,
      placeKey:`${fill.i}:${chunkIndex}`
    };
    let fit = tryPlaceOnDay(state,sessionFill,opts);
    if(!fit){
      const largest = largestFeasibleBreakableFit(state,sessionFill,left,min,opts);
      if(!largest || !largest.fit)break;
      fit = largest.fit;
      sessionFill.chunkMinutes = fit.durMin;
    }
    fit.placeKey = sessionFill.placeKey;
    commitPlacement(state,sessionFill,fit);
    left -= fit.durMin;
    chunkIndex += 1;
    placedAny = true;
  }
  if(placedAny)state.placed.add(fill.i);
  return placedAny;
}

// MUTATE: reconcile inbound travel after a chronological insertion. The fast
// planner can place a later item first, then insert another fill between it and
// its old location anchor. In that case the old commute is no longer part of
// the final route and must not remain charged to the availability budget.
function reconcileCommittedTravel(state){
  if(!state || !Array.isArray(state.fills))return;
  const chron = state.fills.slice().sort(
    (a,b)=>a.fit.placeStart - b.fit.placeStart || a.fit.placeEnd - b.fit.placeEnd);
  const travelRows = [];
  let travelMinutes = 0;
  let durationMinutes = 0;
  let lastLocId = state.seedLocId || null;

  for(const entry of chron){
    const fit = entry && entry.fit;
    if(!fit)continue;
    durationMinutes += Math.max(0,Number(fit.durMin) || 0);
    const anchor = locationPresenceAt(state,fit.placeStart,chron);
    const edge = travelEdgeBetweenIds(
      anchor,
      fit.locId,
      state.registry,
      state.mode,
      {allowNetwork:false}
    );
    const travelMin = Math.max(0,Math.ceil((Number(edge.seconds) || 0) / 60));
    fit.prevLocId = anchor;
    fit.edge = edge;
    fit.travelMin = travelMin;
    travelMinutes += travelMin;
    if(edge.seconds > 0 && anchor && fit.locId && anchor !== fit.locId){
      const from = state.registry.find(l=>l.id === anchor);
      const to = state.registry.find(l=>l.id === fit.locId);
      travelRows.push({
        kind:'travel',
        from:anchor,
        to:fit.locId,
        fromName:from ? from.name : '',
        toName:to ? to.name : '',
        seconds:edge.seconds,
        metres:edge.metres || 0,
        start:Math.max(fit.placeStart - edge.seconds * 1000,state.dayBase),
        end:fit.placeStart,
        provider:edge.provider || state.mode
      });
    }
    if(fit.locId)lastLocId = fit.locId;
  }

  state.rows = (state.rows || []).filter(row=>row.kind !== 'travel').concat(travelRows);
  state.usedMinutes = Math.max(0,durationMinutes + travelMinutes);
  state.remaining = Math.max(0,(Number(state.totalMinutes) || 0) - state.usedMinutes);
  state.prevLocId = lastLocId;
}

// MUTATE: commit a successful fit into day state (travel row + fill row + budgets).
function commitPlacement(state,fill,fit){
  if(!fit)return;
  // Most placements append after the existing fills. Preserve the original
  // O(1) commit for that common path; a full route reconciliation is only
  // needed when this fit was inserted before something already committed, or
  // when GLPK is committing a precomputed option whose location anchor became
  // stale after an earlier chosen option was committed.
  const insertedBeforeExisting = state.fills.some(
    entry=>entry && entry.fit && entry.fit.placeStart > fit.placeStart);
  const stalePrecomputedAnchor = state.fills.length > 0
    && (fit.prevLocId || null) !== (state.prevLocId || null);
  const needsTravelReconciliation = insertedBeforeExisting || stalePrecomputedAnchor;
  const {registry,mode} = state;
  if(!needsTravelReconciliation
    && fit.edge && fit.edge.seconds > 0
    && fit.prevLocId && fit.locId && fit.prevLocId !== fit.locId){
    const from = registry.find(l=>l.id === fit.prevLocId);
    const to = registry.find(l=>l.id === fit.locId);
    state.rows.push({
      kind:'travel',
      from:fit.prevLocId,
      to:fit.locId,
      fromName:from ? from.name : '',
      toName:to ? to.name : '',
      seconds:fit.edge.seconds,
      metres:fit.edge.metres || 0,
      start:Math.max(fit.placeStart - fit.edge.seconds * 1000,state.dayBase),
      end:fit.placeStart,
      provider:fit.edge.provider || mode
    });
  }
  state.rows.push({
    kind:'fill', h:fill.h, i:fill.i, start:fit.placeStart, end:fit.placeEnd, hard:false,
    locationId:fit.locId,
    chunkMinutes:fit.durMin,
    chunkIndex:fill.chunkIndex != null ? fill.chunkIndex : null,
    plannerScore:Number.isFinite(fit.score) ? fit.score : null,
    plannerScoreTerms:fit.scoreTerms || null,
    optimizerWeight:Number.isFinite(fit.optimizerWeight) ? fit.optimizerWeight : null,
    optimizerCandidateWeight:Number.isFinite(fit.optimizerCandidateWeight)
      ? fit.optimizerCandidateWeight : null,
    optimizerDelayMinutes:Number.isFinite(fit.optimizerDelayMinutes)
      ? fit.optimizerDelayMinutes : null
  });
  state.fills.push({ fill, fit, slotStart:fit.slotStart });
  state.placed.add(fit.placeKey != null ? fit.placeKey : fill.i);
  if(needsTravelReconciliation){
    reconcileCommittedTravel(state);
  }else{
    state.remaining = Math.max(0,state.remaining - fit.travelMin - fit.durMin);
    state.usedMinutes += fit.travelMin + fit.durMin;
    if(fit.locId)state.prevLocId = fit.locId;
  }
}

function finalizePlacementRows(state){
  return state.rows.slice().sort((a,b)=>a.start - b.start || (a.kind === 'scheduled' ? -1 : a.kind === 'travel' ? -0.5 : 1));
}

// PURE: the location the user is already commited to at a given minute within
// a day, derived from location-tied blocked times (sleep→Home, work→Office).
// Returns the locationId or null. Lets the week agenda start each day anchored
// to a known place ("you wake at Home") instead of an unknown starting point.
function blockLocationAtMinute(blocks,minute,weekday,dayBase){
  if(!Array.isArray(blocks))return null;
  for(const block of blocks){
    if(block.days.length && !block.days.includes(weekday))continue;
    if(!block.locationId)continue;
    const rawS = resolveBlockedTimeMinutes(block,'start',dayBase) ?? block.start;
    const rawE = resolveBlockedTimeMinutes(block,'end',dayBase) ?? block.end;
    const {startMin:s, endMin:e} = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawS, rawE) : {startMin:rawS, endMin:rawE};
    const inSimple = e > s && minute >= s && minute < e;
    const inOvernight = e <= s && (minute >= s || minute < e);
    if(inSimple || inOvernight)return block.locationId;
  }
  return null;
}

// PURE: the first open minute of a day after contiguous blocked coverage from
// midnight, used as the startClock / clipAfter for future-day timelines.
// Only overnight tails and blocks that touch midnight advance the cursor —
// an isolated mid-morning block (e.g. breakfast 8:00–9:00) must NOT, or the
// gap between sleep wake and breakfast is clipped away and morning habits
// (sunrise windows) never place on future days.
// dayBase selects which day's prayer times to use for dynamic blocks (must
// match agendaBlockedIntervals); omitting it falls back to today.
function dayFirstOpenMinute(blocks,weekday,dayBase){
  if(!Array.isArray(blocks) || !blocks.length)return 0;
  const intervals = [];
  for(const block of blocks){
    if(block.days.length && !block.days.includes(weekday))continue;
    const rawS = resolveBlockedTimeMinutes(block,'start',dayBase) ?? block.start;
    const rawE = resolveBlockedTimeMinutes(block,'end',dayBase) ?? block.end;
    const {startMin:s, endMin:e} = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawS, rawE) : {startMin:rawS, endMin:rawE};
    if(!Number.isFinite(s) || !Number.isFinite(e))continue;
    if(e <= s){
      // Overnight — morning tail [0, e) is contiguous from midnight.
      if(e > 0)intervals.push({start:0, end:e});
    }else{
      intervals.push({start:s, end:e});
    }
  }
  intervals.sort((a,b)=>a.start - b.start || a.end - b.end);
  let cursor = 0;
  for(const iv of intervals){
    if(iv.start > cursor)break; // first gap from midnight
    if(iv.end > cursor)cursor = iv.end;
  }
  return cursor;
}

function buildOpenAgendaSlots(todayKey,scheduled,settings,{clipAfter} = {}){
  const start = dayStart(new Date(`${todayKey}T12:00:00`).getTime());
  const end = start + 24 * 3600000;
  const blocks = agendaBlockedIntervals(todayKey,settings,start,end);
  scheduled.forEach(({h})=>{
    blocks.push({start:h.eventTime,end:h.eventTime + clampDuration(h.durationMinutes) * 60000,label:h.name});
  });
  const merged = mergeIntervals(blocks
    .map(b=>({start:Math.max(start,b.start),end:Math.min(end,b.end),label:b.label}))
    .filter(b=>b.end > b.start));
  const raw = [];
  let cursor = start;
  merged.forEach(block=>{
    if(block.start > cursor)raw.push({start:cursor,end:block.start});
    cursor = Math.max(cursor,block.end);
  });
  if(cursor < end)raw.push({start:cursor,end});
  // Slots are the day's full OPEN time (open intervals minus blocks/scheduled,
  // clipped to "now" for today, or to the day's start for future days). The
  // availability budget is NOT applied here — it caps task minutes in
  // buildTodayAgenda/buildDayAgenda, not open time. This keeps a late/overnight
  // allowed window (e.g. 10pm-11am) reachable even when today's budget would
  // otherwise be "spent" by idle open time earlier in the day, and lets a block
  // at the window start (e.g. sleep from 10pm) correctly exclude the item.
  const clip = clipAfter != null ? clipAfter : ceilToMinutes(Date.now(),5);
  return raw
    .map(slot=>({start:Math.max(slot.start,clip),end:slot.end}))
    .filter(slot=>slot.end > slot.start);
}

function agendaBlockedIntervals(todayKey,settings,start,end){
  const day = new Date(`${todayKey}T12:00:00`).getDay();
  const dayBase = dayStart(new Date(`${todayKey}T12:00:00`).getTime());
  const overrides = typeof normalizeBlockedTimeOverrides === 'function'
    ? normalizeBlockedTimeOverrides(settings.blockedTimeOverrides) : {};
  return normalizeBlockedTimes(settings.blockedTimes).flatMap((block,blockIndex)=>{
    if(block.days.length && !block.days.includes(day))return [];
    // Resolve dynamic start/end (prayer anchors only on blocked times).
    // Fold dayBase-relative values (negative / >1440 from offsets or +1d)
    // into overnight clock form so a sunrise−8h → sunrise block becomes
    // evening→midnight + midnight→sunrise on every day it applies.
    const rawStart = resolveBlockedTimeMinutes(block,'start',dayBase) ?? block.start;
    const rawEnd = resolveBlockedTimeMinutes(block,'end',dayBase) ?? block.end;
    const folded = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawStart, rawEnd) : {startMin:rawStart, endMin:rawEnd};
    const originalStartMin = folded.startMin;
    const originalEndMin = folded.endMin;
    if(isBlockedCancelled(todayKey,block.label,originalStartMin,originalEndMin,settings))return [];
    const signature = blockedInstanceKey(block.label,originalStartMin,originalEndMin);
    const instance = overrides[todayKey] && overrides[todayKey][signature];
    const startMin = instance ? instance.start : originalStartMin;
    const endMin = instance ? instance.end : originalEndMin;
    const locationId = block.locationId || null;
    const blockStart = start + startMin * 60000;
    const blockEnd = start + endMin * 60000;
    const shared = {label:block.label,locationId,startMin,endMin,blockStartMin:originalStartMin,blockEndMin:originalEndMin,
      effectiveBlockStartMin:startMin,effectiveBlockEndMin:endMin,blockIndex,blockSignature:signature};
    if(endMin > startMin)return [{start:blockStart,end:blockEnd,...shared}];
    return [
      {start,end:blockEnd,...shared,startMin:0,endMin:endMin},
      {start:blockStart,end,...shared,startMin,endMin:1440}
    ];
  });
}

// PURE: blocked-time rows for a home/agenda day timeline. Past-finished blocks
// on today are clipped away so the list only shows what's still ahead.
function blockedTimelineRows(dayKey,settings,dayBase,{clipAfter} = {}){
  const start = dayBase;
  const end = dayBase + 24 * 3600000;
  const clip = clipAfter != null ? clipAfter : null;
  return agendaBlockedIntervals(dayKey,settings,start,end)
    .map(b=>({
      kind:'blocked',
      label:b.label,
      start:b.start,
      end:b.end,
      locationId:b.locationId || null,
      startMin:b.startMin,
      endMin:b.endMin,
      blockStartMin:b.blockStartMin,
      blockEndMin:b.blockEndMin,
      effectiveBlockStartMin:b.effectiveBlockStartMin,
      effectiveBlockEndMin:b.effectiveBlockEndMin,
      blockIndex:b.blockIndex,
      blockSignature:b.blockSignature
    }))
    .filter(b=>b.end > b.start && (clip == null || b.end > clip));
}

// PURE: seed location for a day timeline — today uses presence; future days
// start from the location-tied block covering the day's first open minute
// (sleep→Home, work→Office) so travel into the first item is honest.
function dayTimelineSeedLocation(day,settings){
  if(day && day.isToday){
    return (typeof currentLocationId === 'function' && currentLocationId())
      || settings.lastKnownLocationId
      || null;
  }
  const dayBase = day?.dayBase != null ? day.dayBase : dayStart(Date.now());
  const weekday = day?.weekday ?? new Date(dayBase).getDay();
  const blocks = normalizeBlockedTimes(settings.blockedTimes);
  const openMin = dayFirstOpenMinute(blocks,weekday,dayBase);
  return blockLocationAtMinute(blocks,Math.max(0,openMin - 1),weekday,dayBase)
    || blockLocationAtMinute(blocks,openMin,weekday,dayBase)
    || null;
}

// PURE: decide whether to prepend a synthetic "from current location" travel
// leg to today's home sequence, and return {row,toId} when it should fire.
// Returns null when any condition isn't met:
//   • no live GPS fix, OR the user is standing inside a saved location's radius
//     (the regular chain handles that case correctly already)
//   • no upcoming row with a saved location to anchor the leg to
//   • the user is within CURRENT_COORD_TRAVEL_CARD_MIN_METRES of that location
//     (no point showing a card for a trivial gap)
//
// The synthetic leg uses CURRENT_COORD_ID as its `from` so the renderer knows
// to compute the edge via travelFromCurrent() (movement-thresholded cache)
// instead of looking up a saved-location pair in sortSettings.travel.
function buildCurrentCoordTravelLeg(sequence,registry,mode,dayBase){
  if(typeof currentCoordLocation !== 'function' || typeof isCurrentCoordAwayFromSaved !== 'function')return null;
  if(typeof CURRENT_COORD_ID === 'undefined' || typeof CURRENT_COORD_TRAVEL_CARD_MIN_METRES === 'undefined')return null;
  const here = currentCoordLocation();
  if(!here)return null;
  if(!isCurrentCoordAwayFromSaved(registry))return null;
  // First row in chronological order that carries a saved location id.
  let target = null;
  for(const r of sequence){
    const id = r && r.locationId || null;
    if(id && registry.some(l=>l.id === id)){ target = r; break; }
  }
  if(!target)return null;
  const to = registry.find(l=>l.id === target.locationId);
  if(!to)return null;
  const metres = haversineMetres(here.lat,here.lng,to.lat,to.lng);
  if(metres < CURRENT_COORD_TRAVEL_CARD_MIN_METRES)return null;
  const edge = (typeof travelFromCurrent === 'function')
    ? travelFromCurrent(to,mode)
    : { seconds:haversineTravelSeconds(metres,mode), metres, provider:'haversine' };
  const start = Math.max(target.start - (edge.seconds || 0) * 1000, Date.now());
  return {
    toId:to.id,
    row:{
      kind:'travel',
      from:CURRENT_COORD_ID,
      to:to.id,
      fromName:'here',
      toName:to.name,
      seconds:edge.seconds || 0,
      metres:edge.metres || 0,
      start,
      end:target.start,
      provider:edge.provider || mode,
      fromCurrentCoord:true
    }
  };
}

// PURE: chronological home-day sequence — habit/scheduled rows + blocked times,
// with travel inserted whenever consecutive location-bearing rows differ.
// Strips any travel rows already on the day timeline and rebuilds them so
// blocked locations participate in the same travel chain as habits.
// Optional visibleSet limits which habit indices appear (home search/filters).
function homeDaySequence(day,settings,{visibleSet} = {}){
  if(!day)return [];
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  const clipAfter = day.isToday ? ceilToMinutes(Date.now(),5) : null;
  const blocks = blockedTimelineRows(day.dayKey,settings,day.dayBase,{clipAfter});
  const items = (day.timeline || []).filter(r=>{
    if(r.kind !== 'fill' && r.kind !== 'scheduled')return false;
    if(visibleSet && !visibleSet.has(r.i))return false;
    return true;
  });
  const sequence = [...items,...blocks].sort((a,b)=>a.start - b.start || (a.kind === 'blocked' ? -1 : 1));
  let prevLocId = dayTimelineSeedLocation(day,settings);
  const out = [];

  // Today-only: when the user has a live GPS fix that isn't inside any saved
  // location, the seed above falls back to lastKnown or nearest saved —
  // neither reflects where the user actually is. Replace that misleading
  // anchor with a synthetic "from current location" leg to the first
  // location-bearing row, gated by a minimum distance so we don't surface a
  // card for trivial gaps. Without this, no Travel card appears when the user
  // is far from the next task and not at a saved place (the regular chain
  // only fires between two saved ids).
  const currentLeg = day.isToday ? buildCurrentCoordTravelLeg(sequence,registry,mode,day.dayBase) : null;
  if(currentLeg){
    out.push(currentLeg.row);
    prevLocId = currentLeg.toId; // chain continues from the leg's destination
  }

  for(const row of sequence){
    const locId = row.locationId || null;
    if(prevLocId && locId && prevLocId !== locId){
      const from = registry.find(l=>l.id === prevLocId);
      const to = registry.find(l=>l.id === locId);
      const edge = travelEdgeBetweenIds(prevLocId,locId,registry,mode);
      out.push({
        kind:'travel',
        from:prevLocId,
        to:locId,
        fromName:from ? from.name : '',
        toName:to ? to.name : '',
        seconds:edge.seconds || 0,
        metres:edge.metres || 0,
        // Today: never show a leave-by in the past (matches buildCurrentCoordTravelLeg).
        // Future days: floor at midnight so overnight commute math stays on that day.
        start:Math.max(
          row.start - (edge.seconds || 0) * 1000,
          day.isToday ? Date.now() : day.dayBase
        ),
        end:row.start,
        provider:edge.provider || mode
      });
    }
    out.push(row);
    if(locId)prevLocId = locId;
  }

  // Doing-now: keep the active session card first in today's home list even if
  // the planner parked it later (windows / travel / meetings).
  if(day.isToday){
    const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
    if(doing && doing.hid
      && (typeof isDoingNowActive !== 'function' || isDoingNowActive(doing))){
      const dnIdx = out.findIndex(r=>{
        if(r.kind !== 'fill' && r.kind !== 'scheduled')return false;
        if(r.h && r.h.hid === doing.hid)return true;
        return false;
      });
      if(dnIdx > 0){
        const [dnRow] = out.splice(dnIdx,1);
        // Drop a travel row that only existed to lead into the moved card.
        if(dnIdx > 0 && out[dnIdx - 1] && out[dnIdx - 1].kind === 'travel'){
          out.splice(dnIdx - 1,1);
        }
        const insertAt = out[0] && out[0].kind === 'travel' && out[0].fromCurrentCoord ? 1 : 0;
        out.splice(insertAt,0,dnRow);
      }
    }
  }

  // Cleanup levels: under the 12h modes, drop blocked/travel rows that start
  // beyond the next 12 hours so only the near-future extras reach the home list
  // (future-day blocks in week mode naturally fall outside this window).
  const extraMode = (typeof normalizeHomeExtraMode === 'function' && normalizeHomeExtraMode(settings.homeExtraMode)) || 'cards';
  if(extraMode !== 'cards'){
    const windowEnd = Date.now() + 12 * 60 * 60 * 1000;
    return out.filter(r => (r.kind !== 'blocked' && r.kind !== 'travel') || r.start < windowEnd);
  }
  return out;
}

// PURE: short section label for a week-home day (today / tomorrow / Wed 15).
function homeWeekDayLabel(day,now = Date.now()){
  if(!day)return '';
  const todayBase = dayStart(now);
  const offset = Math.round((day.dayBase - todayBase) / 86400000);
  if(offset === 0)return 'today';
  if(offset === 1)return 'tomorrow';
  const date = new Date(day.dayBase);
  return `${weekdayShort(day.weekday)} ${date.getDate()}`;
}

function mergeIntervals(intervals){
  const sorted = intervals.sort((a,b)=>a.start - b.start);
  return sorted.reduce((acc,item)=>{
    const last = acc[acc.length - 1];
    if(!last || item.start > last.end){
      acc.push({...item});
    }else{
      last.end = Math.max(last.end,item.end);
    }
    return acc;
  },[]);
}

// PURE: round a timestamp up to the next N-minute boundary
function ceilToMinutes(ts,step){
  const ms = step * 60000;
  return Math.ceil(ts / ms) * ms;
}

// ─────────────────────────────────────────────────────────────────────────
// 7-DAY AGENDA — placement-backed day-by-day plan.
//
// A candidate is committed to a day only when tryPlaceOnDay succeeds against
// that day's live slots (blocks, scheduled, travel, location hours, allowed
// windows, availability). Soft keepup/reduce work uses flexibility so travel
// and preferences dominate day choice; hard pins try today first and otherwise
// fall through to leftovers (overdue/upcoming) — never as untimed day cards.
// ─────────────────────────────────────────────────────────────────────────

// PURE: a day's scheduled tasks + capacity + open slots. Today also collects
// its due-item candidates via the existing eligibility; future days leave
// agendaItems empty for the week-assignment pass to fill.
// opts.weekMode: when true, today does NOT pre-load due fills — buildWeekAgenda
// assigns soft work across the whole week so capacity isn't blown on day 0.
function buildDayAgenda(data,settings,dayBase,opts = {}){
  const dayKey = dateKey(dayBase);
  const weekday = new Date(dayBase).getDay();
  const isToday = dayStart(Date.now()) === dayBase;
  const scheduled = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>settings.showScheduledTasksInAgenda !== false && h.type === 'task' && h.eventTime !== null && !isTaskDone(h) && dateKey(h.eventTime) === dayKey)
    .sort(({h:a},{h:b})=>a.eventTime - b.eventTime);
  const totalMinutes = effectiveAvailabilityMinutes(dayKey,settings);
  const clipAfter = isToday ? ceilToMinutes(Date.now(),5) : dayBase + dayFirstOpenMinute(normalizeBlockedTimes(settings.blockedTimes),weekday,dayBase) * 60000;
  const slots = buildOpenAgendaSlots(dayKey,scheduled,settings,{clipAfter});
  const slotMinutes = slots.reduce((sum,slot)=>sum + Math.max(0,(slot.end - slot.start) / 60000),0);
  const totalCap = Math.min(totalMinutes,slotMinutes);
  const agendaItems = [];
  if(isToday && !opts.weekMode){
    // Classic single-day agenda: every due/early item competes for today.
    const candidates = [];
    let homeRank = 0;
    for(const i of visibleIndices(data,settings)){
      const h = data[i];
      if(h.type === 'task' && isTaskDone(h))continue;
      if(h.type === 'task' && h.eventTime !== null)continue;
      const dueToday = includeInTodayAgenda(h,settings);
      const earlyOk = !dueToday && typeof earlyReason === 'function' && Boolean(earlyReason(data,i,settings));
      if(!dueToday && !earlyOk)continue;
      candidates.push({h,i,priority:effectivePriority(h),rank:homeRank++});
    }
    const scarcityState = createDayPlacementState(
      {scheduled,agendaItems:[],totalMinutes:totalCap,slots,dayBase,weekday,isToday:true},
      settings,
      {dayBase,now:Date.now()}
    );
    for(const c of candidates)c.scarcity = scarcityScore(c,[scarcityState]);
    candidates.sort(compareScarcityThenPriority);
    agendaItems.push(...candidates.map(({h,i,priority,scarcity})=>({h,i,priority,scarcity})));
  }
  return { scheduled, agendaItems, totalMinutes:totalCap, usedMinutes:0, remainingMinutes:totalCap, slots, dayKey, weekday, dayBase, isToday };
}

// PURE: hard pins for week mode — planned-for-today, and hard-deadline tasks
// already due/overdue. Soft due/overdue work stays in the unified score.
function isWeekPinnedToday(h,settings){
  if(!h || h.type === 'zero')return false;
  if(h.type === 'task' && isTaskDone(h))return false;
  if(h.type === 'task' && h.eventTime !== null)return false;
  if(hasPlannedToday(h) && settings.showPlannedItemsInAgenda !== false)return true;
  if(h.type === 'task' && h.hardDue && h.dueDate !== null && settings.showDueTasksInAgenda !== false){
    const left = daysUntil(h.dueDate);
    return left !== null && left <= 0;
  }
  return false;
}

// PURE: urgency weight for week day preference (higher → prefer earlier days).
function weekUrgency(h){
  if(!h)return 0;
  if(h.type === 'task'){
    if(h.dueDate === null)return 10;
    const left = daysUntil(h.dueDate);
    if(left === null)return 10;
    if(left < 0)return h.hardDue ? 200 : 140;
    if(left === 0)return h.hardDue ? 180 : 110;
    if(left <= 2)return 70;
    return 30;
  }
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const left = daysUntil(planBy);
    if(left === null)return 30;
    if(left < 0)return 140;
    if(left === 0)return 110;
    if(left <= 2)return 70;
    return 35;
  }
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  if(days === null)return 10;
  if(days > target)return 130;
  if(days >= target)return 100;
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(flex > 0 && days >= target - flex)return 40;
  return 20;
}

// PURE: day-offset cost. High-flex keepup/reduce barely care which day;
// hard/urgent work prefers earlier. Travel/cluster still dominate.
function flexAwareDayPenalty(h,offset,urgency,pinned){
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(pinned && offset > 0)return 50000;
  if((h.type === 'keepup' || h.type === 'reduce') && flex >= 4)return offset * 5;
  if((h.type === 'keepup' || h.type === 'reduce') && flex > 0)return offset * Math.max(8, 70 - urgency / 2);
  if(urgency >= 180)return offset * 220;
  if(urgency >= 130)return offset * 50;
  return offset * Math.max(15, 140 - urgency);
}

// PURE: is a habit/task a viable candidate for assignment to a day in the
// week window? Soft overdue/due items may land on any feasible day; upcoming
// items may pull forward within flexibility / readiness.
function isWeekCandidate(h,settings,dayBase,weekday){
  if(h.type === 'zero')return false;
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return false;
  if(h.type === 'task'){
    if(isTaskDone(h))return false;
    if(h.eventTime !== null)return false;         // timed → fixed to its day
    if(h.dueDate === null)return false;            // someday → not week-planned
    if(settings.showDueTasksInAgenda === false)return false;
    if(hasDaySchedule(h) && !isDateEligibleForHabit(h,dayBase))return false;
    const dueBase = dayStart(h.dueDate);
    const todayBase = dayStart(Date.now());
    // Overdue: catch up any day in the week.
    if(dueBase < todayBase)return true;
    // On/before deadline only — don't schedule past the due date.
    if(dayBase > dueBase)return false;
    const ready = typeof taskReadyDate === 'function' ? taskReadyDate(h) : dueBase;
    if(ready !== null && dayBase < dayStart(ready))return false;
    return true;
  }
  // Habit: schedule must allow this weekday.
  if(hasDaySchedule(h)){
    const schedule = scheduledDays(h);
    if(schedule.weekdays.length && !schedule.weekdays.includes(weekday))return false;
  }
  if(hasPlannedForDay(h,dayBase))return settings.showPlannedItemsInAgenda !== false;
  if(settings.showDueHabitsInAgenda === false)return false;
  // One-off soft plan-by: eligible any day from today through the deadline
  // (and any remaining week day once overdue) — week placement picks the day.
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null){
    const dueBase = dayStart(planBy);
    const todayBase = dayStart(Date.now());
    if(dueBase < todayBase)return true;
    if(dayBase > dueBase)return false;
    if(dayBase < todayBase)return false;
    return true;
  }
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  // Never-logged habits are due immediately (treated as infinitely overdue) so
  // a freshly created habit enters the week plan. Future-dated logs (days < 0)
  // are not yet due. After the first log, the normal rhythm applies.
  if(days !== null && days < 0)return false;
  if(days === null)return true;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days + offsetDays;
  if(ageOnDay >= target)return true;               // due/overdue by this day
  // Breakable daily rhythm: after a partial log, today's budget is still open
  // even though lastLog reset the rhythm clock (days < target). Keep placing
  // the leftover so one pulse cannot wipe every chunk off the timeline.
  if(typeof isBreakableRhythmHabit === 'function' && isBreakableRhythmHabit(h)
    && typeof breakableBudgetMinutes === 'function'
    && breakableBudgetMinutes(h,dayBase) > 0
    && typeof loggedChunkMinutesOnDay === 'function'
    && loggedChunkMinutesOnDay(h,dayBase) > 0){
    return true;
  }
  // Pull forward within flexibility so the week can absorb upcoming work.
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(flex > 0 && ageOnDay >= target - flex)return true;
  return false;
}

// Flex window for schedule-link pull. Keepup effectiveTarget is (raw+flex), so
// isWeekCandidate only opens at the raw target — too late for "do early with
// my linked habit". This mirrors canDoEarlyToday: raw target − flex.
function scheduleLinkFlexAllowsDay(h,dayBase,weekday,settings){
  if(!h || dayBase == null)return false;
  if(h.type === 'zero')return false;
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return false;
  if(hasDaySchedule(h)){
    const schedule = scheduledDays(h);
    if(schedule.weekdays.length && !schedule.weekdays.includes(weekday))return false;
    if(schedule.monthDays.length){
      const dom = new Date(dayBase).getDate();
      if(!schedule.monthDays.includes(dom))return false;
    }
  }
  if(typeof isWeekCandidate === 'function' && isWeekCandidate(h,settings || {},dayBase,weekday)){
    return true;
  }
  if(h.type === 'task'){
    if(isTaskDone(h) || h.eventTime !== null || h.dueDate === null)return false;
    const dueBase = dayStart(h.dueDate);
    const todayBase = dayStart(Date.now());
    if(dayBase > dueBase)return false;
    const ready = typeof taskReadyDate === 'function' ? taskReadyDate(h) : dueBase;
    if(ready !== null && dayBase < dayStart(ready))return false;
    return dayBase >= todayBase || dueBase < todayBase;
  }
  const days = daysSince(h.lastLog);
  if(days !== null && days < 0)return false;
  if(days === null)return true;
  const rawTarget = Math.max(MIN_RHYTHM_DAYS,Number(h.target) || 7);
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days + offsetDays;
  if(ageOnDay >= rawTarget)return true;
  if(flex > 0 && ageOnDay >= rawTarget - flex)return true;
  return false;
}

// Mutates each candidate's derived eligible Set.
// Same-day links are OR'd: the subject may appear on day D when any linked
// same-day anchor is eligible/committed there. When flex+schedule allow D,
// the subject is pulled onto D (even if rhythm alone had not listed it).
// Days where no same-day anchor is present are removed so the dependent
// never appears alone.
function applyPersistentLinkEligibility(candidates,dayStates,settings){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return candidates;
  const cfg = settings || (typeof sortSettings !== 'undefined' ? sortSettings : {});
  const byHid = new Map(candidates.filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]));
  const dayHolders = dayStates.map(item=>{
    const dayBase = item && (item.dayBase != null ? item.dayBase : (item.day && item.day.dayBase));
    const day = item && item.day ? item.day : item;
    return {dayBase,day,weekday:day && day.weekday != null ? day.weekday : (dayBase != null ? new Date(dayBase).getDay() : null)};
  }).filter(item=>item.dayBase != null);

  const anchorPresent = (anchorHid,dayBase)=>{
    if(scheduleAnchorCommitForDay(anchorHid,dayBase))return true;
    const anchorCandidate = byHid.get(anchorHid);
    return Boolean(anchorCandidate && anchorCandidate.eligible && anchorCandidate.eligible.has(dayBase));
  };

  for(const candidate of candidates){
    const subjectHid = candidate && candidate.h && candidate.h.hid;
    if(!subjectHid)continue;
    if(!candidate.eligible)candidate.eligible = new Set();
    const sameDayLinks = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(candidate.h)
      : normalizeScheduleLinks(candidate.h.scheduleLinks,subjectHid).filter(l=>l && l.requireSameDay);
    if(!sameDayLinks.length)continue;

    for(const {dayBase,day,weekday} of dayHolders){
      const anyAnchor = sameDayLinks.some(link=>anchorPresent(link.anchorHid,dayBase));
      if(anyAnchor){
        // Flex-gated pull: add D when early/flex window or week candidate allows it.
        const already = candidate.eligible.has(dayBase);
        const allowed = already || scheduleLinkFlexAllowsDay(candidate.h,dayBase,weekday,cfg);
        if(allowed){
          if(!already)candidate.eligible.add(dayBase);
        }
      }else if(candidate.eligible.has(dayBase)){
        candidate.eligible.delete(dayBase);
        const anchorName = (typeof load === 'function' ? load() : []).find(item=>item && item.hid === sameDayLinks[0].anchorHid)?.name
          || 'anchor';
        addScheduleLinkOmission(day,subjectHid,`waiting for ${anchorName} to be eligible this day`);
      }
    }
  }
  return candidates;
}

// PURE helper: planned-for-day predicate. hasPlannedToday checks today; this
// generalises to any day. Mirrors the actualLogs/plannedLogs intersection.
function hasPlannedForDay(h,dayBase){
  const key = dateKey(dayBase);
  const planned = plannedLogs(h.logs || []);
  if(!planned.length)return false;
  return planned.some(ts=>dateKey(ts) === key);
}

// PURE: locations already committed on a day before fills — scheduled-task
// locations + location-tied blocks. Used by tests and as a cluster seed view.
function daySeedLocationSet(day,settings,registry){
  const set = new Set();
  for(const ev of day.scheduled || []){
    const ids = normalizeLocationIds(ev.h.locationIds,registry);
    const locId = primaryPreferredLocationId(ev.h.locationPrefs,ids) || normalizePreferredLocation(ev.h.preferredLocationId,ids) || ids[0];
    if(locId)set.add(locId);
  }
  for(const block of normalizeBlockedTimes(settings.blockedTimes)){
    if(block.days.length && !block.days.includes(day.weekday))continue;
    if(block.locationId)set.add(block.locationId);
  }
  return set;
}

// PURE: soft preference miss costs for week scoring (never veto placement).
function weekPreferencePenalty(h,fit,day,registry){
  let penalty = 0;
  const ids = normalizeLocationIds(h.locationIds,registry);
  const pref = primaryPreferredLocationId(h.locationPrefs,ids) || normalizePreferredLocation(h.preferredLocationId,ids);
  if(pref && fit.locId && pref !== fit.locId)penalty += 120;
  // Honor avoid/little/high levels: reward high/little, strongly penalize avoid.
  if(fit.locId){
    const level = locationPrefLevel(h,fit.locId);
    if(level === 'high')penalty -= 60;
    else if(level === 'little')penalty -= 20;
    else if(level === 'avoid')penalty += 80;
  }
  if(fit.preferredHit)penalty -= 40;
  else{
    const loc = fit.locId ? registry.find(l=>l.id === fit.locId) : null;
    const locPref = loc && Number.isFinite(loc.preferredTimeStart) ? day.dayBase + loc.preferredTimeStart * 60000 : null;
    // Only score a habit preferred-time miss when the habit actually has one.
    // fillPreferredStart used to return midnight for unset preferences
    // (Number(null)===0), which falsely penalised any later placement.
    const habitPref = (typeof hasPreferredTimeWindow === 'function' && !hasPreferredTimeWindow(h))
      ? null
      : fillPreferredStart(h,day.dayBase);
    const prefTs = locPref || habitPref;
    if(prefTs != null && Math.abs(fit.placeStart - prefTs) > 30 * 60000)penalty += 60;
  }
  // Mild prefer preferred weekdays when set.
  if(typeof hasPreferredDays === 'function' && hasPreferredDays(h) && typeof isPreferredDay === 'function'){
    if(!isPreferredDay(h,day.dayBase))penalty += 35;
  }
  return penalty;
}

// PURE: place-then-commit week assignment. A day wins only if tryPlaceOnDay
// succeeds under hard constraints; score then picks among feasible days.
// Breakable tasks place one chunk per pass — each chunk is scored and
// committed independently so a long task can spread across days/time.
//
// locHints (optional): Map<dayBase, Array<{locId, idx}>> captured from a prior
// greedy pass. When set, a co-location bonus pulls each candidate toward a day
// where that pass already sent a NEARBY place — so two far-from-home but close-
// to-each-other errands share one trip even when one is day-pinned and the
// flexible one is processed before its partner (the case a single greedy pass
// can't see). The bonus is the commute saved (daySeed→loc minus the inter-hop),
// and only fires when the partner is genuinely closer than the day's origin, so
// near-home work is completely unaffected.
//
// Rhythm habits (non-task, non-breakable keepup/reduce) are placed on EACH
// eligible day their rhythm allows. Daily rhythms (target ≤ 1) walk the week
// chronologically so an earlier feasible day is never skipped forever once
// virtualLastLog advances. Sparse rhythms (target > 1) still shop for a
// best-scoring day first so a weekly far habit can defer to cluster with a
// co-located partner. After every commit the virtual lastLog advances, so
// target:1 lands every day, target:3 every third day, etc. Tasks and
// breakable habits keep one-shot best-day scoring.

// PURE: rhythm check for multi-day week placement. Given a habit and the
// timestamp it was last "completed" (real lastLog, or a virtual one advanced
// after each prior placement this pass), is it due again on dayBase? Mirrors
// the rhythm logic in isWeekCandidate but accepts a lastLog override so the
// placement loop can simulate "if I did this on Tuesday, am I due again on
// Wednesday?". Schedule weekday-gates still apply. Flexibility pull-forward
// is intentionally NOT consulted here — flex only widens the INITIAL eligible
// set (via isWeekCandidate); spacing between successive placements uses the
// raw target so a daily habit lands on every day, not every (target+flex) days.
function rhythmEligibleOnDay(h,lastLogTs,dayBase,weekday){
  if(!h)return false;
  if(typeof hasDaySchedule === 'function' && hasDaySchedule(h)){
    const schedule = typeof scheduledDays === 'function' ? scheduledDays(h) : null;
    if(schedule && schedule.weekdays && schedule.weekdays.length && !schedule.weekdays.includes(weekday))return false;
  }
  const target = Math.max(1,Number(h && h.target) || 7);
  if(lastLogTs == null)return true; // never completed → due immediately
  const ageDays = Math.round((dayBase - dayStart(lastLogTs)) / 86400000);
  return ageDays >= target;
}
function assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints){
  const todayBase = dayStates[0] ? dayStates[0].dayBase : dayStart(Date.now());
  const registry = dayStates[0] ? dayStates[0].registry : normalizeLocationRegistry(settings.locations);
  const mode = dayStates[0] ? dayStates[0].mode : normalizeTravelMode(settings.defaultTravelMode);
  const weights = resolveAgendaScoreWeights(settings);
  for(const c of candidates){
    if(c.scarcity == null)c.scarcity = scarcityScore(c,dayStates);
  }
  candidates.sort(compareScarcityThenPriority);
  // Soft boost: place "before" sides of same-day order links earlier in the
  // assignment loop so their successors can sit after them.
  const doingRaw = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const doing = doingRaw
    && (typeof isDoingNowActive !== 'function' || isDoingNowActive(doingRaw))
    ? doingRaw : null;
  if(typeof plannerOrderConstraintsForDay === 'function' || doing){
    const beforeBoost = new Map();
    for(const state of dayStates){
      for(const e of plannerOrderConstraintsForDay(state.dayBase)){
        beforeBoost.set(e.beforeHid,(beforeBoost.get(e.beforeHid) || 0) + (e.adjacency === 'direct' ? 2 : 1));
      }
    }
    candidates.sort((a,b)=>{
      const ah = a && a.h && a.h.hid;
      const bh = b && b.h && b.h.hid;
      if(doing && ah === doing.hid && bh !== doing.hid)return -1;
      if(doing && bh === doing.hid && ah !== doing.hid)return 1;
      const wa = beforeBoost.get(ah) || 0;
      const wb = beforeBoost.get(bh) || 0;
      if(wa !== wb)return wb - wa;
      return compareScarcityThenPriority(a,b);
    });
  }
  let totalAssigned = 0;
  // Daily recurring breakables (e.g. "Work 6h every weekday") fill LAST so that
  // movable candidates (plan-by errands, one-shot tasks, sparse rhythms) can
  // claim a gap on a quiet day before the breakable greedy-splits the window
  // into pieces too small for them. A capacity guard (fastPathDefersMovable)
  // keeps movables out of a busy day's breakable reservation, so this is the
  // fast-path equivalent of the GLPK reservation, not a free-for-all.
  const isDailyBreakable = c => !!(c && c.h && c.h.breakable && c.h.type !== 'task'
    && Number.isFinite(Number(c.h.target)) && Number(c.h.target) <= 1);
  let ordered = [];
  for(const c of candidates){ if(!isDailyBreakable(c))ordered.push(c); }
  for(const c of candidates){ if(isDailyBreakable(c))ordered.push(c); }
  // The daily-breakable pass normally runs last for capacity protection, but
  // an explicit drag order wins. Reapply each day's precedence graph after
  // building that default order so A → breakable X → B is actually assigned
  // in that sequence instead of merely receiving a soft score.
  for(const state of dayStates){
    ordered = reorderAgendaItemsByOrderConstraints(ordered,state.dayBase);
  }
  for(const c of ordered){
    const pinned = c.pinned === true;
    // Breakable tasks: one-shot continuous-first pool across the week.
    // Breakable keepup/reduce: still rhythm (daily/sparse) with a fresh
    // duration budget each eligible day — continuous-first / adaptive split
    // within that day only (so "work 7h every day" lands today + every day,
    // not once on the emptiest tomorrow).
    if(c.h && c.h.breakable && c.h.type === 'task'){
      totalAssigned += placeBreakableAcrossWeek(c,dayStates,settings,locHints,{
        todayBase,registry,mode,weights,candidates,pinned
      });
      continue;
    }
    const rhythmHabit = !!(c.h && c.h.type !== 'task'
      && Number.isFinite(Number(c.h && c.h.target)));
    const breakableRhythm = !!(c.h && c.h.breakable && rhythmHabit);
    let virtualLastLog = rhythmHabit && c.h ? c.h.lastLog : null;
    let rhythmPlacementCount = 0;
    const dailyRhythm = rhythmHabit && Number(c.h && c.h.target) <= 1;
    if(dailyRhythm){
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        if(rhythmPlacementCount > 0 && virtualLastLog != null
          && !rhythmEligibleOnDay(c.h,virtualLastLog,state.dayBase,state.weekday))continue;
        const fill = { h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned)
        };
        if(doing && c.h && c.h.hid === doing.hid && doing.dayBase === state.dayBase){
          dayOpts.doingNowStart = Math.min(Number(doing.startedAt) || Date.now(), Date.now());
        }
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        if(breakableRhythm){
          const before = state.fills.length;
          if(placeBreakableSessions(state,fill,{...dayOpts, allowNetwork:true})){
            const added = state.fills.slice(before);
            for(const entry of added){
              state.day.agendaItems.push({
                h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
                locationId:entry.fit.locId,
                chunkMinutes:entry.fit.durMin,
                chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
              });
              totalAssigned += 1;
            }
            virtualLastLog = state.dayBase;
            rhythmPlacementCount += 1;
          }
          continue;
        }
        const fit = tryPlaceOnDay(state,fill,{...dayOpts, allowNetwork:true});
        if(!fit)continue;
        commitPlacement(state,fill,fit);
        state.day.agendaItems.push({
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:fit.locId
        });
        totalAssigned += 1;
        virtualLastLog = state.dayBase;
        rhythmPlacementCount += 1;
      }
      continue;
    }
    // Sparse rhythm / one-shot: pick the best-scoring feasible day, then
    // (for rhythm) advance and repeat for later eligible days only.
    while(true){
      let best = null;
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        if(rhythmHabit && rhythmPlacementCount > 0 && virtualLastLog != null
          && !rhythmEligibleOnDay(c.h,virtualLastLog,state.dayBase,state.weekday))continue;
        // Reservation: defer this movable to a quieter eligible day when placing
        // it here would breach a daily breakable's target. No-alternative and
        // higher-priority cases still place here (handled inside the helper).
        if(typeof fastPathDefersMovable === 'function'
          && fastPathDefersMovable(c,state,candidates,dayStates))continue;
        const fill = { h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned)
        };
        if(doing && c.h && c.h.hid === doing.hid && doing.dayBase === state.dayBase){
          dayOpts.doingNowStart = Math.min(Number(doing.startedAt) || Date.now(), Date.now());
        }
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        if(breakableRhythm){
          // Dry-run continuous-first / largest piece for scoring without commit.
          const clone = clonePlacementState(state);
          const probeFill = {...fill};
          const placed = placeBreakableSessions(clone,probeFill,{...dayOpts, allowNetwork:true});
          if(!placed || !clone.fills.length)continue;
          const first = clone.fills[clone.fills.length - 1];
          const fitProbe = first.fit;
          const travel = fitProbe.edge.seconds || 0;
          const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
          const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
          const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
          const score = scoreAgendaPlacement({
            travelSeconds:travel,
            clusterBonus:clusterBonus + linkDayBonus,
            coLocHint,
            dayOffsetPenalty:dayOpts.dayOffsetPenalty,
            asapDelayMin:0,
            scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
            preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
            urgency:c.urgency
          },weights);
          const cand = { state, fill, dayOpts, score, breakable:true };
          if(!best || score < best.score)best = cand;
          continue;
        }
        const fitProbe = tryPlaceOnDay(state,fill,{...dayOpts, allowNetwork:true});
        if(!fitProbe)continue;
        const travel = fitProbe.edge.seconds || 0;
        const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
        const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
        const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
        const score = scoreAgendaPlacement({
          travelSeconds:travel,
          clusterBonus:clusterBonus + linkDayBonus,
          coLocHint,
          dayOffsetPenalty:dayOpts.dayOffsetPenalty,
          asapDelayMin:0,
          scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
          preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
          urgency:c.urgency
        },weights);
        const cand = { state, fill, fit:fitProbe, score };
        if(!best || score < best.score)best = cand;
      }
      if(!best)break;
      if(best.breakable){
        const before = best.state.fills.length;
        if(!placeBreakableSessions(best.state,best.fill,{...best.dayOpts, allowNetwork:true}))break;
        const added = best.state.fills.slice(before);
        for(const entry of added){
          best.state.day.agendaItems.push({
            h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
            locationId:entry.fit.locId,
            chunkMinutes:entry.fit.durMin,
            chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
          });
          totalAssigned += 1;
        }
      }else{
        commitPlacement(best.state,best.fill,best.fit);
        best.state.day.agendaItems.push({
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:best.fit.locId
        });
        totalAssigned += 1;
      }
      if(rhythmHabit){
        virtualLastLog = best.state.dayBase;
        rhythmPlacementCount += 1;
      }
      if(!rhythmHabit)break;
    }
  }
  totalAssigned += rebalanceScarcePlacements(candidates,dayStates,settings,locHints);
  totalAssigned += rescueLeftoverWeekFits(candidates,dayStates,settings);
  // Week-holistic: if daily Work is still short, peel can-wait movables to
  // other days and refill — maximize placed hours across the week.
  if(typeof repairWeekPlacedHours === 'function'){
    totalAssigned += repairWeekPlacedHours(candidates,dayStates,settings);
  }
  compactFastTravelRoutes(dayStates,candidates,settings);
  enforcePersistentLinkInvariants(dayStates,candidates,settings);
  return totalAssigned;
}

/**
 * PURE: week placement for one breakable candidate — try full remaining on the
 * best day, then largest valid pieces. Prefer continuing on the same day.
 */
function placeBreakableAcrossWeek(c,dayStates,settings,locHints,ctx){
  if(!c || !c.h || !c.h.breakable)return 0;
  const {todayBase,registry,mode,weights,candidates,pinned} = ctx;
  const min = typeof clampMinChunk === 'function'
    ? clampMinChunk(c.h.minChunkMinutes)
    : (c.h.minChunkMinutes || 30);
  let left = breakableMinutesLeft(c.h,c.i,dayStates);
  let chunkIndex = 0;
  let preferredState = null;
  let gained = 0;
  while(left > 0){
    const orderedStates = preferredState
      ? [preferredState,...dayStates.filter(s=>s !== preferredState)]
      : dayStates.slice();
    let best = null;
    // Pass 1: continuous full remaining.
    for(const state of orderedStates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(pinned && !state.isTodayDay)continue;
      const fill = {
        h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
        chunkMinutes:left, chunkIndex, placeKey:`${c.i}:${chunkIndex}`
      };
      const offset = Math.round((state.dayBase - todayBase) / 86400000);
      const dayOpts = {
        settings,
        weights,
        urgency:c.urgency,
        dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned),
        allowNetwork:true
      };
      if(!isScarceScore(c.scarcity)){
        const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
        if(spare.length)dayOpts.spareWindows = spare;
      }
      const fitProbe = tryPlaceOnDay(state,fill,dayOpts);
      if(!fitProbe)continue;
      const travel = fitProbe.edge.seconds || 0;
      const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
      const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
      const sameDayBonus = preferredState && state === preferredState ? 200 : 0;
      const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
      const score = scoreAgendaPlacement({
        travelSeconds:travel,
        clusterBonus:clusterBonus + sameDayBonus + linkDayBonus,
        coLocHint,
        dayOffsetPenalty:dayOpts.dayOffsetPenalty,
        asapDelayMin:0,
        scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
        preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
        urgency:c.urgency
      },weights);
      const cand = { state, fill, fit:fitProbe, score, durMin:fitProbe.durMin };
      if(!best || score < best.score)best = cand;
    }
    // Pass 2: adaptive largest valid piece when full remaining will not fit.
    if(!best){
      for(const state of orderedStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue;
        const fill = {
          h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity,
          chunkMinutes:left, chunkIndex, placeKey:`${c.i}:${chunkIndex}`
        };
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const dayOpts = {
          settings,
          weights,
          urgency:c.urgency,
          dayOffsetPenalty:flexAwareDayPenalty(c.h,offset,c.urgency,pinned),
          allowNetwork:true
        };
        if(!isScarceScore(c.scarcity)){
          const spare = scarceWindowsToSpare(candidates,state.dayBase,state.seedLocId,state.dayBase);
          if(spare.length)dayOpts.spareWindows = spare;
        }
        const largest = largestFeasibleBreakableFit(state,fill,left,min,dayOpts);
        if(!largest || !largest.fit)continue;
        const fitProbe = largest.fit;
        const travel = fitProbe.edge.seconds || 0;
        const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
        const coLocHint = colocateHintBonus(state,fitProbe.locId,c.i,locHints,registry,mode);
        const sameDayBonus = preferredState && state === preferredState ? 200 : 0;
        const linkDayBonus = scheduleLinkDayBonus(c.h,state.dayBase,candidates);
        const score = scoreAgendaPlacement({
          travelSeconds:travel,
          clusterBonus:clusterBonus + sameDayBonus + linkDayBonus,
          coLocHint,
          dayOffsetPenalty:dayOpts.dayOffsetPenalty,
          asapDelayMin:0,
          scarceOverlapMs:fitOverlapWithWindows(fitProbe,dayOpts.spareWindows || []),
          preferencePenalty:weekPreferencePenalty(c.h,fitProbe,state,registry),
          urgency:c.urgency
        },weights);
        // Prefer larger pieces, then better soft score.
        const cand = { state, fill, fit:fitProbe, score, durMin:fitProbe.durMin };
        if(!best
          || cand.durMin > best.durMin
          || (cand.durMin === best.durMin && score < best.score)){
          best = cand;
        }
      }
    }
    if(!best)break;
    best.fill.chunkMinutes = best.fit.durMin;
    best.fill.chunkIndex = chunkIndex;
    best.fill.placeKey = `${c.i}:${chunkIndex}`;
    best.fit.placeKey = best.fill.placeKey;
    commitPlacement(best.state,best.fill,best.fit);
    best.state.placed.add(c.i);
    best.state.day.agendaItems.push({
      h:c.h, i:c.i, priority:c.priority, scarcity:c.scarcity, locationId:best.fit.locId,
      chunkMinutes:best.fit.durMin,
      chunkIndex
    });
    left -= best.fit.durMin;
    preferredState = best.state;
    chunkIndex += 1;
    gained += 1;
  }
  return gained;
}

// PURE: after greedy + scarce rebalance, fill any remaining due habits that
// still fit on a day with leftover budget/open gaps. Catches order/budget
// misses where rem > 0 (or a later gap is free) but the habit never got a
// commit — the "blank all week until I plan it" failure mode.
function rescueLeftoverWeekFits(candidates,dayStates,settings,opts = {}){
  let gained = 0;
  if(!Array.isArray(candidates) || !Array.isArray(dayStates))return 0;
  // Full week pool for reservation / deferral checks (caller may pass only
  // non-breakables to place — without the daily breakables in-scope, spare
  // looks infinite and packed lower-priority items steal Work chunks).
  const deferPool = Array.isArray(opts.allCandidates) && opts.allCandidates.length
    ? opts.allCandidates
    : candidates;
  for(const c of candidates){
    if(!c || !c.h)continue;
    // Breakable tasks: one-shot leftover pool across days.
    if(c.h.breakable && c.h.type === 'task'){
      gained += placeBreakableAcrossWeek(c,dayStates,settings,null,{
        todayBase:dayStates[0] ? dayStates[0].dayBase : dayStart(Date.now()),
        registry:dayStates[0] ? dayStates[0].registry : normalizeLocationRegistry(settings.locations),
        mode:dayStates[0] ? dayStates[0].mode : normalizeTravelMode(settings.defaultTravelMode),
        weights:resolveAgendaScoreWeights(settings),
        candidates:deferPool,
        pinned:c.pinned === true
      });
      continue;
    }
    const rhythmHabit = !!(c.h.type !== 'task'
      && Number.isFinite(Number(c.h.target)));
    const breakableRhythm = !!(c.h.breakable && rhythmHabit);
    let lastPlaced = rhythmHabit ? c.h.lastLog : null;
    let alreadyOneShot = false;
    for(const state of dayStates){
      if(state.placed.has(c.i)){
        lastPlaced = state.dayBase;
        if(!rhythmHabit)alreadyOneShot = true;
      }
    }
    if(alreadyOneShot)continue;
    for(const state of dayStates){
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(c.pinned && !state.isTodayDay)continue;
      if(state.placed.has(c.i)){
        lastPlaced = state.dayBase;
        continue;
      }
      if(rhythmHabit && lastPlaced != null
        && !rhythmEligibleOnDay(c.h,lastPlaced,state.dayBase,state.weekday))continue;
      // Same week-holistic rule as the ILP reserve: can-wait yields; packed
      // equal/lower priority must not steal a daily breakable chunk.
      if(typeof fastPathDefersMovable === 'function'
        && fastPathDefersMovable(c,state,deferPool,dayStates))continue;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      if(breakableRhythm){
        const before = state.fills.length;
        if(!placeBreakableSessions(state,fill,{settings,allowNetwork:true}))continue;
        const added = state.fills.slice(before);
        for(const entry of added){
          state.day.agendaItems.push({
            h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:entry.fit.locId,
            chunkMinutes:entry.fit.durMin,
            chunkIndex:entry.fill.chunkIndex != null ? entry.fill.chunkIndex : null
          });
          gained += 1;
        }
        lastPlaced = state.dayBase;
        continue;
      }
      const fit = tryPlaceOnDay(state,fill,{settings,allowNetwork:true});
      if(!fit)continue;
      commitPlacement(state,fill,fit);
      state.day.agendaItems.push({
        h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:fit.locId
      });
      lastPlaced = state.dayBase;
      gained += 1;
      if(!rhythmHabit)break;
    }
  }
  return gained;
}

// PURE: total committed fill+travel minutes across the week (hours-first score).
function weekPlacedMinutes(dayStates){
  if(!Array.isArray(dayStates))return 0;
  let total = 0;
  for(const state of dayStates){
    if(!state || !Array.isArray(state.fills))continue;
    for(const entry of state.fills){
      total += Number(entry && entry.fit && entry.fit.durMin) || 0;
      total += Number(entry && entry.fit && entry.fit.travelMin) || 0;
    }
  }
  return total;
}

// PURE: soft tiebreak — lower travel seconds across fills is better.
function weekTravelSecondsFromStates(dayStates){
  if(!Array.isArray(dayStates))return 0;
  let total = 0;
  for(const state of dayStates){
    if(!state || !Array.isArray(state.rows))continue;
    for(const row of state.rows){
      if(row && row.kind === 'travel')total += Number(row.seconds) || 0;
    }
  }
  return total;
}

// PURE: rebuild a day state's fills from a keep-list (scheduled rows preserved).
// Used by week hours repair when peeling a movable to another day.
function rebuildDayFromFills(state,fillsToKeep,candidates,opts = {}){
  const clean = clonePlacementState(state);
  clean.rows = state.rows.filter(r=>r.kind === 'scheduled');
  clean.fills = [];
  clean.placed = new Set();
  clean.usedMinutes = 0;
  clean.remaining = Math.max(0,Number(state.totalMinutes) || 0);
  clean.prevLocId = state.seedLocId;
  const scoreOpts = {
    settings:state.settings || opts.settings,
    weights:typeof resolveAgendaScoreWeights === 'function'
      ? resolveAgendaScoreWeights(state.settings || opts.settings) : null,
    allowNetwork:opts.allowNetwork !== false,
    spareWindows:typeof scarceWindowsToSpare === 'function'
      ? scarceWindowsToSpare(candidates || [],clean.dayBase,clean.seedLocId,clean.dayBase)
      : null
  };
  for(const fill of fillsToKeep){
    if(!fill || !fill.h)continue;
    if(fill.h.breakable){
      const before = clean.fills.length;
      if(!placeBreakableSessions(clean,fill,scoreOpts))return null;
      // placeBreakableSessions may split; ok
      void before;
      continue;
    }
    const fit = tryPlaceOnDay(clean,fill,scoreOpts);
    if(!fit)return null;
    commitPlacement(clean,fill,fit);
  }
  clean.day = state.day;
  syncDayAgendaItemsFromFills(clean);
  return clean;
}

function syncDayAgendaItemsFromFills(state){
  if(!state || !state.day)return;
  state.day.agendaItems = (state.fills || []).map(f=>({
    h:f.fill.h,i:f.fill.i,priority:f.fill.priority,scarcity:f.fill.scarcity,
    locationId:f.fit.locId,
    chunkMinutes:f.fill.chunkMinutes != null ? f.fill.chunkMinutes : null,
    chunkIndex:f.fill.chunkIndex != null ? f.fill.chunkIndex : null
  }));
}

function applyPlacementState(target,source){
  target.rows = source.rows;
  target.fills = source.fills;
  target.placed = source.placed;
  target.remaining = source.remaining;
  target.usedMinutes = source.usedMinutes;
  target.prevLocId = source.prevLocId;
  if(target.day && source.day)target.day.agendaItems = source.day.agendaItems;
  else syncDayAgendaItemsFromFills(target);
}

// PURE: compare the work retained by two day states. Route compaction is only
// allowed to change the order/times of already-accepted fills, never which
// candidate (or how many of its minutes) survived placement.
function dayFillMinuteSignature(state){
  const totals = new Map();
  for(const entry of (state && state.fills) || []){
    const fill = entry && entry.fill;
    const fit = entry && entry.fit;
    if(!fill || !fit)continue;
    const key = fill.i;
    totals.set(key,(totals.get(key) || 0) + Math.max(0,Number(fit.durMin) || 0));
  }
  return [...totals.entries()]
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
    .map(([key,minutes])=>`${key}:${minutes}`)
    .join('|');
}

function dayTravelSecondsFromState(state){
  return ((state && state.rows) || []).reduce(
    (sum,row)=>sum + (row && row.kind === 'travel' ? Number(row.seconds) || 0 : 0),0);
}

// PURE: nearest-neighbour replay order for fills already selected on one day.
// The actual replay still goes through tryPlaceOnDay, so allowed windows,
// scheduled rows, capacity, and persistent order constraints remain hard gates.
function routeCompactFillOrder(state){
  const left = (state && state.fills ? state.fills : []).map(entry=>entry.fill);
  const out = [];
  let anchor = state && state.seedLocId || null;
  while(left.length){
    let bestIdx = 0;
    let bestSeconds = Infinity;
    for(let i = 0;i < left.length;i += 1){
      const fill = left[i];
      const locId = fill.locationId
        || pickHabitLocationId(fill.h,anchor,state.registry,state.mode);
      const seconds = travelEdgeBetweenIds(
        anchor,locId,state.registry,state.mode,{allowNetwork:false}
      ).seconds || 0;
      if(seconds < bestSeconds){
        bestSeconds = seconds;
        bestIdx = i;
      }
    }
    const picked = left.splice(bestIdx,1)[0];
    out.push(picked);
    const locId = picked.locationId
      || pickHabitLocationId(picked.h,anchor,state.registry,state.mode);
    if(locId)anchor = locId;
  }
  return reorderAgendaItemsByOrderConstraints(out,state.dayBase);
}

// MUTATE: make a bounded, deterministic route improvement after Fast has
// decided what belongs on each day. This closes the common greedy artifact
// "far errand → flexible home task → nearby far errand". A replay is adopted
// only when it preserves the exact per-candidate minutes and strictly reduces
// travel, so placement coverage cannot regress.
function compactFastTravelRoutes(dayStates,candidates,settings){
  let improved = 0;
  for(const state of dayStates || []){
    if(!state || !Array.isArray(state.fills) || state.fills.length < 2)continue;
    const beforeSignature = dayFillMinuteSignature(state);
    const beforeTravel = dayTravelSecondsFromState(state);
    if(beforeTravel <= 0)continue;
    const order = routeCompactFillOrder(state);
    const isolated = {
      ...state,
      day:{...state.day,agendaItems:(state.day.agendaItems || []).slice()}
    };
    const rebuilt = rebuildDayFromFills(
      isolated,order,candidates,{settings,allowNetwork:false}
    );
    if(!rebuilt)continue;
    if(dayFillMinuteSignature(rebuilt) !== beforeSignature)continue;
    if(dayTravelSecondsFromState(rebuilt) >= beforeTravel)continue;
    applyPlacementState(state,rebuilt);
    improved += 1;
  }
  return improved;
}

function addScheduleLinkOmission(day,subjectHid,reason){
  if(!day || !subjectHid || !reason)return;
  if(!Array.isArray(day.linkOmissions))day.linkOmissions = [];
  if(day.linkOmissions.some(item=>item.subjectHid === subjectHid && item.reason === reason))return;
  day.linkOmissions.push({subjectHid,reason});
}

// Soft preference: prefer days where a same-day OR partner is already
// eligible/committed so linked habits co-place instead of using an earlier
// empty flex day.
function scheduleLinkDayBonus(h,dayBase,candidates){
  if(!h || dayBase == null)return 0;
  const sameDayLinks = typeof sameDayScheduleLinks === 'function'
    ? sameDayScheduleLinks(h)
    : normalizeScheduleLinks(h.scheduleLinks,h.hid).filter(l=>l && l.requireSameDay);
  if(!sameDayLinks.length)return 0;
  const byHid = Array.isArray(candidates)
    ? new Map(candidates.filter(c=>c && c.h && c.h.hid).map(c=>[c.h.hid,c]))
    : null;
  for(const link of sameDayLinks){
    if(typeof scheduleAnchorCommitForDay === 'function' && scheduleAnchorCommitForDay(link.anchorHid,dayBase)){
      return 180;
    }
    const anchor = byHid && byHid.get(link.anchorHid);
    if(anchor && anchor.eligible && anchor.eligible.has(dayBase))return 180;
  }
  return 0;
}

function persistentLinkViolationsForState(state){
  const violations = new Map();
  if(!state)return violations;
  const edges = typeof persistentOrderConstraintsForDay === 'function'
    ? persistentOrderConstraintsForDay(state.dayBase) : [];
  const chron = (state.fills || []).slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
  const bounds = new Map();
  for(const entry of chron){
    const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
    if(!hid || !entry.fit)continue;
    const prev = bounds.get(hid);
    bounds.set(hid,{
      start:prev ? Math.min(prev.start,entry.fit.placeStart) : entry.fit.placeStart,
      end:prev ? Math.max(prev.end,entry.fit.placeEnd) : entry.fit.placeEnd
    });
  }
  const resolveAnchor = (anchorHid)=>
    bounds.get(anchorHid) || scheduleAnchorCommitForDay(anchorHid,state.dayBase);

  // Same-day (requiresPair) edges are OR'd per subject: placed alone is a
  // violation only when none of the OR partners are present.
  const sameDayBySubject = new Map();
  for(const edge of edges){
    if(!edge.requiresPair || !edge.subjectHid)continue;
    if(!sameDayBySubject.has(edge.subjectHid))sameDayBySubject.set(edge.subjectHid,[]);
    sameDayBySubject.get(edge.subjectHid).push(edge);
  }
  for(const [subjectHid,subjectEdges] of sameDayBySubject){
    const subject = bounds.get(subjectHid);
    if(!subject)continue;
    const present = subjectEdges.filter(edge=>resolveAnchor(edge.anchorHid));
    if(!present.length){
      violations.set(subjectHid,'anchor is not planned or done this day');
      continue;
    }
    for(const edge of present){
      const anchor = resolveAnchor(edge.anchorHid);
      const before = edge.direction === 'before' ? subject : anchor;
      const after = edge.direction === 'before' ? anchor : subject;
      if(before.end > after.start + 60000){
        violations.set(edge.subjectHid,`cannot be ${edge.direction} its anchor`);
        continue;
      }
      if(edge.adjacency === 'direct'){
        const between = chron.some(entry=>{
          const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
          if(!hid || hid === edge.subjectHid || hid === edge.anchorHid || !entry.fit)return false;
          return entry.fit.placeStart + 60000 >= before.end && entry.fit.placeEnd <= after.start + 60000;
        });
        if(between)violations.set(edge.subjectHid,`no right-${edge.direction} slot is available`);
      }
    }
  }

  // Order-only (non-same-day) edges still enforce order when both are placed.
  for(const edge of edges){
    if(edge.requiresPair)continue;
    const subject = bounds.get(edge.subjectHid);
    if(!subject)continue;
    const anchor = resolveAnchor(edge.anchorHid);
    if(!anchor)continue;
    const before = edge.direction === 'before' ? subject : anchor;
    const after = edge.direction === 'before' ? anchor : subject;
    if(before.end > after.start + 60000){
      violations.set(edge.subjectHid,`cannot be ${edge.direction} its anchor`);
      continue;
    }
    if(edge.adjacency === 'direct'){
      const between = chron.some(entry=>{
        const hid = entry && entry.fill && entry.fill.h && entry.fill.h.hid;
        if(!hid || hid === edge.subjectHid || hid === edge.anchorHid || !entry.fit)return false;
        return entry.fit.placeStart + 60000 >= before.end && entry.fit.placeEnd <= after.start + 60000;
      });
      if(between)violations.set(edge.subjectHid,`no right-${edge.direction} slot is available`);
    }
  }
  return violations;
}

// Final invariant pass shared by Fast and GLPK. Repair/rescue stages are free
// to move unrelated work, but may never leave a visibly linked subject in a
// violating position.
function enforcePersistentLinkInvariants(dayStates,candidates,settings){
  if(!Array.isArray(dayStates))return;
  for(const state of dayStates){
    let guard = 0;
    while(guard++ < 8){
      const violations = persistentLinkViolationsForState(state);
      if(!violations.size)break;
      for(const [hid,reason] of violations)addScheduleLinkOmission(state.day,hid,reason);
      const keep = (state.fills || [])
        .filter(entry=>!violations.has(entry && entry.fill && entry.fill.h && entry.fill.h.hid))
        .map(entry=>entry.fill);
      const rebuilt = rebuildDayFromFills(state,keep,candidates,{settings,allowNetwork:false});
      if(!rebuilt)break;
      applyPlacementState(state,rebuilt);
    }
  }
}

// Week-holistic repair: when a daily breakable (e.g. Work) is short and a
// can-wait movable sits in its window, peel that movable to another eligible
// day and refill Work. Accept only if week placed minutes do not drop (hours
// first); soft travel is a tiebreak. Bounded attempts — mirrors
// rebalanceScarcePlacements.
function repairWeekPlacedHours(candidates,dayStates,settings){
  if(!Array.isArray(candidates) || !Array.isArray(dayStates) || !dayStates.length)return 0;
  const MAX_ATTEMPTS = 16;
  let attempts = 0;
  let moves = 0;
  const byIndex = new Map(candidates.map(c=>[c.i,c]));

  const shortBreakableOn = (state)=>{
    const reservations = dailyBreakableReservations(state,candidates);
    for(const r of reservations){
      if(r.deficit <= 0)continue;
      const c = byIndex.get(r.i);
      if(c)return {c,r};
    }
    return null;
  };

  const isDeferrableFrom = (c,fromState)=>{
    if(!isMovableWeekCandidate(c))return false;
    const dur = clampDuration(c.h.durationMinutes);
    for(const other of dayStates){
      if(other === fromState)continue;
      if(c.eligible && !c.eligible.has(other.dayBase))continue;
      if(c.pinned && !other.isTodayDay)continue;
      if(other.placed.has(c.i))continue;
      const cap = movableCapacityForDay(other,candidates);
      if(!Number.isFinite(cap) || cap >= dur)return true;
      // Even if other day has a breakable, tryPlace may still fit outside its window.
      if(typeof tryPlaceOnDay === 'function'){
        const probe = clonePlacementState(other);
        const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
        if(tryPlaceOnDay(probe,fill,{allowNetwork:false,settings}))return true;
      }
    }
    return false;
  };

  while(attempts < MAX_ATTEMPTS){
    let short = null;
    for(const state of dayStates){
      const hit = shortBreakableOn(state);
      if(hit){ short = {state,...hit}; break; }
    }
    if(!short)break;

    const windows = breakableReservationWindows(short.r);
    const victims = short.state.fills.filter(entry=>{
      if(!entry || !entry.fill || !entry.fit)return false;
      const c = byIndex.get(entry.fill.i);
      if(!c || !isDeferrableFrom(c,short.state))return false;
      if(!windows.some(win=>
        entry.fit.placeEnd > win.start && entry.fit.placeStart < win.end))return false;
      return true;
    });
    // Prefer longer victims first — more likely to unlock a Work chunk.
    victims.sort((a,b)=>(Number(b.fit.durMin) || 0) - (Number(a.fit.durMin) || 0));

    let improved = false;
    for(const victim of victims){
      if(attempts >= MAX_ATTEMPTS)break;
      const vc = byIndex.get(victim.fill.i);
      if(!vc)continue;
      for(const other of dayStates){
        if(attempts >= MAX_ATTEMPTS)break;
        if(other === short.state)continue;
        if(vc.eligible && !vc.eligible.has(other.dayBase))continue;
        if(vc.pinned && !other.isTodayDay)continue;
        if(other.placed.has(vc.i))continue;
        attempts += 1;

        const beforeMinutes = weekPlacedMinutes(dayStates);
        const beforeTravel = weekTravelSecondsFromStates(dayStates);
        const beforeDeficit = short.r.deficit;

        const keepFills = short.state.fills
          .filter(f=>f !== victim)
          .map(f=>({...f.fill}));
        // Collapse breakable chunks for the same habit into one fill seed so
        // placeBreakableSessions can re-split cleanly.
        const collapsed = [];
        const seenBreak = new Set();
        for(const f of keepFills){
          if(f.h && f.h.breakable){
            if(seenBreak.has(f.i))continue;
            seenBreak.add(f.i);
            collapsed.push({h:f.h,i:f.i,priority:f.priority,scarcity:f.scarcity});
          }else{
            collapsed.push({h:f.h,i:f.i,priority:f.priority,scarcity:f.scarcity,locationId:f.locationId});
          }
        }

        const sourceClean = rebuildDayFromFills(short.state,collapsed,candidates,{settings,allowNetwork:true});
        if(!sourceClean)continue;

        // Ensure the short breakable is represented so it can reclaim gaps.
        if(!collapsed.some(f=>f.i === short.c.i)){
          const bf = {h:short.c.h,i:short.c.i,priority:short.c.priority,scarcity:short.c.scarcity};
          placeBreakableSessions(sourceClean,bf,{
            settings,allowNetwork:true,
            weights:typeof resolveAgendaScoreWeights === 'function'
              ? resolveAgendaScoreWeights(settings) : null
          });
          syncDayAgendaItemsFromFills(sourceClean);
        }else{
          // Already re-placed via rebuild; try to fill any remaining deficit.
          const left = breakableMinutesLeft(short.c.h,short.c.i,sourceClean);
          if(left > 0){
            placeBreakableSessions(sourceClean,{
              h:short.c.h,i:short.c.i,priority:short.c.priority,scarcity:short.c.scarcity
            },{settings,allowNetwork:true});
            syncDayAgendaItemsFromFills(sourceClean);
          }
        }

        const targetClean = clonePlacementState(other);
        const movableFill = {h:vc.h,i:vc.i,priority:vc.priority,scarcity:vc.scarcity};
        const movedFit = tryPlaceOnDay(targetClean,movableFill,{
          settings,allowNetwork:true,
          weights:typeof resolveAgendaScoreWeights === 'function'
            ? resolveAgendaScoreWeights(settings) : null
        });
        if(!movedFit)continue;
        commitPlacement(targetClean,movableFill,movedFit);
        targetClean.day = other.day;
        syncDayAgendaItemsFromFills(targetClean);

        // Score hypothetical week with source/target replaced.
        const hypo = dayStates.map(st=>{
          if(st === short.state)return sourceClean;
          if(st === other)return targetClean;
          return st;
        });
        const afterMinutes = weekPlacedMinutes(hypo);
        const afterTravel = weekTravelSecondsFromStates(hypo);
        const afterRes = dailyBreakableReservations(sourceClean,candidates)
          .find(r=>r.i === short.c.i);
        const afterDeficit = afterRes ? afterRes.deficit : 0;

        // Hours-first: reject any move that lowers week placed minutes.
        if(afterMinutes < beforeMinutes)continue;
        // Prefer moves that reduce this day's Work deficit.
        if(afterDeficit > beforeDeficit && afterMinutes === beforeMinutes)continue;
        if(afterMinutes === beforeMinutes && afterDeficit === beforeDeficit
          && afterTravel > beforeTravel)continue;

        applyPlacementState(short.state,sourceClean);
        applyPlacementState(other,targetClean);
        moves += 1;
        improved = true;
        break;
      }
      if(improved)break;
    }
    if(!improved)break;
  }
  return moves;
}

// PURE: after greedy scarcity placement, try to free a scarce unplaced item by
// temporarily removing one flexible fill and re-fitting both. Bounded attempts.
function rebalanceScarcePlacements(candidates,dayStates,_settings,_locHints){
  const MAX_ATTEMPTS = 8;
  let gained = 0;
  let attempts = 0;
  const scarce = candidates.filter(c=>isScarceScore(c.scarcity));
  for(const c of scarce){
    if(attempts >= MAX_ATTEMPTS)break;
    for(const state of dayStates){
      if(attempts >= MAX_ATTEMPTS)break;
      if(c.eligible && !c.eligible.has(state.dayBase))continue;
      if(state.placed.has(c.i))continue;
      const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
      const earlyFit = tryPlaceOnDay(state,fill);
      if(earlyFit){
        commitPlacement(state,fill,earlyFit);
        state.day.agendaItems.push({h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity,locationId:earlyFit.locId});
        gained += 1;
        continue;
      }
      const flexibleFills = state.fills.filter(f=>f.fill && !isScarceScore(f.fill.scarcity)
        && !(typeof hasTimeWindow === 'function' && hasTimeWindow(f.fill.h))
        && !(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(f.fill.h)));
      for(const victim of flexibleFills){
        if(attempts >= MAX_ATTEMPTS)break;
        attempts += 1;
        const others = state.fills.filter(f=>f !== victim).map(f=>f.fill);
        const clean = clonePlacementState(state);
        clean.rows = state.rows.filter(r=>r.kind === 'scheduled');
        clean.fills = [];
        clean.placed = new Set();
        // Restore remaining from scheduled-only baseline.
        let used = 0;
        for(const r of clean.rows){
          if(r.kind === 'scheduled')used += Math.max(0,(r.end - r.start) / 60000);
        }
        clean.usedMinutes = 0;
        clean.remaining = Math.max(0,(Number(state.totalMinutes) || 0));
        clean.prevLocId = state.seedLocId;
        let ok = true;
        const scoreOpts = {
          settings:state.settings,
          weights:resolveAgendaScoreWeights(state.settings),
          spareWindows:scarceWindowsToSpare(candidates,clean.dayBase,clean.seedLocId,clean.dayBase)
        };
        for(const other of others){
          const refit = tryPlaceOnDay(clean,other,scoreOpts);
          if(!refit){ ok = false; break; }
          commitPlacement(clean,other,refit);
        }
        if(!ok)continue;
        const scarceFit = tryPlaceOnDay(clean,fill,scoreOpts);
        if(!scarceFit)continue;
        commitPlacement(clean,fill,scarceFit);
        const victimFit = tryPlaceOnDay(clean,victim.fill,scoreOpts);
        if(victimFit)commitPlacement(clean,victim.fill,victimFit);
        state.rows = clean.rows;
        state.fills = clean.fills;
        state.placed = clean.placed;
        state.remaining = clean.remaining;
        state.usedMinutes = clean.usedMinutes;
        state.prevLocId = clean.prevLocId;
        state.day.agendaItems = state.fills.map(f=>({
          h:f.fill.h,i:f.fill.i,priority:f.fill.priority,scarcity:f.fill.scarcity,
          locationId:f.fit.locId,
          chunkMinutes:f.fill.chunkMinutes != null ? f.fill.chunkMinutes : null,
          chunkIndex:f.fill.chunkIndex != null ? f.fill.chunkIndex : null
        }));
        gained += 1;
        break;
      }
    }
  }
  return gained;
}

// PURE: co-location hint bonus for placing at locId on this day. Rewards joining
// a day where a prior pass placed a NEARBY place (a different candidate), by the
// commute that would be saved. Ignores the candidate's own prior placement so it
// can move toward a partner rather than just staying put. Returns 0 when there
// is no day origin to measure a commute against.
function colocateHintBonus(state,locId,ownIdx,locHints,registry,mode){
  if(!locId || !locHints)return 0;
  const arr = locHints.get(state.dayBase);
  if(!arr || !arr.length)return 0;
  const origin = state.seedLocId;
  if(!origin)return 0;
  const homeCommute = travelEdgeBetweenIds(origin,locId,registry,mode).seconds;
  if(homeCommute <= 0)return 0;
  let best = 0;
  for(const ent of arr){
    if(ent.idx === ownIdx)continue;               // ignore our own prior placement
    if(ent.locId === locId){ best = Math.max(best, homeCommute); continue; }
    const inter = travelEdgeBetweenIds(ent.locId,locId,registry,mode).seconds;
    // Co-located only when the partner is much closer than the day's origin.
    if(inter < homeCommute * 0.5)best = Math.max(best, homeCommute - inter);
  }
  return best;
}

// PURE: capture, per day, the locations a placement pass committed (with the
// candidate data-index so a candidate can ignore its own prior spot). Feeds the
// co-location hint used by the second pass.
function collectLocationHints(dayStates){
  const map = new Map();
  for(const state of dayStates){
    for(const f of state.fills){
      if(!f.fit.locId)continue;
      let arr = map.get(state.dayBase);
      if(!arr){ arr = []; map.set(state.dayBase, arr); }
      arr.push({ locId:f.fit.locId, idx:f.fill.i });
    }
  }
  return map;
}

// PURE: build a 7-day agenda via placement-backed assignment. Every timed row
// on a day satisfied hard constraints at commit time.
//
// Two passes: (1) a greedy placement to discover where each location tends to
// land, then (2) a fresh placement biased toward days that sent a co-located
// partner. The second pass is what makes two far-from-home but close-together
// errands share one trip even when one errand is day-pinned and the flexible
// one is processed first — a single greedy pass cannot see a partner that has
// not been placed yet. Pass 2 reuses the same eligibility/priority/feasibility
// gates, only the day-preference score changes, so nothing gets placed that
// wouldn't have been placeable before.
function buildWeekAgenda(data,settings,numDays = 7,opts = {}){
  const todayBase = dayStart(Date.now());
  const count = Math.max(1,Math.min(14,Math.round(numDays) || 7));
  const days = [];
  for(let offset = 0;offset < count;offset += 1){
    const dayBase = todayBase + offset * 86400000;
    days.push(buildDayAgenda(data,settings,dayBase,{weekMode:true}));
  }
  const makeStates = () => days.map(day=>createDayPlacementState(day,settings,{
    dayBase:day.dayBase,
    weekday:day.weekday,
    weekMode:true
  }));

  const candidates = [];
  const seen = new Set();
  for(let i = 0;i < data.length;i += 1){
    if(seen.has(i))continue;
    const h = data[i];
    if(h.type === 'task' && h.eventTime !== null)continue; // timed → scheduled rows
    const pinned = isWeekPinnedToday(h,settings);
    const eligible = new Set();
    for(const day of days){
      if(pinned && !day.isToday)continue;
      if(isWeekCandidate(h,settings,day.dayBase,day.weekday) || (pinned && day.isToday)){
        eligible.add(day.dayBase);
      }
    }
    const hasSameDayLinks = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(h).length > 0
      : normalizeScheduleLinks(h.scheduleLinks,h.hid).some(l=>l && l.requireSameDay);
    // Keep same-day-linked habits even with an empty set so pull can add
    // flex-allowed anchor days in applyPersistentLinkEligibility.
    if(!eligible.size && !hasSameDayLinks)continue;
    seen.add(i);
    candidates.push({
      h, i,
      pinned,
      priority:effectivePriority(h),
      score:attentionScore(h,i,settings),
      urgency:pinned ? Math.max(200,weekUrgency(h)) : weekUrgency(h),
      eligible
    });
  }
  applyPersistentLinkEligibility(candidates,days,settings);
  for(let i = candidates.length - 1;i >= 0;i -= 1){
    if(!candidates[i].eligible || !candidates[i].eligible.size)candidates.splice(i,1);
  }

  if(typeof beginPlannerSolveCaches === 'function')beginPlannerSolveCaches(data);
  if(typeof plannerPerfResetTryPlace === 'function')plannerPerfResetTryPlace();

  // Pass 1 — greedy discovery of each location's natural day.
  let dayStates = makeStates();
  assignWeekCandidatesByPlacement(candidates,dayStates,settings,null);
  const locHints = collectLocationHints(dayStates);

  // Pass 2 — re-place from clean states, pulled toward co-located partners.
  // Skip when ≤1 distinct location (no clustering to discover).
  const distinctLocs = new Set();
  for(const c of candidates){
    for(const id of (c.h && c.h.locationIds) || []){
      if(id)distinctLocs.add(id);
    }
  }
  if(distinctLocs.size > 1){
    days.forEach(d=>{ d.agendaItems = []; });
    dayStates = makeStates();
    assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints);
  }

  let totalTravelSeconds = 0;
  for(let d = 0;d < days.length;d += 1){
    const state = dayStates[d];
    const day = days[d];
    day.timeline = finalizePlacementRows(state);
    if(opts.diagnostics){
      day.placementDiagnostics = buildPlacementDiagnostics(
        candidates.filter(candidate=>candidate.eligible.has(day.dayBase)),
        state
      );
    }
    day.usedMinutes = state.usedMinutes;
    day.remainingMinutes = Math.max(0,(Number(day.totalMinutes) || 0) - state.usedMinutes);
    day.travelSeconds = day.timeline.filter(r=>r.kind === 'travel').reduce((s,r)=>s + (r.seconds || 0),0);
    totalTravelSeconds += day.travelSeconds;
  }
  if(typeof endPlannerSolveCaches === 'function')endPlannerSolveCaches();
  return { days, totalTravelSeconds, candidateCount:candidates.length };
}

// PURE: format a timestamp as a short clock label
function agendaTimeLabel(ts){
  return new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

// RENDER: the separate #home-week-plan block is retired — week planning now
// lives inside the main home list as day sections (today / tomorrow / …).
// Keep this as a no-op clearer so older callers and empty-state paths stay safe.
function renderWeekOnHome(){
  const wrap = $('home-week-plan');
  if(!wrap)return;
  wrap.innerHTML = '';
  wrap.hidden = true;
}
