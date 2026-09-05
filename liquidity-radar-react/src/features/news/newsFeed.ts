import { COINS } from '../../constants/market'
import { esc, pfmt, timeAgo } from '../../utils/format'
import { $ } from '../../utils/dom'
import { mdVal } from '../../services/market'
import { state } from '../../services/store'

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

interface RssItem {
  title?: unknown
  link?: string
  pubDate?: string
  thumbnail?: unknown
  enclosure?: { link?: string }
}

interface RssResponse {
  status?: string
  items?: RssItem[]
}

const NEWS_RSS: Array<[string, string, string]> = [
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/', '#2563EB'],
  ['Cointelegraph', 'https://cointelegraph.com/rss', '#14B8A6'],
  ['CryptoSlate', 'https://cryptoslate.com/feed/', '#7C3AED'],
  ['Decrypt', 'https://decrypt.co/feed', '#0891B2'],
  ['The Block', 'https://www.theblock.co/rss.xml', '#F59E0B'],
  ['CoinGape', 'https://coingape.com/feed/', '#EC4899'],
  ['BeInCrypto', 'https://beincrypto.com/feed/', '#10B981'],
  ['Bitcoin Magazine', 'https://bitcoinmagazine.com/feed', '#F97316'],
  ['U.Today', 'https://u.today/rss', '#3B82F6'],
  ['AMBCrypto', 'https://ambcrypto.com/feed/', '#22D3EE'],
  ['The Crypto Times', 'https://www.cryptotimes.io/feed/', '#A78BFA'],
  ['Bitcoinist', 'https://bitcoinist.com/feed/', '#FBBF24'],
]

const newsCache: { news: NewsItem[] } = { news: [] }
const newsState: NewsState = { query: '', src: '', coin: '', shown: 30 }
const NEWS_STO_KEY = 'lr_news_cache'

interface NewsState {
  query: string
  src: string
  coin: string
  shown: number
}

function newsCoinsFor(title: string): string[] {
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

function newsSentiment(title: string): 'pos' | 'neg' | 'neu' {
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

function newsDedup(a: string, b: string): boolean {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true
  const wa = new Set(na.split(' ').filter((w) => w.length > 3))
  const wb = new Set(nb.split(' ').filter((w) => w.length > 3))
  if (!wa.size || !wb.size) return false
  let inter = 0
  wa.forEach((w) => {
    if (wb.has(w)) inter++
  })
  const union = wa.size + wb.size - inter
  return union > 0 && inter / union >= 0.6
}

function newsNormKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 60)
}

function newsCacheSave(): void {
  try {
    localStorage.setItem(NEWS_STO_KEY, JSON.stringify({ t: Date.now(), news: newsCache.news }))
  } catch (e) {
    /* ignore quota / private mode */
  }
}

function newsCacheLoad(): NewsItem[] | null {
  try {
    const raw = localStorage.getItem(NEWS_STO_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || !d.news || !d.news.length) return null
    if (Date.now() - d.t > 6 * 60 * 60 * 1000) return null
    return d.news
  } catch (e) {
    return null
  }
}

function newsFeedUrl(i: number): string {
  return 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(NEWS_RSS[i][1])
}

function rawNewsFetch(i: number, to?: number): Promise<RssResponse> {
  const c = new AbortController()
  const h = setTimeout(() => c.abort(), to || 15000)
  return fetch(newsFeedUrl(i), { signal: c.signal })
    .then((r) => r.json())
    .finally(() => clearTimeout(h))
}

async function rawNewsFetchFallback(i: number, to?: number): Promise<RssResponse> {
  const c = new AbortController()
  const h = setTimeout(() => c.abort(), to || 15000)
  const url = NEWS_RSS[i][1]
  try {
    const r = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), {
      signal: c.signal,
    })
    if (!r.ok) throw new Error('http ' + r.status)
    const xml = await r.text()
    const p = new DOMParser().parseFromString(xml, 'text/xml')
    const items = Array.from(p.querySelectorAll('item'))
    const out: RssResponse = {
      status: 'ok',
      items: items.map((it) => {
        const get = (sel: string) => {
          const el = it.querySelector(sel)
          return el ? (el.textContent || '').trim() : ''
        }
        return {
          title: get('title'),
          link: get('link'),
          pubDate: get('pubDate'),
          thumbnail: get('enclosure url, thumbnail'),
        }
      }),
    }
    return out
  } catch (e) {
    throw new Error('allorigins fail', { cause: e })
  } finally {
    clearTimeout(h)
  }
}

function rawNewsFetchAny(i: number): Promise<RssResponse> {
  return rawNewsFetch(i, 13000).catch(function () {
    return rawNewsFetchFallback(i, 15000)
  })
}

