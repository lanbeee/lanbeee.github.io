let _stuckHeadersRaf = false;
function updateStuckSectionHeaders(){
  _stuckHeadersRaf = false;
  document.querySelectorAll('.section-header').forEach(el=>{
    el.classList.toggle('stuck', el.getBoundingClientRect().top <= 1);
  });
}
document.addEventListener('scroll',()=>{
  if(_stuckHeadersRaf)return;
  _stuckHeadersRaf = true;
  requestAnimationFrame(updateStuckSectionHeaders);
},{passive:true,capture:true});

function appendSectionHeader(list,label,dayContext = null,todayHids = null){
  if(!list || !label)return;
  const header = document.createElement('div');
  header.className = 'section-header';
  header.dataset.label = label;
  header.textContent = label;
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  if(!minimal && dayContext && dayContext.dayBase != null){
    setupDayCapacityHeader(header,dayContext.dayBase,true);
    attachFreeTimeIndicator(header,dayContext);
  }else if(!minimal && label === 'today'){
    setupDayCapacityHeader(header,dayStart(Date.now()),false);
  }
  if(!minimal && label === 'today' && todayHids){
    attachDroppedIndicator(header,list,todayHids);
  }
  list.appendChild(header);
}

function computeTomorrowProjection(data,settings){
  if(typeof buildWeekAgenda !== 'function')return [];
  const week = buildWeekAgenda(data,settings,2);
  const tomorrow = week.days[1];
  if(!tomorrow || !tomorrow.timeline)return [];
  return tomorrow.timeline
    .filter(r=>(r.kind === 'fill' || r.kind === 'scheduled') && r.i != null)
    .map(r=>data[r.i]?.hid)
    .filter(Boolean);
}

function buildHidDayLabelMap(data,settings){
  const map = new Map();
  const week = _homeRenderedWeek;
  if(week && Array.isArray(week.days)){
    for(const day of week.days){
      const label = homeWeekDayLabel(day);
      const rows = day.homeDisplayedTimeline || day.timeline || [];
      for(const row of rows){
        if((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null){
          const hid = data[row.i]?.hid;
          if(hid && !map.has(hid)) map.set(hid, `in ${label}`);
        }
      }
    }
  }
  const catLabels = {0:'on today',1:'behind',2:'coming up',3:'snoozed'};
  for(let i = 0; i < data.length; i++){
    const h = data[i];
    if(!h || !h.hid || map.has(h.hid)) continue;
    map.set(h.hid, catLabels[todayCategory(h, settings)] || 'behind');
  }
  return map;
}

function attachDroppedIndicator(header,list,todayHids){
  const data = load();
  const now = Date.now();
  const snap = loadTodaySuggested();
  const today = todayIso();
  if(_droppedDayBaselineDay !== today){
    _droppedDayBaseline = snap.prevProjection || null;
    _droppedDayBaselineDay = today;
  }
  const fingerprint = dataFingerprint(data);
  const needsProjection = !snap.projection
    || snap.projection.day !== dateKey(now + 86400000)
    || snap.projection.fingerprint !== fingerprint;
  const projectionHids = needsProjection ? computeTomorrowProjection(data,sortSettings) : null;
  recordTodaySuggested(data,todayHids,now,projectionHids,fingerprint);

  const currentSet = new Set(todayHids);
  const droppedMap = new Map();
  const addMissed = (hid,name,emoji,idx,first)=>{
    if(droppedMap.has(hid))return;
    const h = data[idx];
    if(!h)return;
    const snoozed = Boolean(h.snoozedUntil && now < h.snoozedUntil);
    droppedMap.set(hid,{hid,name,emoji:emoji || h.emoji,idx,snoozed,first});
  };

  if(_droppedDayBaseline && Array.isArray(_droppedDayBaseline.hids)){
    for(const hid of _droppedDayBaseline.hids){
      if(currentSet.has(hid))continue;
      const idx = data.findIndex(h=>h && h.hid === hid);
      if(idx < 0)continue;
      const h = data[idx];
      if(completedToday(h,now))continue;
      if(todayCategory(h,sortSettings) === 0)continue;
      addMissed(hid,h.name,h.emoji,idx,now);
    }
  }

  for(const [hid,info] of Object.entries(snap.hids)){
    if(currentSet.has(hid))continue;
    const idx = data.findIndex(h=>h && h.hid === hid);
    if(idx < 0)continue;
    const h = data[idx];
    if(completedToday(h,now))continue;
    addMissed(hid,info.name || h.name,h.emoji,idx,info.first);
  }

  for(let i = 0; i < data.length; i++){
    const h = data[i];
    if(!h || !h.hid || currentSet.has(h.hid) || droppedMap.has(h.hid))continue;
    if(completedToday(h,now))continue;
    if(todayCategory(h,sortSettings) !== 1)continue;
    addMissed(h.hid,h.name,h.emoji,i,now);
  }

  const dropped = [...droppedMap.values()]
    .sort((a,b)=>Number(a.snoozed) - Number(b.snoozed) || a.first - b.first);
  if(!dropped.length)return;
  header.classList.add('has-dropped');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'dropped-pill';
  pill.textContent = `${dropped.length} missed`;
  bindDayHeaderPill(pill,()=>openSlippedSheet(dropped,header.dataset.label || 'today'));
  header.appendChild(pill);
}

function renderDroppedPanel(items,opts = {}){
  const showDayTag = Boolean(opts.showDayTag);
  const panel = document.createElement('div');
  panel.className = 'dropped-panel';
  const data = load();
  items.forEach(item=>{
    const h = data[item.idx];
    // The row is a div (not a button) so the log affordance below can be its
    // own button. Tapping anywhere on the row except the icon still reviews.
    const row = document.createElement('div');
    row.className = 'dropped-item' + (item.snoozed ? ' snoozed' : '');
    row.setAttribute('role','button');
    row.setAttribute('tabindex','0');
    row.dataset.hid = item.hid || '';
    const tagHtml = item.snoozed
      ? '<span class="dropped-tag">snoozed</span>'
      : (showDayTag && item.dayLabel ? `<span class="dropped-tag">${escapeHtml(item.dayLabel)}</span>` : '');

    // Icon = the same pulse affordance as a card (colored tile + "+" badge), so
    // a missed habit can be cleared with one tap straight from this list.
    const c = (h && typeof colors === 'function')
      ? colors(daysSince(h.lastLog),h.target,h.type)
      : { bg:'var(--bg)', icon:'var(--amber-icon)' };
    const hasEmojiBg = h && typeof normalizeEmojiBgColor === 'function' && normalizeEmojiBgColor(h.emojiBgColor);
    const logStyle = (h && typeof emojiBgInlineStyle === 'function' && (h.emoji || hasEmojiBg))
      ? emojiBgInlineStyle(h,c.bg,c.icon)
      : `background:${c.bg};color:${c.icon};`;
    const logInner = h ? iconHtml(h,c) : '<i class="ti ti-circle-dashed" aria-hidden="true"></i>';
    row.innerHTML =
      `<button type="button" class="dropped-mark dropped-log${h && h.emoji ? ' emoji-pulse' : ''}" aria-label="${h && h.type === 'task' ? 'complete' : 'log'} ${escapeHtml(item.name)}" style="${logStyle}">${logInner}</button>`
      + `<span class="dropped-copy"><span class="dropped-name">${escapeHtml(item.name)}</span><small>Tap to review</small></span>`
      + `${tagHtml}<i class="ti ti-chevron-right dropped-chevron" aria-hidden="true"></i>`;

    const review = ()=>{ closeSheet('slipped-sheet'); openDetail(item.idx); };
    row.addEventListener('click',e=>{ if(e.target.closest('.dropped-log'))return; review(); });
    row.addEventListener('keydown',e=>{
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); review(); }
    });

    const finishLog = ()=>{
      // The habit is now completedToday, so it no longer belongs here. Drop the
      // row at once; if the sheet is empty, dismiss it. Then refresh home so the
      // "missed" pill recount follows the log without a cold restart.
      row.remove();
      if(!document.querySelector('#slipped-content .dropped-item'))closeSheet('slipped-sheet');
      if(typeof refreshOpenViews === 'function')refreshOpenViews();
      if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
    };
    row.querySelector('.dropped-log').addEventListener('click',e=>{
      e.stopPropagation();
      if(!load()[item.idx])return;
      if(typeof logTing === 'function' && logTing(item.idx))finishLog();
    });

    panel.appendChild(row);
  });
  return panel;
}

