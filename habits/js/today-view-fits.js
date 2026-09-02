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

/** PURE: start ms for a scheduled agenda event (task eventTime or timed plan). */
function scheduledEventStart(ev){
  if(!ev)return null;
  if(ev.eventTime != null && Number.isFinite(Number(ev.eventTime)))return Number(ev.eventTime);
  if(ev.h && ev.h.eventTime != null && Number.isFinite(Number(ev.h.eventTime)))return Number(ev.h.eventTime);
  return null;
}

/**
 * PURE: hard clock blocks for a day — timed tasks plus timed day-plan logs.
 * Returns {h,i,eventTime,locationId?,fromTimedPlan?} sorted by start.
 * Untimed day pins and plan-by (`planByDate`) are not included here.
 */
function collectScheduledAgendaEvents(data,dayKey,settings){
  const out = [];
  const showTasks = !settings || settings.showScheduledTasksInAgenda !== false;
  const showPlanned = !settings || settings.showPlannedItemsInAgenda !== false;
  (data || []).forEach((h,i)=>{
    if(!h)return;
    if(showTasks && h.type === 'task' && h.eventTime !== null
      && (typeof isTaskDone !== 'function' || !isTaskDone(h))
      && dateKey(h.eventTime) === dayKey){
      out.push({h,i,eventTime:h.eventTime});
    }
    if(!showPlanned || typeof timedPlanLogForDay !== 'function')return;
    const plan = timedPlanLogForDay(h,dayKey);
    if(!plan)return;
    out.push({
      h,
      i,
      eventTime:logTime(plan),
      locationId:typeof planLocationId === 'function' ? planLocationId(plan) : null,
      fromTimedPlan:true
    });
  });
  return out.sort((a,b)=>a.eventTime - b.eventTime);
}

function buildTodayAgenda(data,settings){
  const todayKey = todayIso();
  const dayBase = dayStart(Date.now());
  const scheduled = collectScheduledAgendaEvents(data,todayKey,settings);
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
    if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayBase))continue;
    const dueToday = includeInTodayAgenda(h,settings);
    const earlyOk = !dueToday && typeof earlyReason === 'function' && Boolean(earlyReason(data,i,settings));
    if(!dueToday && !earlyOk)continue;
    candidates.push({h,i,priority:effectivePriority(h),rank:homeRank++});
  }
  const linkOmissions = [];
  // Must-do links pull via earlyReason / week eligibility; they do not remove
  // a subject when its partner is absent (other days stay unconstrained).
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
  // Logs win over plans: once the work is actually done for today it leaves
  // the agenda, even if a plan entry for today is still on the habit.
  if(typeof completedOnDay === 'function' && completedOnDay(h,dayStart(Date.now())))return false;
  if(hasPlannedToday(h) && settings.showPlannedItemsInAgenda !== false){
    // Timed day plans are hard scheduled rows — do not also soft-fill today.
    if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayStart(Date.now())))return false;
    return true;
  }
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
  const target = typeof effectiveRhythmCadenceGapDays === 'function'
    ? effectiveRhythmCadenceGapDays(h)
    : effectiveTarget(h);
  // A calendar-constrained frequency can require every allowed opportunity.
  // 3x/7d on Tue/Fri/Sat (or 2x/7d on Fri/Sat) must therefore surface on
  // Saturday even when Friday was completed. A completion earlier today still
  // clears a non-breakable habit normally.
  if(settings.showDueHabitsInAgenda !== false
    && scheduleDistance === 0 && windowStillDoableToday(h)
    && typeof rhythmFillsEveryEligibleDay === 'function'
    && rhythmFillsEveryEligibleDay(h)
    && (days === null || days > 0))return true;
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
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
    const windows = fillDayWindows(h,dayBase,contextLocId);
    if(!windows || !windows.length){
      if(typeof hasGeneralAllowedSchedule === 'function' && hasGeneralAllowedSchedule(h)
        && typeof hasSimpleAllowedTimeWindow === 'function' && hasSimpleAllowedTimeWindow(h)
        && typeof isDateEligibleForGeneralSchedule === 'function'
        && isDateEligibleForGeneralSchedule(h,dayBase)){
        const startMin = resolveHabitTimeField(h,'allowedTimeStart',dayBase,contextLocId);
        const endMin = resolveHabitTimeField(h,'allowedTimeEnd',dayBase,contextLocId);
        if(startMin == null || endMin == null)return null;
        const start = dayBase + startMin * 60000;
        let end = dayBase + endMin * 60000;
        if(end <= start)end += 24 * 3600000;
        return {start,end};
      }
      return null;
    }
    return {
      start:windows.reduce((min,win)=>Math.min(min,win.start),windows[0].start),
      end:windows.reduce((max,win)=>Math.max(max,win.end),windows[0].end)
    };
  }
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
function fillClockWindowOnDay(startMin,endMin,dayBase){
  const dayEnd = dayBase + 24 * 3600000;
  if(endMin === startMin)return [{start:dayBase,end:dayEnd}];
  if(endMin > startMin)return [{start:dayBase + startMin * 60000,end:dayBase + endMin * 60000}];
  return [
    {start:dayBase,end:dayBase + endMin * 60000},
    {start:dayBase + startMin * 60000,end:dayEnd}
  ].filter(win=>win.end > win.start);
}

