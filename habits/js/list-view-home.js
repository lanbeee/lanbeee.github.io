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
  return locationsForDisplay((sortSettings || loadSortSettings()).locations);
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
// another. A container may opt into only one row with data-tag-content so the
// detail sheet can keep schedule places separate from identity topics.
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
  applyTagChipLocationMode(wrap,selectedLocs);
  const content = wrap.dataset.tagContent;
  if(content === 'places')topicRow.hidden = true;
  if(content === 'topics')locRow.hidden = true;
  // Restore horizontal scroll position saved before rebuild.
  locRow.scrollLeft = prevPlaceScroll;
  topicRow.scrollLeft = prevTopicScroll;
  // Setting scrollLeft fires an async scroll event that arms the scroll guard,
  // which would swallow the next click within 500ms. Disarm on the next tick
  // (the scroll event is queued before this timeout so it fires first).
  setTimeout(() => { locRow._sg = 0; topicRow._sg = 0; }, 0);
}

// RENDER: allowed view edits which places are valid for the general time
// window. Preferred view ranks those places. Specific option rows carry their
// own place and optional preference.
function applyTagChipLocationMode(wrap,selectedLocIds = selectedLocationIdsFrom(wrap && wrap.id)){
  if(!wrap)return;
  const preferenceOnly = wrap.dataset.locationChoiceMode === 'preference';
  const selected = new Set(normalizeLocationIds(selectedLocIds));
  const add = wrap.querySelector('[data-location-add]');
  const anywhere = wrap.querySelector('[data-anywhere]');
  if(add)add.hidden = preferenceOnly;
  if(anywhere)anywhere.hidden = preferenceOnly;
  wrap.querySelectorAll('.location-chip[data-location-id]').forEach(btn=>{
    btn.hidden = preferenceOnly && !selected.has(btn.dataset.locationId);
  });
  const placeRow = wrap.querySelector('.tag-row-places');
  if(placeRow)placeRow.hidden = preferenceOnly && selected.size === 0;
}

