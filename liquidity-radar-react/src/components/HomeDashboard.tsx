// The landing page: a dashboard of the whole app — price, signals, book
// quality, movers, venues, liquidations, sentiment, headlines, a watchlist
// and a market overview — each with a way through to its full section.
//
// Almost every widget reads the live state the full sections already keep, so
// they cost no extra requests. The few that need data nobody else fetches
// (market-wide stats, Fear & Greed history, longer BTC ranges) come from
// features/home/homeData, cached and throttled to how often each changes.
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { state } from '../services/store'
import { signalData } from '../features/signals'
import { bookMetrics, fmtUsd, liquidityScore } from '../features/charts/sidePanels/metrics'
import type { CrossExRow } from '../features/advanced/advancedData'
import { latestNews } from '../features/news/newsFeed'
import { COINS } from '../constants/market'
import { baseOf, coinMeta } from '../utils/coins'
import { cfmt, pfmt } from '../utils/format'
import { useTick } from './useTick'
import { AreaChart, PairBars } from './home/charts'
import { priceTicks } from './home/ticks'
import { HomeIcon } from './home/icons'
import type { HomeIconId } from './home/icons'
import {
  RANGES,
  getFgHistory,
  getGlobal,
  getSeries,
  refreshFgHistory,
  refreshGlobal,
  refreshSeries,
} from '../features/home/homeData'
import type { Range } from '../features/home/homeData'

const w = window as unknown as { switchTab?: (t: string) => void; setSymbol?: (s: string) => void }
const go = (tab: string) => w.switchTab?.(tab)
const open = (sym: string, tab = 'radar') => {
  w.setSymbol?.(sym)
  go(tab)
}

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 12h13M12.5 5.5 19 12l-6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** One dashboard card: an icon, a title, a link through, and its content. */
function Tile({
  title,
  icon,
  tab,
  cta,
  area,
  children,
}: {
  title: string
  icon: HomeIconId | ReactNode
  tab?: string
  cta?: string
  /** Grid slot, see .dash-grid in index.css. */
  area: string
  children: ReactNode
}) {
  return (
    <section className={'card dt dt-' + area} aria-label={title}>
      <header className="dt-head">
        <span className="dt-ico">
          {typeof icon === 'string' ? <HomeIcon id={icon as HomeIconId} /> : icon}
        </span>
        <h3 className="dt-title">{title}</h3>
        {tab && cta && (
          <button type="button" className="dt-cta" onClick={() => go(tab)}>
            {cta}
            <Arrow />
          </button>
        )}
      </header>
      <div className="dt-body">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="dt-empty">{children}</div>
}

/** A coin's logo (CoinGecko) when known, else its glyph on its brand colour. */
function CoinBadge({ sym, size = 22 }: { sym: string; size?: number }) {
  const key = baseOf(sym)
  const meta = coinMeta(sym)
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[key]?.image
  return (
    <span
      className="coin-badge"
      style={{
        width: size,
        height: size,
        color: meta.color,
        borderColor: meta.color + '66',
        background: meta.color + '1f',
        fontSize: size * 0.5,
      }}
    >
      {img ? (
        <img src={img} alt="" width={size} height={size} loading="lazy" decoding="async" />
      ) : (
        meta.icon
      )}
    </span>
  )
}

const pct = (v: number | undefined) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

function ago(t: number, now: number): string {
  const m = Math.max(0, Math.round((now - t) / 60_000))
  if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60)
  return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago'
}

// ---- tiles --------------------------------------------------------------

function PriceTile() {
  const t = state.tickers[state.symbol] as
    { last?: number; pct?: number; high?: number; low?: number; qvol?: number } | undefined
  const closes = (state.candles as Array<{ c: number }>).slice(-96).map((c) => c.c)
  if (!t || !t.last) return <Empty>Waiting for the first tick…</Empty>
  const up = (t.pct ?? 0) >= 0
  return (
    <div className="pt">
      <div className="pt-price">
        <b>${pfmt(t.last)}</b>
        <span className={up ? 'up' : 'dn'}>
          {pct(t.pct)} <small>(24h)</small>
        </span>
      </div>
      <div className="pt-row">
        <div className="pt-spark">
          <small>{baseOf(state.symbol)} · recent candles</small>
          <AreaChart values={closes} height={58} />
        </div>
        <dl className="dt-kv">
          <dt>24h Low</dt>
          <dd>{t.low ? '$' + pfmt(t.low) : '—'}</dd>
          <dt>24h High</dt>
          <dd>{t.high ? '$' + pfmt(t.high) : '—'}</dd>
          <dt>Volume</dt>
          <dd>{t.qvol ? cfmt(t.qvol) : '—'}</dd>
        </dl>
      </div>
    </div>
  )
}

