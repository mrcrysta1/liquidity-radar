// Production proxy: `node server/proxy.mjs` (PORT env, default 8787). Serve the built app behind the same origin
// or set VITE_PROXY_BASE=https://your-proxy.example.com at build time.
import http from 'node:http';
import { proxyFetch } from './allowlist.mjs';
const cache = new Map(); const TTL = 30_000;
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); res.setHeader('access-control-allow-origin', '*');
  if (url.pathname !== '/api/fetch') { res.writeHead(404); return res.end(); }
  const target = url.searchParams.get('url') || ''; const hit = cache.get(target);
  if (hit && Date.now() - hit.t < TTL) { res.writeHead(hit.status, { 'content-type': hit.type, 'x-cache': 'hit' }); return res.end(hit.body); }
  try { const out = await proxyFetch(target); cache.set(target, { ...out, t: Date.now() }); res.writeHead(out.status, { 'content-type': out.type }); res.end(out.body); }
  catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e)); }
}).listen(process.env.PORT || 8787, () => console.log('proxy on', process.env.PORT || 8787));
