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
  selectedType = settings.defaultType || 'keepup';
  const target = clampRhythm(settings.defaultTarget || 7);
  syncRhythm('ting',target);
  renderTagChips('ting-tag-chips',[],[],null);
  const topicsWrap = $('add-topics-section');
  if(topicsWrap)topicsWrap.hidden = false;
  document.querySelectorAll('#type-seg .seg-opt').forEach(o=>o.classList.toggle('on',o.dataset.v === selectedType));
  const dueInput = $('ting-due-date');
  const timeInput = $('ting-due-time');
  if(dueInput)dueInput.value = '';
  if(timeInput)timeInput.value = '';
  if($('ting-auto-mark'))$('ting-auto-mark').value = '';
  document.querySelectorAll('#ting-priority-seg .seg-opt').forEach(o=>o.classList.toggle('on',parseInt(o.dataset.priority,10) === DEFAULT_PRIORITY));
  const moreBody = $('add-more-options');
  const moreToggle = $('add-more-toggle');
  if(moreBody)moreBody.hidden = true;
  if(moreToggle)moreToggle.setAttribute('aria-expanded','false');
  syncAddTypeUi(selectedType);
  if(typeof clearEmojiSuggestion === 'function')clearEmojiSuggestion();
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
  renderAvailabilityControls();
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

