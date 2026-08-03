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

// HANDLER: export all habits + settings as a downloadable JSON file. This is
// the only backup mechanism — everything otherwise lives only in this browser.
function exportBackupFile(){
  const backup = buildBackup();
  const json = JSON.stringify(backup,null,2);
  const blob = new Blob([json],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tings-backup-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  const status = $('backup-status');
  if(status)status.textContent = 'Backup exported.';
  if(typeof showToast === 'function')showToast('backup exported');
}

// HYBRID: read a chosen backup file, validate it, and stage it behind a
// confirmation (importing replaces everything currently on this device).
let pendingImportPayload = null;
function handleBackupFileChosen(file){
  if(!file)return;
  const status = $('backup-status');
  if(status)status.textContent = '';
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = parseBackup(reader.result);
    if(!parsed.ok){
      pendingImportPayload = null;
      if(status)status.textContent = parsed.reason;
      return;
    }
    pendingImportPayload = reader.result;
    const summary = $('backup-import-summary');
    if(summary){
      const current = load().length;
      summary.textContent = `Replace ${current} habit${current === 1 ? '' : 's'} currently on this device with ${parsed.habits.length} from this file? This cannot be undone — export a backup first if you are not sure.`;
    }
    const confirmBox = $('backup-import-confirm');
    if(confirmBox)confirmBox.hidden = false;
  };
  reader.onerror = () => {
    pendingImportPayload = null;
    if(status)status.textContent = 'Could not read that file.';
  };
  reader.readAsText(file);
}

// HANDLER: confirm the staged import and replace local data.
function confirmBackupImport(){
  if(!pendingImportPayload)return;
  const result = restoreBackup(pendingImportPayload);
  pendingImportPayload = null;
  const confirmBox = $('backup-import-confirm');
  if(confirmBox)confirmBox.hidden = true;
  const fileInput = $('backup-file-input');
  if(fileInput)fileInput.value = '';
  const status = $('backup-status');
  if(result.ok){
    syncSettingsControls();
    if(typeof render === 'function')render();
    if(status)status.textContent = `Imported ${result.count} habit${result.count === 1 ? '' : 's'}.`;
    if(typeof showToast === 'function')showToast('backup imported');
  }else if(status){
    status.textContent = result.reason;
  }
}

// HANDLER: cancel a staged import without changing anything.
function cancelBackupImport(){
  pendingImportPayload = null;
  const fileInput = $('backup-file-input');
  if(fileInput)fileInput.value = '';
  const confirmBox = $('backup-import-confirm');
  if(confirmBox)confirmBox.hidden = true;
}

// ── Calendar PDF import (temporary until OAuth providers) ──
let pendingCalendarEvents = null;
// Set of event keys the user wants imported; every parsed event is in it by
// default so "import" acts as before unless the user deselects rows.
let pendingCalendarSelection = null;

function calendarPdfSelectionKey(ev, index){
  const id = ev && ev.id;
  return (id != null && id !== '') ? `id:${id}` : `idx:${index}`;
}

function clearCalendarPdfPreview({keepStatus = true} = {}){
  pendingCalendarEvents = null;
  pendingCalendarSelection = null;
  const preview = $('calendar-pdf-preview');
  if(preview){ preview.hidden = true; preview.innerHTML = ''; }
  const actions = $('calendar-pdf-actions');
  if(actions)actions.hidden = true;
  const fileInput = $('calendar-pdf-input');
  if(fileInput)fileInput.value = '';
  if(!keepStatus){
    const status = $('calendar-pdf-status');
    if(status)status.textContent = '';
  }
}

function formatCalendarEventPreview(ev, allDayMode, index){
  const mode = typeof normalizeCalendarAllDayMode === 'function'
    ? normalizeCalendarAllDayMode(allDayMode)
    : (allDayMode === 'tasks' ? 'tasks' : 'skip');
  const allDay = Boolean(ev && ev.isAllDay);
  const start = Number(ev.start);
  const end = Number(ev.end);
  let when = '';
  if(allDay){
    when = mode === 'skip' ? 'all day · skipped' : 'all day · dated task';
  }else{
    when = (typeof scheduledWhenLabel === 'function' && Number.isFinite(start))
      ? scheduledWhenLabel(start)
      : (Number.isFinite(start) ? new Date(start).toLocaleString() : '');
    const mins = Number.isFinite(end - start) ? Math.round((end - start) / 60000) : 0;
    if(mins)when += ` · ${mins}m`;
  }
  const key = calendarPdfSelectionKey(ev, index);
  const checked = !pendingCalendarSelection || pendingCalendarSelection.has(key);
  return `<li class="calendar-pdf-row${checked ? '' : ' calendar-pdf-deselected'}">
    <label class="calendar-pdf-item">
      <input type="checkbox" data-calendar-select="${escapeHtml(key)}"${checked ? ' checked' : ''} />
      <span class="calendar-pdf-item-body"><strong>${escapeHtml(ev.subject || 'untitled')}</strong><span>${escapeHtml(when)}</span></span>
    </label>
  </li>`;
}

function currentCalendarAllDayMode(){
  return typeof normalizeCalendarAllDayMode === 'function'
    ? normalizeCalendarAllDayMode((sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {})).calendarAllDayMode)
    : 'skip';
}

function calendarPdfSelectionSummary(mode){
  if(!pendingCalendarEvents || !pendingCalendarSelection)return '';
  const selected = pendingCalendarEvents.filter((ev,i)=>pendingCalendarSelection.has(calendarPdfSelectionKey(ev,i)));
  const timed = selected.filter(e=>!e.isAllDay).length;
  const allDay = selected.length - timed;
  let s = `${selected.length} of ${pendingCalendarEvents.length} selected`;
  if(timed)s += ` · ${timed} timed`;
  if(allDay)s += ` · ${allDay} all-day (${mode === 'skip' ? 'will skip' : 'will import'})`;
  return s;
}

function refreshCalendarPdfSelectionUI(){
  const preview = $('calendar-pdf-preview');
  if(!preview || !pendingCalendarEvents || !pendingCalendarSelection)return;
  preview.querySelectorAll('li.calendar-pdf-row').forEach(li=>{
    const input = li.querySelector('input[data-calendar-select]');
    const key = input && input.dataset.calendarSelect;
    const on = !!key && pendingCalendarSelection.has(key);
    if(input)input.checked = on;
    li.classList.toggle('calendar-pdf-deselected', !on);
  });
  const hint = preview.querySelector('.calendar-pdf-summary');
  if(hint)hint.textContent = calendarPdfSelectionSummary(currentCalendarAllDayMode());
}

function onCalendarPdfSelectChange(e){
  const input = e.target;
  if(!input || !input.dataset || !input.dataset.calendarSelect)return;
  const key = input.dataset.calendarSelect;
  if(input.checked)pendingCalendarSelection.add(key);
  else pendingCalendarSelection.delete(key);
  refreshCalendarPdfSelectionUI();
}

function onCalendarPdfSelectAll(){
  if(!pendingCalendarEvents)return;
  pendingCalendarSelection = new Set(pendingCalendarEvents.map((ev,i)=>calendarPdfSelectionKey(ev,i)));
  refreshCalendarPdfSelectionUI();
}

function onCalendarPdfSelectNone(){
  if(!pendingCalendarEvents)return;
  pendingCalendarSelection = new Set();
  refreshCalendarPdfSelectionUI();
}

