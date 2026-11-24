// PURE: <option> list for a blocked-time prayer-anchor picker.
// When `allowFixed` is true (secondary B row), include a clock-time option.
function blockedAnchorOptions(selected, allowFixed = false){
  const prayer = cleanPrayerAnchor(selected) || '';
  const isFixed = allowFixed && selected === 'fixed';
  let html = '<option value="">— choose an event —</option>'
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
  const hasCoords = block.locationId || (Number.isFinite(sortSettings.homeCityLat) && Number.isFinite(sortSettings.homeCityLng));
  const resolvedMin = isDyn && hasCoords ? resolveBlockedTimeMinutes(block,field,dayStart(Date.now())) : null;
  // A resolved clock folds into the anchor option itself; the preview line
  // keeps only status text ("—", "choose a place or set your city first").
  const resolved = isDyn && resolvedMin == null ? blockedResolvedLabel(block, field) : '';
  const aria = escapeHtml(block.label) + ' ' + field;
  const attr = suffix=>` data-blocked-${field}-${suffix}="${i}"`;
  return `<div class="time-endpoint blocked-endpoint${isDyn ? ' is-dynamic' : ''}" data-endpoint-label="${field === 'start' ? 'from' : 'until'}" data-blocked-field="${field}" data-blocked-index="${i}">
    <input type="time" class="time-fixed" step="300" data-blocked-${field}="${i}" aria-label="${aria}" value="${fixedVal}"${isDyn ? ' hidden' : ''} />
    <div class="time-dynamic"${isDyn ? '' : ' hidden'}>${uiTimeDynamicHtml(aria,{
      expr:uiTimeExprHtml(aria,false,{options:blockedAnchorOptions(anchor),offset:offsetVal,attr}),
      expr2:uiTimeExprHtml(aria,true,{options:blockedAnchorOptions(anchor2,true),offset:offset2Val,fixedValue:fixed2Val,isFixed:isFixed2,dayOn:day2On,attr}),
      day:uiTimeDayHtml(aria,false,{on:dayOn,attrs:attr('day')}),
      combine,combineAttrs:attr('combine'),resolved:escapeHtml(resolved),
      resolvedDay:resolvedMin == null ? '' : timeResolvedDayLabel(resolvedMin),
      open:Boolean(combine || dayOn)
    })}</div>
    ${uiTimeModeToggleHtml({which:field,isDynamic:isDyn,extraAttrs:` data-blocked-${field}-mode="${i}"`})}
  </div>`;
}

const busyManagerState = {search:'',filter:'all',sort:'saved',bulkMode:false,selected:new Set(),visible:[],signature:''};
let busyManagerOnClose = null;

function openBusyManager(opts = {}){
  if(opts.fromAdd && $('add-sheet').classList.contains('open'))closeSheet('add-sheet');
  busyManagerOnClose = typeof opts.onClose === 'function' ? opts.onClose : null;
  $('busy-manager-search').value = busyManagerState.search;
  renderBlockedTimeControls({ includeManager: true });
  $('busy-manager-sheet').inert = false;
  openSheet('busy-manager-sheet',{reopen:()=>openBusyManager(opts),fromAdd:opts.fromAdd});
}

function closeBusyManager(){
  busyManagerState.bulkMode = false;
  busyManagerState.selected.clear();
  const onClose = busyManagerOnClose;
  busyManagerOnClose = null;
  closeSheet('busy-manager-sheet');
  $('busy-manager-sheet').inert = true;
  renderBlockedTimeControls({ includeManager: false });
  if(onClose)onClose();
}

function busyManagerResetFilters(){
  busyManagerState.search = '';
  busyManagerState.filter = 'all';
  $('busy-manager-search').value = '';
}

function busyManagerPlaceOptions(value = ''){
  const selectedPlaces = normalizeBlockedTimes(sortSettings.blockedTimes).map(b=>b.locationId).filter(Boolean);
  return '<option value="">any place</option>' + selectableLocationOptions(selectedPlaces).map(loc=>
    `<option value="${escapeHtml(loc.id)}"${loc.id === value ? ' selected' : ''}>${escapeHtml(loc.label || loc.name)}</option>`).join('');
}

