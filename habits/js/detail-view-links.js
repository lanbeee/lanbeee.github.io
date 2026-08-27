/** RENDER: recurring Schedule links + temporary reorder links on Actions. */
function renderDetailOrderPage(h = null){
  const block = $('detail-order-block');
  const list = $('detail-order-list');
  const clearBtn = $('detail-order-clear-all');
  if(!block || !list)return;
  const habit = h || (detailIdx != null ? load()[detailIdx] : null);
  if(!habit || !habit.hid || typeof orderConstraintsForHid !== 'function'){
    block.hidden = true;
    if(clearBtn)clearBtn.hidden = true;
    return;
  }
  const edges = orderConstraintsForHid(habit.hid);
  const persistentLinks = normalizeScheduleLinks(habit.scheduleLinks,habit.hid);
  block.hidden = edges.length === 0 && persistentLinks.length === 0;
  if(clearBtn){
    clearBtn.hidden = edges.length === 0;
    clearBtn.dataset.orderClearHid = habit.hid;
  }
  if(!edges.length && !persistentLinks.length){
    list.innerHTML = '';
    return;
  }
  const data = load();
  const recurringHtml = persistentLinks.map(link=>{
    const other = data.find(item=>item && item.hid === link.anchorHid);
    const direction = link.direction || 'after';
    const label = `${link.adjacency === 'direct' ? 'right ' : ''}${direction} ${other && other.name || 'missing habit'}`;
    const mark = other ? orderMarkChipHtml({
      kind:direction,
      adjacency:link.adjacency,
      persistent:true,
      otherEmoji:other.emoji || '',
      otherBg:other.emojiBgColor || '',
      otherName:other.name || 'habit'
    }) : '';
    return `<div class="detail-order-row">
      ${mark}
        <span class="detail-order-meta">recurring · ${escapeHtml(label)}${link.requireSameDay ? ` · must do with ${escapeHtml(other && other.name || 'the other habit')} when flex allows` : ''}</span>
      <span class="detail-order-edit-note">Schedule</span>
    </div>`;
  }).join('');
  const byDay = new Map();
  for(const edge of edges){
    if(!byDay.has(edge.dayBase))byDay.set(edge.dayBase,[]);
    byDay.get(edge.dayBase).push(edge);
  }
  const dayBases = [...byDay.keys()].sort((a,b)=>a - b);
  list.innerHTML = recurringHtml + dayBases.map(dayBase=>{
    const dayLabel = typeof formatOrderDayLabel === 'function'
      ? formatOrderDayLabel(dayBase)
      : new Date(dayBase).toLocaleDateString();
    return byDay.get(dayBase).map(edge=>{
      const isAfter = edge.afterHid === habit.hid;
      const otherHid = isAfter ? edge.beforeHid : edge.afterHid;
      const other = data.find(item=>item && item.hid === otherHid);
      const adj = edge.adjacency === 'direct' ? 'next' : 'later';
      const mark = other
        ? orderMarkChipHtml({
          kind:isAfter ? 'after' : 'before',
          adjacency:edge.adjacency,
          otherEmoji:other.emoji || '',
          otherBg:other.emojiBgColor || '',
          otherName:other.name || 'task'
        })
        : `<span class="order-mark"><i class="ti ${isAfter ? 'ti-arrow-up' : 'ti-arrow-down'}" aria-hidden="true"></i><span class="order-mark-emoji is-empty">·</span></span>`;
      return `<div class="detail-order-row">
        ${mark}
        <span class="detail-order-meta">${escapeHtml(dayLabel)} · ${adj}</span>
        <button type="button" class="mini-text-btn detail-order-unlink" data-order-unlink="${escapeHtml(edge.id)}">unlink</button>
      </div>`;
    }).join('');
  }).join('');
}

// PURE: builds header subtitle from habit state
function detailHeaderLine(h){
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  if(h.type === 'task'){
    const parts = [];
    if(h.eventTime !== null)parts.push(scheduledWhenLabel(h.eventTime));
    else parts.push(cardCue(h));
    if(!minimal && h.durationMinutes)parts.push(`${h.durationMinutes}m`);
    if(!minimal && hasDaySchedule(h)){
      const next = nextEligibleShort(h);
      if(next)parts.push(next);
    }
    return parts.filter(Boolean).join(' · ');
  }
  const parts = [cardCue(h)];
  if(minimal)return parts.filter(Boolean).join(' · ');
  if(h.durationMinutes)parts.push(`${h.durationMinutes}m`);
  if(hasDaySchedule(h)){
    const next = nextEligibleShort(h);
    if(next)parts.push(next);
  }
  if(hasTimeWindow(h))parts.push(timeWindowSummary(h));
  return parts.filter(Boolean).join(' · ');
}

