// ─────────────────────────────────────────────────────────────────────────
// LOCATIONS — registry CRUD, full-page Places Manager (filter/search/bulk edit),
// temporary one-off places, categorization (type + indoor/outdoor), and map picker.
// ─────────────────────────────────────────────────────────────────────────

const expandedLocationMores = new Set();
const pendingLocationHoursEdit = new Set();
function clearLocationHoursEditing(index){
  pendingLocationHoursEdit.delete(index);
}

const locManagerState = {
  search:'',
  scope:'all',      // 'all' | 'saved' | 'temp'
  env:'all',        // 'all' | 'indoor' | 'outdoor' | 'both' | 'unset'
  type:'all',       // 'all' | group key | exact placeType
  status:'all',     // 'all' | 'hours' | 'allday' | 'weather' | 'unused' | 'notype'
  sort:'name',      // 'name' | 'used' | 'type' | 'env' | 'nearest'
  bulkMode:false,
  selectedIds:new Set(),
  visibleIds:[]     // places currently shown (post search/filter) — drives the bulk "select all (N)" scope
};

let locationsManagerReturnSheet = null;

function openLocationsManager(opts = {}){
  locationsManagerReturnSheet = opts.returnSheet || null;
  if(opts.scope)locManagerState.scope = opts.scope;
  if(opts.search != null)locManagerState.search = String(opts.search);
  const searchEl = $('locations-manager-search');
  if(searchEl)searchEl.value = locManagerState.search;
  const sortEl = $('locations-manager-sort');
  if(sortEl)sortEl.value = locManagerState.sort;
  renderLocationControls({ includeManager: true });
  const sheet = $('locations-manager-sheet');
  if(sheet){
    sheet.inert = false;
    openSheet('locations-manager-sheet',{reopen:()=>openLocationsManager(opts)});
    const body = $('locations-manager-body');
    if(body)body.scrollTop = 0;
  }
}

function closeLocationsManager(){
  if(locManagerState.bulkMode){
    locManagerState.bulkMode = false;
    locManagerState.selectedIds.clear();
  }
  closeSheet('locations-manager-sheet');
  const sheet = $('locations-manager-sheet');
  if(sheet)sheet.inert = true;
  const ret = locationsManagerReturnSheet;
  locationsManagerReturnSheet = null;
  renderLocationControls({ includeManager: false });
  if(typeof refreshOpenViews === 'function')refreshOpenViews();
  if(ret && $(ret) && !$(ret).classList.contains('open'))openSheet(ret);
}

function setLocationsManagerBulkMode(on){
  locManagerState.bulkMode = Boolean(on);
  if(!locManagerState.bulkMode)locManagerState.selectedIds.clear();
  renderLocationControls();
}

function placeTypeSelectOptionsHtml(selectedValue = '', includeUnchanged = false){
  const cur = normalizePlaceType(selectedValue);
  const opts = typeof PLACE_TYPE_PICKER_OPTIONS !== 'undefined' ? PLACE_TYPE_PICKER_OPTIONS : [{value:'',label:'None'}];
  const hasCur = !cur || opts.some(o=>o.value === cur);
  const rows = [];
  if(includeUnchanged)rows.push('<option value="__clear__">Clear type (none)</option>');
  for(const o of opts){
    if(includeUnchanged && o.value === '')continue;
    rows.push(`<option value="${escapeHtml(o.value)}"${o.value === cur ? ' selected' : ''}>${escapeHtml(o.label)}</option>`);
  }
  if(cur && !hasCur){
    const label = typeof placeTypeLabel === 'function' ? placeTypeLabel(cur) : cur.replace(/_/g,' ');
    rows.push(`<option value="${escapeHtml(cur)}" selected>${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</option>`);
  }
  return rows.join('');
}

function locationEnvironmentSelectOptionsHtml(loc){
  const explicit = normalizeLocationEnvironment(loc && loc.environment);
  const inferred = typeof inferredLocationEnvironment === 'function' ? inferredLocationEnvironment(loc && loc.placeType) : '';
  const autoLabel = inferred ? `Auto (${locationEnvironmentLabel(inferred)})` : 'Auto';
  return [
    `<option value=""${explicit === '' ? ' selected' : ''}>${escapeHtml(autoLabel)}</option>`,
    `<option value="indoor"${explicit === 'indoor' ? ' selected' : ''}>Indoor</option>`,
    `<option value="outdoor"${explicit === 'outdoor' ? ' selected' : ''}>Outdoor</option>`,
    `<option value="both"${explicit === 'both' ? ' selected' : ''}>Indoor &amp; outdoor</option>`,
    `<option value="none"${explicit === 'none' ? ' selected' : ''}>Not specified</option>`
  ].join('');
}

// PURE: keep a Set of row indices aligned with the locations array after a
// removal — drops the removed index and shifts every later index down by
// one. Shared by every per-row transient UI state (expanders, mid-edit
// flags) so none of them can point at the wrong row after a delete.
function reindexSetAfterRemoval(set,removedIndex){
  const shifted = [...set].filter(i=>i !== removedIndex).map(i=>i > removedIndex ? i - 1 : i);
  set.clear();
  shifted.forEach(i=>set.add(i));
}

function locationReferencePoint(){
  if(typeof currentCoord !== 'undefined' && currentCoord && Number.isFinite(currentCoord.lat) && Number.isFinite(currentCoord.lng)){
    return {lat:currentCoord.lat,lng:currentCoord.lng};
  }
  const s = sortSettings || {};
  if(Number.isFinite(s.homeCityLat) && Number.isFinite(s.homeCityLng)){
    return {lat:s.homeCityLat,lng:s.homeCityLng};
  }
  return null;
}

function locationUsageSummaryMap(locations, data){
  const habits = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  const map = new Map();
  for(const loc of locations)map.set(loc.id,{direct:[],viaType:[]});
  for(const h of habits){
    if(!h)continue;
    const directSet = new Set([
      ...normalizeLocationIds(h.locationIds),
      ...(h.preferredLocationId ? [cleanLocationId(h.preferredLocationId)] : []),
      ...(h.weatherLocationId ? [cleanLocationId(h.weatherLocationId)] : []),
      ...((h.scheduleOptions || []).map(o=>cleanLocationId(o && o.locationId)).filter(Boolean)),
      ...(h.locationPrefs && typeof h.locationPrefs === 'object' ? Object.keys(h.locationPrefs).map(cleanLocationId) : [])
    ].filter(Boolean));
    for(const id of directSet){
      const entry = map.get(id);
      if(entry)entry.direct.push(h);
    }
    const types = typeof normalizeLocationTypes === 'function' ? normalizeLocationTypes(h.locationTypes) : [];
    if(types.length){
      for(const loc of locations){
        if(loc.temporary || directSet.has(loc.id))continue;
        if(types.some(t=>locationMatchesTypeKey(loc, t))){
          const entry = map.get(loc.id);
          if(entry)entry.viaType.push(h);
        }
      }
    }
  }
  return map;
}

function filteredManagerLocations(locations, usageMap){
  const q = String(locManagerState.search || '').trim().toLocaleLowerCase();
  const weatherProfiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles) : [];
  const weatherById = new Map(weatherProfiles.map(p=>[p.id, p.name]));
  const ref = locationReferencePoint();

  const items = locations.map((loc, index)=>({loc, index})).filter(({loc})=>{
    if(locManagerState.scope === 'saved' && loc.temporary)return false;
    if(locManagerState.scope === 'temp' && !loc.temporary)return false;
    const effEnv = typeof effectiveLocationEnvironment === 'function' ? effectiveLocationEnvironment(loc) : '';
    if(locManagerState.env === 'indoor' && effEnv !== 'indoor' && effEnv !== 'both')return false;
    if(locManagerState.env === 'outdoor' && effEnv !== 'outdoor' && effEnv !== 'both')return false;
    if(locManagerState.env === 'both' && effEnv !== 'both')return false;
    if(locManagerState.env === 'unset' && effEnv !== '')return false;
    if(locManagerState.type !== 'all' && !locationMatchesTypeKey(loc, locManagerState.type))return false;
    const usage = usageMap.get(loc.id) || {direct:[],viaType:[]};
    const totalUsed = usage.direct.length + usage.viaType.length;
    if(locManagerState.status === 'hours' && !hasLocationHours(loc))return false;
    if(locManagerState.status === 'allday' && hasLocationHours(loc))return false;
    if(locManagerState.status === 'weather' && !loc.weatherProfileId)return false;
    if(locManagerState.status === 'unused' && totalUsed > 0)return false;
    if(locManagerState.status === 'notype' && loc.placeType)return false;
    if(q){
      const hay = [
        loc.name,
        loc.address,
        loc.placeType ? placeTypeLabel(loc.placeType) : '',
        loc.placeType || '',
        effEnv ? locationEnvironmentLabel(effEnv) : '',
        loc.temporary ? 'temporary one-off' : 'saved',
        loc.weatherProfileId ? (weatherById.get(loc.weatherProfileId) || '') : ''
      ].join(' ').toLocaleLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });

  const sortBy = locManagerState.sort;
  items.sort((a,b)=>{
    if(sortBy === 'used'){
      const ua = usageMap.get(a.loc.id);
      const ub = usageMap.get(b.loc.id);
      const ca = ua ? ua.direct.length + ua.viaType.length : 0;
      const cb = ub ? ub.direct.length + ub.viaType.length : 0;
      if(ca !== cb)return cb - ca;
    }else if(sortBy === 'type'){
      const ta = a.loc.placeType ? placeTypeLabel(a.loc.placeType) : '\uffff';
      const tb = b.loc.placeType ? placeTypeLabel(b.loc.placeType) : '\uffff';
      const cmp = ta.localeCompare(tb, undefined, {sensitivity:'base'});
      if(cmp)return cmp;
    }else if(sortBy === 'env'){
      const rank = loc=>{
        const e = effectiveLocationEnvironment(loc);
        return e === 'indoor' ? 0 : e === 'outdoor' ? 1 : e === 'both' ? 2 : 3;
      };
      const d = rank(a.loc) - rank(b.loc);
      if(d)return d;
    }else if(sortBy === 'nearest' && ref && typeof haversineMetres === 'function'){
      const da = haversineMetres(ref.lat, ref.lng, a.loc.lat, a.loc.lng);
      const db = haversineMetres(ref.lat, ref.lng, b.loc.lat, b.loc.lng);
      if(da !== db)return da - db;
    }
    return compareLocationNames(a.loc, b.loc);
  });
  return items;
}