function renderBusyManagerChrome(blocks){
  const state = busyManagerState;
  const signature = JSON.stringify(blocks);
  // Indices belong to saved order, never display order. Drop selection if an
  // external edit changes that array while the manager is open.
  if(state.signature !== signature)state.selected.clear();
  state.signature = signature;
  const count = blocks.length;
  $('busy-times-summary').textContent = count ? `${count} busy ${count === 1 ? 'time' : 'times'}` : 'No busy times';
  $('busy-times-preview').innerHTML = blocks.slice(0,3).map(b=>`<span class="settings-preview-pill">${escapeHtml(b.label)}</span>`).join('')
    + (count > 3 ? `<span class="settings-preview-pill is-more">+${count-3} more</span>` : '');
  $('busy-manager-count').textContent = `${count} / 24 busy times`;
  $('blocked-time-add').disabled = count >= 24 || state.bulkMode;
  $('busy-manager-sort').value = state.sort;
  $('busy-manager-search-clear').hidden = !state.search;
  $('busy-bulk-toggle').textContent = state.bulkMode ? 'done' : 'select';
  $('busy-bulk-toggle').classList.toggle('on',state.bulkMode);
  $('busy-bulk-toggle').setAttribute('aria-pressed',String(state.bulkMode));
  const filters = [['all','All'],['daily','Every day'],['weekly','Selected days'],['relative','Relative times'],['place','With a place']];
  $('busy-manager-filters').innerHTML = filters.map(([key,label])=>`<button type="button" class="manager-filter-chip${state.filter === key ? ' on' : ''}" data-busy-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`).join('');
  const query = state.search.trim().toLocaleLowerCase();
  const locations = locationOptions();
  const visible = blocks.map((block,index)=>({block,index})).filter(({block})=>{
    const place = locations.find(loc=>loc.id === block.locationId);
    const text = [block.label,place?.name,place?.label,place?.address].filter(Boolean).join(' ').toLocaleLowerCase();
    if(query && !text.includes(query))return false;
    if(state.filter === 'daily')return !block.days.length && !block.ordinalWeekdays.length;
    if(state.filter === 'weekly')return block.days.length || block.ordinalWeekdays.length;
    if(state.filter === 'relative')return block.startAnchor || block.endAnchor;
    if(state.filter === 'place')return Boolean(block.locationId);
    return true;
  });
  if(state.sort === 'name')visible.sort((a,b)=>a.block.label.localeCompare(b.block.label) || a.index-b.index);
  if(state.sort === 'start'){
    const start = b=>resolveBlockedTimeMinutes(b,'start',dayStart(Date.now())) ?? b.start;
    visible.sort((a,b)=>start(a.block)-start(b.block) || a.index-b.index);
  }
  state.visible = visible.map(row=>row.index);
  const empty = $('busy-manager-empty');
  empty.hidden = visible.length > 0;
  empty.innerHTML = count
    ? 'No busy times match. <button type="button" class="mini-text-btn" data-busy-reset>clear search &amp; filters</button>'
    : 'No busy times yet. Add a recurring reservation to keep that time free of planned items.';
  $('busy-bulk-bar').hidden = !state.bulkMode;
  $('busy-bulk-count').textContent = `${state.selected.size} selected`;
  $('busy-bulk-all').textContent = `select all (${visible.length})`;
  $('busy-bulk-all').disabled = !visible.length;
  const action = $('busy-bulk-action').value;
  const valueHost = $('busy-bulk-value');
  if(action === 'place'){
    const current = valueHost.querySelector('select')?.value || '';
    valueHost.innerHTML = `<select class="settings-select" id="busy-bulk-place" aria-label="place for selected busy times">${busyManagerPlaceOptions(current)}</select>`;
  }else valueHost.replaceChildren();
  valueHost.hidden = action !== 'place';
  $('busy-bulk-apply').disabled = !state.selected.size || (action === 'duplicate' && count + state.selected.size > 24);
  $('busy-bulk-hint').textContent = action === 'delete'
    ? 'Removes the selected recurring reservations from every day. You can undo this action.'
    : action === 'duplicate' && count + state.selected.size > 24
      ? 'Not enough room to duplicate this selection. Save up to 24 busy times.'
      : 'Changes apply to all selected recurring busy times, including selections hidden by filters.';
  return visible;
}

