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
applyAppearanceSettings();
try{
  const params = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
  if(params.get('feed') && params.get('key') && params.get('viewer')
    && typeof isAgendaDisplayPage === 'function' && !isAgendaDisplayPage()){
    location.replace(typeof agendaDisplayHref === 'function'
      ? agendaDisplayHref(location.hash)
      : ('agenda-display/' + location.hash));
  }
}catch(_){}
if(typeof maybeClaimItemShareFromHash === 'function'){
  void maybeClaimItemShareFromHash().catch(()=>{});
}
{
  const reconciled = reconcileLocations(load(),sortSettings);
  if(reconciled.changed)save(reconciled.data);
}
if(typeof scheduleMonthlyRetentionCleanup === 'function')scheduleMonthlyRetentionCleanup();
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
let _travelRefreshLocationChanged = false;
onTravelRefresh = reason=>{
  _travelRefreshPending = true;
  // A changed presence is not merely a refreshed travel estimate. The current
  // agenda may have been solved from the place the user just left, so its
  // worker result must not be allowed to linger behind a passive refresh.
  if(reason && Object.prototype.hasOwnProperty.call(reason,'manual')){
    _travelRefreshLocationChanged = true;
  }
  if(_travelRefreshTimer)return;
  _travelRefreshTimer = setTimeout(() => {
    _travelRefreshTimer = null;
    if(!_travelRefreshPending)return;
    _travelRefreshPending = false;
    const locationChanged = _travelRefreshLocationChanged;
    _travelRefreshLocationChanged = false;
    // Background travel refresh — skip the DOM wipe when travel/place/clock
    // fingerprint is unchanged (avoids jitter from no-op rebuilds).
    if(typeof renderHomeIfChanged === 'function')renderHomeIfChanged(false,{locationChanged});
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
  if(typeof updateEmojiPreview === 'function')updateEmojiPreview();
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
  overviewListPane = 'plan';
  renderOverview();
  openSheet('overview-sheet');
});
$('bar-open-about')?.addEventListener('click',()=>openSheet('about-sheet'));
let _searchRenderTimer = null;
const SEARCH_RENDER_DEBOUNCE_MS = 500;
const scheduleSearchRender = () => {
  clearTimeout(_searchRenderTimer);
  _searchRenderTimer = setTimeout(render, SEARCH_RENDER_DEBOUNCE_MS);
};
$('habit-search').addEventListener('input',e=>{
  searchQuery = e.target.value;
  scheduleSearchRender();
});
$('habit-search').addEventListener('keydown',e=>{
  if(e.key !== 'Escape')return;
if(searchQuery){
    clearTimeout(_searchRenderTimer);
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
  scheduleSearchRender();
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
    clearTimeout(_searchRenderTimer);
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
  const settings = loadSortSettings();
  const type = selectedType;
  const isHabit = type === 'keepup' || type === 'reduce';
  const target = isHabit ? targetFromRhythmParts($('ting-times')?.value || 1,$('ting-days').value) : null;
  const locationIds = selectedLocationIds();
  const locationPrefs = selectedLocationPrefs();
  const userTopics = selectedAddTopics();
  const defTopics = Array.isArray(settings.defaultTopics) ? settings.defaultTopics : [];
  const mergedTopics = [...new Set([...defTopics,...userTopics])];
  const record = {
    name:name.slice(0,60),
    type,
    target,
    lastLog:null,
    logs:[],
    emoji:cleanMark($('ting-emoji').value),
    emojiBgColor:selectedEmojiBgColor('ting-emoji-bg'),
    pinned:false,
    priority:selectedAddPriority(),
    topics:mergedTopics,
    locationIds,
    anywhereAllowed:selectedAnywhere(),
    locationPrefs,
    preferredLocationId:primaryPreferredLocationId(locationPrefs,locationIds),
    durationMinutes:settings.defaultDurationMinutes,
    breakable:Boolean(settings.defaultBreakable),
    minChunkMinutes:settings.defaultMinChunkMinutes,
    createdAt:Date.now()
  };
  if(type === 'task'){
    record.dueDate = parseDateInput($('ting-due-date').value);
    record.eventTime = parseTaskWhen($('ting-due-date').value,$('ting-due-time')?.value || '');
    if(record.eventTime !== null && record.dueDate === null)record.dueDate = dayStart(record.eventTime);
    record.flexibilityDays = record.dueDate === null ? 0 : 3;
  }else{
    record.flexibilityDays = settings.defaultFlexibilityDays;
  }
  const manualAutoMark = normalizeAutoMark($('ting-auto-mark')?.value);
  record.autoMarkMinutes = manualAutoMark != null ? manualAutoMark : settings.defaultAutoMarkMinutes;
  data.push(record);
  if(save(data)){cancelAdd();render();openDetailSchedule(data.length - 1);}
});

// PURE: "YYYY-MM-DD" -> day-start ms timestamp, or null when blank
function parseDateInput(value){
  if(!value)return null;
  const ts = new Date(`${value}T12:00:00`).getTime();
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
  if(type === 'reduce')return 'Times in N days — e.g. 1× in 3d.';
  if(type === 'zero')return 'Something to avoid. Log it each time it happens; the aim is longer gaps.';
  if(type === 'task')return 'A one-off to-do. Add a due date, a fixed scheduled time, or leave it dateless.';
  return 'Times in N days — e.g. 2× in 7d = 3.5d.';
}

// PURE: map stored habit type <-> mode seg value (build/limit/stop)
function typeToMode(type){
  if(type === 'reduce')return 'limit';
  if(type === 'zero')return 'stop';
  return 'build';
}
function modeToType(mode){
  if(mode === 'limit')return 'reduce';
  if(mode === 'stop')return 'zero';
  return 'keepup';
}

// RENDER: update detail type segmented control + help
function setDetailTypeUi(type){
  const isTask = type === 'task';
  const mainType = isTask ? 'task' : 'keepup';
  document.querySelectorAll('#detail-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.detailType === mainType);
  });
  const modeField = $('detail-mode-field');
  if(modeField)modeField.hidden = isTask;
  if(!isTask){
    const mode = typeToMode(type);
    document.querySelectorAll('#detail-mode-seg .seg-opt').forEach(btn=>{
      btn.classList.toggle('on',btn.dataset.mode === mode);
    });
  }
  const isHabit = type === 'keepup' || type === 'reduce';
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

// Cached ridge ink — avoid getComputedStyle + color-mix on every frame (mobile jank).
let _crownRidgeRgb = null;
function crownRidgeRgb(){
  if(_crownRidgeRgb)return _crownRidgeRgb;
  const raw = (getComputedStyle(document.documentElement).getPropertyValue('--text2') || '').trim() || '#6b6a65';
  let r = 107, g = 106, b = 101;
  if(raw[0] === '#'){
    const hex = raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
    const n = parseInt(hex.slice(1), 16);
    if(!Number.isNaN(n)){ r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255; }
  }else{
    const m = raw.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if(m){ r = +m[1]; g = +m[2]; b = +m[3]; }
  }
  _crownRidgeRgb = [r, g, b];
  return _crownRidgeRgb;
}
if(typeof matchMedia === 'function'){
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const bust = ()=>{ _crownRidgeRgb = null; };
  if(scheme.addEventListener)scheme.addEventListener('change', bust);
  else if(scheme.addListener)scheme.addListener(bust);
}

// RENDER: draw crown dial ridges onto canvas.
// Sized once (or on resize); cheap rgba fills — critical for phone scrubbing.
function drawCrownRidges(canvas, scroll){
  if(!canvas || !canvas.isConnected)return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if(w === 0 || h === 0)return;
  const bw = (w * dpr) | 0;
  const bh = (h * dpr) | 0;
  let ctx = canvas._crownCtx;
  if(!ctx || canvas.width !== bw || canvas.height !== bh){
    canvas.width = bw;
    canvas.height = bh;
    ctx = canvas.getContext('2d', { alpha:true, desynchronized:true });
    canvas._crownCtx = ctx;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const R = w / 2, cx = w / 2;
  const stepDeg = 3.6, baseW = 2.2, radOff = scroll / R;
  const radOffDeg = radOff * 180 / Math.PI;
  const margin = 5;
  const startI = Math.ceil((-90 - margin - radOffDeg) / stepDeg);
  const endI = Math.floor((90 + margin - radOffDeg) / stepDeg);
  const [rr, gg, bb] = crownRidgeRgb();
  for(let i = startI; i <= endI; i++){
    const adjDeg = i * stepDeg + radOffDeg;
    const a = adjDeg * Math.PI / 180;
    const x = cx + R * Math.sin(a);
    const f = Math.max(0, Math.cos(a));
    const rw = baseW * f + 0.2;
    if(rw < 0.2 || x < -rw || x > w + rw)continue;
    const alpha = 0.85 * f + 0.15;
    ctx.fillStyle = `rgba(${rr},${gg},${bb},${alpha})`;
    ctx.fillRect(x - rw / 2, 1, Math.max(0.5, rw), h - 2);
  }
}

// WIRE: attach rhythm field listeners, plus crown dial gestures where a dial
// is mounted (the breakable card is the only remaining one).
function bindRhythm(prefix){
  const field = $(`${prefix}-days`);
  const crown = $(`${prefix}-days-slider`);
  const label = $(`${prefix}-days-label`);
  if(!field)return;

  field.addEventListener('input',e=>{
    const typed = e.target.value.replace(/\D/g,'').slice(0,3);
    e.target.value = typed;
    if(!typed)return;
    const days = clampRhythm(typed);
    if(label)label.textContent = `${days}d`;
    if(prefix === 'detail')setDetailDirty();
  });
  field.addEventListener('focus',e=>{
    e.target.dataset.orig = e.target.value;
    e.target.value = '';
  });
  field.addEventListener('blur',e=>{
    const times = parseInt($(`${prefix}-times`)?.value,10) || 1;
    syncRhythm(prefix,{times,days:e.target.value || 7});
  });
  if(!crown)return;

  let startVal,prevX,velX = 0,momentumId = null,smoothAnimId = null,scrubRaf = null;
  let pendingDx = 0, scrubbing = false;
  crown._scroll = 0;
  const canvas = crown.querySelector('.crown-canvas');
  const friction = 0.935;

  const cancelMomentum = () => {
    if(momentumId){cancelAnimationFrame(momentumId);momentumId=null;}
    if(smoothAnimId){cancelAnimationFrame(smoothAnimId);smoothAnimId=null;}
  };

  const cancelScrub = () => {
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;}
    pendingDx = 0;
  };

  crown._animateTo = target => {
    cancelMomentum();
    cancelScrub();
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

  const applyScrubDx = dx => {
    if(!dx)return;
    crown._scroll += dx;
    updateVisual(crown._scroll);
    const speed = Math.abs(velX);
    const gain = 1 + speed * 0.15;
    crown._valScroll += dx * gain;
    const newVal = clampRhythm(startVal + Math.round(crown._valScroll / 10));
    const oldVal = parseInt(field.value,10) || 7;
    if(newVal !== oldVal)setVal(newVal);
  };

  const flushScrub = () => {
    scrubRaf = null;
    const dx = pendingDx;
    pendingDx = 0;
    applyScrubDx(dx);
  };

  const startMomentum = initVel => {
    cancelMomentum();
    cancelScrub();
    const baseScroll = crown._scroll;
    const baseVal = parseInt(field.value,10) || 7;
    let vel = initVel;
    let last = performance.now();
    const tick = now => {
      const dt = Math.min(32, Math.max(0, now - last));
      last = now;
      // Frame-rate independent decay (friction calibrated at ~60fps).
      vel *= Math.pow(friction, dt / 16.67);
      if(Math.abs(vel) < 0.5){momentumId = null;return;}
      crown._scroll += vel * (dt / 16.67);
      const derivedVal = clampRhythm(baseVal + Math.round((crown._scroll - baseScroll) / 10));
      const curVal = parseInt(field.value,10) || 7;
      if(derivedVal !== curVal)setVal(derivedVal);
      drawCrownRidges(canvas,crown._scroll);
      momentumId = requestAnimationFrame(tick);
    };
    momentumId = requestAnimationFrame(tick);
  };

  crown.addEventListener('pointerdown',e=>{
    cancelMomentum();
    cancelScrub();
    prevX = e.clientX;
    startVal = parseInt(field.value,10) || 7;
    velX = 0;
    pendingDx = 0;
    scrubbing = true;
    crown._valScroll = 0;
    crown.setPointerCapture(e.pointerId);
    crown.classList.add('active');
  });

  crown.addEventListener('pointermove',e=>{
    if(!scrubbing || prevX === undefined)return;
    const dx = e.clientX - prevX;
    prevX = e.clientX;
    velX = velX * 0.55 + dx * 0.45;
    pendingDx += dx;
    if(!scrubRaf)scrubRaf = requestAnimationFrame(flushScrub);
  });

  const endDrag = () => {
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;flushScrub();}
    scrubbing = false;
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
    cancelScrub();
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
      cancelScrub();
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
  times.addEventListener('focus',e=>{
    e.target.dataset.orig = e.target.value;
    e.target.value = '';
  });
  times.addEventListener('blur',()=>{
    if(!times.value.trim())times.value = 1;
  });
  times.addEventListener('input',()=>{
    const days = parseInt($(`${prefix}-days`)?.value,10) || 7;
    const t = Math.max(1,Math.min(30,parseInt(times.value,10) || 1));
    times.value = t;
    const label = $(`${prefix}-days-label`);
    if(label)label.textContent = formatRhythmLabel(targetFromRhythmParts(t,days));
    if(prefix === 'detail')setDetailDirty();
  });
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
bindAutoMarkField('detail-auto-mark',()=>{ syncBreakableUi(); setDetailDirty(); });
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
    // Return to the in-progress habit with the new place already selected.
    // Preserve every other chip choice made before opening the map picker.
    if(typeof openLocationPicker === 'function'){
      openLocationPicker({
        onCreated:id=>{
          const wrap = 'ting-tag-chips';
          const selected = [...new Set([...selectedLocationIdsFrom(wrap),id])];
          const prefs = selectedLocationPrefsFrom(wrap);
          renderTagChips(wrap,selectedTopicsFrom(wrap),selected,null,prefs,false);
        }
      });
    }
    return;
  }
  if(e.target.closest('[data-anywhere]')){
    renderTagChips('ting-tag-chips',selectedTopicsFrom('ting-tag-chips'),selectedLocationIds(),null,selectedLocationPrefs(),!selectedAnywhereFrom('ting-tag-chips'));
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
  if(e.target.closest('[data-anywhere]')){
    renderTagChips('detail-tag-chips',selectedTopicsFrom('detail-tag-chips'),selectedLocationIdsFrom('detail-tag-chips'),null,selectedLocationPrefsFrom('detail-tag-chips'),!selectedAnywhereFrom('detail-tag-chips'));
    setDetailDirty();
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
$('detail-monthday-toggle')?.addEventListener('click',()=>{
  toggleMonthDayDisclosure($('detail-monthday-toggle'));
});
$('detail-preferred-monthday-toggle')?.addEventListener('click',()=>{
  toggleMonthDayDisclosure($('detail-preferred-monthday-toggle'));
});
$('detail-schedule-order')?.addEventListener('change',e=>{
  if(!e.target.closest('.schedule-link-habit'))return;
  const editor = e.target.closest('.schedule-link-editor');
  const h = detailIdx != null ? load()[detailIdx] : null;
  if(!editor || !h)return;
  refreshScheduleLinkEditorRow(editor,{...h,scheduleLinks:readScheduleLinksFromDetail(h.hid)});
  setDetailDirty();
});
$('detail-schedule-order')?.addEventListener('click',e=>{
  if(e.target.closest('#detail-schedule-link-add') || e.target.closest('.schedule-link-add')){
    if(typeof addBlankScheduleLinkRow === 'function')addBlankScheduleLinkRow();
    return;
  }
  const editor = e.target.closest('.schedule-link-editor');
  if(!editor)return;
  const dirBtn = e.target.closest('[data-link-direction]');
  if(dirBtn){
    editor.querySelectorAll('[data-link-direction]').forEach(btn=>btn.classList.toggle('on',btn === dirBtn));
    const h = detailIdx != null ? load()[detailIdx] : null;
    if(h)refreshScheduleLinkEditorRow(editor,{...h,scheduleLinks:readScheduleLinksFromDetail(h.hid)});
    setDetailDirty();
    return;
  }
  const adj = e.target.closest('[data-adjacency]');
  if(adj){
    editor.querySelectorAll('[data-adjacency]').forEach(btn=>btn.classList.toggle('on',btn === adj));
    setDetailDirty();
    return;
  }
  const sameDay = e.target.closest('.schedule-link-same-day');
  if(sameDay){
    sameDay.setAttribute('aria-pressed',sameDay.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    const h = detailIdx != null ? load()[detailIdx] : null;
    if(h)refreshScheduleLinkEditorRow(editor,{...h,scheduleLinks:readScheduleLinksFromDetail(h.hid)});
    setDetailDirty();
    return;
  }
  if(e.target.closest('.schedule-link-clear')){
    editor.remove();
    // Reindex remaining editors for stable data-link-index values.
    document.querySelectorAll('#detail-schedule-link-list .schedule-link-editor').forEach((row,idx)=>{
      row.dataset.linkIndex = String(idx);
    });
    setDetailDirty();
  }
});
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
  const combineSel = endpoint.querySelector('.time-combine');
  const anchor2Sel = endpoint.querySelector('.time-anchor2');
  const offset2Input = endpoint.querySelector('.time-offset2');
  const habit2Sel = endpoint.querySelector('.time-habit2');
  const fixed2Input = endpoint.querySelector('.time-fixed2');
  const dayBtn = endpoint.querySelector('.time-day-next');
  const day2Btn = endpoint.querySelector('.time-day-next2');
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
  const onDynChange = ()=>{ setDetailDirty(); syncTimeClearBtn(); refreshTimeResolvedFor(endpoint); };
  if(anchorSel)anchorSel.addEventListener('change', onDynChange);
  if(offsetInput)offsetInput.addEventListener('input',()=>{ setDetailDirty(); refreshTimeResolvedFor(endpoint); });
  if(habitSel)habitSel.addEventListener('change', onDynChange);
  if(combineSel)combineSel.addEventListener('change',()=>{
    const expr2 = endpoint.querySelector('.time-expr2');
    if(expr2)expr2.hidden = !cleanTimeCombine(combineSel.value);
    // Default second anchor to sunrise when first enabling combine.
    if(cleanTimeCombine(combineSel.value) && anchor2Sel && !anchor2Sel.value)anchor2Sel.value = 'sunrise';
    onDynChange();
  });
  if(anchor2Sel)anchor2Sel.addEventListener('change',()=>{
    if(anchor2Sel.value === 'fixed' && fixed2Input && !fixed2Input.value){
      fixed2Input.value = minutesToTimeInput(1200);
    }
    onDynChange();
  });
  if(offset2Input)offset2Input.addEventListener('input',()=>{ setDetailDirty(); refreshTimeResolvedFor(endpoint); });
  if(habit2Sel)habit2Sel.addEventListener('change', onDynChange);
  if(fixed2Input)fixed2Input.addEventListener('input',()=>{ setDetailDirty(); refreshTimeResolvedFor(endpoint); });
  if(dayBtn)dayBtn.addEventListener('click',()=>{
    const on = dayBtn.getAttribute('aria-pressed') === 'true';
    dayBtn.setAttribute('aria-pressed', on ? 'false' : 'true');
    onDynChange();
  });
  if(day2Btn)day2Btn.addEventListener('click',()=>{
    const on = day2Btn.getAttribute('aria-pressed') === 'true';
    day2Btn.setAttribute('aria-pressed', on ? 'false' : 'true');
    onDynChange();
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
  if(off){
    off.value = '';
    const btn = off.nextElementSibling;
    if(btn && btn.classList.contains('time-offset-sign-btn')){
      btn.dataset.sign = '+';
      btn.textContent = '+';
      btn.setAttribute('aria-label','positive offset');
    }
  }
  const habitSel = endpoint.querySelector('.time-habit');
  if(habitSel)habitSel.value = '';
  const habitWrap = endpoint.querySelector('.time-habit-wrap');
  if(habitWrap)habitWrap.hidden = true;
  const combine = endpoint.querySelector('.time-combine');
  if(combine)combine.value = '';
  const expr2 = endpoint.querySelector('.time-expr2');
  if(expr2)expr2.hidden = true;
  const fixed2 = endpoint.querySelector('.time-fixed2');
  if(fixed2){
    fixed2.value = '';
    fixed2.hidden = true;
  }
  const dayBtn = endpoint.querySelector('.time-day-next');
  if(dayBtn)dayBtn.setAttribute('aria-pressed','false');
  const day2Btn = endpoint.querySelector('.time-day-next2');
  if(day2Btn)day2Btn.setAttribute('aria-pressed','false');
  syncTimeModeVisibility(endpoint);
}

// RENDER: refresh the live preview on one endpoint. Merges lastLog/logs/hid
// from the saved habit so habit-anchor "consumed" previews stay accurate
// while the form is mid-edit. Also syncs habit-picker / +1d / second-expr
// visibility from the live form state.
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
  syncExprControls(endpoint, field, h, '');
  const combine = cleanTimeCombine(h[field + 'Combine']);
  const expr2 = endpoint.querySelector('.time-expr2');
  if(expr2)expr2.hidden = !combine;
  if(combine)syncExprControls(endpoint, field, h, '2');
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
$('detail-link-add')?.addEventListener('click',addDetailLinkRow);
$('detail-link-list')?.addEventListener('input',()=>{
  setDetailDirty();
  syncDetailLinkUi();
});
$('detail-link-list')?.addEventListener('change',()=>{
  setDetailDirty();
  syncDetailLinkUi();
});
$('detail-link-list')?.addEventListener('click',e=>{
  const remove = e.target.closest('[data-link-remove]');
  if(remove){ removeDetailLinkRow(Number(remove.dataset.linkRemove)); return; }
  const promote = e.target.closest('[data-link-promote]');
  if(promote)promoteDetailLinkRow(Number(promote.dataset.linkPromote));
});
$('detail-link-actions')?.addEventListener('click',e=>{
  const btn = e.target.closest('[data-link-open]');
  if(!btn)return;
  openDetailLink(Number(btn.dataset.linkOpen));
});
$('detail-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-detail-type]');
  if(!opt)return;
  if(opt.dataset.detailType === 'task'){
    setDetailTypeUi('task');
  }else{
    const mode = document.querySelector('#detail-mode-seg .seg-opt.on')?.dataset.mode || 'build';
    setDetailTypeUi(modeToType(mode));
  }
  setDetailDirty();
});
$('detail-mode-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-mode]');
  if(!opt)return;
  setDetailTypeUi(modeToType(opt.dataset.mode));
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
  e.preventDefault();
  e.stopPropagation();
  const tip = $(btn.dataset.tip);
  if(tip)tip.toggleAttribute('hidden');
});
document.addEventListener('click',e=>{
  const btn = e.target.closest('.time-offset-sign-btn');
  if(!btn)return;
  const input = btn.previousElementSibling;
  if(!input || !input.classList.contains('mini-time-input'))return;
  const neg = btn.dataset.sign !== '-';
  btn.dataset.sign = neg ? '-' : '+';
  btn.textContent = neg ? '−' : '+';
  btn.setAttribute('aria-label', (neg ? 'negative' : 'positive') + ' offset');
  // Update preview for detail view endpoints directly (avoids relying on
  // synthetic input events on number inputs which are unreliable on some
  // mobile browsers).
  const endpoint = input.closest('.time-endpoint');
  if(endpoint && typeof refreshTimeResolvedFor === 'function'){
    setDetailDirty();
    refreshTimeResolvedFor(endpoint);
  }
  // For blocked times, trigger change so the delegated handler saves.
  input.dispatchEvent(new Event('change', {bubbles:true}));
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
  h.scheduleLinks = normalizeScheduleLinks(current.scheduleLinks,h.hid);
  if(typeof validateScheduleLinkGraph === 'function'){
    const linkValidation = validateScheduleLinkGraph(data);
    if(!linkValidation.ok){
      showToast(linkValidation.message);
      return;
    }
  }
  // Cancel scheduled push for the pre-edit state (sig may change after edit).
  if(typeof cancelPush === 'function' && typeof reminderSignature === 'function' && h.type === 'task'){
    cancelPush(reminderSignature(h));
  }
  h.name = current.name.slice(0,60);
  h.type = current.type;
  h.emoji = current.emoji;
  h.emojiBgColor = normalizeEmojiBgColor(current.emojiBgColor);
  h.pinned = current.pinned;
  h.links = normalizeLinks(current.links);
  h.topics = normalizeTopics(current.topics);
  h.locationIds = normalizeLocationIds(current.locationIds,sortSettings.locations);
  h.anywhereAllowed = Boolean(current.anywhereAllowed);
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
  // Later/earlier-of + +1d day shift fields (+ optional fixed secondary clock).
  for(const f of ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd']){
    const combine = cleanTimeCombine(current[f + 'Combine']);
    const anchor2 = combine ? cleanAnchor(current[f + 'Anchor2']) : null;
    h[f + 'Combine'] = combine && anchor2 ? combine : null;
    h[f + 'Anchor2'] = anchor2;
    h[f + 'OffsetMin2'] = anchor2 && anchor2 !== 'fixed'
      ? normalizePrayerOffset(current[f + 'OffsetMin2']) : 0;
    h[f + 'AnchorHabitId2'] = anchor2 === 'habit' ? (cleanHabitId(current[f + 'AnchorHabitId2']) || null) : null;
    h[f + 'FixedMin2'] = anchor2 === 'fixed'
      ? (normalizeTimeMinutes(current[f + 'FixedMin2']) ?? 1200) : null;
    h[f + 'DayOffset'] = normalizeAnchorDayOffset(current[f + 'DayOffset']);
    h[f + 'DayOffset2'] = anchor2 && anchor2 !== 'fixed'
      ? normalizeAnchorDayOffset(current[f + 'DayOffset2']) : 0;
  }
  // Block: a 'habit' endpoint without a picked habit is incomplete.
  const habitAnchorFields = ['allowedTimeStart','allowedTimeEnd','preferredTimeStart','preferredTimeEnd'];
  if(habitAnchorFields.some(f =>
    (h[f + 'Anchor'] === 'habit' && !h[f + 'AnchorHabitId'])
    || (h[f + 'Anchor2'] === 'habit' && !h[f + 'AnchorHabitId2'])
  )){
    showToast('pick a habit for the dynamic time');
    return;
  }
  // Block: fixed secondary without a clock time.
  if(habitAnchorFields.some(f => h[f + 'Anchor2'] === 'fixed' && h[f + 'FixedMin2'] == null)){
    showToast('pick a clock time for later/earlier of');
    return;
  }
  // Block: later/earlier-of without a second anchor.
  if(habitAnchorFields.some(f => cleanTimeCombine(current[f + 'Combine']) && !h[f + 'Anchor2'])){
    showToast('pick a second time for later/earlier of');
    return;
  }
  // Block: dynamic prayer anchors need coords to resolve against. Prefer the
  // habit's own places; "anywhere" habits use the home city (or fall back to
  // a saved place / last known). Block only when neither city nor places exist.
  // Habit-anchors don't need a location (they resolve from another habit's log).
  if(habitUsesPrayerAnchors(h) && !(h.locationIds && h.locationIds.length)){
    const s = sortSettings || loadSortSettings();
    const hasCity = Number.isFinite(s.homeCityLat) && Number.isFinite(s.homeCityLng);
    const registry = normalizeLocationRegistry(s.locations);
    if(!hasCity && !registry.length){
      showToast('set your city to use prayer times');
      return;
    }
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
