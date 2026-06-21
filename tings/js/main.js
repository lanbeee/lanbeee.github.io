// Event binding and application startup.

sortSettings = loadSortSettings();

$('type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-v]');
  if(!opt)return;
  selectedType = opt.dataset.v;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o === opt));
  $('target-slider-row').style.display = selectedType === 'zero' ? 'none' : 'flex';
  $('target-help').style.display = selectedType === 'zero' ? 'none' : 'block';
  $('target-help').textContent = rhythmHelp(selectedType);
});

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
  if(load().length < 10)return;
  const nav = document.querySelector('.bottom-nav');
  const wide = paneTierActive();
  const isOpen = wide
    ? !!$('app-bar-search')?.classList.contains('is-open')
    : !!nav?.classList.contains('search-open');
  if(isOpen)closeSearch();
  else setSearchOpen(true);
});
$('bar-open-search')?.addEventListener('click',()=>{
  if(load().length < 10)return;
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
  overviewTopicFilter = 'all';
  const todayKey = todayIso();
  const autoOpen = sortSettings.autoOpenToday && hasItemsOnDay(todayKey);
  dayLogsKey = autoOpen ? todayKey : null;
  renderOverview();
  openSheet('overview-sheet');
  if(autoOpen){
    renderDayLogs(todayKey);
    openSheet('day-logs-sheet');
  }
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
  const target = selectedType === 'zero' ? null : clampRhythmValue($('ting-days').value);
  data.push({
    name:name.slice(0,60),
    type:selectedType,
    target,
    lastLog:null,
    logs:[],
    emoji:cleanMark($('ting-emoji').value),
    pinned:false,
    topics:selectedAddTopics()
  });
  if(save(data)){cancelAdd();render();openDetailSchedule(data.length - 1);}
});

$('ting-message').addEventListener('keydown',e=>{if(e.key === 'Enter')$('do-save').click();});

function clampRhythm(value){
  return clampRhythmValue(value);
}

function rhythmHelp(type){
  if(type === 'reduce')return 'Target is the gap you want before it happens again.';
  return 'Target days between entries.';
}