function escapeHtml(value){
  return String(value == null ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function renderCalendarImportControls(){
  const select = $('calendar-credit-habit');
  if(!select)return;
  const settings = sortSettings || loadSortSettings();
  const selected = settings.calendarCreditHabitId || '';
  // Keepup/reduce with a duration — not only already-breakable — so Work shows
  // up even if the breakable toggle was never flipped on.
  const habits = load().filter(h=>h && (h.type === 'keepup' || h.type === 'reduce')
    && Number(h.durationMinutes) > 0);
  const options = [`<option value="">none</option>`].concat(
    habits.map(h=>{
      const label = `${h.emoji ? `${h.emoji} ` : ''}${h.name || 'untitled'}${h.breakable ? '' : ' (can split across sessions)'}`;
      return `<option value="${escapeHtml(h.hid)}"${h.hid === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  );
  select.innerHTML = options.join('');
  const hint = $('calendar-credit-hint');
  if(hint){
    hint.textContent = habits.length
      ? 'Pick a build or limit habit (like Work). Meeting minutes count toward its daily time; overlapping meetings merge. Habits that can’t split yet are updated so they can.'
      : 'No build or limit habit with daily hours yet. Add Work (or similar) first to count meetings toward it.';
  }
  const allDaySelect = $('calendar-allday-mode');
  if(allDaySelect){
    const mode = normalizeCalendarAllDayMode(settings.calendarAllDayMode);
    allDaySelect.value = mode;
  }
  const imported = load().filter(h=>h && h.source === 'pdf').length;
  const status = $('calendar-pdf-status');
  if(status && !pendingCalendarEvents){
    status.textContent = imported
      ? `${imported} imported meeting${imported === 1 ? '' : 's'} on this device.`
      : '';
  }
  if(pendingCalendarEvents)showCalendarPdfPreview(pendingCalendarEvents);
}

function showCalendarPdfPreview(events){
  pendingCalendarEvents = events || [];
  if(!pendingCalendarSelection){
    pendingCalendarSelection = new Set(pendingCalendarEvents.map((ev,i)=>calendarPdfSelectionKey(ev,i)));
  }
  const settings = sortSettings || loadSortSettings();
  const mode = normalizeCalendarAllDayMode(settings.calendarAllDayMode);
  const preview = $('calendar-pdf-preview');
  const actions = $('calendar-pdf-actions');
  const status = $('calendar-pdf-status');
  if(preview){
    preview.hidden = false;
    preview.innerHTML = `<p class="field-hint calendar-pdf-summary">${escapeHtml(calendarPdfSelectionSummary(mode))}</p>
      <div class="calendar-pdf-toolbar">
        <button type="button" class="calendar-pdf-select-all" data-calendar-select-all>select all</button>
        <button type="button" class="calendar-pdf-select-none" data-calendar-select-none>none</button>
      </div>
      <ul class="calendar-pdf-list">${pendingCalendarEvents.map((ev,i)=>formatCalendarEventPreview(ev, mode, i)).join('')}</ul>`;
  }
  if(actions)actions.hidden = false;
  if(status)status.textContent = '';
}

async function handleCalendarPdfChosen(file){
  const status = $('calendar-pdf-status');
  if(!file){
    if(status)status.textContent = 'No file selected.';
    return;
  }
  if(status)status.textContent = 'Reading PDF…';
  try{
    const {events} = await parseCalendarPdfFile(file);
    pendingCalendarSelection = null;
    showCalendarPdfPreview(events);
    if(typeof showToast === 'function')showToast(`${events.length} event${events.length === 1 ? '' : 's'} ready`);
  }catch(err){
    clearCalendarPdfPreview({keepStatus:true});
    const msg = (err && err.message) || 'Could not read that PDF.';
    if(status)status.textContent = msg;
    if(typeof showToast === 'function')showToast(msg);
  }
}

function confirmCalendarPdfImport(){
  if(!pendingCalendarEvents || !pendingCalendarEvents.length)return;
  const selected = pendingCalendarEvents.filter((ev,i)=>{
    return !pendingCalendarSelection || pendingCalendarSelection.has(calendarPdfSelectionKey(ev,i));
  });
  if(!selected.length){
    const status = $('calendar-pdf-status');
    if(status)status.textContent = 'Select at least one meeting to import.';
    return;
  }
  const select = $('calendar-credit-habit');
  const allDaySelect = $('calendar-allday-mode');
  const creditHabitId = select && select.value ? select.value : null;
  const allDayMode = normalizeCalendarAllDayMode(allDaySelect && allDaySelect.value);
  const settings = loadSortSettings();
  saveSortSettings({
    ...settings,
    calendarCreditHabitId:creditHabitId || null,
    calendarAllDayMode:allDayMode
  });
  sortSettings = loadSortSettings();
  const result = applyCalendarImport(selected, {
    source:'pdf',
    creditHabitId,
    allDayMode
  });
  clearCalendarPdfPreview({keepStatus:true});
  if(typeof sweepAutoDoneTasks === 'function')sweepAutoDoneTasks();
  renderCalendarImportControls();
  if(typeof render === 'function')render();
  const status = $('calendar-pdf-status');
  const parts = [];
  if(result.added)parts.push(`added ${result.added}`);
  if(result.updated)parts.push(`updated ${result.updated}`);
  if(result.skippedAllDay)parts.push(`skipped ${result.skippedAllDay} all-day`);
  else if(result.skipped)parts.push(`skipped ${result.skipped}`);
  if(result.removedAllDay)parts.push(`cleared ${result.removedAllDay} all-day`);
  if(result.creditedMinutes && result.creditHabitName){
    const hrs = (result.creditedMinutes / 60);
    const hrsLabel = Number.isInteger(hrs) ? `${hrs}h` : `${hrs.toFixed(1)}h`;
    parts.push(`counted ${hrsLabel} toward ${result.creditHabitName}`);
  }
  if(status)status.textContent = parts.length ? parts.join(' · ') : 'Nothing to import.';
  if(typeof showToast === 'function')showToast(parts.length ? `imported · ${parts[0]}` : 'imported');
}

function cancelCalendarPdfImport(){
  clearCalendarPdfPreview({keepStatus:false});
  renderCalendarImportControls();
}

function clearImportedCalendarMeetings(){
  const result = clearCalendarImport('pdf');
  clearCalendarPdfPreview({keepStatus:true});
  const status = $('calendar-pdf-status');
  if(status)status.textContent = result.removed
    ? `Removed ${result.removed} imported meeting${result.removed === 1 ? '' : 's'}.`
    : 'No imported meetings to clear.';
  if(typeof showToast === 'function')showToast(result.removed ? 'imported meetings cleared' : 'nothing to clear');
  renderCalendarImportControls();
  if(typeof render === 'function')render();
}

function onCalendarCreditHabitChange(){
  const select = $('calendar-credit-habit');
  if(!select)return;
  const settings = loadSortSettings();
  saveSortSettings({...settings, calendarCreditHabitId:select.value || null});
  sortSettings = loadSortSettings();
}

function onCalendarAllDayModeChange(){
  const select = $('calendar-allday-mode');
  if(!select)return;
  const settings = loadSortSettings();
  saveSortSettings({...settings, calendarAllDayMode:normalizeCalendarAllDayMode(select.value)});
  sortSettings = loadSortSettings();
  if(pendingCalendarEvents)showCalendarPdfPreview(pendingCalendarEvents);
}

// HYBRID: remove old sort-lab sample habits now that the lab is no longer part
// of the day-to-day app surface.
function cleanupLegacySortSamples(){
  const current = load();
  if(!current.some(h=>h.sample))return false;
  return save(current.filter(h=>!h.sample));
}

// RENDER: weekday availability inputs (removed from Settings; kept no-op for
// any leftover callers / backup-compat paths that still invoke it).
function renderAvailabilityControls(){
  const wrap = $('availability-grid');
  if(!wrap)return;
  wrap.innerHTML = '';
}

// HANDLER: save edited availability day value (no-op — weekly capacity removed)
function saveAvailabilityDay(index,value){
  // Weekly availabilityMinutes is unused; per-day overrides live on the
  // calendar day sheet. Keep this stub so old callers don't throw.
}

// PURE: <option> list for a blocked-time prayer-anchor picker.
// When `allowFixed` is true (secondary B row), include a clock-time option.
function blockedAnchorOptions(selected, allowFixed = false){
  const prayer = cleanPrayerAnchor(selected) || '';
  const isFixed = allowFixed && selected === 'fixed';
  let html = '<option value="">— prayer —</option>'
    + PRAYER_ANCHORS.map(a => `<option value="${a}"${a === prayer ? ' selected' : ''}>${prayerDisplayName(a)}</option>`).join('');
  if(allowFixed){
    html += `<option value="fixed"${isFixed ? ' selected' : ''}>clock time…</option>`;
  }
  return html;
}

// PURE: live preview text for one blocked-time endpoint (resolved clock time,
// or a muted hint when the anchor can't resolve yet).
function blockedResolvedLabel(block, field){
  if(!block || !cleanPrayerAnchor(block[field + 'Anchor']))return '';
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const hasCoords = block.locationId
    || (Number.isFinite(settings.homeCityLat) && Number.isFinite(settings.homeCityLng));
  if(!hasCoords)return 'choose a place or set your city first';
  const min = typeof resolveBlockedTimeMinutes === 'function'
    ? resolveBlockedTimeMinutes(block, field, dayStart(Date.now()))
    : null;
  if(min == null)return '—';
  return formatTimeShort(((min % 1440) + 1440) % 1440);
}

// PURE: <option> list for later/earlier-of combine picker.
function blockedCombineOptions(selected){
  const sel = cleanTimeCombine(selected) || '';
  return [
    ['', 'this time only'],
    ['later', 'whichever is later'],
    ['earlier', 'whichever is earlier']
  ].map(([v, label]) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label}</option>`).join('');
}

// RENDER: one blocked-time endpoint (start or end) — fixed clock OR prayer
// anchor + offset (+ optional later/earlier-of second expression), toggled by
// the mode button. Prayer anchors on primary; secondary may also be a clock.
function blockedEndpointHtml(block, i, field){
  const anchor = cleanPrayerAnchor(block[field + 'Anchor']);
  const isDyn = Boolean(anchor);
  const fixedVal = minutesToTimeInput(block[field]);
  const offsetVal = normalizePrayerOffset(block[field + 'OffsetMin']) || '';
  const combine = cleanTimeCombine(block[field + 'Combine']);
  const anchor2 = typeof cleanBlockedAnchor2 === 'function'
    ? cleanBlockedAnchor2(block[field + 'Anchor2'])
    : cleanPrayerAnchor(block[field + 'Anchor2']);
  const isFixed2 = anchor2 === 'fixed';
  const offset2Val = normalizePrayerOffset(block[field + 'OffsetMin2']) || '';
  const fixed2Val = minutesToTimeInput(
    normalizeTimeMinutes(block[field + 'FixedMin2']) ?? 1200
  );
  const dayOn = normalizeAnchorDayOffset(block[field + 'DayOffset']) === 1;
  const day2On = normalizeAnchorDayOffset(block[field + 'DayOffset2']) === 1;
  const resolved = isDyn ? blockedResolvedLabel(block, field) : '';
  const aria = escapeHtml(block.label) + ' ' + field;
  return `<div class="time-endpoint blocked-endpoint${isDyn ? ' is-dynamic' : ''}" data-blocked-field="${field}" data-blocked-index="${i}">
    <input type="time" class="time-fixed" step="900" data-blocked-${field}="${i}" aria-label="${aria}" value="${fixedVal}"${isDyn ? ' hidden' : ''} />
    <div class="time-dynamic"${isDyn ? '' : ' hidden'}>
      <div class="time-expr">
        <select class="time-anchor mini-select" data-blocked-${field}-anchor="${i}" aria-label="${aria} anchor">${blockedAnchorOptions(anchor)}</select>
        <input type="number" class="time-offset mini-time-input" inputmode="numeric" placeholder="0" data-blocked-${field}-offset="${i}" aria-label="${aria} offset minutes" value="${Math.abs(offsetVal)}" />
        <button type="button" class="time-offset-sign-btn" tabindex="-1" data-sign="${offsetVal < 0 ? '-' : '+'}" aria-label="${offsetVal < 0 ? 'negative' : 'positive'} offset">${offsetVal < 0 ? '−' : '+'}</button>
        <span class="time-offset-unit">min</span>
        <button type="button" class="time-day-next mini-text-btn" data-blocked-${field}-day="${i}" aria-pressed="${dayOn ? 'true' : 'false'}" title="use next day's prayer" aria-label="next day">next day</button>
      </div>
      <select class="time-combine mini-select" data-blocked-${field}-combine="${i}" aria-label="${aria} combine">${blockedCombineOptions(combine)}</select>
      <div class="time-expr time-expr2"${combine ? '' : ' hidden'}>
        <select class="time-anchor2 mini-select" data-blocked-${field}-anchor2="${i}" aria-label="${aria} second anchor">${blockedAnchorOptions(anchor2, true)}</select>
        <input type="time" class="time-fixed2" step="900" data-blocked-${field}-fixed2="${i}" aria-label="${aria} clock time" value="${fixed2Val}"${isFixed2 ? '' : ' hidden'} />
        <input type="number" class="time-offset2 mini-time-input" inputmode="numeric" placeholder="0" data-blocked-${field}-offset2="${i}" aria-label="${aria} second offset minutes" value="${Math.abs(offset2Val)}"${isFixed2 ? ' hidden' : ''} />
        <button type="button" class="time-offset-sign-btn" tabindex="-1" data-sign="${offset2Val < 0 ? '-' : '+'}" aria-label="${offset2Val < 0 ? 'negative' : 'positive'} offset"${isFixed2 ? ' hidden' : ''}>${offset2Val < 0 ? '−' : '+'}</button>
        <span class="time-offset-unit"${isFixed2 ? ' hidden' : ''}>min</span>
        <button type="button" class="time-day-next2 mini-text-btn" data-blocked-${field}-day2="${i}" aria-pressed="${day2On ? 'true' : 'false'}" title="use next day's prayer" aria-label="next day"${isFixed2 ? ' hidden' : ''}>next day</button>
      </div>
      <span class="time-resolved" aria-live="polite">${escapeHtml(resolved)}</span>
    </div>
    <button type="button" class="time-mode-toggle mini-text-btn" data-blocked-${field}-mode="${i}" title="use prayer time" aria-label="use prayer time"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i></button>
  </div>`;
}

function renderBlockedTimeControls(){
  const wrap = $('blocked-time-list');
  if(!wrap)return;
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  const locs = typeof locationOptions === 'function' ? locationOptions() : [];
  wrap.innerHTML = blocks.length ? blocks.map((block,i)=>`
    <div class="blocked-time-row" data-blocked-row="${i}">
      <input type="text" data-blocked-label="${i}" aria-label="busy time name" maxlength="24" value="${escapeHtml(block.label)}" />
      <div class="blocked-time-hours time-endpoints">
        ${blockedEndpointHtml(block, i, 'start')}
        <span class="time-sep">to</span>
        ${blockedEndpointHtml(block, i, 'end')}
      </div>
      <div class="schedule-chip-row compact-days">
        ${WEEKDAY_LABELS.map((label,day)=>{
          const on = !block.days.length || block.days.includes(day);
          return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-blocked-day="${day}" data-blocked-index="${i}" aria-pressed="${on}">${label}</button>`;
        }).join('')}
      </div>
      <div class="compact-days" style="margin-top:6px;align-items:center;gap:6px;">
        <select data-blocked-location="${i}" aria-label="${escapeHtml(block.label)} place" class="mini-select">
          <option value="">any place</option>
          ${locs.map(loc=>`<option value="${escapeHtml(loc.id)}"${block.locationId === loc.id ? ' selected' : ''}>${escapeHtml(loc.label || loc.name)}</option>`).join('')}
        </select>
      </div>
      <button class="mini-text-btn" type="button" data-blocked-remove="${i}">remove</button>
    </div>
  `).join('') : '<p class="field-hint">No busy times. The list can use any open time today.</p>';
}

function saveBlockedTimePatch(index,patch){
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  if(!blocks[index])return;
  blocks[index] = {...blocks[index],...patch};
  updateSortSetting({blockedTimes:blocks},{renderNow:false});
  renderBlockedTimeControls();
  render();
}

function addBlockedTime(){
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  blocks.push({label:'busy',days:[],start:900,end:960});
  updateSortSetting({blockedTimes:blocks},{renderNow:false});
  renderBlockedTimeControls();
  render();
}

function removeBlockedTime(index){
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  blocks.splice(index,1);
  updateSortSetting({blockedTimes:blocks},{renderNow:false});
  renderBlockedTimeControls();
  render();
}

// ─────────────────────────────────────────────────────────────────────────
// LOCATIONS — registry CRUD + per-location hours editor (settings sheet).
// Mirrors the blocked-time controls: an inline list of richly-structured
// rows, each editable in place, persisted through updateSortSetting.
// ─────────────────────────────────────────────────────────────────────────

// Tracks which location rows have their "per-day / best time" expander open, so
// the state survives the list re-render that follows each patch.
const expandedLocationMores = new Set();
// Tracks locations where "24h" was just unchecked but a full custom window
// hasn't been committed yet, so a patch elsewhere on the sheet (this row or
// another) doesn't silently flip the checkbox back on and hide the inputs
// out from under the user mid-edit.
const pendingLocationHoursEdit = new Set();
// Stash of the last geocode results so the tap handler can resolve a pick.
let pendingLocationResults = [];

// HANDLER: mark/unmark a location row as mid-edit on its open-hours window.
function markLocationHoursEditing(index){
  pendingLocationHoursEdit.add(index);
}
function clearLocationHoursEditing(index){
  pendingLocationHoursEdit.delete(index);
}

// PURE: keep a Set of row indices aligned with the locations array after a
// removal — drops the removed index and shifts every later index down by
// one. Shared by every per-row transient UI state (expanders, mid-edit
// flags) so none of them can point at the wrong row after a delete.
function reindexSetAfterRemoval(set,removedIndex){
  const shifted = [...set].filter(i=>i !== removedIndex).map(i=>i > removedIndex ? i - 1 : i);
  set.clear();
  shifted.forEach(i=>set.add(i));
}

// PURE: 4-decimal coordinate for compact display.
function formatCoord(v){ return Number(v).toFixed(4); }

// PURE: compact one-line hours summary ("11a–5p · closed sun" / "24h").
function locationHoursSummary(loc){
  if(!loc || !hasLocationHours(loc))return '24h';
  const parts = [];
  if(Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd)){
    parts.push(`${formatTimeShort(loc.allowedTimeStart)}–${formatTimeShort(loc.allowedTimeEnd)}`);
  }
  if(Array.isArray(loc.closedDays) && loc.closedDays.length){
    parts.push('closed ' + loc.closedDays.map(weekdayShort).join('/'));
  }
  return parts.join(' · ') || '24h';
}

// RENDER: the full location registry list.
function renderLocationControls(){
  const wrap = $('location-list');
  if(!wrap)return;
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const empty = $('location-empty-hint');
  if(empty)empty.hidden = locations.length > 0;
  wrap.innerHTML = locations.map((loc,i)=>locationRowMarkup(loc,i)).join('');
  // Restore "more" expansion across re-renders.
  expandedLocationMores.forEach(i=>{
    const body = wrap.querySelector(`[data-location-more="${i}"]`);
    if(body)body.hidden = false;
  });
}

// RENDER: rebuild ONE location row in place. Used after every field-level
// patch so editing location B can never disturb whatever the user is
// mid-typing into location A (or into a different field on this same row —
// expandedLocationMores / pendingLocationHoursEdit are consulted by
// locationRowMarkup so that state survives the rebuild). Falls back to a
// full-list render if the row isn't there yet, which should not normally
// happen since add/remove already re-render the whole list themselves.
function rerenderLocationRow(index){
  const wrap = $('location-list');
  const row = wrap && wrap.querySelector(`[data-location-row="${index}"]`);
  const loc = normalizeLocationRegistry(sortSettings.locations)[index];
  if(!wrap || !row || !loc){ renderLocationControls(); return; }
  row.outerHTML = locationRowMarkup(loc,index);
}

// RENDER: one location row — name, pin, hours, radius always visible;
// closed days + preferred/per-day hours live behind More.
function locationRowMarkup(loc,i){
  // hoursSaved: is there an actual saved window? Controls the values shown.
  // hoursOpenUI: should the fields render enabled / checkbox unchecked? Also
  // true while the user has unchecked "All day" but not yet committed a window,
  // so a patch elsewhere on the sheet can't silently re-collapse this row.
  const hoursSaved = Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd);
  const hoursOpenUI = hoursSaved || pendingLocationHoursEdit.has(i);
  const startVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeStart) : '';
  const endVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeEnd) : '';
  const closedSet = new Set(Array.isArray(loc.closedDays) ? loc.closedDays : []);
  const prefSet = Number.isFinite(loc.preferredTimeStart) && Number.isFinite(loc.preferredTimeEnd);
  const prefStart = prefSet ? minutesToTimeInput(loc.preferredTimeStart) : '';
  const prefEnd = prefSet ? minutesToTimeInput(loc.preferredTimeEnd) : '';
  const moreOpen = expandedLocationMores.has(i);
  const radius = Number.isFinite(loc.radiusM) ? Math.round(loc.radiusM) : DEFAULT_LOCATION_RADIUS_M;
  const closedCount = closedSet.size;
  const moreSummary = [
    closedCount ? `closed ${closedCount}d` : null,
    prefSet ? 'preferred time' : null
  ].filter(Boolean).join(' · ');
  return `<div class="location-row" data-location-row="${i}">
    <div class="location-row-head">
      <input type="text" class="location-name" data-loc-name="${i}" aria-label="place name" maxlength="48" value="${escapeHtml(loc.name)}" />
      <button class="mini-text-btn" type="button" data-loc-remove="${i}" aria-label="remove ${escapeHtml(loc.name)}">remove</button>
    </div>
    <div class="location-meta">
      <input type="text" class="location-address" data-loc-address="${i}" aria-label="address" maxlength="120" value="${escapeHtml(loc.address)}" placeholder="address (optional)" />
      <button class="mini-text-btn location-pin-btn" type="button" data-loc-edit-pin="${i}" title="edit pin on map">
        <i class="ti ti-map-pin" aria-hidden="true"></i> pin
      </button>
    </div>
    <div class="location-hours">
      <span class="loc-field-label">hours</span>
      <input type="time" step="900" data-loc-start="${i}" aria-label="open from" value="${startVal}" ${hoursOpenUI ? '' : 'disabled'} />
      <span class="loc-sep">–</span>
      <input type="time" step="900" data-loc-end="${i}" aria-label="open until" value="${endVal}" ${hoursOpenUI ? '' : 'disabled'} />
      <button type="button" class="loc-allday ${hoursOpenUI ? '' : 'on'}" data-loc-allday="${i}" aria-pressed="${hoursOpenUI ? 'false' : 'true'}">All day</button>
    </div>
    <div class="location-radius">
      <span class="loc-field-label">nearby</span>
      <input type="number" data-loc-radius="${i}" aria-label="how close in metres" min="10" max="2000" step="5" inputmode="numeric" value="${radius}" />
      <span class="loc-unit">m</span>
      <span class="loc-hint">how close means you’re here</span>
    </div>
    <button class="mini-text-btn loc-more-toggle" type="button" data-loc-more="${i}" aria-expanded="${moreOpen}">${moreOpen ? '▾' : '▸'} more options${moreSummary ? ` · ${moreSummary}` : ''}</button>
    <div class="location-more" data-location-more="${i}" ${moreOpen ? '' : 'hidden'}>
      <div class="location-days">
        <span class="loc-field-label">closed</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const on = closedSet.has(day);
          return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-loc-closed-day="${day}" data-loc-index="${i}" aria-pressed="${on}">${label}</button>`;
        }).join('')}
      </div>
      <div class="loc-pref">
        <span class="loc-field-label">prefer</span>
        <input type="time" step="900" data-loc-pref-start="${i}" aria-label="prefer from" value="${prefStart}" />
        <span class="loc-sep">–</span>
        <input type="time" step="900" data-loc-pref-end="${i}" aria-label="prefer until" value="${prefEnd}" />
        <button class="mini-text-btn" type="button" data-loc-pref-clear="${i}">clear</button>
      </div>
      <div class="loc-perday">
        <span class="loc-field-label">by day</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const hd = loc.hoursByDay && loc.hoursByDay[day];
          const isClosed = hd === null;
          const ds = hd && Number.isFinite(hd.start) ? minutesToTimeInput(hd.start) : '';
          const de = hd && Number.isFinite(hd.end) ? minutesToTimeInput(hd.end) : '';
          return `<div class="perday-row">
            <span class="perday-label">${label}</span>
            <input type="time" step="900" data-loc-day-start="${day}" data-loc-day-idx="${i}" value="${ds}" ${isClosed ? 'disabled' : ''} />
            <span class="loc-sep">–</span>
            <input type="time" step="900" data-loc-day-end="${day}" data-loc-day-idx="${i}" value="${de}" ${isClosed ? 'disabled' : ''} />
            <label class="perday-closed"><input type="checkbox" data-loc-day-closed="${day}" data-loc-day-idx="${i}" ${isClosed ? 'checked' : ''} /> closed</label>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

// HYBRID: patch one location and persist. Re-renders only that row — sibling
// rows (and any mid-edit state on this one, like an unchecked-but-uncommitted
// "24h" box) are left completely alone.
function saveLocationPatch(index,patch){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(!locations[index])return;
  locations[index] = {...locations[index],...patch};
  updateSortSetting({locations},{renderNow:false});
  rerenderLocationRow(index);
  render();
}

// HYBRID: add a location to the registry (called by the geocode pick, GPS, or a
// manual entry). Generates a stable opaque id. Enforces MAX_LOCATIONS.
// Returns the new id on success, or null on failure (so callers — e.g. the
// detail-pane "+ new place" flow — can auto-select the freshly created place).
// When no home city is set yet, infers one from the new place's coordinates.
function addLocation({name,address,lat,lng,emoji}){
  const cleanName = String(name || '').trim().slice(0,48);
  if(!cleanName){ showToast('enter a name'); return null; }
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){ showToast('missing coordinates'); return null; }
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(locations.length >= MAX_LOCATIONS){ showToast(`limit ${MAX_LOCATIONS} locations`); return null; }
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  locations.push({
    id, name:cleanName,
    address:String(address || '').trim().slice(0,120),
    lat, lng,
    emoji:String(emoji || '').slice(0,4),
    radiusM:DEFAULT_LOCATION_RADIUS_M
  });
  updateSortSetting({locations},{renderNow:false});
  renderLocationControls();
  render();
  showToast(`added ${cleanName}`);
  if(typeof maybeInferHomeCityFromPlace === 'function')maybeInferHomeCityFromPlace(lat,lng);
  return id;
}

// PURE: habits that still reference a place id (locationIds / preferred / prefs).
function habitsUsingLocationId(locId, data){
  const id = cleanLocationId(locId);
  if(!id)return [];
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(!h)return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds : [];
    if(ids.some(x => cleanLocationId(x) === id))return true;
    if(cleanLocationId(h.preferredLocationId) === id)return true;
    if(h.locationPrefs && typeof h.locationPrefs === 'object' && Object.prototype.hasOwnProperty.call(h.locationPrefs, id)){
      return true;
    }
    return false;
  });
}