// PURE: format a scheduled time as a friendly label
function scheduledWhenLabel(ts){
  const left = daysUntil(ts);
  const time = new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  if(left === null)return '';
  if(left < 0)return `ended ${entryWhen(ts)}`;
  if(left === 0)return `today ${time}`;
  if(left === 1)return `tomorrow ${time}`;
  if(left <= 6)return `${new Date(ts).toLocaleDateString(undefined,{weekday:'short'})} ${time}`;
  return `${new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${time}`;
}

// RENDER: fills allowed/preferred time window input fields
//
// Each of the four endpoints (allowed start/end, preferred start/end) is a
// per-endpoint editor that swaps between two modes:
//   • fixed  → a single <input type="time"> (the legacy behaviour)
//   • dynamic → a <select> of prayer anchors + signed-minute offset + live
//              preview of the resolved clock time
// The gear button toggles modes; the underlying time-endpoint element holds
// both controls and shows the one that matches the habit's current state.
function renderTimeWindowInputs(h = {}){
  populateAnchorOptions();
  renderTimeEndpoint($('detail-time-start').closest('.time-endpoint'), 'allowedTimeStart', h);
  renderTimeEndpoint($('detail-time-end').closest('.time-endpoint'), 'allowedTimeEnd', h);
  renderTimeEndpoint($('detail-preferred-time-start').closest('.time-endpoint'), 'preferredTimeStart', h);
  renderTimeEndpoint($('detail-preferred-time-end').closest('.time-endpoint'), 'preferredTimeEnd', h);
  syncTimeClearBtn();
}

function scheduleLinkHabitOptions(subjectHid,selectedHid){
  const items = typeof load === 'function' ? load() : [];
  const options = ['<option value="">— choose habit —</option>'];
  for(const item of items){
    if(!item || cleanHabitId(item.hid) === cleanHabitId(subjectHid) || item.type === 'zero')continue;
    const hid = cleanHabitId(item.hid);
    options.push(`<option value="${escapeHtml(hid)}"${hid === selectedHid ? ' selected' : ''}>${escapeHtml((item.name || 'untitled').slice(0,60))}</option>`);
  }
  return options.join('');
}

function scheduleLinkEditorHtml(link,subjectHid,idx){
  const direction = link && link.direction === 'before' ? 'before' : 'after';
  const adjacency = link && link.adjacency === 'direct' ? 'direct' : 'sometime';
  const anchorHid = link ? link.anchorHid : '';
  const sameDay = Boolean(link && link.requireSameDay);
  const helpId = `detail-link-same-day-help-${idx}`;
  const anchor = (typeof load === 'function' ? load() : []).find(item=>item && item.hid === anchorHid);
  const anchorName = anchor && anchor.name || 'the other habit';
  const adjLabel = direction === 'before' ? 'before' : 'after';
  return `<div class="schedule-link-editor" data-link-index="${idx}">
    <div class="schedule-link-main">
      <div class="seg schedule-link-direction" role="group" aria-label="link direction">
        <button type="button" class="seg-opt${direction === 'after' ? ' on' : ''}" data-link-direction="after">after</button>
        <button type="button" class="seg-opt${direction === 'before' ? ' on' : ''}" data-link-direction="before">before</button>
      </div>
      <select class="mini-select schedule-link-habit" aria-label="linked habit">${scheduleLinkHabitOptions(subjectHid,anchorHid)}</select>
      <button type="button" class="mini-text-btn schedule-link-clear" aria-label="remove link">remove</button>
    </div>
    <div class="seg schedule-link-adjacency" role="group" aria-label="relationship strength"${anchorHid ? '' : ' hidden'}>
      <button type="button" class="seg-opt${adjacency === 'sometime' ? ' on' : ''}" data-adjacency="sometime">${adjLabel}</button>
      <button type="button" class="seg-opt${adjacency === 'direct' ? ' on' : ''}" data-adjacency="direct">right ${adjLabel}</button>
    </div>
    <div class="schedule-link-same-day-row${sameDay ? ' is-on' : ''}"${anchorHid ? '' : ' hidden'}>
      <span class="schedule-link-same-day-label">
        <span class="setting-title">Must do on days with ${escapeHtml(anchorName)}</span>
        <button type="button" class="info-btn" data-tip="${helpId}" aria-label="explain this same-day setting"><i class="ti ti-info-circle" aria-hidden="true"></i></button>
        <span class="info-tooltip schedule-link-same-day-help" id="${helpId}" role="tooltip" hidden>When on, plan this habit whenever ${escapeHtml(anchorName)} lands (shows as early when flex allows). Other days stay unconstrained. Multiple must-do links are OR’d.</span>
      </span>
      <button type="button" class="setting-switch schedule-link-same-day" aria-pressed="${sameDay ? 'true' : 'false'}" aria-label="Must do on days with ${escapeHtml(anchorName)}: ${sameDay ? 'on' : 'off'}">
        <span class="switch-ui" aria-hidden="true"></span>
      </button>
    </div>
  </div>`;
}

