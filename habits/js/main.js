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
    // Background travel refresh — skip the DOM wipe when travel/place/clock
    // fingerprint is unchanged (avoids jitter from no-op rebuilds).
    if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged();
    else if(typeof render === 'function')render();
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
  if(type === 'task')syncTaskDueUi();
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
  const hasSearchableArchive = data.some(h=>h.type === 'task' && isTaskDone(h));
  if(data.length < 10 && !hasSearchableArchive)return;
  if(isSearchOpen())closeSearch();
  else setSearchOpen(true);
});
$('bar-open-search')?.addEventListener('click',()=>{
  const data = load();
  const hasSearchableArchive = data.some(h=>h.type === 'task' && isTaskDone(h));
  if(data.length < 10 && !hasSearchableArchive)return;
  if(isSearchOpen())closeSearch();
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
  if(searchQuery.trim()){
    searchQuery = '';
    $('habit-search').value = '';
    updateSearchUi();
    render();
    $('habit-search').focus({preventScroll:true});
    return;
  }
  closeSearch();
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
  const target = isHabit ? targetFromRhythmParts($('ting-times')?.value || 1,$('ting-days').value) : null;
  const locationIds = selectedLocationIds();
  const locationPrefs = selectedLocationPrefs();
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
    locationIds,
    locationPrefs,
    preferredLocationId:primaryPreferredLocationId(locationPrefs,locationIds),
    createdAt:Date.now()
  };
  if(type === 'task'){
    record.dueDate = parseDateInput($('ting-due-date').value);
    record.eventTime = parseTaskWhen($('ting-due-date').value,$('ting-due-time')?.value || '');
    if(record.eventTime !== null && record.dueDate === null)record.dueDate = dayStart(record.eventTime);
    record.flexibilityDays = record.dueDate === null ? 0 : 3;
  }
  record.autoMarkMinutes = normalizeAutoMark($('ting-auto-mark')?.value);
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

// WIRE: task due-date hint
function syncTaskDueUi(){
  const dueInput = $('ting-due-date');
  const timeInput = $('ting-due-time');
  if(!dueInput)return;
  const hasDate = Boolean(dueInput.value);
  const hasTime = Boolean(timeInput?.value);
  const hint = $('task-due-hint');
  if(hint){
    if(!hasDate)hint.textContent = 'No due date. This stays in your list as a low-priority someday task until you date it or finish it.';
    else if(hasTime)hint.textContent = 'Fixed appointment — shows on your agenda at this time. Clear the date to remove both.';
    else hint.textContent = 'Due on this date — set flexibility to 0 for a firm deadline.';
  }
}
$('ting-due-date').addEventListener('input',syncTaskDueUi);
$('ting-due-time')?.addEventListener('input',syncTaskDueUi);
syncTaskDueUi();

// PURE: clamp rhythm value to valid range
function clampRhythm(value){
  return clampRhythmValue(value);
}

// PURE: return help text for a rhythm type
function rhythmHelp(type){
  if(type === 'reduce')return 'Something to space out. Use times in N days (e.g. 1× in 3d).';
  if(type === 'zero')return 'Something to avoid. Log it each time it happens; the aim is longer gaps.';
  if(type === 'task')return 'A one-off to-do. Add a due date, a fixed scheduled time, or leave it dateless.';
  return 'Something to do regularly. Use times in N days — e.g. 2× in 7d is every 3.5 days.';
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
  const planByRow = $('detail-plan-by-row');
  const planByHint = $('detail-plan-by-hint');
  if(planByRow)planByRow.hidden = !isHabit;
  if(planByHint)planByHint.hidden = !isHabit;
  const flexHelp = $('detail-flexibility-help');
  if(flexHelp){
    flexHelp.textContent = type === 'task'
      ? 'How many days before the due date this task starts surfacing.'
      : 'Adds a buffer to your target for planning purposes.';
  }
  const exportBtn = $('detail-export');
  if(exportBtn)exportBtn.hidden = type !== 'task';
  if(typeof syncDetailDueUi === 'function')syncDetailDueUi();
  if(typeof syncDetailPlanByUi === 'function')syncDetailPlanByUi();
}

// RENDER: update detail priority segmented control
function setDetailPriorityUi(priority){
  const p = clampPriority(priority);
  document.querySelectorAll('#detail-priority-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.priority,10) === p);
  });
}

