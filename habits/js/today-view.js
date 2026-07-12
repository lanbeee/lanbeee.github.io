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
    .filter(({h})=>settings.showScheduledTasksInAgenda !== false && h.type === 'task' && h.eventTime !== null && h.lastLog === null && dateKey(h.eventTime) === todayKey)
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
    if(h.type === 'task' && h.lastLog !== null)continue;
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
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  const scheduleDistance = hasDaySchedule(h) ? nextEligibleDistance(h) : 0;
  return settings.showDueHabitsInAgenda !== false && days !== null && days >= target && scheduleDistance === 0 && windowStillDoableToday(h);
}

// PURE: resolve a fill item's allowed time window for the current day, or null
// when the item has no restriction. Overnight windows (end <= start) extend
// into the next day so a 23:00-02:00 window still works as a single span.
function fillTimeWindow(h,dayBase){
  if(!hasTimeWindow(h))return null;
  const start = dayBase + h.allowedTimeStart * 60000;
  let end = dayBase + h.allowedTimeEnd * 60000;
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
  const s = h.preferredTimeStart;
  if(!Number.isFinite(s))return null;
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
// prefer preferredLocationId, then cheapest travel from the anchor.
function pickHabitLocationId(h,anchorId,registry,mode){
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return null;
  const pref = normalizePreferredLocation(h.preferredLocationId,ids);
  if(pref && (!anchorId || pref === anchorId))return pref;
  let best = pref || ids[0];
  let bestSec = Infinity;
  for(const id of ids){
    const edge = travelEdgeBetweenIds(anchorId,id,registry,mode);
    const preferredBoost = pref === id ? -1 : 0;
    const score = edge.seconds + preferredBoost;
    if(score < bestSec){ bestSec = score; best = id; }
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
// into a time-ordered row list. Fill items are first reordered within priority
// bands to reduce travel (revisits allowed). Travel advances the clock and
// consumes availability; wait gaps for closed locations are display-only.
//
// Generalised for any day via opts: {dayBase, weekday, startClock, now}. Today
// passes only `now` and the day context is derived from it; future days pass
// an explicit dayBase/weekday/startClock so a 7-day agenda can build each day's
// timeline from that day's first open minute rather than wall-clock "now".
function buildDayTimeline(agenda,opts = {}){
  const now = opts.now != null ? opts.now : Date.now();
  const settings = sortSettings || loadSortSettings();
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  const dayBase = opts.dayBase != null ? opts.dayBase : dayStart(now);
  const weekday = opts.weekday != null ? opts.weekday : new Date(now).getDay();
  const startClock = opts.startClock != null ? opts.startClock : ceilToMinutes(now,5);
  const slots = agenda.slots?.length ? agenda.slots : [{start:startClock,end:dayBase + 24 * 3600000}];
  const rows = [];

  agenda.scheduled.forEach(ev=>{
    const end = ev.h.eventTime + clampDuration(ev.h.durationMinutes) * 60000;
    const locIds = normalizeLocationIds(ev.h.locationIds,registry);
    const locationId = normalizePreferredLocation(ev.h.preferredLocationId,locIds) || locIds[0] || null;
    rows.push({ kind:'scheduled', h:ev.h, i:ev.i, start:ev.h.eventTime, end, hard:true, locationId });
  });

  const ordered = reorderAgendaItemsByLocation(agenda.agendaItems,settings,now);
  let remaining = Math.max(0, Number(agenda.totalMinutes) || 0);
  let usedMinutes = 0;
  let prevLocId = (typeof currentLocationId === 'function' && currentLocationId())
    || settings.lastKnownLocationId
    || null;
  const placed = new Array(ordered.length).fill(false);

  const tryPlace = (fill,idx,slot,clock)=>{
    const durMin = clampDuration(fill.h.durationMinutes);
    const cost = durMin * 60000;
    const locId = fill.locationId || pickHabitLocationId(fill.h,prevLocId,registry,mode);
    // Location hours ∩ habit window must contain the session.
    if(locId){
      const loc = registry.find(l=>l.id === locId);
      const intervals = effectiveLocationWindow(fill.h,loc,weekday);
      if(!intervals.length)return null;
    }
    const edge = travelEdgeBetweenIds(prevLocId,locId,registry,mode);
    const travelMin = Math.ceil((edge.seconds || 0) / 60);
    if(durMin + travelMin > remaining && usedMinutes > 0)return null;

    let placeStart = clock + (edge.seconds || 0) * 1000;
    let cap = slot.end;
    if(locId){
      const loc = registry.find(l=>l.id === locId);
      const intervals = effectiveLocationWindow(fill.h,loc,weekday);
      const arriveMin = Math.floor((placeStart - dayBase) / 60000);
      let iv = intervals.find(x=>arriveMin >= x.start && arriveMin < x.end);
      if(!iv){
        iv = intervals.find(x=>x.start >= arriveMin) || intervals.find(x=>x.end > arriveMin);
        if(!iv)return null;
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
    let placeEnd = placeStart + cost;
    const loc = locId ? registry.find(l=>l.id === locId) : null;
    const locPref = loc && Number.isFinite(loc.preferredTimeStart) ? dayBase + loc.preferredTimeStart * 60000 : null;
    const habitPref = fillPreferredStart(fill.h,dayBase);
    const prefTs = locPref || habitPref;
    if(prefTs !== null && prefTs > placeStart && prefTs + cost <= cap){
      placeStart = prefTs;
      placeEnd = prefTs + cost;
    }
    if(placeEnd > cap)return null;
    return {placeStart,placeEnd,locId,edge,travelMin,durMin};
  };

  for(const slot of slots){
    let clock = Math.max(slot.start,startClock);
    for(let idx = 0; idx < ordered.length; idx += 1){
      if(placed[idx])continue;
      const fill = ordered[idx];
      const fit = tryPlace(fill,idx,slot,clock);
      if(!fit)continue;
      if(fit.edge.seconds > 0 && prevLocId && fit.locId && prevLocId !== fit.locId){
        const from = registry.find(l=>l.id === prevLocId);
        const to = registry.find(l=>l.id === fit.locId);
        rows.push({
          kind:'travel',
          from:prevLocId,
          to:fit.locId,
          fromName:from ? from.name : '',
          toName:to ? to.name : '',
          seconds:fit.edge.seconds,
          metres:fit.edge.metres || 0,
          start:Math.max(clock, fit.placeStart - fit.edge.seconds * 1000),
          end:fit.placeStart,
          provider:fit.edge.provider || mode
        });
      }
      rows.push({
        kind:'fill', h:fill.h, i:fill.i, start:fit.placeStart, end:fit.placeEnd, hard:false,
        locationId:fit.locId
      });
      clock = fit.placeEnd;
      remaining -= (fit.travelMin + fit.durMin);
      usedMinutes += fit.travelMin + fit.durMin;
      if(fit.locId)prevLocId = fit.locId;
      placed[idx] = true;
    }
  }

  if(placed.some(p=>!p)){
    let overflowStart = slots.reduce((max,slot)=>Math.max(max,slot.end),Math.max(dayBase,startClock));
    ordered.forEach((fill,idx)=>{
      if(placed[idx])return;
      if(fill.locationId)return;
      if(fillTimeWindow(fill.h,dayBase))return;
      const durMin = clampDuration(fill.h.durationMinutes);
      if(durMin > remaining && usedMinutes > 0)return;
      const cost = durMin * 60000;
      rows.push({ kind:'fill', h:fill.h, i:fill.i, start:overflowStart, end:overflowStart + cost, hard:false, locationId:null });
      overflowStart += cost;
      remaining -= durMin;
      usedMinutes += durMin;
      placed[idx] = true;
    });
  }

  agenda.usedMinutes = usedMinutes;
  agenda.remainingMinutes = Math.max(0,(Number(agenda.totalMinutes) || 0) - usedMinutes);
  return rows.sort((a,b)=>a.start - b.start || (a.kind === 'scheduled' ? -1 : a.kind === 'travel' ? -0.5 : 1));
}

// PURE: today's timeline — thin wrapper over buildDayTimeline so the existing
// single-day callers are unchanged. Derives the day context from `now`.
function buildTodayTimeline(agenda,now = Date.now()){
  return buildDayTimeline(agenda,{ now });
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
    const s = block.start, e = block.end;
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
    const s = block.start, e = block.end;
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
  return normalizeBlockedTimes(settings.blockedTimes).flatMap(block=>{
    if(block.days.length && !block.days.includes(day))return [];
    const blockStart = start + block.start * 60000;
    const blockEnd = start + block.end * 60000;
    if(block.end > block.start)return [{start:blockStart,end:blockEnd,label:block.label}];
    return [
      {start,end:blockEnd,label:block.label},
      {start:blockStart,end,label:block.label}
    ];
  });
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
// 7-DAY AGENDA — location-aware day-by-day plan.
//
// buildDayAgenda generalises buildTodayAgenda to any day. buildWeekAgenda
// stitches 7 days together and runs a travel-minimising day-assignment pass:
// "movable" candidates (habits/tasks eligible within the window but not
// strictly due today) are each placed on the day where they add the least
// travel. Co-located habits cluster onto the same day so it's one trip, not
// many — "two far-from-home but next-to-each-other errands land together."
//
// Location-tied blocked times (sleep→Home, work→Office) seed each day's
// location set, so the cluster bonus already credits the places you'll be in
// anyway. Travel is symmetric (the cached edge A→B === B→A) and uses the same
// stale-while-revalidate travelBetween() the today agenda uses.
// ─────────────────────────────────────────────────────────────────────────

// PURE: a day's scheduled tasks + capacity + open slots. Today also collects
// its due-item candidates via the existing eligibility; future days leave
// agendaItems empty for the week-assignment pass to fill.
function buildDayAgenda(data,settings,dayBase){
  const dayKey = dateKey(dayBase);
  const weekday = new Date(dayBase).getDay();
  const isToday = dayStart(Date.now()) === dayBase;
  const scheduled = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>settings.showScheduledTasksInAgenda !== false && h.type === 'task' && h.eventTime !== null && h.lastLog === null && dateKey(h.eventTime) === dayKey)
    .sort(({h:a},{h:b})=>a.eventTime - b.eventTime);
  const totalMinutes = effectiveAvailabilityMinutes(dayKey,settings);
  const clipAfter = isToday ? ceilToMinutes(Date.now(),5) : dayBase + dayFirstOpenMinute(normalizeBlockedTimes(settings.blockedTimes),weekday) * 60000;
  const slots = buildOpenAgendaSlots(dayKey,scheduled,settings,{clipAfter});
  const slotMinutes = slots.reduce((sum,slot)=>sum + Math.max(0,(slot.end - slot.start) / 60000),0);
  const totalCap = Math.min(totalMinutes,slotMinutes);
  const agendaItems = [];
  if(isToday){
    // Reuse the existing today eligibility so day-0 behaviour is identical to
    // buildTodayAgenda. We replicate the candidate walk rather than delegate so
    // the returned object carries the day metadata the week view needs.
    const candidates = [];
    let homeRank = 0;
    for(const i of visibleIndices(data,settings)){
      const h = data[i];
      if(h.type === 'task' && h.lastLog !== null)continue;
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

// PURE: is a habit/task a viable candidate for assignment to a future day in
// the week window? Excludes items already due-today (the today agenda owns
// those) and respects weekday schedules + due-by-that-day logic.
function isWeekCandidate(h,settings,dayBase,weekday){
  if(h.type === 'zero')return false;
  if(h.type === 'task'){
    if(h.lastLog !== null)return false;
    if(h.eventTime !== null)return false;         // timed → fixed to its day
    if(h.dueDate === null)return false;            // someday → today only
    const left = Math.round((dayStart(h.dueDate) - dayBase) / 86400000);
    if(left < 0 || left > 6)return false;          // outside the 7-day window
    return settings.showDueTasksInAgenda !== false;
  }
  // Habit: schedule must allow this weekday, and it must be due by this day.
  if(hasDaySchedule(h)){
    const schedule = scheduledDays(h);
    if(schedule.weekdays.length && !schedule.weekdays.includes(weekday))return false;
  }
  if(hasPlannedForDay(h,dayBase))return settings.showPlannedItemsInAgenda !== false;
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  if(days === null || days < 0)return false;
  const offsetDays = Math.round((dayBase - dayStart(Date.now())) / 86400000);
  if(days + offsetDays < target)return false;      // not due by this day
  return settings.showDueHabitsInAgenda !== false;
}

// PURE helper: planned-for-day predicate. hasPlannedToday checks today; this
// generalises to any day. Mirrors the actualLogs/plannedLogs intersection.
function hasPlannedForDay(h,dayBase){
  const key = dateKey(dayBase);
  const planned = plannedLogs(h.logs || []);
  if(!planned.length)return false;
  return planned.some(ts=>dateKey(ts) === key);
}

// PURE: the locations already committed on a day before any fill item is
// placed — scheduled-task locations + location-tied block locations. This is
// the seed for the cluster bonus: a habit at a place you'll already be costs
// zero incremental travel.
function daySeedLocationSet(day,settings,registry){
  const set = new Set();
  for(const ev of day.scheduled){
    const ids = normalizeLocationIds(ev.h.locationIds,registry);
    const locId = normalizePreferredLocation(ev.h.preferredLocationId,ids) || ids[0];
    if(locId)set.add(locId);
  }
  for(const block of normalizeBlockedTimes(settings.blockedTimes)){
    if(block.days.length && !block.days.includes(day.weekday))continue;
    if(block.locationId)set.add(block.locationId);
  }
  return set;
}

// PURE: for a habit on a given day, the best (lowest incremental travel)
// allowed location, or {placeable:false} if no allowed location is open that
// weekday. Returns {placeable, locId, incTravel}.
function pickHabitLocationForDay(h,day,locSet,registry,mode){
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return { placeable:true, locId:null, incTravel:0 };  // anywhere
  let best = null;
  for(const id of ids){
    const loc = registry.find(l=>l.id === id);
    const intervals = effectiveLocationWindow(h,loc,day.weekday);
    if(!intervals.length)continue;                  // closed / no overlap today
    let inc;
    if(locSet.has(id))inc = 0;                      // already there → free
    else if(!locSet.size)inc = 0;                   // empty day → first item free
    else inc = Math.min(...[...locSet].map(e=>travelEdgeBetweenIds(e,id,registry,mode).seconds));
    if(!best || inc < best.inc)best = { placeable:true, locId:id, incTravel:inc };
  }
  return best || { placeable:false, locId:null, incTravel:Infinity };
}

// PURE: assign movable week-candidates to days, minimising total travel.
// Greedy by priority then attentionScore: each candidate is placed on the
// feasible day (location open + capacity remaining) whose locSet already
// contains its location (cluster, zero travel) or is cheapest to reach.
// Respects day capacity (duration + travel minutes) and location hours.
function assignWeekCandidates(candidates,days,settings,registry){
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  for(const day of days){
    day._locSet = daySeedLocationSet(day,settings,registry);
    day._remaining = Math.max(0,Number(day.totalMinutes) || 0);
    for(const ev of day.scheduled)day._remaining = Math.max(0,day._remaining - clampDuration(ev.h.durationMinutes));
  }
  candidates.sort((a,b)=>a.priority - b.priority || b.score - a.score);
  let totalAssigned = 0;
  for(const c of candidates){
    let best = null;
    for(const day of days){
      const pick = pickHabitLocationForDay(c.h,day,day._locSet,registry,mode);
      if(!pick.placeable)continue;
      const dur = clampDuration(c.h.durationMinutes);
      const travelMin = Math.ceil(pick.incTravel / 60);
      if(dur + travelMin > day._remaining && day._remaining < day.totalMinutes)continue;
      // Score: prefer clustering (zero), then low travel. Subtract a flat
      // cluster bonus so an existing-location slot beats a near-miss edge.
      const score = pick.incTravel - (pick.incTravel === 0 ? 600 : 0);
      if(!best || score < best.score)best = { day, pick, dur, travelMin, score };
    }
    if(!best)continue;
    const assigned = { h:c.h, i:c.i, priority:c.priority, locationId:best.pick.locId };
    best.day.agendaItems.push(assigned);
    if(best.pick.locId)best.day._locSet.add(best.pick.locId);
    best.day._remaining = Math.max(0,best.day._remaining - best.dur - best.travelMin);
    totalAssigned += 1;
  }
  return totalAssigned;
}

// PURE: build a 7-day agenda. Day 0 is today (existing due-item logic); days
// 1..n-1 receive movable candidates via the travel-minimising assignment. Each
// day carries a built timeline (rows) + a travel summary.
function buildWeekAgenda(data,settings,numDays = 7){
  const todayBase = dayStart(Date.now());
  const count = Math.max(1,Math.min(14,Math.round(numDays) || 7));
  const days = [];
  for(let offset = 0;offset < count;offset += 1){
    const dayBase = todayBase + offset * 86400000;
    days.push(buildDayAgenda(data,settings,dayBase));
  }
  // Collect movable candidates eligible on at least one future day.
  const movable = [];
  const seen = new Set();
  for(let offset = 1;offset < count;offset += 1){
    const day = days[offset];
    for(let i = 0;i < data.length;i += 1){
      if(seen.has(i))continue;
      const h = data[i];
      if(!isWeekCandidate(h,settings,day.dayBase,day.weekday))continue;
      // Skip if it's already due today (today agenda owns it).
      if(includeInTodayAgenda(h,settings))continue;
      seen.add(i);
      movable.push({ h, i, priority:effectivePriority(h), score:attentionScore(h,i,settings) });
    }
  }
  const registry = normalizeLocationRegistry(settings.locations);
  assignWeekCandidates(movable,days.slice(1),settings,registry);
  // Build each day's timeline + travel roll-up.
  let totalTravelSeconds = 0;
  for(const day of days){
    const startClock = day.isToday
      ? ceilToMinutes(Date.now(),5)
      : day.dayBase + dayFirstOpenMinute(normalizeBlockedTimes(settings.blockedTimes),day.weekday) * 60000;
    day.timeline = buildDayTimeline(day,{ dayBase:day.dayBase, weekday:day.weekday, startClock });
    day.travelSeconds = day.timeline.filter(r=>r.kind === 'travel').reduce((s,r)=>s + (r.seconds || 0),0);
    totalTravelSeconds += day.travelSeconds;
  }
  return { days, totalTravelSeconds, candidateCount:movable.length };
}

// PURE: format a timestamp as a short clock label
function agendaTimeLabel(ts){
  return new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

// PURE: build the capacity summary copy
function agendaSummary(agenda){
  if(agenda.totalMinutes <= 0)return 'No capacity set for today. Add availability in settings to see a timed plan.';
  const free = agenda.remainingMinutes;
  if(agenda.scheduled.length && free <= 0){
    const ev = agenda.scheduled.length === 1 ? '1 scheduled' : `${agenda.scheduled.length} scheduled`;
    return `${ev} fill the day.`;
  }
  const parts = [];
  if(agenda.scheduled.length){
    parts.push(agenda.scheduled.length === 1 ? '1 scheduled' : `${agenda.scheduled.length} scheduled`);
  }
  parts.push(`${Math.round(free)}m free`);
  return parts.join(' · ');
}

// RENDER: renders the full today agenda into #today-sheet
function renderTodayAgenda(){
  const wrap = $('today-content');
  if(!wrap)return;
  syncTodayRangeSeg();
  if(todayRange === 'week')return renderWeekAgenda();
  const data = load();
  const settings = sortSettings || loadSortSettings();
  const agenda = buildTodayAgenda(data,settings);
  const rows = buildTodayTimeline(agenda);
  $('today-summary').textContent = agendaSummary(agenda);
  if(typeof renderIAmAtPicker === 'function')renderIAmAtPicker();

  if(!rows.length){
    wrap.innerHTML = `<div class="agenda-empty">
      <i class="ti ti-calendar-off" aria-hidden="true"></i>
      <p>Nothing planned for today.</p>
      <span>Add a scheduled task, plan an entry, or turn on Today agenda items in settings.</span>
    </div>`;
    return;
  }

  const now = Date.now();
  wrap.innerHTML = `<div class="agenda-timeline">${rows.map(row => agendaRowMarkup(row,now)).join('')}</div>`;
  bindAgendaTaps();
  renderTodayWeekStrip(data);
}

// RENDER: keep the today/week segmented control in sync with the view state.
function syncTodayRangeSeg(){
  const seg = $('today-range-seg');
  if(!seg)return;
  seg.querySelectorAll('[data-today-range]').forEach(btn=>{
    const on = btn.dataset.todayRange === todayRange;
    btn.classList.toggle('on',on);
    btn.setAttribute('aria-selected',on ? 'true' : 'false');
  });
}

// HANDLER: today/week segmented control click.
function setTodayRange(range){
  if(range !== 'today' && range !== 'week')return;
  if(todayRange === range)return;
  todayRange = range;
  renderTodayAgenda();
}

// RENDER: the 7-day agenda. Each day is a card with its timeline rows; travel
// between consecutive different-location items shows as a dashed band, same as
// today. A header chip per day carries the date, weekday, fill count, and that
// day's travel total so the clustering trade-off is visible at a glance.
function renderWeekAgenda(){
  const data = load();
  const settings = sortSettings || loadSortSettings();
  const week = buildWeekAgenda(data,settings,7);
  const travelMin = Math.round(week.totalTravelSeconds / 60);
  $('today-summary').textContent = travelMin > 0
    ? `Next 7 days · ${travelMin} min travel · ${week.candidateCount} planned`
    : `Next 7 days · ${week.candidateCount} planned`;
  if(typeof renderIAmAtPicker === 'function')renderIAmAtPicker();
  const now = Date.now();
  const cards = week.days.map(day => weekDayMarkup(day,now)).join('');
  const wrap = $('today-content');
  if(!week.days.some(d=>d.timeline.length)){
    wrap.innerHTML = `<div class="agenda-empty">
      <i class="ti ti-calendar-week" aria-hidden="true"></i>
      <p>Nothing planned this week.</p>
      <span>Add due dates to tasks or schedule entries to see them sequenced across the week.</span>
    </div>`;
    return;
  }
  wrap.innerHTML = `<div class="week-agenda">${cards}</div>`;
  bindAgendaTaps();
  renderTodayWeekStrip(data);
}

// RENDER: one day card inside the week agenda.
function weekDayMarkup(day,now){
  const date = new Date(day.dayBase);
  const label = `${weekdayShort(day.weekday)} ${date.getDate()}`;
  const isToday = day.isToday;
  const fills = day.agendaItems.length + day.scheduled.length;
  const travelMin = Math.round(day.travelSeconds / 60);
  const headExtra = [
    fills ? `${fills} ${fills === 1 ? 'item' : 'items'}` : 'open',
    travelMin ? `${travelMin} min travel` : '',
  ].filter(Boolean).join(' · ');
  const body = day.timeline.length
    ? day.timeline.map(row => agendaRowMarkup(row,now)).join('')
    : `<div class="agenda-empty slim"><span>nothing scheduled</span></div>`;
  return `<section class="week-day${isToday ? ' is-today' : ''}">
    <header class="week-day-head"><b>${escapeHtml(label)}</b>${isToday ? '<span class="context-pill quiet">today</span>' : ''}<span class="trend-copy">${escapeHtml(headExtra)}</span></header>
    <div class="agenda-timeline">${body}</div>
  </section>`;
}

// RENDER: forward-looking 7-day strip — the complement to "just today".
// Reuses the shared dayStripMarkup so cells match the overview exactly. Tapping
// a day opens the day-logs sheet so you can plan ahead.
function renderTodayWeekStrip(data){
  const strip = $('today-week-strip');
  if(!strip)return;
  const start = dayStart(Date.now());
  const {tally,html} = dayStripMarkup(data,start,7);
  strip.className = 'month-grid rich-month-grid strip-grid';
  strip.innerHTML = html;
  const note = $('today-week-note');
  if(note){
    const upcoming = tally.total;
    note.textContent = upcoming ? `${upcoming} ${upcoming === 1 ? 'entry' : 'entries'} planned` : 'open for plans';
  }
}

// PURE: build one agenda row's HTML
function agendaRowMarkup(row,now){
  if(row.kind === 'travel' || row.kind === 'wait'){
    const mins = Math.max(1,Math.round((row.seconds || 0) / 60));
    const km = row.metres ? `${(row.metres / 1000).toFixed(row.metres >= 1000 ? 1 : 2)} km` : '';
    if(row.kind === 'wait'){
      const label = `wait · ${escapeHtml(row.toName || 'opens')} · ${mins} min`;
      return `<div class="today-travel-row" aria-hidden="true"><i class="ti ti-route" aria-hidden="true"></i><span>${label}</span></div>`;
    }
    const edited = typeof isManualTravelEdge === 'function' && isManualTravelEdge(row);
    const label = `${mins} min${km ? ` · ${km}` : ''} · ${escapeHtml(row.fromName || 'here')} → ${escapeHtml(row.toName || 'next')}`;
    return `<button type="button" class="today-travel-row${edited ? ' is-edited' : ''}" data-travel-from="${escapeHtml(row.from || '')}" data-travel-to="${escapeHtml(row.to || '')}" aria-label="edit travel time"><i class="ti ti-route" aria-hidden="true"></i><span>${label}</span>${edited ? '<i class="ti ti-pencil travel-edit-mark" aria-hidden="true"></i>' : ''}</button>`;
  }
  const h = row.h;
  const c = colors(daysSince(h.lastLog),h.target,h.type);
  const toneCls = cardTone(h);
  const accent = visualClassColor(toneCls);
  const isPast = row.end < now;
  const cue = row.kind === 'scheduled' ? scheduledCue(h) : cardCue(h);
  const dur = clampDuration(h.durationMinutes);
  const softTag = row.kind === 'scheduled'
    ? '<span class="agenda-tag hard">fixed</span>'
    : '<span class="agenda-tag soft">approx</span>';
  const loc = row.locationId && typeof locationById === 'function' ? locationById(row.locationId) : null;
  const meta = row.kind === 'scheduled'
    ? `${dur}m`
    : [h.type === 'task' ? 'task' : 'habit', `${dur}m`, loc ? loc.name : ''].filter(Boolean).join(' · ');
  return `<button class="agenda-row ${row.kind}${isPast ? ' is-past' : ''} ${toneCls}" data-agenda-idx="${row.i}" style="--card-accent:${accent};">
    <span class="agenda-clock">
      <b>${agendaTimeLabel(row.start)}</b>
      <small>${row.kind === 'scheduled' ? '' : agendaTimeLabel(row.end)}</small>
    </span>
    <span class="agenda-dot" style="background:${c.icon};"></span>
    <span class="agenda-body">
      <span class="agenda-line">
        <span class="agenda-ic">${iconHtml(h,c)}</span>
        <span class="agenda-name">${escapeHtml(h.name)}</span>
        ${softTag}
      </span>
      <span class="agenda-sub">${escapeHtml(cue)} · ${escapeHtml(meta)}</span>
    </span>
  </button>`;
}

// HANDLER: wire agenda row taps to open detail
function bindAgendaTaps(){
  document.querySelectorAll('#today-content .agenda-row').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = parseInt(btn.dataset.agendaIdx,10);
      if(Number.isNaN(idx))return;
      if(typeof openDetail === 'function')openDetail(idx);
    });
  });
}

// HYBRID: open the today agenda sheet
function openToday(){
  closeSearch();
  renderTodayAgenda();
  openSheet('today-sheet');
}
