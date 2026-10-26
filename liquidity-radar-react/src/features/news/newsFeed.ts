import { noteCall } from '../../services/dataSources'
import { COINS } from '../../constants/market'
import { esc, pfmt, timeAgo } from '../../utils/format'
import { $ } from '../../utils/dom'
import { mdVal } from '../../services/market'
import { state } from '../../services/store'
import { safeUrl } from '../../utils/url'
import { newsSimplify, type NewsItem, type RssItem } from './newsItem'
import { hedge, loadNewsProgressive, type NewsLoadUpdate, type NewsPhase } from './newsLoad'

export type { NewsItem }

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

/** The latest wire, for anything that wants headlines without refetching. */
export function latestNews(): NewsItem[] {
  return newsCache.news
}
const newsState: NewsState = { query: '', src: '', coin: '', shown: 30 }
const NEWS_STO_KEY = 'lr_news_cache'

interface NewsState {
  query: string
  src: string
  coin: string
  shown: number
}

function newsCacheSave(): void {
  try {
    localStorage.setItem(NEWS_STO_KEY, JSON.stringify({ t: Date.now(), news: newsCache.news }))
  } catch (e) {
    /* ignore quota / private mode */
  }
}

function newsCacheLoad(): { t: number; news: NewsItem[] } | null {
  try {
    const raw = localStorage.getItem(NEWS_STO_KEY)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || !d.news || !d.news.length) return null
    if (Date.now() - d.t > 6 * 60 * 60 * 1000) return null
    // A cache written before links were sanitised can still hold a
    // javascript: URL, and latestNews() hands these items to other views.
    const news = (d.news as NewsItem[])
      .filter((n) => n && typeof n === 'object' && typeof n.title === 'string')
      .map((n) => ({
        ...n,
        url: safeUrl(n.url),
        img: n.img && safeUrl(n.img) !== '#' ? n.img : null,
      }))
    return news.length ? { t: Number(d.t) || 0, news } : null
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
  const url = newsFeedUrl(i)
  const t0 = Date.now()
  return fetch(url, { signal: c.signal })
    .then((r) => {
      noteCall(url, r.ok, r.status, Date.now() - t0)
      return r.json()
    })
    .catch((e) => {
      noteCall(url, false, 0, Date.now() - t0)
      throw e
    })
    .finally(() => clearTimeout(h))
}

