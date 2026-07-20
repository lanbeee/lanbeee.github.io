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
// When today's capacity is tight, fill items compete for the remaining minutes
// in PRIORITY ORDER (P0 first, then P1, ...). Within the same priority band the
// original home rank order is preserved. So the items that lose their slot when
// the day overflows are always the lowest-priority ones — never an arbitrary
// cut. Home ordering itself is unchanged; priority only arbitrates capacity.
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
  // Gather every eligible fill candidate in home rank order, then stable-sort
  // by priority so location-aware placement processes high priority first.
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
  candidates.sort((a,b)=>a.priority - b.priority || a.rank - b.rank);
  // Capacity (including travel) is charged during location-aware placement in
  // buildTodayTimeline — duration-only pre-cuts would under-count travel.
  const agendaItems = candidates.map(({h,i,priority})=>({h,i,priority}));
  return { scheduled, agendaItems, totalMinutes:totalCap, usedMinutes:0, remainingMinutes:totalCap, slots };
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
  return settings.showDueHabitsInAgenda !== false && days !== null && days >= target && scheduleDistance === 0 && windowStillDoableToday(h);
}

// PURE: resolve a fill item's allowed time window for the current day, or null
// when the item has no restriction. Overnight windows (end <= start) extend
// into the next day so a 23:00-02:00 window still works as a single span.
//
// Prayer anchors: when start or end is tied to an anchor, the resolved minute
// is read via resolveHabitTimeField (which uses the habit's own resolved
// location, not a passed-in one). A window with one anchor endpoint and one
// fixed endpoint works fine — only the resolved side is dynamic.
function fillTimeWindow(h,dayBase){
  if(!hasTimeWindow(h))return null;
  const startMin = resolveHabitTimeField(h,'allowedTimeStart',dayBase);
  const endMin = resolveHabitTimeField(h,'allowedTimeEnd',dayBase);
  if(startMin == null || endMin == null)return null;
  const start = dayBase + startMin * 60000;
  let end = dayBase + endMin * 60000;
  if(end <= start)end += 24 * 3600000;
  return {start,end};
}

// PURE: the soft preferred-time anchor for a fill item today, or null.
// preferredTimeStart/End is a HINT, not a constraint: the timeline nudges a
// fill toward this time when it fits, and otherwise falls back to the clock.
// Only the strict allowedTimeStart/End can drop/close an item. We anchor on
// preferredTimeStart (the "do it around this time" cue); end is not needed
// for a soft nudge.
function fillPreferredStart(h,dayBase){
  const s = resolveHabitTimeField(h,'preferredTimeStart',dayBase);
  if(s == null)return null;
  return dayBase + s * 60000;
}

// PURE: is there still enough unexpired room today to fit a full session,
// considering the habit's own window ∩ each allowed location's hours? Habits
// with no time window and no location hours are always doable. preferred*
// hints are intentionally NOT consulted — only strict allowed windows can
// close a day. Keeps the home list ("today" vs "overdue") in sync with the
// location-aware agenda.
function windowStillDoableToday(h,now = Date.now()){
  const cost = clampDuration(h.durationMinutes) * 60000;
  const dayBase = dayStart(now);
  const weekday = new Date(now).getDay();
  const registry = normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
  const locIds = normalizeLocationIds(h.locationIds,registry);
  if(!locIds.length){
    if(!hasTimeWindow(h))return true;
    const win = fillTimeWindow(h,dayBase);
    if(!win)return true;
    return win.end - Math.max(now,win.start) >= cost;
  }
  return locIds.some(id=>{
    const loc = registry.find(l=>l.id === id);
    const intervals = effectiveLocationWindow(h,loc,weekday);
    if(!intervals.length)return false;
    return intervals.some(iv=>{
      const start = dayBase + iv.start * 60000;
      const end = dayBase + iv.end * 60000;
      return end - Math.max(now,start) >= cost;
    });
  });
}

// PURE: travel edge between two location ids (or zero when either is null/same).
function travelEdgeBetweenIds(fromId,toId,registry,mode){
  if(!fromId || !toId || fromId === toId)return {seconds:0,metres:0,provider:'none'};
  const a = registry.find(l=>l.id === fromId);
  const b = registry.find(l=>l.id === toId);
  if(!a || !b || typeof travelBetween !== 'function')return {seconds:0,metres:0,provider:'haversine'};
  return travelBetween(a,b,mode);
}

