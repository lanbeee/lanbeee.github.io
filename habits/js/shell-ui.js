// Shared sheet controls, toast/undo UI, reach assist, and forgiving pointer handling.

// ---------------------------------------------------------------------------
// FILE PURPOSE (React Native port reference):
//  - This file manages sheet modals, toast/undo notifications, and pane layout.
//  - In the RN port, sheets become @gorhom/bottom-sheet and toasts become an
//    animated overlay.
//  - RENDER functions become React components.
//  - HANDLER/WIRE functions become useEffect hooks or gesture callbacks.
// ---------------------------------------------------------------------------

// Tiers that should use the right pane for detail/overview instead of a sheet.
// (paneTierActive is defined in config.js)

// PURE: returns the detail pane element
function getPane() {
  return $('pane-detail');
}

// PURE: returns the overview pane element
function getOverviewPane() {
  return $('pane-overview');
}

// Find the inner .sheet element for a given sheet wrap, regardless of whether
// it's still inside the wrap or has been moved to a pane.
// PURE: locates a sheet inner element in wrap or pane
function getSheetInner(sheetId) {
  const wrap = $(sheetId);
  if (!wrap) return null;
  const inWrap = wrap.querySelector('.sheet');
  if (inWrap) return inWrap;
  const pane = getPane();
  if (pane && pane.dataset.activeSheet === sheetId) {
    return pane.querySelector('.sheet');
  }
  const overviewPane = getOverviewPane();
  if (overviewPane && sheetId === 'overview-sheet') {
    return overviewPane.querySelector('.overview-sheet');
  }
  return null;
}

// The overview sheet is a permanent pane on wide tiers. Move its inner content
// between #overview-sheet (modal wrap, mobile-portrait only) and #pane-overview
// (right-side pane, all wide tiers) based on the current tier.
// RENDER: moves overview sheet between wrap and pane
function ensureOverviewPlacement() {
  const wrap = $('overview-sheet');
  const pane = getOverviewPane();
  if (!wrap || !pane) return;
  const inner = wrap.querySelector('.sheet.overview-sheet')
    || pane.querySelector('.sheet.overview-sheet');
  if (!inner) return;
  if (paneTierActive()) {
    if (inner.parentElement !== pane) {
      wrap.removeChild(inner);
      pane.appendChild(inner);
    }
  } else {
    if (inner.parentElement !== wrap) {
      pane.removeChild(inner);
      wrap.appendChild(inner);
    }
  }
}

// RENDER: mounts a sheet into the detail pane
function mountInPane(sheetId) {
  const pane = getPane();
  if (!pane) return null;
  const sheet = $(sheetId);
  if (!sheet) return null;
  // Find the inner — it might be in the wrap (initial state) or in the pane (after previous mount)
  let inner = sheet.querySelector('.sheet') || pane.querySelector('.sheet');
  pane.innerHTML = '';
  pane.removeAttribute('hidden');
  if (inner) {
    inner.dataset.paneMounted = '1';
    pane.appendChild(inner);
  }
  pane.dataset.activeSheet = sheetId;
  document.body.classList.add('pane-active');
  return inner;
}

// RENDER: unmounts the detail pane and restores sheet wrap
function unmountPane() {
  const pane = getPane();
  if (!pane || !pane.dataset.activeSheet) return;
  const sheetId = pane.dataset.activeSheet;
  const inner = pane.querySelector('.sheet');
  if (inner) {
    delete inner.dataset.paneMounted;
    // Move the inner back to its sheet wrap
    const wrap = $(sheetId);
    if (wrap) wrap.appendChild(inner);
  }
  pane.innerHTML = '';
  if (!paneTierActive()) pane.setAttribute('hidden','');
  delete pane.dataset.activeSheet;
  document.body.classList.remove('pane-active');
}

// HYBRID: opens snooze sheet and seeds its UI from state
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

// PURE: computes the snooze undo label
function snoozeUndoLabel(until,label){
  if(label)return label;
  const days = Math.max(1,Math.ceil((until - Date.now()) / 86400000));
  return `Hidden ${days}d`;
}

// HANDLER: applies snooze until timestamp and re-renders
function doSnoozeUntil(i,until,label = ''){
  const data = load();
  if(!data[i])return;
  const previous = data[i].snoozedUntil || null;
  const name = toastItemName(data[i]);
  data[i].snoozedUntil = until;
  if(save(data)){
    showActionToast(`${snoozeUndoLabel(until,label)} · ${name}`,{type:'hide',idx:i,snoozedUntil:previous,openAction:false,undoLabel:'show'});
    render();
  }
}

