// Event binding and application startup.

// ─────────────────────────────────────────────────────────────────
// main.js — application controller (pre-React-Native-port notes)
// ─────────────────────────────────────────────────────────────────
// This file is the main controller: it wires DOM events to app
// state and triggers re-renders in response.
//
// Responsibilities concentrated here:
//   • crown dial gesture (pointer / momentum / wheel / keyboard)
//   • keyboard lift (visualViewport-driven layout adjustment)
//   • reach assist (pull-down-at-top gesture)
//   • pane sync (overview / day-logs / detail sheet coordination)
//
// React Native port mapping:
//   • WIRE functions    → useEffect hooks that register gesture /
//                         event subscriptions + return cleanup.
//   • HANDLER functions → gesture callbacks (react-native-gesture-
//                         handler) or pressable event handlers.
//   • The controller itself dissolves into React component
//     lifecycle + Zustand store actions; no global imperative
//     wiring survives.
//   • Most HYBRID functions split into two pieces:
//       (1) a Zustand store action that mutates state, and
//       (2) a useEffect that reacts to that state change and
//           updates the UI.
// ─────────────────────────────────────────────────────────────────

sortSettings = loadSortSettings();
{
  const reconciled = reconcileLocations(load(),sortSettings);
  if(reconciled.changed)save(reconciled.data);
}
// A single travel-edge refresh triggers a re-render so the new time lands on
// screen — but warming a matrix fires many refreshes in a burst, and for
// non-driving modes fetchEdge is fully synchronous (pure haversine, no await),
// so one-refresh-per-edge becomes a microtask-only render loop that never
// yields. Debounce: a burst coalesces into one render ~120ms after the last
// edge lands. The agenda's stale-while-revalidate reads are unaffected (they
// already return the best-available edge synchronously and let the next render
// pick up the refined value).
let _travelRefreshTimer = null;
let _travelRefreshPending = false;
onTravelRefresh = ()=>{
  _travelRefreshPending = true;
  if(_travelRefreshTimer)return;
  _travelRefreshTimer = setTimeout(() => {
    _travelRefreshTimer = null;
    if(!_travelRefreshPending)return;
    _travelRefreshPending = false;
    if(typeof render === 'function')render();
    if(typeof renderTodayAgenda === 'function' && $('today-sheet')?.classList.contains('open'))renderTodayAgenda();
  },120);
};

$('type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-v]');
  if(!opt)return;
  selectedType = opt.dataset.v;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
  syncAddTypeUi(selectedType);
});

// WIRE: add-sheet "more options" disclosure (priority, hard deadline,
// scheduled time, topics) — collapsed by default so a first-time user only
// sees name, type, and the one field that matters for that type.
$('add-more-toggle')?.addEventListener('click',()=>{
  const body = $('add-more-options');
  const toggle = $('add-more-toggle');
  if(!body || !toggle)return;
  const opening = body.hidden;
  body.hidden = !opening;
  toggle.setAttribute('aria-expanded',String(opening));
});

// PURE: read the selected priority from the add-sheet segmented control
function selectedAddPriority(){
  const on = document.querySelector('#ting-priority-seg .seg-opt.on');
  return clampPriority(on ? on.dataset.priority : DEFAULT_PRIORITY);
}

// WIRE: add-sheet priority segmented control
$('ting-priority-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-priority]');
  if(!opt)return;
  document.querySelectorAll('#ting-priority-seg .seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
});

// RENDER: toggle add-sheet field rows for the active type
function syncAddTypeUi(type){
  const isHabit = type === 'keepup' || type === 'reduce';
  $('target-slider-row').style.display = isHabit ? 'flex' : 'none';
  $('target-help').style.display = 'block';
  $('target-help').textContent = rhythmHelp(type);
  $('task-due-row').hidden = type !== 'task';
  $('task-due-hint').hidden = type !== 'task';
  $('task-hard-due-row').hidden = type !== 'task';
  $('scheduled-time-row').hidden = type !== 'task';
  if(type === 'task'){
    syncTaskDueUi();
    syncScheduledTimeUi();
  }
}

// PURE: next clean hour, used to make scheduled tasks one tap lighter.
function defaultEventTime(){
  const d = new Date(Date.now() + 60 * 60000);
  d.setMinutes(0,0,0);
  return d.getTime();
}

$('open-add').addEventListener('click',()=>{
  closeSearch();
  applyAddDefaults();
  openSheet('add-sheet');
  $('ting-message').focus({preventScroll:true});
  setTimeout(()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  },260);
});

$('open-search').addEventListener('click',()=>{
  const data = load();
  const hasSearchableArchive = data.some(h=>h.type === 'task' && h.lastLog !== null);
  if(data.length < 10 && !hasSearchableArchive)return;
  const nav = document.querySelector('.bottom-nav');
  const wide = paneTierActive();
  const isOpen = wide
    ? !!$('app-bar-search')?.classList.contains('is-open')
    : !!nav?.classList.contains('search-open');
  if(isOpen)closeSearch();
  else setSearchOpen(true);
});
$('bar-open-search')?.addEventListener('click',()=>{
  const data = load();
  const hasSearchableArchive = data.some(h=>h.type === 'task' && h.lastLog !== null);
  if(data.length < 10 && !hasSearchableArchive)return;
  const isOpen = !!$('app-bar-search')?.classList.contains('is-open');
  if(isOpen)closeSearch();
  else setSearchOpen(true);
});
$('bar-open-add')?.addEventListener('click',()=>{
  closeSearch();
  applyAddDefaults();
  openSheet('add-sheet');
  $('ting-message').focus({preventScroll:true});
  setTimeout(()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  },260);
});
$('bar-open-overview')?.addEventListener('click',()=>{
  if(!load().length)return;
  closeSearch();
  overviewMonthOffset = 0;
  overviewRecentOffset = 0;
  overviewTopicFilter = 'all';
  overviewLocationFilter = 'all';
  overviewRangeFilter = 'recent';
  renderOverview();
  openSheet('overview-sheet');
});
$('today-close')?.addEventListener('click',()=>closeSheet('today-sheet'));
$('today-close')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('iam-at-row')?.addEventListener('click',async e=>{
  const gps = e.target.closest('#iam-at-gps');
  if(gps){
    const s = sortSettings || loadSortSettings();
    if(s.locationOptIn || currentCoord){
      await requestLocationAccess({quiet:false});
    }else{
      locationAllowCallback = null;
      openLocationPermissionSheet();
    }
    renderIAmAtPicker();
    renderTodayAgenda();
    render();
    return;
  }
  const btn = e.target.closest('[data-iam-at]');
  if(!btn)return;
  setManualLocationId(btn.dataset.iamAt);
  renderIAmAtPicker();
  renderTodayAgenda();
  render();
});
$('today-overview')?.addEventListener('click',()=>{
  closeSheet('today-sheet');
  const btn = paneTierActive() ? $('bar-open-overview') : $('open-overview');
  if(btn)btn.click();
});
$('today-sheet')?.addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('today-sheet');});
$('bar-open-about')?.addEventListener('click',()=>openSheet('about-sheet'));
$('habit-search').addEventListener('input',e=>{
  searchQuery = e.target.value;
  render();
});
$('habit-search').addEventListener('keydown',e=>{
  if(e.key !== 'Escape')return;
if(searchQuery){
    searchQuery = '';
    render();
    e.preventDefault();
    return;
  }
  closeSearch();
});
$('habit-search').addEventListener('focus',()=>{
  updateKeyboardLift();
  keepFocusedInputVisible();
  setTimeout(()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  },260);
});
$('habit-search').addEventListener('blur',updateKeyboardLift);
document.addEventListener('keydown',e=>{
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  const target = e.target;
  const textTarget = target?.matches?.('input,textarea,select') || target?.isContentEditable;
  if(!nav?.classList.contains('search-open') || document.activeElement === input || textTarget)return;
  if(e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1)return;
  input.focus({preventScroll:true});
  const start = searchQuery.length;
  const end = searchQuery.length;
  searchQuery = `${searchQuery.slice(0,start)}${e.key}${searchQuery.slice(end)}`;
  render();
  requestAnimationFrame(()=>{
    input.focus({preventScroll:true});
    input.setSelectionRange(start + e.key.length,start + e.key.length);
    updateKeyboardLift();
    keepFocusedInputVisible();
  });
  e.preventDefault();
});
$('clear-search').addEventListener('click',()=>{
  if(searchQuery.trim())setSearchOpen(true,{clear:true});
  else closeSearch();
});