// HANDLER: toggle a location chip — off → on → little → high → avoid → off
function toggleLocationChip(e){
  const btn = e.target.closest('.location-chip[data-location-id]');
  if(!btn)return;
  const wrap = btn.closest('.topic-chip-row');
  if(!wrap)return;
  const level = btn.dataset.pref || '';
  const isOn = btn.classList.contains('on');
  const preferenceOnly = wrap.dataset.locationChoiceMode === 'preference';
  const allowedOnly = wrap.dataset.locationChoiceMode === 'allowed';
  if(preferenceOnly){
    btn.classList.add('on');
    btn.dataset.pref = level === '' ? 'little'
      : level === 'little' ? 'high'
      : level === 'high' ? 'avoid'
      : '';
  }else if(allowedOnly){
    btn.classList.toggle('on',!isOn);
    btn.dataset.pref = '';
  }else if(!isOn){
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
  if(wrap.id === 'detail-place-chips')setDetailDirty();
}

// PURE: resolve the place a home/agenda card is treated as being at.
function cardLocationId(h,agendaRow){
  if(agendaRow && agendaRow.locationId)return agendaRow.locationId;
  const registry = locationOptions();
  const ids = typeof habitDisplayLocationIds === 'function'
    ? habitDisplayLocationIds(h,registry)
    : normalizeLocationIds(h && h.locationIds,registry);
  if(!ids.length)return null;
  return pickHabitLocationId(h,null,registry,normalizeTravelMode((sortSettings || {}).defaultTravelMode)) || ids[0];
}

// PURE: shared topic/place filter choice lists used by home and calendar.

function topicFilterChoices(data){
  const topics = normalizeTopics([...topicOptions(),...data.flatMap(h=>normalizeTopics(h.topics))]);
  const hasNoTopic = data.some(h=>!normalizeTopics(h.topics).length);
  return [{key:'all',label:'all'},...topics.map(topic=>({key:topic,label:topic})),...(hasNoTopic ? [{key:'__none__',label:'no topic'}] : [])];
}

function matchesTopicFilter(h,topic){
  if(!topic || topic === 'all')return true;
  const topics = normalizeTopics(h.topics);
  if(topic === '__none__')return !topics.length;
  return topics.some(item=>item.toLowerCase() === topic.toLowerCase());
}

function locationFilterChoices(data,{treatAnywhere = false} = {}){
  const registry = locationOptions();
  const used = new Set(data.flatMap(h=>normalizeLocationIds(h.locationIds,registry)));
  const locs = registry.filter(loc=>used.has(loc.id));
  const hasNone = data.some(h=>(treatAnywhere && h.anywhereAllowed) || !normalizeLocationIds(h.locationIds,registry).length);
  return [
    {key:'all',label:'all places'},
    ...locs.map(loc=>({key:loc.id,label:loc.name})),
    ...(hasNone ? [{key:'__none__',label:'anywhere'}] : [])
  ];
}

function matchesLocationFilter(h,id,{treatAnywhere = false} = {}){
  if(!id || id === 'all')return true;
  const ids = normalizeLocationIds(h.locationIds);
  if(id === '__none__')return (treatAnywhere && Boolean(h.anywhereAllowed)) || !ids.length;
  return ids.includes(id);
}

function homeLocationChoices(data){
  return locationFilterChoices(data,{treatAnywhere:true});
}

function matchesHomeLocation(h,id){
  return matchesLocationFilter(h,id,{treatAnywhere:true});
}

// HYBRID: compact home context bar + the full on-demand filter sheet. The bar
// only exposes current presence and active filters, so a large topic/location
// library never turns the top of Home into an endless horizontal chip rail.
// `precomputedIndices` (optional): render() shares its visibleIndices() pass —
// the option counts don't depend on the search query, so don't re-sort for them.
function renderHomeTagFilter(data,precomputedIndices = null){
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
      <span class="presence-copy"><small>Current Place</small><b>${escapeHtml(label)}</b></span>
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
  const baseIndices = precomputedIndices || visibleIndices(data,sortSettings);
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
    if(containerId === 'detail-topic-chips')setDetailDirty();
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
  if(btn.closest('#detail-topic-chips'))setDetailDirty();
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
      ? normalizeTopics([...selectedTopicsFrom('detail-topic-chips'),topic])
      : currentDetailTune().topics;
    renderTagChips('detail-topic-chips',detailSelected,[]);
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
    renderTagChips('detail-topic-chips',tune.topics,[]);
  }
  if(typeof homeTopicFilter !== 'undefined' && homeTopicFilter !== 'all' && homeTopicFilter.toLowerCase() === key){
    homeTopicFilter = 'all';
  }
  refreshOpenViews();
}

// PURE: compute home topic filter choices
function homeTopicChoices(data){
  return topicFilterChoices(data);
}