function renderScheduleLinkEditors(h = {}){
  const list = $('detail-schedule-link-list');
  if(!list)return;
  const subjectHid = h && h.hid;
  const links = normalizeScheduleLinks(h && h.scheduleLinks,subjectHid);
  list.innerHTML = links.map((link,idx)=>scheduleLinkEditorHtml(link,subjectHid,idx)).join('');
}

function refreshScheduleLinkEditorRow(editor,h){
  if(!editor)return;
  const links = readScheduleLinksFromDetail(h && h.hid);
  const idx = Number(editor.dataset.linkIndex);
  const link = Number.isFinite(idx) ? links[idx] : null;
  const direction = editor.querySelector('[data-link-direction].on')?.dataset.linkDirection
    || (link && link.direction) || 'after';
  const adj = editor.querySelector('.schedule-link-adjacency');
  const sameDay = editor.querySelector('.schedule-link-same-day');
  const sameDayRow = editor.querySelector('.schedule-link-same-day-row');
  const picker = editor.querySelector('.schedule-link-habit');
  const anchorHid = cleanHabitId(picker && picker.value);
  if(adj){
    adj.hidden = !anchorHid;
    const adjWord = direction === 'before' ? 'before' : 'after';
    adj.querySelectorAll('[data-adjacency]').forEach(btn=>{
      const kind = btn.dataset.adjacency;
      btn.textContent = kind === 'direct' ? `right ${adjWord}` : adjWord;
    });
  }
  if(sameDay && sameDayRow){
    sameDayRow.hidden = !anchorHid;
    const isRequired = sameDay.getAttribute('aria-pressed') === 'true';
    sameDayRow.classList.toggle('is-on',isRequired);
    const anchor = (typeof load === 'function' ? load() : []).find(item=>item && item.hid === anchorHid);
    const title = sameDayRow.querySelector('.setting-title');
    const help = sameDayRow.querySelector('.schedule-link-same-day-help');
    const anchorName = anchor && anchor.name || 'the other habit';
    if(title)title.textContent = `Must do on days with ${anchorName}`;
    if(help)help.textContent = `When on, plan this habit whenever ${anchorName} lands (shows as early when flex allows). Other days stay unconstrained. Multiple must-do links are OR’d.`;
    sameDay.setAttribute('aria-label',`Must do on days with ${anchorName}: ${isRequired ? 'on' : 'off'}`);
  }
}

function readScheduleLinksFromDetail(subjectHid){
  const out = [];
  document.querySelectorAll('#detail-schedule-link-list .schedule-link-editor').forEach(editor=>{
    const anchorHid = cleanHabitId(editor.querySelector('.schedule-link-habit')?.value);
    if(!anchorHid)return;
    const direction = editor.querySelector('[data-link-direction].on')?.dataset.linkDirection === 'before'
      ? 'before' : 'after';
    const adjacency = editor.querySelector('[data-adjacency].on')?.dataset.adjacency === 'direct'
      ? 'direct' : 'sometime';
    const link = normalizeScheduleLink({
      anchorHid,
      direction,
      adjacency,
      requireSameDay:editor.querySelector('.schedule-link-same-day')?.getAttribute('aria-pressed') === 'true'
    },subjectHid,direction);
    if(link)out.push(link);
  });
  return normalizeScheduleLinks(out,subjectHid);
}

