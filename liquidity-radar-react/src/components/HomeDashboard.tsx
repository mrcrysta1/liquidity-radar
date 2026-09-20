// The landing page: one card per area of the app, each showing the headline
// figure and nothing more, with a way through to the full section.
//
// Every widget reads the same live state the full sections do, so nothing here
// fetches on its own — the dashboard costs no extra requests. The engine
// mutates that state imperatively, so one shared tick re-reads it.
import { useEffect, useMemo, useState } from 'react'
import { state } from '../services/store'
import { signalData } from '../features/signals'
import { bookMetrics, fmtUsd, liquidityScore } from '../features/charts/sidePanels/metrics'
import type { CrossExRow } from '../features/advanced/advancedData'
import { latestNews } from '../features/news/newsFeed'
import { baseOf, coinMeta } from '../utils/coins'
import { cfmt, pfmt } from '../utils/format'

const w = window as unknown as { switchTab?: (t: string) => void; setSymbol?: (s: string) => void }
const go = (tab: string) => w.switchTab?.(tab)

/** One dashboard tile: a title, a link through, and whatever it has to show. */
function Tile({
  title,
  tab,
  cta,
  accent,
  wide,
  children,
}: {
  title: string
  tab: string
  cta: string
  accent?: string
  /** Twice the width where there is room — for the text-heavy tiles. */
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={'card hw' + (wide ? ' hw-wide' : '')} style={accent ? ({ ['--hw-accent' as string]: accent } as React.CSSProperties) : undefined}>
      <div className="hw-head">
        <span className="hw-title">{title}</span>
        <button type="button" className="hw-cta" onClick={() => go(tab)}>
          {cta}
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
        </button>
      </div>
      <div className="hw-body">{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="hw-empty">{children}</div>
}

/** Price, change and the day's range for whatever symbol is in focus. */
function PriceTile() {
  const t = state.tickers[state.symbol] as
    | { last?: number; pct?: number; high?: number; low?: number; qvol?: number }
    | undefined
  const meta = coinMeta(state.symbol)
  if (!t || !t.last) return <Empty>Waiting for the first tick…</Empty>
  const up = (t.pct ?? 0) >= 0
  const span = (t.high ?? 0) - (t.low ?? 0)
  const at = span > 0 ? (((t.last as number) - (t.low as number)) / span) * 100 : 50
  return (
    <>
      <div className="hw-price">
        <span className="hw-coin">
          <i style={{ borderColor: meta.color + '66' }}>{meta.icon}</i>
          {baseOf(state.symbol)}
        </span>
        <b>{pfmt(t.last)}</b>
        <span className={'hw-chg ' + (up ? 'up' : 'dn')}>
          {up ? '+' : ''}
          {(t.pct ?? 0).toFixed(2)}%
        </span>
      </div>
      <div className="hw-range" title="Where price sits in the 24h range">
        <i style={{ left: Math.max(0, Math.min(100, at)) + '%' }} />
      </div>
      <dl className="hw-kv">
        <dt>24h low</dt>
        <dd>{t.low ? pfmt(t.low) : '—'}</dd>
        <dt>24h high</dt>
        <dd>{t.high ? pfmt(t.high) : '—'}</dd>
        <dt>Volume</dt>
        <dd>{t.qvol ? cfmt(t.qvol) : '—'}</dd>
      </dl>
    </>
  )
}

/** The scanner's strongest reads, by conviction. */
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
      .sort((a, b) => {
        const t = (rank[b.conv?.tier ?? ''] || 0) - (rank[a.conv?.tier ?? ''] || 0)
        return t !== 0 ? t : Math.abs(b.score) - Math.abs(a.score)
      })
      .slice(0, 4)
  }, [rows])
  if (!rows.length) return <Empty>Scanner is warming up — it sweeps ten majors every two minutes.</Empty>
  if (!top.length) return <Empty>No actionable signal right now. {rows.length} coins all reading flat.</Empty>
  return (
    <ul className="hw-list">
      {top.map((s) => (
        <li key={s.sym}>
          <button type="button" onClick={() => { w.setSymbol?.(s.sym); go('signals') }}>
            <span className="hw-sym">{baseOf(s.sym)}</span>
            <span className={'hw-tag ' + (s.master.type === 'BUY' ? 'up' : 'dn')}>{s.master.type}</span>
            <span className="hw-meta">
              {s.conv ? s.conv.agree + '/' + s.conv.of + ' TF' : ''}
              {s.plan ? ' · ' + s.plan.rr.toFixed(1) + ':1' : ''}
            </span>
            <b className={s.score > 0 ? 'up' : 'dn'}>{s.score > 0 ? '+' : ''}{s.score}</b>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Book quality for the focused symbol, from the deep REST book. */
function LiquidityTile() {
  const deep = state.deepOb as { bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }> } | null
  const tk = state.tickers[state.symbol] as { qvol?: number } | undefined
  const v = useMemo(() => {
    const m = deep && deep.bids.length ? bookMetrics(deep.bids, deep.asks) : null
    return m ? { m, sc: liquidityScore(m, tk?.qvol) } : null
  }, [deep, tk?.qvol])
  if (!v) return <Empty>Waiting for the deep order book…</Empty>
  const tone = v.sc.value >= 70 ? 'good' : v.sc.value >= 45 ? 'mid' : 'poor'
  return (
    <>
      <div className={'hw-score ' + tone}>
        <b>{v.sc.value}</b>
        <small>/ 100</small>
        <i style={{ width: v.sc.value + '%' }} />
      </div>
      <dl className="hw-kv">
        <dt>Spread</dt>
        <dd>{v.m.spreadBps.toFixed(2)} bps</dd>
        <dt>Depth ±1%</dt>
        <dd>${fmtUsd(v.m.bidDepth1 + v.m.askDepth1)}</dd>
        <dt>Walls</dt>
        <dd>{v.m.walls.length || '—'}</dd>
      </dl>
    </>
  )
}

/** How far apart the venues are quoting. */
function VenuesTile() {
  const rows = (state.crossEx as CrossExRow[] | null) ?? []
  const live = rows.filter((r) => r.last != null)
  if (!live.length) return <Empty>Polling public venues…</Empty>
  const px = live.map((r) => r.last as number)
  const lo = Math.min(...px)
  const hi = Math.max(...px)
  const gap = lo > 0 ? ((hi - lo) / lo) * 1e4 : 0
  const cheapest = live.find((r) => r.last === lo)
  const dearest = live.find((r) => r.last === hi)
  return (
    <>
      <div className="hw-big">
        <b>{gap.toFixed(2)}</b>
        <small>bps spread across {live.length} venues</small>
      </div>
      <dl className="hw-kv">
        <dt>Cheapest</dt>
        <dd>{cheapest ? cheapest.name + ' ' + pfmt(lo) : '—'}</dd>
        <dt>Dearest</dt>
        <dd>{dearest ? dearest.name + ' ' + pfmt(hi) : '—'}</dd>
      </dl>
    </>
  )
}

/** Forced liquidations in the last five minutes, both sides. */
function LiquidationsTile({ now }: { now: number }) {
  const liqs = (state.liqs as Array<{ side: string; price: number; qty: number; ts: number; symbol: string }> | null) ?? []
  const recent = liqs.filter((l) => now - l.ts < 5 * 60_000)
  if (!liqs.length) return <Empty>Listening for forced orders…</Empty>
  const longs = recent.filter((l) => l.side === 'SELL').reduce((s, l) => s + l.price * l.qty, 0)
  const shorts = recent.filter((l) => l.side === 'BUY').reduce((s, l) => s + l.price * l.qty, 0)
  const tot = longs + shorts
  return (
    <>
      <div className="hw-split">
        <span className="dn">
          <small>Longs out</small>
          <b>{cfmt(longs)}</b>
        </span>
        <span className="up">
          <small>Shorts out</small>
          <b>{cfmt(shorts)}</b>
        </span>
      </div>
      <div className="hw-bar" title="Share of the last five minutes">
        <i className="dn" style={{ width: (tot ? (longs / tot) * 100 : 50) + '%' }} />
      </div>
      <div className="hw-note">{recent.length} forced orders in the last 5 minutes</div>
    </>
  )
}

/** Biggest movers among the tracked set. */
function MoversTile() {
  const tickers = state.tickers as Record<string, { last?: number; pct?: number }>
  // Not memoised on `tickers`: the engine mutates that object in place, so its
  // identity never changes and a memo would compute once — while it was still
  // empty — and never look again. The list is a handful of rows; just build it.
  const rows = Object.keys(tickers)
    .map((sym) => ({ sym, ...tickers[sym] }))
    .filter((r) => typeof r.pct === 'number' && r.last)
    .sort((a, b) => Math.abs(b.pct as number) - Math.abs(a.pct as number))
    .slice(0, 5)
  if (!rows.length) return <Empty>Loading the tracked set…</Empty>
  return (
    <ul className="hw-list">
      {rows.map((r) => {
        const up = (r.pct as number) >= 0
        return (
          <li key={r.sym}>
            <button type="button" onClick={() => { w.setSymbol?.(r.sym); go('radar') }}>
              <span className="hw-sym">{baseOf(r.sym)}</span>
              <span className="hw-meta">{pfmt(r.last as number)}</span>
              <b className={up ? 'up' : 'dn'}>
                {up ? '+' : ''}
                {(r.pct as number).toFixed(2)}%
              </b>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Market mood, straight from the gauge the Radar tab draws. */
function SentimentTile() {
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  if (!fg || fg.value == null) return <Empty>Fetching the sentiment index…</Empty>
  const v = Number(fg.value)
  const tone = v >= 75 ? 'good' : v >= 55 ? 'mid' : v >= 45 ? '' : v >= 25 ? 'mid' : 'poor'
  return (
    <>
      <div className={'hw-score ' + tone}>
        <b>{v}</b>
        <small>/ 100</small>
        <i style={{ width: v + '%' }} />
      </div>
      <div className="hw-note">{fg.value_classification || 'Fear & Greed index'}</div>
    </>
  )
}

/** Latest headlines, as links into the news tab. */
function NewsTile() {
  const items = latestNews()
  if (!items.length) return <Empty>Loading the wire…</Empty>
  return (
    <ul className="hw-news">
      {items.slice(0, 4).map((n, i) => (
        <li key={(n.url || '') + i}>
          <button type="button" onClick={() => go('news')}>
            <span>{n.title}</span>
            <small>{n.src}</small>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function HomeDashboard() {
  // One tick re-reads the state the engine mutates, and doubles as the clock
  // the liquidation window is measured against.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="home-grid">
      <Tile title="Price" tab="radar" cta="Radar" accent="var(--primary)">
        <PriceTile />
      </Tile>
      <Tile title="Top signals" tab="signals" cta="Scanner" accent="var(--green)">
        <SignalsTile />
      </Tile>
      <Tile title="Liquidity" tab="radar" cta="Order book" accent="var(--cyan)">
        <LiquidityTile />
      </Tile>
      <Tile title="Biggest movers" tab="market" cta="Market" accent="var(--amber)">
        <MoversTile />
      </Tile>
      <Tile title="Cross-exchange" tab="radar" cta="Venues" accent="var(--purple)">
        <VenuesTile />
      </Tile>
      <Tile title="Liquidations" tab="analysis" cta="Analysis" accent="var(--red)">
        <LiquidationsTile now={now} />
      </Tile>
      <Tile title="Sentiment" tab="radar" cta="Index" accent="var(--pink)">
        <SentimentTile />
      </Tile>
      <Tile title="Headlines" tab="news" cta="News" accent="var(--cyan)" wide>
        <NewsTile />
      </Tile>
    </div>
  )
}
