// Liquidity Radar service worker: makes the app installable and lets the
// shell open offline. Deliberately conservative — it only ever stores the
// app's own built files:
//
//   /assets/*    content-hashed bundles: cache-first (a hash never changes)
//   navigations  network-first; the cached index.html only when offline
//   icons etc.   network-first, cached copy when offline
//   everything else — market APIs, websockets, any cross-origin request,
//   /api/* (feed proxy, chat) and /pro/* (the Pro Terminal, which has its
//   own worker) — is not intercepted at all, so live data is never cached.
//
// Because HTML is always fetched fresh when online, a deploy is picked up on
// the next load whatever version of this file is running. Bump VERSION only
// when this file's own logic changes. To retire the worker, ship a version
// whose install/activate delete every cache and call registration.unregister().
const VERSION = 'v1'
const SHELL = 'lr-shell-' + VERSION
// Not versioned: an open tab from the previous deploy can still lazy-load its
// own hashed chunks from here after Vercel stops serving them. Trimmed instead.
const ASSETS = 'lr-assets'
const MAX_ASSETS = 200
const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/favicon.svg',
]

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache so the shell is the deploy's own.
  e.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) =>
        Promise.all(ks.filter((k) => k.startsWith('lr-shell-') && k !== SHELL).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

function cacheable(r) {
  return r && r.ok && r.status === 200 && r.type === 'basic'
}

async function trimAssets() {
  const c = await caches.open(ASSETS)
  const keys = await c.keys()
  // keys() is in insertion order: drop the oldest.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => c.delete(k)))
}

async function assetFirst(req) {
  const hit = await caches.match(req, { cacheName: ASSETS })
  if (hit) return hit
  const r = await fetch(req)
  if (cacheable(r)) {
    const copy = r.clone()
    caches
      .open(ASSETS)
      .then((c) => c.put(req, copy))
      .then(trimAssets)
      .catch(() => {})
  }
  return r
}

async function navigate(req) {
  try {
    const r = await fetch(req)
    if (cacheable(r) && (r.headers.get('content-type') || '').includes('text/html')) {
      const copy = r.clone()
      caches
        .open(SHELL)
        .then((c) => c.put('/', copy))
        .catch(() => {})
    }
    return r
  } catch (err) {
    const shell = await caches.match('/', { cacheName: SHELL })
    if (shell) return shell
    throw err
  }
}

async function networkFirst(req) {
  try {
    const r = await fetch(req)
    if (cacheable(r)) {
      const copy = r.clone()
      caches
        .open(SHELL)
        .then((c) => c.put(req, copy))
        .catch(() => {})
    }
    return r
  } catch (err) {
    const hit = await caches.match(req, { cacheName: SHELL })
    if (hit) return hit
    throw err
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Never touch exchange APIs, websockets, fonts or any other origin.
  if (url.origin !== self.location.origin) return
  const p = url.pathname
  if (p.startsWith('/api/') || p === '/pro' || p.startsWith('/pro/')) return
  if (req.mode === 'navigate') {
    e.respondWith(navigate(req))
    return
  }
  if (p.startsWith('/assets/')) {
    e.respondWith(assetFirst(req))
    return
  }
  if (SHELL_FILES.includes(p) && p !== '/') e.respondWith(networkFirst(req))
})
