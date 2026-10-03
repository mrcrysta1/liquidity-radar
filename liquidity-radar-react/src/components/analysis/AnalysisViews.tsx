// The Analysis tab, laid out after the owner's reference design: a heatmap
// header with timeframe and symbol pickers and an insight card; key liquidity
// zones beside the heatmap; a stats row; volume profile, order flow,
// liquidation levels and Fibonacci pivots; then multi-timeframe reads, the
// takeaways and quick tools.
//
// The zone, level and profile cards read the heatmap's own map (shared via
// liqHeatmap/shared), so they always agree with what the heatmap draws. Order
// flow is the exchange's last 1,000 public trades; the multi-timeframe cards
// fetch their own candles. Everything else is live engine state.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { state } from '../../services/store'
import { COINS, HOT_LIST } from '../../constants/market'
import { instrumentOf, isInstrument } from '../../constants/instruments'
import { baseOf, coinMeta } from '../../utils/coins'
import { cfmt, pfmt } from '../../utils/format'
import { calcMACD, calcRSI, emaArr } from '../../utils/indicators'
import { jget } from '../../api/client'
import { loadCandleWindow } from '../../services/marketData'
import { poll } from '../../services/pollScheduler'
import { getActiveTab, subscribeActiveTab } from '../../features/actions/userActions'
import { fmtUsd, RANGES } from '../../features/analysis/liqHeatmap/engine'
import type { Heatmap } from '../../features/analysis/liqHeatmap/engine'
import {
  getHeat,
  getRange,
  setRange,
  setTools,
  setView,
  useHeatShared,
} from '../../features/analysis/liqHeatmap/shared'
import { confluenceSummary, getConfluenceRows, onConfluenceChange } from '../../features/analysis/confluence'
import { useTick } from '../useTick'
import { CoinBadge } from '../common/CoinBadge'

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }
const ANALYSIS = ['analysis']
const w = window as unknown as {
  switchTab?: (t: string) => void
  setSymbol?: (s: string) => void
  switchSigMode?: (m: string) => void
  analyzeSigCoin?: (s: string) => void
}
const pair = (sym: string) => (instrumentOf(sym) ? sym : baseOf(sym) + '/USDT')
const pct = (v?: number | null, d = 2) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%'
const scrollTo = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
const TF_BTNS: Array<[string, string]> = [
  ['1m', '12h'],
  ['5m', '24h'],
  ['15m', '3d'],
  ['1h', '1w'],
  ['4h', '1m'],
  ['1D', '4mo'],
]
const ticker = () =>
  state.tickers[state.symbol] as
    { last?: number; pct?: number; high?: number; low?: number; qvol?: number } | undefined

