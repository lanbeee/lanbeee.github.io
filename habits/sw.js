const CACHE = 'tings-v27';
const MAPS_CACHE = 'tings-maps-v3';
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css';
const TABLER_WOFF2 = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/fonts/tabler-icons.woff2?v3.10.0';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const MAPS_ORIGINS = [
  'https://router.project-osrm.org',
  'https://nominatim.openstreetmap.org',
  'https://photon.komoot.io',
  'https://maps.googleapis.com',
  'https://tile.openstreetmap.org',
  'https://a.tile.openstreetmap.org',
  'https://b.tile.openstreetmap.org',
  'https://c.tile.openstreetmap.org',
  'https://unpkg.com'
];
const GEOCODE_ORIGINS = [
  'https://nominatim.openstreetmap.org',
  'https://photon.komoot.io'
];

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './js/config.js',
  './js/storage.js',
  './js/viewport.js',
  './js/data.js',
  './js/locations.js',
  './js/scoring.js',
  './js/list-view.js',
  './js/detail-view.js',
  './js/overview-view.js',
  './js/today-view.js',
  './js/push-client.js',
  './js/reminders.js',
  './js/shell-ui.js',
  './js/emoji-suggest.js',
  './js/settings.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './manifest.json'
];

const PRECACHE_CDN = [TABLER_CSS, TABLER_WOFF2, LEAFLET_CSS, LEAFLET_JS];

async function cachePutOk(cache, url) {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (res && res.ok) await cache.put(url, res);
  } catch (_) {}
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
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
        return (await caches.match(req))
          || (await caches.match('./index.html'))
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

  // Stale-while-revalidate for app shell + CDN assets. Must always resolve to a
  // Response — returning a Promise that settles to undefined breaks offline.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) {
      fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
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