// PURE: habits that rely on home city for prayer windows (anchors, no places).
function habitsUsingHomeCity(data){
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(typeof habitUsesPrayerAnchors !== 'function' || !habitUsesPrayerAnchors(h))return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds.filter(Boolean) : [];
    return ids.length === 0;
  });
}

// PURE: short toast listing habit names that block a destructive settings action.
function habitsInUseToast(prefix, habits){
  const names = (habits || []).map(h=>{
    if(typeof sampleDisplayName === 'function'){
      const n = sampleDisplayName(h);
      if(n)return n;
    }
    return (h && h.name) || 'habit';
  }).filter(Boolean);
  if(!names.length)return prefix;
  const shown = names.slice(0,4);
  const more = names.length > shown.length ? ` +${names.length - shown.length}` : '';
  return `${prefix}: ${shown.join(', ')}${more}`;
}

// HYBRID: remove a location, prune its travel edges, and sweep the dangling id
// off every habit (locationIds + preferredLocationId). Resets any location
// filter that pointed at it (Phase 5 globals, guarded). Blocked when any habit
// still references the place — user must clear those habits first.
function removeLocation(index){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const removed = locations[index];
  if(!removed)return;
  const users = habitsUsingLocationId(removed.id);
  if(users.length){
    const label = removed.name || 'place';
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast(`can't remove ${label} — still used by`, users));
    }
    return;
  }
  reindexSetAfterRemoval(expandedLocationMores,index);
  reindexSetAfterRemoval(pendingLocationHoursEdit,index);
  locations.splice(index,1);
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    if(edge.a !== removed.id && edge.b !== removed.id)travel[key] = edge;
  }
  updateSortSetting({locations,travel},{renderNow:false});
  const {data,changed} = reconcileLocations(load(),{...sortSettings,locations,travel});
  if(changed)save(data);
  if(typeof homeLocationFilter !== 'undefined' && homeLocationFilter === removed.id)homeLocationFilter = 'all';
  if(typeof overviewLocationFilter !== 'undefined' && overviewLocationFilter === removed.id)overviewLocationFilter = 'all';
  renderLocationControls();
  refreshOpenViews();
}

