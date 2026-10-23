/** Hosts the proxy may fetch. Everything else is refused. Add feeds here, never wildcard. */
export const ALLOW = new Set([
  'nfs.faireconomy.media',           // Forex Factory calendar JSON (ff_calendar_thisweek.json / nextweek)
  'www.coindesk.com', 'cointelegraph.com', 'www.theblock.co', 'decrypt.co', 'blockworks.co', 'bitcoinmagazine.com', 'www.dlnews.com',
  'cryptocurrency.cv', 'news.google.com', 'www.federalreserve.gov', 'www.sec.gov', 'www.cftc.gov', 'feeds.reuters.com', 'www.cnbc.com', 'feeds.content.dowjones.io', 'www.marketwatch.com',
  'www.binance.com', 'announcements.bybit.com', 'www.okx.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', // Yahoo Finance: metals, energy, FX, indices, equities
  'forex-data-feed.swissquote.com', // Swissquote public quotes: backup spot gold (services/spotGold)
]);

// Same hardening as the main app's api/fetch.mjs: keep the two in step.
const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOPS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
export const TTL_MS = 30_000;
export const CACHE_MAX = 200;

/** Headers every proxy response carries: upstream bytes must never run as a same-origin page. */
export const SAFE_HEADERS = { 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" };

/** Returns the parsed URL when it is https and on the allow-list, else null. */
export function allowedUrl(target, allow = ALLOW) {
  let u; try { u = target instanceof URL ? target : new URL(String(target)); } catch { return null; }
  return u.protocol === 'https:' && allow.has(u.hostname) ? u : null;
}

/** JSON and XML (RSS/Atom included) keep their type; anything else (HTML above all) becomes plain text. */
export function safeContentType(upstream) {
  const raw = String(upstream || ''); const mime = raw.split(';')[0].trim().toLowerCase();
  if (/^(application\/(json|xml|rss\+xml|atom\+xml|rdf\+xml|[a-z0-9.-]+\+json)|text\/(json|xml))$/.test(mime)) {
    const cs = /charset=([\w.-]+)/i.exec(raw); return cs ? `${mime}; charset=${cs[1]}` : mime;
  }
  return 'text/plain; charset=utf-8';
}

/** Resolves a redirect Location against the current URL; null unless allow-listed. */
export function redirectTarget(location, base, allow = ALLOW) {
  if (!location) return null;
  let u; try { u = new URL(location, base); } catch { return null; }
  return allowedUrl(u, allow);
}

/** A small LRU: Map insertion order is recency; the oldest entry goes first. */
export function createLru(max = CACHE_MAX) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); },
    delete(k) { m.delete(k); },
    get size() { return m.size; },
  };
}

/** Cache key for a target (normalised URL), or null when it would be refused. */
export const cacheKey = (target) => { const u = allowedUrl(target); return u ? u.href : null; };
export const cacheControl = (status) => (status >= 200 && status < 300 ? 'public, s-maxage=30, stale-while-revalidate=60' : 'no-store');

async function readCapped(r, max) {
  if (!r.body) return '';
  const reader = r.body.getReader(); const decoder = new TextDecoder(); let n = 0; let out = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); throw new Error('too large'); }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

const fail = (status, body) => ({ status, body, type: 'text/plain; charset=utf-8' });

export async function proxyFetch(target, allow = ALLOW) {
  let u = allowedUrl(target, allow);
  if (!u) { try { new URL(String(target)); } catch { return fail(400, 'bad url'); } return fail(403, 'host not allowed'); }
  // A reset upstream used to throw straight out of the handler; report it as a
  // bad gateway so the caller's own fallback can take over.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let r;
    for (let hop = 0; ; hop++) {
      // redirect: 'manual' so every hop is re-checked against the allow-list.
      r = await fetch(u, { headers: { 'user-agent': 'LiquidityRadar/0.1 (+news reader)', accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' }, redirect: 'manual', signal });
      if (!REDIRECTS.has(r.status)) break;
      const next = redirectTarget(r.headers.get('location'), u, allow);
      await r.body?.cancel().catch(() => {});
      if (!next) return fail(502, 'redirect not allowed');
      if (hop + 1 > MAX_HOPS) return fail(502, 'too many redirects');
      u = next;
    }
    if (Number(r.headers.get('content-length')) > MAX_BYTES) { await r.body?.cancel().catch(() => {}); return fail(502, 'upstream response too large'); }
    const body = await readCapped(r, MAX_BYTES);
    return { status: r.status, body, type: safeContentType(r.headers.get('content-type')) };
  } catch (e) {
    console.error('[proxy] upstream fetch failed', u.href, e && e.message ? e.message : e);
    return fail(502, e && e.message === 'too large' ? 'upstream response too large' : 'upstream fetch failed');
  }
}