$('do-cancel').addEventListener('click',cancelAdd);
$('add-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)cancelAdd();});

$('do-save').addEventListener('click',()=>{
  const name = $('ting-message').value.trim();
  if(!name){$('ting-message').focus();return;}
  const data = load();
  if(data.length >= MAX_TINGS){alert(`${MAX_TINGS} habits max`);return;}
  const type = selectedType;
  const isHabit = type === 'keepup' || type === 'reduce';
  const target = isHabit ? clampRhythmValue($('ting-days').value) : null;
  const record = {
    name:name.slice(0,60),
    type,
    target,
    lastLog:null,
    logs:[],
    emoji:cleanMark($('ting-emoji').value),
    pinned:false,
    priority:selectedAddPriority(),
    topics:selectedAddTopics(),
    locationIds:selectedLocationIds(),
    preferredLocationId:selectedPreferredLocationId(),
    createdAt:Date.now()
  };
  if(type === 'task'){
    record.dueDate = parseDateInput($('ting-due-date').value);
    record.hardDue = $('ting-hard-due').checked;
    record.eventTime = parseDateTimeInput($('ting-scheduled-time').value);
    record.markDone = $('ting-mark-done').checked;
    if(record.eventTime !== null && record.dueDate === null)record.dueDate = dayStart(record.eventTime);
    record.flexibilityDays = record.dueDate === null ? 0 : 3;
  }
  data.push(record);
  if(save(data)){cancelAdd();render();openDetailSchedule(data.length - 1);}
});

// PURE: "YYYY-MM-DD" -> day-start ms timestamp, or null when blank
function parseDateInput(value){
  if(!value)return null;
  const ts = new Date(`${value}T12:00:00`).getTime();
  return Number.isFinite(ts) ? ts : null;
}
// PURE: datetime-local "YYYY-MM-DDTHH:mm" -> ms timestamp, or null when blank
function parseDateTimeInput(value){
  if(!value)return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

$('ting-message').addEventListener('keydown',e=>{if(e.key === 'Enter')$('do-save').click();});

// WIRE: task due-date clear + hard-deadline visibility
function syncTaskDueUi(){
  const dueInput = $('ting-due-date');
  const clearBtn = $('ting-due-clear');
  const hardToggle = $('ting-hard-due');
  if(!dueInput)return;
  const hasDate = Boolean(dueInput.value);
  if(clearBtn)clearBtn.hidden = !hasDate;
  if(hardToggle && hardToggle.closest('.hard-due-toggle')){
    hardToggle.closest('.hard-due-toggle').hidden = !hasDate;
  }
  const hint = $('task-due-hint');
  if(hint)hint.textContent = hasDate
    ? 'Due on this date — it rises in your list as it gets closer. Hard deadline adds a firm cutoff and stronger reminders.'
    : 'No due date. This stays in your list as a low-priority someday task until you date it or finish it.';
}
$('ting-due-date').addEventListener('input',syncTaskDueUi);
$('ting-due-clear').addEventListener('click',()=>{
  $('ting-due-date').value = '';
  $('ting-hard-due').checked = false;
  syncTaskDueUi();
});
syncTaskDueUi();

// WIRE: task scheduled-time + mark-done toggle visibility
function syncScheduledTimeUi(){
  const timeInput = $('ting-scheduled-time');
  const toggle = $('ting-mark-done-toggle');
  if(!timeInput || !toggle)return;
  const hasTime = Boolean(timeInput.value);
  toggle.hidden = !hasTime;
}
$('ting-scheduled-time').addEventListener('input',syncScheduledTimeUi);
$('ting-mark-done').addEventListener('change',syncScheduledTimeUi);
syncScheduledTimeUi();

// PURE: clamp rhythm value to valid range
function clampRhythm(value){
  return clampRhythmValue(value);
}

// PURE: return help text for a rhythm type
function rhythmHelp(type){
  if(type === 'reduce')return 'Something to space out. Target is the gap you want before it can repeat.';
  if(type === 'zero')return 'Something to avoid. Log it each time it happens; the aim is longer gaps.';
  if(type === 'task')return 'A one-off to-do. Add a due date, a fixed scheduled time, or leave it dateless.';
  return 'Something to do regularly. Target is the days between entries.';
}

// RENDER: update detail type segmented control + help
function setDetailTypeUi(type){
  document.querySelectorAll('#detail-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.detailType === type);
  });  const isHabit = type === 'keepup' || type === 'reduce';
  $('detail-slider-row').style.display = isHabit ? 'flex' : 'none';
  $('detail-target-help').style.display = 'block';
  $('detail-target-help').textContent = rhythmHelp(type);
  $('detail-due-row').hidden = type !== 'task';
  $('detail-due-hint').hidden = type !== 'task';
  $('detail-scheduled-row').hidden = type !== 'task';
  const flexHelp = $('detail-flexibility-help');
  if(flexHelp){
    flexHelp.textContent = type === 'task'
      ? 'How many days before the due date this task starts surfacing.'
      : 'Adds a buffer to your target for planning purposes.';
  }
  const exportBtn = $('detail-export');
  if(exportBtn)exportBtn.hidden = type !== 'task';
  if(typeof syncDetailDueUi === 'function')syncDetailDueUi();
  if(typeof syncDetailHabitMarkDoneUi === 'function')syncDetailHabitMarkDoneUi();
}

// RENDER: update detail priority segmented control
function setDetailPriorityUi(priority){
  const p = clampPriority(priority);
  document.querySelectorAll('#detail-priority-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.priority,10) === p);
  });
}

