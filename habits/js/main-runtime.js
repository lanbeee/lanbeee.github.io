let valueLogIdx = null;
let valueLogAfter = null;
let valueLogMinutes = null;
function openValueLogSheet(idx,after,sessionMinutes){
  const incomingSession = Number.isFinite(sessionMinutes) && sessionMinutes > 0;
  // Session confirm owns the sheet — don't silently overwrite it with a
  // plain value prompt (or another habit's session).
  if(valueLogMinutes != null && !incomingSession){
    if(typeof showToast === 'function')showToast('finish or discard the session first');
    return;
  }
  if(valueLogMinutes != null && incomingSession && valueLogIdx != null && valueLogIdx !== idx){
    if(typeof showToast === 'function')showToast('session discarded');
    valueLogIdx = null;
    valueLogAfter = null;
    valueLogMinutes = null;
  }
  valueLogIdx = idx;
  valueLogAfter = after || null;
  valueLogMinutes = incomingSession ? sessionMinutes : null;
  const h = load()[idx];
  const sheet = $('value-log-sheet');
  const copy = $('value-log-copy');
  const title = sheet ? sheet.querySelector('.sheet-title') : null;
  const valueField = sheet ? sheet.querySelector('[aria-label="value"]') : null;
  const skipBtn = $('value-log-skip');
  const cancelBtn = $('value-log-cancel');
  const saveBtn = $('value-log-save');
  if(valueLogMinutes != null){
    // Timer-session confirm: log the timed session, optionally with a value
    // or note, or discard. Discard creates no entry — an accidental stop
    // never silently completes a task.
    if(title)title.textContent = 'log session';
    if(copy)copy.textContent = `${valueLogMinutes}m session${h ? ' for ' + h.name : ''}. Add a note or value, or discard.`;
    if(valueField)valueField.style.display = h && h.trackValue ? '' : 'none';
    if(skipBtn)skipBtn.hidden = true;
    if(cancelBtn){ cancelBtn.hidden = false; cancelBtn.textContent = 'discard'; }
    if(saveBtn)saveBtn.textContent = 'log';
  }else{
    if(title)title.textContent = 'log value';
    if(copy)copy.textContent = h ? `Number for ${h.name}` : 'Optional number for this entry.';
    if(valueField)valueField.style.display = '';
    if(skipBtn)skipBtn.hidden = false;
    if(cancelBtn){ cancelBtn.hidden = false; cancelBtn.textContent = 'cancel'; }
    if(saveBtn)saveBtn.textContent = 'log';
  }
  const input = $('value-log-input');
  if(input)input.value = '';
  const noteEl = $('value-log-note');
  if(noteEl)noteEl.value = '';
  openSheet('value-log-sheet');
  const focusTarget = (valueLogMinutes != null && (!h || !h.trackValue)) ? noteEl : input;
  requestAnimationFrame(()=>focusTarget?.focus());
}
function finishValueLog(opts){
  const idx = valueLogIdx;
  const after = valueLogAfter;
  const minutes = valueLogMinutes;
  const wasSession = minutes != null;
  valueLogIdx = null;
  valueLogAfter = null;
  valueLogMinutes = null;
  closeSheet('value-log-sheet');
  if(idx == null)return;
  const h = typeof load === 'function' ? load()[idx] : null;
  // Sweep (or pulse) may have completed the task while the sheet was open —
  // never add a second entry from a stale confirm.
  if(wasSession && h && h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)){
    if(typeof showToast === 'function')showToast('already logged');
    if(typeof render === 'function')render();
    return;
  }
  const full = {...(opts || {})};
  if(minutes != null)full.minutes = minutes;
  if(!logTing(idx,full))return;
  if(typeof after === 'function')after();
}
$('value-log-save')?.addEventListener('click',()=>{
  const raw = $('value-log-input')?.value?.trim();
  const note = $('value-log-note')?.value?.trim() || '';
  const n = raw === '' ? undefined : Number(raw);
  if(raw !== '' && !Number.isFinite(n)){ showToast('enter a number'); return; }
  const opts = {};
  if(raw !== '')opts.value = n;
  if(note)opts.note = note;
  finishValueLog(opts);
});
$('value-log-skip')?.addEventListener('click',()=>finishValueLog({}));
// Discard / backdrop: no entry. Session discard restores any pending auto
// bar on the next render so the habit isn't left in a half-stopped state.
function discardValueLogSheet(){
  const wasSession = valueLogMinutes != null;
  const idx = valueLogIdx;
  valueLogIdx = null;
  valueLogAfter = null;
  valueLogMinutes = null;
  closeSheet('value-log-sheet');
  if(wasSession){
    const h = idx != null && typeof load === 'function' ? load()[idx] : null;
    const alreadyDone = h && h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h);
    if(typeof showToast === 'function')showToast(alreadyDone ? 'already logged' : 'session discarded');
  }
  if(typeof render === 'function')render();
}
$('value-log-cancel')?.addEventListener('click',discardValueLogSheet);
$('value-log-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)discardValueLogSheet();
});