// HYBRID: update one location's hoursByDay[weekday] from the per-day editor.
// closed=true → null (closed that day); both times set → {start,end}; otherwise
// the override is dropped so the day falls back to the default window.
function saveLocationDayPatch(index,weekday,{start,end,closed}){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const loc = locations[index];
  if(!loc)return;
  const hoursByDay = {...(loc.hoursByDay || {})};
  if(closed){
    hoursByDay[weekday] = null;
  }else if(start !== null && end !== null){
    hoursByDay[weekday] = {start,end};
  }else{
    delete hoursByDay[weekday];
  }
  saveLocationPatch(index,{hoursByDay});
}

// HANDLER: toggle the "more" expander on a location row.
function toggleLocationMore(index){
  const body = document.querySelector(`[data-location-more="${index}"]`);
  const btn = document.querySelector(`[data-loc-more="${index}"]`);
  if(!body)return;
  const opening = body.hidden;
  body.hidden = !opening;
  if(opening)expandedLocationMores.add(index); else expandedLocationMores.delete(index);
  if(btn){
    btn.setAttribute('aria-expanded',String(opening));
    btn.innerHTML = (opening ? '▾' : '▸') + ' hours by day &amp; preferred time';
  }
}

// ── Location map picker (Leaflet) ───────────────────────────────────────
let pickerMap = null;
let pickerMarker = null;
let pickerEditIndex = null;
let pickerReverseTimer = null;
let pickerSuppressReverse = false;
let pickerDragging = false;
let pendingPickerResults = [];
let pickerMapGen = 0;

function destroyLocationPickerMap(){
  pickerMapGen += 1;
  if(pickerReverseTimer){ clearTimeout(pickerReverseTimer); pickerReverseTimer = null; }
  pickerDragging = false;
  if(pickerMap){
    try{
      pickerMap.stop();
      pickerMap.off();
      pickerMap.remove();
    }catch{ /* ignore */ }
    pickerMap = null;
    pickerMarker = null;
  }
  const el = $('picker-map');
  if(el){
    el.innerHTML = '';
    if(el._leaflet_id)delete el._leaflet_id;
  }
}

function pickerPanTo(lat,lng,zoom){
  if(!pickerMap || !Number.isFinite(lat) || !Number.isFinite(lng))return;
  try{
    const opts = { animate:false };
    if(Number.isFinite(zoom))pickerMap.setView([lat,lng],zoom,opts);
    else pickerMap.panTo([lat,lng],opts);
  }catch{ /* map mid-teardown */ }
}

function pickerSetCoords(lat,lng,{ reverse = true, pan = true, nameFromSearch = null, addressFromSearch = null } = {}){
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return;
  const latEl = $('picker-lat');
  const lngEl = $('picker-lng');
  if(latEl)latEl.value = String(Math.round(lat * 1e6) / 1e6);
  if(lngEl)lngEl.value = String(Math.round(lng * 1e6) / 1e6);
  try{
    if(pickerMarker)pickerMarker.setLatLng([lat,lng]);
  }catch{ /* ignore */ }
  if(pan)pickerPanTo(lat,lng);
  if(addressFromSearch){
    const hint = $('picker-address-hint');
    if(hint)hint.textContent = addressFromSearch;
  }
  if(nameFromSearch){
    const nameEl = $('picker-name');
    if(nameEl && !nameEl.value.trim())nameEl.value = nameFromSearch;
  }
  if(!reverse || pickerSuppressReverse)return;
  if(pickerReverseTimer)clearTimeout(pickerReverseTimer);
  const gen = pickerMapGen;
  pickerReverseTimer = setTimeout(async ()=>{
    pickerReverseTimer = null;
    if(gen !== pickerMapGen)return;
    const result = await reverseGeocode(lat,lng);
    if(gen !== pickerMapGen || !result)return;
    const hint = $('picker-address-hint');
    if(hint)hint.textContent = result.address || '';
    const nameEl = $('picker-name');
    if(nameEl && !nameEl.value.trim() && result.name)nameEl.value = result.name;
  },450);
}

function syncPickerPinToMapCenter({ reverse = true } = {}){
  if(!pickerMap || pickerDragging)return;
  let center = null;
  try{ center = pickerMap.getCenter(); }catch{ return; }
  if(!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))return;
  let cur = null;
  try{ cur = pickerMarker && pickerMarker.getLatLng(); }catch{ cur = null; }
  if(cur && Math.abs(cur.lat - center.lat) < 1e-7 && Math.abs(cur.lng - center.lng) < 1e-7)return;
  pickerSetCoords(center.lat,center.lng,{reverse,pan:false});
}

function ensureLocationPickerMap(lat,lng){
  const el = $('picker-map');
  if(!el || typeof L === 'undefined')return;
  const startLat = Number.isFinite(lat) ? lat : 40.7359;
  const startLng = Number.isFinite(lng) ? lng : -74.0036;
  if(!pickerMap){
    pickerMap = L.map(el,{
      zoomControl:true,
      attributionControl:true,
      zoomAnimation:false,
      fadeAnimation:false,
      markerZoomAnimation:false
    }).setView([startLat,startLng],15,{animate:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'&copy; OpenStreetMap'
    }).addTo(pickerMap);
    pickerMarker = L.marker([startLat,startLng],{ draggable:true }).addTo(pickerMap);
    pickerMarker.on('dragstart',()=>{ pickerDragging = true; });
    pickerMarker.on('dragend',()=>{
      pickerDragging = false;
      const p = pickerMarker.getLatLng();
      pickerSetCoords(p.lat,p.lng,{reverse:true});
    });
    pickerMap.on('click',e=>{
      pickerSetCoords(e.latlng.lat,e.latlng.lng,{reverse:true});
    });
    // After a pan/zoom, snap the pin to the crosshair (map center).
    pickerMap.on('moveend',()=>syncPickerPinToMapCenter({reverse:true}));
  }else{
    pickerPanTo(startLat,startLng,pickerMap.getZoom() || 15);
    try{ if(pickerMarker)pickerMarker.setLatLng([startLat,startLng]); }catch{ /* ignore */ }
  }
  const gen = pickerMapGen;
  setTimeout(()=>{ try{ if(pickerMap && gen === pickerMapGen)pickerMap.invalidateSize(); }catch{ /* ignore */ } },80);
  setTimeout(()=>{ try{ if(pickerMap && gen === pickerMapGen)pickerMap.invalidateSize(); }catch{ /* ignore */ } },320);
}

// HYBRID: open add/edit place picker with map pin. `opts.onCreated(id)` fires
// once after a brand-new place is saved, so callers (e.g. the detail-pane
// "+ new place" pill) can auto-select it on the habit they came from.
let pickerOnCreated = null;
function openLocationPicker(opts = {}){
  pickerEditIndex = Number.isInteger(opts.index) ? opts.index : null;
  pickerOnCreated = typeof opts.onCreated === 'function' ? opts.onCreated : null;
  const title = $('location-picker-title');
  if(title)title.textContent = pickerEditIndex != null ? 'edit pin' : 'add place';
  const nameEl = $('picker-name');
  const searchEl = $('picker-search');
  const results = $('picker-results');
  const hint = $('picker-address-hint');
  if(nameEl)nameEl.value = opts.name || '';
  if(searchEl)searchEl.value = '';
  if(results){ results.hidden = true; results.innerHTML = ''; }
  if(hint)hint.textContent = opts.address || '';
  pendingPickerResults = [];
  pickerSuppressReverse = true;
  openSheet('location-picker-sheet');
  const lat = Number.isFinite(opts.lat) ? opts.lat : (currentCoord ? currentCoord.lat : 40.7359);
  const lng = Number.isFinite(opts.lng) ? opts.lng : (currentCoord ? currentCoord.lng : -74.0036);
  ensureLocationPickerMap(lat,lng);
  pickerSetCoords(lat,lng,{reverse:!Number.isFinite(opts.lat),addressFromSearch:opts.address || null});
  pickerSuppressReverse = false;
}

function closeLocationPicker(){
  closeSheet('location-picker-sheet');
  destroyLocationPickerMap();
  pickerEditIndex = null;
  pickerOnCreated = null;
}

async function searchPickerLocations(){
  const searchEl = $('picker-search');
  const resultsWrap = $('picker-results');
  const btn = $('picker-search-btn');
  if(!searchEl || !resultsWrap)return;
  const q = searchEl.value.trim();
  if(!q){ showToast('enter an address to search'); searchEl.focus(); return; }
  resultsWrap.hidden = false;
  resultsWrap.innerHTML = '<p class="field-hint">searching…</p>';
  if(btn)btn.disabled = true;
  try{
    pendingPickerResults = await geocodeSearch(q);
  }catch{
    pendingPickerResults = [];
  }
  if(btn)btn.disabled = false;
  if(!pendingPickerResults.length){
    resultsWrap.innerHTML = '<p class="field-hint">no matches — try another address, or move the pin on the map.</p>';
    showToast('no address matches');
    return;
  }
  resultsWrap.innerHTML = pendingPickerResults.map((r,idx)=>`<button type="button" class="location-result" data-picker-result="${idx}">
    <b>${escapeHtml(r.name)}</b><span class="dim">${escapeHtml(r.address)}</span>
  </button>`).join('');
  resultsWrap.scrollIntoView({block:'nearest',behavior:'smooth'});
}

function pickPickerResult(idx){
  const r = pendingPickerResults[idx];
  if(!r)return;
  const nameEl = $('picker-name');
  if(nameEl && !nameEl.value.trim())nameEl.value = r.name;
  pickerSetCoords(r.lat,r.lng,{reverse:false,nameFromSearch:r.name,addressFromSearch:r.address});
  pickerPanTo(r.lat,r.lng,Math.max((pickerMap && pickerMap.getZoom()) || 15,16));
  const resultsWrap = $('picker-results');
  if(resultsWrap){ resultsWrap.hidden = true; resultsWrap.innerHTML = ''; }
  showToast(`pin moved to ${r.name}`);
}

function applyPickerCoordsInputs(){
  const lat = Number(($('picker-lat') && $('picker-lat').value) || NaN);
  const lng = Number(($('picker-lng') && $('picker-lng').value) || NaN);
  if(!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180){
    showToast('enter valid lat / lng');
    return;
  }
  pickerSetCoords(lat,lng,{reverse:true});
}

function centerPickerOnGps(){
  // Direct request from this tap — the button itself is the user gesture +
  // rationale ("move pin to my location"). Avoid stacking a second sheet over
  // the map picker (breaks iOS hit-testing).
  requestLocationAccess({quiet:false,updateAnchor:false,enableHighAccuracy:true}).then(status=>{
    if(status !== 'granted' || !currentCoord)return;
    pickerSetCoords(currentCoord.lat,currentCoord.lng,{reverse:true});
    pickerPanTo(currentCoord.lat,currentCoord.lng,Math.max((pickerMap && pickerMap.getZoom()) || 15,16));
    showToast('pin moved to your location');
  });
}

// Snap pin to map center (crosshair). Stops inertia first so getCenter is stable.
function dropPinAtMapCenter(){
  if(!pickerMap)return;
  try{ pickerMap.stop(); }catch{ /* ignore */ }
  syncPickerPinToMapCenter({reverse:true});
}

function saveLocationPicker(){
  const name = (($('picker-name') && $('picker-name').value) || '').trim();
  const lat = Number(($('picker-lat') && $('picker-lat').value) || NaN);
  const lng = Number(($('picker-lng') && $('picker-lng').value) || NaN);
  const address = (($('picker-address-hint') && $('picker-address-hint').textContent) || '').trim().slice(0,120);
  if(!name){ showToast('enter a name'); $('picker-name')?.focus(); return; }
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){ showToast('drop a pin on the map'); return; }
  if(pickerEditIndex != null){
    saveLocationPatch(pickerEditIndex,{name,address,lat,lng});
    showToast('pin updated');
    closeLocationPicker();
    return;
  }
  const id = addLocation({name,address,lat,lng});
  if(id){
    closeLocationPicker();
    if(typeof pickerOnCreated === 'function'){
      const cb = pickerOnCreated;
      pickerOnCreated = null;
      cb(id);
    }
  }
}

// Legacy stubs kept so old wiring does not throw if referenced.
function searchLocations(){ openLocationPicker(); }
function pickLocationResult(){}
function useMyLocationForAdd(){ openLocationPicker(); centerPickerOnGps(); }
function clearLocationAddForm(){}

// HYBRID: commit the default open-window pair. Both present → set both; both
// empty → 24h; exactly one present → hold (leave the DOM as-is so the user can
// finish typing the other half, since an incomplete window normalizes to 24h).
function commitLocationHours(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-start]');
  const eEl = row.querySelector('[data-loc-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:s,allowedTimeEnd:e});
  }else if(s === null && e === null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:null,allowedTimeEnd:null});
  }
  // else: exactly one filled — hold. pendingLocationHoursEdit keeps the
  // fields open/enabled through any unrelated re-render until this resolves.
}

