// LogicLab service worker: makes the app work offline. API calls are never cached.
// The cache name is replaced with a content hash by scripts/build.mjs, so each deployment gets a fresh cache.
const V = 'll-89c9a9c4';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(V);
      // Cache the app shell: index.html plus every versioned script/style/icon it references.
      const html = await (await fetch('/index.html', { cache: 'reload' })).text();
      const assets = [
        ...html.matchAll(/(?:href|src)="([^"#]+\.(?:js|css|webmanifest|svg|png)(?:\?[^"]*)?)"/g)
      ].map(
        (m) =>
          new URL(m[1], self.location.origin + '/').pathname +
          (m[1].split('?')[1] ? '?' + m[1].split('?')[1] : '')
      );
      await cache.addAll(['/', '/index.html', ...new Set(assets)]);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin')
  )
    return;
  if (req.mode === 'navigate') {
    // Network first so updates arrive quickly; fall back to the cached app when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(V).then((c) => c.put(url.pathname === '/' ? '/index.html' : req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
    return;
  }
  // Everything else: cache first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(V).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