function addBlankScheduleLinkRow(){
  const list = $('detail-schedule-link-list');
  if(!list)return;
  const h = detailIdx != null ? load()[detailIdx] : null;
  if(!h)return;
  const idx = list.querySelectorAll('.schedule-link-editor').length;
  list.insertAdjacentHTML('beforeend',scheduleLinkEditorHtml({
    anchorHid:'',direction:'after',adjacency:'sometime',requireSameDay:false
  },h.hid,idx));
  setDetailDirty();
}

function habitScheduleOptionLocationOptions(selectedId){
  const registry = typeof normalizeLocationRegistry === 'function'
    ? normalizeLocationRegistry((sortSettings || {}).locations) : [];
  const options = ['<option value="">anywhere</option>'];
  for(const loc of locationsForDisplay(registry)){
    options.push(`<option value="${escapeHtml(loc.id)}"${loc.id === selectedId ? ' selected' : ''}>${escapeHtml(loc.name)}</option>`);
  }
  return options.join('');
}

function habitScheduleOptionRowHtml(option,index){
  const normalized = normalizeHabitScheduleOptions([option])[0]
    || {weekdays:[],start:540,end:600,locationId:null};
  const activeDays = normalized.weekdays.length
    ? new Set(normalized.weekdays)
    : new Set([0,1,2,3,4,5,6]);
  return `<div class="habit-option-row" data-habit-option-index="${index}">
    <div class="habit-option-main">
      <select class="habit-option-location" aria-label="option location">${habitScheduleOptionLocationOptions(normalized.locationId)}</select>
      <input type="time" step="900" class="habit-option-start" aria-label="option starts" value="${minutesToTimeInput(normalized.start)}" />
      <span class="loc-sep">–</span>
      <input type="time" step="900" class="habit-option-end" aria-label="option ends" value="${minutesToTimeInput(normalized.end)}" />
      <button type="button" class="mini-text-btn habit-option-remove" aria-label="remove option"><i class="ti ti-x" aria-hidden="true"></i></button>
    </div>
    <div class="habit-option-days" role="group" aria-label="option weekdays">
      ${WEEKDAY_LABELS.map((label,day)=>`<button type="button" class="schedule-chip${activeDays.has(day) ? ' on' : ''}" data-habit-option-day="${day}" aria-pressed="${activeDays.has(day)}">${label}</button>`).join('')}
    </div>
  </div>`;
}

function syncHabitScheduleOptionsUi(){
  const list = $('detail-habit-option-list');
  const hasOptions = Boolean(list && list.children.length);
  const simpleFields = $('detail-simple-allowed-fields');
  if(simpleFields)simpleFields.hidden = hasOptions;
  const add = $('detail-habit-option-add');
  if(add)add.textContent = hasOptions ? 'add option' : 'use options';
  const hint = $('detail-habit-options-hint');
  if(hint)hint.textContent = hasOptions
    ? 'Each row is a valid alternative. Preferred rules rank them; only one is scheduled.'
    : 'Keep the simple rules above, or switch to coupled day, time, and place alternatives.';

  const tagWrap = $('detail-place-chips');
  if(!tagWrap)return;
  if(hasOptions){
    const placeState = habitScheduleOptionLocationState(readHabitScheduleOptionsFromDetail(),(sortSettings || {}).locations);
    const prefs = normalizeLocationPrefs(
      selectedLocationPrefsFrom('detail-place-chips'),placeState.locationIds,null
    );
    tagWrap.dataset.locationChoiceMode = 'preference';
    renderTagChips(
      'detail-place-chips',[],placeState.locationIds,null,prefs,placeState.anywhereAllowed
    );
  }else{
    renderTagChips(
      'detail-place-chips',[],selectedLocationIdsFrom('detail-place-chips'),null,
      selectedLocationPrefsFrom('detail-place-chips'),selectedAnywhereFrom('detail-place-chips')
    );
  }
  syncDetailSchedulePlacesUi();
}

function syncDetailSchedulePlacesUi(){
  const wrap = $('detail-place-chips');
  const label = $('detail-places-label');
  const hasOptions = Boolean($('detail-habit-option-list')?.children.length);
  const preferenceOnly = hasOptions || detailScheduleView === 'preferred';
  if(wrap){
    wrap.dataset.locationChoiceMode = preferenceOnly ? 'preference' : 'allowed';
    applyTagChipLocationMode(wrap);
  }
  if(label)label.textContent = preferenceOnly ? 'place preferences' : 'places';
}

