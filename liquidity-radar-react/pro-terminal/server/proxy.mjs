// Production proxy: `node server/proxy.mjs` (PORT env, default 8787). Serve the built app behind the same origin
// or set VITE_PROXY_BASE=https://your-proxy.example.com at build time.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { proxyFetch, createLru, cacheKey, cacheControl, SAFE_HEADERS, TTL_MS, CACHE_MAX } from './allowlist.mjs';

/** Only 2xx responses are cached, LRU-bounded, keyed by the normalised URL. */
const cache = createLru(CACHE_MAX);

export async function handle(req, res) {
  const url = new URL(req.url, 'http://x'); res.setHeader('access-control-allow-origin', '*');
  for (const [k, v] of Object.entries(SAFE_HEADERS)) res.setHeader(k, v);
  if (url.pathname !== '/api/fetch') { res.writeHead(404, { 'cache-control': 'no-store' }); return res.end(); }
  const target = url.searchParams.get('url') || ''; const key = cacheKey(target);
  const hit = key && cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) { res.writeHead(hit.status, { 'content-type': hit.type, 'cache-control': cacheControl(hit.status), 'x-cache': 'hit' }); return res.end(hit.body); }
  if (hit) cache.delete(key);
  try {
    const out = await proxyFetch(target);
    if (key && out.status >= 200 && out.status < 300) cache.set(key, { ...out, t: Date.now() });
    res.writeHead(out.status, { 'content-type': out.type, 'cache-control': cacheControl(out.status) }); res.end(out.body);
  } catch (e) {
    console.error('[proxy]', e);
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end('upstream fetch failed');
  }
}

// Listen only when run directly, so tests can import the handler.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(handle).listen(process.env.PORT || 8787, () => console.log('proxy on', process.env.PORT || 8787));
}
