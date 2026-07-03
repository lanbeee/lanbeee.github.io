const CACHE = 'habits-v9';
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './js/config.js',
  './js/storage.js',
  './js/viewport.js',
  './js/data.js',
  './js/scoring.js',
  './js/list-view.js',
  './js/detail-view.js',
  './js/overview-view.js',
  './js/today-view.js',
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

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    try {
      const res = await fetch(TABLER_CSS, { mode: 'no-cors' });
      await cache.put(TABLER_CSS, res);
    } catch (_) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () =>
        (await caches.match(req)) || (await caches.match('./index.html'))
      )
    );
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      })
      .catch(() => cached);
    return cached || network;
  })());
});

// Forward-compatible push handling. Today there is no push backend (the app is
// on-device only), so these are dormant. When a server sends a push (VAPID),
// the payload is shown as a notification; clicking it focuses/opens the PWA.
self.addEventListener('push', event => {
  let data = { title: 'Habits', body: '' };
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
