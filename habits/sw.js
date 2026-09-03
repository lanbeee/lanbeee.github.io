const CACHE = 'tings-v229';
const MAPS_CACHE = 'tings-maps-v3';
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css';
const TABLER_WOFF2 = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/fonts/tabler-icons.woff2?v3.10.0';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const MAPS_ORIGINS = [
  'https://router.project-osrm.org',
  'https://nominatim.openstreetmap.org',
  'https://photon.komoot.io',
  'https://maps.googleapis.com',
  'https://tile.openstreetmap.org',
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
  'https://unpkg.com',
  'https://cdn.jsdelivr.net'
];
const GEOCODE_ORIGINS = [
  'https://nominatim.openstreetmap.org',
  'https://photon.komoot.io'
];
const SHARE_WORKER_ORIGINS = [
  'https://habits-share.contactnabilkhan.workers.dev',
  'https://habits-share-staging.contactnabilkhan.workers.dev'
];

function isShareWorkerRequest(req){
  return SHARE_WORKER_ORIGINS.some(origin => req.url === origin || req.url.startsWith(origin + '/'));
}

function isAgendaDisplayPath(pathname){
  return /\/agenda-display\.html$/.test(pathname || '');
}

const PRECACHE = [
  './',
  './index.html',
  './agenda-display.html',
  './css/tokens.css',
  './css/base.css',
  './css/chrome.css',
  './css/home.css',
  './css/sheets.css',
  './css/detail.css',
  './css/stats-calendar.css',
  './css/forms.css',
  './css/planning.css',
  './css/locations.css',
  './css/controls.css',
  './css/settings.css',
  './css/filters.css',
  './css/actions.css',
  './css/overlays.css',
  './css/context.css',
  './css/progress.css',
  './css/agenda.css',
  './css/sweeps.css',
  './css/agenda-display.css',
  './favicon.svg',
  './js/config.js',
  './js/storage.js',
  './js/share-crypto.js',
  './js/share-state.js',
  './js/share-client.js',
  './js/share-items.js',
  './js/viewport.js',
  './lib/js/adhan.umd.min.js',
  './lib/js/jsQR.js',
  './lib/js/qrcode-generator.js',
  './js/data-schemas.js',
  './js/data-storage.js',
  './js/data-normalize.js',
  './js/data-backup.js',
  './js/data-planner-state.js',
  './js/data-primitives.js',
  './js/data-locations.js',
  './js/data-retention.js',
  './js/data-logs.js',
  './js/data-schedules.js',
  './js/data-format.js',
  './js/ui-kit.js',
  './js/calendar-import.js',
  './js/locations.js',
  './js/prayer-times.js',
  './js/scoring.js',
  './js/list-view-home.js',
  './js/list-view-sections.js',
  './js/list-view-planner.js',
  './js/list-view-actions.js',
  './js/agenda-share.js',
  './js/detail-view-sheet.js',
  './js/detail-view-links.js',
  './js/detail-view-tune.js',
  './js/detail-view-stats.js',
  './js/detail-view-pages.js',
  './js/overview-view.js',
  './js/today-view-fits.js',
  './js/today-view-reservations.js',
  './js/today-view-week.js',
  './js/today-view-today.js',
  './js/agenda-optimizer.js',
  './js/agenda-optimizer-ilp.js',
  './js/agenda-planner-worker.js',
  './js/agenda-order.js',
  './lib/js/glpk.mjs',
  './js/push-client.js',
  './js/reminders.js',
  './js/shell-ui.js',
  './js/emoji-suggest.js',
  './js/settings-core.js',
  './js/settings-backup.js',
  './js/settings-blocked.js',
  './js/settings-locations.js',
  './js/settings-state.js',
  './js/settings-samples.js',
  './js/settings-appearance.js',
  './js/settings-share.js',
  './js/agenda-display.js',
  './js/agenda-display-boot.js',
  './js/main-boot.js',
  './js/main-input.js',
  './js/main-runtime.js',
  './js/sw-register.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './manifest.json'
];

const PRECACHE_CDN = [TABLER_CSS, TABLER_WOFF2, LEAFLET_CSS, LEAFLET_JS, PDFJS, PDFJS_WORKER];

function isScriptAsset(url){
  return /\.(m?js)(\?|$)/i.test(url || '');
}

function responseLooksLikeHtml(res){
  if(!res)return false;
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  return ct.includes('text/html');
}