function renderHabitScheduleOptions(h = {}){
  const list = $('detail-habit-option-list');
  if(!list)return;
  const options = normalizeHabitScheduleOptions(h.scheduleOptions,(sortSettings || {}).locations);
  list.innerHTML = options.map(habitScheduleOptionRowHtml).join('');
  syncHabitScheduleOptionsUi();
}

function readHabitScheduleOptionsFromDetail(){
  const raw = [];
  document.querySelectorAll('#detail-habit-option-list .habit-option-row').forEach(row=>{
    const selectedDays = [...row.querySelectorAll('[data-habit-option-day].on')]
      .map(btn=>Number(btn.dataset.habitOptionDay));
    raw.push({
      weekdays:normalizeAllowedWeekdays(selectedDays),
      start:timeInputToMinutes(row.querySelector('.habit-option-start')?.value),
      end:timeInputToMinutes(row.querySelector('.habit-option-end')?.value),
      locationId:cleanLocationId(row.querySelector('.habit-option-location')?.value) || null
    });
  });
  return normalizeHabitScheduleOptions(raw,(sortSettings || {}).locations);
}

function addBlankHabitScheduleOption(){
  const list = $('detail-habit-option-list');
  if(!list)return;
  if(list.children.length >= MAX_HABIT_SCHEDULE_OPTIONS){
    showToast(`up to ${MAX_HABIT_SCHEDULE_OPTIONS} options`);
    return;
  }
  const firstOption = list.children.length === 0;
  const selected = selectedLocationIdsFrom('detail-place-chips');
  const prefs = selectedLocationPrefsFrom('detail-place-chips');
  const locationId = firstOption
    ? (primaryPreferredLocationId(prefs,selected) || selected[0] || null)
    : (selected[0] || normalizeLocationRegistry((sortSettings || {}).locations)[0]?.id || null);
  const selectedDays = firstOption ? selectedWeekdaysFrom('detail-weekday-chips') : [];
  const allowedStart = firstOption ? timeInputToMinutes($('detail-time-start')?.value) : null;
  const allowedEnd = firstOption ? timeInputToMinutes($('detail-time-end')?.value) : null;
  list.insertAdjacentHTML('beforeend',habitScheduleOptionRowHtml({
    weekdays:selectedDays,
    start:allowedStart ?? 540,
    end:allowedEnd ?? 600,
    locationId
  },list.children.length));
  syncHabitScheduleOptionsUi();
  setDetailDirty();
}

// PURE: snapshot the later/earlier-of fields for one endpoint into the tune object.
function snapshotCombineFields(h, prefix){
  return {
    [prefix + 'Combine']:cleanTimeCombine(h && h[prefix + 'Combine']),
    [prefix + 'Anchor2']:cleanAnchor(h && h[prefix + 'Anchor2']),
    [prefix + 'OffsetMin2']:normalizePrayerOffset(h && h[prefix + 'OffsetMin2']),
    [prefix + 'AnchorHabitId2']:cleanHabitId(h && h[prefix + 'AnchorHabitId2']) || null,
    [prefix + 'FixedMin2']:normalizeTimeMinutes(h && h[prefix + 'FixedMin2']),
    [prefix + 'DayOffset']:normalizeAnchorDayOffset(h && h[prefix + 'DayOffset']),
    [prefix + 'DayOffset2']:normalizeAnchorDayOffset(h && h[prefix + 'DayOffset2'])
  };
}

// RENDER (idempotent): populate every anchor <select> with the standard list.
// Re-running on every openDetail is harmless — the options are stable. Primary
// gets prayers; secondary also gets a fixed clock option. Habit choices are
// now created in the dedicated recurring Habit order editor. A legacy option
// is injected only while rendering an older non-migratable expression.
function populateAnchorOptions(){
  const prayerOpts = PRAYER_ANCHORS.map(a => `<option value="${a}">${prayerDisplayName(a)}</option>`).join('');
  document.querySelectorAll('.time-endpoint .time-anchor').forEach(sel => {
    if(sel.dataset.populated === '1')return;
    sel.innerHTML = '<option value="">— anchor —</option>'
      + prayerOpts;
    sel.dataset.populated = '1';
  });
  document.querySelectorAll('.time-endpoint .time-anchor2').forEach(sel => {
    if(sel.dataset.populated === '1')return;
    sel.innerHTML = '<option value="">— anchor —</option>'
      + prayerOpts
      + '<option value="fixed">clock time…</option>';
    sel.dataset.populated = '1';
  });
}

