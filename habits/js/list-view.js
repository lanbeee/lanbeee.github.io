// Topic chips, search UI, summary copy, cards, swipe gestures, and quick actions.
//
// This file renders the home list view (topic chips, search, summary copy,
// cards, swipe gestures, and quick actions). Annotated for a React Native port:
//   - RENDER  -> React functional components
//   - HANDLER -> onPress / onChange callbacks
//   - WIRE    -> useEffect setup hooks
//   - PURE    -> plain helper modules / selectors
//   - HYBRID  -> split into state hooks + presentational components

// PURE: build icon markup string
function iconHtml(h,c){
  if(h.emoji)return `<span class="emoji-mark">${escapeHtml(h.emoji)}</span>`;
  return `<i class="ti ${defaultIcon(h.type)}" style="color:${c.icon};" aria-hidden="true"></i>`;
}

// PURE: get normalized topic list
function topicOptions(){
  return normalizeTopics((sortSettings || loadSortSettings()).topics);
}

// PURE: read selected topics from DOM
function selectedTopicsFrom(containerId){
  const wrap = $(containerId);
  if(!wrap)return [];
  return [...wrap.querySelectorAll('.topic-chip.on[data-topic]')].map(btn=>btn.dataset.topic);
}

// PURE: read selected add-topic chips
function selectedAddTopics(){
  return selectedTopicsFrom('ting-tag-chips');
}

// PURE: registry locations from settings
function locationOptions(){
  return normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
}

// PURE: look up a location by id
function locationById(id,registry = locationOptions()){
  const clean = cleanLocationId(id);
  if(!clean)return null;
  return registry.find(loc=>loc.id === clean) || null;
}

// PURE: read selected location ids from a chip row
function selectedLocationIdsFrom(containerId){
  const wrap = $(containerId);
  if(!wrap)return [];
  return [...wrap.querySelectorAll('.location-chip.on[data-location-id]')].map(btn=>btn.dataset.locationId);
}

// PURE: selected locations on the add sheet
function selectedLocationIds(){
  return selectedLocationIdsFrom('ting-tag-chips');
}

function selectedAnywhereFrom(containerId){
  const wrap = $(containerId);
  if(!wrap)return true;
  return wrap.querySelector('[data-anywhere]')?.classList.contains('on')
    ?? wrap.dataset.anywhereAllowed === '1';
}

function selectedAnywhere(){
  return selectedAnywhereFrom('ting-tag-chips');
}

// PURE: preferred location id from a unified chip row (highest preference), or null
function selectedPreferredLocationIdFrom(containerId){
  const prefs = selectedLocationPrefsFrom(containerId);
  const ids = selectedLocationIdsFrom(containerId);
  return primaryPreferredLocationId(prefs,ids);
}

function selectedPreferredLocationId(){
  return selectedPreferredLocationIdFrom('ting-tag-chips');
}

/** PURE: read locationPrefs map from chip data-pref attributes. */
function selectedLocationPrefsFrom(containerId){
  const wrap = $(containerId);
  if(!wrap)return {};
  const out = {};
  wrap.querySelectorAll('.location-chip.on[data-location-id]').forEach(btn=>{
    const level = btn.dataset.pref;
    if(LOCATION_PREF_LEVELS.includes(level))out[btn.dataset.locationId] = level;
  });
  return out;
}

function selectedLocationPrefs(){
  return selectedLocationPrefsFrom('ting-tag-chips');
}

// RENDER: split chip layout — places on one horizontal-scroll row, topics on
// another. Each row starts with its own "+ new" pill so a place or topic can
// be created inline. The container keeps its id so the existing
// selectedTopicsFrom / selectedLocationIdsFrom helpers (which walk by data
// attribute, not by row) keep working unchanged.
// Location pref cycle: off → on → little → high → avoid → off
function renderTagChips(containerId,selectedTopics = [],selectedLocIds = [],preferredLocId = null,locationPrefs = null,anywhereAllowed = null){
  const wrap = $(containerId);
  if(!wrap)return;
  // Preserve horizontal scroll position across the rebuild so toggling a chip
  // doesn't snap the row back to the start.
  const prevPlaceScroll = wrap.querySelector('.tag-row-places')?.scrollLeft ?? 0;
  const prevTopicScroll = wrap.querySelector('.tag-row-topics')?.scrollLeft ?? 0;
  const topics = topicOptions();
  const locations = locationOptions();
  const selectedSet = new Set(normalizeTopics(selectedTopics).map(topic=>topic.toLowerCase()));
  const selectedLocs = normalizeLocationIds(selectedLocIds,locations);
  const prefs = normalizeLocationPrefs(locationPrefs,selectedLocs,preferredLocId);
  const anywhereOn = anywhereAllowed == null
    ? (wrap.dataset.anywhereAllowed ? wrap.dataset.anywhereAllowed === '1' : selectedLocs.length === 0)
    : Boolean(anywhereAllowed);
  wrap.dataset.anywhereAllowed = anywhereOn ? '1' : '0';
  const anywhereHtml = locations.length > 0
    ? `<button type="button" class="topic-chip location-chip anywhere-chip ${anywhereOn ? 'on' : ''}" data-anywhere="" title="no specific place"><i class="ti ti-world" aria-hidden="true"></i>anywhere</button>`
    : '';
  const locHtml = locations.map(loc=>{
    const on = selectedLocs.includes(loc.id);
    const level = prefs[loc.id] || '';
    const mark = level === 'high' ? ' ★' : level === 'little' ? ' ☆' : level === 'avoid' ? ' –' : '';
    const title = level === 'high' ? 'high preference'
      : level === 'little' ? 'little preference'
      : level === 'avoid' ? 'avoid if possible'
      : 'place';
    return `<button type="button" class="topic-chip location-chip ${on ? 'on' : ''} ${level ? `pref-${level}` : ''}" data-location-id="${escapeHtml(loc.id)}" data-pref="${escapeHtml(level)}" title="${title}"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(loc.name)}${mark}</button>`;
  }).join('');
  const topicHtml = topics.map(topic=>{
    const on = selectedSet.has(topic.toLowerCase());
    return `<button type="button" class="topic-chip ${on ? 'on' : ''}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`;
  }).join('');
  // Build via DOM (not innerHTML) so the pill buttons retain their dataset and
  // event-less state cleanly. Order: place pill, anywhere option, then real places.
  wrap.innerHTML = '';
  const locRow = document.createElement('div');
  locRow.className = 'tag-row tag-row-places';
  locRow.appendChild(createAddLocationPill());
  locRow.insertAdjacentHTML('beforeend',anywhereHtml + locHtml);
  const topicRow = document.createElement('div');
  topicRow.className = 'tag-row tag-row-topics';
  topicRow.appendChild(createAddTopicPill());
  topicRow.insertAdjacentHTML('beforeend',topicHtml);
  // Scroll guard: prevents accidental chip taps during horizontal scroll.
  // Sets a flag on the row as soon as touch displacement (finger movement)
  // is detected. The flag lingers for 500ms to cover the synthetic click
  // that mobile browsers fire after touchend. The click handlers in main.js
  // check this flag and bail if set.
  function addScrollGuard(row){
    var timer;
    function arm(){ row._sg = 1; clearTimeout(timer); timer = setTimeout(function(){ row._sg = 0; },500); }
    (function(){
      var sx,sy;
      row.addEventListener('touchstart',function(e){
        var t = e.changedTouches[0];
        sx = t.clientX; sy = t.clientY;
      },{passive:true});
      row.addEventListener('touchmove',function(e){
        var t = e.changedTouches[0];
        if(Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8)arm();
      },{passive:true});
    })();
    row.addEventListener('scroll',arm,{passive:true});
  }
  addScrollGuard(locRow);
  addScrollGuard(topicRow);
  wrap.appendChild(locRow);
  wrap.appendChild(topicRow);
  // Restore horizontal scroll position saved before rebuild.
  locRow.scrollLeft = prevPlaceScroll;
  topicRow.scrollLeft = prevTopicScroll;
  // Setting scrollLeft fires an async scroll event that arms the scroll guard,
  // which would swallow the next click within 500ms. Disarm on the next tick
  // (the scroll event is queued before this timeout so it fires first).
  setTimeout(() => { locRow._sg = 0; topicRow._sg = 0; }, 0);
}

// RENDER: draw selectable topic chips (legacy name — now renders the unified row)
function renderTopicChips(containerId,selected = []){
  // Map old container ids to the unified tag row.
  const unified = containerId === 'ting-topic-chips' || containerId === 'ting-location-chips'
    ? 'ting-tag-chips'
    : containerId === 'detail-topic-chips' || containerId === 'detail-location-chips'
      ? 'detail-tag-chips'
      : containerId;
  const locContainer = unified;
  const locs = selectedLocationIdsFrom(locContainer);
  const prefs = selectedLocationPrefsFrom(locContainer);
  renderTagChips(unified,selected,locs,null,prefs);
}

// RENDER: location side of the unified row (keeps topics intact)
function renderLocationChips(containerId,selectedIds = [],opts = {}){
  const unified = containerId === 'ting-location-chips' || containerId === 'ting-topic-chips'
    ? 'ting-tag-chips'
    : containerId === 'detail-location-chips' || containerId === 'detail-topic-chips'
      ? 'detail-tag-chips'
      : containerId;
  const topics = selectedTopicsFrom(unified);
  renderTagChips(unified,topics,selectedIds,opts.preferred || null,opts.prefs || null);
}

// HANDLER: toggle a location chip — off → on → little → high → avoid → off
function toggleLocationChip(e){
  const btn = e.target.closest('.location-chip[data-location-id]');
  if(!btn)return;
  const wrap = btn.closest('.topic-chip-row');
  if(!wrap)return;
  const level = btn.dataset.pref || '';
  const isOn = btn.classList.contains('on');
  if(!isOn){
    btn.classList.add('on');
    btn.dataset.pref = '';
  }else if(level === ''){
    btn.dataset.pref = 'little';
  }else if(level === 'little'){
    btn.dataset.pref = 'high';
  }else if(level === 'high'){
    btn.dataset.pref = 'avoid';
  }else{
    btn.classList.remove('on');
    btn.dataset.pref = '';
  }
  const selected = selectedLocationIdsFrom(wrap.id);
  const prefs = selectedLocationPrefsFrom(wrap.id);
  renderTagChips(wrap.id,selectedTopicsFrom(wrap.id),selected,null,prefs,selectedAnywhereFrom(wrap.id));
  if(wrap.id === 'detail-tag-chips')setDetailDirty();
}

// PURE: resolve the place a home/agenda card is treated as being at.
function cardLocationId(h,agendaRow){
  if(agendaRow && agendaRow.locationId)return agendaRow.locationId;
  const registry = locationOptions();
  const ids = normalizeLocationIds(h && h.locationIds,registry);
  if(!ids.length)return null;
  return pickHabitLocationId(h,null,registry,normalizeTravelMode((sortSettings || {}).defaultTravelMode)) || ids[0];
}

// PURE: compute home location filter choices
function homeLocationChoices(data){
  const registry = locationOptions();
  const used = new Set(data.flatMap(h=>normalizeLocationIds(h.locationIds,registry)));
  const locs = registry.filter(loc=>used.has(loc.id));
  const hasNone = data.some(h=>h.anywhereAllowed || !normalizeLocationIds(h.locationIds,registry).length);
  return [
    {key:'all',label:'all places'},
    ...locs.map(loc=>({key:loc.id,label:loc.name})),
    ...(hasNone ? [{key:'__none__',label:'anywhere'}] : [])
  ];
}

// PURE: test habit matches home location filter
function matchesHomeLocation(h,id){
  if(!id || id === 'all')return true;
  const ids = normalizeLocationIds(h.locationIds);
  if(id === '__none__')return Boolean(h.anywhereAllowed) || !ids.length;
  return ids.includes(id);
}

// HYBRID: compact home context bar + the full on-demand filter sheet. The bar
// only exposes current presence and active filters, so a large topic/location
// library never turns the top of Home into an endless horizontal chip rail.
function renderHomeTagFilter(data){
  const wrap = $('home-tag-filter');
  if(!wrap)return;
  const groups = $('home-filter-groups');
  const summary = $('home-filter-summary');
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  if(minimal){
    wrap.innerHTML = '';
    wrap.hidden = true;
    if(groups)groups.innerHTML = '';
    return;
  }
  const registry = locationOptions();
  // "Real" usage = at least one habit carries this dimension. Without this
  // gate, the row shows filler like "all places" + "anywhere" even when no
  // habit has any location, which is just visual noise.
  const usedTopicSet = new Set();
  data.forEach(h=>normalizeTopics(h.topics).forEach(t=>usedTopicSet.add(t.toLowerCase())));
  const usedLocSet = new Set(data.flatMap(h=>normalizeLocationIds(h.locationIds,registry)));
  const hasTopics = usedTopicSet.size > 0;
  const hasLocs = usedLocSet.size > 0;
  const hasPresence = registry.length > 0 && hasLocs;
  if(!hasTopics && !hasLocs && !hasPresence){
    wrap.innerHTML = '';
    wrap.hidden = true;
    if(groups)groups.innerHTML = '';
    return;
  }
  const topicChoices = homeTopicChoices(data);
  const locChoices = homeLocationChoices(data);
  // Reset stale filters: if the dimension is unused (or the chosen key is no
  // longer present), fall back to 'all' so we never silently hide everything.
  if(!hasTopics || !topicChoices.some(c=>c.key === homeTopicFilter))homeTopicFilter = 'all';
  if(!hasLocs || !locChoices.some(c=>c.key === homeLocationFilter))homeLocationFilter = 'all';
  wrap.hidden = false;
  let statusHtml = '';
  if(hasPresence && typeof locationPresence === 'function'){
    const presence = locationPresence(registry);
    const anchor = typeof currentLocationId === 'function' ? currentLocationId() : null;
    const anchorLoc = anchor ? locationById(anchor,registry) : null;
    let label = 'set place';
    let kind = presence.kind || 'away';
    if(presence.kind === 'at')label = `at ${presence.name}`;
    else if(presence.kind === 'near')label = `near ${presence.name}`;
    else if(anchorLoc){ label = `at ${anchorLoc.name}`; kind = 'at'; }
    const gpsClass = presence.gps && presence.kind === 'at' ? 'gps-matched' : '';
    statusHtml = `<button type="button" class="topic-filter presence-filter ${kind} ${gpsClass}" data-home-presence="1" title="change today’s starting place">
      <span class="presence-icon"><i class="ti ti-current-location" aria-hidden="true"></i><i class="presence-signal" aria-hidden="true"></i></span>
      <span class="presence-copy"><small>today’s place</small><b>${escapeHtml(label)}</b></span>
      <i class="ti ti-chevron-down presence-chevron" aria-hidden="true"></i>
    </button>`;
  }
  const activeLoc = hasLocs && homeLocationFilter !== 'all'
    ? locChoices.find(choice=>choice.key === homeLocationFilter)
    : null;
  const activeTopic = hasTopics && homeTopicFilter !== 'all'
    ? topicChoices.find(choice=>choice.key === homeTopicFilter)
    : null;
  const activeCount = Number(Boolean(activeLoc)) + Number(Boolean(activeTopic));
  const activeHtml = `
    <div class="home-filter-active" aria-label="active filters">
      ${statusHtml}
      ${activeLoc ? `<button type="button" class="home-active-filter location-filter" data-clear-home-location="1" aria-label="clear place filter ${escapeHtml(activeLoc.label)}"><i class="ti ti-map-pin" aria-hidden="true"></i><span>${escapeHtml(activeLoc.label)}</span><i class="ti ti-x" aria-hidden="true"></i></button>` : ''}
      ${activeTopic ? `<button type="button" class="home-active-filter topic-active" data-clear-home-topic="1" aria-label="clear topic filter ${escapeHtml(activeTopic.label)}"><i class="ti ti-tag" aria-hidden="true"></i><span>${escapeHtml(activeTopic.label)}</span><i class="ti ti-x" aria-hidden="true"></i></button>` : ''}
      ${!hasPresence && !activeCount ? '<span class="home-filter-default">All habits</span>' : ''}
    </div>
    <button type="button" class="home-filter-trigger${activeCount ? ' has-active' : ''}" data-open-home-filters="1" aria-label="open filters${activeCount ? `, ${activeCount} active` : ''}">
      <i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>
      <span>Filters</span>
      ${activeCount ? `<b>${activeCount}</b>` : ''}
    </button>`;
  wrap.innerHTML = activeHtml;

  if(summary){
    summary.textContent = activeCount
      ? `${activeCount} active ${activeCount === 1 ? 'filter' : 'filters'} · changes apply immediately`
      : 'Narrow your agenda by one place, one topic, or both.';
  }
  if(!groups)return;
  const baseIndices = visibleIndices(data,sortSettings);
  const optionMarkup = (choice,kind)=>{
    const on = kind === 'location' ? choice.key === homeLocationFilter : choice.key === homeTopicFilter;
    const count = choice.key === 'all'
      ? baseIndices.length
      : baseIndices.filter(i=>kind === 'location'
        ? matchesHomeLocation(data[i],choice.key)
        : matchesHomeTopic(data[i],choice.key)).length;
    const icon = kind === 'location' ? 'ti-map-pin' : 'ti-tag';
    const label = choice.key === 'all'
      ? (kind === 'location' ? 'All places' : 'All topics')
      : choice.label;
    const attr = kind === 'location' ? 'data-home-location' : 'data-home-topic';
    return `<button type="button" class="home-filter-option ${kind}${on ? ' on' : ''}" ${attr}="${escapeHtml(choice.key)}" aria-pressed="${on}">
      <i class="ti ${icon} home-filter-option-icon" aria-hidden="true"></i>
      <span><b>${escapeHtml(label)}</b><small>${count} ${count === 1 ? 'item' : 'items'}</small></span>
      <i class="ti ti-check home-filter-check" aria-hidden="true"></i>
    </button>`;
  };
  groups.innerHTML = `
    ${hasLocs ? `<section class="home-filter-group" aria-labelledby="home-filter-places-label">
      <div class="home-filter-group-head"><span id="home-filter-places-label">Place</span><small>${Math.max(0,locChoices.length - 1)} options</small></div>
      <div class="home-filter-option-grid">${locChoices.map(choice=>optionMarkup(choice,'location')).join('')}</div>
    </section>` : ''}
    ${hasTopics ? `<section class="home-filter-group" aria-labelledby="home-filter-topics-label">
      <div class="home-filter-group-head"><span id="home-filter-topics-label">Topic</span><small>${Math.max(0,topicChoices.length - 1)} options</small></div>
      <div class="home-filter-option-grid">${topicChoices.map(choice=>optionMarkup(choice,'topic')).join('')}</div>
    </section>` : ''}`;
}

// HYBRID: draw home location filter (compat — routes to unified row)
function renderHomeLocationFilter(data){
  renderHomeTagFilter(data);
}

// HYBRID: draw home topic filter (compat — routes to unified row)
function renderHomeTopicFilter(data){
  renderHomeTagFilter(data);
}

// PURE: build weekday and month-day chips
function selectedWeekdaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.schedule-chip.on')].map(btn=>parseInt(btn.dataset.weekday,10));
}

// PURE: read selected month-day chips
function selectedMonthDaysFrom(containerId){
  return [...$(containerId).querySelectorAll('.monthday-chip.on')].map(btn=>parseInt(btn.dataset.monthday,10));
}