// PURE: choose a location id for a habit given the current anchor. Anywhere
// items return null (no travel, anchor unchanged). When several are allowed,
// prefer high/little preference, avoid last, then cheapest travel from anchor.
function pickHabitLocationId(h,anchorId,registry,mode){
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return null;
  if(ids.length === 1)return ids[0];
  let best = ids[0];
  let bestScore = Infinity;
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
function reorderAgendaItemsByLocation(items,settings,now = Date.now()){
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  let anchor = (typeof currentLocationId === 'function' && currentLocationId())
    || settings.lastKnownLocationId
    || null;
  const bands = [];
  for(const item of items){
    const p = item.priority ?? effectivePriority(item.h);
    let band = bands.find(b=>b.priority === p);
    if(!band){ band = {priority:p,items:[]}; bands.push(band); }
    band.items.push(item);
  }
  bands.sort((a,b)=>a.priority - b.priority);
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
  const ordered = reorderAgendaItemsByLocation(agenda.agendaItems || [],settings,now);
  for(const fill of ordered){
    if(fill.h && fill.h.breakable){
      const chunks = remainingChunks(fill.h);
      let placedAny = false;
      for(let c = 0; c < chunks.length; c += 1){
        const chunkFill = {...fill, chunkMinutes:chunks[c], chunkIndex:c, placeKey:`${fill.i}:${c}`};
        const fit = tryPlaceOnDay(state,chunkFill);
        if(!fit)break;
        commitPlacement(state,chunkFill,fit);
        placedAny = true;
      }
      if(placedAny)state.placed.add(fill.i);
      continue;
    }
    const fit = tryPlaceOnDay(state,fill);
    if(fit)commitPlacement(state,fill,fit);
  }
  // Classic today path: location-less, window-less leftovers may overflow past
  // the last open slot so the single-day agenda still surfaces a suggestion.
  if(!opts.weekMode){
    for(const fill of ordered){
      if(state.placed.has(fill.i))continue;
      if(fill.locationId)continue;
      if(fillTimeWindow(fill.h,state.dayBase))continue;
      const durMin = fill.h && fill.h.breakable
        ? (remainingChunks(fill.h)[0] || 0)
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
        placeKey:fill.i
      };
      commitPlacement(state,fill,fit);
    }
  }
  agenda.usedMinutes = state.usedMinutes;
  agenda.remainingMinutes = Math.max(0,(Number(agenda.totalMinutes) || 0) - state.usedMinutes);
  agenda.agendaItems = (agenda.agendaItems || []).filter(item=>state.placed.has(item.i));
  return finalizePlacementRows(state);
}

// PURE: today's timeline — thin wrapper over buildDayTimeline so the existing
// single-day callers are unchanged. Derives the day context from `now`.
function buildTodayTimeline(agenda,now = Date.now()){
  return buildDayTimeline(agenda,{ now });
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
      : dayBase + dayFirstOpenMinute(blocks,weekday) * 60000);
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
    : (blockLocationAtMinute(blocks,Math.floor((startClock - dayBase) / 60000),weekday)
      || blockLocationAtMinute(blocks,Math.max(0,dayFirstOpenMinute(blocks,weekday) - 1),weekday)
      || null);
  return {
    day,
    dayBase,
    weekday,
    isTodayDay,
    settings,
    registry,
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
    prevLocId:state.prevLocId
  };
}

