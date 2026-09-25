// PokerLens service worker — offline app shell + runtime cache for engine/model/fonts.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const RUNTIME = 'pokerlens-runtime-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pokerlens-v') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !cdn) return;
  const isModel = sameOrigin && url.pathname.includes('/models/');
  if (cdn || isModel) {
    // cache-first: pinned CDN versions and model weights never change
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // app shell: cache-first, falling back to network (new versions arrive via VERSION bump)
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok && sameOrigin) caches.open(VERSION).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : undefined))));
});