function parseRssXml(xml: string): RssResponse {
  const p = new DOMParser().parseFromString(xml, 'text/xml')
  const items = Array.from(p.querySelectorAll('item'))
  return {
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
}

async function rawNewsFetchProxy(i: number, to?: number): Promise<RssResponse> {
  const c = new AbortController()
  const h = setTimeout(() => c.abort(), to || 15000)
  try {
    const t0 = Date.now()
    const r = await fetch('/api/fetch?url=' + encodeURIComponent(NEWS_RSS[i][1]), {
      signal: c.signal,
    })
    // Recorded against the same-origin proxy, which is its own source.
    noteCall('/api/fetch', r.ok, r.status, Date.now() - t0)
    if (!r.ok) throw new Error('proxy http ' + r.status)
    return parseRssXml(await r.text())
  } finally {
    clearTimeout(h)
  }
}

// Per-source budgets. rss2json usually answers in 1-3 s; the proxy is asked
// as well once rss2json has had a head start, so one slow source no longer
// costs a feed the sum of both timeouts.
const RSS2JSON_TIMEOUT = 7000
const PROXY_TIMEOUT = 7000
const PROXY_HEAD_START = 3500
/** After this the loading state ends with whatever has arrived. */
const NEWS_DEADLINE = 8000

function rawNewsFetchAny(i: number): Promise<RssResponse> {
  // rss2json (CORS-enabled) first, then the same-origin /api/fetch proxy.
  // A 200 from rss2json can still carry status:"error" (feed it cannot
  // read), which used to drop the feed without trying the proxy.
  return hedge(
    () =>
      rawNewsFetch(i, RSS2JSON_TIMEOUT).then((r) => {
        if (!r || r.status !== 'ok' || !r.items) throw new Error('rss2json ' + (r && r.status))
        return r
      }),
    () => rawNewsFetchProxy(i, PROXY_TIMEOUT),
    PROXY_HEAD_START,
  )
}

function feedItems(i: number): Promise<NewsItem[] | null> {
  return rawNewsFetchAny(i).then((res) => {
    if (!res || res.status !== 'ok' || !res.items) return null
    return res.items
      .map(newsSimplify(NEWS_RSS[i][0], NEWS_RSS[i][2]))
      .filter((n): n is NewsItem => !!n)
  })
}

const newsStatus: { phase: NewsPhase | 'idle'; cachedAt: number | null } = {
  phase: 'idle',
  cachedAt: null,
}

/** Where the wire is: for views (the dashboard tile) that need the empty/error state. */
export function newsLoadPhase(): NewsPhase | 'idle' {
  return newsStatus.phase
}

/**
 * Put the lr_news_cache copy on screen before any feed is asked. Safe to
 * call before the News tab exists; only fills in when nothing is shown yet.
 */
export function primeNewsCache(): void {
  if (newsCache.news.length) return
  const cached = newsCacheLoad()
  if (!cached) return
  newsCache.news = cached.news
  newsStatus.phase = 'ready'
  newsStatus.cachedAt = cached.t || null
  renderNewsAll()
}

function cachedLabel(): string {
  if (newsStatus.cachedAt == null) return ''
  return ' · CACHED ' + timeAgo(newsStatus.cachedAt).toUpperCase()
}

function renderNewsAll(): void {
  if (!$('newsList')) return
  renderNewsList()
  renderNewsMeta()
  const items = newsCache.news
  const srcCounts: Record<string, number> = {}
  items.forEach((n) => {
    srcCounts[n.src] = (srcCounts[n.src] || 0) + 1
  })
  const strip = $('newsSrcStrip')
  if (strip)
    strip.innerHTML =
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
  const clear = $('newsSrcClear')
  if (clear) clear.style.display = newsState.src ? 'inline-flex' : 'none'
  if (newsState.src && $('newsSrcName')) $('newsSrcName')!.textContent = newsState.src
  renderTrending(items)
  fetchBreaking()
  wireNewsUI()
}

function renderNewsProblem(phase: 'empty' | 'error'): void {
  const list = $('newsList')
  if (!list) return
  list.innerHTML =
    phase === 'empty'
      ? '<div class="fc-note">No stories in the feeds right now. They refresh every five minutes.</div>'
      : '<div class="fc-note">News unavailable — the feeds did not answer. Core radar features remain live via Binance. ' +
        '<button type="button" class="dt-cta" style="display:inline-flex;margin-left:6px" data-news-retry="1">Retry</button></div>'
  $('newsCount')!.textContent = phase === 'empty' ? '0 STORIES' : 'OFFLINE'
  $('newsMore')!.style.display = 'none'
  // Trending is ranked from the feed, so it has nothing to wait for either.
  const trend = $('trendingList')
  if (trend)
    trend.innerHTML =
      '<div class="fc-note">' +
      (phase === 'empty' ? 'No coins mentioned in the current feed yet.' : 'Trends need the news feed, which is unavailable right now.') +
      '</div>'
  const btn = list.querySelector('[data-news-retry]') as HTMLButtonElement | null
  if (btn) btn.onclick = () => retryNews()
}

/** Re-run the fetch now (the Retry buttons on the News tab and dashboard). */
export function retryNews(): void {
  if (newsStatus.phase === 'error') {
    newsStatus.phase = 'loading'
    const list = $('newsList')
    if (list) list.innerHTML = '<div class="fc-note">Loading live feed…</div>'
    const cnt = $('newsCount')
    if (cnt) cnt.textContent = '—'
  }
  void fetchNews()
}

let newsRun = 0

export async function fetchNews(): Promise<void> {
  primeNewsCache()
  const run = ++newsRun
  if (!newsCache.news.length) newsStatus.phase = 'loading'
  const apply = (u: NewsLoadUpdate) => {
    if (u.phase === 'loading') return
    if (u.phase === 'ready') {
      newsStatus.phase = 'ready'
      if (!u.cached) {
        newsStatus.cachedAt = null
        newsCache.news = u.items
      }
      renderNewsAll()
      return
    }
    newsStatus.phase = u.phase
    newsCache.news = []
    renderNewsProblem(u.phase)
  }
  // Every feed at once (staggered 120ms so rss2json's free tier doesn't drop
  // any), rendered as each lands; see loadNewsProgressive for the rules.
  const final = await loadNewsProgressive({
    total: NEWS_RSS.length,
    fetchFeed: feedItems,
    onUpdate: apply,
    cached: newsCache.news,
    deadlineMs: NEWS_DEADLINE,
    staggerMs: 120,
    isCurrent: () => run === newsRun,
  })
  if (run === newsRun && final && final.phase === 'ready' && !final.cached) newsCacheSave()
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
  // Nothing loaded yet: leave the loading / unavailable message in place.
  if (!newsCache.news.length) return
  const list = filteredNews()
  const shown = newsState.shown
  $('newsCount')!.textContent =
    (newsState.src || newsState.query ? list.length + ' / ' + newsCache.news.length : list.length) +
    ' STORIES' +
    cachedLabel()
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
        esc(safeUrl(n.url)) +
        '" target="_blank" rel="noopener noreferrer">' +
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
        (n.img && !/logo|placeholder|\.svg/i.test(n.img) && safeUrl(n.img) !== '#'
          ? '<img class="news-thumb" src="' +
            esc(safeUrl(n.img)) +
            '" alt="" loading="lazy" onerror="this.style.display=\'none\'">'
          : '') +
        '</a>'
      )
    })
    .join('')
  $('newsMore')!.style.display = list.length > shown ? 'block' : 'none'
}

