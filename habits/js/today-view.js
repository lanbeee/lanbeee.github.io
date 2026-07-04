// Today agenda — a literal "what does today look like" timeline.
//
// Events (type === 'event') are placed at their literal time. Tasks and habits
// fill the gaps in rank order, each shown with a *soft* estimated range so the
// list reads as "do these roughly in this order" rather than "be here at this
// exact minute." This is the one surface that combines events + tasks + habits
// into something that can replace a calendar and a to-do list.
//
// Annotated for the React Native port, matching list-view/overview-view:
//   - RENDER  -> React functional component
//   - HANDLER -> onPress callback
//   - PURE    -> plain selector / helper

// PURE: today's events + rank-ordered fill items + remaining capacity. Items
// carry their index into `data` so the render layer never has to re-resolve a
// habit's position (which would break by-reference lookups after a re-load).
function buildTodayAgenda(data,settings){
  const todayKey = todayIso();
  const events = data
    .map((h,i)=>({h,i}))
    .filter(({h})=>h.type === 'task' && h.eventTime !== null && h.lastLog === null && dateKey(h.eventTime) === todayKey)
    .sort(({h:a},{h:b})=>a.eventTime - b.eventTime);
  const usedMinutes = events.reduce((sum,{h})=>sum + clampDuration(h.durationMinutes),0);
  const totalMinutes = effectiveAvailabilityMinutes(todayKey,settings);
  let remaining = Math.max(0,totalMinutes - usedMinutes);
  const agendaItems = [];
  for(const i of visibleIndices(data,settings)){
    const h = data[i];
    if(h.type === 'task' && h.lastLog !== null)continue;
    if(h.type === 'task' && h.eventTime !== null)continue; // timed tasks are fixed blocks, not soft fills
    const cost = clampDuration(h.durationMinutes);
    if(cost > remaining && agendaItems.length)continue; // skip, keep scanning for a smaller fit
    agendaItems.push({h,i});
    remaining -= cost;
    if(remaining <= 0)break;
  }
  return { events, agendaItems, totalMinutes, usedMinutes, remainingMinutes:Math.max(0,remaining) };
}

// PURE: interleave events (hard time) and fill items (soft estimate) into a
// single time-ordered row list. The fill clock starts at "now" and walks
// forward; events jump the clock past their slot so nothing overlaps.
function buildTodayTimeline(agenda,now = Date.now()){
  const rows = [];
  let clock = ceilToMinutes(now,5);
  let fillIdx = 0;
  let eventIdx = 0;
  const events = agenda.events;
  const fills = agenda.agendaItems;
  while(fillIdx < fills.length || eventIdx < events.length){
    const ev = events[eventIdx];
    const fill = fills[fillIdx];
    if(ev && (!fill || ev.h.eventTime <= clock)){
      const end = ev.h.eventTime + clampDuration(ev.h.durationMinutes) * 60000;
      rows.push({ kind:'event', h:ev.h, i:ev.i, start:ev.h.eventTime, end, hard:true });
      if(end > clock)clock = end;
      eventIdx += 1;
    }else if(fill){
      const cost = clampDuration(fill.h.durationMinutes) * 60000;
      rows.push({ kind:'fill', h:fill.h, i:fill.i, start:clock, end:clock + cost, hard:false });
      clock += cost;
      fillIdx += 1;
    }else{
      break;
    }
  }
  return rows;
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
  if(agenda.events.length && free <= 0){
    const ev = agenda.events.length === 1 ? '1 event' : `${agenda.events.length} events`;
    return `${ev} fill the day.`;
  }
  const parts = [];
  if(agenda.events.length){
    parts.push(agenda.events.length === 1 ? '1 event' : `${agenda.events.length} events`);
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
      <span>Add a task or mark a habit due today.</span>
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
  const cue = row.kind === 'event' ? eventCue(h) : cardCue(h);
  const dur = clampDuration(h.durationMinutes);
  const softTag = row.kind === 'event'
    ? '<span class="agenda-tag hard">fixed</span>'
    : '<span class="agenda-tag soft">approx</span>';
  const meta = row.kind === 'event'
    ? `${dur}m`
    : [h.type === 'task' ? 'task' : 'habit', `${dur}m`].filter(Boolean).join(' · ');
  return `<button class="agenda-row ${row.kind}${isPast ? ' is-past' : ''} ${toneCls}" data-agenda-idx="${row.i}" style="--card-accent:${accent};">
    <span class="agenda-clock">
      <b>${agendaTimeLabel(row.start)}</b>
      <small>${row.kind === 'event' ? '' : agendaTimeLabel(row.end)}</small>
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