function ensureLegacyHabitAnchorOption(select){
  if(!select || select.querySelector('option[value="habit"]'))return;
  const option = document.createElement('option');
  option.value = 'habit';
  option.textContent = 'after completion (legacy)…';
  const fixed = select.querySelector('option[value="fixed"]');
  select.insertBefore(option,fixed || null);
}

// RENDER: build/rebuild a habit-picker dropdown. `which` is '' (primary) or '2'.
// Excludes the current habit (can't anchor on yourself).
function populateHabitPickerFor(endpoint, field, h, which = ''){
  if(!endpoint)return;
  const picker = endpoint.querySelector(which === '2' ? '.time-habit2' : '.time-habit');
  if(!picker)return;
  const selected = cleanHabitId(h && h[field + 'AnchorHabitId' + which]) || '';
  const data = typeof load === 'function' ? load() : [];
  const currentHid = cleanHabitId(h && h.hid);
  const options = ['<option value="">— pick a habit —</option>']
    .concat(data.filter(x => x && cleanHabitId(x.hid) !== currentHid).map(x => {
      const hid = cleanHabitId(x.hid);
      const name = (x.name || 'untitled').slice(0,60);
      return `<option value="${escapeHtml(hid)}"${hid === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`;
    }));
  picker.innerHTML = options.join('');
}

// RENDER: sync habit-wrap + day-next (+ fixed clock for B) visibility for one expression row.
function syncExprControls(endpoint, field, h, which = ''){
  const suffix = which === '2' ? '2' : '';
  const anchor = cleanAnchor(h && h[field + 'Anchor' + suffix]);
  const isFixed = which === '2' && anchor === 'fixed';
  const habitWrap = endpoint.querySelector(which === '2' ? '.time-habit-wrap2' : '.time-habit-wrap');
  const dayBtn = endpoint.querySelector(which === '2' ? '.time-day-next2' : '.time-day-next');
  const expr = endpoint.querySelector(which === '2' ? '.time-expr2' : '.time-expr');
  const fixed2 = which === '2' ? endpoint.querySelector('.time-fixed2') : null;
  if(fixed2){
    fixed2.hidden = !isFixed;
    if(isFixed){
      const min = normalizeTimeMinutes(h && h[field + 'FixedMin2']);
      fixed2.value = minutesToTimeInput(min != null ? min : 1200);
    }
  }
  if(habitWrap){
    habitWrap.hidden = anchor !== 'habit';
    if(anchor === 'habit')populateHabitPickerFor(endpoint, field, h, which);
  }
  if(dayBtn){
    const on = normalizeAnchorDayOffset(h && h[field + 'DayOffset' + suffix]) === 1;
    dayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    // +1d only applies to prayer anchors (habit logs are absolute; fixed has no day).
    dayBtn.hidden = !anchor || anchor === 'habit' || isFixed;
  }
  if(expr && which === '2'){
    expr.querySelectorAll('.time-offset2, .time-offset-sign-btn, .time-offset-unit').forEach(el => {
      el.hidden = isFixed;
    });
  }
}

