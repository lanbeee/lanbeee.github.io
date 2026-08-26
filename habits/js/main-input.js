const _detailSheetInner = getSheetInner('detail-sheet');
if (_detailSheetInner) _detailSheetInner.querySelectorAll('.detail-actions button').forEach(btn=>{
  btn.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
});
bindCalendarTap($('detail-calendar'),'[data-entry-day]',day=>{
  if(!day || detailIdx === null)return;
  const h = load()[detailIdx];
  if(!h)return;
  const key = day.dataset.entryDay;
  dayLogsKey = key;
  dayLogsScopeIndex = detailIdx;
  dayLogsStep = 'item';
  dayLogsItemIndex = detailIdx;
  dayLogsMoving = false;
  renderCalendar(h);
  renderDayLogs(key);
  openSheet('day-logs-sheet');
});
// Detail strip nav: each arrow shifts the 14-day window (past 7 · next 6 at
// offset 0); "today" snaps back to the around-today window.
$('detail-prev-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailStripOffset -= 1;
  renderCalendar(load()[detailIdx]);
});
$('detail-next-month').addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailStripOffset += 1;
  renderCalendar(load()[detailIdx]);
});
$('detail-today')?.addEventListener('click',()=>{
  if(detailIdx === null)return;
  detailStripOffset = 0;
  renderCalendar(load()[detailIdx]);
});
// Strip ↔ gap-history slot toggle (calendar by default).
$('detail-viz-seg')?.addEventListener('click',e=>{
  const btn = e.target.closest('[data-detail-viz]');
  if(!btn)return;
  detailVizMode = btn.dataset.detailViz === 'gaps' ? 'gaps' : 'calendar';
  syncDetailVizMode();
});
getSheetInner('detail-sheet')?.querySelector('.detail-pager')?.addEventListener('scroll',()=>{
  requestAnimationFrame(updateDetailPagerDots);
},{passive:true});

function bindCollapseAccordion(rootSelector, exclusive){
  const root = document.querySelector(rootSelector);
  if(!root)return ()=>{};
  const heads = ()=>root.querySelectorAll('.about-collapse-head');
  function reset(){
    heads().forEach(head=>{
      const body = $(head.dataset.collapseTarget);
      if(body)body.hidden = true;
      head.setAttribute('aria-expanded','false');
    });
  }
  heads().forEach(head=>{
    head.addEventListener('click',()=>{
      const body = $(head.dataset.collapseTarget);
      if(!body)return;
      const opening = body.hidden;
      if(exclusive && opening){
        heads().forEach(other=>{
          if(other === head)return;
          const otherBody = $(other.dataset.collapseTarget);
          if(otherBody)otherBody.hidden = true;
          other.setAttribute('aria-expanded','false');
        });
      }
      body.hidden = !opening;
      head.setAttribute('aria-expanded',String(opening));
    });
  });
  return reset;
}

const resetAboutSheetState = bindCollapseAccordion('#about-sheet', true);
const resetPrivacySheetState = bindCollapseAccordion('#privacy-sheet', true);

$('open-about').addEventListener('click',()=>{
  resetAboutSheetState();
  openSheet('about-sheet');
});
$('about-close').addEventListener('click',()=>closeSheet('about-sheet'));
$('about-head-close')?.addEventListener('click',()=>closeSheet('about-sheet'));
$('about-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('about-sheet');});
$('about-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('about-head-close')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});

function openPrivacySheet(){
  resetPrivacySheetState();
  openSheet('privacy-sheet');
}
$('open-privacy')?.addEventListener('click',()=>{
  openPrivacySheet();
});
$('open-privacy-from-settings')?.addEventListener('click',()=>{
  openPrivacySheet();
});
$('privacy-close')?.addEventListener('click',()=>closeSheet('privacy-sheet'));
$('privacy-head-close')?.addEventListener('click',()=>closeSheet('privacy-sheet'));
$('privacy-sheet')?.addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('privacy-sheet');});
$('privacy-close')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('privacy-head-close')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});

// PWA install support. beforeinstallprompt can fire long before any coach
// loads, so the app captures the browser's gesture at boot and replays it on
// demand; Chrome/Edge/Android then show the native install sheet from the
// coach's Install button instead of the noisy mini-infobar. iOS Safari has no
// such event — there the coach teaches ••• → Share → Add to Home Screen,
// with a toolbar-Share hedge for iOS layouts without a ••• button.
let _tingsDeferredInstall = null;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  _tingsDeferredInstall = event;
});
window.addEventListener('appinstalled',()=>{
  _tingsDeferredInstall = null;
  syncInstallGuideVisibility();
});
function tingsInstallPromptAvailable(){return _tingsDeferredInstall !== null;}
function syncInstallGuideVisibility(){
  const btn = $('open-install-guide');
  if(!btn)return;
  const installed = typeof isStandalonePwa === 'function' && isStandalonePwa();
  btn.hidden = installed;
  btn.setAttribute('aria-hidden', installed ? 'true' : 'false');
}
window.syncInstallGuideVisibility = syncInstallGuideVisibility;
syncInstallGuideVisibility();
try{
  window.matchMedia('(display-mode: standalone)')?.addEventListener?.('change', syncInstallGuideVisibility);
}catch(_){}
async function tingsPromptInstall(){
  if(!_tingsDeferredInstall)return false;
  const deferred = _tingsDeferredInstall;
  _tingsDeferredInstall = null;
  try{
    await deferred.prompt();
    const choice = await deferred.userChoice;
    return choice?.outcome === 'accepted';
  }catch(_){return false;}
}
function tingsInstallPlatform(){
  const ua = navigator.userAgent || '';
  if(/iPad|iPhone|iPod/.test(ua))return 'ios';
  // iPadOS Safari masquerades as desktop macOS; touch points separate them.
  if(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)return 'ios';
  if(/Android/i.test(ua))return 'android';
  return 'desktop';
}

