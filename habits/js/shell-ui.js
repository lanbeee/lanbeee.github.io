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
  // Drop or renumber the global timer so idx cannot retarget another habit.
  if(typeof habitTimer !== 'undefined' && habitTimer){
    if(habitTimer.idx === i){
      if(typeof clearHabitTimerSilent === 'function')clearHabitTimerSilent();
    }else if(habitTimer.idx > i){
      habitTimer.idx -= 1;
    }
  }
  if(typeof valueLogIdx !== 'undefined' && valueLogIdx != null){
    if(valueLogIdx === i){
      valueLogIdx = null;
      valueLogAfter = null;
      valueLogMinutes = null;
      if(typeof closeSheet === 'function')closeSheet('value-log-sheet');
    }else if(valueLogIdx > i){
      valueLogIdx -= 1;
    }
  }
  data.splice(i,1);
  if(typeof pruneOrderConstraintsForHabit === 'function'){
    pruneOrderConstraintsForHabit(removed,[],Date.now());
  }
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
  if(id === 'about-sheet' && typeof syncInstallGuideVisibility === 'function'){
    syncInstallGuideVisibility();
  }
  if(id === 'about-sheet' && typeof syncFeedbackLink === 'function'){
    syncFeedbackLink();
  }
  if (paneTierActive() && isFullPageSheet(id) && shouldMountInPane(id)) {
    mountInPane(id);
    return;
  }
  // The overview is a permanent pane on wide tiers; the modal is never opened.
  if (paneTierActive() && id === 'overview-sheet') {
    return;
  }
  $(id).classList.add('open');
  // Day-header pill taps often go through the forgiving/synthesized click path.
  // The trailing native click then lands on the freshly opened wrap and would
  // immediately dismiss it — ignore backdrop taps briefly after open.
  if(id === 'free-time-sheet' || id === 'slipped-sheet'){
    armSheetBackdropGuard(id);
  }
  updateFullPageState();
  updateKeyboardLift();
}

// HYBRID: ignore sheet-wrap backdrop clicks for a short window after open
function armSheetBackdropGuard(id,ms = 400){
  const wrap = $(id);
  if(!wrap)return;
  wrap.dataset.ignoreBackdropUntil = String(Date.now() + ms);
}
function sheetBackdropArmed(id){
  const wrap = $(id);
  if(!wrap)return false;
  const until = parseInt(wrap.dataset.ignoreBackdropUntil || '0',10);
  return Date.now() < until;
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
    if(typeof resetDayLogsStep === 'function')resetDayLogsStep();
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
  return id === 'detail-sheet' || id === 'about-sheet' || id === 'privacy-sheet' || id === 'overview-sheet' || id === 'settings-sheet' || id === 'sample-habits-sheet';
}

// PURE: checks if a sheet id mounts into the pane
function shouldMountInPane(id) {
  // Only the detail sheet is mounted into a pane. The overview lives in its
  // own permanent .pane-overview slot on wide tiers; about/settings stay as
  // centered modals.
  return id === 'detail-sheet';
}

// RENDER: toggles full-page chrome and locks every modal's background scroll.
// Use overflow locking only — never position:fixed. Fixing the body forces
// scrollY to 0, so unlocking always flashes a jump even when we restore.
function updateFullPageState(){
  const fullPageOpen = ['detail-sheet','about-sheet','privacy-sheet','overview-sheet','settings-sheet','sample-habits-sheet'].some(id=>$(id).classList.contains('open'));
  const modalOpen = Boolean(document.querySelector('.sheet-wrap.open'));
  document.body.classList.toggle('fullpage-open',fullPageOpen);
  if(modalOpen && !document.body.classList.contains('modal-open')){
    document.body.classList.add('modal-open');
  }else if(!modalOpen && document.body.classList.contains('modal-open')){
    // Drop focus inside the sheet (or the home card that opened it) before
    // unlocking. Otherwise Safari scrolls that target into view on close.
    const active = document.activeElement;
    if(active && active !== document.body && typeof active.blur === 'function' && active.closest?.('.sheet-wrap,.blocked-card,.travel-card')){
      active.blur();
    }
    document.body.classList.remove('modal-open');
  }
}