async function cachePutOk(cache, url) {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (res && res.ok && !responseLooksLikeHtml(res)) await cache.put(url, res);
  } catch (_) {}
}

async function cachePutResponse(cache, req, res){
  if(!res || !res.ok)return;
  // SPA servers (serve -s) return index.html with 200 for missing files.
  // Never store that under a .js/.mjs key — it permanently breaks module import.
  const url = typeof req === 'string' ? req : req.url;
  if(isScriptAsset(url) && responseLooksLikeHtml(res))return;
  try{ await cache.put(req, res.clone()); }catch(_){}
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async url => {
      try{
        const res = await fetch(url, { cache: 'no-cache' });
        await cachePutResponse(cache, url, res);
      }catch(_){}
    }));
    await Promise.all(PRECACHE_CDN.map(url => cachePutOk(cache, url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== MAPS_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Pairing status and encrypted agenda reads must hit the network. Cache Storage
  // ignores Cache-Control: no-store when cache.put() is used, and a cached 200
  // would hide later 401/410 revoke responses.
  if (isShareWorkerRequest(req)) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        let path = '';
        try { path = new URL(req.url).pathname; } catch (_) {}
        if (isAgendaDisplayPath(path)) {
          return (await caches.match('./agenda-display.html'))
            || new Response('Offline', { status: 503, statusText: 'Offline' });
        }
        return (await caches.match('./index.html'))
          || (await caches.match('./'))
          || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // Geocode search/reverse: network-first so address queries stay fresh
  // (cache-first can stick a failed/empty response across retries).
  if (GEOCODE_ORIGINS.some(origin => req.url.startsWith(origin))) {
    event.respondWith((async () => {
      const mapsCache = await caches.open(MAPS_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) mapsCache.put(req, res.clone());
        return res;
      } catch {
        return (await mapsCache.match(req)) || new Response('[]', {
          status: 504,
          statusText: 'Gateway Timeout',
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })());
    return;
  }

  // Map/directions API responses: cache-first into a dedicated cache that
  // survives app-shell version bumps (travel data is far more static than app
  // assets — a 30-day TTL is correct here, where SWR is right for the shell).
  if (MAPS_ORIGINS.some(origin => req.url.startsWith(origin))) {
    event.respondWith((async () => {
      const mapsCache = await caches.open(MAPS_CACHE);
      const hit = await mapsCache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok) mapsCache.put(req, res.clone());
        return res;
      } catch {
        return hit || new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // GLPK module: network-first so a poisoned HTML cache entry cannot stick.
  if (/\/lib\/js\/glpk\.mjs(\?|$)/i.test(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        await cachePutResponse(cache, req, res);
        if (res && res.ok && !responseLooksLikeHtml(res)) return res;
      } catch (_) {}
      const cached = await cache.match(req);
      if (cached && !responseLooksLikeHtml(cached)) return cached;
      return new Response('GLPK unavailable', { status: 503, statusText: 'Service Unavailable' });
    })());
    return;
  }

  // Keep same-origin app files version-consistent. Navigations are network-first,
  // so their scripts and config must be network-first too; mixing a fresh page
  // with stale cached modules can break startup during a deployment.
  if (new URL(req.url).origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        await cachePutResponse(cache, req, res);
        return res;
      } catch (_) {
        return (await cache.match(req)) || new Response('Offline', {
          status: 503,
          statusText: 'Offline'
        });
      }
    })());
    return;
  }

  // Stale-while-revalidate for CDN assets. Must always resolve to a Response —
  // returning a Promise that settles to undefined breaks offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached && !(isScriptAsset(req.url) && responseLooksLikeHtml(cached))) {
      fetch(req).then(res => {
        cachePutResponse(cache, req, res);
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      await cachePutResponse(cache, req, res);
      return res;
    } catch {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

// Push notification relay. Must match the values in js/config.js.
const PUSH_VAPID_KEY = 'YOUR_VAPID_PUBLIC_KEY_HERE';

self.addEventListener('push', event => {
  let data = { title: 'Tings', body: '' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (_) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag || 'tings-push',
    silent: false
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});

// Re-subscribe when the push service rotates the subscription keys. The new
// subscription is forwarded to client pages so push-client.js can store it.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: PUSH_VAPID_KEY
    }).then(newSub => {
      const data = newSub.toJSON();
      return self.clients.matchAll({ type: 'window' }).then(all => {
        all.forEach(c => c.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED', subscription: data }));
      });
    }).catch(() => {})
  );
});