// RENDER: sync a single time endpoint DOM block from the habit's stored state.
function renderTimeEndpoint(endpoint, field, h){
  if(!endpoint)return;
  const fixedInput = endpoint.querySelector('.time-fixed');
  const dynWrap = endpoint.querySelector('.time-dynamic');
  const anchorSel = endpoint.querySelector('.time-anchor');
  const offsetInput = endpoint.querySelector('.time-offset');
  const combineSel = endpoint.querySelector('.time-combine');
  const expr2 = endpoint.querySelector('.time-expr2');
  const anchor2Sel = endpoint.querySelector('.time-anchor2');
  const offset2Input = endpoint.querySelector('.time-offset2');
  const anchor = cleanAnchor(h && h[field + 'Anchor']);
  if(anchor){
    if(anchor === 'habit')ensureLegacyHabitAnchorOption(anchorSel);
    endpoint.classList.add('is-dynamic');
    if(fixedInput)fixedInput.hidden = true;
    if(dynWrap)dynWrap.hidden = false;
    if(anchorSel)anchorSel.value = anchor;
    if(offsetInput){
      const off = normalizePrayerOffset(h[field + 'OffsetMin']);
      offsetInput.value = Math.abs(off) || '';
      syncOffsetSign(offsetInput, off);
    }
    syncExprControls(endpoint, field, h, '');
    const combine = cleanTimeCombine(h && h[field + 'Combine']);
    if(combineSel)combineSel.value = combine || '';
    if(expr2)expr2.hidden = !combine;
    if(combine){
      if(cleanAnchor(h[field + 'Anchor2']) === 'habit')ensureLegacyHabitAnchorOption(anchor2Sel);
      if(anchor2Sel)anchor2Sel.value = cleanAnchor(h[field + 'Anchor2']) || '';
      if(offset2Input){
        const off2 = normalizePrayerOffset(h[field + 'OffsetMin2']);
        offset2Input.value = Math.abs(off2) || '';
        syncOffsetSign(offset2Input, off2);
      }
      syncExprControls(endpoint, field, h, '2');
    }
  }else{
    endpoint.classList.remove('is-dynamic');
    if(fixedInput){
      fixedInput.hidden = false;
      // Guard null/undefined explicitly — Number(null) returns 0, which would
      // otherwise render "00:00" in the input and silently write back a
      // midnight→midnight time window on the next save (hasTimeWindow treats
      // 0/0 as a valid 24h window). null must round-trip to an empty input.
      const raw = h[field];
      const num = raw != null ? Number(raw) : NaN;
      fixedInput.value = Number.isFinite(num) ? minutesToTimeInput(num) : '';
    }
    if(dynWrap)dynWrap.hidden = true;
    if(anchorSel)anchorSel.value = '';
    if(offsetInput)offsetInput.value = '';
    if(combineSel)combineSel.value = '';
    if(expr2)expr2.hidden = true;
  }
  updateTimeResolved(endpoint, field, h);
}