/** PURE: compact summary for selected month days ("any", "1, 15", "1–5, 20"). */
function formatMonthDaySummary(days){
  const sorted = normalizeAllowedMonthDays(days);
  if(!sorted.length)return 'any';
  const parts = [];
  let start = sorted[0];
  let prev = sorted[0];
  for(let i = 1; i <= sorted.length; i++){
    const day = sorted[i];
    if(day === prev + 1){
      prev = day;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    start = prev = day;
  }
  return parts.join(', ');
}

/** RENDER: sync a month-day disclosure summary from selected chips. */
function syncMonthDayDisclosureSummary(chipRowId,summaryId){
  const summary = $(summaryId);
  if(!summary)return;
  const days = $(chipRowId) ? selectedMonthDaysFrom(chipRowId) : [];
  summary.textContent = formatMonthDaySummary(days);
  summary.title = days.length ? formatMonthDaySummary(days) : 'any day of the month';
}

/** RENDER: collapse month-day chip grids (detail schedule starts compact). */
function collapseMonthDayDisclosures(){
  [
    ['detail-monthday-toggle','detail-monthday-chips'],
    ['detail-preferred-monthday-toggle','detail-preferred-monthday-chips']
  ].forEach(([toggleId,rowId])=>{
    const toggle = $(toggleId);
    const row = $(rowId);
    if(row)row.hidden = true;
    if(toggle)toggle.setAttribute('aria-expanded','false');
  });
}

/** HANDLER: expand/collapse a month-day chip grid from its disclosure head. */
function toggleMonthDayDisclosure(toggle){
  if(!toggle)return;
  const rowId = toggle.getAttribute('aria-controls');
  const row = rowId ? $(rowId) : null;
  if(!row)return;
  const opening = toggle.getAttribute('aria-expanded') !== 'true';
  row.hidden = !opening;
  toggle.setAttribute('aria-expanded',String(opening));
}

// RENDER: draw weekday and month-day chips
function renderScheduleChips(prefix,h = {}){
  const weekdays = new Set(normalizeAllowedWeekdays(h.allowedWeekdays));
  const monthDays = new Set(normalizeAllowedMonthDays(h.allowedMonthDays));
  const weekdayWrap = $(`${prefix}-weekday-chips`);
  const monthWrap = $(`${prefix}-monthday-chips`);
  if(weekdayWrap){
    weekdayWrap.innerHTML = WEEKDAY_LABELS.map((label,day)=>{
      const on = weekdays.has(day);
      return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-weekday="${day}" aria-pressed="${on}">${label}</button>`;
    }).join('');
  }
  if(monthWrap){
    monthWrap.innerHTML = Array.from({length:31},(_,i)=>{
      const day = i + 1;
      const on = monthDays.has(day);
      return `<button type="button" class="monthday-chip ${on ? 'on' : ''}" data-monthday="${day}" aria-pressed="${on}">${day}</button>`;
    }).join('');
  }
  const prefWeekdays = new Set(normalizeAllowedWeekdays(h.preferredWeekdays));
  const prefMonthDays = new Set(normalizeAllowedMonthDays(h.preferredMonthDays));
  const prefWeekdayWrap = $(`${prefix}-preferred-weekday-chips`);
  const prefMonthWrap = $(`${prefix}-preferred-monthday-chips`);
  if(prefWeekdayWrap){
    prefWeekdayWrap.innerHTML = WEEKDAY_LABELS.map((label,day)=>{
      const on = prefWeekdays.has(day);
      return `<button type="button" class="schedule-chip preferred ${on ? 'on' : ''}" data-weekday="${day}" aria-pressed="${on}">${label}</button>`;
    }).join('');
  }
  if(prefMonthWrap){
    prefMonthWrap.innerHTML = Array.from({length:31},(_,i)=>{
      const day = i + 1;
      const on = prefMonthDays.has(day);
      return `<button type="button" class="monthday-chip preferred ${on ? 'on' : ''}" data-monthday="${day}" aria-pressed="${on}">${day}</button>`;
    }).join('');
  }
  if(prefix === 'detail'){
    collapseMonthDayDisclosures();
    syncMonthDayDisclosureSummary('detail-monthday-chips','detail-monthday-summary');
    syncMonthDayDisclosureSummary('detail-preferred-monthday-chips','detail-preferred-monthday-summary');
  }
}

// PURE: convert minutes to HH:MM
function minutesToTimeInput(minutes){
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
// PURE: parse HH:MM into minutes, snapped to the 15-minute picker grid
function timeInputToMinutes(value){
  if(!value)return null;
  const [h,m] = value.split(':').map(Number);
  if(Number.isNaN(h) || Number.isNaN(m))return null;
  return snapTimeMinutes(h * 60 + m);
}
// PURE: ms timestamp -> "YYYY-MM-DD" for <input type="date">
function dateInputValue(ts){
  if(!ts)return '';
  return dateKey(ts);
}
// PURE: ms timestamp -> "HH:mm" for <input type="time">
function timeInputValue(ts){
  if(!ts)return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${hh}:${mm}`;
}
// PURE: task due row — date + optional time → eventTime ms, or null when no time set.
function parseTaskWhen(dateValue,timeValue){
  if(!timeValue || !String(timeValue).trim())return null;
  if(!dateValue)return null;
  const ts = new Date(`${dateValue}T${timeValue}`).getTime();
  return Number.isFinite(ts) ? ts : null;
}
// PURE: ms timestamp -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local">
function datetimeInputValue(ts){
  if(!ts)return '';
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

// HANDLER: toggle schedule chip on tap
function toggleScheduleChip(e){
  const btn = e.target.closest('.schedule-chip[data-weekday],.monthday-chip[data-monthday]');
  if(!btn)return;
  btn.classList.toggle('on');
  btn.setAttribute('aria-pressed',String(btn.classList.contains('on')));
  if(btn.closest('#detail-weekday-chips,#detail-monthday-chips,#detail-preferred-weekday-chips,#detail-preferred-monthday-chips')){
    setDetailDirty();
  }
  if(btn.closest('#detail-monthday-chips')){
    syncMonthDayDisclosureSummary('detail-monthday-chips','detail-monthday-summary');
  }else if(btn.closest('#detail-preferred-monthday-chips')){
    syncMonthDayDisclosureSummary('detail-preferred-monthday-chips','detail-preferred-monthday-summary');
  }
}

// RENDER: build the add-topic pill button
function createAddTopicPill(){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topic-chip topic-chip-add';
  btn.dataset.topicAdd = '';
  btn.setAttribute('aria-label','new topic');
  btn.innerHTML = '<i class="ti ti-plus" aria-hidden="true"></i>new topic';
  return btn;
}

// RENDER: build the add-place pill button (opens the location picker).
function createAddLocationPill(){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'topic-chip topic-chip-add location-chip-add';
  btn.dataset.locationAdd = '';
  btn.setAttribute('aria-label','new place');
  btn.innerHTML = '<i class="ti ti-plus" aria-hidden="true"></i>new place';
  return btn;
}

// HYBRID: swap pill for input and wire commit
function beginNewTopicInput(containerId){
  const wrap = $(containerId);
  if(!wrap)return;
  if(wrap.querySelector('.topic-chip-input')){
    wrap.querySelector('.topic-chip-input')?.focus();
    return;
  }
  const pill = wrap.querySelector('[data-topic-add]');
  if(!pill)return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'topic-chip topic-chip-input';
  input.maxLength = 32;
  input.placeholder = 'new topic';
  input.autocomplete = 'off';
  input.autocorrect = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'done';
  pill.replaceWith(input);
  input.focus({preventScroll:true});
  if(typeof updateKeyboardLift === 'function')updateKeyboardLift();
  if(typeof keepFocusedInputVisible === 'function')keepFocusedInputVisible();
  let settled = false;
  const restorePill = ()=>{
    if(input.isConnected)input.replaceWith(pill);
  };
  const commit = ()=>{
    if(settled)return;
    settled = true;
    const topic = cleanTopic(input.value);
    if(!topic || !$(containerId)){
      restorePill();
      return;
    }
    const existing = normalizeTopics(topicOptions());
    if(!existing.some(item=>item.toLowerCase() === topic.toLowerCase())){
      updateSortSetting({topics:normalizeTopics([...existing,topic])},{renderNow:false});
    }
    const nextSelected = normalizeTopics([...selectedTopicsFrom(containerId),topic]);
    const locs = selectedLocationIdsFrom(containerId);
    const prefs = selectedLocationPrefsFrom(containerId);
    renderTagChips(containerId,nextSelected,locs,null,prefs);
    renderTopicList();
    if(containerId === 'detail-tag-chips')setDetailDirty();
    render();
  };
  input.addEventListener('blur',()=>{
    if(settled)return;
    setTimeout(commit,0);
  });
  input.addEventListener('keydown',e=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      if(!settled){
        settled = true;
        commit();
      }
    }else if(e.key === 'Escape'){
      e.preventDefault();
      if(settled)return;
      settled = true;
      restorePill();
    }
  });
}

// HANDLER: toggle topic chip on tap
function toggleTopicChip(e){
  const btn = e.target.closest('.topic-chip[data-topic]');
  if(!btn)return;
  btn.classList.toggle('on');
  if(btn.closest('#detail-tag-chips'))setDetailDirty();
}

// RENDER: draw removable topic list
function renderTopicList(){
  const list = $('topic-list');
  if(!list)return;
  const topics = topicOptions();
  list.innerHTML = topics.length
    ? topics.map(topic=>`<button type="button" class="topic-chip" data-remove-topic="${escapeHtml(topic)}">${escapeHtml(topic)} <i class="ti ti-x" aria-hidden="true"></i></button>`).join('')
    : '<span class="topic-chip empty">no topics</span>';
}

// HYBRID: add topic, update state, re-render
function addTopicFromInput(inputId,options = {}){
  const input = $(inputId);
  if(!input)return;
  const topic = cleanTopic(input.value);
  if(!topic){input.focus();return;}
  const topics = normalizeTopics([...topicOptions(),topic]);
  updateSortSetting({topics},{renderNow:false});
  input.value = '';
  input.blur();
  renderTopicList();
  const autoSelect = options.autoSelect;
  const addSelected = autoSelect ? normalizeTopics([...selectedAddTopics(),topic]) : selectedAddTopics();
  renderTagChips('ting-tag-chips',addSelected,selectedLocationIds(),null,selectedLocationPrefs());
  if(detailIdx !== null){
    const detailSelected = autoSelect
      ? normalizeTopics([...selectedTopicsFrom('detail-tag-chips'),topic])
      : currentDetailTune().topics;
    renderTagChips('detail-tag-chips',detailSelected,selectedLocationIdsFrom('detail-tag-chips'),null,selectedLocationPrefsFrom('detail-tag-chips'));
    if(autoSelect)setDetailDirty();
  }
  render();
}

// HANDLER: add topic from input field
function addTopic(){
  addTopicFromInput('topic-name');
}

// HYBRID: remove topic and refresh views
function removeTopic(topic){
  const key = topic.toLowerCase();
  const topics = topicOptions().filter(item=>item.toLowerCase() !== key);
  updateSortSetting({topics},{renderNow:false});
  const data = load().map(h=>({
    ...h,
    topics:normalizeTopics(h.topics).filter(item=>item.toLowerCase() !== key)
  }));
  save(data);
  renderTopicList();
  renderTagChips('ting-tag-chips',selectedAddTopics(),selectedLocationIds(),null,selectedLocationPrefs());
  if(detailIdx !== null){
    const tune = currentDetailTune();
    renderTagChips('detail-tag-chips',tune.topics,tune.locationIds,tune.preferredLocationId,tune.locationPrefs);
  }
  if(typeof homeTopicFilter !== 'undefined' && homeTopicFilter !== 'all' && homeTopicFilter.toLowerCase() === key){
    homeTopicFilter = 'all';
  }
  refreshOpenViews();
}

// PURE: compute home topic filter choices
function homeTopicChoices(data){
  const topics = normalizeTopics([...topicOptions(),...data.flatMap(h=>normalizeTopics(h.topics))]);
  const hasNoTopic = data.some(h=>!normalizeTopics(h.topics).length);
  return [{key:'all',label:'all'},...topics.map(topic=>({key:topic,label:topic})),...(hasNoTopic ? [{key:'__none__',label:'no topic'}] : [])];
}

// PURE: test habit matches home topic
function matchesHomeTopic(h,topic){
  if(!topic || topic === 'all')return true;
  const topics = normalizeTopics(h.topics);
  if(topic === '__none__')return !topics.length;
  return topics.some(item=>item.toLowerCase() === topic.toLowerCase());
}

// RENDER: toggle sort and search buttons
function updateSortButton(){
  const data = load();
  const count = data.length;
  const hasSearchableArchive = data.some(h=>h.type === 'task' && isTaskDone(h));
  $('open-overview').classList.toggle('is-hidden',count < 1);
  $('open-overview').disabled = count < 1;
  $('open-search').classList.toggle('is-hidden',count < 10 && !hasSearchableArchive);
  $('open-search').disabled = count < 10 && !hasSearchableArchive;
  const barOverview = $('bar-open-overview');
  if (barOverview) {
    barOverview.classList.toggle('is-hidden',count < 1);
    barOverview.disabled = count < 1;
  }
  const barSearch = $('bar-open-search');
  if (barSearch) {
    barSearch.classList.toggle('is-hidden',count < 10 && !hasSearchableArchive);
    barSearch.disabled = count < 10 && !hasSearchableArchive;
  }
  if(count < 10 && !hasSearchableArchive)closeSearch({render:false});
}

// PURE: whether the search chrome is open (phone nav or wide app bar).
function isSearchOpen(){
  const wide = paneTierActive();
  if(wide)return !!$('app-bar-search')?.classList.contains('is-open');
  return !!document.querySelector('.bottom-nav')?.classList.contains('search-open');
}

// RENDER: sync search bar to query state
function updateSearchUi(){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  const searchBtn = $('open-search');
  const barSearchBtn = $('bar-open-search');
  const clearBtn = $('clear-search');
  if(!input || (!nav && !barSearchBtn))return;
  const open = isSearchOpen();
  const empty = !searchQuery.trim();
  input.value = searchQuery;
  document.body.classList.toggle('search-active',open);
  const syncSearchToggle = (btn)=>{
    if(!btn)return;
    btn.classList.toggle('is-on',open);
    btn.setAttribute('aria-pressed',String(open));
    btn.setAttribute('aria-label',open ? 'close search' : 'search habits');
    const icon = btn.querySelector('i');
    if(icon){
      icon.className = open ? 'ti ti-x' : 'ti ti-search';
      icon.setAttribute('aria-hidden','true');
    }
  };
  syncSearchToggle(searchBtn);
  syncSearchToggle(barSearchBtn);
  const navSearchWrap = $('nav-search');
  if (navSearchWrap){
    navSearchWrap.setAttribute('aria-hidden',String(!open));
    navSearchWrap.classList.toggle('is-empty',empty);
  }
  const barSearchWrap = $('app-bar-search');
  if (barSearchWrap) {
    barSearchWrap.setAttribute('aria-hidden',String(!open));
    barSearchWrap.classList.toggle('is-open',open);
    barSearchWrap.classList.toggle('is-empty',empty);
  }
  if(clearBtn){
    clearBtn.hidden = !open;
    clearBtn.setAttribute('aria-label',empty ? 'close search' : 'clear search');
  }
}

// HYBRID: open/close search, focus, render
function setSearchOpen(open,options = {}){
  const nav = document.querySelector('.bottom-nav');
  const input = $('habit-search');
  if(!input)return;
  const wide = paneTierActive();
  if(options.clear)searchQuery = '';
  if (wide) {
    const barSearch = $('app-bar-search');
    if (barSearch) barSearch.classList.toggle('is-open',open);
    if (nav) nav.classList.remove('search-open');
  } else {
    if (nav) nav.classList.toggle('search-open',open);
    const barSearch = $('app-bar-search');
    if (barSearch) barSearch.classList.remove('is-open');
  }
  updateSearchUi();
  if(open && options.focus !== false){
    input.focus({preventScroll:true});
    updateKeyboardLift();
    keepFocusedInputVisible();
    requestAnimationFrame(()=>{
      if(document.activeElement !== input)input.focus({preventScroll:true});
      updateKeyboardLift();
      keepFocusedInputVisible();
    });
    setTimeout(()=>{
      updateKeyboardLift();
      keepFocusedInputVisible();
    },260);
  }else if(!open && document.activeElement === input){
    input.blur();
  }
  if(!open)updateKeyboardLift();
  if(options.render !== false)render();
  if(open){
    // Search is a fresh result view, not a continuation of the home scroll.
    // Reset both possible scroll hosts after render while retaining input focus.
    requestAnimationFrame(()=>{
      const pane = document.querySelector('.pane-list');
      if(pane)pane.scrollTop = 0;
      window.scrollTo({top:0,left:0,behavior:'auto'});
    });
  }
}

// HYBRID: close and clear search UI
function closeSearch(options = {}){
  const open = isSearchOpen();
  const active = Boolean(searchQuery.trim()) || open;
  setSearchOpen(false,{
    clear:options.clear !== false,
    focus:false,
    render:options.render ?? active
  });
}

// PURE: decide if tap dismisses search
function shouldDismissSearchFromTap(target){
  if(!target?.closest)return false;
  if(!isSearchOpen())return false;
  // Close/clear controls handle their own clicks — don't double-fire dismiss
  // here or the follow-up click reopens search (toggle sees it already closed).
  if(target.closest('#habit-search,#clear-search,#open-search,#bar-open-search'))return false;
  if(target.closest('.sheet-wrap.open'))return false;
  if(searchQuery.trim() && target.closest('.swipe-row,.ting-card,.swipe-actions'))return false;
  return true;
}

// PURE: next planned log object (preserves timed / locationId)
function nextPlannedLogEntry(h){
  return (typeof planLogEntries === 'function' ? planLogEntries(h.logs) : normalizeLogs(h.logs).filter(isPlanLog))[0] || null;
}

// PURE: get next planned log timestamp
function nextPlannedLog(h){
  const entry = nextPlannedLogEntry(h);
  return entry ? logTime(entry) : null;
}

// PURE: compute next-eligible label text
function nextEligibleCopy(h){
  if(!hasDaySchedule(h))return '';
  const distance = nextEligibleDistance(h);
  if(distance === null)return 'no matching day soon';
  if(distance === 0)return 'available today';
  if(distance === 1)return 'available tomorrow';
  const next = nextEligibleDate(h);
  if(distance <= 6)return `available ${new Date(next).toLocaleDateString(undefined,{weekday:'short'})}`;
  return `available ${new Date(next).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}

// PURE: compute short next-eligible label
function nextEligibleShort(h){
  if(!hasDaySchedule(h))return '';
  const distance = nextEligibleDistance(h);
  if(distance === null)return '-';
  if(distance === 0)return '';
  return `${distance}d`;
}

// PURE: compute compact plan day label
function compactPlanLabel(ts){
  const days = calendarDayDiff(ts);
  if(days === null)return '';
  if(days <= 0)return '';
  return `${days}d`;
}

// PURE: compact task due label for card pill
function compactDueLabel(ts,hardDue){
  const left = daysUntil(ts);
  if(left === null)return '';
  if(left < 0)return `${Math.abs(left)}d${hardDue ? '!' : ''}`;
  if(left === 0)return 'today';
  if(left === 1)return 'tmrw';
  if(left <= 7)return `${left}d`;
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// PURE: compact scheduled time label for card pill / strip
function compactScheduledLabel(ts){
  const left = daysUntil(ts);
  if(left === null)return '';
  if(left < 0)return 'past';
  const time = new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  if(left === 0)return time;
  if(left === 1)return 'tmrw';
  if(left <= 6)return new Date(ts).toLocaleDateString(undefined,{weekday:'short'});
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// PURE: keep cue pills narrow; full text remains in title/tooltips.
function compactPillText(value,max = 10){
  const text = String(value || '').trim();
  if(text.length <= max)return text;
  return `${text.slice(0,Math.max(1,max - 1))}…`;
}

// PURE: compute keep-up cue text
function buildCue(h,days,target){
  if(days === null)return 'Ready for first entry';
  if(days < 0)return 'Coming up';
  const remaining = target - days;
  if(remaining < 0){
    const overdue = Math.abs(remaining);
    if(overdue === 1)return '1 day overdue';
    if(overdue <= 7)return `${overdue} days overdue`;
    return `${Math.round(overdue / 7)} weeks overdue`;
  }
  if(remaining === 0)return 'Due today';
  if(remaining === 1)return 'Due tomorrow';
  if(remaining <= 3)return `Due in ${remaining} days`;
  if(days <= target * 0.5)return 'On track';
  return `${remaining} days left`;
}

// PURE: compute reduce cue text
function limitCue(h,days,target){
  if(days === null)return 'No entries yet';
  if(days < 0)return 'Coming up';
  const remaining = target - days;
  if(remaining > 1)return `Wait ${remaining} days`;
  if(remaining === 1)return 'Wait 1 more day';
  if(remaining === 0)return 'Okay today';
  return 'Okay again';
}

// PURE: compute card status cue text
function cardCue(h){
  const days = daysSince(h.lastLog);
  const target = effectiveTarget(h);
  const plan = nextPlannedLog(h);
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'Snoozed for now';
  if(h.type === 'task')return taskCue(h);
  if(plan && dateKey(plan) === dateKey(Date.now()) && h.type !== 'zero')return 'Planned today';
  const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
  if(planBy != null && (h.type === 'keepup' || h.type === 'reduce')){
    const left = daysUntil(planBy);
    if(left !== null){
      if(left < 0)return `${Math.abs(left)}d behind on planning`;
      if(left === 0)return 'Needs a day by today';
      if(left === 1)return 'Needs a day by tomorrow';
      if(left <= 7)return `Needs a day in ${left}d`;
      return `Needs a day by ${new Date(planBy).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    }
  }
  if(days === null){
    if(h.type === 'zero')return 'Nothing logged';
    return 'Ready to start';
  }
  if(days < 0)return 'Coming up';
  if(h.type === 'keepup')return buildCue(h,days,target);
  if(h.type === 'reduce')return limitCue(h,days,target);
  if(days === 0)return 'Clean today';
  if(days === 1)return '1 day clean';
  if(days < 4)return `${days} days clean`;
  return `${days} days clean`;
}

// PURE: task status cue
function taskCue(h){
  if(h.lastLog !== null)return 'Done';
  if(h.eventTime !== null){
    if(typeof scheduledWhenLabel === 'function')return capitalizeFirst(scheduledWhenLabel(h.eventTime));
    return 'Scheduled';
  }
  if(h.dueDate === null)return 'Someday';
  const left = daysUntil(h.dueDate);
  if(left === null)return 'Due';
  if(left < 0)return h.hardDue ? `${Math.abs(left)}d past deadline` : `${Math.abs(left)}d overdue`;
  if(left === 0)return 'Due today';
  if(left === 1)return 'Due tomorrow';
  if(left <= 7)return `Due in ${left}d`;
  return `Due ${new Date(h.dueDate).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
}

// PURE: scheduled-task status cue
function scheduledCue(h){
  if(!h.eventTime)return 'Scheduled';
  if(typeof scheduledWhenLabel === 'function')return capitalizeFirst(scheduledWhenLabel(h.eventTime));
  return 'Scheduled';
}

// PURE: capitalize the first letter of a string
function capitalizeFirst(s){
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// PURE: compact clock copy for dense home rows. Detail and audit views keep
// their existing precise formatter; this only removes redundant ":00"/spaces.
function compactHomeTime(ts){
  if(!Number.isFinite(Number(ts)))return '';
  const d = new Date(Number(ts));
  const minutes = d.getMinutes();
  return d.toLocaleTimeString(undefined,{
    hour:'numeric',
    ...(minutes ? {minute:'2-digit'} : {}),
    hour12:true
  }).replace(/\s+/g,'').toUpperCase();
}

// PURE: compact an effort estimate without implying false precision.
function compactHomeDuration(minutes){
  const value = Math.max(0,Number(minutes) || 0);
  if(value < 60)return `${Math.round(value)}m`;
  const hours = Math.round((value / 60) * 10) / 10;
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours}h`;
}

// PURE: compute card tone class
function cardTone(h){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'quiet';
  if(hasPlannedToday(h) && h.type !== 'zero')return 'plan';
  return scoreTone(progressScore(h));
}

// PURE: build card meta pills markup
function cardMeta(h,options = {}){
  if(options.minimalOnly){
    if(h.type === 'task'){
      if(h.eventTime !== null && !options.suppressScheduled){
        return `<span class="context-pill scheduled" title="${escapeHtml(entryWhen(h.eventTime))}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(compactScheduledLabel(h.eventTime))}</span>`;
      }
      if(h.dueDate === null)return '<span class="context-pill due icon-only" title="no due date"><i class="ti ti-flag" aria-hidden="true"></i></span>';
      return `<span class="context-pill due ${h.hardDue ? 'hard' : ''}" title="${escapeHtml(`due ${entryWhen(h.dueDate)}`)}"><i class="ti ti-flag" aria-hidden="true"></i>${escapeHtml(compactDueLabel(h.dueDate,h.hardDue))}</span>`;
    }
    if(h.type !== 'zero')return `<span class="context-pill" title="how often"><i class="ti ti-repeat" aria-hidden="true"></i>${formatRhythmLabel(h.target || 7)}</span>`;
    return '<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>';
  }
  const plan = nextPlannedLog(h);
  const parts = [];
  if(options.extraPills)parts.push(options.extraPills);
  if(h.sample && (options.forceSample || sortSettings.showSampleOnCards))parts.push('<span class="context-pill quiet" title="sample habit"><i class="ti ti-test-pipe" aria-hidden="true"></i>sample</span>');
  if(h.pinned && (options.forcePinned || sortSettings.showPinnedOnCards))parts.push('<span class="context-pill pin" title="pinned"><i class="ti ti-pin" aria-hidden="true"></i></span>');
  if(h.type === 'task' && (options.forceTaskDate || sortSettings.showTaskDateOnCards)){
    if(h.eventTime !== null && !options.suppressScheduled){
      // When today's agenda already renders a "scheduled at HH:MM" pill for
      // this card (see agendaCardPill), skip the duplicate here so the time
      // never appears twice with an identical calendar icon.
      parts.push(`<span class="context-pill scheduled" title="${escapeHtml(entryWhen(h.eventTime))}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(compactScheduledLabel(h.eventTime))}</span>`);
    }else if(h.dueDate === null){
      parts.push('<span class="context-pill due icon-only" title="no due date"><i class="ti ti-flag" aria-hidden="true"></i></span>');
    }else{
      parts.push(`<span class="context-pill due ${h.hardDue ? 'hard' : ''}" title="${escapeHtml(`due ${entryWhen(h.dueDate)}`)}"><i class="ti ti-flag" aria-hidden="true"></i>${escapeHtml(compactDueLabel(h.dueDate,h.hardDue))}</span>`);
    }
  }else{
    const planBy = typeof habitPlanByDate === 'function' ? habitPlanByDate(h) : h.planByDate;
    if(planBy != null && (h.type === 'keepup' || h.type === 'reduce')){
      parts.push(`<span class="context-pill due" title="${escapeHtml(`needs a day by ${entryWhen(planBy)}`)}"><i class="ti ti-flag" aria-hidden="true"></i>${escapeHtml(compactDueLabel(planBy,false))}</span>`);
    }else if(options.forceRepetition || sortSettings.showRepetitionOnCards){
      if(h.type !== 'zero')parts.push(`<span class="context-pill" title="how often"><i class="ti ti-repeat" aria-hidden="true"></i>${formatRhythmLabel(h.target || 7)}</span>`);
      else parts.push('<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>');
    }
  }
  if((options.forceDuration || sortSettings.showDurationOnCards) && h.durationMinutes)parts.push(`<span class="context-pill" title="duration ${Math.round(h.durationMinutes)} minutes"><i class="ti ti-clock" aria-hidden="true"></i>${compactHomeDuration(h.durationMinutes)}</span>`);
  if((options.forceFlexibility || sortSettings.showFlexibilityOnCards) && h.flexibilityDays)parts.push(`<span class="context-pill" title="can do up to ${h.flexibilityDays}d early"><i class="ti ti-arrows-left-right" aria-hidden="true"></i>±${h.flexibilityDays}d</span>`);
  if(hasDaySchedule(h) && (options.forceDaySchedule || sortSettings.showDayScheduleOnCards)){
    const eligible = nextEligibleShort(h);
    const title = [scheduleSummary(h),nextEligibleCopy(h)].filter(Boolean).join(' · ');
    const prefClass = hasPreferredDays(h) ? ' has-preferred' : '';
    parts.push(`<span class="context-pill schedule${prefClass} ${eligible ? '' : 'icon-only'}" title="${escapeHtml(title)}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(eligible)}</span>`);
  }
  if(hasTimeWindow(h) && (options.forceTimeWindow || sortSettings.showTimeWindowOnCards)){
    parts.push(`<span class="context-pill time" title="allowed hours"><i class="ti ti-clock-hour-4" aria-hidden="true"></i>${escapeHtml(timeWindowSummary(h))}</span>`);
  }
  const topics = normalizeTopics(h.topics);
  if(options.forceTopics || sortSettings.showTopicsOnCards){
    topics.slice(0,2).forEach(topic=>{
      parts.push(`<span class="context-pill quiet" title="${escapeHtml(`topic: ${topic}`)}"><i class="ti ti-tag" aria-hidden="true"></i>${escapeHtml(compactPillText(topic,10))}</span>`);
    });
    if(topics.length > 2)parts.push(`<span class="context-pill quiet" title="more topics">+${topics.length - 2}</span>`);
  }
  if(options.forceLocation || sortSettings.showLocationOnCards){
    const registry = locationOptions();
    const locIds = normalizeLocationIds(h.locationIds,registry);
    locIds.slice(0,2).forEach(id=>{
      const loc = locationById(id,registry);
      if(!loc)return;
      parts.push(`<span class="context-pill quiet" title="${escapeHtml(`location: ${loc.name}`)}"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(compactPillText(loc.name,10))}</span>`);
    });
    if(locIds.length > 2)parts.push(`<span class="context-pill quiet" title="more locations">+${locIds.length - 2}</span>`);
  }
  if(plan && h.type !== 'zero' && (options.forcePlans || sortSettings.showPlansOnCards)){
    const planEntry = nextPlannedLogEntry(h);
    const label = planEntry && planTimed(planEntry)
      ? compactScheduledLabel(plan)
      : compactPlanLabel(plan);
    const titleBits = [`planned ${entryWhen(plan)}`];
    const locId = planEntry && planLocationId(planEntry);
    if(locId){
      const loc = locationById(locId);
      if(loc)titleBits.push(loc.name);
    }
    parts.push(`<span class="context-pill plan ${label ? '' : 'icon-only'}" title="${escapeHtml(titleBits.join(' · '))}"><i class="ti ti-calendar-event" aria-hidden="true"></i>${escapeHtml(label)}</span>`);
  }
  if(h.snoozedUntil && Date.now() < h.snoozedUntil && (options.forceSnoozedUntil || sortSettings.showSnoozedUntilOnCards)){
    parts.push(`<span class="context-pill quiet" title="${escapeHtml(`snoozed until ${entryWhen(h.snoozedUntil)}`)}"><i class="ti ti-moon" aria-hidden="true"></i>${escapeHtml(entryWhen(h.snoozedUntil))}</span>`);
  }
  return parts.join('');
}

// PURE: build card trail dots markup
function cardTrail(h){
  const today = new Date();
  const logKeys = logToneMap(h);
  const lastWeekTones = Array.from({length:7},(_,i)=>{
    const d = new Date(today.getFullYear(),today.getMonth(),today.getDate() - (13 - i));
    const key = dateKey(d.getTime());
    return logKeys.get(key) || '';
  }).filter(Boolean);
  const lastWeekTone = summarizeTrailTone(lastWeekTones);
  const lastWeek = `<span class="trail-week ${lastWeekTone}" aria-hidden="true"></span>`;
  const thisWeek = Array.from({length:7},(_,i)=>{
    const d = new Date(today.getFullYear(),today.getMonth(),today.getDate() - (6 - i));
    const key = dateKey(d.getTime());
    const tone = logKeys.get(key) || 'empty';
    const todayClass = i === 6 ? ' today' : '';
    return `<span class="trail-dot ${tone}${todayClass}"></span>`;
  }).join('');
  return `${lastWeek}${thisWeek}`;
}

/** PURE: breakable progress crown-dial markup with 3-color status bar. */
function cardBreakableSlider(h){
  const total = typeof breakableTotalMinutes === 'function' ? breakableTotalMinutes(h) : clampDuration(h.durationMinutes);
  const rawDone = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0;
  const done = Math.min(rawDone,total);
  const bd = typeof breakableProgressBreakdown === 'function'
    ? breakableProgressBreakdown(h)
    : {manual:done,calendar:0,total};
  const cappedManual = Math.min(bd.manual,total);
  const cappedCal = Math.min(bd.calendar,total - cappedManual);
  const manualPct = total > 0 ? (cappedManual / total) * 100 : 0;
  const calPct = total > 0 ? (cappedCal / total) * 100 : 0;
  const isComplete = done >= total;
  const label = `progress ${done} of ${total} minutes`;
  return `<div class="breakable-progress" data-breakable-progress>
    <div class="breakable-progress-head">
      <span class="breakable-progress-title"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>progress</span>
      <span class="breakable-progress-label" aria-hidden="true">${done}/${total}m</span>
    </div>
    <div class="breakable-status-bar" aria-hidden="true">
      <span class="bar-calendar" style="width:${calPct}%"></span>
      <span class="bar-manual" style="width:${manualPct}%"></span>
      <span class="bar-adding" style="width:0%"></span>
    </div>
    <div class="breakable-scrub-row">
      <div class="crown-dial breakable-crown${isComplete ? ' complete' : ''}" role="slider" tabindex="0"
        aria-label="${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"
        data-committed="${done}" data-total="${total}" data-calendar="${cappedCal}" data-manual="${cappedManual}">
        <canvas class="crown-canvas"></canvas>
      </div>
      <span class="breakable-scrub-hint"><i class="ti ti-arrows-horizontal" aria-hidden="true"></i></span>
    </div>
  </div>`;
}

// PURE: pending auto-complete window (normal auto-mark OR doing-now one-shot)
function pendingAutoMarkWindow(h,now = Date.now()){
  if(!h)return null;
  if(h.type === 'task' && h.lastLog !== null)return null;
  if(h.type !== 'task' && typeof completedToday === 'function' && completedToday(h,now))return null;

  const doing = typeof getDoingNow === 'function' ? getDoingNow() : null;
  if(doing && doing.hid === h.hid && doing.dayBase === dayStart(now)
    && doing.completionMode === 'auto'
    && typeof isDoingNowActive === 'function' && isDoingNowActive(doing,now)){
    const start = Number(doing.startedAt);
    const end = typeof doingNowAutoMarkDeadline === 'function'
      ? doingNowAutoMarkDeadline(doing)
      : (start + Math.max(1,Number(doing.sessionMinutes) || 30) * 60000);
    if(!Number.isFinite(start) || !Number.isFinite(end))return null;
    if(now < start || now >= end)return null;
    return {kind:'auto',start,end,doingNow:true};
  }

  if(typeof isAutoMark !== 'function' || !isAutoMark(h) || h.breakable)return null;
  if(h.type !== 'task')return null;
  const trigger = typeof effectiveAutoMarkTrigger === 'function'
    ? effectiveAutoMarkTrigger(h,now)
    : (h.eventTime != null
      ? h.eventTime
      : (h.dueDate !== null
        ? dayStart(h.dueDate) - (h.flexibilityDays || 0) * 86400000
        : null));
  if(trigger == null)return null;
  const delayMs = Math.max(0,Number(h.autoMarkMinutes) || 0) * 60000;
  const end = trigger + delayMs;
  if(now < trigger || now >= end)return null;
  return {kind:'auto',start:trigger,end};
}

// PURE: live session progress state for timer or pending auto-complete.
// Timer wins when running. While a session-confirm sheet is open for this
// card, hide the auto bar so the user isn't watching two countdowns.
function sessionProgressState(h,realIdx,now = Date.now()){
  const timer = typeof habitTimer !== 'undefined' ? habitTimer : null;
  if(timer && timer.idx === realIdx){
    const start = timer.startedAt;
    const end = start + Math.max(1,timer.targetMs || timer.autoStopMs || 0);
    const elapsedMs = Math.max(0,now - start);
    const totalMs = Math.max(1,end - start);
    const elapsedMin = Math.max(0,Math.floor(elapsedMs / 60000));
    const leftMin = Math.max(0,Math.ceil((end - now) / 60000));
    const pct = Math.min(100,(elapsedMs / totalMs) * 100);
    const auto = timer.completionMode === 'auto';
    const reached = elapsedMs >= totalMs;
    return {
      kind:'timer',
      pct,
      label:auto
        ? `auto · ${Math.max(1,leftMin)}m left`
        : reached
          ? `target reached · ${elapsedMin}m elapsed`
          : `session · ${leftMin}m left`,
      aria:auto
        ? `auto-completing session, ${leftMin} minutes left`
        : reached
          ? `manual session target reached, ${elapsedMin} minutes elapsed`
          : `manual session, ${leftMin} minutes to target`
    };
  }
  if(typeof valueLogMinutes !== 'undefined' && valueLogMinutes != null
    && typeof valueLogIdx !== 'undefined' && valueLogIdx === realIdx){
    return null;
  }
  const win = pendingAutoMarkWindow(h,now);
  if(win){
    const totalMs = Math.max(1,win.end - win.start);
    const elapsedMs = Math.max(0,now - win.start);
    const leftMin = Math.max(0,Math.ceil((win.end - now) / 60000));
    const totalMin = Math.max(1,Math.round(totalMs / 60000));
    const elapsedMin = Math.min(totalMin,Math.max(0,Math.floor(elapsedMs / 60000)));
    const pct = Math.min(100,(elapsedMs / totalMs) * 100);
    return {
      kind:win.doingNow ? 'timer' : 'auto',
      pct,
      label:win.doingNow
        ? (leftMin ? `auto · ${leftMin}m left` : `${elapsedMin}/${totalMin}m`)
        : (leftMin ? `auto in ${leftMin}m` : `${elapsedMin}/${totalMin}m`),
      aria:win.doingNow
        ? `auto-completing session, ${leftMin} minutes left`
        : `auto-complete in ${leftMin} minutes`
    };
  }
  return null;
}

// PURE: home progress bar (no crown) for running timer / pending auto-complete
function cardSessionProgress(h,realIdx,now = Date.now()){
  const state = sessionProgressState(h,realIdx,now);
  if(!state)return '';
  return `<div class="session-progress ${state.kind === 'auto' ? 'is-auto' : 'is-timer'}" data-session-progress data-session-idx="${realIdx}" role="progressbar" aria-label="${escapeHtml(state.aria)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(state.pct)}">
    <div class="breakable-status-bar session-status-bar" aria-hidden="true">
      <span class="bar-session" style="width:${state.pct}%"></span>
    </div>
    <span class="session-progress-label" aria-hidden="true">${escapeHtml(state.label)}</span>
  </div>`;
}

// RENDER: refresh live session bars without rebuilding the whole list
function updateHomeSessionProgress(now = Date.now()){
  const list = $('list');
  if(!list)return;
  list.querySelectorAll('[data-session-progress]').forEach(el=>{
    const idx = parseInt(el.dataset.sessionIdx,10);
    if(!Number.isFinite(idx))return;
    const h = typeof load === 'function' ? load()[idx] : null;
    if(!h)return;
    const state = sessionProgressState(h,idx,now);
    if(!state){
      // Timer stopped or auto window ended — leave a stub until the next
      // full render restitches the card (trail / no bar).
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = '';
    el.classList.toggle('is-auto',state.kind === 'auto');
    el.classList.toggle('is-timer',state.kind === 'timer');
    el.setAttribute('aria-label',state.aria);
    el.setAttribute('aria-valuenow',String(Math.round(state.pct)));
    const fill = el.querySelector('.bar-session');
    if(fill)fill.style.width = `${state.pct}%`;
    const label = el.querySelector('.session-progress-label');
    if(label)label.textContent = state.label;
  });
}

// PURE: today's agenda timeline rows, shared by the home card pill map and
// the chronological "today" section ordering so both stay in lockstep.
// Travel/wait rows are excluded here — home inserts thin travel cards itself.
function homeAgendaRows(data){
  if(typeof buildTodayAgenda !== 'function' || typeof buildTodayTimeline !== 'function')return [];
  return buildTodayTimeline(buildTodayAgenda(data,sortSettings || loadSortSettings()))
    .filter(row=>row.kind === 'fill' || row.kind === 'scheduled');
}

// PURE: full timeline including travel rows (for thin home travel cards).
function homeAgendaTimeline(data){
  if(typeof buildTodayAgenda !== 'function' || typeof buildTodayTimeline !== 'function')return [];
  return buildTodayTimeline(buildTodayAgenda(data,sortSettings || loadSortSettings()));
}

// PURE: map today's agenda rows onto existing home cards.
function homeAgendaMap(data){
  return homeAgendaRows(data).reduce((map,row)=>{
    if(!map.has(row.i))map.set(row.i,row);
    return map;
  },new Map());
}

// PURE: chronological position of each today-agenda row, used to order the
// home "today" section the way the agenda timeline reads. Indices not in
// today's agenda are absent from the map.
function homeAgendaOrder(data){
  const map = new Map();
  homeAgendaRows(data).forEach((row,pos)=>{ if(!map.has(row.i))map.set(row.i,pos); });
  return map;
}

// PURE: color for the card's left accent bar by priority. P0 burns red, P1
// amber, the mid bands settle into neutral text tones, and the low bands fade
// so the bar reads as "how urgently does this want today's time" — only the
// top levels pop, everything else stays quiet. No text label needed.
function priorityColor(p){
  if(p <= 0)return 'var(--red-icon)';
  if(p === 1)return 'var(--amber-icon)';
  if(p === 2)return 'var(--teal-icon)';
  if(p === 3)return 'var(--text2)';
  if(p === 4)return 'var(--text3)';
  return 'color-mix(in srgb, var(--text3) 35%, transparent)';
}

// PURE: window status for an agenda lead — anytime / later / now / closing.
// Scheduled rows are handled by the caller. Closing = remaining window is too
// tight for the next session (chunk or full duration), floored at 45 minutes.
function agendaLeadStatus(row,h = null,now = Date.now()){
  const label = compactHomeTime(row.start);
  const end = row.kind === 'fill' ? compactHomeTime(row.end) : '';
  const chunkMinutes = h?.breakable && row.chunkIndex != null && Number.isFinite(row.chunkMinutes)
    ? Math.round(row.chunkMinutes)
    : null;
  const baseTitle = `on agenda at ${label}${end ? ` to ${end}` : ''}${chunkMinutes != null ? ` · ${chunkMinutes} minutes` : ''}`;
  if(row.kind === 'scheduled'){
    return {cls:'scheduled',icon:'ti-calendar-time',title:`fixed at ${label}`,chunkMinutes};
  }
  if(!h || typeof hasTimeWindow !== 'function' || !hasTimeWindow(h)){
    return {cls:'agenda-anytime',icon:'ti-clock',title:`${baseTitle} · anytime`,chunkMinutes};
  }
  const dayBase = typeof dayStart === 'function' ? dayStart(row.start) : row.start;
  const win = typeof fillTimeWindow === 'function' ? fillTimeWindow(h,dayBase) : null;
  if(!win){
    return {cls:'agenda-anytime',icon:'ti-clock',title:`${baseTitle} · anytime`,chunkMinutes};
  }
  if(now < win.start){
    return {
      cls:'agenda-later',
      icon:'ti-hourglass',
      title:`${baseTitle} · starts at ${compactHomeTime(win.start)}`,
      chunkMinutes
    };
  }
  const sessionMin = chunkMinutes != null
    ? chunkMinutes
    : (typeof clampDuration === 'function' ? clampDuration(h.durationMinutes) : Math.max(1,Number(h.durationMinutes) || 30));
  const sessionMs = Math.max(0,sessionMin) * 60000;
  const closingMs = Math.max(sessionMs,45 * 60000);
  if(now < win.end && (win.end - now) <= closingMs){
    return {
      cls:'agenda-closing',
      icon:'ti-alarm',
      title:`${baseTitle} · almost out of time`,
      chunkMinutes
    };
  }
  if(now >= win.end){
    // Past the hard window — still show the suggestion, but as closing urgency.
    return {
      cls:'agenda-closing',
      icon:'ti-alarm',
      title:`${baseTitle} · almost out of time`,
      chunkMinutes
    };
  }
  return {
    cls:'agenda-suggested',
    icon:'ti-sparkles',
    title:`${baseTitle} · good time now`,
    chunkMinutes
  };
}

// PURE: compact right-side agenda marker for a home card
function agendaCardPill(row,h = null,now = Date.now()){
  if(!row)return '';
  const mode = normalizeAgendaTimeMode(sortSettings && sortSettings.showAgendaTimesOnCards);
  if(mode === 'hide')return '';
  const status = agendaLeadStatus(row,h,now);
  const label = compactHomeTime(row.start);
  const chunk = status.chunkMinutes != null
    ? ` · ${compactHomeDuration(status.chunkMinutes)}`
    : '';
  const timeHtml = mode === 'icon' ? '' : `<span>${escapeHtml(label)}${escapeHtml(chunk)}</span>`;
  const cls = `${status.cls}${mode === 'icon' ? ' icon-only' : ''}`;
  return `<span class="context-pill agenda-lead ${cls}" title="${escapeHtml(status.title)}"><i class="ti ${status.icon}" aria-hidden="true"></i>${timeHtml}</span>`;
}

// PURE: the former score ring as a compact, readable metadata pill.
function cardStatusPill(score,tone,cue,accent){
  const value = Number.isFinite(score) ? `${Math.round(score)}%` : 'new';
  return `<span class="context-pill status-pill ${escapeHtml(tone || '')}" style="--status-color:${accent};" title="${escapeHtml(cue || 'status')}"><i class="ti ti-circle-filled" aria-hidden="true"></i>${escapeHtml(value)}</span>`;
}

function targetDayForEarly(h){
  if(h.type === 'task'){
    const when = taskWhen(h);
    return when === null ? null : dayStart(when);
  }
  const plan = nextPlannedLog(h);
  if(plan)return dayStart(plan);
  if(h.lastLog === null)return nextEligibleDate(h,Date.now());
  const target = Math.max(MIN_RHYTHM_DAYS,Number(h.target) || 7);
  const rawTarget = dayStart(h.lastLog) + target * 86400000;
  if(!hasDaySchedule(h))return rawTarget;
  return nextEligibleDate(h,rawTarget) || rawTarget;
}

function nextPreferredOnOrAfter(h,fromTs,limitTs){
  if(!hasPreferredDays(h))return null;
  for(let ts = dayStart(fromTs);ts <= limitTs;ts += 86400000){
    if((!hasDaySchedule(h) || isDateEligibleForHabit(h,ts)) && isPreferredDay(h,ts))return ts;
  }
  return null;
}

function dayPressure(data,key,settings,skipIdx = -1){
  const capacity = effectiveAvailabilityMinutes(key,settings);
  let load = 0;
  data.forEach((h,i)=>{
    if(i === skipIdx || (h.type === 'task' && h.lastLog !== null))return;
    const duration = clampDuration(h.durationMinutes);
    if(h.type === 'task' && h.eventTime !== null && dateKey(h.eventTime) === key){
      load += duration;
      return;
    }
    normalizeLogs(h.logs).forEach(log=>{
      if(isPlanLog(log) && dateKey(logTime(log)) === key)load += duration;
    });
    if(h.type === 'task' && h.eventTime === null && h.dueDate !== null && dateKey(h.dueDate) === key){
      load += duration;
    }
  });
  return {capacity,load,remaining:capacity - load,busy:capacity > 0 ? load / capacity : 1};
}

function canDoEarlyToday(h,targetTs){
  const today = dayStart(Date.now());
  if(!targetTs || targetTs <= today)return false;
  if(hasDaySchedule(h) && !isDateEligibleForHabit(h,today))return false;
  if(h.type === 'task'){
    const ready = taskReadyDate(h);
    return ready !== null && today >= dayStart(ready);
  }
  if(h.lastLog === null)return true;
  const flex = clampFlexibility(h.flexibilityDays);
  if(flex <= 0)return false;
  return today >= dayStart(targetTs) - flex * 86400000;
}

function earlyReason(data,i,settings){
  const h = data[i];
  if(!h || h.type === 'zero' || (h.type === 'task' && h.lastLog !== null))return '';
  if(todayCategory(h,settings) !== 2)return '';
  const target = targetDayForEarly(h);
  if(!canDoEarlyToday(h,target))return '';

  // Schedule-link pull: a same-day OR partner is due/committed today.
  const todayBase = dayStart(Date.now());
  const sameDayLinks = typeof sameDayScheduleLinks === 'function'
    ? sameDayScheduleLinks(h)
    : (typeof normalizeScheduleLinks === 'function'
      ? normalizeScheduleLinks(h.scheduleLinks,h.hid).filter(l=>l && l.requireSameDay)
      : []);
  if(sameDayLinks.length){
    for(const link of sameDayLinks){
      const anchor = data.find(item=>item && item.hid === link.anchorHid);
      if(!anchor)continue;
      const committed = typeof scheduleAnchorCommitForDay === 'function'
        && scheduleAnchorCommitForDay(link.anchorHid,todayBase,data);
      // Partner must still be doable today — a linked Haircut that no longer
      // fits remaining open time must not pull Shower onto the agenda alone.
      const anchorDoable = typeof windowStillDoableToday !== 'function'
        || windowStillDoableToday(anchor);
      const anchorDue = anchorDoable && (
        includeInTodayAgenda(anchor,settings)
        || (typeof isWeekCandidate === 'function'
          && isWeekCandidate(anchor,settings,todayBase,new Date(todayBase).getDay()))
      );
      if(!committed && !anchorDue)continue;
      const name = (anchor.name || 'linked habit').slice(0,40);
      if(link.direction === 'before')return `before ${name}`;
      if(link.direction === 'after')return `after ${name}`;
      return `with ${name}`;
    }
  }
  // Reverse: I am the anchor for someone else's same-day link (Juma after Shower).
  for(const other of data){
    if(!other || other.hid === h.hid)continue;
    const links = typeof sameDayScheduleLinks === 'function'
      ? sameDayScheduleLinks(other)
      : (typeof normalizeScheduleLinks === 'function'
        ? normalizeScheduleLinks(other.scheduleLinks,other.hid).filter(l=>l && l.requireSameDay)
        : []);
    const hit = links.find(l=>l && l.anchorHid === h.hid);
    if(!hit)continue;
    const otherDoable = typeof windowStillDoableToday !== 'function'
      || windowStillDoableToday(other);
    const otherDue = otherDoable && (
      includeInTodayAgenda(other,settings)
      || (typeof isWeekCandidate === 'function'
        && isWeekCandidate(other,settings,todayBase,new Date(todayBase).getDay()))
    );
    if(!otherDue && !(typeof scheduleAnchorCommitForDay === 'function'
      && scheduleAnchorCommitForDay(other.hid,todayBase,data)))continue;
    const name = (other.name || 'linked habit').slice(0,40);
    if(hit.direction === 'after')return `before ${name}`;
    if(hit.direction === 'before')return `after ${name}`;
    return `with ${name}`;
  }

  const preferred = nextPreferredOnOrAfter(h,Date.now(),target);
  const pressureDay = preferred || target;
  if(!pressureDay)return '';
  const pressure = dayPressure(data,dateKey(pressureDay),settings,i);
  const duration = clampDuration(h.durationMinutes);
  const targetLabel = preferred ? 'preferred day' : 'usual day';
  if(pressure.capacity <= 0)return `${targetLabel} is packed`;
  if(pressure.remaining < duration)return `${targetLabel} needs ${duration - pressure.remaining}m more open`;
  if(pressure.busy >= 0.75)return `${targetLabel} is packed`;
  return '';
}

function homeEarlyMap(data,settings){
  const key = homePlannerDirtyKey(data);
  if(_homeEarlyMapCache.key === key && _homeEarlyMapCache.map)return _homeEarlyMapCache.map;
  const map = new Map();
  data.forEach((_,i)=>{
    const reason = earlyReason(data,i,settings);
    if(reason)map.set(i,reason);
  });
  _homeEarlyMapCache = {key,map};
  return map;
}

function earlyCardPill(reason){
  if(!reason)return '';
  return `<span class="context-pill agenda-suggested" title="${escapeHtml(reason)}"><i class="ti ti-arrow-forward-up" aria-hidden="true"></i>early</span>`;
}

// RENDER: thin travel card between home list items (same surface as today).
// When fromId is CURRENT_COORD_ID the edge is computed from the live GPS coord
// via travelFromCurrent() (movement-thresholded cache) and the card is a non-
// interactive label — editing an edge anchored to an ephemeral coord would
// store an override that's stale on the next GPS tick, so the synthetic leg
// is informational only. Saved-place → saved-place legs remain tappable.
function appendHomeTravelCard(list,fromId,toId,startTs){
  if(!list || !fromId || !toId || fromId === toId)return;
  const fromCurrent = fromId === CURRENT_COORD_ID;
  const to = typeof locationById === 'function' ? locationById(toId) : null;
  const mode = normalizeTravelMode((sortSettings || {}).defaultTravelMode);
  let edge, fromName, edited;
  if(fromCurrent){
    const here = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
    edge = (here && to && typeof travelFromCurrent === 'function')
      ? travelFromCurrent(to,mode)
      : { seconds:0, metres:0, provider:'none' };
    fromName = 'here';
    edited = false;
  }else{
    const from = typeof locationById === 'function' ? locationById(fromId) : null;
    edge = (from && to && typeof travelBetween === 'function')
      ? travelBetween(from,to,mode)
      : { seconds:0 };
    fromName = from ? from.name : 'here';
    edited = typeof isManualTravelEdge === 'function' && isManualTravelEdge(edge);
  }
  const mins = Math.max(1,Math.round((edge.seconds || 0) / 60));
  const toName = to ? to.name : 'next';
  const depart = startTs ? `leave by ${compactHomeTime(startTs)} · ` : '';
  const travelEl = document.createElement('button');
  travelEl.type = 'button';
  travelEl.className = `travel-card${edited ? ' is-edited' : ''}${fromCurrent ? ' is-from-current' : ''}`;
  travelEl.dataset.travelFrom = fromId;
  travelEl.dataset.travelTo = toId;
  if(Number.isFinite(startTs))travelEl.dataset.agendaStart = String(Math.round(startTs / 60000));
  travelEl.setAttribute('aria-label',`travel time ${fromName} to ${toName}`);
  if(fromCurrent)travelEl.setAttribute('aria-disabled','true');
  travelEl.innerHTML = `<span class="timeline-card-icon"><i class="ti ti-route" aria-hidden="true"></i></span><span class="timeline-card-copy"><b>${compactHomeDuration(mins)} travel</b><small>${depart}${escapeHtml(fromName)} → ${escapeHtml(toName)}</small></span>${edited ? '<i class="ti ti-pencil travel-edit-mark" aria-label="custom time"></i>' : ''}${fromCurrent ? '' : '<i class="ti ti-chevron-right timeline-card-chevron" aria-hidden="true"></i>'}`;
  list.appendChild(travelEl);
  // Synthetic current-coord legs are not editable — skip all gesture wiring.
  if(fromCurrent)return;
  let travelPointer = null;
  travelEl.addEventListener('pointerdown',e=>{
    const scrollHost = travelEl.closest('.pane-list,.sheet,.detail-page');
    travelPointer = {el:travelEl,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),maxMove:0,
      scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY};
  },{passive:true});
  travelEl.addEventListener('pointermove',e=>{
    if(!travelPointer || travelPointer.el !== travelEl || travelPointer.id !== e.pointerId)return;
    travelPointer.maxMove = Math.max(travelPointer.maxMove,Math.hypot(e.clientX-travelPointer.x,e.clientY-travelPointer.y));
  },{passive:true});
  travelEl.addEventListener('pointerup',e=>{
    if(!travelPointer || travelPointer.el !== travelEl || travelPointer.id !== e.pointerId)return;
    const tap = travelPointer;
    travelPointer = null;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX - tap.x,e.clientY - tap.y));
    const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
    if(moved > 8 || Math.abs(scrollTop-tap.scrollTop) > 1 || Date.now() - tap.time > 650){
      travelEl.dataset.ignoreClickUntil = String(Date.now()+500);
      return;
    }
    travelEl.dataset.approvedClickUntil = String(Date.now()+500);
  });
  travelEl.addEventListener('pointercancel',e=>{
    if(travelPointer && travelPointer.el === travelEl && travelPointer.id === e.pointerId){
      const tap = travelPointer;travelPointer = null;
      const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
      if(tap.maxMove > 8 || Math.abs(scrollTop-tap.scrollTop) > 1)travelEl.dataset.ignoreClickUntil = String(Date.now()+500);
    }
  });
  travelEl.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(Number(travelEl.dataset.ignoreClickUntil || 0) > Date.now())return;
    // Mirrors habit cards: tap to edit the leg, double tap to just go.
    handleDoubleTapActivate(`travel:${fromId}|${toId}`,
      ()=>openTravelEditSheet(fromId,toId),
      ()=>openTravelLegInMaps(toId));
  });
}