function newsSimplify(
  src: string,
  color: string,
): (it: RssItem | null | undefined) => NewsItem | null {
  return function (it) {
    if (!it || !it.title || typeof it.title !== 'string' || !it.title.trim()) return null
    const title = it.title.trim()
    const p = it.pubDate ? new Date(it.pubDate.replace(' ', 'T')).getTime() : Date.now()
    return {
      title,
      url: it.link || '#',
      time: p,
      src,
      color,
      img: (it.thumbnail as string | undefined) || (it.enclosure && it.enclosure.link) || null,
      coins: newsCoinsFor(title),
      sent: newsSentiment(title),
    }
  }
}

export async function fetchNews(): Promise<void> {
  const cached = newsCacheLoad()
  if (!newsCache.news && cached) {
    newsCache.news = cached
    renderNewsList()
    renderNewsMeta()
  }
  try {
    // stagger requests (120ms apart) so rss2json free-tier throttling doesn't drop feeds
    const results = await Promise.all(
      NEWS_RSS.map((_, i) =>
        new Promise<void>((res) => setTimeout(res, i * 120)).then(() =>
          rawNewsFetchAny(i).catch(() => null),
        ),
      ),
    )
    const merged: NewsItem[] = []
    results.forEach((res, i) => {
      if (!res || res.status !== 'ok' || !res.items) return
      const src = NEWS_RSS[i][0]
      const color = NEWS_RSS[i][2]
      res.items.map(newsSimplify(src, color)).forEach((n) => {
        if (!n) return
        const k = newsNormKey(n.title)
        if (!k) return
        if (!merged.some((m) => newsDedup(m.title, n.title) || newsNormKey(m.title) === k))
          merged.push(n)
      })
    })
    merged.sort((a, b) => b.time - a.time)
    const unique: NewsItem[] = []
    merged.forEach((n) => {
      if (unique.some((u) => newsDedup(u.title, n.title))) return
      unique.push(n)
    })
    if (!unique.length) throw new Error('empty')
    newsCache.news = unique
    newsCacheSave()
    renderNewsList()
    renderNewsMeta()
    const srcCounts: Record<string, number> = {}
    unique.forEach((n) => {
      srcCounts[n.src] = (srcCounts[n.src] || 0) + 1
    })
    $('newsSrcStrip')!.innerHTML =
      NEWS_RSS.filter((n) => srcCounts[n[0]])
        .map(
          (n) =>
            '<span class="news-src-tag' +
            (newsState.src === n[0] ? ' on' : '') +
            '" data-src="' +
            esc(n[0]) +
            '"><b>' +
            esc(n[0]) +
            '</b> ' +
            srcCounts[n[0]] +
            '</span>',
        )
        .join('') || ''
    const clear = $('newsSrcClear')!
    clear.style.display = newsState.src ? 'inline-flex' : 'none'
    if (newsState.src) $('newsSrcName')!.textContent = newsState.src
    renderTrending(unique)
    fetchBreaking()
    wireNewsUI()
  } catch (e) {
    if (newsCache.news && newsCache.news.length) {
      renderNewsList()
    } else {
      $('newsList')!.innerHTML =
        '<div class="fc-note">News feed unreachable from this network. Core radar features remain live via Binance.</div>'
      $('newsCount')!.textContent = 'OFFLINE'
      $('newsMore')!.style.display = 'none'
    }
  }
}

function filteredNews(): NewsItem[] {
  const q = newsState.query.trim().toLowerCase()
  const items = newsCache.news || []
  return items.filter((n) => {
    if (newsState.src && n.src !== newsState.src) return false
    if (newsState.coin && (!n.coins || n.coins.indexOf(newsState.coin) < 0)) return false
    if (q && n.title.toLowerCase().indexOf(q) < 0) return false
    return true
  })
}

function newsChipHtml(k: string, count?: number): string {
  if (!COINS[k]) return ''
  const c = COINS[k]
  let px = ''
  const tk = state.tickers && state.tickers[c.sym]
  if (tk && tk.last && mdVal.price(tk.last)) {
    px =
      ' <span class="nc-px ' +
      (tk.pct >= 0 ? 'up' : 'dn') +
      '">' +
      pfmt(tk.last) +
      (tk.pct != null ? ' ' + ((tk.pct >= 0 ? '+' : '') + tk.pct.toFixed(2)) + '%' : '') +
      '</span>'
  }
  return (
    '<span class="news-coin-chip' +
    (newsState.coin === k ? ' coin-on' : '') +
    '" data-coin="' +
    k +
    '" role="button" tabindex="0" title="' +
    esc(c.name) +
    '">' +
    esc(c.icon) +
    ' ' +
    k +
    px +
    (count ? ' <b class="nc-cnt" style="color:var(--dim)">' + count + '</b>' : '') +
    '</span>'
  )
}

