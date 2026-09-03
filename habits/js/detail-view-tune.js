function sharedDisplayModeForHabit(habit){
  if(!habit || habit.showOnSharedDisplay === false)return 'hidden';
  return habit.allowSharedDisplayCompletion === false ? 'view' : 'complete';
}

function setDetailSharedDisplayMode(mode){
  const selected = ['hidden','view','complete'].includes(mode) ? mode : 'complete';
  document.querySelectorAll('#detail-shared-display [data-shared-display-mode]').forEach(button=>{
    const on = button.dataset.sharedDisplayMode === selected;
    button.classList.toggle('on',on);
    button.setAttribute('aria-checked',String(on));
    button.tabIndex = on ? 0 : -1;
  });
}

function currentDetailSharedDisplayMode(){
  return document.querySelector('#detail-shared-display [data-shared-display-mode].on')?.dataset.sharedDisplayMode || 'complete';
}

function combineFieldsFromEndpoint(inputId, prefix){
  const c = readCombineFromEndpoint(inputId);
  return {
    [`${prefix}Combine`]:c.combine,
    [`${prefix}Anchor2`]:c.anchor2,
    [`${prefix}OffsetMin2`]:c.offset2,
    [`${prefix}AnchorHabitId2`]:c.habitId2,
    [`${prefix}FixedMin2`]:c.fixedMin2,
    [`${prefix}DayOffset`]:c.dayOffset,
    [`${prefix}DayOffset2`]:c.dayOffset2
  };
}

