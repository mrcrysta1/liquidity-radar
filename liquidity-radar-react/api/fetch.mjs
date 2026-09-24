// Vercel serverless proxy for RSS / Forex Factory feeds (no CORS on those hosts).
// Mirrors pro-terminal/server/allowlist.mjs + the dev feedProxy middleware so the
// same route GET /api/fetch?url=<encoded> works in dev (Vite middleware on :5174)
// and in production (this function). Keep the allow-list in sync with that file.
const ALLOW = new Set([
  'nfs.faireconomy.media', // Forex Factory calendar JSON
  'xoomar.com', // economic calendar fallback API
  'www.coindesk.com', 'cointelegraph.com', 'www.theblock.co', 'decrypt.co', 'blockworks.co', 'bitcoinmagazine.com', 'www.dlnews.com',
  'cryptoslate.com', 'coingape.com', 'beincrypto.com', 'u.today', 'ambcrypto.com', 'www.cryptotimes.io', 'bitcoinist.com',
  'cryptocurrency.cv', 'news.google.com', 'www.federalreserve.gov', 'www.sec.gov', 'www.cftc.gov', 'feeds.reuters.com', 'www.cnbc.com', 'feeds.content.dowjones.io', 'www.marketwatch.com',
  'www.binance.com', 'announcements.bybit.com', 'www.okx.com',
  'query1.finance.yahoo.com', 'query2.finance.yahoo.com', // Yahoo Finance: metals, energy, FX, indices, equities
]);

const cache = new Map(); // per-instance 30s cache, same as the dev middleware

export async function proxyFetch(target) {
  let u;
  try { u = new URL(target); } catch { return { status: 400, body: 'bad url', type: 'text/plain' }; }
  if (u.protocol !== 'https:' || !ALLOW.has(u.hostname)) return { status: 403, body: `host not allowed: ${u.hostname}`, type: 'text/plain' };
  // An upstream that resets the connection used to throw straight out of the
  // serverless handler, turning a flaky feed into a 500 with no body. Report
  // it as a bad gateway instead, so the caller's own fallback can take over.
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'LiquidityRadar/0.1 (+news reader)', accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow' });
    const body = await r.text();
    return { status: r.status, body, type: r.headers.get('content-type') || 'text/plain' };
  } catch (e) {
    return { status: 502, body: `upstream fetch failed: ${e && e.message ? e.message : e}`, type: 'text/plain' };
  }
}

export default async function handler(req, res) {
  const target = (req.query?.url ?? '').toString();
  const hit = cache.get(target);
  if (hit && Date.now() - hit.t < 30_000) {
    res.setHeader('content-type', hit.type);
    return res.end(hit.body);
  }
  const out = await proxyFetch(target);
  cache.set(target, { ...out, t: Date.now() });
  res.setHeader('content-type', out.type);
  res.setHeader('cache-control', 'public, max-age=30');
  res.status(out.status).end(out.body);
}