// RENDER: shows and auto-hides the toast message. Optional durationMs for
// longer notices (e.g. monthly retention cleanup).
function showToast(text,durationMs = 900){
  const toast = $('toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  const ms = Number.isFinite(durationMs) ? Math.max(900,durationMs) : 900;
  toastTimer = setTimeout(()=>toast.classList.remove('show'),ms);
}

// How long an app's own scheme gets to take over the page before the store
// fallback fires — short enough to feel instant, long enough for a slow
// handoff on an old phone.
const LINK_DIRECT_WAIT_MS = 1500;

// HANDLER: the fallback after a failed scheme handoff. A window.open this
// late is past the user gesture, so popup blockers would eat it — the page
// itself navigates instead. (Kept named so tests can observe it.)
function launchFallbackUrl(url){
  window.location.href = url;
}

/**
 * HANDLER: hand the page to the app's own scheme first; if the app never
 * takes over (usually: not installed), fall back to the stored page. Any
 * hide or blur cancels the fallback — that is the handoff succeeding.
 */
function openDirectWithFallback(direct,fallback){
  window.location.href = direct;
  let tookOver = false;
  const cancel = () => { tookOver = true; };
  window.addEventListener('pagehide',cancel,{ once:true });
  window.addEventListener('blur',cancel,{ once:true });
  document.addEventListener('visibilitychange',() => {
    if(document.visibilityState !== 'visible')cancel();
  },{ once:true });
  setTimeout(() => {
    if(tookOver || document.visibilityState !== 'visible')return;
    launchFallbackUrl(fallback);
  },LINK_DIRECT_WAIT_MS);
}

/**
 * HANDLER: launch a habit link (a call, a meeting room, any URL).
 * Must be called straight from a tap — both the popup blocker and iOS's
 * scheme handling depend on the user gesture still being active.
 * App shortcuts with a direct-open target (the app's own scheme) try that
 * first and fall back to the stored page when the app isn't installed.
 * Returns true when something was launched.
 */
function openHabitLink(link){
  const url = typeof linkLaunchUrl === 'function' ? linkLaunchUrl(link) : '';
  if(!url)return false;
  const direct = typeof linkDirectLaunchUrl === 'function' ? linkDirectLaunchUrl(link) : '';
  if(direct){
    if(linkHandsOffToOs(direct))openDirectWithFallback(direct,url);
    else window.open(direct,'_blank','noopener');
    return true;
  }
  if(linkHandsOffToOs(url))window.location.href = url;
  else window.open(url,'_blank','noopener');
  return true;
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
    // Minimal mode has no snooze anywhere else, so it must not appear here.
    const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
    const showSnooze = !minimal && action && action.plan && action.ts > Date.now();
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

// HYBRID: tracks "at top" state for the home feed. The header itself is
// non-sticky and scrolls away with content, so it only reappears at the scroll
// top — no reveal-on-scroll-up. The body class is kept for other consumers.
function updateHeaderOnScroll(){
  const y = window.scrollY;
  headerHidden = y > 12;
  headerRevealPull = 0;
  document.body.classList.toggle('header-hidden',headerHidden);
  lastScrollY = y;
}

// PURE: resolves forgiving button target from an event target.
// Optional clientX/clientY expand day-header open/not-today pills by a small
// hit slop so near-miss taps on sticky header chrome still arm the pill.
function forgivingButtonTarget(target, clientX, clientY){
  if(!target || typeof target.closest !== "function")return null;
  const btn = target.closest('button');
  if(btn){
    if(btn.closest('.ting-card'))return null;
    // These live directly in the vertically scrolling home feed and have their
    // own movement-aware activation. Synthesizing a forgiving click here can
    // open an editor or cancel a block before their scroll guards see pointerup.
    if(btn.matches('.travel-card') || btn.closest('.blocked-card'))return null;
    if(btn.closest('#settings-sheet'))return null;
    if(btn.closest('.month-nav'))return null;
    if(btn.classList.contains('cal-day'))return null;
    if(btn.closest('#overview-filter'))return null;
    if(btn.closest('#overview-pane-filter'))return null;
    if(btn.closest('#overview-insight'))return null;
    if(btn.closest('#overview-list'))return null;
    // Search toggles open+focus the field in their click handler, and the soft
    // keyboard only follows focus() made inside the trusted gesture task. A
    // forgiving click is synthesized a few frames later from an untrusted
    // event, so on phones it opens search with the keyboard withheld (or, if
    // the field ended up in the other tier's wrapper, with no field at all).
    // Let the native click through — browser tap slop already covers drift.
    if(btn.matches('#open-search,#bar-open-search'))return null;
    return btn;
  }
  if(clientX == null || clientY == null)return null;
  const header = target.closest('.section-header');
  if(!header)return null;
  const HIT_SLOP = 16;
  let best = null;
  let bestDist = Infinity;
  header.querySelectorAll('.free-pill,.dropped-pill').forEach(pill=>{
    const r = pill.getBoundingClientRect();
    if(clientX < r.left - HIT_SLOP || clientX > r.right + HIT_SLOP)return;
    if(clientY < r.top - HIT_SLOP || clientY > r.bottom + HIT_SLOP)return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.hypot(clientX - cx, clientY - cy);
    if(dist < bestDist){ best = pill; bestDist = dist; }
  });
  return best;
}

// PURE: true if target or any ancestor was flagged as mid-scroll.
// Click handlers must use this — checking only .overview-sheet._sg misses
// horizontal row guards (#overview-filter, .overview-open-chips, etc.).
function isScrollGuarded(target){
  for(let el = target; el; el = el.parentElement){
    if(el._sg)return true;
  }
  return false;
}

// WIRE: prevents accidental taps during scroll. Sets el._sg on touch/pointer
// displacement or scroll (capture phase catches descendant scrollers too),
// auto-disarms 500ms after the last movement.
// axis: 'y' = only vertical displacement arms, 'x' = only horizontal,
//       omitted = either axis arms.
// Safe to call more than once on the same element (idempotent).
function addScrollGuard(el,axis){
  if(!el || el._sgBound)return;
  el._sgBound = 1;
  var timer;
  function arm(){
    el._sg = 1;
    el.classList.add('scrolling');
    clearTimeout(timer);
    timer = setTimeout(function(){
      el._sg = 0;
      el.classList.remove('scrolling');
    },500);
  }
  (function(){
    var sx = null,sy = null;
    function start(x,y){ sx = x; sy = y; }
    function end(){ sx = null; sy = null; }
    function move(x,y){
      if(sx == null)return;
      var dx = Math.abs(x - sx), dy = Math.abs(y - sy);
      if(axis === 'y'){ if(dy > 8)arm(); }
      else if(axis === 'x'){ if(dx > 8)arm(); }
      else if(dx > 8 || dy > 8)arm();
    }
    el.addEventListener('touchstart',function(e){
      var t = e.changedTouches[0];
      start(t.clientX,t.clientY);
    },{passive:true});
    el.addEventListener('touchmove',function(e){
      var t = e.changedTouches[0];
      move(t.clientX,t.clientY);
    },{passive:true});
    el.addEventListener('touchend',end,{passive:true});
    el.addEventListener('touchcancel',end,{passive:true});
    // Pointer path covers mouse-drag and some WebKit streams where touch*
    // alone is not enough to arm before the synthesized click.
    el.addEventListener('pointerdown',function(e){
      if(e.pointerType === 'mouse' && e.button !== 0)return;
      start(e.clientX,e.clientY);
    },{passive:true});
    el.addEventListener('pointermove',function(e){
      move(e.clientX,e.clientY);
    },{passive:true});
    el.addEventListener('pointerup',end,{passive:true});
    el.addEventListener('pointercancel',end,{passive:true});
  })();
  el.addEventListener('scroll',arm,{passive:true,capture:true});
}

// WIRE: scroll guards for calendar overview + day-logs. Horizontal rows get
// their own guards (sheet axis:'y' alone never arms on a sideways swipe).
// Pane mode scrolls .pane-overview, not .overview-sheet.
function bindOverviewScrollGuards(){
  addScrollGuard(document.querySelector('.overview-sheet'),'y');
  addScrollGuard(document.querySelector('.pane-overview'),'y');
  addScrollGuard(document.querySelector('.day-logs-sheet'),'y');
  addScrollGuard($('overview-filter'),'x');
  addScrollGuard($('overview-pane-filter'),'x');
  // Insight host persists across re-renders; capture catches .overview-open-chips.
  addScrollGuard($('overview-insight'),'x');
  addScrollGuard($('overview-list'),'y');
}

// WIRE: attaches forgiving pointer tap handlers to a calendar
function bindCalendarTap(container,selector,handler){
  if(!container)return; // calendar element not present
  // Any horizontally-scrollable pager this calendar lives inside of (the
  // detail sheet's calendar/insight/schedule pager). Swiping between those pages
  // often starts the gesture on top of a calendar cell, so a tap here has to
  // be sure the pager never actually moved - not just that the finger ended
  // up close to where it started.
  const pager = container.closest('.detail-pager');
  let ignoreClickUntil = 0;
  let handledClickUntil = 0;

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
    if(moved > 6 || scrolled > 1 || pagerScrolled > 1 || Date.now() - tap.time > 650){
      ignoreClickUntil = Date.now() + 500;
      return;
    }
    if(!tap.pager){
      handledClickUntil = Date.now() + 500;
      handler(tap.day,e);
      return;
    }
    // A fast flick can release with almost no finger movement yet still carry
    // the pager into its momentum/snap animation a moment later. Wait two
    // frames and confirm the pager truly settled before treating this as a tap.
    // Claim the tap immediately so the synthesized click (which fires before
    // those frames) cannot also invoke the handler and double-log an entry.
    handledClickUntil = Date.now() + 500;
    const settleScrollLeft = tap.pager.scrollLeft;
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        if(Math.abs(tap.pager.scrollLeft - settleScrollLeft) > 1){
          ignoreClickUntil = Date.now() + 500;
          return;
        }
        handledClickUntil = Date.now() + 500;
        handler(tap.day,e);
      });
    });
  },{passive:true});

  container.addEventListener('pointercancel',()=>{
    if(!calendarPointer || calendarPointer.container !== container)return;
    const tap = calendarPointer;
    calendarPointer = null;
    const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
    const pagerScrolled = tap.pager ? Math.abs(tap.pager.scrollLeft - tap.pagerScrollLeft) : 0;
    if(tap.maxMove > 6 || scrolled > 1 || pagerScrolled > 1)ignoreClickUntil = Date.now() + 500;
  },{passive:true});

  // WebKit can emit a clean click after claiming/cancelling the pointer stream.
  // Keep a click/keyboard fallback, while the timestamps above deduplicate a
  // normal pointerup and reject clicks following an actual scroll gesture.
  container.addEventListener('click',e=>{
    const day = e.target.closest(selector);
    if(!day || !container.contains(day))return;
    if(Date.now() < handledClickUntil){
      e.preventDefault();
      return;
    }
    if(Date.now() < ignoreClickUntil){
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    handledClickUntil = Date.now() + 500;
    handler(day,e);
  });
}

