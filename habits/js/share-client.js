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

async function shareFetch(path, opts = {}){
  if(!shareConfigured()) throw new Error('share_unconfigured');
  const headers = { 'Content-Type':'application/json' };
  if(opts.credential) headers.Authorization = `Bearer ${opts.credential}`;
  if(opts.ifMatch != null) headers['If-Match'] = `"${opts.ifMatch}"`;
  const res = await fetch(`${shareWorkerBaseUrl()}${path}`, {
    method:opts.method || 'GET',
    headers,
    body:opts.body != null ? JSON.stringify(opts.body) : undefined,
    cache:'no-store'
  });
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
