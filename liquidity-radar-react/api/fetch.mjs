// Vercel serverless proxy for RSS / Forex Factory feeds (no CORS on those hosts).
// Mirrors pro-terminal/server/allowlist.mjs + the dev feedProxy middleware so the
// same route GET /api/fetch?url=<encoded> works in dev (Vite middleware on :5174)
// and in production (this function). Keep the allow-list in sync with that file.
//
// Only the app itself may use it (same origin gate as api/chat.mjs), with a
// per-IP rate limit, so it is not an open relay for the allow-listed hosts.
import { clientIp, createRateLimiter, requestAllowed } from './chat.mjs'

const ALLOW = new Set([
  'nfs.faireconomy.media', // Forex Factory calendar JSON
  'xoomar.com', // economic calendar fallback API
  'www.coindesk.com', 'cointelegraph.com', 'www.theblock.co', 'decrypt.co', 'blockworks.co', 'bitcoinmagazine.com', 'www.dlnews.com',
  'cryptoslate.com', 'coingape.com', 'beincrypto.com', 'u.today', 'ambcrypto.com', 'www.cryptotimes.io', 'bitcoinist.com',
  'cryptocurrency.cv', 'news.google.com', 'www.federalreserve.gov', 'www.sec.gov', 'www.cftc.gov', 'feeds.reuters.com', 'www.cnbc.com', 'feeds.content.dowjones.io', 'www.marketwatch.com',
  'www.binance.com', 'announcements.bybit.com', 'www.okx.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', // Yahoo Finance: metals, energy, FX, indices, equities
  'forex-data-feed.swissquote.com', // Swissquote public quotes: backup spot gold (services/spotGold)
]);

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_HOPS = 3;
const TTL_MS = 30_000;
const CACHE_MAX = 200;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Longest target URL accepted (feed and quote URLs are well under 1 KB). */
export const MAX_URL = 2048;
// A news refresh fetches a few dozen feeds at once and quotes poll on top, per
// open tab: generous for the app, a bound for anyone else.
const limiter = createRateLimiter({ limit: 180, windowMs: 60_000 });

/** Returns the parsed URL when it is https and on the allow-list, else null. */
export function allowedUrl(target, allow = ALLOW) {
  let u;
  try { u = target instanceof URL ? target : new URL(String(target)); } catch { return null; }
  return u.protocol === 'https:' && allow.has(u.hostname) ? u : null;
}

/**
 * The proxy answers same-origin, so an upstream HTML page must never be served
 * as HTML. JSON and XML (RSS/Atom included) keep their type — the app parses
 * both — and everything else becomes plain text.
 */
export function safeContentType(upstream) {
  const raw = String(upstream || '');
  const mime = raw.split(';')[0].trim().toLowerCase();
  if (/^(application\/(json|xml|rss\+xml|atom\+xml|rdf\+xml|[a-z0-9.-]+\+json)|text\/(json|xml))$/.test(mime)) {
    const cs = /charset=([\w.-]+)/i.exec(raw);
    return cs ? `${mime}; charset=${cs[1]}` : mime;
  }
  return 'text/plain; charset=utf-8';
}

/** Resolves a redirect Location against the current URL; null unless allow-listed. */
export function redirectTarget(location, base, allow = ALLOW) {
  if (!location) return null;
  let u;
  try { u = new URL(location, base); } catch { return null; }
  return allowedUrl(u, allow);
}

/** A small LRU: Map insertion order is recency; the oldest entry goes first. */
export function createLru(max = CACHE_MAX) {
  const m = new Map();
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k);
      m.delete(k); m.set(k, v);
      return v;
    },
    set(k, v) {
      m.delete(k); m.set(k, v);
      while (m.size > max) m.delete(m.keys().next().value);
    },
    delete(k) { m.delete(k); },
    get size() { return m.size; },
  };
}

async function readCapped(r, max) {
  if (!r.body) return '';
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let n = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

const fail = (status, body) => ({ status, body, type: 'text/plain; charset=utf-8' });

export async function proxyFetch(target, allow = ALLOW) {
  let u = allowedUrl(target, allow);
  if (!u) {
    try { new URL(String(target)); } catch { return fail(400, 'bad url'); }
    return fail(403, 'host not allowed');
  }
  // An upstream that resets the connection used to throw straight out of the
  // serverless handler, turning a flaky feed into a 500 with no body. Report
  // it as a bad gateway instead, so the caller's own fallback can take over.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    let r;
    for (let hop = 0; ; hop++) {
      r = await fetch(u, {
        headers: { 'user-agent': 'LiquidityRadar/0.1 (+news reader)', accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' },
        // Followed by hand so every hop is re-checked against the allow-list.
        redirect: 'manual',
        signal,
      });
      if (!REDIRECTS.has(r.status)) break;
      const next = redirectTarget(r.headers.get('location'), u, allow);
      await r.body?.cancel().catch(() => {});
      if (!next) return fail(502, 'redirect not allowed');
      if (hop + 1 > MAX_HOPS) return fail(502, 'too many redirects');
      u = next;
    }
    const len = Number(r.headers.get('content-length'));
    if (len > MAX_BYTES) {
      await r.body?.cancel().catch(() => {});
      return fail(502, 'upstream response too large');
    }
    const body = await readCapped(r, MAX_BYTES);
    return { status: r.status, body, type: safeContentType(r.headers.get('content-type')) };
  } catch (e) {
    // Host only: a query string may carry tokens and does not belong in logs.
    console.error('[api/fetch] upstream fetch failed', u.hostname, e && e.name ? e.name : 'error');
    return fail(502, e && e.message === 'too large' ? 'upstream response too large' : 'upstream fetch failed');
  }
}

/** Per-instance cache of 2xx responses only, keyed by the normalised URL. */
const cache = createLru(CACHE_MAX);

function send(res, out, cacheHit) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "sandbox; default-src 'none'");
  res.setHeader('content-type', out.type);
  const ok = out.status >= 200 && out.status < 300;
  res.setHeader('cache-control', ok ? 'public, s-maxage=30, stale-while-revalidate=60' : 'no-store');
  if (cacheHit) res.setHeader('x-cache', 'hit');
  res.status(out.status).end(out.body);
}

/**
 * The `url` query parameter as a string, or an error status: missing, repeated
 * or over MAX_URL characters.
 */
export function targetParam(query) {
  const raw = query?.url;
  if (Array.isArray(raw)) return { error: fail(400, 'one url only') };
  const target = raw == null ? '' : String(raw).trim();
  if (!target) return { error: fail(400, 'missing url') };
  if (target.length > MAX_URL) return { error: fail(414, 'url too long') };
  return { target };
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET');
    return send(res, fail(405, 'GET only'), false);
  }
  if (!requestAllowed(req)) return send(res, fail(403, 'origin not allowed'), false);
  const slot = limiter.take(clientIp(req));
  if (!slot.ok) {
    res.setHeader('retry-after', String(slot.retryAfter));
    return send(res, fail(429, 'too many requests'), false);
  }
  const { target, error } = targetParam(req.query);
  if (error) return send(res, error, false);
  const u = allowedUrl(target);
  const key = u ? u.href : null;
  if (key) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < TTL_MS) return send(res, hit, true);
    if (hit) cache.delete(key);
  }
  const out = await proxyFetch(target);
  if (key && out.status >= 200 && out.status < 300) cache.set(key, { ...out, t: Date.now() });
  send(res, out, false);
}