document.addEventListener('pointerdown',e=>{
  if(shouldDismissSearchFromTap(e.target)){
    searchDismissPointer = {id:e.pointerId,x:e.clientX,y:e.clientY};
    return;
  }
  searchDismissPointer = null;
  const btn = forgivingButtonTarget(e.target, e.clientX, e.clientY);
  if(!btn)return;
  // Snapshot every scrollable ancestor (vertical and horizontal) so a scroll
  // or swipe that starts anywhere over the button is never mistaken for a tap,
  // no matter which element actually moves — home window, pane list, sheets,
  // detail pages and the detail pager all land here.
  const scrollers = [];
  for(let el = btn.parentElement; el; el = el.parentElement){
    if((el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1)){
      scrollers.push([el,el.scrollTop,el.scrollLeft]);
    }
    if(el === document.documentElement)break;
  }
  // Window scroll (home list) can disagree with documentElement/body accounting
  // across engines — track it explicitly as a virtual scroller.
  scrollers.push([
    {get scrollTop(){return window.scrollY;},get scrollLeft(){return window.scrollX;}},
    window.scrollY,
    window.scrollX
  ]);
  // Detail-head buttons are siblings of the scrollable pages, so a page scroll
  // or pager swipe that starts on the head would escape the ancestor walk.
  // Snapshot the detail pager and its live pages explicitly.
  const detailSheet = btn.closest('.detail-sheet');
  if(detailSheet){
    const pager = detailSheet.querySelector('.detail-pager');
    if(pager){
      if(pager.scrollWidth > pager.clientWidth + 1){
        scrollers.push([pager,pager.scrollTop,pager.scrollLeft]);
      }
      for(const page of pager.querySelectorAll('.detail-page')){
        if(!page.hidden && page.scrollHeight > page.clientHeight + 1){
          scrollers.push([page,page.scrollTop,page.scrollLeft]);
        }
      }
    }
  }
  buttonPointer = {
    btn,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),
    maxMove:0,
    // True when the finger missed the button box but hit-slop still armed it.
    armedBySlop: e.target.closest('button') !== btn,
    scrollers
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
  const {btn,x,y,time,armedBySlop,scrollers} = buttonPointer;
  buttonPointer = null;
  if(btn.disabled)return;
  const dx = Math.abs(e.clientX - x);
  const dy = Math.abs(e.clientY - y);
  const moved = Math.hypot(dx,dy);
  if(btn.disabled)return;
  if(btn.classList.contains('timer-start-btn'))return;
  // Movement cap for the forgiving click. A sloppy tap drifts a few tens of
  // pixels at most (pointercancel recovery already caps at 32); anything
  // larger is a scroll or swipe gesture — including pans the scroll checks
  // below can't observe (e.g. a cancelled flick whose scroller never moved,
  // or a downward drag at scrollTop 0 that never moves the page). Eat the
  // trailing native click so a pan that starts on a button cannot activate it.
  if(moved > 32){
    suppressNativeButton = btn;
    setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},400);
    return;
  }
  if(Date.now() - time >= 1200)return;

  const headerPill = btn.matches('.free-pill,.dropped-pill');
  // Drift → forgiving click. Slop-armed header pills (finger never on the
  // button/::before) also need a synthesized click. Exact on-pill taps,
  // including CSS hit-pad ::before hits, keep the native click path.
  const shouldClick = moved > 8 || (headerPill && armedBySlop);
  if(!shouldClick)return;

  suppressNativeButton = btn;
  e.preventDefault();
  e.stopPropagation();
  // Clear suppress if settle-wait bails (scroll/swipe) so later taps still work;
  // also covers a trailing native click after a cancelled-looking gesture.
  setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},400);
  deferForgivingClick(scrollers,btn,{x,y,ended:true});
},true);

