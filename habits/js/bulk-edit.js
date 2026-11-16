// Bulk edit: pick saved items by hid (never by rendered card or array index),
// choose explicit per-setting operations where every field starts as
// "keep unchanged", review per-item differences, then apply once with a
// guarded field-level undo. Changing picker filters never changes Home.

let bulkStep = 'pick'; // pick | change | review
let bulkSelected = new Set(); // hids — stable identities, not indexes
let bulkFilters = {search:'',type:'all',topic:'all',location:'all',priority:'all',snoozed:false,completed:false};
let bulkPending = []; // [{id, op, value}] — op 'keep' is never applied
let bulkReview = null; // computed review {perItem, opLines, errors, warnings, changing}
let bulkSignatures = null; // per-hid field snapshot taken at review time
let bulkReviewConfirmed = false; // re-inspection gate after staleness
let bulkStaleNotice = false;
let bulkSettingsQuery = '';

const BULK_PRIORITY_WORDS = ['critical','high','normal','flexible','low','someday'];

function bulkPriorityWord(priority){
  return BULK_PRIORITY_WORDS[clampPriority(priority)] || 'normal';
}

// Calendar imports own their mapped fields: a re-import rewrites them, so
// bulk edits there would be silently lost. Personalization (icon, topics,
// places, snooze…) stays available. Device items are handled at the picker.
function bulkImportOwnedFields(record){
  if(!record || !record.source || record.source === 'device')return new Set();
  // ICS re-import owns title/time/effort; other providers re-map the task core.
  return new Set(['name','eventTime','dueDate','autoMarkMinutes','durationMinutes','breakable','priority']);
}

const bulkImportOwnedCache = {};
function bulkOpImportOwned(opId){
  if(!(opId in bulkImportOwnedCache)){
    const opDesc = bulkOpById(opId);
    const touched = opDesc ? bulkOpTouchedFields(opDesc) : [];
    bulkImportOwnedCache[opId] = touched;
  }
  return bulkImportOwnedCache[opId];
}

function bulkOpBlocked(record,opDesc){
  const owned = bulkImportOwnedFields(record);
  if(owned.size && bulkOpImportOwned(opDesc.id).some(field=>owned.has(field)))return 'owned by the calendar import';
  return '';
}

function bulkSelectedRecords(data){
  const list = data || load();
  return list.filter(h=>bulkSelected.has(h.hid));
}

function openBulkEditPicker(copyHome){
  bulkStep = 'pick';
  bulkSelected = new Set();
  bulkPending = [];
  bulkReview = null;
  bulkSignatures = null;
  bulkReviewConfirmed = false;
  bulkStaleNotice = false;
  bulkSettingsQuery = '';
  bulkFilters = {search:copyHome ? (searchQuery || '') : '',type:copyHome ? homeTypeFilter : 'all',
    topic:copyHome ? homeTopicFilter : 'all',location:copyHome ? homeLocationFilter : 'all',
    priority:copyHome ? homePriorityFilter : 'all',snoozed:false,completed:false};
  setBulkStep('pick');
  renderBulkPicker();
  renderBulkEditStep();
  renderBulkReview();
  openSheet('bulk-edit-sheet');
}

// Closing keeps nothing: selection and chosen changes are in-memory only.
// Ask before discarding actual work (a selection or chosen changes).
function bulkEditHasWork(){
  return bulkSelected.size > 0 || bulkPending.some(p=>p.op !== 'keep');
}

function closeBulkEditSheet(){
  const confirm = $('bulk-edit-confirm');
  if(confirm && confirm.hidden && bulkEditHasWork()){
    confirm.hidden = false;
    const label = $('bulk-edit-confirm-label');
    const ops = bulkPending.filter(p=>p.op !== 'keep').length;
    const parts = [];
    if(bulkSelected.size)parts.push(`${bulkSelected.size} selected item${bulkSelected.size === 1 ? '' : 's'}`);
    if(ops)parts.push(`${ops} chosen change${ops === 1 ? '' : 's'}`);
    if(label && parts.length)label.textContent = `Discard ${parts.join(' and ')}?`;
    confirm.scrollIntoView({block:'nearest'});
    return;
  }
  if(confirm)confirm.hidden = true;
  closeSheet('bulk-edit-sheet');
  bulkStep = 'pick';
  bulkSelected = new Set();
  bulkPending = [];
  bulkReview = null;
  bulkSignatures = null;
  bulkSettingsQuery = '';
}

function setBulkStep(step){
  bulkStep = step;
  const steps = {pick:'bulk-edit-pick',change:'bulk-edit-change',review:'bulk-edit-review'};
  for(const [key,id] of Object.entries(steps)){
    const el = $(id);
    if(el)el.hidden = key !== step;
  }
  // One primary action per step lives in the shared footer.
  const actions = {pick:'bulk-edit-continue',change:'bulk-review-continue',review:'bulk-apply'};
  for(const [key,id] of Object.entries(actions)){
    const el = $(id);
    if(el)el.hidden = key !== step;
  }
  const back = $('bulk-edit-back');
  if(back)back.hidden = step === 'pick';
  const title = $('bulk-edit-title');
  if(title)title.textContent = step === 'pick' ? 'bulk edit' : step === 'change' ? 'choose changes' : 'review changes';
}

