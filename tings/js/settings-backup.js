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

