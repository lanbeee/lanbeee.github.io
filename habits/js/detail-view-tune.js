function currentDetailTune(){
  const mainType = document.querySelector('#detail-type-seg .seg-opt.on')?.dataset.detailType || 'keepup';
  let type;
  if(mainType === 'task'){
    type = 'task';
  }else{
    const mode = document.querySelector('#detail-mode-seg .seg-opt.on')?.dataset.mode || 'build';
    type = modeToType(mode);
  }
  const locationIds = selectedLocationIdsFrom('detail-tag-chips');
  const locationPrefs = selectedLocationPrefsFrom('detail-tag-chips');
  const subjectHid = detailIdx != null ? cleanHabitId(load()[detailIdx]?.hid) : '';
  return {
    name:$('detail-habit-message').value.trim(),
    type,
    emoji:cleanMark($('detail-emoji').value),
    emojiBgColor:selectedEmojiBgColor('detail-emoji-bg'),
    target:currentRhythmTarget('detail'),
    pinned:$('detail-pinned').getAttribute('aria-pressed') === 'true',
    links:currentDetailLinks(),
    topics:selectedTopicsFrom('detail-tag-chips'),
    locationIds,
    anywhereAllowed:selectedAnywhereFrom('detail-tag-chips'),
    locationPrefs,
    preferredLocationId:primaryPreferredLocationId(locationPrefs,locationIds),
    allowedWeekdays:selectedWeekdaysFrom('detail-weekday-chips'),
    allowedMonthDays:selectedMonthDaysFrom('detail-monthday-chips'),
    preferredWeekdays:selectedWeekdaysFrom('detail-preferred-weekday-chips'),
    preferredMonthDays:selectedMonthDaysFrom('detail-preferred-monthday-chips'),
    allowedTimeStart:timeInputToMinutes($('detail-time-start').value),
    allowedTimeEnd:timeInputToMinutes($('detail-time-end').value),
    preferredTimeStart:timeInputToMinutes($('detail-preferred-time-start').value),
    preferredTimeEnd:timeInputToMinutes($('detail-preferred-time-end').value),
    allowedTimeStartAnchor:readAnchorFromEndpoint('detail-time-start'),
    allowedTimeStartOffsetMin:readOffsetFromEndpoint('detail-time-start'),
    allowedTimeEndAnchor:readAnchorFromEndpoint('detail-time-end'),
    allowedTimeEndOffsetMin:readOffsetFromEndpoint('detail-time-end'),
    preferredTimeStartAnchor:readAnchorFromEndpoint('detail-preferred-time-start'),
    preferredTimeStartOffsetMin:readOffsetFromEndpoint('detail-preferred-time-start'),
    preferredTimeEndAnchor:readAnchorFromEndpoint('detail-preferred-time-end'),
    preferredTimeEndOffsetMin:readOffsetFromEndpoint('detail-preferred-time-end'),
    allowedTimeStartAnchorHabitId:readHabitIdFromEndpoint('detail-time-start'),
    allowedTimeEndAnchorHabitId:readHabitIdFromEndpoint('detail-time-end'),
    preferredTimeStartAnchorHabitId:readHabitIdFromEndpoint('detail-preferred-time-start'),
    preferredTimeEndAnchorHabitId:readHabitIdFromEndpoint('detail-preferred-time-end'),
    scheduleLinks:readScheduleLinksFromDetail(subjectHid),
    ...(() => {
      const c = readCombineFromEndpoint('detail-time-start');
      return {
        allowedTimeStartCombine:c.combine, allowedTimeStartAnchor2:c.anchor2,
        allowedTimeStartOffsetMin2:c.offset2, allowedTimeStartAnchorHabitId2:c.habitId2,
        allowedTimeStartFixedMin2:c.fixedMin2,
        allowedTimeStartDayOffset:c.dayOffset, allowedTimeStartDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-time-end');
      return {
        allowedTimeEndCombine:c.combine, allowedTimeEndAnchor2:c.anchor2,
        allowedTimeEndOffsetMin2:c.offset2, allowedTimeEndAnchorHabitId2:c.habitId2,
        allowedTimeEndFixedMin2:c.fixedMin2,
        allowedTimeEndDayOffset:c.dayOffset, allowedTimeEndDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-preferred-time-start');
      return {
        preferredTimeStartCombine:c.combine, preferredTimeStartAnchor2:c.anchor2,
        preferredTimeStartOffsetMin2:c.offset2, preferredTimeStartAnchorHabitId2:c.habitId2,
        preferredTimeStartFixedMin2:c.fixedMin2,
        preferredTimeStartDayOffset:c.dayOffset, preferredTimeStartDayOffset2:c.dayOffset2
      };
    })(),
    ...(() => {
      const c = readCombineFromEndpoint('detail-preferred-time-end');
      return {
        preferredTimeEndCombine:c.combine, preferredTimeEndAnchor2:c.anchor2,
        preferredTimeEndOffsetMin2:c.offset2, preferredTimeEndAnchorHabitId2:c.habitId2,
        preferredTimeEndFixedMin2:c.fixedMin2,
        preferredTimeEndDayOffset:c.dayOffset, preferredTimeEndDayOffset2:c.dayOffset2
      };
    })(),
    durationMinutes:clampDuration($('detail-duration').value),
    breakable:$('detail-breakable')?.getAttribute('aria-pressed') === 'true',
    minChunkMinutes:clampMinChunk($('detail-min-chunk')?.value),
    timerAutoStopMinutes:normalizeTimerAutoStop($('detail-timer-auto-stop')?.value),
    autoMarkMinutes:normalizeAutoMark($('detail-auto-mark')?.value),
    trackValue:$('detail-track-value')?.getAttribute('aria-pressed') === 'true',
    flexibilityDays:clampFlexibility($('detail-flexibility').value),
    priority:clampPriority(document.querySelector('#detail-priority-seg .seg-opt.on')?.dataset.priority),
    dueDate:parseDateInput($('detail-due-date').value),
    eventTime:parseTaskWhen($('detail-due-date').value,$('detail-due-time')?.value || ''),
    planByDate:parseDateInput($('detail-plan-by-date')?.value || '')
  };
}

function syncBreakableUi(){
  const on = $('detail-breakable')?.getAttribute('aria-pressed') === 'true';
  const row = $('detail-min-chunk-row');
  if(row)row.hidden = !on;
  const autoValue = normalizeAutoMark($('detail-auto-mark')?.value);
  const autoOn = autoValue !== null;
  const label = $('detail-auto-mark-label');
  const summary = $('detail-auto-mark-summary');
  const unit = $('detail-auto-mark-unit');
  const inputWrap = $('detail-auto-mark')?.closest('.range-value');
  if(label)label.textContent = on ? 'auto-log agenda chunks' : 'auto mark done';
  // Keep the compact "min" unit; after/later belongs in the summary copy.
  if(unit)unit.textContent = 'min';
  if(summary){
    summary.textContent = on
      ? (autoOn
        ? `Each placed chunk logs ${autoValue ? `${autoValue} min after` : 'when'} it ends. Manual taps count first.`
        : 'Blank keeps chunk logging manual.')
      : (autoOn
        ? `Logs automatically ${autoValue ? `${autoValue} min after` : 'at'} its trigger.`
        : 'Blank keeps this manual.');
  }
  if(inputWrap){
    inputWrap.setAttribute('aria-label',on
      ? 'agenda chunk auto-log delay in minutes, blank is manual'
      : 'auto mark done delay in minutes, blank is manual');
  }
}

// HYBRID: compares form to original, toggles dirty class
function setDetailDirty(force){
  const sheet = getSheetInner('detail-sheet');
  const current = currentDetailTune();
  const dirty = force ?? (
    detailTuneOriginal &&
    (current.name !== detailTuneOriginal.name ||
      current.type !== detailTuneOriginal.type ||
      current.emoji !== detailTuneOriginal.emoji ||
      current.emojiBgColor !== detailTuneOriginal.emojiBgColor ||
      String(current.target) !== String(detailTuneOriginal.target) ||
      current.pinned !== detailTuneOriginal.pinned ||
      JSON.stringify(current.links || []) !== JSON.stringify(detailTuneOriginal.links || []) ||
      current.durationMinutes !== detailTuneOriginal.durationMinutes ||
      current.flexibilityDays !== detailTuneOriginal.flexibilityDays ||
      current.priority !== detailTuneOriginal.priority ||
      current.dueDate !== detailTuneOriginal.dueDate ||
      current.eventTime !== detailTuneOriginal.eventTime ||
      current.planByDate !== detailTuneOriginal.planByDate ||
      current.autoMarkMinutes !== detailTuneOriginal.autoMarkMinutes ||
      current.topics.join('|') !== detailTuneOriginal.topics.join('|') ||
      current.locationIds.join('|') !== (detailTuneOriginal.locationIds || []).join('|') ||
      current.anywhereAllowed !== Boolean(detailTuneOriginal.anywhereAllowed) ||
      JSON.stringify(current.locationPrefs || {}) !== JSON.stringify(detailTuneOriginal.locationPrefs || {}) ||
      (current.preferredLocationId || null) !== (detailTuneOriginal.preferredLocationId || null) ||
      current.breakable !== detailTuneOriginal.breakable ||
      current.minChunkMinutes !== detailTuneOriginal.minChunkMinutes ||
      current.timerAutoStopMinutes !== detailTuneOriginal.timerAutoStopMinutes ||
      current.trackValue !== detailTuneOriginal.trackValue ||
      current.allowedWeekdays.join('|') !== detailTuneOriginal.allowedWeekdays.join('|') ||
      current.allowedMonthDays.join('|') !== detailTuneOriginal.allowedMonthDays.join('|') ||
      current.preferredWeekdays.join('|') !== detailTuneOriginal.preferredWeekdays.join('|') ||
      current.preferredMonthDays.join('|') !== detailTuneOriginal.preferredMonthDays.join('|') ||
      current.allowedTimeStart !== detailTuneOriginal.allowedTimeStart ||
      current.allowedTimeEnd !== detailTuneOriginal.allowedTimeEnd ||
      current.preferredTimeStart !== detailTuneOriginal.preferredTimeStart ||
      current.preferredTimeEnd !== detailTuneOriginal.preferredTimeEnd ||
      current.allowedTimeStartAnchor !== detailTuneOriginal.allowedTimeStartAnchor ||
      current.allowedTimeStartOffsetMin !== detailTuneOriginal.allowedTimeStartOffsetMin ||
      current.allowedTimeEndAnchor !== detailTuneOriginal.allowedTimeEndAnchor ||
      current.allowedTimeEndOffsetMin !== detailTuneOriginal.allowedTimeEndOffsetMin ||
      current.preferredTimeStartAnchor !== detailTuneOriginal.preferredTimeStartAnchor ||
      current.preferredTimeStartOffsetMin !== detailTuneOriginal.preferredTimeStartOffsetMin ||
      current.preferredTimeEndAnchor !== detailTuneOriginal.preferredTimeEndAnchor ||
      current.preferredTimeEndOffsetMin !== detailTuneOriginal.preferredTimeEndOffsetMin ||
      (current.allowedTimeStartAnchorHabitId || null) !== (detailTuneOriginal.allowedTimeStartAnchorHabitId || null) ||
      (current.allowedTimeEndAnchorHabitId || null) !== (detailTuneOriginal.allowedTimeEndAnchorHabitId || null) ||
      (current.preferredTimeStartAnchorHabitId || null) !== (detailTuneOriginal.preferredTimeStartAnchorHabitId || null) ||
      (current.preferredTimeEndAnchorHabitId || null) !== (detailTuneOriginal.preferredTimeEndAnchorHabitId || null) ||
      JSON.stringify(current.scheduleLinks || []) !== JSON.stringify(detailTuneOriginal.scheduleLinks || []) ||
      (current.allowedTimeStartCombine || null) !== (detailTuneOriginal.allowedTimeStartCombine || null) ||
      (current.allowedTimeStartAnchor2 || null) !== (detailTuneOriginal.allowedTimeStartAnchor2 || null) ||
      current.allowedTimeStartOffsetMin2 !== detailTuneOriginal.allowedTimeStartOffsetMin2 ||
      (current.allowedTimeStartAnchorHabitId2 || null) !== (detailTuneOriginal.allowedTimeStartAnchorHabitId2 || null) ||
      (current.allowedTimeStartFixedMin2 ?? null) !== (detailTuneOriginal.allowedTimeStartFixedMin2 ?? null) ||
      current.allowedTimeStartDayOffset !== detailTuneOriginal.allowedTimeStartDayOffset ||
      current.allowedTimeStartDayOffset2 !== detailTuneOriginal.allowedTimeStartDayOffset2 ||
      (current.allowedTimeEndCombine || null) !== (detailTuneOriginal.allowedTimeEndCombine || null) ||
      (current.allowedTimeEndAnchor2 || null) !== (detailTuneOriginal.allowedTimeEndAnchor2 || null) ||
      current.allowedTimeEndOffsetMin2 !== detailTuneOriginal.allowedTimeEndOffsetMin2 ||
      (current.allowedTimeEndAnchorHabitId2 || null) !== (detailTuneOriginal.allowedTimeEndAnchorHabitId2 || null) ||
      (current.allowedTimeEndFixedMin2 ?? null) !== (detailTuneOriginal.allowedTimeEndFixedMin2 ?? null) ||
      current.allowedTimeEndDayOffset !== detailTuneOriginal.allowedTimeEndDayOffset ||
      current.allowedTimeEndDayOffset2 !== detailTuneOriginal.allowedTimeEndDayOffset2 ||
      (current.preferredTimeStartCombine || null) !== (detailTuneOriginal.preferredTimeStartCombine || null) ||
      (current.preferredTimeStartAnchor2 || null) !== (detailTuneOriginal.preferredTimeStartAnchor2 || null) ||
      current.preferredTimeStartOffsetMin2 !== detailTuneOriginal.preferredTimeStartOffsetMin2 ||
      (current.preferredTimeStartAnchorHabitId2 || null) !== (detailTuneOriginal.preferredTimeStartAnchorHabitId2 || null) ||
      (current.preferredTimeStartFixedMin2 ?? null) !== (detailTuneOriginal.preferredTimeStartFixedMin2 ?? null) ||
      current.preferredTimeStartDayOffset !== detailTuneOriginal.preferredTimeStartDayOffset ||
      current.preferredTimeStartDayOffset2 !== detailTuneOriginal.preferredTimeStartDayOffset2 ||
      (current.preferredTimeEndCombine || null) !== (detailTuneOriginal.preferredTimeEndCombine || null) ||
      (current.preferredTimeEndAnchor2 || null) !== (detailTuneOriginal.preferredTimeEndAnchor2 || null) ||
      current.preferredTimeEndOffsetMin2 !== detailTuneOriginal.preferredTimeEndOffsetMin2 ||
      (current.preferredTimeEndAnchorHabitId2 || null) !== (detailTuneOriginal.preferredTimeEndAnchorHabitId2 || null) ||
      (current.preferredTimeEndFixedMin2 ?? null) !== (detailTuneOriginal.preferredTimeEndFixedMin2 ?? null) ||
      current.preferredTimeEndDayOffset !== detailTuneOriginal.preferredTimeEndDayOffset ||
      current.preferredTimeEndDayOffset2 !== detailTuneOriginal.preferredTimeEndDayOffset2)
  );
  sheet.classList.toggle('tune-dirty',Boolean(dirty));
}

// HYBRID: rewrites form fields from saved original
function restoreDetailTune(){
  if(!detailTuneOriginal)return;
  $('detail-habit-message').value = detailTuneOriginal.name;
  $('detail-emoji').value = detailTuneOriginal.emoji;
  renderEmojiBgSwatches('detail-emoji-bg',detailTuneOriginal.emojiBgColor || '');
  $('detail-pinned').setAttribute('aria-pressed',detailTuneOriginal.pinned ? 'true' : 'false');
  renderDetailLinkRows(normalizeLinks(detailTuneOriginal.links));
  $('detail-duration').value = detailTuneOriginal.durationMinutes;
  $('detail-flexibility').value = detailTuneOriginal.flexibilityDays;
  $('detail-due-date').value = dateInputValue(detailTuneOriginal.dueDate);
  if($('detail-due-time'))$('detail-due-time').value = detailTuneOriginal.eventTime !== null ? timeInputValue(detailTuneOriginal.eventTime) : '';
  if($('detail-plan-by-date'))$('detail-plan-by-date').value = dateInputValue(detailTuneOriginal.planByDate);
  syncDetailDueUi();
  syncDetailPlanByUi();
  renderTagChips('detail-tag-chips',detailTuneOriginal.topics,detailTuneOriginal.locationIds || [],detailTuneOriginal.preferredLocationId || null,detailTuneOriginal.locationPrefs || null,detailTuneOriginal.anywhereAllowed);
  if($('detail-breakable'))$('detail-breakable').setAttribute('aria-pressed',detailTuneOriginal.breakable ? 'true' : 'false');
  if($('detail-min-chunk'))$('detail-min-chunk').value = detailTuneOriginal.minChunkMinutes || DEFAULT_MIN_CHUNK_MINUTES;
  if($('detail-track-value'))$('detail-track-value').setAttribute('aria-pressed',detailTuneOriginal.trackValue ? 'true' : 'false');
  if($('detail-timer-auto-stop'))$('detail-timer-auto-stop').value = detailTuneOriginal.timerAutoStopMinutes != null ? detailTuneOriginal.timerAutoStopMinutes : '';
  if($('detail-auto-mark'))$('detail-auto-mark').value = detailTuneOriginal.autoMarkMinutes != null ? detailTuneOriginal.autoMarkMinutes : '';
  syncBreakableUi();
  renderScheduleChips('detail',detailTuneOriginal);
  renderScheduleLinkEditors(detailTuneOriginal);
  renderTimeWindowInputs(detailTuneOriginal);
  setDetailTypeUi(detailTuneOriginal.type);
  setDetailPriorityUi(detailTuneOriginal.priority);
  if(detailTuneOriginal.target !== '')syncRhythm('detail',detailTuneOriginal.target);
  setDetailDirty(false);
}

// Placeholder copy per link kind, so the input tells you what it wants.
const LINK_PLACEHOLDERS = {
  phone:'+1 555 123 4567',
  whatsapp:'+1 555 123 4567',
  facetime:'+1 555 123 4567',
  link:'https://zoom.us/j/…'
};

// RENDER: one editable link row. The first row is primary — the star marks it
// and the up arrow on the others promotes them.
function detailLinkRowHtml(link,index){
  const kind = normalizeLinkKind(link.kind);
  const options = LINK_KINDS
    .map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${k}</option>`)
    .join('');
  const lead = index === 0
    ? `<span class="link-primary-badge" title="opens on double tap" aria-label="primary link"><i class="ti ti-star" aria-hidden="true"></i></span>`
    : `<button type="button" class="link-row-btn" data-link-promote="${index}" title="make primary" aria-label="make primary"><i class="ti ti-arrow-up" aria-hidden="true"></i></button>`;
  return `<div class="link-row" data-link-index="${index}">
    <select class="mini-select link-kind" aria-label="link type">${options}</select>
    <input type="text" class="link-value" value="${escapeHtml(link.value || '')}" placeholder="${escapeHtml(LINK_PLACEHOLDERS[kind] || '')}" aria-label="${kind} value" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" />
    ${lead}
    <button type="button" class="link-row-btn" data-link-remove="${index}" title="remove" aria-label="remove link"><i class="ti ti-x" aria-hidden="true"></i></button>
  </div>`;
}

// RENDER: rewrite the link editor rows from a list.
function renderDetailLinkRows(links){
  const list = $('detail-link-list');
  if(!list)return;
  list.innerHTML = (links || []).map(detailLinkRowHtml).join('');
  syncDetailLinkUi();
}

// HYBRID: read the link rows back out, keeping half-typed rows so the editor
// doesn't delete a row out from under you mid-edit.
function currentDetailLinkRows(){
  return Array.from(document.querySelectorAll('#detail-link-list .link-row')).map(row => ({
    kind:normalizeLinkKind(row.querySelector('.link-kind')?.value),
    value:(row.querySelector('.link-value')?.value || '').trim()
  }));
}

// HYBRID: the saveable links — normalized, unusable rows dropped.
function currentDetailLinks(){
  return normalizeLinks(currentDetailLinkRows());
}

// RENDER: header launch buttons + hint, from whatever the rows currently hold.
function syncDetailLinkUi(){
  const actions = $('detail-link-actions');
  const links = currentDetailLinks();
  if(actions){
    actions.hidden = links.length === 0;
    actions.innerHTML = links.map((link,i) =>
      `<button type="button" class="detail-head-btn link-kind-${link.kind}" data-link-open="${i}" title="${escapeHtml(linkLabel(link))}" aria-label="open ${escapeHtml(linkLabel(link))}"><i class="ti ${linkIconClass(link)}" aria-hidden="true"></i></button>`
    ).join('');
  }
  document.querySelectorAll('#detail-link-list .link-row').forEach(row=>{
    const kind = normalizeLinkKind(row.querySelector('.link-kind')?.value);
    const input = row.querySelector('.link-value');
    if(input)input.placeholder = LINK_PLACEHOLDERS[kind] || '';
  });
  const hint = $('detail-link-hint');
  if(hint){
    if(!links.length){
      hint.textContent = 'Add a number to call or a meeting link to open. Double tapping this item’s card logs it and opens the starred one.';
    }else{
      const primary = linkLabel(links[0]);
      const whatsapp = links.some(l => l.kind === 'whatsapp')
        ? ' WhatsApp opens the chat — call from there.'
        : '';
      hint.textContent = `Double tapping this item’s card logs it and opens ${primary}.${whatsapp}`;
    }
  }
}

// HANDLER: add an empty row to fill in.
function addDetailLinkRow(){
  const rows = currentDetailLinkRows();
  if(rows.length >= MAX_HABIT_LINKS){
    showToast(`up to ${MAX_HABIT_LINKS} links`);
    return;
  }
  rows.push({kind:rows.length ? 'link' : 'phone',value:''});
  renderDetailLinkRows(rows);
  const inputs = document.querySelectorAll('#detail-link-list .link-value');
  inputs[inputs.length - 1]?.focus();
}

// HANDLER: drop a row.
function removeDetailLinkRow(index){
  const rows = currentDetailLinkRows();
  if(index < 0 || index >= rows.length)return;
  rows.splice(index,1);
  renderDetailLinkRows(rows);
  setDetailDirty();
}

// HANDLER: move a row to the front, making it the one a double tap fires.
function promoteDetailLinkRow(index){
  const rows = currentDetailLinkRows();
  if(index <= 0 || index >= rows.length)return;
  rows.unshift(rows.splice(index,1)[0]);
  renderDetailLinkRows(rows);
  setDetailDirty();
}

// HANDLER: launch a link from the detail header. Reads the live rows, so a
// freshly typed number works without saving first.
function openDetailLink(index){
  const links = currentDetailLinks();
  const link = links[index];
  if(!link){
    showToast('add a number or link first');
    scrollDetailToNav('identity');
    return;
  }
  openHabitLink(link);
}

// RENDER: task due row hint — date-only vs fixed appointment
function syncDetailDueUi(){
  const dueInput = $('detail-due-date');
  const timeInput = $('detail-due-time');
  if(!dueInput)return;
  const hasDate = Boolean(dueInput.value);
  const hasTime = Boolean(timeInput?.value);
  const hint = $('detail-due-hint');
  if(hint){
    if(!hasDate)hint.textContent = 'No due date. This stays in your list as a low-priority someday task until you date it or finish it.';
    else if(hasTime)hint.textContent = 'Fixed appointment — shows on your agenda at this time. Clear the date to remove both.';
    else hint.textContent = 'Due on this date — set flexibility to 0 for a firm deadline.';
  }
}

// RENDER: toggle habit one-off plan-by controls + hint
function syncDetailPlanByUi(){
  const input = $('detail-plan-by-date');
  const clearBtn = $('detail-plan-by-clear');
  const weekBtn = $('detail-plan-by-week');
  if(!input)return;
  const hasDate = Boolean(input.value);
  if(clearBtn)clearBtn.hidden = !hasDate;
  if(weekBtn)weekBtn.hidden = hasDate;
  const hint = $('detail-plan-by-hint');
  if(hint)hint.textContent = hasDate
    ? 'Soft one-off target — the week planner will place this habit on a free day on or before this date. Cleared when you log it.'
    : 'Optional. Set a one-off “plan by” date to pull this habit into the week planner without picking a specific day.';
}

// HYBRID: switches allowed/preferred schedule section
function setScheduleView(view){
  detailScheduleView = view;
  document.querySelectorAll('#detail-schedule-view-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.scheduleView === view);
  });
  const allowedGroup = $('detail-schedule-allowed');
  const preferredGroup = $('detail-schedule-preferred');
  if(allowedGroup)allowedGroup.hidden = view !== 'allowed';
  if(preferredGroup)preferredGroup.hidden = view !== 'preferred';
}

// HYBRID: resets detail state and closes sheet
function closeDetail(){
  detailIdx = null;
  detailTuneOriginal = null;
  detailScheduleView = 'allowed';
  closeSheet('detail-sheet');
}

// RENDER: renders score ring and stat cards