// ─────────────────────────────────────────────────────────────────────────
// Step 1: item picker over saved items.
// ─────────────────────────────────────────────────────────────────────────
function bulkPickerRowVisible(h){
  if(typeof isCalendarIgnored === 'function' && isCalendarIgnored(h))return false;
  const snoozed = Boolean(h.snoozedUntil && Date.now() < h.snoozedUntil);
  const done = h.type === 'task' && isTaskDone(h);
  if(snoozed && !bulkFilters.snoozed)return false;
  if(done && !bulkFilters.completed)return false;
  return true;
}

function bulkPickerMatches(h){
  const query = bulkFilters.search.trim().toLowerCase();
  if(query){
    const haystack = `${h.name || ''} ${(h.topics || []).join(' ')}`.toLowerCase();
    if(!haystack.includes(query))return false;
  }
  if(!matchesTypeFilter(h,bulkFilters.type))return false;
  if(bulkFilters.priority !== 'all' && !matchesPriorityFilter(h,bulkFilters.priority))return false;
  if(bulkFilters.topic !== 'all'){
    const topics = (h.topics || []).map(topic=>topic.toLowerCase());
    if(!topics.includes(String(bulkFilters.topic).toLowerCase()))return false;
  }
  if(bulkFilters.location !== 'all'){
    const ids = Array.isArray(h.locationIds) ? h.locationIds : [];
    if(!ids.includes(bulkFilters.location) && h.anywhereAllowed !== true)return false;
  }
  return true;
}

function bulkPickerChoices(){
  const data = load();
  const topics = new Map();
  for(const h of data)for(const topic of h.topics || [])topics.set(topic,(topics.get(topic) || 0) + 1);
  const locations = typeof locationOptions === 'function' ? locationOptions() : [];
  return {
    types:FILTER_TYPE_CHOICES,
    priorities:FILTER_PRIORITY_CHOICES,
    topics:[...topics.keys()].sort((a,b)=>a.localeCompare(b)),
    locations
  };
}

function bulkRenderFilterChips(){
  const host = $('bulk-filter-groups');
  if(!host)return;
  const choices = bulkPickerChoices();
  const group = (kind,title,options,current)=>{
    const chips = options.map(([key,label])=>{
      const on = current === key;
      return `<button type="button" class="home-filter-option bulk-filter-chip${on ? ' on' : ''}" data-bulk-filter="${kind}" data-bulk-filter-value="${escapeHtml(key)}" aria-pressed="${on}"><span><b>${escapeHtml(label)}</b></span></button>`;
    }).join('');
    return `<div class="bulk-filter-group"><span class="settings-sublabel">${title}</span><div class="bulk-filter-chip-row">${chips}</div></div>`;
  };
  host.innerHTML = [
    group('type','type',[['all','all'],...choices.types.map(choice=>[choice.key,choice.label])],bulkFilters.type),
    group('priority','priority',[['all','all'],...choices.priorities.map(choice=>[choice.key,choice.label])],bulkFilters.priority),
    group('topic','topic',[['all','all'],...choices.topics.map(topic=>[topic,topic])],bulkFilters.topic),
    group('location','place',[['all','all'],...choices.locations.map(loc=>[loc.id,loc.name])],bulkFilters.location)
  ].join('');
}

