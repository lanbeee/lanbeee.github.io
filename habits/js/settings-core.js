// Add-habit defaults, settings controls, topic management, availability defaults, and sort lab samples.
//
// RN PORT NOTES:
//   - This file manages the settings sheet (sort presets, toggles, topics, availability, sort lab).
//   - RENDER functions become React form components.
//   - HANDLER functions become onPress/onChange callbacks that update the Zustand settings store.

let addSessionTempLocationIds = [];

// HANDLER: cancel add sheet and reset form. A batch with queued items asks
// first — Back, Escape, backdrop and cancel all share this guard.
function cancelAdd(){
  if(typeof bulkHandleCancelAdd === 'function' && bulkHandleCancelAdd())return;
  closeSheet('add-sheet');
  if(addSessionTempLocationIds.length && typeof cleanupUnusedTemporaryLocations === 'function'){
    cleanupUnusedTemporaryLocations(load(), {onlyIds:addSessionTempLocationIds, quiet:true});
  }
  addSessionTempLocationIds = [];
  applyAddDefaults();
}

function syncCardDetailControls(){
  const mode = sortSettings.cardDetailLevel;
  document.querySelectorAll('[data-card-detail]').forEach(btn=>{
    const selected = btn.dataset.cardDetail === mode;
    btn.classList.toggle('on',selected);
    btn.setAttribute('aria-pressed',String(selected));
  });
  const custom = $('card-detail-custom');
  if(custom)custom.hidden = mode !== 'custom';
  const hint = $('card-detail-hint');
  if(hint)hint.textContent = mode === 'simple'
    ? 'Key dates, reminders, and status.'
    : mode === 'detailed'
      ? 'Also show the schedule, duration, topics, and place.'
      : 'Choose the details to show below.';
}

let defaultProfileKind = 'habit';
let addActiveDefaults = null;
let addActiveBaseline = null;
let addSharedEdits = {};
let addHabitDraft = null;
let addEventDraft = null;
let addEventBaseline = null;
let addSettingsReturn = false;

const ADD_SHARED_PROFILE_KEYS = [
  'durationMinutes','priority','breakable','minChunkMinutes',
  'autoMarkMode','autoMarkMinutes','topics','locationIds','locationTypes',
  'locationPrefs','anywhereAllowed','weatherProfileValue',
  'weatherLocationId','showWeather','showWeatherAtLocation'
];
const ADD_HABIT_ONLY_KEYS = ['target','repeatMode','conditionTrigger','conditionRadiusM'];