// HYBRID: commit the preferred-time pair (same incomplete-pair rule).
function commitLocationPref(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-pref-start]');
  const eEl = row.querySelector('[data-loc-pref-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationPatch(index,{preferredTimeStart:s,preferredTimeEnd:e});
  else if(s === null && e === null)saveLocationPatch(index,{preferredTimeStart:null,preferredTimeEnd:null});
}

// HYBRID: commit one per-day override pair. Both present → {start,end}; both
// empty → override dropped (falls back to default); exactly one → hold.
function commitLocationDayHours(index,weekday){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector(`[data-loc-day-start="${weekday}"]`);
  const eEl = row.querySelector(`[data-loc-day-end="${weekday}"]`);
  const cEl = row.querySelector(`[data-loc-day-closed="${weekday}"]`);
  if(cEl && cEl.checked){ saveLocationDayPatch(index,weekday,{closed:true}); return; }
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationDayPatch(index,weekday,{start:s,end:e,closed:false});
  else if(s === null && e === null)saveLocationDayPatch(index,weekday,{closed:false});
}

// HYBRID: patch sort state and re-sync UI
function updateSortSetting(patch,options = {}){
  const {sync = true,renderNow = true} = options;
  saveSortSettings({...sortSettings,...patch});
  if(sync)syncSettingsControls();
  if(sortSettings.reachAssist === false)document.body.classList.remove('reach-pad');
  if(renderNow)render();
}

/** PURE: human summary for a retention cleanup result. */
function retentionCleanupSummary(result,{automatic = false} = {}){
  if(!result || !result.changed){
    return automatic ? '' : 'nothing to clean';
  }
  const parts = [];
  const removed = (result.removedTasks || []).length;
  if(removed)parts.push(`removed ${removed} old completed task${removed === 1 ? '' : 's'}`);
  if(result.trimmedHabits > 0){
    parts.push(`trimmed history on ${result.trimmedHabits} habit${result.trimmedHabits === 1 ? '' : 's'}`);
  }
  const body = parts.join(' · ') || 'cleaned up';
  return automatic ? `Automatic cleanup — ${body}` : `Cleanup — ${body}`;
}

/**
 * HYBRID: run retention cleanup, persist when needed, show a clear notice.
 * @param {{force?:boolean,automatic?:boolean}} options
 *   force — ignore the monthly gate (Clean now)
 *   automatic — monthly boot path; stamps lastRetentionCleanupAt even if empty
 */
function applyRetentionCleanup(options = {}){
  const {force = false,automatic = false} = options;
  const settings = typeof loadSortSettings === 'function' ? loadSortSettings() : (sortSettings || {});
  const now = Date.now();
  if(automatic && !force && typeof shouldRunRetentionCleanup === 'function'
    && !shouldRunRetentionCleanup(settings,now)){
    return {ran:false,changed:false};
  }
  if(typeof runRetentionCleanup !== 'function' || typeof load !== 'function'){
    return {ran:false,changed:false};
  }
  let openHid = null;
  if(typeof detailIdx !== 'undefined' && detailIdx != null){
    const cur = load()[detailIdx];
    openHid = cur ? cleanHabitId(cur.hid) : null;
  }
  const result = runRetentionCleanup(load(),settings,now);
  if(result.changed && typeof save === 'function'){
    const removedHids = new Set((result.removedTasks || []).map(h=>cleanHabitId(h.hid)));
    (result.removedTasks || []).forEach(removed=>{
      if(typeof cancelPush === 'function' && typeof reminderSignature === 'function' && removed.type === 'task'){
        try{ cancelPush(reminderSignature(removed)); }catch(_){}
      }
      if(typeof pruneOrderConstraintsForHabit === 'function'){
        try{ pruneOrderConstraintsForHabit(removed,[],now); }catch(_){}
      }
    });
    if(openHid){
      if(removedHids.has(openHid)){
        detailIdx = null;
        if(typeof closeSheet === 'function'){
          try{ closeSheet('detail-sheet'); }catch(_){}
        }
      }else{
        const newIdx = result.data.findIndex(h=>cleanHabitId(h.hid) === openHid);
        if(newIdx >= 0)detailIdx = newIdx;
      }
    }
    save(result.data);
    const creditId = cleanHabitId(settings.calendarCreditHabitId);
    if(creditId && removedHids.has(creditId)){
      saveSortSettings({...loadSortSettings(),calendarCreditHabitId:null});
    }
  }
  if(automatic){
    saveSortSettings({...loadSortSettings(),lastRetentionCleanupAt:now});
  }
  const summary = retentionCleanupSummary(result,{automatic});
  const status = $('retention-cleanup-status');
  if(status)status.textContent = summary || (force ? 'nothing to clean' : '');
  if(summary && typeof showToast === 'function')showToast(summary,5200);
  else if(force && !result.changed && typeof showToast === 'function')showToast('nothing to clean',1800);
  if(result.changed && typeof render === 'function')render();
  return {ran:true,changed:result.changed,result,summary};
}

/** Schedule the monthly retention pass after first paint (near-zero cost when gated). */
function scheduleMonthlyRetentionCleanup(){
  const run = ()=>{
    try{ applyRetentionCleanup({automatic:true}); }
    catch(_){}
  };
  if(typeof requestIdleCallback === 'function'){
    requestIdleCallback(()=>setTimeout(run,0),{timeout:4000});
  }else{
    setTimeout(run,1800);
  }
}

// PURE: check if key is a sort setting
function isSortSettingKey(key){
  return ['plansFirst','planWindowDays','planWeight','dueWeight','progressWeight','trendWeight','rhythmWeight','buildWeight','limitWeight','stopWeight','newWeight','newBuildMode','dueMode','buildLookAheadDays','buildRiseAt','limitMode','stopMode','rhythmBias','focus'].includes(key);
}

// HANDLER: toggle a boolean app setting
function toggleAppSettingButton(btn){
  if(!btn)return;
  const key = btn.dataset.settingToggle;
  if(!key)return;
  if(key === 'reminders'){toggleReminders();return;}
  const patch = {[key]:!Boolean(sortSettings[key])};
  if(isSortSettingKey(key))patch.preset = 'custom';
  // Presentation-only: reuse the mounted week plan (same pattern as homeExtraMode).
  // A full render() would still be cheap once the planner key ignores minimalMode,
  // but presentation-only avoids even entering the async planner coordinator.
  if(key === 'minimalMode'){
    updateSortSetting(patch,{renderNow:false});
    if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
    else render();
    if(typeof renderOverview === 'function' && $('overview-sheet')?.classList.contains('open'))renderOverview();
    return;
  }
  updateSortSetting(patch);
  if(key === 'agendaOptimizer' && patch.agendaOptimizer && typeof preloadAgendaOptimizer === 'function'
    && typeof agendaPlannerWorkerAvailable === 'function' && !agendaPlannerWorkerAvailable()){
    preloadAgendaOptimizer();
  }
  if(key === 'prayerIslamicNames'){
    document.querySelectorAll('.time-anchor[data-populated]').forEach(sel=>{delete sel.dataset.populated;});
    if(typeof populateAnchorOptions === 'function')populateAnchorOptions();
    renderBlockedTimeControls();
  }
}

// HANDLER: enable/disable reminders. On enable, ask for notification permission
// from this user gesture. The in-app banner works without any permission, so we
// always enable it; system notifications are a best-effort layer on top.
// RENDER: populate + sync the prayer-times sub-section (method dropdown and
// madhab seg). Idempotent — options are populated once, then values synced.
function renderPrayerTimesControls(){
  const sel = document.getElementById('setting-prayer-method');
  if(sel){
    if(!sel.dataset.populated){
      sel.innerHTML = PRAYER_METHODS.map(m => `<option value="${m.key}">${m.label}</option>`).join('');
      sel.dataset.populated = '1';
    }
    sel.value = normalizePrayerMethod(sortSettings.prayerMethod);
  }
  const madhab = normalizePrayerMadhab(sortSettings.prayerMadhab);
  document.querySelectorAll('#prayer-madhab-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.prayerMadhab === madhab);
  });
}

async function toggleReminders(){
  const turningOn = !Boolean(sortSettings.reminders);
  if(!turningOn){
    if(typeof unsubscribeFromPush === 'function')unsubscribeFromPush();
    updateSortSetting({reminders:false});
    if(typeof hideReminderBanner === 'function')hideReminderBanner();
    showToast('reminders off');
    return;
  }
  let perm = 'unsupported';
  if(typeof requestReminderPermission === 'function')perm = await requestReminderPermission();
  updateSortSetting({reminders:true});
  showToast(perm === 'granted' ? 'reminders on' : 'reminders on · in-app banner');
  if(perm === 'granted' && typeof initPush === 'function')initPush();
  setTimeout(()=>{if(typeof checkReminders === 'function')checkReminders();},120);
}


// PURE: count sample habits in list
function sortSampleCount(){
  return load().filter(h=>h.sample).length;
}

// PURE: prayer demo samples use stable hids
function isPrayerSample(h){
  return Boolean(h && h.sample && String(h.hid || '').startsWith('sample-prayer-'));
}
function isFeatureSample(h){
  return Boolean(h && h.sample && !String(h.hid || '').startsWith('sample-prayer-'));
}

// RENDER: update sample count label + remove button on sample sheet
function updateSortSampleCount(){
  const n = sortSampleCount();
  const label = $('sort-sample-count');
  if(label)label.textContent = n
    ? `${n} tagged sample${n === 1 ? '' : 's'} on home · remove drops the rest`
    : 'No tagged samples on home.';
  const btn = $('remove-sort-samples');
  if(btn)btn.disabled = n === 0;
}

// PURE: display name without Sample: prefix
function sampleDisplayName(h){
  if(!h || typeof h.name !== 'string')return '';
  return h.name.startsWith('Sample: ') ? h.name.slice('Sample: '.length) : h.name;
}

// PURE: whether a catalog sample is already on home (by hid, or legacy name match)
function sampleAlreadyOnHome(hid, displayName){
  const data = load();
  if(hid && data.some(h => h.hid === hid))return true;
  if(displayName){
    const full = `Sample: ${displayName}`;
    if(data.some(h => h.name === full || h.name === displayName))return true;
  }
  return false;
}

// PURE: blurbs for feature-tour rows (keys match buildSortSamples hids)
function featureSamplePreviews(){
  return [
    {hid:'sample-feature-stretch', emoji:'🌅', title:'stretch after sunrise', blurb:'Window from sunrise +10m', place:''},
    {hid:'sample-feature-night-work', emoji:'🌙', title:'night deep work', blurb:'Evening window after Isha', place:'Home'},
    {hid:'sample-feature-report', emoji:'📝', title:'write report in chunks', blurb:'Breakable — split across sessions', place:'Home'},
    {hid:'sample-feature-timed-run', emoji:'🏃', title:'timed run', blurb:'Timer + session progress bar', place:'Park'},
    {hid:'sample-feature-dentist', emoji:'🦷', title:'dentist (auto)', blurb:'Timed task that auto-completes', place:''},
    {hid:'sample-feature-weigh-in', emoji:'⚖️', title:'weigh-in', blurb:'Log a number with each entry', place:'Home'},
    {hid:'sample-feature-park-walk', emoji:'🌳', title:'walk to the park', blurb:'Place + travel on today’s list', place:'Park'},
    {hid:'sample-feature-do-early', emoji:'🧺', title:'do early because Tuesday is packed', blurb:'Do it early while the week is open', place:'Home'},
    {hid:'sample-feature-gym', emoji:'💪', title:'gym session', blurb:'Place-gated workout', place:'Gym'},
    {hid:'sample-feature-stretch-gym', emoji:'🤸', title:'stretch at gym or home', blurb:'Multi-place habit', place:'Gym · Home'},
    {hid:'sample-feature-family', emoji:'☎️', title:'call family', blurb:'Home or Mom’s', place:'Home · Mom’s'},
    {hid:'sample-feature-coffee', emoji:'☕', title:'coffee on office days', blurb:'Limit · Office or Cafe', place:'Office · Cafe'},
    {hid:'sample-feature-water', emoji:'💧', title:'drink water', blurb:'Simple daily habit', place:''},
    {hid:'sample-feature-snacks', emoji:'🍪', title:'less late snacks', blurb:'Limit how often', place:'Home'},
    {hid:'sample-feature-soda', emoji:'🥤', title:'quit soda', blurb:'Stop habit', place:''}
  ];
}

