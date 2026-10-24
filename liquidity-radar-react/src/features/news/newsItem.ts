// Turning one feed item into a NewsItem: coin tags, headline tone and a
// link that is safe to render. Kept apart from newsFeed.ts (which needs the
// DOM and the market store) so the unit tests can run it under plain Node.
import { COINS } from '../../constants/market.ts'
import { safeUrl } from '../../utils/url.ts'

export interface NewsItem {
  title: string
  url: string
  time: number
  src: string
  color: string
  img: string | null
  coins: string[]
  sent: 'pos' | 'neg' | 'neu'
}

export interface RssItem {
  title?: unknown
  link?: string
  pubDate?: string
  thumbnail?: unknown
  enclosure?: { link?: string }
}

export function newsCoinsFor(title: string): string[] {
  const coins: string[] = []
  const t = (title || '').toUpperCase()
  for (const k in COINS) {
    const c = COINS[k]
    if (!c || !c.sym) continue
    const names = [k, c.name.toUpperCase()].filter(Boolean)
    if (names.some((n) => n.length >= 3 && t.indexOf(n) > -1)) coins.push(k)
  }
  const alt: Record<string, string> = {
    ETHEREUM: 'ETH',
    BITCOIN: 'BTC',
    SOLANA: 'SOL',
    BINANCE: 'BNB',
    'BNB COIN': 'BNB',
    XRP: 'XRP',
    DOGECOIN: 'DOGE',
    DOGE: 'DOGE',
    'SHIBA INU': 'SHIB',
    PEPE: 'PEPE',
    CARDANO: 'ADA',
    AVALANCHE: 'AVAX',
    POLKADOT: 'DOT',
    CHAINLINK: 'LINK',
    UNISWAP: 'UNI',
    ARBITRUM: 'ARB',
    OPTIMISM: 'OP',
    POLYGON: 'POL',
    SUI: 'SUI',
    APTOS: 'APT',
    NEAR: 'NEAR',
    INJECTIVE: 'INJ',
    CELESTIA: 'TIA',
    SEI: 'SEI',
    MAKER: 'MKR',
    AAVE: 'AAVE',
    FILECOIN: 'FIL',
    BONK: 'BONK',
    FLOKI: 'FLOKI',
    ONDO: '',
    RENDER: '',
  }
  Object.keys(alt).forEach((name) => {
    const cn = alt[name]
    if (cn && t.indexOf(name) > -1 && coins.indexOf(cn) < 0) coins.push(cn)
  })
  return coins
}

export function newsSentiment(title: string): 'pos' | 'neg' | 'neu' {
  const pos = [
    'surge',
    'rallies',
    'soars',
    'hits all-time',
    'record high',
    'gain',
    'gains',
    'bullish',
    'breakout',
    'breaks out',
    'adopts',
    'approval',
    'approved',
    'launch',
    'partnership',
    'institutional',
    'inflow',
    'accumulat',
    'recovery',
    'rebound',
    'upgrade',
    'milestone',
    'outperform',
    'beats',
    'beats earnings',
    'positive',
    'boost',
    'win',
    'wins',
    'green',
    'new high',
    'all-time high',
    'etf approves',
    'cleared',
    'mainnet',
    'integration',
    'investment',
    'demand surge',
    'adoption',
  ]
  const neg = [
    'crash',
    'plunges',
    'tanks',
    'slumps',
    'drops',
    'sell-off',
    'selloff',
    'decline',
    'bearish',
    'hack',
    'exploit',
    'fraud',
    'scam',
    'lawsuit',
    'sues',
    'banned',
    'ban',
    'freeze',
    'seized',
    'arrest',
    'insolvenc',
    'bankrupt',
    'delist',
    'collapse',
    'dip',
    'warning',
    'crackdown',
    'regulatory risk',
    'fine',
    'penal',
    'loss',
    'outflow',
    'withdrawal halt',
    'pump and dump',
    'ponzi',
    'rug pull',
    'vulnerability',
    'security breach',
    'data breach',
    'deficit',
    'downgrade',
    'fail',
    'fails',
    'unemploy',
    'recession',
    'inflation fears',
    'repeats',
    'resign',
    'step down',
    'suspension',
  ]
  let s = 0
  const text = (title || '').toLowerCase()
  pos.forEach((w) => {
    if (text.indexOf(w) > -1) s += 1
  })
  neg.forEach((w) => {
    if (text.indexOf(w) > -1) s -= 1
  })
  if (
    text.indexOf('not ') > -1 &&
    (text.indexOf('not approve') > -1 ||
      text.indexOf('not fixing') > -1 ||
      text.indexOf('no gains') > -1)
  )
    s -= 1
  return s > 0 ? 'pos' : s < 0 ? 'neg' : 'neu'
}

export function newsSimplify(
  src: string,
  color: string,
): (it: RssItem | null | undefined) => NewsItem | null {
  return function (it) {
    if (!it || !it.title || typeof it.title !== 'string' || !it.title.trim()) return null
    const title = it.title.trim()
    // rss2json sends "2026-10-24 10:00:00"; the /api/fetch proxy hands over the
    // raw RFC 822 pubDate ("Fri, 24 Oct 2026 10:00:00 +0000"), which the
    // space-to-T rewrite turns into NaN ("NaNd ago", and a NaN sort key).
    let p = it.pubDate ? new Date(it.pubDate.replace(' ', 'T')).getTime() : Date.now()
    if (!Number.isFinite(p)) p = it.pubDate ? new Date(it.pubDate).getTime() : NaN
    if (!Number.isFinite(p)) p = 0
    // Links and thumbnails come straight from third-party feeds and end up in
    // href/src attributes (and in the lr_news_cache copy), so only http(s).
    const img = (it.thumbnail as string | undefined) || (it.enclosure && it.enclosure.link) || null
    return {
      title,
      url: safeUrl(it.link),
      time: p,
      src,
      color,
      img: img && safeUrl(img) !== '#' ? safeUrl(img) : null,
      coins: newsCoinsFor(title),
      sent: newsSentiment(title),
    }
  }
}