function openSlippedSheet(items,dayLabel){
  const content = document.getElementById('slipped-content');
  if(!content)return;
  document.getElementById('slipped-title').textContent = `missed · ${dayLabel}`;
  content.innerHTML = '';

  const data = load();
  const dayLabelMap = buildHidDayLabelMap(data,sortSettings);

  const slippedWithTags = items.map(item=>({
    ...item,
    dayLabel: dayLabelMap.get(item.hid) || 'behind'
  }));

  if(slippedWithTags.length){
    const head1 = document.createElement('div');
    head1.className = 'slipped-section-head';
    head1.textContent = `missed · ${dayLabel}`;
    content.appendChild(head1);
    content.appendChild(renderDroppedPanel(slippedWithTags,{showDayTag:true}));
  }

  openSheet('slipped-sheet');
}

function formatFreeDuration(minutes){
  const m = Math.max(0, Math.round(minutes));
  if(m < 60)return `${m}m`;
  const hours = m / 60;
  if(hours < 4){
    const rounded = Math.round(hours * 2) / 2;
    return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
  }
  return `${Math.round(hours)}h`;
}

function freeDayClockLabel(ts){
  const d = new Date(ts);
  return formatTimeShort(d.getHours() * 60 + d.getMinutes());
}

// PURE: hour tick marks for the free/busy day strip.
function freeDayTickMarks(windowStart,windowEnd){
  if(!(windowEnd > windowStart))return [];
  const spanMs = windowEnd - windowStart;
  const spanHours = spanMs / 3600000;
  const stepHours = spanHours <= 8 ? 1 : spanHours <= 14 ? 2 : 3;
  const ticks = [{ts:windowStart,edge:'start'}];
  const cursor = new Date(windowStart);
  cursor.setSeconds(0,0);
  cursor.setMinutes(0);
  cursor.setHours(cursor.getHours() + 1);
  while(cursor.getTime() < windowEnd){
    const ts = cursor.getTime();
    const pct = (ts - windowStart) / spanMs;
    if(pct > 0.08 && pct < 0.92 && cursor.getHours() % stepHours === 0){
      ticks.push({ts,edge:null});
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  ticks.push({ts:windowEnd,edge:'end'});
  return ticks;
}

function renderFreeDayStrip(info,onPick){
  const wrap = document.createElement('div');
  wrap.className = 'free-day-strip';
  const winStart = info.windowStart;
  const winEnd = info.windowEnd;
  if(!(winEnd > winStart))return wrap;

  const span = winEnd - winStart;
  const pieces = [];
  let cursor = winStart;
  const busy = [...(info.busy || [])].sort((a,b)=>a.start - b.start);
  for(const block of busy){
    const start = Math.max(block.start,winStart);
    const end = Math.min(block.end,winEnd);
    if(end <= start)continue;
    if(start > cursor)pieces.push({kind:'free',start:cursor,end:start});
    pieces.push({kind:'busy',start,end});
    cursor = Math.max(cursor,end);
  }
  if(cursor < winEnd)pieces.push({kind:'free',start:cursor,end:winEnd});

  wrap.setAttribute('role',typeof onPick === 'function' ? 'group' : 'img');
  wrap.setAttribute(
    'aria-label',
    `${formatFreeDuration(info.totalFreeMinutes)} open · ${formatFreeDuration(info.largestGapMinutes)} biggest stretch`
  );

  const track = document.createElement('div');
  track.className = 'free-day-track';
  if(!pieces.length){
    const seg = document.createElement('span');
    seg.className = 'free-day-seg free';
    seg.style.flex = '1';
    track.appendChild(seg);
  }else{
    pieces.forEach(piece=>{
      const seg = document.createElement(typeof onPick === 'function' ? 'button' : 'span');
      seg.className = `free-day-seg ${piece.kind}`;
      if(seg.tagName === 'BUTTON')seg.type = 'button';
      seg.style.flex = String(Math.max(1, piece.end - piece.start));
      const mins = Math.round((piece.end - piece.start) / 60000);
      seg.title = `${piece.kind === 'busy' ? 'busy' : 'open'} · ${freeDayClockLabel(piece.start)} – ${freeDayClockLabel(piece.end)} · ${formatFreeDuration(mins)}`;
      if(typeof onPick === 'function'){
        seg.setAttribute('aria-label',`${piece.kind === 'busy' ? 'check busy stretch' : 'select open stretch'}, ${freeDayClockLabel(piece.start)} to ${freeDayClockLabel(piece.end)}`);
        seg.addEventListener('click',()=>onPick(piece.start,piece.end,seg));
      }
      track.appendChild(seg);
    });
  }
  wrap.appendChild(track);

  const ticks = document.createElement('div');
  ticks.className = 'free-day-ticks';
  freeDayTickMarks(winStart,winEnd).forEach(tick=>{
    const mark = document.createElement('span');
    mark.className = 'free-day-tick' + (tick.edge ? ` edge-${tick.edge}` : '');
    mark.style.left = `${((tick.ts - winStart) / span) * 100}%`;
    mark.textContent = freeDayClockLabel(tick.ts);
    ticks.appendChild(mark);
  });
  wrap.appendChild(ticks);

  const legend = document.createElement('div');
  legend.className = 'free-day-legend';
  legend.innerHTML = '<span><i class="busy" aria-hidden="true"></i>busy</span><span><i class="open" aria-hidden="true"></i>open</span>';
  wrap.appendChild(legend);
  return wrap;
}

function attachFreeTimeIndicator(header,day){
  if(typeof computeDayFreeGaps !== 'function')return;
  const info = computeDayFreeGaps(day,sortSettings);
  if(info.totalFreeMinutes < 10)return;
  header.classList.add('has-pill');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'free-pill';
  pill.textContent = `${formatFreeDuration(info.totalFreeMinutes)} open`;
  bindDayHeaderPill(pill,()=>openFreeTimeSheet(info,header.dataset.label || 'today'));
  header.appendChild(pill);
}

// WIRE: day-header open/missed pills. Activation must be click-based so the
// document forgiving-button path (near-miss drift / pointercancel → btn.click)
// works. pointerup-only missed those taps because capture-phase forgiving
// stopPropagation prevented the pill's pointerup from firing. Stop pointer
// bubbling so sticky-header capacity triple-tap does not count pill presses.
function bindDayHeaderPill(pill,open){
  if(!pill || typeof open !== 'function')return;
  pill.addEventListener('pointerdown',e=>e.stopPropagation());
  pill.addEventListener('pointerup',e=>e.stopPropagation());
  pill.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    open();
  });
}