/** Prompt for a value when trackValue is on, otherwise log immediately. */
function requestLogTing(idx,after,opts){
  const h = load()[idx];
  if(!h)return;
  if(h.trackValue){
    openValueLogSheet(idx,after,opts && opts.minutes);
    return;
  }
  if(!logTing(idx,opts || {}))return;
  if(typeof after === 'function')after();
}

// One live timer for the persisted active-focus session.
let habitTimer = null;

// PURE: minutes to store from a timed session
function timerSessionMinutes(h,elapsedMin){
  const elapsed = Math.max(1,Math.round(Number(elapsedMin) || 0));
  if(h && h.breakable && typeof remainingDurationMinutes === 'function'){
    return Math.min(elapsed,Math.max(0,remainingDurationMinutes(h)));
  }
  return elapsed;
}

// PURE: whether this habit can run a session timer from home/detail.
// Breakable tasks stay eligible until fully done (remaining minutes = 0).
function habitTimerEligible(h){
  if(!h || h.type === 'zero')return false;
  if(h.type === 'task'){
    if(typeof isTaskDone === 'function')return !isTaskDone(h);
    return h.lastLog === null;
  }
  return true;
}

// RENDER: detail Effort timer button + countdown from habitTimer
function syncDetailTimerUi(){
  const btn = $('detail-timer-toggle');
  const display = $('detail-timer-display');
  if(!btn && !display)return;
  if(habitTimer && detailIdx !== null && habitTimer.idx === detailIdx){
    if(btn){
      btn.textContent = 'stop session';
      btn.disabled = false;
      btn.setAttribute('aria-disabled','false');
    }
    if(display)display.hidden = false;
    return;
  }
  const h = detailIdx != null && typeof load === 'function' ? load()[detailIdx] : null;
  const eligible = habitTimerEligible(h);
  if(btn){
    btn.textContent = 'start session';
    btn.disabled = !eligible;
    btn.setAttribute('aria-disabled', eligible ? 'false' : 'true');
  }
  if(display){
    display.hidden = true;
    display.textContent = '';
  }
}

function stopHabitTimer(promptLog,manual){
  const btn = $('detail-timer-toggle');
  const display = $('detail-timer-display');
  if(habitTimer){
    clearInterval(habitTimer.interval);
    const elapsedMin = Math.max(1,Math.round((Date.now() - habitTimer.startedAt) / 60000));
    const idx = habitTimer.idx;
    const activeHabit = typeof load === 'function' ? load()[idx] : null;
    habitTimer = null;
    if(activeHabit && activeHabit.hid && typeof clearDoingNow === 'function'){
      clearDoingNow(activeHabit.hid);
    }
    if(btn)btn.textContent = 'start session';
    if(display)display.hidden = true;
    if(promptLog && idx != null){
      const h = load()[idx];
      if(!h){
        syncDetailTimerUi();
        if(typeof render === 'function')render();
        return;
      }
      // Already completed (pulse, auto-mark sweep, etc.) — never open a
      // second log sheet for the same session.
      if(!habitTimerEligible(h)){
        syncDetailTimerUi();
        if(typeof render === 'function')render();
        return;
      }
      const sessionMinutes = timerSessionMinutes(h,elapsedMin);
      if(sessionMinutes <= 0){
        syncDetailTimerUi();
        if(typeof render === 'function')render();
        return;
      }
      const after = ()=>{ if(detailIdx === idx)openDetail(idx); render(); };
      if(manual){
        // Manual stop: confirm before logging. An accidental tap never
        // silently completes a task — the sheet offers a discard path that
        // creates no entry, plus an optional note/value for the session.
        openValueLogSheet(idx,after,sessionMinutes);
        if(typeof render === 'function')render();
        return;
      }
      // Auto-stop (timer ran its course): log the session automatically.
      // trackValue habits still get their value prompt with elapsed minutes; undo is available.
      if(h.trackValue){
        openValueLogSheet(idx,after,sessionMinutes);
        if(typeof render === 'function')render();
      }else{
        logTing(idx,{minutes:sessionMinutes});
        if(detailIdx === idx)openDetail(idx);
        render();
      }
    }else if(typeof render === 'function'){
      syncDetailTimerUi();
      render();
    }
  }
}

// Clear a running timer without logging — used when the habit was completed
// another way (pulse, auto-mark sweep) while the timer was still open.
function clearHabitTimerSilent(opts = {}){
  if(!habitTimer)return;
  const idx = habitTimer.idx;
  const h = typeof load === 'function' ? load()[idx] : null;
  clearInterval(habitTimer.interval);
  habitTimer = null;
  if(opts.keepDoingNow !== true && h && h.hid && typeof clearDoingNow === 'function'){
    clearDoingNow(h.hid);
  }
  syncDetailTimerUi();
}

// If a session confirm is open for a task that just completed elsewhere,
// close it so Log cannot double-entry.
function invalidateOpenSessionIfDone(){
  if(valueLogMinutes == null || valueLogIdx == null)return false;
  const h = typeof load === 'function' ? load()[valueLogIdx] : null;
  if(!(h && h.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(h)))return false;
  valueLogIdx = null;
  valueLogAfter = null;
  valueLogMinutes = null;
  closeSheet('value-log-sheet');
  return true;
}