// Module state: which consecutive blocked groups are expanded on the home list.
const expandedBlockedGroups = new Set();

// Visible window (ms) for the "next 12 hours" cleanup levels.
const HOME_EXTRA_WINDOW_MS = 12 * 60 * 60 * 1000;

// PURE: normalized home blocked/travel presentation mode.
function homeExtraMode(){
  return (typeof normalizeHomeExtraMode === 'function' && normalizeHomeExtraMode(sortSettings.homeExtraMode))
    || 'cards';
}

// PURE: whether a blocked/travel row (keyed by its start ts) is shown under the
// current homeExtraMode. 'cards' shows everything; the 12h modes hide anything
// whose start lies past the next 12 hours (still-active blocks keep their past
// start, so an in-progress block stays visible).
function homeExtraRowVisible(ts){
  if(typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode))return false;
  if(homeExtraMode() === 'cards')return true;
  return Number.isFinite(ts) && ts < Date.now() + HOME_EXTRA_WINDOW_MS;
}

// RENDER: plain muted background line for a home travel leg (text cleanup level).
function appendHomeTravelText(list,fromId,toId,startTs){
  if(!list || !fromId || !toId || fromId === toId)return;
  const fromCurrent = fromId === CURRENT_COORD_ID;
  const to = typeof locationById === 'function' ? locationById(toId) : null;
  const mode = normalizeTravelMode((sortSettings || {}).defaultTravelMode);
  let edge, fromName;
  if(fromCurrent){
    const here = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
    edge = (here && to && typeof travelFromCurrent === 'function')
      ? travelFromCurrent(to,mode)
      : { seconds:0 };
    fromName = 'here';
  }else{
    const from = typeof locationById === 'function' ? locationById(fromId) : null;
    edge = (from && to && typeof travelBetween === 'function')
      ? travelBetween(from,to,mode)
      : { seconds:0 };
    fromName = from ? from.name : 'here';
  }
  const mins = Math.max(1,Math.round((edge.seconds || 0) / 60));
  const depart = startTs ? `leave by ${compactHomeTime(startTs)} · ` : '';
  const el = document.createElement('div');
  el.className = 'extra-text-line travel-text';
  el.dataset.travelFrom = fromId;
  el.dataset.travelTo = toId;
  if(Number.isFinite(startTs))el.dataset.agendaStart = String(Math.round(startTs / 60000));
  el.textContent = `${depart}${compactHomeDuration(mins)} · ${fromName} → ${to ? to.name : 'next'}`;
  list.appendChild(el);
}

// RENDER: plain muted background line for a blocked-time instance (text level).
function appendHomeBlockedText(list,row){
  if(!list || !row)return;
  const loc = row.locationId && typeof locationById === 'function' ? locationById(row.locationId) : null;
  const start = compactHomeTime(row.start);
  const end = compactHomeTime(row.end);
  const place = loc ? ` · ${loc.name}` : '';
  const el = document.createElement('div');
  el.className = 'extra-text-line blocked-text';
  el.textContent = `${row.label || 'blocked'} · ${start}–${end}${place}`;
  list.appendChild(el);
}

// RENDER: dispatch a blocked row to a card or a muted line per homeExtraMode.
function appendHomeExtraBlocked(list,row){
  if(homeExtraMode() === 'text12h')appendHomeBlockedText(list,row);
  else appendHomeBlockedCard(list,row);
}

// RENDER: dispatch a travel leg to a card or a muted line per homeExtraMode.
function appendHomeExtraTravel(list,fromId,toId,startTs){
  if(homeExtraMode() === 'text12h')appendHomeTravelText(list,fromId,toId,startTs);
  else appendHomeTravelCard(list,fromId,toId,startTs);
}

// PURE: leave-by for a saved→saved (or here→saved) home travel card.
// destStart − travel, floored at now so the card never shows a past depart.
function homeTravelLeaveByMs(fromId,toId,destStart){
  if(!Number.isFinite(destStart))return Date.now();
  const mode = normalizeTravelMode((sortSettings || {}).defaultTravelMode);
  let seconds = 0;
  if(fromId === CURRENT_COORD_ID){
    const here = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
    const to = typeof locationById === 'function' ? locationById(toId) : null;
    if(here && to && typeof travelFromCurrent === 'function'){
      seconds = Number(travelFromCurrent(to,mode).seconds) || 0;
    }
  }else{
    const from = typeof locationById === 'function' ? locationById(fromId) : null;
    const to = typeof locationById === 'function' ? locationById(toId) : null;
    if(from && to && typeof travelBetween === 'function'){
      seconds = Number(travelBetween(from,to,mode).seconds) || 0;
    }
  }
  return Math.max(destStart - seconds * 1000, Date.now());
}

// RENDER: blocked-time card on home — tap cancels this instance for today.
let blockedCardActivationLocked = false;
let blockedCardActivationTimer = null;
function lockBlockedCardActivation(ms = 180){
  blockedCardActivationLocked = true;
  clearTimeout(blockedCardActivationTimer);
  blockedCardActivationTimer = setTimeout(()=>{blockedCardActivationLocked = false;},ms);
}
function bindScrollSafeTap(el,activate,ignoreSelector = ''){
  let pointer = null;
  let handledUntil = 0;
  const recoverStationaryTap = tap=>{
    setTimeout(()=>{
      if(!el.isConnected || Date.now() < handledUntil)return;
      const settledTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
      if(Math.abs(settledTop-tap.scrollTop) > 1)return;
      handledUntil = Date.now()+500;
      activate(new Event('click'));
    },60);
  };
  el.addEventListener('pointerdown',e=>{
    if(ignoreSelector && e.target.closest(ignoreSelector))return;
    const scrollHost = el.closest('.pane-list,.sheet,.detail-page');
    pointer = {id:e.pointerId,x:e.clientX,y:e.clientY,maxMove:0,time:Date.now(),
      scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY};
  },{passive:true});
  el.addEventListener('pointermove',e=>{
    if(!pointer || pointer.id !== e.pointerId)return;
    pointer.maxMove = Math.max(pointer.maxMove,Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y));
  },{passive:true});
  el.addEventListener('pointerup',e=>{
    if(!pointer || pointer.id !== e.pointerId)return;
    const tap = pointer;pointer = null;
    const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX-tap.x,e.clientY-tap.y));
    if(moved > 8 || Math.abs(scrollTop-tap.scrollTop) > 1 || Date.now()-tap.time > 650){
      el.dataset.ignoreClickUntil = String(Date.now()+500);return;
    }
    recoverStationaryTap(tap);
  });
  el.addEventListener('pointercancel',()=>{
    const tap = pointer;pointer = null;
    if(!tap)return;
    const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
    if(tap.maxMove > 8 || Math.abs(scrollTop-tap.scrollTop) > 1){
      el.dataset.ignoreClickUntil = String(Date.now()+500);
      return;
    }
    // Mobile WebKit sometimes cancels an otherwise stationary tap and emits
    // no click. Wait briefly so a real scroll has time to move, then recover
    // only when both the finger and scroll host remained still.
    recoverStationaryTap(tap);
  },{passive:true});
  el.addEventListener('click',e=>{
    if(ignoreSelector && e.target.closest(ignoreSelector))return;
    e.preventDefault();e.stopPropagation();
    if(Date.now() < handledUntil)return;
    if(Number(el.dataset.ignoreClickUntil || 0) > Date.now())return;
    handledUntil = Date.now()+500;
    activate(e);
  });
}

function appendHomeBlockedCard(list,row){
  if(!list || !row)return;
  const loc = row.locationId && typeof locationById === 'function' ? locationById(row.locationId) : null;
  const start = compactHomeTime(row.start);
  const end = compactHomeTime(row.end);
  const place = loc ? ` · ${loc.name}` : '';
  // Tap opens the per-instance editor; the X frees this occurrence for today.
  const el = document.createElement('div');
  el.className = 'blocked-card';
  el.dataset.blockedDay = dateKey(row.start);
  el.tabIndex = 0;
  el.setAttribute('role','button');
  el.setAttribute('aria-label',`${row.label || 'blocked'} ${start} to ${end}${place}`);
  el.innerHTML = `<span class="timeline-card-icon"><i class="ti ti-lock" aria-hidden="true"></i></span><span class="timeline-card-copy"><b>${escapeHtml(row.label || 'blocked')}</b><small>${escapeHtml(start)}–${escapeHtml(end)}${escapeHtml(place)}</small></span><i class="ti ti-chevron-right timeline-card-chevron" aria-hidden="true"></i><button type="button" class="blocked-cancel-mark" aria-label="clear ${escapeHtml(row.label || 'blocked') || 'block'} for today"><i class="ti ti-x" aria-hidden="true"></i></button>`;
  const xBtn = el.querySelector('.blocked-cancel-mark');
  if(xBtn)xBtn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    cancelHomeBlockedRow(row);
  });
  bindScrollSafeTap(el,()=>{
    if(blockedCardActivationLocked)return;
    // Let the browser finish the click sequence before mounting an overlay;
    // otherwise the new backdrop can intercept the tail of the same gesture.
    setTimeout(()=>{
      if(blockedCardActivationLocked)return;
      if(typeof openBlockEditSheet === 'function')openBlockEditSheet(row);
    },0);
  },'.blocked-cancel-mark');
  el.addEventListener('keydown',e=>{
    if((e.key === 'Enter' || e.key === ' ') && !e.target.closest('.blocked-cancel-mark')){
      e.preventDefault();
      if(!blockedCardActivationLocked && typeof openBlockEditSheet === 'function')openBlockEditSheet(row);
    }
  });
  list.appendChild(el);
}

/** HANDLER: cancel one blocked instance for its day and refresh, with undo. */
function cancelHomeBlockedRow(row){
  if(!row)return;
  lockBlockedCardActivation();
  const dayKey = dateKey(row.start);
  const startMin = row.blockStartMin != null ? row.blockStartMin : (row.startMin != null ? row.startMin : Math.round((row.start - dayStart(row.start)) / 60000));
  const endMin = row.blockEndMin != null ? row.blockEndMin : (row.endMin != null ? row.endMin : Math.round((row.end - dayStart(row.start)) / 60000));
  cancelBlockedInstance(dayKey,row.label,startMin,endMin);
  // Overnight blocks (end <= start) wrap past midnight: their full minute span
  // is (1440 − start + end), and cancelling the signature frees BOTH halves of
  // the day's interval at once. Plain `end − start` would go negative here and
  // wrongly *subtract* from the day's capacity.
  const effectiveStart = row.effectiveBlockStartMin != null ? row.effectiveBlockStartMin : startMin;
  const effectiveEnd = row.effectiveBlockEndMin != null ? row.effectiveBlockEndMin : endMin;
  const freedMin = typeof blockDurationMinutes === 'function'
    ? blockDurationMinutes(effectiveStart,effectiveEnd)
    : (effectiveEnd > effectiveStart ? effectiveEnd - effectiveStart : (1440 - effectiveStart) + effectiveEnd);
  const s = loadSortSettings();
  const overrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
  const current = effectiveAvailabilityMinutes(dayKey,s);
  overrides[dayKey] = Math.max(0,current + freedMin);
  saveSortSettings({...s,availabilityOverrides:overrides});
  // Keep the solved fill placements mounted, but rebuild presentation-only
  // rows from the newly saved block settings immediately. Otherwise the old
  // cancelled X remains actionable until the replacement solve completes and
  // a quick second tap can free the same block twice.
  if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
  if(typeof render === 'function')render();
  showActionToast(`Freed ${row.label || 'blocked'} for today`,{
    type:'restore-blocked',
    dayKey,label:row.label,startMin,endMin,freedMin,
    undoLabel:'undo'
  });
}

// RENDER: one card for a run of consecutive blocked times. Tap expands to the
// individual rows (and tap again collapses) so week-home stays quieter.
function appendHomeBlockedGroup(list,blocks,groupKey){
  if(!list || !blocks || !blocks.length)return;
  if(blocks.length === 1){
    appendHomeBlockedCard(list,blocks[0]);
    return;
  }
  const expanded = expandedBlockedGroups.has(groupKey);
  const start = compactHomeTime(blocks[0].start);
  const end = compactHomeTime(blocks[blocks.length - 1].end);
  const labels = blocks.map(b => b.label || 'blocked').filter(Boolean);
  const summary = labels.length <= 3
    ? labels.join(', ')
    : `${labels.slice(0,2).join(', ')} +${labels.length - 2}`;
  const wrap = document.createElement('div');
  wrap.className = `blocked-group${expanded ? ' is-expanded' : ''}`;
  wrap.dataset.blockedGroup = groupKey;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'blocked-card blocked-card-merge';
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.setAttribute(
    'aria-label',
    expanded
      ? `collapse ${blocks.length} busy times`
      : `${blocks.length} busy times ${start} to ${end}, tap to expand`
  );
  toggle.innerHTML = `<span class="timeline-card-icon"><i class="ti ti-lock" aria-hidden="true"></i></span><span class="timeline-card-copy"><b>${blocks.length} busy times</b><small>${escapeHtml(summary)} · ${escapeHtml(start)}–${escapeHtml(end)}</small></span><i class="ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'} blocked-card-chevron" aria-hidden="true"></i>`;
  let mergePointer = null;
  toggle.addEventListener('pointerdown',e=>{
    mergePointer = {el:toggle,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
  },{passive:true});
  toggle.addEventListener('pointerup',e=>{
    if(!mergePointer || mergePointer.el !== toggle || mergePointer.id !== e.pointerId)return;
    const tap = mergePointer;
    mergePointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    if(moved > 10 || Date.now() - tap.time > 800)return;
    toggle.dataset.approvedClickUntil = String(Date.now()+500);
  });
  toggle.addEventListener('pointercancel',e=>{
    if(mergePointer && mergePointer.el === toggle && mergePointer.id === e.pointerId)mergePointer = null;
  });
  toggle.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(e.detail !== 0 && Number(toggle.dataset.approvedClickUntil || 0) < Date.now())return;
    lockBlockedCardActivation();
    if(expandedBlockedGroups.has(groupKey))expandedBlockedGroups.delete(groupKey);
    else expandedBlockedGroups.add(groupKey);
    if(typeof renderHomePresentationOnly === 'function')renderHomePresentationOnly();
    else if(typeof render === 'function')render();
  });
  wrap.appendChild(toggle);

  if(expanded){
    const detail = document.createElement('div');
    detail.className = 'blocked-group-detail';
    blocks.forEach(row => appendHomeBlockedCard(detail,row));
    wrap.appendChild(detail);
  }
  list.appendChild(wrap);
}

// PURE: walk a day sequence and fold back-to-back blocked rows into groups.
function consumeBlockedRun(seq,startIdx){
  const blocks = [];
  let i = startIdx;
  while(i < seq.length && seq[i].kind === 'blocked'){
    blocks.push(seq[i]);
    i += 1;
  }
  return {blocks,nextIdx:i};
}

