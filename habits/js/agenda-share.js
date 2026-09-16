let _agendaPublishTimer = null;
let _agendaPublishInFlight = false;
let _agendaPublishGate = Promise.resolve();
let _lastAgendaProjectionSig = '';
let _pendingAgendaWeek = null;
let _agendaPairApproval = null;
let _agendaPairScannerStream = null;
let _agendaPairScannerFrame = null;
let _agendaPairScannerGeneration = 0;
let _agendaPairScannerBusy = false;
let _agendaCompletionSyncAt = 0;
let _agendaLastPublish = null;

function agendaLastPublishSummary(){
  return _agendaLastPublish;
}

function noteAgendaPublish(reason, details){
  _agendaLastPublish = { at:Date.now(), reason, ...(details || {}) };
  if(typeof tingsShareLog === 'function') tingsShareLog(`agenda.publish.${reason}`, _agendaLastPublish);
}

const HOUSEHOLD_AGENDA_MAX_DAYS = 2;
const HOUSEHOLD_AGENDA_MAX_ROWS = 50;
const HOUSEHOLD_AGENDA_DEFAULT_ROWS = 20;
const HOUSEHOLD_AGENDA_DEFAULT_HOURS = 24;
const HOUSEHOLD_AGENDA_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUSEHOLD_AGENDA_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const SHARED_DISPLAY_COMPLETION_POLL_MS = 30 * 1000;
const SHARED_DISPLAY_ROW_MAP_REVISIONS = 12;
// The Worker accepts 256 KiB of encrypted snapshot bytes. Keep headroom for
// AES-GCM metadata while sizing the complete UTF-8 projection, not just the
// replica subsection.
const SHARED_SNAPSHOT_MAX_PLAINTEXT_BYTES = 248 * 1024;
// A clone replica is encrypted once on its own and then carried inside the
// outer agenda ciphertext. Its base64 wrapper expands the transport, so keep
// a conservative bound before sealing the nested payload.
const SHARED_REPLICA_SNAPSHOT_MAX_PLAINTEXT_BYTES = 176 * 1024;
const HOUSEHOLD_AGENDA_CURRENT_WEATHER_MS = 15 * 60 * 1000;
const HOUSEHOLD_AGENDA_MAX_DEVICES = 2;
const HOUSEHOLD_AGENDA_QUEUE_LIMIT = 100;
let _agendaPublishQueued = false;
let _agendaPublishQueuedForce = false;

function householdAgendaTimezone(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch(_){ return 'UTC'; }
}

function householdPlannerProvenance(week){
  if(!week || !week.optimized) return 'fast';
  if(week.plannerSolveStatus === 'fallback') return 'fast';
  if(week.plannerSolveStatus === 'optimal') return 'glpk-opt';
  return 'glpk-feasible';
}

function householdLocationLabel(id,settings){
  if(!id) return '';
  const registry = settings && Array.isArray(settings.locations) ? settings.locations : undefined;
  const loc = typeof locationById === 'function' ? locationById(id,registry) : null;
  return loc && loc.name ? String(loc.name) : '';
}

function householdAgendaSettings(opts = {}){
  if(opts && opts.settings) return opts.settings;
  if(typeof sortSettings !== 'undefined' && sortSettings) return sortSettings;
  if(typeof loadSortSettings === 'function') return loadSortSettings();
  return {};
}

// Display-safe weather only: emoji + already-converted feels-like text. No
// place names — the owner knows which city they live in, and coordinates,
// location ids, and forecast samples stay on the owner phone.
function householdAgendaPublicWeather(summary){
  if(!summary || !summary.condition) return null;
  const emoji = String(summary.condition.emoji || '').slice(0,8);
  const temperature = typeof weatherPeriodTemperatureRange === 'function'
    ? String(weatherPeriodTemperatureRange(summary) || '').slice(0,16)
    : '';
  if(!emoji && !temperature) return null;
  const cue = {};
  if(emoji) cue.emoji = emoji;
  if(temperature) cue.temperature = temperature;
  return cue;
}