// After sweeps / external logs: drop a stale timer and any open session sheet.
function syncTimerAfterExternalCompletion(opts = {}){
  const toast = opts.toast !== false;
  let cleared = false;
  if(habitTimer){
    const h = typeof load === 'function' ? load()[habitTimer.idx] : null;
    if(!habitTimerEligible(h)){
      clearHabitTimerSilent();
      cleared = true;
    }
  }
  const closedSheet = invalidateOpenSessionIfDone();
  if((cleared || closedSheet) && toast && typeof showToast === 'function')showToast('already logged');
  if((cleared || closedSheet) && typeof render === 'function')render();
  return cleared || closedSheet;
}

// HYBRID: start the app's single active session. Swipe/detail starts are
// manual by default; reorder-to-top explicitly opts into auto completion.
function startHabitTimer(idx,opts = {}){
  if(idx == null || idx < 0)return false;
  if(habitTimer){
    if(habitTimer.idx === idx){
      if(opts.completionMode === 'auto' && habitTimer.completionMode !== 'auto'){
        const active = load()[idx];
        if(active && active.hid && typeof setDoingNow === 'function'){
          const now = Date.now();
          const sessionMinutes = Math.max(1,Math.min(720,Math.round(
            Number(opts.sessionMinutes)
              || Number(habitTimer.targetMs) / 60000
              || clampDuration(active.durationMinutes)
          )));
          const startedAt = Number(opts.startedAt) || now;
          const targetAt = Number(opts.targetAt)
            || Number(opts.endsAt)
            || startedAt + sessionMinutes * 60000;
          habitTimer.startedAt = startedAt;
          habitTimer.targetMs = Math.max(1,targetAt - startedAt);
          habitTimer.autoStopMs = habitTimer.targetMs;
          habitTimer.completionMode = 'auto';
          setDoingNow(active.hid,startedAt,dayStart(now),{
            sessionMinutes,
            targetAt,
            completionMode:'auto'
          });
        }
      }
      syncDetailTimerUi();
      return true;
    }
    if(typeof showToast === 'function')showToast('stop the active session first');
    return false;
  }
  const h = load()[idx];
  if(!habitTimerEligible(h))return false;
  const now = Date.now();
  let doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  const doingActive = doing && typeof isDoingNowActive === 'function'
    ? isDoingNowActive(doing,now)
    : Boolean(doing);
  if(doing && !doingActive){
    if(typeof clearDoingNow === 'function')clearDoingNow();
    doing = null;
  }
  if(doing && doing.hid !== h.hid){
    const owner = load().find(item=>item && item.hid === doing.hid);
    if(typeof showToast === 'function'){
      showToast(`${owner ? toastItemName(owner) : 'another habit'} is already active`);
    }
    return false;
  }
  const adopted = doing && doing.hid === h.hid ? doing : null;
  const completionMode = opts.completionMode === 'auto'
    ? 'auto'
    : opts.completionMode === 'manual'
      ? 'manual'
      : (adopted && adopted.completionMode === 'auto' ? 'auto' : 'manual');
  const defaultMin = typeof doingNowSessionMinutesFor === 'function'
    ? doingNowSessionMinutesFor(h,now)
    : clampDuration(h.durationMinutes);
  const sessionMinutes = Math.max(1,Math.min(720,Math.round(
    Number(opts.sessionMinutes)
      || Number(adopted && adopted.sessionMinutes)
      || Number(h.timerAutoStopMinutes)
      || defaultMin
  )));
  const startedAt = Number(opts.startedAt)
    || Number(adopted && adopted.startedAt)
    || now;
  const targetAt = Number(opts.targetAt)
    || Number(opts.endsAt)
    || Number(adopted && adopted.targetAt)
    || Number(adopted && adopted.endsAt)
    || startedAt + sessionMinutes * 60000;
  if(typeof setDoingNow === 'function'){
    setDoingNow(h.hid,startedAt,dayStart(now),{
      sessionMinutes,
      targetAt,
      completionMode
    });
  }
  habitTimer = {
    idx,
    startedAt,
    targetMs:Math.max(1,targetAt - startedAt),
    // Retained as a read-only alias for older view/test integrations.
    autoStopMs:Math.max(1,targetAt - startedAt),
    completionMode,
    interval:setInterval(tickHabitTimer,250)
  };
  syncDetailTimerUi();
  if(opts.toast !== false && typeof showToast === 'function'){
    showToast(`session started · ${toastItemName(h)} · ${sessionMinutes}m target`);
  }
  if(typeof render === 'function')render();
  tickHabitTimer();
  return true;
}