function renderBulkPicker(){
  const data = load();
  const rowsHost = $('bulk-rows');
  if(!rowsHost)return;
  bulkRenderFilterChips();
  const search = $('bulk-search');
  if(search && search.value !== bulkFilters.search)search.value = bulkFilters.search;
  const snoozeToggle = $('bulk-show-snoozed');
  if(snoozeToggle)snoozeToggle.setAttribute('aria-pressed',String(bulkFilters.snoozed));
  const doneToggle = $('bulk-show-completed');
  if(doneToggle)doneToggle.setAttribute('aria-pressed',String(bulkFilters.completed));
  const shown = [];
  const locked = [];
  for(const h of data){
    if(!bulkPickerRowVisible(h))continue;
    if(!bulkPickerMatches(h))continue;
    if(isDeviceCalendarTask(h))locked.push(h);
    else shown.push(h);
  }
  rowsHost.innerHTML = shown.map(h=>{
    const checked = bulkSelected.has(h.hid);
    const sub = bulkSummaryFor(h);
    const badges = [];
    if(h.type === 'task' && isTaskDone(h))badges.push('completed');
    if(h.snoozedUntil && Date.now() < h.snoozedUntil)badges.push('snoozed');
    return `<li>
      <label class="bulk-row${checked ? ' on' : ''}">
        <input type="checkbox" data-bulk-check="${escapeHtml(h.hid)}"${checked ? ' checked' : ''} />
        <span class="bulk-row-emoji" aria-hidden="true">${escapeHtml(h.emoji || '•')}</span>
        <span class="bulk-row-copy"><strong>${escapeHtml(h.name)}</strong><small>${escapeHtml(sub)}</small></span>
        ${badges.length ? `<span class="bulk-row-badges">${badges.map(b=>`<small>${b}</small>`).join('')}</span>` : ''}
      </label>
    </li>`;
  }).join('') + locked.map(h=>`<li><div class="bulk-row locked">
      <span class="bulk-row-emoji" aria-hidden="true">${escapeHtml(h.emoji || '•')}</span>
      <span class="bulk-row-copy"><strong>${escapeHtml(h.name)}</strong><small>managed by your phone calendar</small></span>
    </div></li>`).join('');
  const empty = $('bulk-empty');
  if(empty)empty.hidden = Boolean(shown.length || locked.length);
  // Counts: selection is retained across filter changes; report what the
  // current results do not show.
  const shownIds = new Set(shown.map(h=>h.hid));
  let outside = 0;
  for(const hid of bulkSelected)if(!shownIds.has(hid))outside += 1;
  const count = $('bulk-count');
  if(count)count.textContent = `${bulkSelected.size} selected`;
  const outsideCount = $('bulk-outside-count');
  if(outsideCount){
    outsideCount.hidden = outside === 0;
    outsideCount.textContent = `${outside} selected not in these results`;
  }
  const selectAll = $('bulk-select-all');
  if(selectAll){
    selectAll.textContent = `Select all results (${shown.length})`;
    selectAll.disabled = shown.length === 0;
  }
  const clear = $('bulk-clear-selection');
  if(clear)clear.disabled = bulkSelected.size === 0;
  const cont = $('bulk-edit-continue');
  if(cont){
    cont.textContent = `Edit ${bulkSelected.size} item${bulkSelected.size === 1 ? '' : 's'}`;
    cont.disabled = bulkSelected.size === 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Step 2: choose changes. Every field starts as "keep unchanged"; the
// existing common value or "Mixed" is context only and never activates.
// ─────────────────────────────────────────────────────────────────────────
function bulkCommonValue(opDesc,records,data){
  const values = new Set(records.filter(h=>opDesc.applies(h,data)).map(h=>String(opDesc.current(h))));
  if(values.size === 1)return [...values][0];
  if(values.size === 0)return '';
  return 'Mixed';
}

const BULK_NUMBER_DEFAULTS = {duration:20,minChunk:15,minGap:0,earlyWindow:0,delayAllowance:0,autoMark:0,sessionTarget:20};

function bulkDefaultNumber(opDesc){
  return BULK_NUMBER_DEFAULTS[opDesc.id] ?? (opDesc.numberMin != null && opDesc.numberMin > 0 ? opDesc.numberMin : 0);
}

function bulkEnsurePending(opDesc){
  let pending = bulkPending.find(p=>p.id === opDesc.id);
  if(!pending){
    pending = {id:opDesc.id,op:'keep',value:null};
    bulkPending.push(pending);
  }
  return pending;
}

function bulkDefaultValue(opDesc,op,records){
  switch(opDesc.valueKind){
    case 'topics':case 'places':case 'monthdays':case 'ordinal':return [];
    case 'number':return bulkDefaultNumber(opDesc);
    case 'date':{
      const common = records.map(h=>h.dueDate).filter(v=>v != null);
      if(common.length && new Set(common.map(v=>new Date(v).toDateString())).size === 1)return new Date(common[0]).toISOString().slice(0,10);
      return '';
      }
    case 'time':{
      const minutes = records.map(h=>h.eventTime).filter(v=>v != null).map(v=>Math.round((v - dayStart(v)) / 60000));
      if(minutes.length && new Set(minutes).size === 1)return minutesToTimeInput(minutes[0]);
      return '';
      }
    case 'window':return {start:'08:00',end:'12:00'};
    case 'weekdays':{
      const first = records.find(h=>Array.isArray(h.allowedWeekdays));
      return first ? first.allowedWeekdays.slice() : [];
      }
    case 'rhythm':{
      const first = records.find(h=>h.type === 'keepup' || h.type === 'reduce');
      const parts = first ? rhythmParts(first.target) : {times:1,days:7};
      return {times:parts.times,days:parts.days};
      }
    case 'emoji':return '';
    case 'color':return '';
    case 'profile':return {mode:'inherit',id:''};
    case 'place':return '';
    case 'placepref':{
      const first = records.find(h=>Array.isArray(h.locationIds) && h.locationIds.length);
      return {locationId:first ? first.locationIds[0] : '',level:'high'};
      }
    default:return null;
  }
}

function bulkChipRow(id,options,selected,attr){
  const selectedSet = new Set((selected || []).map(String));
  return options.map(([key,label])=>{
    const on = selectedSet.has(String(key));
    return `<button type="button" class="topic-chip${on ? ' on' : ''}" data-bulk-chip="${id}" ${attr}="${escapeHtml(key)}" aria-pressed="${on}">${escapeHtml(label)}</button>`;
  }).join('');
}

function bulkValueControlHtml(opDesc,pending,data){
  const kind = opDesc.valueKind;
  const id = opDesc.id;
  const value = pending.value;
  switch(kind){
    case 'none':return '';
    case 'number':
      return `<label class="range-value"><input type="number" data-bulk-field="${id}" data-bulk-kind="number" min="${opDesc.numberMin ?? 0}" max="${opDesc.numberMax ?? 720}" inputmode="numeric" value="${value == null ? '' : escapeHtml(String(value))}" /><span>min</span></label>`;
    case 'priority':
      return `<select class="mini-select" data-bulk-field="${id}" data-bulk-kind="priority">${PRIORITY_LABELS.map((label,p)=>`<option value="${p}"${Number(value) === p ? ' selected' : ''}>${label} · ${bulkPriorityWord(p)}</option>`).join('')}</select>`;
    case 'topics':{
      const records = bulkSelectedRecords(data);
      const known = new Set();
      for(const h of data)for(const topic of h.topics || [])known.add(topic);
      for(const h of records)for(const topic of h.topics || [])known.add(topic);
      const choices = [...known].sort((a,b)=>a.localeCompare(b)).map(topic=>[topic,topic]);
      return `<div class="bulk-chip-wrap" data-bulk-kind="topics" data-bulk-field="${id}"><div class="topic-chip-row">${bulkChipRow(id,choices,value,'data-bulk-value')}</div>
        <div class="bulk-topic-add"><input type="text" maxlength="32" placeholder="new topic" aria-label="new topic name" data-bulk-new-topic="${id}" /><button type="button" class="mini-text-btn" data-bulk-add-topic="${id}">add</button></div></div>`;
      }
    case 'places':{
      const locations = typeof locationOptions === 'function' ? locationOptions() : [];
      return `<div class="topic-chip-row" data-bulk-kind="places" data-bulk-field="${id}">${bulkChipRow(id,locations.map(loc=>[loc.id,loc.name]),value,'data-bulk-value')}</div>`;
      }
    case 'date':
      return `<input type="date" class="plan-date-input" data-bulk-field="${id}" data-bulk-kind="date" value="${escapeHtml(String(value || ''))}" />`;
    case 'time':
      return `<input type="time" class="plan-time-input" step="300" data-bulk-field="${id}" data-bulk-kind="time" value="${escapeHtml(String(value || ''))}" />`;
    case 'window':
      return `<div class="bulk-window" data-bulk-kind="window" data-bulk-field="${id}">
        <input type="time" class="plan-time-input" step="300" aria-label="window start" data-bulk-field="${id}" data-bulk-window-part="start" value="${escapeHtml(value && value.start || '')}" />
        <span aria-hidden="true">–</span>
        <input type="time" class="plan-time-input" step="300" aria-label="window end" data-bulk-field="${id}" data-bulk-window-part="end" value="${escapeHtml(value && value.end || '')}" />
      </div>`;
    case 'weekdays':
      return `<div class="schedule-chip-row" role="group" aria-label="weekdays" data-bulk-kind="weekdays" data-bulk-field="${id}">${WEEKDAY_LABELS.map((label,day)=>`<button type="button" class="schedule-chip${Array.isArray(value) && value.includes(day) ? ' on' : ''}" data-bulk-weekday="${id}" data-bulk-value="${day}" aria-pressed="${Array.isArray(value) && value.includes(day)}">${label}</button>`).join('')}</div>`;
    case 'monthdays':
      return `<input type="text" inputmode="numeric" placeholder="e.g. 1, 15" aria-label="dates of the month" data-bulk-field="${id}" data-bulk-kind="monthdays" value="${escapeHtml(Array.isArray(value) ? value.join(', ') : '')}" />`;
    case 'ordinal':
      return `<div class="bulk-window" data-bulk-kind="ordinal" data-bulk-field="${id}">
        <select class="mini-select" aria-label="week of month" data-bulk-ordinal-part="ordinal"><option value="1">first</option><option value="2">second</option><option value="3">third</option><option value="4">fourth</option><option value="5">fifth</option><option value="-1">last</option></select>
        <select class="mini-select" aria-label="weekday" data-bulk-ordinal-part="weekday">${WEEKDAY_LABELS.map((label,day)=>`<option value="${day}">${label}</option>`).join('')}</select>
        <button type="button" class="mini-text-btn" data-bulk-add-ordinal="${id}">add rule</button>
      </div>
      <p class="field-hint" data-bulk-ordinal-list="${id}">${bulkOrdinalLabel(value)}</p>`;
    case 'rhythm':
      return `<div class="bulk-window" data-bulk-kind="rhythm" data-bulk-field="${id}">
        <label class="range-value"><input type="number" min="1" max="30" inputmode="numeric" aria-label="times" data-bulk-field="${id}" data-bulk-rhythm-part="times" value="${escapeHtml(String(value && value.times != null ? value.times : 1))}" /><span>times</span></label>
        <span class="rhythm-in">every</span>
        <label class="range-value"><input type="number" min="1" max="183" inputmode="numeric" aria-label="days" data-bulk-field="${id}" data-bulk-rhythm-part="days" value="${escapeHtml(String(value && value.days != null ? value.days : 7))}" /><span>days</span></label>
      </div>`;
    case 'emoji':
      return `<input type="text" class="emoji-input" maxlength="64" aria-label="emoji" data-bulk-field="${id}" data-bulk-kind="emoji" value="${escapeHtml(String(value || ''))}" />`;
    case 'color':
      return `<select class="mini-select" data-bulk-field="${id}" data-bulk-kind="color"><option value=""${!value ? ' selected' : ''}>default</option>${EMOJI_BG_COLOR_TOKENS.map(token=>`<option value="${token}"${value === token ? ' selected' : ''}>${token}</option>`).join('')}</select>`;
    case 'profile':{
      const profiles = sortSettings?.weatherProfiles || [];
      return `<select class="mini-select" data-bulk-field="${id}" data-bulk-kind="profile">
        <option value="inherit"${value && value.mode === 'inherit' ? ' selected' : ''}>use the place’s weather</option>
        <option value="__none__"${value && value.mode === 'none' ? ' selected' : ''}>ignore weather rules</option>
        ${profiles.map(p=>`<option value="${escapeHtml(p.id)}"${value && value.mode === 'profile' && value.id === p.id ? ' selected' : ''}>${escapeHtml(p.name || p.id)}</option>`).join('')}
      </select>`;
      }
    case 'place':{
      const locations = typeof locationOptions === 'function' ? locationOptions() : [];
      return `<select class="mini-select" data-bulk-field="${id}" data-bulk-kind="place"><option value="">pick a place</option>${locations.map(loc=>`<option value="${escapeHtml(loc.id)}"${value === loc.id ? ' selected' : ''}>${escapeHtml(loc.name)}</option>`).join('')}</select>`;
      }
    case 'placepref':{
      const locations = typeof locationOptions === 'function' ? locationOptions() : [];
      return `<div class="bulk-window" data-bulk-kind="placepref" data-bulk-field="${id}">
        <select class="mini-select" aria-label="place" data-bulk-pref-part="locationId"><option value="">pick a place</option>${locations.map(loc=>`<option value="${escapeHtml(loc.id)}"${value && value.locationId === loc.id ? ' selected' : ''}>${escapeHtml(loc.name)}</option>`).join('')}</select>
        <select class="mini-select" aria-label="preference" data-bulk-pref-part="level"><option value="high"${value && value.level === 'high' ? ' selected' : ''}>prefer</option><option value="little"${value && value.level === 'little' ? ' selected' : ''}>slightly prefer</option><option value="avoid"${value && value.level === 'avoid' ? ' selected' : ''}>avoid</option></select>
      </div>`;
      }
    default:return '';
  }
}

function bulkAppliesLine(opDesc,pending,records,data){
  if(pending.op === 'keep')return '';
  const {ok,excluded} = bulkApplicability(opDesc,records,data);
  const bits = [`Applies to ${ok} of ${records.length}`];
  for(const [reason,count] of Object.entries(excluded))bits.push(`${reason}: ${count}`);
  return bits.join(' · ');
}

function renderBulkEditStep(){
  const host = $('bulk-edit-rows');
  if(!host)return;
  const data = load();
  const records = bulkSelectedRecords(data);
  if(!records.length){host.innerHTML = '';return;}
  const query = bulkSettingsQuery.trim().toLowerCase();
  const groups = bulkGroupOrder();
  const commonOps = BULK_FIELD_OPS.filter(op=>op.common);
  const matchesQuery = op=>!query || `${op.label} ${op.hint || ''} ${op.group}`.toLowerCase().includes(query);
  const row = op=>{
    const pending = bulkPending.find(p=>p.id === op.id) || {id:op.id,op:'keep',value:null};
    const common = bulkCommonValue(op,records,data);
    const applies = bulkAppliesLine(op,pending,records,data);
    return `<div class="bulk-op-row" data-bulk-op-row="${op.id}">
      <div class="bulk-op-head">
        <span class="bulk-op-label"><strong>${escapeHtml(op.label)}</strong><small>${escapeHtml(op.hint || '')}</small></span>
        <select class="mini-select bulk-op-select" data-bulk-op="${op.id}" aria-label="${escapeHtml(op.label)} operation">
          ${op.choices.map(choice=>`<option value="${choice.key}"${pending.op === choice.key ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`).join('')}
        </select>
      </div>
      <p class="bulk-op-context">now: ${escapeHtml(common || '—')}</p>
      <div class="bulk-op-value"${pending.op === 'keep' ? ' hidden' : ''}>${bulkValueControlHtml(op,pending,data)}</div>
      <p class="bulk-op-applies" data-bulk-applies="${op.id}"${applies ? '' : ' hidden'}>${escapeHtml(applies)}</p>
    </div>`;
  };
  const section = (title,ops,open)=>`<details class="bulk-group"${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary>${ops.filter(matchesQuery).map(row).join('')}</details>`;
  const parts = [];
  if(commonOps.some(matchesQuery))parts.push(`<div class="bulk-group-common">${commonOps.filter(matchesQuery).map(row).join('')}</div>`);
  for(const group of groups){
    const ops = BULK_FIELD_OPS.filter(op=>op.group === group && !op.common);
    if(!ops.some(matchesQuery))continue;
    parts.push(section(group,ops,query !== ''));
  }
  host.innerHTML = parts.join('') || '<p class="field-hint">No settings match.</p>';
  const cont = $('bulk-review-continue');
  if(cont)cont.textContent = 'review changes';
}

function bulkPendingFor(id){
  const opDesc = bulkOpById(id);
  if(!opDesc)return null;
  return bulkEnsurePending(opDesc);
}

function bulkRefreshApplies(id){
  const opDesc = bulkOpById(id);
  if(!opDesc)return;
  const pending = bulkPending.find(p=>p.id === id);
  const line = $('bulk-edit-rows')?.querySelector(`[data-bulk-applies="${id}"]`);
  if(!line)return;
  const data = load();
  const text = bulkAppliesLine(opDesc,pending || {id,op:'keep',value:null},bulkSelectedRecords(data),data);
  line.hidden = !text;
  line.textContent = text;
}

function bulkReadControlValue(opDesc,host){
  const kind = opDesc.valueKind;
  const pending = bulkPending.find(p=>p.id === opDesc.id);
  switch(kind){
    case 'number':{
      const raw = host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="number"]`)?.value;
      return raw === '' || raw == null ? null : Number(raw);
      }
    case 'priority':
      return Number(host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="priority"]`)?.value || 2);
    case 'topics':
      return [...host.querySelectorAll(`[data-bulk-chip="${opDesc.id}"][aria-pressed="true"]`)].map(el=>el.dataset.bulkValue);
    case 'places':
      return [...host.querySelectorAll(`[data-bulk-chip="${opDesc.id}"][aria-pressed="true"]`)].map(el=>el.dataset.bulkValue);
    case 'date':
      return host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="date"]`)?.value || '';
    case 'time':
      return host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="time"]`)?.value || '';
    case 'window':
      return {
        start:host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-window-part="start"]`)?.value || '',
        end:host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-window-part="end"]`)?.value || ''
      };
    case 'weekdays':
      return [...host.querySelectorAll(`[data-bulk-weekday="${opDesc.id}"][aria-pressed="true"]`)].map(el=>Number(el.dataset.bulkValue));
    case 'monthdays':
      return (host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="monthdays"]`)?.value || '')
        .split(',').map(part=>Number(part.trim())).filter(n=>Number.isFinite(n) && n >= 1 && n <= 31);
    case 'ordinal':return pending?.value || [];
    case 'rhythm':
      return {
        times:Number(host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-rhythm-part="times"]`)?.value || 1),
        days:Number(host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-rhythm-part="days"]`)?.value || 7)
      };
    case 'emoji':
      return host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="emoji"]`)?.value || '';
    case 'color':
      return host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="color"]`)?.value || '';
    case 'profile':{
      const raw = host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="profile"]`)?.value;
      if(raw === '__none__')return {mode:'none',id:''};
      if(raw && raw !== 'inherit')return {mode:'profile',id:raw};
      return {mode:'inherit',id:''};
      }
    case 'place':
      return host.querySelector(`[data-bulk-field="${opDesc.id}"][data-bulk-kind="place"]`)?.value || '';
    case 'placepref':
      return {
        locationId:host.querySelector(`[data-bulk-pref-part="locationId"]`)?.value || '',
        level:host.querySelector(`[data-bulk-pref-part="level"]`)?.value || 'high'
      };
    default:return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Step 3: review.