function householdAgendaWeatherCue(start,end,locationId,settings,now){
  if(!settings || settings.minimalMode) return null;
  if(typeof weatherPeriodSummary !== 'function') return null;
  const from = Number(start);
  const to = Number(end);
  if(!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  const summary = weatherPeriodSummary(from,to,settings,locationId || null,now);
  return householdAgendaPublicWeather(summary);
}

function householdAgendaCurrentWeather(settings,now){
  return householdAgendaWeatherCue(now,now + HOUSEHOLD_AGENDA_CURRENT_WEATHER_MS,null,settings,now);
}

function replicaStableValue(value){
  if(Array.isArray(value)) return value.map(replicaStableValue);
  if(value && typeof value === 'object'){
    return Object.keys(value).sort().reduce((out,key)=>{
      out[key] = replicaStableValue(value[key]);
      return out;
    },{});
  }
  return value;
}

// Definition identity deliberately excludes activity and short-lived planner
// state. It is used as an optimistic-concurrency token when a personal clone
// edits a task or habit from an older encrypted snapshot.
function replicaHabitDefinition(habit){
  const copy = JSON.parse(JSON.stringify(habit || {}));
  delete copy.logs;
  delete copy.lastLog;
  delete copy.snoozedUntil;
  return replicaStableValue(copy);
}

function replicaHabitDefinitionHash(habit){
  const text = JSON.stringify(replicaHabitDefinition(habit));
  let hash = 2166136261;
  for(let i=0;i<text.length;i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return (hash >>> 0).toString(16).padStart(8,'0');
}

function householdAgendaRowWeather(row,habit,settings,now){
  if(!row || !settings || settings.minimalMode) return null;
  if(row.kind === 'fill' || row.kind === 'scheduled'){
    const show = typeof weatherItemShowsAmbient === 'function'
      ? weatherItemShowsAmbient(habit)
      : Boolean(habit && habit.showWeather);
    if(!show) return null;
    const locationId = typeof weatherDisplayLocationId === 'function'
      ? weatherDisplayLocationId(habit,row)
      : null;
    return householdAgendaWeatherCue(row.start,row.end,locationId,settings,now);
  }
  if(row.kind === 'travel'){
    if(settings.showWeatherOnTravel === false) return null;
    return householdAgendaWeatherCue(row.start,row.end,row.to || null,settings,now);
  }
  if(row.kind === 'blocked'){
    if(!settings.showWeatherOnBusyTimes) return null;
    return householdAgendaWeatherCue(row.start,row.end,row.locationId || null,settings,now);
  }
  return null;
}

// Busy times live in the home sequence, not the planner timeline. Skip the
// live-GPS "from here" leg so the display never learns the phone's coordinates
// or that the owner is away from a saved place.
function householdAgendaSourceRows(day,settings){
  const timeline = Array.isArray(day && day.timeline) ? day.timeline : [];
  const seqSettings = { ...(settings || {}), homeExtraMode:'cards' };
  let rows = typeof homeDaySequence === 'function'
    ? homeDaySequence(day,seqSettings).filter(row=>{
        if(!row) return false;
        if(row.fromCurrentCoord) return false;
        if(typeof CURRENT_COORD_ID !== 'undefined' && row.from === CURRENT_COORD_ID) return false;
        return true;
      })
    : timeline.slice();
  const seenBlocked = new Set(
    rows.filter(row=>row && row.kind === 'blocked').map(row=>`${Number(row.start)}|${Number(row.end)}`)
  );
  for(const row of timeline){
    if(!row || row.kind !== 'blocked') continue;
    const key = `${Number(row.start)}|${Number(row.end)}`;
    if(seenBlocked.has(key)) continue;
    rows.push(row);
    seenBlocked.add(key);
  }
  if(!rows.some(row=>row && row.kind === 'travel')){
    for(const row of timeline){
      if(!row || row.kind !== 'travel' || row.fromCurrentCoord) continue;
      if(typeof CURRENT_COORD_ID !== 'undefined' && row.from === CURRENT_COORD_ID) continue;
      rows.push(row);
    }
  }
  return rows.sort((a,b)=>(a.start || 0) - (b.start || 0) || ((a.kind === 'blocked' ? 0 : 1) - (b.kind === 'blocked' ? 0 : 1)));
}

function householdRowStatus(row, habit){
  if(habit && typeof isDoingNow === 'function' && isDoingNow(habit)) return 'doing';
  if(row && row.kind === 'scheduled') return 'scheduled';
  return 'planned';
}

function householdProjectionHabit(row,data){
  const items = Array.isArray(data) ? data : [];
  const hid = row && row.h && row.h.hid;
  if(hid){
    const matched = items.find(item=>item && item.hid === hid);
    if(matched) return matched;
  }
  return row && row.i != null && items[row.i] ? items[row.i] : (row && row.h) || null;
}

function householdProjectionHabitActive(habit,dayBase,row = null){
  if(!habit) return false;
  if(habit.showOnSharedDisplay === false) return false;
  if(habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(habit)) return false;
  if(habit.breakable && typeof breakableBudgetMinutes === 'function'){
    return breakableBudgetMinutes(habit,dayBase) > 0;
  }
  if(row && row.occurrenceKey){
    if(normalizeLogs(habit.logs).some(log=>logOccurrenceKey(log) === row.occurrenceKey))return false;
  }else if(typeof completedOnDay === 'function' && completedOnDay(habit,dayBase)) return false;
  return true;
}

function householdProjectionAttachWeather(projected,row,habit,settings,now){
  const weather = householdAgendaRowWeather(row,habit,settings,now);
  if(weather) projected.weather = weather;
  return projected;
}

function householdProjectionRow(row, data, dayBase, rowMap, completedRowKeys, settings, now){
  const habit = householdProjectionHabit(row,data);
  const durationMinutes = Math.max(0, Math.round(((row.end || 0) - (row.start || 0)) / 60000));
  const base = {
    rowId:shareRandomHex(8),
    start:row.start || null,
    end:row.end || null,
    durationMinutes,
    status:'planned',
    title:'',
    emoji:'',
    locationLabel:'',
    travelFromLabel:'',
    travelToLabel:''
  };
  if(row.kind === 'blocked'){
    return householdProjectionAttachWeather({
      ...base,
      kind:'busy',
      title:String(row.label || 'Busy').slice(0,80) || 'Busy',
      locationLabel:householdLocationLabel(row.locationId,settings).slice(0,80)
    },row,habit,settings,now);
  }
  if(row.kind === 'travel'){
    return householdProjectionAttachWeather({
      ...base,
      kind:'travel',
      title:'Travel',
      travelFromLabel:row.fromName || householdLocationLabel(row.from,settings) || '',
      travelToLabel:row.toName || householdLocationLabel(row.to,settings) || ''
    },row,habit,settings,now);
  }
  if(row.kind === 'fill' || row.kind === 'scheduled'){
    if(!householdProjectionHabitActive(habit,dayBase,row)) return null;
    if(habit && completedRowKeys && completedRowKeys.has(`${habit.hid}|${Number(row.start) || 0}`)) return null;
    const completable = Boolean(habit && habit.type !== 'zero' && habit.hid && habit.allowSharedDisplayCompletion !== false);
    if(completable && rowMap){
      rowMap[base.rowId] = {
        hid:habit.hid,
        dayBase,
        start:base.start,
        minutes:durationMinutes,
        occurrenceKey:row.occurrenceKey || '',
        scheduleOptionId:row.scheduleOptionId || '',
        scheduledDay:row.scheduledDay || (typeof dateKey === 'function' ? dateKey(dayBase) : '')
      };
    }
    return householdProjectionAttachWeather({
      ...base,
      kind:'item',
      completable,
      hid:habit && habit.hid ? String(habit.hid).slice(0,64) : '',
      occurrenceKey:String(row.occurrenceKey || '').slice(0,160),
      scheduleOptionId:String(row.scheduleOptionId || '').slice(0,64),
      scheduledDay:/^\d{4}-\d{2}-\d{2}$/.test(String(row.scheduledDay || ''))
        ? String(row.scheduledDay)
        : (typeof dateKey === 'function' ? dateKey(dayBase) : ''),
      allowEarlyCompletion:Boolean(completable && habit && habit.type === 'task'),
      title:habit && habit.name ? String(habit.name).slice(0,80) : 'Scheduled item',
      emoji:habit && habit.emoji ? String(habit.emoji).slice(0,8) : '',
      emojiBgColor:habit && typeof normalizeEmojiBgColor === 'function' ? normalizeEmojiBgColor(habit.emojiBgColor) : '',
      status:householdRowStatus(row, habit),
      locationLabel:householdLocationLabel(row.locationId || (habit && habit.locationIds && habit.locationIds[0]),settings).slice(0,80)
    },row,habit,settings,now);
  }
  return null;
}

function buildHouseholdAgendaProjection(week, opts = {}){
  const feed = opts.feed || agendaFeedRecord();
  const now = opts.now || Date.now();
  const data = opts.data || (typeof load === 'function' ? load() : []);
  const configuredDays = typeof AGENDA_SHARE_DAYS !== 'undefined' ? AGENDA_SHARE_DAYS : HOUSEHOLD_AGENDA_MAX_DAYS;
  const requestedDays = Number.isFinite(opts.dayCount) ? opts.dayCount : configuredDays;
  const dayCount = Math.max(1,Math.min(HOUSEHOLD_AGENDA_MAX_DAYS,Math.round(requestedDays)));
  const days = ((week && week.days) || []).slice(0,dayCount);
  const scopeMode = opts.scopeMode || (feed && feed.scopeMode) || 'count';
  const rawScope = Number(opts.scopeValue != null ? opts.scopeValue : (feed && feed.scopeValue));
  const scopeValue = scopeMode === 'hours'
    ? Math.max(1,Math.min(48,Number.isFinite(rawScope) ? Math.round(rawScope) : HOUSEHOLD_AGENDA_DEFAULT_HOURS))
    : Math.max(1,Math.min(HOUSEHOLD_AGENDA_MAX_ROWS,Number.isFinite(rawScope) ? Math.round(rawScope) : HOUSEHOLD_AGENDA_DEFAULT_ROWS));
  const hardEnd = typeof dayStart === 'function'
    ? dayStart(now) + HOUSEHOLD_AGENDA_MAX_DAYS * 86400000
    : now + HOUSEHOLD_AGENDA_MAX_DAYS * 86400000;
  const horizon = scopeMode === 'hours' ? Math.min(hardEnd,now + scopeValue * 3600000) : hardEnd;
  let rowsLeft = scopeMode === 'count' ? scopeValue : HOUSEHOLD_AGENDA_MAX_ROWS;
  let totalRows = 0;
  const rowMap = {};
  const completedRowKeys = opts.completedRowKeys instanceof Set ? opts.completedRowKeys : new Set();
  const settings = householdAgendaSettings(opts);
  const currentWeather = householdAgendaCurrentWeather(settings,now);
  const projection = {
    schemaVersion:SHARE_SCHEMA_VERSION,
    feedId:feed && feed.feedId,
    title:String((feed && feed.title) || 'Shared display').slice(0,80),
    revision:(feed && Number(feed.lastRevision) || 0) + 1,
    generatedAt:now,
    timezone:householdAgendaTimezone(),
    rangeStart:days[0] ? days[0].dayBase : null,
    plannerProvenance:householdPlannerProvenance(week),
    scope:{ mode:scopeMode === 'hours' ? 'hours' : 'count', value:scopeValue },
    days:days.map(day=>{
      const timeline = householdAgendaSourceRows(day,settings);
      const rows = [];
      for(const row of timeline){
        if(rowsLeft <= 0) break;
        const projected = householdProjectionRow(row,data,day.dayBase,rowMap,completedRowKeys,settings,now);
        if(!projected) continue;
        if(projected.end && projected.end <= now) continue;
        if(projected.start && projected.start >= horizon) continue;
        rows.push(projected);
        rowsLeft -= 1;
        totalRows += 1;
      }
      const remaining = Math.max(0, Math.round(Number(day.remainingMinutes) || 0));
      if(scopeMode === 'count' && remaining > 0 && totalRows < HOUSEHOLD_AGENDA_MAX_ROWS){
        rows.push({
          rowId:shareRandomHex(8),
          kind:'open',
          start:null,
          end:null,
          title:'Open time',
          emoji:'',
          status:'open',
          durationMinutes:remaining,
          locationLabel:'',
          travelFromLabel:'',
          travelToLabel:''
        });
        totalRows += 1;
      }
      return {
        dateKey:day.dayKey || (typeof dateKey === 'function' ? dateKey(day.dayBase) : ''),
        weekdayLabel:typeof homeWeekDayLabel === 'function' ? homeWeekDayLabel(day, now) : '',
        dateLabel:new Date(day.dayBase).toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' }),
        openMinutes:remaining,
        plannedMinutes:Math.max(0, Math.round(Number(day.usedMinutes) || 0)),
        rows
      };
    })
  };
  const replica = buildHouseholdReplica(data,settings,feed,rowMap,now);
  if(replica){
    projection.replica = replica;
    Object.defineProperty(projection,'_replicaRowIds',{ value:replica._rowIds || {},enumerable:false });
  }
  if(currentWeather) projection.currentWeather = currentWeather;
  fitHouseholdProjectionPayload(projection);
  Object.defineProperty(projection,'_rowMap',{ value:rowMap,enumerable:false });
  return projection;
}

// The three published sync styles. `glance` deliberately withholds the replica
// so the paired screen keeps rendering the lightweight agenda page instead of
// installing (and planning) a whole Tings library — the only workable mode on
// low-power photo frames. `legacy` is the same suppression under its old name.
function householdAgendaSyncMode(feed){
  const raw = feed && feed.syncMode;
  if(raw === 'selected') return 'selected';
  if(raw === 'glance' || raw === 'legacy') return 'glance';
  return 'clone';
}

function householdAgendaOwnerControlsBlocked(){
  return typeof replicaDisplayRequested === 'function' && replicaDisplayRequested();
}

function householdAgendaDevices(feed){
  const list = Array.isArray(feed && feed.devices) ? feed.devices : [];
  const out = [];
  const seen = new Set();
  for(const item of list){
    const pairingId = String(item && item.pairingId || '');
    if(!/^[0-9a-f]{32}$/.test(pairingId) || seen.has(pairingId)) continue;
    seen.add(pairingId);
    out.push({
      pairingId,
      syncMode:householdAgendaSyncMode(item),
      pairedAt:Number(item && item.pairedAt) || 0
    });
    if(out.length >= HOUSEHOLD_AGENDA_MAX_DEVICES) break;
  }
  return out;
}

function householdAgendaHasStyle(feed,syncMode){
  return householdAgendaDevices(feed).some(device=>device.syncMode === syncMode);
}

function householdAgendaLibraryStyle(feed){
  const devices = householdAgendaDevices(feed);
  if(devices.some(device=>device.syncMode === 'clone')) return 'clone';
  if(devices.some(device=>device.syncMode === 'selected')) return 'selected';
  if(devices.length) return 'glance';
  return householdAgendaSyncMode(feed);
}

function householdAgendaApproveConflict(feed,syncMode){
  const devices = householdAgendaDevices(feed);
  const style = householdAgendaSyncMode({ syncMode });
  if(devices.length >= HOUSEHOLD_AGENDA_MAX_DEVICES){
    return 'Two displays are already signed in. Revoke one from the list first.';
  }
  if(style === 'glance' && devices.some(device=>device.syncMode === 'glance')){
    return 'A glance display is already signed in. Revoke that frame first, then pair this one.';
  }
  if(style !== 'glance' && devices.some(device=>device.syncMode !== 'glance')){
    return 'A full-app display is already signed in. Revoke that laptop or tablet first. One snapshot cannot serve two library styles.';
  }
  return '';
}

function reconcileHouseholdAgendaDevices(feed,sessions){
  if(!Array.isArray(sessions)) return householdAgendaDevices(feed);
  const live = [];
  const seen = new Set();
  for(const item of sessions){
    const pairingId = String(item && item.pairingId || '');
    if(!/^[0-9a-f]{32}$/.test(pairingId) || seen.has(pairingId)) continue;
    seen.add(pairingId);
    live.push(pairingId);
  }
  // Keep locally remembered screens. A GET can race ahead of the Worker
  // session row right after QR approval; dropping that pairing would publish
  // a glance-only snapshot and leave the clone waiting for a library.
  const kept = householdAgendaDevices(feed);
  const known = new Set(kept.map(device=>device.pairingId));
  const inferred = householdAgendaSyncMode(feed);
  for(const pairingId of live){
    if(kept.length >= HOUSEHOLD_AGENDA_MAX_DEVICES) break;
    if(known.has(pairingId)) continue;
    kept.push({ pairingId,syncMode:inferred,pairedAt:Date.now() });
    known.add(pairingId);
  }
  return kept;
}

function householdAgendaEmptyWeek(now = Date.now()){
  const base = typeof dayStart === 'function' ? dayStart(now) : now;
  return {
    optimized:false,
    days:[{
      dayBase:base,
      dayKey:typeof dateKey === 'function' ? dateKey(base) : '',
      usedMinutes:0,
      remainingMinutes:0,
      timeline:[]
    }]
  };
}

// A publish that started before QR approval must not write its captured feed
// back over the live pairing list, keys, or sync style.
function householdAgendaAdoptLiveFeed(feed){
  const live = agendaFeedRecord();
  if(!feed) return live;
  if(!live || live.feedId !== feed.feedId) return feed;
  const liveRevision = Number(live.lastRevision) || 0;
  const feedRevision = Number(feed.lastRevision) || 0;
  return {
    ...live,
    lastRevision:feedRevision > liveRevision ? feed.lastRevision : live.lastRevision,
    completionReceipts:feed.completionReceipts || live.completionReceipts,
    definitionReceipts:feed.definitionReceipts || live.definitionReceipts,
    cloneDefinitionChains:feed.cloneDefinitionChains || live.cloneDefinitionChains
  };
}

function commitAgendaFeedPublish(feed,fields){
  const next = { ...(householdAgendaAdoptLiveFeed(feed) || feed || {}), ...(fields || {}) };
  saveAgendaFeedRecord(next);
  return next;
}

function householdAgendaWithDevices(feed,devices){
  if(!feed) return feed;
  return { ...feed,devices:householdAgendaDevices({ devices }) };
}

// A paired display is a real Tings installation, not merely a renderer. The
// latest-state agenda envelope doubles as an encrypted replication snapshot so
// the existing zero-knowledge transport and QR authorization remain useful.
// Keeping `days` beside it lets older display builds continue to work.
function buildHouseholdReplica(data,settings,feed,rowMap,now = Date.now()){
  const mode = householdAgendaLibraryStyle(feed);
  if(mode === 'glance') return null;
  const source = Array.isArray(data) ? data : [];
  const previousRowIds = feed && feed.replicaRowIds && typeof feed.replicaRowIds === 'object'
    ? feed.replicaRowIds
    : {};
  const nextRowIds = {};
  const items = source.filter(h=>h && (mode === 'clone' || h.showOnSharedDisplay !== false)).map(h=>{
    const previousRowId = String(previousRowIds[h.hid] || '');
    const rowId = /^[0-9a-f]{16}$/.test(previousRowId) ? previousRowId : shareRandomHex(8);
    nextRowIds[h.hid] = rowId;
    rowMap[rowId] = {
      hid:h.hid,
      dayBase:typeof dayStart === 'function' ? dayStart(now) : now,
      start:0,
      minutes:Math.max(1,Math.min(720,Math.round(Number(h.durationMinutes) || 30))),
      occurrenceKey:'',scheduleOptionId:'',scheduledDay:'',replica:true
    };
    const copy = JSON.parse(JSON.stringify(h));
    copy.logs = normalizeLogs(copy.logs).slice(mode === 'clone' ? -80 : -30);
    return {
      rowId,habit:copy,
      access:mode === 'clone' || h.allowSharedDisplayCompletion !== false ? 'complete' : 'view',
      definitionOwnerId:feed && feed.ownerId,
      definitionRevision:(feed && Number(feed.lastRevision) || 0) + 1,
      definitionHash:replicaHabitDefinitionHash(h)
    };
  });
  const replicaSettings = mode === 'clone' ? JSON.parse(JSON.stringify(settings || {})) : null;
  if(replicaSettings){
    delete replicaSettings._plannerCurrentCoord;
    delete replicaSettings._plannerLiveLocationId;
    delete replicaSettings._weatherContext;
  }
  const replica = {
    schemaVersion:1,mode,generatedAt:now,
    definitionOwnerId:feed && feed.ownerId,
    ownershipPolicy:mode === 'clone'
      ? 'personal-clone-multi-writer-definition_additive-completions'
      : 'single-writer-definition_additive-completions',
    definitionReceipts:Array.isArray(feed && feed.definitionReceipts)
      ? feed.definitionReceipts.slice(-50)
      : [],
    completionReceipts:Array.isArray(feed && feed.completionReceipts)
      ? feed.completionReceipts.slice(-50)
      : [],
    items,settings:replicaSettings,truncated:false
  };
  Object.defineProperty(replica,'_rowIds',{ value:nextRowIds,enumerable:false });
  return replica;
}

function householdProjectionByteSize(projection){
  return new TextEncoder().encode(JSON.stringify(projection)).byteLength;
}

// History is the only lossy part of a bounded latest-state snapshot. Never
// remove a task or habit to make the payload fit: a clone interprets absence as
// deletion. If definitions alone exceed the transport budget, keep the last
// complete cloud snapshot and surface a useful sync error instead.
function fitHouseholdProjectionPayload(projection){
  const replica = projection && projection.replica;
  if(!replica || !Array.isArray(replica.items)) return projection;
  const maxBytes = SHARED_REPLICA_SNAPSHOT_MAX_PLAINTEXT_BYTES;
  let bytes = householdProjectionByteSize(projection);
  while(bytes > maxBytes){
    let trimmed = false;
    for(const item of replica.items){
      const logs = item && item.habit && item.habit.logs;
      if(Array.isArray(logs) && logs.length){ logs.shift(); trimmed = true; }
    }
    if(!trimmed) break;
    replica.truncated = true;
    replica.historyTruncated = true;
    bytes = householdProjectionByteSize(projection);
  }
  if(bytes > maxBytes){
    const error = new Error('replica_too_large');
    error.code = 'replica_too_large';
    error.payloadBytes = bytes;
    throw error;
  }
  return projection;
}

async function householdAgendaTransportProjection(projection,feed){
  const transport = { ...projection };
  const replica = transport.replica;
  delete transport.replica;
  if(replica){
    if(!/^[0-9a-f]{64}$/.test(String(feed && feed.replicaKey || ''))){
      throw new Error('invalid_replica_key');
    }
    transport.replicaEnvelope = await shareEncrypt(feed.replicaKey,replica,{
      schemaVersion:SHARE_SCHEMA_VERSION,
      recordKind:'agenda_replica',
      objectId:feed.feedId,
      revision:projection.revision
    });
  }
  if(householdProjectionByteSize(transport) > SHARED_SNAPSHOT_MAX_PLAINTEXT_BYTES){
    const error = new Error('replica_too_large');
    error.code = 'replica_too_large';
    throw error;
  }
  return transport;
}

function householdReplicaSignature(replica){
  if(!replica) return null;
  return {
    schemaVersion:replica.schemaVersion,
    mode:replica.mode,
    definitionOwnerId:replica.definitionOwnerId || null,
    ownershipPolicy:replica.ownershipPolicy,
    definitionReceipts:replica.definitionReceipts || [],
    completionReceipts:replica.completionReceipts || [],
    items:(replica.items || []).map(item=>({
      habit:item.habit,
      access:item.access,
      definitionOwnerId:item.definitionOwnerId || null,
      definitionHash:item.definitionHash || ''
    })),
    settings:replica.settings || null,
    truncated:Boolean(replica.truncated),
    historyTruncated:Boolean(replica.historyTruncated)
  };
}

function householdAgendaSignature(projection){
  if(!projection) return '';
  const slim = {
    title:projection.title,
    timezone:projection.timezone,
    rangeStart:projection.rangeStart,
    provenance:projection.plannerProvenance,
    scope:projection.scope,
    currentWeather:projection.currentWeather || null,
    replica:householdReplicaSignature(projection.replica),
    days:(projection.days || []).map(day=>({
      dateKey:day.dateKey,
      weekdayLabel:day.weekdayLabel,
      dateLabel:day.dateLabel,
      openMinutes:day.openMinutes,
      plannedMinutes:day.plannedMinutes,
      rows:(day.rows || []).map(row=>({
        kind:row.kind,
        start:row.start,
        end:row.end,
        title:row.title,
        emoji:row.emoji,
        emojiBgColor:row.emojiBgColor,
        status:row.status,
        completable:Boolean(row.completable),
        hid:row.hid || '',
        occurrenceKey:row.occurrenceKey || '',
        scheduleOptionId:row.scheduleOptionId || '',
        scheduledDay:row.scheduledDay || '',
        allowEarlyCompletion:Boolean(row.allowEarlyCompletion),
        durationMinutes:row.durationMinutes,
        locationLabel:row.locationLabel,
        travelFromLabel:row.travelFromLabel,
        travelToLabel:row.travelToLabel,
        weather:row.weather || null
      }))
    }))
  };
  return JSON.stringify(replicaStableValue(slim));
}

async function createHouseholdAgendaFeed(title = 'Shared display'){
  if(householdAgendaOwnerControlsBlocked()) return null;
  if(!shareConfigured()) throw new Error('share_unconfigured');
  const secrets = shareNewAgendaSecrets();
  await shareFetch('/v1/agendas', {
    method:'POST',
    body:{
      id:secrets.id,
      ownerCredential:secrets.ownerCredential
    }
  });
  const feed = {
    feedId:secrets.id,
    contentKey:secrets.contentKey,
    replicaKey:secrets.replicaKey,
    ownerCredential:secrets.ownerCredential,
    ownerId:shareRandomHex(8),
    title:title || 'Shared display',
    lastRevision:0,
    lastPublishedAt:null,
    plannerProvenance:null,
    status:'active',
    reauthDays:30,
    scopeMode:'count',
    scopeValue:HOUSEHOLD_AGENDA_DEFAULT_ROWS,
    syncMode:'clone',
    devices:[],
    rowMaps:[]
  };
  saveAgendaFeedRecord(feed);
  return feed;
}

function parseHouseholdAgendaPairingHash(hash){
  const params = new URLSearchParams(String(hash || '').replace(/^#/,''));
  const pairingId = params.get('agendaPair') || '';
  const x = params.get('x') || '';
  const y = params.get('y') || '';
  const displayPublicKey = { kty:'EC',crv:'P-256',x,y,ext:true };
  if(!/^[0-9a-f]{32}$/.test(pairingId) || !shareAgendaPairPublicKeyValid(displayPublicKey)) return null;
  return { pairingId,displayPublicKey };
}

function parseHouseholdAgendaPairingUrl(value){
  let scanned;
  try{ scanned = new URL(String(value || '').trim()); }
  catch(_){ return null; }
  const app = shareAppDirectoryUrl();
  if(scanned.origin !== app.origin
    || scanned.pathname !== app.pathname
    || scanned.search
    || scanned.username
    || scanned.password){
    return null;
  }
  return parseHouseholdAgendaPairingHash(scanned.hash);
}

function stopHouseholdAgendaQrScanner(){
  _agendaPairScannerGeneration += 1;
  _agendaPairScannerBusy = false;
  if(_agendaPairScannerFrame != null){
    cancelAnimationFrame(_agendaPairScannerFrame);
    _agendaPairScannerFrame = null;
  }
  if(_agendaPairScannerStream){
    for(const track of _agendaPairScannerStream.getTracks()) track.stop();
    _agendaPairScannerStream = null;
  }
  const video = $('agenda-pair-scanner-video');
  if(video){
    video.pause();
    video.srcObject = null;
  }
  const modal = $('agenda-pair-scanner');
  if(modal) modal.hidden = true;
}

async function handleHouseholdAgendaScannedValue(value){
  const pairing = parseHouseholdAgendaPairingUrl(value);
  if(!pairing) return false;
  stopHouseholdAgendaQrScanner();
  await openHouseholdAgendaPairingApproval(pairing);
  return true;
}

function scanHouseholdAgendaQrFrame(generation){
  if(generation !== _agendaPairScannerGeneration || !_agendaPairScannerStream) return;
  const video = $('agenda-pair-scanner-video');
  const canvas = $('agenda-pair-scanner-canvas');
  const status = $('agenda-pair-scanner-status');
  if(video && canvas && !_agendaPairScannerBusy && video.readyState >= 2 && video.videoWidth && video.videoHeight){
    const scale = Math.min(1,960 / video.videoWidth);
    canvas.width = Math.max(1,Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1,Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d',{ willReadFrequently:true });
    if(context){
      let decoded = null;
      try{
        context.drawImage(video,0,0,canvas.width,canvas.height);
        const pixels = context.getImageData(0,0,canvas.width,canvas.height);
        decoded = jsQR(pixels.data,pixels.width,pixels.height,{ inversionAttempts:'dontInvert' });
      }catch(_){ decoded = null; }
      if(decoded && decoded.data){
        const pairing = parseHouseholdAgendaPairingUrl(decoded.data);
        if(pairing){
          _agendaPairScannerBusy = true;
          if(status) status.textContent = 'Display QR verified. Checking the pairing request…';
          void handleHouseholdAgendaScannedValue(decoded.data);
          return;
        }
        if(status) status.textContent = 'That is not a valid Tings display QR. Keep the display QR inside the frame.';
      }
    }
  }
  _agendaPairScannerFrame = requestAnimationFrame(()=>scanHouseholdAgendaQrFrame(generation));
}

async function startHouseholdAgendaQrScanner(){
  if(householdAgendaOwnerControlsBlocked()) return false;
  const modal = $('agenda-pair-scanner');
  const status = $('agenda-pair-scanner-status');
  const video = $('agenda-pair-scanner-video');
  if(!modal || !status || !video) return false;
  stopHouseholdAgendaQrScanner();
  if(!agendaFeedRecord()){
    status.textContent = 'This phone does not own a shared display feed.';
    modal.hidden = false;
    return false;
  }
  const generation = _agendaPairScannerGeneration;
  modal.hidden = false;
  status.textContent = 'Waiting for camera permission…';
  if(typeof jsQR !== 'function' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function'){
    status.textContent = 'This installed browser cannot use the camera scanner. Update the browser or operating system, then try again.';
    return false;
  }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{ facingMode:{ ideal:'environment' } }
    });
    if(generation !== _agendaPairScannerGeneration){
      for(const track of stream.getTracks()) track.stop();
      return false;
    }
    _agendaPairScannerStream = stream;
    video.srcObject = stream;
    await video.play();
    status.textContent = 'Camera is on. Hold the display QR inside the square.';
    _agendaPairScannerFrame = requestAnimationFrame(()=>scanHouseholdAgendaQrFrame(generation));
    return true;
  }catch(error){
    if(generation !== _agendaPairScannerGeneration) return false;
    if(_agendaPairScannerStream){
      for(const track of _agendaPairScannerStream.getTracks()) track.stop();
      _agendaPairScannerStream = null;
    }
    video.srcObject = null;
    status.textContent = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
      ? 'Camera access was not allowed. Enable camera permission for Tings in your phone settings, then try again.'
      : 'Tings could not start the camera. Close other camera apps and try again.';
    return false;
  }
}

function clearHouseholdAgendaPairingHash(){
  try{ history.replaceState(null,'',location.pathname + location.search); }
  catch(_){}
}

function closeHouseholdAgendaPairingApproval(){
  const modal = $('agenda-pair-approval');
  if(modal) modal.hidden = true;
  _agendaPairApproval = null;
}

async function openHouseholdAgendaPairingApproval(pairing){
  if(householdAgendaOwnerControlsBlocked()) return;
  const feed = agendaFeedRecord();
  const modal = $('agenda-pair-approval');
  const status = $('agenda-pair-approval-status');
  const input = $('agenda-pair-approval-code');
  const approve = $('agenda-pair-approval-confirm');
  if(!modal || !status || !input || !approve) return;
  modal.hidden = false;
  approve.hidden = false;
  approve.disabled = true;
  input.disabled = true;
  input.value = '';
  status.textContent = feed ? 'Checking this 30-second pairing request…' : 'This phone does not own a shared display feed.';
  if(!feed) return;
  try{
    const result = await shareFetch(`/v1/agenda-pairings/${pairing.pairingId}`);
    const remoteKey = result.body && result.body.displayPublicKey;
    if(!shareAgendaPairPublicKeyValid(remoteKey)
      || remoteKey.x !== pairing.displayPublicKey.x
      || remoteKey.y !== pairing.displayPublicKey.y){
      throw new Error('pairing_key_mismatch');
    }
    const expiresAt = Number(result.body && result.body.expiresAt);
    if(!expiresAt || expiresAt <= Date.now()) throw new Error('pairing_unavailable');
    const protocolVersion = Number(result.body && result.body.protocolVersion) || 1;
    if(protocolVersion < AGENDA_PAIR_PROTOCOL_VERSION) throw new Error('pairing_update_required');
    _agendaPairApproval = { ...pairing,expiresAt,protocolVersion };
    input.disabled = false;
    approve.disabled = false;
    const style = householdAgendaSyncMode(feed);
    const styleLabel = style === 'selected'
      ? 'shared-items display'
      : (style === 'glance' ? 'glance display' : 'personal clone');
    status.textContent = `This QR will sign in a ${styleLabel}. Type the 8-digit code shown on the display. Approving adds this screen and does not sign out the other one.`;
    input.focus();
  }catch(error){
    status.textContent = error && error.message === 'pairing_key_mismatch'
      ? 'Security check failed: the QR key does not match the Worker request. Do not approve it.'
      : (error && error.message === 'pairing_update_required'
        ? 'Reload the display to install the two-device sync update, then scan its fresh QR.'
        : 'This pairing request expired or is no longer available. Generate a fresh QR on the display.');
  }
}

function sharedDisplayCompletionRevisionKnown(feed,envelope){
  const revision = Number(envelope && envelope.revision);
  if(!Number.isInteger(revision) || revision < 1) return false;
  const maps = Array.isArray(feed && feed.rowMaps) ? feed.rowMaps : [];
  return maps.some(entry=>Number(entry && entry.revision) === revision);
}

function sharedDisplayCompletionMap(feed,envelope){
  const revision = Number(envelope && envelope.revision);
  const rowId = String(envelope && envelope.logId || '');
  const maps = Array.isArray(feed && feed.rowMaps) ? feed.rowMaps : [];
  const revisionMap = maps.find(entry=>Number(entry && entry.revision) === revision);
  const mapped = revisionMap && revisionMap.rows && revisionMap.rows[rowId];
  if(!mapped || !cleanHabitId(mapped.hid)) return null;
  return {
    hid:cleanHabitId(mapped.hid),
    dayBase:Number(mapped.dayBase) || 0,
    start:Number(mapped.start) || 0,
    minutes:Math.max(0,Math.min(720,Math.round(Number(mapped.minutes) || 0))),
    occurrenceKey:String(mapped.occurrenceKey || '').slice(0,160),
    scheduleOptionId:String(mapped.scheduleOptionId || '').slice(0,64),
    scheduledDay:/^\d{4}-\d{2}-\d{2}$/.test(String(mapped.scheduledDay || '')) ? String(mapped.scheduledDay) : '',
    replica:Boolean(mapped.replica)
  };
}

function adoptReplicaDefinitionRow(feed,hid,rowId){
  if(!feed || cleanHabitId(hid) !== hid || !/^[0-9a-f]{16}$/.test(String(rowId || ''))) return feed;
  const replicaRowIds = { ...(feed.replicaRowIds && typeof feed.replicaRowIds === 'object' ? feed.replicaRowIds : {}) };
  if(!replicaRowIds[hid]) replicaRowIds[hid] = rowId;
  const adopted = replicaRowIds[hid];
  const maps = (Array.isArray(feed.rowMaps) ? feed.rowMaps : []).map(entry=>{
    if(!entry || !entry.rows || typeof entry.rows !== 'object' || entry.rows[adopted]) return entry;
    return {
      ...entry,
      rows:{
        ...entry.rows,
        [adopted]:{
          hid,
          dayBase:typeof dayStart === 'function' ? dayStart(Date.now()) : Date.now(),
          start:0,
          minutes:30,
          occurrenceKey:'',
          scheduleOptionId:'',
          scheduledDay:'',
          replica:true
        }
      }
    };
  });
  return { ...feed,replicaRowIds,rowMaps:maps };
}

function replicaCompletionFallbackMap(feed,payload,record){
  const hid = payload && cleanHabitId(payload.hid);
  const rowId = String((payload && payload.rowId) || '');
  let mappedHid = hid === (payload && payload.hid) ? hid : '';
  if(!mappedHid && feed && feed.replicaRowIds && typeof feed.replicaRowIds === 'object'){
    mappedHid = Object.keys(feed.replicaRowIds).find(id=>feed.replicaRowIds[id] === rowId) || '';
  }
  if(cleanHabitId(mappedHid) !== mappedHid) return null;
  const createdAt = Number(record && record.createdAt);
  const serverTime = Number.isFinite(createdAt) && createdAt > 0 ? Math.min(createdAt,Date.now()) : Date.now();
  const reportedAt = Number(payload && payload.completedAt);
  const completionTime = Number.isFinite(reportedAt) && reportedAt > 0
    ? Math.min(reportedAt,Date.now())
    : serverTime;
  const scheduledDay = /^\d{4}-\d{2}-\d{2}$/.test(String(payload && payload.scheduledDay || ''))
    ? String(payload.scheduledDay)
    : '';
  return {
    hid:mappedHid,
    dayBase:typeof dayStart === 'function' ? dayStart(completionTime) : completionTime,
    start:Number(payload && payload.start) || 0,
    minutes:Math.max(0,Math.min(720,Math.round(Number(payload && payload.minutes) || 0))),
    occurrenceKey:String(payload && payload.occurrenceKey || '').slice(0,160),
    scheduleOptionId:String(payload && payload.scheduleOptionId || '').slice(0,64),
    scheduledDay,
    replica:true
  };
}

function applyPayloadCompletionIdentity(mapped,payload){
  if(!mapped || !payload) return mapped;
  const occurrenceKey = String(payload.occurrenceKey || '').slice(0,160);
  const scheduleOptionId = String(payload.scheduleOptionId || '').slice(0,64);
  const scheduledDay = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.scheduledDay || ''))
    ? String(payload.scheduledDay)
    : '';
  const minutes = Math.max(0,Math.min(720,Math.round(Number(payload.minutes) || 0)));
  const start = Number(payload.start) || 0;
  return {
    ...mapped,
    occurrenceKey:occurrenceKey || mapped.occurrenceKey,
    scheduleOptionId:scheduleOptionId || mapped.scheduleOptionId,
    scheduledDay:scheduledDay || mapped.scheduledDay,
    minutes:minutes > 0 ? minutes : mapped.minutes,
    start:start > 0 ? start : mapped.start
  };
}