function capacityMinutesLabel(value){
  const minutes = Math.max(0,Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if(!hours)return `${rest}m`;
  if(!rest)return `${hours}h`;
  return `${hours}h ${rest}m`;
}

function capacityTimeLabel(value){
  return new Date(value).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}

function plannerTraceScoreSummary(item){
  if(!item)return '';
  const parts = [];
  if(Number.isFinite(item.optimizerWeight)){
    parts.push(`optimizer option ${item.optimizerWeight.toFixed(3)} (higher wins)`);
  }
  if(Number.isFinite(item.optimizerCandidateWeight)){
    parts.push(`candidate ${item.optimizerCandidateWeight.toFixed(2)}`);
  }
  if(Number.isFinite(item.optimizerDelayMinutes)){
    parts.push(`option delay ${Math.round(item.optimizerDelayMinutes)}m`);
  }
  if(Number.isFinite(item.score)){
    parts.push(`fit-generator cost ${item.score.toFixed(2)} (lower wins)`);
  }
  const t = item.scoreTerms;
  if(t){
    const travelMin = Math.round((Number(t.travelSeconds) || 0) / 60);
    const delayMin = Math.round(Number(t.asapDelayMin) || 0);
    const scarceMin = Math.round((Number(t.scarceOverlapMs) || 0) / 60000);
    const pref = Math.round(Number(t.preferencePenalty) || 0);
    const order = Math.round(Number(t.orderPenalty) || 0);
    parts.push(`fit signals: travel ${travelMin}m, local delay ${delayMin}m, scarce overlap ${scarceMin}m, preference ${pref}, order ${order}`);
  }
  return parts.join(' / ');
}

// Last opened audit — kept so copy/export work without rebuilding the sheet.
let _dayCapacityReport = null;
let _dayCapacityTitle = '';
let _dayCapacitySub = '';

// PURE: plain-text dump of a day capacity scorecard (for clipboard / .txt export).
function formatDayCapacityScorecardText(report,title = '',sub = ''){
  if(!report)return '';
  const lines = [];
  const push = (s = '')=>lines.push(s);
  const pct = n=>`${Math.round((Number(n) || 0) * 100)}%`;
  const dayLabel = title || (report.isToday
    ? 'today'
    : new Date(report.dayBase).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}).toLowerCase());
  push(dayLabel);
  if(sub)push(sub);
  if(report.plannerIsPreview){
    push('FAST PREVIEW — GLPK optimizer is still running; placements and totals may change');
  }
  push('');
  push('ELIGIBLE WORK');
  push(capacityMinutesLabel(report.outstandingLoad));
  push(`${report.eligibleCount} candidate${report.eligibleCount === 1 ? '' : 's'}`);
  push('WORK PLACED');
  push(capacityMinutesLabel(report.placedLoadMinutes));
  push(`${pct(report.eligibleCoverage)} of eligible work`);
  push(report.plannerIsPreview ? 'BUDGET USED / PREVIEW' : 'BUDGET USED');
  push(pct(report.budgetUtilization));
  push(`${capacityMinutesLabel(report.agendaUsedMinutes)} of ${capacityMinutesLabel(report.agendaBudgetMinutes)}`);
  push('MISSED GAPS');
  push(String(report.missedOpportunityCount));
  push(`${capacityMinutesLabel(report.largestGapMinutes)} largest open gap`);
  push('PLACEMENT AUDIT');
  push(report.missedOpportunityCount > 0
    ? `${report.missedOpportunityCount} usable gap${report.missedOpportunityCount === 1 ? '' : 's'} missed`
    : 'no unexplained placement gaps');
  push(report.missedOpportunityCount > 0
    ? 'eligible work still fits under the scheduler\'s current constraints'
    : (report.budgetCappedGapCount > 0
      ? `${report.budgetCappedGapCount} open gap${report.budgetCappedGapCount === 1 ? '' : 's'} left by the agenda budget cap`
      : 'remaining gaps cannot take the outstanding candidates'));
  push('');
  push(`open scheduler time\n${capacityMinutesLabel(report.schedulerOpenMinutes)}`);
  push(`budget remaining\n${capacityMinutesLabel(report.placementBudgetRemaining)}`);
  push(`scheduled events\n${capacityMinutesLabel(report.scheduledMinutes)}`);
  push(`travel committed\n${capacityMinutesLabel(report.travelMinutes)}`);
  push('');
  push('HOME AGENDA OUTPUT');
  push(String(report.agendaRows.length));
  for(const row of report.agendaRows){
    push(`${capacityTimeLabel(row.start)}`);
    push(`${capacityTimeLabel(row.end)}`);
    push(row.name);
    push(`${capacityMinutesLabel(row.minutes).toUpperCase()} / ${String(row.kind).toUpperCase()}`);
  }
  if(report.hiddenAgendaRowCount){
    push(`${report.hiddenAgendaRowCount} scheduler placement${report.hiddenAgendaRowCount === 1 ? '' : 's'} not shown because of the current pin or filter view.`);
  }
  push('');
  push('PLANNER DECISION TRACE');
  push(`${(report.plannerTrace || []).length} decisions`);
  push(`engine ${report.plannerEngine || 'planner'}`);
  if(report.plannerIsPreview){
    push('snapshot status fast preview; the GLPK optimizer may replace these placements when ready');
  }
  push('generated on demand when this audit opened; no continuous solver log');
  push('earliest clock fit ignores location, travel, ordering, budget, and cross-item objective');
  for(const item of report.plannerTrace || []){
    push('');
    push(`${String(item.status).toUpperCase()} / ${item.name}`);
    push(`selected ${item.selected}`);
    if(item.earliestClockFit != null){
      push(`earliest clock-only fit ${capacityTimeLabel(item.earliestClockFit)}`);
    }
    push(`engine ${item.engine}`);
    push(`decision ${item.decision}`);
    for(const input of item.inputs || [])push(`input ${input}`);
    const score = plannerTraceScoreSummary(item);
    if(score)push(`score ${score}`);
  }
  push('');
  push('REMAINING GAP AUDIT');
  push(String(report.placementGaps.length));
  const gapLabels = {
    missed:'COULD PLACE',
    'assigned-elsewhere':'PLACED ELSEWHERE',
    'budget-capped':'BUDGET CAPPED',
    'no-fit':'NO ELIGIBLE FIT'
  };
  for(const gap of report.placementGaps){
    push(`${capacityTimeLabel(gap.start)}-${capacityTimeLabel(gap.end)}`);
    push(capacityMinutesLabel(gap.minutes));
    push(gapLabels[gap.status] || String(gap.status).toUpperCase());
    push(gap.explanation || '');
  }
  push('');
  push('CAPACITY CONTEXT');
  push(`clock ${capacityMinutesLabel(report.totalCapacity)}`);
  push(`blocked ${capacityMinutesLabel(report.blockedMinutes)}`);
  push(`net ${capacityMinutesLabel(report.netAvailable)}`);
  for(const block of report.blockedBreakdown || []){
    push(`${block.label} ${capacityMinutesLabel(block.minutes)}`);
  }
  push('');
  push('UNPLACED ITEMS');
  push(String(report.unplacedItems.length));
  for(const item of report.unplacedItems){
    push(item.name);
    push(`${PRIORITY_LABELS[item.priority] || `P${item.priority}`} / ${String(item.type).toUpperCase()}`);
    push(`${capacityMinutesLabel(item.remainingMinutes)} unplaced${item.placedMinutes ? ` / ${capacityMinutesLabel(item.placedMinutes)} placed` : ''}`);
    const reasonBits = [item.reason,item.window].filter(Boolean);
    if(reasonBits.length)push(reasonBits.join(' / '));
  }
  return lines.join('\n').trim() + '\n';
}

