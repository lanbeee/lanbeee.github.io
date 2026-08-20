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