function renderLocationsManagerFilters(locations, usageMap){
  const wrap = $('locations-manager-filters');
  if(!wrap)return;
  const savedCount = locations.filter(l=>!l.temporary).length;
  const tempCount = locations.length - savedCount;
  const chips = [];
  const chip = (attr, value, label, active, extraClass = '')=>
    `<button type="button" class="manager-filter-chip${active ? ' on' : ''}${extraClass ? ' ' + extraClass : ''}" ${attr}="${escapeHtml(value)}" aria-pressed="${active}">${label}</button>`;

  if(tempCount > 0){
    chips.push(chip('data-loc-f-scope', 'all', `All (${locations.length})`, locManagerState.scope === 'all'));
    chips.push(chip('data-loc-f-scope', 'saved', `Saved (${savedCount})`, locManagerState.scope === 'saved'));
    chips.push(chip('data-loc-f-scope', 'temp', `One-off (${tempCount})`, locManagerState.scope === 'temp'));
  }
  const indoorCount = locations.filter(l=>{const e=effectiveLocationEnvironment(l);return e==='indoor'||e==='both';}).length;
  const outdoorCount = locations.filter(l=>{const e=effectiveLocationEnvironment(l);return e==='outdoor'||e==='both';}).length;
  const bothCount = locations.filter(l=>effectiveLocationEnvironment(l)==='both').length;
  if(indoorCount)chips.push(chip('data-loc-f-env', 'indoor', `🏠 Indoor (${indoorCount})`, locManagerState.env === 'indoor'));
  if(outdoorCount)chips.push(chip('data-loc-f-env', 'outdoor', `🌤️ Outdoor (${outdoorCount})`, locManagerState.env === 'outdoor'));
  if(bothCount)chips.push(chip('data-loc-f-env', 'both', `Both (${bothCount})`, locManagerState.env === 'both'));

  const unusedCount = locations.filter(l=>{const u=usageMap.get(l.id);return !u || (!u.direct.length && !u.viaType.length);}).length;
  const hoursCount = locations.filter(l=>hasLocationHours(l)).length;
  const weatherCount = locations.filter(l=>Boolean(l.weatherProfileId)).length;
  const noTypeCount = locations.filter(l=>!l.placeType).length;
  if(hoursCount)chips.push(chip('data-loc-f-status', 'hours', `Hours (${hoursCount})`, locManagerState.status === 'hours'));
  if(weatherCount)chips.push(chip('data-loc-f-status', 'weather', `Weather (${weatherCount})`, locManagerState.status === 'weather'));
  if(unusedCount)chips.push(chip('data-loc-f-status', 'unused', `Unused (${unusedCount})`, locManagerState.status === 'unused'));
  if(noTypeCount && locations.length > 1)chips.push(chip('data-loc-f-status', 'notype', `No type (${noTypeCount})`, locManagerState.status === 'notype'));

  // Dynamic place type category chips present in registry.
  if(typeof PLACE_TYPE_GROUPS !== 'undefined'){
    for(const group of PLACE_TYPE_GROUPS){
      const count = locations.filter(l=>locationMatchesTypeKey(l, group.key)).length;
      if(!count)continue;
      chips.push(chip('data-loc-f-type', group.key, `${group.emoji} ${escapeHtml(group.label)} (${count})`, locManagerState.type === group.key));
    }
  }
  const hasActiveFilter = locManagerState.scope !== 'all' || locManagerState.env !== 'all'
    || locManagerState.type !== 'all' || locManagerState.status !== 'all' || Boolean(locManagerState.search);
  if(hasActiveFilter){
    chips.push('<button type="button" class="manager-filter-chip is-reset" data-loc-f-reset="1">Reset filters</button>');
  }
  wrap.innerHTML = chips.join('');
  wrap.hidden = !chips.length;
}

function renderLocationsBulkBar(){
  const bar = $('locations-bulk-bar');
  const toggleBtn = $('locations-bulk-toggle');
  if(toggleBtn){
    toggleBtn.classList.toggle('on', locManagerState.bulkMode);
    toggleBtn.setAttribute('aria-pressed', String(locManagerState.bulkMode));
    toggleBtn.textContent = locManagerState.bulkMode ? 'done' : 'select';
  }
  if(!bar)return;
  bar.hidden = !locManagerState.bulkMode;
  if(!locManagerState.bulkMode)return;
  const count = locManagerState.selectedIds.size;
  const countEl = $('locations-bulk-count');
  if(countEl)countEl.textContent = `${count} selected`;
  // "select all" only takes the places currently shown (after search/filters);
  // label it with that count so the scope is never a surprise.
  const allBtn = $('locations-bulk-all');
  if(allBtn){
    const shown = (locManagerState.visibleIds || []).length;
    allBtn.textContent = shown ? `select all (${shown})` : 'select all';
    allBtn.disabled = shown === 0;
  }
  const applyBtn = $('locations-bulk-apply');
  if(applyBtn)applyBtn.disabled = count === 0;
  const action = $('locations-bulk-action')?.value || 'type';
  const valWrap = $('locations-bulk-value');
  if(!valWrap)return;
  const prevKey = valWrap.dataset.actionKey || '';
  if(prevKey === action)return;
  valWrap.dataset.actionKey = action;
  if(action === 'type'){
    valWrap.innerHTML = `<select id="locations-bulk-type-val" class="settings-select" aria-label="place type">${placeTypeSelectOptionsHtml('', true)}</select>`;
  }else if(action === 'env'){
    valWrap.innerHTML = `<select id="locations-bulk-env-val" class="settings-select" aria-label="indoor or outdoor">
      <option value="indoor">Indoor</option>
      <option value="outdoor">Outdoor</option>
      <option value="both">Indoor &amp; outdoor</option>
      <option value="">Auto (from type)</option>
      <option value="none">Not specified</option>
    </select>`;
  }else if(action === 'weather'){
    const profiles = typeof normalizeWeatherProfiles === 'function'
      ? normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles) : [];
    valWrap.innerHTML = `<select id="locations-bulk-weather-val" class="settings-select" aria-label="weather profile">
      <option value="">None (clear weather)</option>
      ${profiles.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
    </select>`;
  }else if(action === 'hours'){
    valWrap.innerHTML = `<div class="manager-bulk-hours">
      <input type="time" id="locations-bulk-start" step="300" value="09:00" aria-label="open from" />
      <span>–</span>
      <input type="time" id="locations-bulk-end" step="300" value="17:00" aria-label="open until" />
      <label class="manager-bulk-check"><input type="checkbox" id="locations-bulk-allday" /> All day</label>
    </div>`;
  }else if(action === 'radius'){
    valWrap.innerHTML = `<label class="manager-bulk-radius"><input type="number" id="locations-bulk-radius-val" min="10" max="2000" step="5" value="${DEFAULT_LOCATION_RADIUS_M}" aria-label="radius in metres" /><span>m</span></label>`;
  }else{
    valWrap.innerHTML = '';
  }
}

function applyLocationsBulkEdit(){
  const ids = new Set(locManagerState.selectedIds);
  if(!ids.size)return;
  const action = $('locations-bulk-action')?.value || 'type';
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(action === 'delete'){
    let removedCount = 0;
    let blockedCount = 0;
    const kept = [];
    const removedIds = new Set();
    for(const loc of locations){
      if(!ids.has(loc.id)){ kept.push(loc); continue; }
      if(habitsUsingLocationId(loc.id).length){
        blockedCount += 1;
        kept.push(loc);
      }else{
        removedCount += 1;
        removedIds.add(loc.id);
      }
    }
    if(!removedCount){
      showToast(blockedCount ? `${blockedCount} selected ${blockedCount === 1 ? 'place is' : 'places are'} still in use` : 'Nothing removed');
      return;
    }
    const travel = {};
    for(const [key, edge] of Object.entries(sortSettings.travel || {})){
      if(!removedIds.has(edge.a) && !removedIds.has(edge.b))travel[key] = edge;
    }
    expandedLocationMores.clear();
    pendingLocationHoursEdit.clear();
    locManagerState.selectedIds.clear();
    updateSortSetting({locations:kept, travel},{renderNow:false});
    const {data,changed} = reconcileLocations(load(),{...sortSettings,locations:kept,travel});
    if(changed)save(data);
    for(const rid of removedIds){
      if(typeof filterHasKey === 'function' && (filterHasKey(homeLocationFilter, rid) || filterHasKey(overviewLocationFilter, rid))){
        removeSharedFilter('location', rid);
      }
    }
    renderLocationControls();
    if(typeof refreshOpenViews === 'function')refreshOpenViews();
    showToast(blockedCount
      ? `Removed ${removedCount} · skipped ${blockedCount} still in use`
      : `Removed ${removedCount} ${removedCount === 1 ? 'place' : 'places'}`);
    return;
  }

  let patchFn = null;
  let weatherChanged = false;
  if(action === 'type'){
    const raw = $('locations-bulk-type-val')?.value || '';
    const nextType = raw === '__clear__' ? '' : normalizePlaceType(raw);
    patchFn = loc=>({
      placeType:nextType,
      ...(!loc.emoji && nextType && typeof emojiForPlaceType === 'function' && emojiForPlaceType(nextType) ? {emoji:emojiForPlaceType(nextType)} : {})
    });
  }else if(action === 'env'){
    const env = normalizeLocationEnvironment($('locations-bulk-env-val')?.value || '');
    patchFn = ()=>({environment:env});
  }else if(action === 'weather'){
    const wid = typeof cleanWeatherProfileId === 'function' ? cleanWeatherProfileId($('locations-bulk-weather-val')?.value || '') || null : null;
    weatherChanged = true;
    patchFn = ()=>({weatherProfileId:wid});
  }else if(action === 'hours'){
    const allDay = Boolean($('locations-bulk-allday')?.checked);
    const s = allDay ? null : timeInputToMinutes($('locations-bulk-start')?.value || '');
    const e = allDay ? null : timeInputToMinutes($('locations-bulk-end')?.value || '');
    if(!allDay && (s == null || e == null)){ showToast('Enter open and close times, or check All day.'); return; }
    patchFn = ()=>({allowedTimeStart:s, allowedTimeEnd:e});
  }else if(action === 'radius'){
    const raw = Number($('locations-bulk-radius-val')?.value);
    const radiusM = Number.isFinite(raw) ? Math.max(10, Math.min(2000, Math.round(raw))) : DEFAULT_LOCATION_RADIUS_M;
    patchFn = ()=>({radiusM});
  }else if(action === 'save'){
    patchFn = ()=>({temporary:false});
  }else if(action === 'temp'){
    patchFn = ()=>({temporary:true});
  }
  if(!patchFn)return;
  let updated = 0;
  const next = locations.map(loc=>{
    if(!ids.has(loc.id))return loc;
    updated += 1;
    return {...loc, ...patchFn(loc)};
  });
  updateSortSetting({locations:next},{renderNow:false});
  if(typeof bumpPlannerDataRevision === 'function')bumpPlannerDataRevision();
  locManagerState.selectedIds.clear();
  renderLocationControls();
  render();
  if(weatherChanged){
    if(typeof renderWeatherControls === 'function')renderWeatherControls();
    if(typeof syncWeatherGuidanceHints === 'function')syncWeatherGuidanceHints();
    if(typeof refreshWeatherForecast === 'function')void refreshWeatherForecast();
  }
  showToast(`Updated ${updated} ${updated === 1 ? 'place' : 'places'}`);
}

// IMPURE: remove unused temporary locations (all, or restricted to onlyIds).
function cleanupUnusedTemporaryLocations(data, {onlyIds = null, quiet = false} = {}){
  const locations = normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
  const onlySet = Array.isArray(onlyIds) ? new Set(onlyIds.map(cleanLocationId).filter(Boolean)) : null;
  const habits = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  const removedIds = new Set();
  const kept = [];
  for(const loc of locations){
    if(loc.temporary && (!onlySet || onlySet.has(loc.id)) && habitsUsingLocationId(loc.id, habits).length === 0){
      removedIds.add(loc.id);
      continue;
    }
    kept.push(loc);
  }
  if(!removedIds.size)return 0;
  const travel = {};
  for(const [key, edge] of Object.entries((sortSettings || {}).travel || {})){
    if(!removedIds.has(edge.a) && !removedIds.has(edge.b))travel[key] = edge;
  }
  updateSortSetting({locations:kept, travel},{renderNow:false});
  for(const rid of removedIds){
    locManagerState.selectedIds.delete(rid);
    if(typeof filterHasKey === 'function' && (filterHasKey(homeLocationFilter, rid) || filterHasKey(overviewLocationFilter, rid))){
      removeSharedFilter('location', rid);
    }
  }
  renderLocationControls();
  if(!quiet && typeof showToast === 'function'){
    showToast(`Cleaned up ${removedIds.size} unused one-off ${removedIds.size === 1 ? 'place' : 'places'}`);
  }
  return removedIds.size;
}

