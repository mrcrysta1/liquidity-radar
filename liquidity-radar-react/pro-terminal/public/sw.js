// Minimal app-shell service worker for the Pro Terminal (served under /pro/):
// network-first for its own files, cached copy when offline. It only ever
// touches requests inside its own scope, so the main app's files, the /api/
// feed proxy and every exchange API / websocket are never intercepted.
const CACHE = 'lr-pro-shell-v2';
const MAX_ENTRIES = 120; // hashed bundles pile up across deploys: keep the newest
const SCOPE = self.registration.scope; // e.g. https://host/pro/
const SHELL = [SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icon.svg'];
// 'liquidity-radar-shell-v1' was this worker's previous cache (it held the main app's '/').
const OLD = k => k === 'liquidity-radar-shell-v1' || (k.startsWith('lr-pro-shell-') && k !== CACHE);
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(OLD).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const trim = c => c.keys().then(ks => Promise.all(ks.slice(0, Math.max(0, ks.length - MAX_ENTRIES)).filter(k => !SHELL.includes(k.url)).map(k => c.delete(k))));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  const nav = req.mode === 'navigate'; const key = nav ? SCOPE : req; // one cached page: the terminal is a single-page app
  e.respondWith(fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key, copy).then(() => trim(c))).catch(() => {}); }
    return r;
  }).catch(() => caches.match(key, { cacheName: CACHE }).then(m => m || Response.error())));
});