function sharedDisplayCompletionAlreadyLogged(data,operationId){
  return data.some(h=>normalizeLogs(h && h.logs).some(log=>
    log && typeof log === 'object'
      && log.source === 'shared_display'
      && log.operationId === operationId
  ));
}

function householdAgendaQueueRecords(body){
  const completions = Array.isArray(body && body.completions) ? body.completions : [];
  const listedDefinitions = Array.isArray(body && body.definitions) ? body.definitions : [];
  const isDefinition = record=>Boolean(record && record.envelope && record.envelope.recordKind === 'agenda_definition');
  return {
    definitions:[...listedDefinitions,...completions.filter(isDefinition)].slice(0,HOUSEHOLD_AGENDA_QUEUE_LIMIT),
    completions:completions.filter(record=>!isDefinition(record)).slice(0,HOUSEHOLD_AGENDA_QUEUE_LIMIT)
  };
}

async function syncHouseholdAgendaCompletions(feed,opts = {}){
  const base = feed || agendaFeedRecord();
  if(!base || !base.ownerCredential) return { feed:base,operationIds:[],completedRowKeys:new Set(),changed:false };
  const now = Date.now();
  if(!opts.force && now - _agendaCompletionSyncAt < SHARED_DISPLAY_COMPLETION_POLL_MS){
    return { feed:base,operationIds:[],completedRowKeys:new Set(),changed:false };
  }
  _agendaCompletionSyncAt = now;
  const result = await shareFetch(`/v1/agendas/${base.feedId}`,{ credential:base.ownerCredential });
  const remoteRevision = Number(result.body && result.body.revision);
  let nextFeed = Number.isInteger(remoteRevision) && remoteRevision >= 0
    ? { ...base,lastRevision:remoteRevision }
    : base;
  if(Array.isArray(result.body && result.body.sessions)){
    nextFeed = householdAgendaWithDevices(nextFeed,reconcileHouseholdAgendaDevices(nextFeed,result.body.sessions));
  }
  const libraryStyle = householdAgendaLibraryStyle(nextFeed);
  const hasCloneDevice = libraryStyle === 'clone';
  const hasSelectedDevice = libraryStyle === 'selected';
  const queued = householdAgendaQueueRecords(result.body);
  const pendingDefinitions = queued.definitions;
  const pending = queued.completions;
  if(!pendingDefinitions.length && !pending.length){
    if(JSON.stringify(householdAgendaDevices(base)) !== JSON.stringify(householdAgendaDevices(nextFeed))
      || Number(base.lastRevision) !== Number(nextFeed.lastRevision)){
      saveAgendaFeedRecord(nextFeed);
      if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
    }
    return { feed:nextFeed,operationIds:[],completedRowKeys:new Set(),changed:false };
  }

  const data = load();
  const safeToAck = [];
  const applied = [];
  const completedRowKeys = new Set();
  let changed = false;
  const decrypted = new Map();
  const definitionOps = new Map();
  const definitionOperationIds = new Set();
  const definitionChains = nextFeed.cloneDefinitionChains && typeof nextFeed.cloneDefinitionChains === 'object'
    ? {...nextFeed.cloneDefinitionChains}
    : {};
  for(const record of pendingDefinitions){
    const envelope = record && record.envelope;
    const operationId = String(envelope && envelope.operationId || '');
    if(!/^[0-9a-f]{32}$/.test(operationId)) continue;
    let payload;
    try{ payload = await shareDecrypt(nextFeed.replicaKey,envelope); }
    catch(_){ continue; }
    decrypted.set(operationId,payload);
    if(!payload || payload.schemaVersion !== 1 || payload.operationId !== operationId
      || !['upsert','delete'].includes(payload.action)
      || cleanHabitId(payload.hid) !== payload.hid) continue;
    safeToAck.push(operationId);
    definitionOperationIds.add(operationId);
    if(!hasCloneDevice) continue;
    const prior = definitionOps.get(payload.hid);
    const createdAt = Number(record && record.createdAt) || 0;
    if(!prior || createdAt >= prior.createdAt) definitionOps.set(payload.hid,{record,payload,createdAt});
  }
  if(hasCloneDevice){
    const receipts = [];
    for(const {payload} of definitionOps.values()){
      const index = data.findIndex(h=>h && h.hid === payload.hid);
      const current = index >= 0 ? data[index] : null;
      const baseHash = String(payload.baseDefinitionHash || '');
      const currentHash = current ? replicaHabitDefinitionHash(current) : '';
      const priorChain = definitionChains[payload.hid];
      const chained = priorChain
        && String(priorChain.baseHash || '') === baseHash
        && String(priorChain.resultHash || '') === currentHash;
      const accepts = (current ? currentHash === baseHash : !baseHash) || chained;
      let accepted = false;
      let resultHash = currentHash;
      if(accepts && payload.action === 'delete'){
        if(index >= 0) data.splice(index,1);
        accepted = true;
        resultHash = '';
        changed = true;
      }else if(accepts && payload.action === 'upsert' && payload.habit
        && cleanHabitId(payload.habit.hid) === payload.hid){
        const candidate = normalize([{
          ...payload.habit,
          hid:payload.hid,
          logs:current ? normalizeLogs(current.logs) : []
        }])[0];
        if(candidate){
          if(index >= 0) data[index] = candidate;
          else data.push(candidate);
          accepted = true;
          resultHash = replicaHabitDefinitionHash(candidate);
          changed = true;
          nextFeed = adoptReplicaDefinitionRow(nextFeed,payload.hid,payload.rowId);
        }
      }
      if(accepted) definitionChains[payload.hid] = {baseHash,resultHash};
      receipts.push({operationId:payload.operationId,hid:payload.hid,accepted});
    }
    if(receipts.length){
      const ids = new Set(receipts.map(item=>item.operationId));
      nextFeed = {
        ...nextFeed,
        cloneDefinitionChains:definitionChains,
        definitionReceipts:[
          ...(Array.isArray(nextFeed.definitionReceipts) ? nextFeed.definitionReceipts : [])
            .filter(item=>item && !ids.has(item.operationId)),
          ...receipts
        ].slice(-50)
      };
    }
  }
  for(const record of pending){
    const envelope = record && record.envelope;
    const operationId = String(envelope && envelope.operationId || '');
    const rowId = String(envelope && envelope.logId || '');
    if(!/^[0-9a-f]{32}$/.test(operationId) || !/^[0-9a-f]{16}$/.test(rowId)) continue;
    let payload = decrypted.get(operationId);
    if(!payload){
      try{ payload = await shareDecrypt(nextFeed.contentKey,envelope); }
      catch(_){ continue; }
    }
    if(payload && ['upsert','delete'].includes(payload.action)) continue;
    let mapped = sharedDisplayCompletionMap(nextFeed,envelope);
    if(!mapped && payload && payload.action === 'complete'){
      mapped = replicaCompletionFallbackMap(nextFeed,payload,record);
      if(mapped && !data.some(h=>h && h.hid === mapped.hid)){
        if((nextFeed.replicaRowIds && nextFeed.replicaRowIds[mapped.hid]) || hasSelectedDevice){
          safeToAck.push(operationId);
        }
        continue;
      }
    }
    if(!mapped){
      if(payload && payload.action === 'complete' && cleanHabitId(payload.hid) === payload.hid){
        if(hasSelectedDevice) safeToAck.push(operationId);
        continue;
      }
      if(sharedDisplayCompletionRevisionKnown(nextFeed,envelope)) safeToAck.push(operationId);
      continue;
    }
    mapped = applyPayloadCompletionIdentity(mapped,payload);
    if(sharedDisplayCompletionAlreadyLogged(data,operationId)){
      completedRowKeys.add(`${mapped.hid}|${mapped.start}`);
      safeToAck.push(operationId);
      continue;
    }
    if(!payload
      || payload.schemaVersion !== 1
      || payload.action !== 'complete'
      || payload.operationId !== operationId
      || payload.rowId !== rowId){
      safeToAck.push(operationId);
      continue;
    }
    const index = data.findIndex(h=>h && h.hid === mapped.hid);
    const h = index >= 0 ? data[index] : null;
    const createdAt = Number(record && record.createdAt);
    const serverTime = Number.isFinite(createdAt) && createdAt > 0 ? Math.min(createdAt,Date.now()) : Date.now();
    const reportedAt = Number(payload && payload.completedAt);
    const completionTime = Number.isFinite(reportedAt) && reportedAt > 0
      ? Math.min(reportedAt,Date.now())
      : serverTime;
    if(mapped.replica) mapped.dayBase = dayStart(completionTime);
    const todayBase = dayStart(completionTime);
    const tomorrow = new Date(todayBase);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowBase = tomorrow.getTime();
    const completingTomorrowTask = h && h.type === 'task'
      && mapped.dayBase > todayBase
      && mapped.dayBase <= tomorrowBase;
    if(!h || h.type === 'zero'
      || (hasSelectedDevice && mapped.replica && h.allowSharedDisplayCompletion === false)
      || (mapped.dayBase > todayBase && !completingTomorrowTask)){
      safeToAck.push(operationId);
      continue;
    }
    const mappedDone = mapped.occurrenceKey
      ? normalizeLogs(h.logs).some(log=>logOccurrenceKey(log) === mapped.occurrenceKey)
      : (typeof completedOnDay === 'function' && completedOnDay(h,mapped.dayBase));
    if(mappedDone){
      safeToAck.push(operationId);
      continue;
    }
    const logs = normalizeLogs(h.logs);
    const planTargetTs = completingTomorrowTask ? (mapped.start || mapped.dayBase) : completionTime;
    const consumedPlanTs = typeof planToConsumeForEntry === 'function'
      ? planToConsumeForEntry(logs,planTargetTs)
      : null;
    if(consumedPlanTs !== null && typeof findEntryByKind === 'function'){
      const pos = findEntryByKind(logs,consumedPlanTs,true);
      if(pos >= 0) logs.splice(pos,1);
    }
    let minutes = null;
    if(h.breakable){
      const remaining = typeof breakableBudgetMinutes === 'function'
        ? breakableBudgetMinutes(h,mapped.dayBase)
        : mapped.minutes;
      const credited = Math.max(0,Math.round(Number(mapped.minutes) || 0));
      minutes = Math.max(0,Math.min(credited,Math.round(Number(remaining) || 0)));
      if(minutes <= 0){
        safeToAck.push(operationId);
        continue;
      }
    }
    const entryTs = typeof snapLogTimestamp === 'function' ? snapLogTimestamp(h,completionTime) : completionTime;
    const entry = makeActualLog(entryTs,{
      minutes,source:'shared_display',operationId,
      occurrenceKey:mapped.occurrenceKey,
      scheduleOptionId:mapped.scheduleOptionId,
      scheduledDay:mapped.scheduledDay
    });
    h.logs = normalizeLogs([...logs,entry]);
    h.lastLog = latestActualLog(h.logs);
    h.snoozedUntil = null;
    if(typeof clearPlanByDateOnLog === 'function') clearPlanByDateOnLog(h);
    if(typeof pruneOrderConstraintsOnLog === 'function') pruneOrderConstraintsOnLog(h);
    applied.push(operationId);
    completedRowKeys.add(`${mapped.hid}|${mapped.start}`);
    changed = true;
  }
  if(changed && !save(data)){
    // Do not publish acceptance receipts or acknowledge definition operations
    // whose data never reached durable local storage. Returning the pre-fold
    // feed makes the Worker retain and retry them on the next sync. Completion
    // operations already known to be invalid/no-ops remain safe to discard.
    return {
      feed:{ ...base,lastRevision:nextFeed.lastRevision },
      operationIds:safeToAck.filter(id=>!definitionOperationIds.has(id)),
      completedRowKeys:new Set(),
      changed:false
    };
  }
  if(changed && typeof cancelPush === 'function' && typeof reminderSignature === 'function'){
    data.forEach(h=>{
      if(h && h.type === 'task' && isTaskDone(h)) cancelPush(reminderSignature(h));
    });
  }
  const operationIds = [...new Set([...safeToAck,...applied])];
  const completionReceipts = operationIds.filter(id=>!definitionOperationIds.has(id));
  if(completionReceipts.length){
    const ids = new Set(completionReceipts);
    nextFeed = {
      ...nextFeed,
      completionReceipts:[
        ...(Array.isArray(nextFeed.completionReceipts) ? nextFeed.completionReceipts : [])
          .filter(id=>!ids.has(id)),
        ...completionReceipts
      ].slice(-50)
    };
  }
  return {
    feed:nextFeed,
    operationIds,
    completedRowKeys,
    changed
  };
}