function matchesHomeTopic(h,topic){
  return matchesTopicFilter(h,topic);
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
  // The field must live in the active tier's wrapper before any chrome sync —
  // a missed tierchange otherwise opens an empty pill that cannot take focus
  // (the "search mode but nothing to type, no keyboard" failure).
  if(typeof reparentSearch === 'function')reparentSearch();
  const wide = paneTierActive();
  // One tier owns the open state; strip classes the other tier left behind.
  if(wide && nav)nav.classList.remove('search-open');
  const barSearchWrap = $('app-bar-search');
  if(!wide && barSearchWrap)barSearchWrap.classList.remove('is-open');
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
  // Put the field in the tier-correct wrapper FIRST: focus() silently no-ops
  // on an input inside a display:none wrapper, which reads to the user as
  // "search opened but there is nothing to type and no keyboard".
  if(typeof reparentSearch === 'function')reparentSearch();
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
      // The render below can churn the DOM; re-guarantee the field's home
      // before each retry or the retry itself focuses a hidden input.
      if(typeof reparentSearch === 'function')reparentSearch();
      if(document.activeElement !== input)input.focus({preventScroll:true});
      updateKeyboardLift();
      keepFocusedInputVisible();
    });
    setTimeout(()=>{
      if(!isSearchOpen())return; // user already closed — don't steal focus back
      if(typeof reparentSearch === 'function')reparentSearch();
      if(document.activeElement !== input)input.focus({preventScroll:true});
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

// PURE: whole-calendar-day rhythm boundary for cue copy. Fractional rhythms
// (3×/2d → 0.67d) would otherwise print floats ("Due in 0.666666666 days").
// Ceil matches the planner's `days >= target` day eligibility: the first due
// calendar day is ceil(target), so cues never disagree with the agenda.
function cueDayBoundary(target){
  return Math.max(1,Math.ceil(Number(target) || 7));
}

// PURE: compute keep-up cue text
function buildCue(h,days,target){
  if(days === null)return 'Ready for first entry';
  if(days < 0)return 'Coming up';
  const remaining = cueDayBoundary(target) - days;
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
  const remaining = cueDayBoundary(target) - days;
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
  let win = typeof fillTimeWindow === 'function' ? fillTimeWindow(h,dayBase) : null;
  if(typeof hasHabitScheduleOptions === 'function' && hasHabitScheduleOptions(h)
    && typeof fillDayWindows === 'function'){
    const windows = fillDayWindows(h,dayBase) || [];
    win = windows.find(item=>row.start >= item.start && row.start < item.end)
      || windows.find(item=>item.start >= row.start)
      || null;
  }
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

// PURE: compact forecast status. Tapping it explains the decision without
// adding a permanent weather strip to home.
function weatherCardPill(row,h = null){
  if(!row || !h || !h.weatherProfileId || typeof weatherStatusForRow !== 'function')return '';
  const assessment = weatherStatusForRow(h,row,sortSettings || loadSortSettings());
  if(!assessment)return '';
  const status = assessment.status || 'unknown';
  const icon = typeof weatherConditionIcon === 'function' ? weatherConditionIcon(status) : 'ti-cloud';
  // The amber pill must say whether the weather is good or bad at a glance;
  // "weather" alone forced a tap to disambiguate caution from blocked.
  const label = status === 'good' ? 'good' : (status === 'override' ? 'override' : (status === 'unknown' ? 'weather?' : 'caution'));
  return `<button type="button" class="context-pill weather-pill ${status}" data-weather-info="${escapeHtml(assessment.summary)}" title="${escapeHtml(assessment.summary)}" aria-label="${escapeHtml(assessment.summary)}"><i class="ti ${icon}" aria-hidden="true"></i><span>${label}</span></button>`;
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
// via travelFromCurrent() (movement-thresholded cache). A live-GPS leg can't
// open the editor — an override anchored to an ephemeral coord would be stale
// on the next GPS tick — but its destination is a real saved place, so a tap
// opens directions from "here" in maps. Saved-place → saved-place legs keep
// tap-to-edit / double-tap-to-go.
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
  travelEl.innerHTML = `<span class="timeline-card-icon"><i class="ti ti-route" aria-hidden="true"></i></span><span class="timeline-card-copy"><b>${compactHomeDuration(mins)} travel</b><small>${depart}${escapeHtml(fromName)} → ${escapeHtml(toName)}</small></span>${edited ? '<i class="ti ti-pencil travel-edit-mark" aria-label="custom time"></i>' : ''}${fromCurrent ? '' : '<i class="ti ti-chevron-right timeline-card-chevron" aria-hidden="true"></i>'}`;
  list.appendChild(travelEl);
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
    const go = ()=>openTravelLegInMaps(toId);
    // Saved-place legs keep the fast double-tap shortcut to directions; a
    // single tap opens the editor with the tapped leg's live timing. A live-GPS
    // leg cannot be edited (its origin is ephemeral), so it opens directions.
    if(fromCurrent){
      handleDoubleTapActivate(`travel:${fromId}|${toId}`,go,go);
      return;
    }
    handleDoubleTapActivate(`travel:${fromId}|${toId}`,
      ()=>openTravelEditSheet(fromId,toId,startTs),go);
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
  let cancelPointer = null;
  if(xBtn)xBtn.addEventListener('pointerdown',e=>{
    cancelPointer = {id:e.pointerId,x:e.clientX,y:e.clientY};
    e.stopPropagation();
  },{passive:true});
  if(xBtn)xBtn.addEventListener('pointerup',e=>{
    if(!cancelPointer || cancelPointer.id !== e.pointerId)return;
    const tap = cancelPointer;cancelPointer = null;
    if(Math.hypot(e.clientX-tap.x,e.clientY-tap.y) > 8)return;
    e.preventDefault();
    e.stopPropagation();
    cancelHomeBlockedRow(row);
  });
  if(xBtn)xBtn.addEventListener('pointercancel',()=>{cancelPointer = null;},{passive:true});
  if(xBtn)xBtn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(!xBtn.isConnected)return;
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
    const weather = Math.round(Number(t.weatherPenalty) || 0);
    const order = Math.round(Number(t.orderPenalty) || 0);
    parts.push(`fit signals: travel ${travelMin}m, local delay ${delayMin}m, scarce overlap ${scarceMin}m, preference ${pref}, weather ${weather}, order ${order}`);
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
  push(report.criticalMissCount > 0
    ? `${report.criticalMissCount} critical placement miss${report.criticalMissCount === 1 ? '' : 'es'}`
    : report.missedOpportunityCount > 0
    ? `${report.missedOpportunityCount} usable gap${report.missedOpportunityCount === 1 ? '' : 's'} missed`
    : 'no unexplained placement gaps');
  push(report.criticalMissCount > 0
    ? 'due or linked work can be inserted today without moving any committed row'
    : report.missedOpportunityCount > 0
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
    'critical-miss':'CRITICAL MISS',
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

// PURE: resolve the week snapshot used for placement export. Cache only —
// never rebuild a week on the UI thread.
function weekSnapshotForExport(now = Date.now()){
  if(_homeRenderedWeek && Array.isArray(_homeRenderedWeek.days) && _homeRenderedWeek.days.length){
    return _homeRenderedWeek;
  }
  if(typeof cachedOverviewWeek === 'function'){
    try{
      const week = cachedOverviewWeek(typeof load === 'function' ? load() : []);
      if(week && Array.isArray(week.days) && week.days.length)return week;
    }catch(_){ /* fall through */ }
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

function renderDayCapacityScorecard(report){
  const content = $('day-capacity-content');
  if(!content || !report)return;
  const metric = (label,value,detail='',tone='')=>`
    <div class="capacity-metric${tone ? ` ${tone}` : ''}">
      <span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
    </div>`;
  const coverage = `${Math.round((Number(report.eligibleCoverage) || 0) * 100)}%`;
  const budgetUse = `${Math.round((Number(report.budgetUtilization) || 0) * 100)}%`;
  const auditHeadline = report.criticalMissCount > 0
    ? `${report.criticalMissCount} critical placement miss${report.criticalMissCount === 1 ? '' : 'es'}`
    : report.missedOpportunityCount > 0
    ? `${report.missedOpportunityCount} usable gap${report.missedOpportunityCount === 1 ? '' : 's'} missed`
    : 'no unexplained placement gaps';
  const auditDetail = report.criticalMissCount > 0
    ? 'due or linked work can be inserted today without moving any committed row'
    : report.missedOpportunityCount > 0
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
        'critical-miss':'critical miss',
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

// STICKY TONE: darken a section header a touch while it is pinned at the
// viewport top (`.section-header.stuck` in styles.css) so the stuck label
// reads as attached to the viewport, not the page. Scroll events don't
// bubble but they do capture, so one document-level capture listener covers
// window and pane scrolling alike; rAF keeps the rect reads cheap.