// HYBRID: sync rhythm field, label, and crown dial state
function syncRhythm(prefix,value){
  const field = $(`${prefix}-days`);
  const prev = parseInt(field.dataset.orig || field.value,10) || 7;
  const days = clampRhythm(value);
  field.value = days;
  const label = $(`${prefix}-days-label`);
  if(label)label.textContent = `${days}d`;
  const crown = $(`${prefix}-days-slider`);
  if(crown){
    const target = (crown._scroll || 0) + (days - prev) * 10;
    if(crown._animateTo)crown._animateTo(target);
    else{
      crown._scroll = target;
      const canvas = crown.querySelector('.crown-canvas');
      if(canvas)drawCrownRidges(canvas, crown._scroll);
    }
  }
}

// RENDER: draw crown dial ridges onto canvas
function drawCrownRidges(canvas, scroll){
  if(!canvas || !canvas.isConnected)return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if(w === 0 || h === 0)return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const R = w / 2, cx = w / 2;
  const stepDeg = 3.6, baseW = 2.2, radOff = scroll / R;
  const radOffDeg = radOff * 180 / Math.PI;
  const margin = 5;
  const startI = Math.ceil((-90 - margin - radOffDeg) / stepDeg);
  const endI = Math.floor((90 + margin - radOffDeg) / stepDeg);
  ctx.clearRect(0,0,w,h);
  const rootStyle = getComputedStyle(document.documentElement);
  const ridgeColor = rootStyle.getPropertyValue('--text2').trim() || '#6b6a65';
  for(let i = startI; i <= endI; i++){
    const adjDeg = i * stepDeg + radOffDeg;
    const a = adjDeg * Math.PI / 180;
    const x = cx + R * Math.sin(a);
    const f = Math.max(0, Math.cos(a));
    const rw = baseW * f + 0.2;
    if(rw < 0.2 || x < -rw || x > w + rw)continue;
    const alpha = 0.85 * f + 0.15;
    ctx.fillStyle = `color-mix(in srgb, ${ridgeColor} ${Math.round(alpha * 100)}%, transparent)`;
    ctx.fillRect(x - rw / 2, 1, Math.max(0.5, rw), h - 2);
  }
}

