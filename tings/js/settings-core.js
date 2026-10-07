// Add-habit defaults, settings controls, topic management, availability defaults, and sort lab samples.
//
// RN PORT NOTES:
//   - This file manages the settings sheet (sort presets, toggles, topics, availability, sort lab).
//   - RENDER functions become React form components.
//   - HANDLER functions become onPress/onChange callbacks that update the Zustand settings store.

// HANDLER: cancel add sheet and reset form
function cancelAdd(){
  closeSheet('add-sheet');
  applyAddDefaults();
}

let defaultProfileKind = 'habit';
let addProfileDrafts = {};
let addActiveDefaults = null;
let addSettingsReturn = false;

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
  renderTagChips('default-places-chips',[],profile.locationIds,null,null,profile.anywhereAllowed);
  renderDefaultTopicsChips();
}

function initialAddProfile(type,defaults = newItemDefaults(loadSortSettings(),type)){
  const places = normalizeLocationIds(defaults.locationIds,locationOptions());
  return {
    defaults,
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
    locationPrefs:{},
    anywhereAllowed:defaults.anywhereAllowed || !places.length
  };
}

function refreshAddProfile(previous,type){
  const baseline = initialAddProfile(type,previous.defaults);
  const fresh = initialAddProfile(type);
  for(const key of Object.keys(fresh)){
    if(key === 'defaults')continue;
    if(JSON.stringify(previous[key]) !== JSON.stringify(baseline[key]))fresh[key] = previous[key];
  }
  return fresh;
}

function readAddProfile(){
  return {
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
    locationPrefs:selectedLocationPrefs(),
    anywhereAllowed:selectedAnywhere()
  };
}

function syncAddEffortUi(){
  $('ting-auto-mark-row').hidden = $('ting-completion-mode').value !== 'minutes';
  $('ting-chunk-row').hidden = $('ting-breakable').getAttribute('aria-pressed') !== 'true';
}

function applyAddProfile(profile){
  addActiveDefaults = {...profile.defaults};
  syncRhythm('ting',profile.target);
  $('ting-due-date').value = profile.dueDate;
  $('ting-due-time').value = profile.dueTime;
  $('ting-duration').value = profile.durationMinutes;
  $('ting-min-chunk').value = profile.minChunkMinutes;
  $('ting-breakable').setAttribute('aria-pressed',String(profile.breakable));
  $('ting-completion-mode').value = profile.autoMarkMode;
  $('ting-auto-mark').value = profile.autoMarkMinutes ?? '';
  document.querySelectorAll('#ting-priority-seg .seg-opt').forEach(btn=>btn.classList.toggle('on',Number(btn.dataset.priority) === profile.priority));
  renderTagChips('ting-tag-chips',profile.topics,profile.locationIds,null,profile.locationPrefs,profile.anywhereAllowed);
  const days = profile.defaults.allowedWeekdays;
  const dayText = days.length ? days.map(day=>WEEKDAY_LABELS[day]).join(', ') : 'any day';
  const start = profile.defaults.allowedTimeStart;
  const end = profile.defaults.allowedTimeEnd;
  const timeText = start === null && end === null ? 'any time' : `${start === null ? 'start of day' : minutesToTimeInput(start)}–${end === null ? 'end of day' : minutesToTimeInput(end)}`;
  $('add-defaults-summary').textContent = `Schedule: ${dayText} · ${timeText}. Early ${profile.defaults.earlyWindowDays}d · late ${profile.defaults.delayAllowanceDays}d. Change these in defaults or in details after saving.`;
  syncAddEffortUi();
  syncAddTypeUi(selectedType);
}

function switchAddType(type){
  const previousKind = selectedType === 'task' ? 'task' : 'habit';
  const nextKind = type === 'task' ? 'task' : 'habit';
  addProfileDrafts[previousKind] = readAddProfile();
  selectedType = type;
  document.querySelectorAll('#type-seg .seg-opt').forEach(btn=>btn.classList.toggle('on',type === 'task' ? btn.dataset.v === 'task' : btn.dataset.v === 'keepup'));
  applyAddProfile(addProfileDrafts[nextKind] ? refreshAddProfile(addProfileDrafts[nextKind],type) : initialAddProfile(type));
}

