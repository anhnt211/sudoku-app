/* Sudoku service worker — offline-first cache. */

const CACHE_VERSION = 'sudoku-v1.2.2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/sudoku-engine.js',
  './js/sudoku-generator.js',
  './js/sudoku-solver.js',
  './js/sudoku-techniques.js',
  './js/ui.js',
  './js/storage.js',
  './js/settings.js',
  './js/stats.js',
  './js/pwa.js',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Cache each asset independently so a single missing file doesn't break offline.
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res.ok) await cache.put(url, res);
      } catch (_) { /* swallow individual failures */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML navigations so updates land quickly.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await caches.match(req)) || caches.match('./index.html');
      }
    })());
    return;
  }

  // Cache-first for everything else, refresh in background.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // Stale-while-revalidate.
      fetch(req).then(async (res) => {
        if (res && res.ok && res.type === 'basic') {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, res.clone());
        }
      }).catch(() => undefined);
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, res.clone());
      }
      return res;
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