// RENDER: the Settings summary card AND full Places Manager list.
function renderLocationControls(opts = {}){
  const includeManager = opts.includeManager !== false;
  const locations = normalizeLocationRegistry((sortSettings || loadSortSettings()).locations);
  const saved = locations.filter(l=>!l.temporary);
  const temp = locations.filter(l=>l.temporary);

  // Prune any selectedIds no longer in registry.
  const idSet = new Set(locations.map(l=>l.id));
  for(const id of [...locManagerState.selectedIds]){ if(!idSet.has(id))locManagerState.selectedIds.delete(id); }

  const summaryText = !locations.length
    ? 'No saved places'
    : temp.length
      ? `${saved.length} saved · ${temp.length} one-off`
      : `${saved.length} saved ${saved.length === 1 ? 'place' : 'places'}`;
  const summary = $('location-list-summary');
  if(summary)summary.textContent = summaryText;
  const mgrCount = $('locations-manager-count');
  if(mgrCount)mgrCount.textContent = summaryText;

  // Compact preview pills in Settings.
  const preview = $('location-settings-preview');
  if(preview){
    const sortedSaved = saved.slice().sort(compareLocationNames);
    const shown = sortedSaved.slice(0, 5);
    const more = sortedSaved.length - shown.length;
    preview.innerHTML = shown.map(loc=>{
      const mark = loc.emoji || (typeof emojiForPlaceType === 'function' ? emojiForPlaceType(loc.placeType) : '') || '';
      return `<span class="settings-preview-pill">${mark ? `<span>${escapeHtml(mark)}</span>` : ''}${escapeHtml(loc.name)}</span>`;
    }).join('') + (more > 0 ? `<span class="settings-preview-pill is-more">+${more} more</span>` : '');
    preview.hidden = !shown.length;
  }

  if(!includeManager)return;
  const usageMap = locationUsageSummaryMap(locations);

  // Cleanup bar for unused temporary places.
  const unusedTemp = temp.filter(l=>{
    const u = usageMap.get(l.id);
    return !u || !u.direct.length;
  });
  const cleanupBar = $('locations-temp-cleanup-bar');
  const cleanupText = $('locations-temp-cleanup-text');
  if(cleanupBar && cleanupText){
    cleanupBar.hidden = unusedTemp.length === 0;
    if(unusedTemp.length){
      cleanupText.textContent = `${unusedTemp.length} unused one-off ${unusedTemp.length === 1 ? 'place' : 'places'}`;
    }
  }

  const clearBtn = $('locations-manager-search-clear');
  if(clearBtn)clearBtn.hidden = !locManagerState.search;

  renderLocationsManagerFilters(locations, usageMap);

  const wrap = $('location-list');
  if(!wrap)return;
  const displayLocations = filteredManagerLocations(locations, usageMap);
  locManagerState.visibleIds = displayLocations.map(({loc})=>loc.id);
  const empty = $('location-empty-hint');
  if(empty){
    empty.hidden = displayLocations.length > 0;
    if(locations.length === 0){
      empty.textContent = 'No places yet. Add a place to plan travel, hours, and weather — habits without a place can be done anywhere.';
    }else if(displayLocations.length === 0){
      // Places exist but none match — offer the one-tap way back.
      empty.innerHTML = 'No places match your search or filters. '
        + '<button type="button" class="mini-text-btn" data-loc-empty-reset>clear search &amp; filters</button>';
    }else{
      empty.textContent = '';
    }
  }
  wrap.innerHTML = displayLocations.map(({loc,index})=>locationRowMarkup(loc,index,usageMap)).join('');
  expandedLocationMores.forEach(i=>{
    const body = wrap.querySelector(`[data-location-more="${i}"]`);
    if(body)body.hidden = false;
  });
  renderLocationsBulkBar();
}

// HANDLER: empty-state recovery — same reset as the "Reset filters" chip.
document.addEventListener('click',event=>{
  if(!event.target.closest('[data-loc-empty-reset]'))return;
  locManagerState.search = '';
  locManagerState.scope = 'all';
  locManagerState.env = 'all';
  locManagerState.type = 'all';
  locManagerState.status = 'all';
  const el = $('locations-manager-search');
  if(el){ el.value = ''; }
  renderLocationControls();
});

// RENDER: rebuild ONE location row in place.
function rerenderLocationRow(index){
  const wrap = $('location-list');
  const row = wrap && wrap.querySelector(`[data-location-row="${index}"]`);
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const loc = locations[index];
  if(!wrap || !row || !loc){ renderLocationControls(); return; }
  const usageMap = locationUsageSummaryMap(locations);
  row.outerHTML = locationRowMarkup(loc,index,usageMap);
}

