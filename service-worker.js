// PT 스케줄러 service worker — basic offline cache.
// - HTML/document: network-first (so updates appear when online)
// - Same-origin assets (CSS/JS/icons): cache-first
// - Cross-origin (Supabase, CDN, GitHub API): bypass entirely

const CACHE = 'pt-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './config.js',
  './js/app.js',
  './js/store.js',
  './js/calendar.js',
  './js/exporter.js',
  './js/parser.js',
  './js/auth.js',
  './js/supabase.js',
  './js/holidays.js',
  './js/pin.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Skip files that 404 during install (e.g. PNG icons not yet generated).
      .then((cache) => Promise.all(
        ASSETS.map((u) => cache.add(u).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Bypass cross-origin (Supabase, CDN, GitHub API)
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML / document navigations
  const isDoc = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isDoc) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for everything else (CSS/JS/images)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
