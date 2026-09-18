// Ported from pro-terminal/src/providers/proxy.ts (Pro Terminal feed fetching).
// Routes a feed URL through the allow-listed /api/fetch proxy (Vercel
// serverless — api/fetch.mjs). When that proxy isn't serving real feed bytes
// (unreachable, or a dev/preview server answering with its SPA index.html),
// falls back to an allorigins raw mirror, mirroring the main app's existing news
// feed fallback chain.
const BASE = (import.meta as any).env?.VITE_PROXY_BASE ?? ''
export const proxied = (url: string) => `${BASE}/api/fetch?url=${encodeURIComponent(url)}`

/** Feed payloads are XML/JSON — reject HTML (e.g. an SPA fallback page or error page) so callers route to the next source. */
function looksLikeFeed(text: string): boolean {
  const s = text.trimStart().toLowerCase()
  return !/^<!doctype html/.test(s) && !/^<html/.test(s) && (s.startsWith('<') || s.startsWith('{') || s.startsWith('['))
}

async function read(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const text = await r.text()
    if (!looksLikeFeed(text)) throw new Error('not a feed response')
    return text
  } finally {
    clearTimeout(id)
  }
}

export async function fetchText(url: string, timeoutMs = 12_000): Promise<string> {
  try {
    return await read(proxied(url), timeoutMs)
  } catch {
    return await read(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, timeoutMs)
  }
}