// The forgiving click must not land when the gesture actually scrolled or
// swiped a page: in touch browsers a pointercancel (and sometimes a pointerup)
// can arrive before the page starts moving, so the scroll deltas read at
// cancel/up time are still zero. Wait until snapshotted scrollers settle (or
// a short timeout), then bail if any moved — CDP may trickle scroll slowly,
// while real devices usually jump in one frame. Any real pan is "not a tap";
// leftover smooth scrollIntoView animations are a test concern (use instant).
// pointercancel also arrives a few pixels into a pan-y claim, *before* the
// rest of the finger travel (and before a bounded overscroll that never
// changes scrollTop). Wait for that touch to end and count its displacement
// so a downward drag at scrollY 0 is not recovered as a tap.
const FORGIVING_SCROLL_FLOOR = 2;
const FORGIVING_SETTLE_MS = 150;
const FORGIVING_MIN_WAIT_MS = 32;
const FORGIVING_TOUCH_WAIT_MS = 500;

function scrollerDelta(scrollers){
  let moved = 0;
  for(const [el,top,left] of scrollers){
    const dTop = Math.abs(el.scrollTop - top);
    const dLeft = Math.abs(el.scrollLeft - left);
    if(dTop > moved)moved = dTop;
    if(dLeft > moved)moved = dLeft;
  }
  return moved;
}