// HANDLER: snoozes a habit by a number of days
function doSnooze(i,days){
  doSnoozeUntil(i,Date.now() + days * 86400000,`Hidden ${days}d`);
}

// PURE: computes repetition-based snooze until timestamp
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

// HANDLER: snoozes a habit by skipped repetitions
function doSnoozeRepetitions(i,skipCount){
  const h = load()[i];
  const until = repetitionSnoozeUntil(h,skipCount);
  if(!until)return;
  const label = skipCount === 1 ? 'Hidden 1 time' : `Hidden ${skipCount} times`;
  doSnoozeUntil(i,until,label);
}

// HYBRID: opens activity sheet and seeds its UI from state
function openActivity(i){
  const h = load()[i];
  if(!h)return;
  activityIdx = i;
  $('activity-name').textContent = h.name;
  renderActivity(h);
  openSheet('activity-sheet');
}

// RENDER: renders activity log UI for a habit
function renderActivity(h){
  const logs = normalizeLogs(h.logs);
  const nowKey = dateKey(Date.now());
  const actual = actualLogs(h.logs);
  const past = logs
    .filter(log=>!isPlanLog(log) && dateKey(logTime(log)) <= nowKey)
    .map(log=>{
      const ts = logTime(log);
      const obj = typeof log === 'object' ? log : null;
      return {
        ts,
        kind:'entry',
        detail:activityEntryDetail(actual,ts),
        value:obj ? logValue(obj) : null,
        minutes:obj ? logMinutes(obj) : null,
        note:obj ? logNote(obj) : ''
      };
    })
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

// PURE: builds activity summary metrics HTML
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

// PURE: builds a single activity metric HTML span
function activityMetric(icon,label,value){
  return `<span class="activity-metric"><i class="ti ${icon}" aria-hidden="true"></i><b>${escapeHtml(String(value))}</b><small>${escapeHtml(label)}</small></span>`;
}

// PURE: computes next activity moment and icon
function activityNextMoment(h,future){
  if(future.length)return {icon:'ti-calendar-event',label:entryWhen(future[0].ts)};
  if(h.type === 'zero')return {icon:'ti-shield-check',label:h.lastLog ? 'rebuilding' : 'clear'};
  if(!h.lastLog)return {icon:'ti-player-play',label:'ready'};
  const due = dayStart(h.lastLog) + Math.max(1,effectiveTarget(h)) * 86400000;
  return {icon:'ti-calendar-time',label:entryWhen(due)};
}

// PURE: computes detail string for an activity entry
function activityEntryDetail(actual,ts){
  const idx = actual.indexOf(ts);
  if(idx > 0){
    const gap = Math.max(1,Math.round((ts - actual[idx - 1]) / 86400000));
    return `${gap}d gap`;
  }
  return 'first entry';
}

// PURE: computes average gap label between recent logs
function averageSpacing(actual){
  if(actual.length < 2)return '';
  const gaps = [];
  for(let i = Math.max(1,actual.length - 6); i < actual.length; i++){
    gaps.push(Math.max(1,Math.round((actual[i] - actual[i - 1]) / 86400000)));
  }
  const avg = Math.round(gaps.reduce((sum,gap)=>sum + gap,0) / gaps.length);
  return `${avg}d`;
}

// PURE: builds an activity list section HTML
function activitySection(title,items,moreCount = 0){
  return `<section class="activity-section">
    <span class="overview-section-title">${title}</span>
    ${items.map(item=>{
      const d = new Date(item.ts);
      const label = d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
      const detail = item.kind === 'plan' ? entryWhen(item.ts) : item.detail || d.toLocaleDateString(undefined,{year:'numeric'});
      const icon = item.kind === 'plan' ? 'ti-calendar-event' : 'ti-check';
      const extras = item.kind === 'entry' ? activityEntryExtras(item) : '';
      return `<div class="activity-item ${item.kind}">
        <span class="overview-name"><i class="ti ${icon}" aria-hidden="true"></i>${escapeHtml(label)}</span>
        <span class="overview-meta">${escapeHtml(detail)}</span>
        ${extras}
      </div>`;
    }).join('')}
    ${moreCount > 0 ? `<div class="activity-more">${moreCount} older ${moreCount === 1 ? 'entry' : 'entries'}</div>` : ''}
  </section>`;
}

// PURE: optional value/minutes/note line for an activity entry.
function activityEntryExtras(item){
  if(!item)return '';
  const bits = [];
  if(item.minutes != null)bits.push(`${item.minutes}m`);
  if(item.value != null && Number.isFinite(Number(item.value)))bits.push(`${item.value}`);
  const note = String(item.note || '').trim();
  const meta = bits.length ? `<span class="activity-extras-meta">${escapeHtml(bits.join(' · '))}</span>` : '';
  const noteHtml = note ? `<span class="activity-extras-note">${escapeHtml(note)}</span>` : '';
  return (meta || noteHtml) ? `<div class="activity-extras">${meta}${noteHtml}</div>` : '';
}

// HANDLER: deletes a habit and shows undo
function doNuke(i){
  const data = load();
  const removed = data[i];
  if(!removed)return;
  // Cancel any scheduled push before removing.
  if(typeof cancelPush === 'function' && typeof reminderSignature === 'function' && removed.type === 'task'){
    cancelPush(reminderSignature(removed));
  }
  data.splice(i,1);
  if(save(data)){
    showActionToast(`Removed ${toastItemName(removed)}`,{type:'delete',idx:i,habit:removed,openAction:false,undoLabel:'restore'});
    render();
  }
}

// RENDER: adjusts keyboard lift CSS variable for open sheets
function updateKeyboardLift(){
  if (paneTierActive()) {
    document.documentElement.style.setProperty('--keyboard-lift','0px');
    return;
  }
  const addOpen = $('add-sheet').classList.contains('open');
  const searchOpen = document.querySelector('.bottom-nav')?.classList.contains('search-open');
  if((!addOpen && !searchOpen) || !window.visualViewport){
    document.documentElement.style.setProperty('--keyboard-lift','0px');
    return;
  }
  const keyboard = Math.max(0,window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
  document.documentElement.style.setProperty('--keyboard-lift',`${keyboard}px`);
}

// RENDER: scrolls focused input into view
function keepFocusedInputVisible(){
  const active = document.activeElement;
  if(!active || (!$('add-sheet').contains(active) && active !== $('habit-search')))return;
  if (paneTierActive()) return;
  active.scrollIntoView({block:'center',inline:'nearest'});
}

// Move the search input to the top app bar on wide tiers, back to bottom nav on phone-portrait.
// RENDER: reparents search input based on tier
function reparentSearch() {
  const input = $('habit-search');
  const clear = $('clear-search');
  if (!input) return;
  const target = paneTierActive() ? $('app-bar-search') : $('nav-search');
  if (!target) return;
  if (input.parentElement !== target) {
    target.appendChild(input);
    if (clear) target.appendChild(clear);
  }
}

// RENDER: opens a sheet or mounts it in the pane
function openSheet(id){
  if (paneTierActive() && isFullPageSheet(id) && shouldMountInPane(id)) {
    mountInPane(id);
    return;
  }
  // The overview is a permanent pane on wide tiers; the modal is never opened.
  if (paneTierActive() && id === 'overview-sheet') {
    return;
  }
  $(id).classList.add('open');
  updateFullPageState();
  updateKeyboardLift();
}
// RENDER: closes a sheet or unmounts its pane
function closeSheet(id){
  // If this sheet is currently mounted in the pane, unmount it instead.
  const pane = getPane();
  if (pane && pane.dataset.activeSheet === id) {
    unmountPane();
    return;
  }
  // Overview is a permanent pane on wide tiers; there is nothing to close.
  if (paneTierActive() && id === 'overview-sheet') {
    return;
  }
  $(id).classList.remove('open');
  updateFullPageState();
  if(isFullPageSheet(id))suppressBottomNav(450);
  if(id === 'add-sheet')updateKeyboardLift();
}

// HYBRID: opens a day drill-down item in detail without leaving the day sheet
// covering it on phone layouts. Wide layouts keep the day sheet open because
// detail mounts into the side pane.
function openDetailFromDayLogs(idx){
  if(typeof openDetail !== 'function')return;
  if(!paneTierActive() && $('day-logs-sheet')?.classList.contains('open')){
    dayLogsKey = null;
    // Open detail first (it renders behind day-logs due to z-index 110 < 120),
    // then close day-logs so the detail sheet is revealed as day-logs fades out.
    openDetail(idx);
    closeSheet('day-logs-sheet');
    return;
  }
  openDetail(idx);
}

// PURE: checks if a sheet id is full-page
function isFullPageSheet(id){
  return id === 'detail-sheet' || id === 'about-sheet' || id === 'overview-sheet' || id === 'settings-sheet';
}

// PURE: checks if a sheet id mounts into the pane
function shouldMountInPane(id) {
  // Only the detail sheet is mounted into a pane. The overview lives in its
  // own permanent .pane-overview slot on wide tiers; about/settings stay as
  // centered modals.
  return id === 'detail-sheet';
}

// RENDER: toggles body class for full-page sheet state
function updateFullPageState(){
  const open = ['detail-sheet','about-sheet','overview-sheet','settings-sheet'].some(id=>$(id).classList.contains('open'));
  document.body.classList.toggle('fullpage-open',open);
}

// RENDER: shows and auto-hides the toast message
function showToast(text){
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>toast.classList.remove('show'),900);
}

// HYBRID: shows action toast and stores pending action state
function canOpenFromAction(action){
  if(!action || !Number.isInteger(action.idx))return false;
  if(action.openAction === false)return false;
  if(action.type !== 'entry')return false;
  if(!load()[action.idx])return false;
  if($('day-logs-sheet')?.classList.contains('open'))return false;
  const detailOpen = $('detail-sheet')?.classList.contains('open');
  const detailPaneOpen = getPane()?.dataset.activeSheet === 'detail-sheet';
  if(detailIdx === action.idx && (detailOpen || detailPaneOpen))return false;
  return true;
}

function secondaryActionLabel(action){
  if(!action || action.type !== 'entry')return '';
  return action.toastActionLabel || '';
}

function showActionToast(text,action){
  pendingAction = action;
  $('action-text').textContent = text;
  const actionBtn = $('action-undo');
  if(actionBtn)actionBtn.textContent = action.undoLabel || 'undo';
  const openBtn = $('action-open');
  const planBtn = $('action-plan');
  if(openBtn){
    const showOpen = canOpenFromAction(action);
    openBtn.hidden = !showOpen;
    openBtn.setAttribute('aria-hidden',String(!showOpen));
  }
  if(planBtn){
    const label = secondaryActionLabel(action);
    planBtn.textContent = label;
    planBtn.hidden = !label;
    planBtn.setAttribute('aria-hidden',String(!label));
  }
  const snoozeUntilBtn = $('snooze-until-planned');
  if(snoozeUntilBtn){
    const showSnooze = action && action.plan && action.ts > Date.now();
    snoozeUntilBtn.hidden = !showSnooze;
    snoozeUntilBtn.setAttribute('aria-hidden',String(!showSnooze));
  }
  $('action-toast').classList.add('show');
  clearTimeout(actionToastTimer);
  actionToastTimer = setTimeout(hideActionToast,7200);
}

// HYBRID: hides action toast and clears pending action state
function hideActionToast(){
  clearTimeout(actionToastTimer);
  actionToastTimer = null;
  pendingAction = null;
  $('action-toast').classList.remove('show');
  if($('action-open'))$('action-open').hidden = true;
  if($('action-plan'))$('action-plan').hidden = true;
  if($('snooze-until-planned'))$('snooze-until-planned').hidden = true;
}

// HYBRID: re-renders currently open views after data change
function refreshOpenViews(){
  render();
  const detailOpen = $('detail-sheet').classList.contains('open') || (paneTierActive() && getPane()?.dataset.activeSheet === 'detail-sheet');
  if(detailIdx !== null && (detailOpen || paneTierActive())){
    const pager = getSheetInner('detail-sheet')?.querySelector('.detail-pager');
    const scrollLeft = pager?.scrollLeft ?? 0;
    openDetail(detailIdx);
    if(pager){
      requestAnimationFrame(()=>{
        pager.scrollLeft = scrollLeft;
      });
    }
  }
  if($('overview-sheet').classList.contains('open') || paneTierActive())renderOverview();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayLogs(dayLogsKey);
  if(typeof checkReminders === 'function')checkReminders();
}

// RENDER: temporarily suppresses the bottom nav
function suppressBottomNav(ms = 300){
  document.body.classList.add('nav-suppressed');
  clearTimeout(navSuppressTimer);
  navSuppressTimer = setTimeout(()=>document.body.classList.remove('nav-suppressed'),ms);
}

// HYBRID: shows reach-assist pad based on settings and scroll
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

// HANDLER: cancels an in-progress reach hold gesture
function cancelReachHold(){
  clearTimeout(reachHoldTimer);
  reachHoldTimer = null;
  reachArmed = false;
}

// HYBRID: updates header visibility state and body class on scroll
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

// PURE: resolves forgiving button target from an event target
function forgivingButtonTarget(target){
  if(!target || typeof target.closest !== "function")return null;
  const btn = target.closest('button');
  if(!btn || btn.closest('.ting-card'))return null;
  if(btn.closest('#settings-sheet'))return null;
  if(btn.closest('.month-nav'))return null;
  if(btn.classList.contains('cal-day'))return null;
  return btn;
}

// WIRE: attaches forgiving pointer tap handlers to a calendar
function bindCalendarTap(container,selector,handler){
  if(!container)return; // calendar element not present (e.g. retired strip)
  // Any horizontally-scrollable pager this calendar lives inside of (the
  // detail sheet's info/calendar/schedule pager). Swiping between those pages
  // often starts the gesture on top of a calendar cell, so a tap here has to
  // be sure the pager never actually moved - not just that the finger ended
  // up close to where it started.
  const pager = container.closest('.detail-pager');

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
      maxMove:0,
      scrollHost,
      scrollTop:scrollHost ? scrollHost.scrollTop : 0,
      pager,
      pagerScrollLeft:pager ? pager.scrollLeft : 0,
      time:Date.now()
    };
  },{passive:true});

  container.addEventListener('pointermove',e=>{
    if(!calendarPointer || calendarPointer.container !== container || calendarPointer.id !== e.pointerId)return;
    // Track the furthest the finger has strayed from the start, not just the
    // net distance at release - a swipe that springs back to its origin
    // still moved, even if pointerup lands right where pointerdown began.
    const dist = Math.hypot(e.clientX - calendarPointer.x,e.clientY - calendarPointer.y);
    if(dist > calendarPointer.maxMove)calendarPointer.maxMove = dist;
  },{passive:true});

  container.addEventListener('pointerup',e=>{
    if(!calendarPointer || calendarPointer.container !== container || calendarPointer.id !== e.pointerId)return;
    const tap = calendarPointer;
    calendarPointer = null;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX - tap.x,e.clientY - tap.y));
    const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
    const pagerScrolled = tap.pager ? Math.abs(tap.pager.scrollLeft - tap.pagerScrollLeft) : 0;
    if(moved > 6 || scrolled > 1 || pagerScrolled > 1 || Date.now() - tap.time > 650)return;
    if(!tap.pager){
      handler(tap.day,e);
      return;
    }
    // A fast flick can release with almost no finger movement yet still carry
    // the pager into its momentum/snap animation a moment later. Wait two
    // frames and confirm the pager truly settled before treating this as a tap.
    const settleScrollLeft = tap.pager.scrollLeft;
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        if(Math.abs(tap.pager.scrollLeft - settleScrollLeft) > 1)return;
        handler(tap.day,e);
      });
    });
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
  const scrollHost = btn.closest('.sheet');
  buttonPointer = {
    btn,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),
    maxMove:0,
    scrollHost,
    scrollTop:scrollHost ? scrollHost.scrollTop : 0
  };
},true);

