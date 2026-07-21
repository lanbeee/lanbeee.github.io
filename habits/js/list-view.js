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
function renderTagChips(containerId,selectedTopics = [],selectedLocIds = [],preferredLocId = null,locationPrefs = null){
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
  const anywhereOn = selectedLocs.length === 0;
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
  renderTagChips(wrap.id,selectedTopicsFrom(wrap.id),selected,null,prefs);
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
  const hasNone = data.some(h=>!normalizeLocationIds(h.locationIds,registry).length);
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
  if(id === '__none__')return !ids.length;
  return ids.includes(id);
}

// HYBRID: one home filter row — presence status, then places, then topics.
// Each group only renders when at least one habit actually uses that
// dimension — otherwise the row would just show redundant "all/no" chips.
function renderHomeTagFilter(data){
  const wrap = $('home-tag-filter');
  if(!wrap)return;
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
    statusHtml = `<button type="button" class="topic-filter presence-filter ${kind} ${gpsClass}" data-home-presence="1" title="set agenda starting place"><i class="ti ti-current-location" aria-hidden="true"></i>${escapeHtml(label)}</button>`;
  }
  const locHtml = hasLocs ? locChoices.map(choice=>`
    <button type="button" class="topic-filter location-filter ${choice.key === homeLocationFilter ? 'on' : ''}" data-home-location="${escapeHtml(choice.key)}"><i class="ti ti-map-pin" aria-hidden="true"></i>${escapeHtml(choice.label)}</button>
  `).join('') : '';
  const topicHtml = hasTopics ? topicChoices.map(choice=>`
    <button type="button" class="topic-filter ${choice.key === homeTopicFilter ? 'on' : ''}" data-home-topic="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>
  `).join('') : '';
  wrap.innerHTML = statusHtml + locHtml + topicHtml;
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

// PURE: get next planned log entry
function nextPlannedLog(h){
  return plannedLogs(h.logs)[0] || null;
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
  if(days < 0)return 'Planned ahead';
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
  if(days <= target * 0.5)return 'Steady rhythm';
  return `${remaining} days left`;
}

// PURE: compute reduce cue text
function limitCue(h,days,target){
  if(days === null)return 'No entries yet';
  if(days < 0)return 'Planned ahead';
  const remaining = target - days;
  if(remaining > 1)return `Wait ${remaining} days`;
  if(remaining === 1)return 'Wait 1 more day';
  if(remaining === 0)return 'Okay today';
  return 'Enough space';
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
      if(left < 0)return `Plan by ${Math.abs(left)}d overdue`;
      if(left === 0)return 'Plan by today';
      if(left === 1)return 'Plan by tomorrow';
      if(left <= 7)return `Plan by in ${left}d`;
      return `Plan by ${new Date(planBy).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`;
    }
  }
  if(days === null){
    if(h.type === 'zero')return 'Nothing logged';
    return 'Ready to start';
  }
  if(days < 0)return 'Coming up';
  if(h.type === 'keepup')return buildCue(h,days,target);
  if(h.type === 'reduce')return limitCue(h,days,target);
  if(days === 0)return 'Reset today';
  if(days === 1)return '1 day clear';
  if(days < 4)return `${days} days clear`;
  return `${days} days clear`;
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

// PURE: compute card tone class
function cardTone(h){
  if(h.snoozedUntil && Date.now() < h.snoozedUntil)return 'quiet';
  if(hasPlannedToday(h) && h.type !== 'zero')return 'plan';
  return scoreTone(progressScore(h));
}