// ─────────────────────────────────────────────────────────────────────────
function bulkComputeReview(){
  const data = load();
  const records = data.filter(h=>bulkSelected.has(h.hid));
  const active = bulkPending.filter(p=>p.op !== 'keep' && bulkOpById(p.id));
  const perItem = [];
  const opCounts = new Map(); // op id -> applied count
  const opUnchanged = new Map(); // op id -> applicable but same value
  for(const record of records){
    const changes = [];
    for(const pending of active){
      const opDesc = bulkOpById(pending.id);
      if(!opDesc.applies(record,data))continue;
      const probe = bulkClone(record);
      opDesc.apply(probe,pending.op,pending.value,data);
      if(bulkRecordDiffers(record,probe)){
        changes.push({id:pending.id,label:opDesc.label,before:opDesc.current(record),after:opDesc.current(probe)});
        opCounts.set(pending.id,(opCounts.get(pending.id) || 0) + 1);
      }else{
        opUnchanged.set(pending.id,(opUnchanged.get(pending.id) || 0) + 1);
      }
    }
    if(changes.length)perItem.push({hid:record.hid,name:record.name,changes});
  }
  const opLines = [];
  for(const pending of active){
    const opDesc = bulkOpById(pending.id);
    const applied = opCounts.get(pending.id) || 0;
    const unchanged = opUnchanged.get(pending.id) || 0;
    // Describe with the first item that actually changes, falling back to a
    // generic label when nothing changes.
    const first = perItem.find(item=>item.changes.some(change=>change.id === pending.id));
    let label = opDesc.label;
    if(first){
      const probeRecord = records.find(h=>h.hid === first.hid);
      label = opDesc.changeLabel ? opDesc.changeLabel(probeRecord,pending.op,pending.value) : opDesc.label;
    }
    let line = `${label}: ${applied} item${applied === 1 ? '' : 's'}`;
    if(unchanged)line += `; ${unchanged} already ${pending.op === 'add' ? 'has it' : 'unchanged'}`;
    const excludedCounts = {};
    for(const record of records){
      if(opDesc.applies(record,data))continue;
      const reason = bulkOpBlocked(record,opDesc) || (opDesc.blockedReason ? opDesc.blockedReason(record) : 'unavailable');
      excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
    }
    for(const [reason,count] of Object.entries(excludedCounts))line += `; ${count} ${reason}`;
    opLines.push(line);
  }
  const plan = perItem.map(item=>({hid:item.hid,changes:active.filter(pending=>item.changes.some(change=>change.id === pending.id)).map(pending=>({id:pending.id,op:pending.op,value:pending.value}))}));
  const {errors,warnings} = bulkValidatePlan(records,plan,data);
  return {perItem,opLines,errors,warnings,changing:perItem.length,selected:records.length,active};
}