function currentDetailTune(){
  const mainType = document.querySelector('#detail-type-seg .seg-opt.on')?.dataset.detailType || 'keepup';
  let type;
  if(mainType === 'task'){
    type = 'task';
  }else{
    const mode = document.querySelector('#detail-mode-seg .seg-opt.on')?.dataset.mode || 'build';
    type = modeToType(mode);
  }
  const locationIds = selectedLocationIdsFrom('detail-place-chips');
  const locationPrefs = selectedLocationPrefsFrom('detail-place-chips');
  const subjectHid = detailIdx != null ? cleanHabitId(load()[detailIdx]?.hid) : '';
  const sharedDisplayMode = currentDetailSharedDisplayMode();
  return {
    name:$('detail-habit-message').value.trim(),
    type,
    emoji:cleanMark($('detail-emoji').value),
    emojiBgColor:selectedEmojiBgColor('detail-emoji-bg'),
    target:currentRhythmTarget('detail'),
    pinned:$('detail-pinned').getAttribute('aria-pressed') === 'true',
    showOnSharedDisplay:sharedDisplayMode !== 'hidden',
    allowSharedDisplayCompletion:sharedDisplayMode === 'complete',
    links:currentDetailLinks(),
    topics:selectedTopicsFrom('detail-topic-chips'),
    locationIds,
    anywhereAllowed:selectedAnywhereFrom('detail-place-chips'),
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
    scheduleOptions:readHabitScheduleOptionsFromDetail(),
    ...combineFieldsFromEndpoint('detail-time-start','allowedTimeStart'),
    ...combineFieldsFromEndpoint('detail-time-end','allowedTimeEnd'),
    ...combineFieldsFromEndpoint('detail-preferred-time-start','preferredTimeStart'),
    ...combineFieldsFromEndpoint('detail-preferred-time-end','preferredTimeEnd'),
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
    // Plan-by is set from the day sheet (tap a future day), not a date picker.
    planByDate:(()=>{
      const live = detailIdx != null ? load()[detailIdx] : null;
      if(!live)return detailTuneOriginal?.planByDate ?? null;
      return typeof habitPlanByDate === 'function' ? habitPlanByDate(live) : (live.planByDate ?? null);
    })()
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
function detailTuneValue(v){
  if(Array.isArray(v)){
    if(v.some(item => item && typeof item === 'object'))return JSON.stringify(v);
    return v.join('|');
  }
  if(v && typeof v === 'object')return JSON.stringify(v);
  return v ?? null;
}

function detailTuneChanged(current, original){
  if(!original)return false;
  return Object.keys(current).some(key => detailTuneValue(current[key]) !== detailTuneValue(original[key]));
}

function setDetailDirty(force){
  const sheet = getSheetInner('detail-sheet');
  const dirty = force ?? (detailTuneOriginal && detailTuneChanged(currentDetailTune(), detailTuneOriginal));
  sheet.classList.toggle('tune-dirty',Boolean(dirty));
}

// HYBRID: rewrites form fields from saved original
function restoreDetailTune(){
  if(!detailTuneOriginal)return;
  $('detail-habit-message').value = detailTuneOriginal.name;
  $('detail-emoji').value = detailTuneOriginal.emoji;
  renderEmojiBgSwatches('detail-emoji-bg',detailTuneOriginal.emojiBgColor || '');
  $('detail-pinned').setAttribute('aria-pressed',detailTuneOriginal.pinned ? 'true' : 'false');
  setDetailSharedDisplayMode(sharedDisplayModeForHabit(detailTuneOriginal));
  renderDetailLinkRows(normalizeLinks(detailTuneOriginal.links));
  $('detail-duration').value = detailTuneOriginal.durationMinutes;
  $('detail-flexibility').value = detailTuneOriginal.flexibilityDays;
  $('detail-due-date').value = dateInputValue(detailTuneOriginal.dueDate);
  if($('detail-due-time'))$('detail-due-time').value = detailTuneOriginal.eventTime !== null ? timeInputValue(detailTuneOriginal.eventTime) : '';
  syncDetailDueUi();
  renderTagChips('detail-place-chips',[],detailTuneOriginal.locationIds || [],detailTuneOriginal.preferredLocationId || null,detailTuneOriginal.locationPrefs || null,detailTuneOriginal.anywhereAllowed);
  renderTagChips('detail-topic-chips',detailTuneOriginal.topics,[]);
  if($('detail-breakable'))$('detail-breakable').setAttribute('aria-pressed',detailTuneOriginal.breakable ? 'true' : 'false');
  if($('detail-min-chunk'))$('detail-min-chunk').value = detailTuneOriginal.minChunkMinutes || DEFAULT_MIN_CHUNK_MINUTES;
  if($('detail-track-value'))$('detail-track-value').setAttribute('aria-pressed',detailTuneOriginal.trackValue ? 'true' : 'false');
  if($('detail-timer-auto-stop'))$('detail-timer-auto-stop').value = detailTuneOriginal.timerAutoStopMinutes != null ? detailTuneOriginal.timerAutoStopMinutes : '';
  if($('detail-auto-mark'))$('detail-auto-mark').value = detailTuneOriginal.autoMarkMinutes != null ? detailTuneOriginal.autoMarkMinutes : '';
  syncBreakableUi();
  renderScheduleChips('detail',detailTuneOriginal);
  renderScheduleLinkEditors(detailTuneOriginal);
  renderHabitScheduleOptions(detailTuneOriginal);
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
  app:'https://apps.apple.com/app/id…',
  link:'https://zoom.us/j/…'
};

const LINK_KIND_LABELS = {
  phone:'phone',
  whatsapp:'WhatsApp',
  facetime:'FaceTime',
  app:'app',
  link:'link'
};

// Ready-to-use web entry points work on mobile and desktop; installed apps may
// claim these HTTPS links through their normal universal-link handling.
const APP_LINK_PRESETS = [
  {id:'gmail',label:'Gmail',value:'https://mail.google.com/mail/u/0/',icon:'ti-brand-gmail'},
  {id:'outlook',label:'Outlook',value:'https://outlook.live.com/mail/0/',icon:'ti-mail'},
  {id:'facebook',label:'Facebook',value:'https://www.facebook.com/',icon:'ti-brand-facebook'},
  {id:'instagram',label:'Instagram',value:'https://www.instagram.com/',icon:'ti-brand-instagram'},
  {id:'youtube',label:'YouTube',value:'https://www.youtube.com/',icon:'ti-brand-youtube'},
  {id:'reddit',label:'Reddit',value:'https://www.reddit.com/',icon:'ti-brand-reddit'},
  {id:'linkedin',label:'LinkedIn',value:'https://www.linkedin.com/feed/',icon:'ti-brand-linkedin'},
  {id:'x',label:'X',value:'https://x.com/home',icon:'ti-brand-x'}
];

// RENDER: one editable link row. The first row is primary — the star marks it
// and the up arrow on the others promotes them.
function detailLinkRowHtml(link,index){
  const kind = normalizeLinkKind(link.kind);
  const options = LINK_KINDS
    .map(k => `<option value="${k}"${k === kind ? ' selected' : ''}>${LINK_KIND_LABELS[k] || k}</option>`)
    .join('');
  const lead = index === 0
    ? `<span class="link-primary-badge" title="opens on double tap" aria-label="primary link"><i class="ti ti-star" aria-hidden="true"></i></span>`
    : `<button type="button" class="link-row-btn" data-link-promote="${index}" title="make primary" aria-label="make primary"><i class="ti ti-arrow-up" aria-hidden="true"></i></button>`;
  return `<div class="link-row${kind === 'app' ? ' is-app' : ''}" data-link-index="${index}">
    <select class="mini-select link-kind" aria-label="link type">${options}</select>
    <input type="text" class="link-app-name" value="${escapeHtml(normalizeLinkLabel(link.label))}" placeholder="app name" aria-label="app name" autocomplete="off" maxlength="30"${kind === 'app' ? '' : ' hidden'} />
    <input type="text" class="link-value" value="${escapeHtml(link.value || '')}" placeholder="${escapeHtml(LINK_PLACEHOLDERS[kind] || '')}" aria-label="${kind} value" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" />
    <input type="url" class="link-app-launch" value="${escapeHtml(link.launch || '')}" placeholder="opens the app directly — optional, e.g. spotify://" aria-label="direct open link" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"${kind === 'app' ? '' : ' hidden'} />
    ${lead}
    <button type="button" class="link-row-btn" data-link-remove="${index}" title="remove" aria-label="remove link"><i class="ti ti-x" aria-hidden="true"></i></button>
  </div>`;
}

// RENDER: rewrite the link editor rows from a list.
function renderDetailLinkRows(links){
  const list = $('detail-link-list');
  if(!list)return;
  closeDetailAppPicker();
  list.innerHTML = (links || []).map(detailLinkRowHtml).join('');
  syncDetailLinkUi();
}

// HYBRID: read the link rows back out, keeping half-typed rows so the editor
// doesn't delete a row out from under you mid-edit.
function currentDetailLinkRows(){
  return Array.from(document.querySelectorAll('#detail-link-list .link-row')).map(row => ({
    kind:normalizeLinkKind(row.querySelector('.link-kind')?.value),
    value:(row.querySelector('.link-value')?.value || '').trim(),
    label:normalizeLinkLabel(row.querySelector('.link-app-name')?.value),
    launch:(row.querySelector('.link-app-launch')?.value || '').trim()
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
    const name = row.querySelector('.link-app-name');
    const launch = row.querySelector('.link-app-launch');
    row.classList.toggle('is-app',kind === 'app');
    if(name)name.hidden = kind !== 'app';
    if(launch)launch.hidden = kind !== 'app';
    if(input){
      input.placeholder = LINK_PLACEHOLDERS[kind] || '';
      input.setAttribute('aria-label',`${kind} value`);
    }
  });
  const hint = $('detail-link-hint');
  if(hint){
    if(!links.length){
      hint.textContent = 'Add an app, number, or web link. Double tapping this item’s card logs it and opens the starred one.';
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
  closeDetailAppPicker();
  renderDetailLinkRows(rows);
  const inputs = document.querySelectorAll('#detail-link-list .link-value');
  inputs[inputs.length - 1]?.focus();
}

// RENDER: compact, horizontally scrollable app chooser. It is hidden again
// as soon as a preset is chosen so the Actions pane stays short.
function renderDetailAppPresets(){
  const list = $('detail-app-presets');
  if(!list || list.childElementCount)return;
  list.innerHTML = APP_LINK_PRESETS.map(app =>
    `<button type="button" class="app-preset" data-app-preset="${app.id}" aria-label="add ${escapeHtml(app.label)}"><i class="ti ${app.icon}" aria-hidden="true"></i><span>${escapeHtml(app.label)}</span></button>`
  ).join('') + '<button type="button" class="app-preset custom" data-app-custom><i class="ti ti-apps" aria-hidden="true"></i><span>custom</span></button>';
}

function toggleDetailAppPicker(){
  const picker = $('detail-app-picker');
  if(!picker)return;
  renderDetailAppPresets();
  picker.hidden = !picker.hidden;
  if(picker.hidden)closeDetailAppPicker();
}

function closeDetailAppPicker(){
  const picker = $('detail-app-picker');
  const custom = $('detail-custom-app-editor');
  if(picker)picker.hidden = true;
  $('detail-app-add')?.setAttribute('aria-expanded','false');
  if(custom)custom.hidden = true;
  const name = $('detail-custom-app-name');
  if(name){ name.value = ''; delete name.dataset.autoName; }
  if($('detail-custom-app-url'))$('detail-custom-app-url').value = '';
  if($('detail-custom-app-launch'))$('detail-custom-app-launch').value = '';
}

function detailLinkHasCapacity(){
  if(currentDetailLinkRows().length < MAX_HABIT_LINKS)return true;
  showToast(`up to ${MAX_HABIT_LINKS} links`);
  return false;
}

function addDetailAppPreset(id){
  if(!detailLinkHasCapacity())return;
  const preset = APP_LINK_PRESETS.find(app => app.id === id);
  if(!preset)return;
  const rows = currentDetailLinkRows();
  const value = normalizeUrlValue(preset.value);
  if(rows.some(row => normalizeLinkValue(row.kind,row.value) === value)){
    showToast(`${preset.label} is already added`);
    return;
  }
  rows.push({kind:'app',label:preset.label,value});
  renderDetailLinkRows(rows);
  setDetailDirty();
  closeDetailAppPicker();
  showToast(`${preset.label} added`);
}

function showDetailCustomAppEditor(){
  if(!detailLinkHasCapacity())return;
  const editor = $('detail-custom-app-editor');
  if(!editor)return;
  editor.hidden = false;
  // Link first — pasting a store share link fills in the name for you.
  $('detail-custom-app-url')?.focus();
}

// App Store share links (apps.apple.com/app/id1626186138) can name
// themselves: Apple's public listing lookup returns the store name for the
// numeric id. One lookup per id per session; failures are not cached so
// retrying offline→online works. Only the id already inside the pasted link
// is sent (About → privacy).
const APP_STORE_NAME_PROMISES = new Map();

async function fetchAppStoreName(url){
  const id = appStoreIdFromUrl(url);
  if(!id)return '';
  const cached = APP_STORE_NAME_PROMISES.get(id);
  if(cached)return cached;
  const pending = (async () => {
    try{
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(),5000);
      const res = await fetch(`https://itunes.apple.com/lookup?id=${id}`,{ signal:ctrl.signal });
      clearTimeout(timer);
      if(!res.ok)return '';
      const data = await res.json();
      return data && data.resultCount > 0
        ? normalizeLinkLabel(data.results?.[0]?.trackName)
        : '';
    }catch{
      return '';
    }
  })();
  APP_STORE_NAME_PROMISES.set(id,pending);
  const name = await pending;
  if(!name)APP_STORE_NAME_PROMISES.delete(id);
  return name;
}

// HANDLER: a pasted store link names the app. The URL slug fills in
// instantly, the listing lookup swaps in the real name when it lands, and a
// name the user typed themselves is never overwritten (dataset.autoName).
async function autoNameCustomApp(){
  const urlInput = $('detail-custom-app-url');
  const nameInput = $('detail-custom-app-name');
  if(!urlInput || !nameInput)return;
  const url = normalizeUrlValue(urlInput.value);
  if(!appStoreIdFromUrl(url))return;
  const free = () => !nameInput.value || nameInput.dataset.autoName === '1';
  if(!free())return;
  const slug = appStoreSlugName(url);
  if(slug && !nameInput.value){
    nameInput.value = slug;
    nameInput.dataset.autoName = '1';
  }
  const name = await fetchAppStoreName(url);
  if(!name || !free())return;
  nameInput.value = name;
  nameInput.dataset.autoName = '1';
}

async function addCustomDetailApp(){
  if(!detailLinkHasCapacity())return;
  const nameInput = $('detail-custom-app-name');
  const urlInput = $('detail-custom-app-url');
  const value = normalizeUrlValue(urlInput?.value);
  let label = normalizeLinkLabel(nameInput?.value);
  if(!label && value){
    // An App Store link can name itself — the store listing first, the URL
    // slug as the offline fallback.
    label = await fetchAppStoreName(value) || appStoreSlugName(value);
    if(label && nameInput){
      nameInput.value = label;
      nameInput.dataset.autoName = '1';
    }
  }
  if(!label){
    showToast('name the custom app');
    nameInput?.focus();
    return;
  }
  if(!value){
    showToast('add a valid web or app link');
    urlInput?.focus();
    return;
  }
  const rows = currentDetailLinkRows();
  if(rows.some(row => normalizeLinkValue(row.kind,row.value) === value)){
    showToast('that app link is already added');
    return;
  }
  const entry = {kind:'app',label,value};
  const launch = directLaunchValue($('detail-custom-app-launch')?.value,value);
  if(launch)entry.launch = launch;
  rows.push(entry);
  renderDetailLinkRows(rows);
  setDetailDirty();
  closeDetailAppPicker();
  showToast(`${label} added`);
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
    scrollDetailToNav('actions');
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

// HYBRID: switches allowed/preferred schedule section
const SCHEDULE_VIEW_HINTS = {
  allowed:'Hard limits — the planner only places this inside these days and hours.',
  preferred:'Soft preference — the planner aims for these when there’s room.'
};

function setScheduleView(view){
  detailScheduleView = view;
  document.querySelectorAll('#detail-schedule-view-seg .seg-opt').forEach(btn=>{
    btn.classList.toggle('on',btn.dataset.scheduleView === view);
  });
  const hint = $('detail-schedule-view-hint');
  if(hint)hint.textContent = SCHEDULE_VIEW_HINTS[view] || '';
  const allowedGroup = $('detail-schedule-allowed');
  const preferredGroup = $('detail-schedule-preferred');
  if(allowedGroup)allowedGroup.hidden = view !== 'allowed';
  if(preferredGroup)preferredGroup.hidden = view !== 'preferred';
  const options = $('detail-habit-options');
  if(options)options.hidden = view !== 'allowed';
  if(typeof syncDetailSchedulePlacesUi === 'function')syncDetailSchedulePlacesUi();
}

// HYBRID: resets detail state and closes sheet
function closeDetail(){
  detailIdx = null;
  detailTuneOriginal = null;
  detailScheduleView = 'allowed';
  closeSheet('detail-sheet');
}

// RENDER: renders score ring and stat cards
