// Shared sheet controls, toast/undo UI, reach assist, and forgiving pointer handling.

function openSnooze(i){
  const h = load()[i];
  if(!h)return;
  snoozeIdx = i;
  $('snooze-name').textContent = h.name;
  document.querySelectorAll('[data-snooze-repetitions]').forEach(btn=>{
    btn.hidden = h.type === 'zero';
  });
  openSheet('snooze-sheet');
}

function snoozeUndoLabel(until,label){
  if(label)return label;
  const days = Math.max(1,Math.ceil((until - Date.now()) / 86400000));
  return `Hidden ${days}d`;
}

function doSnoozeUntil(i,until,label = ''){
  const data = load();
  if(!data[i])return;
  const previous = data[i].snoozedUntil || null;
  data[i].snoozedUntil = until;
  if(save(data)){
    showUndo(snoozeUndoLabel(until,label),{type:'hide',idx:i,snoozedUntil:previous});
    render();
  }
}

function doSnooze(i,days){
  doSnoozeUntil(i,Date.now() + days * 86400000,`Hidden ${days}d`);
}

function repetitionSnoozeUntil(h,skipCount){
  if(!h || h.type === 'zero')return null;
  const targetDays = Math.max(1,effectiveTarget(h));
  const targetMs = targetDays * 86400000;
  const today = dayStart(Date.now());
  let due = dayStart((h.lastLog || Date.now()) + targetMs);
  while(due <= today)due += targetMs;
  due += Math.max(0,skipCount) * targetMs;
  const showBeforeDue = due - 86400000;
  const tomorrow = today + 86400000;
  return Math.max(showBeforeDue,tomorrow);
}

function doSnoozeRepetitions(i,skipCount){
  const h = load()[i];
  const until = repetitionSnoozeUntil(h,skipCount);
  if(!until)return;
  const label = skipCount === 1 ? 'Hidden 1 time' : `Hidden ${skipCount} times`;
  doSnoozeUntil(i,until,label);
}

function openActivity(i){
  const h = load()[i];
  if(!h)return;
  activityIdx = i;
  $('activity-name').textContent = h.name;
  renderActivity(h);
  openSheet('activity-sheet');
}

function renderActivity(h){
  const logs = normalizeLogs(h.logs);
  const nowKey = dateKey(Date.now());
  const actual = actualLogs(h.logs);
  const past = logs
    .filter(log=>!isPlanLog(log) && dateKey(logTime(log)) <= nowKey)
    .map(log=>({ts:logTime(log),kind:'entry',detail:activityEntryDetail(actual,logTime(log))}))
    .sort((a,b)=>b.ts-a.ts);
  const future = logs
    .filter(log=>isPlanLog(log) && dateKey(logTime(log)) >= nowKey)
    .map(log=>({ts:logTime(log),kind:'plan'}))
    .sort((a,b)=>a.ts-b.ts);
  const topics = normalizeTopics(h.topics);
  $('activity-sub').textContent = [
    cardCue(h),
    h.type === 'zero' ? 'stop' : `${h.target || 7}d rhythm`,
    topics.length ? topics.join(', ') : ''
  ].filter(Boolean).join(' · ');
  $('activity-summary').innerHTML = activitySummary(h,actual,future);
  const futureHtml = future.length ? activitySection('future plans',future.slice(0,6)) : '';
  const pastHtml = past.length ? activitySection('recent activity',past.slice(0,12),past.length - 12) : '';
  const hasActivity = Boolean(futureHtml || pastHtml);
  $('activity-list').innerHTML = hasActivity
    ? `${futureHtml}${pastHtml}`
    : '<p class="activity-empty">No entries or future plans yet.</p>';
}

function activitySummary(h,actual,future){
  const frame = monthFrame(0);
  const thisMonth = actual.filter(ts=>{
    const d = new Date(ts);
    return d.getFullYear() === frame.year && d.getMonth() === frame.month;
  }).length;
  const last = actual.length ? entryWhen(actual[actual.length - 1]) : 'none';
  const next = activityNextMoment(h,future);
  const spacing = averageSpacing(actual);
  return [
    activityMetric('ti-list-check','total',actual.length || '0'),
    activityMetric('ti-calendar-check','month',thisMonth || '0'),
    activityMetric('ti-history','last',last),
    activityMetric(next.icon,'next',next.label),
    spacing ? activityMetric('ti-arrows-left-right','avg gap',spacing) : ''
  ].join('');
}

function activityMetric(icon,label,value){
  return `<span class="activity-metric"><i class="ti ${icon}" aria-hidden="true"></i><b>${escapeHtml(String(value))}</b><small>${escapeHtml(label)}</small></span>`;
}