// WIRE: attach crown dial gesture + input listeners
function bindRhythm(prefix){
  const field = $(`${prefix}-days`);
  const crown = $(`${prefix}-days-slider`);
  const label = $(`${prefix}-days-label`);

  field.addEventListener('input',e=>{
    const typed = e.target.value.replace(/\D/g,'').slice(0,3);
    e.target.value = typed;
    if(!typed)return;
    const days = clampRhythm(typed);
    if(label)label.textContent = `${days}d`;
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.orig = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>syncRhythm(prefix,e.target.value));

  let startVal,prevX,velX = 0,momentumId = null,smoothAnimId = null;
  crown._scroll = 0;
  const canvas = crown.querySelector('.crown-canvas');
  const friction = 0.935;

  const cancelMomentum = () => {
    if(momentumId){cancelAnimationFrame(momentumId);momentumId=null;}
    if(smoothAnimId){cancelAnimationFrame(smoothAnimId);smoothAnimId=null;}
  };

  crown._animateTo = target => {
    cancelMomentum();
    const start = crown._scroll;
    const delta = target - start;
    if(Math.abs(delta) < 1){crown._scroll = target;updateVisual(crown._scroll);return;}
    const startTime = performance.now();
    const tick = now => {
      const t = Math.min((now - startTime) / 400, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      crown._scroll = start + delta * ease;
      updateVisual(crown._scroll);
      if(t < 1)smoothAnimId = requestAnimationFrame(tick);
      else smoothAnimId = null;
    };
    smoothAnimId = requestAnimationFrame(tick);
  };

  const setVal = val => {
    const days = clampRhythm(val);
    field.value = days;
    if(label)label.textContent = `${days}d`;
    crown.setAttribute('aria-valuenow',days);
    if(prefix === 'detail')setDetailDirty();
  };

  const updateVisual = scroll => {
    drawCrownRidges(canvas, scroll);
  };

  window.addEventListener('resize',()=>drawCrownRidges(canvas, crown._scroll));

  const startMomentum = initVel => {
    cancelMomentum();
    const baseScroll = crown._scroll;
    const baseVal = parseInt(field.value,10) || 7;
    let vel = initVel;
    const tick = () => {
      vel *= friction;
      if(Math.abs(vel) < 0.5){momentumId = null;return;}
      crown._scroll += vel;
      const derivedVal = clampRhythm(baseVal + Math.round((crown._scroll - baseScroll) / 10));
      const curVal = parseInt(field.value,10) || 7;
      if(derivedVal !== curVal){
        setVal(derivedVal);
      }
      drawCrownRidges(canvas,crown._scroll);
      momentumId = requestAnimationFrame(tick);
    };
    momentumId = requestAnimationFrame(tick);
  };

  crown.addEventListener('pointerdown',e=>{
    cancelMomentum();
    prevX = e.clientX;
    startVal = parseInt(field.value,10) || 7;
    velX = 0;
    crown._valScroll = 0;
    crown.setPointerCapture(e.pointerId);
    crown.classList.add('active');
  });

  crown.addEventListener('pointermove',e=>{
    if(prevX === undefined)return;
    const dx = e.clientX - prevX;
    prevX = e.clientX;
    velX = velX * 0.55 + dx * 0.45;
    crown._scroll += dx;
    updateVisual(crown._scroll);
    const speed = Math.abs(velX);
    const gain = 1 + speed * 0.15;
    crown._valScroll += dx * gain;
    const newVal = clampRhythm(startVal + Math.round(crown._valScroll / 10));
    const oldVal = parseInt(field.value,10) || 7;
    if(newVal !== oldVal)setVal(newVal);
  });

  const endDrag = () => {
    prevX = undefined;
    crown.classList.remove('active');
    if(Math.abs(velX) > 1)startMomentum(velX);
    velX = 0;
  };

  crown.addEventListener('pointerup',endDrag);
  crown.addEventListener('pointercancel',endDrag);

  crown.addEventListener('wheel',e=>{
    e.preventDefault();
    cancelMomentum();
    const step = e.deltaY < 0 ? 1 : -1;
    const newVal = clampRhythm((parseInt(field.value,10) || 7) + step);
    const oldVal = parseInt(field.value,10) || 7;
    if(newVal !== oldVal){
      setVal(newVal);
      crown._scroll += e.deltaY * -0.5;
      updateVisual(crown._scroll);
    }
  },{passive:false});

  crown.addEventListener('keydown',e=>{
    const inc = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const dec = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if(inc||dec){
      e.preventDefault();
      cancelMomentum();
      const newVal = clampRhythm((parseInt(field.value,10) || 7) + (inc ? 1 : -1));
      const oldVal = parseInt(field.value,10) || 7;
      if(newVal !== oldVal){
        setVal(newVal);
        crown._scroll += inc ? 10 : -10;
        updateVisual(crown._scroll);
      }
    }
  });
}

bindRhythm('ting');
bindRhythm('detail');
requestAnimationFrame(()=>{
  drawCrownRidges($('ting-days-slider')?.querySelector('.crown-canvas'),0);
  drawCrownRidges($('detail-days-slider')?.querySelector('.crown-canvas'),0);
});

// WIRE: attach numeric input focus/blur validators
function bindCompactNumber(id,clamp,options={}){
  const field = $(id);
  const maxLength = options.maxLength || field.maxLength || 3;

  field.addEventListener('input',e=>{
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,maxLength);
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.was = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>{
    e.target.value = clamp(e.target.value);
  });
}

bindCompactNumber('detail-duration',clampDuration,{maxLength:3});
bindCompactNumber('detail-flexibility',clampFlexibility,{maxLength:2});
$('ting-tag-chips')?.addEventListener('click',e=>{
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('ting-tag-chips');
    return;
  }
  if(e.target.closest('.location-chip[data-location-id]')){
    toggleLocationChip(e);
    return;
  }
  toggleTopicChip(e);
});
$('detail-tag-chips')?.addEventListener('click',e=>{
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('detail-tag-chips');
    return;
  }
  if(e.target.closest('.location-chip[data-location-id]')){
    toggleLocationChip(e);
    return;
  }
  toggleTopicChip(e);
});
$('detail-weekday-chips').addEventListener('click',toggleScheduleChip);
$('detail-monthday-chips').addEventListener('click',toggleScheduleChip);
$('detail-preferred-weekday-chips').addEventListener('click',toggleScheduleChip);
$('detail-preferred-monthday-chips').addEventListener('click',toggleScheduleChip);
$('detail-time-start').addEventListener('input',()=>{setDetailDirty();syncTimeClearBtn();});
$('detail-time-end').addEventListener('input',()=>{setDetailDirty();syncTimeClearBtn();});
$('detail-time-clear').addEventListener('click',()=>{
  $('detail-time-start').value = '';
  $('detail-time-end').value = '';
  $('detail-time-clear').hidden = true;
  setDetailDirty();
});
$('detail-due-date').addEventListener('input',()=>{syncDetailDueUi();setDetailDirty();});
$('detail-due-clear').addEventListener('click',()=>{
  $('detail-due-date').value = '';
  $('detail-hard-due').checked = false;
  syncDetailDueUi();
  setDetailDirty();
});
$('detail-hard-due').addEventListener('change',()=>setDetailDirty());
$('detail-scheduled-time').addEventListener('input',()=>{syncDetailScheduledUi();setDetailDirty();});
$('detail-mark-done').addEventListener('change',()=>setDetailDirty());
$('detail-habit-mark-done').addEventListener('change',()=>setDetailDirty());
$('detail-schedule-view-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-schedule-view]');
  if(!opt)return;
  setScheduleView(opt.dataset.scheduleView);
});
$('detail-habit-message').addEventListener('input',()=>setDetailDirty());
$('detail-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-detail-type]');
  if(!opt)return;
  setDetailTypeUi(opt.dataset.detailType);
  setDetailDirty();
});
$('detail-pinned').addEventListener('change',()=>setDetailDirty());
$('detail-duration').addEventListener('input',()=>setDetailDirty());
$('detail-flexibility').addEventListener('input',()=>setDetailDirty());
$('detail-priority-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-priority]');
  if(!opt)return;
  setDetailPriorityUi(opt.dataset.priority);
  setDetailDirty();
});
document.addEventListener('click',e=>{
  document.querySelectorAll('.info-tooltip:not([hidden])').forEach(tip=>{
    if(e.target.closest(`[data-tip="${tip.id}"]`))return;
    tip.hidden = true;
  });
},true);
document.addEventListener('click',e=>{
  const btn = e.target.closest('[data-tip]');
  if(!btn)return;
  const tip = $(btn.dataset.tip);
  if(tip)tip.toggleAttribute('hidden');
});
$('detail-days').addEventListener('input',()=>setDetailDirty());
$('detail-days').addEventListener('blur',()=>setDetailDirty());

// WIRE: attach emoji/mark character limit handler
function bindMarkLimit(id){
  $(id).addEventListener('input',e=>{
    const limited = cleanMark(e.target.value);
    if(e.target.value !== limited)e.target.value = limited;
  });
}

bindMarkLimit('ting-emoji');
bindMarkLimit('detail-emoji');
$('detail-emoji').addEventListener('input',()=>setDetailDirty());

window.addEventListener('scroll',updateHeaderOnScroll,{passive:true});
document.addEventListener('touchstart',e=>{
  cancelReachHold();
  topTouchStartedAtTop = sortSettings.reachAssist && window.scrollY <= 1 && !e.target.closest('button,input,select');
  if(topTouchStartedAtTop){
    topTouchY = e.touches[0].clientY;
    topTouchX = e.touches[0].clientX;
  }
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!topTouchStartedAtTop || e.target.closest('button,input,select'))return cancelReachHold();
  if(window.scrollY > 1)return cancelReachHold();
  const dy = e.touches[0].clientY - topTouchY;
  const dx = Math.abs(e.touches[0].clientX - topTouchX);
  if(dy < 110 || dx > dy * 0.28)return cancelReachHold();
  if(!reachArmed){
    reachArmed = true;
    reachHoldTimer = setTimeout(()=>{
      showReachPad();
      cancelReachHold();
    },800);
  }
},{passive:true});
document.addEventListener('touchend',cancelReachHold,{passive:true});
document.addEventListener('touchcancel',cancelReachHold,{passive:true});
document.addEventListener('wheel',e=>{
  if(window.scrollY <= 1 && e.deltaY < -120)showReachPad();
},{passive:true});
window.addEventListener('pageshow',closeAllSwipes);
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden)closeAllSwipes();
});