/**
 * Trending Now — which coins the current feed is actually talking about.
 *
 * Each article is already tagged with the coins it mentions, so this counts
 * those tags rather than guessing at capitalised words: a coin only appears
 * here because articles named it. Clicking a row filters the feed to that coin.
 */
function renderTrending(items: NewsItem[]): void {
  const box = $('trendingList')
  if (!box) return
  interface Row {
    k: string
    n: number
    pos: number
    neg: number
    latest: NewsItem | null
  }
  const map: Record<string, Row> = {}
  items.forEach((n) => {
    ;(n.coins || []).forEach((k) => {
      if (!COINS[k]) return
      const r = map[k] || (map[k] = { k: k, n: 0, pos: 0, neg: 0, latest: null })
      r.n++
      if (n.sent === 'pos') r.pos++
      else if (n.sent === 'neg') r.neg++
      if (!r.latest || n.time > r.latest.time) r.latest = n
    })
  })
  const list = Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => b.n - a.n || (b.latest?.time ?? 0) - (a.latest?.time ?? 0))
    .slice(0, 10)
  if (!list.length) {
    box.innerHTML = '<div class="fc-note">No coins mentioned in the current feed yet.</div>'
    return
  }
  const top = list[0].n || 1
  box.innerHTML = list
    .map((r, i) => {
      const c = COINS[r.k]
      const tk = state.tickers && state.tickers[c.sym]
      const px =
        tk && tk.last && mdVal.price(tk.last)
          ? '<span class="tc-px ' +
            (tk.pct >= 0 ? 'up' : 'dn') +
            '">$' +
            pfmt(tk.last) +
            (tk.pct != null
              ? ' <i>' + (tk.pct >= 0 ? '+' : '') + tk.pct.toFixed(2) + '%</i>'
              : '') +
            '</span>'
          : ''
      // Tone from the articles themselves, not from price.
      const tone = r.pos > r.neg ? 'pos' : r.neg > r.pos ? 'neg' : 'neu'
      const toneLbl = tone === 'pos' ? 'bullish' : tone === 'neg' ? 'bearish' : 'neutral'
      return (
        '<div class="trend-coin' +
        (newsState.coin === r.k ? ' on' : '') +
        '" data-coin="' +
        esc(r.k) +
        '" role="button" tabindex="0" title="Show only ' +
        esc(c.name) +
        ' stories">' +
        '<span class="tc-rank">#' +
        (i + 1) +
        '</span>' +
        '<span class="tc-icon">' +
        esc(c.icon) +
        '</span>' +
        '<span class="tc-id"><b>' +
        esc(r.k) +
        '</b><small>' +
        esc(c.name) +
        '</small></span>' +
        px +
        '<span class="tc-meter" aria-hidden="true"><i style="width:' +
        Math.round((r.n / top) * 100) +
        '%"></i></span>' +
        '<span class="tc-count"><b>' +
        r.n +
        '</b> ' +
        (r.n === 1 ? 'story' : 'stories') +
        '</span>' +
        '<span class="tc-tone ' +
        tone +
        '">' +
        toneLbl +
        '</span>' +
        (r.latest ? '<span class="tc-head">' + esc(r.latest.title) + '</span>' : '') +
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
  // Keep the coin chips and trending rows showing which coin is filtered.
  if (coin !== undefined) {
    renderNewsMeta()
    if (newsCache.news) renderTrending(newsCache.news)
  }
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
  if (!newsCoinClicksBound) {
    newsCoinClicksBound = true
    document.addEventListener('click', (ev) => {
      const chip = (ev.target as HTMLElement).closest(
        '.news-coin-chip,.trend-coin',
      ) as HTMLElement | null
      if (!chip) return
      ev.preventDefault()
      ev.stopPropagation()
      applyNewsFilter({ coin: chip.dataset.coin === newsState.coin ? '' : chip.dataset.coin })
    })
  }
}

export async function fetchTrending(): Promise<void> {
  if (newsCache.news.length) {
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
        esc(safeUrl(n.url)) +
        '" target="_blank" rel="noopener noreferrer" style="color:var(--txt);font-weight:600;font-size:13px">' +
        esc(n.title) +
        '</a><span class="ni-time">' +
        esc(n.src) +
        '</span></div>'
      )
    })
    .join('')
}

export { wireNewsUI }