// PURE: build card meta pills markup
function cardMeta(h,options = {}){
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
      parts.push(`<span class="context-pill due" title="${escapeHtml(`plan by ${entryWhen(planBy)}`)}"><i class="ti ti-flag" aria-hidden="true"></i>${escapeHtml(compactDueLabel(planBy,false))}</span>`);
    }else if(options.forceRepetition || sortSettings.showRepetitionOnCards){
      if(h.type !== 'zero')parts.push(`<span class="context-pill" title="target rhythm"><i class="ti ti-repeat" aria-hidden="true"></i>${formatRhythmLabel(h.target || 7)}</span>`);
      else parts.push('<span class="context-pill" title="avoid"><i class="ti ti-ban" aria-hidden="true"></i>stop</span>');
    }
  }
  if((options.forceDuration || sortSettings.showDurationOnCards) && h.durationMinutes)parts.push(`<span class="context-pill" title="duration"><i class="ti ti-clock" aria-hidden="true"></i>${h.durationMinutes}m</span>`);
  if((options.forceFlexibility || sortSettings.showFlexibilityOnCards) && h.flexibilityDays)parts.push(`<span class="context-pill" title="flexibility"><i class="ti ti-arrows-left-right" aria-hidden="true"></i>±${h.flexibilityDays}d</span>`);
  if(hasDaySchedule(h) && (options.forceDaySchedule || sortSettings.showDayScheduleOnCards)){
    const eligible = nextEligibleShort(h);
    const title = [scheduleSummary(h),nextEligibleCopy(h)].filter(Boolean).join(' · ');
    const prefClass = hasPreferredDays(h) ? ' has-preferred' : '';
    parts.push(`<span class="context-pill schedule${prefClass} ${eligible ? '' : 'icon-only'}" title="${escapeHtml(title)}"><i class="ti ti-calendar-time" aria-hidden="true"></i>${escapeHtml(eligible)}</span>`);
  }
  if(hasTimeWindow(h) && (options.forceTimeWindow || sortSettings.showTimeWindowOnCards)){
    parts.push(`<span class="context-pill time" title="time window"><i class="ti ti-clock-hour-4" aria-hidden="true"></i>${escapeHtml(timeWindowSummary(h))}</span>`);
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
    const label = compactPlanLabel(plan);
    parts.push(`<span class="context-pill plan ${label ? '' : 'icon-only'}" title="${escapeHtml(`planned ${entryWhen(plan)}`)}"><i class="ti ti-calendar-event" aria-hidden="true"></i>${escapeHtml(label)}</span>`);
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

// PURE: compact right-side agenda marker for a home card
function agendaCardPill(row){
  if(!row)return '';
  const label = agendaTimeLabel(row.start);
  const end = row.kind === 'fill' ? agendaTimeLabel(row.end) : '';
  const chunk = (row.chunkIndex != null && Number.isFinite(row.chunkMinutes))
    ? ` · ${Math.round(row.chunkMinutes)}m`
    : '';
  const title = row.kind === 'scheduled'
    ? `scheduled at ${label}`
    : `suggested ${label}${end ? ` to ${end}` : ''}${chunk}`;
  const cls = row.kind === 'scheduled' ? 'scheduled' : 'agenda-suggested';
  const icon = row.kind === 'scheduled' ? 'ti-calendar-time' : 'ti-sparkles';
  return `<span class="context-pill ${cls}" title="${escapeHtml(title)}"><i class="ti ${icon}" aria-hidden="true"></i>${escapeHtml(label)}${escapeHtml(chunk)}</span>`;
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
  const preferred = nextPreferredOnOrAfter(h,Date.now(),target);
  const pressureDay = preferred || target;
  if(!pressureDay)return '';
  const pressure = dayPressure(data,dateKey(pressureDay),settings,i);
  const duration = clampDuration(h.durationMinutes);
  const targetLabel = preferred ? 'preferred day' : 'target day';
  if(pressure.capacity <= 0)return `${targetLabel} has no open time`;
  if(pressure.remaining < duration)return `${targetLabel} is short ${duration - pressure.remaining}m`;
  if(pressure.busy >= 0.75)return `${targetLabel} is busy`;
  return '';
}

function homeEarlyMap(data,settings){
  const map = new Map();
  data.forEach((_,i)=>{
    const reason = earlyReason(data,i,settings);
    if(reason)map.set(i,reason);
  });
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
  const depart = startTs && typeof agendaTimeLabel === 'function' ? `leave by ${agendaTimeLabel(startTs)} · ` : '';
  const travelEl = document.createElement('button');
  travelEl.type = 'button';
  travelEl.className = `travel-card${edited ? ' is-edited' : ''}${fromCurrent ? ' is-from-current' : ''}`;
  travelEl.dataset.travelFrom = fromId;
  travelEl.dataset.travelTo = toId;
  travelEl.setAttribute('aria-label',`travel time ${fromName} to ${toName}`);
  if(fromCurrent)travelEl.setAttribute('aria-disabled','true');
  travelEl.innerHTML = `<i class="ti ti-route" aria-hidden="true"></i><span>${depart}${mins} min · ${escapeHtml(fromName)} → ${escapeHtml(toName)}</span>${edited ? '<i class="ti ti-pencil travel-edit-mark" aria-hidden="true"></i>' : ''}`;
  list.appendChild(travelEl);
  // Synthetic current-coord legs are not editable — skip all gesture wiring.
  if(fromCurrent)return;
  let travelPointer = null;
  travelEl.addEventListener('pointerdown',e=>{
    travelPointer = {el:travelEl,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
  },{passive:true});
  travelEl.addEventListener('pointerup',e=>{
    if(!travelPointer || travelPointer.el !== travelEl || travelPointer.id !== e.pointerId)return;
    const tap = travelPointer;
    travelPointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    if(moved > 10 || Date.now() - tap.time > 800)return;
    suppressCardClick = travelEl;
    openTravelEditSheet(fromId,toId);
    setTimeout(()=>{if(suppressCardClick === travelEl)suppressCardClick = null;},120);
  });
  travelEl.addEventListener('pointercancel',e=>{
    if(travelPointer && travelPointer.el === travelEl && travelPointer.id === e.pointerId)travelPointer = null;
  });
  travelEl.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(suppressCardClick === travelEl){
      suppressCardClick = null;
      return;
    }
    openTravelEditSheet(fromId,toId);
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
  const depart = startTs && typeof agendaTimeLabel === 'function' ? `leave by ${agendaTimeLabel(startTs)} · ` : '';
  const el = document.createElement('div');
  el.className = 'extra-text-line travel-text';
  el.textContent = `${depart}${mins} min · ${fromName} → ${to ? to.name : 'next'}`;
  list.appendChild(el);
}

// RENDER: plain muted background line for a blocked-time instance (text level).
function appendHomeBlockedText(list,row){
  if(!list || !row)return;
  const loc = row.locationId && typeof locationById === 'function' ? locationById(row.locationId) : null;
  const start = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(row.start) : '';
  const end = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(row.end) : '';
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

// RENDER: blocked-time card on home — tap cancels this instance for today.
function appendHomeBlockedCard(list,row){
  if(!list || !row)return;
  const loc = row.locationId && typeof locationById === 'function' ? locationById(row.locationId) : null;
  const start = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(row.start) : '';
  const end = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(row.end) : '';
  const place = loc ? ` · ${loc.name}` : '';
  // The card body is non-interactive background surface; only the X frees the
  // block for today (cancel + undo toast). Tapping anywhere else does nothing.
  const el = document.createElement('div');
  el.className = 'blocked-card';
  el.setAttribute('aria-label',`${row.label || 'blocked'} ${start} to ${end}${place}`);
  el.innerHTML = `<i class="ti ti-lock" aria-hidden="true"></i><span>${escapeHtml(row.label || 'blocked')} · ${escapeHtml(start)}–${escapeHtml(end)}${escapeHtml(place)}</span><button type="button" class="blocked-cancel-mark" aria-label="free ${escapeHtml(row.label || 'blocked') || 'block'} for today"><i class="ti ti-x" aria-hidden="true"></i></button>`;
  const xBtn = el.querySelector('.blocked-cancel-mark');
  if(xBtn)xBtn.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    cancelHomeBlockedRow(row);
  });
  list.appendChild(el);
}

/** HANDLER: cancel one blocked instance for its day and refresh, with undo. */
function cancelHomeBlockedRow(row){
  if(!row)return;
  const dayKey = dateKey(row.start);
  const startMin = row.blockStartMin != null ? row.blockStartMin : (row.startMin != null ? row.startMin : Math.round((row.start - dayStart(row.start)) / 60000));
  const endMin = row.blockEndMin != null ? row.blockEndMin : (row.endMin != null ? row.endMin : Math.round((row.end - dayStart(row.start)) / 60000));
  cancelBlockedInstance(dayKey,row.label,startMin,endMin);
  // Overnight blocks (end <= start) wrap past midnight: their full minute span
  // is (1440 − start + end), and cancelling the signature frees BOTH halves of
  // the day's interval at once. Plain `end − start` would go negative here and
  // wrongly *subtract* from the day's capacity.
  const freedMin = typeof blockDurationMinutes === 'function'
    ? blockDurationMinutes(startMin,endMin)
    : (endMin > startMin ? endMin - startMin : (1440 - startMin) + endMin);
  const s = loadSortSettings();
  const overrides = normalizeAvailabilityOverrides(s.availabilityOverrides);
  const current = effectiveAvailabilityMinutes(dayKey,s);
  overrides[dayKey] = Math.max(0,current + freedMin);
  saveSortSettings({...s,availabilityOverrides:overrides});
  showActionToast(`Freed ${row.label || 'blocked'} for today`,{
    type:'restore-blocked',
    dayKey,label:row.label,startMin,endMin,freedMin,
    undoLabel:'undo'
  });
  if(typeof render === 'function')render();
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
  const start = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(blocks[0].start) : '';
  const end = typeof agendaTimeLabel === 'function' ? agendaTimeLabel(blocks[blocks.length - 1].end) : '';
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
      ? `collapse ${blocks.length} blocked times`
      : `${blocks.length} blocked times ${start} to ${end}, tap to expand`
  );
  toggle.innerHTML = `<i class="ti ti-lock" aria-hidden="true"></i><span>${escapeHtml(summary)} · ${escapeHtml(start)}–${escapeHtml(end)} · ${blocks.length}</span><i class="ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'} blocked-card-chevron" aria-hidden="true"></i>`;
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
    suppressCardClick = toggle;
    if(expandedBlockedGroups.has(groupKey))expandedBlockedGroups.delete(groupKey);
    else expandedBlockedGroups.add(groupKey);
    if(typeof render === 'function')render();
    setTimeout(()=>{if(suppressCardClick === toggle)suppressCardClick = null;},120);
  });
  toggle.addEventListener('pointercancel',e=>{
    if(mergePointer && mergePointer.el === toggle && mergePointer.id === e.pointerId)mergePointer = null;
  });
  toggle.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();
    if(suppressCardClick === toggle){
      suppressCardClick = null;
      return;
    }
    if(expandedBlockedGroups.has(groupKey))expandedBlockedGroups.delete(groupKey);
    else expandedBlockedGroups.add(groupKey);
    if(typeof render === 'function')render();
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

