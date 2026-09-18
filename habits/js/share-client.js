function shareWorkerBaseUrl(){
  if(typeof SHARE_WORKER_URL !== 'undefined' && SHARE_WORKER_URL) return SHARE_WORKER_URL;
  const local = typeof location !== 'undefined' && ['localhost','127.0.0.1'].includes(location.hostname);
  return local
    ? 'https://habits-share-staging.contactnabilkhan.workers.dev'
    : 'https://habits-share.contactnabilkhan.workers.dev';
}

function shareAppDirectoryUrl(){
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  const path = url.pathname || '/';
  if(path.endsWith('.html')){
    url.pathname = path.slice(0, path.lastIndexOf('/') + 1) || '/';
    return url;
  }
  if(!path.endsWith('/')){
    url.pathname = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  }
  return url;
}

function agendaDisplayHref(hash){
  const url = new URL('agenda-display.html', shareAppDirectoryUrl());
  if(hash) url.hash = String(hash).replace(/^#/, '');
  return url.href;
}

function shareAgendaFeedPath(feedId, opts = {}){
  const path = `/v1/agendas/${feedId}`;
  return opts.library ? `${path}?library=1` : path;
}

function agendaPairingOwnerHref(pairing){
  const url = shareAppDirectoryUrl();
  const params = new URLSearchParams({
    agendaPair:pairing.pairingId,
    x:pairing.displayPublicKey.x,
    y:pairing.displayPublicKey.y
  });
  url.hash = params.toString();
  return url.href;
}

function isAgendaDisplayPage(){
  return /\/agenda-display\.html$/.test(location.pathname);
}

const SHARED_DISPLAY_SESSION_ENDED_KEY = 'tings_display_session_ended_v1';

function sharedDisplayEnrollmentKey(){
  return typeof AGENDA_DISPLAY_KEY !== 'undefined' && AGENDA_DISPLAY_KEY
    ? AGENDA_DISPLAY_KEY
    : 'tings_agenda_display_v4';
}

function sharedDisplayHasReplicaRows(enrolled){
  return Boolean(enrolled && enrolled.replicaRows && typeof enrolled.replicaRows === 'object'
    && Object.keys(enrolled.replicaRows).length > 0);
}

// Glance enrollments stay on agenda-display.html. Clone / shared-items must
// open the full app as soon as pairing transfers the replica key — the live
// snapshot may still be glance-only until the owner finishes publishing.
function sharedDisplayWantsFullApp(enrolled){
  if(!enrolled) return false;
  const mode = enrolled.syncMode;
  if(mode === 'glance' || mode === 'legacy') return false;
  if(mode === 'clone' || mode === 'selected') return true;
  if(/^[0-9a-f]{64}$/.test(String(enrolled.replicaKey || ''))) return true;
  return Boolean(enrolled.replicaMode) || sharedDisplayHasReplicaRows(enrolled);
}

function sharedDisplayFullAppHref(){
  const target = new URL('index.html',location.href);
  target.searchParams.set('display','1');
  return target.href;
}

function sharedDisplaySessionEnded(){
  try{ return sessionStorage.getItem(SHARED_DISPLAY_SESSION_ENDED_KEY) === '1'; }
  catch(_){ return false; }
}

function clearSharedDisplaySessionEnded(){
  try{ sessionStorage.removeItem(SHARED_DISPLAY_SESSION_ENDED_KEY); }
  catch(_){ }
}

// Forget this screen's pairing so a 401/410 cannot bounce clone ↔ kiosk.
function endSharedDisplaySession(){
  try{ localStorage.removeItem(sharedDisplayEnrollmentKey()); }
  catch(_){ }
  try{ sessionStorage.setItem(SHARED_DISPLAY_SESSION_ENDED_KEY,'1'); }
  catch(_){ }
}

const TINGS_SHARE_LOG_LIMIT = 40;
const TINGS_SHARE_LOG_KEY = 'tings_share_debug_log_v1';
let _tingsShareLog = [];

function tingsShareIdTail(value){
  const text = String(value || '');
  if(!text) return null;
  return text.length <= 8 ? text : text.slice(0, 8);
}

function tingsShareKeyInfo(value){
  const text = String(value || '');
  return {
    present:Boolean(text),
    length:text.length,
    hex64:/^[0-9a-f]{64}$/.test(text)
  };
}

function tingsShareEnvelopeSummary(envelope){
  if(!envelope || typeof envelope !== 'object') return { present:false };
  return {
    present:true,
    recordKind:envelope.recordKind || null,
    schemaVersion:envelope.schemaVersion == null ? null : envelope.schemaVersion,
    revision:envelope.revision == null ? null : envelope.revision,
    objectId:tingsShareIdTail(envelope.objectId),
    hasNonce:Boolean(envelope.nonce),
    hasCiphertext:Boolean(envelope.ciphertext),
    ciphertextChars:envelope.ciphertext ? String(envelope.ciphertext).length : 0
  };
}

async function tingsShareOpenReplica(enrolled, projection, siblingEnvelope){
  if(projection && projection.replica && Number(projection.replica.schemaVersion) === 1){
    return { replica:projection.replica, how:'plaintext_replica' };
  }
  const envelope = siblingEnvelope || (projection && projection.replicaEnvelope) || null;
  if(!envelope) return { replica:null, how:'no_envelope' };
  const key = enrolled && enrolled.replicaKey;
  if(!/^[0-9a-f]{64}$/.test(String(key || ''))) return { replica:null, how:'no_replica_key' };
  try{
    return { replica:await shareDecrypt(key, envelope), how:'ok' };
  }catch(error){
    return {
      replica:null,
      how:tingsShareErrorSummary(error)
    };
  }
}

function tingsShareErrorSummary(error){
  if(!error) return null;
  return {
    name:error.name || null,
    message:String(error.message || error),
    status:error.status || null,
    timedOut:Boolean(error.timedOut)
  };
}

function tingsShareEnrollmentSummary(enrolled){
  if(!enrolled) return { enrolled:false };
  const replicaRows = enrolled.replicaRows && typeof enrolled.replicaRows === 'object'
    ? Object.keys(enrolled.replicaRows).length
    : 0;
  return {
    enrolled:true,
    feedId:tingsShareIdTail(enrolled.feedId),
    pairingId:tingsShareIdTail(enrolled.pairingId),
    syncMode:enrolled.syncMode || null,
    replicaMode:enrolled.replicaMode || null,
    contentKey:tingsShareKeyInfo(enrolled.contentKey),
    replicaKey:tingsShareKeyInfo(enrolled.replicaKey),
    storedRevision:Number(enrolled.meta && enrolled.meta.revision) || 0,
    replicaRowCount:replicaRows,
    truncated:Boolean(enrolled.replicaTruncated),
    wantsFullApp:typeof sharedDisplayWantsFullApp === 'function' && sharedDisplayWantsFullApp(enrolled)
  };
}

function tingsShareLocalHabits(){
  let habits = [];
  try{
    const key = typeof KEY !== 'undefined' ? KEY : 'tings_v2';
    habits = JSON.parse(localStorage.getItem(key) || '[]');
  }catch(_){ habits = []; }
  if(!Array.isArray(habits)) habits = [];
  return {
    count:habits.length,
    names:habits.map(h=>h && h.name).filter(Boolean).slice(0, 12)
  };
}

function tingsShareLog(event, details){
  const entry = {
    at:Date.now(),
    event:String(event || 'event'),
    details:details && typeof details === 'object' ? details : { value:details }
  };
  _tingsShareLog.push(entry);
  if(_tingsShareLog.length > TINGS_SHARE_LOG_LIMIT){
    _tingsShareLog = _tingsShareLog.slice(-TINGS_SHARE_LOG_LIMIT);
  }
  try{ sessionStorage.setItem(TINGS_SHARE_LOG_KEY, JSON.stringify(_tingsShareLog)); }
  catch(_){ }
  try{ console.info('[tings share]', entry.event, entry.details); }
  catch(_){ }
}

function tingsShareLogEntries(){
  if(_tingsShareLog.length) return _tingsShareLog.slice();
  try{
    const stored = JSON.parse(sessionStorage.getItem(TINGS_SHARE_LOG_KEY) || '[]');
    if(Array.isArray(stored)) _tingsShareLog = stored.slice(-TINGS_SHARE_LOG_LIMIT);
  }catch(_){ }
  return _tingsShareLog.slice();
}

function tingsShareAgeLabel(ts, now = Date.now()){
  const at = Number(ts) || 0;
  if(!at) return 'never';
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if(mins < 1) return 'just now';
  if(mins === 1) return '1 minute ago';
  if(mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if(hours === 1) return '1 hour ago';
  if(hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function buildSharedDisplayAuditReport(live = null){
  const enrolled = typeof replicaEnrollment === 'function' ? replicaEnrollment() : null;
  const feed = typeof agendaFeedRecord === 'function' ? agendaFeedRecord() : null;
  const isDisplay = typeof replicaDisplayRequested === 'function' && replicaDisplayRequested();
  const role = isDisplay ? 'paired-display' : (feed && feed.ownerCredential ? 'owner' : 'unpaired');
  const devices = typeof householdAgendaDevices === 'function' && feed
    ? householdAgendaDevices(feed).map(device=>({
        syncMode:device.syncMode,
        pairingId:tingsShareIdTail(device.pairingId),
        pairedAt:device.pairedAt || 0
      }))
    : [];
  const week = typeof weekSnapshotForExport === 'function' ? weekSnapshotForExport() : null;
  const report = {
    role,
    page:typeof location !== 'undefined' ? location.pathname : '',
    displayQuery:typeof replicaDisplayQueryRequested === 'function' && replicaDisplayQueryRequested(),
    shareConfigured:typeof shareConfigured === 'function' && shareConfigured(),
    workerHost:(()=>{
      try{ return new URL(shareWorkerBaseUrl()).host; }
      catch(_){ return null; }
    })(),
    localHabits:tingsShareLocalHabits(),
    enrollment:tingsShareEnrollmentSummary(enrolled),
    owner:{
      present:Boolean(feed && feed.feedId),
      feedId:tingsShareIdTail(feed && feed.feedId),
      nextQrMode:typeof householdAgendaSyncMode === 'function' ? householdAgendaSyncMode(feed) : null,
      libraryStyle:typeof householdAgendaLibraryStyle === 'function' ? householdAgendaLibraryStyle(feed) : null,
      devices,
      lastRevision:Number(feed && feed.lastRevision) || 0,
      lastPublishedAt:Number(feed && feed.lastPublishedAt) || 0,
      lastPublished:tingsShareAgeLabel(feed && feed.lastPublishedAt),
      lastSyncError:feed && feed.lastSyncError || null,
      replicaKey:tingsShareKeyInfo(feed && feed.replicaKey),
      contentKey:tingsShareKeyInfo(feed && feed.contentKey)
    },
    weekDays:week && Array.isArray(week.days) ? week.days.length : 0,
    lastPull:typeof replicaLastPullSummary === 'function' ? replicaLastPullSummary() : null,
    lastPublish:typeof agendaLastPublishSummary === 'function' ? agendaLastPublishSummary() : null,
    live:live || null,
    events:tingsShareLogEntries().slice(-20)
  };
  report.diagnosis = sharedDisplayAuditDiagnosis(report);
  return report;
}

function sharedDisplayAuditDiagnosis(report){
  if(!report) return 'no report';
  if(!report.shareConfigured) return 'sharing worker is not configured on this page';
  if(report.role === 'unpaired') return 'this device has no owner feed and is not a paired display';
  const live = report.live;
  if(live && live.error) return `worker check failed: ${live.error.message || live.error}`;
  if(report.role === 'owner'){
    if(report.owner.lastSyncError === 'replica_too_large'){
      return 'publish is paused because the library is too large for one encrypted update';
    }
    if(report.owner.libraryStyle === 'glance'){
      return 'owner library style is glance, so publishes omit the sealed habit library; a personal clone will stay on waiting for library';
    }
    if(!report.owner.replicaKey.hex64) return 'owner feed is missing a valid replicaKey';
    if(!report.owner.devices.some(device=>device.syncMode === 'clone' || device.syncMode === 'selected')){
      return 'no clone/shared-items device is in the owner pairing list, so the next snapshot may still be glance-only';
    }
    if(live && live.skipped) return `worker check skipped: ${live.skipped}`;
    if(live && !live.hasSnapshot) return 'worker currently has no snapshot';
    if(live && live.snapshotDecrypt && live.snapshotDecrypt !== 'ok'){
      return 'owner could not decrypt the worker snapshot with contentKey';
    }
    if(live && live.replicaDecrypt === 'no_envelope'){
      return 'worker has days but no sealed library; clones will keep waiting until the owner publishes a replica envelope';
    }
    if(live && live.replicaDecrypt && live.replicaDecrypt !== 'ok'){
      return 'worker has a library envelope but replicaKey cannot decrypt it';
    }
    if(live && Number(live.replicaItemCount) === 0){
      return 'worker has a sealed library with 0 items';
    }
    if(live && Number(live.replicaItemCount) > 0){
      return `worker currently has a sealed library with ${live.replicaItemCount} items`;
    }
    return 'owner is set to publish a clone library; live worker snapshot not confirmed yet';
  }
  const enrolled = report.enrollment;
  if(!enrolled || !enrolled.enrolled) return 'paired-display mode is on but local enrollment is missing';
  if(!enrolled.replicaKey.present){
    return 'this screen never received replicaKey; it cannot open the sealed library even if the owner published one';
  }
  if(!enrolled.replicaKey.hex64) return 'replicaKey is present but not a 64-char hex key';
  if(live && live.status === 401) return 'device credential was rejected (401); re-pair this screen';
  if(live && live.status === 410) return 'this display session was revoked (410)';
  if(live && !live.hasSnapshot) return 'worker returned no snapshot for this display';
  if(live && live.snapshotDecrypt && live.snapshotDecrypt !== 'ok'){
    return 'contentKey cannot decrypt the worker snapshot';
  }
  if(live && live.replicaDecrypt === 'no_envelope'){
    return 'snapshot decrypted, but the worker has no sealed library. Owner is still publishing glance-only data';
  }
  if(live && live.replicaDecrypt && live.replicaDecrypt !== 'ok'){
    return 'sealed library is present but this screen replicaKey cannot decrypt it';
  }
  if(live && Number(live.replicaItemCount) > 0 && !enrolled.replicaMode){
    return `library decrypts (${live.replicaItemCount} items) but is not installed; pull is skipping merge`;
  }
  if(live && Number(live.replicaItemCount) > 0){
    return `this screen can decrypt ${live.replicaItemCount} library items from the worker`;
  }
  if(report.lastPull && report.lastPull.reason){
    return `last pull result: ${report.lastPull.reason}`;
  }
  return 'paired display is waiting; live worker snapshot not confirmed yet';
}

function formatSharedDisplayAuditText(report){
  if(!report) return 'SHARED DISPLAY SYNC\n(no report)\n';
  const lines = ['SHARED DISPLAY SYNC'];
  const add = (label, value)=>lines.push(`${label}: ${value}`);
  add('diagnosis', report.diagnosis || '');
  add('role', report.role);
  add('page', report.page || '');
  add('displayQuery', String(Boolean(report.displayQuery)));
  add('worker', report.workerHost || '');
  add('localHabits', `${report.localHabits.count} [${(report.localHabits.names || []).join(', ')}]`);
  add('weekDays', String(report.weekDays || 0));
  if(report.enrollment && report.enrollment.enrolled){
    lines.push('');
    lines.push('ENROLLMENT');
    add('syncMode', report.enrollment.syncMode || 'none');
    add('replicaMode', report.enrollment.replicaMode || 'none');
    add('contentKey', JSON.stringify(report.enrollment.contentKey));
    add('replicaKey', JSON.stringify(report.enrollment.replicaKey));
    add('storedRevision', String(report.enrollment.storedRevision || 0));
    add('replicaRows', String(report.enrollment.replicaRowCount || 0));
    add('wantsFullApp', String(Boolean(report.enrollment.wantsFullApp)));
  }
  if(report.owner && report.owner.present){
    lines.push('');
    lines.push('OWNER FEED');
    add('nextQrMode', report.owner.nextQrMode || '');
    add('libraryStyle', report.owner.libraryStyle || '');
    add('devices', JSON.stringify(report.owner.devices || []));
    add('lastRevision', String(report.owner.lastRevision || 0));
    add('lastPublished', `${report.owner.lastPublished} (${report.owner.lastPublishedAt || 0})`);
    add('lastSyncError', report.owner.lastSyncError || 'none');
    add('replicaKey', JSON.stringify(report.owner.replicaKey));
  }
  if(report.lastPublish){
    lines.push('');
    lines.push('LAST PUBLISH');
    lines.push(JSON.stringify(report.lastPublish));
  }
  if(report.lastPull){
    lines.push('');
    lines.push('LAST PULL');
    lines.push(JSON.stringify(report.lastPull));
  }
  lines.push('');
  lines.push('LIVE WORKER SNAPSHOT');
  lines.push(report.live ? JSON.stringify(report.live) : 'not checked yet');
  lines.push('');
  lines.push('RECENT EVENTS');
  const events = report.events || [];
  if(!events.length) lines.push('(none yet)');
  for(const entry of events){
    const when = entry && entry.at ? new Date(entry.at).toISOString() : '';
    lines.push(`${when} ${entry.event} ${JSON.stringify(entry.details || {})}`);
  }
  return lines.join('\n') + '\n';
}

async function inspectSharedAgendaForAudit(){
  const enrolled = typeof replicaEnrollment === 'function' ? replicaEnrollment() : null;
  const feed = typeof agendaFeedRecord === 'function' ? agendaFeedRecord() : null;
  const isDisplay = typeof replicaDisplayRequested === 'function' && replicaDisplayRequested();
  const feedId = (isDisplay && enrolled && enrolled.feedId) || (feed && feed.feedId) || (enrolled && enrolled.feedId) || '';
  const credential = (isDisplay && enrolled && enrolled.deviceCredential)
    || (feed && feed.ownerCredential)
    || (enrolled && enrolled.deviceCredential)
    || '';
  const contentKey = (isDisplay && enrolled && enrolled.contentKey)
    || (feed && feed.contentKey)
    || (enrolled && enrolled.contentKey)
    || '';
  const replicaKey = (isDisplay && enrolled && enrolled.replicaKey)
    || (feed && feed.replicaKey)
    || (enrolled && enrolled.replicaKey)
    || '';
  if(!feedId || !credential) return { skipped:'no_feed_or_credential' };
  if(typeof shareFetch !== 'function') return { skipped:'no_share_fetch' };
  let result;
  try{
    result = await shareFetch(shareAgendaFeedPath(feedId,{ library:true }), {
      credential,
      timeoutMs:15000
    });
  }catch(error){
    return { error:tingsShareErrorSummary(error), status:error && error.status || null };
  }
  const body = result && result.body || {};
  const queued = typeof householdAgendaQueueRecords === 'function'
    ? householdAgendaQueueRecords(body)
    : {
        completions:Array.isArray(body.completions) ? body.completions : [],
        definitions:Array.isArray(body.definitions) ? body.definitions : []
      };
  const out = {
    httpStatus:result.status,
    revision:Number(body.revision) || 0,
    hasSnapshot:Boolean(body.snapshot),
    snapshot:tingsShareEnvelopeSummary(body.snapshot),
    pairingId:tingsShareIdTail(body.pairingId),
    pairingMatch:!enrolled || !body.pairingId || body.pairingId === enrolled.pairingId,
    sessionCount:Array.isArray(body.sessions) ? body.sessions.length : 0,
    completionCount:(queued.completions || []).length,
    definitionCount:(queued.definitions || []).length,
    snapshotDecrypt:null,
    days:0,
    hasPlainReplica:false,
    replicaEnvelope:tingsShareEnvelopeSummary(body.replica),
    replicaDecrypt:null,
    replicaMode:null,
    replicaSchema:null,
    replicaItemCount:null,
    replicaNames:[]
  };
  if(!body.snapshot){
    tingsShareLog('audit.inspect', out);
    return out;
  }
  if(!contentKey || typeof shareDecrypt !== 'function'){
    out.snapshotDecrypt = 'no_content_key';
    tingsShareLog('audit.inspect', out);
    return out;
  }
  let projection = null;
  try{
    projection = await shareDecrypt(contentKey, body.snapshot);
    out.snapshotDecrypt = 'ok';
    out.days = projection && Array.isArray(projection.days) ? projection.days.length : 0;
    out.hasPlainReplica = Boolean(projection && projection.replica);
    if(!out.replicaEnvelope.present){
      out.replicaEnvelope = tingsShareEnvelopeSummary(projection && projection.replicaEnvelope);
    }
  }catch(error){
    out.snapshotDecrypt = tingsShareErrorSummary(error);
    tingsShareLog('audit.inspect', out);
    return out;
  }
  const opened = await tingsShareOpenReplica({ replicaKey }, projection, body.replica);
  out.replicaDecrypt = opened.how;
  const replica = opened.replica;
  if(replica){
    out.replicaMode = replica.mode || null;
    out.replicaSchema = replica.schemaVersion || null;
    out.replicaItemCount = Array.isArray(replica.items) ? replica.items.length : 0;
    out.replicaNames = (replica.items || [])
      .map(item=>item && item.habit && item.habit.name).filter(Boolean).slice(0, 12);
  }
  tingsShareLog('audit.inspect', {
    revision:out.revision,
    hasSnapshot:out.hasSnapshot,
    days:out.days,
    replicaDecrypt:out.replicaDecrypt,
    replicaItemCount:out.replicaItemCount,
    replicaMode:out.replicaMode
  });
  return out;
}

function tingsShareDump(){
  const report = buildSharedDisplayAuditReport();
  const text = formatSharedDisplayAuditText(report);
  try{ console.info('[tings share] dump\n' + text); }
  catch(_){ }
  return report;
}

async function shareFetch(path, opts = {}){
  if(!shareConfigured()) throw new Error('share_unconfigured');
  const headers = {};
  if(opts.body != null) headers['Content-Type'] = 'application/json';
  if(opts.credential) headers.Authorization = `Bearer ${opts.credential}`;
  if(opts.ifMatch != null) headers['If-Match'] = `"${opts.ifMatch}"`;
  // Optional deadline so a hung connection surfaces as a normal error instead
  // of a forever-pending request. Ignored where AbortController is missing.
  const controller = opts.timeoutMs && typeof AbortController === 'function'
    ? new AbortController()
    : null;
  if(controller) setTimeout(()=>controller.abort(),opts.timeoutMs);
  let res;
  try{
    res = await fetch(`${shareWorkerBaseUrl()}${path}`, {
      method:opts.method || 'GET',
      headers,
      body:opts.body != null ? JSON.stringify(opts.body) : undefined,
      cache:'no-store',
      signal:controller ? controller.signal : undefined
    });
  }catch(error){
    if(error && error.name === 'AbortError'){
      const timeout = new Error('share_timeout');
      timeout.timedOut = true;
      if(typeof tingsShareLog === 'function'){
        tingsShareLog('fetch.timeout', { method:opts.method || 'GET', path:String(path || '') });
      }
      throw timeout;
    }
    if(typeof tingsShareLog === 'function'){
      tingsShareLog('fetch.network', {
        method:opts.method || 'GET',
        path:String(path || ''),
        error:tingsShareErrorSummary(error)
      });
    }
    throw error;
  }
  let payload = null;
  try{ payload = await res.json(); }
  catch(_){ payload = null; }
  if(!res.ok){
    const error = new Error((payload && payload.error) || 'share_http');
    error.status = res.status;
    error.payload = payload;
    if(typeof tingsShareLog === 'function'){
      tingsShareLog('fetch.http', {
        method:opts.method || 'GET',
        path:String(path || ''),
        status:res.status,
        error:payload && payload.error || 'share_http'
      });
    }
    throw error;
  }
  return { status:res.status, etag:res.headers.get('ETag'), body:payload };
}