function Ico({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const I = {
  radar: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 12l7-7',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  wall: 'M4 20V8l8-4 8 4v12M9 20v-6h6v6',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z',
  high: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  low: 'M3 7l6 6 4-4 8 8M15 17h6v-6',
  liq: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  fund: 'M12 3v18M7 8l5-5 5 5M7 16l5 5 5-5',
  trend: 'M3 17l6-6 4 4 8-8',
  bars: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  flow: 'M3 12h4l3-8 4 16 3-8h4',
  target: 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6M12 10a2 2 0 1 0 2 2',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  brain: 'M9 3a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V4a3 3 0 0 0-3-1zM15 3a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z',
  fib: 'M3 4h18M3 9h18M3 14h18M3 20h18',
  gear: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12',
  arrow: 'M7 17 17 7M8 7h9v9',
}

function Card({ title, icon, right, className, id, children }: {
  title: ReactNode
  icon?: string
  right?: ReactNode
  className?: string
  id?: string
  children: ReactNode
}) {
  return (
    <section className={'card an-card ' + (className || '')} id={id}>
      <header className="an-head">
        {icon && <span className="an-ico"><Ico d={icon} size={17} /></span>}
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}


// ---- zones from the heatmap -----------------------------------------------

type Zone = { price: number; value: number; lo: number; hi: number }
function zones(h: Heatmap | null) {
  if (!h || !h.levels.length || !h.candles.length) return null
  const last = h.candles[h.candles.length - 1].c
  const z = (l: { price: number; value: number }): Zone => ({
    ...l, lo: l.price - h.binSize, hi: l.price + h.binSize,
  })
  const above = h.levels.filter((l) => l.price > last)
  const below = h.levels.filter((l) => l.price <= last)
  const buy = below[0] ? z(below[0]) : null
  const sell = above[0] ? z(above[0]) : null
  const rest = h.levels.filter((l) => l !== below[0] && l !== above[0])
  const wall = rest[0] ? z(rest[0]) : null
  const near = h.levels.slice().sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last))[0]
  return { last, buy, sell, wall, near: near ? z(near) : null }
}
/** Zone edges, whole dollars once prices run to four figures. */
const zp = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-US') : pfmt(v))
const rng = (z: Zone | null) => (z ? '$' + zp(z.lo) + ' – $' + zp(z.hi) : '—')

// ---- header -----------------------------------------------------------------

export function AnalysisHead() {
  useTick(1500, ANALYSIS)
  useHeatShared()
  const [sec, setSec] = useState('liq')
  const sym = state.symbol
  const t = ticker()
  const range = getRange()
  const z = zones(getHeat().heat)
  const list = Array.from(new Set([sym, ...HOT_LIST.map((b) => COINS[b]?.sym ?? b + 'USDT')]))
  const top = z ? [z.buy, z.sell].filter(Boolean).sort((a, b) => (b as Zone).value - (a as Zone).value)[0] : null
  const SECS: Array<[string, string, () => void]> = [
    ['liq', 'Liquidity', () => { setView('liq'); scrollTo('anHeatmap') }],
    ['ob', 'Order Blocks', () => { setView('fvg'); scrollTo('anHeatmap') }],
    ['fund', 'Funding', () => scrollTo('anStats')],
    ['vol', 'Volume', () => scrollTo('anVolume')],
  ]
  return (
    <header className="an-top">
      <div className="an-brand">
        <span className="an-logo"><Ico d={I.radar} size={32} /></span>
        <span>
          <h2>Liquidity Heatmap</h2>
          <p>Order flow, liquidation levels &amp; market structure</p>
          <span className="an-tfs" role="group" aria-label="Heatmap timeframe">
            {TF_BTNS.map(([l, id]) => (
              <button key={id} type="button" className={range === id ? 'on' : ''}
                title={RANGES.find((r) => r.id === id)?.label + ' of ' + l + ' candles'}
                onClick={() => setRange(id)}>{l}</button>
            ))}
          </span>
        </span>
      </div>
      <label className="an-sym">
        <CoinBadge sym={sym} size={32} />
        <span>
          <select value={sym} onChange={(e) => w.setSymbol?.(e.target.value)} aria-label="Symbol">
            {list.map((s) => <option key={s} value={s}>{pair(s)}</option>)}
          </select>
          <small>{isInstrument(sym) ? 'Yahoo' : 'Binance'}</small>
        </span>
      </label>
      <div className="an-price">
        <b>{t?.last ? '$' + pfmt(t.last) : '—'}</b>
        <i className={(t?.pct ?? 0) >= 0 ? 'up' : 'dn'}>{pct(t?.pct)}</i>
      </div>
      <div className="an-secs" role="group" aria-label="Sections">
        {SECS.map(([k, l, fn]) => (
          <button key={k} type="button" className={sec === k ? 'on' : ''} onClick={() => { setSec(k); fn() }}>{l}</button>
        ))}
      </div>
      <aside className="an-insight">
        <span className="an-bot"><Ico d={I.brain} size={22} /></span>
        <span>
          <b>AI Insights</b>
          {top ? (
            <>
              <small>Liquidity cluster found at</small>
              <em>{rng(top)} <i className={top === z?.sell ? 'up' : 'dn'}>({top === z?.sell ? 'magnet above · long bias' : 'magnet below · short bias'})</i></em>
            </>
          ) : <small>Waiting for the heatmap…</small>}
        </span>
      </aside>
    </header>
  )
}

// ---- key liquidity zones ------------------------------------------------------

export function LiqZones() {
  useHeatShared()
  const z = zones(getHeat().heat)
  const rows: Array<[string, string, Zone | null, string, string, string]> = z
    ? [
        ['Strong Buy Liquidity', I.up, z.buy, 'LONG', 'g', 'Largest long-liquidation cluster below price'],
        ['Strong Sell Liquidity', I.down, z.sell, 'SHORT', 'r', 'Largest short-liquidation cluster above price'],
        ['Liquidity Wall', I.wall, z.wall, 'WATCH', 'a', 'Next-largest cluster on either side'],
        ['High Leverage Zone', I.bolt, z.near, 'VOLATILE', 'p', 'Cluster nearest price, where high-leverage positions sit'],
      ]
    : []
  return (
    <Card title="Key Liquidity Zones" icon={I.target} className="an-zones">
      {z ? (
        <ul className="an-zlist">
          {rows.map(([l, ic, zz, tag, c, tip]) => (
            <li key={l} className={c} title={tip}>
              <span className="an-zi"><Ico d={ic} size={15} /></span>
              <span className="an-zt"><b>{l}</b><small>{rng(zz)}</small>{zz && <em>${fmtUsd(zz.value)} est.</em>}</span>
              <span className="an-tag">{tag}</span>
            </li>
          ))}
        </ul>
      ) : <p className="an-empty">Building the heatmap…</p>}
    </Card>
  )
}

// ---- stats row ------------------------------------------------------------------

function Gauge({ v }: { v: number | null }) {
  const r = 30
  const arc = Math.PI * r
  const col = v == null ? 'var(--dim)' : v >= 55 ? 'var(--green)' : v <= 45 ? 'var(--red)' : 'var(--amber)'
  return (
    <svg width="78" height="46" viewBox="0 0 78 46" aria-hidden="true">
      <path d="M9 40a30 30 0 0 1 60 0" fill="none" stroke="var(--hair-2)" strokeWidth="7" strokeLinecap="round" />
      <path d="M9 40a30 30 0 0 1 60 0" fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${arc * ((v ?? 0) / 100)} ${arc}`} />
      <text x="39" y="40" textAnchor="middle" className="an-gv" fill={col}>{v == null ? '—' : Math.round(v) + '%'}</text>
    </svg>
  )
}

function trendOf(cs: Candle[]) {
  if (cs.length < 40) return null
  const a = cs.slice(-20)
  const b = cs.slice(-40, -20)
  const hh = Math.max(...a.map((c) => c.h)) > Math.max(...b.map((c) => c.h))
  const hl = Math.min(...a.map((c) => c.l)) > Math.min(...b.map((c) => c.l))
  if (hh && hl) return { k: 'UPTREND', s: 'Higher highs & higher lows', up: true }
  if (!hh && !hl) return { k: 'DOWNTREND', s: 'Lower highs & lower lows', up: false }
  return { k: 'RANGE', s: hh ? 'Higher high, lower low' : 'Lower high, higher low', up: null }
}

export function AnalysisStats() {
  const now = useTick(1000, ANALYSIS)
  const sym = state.symbol
  const t = ticker()
  const fr = state.fr as { lastFundingRate?: string | number; nextFundingTime?: number } | null
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) : null
  const left = fr?.nextFundingTime ? Math.max(0, fr.nextFundingTime - now) : null
  const mine = state.liqs.filter((l) => l.symbol === sym)
  const src = mine.length ? mine : state.liqs
  const liqUsd = src.reduce((a, l) => a + l.price * l.qty, 0)
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const fgv = fg?.value != null ? Number(fg.value) : null
  const tr = trendOf(state.candles as Candle[])
  const hms = (ms: number) => {
    const h = Math.floor(ms / 3.6e6)
    const m = Math.floor((ms % 3.6e6) / 6e4)
    return h ? `${h}h ${m}m` : `${m}m`
  }
  return (
    <div className="an-stats" id="anStats">
      <div className="card an-stat an-cur">
        <CoinBadge sym={sym} size={36} />
        <span><small>Current Price</small><b>{t?.last ? '$' + pfmt(t.last) : '—'}</b><i className={(t?.pct ?? 0) >= 0 ? 'up' : 'dn'}>{pct(t?.pct)}</i></span>
      </div>
      <div className="card an-stat"><span className="an-si g"><Ico d={I.high} /></span><span><small>24h High</small><b>{t?.high ? '$' + pfmt(t.high) : '—'}</b></span></div>
      <div className="card an-stat"><span className="an-si r"><Ico d={I.low} /></span><span><small>24h Low</small><b>{t?.low ? '$' + pfmt(t.low) : '—'}</b></span></div>
      <div className="card an-stat" title={mine.length ? 'Forced orders on this market since the page opened' : 'Forced orders across all futures markets since the page opened'}>
        <span className="an-si p"><Ico d={I.liq} /></span>
        <span><small>Liquidations</small><b>{src.length ? '$' + cfmt(liqUsd).replace(/^\$/, '') : '—'}</b><em>{src.length} {mine.length ? 'on ' + baseOf(sym) : 'all pairs'} · session</em></span>
      </div>
      <div className="card an-stat">
        <span className="an-si c"><Ico d={I.fund} /></span>
        <span><small>Funding Rate</small><b className={rate == null ? '' : rate >= 0 ? 'up' : 'dn'}>{rate == null ? '—' : (rate * 100).toFixed(4) + '%'}</b><em>{left != null ? 'next in ' + hms(left) : isInstrument(sym) ? 'no perpetual' : 'loading'}</em></span>
      </div>
      <div className="card an-stat an-sent">
        <span><small>Market Sentiment</small><em>{fg?.value_classification ?? 'Fear & Greed'}</em></span>
        <Gauge v={fgv} />
      </div>
      <div className="card an-stat">
        <span className={'an-si ' + (tr?.up ? 'g' : tr?.up === false ? 'r' : 'a')}><Ico d={tr?.up === false ? I.low : I.trend} /></span>
        <span><small>Trend</small><b className={tr?.up ? 'up' : tr?.up === false ? 'dn' : ''}>{tr?.k ?? '—'}</b><em>{tr?.s ?? 'needs 40 bars'}</em></span>
      </div>
    </div>
  )
}

// ---- volume profile -------------------------------------------------------------

export function VolumeProfile() {
  useHeatShared()
  const h = getHeat().heat
  const ROWS = 16
  let rows: Array<{ lo: number; hi: number; v: number }> = []
  let poc = -1
  if (h && h.candles.length) {
    const lo = Math.min(...h.candles.map((c) => c.l))
    const hi = Math.max(...h.candles.map((c) => c.h))
    const step = (hi - lo) / ROWS || 1
    rows = Array.from({ length: ROWS }, (_, i) => ({ lo: lo + i * step, hi: lo + (i + 1) * step, v: 0 }))
    h.candles.forEach((c) => {
      const a = Math.max(0, Math.floor((c.l - lo) / step))
      const b = Math.min(ROWS - 1, Math.floor((c.h - lo) / step))
      const share = c.v / (b - a + 1)
      for (let i = a; i <= b; i++) rows[i].v += share
    })
    rows.reverse()
    const max = Math.max(...rows.map((r) => r.v))
    poc = rows.findIndex((r) => r.v === max)
  }
  const max = rows.length ? rows[poc].v || 1 : 1
  return (
    <Card title="Volume Profile" icon={I.bars} id="anVolume" className="an-vp"
      right={<span className="an-live">{h ? h.candles.length + ' bars' : '—'}</span>}>
      <small className="an-sub">Volume distribution &amp; point of control</small>
      {rows.length ? (
        <ul className="an-vpl">
          {rows.map((r, i) => {
            const f = r.v / max
            const hue = 130 - (i / (ROWS - 1)) * 130
            return (
              <li key={i} className={i === poc ? 'poc' : ''}>
                <span>{zp((r.lo + r.hi) / 2)}</span>
                <i><b style={{ width: Math.max(2, f * 100) + '%', background: `hsl(${hue} 85% 52%)` }} /></i>
                {i === poc && <em>POC</em>}
              </li>
            )
          })}
        </ul>
      ) : <p className="an-empty">Loading candles…</p>}
    </Card>
  )
}

// ---- order flow -------------------------------------------------------------------

type Flow = { buyUsd: number; sellUsd: number; lb: number; ls: number; rb: number; rs: number; mins: number; n: number }
const LARGE = 25000

export function OrderFlow({ tab = 'analysis', id = 'anFlow' }: { tab?: string; id?: string }) {
  useTick(5000, [tab])
  const sym = state.symbol
  const [flow, setFlow] = useState<{ sym: string; f: Flow } | null>(null)
  useEffect(() => {
    if (isInstrument(sym)) return
    let alive = true
    const load = () => {
      if (getActiveTab() !== tab) return
      jget('https://api.binance.com/api/v3/trades?symbol=' + sym + '&limit=1000')
        .then((d) => {
          if (!alive || !Array.isArray(d) || !d.length) return
          const f: Flow = { buyUsd: 0, sellUsd: 0, lb: 0, ls: 0, rb: 0, rs: 0, mins: 0, n: d.length }
          ;(d as Array<{ price: string; qty: string; isBuyerMaker: boolean; time: number }>).forEach((t) => {
            const usd = +t.price * +t.qty
            const buy = !t.isBuyerMaker
            if (buy) f.buyUsd += usd
            else f.sellUsd += usd
            if (usd >= LARGE) {
              if (buy) f.lb++
              else f.ls++
            } else if (buy) f.rb++
            else f.rs++
          })
          f.mins = (d[d.length - 1].time - d[0].time) / 6e4
          setFlow({ sym, f })
        })
        .catch(() => {})
    }
    load()
    const stop = poll(load, 15000)
    const off = subscribeActiveTab((t) => {
      if (t === tab) load()
    })
    return () => {
      alive = false
      stop()
      off()
    }
  }, [sym, tab])
  const f = flow?.sym === sym ? flow.f : null
  const tot = f ? f.buyUsd + f.sellUsd : 0
  const bp = f && tot ? (f.buyUsd / tot) * 100 : 50
  const r = 46
  const c = 2 * Math.PI * r
  const net = f ? f.buyUsd - f.sellUsd : 0
  return (
    <Card title="Order Flow" icon={I.flow} id={id} className="an-of" right={<span className="an-live on">Live</span>}>
      <small className="an-sub">Buy vs sell volume · last {f ? f.n.toLocaleString() + ' trades' + (f.mins ? ` (${f.mins < 1 ? '<1' : Math.round(f.mins)} min)` : '') : '1,000 trades'}</small>
      {isInstrument(sym) ? <p className="an-empty">No public trade tape for {sym}.</p> : !f ? <p className="an-empty">Loading trades…</p> : (
        <div className="an-ofb">
          <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
            <circle cx="64" cy="64" r={r} fill="none" stroke="var(--red)" strokeWidth="12" />
            <circle cx="64" cy="64" r={r} fill="none" stroke="var(--green)" strokeWidth="12"
              strokeDasharray={`${(c * bp) / 100} ${c}`} transform="rotate(-90 64 64)" />
            <text x="64" y="58" textAnchor="middle" className="an-ofv up">{bp.toFixed(0)}%</text>
            <text x="64" y="72" textAnchor="middle" className="an-ofl">Buy</text>
            <text x="64" y="90" textAnchor="middle" className="an-ofv2 dn">{(100 - bp).toFixed(0)}% Sell</text>
          </svg>
          <div className="an-ofs">
            <small>Net Inflow</small>
            <b className={net >= 0 ? 'up' : 'dn'}>{net >= 0 ? '+' : '−'}${fmtUsd(Math.abs(net))}</b>
            <dl>
              <div><dt className="up">Large buys</dt><dd>{f.lb}</dd></div>
              <div><dt className="dn">Large sells</dt><dd>{f.ls}</dd></div>
              <div><dt>Retail buys</dt><dd>{f.rb}</dd></div>
              <div><dt>Retail sells</dt><dd>{f.rs}</dd></div>
            </dl>
            <em>Large prints ≥ $25K</em>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---- liquidation levels -------------------------------------------------------------

export function LiqLevels() {
  useHeatShared()
  const h = getHeat().heat
  const z = zones(h)
  const ROWS = 22
  let rows: Array<{ p: number; v: number; up: boolean }> = []
  if (h && z) {
    const col = h.cols - 1
    const per = Math.ceil(h.bins / ROWS)
    for (let r = 0; r < ROWS; r++) {
      let v = 0
      for (let k = r * per; k < Math.min(h.bins, (r + 1) * per); k++) v += h.grid[col * h.bins + k]
      const p = h.priceMin + (r + 0.5) * per * h.binSize
      rows.push({ p, v, up: p > z.last })
    }
    rows = rows.reverse()
  }
  const max = Math.max(1, ...rows.map((r) => r.v))
  const lastRow = z ? rows.findIndex((r) => !r.up) : -1
  return (
    <Card title="Liquidation Levels" icon={I.layers} className="an-ll">
      {z ? (
        <>
          <div className="an-llh">
            <span className="g"><small>Long Liquidations</small>{rng(z.buy)}</span>
            <span className="r"><small>Short Liquidations</small>{rng(z.sell)}</span>
          </div>
          <ul className="an-lll">
            {rows.map((r, i) => (
              <li key={i} className={i === lastRow ? 'px' : ''}>
                <i className="l">{!r.up && <b style={{ width: (r.v / max) * 100 + '%' }} />}</i>
                <i className="s">{r.up && <b style={{ width: (r.v / max) * 100 + '%' }} />}</i>
                <span>{i === lastRow ? zp(z.last) : i % 3 === 0 && Math.abs(i - lastRow) > 1 ? zp(r.p) : ''}</span>
              </li>
            ))}
          </ul>
        </>
      ) : <p className="an-empty">Building the heatmap…</p>}
    </Card>
  )
}

// ---- fibonacci pivots ----------------------------------------------------------------

export function TopZones() {
  useTick(3000, ANALYSIS)
  const t = ticker()
  const ok = t?.last && t.high && t.low
  const rows: Array<[string, number, string]> = []
  if (ok) {
    const H = t.high as number
    const L = t.low as number
    const P = (H + L + (t.last as number)) / 3
    const R = H - L
    rows.push(['R3', P + R, '1.000'], ['R2', P + 0.618 * R, '0.618'], ['R1', P + 0.382 * R, '0.382'],
      ['P', P, 'pivot'], ['S1', P - 0.382 * R, '0.382'], ['S2', P - 0.618 * R, '0.618'], ['S3', P - R, '1.000'])
  }
  const last = t?.last ?? 0
  const near = rows.length ? rows.slice().sort((a, b) => Math.abs(a[1] - last) - Math.abs(b[1] - last))[0][0] : ''
  return (
    <Card title={<>Top Zones <span className="an-fibt">(Fibonacci)</span></>} icon={I.fib} id="anFib" className="an-fib">
      {rows.length ? (
        <ul className="an-fibl">
          {rows.map(([k, v, r]) => (
            <li key={k} className={(k[0] === 'R' ? 'r' : k[0] === 'S' ? 'g' : 'p') + (k === near ? ' near' : '')}>
              <b>{k}</b>
              <span>{pfmt(v)}</span>
              <em>{r}</em>
            </li>
          ))}
        </ul>
      ) : <p className="an-empty">Needs the 24h range…</p>}
      <p className="an-note">Fibonacci pivots from the 24h high, low and last price</p>
    </Card>
  )
}

// ---- multi-timeframe -------------------------------------------------------------------

const MTF: Array<[string, string]> = [
  ['1m', 'Short term'],
  ['5m', 'Momentum'],
  ['15m', 'Intraday'],
  ['1h', 'Structure'],
  ['4h', 'Big picture'],
]
type TfRead = { tf: string; rsi: number; verdict: 'Bullish' | 'Bearish' | 'Neutral'; closes: number[] }

export function MultiTf() {
  useTick(10000, ANALYSIS)
  const sym = state.symbol
  const [data, setData] = useState<{ sym: string; rows: TfRead[] } | null>(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (getActiveTab() !== 'analysis') return
      Promise.all(MTF.map(([tf]) =>
        loadCandleWindow(sym, tf, 80)
          .then((cs) => {
            const closes = cs.map((c) => c.c)
            if (closes.length < 30) return null
            const rsi = calcRSI(closes)
            const m = calcMACD(closes)
            const e = emaArr(closes, 20)
            const last = closes[closes.length - 1]
            const votes = (rsi > 50 ? 1 : -1) + ((m?.hist ?? 0) > 0 ? 1 : -1) + (last > e[e.length - 1] ? 1 : -1)
            const verdict: TfRead['verdict'] = votes >= 2 ? 'Bullish' : votes <= -2 ? 'Bearish' : 'Neutral'
            return { tf, rsi, verdict, closes: closes.slice(-40) }
          })
          .catch(() => null),
      )).then((rows) => {
        if (alive) setData({ sym, rows: rows.filter(Boolean) as TfRead[] })
      })
    }
    load()
    const stop = poll(load, 60000)
    const off = subscribeActiveTab((t) => {
      if (t === 'analysis') load()
    })
    return () => {
      alive = false
      stop()
      off()
    }
  }, [sym])
  const rows = data?.sym === sym ? data.rows : []
  return (
    <Card title="Multi-Timeframe Analysis" icon={I.layers} className="an-mtf">
      <div className="an-mtfg">
        {MTF.map(([tf, l]) => {
          const r = rows.find((x) => x.tf === tf)
          const cls = r?.verdict === 'Bullish' ? 'g' : r?.verdict === 'Bearish' ? 'r' : 'a'
          let pts = ''
          if (r) {
            const lo = Math.min(...r.closes)
            const hi = Math.max(...r.closes)
            pts = r.closes.map((c, i) => `${(i / (r.closes.length - 1)) * 90},${26 - ((c - lo) / (hi - lo || 1)) * 24}`).join(' ')
          }
          return (
            <div key={tf} className={'an-tfc ' + cls}>
              <div className="an-tfh"><b>{tf}</b><span className="an-tag">{r?.verdict ?? '…'}</span></div>
              <small>{l}</small>
              <div className="an-tff">
                <span>RSI {r ? r.rsi.toFixed(1) : '—'}</span>
                <svg viewBox="0 0 90 28" preserveAspectRatio="none" aria-hidden="true"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ---- ai analysis ---------------------------------------------------------------------------

function useBump(sub: (fn: () => void) => () => void) {
  const [, f] = useState(0)
  useEffect(() => sub(() => f((n) => n + 1)), [sub])
}

export function AiAnalysis() {
  useTick(5000, ANALYSIS)
  useHeatShared()
  useBump(onConfluenceChange)
  const sym = state.symbol
  const z = zones(getHeat().heat)
  const loaded = getConfluenceRows().filter((r) => !r.loading)
  const bias = confluenceSummary()
  const pts: string[] = []
  if (z?.buy) {
    const d = ((z.last - z.buy.price) / z.last) * 100
    pts.push(`Price is ${d.toFixed(2)}% above the strongest demand cluster (${rng(z.buy)})`)
  }
  if (z?.sell) pts.push(`Liquidity above at ${rng(z.sell)}: a possible sweep target`)
  if (loaded.length) {
    const agree = loaded.filter((r) => r.verdict === bias).length
    pts.push(bias === 'neutral'
      ? `Timeframes are split (${loaded.map((r) => r.tf).join(', ')}); no clear trend`
      : `Trend reads ${bias === 'bull' ? 'bullish' : 'bearish'} on ${agree} of ${loaded.length} timeframes (${loaded.map((r) => r.tf).join(', ')})`)
  }
  if (z?.buy) pts.push(`Watch for a reversal if ${pfmt(z.buy.lo)} breaks`)
  return (
    <Card title="AI Analysis" icon={I.brain} className="an-ai">
      <small className="an-sub g">Key takeaways · {pair(sym)}</small>
      {pts.length ? <ul className="an-ail">{pts.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="an-empty">Gathering data…</p>}
      <button type="button" className="an-idea" onClick={() => { w.switchTab?.('signals'); w.switchSigMode?.('search'); w.analyzeSigCoin?.(instrumentOf(sym) ? sym : baseOf(sym)) }}>
        Trade Idea <Ico d={I.arrow} size={14} />
      </button>
    </Card>
  )
}

// ---- quick tools -----------------------------------------------------------------------------

export function AnQuickTools() {
  const tools: Array<[string, string, () => void]> = [
    ['Draw Zones', I.pen, () => w.switchTab?.('radar')],
    ['Fibonacci', I.fib, () => scrollTo('anFib')],
    ['Order Flow', I.flow, () => scrollTo('anFlow')],
    ['Heatmap Settings', I.gear, () => { setTools(true); scrollTo('anHeatmap') }],
  ]
  return (
    <Card title="Quick Tools" className="an-qt">
      <div className="an-qtg">
        {tools.map(([l, ic, fn]) => (
          <button key={l} type="button" onClick={fn}><span className="an-zi"><Ico d={ic} size={16} /></span>{l}</button>
        ))}
      </div>
    </Card>
  )
}