// Lazy-load both guided coaches. Existing users never download these assets
// unless they explicitly start a tour from About; a fresh empty install gets
// only the small eligibility check below on the normal app path.
const TINGS_ESSENTIALS_COACH_KEY = 'tings_coach_essentials_v2';
const TINGS_INSTALL_COACH_KEY = 'tings_coach_install_v2';
let _tingsCoachLoadPromise = null;
function coachStorageValue(key){
  try{return localStorage.getItem(key) || '';}
  catch(_){return '';}
}
function loadTingsCoach(){
  if(window.TingsCoach)return Promise.resolve(window.TingsCoach);
  if(_tingsCoachLoadPromise)return _tingsCoachLoadPromise;
  _tingsCoachLoadPromise = new Promise((resolve,reject)=>{
    let stylesheet = document.querySelector('link[data-tings-coach]');
    let stylesReady;
    if(!stylesheet){
      stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = './onboarding/coach.css?v=18';
      stylesheet.dataset.tingsCoach = '1';
      document.head.appendChild(stylesheet);
      stylesReady = new Promise(done=>{
        stylesheet.addEventListener('load',done,{once:true});
        stylesheet.addEventListener('error',done,{once:true});
      });
    }else{
      stylesReady = Promise.resolve();
    }
    let script = document.querySelector('script[data-tings-coach]');
    if(script){
      script.addEventListener('load',()=>stylesReady.then(()=>resolve(window.TingsCoach)),{once:true});
      script.addEventListener('error',reject,{once:true});
      return;
    }
    script = document.createElement('script');
    script.src = './onboarding/coach.js?v=18';
    script.defer = true;
    script.dataset.tingsCoach = '1';
    script.addEventListener('load',()=>{
      if(window.TingsCoach)stylesReady.then(()=>resolve(window.TingsCoach));
      else reject(new Error('coach unavailable'));
    },{once:true});
    script.addEventListener('error',reject,{once:true});
    document.body.appendChild(script);
  }).catch(err=>{
    _tingsCoachLoadPromise = null;
    throw err;
  });
  return _tingsCoachLoadPromise;
}
function startTingsCoach(kind = 'essentials',options = {}){
  return loadTingsCoach()
    .then(coach=>coach.start({kind,force:Boolean(options.force)}))
    .catch(()=>{ if(typeof showToast === 'function')showToast('coach could not load'); });
}
window.startTingsCoach = startTingsCoach;
$('start-essentials-coach')?.addEventListener('click',()=>{
  closeSheet('about-sheet');
  void startTingsCoach('essentials',{force:true});
});
$('start-advanced-coach')?.addEventListener('click',()=>{
  closeSheet('about-sheet');
  void startTingsCoach('advanced',{force:true});
});
$('open-install-guide')?.addEventListener('click',()=>{
  if(typeof isStandalonePwa === 'function' && isStandalonePwa()){
    if(typeof showToast === 'function')showToast('already installed — the guided start button is right below');
    return;
  }
  closeSheet('about-sheet');
  void startTingsCoach('install',{force:true});
});
$('open-sample-habits')?.addEventListener('click',()=>{
  if(typeof openSampleHabitsSheet === 'function')openSampleHabitsSheet();
});
$('open-docs')?.addEventListener('click',()=>{
  closeSheet('about-sheet');
  closeSheet('sample-habits-sheet');
  window.open('https://aretefoundry.github.io/tings/', '_blank', 'noopener');
});
$('sample-habits-close')?.addEventListener('click',()=>closeSheet('sample-habits-sheet'));
$('sample-habits-sheet')?.addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('sample-habits-sheet');});
$('sample-habits-close')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('remove-sort-samples')?.addEventListener('click',()=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded($('remove-sort-samples')))return;
  if(typeof removeSortSamples === 'function')removeSortSamples();
});
$('remove-sort-samples')?.addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('sample-habits-add')?.addEventListener('click',()=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded($('sample-habits-add')))return;
  if(typeof addSortSamples === 'function')addSortSamples({closeSheets:true});
});
$('sample-prayers-add')?.addEventListener('click',()=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded($('sample-prayers-add')))return;
  if(typeof addPrayerSamples === 'function')addPrayerSamples({closeSheets:true});
});
$('sample-habits-preview')?.addEventListener('click',e=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded(e.target))return;
  const btn = e.target.closest('[data-add-sample]');
  if(!btn || btn.disabled)return;
  if(typeof addOneSample === 'function')addOneSample(btn.getAttribute('data-add-sample'));
});
$('sample-prayers-preview')?.addEventListener('click',e=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded(e.target))return;
  const btn = e.target.closest('[data-add-sample]');
  if(!btn || btn.disabled)return;
  if(typeof addOneSample === 'function')addOneSample(btn.getAttribute('data-add-sample'));
});
$('sample-blocks-preview')?.addEventListener('click',e=>{
  if(typeof isScrollGuarded === 'function' && isScrollGuarded(e.target))return;
  const btn = e.target.closest('[data-add-sample]');
  if(!btn || btn.disabled)return;
  if(typeof addBlockSample === 'function')addBlockSample();
});
addScrollGuard(document.querySelector('.sample-habits-sheet'),'y');
$('open-settings').addEventListener('click',()=>{
  closeSheet('about-sheet');
  closeSheet('sample-habits-sheet');
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
  const mode = normalizeHomeExtraMode(opt.dataset.segValue);
  if(mode === normalizeHomeExtraMode(sortSettings && sortSettings.homeExtraMode))return;
  // This setting only changes how already-planned blocked/travel rows look.
  // Reflect the tap immediately and reuse the mounted week; rebuilding the
  // seven-day plan here made this two-button display control take seconds.
  document.querySelectorAll('#home-extra-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === mode);
  });
  updateSortSetting({homeExtraMode:mode},{sync:false,renderNow:false});
  if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
  else render();
});
$('agenda-time-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  const mode = normalizeAgendaTimeMode(opt.dataset.segValue);
  if(mode === normalizeAgendaTimeMode(sortSettings && sortSettings.showAgendaTimesOnCards))return;
  document.querySelectorAll('#agenda-time-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === mode);
  });
  updateSortSetting({showAgendaTimesOnCards:mode},{sync:false,renderNow:false});
  if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
  else render();
});
$('completed-task-retention-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  const days = normalizeCompletedTaskRetentionDays(opt.dataset.segValue);
  if(days === normalizeCompletedTaskRetentionDays(sortSettings && sortSettings.completedTaskRetentionDays))return;
  updateSortSetting({completedTaskRetentionDays:days});
});
$('habit-log-keep-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  const keep = normalizeHabitLogKeepCount(opt.dataset.segValue);
  if(keep === normalizeHabitLogKeepCount(sortSettings && sortSettings.habitLogKeepCount))return;
  updateSortSetting({habitLogKeepCount:keep});
});
$('retention-clean-now')?.addEventListener('click',()=>{
  applyRetentionCleanup({force:true});
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
  const startCombine = e.target.closest('[data-blocked-start-combine]');
  const endCombine = e.target.closest('[data-blocked-end-combine]');
  const startAnchor2 = e.target.closest('[data-blocked-start-anchor2]');
  const endAnchor2 = e.target.closest('[data-blocked-end-anchor2]');
  const startOffset2 = e.target.closest('[data-blocked-start-offset2]');
  const endOffset2 = e.target.closest('[data-blocked-end-offset2]');
  const startFixed2 = e.target.closest('[data-blocked-start-fixed2]');
  const endFixed2 = e.target.closest('[data-blocked-end-fixed2]');
  const secondaryAnchor = v => (typeof cleanBlockedAnchor2 === 'function'
    ? cleanBlockedAnchor2(v) : cleanPrayerAnchor(v));
  if(label)saveBlockedTimePatch(parseInt(label.dataset.blockedLabel,10),{label:cleanTopic(label.value) || 'blocked'});
  if(start)saveBlockedTimePatch(parseInt(start.dataset.blockedStart,10),{start:timeInputToMinutes(start.value)});
  if(end)saveBlockedTimePatch(parseInt(end.dataset.blockedEnd,10),{end:timeInputToMinutes(end.value)});
  if(loc)saveBlockedTimePatch(parseInt(loc.dataset.blockedLocation,10),{locationId:loc.value || null});
  if(startAnchor)saveBlockedTimePatch(parseInt(startAnchor.dataset.blockedStartAnchor,10),{startAnchor:cleanPrayerAnchor(startAnchor.value)});
  if(endAnchor)saveBlockedTimePatch(parseInt(endAnchor.dataset.blockedEndAnchor,10),{endAnchor:cleanPrayerAnchor(endAnchor.value)});
  if(startOffset)saveBlockedTimePatch(parseInt(startOffset.dataset.blockedStartOffset,10),{startOffsetMin:readSignedOffset(startOffset)});
  if(endOffset)saveBlockedTimePatch(parseInt(endOffset.dataset.blockedEndOffset,10),{endOffsetMin:readSignedOffset(endOffset)});
  if(startCombine){
    const v = cleanTimeCombine(startCombine.value);
    const existing = secondaryAnchor(startCombine.closest('.time-dynamic')?.querySelector('.time-anchor2')?.value);
    saveBlockedTimePatch(parseInt(startCombine.dataset.blockedStartCombine,10),{
      startCombine:v,
      startAnchor2:v ? (existing || 'sunrise') : null,
      startFixedMin2:v && existing === 'fixed' ? (timeInputToMinutes(startCombine.closest('.time-dynamic')?.querySelector('.time-fixed2')?.value) ?? 1200) : null
    });
  }
  if(endCombine){
    const v = cleanTimeCombine(endCombine.value);
    const existing = secondaryAnchor(endCombine.closest('.time-dynamic')?.querySelector('.time-anchor2')?.value);
    saveBlockedTimePatch(parseInt(endCombine.dataset.blockedEndCombine,10),{
      endCombine:v,
      endAnchor2:v ? (existing || 'sunrise') : null,
      endFixedMin2:v && existing === 'fixed' ? (timeInputToMinutes(endCombine.closest('.time-dynamic')?.querySelector('.time-fixed2')?.value) ?? 1200) : null
    });
  }
  if(startAnchor2){
    const a2 = secondaryAnchor(startAnchor2.value);
    saveBlockedTimePatch(parseInt(startAnchor2.dataset.blockedStartAnchor2,10),{
      startAnchor2:a2,
      startFixedMin2:a2 === 'fixed'
        ? (timeInputToMinutes(startAnchor2.closest('.time-expr2')?.querySelector('.time-fixed2')?.value) ?? 1200)
        : null
    });
  }
  if(endAnchor2){
    const a2 = secondaryAnchor(endAnchor2.value);
    saveBlockedTimePatch(parseInt(endAnchor2.dataset.blockedEndAnchor2,10),{
      endAnchor2:a2,
      endFixedMin2:a2 === 'fixed'
        ? (timeInputToMinutes(endAnchor2.closest('.time-expr2')?.querySelector('.time-fixed2')?.value) ?? 1200)
        : null
    });
  }
  if(startOffset2)saveBlockedTimePatch(parseInt(startOffset2.dataset.blockedStartOffset2,10),{startOffsetMin2:readSignedOffset(startOffset2)});
  if(endOffset2)saveBlockedTimePatch(parseInt(endOffset2.dataset.blockedEndOffset2,10),{endOffsetMin2:readSignedOffset(endOffset2)});
  if(startFixed2)saveBlockedTimePatch(parseInt(startFixed2.dataset.blockedStartFixed2,10),{startFixedMin2:timeInputToMinutes(startFixed2.value) ?? 1200});
  if(endFixed2)saveBlockedTimePatch(parseInt(endFixed2.dataset.blockedEndFixed2,10),{endFixedMin2:timeInputToMinutes(endFixed2.value) ?? 1200});
});
$('blocked-time-list')?.addEventListener('click',e=>{
  const remove = e.target.closest('[data-blocked-remove]');
  if(remove){
    removeBlockedTime(parseInt(remove.dataset.blockedRemove,10));
    return;
  }
  // +1d toggles on blocked-time expressions.
  const startDay = e.target.closest('[data-blocked-start-day]');
  const endDay = e.target.closest('[data-blocked-end-day]');
  const startDay2 = e.target.closest('[data-blocked-start-day2]');
  const endDay2 = e.target.closest('[data-blocked-end-day2]');
  if(startDay || endDay || startDay2 || endDay2){
    const btn = startDay || endDay || startDay2 || endDay2;
    const field = (startDay || startDay2) ? 'start' : 'end';
    const which2 = Boolean(startDay2 || endDay2);
    const dsKey = which2
      ? (field === 'start' ? 'blockedStartDay2' : 'blockedEndDay2')
      : (field === 'start' ? 'blockedStartDay' : 'blockedEndDay');
    const index = parseInt(btn.dataset[dsKey],10);
    const patchKey = field + (which2 ? 'DayOffset2' : 'DayOffset');
    const on = btn.getAttribute('aria-pressed') === 'true';
    saveBlockedTimePatch(index,{[patchKey]: on ? 0 : 1});
    return;
  }
  // Gear toggle: swap fixed ↔ prayer-anchor mode for one endpoint. Requires a
  // place on the block or a home city (normalize keeps the anchor either way;
  // resolution falls back to the city, see resolveBlockedTimeMinutes).
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
      // Leave dynamic → clear the anchor + combine; keep fixed minutes as-is.
      saveBlockedTimePatch(index,{
        [anchorKey]:null,[offsetKey]:0,
        [field + 'Combine']:null,[field + 'Anchor2']:null,[field + 'OffsetMin2']:0,
        [field + 'FixedMin2']:null,
        [field + 'DayOffset']:0,[field + 'DayOffset2']:0
      });
    }else{
      if(!block.locationId){
        const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
        if(!(Number.isFinite(s.homeCityLat) && Number.isFinite(s.homeCityLng))){
          showToast('pick a location or set your city first');
          return;
        }
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
bindSettingRange('default-duration','defaultDurationMinutes','m',{custom:false});
bindSettingRange('default-flexibility','defaultFlexibilityDays','d',{custom:false});
bindSettingRange('default-min-chunk','defaultMinChunkMinutes','m',{custom:false});
$('default-priority-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-default-priority]');
  if(!opt)return;
  updateSortSetting({defaultPriority:parseInt(opt.dataset.defaultPriority,10)});
});
$('font-scale-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  updateSortSetting({fontScale:opt.dataset.segValue});
  applyAppearanceSettings();
});
$('theme-mode-seg')?.addEventListener('click',e=>{
  const opt = e.target.closest('[data-seg-value]');
  if(!opt)return;
  updateSortSetting({themeMode:opt.dataset.segValue});
  applyAppearanceSettings();
});
$('home-city-set')?.addEventListener('click',setHomeCity);
$('home-city-input')?.addEventListener('keydown',e=>{if(e.key === 'Enter')setHomeCity();});
$('home-city-clear')?.addEventListener('click',clearHomeCity);
$('default-topics-chips')?.addEventListener('click',e=>{
  const chip = e.target.closest('[data-topic]');
  if(!chip)return;
  toggleDefaultTopic(chip.dataset.topic);
});
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
$('calendar-pdf-input')?.addEventListener('change',e=>{
  const file = e.target.files && e.target.files[0];
  handleCalendarPdfChosen(file);
});
$('calendar-pdf-import')?.addEventListener('click',confirmCalendarPdfImport);
$('calendar-pdf-cancel')?.addEventListener('click',cancelCalendarPdfImport);
$('calendar-pdf-clear')?.addEventListener('click',clearImportedCalendarMeetings);
$('calendar-pdf-preview')?.addEventListener('change',onCalendarPdfSelectChange);
$('calendar-pdf-preview')?.addEventListener('click',e=>{
  const btn = e.target.closest('[data-calendar-select-all],[data-calendar-select-none]');
  if(!btn)return;
  if(btn.hasAttribute('data-calendar-select-all'))onCalendarPdfSelectAll();
  else onCalendarPdfSelectNone();
});
$('calendar-credit-habit')?.addEventListener('change',onCalendarCreditHabitChange);
$('calendar-allday-mode')?.addEventListener('change',onCalendarAllDayModeChange);
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
  overviewListPane = 'plan';
  renderOverview();
  openSheet('overview-sheet');
});
bindOverviewScrollGuards();
$('overview-close').addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-head-close')?.addEventListener('click',()=>closeSheet('overview-sheet'));
$('overview-sheet').addEventListener('click',e=>{if(e.target === e.currentTarget)closeSheet('overview-sheet');});
$('overview-close').addEventListener('pointerdown',()=>suppressBottomNav(),{passive:true});
$('overview-prev-month').addEventListener('click',()=>{
  if(isScrollGuarded($('overview-prev-month')))return;
  if(overviewRangeFilter === 'recent')overviewRecentOffset -= (typeof OVERVIEW_RECENT_DAYS === 'number' ? OVERVIEW_RECENT_DAYS : 14);
  else overviewMonthOffset -= 1;
  renderOverview();
});
$('overview-next-month').addEventListener('click',()=>{
  if(isScrollGuarded($('overview-next-month')))return;
  if(overviewRangeFilter === 'recent')overviewRecentOffset += (typeof OVERVIEW_RECENT_DAYS === 'number' ? OVERVIEW_RECENT_DAYS : 14);
  else overviewMonthOffset += 1;
  renderOverview();
});
$('overview-today')?.addEventListener('click',()=>{
  overviewMonthOffset = 0;
  overviewRecentOffset = 0;
  dayLogsKey = null;
  renderOverview();
});
$('overview-filter')?.addEventListener('click',e=>{
  if(isScrollGuarded(e.target))return;
  if(e.target.closest('[data-open-overview-filters]')){
    openSheet('calendar-filter-sheet');
    return;
  }
  if(e.target.closest('[data-clear-overview-topic]')){
    overviewTopicFilter = 'all';
    dayLogsKey = null;
    renderOverview();
    return;
  }
  if(e.target.closest('[data-clear-overview-location]')){
    overviewLocationFilter = 'all';
    dayLogsKey = null;
    renderOverview();
    return;
  }
  const rangeBtn = e.target.closest('[data-overview-range]');
  if(rangeBtn){
    overviewRangeFilter = rangeBtn.dataset.overviewRange || 'recent';
    overviewMonthOffset = 0;
    overviewRecentOffset = 0;
    overviewListPane = 'plan';
    dayLogsKey = null;
    renderOverview();
  }
});
$('calendar-filter-groups')?.addEventListener('click',e=>{
  const topicBtn = e.target.closest('[data-overview-topic]');
  const locBtn = e.target.closest('[data-overview-location]');
  if(topicBtn)overviewTopicFilter = topicBtn.dataset.overviewTopic || 'all';
  else if(locBtn)overviewLocationFilter = locBtn.dataset.overviewLocation || 'all';
  else return;
  dayLogsKey = null;
  renderOverview();
});
const closeCalendarFilters = ()=>closeSheet('calendar-filter-sheet');
$('calendar-filter-close')?.addEventListener('click',closeCalendarFilters);
$('calendar-filter-done')?.addEventListener('click',closeCalendarFilters);
$('calendar-filter-reset')?.addEventListener('click',()=>{
  overviewTopicFilter = 'all';
  overviewLocationFilter = 'all';
  dayLogsKey = null;
  renderOverview();
});
$('calendar-filter-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeCalendarFilters();
});
$('overview-pane-filter')?.addEventListener('click',e=>{
  if(isScrollGuarded(e.target))return;
  const btn = e.target.closest('[data-overview-pane]');
  if(!btn)return;
  setOverviewListPane(btn.dataset.overviewPane || 'plan');
});
$('overview-insight')?.addEventListener('click',e=>{
  if(isScrollGuarded(e.target))return;
  const dayBtn = e.target.closest('[data-log-day]');
  if(!dayBtn)return;
  openDayLogsAfterCalendarGesture(dayBtn.dataset.logDay,{refreshOverview:true});
});
$('overview-list')?.addEventListener('click',e=>{
  if(isScrollGuarded(e.target))return;
  const itemBtn = e.target.closest('[data-open-overview-item]');
  if(itemBtn){
    const idx = parseInt(itemBtn.dataset.openOverviewItem,10);
    if(!Number.isNaN(idx))openDetail(idx);
    return;
  }
  const dayBtn = e.target.closest('[data-log-day]');
  if(!dayBtn)return;
  openDayLogsAfterCalendarGesture(dayBtn.dataset.logDay,{refreshOverview:true});
});
function applyHomeFilterChange(){
  // Filter chrome is cheap and should respond immediately even when the week
  // planner defers the full list render to its worker-backed path.
  if(typeof renderHomeTagFilter === 'function')renderHomeTagFilter(load());
  render();
}