function tickHabitTimer(){
  if(!habitTimer)return;
  const idx = habitTimer.idx;
  const h = typeof load === 'function' ? load()[idx] : null;
  // Habit finished elsewhere (auto-mark, pulse, detail log) — drop the
  // timer quietly so we never prompt to log twice.
  if(!habitTimerEligible(h)){
    clearHabitTimerSilent();
    invalidateOpenSessionIfDone();
    if(typeof showToast === 'function')showToast('already logged');
    if(typeof render === 'function')render();
    return;
  }
  const elapsed = Date.now() - habitTimer.startedAt;
  const targetMs = Math.max(1,habitTimer.targetMs || habitTimer.autoStopMs || 0);
  const left = Math.max(0,targetMs - elapsed);
  const display = $('detail-timer-display');
  if(display && detailIdx === habitTimer.idx){
    const reached = elapsed >= targetMs;
    const shownMs = reached ? elapsed : left;
    const sec = Math.max(0,Math.floor(shownMs / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    display.textContent = reached && habitTimer.completionMode !== 'auto'
      ? `target reached · ${m}:${String(s).padStart(2,'0')} elapsed`
      : `${m}:${String(s).padStart(2,'0')}`;
    display.hidden = false;
  }
  if(typeof updateHomeSessionProgress === 'function')updateHomeSessionProgress();
  if(left <= 0 && habitTimer.completionMode === 'auto'){
    if(typeof sweepDoingNowOneShot === 'function'){
      const swept = sweepDoingNowOneShot(Date.now(),{refresh:true,toast:true});
      // An already-completed habit clears its persisted Doing now record
      // without adding another log. Retire the matching live timer too.
      if(!swept && habitTimer && typeof getDoingNow === 'function' && !getDoingNow()){
        clearHabitTimerSilent();
        if(typeof render === 'function')render();
      }
    }
  }
}

// Restore the persisted active focus after a reload. Expired auto sessions
// are left for the one-shot sweep; manual sessions resume beyond their target.
function restoreHabitTimer(){
  if(habitTimer || typeof getDoingNow !== 'function')return false;
  const doing = getDoingNow();
  if(!doing || !doing.hid)return false;
  if(doing.completionMode === 'auto'
    && typeof doingNowAutoMarkDeadline === 'function'
    && doingNowAutoMarkDeadline(doing) <= Date.now()){
    return false;
  }
  const idx = load().findIndex(h=>h && h.hid === doing.hid);
  if(idx < 0){
    if(typeof clearDoingNow === 'function')clearDoingNow();
    return false;
  }
  return startHabitTimer(idx,{
    sessionMinutes:doing.sessionMinutes,
    startedAt:doing.startedAt,
    targetAt:doing.targetAt,
    completionMode:doing.completionMode,
    toast:false
  });
}
function bindScrollSafeTap(btn,handler){
  if(!btn)return;
  let ptr = null;
  btn.addEventListener('pointerdown',e=>{
    if(e.button !== 0 && e.pointerType === 'mouse')return;
    const scrollHost = btn.closest('.sheet');
    const pager = btn.closest('.detail-pager');
    ptr = {
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
  btn.addEventListener('pointermove',e=>{
    if(!ptr || ptr.id !== e.pointerId)return;
    const dist = Math.hypot(e.clientX - ptr.x,e.clientY - ptr.y);
    if(dist > ptr.maxMove)ptr.maxMove = dist;
  },{passive:true});
  const finish = e=>{
    if(!ptr || ptr.id !== e.pointerId)return;
    const tap = ptr;
    ptr = null;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX - tap.x,e.clientY - tap.y));
    const scrolled = tap.scrollHost ? Math.abs(tap.scrollHost.scrollTop - tap.scrollTop) : 0;
    const pagerScrolled = tap.pager ? Math.abs(tap.pager.scrollLeft - tap.pagerScrollLeft) : 0;
    if(moved > 6 || scrolled > 1 || pagerScrolled > 1 || Date.now() - tap.time > 650)return;
    handler(e);
  };
  btn.addEventListener('pointerup',finish,{passive:true});
  btn.addEventListener('pointercancel',e=>{
    if(!ptr || ptr.id !== e.pointerId)return;
    ptr = null;
  },{passive:true});
  btn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
  });
}
window.stopHabitTimer = stopHabitTimer;
window.startHabitTimer = startHabitTimer;
window.clearHabitTimerSilent = clearHabitTimerSilent;
window.syncTimerAfterExternalCompletion = syncTimerAfterExternalCompletion;
window.restoreHabitTimer = restoreHabitTimer;
bindScrollSafeTap($('detail-timer-toggle'),()=>{
  if(detailIdx === null)return;
  if(habitTimer && habitTimer.idx === detailIdx){
    stopHabitTimer(true,true); // manual stop → confirm before logging
    return;
  }
  if(startHabitTimer(detailIdx))return;
  const h = load()[detailIdx];
  if(!h || habitTimer)return; // other-timer toast already shown
  if(typeof showToast === 'function'){
    showToast(h.type === 'zero' ? 'timer not available' : 'already done');
  }
});
$('detail-breakable')?.addEventListener('click',function(){
  const pressed = this.getAttribute('aria-pressed') === 'true';
  this.setAttribute('aria-pressed',String(!pressed));
  syncBreakableUi();
  setDetailDirty();
});
$('detail-min-chunk')?.addEventListener('input',()=>setDetailDirty());
$('detail-track-value')?.addEventListener('click',function(){
  const pressed = this.getAttribute('aria-pressed') === 'true';
  this.setAttribute('aria-pressed',String(!pressed));
  setDetailDirty();
});
$('detail-shared-display')?.addEventListener('click',function(){
  const pressed = this.getAttribute('aria-pressed') === 'true';
  this.setAttribute('aria-pressed',String(!pressed));
  setDetailDirty();
});
bindCompactNumber('detail-min-chunk',clampMinChunk,{maxLength:3});
function openDayLogsAfterCalendarGesture(key,{refreshOverview = false} = {}){
  if(!key)return;
  dayLogsKey = key;
  resetDayLogsStep(); // clears habit scope — overview shows all matching items
  if(refreshOverview)renderOverview();
  renderDayLogs(key);
  // WebKit may synthesize its click after pointerup/touchend. Mounting the
  // backdrop during pointerup makes that tail click land on the new backdrop
  // and immediately close it. Defer mounting until the gesture is complete.
  setTimeout(()=>{
    if(dayLogsKey === key)openSheet('day-logs-sheet');
  },0);
}
bindCalendarTap($('overview-calendar'),'[data-log-day]',day=>{
  openDayLogsAfterCalendarGesture(day?.dataset.logDay,{refreshOverview:true});
});
$('day-logs-sheet').addEventListener('click',e=>{
  if(e.target === e.currentTarget){
    closeDayLogsSheet({refreshOverview:!dayLogsScoped()});
    return;
  }
  if(isScrollGuarded(e.target))return;

  if(e.target.closest('#day-logs-done')){
    closeDayLogsSheet({refreshOverview:false});
    return;
  }
  if(e.target.closest('#day-logs-close')){
    closeDayLogsSheet({refreshOverview:!dayLogsScoped()});
    return;
  }

  if(e.target.closest('#day-logs-back') || e.target.closest('#day-logs-back-list')){
    if(dayLogsScoped()){
      if(dayLogsStep === 'add' || dayLogsStep === 'log')setDayLogsStep('item',dayLogsScopeIndex);
      else closeDayLogsSheet({refreshOverview:false});
      return;
    }
    setDayLogsStep('list');
    return;
  }
  if(e.target.closest('#day-logs-plan')){
    if(!dayLogsCanPlan(dayLogsKey))return;
    setDayLogsStep('add');
    return;
  }
  if(e.target.closest('#day-logs-log')){
    if(!dayLogsCanLog(dayLogsKey))return;
    setDayLogsStep('log',dayLogsScoped() ? dayLogsScopeIndex : null);
    return;
  }
  if(e.target.closest('#day-logs-day')){
    if(dayLogsScoped())return;
    setDayLogsStep('avail');
    return;
  }
  if(e.target.closest('#day-logs-overview')){
    closeDayLogsSheet({refreshOverview:true});
    return;
  }
  if(e.target.closest('#day-logs-home')){
    closeDayLogsSheet({refreshOverview:false});
    closeSheet('overview-sheet');
    return;
  }

  const rowBtn = e.target.closest('[data-day-item]');
  if(rowBtn){
    const idx = parseInt(rowBtn.dataset.dayItem,10);
    if(!Number.isNaN(idx))setDayLogsStep('item',idx);
    return;
  }

  const openBtn = e.target.closest('[data-open-day-item]');
  if(openBtn){
    const idx = parseInt(openBtn.dataset.openDayItem,10);
    if(Number.isNaN(idx))return;
    openDetailFromDayLogs(idx);
    return;
  }
  const logDayBtn = e.target.closest('[data-log-day-item]');
  if(logDayBtn){
    const idx = parseInt(logDayBtn.dataset.logDayItem,10);
    const key = logDayBtn.dataset.logDay || dayLogsKey;
    if(Number.isNaN(idx) || !key || !dayLogsCanLog(key))return;
    const ts = new Date(`${key}T12:00:00`).getTime();
    if(!logTingAt(idx,ts))return;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    refreshOpenViews();
    return;
  }
  const planDayBtn = e.target.closest('[data-plan-day-item]');
  if(planDayBtn){
    const idx = parseInt(planDayBtn.dataset.planDayItem,10);
    if(Number.isNaN(idx) || !dayLogsCanPlan(dayLogsKey))return;
    setDayLogsStep('add',idx);
    return;
  }
  const planByBtn = e.target.closest('[data-plan-by-day]');
  if(planByBtn){
    const idx = parseInt(planByBtn.dataset.planByDay,10);
    const key = planByBtn.dataset.planDay || dayLogsKey;
    if(Number.isNaN(idx) || !key || !dayLogsCanPlan(key) || key <= todayIso())return;
    const data = load();
    const h = data[idx];
    if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return;
    h.planByDate = dayStart(new Date(`${key}T12:00:00`).getTime());
    save(data);
    if(typeof showToast === 'function'){
      showToast(`plan by ${new Date(h.planByDate).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`);
    }
    dayLogsMoving = false;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    refreshOpenViews();
    return;
  }
  const clearPlanByBtn = e.target.closest('[data-clear-plan-by-day]');
  if(clearPlanByBtn){
    const idx = parseInt(clearPlanByBtn.dataset.clearPlanByDay,10);
    if(Number.isNaN(idx))return;
    const data = load();
    const h = data[idx];
    if(!h || (h.type !== 'keepup' && h.type !== 'reduce'))return;
    h.planByDate = null;
    save(data);
    if(typeof showToast === 'function')showToast('plan-by cleared');
    dayLogsMoving = false;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    refreshOpenViews();
    return;
  }
  if(e.target.closest('#day-log-entry-save')){
    if(!dayLogsKey || !dayLogsCanLog(dayLogsKey))return;
    const idx = dayLogsScoped()
      ? dayLogsScopeIndex
      : parseInt($('day-log-entry-ting')?.value,10);
    if(Number.isNaN(idx))return;
    const h = load()[idx];
    if(!h || !dayLogsHabitLoggable(h))return;
    const ts = dayLogsEntryTimestamp(dayLogsKey,$('day-log-entry-time')?.value || '');
    if(!Number.isFinite(ts) || !logTingAt(idx,ts))return;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    refreshOpenViews();
    return;
  }
  const removeBtn = e.target.closest('[data-remove-plan]');
  if(removeBtn){
    const idx = parseInt(removeBtn.dataset.removePlan,10);
    const key = removeBtn.dataset.planDay;
    removePlansOnDay(idx,key);
    dayLogsMoving = false;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    return;
  }
  const moveBtn = e.target.closest('[data-move-plan]');
  if(moveBtn){
    dayLogsMoving = true;
    if(dayLogsKey)renderDayLogs(dayLogsKey);
    return;
  }
  const cancelBtn = e.target.closest('[data-move-cancel]');
  if(cancelBtn){
    dayLogsMoving = false;
    if(dayLogsKey)renderDayLogs(dayLogsKey);
    return;
  }
  const goBtn = e.target.closest('[data-move-go]');
  if(goBtn){
    const idx = parseInt(goBtn.dataset.moveGo,10);
    const dateInput = $('day-move-date') || goBtn.closest('.day-item-card')?.querySelector('.move-date');
    if(!dateInput)return;
    const fromKey = dateInput.dataset.moveFrom;
    const toKey = dateInput.value;
    if(!toKey || !dayLogsCanPlan(toKey))return;
    movePlanTo(idx,fromKey,toKey);
    dayLogsMoving = false;
    dayLogsKey = toKey;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    return;
  }

  if(e.target.closest('#day-log-add')){
    if(!dayLogsKey || !dayLogsCanPlan(dayLogsKey))return;
    const idx = dayLogsScoped()
      ? dayLogsScopeIndex
      : parseInt($('day-log-ting')?.value,10);
    if(Number.isNaN(idx))return;
    const h = load()[idx];
    if(!h || !dayLogsHabitPlannable(h))return;
    const locationId = $('day-log-location')?.value || '';
    if(!planTingOnDay(idx,dayLogsKey,$('day-log-time')?.value || '',{openAction:false,locationId}))return;
    if(dayLogsScoped())setDayLogsStep('item',dayLogsScopeIndex);
    else setDayLogsStep('list');
    refreshOpenViews();
    return;
  }
  if(e.target.closest('#day-availability-save')){
    saveDayAvailabilityOverride();
    return;
  }
  const availabilityPreset = e.target.closest('[data-day-availability-preset]');
  if(availabilityPreset){
    const minutes = parseInt(availabilityPreset.dataset.dayAvailabilityPreset,10);
    const input = $('day-availability-minutes');
    if(input && !Number.isNaN(minutes))input.value = String(minutes);
    document.querySelectorAll('[data-day-availability-preset]').forEach(btn=>btn.classList.toggle('on',btn === availabilityPreset));
    const label = $('day-availability-label');
    if(label && !Number.isNaN(minutes))label.textContent = `${overviewMinutesLabel(minutes)} open`;
    return;
  }
  if(e.target.closest('#day-availability-clear')){
    clearDayAvailabilityOverride();
  }
});
$('day-logs-sheet').addEventListener('keydown',e=>{
  if(e.key === 'Enter' && e.target?.id === 'day-availability-minutes')saveDayAvailabilityOverride();
});
$('day-logs-sheet').addEventListener('input',e=>{
  if(e.target?.id !== 'day-availability-minutes')return;
  const minutes = Math.max(0,Math.min(1440,parseInt(e.target.value,10) || 0));
  const label = $('day-availability-label');
  if(label)label.textContent = `${overviewMinutesLabel(minutes)} open`;
  document.querySelectorAll('[data-day-availability-preset]').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.dayAvailabilityPreset,10) === minutes);
  });
});
$('day-logs-sheet').addEventListener('pointerup',e=>{
  if(e.target === e.currentTarget){
    closeDayLogsSheet({refreshOverview:!dayLogsScoped()});
  }
});