if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>{
    updateKeyboardLift();
    keepFocusedInputVisible();
  });
  window.visualViewport.addEventListener('scroll',updateKeyboardLift);
}

$('detail-save').addEventListener('click',()=>{
  if(detailIdx === null)return;
  const data = load();
  const h = data[detailIdx];
  if(!h)return;
  const current = currentDetailTune();
  if(!current.name){$('detail-habit-message').focus();return;}
  // Cancel scheduled push for the pre-edit state (sig may change after edit).
  if(typeof cancelPush === 'function' && typeof reminderSignature === 'function' && h.type === 'task'){
    cancelPush(reminderSignature(h));
  }
  h.name = current.name.slice(0,60);
  h.type = current.type;
  h.emoji = current.emoji;
  h.pinned = current.pinned;
  h.topics = normalizeTopics(current.topics);
  h.locationIds = normalizeLocationIds(current.locationIds,sortSettings.locations);
  h.preferredLocationId = normalizePreferredLocation(current.preferredLocationId,h.locationIds);
  h.allowedWeekdays = normalizeAllowedWeekdays(current.allowedWeekdays);
  h.allowedMonthDays = normalizeAllowedMonthDays(current.allowedMonthDays);
  h.preferredWeekdays = normalizeAllowedWeekdays(current.preferredWeekdays);
  h.preferredMonthDays = normalizeAllowedMonthDays(current.preferredMonthDays);
  h.allowedTimeStart = current.allowedTimeStart;
  h.allowedTimeEnd = current.allowedTimeEnd;
  if(h.allowedTimeStart === null || h.allowedTimeEnd === null){
    h.allowedTimeStart = null;
    h.allowedTimeEnd = null;
  }
  h.durationMinutes = current.durationMinutes;
  h.flexibilityDays = current.flexibilityDays;
  h.priority = clampPriority(current.priority);
  const isHabit = current.type === 'keepup' || current.type === 'reduce';
  h.target = isHabit ? clampRhythmValue(current.target || h.target || 7) : null;
  if(current.type === 'task'){
    h.eventTime = current.eventTime;
    h.dueDate = current.dueDate ?? (current.eventTime !== null ? dayStart(current.eventTime) : null);
    h.hardDue = current.hardDue;
    h.markDone = current.markDone;
  }else{
    h.dueDate = null;
    h.hardDue = false;
    h.eventTime = null;
    // build habits can be event-style (auto-log on schedule); others stay manual
    h.markDone = current.type === 'keepup' ? current.markDone : true;
  }
  if(!h.createdAt)h.createdAt = Date.now();
  h.lastLog = latestActualLog(h.logs);
  save(data);
  showToast('saved');
  closeSheet('detail-sheet');
  detailIdx = null;
  detailTuneOriginal = null;
  render();
});
$('detail-mark').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  openDetail(detailIdx);
  render();
});
if($('detail-add'))$('detail-add').addEventListener('click',()=>{
  if(detailIdx === null)return;
  if(!logTing(detailIdx))return;
  openDetail(detailIdx);
  render();
});
$('detail-cool').addEventListener('click',closeDetail);
$('detail-close').addEventListener('click',()=>{restoreDetailTune();closeDetail();});
$('detail-snooze').addEventListener('click',()=>{
  if(detailIdx === null)return;
  snoozeFromDetail = true;
  openSnooze(detailIdx);
});
$('detail-export').addEventListener('click',()=>{
  if(detailIdx === null)return;
  exportToCalendar(detailIdx);
});
$('detail-delete').addEventListener('click',()=>{
  $('detail-delete-confirm').hidden = false;
});
$('detail-delete-no').addEventListener('click',()=>{
  $('detail-delete-confirm').hidden = true;
});
$('detail-delete-yes').addEventListener('click',()=>{
  if(detailIdx === null)return;
  const idx = detailIdx;
  closeDetail();
  doNuke(idx);
});
$('detail-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeDetail();});
const _detailSheetInner = getSheetInner('detail-sheet');
if (_detailSheetInner) _detailSheetInner.querySelectorAll('.detail-actions button').forEach(btn=>{
  btn.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
});
bindCalendarTap($('detail-calendar'),'[data-entry-day]',day=>{
  if(!day || detailIdx === null)return;
  const h = load()[detailIdx];
  if(!h)return;
  const key = day.dataset.entryDay;
  if(hasPlannedEntryForDay(h,key) || hasScheduledMarkerForDay(h,key)){
    dayLogsKey = key;
    renderCalendar(h);
    renderDayLogs(key);
    openSheet('day-logs-sheet');
    return;
  }
  const ts = new Date(`${key}T12:00:00`).getTime();
  if(!logTingAt(detailIdx,ts))return;
  dayLogsKey = key;
  refreshOpenViews();
});
$('detail-prev-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailMonthOffset -= 1;
  renderCalendar(load()[detailIdx]);
});
$('detail-next-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailMonthOffset += 1;
  renderCalendar(load()[detailIdx]);
});
getSheetInner('detail-sheet')?.querySelector('.detail-pager')?.addEventListener('scroll',()=>{
  requestAnimationFrame(updateDetailPagerDots);
},{passive:true});