function renderBulkReview(){
  const host = $('bulk-edit-review');
  if(!host)return;
  const review = bulkComputeReview();
  bulkReview = review;
  const summary = $('bulk-review-summary');
  if(summary)summary.textContent = `${review.selected} selected · ${review.changing} will change`;
  const lines = $('bulk-review-lines');
  if(lines){
    lines.innerHTML = review.opLines.length
      ? review.opLines.map(line=>`<li>${escapeHtml(line)}</li>`).join('')
      : '<li class="field-hint">No changes chosen yet.</li>';
  }
  const items = $('bulk-review-items');
  if(items){
    items.innerHTML = review.perItem.map(item=>`<details class="bulk-review-item"><summary>${escapeHtml(item.name)} · ${item.changes.length} change${item.changes.length === 1 ? '' : 's'}</summary><ul>${item.changes.map(change=>`<li><strong>${escapeHtml(change.label)}</strong>: ${escapeHtml(String(change.before))} → ${escapeHtml(String(change.after))}</li>`).join('')}</ul></details>`).join('');
  }
  const problems = $('bulk-review-problems');
  if(problems){
    const errorLines = review.errors.map(e=>`<li class="bulk-problem-error">${escapeHtml(e.name)}: ${escapeHtml(e.message)}</li>`);
    const warnLines = review.warnings.map(w=>`<li class="bulk-problem-warn">${escapeHtml(w.name)}: ${escapeHtml(w.message)}</li>`);
    problems.hidden = !(errorLines.length || warnLines.length);
    problems.innerHTML = errorLines.concat(warnLines).join('');
  }
  const notice = $('bulk-review-notice');
  if(notice){
    notice.hidden = !bulkStaleNotice;
    if(bulkStaleNotice)notice.textContent = 'Data changed since review — check the updated changes.';
  }
  const confirmBtn = $('bulk-review-confirm');
  if(confirmBtn)confirmBtn.hidden = bulkReviewConfirmed || !bulkStaleNotice;
  const apply = $('bulk-apply');
  if(apply){
    const hasErrors = review.errors.length > 0;
    const noChanges = review.changing === 0;
    apply.disabled = hasErrors || noChanges || (bulkStaleNotice && !bulkReviewConfirmed);
    apply.textContent = noChanges ? 'nothing to change' : `Apply to ${review.changing} item${review.changing === 1 ? '' : 's'}`;
  }
}