function SignalsTile() {
  const rows = signalData as Array<{
    sym: string
    score: number
    master: { type: string }
    conv?: { tier: string; agree: number; of: number }
    plan?: { rr: number } | null
  }>
  const top = useMemo(() => {
    const rank: Record<string, number> = { STRONG: 2, MODERATE: 1, WEAK: 0 }
    return rows
      .filter((r) => r.master.type !== 'WAIT')
      .slice()
      .sort(
        (a, b) =>
          (rank[b.conv?.tier ?? ''] || 0) - (rank[a.conv?.tier ?? ''] || 0) ||
          Math.abs(b.score) - Math.abs(a.score),
      )
      .slice(0, 4)
  }, [rows])
  if (!rows.length)
    return <Empty>Scanner is warming up — it sweeps ten majors every two minutes.</Empty>
  if (!top.length)
    return <Empty>No actionable signal right now. {rows.length} coins all reading flat.</Empty>
  return (
    <ul className="dt-list">
      {top.map((s) => (
        <li key={s.sym}>
          <button type="button" onClick={() => open(s.sym, 'signals')}>
            <CoinBadge sym={s.sym} />
            <span className="dt-sym">{baseOf(s.sym)}</span>
            <span className={'dt-pill ' + (s.master.type === 'BUY' ? 'up' : 'dn')}>
              {s.master.type}
            </span>
            <span className="dt-meta">
              {s.conv ? s.conv.agree + '/' + s.conv.of + ' TF' : ''}
              {s.plan ? ' · ' + s.plan.rr.toFixed(1) + ':1' : ''}
            </span>
            <b className={s.score > 0 ? 'up' : 'dn'}>
              {s.score > 0 ? '+' : ''}
              {s.score}
            </b>
          </button>
        </li>
      ))}
    </ul>
  )
}

function LiquidityTile() {
  const deep = state.deepOb as {
    bids: Array<{ price: number; size: number }>
    asks: Array<{ price: number; size: number }>
  } | null
  const tk = state.tickers[state.symbol] as { qvol?: number } | undefined
  const m = deep && deep.bids.length ? bookMetrics(deep.bids, deep.asks) : null
  if (!m) return <Empty>Waiting for the deep order book…</Empty>
  const sc = liquidityScore(m, tk?.qvol)
  return (
    <>
      <div className="dt-score">
        <b>{sc.value}</b>
        <small>/100</small>
      </div>
      <div className="dt-meter mint">
        <i style={{ width: sc.value + '%' }} />
      </div>
      <dl className="dt-kv">
        <dt>Spread</dt>
        <dd>{m.spreadBps.toFixed(2)} bps</dd>
        <dt>Depth ±1%</dt>
        <dd>${fmtUsd(m.bidDepth1 + m.askDepth1)}</dd>
        <dt>Walls</dt>
        <dd>{m.walls.length || '—'}</dd>
      </dl>
    </>
  )
}

function MoversTile() {
  const tickers = state.tickers as Record<string, { last?: number; pct?: number }>
  // The engine mutates `tickers` in place, so a memo on it would never refresh.
  const rows = Object.keys(tickers)
    .map((sym) => ({ sym, ...tickers[sym] }))
    .filter((r) => typeof r.pct === 'number' && r.last)
    .sort((a, b) => Math.abs(b.pct as number) - Math.abs(a.pct as number))
    .slice(0, 5)
  if (!rows.length) return <Empty>Loading the tracked set…</Empty>
  return (
    <ul className="dt-list dense">
      {rows.map((r) => (
        <li key={r.sym}>
          <button type="button" onClick={() => open(r.sym)}>
            <span className="dt-sym">{baseOf(r.sym)}</span>
            <span className="dt-meta mono">{pfmt(r.last as number)}</span>
            <b className={(r.pct as number) >= 0 ? 'up' : 'dn'}>{pct(r.pct)}</b>
          </button>
        </li>
      ))}
    </ul>
  )
}

function VenuesTile() {
  const live = ((state.crossEx as CrossExRow[] | null) ?? []).filter((r) => r.last != null)
  if (!live.length) return <Empty>Polling public venues…</Empty>
  const px = live.map((r) => r.last as number)
  const lo = Math.min(...px)
  const hi = Math.max(...px)
  const gap = lo > 0 ? ((hi - lo) / lo) * 1e4 : 0
  return (
    <>
      <div className="dt-big">
        <b>{gap.toFixed(2)}</b>
        <small>bps</small>
        <span>spread across {live.length} venues</span>
      </div>
      <dl className="dt-kv">
        <dt>Cheapest</dt>
        <dd>
          {live.find((r) => r.last === lo)?.name} {pfmt(lo)}
        </dd>
        <dt>Dearest</dt>
        <dd>
          {live.find((r) => r.last === hi)?.name} {pfmt(hi)}
        </dd>
      </dl>
    </>
  )
}