$('snooze-sheet').addEventListener('click',e=>{
  const opt = e.target.closest('[data-snooze-days]');
  const repeatOpt = e.target.closest('[data-snooze-repetitions]');
  if((!opt && !repeatOpt) || snoozeIdx === null)return;
  if(opt)doSnooze(snoozeIdx,parseInt(opt.dataset.snoozeDays,10));
  if(repeatOpt)doSnoozeRepetitions(snoozeIdx,parseInt(repeatOpt.dataset.snoozeRepetitions,10));
  if(snoozeFromDetail)closeDetail();
  snoozeIdx = null;
  snoozeFromDetail = false;
  closeSheet('snooze-sheet');
});
$('snooze-cancel').addEventListener('click',()=>{snoozeIdx = null;snoozeFromDetail = false;closeSheet('snooze-sheet');});
$('snooze-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){snoozeIdx = null;snoozeFromDetail = false;closeSheet('snooze-sheet');}});

$('activity-close').addEventListener('click',()=>{activityIdx = null;closeSheet('activity-sheet');});
$('activity-calendar').addEventListener('click',()=>{
  if(activityIdx === null)return;
  const idx = activityIdx;
  activityIdx = null;
  closeSheet('activity-sheet');
  openDetailCalendar(idx);
});
$('activity-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){activityIdx = null;closeSheet('activity-sheet');}});

$('day-capacity-close').addEventListener('click',()=>closeSheet('day-capacity-sheet'));
$('day-capacity-copy')?.addEventListener('click',()=>{
  if(typeof copyWeekPlacements === 'function')copyWeekPlacements();
});
$('day-capacity-export')?.addEventListener('click',()=>{
  if(typeof exportWeekPlacements === 'function')exportWeekPlacements();
});
$('day-capacity-sheet').addEventListener('click',e=>{
  if(e.target === e.currentTarget){ closeSheet('day-capacity-sheet'); return; }
  const dayCopy = e.target.closest && e.target.closest('[data-capacity-copy-day]');
  if(dayCopy && typeof copyDayCapacityScorecard === 'function'){
    e.preventDefault();
    copyDayCapacityScorecard();
  }
});

$('slipped-close').addEventListener('click',()=>closeSheet('slipped-sheet'));
$('slipped-sheet').addEventListener('click',e=>{
  if(e.target !== e.currentTarget)return;
  if(typeof sheetBackdropArmed === 'function' && sheetBackdropArmed('slipped-sheet'))return;
  closeSheet('slipped-sheet');
});

$('free-time-close').addEventListener('click',()=>closeSheet('free-time-sheet'));
$('free-time-sheet').addEventListener('click',e=>{
  if(e.target !== e.currentTarget)return;
  if(typeof sheetBackdropArmed === 'function' && sheetBackdropArmed('free-time-sheet'))return;
  closeSheet('free-time-sheet');
});

$('action-undo').addEventListener('click',executeUndo);
$('action-open')?.addEventListener('click',()=>{
  if(!canOpenFromAction(pendingAction))return;
  const idx = pendingAction.idx;
  hideActionToast();
  openDetail(idx);
});
$('action-plan')?.addEventListener('click',()=>{
  runPendingAction();
});
$('snooze-until-planned')?.addEventListener('click',()=>{
  if(!pendingAction || !pendingAction.plan || !pendingAction.ts || pendingAction.ts <= Date.now())return;
  const idx = pendingAction.idx;
  const until = pendingAction.ts;
  hideActionToast();
  doSnoozeUntil(idx,until,'Planned');
});

$('list').addEventListener('touchstart',e=>{
  if(swipeOpenCard && !e.target.closest('.swipe-actions') && !e.target.closest('.ting-card'))closeAllSwipes();
},{passive:true});

// Cold load: restore the persisted active focus, then start the worker-backed
// render. The shell remains responsive while the single planner result runs.
function updateHomeDateLabel(now = Date.now()){
  const label = $('home-date');
  if(!label)return;
  label.textContent = new Date(now).toLocaleDateString(undefined,{
    weekday:'short',month:'short',day:'numeric'
  });
}

updateHomeDateLabel();
restoreHabitTimer();
plannerPerfMark('app-boot-render');
if(typeof render === 'function')render();
plannerPerfMark('app-first-render-returned');
// First-run coach: defer until the real home UI has painted. A dismissal is
// versioned, so it stays quiet until a future coach intentionally opts in.
if(!load().length && !coachStorageValue(TINGS_ESSENTIALS_COACH_KEY)){
  let coachBootInteracted = false;
  const noteCoachBootInteraction = ()=>{coachBootInteracted = true;};
  document.addEventListener('pointerdown',noteCoachBootInteraction,{once:true,passive:true});
  document.addEventListener('keydown',noteCoachBootInteraction,{once:true});
  const offerCoach = ()=>{
    if(coachBootInteracted || document.hidden || document.querySelector('.sheet-wrap.open')
      || load().length || coachStorageValue(TINGS_ESSENTIALS_COACH_KEY))return;
    // A first-run browser user is taught to install first; the install tour
    // then hands over to the guided start. Someone already running the
    // installed app (or who finished the install guide before) goes straight
    // to the guided start.
    const standalone = typeof isStandalonePwa === 'function' && isStandalonePwa();
    const seenInstallGuide = Boolean(coachStorageValue(TINGS_INSTALL_COACH_KEY));
    void startTingsCoach(standalone || seenInstallGuide ? 'essentials' : 'install');
  };
  setTimeout(offerCoach,900);
}
// After first paint: warm the planner worker (script parse + GLPK) off the
// critical path so the next real request is not a cold bring-up. Exact mode only.
if(typeof warmAgendaPlannerWorker === 'function'
  && typeof agendaPlannerWorkerAvailable === 'function'
  && agendaPlannerWorkerAvailable()
  && sortSettings && sortSettings.agendaOptimizer
  && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())){
  const warm = ()=>{ void warmAgendaPlannerWorker(); };
  if(typeof requestIdleCallback === 'function')requestIdleCallback(warm,{timeout:300});
  else setTimeout(warm,100);
}
ensureOverviewPlacement();
if (paneTierActive() && typeof renderOverview === 'function') renderOverview();
if (typeof initReminders === 'function') initReminders();
if (typeof resumeLocationWatchIfOptedIn === 'function') resumeLocationWatchIfOptedIn();
if (typeof sweepAutoDoneTasks === 'function'){
  sweepAutoDoneTasks();
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden)setTimeout(sweepAutoDoneTasks,300); });
  setInterval(sweepAutoDoneTasks,5 * 60 * 1000);
}