// PURE: attempt to place a fill into this day's open slots under hard
// constraints — availability budget, blocked/scheduled slots, travel time,
// location hours ∩ habit allowed window, and preferred-time nudge (soft).
function tryPlaceOnDay(state,fill){
  if(!state || !fill || !fill.h)return null;
  const placeKey = fill.placeKey != null ? fill.placeKey : fill.i;
  if(state.placed.has(placeKey))return null;
  const {dayBase,weekday,registry,mode,slots,startClock} = state;
  const remaining = state.remaining;
  const usedMinutes = state.usedMinutes;
  const resolveLoc = (anchor)=>fill.locationId || pickHabitLocationId(fill.h,anchor,registry,mode);

  for(const slot of slots){
    let clock = Math.max(slot.start,startClock);
    const inSlot = state.fills
      .filter(c=>c.fit.placeStart >= slot.start && c.fit.placeStart < slot.end)
      .sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
    for(const c of inSlot)clock = Math.max(clock,c.fit.placeEnd);

    // Travel anchor = last committed session that ends at/before this clock,
    // else the day's seed location (presence / morning block).
    let anchor = state.seedLocId;
    const chron = state.fills.slice().sort((a,b)=>a.fit.placeStart - b.fit.placeStart);
    for(const c of chron){
      if(c.fit.placeEnd <= clock && c.fit.locId)anchor = c.fit.locId;
    }

    const locId = resolveLoc(anchor);
    if(locId){
      const loc = registry.find(l=>l.id === locId);
      const intervals = effectiveLocationWindow(fill.h,loc,weekday);
      if(!intervals.length)continue;
    }
    const edge = travelEdgeBetweenIds(anchor,locId,registry,mode);
    const travelMin = Math.ceil((edge.seconds || 0) / 60);
    const durMin = fill.chunkMinutes != null
      ? Math.max(1,Math.round(fill.chunkMinutes))
      : (fill.h.breakable
        ? (remainingChunks(fill.h)[0] || clampDuration(fill.h.durationMinutes))
        : clampDuration(fill.h.durationMinutes));
    if(durMin <= 0)return null;
    // Hard availability budget. The first fill of a day may still place when
    // travel+duration exceeds the remaining budget (same rule as the classic
    // timeline) — otherwise a long commute can never open a day. Later fills
    // must fit the leftover minutes.
    if(durMin + travelMin > remaining && usedMinutes > 0)continue;

    let placeStart = clock + (edge.seconds || 0) * 1000;
    let cap = slot.end;
    let preferredHit = false;
    if(locId){
      const loc = registry.find(l=>l.id === locId);
      const intervals = effectiveLocationWindow(fill.h,loc,weekday);
      const arriveMin = Math.floor((placeStart - dayBase) / 60000);
      let iv = intervals.find(x=>arriveMin >= x.start && arriveMin < x.end);
      if(!iv){
        iv = intervals.find(x=>x.start >= arriveMin) || intervals.find(x=>x.end > arriveMin);
        if(!iv)continue;
        placeStart = Math.max(placeStart, dayBase + iv.start * 60000);
      }
      cap = Math.min(cap, dayBase + iv.end * 60000);
    }else{
      const win = fillTimeWindow(fill.h,dayBase);
      if(win){
        placeStart = Math.max(placeStart,win.start);
        cap = Math.min(cap,win.end);
      }
    }
    // Placement must stay inside this open slot (blocks/scheduled already carved).
    placeStart = Math.max(placeStart,clock);
    if(placeStart >= slot.end)continue;
    const cost = durMin * 60000;
    let placeEnd = placeStart + cost;
    const loc = locId ? registry.find(l=>l.id === locId) : null;
    const locPref = loc && Number.isFinite(loc.preferredTimeStart) ? dayBase + loc.preferredTimeStart * 60000 : null;
    const habitPref = fillPreferredStart(fill.h,dayBase);
    const prefTs = locPref || habitPref;
    if(prefTs !== null && prefTs >= placeStart && prefTs + cost <= cap && prefTs + cost <= slot.end){
      placeStart = prefTs;
      placeEnd = prefTs + cost;
      preferredHit = true;
    }
    if(placeEnd > cap || placeEnd > slot.end)continue;
    if(placeStart < slot.start || placeStart >= slot.end)continue;
    return {
      placeStart,
      placeEnd,
      locId,
      edge,
      travelMin,
      durMin,
      slotStart:slot.start,
      preferredHit,
      prevLocId:anchor,
      placeKey
    };
  }
  return null;
}

// PURE: commit a successful fit into day state (travel row + fill row + budgets).
function commitPlacement(state,fill,fit){
  if(!fit)return;
  const {registry,mode} = state;
  if(fit.edge && fit.edge.seconds > 0 && fit.prevLocId && fit.locId && fit.prevLocId !== fit.locId){
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
      start:Math.max(fit.placeStart - fit.edge.seconds * 1000, state.dayBase),
      end:fit.placeStart,
      provider:fit.edge.provider || mode
    });
  }
  state.rows.push({
    kind:'fill', h:fill.h, i:fill.i, start:fit.placeStart, end:fit.placeEnd, hard:false,
    locationId:fit.locId,
    chunkMinutes:fit.durMin,
    chunkIndex:fill.chunkIndex != null ? fill.chunkIndex : null
  });
  state.fills.push({ fill, fit, slotStart:fit.slotStart });
  state.remaining = Math.max(0,state.remaining - fit.travelMin - fit.durMin);
  state.usedMinutes += fit.travelMin + fit.durMin;
  if(fit.locId)state.prevLocId = fit.locId;
  state.placed.add(fit.placeKey != null ? fit.placeKey : fill.i);
}