// RENDER: one location row — name, categorization (type + indoor/outdoor),
// usage badge, temporary promote, hours, radius, and More options.
// In bulk (select) mode every editor is disabled: the row becomes a pure
// selection target, so taps can't silently edit a place while selecting.
function locationRowMarkup(loc,i,usageMap = null){
  const hoursSaved = Number.isFinite(loc.allowedTimeStart) && Number.isFinite(loc.allowedTimeEnd);
  const hoursOpenUI = hoursSaved || pendingLocationHoursEdit.has(i);
  const startVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeStart) : '';
  const endVal = hoursSaved ? minutesToTimeInput(loc.allowedTimeEnd) : '';
  const closedSet = new Set(Array.isArray(loc.closedDays) ? loc.closedDays : []);
  const prefSet = Number.isFinite(loc.preferredTimeStart) && Number.isFinite(loc.preferredTimeEnd);
  const prefStart = prefSet ? minutesToTimeInput(loc.preferredTimeStart) : '';
  const prefEnd = prefSet ? minutesToTimeInput(loc.preferredTimeEnd) : '';
  const moreOpen = expandedLocationMores.has(i);
  const radius = Number.isFinite(loc.radiusM) ? Math.round(loc.radiusM) : DEFAULT_LOCATION_RADIUS_M;
  const closedCount = closedSet.size;
  const weatherProfiles = typeof normalizeWeatherProfiles === 'function'
    ? normalizeWeatherProfiles((sortSettings || loadSortSettings()).weatherProfiles) : [];
  const weatherProfile = weatherProfiles.find(profile=>profile.id===loc.weatherProfileId) || null;
  const weatherOptions = '<option value="">none</option>'+weatherProfiles.map(profile=>
    `<option value="${escapeHtml(profile.id)}"${profile.id===loc.weatherProfileId?' selected':''}>${escapeHtml(profile.name)}</option>`
  ).join('');
  const usage = usageMap ? (usageMap.get(loc.id) || {direct:[],viaType:[]}) : {direct:habitsUsingLocationId(loc.id),viaType:[]};
  const totalUsed = usage.direct.length + usage.viaType.length;
  const usageText = totalUsed
    ? `${totalUsed} ${totalUsed === 1 ? 'item' : 'items'}`
    : 'unused';
  const usedNames = [...usage.direct, ...usage.viaType].map(h=>h && h.name).filter(Boolean);
  const moreSummary = [
    closedCount ? `closed ${closedCount}d` : null,
    prefSet ? 'preferred time' : null,
    weatherProfile ? `${weatherProfile.name} weather` : null,
    usedNames.length ? `${usedNames.length} linked` : null
  ].filter(Boolean).join(' · ');
  const iconMark = loc.emoji || (typeof emojiForPlaceType === 'function' ? emojiForPlaceType(loc.placeType) : '');
  const selected = locManagerState.selectedIds.has(loc.id);
  const bulk = locManagerState.bulkMode;
  const dis = bulk ? ' disabled' : '';
  const moreChevron = `<i class="ti ${moreOpen ? 'ti-chevron-down' : 'ti-chevron-right'}" aria-hidden="true"></i>`;
  return `<div class="location-row${loc.temporary ? ' is-temporary' : ''}${selected ? ' is-selected' : ''}${bulk ? ' is-bulk' : ''}" data-location-row="${i}" data-location-id="${escapeHtml(loc.id)}">
    <div class="location-row-head">
      ${bulk ? `<label class="manager-row-check"><input type="checkbox" data-loc-select="${escapeHtml(loc.id)}" aria-label="select ${escapeHtml(loc.name)}"${selected ? ' checked' : ''} /></label>` : ''}
      <span class="location-row-icon" aria-hidden="true">${iconMark ? escapeHtml(iconMark) : '<i class="ti ti-map-pin"></i>'}</span>
      <input type="text" class="location-name" data-loc-name="${i}" aria-label="place name" maxlength="48" value="${escapeHtml(loc.name)}"${dis} />
      <span class="location-usage-badge${totalUsed ? '' : ' is-unused'}" title="${escapeHtml(usedNames.slice(0,6).join(', ') || 'No items using this place')}">${escapeHtml(usageText)}</span>
      <button class="mini-text-btn location-remove-btn" type="button" data-loc-remove="${i}" aria-label="remove ${escapeHtml(loc.name)}"${dis}><i class="ti ti-trash" aria-hidden="true"></i><span>remove</span></button>
    </div>
    ${loc.temporary ? `<div class="location-temp-strip">
      <span class="location-temp-badge"><i class="ti ti-clock-hour-4" aria-hidden="true"></i> One-off place</span>
      <button class="mini-text-btn location-promote-btn" type="button" data-loc-promote="${i}"${dis}>save to places</button>
    </div>` : ''}
    <div class="location-meta">
      <input type="text" class="location-address" data-loc-address="${i}" aria-label="address" maxlength="120" value="${escapeHtml(loc.address)}" placeholder="address (optional)"${dis} />
      <button class="mini-text-btn location-pin-btn" type="button" data-loc-edit-pin="${i}" title="edit pin on map" aria-label="edit pin on map for ${escapeHtml(loc.name)}"${dis}>
        <i class="ti ti-map-pin" aria-hidden="true"></i> edit map
      </button>
      <button class="mini-text-btn location-maps-btn" type="button" data-loc-maps="${i}" title="open directions in maps" aria-label="open directions to ${escapeHtml(loc.name)} in maps"${dis}>
        <i class="ti ti-external-link" aria-hidden="true"></i>
      </button>
    </div>
    <div class="location-categories">
      <label class="loc-cat-select-wrap">
        <span class="loc-field-label">type</span>
        <select class="settings-select loc-type-select" data-loc-type="${i}" aria-label="place type for ${escapeHtml(loc.name)}"${dis}>${placeTypeSelectOptionsHtml(loc.placeType)}</select>
      </label>
      <label class="loc-cat-select-wrap">
        <span class="loc-field-label">setting</span>
        <select class="settings-select loc-env-select" data-loc-env="${i}" aria-label="indoor or outdoor setting for ${escapeHtml(loc.name)}"${dis}>${locationEnvironmentSelectOptionsHtml(loc)}</select>
      </label>
    </div>
    <div class="location-hours">
      <span class="loc-field-label">hours</span>
      <span class="loc-hours-fields"${hoursOpenUI ? '' : ' hidden'}>
        <input type="time" step="300" data-loc-start="${i}" aria-label="open from" value="${startVal}" ${hoursOpenUI ? '' : 'disabled'}${dis} />
        <span class="loc-sep">–</span>
        <input type="time" step="300" data-loc-end="${i}" aria-label="open until" value="${endVal}" ${hoursOpenUI ? '' : 'disabled'}${dis} />
      </span>
      <button type="button" class="loc-allday ${hoursOpenUI ? '' : 'on'}" data-loc-allday="${i}" aria-pressed="${hoursOpenUI ? 'false' : 'true'}"${dis}>All day</button>
    </div>
    <div class="location-radius">
      <span class="loc-field-label">nearby</span>
      <input type="number" data-loc-radius="${i}" aria-label="how close in metres" min="10" max="2000" step="5" inputmode="numeric" value="${radius}"${dis} />
      <span class="loc-unit">m</span>
      <span class="loc-hint">how close means you’re here</span>
    </div>
    <button class="mini-text-btn loc-more-toggle" type="button" data-loc-more="${i}" aria-expanded="${moreOpen}" data-more-summary="${escapeHtml(moreSummary)}"${dis}>${moreChevron}<span>more options${moreSummary ? ` · ${escapeHtml(moreSummary)}` : ''}</span></button>
    <div class="location-more" data-location-more="${i}" ${moreOpen ? '' : 'hidden'}>
      ${usedNames.length ? `<div class="loc-used-by"><span class="loc-field-label">used by</span><span class="field-hint">${escapeHtml(usedNames.slice(0,8).join(', '))}${usedNames.length > 8 ? ` +${usedNames.length - 8} more` : ''}</span></div>` : ''}
      <label class="loc-weather habit-option-field">
        <span class="loc-field-label">weather guidance</span>
        <select class="settings-select" data-loc-weather="${i}" aria-label="weather guidance for ${escapeHtml(loc.name)}"${dis}>${weatherOptions}</select>
        <span class="field-hint">Applies automatically to items scheduled here unless an item or option overrides it.</span>
      </label>
      <div class="location-days">
        <span class="loc-field-label">closed</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const on = closedSet.has(day);
          return `<button type="button" class="schedule-chip ${on ? 'on' : ''}" data-loc-closed-day="${day}" data-loc-index="${i}" aria-pressed="${on}"${dis}>${label}</button>`;
        }).join('')}
      </div>
      <div class="loc-pref">
        <span class="loc-field-label">prefer</span>
        <input type="time" step="300" data-loc-pref-start="${i}" aria-label="prefer from" value="${prefStart}"${dis} />
        <span class="loc-sep">–</span>
        <input type="time" step="300" data-loc-pref-end="${i}" aria-label="prefer until" value="${prefEnd}"${dis} />
        <button class="mini-text-btn" type="button" data-loc-pref-clear="${i}"${dis}>clear</button>
      </div>
      <div class="loc-perday">
        <span class="loc-field-label">by day</span>
        ${WEEKDAY_LABELS.map((label,day)=>{
          const hd = loc.hoursByDay && loc.hoursByDay[day];
          const isClosed = hd === null;
          const ds = hd && Number.isFinite(hd.start) ? minutesToTimeInput(hd.start) : '';
          const de = hd && Number.isFinite(hd.end) ? minutesToTimeInput(hd.end) : '';
          return `<div class="perday-row">
            <span class="perday-label">${label}</span>
            <input type="time" step="300" data-loc-day-start="${day}" data-loc-day-idx="${i}" value="${ds}" ${isClosed ? 'disabled' : ''}${dis} />
            <span class="loc-sep">–</span>
            <input type="time" step="300" data-loc-day-end="${day}" data-loc-day-idx="${i}" value="${de}" ${isClosed ? 'disabled' : ''}${dis} />
            <label class="perday-closed"><input type="checkbox" data-loc-day-closed="${day}" data-loc-day-idx="${i}" ${isClosed ? 'checked' : ''}${dis} /> closed</label>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>`;
}

// HYBRID: patch one location and persist.
function saveLocationPatch(index,patch){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(!locations[index])return;
  locations[index] = {...locations[index],...patch};
  updateSortSetting({locations},{renderNow:false});
  const weatherChanged = Object.prototype.hasOwnProperty.call(patch,'weatherProfileId');
  const categoryChanged = Object.prototype.hasOwnProperty.call(patch,'placeType')
    || Object.prototype.hasOwnProperty.call(patch,'environment')
    || Object.prototype.hasOwnProperty.call(patch,'temporary');
  if((weatherChanged || categoryChanged) && typeof bumpPlannerDataRevision==='function')bumpPlannerDataRevision();
  if(Object.prototype.hasOwnProperty.call(patch,'name') || categoryChanged)renderLocationControls();
  else rerenderLocationRow(index);
  render();
  if(weatherChanged){
    if(typeof renderWeatherControls==='function')renderWeatherControls();
    if(typeof syncWeatherGuidanceHints==='function')syncWeatherGuidanceHints();
    if(typeof refreshWeatherForecast==='function')void refreshWeatherForecast();
  }
}

// HYBRID: add a location to the registry (called by the geocode pick, GPS, or a
// manual entry). Generates a stable opaque id. Enforces MAX_LOCATIONS.
function addLocation({name,address,lat,lng,emoji,placeType,environment,temporary,allowedTimeStart,allowedTimeEnd,closedDays,hoursByDay}){
  const cleanName = String(name || '').trim().slice(0,48);
  if(!cleanName){ showToast('enter a name'); return null; }
  if(!Number.isFinite(lat) || !Number.isFinite(lng)){ showToast('missing coordinates'); return null; }
  const locations = normalizeLocationRegistry(sortSettings.locations);
  if(locations.length >= MAX_LOCATIONS){ showToast(`limit ${MAX_LOCATIONS} locations`); return null; }
  const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `loc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const row = {
    id, name:cleanName,
    address:String(address || '').trim().slice(0,120),
    lat, lng,
    emoji:String(emoji || '').slice(0,4),
    placeType:normalizePlaceType(placeType),
    environment:typeof normalizeLocationEnvironment === 'function' ? normalizeLocationEnvironment(environment) : '',
    temporary:Boolean(temporary),
    radiusM:DEFAULT_LOCATION_RADIUS_M,
    weatherProfileId:null
  };
  if(Number.isFinite(allowedTimeStart) && Number.isFinite(allowedTimeEnd)){
    row.allowedTimeStart = allowedTimeStart;
    row.allowedTimeEnd = allowedTimeEnd;
  }
  if(Array.isArray(closedDays) && closedDays.length)row.closedDays = closedDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
  if(hoursByDay && typeof hoursByDay === 'object')row.hoursByDay = hoursByDay;
  locations.push(row);
  updateSortSetting({locations},{renderNow:false});
  renderLocationControls();
  render();
  showToast(row.temporary ? `added one-off place ${cleanName}` : `added ${cleanName}`);
  if(!row.temporary && typeof maybeInferHomeCityFromPlace === 'function')maybeInferHomeCityFromPlace(lat,lng);
  return id;
}

// PURE: habits that still reference a place id (locationIds / preferred / prefs).
function habitsUsingLocationId(locId, data){
  const id = cleanLocationId(locId);
  if(!id)return [];
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(!h)return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds : [];
    if(ids.some(x => cleanLocationId(x) === id))return true;
    if(cleanLocationId(h.preferredLocationId) === id)return true;
    if(h.locationPrefs && typeof h.locationPrefs === 'object' && Object.prototype.hasOwnProperty.call(h.locationPrefs, id)){
      return true;
    }
    if(cleanLocationId(h.weatherLocationId) === id)return true;
    if(Array.isArray(h.scheduleOptions) && h.scheduleOptions.some(option=>cleanLocationId(option && option.locationId)===id))return true;
    return false;
  });
}

// PURE: habits that rely on home city for prayer windows (anchors, no places).
function habitsUsingHomeCity(data){
  const list = Array.isArray(data) ? data : (typeof load === 'function' ? load() : []);
  return list.filter(h=>{
    if(typeof habitUsesPrayerAnchors !== 'function' || !habitUsesPrayerAnchors(h))return false;
    const ids = Array.isArray(h.locationIds) ? h.locationIds.filter(Boolean) : [];
    return ids.length === 0;
  });
}

// PURE: short toast listing habit names that block a destructive settings action.
function habitsInUseToast(prefix, habits){
  const names = (habits || []).map(h=>{
    if(typeof sampleDisplayName === 'function'){
      const n = sampleDisplayName(h);
      if(n)return n;
    }
    return (h && h.name) || 'habit';
  }).filter(Boolean);
  if(!names.length)return prefix;
  const shown = names.slice(0,4);
  const more = names.length > shown.length ? ` +${names.length - shown.length}` : '';
  return `${prefix}: ${shown.join(', ')}${more}`;
}

// HYBRID: remove a location, prune its travel edges, and sweep the dangling id
// off every habit (locationIds + preferredLocationId). Resets any location
// filter that pointed at it (Phase 5 globals, guarded). Blocked when any habit
// still references the place — user must clear those habits first.
function removeLocation(index){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const removed = locations[index];
  if(!removed)return;
  const users = habitsUsingLocationId(removed.id);
  if(users.length){
    const label = removed.name || 'place';
    if(typeof showToast === 'function'){
      showToast(habitsInUseToast(`can't remove ${label} — still used by`, users));
    }
    return;
  }
  reindexSetAfterRemoval(expandedLocationMores,index);
  reindexSetAfterRemoval(pendingLocationHoursEdit,index);
  locations.splice(index,1);
  const travel = {};
  for(const [key,edge] of Object.entries(sortSettings.travel || {})){
    if(edge.a !== removed.id && edge.b !== removed.id)travel[key] = edge;
  }
  updateSortSetting({locations,travel},{renderNow:false});
  const {data,changed} = reconcileLocations(load(),{...sortSettings,locations,travel});
  if(changed)save(data);
  if(filterHasKey(homeLocationFilter, removed.id) || filterHasKey(overviewLocationFilter, removed.id))removeSharedFilter('location', removed.id);
  renderLocationControls();
  refreshOpenViews();
}

// HYBRID: update one location's hoursByDay[weekday] from the per-day editor.
// closed=true → null (closed that day); both times set → {start,end}; otherwise
// the override is dropped so the day falls back to the default window.
function saveLocationDayPatch(index,weekday,{start,end,closed}){
  const locations = normalizeLocationRegistry(sortSettings.locations);
  const loc = locations[index];
  if(!loc)return;
  const hoursByDay = {...(loc.hoursByDay || {})};
  if(closed){
    hoursByDay[weekday] = null;
  }else if(start !== null && end !== null){
    hoursByDay[weekday] = {start,end};
  }else{
    delete hoursByDay[weekday];
  }
  saveLocationPatch(index,{hoursByDay});
}