function LiquidationsTile({ now }: { now: number }) {
  const liqs =
    (state.liqs as Array<{ side: string; price: number; qty: number; ts: number }> | null) ?? []
  if (!liqs.length) return <Empty>Listening for forced orders…</Empty>
  // Last hour in 12 five-minute buckets. A SELL forceOrder closes a long.
  const B = 12
  const step = 5 * 60_000
  const buckets = Array.from({ length: B }, () => ({ long: 0, short: 0 }))
  let longs = 0
  let shorts = 0
  for (const l of liqs) {
    const age = now - l.ts
    if (age < 0 || age >= B * step) continue
    const usd = l.price * l.qty
    const b = buckets[B - 1 - Math.floor(age / step)]
    if (l.side === 'SELL') {
      b.long += usd
      longs += usd
    } else {
      b.short += usd
      shorts += usd
    }
  }
  return (
    <div className="lq">
      <PairBars buckets={buckets} />
      <dl className="lq-tot">
        <dt className="up">Shorts</dt>
        <dd>{cfmt(shorts)}</dd>
        <dt className="dn">Longs</dt>
        <dd>{cfmt(longs)}</dd>
        <dt className="dim">Window</dt>
        <dd className="dim">1h</dd>
      </dl>
    </div>
  )
}

function SentimentTile() {
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const hist = getFgHistory()
  if (!fg || fg.value == null) return <Empty>Fetching the sentiment index…</Empty>
  const v = Number(fg.value)
  return (
    <div className="st">
      <div className="st-now">
        <div className="dt-score">
          <b>{v}</b>
          <small>/100</small>
        </div>
        <div className="dt-meter fire">
          <i style={{ width: v + '%' }} />
        </div>
        <span className={'st-cls ' + (v >= 55 ? 'up' : v <= 45 ? 'dn' : '')}>
          {fg.value_classification || 'Fear & Greed'}
        </span>
      </div>
      <div className="st-hist">
        <AreaChart values={hist.map((h) => h.v)} color="var(--primary)" height={74} dot />
        <small>Last {hist.length || 30} days</small>
      </div>
    </div>
  )
}

