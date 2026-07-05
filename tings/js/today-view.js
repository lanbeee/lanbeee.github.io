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
function buildTodayAgenda(data,settings){
  const todayKey = todayIso();
  const scheduled = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>settings.showScheduledTasksInAgenda !== false && h.type === 'task' && h.eventTime !== null && h.lastLog === null && dateKey(h.eventTime) === todayKey)
    .sort(({h:a},{h:b})=>a.eventTime - b.eventTime);
  const totalMinutes = effectiveAvailabilityMinutes(todayKey,settings);
  const slots = buildOpenAgendaSlots(todayKey,scheduled,settings);
  let remaining = slots.reduce((sum,slot)=>sum + Math.max(0,(slot.end - slot.start) / 60000),0);
  const agendaItems = [];
  for(const i of visibleIndices(data,settings)){
    const h = data[i];
    if(h.type === 'task' && h.lastLog !== null)continue;
    if(h.type === 'task' && h.eventTime !== null)continue; // timed tasks are fixed blocks, not soft fills
    if(!includeInTodayAgenda(h,settings))continue;
    const cost = clampDuration(h.durationMinutes);
    if(cost > remaining && agendaItems.length)continue; // skip, keep scanning for a smaller fit
    agendaItems.push({h,i});
    remaining -= cost;
    if(remaining <= 0)break;
  }
  return { scheduled, agendaItems, totalMinutes, usedMinutes:Math.max(0,totalMinutes - remaining), remainingMinutes:Math.max(0,remaining), slots };
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

// PURE: is there still enough unexpired room inside this habit's allowed time
// window today to fit a full session? Windowless habits are always doable.
// preferredTimeStart/End is a soft hint and is intentionally NOT consulted
// here — only the strict allowedTimeStart/End can close a day. Used to keep
// the home list ("today" vs "overdue") and the Today agenda in agreement:
// when the window has closed for today the habit is no longer "today", it is
// overdue, and the agenda stops reserving capacity for it.
function windowStillDoableToday(h,now = Date.now()){
  if(!hasTimeWindow(h))return true;
  const win = fillTimeWindow(h,dayStart(now));
  if(!win)return true;
  const cost = clampDuration(h.durationMinutes) * 60000;
  return win.end - Math.max(now,win.start) >= cost;
}

// PURE: interleave scheduled tasks (hard time) and fill items (soft estimate) into a
// single time-ordered row list. The fill clock starts at "now" and walks
// forward; scheduled tasks jump the clock past their slot so nothing overlaps.
//
// Each open slot retries every still-unplaced item, so an item that is too
// large for one slot can still land in a later, larger one (instead of being
// dropped the first time it misses). Anything left over — typically items
// whose duration is larger than every individual open slot even though the
// day's total availability covers them (the day is fragmented by scheduled
// tasks or blocked time) — gets a soft suggested time stacked after the last
// open slot so the home card always has a pill for them. Windowed items keep
// honouring their own allowedTimeStart/End and stay dropped if no slot can
// host them inside their window.
function buildTodayTimeline(agenda,now = Date.now()){
  const rows = [];
  agenda.scheduled.forEach(ev=>{
    const end = ev.h.eventTime + clampDuration(ev.h.durationMinutes) * 60000;
    rows.push({ kind:'scheduled', h:ev.h, i:ev.i, start:ev.h.eventTime, end, hard:true });
  });
  const slots = agenda.slots?.length ? agenda.slots : [{start:ceilToMinutes(now,5),end:dayStart(now) + 24 * 3600000}];
  const dayBase = dayStart(now);
  const nowFloor = ceilToMinutes(now,5);
  const placed = new Array(agenda.agendaItems.length).fill(false);
  for(const slot of slots){
    let clock = Math.max(slot.start,nowFloor);
    for(let idx = 0; idx < agenda.agendaItems.length; idx += 1){
      if(placed[idx])continue;
      const fill = agenda.agendaItems[idx];
      const cost = clampDuration(fill.h.durationMinutes) * 60000;
      const win = fillTimeWindow(fill.h,dayBase);
      let placeStart, placeEnd, cap;
      if(win){
        placeStart = Math.max(clock,win.start);
        placeEnd = placeStart + cost;
        cap = Math.min(slot.end,win.end);
      }else{
        placeStart = clock;
        placeEnd = clock + cost;
        cap = slot.end;
      }
      if(placeEnd > cap)continue;
      rows.push({ kind:'fill', h:fill.h, i:fill.i, start:placeStart, end:placeEnd, hard:false });
      clock = placeEnd;
      placed[idx] = true;
    }
  }
  if(placed.some(p=>!p)){
    let overflowStart = slots.reduce((max,slot)=>Math.max(max,slot.end),Math.max(dayBase,nowFloor));
    agenda.agendaItems.forEach((fill,idx)=>{
      if(placed[idx])return;
      if(fillTimeWindow(fill.h,dayBase))return;
      const cost = clampDuration(fill.h.durationMinutes) * 60000;
      rows.push({ kind:'fill', h:fill.h, i:fill.i, start:overflowStart, end:overflowStart + cost, hard:false });
      overflowStart += cost;
    });
  }
  return rows.sort((a,b)=>a.start - b.start || (a.kind === 'scheduled' ? -1 : 1));
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
  const total = effectiveAvailabilityMinutes(todayKey,settings);
  let remainingMs = total * 60000;
  const now = Date.now();
  return raw
    .map(slot=>({start:Math.max(slot.start,ceilToMinutes(now,5)),end:slot.end}))
    .filter(slot=>slot.end > slot.start)
    .map(slot=>{
      if(remainingMs <= 0)return null;
      const length = slot.end - slot.start;
      const clipped = {start:slot.start,end:slot.start + Math.min(length,remainingMs)};
      remainingMs -= length;
      return clipped;
    })
    .filter(Boolean);
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
  const meta = row.kind === 'scheduled'
    ? `${dur}m`
    : [h.type === 'task' ? 'task' : 'habit', `${dur}m`].filter(Boolean).join(' · ');
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
