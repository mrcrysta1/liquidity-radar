/** Hosts the proxy may fetch. Everything else is refused. Add feeds here, never wildcard. */
export const ALLOW = new Set([
  'nfs.faireconomy.media',           // Forex Factory calendar JSON (ff_calendar_thisweek.json / nextweek)
  'www.coindesk.com', 'cointelegraph.com', 'www.theblock.co', 'decrypt.co', 'blockworks.co', 'bitcoinmagazine.com', 'www.dlnews.com',
  'cryptocurrency.cv', 'news.google.com', 'www.federalreserve.gov', 'www.sec.gov', 'www.cftc.gov', 'feeds.reuters.com', 'www.cnbc.com', 'feeds.content.dowjones.io', 'www.marketwatch.com',
  'www.binance.com', 'announcements.bybit.com', 'www.okx.com',
]);
export async function proxyFetch(target) {
  let u; try { u = new URL(target); } catch { return { status: 400, body: 'bad url', type: 'text/plain' }; }
  if (u.protocol !== 'https:' || !ALLOW.has(u.hostname)) return { status: 403, body: `host not allowed: ${u.hostname}`, type: 'text/plain' };
  const r = await fetch(u, { headers: { 'user-agent': 'LiquidityRadar/0.1 (+news reader)', accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' }, redirect: 'follow' });
  const body = await r.text(); return { status: r.status, body, type: r.headers.get('content-type') || 'text/plain' };
}