$('open-about').addEventListener('click',()=>openSheet('about-sheet'));
$('about-close').addEventListener('click',()=>closeSheet('about-sheet'));
$('about-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('about-sheet');});
$('about-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('open-settings').addEventListener('click',()=>{
  closeSheet('about-sheet');
  resetSettingsSheetState();
  syncSettingsControls();
  openSheet('settings-sheet');
});
$('settings-close').addEventListener('click',()=>closeSheet('settings-sheet'));
$('settings-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('settings-sheet');});
$('settings-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('default-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-default-type]');
  if(!opt)return;
  updateSortSetting({defaultType:opt.dataset.defaultType});
});
$('travel-mode-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-travel-mode]');
  if(!opt)return;
  updateSortSetting({defaultTravelMode:normalizeTravelMode(opt.dataset.travelMode)});
});
document.querySelectorAll('[data-setting-toggle]').forEach(btn=>{
  btn.addEventListener('click',e=>{
    if(suppressNativeButton === btn){
      e.preventDefault();
      return;
    }
    toggleAppSettingButton(btn);
  });
});
$('settings-sheet').addEventListener('pointerdown',e=>{
  const control = e.target.closest('[data-setting-toggle]');
  if(!control)return;
  settingsPointer = {control,id:e.pointerId,x:e.clientX,y:e.clientY};
},{passive:true});
$('settings-sheet').addEventListener('pointerup',e=>{
  if(!settingsPointer || settingsPointer.id !== e.pointerId)return;
  const {control,x,y} = settingsPointer;
  settingsPointer = null;
  const moved = Math.hypot(e.clientX - x,e.clientY - y);
  if(moved > 18)return;
  e.preventDefault();
  e.stopPropagation();
  toggleAppSettingButton(control);
  suppressNativeButton = control;
  setTimeout(()=>{if(suppressNativeButton === control)suppressNativeButton = null;},80);
});
$('settings-sheet').addEventListener('pointercancel',()=>{settingsPointer = null;},{passive:true});
$('topic-add').addEventListener('click',addTopic);
$('topic-name').addEventListener('keydown',e=>{if(e.key === 'Enter')addTopic();});
$('topic-list').addEventListener('click',e=>{
  const btn = e.target.closest('[data-remove-topic]');
  if(!btn)return;
  removeTopic(btn.dataset.removeTopic);
});
$('availability-grid').addEventListener('change',e=>{
  const field = e.target.closest('[data-availability-day]');
  if(!field)return;
  saveAvailabilityDay(parseInt(field.dataset.availabilityDay,10),field.value);
});
$('blocked-time-add')?.addEventListener('click',addBlockedTime);
$('blocked-time-list')?.addEventListener('change',e=>{
  const label = e.target.closest('[data-blocked-label]');
  const start = e.target.closest('[data-blocked-start]');
  const end = e.target.closest('[data-blocked-end]');
  const loc = e.target.closest('[data-blocked-location]');
  if(label)saveBlockedTimePatch(parseInt(label.dataset.blockedLabel,10),{label:cleanTopic(label.value) || 'blocked'});
  if(start)saveBlockedTimePatch(parseInt(start.dataset.blockedStart,10),{start:timeInputToMinutes(start.value)});
  if(end)saveBlockedTimePatch(parseInt(end.dataset.blockedEnd,10),{end:timeInputToMinutes(end.value)});
  if(loc)saveBlockedTimePatch(parseInt(loc.dataset.blockedLocation,10),{locationId:loc.value || null});
});
$('blocked-time-list')?.addEventListener('click',e=>{
  const remove = e.target.closest('[data-blocked-remove]');
  if(remove){
    removeBlockedTime(parseInt(remove.dataset.blockedRemove,10));
    return;
  }
  const day = e.target.closest('[data-blocked-day]');
  if(!day)return;
  const index = parseInt(day.dataset.blockedIndex,10);
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  const block = blocks[index];
  if(!block)return;
  const fullSet = block.days.length ? block.days : [0,1,2,3,4,5,6];
  const next = new Set(fullSet);
  const value = parseInt(day.dataset.blockedDay,10);
  if(next.has(value))next.delete(value);
  else next.add(value);
  saveBlockedTimePatch(index,{days:normalizeAllowedWeekdays([...next])});
});
// ── Locations (settings sheet) ──
$('loc-open-picker')?.addEventListener('click',()=>openLocationPicker());
$('picker-search-btn')?.addEventListener('click',searchPickerLocations);
$('picker-search')?.addEventListener('keydown',e=>{ if(e.key === 'Enter'){ e.preventDefault(); searchPickerLocations(); } });
$('picker-results')?.addEventListener('click',e=>{
  const btn = e.target.closest('[data-picker-result]');
  if(btn)pickPickerResult(parseInt(btn.dataset.pickerResult,10));
});
$('picker-gps')?.addEventListener('click',centerPickerOnGps);
$('picker-drop-pin')?.addEventListener('click',dropPinAtMapCenter);
$('picker-apply-coords')?.addEventListener('click',applyPickerCoordsInputs);
$('picker-save')?.addEventListener('click',saveLocationPicker);
$('picker-cancel')?.addEventListener('click',closeLocationPicker);
$('location-picker-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeLocationPicker();
});
$('location-list')?.addEventListener('change',e=>{
  const name = e.target.closest('[data-loc-name]');
  if(name){ saveLocationPatch(parseInt(name.dataset.locName,10),{name:name.value}); return; }
  const addr = e.target.closest('[data-loc-address]');
  if(addr){ saveLocationPatch(parseInt(addr.dataset.locAddress,10),{address:addr.value}); return; }
  const start = e.target.closest('[data-loc-start]');
  const end = e.target.closest('[data-loc-end]');
  if(start || end){ commitLocationHours(parseInt((start?.dataset.locStart || end?.dataset.locEnd),10)); return; }
  const rad = e.target.closest('[data-loc-radius]');
  if(rad){
    const idx = parseInt(rad.dataset.locRadius,10);
    const raw = Number(rad.value);
    const radiusM = Number.isFinite(raw)
      ? Math.max(10,Math.min(2000,Math.round(raw)))
      : DEFAULT_LOCATION_RADIUS_M;
    saveLocationPatch(idx,{radiusM});
    return;
  }
  const ps = e.target.closest('[data-loc-pref-start]');
  const pe = e.target.closest('[data-loc-pref-end]');
  if(ps || pe){ commitLocationPref(parseInt((ps?.dataset.locPrefStart || pe?.dataset.locPrefEnd),10)); return; }
  const ds = e.target.closest('[data-loc-day-start]');
  const de = e.target.closest('[data-loc-day-end]');
  if(ds || de){ commitLocationDayHours(parseInt((ds||de).dataset.locDayIdx,10),parseInt((ds||de).dataset.locDayStart || (ds||de).dataset.locDayEnd,10)); return; }
  const dc = e.target.closest('[data-loc-day-closed]');
  if(dc){
    const weekday = parseInt(dc.dataset.locDayClosed,10);
    const idx = parseInt(dc.dataset.locDayIdx,10);
    if(dc.checked)saveLocationDayPatch(idx,weekday,{closed:true});
    else commitLocationDayHours(idx,weekday);
    return;
  }
});
$('location-list')?.addEventListener('click',e=>{
  // All day toggle (button). Use data-loc-allday — data-* names with digits
  // (e.g. data-loc-24h) do not map onto element.dataset reliably.
  const allDayBtn = e.target.closest('[data-loc-allday]');
  if(allDayBtn){
    const idx = parseInt(allDayBtn.getAttribute('data-loc-allday'),10);
    if(!Number.isInteger(idx))return;
    clearLocationHoursEditing(idx);
    const isAllDay = allDayBtn.classList.contains('on') || allDayBtn.getAttribute('aria-pressed') === 'true';
    if(isAllDay){
      saveLocationPatch(idx,{allowedTimeStart:9 * 60,allowedTimeEnd:17 * 60});
    }else{
      saveLocationPatch(idx,{allowedTimeStart:null,allowedTimeEnd:null});
    }
    return;
  }
  const editPin = e.target.closest('[data-loc-edit-pin]');
  if(editPin){
    const idx = parseInt(editPin.dataset.locEditPin,10);
    const loc = normalizeLocationRegistry(sortSettings.locations)[idx];
    if(loc)openLocationPicker({index:idx,name:loc.name,address:loc.address,lat:loc.lat,lng:loc.lng});
    return;
  }
  const remove = e.target.closest('[data-loc-remove]');
  if(remove){ removeLocation(parseInt(remove.dataset.locRemove,10)); return; }
  const more = e.target.closest('[data-loc-more]');
  if(more){ toggleLocationMore(parseInt(more.dataset.locMore,10)); return; }
  const prefClear = e.target.closest('[data-loc-pref-clear]');
  if(prefClear){ saveLocationPatch(parseInt(prefClear.dataset.locPrefClear,10),{preferredTimeStart:null,preferredTimeEnd:null}); return; }
  const closedDay = e.target.closest('[data-loc-closed-day]');
  if(closedDay){
    const idx = parseInt(closedDay.dataset.locIndex,10);
    const day = parseInt(closedDay.dataset.locClosedDay,10);
    const locations = normalizeLocationRegistry(sortSettings.locations);
    const set = new Set(locations[idx] ? (locations[idx].closedDays || []) : []);
    if(set.has(day))set.delete(day); else set.add(day);
    saveLocationPatch(idx,{closedDays:[...set].sort((a,b)=>a-b)});
    return;
  }
});
bindSettingRange('default-target','defaultTarget','d',{custom:false});
document.querySelectorAll('.settings-collapse-head').forEach(head=>{
  head.addEventListener('click',()=>{
    const body = $(head.dataset.collapseTarget);
    if(!body)return;
    const opening = body.hidden;
    body.hidden = !opening;
    head.setAttribute('aria-expanded',String(opening));
  });
});
$('backup-export')?.addEventListener('click',exportBackupFile);
$('backup-import')?.addEventListener('click',()=>$('backup-file-input')?.click());
$('backup-file-input')?.addEventListener('change',e=>{
  const file = e.target.files && e.target.files[0];
  handleBackupFileChosen(file);
});
$('backup-import-yes')?.addEventListener('click',confirmBackupImport);
$('backup-import-no')?.addEventListener('click',cancelBackupImport);
$('add-sort-samples')?.addEventListener('click',addSortSamples);
$('remove-sort-samples')?.addEventListener('click',removeSortSamples);
$('settings-reset').addEventListener('click',()=>{
  $('settings-reset-confirm').hidden = false;
});
$('settings-reset-no').addEventListener('click',()=>{
  $('settings-reset-confirm').hidden = true;
});
$('settings-reset-yes').addEventListener('click',()=>{
  saveSortSettings({...DEFAULT_SORT_SETTINGS});
  syncSettingsControls();
  render();
  showToast('settings reset');
});

