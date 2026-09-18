// Ported from pro-terminal/src/core/news/rss.ts (Pro Terminal news feed).
export interface NewsItem {
  id: string
  title: string
  link: string
  source: string
  ts: number
  summary?: string
  category: 'crypto' | 'markets' | 'macro' | 'regulatory' | 'exchange'
}
export interface NewsSource {
  id: string
  name: string
  url: string
  category: NewsItem['category']
}
export const NEWS_SOURCES: NewsSource[] = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto' },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml', category: 'crypto' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed', category: 'crypto' },
  { id: 'blockworks', name: 'Blockworks', url: 'https://blockworks.co/feed', category: 'crypto' },
  { id: 'bitcoinmag', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', category: 'crypto' },
  { id: 'cnbc', name: 'CNBC Markets', url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', category: 'markets' },
  { id: 'fed', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: 'macro' },
  { id: 'sec', name: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss', category: 'regulatory' },
  { id: 'cftc', name: 'CFTC', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', category: 'regulatory' },
  { id: 'gnews-btc', name: 'Google News · Bitcoin', url: 'https://news.google.com/rss/search?q=bitcoin+OR+crypto+when:1d&hl=en-US&gl=US&ceid=US:en', category: 'crypto' },
]
const txt = (el: Element | null | undefined, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? ''
const strip = (h: string) =>
  h
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
/** Parse RSS 2.0 or Atom into NewsItems. Works in the browser (DOMParser). */
export function parseFeed(xml: string, source: NewsSource): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const out: NewsItem[] = []
  const items = [...doc.querySelectorAll('item')]
  const entries = items.length ? items : [...doc.querySelectorAll('entry')]
  for (const it of entries.slice(0, 40)) {
    const title = strip(txt(it, 'title'))
    if (!title) continue
    const link = txt(it, 'link') || it.querySelector('link')?.getAttribute('href') || ''
    const date =
      txt(it, 'pubDate') || txt(it, 'published') || txt(it, 'updated') || it.getElementsByTagName('dc:date')[0]?.textContent || ''
    const ts = Date.parse(date) || Date.now()
    const summary = strip(txt(it, 'description') || txt(it, 'summary') || txt(it, 'content')).slice(0, 240)
    out.push({ id: `${source.id}:${link || title}`, title, link, source: source.name, ts, summary, category: source.category })
  }
  return out
}
/** Near-duplicate collapse: same normalized title prefix within 6h keeps the earliest. */
export function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Map<string, NewsItem>()
  for (const it of [...items].sort((a, b) => a.ts - b.ts)) {
    const k = it.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 6)
      .join(' ')
    const p = seen.get(k)
    if (p && Math.abs(p.ts - it.ts) < 6 * 3600e3) continue
    seen.set(k, it)
  }
  return [...seen.values()].sort((a, b) => b.ts - a.ts)
}
/** Cheap importance heuristic (0-3) for highlighting; not a prediction. */
export function importance(it: NewsItem): number {
  const t = it.title.toLowerCase()
  let s = 0
  if (/\b(sec|cftc|fed|fomc|powell|etf|regulat|lawsuit|ban|approv|hack|exploit|liquidat|halt|delist|bankrupt|rate cut|rate hike|cpi|inflation)\b/.test(t)) s += 2
  if (/\b(bitcoin|btc|ethereum|eth|binance|coinbase|tether|usdt|blackrock|microstrategy)\b/.test(t)) s += 1
  if (it.category === 'regulatory' || it.category === 'macro') s += 1
  return Math.min(3, s)
}