// RENDER: live preview of the resolved clock time for a dynamic endpoint.
// Falls back to a muted "—" when there's no location on the habit (the save
// path will block, but the preview explains why). For 'habit' anchors, shows
// contextual hints: "pick a habit", "never logged", "done · waiting".
function updateTimeResolved(endpoint, field, h){
  const node = endpoint && endpoint.querySelector('.time-resolved');
  if(!node)return;
  const anchor = cleanAnchor(h && h[field + 'Anchor']);
  if(!anchor){ node.textContent = ''; return; }
  if(anchor === 'habit'){
    const data = typeof load === 'function' ? load() : [];
    const anchorHabit = findHabitByHid(h && h[field + 'AnchorHabitId'], data);
    if(!anchorHabit){ node.textContent = 'pick a habit'; return; }
    const min = resolveHabitTimeField(h, field, dayStart(Date.now()));
    if(min == null){
      const role = field.endsWith('Start') ? 'start' : 'end';
      const anchorLast = anchorHabit.lastLog;
      const ownLast = h && h.lastLog;
      if(role === 'start' && ownLast != null && anchorLast != null && ownLast >= anchorLast){
        node.textContent = 'done · waiting';
      }else if(anchorLast == null){
        node.textContent = 'never logged';
      }else{
        node.textContent = '—';
      }
      return;
    }
    node.textContent = formatTimeShort(((min % 1440) + 1440) % 1440);
    return;
  }
  // Prayer anchor — needs a location.
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = habitPrayerLocation(h, settings);
  if(!loc){
    node.textContent = 'add a location';
    return;
  }
  const min = resolveHabitTimeField(h, field, dayStart(Date.now()));
  if(min == null){
    node.textContent = '—';
    return;
  }
  node.textContent = formatTimeShort(((min % 1440) + 1440) % 1440);
}
// RENDER: toggles time-clear button visibility. A clear is offered whenever
// any of the four endpoints has a value (fixed or dynamic).
function syncTimeClearBtn(){
  const allowedOn = endpointHasValue($('detail-time-start').closest('.time-endpoint'))
    || endpointHasValue($('detail-time-end').closest('.time-endpoint'));
  const prefOn = endpointHasValue($('detail-preferred-time-start').closest('.time-endpoint'))
    || endpointHasValue($('detail-preferred-time-end').closest('.time-endpoint'));
  const clear = $('detail-time-clear');
  if(clear)clear.hidden = !allowedOn;
  const prefClear = $('detail-preferred-time-clear');
  if(prefClear)prefClear.hidden = !prefOn;
}
function endpointHasValue(endpoint){
  if(!endpoint)return false;
  if(endpoint.classList.contains('is-dynamic'))return true;
  const fixed = endpoint.querySelector('.time-fixed');
  return Boolean(fixed && fixed.value);
}
// RENDER: sync the sign toggle button next to an offset input to reflect a
// signed numeric value. The input stores the absolute value.
function syncOffsetSign(input, signedVal){
  if(!input)return;
  const btn = input.nextElementSibling;
  if(!btn || !btn.classList.contains('time-offset-sign-btn'))return;
  const neg = signedVal < 0;
  btn.dataset.sign = neg ? '-' : '+';
  btn.textContent = neg ? '−' : '+';
  btn.setAttribute('aria-label', (neg ? 'negative' : 'positive') + ' offset');
}
// PURE: read the signed offset from an input element by combining its value
// with the sign from the adjacent .time-offset-sign-btn.
function readSignedOffset(input){
  const raw = normalizePrayerOffset(input ? input.value : 0);
  if(!input)return raw;
  const btn = input.nextElementSibling;
  if(btn && btn.classList.contains('time-offset-sign-btn') && btn.dataset.sign === '-'){
    return -Math.abs(raw);
  }
  return Math.abs(raw);
}
// PURE: read the anchor value (or null) from a per-endpoint editor, addressed
// by its fixed-input id. Returns null when the endpoint is in fixed mode.
function readAnchorFromEndpoint(fixedInputId){
  const el = document.getElementById(fixedInputId);
  if(!el)return null;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return null;
  const sel = endpoint.querySelector('.time-anchor');
  return cleanAnchor(sel ? sel.value : '');
}
// PURE: read the signed offset (default 0) from a per-endpoint editor.
function readOffsetFromEndpoint(fixedInputId){
  const el = document.getElementById(fixedInputId);
  if(!el)return 0;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return 0;
  const input = endpoint.querySelector('.time-offset');
  return readSignedOffset(input);
}
// PURE: read the referenced habit id (or null) from a per-endpoint editor.
// Returns null when the endpoint isn't in 'habit' anchor mode.
// `which` is '' (primary) or '2' (secondary expression).
function readHabitIdFromEndpoint(fixedInputId, which = ''){
  const el = document.getElementById(fixedInputId);
  if(!el)return null;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return null;
  const sel = endpoint.querySelector(which === '2' ? '.time-anchor2' : '.time-anchor');
  if(!sel || sel.value !== 'habit')return null;
  const picker = endpoint.querySelector(which === '2' ? '.time-habit2' : '.time-habit');
  const id = picker ? cleanHabitId(picker.value) : '';
  return id || null;
}
// PURE: read combine mode / secondary expression / day offsets from an endpoint.
function readCombineFromEndpoint(fixedInputId){
  const empty = {
    combine:null, anchor2:null, offset2:0, habitId2:null, fixedMin2:null, dayOffset:0, dayOffset2:0
  };
  const el = document.getElementById(fixedInputId);
  if(!el)return empty;
  const endpoint = el.closest('.time-endpoint');
  if(!endpoint || !endpoint.classList.contains('is-dynamic'))return empty;
  const combine = cleanTimeCombine(endpoint.querySelector('.time-combine')?.value);
  const dayOffset = endpoint.querySelector('.time-day-next')?.getAttribute('aria-pressed') === 'true' ? 1 : 0;
  if(!combine){
    return {...empty, dayOffset};
  }
  const anchor2 = cleanAnchor(endpoint.querySelector('.time-anchor2')?.value);
  const offset2 = anchor2 && anchor2 !== 'fixed'
    ? readSignedOffset(endpoint.querySelector('.time-offset2')) : 0;
  const dayOffset2 = anchor2 && anchor2 !== 'fixed'
    && endpoint.querySelector('.time-day-next2')?.getAttribute('aria-pressed') === 'true' ? 1 : 0;
  const fixedMin2 = anchor2 === 'fixed'
    ? (timeInputToMinutes(endpoint.querySelector('.time-fixed2')?.value) ?? 1200)
    : null;
  return {
    combine: anchor2 ? combine : null,
    anchor2,
    offset2,
    habitId2: readHabitIdFromEndpoint(fixedInputId, '2'),
    fixedMin2,
    dayOffset,
    dayOffset2
  };
}

// HYBRID: reads form DOM into tune object
