function tryPlaceOnDay(state,fill,opts = {}){
  if(typeof plannerPerfCountTryPlace === 'function')plannerPerfCountTryPlace();
  if(!state || !fill || !fill.h)return null;
  const placeKey = fill.placeKey != null ? fill.placeKey : fill.i;
  if(state.placed.has(placeKey))return null;
  const {dayBase,weekday,registry,mode,slots,startClock} = state;
  // Untimed day pins store locationId on the plan log. That override wins over
  // reorder/pick defaults stamped onto the fill (preferred location, travel
  // clustering), since the user explicitly chose the place for this day.
  if(typeof dayPlanLocationId === 'function'){
    const planLoc = dayPlanLocationId(fill.h,dateKey(dayBase));
    if(planLoc)fill.locationId = planLoc;
  }
  const registryLookup = id=>{
    if(!id)return null;
    if(state.registryById)return state.registryById.get(id) || null;
    return registry.find(l=>l.id === id) || null;
  };
  const remaining = state.remaining;
  const usedMinutes = state.usedMinutes;
  // `locationId` may deliberately be null only for anywhere/locationless work.
  // `undefined` is an omitted decision, not an instruction to erase a required
  // location (week-hours repair used to manufacture that property).
  const hasLocationProperty = Object.prototype.hasOwnProperty.call(fill,'locationId');
  const optionMode = typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(fill.h);
  const candidateLocIds = optionMode
    ? habitLocationIdsForDay(fill.h,dayBase,registry)
    : normalizeLocationIds(fill.h.locationIds,registry);
  const anywhereToday = optionMode
    ? (typeof habitHasAnywhereForDay === 'function'
      ? habitHasAnywhereForDay(fill.h,dayBase,registry)
      : habitHasAnywhereScheduleOptionForDay(fill.h,dayBase))
    : fill.h.anywhereAllowed;
  // Keep each time/place row as a distinct alternative, including the general
  // allowed window and specific option rows (same venue at different times).
  if(optionMode && !fill._scheduleOptionBound && typeof habitSchedulePlacementVariants === 'function'){
    const optionFits = [];
    for(const variant of habitSchedulePlacementVariants(fill,dayBase,registry) || []){
      const fitForOption = tryPlaceOnDay(state,variant,opts);
      if(fitForOption)optionFits.push(fitForOption);
    }
    return optionFits.length ? pickBestScoredFit(optionFits,fill,state,opts) : null;
  }
  const hasForcedLocation = hasLocationProperty
    && fill.locationId !== undefined
    && (fill.locationId !== null || anywhereToday || (!optionMode && !candidateLocIds.length));
  const resolveLoc = (anchor)=>hasForcedLocation
    ? fill.locationId
    : pickHabitLocationId(fill.h,anchor,registry,mode,dayBase);
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
        // A successor that is already DONE cannot cap a loose "sometime
        // before" item: nothing can be scheduled into the past, so the
        // ceiling would just delete it from the day even though its own
        // rhythm still wants it. "Right before" keeps the ceiling — that
        // pairing is over for today, and the link pass omits it explicitly.
        if(committed && (committed.kind !== 'completed' || e.adjacency === 'direct')){
          orderCeiling = Math.min(orderCeiling,committed.start);
        }
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
      if(locId || optionMode){
        const loc = locId ? registryLookup(locId) : null;
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
      if(locId || optionMode){
        const loc = locId ? registryLookup(locId) : null;
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
        placeKey,
        schedulePrefLevel:typeof locationPrefLevel === 'function' ? locationPrefLevel(fill.h,locId) : null
      };
      fits.push(baseFit);
      // Preferred time is a second soft candidate — score picks vs ASAP/scarce.
      // Doing-now always wants the earliest start, so skip preferred alternatives.
      if(opts.doingNowStart != null)continue;
      // Weather-aware starts are generated from the merged hourly / 15-minute
      // samples. Both planner engines pass through this primitive, so the
      // candidate set and hard-rule behavior stay identical.
      if(typeof weatherCandidateAnchors === 'function'){
        const weatherStarts = weatherCandidateAnchors(
          fill,state,placeStart,Math.min(cap,gap.end),cost,
          opts.settings || state.settings || (typeof sortSettings !== 'undefined' ? sortSettings : null)
        );
        for(const weatherStart of weatherStarts){
          if(weatherStart <= placeStart || weatherStart + cost > cap || weatherStart + cost > gap.end)continue;
          fits.push({...baseFit,placeStart:weatherStart,placeEnd:weatherStart+cost,weatherCandidate:true});
        }
      }
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
      // Direct-order abutment: when a successor is already placed, also offer
      // packing against the gap cap (leave-by / orderCeiling) so a flexible
      // keepup lands just before the scarce partner instead of ASAP morning.
      if(Number.isFinite(orderCeiling) && orderCeiling < Infinity && cap < Infinity){
        const packEnd = Math.min(cap,gap.end);
        const packStart = packEnd - cost;
        if(packStart > placeStart + 60000
          && packStart >= gap.start
          && packStart + cost <= packEnd + 1){
          fits.push({
            ...baseFit,
            placeStart:packStart,
            placeEnd:packStart + cost,
            preferredHit:true
          });
        }
      }
    }
  }
  if(!fits.length)return null;
  const bestFit = pickBestScoredFit(fits,fill,state,opts);
  // Steering for movables (fast / heuristic-fallback / rescue paths). Fixed
  // movables place BEFORE daily breakables commit (mirroring GLPK's fixed-first
  // order), so a movable would otherwise grab the ASAP slot inside a breakable's
  // future window and then be evicted by repair. When the caller passes
  // reservationWindows and the chosen fit overlaps one, move the movable into the
  // nearest free gap touching no reservation (if such a gap exists). This keeps
  // the daily breakable whole while still placing the movable TODAY. Skip direct
  // order links because they must stay adjacent to a partner. For a loose
  // predecessor, only steer outside when the successor can still follow there;
  // otherwise an evening Work boundary can erase a harmless pre-successor gap.
  const directOrderConstrained = !!(fill && fill.h && fill.h.hid
    && typeof plannerOrderConstraintsForDay === 'function'
    && plannerOrderConstraintsForDay(state.dayBase).some(e=>
      e && e.adjacency === 'direct'
        && (e.beforeHid === fill.h.hid || e.afterHid === fill.h.hid)));
  if(bestFit && !directOrderConstrained
    && Array.isArray(opts.reservationWindows) && opts.reservationWindows.length
    && fill && fill.h && !fill.h.breakable && fill.pinned !== true
    && (fill.h.type === 'task'
      || (Number.isFinite(Number(fill.h.target)) && Number(fill.h.target) > 1))
    && opts.reservationWindows.some(w=>bestFit.placeEnd > w.start && bestFit.placeStart < w.end)){
    const outsideFit = typeof placementFitOutsideReservations === 'function'
      ? placementFitOutsideReservations(state,fill,opts.reservationWindows) : null;
    const orderCompatible = !outsideFit
      || typeof outsideFitKeepsEarlySuccessors !== 'function'
      || outsideFitKeepsEarlySuccessors(
        state,fill,outsideFit,opts.reservationCandidates || []);
    if(outsideFit && orderCompatible){
      const weather = typeof weatherFitAssessment === 'function'
        ? weatherFitAssessment(fill,outsideFit,state,opts.settings || state.settings || sortSettings) : null;
      if(!weather || !weather.hardFail){
        if(weather)outsideFit.weather = weather;
        return outsideFit;
      }
    }
  }
  return bestFit;
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

