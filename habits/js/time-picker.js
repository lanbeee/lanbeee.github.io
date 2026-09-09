// iOS Clock-style time picker. Safari ignores <input type="time" step>,
// so iPhone/iPad get hour / 5-minute / AM-PM wheels in the keyboard slot.
// Android keeps the native stepped picker. Typed HH:mm values stay exact
// until the user confirms a wheel choice.
//
// CSS scroll-snap (especially snap-stop:always) kills iOS momentum, so
// the wheels use native overflow inertia and only seat to a row after
// the flick coasts. Hour and minute loops like Clock; AM/PM does not.
// During a flick, do not restyle rows — the CSS mask fades the drum and
// only the centered option class changes, so iOS can keep GPU scrolling.

const TIME_PICKER_ITEM_H = 44;
const TIME_PICKER_LOOP_COPIES = 5;
const TIME_PICKER_SETTLE_MS = 88;

let _timePickerInput = null;
let _timePickerOriginal = '';
let _timePickerParts = null;
let _timePickerDirty = false;
let _timePickerReady = false;
let _timePickerGuardUntil = 0;
let _timePickerOpenedMinutes = 0;
let _timePickerProgrammatic = false;
let _timePickerProgrammaticTimer = 0;
let _timePickerPaintRaf = 0;
let _timePickerDrag = null;
const _timePickerColState = new Map();

function timePickerStep(){
  const n = typeof TIME_PICKER_STEP_MINUTES === 'number' ? TIME_PICKER_STEP_MINUTES : 5;
  return Math.max(1, parseInt(n, 10) || 5);
}

function timePickerMinuteValues(step){
  const s = Math.max(1, parseInt(step, 10) || 5);
  const out = [];
  for(let m = 0; m < 60; m += s) out.push(m);
  return out;
}