$('open-overview').addEventListener('click',()=>{
  if(!load().length)return;
  closeSearch();
  overviewMonthOffset = 0;
  overviewRecentOffset = 0;
  overviewTopicFilter = 'all';
  overviewLocationFilter = 'all';
  overviewRangeFilter = 'recent';
  renderOverview();
  openSheet('overview-sheet');
});
$('overview-close').addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('overview-sheet');});
$('overview-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('overview-prev-month').addEventListener('click',()=>{
  if(overviewRangeFilter === 'recent')overviewRecentOffset -= 14;
  else overviewMonthOffset -= 1;
  renderOverview();
});
$('overview-next-month').addEventListener('click',()=>{
  if(overviewRangeFilter === 'recent')overviewRecentOffset += 14;
  else overviewMonthOffset += 1;
  renderOverview();
});
$('overview-tag-filter')?.addEventListener('click',e=>{
  const topicBtn = e.target.closest('[data-overview-topic]');
  if(topicBtn){
    overviewTopicFilter = topicBtn.dataset.overviewTopic || 'all';
    dayLogsKey = null;
    renderOverview();
    return;
  }
  const locBtn = e.target.closest('[data-overview-location]');
  if(locBtn){
    overviewLocationFilter = locBtn.dataset.overviewLocation || 'all';
    dayLogsKey = null;
    renderOverview();
  }
});
$('overview-range-filter').addEventListener('click',e=>{
  const btn = e.target.closest('[data-overview-range]');
  if(!btn)return;
  overviewRangeFilter = btn.dataset.overviewRange || 'recent';
  overviewMonthOffset = 0;
  overviewRecentOffset = 0;
  dayLogsKey = null;
  renderOverview();
});
$('home-tag-filter')?.addEventListener('click',e=>{
  if(e.target.closest('[data-home-presence]')){
    openPresencePicker();
    return;
  }
  const topicBtn = e.target.closest('[data-home-topic]');
  if(topicBtn){
    homeTopicFilter = topicBtn.dataset.homeTopic || 'all';
    render();
    return;
  }
  const locBtn = e.target.closest('[data-home-location]');
  if(locBtn){
    homeLocationFilter = locBtn.dataset.homeLocation || 'all';
    render();
  }
});
$('presence-picker-chips')?.addEventListener('click',async e=>{
  const gps = e.target.closest('[data-presence-gps]');
  if(gps){
    const s = sortSettings || loadSortSettings();
    if(s.locationOptIn || currentCoord){
      await requestLocationAccess({quiet:false});
    }else{
      locationAllowCallback = ()=>{
        renderPresencePickerBody();
        renderIAmAtPicker();
        renderTodayAgenda();
        render();
      };
      openLocationPermissionSheet();
    }
    renderPresencePickerBody();
    renderIAmAtPicker();
    renderTodayAgenda();
    render();
    return;
  }
  const btn = e.target.closest('[data-presence-pick]');
  if(!btn)return;
  setManualLocationId(btn.dataset.presencePick);
  renderPresencePickerBody();
  renderIAmAtPicker();
  renderTodayAgenda();
  render();
});
$('location-access-enable')?.addEventListener('click',()=>{
  const s = sortSettings || loadSortSettings();
  if(s.locationOptIn || currentCoord){
    requestLocationAccess({quiet:false,enableHighAccuracy:true});
    return;
  }
  locationAllowCallback = ()=>{
    renderLocationAccessControl();
    renderIAmAtPicker();
    render();
  };
  openLocationPermissionSheet();
});
$('location-permission-allow')?.addEventListener('click',()=>{
  confirmLocationPermissionAllow();
});
$('location-permission-cancel')?.addEventListener('click',()=>{
  closeLocationPermissionSheet();
});
$('location-permission-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeLocationPermissionSheet();
});
$('presence-picker-close')?.addEventListener('click',()=>closeSheet('presence-picker-sheet'));
$('presence-picker-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeSheet('presence-picker-sheet');
});
$('list')?.addEventListener('click',e=>{
  const card = e.target.closest('.travel-card[data-travel-from]');
  if(!card)return;
  e.preventDefault();
  e.stopPropagation();
  openTravelEditSheet(card.dataset.travelFrom,card.dataset.travelTo);
});
$('today-content')?.addEventListener('click',e=>{
  const row = e.target.closest('.today-travel-row[data-travel-from]');
  if(!row)return;
  openTravelEditSheet(row.dataset.travelFrom,row.dataset.travelTo);
});
$('travel-edit-minus')?.addEventListener('click',()=>{
  const input = $('travel-edit-minutes');
  if(!input)return;
  input.value = String(Math.max(1,(Number(input.value) || 1) - 1));
});
$('travel-edit-plus')?.addEventListener('click',()=>{
  const input = $('travel-edit-minutes');
  if(!input)return;
  input.value = String(Math.min(240,(Number(input.value) || 1) + 1));
});
$('travel-edit-save')?.addEventListener('click',saveTravelEditFromSheet);
$('travel-edit-reset')?.addEventListener('click',()=>{ resetTravelEditFromSheet(); });
$('travel-edit-cancel')?.addEventListener('click',closeTravelEditSheet);
$('travel-edit-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeTravelEditSheet();
});
bindCalendarTap($('overview-calendar'),'[data-log-day]',day=>{
  if(!day)return;
  dayLogsKey = day.dataset.logDay;
  renderOverview();
  renderDayLogs(dayLogsKey);
  openSheet('day-logs-sheet');
});
bindCalendarTap($('today-week-strip'),'[data-log-day]',day=>{
  if(!day)return;
  dayLogsKey = day.dataset.logDay;
  if(typeof renderTodayWeekStrip === 'function')renderTodayWeekStrip(load());
  renderDayLogs(dayLogsKey);
  openSheet('day-logs-sheet');
});
$('day-log-add').addEventListener('click',()=>{
  if(!dayLogsKey)return;
  const idx = parseInt($('day-log-ting').value,10);
  if(Number.isNaN(idx))return;
  const h = load()[idx];
  if(!h || (h.type === 'task' && h.lastLog !== null))return;
  if(!planTingOnDay(idx,dayLogsKey,$('day-log-time')?.value || '',{openAction:false}))return;
  if($('day-log-time'))$('day-log-time').value = '';
  renderDayLogs(dayLogsKey);
  refreshOpenViews();
});
$('day-availability-save').addEventListener('click',saveDayAvailabilityOverride);
$('day-availability-minutes').addEventListener('keydown',e=>{if(e.key === 'Enter')saveDayAvailabilityOverride();});
$('day-availability-clear').addEventListener('click',clearDayAvailabilityOverride);
$('day-logs-list').addEventListener('click',e=>{
  const openBtn = e.target.closest('[data-open-day-item]');
  if(openBtn){
    const idx = parseInt(openBtn.dataset.openDayItem,10);
    if(Number.isNaN(idx))return;
    openDetailFromDayLogs(idx);
    return;
  }
  const removeBtn = e.target.closest('[data-remove-plan]');
  if(removeBtn){
    const idx = parseInt(removeBtn.dataset.removePlan,10);
    const key = removeBtn.dataset.planDay;
    removePlansOnDay(idx,key);
    return;
  }
  const moveBtn = e.target.closest('[data-move-plan]');
  if(moveBtn){
    const row = moveBtn.closest('.overview-item');
    if(row){
      row.querySelector('.plan-actions').hidden = true;
      const inline = row.querySelector('.move-inline');
      if(inline){inline.hidden = false;row.querySelector('.move-date')?.focus();}
    }
    return;
  }
  const cancelBtn = e.target.closest('[data-move-cancel]');
  if(cancelBtn){
    const row = cancelBtn.closest('.overview-item');
    if(row){
      row.querySelector('.plan-actions').hidden = false;
      row.querySelector('.move-inline').hidden = true;
    }
    return;
  }
  const goBtn = e.target.closest('[data-move-go]');
  if(goBtn){
    const row = goBtn.closest('.overview-item');
    if(!row)return;
    const idx = parseInt(goBtn.dataset.moveGo,10);
    const fromKey = row.querySelector('.move-date').dataset.moveFrom;
    const toKey = row.querySelector('.move-date').value;
    if(!toKey)return;
    movePlanTo(idx,fromKey,toKey);
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

$('day-logs-overview').addEventListener('click',()=>{
  dayLogsKey = null;
  closeSheet('day-logs-sheet');
  renderOverview();
});
$('day-logs-home').addEventListener('click',()=>{
  dayLogsKey = null;
  closeSheet('day-logs-sheet');
  closeSheet('overview-sheet');
});
$('day-logs-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget){dayLogsKey = null;closeSheet('day-logs-sheet');renderOverview();}});
$('day-logs-sheet').addEventListener('pointerup',e=>{if(e.target === e.currentTarget){dayLogsKey = null;closeSheet('day-logs-sheet');renderOverview();}});
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

render();
ensureOverviewPlacement();
if (paneTierActive() && typeof renderOverview === 'function') renderOverview();
if (typeof initReminders === 'function') initReminders();
if (typeof resumeLocationWatchIfOptedIn === 'function') resumeLocationWatchIfOptedIn();
if (typeof sweepAutoDoneTasks === 'function'){
  sweepAutoDoneTasks();
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden)setTimeout(sweepAutoDoneTasks,300); });
  setInterval(sweepAutoDoneTasks,5 * 60 * 1000);
}