function appendSectionHeader(list,label){
  if(!list || !label)return;
  const header = document.createElement('div');
  header.className = 'section-header';
  header.textContent = label;
  list.appendChild(header);
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

// RENDER: render the full habit list.
//
// `opts.deferAgenda` (default false): when true, skip the expensive
// buildWeekAgenda / homeAgendaRows / homeEarlyMap work and emit a basic
// pinned + todayCategory-bucketed list with no agenda pills, day sections,
// or travel/blocked extras. Used by renderProgressive() so the list paints
// within a frame; the full agenda replaces it on the next idle paint. Direct
// user-action renders (taps, swipes, saves) keep deferAgenda:false so the
// user sees the complete picture immediately after their gesture.
function render(opts){
  const o = opts || {};
  const list = $('list');
  const empty = $('empty');
  const data = load();
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
      empty.innerHTML = 'simple habit tracking<br><span class="empty-sub">Saved on this device. Tap Tings for help and settings, or + to add your first habit.</span>';
    }
    _homeListFingerprint = homeListFingerprint();
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
    && sortSettings.showWeekOnHome
    && !searching
    && typeof buildWeekAgenda === 'function'
    && typeof homeDaySequence === 'function';
  // homeEarlyMap calls earlyReason per item, which in turn may invoke the
  // today agenda pipeline. Defer it on progressive renders — it is only used
  // to surface an "early" pill on cards that pulled forward, and that pill is
  // not part of the first paint.
  const earlyMap = deferAgenda ? new Map() : homeEarlyMap(data,sortSettings);
  const visibleSet = new Set(indices);

  const appendHabitCard = (realIdx,agendaRow,earlyReasonText)=>{
    const h = data[realIdx];
    const days = daysSince(h.lastLog);
    const c = colors(days,h.target,h.type);
    const cardScore = progressScore(h);
    const cardScoreTone = cardTone(h);
    const cue = cardCue(h);
    const agendaPill = agendaCardPill(agendaRow);
    const earlyPill = earlyCardPill(earlyReasonText || '');
    const context = cardMeta(h,{extraPills:[earlyPill,agendaPill].filter(Boolean).join(''),suppressScheduled: agendaRow?.kind === 'scheduled'});
    const trail = cardTrail(h);
    const accent = visualClassColor(cardScoreTone);
    const isDoneTask = h.type === 'task' && isTaskDone(h);
    const pinAction = `<button class="swipe-action sa-pin" data-action="pin" aria-label="${h.pinned ? 'unpin' : 'pin'}"><i class="ti ${h.pinned ? 'ti-pinned-off' : 'ti-pin'}" aria-hidden="true"></i>${h.pinned ? 'unpin' : 'pin'}</button>`;
    const activityAction = `<button class="swipe-action sa-activity" data-action="activity" aria-label="activity"><i class="ti ti-history" aria-hidden="true"></i>activity</button>`;

    const row = document.createElement('div');
    row.className = 'swipe-row';
    row.dataset.realIdx = realIdx;
    if(agendaRow && Number.isFinite(agendaRow.chunkMinutes)){
      row.dataset.chunkMinutes = String(Math.round(agendaRow.chunkMinutes));
    }
    row.innerHTML = `
      <div class="swipe-actions swipe-actions-left">
        ${pinAction}
        ${activityAction}
      </div>
      <div class="swipe-actions swipe-actions-right">
        <button class="swipe-action sa-snooze" data-action="snooze" aria-label="snooze"><i class="ti ti-moon" aria-hidden="true"></i>snooze</button>
        <button class="swipe-action sa-nuke" data-action="nuke" aria-label="remove"><i class="ti ti-trash" aria-hidden="true"></i>remove</button>
      </div>
      <div class="ting-card ${cardScoreTone}${h.snoozedUntil&&Date.now()<h.snoozedUntil?' snoozed':''}${isDoneTask?' is-done':''}" data-real="${realIdx}" style="--card-accent:${accent};--card-priority:${priorityColor(effectivePriority(h))};">
        <button class="pulse-btn ${h.emoji ? 'emoji-pulse' : ''}" data-pulse="${realIdx}" aria-label="add entry for ${escapeHtml(h.name)}" style="background:${c.bg};color:${c.icon};">
          ${iconHtml(h,c)}
        </button>
        <div class="ting-info">
          <div class="ting-main">
            <span class="ting-name">${escapeHtml(h.name)}</span>
            <div class="mini-score-ring ${cardScoreTone}" style="--score:${cardScore ?? 0};--score-color:${accent};" title="${escapeHtml(cue)}" aria-hidden="true"></div>
          </div>
          <div class="ting-cue">${escapeHtml(cue)}</div>
          <div class="ting-meta" aria-label="rhythm and plan">${context}</div>
          <div class="ting-visual" aria-hidden="true">
            <div class="ting-trail">${trail}</div>
          </div>
        </div>
        <div class="card-actions" aria-label="habit actions">
          <button class="card-action-btn" data-action="activity" aria-label="activity" title="activity"><i class="ti ti-history" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="snooze" aria-label="snooze" title="snooze"><i class="ti ti-moon" aria-hidden="true"></i></button>
          <button class="card-action-btn" data-action="nuke" aria-label="remove" title="remove"><i class="ti ti-trash" aria-hidden="true"></i></button>
        </div>
      </div>`;

    list.appendChild(row);
    setupSwipe(row);
    setupCardTap(row,realIdx);
  };

  if(deferAgenda){
    // PROGRESSIVE FIRST PAINT — no buildWeekAgenda, no homeAgendaRows, no
    // homeEarlyMap. Show pinned first, then everyone in todayCategory order
    // (today / overdue / upcoming / others) so the list is sensible within a
    // frame. Full agenda replaces this on the next idle paint.
    list.classList.add('is-progressive');
    const labels = {0:'today',1:'overdue',2:'upcoming',3:'others'};
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
    const useOptimizer = Boolean(sortSettings.agendaOptimizer)
      && typeof buildWeekAgendaAsync === 'function'
      && !o.__fromOptimizer;
    const week = (o.__optimizedWeek && o.__optimizedWeek.days)
      ? o.__optimizedWeek
      : buildWeekAgenda(data,sortSettings,7);
    if(useOptimizer && !o.__optimizedWeek){
      const snapData = data;
      const snapSettings = sortSettings;
      void buildWeekAgendaAsync(snapData,snapSettings,7).then(optimized=>{
        if(!optimized || !optimized.optimized)return;
        if(typeof render === 'function')render({deferAgenda:false,__fromOptimizer:true,__optimizedWeek:optimized});
      }).catch(()=>{});
    }
    const agendaMap = new Map();
    const weekAssigned = new Set();
    const dayPlans = week.days.map(day=>{
      const seq = homeDaySequence(day,sortSettings,{visibleSet});
      for(const row of seq){
        if((row.kind === 'fill' || row.kind === 'scheduled') && row.i != null){
          weekAssigned.add(row.i);
          if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
        }
      }
      return {day,seq};
    });

    indices.filter(i=>data[i].pinned).forEach(realIdx=>{
      const agendaRow = agendaMap.get(realIdx);
      const cat = todayCategory(data[realIdx],sortSettings);
      const earlyText = (cat === 2 && earlyMap.get(realIdx) && agendaMap.has(realIdx)) ? earlyMap.get(realIdx) : '';
      appendHabitCard(realIdx,agendaRow,earlyText);
    });

    dayPlans.forEach(({day,seq})=>{
      if(!seq.length)return;
      appendSectionHeader(list,homeWeekDayLabel(day));
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
        if(data[row.i]?.pinned)continue;
        const cat = todayCategory(data[row.i],sortSettings);
        const earlyText = (day.isToday && cat === 2 && earlyMap.get(row.i)) ? earlyMap.get(row.i) : '';
        appendHabitCard(row.i,row,earlyText);
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
        const labels = {1:'overdue',2:'upcoming',3:'others'};
        const label = labels[key];
        if(label)appendSectionHeader(list,label);
        leftoverCat = key;
      }
      appendHabitCard(realIdx,null,'');
    });
  }else{
    const agendaRows = homeAgendaRows(data);
    const agendaMap = new Map();
    const agendaOrder = new Map();
    const chunksByIndex = new Map();
    agendaRows.forEach((row,pos)=>{
      if(!agendaMap.has(row.i))agendaMap.set(row.i,row);
      if(!agendaOrder.has(row.i))agendaOrder.set(row.i,pos);
      if(!chunksByIndex.has(row.i))chunksByIndex.set(row.i,[]);
      chunksByIndex.get(row.i).push(row);
    });
    // An upcoming item is pulled into "today" only when it BOTH passes the
    // do-early gate (allowed today + flexibility + its target day is over-loaded)
    // AND earns an agenda row today. If it loses its slot to capacity it falls
    // back to its original "upcoming" section, so the list never promises time
    // the day cannot give and the card never shows an "early" pill it can't honour.
    const earlyToday = i => Boolean(earlyMap.get(i)) && agendaMap.has(i);
    const renderIndices = todayFirstActive && !searching ? [...indices].sort((a,b)=>{
      const pin = Number(Boolean(data[b].pinned)) - Number(Boolean(data[a].pinned));
      if(pin)return pin;
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
          if(!sh || sh.pinned)continue;
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

    renderIndices.forEach(realIdx=>{
      const h = data[realIdx];
      const cat = todayFirstActive ? todayCategory(h,sortSettings) : -1;
      const isEarlyToday = todayFirstActive && cat === 2 && earlyToday(realIdx);
      const inTodaySection = !searching && todayFirstActive && !h.pinned && (cat === 0 || isEarlyToday);

      if(!searching && todayFirstActive && !h.pinned){
        const sectionKey = isEarlyToday ? 0 : cat;
        if(sectionKey !== sectionCat){
          const labels = {0:'today',1:'overdue',2:'upcoming',3:'others'};
          const label = labels[sectionKey];
          if(label)appendSectionHeader(list,label);
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
              const travelTs = Number.isFinite(chunkRow.start) ? chunkRow.start : Date.now();
              if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,cLocId,travelTs);
            }
            prevTodayLocId = cLocId || prevTodayLocId;
            const earlyText = (cat === 2 && earlyMap.get(realIdx)) ? earlyMap.get(realIdx) : '';
            appendHabitCard(realIdx,chunkRow,ci === 0 ? earlyText : '');
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
        const travelTs = agendaRow && Number.isFinite(agendaRow.start) ? agendaRow.start : Date.now();
        if(homeExtraRowVisible(travelTs))appendHomeExtraTravel(list,prevTodayLocId,locId,travelTs);
      }
      if(inTodaySection)prevTodayLocId = locId || prevTodayLocId;

      appendHabitCard(
        realIdx,
        agendaRow,
        (!searching && cat === 2 && earlyToday(realIdx)) ? earlyMap.get(realIdx) : ''
      );
    });
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
      if(btn.dataset.action === 'activity')openActivity(idx);
      if(btn.dataset.action === 'snooze')openSnooze(idx);
      if(btn.dataset.action === 'nuke')doNuke(idx);
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
    s.showWeekOnHome ? 1 : 0,
    s.showSnoozed ? 1 : 0,
    typeof searchQuery === 'string' ? searchQuery : '',
    typeof homeTopicFilter === 'string' ? homeTopicFilter : '',
    typeof homeLocationFilter === 'string' ? homeLocationFilter : '',
    travelSig,
    coordSig,
    currentEdgeSig,
    habitSig,
    JSON.stringify(s.cancelledBlocks || {}),
    JSON.stringify(s.availabilityOverrides || {}),
    JSON.stringify(s.availabilityMinutes || []),
    JSON.stringify(s.blockedTimes || []),
    s.prayerMethod || '', s.prayerMadhab || ''
  ].join('\n');
}