function refreshBulkReviewAfterStaleness(){
  bulkSignatures = null;
  bulkStaleNotice = true;
  bulkReviewConfirmed = false;
  renderBulkReview();
}

function bulkBeginReview(){
  const data = load();
  const records = data.filter(h=>bulkSelected.has(h.hid));
  const active = bulkPending.filter(p=>p.op !== 'keep' && bulkOpById(p.id));
  const plan = bulkBuildPlan(records,active,data);
  bulkSignatures = bulkPlanSignature(records,plan,data);
  bulkStaleNotice = false;
  bulkReviewConfirmed = true;
  setBulkStep('review');
  renderBulkReview();
}

function bulkApplyChanges(){
  if(!bulkReview)bulkBeginReview();
  const data = load();
  const records = data.filter(h=>bulkSelected.has(h.hid));
  if(!records.length)return;
  const active = bulkPending.filter(p=>p.op !== 'keep' && bulkOpById(p.id));
  if(!active.length)return;
  // Re-read happened above; if anything under review moved, force a fresh look.
  if(bulkSignatures && !bulkSignatureMatches(records,bulkSignatures)){
    refreshBulkReviewAfterStaleness();
    return;
  }
  // Cancel scheduled pushes for tasks whose timing is about to change; the
  // regular reminder pass reschedules from saved data after the render.
  for(const record of records){
    if(record.type !== 'task')continue;
    if(typeof cancelPush !== 'function' || typeof reminderSignature !== 'function')continue;
    const touchesTiming = active.some(pending=>{
      const opDesc = bulkOpById(pending.id);
      if(!opDesc || !opDesc.applies(record,data))return false;
      const fields = bulkOpImportOwned(opDesc.id);
      return fields.some(field=>['dueDate','eventTime','delayAllowanceDays','snoozedUntil'].includes(field));
    });
    if(touchesTiming)cancelPush(reminderSignature(record));
  }
  const undoEntries = [];
  for(const record of records){
    for(const pending of active){
      const opDesc = bulkOpById(pending.id);
      if(!opDesc.applies(record,data))continue;
      const entry = bulkApplyChange(record,opDesc,pending.op,pending.value,data);
      if(entry)undoEntries.push(entry);
    }
  }
  if(!undoEntries.length){
    refreshBulkReviewAfterStaleness();
    return;
  }
  if(!save(data)){
    // Records were mutated in the working copy only; a retry reloads fresh.
    showToast('could not save — try again');
    return;
  }
  const usesWeather = records.some(h=>h.weatherProfileMode !== 'none' || h.showWeather);
  showActionToast(`Updated ${records.length} item${records.length === 1 ? '' : 's'}`,{type:'bulk-edit',changes:undoEntries,openAction:false,undoLabel:'undo'});
  // Work is committed — close without the discard guard.
  bulkSelected = new Set();
  bulkPending = [];
  bulkReview = null;
  closeBulkEditSheet();
  refreshOpenViews();
  if(usesWeather && typeof refreshWeatherForecast === 'function')void refreshWeatherForecast();
}