// REOPEN: when the user returns to the PWA / tab, refresh the agenda so the
// suggested times, capacity, and travel reflect the new "now" and the latest
// current location. Visibility fires on tab-switch, app foreground, unlock;
// pageshow (with bfcache) fires on history navigation back to the page. A
// light debounce keeps rapid events from thrashing the DOM. Sync-only (no
// progressive) so returning never flashes a different card order.
let _reopenRefreshTimer = null;
let _homeHiddenAt = 0;
function scheduleReopenRefresh(refreshAgenda = true){
  if(_reopenRefreshTimer)return;
  _reopenRefreshTimer = setTimeout(()=>{
    _reopenRefreshTimer = null;
    if(typeof requestLocationAccess === 'function' && typeof resumeLocationWatchIfOptedIn === 'function'){
      resumeLocationWatchIfOptedIn({fresh:true});
    }
    if(refreshAgenda){
      if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged(true);
      else if(typeof render === 'function')render();
    }else if(typeof updateHomeSessionProgress === 'function'){
      updateHomeSessionProgress();
    }
    if(typeof checkReminders === 'function')checkReminders();
  },200);
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    _homeHiddenAt = Date.now();
    return;
  }
  closeAllSwipes();
  // A quick app switch cannot make a schedule materially stale. Replanning on
  // every brief foreground transition blocked touch scrolling for the entire
  // Fast solve. Longer absences still get the normal freshness check.
  const hiddenFor = _homeHiddenAt ? Date.now() - _homeHiddenAt : Infinity;
  scheduleReopenRefresh(hiddenFor >= HOME_AGENDA_REFRESH_MS);
  if(typeof scheduleHouseholdAgendaPublish === 'function') scheduleHouseholdAgendaPublish();
});
window.addEventListener('pageshow',e=>{
  // bfcache restore (back/forward) — also refresh, since a lot of wall-clock
  // time may have passed while the page was frozen.
  if(e && e.persisted)scheduleReopenRefresh();
});