async function copyTextToClipboard(text){
  if(!text)return false;
  try{
    if(navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(_){ /* fall through */ }
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  }catch(_){
    return false;
  }
}

function dayCapacityExportFilename(report){
  const key = report && report.dayKey
    ? report.dayKey
    : new Date().toISOString().slice(0,10);
  return `tings-agenda-audit-${key}.txt`;
}

function weekPlacementsExportFilename(week,now = Date.now()){
  const days = week && Array.isArray(week.days) ? week.days : [];
  const start = days[0] && days[0].dayBase != null ? dateKey(days[0].dayBase) : dateKey(now);
  const end = days.length && days[days.length - 1].dayBase != null
    ? dateKey(days[days.length - 1].dayBase)
    : start;
  return start === end
    ? `tings-week-placements-${start}.txt`
    : `tings-week-placements-${start}_to_${end}.txt`;
}

// PURE: resolve the week snapshot used for placement export (rendered home
// week first, otherwise a fresh 7-day build).
function weekSnapshotForExport(now = Date.now()){
  if(_homeRenderedWeek && Array.isArray(_homeRenderedWeek.days) && _homeRenderedWeek.days.length){
    return _homeRenderedWeek;
  }
  if(typeof buildWeekAgenda === 'function' && typeof load === 'function' && typeof sortSettings !== 'undefined'){
    try{ return buildWeekAgenda(load(),sortSettings,7); }
    catch(_){ /* fall through */ }
  }
  return null;
}

// PURE: compact week placement dump — day headers + timed rows only.
// Meant for pasting into chat as scheduler context (not the full day audit).
function formatWeekPlacementsText(week,now = Date.now()){
  if(!week || !Array.isArray(week.days) || !week.days.length)return '';
  const data = typeof load === 'function' ? load() : [];
  const lines = [];
  const push = (s = '')=>lines.push(s);
  const first = week.days[0];
  const last = week.days[week.days.length - 1];
  const rangeLabel = (()=>{
    const a = new Date(first.dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    const b = new Date(last.dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    return `${a} – ${b}`.toLowerCase();
  })();
  push('WEEK PLACEMENTS');
  push(rangeLabel);
  push(week.optimized ? 'source: optimizer week' : 'source: home week agenda');
  push('');
  for(const day of week.days){
    const label = typeof homeWeekDayLabel === 'function'
      ? homeWeekDayLabel(day,now)
      : new Date(day.dayBase).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    const full = new Date(day.dayBase).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'});
    push(full.toUpperCase());
    if(label && label.toLowerCase() !== full.toLowerCase())push(`(${label})`);
    const rows = (day.homeDisplayedTimeline || day.timeline || [])
      .filter(row=>row && (row.kind === 'fill' || row.kind === 'scheduled' || row.kind === 'travel'));
    if(!rows.length){
      push('  — no placements');
      push('');
      continue;
    }
    for(const row of rows){
      const mins = Math.max(0,Math.round((row.end - row.start) / 60000));
      const name = row.kind === 'travel'
        ? `travel${row.toName ? ` to ${row.toName}` : ''}`
        : (row.h && row.h.name
          || (row.i != null && data[row.i] && data[row.i].name)
          || 'scheduled item');
      push(`  ${capacityTimeLabel(row.start)}–${capacityTimeLabel(row.end)}  ${name}  ${capacityMinutesLabel(mins)}  ${row.kind}`);
    }
    push('');
  }
  return lines.join('\n').trim() + '\n';
}

async function copyWeekPlacements(){
  const week = weekSnapshotForExport();
  if(!week){
    if(typeof showToast === 'function')showToast('no week agenda yet');
    return;
  }
  const text = formatWeekPlacementsText(week);
  const ok = await copyTextToClipboard(text);
  if(typeof showToast === 'function')showToast(ok ? 'week placements copied' : 'copy failed');
}

function exportWeekPlacements(){
  const week = weekSnapshotForExport();
  if(!week){
    if(typeof showToast === 'function')showToast('no week agenda yet');
    return;
  }
  const text = formatWeekPlacementsText(week);
  const blob = new Blob([text],{type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = weekPlacementsExportFilename(week);
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ if(a.isConnected)document.body.removeChild(a); URL.revokeObjectURL(url); },1000);
  if(typeof showToast === 'function')showToast('week placements exported');
}

async function copyDayCapacityScorecard(){
  if(!_dayCapacityReport){
    if(typeof showToast === 'function')showToast('open an audit first');
    return;
  }
  const text = formatDayCapacityScorecardText(_dayCapacityReport,_dayCapacityTitle,_dayCapacitySub);
  const ok = await copyTextToClipboard(text);
  if(typeof showToast === 'function')showToast(ok ? 'day audit copied' : 'copy failed');
}

function exportDayCapacityScorecard(){
  if(!_dayCapacityReport){
    if(typeof showToast === 'function')showToast('open an audit first');
    return;
  }
  const text = formatDayCapacityScorecardText(_dayCapacityReport,_dayCapacityTitle,_dayCapacitySub);
  const blob = new Blob([text],{type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dayCapacityExportFilename(_dayCapacityReport);
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ if(a.isConnected)document.body.removeChild(a); URL.revokeObjectURL(url); },1000);
  if(typeof showToast === 'function')showToast('day audit exported');
}

function renderDayCapacityScorecard(report){
  const content = $('day-capacity-content');
  if(!content || !report)return;
  const metric = (label,value,detail='',tone='')=>`
    <div class="capacity-metric${tone ? ` ${tone}` : ''}">
      <span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>`;
  const coverage = `${Math.round((Number(report.eligibleCoverage) || 0) * 100)}%`;
  const budgetUse = `${Math.round((Number(report.budgetUtilization) || 0) * 100)}%`;
  const auditHeadline = report.missedOpportunityCount > 0
    ? `${report.missedOpportunityCount} usable gap${report.missedOpportunityCount === 1 ? '' : 's'} missed`
    : 'no unexplained placement gaps';
  const auditDetail = report.missedOpportunityCount > 0
    ? 'eligible work still fits under the scheduler\'s current constraints'
    : (report.budgetCappedGapCount > 0
      ? `${report.budgetCappedGapCount} open gap${report.budgetCappedGapCount === 1 ? '' : 's'} left by the agenda budget cap`
      : 'remaining gaps cannot take the outstanding candidates');
  const agendaRows = report.agendaRows.length
    ? report.agendaRows.map(row=>`
      <div class="capacity-agenda-row ${escapeHtml(row.kind)}">
        <time>${capacityTimeLabel(row.start)}<small>${capacityTimeLabel(row.end)}</small></time>
        <div><b>${escapeHtml(row.name)}</b><small>${capacityMinutesLabel(row.minutes)} / ${escapeHtml(row.kind)}</small></div>
      </div>`).join('')
    : '<p class="capacity-empty">The agenda builder committed no timed rows.</p>';
  const gapRows = report.placementGaps.length
    ? report.placementGaps.map(gap=>{
      const labels = {
        missed:'could place',
        'assigned-elsewhere':'placed elsewhere',
        'budget-capped':'budget capped',
        'no-fit':'no eligible fit'
      };
      return `
        <div class="capacity-gap ${escapeHtml(gap.status)}" data-capacity-gap-status="${escapeHtml(gap.status)}">
          <div class="capacity-gap-time">
            <b>${capacityTimeLabel(gap.start)}-${capacityTimeLabel(gap.end)}</b>
            <span>${capacityMinutesLabel(gap.minutes)}</span>
          </div>
          <div class="capacity-gap-result">
            <strong>${escapeHtml(labels[gap.status] || gap.status)}</strong>
            <small>${escapeHtml(gap.explanation)}</small>
          </div>
        </div>`;
    }).join('')
    : '<p class="capacity-empty">No open scheduler gaps remain.</p>';
  const blocks = report.blockedBreakdown.length
    ? report.blockedBreakdown.map(block=>`<span>${escapeHtml(block.label)} <b>${capacityMinutesLabel(block.minutes)}</b></span>`).join('')
    : '<span>none</span>';
  const unplaced = report.unplacedItems.length
    ? report.unplacedItems.map(item=>`
      <div class="capacity-unplaced-item" data-capacity-item-index="${item.i}">
        <div class="capacity-unplaced-head">
          <b>${escapeHtml(item.name)}</b>
          <span>${escapeHtml(PRIORITY_LABELS[item.priority] || `P${item.priority}`)} / ${escapeHtml(item.type)}</span>
        </div>
        <p>${capacityMinutesLabel(item.remainingMinutes)} unplaced${item.placedMinutes ? ` / ${capacityMinutesLabel(item.placedMinutes)} placed` : ''}</p>
        <small>${escapeHtml(item.reason)}${item.window ? ` / ${escapeHtml(item.window)}` : ''}</small>
      </div>`).join('')
    : '<p class="capacity-empty">Every eligible item was fully placed.</p>';
  const traceRows = (report.plannerTrace || []).length
    ? report.plannerTrace.map(item=>{
      const score = plannerTraceScoreSummary(item);
      return `
        <details class="capacity-trace-item ${escapeHtml(item.status)}" data-capacity-trace-item>
          <summary>
            <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.status)} / ${escapeHtml(item.engine)}</small></span>
            <time>${escapeHtml(item.selected)}</time>
          </summary>
          <div class="capacity-trace-body">
            <p>${escapeHtml(item.decision)}</p>
            ${item.earliestClockFit != null ? `<p class="capacity-trace-clock">earliest clock-only fit <b>${capacityTimeLabel(item.earliestClockFit)}</b></p>` : ''}
            <ul>${(item.inputs || []).map(input=>`<li>${escapeHtml(input)}</li>`).join('')}</ul>
            ${score ? `<code>${escapeHtml(score)}</code>` : ''}
          </div>
        </details>`;
    }).join('')
    : '<p class="capacity-empty">No planner decisions were present for this day.</p>';
  content.innerHTML = `
    ${report.plannerIsPreview
      ? '<p class="capacity-note capacity-preview-note"><b>Fast preview:</b> the GLPK optimizer is still running, so placements and totals may change.</p>'
      : ''}
    <div class="capacity-export-hint">
      <span>copy / download = entire week placements</span>
      <button type="button" class="capacity-day-audit-copy" data-capacity-copy-day>copy this day audit</button>
    </div>
    <div class="capacity-metrics">
      ${metric('eligible work',capacityMinutesLabel(report.outstandingLoad),`${report.eligibleCount} candidate${report.eligibleCount === 1 ? '' : 's'}`,'load')}
      ${metric('work placed',capacityMinutesLabel(report.placedLoadMinutes),`${coverage} of eligible work`,'net')}
      ${metric(report.plannerIsPreview ? 'budget used · preview' : 'budget used',budgetUse,`${capacityMinutesLabel(report.agendaUsedMinutes)} of ${capacityMinutesLabel(report.agendaBudgetMinutes)}`)}
      ${metric('missed gaps',String(report.missedOpportunityCount),`${capacityMinutesLabel(report.largestGapMinutes)} largest open gap`,report.missedOpportunityCount ? 'warning' : '')}
    </div>
    <div class="capacity-balance ${report.missedOpportunityCount ? 'deficit' : 'surplus'}">
      <div><span>placement audit</span><b>${escapeHtml(auditHeadline)}</b></div>
      <strong>${escapeHtml(auditDetail)}</strong>
    </div>
    <div class="capacity-facts" aria-label="scheduler totals">
      <span>open scheduler time <b>${capacityMinutesLabel(report.schedulerOpenMinutes)}</b></span>
      <span>budget remaining <b>${capacityMinutesLabel(report.placementBudgetRemaining)}</b></span>
      <span>scheduled events <b>${capacityMinutesLabel(report.scheduledMinutes)}</b></span>
      <span>travel committed <b>${capacityMinutesLabel(report.travelMinutes)}</b></span>
    </div>
    <section class="capacity-section">
      <div class="capacity-section-head"><h3>home agenda output</h3><span>${report.agendaRows.length}</span></div>
      <div class="capacity-agenda">${agendaRows}</div>
      ${report.hiddenAgendaRowCount ? `<p class="capacity-note">${report.hiddenAgendaRowCount} scheduler placement${report.hiddenAgendaRowCount === 1 ? '' : 's'} not shown in this day section because of the current pin or filter view.</p>` : ''}
    </section>
    <section class="capacity-section">
      <div class="capacity-section-head"><h3>planner decision trace</h3><span>${(report.plannerTrace || []).length}</span></div>
      <p class="capacity-note">${report.plannerIsPreview ? 'This is the fast preview/fallback snapshot; the GLPK optimizer may replace it when ready. ' : ''}Built only when this audit opens. It shows the planner’s inputs, resolved constraints, scores, and outcomes—not a continuous GLPK branch log. “Earliest clock-only fit” intentionally excludes location, travel, ordering, budget, and whole-day competition.</p>
      <div class="capacity-trace">${traceRows}</div>
    </section>
    <section class="capacity-section">
      <div class="capacity-section-head"><h3>remaining gap audit</h3><span>${report.placementGaps.length}</span></div>
      <div class="capacity-gaps">${gapRows}</div>
    </section>
    <section class="capacity-section">
      <h3>capacity context</h3>
      <div class="capacity-breakdown">
        <span>clock <b>${capacityMinutesLabel(report.totalCapacity)}</b></span>
        <span>blocked <b>${capacityMinutesLabel(report.blockedMinutes)}</b></span>
        <span>net <b>${capacityMinutesLabel(report.netAvailable)}</b></span>
        ${blocks}
      </div>
    </section>
    <section class="capacity-section">
      <div class="capacity-section-head"><h3>unplaced items</h3><span>${report.unplacedItems.length}</span></div>
      <div class="capacity-unplaced">${unplaced}</div>
    </section>`;
}

function openDayCapacityScorecard(dayBase,weekMode = false){
  if(typeof buildDayCapacityScorecard !== 'function')return;
  const now = Date.now();
  const report = buildDayCapacityScorecard(load(),sortSettings,dayBase,now,{
    weekMode,
    weekSnapshot:weekMode ? _homeRenderedWeek : null
  });
  const title = $('day-capacity-title');
  const sub = $('day-capacity-sub');
  const sheet = $('day-capacity-sheet');
  const titleText = report.isToday
    ? 'today agenda audit'
    : new Date(report.dayBase).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}).toLowerCase();
  const subText = report.isToday
    ? `${report.usesRenderedSnapshot ? 'current home agenda' : 'remaining day'} from ${new Date(report.rangeStart).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`
    : (report.usesRenderedSnapshot ? 'current home agenda, full-day audit' : 'full-day agenda placement audit');
  if(title)title.textContent = titleText;
  if(sub)sub.textContent = subText;
  if(sheet)sheet.dataset.dayKey = report.dayKey;
  _dayCapacityReport = report;
  _dayCapacityTitle = titleText;
  _dayCapacitySub = subText;
  renderDayCapacityScorecard(report);
  openSheet('day-capacity-sheet');
}

function setupDayCapacityHeader(header,dayBase,weekMode){
  if(!header)return;
  header.classList.add('day-section-header');
  header.dataset.capacityDay = dateKey(dayBase);
  let taps = [];
  let pointerStart = null;
  header.addEventListener('pointerdown',event=>{
    pointerStart = {id:event.pointerId,x:event.clientX,y:event.clientY};
  });
  header.addEventListener('pointercancel',()=>{ pointerStart = null; });
  header.addEventListener('pointerup',event=>{
    if(!pointerStart || pointerStart.id !== event.pointerId)return;
    const moved = Math.hypot(event.clientX - pointerStart.x,event.clientY - pointerStart.y);
    pointerStart = null;
    if(moved > 10){ taps = []; return; }
    const now = performance.now();
    taps = taps.filter(ts=>now - ts < 1600);
    taps.push(now);
    if(taps.length < 3)return;
    taps = [];
    event.preventDefault();
    event.stopPropagation();
    openDayCapacityScorecard(dayBase,weekMode);
  });
}

let _droppedDayBaseline = null;
let _droppedDayBaselineDay = null;

function appendSectionHeader(list,label,dayContext = null,todayHids = null){
  if(!list || !label)return;
  const header = document.createElement('div');
  header.className = 'section-header';
  header.dataset.label = label;
  header.textContent = label;
  const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
  if(!minimal && dayContext && dayContext.dayBase != null){
    setupDayCapacityHeader(header,dayContext.dayBase,true);
    attachFreeTimeIndicator(header,dayContext);
  }else if(!minimal && label === 'today'){
    setupDayCapacityHeader(header,dayStart(Date.now()),false);
  }
  if(!minimal && label === 'today' && todayHids){
    attachDroppedIndicator(header,list,todayHids);
  }
  list.appendChild(header);
}

function computeTomorrowProjection(data,settings){
  if(typeof buildWeekAgenda !== 'function')return [];
  const week = buildWeekAgenda(data,settings,2);
  const tomorrow = week.days[1];
  if(!tomorrow || !tomorrow.timeline)return [];
  return tomorrow.timeline
    .filter(r=>(r.kind === 'fill' || r.kind === 'scheduled') && r.i != null)
    .map(r=>data[r.i]?.hid)
    .filter(Boolean);
}

function buildHidDayLabelMap(data,settings){
  const map = new Map();
  const week = _homeRenderedWeek;
  if(week && Array.isArray(week.days)){
    for(const day of week.days){
      const label = homeWeekDayLabel(day);
      const rows = day.homeDisplayedTimeline || day.timeline || [];
      for(const row of rows){
        if((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null){
          const hid = data[row.i]?.hid;
          if(hid && !map.has(hid)) map.set(hid, `in ${label}`);
        }
      }
    }
  }
  const catLabels = {0:'on today',1:'behind',2:'coming up',3:'snoozed'};
  for(let i = 0; i < data.length; i++){
    const h = data[i];
    if(!h || !h.hid || map.has(h.hid)) continue;
    map.set(h.hid, catLabels[todayCategory(h, settings)] || 'behind');
  }
  return map;
}

function computeMissedYesterday(data,baseline,slippedHids,dayLabelMap){
  if(!baseline || !Array.isArray(baseline.hids)) return [];
  const now = Date.now();
  const missed = [];
  for(const hid of baseline.hids){
    if(slippedHids.has(hid)) continue;
    const idx = data.findIndex(h => h && h.hid === hid);
    if(idx < 0) continue;
    const h = data[idx];
    if(completedToday(h, now)) continue;
    if(todayCategory(h, sortSettings) === 0) continue;
    const snoozed = Boolean(h.snoozedUntil && now < h.snoozedUntil);
    const dayLabel = dayLabelMap.get(hid) || 'behind';
    missed.push({hid, name:h.name, emoji:h.emoji, idx, snoozed, dayLabel});
  }
  return missed.sort((a,b) => Number(a.snoozed) - Number(b.snoozed));
}

function attachDroppedIndicator(header,list,todayHids){
  const data = load();
  const now = Date.now();
  const snap = loadTodaySuggested();
  const today = todayIso();
  if(_droppedDayBaselineDay !== today){
    _droppedDayBaseline = snap.prevProjection || null;
    _droppedDayBaselineDay = today;
  }
  const fingerprint = dataFingerprint(data);
  const needsProjection = !snap.projection
    || snap.projection.day !== dateKey(now + 86400000)
    || snap.projection.fingerprint !== fingerprint;
  const projectionHids = needsProjection ? computeTomorrowProjection(data,sortSettings) : null;
  recordTodaySuggested(data,todayHids,now,projectionHids,fingerprint);

  const currentSet = new Set(todayHids);
  const droppedMap = new Map();

  if(_droppedDayBaseline && Array.isArray(_droppedDayBaseline.hids)){
    for(const hid of _droppedDayBaseline.hids){
      if(currentSet.has(hid) || droppedMap.has(hid))continue;
      const idx = data.findIndex(h=>h && h.hid === hid);
      if(idx < 0)continue;
      const h = data[idx];
      if(completedToday(h,now))continue;
      const snoozed = Boolean(h.snoozedUntil && now < h.snoozedUntil);
      droppedMap.set(hid,{hid,name:h.name,emoji:h.emoji,idx,snoozed,first:now});
    }
  }

  for(const [hid,info] of Object.entries(snap.hids)){
    if(currentSet.has(hid) || droppedMap.has(hid))continue;
    const idx = data.findIndex(h=>h && h.hid === hid);
    if(idx < 0)continue;
    const h = data[idx];
    if(completedToday(h,now))continue;
    const snoozed = Boolean(h.snoozedUntil && now < h.snoozedUntil);
    droppedMap.set(hid,{hid,name:info.name || h.name,emoji:h.emoji,idx,snoozed,first:info.first});
  }

  const dropped = [...droppedMap.values()]
    .sort((a,b)=>Number(a.snoozed) - Number(b.snoozed) || a.first - b.first);
  if(!dropped.length)return;
  header.classList.add('has-dropped');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'dropped-pill';
  pill.textContent = `${dropped.length} missed`;
  bindDayHeaderPill(pill,()=>openSlippedSheet(dropped,header.dataset.label || 'today'));
  header.appendChild(pill);
}

function renderDroppedPanel(items,opts = {}){
  const showDayTag = Boolean(opts.showDayTag);
  const panel = document.createElement('div');
  panel.className = 'dropped-panel';
  items.forEach(item=>{
    const row = document.createElement('button');
    row.className = 'dropped-item' + (item.snoozed ? ' snoozed' : '');
    const tagHtml = item.snoozed
      ? '<span class="dropped-tag">snoozed</span>'
      : (showDayTag && item.dayLabel ? `<span class="dropped-tag">${escapeHtml(item.dayLabel)}</span>` : '');
    row.innerHTML = `<span class="dropped-mark">${item.emoji ? `<span class="dropped-emoji">${escapeHtml(item.emoji)}</span>` : '<i class="ti ti-circle-dashed" aria-hidden="true"></i>'}</span><span class="dropped-copy"><span class="dropped-name">${escapeHtml(item.name)}</span><small>Tap to review</small></span>${tagHtml}<i class="ti ti-chevron-right dropped-chevron" aria-hidden="true"></i>`;
    row.addEventListener('click',()=>{ closeSheet('slipped-sheet'); openDetail(item.idx); });
    panel.appendChild(row);
  });
  return panel;
}

function openSlippedSheet(items,dayLabel){
  const content = document.getElementById('slipped-content');
  if(!content)return;
  document.getElementById('slipped-title').textContent = `missed · ${dayLabel}`;
  content.innerHTML = '';

  const data = load();
  const dayLabelMap = buildHidDayLabelMap(data,sortSettings);

  const slippedWithTags = items.map(item=>({
    ...item,
    dayLabel: dayLabelMap.get(item.hid) || 'behind'
  }));

  if(slippedWithTags.length){
    const head1 = document.createElement('div');
    head1.className = 'slipped-section-head';
    head1.textContent = `missed · ${dayLabel}`;
    content.appendChild(head1);
    content.appendChild(renderDroppedPanel(slippedWithTags,{showDayTag:true}));
  }

  const slippedHids = new Set(items.map(i=>i.hid));
  const missed = computeMissedYesterday(data,_droppedDayBaseline,slippedHids,dayLabelMap);
  if(missed.length){
    const head2 = document.createElement('div');
    head2.className = 'slipped-section-head';
    head2.textContent = 'still open from yesterday';
    content.appendChild(head2);
    content.appendChild(renderDroppedPanel(missed,{showDayTag:true}));
  }

  openSheet('slipped-sheet');
}

function formatFreeDuration(minutes){
  const m = Math.max(0, Math.round(minutes));
  if(m < 60)return `${m}m`;
  const hours = m / 60;
  if(hours < 4){
    const rounded = Math.round(hours * 2) / 2;
    return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`;
  }
  return `${Math.round(hours)}h`;
}

function freeDayClockLabel(ts){
  const d = new Date(ts);
  return formatTimeShort(d.getHours() * 60 + d.getMinutes());
}

// PURE: hour tick marks for the free/busy day strip.
function freeDayTickMarks(windowStart,windowEnd){
  if(!(windowEnd > windowStart))return [];
  const spanMs = windowEnd - windowStart;
  const spanHours = spanMs / 3600000;
  const stepHours = spanHours <= 8 ? 1 : spanHours <= 14 ? 2 : 3;
  const ticks = [{ts:windowStart,edge:'start'}];
  const cursor = new Date(windowStart);
  cursor.setSeconds(0,0);
  cursor.setMinutes(0);
  cursor.setHours(cursor.getHours() + 1);
  while(cursor.getTime() < windowEnd){
    const ts = cursor.getTime();
    const pct = (ts - windowStart) / spanMs;
    if(pct > 0.08 && pct < 0.92 && cursor.getHours() % stepHours === 0){
      ticks.push({ts,edge:null});
    }
    cursor.setHours(cursor.getHours() + 1);
  }
  ticks.push({ts:windowEnd,edge:'end'});
  return ticks;
}

function renderFreeDayStrip(info,onPick){
  const wrap = document.createElement('div');
  wrap.className = 'free-day-strip';
  const winStart = info.windowStart;
  const winEnd = info.windowEnd;
  if(!(winEnd > winStart))return wrap;

  const span = winEnd - winStart;
  const pieces = [];
  let cursor = winStart;
  const busy = [...(info.busy || [])].sort((a,b)=>a.start - b.start);
  for(const block of busy){
    const start = Math.max(block.start,winStart);
    const end = Math.min(block.end,winEnd);
    if(end <= start)continue;
    if(start > cursor)pieces.push({kind:'free',start:cursor,end:start});
    pieces.push({kind:'busy',start,end});
    cursor = Math.max(cursor,end);
  }
  if(cursor < winEnd)pieces.push({kind:'free',start:cursor,end:winEnd});

  wrap.setAttribute('role',typeof onPick === 'function' ? 'group' : 'img');
  wrap.setAttribute(
    'aria-label',
    `${formatFreeDuration(info.totalFreeMinutes)} open · ${formatFreeDuration(info.largestGapMinutes)} biggest stretch`
  );

  const track = document.createElement('div');
  track.className = 'free-day-track';
  if(!pieces.length){
    const seg = document.createElement('span');
    seg.className = 'free-day-seg free';
    seg.style.flex = '1';
    track.appendChild(seg);
  }else{
    pieces.forEach(piece=>{
      const seg = document.createElement(typeof onPick === 'function' ? 'button' : 'span');
      seg.className = `free-day-seg ${piece.kind}`;
      if(seg.tagName === 'BUTTON')seg.type = 'button';
      seg.style.flex = String(Math.max(1, piece.end - piece.start));
      const mins = Math.round((piece.end - piece.start) / 60000);
      seg.title = `${piece.kind === 'busy' ? 'busy' : 'open'} · ${freeDayClockLabel(piece.start)} – ${freeDayClockLabel(piece.end)} · ${formatFreeDuration(mins)}`;
      if(typeof onPick === 'function'){
        seg.setAttribute('aria-label',`${piece.kind === 'busy' ? 'check busy stretch' : 'select open stretch'}, ${freeDayClockLabel(piece.start)} to ${freeDayClockLabel(piece.end)}`);
        seg.addEventListener('click',()=>onPick(piece.start,piece.end,seg));
      }
      track.appendChild(seg);
    });
  }
  wrap.appendChild(track);

  const ticks = document.createElement('div');
  ticks.className = 'free-day-ticks';
  freeDayTickMarks(winStart,winEnd).forEach(tick=>{
    const mark = document.createElement('span');
    mark.className = 'free-day-tick' + (tick.edge ? ` edge-${tick.edge}` : '');
    mark.style.left = `${((tick.ts - winStart) / span) * 100}%`;
    mark.textContent = freeDayClockLabel(tick.ts);
    ticks.appendChild(mark);
  });
  wrap.appendChild(ticks);

  const legend = document.createElement('div');
  legend.className = 'free-day-legend';
  legend.innerHTML = '<span><i class="busy" aria-hidden="true"></i>busy</span><span><i class="open" aria-hidden="true"></i>open</span>';
  wrap.appendChild(legend);
  return wrap;
}

function attachFreeTimeIndicator(header,day){
  if(typeof computeDayFreeGaps !== 'function')return;
  const info = computeDayFreeGaps(day,sortSettings);
  if(info.totalFreeMinutes < 10)return;
  header.classList.add('has-pill');
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'free-pill';
  pill.textContent = `${formatFreeDuration(info.totalFreeMinutes)} open`;
  bindDayHeaderPill(pill,()=>openFreeTimeSheet(info,header.dataset.label || 'today'));
  header.appendChild(pill);
}

// WIRE: day-header open/missed pills. Activation must be click-based so the
// document forgiving-button path (near-miss drift / pointercancel → btn.click)
// works. pointerup-only missed those taps because capture-phase forgiving
// stopPropagation prevented the pill's pointerup from firing. Stop pointer
// bubbling so sticky-header capacity triple-tap does not count pill presses.
function bindDayHeaderPill(pill,open){
  if(!pill || typeof open !== 'function')return;
  pill.addEventListener('pointerdown',e=>e.stopPropagation());
  pill.addEventListener('pointerup',e=>e.stopPropagation());
  pill.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    open();
  });
}

function freeWindowInputValue(ts){
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function freeWindowTimestamp(info,value){
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if(!match)return null;
  const base = new Date(info.windowStart);
  base.setHours(Number(match[1]),Number(match[2]),0,0);
  return base.getTime();
}

function freeWindowDefault(info){
  const base = new Date(info.windowStart);
  const dayBase = dayStart(base.getTime());
  let start = dayBase + 17 * 3600000;
  if(info.windowStart > start){
    start = Math.ceil(info.windowStart / 1800000) * 1800000;
  }
  start = Math.min(start,dayBase + 22.5 * 3600000);
  return {start,end:Math.min(dayBase + 24 * 3600000 - 60000,start + 90 * 60000)};
}

function freeWindowOverlapMinutes(gaps,start,end){
  return (gaps || []).reduce((sum,gap)=>{
    const overlap = Math.max(0,Math.min(end,gap.end) - Math.max(start,gap.start));
    return sum + Math.round(overlap / 60000);
  },0);
}

function weekFillMinutesForDay(week,dayBase){
  const day = week && Array.isArray(week.days) && week.days.find(item=>item.dayBase === dayBase);
  const minutes = new Map();
  for(const row of day && day.timeline || []){
    if(row.kind !== 'fill' || row.i == null)continue;
    minutes.set(row.i,(minutes.get(row.i) || 0) + Math.max(0,Math.round((row.end - row.start) / 60000)));
  }
  return minutes;
}

function weekPlacementDayForIndex(week,index,exceptDay){
  const days = (week && week.days || []).filter(day=>day.dayBase !== exceptDay && (day.timeline || []).some(row=>row.kind === 'fill' && row.i === index));
  return days.length ? days.sort((a,b)=>a.dayBase - b.dayBase)[0].dayBase : null;
}

function fixedConflictForWindow(dayBase,start,end,settings,baselineDay){
  const blocks = typeof agendaBlockedIntervals === 'function'
    ? agendaBlockedIntervals(dateKey(dayBase),settings,dayBase,dayBase + 86400000)
    : [];
  const fixed = blocks.map(block=>({start:block.start,end:block.end,name:block.label || 'busy time'}));
  for(const row of baselineDay && baselineDay.timeline || []){
    if(row.kind === 'scheduled')fixed.push({start:row.start,end:row.end,name:row.h?.name || row.name || 'fixed plan'});
  }
  return fixed.find(item=>item.start < end && item.end > start) || null;
}

async function analyzeFreeWindow(info,start,end){
  const duration = Math.max(0,Math.round((end - start) / 60000));
  const openMinutes = freeWindowOverlapMinutes(info.gaps,start,end);
  if(openMinutes >= duration){
    return {tone:'open',icon:'check',title:'Already open',copy:`All ${formatFreeDuration(duration)} are available now.`};
  }

  const data = load();
  const settings = sortSettings || loadSortSettings();
  const dayBase = dayStart(info.windowStart);
  let baseline = _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days) ? _homeRenderedWeek : null;
  if(!baseline){
    baseline = typeof buildWeekAgendaOffMain === 'function'
      ? await buildWeekAgendaOffMain(data,settings,7,settings.agendaOptimizer ? 'exact' : 'fast')
      : buildWeekAgenda(data,settings,7);
    if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(baseline,data);
  }
  const baselineDay = baseline.days.find(day=>day.dayBase === dayBase);
  const fixed = fixedConflictForWindow(dayBase,start,end,settings,baselineDay);
  if(fixed){
    return {tone:'blocked',icon:'lock',title:'Not movable as planned',copy:`This overlaps ${fixed.name}, which is fixed on the day.`};
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  const whatIfBlock = {
    label:'time check',
    days:[startDate.getDay()],
    start:startDate.getHours() * 60 + startDate.getMinutes(),
    end:endDate.getHours() * 60 + endDate.getMinutes()
  };
  // Put the temporary reservation first so it is retained even when a user
  // already has the maximum number of recurring busy-time rules.
  const hypotheticalSettings = {...settings,blockedTimes:[whatIfBlock,...normalizeBlockedTimes(settings.blockedTimes)]};
  let hypothetical = typeof buildWeekAgendaOffMain === 'function'
    ? await buildWeekAgendaOffMain(data,hypotheticalSettings,7,settings.agendaOptimizer ? 'exact' : 'fast')
    : buildWeekAgenda(data,hypotheticalSettings,7);
  if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(hypothetical,data);

  const before = weekFillMinutesForDay(baseline,dayBase);
  const after = weekFillMinutesForDay(hypothetical,dayBase);
  const displaced = [...before.entries()].filter(([index,minutes])=>(after.get(index) || 0) < minutes);
  if(!displaced.length){
    const movedNames = [...before.keys()].filter(index=>{
      const oldRows = (baselineDay?.timeline || []).filter(row=>row.kind === 'fill' && row.i === index);
      const nextDay = hypothetical.days.find(day=>day.dayBase === dayBase);
      const newRows = (nextDay?.timeline || []).filter(row=>row.kind === 'fill' && row.i === index);
      return oldRows.some((row,i)=>!newRows[i] || Math.abs(row.start - newRows[i].start) > 60000);
    }).map(index=>data[index]?.name).filter(Boolean).slice(0,2);
    const detail = movedNames.length ? ` It would move ${movedNames.join(' and ')} within the day.` : '';
    return {tone:'possible',icon:'arrows-shuffle',title:'Can be made open',copy:`The planner can keep everything on this day.${detail}`};
  }

  const later = [];
  const unscheduled = [];
  for(const [index] of displaced){
    const destination = weekPlacementDayForIndex(hypothetical,index,dayBase);
    const name = data[index]?.name || 'an item';
    if(destination != null && destination > dayBase)later.push({name,destination});
    else unscheduled.push(name);
  }
  if(later.length){
    const first = later[0];
    const dayLabel = homeWeekDayLabel({dayBase:first.destination,weekday:new Date(first.destination).getDay(),isToday:false,offset:Math.round((first.destination-dayStart(Date.now()))/86400000)}).toLowerCase();
    return {tone:'spill',icon:'arrow-forward-up',title:'Would spill into a later day',copy:`Making this space would move ${first.name}${later.length > 1 ? ` and ${later.length - 1} more` : ''} to ${dayLabel}.`};
  }
  return {tone:'spill',icon:'calendar-off',title:'Doesn’t fit cleanly',copy:`Making this space would push ${unscheduled.slice(0,2).join(' and ') || 'planned work'} out of this day.`};
}

function renderFreeWindowChecker(info){
  const checker = document.createElement('section');
  checker.className = 'free-fit-checker';
  checker.setAttribute('aria-label','check whether a time can be made open');
  const initial = freeWindowDefault(info);
  checker.innerHTML = `
    <button type="button" class="free-fit-toggle" aria-expanded="false" aria-controls="free-fit-body">
      <span class="free-fit-toggle-icon"><i class="ti ti-sparkles" aria-hidden="true"></i></span>
      <span class="free-fit-toggle-copy"><b>Could I make room?</b><small>Test a time without changing anything</small></span>
      <i class="ti ti-chevron-down free-fit-chevron" aria-hidden="true"></i>
    </button>
    <div class="free-fit-body" id="free-fit-body" hidden>
      <div class="free-fit-fields">
        <label><span>from</span><input class="free-fit-start" type="time" step="900" value="${freeWindowInputValue(initial.start)}" /></label>
        <i class="ti ti-arrow-right" aria-hidden="true"></i>
        <label><span>to</span><input class="free-fit-end" type="time" step="900" value="${freeWindowInputValue(initial.end)}" /></label>
        <button type="button" class="free-fit-run">check</button>
      </div>
      <div class="free-fit-result" role="status" aria-live="polite"><i class="ti ti-pointer" aria-hidden="true"></i><span><b>Choose a time</b><small>Or tap a section of the timeline above.</small></span></div>
    </div>`;
  const toggle = checker.querySelector('.free-fit-toggle');
  const body = checker.querySelector('.free-fit-body');
  const startInput = checker.querySelector('.free-fit-start');
  const endInput = checker.querySelector('.free-fit-end');
  const run = checker.querySelector('.free-fit-run');
  const result = checker.querySelector('.free-fit-result');
  const setExpanded = expanded=>{
    checker.classList.toggle('is-expanded',expanded);
    toggle.setAttribute('aria-expanded',String(expanded));
    body.hidden = !expanded;
    const chevron = toggle.querySelector('.free-fit-chevron');
    if(chevron)chevron.className = `ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'} free-fit-chevron`;
  };
  toggle.addEventListener('click',()=>setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
  let request = 0;
  const check = async()=>{
    const start = freeWindowTimestamp(info,startInput.value);
    let end = freeWindowTimestamp(info,endInput.value);
    if(start != null && end != null && end <= start && endInput.value === '00:00')end += 86400000;
    if(start == null || end == null || end <= start){
      result.className = 'free-fit-result blocked';
      result.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i><span><b>Check the times</b><small>The end needs to be after the start.</small></span>';
      return;
    }
    const token = ++request;
    run.disabled = true;
    result.className = 'free-fit-result checking';
    result.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i><span><b>Checking the day…</b><small>Testing a rearranged plan without saving it.</small></span>';
    try{
      const answer = await analyzeFreeWindow(info,start,end);
      if(token !== request)return;
      result.className = `free-fit-result ${answer.tone}`;
      result.innerHTML = `<i class="ti ti-${answer.icon}" aria-hidden="true"></i><span><b>${escapeHtml(answer.title)}</b><small>${escapeHtml(answer.copy)}</small></span>`;
    }catch(_){
      if(token !== request)return;
      result.className = 'free-fit-result blocked';
      result.innerHTML = '<i class="ti ti-alert-circle" aria-hidden="true"></i><span><b>Couldn’t check this window</b><small>Your current open stretches are still shown above.</small></span>';
    }finally{
      if(token === request)run.disabled = false;
    }
  };
  run.addEventListener('click',check);
  [startInput,endInput].forEach(input=>input.addEventListener('change',()=>{ result.className = 'free-fit-result'; result.innerHTML = '<i class="ti ti-arrow-right" aria-hidden="true"></i><span><b>Ready to check</b><small>This won’t change your plan.</small></span>'; }));
  checker.pickWindow = (start,end)=>{
    setExpanded(true);
    startInput.value = freeWindowInputValue(start);
    endInput.value = freeWindowInputValue(end);
    void check();
  };
  return checker;
}

function renderFreePanel(info){
  const panel = document.createElement('div');
  panel.className = 'free-panel';
  const summary = document.createElement('div');
  summary.className = 'free-panel-row free-panel-hero';
  summary.innerHTML = `<span class="free-panel-metric"><small>total room</small><b>${escapeHtml(formatFreeDuration(info.totalFreeMinutes))} open</b></span><span class="free-panel-metric"><small>biggest stretch</small><b>${escapeHtml(formatFreeDuration(info.largestGapMinutes))}</b></span>`;
  panel.appendChild(summary);
  const checker = renderFreeWindowChecker(info);
  panel.appendChild(renderFreeDayStrip(info,(start,end)=>checker.pickWindow(start,end)));
  panel.appendChild(checker);
  const bigGaps = info.gaps.filter(g=>Math.round((g.end - g.start) / 60000) >= 30);
  const shortMinutes = info.totalFreeMinutes - bigGaps.reduce((s,g)=>s + Math.round((g.end - g.start) / 60000),0);
  bigGaps.forEach(g=>{
    const mins = Math.round((g.end - g.start) / 60000);
    const sd = new Date(g.start), ed = new Date(g.end);
    const startLabel = formatTimeShort(sd.getHours() * 60 + sd.getMinutes());
    const endLabel = formatTimeShort(ed.getHours() * 60 + ed.getMinutes());
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'free-panel-row free-gap-row';
    row.innerHTML = `<span class="free-gap-icon"><i class="ti ti-sun" aria-hidden="true"></i></span><span class="free-gap-copy"><b>${escapeHtml(startLabel)} – ${escapeHtml(endLabel)}</b><small>available stretch</small></span><span class="free-panel-value">${escapeHtml(formatFreeDuration(mins))}</span>`;
    row.setAttribute('aria-label',`check ${startLabel} to ${endLabel}, ${formatFreeDuration(mins)} open`);
    row.addEventListener('click',()=>checker.pickWindow(g.start,g.end));
    panel.appendChild(row);
  });
  if(shortMinutes >= 10){
    const note = document.createElement('div');
    note.className = 'free-panel-note';
    note.textContent = `+ ${formatFreeDuration(shortMinutes)} in shorter stretches`;
    panel.appendChild(note);
  }
  return panel;
}

function openFreeTimeSheet(info,dayLabel){
  const content = document.getElementById('free-time-content');
  if(!content)return;
  document.getElementById('free-time-title').textContent = `open time ${dayLabel}`;
  content.innerHTML = '';
  content.appendChild(renderFreePanel(info));
  openSheet('free-time-sheet');
}

// PURE: reduce trail tones to one
function summarizeTrailTone(tones){
  if(!tones.length)return '';
  if(tones.includes('plan'))return 'plan';
  if(tones.includes('miss'))return 'miss';
  if(tones.includes('warn'))return 'warn';
  if(tones.includes('hit'))return 'hit';
  return '';
}

// PURE: whether home should lay out day by day. Minimal mode always falls back
// to the today / overdue / coming up grouping, whatever the toggle says.
function weekOnHomeEnabled(settings){
  const s = settings || sortSettings || {};
  return !s.minimalMode && Boolean(s.showWeekOnHome);
}

// RENDER: render the full habit list.
//
// `opts.deferAgenda` (default false): compatibility path that skips expensive
// agenda work and emits a basic grouped list. Normal home renders reuse a
// same-day plan cache, then refresh either planner in a worker.
function render(opts){
  const o = opts || {};
  const list = $('list');
  const empty = $('empty');
  const data = load();
  if(!sortSettings && typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  const wantsPlannedWeek = !o.deferAgenda
    && !o.__optimizedWeek
    && !o.__optimizerFallback
    && sortSettings.preset === 'todayFirst'
    && weekOnHomeEnabled(sortSettings)
    && !searchQuery.trim()
    && typeof buildWeekAgendaOffMain === 'function';
  if(wantsPlannedWeek){
    queueOptimizedHomeRender(data,o);
    return false;
  }
  const readingPosition = o.preserveReadingPosition === false
    ? null
    : captureHomeReadingPosition(list);
  _homeRenderedWeek = null;
  list.innerHTML = '';
  empty.onclick = null;
  updateQuotaBar(sizeKb(data));
  updateSortButton();
  updateSearchUi();
  renderHomeTagFilter(data);

  const visible = visibleIndices(data);
  const indices = filteredVisibleIndices(data);
  if(!indices.length){
    empty.style.display = 'block';
    if(typeof renderWeekOnHome === 'function')renderWeekOnHome();
    const hasSearch = searchQuery.trim().length > 0;
    const hasTopicFilter = homeTopicFilter && homeTopicFilter !== 'all';
    const hasLocationFilter = homeLocationFilter && homeLocationFilter !== 'all';
    empty.classList.toggle('is-action',data.length > 0 && !sortSettings.showSnoozed && !hasSearch);
    if(hasSearch){
      empty.innerHTML = 'no matches<br><span class="empty-sub">try a habit name, topic, or place</span>';
    }else if(hasTopicFilter || hasLocationFilter){
      const topicLabel = homeTopicFilter === '__none__' ? 'no topic' : homeTopicFilter;
      const loc = typeof locationById === 'function' ? locationById(homeLocationFilter) : null;
      const locLabel = homeLocationFilter === '__none__' ? 'anywhere' : (loc ? loc.name : homeLocationFilter);
      const label = hasTopicFilter && hasLocationFilter
        ? `${topicLabel} · ${locLabel}`
        : (hasTopicFilter ? topicLabel : locLabel);
      empty.innerHTML = `no habits in ${escapeHtml(label)}<br><span class="empty-sub">tap a filter above to change it</span>`;
      empty.onclick = ()=>{
        homeTopicFilter = 'all';
        homeLocationFilter = 'all';
        render();
      };
    }else if(data.length && !sortSettings.showSnoozed && !visible.length && data.some(h=>h.snoozedUntil && Date.now() < h.snoozedUntil)){
      empty.innerHTML = 'hidden for now<br><span class="empty-sub">tap to show</span>';
      empty.onclick = ()=>{
        saveSortSettings({...sortSettings,showSnoozed:true});
        syncSettingsControls();
        render();
      };
    }else if(data.length && !visible.length){
      const doneTasks = data.filter(h=>h.type === 'task' && isTaskDone(h)).length;
      empty.innerHTML = doneTasks && doneTasks === data.length
        ? 'all clear<br><span class="empty-sub">completed tasks stay searchable; use + to add what is next</span>'
        : 'nothing active<br><span class="empty-sub">use Calendar for scheduled items, or + to add a habit</span>';
    }else{
      empty.innerHTML = 'habits, tasks, and planning<br><span class="empty-sub">Saved on this device. Tap Tings for help and settings, + to add, or tap here to try samples.</span>';
      empty.classList.add('is-action');
      empty.onclick = ()=>{
        if(typeof openSampleHabitsSheet === 'function')openSampleHabitsSheet();
        else if(typeof openSheet === 'function')openSheet('about-sheet');
      };
    }
    _homeListFingerprint = homeListFingerprint();
    restoreHomeReadingPosition(readingPosition,list);
    return;
  }
  empty.classList.remove('is-action');
  empty.style.display = 'none';

  const todayFirstActive = sortSettings.preset === 'todayFirst';
  // Search is habit lookup — skip week-plan chrome (blocked times, travel,
  // day sections) so results are just matching habits, ranked by relevance.
  const searching = searchQuery.trim().length > 0;
  const deferAgenda = Boolean(o.deferAgenda);
  const weekMode = !deferAgenda && todayFirstActive
    && weekOnHomeEnabled(sortSettings)
    && !searching
    && typeof buildWeekAgenda === 'function'
    && typeof homeDaySequence === 'function';
  // homeEarlyMap calls earlyReason per item, which in turn may invoke the
  // today agenda pipeline. Defer it on progressive renders — it is only used
  // to surface an "early" pill on cards that pulled forward, and that pill is
  // not part of the first paint.
  const earlyMap = deferAgenda ? new Map() : homeEarlyMap(data,sortSettings);
  const visibleSet = new Set(indices);
  // Earliest today-timeline fill/scheduled row per breakable habit. The slider
  // belongs on that row only — not on later chunks, and not on a pinned/
  // leftover card that happens to render earlier in the DOM.
  const breakablePrimaries = new Map();
  const breakableCatchupShown = new Set();

  const noteBreakablePrimary = (realIdx,row)=>{
    if(realIdx == null || !row || !data[realIdx]?.breakable)return;
    const prev = breakablePrimaries.get(realIdx);
    if(!prev){
      breakablePrimaries.set(realIdx,row);
      return;
    }
    if(Number.isFinite(row.start) && Number.isFinite(prev.start) && row.start < prev.start){
      breakablePrimaries.set(realIdx,row);
    }
  };

  const isBreakableSliderRow = (realIdx,agendaRow)=>{
    const h = data[realIdx];
    if(!h || !h.breakable)return false;
    const primary = breakablePrimaries.get(realIdx);
    if(primary){
      if(!agendaRow)return false;
      // Start time uniquely identifies the today timeline instance (chunkIndex
      // alone collides across week days — every day can have chunkIndex 0).
      if(Number.isFinite(primary.start) && Number.isFinite(agendaRow.start)){
        return primary.start === agendaRow.start;
      }
      if(primary.chunkIndex != null && agendaRow.chunkIndex != null){
        return primary.chunkIndex === agendaRow.chunkIndex;
      }
      return primary === agendaRow;
    }
    // No today timeline placement (progressive paint, unplaced leftover, or
    // only later-day chunks because today is already full): allow one catch-up
    // slider on the first card we render for this habit.
    if(breakableCatchupShown.has(realIdx))return false;
    breakableCatchupShown.add(realIdx);
    return true;
  };

  const appendHabitCard = (realIdx,agendaRow,earlyReasonText,dayBase = null,scheduleLinkReason = '')=>{
    const h = data[realIdx];
    const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const cardScore = progressScore(h);
    const cardScoreTone = cardTone(h);
    const cue = cardCue(h);
    const agendaPill = minimal ? '' : agendaCardPill(agendaRow,h);
    const earlyPill = earlyCardPill(earlyReasonText || '');
    const showOrderPills = sortSettings.showOrderPillsOnCards !== false;
    const orderPill = (!minimal && showOrderPills && dayBase != null && typeof orderLinkPillHtml === 'function')
      ? orderLinkPillHtml(h.hid,dayBase,data)
      : '';
    const nowPill = (!minimal && showOrderPills && typeof doingNowPillHtml === 'function') ? doingNowPillHtml(h) : '';
    const scheduleLinkPill = (!minimal && showOrderPills && scheduleLinkReason)
      ? `<span class="context-pill schedule-link-blocked-pill" title="${escapeHtml(scheduleLinkReason)}"><i class="ti ti-link-off" aria-hidden="true"></i>linked</span>`
      : '';
    const accent = visualClassColor(cardScoreTone);
    const statusPill = (!minimal && sortSettings.showStatusOnCards) ? cardStatusPill(cardScore,cardScoreTone,cue,accent) : '';
    const gatedEarlyPill = (!minimal && sortSettings.showEarlyOnCards) ? earlyPill : '';
    const agendaTimeHidden = agendaPill === '';
    const context = minimal
      ? cardMeta(h,{forceRepetition:true,minimalOnly:true})
      : cardMeta(h,{extraPills:[statusPill,gatedEarlyPill,orderPill,nowPill,scheduleLinkPill].filter(Boolean).join(''),suppressScheduled: agendaRow?.kind === 'scheduled' && !agendaTimeHidden});
    const trail = cardTrail(h);
    const showTrail = !minimal && sortSettings.showTrailOnCards !== false;
    const showBreakableSlider = !minimal && isBreakableSliderRow(realIdx,agendaRow);
    const timerRunning = !minimal && typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === realIdx;
    // Timer bar always shows while running — even on breakable crown cards —
    // so the user can see the session without opening detail.
    const sessionHtml = (timerRunning || !showBreakableSlider) ? (minimal ? '' : cardSessionProgress(h,realIdx)) : '';
    const visualHtml = minimal ? '' : (showBreakableSlider
      ? `${cardBreakableSlider(h)}${sessionHtml}`
      : (sessionHtml || (showTrail ? `<div class="ting-trail">${trail}</div>` : '')));
    const visualAria = showBreakableSlider || sessionHtml ? '' : ' aria-hidden="true"';
    const isDoneTask = h.type === 'task' && isTaskDone(h);
    const canTimer = typeof habitTimerEligible === 'function'
      ? habitTimerEligible(h)
      : (h.type !== 'zero' && !(h.type === 'task' && isTaskDone(h)));
    const timerAction = (!minimal && (canTimer || timerRunning))
      ? (timerRunning
        ? `<button class="swipe-action sa-timer" data-action="timer" aria-label="stop session"><i class="ti ti-player-stop" aria-hidden="true"></i>stop</button>`
        : `<button class="swipe-action sa-timer" data-action="timer" aria-label="start session"><i class="ti ti-player-play" aria-hidden="true"></i>session</button>`)
      : '';
    const snoozeAction = minimal ? '' : `<button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>`;
    const pinAction = minimal ? '' : `<button class="swipe-action sa-pin" data-action="pin" aria-label="${h.pinned ? 'unpin' : 'pin'}"><i class="ti ${h.pinned ? 'ti-pinned-off' : 'ti-pin'}" aria-hidden="true"></i>${h.pinned ? 'unpin' : 'pin'}</button>`;
    const keepAction = h.sample
      ? `<button class="swipe-action sa-keep" data-action="keep" aria-label="keep sample"><i class="ti ti-check" aria-hidden="true"></i>keep</button>`
      : '';
    const activityAction = minimal ? '' : `<button class="swipe-action sa-activity" data-action="activity" aria-label="activity"><i class="ti ti-history" aria-hidden="true"></i>activity</button>`;
    const canDrag = !minimal && dayBase != null && typeof isAgendaFillDraggable === 'function' && isAgendaFillDraggable(h,agendaRow);
    const dragHandle = canDrag
      ? `<button type="button" class="agenda-drag-handle" aria-label="drag to reorder" title="drag to reorder"><i class="ti ti-grip-vertical" aria-hidden="true"></i></button>`
      : '';

    const row = document.createElement('div');
    row.className = 'swipe-row' + (canDrag ? ' has-agenda-drag' : '');
    row.dataset.realIdx = realIdx;
    if(dayBase != null)row.dataset.dayBase = String(dayBase);
    if(agendaRow && Number.isFinite(agendaRow.start)){
      row.dataset.agendaStart = String(Math.round(agendaRow.start / 60000));
    }
    if(canDrag)row.dataset.agendaDraggable = '1';
    if(h.hid)row.dataset.hid = h.hid;
    if(agendaRow && Number.isFinite(agendaRow.chunkMinutes)){
      row.dataset.chunkMinutes = String(Math.round(agendaRow.chunkMinutes));
    }
    if(showBreakableSlider){
      const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0;
      row.dataset.progressTarget = String(done);
      row.dataset.progressDirty = '0';
    }
    const isBreakable = showBreakableSlider;
    // Session grid class only when the bar owns the visual row (non-breakable).
    // Breakable stacks the timer bar under the crown inside the same visual.
    const hasSession = Boolean(sessionHtml) && !isBreakable;
    row.innerHTML = `
      <div class="swipe-actions swipe-actions-left">
        ${pinAction}
        ${keepAction}
        ${activityAction}
        ${timerAction}
      </div>
      <div class="swipe-actions swipe-actions-right">
        ${snoozeAction}
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>remove</button>
      </div>
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}${isDoneTask?' is-done':''}${isBreakable?' breakable-card':''}${hasSession?' session-card':''}${timerRunning?' timer-running':''}${minimal?' minimal-card':''}" data-real="${realIdx}" style="--card-accent:${accent};--card-priority:${priorityColor(effectivePriority(h))};">
        ${dragHandle}
        <button class="pulse-btn ${h.emoji ? 'emoji-pulse' : ''}${normalizeEmojiBgColor(h.emojiBgColor) ? ' has-emoji-bg' : ''}" data-pulse="${realIdx}" aria-label="${h.type === 'task' ? 'complete' : 'log'} ${escapeHtml(h.name)}" data-log-label="${h.type === 'task' ? 'done' : 'log'}" style="${typeof emojiBgInlineStyle === 'function' ? emojiBgInlineStyle(h,c.bg,c.icon) : `background:${c.bg};color:${c.icon};`}">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info${isBreakable ? ' has-breakable-progress' : ''}${hasSession ? ' has-session-progress' : ''}${minimal || visualHtml ? '' : ' no-trail'}">
          <div class="ting-main">
            <span class="ting-name">${escapeHtml(h.name)}</span>
            ${agendaPill}
          </div>
          ${(!minimal && isBreakable) ? ((orderPill || nowPill) ? `<div class="ting-meta" aria-label="order">${nowPill}${orderPill}</div>` : '') : `${sortSettings.showCueOnCards !== false ? `<div class="ting-cue">${escapeHtml(cue)}</div>` : ''}
          <div class="ting-meta" aria-label="rhythm and plan">${context}</div>`}
          ${minimal || !visualHtml ? '' : `<div class="ting-visual"${visualAria}>
            ${visualHtml}
          </div>`}
        </div>
        ${minimal || isBreakable ? '' : `<div class="card-actions" aria-label="habit actions">
          <button class="card-action-btn" data-action="activity" aria-label="activity" title="activity"><i class="ti ti-history" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="snooze" aria-label="snooze" title="snooze"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="nuke" aria-label="remove" title="remove"><i class="ti ti-trash" aria-hidden="true"></i></button>
        </div>`}
      </div>`;

    list.appendChild(row);
    setupSwipe(row);
    setupCardTap(row,realIdx);
    if(showBreakableSlider)setupBreakableCrown(row,realIdx);
    if(canDrag && typeof setupAgendaDragHandle === 'function')setupAgendaDragHandle(row,realIdx,dayBase);
  };

  if(deferAgenda){
    // IMMEDIATE FIRST PAINT — no planner work, homeAgendaRows, or homeEarlyMap.
    // A same-day plan cache normally avoids this compatibility list; it exists
    // for the first launch after install or after a placement-changing edit.
    list.classList.remove('is-progressive');
    const labels = {0:'today',1:'overdue',2:'coming up',3:'the rest'};
    const fastOrder = todayFirstActive && !searching
      ? [...indices].sort((a,b)=>{
        const pa = Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned));
        if(pa)return pa;
        const ca = todayCategory(data[a],sortSettings);
        const cb = todayCategory(data[b],sortSettings);
        if(ca !== cb)return ca - cb;
        return indices.indexOf(a) - indices.indexOf(b);
      })
      : [...indices].sort((a,b)=>Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned)) || indices.indexOf(a) - indices.indexOf(b));
    let fastCat = -1;
    let fastHeaderForPinned = false;
    fastOrder.forEach(realIdx=>{
      const h = data[realIdx];
      if(h.pinned){
        if(!fastHeaderForPinned){ appendSectionHeader(list,'pinned'); fastHeaderForPinned = true; }
        appendHabitCard(realIdx,null,'');
        return;
      }
      if(todayFirstActive && !searching){
        const cat = todayCategory(h,sortSettings);
        if(cat !== fastCat){
          const label = labels[cat];
          if(label)appendSectionHeader(list,label);
          fastCat = cat;
        }
      }
      appendHabitCard(realIdx,null,'');
    });
  }else{
    list.classList.remove('is-progressive');
    if(weekMode){
    const week = (o.__optimizedWeek && o.__optimizedWeek.days)
      ? o.__optimizedWeek
      : buildWeekAgenda(data,sortSettings,7);
    _homeRenderedWeek = week;
    if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(data,week);
    const agendaMap = new Map();
    const weekAssigned = new Set();
    const scheduleOmissionByHid = new Map();
    const dayPlans = week.days.map(day=>{
      for(const omission of day.linkOmissions || []){
        if(omission && omission.subjectHid && !scheduleOmissionByHid.has(omission.subjectHid)){
          scheduleOmissionByHid.set(omission.subjectHid,omission.reason || 'linked placement could not be honored');
        }
      }
      const seq = homeDaySequence(day,sortSettings,{visibleSet});
      // Preserve the exact rows shown on Home for audit/export. Placement maps
      // below still consume only indexed fills/scheduled rows, while travel
      // remains visible in HOME AGENDA OUTPUT.
      day.homeDisplayedTimeline = seq.filter(row=>row.kind === 'travel'
        || ((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null));
      for(const row of seq){
        if((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null){
          weekAssigned.add(row.i);
          if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
          if(day.isToday)noteBreakablePrimary(row.i,row);
        }
      }
      return {day,seq};
    });

    const pinnedIndices = indices.filter(i=>data[i].pinned);
    if(pinnedIndices.length)appendSectionHeader(list,'pinned');
    pinnedIndices.forEach(realIdx=>{
      const agendaRow = agendaMap.get(realIdx);
      const cat = todayCategory(data[realIdx],sortSettings);
      const earlyText = (cat === 2 && earlyMap.get(realIdx) && agendaMap.has(realIdx)) ? earlyMap.get(realIdx) : '';
      appendHabitCard(realIdx,agendaRow,earlyText);
    });

    const weekTodayHids = (()=>{
      const todayPlan = dayPlans.find(p=>p.day.isToday);
      if(!todayPlan)return [];
      return todayPlan.seq
        .filter(row=>(row.kind === 'fill' || row.kind === 'scheduled') && row.i != null && !data[row.i]?.pinned)
        .map(row=>data[row.i]?.hid)
        .filter(Boolean);
    })();

    dayPlans.forEach(({day,seq})=>{
      if(!seq.length)return;
      appendSectionHeader(list,homeWeekDayLabel(day),day,day.isToday ? weekTodayHids : null);
      for(let i = 0;i < seq.length;){
        const row = seq[i];
        if(row.kind === 'travel'){
          if(homeExtraRowVisible(row.start))appendHomeExtraTravel(list,row.from,row.to,row.start);
          i += 1;
          continue;
        }
        if(row.kind === 'blocked'){
          const {blocks,nextIdx} = consumeBlockedRun(seq,i);
          if(homeExtraRowVisible(blocks[0].start)){
            if(homeExtraMode() === 'text12h'){
              blocks.forEach(b=>appendHomeBlockedText(list,b));
            }else{
              const groupKey = `${day.dayKey}:${blocks[0].start}:${blocks.length}:${blocks.map(b=>b.label||'').join('|')}`;
              appendHomeBlockedGroup(list,blocks,groupKey);
            }
          }
          i = nextIdx;
          continue;
        }
        i += 1;
        if(row.kind !== 'fill' && row.kind !== 'scheduled')continue;
        // Pinned cards also render here — in their natural time slot — so the
        // travel/blocked cards around them keep their context. They still
        // appear in the separate pinned section above via the pre-pass.
        const cat = todayCategory(data[row.i],sortSettings);
        const earlyText = (day.isToday && cat === 2 && earlyMap.get(row.i)) ? earlyMap.get(row.i) : '';
        appendHabitCard(row.i,row,earlyText,day.dayBase);
      }
    });

    // Timed-only day sections: anything without a suggested time goes to
    // overdue / upcoming — never as an untimed card under a day.
    const leftoverKey = (h)=>{
      const cat = todayCategory(h,sortSettings);
      if(cat === 3)return 3;
      if(cat === 1 || cat === 0)return 1; // due/overdue that didn't place
      return 2;
    };
    const leftovers = indices
      .filter(i=>!data[i].pinned && !weekAssigned.has(i))
      .sort((a,b)=>leftoverKey(data[a]) - leftoverKey(data[b]) || indices.indexOf(a) - indices.indexOf(b));
    let leftoverCat = -1;
    leftovers.forEach(realIdx=>{
      const key = leftoverKey(data[realIdx]);
      if(key !== leftoverCat){
        const labels = {1:'overdue',2:'coming up',3:'the rest'};
        const label = labels[key];
        if(label)appendSectionHeader(list,label);
        leftoverCat = key;
      }
      appendHabitCard(realIdx,null,'',null,scheduleOmissionByHid.get(data[realIdx]?.hid) || '');
    });
  }else{
    const agendaRows = homeAgendaRows(data);
    if(typeof syncAutoMarkChunkPlans === 'function'){
      syncAutoMarkChunkPlans(data,{days:[{dayBase:dayStart(Date.now()),timeline:agendaRows}]});
    }
    const agendaMap = new Map();
    const agendaOrder = new Map();
    const chunksByIndex = new Map();
    agendaRows.forEach((row,pos)=>{
      if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
      if(!agendaOrder.has(row.i))agendaOrder.set(row.i,pos);
      if(!chunksByIndex.has(row.i))chunksByIndex.set(row.i,[]);
      chunksByIndex.get(row.i).push(row);
      noteBreakablePrimary(row.i,row);
    });
    // An upcoming item is pulled into "today" only when it BOTH passes the
    // do-early gate (allowed today + flexibility + its target day is over-loaded)
    // AND earns an agenda row today. If it loses its slot to capacity it falls
    // back to its original "upcoming" section, so the list never promises time
    // the day cannot give and the card never shows an "early" pill it can't honour.
    const earlyToday = i => Boolean(earlyMap.get(i)) && agendaMap.has(i);
    const renderIndices = todayFirstActive && !searching ? [...indices].sort((a,b)=>{
      // Pinned cards are NOT sorted to the top here — they render in their
      // natural time/category position so the timeline stays time-ordered.
      // A separate pinned-section pre-pass below mirrors week view.
      const catA = todayCategory(data[a],sortSettings);
      const catB = todayCategory(data[b],sortSettings);
      const dispA = (catA === 0 || (catA === 2 && earlyToday(a))) ? 0 : catA;
      const dispB = (catB === 0 || (catB === 2 && earlyToday(b))) ? 0 : catB;
      if(dispA !== dispB)return dispA - dispB;
      if(dispA === 0){
        const posA = agendaOrder.get(a), posB = agendaOrder.get(b);
        if(posA != null || posB != null){
          if(posA == null)return 1;
          if(posB == null)return -1;
          return posA - posB;
        }
      }
      return indices.indexOf(a) - indices.indexOf(b);
    }) : indices;
    let sectionCat = -1;
    let prevTodayLocId = null;

    // Precompute: should today's first location-bearing item be preceded by a
    // synthetic "from current location" leg? Mirrors what homeDaySequence
    // inserts at the top of today for the week branch — when the user has a
    // live GPS fix that isn't inside any saved location, the regular seed
    // (currentLocationId → nearest saved) would mis-anchor the first leg.
    // Returning CURRENT_COORD_ID here lets the existing prevTodayLocId check
    // render the leg via appendHomeExtraTravel (which routes the synthetic id
    // through travelFromCurrent's movement-thresholded cache).
    let currentCoordSeed = null;
    if(todayFirstActive && !searching
      && typeof currentCoordLocation === 'function'
      && typeof isCurrentCoordAwayFromSaved === 'function'
      && typeof CURRENT_COORD_ID !== 'undefined'
      && typeof CURRENT_COORD_TRAVEL_CARD_MIN_METRES !== 'undefined'){
      const here = currentCoordLocation();
      if(here && isCurrentCoordAwayFromSaved()){
        const registry = locationOptions();
        for(const seedIdx of renderIndices){
          const sh = data[seedIdx];
          if(!sh)continue;
          const scat = todayCategory(sh,sortSettings);
          const sEarly = scat === 2 && earlyToday(seedIdx);
          if(scat !== 0 && !sEarly)continue;
          const sRow = agendaMap.get(seedIdx);
          const sLoc = cardLocationId(sh,sRow);
          if(!sLoc)continue;
          const sTo = locationById(sLoc,registry);
          if(!sTo)continue;
          if(haversineMetres(here.lat,here.lng,sTo.lat,sTo.lng) >= CURRENT_COORD_TRAVEL_CARD_MIN_METRES){
            currentCoordSeed = CURRENT_COORD_ID;
          }
          break; // first location-bearing today item decides; stop scanning
        }
      }
    }

    const todayHids = (!searching && todayFirstActive)
      ? renderIndices.filter(i=>{
          const h = data[i];
          if(h.pinned)return false;
          const cat = todayCategory(h,sortSettings);
          return cat === 0 || (cat === 2 && earlyToday(i));
        }).map(i=>data[i].hid).filter(Boolean)
      : [];

    // Pinned-section pre-pass: pinned cards render up here (separate section,
    // mirrors week view) AND again below in their natural timeline slot so
    // travel/blocked cards around them keep their context.
    const pinnedTodayIndices = renderIndices.filter(i=>data[i].pinned);
    if(pinnedTodayIndices.length){
      appendSectionHeader(list,'pinned');
      pinnedTodayIndices.forEach(realIdx=>{
        const agendaRow = agendaMap.get(realIdx);
        const cat = todayCategory(data[realIdx],sortSettings);
        const earlyText = (cat === 2 && earlyMap.get(realIdx) && agendaMap.has(realIdx)) ? earlyMap.get(realIdx) : '';
        appendHabitCard(realIdx,agendaRow,earlyText);
      });
    }

    renderIndices.forEach(realIdx=>{
      const h = data[realIdx];
      const cat = todayFirstActive ? todayCategory(h,sortSettings) : -1;
      const isEarlyToday = todayFirstActive && cat === 2 && earlyToday(realIdx);
      const inTodaySection = !searching && todayFirstActive && (cat === 0 || isEarlyToday);

      if(!searching && todayFirstActive){
        const sectionKey = isEarlyToday ? 0 : cat;
        if(sectionKey !== sectionCat){
          const labels = {0:'today',1:'overdue',2:'coming up',3:'the rest'};
          const label = labels[sectionKey];
          const dayCtx = label === 'today'
            ? {dayBase:dayStart(Date.now()),isToday:true,dayKey:todayIso(),timeline:agendaRows}
            : null;
          if(label)appendSectionHeader(list,label,dayCtx,label === 'today' ? todayHids : null);
          sectionCat = sectionKey;
          if(sectionKey !== 0)prevTodayLocId = null;
        }
      }

      // Breakable tasks placed in the today section expand to one card per
      // chunk so each time block is visible on the timeline.
      if(inTodaySection){
        const chunkRows = chunksByIndex.get(realIdx);
        if(chunkRows && chunkRows.length > 1){
          if(prevTodayLocId === null && currentCoordSeed)prevTodayLocId = currentCoordSeed;
          chunkRows.forEach((chunkRow,ci)=>{
            const cLocId = cardLocationId(h,chunkRow);
            if(prevTodayLocId && cLocId && prevTodayLocId !== cLocId){
              const travelTs = homeTravelLeaveByMs(prevTodayLocId,cLocId,chunkRow.start);
              if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,cLocId,travelTs);
            }
            prevTodayLocId = cLocId || prevTodayLocId;
            const earlyText = (cat === 2 && earlyMap.get(realIdx)) ? earlyMap.get(realIdx) : '';
            appendHabitCard(realIdx,chunkRow,ci === 0 ? earlyText : '',dayStart(Date.now()));
          });
          return;
        }
      }

      const agendaRow = agendaMap.get(realIdx);
      const locId = cardLocationId(h,agendaRow);
      if(inTodaySection && prevTodayLocId === null && currentCoordSeed && locId){
        prevTodayLocId = currentCoordSeed;
      }
      if(inTodaySection && prevTodayLocId && locId && prevTodayLocId !== locId){
        const travelTs = homeTravelLeaveByMs(
          prevTodayLocId,
          locId,
          agendaRow && Number.isFinite(agendaRow.start) ? agendaRow.start : NaN
        );
        if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,locId,travelTs);
      }
      if(inTodaySection)prevTodayLocId = locId || prevTodayLocId;

      appendHabitCard(
        realIdx,
        agendaRow,
        (!searching && cat === 2 && earlyToday(realIdx)) ? earlyMap.get(realIdx) : '',
        inTodaySection ? dayStart(Date.now()) : null
      );
    });
    if(!searching && todayFirstActive && sectionCat !== 0){
      const minimal = typeof isMinimalMode === 'function' ? isMinimalMode() : Boolean(sortSettings?.minimalMode);
      if(!minimal){
        const _snap = loadTodaySuggested();
        if(!_droppedDayBaseline && _snap.prevProjection){
          _droppedDayBaseline = _snap.prevProjection;
          _droppedDayBaselineDay = todayIso();
        }
        if(Object.keys(_snap.hids).length > 0 || _droppedDayBaseline){
          const header = document.createElement('div');
          header.className = 'section-header';
          header.dataset.label = 'today';
          header.textContent = 'today';
          setupDayCapacityHeader(header,dayStart(Date.now()),false);
          attachFreeTimeIndicator(header,{dayBase:dayStart(Date.now()),isToday:true,dayKey:todayIso(),timeline:agendaRows});
          attachDroppedIndicator(header,list,todayHids);
          if(header.classList.contains('has-dropped') || header.classList.contains('has-pill'))list.prepend(header);
        }
      }
    }
  }
  } // end of the `else` (non-deferred) branch

  list.querySelectorAll('[data-pulse]').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      if(swipeOpenCard){
        e.preventDefault();
        closeAllSwipes();
        return;
      }
      const idx = +btn.dataset.pulse;
      const card = btn.closest('.ting-card');
      handleCardActivate(idx,card,()=>quickLog(idx,card));
    });
  });

  list.querySelectorAll('.swipe-action').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      closeAllSwipes();
      if(btn.dataset.action === 'pin')togglePin(idx);
      if(btn.dataset.action === 'keep'){
        if(typeof keepSampleHabit === 'function')keepSampleHabit(idx);
      }
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
      if(btn.dataset.action === 'timer'){
        if(typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === idx){
          if(typeof stopHabitTimer === 'function')stopHabitTimer(true,true);
        }else if(typeof startHabitTimer === 'function'){
          startHabitTimer(idx);
        }
      }
    });
  });
  list.querySelectorAll('.card-action-btn').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      const idx = +btn.closest('.swipe-row').dataset.realIdx;
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
    });
  });
  if(typeof renderWeekOnHome === 'function')renderWeekOnHome();
  _homeListFingerprint = homeListFingerprint();
  restoreHomeReadingPosition(readingPosition,list);
  return true;
}