// HANDLER: toggle the "more" expander on a location row.
function toggleLocationMore(index){
  const body = document.querySelector(`[data-location-more="${index}"]`);
  const btn = document.querySelector(`[data-loc-more="${index}"]`);
  if(!body)return;
  const opening = body.hidden;
  body.hidden = !opening;
  if(opening)expandedLocationMores.add(index); else expandedLocationMores.delete(index);
  if(btn){
    // Keep the summary ("closed 2d · Dry weather · 2 linked") in the collapsed
    // label — it is the only place those facts are visible without expanding.
    const summary = btn.dataset.moreSummary || '';
    btn.setAttribute('aria-expanded',String(opening));
    btn.innerHTML = `<i class="ti ${opening ? 'ti-chevron-down' : 'ti-chevron-right'}" aria-hidden="true"></i><span>more options${summary ? ` · ${escapeHtml(summary)}` : ''}</span>`;
  }
}

let pickerNameSource = 'none';

function bindPickerKeyboardReflow(){
  const sheet = $('location-picker-sheet');
  if(!sheet)return;
  $('picker-name').addEventListener('input',()=>{ pickerNameSource = 'user'; });
  sheet.addEventListener('focusin',e=>{
    if(!e.target.matches('input'))return;
    sheet.classList.add('kb-open');
    scheduleKeyboardLayout();
  });
  sheet.addEventListener('focusout',()=>{
    setTimeout(()=>{
      if(!sheet.contains(document.activeElement) || !document.activeElement.matches('input')){
        sheet.classList.remove('kb-open','kb-visible');
        if(!document.querySelector('.picker-coords-details').open)$('picker-content').scrollTop = 0;
      }
    },120);
  });
}
bindPickerKeyboardReflow();

function setPickerSearching(on){
  const sheet = $('location-picker-sheet');
  if(on && !sheet.classList.contains('searching')){
    pickerSearchBounds = pickerVisibleBounds();
    pickerMap?.closePopup();
  }
  sheet.classList.toggle('searching',on);
}

function clearPickerSearch(){
  pickerSearchGen += 1;
  pickerTypeaheadGen += 1;
  clearTimeout(pickerTypeaheadTimer);
  pickerTypeaheadTimer = null;
  const results = $('picker-results');
  results.hidden = true;
  results.replaceChildren();
  results.removeAttribute('aria-busy');
  const btn = $('picker-search-btn');
  btn.disabled = false;
  btn.textContent = 'search';
  pendingPickerResults = [];
}

function leavePickerSearch({focusMap = false} = {}){
  clearPickerSearch();
  const sheet = $('location-picker-sheet');
  if(sheet.contains(document.activeElement))document.activeElement.blur();
  sheet.classList.remove('kb-open','kb-visible');
  setPickerSearching(false);
  $('picker-content').scrollTop = 0;
  if(focusMap)$('picker-map').focus({preventScroll:true});
}

// ── Location map picker (Leaflet) ───────────────────────────────────────
let pickerMap = null;
let pickerStreetLayer = null;
let pickerSatelliteLayer = null;
let pickerBaseLayer = 'street';
let pickerSatelliteLoaded = false;
let pickerEditIndex = null;
let pickerReverseTimer = null;
let pickerMapResizeObserver = null;
let pickerSearchBounds = null;
let pendingPickerResults = [];
let pickerMapGen = 0;
let pickerSearchGen = 0;
let pickerSearchScope = 'near';
let pickerOpenAnchor = null;
// Live facts for the pin: the search hit / reverse result behind it, so Save
// captures the address the user actually picked (not a stale hint) and the
// OSM venue type + opening hours auto-fill can run once the details land.
let pickerCurrentHit = null;
let pickerReversePending = null;
let pickerDetailsPending = null;
let pickerTypeaheadTimer = null;
let pickerTypeaheadGen = 0;
let pickerSavedMarkers = [];
let pickerCurrentDot = null;
let pickerCurrentDotRing = null;
// A result pick, GPS jump or layout resize does not count as a user pan.
let pickerProgrammaticPan = false;

const PICKER_RECENTS_KEY = 'recentPlaceSearches';
const PICKER_RECENTS_MAX = 8;

function destroyLocationPickerMap(){
  pickerMapGen += 1;
  if(pickerReverseTimer){ clearTimeout(pickerReverseTimer); pickerReverseTimer = null; }
  if(pickerTypeaheadTimer){ clearTimeout(pickerTypeaheadTimer); pickerTypeaheadTimer = null; }
  pickerTypeaheadGen += 1;
  pickerReversePending = null;
  pickerCurrentHit = null;
  pickerDetailsPending = null;
  pickerMapResizeObserver?.disconnect();
  pickerMapResizeObserver = null;
  pickerProgrammaticPan = false;
  if(pickerMap){
    try{
      pickerMap.stop();
      pickerMap.off();
      pickerMap.remove();
    }catch{ /* ignore */ }
    pickerMap = null;
    pickerStreetLayer = null;
    pickerSatelliteLayer = null;
    pickerSatelliteLoaded = false;
  }
  pickerSavedMarkers = [];
  pickerCurrentDot = null;
  pickerCurrentDotRing = null;
  const el = $('picker-map');
  if(el){
    el.innerHTML = '';
    if(el._leaflet_id)delete el._leaflet_id;
  }
}

function syncPickerBaseLayerButtons(){
  document.querySelectorAll('[data-picker-layer]').forEach(btn=>{
    const active = btn.dataset.pickerLayer === pickerBaseLayer;
    btn.classList.toggle('on',active);
    btn.setAttribute('aria-pressed',String(active));
  });
}

function setPickerBaseLayer(mode,{persist = true} = {}){
  if(!pickerMap)return;
  const next = mode === 'satellite' ? 'satellite' : 'street';
  const layer = next === 'satellite' ? pickerSatelliteLayer : pickerStreetLayer;
  const old = pickerBaseLayer === 'satellite' ? pickerSatelliteLayer : pickerStreetLayer;
  if(!layer)return;
  try{
    if(old && old !== layer && pickerMap.hasLayer(old))pickerMap.removeLayer(old);
    if(!pickerMap.hasLayer(layer))layer.addTo(pickerMap);
  }catch{return;}
  pickerBaseLayer = next;
  syncPickerBaseLayerButtons();
  if(persist && next === 'street')saveSortSettings({...sortSettings,mapBaseLayer:'street'});
  if(persist && next === 'satellite' && pickerSatelliteLoaded){
    saveSortSettings({...sortSettings,mapBaseLayer:'satellite'});
  }
}

function pickerSatelliteTileLoaded(){
  if(pickerBaseLayer !== 'satellite' || pickerSatelliteLoaded)return;
  pickerSatelliteLoaded = true;
  saveSortSettings({...sortSettings,mapBaseLayer:'satellite'});
}

function pickerSatelliteTileFailed(){
  if(pickerBaseLayer !== 'satellite' || pickerSatelliteLoaded)return;
  setPickerBaseLayer('street',{persist:true});
  showToast('Satellite unavailable. Showing street map.');
}

function pickerPanTo(lat,lng,zoom){
  if(!pickerMap)return;
  pickerProgrammaticPan = true;
  try{
    pickerMap.setView([lat,lng],zoom ?? pickerMap.getZoom(),{animate:false});
  }finally{
    pickerProgrammaticPan = false;
  }
}

function pickerSetCoords(lat,lng,{reverse = true, pan = true, hit = null} = {}){
  if(!Number.isFinite(lat) || !Number.isFinite(lng))return;
  clearTimeout(pickerReverseTimer);
  pickerReverseTimer = null;
  pickerReversePending = null;
  pickerDetailsPending = null;
  $('picker-lat').value = pickerCoordText(lat);
  $('picker-lng').value = pickerCoordText(lng);
  if(pan)pickerPanTo(lat,lng);
  const pin = {...hit,lat,lng};
  pickerCurrentHit = pin;
  $('picker-address-hint').textContent = pin.address || '';
  const nameEl = $('picker-name');
  if(pickerNameSource !== 'user'){
    nameEl.value = (pin.name || '').slice(0,48);
    pickerNameSource = pin.name ? 'pick' : 'none';
  }
  if(pickerTypeSource !== 'user'){
    syncPickerTypeSelect(pin.placeType || '');
  }
  syncPickerEnvButtons();
  renderPickerPlaceFacts();
  if(!reverse)return;
  pickerReverseTimer = setTimeout(()=>{
    pickerReverseTimer = null;
    if(pickerCurrentHit === pin)resolvePickerPinAddress(pin);
  },800);
}

function pickerCoordText(value){
  return String(Math.round(value * 1e6) / 1e6);
}

function resolvePickerPinAddress(pin){
  const pending = reverseGeocode(pin.lat,pin.lng).then(result=>{
    if(pickerCurrentHit !== pin || !result)return;
    pin.address = result.address || '';
    $('picker-address-hint').textContent = pin.address;
    if(pickerNameSource !== 'user' && result.name){
      $('picker-name').value = result.name.slice(0,48);
      pickerNameSource = 'reverse';
    }
  }).finally(()=>{ if(pickerReversePending === pending)pickerReversePending = null; });
  pickerReversePending = pending;
}

function syncPickerPinToMapCenter(){
  const center = pickerMapCenter();
  const pin = pickerCurrentHit;
  if(!center || !pin || haversineMetres(pin.lat,pin.lng,center.lat,center.lng) < 0.5)return;
  const source = pin.source;
  const carried = source && haversineMetres(source.lat,source.lng,center.lat,center.lng) <= 120 ? pin : null;
  pickerSetCoords(center.lat,center.lng,{reverse:!carried,pan:false,hit:carried});
  if(carried && !carried.openingHours)refreshPickerPlaceDetails();
}

function ensureLocationPickerMap(lat,lng){
  const el = $('picker-map');
  if(!el || typeof L === 'undefined')return;
  const startLat = Number.isFinite(lat) ? lat : 40.7359;
  const startLng = Number.isFinite(lng) ? lng : -74.0036;
  // The native Android WebView stays animation-free (cheap compositing);
  // desktop and PWA browsers get the standard zoom/fade motion.
  const native = Boolean(window.TingsNative && window.TingsNative.isNative);
  pickerMap = L.map(el,{
    trackResize:false,
    zoomControl:false,
    attributionControl:true,
    zoomAnimation:!native,
    fadeAnimation:!native,
    markerZoomAnimation:!native
  }).setView([startLat,startLng],15,{animate:false});
  // Esri's World Street Map raster is the closest no-key match to Google's
  // road style (CARTO's free anonymous tiles now serve a "key required"
  // placeholder, and OpenFreeMap is vector-only, which Leaflet cannot draw).
  // OSM standard tiles stay as the failure fallback; CSP carries both hosts.
  pickerStreetLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',{
    maxZoom:19,
    attribution:'Tiles &copy; Esri'
  });
  pickerStreetLayer.on('tileerror',pickerStreetTileFailed);
  pickerSatelliteLayer = L.tileLayer(ESRI_WORLD_IMAGERY_TILES,{
    maxZoom:19,
    attribution:'&copy; Esri, Maxar, Earthstar Geographics'
  });
  pickerSatelliteLayer.on('tileload',pickerSatelliteTileLoaded);
  pickerSatelliteLayer.on('tileerror',pickerSatelliteTileFailed);
  pickerBaseLayer = (sortSettings && sortSettings.mapBaseLayer) === 'satellite' ? 'satellite' : 'street';
  (pickerBaseLayer === 'satellite' ? pickerSatelliteLayer : pickerStreetLayer).addTo(pickerMap);
  pickerMap.on('click',e=>{
    if($('location-picker-sheet').classList.contains('searching')){
      leavePickerSearch();
      return;
    }
    const point = pickerMap.wrapLatLng(e.latlng);
    pickerSetCoords(point.lat,point.lng);
  });
  pickerMap.on('moveend',()=>{
    if(pickerProgrammaticPan)return;
    syncPickerPinToMapCenter();
    refreshPickerScopeHint();
  });
  if(typeof ResizeObserver === 'function'){
    pickerMapResizeObserver = new ResizeObserver(()=>{
      if(!pickerMap)return;
      pickerProgrammaticPan = true;
      try{ pickerMap.invalidateSize({animate:false}); }
      finally{ pickerProgrammaticPan = false; }
    });
    pickerMapResizeObserver.observe(el);
  }
  addPickerSavedMarkers();
  addPickerCurrentDot();
  syncPickerBaseLayerButtons();
}