function renderNewsMeta(): void {
  const items = newsCache.news || []
  const row = $('newsSentRow')
  const gauge = $('newsSentFill')
  const lbl = $('newsSentLbl')
  const cnt = $('newsSentCount')
  const strip = $('newsCoinStrip')
  if (row && items.length) {
    let pos = 0
    let neu = 0
    let neg = 0
    items.forEach((n) => {
      if (n.sent === 'pos') pos++
      else if (n.sent === 'neg') neg++
      else neu++
    })
    const total = pos + neu + neg || 1
    const left = Math.max(6, Math.min(94, 50 + ((pos - neg) / total) * 50))
    gauge!.style.left = left + '%'
    const cls = (pos - neg) / total > 0.12 ? 'pos' : (pos - neg) / total < -0.12 ? 'neg' : 'neu'
    const label =
      cls === 'pos'
        ? 'BULLISH ' + Math.round((pos / total) * 100) + '%'
        : cls === 'neg'
          ? 'BEARISH ' + Math.round((neg / total) * 100) + '%'
          : 'NEUTRAL'
    lbl!.innerHTML = '<span class="news-sent-tag ' + cls + '">' + label + '</span>'
    cnt!.textContent = pos + ' pos · ' + neu + ' neu · ' + neg + ' neg'
    row.style.display = 'flex'
  } else if (row) {
    row.style.display = 'none'
  }
  if (strip) {
    const map: Record<string, number> = {}
    items.forEach((n) =>
      (n.coins || []).forEach((k) => {
        if (COINS[k]) map[k] = (map[k] || 0) + 1
      }),
    )
    const chips = Object.keys(map)
      .map((k) => ({ k, n: map[k] }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 12)
    strip.innerHTML = chips.length ? chips.map((c) => newsChipHtml(c.k, c.n)).join('') : ''
  }
}

function renderNewsList(): void {
  if (!newsCache.news) return
  const list = filteredNews()
  const shown = newsState.shown
  $('newsCount')!.textContent =
    (newsState.src || newsState.query ? list.length + ' / ' + newsCache.news.length : list.length) +
    ' STORIES'
  if (!list.length) {
    $('newsList')!.innerHTML = '<div class="fc-note">No stories match this filter.</div>'
    $('newsMore')!.style.display = 'none'
    return
  }
  $('newsList')!.innerHTML = list
    .slice(0, shown)
    .map((n) => {
      const sentCls = n.sent === 'pos' ? 'sent-pos' : n.sent === 'neg' ? 'sent-neg' : 'sent-neu'
      const sentTag = n.sent
        ? '<span class="ni-sent s-' +
          n.sent +
          '">' +
          (n.sent === 'pos' ? 'POS' : n.sent === 'neg' ? 'NEG' : 'NEU') +
          '</span>'
        : ''
      const coinTags =
        n.coins && n.coins.length
          ? '<div class="ni-coins">' + n.coins.map((k) => newsChipHtml(k)).join('') + '</div>'
          : ''
      return (
        '<a class="news-item ' +
        sentCls +
        '" href="' +
        esc(n.url) +
        '" target="_blank" rel="noopener">' +
        '<div class="news-item-body">' +
        '<div class="ni-meta">' +
        sentTag +
        '<span class="ni-src-badge" style="background:' +
        n.color +
        '">' +
        esc(n.src) +
        '</span><span class="ni-time">' +
        (n.time ? timeAgo(n.time) : '') +
        '</span></div>' +
        '<div class="ni-title">' +
        esc(n.title) +
        '</div>' +
        coinTags +
        '</div>' +
        (n.img && !/logo|placeholder|\.svg/i.test(n.img)
          ? '<img class="news-thumb" src="' +
            esc(n.img) +
            '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
          : '') +
        '</a>'
      )
    })
    .join('')
  $('newsMore')!.style.display = list.length > shown ? 'block' : 'none'
}

function renderTrending(items: NewsItem[]): void {
  const words = items.map((n) => n.title)
  const map: Record<string, any> = {}
  const CO = (n: string) =>
    n
      .replace(/#/g, '')
      .split(/\s+/)
      .filter(
        (w) =>
          /^[$A-Z]{3,5}$/i.test(w) ||
          /^(Bitcoin|Ethereum|Solana|Dogecoin|XRP|Dogwifhat|Cardano|Sui|Polkadot|Avalanche|Tron|Chainlink|Uniswap|PEPE|TRUMP|Binance Coin|BNB)$/i.test(
            w,
          ),
      )
  words.forEach((t) => {
    CO(t).forEach((w) => {
      const k = w.toUpperCase()
      map[k] = (map[k] || 0) + 1
    })
  })
  Object.keys(map).forEach((k) => {
    const lines = words.filter((t) => t.toUpperCase().includes(k))
    map[k] = { c: map[k], first: lines[0] }
  })
  const list = Object.keys(map)
    .sort((a, b) => map[b].c - map[a].c)
    .slice(0, 12)
    .filter((k) => map[k].c > 1)
  if (!list.length) {
    $('trendingList')!.innerHTML =
      '<div class="fc-note">No strong trends in the current feed yet.</div>'
    return
  }
  $('trendingList')!.innerHTML = list
    .map((k, i) => {
      const t = map[k]
      const head = t.first
        ? '<div class="tr-chips-wrap" style="flex-basis:100%;margin-top:4px;padding-top:6px;border-top:1px dashed var(--border);font-size:10px;color:var(--dim);line-height:1.4;text-overflow:ellipsis;overflow:hidden;white-space:nowrap">' +
          esc(t.first) +
          '</div>'
        : ''
      return (
        '<div class="trend-chip" data-word="' +
        esc(k) +
        '" role="button" tabindex="0"><span class="tr-rank">#' +
        (i + 1) +
        '</span><span style="font-weight:700;font-size:12.5px">' +
        esc(k) +
        '</span><span class="tr-score">' +
        t.c +
        ' stories</span>' +
        head +
        '</div>'
      )
    })
    .join('')
}

function applyNewsFilter({
  word,
  src,
  query,
  coin,
}: { word?: string; src?: string; query?: string; coin?: string } = {}): void {
  if (word) {
    newsState.query = word
    ;($('newsSearch') as HTMLInputElement).value = word
  }
  if (src !== undefined) newsState.src = src
  if (coin !== undefined) newsState.coin = coin
  if (query !== undefined) {
    newsState.query = query
  }
  newsState.shown = 30
  renderNewsList()
  const tags = document.querySelectorAll('.news-src-tag')
  tags.forEach((t) => t.classList.toggle('on', (t as HTMLElement).dataset.src === newsState.src))
  const clear = $('newsSrcClear')!
  clear.style.display = newsState.src ? 'inline-flex' : 'none'
  if (newsState.src) $('newsSrcName')!.textContent = newsState.src
  document
    .querySelectorAll('.news-coin-chip[data-coin]')
    .forEach((ch) =>
      ch.classList.toggle('coin-on', (ch as HTMLElement).dataset.coin === newsState.coin),
    )
}

let newsCoinClicksBound = false
function wireNewsUI(): void {
  const tagEls = document.querySelectorAll('.news-src-tag')
  tagEls.forEach((t) => {
    ;(t as HTMLElement).onclick = (ev) => {
      ev.stopPropagation()
      applyNewsFilter({
        src: (t as HTMLElement).dataset.src === newsState.src ? '' : (t as HTMLElement).dataset.src,
      })
    }
  })
  $('newsSrcClear')!.onclick = () => applyNewsFilter({ src: '' })
  $('newsMore')!.onclick = () => {
    newsState.shown += 30
    renderNewsList()
  }
  ;($('newsSearch') as HTMLInputElement).oninput = () =>
    applyNewsFilter({ query: ($('newsSearch') as HTMLInputElement).value })
  const chips = document.querySelectorAll('.trend-chip')
  chips.forEach((c) => {
    ;(c as HTMLElement).onclick = (ev) => {
      ev.stopPropagation()
      applyNewsFilter({ word: (c as HTMLElement).dataset.word })
    }
  })
  if (!newsCoinClicksBound) {
    newsCoinClicksBound = true
    document.addEventListener('click', (ev) => {
      const chip = (ev.target as HTMLElement).closest('.news-coin-chip') as HTMLElement | null
      if (!chip) return
      ev.preventDefault()
      ev.stopPropagation()
      applyNewsFilter({ coin: chip.dataset.coin === newsState.coin ? '' : chip.dataset.coin })
    })
  }
}

export async function fetchTrending(): Promise<void> {
  if (newsCache.news) {
    renderTrending(newsCache.news)
  } else {
    $('trendingList')!.innerHTML =
      '<div class="fc-note">Wait — loading trends with the news feed…</div>'
  }
}

export async function fetchBreaking(): Promise<void> {
  const items = newsCache.news || []
  if (!items.length) return
  const breaking = items
    .filter((n) =>
      /breaking|just in|urgent|flash|sec|regulatory|hack|fraud|pushes|surge|crash|hits|records|etf$|sec approves|ban|freeze/i.test(
        n.title,
      ),
    )
    .slice(0, 4)
  if (!breaking.length) return
  $('breakingBox')!.style.display = 'block'
  $('breakingList')!.innerHTML = breaking
    .map((n) => {
      return (
        '<div class="bb-item"><span class="bb-live">BREAKING</span><a href="' +
        esc(n.url) +
        '" target="_blank" rel="noopener" style="color:var(--txt);font-weight:600;font-size:13px">' +
        esc(n.title) +
        '</a><span class="ni-time">' +
        esc(n.src) +
        '</span></div>'
      )
    })
    .join('')
}

export { wireNewsUI }