function freeWindowInputValue(ts){
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function freeWindowTimestamp(info,value){
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if(!match)return null;
  const base = new Date(info.windowStart);
  base.setHours(Number(match[1]),Number(match[2]),0,0);
  return base.getTime();
}

function freeWindowDefault(info){
  const base = new Date(info.windowStart);
  const dayBase = dayStart(base.getTime());
  let start = dayBase + 17 * 3600000;
  if(info.windowStart > start){
    start = Math.ceil(info.windowStart / 1800000) * 1800000;
  }
  start = Math.min(start,dayBase + 22.5 * 3600000);
  return {start,end:Math.min(dayBase + 24 * 3600000 - 60000,start + 90 * 60000)};
}

function freeWindowOverlapMinutes(gaps,start,end){
  return (gaps || []).reduce((sum,gap)=>{
    const overlap = Math.max(0,Math.min(end,gap.end) - Math.max(start,gap.start));
    return sum + Math.round(overlap / 60000);
  },0);
}

function weekFillMinutesForDay(week,dayBase){
  const day = week && Array.isArray(week.days) && week.days.find(item=>item.dayBase === dayBase);
  const minutes = new Map();
  for(const row of day && day.timeline || []){
    if(row.kind !== 'fill' || row.i == null)continue;
    minutes.set(row.i,(minutes.get(row.i) || 0) + Math.max(0,Math.round((row.end - row.start) / 60000)));
  }
  return minutes;
}

function weekPlacementDayForIndex(week,index,exceptDay){
  const days = (week && week.days || []).filter(day=>day.dayBase !== exceptDay && (day.timeline || []).some(row=>row.kind === 'fill' && row.i === index));
  return days.length ? days.sort((a,b)=>a.dayBase - b.dayBase)[0].dayBase : null;
}

function fixedConflictForWindow(dayBase,start,end,settings,baselineDay){
  const blocks = typeof agendaBlockedIntervals === 'function'
    ? agendaBlockedIntervals(dateKey(dayBase),settings,dayBase,dayBase + 86400000)
    : [];
  const fixed = blocks.map(block=>({start:block.start,end:block.end,name:block.label || 'busy time'}));
  for(const row of baselineDay && baselineDay.timeline || []){
    if(row.kind === 'scheduled')fixed.push({start:row.start,end:row.end,name:row.h?.name || row.name || 'fixed plan'});
  }
  return fixed.find(item=>item.start < end && item.end > start) || null;
}

async function analyzeFreeWindow(info,start,end){
  const duration = Math.max(0,Math.round((end - start) / 60000));
  const openMinutes = freeWindowOverlapMinutes(info.gaps,start,end);
  if(openMinutes >= duration){
    return {tone:'open',icon:'check',title:'Already open',copy:`All ${formatFreeDuration(duration)} are available now.`};
  }

  const data = load();
  const settings = sortSettings || loadSortSettings();
  const dayBase = dayStart(info.windowStart);
  let baseline = _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days) ? _homeRenderedWeek : null;
  if(!baseline){
    baseline = typeof buildWeekAgendaOffMain === 'function'
      ? await buildWeekAgendaOffMain(data,settings,7,settings.agendaOptimizer ? 'exact' : 'fast')
      : buildWeekAgenda(data,settings,7);
    if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(baseline,data);
  }
  const baselineDay = baseline.days.find(day=>day.dayBase === dayBase);
  const fixed = fixedConflictForWindow(dayBase,start,end,settings,baselineDay);
  if(fixed){
    return {tone:'blocked',icon:'lock',title:'Not movable as planned',copy:`This overlaps ${fixed.name}, which is fixed on the day.`};
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const whatIfBlock = {
    label:'time check',
    days:[startDate.getDay()],
    start:startDate.getHours() * 60 + startDate.getMinutes(),
    end:endDate.getHours() * 60 + endDate.getMinutes()
  };
  // Put the temporary reservation first so it is retained even when a user
  // already has the maximum number of recurring busy-time rules.
  const hypotheticalSettings = {...settings,blockedTimes:[whatIfBlock,...normalizeBlockedTimes(settings.blockedTimes)]};
  let hypothetical = typeof buildWeekAgendaOffMain === 'function'
    ? await buildWeekAgendaOffMain(data,hypotheticalSettings,7,settings.agendaOptimizer ? 'exact' : 'fast')
    : buildWeekAgenda(data,hypotheticalSettings,7);
  if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(hypothetical,data);

  const before = weekFillMinutesForDay(baseline,dayBase);
  const after = weekFillMinutesForDay(hypothetical,dayBase);
  const displaced = [...before.entries()].filter(([index,minutes])=>(after.get(index) || 0) < minutes);
  if(!displaced.length){
    const movedNames = [...before.keys()].filter(index=>{
      const oldRows = (baselineDay?.timeline || []).filter(row=>row.kind === 'fill' && row.i === index);
      const nextDay = hypothetical.days.find(day=>day.dayBase === dayBase);
      const newRows = (nextDay?.timeline || []).filter(row=>row.kind === 'fill' && row.i === index);
      return oldRows.some((row,i)=>!newRows[i] || Math.abs(row.start - newRows[i].start) > 60000);
    }).map(index=>data[index]?.name).filter(Boolean).slice(0,2);
    const detail = movedNames.length ? ` It would move ${movedNames.join(' and ')} within the day.` : '';
    return {tone:'possible',icon:'arrows-shuffle',title:'Can be made open',copy:`The planner can keep everything on this day.${detail}`};
  }

  const later = [];
  const unscheduled = [];
  for(const [index] of displaced){
    const destination = weekPlacementDayForIndex(hypothetical,index,dayBase);
    const name = data[index]?.name || 'an item';
    if(destination != null && destination > dayBase)later.push({name,destination});
    else unscheduled.push(name);
  }
  if(later.length){
    const first = later[0];
    const dayLabel = homeWeekDayLabel({dayBase:first.destination,weekday:new Date(first.destination).getDay(),isToday:false,offset:Math.round((first.destination-dayStart(Date.now()))/86400000)}).toLowerCase();
    return {tone:'spill',icon:'arrow-forward-up',title:'Would spill into a later day',copy:`Making this space would move ${first.name}${later.length > 1 ? ` and ${later.length - 1} more` : ''} to ${dayLabel}.`};
  }
  return {tone:'spill',icon:'calendar-off',title:'Doesn’t fit cleanly',copy:`Making this space would push ${unscheduled.slice(0,2).join(' and ') || 'planned work'} out of this day.`};
}

function renderFreeWindowChecker(info){
  const checker = document.createElement('section');
  checker.className = 'free-fit-checker';
  checker.setAttribute('aria-label','check whether a time can be made open');
  const initial = freeWindowDefault(info);
  checker.innerHTML = `
    <button type="button" class="free-fit-toggle" aria-expanded="false" aria-controls="free-fit-body">
      <span class="free-fit-toggle-icon"><i class="ti ti-sparkles" aria-hidden="true"></i></span>
      <span class="free-fit-toggle-copy"><b>Could I make room?</b><small>Test a time without changing anything</small></span>
      <i class="ti ti-chevron-down free-fit-chevron" aria-hidden="true"></i>
    </button>
    <div class="free-fit-body" id="free-fit-body" hidden>
      <div class="free-fit-fields">
        <label><span>from</span><input class="free-fit-start" type="time" step="900" value="${freeWindowInputValue(initial.start)}" /></label>
        <i class="ti ti-arrow-right" aria-hidden="true"></i>
        <label><span>to</span><input class="free-fit-end" type="time" step="900" value="${freeWindowInputValue(initial.end)}" /></label>
        <button type="button" class="free-fit-run">check</button>
      </div>
      <div class="free-fit-result" role="status" aria-live="polite"><i class="ti ti-pointer" aria-hidden="true"></i><span><b>Choose a time</b><small>Or tap a section of the timeline above.</small></span></div>
    </div>`;
  const toggle = checker.querySelector('.free-fit-toggle');
  const body = checker.querySelector('.free-fit-body');
  const startInput = checker.querySelector('.free-fit-start');
  const endInput = checker.querySelector('.free-fit-end');
  const run = checker.querySelector('.free-fit-run');
  const result = checker.querySelector('.free-fit-result');
  const setExpanded = expanded=>{
    checker.classList.toggle('is-expanded',expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    body.hidden = !expanded;
    const chevron = toggle.querySelector('.free-fit-chevron');
    if(chevron)chevron.className = `ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'} free-fit-chevron`;
  };
  toggle.addEventListener('click',()=>setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
  let request = 0;
  const check = async()=>{
    const start = freeWindowTimestamp(info,startInput.value);
    let end = freeWindowTimestamp(info,endInput.value);
    if(start != null && end != null && end <= start && endInput.value === '00:00')end += 86400000;
    if(start == null || end == null || end <= start){
      result.className = 'free-fit-result blocked';
      result.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i><span><b>Check the times</b><small>The end needs to be after the start.</small></span>';
      return;
    }
    const token = ++request;
    run.disabled = true;
    result.className = 'free-fit-result checking';
    result.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i><span><b>Checking the day…</b><small>Testing a rearranged plan without saving it.</small></span>';
    try{
      const answer = await analyzeFreeWindow(info,start,end);
      if(token !== request)return;
      result.className = `free-fit-result ${answer.tone}`;
      result.innerHTML = `<i class="ti ti-${answer.icon}" aria-hidden="true"></i><span><b>${escapeHtml(answer.title)}</b><small>${escapeHtml(answer.copy)}</small></span>`;
    }catch(_){
      if(token !== request)return;
      result.className = 'free-fit-result blocked';
      result.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i><span><b>Couldn’t check this window</b><small>Your current open stretches are still shown above.</small></span>';
    }finally{
      if(token === request)run.disabled = false;
    }
  };
  run.addEventListener('click',check);
  [startInput,endInput].forEach(input=>input.addEventListener('change',()=>{ result.className = 'free-fit-result'; result.innerHTML = '<i class="ti ti-arrow-right" aria-hidden="true"></i><span><b>Ready to check</b><small>This won’t change your plan.</small></span>'; }));
  checker.pickWindow = (start,end)=>{
    setExpanded(true);
    startInput.value = freeWindowInputValue(start);
    endInput.value = freeWindowInputValue(end);
    void check();
  };
  return checker;
}

function renderFreePanel(info){
  const panel = document.createElement('div');
  panel.className = 'free-panel';
  const summary = document.createElement('div');
  summary.className = 'free-panel-row free-panel-hero';
  summary.innerHTML = `<span class="free-panel-metric"><small>total room</small><b>${escapeHtml(formatFreeDuration(info.totalFreeMinutes))} open</b></span><span class="free-panel-metric"><small>biggest stretch</small><b>${escapeHtml(formatFreeDuration(info.largestGapMinutes))}</b></span>`;
  panel.appendChild(summary);
  const checker = renderFreeWindowChecker(info);
  panel.appendChild(renderFreeDayStrip(info,(start,end)=>checker.pickWindow(start,end)));
  panel.appendChild(checker);
  const bigGaps = info.gaps.filter(g=>Math.round((g.end - g.start) / 60000) >= 30);
  const shortMinutes = info.totalFreeMinutes - bigGaps.reduce((s,g)=>s + Math.round((g.end - g.start) / 60000),0);
  bigGaps.forEach(g=>{
    const mins = Math.round((g.end - g.start) / 60000);
    const sd = new Date(g.start), ed = new Date(g.end);
    const startLabel = formatTimeShort(sd.getHours() * 60 + sd.getMinutes());
    const endLabel = formatTimeShort(ed.getHours() * 60 + ed.getMinutes());
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'free-panel-row free-gap-row';
    row.innerHTML = `<span class="free-gap-icon"><i class="ti ti-sun" aria-hidden="true"></i></span><span class="free-gap-copy"><b>${escapeHtml(startLabel)} – ${escapeHtml(endLabel)}</b><small>available stretch</small></span><span class="free-panel-value">${escapeHtml(formatFreeDuration(mins))}</span>`;
    row.setAttribute('aria-label',`check ${startLabel} to ${endLabel}, ${formatFreeDuration(mins)} open`);
    row.addEventListener('click',()=>checker.pickWindow(g.start,g.end));
    panel.appendChild(row);
  });
  if(shortMinutes >= 10){
    const note = document.createElement('div');
    note.className = 'free-panel-note';
    note.textContent = `+ ${formatFreeDuration(shortMinutes)} in shorter stretches`;
    panel.appendChild(note);
  }
  return panel;
}

function openFreeTimeSheet(info,dayLabel){
  const content = document.getElementById('free-time-content');
  if(!content)return;
  document.getElementById('free-time-title').textContent = `open time ${dayLabel}`;
  content.innerHTML = '';
  content.appendChild(renderFreePanel(info));
  openSheet('free-time-sheet');
}

// PURE: reduce trail tones to one
function summarizeTrailTone(tones){
  if(!tones.length)return '';
  if(tones.includes('plan'))return 'plan';
  if(tones.includes('miss'))return 'miss';
  if(tones.includes('warn'))return 'warn';
  if(tones.includes('hit'))return 'hit';
  return '';
}

// PURE: whether home should lay out day by day. Minimal mode always falls back
// to the today / overdue / coming up grouping, whatever the toggle says.
function weekOnHomeEnabled(settings){
  const s = settings || sortSettings || {};
  return !s.minimalMode && Boolean(s.showWeekOnHome);
}

// RENDER: render the full habit list.
//
// `opts.deferAgenda` (default false): compatibility path that skips expensive
// agenda work and emits a basic grouped list. Normal home renders reuse a
// same-day plan cache, then refresh either planner in a worker.
function render(opts){
  const o = opts || {};
  const list = $('list');
  const empty = $('empty');
  const data = load();
  if(!sortSettings && typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  const wantsPlannedWeek = !o.deferAgenda
    && !o.__optimizedWeek
    && !o.__optimizerFallback
    && sortSettings.preset === 'todayFirst'
    && weekOnHomeEnabled(sortSettings)
    && !searchQuery.trim()
    && typeof buildWeekAgendaOffMain === 'function';
  if(wantsPlannedWeek){
    queueOptimizedHomeRender(data,o);
    return false;
  }
  const readingPosition = o.preserveReadingPosition === false
    ? null
    : captureHomeReadingPosition(list);
  _homeRenderedWeek = null;
  list.innerHTML = '';
  empty.onclick = null;
  // Search is habit lookup — the quota bar can't move while typing (only a
  // save() changes stored size, and save() refreshes the bar itself), so skip
  // the full-dataset JSON.stringify it costs per keystroke render.
  const searching = Boolean(searchQuery.trim());
  if(!searching)updateQuotaBar(sizeKb(data));
  updateSortButton();
  updateSearchUi();

  // One shared sort pass: empty-state logic, the filter sheet counts, and the
  // match list all consume the same visibleIndices(data) order.
  const visible = visibleIndices(data);
  const indices = filteredVisibleIndices(data,visible);
  renderHomeTagFilter(data,visible);
  if(!indices.length){
    empty.style.display = 'block';
    if(typeof renderWeekOnHome === 'function')renderWeekOnHome();
    const hasSearch = searchQuery.trim().length > 0;
    const hasTopicFilter = homeTopicFilter && homeTopicFilter !== 'all';
    const hasLocationFilter = homeLocationFilter && homeLocationFilter !== 'all';
    empty.classList.toggle('is-action',data.length > 0 && !sortSettings.showSnoozed && !hasSearch);
    if(hasSearch){
      empty.innerHTML = 'no matches<br><span class="empty-sub">try a habit name, topic, or place</span>';
    }else if(hasTopicFilter || hasLocationFilter){
      const topicLabel = homeTopicFilter === '__none__' ? 'no topic' : homeTopicFilter;
      const loc = typeof locationById === 'function' ? locationById(homeLocationFilter) : null;
      const locLabel = homeLocationFilter === '__none__' ? 'anywhere' : (loc ? loc.name : homeLocationFilter);
      const label = hasTopicFilter && hasLocationFilter
        ? `${topicLabel} · ${locLabel}`
        : (hasTopicFilter ? topicLabel : locLabel);
      empty.innerHTML = `no habits in ${escapeHtml(label)}<br><span class="empty-sub">tap a filter above to change it</span>`;
      empty.onclick = ()=>{
        homeTopicFilter = 'all';
        homeLocationFilter = 'all';
        render();
      };
    }else if(data.length && !sortSettings.showSnoozed && !visible.length && data.some(h=>h.snoozedUntil && Date.now() < h.snoozedUntil)){
      empty.innerHTML = 'hidden for now<br><span class="empty-sub">tap to show</span>';
      empty.onclick = ()=>{
        saveSortSettings({...sortSettings,showSnoozed:true});
        syncSettingsControls();
        render();
      };
    }else if(data.length && !visible.length){
      const doneTasks = data.filter(h=>h.type === 'task' && isTaskDone(h)).length;
      empty.innerHTML = doneTasks && doneTasks === data.length
        ? 'all clear<br><span class="empty-sub">completed tasks stay searchable; use + to add what is next</span>'
        : 'nothing active<br><span class="empty-sub">use Calendar for scheduled items, or + to add a habit</span>';
    }else{
      empty.innerHTML = 'habits, tasks, and planning<br><span class="empty-sub">Saved on this device. Tap Tings for help and settings, + to add, or tap here to try samples.</span>';
      empty.classList.add('is-action');
      empty.onclick = ()=>{
        if(typeof openSampleHabitsSheet === 'function')openSampleHabitsSheet();
        else if(typeof openSheet === 'function')openSheet('about-sheet');
      };
    }
    _homeListFingerprint = homeListFingerprint();
    restoreHomeReadingPosition(readingPosition,list);
    return;
  }
  empty.classList.remove('is-action');
  empty.style.display = 'none';

  const todayFirstActive = sortSettings.preset === 'todayFirst';
  // `searching` was computed above (before the quota bar) — search is habit
  // lookup, so skip week-plan chrome (blocked times, travel, day sections) and
  // render just matching habits, ranked by relevance.
  const deferAgenda = Boolean(o.deferAgenda);
  const weekMode = !deferAgenda && todayFirstActive
    && weekOnHomeEnabled(sortSettings)
    && !searching
    && typeof buildWeekAgenda === 'function'
    && typeof homeDaySequence === 'function';
  // homeEarlyMap calls earlyReason per item, which in turn may invoke the
  // today agenda pipeline. Defer it on progressive renders — it is only used
  // to surface an "early" pill on cards that pulled forward, and that pill is
  // not part of the first paint.
  // Search is pure habit lookup — it never needs the "early" pill or any
  // agenda placement, so skip the planner pipeline entirely while searching
  // (homeEarlyMap calls earlyReason per item, which drives the today agenda).
  const earlyMap = (deferAgenda || searching) ? new Map() : homeEarlyMap(data,sortSettings);
  const visibleSet = new Set(indices);
  // Earliest today-timeline fill/scheduled row per breakable habit. The slider
  // belongs on that row only — not on later chunks, and not on a pinned/
  // leftover card that happens to render earlier in the DOM.
  const breakablePrimaries = new Map();
  const breakableCatchupShown = new Set();

  const noteBreakablePrimary = (realIdx,row)=>{
    if(realIdx == null || !row || !data[realIdx]?.breakable)return;
    const prev = breakablePrimaries.get(realIdx);
    if(!prev){
      breakablePrimaries.set(realIdx,row);
      return;
    }
    if(Number.isFinite(row.start) && Number.isFinite(prev.start) && row.start < prev.start){
      breakablePrimaries.set(realIdx,row);
    }
  };

  const isBreakableSliderRow = (realIdx,agendaRow)=>{
    const h = data[realIdx];
    if(!h || !h.breakable)return false;
    const primary = breakablePrimaries.get(realIdx);
    if(primary){
      if(!agendaRow)return false;
      // Start time uniquely identifies the today timeline instance (chunkIndex
      // alone collides across week days — every day can have chunkIndex 0).
      if(Number.isFinite(primary.start) && Number.isFinite(agendaRow.start)){
        return primary.start === agendaRow.start;
      }
      if(primary.chunkIndex != null && agendaRow.chunkIndex != null){
        return primary.chunkIndex === agendaRow.chunkIndex;
      }
      return primary === agendaRow;
    }
    // No today timeline placement (progressive paint, unplaced leftover, or
    // only later-day chunks because today is already full): allow one catch-up
    // slider on the first card we render for this habit.
    if(breakableCatchupShown.has(realIdx))return false;
    breakableCatchupShown.add(realIdx);
    return true;
  };

  const appendHabitCard = (realIdx,agendaRow,earlyReasonText,dayBase = null,scheduleLinkReason = '')=>{
    const h = data[realIdx];
    const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const cardScore = progressScore(h);
    const cardScoreTone = cardTone(h);
    const cue = cardCue(h);
    const agendaPill = minimal ? '' : agendaCardPill(agendaRow,h);
    const weatherPill = weatherCardPill(agendaRow,h);
    const earlyPill = earlyCardPill(earlyReasonText || '');
    const showOrderPills = sortSettings.showOrderPillsOnCards !== false;
    const orderPill = (!minimal && showOrderPills && dayBase != null && typeof orderLinkPillHtml === 'function')
      ? orderLinkPillHtml(h.hid,dayBase,data)
      : '';
    const nowPill = (!minimal && showOrderPills && typeof doingNowPillHtml === 'function') ? doingNowPillHtml(h) : '';
    const scheduleLinkPill = (!minimal && showOrderPills && scheduleLinkReason)
      ? `<span class="context-pill schedule-link-blocked-pill" title="${escapeHtml(scheduleLinkReason)}"><i class="ti ti-link-off" aria-hidden="true"></i>linked</span>`
      : '';
    const accent = visualClassColor(cardScoreTone);
    const statusPill = (!minimal && sortSettings.showStatusOnCards) ? cardStatusPill(cardScore,cardScoreTone,cue,accent) : '';
    const gatedEarlyPill = (!minimal && sortSettings.showEarlyOnCards) ? earlyPill : '';
    const agendaTimeHidden = agendaPill === '';
    const context = minimal
      ? cardMeta(h,{forceRepetition:true,minimalOnly:true})
      : cardMeta(h,{extraPills:[statusPill,gatedEarlyPill,weatherPill,orderPill,nowPill,scheduleLinkPill].filter(Boolean).join(''),suppressScheduled: agendaRow?.kind === 'scheduled' && !agendaTimeHidden});
    const trail = cardTrail(h);
    // Minimal hides dots unless opted in for minimal specifically
    // (minimalShowTrailOnCards, default off); full keeps its own toggle.
    const showTrail = minimal
      ? sortSettings.minimalShowTrailOnCards === true
      : sortSettings.showTrailOnCards !== false;
    const showBreakableSlider = !minimal && isBreakableSliderRow(realIdx,agendaRow);
    const timerRunning = !minimal && typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === realIdx;
    // Timer bar always shows while running — even on breakable crown cards —
    // so the user can see the session without opening detail.
    const sessionHtml = (timerRunning || !showBreakableSlider) ? (minimal ? '' : cardSessionProgress(h,realIdx)) : '';
    // Minimal's visual row is trail-only when opted in — sliders/sessions stay
    // full-mode features (guarded below by !minimal).
    const visualHtml = minimal
      ? (showTrail ? `<div class="ting-trail">${trail}</div>` : '')
      : (showBreakableSlider
        ? `${cardBreakableSlider(h)}${sessionHtml}`
        : (sessionHtml || (showTrail ? `<div class="ting-trail">${trail}</div>` : '')));
    const visualAria = showBreakableSlider || sessionHtml ? '' : ' aria-hidden="true"';
    const isDoneTask = h.type === 'task' && isTaskDone(h);
    const canTimer = typeof habitTimerEligible === 'function'
      ? habitTimerEligible(h)
      : (h.type !== 'zero' && !(h.type === 'task' && isTaskDone(h)));
    const timerAction = (!minimal && (canTimer || timerRunning))
      ? (timerRunning
        ? `<button class="swipe-action sa-timer" data-action="timer" aria-label="stop session"><i class="ti ti-player-stop" aria-hidden="true"></i>stop</button>`
        : `<button class="swipe-action sa-timer" data-action="timer" aria-label="start session"><i class="ti ti-player-play" aria-hidden="true"></i>session</button>`)
      : '';
    const snoozeAction = minimal ? '' : `<button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>`;
    const pinAction = minimal ? '' : `<button class="swipe-action sa-pin" data-action="pin" aria-label="${h.pinned ? 'unpin' : 'pin'}"><i class="ti ${h.pinned ? 'ti-pinned-off' : 'ti-pin'}" aria-hidden="true"></i>${h.pinned ? 'unpin' : 'pin'}</button>`;
    const keepAction = h.sample
      ? `<button class="swipe-action sa-keep" data-action="keep" aria-label="keep sample"><i class="ti ti-check" aria-hidden="true"></i>keep</button>`
      : '';
    const activityAction = minimal ? '' : `<button class="swipe-action sa-activity" data-action="activity" aria-label="activity"><i class="ti ti-history" aria-hidden="true"></i>activity</button>`;
    const canDrag = !minimal && dayBase != null && typeof isAgendaFillDraggable === 'function' && isAgendaFillDraggable(h,agendaRow);
    const dragHandle = canDrag
      ? `<button type="button" class="agenda-drag-handle" aria-label="drag to reorder" title="drag to reorder"><i class="ti ti-grip-vertical" aria-hidden="true"></i></button>`
      : '';

    const row = document.createElement('div');
    row.className = 'swipe-row' + (canDrag ? ' has-agenda-drag' : '');
    row.dataset.realIdx = realIdx;
    if(dayBase != null)row.dataset.dayBase = String(dayBase);
    if(agendaRow && Number.isFinite(agendaRow.start)){
      row.dataset.agendaStart = String(Math.round(agendaRow.start / 60000));
    }
    if(canDrag)row.dataset.agendaDraggable = '1';
    if(h.hid)row.dataset.hid = h.hid;
    if(agendaRow && Number.isFinite(agendaRow.chunkMinutes)){
      row.dataset.chunkMinutes = String(Math.round(agendaRow.chunkMinutes));
    }
    if(showBreakableSlider){
      const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0;
      row.dataset.progressTarget = String(done);
      row.dataset.progressDirty = '0';
    }
    const isBreakable = showBreakableSlider;
    // Session grid class only when the bar owns the visual row (non-breakable).
    // Breakable stacks the timer bar under the crown inside the same visual.
    const hasSession = Boolean(sessionHtml) && !isBreakable;
    row.innerHTML = `
      <div class="swipe-actions swipe-actions-left">
        ${pinAction}
        ${keepAction}
        ${activityAction}
        ${timerAction}
      </div>
      <div class="swipe-actions swipe-actions-right">
        ${snoozeAction}
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>remove</button>
      </div>
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}${isDoneTask?' is-done':''}${isBreakable?' breakable-card':''}${hasSession?' session-card':''}${timerRunning?' timer-running':''}${minimal?' minimal-card':''}" data-real="${realIdx}" style="--card-accent:${accent};--card-priority:${priorityColor(effectivePriority(h))};">
        ${dragHandle}
        <button class="pulse-btn ${h.emoji ? 'emoji-pulse' : ''}${normalizeEmojiBgColor(h.emojiBgColor) ? ' has-emoji-bg' : ''}" data-pulse="${realIdx}" aria-label="${h.type === 'task' ? 'complete' : 'log'} ${escapeHtml(h.name)}" data-log-label="${h.type === 'task' ? 'done' : 'log'}" style="${typeof emojiBgInlineStyle === 'function' ? emojiBgInlineStyle(h,c.bg,c.icon) : `background:${c.bg};color:${c.icon};`}">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info${isBreakable ? ' has-breakable-progress' : ''}${hasSession ? ' has-session-progress' : ''}${minimal || visualHtml ? '' : ' no-trail'}">
          <div class="ting-main">
            <span class="ting-name">${escapeHtml(h.name)}</span>
            ${agendaPill}
          </div>
          ${(!minimal && isBreakable) ? ((orderPill || nowPill || weatherPill) ? `<div class="ting-meta" aria-label="order">${nowPill}${orderPill}${weatherPill}</div>` : '') : `${sortSettings.showCueOnCards !== false ? `<div class="ting-cue">${escapeHtml(cue)}</div>` : ''}
          <div class="ting-meta" aria-label="rhythm and plan">${context}</div>`}
          ${!visualHtml ? '' : `<div class="ting-visual"${visualAria}>
            ${visualHtml}
          </div>`}
        </div>
        ${minimal || isBreakable ? '' : `<div class="card-actions" aria-label="habit actions">
          <button class="card-action-btn" data-action="activity" aria-label="activity" title="activity"><i class="ti ti-history" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="snooze" aria-label="snooze" title="snooze"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="nuke" aria-label="remove" title="remove"><i class="ti ti-trash" aria-hidden="true"></i></button>
        </div>`}
      </div>`;

    list.appendChild(row);
    setupSwipe(row);
    setupCardTap(row,realIdx);
    if(showBreakableSlider)setupBreakableCrown(row,realIdx);
    if(canDrag && typeof setupAgendaDragHandle === 'function')setupAgendaDragHandle(row,realIdx,dayBase);
  };

  if(deferAgenda){
    // IMMEDIATE FIRST PAINT — no planner work, homeAgendaRows, or homeEarlyMap.
    // A same-day plan cache normally avoids this compatibility list; it exists
    // for the first launch after install or after a placement-changing edit.
    list.classList.remove('is-progressive');
    const labels = {0:'today',1:'overdue',2:'coming up',3:'the rest'};
    const fastOrder = todayFirstActive && !searching
      ? [...indices].sort((a,b)=>{
        const pa = Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned));
        if(pa)return pa;
        const ca = todayCategory(data[a],sortSettings);
        const cb = todayCategory(data[b],sortSettings);
        if(ca !== cb)return ca - cb;
        return indices.indexOf(a) - indices.indexOf(b);
      })
      : [...indices].sort((a,b)=>Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned)) || indices.indexOf(a) - indices.indexOf(b));
    let fastCat = -1;
    let fastHeaderForPinned = false;
    fastOrder.forEach(realIdx=>{
      const h = data[realIdx];
      if(h.pinned){
        if(!fastHeaderForPinned){ appendSectionHeader(list,'pinned'); fastHeaderForPinned = true; }
        appendHabitCard(realIdx,null,'');
        return;
      }
      if(todayFirstActive && !searching){
        const cat = todayCategory(h,sortSettings);
        if(cat !== fastCat){
          const label = labels[cat];
          if(label)appendSectionHeader(list,label);
          fastCat = cat;
        }
      }
      appendHabitCard(realIdx,null,'');
    });
  }else{
    list.classList.remove('is-progressive');
    if(weekMode){
    const week = (o.__optimizedWeek && o.__optimizedWeek.days)
      ? o.__optimizedWeek
      : buildWeekAgenda(data,sortSettings,7);
    _homeRenderedWeek = week;
    if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(data,week);
    const agendaMap = new Map();
    const weekAssigned = new Set();
    const scheduleOmissionByHid = new Map();
    const dayPlans = week.days.map(day=>{
      for(const omission of day.linkOmissions || []){
        if(omission && omission.subjectHid && !scheduleOmissionByHid.has(omission.subjectHid)){
          scheduleOmissionByHid.set(omission.subjectHid,omission.reason || 'linked placement could not be honored');
        }
      }
      // A just-logged habit must leave today's timeline at once, even when we
      // repaint from a stale/cached week still mounted while the planner
      // re-solves asynchronously. Drop any fill/scheduled row whose habit is
      // already done for this day BEFORE sequence building, so travel legs only
      // chain around still-due habits. A partially-logged breakable is NOT
      // completedOnDay (progress < total), so it correctly stays due.
      const rawTimeline = Array.isArray(day.timeline) ? day.timeline : [];
      const displayTimeline = (typeof completedOnDay === 'function')
        ? rawTimeline.filter(r=>{
            if(r.kind !== 'fill' && r.kind !== 'scheduled')return true;
            if(r.i == null)return true;
            const h = data[r.i];
            return !(h && completedOnDay(h,day.dayBase));
          })
        : rawTimeline;
      const seq = homeDaySequence(
        displayTimeline === rawTimeline ? day : { ...day, timeline: displayTimeline },
        sortSettings, { visibleSet }
      );
      // Preserve the exact rows shown on Home for audit/export. Placement maps
      // below still consume only indexed fills/scheduled rows, while travel
      // remains visible in HOME AGENDA OUTPUT.
      day.homeDisplayedTimeline = seq.filter(row=>row.kind === 'travel'
        || ((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null));
      for(const row of seq){
        if((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null){
          weekAssigned.add(row.i);
          if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
          if(day.isToday)noteBreakablePrimary(row.i,row);
        }
      }
      return {day,seq};
    });

    const pinnedIndices = indices.filter(i=>data[i].pinned);
    if(pinnedIndices.length)appendSectionHeader(list,'pinned');
    pinnedIndices.forEach(realIdx=>{
      const agendaRow = agendaMap.get(realIdx);
      const cat = todayCategory(data[realIdx],sortSettings);
      const earlyText = (cat === 2 && earlyMap.get(realIdx) && agendaMap.has(realIdx)) ? earlyMap.get(realIdx) : '';
      appendHabitCard(realIdx,agendaRow,earlyText);
    });

    const weekTodayHids = (()=>{
      const todayPlan = dayPlans.find(p=>p.day.isToday);
      if(!todayPlan)return [];
      return todayPlan.seq
        .filter(row=>(row.kind === 'fill' || row.kind === 'scheduled') && row.i != null && !data[row.i]?.pinned)
        .map(row=>data[row.i]?.hid)
        .filter(Boolean);
    })();

    dayPlans.forEach(({day,seq})=>{
      if(!seq.length)return;
      appendSectionHeader(list,homeWeekDayLabel(day),day,day.isToday ? weekTodayHids : null);
      for(let i = 0;i < seq.length;){
        const row = seq[i];
        if(row.kind === 'travel'){
          if(homeExtraRowVisible(row.start))appendHomeExtraTravel(list,row.from,row.to,row.start);
          i += 1;
          continue;
        }
        if(row.kind === 'blocked'){
          const {blocks,nextIdx} = consumeBlockedRun(seq,i);
          if(homeExtraRowVisible(blocks[0].start)){
            if(homeExtraMode() === 'text12h'){
              blocks.forEach(b=>appendHomeBlockedText(list,b));
            }else{
              const groupKey = `${day.dayKey}:${blocks[0].start}:${blocks.length}:${blocks.map(b=>b.label||'').join('|')}`;
              appendHomeBlockedGroup(list,blocks,groupKey);
            }
          }
          i = nextIdx;
          continue;
        }
        i += 1;
        if(row.kind !== 'fill' && row.kind !== 'scheduled')continue;
        // Pinned cards also render here — in their natural time slot — so the
        // travel/blocked cards around them keep their context. They still
        // appear in the separate pinned section above via the pre-pass.
        const cat = todayCategory(data[row.i],sortSettings);
        const earlyText = (day.isToday && cat === 2 && earlyMap.get(row.i)) ? earlyMap.get(row.i) : '';
        appendHabitCard(row.i,row,earlyText,day.dayBase);
      }
    });

    // Timed-only day sections: anything without a suggested time goes to
    // overdue / upcoming — never as an untimed card under a day.
    const leftoverKey = (h)=>{
      const cat = todayCategory(h,sortSettings);
      if(cat === 3)return 3;
      if(cat === 1 || cat === 0)return 1; // due/overdue that didn't place
      return 2;
    };
    const leftovers = indices
      .filter(i=>!data[i].pinned && !weekAssigned.has(i))
      .sort((a,b)=>leftoverKey(data[a]) - leftoverKey(data[b]) || indices.indexOf(a) - indices.indexOf(b));
    let leftoverCat = -1;
    leftovers.forEach(realIdx=>{
      const key = leftoverKey(data[realIdx]);
      if(key !== leftoverCat){
        const labels = {1:'overdue',2:'coming up',3:'the rest'};
        const label = labels[key];
        if(label)appendSectionHeader(list,label);
        leftoverCat = key;
      }
      appendHabitCard(realIdx,null,'',null,scheduleOmissionByHid.get(data[realIdx]?.hid) || '');
    });
  }else{
    // Search results don't place on the agenda — skip homeAgendaRows (planner)
    // and auto-mark sync so each keystroke is just a cheap filter + rank.
    const agendaRows = searching ? [] : homeAgendaRows(data);
    if(!searching && typeof syncAutoMarkChunkPlans === 'function'){
      syncAutoMarkChunkPlans(data,{days:[{dayBase:dayStart(Date.now()),timeline:agendaRows}]});
    }
    const agendaMap = new Map();
    const agendaOrder = new Map();
    const chunksByIndex = new Map();
    agendaRows.forEach((row,pos)=>{
      if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
      if(!agendaOrder.has(row.i))agendaOrder.set(row.i,pos);
      if(!chunksByIndex.has(row.i))chunksByIndex.set(row.i,[]);
      chunksByIndex.get(row.i).push(row);
      noteBreakablePrimary(row.i,row);
    });
    // An upcoming item is pulled into "today" only when it BOTH passes the
    // do-early gate (allowed today + flexibility + its target day is over-loaded)
    // AND earns an agenda row today. If it loses its slot to capacity it falls
    // back to its original "upcoming" section, so the list never promises time
    // the day cannot give and the card never shows an "early" pill it can't honour.
    const earlyToday = i => Boolean(earlyMap.get(i)) && agendaMap.has(i);
    const renderIndices = todayFirstActive && !searching ? [...indices].sort((a,b)=>{
      // Pinned cards are NOT sorted to the top here — they render in their
      // natural time/category position so the timeline stays time-ordered.
      // A separate pinned-section pre-pass below mirrors week view.
      const catA = todayCategory(data[a],sortSettings);
      const catB = todayCategory(data[b],sortSettings);
      const dispA = (catA === 0 || (catA === 2 && earlyToday(a))) ? 0 : catA;
      const dispB = (catB === 0 || (catB === 2 && earlyToday(b))) ? 0 : catB;
      if(dispA !== dispB)return dispA - dispB;
      if(dispA === 0){
        const posA = agendaOrder.get(a), posB = agendaOrder.get(b);
        if(posA != null || posB != null){
          if(posA == null)return 1;
          if(posB == null)return -1;
          return posA - posB;
        }
      }
      return indices.indexOf(a) - indices.indexOf(b);
    }) : indices;
    let sectionCat = -1;
    // True once a "today" section header has been appended in this loop. The
    // fallback below (missed/free-time pill on an otherwise empty today) must
    // only fire when NO today section rendered — checking `sectionCat !== 0`
    // instead was wrong: if today items render and overdue items follow,
    // sectionCat ends on the overdue key and the fallback prepended a SECOND
    // "today" header above the pinned section.
    let todaySectionRendered = false;
    let prevTodayLocId = null;

    // Precompute: should today's first location-bearing item be preceded by a
    // synthetic "from current location" leg? Mirrors what homeDaySequence
    // inserts at the top of today for the week branch — when the user has a
    // live GPS fix that isn't inside any saved location, the regular seed
    // (currentLocationId → nearest saved) would mis-anchor the first leg.
    // Returning CURRENT_COORD_ID here lets the existing prevTodayLocId check
    // render the leg via appendHomeExtraTravel (which routes the synthetic id
    // through travelFromCurrent's movement-thresholded cache).
    let currentCoordSeed = null;
    if(todayFirstActive && !searching
      && typeof currentCoordLocation === 'function'
      && typeof isCurrentCoordAwayFromSaved === 'function'
      && typeof CURRENT_COORD_ID !== 'undefined'
      && typeof CURRENT_COORD_TRAVEL_CARD_MIN_METRES !== 'undefined'){
      const here = currentCoordLocation();
      if(here && isCurrentCoordAwayFromSaved()){
        const registry = locationOptions();
        for(const seedIdx of renderIndices){
          const sh = data[seedIdx];
          if(!sh)continue;
          const scat = todayCategory(sh,sortSettings);
          const sEarly = scat === 2 && earlyToday(seedIdx);
          if(scat !== 0 && !sEarly)continue;
          const sRow = agendaMap.get(seedIdx);
          const sLoc = cardLocationId(sh,sRow);
          if(!sLoc)continue;
          const sTo = locationById(sLoc,registry);
          if(!sTo)continue;
          if(haversineMetres(here.lat,here.lng,sTo.lat,sTo.lng) >= CURRENT_COORD_TRAVEL_CARD_MIN_METRES){
            currentCoordSeed = CURRENT_COORD_ID;
          }
          break; // first location-bearing today item decides; stop scanning
        }
      }
    }

    const todayHids = (!searching && todayFirstActive)
      ? renderIndices.filter(i=>{
          const h = data[i];
          if(h.pinned)return false;
          const cat = todayCategory(h,sortSettings);
          return cat === 0 || (cat === 2 && earlyToday(i));
        }).map(i=>data[i].hid).filter(Boolean)
      : [];

    // Pinned-section pre-pass: pinned cards render up here (separate section,
    // mirrors week view) AND again below in their natural timeline slot so
    // travel/blocked cards around them keep their context.
    const pinnedTodayIndices = renderIndices.filter(i=>data[i].pinned);
    if(pinnedTodayIndices.length){
      appendSectionHeader(list,'pinned');
      pinnedTodayIndices.forEach(realIdx=>{
        const agendaRow = agendaMap.get(realIdx);
        const cat = todayCategory(data[realIdx],sortSettings);
        const earlyText = (cat === 2 && earlyMap.get(realIdx) && agendaMap.has(realIdx)) ? earlyMap.get(realIdx) : '';
        appendHabitCard(realIdx,agendaRow,earlyText);
      });
    }

    renderIndices.forEach(realIdx=>{
      const h = data[realIdx];
      const cat = todayFirstActive ? todayCategory(h,sortSettings) : -1;
      const isEarlyToday = todayFirstActive && cat === 2 && earlyToday(realIdx);
      const inTodaySection = !searching && todayFirstActive && (cat === 0 || isEarlyToday);

      if(!searching && todayFirstActive){
        const sectionKey = isEarlyToday ? 0 : cat;
        if(sectionKey !== sectionCat){
          const labels = {0:'today',1:'overdue',2:'coming up',3:'the rest'};
          const label = labels[sectionKey];
          const dayCtx = label === 'today'
            ? {dayBase:dayStart(Date.now()),isToday:true,dayKey:todayIso(),timeline:agendaRows}
            : null;
          if(label)appendSectionHeader(list,label,dayCtx,label === 'today' ? todayHids : null);
          sectionCat = sectionKey;
          if(label === 'today')todaySectionRendered = true;
          if(sectionKey !== 0)prevTodayLocId = null;
        }
      }

      // Breakable tasks placed in the today section expand to one card per
      // chunk so each time block is visible on the timeline.
      if(inTodaySection){
        const chunkRows = chunksByIndex.get(realIdx);
        if(chunkRows && chunkRows.length > 1){
          if(prevTodayLocId === null && currentCoordSeed)prevTodayLocId = currentCoordSeed;
          chunkRows.forEach((chunkRow,ci)=>{
            const cLocId = cardLocationId(h,chunkRow);
            if(prevTodayLocId && cLocId && prevTodayLocId !== cLocId){
              const travelTs = homeTravelLeaveByMs(prevTodayLocId,cLocId,chunkRow.start);
              if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,cLocId,travelTs);
            }
            prevTodayLocId = cLocId || prevTodayLocId;
            const earlyText = (cat === 2 && earlyMap.get(realIdx)) ? earlyMap.get(realIdx) : '';
            appendHabitCard(realIdx,chunkRow,ci === 0 ? earlyText : '',dayStart(Date.now()));
          });
          return;
        }
      }

      const agendaRow = agendaMap.get(realIdx);
      const locId = cardLocationId(h,agendaRow);
      if(inTodaySection && prevTodayLocId === null && currentCoordSeed && locId){
        prevTodayLocId = currentCoordSeed;
      }
      if(inTodaySection && prevTodayLocId && locId && prevTodayLocId !== locId){
        const travelTs = homeTravelLeaveByMs(
          prevTodayLocId,
          locId,
          agendaRow && Number.isFinite(agendaRow.start) ? agendaRow.start : NaN
        );
        if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,locId,travelTs);
      }
      if(inTodaySection)prevTodayLocId = locId || prevTodayLocId;

      appendHabitCard(
        realIdx,
        agendaRow,
        (!searching && cat === 2 && earlyToday(realIdx)) ? earlyMap.get(realIdx) : '',
        inTodaySection ? dayStart(Date.now()) : null
      );
    });
    if(!searching && todayFirstActive && !todaySectionRendered){
      const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
      if(!minimal){
        const _snap = loadTodaySuggested();
        if(!_droppedDayBaseline && _snap.prevProjection){
          _droppedDayBaseline = _snap.prevProjection;
          _droppedDayBaselineDay = todayIso();
        }
        const _hasOverdue = data.some(h => h && h.hid && !completedToday(h) && todayCategory(h,sortSettings) === 1);
        if(Object.keys(_snap.hids).length > 0 || _droppedDayBaseline || _hasOverdue){
          const header = document.createElement('div');
          header.className = 'section-header';
          header.dataset.label = 'today';
          header.textContent = 'today';
          setupDayCapacityHeader(header,dayStart(Date.now()),false);
          attachFreeTimeIndicator(header,{dayBase:dayStart(Date.now()),isToday:true,dayKey:todayIso(),timeline:agendaRows});
          attachDroppedIndicator(header,list,todayHids);
          if(header.classList.contains('has-dropped') || header.classList.contains('has-pill'))list.prepend(header);
        }
      }
    }
  }
  } // end of the `else` (non-deferred) branch

  // Fresh headers may already sit stuck at the viewport top (background
  // refresh mid-scroll) — set their tone before the next scroll tick.
  updateStuckSectionHeaders();

  list.querySelectorAll('[data-pulse]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      if(swipeOpenCard){
        e.preventDefault();
        closeAllSwipes();
        return;
      }
      const idx = +btn.dataset.pulse;
      const card = btn.closest('.ting-card');
      handleCardActivate(idx,card,()=>quickLog(idx,card));
    });
  });

  list.querySelectorAll('.swipe-action').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      closeAllSwipes();
      if(btn.dataset.action === 'pin')togglePin(idx);
      if(btn.dataset.action === 'keep'){
        if(typeof keepSampleHabit === 'function')keepSampleHabit(idx);
      }
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
      if(btn.dataset.action === 'timer'){
        if(typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === idx){
          if(typeof stopHabitTimer === 'function')stopHabitTimer(true,true);
        }else if(typeof startHabitTimer === 'function'){
          startHabitTimer(idx);
        }
      }
    });
  });
  list.querySelectorAll('.card-action-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
    });
  });
  if(typeof renderWeekOnHome === 'function')renderWeekOnHome();
  if(typeof scheduleHouseholdAgendaPublish === 'function' && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
    scheduleHouseholdAgendaPublish(_homeRenderedWeek);
  }
  _homeListFingerprint = homeListFingerprint();
  restoreHomeReadingPosition(readingPosition,list);
  return true;
}

// PURE: lightweight freshness key for the home list. Used to skip background
// re-renders when nothing that affects order/pills/travel has changed — avoids
// wiping #list (and the visual jitter that causes) on GPS ticks, travel-cache
// writes that didn't move numbers, and the while-open refresh loop.