function deferForgivingClick(scrollers,btn,opts){
  const t0 = performance.now();
  const startX = opts && Number.isFinite(opts.x) ? opts.x : null;
  const startY = opts && Number.isFinite(opts.y) ? opts.y : null;
  let touchEnded = !!(opts && opts.ended);
  let maxFinger = 0;
  let lastMoved = scrollerDelta(scrollers);
  let stableFrames = 0;
  let done = false;

  function finger(x,y){
    if(startX == null)return;
    const dist = Math.hypot(x - startX, y - startY);
    if(dist > maxFinger)maxFinger = dist;
    if(maxFinger > 32)finish(false);
  }

  const onScroll = ()=>{
    if(done)return;
    if(scrollerDelta(scrollers) > FORGIVING_SCROLL_FLOOR)finish(false);
  };
  const onTouchMove = e=>{
    if(done)return;
    const t = e.changedTouches[0];
    if(t)finger(t.clientX, t.clientY);
  };
  const onTouchEnd = e=>{
    if(done)return;
    const t = e.changedTouches[0];
    if(t)finger(t.clientX, t.clientY);
    touchEnded = true;
  };
  const listened = [];
  for(const [el] of scrollers){
    if(!el || typeof el.addEventListener !== 'function')continue;
    el.addEventListener('scroll',onScroll,{passive:true,capture:true});
    listened.push(el);
  }
  window.addEventListener('scroll',onScroll,{passive:true,capture:true});
  window.addEventListener('touchmove',onTouchMove,{passive:true,capture:true});
  window.addEventListener('touchend',onTouchEnd,{passive:true,capture:true});
  window.addEventListener('touchcancel',onTouchEnd,{passive:true,capture:true});

  function cleanup(){
    for(const el of listened)el.removeEventListener('scroll',onScroll,{capture:true});
    window.removeEventListener('scroll',onScroll,{capture:true});
    window.removeEventListener('touchmove',onTouchMove,{capture:true});
    window.removeEventListener('touchend',onTouchEnd,{capture:true});
    window.removeEventListener('touchcancel',onTouchEnd,{capture:true});
  }

  function finish(shouldClick){
    if(done)return;
    done = true;
    cleanup();
    if(!shouldClick || btn.disabled){
      suppressNativeButton = btn;
      setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},80);
      return;
    }
    // Let our own click through, then re-arm so the browser's own trailing
    // click (a cancelled gesture can still synthesize one over the button)
    // is eaten by the suppression listener.
    suppressNativeButton = null;
    btn.click();
    suppressNativeButton = btn;
    setTimeout(()=>{if(suppressNativeButton === btn)suppressNativeButton = null;},80);
  }

  function tick(){
    if(done)return;
    if(btn.disabled){finish(false);return;}
    if(maxFinger > 32){finish(false);return;}
    const moved = scrollerDelta(scrollers);
    if(moved > FORGIVING_SCROLL_FLOOR){finish(false);return;}
    if(moved === lastMoved)stableFrames += 1;
    else{lastMoved = moved;stableFrames = 0;}
    const elapsed = performance.now() - t0;
    // pointercancel often precedes the rest of a pan. Do not recover as a
    // tap while that finger is still down.
    if(!touchEnded){
      if(elapsed >= FORGIVING_TOUCH_WAIT_MS){finish(false);return;}
      requestAnimationFrame(tick);
      return;
    }
    if((stableFrames >= 2 && elapsed >= FORGIVING_MIN_WAIT_MS) || elapsed >= FORGIVING_SETTLE_MS){
      finish(scrollerDelta(scrollers) <= FORGIVING_SCROLL_FLOOR && maxFinger <= 32);
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

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
  // A cancelled gesture means the browser claimed the pointer for a pan. It
  // may still synthesize a click over the button once the pan settles (the
  // same late click bindCalendarTap defends against), so always suppress the
  // button's trailing click; a real tap-with-drift is re-fired by
  // deferForgivingClick below. The scroll deltas read here are often still
  // zero (the browser cancels into a pan before the page moves), so the real
  // scroll/swipe check runs inside deferForgivingClick after the gesture has
  // settled.
  suppressNativeButton = tap.btn;
  setTimeout(()=>{if(suppressNativeButton === tap.btn)suppressNativeButton = null;},500);
  if(tap.maxMove <= 32 && Date.now() - tap.time < 450){
    deferForgivingClick(tap.scrollers,tap.btn,{x:tap.x,y:tap.y,ended:false});
  }
},true);

