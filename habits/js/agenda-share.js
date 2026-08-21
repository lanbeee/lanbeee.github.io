let _agendaPublishTimer = null;
let _agendaPublishInFlight = false;
let _lastAgendaProjectionSig = '';
let _pendingAgendaSnapshot = null;
let _agendaPairApproval = null;

const HOUSEHOLD_AGENDA_MAX_DAYS = 2;
const HOUSEHOLD_AGENDA_MAX_ROWS = 50;
const HOUSEHOLD_AGENDA_DEFAULT_ROWS = 20;
const HOUSEHOLD_AGENDA_DEFAULT_HOURS = 24;
const HOUSEHOLD_AGENDA_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUSEHOLD_AGENDA_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

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

function householdLocationLabel(id){
  if(!id || typeof locationById !== 'function') return '';
  const loc = locationById(id);
  return loc && loc.name ? String(loc.name) : '';
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

function householdProjectionHabitActive(habit,dayBase){
  if(!habit) return false;
  if(habit.type === 'task' && typeof isTaskDone === 'function' && isTaskDone(habit)) return false;
  if(habit.breakable && typeof breakableBudgetMinutes === 'function'){
    return breakableBudgetMinutes(habit,dayBase) > 0;
  }
  if(typeof completedOnDay === 'function' && completedOnDay(habit,dayBase)) return false;
  return true;
}

function householdProjectionRow(row, data, dayBase){
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
    return { ...base, kind:'busy', title:'Busy' };
  }
  if(row.kind === 'travel'){
    return {
      ...base,
      kind:'travel',
      title:'Travel',
      travelFromLabel:row.fromName || householdLocationLabel(row.from) || '',
      travelToLabel:row.toName || householdLocationLabel(row.to) || ''
    };
  }
  if(row.kind === 'fill' || row.kind === 'scheduled'){
    if(!householdProjectionHabitActive(habit,dayBase)) return null;
    return {
      ...base,
      kind:'item',
      title:habit && habit.name ? String(habit.name).slice(0,80) : 'Scheduled item',
      emoji:habit && habit.emoji ? String(habit.emoji).slice(0,8) : '',
      status:householdRowStatus(row, habit),
      locationLabel:householdLocationLabel(row.locationId || (habit && habit.locationIds && habit.locationIds[0])).slice(0,80)
    };
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
  const projection = {
    schemaVersion:SHARE_SCHEMA_VERSION,
    feedId:feed && feed.feedId,
    title:String((feed && feed.title) || 'Household agenda').slice(0,80),
    revision:(feed && Number(feed.lastRevision) || 0) + 1,
    generatedAt:now,
    timezone:householdAgendaTimezone(),
    rangeStart:days[0] ? days[0].dayBase : null,
    plannerProvenance:householdPlannerProvenance(week),
    scope:{ mode:scopeMode === 'hours' ? 'hours' : 'count', value:scopeValue },
    days:days.map(day=>{
      const timeline = Array.isArray(day.timeline) ? day.timeline : [];
      const rows = [];
      for(const row of timeline){
        if(rowsLeft <= 0) break;
        const projected = householdProjectionRow(row,data,day.dayBase);
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
  return projection;
}

function householdAgendaSignature(projection){
  if(!projection) return '';
  const slim = {
    timezone:projection.timezone,
    provenance:projection.plannerProvenance,
    days:(projection.days || []).map(day=>({
      dateKey:day.dateKey,
      openMinutes:day.openMinutes,
      plannedMinutes:day.plannedMinutes,
      rows:(day.rows || []).map(row=>({
        kind:row.kind,
        start:row.start,
        end:row.end,
        title:row.title,
        emoji:row.emoji,
        status:row.status,
        durationMinutes:row.durationMinutes,
        locationLabel:row.locationLabel,
        travelFromLabel:row.travelFromLabel,
        travelToLabel:row.travelToLabel
      }))
    }))
  };
  return JSON.stringify(slim);
}

async function createHouseholdAgendaFeed(title = 'Household agenda'){
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
    ownerCredential:secrets.ownerCredential,
    title:title || 'Household agenda',
    lastRevision:0,
    lastPublishedAt:null,
    plannerProvenance:null,
    paused:false,
    status:'active',
    reauthDays:30,
    scopeMode:'count',
    scopeValue:HOUSEHOLD_AGENDA_DEFAULT_ROWS
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
  const feed = agendaFeedRecord();
  const modal = $('agenda-pair-approval');
  const status = $('agenda-pair-approval-status');
  const input = $('agenda-pair-approval-code');
  const approve = $('agenda-pair-approval-confirm');
  if(!modal || !status || !input || !approve) return;
  modal.hidden = false;
  approve.disabled = true;
  input.disabled = true;
  input.value = '';
  status.textContent = feed ? 'Checking this two-minute pairing request…' : 'This phone does not own a household agenda feed.';
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
    _agendaPairApproval = { ...pairing,expiresAt };
    input.disabled = false;
    approve.disabled = false;
    status.textContent = 'Type the 8-digit code shown on the display. Approving revokes any previously paired display.';
    input.focus();
  }catch(error){
    status.textContent = error && error.message === 'pairing_key_mismatch'
      ? 'Security check failed: the QR key does not match the Worker request. Do not approve it.'
      : 'This pairing request expired or is no longer available. Generate a fresh QR on the display.';
  }
}

async function approveHouseholdAgendaPairing(){
  const pairing = _agendaPairApproval;
  const feed = agendaFeedRecord();
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
  const nextContentKey = shareRandomHex(SHARE_KEY_BYTES);
  try{
    const transfer = await shareAgendaPairEncrypt(
      nextContentKey,
      feed.feedId,
      pairing.pairingId,
      pairing.displayPublicKey
    );
    const reauthDays = Number(feed.reauthDays) === 7 ? 7 : 30;
    await shareFetch(`/v1/agenda-pairings/${pairing.pairingId}/approve`,{
      method:'POST',
      credential:feed.ownerCredential,
      body:{
        feedId:feed.feedId,
        confirmationCode,
        sessionTtlMs:reauthDays === 7 ? HOUSEHOLD_AGENDA_WEEK_MS : HOUSEHOLD_AGENDA_MONTH_MS,
        transfer
      }
    });
    const next = { ...feed,contentKey:nextContentKey,reauthDays };
    delete next.currentInvite;
    saveAgendaFeedRecord(next);
    _lastAgendaProjectionSig = '';
    status.textContent = 'Display authorized. Publishing a fresh encrypted agenda…';
    try{
      await publishHouseholdAgendaNow(null,{ manual:true });
      status.textContent = `Display authorized for ${reauthDays} days. You can return to the display.`;
    }catch(_){
      scheduleHouseholdAgendaPublish();
      status.textContent = 'Display authorized. The agenda will publish when this phone is online.';
    }
    approve.hidden = true;
    return true;
  }catch(error){
    if(error && error.message === 'invalid_confirmation'){
      status.textContent = 'That code did not match. Check the display carefully; five wrong attempts destroy the request.';
    }else if(error && (error.status === 410 || error.message === 'pairing_unavailable')){
      status.textContent = 'This pairing request expired or was destroyed. Generate a fresh QR on the display.';
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

async function publishHouseholdAgendaNow(week, opts = {}){
  const feed = agendaFeedRecord();
  if(!feed || !shareConfigured()) return null;
  if(feed.paused && !opts.manual) return null;
  const source = week || (typeof weekSnapshotForExport === 'function' ? weekSnapshotForExport() : null);
  if(!source || !Array.isArray(source.days) || !source.days.length) return null;
  const projection = buildHouseholdAgendaProjection(source, { feed, data:opts.data });
  const sig = householdAgendaSignature(projection);
  if(!opts.manual && sig === _lastAgendaProjectionSig && feed.lastPublishedAt) return feed;
  const envelope = await shareEncrypt(feed.contentKey, projection, {
    schemaVersion:SHARE_SCHEMA_VERSION,
    recordKind:'agenda_snapshot',
    objectId:feed.feedId,
    revision:projection.revision
  });
  _pendingAgendaSnapshot = { envelope, projection, sig };
  try{
    const result = await shareFetch(`/v1/agendas/${feed.feedId}`, {
      method:'PUT',
      credential:feed.ownerCredential,
      ifMatch:feed.lastRevision,
      body:{ snapshot:envelope, expectedRevision:feed.lastRevision }
    });
    const next = {
      ...feed,
      lastRevision:result.body.revision,
      lastPublishedAt:projection.generatedAt,
      plannerProvenance:projection.plannerProvenance,
      paused:Boolean(result.body.paused),
      status:result.body.status || feed.status
    };
    saveAgendaFeedRecord(next);
    _lastAgendaProjectionSig = sig;
    _pendingAgendaSnapshot = null;
    if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
    return next;
  }catch(error){
    if(error && error.status === 409 && !opts.retried){
      _lastAgendaProjectionSig = '';
      const current = await shareFetch(`/v1/agendas/${feed.feedId}`, { credential:feed.ownerCredential });
      const currentRevision = Number(current.body && current.body.revision);
      if(!Number.isInteger(currentRevision) || currentRevision < 0) throw error;
      const fresh = { ...feed, lastRevision:currentRevision };
      saveAgendaFeedRecord(fresh);
      return publishHouseholdAgendaNow(source, { ...opts, retried:true, manual:true });
    }
    throw error;
  }
}

function scheduleHouseholdAgendaPublish(week){
  if(!agendaFeedRecord() || !shareConfigured()) return;
  _pendingAgendaSnapshot = week || _pendingAgendaSnapshot;
  if(_agendaPublishTimer) clearTimeout(_agendaPublishTimer);
  _agendaPublishTimer = setTimeout(()=>{
    _agendaPublishTimer = null;
    if(_agendaPublishInFlight) return;
    _agendaPublishInFlight = true;
    Promise.resolve(publishHouseholdAgendaNow(week))
      .catch(()=>{})
      .finally(()=>{ _agendaPublishInFlight = false; });
  }, 1200);
}

async function pauseHouseholdAgendaFeed(paused){
  const feed = agendaFeedRecord();
  if(!feed) return null;
  const result = await shareFetch(`/v1/agendas/${feed.feedId}/pause`, {
    method:'POST',
    credential:feed.ownerCredential,
    body:{ paused:Boolean(paused) }
  });
  const next = { ...feed, paused:Boolean(result.body.paused), status:result.body.status };
  saveAgendaFeedRecord(next);
  if(typeof syncHouseholdAgendaSettings === 'function') syncHouseholdAgendaSettings();
  return next;
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

function maybeOpenHouseholdAgendaPairingFromHash(){
  const pairing = parseHouseholdAgendaPairingHash(location.hash);
  if(pairing){
    clearHouseholdAgendaPairingHash();
    void openHouseholdAgendaPairingApproval(pairing);
  }
}

window.addEventListener('hashchange',maybeOpenHouseholdAgendaPairingFromHash);
document.addEventListener('DOMContentLoaded',()=>{
  maybeOpenHouseholdAgendaPairingFromHash();
  $('agenda-pair-approval-code')?.addEventListener('input',event=>{
    event.target.value = shareFormatAgendaPairCode(event.target.value);
  });
  $('agenda-pair-approval-confirm')?.addEventListener('click',()=>{
    void approveHouseholdAgendaPairing();
  });
  $('agenda-pair-approval-cancel')?.addEventListener('click',closeHouseholdAgendaPairingApproval);
});