function activityNextMoment(h,future){
  if(future.length)return {icon:'ti-calendar-event',label:entryWhen(future[0].ts)};
  if(h.type === 'zero')return {icon:'ti-shield-check',label:h.lastLog ? 'rebuilding' : 'clear'};
  if(!h.lastLog)return {icon:'ti-player-play',label:'ready'};
  const due = dayStart(h.lastLog) + Math.max(1,effectiveTarget(h)) * 86400000;
  return {icon:'ti-calendar-time',label:entryWhen(due)};
}

function activityEntryDetail(actual,ts){
  const idx = actual.indexOf(ts);
  if(idx > 0){
    const gap = Math.max(1,Math.round((ts - actual[idx - 1]) / 86400000));
    return `${gap}d gap`;
  }
  return 'first entry';
}

function averageSpacing(actual){
  if(actual.length < 2)return '';
  const gaps = [];
  for(let i = Math.max(1,actual.length - 6); i < actual.length; i++){
    gaps.push(Math.max(1,Math.round((actual[i] - actual[i - 1]) / 86400000)));
  }
  const avg = Math.round(gaps.reduce((sum,gap)=>sum + gap,0) / gaps.length);
  return `${avg}d`;
}

function activitySection(title,items,moreCount = 0){
  return `<section class="activity-section">
    <span class="overview-section-title">${title}</span>
    ${items.map(item=>{
      const d = new Date(item.ts);
      const label = d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
      const detail = item.kind === 'plan' ? entryWhen(item.ts) : item.detail || d.toLocaleDateString(undefined,{year:'numeric'});
      const icon = item.kind === 'plan' ? 'ti-calendar-event' : 'ti-check';
      return `<div class="activity-item ${item.kind}">
        <span class="overview-name"><i class="ti ${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span>
        <span class="overview-meta">${escapeHtml(detail)}</span>
      </div>`;
    }).join('')}
    ${moreCount > 0 ? `<div class="activity-more">${moreCount} older ${moreCount === 1 ? 'entry' : 'entries'}</div>` : ''}
  </section>`;
}

function doNuke(i){
  const data = load();
  const removed = data[i];
  if(!removed)return;
  data.splice(i,1);
  if(save(data)){
    showUndo('Habit removed',{type:'delete',idx:i,habit:removed});
    render();
  }
}

function openDayEntry(i,key){
  const h = load()[i];
  if(!h)return;
  dayEntryIdx = i;
  dayEntryTs = new Date(`${key}T12:00:00`).getTime();
  $('day-entry-name').textContent = h.name;
  const label = key > dateKey(Date.now()) ? 'Plan entry for' : 'Add entry for';
  $('day-entry-sub').textContent = `${label} ${new Date(dayEntryTs).toLocaleDateString(undefined,{month:'short',day:'numeric'})}?`;
  openSheet('day-entry-sheet');
}

function updateKeyboardLift(){
  const addOpen = $('add-sheet').classList.contains('open');
  const searchOpen = document.querySelector('.bottom-nav')?.classList.contains('search-open');
  if((!addOpen && !searchOpen) || !window.visualViewport){
    document.documentElement.style.setProperty('--keyboard-lift','0px');
    return;
  }
  const keyboard = Math.max(0,window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
  document.documentElement.style.setProperty('--keyboard-lift',`${keyboard}px`);
}

function keepFocusedInputVisible(){
  const active = document.activeElement;
  if(!active || (!$('add-sheet').contains(active) && active !== $('habit-search')))return;
  active.scrollIntoView({block:'center',inline:'nearest'});
}

function openSheet(id){
  $(id).classList.add('open');
  updateFullPageState();
  updateKeyboardLift();
}
function closeSheet(id){
  $(id).classList.remove('open');
  updateFullPageState();
  if(isFullPageSheet(id))suppressBottomNav(450);
  if(id === 'add-sheet')updateKeyboardLift();
}

function isFullPageSheet(id){
  return id === 'detail-sheet' || id === 'about-sheet' || id === 'overview-sheet' || id === 'settings-sheet';
}

function updateFullPageState(){
  const open = ['detail-sheet','about-sheet','overview-sheet','settings-sheet'].some(id=>$(id).classList.contains('open'));
  document.body.classList.toggle('fullpage-open',open);
}

function showToast(text){
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove('show'),900);
}

function showUndo(text,undo){
  pendingUndo = undo;
  $('undo-text').textContent = text;
  $('undo-toast').classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo,5200);
}

function hideUndo(){
  clearTimeout(undoTimer);
  undoTimer = null;
  pendingUndo = null;
  $('undo-toast').classList.remove('show');
}