function NewsTile({ now }: { now: number }) {
  const items = latestNews()
  if (!items.length) return <Empty>Loading the wire…</Empty>
  return (
    <ul className="nw">
      {items.slice(0, 4).map((n, i) => (
        <li key={(n.url || '') + i}>
          <a href={n.url} target="_blank" rel="noopener noreferrer">
            <span className="nw-thumb">
              {n.img ? (
                <img
                  src={n.img}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <HomeIcon id="news" />
              )}
            </span>
            <span className="nw-text">
              <b>{n.title}</b>
              <small>
                <i style={{ color: n.color }}>{n.src}</i> · {ago(n.time, now)}
              </small>
            </span>
            <span className={'nw-tag ' + n.sent}>
              {n.sent === 'pos' ? 'Bullish' : n.sent === 'neg' ? 'Bearish' : 'Neutral'}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

const WATCH = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']

function WatchlistTile() {
  return (
    <table className="wl">
      <thead>
        <tr>
          <th>#</th>
          <th>Coin</th>
          <th>Price</th>
          <th>24h</th>
          <th aria-label="Open chart" />
        </tr>
      </thead>
      <tbody>
        {WATCH.filter((k) => COINS[k]).map((k, i) => {
          const sym = COINS[k].sym
          const t = state.tickers[sym] as { last?: number; pct?: number } | undefined
          return (
            <tr key={k}>
              <td className="dim">{i + 1}</td>
              <td>
                <span className="wl-coin">
                  <CoinBadge sym={sym} size={20} />
                  {k}
                </span>
              </td>
              <td className="mono">{t?.last ? '$' + pfmt(t.last) : '—'}</td>
              <td className={'mono ' + ((t?.pct ?? 0) >= 0 ? 'up' : 'dn')}>{pct(t?.pct)}</td>
              <td>
                <button type="button" className="wl-go" onClick={() => open(sym)}>
                  Chart
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function MarketOverviewTile({ now }: { now: number }) {
  const [range, setRange] = useState<Range>('1D')
  useEffect(() => {
    void refreshSeries('BTCUSDT', range)
  }, [range, now])
  const pts = getSeries('BTCUSDT', range)
  const values = pts.map((p) => p[1])
  const g = getGlobal()
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const span = pts.length ? pts[pts.length - 1][0] - pts[0][0] : 0
  const xTicks = pts.length
    ? Array.from({ length: 5 }, (_, i) => {
        const t = new Date(pts[0][0] + (span * i) / 4)
        return range === '1D'
          ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : t.toLocaleDateString([], { month: 'short', day: 'numeric' })
      })
    : undefined
  return (
    <div className="mo">
      <div className="mo-ranges" role="tablist" aria-label="Range">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={r === range}
            className={r === range ? 'on' : ''}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <AreaChart values={values} height={120} yTicks={priceTicks(values)} xTicks={xTicks} dot />
      <div className="mo-stats">
        <div>
          <small>Total Market Cap</small>
          <b>{g ? cfmt(g.totalMcapUsd) : '—'}</b>
          <i className={g && g.mcapChg24h < 0 ? 'dn' : 'up'}>{g ? pct(g.mcapChg24h) : ''}</i>
        </div>
        <div>
          <small>BTC Dominance</small>
          <b>{g ? g.btcDominance.toFixed(1) + '%' : '—'}</b>
        </div>
        <div>
          <small>Fear &amp; Greed</small>
          <b>{fg?.value ?? '—'}</b>
          <i className={Number(fg?.value) >= 50 ? 'up' : 'dn'}>{fg?.value_classification ?? ''}</i>
        </div>
        <div>
          <small>Active Coins</small>
          <b>{g ? g.activeCoins.toLocaleString() : '—'}</b>
        </div>
      </div>
    </div>
  )
}

const LINKS: Array<{ label: string; tab: string; icon: HomeIconId }> = [
  { label: 'Liquidity Heatmap', tab: 'analysis', icon: 'heatmap' },
  { label: 'Order Flow', tab: 'radar', icon: 'flow' },
  { label: 'Whale Tracker', tab: 'radar', icon: 'whale' },
  { label: 'Top Gainers/Losers', tab: 'market', icon: 'movers' },
  { label: 'Bubbles', tab: 'bubbles', icon: 'bubbles' },
  { label: 'Economic Calendar', tab: 'news', icon: 'calendar' },
]

/** The Home header: title, tagline, and a live 7-day BTC ridge behind it. */
export function HomeHero() {
  const [, force] = useState(0)
  useEffect(() => {
    let alive = true
    void refreshSeries('BTCUSDT', '1W').then(() => alive && force((n) => n + 1))
    return () => {
      alive = false
    }
  }, [])
  const ridge = getSeries('BTCUSDT', '1W').map((p) => p[1])
  return (
    <div className="home-hero">
      <span className="home-hero-ico">
        <HomeIcon id="radar" size={30} />
      </span>
      <div className="home-hero-txt">
        <h2>Dashboard</h2>
        <p>Every section at a glance — open one to go deeper</p>
      </div>
      <p className="home-hero-tag">
        “Better Analysis <Arrow /> Better Decisions <Arrow /> Better Trades”
      </p>
      <div className="home-hero-art" aria-hidden="true">
        <AreaChart values={ridge} color="var(--primary)" height={70} className="home-hero-ridge" />
      </div>
    </div>
  )
}

export function HomeDashboard() {
  const now = useTick(2000, ['home'])
  useEffect(() => {
    void refreshGlobal()
    void refreshFgHistory()
  }, [now])

  return (
    <>
      <div className="dash-grid">
        <Tile
          area="price"
          title={baseOf(state.symbol) + ' Price'}
          icon={<CoinBadge sym={state.symbol} size={26} />}
          tab="radar"
          cta="Overview"
        >
          <PriceTile />
        </Tile>
        <Tile area="signals" title="Top Signals" icon="signals" tab="signals" cta="Scanner">
          <SignalsTile />
        </Tile>
        <Tile area="liquidity" title="Liquidity" icon="liquidity" tab="radar" cta="Order book">
          <LiquidityTile />
        </Tile>
        <Tile area="movers" title="Biggest Movers" icon="movers" tab="market" cta="Market">
          <MoversTile />
        </Tile>
        <Tile area="venues" title="Cross-Exchange" icon="venues" tab="radar" cta="Venues">
          <VenuesTile />
        </Tile>
        <Tile area="liqs" title="Liquidations" icon="liqs" tab="analysis" cta="Analysis">
          <LiquidationsTile now={now} />
        </Tile>
        <Tile area="sentiment" title="Sentiment" icon="sentiment" tab="radar" cta="Index">
          <SentimentTile />
        </Tile>
        <Tile area="news" title="Headlines" icon="news" tab="news" cta="News">
          <NewsTile now={now} />
        </Tile>
        <Tile area="watch" title="Quick Watchlist" icon="star" tab="market" cta="All coins">
          <WatchlistTile />
        </Tile>
        <Tile area="overview" title="Market Overview" icon="overview">
          <MarketOverviewTile now={now} />
        </Tile>
      </div>
      <nav className="quick-links" aria-label="Shortcuts">
        {LINKS.map((l) => (
          <button key={l.label} type="button" onClick={() => go(l.tab)}>
            <HomeIcon id={l.icon} size={17} />
            {l.label}
          </button>
        ))}
        <span className="quick-motto">
          <HomeIcon id="overview" size={17} />
          Trade with Data, Not Emotions
        </span>
      </nav>
    </>
  )
}