// WHILE OPEN: keep the home agenda fresh. The fast planner compares its result
// off-screen; GLPK solves in the background. Both keep the mounted list when
// the resulting days/order/times are unchanged.
const HOME_AGENDA_REFRESH_MS = 60 * 1000;
let _homeAgendaRefreshId = null;
let _homeAgendaRefreshTick = 0;

function refreshHomeAgendaWhileOpen(){
  if(document.hidden)return;
  updateHomeDateLabel();
  if(typeof swipeOpenCard !== 'undefined' && swipeOpenCard)return;
  if(typeof sweepAutoDoneTasks === 'function'){
    const swept = sweepAutoDoneTasks();
    if(swept > 0)return; // refreshOpenViews already re-rendered
  }
  if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged();
  else if(typeof render === 'function')render();
  if(typeof updateHomeSessionProgress === 'function')updateHomeSessionProgress();
}

function startHomeAgendaRefreshLoop(){
  if(_homeAgendaRefreshId != null)return;
  _homeAgendaRefreshId = setInterval(()=>{
    _homeAgendaRefreshTick += 1;
    // Every ~5 min, nudge the location watch in case the OS paused it.
    if(_homeAgendaRefreshTick % 5 === 0 && typeof resumeLocationWatchIfOptedIn === 'function'){
      resumeLocationWatchIfOptedIn();
    }
    refreshHomeAgendaWhileOpen();
  },HOME_AGENDA_REFRESH_MS);
}

function stopHomeAgendaRefreshLoop(){
  if(_homeAgendaRefreshId == null)return;
  clearInterval(_homeAgendaRefreshId);
  _homeAgendaRefreshId = null;
}

document.addEventListener('visibilitychange',()=>{
  if(document.hidden)stopHomeAgendaRefreshLoop();
  else startHomeAgendaRefreshLoop();
});
startHomeAgendaRefreshLoop();
