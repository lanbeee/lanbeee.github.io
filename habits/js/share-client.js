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

async function shareFetch(path, opts = {}){
  if(!shareConfigured()) throw new Error('share_unconfigured');
  const headers = { 'Content-Type':'application/json' };
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
      throw timeout;
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
    throw error;
  }
  return { status:res.status, etag:res.headers.get('ETag'), body:payload };
}
