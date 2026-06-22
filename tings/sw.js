const CACHE = 'habits-v1';
const TABLER_CSS = 'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/tabler-icons.min.css';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './favicon.svg',
  './js/config.js',
  './js/viewport.js',
  './js/data.js',
  './js/scoring.js',
  './js/list-view.js',
  './js/detail-view.js',
  './js/overview-view.js',
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