async function acknowledgeHouseholdAgendaCompletions(feed,operationIds){
  const ids = [...new Set((operationIds || []).filter(id=>/^[0-9a-f]{32}$/.test(id)))];
  if(!feed || !ids.length) return;
  for(let i = 0;i < ids.length;i += 50){
    await shareFetch(`/v1/agendas/${feed.feedId}/completion-acks`,{
      method:'POST',
      credential:feed.ownerCredential,
      body:{ operationIds:ids.slice(i,i + 50) }
    });
  }
}

async function approveHouseholdAgendaPairing(){
  if(householdAgendaOwnerControlsBlocked()) return false;
  const pairing = _agendaPairApproval;
  let feed = agendaFeedRecord();
  const status = $('agenda-pair-approval-status');
  const input = $('agenda-pair-approval-code');
  const approve = $('agenda-pair-approval-confirm');
  if(!pairing || !feed || !status || !input || !approve) return false;
  const confirmationCode = shareNormalizeAgendaPairCode(input.value);
  if(confirmationCode.length !== AGENDA_PAIR_CODE_DIGITS){
    status.textContent = 'Enter all 8 digits from the display.';
    return false;
  }
  if(pairing.expiresAt <= Date.now()){
    status.textContent = 'This pairing request expired. Generate a fresh QR on the display.';
    return false;
  }
  approve.disabled = true;
  input.disabled = true;
  status.textContent = 'Authorizing this exact display…';
  try{
    try{
      const completionSync = await syncHouseholdAgendaCompletions(feed,{ force:true });
      feed = completionSync.feed || feed;
    }
    catch(_){ /* A fresh snapshot below reflects any completion that was reachable. */ }
    const syncMode = householdAgendaSyncMode(feed);
    const conflict = householdAgendaApproveConflict(feed,syncMode);
    if(conflict){
      status.textContent = conflict;
      input.disabled = false;
      approve.disabled = false;
      input.focus();
      return false;
    }
    const nextContentKey = householdAgendaDevices(feed).length
      ? feed.contentKey
      : shareRandomHex(SHARE_KEY_BYTES);
    const preflightSource = typeof weekSnapshotForExport === 'function' ? weekSnapshotForExport() : null;
    if(preflightSource && Array.isArray(preflightSource.days) && preflightSource.days.length){
      buildHouseholdAgendaProjection(preflightSource,{ feed,data:load() });
    }
    const transfer = await shareAgendaPairEncrypt(
      nextContentKey,
      feed.feedId,
      pairing.pairingId,
      pairing.displayPublicKey,
      syncMode,
      feed.replicaKey
    );
    if(typeof tingsShareLog === 'function'){
      tingsShareLog('agenda.approve.transfer', {
        nextQrMode:syncMode,
        replicaKey:typeof tingsShareKeyInfo === 'function' ? tingsShareKeyInfo(feed.replicaKey) : { present:Boolean(feed.replicaKey) },
        existingDevices:householdAgendaDevices(feed).map(device=>device.syncMode),
        pairingId:typeof tingsShareIdTail === 'function' ? tingsShareIdTail(pairing.pairingId) : null
      });
    }
    const reauthDays = Number(feed.reauthDays) === 7 ? 7 : 30;
    await shareFetch(`/v1/agenda-pairings/${pairing.pairingId}/approve`,{
      method:'POST',
      credential:feed.ownerCredential,
      body:{
        feedId:feed.feedId,
        confirmationCode,
        protocolVersion:Math.min(AGENDA_PAIR_PROTOCOL_VERSION,Number(pairing.protocolVersion) || 1),
        sessionTtlMs:reauthDays === 7 ? HOUSEHOLD_AGENDA_WEEK_MS : HOUSEHOLD_AGENDA_MONTH_MS,
        transfer
      }
    });
    const next = householdAgendaWithDevices({
      ...feed,
      contentKey:nextContentKey,
      reauthDays,
      syncMode
    },[
      ...householdAgendaDevices(feed),
      { pairingId:pairing.pairingId,syncMode,pairedAt:Date.now() }
    ]);
    delete next.currentInvite;
    saveAgendaFeedRecord(next);
    _lastAgendaProjectionSig = '';
    if(typeof tingsShareLog === 'function'){
      tingsShareLog('agenda.approve.saved', {
        nextQrMode:syncMode,
        libraryStyle:householdAgendaLibraryStyle(next),
        devices:householdAgendaDevices(next).map(device=>device.syncMode)
      });
    }
    status.textContent = 'Display authorized. Publishing a fresh encrypted agenda…';
    try{
      await publishHouseholdAgendaNow(null,{ manual:true,forceCompletionSync:true });
      status.textContent = `Display authorized for ${reauthDays} days. Any other signed-in screen stays connected.`;
    }catch(error){
      if(error && error.message === 'replica_too_large') throw error;
      scheduleHouseholdAgendaPublish(undefined,{ forceCompletionSync:true });
      status.textContent = 'Display authorized. The agenda will publish when this phone is online.';
    }
    if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
    approve.hidden = true;
    return true;
  }catch(error){
    if(error && error.message === 'replica_too_large'){
      status.textContent = 'This Tings library is too large for one encrypted update, so no display access was changed. Shorten unusually large notes or history, then try again.';
    }else if(error && error.message === 'invalid_confirmation'){
      status.textContent = 'That code did not match. Check the display carefully; five wrong attempts destroy the request.';
    }else if(error && (error.status === 410 || error.message === 'pairing_unavailable')){
      status.textContent = 'This pairing request expired or was destroyed. Generate a fresh QR on the display.';
    }else if(error && error.status === 409 && error.message === 'session_limit'){
      status.textContent = 'Two displays are already signed in. Revoke one from the list first.';
    }else if(error && error.status === 409){
      status.textContent = 'Another approval is in progress. Wait a moment and scan a fresh QR if it does not finish.';
    }else{
      status.textContent = 'Could not authorize the display. Check the connection and try again before the request expires.';
    }
    input.disabled = false;
    approve.disabled = false;
    input.focus();
    return false;
  }
}

