import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/** Dev-only proxy for RSS / Forex Factory (no CORS on those feeds). Same route as server/proxy.mjs. */
function feedProxy(): Plugin {
  const cache = new Map<string, { t: number; status: number; type: string; body: string }>();
  return { name: 'feed-proxy', configureServer(server) { server.middlewares.use('/api/fetch', async (req, res) => {
    const { proxyFetch } = await import('./server/allowlist.mjs');
    const target = new URL(req.url ?? '', 'http://x').searchParams.get('url') ?? '';
    const hit = cache.get(target); if (hit && Date.now() - hit.t < 30_000) { res.writeHead(hit.status, { 'content-type': hit.type }); return res.end(hit.body); }
    try { const out = await proxyFetch(target); cache.set(target, { ...out, t: Date.now() }); res.writeHead(out.status, { 'content-type': out.type }); res.end(out.body); }
    catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end(String(e)); }
  }); } };
}
export default defineConfig({
  base: '/pro/',
  plugins: [react(), feedProxy()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: 5174 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as any);
