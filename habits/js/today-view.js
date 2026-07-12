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
function buildTodayTimeline(agenda,now = Date.now()){
  const settings = sortSettings || loadSortSettings();
  const registry = normalizeLocationRegistry(settings.locations);
  const mode = normalizeTravelMode(settings.defaultTravelMode);
  const dayBase = dayStart(now);
  const weekday = new Date(now).getDay();
  const nowFloor = ceilToMinutes(now,5);
  const slots = agenda.slots?.length ? agenda.slots : [{start:nowFloor,end:dayBase + 24 * 3600000}];
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
    let clock = Math.max(slot.start,nowFloor);
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
    let overflowStart = slots.reduce((max,slot)=>Math.max(max,slot.end),Math.max(dayBase,nowFloor));
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

function buildOpenAgendaSlots(todayKey,scheduled,settings){
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
  const now = Date.now();
  // Slots are the day's full OPEN time (open intervals minus blocks/scheduled,
  // clipped to "now"). The availability budget is NOT applied here — it caps
  // task minutes in buildTodayAgenda, not open time. This keeps a late/overnight
  // allowed window (e.g. 10pm-11am) reachable even when today's budget would
  // otherwise be "spent" by idle open time earlier in the day, and lets a block
  // at the window start (e.g. sleep from 10pm) correctly exclude the item.
  return raw
    .map(slot=>({start:Math.max(slot.start,ceilToMinutes(now,5)),end:slot.end}))
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