$('home-tag-filter')?.addEventListener('click',e=>{
  if(e.target.closest('[data-open-home-filters]')){
    openSheet('home-filter-sheet');
    return;
  }
  if(e.target.closest('[data-home-presence]')){
    openPresencePicker();
    return;
  }
  if(e.target.closest('[data-clear-home-topic]')){
    homeTopicFilter = 'all';
    applyHomeFilterChange();
    return;
  }
  if(e.target.closest('[data-clear-home-location]')){
    homeLocationFilter = 'all';
    applyHomeFilterChange();
    return;
  }
});
$('home-filter-groups')?.addEventListener('click',e=>{
  const topicBtn = e.target.closest('[data-home-topic]');
  if(topicBtn){
    homeTopicFilter = topicBtn.dataset.homeTopic || 'all';
    applyHomeFilterChange();
    return;
  }
  const locBtn = e.target.closest('[data-home-location]');
  if(locBtn){
    homeLocationFilter = locBtn.dataset.homeLocation || 'all';
    applyHomeFilterChange();
  }
});
$('home-filter-reset')?.addEventListener('click',()=>{
  homeTopicFilter = 'all';
  homeLocationFilter = 'all';
  applyHomeFilterChange();
});
$('home-filter-close')?.addEventListener('click',()=>closeSheet('home-filter-sheet'));
$('home-filter-done')?.addEventListener('click',()=>closeSheet('home-filter-sheet'));
$('home-filter-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeSheet('home-filter-sheet');
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

let blockEditContext = null;
let blockEditDynamicOpen = false;
// PURE: readable recurring expression for a dynamic busy-time endpoint.
function blockedEndpointExpression(block,field){
  const anchor = cleanPrayerAnchor(block && block[field + 'Anchor']);
  if(!anchor)return '';
  const primary = prayerAnchorLabel(anchor,block[field + 'OffsetMin'],null,block[field + 'DayOffset']);
  const combine = cleanTimeCombine(block[field + 'Combine']);
  const anchor2 = typeof cleanBlockedAnchor2 === 'function'
    ? cleanBlockedAnchor2(block[field + 'Anchor2'])
    : cleanPrayerAnchor(block[field + 'Anchor2']);
  if(!combine || !anchor2)return primary;
  const secondary = anchor2 === 'fixed'
    ? fixedClockLabel(block[field + 'FixedMin2'])
    : prayerAnchorLabel(anchor2,block[field + 'OffsetMin2'],null,block[field + 'DayOffset2']);
  return `${combine === 'earlier' ? 'earlier of' : 'later of'} ${primary} · ${secondary}`;
}

// PURE: shortest clock adjustment that changes a resolved endpoint to target.
function blockClockDelta(from,to){
  let delta = Number(to) - Number(from);
  while(delta > 720)delta -= 1440;
  while(delta < -720)delta += 1440;
  return delta;
}

// PURE: retain a dynamic rule while shifting its resolved time. Combined
// expressions move together, preserving their relationship on future dates.
function shiftBlockedEndpoint(block,field,delta){
  const anchor = cleanPrayerAnchor(block && block[field + 'Anchor']);
  if(!anchor){ block[field] = ((Number(block[field]) || 0) + delta + 1440) % 1440; return; }
  block[field + 'OffsetMin'] = normalizePrayerOffset((Number(block[field + 'OffsetMin']) || 0) + delta);
  const anchor2 = typeof cleanBlockedAnchor2 === 'function'
    ? cleanBlockedAnchor2(block[field + 'Anchor2'])
    : cleanPrayerAnchor(block[field + 'Anchor2']);
  if(anchor2 === 'fixed')block[field + 'FixedMin2'] = ((Number(block[field + 'FixedMin2']) || 0) + delta + 1440) % 1440;
  else if(anchor2)block[field + 'OffsetMin2'] = normalizePrayerOffset((Number(block[field + 'OffsetMin2']) || 0) + delta);
}

// RENDER: the same complete prayer/sun rule controls used in Settings, placed
// directly in the busy-card editor so a card can own its recurring rule.
function renderBlockEditDynamicControls(){
  const host = $('block-edit-dynamic-controls');
  if(!host || !blockEditContext)return;
  const block = blockEditContext.draftBlock;
  if(!block){host.hidden = true;return;}
  host.hidden = !blockEditDynamicOpen;
  host.innerHTML = `<span class="field-label utility-field-label">recurring rule</span><div class="blocked-time-hours time-endpoints">${blockedEndpointHtml(block,blockEditContext.blockIndex,'start')}<span class="time-sep">to</span>${blockedEndpointHtml(block,blockEditContext.blockIndex,'end')}</div><p class="field-hint">Saved only when you choose update recurring. “Save this date” keeps this rule and changes just this occurrence.</p>`;
}

function saveBlockEditorRulePatch(patch){
  if(!blockEditContext)return;
  blockEditContext.draftBlock = {...blockEditContext.draftBlock,...patch};
  renderBlockEditDynamicControls();
}

function blockEditorField(target){
  const endpoint = target.closest('.blocked-endpoint');
  return endpoint ? endpoint.dataset.blockedField : '';
}

function openBlockEditSheet(row){
  if(!row)return;
  const dayKey = dateKey(row.start);
  const originalStart = Number(row.blockStartMin);
  const originalEnd = Number(row.blockEndMin);
  const signature = row.blockSignature || blockedInstanceKey(row.label,originalStart,originalEnd);
  const settings = loadSortSettings();
  const block = normalizeBlockedTimes(settings.blockedTimes)[Number(row.blockIndex)] || null;
  const overrides = normalizeBlockedTimeOverrides(settings.blockedTimeOverrides);
  const current = overrides[dayKey]?.[signature] || {start:originalStart,end:originalEnd};
  blockEditContext = {row,dayKey,signature,originalStart,originalEnd,blockIndex:Number(row.blockIndex),current,
    draftBlock:block ? {...block} : null};
  blockEditDynamicOpen = false;
  $('block-edit-title').textContent = row.label || 'busy time';
  const date = new Date(row.start).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
  const startExpr = blockedEndpointExpression(block,'start');
  const endExpr = blockedEndpointExpression(block,'end');
  const resolvedStart = formatTimeShort(((originalStart % 1440) + 1440) % 1440);
  const resolvedEnd = formatTimeShort(((originalEnd % 1440) + 1440) % 1440);
  $('block-edit-copy').textContent = startExpr || endExpr
    ? `${date} · dynamic: ${startExpr || resolvedStart} → ${endExpr || resolvedEnd} · today ${resolvedStart}–${resolvedEnd}`
    : date;
  $('block-edit-start').value = minutesToTimeInput(current.start);
  $('block-edit-end').value = minutesToTimeInput(current.end);
  const dynamicToggle = $('block-edit-dynamic-toggle');
  if(dynamicToggle){
    dynamicToggle.setAttribute('aria-expanded','false');
    dynamicToggle.textContent = 'edit dynamic rule';
  }
  renderBlockEditDynamicControls();
  // Blur the home card before the sheet mounts so closing cannot restore focus
  // there and scroll the list underneath.
  const focusedCard = document.activeElement?.closest?.('.blocked-card');
  if(focusedCard && typeof document.activeElement.blur === 'function')document.activeElement.blur();
  openSheet('block-edit-sheet');
}

$('block-edit-dynamic-toggle')?.addEventListener('click',()=>{
  if(!blockEditContext)return;
  blockEditDynamicOpen = !blockEditDynamicOpen;
  const toggle = $('block-edit-dynamic-toggle');
  if(toggle){
    toggle.setAttribute('aria-expanded',String(blockEditDynamicOpen));
    toggle.textContent = blockEditDynamicOpen ? 'hide dynamic rule' : 'edit dynamic rule';
  }
  renderBlockEditDynamicControls();
});

$('block-edit-dynamic-controls')?.addEventListener('change',e=>{
  const target = e.target;
  const field = blockEditorField(target);
  if(!field)return;
  const exact = `data-blocked-${field}`;
  const suffix = target.hasAttribute(exact) ? 'fixed' : [...target.getAttributeNames()].find(name=>name.startsWith(`${exact}-`))
    ?.slice(`${exact}-`.length);
  if(!suffix)return;
  const secondary = v => typeof cleanBlockedAnchor2 === 'function' ? cleanBlockedAnchor2(v) : cleanPrayerAnchor(v);
  if(suffix === 'anchor')saveBlockEditorRulePatch({[field + 'Anchor']:cleanPrayerAnchor(target.value)});
  if(suffix === 'offset')saveBlockEditorRulePatch({[field + 'OffsetMin']:readSignedOffset(target)});
  if(suffix === 'combine'){
    const combine = cleanTimeCombine(target.value);
    const anchor2 = secondary(target.closest('.time-dynamic')?.querySelector('.time-anchor2')?.value) || 'sunrise';
    saveBlockEditorRulePatch({[field + 'Combine']:combine,[field + 'Anchor2']:combine ? anchor2 : null});
  }
  if(suffix === 'anchor2')saveBlockEditorRulePatch({[field + 'Anchor2']:secondary(target.value)});
  if(suffix === 'offset2')saveBlockEditorRulePatch({[field + 'OffsetMin2']:readSignedOffset(target)});
  if(suffix === 'fixed2')saveBlockEditorRulePatch({[field + 'FixedMin2']:timeInputToMinutes(target.value) ?? 1200});
  if(suffix === 'fixed')saveBlockEditorRulePatch({[field]:timeInputToMinutes(target.value)});
});

$('block-edit-dynamic-controls')?.addEventListener('click',e=>{
  const target = e.target.closest('button');
  if(!target)return;
  const field = blockEditorField(target);
  if(!field)return;
  const block = blockEditContext?.draftBlock;
  if(!block)return;
  if(target.classList.contains('time-offset-sign-btn')){
    const second = Boolean(target.closest('.time-expr2'));
    const input = target.parentElement?.querySelector(second ? '.time-offset2' : '.time-offset');
    if(input)saveBlockEditorRulePatch({[field + (second ? 'OffsetMin2' : 'OffsetMin')]:-readSignedOffset(input)});
    return;
  }
  if(target.matches('.time-day-next,.time-day-next2')){
    const second = target.classList.contains('time-day-next2');
    const key = field + (second ? 'DayOffset2' : 'DayOffset');
    saveBlockEditorRulePatch({[key]:target.getAttribute('aria-pressed') === 'true' ? 0 : 1});
    return;
  }
  if(!target.classList.contains('time-mode-toggle'))return;
  const anchorKey = field + 'Anchor';
  if(block[anchorKey]){
    saveBlockEditorRulePatch({[anchorKey]:null,[field + 'OffsetMin']:0,[field + 'Combine']:null,[field + 'Anchor2']:null,[field + 'OffsetMin2']:0,[field + 'FixedMin2']:null,[field + 'DayOffset']:0,[field + 'DayOffset2']:0});
  }else{
    const settings = loadSortSettings();
    if(!block.locationId && !(Number.isFinite(settings.homeCityLat) && Number.isFinite(settings.homeCityLng))){showToast('pick a location or set your city first');return;}
    saveBlockEditorRulePatch({[anchorKey]:'fajr',[field + 'OffsetMin']:0});
  }
});

function readBlockEditTimes(){
  const start = timeInputToMinutes($('block-edit-start')?.value || '');
  const end = timeInputToMinutes($('block-edit-end')?.value || '');
  if(start === null || end === null || start === end){
    showToast('choose different start and end times');
    return null;
  }
  return {start,end};
}

function saveBlockEditInstance(){
  if(!blockEditContext)return;
  const next = readBlockEditTimes();
  if(!next)return;
  const ctx = blockEditContext;
  const settings = loadSortSettings();
  const overrides = normalizeBlockedTimeOverrides(settings.blockedTimeOverrides);
  const previousDay = {...(overrides[ctx.dayKey] || {})};
  const previousOverride = previousDay[ctx.signature] || null;
  overrides[ctx.dayKey] = {...previousDay,[ctx.signature]:next};
  const availability = normalizeAvailabilityOverrides(settings.availabilityOverrides);
  const hadAvailability = Object.prototype.hasOwnProperty.call(availability,ctx.dayKey);
  const previousAvailability = availability[ctx.dayKey];
  const oldDuration = blockDurationMinutes(ctx.current.start,ctx.current.end);
  const newDuration = blockDurationMinutes(next.start,next.end);
  availability[ctx.dayKey] = Math.max(0,effectiveAvailabilityMinutes(ctx.dayKey,settings) + oldDuration-newDuration);
  saveSortSettings({...settings,blockedTimeOverrides:overrides,availabilityOverrides:availability});
  closeSheet('block-edit-sheet');
  blockEditContext = null;
  render();
  showActionToast(`Adjusted ${ctx.row.label || 'blocked'} for this date`,{
    type:'restore-block-adjust',dayKey:ctx.dayKey,signature:ctx.signature,previousOverride,
    hadAvailability,previousAvailability,openAction:false,undoLabel:'undo'
  });
}

function saveBlockEditSeries(){
  if(!blockEditContext)return;
  const next = readBlockEditTimes();
  if(!next)return;
  const settings = loadSortSettings();
  const blocks = normalizeBlockedTimes(settings.blockedTimes);
  const index = blockEditContext.blockIndex;
  if(!Number.isInteger(index) || !blocks[index])return;
  const updated = {...(blockEditContext.draftBlock || blocks[index])};
  // For sun/prayer-based blocks, "update recurring" shifts the dynamic rule
  // by the chosen clock difference rather than destroying it into static time.
  // Fixed blocks retain the established direct replacement behaviour.
  if(cleanPrayerAnchor(updated.startAnchor) || cleanPrayerAnchor(updated.endAnchor)){
    shiftBlockedEndpoint(updated,'start',blockClockDelta(blockEditContext.originalStart,next.start));
    shiftBlockedEndpoint(updated,'end',blockClockDelta(blockEditContext.originalEnd,next.end));
  }else{
    updated.start = next.start;
    updated.end = next.end;
  }
  blocks[index] = updated;
  saveSortSettings({...settings,blockedTimes:blocks});
  closeSheet('block-edit-sheet');
  blockEditContext = null;
  if(typeof renderBlockedTimeControls === 'function')renderBlockedTimeControls();
  render();
  showToast('recurring block updated');
}

$('block-edit-instance')?.addEventListener('click',saveBlockEditInstance);
$('block-edit-series')?.addEventListener('click',saveBlockEditSeries);
$('block-edit-cancel')?.addEventListener('click',()=>{blockEditContext=null;closeSheet('block-edit-sheet');});
$('block-edit-sheet')?.addEventListener('click',e=>{if(e.target===e.currentTarget){blockEditContext=null;closeSheet('block-edit-sheet');}});
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