// PURE: lightweight freshness key for the home list. Used to skip background
// re-renders when nothing that affects order/pills/travel has changed — avoids
// wiping #list (and the visual jitter that causes) on GPS ticks, travel-cache
// writes that didn't move numbers, and the while-open refresh loop.
function homeListFingerprint(now = Date.now()){
  const data = typeof load === 'function' ? load() : [];
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  // Live-coord freshness — only changes when the user has crossed a coarse
  // ~100m bucket or the current-coord travel cache updated (e.g., an OSRM
  // result refined a haversine floor). Skips renders for sub-bucket GPS
  // jitter so the list doesn't thrash on every watch tick.
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const habitSig = data.map(h=>[
    h.name, h.type, h.lastLog, h.dueDate, h.eventTime,
    h.pinned ? 1 : 0, h.snoozedUntil || '',
    (h.locationIds || []).join(','),
    h.durationMinutes, h.priority, h.flexibilityDays,
    h.breakable ? 1 : 0,
    h.minChunkMinutes || '',
    typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0,
    h.allowedTimeStart, h.allowedTimeEnd,
    h.allowedTimeStartAnchor || '', h.allowedTimeStartOffsetMin || 0,
    h.allowedTimeEndAnchor || '', h.allowedTimeEndOffsetMin || 0,
    (h.allowedWeekdays || []).join(','),
    (h.preferredWeekdays || []).join(',')
  ].join('~')).join(';');
  return [
    Math.floor(now / 60000),
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    s.preset || '',
    weekOnHomeEnabled(s) ? 1 : 0,
    s.agendaOptimizer ? 1 : 0,
    s.showSnoozed ? 1 : 0,
    typeof searchQuery === 'string' ? searchQuery : '',
    typeof homeTopicFilter === 'string' ? homeTopicFilter : '',
    typeof homeLocationFilter === 'string' ? homeLocationFilter : '',
    travelSig,
    coordSig,
    currentEdgeSig,
    habitSig,
    (typeof habitTimer !== 'undefined' && habitTimer) ? `timer:${habitTimer.idx}:${habitTimer.startedAt}` : '',
    JSON.stringify(s.cancelledBlocks || {}),
    JSON.stringify(s.blockedTimeOverrides || {}),
    JSON.stringify(s.availabilityOverrides || {}),
    JSON.stringify(s.availabilityMinutes || []),
    JSON.stringify(s.blockedTimes || []),
    s.prayerMethod || '', s.prayerMadhab || ''
  ].join('\n');
}

let _homeListFingerprint = '';
let _homeRenderedWeek = null;
let _fastHomeRefreshToken = 0;
let _optimizerHomeRequestKey = '';
let _optimizerHomeRequestToken = 0;
let _optimizerHomeReadyKey = '';
let _optimizerHomeReadyWeek = null;
let _optimizerHomeReadyDirtyKey = '';
let _idlePlannerRefreshTimer = null;
let _homeEarlyMapCache = {key:'',map:null};

// PURE: the visible scheduling result, without solver bookkeeping. Comparing
// this after a background solve lets the current DOM stay mounted when GLPK
// returns the same days, order, and times as the plan already on screen.
function homeAgendaPlanSignature(week,data = (typeof load === 'function' ? load() : [])){
  if(!week || !Array.isArray(week.days))return '';
  return week.days.map(day=>{
    const rows = Array.isArray(day.timeline) ? day.timeline : [];
    const rowSig = rows.map(row=>{
      const h = row && row.i != null ? data[row.i] : null;
      return [
        row && row.kind || '',
        h && h.hid || '',
        Number.isFinite(Number(row && row.start)) ? Math.round(Number(row.start) / 60000) : '',
        Number.isFinite(Number(row && row.end)) ? Math.round(Number(row.end) / 60000) : '',
        row && row.from || '',
        row && row.to || '',
        row && row.locationId || '',
        row && row.label || '',
        row && row.chunkMinutes != null ? Math.round(Number(row.chunkMinutes) || 0) : ''
      ].join('~');
    }).join(';');
    return `${day.dayKey || dateKey(day.dayBase)}:${rowSig}`;
  }).join('\n');
}

function homeReadingScrollHost(list){
  if(!list)return null;
  const pane = list.closest('.pane-list');
  return pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : null;
}