// Show every saved place as a small dot so the user can orient (and avoid
// saving a duplicate two doors down). Tap opens a popup with an edit jump.
function addPickerSavedMarkers(){
  if(!pickerMap)return;
  const locs = normalizeLocationRegistry(sortSettings && sortSettings.locations);
  locs.forEach((loc,index)=>{
    if(pickerEditIndex != null && index === pickerEditIndex)return;
    if(loc.temporary)return;
    if(!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng))return;
    let marker = null;
    try{
      marker = L.circleMarker([loc.lat,loc.lng],{
        radius:6, weight:2, color:'#ffffff', fillColor:'#2f9e8f', fillOpacity:1
      }).addTo(pickerMap);
      const card = document.createElement('div');
      card.className = 'picker-saved-popup';
      card.innerHTML = `<b>${escapeHtml(loc.name)}</b>${loc.address ? `<small>${escapeHtml(loc.address)}</small>` : ''}`;
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini-text-btn';
      edit.textContent = 'edit this place';
      edit.addEventListener('click',()=>{
        const row = normalizeLocationRegistry(sortSettings.locations)[index];
        if(!row)return;
        if(pickerMap)pickerMap.closePopup();
        openLocationPicker({index,name:row.name,address:row.address,lat:row.lat,lng:row.lng});
      });
      card.appendChild(edit);
      marker.bindPopup(card,{ closeButton:true, autoPan:false });
      const label = document.createElement('span');
      label.textContent = loc.name;
      marker.bindTooltip(label,{direction:'top',offset:[0,-6]});
    }catch{ /* ignore */ }
    if(marker)pickerSavedMarkers.push(marker);
  });
}

// Blue "you are here" dot with a faint accuracy ring, like Google's.
function addPickerCurrentDot(){
  if(!pickerMap || !currentCoord || !Number.isFinite(currentCoord.lat) || !Number.isFinite(currentCoord.lng))return;
  try{
    pickerCurrentDotRing = L.circle([currentCoord.lat,currentCoord.lng],{
      radius:Math.max(60,Number(currentCoord.accuracy) || 100),
      weight:0, fillColor:'#4285f4', fillOpacity:0.12, interactive:false
    }).addTo(pickerMap);
    pickerCurrentDot = L.circleMarker([currentCoord.lat,currentCoord.lng],{
      radius:7, weight:2, color:'#ffffff', fillColor:'#4285f4', fillOpacity:1, interactive:false
    }).addTo(pickerMap);
  }catch{ /* ignore */ }
}

function pickerStreetTileFailed(){
  // Esri street tiles failing -> standard OpenStreetMap, swapped once.
  if(!pickerMap || pickerBaseLayer !== 'street')return;
  try{
    pickerMap.removeLayer(pickerStreetLayer);
    pickerStreetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,
      attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(pickerMap);
    showToast('map style unavailable — using OpenStreetMap');
  }catch{ /* ignore */ }
}

// HYBRID: open add/edit place picker with map pin. `opts.onCreated(id)` fires
// once after a brand-new place is saved, so callers (e.g. the detail-pane
// "+ new place" pill) can auto-select it on the habit they came from.
let pickerOnCreated = null;
let pickerTypeSource = 'none';
let pickerEnvValue = '';
let pickerAllowTemporary = false;

function syncPickerTypeSelect(value){
  const sel = $('picker-place-type');
  if(!sel)return;
  const clean = normalizePlaceType(value);
  sel.innerHTML = placeTypeSelectOptionsHtml(clean);
  sel.value = clean;
}

function syncPickerEnvButtons(){
  const selType = $('picker-place-type')?.value || '';
  const inferred = typeof inferredLocationEnvironment === 'function' ? inferredLocationEnvironment(selType) : '';
  const seg = $('picker-env-seg');
  if(!seg)return;
  seg.querySelectorAll('[data-picker-env]').forEach(btn=>{
    const val = btn.dataset.pickerEnv;
    const on = val === pickerEnvValue;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    if(val === ''){
      btn.textContent = inferred ? `Auto (${inferred === 'both' ? 'both' : inferred})` : 'Auto';
    }
  });
}

function openLocationPicker(opts = {}){
  leavePickerSearch();
  destroyLocationPickerMap();
  pickerEditIndex = Number.isInteger(opts.index) ? opts.index : null;
  pickerOnCreated = typeof opts.onCreated === 'function' ? opts.onCreated : null;
  const existing = Number.isInteger(opts.index) ? normalizeLocationRegistry(sortSettings.locations)[opts.index] : null;
  pickerAllowTemporary = Boolean(opts.allowTemporary) && pickerEditIndex == null;
  const title = $('location-picker-title');
  if(title)title.textContent = pickerEditIndex != null ? 'edit place' : 'add place';
  const saveBtn = $('picker-save');
  if(saveBtn)saveBtn.textContent = pickerEditIndex != null ? 'save changes' : 'add place';
  const nameEl = $('picker-name');
  const searchEl = $('picker-search');
  if(nameEl)nameEl.value = opts.name || '';
  pickerNameSource = opts.name ? 'user' : 'none';
  if(searchEl)searchEl.value = '';
  const tempRow = $('picker-temp-row');
  const tempCheck = $('picker-temporary');
  if(tempRow)tempRow.hidden = !pickerAllowTemporary;
  if(tempCheck)tempCheck.checked = Boolean(opts.temporary);
  pickerTypeSource = existing?.placeType || opts.placeType ? 'user' : 'none';
  syncPickerTypeSelect(existing?.placeType || opts.placeType || '');
  pickerEnvValue = existing ? normalizeLocationEnvironment(existing.environment) : normalizeLocationEnvironment(opts.environment);
  if(pickerEnvValue === 'none')pickerEnvValue = '';
  syncPickerEnvButtons();
  $('picker-save').disabled = false;
  document.querySelector('.picker-coords-details').open = false;
  setPickerSearchScope('near');
  $('location-picker-sheet').inert = false;
  openSheet('location-picker-sheet',{reopen:()=>openLocationPicker(opts)});
  const start = pickerOpeningCenter(opts);
  const lat = start.lat;
  const lng = start.lng;
  ensureLocationPickerMap(lat,lng);
  const hit = opts.address || existing?.placeType ? {address:opts.address,placeType:existing?.placeType} : null;
  pickerSetCoords(lat,lng,{reverse:false,hit});
  pickerOpenAnchor = {lat, lng};
  refreshPickerScopeHint();
}

function closeLocationPicker(){
  leavePickerSearch();
  closeSheet('location-picker-sheet');
  $('location-picker-sheet').inert = true;
  destroyLocationPickerMap();
  pickerEditIndex = null;
  pickerOnCreated = null;
  pickerOpenAnchor = null;
  pickerAllowTemporary = false;
  pickerTypeSource = 'none';
  pickerEnvValue = '';
}

// Map camera only. The New York fallback is a blank map, never a search bias.
// A saved-place midpoint stays on this phone and is not uploaded.
function pickerOpeningCenter(opts){
  if(Number.isFinite(opts.lat) && Number.isFinite(opts.lng))return {lat:opts.lat, lng:opts.lng};
  if(currentCoord && Number.isFinite(currentCoord.lat) && Number.isFinite(currentCoord.lng)){
    return {lat:currentCoord.lat, lng:currentCoord.lng};
  }
  const homeLat = sortSettings?.homeCityLat;
  const homeLng = sortSettings?.homeCityLng;
  if(Number.isFinite(homeLat) && Number.isFinite(homeLng))return {lat:homeLat, lng:homeLng};
  const locs = (sortSettings && sortSettings.locations) || [];
  const pts = locs.filter(loc => Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng)));
  if(pts.length){
    return {
      lat:pts.reduce((sum, loc) => sum + Number(loc.lat), 0) / pts.length,
      lng:pts.reduce((sum, loc) => sum + Number(loc.lng), 0) / pts.length
    };
  }
  return {lat:40.7359, lng:-74.0036};
}

function pickerVisibleBounds(){
  if(!pickerMap || typeof pickerMap.getBounds !== 'function')return null;
  let bounds = null;
  try{ bounds = pickerMap.getBounds(); }catch{ return null; }
  if(!bounds)return null;
  return {
    minLat:bounds.getSouth(),
    maxLat:bounds.getNorth(),
    minLng:bounds.getWest(),
    maxLng:bounds.getEast()
  };
}

function pickerMapCenter(){
  if(!pickerMap || typeof pickerMap.getCenter !== 'function')return null;
  try{
    const center = pickerMap.wrapLatLng(pickerMap.getCenter());
    if(!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng))return null;
    return {lat:center.lat, lng:center.lng};
  }catch{
    return null;
  }
}

// A real pan, not the tiny shift from opening the map. The pin can move a
// little when the sheet finishes laying out.
function pickerMapMoved(){
  const center = pickerMapCenter();
  if(!center || !pickerOpenAnchor)return false;
  if(typeof haversineMetres !== 'function')return false;
  return haversineMetres(pickerOpenAnchor.lat, pickerOpenAnchor.lng, center.lat, center.lng) > 400;
}

function pickerMovedFocus(){
  if(!pickerMapMoved())return null;
  return pickerMapCenter();
}

function pickerScopeHint(scope){
  if(scope === 'map')return 'Only places inside the map view.';
  if(scope === 'any')return 'Your location stays on this phone.';
  if(pickerMapMoved())return 'Near where you moved the map.';
  const city = String(sortSettings && sortSettings.homeCityName || '').split(',')[0].trim();
  if(city)return `Near ${city}.`;
  if(currentCoord && Number.isFinite(currentCoord.lat))return 'Near your current area.';
  return 'Set a city in Locations, or use Anywhere.';
}

function refreshPickerScopeHint(){
  const hint = $('picker-scope-hint');
  if(hint)hint.textContent = pickerScopeHint(pickerSearchScope);
  $('picker-scope-near').textContent = pickerMapMoved() ? 'Near pin' : 'Near home';
}