// PURE: prayer preview rows
function prayerSamplePreviews(){
  const label = (key)=>{
    if(typeof PRAYER_ANCHOR_LABELS !== 'undefined' && PRAYER_ANCHOR_LABELS[key]){
      return String(PRAYER_ANCHOR_LABELS[key]).replace(/\s*\([^)]*\)\s*$/,'').trim();
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };
  return [
    {key:'fajr', emoji:'🌅', tint:'indigo', blurb:'Until sunrise −10m'},
    {key:'dhuhr', emoji:'☀️', tint:'amber', blurb:'Until Asr −15m'},
    {key:'asr', emoji:'🌤️', tint:'cyan', blurb:'Until Maghrib −15m'},
    {key:'maghrib', emoji:'🌇', tint:'orange', blurb:'Until sunset +1h or Isha −15m'},
    {key:'isha', emoji:'🌙', tint:'purple', blurb:'Until next Fajr −30m'}
  ].map(row=>({
    hid:`sample-prayer-${row.key}`,
    emoji:row.emoji,
    emojiBgColor:row.tint,
    title:label(row.key),
    blurb:row.blurb,
    place:''
  }));
}

// RENDER: one sample row with per-item add. `onHome` overrides the default
// habits-only check (busy-time samples are "added" when the block is on the
// schedule, not when a habit exists).
function renderSampleHabitRow(row, onHome){
  const added = onHome != null ? onHome : sampleAlreadyOnHome(row.hid, row.title);
  return `
    <div class="sample-habit-row${added ? ' is-on-home' : ''}" data-sample-hid="${escapeHtml(row.hid)}">
      <span class="sample-habit-emoji${row.emojiBgColor ? ' tinted' : ''}" aria-hidden="true"${row.emojiBgColor ? ` style="--sample-tint-bg:var(--${escapeHtml(row.emojiBgColor)}-bg);--sample-tint-icon:var(--${escapeHtml(row.emojiBgColor)}-icon);"` : ''}>${row.emoji}</span>
      <div class="sample-habit-copy">
        <b>${escapeHtml(row.title)}</b>
        <small>${escapeHtml(row.blurb)}${row.place ? ` · ${escapeHtml(row.place)}` : ''}</small>
      </div>
      <button type="button" class="btn sample-habit-add" data-add-sample="${escapeHtml(row.hid)}"${added ? ' disabled' : ''}>
        ${added ? 'added' : 'add'}
      </button>
    </div>
  `;
}

// RENDER: fill sample-habits sheet feature list
function renderSampleHabitsPreview(){
  const host = $('sample-habits-preview');
  if(!host)return;
  host.innerHTML = featureSamplePreviews().map(row => renderSampleHabitRow(row)).join('');
}

// RENDER: fill daily prayers list on sample sheet
function renderPrayerSamplesPreview(){
  const host = $('sample-prayers-preview');
  if(!host)return;
  host.innerHTML = prayerSamplePreviews().map(row => renderSampleHabitRow(row)).join('');
}

// ── Sample busy times ─────────────────────────────────────────────────────
// The demo sleep block is a Settings busy time (not a habit): it replaces the
// default fixed 11pm–5am sleep with a sun-based window — start at the later of
// Isha +15m and 8h before the next sunrise, end 40m before sunrise. Anchors
// resolve against the home city (no place needed), same as the prayers.

// PURE: the dynamic sleep block the sample installs.
function buildSampleSleepBlock(){
  return {
    label:'sleep',
    days:[0,1,2,3,4,5,6],
    start:1380, end:300,           // fixed fallback while no city/place is set
    startAnchor:'isha', startOffsetMin:15,
    startCombine:'later',
    startAnchor2:'sunrise', startOffsetMin2:-480, startDayOffset2:1,
    endAnchor:'sunrise', endOffsetMin:-40
  };
}

// PURE: busy-time preview rows (keys match buildSampleSleepBlock)
function blockSamplePreviews(){
  return [
    {
      hid:'sample-block-sleep',
      emoji:'😴',
      emojiBgColor:'slate',
      title:'sleep',
      blurb:'Later of Isha +15m · next sunrise −8h, until sunrise −40m',
      place:''
    }
  ];
}

// PURE: true when the sun-based sleep block is already on the schedule
// (a 'sleep' block with any prayer anchor).
function sampleSleepBlockAdded(){
  const blocks = typeof normalizeBlockedTimes === 'function'
    ? normalizeBlockedTimes(sortSettings && sortSettings.blockedTimes)
    : (Array.isArray(sortSettings && sortSettings.blockedTimes) ? sortSettings.blockedTimes : []);
  return blocks.some(b =>
    String(b.label || '').toLowerCase() === 'sleep'
    && (cleanPrayerAnchor(b.startAnchor) || cleanPrayerAnchor(b.endAnchor))
  );
}

// RENDER: fill sample busy-time list on sample sheet
function renderBlockSamplesPreview(){
  const host = $('sample-blocks-preview');
  if(!host)return;
  host.innerHTML = blockSamplePreviews().map(row => renderSampleHabitRow(row, sampleSleepBlockAdded())).join('');
}

// HANDLER: install the sun-based sleep busy time (home city required first).
// Replaces the existing 'sleep' block (usually the default fixed one) so the
// schedule never ends up with two overlapping sleep spans.
function addBlockSample(){
  if(!ensureHomeCityForDynamicSamples())return false;
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  const idx = blocks.findIndex(b => String(b.label || '').toLowerCase() === 'sleep');
  const next = blocks.slice();
  const sampleBlock = buildSampleSleepBlock();
  if(idx >= 0)next[idx] = sampleBlock;
  else next.push(sampleBlock);
  updateSortSetting({blockedTimes:normalizeBlockedTimes(next)},{renderNow:false});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  renderBlockedTimeControls();
  renderBlockSamplesPreview();
  if(typeof render === 'function')render();
  if(typeof showToast === 'function')showToast('added · sun-based sleep busy time');
  return true;
}

// RENDER: refresh the preview lists on the sample sheet
function refreshSampleHabitsSheet(){
  renderSampleHabitsPreview();
  renderPrayerSamplesPreview();
  renderBlockSamplesPreview();
}

// HYBRID: open sample habits sheet from About
function openSampleHabitsSheet(){
  refreshSampleHabitsSheet();
  updateSortSampleCount();
  const prayersBody = $('sample-prayers-body');
  const prayersHead = $('sample-prayers-head');
  if(prayersBody)prayersBody.hidden = true;
  if(prayersHead)prayersHead.setAttribute('aria-expanded','false');
  closeSheet('about-sheet');
  openSheet('sample-habits-sheet');
}

// PURE: build a sample habit object
function sortSampleHabit(name,type,target,logs,options = {}){
  const locationIds = Array.isArray(options.locationIds) ? options.locationIds.map(cleanLocationId).filter(Boolean) : [];
  const raw = {
    name:`Sample: ${name}`,
    type,
    target:(type === 'zero' || type === 'task') ? null : target,
    dueDate:type === 'task' ? (options.dueDate ?? null) : null,
    hardDue:type === 'task' ? Boolean(options.hardDue) : false,
    eventTime:type === 'task' ? (options.eventTime ?? null) : null,
    planByDate:(type === 'keepup' || type === 'reduce') ? (options.planByDate ?? null) : null,
    createdAt:options.createdAt || Date.now(),
    logs,
    emoji:options.emoji || '',
    emojiBgColor:normalizeEmojiBgColor(options.emojiBgColor),
    pinned:Boolean(options.pinned),
    sample:true,
    snoozedUntil:options.snoozedUntil || null,
    topics:normalizeTopics(options.topics),
    locationIds,
    preferredLocationId:normalizePreferredLocation(options.preferredLocationId,locationIds),
    allowedWeekdays:normalizeAllowedWeekdays(options.allowedWeekdays),
    allowedMonthDays:normalizeAllowedMonthDays(options.allowedMonthDays),
    preferredWeekdays:normalizeAllowedWeekdays(options.preferredWeekdays),
    preferredMonthDays:normalizeAllowedMonthDays(options.preferredMonthDays),
    allowedTimeStart:normalizeTimeMinutes(options.allowedTimeStart),
    allowedTimeEnd:normalizeTimeMinutes(options.allowedTimeEnd),
    preferredTimeStart:normalizeTimeMinutes(options.preferredTimeStart),
    preferredTimeEnd:normalizeTimeMinutes(options.preferredTimeEnd),
    allowedTimeStartAnchor:options.allowedTimeStartAnchor ?? null,
    allowedTimeStartOffsetMin:options.allowedTimeStartOffsetMin ?? 0,
    allowedTimeEndAnchor:options.allowedTimeEndAnchor ?? null,
    allowedTimeEndOffsetMin:options.allowedTimeEndOffsetMin ?? 0,
    allowedTimeStartDayOffset:options.allowedTimeStartDayOffset ?? 0,
    allowedTimeEndDayOffset:options.allowedTimeEndDayOffset ?? 0,
    allowedTimeStartCombine:options.allowedTimeStartCombine ?? null,
    allowedTimeStartAnchor2:options.allowedTimeStartAnchor2 ?? null,
    allowedTimeStartOffsetMin2:options.allowedTimeStartOffsetMin2 ?? 0,
    allowedTimeStartDayOffset2:options.allowedTimeStartDayOffset2 ?? 0,
    allowedTimeEndCombine:options.allowedTimeEndCombine ?? null,
    allowedTimeEndAnchor2:options.allowedTimeEndAnchor2 ?? null,
    allowedTimeEndOffsetMin2:options.allowedTimeEndOffsetMin2 ?? 0,
    allowedTimeEndDayOffset2:options.allowedTimeEndDayOffset2 ?? 0,
    preferredTimeStartCombine:options.preferredTimeStartCombine ?? null,
    preferredTimeStartAnchor2:options.preferredTimeStartAnchor2 ?? null,
    preferredTimeStartOffsetMin2:options.preferredTimeStartOffsetMin2 ?? 0,
    preferredTimeStartDayOffset2:options.preferredTimeStartDayOffset2 ?? 0,
    preferredTimeEndCombine:options.preferredTimeEndCombine ?? null,
    preferredTimeEndAnchor2:options.preferredTimeEndAnchor2 ?? null,
    preferredTimeEndOffsetMin2:options.preferredTimeEndOffsetMin2 ?? 0,
    preferredTimeEndDayOffset2:options.preferredTimeEndDayOffset2 ?? 0,
    flexibilityDays:clampFlexibility(options.flexibilityDays),
    durationMinutes:clampDuration(options.durationMinutes),
    breakable:Boolean(options.breakable),
    minChunkMinutes:options.minChunkMinutes != null ? clampMinChunk(options.minChunkMinutes) : undefined,
    autoMarkMinutes:options.autoMarkMinutes != null ? normalizeAutoMark(options.autoMarkMinutes) : null,
    timerAutoStopMinutes:options.timerAutoStopMinutes != null ? normalizeTimerAutoStop(options.timerAutoStopMinutes) : null,
    trackValue:Boolean(options.trackValue),
    priority:options.priority != null ? clampPriority(options.priority) : undefined,
    hid:options.hid || undefined
  };
  return raw;
}

// PURE: NYC-area sample places — close enough that travel is visible but short.
// Stable ids so re-adding samples doesn't orphan habit references.
function buildSampleLocations(){
  return [
    {
      id:'sample-home', name:'Sample Home', address:'West Village, NYC',
      lat:40.7359, lng:-74.0036, radiusM:100,
      emoji:'🏠'
    },
    {
      id:'sample-office', name:'Sample Office', address:'Midtown, NYC',
      lat:40.7549, lng:-73.9840, radiusM:80,
      emoji:'🏢',
      allowedTimeStart:540, allowedTimeEnd:1080, // 9a–6p
      closedDays:[0,6]
    },
    {
      id:'sample-gym', name:'Sample Gym', address:'Chelsea, NYC',
      lat:40.7465, lng:-73.9972, radiusM:75,
      emoji:'🏋️',
      allowedTimeStart:360, allowedTimeEnd:1320, // 6a–10p
      closedDays:[0],
      preferredTimeStart:420, preferredTimeEnd:540 // best early
    },
    {
      id:'sample-cafe', name:'Sample Cafe', address:'East Village, NYC',
      lat:40.7265, lng:-73.9815, radiusM:60,
      emoji:'☕',
      allowedTimeStart:480, allowedTimeEnd:1020, // 8a–5p
      preferredTimeStart:840, preferredTimeEnd:960, // 2–4p off-peak
      hoursByDay:{6:{start:540,end:900}} // Sat 9a–3p
    },
    {
      id:'sample-moms', name:"Sample Mom's house", address:'Park Slope, Brooklyn',
      lat:40.6701, lng:-73.9778, radiusM:90,
      emoji:'🏡',
      allowedTimeStart:660, allowedTimeEnd:1020 // 11a–5p
    },
    {
      // 24h second anchor so travel between places is visible even late at night.
      id:'sample-park', name:'Sample Park', address:'Washington Square Park, NYC',
      lat:40.7308, lng:-73.9973, radiusM:120,
      emoji:'🌳'
    }
  ];
}