// ─────────────────────────────────────────────────────────────────────────
// Wiring.
// ─────────────────────────────────────────────────────────────────────────
$('bulk-edit-close')?.addEventListener('click',()=>closeBulkEditSheet());
$('bulk-edit-confirm-yes')?.addEventListener('click',()=>{
  bulkSelected = new Set();
  bulkPending = [];
  closeBulkEditSheet();
});
$('bulk-edit-confirm-no')?.addEventListener('click',()=>{
  if($('bulk-edit-confirm'))$('bulk-edit-confirm').hidden = true;
});
$('bulk-edit-back')?.addEventListener('click',()=>{
  if(bulkStep === 'review'){
    setBulkStep('change');
    renderBulkEditStep();
  }else if(bulkStep === 'change')setBulkStep('pick');
  else closeBulkEditSheet();
});
$('bulk-edit-sheet')?.addEventListener('click',e=>{
  if(e.target === e.currentTarget)closeBulkEditSheet();
});
$('bulk-search')?.addEventListener('input',e=>{
  bulkFilters.search = e.target.value;
  renderBulkPicker();
});
$('bulk-filter-groups')?.addEventListener('click',e=>{
  const chip = e.target.closest('[data-bulk-filter]');
  if(!chip)return;
  const kind = chip.dataset.bulkFilter;
  const value = chip.dataset.bulkFilterValue;
  if(kind === 'type')bulkFilters.type = value;
  else if(kind === 'priority')bulkFilters.priority = value;
  else if(kind === 'topic')bulkFilters.topic = value;
  else if(kind === 'location')bulkFilters.location = value;
  renderBulkPicker();
});
$('bulk-show-snoozed')?.addEventListener('click',e=>{
  const pressed = e.currentTarget.getAttribute('aria-pressed') === 'true';
  bulkFilters.snoozed = !pressed;
  renderBulkPicker();
});
$('bulk-show-completed')?.addEventListener('click',e=>{
  const pressed = e.currentTarget.getAttribute('aria-pressed') === 'true';
  bulkFilters.completed = !pressed;
  renderBulkPicker();
});
$('bulk-rows')?.addEventListener('change',e=>{
  const input = e.target.closest('[data-bulk-check]');
  if(!input)return;
  const hid = input.dataset.bulkCheck;
  if(input.checked)bulkSelected.add(hid);
  else bulkSelected.delete(hid);
  renderBulkPicker();
});
$('bulk-select-all')?.addEventListener('click',()=>{
  const data = load();
  for(const h of data){
    if(!bulkPickerRowVisible(h) || !bulkPickerMatches(h))continue;
    if(isDeviceCalendarTask(h))continue;
    bulkSelected.add(h.hid);
  }
  renderBulkPicker();
});
$('bulk-clear-selection')?.addEventListener('click',()=>{
  bulkSelected.clear();
  renderBulkPicker();
});
$('bulk-edit-continue')?.addEventListener('click',()=>{
  if(!bulkSelected.size)return;
  bulkPending = [];
  setBulkStep('change');
  renderBulkEditStep();
});
$('bulk-settings-search')?.addEventListener('input',e=>{
  bulkSettingsQuery = e.target.value;
  renderBulkEditStep();
});
$('bulk-review-continue')?.addEventListener('click',()=>{
  if(!bulkSelected.size)return;
  bulkBeginReview();
});
$('bulk-edit-rows')?.addEventListener('change',e=>{
  const opSelect = e.target.closest('[data-bulk-op]');
  if(opSelect){
    const id = opSelect.dataset.bulkOp;
    const opDesc = bulkOpById(id);
    if(!opDesc)return;
    const pending = bulkPendingFor(id);
    pending.op = opSelect.value;
    if(pending.op === 'keep')pending.value = null;
    else if(opDesc.valueKind !== 'none' && pending.value == null)pending.value = bulkDefaultValue(opDesc,pending.op,bulkSelectedRecords());
    // Structural change (new controls) — repaint the whole step.
    renderBulkEditStep();
    return;
  }
  const field = e.target.closest('[data-bulk-field]');
  if(!field)return;
  const id = field.dataset.bulkField;
  const opDesc = bulkOpById(id);
  if(!opDesc)return;
  const pending = bulkPendingFor(id);
  const host = field.closest('.bulk-op-row');
  pending.value = bulkReadControlValue(opDesc,host);
  bulkRefreshApplies(id);
});
$('bulk-edit-rows')?.addEventListener('click',e=>{
  const chip = e.target.closest('[data-bulk-chip]');
  if(chip){
    const on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed',String(!on));
    chip.classList.toggle('on',!on);
    const id = chip.dataset.bulkChip;
    const opDesc = bulkOpById(id);
    const host = chip.closest('.bulk-op-row');
    if(opDesc && host){
      const pending = bulkPendingFor(id);
      pending.value = bulkReadControlValue(opDesc,host);
      bulkRefreshApplies(id);
    }
    return;
  }
  const weekday = e.target.closest('[data-bulk-weekday]');
  if(weekday){
    const on = weekday.getAttribute('aria-pressed') === 'true';
    weekday.setAttribute('aria-pressed',String(!on));
    weekday.classList.toggle('on',!on);
    const id = weekday.dataset.bulkWeekday;
    const opDesc = bulkOpById(id);
    const host = weekday.closest('.bulk-op-row');
    if(opDesc && host){
      const pending = bulkPendingFor(id);
      pending.value = bulkReadControlValue(opDesc,host);
      bulkRefreshApplies(id);
    }
    return;
  }
  const addTopic = e.target.closest('[data-bulk-add-topic]');
  if(addTopic){
    const id = addTopic.dataset.bulkAddTopic;
    const input = addTopic.closest('.bulk-op-row')?.querySelector('[data-bulk-new-topic]');
    const topic = bulkCleanTopic(input?.value);
    if(!topic || !input)return;
    const opDesc = bulkOpById(id);
    const pending = bulkPendingFor(id);
    if(opDesc && Array.isArray(pending.value))pending.value = [...pending.value,topic];
    if(input)input.value = '';
    renderBulkEditStep();
    return;
  }
  const addOrdinal = e.target.closest('[data-bulk-add-ordinal]');
  if(addOrdinal){
    const id = addOrdinal.dataset.bulkAddOrdinal;
    const host = addOrdinal.closest('.bulk-op-row');
    const ordinal = Number(host?.querySelector('[data-bulk-ordinal-part="ordinal"]')?.value || 1);
    const weekday = Number(host?.querySelector('[data-bulk-ordinal-part="weekday"]')?.value || 1);
    const opDesc = bulkOpById(id);
    const pending = bulkPendingFor(id);
    if(opDesc){
      if(!Array.isArray(pending.value))pending.value = [];
      pending.value = [...pending.value,{ordinal,weekday}];
      const list = host?.querySelector(`[data-bulk-ordinal-list="${id}"]`);
      if(list)list.textContent = bulkOrdinalLabel(pending.value);
    }
  }
});
$('bulk-apply')?.addEventListener('click',bulkApplyChanges);
$('bulk-review-confirm')?.addEventListener('click',()=>{
  bulkReviewConfirmed = true;
  renderBulkReview();
});