function homeReadingElementKey(el){
  if(!el)return '';
  if(el.classList.contains('swipe-row')){
    return `row:${el.dataset.hid || el.dataset.realIdx || ''}:${el.dataset.dayBase || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.classList.contains('section-header')){
    return `section:${el.dataset.capacityDay || el.dataset.label || ''}`;
  }
  if(el.classList.contains('travel-card') || el.classList.contains('travel-text')){
    return `travel:${el.dataset.travelFrom || ''}:${el.dataset.travelTo || ''}:${el.dataset.agendaStart || ''}`;
  }
  if(el.dataset && el.dataset.blockedGroup)return `blocked:${el.dataset.blockedGroup}`;
  return '';
}

// READ: remember the item the user is currently reading and its viewport
// offset. The raw scroll position is retained as a fallback if that item is
// legitimately removed by the new plan.
function captureHomeReadingPosition(list){
  if(!list || !list.children.length)return null;
  const host = homeReadingScrollHost(list);
  const scrollTop = host ? host.scrollTop : window.scrollY;
  if(scrollTop <= 1)return null;
  const hostRect = host ? host.getBoundingClientRect() : {top:0,bottom:window.innerHeight};
  const top = Math.max(0,hostRect.top);
  const bottom = Math.min(window.innerHeight,hostRect.bottom);
  const candidates = Array.from(list.children);
  const anchor = candidates.find(el=>{
    const rect = el.getBoundingClientRect();
    return rect.bottom > top + 1 && rect.top < bottom;
  });
  if(!anchor)return {host,scrollTop,key:'',offset:0};
  return {
    host,
    scrollTop,
    key:homeReadingElementKey(anchor),
    hid:anchor.dataset && anchor.dataset.hid || '',
    dayKey:anchor.dataset && (anchor.dataset.capacityDay || (anchor.dataset.dayBase ? dateKey(Number(anchor.dataset.dayBase)) : '')) || '',
    offset:anchor.getBoundingClientRect().top - top
  };
}

// WRITE: put the same semantic row back under the user's eyes after a genuine
// plan change. This prevents a background refresh from jumping them to the top
// or losing tomorrow while still allowing rows to move when the plan changed.
function restoreHomeReadingPosition(snapshot,list){
  if(!snapshot || !list)return;
  const host = homeReadingScrollHost(list);
  const top = Math.max(0,host ? host.getBoundingClientRect().top : 0);
  const children = Array.from(list.children);
  let anchor = snapshot.key
    ? children.find(el=>homeReadingElementKey(el) === snapshot.key)
    : null;
  if(!anchor && snapshot.hid){
    anchor = children.find(el=>el.dataset && el.dataset.hid === snapshot.hid);
  }
  if(!anchor && snapshot.dayKey){
    anchor = children.find(el=>el.dataset && (
      el.dataset.capacityDay === snapshot.dayKey
      || (el.dataset.dayBase && dateKey(Number(el.dataset.dayBase)) === snapshot.dayKey)
    ));
  }
  if(anchor){
    const delta = anchor.getBoundingClientRect().top - top - snapshot.offset;
    if(Math.abs(delta) > 0.5){
      if(host)host.scrollTop += delta;
      else window.scrollBy({top:delta,left:0,behavior:'instant'});
    }
    return;
  }
  if(host)host.scrollTop = Math.min(snapshot.scrollTop,Math.max(0,host.scrollHeight - host.clientHeight));
  else window.scrollTo({
    top:Math.min(snapshot.scrollTop,Math.max(0,document.documentElement.scrollHeight - window.innerHeight)),
    left:0,
    behavior:'instant'
  });
}

const HOME_PLANNER_ALGORITHM_VERSION = 3;

// PURE: planner dirty signature without the wall-clock minute bucket. Background
// refreshes use this so a clock tick alone cannot force a full worker replan.
function homePlannerDirtyKey(data = (typeof load === 'function' ? load() : [])){
  const s = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const loc = typeof currentLocationId === 'function' ? currentLocationId() : null;
  const travel = s.travel || {};
  const travelSig = Object.keys(travel).sort().map(k=>{
    const e = travel[k] || {};
    return `${k}:${e.seconds || 0}:${e.provider || ''}`;
  }).join('|');
  const coord = typeof currentCoordLocation === 'function' ? currentCoordLocation() : null;
  const coordSig = coord
    ? `${Math.round(coord.lat * 1000)},${Math.round(coord.lng * 1000)}`
    : '';
  const currentEdgeSig = typeof currentCoordEdgeSignature === 'function' ? currentCoordEdgeSignature() : '';
  const rev = typeof plannerDataRevision === 'function' ? plannerDataRevision() : 0;
  // Planner-relevant settings only — presentation (minimalMode, homeExtraMode,
  // showScheduledTasksInAgenda, showStatusOnCards, …) omitted.
  const settingsSig = JSON.stringify({
    agendaOptimizer:Boolean(s.agendaOptimizer),
    showWeekOnHome:Boolean(s.showWeekOnHome),
    // Candidate gates (isWeekCandidate) — toggles must invalidate the plan.
    showDueTasksInAgenda:s.showDueTasksInAgenda !== false,
    showPlannedItemsInAgenda:s.showPlannedItemsInAgenda !== false,
    showDueHabitsInAgenda:s.showDueHabitsInAgenda !== false,
    availabilityMinutes:s.availabilityMinutes || [],
    availabilityOverrides:s.availabilityOverrides || {},
    blockedTimes:s.blockedTimes || [],
    cancelledBlocks:s.cancelledBlocks || {},
    blockedTimeOverrides:s.blockedTimeOverrides || {},
    agendaScoreWeights:s.agendaScoreWeights || null,
    prayerMethod:s.prayerMethod || '',
    prayerMadhab:s.prayerMadhab || '',
    // Prayer/location windows resolve from home city coords.
    homeCityLat:Number.isFinite(s.homeCityLat) ? s.homeCityLat : null,
    homeCityLng:Number.isFinite(s.homeCityLng) ? s.homeCityLng : null,
    focus:s.focus || '',
    defaultTravelMode:s.defaultTravelMode || '',
    locations:(s.locations || []).map(l=>`${l.id}:${l.lat}:${l.lng}`).join('|'),
    // attentionScore / sort-lab inputs (isSortSettingKey list).
    plansFirst:Boolean(s.plansFirst),
    planWindowDays:s.planWindowDays || 0,
    planWeight:s.planWeight || 0,
    dueWeight:s.dueWeight || 0,
    progressWeight:s.progressWeight || 0,
    trendWeight:s.trendWeight || 0,
    rhythmWeight:s.rhythmWeight || 0,
    buildWeight:s.buildWeight || 0,
    limitWeight:s.limitWeight || 0,
    stopWeight:s.stopWeight || 0,
    newWeight:s.newWeight || 0,
    newBuildMode:s.newBuildMode || '',
    dueMode:s.dueMode || '',
    buildLookAheadDays:s.buildLookAheadDays || 0,
    buildRiseAt:s.buildRiseAt || 0,
    limitMode:s.limitMode || '',
    stopMode:s.stopMode || '',
    rhythmBias:s.rhythmBias || 0
  });
  return [
    `algorithm:${HOME_PLANNER_ALGORITHM_VERSION}`,
    rev,
    loc || '',
    s.pinnedLocationId || '',
    s.lastKnownLocationId || '',
    travelSig,
    coordSig,
    currentEdgeSig,
    settingsSig,
    Array.isArray(data) ? data.length : 0
  ].join('\n');
}

// The lightweight home fingerprint deliberately omits some low-frequency
// fields. Optimizer reuse needs an exact key so edits to any habit, window,
// location, score weight, or travel edge can never reuse a stale schedule.
// Prefer the dirty-counter + live sig for request dedupe; keep a compact
// persisted digest for same-day disk cache identity (day-stable via dayStart).
function homePlannerStateKey(data,fingerprintNow = Date.now()){
  const dirty = homePlannerDirtyKey(data);
  // Include a coarse time bucket only for live optimizer keys (not dayStart),
  // so a genuine "now moved" reopen can still refresh day 0 via day0Only.
  const isDayStable = fingerprintNow === dayStart(fingerprintNow);
  const timePart = isDayStable ? 'day' : String(Math.floor(fingerprintNow / 60000));
  return `${dirty}\n${timePart}`;
}

function optimizerHomeStateKey(data){
  return homePlannerStateKey(data);
}

const HOME_AGENDA_CACHE_KEY = 'tings_home_agenda_cache_v1';
const HOME_AGENDA_CACHE_FRESH_MS = 10 * 60 * 1000;

function homeAgendaCacheStateKey(data){
  return homePlannerStateKey(data,dayStart(Date.now()));
}

function readHomeAgendaCacheRecord(data){
  try{
    const cached = Storage.read(HOME_AGENDA_CACHE_KEY);
    if(!cached || cached.version !== 1 || !cached.week)return null;
    if(cached.key !== homeAgendaCacheStateKey(data))return null;
    if(dateKey(cached.savedAt) !== dateKey(Date.now()))return null;
    return cached;
  }catch(_){
    return null;
  }
}

function cachedHomeAgenda(data){
  try{
    const cached = readHomeAgendaCacheRecord(data);
    if(!cached)return null;
    const week = cached.week;
    for(const day of week.days || []){
      for(const row of day.timeline || []){
        if(row && row.i != null)row.h = data[row.i] || null;
      }
      for(const item of day.agendaItems || []){
        if(item && item.i != null)item.h = data[item.i] || null;
      }
    }
    return week;
  }catch(_){
    return null;
  }
}

function homeAgendaCacheIsFresh(data){
  const cached = readHomeAgendaCacheRecord(data);
  if(!cached)return false;
  return (Date.now() - Number(cached.savedAt || 0)) <= HOME_AGENDA_CACHE_FRESH_MS;
}

function leanAgendaWeekForCache(week){
  if(typeof leanAgendaWeek === 'function')return leanAgendaWeek(week);
  if(!week || !Array.isArray(week.days))return week;
  const strip = row=>{
    if(!row || typeof row !== 'object')return row;
    const out = {...row};
    delete out.h;
    return out;
  };
  return {
    days:week.days.map(day=>({
      ...day,
      timeline:Array.isArray(day.timeline) ? day.timeline.map(strip) : day.timeline,
      agendaItems:Array.isArray(day.agendaItems) ? day.agendaItems.map(strip) : day.agendaItems
    })),
    totalTravelSeconds:week.totalTravelSeconds,
    candidateCount:week.candidateCount,
    optimized:week.optimized
  };
}

function saveHomeAgendaCache(data,week){
  if(!week || !Array.isArray(week.days))return;
  try{
    plannerPerfMark('planner-cache-write-start');
    // Habit records are already persisted once and every planner row carries
    // its stable data index. Omitting repeated `h` objects keeps this cache
    // small even for histories with hundreds of logs.
    const leanWeek = week.__lean ? week : leanAgendaWeekForCache(week);
    if(leanWeek && leanWeek.__lean)delete leanWeek.__lean;
    Storage.write(HOME_AGENDA_CACHE_KEY,{
      version:1,
      savedAt:Date.now(),
      key:homeAgendaCacheStateKey(data),
      week:leanWeek
    });
    plannerPerfMark('planner-cache-write-end');
  }catch(_){}
}

// View-only state such as an expanded blocked group does not change placement.
// Repaint from the already solved week so the interaction responds immediately
// even if travel-cache background writes changed the next optimizer key.
function renderHomePresentationOnly(){
  if(!sortSettings && typeof loadSortSettings === 'function')sortSettings = loadSortSettings();
  if(_homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
    render({__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
    return;
  }
  render();
}

// ASYNC COORDINATOR: keep week planning outside the UI thread in both modes.
// A same-day cached or currently mounted week provides a stable view while the
// worker solves. A first-ever cold open keeps its skeleton until that result.
function scheduleIdlePlannerWarmAndBuild(data,opts){
  if(_idlePlannerRefreshTimer != null)return;
  const run = ()=>{
    _idlePlannerRefreshTimer = null;
    // Warm is fire-and-forget and exact-mode only — never block the replan
    // behind a GLPK compile (especially in fast mode).
    const exact = Boolean(
      (typeof sortSettings !== 'undefined' && sortSettings && sortSettings.agendaOptimizer)
      && !(typeof agendaPlannerForcedFast === 'function' && agendaPlannerForcedFast())
    );
    if(exact && typeof warmAgendaPlannerWorker === 'function'){
      void warmAgendaPlannerWorker();
    }
    queueOptimizedHomeRender(typeof load === 'function' ? load() : data,{
      ...(opts || {}),
      __backgroundRefresh:true,
      __fromIdleRefresh:true,
      __skipFreshnessGate:true,
      __forceReplan:true
    });
  };
  if(typeof requestIdleCallback === 'function'){
    _idlePlannerRefreshTimer = requestIdleCallback(run,{timeout:200});
  }else{
    _idlePlannerRefreshTimer = setTimeout(run,50);
  }
}

function queueOptimizedHomeRender(data,opts){
  plannerPerfMark('planner-queue-start');
  const key = optimizerHomeStateKey(data);
  const dirtyKey = homePlannerDirtyKey(data);
  const exactMode = Boolean(sortSettings && sortSettings.agendaOptimizer);
  if(_optimizerHomeReadyKey === key && _optimizerHomeReadyWeek){
    if(opts && opts.__backgroundRefresh
      && homeAgendaPlanSignature(_homeRenderedWeek,data) === homeAgendaPlanSignature(_optimizerHomeReadyWeek,data)){
      _homeRenderedWeek = _optimizerHomeReadyWeek;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(data,_homeRenderedWeek);
      _homeListFingerprint = homeListFingerprint();
      return false;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:_optimizerHomeReadyWeek});
    _homeListFingerprint = homeListFingerprint();
    return true;
  }
  // Background tick: dirty key unchanged → skip the worker entirely.
  // Forced reopen (hidden ≥60s) still replans; may use day0Only when dirty matches.
  if(opts && opts.__backgroundRefresh && !opts.__forceReplan
    && _optimizerHomeReadyDirtyKey
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek){
    _homeListFingerprint = homeListFingerprint();
    return false;
  }
  if(_optimizerHomeRequestKey === key){
    // Request de-dupe must not swallow a foreground presentation change made
    // while that solve is active. Repaint from the stable mounted plan; do not
    // start or publish another scheduling result.
    if(!(opts && opts.__backgroundRefresh)
      && _homeRenderedWeek && Array.isArray(_homeRenderedWeek.days)){
      render({...opts,__fromOptimizer:true,__optimizedWeek:_homeRenderedWeek});
      _homeListFingerprint = homeListFingerprint();
      return true;
    }
    return false;
  }
  // A save/log/add can invalidate an exact solve that is still running. Do not
  // queue the user's new plan behind obsolete work: terminate it and let this
  // foreground request start a fresh solve.
  if(_optimizerHomeRequestKey && _optimizerHomeRequestKey !== key
    && !(opts && opts.__backgroundRefresh)){
    ++_optimizerHomeRequestToken;
    _optimizerHomeRequestKey = '';
    if(typeof cancelAgendaPlannerWorkerRequests === 'function'){
      cancelAgendaPlannerWorkerRequests('planner state changed during solve');
    }
  }

  // Background refreshes keep the current DOM. Direct/cold renders use the
  // latest compatible plan, avoiding both a blank launch and reordered phases.
  let paintedFromFreshCache = false;
  if(!(opts && opts.__backgroundRefresh)){
    plannerPerfMark('planner-cache-read');
    const cached = cachedHomeAgenda(data);
    if(cached){
      render({...opts,__fromOptimizer:true,__optimizedWeek:cached});
      paintedFromFreshCache = !(opts && opts.__skipFreshnessGate) && homeAgendaCacheIsFresh(data);
    }else if(_homeRenderedWeek && $('list')?.querySelector('.ting-card')){
      // A done/log/add render keeps the existing agenda mounted. The action has
      // already been persisted; replace the agenda only when its new solve is
      // ready instead of flashing an unplanned intermediate list.
    }else if(!$('list')?.querySelector('.home-loading')){
      // No cache and no skeleton (warm edit path): paint a basic list now;
      // the optimized week replaces it when the worker resolves.
      render({...opts,deferAgenda:true});
    }
    // Cold open with no cache keeps the HTML skeleton until the worker result.
    _homeListFingerprint = homeListFingerprint();
    plannerPerfMark('planner-first-paint');
  }

  // Fresh same-day cache: let idle warm+build own the refresh so cold open
  // does not immediately pay a full worker replan.
  if(paintedFromFreshCache && !(opts && opts.__skipFreshnessGate)){
    scheduleIdlePlannerWarmAndBuild(data,opts);
    return true;
  }

  const token = ++_optimizerHomeRequestToken;
  _optimizerHomeRequestKey = key;
  const settings = {...(sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {}))};
  const day0Only = Boolean(
    opts && opts.__forceReplan
    && _optimizerHomeReadyDirtyKey === dirtyKey
    && _optimizerHomeReadyWeek
  );
  const buildOpts = {dirtyKey,day0Only};
  const optimizerBuild = typeof buildWeekAgendaOffMain === 'function'
    ? buildWeekAgendaOffMain(data,settings,7,exactMode ? 'exact' : 'fast',buildOpts)
    : buildWeekAgendaAsync(data,settings,7,buildOpts);
  void optimizerBuild.then(week=>{
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    const live = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : null);
    if(!live)return;
    if(key !== optimizerHomeStateKey(load())){
      if(opts && opts.__backgroundRefresh)queueOptimizedHomeRender(load(),opts);
      else render(opts);
      return;
    }
    if(!week || !Array.isArray(week.days))return;
    const liveData = load();
    // Worker posts a lean week (no `h`). Re-attach before any consumer reads names.
    if(typeof rehydrateAgendaWeekHabits === 'function')rehydrateAgendaWeekHabits(week,liveData);
    // In exact mode a timed-out solve returns the heuristic fallback. A cached
    // planned week can stay mounted; on a first-ever load, use that fallback
    // rather than leaving the user on the unplanned basic list.
    if(exactMode && !week.optimized){
      if(!_homeRenderedWeek){
        saveHomeAgendaCache(liveData,week);
        render({...opts,__fromOptimizer:true,__optimizedWeek:week});
        _homeListFingerprint = homeListFingerprint();
      }
      return;
    }
    _optimizerHomeReadyKey = key;
    _optimizerHomeReadyWeek = week;
    // Capture dirty key from live state after the solve. Travel/location can
    // change while the worker runs; stamping the request-start key would make
    // the next background tick look dirty and replan for no reason.
    _optimizerHomeReadyDirtyKey = homePlannerDirtyKey(liveData);
    saveHomeAgendaCache(liveData,week);
    if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
      _homeRenderedWeek = week;
      if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
      _homeListFingerprint = homeListFingerprint();
      if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
      return;
    }
    render({...opts,__fromOptimizer:true,__optimizedWeek:week});
    _homeListFingerprint = homeListFingerprint();
    if(typeof plannerPerfDump === 'function')plannerPerfDump('home');
  }).catch(()=>{
    if(token !== _optimizerHomeRequestToken)return;
    _optimizerHomeRequestKey = '';
    // Keep the fast planner already on screen. A cold open still sitting on
    // the skeleton animation gets the basic list instead of loading forever.
    // (If the skeleton behavior is disabled above, this guard never fires:
    // the deferAgenda paint has already replaced the skeleton.)
    if($('list')?.querySelector('.home-loading'))render({...opts,deferAgenda:true});
  });
  return true;
}

// Immediate feedback for a saved travel override. The optimized replan still
// runs, but the tapped edge shows its edited value while GLPK is working.
function markHomeTravelEdgeEdited(fromId,toId,minutes){
  const mins = Math.max(1,Math.round(Number(minutes) || 1));
  document.querySelectorAll('#list .travel-card').forEach(card=>{
    const sameEdge = (card.dataset.travelFrom === fromId && card.dataset.travelTo === toId)
      || (card.dataset.travelFrom === toId && card.dataset.travelTo === fromId);
    if(!sameEdge)return;
    card.classList.add('is-edited');
    const copy = card.querySelector('span');
    if(copy)copy.textContent = copy.textContent.replace(/\b\d+\s+min\b/,`${mins} min`);
    if(!card.querySelector('.travel-edit-mark')){
      const icon = document.createElement('i');
      icon.className = 'ti ti-pencil travel-edit-mark';
      icon.setAttribute('aria-hidden','true');
      card.appendChild(icon);
    }
  });
}

// RENDER: sync home list only when the freshness key moved. Background paths
// (travel refresh, while-open loop, quiet location updates) should call this
// instead of render() so an unchanged agenda never rebuilds the DOM.
function renderHomeIfChanged(force){
  const fp = homeListFingerprint();
  if(!force && fp === _homeListFingerprint)return false;
  const data = load();
  const settings = sortSettings || (typeof loadSortSettings === 'function' ? loadSortSettings() : {});
  const canCompareWeek = Boolean(
    _homeRenderedWeek
    && Array.isArray(_homeRenderedWeek.days)
    && settings
    && settings.preset === 'todayFirst'
    && weekOnHomeEnabled(settings)
    && !(typeof searchQuery === 'string' && searchQuery.trim())
  );

  if(canCompareWeek){
    // Claim this state before starting work so a travel burst or visibility
    // event cannot enqueue the same recalculation repeatedly.
    _homeListFingerprint = fp;
    if(settings.agendaOptimizer && typeof buildWeekAgendaAsync === 'function'){
      queueOptimizedHomeRender(data,{__backgroundRefresh:true,__forceReplan:Boolean(force)});
      return true;
    }
    if(!settings.agendaOptimizer && typeof buildWeekAgendaOffMain === 'function'){
      const token = ++_fastHomeRefreshToken;
      const requestedFingerprint = fp;
      const settingsSnapshot = {...settings};
      void buildWeekAgendaOffMain(data,settingsSnapshot,7,'fast').then(week=>{
        if(token !== _fastHomeRefreshToken || !week || !Array.isArray(week.days))return;
        const liveData = load();
        // A real edit/location update arrived while the worker was planning.
        // Discard this stale result and let the latest state schedule its own.
        if(requestedFingerprint !== homeListFingerprint()){
          renderHomeIfChanged();
          return;
        }
        if(homeAgendaPlanSignature(_homeRenderedWeek,liveData) === homeAgendaPlanSignature(week,liveData)){
          _homeRenderedWeek = week;
          if(typeof syncAutoMarkChunkPlans === 'function')syncAutoMarkChunkPlans(liveData,week);
          _homeListFingerprint = homeListFingerprint();
          return;
        }
        render({__fromBackgroundRefresh:true,__optimizedWeek:week});
        _homeListFingerprint = homeListFingerprint();
      }).catch(()=>{
        if(token !== _fastHomeRefreshToken)return;
        // Workers are widely available in the supported browsers. If creation
        // is blocked, keep the current plan instead of freezing touch input
        // with the old synchronous comparison path.
      });
      return true;
    }
  }
  const didRender = render();
  if(didRender !== false)_homeListFingerprint = homeListFingerprint();
  return true;
}

// Compat alias — progressive two-phase paint was retired because phase-1 order
// differed from agenda order and caused visible flicker. Callers that still
// name renderProgressive get a single sync render.
function renderProgressive(){
  const didRender = render();
  if(didRender !== false)_homeListFingerprint = homeListFingerprint();
}

// WIRE: crown-dial gesture for breakable progress. Drag horizontally to adjust
// minutes (3px ≈ 1 min, speed-adaptive). Updates the 3-color status bar and
// pending target. The dial owns horizontal intent in both directions (forward
// only — leftward clamps at the committed floor), so it never hands off to the
// card swipe; swipe instead starts from the dedicated right-edge zone and other
// non-crown surfaces. A clean tap propagates to card (opens detail); vertical
// gestures pass through to page scroll.
function setupBreakableCrown(row,_realIdx){
  const crown = row.querySelector('.breakable-crown');
  if(!crown)return;
  const canvas = crown.querySelector('.crown-canvas');
  const label = row.querySelector('.breakable-progress-label');
  const barManual = row.querySelector('.bar-manual');
  const barCalendar = row.querySelector('.bar-calendar');
  const barAdding = row.querySelector('.bar-adding');
  const total = Math.max(1,Math.round(Number(crown.dataset.total) || 1));
  const committed = Math.max(0,Math.min(total,Math.round(Number(crown.dataset.committed) || 0)));
  const calendarMin = Math.max(0,Math.round(Number(crown.dataset.calendar) || 0));
  const manualMin = Math.max(0,Math.round(Number(crown.dataset.manual) || 0));

  const PX_PER_MIN = 3;
  crown._scroll = committed * 10;
  if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas, crown._scroll);

  let tooltip = null;
  function showTooltip(minutes){
    const adding = Math.max(0,minutes - committed);
    if(!tooltip){
      tooltip = document.createElement('span');
      tooltip.className = 'crown-tooltip';
      crown.appendChild(tooltip);
    }
    tooltip.textContent = adding > 0 ? `+${adding}m` : `${minutes}m`;
    tooltip.classList.add('visible');
  }
  function hideTooltip(){
    if(tooltip)tooltip.classList.remove('visible');
  }

  function syncVisual(minutes){
    const m = Math.max(committed,Math.min(total,Math.round(minutes)));
    if(label)label.textContent = `${m}/${total}m`;
    crown.setAttribute('aria-valuenow',m);
    crown.setAttribute('aria-label',`progress ${m} of ${total} minutes`);
    crown.classList.toggle('complete',m >= total);
    const adding = m - committed;
    const capManual = Math.min(manualMin,total);
    const capCal = Math.min(calendarMin,total - capManual);
    const capAdding = Math.min(adding,total - capManual - capCal);
    const manualPct = total > 0 ? (capManual / total) * 100 : 0;
    const calPct = total > 0 ? (capCal / total) * 100 : 0;
    const addingPct = total > 0 ? (capAdding / total) * 100 : 0;
    if(barManual)barManual.style.width = `${manualPct}%`;
    if(barCalendar)barCalendar.style.width = `${calPct}%`;
    if(barAdding)barAdding.style.width = `${addingPct}%`;
  }

  function setTarget(minutes){
    const m = Math.max(committed,Math.min(total,Math.round(minutes)));
    row.dataset.progressTarget = String(m);
    row.dataset.progressDirty = m === committed ? '0' : '1';
    syncVisual(m);
  }

  let startX,startY,prevX,velX = 0,momentumId = null,smoothAnimId = null,scrubRaf = null;
  let dragging = false,pointerId = null,pendingDx = 0,pendingTarget = null;
  const friction = 0.92;
  const minScroll = committed * 10;
  const progressRoot = row.querySelector('.breakable-progress');

  const cancelMomentum = () => {
    if(momentumId){cancelAnimationFrame(momentumId);momentumId=null;}
    if(smoothAnimId){cancelAnimationFrame(smoothAnimId);smoothAnimId=null;}
  };

  const cancelScrub = () => {
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;}
    pendingDx = 0;
  };

  const applyScrubDx = dx => {
    if(!dx && pendingTarget == null)return;
    if(dx){
      crown._scroll = Math.max(minScroll,crown._scroll + dx * (10 / PX_PER_MIN));
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      const speed = Math.abs(velX);
      const gain = 1 + speed * 0.25;
      crown._valScroll += dx * gain;
      pendingTarget = crown._dragBase + Math.round(crown._valScroll / PX_PER_MIN);
    }
    if(pendingTarget != null){
      setTarget(pendingTarget);
      showTooltip(pendingTarget);
      pendingTarget = null;
    }
  };

  const flushScrub = () => {
    scrubRaf = null;
    const dx = pendingDx;
    pendingDx = 0;
    applyScrubDx(dx);
  };

  const startMomentum = initVel => {
    cancelMomentum();
    cancelScrub();
    const baseScroll = crown._scroll;
    const baseVal = Math.round(Number(row.dataset.progressTarget) || committed);
    let vel = initVel;
    let last = performance.now();
    const tick = now => {
      const dt = Math.min(32, Math.max(0, now - last));
      last = now;
      vel *= Math.pow(friction, dt / 16.67);
      if(Math.abs(vel) < 0.5){momentumId = null;hideTooltip();return;}
      crown._scroll = Math.max(minScroll,crown._scroll + vel * (dt / 16.67) * (10 / PX_PER_MIN));
      const derived = Math.max(committed,Math.min(total,baseVal + Math.round((crown._scroll - baseScroll) / 10)));
      setTarget(derived);
      showTooltip(derived);
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      momentumId = requestAnimationFrame(tick);
    };
    momentumId = requestAnimationFrame(tick);
  };

  crown.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    // Exclusive gestures: refuse while reorder/swipe owns the card.
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'hold')){
      pointerId = null;
      return;
    }
    cancelMomentum();
    cancelScrub();
    startX = e.clientX;
    startY = e.clientY;
    prevX = e.clientX;
    velX = 0;
    pendingDx = 0;
    pendingTarget = null;
    dragging = false;
    pointerId = e.pointerId;
    crown._valScroll = 0;
    crown._dragBase = Math.round(Number(row.dataset.progressTarget) || committed);
    // Soft-claim so a tiny move can't arm card swipe before horizontal intent is known.
    row.dataset.crownGesture = '1';
    // Breakable crown owns most of the card — also start reorder long-press here.
    // Horizontal scrub cancels it; a still hold reveals the grip.
    if(row.dataset.agendaDraggable === '1' && typeof beginAgendaCardLongPress === 'function'){
      const realIdx = Number(row.dataset.realIdx);
      const dayBase = Number(row.dataset.dayBase);
      if(Number.isFinite(realIdx) && Number.isFinite(dayBase)){
        beginAgendaCardLongPress(row,realIdx,dayBase,e);
      }
    }
  });

  crown.addEventListener('pointermove',e=>{
    if(pointerId === null || e.pointerId !== pointerId)return;
    e.stopPropagation();
    if(typeof cardGestureOwner === 'function' && cardGestureOwner(row) === 'reorder'){
      pointerId = null;
      delete row.dataset.crownGesture;
      return;
    }
    const dxTotal = e.clientX - startX;
    const dyTotal = e.clientY - startY;

    // Reorder already armed: vertical move hands off to agenda drag.
    if(row.classList.contains('agenda-drag-ready') || row.classList.contains('agenda-longpress-armed')){
      if(typeof tryAgendaDragFromArmedPress === 'function' && tryAgendaDragFromArmedPress(row,e)){
        pointerId = null;
        delete row.dataset.crownGesture;
        return;
      }
      // Stay still while holding the armed grip — don't scrub.
      if(Math.abs(dxTotal) < 10)return;
      if(typeof cancelAgendaLongPress === 'function')cancelAgendaLongPress();
    }

    if(!dragging){
      // 10px beats the card-tap tolerance (8px) so a genuine tap or tiny
      // thumb tremor never arms a scrub and dirties the dial behind the
      // user's back. Vertical still wins when it dominates (page scroll).
      if(Math.abs(dxTotal) < 10 && Math.abs(dyTotal) < 10)return;
      if(Math.abs(dyTotal) > Math.abs(dxTotal)){
        // Vertical intent before reorder arms → drop long-press + crown claim.
        if(typeof agendaLongPressOwnsPointer === 'function' && agendaLongPressOwnsPointer(e.pointerId)
          && !row.classList.contains('agenda-drag-ready')
          && !row.classList.contains('agenda-longpress-armed')){
          if(Math.abs(dyTotal) > 8 && typeof cancelAgendaLongPress === 'function')cancelAgendaLongPress();
          else return;
        }else if(typeof agendaLongPressOwnsPointer === 'function' && agendaLongPressOwnsPointer(e.pointerId)){
          // Armed: handoff handled above; keep waiting for clearer vertical.
          return;
        }
        pointerId = null;
        delete row.dataset.crownGesture;
        return;
      }
      // The dial owns horizontal intent in BOTH directions. Scrub is
      // forward-only, so a leftward drag simply holds still (clamped at the
      // committed floor) instead of handing off to the card swipe — that
      // handoff was what made the crown feel like it "slipped" into swipe
      // while dialing. Swiping now starts from the dedicated right-edge zone
      // (and every non-crown surface: title, status bar) via the row handler.
      // Horizontal scrub — cancel reorder long-press so dial wins.
      if(typeof claimCardGesture === 'function'){
        if(!claimCardGesture(row,'scrub',{force:true})){
          pointerId = null;
          delete row.dataset.crownGesture;
          return;
        }
      }else if(typeof cancelAgendaLongPress === 'function'){
        cancelAgendaLongPress();
      }
      row.classList.remove('agenda-drag-ready','agenda-longpress-armed');
      if(typeof closeAllSwipes === 'function')closeAllSwipes();
      dragging = true;
      try{ crown.setPointerCapture(e.pointerId); }catch{ /* synthetic / lost pointer */ }
      crown.classList.add('active');
      if(progressRoot)progressRoot.classList.add('is-scrubbing');
      e.preventDefault();
    }

    const dx = e.clientX - prevX;
    prevX = e.clientX;
    velX = velX * 0.55 + dx * 0.45;
    pendingDx += dx;
    if(!scrubRaf)scrubRaf = requestAnimationFrame(flushScrub);
  });

  const endDrag = e => {
    if(pointerId === null)return;
    e.stopPropagation();
    const wasDragging = dragging;
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;flushScrub();}
    if(dragging){
      crown.classList.remove('active');
      if(progressRoot)progressRoot.classList.remove('is-scrubbing');
      if(Math.abs(velX) > 1.5)startMomentum(velX);
      else hideTooltip();
      setTimeout(hideTooltip,1200);
    }
    dragging = false;
    pointerId = null;
    velX = 0;
    delete row.dataset.crownGesture;
    if(wasDragging && typeof releaseCardGesture === 'function')releaseCardGesture(row,'scrub');
    if(!wasDragging && e.type === 'pointerup'){
      // A drag or an armed long-press ending on the crown is not a tap.
      // Capture BEFORE settle: the drag finish clears these classes.
      const wasArmed = row.classList.contains('agenda-drag-ready') || row.classList.contains('agenda-longpress-armed');
      if(typeof settleAgendaPointerFromForeignTarget === 'function'){
        settleAgendaPointerFromForeignTarget(row,e);
      }
      if(wasArmed)return;
      if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'tap'))return;
      const card = row.querySelector('.ting-card');
      if(card){
        card.dataset.approvedClickUntil = String(Date.now()+500);
        card.click();
      }
    }
  };

  crown.addEventListener('pointerup',endDrag);
  crown.addEventListener('pointercancel',e=>{
    e.stopPropagation();
    if(scrubRaf){cancelAnimationFrame(scrubRaf);scrubRaf=null;pendingDx=0;}
    if(dragging){
      crown.classList.remove('active');
      if(progressRoot)progressRoot.classList.remove('is-scrubbing');
      hideTooltip();
      if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'scrub');
    }
    dragging = false;pointerId = null;velX = 0;
    delete row.dataset.crownGesture;
    if(typeof cancelAgendaLongPress === 'function'
      && typeof agendaLongPressOwnsPointer === 'function'
      && agendaLongPressOwnsPointer(e.pointerId)){
      cancelAgendaLongPress();
    }
  });

  crown.addEventListener('wheel',e=>{
    e.preventDefault();
    cancelMomentum();
    cancelScrub();
    const step = e.deltaY < 0 ? 1 : -1;
    const cur = Math.round(Number(row.dataset.progressTarget) || committed);
    const next = Math.max(committed,Math.min(total,cur + step));
    if(next !== cur){
      crown._scroll = Math.max(minScroll,crown._scroll + step * 10);
      if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
      setTarget(next);
    }
  },{passive:false});

  crown.addEventListener('keydown',e=>{
    const inc = e.key === 'ArrowRight' || e.key === 'ArrowUp';
    const dec = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
    if(inc||dec){
      e.preventDefault();
      cancelMomentum();
      cancelScrub();
      const cur = Math.round(Number(row.dataset.progressTarget) || committed);
      const next = Math.max(committed,Math.min(total,cur + (inc ? 1 : -1)));
      if(next !== cur){
        crown._scroll = Math.max(minScroll,crown._scroll + (inc ? 10 : -10));
        if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
        setTarget(next);
      }
    }
  });

  // Isolate the dial's pointer and mouse gestures from the row's tap
  // tracking. Touch events must bubble: the row swipe takes over leftward
  // drags on the dial, while rightward drags stay with the crown scrub.
  const stop = e=>{ e.stopPropagation(); };
  ['pointerdown','pointermove','pointerup','pointercancel','mousedown','mouseup'].forEach(ev=>{
    crown.addEventListener(ev,stop,{ passive:true });
  });
  crown.addEventListener('click',e=>{ e.stopPropagation(); },{ passive:true });

  window.addEventListener('resize',()=>{
    if(canvas && typeof drawCrownRidges === 'function')drawCrownRidges(canvas,crown._scroll);
  });

  syncVisual(committed);
}

// WIRE: attach swipe gesture listeners
function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const leftActions = row.querySelector('.swipe-actions-left');
  const rightActions = row.querySelector('.swipe-actions-right');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;
  let startedOpen = false;
  // Match CSS collapsed default so first paint never shows action chrome.
  if(leftActions){
    leftActions.style.width = '0';
    leftActions.style.pointerEvents = 'none';
  }
  if(rightActions){
    rightActions.style.width = '0';
    rightActions.style.pointerEvents = 'none';
  }

  // PURE: measure total swipe action width
  function revealWidth(actions){
    if(!actions)return 0;
    return actions.querySelectorAll('.swipe-action').length * SWIPE_ACTION_WIDTH;
  }

  // HYBRID: reset swipe DOM and clear state
  function resetSwipe(){
    card.style.transition = SNAP_TRANSITION;
    card.style.transform = '';
    if(leftActions){
      leftActions.style.transition = WIDTH_TRANSITION;
      leftActions.style.width = '0';
      leftActions.style.pointerEvents = 'none';
    }
    if(rightActions){
      rightActions.style.transition = WIDTH_TRANSITION;
      rightActions.style.width = '0';
      rightActions.style.pointerEvents = 'none';
    }
    swipeOpenCard = null;
    delete row.dataset.swipeOpen;
    if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
    startedOpen = false;
    moved = false;
    dx = 0;
  }

  row.addEventListener('touchstart',e=>{
    const t = e.changedTouches[0];
    // Reorder and crown scrub are committed gestures. A long-press `hold` is
    // deliberately trackable here: pointerdown fires before touchstart on
    // phones, and horizontal movement upgrades that soft hold to swipe below.
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'swipe')){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    if(row.classList.contains('is-agenda-dragging')
      || row.querySelector('.breakable-progress.is-scrubbing')){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    // The breakable-progress block is dial territory — the crown, its status
    // bar, and the progress header all sit in the card's center. Swipes on a
    // breakable card start only from an edge area: the left edge (pulse button
    // / name, handled here as normal) or the right edge (the dedicated
    // .breakable-scrub-hint zone). Touches that begin anywhere inside the
    // progress block — except that right-edge hint — never arm a card swipe.
    const onDial = t.target.closest && t.target.closest('.breakable-progress')
      && !(t.target.closest && t.target.closest('.breakable-scrub-hint'));
    if(onDial){
      touchId = null;
      moved = false;
      dx = 0;
      return;
    }
    touchId = t.identifier;startX = t.clientX;startY = t.clientY;dx = 0;moved = false;
    startedOpen = swipeOpenCard === card;
    if(swipeOpenCard && swipeOpenCard !== card){
      closeAllSwipes();
    }
  },{passive:true});

  row.addEventListener('touchmove',e=>{
    if(touchId === null)return;
    if(typeof cardGestureOwner === 'function'){
      const owner = cardGestureOwner(row);
      if(owner === 'reorder' || owner === 'scrub')return;
    }
    const t = [...e.changedTouches].find(item=>item.identifier === touchId);
    if(!t)return;
    const ddx = t.clientX - startX;
    const ddy = t.clientY - startY;
    if(!moved && Math.abs(ddy) > Math.abs(ddx))return;
    e.preventDefault();
    if(startedOpen){
      if(Math.abs(ddx) > 12){
        closeAllSwipes();
        moved = true;dx = 0;
      }
      return;
    }
    const openDir = swipeOpenCard === card ? parseInt(row.dataset.swipeOpen || '0',10) : 0;
    if(openDir){
      closeAllSwipes();
      moved = true;dx = 0;
      return;
    }
    if(!moved){
      if(typeof claimCardGesture === 'function' && !claimCardGesture(row,'swipe',{force:true})){
        touchId = null;
        return;
      }
    }
    moved = true;dx = ddx;
    const wantsLeft = dx > 0;
    const activeActions = wantsLeft ? leftActions : rightActions;
    const inactiveActions = wantsLeft ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    if(!reveal){
      card.style.transition = 'none';
      card.style.transform = '';
      return;
    }
    const clamped = Math.max(-reveal,Math.min(reveal,dx));
    card.style.transition = 'none';
    if(activeActions)activeActions.style.transition = 'none';
    if(inactiveActions)inactiveActions.style.transition = 'none';
    card.style.transform = `translateX(${clamped}px)`;
    const pct = Math.min(1,Math.abs(clamped) / reveal);
    if(activeActions){
      activeActions.style.width = `${Math.abs(clamped)}px`;
      activeActions.style.pointerEvents = pct > 0.2 ? 'auto' : 'none';
    }
    if(inactiveActions){
      inactiveActions.style.width = '0';
      inactiveActions.style.pointerEvents = 'none';
    }
  },{passive:false});

  row.addEventListener('touchend',()=>{
    if(touchId === null || !moved){
      if(touchId !== null && typeof releaseCardGesture === 'function'
        && typeof cardGestureOwner === 'function' && cardGestureOwner(row) === 'swipe'
        && !row.dataset.swipeOpen){
        releaseCardGesture(row,'swipe');
      }
      touchId = null;
      return;
    }
    if(startedOpen){
      startedOpen = false;
      touchId = null;
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    const activeActions = dir > 0 ? leftActions : rightActions;
    const inactiveActions = dir > 0 ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const snap = reveal > 0 && Math.abs(dx) > Math.min(SWIPE_THRESHOLD,reveal * 0.55);
    card.style.transition = SNAP_TRANSITION;
    if(activeActions)activeActions.style.transition = WIDTH_TRANSITION;
    if(inactiveActions)inactiveActions.style.transition = WIDTH_TRANSITION;
    if(snap){
      card.style.transform = `translateX(${dir * reveal}px)`;
      if(activeActions){
        activeActions.style.width = `${reveal}px`;
        activeActions.style.pointerEvents = 'auto';
      }
      if(inactiveActions){
        inactiveActions.style.width = '0';
        inactiveActions.style.pointerEvents = 'none';
      }
      swipeOpenCard = card;
      row.dataset.swipeOpen = String(dir);
      if(typeof claimCardGesture === 'function')claimCardGesture(row,'swipe');
    }else{
      card.style.transform = '';
      if(leftActions){
        leftActions.style.width = '0';
        leftActions.style.pointerEvents = 'none';
      }
      if(rightActions){
        rightActions.style.width = '0';
        rightActions.style.pointerEvents = 'none';
      }
      swipeOpenCard = null;
      delete row.dataset.swipeOpen;
      if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
    }
    touchId = null;
  });

  row.addEventListener('touchcancel',resetSwipe,{passive:true});
}

// HYBRID: close all open swipe rows
function closeAllSwipes(){
  document.querySelectorAll('.swipe-row').forEach(row=>{
    const card = row.querySelector('.ting-card');
    const actions = row.querySelectorAll('.swipe-actions');
    if(card){
      card.style.transition = SNAP_TRANSITION;
      card.style.transform = '';
    }
    actions.forEach(actions=>{
      actions.style.transition = WIDTH_TRANSITION;
      actions.style.width = '0';
      actions.style.pointerEvents = 'none';
    });
    delete row.dataset.swipeOpen;
    if(typeof releaseCardGesture === 'function')releaseCardGesture(row,'swipe');
  });
  swipeOpenCard = null;
}

// WIRE: attach card tap and pointer listeners
function setupCardTap(row,realIdx){
  const card = row.querySelector('.ting-card');
  card.addEventListener('pointerdown',e=>{
    if(e.target.closest('.pulse-btn'))return;
    const scrollHost = card.closest('.pane-list,.sheet,.detail-page');
    cardPointer = {
      card,realIdx,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now(),maxMove:0,
      scrollHost,scrollTop:scrollHost ? scrollHost.scrollTop : window.scrollY
    };
  });
  card.addEventListener('pointermove',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    cardPointer.maxMove = Math.max(cardPointer.maxMove,Math.hypot(e.clientX-cardPointer.x,e.clientY-cardPointer.y));
  },{passive:true});
  card.addEventListener('pointerup',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    const tap = cardPointer;
    cardPointer = null;
    const moved = Math.max(tap.maxMove,Math.hypot(e.clientX - tap.x,e.clientY - tap.y));
    const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
    if(moved > 8 || Math.abs(scrollTop-tap.scrollTop) > 1 || Date.now() - tap.time > 650){
      card.dataset.ignoreClickUntil = String(Date.now()+500);
      return;
    }
    card.dataset.approvedClickUntil = String(Date.now()+500);
  });
  card.addEventListener('pointercancel',e=>{
    if(cardPointer && cardPointer.card === card && cardPointer.id === e.pointerId){
      const tap = cardPointer;cardPointer = null;
      const scrollTop = tap.scrollHost ? tap.scrollHost.scrollTop : window.scrollY;
      if(tap.maxMove > 8 || Math.abs(scrollTop-tap.scrollTop) > 1)card.dataset.ignoreClickUntil = String(Date.now()+500);
    }
  });
  card.addEventListener('click',e=>{
    if(Number(card.dataset.ignoreClickUntil || 0) > Date.now()){
      e.preventDefault();e.stopPropagation();return;
    }
    if(typeof cardGestureBlocks === 'function' && cardGestureBlocks(row,'tap')){
      e.preventDefault();e.stopPropagation();return;
    }
    if(row.classList.contains('is-agenda-dragging') || row.classList.contains('agenda-longpress-armed')){
      e.preventDefault();e.stopPropagation();return;
    }
    if(e.target.closest('.pulse-btn'))return;
    const clickNow = performance.now();
    const previousClick = Number(card.dataset.lastClickAt || 0);
    if(previousClick && clickNow-previousClick < 80){
      e.preventDefault();e.stopPropagation();return;
    }
    card.dataset.lastClickAt = String(clickNow);
    if(swipeOpenCard){closeAllSwipes();return;}
    handleCardActivate(realIdx,card,()=>openDetail(realIdx));
  });
}

// HANDLER: shared tap vs double-tap timing. key identifies the thing tapped
// (a habit index, or a "from|to" pair for a travel leg) so a quick tap on one
// card followed by a tap on another never reads as a double tap.
function handleDoubleTapActivate(key,singleAction,doubleAction){
  const now = Date.now();
  if(lastTap.idx === key && now - lastTap.time < TAP_DELAY){
    clearTimeout(tapTimer);
    lastTap = {idx:-1,time:0};
    doubleAction();
    return;
  }
  lastTap = {idx:key,time:now};
  clearTimeout(tapTimer);
  tapTimer = setTimeout(singleAction,TAP_DELAY);
}

// HANDLER: distinguish tap (open detail / log) from double-tap, which logs the
// item and launches whatever it points at — the call, the meeting room, the link.
function handleCardActivate(realIdx,card,singleAction){
  handleDoubleTapActivate(realIdx,singleAction,()=>{
    quickLog(realIdx,card);
    launchPrimaryHabitLink(realIdx);
  });
}

// HANDLER: open a habit's primary link. Runs inside the tap that logged it, so
// the gesture is still live for the popup blocker.
function launchPrimaryHabitLink(realIdx){
  const h = load()[realIdx];
  const link = typeof habitPrimaryLink === 'function' ? habitPrimaryLink(h) : null;
  if(!link)return false;
  return typeof openHabitLink === 'function' ? openHabitLink(link) : false;
}

// PURE: short item name for compact toast messages
function toastItemName(h){
  const name = (h?.name || '').trim();
  if(!name)return 'item';
  return name.length > 28 ? `${name.slice(0,27)}...` : name;
}

// PURE: secondary toast action for entry changes. Stop habits never get a
// plan-related action — they cannot be planned, only logged.
function entryToastAction(action){
  if(!action || action.type !== 'entry' || !Number.isInteger(action.idx))return null;
  if(load()[action.idx]?.type === 'zero')return null;
  if(action.consumedPlanTs)return {type:'keep-plan',label:'keep plan'};
  if(action.plan){
    if(dateKey(action.ts) <= todayIso())return {type:'complete-plan',label:'done now'};
    return null;
  }
  if(dateKey(action.ts) === todayIso())return {type:'plan-instead',label:'plan instead'};
  return {type:'plan-today',label:'plan today'};
}

// PURE: annotates action state with the contextual toast action
function withEntryToastAction(action){
  const toastAction = entryToastAction(action);
  if(toastAction){
    action.toastAction = toastAction.type;
    action.toastActionLabel = toastAction.label;
  }
  return action;
}

// PURE: finds an exact actual/planned log entry
function findEntryByKind(logs,ts,plan){
  return logs.findIndex(log=>logTime(log) === ts && isPlanLog(log) === Boolean(plan));
}

// PURE: picks the plan that should be consumed by a real entry on the same day.
function planToConsumeForEntry(logs,entryTs){
  const key = dateKey(entryTs);
  const planned = normalizeLogs(logs)
    .filter(log=>isPlanLog(log) && dateKey(logTime(log)) === key)
    .map(logTime);
  if(!planned.length)return null;
  return planned.sort((a,b)=>Math.abs(a - entryTs) - Math.abs(b - entryTs))[0];
}

// HYBRID: replace an actual entry with a plan, or a plan with an actual entry.
function replaceEntryKind(idx,fromTs,fromPlan,toTs,toPlan,label){
  const data = load();
  if(!data[idx])return false;
  // Never turn a stop habit's entry into a plan — stop habits aren't plannable.
  if(toPlan && data[idx].type === 'zero')return false;
  const logs = normalizeLogs(data[idx].logs);
  const pos = findEntryByKind(logs,fromTs,fromPlan);
  if(pos < 0)return false;
  const snoozedUntilBefore = data[idx].snoozedUntil || null;
  logs.splice(pos,1);
  logs.push(toPlan ? {ts:toTs,plan:true} : toTs);
  data[idx].logs = normalizeLogs(logs);
  data[idx].lastLog = latestActualLog(data[idx].logs);
  if(!toPlan)data[idx].snoozedUntil = null;
  else if(!fromPlan && pendingAction?.snoozedUntil !== undefined)data[idx].snoozedUntil = pendingAction.snoozedUntil;
  const snoozedUntilAfter = data[idx].snoozedUntil || null;
  if(!save(data))return false;
  showActionToast(label,{
    type:'replace-entry',
    idx,
    fromTs,
    fromPlan:Boolean(fromPlan),
    toTs,
    toPlan:Boolean(toPlan),
    snoozedUntilBefore,
    snoozedUntilAfter,
    openAction:false
  });
  refreshOpenViews();
  return true;
}

// HYBRID: log entry and show undo. opts: {value, minutes, note} for numeric / chunk / note logs.
function logTing(i,opts = {}){
  const data = load();
  const now = Date.now();
  if(!data[i])return false;
  const h = data[i];
  const logs = normalizeLogs(h.logs);
  const consumedPlanTs = planToConsumeForEntry(logs,now);
  let minutes = opts.minutes;
  if(minutes == null && h.breakable && !isAutoMark(h)){
    // Suggested chunk only — never the full remaining day on a bare tap.
    const next = typeof suggestedBreakableLogMinutes === 'function'
      ? suggestedBreakableLogMinutes(h,null)
      : null;
    if(next)minutes = next;
  }
  // Snap the stored ts to the habit's window-start for the log's day so a
  // habit logged late still counts as "done today" by rhythm math the next
  // time its window opens. See snapLogTimestamp in data.js.
  const entryTs = (typeof snapLogTimestamp === 'function') ? snapLogTimestamp(h,now) : now;
  const entry = makeActualLog(entryTs,{value:opts.value,minutes,note:opts.note});
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts:entryTs,
    plan:false,
    consumedPlanTs,
    snoozedUntil:h.snoozedUntil || null,
    entry
  });
  if(consumedPlanTs !== null){
    const pos = findEntryByKind(logs,consumedPlanTs,true);
    if(pos >= 0)logs.splice(pos,1);
  }
  h.logs = normalizeLogs([...logs,entry]);
  h.lastLog = latestActualLog(h.logs);
  h.snoozedUntil = null;
  if(typeof clearPlanByDateOnLog === 'function')clearPlanByDateOnLog(h);
  if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(h);
  if(!save(data))return false;
  // Cancel any scheduled push for this completed task.
  if(typeof cancelPush === 'function' && h.type === 'task' && isTaskDone(h)){
    cancelPush(reminderSignature(h));
  }
  // Toast shows minutes + one detail (note preferred over value) so it never
  // overflows; the full value+note history lives in the activity sheet.
  const detail = (()=>{
    const parts = [];
    if(minutes)parts.push(`${minutes}m`);
    const noteStr = String(opts.note || '').trim();
    if(noteStr)parts.push(noteStr.slice(0,32));
    else if(opts.value != null && Number.isFinite(Number(opts.value)))parts.push(`${opts.value}`);
    return parts.length ? ` · ${parts.join(' · ')}` : '';
  })();
  showActionToast(`Logged ${toastItemName(h)}${detail}`,action);
  // If a session timer was open for this habit, drop it — the entry already
  // covers the session and a later stop must not prompt a second log.
  if(typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === i
    && typeof clearHabitTimerSilent === 'function'){
    clearHabitTimerSilent();
  }
  return true;
}

// HYBRID: log entry at timestamp, show undo
function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
  // Calendar day logs are for today and past days only — future days use plans.
  if(dateKey(ts) > todayIso())return false;
  const entryTs = dateKey(ts) <= dateKey(Date.now()) && ts > Date.now() ? Date.now() : ts;
  const log = makeLog(entryTs);
  const isPlan = isPlanLog(log);
  const logs = normalizeLogs(data[i].logs);
  const consumedPlanTs = isPlan ? null : planToConsumeForEntry(logs,entryTs);
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts:entryTs,
    plan:isPlan,
    consumedPlanTs,
    snoozedUntil:data[i].snoozedUntil || null
  });
  if(consumedPlanTs !== null){
    const pos = findEntryByKind(logs,consumedPlanTs,true);
    if(pos >= 0)logs.splice(pos,1);
  }
  data[i].logs = normalizeLogs([...logs,log]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!isPlan){
    data[i].snoozedUntil = null;
    if(typeof clearPlanByDateOnLog === 'function')clearPlanByDateOnLog(data[i]);
    if(typeof pruneOrderConstraintsOnLog === 'function')pruneOrderConstraintsOnLog(data[i]);
  }
  if(!save(data))return false;
  showActionToast(`${isPlan ? 'Planned' : 'Logged'} ${toastItemName(data[i])}`,action);
  // Calendar day log counts as completing the session — drop any open timer.
  if(!isPlan && typeof habitTimer !== 'undefined' && habitTimer && habitTimer.idx === i
    && typeof clearHabitTimerSilent === 'function'){
    clearHabitTimerSilent();
  }
  return true;
}

// HYBRID: add a planned entry for a specific date, optionally with a hard
// clock time and/or one-day location. Empty time → day pin only (noon ts,
// no timed flag). Set time → hard agenda appointment at that clock.
function planTingOnDay(i,key,timeValue = '',options = {}){
  const data = load();
  if(!data[i])return false;
  // Stop habits ("quit" type) cannot be planned — there is no future session
  // to schedule, only lapses to log. Bail before creating any plan log.
  if(data[i].type === 'zero')return false;
  // Plans are only for today and future days.
  if(!key || key < todayIso())return false;
  const base = new Date(`${key}T12:00:00`);
  if(Number.isNaN(base.getTime()))return false;
  let hours = 12;
  let minutes = 0;
  const time = timeInputToMinutes(timeValue);
  const timed = time !== null;
  if(timed){
    hours = Math.floor(time / 60);
    minutes = time % 60;
  }
  const ts = new Date(base.getFullYear(),base.getMonth(),base.getDate(),hours,minutes,0,0).getTime();
  const locationId = options.locationId != null ? String(options.locationId).trim() : '';
  const planEntry = makePlanLog(ts,{timed,locationId:locationId || null});
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts,
    plan:true,
    snoozedUntil:data[i].snoozedUntil || null,
    openAction:options.openAction
  });
  data[i].logs = normalizeLogs([...(data[i].logs || []),planEntry]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!save(data))return false;
  const timeLabel = timed ? ` · ${new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}` : '';
  const locName = locationId && typeof normalizeLocationRegistry === 'function'
    ? (normalizeLocationRegistry(sortSettings?.locations).find(l=>l.id === locationId)?.name || '')
    : '';
  const locLabel = locName ? ` · ${locName}` : '';
  showActionToast(`Planned ${toastItemName(data[i])}${timeLabel}${locLabel}`,action);
  return true;
}

// HYBRID: run the contextual secondary action shown in the action toast.
function runPendingAction(){
  if(!pendingAction || !Number.isInteger(pendingAction.idx))return;
  const action = pendingAction.toastAction;
  if(action === 'plan-instead'){
    replaceEntryKind(
      pendingAction.idx,
      pendingAction.ts,
      false,
      pendingAction.ts,
      true,
      'Planned instead'
    );
    return;
  }
  if(action === 'plan-today'){
    if(planTingOnDay(pendingAction.idx,todayIso()))refreshOpenViews();
    return;
  }
  if(action === 'complete-plan'){
    replaceEntryKind(
      pendingAction.idx,
      pendingAction.ts,
      true,
      Date.now(),
      false,
      'Marked done'
    );
    return;
  }
  if(action === 'keep-plan'){
    const data = load();
    const idx = pendingAction.idx;
    if(!data[idx] || !pendingAction.consumedPlanTs)return;
    data[idx].logs = normalizeLogs([...(data[idx].logs || []),{ts:pendingAction.consumedPlanTs,plan:true}]);
    data[idx].lastLog = latestActualLog(data[idx].logs);
    if(save(data)){
      showActionToast('Plan kept',{type:'entry',idx,ts:pendingAction.consumedPlanTs,plan:true,snoozedUntil:data[idx].snoozedUntil || null,openAction:false});
      refreshOpenViews();
    }
  }
}

// HANDLER: splice entry from habit logs
function removeEntryAt(i,ts,planOnly = false){
  const data = load();
  if(!data[i])return false;
  const logs = normalizeLogs(data[i].logs);
  const pos = logs.findIndex(log=>sameLog(log,ts,planOnly));
  if(pos < 0)return false;
  logs.splice(pos,1);
  data[i].logs = logs;
  data[i].lastLog = latestActualLog(logs);
  return save(data);
}

// HYBRID: remove all planned entries for one item/day with a single undo.
function removePlansOnDay(idx,key){
  const data = load();
  const h = data[idx];
  if(!h)return false;
  const logs = normalizeLogs(h.logs);
  const removed = [];
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === key){
      removed.push(makePlanLog(logTime(log),{
        timed:planTimed(log),
        locationId:planLocationId(log)
      }));
      return false;
    }
    return true;
  });
  if(!removed.length)return false;
  h.logs = normalizeLogs(remaining);
  h.lastLog = latestActualLog(h.logs);
  if(!save(data))return false;
  const label = removed.length === 1 ? `Removed plan · ${toastItemName(h)}` : `Removed ${removed.length} plans · ${toastItemName(h)}`;
  showActionToast(label,{type:'remove-plans',idx,key,removed,openAction:false,undoLabel:'restore'});
  refreshOpenViews();
  return true;
}

// HYBRID: move all of a habit's planned entries on fromKey to toKey (preserving
// each entry's time of day), single save + single undo. The compound undo
// reverts both halves so the existing toast covers the whole move cleanly.
function movePlanTo(idx,fromKey,toKey){
  const data = load();
  const h = data[idx];
  if(!h || fromKey === toKey)return;
  // Plans can only move onto today or a future day.
  if(!toKey || toKey < todayIso())return;
  const logs = normalizeLogs(h.logs);
  const moved = [];
  const newDay = new Date(`${toKey}T00:00:00`);
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === fromKey){
      const old = new Date(logTime(log));
      const nt = new Date(newDay.getFullYear(),newDay.getMonth(),newDay.getDate(),old.getHours(),old.getMinutes(),0,0).getTime();
      moved.push({
        oldTs:logTime(log),
        newTs:nt,
        timed:planTimed(log),
        locationId:planLocationId(log)
      });
      return false;
    }
    return true;
  });
  if(!moved.length)return;
  moved.forEach(m=>remaining.push(makePlanLog(m.newTs,{timed:m.timed,locationId:m.locationId})));
  data[idx].logs = normalizeLogs(remaining);
  data[idx].lastLog = latestActualLog(data[idx].logs);
  if(save(data)){
    showActionToast(`Moved ${toastItemName(h)}`,{type:'move',idx,moved,openAction:false,undoLabel:'move back'});
    refreshOpenViews();
  }
}

// HYBRID: revert last action and refresh
function executeUndo(){
  if(!pendingAction)return;
  const refreshBlockedPresentation = pendingAction.type === 'restore-blocked'
    || pendingAction.type === 'restore-block-adjust';
  const data = load();
  if(pendingAction.type === 'entry'){
    const {idx,ts,snoozedUntil,consumedPlanTs} = pendingAction;
    if(!data[idx])return;
    const logs = normalizeLogs(data[idx].logs);
    const pos = findEntryByKind(logs,ts,Boolean(pendingAction.plan));
    if(pos >= 0)logs.splice(pos,1);
    if(consumedPlanTs)logs.push({ts:consumedPlanTs,plan:true});
    data[idx].logs = logs;
    data[idx].lastLog = latestActualLog(logs);
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingAction.type === 'hide'){
    const {idx,snoozedUntil} = pendingAction;
    if(!data[idx])return;
    data[idx].snoozedUntil = snoozedUntil;
  }
  if(pendingAction.type === 'delete'){
    const {idx,habit} = pendingAction;
    data.splice(Math.min(idx,data.length),0,habit);
  }
  if(pendingAction.type === 'move'){
    const {idx,moved} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      const newSet = new Set(moved.map(m=>m.newTs));
      const filtered = logs.filter(log=>!newSet.has(logTime(log)));
      moved.forEach(m=>filtered.push(makePlanLog(m.oldTs,{
        timed:Boolean(m.timed),
        locationId:m.locationId || null
      })));
      data[idx].logs = normalizeLogs(filtered);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(pendingAction.type === 'remove-plans'){
    const {idx,removed} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      removed.forEach(entry=>{
        if(entry && typeof entry === 'object' && entry.plan)logs.push(entry);
        else logs.push(makePlanLog(entry));
      });
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(pendingAction.type === 'replace-entry'){
    const {idx,fromTs,fromPlan,toTs,toPlan,snoozedUntilBefore} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      const pos = findEntryByKind(logs,toTs,toPlan);
      if(pos >= 0)logs.splice(pos,1);
      logs.push(fromPlan ? {ts:fromTs,plan:true} : fromTs);
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
      data[idx].snoozedUntil = snoozedUntilBefore;
    }
  }
  if(pendingAction.type === 'breakable-set'){
    const {idx,logs,snoozedUntil} = pendingAction;
    if(data[idx]){
      data[idx].logs = normalizeLogs(logs);
      data[idx].lastLog = latestActualLog(data[idx].logs);
      data[idx].snoozedUntil = snoozedUntil;
    }
  }
  if(pendingAction.type === 'restore-blocked'){
    lockBlockedCardActivation();
    const {dayKey,label,startMin,endMin,freedMin} = pendingAction;
    if(typeof restoreBlockedInstance === 'function')restoreBlockedInstance(dayKey,label,startMin,endMin);
    const s = loadSortSettings();
    const overrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
    if(Object.prototype.hasOwnProperty.call(overrides,dayKey)){
      // Reuse the same wraparound math as cancelHomeBlockedRow so overnight
      // blocks restore the exact minutes that were freed (not end−start < 0).
      const back = freedMin != null && Number.isFinite(freedMin)
        ? freedMin
        : (typeof blockDurationMinutes === 'function'
          ? blockDurationMinutes(startMin,endMin)
          : (endMin > startMin ? endMin - startMin : (1440 - startMin) + endMin));
      const restored = overrides[dayKey] - back;
      if(restored > 0)overrides[dayKey] = restored;
      else delete overrides[dayKey];
      saveSortSettings({...s,availabilityOverrides:overrides});
    }
  }
  if(pendingAction.type === 'restore-block-adjust'){
    lockBlockedCardActivation();
    const {dayKey,signature,previousOverride,hadAvailability,previousAvailability} = pendingAction;
    const s = loadSortSettings();
    const blockOverrides = normalizeBlockedTimeOverrides(s.blockedTimeOverrides);
    const day = {...(blockOverrides[dayKey] || {})};
    if(previousOverride)day[signature] = previousOverride;
    else delete day[signature];
    if(Object.keys(day).length)blockOverrides[dayKey] = day;
    else delete blockOverrides[dayKey];
    const availabilityOverrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
    if(hadAvailability)availabilityOverrides[dayKey] = previousAvailability;
    else delete availabilityOverrides[dayKey];
    saveSortSettings({...s,blockedTimeOverrides:blockOverrides,availabilityOverrides});
  }
  if(pendingAction.type === 'add-samples'){
    const hids = new Set((pendingAction.hids || []).filter(Boolean));
    for(let i = data.length - 1; i >= 0; i--){
      if(hids.has(data[i].hid))data.splice(i,1);
    }
    if(typeof pruneUnusedSamplePlaces === 'function'){
      const pruned = pruneUnusedSamplePlaces(data);
      data.length = 0;
      data.push(...pruned);
    }
  }
  if(save(data)){
    // Block undo changes only presentation/capacity immediately. Repaint those
    // rows from the mounted exact week before queueing the replacement solve,
    // mirroring cancelHomeBlockedRow and avoiding a stale missing/editable row.
    if(refreshBlockedPresentation && typeof renderHomePresentationOnly === 'function'){
      renderHomePresentationOnly();
    }
    hideActionToast();
    showToast('undone');
    if(typeof updateSortSampleCount === 'function')updateSortSampleCount();
    if(typeof refreshSampleHabitsSheet === 'function')refreshSampleHabitsSheet();
    refreshOpenViews();
  }
}

/**
 * HYBRID: set absolute breakable progress. Forward movement appends a minute
 * log; backward movement consolidates minute logs in the relevant scope while
 * preserving plans and non-minute entries.
 * Returns true when a log was saved.
 */
function commitBreakableProgress(i,targetMinutes,dayBase){
  const data = load();
  if(!data[i] || !data[i].breakable)return false;
  const h = data[i];
  const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h,dayBase) : 0;
  const total = typeof breakableTotalMinutes === 'function' ? breakableTotalMinutes(h) : clampDuration(h.durationMinutes);
  let target = Math.round(Number(targetMinutes));
  if(!Number.isFinite(target))target = done;
  target = Math.max(0,Math.min(total,target));
  if(target === done)return false;

  if(target > done){
    const delta = typeof breakableSliderDeltaMinutes === 'function'
      ? breakableSliderDeltaMinutes(h,target,dayBase)
      : (target - done);
    if(delta > 0)return logTing(i,{ minutes:delta });
    return false;
  }

  const logsBefore = normalizeLogs(h.logs);
  const snoozedUntil = h.snoozedUntil || null;
  const result = rewriteBreakableProgress(h,target,dayBase);
  if(result.mode !== 'set' || !save(data))return false;
  showActionToast(`Set ${toastItemName(h)} · ${target}m`,{
    type:'breakable-set',idx:i,logs:logsBefore,snoozedUntil,openAction:false
  });
  return true;
}

// PURE: read the pending target from a card, or compute its untouched quick-log
// advance. The agenda chunk is only used when it is a true partial placement.
function breakableCardIntent(h,card){
  const row = card && card.closest ? card.closest('.swipe-row') : null;
  const dirty = row && row.dataset.progressDirty === '1';
  const done = typeof breakableProgressMinutes === 'function' ? breakableProgressMinutes(h) : 0;
  const total = typeof breakableTotalMinutes === 'function' ? breakableTotalMinutes(h) : clampDuration(h.durationMinutes);
  let target = dirty && row ? Math.round(Number(row.dataset.progressTarget)) : done;
  if(!Number.isFinite(target))target = done;
  target = Math.max(0,Math.min(total,target));
  const chunk = row && row.dataset.chunkMinutes != null && row.dataset.chunkMinutes !== ''
    ? Math.round(Number(row.dataset.chunkMinutes))
    : null;
  const suggested = typeof suggestedBreakableLogMinutes === 'function'
    ? suggestedBreakableLogMinutes(h,chunk)
    : 0;
  return {row,dirty:dirty && target !== done,done,target,suggested};
}

/** HYBRID: commit a card's pending target, or advance by its quick-log amount. */
function commitBreakableFromCard(i,card){
  const h = load()[i];
  if(!h || !h.breakable)return false;
  const intent = breakableCardIntent(h,card);
  if(intent.dirty){
    if(intent.target <= intent.done){
      showToast('already done');
      return false;
    }
    return commitBreakableProgress(i,intent.target);
  }
  const suggested = typeof suggestedBreakableLogMinutes === 'function'
    ? intent.suggested
    : 0;
  if(!suggested || suggested <= 0){
    showToast('already done');
    return false;
  }
  return commitBreakableProgress(i,intent.done + suggested);
}

// HYBRID: log entry and flash card
function quickLog(i,card){
  const go = ()=>{
    if(card){
      card.classList.add('logged');
      setTimeout(()=>card.classList.remove('logged'),380);
    }
    setTimeout(refreshOpenViews, 260);
  };
  const data = load();
  const h = data[i];
  if(h && h.breakable){
    if(h.trackValue && typeof requestLogTing === 'function'){
      const intent = breakableCardIntent(h,card);
      if(intent.dirty && intent.target <= intent.done){
        showToast('already done');
        return;
      }
      const minutes = intent.dirty ? intent.target - intent.done : intent.suggested;
      if(!minutes || minutes <= 0){
        showToast('already done');
        return;
      }
      requestLogTing(i,go,{ minutes });
      return;
    }
    if(!commitBreakableFromCard(i,card))return;
    go();
    return;
  }
  if(typeof requestLogTing === 'function'){
    requestLogTing(i,go);
    return;
  }
  if(!logTing(i))return;
  go();
}

// PURE: compute next plan timestamp
function nextPlanTime(h){
  const base = h.lastLog || Date.now();
  const target = h.target || 7;
  let d = new Date(base + target * 86400000);
  d = new Date(d.getFullYear(),d.getMonth(),d.getDate(),12,0,0,0);
  if(d.getTime() <= Date.now()){
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    d = new Date(tomorrow.getFullYear(),tomorrow.getMonth(),tomorrow.getDate(),12,0,0,0);
  }
  return d.getTime();
}

// PURE: format next plan date label
function nextPlanLabel(h){
  return new Date(nextPlanTime(h)).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}

// HYBRID: schedule next plan entry
function planNext(i){
  const h = load()[i];
  if(!h || h.type === 'zero')return;
  const ts = nextPlanTime(h);
  if(logTingAt(i,ts))refreshOpenViews();
}

// HYBRID: toggle pin and re-render
function togglePin(i){
  const data = load();
  if(!data[i])return;
  data[i].pinned = !data[i].pinned;
  if(save(data)){
    showToast(data[i].pinned ? 'pinned' : 'unpinned');
    render();
  }
}