// Track the furthest the finger has strayed from the start so a cancelled
// gesture can still be recognised as a tap (see pointercancel below).
document.addEventListener('pointermove',e=>{
  if(!buttonPointer || buttonPointer.id !== e.pointerId)return;
  const dist = Math.hypot(e.clientX - buttonPointer.x,e.clientY - buttonPointer.y);
  if(dist > buttonPointer.maxMove)buttonPointer.maxMove = dist;
},{passive:true});

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
  if(btn.disabled)return;
  if(moved > 8 && moved <= 160 && Date.now() - time < 1200 && !btn.classList.contains('timer-start-btn')){
    suppressNativeButton = btn;
    e.preventDefault();
    e.stopPropagation();
    btn.click();
    setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},80);
  }
},true);

// On a phone, a tap inside a scrollable sheet often drifts a few pixels, which
// makes the browser claim the gesture as the start of a scroll and fire
// pointercancel instead of pointerup. When that happens but the finger barely
// moved and the scroll host never actually scrolled, it was really a tap with
// a little finger drift — recover it by firing the click ourselves. Without
// this, buttons like "open" in the day-logs sheet are unreachable on touch.
document.addEventListener('pointercancel',e=>{
  if(searchDismissPointer && searchDismissPointer.id === e.pointerId)searchDismissPointer = null;
  if(!buttonPointer || buttonPointer.id !== e.pointerId)return;
  const tap = buttonPointer;
  buttonPointer = null;
  if(tap.btn.disabled)return;
  if(tap.btn.classList.contains('timer-start-btn'))return;
  const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
  if(tap.maxMove <= 32 && Date.now() - tap.time < 450 && scrolled === 0){
    suppressNativeButton = tap.btn;
    tap.btn.click();
    setTimeout(()=>{if(suppressNativeButton === tap.btn)suppressNativeButton = null;},80);
  }
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

document.addEventListener('tierchange',()=>{
  reparentSearch();
  updateKeyboardLift();
  ensureOverviewPlacement();
  // Show/hide the app bar based on tier
  const appBar = $('app-bar');
  if (appBar) {
    if (paneTierActive()) appBar.removeAttribute('hidden');
    else appBar.setAttribute('hidden','');
  }
  // Show the pane-detail on wide tiers so the empty hint is visible
  const pane = getPane();
  if (pane) {
    if (paneTierActive() && !pane.dataset.activeSheet) {
      // On wide tiers with no mounted sheet, show the pane (it's empty → CSS :empty handles the hint)
      pane.removeAttribute('hidden');
    } else if (!paneTierActive()) {
      pane.setAttribute('hidden','');
    }
  }
  // On 2-pane tiers, if the detail pane was previously the only visible right
  // pane, also drop body.pane-active so the overview comes back into view.
  if (!isThreePaneTier() && !pane?.dataset?.activeSheet) {
    document.body.classList.remove('pane-active');
  }
  // Close any open full-page sheet or pane so we don't get stuck mid-transition.
  ['detail-sheet','about-sheet','overview-sheet','settings-sheet'].forEach(id=>{
    if ($(id).classList.contains('open')) $(id).classList.remove('open');
  });
  unmountPane();
  updateFullPageState();
  if (typeof render === 'function') render();
  // The overview pane needs fresh content on every tier change.
  if (paneTierActive() && typeof renderOverview === 'function') renderOverview();
  if (typeof updateSortButton === 'function') updateSortButton();
});

// Click outside the mounted sheet closes it. Use capture phase and defer
// to avoid racing with handlers that mount a sheet as part of their own click
// processing (e.g. saving a new habit mounts the detail pane).
let paneCloseTimer = null;
document.addEventListener('click',e=>{
  const pane = getPane();
  if (!pane || !pane.dataset.activeSheet) return;
  if (e.target.closest('.pane-detail .sheet')) return;
  if (e.target.closest('.ting-card')) return;
  if (e.target.closest('.app-bar')) return;
  if (e.target.closest('.pane-list')) return;
  if (e.target.closest('.pane-overview')) return; // 3-pane: don't close detail on overview click
  if (e.target.closest('.sheet-wrap')) return; // any modal (incl. just-closed add)
  clearTimeout(paneCloseTimer);
  paneCloseTimer = setTimeout(()=>{
    if (pane.dataset.activeSheet) unmountPane();
  }, 0);
});

// Escape closes the pane.
document.addEventListener('keydown',e=>{
  if (e.key !== 'Escape') return;
  const pane = getPane();
  if (pane && pane.dataset.activeSheet) {
    e.preventDefault();
    const id = pane.dataset.activeSheet;
    unmountPane();
    if (id === 'detail-sheet' && typeof closeDetail === 'function') closeDetail();
  }
  // Also close centered modals on Escape
  ['add-sheet','about-sheet','settings-sheet','overview-sheet','snooze-sheet','activity-sheet','day-capacity-sheet','day-logs-sheet'].forEach(id=>{
    const el = $(id);
    if (el && el.classList.contains('open')) {
      e.preventDefault();
      // delegate to known close handlers
      if (id === 'add-sheet' && typeof cancelAdd === 'function') cancelAdd();
      else if (id === 'overview-sheet') closeSheet('overview-sheet');
      else if (id === 'settings-sheet') closeSheet('settings-sheet');
      else if (id === 'about-sheet') closeSheet('about-sheet');
      else if (id === 'snooze-sheet' && typeof closeSheet === 'function') closeSheet('snooze-sheet');
      else if (id === 'activity-sheet') { activityIdx = null; closeSheet('activity-sheet'); }
      else if (id === 'day-capacity-sheet') closeSheet('day-capacity-sheet');
      else if (id === 'day-logs-sheet') { dayLogsKey = null; closeSheet('day-logs-sheet'); }
    }
  });
});