let _homeListFingerprint = '';

// RENDER: sync home list only when the freshness key moved. Background paths
// (travel refresh, while-open loop, quiet location updates) should call this
// instead of render() so an unchanged agenda never rebuilds the DOM.
function renderHomeIfChanged(force){
  const fp = homeListFingerprint();
  if(!force && fp === _homeListFingerprint)return false;
  render();
  _homeListFingerprint = homeListFingerprint();
  return true;
}

// Compat alias — progressive two-phase paint was retired because phase-1 order
// differed from agenda order and caused visible flicker. Callers that still
// name renderProgressive get a single sync render.
function renderProgressive(){
  render();
  _homeListFingerprint = homeListFingerprint();
}

// WIRE: attach swipe gesture listeners
function setupSwipe(row){
  const card = row.querySelector('.ting-card');
  const leftActions = row.querySelector('.swipe-actions-left');
  const rightActions = row.querySelector('.swipe-actions-right');
  let startX = 0,startY = 0,dx = 0,moved = false,touchId = null;
  let startedOpen = false;

  // PURE: measure total swipe action width
  function revealWidth(actions){
    return actions.querySelectorAll('.swipe-action').length * SWIPE_ACTION_WIDTH;
  }

  // HYBRID: reset swipe DOM and clear state
  function resetSwipe(){
    card.style.transition = SNAP_TRANSITION;
    card.style.transform = '';
    leftActions.style.transition = WIDTH_TRANSITION;
    rightActions.style.transition = WIDTH_TRANSITION;
    leftActions.style.width = '0';
    rightActions.style.width = '0';
    leftActions.style.pointerEvents = 'none';
    rightActions.style.pointerEvents = 'none';
    swipeOpenCard = null;
    delete row.dataset.swipeOpen;
    startedOpen = false;
    moved = false;
    dx = 0;
  }

  row.addEventListener('touchstart',e=>{
    const t = e.changedTouches[0];
    touchId = t.identifier;startX = t.clientX;startY = t.clientY;dx = 0;moved = false;
    startedOpen = swipeOpenCard === card;
    if(swipeOpenCard && swipeOpenCard !== card){
      closeAllSwipes();
    }
  },{passive:true});

  row.addEventListener('touchmove',e=>{
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
    moved = true;dx = ddx;
    const wantsLeft = dx > 0;
    const activeActions = wantsLeft ? leftActions : rightActions;
    const inactiveActions = wantsLeft ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const clamped = reveal ? Math.max(-reveal,Math.min(reveal,dx)) : 0;
    card.style.transition = 'none';
    activeActions.style.transition = 'none';
    inactiveActions.style.transition = 'none';
    card.style.transform = `translateX(${clamped}px)`;
    const pct = reveal ? Math.min(1,Math.abs(clamped) / reveal) : 0;
    activeActions.style.width = `${Math.abs(clamped)}px`;
    activeActions.style.pointerEvents = pct > 0.2 ? 'auto' : 'none';
    inactiveActions.style.width = '0';
    inactiveActions.style.pointerEvents = 'none';
  },{passive:false});

  row.addEventListener('touchend',()=>{
    if(!moved)return;
    if(startedOpen){
      startedOpen = false;
      return;
    }
    const dir = dx > 0 ? 1 : -1;
    const activeActions = dir > 0 ? leftActions : rightActions;
    const inactiveActions = dir > 0 ? rightActions : leftActions;
    const reveal = revealWidth(activeActions);
    const snap = reveal > 0 && Math.abs(dx) > Math.min(SWIPE_THRESHOLD,reveal * 0.55);
    card.style.transition = SNAP_TRANSITION;
    activeActions.style.transition = WIDTH_TRANSITION;
    inactiveActions.style.transition = WIDTH_TRANSITION;
    if(snap){
      card.style.transform = `translateX(${dir * reveal}px)`;
      activeActions.style.width = `${reveal}px`;
      activeActions.style.pointerEvents = 'auto';
      inactiveActions.style.width = '0';
      inactiveActions.style.pointerEvents = 'none';
      swipeOpenCard = card;
      row.dataset.swipeOpen = String(dir);
    }else{
      card.style.transform = '';
      leftActions.style.width = '0';
      rightActions.style.width = '0';
      leftActions.style.pointerEvents = 'none';
      rightActions.style.pointerEvents = 'none';
      swipeOpenCard = null;
      delete row.dataset.swipeOpen;
    }
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
  });
  swipeOpenCard = null;
}