function clearCalendarPdfPreview({keepStatus = true} = {}){
  pendingCalendarEvents = null;
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

function formatCalendarEventPreview(ev, allDayMode){
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
  return `<li><strong>${escapeHtml(ev.subject || 'untitled')}</strong><span>${escapeHtml(when)}</span></li>`;
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
      const label = `${h.emoji ? `${h.emoji} ` : ''}${h.name || 'untitled'}${h.breakable ? '' : ' (will mark breakable)'}`;
      return `<option value="${escapeHtml(h.hid)}"${h.hid === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
  );
  select.innerHTML = options.join('');
  const hint = $('calendar-credit-hint');
  if(hint){
    hint.textContent = habits.length
      ? 'Pick a keepup/reduce habit (like Work). Meeting minutes are credited toward its daily duration; overlapping meetings merge. Non-breakable habits are marked breakable when credited.'
      : 'No keepup/reduce habits with a duration yet. Add Work (or similar) with daily hours to credit meetings against it.';
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
  const settings = sortSettings || loadSortSettings();
  const mode = normalizeCalendarAllDayMode(settings.calendarAllDayMode);
  const timed = pendingCalendarEvents.filter(e=>!e.isAllDay).length;
  const allDay = pendingCalendarEvents.length - timed;
  const preview = $('calendar-pdf-preview');
  const actions = $('calendar-pdf-actions');
  const status = $('calendar-pdf-status');
  if(preview){
    preview.hidden = false;
    const summary = allDay
      ? `${pendingCalendarEvents.length} event${pendingCalendarEvents.length === 1 ? '' : 's'} found · ${timed} timed · ${allDay} all-day (${mode === 'skip' ? 'will skip' : 'will import'})`
      : `${pendingCalendarEvents.length} meeting${pendingCalendarEvents.length === 1 ? '' : 's'} found`;
    preview.innerHTML = `<p class="field-hint">${escapeHtml(summary)}</p><ul class="calendar-pdf-list">${pendingCalendarEvents.map(ev=>formatCalendarEventPreview(ev, mode)).join('')}</ul>`;
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
  const result = applyCalendarImport(pendingCalendarEvents, {
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
    parts.push(`credited ${hrsLabel} to ${result.creditHabitName}`);
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

// RENDER: draw weekday availability inputs
function renderAvailabilityControls(){
  const wrap = $('availability-grid');
  if(!wrap)return;
  const availability = normalizeAvailability(sortSettings.availabilityMinutes);
  wrap.innerHTML = WEEKDAY_LABELS.map((label,i)=>`
    <label>
      <span>${label}</span>
      <input type="number" min="0" max="1440" inputmode="numeric" data-availability-day="${i}" value="${availability[i]}" />
    </label>
  `).join('');
}

// HANDLER: save edited availability day value
function saveAvailabilityDay(index,value){
  const availability = normalizeAvailability(sortSettings.availabilityMinutes);
  availability[index] = Math.max(0,Math.min(1440,parseInt(value,10) || 0));
  updateSortSetting({availabilityMinutes:availability},{renderNow:false});
  renderAvailabilityControls();
  render();
  if(dayLogsKey && $('day-logs-sheet').classList.contains('open'))renderDayAvailability(dayLogsKey);
}

// PURE: <option> list for a blocked-time prayer-anchor picker.
// When `allowFixed` is true (secondary B row), include a clock-time option.
function blockedAnchorOptions(selected, allowFixed = false){
  const prayer = cleanPrayerAnchor(selected) || '';
  const isFixed = allowFixed && selected === 'fixed';
  let html = '<option value="">— anchor —</option>'
    + PRAYER_ANCHORS.map(a => `<option value="${a}"${a === prayer ? ' selected' : ''}>${PRAYER_ANCHOR_LABELS[a]}</option>`).join('');
  if(allowFixed){
    html += `<option value="fixed"${isFixed ? ' selected' : ''}>clock time…</option>`;
  }
  return html;
}

// PURE: live preview text for one blocked-time endpoint (resolved clock time,
// or a muted hint when the anchor can't resolve yet).
function blockedResolvedLabel(block, field){
  if(!block || !cleanPrayerAnchor(block[field + 'Anchor']))return '';
  if(!block.locationId)return 'pick a location';
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
    ['', 'just this'],
    ['later', 'later of…'],
    ['earlier', 'earlier of…']
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
        <button type="button" class="time-day-next mini-text-btn" data-blocked-${field}-day="${i}" aria-pressed="${dayOn ? 'true' : 'false'}" title="use next day's prayer" aria-label="next day">+1d</button>
      </div>
      <select class="time-combine mini-select" data-blocked-${field}-combine="${i}" aria-label="${aria} combine">${blockedCombineOptions(combine)}</select>
      <div class="time-expr time-expr2"${combine ? '' : ' hidden'}>
        <select class="time-anchor2 mini-select" data-blocked-${field}-anchor2="${i}" aria-label="${aria} second anchor">${blockedAnchorOptions(anchor2, true)}</select>
        <input type="time" class="time-fixed2" step="900" data-blocked-${field}-fixed2="${i}" aria-label="${aria} clock time" value="${fixed2Val}"${isFixed2 ? '' : ' hidden'} />
        <input type="number" class="time-offset2 mini-time-input" inputmode="numeric" placeholder="0" data-blocked-${field}-offset2="${i}" aria-label="${aria} second offset minutes" value="${Math.abs(offset2Val)}"${isFixed2 ? ' hidden' : ''} />
        <button type="button" class="time-offset-sign-btn" tabindex="-1" data-sign="${offset2Val < 0 ? '-' : '+'}" aria-label="${offset2Val < 0 ? 'negative' : 'positive'} offset"${isFixed2 ? ' hidden' : ''}>${offset2Val < 0 ? '−' : '+'}</button>
        <span class="time-offset-unit"${isFixed2 ? ' hidden' : ''}>min</span>
        <button type="button" class="time-day-next2 mini-text-btn" data-blocked-${field}-day2="${i}" aria-pressed="${day2On ? 'true' : 'false'}" title="use next day's prayer" aria-label="next day"${isFixed2 ? ' hidden' : ''}>+1d</button>
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
      <input type="text" data-blocked-label="${i}" aria-label="blocked time name" maxlength="24" value="${escapeHtml(block.label)}" />
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
        <select data-blocked-location="${i}" aria-label="${escapeHtml(block.label)} location" class="mini-select">
          <option value="">no location</option>
          ${locs.map(loc=>`<option value="${escapeHtml(loc.id)}"${block.locationId === loc.id ? ' selected' : ''}>${escapeHtml(loc.label || loc.name)}</option>`).join('')}
        </select>
      </div>
      <button class="mini-text-btn" type="button" data-blocked-remove="${i}">remove</button>
    </div>
  `).join('') : '<p class="field-hint">No blocked time. The plan may use any open time today.</p>';
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
  blocks.push({label:'blocked',days:[],start:900,end:960});
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
    prefSet ? 'best time' : null
  ].filter(Boolean).join(' · ');
  return `<div class="location-row" data-location-row="${i}">
    <div class="location-row-head">
      <input type="text" class="location-name" data-loc-name="${i}" aria-label="location name" maxlength="48" value="${escapeHtml(loc.name)}" />
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
      <span class="loc-field-label">radius</span>
      <input type="number" data-loc-radius="${i}" aria-label="match radius in metres" min="10" max="2000" step="5" inputmode="numeric" value="${radius}" />
      <span class="loc-unit">m</span>
      <span class="loc-hint">how close counts as here</span>
    </div>
    <button class="mini-text-btn loc-more-toggle" type="button" data-loc-more="${i}" aria-expanded="${moreOpen}">${moreOpen ? '▾' : '▸'} more${moreSummary ? ` · ${moreSummary}` : ''}</button>
    <div class="location-more" data-location-more="${i}" ${moreOpen ? '' : 'hidden'}>
      <div class="location-days">
        <span class="loc-field-label">closed</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const on = closedSet.has(day);
          return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-loc-closed-day="${day}" data-loc-index="${i}" aria-pressed="${on}">${label}</button>`;
        }).join('')}
      </div>
      <div class="loc-pref">
        <span class="loc-field-label">best</span>
        <input type="time" step="900" data-loc-pref-start="${i}" aria-label="best from" value="${prefStart}" />
        <span class="loc-sep">–</span>
        <input type="time" step="900" data-loc-pref-end="${i}" aria-label="best until" value="${prefEnd}" />
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
  return id;
}

