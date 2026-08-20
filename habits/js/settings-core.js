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

// HYBRID: reset add-form fields and selected type
function applyAddDefaults(){
  const settings = loadSortSettings();
  $('ting-message').value = '';
  $('ting-emoji').value = '';
  if(typeof renderEmojiBgSwatches === 'function')renderEmojiBgSwatches('ting-emoji-bg','');
  selectedType = settings.defaultType || 'keepup';
  const target = clampRhythm(settings.defaultTarget || 7);
  syncRhythm('ting',target);
  const defTopics = Array.isArray(settings.defaultTopics) ? settings.defaultTopics : [];
  renderTagChips('ting-tag-chips',defTopics,[],null);
  const topicsWrap = $('add-topics-section');
  if(topicsWrap)topicsWrap.hidden = false;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o.dataset.v === selectedType));
  const dueInput = $('ting-due-date');
  const timeInput = $('ting-due-time');
  if(dueInput)dueInput.value = '';
  if(timeInput)timeInput.value = '';
  if($('ting-auto-mark'))$('ting-auto-mark').value = '';
  const defPriority = Number.isFinite(settings.defaultPriority) ? settings.defaultPriority : DEFAULT_PRIORITY;
  document.querySelectorAll('#ting-priority-seg .seg-opt').forEach(o=>o.classList.toggle('on',parseInt(o.dataset.priority,10) === defPriority));
  const moreBody = $('add-more-options');
  const moreToggle = $('add-more-toggle');
  if(moreBody)moreBody.hidden = true;
  if(moreToggle)moreToggle.setAttribute('aria-expanded','false');
  syncAddTypeUi(selectedType);
  if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
  if(typeof applyAddMinimalMode === 'function')applyAddMinimalMode();
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
  syncSettingRange('default-target',sortSettings.defaultTarget,'d');
  syncSettingRange('default-duration',sortSettings.defaultDurationMinutes,'m');
  syncSettingRange('default-flexibility',sortSettings.defaultFlexibilityDays,'d');
  syncSettingRange('default-min-chunk',sortSettings.defaultMinChunkMinutes,'m');
  const chunkRow = $('default-chunk-row');
  if(chunkRow)chunkRow.hidden = !sortSettings.defaultBreakable;
  document.querySelectorAll('#default-priority-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',parseInt(btn.dataset.defaultPriority,10) === sortSettings.defaultPriority);
  });
  document.querySelectorAll('#font-scale-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === sortSettings.fontScale);
  });
  document.querySelectorAll('#theme-mode-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.segValue === sortSettings.themeMode);
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
}

