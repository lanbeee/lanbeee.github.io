let _agendaPublishTimer = null;
let _agendaPublishInFlight = false;
let _lastAgendaProjectionSig = '';
let _pendingAgendaSnapshot = null;

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

function householdProjectionRow(row, data){
  const habit = row.h || (row.i != null && data && data[row.i]) || null;
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
    return {
      ...base,
      kind:'item',
      title:habit && habit.name ? String(habit.name) : 'Scheduled item',
      emoji:habit && habit.emoji ? String(habit.emoji) : '',
      status:householdRowStatus(row, habit),
      locationLabel:householdLocationLabel(row.locationId || (habit && habit.locationIds && habit.locationIds[0]))
    };
  }
  return null;
}

function buildHouseholdAgendaProjection(week, opts = {}){
  const feed = opts.feed || agendaFeedRecord();
  const now = opts.now || Date.now();
  const data = opts.data || (typeof load === 'function' ? load() : []);
  const configuredDays = typeof AGENDA_SHARE_DAYS !== 'undefined' ? AGENDA_SHARE_DAYS : 2;
  const dayCount = Number.isFinite(opts.dayCount) ? opts.dayCount : configuredDays;
  const days = ((week && week.days) || []).slice(0, dayCount);
  const projection = {
    schemaVersion:SHARE_SCHEMA_VERSION,
    feedId:feed && feed.feedId,
    title:(feed && feed.title) || 'Household agenda',
    revision:(feed && Number(feed.lastRevision) || 0) + 1,
    generatedAt:now,
    timezone:householdAgendaTimezone(),
    rangeStart:days[0] ? days[0].dayBase : null,
    plannerProvenance:householdPlannerProvenance(week),
    days:days.map(day=>{
      const timeline = Array.isArray(day.timeline) ? day.timeline : [];
      const rows = [];
      for(const row of timeline){
        const projected = householdProjectionRow(row, data);
        if(projected) rows.push(projected);
      }
      const remaining = Math.max(0, Math.round(Number(day.remainingMinutes) || 0));
      if(remaining > 0){
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

function householdAgendaLink(feed){
  return agendaDisplayHref(`feed=${feed.feedId}&key=${feed.contentKey}&viewer=${feed.viewerCredential}`);
}

function householdAgendaInviteText(){
  return 'Open this on a household display to see today’s plan.';
}

async function createHouseholdAgendaFeed(title = 'Household agenda'){
  if(!shareConfigured()) throw new Error('share_unconfigured');
  const secrets = shareNewAgendaSecrets();
  await shareFetch('/v1/agendas', {
    method:'POST',
    body:{
      id:secrets.id,
      ownerCredential:secrets.ownerCredential,
      viewerCredential:secrets.viewerCredential
    }
  });
  const feed = {
    feedId:secrets.id,
    contentKey:secrets.contentKey,
    ownerCredential:secrets.ownerCredential,
    viewerCredential:secrets.viewerCredential,
    title:title || 'Household agenda',
    lastRevision:0,
    lastPublishedAt:null,
    plannerProvenance:null,
    paused:false,
    status:'active'
  };
  saveAgendaFeedRecord(feed);
  return feed;
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

async function rotateHouseholdAgendaAccess(week){
  const feed = agendaFeedRecord();
  if(!feed) return null;
  const contentKey = shareRandomHex(SHARE_KEY_BYTES);
  const viewerCredential = shareRandomHex(SHARE_KEY_BYTES);
  const source = week || (typeof weekSnapshotForExport === 'function' ? weekSnapshotForExport() : null);
  const working = { ...feed, contentKey, viewerCredential };
  const projection = buildHouseholdAgendaProjection(source, { feed:working });
  const envelope = await shareEncrypt(contentKey, projection, {
    schemaVersion:SHARE_SCHEMA_VERSION,
    recordKind:'agenda_snapshot',
    objectId:feed.feedId,
    revision:projection.revision
  });
  const result = await shareFetch(`/v1/agendas/${feed.feedId}/rotate`, {
    method:'POST',
    credential:feed.ownerCredential,
    body:{ viewerCredential, snapshot:envelope, expectedRevision:feed.lastRevision }
  });
  const next = {
    ...working,
    lastRevision:result.body.revision,
    lastPublishedAt:projection.generatedAt,
    plannerProvenance:projection.plannerProvenance,
    status:result.body.status
  };
  saveAgendaFeedRecord(next);
  _lastAgendaProjectionSig = householdAgendaSignature(projection);
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

async function copyHouseholdAgendaLink(){
  const feed = agendaFeedRecord();
  if(!feed) return false;
  const url = householdAgendaLink(feed);
  if(typeof copyTextToClipboard === 'function') return copyTextToClipboard(url);
  try{
    await navigator.clipboard.writeText(url);
    return true;
  }catch(_){ return false; }
}

async function shareHouseholdAgendaLink(){
  const feed = agendaFeedRecord();
  if(!feed) return false;
  const url = householdAgendaLink(feed);
  if(navigator.share){
    try{
      await navigator.share({ title:'Household agenda', text:householdAgendaInviteText(), url });
      return true;
    }catch(error){
      if(error && error.name === 'AbortError') return false;
    }
  }
  return copyHouseholdAgendaLink();
}