// HYBRID: remove a location, prune its travel edges, and sweep the dangling id
// off every habit (locationIds + preferredLocationId). Resets any location
// filter that pointed at it (Phase 5 globals, guarded).
function removeLocation(index){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const removed = locations[index];
  if(!removed)return;
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
    btn.innerHTML = (opening ? '▾' : '▸') + ' per-day hours &amp; best time';
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
  updateSortSetting(patch);
  if(key === 'agendaOptimizer' && patch.agendaOptimizer && typeof preloadAgendaOptimizer === 'function'){
    preloadAgendaOptimizer();
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

// RENDER: update sample count label text
function updateSortSampleCount(){
  const label = $('sort-sample-count');
  if(label)label.textContent = sortSampleCount() ? `${sortSampleCount()} sample habits currently in the list.` : 'No sample habits are in the list.';
}

// PURE: build a sample habit object
function sortSampleHabit(name,type,target,logs,options = {}){
  const locationIds = Array.isArray(options.locationIds) ? options.locationIds.map(cleanLocationId).filter(Boolean) : [];
  return {
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
    flexibilityDays:clampFlexibility(options.flexibilityDays),
    durationMinutes:clampDuration(options.durationMinutes),
    priority:options.priority != null ? clampPriority(options.priority) : undefined
  };
}

// PURE: NYC-area sample places — close enough that travel is visible but short.
// Stable ids so re-adding samples doesn't orphan habit references.
function buildSampleLocations(){
  return [
    {
      id:'sample-home', name:'Home', address:'West Village, NYC',
      lat:40.7359, lng:-74.0036, radiusM:100,
      emoji:'🏠'
    },
    {
      id:'sample-office', name:'Office', address:'Midtown, NYC',
      lat:40.7549, lng:-73.9840, radiusM:80,
      emoji:'🏢',
      allowedTimeStart:540, allowedTimeEnd:1080, // 9a–6p
      closedDays:[0,6]
    },
    {
      id:'sample-gym', name:'Gym', address:'Chelsea, NYC',
      lat:40.7465, lng:-73.9972, radiusM:75,
      emoji:'🏋️',
      allowedTimeStart:360, allowedTimeEnd:1320, // 6a–10p
      closedDays:[0],
      preferredTimeStart:420, preferredTimeEnd:540 // best early
    },
    {
      id:'sample-cafe', name:'Cafe', address:'East Village, NYC',
      lat:40.7265, lng:-73.9815, radiusM:60,
      emoji:'☕',
      allowedTimeStart:480, allowedTimeEnd:1020, // 8a–5p
      preferredTimeStart:840, preferredTimeEnd:960, // 2–4p off-peak
      hoursByDay:{6:{start:540,end:900}} // Sat 9a–3p
    },
    {
      id:'sample-moms', name:"Mom's house", address:'Park Slope, Brooklyn',
      lat:40.6701, lng:-73.9778, radiusM:90,
      emoji:'🏡',
      allowedTimeStart:660, allowedTimeEnd:1020 // 11a–5p
    },
    {
      // 24h second anchor so travel between places is visible even late at night.
      id:'sample-park', name:'Park', address:'Washington Square Park, NYC',
      lat:40.7308, lng:-73.9973, radiusM:120,
      emoji:'🌳'
    }
  ];
}

// PURE: build array of sample habits
function buildSortSamples(){
  const H = 'sample-home';
  const O = 'sample-office';
  const G = 'sample-gym';
  const C = 'sample-cafe';
  const M = 'sample-moms';
  const P = 'sample-park';
  return [
    sortSampleHabit('daily walk overdue','keepup',1,sampleLogs([9,7,5,2]),{emoji:'🚶',topics:['health'],durationMinutes:25,allowedTimeStart:390,allowedTimeEnd:600,locationIds:[H,P],preferredLocationId:P,priority:1}),
    sortSampleHabit('call family due soon','keepup',7,sampleLogs([34,21,14,6]),{emoji:'☎️',topics:['relationships'],allowedWeekdays:[2,4],locationIds:[H,M],preferredLocationId:M,durationMinutes:20,priority:1}),
    sortSampleHabit('movie night just done','keepup',7,sampleLogs([22,15,8,1]),{emoji:'🎬',topics:['rest'],allowedWeekdays:[5,6],durationMinutes:120,locationIds:[H]}),
    sortSampleHabit('new meditation habit','keepup',7,[],{emoji:'🧘',topics:['health','calm'],durationMinutes:10,locationIds:[H]}),
    sortSampleHabit('40 day habit mid cycle','keepup',40,sampleLogs([97,57,17]),{emoji:'🌿',topics:['home'],flexibilityDays:5,locationIds:[H]}),
    sortSampleHabit('do early because Tuesday is packed','keepup',2,sampleLogs([0]),{emoji:'🧺',topics:['home'],durationMinutes:50,flexibilityDays:2,locationIds:[H],priority:2}),
    sortSampleHabit('monthly date night close','keepup',30,sampleLogs([91,61,28]),{emoji:'💙',durationMinutes:150,flexibilityDays:4,topics:['relationships'],locationIds:[C,H],preferredLocationId:C}),
    sortSampleHabit('quarterly mini trip overdue','keepup',90,sampleLogs([190,91]),{emoji:'🧳',durationMinutes:240,flexibilityDays:14,topics:['adventure']}),
    sortSampleHabit('long flexible home reset','keepup',60,sampleLogs([180,122,68]),{emoji:'🧹',durationMinutes:45,flexibilityDays:10,topics:['home'],locationIds:[H],priority:2}),
    sortSampleHabit('planned today workout','keepup',3,sampleLogs([11,8,5],[0]),{emoji:'🏋️',topics:['health'],durationMinutes:40,locationIds:[G],priority:0}),
    sortSampleHabit('planned weekend check-in','keepup',14,sampleLogs([42,28,15],[3]),{emoji:'🗓️',topics:['planning'],allowedWeekdays:[0,6],locationIds:[H,C],preferredLocationId:C,durationMinutes:25}),
    sortSampleHabit('weekend-only yard work','keepup',7,sampleLogs([17,10]),{emoji:'🌱',allowedWeekdays:[0,6],durationMinutes:40,locationIds:[H]}),
    sortSampleHabit('first of month money review','keepup',30,sampleLogs([92,61,31]),{emoji:'💵',allowedMonthDays:[1],durationMinutes:45,locationIds:[H,O],preferredLocationId:H}),
    sortSampleHabit('15th-only insurance paperwork','keepup',30,sampleLogs([104,74,44]),{emoji:'📄',allowedMonthDays:[15],topics:['admin'],durationMinutes:35,locationIds:[O]}),
    sortSampleHabit('weekday guitar practice with long title','keepup',2,sampleLogs([12,9,6,3]),{emoji:'🎸',allowedWeekdays:[1,2,3,4,5],preferredWeekdays:[1,3,5],topics:['creative','practice'],durationMinutes:20,locationIds:[H]}),
    sortSampleHabit('pinned water habit','keepup',1,sampleLogs([4,3,1]),{emoji:'💧',pinned:true,topics:['health']}),
    sortSampleHabit('slipping reading rhythm','keepup',7,sampleLogs([45,34,23,13,8]),{emoji:'📖',topics:['learning'],locationIds:[C,H],preferredLocationId:C,durationMinutes:30}),
    sortSampleHabit('improving stretch routine','keepup',7,sampleLogs([32,20,11,5,1]),{emoji:'🤸',topics:['health'],durationMinutes:15,locationIds:[G,H],preferredLocationId:G}),
    sortSampleHabit('video games too recent','reduce',7,sampleLogs([1]),{emoji:'🎮',topics:['screen time'],locationIds:[H]}),
    sortSampleHabit('limit habit too often','reduce',7,sampleLogs([5,3,1]),{emoji:'🎯',topics:['focus'],allowedWeekdays:[1,3,5],locationIds:[O]}),
    sortSampleHabit('takeout good spacing','reduce',14,sampleLogs([42,25,18]),{emoji:'🥡',topics:['food','budget'],locationIds:[C]}),
    sortSampleHabit('social media ready to review','reduce',3,sampleLogs([11,8,5]),{emoji:'📱',topics:['screen time'],durationMinutes:15}),
    sortSampleHabit('late-night snacks close','reduce',5,sampleLogs([9,6,3]),{emoji:'🍪',topics:['food'],locationIds:[H]}),
    sortSampleHabit('coffee only on office days','reduce',2,sampleLogs([6,4,2]),{emoji:'☕',topics:['health'],allowedWeekdays:[1,3],durationMinutes:5,locationIds:[O,C],preferredLocationId:O}),
    sortSampleHabit('stop smoking reset today','zero',null,sampleLogs([0]),{emoji:'🚭'}),
    sortSampleHabit('no soda clear stretch','zero',null,sampleLogs([35,18]),{emoji:'🥤',topics:['health']}),
    sortSampleHabit('old stop habit no entries','zero',null,[],{emoji:'⛔',topics:['avoid']}),
    sortSampleHabit('snoozed build habit','keepup',7,sampleLogs([12]),{emoji:'😴',snoozedUntil:samplePlan(3,8),topics:['rest'],locationIds:[H]}),
    sortSampleHabit('overdue hard-deadline task','task',null,[],{emoji:'⚠️',dueDate:sampleActual(2),hardDue:true,topics:['admin'],durationMinutes:20,locationIds:[O],priority:0}),
    sortSampleHabit('task due today','task',null,[],{emoji:'📞',dueDate:sampleActual(0),topics:['relationships'],durationMinutes:15,locationIds:[H,M],preferredLocationId:H,priority:1}),
    sortSampleHabit('task due next week','task',null,[],{emoji:'📝',dueDate:samplePlan(6),topics:['learning'],durationMinutes:45,flexibilityDays:3,locationIds:[C]}),
    sortSampleHabit('busy target errand','task',null,[],{emoji:'📦',dueDate:samplePlan(2,10),topics:['admin'],durationMinutes:40,locationIds:[O],priority:2}),
    sortSampleHabit('busy target paperwork','task',null,[],{emoji:'🗂️',dueDate:samplePlan(2,14),topics:['admin'],durationMinutes:40,locationIds:[O],priority:2}),
    sortSampleHabit('busy target call','task',null,[],{emoji:'📱',dueDate:samplePlan(2,16),topics:['admin'],durationMinutes:25,locationIds:[H,O],preferredLocationId:H,priority:3}),
    sortSampleHabit('someday task no date','task',null,[],{emoji:'🗂️',topics:['someday']}),
    sortSampleHabit('dentist appointment task','task',null,[],{emoji:'🦷',eventTime:Date.now() + 4 * 3600000,dueDate:dayStart(Date.now()),durationMinutes:60,topics:['health'],locationIds:[O],priority:0}),
    sortSampleHabit('grocery run today','task',null,[],{emoji:'🛒',dueDate:sampleActual(0),durationMinutes:25,topics:['home'],locationIds:[C],priority:2}),
    sortSampleHabit('gym session due','keepup',2,sampleLogs([5,3]),{emoji:'💪',topics:['health'],durationMinutes:35,locationIds:[G],priority:1}),
    // Evening-friendly pair (both 24h) so travel cards show even after shops close.
    // Short + high priority so they still fit when only a thin late-night slot remains.
    sortSampleHabit('evening park stroll','task',null,[],{emoji:'🌙',dueDate:sampleActual(0),durationMinutes:12,topics:['health','rest'],locationIds:[P],priority:0}),
    sortSampleHabit('tidy desk tonight','task',null,[],{emoji:'🧹',dueDate:sampleActual(0),durationMinutes:12,topics:['home'],locationIds:[H],priority:0})
  ];
}

// HANDLER: add sample habits to list (+ seed sample locations into the registry)
function addSortSamples(){
  const current = load().filter(h=>!h.sample);
  const samples = buildSortSamples();
  if(current.length + samples.length > MAX_TINGS){
    alert(`${MAX_TINGS} habits max`);
    return;
  }
  // Merge sample places into the registry (stable ids → idempotent re-add).
  const sampleLocs = buildSampleLocations();
  const existing = normalizeLocationRegistry(sortSettings.locations);
  const byId = new Map(existing.map(l=>[l.id,l]));
  sampleLocs.forEach(loc=>{ if(!byId.has(loc.id))byId.set(loc.id,loc); });
  const locations = normalizeLocationRegistry([...byId.values()]);
  // Patch blocked times so each section gets an appropriate sample location.
  const BLOCK_LOCATION = {
    sleep:'sample-home', breakfast:'sample-home', dinner:'sample-home',
    work:'sample-office', lunch:'sample-office'
  };
  const patchedBlocks = normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>{
    const label = (b.label || '').toLowerCase();
    const loc = BLOCK_LOCATION[label];
    if(loc && !b.locationId)return {...b,locationId:loc};
    return b;
  });
  // Collect topics from sample habits into the global topic list.
  const existingTopics = new Set(normalizeTopics(sortSettings.topics || []));
  samples.forEach(h=>(h.topics || []).forEach(t=>{ if(t)existingTopics.add(t); }));
  const topics = normalizeTopics([...existingTopics]);
  updateSortSetting({
    locations,
    topics,
    lastKnownLocationId:sortSettings.lastKnownLocationId || 'sample-home',
    showLocationOnCards:true,
    defaultTravelMode:sortSettings.defaultTravelMode || 'walking',
    blockedTimes:patchedBlocks
  },{renderNow:false,sync:false});
  const next = [...current,...samples].map(h=>({...h,lastLog:latestActualLog(h.logs)}));
  if(save(next)){
    updateSortSampleCount();
    syncSettingsControls();
    closeSheet('settings-sheet');
    render();
    const topicCount = topics.length;
    showToast(`samples added · 6 places · ${topicCount} topic${topicCount === 1 ? '' : 's'}`);
  }
}

// HANDLER: remove sample habits from list (+ drop sample-* locations)
function removeSortSamples(){
  const current = load();
  const next = current.filter(h=>!h.sample);
  if(next.length === current.length){
    showToast('no samples');
    return;
  }
  const locations = normalizeLocationRegistry(sortSettings.locations)
    .filter(loc=>!(loc.id || '').startsWith('sample-'));
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    if(!(String(edge.a || '').startsWith('sample-') || String(edge.b || '').startsWith('sample-')))travel[key] = edge;
  }
  const lastKnown = (sortSettings.lastKnownLocationId || '').startsWith('sample-')
    ? null
    : sortSettings.lastKnownLocationId;
  updateSortSetting({locations,travel,lastKnownLocationId:lastKnown},{renderNow:false,sync:false});
  const reconciled = reconcileLocations(next,{...sortSettings,locations,travel});
  if(save(reconciled.data)){
    updateSortSampleCount();
    syncSettingsControls();
    render();
    showToast('samples removed');
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