function setPickerSearchScope(scope){
  const next = scope === 'map' || scope === 'any' ? scope : 'near';
  if(next !== pickerSearchScope)clearPickerSearch();
  pickerSearchScope = next;
  document.querySelectorAll('[data-picker-scope]').forEach(btn => {
    const on = btn.dataset.pickerScope === next;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  refreshPickerScopeHint();
}

function pickerResultDistance(hit, focus){
  if(!focus || typeof formatGeocodeDistance !== 'function' || typeof haversineMetres !== 'function')return '';
  if(!Number.isFinite(hit.lat) || !Number.isFinite(hit.lng))return '';
  return formatGeocodeDistance(haversineMetres(focus.lat, focus.lng, hit.lat, hit.lng));
}

function pickerSearchEmptyCopy(scope, status){
  if(status === 'unavailable')return '<b>Search is unavailable right now.</b> Check your connection, or place the pin on the map yourself.';
  if(scope === 'map')return '<b>No matches in this map area.</b> Zoom out or change the search area.';
  return '<b>No matches.</b> Try the full address, a landmark, or coordinates like 31.52, 74.35.';
}

// PURE: which saved place (if any) is essentially the same point as a result —
// used for the "saved" badge so users see a duplicate before saving it.
function pickerSavedMatch(hit){
  if(!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng))return null;
  const locs = normalizeLocationRegistry(sortSettings && sortSettings.locations);
  for(const loc of locs){
    if(loc.temporary)continue;
    if(Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && haversineMetres(loc.lat,loc.lng,hit.lat,hit.lng) < 80)return loc;
  }
  return null;
}

// PURE: one result / suggestion / recent row.
function pickerResultRow(hit,idx,kind,focus){
  const distance = pickerResultDistance(hit, focus);
  const saved = pickerSavedMatch(hit);
  const detail = [distance, hit.address || '', saved ? 'saved' : '']
    .filter(Boolean).join(' · ');
  const typeIcon = emojiForPlaceType(hit.placeType);
  return `<button type="button" class="location-result" data-picker-result="${idx}" data-picker-kind="${kind}">
    <span class="location-result-mark" aria-hidden="true">${typeIcon || '<i class="ti ti-map-pin"></i>'}</span><span><b>${escapeHtml(hit.name)}</b><small>${escapeHtml(detail)}</small></span><i class="ti ti-chevron-right location-result-arrow" aria-hidden="true"></i>
  </button>`;
}

// RENDER: a page of hits into the floating results panel.
function renderPickerHitList(hits, label, focus){
  const resultsWrap = $('picker-results');
  if(!resultsWrap)return;
  resultsWrap.hidden = false;
  setPickerSearching(true);
  resultsWrap.innerHTML = `<p class="location-results-label">${escapeHtml(label)}</p>`
    + hits.map((hit,idx)=>pickerResultRow(hit,idx,'result',focus)).join('');
}

async function searchPickerLocations(){
  const searchEl = $('picker-search');
  const resultsWrap = $('picker-results');
  const btn = $('picker-search-btn');
  if(!searchEl || !resultsWrap)return;
  const q = searchEl.value.trim();
  if(!q){ showToast('enter a place or address'); searchEl.focus(); return; }
  refreshPickerScopeHint();
  const scope = pickerSearchScope === 'map' || pickerSearchScope === 'any' ? pickerSearchScope : 'near';
  const bounds = scope === 'map' ? (pickerSearchBounds || pickerVisibleBounds()) : null;
  if(scope === 'map' && !bounds){
    showToast('The map is still opening. Try again in a moment.');
    return;
  }
  const categoryTags = geocodeOsmTagsForQuery(q);
  const searchGen = ++pickerSearchGen;
  pickerTypeaheadGen += 1;
  if(pickerTypeaheadTimer){ clearTimeout(pickerTypeaheadTimer); pickerTypeaheadTimer = null; }
  resultsWrap.hidden = false;
  setPickerSearching(true);
  resultsWrap.setAttribute('aria-busy','true');
  resultsWrap.innerHTML = '<p class="field-hint location-search-status"><i class="ti ti-loader-2" aria-hidden="true"></i> Searching…</p>';
  if(btn){ btn.disabled = true; btn.textContent = 'searching…'; }
  let found = [];
  try{
    found = await geocodeSearch(q, {
      limit:6,
      scope:scope === 'any' ? 'anywhere' : scope,
      bounds,
      focus:scope === 'near' ? pickerMovedFocus() : null
    });
    if(searchGen !== pickerSearchGen)return;
    pendingPickerResults = found;
  }catch{
    if(searchGen !== pickerSearchGen)return;
    pendingPickerResults = [];
    found = [];
  }
  if(searchGen !== pickerSearchGen)return;
  resultsWrap.removeAttribute('aria-busy');
  if(btn){ btn.disabled = false; btn.textContent = 'search'; }
  if(!pendingPickerResults.length){
    const status = found && found.status === 'unavailable' ? 'unavailable' : 'empty';
    resultsWrap.innerHTML = `<p class="field-hint location-search-status">${pickerSearchEmptyCopy(scope, status)}</p>`;
    return;
  }
  const focus = found && found.focus;
  let label = found && found.widened
    ? 'Matches from a wider area'
    : 'Results';
  // A category search ("gym") that only surfaced far-away venues gets an
  // honest label instead of pretending these are nearby — Photon's text
  // search matches venues *named* "Gym" worldwide when the type filter has
  // nothing close enough.
  if(scope === 'near' && categoryTags && focus && Number.isFinite(focus.lat)){
    const allFar = pendingPickerResults.every(r =>
      !Number.isFinite(r.lat) || haversineMetres(focus.lat, focus.lng, r.lat, r.lng) > 25000);
    if(allFar){
      const city = String(sortSettings && sortSettings.homeCityName || '').split(',')[0].trim() || 'your area';
      label = `No ${q.toLowerCase()} near ${city}. Farther matches:`;
    }
  }
  renderPickerHitList(pendingPickerResults, label, focus);
}

// ASYNC: Photon-only suggestions as the user types (300ms debounce, 3+ chars).
// The explicit search button / Enter still runs the full dual-provider pass.
function handlePickerSearchInput(){
  const searchEl = $('picker-search');
  if(!searchEl)return;
  const q = searchEl.value.trim();
  clearPickerSearch();
  setPickerSearching(true);
  if(!q){ showPickerRecents(); return; }
  if(q.length < 3)return;
  // Category queries ("gym", "cafe") are useless as suggestions: Photon's
  // text search matches venues *named* that word worldwide, which reads as
  // junk in the dropdown. The full search handles categories with tag
  // filters and an honest empty-state instead.
  if(geocodeOsmTagsForQuery(q))return;
  const gen = pickerTypeaheadGen;
  pickerTypeaheadTimer = setTimeout(async ()=>{
    pickerTypeaheadTimer = null;
    if(gen !== pickerTypeaheadGen)return;
    const scope = pickerSearchScope === 'map' || pickerSearchScope === 'any' ? pickerSearchScope : 'near';
    const bounds = scope === 'map' ? (pickerSearchBounds || pickerVisibleBounds()) : null;
    if(scope === 'map' && !bounds)return;
    let hits = [];
    try{
      hits = await geocodeSearch(q, {
        limit:5,
        scope:scope === 'any' ? 'anywhere' : scope,
        bounds,
        focus:scope === 'near' ? pickerMovedFocus() : null,
        photonOnly:true
      });
    }catch{ hits = []; }
    if(gen !== pickerTypeaheadGen)return;
    const searchElNow = $('picker-search');
    if(!searchElNow || searchElNow.value.trim() !== q)return;
    if(!hits.length)return;
    const resultsWrap = $('picker-results');
    if(resultsWrap && resultsWrap.getAttribute('aria-busy') === 'true')return; // full search running
    pendingPickerResults = hits.slice();
    renderPickerHitList(pendingPickerResults, 'suggestions', hits.focus || null);
  },300);
}

// RENDER: recently picked places, shown when the search field focuses empty.
function showPickerRecents(){
  const searchEl = $('picker-search');
  const resultsWrap = $('picker-results');
  if(!searchEl || !resultsWrap)return;
  setPickerSearching(true);
  if(searchEl.value.trim() || !resultsWrap.hidden)return;
  const recents = recentPlacePicks();
  if(!recents.length)return;
  resultsWrap.hidden = false;
  resultsWrap.innerHTML = '<p class="location-results-label">recent</p>'
    + recents.map((hit,idx)=>pickerResultRow(hit, idx, 'recent')).join('');
}

function recentPlacePicks(){
  const raw = (sortSettings && Array.isArray(sortSettings[PICKER_RECENTS_KEY])) ? sortSettings[PICKER_RECENTS_KEY] : [];
  return raw.filter(hit => hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng) && hit.name).slice(0,PICKER_RECENTS_MAX);
}

function rememberRecentPick(hit){
  if(!hit || !hit.name || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng))return;
  const list = recentPlacePicks().filter(r =>
    r.name !== hit.name || haversineMetres(r.lat,r.lng,hit.lat,hit.lng) >= 80);
  list.unshift({ name:String(hit.name).slice(0,48), address:String(hit.address || '').slice(0,120), lat:hit.lat, lng:hit.lng, placeType:hit.placeType || '', osmType:hit.osmType, osmId:hit.osmId });
  try{ saveSortSettings({...sortSettings, [PICKER_RECENTS_KEY]:list.slice(0,PICKER_RECENTS_MAX)}); }catch{ /* best-effort */ }
}

function pickRecentResult(idx){
  const hit = recentPlacePicks()[idx];
  if(!hit)return;
  applyPickerHit(hit);
}

function applyPickerHit(hit){
  if(!hit || !Number.isFinite(hit.lat) || !Number.isFinite(hit.lng))return;
  leavePickerSearch();
  pickerSetCoords(hit.lat,hit.lng,{reverse:false,pan:false,hit:{...hit,source:{lat:hit.lat,lng:hit.lng}}});
  pickerPanTo(hit.lat,hit.lng,Math.max(pickerMap?.getZoom() || 15,16));
  pickerOpenAnchor = {lat:hit.lat,lng:hit.lng};
  refreshPickerScopeHint();
  rememberRecentPick(hit);
  refreshPickerPlaceDetails();
  $('picker-map').focus({preventScroll:true});
}

function pickPickerResult(idx){
  applyPickerHit(pendingPickerResults[idx]);
}

// ASYNC: resolve venue type + opening hours for the current pin. Search hits
// from Nominatim carry hours inline; Photon hits resolve through a Nominatim
// /lookup using the hit's OSM ID.
function refreshPickerPlaceDetails(){
  const pin = pickerCurrentHit;
  if(!pin || !pin.osmType || !pin.osmId || pin.openingHours)return;
  // Same-pin check by position, not object identity: a pick's pan fires
  // moveend, and syncPickerPinToMapCenter stores a spread copy of the hit,
  // so the pin object may legitimately differ while staying the same place.
  const samePin = () => {
    const cur = pickerCurrentHit;
    if(!cur || !Number.isFinite(cur.lat) || !Number.isFinite(cur.lng))return false;
    return haversineMetres(cur.lat,cur.lng,pin.lat,pin.lng) <= 120;
  };
  const applyDetails = details => {
    if(!details || !samePin())return;
    const cur = pickerCurrentHit;
    if(details.placeType){
      cur.placeType = details.placeType;
      if(pickerTypeSource !== 'user'){
        syncPickerTypeSelect(details.placeType);
        syncPickerEnvButtons();
      }
    }
    if(details.openingHours)cur.openingHours = details.openingHours;
    renderPickerPlaceFacts();
  };
  const pending = lookupOsmPlaceDetails(pin).then(details=>{
    applyDetails(details);
    if(details)return;
    // Nominatim's usage policy throttles the second lookup of a fast
    // pick-pick flow (1 req/s); one spaced retry keeps details filling in
    // practice without doubling traffic on the common path.
    setTimeout(()=>{
      if(!samePin() || pickerCurrentHit.openingHours)return;
      const retry = lookupOsmPlaceDetails(pin).then(applyDetails)
        .finally(()=>{ if(pickerDetailsPending === retry)pickerDetailsPending = null; });
      pickerDetailsPending = retry;
    },1100);
  }).finally(()=>{ if(pickerDetailsPending === pending)pickerDetailsPending = null; });
  pickerDetailsPending = pending;
}