async function revokeHouseholdAgendaDevice(pairingId){
  const feed = agendaFeedRecord();
  const id = String(pairingId || '');
  if(!feed || !/^[0-9a-f]{32}$/.test(id)) return feed;
  try{
    await shareFetch(`/v1/agendas/${feed.feedId}/display-access`,{
      method:'DELETE',
      credential:feed.ownerCredential,
      body:{ pairingId:id }
    });
  }catch(error){
    if(!(error && (error.status === 404 || error.status === 410))) throw error;
  }
  const next = householdAgendaWithDevices(feed,householdAgendaDevices(feed).filter(device=>device.pairingId !== id));
  saveAgendaFeedRecord(next);
  _lastAgendaProjectionSig = '';
  if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
  scheduleHouseholdAgendaPublish(undefined,{ forceCompletionSync:true });
  return next;
}

async function publishHouseholdAgendaNow(week, opts = {}){
  if(!opts.nested){
    const previous = _agendaPublishGate;
    let release = ()=>{};
    _agendaPublishGate = new Promise(resolve=>{ release = resolve; });
    try{
      await previous;
      return await publishHouseholdAgendaNow(week,{ ...opts,nested:true });
    }finally{
      release();
    }
  }
  let feed = agendaFeedRecord();
  if(!feed || !shareConfigured()){
    noteAgendaPublish('skipped_unconfigured', { hasFeed:Boolean(feed), configured:Boolean(shareConfigured()) });
    return null;
  }
  let completionSync = { feed,operationIds:[],completedRowKeys:new Set(),changed:false };
  try{
    completionSync = await syncHouseholdAgendaCompletions(feed,{ force:Boolean(opts.forceCompletionSync) });
    feed = completionSync.feed || feed;
  }catch(_){ /* Publishing remains available during a transient completion-read failure. */ }
  feed = householdAgendaAdoptLiveFeed(feed) || feed;
  if(completionSync.changed && typeof refreshOpenViews === 'function'){
    try{ refreshOpenViews(); }
    catch(_){ /* Local logs already saved; the next home render still republishes. */ }
  }
  let source = week || (typeof weekSnapshotForExport === 'function' ? weekSnapshotForExport() : null);
  if(!source || !Array.isArray(source.days) || !source.days.length){
    if(householdAgendaLibraryStyle(feed) === 'glance'){
      noteAgendaPublish('skipped_glance_empty_week', {
        libraryStyle:'glance',
        devices:householdAgendaDevices(feed).map(device=>device.syncMode)
      });
      return null;
    }
    source = householdAgendaEmptyWeek();
  }
  const latest = agendaFeedRecord();
  if(latest && latest.feedId === feed.feedId
    && householdAgendaLibraryStyle(latest) !== householdAgendaLibraryStyle(feed)
    && !opts.libraryRetry){
    noteAgendaPublish('retry_style_changed_before_build', {
      from:householdAgendaLibraryStyle(feed),
      to:householdAgendaLibraryStyle(latest)
    });
    return publishHouseholdAgendaNow(source,{ ...opts,libraryRetry:true,manual:true,nested:true });
  }
  let projection;
  try{
    projection = buildHouseholdAgendaProjection(source, {
      feed,
      data:completionSync.changed ? load() : opts.data,
      completedRowKeys:completionSync.completedRowKeys
    });
  }catch(error){
    noteAgendaPublish(error && error.message === 'replica_too_large' ? 'replica_too_large' : 'build_failed', {
      libraryStyle:householdAgendaLibraryStyle(feed),
      devices:householdAgendaDevices(feed).map(device=>device.syncMode),
      error:typeof tingsShareErrorSummary === 'function' ? tingsShareErrorSummary(error) : String(error && error.message || error)
    });
    if(error && error.message === 'replica_too_large'){
      commitAgendaFeedPublish(feed,{ lastSyncError:'replica_too_large',lastSyncErrorAt:Date.now() });
      if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
    }
    throw error;
  }
  const sig = await shareSha256Hex(householdAgendaSignature(projection));
  const priorSig = _lastAgendaProjectionSig || String(feed.lastProjectionSig || '');
  if(!opts.manual && !completionSync.operationIds.length && sig === priorSig && feed.lastPublishedAt){
    noteAgendaPublish('skipped_unchanged', {
      libraryStyle:householdAgendaLibraryStyle(feed),
      hasReplica:Boolean(projection.replica),
      replicaItems:projection.replica && Array.isArray(projection.replica.items) ? projection.replica.items.length : 0,
      lastRevision:Number(feed.lastRevision) || 0
    });
    return householdAgendaAdoptLiveFeed(feed) || feed;
  }
  const liveBeforePut = agendaFeedRecord();
  if(liveBeforePut && liveBeforePut.feedId === feed.feedId
    && householdAgendaLibraryStyle(liveBeforePut) !== householdAgendaLibraryStyle(feed)
    && !opts.libraryRetry){
    noteAgendaPublish('retry_style_changed_before_encrypt', {
      from:householdAgendaLibraryStyle(feed),
      to:householdAgendaLibraryStyle(liveBeforePut)
    });
    return publishHouseholdAgendaNow(source,{ ...opts,libraryRetry:true,manual:true,nested:true });
  }
  const transportProjection = await householdAgendaTransportProjection(projection,feed);
  const envelope = await shareEncrypt(feed.contentKey, transportProjection, {
    schemaVersion:SHARE_SCHEMA_VERSION,
    recordKind:'agenda_snapshot',
    objectId:feed.feedId,
    revision:projection.revision
  });
  const liveAfterEncrypt = agendaFeedRecord();
  if(liveAfterEncrypt && liveAfterEncrypt.feedId === feed.feedId
    && householdAgendaLibraryStyle(liveAfterEncrypt) !== 'glance'
    && !transportProjection.replicaEnvelope
    && !opts.libraryRetry){
    noteAgendaPublish('retry_clone_without_envelope', {
      liveStyle:householdAgendaLibraryStyle(liveAfterEncrypt),
      devices:householdAgendaDevices(liveAfterEncrypt).map(device=>device.syncMode)
    });
    return publishHouseholdAgendaNow(source,{ ...opts,libraryRetry:true,manual:true,nested:true });
  }
  try{
    const result = await shareFetch(`/v1/agendas/${feed.feedId}`, {
      method:'PUT',
      credential:feed.ownerCredential,
      ifMatch:feed.lastRevision,
      body:{ snapshot:envelope, expectedRevision:feed.lastRevision }
    });
    const live = householdAgendaAdoptLiveFeed(feed) || feed;
    const next = commitAgendaFeedPublish(feed,{
      lastRevision:result.body.revision,
      lastPublishedAt:projection.generatedAt,
      lastProjectionSig:sig,
      plannerProvenance:projection.plannerProvenance,
      status:result.body.status || live.status,
      replicaRowIds:projection._replicaRowIds || live.replicaRowIds || {},
      rowMaps:[
        { revision:Number(result.body.revision),rows:projection._rowMap || {} },
        ...(Array.isArray(live.rowMaps) ? live.rowMaps : [])
          .filter(entry=>Number(entry && entry.revision) !== Number(result.body.revision))
      ].slice(0,SHARED_DISPLAY_ROW_MAP_REVISIONS)
    });
    delete next.lastSyncError;
    delete next.lastSyncErrorAt;
    saveAgendaFeedRecord(next);
    _lastAgendaProjectionSig = sig;
    noteAgendaPublish('put_ok', {
      revision:Number(result.body.revision) || 0,
      libraryStyle:householdAgendaLibraryStyle(next),
      devices:householdAgendaDevices(next).map(device=>device.syncMode),
      hasReplica:Boolean(projection.replica),
      hasEnvelope:Boolean(transportProjection.replicaEnvelope),
      replicaItems:projection.replica && Array.isArray(projection.replica.items) ? projection.replica.items.length : 0,
      replicaNames:((projection.replica && projection.replica.items) || [])
        .map(item=>item && item.habit && item.habit.name).filter(Boolean).slice(0, 8),
      sourceDays:source && source.days ? source.days.length : 0,
      emptyWeekFallback:Boolean(source && source.days && source.days.length === 1
        && Array.isArray(source.days[0] && source.days[0].timeline)
        && !source.days[0].timeline.length)
    });
    if(completionSync.operationIds.length){
      try{ await acknowledgeHouseholdAgendaCompletions(next,completionSync.operationIds); }
      catch(_){ /* Encrypted operation ids make a later acknowledgement idempotent. */ }
    }
    if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
    return next;
  }catch(error){
    if(error && error.status === 409 && !opts.retried){
      noteAgendaPublish('conflict_409', {
        lastRevision:Number(feed.lastRevision) || 0
      });
      _lastAgendaProjectionSig = '';
      const current = await shareFetch(`/v1/agendas/${feed.feedId}`, { credential:feed.ownerCredential });
      const currentRevision = Number(current.body && current.body.revision);
      if(!Number.isInteger(currentRevision) || currentRevision < 0) throw error;
      commitAgendaFeedPublish(feed,{ lastRevision:currentRevision });
      return publishHouseholdAgendaNow(source, { ...opts, retried:true,manual:true,nested:true });
    }
    noteAgendaPublish('put_failed', {
      error:typeof tingsShareErrorSummary === 'function' ? tingsShareErrorSummary(error) : String(error && error.message || error)
    });
    throw error;
  }
}