function refreshOpenViews(){
  render();
  if(detailIdx !== null && $('detail-sheet').classList.contains('open'))openDetail(detailIdx);
  if($('overview-sheet').classList.contains('open'))renderOverview();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayLogs(dayLogsKey);
}

function suppressBottomNav(ms = 300){
  document.body.classList.add('nav-suppressed');
  clearTimeout(navSuppressTimer);
  navSuppressTimer = setTimeout(()=>document.body.classList.remove('nav-suppressed'),ms);
}

function showReachPad(){
  if(!sortSettings.reachAssist)return;
  if(document.querySelector('.sheet-wrap.open'))return;
  if(window.scrollY > 4)return;
  if(document.body.classList.contains('reach-pad'))return;
  document.body.classList.add('reach-pad');
  clearTimeout(reachTimer);
  reachTimer = setTimeout(()=>{
    document.body.classList.remove('reach-pad');
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'auto'}));
  },5200);
}

function cancelReachHold(){
  clearTimeout(reachHoldTimer);
  reachHoldTimer = null;
  reachArmed = false;
}

function updateHeaderOnScroll(){
  const y = window.scrollY;
  const dy = y - lastScrollY;
  if(y < 12){
    headerHidden = false;
    headerRevealPull = 0;
  }else if(dy > 4 && y > 42){
    headerHidden = true;
    headerRevealPull = 0;
  }else if(dy < -2){
    headerRevealPull += Math.abs(dy);
    if(headerRevealPull > 64)headerHidden = false;
  }else if(dy > 0){
    headerRevealPull = 0;
  }
  document.body.classList.toggle('header-hidden',headerHidden);
  lastScrollY = y;
}

function forgivingButtonTarget(target){
  const btn = target.closest('button');
  if(!btn || btn.closest('.ting-card'))return null;
  if(btn.closest('#settings-sheet'))return null;
  if(btn.closest('.month-nav'))return null;
  if(btn.classList.contains('cal-day'))return null;
  return btn;
}

function bindCalendarTap(container,selector,handler){
  container.addEventListener('pointerdown',e=>{
    const day = e.target.closest(selector);
    if(!day || !container.contains(day))return;
    const scrollHost = container.closest('.sheet');
    calendarPointer = {
      container,
      day,
      id:e.pointerId,
      x:e.clientX,
      y:e.clientY,
      scrollHost,
      scrollTop:scrollHost ? scrollHost.scrollTop : 0,
      time:Date.now()
    };
  },{passive:true});

  container.addEventListener('pointerup',e=>{
    if(!calendarPointer || calendarPointer.container !== container || calendarPointer.id !== e.pointerId)return;
    const tap = calendarPointer;
    calendarPointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
    if(moved > 5 || scrolled > 1 || Date.now() - tap.time > 650)return;
    handler(tap.day,e);
  },{passive:true});

  container.addEventListener('pointercancel',()=>{
    if(calendarPointer && calendarPointer.container === container)calendarPointer = null;
  },{passive:true});
}

document.addEventListener('pointerdown',e=>{
  if(shouldDismissSearchFromTap(e.target)){
    searchDismissPointer = {id:e.pointerId,x:e.clientX,y:e.clientY};
    return;
  }
  searchDismissPointer = null;
  const btn = forgivingButtonTarget(e.target);
  if(!btn)return;
  buttonPointer = {btn,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
},true);

document.addEventListener('pointerup',e=>{
  if(searchDismissPointer && searchDismissPointer.id === e.pointerId){
    const tap = searchDismissPointer;
    searchDismissPointer = null;
    if(Math.hypot(e.clientX - tap.x,e.clientY - tap.y) <= 12){
      closeSearch();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }
  if(!buttonPointer || buttonPointer.id !== e.pointerId)return;
  const {btn,x,y,time} = buttonPointer;
  buttonPointer = null;
  if(btn.disabled)return;
  const dx = Math.abs(e.clientX - x);
  const dy = Math.abs(e.clientY - y);
  const moved = Math.hypot(dx,dy);
  if(moved > 8 && moved <= 160 && Date.now() - time < 1200){
    suppressNativeButton = btn;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
    setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},80);
  }
},true);

document.addEventListener('pointercancel',e=>{
  if(searchDismissPointer && searchDismissPointer.id === e.pointerId)searchDismissPointer = null;
},true);

document.addEventListener('click',e=>{
  if(e.target.closest('button') === suppressNativeButton && e.isTrusted){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
    return;
  }
  const btn = forgivingButtonTarget(e.target);
  if(btn && btn === suppressNativeButton && e.isTrusted){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
    return;
  }
},true);