document.addEventListener('click',e=>{
  if(suppressNativeButton && e.target.closest('button') === suppressNativeButton){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
    return;
  }
  const btn = forgivingButtonTarget(e.target, e.clientX, e.clientY);
  if(btn && btn === suppressNativeButton){
    e.preventDefault();
    e.stopPropagation();
    suppressNativeButton = null;
    return;
  }
},true);

document.addEventListener('tierchange',()=>{
  reparentSearch();
  // Re-sync open-state chrome to the new tier: the field moved wrappers above,
  // so isSearchOpen() now reads the other tier's flag and updateSearchUi clears
  // the stale class (list-view-home.js keeps one tier authoritative).
  if (typeof updateSearchUi === 'function') updateSearchUi();
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
  ['detail-sheet','about-sheet','privacy-sheet','overview-sheet','settings-sheet','sample-habits-sheet','home-filter-sheet','calendar-filter-sheet'].forEach(id=>{
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

// Escape closes only the topmost visible surface. Nested calendar filters/day
// details sit above the overview; dismissing one should reveal the calendar,
// not close the entire stack in a single keypress.
document.addEventListener('keydown',e=>{
  if (e.key !== 'Escape') return;
  const modalIds = ['add-sheet','privacy-sheet','about-sheet','settings-sheet','sample-habits-sheet','overview-sheet','home-filter-sheet','calendar-filter-sheet','snooze-sheet','activity-sheet','day-capacity-sheet','day-logs-sheet','slipped-sheet','free-time-sheet'];
  const openModals = modalIds
    .map((id,index)=>({id,index,el:$(id)}))
    .filter(item=>item.el?.classList.contains('open'))
    .sort((a,b)=>{
      const za = parseInt(getComputedStyle(a.el).zIndex,10) || 0;
      const zb = parseInt(getComputedStyle(b.el).zIndex,10) || 0;
      return zb - za || b.index - a.index;
    });
  const top = openModals[0];
  if(top){
    e.preventDefault();
    const id = top.id;
    if (id === 'add-sheet' && typeof cancelAdd === 'function') cancelAdd();
    else if (id === 'overview-sheet') closeSheet('overview-sheet');
    else if (id === 'settings-sheet') closeSheet('settings-sheet');
    else if (id === 'about-sheet') closeSheet('about-sheet');
    else if (id === 'privacy-sheet') closeSheet('privacy-sheet');
    else if (id === 'sample-habits-sheet') closeSheet('sample-habits-sheet');
    else if (id === 'home-filter-sheet') closeSheet('home-filter-sheet');
    else if (id === 'calendar-filter-sheet') closeSheet('calendar-filter-sheet');
    else if (id === 'snooze-sheet' && typeof closeSheet === 'function') closeSheet('snooze-sheet');
    else if (id === 'activity-sheet') { activityIdx = null; closeSheet('activity-sheet'); }
    else if (id === 'day-capacity-sheet') closeSheet('day-capacity-sheet');
    else if (id === 'day-logs-sheet') { if(typeof closeDayLogsSheet === 'function') closeDayLogsSheet({refreshOverview:!dayLogsScoped()}); else { dayLogsKey = null; if(typeof resetDayLogsStep === 'function')resetDayLogsStep(); closeSheet('day-logs-sheet'); } }
    else if (id === 'slipped-sheet') closeSheet('slipped-sheet');
    else if (id === 'free-time-sheet') closeSheet('free-time-sheet');
    return;
  }
  const pane = getPane();
  if (pane && pane.dataset.activeSheet) {
    e.preventDefault();
    const id = pane.dataset.activeSheet;
    unmountPane();
    if (id === 'detail-sheet' && typeof closeDetail === 'function') closeDetail();
  }
});
