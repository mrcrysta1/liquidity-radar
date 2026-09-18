/** Route a feed URL through the allow-listed proxy (dev: Vite middleware; prod: server/proxy.mjs or VITE_PROXY_BASE). */
const BASE = (import.meta as any).env?.VITE_PROXY_BASE ?? '';
export const proxied = (url: string) => `${BASE}/api/fetch?url=${encodeURIComponent(url)}`;
export async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  const ctrl = new AbortController(); const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const r = await fetch(proxied(url), { signal: ctrl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); } finally { clearTimeout(id); }
}