function setDetailTypeUi(type){
  document.querySelectorAll('#detail-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.detailType === type);
  });
  $('detail-slider-row').style.display = type === 'zero' ? 'none' : 'flex';
  $('detail-target-help').style.display = type === 'zero' ? 'none' : 'block';
  $('detail-target-help').textContent = rhythmHelp(type);
}

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
$('ting-topic-chips').addEventListener('click',e=>{
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('ting-topic-chips');
    return;
  }
  toggleTopicChip(e);
});
$('detail-topic-chips').addEventListener('click',e=>{
  if(e.target.closest('[data-topic-add]')){
    beginNewTopicInput('detail-topic-chips');
    return;
  }
  toggleTopicChip(e);
});
$('detail-weekday-chips').addEventListener('click',toggleScheduleChip);
$('detail-monthday-chips').addEventListener('click',toggleScheduleChip);
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
  h.name = current.name.slice(0,60);
  h.type = current.type;
  h.emoji = current.emoji;
  h.pinned = current.pinned;
  h.topics = normalizeTopics(current.topics);
  h.allowedWeekdays = normalizeAllowedWeekdays(current.allowedWeekdays);
  h.allowedMonthDays = normalizeAllowedMonthDays(current.allowedMonthDays);
  h.durationMinutes = current.durationMinutes;
  h.flexibilityDays = current.flexibilityDays;
  h.target = current.type === 'zero' ? null : clampRhythmValue(current.target || h.target || 7);
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
  if(hasPlannedEntryForDay(h,key)){
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
  syncSettingsControls();
  openSheet('settings-sheet');
});
$('settings-close').addEventListener('click',()=>closeSheet('settings-sheet'));
$('settings-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('settings-sheet');});
$('settings-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('settings-advanced-toggle').addEventListener('click',e=>{
  if(suppressNativeButton === e.currentTarget){
    e.preventDefault();
    return;
  }
  toggleAdvancedSettings();
});
$('sort-preset-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-preset]');
  if(!opt)return;
  applySortPreset(opt.dataset.preset);
});
$('plan-window-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-window]');
  if(!opt)return;
  updateSortSetting({planWindowDays:parseInt(opt.dataset.window,10),preset:'custom'});
  showToast('order updated');
});
$('new-build-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-new-build]');
  if(!opt)return;
  updateSortSetting({newBuildMode:opt.dataset.newBuild,preset:'custom'});
  showToast('order updated');
});
$('due-mode-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-due-mode]');
  if(!opt)return;
  updateSortSetting({dueMode:opt.dataset.dueMode,preset:'custom'});
  showToast('order updated');
});
$('build-window-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-build-window]');
  if(!opt)return;
  updateSortSetting({buildLookAheadDays:parseInt(opt.dataset.buildWindow,10),preset:'custom'});
  showToast('order updated');
});
$('limit-mode-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-limit-mode]');
  if(!opt)return;
  updateSortSetting({limitMode:opt.dataset.limitMode,preset:'custom'});
  showToast('order updated');
});
$('stop-mode-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-stop-mode]');
  if(!opt)return;
  updateSortSetting({stopMode:opt.dataset.stopMode,preset:'custom'});
  showToast('order updated');
});
$('default-type-seg').addEventListener('click',e=>{
  const opt = e.target.closest('[data-default-type]');
  if(!opt)return;
  updateSortSetting({defaultType:opt.dataset.defaultType});
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
  const control = e.target.closest('[data-setting-toggle],#settings-advanced-toggle');
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
  if(control.matches('[data-setting-toggle]'))toggleAppSettingButton(control);
  else toggleAdvancedSettings();
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
bindSettingRange('plan-weight','planWeight','%');
bindSettingRange('due-weight','dueWeight','%');
bindSettingRange('progress-weight','progressWeight','%');
bindSettingRange('trend-weight','trendWeight','%');
bindSettingRange('rhythm-weight','rhythmWeight','%');
bindSettingRange('build-weight','buildWeight','%');
bindSettingRange('limit-weight','limitWeight','%');
bindSettingRange('stop-weight','stopWeight','%');
bindSettingRange('new-weight','newWeight','%');
bindSettingRange('build-start','buildRiseAt','%');
bindSettingRange('rhythm-bias','rhythmBias','');
bindSettingRange('default-target','defaultTarget','d',{custom:false});
$('add-sort-samples').addEventListener('click',addSortSamples);
$('remove-sort-samples').addEventListener('click',removeSortSamples);
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

function hasItemsOnDay(key){
  const data = load();
  return data.some(h=>
    normalizeLogs(h.logs).some(log=>dateKey(logTime(log))===key)
  );
}

$('open-overview').addEventListener('click',()=>{
  if(!load().length)return;
  closeSearch();
  overviewMonthOffset = 0;
  overviewTopicFilter = 'all';
  overviewRangeFilter = 'recent';
  const todayKey = todayIso();
  const autoOpen = sortSettings.autoOpenToday && hasItemsOnDay(todayKey);
  dayLogsKey = autoOpen ? todayKey : null;
  renderOverview();
  openSheet('overview-sheet');
  if(autoOpen){
    renderDayLogs(todayKey);
    openSheet('day-logs-sheet');
  }
});
$('overview-close').addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('overview-sheet');});
$('overview-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('overview-prev-month').addEventListener('click',()=>{
  overviewMonthOffset -= 1;
  renderOverview();
});
$('overview-next-month').addEventListener('click',()=>{
  overviewMonthOffset += 1;
  renderOverview();
});
$('overview-topic-filter').addEventListener('click',e=>{
  const btn = e.target.closest('[data-overview-topic]');
  if(!btn)return;
  overviewTopicFilter = btn.dataset.overviewTopic || 'all';
  dayLogsKey = null;
  renderOverview();
});
$('overview-range-filter').addEventListener('click',e=>{
  const btn = e.target.closest('[data-overview-range]');
  if(!btn)return;
  overviewRangeFilter = btn.dataset.overviewRange || 'recent';
  dayLogsKey = null;
  renderOverview();
});
$('home-topic-filter').addEventListener('click',e=>{
  const btn = e.target.closest('[data-home-topic]');
  if(!btn)return;
  homeTopicFilter = btn.dataset.homeTopic || 'all';
  render();
});
bindCalendarTap($('overview-calendar'),'[data-log-day]',day=>{
  if(!day)return;
  dayLogsKey = day.dataset.logDay;
  renderOverview();
  renderDayLogs(dayLogsKey);
  openSheet('day-logs-sheet');
});
$('day-log-add').addEventListener('click',()=>{
  if(!dayLogsKey)return;
  const idx = parseInt($('day-log-ting').value,10);
  if(Number.isNaN(idx))return;
  const ts = new Date(`${dayLogsKey}T12:00:00`).getTime();
  if(!logTingAt(idx,ts))return;
  renderDayLogs(dayLogsKey);
  refreshOpenViews();
});
$('day-availability-save').addEventListener('click',saveDayAvailabilityOverride);
$('day-availability-minutes').addEventListener('keydown',e=>{if(e.key === 'Enter')saveDayAvailabilityOverride();});
$('day-availability-clear').addEventListener('click',clearDayAvailabilityOverride);
$('day-logs-list').addEventListener('click',e=>{
  const btn = e.target.closest('[data-remove-plan]');
  if(!btn)return;
  const idx = parseInt(btn.dataset.removePlan,10);
  const key = btn.dataset.planDay;
  const data = load();
  const h = data[idx];
  if(!h)return;
  const planned = normalizeLogs(h.logs).filter(log=>isPlanLog(log) && dateKey(logTime(log)) === key).map(logTime);
  if(!planned.length)return;
  planned.forEach(ts=>removeEntryAt(idx,ts,true));
  showToast('plan removed');
  refreshOpenViews();
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
$('undo-action').addEventListener('click',undoLastAction);

$('list').addEventListener('touchstart',e=>{
  if(swipeOpenCard && !e.target.closest('.swipe-actions') && !e.target.closest('.ting-card'))closeAllSwipes();
},{passive:true});

render();