// PURE: P0 occurrences that cannot safely move to another horizon day. Daily
// P0 rhythms are independent obligations on every eligible day; a sparse P0
// with one eligible day (Friday-only Juma) loses the whole occurrence if that
// day is consumed by flexible work.
function mustPlaceCriticalOccurrence(c){
  if(!c || !c.h || Number(c.priority) !== 0)return false;
  // Daily breakables already have a protected reservation and intentionally
  // run last; promoting Work ahead of fixed prayers starves their narrow gaps.
  // One-shot tasks remain governed by pin/due rules and explicit one-day drag
  // promises. This hard tier is for recurring P0 occurrences such as prayers.
  if(c.h.breakable || c.h.type === 'task')return false;
  const eligibleDayCount = c.eligible && typeof c.eligible.size === 'number'
    ? c.eligible.size : Infinity;
  const target = Number(c.h.target);
  const dailyOccurrence = c.h.type !== 'task'
    && Number.isFinite(target) && target <= 1;
  return eligibleDayCount <= 1 || dailyOccurrence;
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

// PURE: broad daily-breakable windows are protected by the hard movable-capacity
// rule, so do not also treat permitted spare as scarce-window damage. Without
// this normalization Fast can assign a due 10m item tomorrow merely because its
// harmless 25m gap happens to lie inside Work's 8:30–19:00 clock window. Narrow
// non-breakable windows remain in the score, and an item larger than the spare
// keeps the full penalty.
function movableEffectiveScarceOverlapMs(fill,fit,state,candidates,scarceWindows){
  const raw = fitOverlapWithWindows(fit,scarceWindows || []);
  if(raw <= 0 || !fill || !fill.h || !state)return raw;
  const candidate = {
    h:fill.h,i:fill.i,pinned:fill.pinned === true,
    priority:fill.priority,scarcity:fill.scarcity
  };
  if(!isMovableWeekCandidate(candidate))return raw;
  const cap = movableCapacityForDay(state,candidates);
  const dur = fillDurationMinutes(fill);
  if(!Number.isFinite(cap) || dur > cap)return raw;
  const reservations = dailyBreakableReservations(state,candidates);
  if(!reservations.length)return raw;
  const protectedOverlap = fitOverlapWithReservationsMs(fit,reservations);
  return Math.max(0,raw - protectedOverlap);
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

// PURE: feasible fits for `fill` on `state` lying entirely in free time touching
// NO window in `reservationWindows` (the daily-breakable windows). Walks the
// day's free gaps, subtracts each reservation window (interval math), then runs
// the REAL placer (auditFillFitInGap) at duration-spaced starts inside each
// remaining outside sub-segment. Returning several fits lets several movables
// chain in the same outside gap (Trash at 19:30, Water Plants at 20:00).
// auditFillFitInGap calls tryPlaceOnDay WITHOUT reservationWindows, so this does
// not recurse into the steering branch.
function placementFitsOutsideReservations(state,fill,reservationWindows){
  if(!state || !fill || !fill.h || !Array.isArray(reservationWindows) || !reservationWindows.length)return [];
  if(typeof freeSegmentsInWindow !== 'function' || typeof auditFillFitInGap !== 'function')return [];
  const dayEnd = state.dayBase + 86400000;
  const gaps = freeSegmentsInWindow(state,state.dayBase,dayEnd);
  if(!gaps || !gaps.length)return [];
  const durMs = clampDuration(fill.h.durationMinutes) * 60000;
  const out = [];
  for(const gap of gaps){
    // Subtract every reservation window from this free gap so the remaining
    // sub-segments are free AND touch no reservation.
    let segs = [gap];
    for(const w of reservationWindows){
      const next = [];
      for(const s of segs){
        if(w.end <= s.start || w.start >= s.end){ next.push(s); continue; }
        if(s.start < w.start)next.push({start:s.start,end:w.start});
        if(w.end < s.end)next.push({start:w.end,end:s.end});
      }
      segs = next;
    }
    for(const seg of segs){
      if(seg.end - seg.start < durMs)continue;     // necessary-condition prune
      // Probe at duration-spaced starts so multiple movables can chain here.
      for(let t = seg.start; t + durMs <= seg.end + 1 && out.length < 8; t += durMs){
        const sub = {start:t, end:Math.min(seg.end, t + durMs)};
        const fit = auditFillFitInGap(state,fill,sub,state.remaining,false);
        if(fit && fit.placeEnd > fit.placeStart
          && !reservationWindows.some(w=>fit.placeEnd > w.start && fit.placeStart < w.end)){
          // Re-key the probe fit. auditFillFitInGap stamps a private `audit:${i}`
          // key so the placed-set check inside its probe clone cannot reject the
          // audit. Consumers here use the fit as a REAL placement — tryPlaceOnDay
          // steering returns it for commit and GLPK injects it as an ILP option —
          // so it must carry the occurrence's actual key. A committed `audit:N`
          // key never matches the `state.placed.has(fill.i)` gates of later
          // passes (rebalanceScarcePlacements, rescues), which then place the
          // same occurrence twice (duplicate rows in the published timeline).
          fit.placeKey = fill.placeKey != null ? fill.placeKey : fill.i;
          if(!out.some(f=>f.placeStart === fit.placeStart && f.placeEnd === fit.placeEnd))out.push(fit);
        }
      }
      if(out.length >= 8)break;
    }
  }
  return out;
}

// PURE: earliest feasible fit for `fill` on `state` touching no reservation
// window, or null. Convenience wrapper over the multi-fit helper.
function placementFitOutsideReservations(state,fill,reservationWindows){
  const all = placementFitsOutsideReservations(state,fill,reservationWindows);
  return all.length ? all[0] : null;
}

// PURE: an outside-reservation fit is only useful when it does not jump over a
// loose, still-unplaced successor. Probe that successor against the current
// state (which already contains any earlier/direct ancestors). This catches the
// real chain Exercise → Shower plus Trash → Shower: after Exercise is committed,
// steering Trash past Work's 19:00 boundary would put it after Shower's 17:45
// earliest legal start and defeat the user's visible order promise.
function outsideFitKeepsEarlySuccessors(state,fill,fit,candidates){
  if(!state || !fill || !fill.h || !fill.h.hid || !fit)return true;
  if(typeof plannerOrderConstraintsForDay !== 'function')return true;
  const edges = plannerOrderConstraintsForDay(state.dayBase)
    .filter(edge=>edge && edge.beforeHid === fill.h.hid);
  if(!edges.length)return true;
  const pool = Array.isArray(candidates) ? candidates : [];
  for(const edge of edges){
    const alreadyPlaced = (state.fills || []).some(entry=>entry && entry.fill
      && entry.fill.h && entry.fill.h.hid === edge.afterHid);
    if(alreadyPlaced)continue; // tryPlaceOnDay already applied the hard ceiling.
    const successor = pool.find(c=>c && c.h && c.h.hid === edge.afterHid
      && (!c.eligible || c.eligible.has(state.dayBase)));
    if(!successor)continue;
    const successorFill = {
      h:successor.h,i:successor.i,priority:successor.priority,scarcity:successor.scarcity
    };
    const successorFit = tryPlaceOnDay(state,successorFill,{allowNetwork:false});
    if(!successorFit)continue;
    // Order rows tolerate at most the existing one-minute boundary fuzz.
    if(fit.placeEnd > successorFit.placeStart + 60000)return false;
  }
  return true;
}

// PURE: does this movable have a feasible fit on `state` that overlaps NO daily-
// breakable reservation window? Such a fit cannot breach any daily breakable's
// target, so the candidate should place here today instead of deferring. This
// mirrors the per-option exemption the ILP reserve already grants
// (agenda-optimizer.js `movable_breakable_reserve`) and brings the fast,
// heuristic-fallback and rescue paths onto the same rule.
function movableFitsOutsideReservations(c,state,candidates){
  if(!c || !c.h || !state)return false;
  if(typeof dailyBreakableReservations !== 'function'
    || typeof breakableReservationWindows !== 'function'
    || typeof placementFitOutsideReservations !== 'function')return false;
  const reservations = dailyBreakableReservations(state,candidates);
  if(!reservations.length)return false;            // no daily breakable → nothing to exempt
  const resWindows = reservations.flatMap(r=>breakableReservationWindows(r));
  if(!resWindows.length)return false;
  const fill = {h:c.h,i:c.i,priority:c.priority,scarcity:c.scarcity};
  const outside = placementFitOutsideReservations(state,fill,resWindows);
  return !!(outside && outsideFitKeepsEarlySuccessors(state,fill,outside,candidates));
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
  // Aggregate breakable-spare is below the duration, yet the movable may still
  // land in a clock gap that touches NO reservation window — it then cannot
  // breach any daily breakable, so place it here today instead of deferring.
  if(typeof movableFitsOutsideReservations === 'function'
    && movableFitsOutsideReservations(c,state,candidates))return false;
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
  const optionMode = typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(fill.h);
  if(optionMode && !fill._scheduleOptionBound && typeof habitSchedulePlacementVariants === 'function'){
    const alternatives = [];
    for(const variant of habitSchedulePlacementVariants(fill,dayBase,registry) || []){
      const result = largestFeasibleBreakableFit(state,variant,remainingMinutes,minChunkMinutes,opts);
      if(result && result.fit)alternatives.push(result.fit);
    }
    if(!alternatives.length)return null;
    alternatives.sort((a,b)=>b.durMin - a.durMin);
    const topDuration = alternatives[0].durMin;
    const best = pickBestScoredFit(
      alternatives.filter(fit=>fit.durMin === topDuration),fill,state,opts);
    return best ? {fit:best,fill} : null;
  }
  const resolveLoc = (anchor)=>Object.prototype.hasOwnProperty.call(fill,'locationId')
    ? fill.locationId
    : pickHabitLocationId(fill.h,anchor,registry,mode,dayBase);
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
        // See tryPlaceOnDay: a finished successor is history, not a ceiling,
        // unless the link demanded "right before" it.
        if(committed && (committed.kind !== 'completed' || e.adjacency === 'direct')){
          orderCeiling = Math.min(orderCeiling,committed.start);
        }
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
      if(locId || optionMode){
        const loc = locId ? registry.find(l=>l.id === locId) : null;
        const intervals = effectiveLocationWindow(fill.h,loc,weekday,dayBase);
        if(!intervals.length)continue;
      }
      const edge = travelEdgeBetweenIds(anchor,locId,registry,mode,{allowNetwork:opts.allowNetwork !== false});
      const travelMin = Math.ceil((edge.seconds || 0) / 60);
      let placeStart = gap.start + (edge.seconds || 0) * 1000;
      let cap = gap.end;
      if(locId || optionMode){
        const loc = locId ? registry.find(l=>l.id === locId) : null;
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
        placeKey:fill.placeKey != null ? fill.placeKey : fill.i,
        schedulePrefLevel:typeof locationPrefLevel === 'function' ? locationPrefLevel(fill.h,locId) : null
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

// PURE: allowed location decisions for an already-timed fill. `null` means the
// item is locationless and preserves the route's current location.
function committedFillLocationChoices(entry,state){
  const h = entry && entry.fill && entry.fill.h;
  const fit = entry && entry.fit;
  if(!h || !fit)return [];
  const optionMode = typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h);
  const ids = optionMode
    ? habitLocationIdsForDay(h,state.dayBase,state.registry)
    : normalizeLocationIds(h.locationIds,state.registry);
  if(Object.prototype.hasOwnProperty.call(entry.fill,'locationId')
    && entry.fill.locationId !== undefined){
    // Explicit null is legal only for genuinely anywhere/locationless work.
    // A malformed replay seed must never erase a required saved location.
    if(entry.fill.locationId !== null
      || (typeof habitHasAnywhereForDay === 'function'
        ? habitHasAnywhereForDay(h,state.dayBase,state.registry)
        : (optionMode ? habitHasAnywhereScheduleOptionForDay(h,state.dayBase) : h.anywhereAllowed))
      || (!optionMode && !ids.length)){
      return [entry.fill.locationId || null];
    }
  }
  // Preserve an explicitly committed legacy/synthetic fit even when its habit
  // record has no locationIds. Normal planner fills derive choices from the
  // habit and therefore still expose every allowed location to the route DP.
  const anywhereAllowed = typeof habitHasAnywhereForDay === 'function'
    ? habitHasAnywhereForDay(h,state.dayBase,state.registry)
    : (optionMode ? habitHasAnywhereScheduleOptionForDay(h,state.dayBase) : h.anywhereAllowed);
  const choices = anywhereAllowed
    ? [null,...ids]
    : (ids.length ? ids : (fit.locId ? [fit.locId] : [null]));
  return choices.filter(locId=>{
    if(!locId)return true;
    const loc = state.registryById
      ? state.registryById.get(locId)
      : state.registry.find(item=>item.id === locId);
    if(!loc)return false;
    const intervals = effectiveLocationWindow(h,loc,state.weekday,state.dayBase);
    const startMin = (fit.placeStart - state.dayBase) / 60000;
    const endMin = (fit.placeEnd - state.dayBase) / 60000;
    return intervals.some(iv=>startMin >= iv.start && endMin <= iv.end);
  });
}

// PURE: dynamic-programming shortest route for the selected clock intervals.
// This is global across the whole day: unlike the old inbound/round-trip
// picker, it considers every allowed location and every committed successor at
// once. Scheduled and blocked work participate as fixed/busy route events, so
// travel can never be hidden underneath them.
function optimalCommittedLocationRoute(state,chron){
  if(!state || !Array.isArray(chron))return null;
  const startClock = Number(state.startClock) || Number(state.dayBase) || 0;
  const initialLoc = locationPresenceAt(state,startClock,[]) || state.seedLocId || null;
  const events = [];

  for(const entry of chron){
    if(!entry || !entry.fit)continue;
    events.push({
      kind:'fill',entry,
      start:entry.fit.placeStart,
      end:entry.fit.placeEnd
    });
  }
  for(const row of state.rows || []){
    if(!row || row.kind !== 'scheduled' || row.end <= startClock)continue;
    events.push({
      kind:'hard',start:Math.max(row.start,startClock),end:row.end,
      locationId:row.locationId || null
    });
  }
  if(typeof agendaBlockedIntervals === 'function' && typeof dateKey === 'function'){
    const dayEnd = state.dayBase + 86400000;
    for(const block of agendaBlockedIntervals(
      dateKey(state.dayBase),state.settings,state.dayBase,dayEnd
    )){
      if(!block || block.end <= startClock)continue;
      events.push({
        kind:'hard',start:Math.max(block.start,startClock),end:block.end,
        locationId:block.locationId || null
      });
    }
  }
  events.sort((a,b)=>a.start - b.start
    || (a.kind === 'hard' ? -1 : 1)
    || a.end - b.end);

  let states = new Map();
  states.set(initialLoc || '',{
    loc:initialLoc,
    end:startClock,
    cost:0,
    travelSeconds:0,
    assignments:new Map(),
    arrivals:new Map(),
    legs:[]
  });

  for(const event of events){
    const next = new Map();
    for(const route of states.values()){
      const choices = event.kind === 'fill'
        ? committedFillLocationChoices(event.entry,state)
        : [event.locationId || null];
      for(const choice of choices){
        const destination = choice || route.loc || null;
        const edge = travelEdgeBetweenIds(
          route.loc,destination,state.registry,state.mode,{allowNetwork:false}
        );
        const travelSeconds = Math.max(0,Number(edge && edge.seconds) || 0);
        // Travel is rendered immediately before the destination. Every event,
        // including a locationless one, advances `end`, so this single check
        // also prevents travel from overlapping work between two locations.
        if(route.end + travelSeconds * 1000 > event.start)continue;

        let cost = route.cost + travelSeconds;
        if(event.kind === 'fill' && choice){
          const h = event.entry.fill.h;
          const fit = event.entry.fit;
          const level = fit && choice === fit.locId && fit.schedulePrefLevel !== undefined
            ? fit.schedulePrefLevel
            : locationPrefLevel(h,choice);
          cost += -locationPrefScore(level) * 30;
          if(route.loc && route.loc === choice)cost -= 60;
        }
        const assignments = new Map(route.assignments);
        if(event.kind === 'fill')assignments.set(event.entry,choice);
        const arrivals = new Map(route.arrivals);
        if(event.kind === 'fill')arrivals.set(event.entry,{
          from:route.loc || null,
          to:choice || null,
          edge,
          travelSeconds
        });
        const legs = route.legs.slice();
        if(travelSeconds > 0 && route.loc && destination && route.loc !== destination){
          legs.push({
            from:route.loc,to:destination,seconds:travelSeconds,
            metres:Number(edge && edge.metres) || 0,
            provider:edge && edge.provider || state.mode,
            start:event.start - travelSeconds * 1000,
            end:event.start,
            entry:event.kind === 'fill' ? event.entry : null
          });
        }
        const key = destination || '';
        const candidate = {
          loc:destination,
          end:Math.max(route.end,event.end),
          cost,
          travelSeconds:route.travelSeconds + travelSeconds,
          assignments,
          arrivals,
          legs
        };
        const prior = next.get(key);
        if(!prior || candidate.cost < prior.cost)next.set(key,candidate);
      }
    }
    if(!next.size)return null;
    states = next;
  }

  let best = null;
  for(const route of states.values()){
    if(!best || route.cost < best.cost)best = route;
  }
  return best;
}

// MUTATE: apply the globally cheapest feasible location chain without changing
// any selected start/end. Returns false if the clock selections themselves do
// not admit a feasible route; callers may then use the defensive repair path.
function optimizeCommittedRouteLocations(state,chron){
  const route = optimalCommittedLocationRoute(state,chron);
  state._committedRoutePlan = route || null;
  if(!route)return false;
  for(const entry of chron){
    if(!entry || !entry.fit || !route.assignments.has(entry))continue;
    entry.fit.locId = route.assignments.get(entry);
    const arrival = route.arrivals.get(entry);
    if(arrival){
      entry.fit.prevLocId = arrival.from;
      entry.fit.edge = arrival.edge;
      entry.fit.travelMin = Math.ceil(arrival.travelSeconds / 60);
    }
  }
  return true;
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
  const routeOptimized = optimizeCommittedRouteLocations(state,chron);
  // Running end of the previous (already-reconciled) fill in clock time. Used
  // to guarantee a commute never starts before the prior fill ends — the
  // out-of-order commit / anchor-drift case where Lunch places at Zuhr.end
  // with a 0-minute commute, then Zuhr inserts at KhadijaM and Lunch's real
  // commute gets drawn backward on top of Zuhr.
  let prevEndMs = null;

  const patchFillRow = (entry,fit)=>{
    const entryChunk = entry.fill && entry.fill.chunkIndex != null
      ? entry.fill.chunkIndex : null;
    for(const r of state.rows || []){
      const rowChunk = r && r.chunkIndex != null ? r.chunkIndex : null;
      if(r && r.kind === 'fill'
        && r.i === (entry.fill && entry.fill.i)
        && rowChunk === entryChunk){
        r.locationId = fit.locId;
        r.start = fit.placeStart;
        r.end = fit.placeEnd;
      }
    }
    for(const item of state.day && state.day.agendaItems || []){
      const itemChunk = item && item.chunkIndex != null ? item.chunkIndex : null;
      if(item && item.i === (entry.fill && entry.fill.i) && itemChunk === entryChunk){
        item.locationId = fit.locId;
      }
    }
  };
  for(let ci = 0; ci < chron.length; ci += 1){
    const entry = chron[ci];
    const fit = entry && entry.fit;
    if(!fit)continue;
    durationMinutes += Math.max(0,Number(fit.durMin) || 0);
    const fitHabit = entry.fill && entry.fill.h;

    const routeArrival = routeOptimized && state._committedRoutePlan
      ? state._committedRoutePlan.arrivals.get(entry) : null;
    const anchor = routeArrival
      ? routeArrival.from
      : locationPresenceAt(state,fit.placeStart,chron);
    const edge = routeArrival
      ? routeArrival.edge
      : travelEdgeBetweenIds(
          anchor,
          fit.locId,
          state.registry,
          state.mode,
          {allowNetwork:false}
        );
    // Re-time guard: if the inbound commute would start before the previous
    // fill ends (out-of-order commit left no room), push this fill forward so
    // the commute fits. Updates the fill row's start/end so homeDaySequence
    // never draws a travel card overlapping a fill.
    const commuteMs = Math.max(0,Number(edge && edge.seconds) || 0) * 1000;
    if(!routeOptimized && prevEndMs != null && fit.placeStart - commuteMs < prevEndMs){
      const pushedStart = prevEndMs + commuteMs;
      // Only push forward when the new slot still sits inside the fill's own
      // hard window end (avoid blowing past the allowed end; if it can't fit,
      // leave the time and let the commute clamp at render instead).
      const newEnd = pushedStart + (Number(fit.durMin) || 0) * 60000;
      const hardEndMs = (()=>{
        if(!fitHabit || typeof hasTimeWindow !== 'function' || !hasTimeWindow(fitHabit))return Infinity;
        const windows = typeof fillDayWindows === 'function'
          ? fillDayWindows(fitHabit,state.dayBase,null) || [] : [];
        const active = windows.find(w=>
          Number(w.start) <= fit.placeStart && fit.placeStart < Number(w.end));
        return active && Number.isFinite(Number(active.end)) ? Number(active.end) : Infinity;
      })();
      if(newEnd <= hardEndMs){
        fit.placeStart = pushedStart;
        fit.placeEnd = newEnd;
        patchFillRow(entry,fit);
      }
    }
    const travelMin = Math.max(0,Math.ceil(Number(edge.seconds || 0) / 60));
    fit.prevLocId = anchor;
    fit.edge = edge;
    fit.travelMin = travelMin;
    patchFillRow(entry,fit);
    travelMinutes += travelMin;
    if(edge.seconds > 0 && anchor && fit.locId && anchor !== fit.locId){
      const from = state.registry.find(l=>l.id === anchor);
      const to = state.registry.find(l=>l.id === fit.locId);
      // Floor travel start at the previous fill's end so a failed re-time
      // (hard window blocked the push) can never paint a commute on top of
      // an earlier fill. Zero-length cards are dropped.
      const travelStart = Math.max(
        fit.placeStart - edge.seconds * 1000,
        state.dayBase,
        prevEndMs || 0
      );
      if(travelStart < fit.placeStart){
        travelRows.push({
          kind:'travel',
          from:anchor,
          to:fit.locId,
          fromName:from ? from.name : '',
          toName:to ? to.name : '',
          seconds:edge.seconds,
          metres:edge.metres || 0,
          start:travelStart,
          end:fit.placeStart,
          provider:edge.provider || state.mode
        });
      }
    }
    if(fit.locId)lastLocId = fit.locId;
    prevEndMs = Math.max(prevEndMs || 0,fit.placeEnd);
  }

  if(routeOptimized && state._committedRoutePlan){
    travelRows.length = 0;
    travelMinutes = 0;
    for(const leg of state._committedRoutePlan.legs){
      const from = state.registry.find(l=>l.id === leg.from);
      const to = state.registry.find(l=>l.id === leg.to);
      travelRows.push({
        kind:'travel',
        from:leg.from,to:leg.to,
        fromName:from ? from.name : '',
        toName:to ? to.name : '',
        seconds:leg.seconds,
        metres:leg.metres,
        start:leg.start,end:leg.end,
        provider:leg.provider || state.mode
      });
      travelMinutes += Math.ceil(leg.seconds / 60);
    }
    lastLocId = state._committedRoutePlan.loc || lastLocId;
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
  // The last append often takes the O(1) commit path. Reconcile once here so
  // every published timeline receives the same whole-day route optimization
  // and invariant check, independent of candidate commit order.
  reconcileCommittedTravel(state);
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
  scheduled.forEach(ev=>{
    const start = scheduledEventStart(ev);
    if(start == null)return;
    blocks.push({start,end:start + clampDuration(ev.h.durationMinutes) * 60000,label:ev.h.name});
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