// WIRE: attach card tap and pointer listeners
function setupCardTap(row,realIdx){
  const card = row.querySelector('.ting-card');
  card.addEventListener('pointerdown',e=>{
    if(e.target.closest('.pulse-btn'))return;
    cardPointer = {card,realIdx,id:e.pointerId,x:e.clientX,y:e.clientY,time:Date.now()};
  });
  card.addEventListener('pointerup',e=>{
    if(!cardPointer || cardPointer.card !== card || cardPointer.id !== e.pointerId)return;
    const tap = cardPointer;
    cardPointer = null;
    const moved = Math.hypot(e.clientX - tap.x,e.clientY - tap.y);
    if(moved > 10 || Date.now() - tap.time > 800)return;
    suppressCardClick = card;
    if(swipeOpenCard){closeAllSwipes();}
    else handleCardActivate(realIdx,card,()=>openDetail(realIdx));
    setTimeout(()=>{if(suppressCardClick === card)suppressCardClick = null;},120);
  });
  card.addEventListener('pointercancel',e=>{
    if(cardPointer && cardPointer.card === card && cardPointer.id === e.pointerId)cardPointer = null;
  });
  card.addEventListener('click',e=>{
    if(suppressCardClick === card){
      e.preventDefault();
      e.stopPropagation();
      suppressCardClick = null;
      return;
    }
    if(e.target.closest('.pulse-btn'))return;
    if(swipeOpenCard){closeAllSwipes();return;}
    handleCardActivate(realIdx,card,()=>openDetail(realIdx));
  });
}