// HYBRID: sync rhythm fields (times × days), label, and crown dial state
function syncRhythm(prefix,value){
  const field = $(`${prefix}-days`);
  const timesField = $(`${prefix}-times`);
  const parts = typeof value === 'object' && value && value.days != null
    ? {times:Math.max(1,parseInt(value.times,10) || 1),days:Math.max(1,parseInt(value.days,10) || 7)}
    : rhythmParts(clampRhythmValue(value));
  const prev = parseInt(field.dataset.orig || field.value,10) || 7;
  const days = Math.max(1,Math.min(MAX_RHYTHM_DAYS,parts.days));
  const times = Math.max(1,Math.min(30,parts.times));
  field.value = days;
  if(timesField)timesField.value = times;
  const label = $(`${prefix}-days-label`);
  if(label)label.textContent = formatRhythmLabel(targetFromRhythmParts(times,days));
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

function currentRhythmTarget(prefix){
  const days = parseInt($(`${prefix}-days`)?.value,10) || 7;
  const times = parseInt($(`${prefix}-times`)?.value,10) || 1;
  return targetFromRhythmParts(times,days);
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
  field.addEventListener('blur',e=>{
    const times = parseInt($(`${prefix}-times`)?.value,10) || 1;
    syncRhythm(prefix,{times,days:e.target.value || 7});
  });

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
    const days = Math.max(1,Math.min(MAX_RHYTHM_DAYS,parseInt(val,10) || 7));
    field.value = days;
    const times = parseInt($(`${prefix}-times`)?.value,10) || 1;
    if(label)label.textContent = formatRhythmLabel(targetFromRhythmParts(times,days));
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
['ting','detail'].forEach(prefix=>{
  const times = $(`${prefix}-times`);
  if(!times)return;
  times.addEventListener('input',()=>{
    const days = parseInt($(`${prefix}-days`)?.value,10) || 7;
    const t = Math.max(1,Math.min(30,parseInt(times.value,10) || 1));
    times.value = t;
    const label = $(`${prefix}-days-label`);
    if(label)label.textContent = formatRhythmLabel(targetFromRhythmParts(t,days));
    if(prefix === 'detail')setDetailDirty();
  });
});
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

function bindAutoMarkField(id,onDirty){
  const field = $(id);
  if(!field)return;
  field.addEventListener('input',e=>{
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,4);
    if(onDirty)onDirty();
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.was = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>{
    const n = normalizeAutoMark(e.target.value);
    e.target.value = n != null ? String(n) : '';
    if(onDirty)onDirty();
  });
}

bindCompactNumber('detail-duration',clampDuration,{maxLength:3});
bindCompactNumber('detail-flexibility',clampFlexibility,{maxLength:2});
bindCompactNumber('detail-times',clampTimes,{maxLength:2});
bindAutoMarkField('detail-auto-mark',()=>setDetailDirty());
bindAutoMarkField('ting-auto-mark');
function bindTimerAutoStopField(id,onDirty){
  const field = $(id);
  if(!field)return;
  field.addEventListener('input',e=>{
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,3);
    if(onDirty)onDirty();
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.was = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>{
    const n = normalizeTimerAutoStop(e.target.value);
    e.target.value = n != null ? String(n) : '';
    if(onDirty)onDirty();
  });
}
bindTimerAutoStopField('detail-timer-auto-stop',()=>setDetailDirty());
$('ting-tag-chips')?.addEventListener('click',e=>{
  if(e.target.closest('.tag-row')?._sg)return;
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('ting-tag-chips');
    return;
  }
  if(e.target.closest('[data-location-add]')){
    if(typeof openLocationPicker === 'function')openLocationPicker();
    return;
  }
  if(e.target.closest('.location-chip[data-location-id]')){
    toggleLocationChip(e);
    return;
  }
  toggleTopicChip(e);
});
$('detail-tag-chips')?.addEventListener('click',e=>{
  // Bail if the user was just scrolling the tag row (prevents accidental taps)
  if(e.target.closest('.tag-row')?._sg)return;
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('detail-tag-chips');
    return;
  }
  if(e.target.closest('[data-location-add]')){
    // Open the place picker; on save, auto-select the new place on this habit.
    if(typeof openLocationPicker === 'function'){
      openLocationPicker({
        onCreated:id=>{
          const wrap = 'detail-tag-chips';
          const selected = [...new Set([...selectedLocationIdsFrom(wrap),id])];
          const prefs = selectedLocationPrefsFrom(wrap);
          renderTagChips(wrap,selectedTopicsFrom(wrap),selected,null,prefs);
          setDetailDirty();
        }
      });
    }
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
  clearTimeEndpoint($('detail-time-start').closest('.time-endpoint'));
  clearTimeEndpoint($('detail-time-end').closest('.time-endpoint'));
  $('detail-time-clear').hidden = true;
  setDetailDirty();
});
$('detail-preferred-time-start').addEventListener('input',()=>{setDetailDirty();syncTimeClearBtn();});
$('detail-preferred-time-end').addEventListener('input',()=>{setDetailDirty();syncTimeClearBtn();});
$('detail-preferred-time-clear').addEventListener('click',()=>{
  clearTimeEndpoint($('detail-preferred-time-start').closest('.time-endpoint'));
  clearTimeEndpoint($('detail-preferred-time-end').closest('.time-endpoint'));
  $('detail-preferred-time-clear').hidden = true;
  setDetailDirty();
});

// Dynamic-time mode toggle, anchor select, habit picker, and offset input.
// Each endpoint (allowed start/end, preferred start/end) carries its own gear
// toggle that swaps the fixed <input type="time"> for an anchor+offset picker.
document.querySelectorAll('.time-endpoint').forEach(endpoint => {
  const toggle = endpoint.querySelector('.time-mode-toggle');
  const anchorSel = endpoint.querySelector('.time-anchor');
  const offsetInput = endpoint.querySelector('.time-offset');
  const habitSel = endpoint.querySelector('.time-habit');
  if(toggle)toggle.addEventListener('click',()=>{
    const turningDynamic = !endpoint.classList.contains('is-dynamic');
    if(turningDynamic){
      // First time switching to dynamic: default anchor to fajr and offset 0
      // so the user sees immediately how it resolves; they can change after.
      endpoint.classList.add('is-dynamic');
      if(anchorSel && !anchorSel.value)anchorSel.value = 'fajr';
    }else{
      endpoint.classList.remove('is-dynamic');
    }
    syncTimeModeVisibility(endpoint);
    setDetailDirty();
    syncTimeClearBtn();
  });
  if(anchorSel)anchorSel.addEventListener('change',()=>{
    setDetailDirty();
    syncTimeClearBtn();
    refreshTimeResolvedFor(endpoint);
  });
  if(offsetInput)offsetInput.addEventListener('input',()=>{
    setDetailDirty();
    refreshTimeResolvedFor(endpoint);
  });
  if(habitSel)habitSel.addEventListener('change',()=>{
    setDetailDirty();
    refreshTimeResolvedFor(endpoint);
  });
});

// RENDER: show fixed input vs anchor picker to match .is-dynamic class.
function syncTimeModeVisibility(endpoint){
  if(!endpoint)return;
  const dyn = endpoint.classList.contains('is-dynamic');
  const fixed = endpoint.querySelector('.time-fixed');
  const dynWrap = endpoint.querySelector('.time-dynamic');
  if(fixed)fixed.hidden = dyn;
  if(dynWrap)dynWrap.hidden = !dyn;
  refreshTimeResolvedFor(endpoint);
}

// RENDER: clear one endpoint back to empty (fixed mode, no value).
function clearTimeEndpoint(endpoint){
  if(!endpoint)return;
  endpoint.classList.remove('is-dynamic');
  const fixed = endpoint.querySelector('.time-fixed');
  if(fixed)fixed.value = '';
  const sel = endpoint.querySelector('.time-anchor');
  if(sel)sel.value = '';
  const off = endpoint.querySelector('.time-offset');
  if(off)off.value = '';
  const habitSel = endpoint.querySelector('.time-habit');
  if(habitSel)habitSel.value = '';
  const habitWrap = endpoint.querySelector('.time-habit-wrap');
  if(habitWrap)habitWrap.hidden = true;
  syncTimeModeVisibility(endpoint);
}

// RENDER: refresh the live preview on one endpoint. Merges lastLog/logs/hid
// from the saved habit so habit-anchor "consumed" previews stay accurate
// while the form is mid-edit. Delegates to updateTimeResolved for the
// prayer vs habit branching.
function refreshTimeResolvedFor(endpoint){
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return;
  const field = endpoint.dataset.field;
  if(!field)return;
  const h = currentDetailTune();
  if(detailIdx != null){
    const loaded = load()[detailIdx];
    if(loaded){
      h.hid = loaded.hid;
      h.lastLog = loaded.lastLog;
      h.logs = loaded.logs;
    }
  }
  const habitWrap = endpoint.querySelector('.time-habit-wrap');
  const anchor = cleanAnchor(h[field + 'Anchor']);
  if(habitWrap){
    habitWrap.hidden = anchor !== 'habit';
    if(anchor === 'habit')populateHabitPickerFor(endpoint, field, h);
  }
  updateTimeResolved(endpoint, field, h);
}
$('detail-due-date').addEventListener('input',()=>{
  if(!$('detail-due-date').value && $('detail-due-time'))$('detail-due-time').value = '';
  syncDetailDueUi();
  setDetailDirty();
});
$('detail-due-time')?.addEventListener('input',()=>{syncDetailDueUi();setDetailDirty();});
$('detail-plan-by-date')?.addEventListener('input',()=>{syncDetailPlanByUi();setDetailDirty();});
$('detail-plan-by-clear')?.addEventListener('click',()=>{
  $('detail-plan-by-date').value = '';
  syncDetailPlanByUi();
  setDetailDirty();
});
$('detail-plan-by-week')?.addEventListener('click',()=>{
  const end = typeof endOfWeekDate === 'function' ? endOfWeekDate() : dayStart(Date.now()) + 6 * 86400000;
  $('detail-plan-by-date').value = dateInputValue(end);
  syncDetailPlanByUi();
  setDetailDirty();
});
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
$('detail-pinned').addEventListener('click',function(){
  const pressed = this.getAttribute('aria-pressed') === 'true';
  this.setAttribute('aria-pressed',String(!pressed));
  setDetailDirty();
});
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
  h.locationPrefs = normalizeLocationPrefs(current.locationPrefs,h.locationIds,current.preferredLocationId);
  h.preferredLocationId = primaryPreferredLocationId(h.locationPrefs,h.locationIds);
  h.allowedWeekdays = normalizeAllowedWeekdays(current.allowedWeekdays);
  h.allowedMonthDays = normalizeAllowedMonthDays(current.allowedMonthDays);
  h.preferredWeekdays = normalizeAllowedWeekdays(current.preferredWeekdays);
  h.preferredMonthDays = normalizeAllowedMonthDays(current.preferredMonthDays);
  // Anchors override fixed minutes per-endpoint. Only wipe an incomplete
  // FIXED pair when neither endpoint is anchored — otherwise a mixed window
  // (e.g. start=sunrise, end=12pm) would lose its fixed end on save.
  const startAnchored = Boolean(cleanAnchor(current.allowedTimeStartAnchor));
  const endAnchored = Boolean(cleanAnchor(current.allowedTimeEndAnchor));
  h.allowedTimeStart = current.allowedTimeStart;
  h.allowedTimeEnd = current.allowedTimeEnd;
  if(!startAnchored && !endAnchored && (h.allowedTimeStart === null || h.allowedTimeEnd === null)){
    h.allowedTimeStart = null;
    h.allowedTimeEnd = null;
  }
  const prefStartAnchored = Boolean(cleanAnchor(current.preferredTimeStartAnchor));
  const prefEndAnchored = Boolean(cleanAnchor(current.preferredTimeEndAnchor));
  h.preferredTimeStart = current.preferredTimeStart;
  h.preferredTimeEnd = current.preferredTimeEnd;
  if(!prefStartAnchored && !prefEndAnchored && (h.preferredTimeStart === null || h.preferredTimeEnd === null)){
    h.preferredTimeStart = null;
    h.preferredTimeEnd = null;
  }
  h.allowedTimeStartAnchor = cleanAnchor(current.allowedTimeStartAnchor);
  h.allowedTimeStartOffsetMin = normalizePrayerOffset(current.allowedTimeStartOffsetMin);
  h.allowedTimeEndAnchor = cleanAnchor(current.allowedTimeEndAnchor);
  h.allowedTimeEndOffsetMin = normalizePrayerOffset(current.allowedTimeEndOffsetMin);
  h.preferredTimeStartAnchor = cleanAnchor(current.preferredTimeStartAnchor);
  h.preferredTimeStartOffsetMin = normalizePrayerOffset(current.preferredTimeStartOffsetMin);
  h.preferredTimeEndAnchor = cleanAnchor(current.preferredTimeEndAnchor);
  h.preferredTimeEndOffsetMin = normalizePrayerOffset(current.preferredTimeEndOffsetMin);
  // Habit-id refs only stick when the matching endpoint is in 'habit' mode.
  h.allowedTimeStartAnchorHabitId = h.allowedTimeStartAnchor === 'habit' ? (cleanHabitId(current.allowedTimeStartAnchorHabitId) || null) : null;
  h.allowedTimeEndAnchorHabitId = h.allowedTimeEndAnchor === 'habit' ? (cleanHabitId(current.allowedTimeEndAnchorHabitId) || null) : null;
  h.preferredTimeStartAnchorHabitId = h.preferredTimeStartAnchor === 'habit' ? (cleanHabitId(current.preferredTimeStartAnchorHabitId) || null) : null;
  h.preferredTimeEndAnchorHabitId = h.preferredTimeEndAnchor === 'habit' ? (cleanHabitId(current.preferredTimeEndAnchorHabitId) || null) : null;
  // Block: a 'habit' endpoint without a picked habit is incomplete.
  const habitAnchorFields = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];
  if(habitAnchorFields.some(f => h[f + 'Anchor'] === 'habit' && !h[f + 'AnchorHabitId'])){
    showToast('pick a habit for the dynamic time');
    return;
  }
  // Block: dynamic prayer anchors require at least one location on the habit.
  // Habit-anchors don't need a location (they resolve from another habit's log).
  if(habitUsesPrayerAnchors(h) && !(h.locationIds && h.locationIds.length)){
    showToast('add a location to use prayer times');
    return;
  }
  // Block: habit-anchor cycles (A starts after B, B starts after A) would
  // deadlock the agenda — refuse with a toast naming the chain.
  if(typeof detectHabitAnchorCycle === 'function' && h.hid){
    const cycle = detectHabitAnchorCycle(h.hid, {[h.hid]:h});
    if(cycle && cycle.length){
      showToast('cycle: ' + cycle.filter(Boolean).join(' → '));
      return;
    }
  }
  h.durationMinutes = current.durationMinutes;
  h.breakable = Boolean(current.breakable);
  h.minChunkMinutes = clampMinChunk(current.minChunkMinutes);
  h.timerAutoStopMinutes = normalizeTimerAutoStop(current.timerAutoStopMinutes);
  h.autoMarkMinutes = normalizeAutoMark(current.autoMarkMinutes);
  h.trackValue = Boolean(current.trackValue);
  h.flexibilityDays = current.flexibilityDays;
  h.priority = clampPriority(current.priority);
  const isHabit = current.type === 'keepup' || current.type === 'reduce';
  h.target = isHabit ? currentRhythmTarget('detail') : null;
  if(current.type === 'task'){
    h.eventTime = current.eventTime;
    h.dueDate = current.dueDate ?? (current.eventTime !== null ? dayStart(current.eventTime) : null);
    h.planByDate = null;
  }else{
    h.dueDate = null;
    h.eventTime = null;
    h.planByDate = isHabit ? (current.planByDate ?? null) : null;
  }
  h.hardDue = h.type === 'task' && h.dueDate !== null && h.flexibilityDays === 0;
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
  requestLogTing(detailIdx,()=>{
    openDetail(detailIdx);
    render();
  });
});
if($('detail-add'))$('detail-add').addEventListener('click',()=>{
  if(detailIdx === null)return;
  requestLogTing(detailIdx,()=>{
    openDetail(detailIdx);
    render();
  });
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
$('prayer-madhab-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-prayer-madhab]');
  if(!opt)return;
  // Method/madhab changes invalidate every cached prayer computation.
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  updateSortSetting({prayerMadhab:normalizePrayerMadhab(opt.dataset.prayerMadhab)});
});
document.getElementById('setting-prayer-method')?.addEventListener('change',e=>{
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  updateSortSetting({prayerMethod:normalizePrayerMethod(e.target.value)});
});
$('home-extra-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  updateSortSetting({homeExtraMode:normalizeHomeExtraMode(opt.dataset.segValue)});
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
  const startAnchor = e.target.closest('[data-blocked-start-anchor]');
  const endAnchor = e.target.closest('[data-blocked-end-anchor]');
  const startOffset = e.target.closest('[data-blocked-start-offset]');
  const endOffset = e.target.closest('[data-blocked-end-offset]');
  if(label)saveBlockedTimePatch(parseInt(label.dataset.blockedLabel,10),{label:cleanTopic(label.value) || 'blocked'});
  if(start)saveBlockedTimePatch(parseInt(start.dataset.blockedStart,10),{start:timeInputToMinutes(start.value)});
  if(end)saveBlockedTimePatch(parseInt(end.dataset.blockedEnd,10),{end:timeInputToMinutes(end.value)});
  if(loc)saveBlockedTimePatch(parseInt(loc.dataset.blockedLocation,10),{locationId:loc.value || null});
  if(startAnchor)saveBlockedTimePatch(parseInt(startAnchor.dataset.blockedStartAnchor,10),{startAnchor:cleanPrayerAnchor(startAnchor.value)});
  if(endAnchor)saveBlockedTimePatch(parseInt(endAnchor.dataset.blockedEndAnchor,10),{endAnchor:cleanPrayerAnchor(endAnchor.value)});
  if(startOffset)saveBlockedTimePatch(parseInt(startOffset.dataset.blockedStartOffset,10),{startOffsetMin:normalizePrayerOffset(startOffset.value)});
  if(endOffset)saveBlockedTimePatch(parseInt(endOffset.dataset.blockedEndOffset,10),{endOffsetMin:normalizePrayerOffset(endOffset.value)});
});
$('blocked-time-list')?.addEventListener('click',e=>{
  const remove = e.target.closest('[data-blocked-remove]');
  if(remove){
    removeBlockedTime(parseInt(remove.dataset.blockedRemove,10));
    return;
  }
  // Gear toggle: swap fixed ↔ prayer-anchor mode for one endpoint. Requires
  // a location on the block (normalize would strip the anchor otherwise).
  const startMode = e.target.closest('[data-blocked-start-mode]');
  const endMode = e.target.closest('[data-blocked-end-mode]');
  if(startMode || endMode){
    const field = startMode ? 'start' : 'end';
    const index = parseInt((startMode || endMode).dataset[field === 'start' ? 'blockedStartMode' : 'blockedEndMode'],10);
    const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
    const block = blocks[index];
    if(!block)return;
    const anchorKey = field + 'Anchor';
    const offsetKey = field + 'OffsetMin';
    if(block[anchorKey]){
      // Leave dynamic → clear the anchor; keep fixed minutes as-is.
      saveBlockedTimePatch(index,{[anchorKey]:null,[offsetKey]:0});
    }else{
      if(!block.locationId){
        showToast('pick a location to use prayer times');
        return;
      }
      saveBlockedTimePatch(index,{[anchorKey]:'fajr',[offsetKey]:0});
    }
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
    // "use GPS" = abandon any manual pin and let auto detection take over.
    if(typeof clearPinnedLocation === 'function')clearPinnedLocation();
    const s = sortSettings || loadSortSettings();
    if(s.locationOptIn || currentCoord){
      await requestLocationAccess({quiet:false});
    }else{
      locationAllowCallback = ()=>{
        renderPresencePickerBody();
        render();
      };
      openLocationPermissionSheet();
    }
    renderPresencePickerBody();
    render();
    return;
  }
  const btn = e.target.closest('[data-presence-pick]');
  if(!btn)return;
  setManualLocationId(btn.dataset.presencePick);
  renderPresencePickerBody();
  render();
});
$('location-access-enable')?.addEventListener('click',()=>{
  const s = sortSettings || loadSortSettings();
  // Toggle behavior: if already on, this click turns auto detection off
  // (the manual pin still applies for the home presence picker). Otherwise
  // request permission + start the watch as before.
  if(s.locationOptIn || currentCoord){
    if(typeof disableLocationAccess === 'function')disableLocationAccess();
    return;
  }
  locationAllowCallback = ()=>{
    renderLocationAccessControl();
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
$('travel-edit-maps')?.addEventListener('click',openTravelDestinationInMaps);
$('travel-edit-reset')?.addEventListener('click',()=>{ resetTravelEditFromSheet(); });
$('travel-edit-cancel')?.addEventListener('click',closeTravelEditSheet);
$('travel-edit-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeTravelEditSheet();
});

// Value log sheet
let valueLogIdx = null;
let valueLogAfter = null;
let valueLogMinutes = null;
function openValueLogSheet(idx,after,sessionMinutes){
  valueLogIdx = idx;
  valueLogAfter = after || null;
  valueLogMinutes = Number.isFinite(sessionMinutes) && sessionMinutes > 0 ? sessionMinutes : null;
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
  valueLogIdx = null;
  valueLogAfter = null;
  valueLogMinutes = null;
  closeSheet('value-log-sheet');
  if(idx == null)return;
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
$('value-log-cancel')?.addEventListener('click',()=>{
  valueLogIdx = null;
  valueLogAfter = null;
  valueLogMinutes = null;
  closeSheet('value-log-sheet');
});
$('value-log-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget){
    valueLogIdx = null;
    valueLogAfter = null;
    valueLogMinutes = null;
    closeSheet('value-log-sheet');
  }
});

/** Prompt for a value when trackValue is on, otherwise log immediately. */
function requestLogTing(idx,after){
  const h = load()[idx];
  if(!h)return;
  if(h.trackValue){
    openValueLogSheet(idx,after);
    return;
  }
  if(!logTing(idx))return;
  if(typeof after === 'function')after();
}

// Habit session timer (auto-stops, then prompts to log)
let habitTimer = null;
function stopHabitTimer(promptLog,manual){
  const btn = $('detail-timer-toggle');
  const display = $('detail-timer-display');
  if(habitTimer){
    clearInterval(habitTimer.interval);
    const elapsedMin = Math.max(1,Math.round((Date.now() - habitTimer.startedAt) / 60000));
    const idx = habitTimer.idx;
    habitTimer = null;
    if(btn)btn.textContent = 'start timer';
    if(display)display.hidden = true;
    if(promptLog && idx != null){
      const h = load()[idx];
      if(!h)return;
      const after = ()=>{ if(detailIdx === idx)openDetail(idx); render(); };
      if(manual){
        // Manual stop: confirm before logging. An accidental tap never
        // silently completes a task — the sheet offers a discard path that
        // creates no entry, plus an optional note/value for the session.
        openValueLogSheet(idx,after,elapsedMin);
        return;
      }
      // Auto-stop (timer ran its course): log the session automatically.
      // trackValue habits still get their value prompt with elapsed minutes; undo is available.
      if(h.trackValue)openValueLogSheet(idx,after,elapsedMin);
      else{
        logTing(idx,h && h.breakable && isAutoMark(h) ? {minutes:elapsedMin} : {});
        if(detailIdx === idx)openDetail(idx);
        render();
      }
    }
  }
}
function tickHabitTimer(){
  if(!habitTimer)return;
  const elapsed = Date.now() - habitTimer.startedAt;
  const left = Math.max(0,habitTimer.autoStopMs - elapsed);
  const display = $('detail-timer-display');
  if(display){
    const sec = Math.ceil(left / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    display.textContent = `${m}:${String(s).padStart(2,'0')}`;
    display.hidden = false;
  }
  if(left <= 0){
    showToast('timer done');
    stopHabitTimer(true);
    return;
  }
  if(habitTimer.autoMarkAt && Date.now() >= habitTimer.autoMarkAt){
    const idx = habitTimer.idx;
    const startedAt = habitTimer.startedAt;
    habitTimer.autoMarkAt = null;
    const h = load()[idx];
    if(h && (h.type !== 'task' || h.lastLog === null)){
      const elapsedMin = Math.max(1,Math.round((Date.now() - startedAt) / 60000));
      logTing(idx,h.breakable && isAutoMark(h) ? {minutes:elapsedMin} : {});
      if(detailIdx === idx)openDetail(idx);
      render();
    }
  }
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
bindScrollSafeTap($('detail-timer-toggle'),()=>{
  if(detailIdx === null)return;
  if(habitTimer){
    stopHabitTimer(true,true); // manual stop → confirm before logging
    return;
  }
  const h = load()[detailIdx];
  if(!h)return;
  const autoMin = h.timerAutoStopMinutes != null ? h.timerAutoStopMinutes : clampDuration(h.durationMinutes);
  const autoMarkAt = isAutoMark(h) ? Date.now() + (h.autoMarkMinutes || 0) * 60000 : null;
  habitTimer = {
    idx:detailIdx,
    startedAt:Date.now(),
    autoStopMs:autoMin * 60000,
    autoMarkAt,
    interval:setInterval(tickHabitTimer,250)
  };
  const btn = $('detail-timer-toggle');
  if(btn)btn.textContent = 'stop timer';
  tickHabitTimer();
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
bindCompactNumber('detail-min-chunk',clampMinChunk,{maxLength:3});
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

// Cold load: single sync render. Progressive (fast-then-full) was retired —
// the interim card order differed from the agenda and felt jittery.
if(typeof render === 'function')render();
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
function scheduleReopenRefresh(){
  if(_reopenRefreshTimer)return;
  _reopenRefreshTimer = setTimeout(()=>{
    _reopenRefreshTimer = null;
    if(typeof requestLocationAccess === 'function' && typeof resumeLocationWatchIfOptedIn === 'function'){
      resumeLocationWatchIfOptedIn({fresh:true});
    }
    // Force on reopen: wall-clock / place may have moved while we were hidden
    // even if the minute-bucket fingerprint has not rolled yet.
    if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged(true);
    else if(typeof render === 'function')render();
    if(typeof checkReminders === 'function')checkReminders();
  },200);
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return;
  closeAllSwipes();
  scheduleReopenRefresh();
});
window.addEventListener('pageshow',e=>{
  // bfcache restore (back/forward) — also refresh, since a lot of wall-clock
  // time may have passed while the page was frozen.
  if(e && e.persisted)scheduleReopenRefresh();
});

// WHILE OPEN: keep the home agenda fresh without rebuilding the DOM when
// nothing placement-relevant changed (minute, place, travel, habits).
const HOME_AGENDA_REFRESH_MS = 60 * 1000;
let _homeAgendaRefreshId = null;
let _homeAgendaRefreshTick = 0;

function refreshHomeAgendaWhileOpen(){
  if(document.hidden)return;
  if(typeof swipeOpenCard !== 'undefined' && swipeOpenCard)return;
  if(typeof sweepAutoDoneTasks === 'function'){
    const swept = sweepAutoDoneTasks();
    if(swept > 0)return; // refreshOpenViews already re-rendered
  }
  if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged();
  else if(typeof render === 'function')render();
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