function finalizePlacementRows(state){
  return state.rows.slice().sort((a,b)=>a.start - b.start || (a.kind === 'scheduled' ? -1 : a.kind === 'travel' ? -0.5 : 1));
}

// PURE: the location the user is already commited to at a given minute within
// a day, derived from location-tied blocked times (sleep→Home, work→Office).
// Returns the locationId or null. Lets the week agenda start each day anchored
// to a known place ("you wake at Home") instead of an unknown starting point.
function blockLocationAtMinute(blocks,minute,weekday){
  if(!Array.isArray(blocks))return null;
  for(const block of blocks){
    if(block.days.length && !block.days.includes(weekday))continue;
    if(!block.locationId)continue;
    const rawS = resolveBlockedTimeMinutes(block,'start') ?? block.start;
    const rawE = resolveBlockedTimeMinutes(block,'end') ?? block.end;
    const {startMin:s, endMin:e} = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawS, rawE) : {startMin:rawS, endMin:rawE};
    const inSimple = e > s && minute >= s && minute < e;
    const inOvernight = e <= s && (minute >= s || minute < e);
    if(inSimple || inOvernight)return block.locationId;
  }
  return null;
}

// PURE: the first open minute of a day (after the last early block ends), used
// as the startClock for future-day timelines so the agenda begins placing at
// the day's first genuinely-free minute rather than midnight.
function dayFirstOpenMinute(blocks,weekday){
  if(!Array.isArray(blocks) || !blocks.length)return 0;
  // Collect end-minutes of blocks that start at/before midnight-ish (early).
  // The day's first open minute is after the latest-ending pre-dawn block.
  let latestEarlyEnd = 0;
  for(const block of blocks){
    if(block.days.length && !block.days.includes(weekday))continue;
    const rawS = resolveBlockedTimeMinutes(block,'start') ?? block.start;
    const rawE = resolveBlockedTimeMinutes(block,'end') ?? block.end;
    const {startMin:s, endMin:e} = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawS, rawE) : {startMin:rawS, endMin:rawE};
    // Overnight block wrapping past midnight counts its morning tail.
    if(e <= s){ // overnight — its tail ends at `e` in the morning
      if(e > latestEarlyEnd)latestEarlyEnd = e;
    }else if(s < 720 && e <= 720){ // same-day block entirely in the AM half
      if(e > latestEarlyEnd)latestEarlyEnd = e;
    }
  }
  return latestEarlyEnd;
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
  return normalizeBlockedTimes(settings.blockedTimes).flatMap(block=>{
    if(block.days.length && !block.days.includes(day))return [];
    // Resolve dynamic start/end (prayer anchors only on blocked times).
    // Fold dayBase-relative values (negative / >1440 from offsets or +1d)
    // into overnight clock form so a sunrise−8h → sunrise block becomes
    // evening→midnight + midnight→sunrise on every day it applies.
    const rawStart = resolveBlockedTimeMinutes(block,'start',dayBase) ?? block.start;
    const rawEnd = resolveBlockedTimeMinutes(block,'end',dayBase) ?? block.end;
    const folded = typeof foldBlockedMinutes === 'function'
      ? foldBlockedMinutes(rawStart, rawEnd) : {startMin:rawStart, endMin:rawEnd};
    const startMin = folded.startMin;
    const endMin = folded.endMin;
    if(isBlockedCancelled(todayKey,block.label,startMin,endMin,settings))return [];
    const locationId = block.locationId || null;
    const blockStart = start + startMin * 60000;
    const blockEnd = start + endMin * 60000;
    if(endMin > startMin)return [{start:blockStart,end:blockEnd,label:block.label,locationId,startMin,endMin,blockStartMin:startMin,blockEndMin:endMin}];
    return [
      {start,end:blockEnd,label:block.label,locationId,startMin:0,endMin:endMin,blockStartMin:startMin,blockEndMin:endMin},
      {start:blockStart,end,label:block.label,locationId,startMin,endMin:1440,blockStartMin:startMin,blockEndMin:endMin}
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
      blockEndMin:b.blockEndMin
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
  const weekday = day?.weekday ?? new Date(day?.dayBase || Date.now()).getDay();
  const blocks = normalizeBlockedTimes(settings.blockedTimes);
  const openMin = dayFirstOpenMinute(blocks,weekday);
  return blockLocationAtMinute(blocks,Math.max(0,openMin - 1),weekday)
    || blockLocationAtMinute(blocks,openMin,weekday)
    || null;
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
        start:Math.max(row.start - (edge.seconds || 0) * 1000, day.dayBase),
        end:row.start,
        provider:edge.provider || mode
      });
    }
    out.push(row);
    if(locId)prevLocId = locId;
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
  const clipAfter = isToday ? ceilToMinutes(Date.now(),5) : dayBase + dayFirstOpenMinute(normalizeBlockedTimes(settings.blockedTimes),weekday) * 60000;
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
    candidates.sort((a,b)=>a.priority - b.priority || a.rank - b.rank);
    agendaItems.push(...candidates.map(({h,i,priority})=>({h,i,priority})));
  }
  return { scheduled, agendaItems, totalMinutes:totalCap, usedMinutes:0, remainingMinutes:totalCap, slots, dayKey, weekday, dayBase, isToday };
}

