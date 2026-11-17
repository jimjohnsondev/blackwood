// Blackwood's service worker: keeps a copy of the game so it runs with no connection.
// Pages are fetched fresh when there is a connection (so updates arrive) and from the
// copy when there isn't; everything else is served from the copy first.
const CACHE = 'blackwood-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './manifest.webmanifest', './icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const keep = (res) => {
    if (res.ok) caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
    return res.clone();
  };
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(keep).catch(() => caches.match(req).then((hit) => hit || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then(keep)));
});