function cloneAddValue(value){
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

function addDraftKind(){
  return addAppointmentMode ? 'event' : selectedType === 'task' ? 'task' : 'habit';
}

function currentDefaultProfile(){
  return newItemDefaults(sortSettings,defaultProfileKind === 'task' ? 'task' : 'keepup');
}

function updateDefaultProfile(patch){
  if(defaultProfileKind === 'task'){
    updateSortSetting({taskDefaults:{...currentDefaultProfile(),...patch}},{sync:false,renderNow:false});
  }else{
    const mapped = {};
    for(const [key,value] of Object.entries(patch))mapped['default' + key[0].toUpperCase() + key.slice(1)] = value;
    updateSortSetting(mapped,{sync:false,renderNow:false});
  }
  syncDefaultProfileControls();
}

function syncDefaultProfileControls(){
  const profile = currentDefaultProfile();
  document.querySelectorAll('[data-default-profile]').forEach(btn=>btn.classList.toggle('on',btn.dataset.defaultProfile === defaultProfileKind));
  $('default-rhythm-row').hidden = defaultProfileKind === 'task';
  $('default-due-row').hidden = defaultProfileKind !== 'task';
  const rhythm = rhythmParts(profile.target);
  $('setting-default-times').value = rhythm.times;
  $('setting-default-days').value = rhythm.days;
  $('setting-default-due').value = profile.dueDateMode;
  for(const [name,key,suffix] of [['duration','durationMinutes','m'],['early-window','earlyWindowDays','d'],['delay-allowance','delayAllowanceDays','d'],['min-chunk','minChunkMinutes','m']]){
    syncSettingRange('default-' + name,profile[key],suffix);
    $('setting-default-' + name + '-label').textContent = suffix === 'm' ? 'min' : 'days';
  }
  $('setting-default-completion').value = profile.autoMarkMode;
  $('setting-default-auto-mark').value = profile.autoMarkMinutes ?? '';
  $('default-auto-mark-row').hidden = profile.autoMarkMode !== 'minutes';
  $('setting-default-breakable').setAttribute('aria-pressed',String(profile.breakable));
  $('default-chunk-row').hidden = !profile.breakable;
  document.querySelectorAll('#default-priority-seg [data-default-priority]').forEach(btn=>btn.classList.toggle('on',Number(btn.dataset.defaultPriority) === profile.priority));
  $('default-weekdays').innerHTML = WEEKDAY_LABELS.map((label,day)=>`<button type="button" class="schedule-chip${profile.allowedWeekdays.includes(day) ? ' on' : ''}" data-default-day="${day}" aria-pressed="${profile.allowedWeekdays.includes(day)}">${label}</button>`).join('');
  $('setting-default-time-start').value = profile.allowedTimeStart === null ? '' : minutesToTimeInput(profile.allowedTimeStart);
  $('setting-default-time-end').value = profile.allowedTimeEnd === null ? '' : minutesToTimeInput(profile.allowedTimeEnd);
  renderTagChips('default-places-chips',[],profile.locationIds,null,null,profile.anywhereAllowed,profile.locationTypes || []);
  renderDefaultTopicsChips();
}

function initialAddProfile(type,defaults = newItemDefaults(loadSortSettings(),type)){
  const places = normalizeLocationIds(defaults.locationIds,locationOptions());
  const placeTypes = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(defaults.locationTypes) : [];
  return {
    defaults,
    repeatMode:'routine',
    conditionTrigger:'weather',
    conditionRadiusM:opportunityRadius({}),
    weatherProfileValue:'',
    weatherLocationId:'',
    showWeather:false,
    showWeatherAtLocation:false,
    target:defaults.target,
    dueDate:type === 'task' ? dateInputValue(defaultTaskDueDate(defaults)) : '',
    dueTime:'',
    priority:defaults.priority,
    durationMinutes:defaults.durationMinutes,
    breakable:defaults.breakable,
    minChunkMinutes:defaults.minChunkMinutes,
    autoMarkMode:defaults.autoMarkMode,
    autoMarkMinutes:defaults.autoMarkMinutes,
    topics:defaults.topics.slice(),
    locationIds:places,
    locationTypes:placeTypes,
    locationPrefs:{},
    anywhereAllowed:defaults.anywhereAllowed || (!places.length && !placeTypes.length)
  };
}

function captureAddDraftEdits(){
  const kind = addDraftKind();
  const current = readAddProfile();
  const baseline = addActiveBaseline || initialAddProfile(selectedType);
  if(kind === 'event'){
    if(current.durationMinutes !== baseline.durationMinutes){
      addSharedEdits.durationMinutes = current.durationMinutes;
    }
    const appt = typeof readAddAppointmentDraft === 'function' ? readAddAppointmentDraft() : null;
    if(appt){
      if(!addEventBaseline || appt.startDate !== addEventBaseline.startDate){
        addSharedEdits.date = appt.startDate;
      }
      if(!addEventBaseline || appt.startTime !== addEventBaseline.startTime){
        addSharedEdits.startTime = appt.startTime;
        if(appt.startTime && !Object.prototype.hasOwnProperty.call(addSharedEdits,'date') && appt.startDate){
          addSharedEdits.date = appt.startDate;
        }
      }
      addEventDraft = {
        repeat:appt.repeat,
        weekdays:appt.weekdays,
        weekdaysEdited:appt.weekdaysEdited,
        ordinalWeekdays:appt.ordinalWeekdays,
        until:appt.until
      };
    }
    return;
  }
  for(const key of ADD_SHARED_PROFILE_KEYS){
    if(JSON.stringify(current[key]) !== JSON.stringify(baseline[key])){
      addSharedEdits[key] = cloneAddValue(current[key]);
    }
  }
  if(kind === 'task'){
    if(current.dueDate !== baseline.dueDate){
      addSharedEdits.date = current.dueDate;
    }
    if(current.dueTime !== baseline.dueTime){
      addSharedEdits.startTime = current.dueTime;
      if(current.dueTime && !Object.prototype.hasOwnProperty.call(addSharedEdits,'date') && current.dueDate){
        addSharedEdits.date = current.dueDate;
      }
    }
  }else if(kind === 'habit'){
    addHabitDraft = addHabitDraft || {};
    for(const key of ADD_HABIT_ONLY_KEYS){
      if(JSON.stringify(current[key]) !== JSON.stringify(baseline[key])){
        addHabitDraft[key] = cloneAddValue(current[key]);
      }
    }
  }
}

function resolveAddProfile(kind,type){
  const profile = initialAddProfile(type);
  if(kind === 'event')profile.durationMinutes = 60;
  for(const key of ADD_SHARED_PROFILE_KEYS){
    if(Object.prototype.hasOwnProperty.call(addSharedEdits,key)){
      profile[key] = cloneAddValue(addSharedEdits[key]);
    }
  }
  if(kind === 'task'){
    if(Object.prototype.hasOwnProperty.call(addSharedEdits,'date')){
      profile.dueDate = addSharedEdits.date;
    }
    if(Object.prototype.hasOwnProperty.call(addSharedEdits,'startTime')){
      profile.dueTime = addSharedEdits.startTime;
      if(profile.dueTime && !profile.dueDate)profile.dueDate = todayIso();
    }
  }else if(kind === 'habit' && addHabitDraft){
    for(const key of ADD_HABIT_ONLY_KEYS){
      if(Object.prototype.hasOwnProperty.call(addHabitDraft,key)){
        profile[key] = cloneAddValue(addHabitDraft[key]);
      }
    }
  }
  return profile;
}

function applyResolvedAddProfile(kind,type){
  const profile = resolveAddProfile(kind,type);
  addActiveBaseline = cloneAddValue(profile);
  if(kind === 'event' && typeof applyAddAppointmentDraft === 'function'){
    const startDate = Object.prototype.hasOwnProperty.call(addSharedEdits,'date') && addSharedEdits.date
      ? addSharedEdits.date : todayIso();
    const startTime = Object.prototype.hasOwnProperty.call(addSharedEdits,'startTime') && addSharedEdits.startTime
      ? addSharedEdits.startTime : minutesToTimeInput(540);
    applyAddAppointmentDraft({...(addEventDraft || {}),startDate,startTime});
    addEventBaseline = {startDate,startTime};
  }
  applyAddProfile(profile);
}

function readAddProfile(){
  return {
    repeatMode:$('ting-repeat-mode').value,
    conditionTrigger:$('ting-condition-trigger').value,
    conditionRadiusM:opportunityRadius({conditionRadiusM:$('ting-condition-radius').value}),
    weatherProfileValue:$('ting-weather-profile').value,
    weatherLocationId:$('ting-weather-location').value,
    showWeather:$('ting-show-weather').getAttribute('aria-pressed') === 'true',
    showWeatherAtLocation:$('ting-show-weather-location').getAttribute('aria-pressed') === 'true',
    defaults:addActiveDefaults,
    target:targetFromRhythmParts($('ting-times').value,$('ting-days').value),
    dueDate:$('ting-due-date').value,
    dueTime:$('ting-due-time').value,
    priority:selectedAddPriority(),
    durationMinutes:clampDuration($('ting-duration').value),
    breakable:$('ting-breakable').getAttribute('aria-pressed') === 'true',
    minChunkMinutes:clampMinChunk($('ting-min-chunk').value),
    autoMarkMode:$('ting-completion-mode').value,
    autoMarkMinutes:normalizeAutoMark($('ting-auto-mark').value),
    topics:selectedAddTopics(),
    locationIds:selectedLocationIds(),
    locationTypes:typeof selectedLocationTypes === 'function' ? selectedLocationTypes() : [],
    locationPrefs:selectedLocationPrefs(),
    anywhereAllowed:selectedAnywhere()
  };
}

function syncAddEffortUi(){
  if(selectedType === 'task')syncTaskDueUi();
  $('ting-auto-mark-row').hidden = $('ting-completion-mode').value !== 'minutes';
  $('ting-chunk-row').hidden = $('ting-breakable').getAttribute('aria-pressed') !== 'true';
  const mode = $('ting-completion-mode').value;
  $('add-completion-hint').textContent = mode === 'manual' ? 'Mark it yourself when you finish.'
    : mode === 'duration' ? 'Scheduled sessions are marked done automatically when their time is up.'
    : 'Marked done automatically this many minutes after the scheduled start.';
}

function applyAddProfile(profile){
  $('ting-repeat-mode').value = profile.repeatMode || 'routine';
  $('ting-condition-trigger').value = profile.conditionTrigger || 'weather';
  $('ting-condition-radius').value = opportunityRadius(profile);
  renderWeatherProfileSelect('ting-weather-profile',profile.weatherProfileValue || '');
  renderWeatherLocationSelect('ting-weather-location',profile.weatherLocationId || '');
  $('ting-show-weather').setAttribute('aria-pressed',String(Boolean(profile.showWeather)));
  $('ting-show-weather-location').setAttribute('aria-pressed',String(Boolean(profile.showWeatherAtLocation)));
  if(typeof syncWeatherHabitLocationUi === 'function')syncWeatherHabitLocationUi();
  addActiveDefaults = {...profile.defaults};
  syncRhythm('ting',profile.target);
  $('ting-due-date').value = profile.dueDate;
  $('ting-due-time').value = profile.dueTime;
  $('ting-duration').value = profile.durationMinutes;
  $('ting-min-chunk').value = profile.minChunkMinutes;
  $('ting-breakable').setAttribute('aria-pressed',String(profile.breakable));
  $('ting-completion-mode').value = profile.autoMarkMode;
  $('ting-auto-mark').value = profile.autoMarkMinutes ?? '';
  document.querySelectorAll('#ting-priority-seg .seg-opt').forEach(btn=>{
    const selected = Number(btn.dataset.priority) === profile.priority;
    btn.classList.toggle('on',selected);
    btn.setAttribute('aria-pressed',String(selected));
  });
  renderTagChips('ting-tag-chips',profile.topics,profile.locationIds,null,profile.locationPrefs,profile.anywhereAllowed,profile.locationTypes || []);
  const days = profile.defaults.allowedWeekdays;
  const dayText = days.length ? days.map(day=>WEEKDAY_LABELS[day]).join(', ') : 'any day';
  const start = profile.defaults.allowedTimeStart;
  const end = profile.defaults.allowedTimeEnd;
  const timeText = start === null && end === null ? 'any time' : `${start === null ? 'start of day' : minutesToTimeInput(start)}–${end === null ? 'end of day' : minutesToTimeInput(end)}`;
  $('add-defaults-summary').textContent = `Schedule defaults: ${dayText} · ${timeText}. Adjust days and hours after adding, or change new item defaults below.`;
  syncAddEffortUi();
  syncAddTypeUi(selectedType);
  if(typeof refreshAddAvailability === 'function')refreshAddAvailability();
}

function switchAddType(type){
  const previousKind = addDraftKind();
  const nextKind = type === 'event' ? 'event' : type === 'task' ? 'task' : 'habit';
  if(previousKind === nextKind && (nextKind === 'event' || selectedType === type))return;
  captureAddDraftEdits();
  addAppointmentMode = nextKind === 'event';
  selectedType = addAppointmentMode ? 'keepup' : type;
  applyResolvedAddProfile(nextKind,selectedType);
}

// Reset only for a fresh add/cancel. Type switches carry user edits forward.
function applyAddDefaults(){
  // A fresh open (or completed/discard flow) always leaves batch mode.
  if(typeof exitBulkBatchMode === 'function')exitBulkBatchMode();
  resetAppointmentShortcut();
  document.querySelector('.add-content').scrollTop = 0;
  const settings = loadSortSettings();
  addSharedEdits = {};
  addHabitDraft = null;
  addEventDraft = null;
  addActiveBaseline = null;
  addEventBaseline = null;
  addSettingsReturn = false;
  $('ting-message').value = '';
  $('ting-emoji').value = '';
  if(typeof renderEmojiBgSwatches === 'function')renderEmojiBgSwatches('ting-emoji-bg','');
  selectedType = settings.defaultType;
  document.querySelectorAll('#type-seg .seg-opt').forEach(btn=>btn.classList.toggle('on',selectedType === 'task' ? btn.dataset.v === 'task' : btn.dataset.v === 'keepup'));
  applyResolvedAddProfile(selectedType === 'task' ? 'task' : 'habit',selectedType);
  if(typeof renderWeatherProfileSelect === 'function')renderWeatherProfileSelect('ting-weather-profile','');
  if(typeof renderWeatherLocationSelect === 'function')renderWeatherLocationSelect('ting-weather-location','');
  $('ting-show-weather')?.setAttribute('aria-pressed','false');
  $('ting-show-weather-location')?.setAttribute('aria-pressed','false');
  if(typeof syncWeatherHabitLocationUi === 'function')syncWeatherHabitLocationUi();
  $('add-topics-section').hidden = false;
  $('add-more-options').hidden = true;
  $('add-more-toggle').setAttribute('aria-expanded','false');
  document.querySelector('.add-weather-options').open = false;
  if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
  if(typeof applyAddMinimalMode === 'function')applyAddMinimalMode();
}

function openSettingsSheet(){
  if(typeof setSettingsSearchOpen === 'function')setSettingsSearchOpen(false,false);
  resetSettingsSheetState();
  syncSettingsControls();
  openSheet('settings-sheet');
}

function openMinimalModeSettings(){
  openSettingsSheet();
  const toggle = document.querySelector('[data-setting-toggle="minimalMode"]');
  requestAnimationFrame(()=>{
    toggle?.scrollIntoView({block:'center',inline:'nearest'});
    toggle?.classList.add('detail-search-hit');
    setTimeout(()=>toggle?.classList.remove('detail-search-hit'),2400);
    toggle?.focus({preventScroll:true});
  });
}

function openAddSettings(section){
  // Leave the DOM draft intact, including weather, emoji and disclosure state.
  const kind = addDraftKind();
  captureAddDraftEdits();
  if(section === 'busy'){
    closeSheet('add-sheet');
    openBusyManager({fromAdd:true,onClose:()=>openSheet('add-sheet')});
    return;
  }
  if(section === 'weather' && typeof openWeatherManager === 'function'){
    closeSheet('add-sheet');
    openWeatherManager({
      fromAdd:true,
      onClose:()=>{
        applyResolvedAddProfile(addDraftKind(),selectedType);
        openSheet('add-sheet');
      }
    });
    return;
  }
  addSettingsReturn = true;
  defaultProfileKind = kind === 'task' ? 'task' : 'habit';
  closeSheet('add-sheet');
  resetSettingsSheetState();
  syncSettingsControls();
  const body = $(section === 'defaults' ? 'settings-defaults-body' : section === 'weather' ? 'settings-weather-body' : 'settings-blocked-body');
  const head = document.querySelector(`[data-collapse-target="${body.id}"]`);
  body.hidden = false;
  head.setAttribute('aria-expanded','true');
  $('settings-close').setAttribute('aria-label','back to new ' + (kind === 'task' ? 'task' : kind === 'event' ? 'event' : 'habit'));
  openSheet('settings-sheet');
  requestAnimationFrame(()=>head.scrollIntoView({block:'start'}));
}

function closeSettingsSheet(){
  closeSheet('settings-sheet');
  // City setup leaves the item draft mounted. Refresh its clock previews on
  // every return path, including backdrop dismissal, without re-rendering it.
  // On desktop Details lives in a permanent pane, without .sheet-wrap.open.
  if(detailIdx != null && ($('detail-sheet')?.classList.contains('open') || getPane()?.dataset.activeSheet === 'detail-sheet')){
    document.querySelectorAll('#detail-sheet .time-endpoint.is-dynamic').forEach(endpoint=>{
      if(endpoint.closest('.habit-option-row'))refreshHabitScheduleOptionEndpoint(endpoint);
      else refreshTimeResolvedFor(endpoint);
    });
    // Editing a place or weather profile can add/remove the last condition
    // while the unsaved item fields themselves stay exactly the same.
    setDetailDirty();
  }
  if(!addSettingsReturn)return;
  addSettingsReturn = false;
  $('settings-close').setAttribute('aria-label','close settings');
  applyResolvedAddProfile(addDraftKind(),selectedType);
  openSheet('add-sheet');
}

// HYBRID: reset the settings sheet to its fresh-open defaults — collapse
// every collapsible section and drop any staged import. Called ONLY when the
// sheet opens (or after a wholesale replace like a reset/import). It must NOT
// run on every settings mutation, otherwise editing a field that lives inside
// an open section (blocked time, topics, defaults, …) would collapse that
// section out from under the user mid-edit.
function resetSettingsSheetState(){
  if(typeof setSettingsSearchOpen === 'function')setSettingsSearchOpen(false,false);
  document.querySelectorAll('#settings-sheet .settings-revealed').forEach(el=>el.classList.remove('settings-revealed'));
  document.querySelectorAll('#settings-sheet [data-settings-help-target]').forEach(button=>{
    const body = $(button.dataset.settingsHelpTarget);
    if(body)body.hidden = true;
    button.setAttribute('aria-expanded','false');
  });
  document.querySelectorAll('#settings-sheet .settings-disclosure').forEach(details=>{details.open = false;});
  pendingImportPayload = null;
  pendingCalendarEvents = null;
  const backupConfirm = $('backup-import-confirm');
  if(backupConfirm)backupConfirm.hidden = true;
  const backupStatus = $('backup-status');
  if(backupStatus)backupStatus.textContent = '';
  const clearConfirm = $('settings-clear-data-confirm');
  if(clearConfirm)clearConfirm.hidden = true;
  clearCalendarPdfPreview({keepStatus:false});
  document.querySelectorAll('.settings-collapse-head').forEach(head=>{
    const body = $(head.dataset.collapseTarget);
    if(body)body.hidden = true;
    head.setAttribute('aria-expanded','false');
  });
}

// HYBRID: sync settings UI from stored state
function syncSettingsControls(){
  sortSettings = loadSortSettings();
  syncCardDetailControls();
  const resetConfirm = $('settings-reset-confirm');
  if(resetConfirm)resetConfirm.hidden = true;
  updateSortSampleCount();
  renderTopicList();
  renderIgnoredCalendarItems();
  renderBlockedTimeControls({ includeManager: Boolean($('busy-manager-sheet')?.classList.contains('open')) });
  renderLocationControls({ includeManager: Boolean($('locations-manager-sheet')?.classList.contains('open')) });
  if(typeof renderWeatherControls === 'function')renderWeatherControls({ includeManager: Boolean($('weather-manager-sheet')?.classList.contains('open')) });
  if(typeof renderLocationAccessControl === 'function')renderLocationAccessControl();
  document.querySelectorAll('#default-type-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.defaultType === sortSettings.defaultType);
  });
  const travelMode = normalizeTravelMode(sortSettings.defaultTravelMode);
  document.querySelectorAll('#travel-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.travelMode === travelMode);
  });
  renderPrayerTimesControls();
  renderCalendarImportControls();
  const agendaTimeMode = normalizeAgendaTimeMode(sortSettings.showAgendaTimesOnCards);
  document.querySelectorAll('#agenda-time-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === agendaTimeMode);
  });
  document.querySelectorAll('[data-setting-toggle]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(Boolean(sortSettings[btn.dataset.settingToggle])));
  });
  syncDefaultProfileControls();
  document.querySelectorAll('#font-scale-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === sortSettings.fontScale);
  });
  document.querySelectorAll('#theme-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === sortSettings.themeMode);
  });
  document.querySelectorAll('#color-palette-picker [data-palette-value]').forEach(btn=>{
    btn.setAttribute('aria-pressed',String(btn.dataset.paletteValue === sortSettings.colorPalette));
  });
  const taskRetention = normalizeCompletedTaskRetentionDays(sortSettings.completedTaskRetentionDays);
  document.querySelectorAll('#completed-task-retention-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.segValue,10) === taskRetention);
  });
  const logKeep = normalizeHabitLogKeepCount(sortSettings.habitLogKeepCount);
  document.querySelectorAll('#habit-log-keep-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.segValue,10) === logKeep);
  });
  syncHomeCityStatus();
  renderDefaultTopicsChips();
  applyAppearanceSettings();
  if(typeof syncLocalAssistantControls === 'function')syncLocalAssistantControls();
}