// RENDER: the fact card — venue type chip + hours summary from OSM.
function renderPickerPlaceFacts(){
  const facts = $('picker-place-facts');
  if(!facts)return;
  const hit = pickerCurrentHit;
  const type = hit && hit.placeType;
  const hours = hit && hit.openingHours;
  const label = placeTypeLabel(type);
  const parsed = parseOsmOpeningHours(hours);
  const summary = parsed.ok ? pickerHoursSummary(parsed) : '';
  facts.hidden = !label && !summary;
  if(facts.hidden){ facts.replaceChildren(); return; }
  facts.innerHTML = (label ? `<span class="picker-fact-chip">${escapeHtml(label)}</span>` : '')
    + '<a class="picker-fact-source" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    + (summary ? `<span class="picker-fact-hours">${escapeHtml(summary)}</span>` : '');
}

// PURE: compact hours summary — "6:00 AM–11:00 PM daily" or
// "Mon–Fri 9:00 AM–5:00 PM · closed Sat, Sun".
function pickerHoursSummary(parsed){
  if(!parsed.hoursByDay)return 'Open 24 hours';
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const groups = [];
  for(const day of [1,2,3,4,5,6,0]){
    const hours = parsed.hoursByDay[day];
    const key = hours ? `${hours.start}-${hours.end}` : 'closed';
    const last = groups.at(-1);
    if(last?.key === key){
      last.endDay = day;
      continue;
    }
    groups.push({key,hours,startDay:day,endDay:day});
  }
  const dayLabel = ({startDay,endDay})=>startDay === endDay
    ? dayNames[startDay] : `${dayNames[startDay]}–${dayNames[endDay]}`;
  const open = groups.filter(group=>group.hours).map(group=>{
    const label = groups.length === 1 ? 'daily' : dayLabel(group);
    return `${label} ${formatTimeShort(group.hours.start)}–${formatTimeShort(group.hours.end)}`;
  });
  const closed = groups.filter(group=>!group.hours).map(dayLabel);
  if(closed.length)open.push(`closed ${closed.join(', ')}`);
  return open.join(' · ');
}

function applyPickerCoordsInputs(){
  const lat = Number($('picker-lat').value.trim() || NaN);
  const lng = Number($('picker-lng').value.trim() || NaN);
  if(!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180){
    showToast('enter valid lat / lng');
    return;
  }
  pickerSetCoords(lat,lng);
  document.querySelector('.picker-coords-details').open = false;
  $('location-picker-sheet').classList.remove('kb-open','kb-visible');
  $('picker-content').scrollTop = 0;
  $('picker-map').focus({preventScroll:true});
}

function centerPickerOnGps(){
  // Direct request from this tap — the button itself is the user gesture +
  // rationale ("move pin to my location"). Avoid stacking a second sheet over
  // the map picker (breaks iOS hit-testing).
  const gen = pickerMapGen;
  requestLocationAccess({quiet:false,updateAnchor:false,enableHighAccuracy:true}).then(status=>{
    if(gen !== pickerMapGen || status !== 'granted' || !currentCoord)return;
    const {lat,lng} = currentCoord;
    pickerSetCoords(lat,lng,{pan:false});
    pickerPanTo(lat,lng,Math.max(pickerMap?.getZoom() || 15,16));
    pickerOpenAnchor = {lat,lng};
    refreshPickerScopeHint();
    if(pickerCurrentDot && pickerCurrentDotRing){
      pickerCurrentDot.setLatLng([lat,lng]);
      pickerCurrentDotRing.setLatLng([lat,lng]);
      pickerCurrentDotRing.setRadius(Math.max(60,Number(currentCoord.accuracy) || 100));
    }else addPickerCurrentDot();
    showToast('pin moved to your location');
  });
}

function pickerZoom(delta){
  if(!pickerMap)return;
  try{
    if(delta > 0)pickerMap.zoomIn();
    else pickerMap.zoomOut();
  }catch{ /* ignore */ }
}

// PURE: hours fields a picked place can auto-fill. Only fills blank hours —
// the planner's windows for this place are the user's call once set.
function pickerHoursAutofill(hit){
  if(!hit || !hit.openingHours)return null;
  const parsed = parseOsmOpeningHours(hit.openingHours);
  if(!parsed.ok || !parsed.hoursByDay)return null;
  const perDayKeys = Object.keys(parsed.hoursByDay || {});
  const openKeys = perDayKeys.filter(d => parsed.hoursByDay[d]);
  const allSame = openKeys.length > 0 && openKeys.every(d => {
    const h = parsed.hoursByDay[d];
    const other = parsed.hoursByDay[openKeys[0]];
    return h && other && h.start === other.start && h.end === other.end;
  });
  const fill = {};
  if(parsed.defaultStart != null && parsed.defaultEnd != null){
    fill.allowedTimeStart = parsed.defaultStart;
    fill.allowedTimeEnd = parsed.defaultEnd;
  }
  if(parsed.closedDays && parsed.closedDays.length)fill.closedDays = parsed.closedDays.slice();
  if(!allSame && openKeys.length){
    const hoursByDay = {};
    for(const d of perDayKeys)hoursByDay[d] = parsed.hoursByDay[d];
    fill.hoursByDay = hoursByDay;
  }
  return Object.keys(fill).length ? fill : null;
}

async function saveLocationPicker(){
  const button = $('picker-save');
  if(button.disabled)return;
  const name = $('picker-name').value.trim();
  const pin = pickerCurrentHit;
  if(!name){ showToast('Enter a place name.'); $('picker-name').focus(); return; }
  if(!pin){ showToast('Drop a pin on the map.'); return; }
  if($('picker-lat').value.trim() !== pickerCoordText(pin.lat)
      || $('picker-lng').value.trim() !== pickerCoordText(pin.lng)){
    showToast('Apply the coordinates before saving.');
    return;
  }

  // Give an active lookup a short grace period. Leaving or moving the pin
  // during this wait invalidates the save, and repeat taps commit only once.
  if(pickerReverseTimer){
    clearTimeout(pickerReverseTimer);
    pickerReverseTimer = null;
    resolvePickerPinAddress(pin);
  }
  const pending = pickerDetailsPending || pickerReversePending;
  if(pending){
    const gen = pickerMapGen;
    button.disabled = true;
    let timeout;
    try{
      await Promise.race([pending,new Promise(resolve=>{ timeout = setTimeout(resolve,800); })]);
    }finally{
      clearTimeout(timeout);
      if(gen === pickerMapGen)button.disabled = false;
    }
    if(pickerCurrentHit !== pin || $('location-picker-sheet').classList.contains('searching')
        || $('picker-name').value.trim() !== name
        || $('picker-lat').value.trim() !== pickerCoordText(pin.lat)
        || $('picker-lng').value.trim() !== pickerCoordText(pin.lng))return;
  }

  const chosenType = $('picker-place-type') ? normalizePlaceType($('picker-place-type').value) : normalizePlaceType(pin.placeType);
  const patch = {
    name,
    address:pin.address || '',
    lat:pin.lat,
    lng:pin.lng,
    placeType:chosenType,
    environment:normalizeLocationEnvironment(pickerEnvValue)
  };
  if(pickerAllowTemporary && $('picker-temporary')?.checked)patch.temporary = true;
  const hoursFill = pickerHoursAutofill(pin);
  if(hoursFill)Object.assign(patch,hoursFill);
  const emoji = emojiForPlaceType(chosenType);
  if(emoji)patch.emoji = emoji;
  if(pickerEditIndex != null){
    // Editing never overwrites windows the user configured earlier: hours
    // fields only apply when the place had none, and a chosen emoji stays.
    const existing = normalizeLocationRegistry(sortSettings.locations)[pickerEditIndex];
    let hoursApplied = Boolean(hoursFill);
    if(existing){
      const hasHours = Number.isFinite(existing.allowedTimeStart)
        || (Array.isArray(existing.closedDays) && existing.closedDays.length)
        || (existing.hoursByDay && Object.keys(existing.hoursByDay).length);
      if(hasHours && hoursFill){
        delete patch.allowedTimeStart;
        delete patch.allowedTimeEnd;
        delete patch.closedDays;
        delete patch.hoursByDay;
        hoursApplied = false;
      }
      if(existing.emoji)delete patch.emoji;
    }
    saveLocationPatch(pickerEditIndex,patch);
    showToast(hoursApplied ? 'pin updated · hours filled from map data' : 'pin updated');
    closeLocationPicker();
    return;
  }
  const id = addLocation(patch);
  if(id){
    if(hoursFill)showToast(`Added ${name} · hours filled from map data`);
    // Capture before closeLocationPicker clears the one-shot callback.
    const cb = pickerOnCreated;
    closeLocationPicker();
    if(typeof cb === 'function')cb(id);
  }
}

/** HANDLER: open the pinned place in the system maps app from the picker. */
function openPickerPlaceInMaps(){
  if(!pickerCurrentHit){ showToast('Drop a pin on the map.'); return; }
  const url = mapsDirectionsUrl(pickerCurrentHit,sortSettings.defaultTravelMode);
  if(!url)return;
  window.open(url,'_blank','noopener');
}

// HYBRID: commit the default open-window pair. Both present → set both; both
// empty → 24h; exactly one present → hold (leave the DOM as-is so the user can
// finish typing the other half, since an incomplete window normalizes to 24h).
function commitLocationHours(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-start]');
  const eEl = row.querySelector('[data-loc-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:s,allowedTimeEnd:e});
  }else if(s === null && e === null){
    clearLocationHoursEditing(index);
    saveLocationPatch(index,{allowedTimeStart:null,allowedTimeEnd:null});
  }
  // else: exactly one filled — hold. pendingLocationHoursEdit keeps the
  // fields open/enabled through any unrelated re-render until this resolves.
}

// HYBRID: commit the preferred-time pair (same incomplete-pair rule).
function commitLocationPref(index){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector('[data-loc-pref-start]');
  const eEl = row.querySelector('[data-loc-pref-end]');
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationPatch(index,{preferredTimeStart:s,preferredTimeEnd:e});
  else if(s === null && e === null)saveLocationPatch(index,{preferredTimeStart:null,preferredTimeEnd:null});
}

// HYBRID: commit one per-day override pair. Both present → {start,end}; both
// empty → override dropped (falls back to default); exactly one → hold.
function commitLocationDayHours(index,weekday){
  const row = document.querySelector(`[data-location-row="${index}"]`);
  if(!row)return;
  const sEl = row.querySelector(`[data-loc-day-start="${weekday}"]`);
  const eEl = row.querySelector(`[data-loc-day-end="${weekday}"]`);
  const cEl = row.querySelector(`[data-loc-day-closed="${weekday}"]`);
  if(cEl && cEl.checked){ saveLocationDayPatch(index,weekday,{closed:true}); return; }
  const s = timeInputToMinutes(sEl ? sEl.value : '');
  const e = timeInputToMinutes(eEl ? eEl.value : '');
  if(s !== null && e !== null)saveLocationDayPatch(index,weekday,{start:s,end:e,closed:false});
  else if(s === null && e === null)saveLocationDayPatch(index,weekday,{closed:false});
}

// HYBRID: patch sort state and re-sync UI