function startHouseholdAgendaPublish(){
  if(_agendaPublishInFlight){
    _agendaPublishQueued = true;
    return;
  }
  const week = _pendingAgendaWeek;
  _pendingAgendaWeek = null;
  const force = _agendaPublishQueuedForce;
  _agendaPublishQueuedForce = false;
  _agendaPublishQueued = false;
  _agendaPublishInFlight = true;
  Promise.resolve(publishHouseholdAgendaNow(week,{ forceCompletionSync:force }))
    .catch(()=>{})
    .finally(()=>{
      _agendaPublishInFlight = false;
      if(_agendaPublishQueued || _agendaPublishQueuedForce || _pendingAgendaWeek) startHouseholdAgendaPublish();
    });
}

function scheduleHouseholdAgendaPublish(week, opts = {}){
  if(!agendaFeedRecord() || !shareConfigured()) return;
  if(week) _pendingAgendaWeek = week;
  if(opts.forceCompletionSync) _agendaPublishQueuedForce = true;
  if(_agendaPublishTimer) clearTimeout(_agendaPublishTimer);
  _agendaPublishTimer = setTimeout(()=>{
    _agendaPublishTimer = null;
    startHouseholdAgendaPublish();
  }, 1200);
}

async function revokeHouseholdAgendaFeed(){
  const feed = agendaFeedRecord();
  if(!feed) return;
  try{
    await shareFetch(`/v1/agendas/${feed.feedId}`, {
      method:'DELETE',
      credential:feed.ownerCredential
    });
  }catch(error){
    if(!(error && (error.status === 404 || error.status === 410))) throw error;
  }
  saveAgendaFeedRecord(null);
  _lastAgendaProjectionSig = '';
  if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
}