function applyBusyManagerBulk(){
  const state = busyManagerState;
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  if(JSON.stringify(blocks) !== state.signature){renderBlockedTimeControls();return;}
  const selected = new Set(state.selected);
  if(!selected.size)return;
  const action = $('busy-bulk-action').value;
  let next;
  if(action === 'delete')next = blocks.filter((_,index)=>!selected.has(index));
  else if(action === 'duplicate'){
    if(blocks.length + selected.size > 24)return;
    const names = new Set(blocks.map(block=>block.label.toLocaleLowerCase()));
    next = blocks.concat(blocks.filter((_,index)=>selected.has(index)).map(block=>{
      const {reminderId,...copy} = block;
      const base = block.label.slice(0,19) + ' copy';
      let label = base;
      for(let suffix = 2;names.has(label.toLocaleLowerCase());suffix++){
        const tail = ` ${suffix}`;
        label = base.slice(0,24-tail.length) + tail;
      }
      names.add(label.toLocaleLowerCase());
      return {...copy,label};
    }));
  }else if(action === 'place'){
    const locationId = $('busy-bulk-place').value || null;
    next = blocks.map((block,index)=>selected.has(index) ? {...block,locationId} : block);
  }else return;
  state.selected.clear();
  updateSortSetting({blockedTimes:next},{renderNow:false});
  renderBlockedTimeControls();
  render();
  showActionToast(`${selected.size} busy ${selected.size === 1 ? 'time' : 'times'} ${action === 'delete' ? 'removed' : action === 'duplicate' ? 'duplicated' : 'updated'}`,{
    type:'busy-times',before:blocks,after:JSON.stringify(normalizeBlockedTimes(sortSettings.blockedTimes)),toastOnlyUndo:true
  });
}

function renderBlockedTimeControls(opts = {}){
  const includeManager = opts.includeManager !== false;
  const wrap = $('blocked-time-list');
  if(!wrap)return;
  if(typeof nativeEnsureBusyReminderIds === 'function')nativeEnsureBusyReminderIds();
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  if(!includeManager){
    const count = blocks.length;
    const summaryEl = $('busy-times-summary');
    if(summaryEl)summaryEl.textContent = count ? `${count} busy ${count === 1 ? 'time' : 'times'}` : 'No busy times';
    const previewEl = $('busy-times-preview');
    if(previewEl){
      previewEl.innerHTML = blocks.slice(0,3).map(b=>`<span class="settings-preview-pill">${escapeHtml(b.label)}</span>`).join('')
        + (count > 3 ? `<span class="settings-preview-pill is-more">+${count-3} more</span>` : '');
    }
    return;
  }
  const disclosureState = new Map([...wrap.querySelectorAll('.time-advanced')].map(el=>{
    const endpoint = el.closest('.blocked-endpoint');
    return [`${endpoint.dataset.blockedIndex}:${endpoint.dataset.blockedField}`,el.open];
  }));
  const locs = typeof selectableLocationOptions === 'function'
    ? selectableLocationOptions(blocks.map(b=>b.locationId).filter(Boolean))
    : (typeof locationOptions === 'function' ? locationOptions() : []);
  const visible = renderBusyManagerChrome(blocks);
  wrap.innerHTML = visible.map(({block,index:i})=>`
    <div class="blocked-time-row${busyManagerState.selected.has(i) ? ' is-selected' : ''}" data-blocked-row="${i}">
      <div class="blocked-time-head">
        ${busyManagerState.bulkMode ? `<label class="manager-row-check"><input type="checkbox" data-busy-select="${i}" aria-label="select ${escapeHtml(block.label)}"${busyManagerState.selected.has(i) ? ' checked' : ''} /></label>` : ''}
        <input type="text" data-blocked-label="${i}" aria-label="busy time name" maxlength="24" value="${escapeHtml(block.label)}" />
        <button class="mini-text-btn" type="button" data-blocked-remove="${i}">remove</button>
      </div>
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
      ${ordinalWeekdayEditor(block.ordinalWeekdays)}
      <div class="compact-days" style="margin-top:6px;align-items:center;gap:6px;">
        <select data-blocked-location="${i}" aria-label="${escapeHtml(block.label)} place" class="mini-select">
          <option value="">any place</option>
          ${locs.map(loc=>`<option value="${escapeHtml(loc.id)}"${block.locationId === loc.id ? ' selected' : ''}>${escapeHtml(loc.label || loc.name)}</option>`).join('')}
        </select>
      </div>
    </div>
  `).join('');
  wrap.querySelectorAll('.blocked-endpoint').forEach(endpoint=>{
    const key = `${endpoint.dataset.blockedIndex}:${endpoint.dataset.blockedField}`;
    if(disclosureState.has(key))endpoint.querySelector('.time-advanced').open = disclosureState.get(key);
    const block = blocks[Number(endpoint.dataset.blockedIndex)];
    const min = block && typeof resolveBlockedTimeMinutes === 'function'
      ? resolveBlockedTimeMinutes(block,endpoint.dataset.blockedField,dayStart(Date.now())) : null;
    syncAnchorOptionTimeLabel(endpoint.querySelector('.time-anchor'),min,
      min == null ? '' : timeResolvedDayLabel(min));
    syncTimeRuleSummary(endpoint);
  });
  if(typeof renderNativeBusyReminders === 'function')renderNativeBusyReminders(wrap,blocks);
  wrap.classList.toggle('is-bulk',busyManagerState.bulkMode);
  if(busyManagerState.bulkMode){
    wrap.querySelectorAll('input,select,button').forEach(control=>{
      if(!control.matches('[data-busy-select]'))control.disabled = true;
    });
  }
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
  if(blocks.length >= 24){showToast('Save up to 24 busy times');return;}
  busyManagerResetFilters();
  busyManagerState.bulkMode = false;
  blocks.push({label:'busy',days:[],start:900,end:960});
  updateSortSetting({blockedTimes:blocks},{renderNow:false});
  renderBlockedTimeControls();
  render();
  const row = $('blocked-time-list').querySelector(`[data-blocked-row="${blocks.length - 1}"]`);
  row?.scrollIntoView({block:'nearest'});
  row?.querySelector('[data-blocked-label]')?.focus({preventScroll:true});
}