function timePickerUsesCustomUi(){
  if(typeof window !== 'undefined'){
    if(window.__tingsDisableTimePicker)return false;
    if(window.__tingsForceTimePicker)return true;
  }
  if(typeof isIosDevice === 'function')return isIosDevice();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPad|iPhone|iPod/.test(ua)
    || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function timePickerUses12Hour(){
  if(typeof window !== 'undefined' && window.__tingsTimePicker12h != null){
    return Boolean(window.__tingsTimePicker12h);
  }
  try{
    const sample = new Intl.DateTimeFormat(undefined, {hour:'numeric'}).format(new Date(2020, 0, 1, 13));
    return /am|pm/i.test(sample);
  }catch(_){
    return true;
  }
}

function timePickerPeriodLabels(){
  const strip = ts => String(new Date(2020, 0, 1, ts).toLocaleTimeString(undefined, {
    hour:'numeric', hour12:true
  })).replace(/[0-9]/g, '').replace(/[:.\s]/g, '').trim();
  return {am:strip(1) || 'AM', pm:strip(13) || 'PM'};
}

function timePickerNowMinutes(){
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function timePickerSnapMinutes(value){
  const step = timePickerStep();
  const mins = timePickerMinuteValues(step);
  let n = value;
  if(n == null || !Number.isFinite(n))n = timePickerNowMinutes();
  if(typeof snapTimeMinutes === 'function')n = snapTimeMinutes(n, step);
  n = Math.max(0, Math.min(1439, n == null ? timePickerNowMinutes() : n));
  const hour = Math.floor(n / 60) % 24;
  let minute = n % 60;
  if(!mins.includes(minute)){
    minute = mins.reduce((best, cur)=>Math.abs(cur - minute) < Math.abs(best - minute) ? cur : best, mins[0]);
  }
  return hour * 60 + minute;
}

function timePickerPartsFromMinutes(total, twelveHour){
  const snapped = timePickerSnapMinutes(total);
  const hour24 = Math.floor(snapped / 60);
  const minute = snapped % 60;
  if(!twelveHour)return {hour:hour24, minute, period:null};
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {hour, minute, period};
}

function timePickerMinutesFromParts(parts, twelveHour){
  if(!parts)return 0;
  let hour = parseInt(parts.hour, 10) || 0;
  const minute = parseInt(parts.minute, 10) || 0;
  if(twelveHour){
    if(parts.period === 'am')hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  }
  return ((hour % 24) * 60) + (minute % 60);
}

function timePickerValueFromMinutes(total){
  if(typeof minutesToTimeInput === 'function')return minutesToTimeInput(total);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function timePickerHost(){
  return typeof $ === 'function' ? $('time-step-picker') : document.getElementById('time-step-picker');
}

function timePickerIsOpen(){
  return Boolean(timePickerHost()?.classList.contains('open'));
}

let _timePickerReduceMotion = null;
function timePickerReduceMotion(){
  if(_timePickerReduceMotion == null){
    _timePickerReduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return _timePickerReduceMotion;
}

function timeInputIsVisible(input){
  if(!input || input.disabled)return false;
  if(input.hidden || input.closest('[hidden]'))return false;
  return input.getClientRects().length > 0;
}

function timePickerCanClear(input){
  if(!input || input.required)return false;
  if(input.closest('#block-edit-sheet'))return false;
  if(input.hasAttribute('data-blocked-start') || input.hasAttribute('data-blocked-end'))return false;
  if(input.hasAttribute('data-blocked-start-fixed2') || input.hasAttribute('data-blocked-end-fixed2'))return false;
  return true;
}

function timePickerColState(col){
  let st = _timePickerColState.get(col);
  if(!st){
    st = {timer:0, raf:0, selected:-1, syncedIdx:-1, items:null, count:0, copies:1};
    _timePickerColState.set(col, st);
  }
  return st;
}

function timePickerBindCol(col){
  const st = timePickerColState(col);
  st.items = col.children;
  st.count = parseInt(col.dataset.count, 10) || st.items.length;
  st.copies = parseInt(col.dataset.copies, 10) || 1;
  st.selected = -1;
  st.syncedIdx = -1;
  return st;
}

function timePickerResetColState(){
  _timePickerColState.forEach(st=>{
    if(st.timer)window.clearTimeout(st.timer);
    if(st.raf)cancelAnimationFrame(st.raf);
  });
  _timePickerColState.clear();
}

function timePickerSetProgrammatic(ms){
  _timePickerProgrammatic = true;
  window.clearTimeout(_timePickerProgrammaticTimer);
  _timePickerProgrammaticTimer = window.setTimeout(()=>{ _timePickerProgrammatic = false; }, ms);
}

function timePickerApplyPreview(dispatchInput){
  if(!_timePickerInput || !_timePickerParts)return;
  const twelveHour = timePickerUses12Hour();
  const value = timePickerValueFromMinutes(timePickerMinutesFromParts(_timePickerParts, twelveHour));
  const changed = _timePickerInput.value !== value;
  if(changed)_timePickerInput.value = value;
  if(dispatchInput){
    const minutes = timePickerMinutesFromParts(_timePickerParts, twelveHour);
    if(minutes !== _timePickerOpenedMinutes)_timePickerDirty = true;
    if(changed)_timePickerInput.dispatchEvent(new Event('input', {bubbles:true}));
  }
}

function timePickerCommit(value){
  const input = _timePickerInput;
  if(!input)return;
  const next = value == null ? '' : value;
  const changed = input.value !== next || next !== _timePickerOriginal;
  input.value = next;
  if(changed || _timePickerDirty){
    input.dispatchEvent(new Event('input', {bubbles:true}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  }
}

function timePickerItemHtml(value, label, selected, hidden, index){
  const on = value === selected || String(value) === String(selected);
  return `<div class="time-step-picker-item${on ? ' is-on' : ''}" role="option" data-value="${value}" data-i="${index}" aria-selected="${on ? 'true' : 'false'}"${hidden ? ' aria-hidden="true"' : ''}>${label}</div>`;
}

function timePickerColHtml(name, values, labels, selected, aria, loop){
  const copies = loop ? TIME_PICKER_LOOP_COPIES : 1;
  const mid = Math.floor(copies / 2);
  let items = '';
  for(let copy = 0; copy < copies; copy++){
    const hidden = copy !== mid;
    for(let i = 0; i < values.length; i++){
      items += timePickerItemHtml(values[i], labels[i], copy === mid ? selected : null, hidden, copy * values.length + i);
    }
  }
  return `<div class="time-step-picker-col" data-col="${name}" data-loop="${loop ? '1' : '0'}" data-count="${values.length}" data-copies="${copies}" role="listbox" tabindex="0" aria-label="${aria}">${items}</div>`;
}

function timePickerRenderWheels(){
  const wheels = $('time-step-picker-wheels');
  if(!wheels || !_timePickerParts)return;
  timePickerResetColState();
  const twelveHour = timePickerUses12Hour();
  const step = timePickerStep();
  const minutes = timePickerMinuteValues(step);
  const minuteLabels = minutes.map(m=>String(m).padStart(2,'0'));
  let html = '';
  if(twelveHour){
    const hours = [1,2,3,4,5,6,7,8,9,10,11,12];
    html += timePickerColHtml('hour', hours, hours.map(String), _timePickerParts.hour, 'hour', true);
  }else{
    const hours = Array.from({length:24}, (_, i)=>i);
    html += timePickerColHtml('hour', hours, hours.map(h=>String(h).padStart(2,'0')), _timePickerParts.hour, 'hour', true);
  }
  html += timePickerColHtml('minute', minutes, minuteLabels, _timePickerParts.minute, 'minute', true);
  if(twelveHour){
    const labels = timePickerPeriodLabels();
    html += timePickerColHtml('period', ['am','pm'], [labels.am, labels.pm], _timePickerParts.period, 'AM or PM', false);
  }
  wheels.innerHTML = html;
  wheels.classList.toggle('is-24h', !twelveHour);
  wheels.querySelectorAll('.time-step-picker-col').forEach(timePickerBindCol);
}

function timePickerItems(col){
  const st = col && _timePickerColState.get(col);
  if(st && st.items)return st.items;
  return col ? col.children : [];
}

function timePickerCenteredIndex(col){
  const items = timePickerItems(col);
  const len = items.length;
  if(!len)return 0;
  return Math.max(0, Math.min(len - 1, Math.round(col.scrollTop / TIME_PICKER_ITEM_H)));
}

function timePickerIndexFor(col, value){
  const st = timePickerColState(col);
  const n = st.count || parseInt(col.dataset.count, 10) || timePickerItems(col).length;
  const copies = st.copies || parseInt(col.dataset.copies, 10) || 1;
  const items = timePickerItems(col);
  let local = 0;
  for(let i = 0; i < n; i++){
    if(items[i] && items[i].dataset.value === String(value)){ local = i; break; }
  }
  return Math.floor(copies / 2) * n + local;
}

function timePickerMarkCenter(col){
  const items = timePickerItems(col);
  const len = items.length;
  if(!len)return -1;
  const st = timePickerColState(col);
  const selected = Math.max(0, Math.min(len - 1, Math.round(col.scrollTop / TIME_PICKER_ITEM_H)));
  if(selected === st.selected)return selected;
  const prev = st.selected >= 0 ? items[st.selected] : null;
  if(prev){
    prev.classList.remove('is-on');
    prev.setAttribute('aria-selected', 'false');
  }
  const next = items[selected];
  if(next){
    next.classList.add('is-on');
    next.setAttribute('aria-selected', 'true');
  }
  st.selected = selected;
  return selected;
}

function timePickerQueuePaint(col){
  if(col)timePickerColState(col).paint = true;
  else{
    $('time-step-picker-wheels')?.querySelectorAll('.time-step-picker-col').forEach(c=>{
      timePickerColState(c).paint = true;
    });
  }
  if(_timePickerPaintRaf)return;
  _timePickerPaintRaf = requestAnimationFrame(()=>{
    _timePickerPaintRaf = 0;
    $('time-step-picker-wheels')?.querySelectorAll('.time-step-picker-col').forEach(c=>{
      if(!timePickerColState(c).paint)return;
      timePickerColState(c).paint = false;
      timePickerMarkCenter(c);
      timePickerSyncColSelection(c, false);
    });
  });
}

function timePickerSyncColSelection(col, dispatchInput){
  const items = timePickerItems(col);
  if(!items.length || !_timePickerParts)return;
  const st = timePickerColState(col);
  const idx = timePickerCenteredIndex(col);
  const value = items[idx] && items[idx].dataset.value;
  if(value == null)return;
  if(idx === st.syncedIdx && !dispatchInput)return;
  st.syncedIdx = idx;
  const name = col.dataset.col;
  if(name === 'hour' || name === 'minute')_timePickerParts[name] = parseInt(value, 10);
  else _timePickerParts[name] = value;
  timePickerApplyPreview(Boolean(dispatchInput) && _timePickerReady);
}

function timePickerWrapCol(col){
  if(!col || col.dataset.loop !== '1')return false;
  const st = timePickerColState(col);
  const n = st.count || parseInt(col.dataset.count, 10);
  const copies = st.copies || parseInt(col.dataset.copies, 10);
  if(!n || copies < 3)return false;
  const idx = Math.round(col.scrollTop / TIME_PICKER_ITEM_H);
  const mid = Math.floor(copies / 2);
  const copy = Math.floor(idx / n);
  if(copy === mid)return false;
  const local = ((idx % n) + n) % n;
  const next = (mid * n + local) * TIME_PICKER_ITEM_H;
  if(Math.abs(col.scrollTop - next) < 0.5)return false;
  timePickerSetProgrammatic(80);
  col.scrollTop = next;
  return true;
}

function timePickerCancelSnap(col){
  const st = _timePickerColState.get(col);
  if(!st)return;
  if(st.timer){
    window.clearTimeout(st.timer);
    st.timer = 0;
  }
  if(st.raf){
    cancelAnimationFrame(st.raf);
    st.raf = 0;
  }
}

function timePickerAnimateColTo(col, target, done){
  timePickerCancelSnap(col);
  const st = timePickerColState(col);
  const start = col.scrollTop;
  const dist = target - start;
  if(Math.abs(dist) < 0.5 || timePickerReduceMotion()){
    timePickerSetProgrammatic(80);
    col.scrollTop = target;
    timePickerMarkCenter(col);
    if(done)done();
    return;
  }
  const dur = Math.max(140, Math.min(240, 120 + Math.abs(dist) * 0.45));
  const t0 = performance.now();
  timePickerSetProgrammatic(dur + 80);
  const step = now=>{
    const t = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - t, 3);
    col.scrollTop = start + dist * ease;
    timePickerMarkCenter(col);
    if(t < 1){
      st.raf = requestAnimationFrame(step);
      return;
    }
    st.raf = 0;
    col.scrollTop = target;
    timePickerMarkCenter(col);
    if(done)done();
  };
  st.raf = requestAnimationFrame(step);
}

function timePickerSettleCol(col){
  if(!col || !_timePickerReady)return;
  const items = timePickerItems(col);
  if(!items.length)return;
  const idx = timePickerCenteredIndex(col);
  const target = idx * TIME_PICKER_ITEM_H;
  timePickerAnimateColTo(col, target, ()=>{
    timePickerWrapCol(col);
    timePickerSyncColSelection(col, true);
    timePickerMarkCenter(col);
  });
}

function timePickerClearSettleTimer(col){
  const st = _timePickerColState.get(col);
  if(!st || !st.timer)return;
  window.clearTimeout(st.timer);
  st.timer = 0;
}

function timePickerScheduleSettle(col){
  const st = timePickerColState(col);
  if(st.timer)window.clearTimeout(st.timer);
  st.timer = window.setTimeout(()=>{
    st.timer = 0;
    timePickerSettleCol(col);
  }, TIME_PICKER_SETTLE_MS);
}

function timePickerScrollCol(col, value){
  const idx = timePickerIndexFor(col, value);
  timePickerSetProgrammatic(160);
  col.scrollTop = idx * TIME_PICKER_ITEM_H;
  timePickerMarkCenter(col);
}

function timePickerSnapOpenCols(){
  const wheels = $('time-step-picker-wheels');
  if(!wheels || !_timePickerParts)return;
  wheels.querySelectorAll('.time-step-picker-col').forEach(col=>{
    timePickerScrollCol(col, _timePickerParts[col.dataset.col]);
  });
}

function timePickerRevealInput(input){
  if(!input || typeof input.scrollIntoView !== 'function')return;
  const panel = timePickerHost()?.querySelector('.time-step-picker-panel');
  const pickerH = panel ? panel.getBoundingClientRect().height : 280;
  const rect = input.getBoundingClientRect();
  const limit = window.innerHeight - pickerH - 12;
  if(rect.bottom > limit || rect.top < 8){
    input.scrollIntoView({block:'center', inline:'nearest'});
  }
}

function closeTimePicker(opts = {}){
  const host = timePickerHost();
  const input = _timePickerInput;
  const commit = opts.commit !== false;
  const clear = Boolean(opts.clear);
  timePickerResetColState();
  if(_timePickerPaintRaf){
    cancelAnimationFrame(_timePickerPaintRaf);
    _timePickerPaintRaf = 0;
  }
  if(host)host.classList.remove('open');
  document.body.classList.remove('time-step-picker-open');
  if(input)input.classList.remove('time-step-picker-target');
  if(input && clear){
    timePickerCommit('');
  }else if(input && commit){
    if(!opts.force && !_timePickerDirty){
      input.value = _timePickerOriginal;
    }else{
      timePickerApplyPreview(false);
      timePickerCommit(input.value);
    }
  }else if(input && !commit){
    input.value = _timePickerOriginal;
    if(_timePickerDirty)input.dispatchEvent(new Event('input', {bubbles:true}));
  }
  _timePickerInput = null;
  _timePickerOriginal = '';
  _timePickerParts = null;
  _timePickerDirty = false;
  _timePickerReady = false;
  _timePickerDrag = null;
}

function openTimePicker(input){
  if(!input || !timePickerUsesCustomUi())return;
  const host = timePickerHost();
  if(!host)return;
  if(_timePickerInput === input && timePickerIsOpen())return;
  if(_timePickerInput && _timePickerInput !== input)closeTimePicker({commit:true});
  const twelveHour = timePickerUses12Hour();
  const parsed = typeof timeInputToMinutes === 'function' ? timeInputToMinutes(input.value) : null;
  _timePickerInput = input;
  _timePickerOriginal = input.value || '';
  _timePickerParts = timePickerPartsFromMinutes(parsed, twelveHour);
  _timePickerOpenedMinutes = timePickerMinutesFromParts(_timePickerParts, twelveHour);
  _timePickerDirty = false;
  _timePickerReady = false;
  const clearBtn = $('time-step-picker-clear');
  if(clearBtn){
    const show = timePickerCanClear(input) && Boolean(_timePickerOriginal);
    clearBtn.hidden = !show;
  }
  timePickerRenderWheels();
  host.classList.add('open');
  document.body.classList.add('time-step-picker-open');
  input.classList.add('time-step-picker-target');
  _timePickerGuardUntil = Date.now() + 420;
  if(typeof input.blur === 'function')input.blur();
  requestAnimationFrame(()=>{
    timePickerSnapOpenCols();
    requestAnimationFrame(()=>{
      timePickerSnapOpenCols();
      _timePickerReady = true;
    });
    timePickerRevealInput(input);
  });
}

function timePickerEventInput(e){
  const el = e.target;
  if(!el || el.tagName !== 'INPUT')return null;
  if(el.type !== 'time')return null;
  if(!timeInputIsVisible(el))return null;
  return el;
}

function onTimePickerActivate(e){
  if(!timePickerUsesCustomUi())return;
  if(e.target && e.target.closest && e.target.closest('#time-step-picker .time-step-picker-panel'))return;
  const input = timePickerEventInput(e);
  if(!input)return;
  e.preventDefault();
  e.stopPropagation();
  openTimePicker(input);
}

function onTimePickerDismissTap(e){
  if(!timePickerIsOpen())return;
  const host = timePickerHost();
  const panel = host?.querySelector('.time-step-picker-panel');
  if(panel && panel.contains(e.target))return;
  if(Date.now() < _timePickerGuardUntil){
    e.preventDefault();
    return;
  }
  const x = e.clientX;
  const y = e.clientY;
  host.style.pointerEvents = 'none';
  const under = document.elementFromPoint(x, y);
  host.style.pointerEvents = '';
  const other = under && under.closest && under.closest('input[type="time"]');
  if(other && other !== _timePickerInput && timeInputIsVisible(other)){
    e.preventDefault();
    openTimePicker(other);
    return;
  }
  e.preventDefault();
  closeTimePicker({commit:true});
}

function onTimePickerWheelScroll(e){
  if(!_timePickerReady)return;
  const col = e.target.classList && e.target.classList.contains('time-step-picker-col')
    ? e.target
    : e.target.closest('.time-step-picker-col');
  if(!col)return;
  if(_timePickerDrag && _timePickerDrag.col === col)_timePickerDrag.scrolled = true;
  timePickerQueuePaint(col);
  if(_timePickerProgrammatic)return;
  if(_timePickerDrag && _timePickerDrag.col){
    timePickerClearSettleTimer(col);
    return;
  }
  timePickerScheduleSettle(col);
}

function onTimePickerScrollEnd(e){
  if(!_timePickerReady || _timePickerProgrammatic)return;
  if(_timePickerDrag && _timePickerDrag.col)return;
  const col = e.target.closest('.time-step-picker-col');
  if(!col)return;
  timePickerClearSettleTimer(col);
  timePickerSettleCol(col);
}

function onTimePickerColPointerDown(e){
  const col = e.target.closest('.time-step-picker-col');
  if(!col)return;
  timePickerCancelSnap(col);
  _timePickerProgrammatic = false;
  _timePickerDrag = {col, scrolled:false};
}

function onTimePickerColPointerUp(){
  if(!_timePickerDrag)return;
  const col = _timePickerDrag.col;
  const scrolled = _timePickerDrag.scrolled;
  _timePickerDrag = scrolled ? {scrolled:true} : null;
  if(scrolled && col)timePickerScheduleSettle(col);
}

function onTimePickerWheelClick(e){
  if(_timePickerDrag && _timePickerDrag.scrolled){
    _timePickerDrag = null;
    return;
  }
  _timePickerDrag = null;
  const item = e.target.closest('.time-step-picker-item');
  if(!item)return;
  const col = item.closest('.time-step-picker-col');
  if(!col)return;
  const idx = item.dataset.i != null ? parseInt(item.dataset.i, 10) : timePickerCenteredIndex(col);
  if(!Number.isFinite(idx) || idx < 0)return;
  const name = col.dataset.col;
  const value = item.dataset.value;
  if(!_timePickerParts)return;
  if(name === 'hour' || name === 'minute')_timePickerParts[name] = parseInt(value, 10);
  else _timePickerParts[name] = value;
  timePickerApplyPreview(true);
  timePickerAnimateColTo(col, idx * TIME_PICKER_ITEM_H, ()=>{
    timePickerWrapCol(col);
    timePickerMarkCenter(col);
  });
}

function onTimePickerKey(e){
  if(!timePickerIsOpen())return;
  if(e.key === 'Escape'){
    e.preventDefault();
    e.stopPropagation();
    closeTimePicker({commit:true});
    return;
  }
  const col = e.target.closest?.('.time-step-picker-col');
  if(!col)return;
  if(e.key !== 'ArrowUp' && e.key !== 'ArrowDown')return;
  e.preventDefault();
  const items = timePickerItems(col);
  let idx = timePickerCenteredIndex(col);
  idx += e.key === 'ArrowDown' ? 1 : -1;
  idx = Math.max(0, Math.min(items.length - 1, idx));
  timePickerAnimateColTo(col, idx * TIME_PICKER_ITEM_H, ()=>{
    timePickerWrapCol(col);
    timePickerSyncColSelection(col, true);
    timePickerMarkCenter(col);
  });
}

function bindTimePicker(){
  const host = timePickerHost();
  if(!host || host.dataset.bound)return;
  host.dataset.bound = '1';
  host.addEventListener('pointerdown', onTimePickerDismissTap);
  host.querySelector('.time-step-picker-panel')?.addEventListener('pointerdown', e=>e.stopPropagation());
  const wheels = $('time-step-picker-wheels');
  wheels?.addEventListener('scroll', onTimePickerWheelScroll, {capture:true, passive:true});
  wheels?.addEventListener('scrollend', onTimePickerScrollEnd, {capture:true, passive:true});
  wheels?.addEventListener('pointerdown', onTimePickerColPointerDown, {passive:true});
  wheels?.addEventListener('pointerup', onTimePickerColPointerUp, {passive:true});
  wheels?.addEventListener('pointercancel', onTimePickerColPointerUp, {passive:true});
  wheels?.addEventListener('click', onTimePickerWheelClick);
  $('time-step-picker-done')?.addEventListener('click', ()=>closeTimePicker({commit:true, force:true}));
  $('time-step-picker-clear')?.addEventListener('click', ()=>closeTimePicker({clear:true, commit:true}));
  document.addEventListener('keydown', onTimePickerKey, true);
  document.addEventListener('touchstart', onTimePickerActivate, {capture:true, passive:false});
  document.addEventListener('pointerdown', onTimePickerActivate, {capture:true});
  document.addEventListener('click', onTimePickerActivate, {capture:true});
  const proto = typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null;
  if(proto && typeof proto.showPicker === 'function' && !proto.__tingsTimePicker){
    const orig = proto.showPicker;
    proto.showPicker = function(){
      if(this && this.type === 'time' && timePickerUsesCustomUi() && timeInputIsVisible(this)){
        openTimePicker(this);
        return;
      }
      return orig.apply(this, arguments);
    };
    proto.__tingsTimePicker = true;
  }
}

bindTimePicker();