function rejectExternalHouseholdAgendaPairingHash(){
  const pairing = parseHouseholdAgendaPairingHash(location.hash);
  if(pairing){
    clearHouseholdAgendaPairingHash();
    const modal = $('agenda-pair-scanner');
    const status = $('agenda-pair-scanner-status');
    if(modal) modal.hidden = false;
    if(status) status.textContent = 'For security, a QR link opened by the phone’s Camera app cannot authorize a display. Return to the installed Tings app and use settings → shared display → scan display QR.';
  }
}

window.addEventListener('hashchange',rejectExternalHouseholdAgendaPairingHash);
document.addEventListener('DOMContentLoaded',()=>{
  rejectExternalHouseholdAgendaPairingHash();
  $('settings-agenda-scan-qr')?.addEventListener('click',()=>{
    void startHouseholdAgendaQrScanner();
  });
  $('agenda-pair-scanner-cancel')?.addEventListener('click',stopHouseholdAgendaQrScanner);
  $('agenda-pair-approval-code')?.addEventListener('input',event=>{
    event.target.value = shareFormatAgendaPairCode(event.target.value);
  });
  $('agenda-pair-approval-confirm')?.addEventListener('click',()=>{
    void approveHouseholdAgendaPairing();
  });
  $('agenda-pair-approval-cancel')?.addEventListener('click',closeHouseholdAgendaPairingApproval);
  setInterval(()=>{
    if(document.visibilityState === 'visible' && agendaFeedRecord()) scheduleHouseholdAgendaPublish();
  },SHARED_DISPLAY_COMPLETION_POLL_MS);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden && _agendaPairScannerStream) stopHouseholdAgendaQrScanner();
  if(!document.hidden && agendaFeedRecord()) scheduleHouseholdAgendaPublish(undefined,{ forceCompletionSync:true });
});
window.addEventListener('pageshow',()=>{
  if(agendaFeedRecord()) scheduleHouseholdAgendaPublish(undefined,{ forceCompletionSync:true });
});
window.addEventListener('pagehide',stopHouseholdAgendaQrScanner);
window.addEventListener('online',()=>{
  if(agendaFeedRecord()) scheduleHouseholdAgendaPublish(undefined,{ forceCompletionSync:true });
});
window.addEventListener('keydown',event=>{
  if(event.key === 'Escape' && !$('agenda-pair-scanner')?.hidden) stopHouseholdAgendaQrScanner();
});