// HANDLER: distinguish tap vs double-tap
function handleCardActivate(realIdx,card,singleAction){
  const now = Date.now();
  if(lastTap.idx === realIdx && now - lastTap.time < TAP_DELAY){
    clearTimeout(tapTimer);
    lastTap = {idx:-1,time:0};
    quickLog(realIdx,card);
  }else{
    lastTap = {idx:realIdx,time:now};
    clearTimeout(tapTimer);
    tapTimer = setTimeout(singleAction,TAP_DELAY);
  }
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
    // Continuous ideal: default to full remaining. Callers (chunk cards) may
    // pass opts.minutes for a specific placed session size.
    const next = remainingChunks(h)[0];
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
  return true;
}

// HYBRID: log entry at timestamp, show undo
function logTingAt(i,ts){
  const data = load();
  if(!data[i])return false;
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
  }
  if(!save(data))return false;
  showActionToast(`${isPlan ? 'Planned' : 'Logged'} ${toastItemName(data[i])}`,action);
  return true;
}

// HYBRID: add a planned entry for a specific date, optionally preserving a time.
function planTingOnDay(i,key,timeValue = '',options = {}){
  const data = load();
  if(!data[i])return false;
  // Stop habits ("quit" type) cannot be planned — there is no future session
  // to schedule, only lapses to log. Bail before creating any plan log.
  if(data[i].type === 'zero')return false;
  const base = new Date(`${key}T12:00:00`);
  if(Number.isNaN(base.getTime()))return false;
  let hours = 12;
  let minutes = 0;
  const time = timeInputToMinutes(timeValue);
  if(time !== null){
    hours = Math.floor(time / 60);
    minutes = time % 60;
  }
  const ts = new Date(base.getFullYear(),base.getMonth(),base.getDate(),hours,minutes,0,0).getTime();
  const action = withEntryToastAction({
    type:'entry',
    idx:i,
    ts,
    plan:true,
    snoozedUntil:data[i].snoozedUntil || null,
    openAction:options.openAction
  });
  data[i].logs = normalizeLogs([...(data[i].logs || []),{ts,plan:true}]);
  data[i].lastLog = latestActualLog(data[i].logs);
  if(!save(data))return false;
  const timeLabel = timeValue ? ` · ${new Date(ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}` : '';
  showActionToast(`Planned ${toastItemName(data[i])}${timeLabel}`,action);
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
      removed.push(logTime(log));
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
  const logs = normalizeLogs(h.logs);
  const moved = [];
  const newDay = new Date(`${toKey}T00:00:00`);
  const remaining = logs.filter(log=>{
    if(isPlanLog(log) && dateKey(logTime(log)) === fromKey){
      const old = new Date(logTime(log));
      const nt = new Date(newDay.getFullYear(),newDay.getMonth(),newDay.getDate(),old.getHours(),old.getMinutes(),0,0).getTime();
      moved.push({oldTs:logTime(log),newTs:nt});
      return false;
    }
    return true;
  });
  if(!moved.length)return;
  moved.forEach(m=>remaining.push({ts:m.newTs,plan:true}));
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
      moved.forEach(m=>filtered.push({ts:m.oldTs,plan:true}));
      data[idx].logs = normalizeLogs(filtered);
      data[idx].lastLog = latestActualLog(data[idx].logs);
    }
  }
  if(pendingAction.type === 'remove-plans'){
    const {idx,removed} = pendingAction;
    if(data[idx]){
      const logs = normalizeLogs(data[idx].logs);
      removed.forEach(ts=>logs.push({ts,plan:true}));
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
  if(pendingAction.type === 'restore-blocked'){
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
  if(save(data)){
    hideActionToast();
    showToast('undone');
    refreshOpenViews();
  }
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
  const chunkRaw = card && card.closest && card.closest('.swipe-row')
    ? card.closest('.swipe-row').dataset.chunkMinutes
    : null;
  const chunkMinutes = chunkRaw != null && chunkRaw !== ''
    ? Math.round(Number(chunkRaw))
    : null;
  const logOpts = Number.isFinite(chunkMinutes) && chunkMinutes > 0
    ? {minutes:chunkMinutes}
    : {};
  if(typeof requestLogTing === 'function'){
    requestLogTing(i,go,logOpts);
    return;
  }
  if(!logTing(i,logOpts))return;
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