// PURE: curated feature-tour samples (no five daily prayers)
function buildSortSamples(){
  const H = 'sample-home';
  const O = 'sample-office';
  const G = 'sample-gym';
  const C = 'sample-cafe';
  const M = 'sample-moms';
  const P = 'sample-park';
  return [
    sortSampleHabit('stretch after sunrise','keepup',1,[],{
      emoji:'🌅', topics:['health'], durationMinutes:15, pinned:true, priority:1,
      hid:'sample-feature-stretch',
      allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:10,
      allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:40
    }),
    sortSampleHabit('night deep work','keepup',1,[],{
      emoji:'🌙', topics:['focus'], durationMinutes:45, priority:2,
      hid:'sample-feature-night-work',
      allowedTimeStartAnchor:'isha', allowedTimeStartOffsetMin:15,
      allowedTimeEndAnchor:'isha', allowedTimeEndOffsetMin:150,
      locationIds:[H]
    }),
    sortSampleHabit('write report in chunks','task',null,[],{
      emoji:'📝', topics:['work'], durationMinutes:90, minChunkMinutes:20,
      hid:'sample-feature-report',
      breakable:true, dueDate:sampleActual(0), priority:1, locationIds:[H]
    }),
    sortSampleHabit('timed run','keepup',2,sampleLogs([5,3]),{
      emoji:'🏃', topics:['health'], durationMinutes:30, timerAutoStopMinutes:30,
      hid:'sample-feature-timed-run',
      locationIds:[P], preferredLocationId:P, priority:1
    }),
    sortSampleHabit('dentist (auto)','task',null,[],{
      emoji:'🦷', topics:['health'], durationMinutes:45,
      hid:'sample-feature-dentist',
      eventTime:Date.now() + 3 * 3600000, dueDate:dayStart(Date.now()),
      autoMarkMinutes:45, priority:0
    }),
    sortSampleHabit('weigh-in','keepup',7,sampleLogs([14,7]),{
      emoji:'⚖️', topics:['health'], durationMinutes:5, trackValue:true,
      hid:'sample-feature-weigh-in', locationIds:[H]
    }),
    sortSampleHabit('walk to the park','task',null,[],{
      emoji:'🌳', topics:['health','rest'], durationMinutes:20,
      hid:'sample-feature-park-walk',
      dueDate:sampleActual(0), locationIds:[H,P], preferredLocationId:P, priority:0, pinned:true
    }),
    sortSampleHabit('do early because Tuesday is packed','keepup',2,sampleLogs([0]),{
      emoji:'🧺', topics:['home'], durationMinutes:50, flexibilityDays:2,
      hid:'sample-feature-do-early', locationIds:[H], priority:2
    }),
    sortSampleHabit('gym session','keepup',2,sampleLogs([5,3]),{
      emoji:'💪', topics:['health'], durationMinutes:35,
      hid:'sample-feature-gym', locationIds:[G], priority:1
    }),
    sortSampleHabit('stretch at gym or home','keepup',7,sampleLogs([32,20,11,5,1]),{
      emoji:'🤸', topics:['health'], durationMinutes:15,
      hid:'sample-feature-stretch-gym',
      locationIds:[G,H], preferredLocationId:G
    }),
    sortSampleHabit('call family','keepup',7,sampleLogs([34,21,14,6]),{
      emoji:'☎️', topics:['relationships'], durationMinutes:20,
      hid:'sample-feature-family',
      locationIds:[H,M], preferredLocationId:M, priority:1
    }),
    sortSampleHabit('coffee on office days','reduce',2,sampleLogs([6,4,2]),{
      emoji:'☕', topics:['health'], durationMinutes:5,
      hid:'sample-feature-coffee',
      allowedWeekdays:[1,3], locationIds:[O,C], preferredLocationId:O
    }),
    sortSampleHabit('drink water','keepup',1,sampleLogs([2,1]),{
      emoji:'💧', topics:['health'], durationMinutes:2, pinned:true,
      hid:'sample-feature-water'
    }),
    sortSampleHabit('less late snacks','reduce',5,sampleLogs([9,6,3]),{
      emoji:'🍪', topics:['food'], hid:'sample-feature-snacks', locationIds:[H]
    }),
    sortSampleHabit('quit soda','zero',null,sampleLogs([35,18]),{
      emoji:'🥤', topics:['health'], hid:'sample-feature-soda'
    })
  ];
}

// PURE: five daily prayer demos (optional pack). No sample places — windows
// resolve from Settings home city (homeCityLat/Lng). Always use Islamic names
// (Fajr–Isha), independent of Settings prayerIslamicNames.
function buildPrayerSamples(){
  const label = (key)=>{
    if(typeof PRAYER_ANCHOR_LABELS !== 'undefined' && PRAYER_ANCHOR_LABELS[key]){
      // Drop parentheticals like "Maghrib (sunset)" for habit titles
      return String(PRAYER_ANCHOR_LABELS[key]).replace(/\s*\([^)]*\)\s*$/,'').trim();
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };
  const rows = [
    // Start at the prayer's own time, end before the next prayer (Fajr stops
    // 10m before sunrise; Maghrib ends at the earlier of sunset +1h or Isha −15m).
    {key:'fajr', emoji:'🌅', tint:'indigo', start:['fajr',0], end:['sunrise',-10], endDay:0},
    {key:'dhuhr', emoji:'☀️', tint:'amber', start:['dhuhr',0], end:['asr',-15], endDay:0},
    {key:'asr', emoji:'🌤️', tint:'cyan', start:['asr',0], end:['maghrib',-15], endDay:0},
    {key:'maghrib', emoji:'🌇', tint:'orange', start:['maghrib',0], end:['maghrib',60], end2:['isha',-15], endDay:0},
    {key:'isha', emoji:'🌙', tint:'purple', start:['isha',0], end:['fajr',-30], endDay:1}
  ];
  return rows.map(row=>sortSampleHabit(label(row.key),'keepup',1,[],{
    emoji:row.emoji,
    emojiBgColor:row.tint,
    topics:['prayer'],
    durationMinutes:8,
    priority:1,
    hid:`sample-prayer-${row.key}`,
    allowedTimeStartAnchor:row.start[0],
    allowedTimeStartOffsetMin:row.start[1],
    allowedTimeEndAnchor:row.end[0],
    allowedTimeEndOffsetMin:row.end[1],
    allowedTimeEndDayOffset:row.endDay,
    allowedTimeEndCombine:row.end2 ? 'earlier' : null,
    allowedTimeEndAnchor2:row.end2 ? row.end2[0] : null,
    allowedTimeEndOffsetMin2:row.end2 ? row.end2[1] : null
  }));
}

// PURE: sample place ids referenced by habits about to be added.
function sampleLocationIdsReferenced(samples){
  const ids = new Set();
  (samples || []).forEach(h=>{
    if(!h)return;
    (Array.isArray(h.locationIds) ? h.locationIds : []).forEach(id=>{
      const clean = cleanLocationId(id);
      if(clean)ids.add(clean);
    });
    const pref = cleanLocationId(h.preferredLocationId);
    if(pref)ids.add(pref);
    if(h.locationPrefs && typeof h.locationPrefs === 'object'){
      Object.keys(h.locationPrefs).forEach(id=>{
        const clean = cleanLocationId(id);
        if(clean)ids.add(clean);
      });
    }
  });
  return ids;
}

// HYBRID: merge sample places + topics into settings (shared by feature / prayer add).
// Only seeds sample locations referenced by the habits being added — prayer-only
// packs seed topics and never touch the place registry or lastKnownLocationId.
function seedSamplePlacesAndTopics(samples,{setPresence = true} = {}){
  const neededIds = sampleLocationIdsReferenced(samples);
  const existing = normalizeLocationRegistry(sortSettings.locations);
  const byId = new Map(existing.map(l=>[l.id,l]));
  const sampleLocs = buildSampleLocations().filter(loc => neededIds.has(loc.id));
  sampleLocs.forEach(loc=>{ if(!byId.has(loc.id))byId.set(loc.id,loc); });
  const locations = normalizeLocationRegistry([...byId.values()]);
  const existingTopics = new Set(normalizeTopics(sortSettings.topics || []));
  (samples || []).forEach(h=>(h.topics || []).forEach(t=>{ if(t)existingTopics.add(t); }));
  const topics = normalizeTopics([...existingTopics]);
  const patch = {
    topics,
    showSampleOnCards:true
  };
  if(neededIds.size){
    const BLOCK_LOCATION = {
      sleep:'sample-home', breakfast:'sample-home', dinner:'sample-home',
      work:'sample-office', lunch:'sample-office'
    };
    const patchedBlocks = normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>{
      const label = (b.label || '').toLowerCase();
      const loc = BLOCK_LOCATION[label];
      if(loc && !b.locationId && byId.has(loc))return {...b,locationId:loc};
      return b;
    });
    patch.locations = locations;
    patch.showLocationOnCards = true;
    patch.defaultTravelMode = sortSettings.defaultTravelMode || 'walking';
    patch.blockedTimes = patchedBlocks;
    if(setPresence && !sortSettings.lastKnownLocationId){
      if(neededIds.has('sample-home') || byId.has('sample-home')){
        patch.lastKnownLocationId = 'sample-home';
      }else{
        const first = [...neededIds][0];
        if(first)patch.lastKnownLocationId = first;
      }
    }
  }
  updateSortSetting(patch,{renderNow:false,sync:false});
  return {locations, topics, seededLocationIds:[...neededIds]};
}

// PURE: look up a catalog sample by hid
function findCatalogSample(hid){
  const id = String(hid || '');
  if(!id)return null;
  return [...buildSortSamples(), ...buildPrayerSamples()].find(h => h.hid === id) || null;
}

// HANDLER: commit one or more catalog samples onto home
function commitSampleHabits(samples,{setPresence = true, closeSheets = false, toast = ''} = {}){
  const list = (samples || []).filter(Boolean);
  if(!list.length)return false;
  const data = load();
  const have = new Set(data.map(h => h.hid).filter(Boolean));
  const fresh = list.filter(h => h.hid && !have.has(h.hid));
  if(!fresh.length){
    if(typeof showToast === 'function')showToast('already on home');
    refreshSampleHabitsSheet();
    return false;
  }
  if(data.length + fresh.length > MAX_TINGS){
    alert(`${MAX_TINGS} habits max`);
    return false;
  }
  seedSamplePlacesAndTopics(fresh,{setPresence});
  const next = [...data, ...fresh.map(h=>({...h,lastLog:latestActualLog(h.logs)}))];
  if(!save(next))return false;
  updateSortSampleCount();
  syncSettingsControls();
  if(closeSheets){
    closeSheet('settings-sheet');
    closeSheet('sample-habits-sheet');
    closeSheet('about-sheet');
  }else{
    refreshSampleHabitsSheet();
  }
  if(typeof render === 'function')render();
  if(toast){
    const hids = fresh.map(h => h.hid).filter(Boolean);
    if(typeof showActionToast === 'function' && hids.length){
      showActionToast(toast,{type:'add-samples',hids,openAction:false});
    }else if(typeof showToast === 'function'){
      showToast(toast);
    }
  }
  return true;
}

// PURE: home city has usable coords for prayer timing.
function hasHomeCityCoords(settings){
  const s = settings || sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  return Number.isFinite(s.homeCityLat) && Number.isFinite(s.homeCityLng);
}