// Reset only for a fresh add/cancel. Branch changes retain each in-flight draft.
function applyAddDefaults(){
  const settings = loadSortSettings();
  addProfileDrafts = {};
  addSettingsReturn = false;
  $('ting-message').value = '';
  $('ting-emoji').value = '';
  if(typeof renderEmojiBgSwatches === 'function')renderEmojiBgSwatches('ting-emoji-bg','');
  selectedType = settings.defaultType;
  document.querySelectorAll('#type-seg .seg-opt').forEach(btn=>btn.classList.toggle('on',selectedType === 'task' ? btn.dataset.v === 'task' : btn.dataset.v === 'keepup'));
  applyAddProfile(initialAddProfile(selectedType));
  if(typeof renderWeatherProfileSelect === 'function')renderWeatherProfileSelect('ting-weather-profile','');
  if(typeof renderWeatherLocationSelect === 'function')renderWeatherLocationSelect('ting-weather-location','');
  $('ting-show-weather')?.setAttribute('aria-pressed','false');
  $('ting-show-weather-location')?.setAttribute('aria-pressed','false');
  if(typeof syncWeatherHabitLocationUi === 'function')syncWeatherHabitLocationUi();
  $('add-topics-section').hidden = false;
  $('add-more-options').hidden = true;
  $('add-more-toggle').setAttribute('aria-expanded','false');
  if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
  if(typeof applyAddMinimalMode === 'function')applyAddMinimalMode();
}

function openAddSettings(section){
  // Leave the DOM draft intact, including weather, emoji and disclosure state.
  const kind = selectedType === 'task' ? 'task' : 'habit';
  addProfileDrafts[kind] = readAddProfile();
  addSettingsReturn = true;
  defaultProfileKind = kind;
  closeSheet('add-sheet');
  resetSettingsSheetState();
  syncSettingsControls();
  const body = $(section === 'defaults' ? 'settings-defaults-body' : 'settings-blocked-body');
  const head = document.querySelector(`[data-collapse-target="${body.id}"]`);
  body.hidden = false;
  head.setAttribute('aria-expanded','true');
  $('settings-close').textContent = 'back to new ' + (kind === 'task' ? 'task' : 'habit');
  openSheet('settings-sheet');
  requestAnimationFrame(()=>head.scrollIntoView({block:'start'}));
}

function closeSettingsSheet(){
  closeSheet('settings-sheet');
  if(!addSettingsReturn)return;
  addSettingsReturn = false;
  $('settings-close').textContent = 'done';
  const kind = selectedType === 'task' ? 'task' : 'habit';
  applyAddProfile(refreshAddProfile(addProfileDrafts[kind],selectedType));
  delete addProfileDrafts[kind];
  openSheet('add-sheet');
}

// HYBRID: reset the settings sheet to its fresh-open defaults — collapse
// every collapsible section and drop any staged import. Called ONLY when the
// sheet opens (or after a wholesale replace like a reset/import). It must NOT
// run on every settings mutation, otherwise editing a field that lives inside
// an open section (blocked time, topics, defaults, …) would collapse that
// section out from under the user mid-edit.
function resetSettingsSheetState(){
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
  const resetConfirm = $('settings-reset-confirm');
  if(resetConfirm)resetConfirm.hidden = true;
  updateSortSampleCount();
  renderTopicList();
  renderBlockedTimeControls();
  renderLocationControls();
  if(typeof renderWeatherControls === 'function')renderWeatherControls();
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
  const homeExtraMode = normalizeHomeExtraMode(sortSettings.homeExtraMode);
  document.querySelectorAll('#home-extra-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === homeExtraMode);
  });
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