function removeBlockedTime(index){
  const blocks = normalizeBlockedTimes(sortSettings.blockedTimes);
  if(!blocks[index])return;
  const previous = blocks.slice();
  blocks.splice(index,1);
  updateSortSetting({blockedTimes:blocks},{renderNow:false});
  renderBlockedTimeControls();
  render();
  showActionToast('Busy time removed',{type:'busy-times',before:previous,after:JSON.stringify(normalizeBlockedTimes(sortSettings.blockedTimes)),toastOnlyUndo:true});
}

$('open-busy-manager')?.addEventListener('click',()=>openBusyManager());
$('busy-manager-close')?.addEventListener('click',closeBusyManager);
$('busy-manager-sheet')?.addEventListener('click',event=>{
  if(event.target === event.currentTarget && !sheetBackdropArmed('busy-manager-sheet'))closeBusyManager();
});
$('busy-manager-search')?.addEventListener('input',event=>{
  busyManagerState.search = event.target.value;
  renderBlockedTimeControls();
});
$('busy-manager-search-clear')?.addEventListener('click',()=>{
  busyManagerState.search = '';
  $('busy-manager-search').value = '';
  renderBlockedTimeControls();
  $('busy-manager-search').focus();
});
$('busy-manager-sort')?.addEventListener('change',event=>{
  busyManagerState.sort = event.target.value;
  renderBlockedTimeControls();
});
$('busy-manager-filters')?.addEventListener('click',event=>{
  const button = event.target.closest('[data-busy-filter]');
  if(!button)return;
  busyManagerState.filter = busyManagerState.filter === button.dataset.busyFilter ? 'all' : button.dataset.busyFilter;
  renderBlockedTimeControls();
});
$('busy-manager-empty')?.addEventListener('click',event=>{
  if(!event.target.closest('[data-busy-reset]'))return;
  busyManagerResetFilters();
  renderBlockedTimeControls();
});
$('busy-bulk-toggle')?.addEventListener('click',()=>{
  busyManagerState.bulkMode = !busyManagerState.bulkMode;
  busyManagerState.selected.clear();
  renderBlockedTimeControls();
});
$('busy-bulk-all')?.addEventListener('click',()=>{
  busyManagerState.visible.forEach(index=>busyManagerState.selected.add(index));
  renderBlockedTimeControls();
});
$('busy-bulk-clear')?.addEventListener('click',()=>{
  busyManagerState.selected.clear();
  renderBlockedTimeControls();
});
$('blocked-time-list')?.addEventListener('change',event=>{
  if(!event.target.matches('[data-busy-select]'))return;
  const index = Number(event.target.dataset.busySelect);
  if(event.target.checked)busyManagerState.selected.add(index);
  else busyManagerState.selected.delete(index);
  renderBlockedTimeControls();
});
$('busy-bulk-action')?.addEventListener('change',renderBlockedTimeControls);
$('busy-bulk-apply')?.addEventListener('click',applyBusyManagerBulk);
