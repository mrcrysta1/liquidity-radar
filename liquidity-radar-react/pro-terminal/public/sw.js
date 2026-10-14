// Minimal app-shell service worker: cache static assets, network-first for everything else. Never caches exchange API responses.
const CACHE = 'liquidity-radar-shell-v1';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/manifest.webmanifest', '/icon.svg']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (u.origin !== self.location.origin) return; // never intercept exchange APIs / websockets
  e.respondWith(fetch(e.request).then(r => { if (r.ok && e.request.method === 'GET') caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('/'))));
});