function fillSimpleDayWindows(h,dayBase,contextLocId){
  const rawStart = resolveHabitTimeField(h,'allowedTimeStart',dayBase,contextLocId);
  const rawEnd = resolveHabitTimeField(h,'allowedTimeEnd',dayBase,contextLocId);
  if(rawStart == null || rawEnd == null)return null;
  const folded = typeof foldBlockedMinutes === 'function'
    ? foldBlockedMinutes(rawStart,rawEnd)
    : {startMin:rawStart,endMin:rawEnd};
  const startMin = folded.startMin;
  const endMin = folded.endMin;
  if(!Number.isFinite(startMin) || !Number.isFinite(endMin))return null;
  return fillClockWindowOnDay(startMin,endMin,dayBase);
}

function fillOptionDayWindows(h,dayBase,contextLocId){
  const options = habitScheduleOptionsForDay(h,dayBase);
  const intervals = [];
  for(const option of options){
    const bound = typeof habitBoundToScheduleOption === 'function'
      ? habitBoundToScheduleOption(h,option) : h;
    const windows = fillSimpleDayWindows(bound,dayBase,option.locationId || contextLocId);
    if(windows)intervals.push(...windows);
  }
  return intervals;
}

function fillDayWindows(h,dayBase,contextLocId){
  if(!hasTimeWindow(h))return null;
  const intervals = [];
  if(typeof hasGeneralAllowedSchedule === 'function'
    && hasGeneralAllowedSchedule(h)
    && typeof isDateEligibleForGeneralSchedule === 'function'
    && isDateEligibleForGeneralSchedule(h,dayBase)
    && typeof hasSimpleAllowedTimeWindow === 'function'
    && hasSimpleAllowedTimeWindow(h)){
    const general = fillSimpleDayWindows(h,dayBase,contextLocId);
    if(general)intervals.push(...general);
  }
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
    intervals.push(...fillOptionDayWindows(h,dayBase,contextLocId));
    if(intervals.length)return mergeIntervals(intervals.filter(win=>win.end > win.start));
    if(typeof hasGeneralAllowedSchedule === 'function' && hasGeneralAllowedSchedule(h)
      && typeof hasSimpleAllowedTimeWindow === 'function' && !hasSimpleAllowedTimeWindow(h)){
      return null;
    }
    return intervals.length ? mergeIntervals(intervals.filter(win=>win.end > win.start)) : [];
  }
  return fillSimpleDayWindows(h,dayBase,contextLocId);
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
  const locIds = typeof habitLocationIdsForDay === 'function'
    ? habitLocationIdsForDay(h,dayBase,registry)
    : normalizeLocationIds(h.locationIds,registry);
  const dayEnd = dayBase + 24 * 3600000;
  const todayKey = dateKey(now);
  const blocked = (typeof agendaBlockedIntervals === 'function')
    ? agendaBlockedIntervals(todayKey,settings,dayBase,dayEnd)
    : [];
  const blockedMsIn = (from,to)=>blocked.reduce((sum,b)=>{
    if(b.end <= from || b.start >= to)return sum;
    return sum + (Math.min(b.end,to) - Math.max(b.start,from));
  },0);
  const anywhereToday = typeof habitHasAnywhereForDay === 'function'
    ? habitHasAnywhereForDay(h,dayBase,registry)
    : h.anywhereAllowed;
  if(anywhereToday || !locIds.length){
    if(!hasTimeWindow(h)){
      // No restriction: count time left today minus any blocked span.
      const remaining = dayEnd - now - blockedMsIn(now,dayEnd);
      if(remaining >= cost)return true;
    }else{
      const windows = fillDayWindows(h,dayBase);
      if(!windows)return true;
      if(windows.some(win=>{
        const from = Math.max(now,win.start);
        const remaining = win.end - from - blockedMsIn(from,win.end);
        return remaining >= cost;
      }))return true;
    }
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
  // A live coordinate outside every saved radius is a real route origin, not
  // the nearest saved location. `travelFromCurrent` uses an in-memory cache
  // and never persists the coordinate.
  if(typeof CURRENT_COORD_ID !== 'undefined' && fromId === CURRENT_COORD_ID){
    const to = registry.find(l=>l.id === toId);
    if(to && typeof travelFromCurrent === 'function')return travelFromCurrent(to,mode);
  }
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
  const seedLoc = state && state.seedLocId || null;
  const liveLoc = state && state.liveLocId || null;
  const marks = [];
  const at = Number(atTs) || 0;
  const startClock = Number(state && state.startClock) || 0;
  // A genuine live fix (pin / geofence / GPS coordinate) supersedes events
  // that already ended — last night's sleep at Home must not strand you when
  // GPS says FarA. Today's lastKnown / day seed is weaker: it may skip ended
  // BLOCKS (sleep) so a Walmart lastKnown is not painted as "travel home first",
  // but it must not hide a just-ended appointment (leave-by after Oil Change).
  const seqLoc = (!liveLoc && state && state.isTodayDay
    && typeof todaySequencingLocationId === 'function')
    ? todaySequencingLocationId(state) : null;
  const liveOverrides = liveLoc && Number.isFinite(startClock) && startClock <= at;
  const skipEndedBlocks = (liveOverrides || (seqLoc && Number.isFinite(startClock) && startClock <= at));
  for(const row of state && state.rows || []){
    if(row.kind !== 'scheduled' || !row.locationId)continue;
    if(!(row.start < at))continue;
    if(liveOverrides && Number.isFinite(row.end) && row.end <= startClock)continue;
    marks.push({start:row.start,locationId:row.locationId});
  }
  for(const block of locationTiedBlockedIntervals(state)){
    if(!(block.start < at))continue;
    if(skipEndedBlocks && Number.isFinite(block.end) && block.end <= startClock)continue;
    marks.push({start:block.start,locationId:block.locationId});
  }
  for(const entry of chron || []){
    const fit = entry && entry.fit;
    if(!fit || !fit.locId || !(fit.placeStart < at))continue;
    marks.push({start:fit.placeStart,locationId:fit.locId});
  }
  if(liveOverrides)marks.push({start:startClock,locationId:liveLoc});
  if(!marks.length)return seedLoc;
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
function pickHabitLocationId(h,anchorId,registry,mode,dayBase = dayStart(Date.now())){
  const ids = typeof habitLocationIdsForDay === 'function'
    ? habitLocationIdsForDay(h,dayBase,registry)
    : normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return null;
  const anywhereAllowed = typeof habitHasAnywhereForDay === 'function'
    ? habitHasAnywhereForDay(h,dayBase,registry)
    : h.anywhereAllowed;
  if(ids.length === 1 && !anywhereAllowed)return ids[0];
  let best = null;
  let bestScore = anywhereAllowed ? 0 : Infinity;
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

// PURE: adjacent-leg diagnostic for a route-wide location decision. The active
// placement path optimizes the complete committed chain; this helper only
// explains the incoming/outgoing contribution around one fill.
function locationChoiceBreakdown(h,anchorId,registry,mode,nextLocId,actualChosenId){
  const ids = normalizeLocationIds(h.locationIds,registry);
  if(!ids.length)return null;
  const locName = id => {
    const loc = registry.find(l=>l.id === id);
    return (loc && loc.name) || id;
  };
  if(ids.length === 1 && !h.anywhereAllowed){
    const chosenId = actualChosenId === undefined ? ids[0] : actualChosenId;
    const requiredLocationMissing = chosenId !== ids[0];
    const c = {
      id:ids[0],
      name:locName(ids[0]),
      prefLevel:locationPrefLevel(h,ids[0]) || 'neutral',
      edgeSeconds:Number(travelEdgeBetweenIds(anchorId,ids[0],registry,mode).seconds) || 0,
      outboundSeconds:nextLocId
        ? Number(travelEdgeBetweenIds(ids[0],nextLocId,registry,mode).seconds) || 0 : null,
      prefBias:0,
      sameAnchorBonus:(anchorId && ids[0] === anchorId) ? -60 : 0,
      total:0,
      roundTrip:null,
      isWinner:!requiredLocationMissing
    };
    if(nextLocId)c.roundTrip = c.edgeSeconds + c.outboundSeconds;
    return {
      anchorId:anchorId || null,
      nextLocId:nextLocId || null,
      chosenId,
      reason:requiredLocationMissing
        ? 'INVALID: committed placement lost its single required location'
        : 'single allowed location (no scoring)',
      candidates:[c]
    };
  }
  const useRoundTrip = Boolean(nextLocId);
  const candidates = ids.map(id=>{
    const edge = travelEdgeBetweenIds(anchorId,id,registry,mode);
    const prefLevel = locationPrefLevel(h,id);
    const prefBias = -locationPrefScore(prefLevel) * 30;
    const sameAnchorBonus = (anchorId && id === anchorId) ? -60 : 0;
    const edgeSeconds = Number(edge && edge.seconds) || 0;
    const outboundSeconds = nextLocId
      ? Number(travelEdgeBetweenIds(id,nextLocId,registry,mode).seconds) || 0 : null;
    const inboundTotal = edgeSeconds + prefBias + sameAnchorBonus;
    const roundTrip = nextLocId
      ? (edgeSeconds + outboundSeconds + prefBias + sameAnchorBonus) : null;
    return {
      id,
      name:locName(id),
      prefLevel:prefLevel || 'neutral',
      edgeSeconds,
      outboundSeconds,
      prefBias,
      sameAnchorBonus,
      // `total` is the score the active picker minimises (inbound-only, or
      // round-trip when the next fill's location is known at reconcile time).
      total:useRoundTrip ? roundTrip : inboundTotal,
      inboundTotal,
      roundTrip
    };
  });
  let chosenId = actualChosenId || null;
  if(actualChosenId === undefined){
    let bestScore = h.anywhereAllowed ? 0 : Infinity;
    for(const c of candidates){
      if(c.total < bestScore){ bestScore = c.total; chosenId = c.id; }
    }
  }
  for(const c of candidates){
    c.isWinner = (c.id === chosenId);
    c.isRoundTripWinner = useRoundTrip
      ? candidates.every(o=>c.roundTrip <= o.roundTrip)
        && candidates.some(o=>c.roundTrip < o.roundTrip)
      : null;
  }
  let reason;
  if(actualChosenId !== undefined){
    reason = 'complete-day route optimum (all selected fills and fixed location anchors)';
  }else if(!chosenId){
    reason = 'no location beat the anywhere-allowed floor 0 (stays anchorless)';
  }else if(h.anywhereAllowed){
    reason = 'lowest total under anywhere-allowed floor 0';
  }else if(useRoundTrip){
    reason = 'lowest ROUND-TRIP total wins (inbound + outbound to next fill)';
  }else{
    reason = 'lowest total = travel + preference bias + stay-anchor bonus (lower wins)';
  }
  return {
    anchorId:anchorId || null,
    nextLocId:nextLocId || null,
    chosenId,
    reason,
    candidates:candidates.sort((a,b)=>a.total - b.total)
  };
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
      }else if(typeof timedPlanLogForDay === 'function'){
        const plan = timedPlanLogForDay(h,dateKey(base));
        if(plan){
          const start = logTime(plan);
          result = {start,end:start + clampDuration(h.durationMinutes) * 60000,kind:'scheduled'};
        }
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

/**
 * Every habit the current solve covers. Candidate lists drop work that is
 * already done, so link math that must still see a finished partner reads the
 * full set from here instead.
 */
function plannerSolveHabits(){
  if(Array.isArray(_plannerSolveData))return _plannerSolveData;
  return typeof load === 'function' ? load() : [];
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
  const dayKey = dateKey(now);
  let anchor = (typeof currentLocationId === 'function' && currentLocationId())
    || settings.lastKnownLocationId
    || null;
  // Same seed the first travel card uses (pin, geofence, or lastKnown).
  // If we are willing to draw "travel from Walmart to Home", travel must
  // also win the within-band order so we do not immediately bounce back.
  const travelOverridesPriority = !!anchor;
  const bands = [];
  for(const item of items){
    const scarce = isScarceScore(item.scarcity)
      || (typeof hasTimeWindow === 'function' && hasTimeWindow(item.h))
      || (typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(item.h));
    const scarcityKey = scarce ? 0 : 1;
    const p = item.priority ?? effectivePriority(item.h);
    const bandP = travelOverridesPriority ? 0 : p;
    let band = bands.find(b=>b.scarcityKey === scarcityKey && b.priority === bandP);
    if(!band){ band = {scarcityKey,priority:bandP,items:[]}; bands.push(band); }
    band.items.push(item);
  }
  bands.sort((a,b)=>a.scarcityKey - b.scarcityKey || a.priority - b.priority);
  const out = [];
  const resolveItemLoc = (item,anchorId)=>{
    if(item && Object.prototype.hasOwnProperty.call(item,'locationId')
      && item.locationId !== undefined){
      return item.locationId;
    }
    const planLoc = typeof dayPlanLocationId === 'function'
      ? dayPlanLocationId(item.h,dayKey) : null;
    if(planLoc)return planLoc;
    return pickHabitLocationId(item.h,anchorId,registry,mode,dayStart(now));
  };
  for(const band of bands){
    const left = [...band.items];
    while(left.length){
      let bestIdx = 0;
      let bestScore = Infinity;
      for(let i = 0;i < left.length;i += 1){
        const locId = resolveItemLoc(left[i],anchor);
        const edge = travelEdgeBetweenIds(anchor,locId,registry,mode);
        const pri = left[i].priority ?? effectivePriority(left[i].h);
        // Travel primary; priority is a tiebreak only (especially when live).
        const score = edge.seconds + pri * 1e-6;
        if(score < bestScore){ bestScore = score; bestIdx = i; }
      }
      const picked = left.splice(bestIdx,1)[0];
      const locationId = resolveItemLoc(picked,anchor);
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

  const locId = fill.locationId || pickHabitLocationId(h,state.seedLocId,state.registry,state.mode,state.dayBase);
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
    if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,day.dayBase))continue;
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
  const travelMode = typeof normalizeTravelMode === 'function'
    ? normalizeTravelMode(settings && settings.defaultTravelMode) : 'driving';
  const locNameById = id => {
    if(!id)return 'none';
    const loc = registry.find(l=>l.id === id);
    return (loc && loc.name) || id;
  };
  // PURE: reconstruct the location anchor the planner would have used at the
  // start of a fill — the latest location-bearing scheduled row, location-tied
  // blocked interval, or committed fill that has already started, else the day
  // seed. Mirrors locationPresenceAt() (which ignores travel rows) but built
  // only from trace data so it stays off the placement path. Used to explain
  // multi-location choices in the on-demand audit.
  const anchorAt = targetStart => {
    const at = Number(targetStart) || 0;
    const marks = [];
    for(const r of agendaRows || []){
      if(!(r.start < at))continue;
      if(r.kind === 'scheduled' && r.locationId){
        marks.push({start:r.start, locationId:r.locationId, source:`scheduled ${r.name || ''}`.trim()});
      }
      if(r.kind === 'fill' && r.locationId){
        marks.push({start:r.start, locationId:r.locationId, source:`prior fill ${r.name || ''}`.trim()});
      }
    }
    for(const block of rawBlocks || []){
      if(!block.locationId || !(block.start < at))continue;
      marks.push({start:block.start, locationId:block.locationId, source:`blocked:${block.label || ''}`});
    }
    if(!marks.length)return {id:null, source:'day seed'};
    marks.sort((a,b)=>a.start - b.start);
    const last = marks[marks.length - 1];
    return {id:last.locationId, source:last.source};
  };
  // PURE: the committed location of the next fill/scheduled row after this
  // one, if any. Feeds the round-trip location picker / audit so a multi-
  // location fill sandwiched before a Home-locked item (e.g. Lunch) picks
  // the location that minimises inbound + outbound, not inbound alone.
  const nextLocAfter = targetEnd => {
    const at = Number(targetEnd) || 0;
    let earliest = null;
    for(const r of agendaRows || []){
      if(r.kind !== 'fill' && r.kind !== 'scheduled')continue;
      if(!r.locationId)continue;
      if(r.start < at)continue;
      if(!earliest || r.start < earliest.start)earliest = r;
    }
    if(!earliest)return {id:null, source:'none'};
    return {id:earliest.locationId, source:`next ${earliest.kind} ${earliest.name || ''}`.trim()};
  };
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
      // Direct-pack outcome on this day's agenda — makes morning-vs-Juma misses obvious.
      for(const edge of constraints){
        if(edge.adjacency !== 'direct')continue;
        if(edge.beforeHid !== h.hid && edge.afterHid !== h.hid)continue;
        const beforeHid = edge.beforeHid;
        const afterHid = edge.afterHid;
        const partnerHid = beforeHid === h.hid ? afterHid : beforeHid;
        const afterRows = (agendaRows || [])
          .filter(row=>row && row.kind === 'fill' && row.h && row.h.hid === afterHid)
          .sort((a,b)=>a.start - b.start);
        const beforeRows = (agendaRows || [])
          .filter(row=>row && row.kind === 'fill' && row.h && row.h.hid === beforeHid)
          .sort((a,b)=>a.start - b.start);
        if(!afterRows.length || !beforeRows.length){
          orderInputs.push(`direct pack vs ${nameByHid.get(partnerHid) || 'partner'}: partner or self not on this day`);
          continue;
        }
        const afterStart = afterRows[0].start;
        const pred = beforeRows
          .filter(row=>row.end <= afterStart + 60000)
          .sort((a,b)=>b.end - a.end)[0];
        if(!pred){
          orderInputs.push(`direct pack vs ${nameByHid.get(partnerHid) || 'partner'}: no before-chunk ends before partner`);
          continue;
        }
        const gapMin = Math.max(0,Math.round((afterStart - pred.end) / 60000));
        const interloper = (agendaRows || []).some(row=>{
          if(!row || row.kind !== 'fill' || !row.h)return false;
          const id = row.h.hid;
          if(id === beforeHid || id === afterHid)return false;
          return row.start + 60000 >= pred.end && row.end <= afterStart + 60000;
        });
        const ok = !interloper && gapMin <= 90;
        orderInputs.push(
          `direct pack vs ${nameByHid.get(partnerHid) || 'partner'}: ${ok ? 'ok' : 'miss'}`
          + ` gap ${gapMin}m${interloper ? ' with interloper' : ''}`
          + ` (want ≤90m, travel ok, no other habit between)`
        );
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
      locationNames.length
        ? `locations ${locationIds.map((id,k)=>{
            const lvl = typeof locationPrefLevel === 'function'
              ? (locationPrefLevel(h,id) || 'neutral') : 'neutral';
            return `${locationNames[k]}=${lvl}`;
          }).join(', ')}`
        : 'no location constraint',
      orderInputs.length ? `order ${orderInputs.join('; ')}` : ''
    ].filter(Boolean);
    const earliestClockFit = plannerTraceEarliestClockFit(
      h,i,dayBase,dayEnd,rangeStart,rawBlocks,agendaRows,minChunk
    );
    const first = rows[0] || null;
    // Location choice audit (on-demand only). The selected location comes from
    // complete-day route optimization. Adjacent inbound/outbound totals remain
    // useful diagnostics, but are not mislabeled as the whole decision rule.
    if(first && locationIds.length && typeof locationChoiceBreakdown === 'function'){
      const anchor = anchorAt(first.start);
      const lastRow = rows[rows.length - 1] || first;
      const next = nextLocAfter(lastRow.end);
      const actualLocationId = first.locationId === undefined ? null : first.locationId;
      const breakdown = locationChoiceBreakdown(
        h,anchor.id,registry,travelMode,next.id,actualLocationId
      );
      if(breakdown){
        const chosenName = breakdown.chosenId
          ? locNameById(breakdown.chosenId) : 'none';
        inputs.push(`location anchor ${locNameById(anchor.id)} (from ${anchor.source})`);
        if(next.id){
          inputs.push(`location next ${locNameById(next.id)} (from ${next.source}) — adjacent legs shown; optimizer evaluates the complete day route`);
        }
        inputs.push(`location chosen ${chosenName} — ${breakdown.reason}`);
        const parts = breakdown.candidates.map(c=>{
          const travelMin = Math.round(c.edgeSeconds / 60);
          const bits = [
            `${travelMin}m in`,
            `pref ${c.prefLevel}${c.prefBias ? ` (${c.prefBias > 0 ? '+' : ''}${c.prefBias})` : ''}`,
            c.sameAnchorBonus ? `stay ${c.sameAnchorBonus}` : null
          ].filter(Boolean);
          let label = `${c.name}=${c.total} [${bits.join(', ')}]`;
          if(c.outboundSeconds != null){
            const outMin = Math.round(c.outboundSeconds / 60);
            label += ` · ${outMin}m out · rt ${c.roundTrip}`;
          }
          if(c.isWinner)label += ' *';
          return label;
        });
        inputs.push(`location candidates ${parts.join('; ')}`);
      }
    }
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
          ? 'GLPK option optimizer'
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
    if(snapshot && typeof beginPlannerSolveCaches === 'function')beginPlannerSolveCaches(data);
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
  // buildWeekAgenda/buildTodayAgenda own and clear their solve caches. Rebind
  // the on-demand audit to the exact data it is explaining so later gap probes
  // cannot fall back to unrelated localStorage when the caller supplied a
  // rendered snapshot (tests, imports, background Worker handoff).
  if(typeof beginPlannerSolveCaches === 'function')beginPlannerSolveCaches(data);
  const scheduledMinutes = (agenda.scheduled || []).reduce((sum,event)=>{
    const startTs = scheduledEventStart(event);
    if(startTs == null)return sum;
    const start = Math.max(rangeStart,startTs);
    const end = Math.min(dayEnd,startTs + clampDuration(event.h.durationMinutes) * 60000);
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
    if(typeof hasTimedPlanForDay === 'function' && hasTimedPlanForDay(h,dayBase))return false;
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
    const h = data[i];
    const pinned = typeof isWeekPinnedToday === 'function'
      ? isWeekPinnedToday(h,settings) : Boolean(h && h.pinned);
    // A later day satisfies a one-shot/movable candidate, but it never
    // satisfies today's separate daily occurrence.
    if(typeof isMovableWeekCandidate === 'function'
      && !isMovableWeekCandidate({h,i,pinned}))return '';
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
  const placedLoadMinutes = eligible.reduce((sum,i)=>{
    const loadMinutes = todayCandidateLoadMinutes(data[i],dayBase);
    const diag = diagByIndex.get(i) || {};
    return sum + Math.min(loadMinutes,Math.max(0,Number(diag.placedMinutes) || 0));
  },0);

  const eligibleSet = new Set(eligible);
  const placedTodayHids = new Set(timeline
    .filter(row=>row && row.kind === 'fill' && row.i != null && data[row.i] && data[row.i].hid)
    .map(row=>data[row.i].hid));
  const auditOrderEdges = typeof plannerOrderConstraintsForDay === 'function'
    ? plannerOrderConstraintsForDay(dayBase,data) : [];
  // An elsewhere assignment is not automatically a planner miss: flexible
  // work can intentionally choose a better future day. It becomes critical
  // when the occurrence is already due/urgent, or when its visible order
  // partner is on this day, AND it can be inserted into the final agenda
  // without moving any committed row. That last condition is supplied by the
  // exact final-gap probe below (hard windows, travel, ordering and budget).
  const criticalElsewhereReason = i=>{
    const h = data[i];
    if(!h)return '';
    const urgency = typeof weekUrgency === 'function' ? weekUrgency(h) : 0;
    if(Number(urgency) >= 100)return 'due work';
    if(h.hid && auditOrderEdges.some(edge=>edge
      && (edge.beforeHid === h.hid || edge.afterHid === h.hid)
      && placedTodayHids.has(edge.beforeHid === h.hid ? edge.afterHid : edge.beforeHid))){
      return 'linked work';
    }
    return '';
  };
  const gapAudit = diagnostics.gapAudit || {openSlotMinutes:0,openGapMinutes:0,largestGapMinutes:0,gaps:[]};
  const placementGaps = (gapAudit.gaps || []).map(gap=>{
    const feasible = (gap.feasibleCandidateIndices || []).filter(i=>eligibleSet.has(i));
    const budgetLimited = (gap.budgetLimitedCandidateIndices || []).filter(i=>eligibleSet.has(i));
    const unassignedFeasible = feasible.filter(i=>!assignmentLabel(i));
    const criticalAssigned = feasible.filter(i=>assignmentLabel(i) && criticalElsewhereReason(i));
    const status = unassignedFeasible.length
      ? 'missed'
      : (criticalAssigned.length
        ? 'critical-miss'
        : (feasible.length ? 'assigned-elsewhere' : (budgetLimited.length ? 'budget-capped' : 'no-fit')));
    const namedIndices = status === 'budget-capped'
      ? budgetLimited
      : (status === 'critical-miss' ? criticalAssigned : feasible);
    const candidateNames = namedIndices
      .slice(0,3)
      .map(i=>data[i] && data[i].name)
      .filter(Boolean);
    let explanation = 'no remaining eligible item satisfies this gap';
    if(status === 'missed')explanation = `${candidateNames.join(', ')} can still fit with current constraints`;
    if(status === 'critical-miss'){
      const details = criticalAssigned.slice(0,3).map(i=>{
        const label = assignmentLabel(i);
        const reason = criticalElsewhereReason(i);
        return `${data[i] && data[i].name || 'item'} is ${reason}${label ? ` but was assigned ${label}` : ''}`;
      });
      explanation = `${details.join('; ')}; it fits here without moving any committed row`;
    }
    if(status === 'assigned-elsewhere')explanation = `${candidateNames.join(', ')} fits here but was assigned to another day`;
    if(status === 'budget-capped')explanation = `${candidateNames.join(', ')} fits the clock gap, but not the remaining agenda budget`;
    return {...gap,status,candidateNames,criticalCandidateIndices:criticalAssigned,explanation};
  });
  const missedOpportunityCount = placementGaps.filter(
    gap=>gap.status === 'missed' || gap.status === 'critical-miss').length;
  const criticalMissCount = new Set(placementGaps
    .filter(gap=>gap.status === 'critical-miss')
    .flatMap(gap=>gap.criticalCandidateIndices || [])).size;
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
    // Travel-leg endpoints are preserved so the on-demand planner trace can
    // reconstruct the location anchor at any fill without re-running placement.
    from:row.from || null,
    to:row.to || null,
    fromName:row.fromName || '',
    toName:row.toName || '',
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
  const solveStatus = week && week.plannerSolveStatus ? week.plannerSolveStatus : '';
  const plannerEngine = week
    ? (week.optimized
      ? (week.refined
        ? `GLPK background refinement (fixed-pack ${solveStatus || 'feasible'}) + complete-day route`
        : (solveStatus === 'feasible'
          ? 'GLPK feasible fixed-item incumbent + complete-day route; refinement pending'
          : (solveStatus === 'fallback'
            ? 'GLPK requested; heuristic day fallback + complete-day route'
            : 'GLPK optimal fixed-item pack + complete-day route')))
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
  const report = {
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
    placedLoadMinutes:Math.max(0,Math.round(placedLoadMinutes)),
    travelMinutes:Math.max(0,Math.round(diagnostics.travelMinutes || 0)),
    eligibleCount:eligible.length,
    eligibleCoverage:outstandingLoad > 0 ? Math.min(1,placedLoadMinutes / outstandingLoad) : 1,
    budgetUtilization:(agenda.totalMinutes || 0) > 0 ? Math.min(1,(agenda.usedMinutes || 0) / agenda.totalMinutes) : 0,
    placementBudgetRemaining:Math.max(0,Math.round(diagnostics.remainingMinutes || 0)),
    schedulerOpenMinutes:Math.max(0,Math.round(gapAudit.openSlotMinutes || 0)),
    openGapMinutes:Math.max(0,Math.round(gapAudit.openGapMinutes || 0)),
    largestGapMinutes:Math.max(0,Math.round(gapAudit.largestGapMinutes || 0)),
    missedOpportunityCount,
    criticalMissCount,
    budgetCappedGapCount,
    placementGaps,
    agendaRows,
    plannerEngine,
    plannerSolveStatus:solveStatus,
    plannerWasRefined:Boolean(week && week.refined),
    plannerIsPreview,
    plannerTraceGeneratedOnDemand:true,
    plannerTrace,
    hiddenAgendaRowCount:Math.max(0,schedulerPlacementRowCount - displayedPlacementRowCount),
    unplacedItems,
    blockedBreakdown:[...blockedByLabel.entries()].map(([label,minutes])=>({label,minutes}))
  };
  if(typeof endPlannerSolveCaches === 'function')endPlannerSolveCaches();
  return report;
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
    const start = scheduledEventStart(ev);
    if(start == null)return;
    const end = start + clampDuration(ev.h.durationMinutes) * 60000;
    const locIds = normalizeLocationIds(ev.h.locationIds,registry);
    let locationId = ev.locationId || null;
    if(locationId){
      const known = registry.some(l=>l.id === locationId);
      if(!known)locationId = null;
    }
    if(!locationId)locationId = pickHabitLocationId(ev.h,null,registry,mode) || locIds[0] || null;
    rows.push({ kind:'scheduled', h:ev.h, i:ev.i, start, end, hard:true, locationId });
  });
  // `_plannerLiveLocationId` is an ephemeral matched place supplied when the
  // main page delegates planning to its Worker. A Worker cannot read the
  // page's GPS coordinate, so prefer this one-request anchor over persisted
  // last-known presence. It is never saved to user settings.
  const workerLiveLocId = isTodayDay
    && settings && settings._plannerLiveLocationId
    && registry.some(loc=>loc.id === settings._plannerLiveLocationId)
    ? settings._plannerLiveLocationId : null;
  const coordAwayFromSaved = isTodayDay
    && typeof currentCoordLocation === 'function'
    && typeof isCurrentCoordAwayFromSaved === 'function'
    && typeof CURRENT_COORD_ID !== 'undefined'
    && !!currentCoordLocation()
    && isCurrentCoordAwayFromSaved(registry);
  let prevLocId = isTodayDay
    ? (coordAwayFromSaved ? CURRENT_COORD_ID
      : (workerLiveLocId || (typeof currentLocationId === 'function' && currentLocationId()) || settings.lastKnownLocationId || null))
    : (blockLocationAtMinute(blocks,Math.floor((startClock - dayBase) / 60000),weekday,dayBase)
      || blockLocationAtMinute(blocks,Math.max(0,dayFirstOpenMinute(blocks,weekday,dayBase) - 1),weekday,dayBase)
      || null);
  // Genuine live fix only (geolocation / manual pin), not the last-known
  // default. Presence uses this to decide whether the seed supersedes ended
  // blocks. Null on future days and whenever the user has no active fix.
  const liveLocId = isTodayDay
    ? (coordAwayFromSaved ? CURRENT_COORD_ID
      : (workerLiveLocId || (typeof liveLocationId === 'function' ? liveLocationId() : null))) : null;
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
    liveLocId,
    rows,
    fills:[],
    placed:new Set()
  };
}

/**
 * PURE: saved-place id today's packer should treat as "you are HERE" when
 * deciding order. homeDaySequence already draws the first travel leg from
 * seed / lastKnown, so GLPK must use the same place — otherwise it paints
 * "travel to Home" and then a return trip to the seed (Walmart → Home →
 * Walmart). liveLocationId() is intentionally stricter (pin / geofence only);
 * this helper is for sequencing, not for overriding ended sleep blocks.
 *
 * When the seed is the ephemeral GPS coordinate (parking lot, outside every
 * geofence), map to the closest saved place so a task there still wins
 * against an away lunch. Travel minutes stay honest via CURRENT_COORD_ID.
 */
function todaySequencingLocationId(state){
  if(!state || !state.isTodayDay)return null;
  const currentId = (typeof CURRENT_COORD_ID !== 'undefined') ? CURRENT_COORD_ID : '__current__';
  const savedId = id => (id && id !== currentId) ? id : null;
  const closestSaved = ()=>{
    if(typeof currentCoordLocation === 'function' && typeof closestLocation === 'function'){
      const here = currentCoordLocation();
      if(here){
        const near = closestLocation(here.lat, here.lng, state.registry);
        if(near && near.loc && near.loc.id)return near.loc.id;
      }
    }
    const last = state.settings && state.settings.lastKnownLocationId;
    return (typeof cleanLocationId === 'function' ? cleanLocationId(last) : last) || null;
  };
  const liveSaved = savedId(state.liveLocId);
  if(liveSaved)return liveSaved;
  if(state.liveLocId === currentId)return closestSaved();
  const seedSaved = savedId(state.seedLocId);
  if(seedSaved)return seedSaved;
  if(state.seedLocId === currentId)return closestSaved();
  return null;
}

function habitMatchesSequencingLocation(h, locId){
  if(!h || !locId)return false;
  if(Array.isArray(h.locationIds) && h.locationIds.includes(locId))return true;
  if(h.preferredLocationId === locId)return true;
  return false;
}

// PURE: can this away item still fit after an at-location item takes the
// next slot? Used so Fast/heuristic "at-location first" cannot drop a
// hard window that GLPK would keep via a later option (soft travel penalty).
function sequencingAwayCanWait(awayC, atC, state){
  if(!awayC || !awayC.h || !state)return true;
  const now = Number(state.startClock) || Date.now();
  const atDur = typeof clampDuration === 'function'
    ? clampDuration(atC && atC.h && atC.h.durationMinutes)
    : Math.max(1, Number(atC && atC.h && atC.h.durationMinutes) || 30);
  const awayDur = typeof clampDuration === 'function'
    ? clampDuration(awayC.h.durationMinutes)
    : Math.max(1, Number(awayC.h.durationMinutes) || 30);
  const travelMin = 20;
  if(typeof hasTimeWindow === 'function' && hasTimeWindow(awayC.h)
    && typeof fillDayWindows === 'function'){
    const wins = fillDayWindows(awayC.h, state.dayBase, state.seedLocId) || [];
    if(!wins.length)return true;
    const needMs = (atDur + awayDur + travelMin) * 60000;
    return wins.some(w => Number(w && w.end) - now >= needMs);
  }
  return true;
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
    if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)
      && typeof hasGeneralAllowedSchedule === 'function'
      && hasGeneralAllowedSchedule(h)
      && typeof hasSimpleAllowedTimeWindow === 'function'
      && hasSimpleAllowedTimeWindow(h)){
      win = fillTimeWindow(habitBoundToGeneralSchedule
        ? habitBoundToGeneralSchedule(h) : h,dayState.dayBase,loc);
    }else if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
      const windows = fillDayWindows(h,dayState.dayBase,loc) || [];
      const duration = clampDuration(h.durationMinutes);
      const slacks = windows
        .map(item=>(item.end - item.start) / 60000 - duration)
        .filter(slack=>slack >= 0);
      return slacks.length ? Math.min(...slacks) : 0;
    }
    if(!win)win = fillTimeWindow(h,dayState.dayBase,loc);
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
    if(hard && typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)){
      const windows = fillDayWindows(h,todayBase,null) || [];
      const duration = clampDuration(h.durationMinutes);
      const slacks = windows.map(win=>(win.end - win.start) / 60000 - duration).filter(value=>value >= 0);
      if(!slacks.length)return SCARCITY_UNBOUNDED;
      return Math.min(Math.min(...slacks),9999);
    }
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
// direct: prefer abutment — after packs next to pred end; before packs next to
// already-placed successor start (keepup Shower just before scarce Juma).
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
  const habitByHid = (()=>{
    const items = _plannerSolveData || (typeof load === 'function' ? load() : []);
    return new Map((items || []).filter(h=>h && h.hid).map(h=>[h.hid,h]));
  })();
  let pen = 0;
  for(const e of edges){
    if(e.afterHid === hid){
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
        // Uncapped enough that multi-hour gaps cannot beat an abutting fit.
        pen += Math.min(480,gapMin) * 12;
      }
      continue;
    }
    if(e.beforeHid === hid && e.adjacency === 'direct'){
      const succ = placedByHid.get(e.afterHid);
      if(succ){
        const succStart = Number(succ.placeStart) || 0;
        if(fit.placeEnd > succStart + 60000){
          pen += 8000 + Math.max(0,(fit.placeEnd - succStart) / 60000) * 40;
          continue;
        }
        const gapMin = Math.max(0,(succStart - fit.placeEnd) / 60000);
        pen += Math.min(480,gapMin) * 12;
        continue;
      }
      // Successor not committed yet (option enumeration): still pack toward its
      // earliest hard/preferred window so afternoon abut fits beat morning ASAP.
      const afterH = habitByHid.get(e.afterHid);
      if(!afterH)continue;
      let targetStart = null;
      if(typeof hasTimeWindow === 'function' && hasTimeWindow(afterH)){
        const wins = fillDayWindows(afterH,state.dayBase,state.seedLocId) || [];
        for(const win of wins){
          if(!Number.isFinite(win.start))continue;
          targetStart = targetStart == null ? win.start : Math.min(targetStart,win.start);
        }
      }else if(typeof hasPreferredTimeWindow === 'function' && hasPreferredTimeWindow(afterH)){
        const win = fillPreferredWindow(afterH,state.dayBase,state.seedLocId);
        if(win && Number.isFinite(win.start))targetStart = win.start;
      }
      if(targetStart == null)continue;
      if(fit.placeEnd > targetStart + 60000){
        pen += 4000 + Math.max(0,(fit.placeEnd - targetStart) / 60000) * 20;
        continue;
      }
      const gapMin = Math.max(0,(targetStart - fit.placeEnd) / 60000);
      pen += Math.min(480,gapMin) * 8;
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
      scarceOverlapMs:typeof movableEffectiveScarceOverlapMs === 'function'
        && Array.isArray(opts.reservationCandidates)
        ? movableEffectiveScarceOverlapMs(
          fill,fit,state,opts.reservationCandidates,spare)
        : fitOverlapWithWindows(fit,spare),
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