// PURE: items that must try today first in week mode — planned-for-today, and
// hard-deadline tasks that are already due. Soft work can slide freely.
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
  if(days === null || days < 0)return false;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  const ageOnDay = days + offsetDays;
  if(ageOnDay >= target)return true;               // due/overdue by this day
  // Pull forward within flexibility so the week can absorb upcoming work.
  const flex = typeof clampFlexibility === 'function' ? clampFlexibility(h.flexibilityDays) : 0;
  if(flex > 0 && ageOnDay >= target - flex)return true;
  return false;
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
    const habitPref = fillPreferredStart(h,day.dayBase);
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
function assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints){
  const todayBase = dayStates[0] ? dayStates[0].dayBase : dayStart(Date.now());
  const registry = dayStates[0] ? dayStates[0].registry : normalizeLocationRegistry(settings.locations);
  const mode = dayStates[0] ? dayStates[0].mode : normalizeTravelMode(settings.defaultTravelMode);
  candidates.sort((a,b)=>a.priority - b.priority || b.urgency - a.urgency || b.score - a.score);
  let totalAssigned = 0;
  for(const c of candidates){
    const pinned = c.pinned === true;
    const chunkSizes = (c.h && c.h.breakable) ? remainingChunks(c.h) : [null];
    for(let ci = 0;ci < chunkSizes.length;ci += 1){
      let best = null;
      for(const state of dayStates){
        if(c.eligible && !c.eligible.has(state.dayBase))continue;
        if(pinned && !state.isTodayDay)continue; // hard pins: today only
        const fill = { h:c.h, i:c.i, priority:c.priority };
        const cm = chunkSizes[ci];
        if(cm != null){ fill.chunkMinutes = cm; fill.chunkIndex = ci; fill.placeKey = `${c.i}:${ci}`; }
        const fit = tryPlaceOnDay(state,fill);
        if(!fit)continue;
        const offset = Math.round((state.dayBase - todayBase) / 86400000);
        const travel = fit.edge.seconds || 0;
        // Smooth cluster bonus: strongest at zero travel (already on-site) and
        // tapering so a short hop between near-each-other places still earns a
        // nudge — not just an exact same-location match.
        const clusterBonus = travel <= 0 ? 600 : Math.max(0, 600 - travel * 2);
        const coLocHint = colocateHintBonus(state,fit.locId,c.i,locHints,registry,mode);
        const score = travel
          - clusterBonus
          - coLocHint
          + flexAwareDayPenalty(c.h,offset,c.urgency,pinned)
          + weekPreferencePenalty(c.h,fit,state,registry);
        if(!best || score < best.score)best = { state, fill, fit, score };
      }
      if(!best)break; // this chunk can't be placed → stop placing the rest
      commitPlacement(best.state,best.fill,best.fit);
      best.state.day.agendaItems.push({
        h:c.h, i:c.i, priority:c.priority, locationId:best.fit.locId,
        chunkMinutes:best.fill.chunkMinutes != null ? best.fill.chunkMinutes : null,
        chunkIndex:best.fill.chunkIndex != null ? best.fill.chunkIndex : null
      });
      totalAssigned += 1;
    }
  }
  return totalAssigned;
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
function buildWeekAgenda(data,settings,numDays = 7){
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
    if(!eligible.size)continue;
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

  // Pass 1 — greedy discovery of each location's natural day.
  let dayStates = makeStates();
  assignWeekCandidatesByPlacement(candidates,dayStates,settings,null);
  const locHints = collectLocationHints(dayStates);

  // Pass 2 — re-place from clean states, pulled toward co-located partners.
  days.forEach(d=>{ d.agendaItems = []; });
  dayStates = makeStates();
  assignWeekCandidatesByPlacement(candidates,dayStates,settings,locHints);

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