// HYBRID: open Settings → Locations with the city field focused (prayer sample gate).
function openHomeCitySettings(){
  closeSheet('sample-habits-sheet');
  closeSheet('about-sheet');
  if(typeof resetSettingsSheetState === 'function')resetSettingsSheetState();
  if(typeof syncSettingsControls === 'function')syncSettingsControls();
  openSheet('settings-sheet');
  const head = $('settings-locations-head');
  const body = $('settings-locations-body');
  if(body)body.hidden = false;
  if(head)head.setAttribute('aria-expanded','true');
  const input = $('home-city-input');
  if(input){
    try{ input.focus({preventScroll:false}); }catch(_){ input.focus(); }
    if(typeof input.scrollIntoView === 'function')input.scrollIntoView({block:'center', behavior:'smooth'});
  }
}

// PURE: a sample habit needs the home city when any endpoint uses a
// prayer/dynamic anchor (sunrise/sunset/Fajr/etc.) — those windows resolve
// against the general location, same as the daily prayers.
function sampleUsesDynamicTimes(h){
  return typeof habitUsesPrayerAnchors === 'function' && habitUsesPrayerAnchors(h);
}

// HYBRID: dynamic-time samples need a home city before add. Opens the city
// flow when missing.
function ensureHomeCityForDynamicSamples(){
  if(hasHomeCityCoords())return true;
  if(typeof showToast === 'function'){
    showToast('set your city in Settings → Locations first');
  }
  openHomeCitySettings();
  return false;
}

// HANDLER: add a single feature or prayer sample (sheet stays open)
function addOneSample(hid){
  const sample = findCatalogSample(hid);
  if(!sample)return false;
  const isPrayer = String(hid || '').startsWith('sample-prayer-');
  if(sampleUsesDynamicTimes(sample) && !ensureHomeCityForDynamicSamples())return false;
  sample.sample = false;
  if(typeof sample.name === 'string' && sample.name.startsWith('Sample: ')){
    sample.name = sample.name.slice('Sample: '.length);
  }
  const label = sampleDisplayName(sample) || 'sample';
  return commitSampleHabits([sample],{
    setPresence:!isPrayer,
    closeSheets:false,
    toast:`added · ${label}`
  });
}

// HANDLER: add feature-tour sample habits (+ seed sample locations)
function addSortSamples({closeSheets = true} = {}){
  const have = new Set(load().map(h => h.hid).filter(Boolean));
  const samples = buildSortSamples().filter(h => !have.has(h.hid));
  if(!samples.length){
    if(typeof showToast === 'function')showToast('feature demos already on home');
    refreshSampleHabitsSheet();
    return;
  }
  if(samples.some(sampleUsesDynamicTimes) && !ensureHomeCityForDynamicSamples())return;
  commitSampleHabits(samples,{
    setPresence:true,
    closeSheets,
    toast: closeSheets
      ? `samples added · keep any you want · sample tag`
      : `${samples.length} demos added`
  });
}

// HANDLER: add optional daily prayer samples (home city required; no sample places)
function addPrayerSamples({closeSheets = true} = {}){
  if(!ensureHomeCityForDynamicSamples())return;
  const have = new Set(load().map(h => h.hid).filter(Boolean));
  const samples = buildPrayerSamples().filter(h => !have.has(h.hid));
  if(!samples.length){
    if(typeof showToast === 'function')showToast('prayer samples already on home');
    refreshSampleHabitsSheet();
    return;
  }
  commitSampleHabits(samples,{
    setPresence:false,
    closeSheets,
    toast: closeSheets
      ? 'prayer samples added · keep any you want'
      : `${samples.length} prayers added`
  });
}

// HANDLER: adopt a sample as a real habit
function keepSampleHabit(idx){
  const data = load();
  const h = data[idx];
  if(!h || !h.sample)return false;
  h.sample = false;
  if(typeof h.name === 'string' && h.name.startsWith('Sample: ')){
    h.name = h.name.slice('Sample: '.length);
  }
  if(!save(data))return false;
  if(typeof showToast === 'function')showToast('kept · now one of yours');
  updateSortSampleCount();
  if(typeof detailIdx === 'number' && detailIdx === idx && typeof openDetail === 'function')openDetail(idx);
  if(typeof render === 'function')render();
  return true;
}

// HYBRID: drop unused sample-* places/travel from settings; return reconciled habits
function pruneUnusedSamplePlaces(habits){
  const next = habits || [];
  const usedIds = new Set();
  next.forEach(h=>(h.locationIds || []).forEach(id=>{ if(id)usedIds.add(id); }));
  next.forEach(h=>{ if(h.preferredLocationId)usedIds.add(h.preferredLocationId); });
  const locations = normalizeLocationRegistry(sortSettings.locations)
    .filter(loc=>{
      const id = loc.id || '';
      if(!id.startsWith('sample-'))return true;
      return usedIds.has(id);
    });
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    const a = String(edge.a || '');
    const b = String(edge.b || '');
    if(a.startsWith('sample-') && !usedIds.has(a))continue;
    if(b.startsWith('sample-') && !usedIds.has(b))continue;
    travel[key] = edge;
  }
  const lastKnown = (sortSettings.lastKnownLocationId || '').startsWith('sample-')
    && !usedIds.has(sortSettings.lastKnownLocationId)
    ? null
    : sortSettings.lastKnownLocationId;
  updateSortSetting({locations,travel,lastKnownLocationId:lastKnown},{renderNow:false,sync:false});
  return reconcileLocations(next,{...sortSettings,locations,travel}).data;
}

// HANDLER: remove remaining sample habits (+ drop unused sample-* locations)
function removeSortSamples(){
  const current = load();
  const next = current.filter(h=>!h.sample);
  if(next.length === current.length){
    if(typeof showToast === 'function')showToast('no samples');
    updateSortSampleCount();
    return;
  }
  const reconciled = pruneUnusedSamplePlaces(next);
  if(save(reconciled)){
    updateSortSampleCount();
    syncSettingsControls();
    if(typeof refreshSampleHabitsSheet === 'function')refreshSampleHabitsSheet();
    if(typeof render === 'function')render();
    if(typeof showToast === 'function')showToast('samples removed');
  }
}

// RENDER: sync range field value and label
function syncSettingRange(name,value,suffix){
  const field = $(`setting-${name}`);
  const label = $(`setting-${name}-label`);
  if(!field || !label)return;
  field.value = value;
  if(name === 'rhythm-bias'){
    const num = parseInt(value,10) || 0;
    label.textContent = num === 0 ? 'even' : num > 0 ? `short +${num}` : `long +${Math.abs(num)}`;
  }else{
    label.textContent = `${value}${suffix}`;
  }
}

// WIRE: attach input and change listeners to range
function bindSettingRange(name,key,suffix,options = {}){
  const field = $(`setting-${name}`);
  if(!field)return;
  field.addEventListener('input',e=>{
    const value = parseInt(e.target.value,10);
    syncSettingRange(name,value,suffix);
    const patch = {[key]:value};
    if(options.custom !== false && isSortSettingKey(key))patch.preset = 'custom';
    updateSortSetting(patch,{sync:false,renderNow:false});
  });
  field.addEventListener('change',()=>{
    render();
  });
}

// ── Appearance ──────────────────────────────────────────────────────────
function isMinimalMode(){
  return Boolean(sortSettings && sortSettings.minimalMode);
}

function applyAppearanceSettings(){
  const s = sortSettings || {};
  document.body.classList.toggle('compact-mode', !!s.compactMode);
  document.body.classList.toggle('minimal-mode', !!s.minimalMode);
  document.documentElement.dataset.fontScale = s.fontScale || 'medium';
  const mode = s.themeMode || 'system';
  if(mode === 'system')document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = mode;
  if(typeof applyDetailMinimalMode === 'function')applyDetailMinimalMode();
  applyAddMinimalMode();
}

// Visual-only: collapse add-sheet chrome (emoji bg, more options) in minimal mode.
function applyAddMinimalMode(){
  const minimal = isMinimalMode();
  const sheet = $('add-sheet');
  if(sheet)sheet.classList.toggle('minimal-add', minimal);
  if(!minimal)return;
  const body = $('add-more-options');
  const toggle = $('add-more-toggle');
  if(body)body.hidden = true;
  if(toggle)toggle.setAttribute('aria-expanded','false');
}

// ── Home city (general area for prayer, weather, etc.) ───────────────────
function syncHomeCityStatus(){
  const el = $('home-city-status');
  if(!el)return;
  if(sortSettings.homeCityName && Number.isFinite(sortSettings.homeCityLat)){
    el.textContent = `${sortSettings.homeCityName} (${sortSettings.homeCityLat.toFixed(2)}, ${sortSettings.homeCityLng.toFixed(2)})`;
  }else{
    el.textContent = 'No city set.';
  }
}

// ASYNC: if home city is unset, set it from a place's coordinates (reverse
// geocode → "City, Country"). Never overwrites an existing city. Used when
// the user adds a place so they don't also have to type a general city.
async function maybeInferHomeCityFromPlace(lat,lng){
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return false;
  let name = 'Home area';
  try{
    if(typeof reverseGeocodeCity === 'function'){
      const city = await reverseGeocodeCity(lat,lng);
      if(city && city.name)name = city.name;
    }
  }catch{ /* keep fallback name */ }
  // User may have set a city while the reverse lookup was in flight.
  if(typeof hasHomeCityCoords === 'function' ? hasHomeCityCoords() : (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng))){
    return false;
  }
  updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  syncHomeCityStatus();
  if(typeof showToast === 'function')showToast(`city: ${name}`);
  return true;
}

async function setHomeCity(){
  const input = $('home-city-input');
  if(!input)return;
  const query = input.value.trim();
  if(!query)return;
  const status = $('home-city-status');
  if(status)status.textContent = 'Looking up…';
  try{
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1`);
    const json = await res.json();
    const feat = json.features && json.features[0];
    if(!feat){
      if(status)status.textContent = 'City not found. Try a different spelling.';
      return;
    }
    const [lng,lat] = feat.geometry.coordinates;
    const name = feat.properties.name || query;
    updateSortSetting({homeCityName:name, homeCityLat:lat, homeCityLng:lng});
    if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
    input.value = '';
    syncHomeCityStatus();
    if(typeof showToast === 'function')showToast(`city: ${name}`);
  }catch(_){
    if(status)status.textContent = 'Lookup failed. Check your connection.';
  }
}

// PURE: blocked-time blocks whose prayer anchors resolve only via the home
// city (no place on the block) — clearing the city would silently freeze them
// to their fixed fallback clock.
function blocksUsingHomeCity(){
  const blocks = typeof normalizeBlockedTimes === 'function'
    ? normalizeBlockedTimes(sortSettings && sortSettings.blockedTimes)
    : (Array.isArray(sortSettings && sortSettings.blockedTimes) ? sortSettings.blockedTimes : []);
  return blocks.filter(b =>
    !b.locationId && (cleanPrayerAnchor(b.startAnchor) || cleanPrayerAnchor(b.endAnchor))
  );
}

function clearHomeCity(){
  const users = habitsUsingHomeCity();
  if(users.length){
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast("can't clear city — still used by", users));
    }
    return;
  }
  const blocks = blocksUsingHomeCity();
  if(blocks.length){
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast("can't clear city — busy time needs it", blocks));
    }
    return;
  }
  updateSortSetting({homeCityName:'', homeCityLat:null, homeCityLng:null});
  if(typeof clearPrayerTimesCache === 'function')clearPrayerTimesCache();
  syncHomeCityStatus();
}

// ── Default topics chips ────────────────────────────────────────────────
function renderDefaultTopicsChips(){
  const wrap = $('default-topics-chips');
  if(!wrap)return;
  const allTopics = Array.isArray(sortSettings.topics) ? sortSettings.topics : [];
  const selected = Array.isArray(sortSettings.defaultTopics) ? sortSettings.defaultTopics : [];
  if(!allTopics.length){
    wrap.innerHTML = '<p class="field-hint">Add topics in the Topics section first.</p>';
    return;
  }
  wrap.innerHTML = allTopics.map(t=>{
    const on = selected.includes(t);
    return `<button type="button" class="topic-filter${on ? ' on' : ''}" data-topic="${escapeHtml(t)}">${escapeHtml(t)}</button>`;
  }).join('');
}

function toggleDefaultTopic(topic){
  const current = Array.isArray(sortSettings.defaultTopics) ? [...sortSettings.defaultTopics] : [];
  const idx = current.indexOf(topic);
  if(idx >= 0)current.splice(idx,1);
  else current.push(topic);
  updateSortSetting({defaultTopics:current});
  renderDefaultTopicsChips();
}
