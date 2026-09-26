// The Radar tab, laid out after the owner's reference design: a hero with
// the focused coin, a strip of derivatives metrics, the chart flanked by key
// levels and quick stats, then market overview, fear & greed, paper-trade
// summary, the direction model, multi-timeframe analysis, strategy links, a
// direction strip and a market watch table.
//
// Every figure is read from live state the engine already keeps (tickers,
// candles, funding, open interest, long/short, fear & greed, the ML model,
// multi-timeframe confluence and the paper-trade ledger). Nothing here is
// estimated for show: where the app has no data for a reference element, the
// element says what it does have instead.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { state } from '../../services/store'
import { COINS } from '../../constants/market'
import { baseOf, coinMeta, venueOf } from '../../utils/coins'
import { cfmt, pfmt } from '../../utils/format'
import { calcATR, calcBB, calcMACD, calcRSI, emaArr } from '../../utils/indicators'
import { useTick } from '../useTick'
import { AreaChart } from '../home/charts'
import { HomeIcon } from '../home/icons'
import type { HomeIconId } from '../home/icons'
import { getSeries, refreshSeries } from '../../features/home/homeData'
import {
  getConfluenceRows,
  confluenceSummary,
  onConfluenceChange,
} from '../../features/analysis/confluence'
import { getMLState, onMLChange, trainForSymbol } from '../../features/ml/store'
import { getOverallStats, onPaperTradingChange } from '../../features/ml/paperTrading'
import {
  getShowConfluence,
  getShowMLPrediction,
  onOverlayTogglesChange,
} from '../../features/charts/overlayToggles'

const w = window as unknown as { switchTab?: (t: string) => void; setSymbol?: (s: string) => void }
const go = (tab: string) => w.switchTab?.(tab)
const open = (sym: string) => w.setSymbol?.(sym)
const pct = (v: number | undefined | null, d = 2) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%'
const WATCH = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']
/** Compact number for indicator readouts: 2 decimals, or 3 significant figures when tiny. */
const short = (v: number) =>
  Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(3)
const RADAR = ['radar']

function useBump(sub: (fn: () => void) => () => void) {
  const [, f] = useState(0)
  useEffect(() => sub(() => f((n) => n + 1)), [sub])
}

function CoinBadge({ sym, size = 22 }: { sym: string; size?: number }) {
  const meta = coinMeta(sym)
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[baseOf(sym)]
    ?.image
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

function Card({
  title,
  icon,
  right,
  className,
  children,
}: {
  title: string
  icon?: HomeIconId
  right?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={'card rd ' + (className || '')} aria-label={title}>
      <header className="rd-head">
        {icon && <HomeIcon id={icon} size={18} />}
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }
const candles = () => state.candles as Candle[]

/** Classic floor pivots from the 24h high / low / last. */
function pivots() {
  const t = state.tickers[state.symbol] as
    { last?: number; high?: number; low?: number } | undefined
  if (!t?.last || !t.high || !t.low) return null
  const { high: H, low: L, last: C } = t as { high: number; low: number; last: number }
  const P = (H + L + C) / 3
  return {
    P,
    R: [2 * P - L, P + (H - L), H + 2 * (P - L)],
    S: [2 * P - H, P - (H - L), L - 2 * (H - P)],
  }
}

// ---- hero ------------------------------------------------------------------

export function RadarHero() {
  useTick(1000, RADAR)
  useBump(onConfluenceChange)
  const sym = state.symbol
  const meta = coinMeta(sym)
  const t = state.tickers[sym] as
    { last?: number; pct?: number; high?: number; low?: number; qvol?: number } | undefined
  const last = t?.last
  const abs = last && t?.pct != null ? last - last / (1 + t.pct / 100) : null
  const trend = confluenceSummary()
  const up = (t?.pct ?? 0) >= 0
  return (
    <section className="card rd-hero" aria-label="Focused market">
      <div className="rd-hero-id">
        <CoinBadge sym={sym} size={54} />
        <div>
          <h2>{meta.name}</h2>
          <small>
            {sym} ·{' '}
            {venueOf(sym)
              .replace(/\bSPOT\b/, 'Spot')
              .replace('BINANCE', 'Binance')}
          </small>
        </div>
      </div>
      <div className="rd-hero-price">
        <b>{last ? '$' + pfmt(last) : '—'}</b>
        <span className={up ? 'up' : 'dn'}>
          {pct(t?.pct)}{' '}
          {abs != null && (
            <small>
              ({(abs >= 0 ? '+' : '') + (Math.abs(abs) >= 1 ? abs.toFixed(2) : abs.toPrecision(3))})
            </small>
          )}
        </span>
      </div>
      <dl className="rd-hero-stats">
        <div>
          <dt>24h High</dt>
          <dd>{t?.high ? pfmt(t.high) : '—'}</dd>
        </div>
        <div>
          <dt>24h Low</dt>
          <dd>{t?.low ? pfmt(t.low) : '—'}</dd>
        </div>
        <div>
          <dt>Volume (24h)</dt>
          <dd>{t?.qvol ? cfmt(t.qvol).replace('$', '') : '—'}</dd>
        </div>
      </dl>
      <div className="rd-hero-act">
        <span
          className={'rd-trend ' + trend}
          title="Majority read across the multi-timeframe analysis"
        >
          <HomeIcon id="star" size={16} />
          <span>
            <small>Trend</small>
            <b>{trend === 'bull' ? 'Bullish' : trend === 'bear' ? 'Bearish' : 'Neutral'}</b>
          </span>
        </span>
        <button
          type="button"
          className="rd-trade"
          onClick={() => go('pro')}
          title="Open the Pro Terminal for this market"
        >
          Pro Terminal
          <HomeIcon id="overview" size={16} />
        </button>
      </div>
    </section>
  )
}

// ---- metrics strip ------------------------------------------------------------

function Gauge({ value, label, size = 76 }: { value: number; label?: string; size?: number }) {
  const r = 30
  const len = Math.PI * 1.5 * r
  const on = (Math.max(0, Math.min(100, value)) / 100) * len
  return (
    <svg className="rd-gauge" width={size} height={size} viewBox="0 0 76 76" aria-hidden="true">
      <circle
        cx="38"
        cy="38"
        r={r}
        className="rd-gauge-track"
        strokeDasharray={`${len} 999`}
        transform="rotate(135 38 38)"
      />
      <circle
        cx="38"
        cy="38"
        r={r}
        className="rd-gauge-fill"
        strokeDasharray={`${on} 999`}
        transform="rotate(135 38 38)"
      />
      {label && (
        <text x="38" y="33" textAnchor="middle" className="rd-gauge-lbl">
          {label}
        </text>
      )}
      <text x="38" y="48" textAnchor="middle" className="rd-gauge-val">
        {Math.round(value)}%
      </text>
    </svg>
  )
}

function countdown(ms: number): string {
  if (!(ms > 0)) return '—'
  const s = Math.floor(ms / 1000)
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  return h + ':' + m + ':' + String(s % 60).padStart(2, '0')
}

export function RadarMetrics() {
  const now = useTick(1000, RADAR)
  const fr = state.fr as {
    lastFundingRate?: string
    nextFundingTime?: number
    markPrice?: string
  } | null
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) * 100 : null
  const oi = state.oi as { openInterest?: string } | null
  const mark =
    Number(fr?.markPrice) ||
    (state.tickers[state.symbol] as { last?: number } | undefined)?.last ||
    0
  const oiUsd = oi?.openInterest ? Number(oi.openInterest) * mark : null
  const hist = (state.oiHist as Array<{ openInterest: string | number }> | null) ?? []
  const oiChg =
    hist.length > 24
      ? (Number(hist[hist.length - 1].openInterest) / Number(hist[hist.length - 25].openInterest) -
          1) *
        100
      : null
  const ls =
    (state.ls as Array<{ longAccount: string | number; shortAccount: string | number }> | null) ??
    []
  const lastLs = ls[ls.length - 1]
  const longP = lastLs ? Number(lastLs.longAccount) * 100 : null
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const cs = candles()
  const rets = cs
    .slice(-97)
    .map((c, i, a) => (i ? Math.log(c.c / a[i - 1].c) : 0))
    .slice(1)
  const sd = rets.length > 2 ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) : null
  const vol = sd != null ? sd * Math.sqrt(rets.length) * 100 : null
  return (
    <div className="rd-metrics">
      <div className="card rd-m">
        <span className="rd-m-h">
          <HomeIcon id="calendar" size={16} />
          Funding Rate
        </span>
        <b className={rate != null && rate < 0 ? 'dn' : 'up'}>
          {rate != null ? (rate >= 0 ? '+' : '') + rate.toFixed(4) + '%' : '—'}
        </b>
        <small>Next: {fr?.nextFundingTime ? countdown(fr.nextFundingTime - now) : '—'}</small>
      </div>
      <div className="card rd-m">
        <span className="rd-m-h">
          <HomeIcon id="liquidity" size={16} />
          Open Interest
        </span>
        <b>{oiUsd ? cfmt(oiUsd) : '—'}</b>
        <small className={oiChg != null && oiChg < 0 ? 'dn' : 'up'}>
          {oiChg != null
            ? pct(oiChg) + ' 24h'
            : 'contracts ' + (oi?.openInterest ? Number(oi.openInterest).toLocaleString() : '—')}
        </small>
      </div>
      <div className="card rd-m">
        <span className="rd-m-h">
          <HomeIcon id="venues" size={16} />
          Long / Short Ratio
        </span>
        <b>{longP != null ? longP.toFixed(1) + ' / ' + (100 - longP).toFixed(1) : '—'}</b>
        <div className="rd-ls" aria-hidden="true">
          <i style={{ width: (longP ?? 50) + '%' }} />
        </div>
        <small>
          <span className="up">Long {longP != null ? longP.toFixed(1) + '%' : '—'}</span>
          <span className="dn">Short {longP != null ? (100 - longP).toFixed(1) + '%' : '—'}</span>
        </small>
      </div>
      <div className="card rd-m rd-m-g">
        <span className="rd-m-h">
          <HomeIcon id="sentiment" size={16} />
          Market Sentiment
        </span>
        <div className="rd-m-gauge">
          {fg?.value != null ? (
            <Gauge value={Number(fg.value)} label={fg.value_classification} size={82} />
          ) : (
            <small>Loading…</small>
          )}
        </div>
      </div>
      <div className="card rd-m">
        <span className="rd-m-h">
          <HomeIcon id="overview" size={16} />
          Volatility ({rets.length} bars)
        </span>
        <b>{vol != null ? vol.toFixed(2) + '%' : '—'}</b>
        <AreaChart values={cs.slice(-96).map((c) => c.c)} height={36} color="var(--green)" />
      </div>
    </div>
  )
}

// ---- beside the chart ------------------------------------------------------------

export function RadarSide() {
  useTick(2000, RADAR)
  const p = pivots()
  const cs = candles()
  const closes = cs.map((c) => c.c)
  const enough = closes.length >= 30
  const rsi = enough ? calcRSI(closes) : null
  const macd = enough ? calcMACD(closes) : null
  const bb = enough ? calcBB(closes) : null
  const atr = cs.length > 15 ? calcATR(cs) : null
  const last = closes[closes.length - 1]
  const bbw = bb && bb.mid ? ((bb.up - bb.lo) / bb.mid) * 100 : null
  const atrPct = atr && last ? (atr / last) * 100 : null
  const tag = (txt: string, tone: 'up' | 'dn' | 'mid' | 'dim') => (
    <span className={'rd-tag ' + tone}>{txt}</span>
  )
  const lv = (v: number[]) => v.map((x) => pfmt(x)).join(' / ')
  return (
    <aside className="rd-side">
      <Card title="Key Levels" icon="radar" className="rd-levels">
        {p ? (
          <dl>
            <dt>
              <i className="dot dn" />
              Resistance
            </dt>
            <dd>{lv(p.R)}</dd>
            <dt>
              <i className="dot up" />
              Support
            </dt>
            <dd>{lv(p.S)}</dd>
            <dt>
              <i className="dot" />
              Pivot
            </dt>
            <dd>{pfmt(p.P)}</dd>
          </dl>
        ) : (
          <p className="rd-empty">Waiting for the 24h range…</p>
        )}
        <small className="rd-foot">Classic floor pivots from the 24h high, low and last</small>
      </Card>
      <Card title="Quick Stats" icon="overview" className="rd-stats">
        <ul>
          <li>
            <span>RSI (14)</span>
            <b>{rsi != null ? rsi.toFixed(1) : '—'}</b>
            {rsi != null &&
              (rsi >= 70
                ? tag('Overbought', 'dn')
                : rsi >= 55
                  ? tag('Bullish', 'up')
                  : rsi <= 30
                    ? tag('Oversold', 'up')
                    : rsi <= 45
                      ? tag('Bearish', 'dn')
                      : tag('Neutral', 'dim'))}
          </li>
          <li>
            <span>MACD</span>
            <b>{macd ? (macd.hist >= 0 ? '+' : '') + short(macd.hist) : '—'}</b>
            {macd && (macd.hist >= 0 ? tag('Bullish', 'up') : tag('Bearish', 'dn'))}
          </li>
          <li>
            <span>BB Width</span>
            <b>{bbw != null ? bbw.toFixed(2) + '%' : '—'}</b>
            {bbw != null &&
              (bbw < 1.5
                ? tag('Squeeze', 'mid')
                : bbw > 5
                  ? tag('Wide', 'mid')
                  : tag('Normal', 'dim'))}
          </li>
          <li>
            <span>ATR (14)</span>
            <b>{atr != null ? short(atr) : '—'}</b>
            {atrPct != null &&
              (atrPct > 1.5
                ? tag('High', 'dn')
                : atrPct > 0.6
                  ? tag('Medium', 'mid')
                  : tag('Low', 'dim'))}
          </li>
        </ul>
      </Card>
    </aside>
  )
}

// ---- below the chart -------------------------------------------------------------

function Spark({ sym }: { sym: string }) {
  const v = getSeries(sym, '1D').map((p) => p[1])
  return <AreaChart values={v} height={28} className="rd-spark" />
}

function MarketOverview({ now }: { now: number }) {
  useEffect(() => {
    WATCH.forEach((k) => COINS[k] && void refreshSeries(COINS[k].sym, '1D'))
  }, [now])
  return (
    <Card
      title="Market Overview"
      icon="bubbles"
      right={
        <button type="button" className="rd-link" onClick={() => go('market')}>
          Top Gainers / Losers
        </button>
      }
    >
      <ul className="rd-mo">
        {WATCH.filter((k) => COINS[k]).map((k) => {
          const sym = COINS[k].sym
          const t = state.tickers[sym] as { last?: number; pct?: number } | undefined
          return (
            <li key={k}>
              <button type="button" onClick={() => open(sym)}>
                <CoinBadge sym={sym} size={24} />
                <b>{k}</b>
                <span className="mono">{t?.last ? '$' + pfmt(t.last) : '—'}</span>
                <span className={'mono ' + ((t?.pct ?? 0) >= 0 ? 'up' : 'dn')}>{pct(t?.pct)}</span>
                <Spark sym={sym} />
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

const FG_BANDS: Array<[string, string, string]> = [
  ['Extreme Greed', '75-100', 'var(--green)'],
  ['Greed', '60-74', '#7EE08A'],
  ['Neutral', '40-59', 'var(--amber)'],
  ['Fear', '25-39', 'var(--primary)'],
  ['Extreme Fear', '0-24', 'var(--red)'],
]

function FearGreed() {
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const v = fg?.value != null ? Number(fg.value) : null
  return (
    <Card title="Fear & Greed Index" icon="sentiment">
      <div className="rd-fg">
        <div className="rd-fg-dial">
          {v != null ? (
            <Gauge value={v} label={fg?.value_classification} size={150} />
          ) : (
            <p className="rd-empty">Loading…</p>
          )}
        </div>
        <ul className="rd-fg-legend">
          {FG_BANDS.map(([name, range, c]) => (
            <li key={name}>
              <i style={{ background: c }} />
              <span>{name}</span>
              <small>{range}</small>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function TradeSummary() {
  useBump(onPaperTradingChange)
  const s = getOverallStats()
  return (
    <Card title="Trade Summary" icon="overview" className="rd-ts">
      <dl>
        <div>
          <dt>Closed paper trades</dt>
          <dd>{s.count}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd className={s.winRate >= 0.5 ? 'up' : s.count ? 'dn' : ''}>
            {s.count ? (s.winRate * 100).toFixed(0) + '%' : '—'}
          </dd>
        </div>
        <div>
          <dt>Average trade</dt>
          <dd className={s.avgReturn >= 0 ? 'up' : 'dn'}>
            {s.count ? pct(s.avgReturn * 100) : '—'}
          </dd>
        </div>
        <div>
          <dt>Compounded</dt>
          <dd className={s.totalReturn >= 0 ? 'up' : 'dn'}>
            {s.count ? pct(s.totalReturn * 100) : '—'}
          </dd>
        </div>
      </dl>
      <button type="button" className="rd-cta" onClick={() => go('neuralnet')}>
        View Trade History →
      </button>
    </Card>
  )
}

/** Plain-language checks behind the model's call, each from live indicators. */
function evidence() {
  const cs = candles()
  const closes = cs.map((c) => c.c)
  if (closes.length < 100) return []
  const last = closes[closes.length - 1]
  const rsi = calcRSI(closes)
  const ema99 = emaArr(closes, 99)[closes.length - 1]
  const v = cs.map((c) => c.v)
  const recent = v.slice(-10).reduce((a, b) => a + b, 0)
  const prior = v.slice(-20, -10).reduce((a, b) => a + b, 0)
  const p = pivots()
  const above = p ? [...p.R, p.P].filter((x) => x > last).sort((a, b) => a - b)[0] : undefined
  const room = above ? ((above - last) / last) * 100 : null
  return [
    {
      ok: rsi >= 50,
      text: `RSI is in the ${rsi >= 55 ? 'bullish' : rsi <= 45 ? 'bearish' : 'neutral'} zone (${rsi.toFixed(0)})`,
    },
    { ok: last >= ema99, text: `Price ${last >= ema99 ? 'above' : 'below'} the 99 EMA` },
    {
      ok: recent >= prior,
      text: `Volume ${recent >= prior ? 'increasing' : 'decreasing'} (last 10 bars vs prior 10)`,
    },
    room != null
      ? {
          ok: room > 1,
          text:
            room > 1
              ? `No resistance within 1% (next ${pfmt(above as number)})`
              : `Resistance ${room.toFixed(2)}% away at ${pfmt(above as number)}`,
        }
      : { ok: true, text: 'No pivot resistance above price' },
  ]
}

function DirectionModel() {
  useBump(onMLChange)
  useBump(onOverlayTogglesChange)
  const ml = getMLState()
  if (!getShowMLPrediction()) return null
  const pred = ml.prediction
  const long = pred?.direction === 'up'
  const conf = pred ? Math.round(pred.confidence * 100) : null
  const acc = ml.trained?.backtestAccuracy
  return (
    <Card
      title="My Direction Model"
      icon="radar"
      className="rd-dm"
      right={
        <span className="rd-head-r">
          <span className={'rd-tag ' + (ml.status === 'ready' ? 'up' : 'dim')}>
            {ml.status === 'ready'
              ? 'AI Signal Active'
              : ml.status === 'training'
                ? 'Training…'
                : 'Not trained'}
          </span>
          <button type="button" className="rd-link" onClick={() => go('neuralnet')}>
            Details →
          </button>
        </span>
      }
    >
      <p className="rd-sub">Neural network trained on this market&apos;s own candles</p>
      <div className="rd-dm-body">
        <div className="rd-dm-ring">
          {pred ? (
            <>
              <Gauge value={conf ?? 50} label={long ? 'LONG' : 'SHORT'} size={128} />
              <small>Current Bias</small>
              <b className={long ? 'up' : 'dn'}>{long ? 'Long' : 'Short'}</b>
            </>
          ) : (
            <button
              type="button"
              className="rd-cta"
              disabled={ml.status === 'training'}
              onClick={() => void trainForSymbol(state.symbol, state.tf, state.candles as never)}
            >
              {ml.status === 'training' ? 'Training…' : 'Train model'}
            </button>
          )}
        </div>
        <div className="rd-dm-ev">
          <h4>Analysis Result</h4>
          <ul>
            {evidence().map((e) => (
              <li key={e.text} className={e.ok ? 'up' : 'dn'}>
                <span aria-hidden="true">{e.ok ? '✓' : '✗'}</span>
                {e.text}
              </li>
            ))}
          </ul>
          {acc != null && (
            <small className="rd-foot">
              Backtest accuracy {(acc * 100).toFixed(1)}% on {ml.trained?.backtestN} held-out bars —
              not a guarantee.
            </small>
          )}
        </div>
      </div>
    </Card>
  )
}

function MultiTimeframe() {
  useBump(onConfluenceChange)
  useBump(onOverlayTogglesChange)
  if (!getShowConfluence()) return null
  const rows = getConfluenceRows()
  return (
    <Card title="Multi-Timeframe Analysis" icon="overview" className="rd-mtf">
      <table>
        <thead>
          <tr>
            <th>TF</th>
            <th>Trend</th>
            <th>RSI</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const v = r.loading ? null : r.verdict
            return (
              <tr key={r.tf}>
                <td className="mono">{r.tf}</td>
                <td className={v === 'bull' ? 'up' : v === 'bear' ? 'dn' : 'dim'}>
                  {v == null
                    ? '…'
                    : v === 'bull'
                      ? 'Bullish ↑'
                      : v === 'bear'
                        ? 'Bearish ↓'
                        : 'Neutral →'}
                </td>
                <td className="mono dim">{r.loading ? '' : r.rsi.toFixed(0)}</td>
                <td>
                  {v && (
                    <span
                      className={'rd-tag ' + (v === 'bull' ? 'up' : v === 'bear' ? 'dn' : 'dim')}
                    >
                      {v === 'bull' ? 'Long' : v === 'bear' ? 'Short' : 'Wait'}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Card>
  )
}

const STRATEGY: Array<{ title: string; sub: string; icon: HomeIconId; tab: string }> = [
  { title: 'Order Flow', sub: 'Delta & book imbalance', icon: 'flow', tab: 'radar' },
  { title: 'Whale Tracker', sub: 'Track large orders', icon: 'whale', tab: 'radar' },
  { title: 'Liquidation Zones', sub: 'Find liquidation levels', icon: 'liqs', tab: 'analysis' },
  { title: 'Bubbles', sub: 'Market at a glance', icon: 'bubbles', tab: 'bubbles' },
  { title: 'Economic Calendar', sub: 'Major events', icon: 'calendar', tab: 'news' },
]

function StrategyLinks() {
  return (
    <Card title="Strategy & Indicators" icon="overview" className="rd-strat">
      <div className="rd-strat-grid">
        {STRATEGY.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => {
              if (s.tab === 'radar')
                document
                  .getElementById('radarChartCard')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              else go(s.tab)
            }}
          >
            <span className="rd-strat-ico">
              <HomeIcon id={s.icon} size={22} />
            </span>
            <span>
              <b>{s.title}</b>
              <small>{s.sub}</small>
            </span>
          </button>
        ))}
      </div>
    </Card>
  )
}

function DirectionStrip() {
  useBump(onMLChange)
  const ml = getMLState()
  const pred = ml.prediction
  const pUp = pred ? (pred.direction === 'up' ? pred.confidence : 1 - pred.confidence) : null
  const bars = candles().slice(-48)
  const max = Math.max(1e-12, ...bars.map((c) => Math.abs(c.c - c.o)))
  return (
    <section className="card rd-strip" aria-label="Direction model">
      <div className="rd-strip-l">
        <span className="rd-strip-h">
          <HomeIcon id="radar" size={18} />
          <b>Direction Model</b>
          {pred && (
            <span className={'rd-tag ' + (pred.direction === 'up' ? 'up' : 'dn')}>
              {pred.direction === 'up' ? 'Bullish' : 'Bearish'}
            </span>
          )}
          {pred && <small>Confidence: {Math.round(pred.confidence * 100)}%</small>}
        </span>
        <div className="rd-strip-bars" aria-hidden="true">
          {bars.map((c, i) => (
            <i
              key={i}
              className={c.c >= c.o ? 'up' : 'dn'}
              style={{ height: 18 + (Math.abs(c.c - c.o) / max) * 82 + '%' }}
            />
          ))}
        </div>
      </div>
      <div className="rd-strip-r">
        <small>Next Move Probability</small>
        {pUp != null ? (
          <div className="rd-prob">
            <span className="up">
              <b>{Math.round(pUp * 100)}%</b> Up
            </span>
            <span className="dn">
              <b>{Math.round((1 - pUp) * 100)}%</b> Down
            </span>
          </div>
        ) : (
          <p className="rd-empty">Train the direction model to see its probabilities.</p>
        )}
      </div>
    </section>
  )
}

function MarketWatch() {
  return (
    <Card
      title="Market Watch"
      icon="bubbles"
      className="rd-watch"
      right={
        <button type="button" className="rd-link" onClick={() => go('market')}>
          View All →
        </button>
      }
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Symbol</th>
              <th>Price</th>
              <th>24h Change</th>
              <th>Volume</th>
              <th>Trend</th>
              <th aria-label="Open chart" />
            </tr>
          </thead>
          <tbody>
            {WATCH.filter((k) => COINS[k]).map((k, i) => {
              const sym = COINS[k].sym
              const t = state.tickers[sym] as
                { last?: number; pct?: number; qvol?: number } | undefined
              return (
                <tr key={k}>
                  <td className="dim">{i + 1}</td>
                  <td>
                    <span className="rd-coin">
                      <CoinBadge sym={sym} size={20} />
                      {k}
                    </span>
                  </td>
                  <td className="mono">{t?.last ? '$' + pfmt(t.last) : '—'}</td>
                  <td className={'mono ' + ((t?.pct ?? 0) >= 0 ? 'up' : 'dn')}>{pct(t?.pct)}</td>
                  <td className="mono">{t?.qvol ? cfmt(t.qvol).replace('$', '') : '—'}</td>
                  <td className="rd-trendcell">
                    <Spark sym={sym} />
                  </td>
                  <td>
                    <button type="button" className="rd-go" onClick={() => open(sym)}>
                      Chart
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function RadarLower() {
  const now = useTick(3000, RADAR)
  return (
    <div className="rd-lower">
      <div className="rd-row rd-row-3">
        <MarketOverview now={now} />
        <FearGreed />
        <TradeSummary />
      </div>
      <div className="rd-row rd-row-2">
        <DirectionModel />
        <MultiTimeframe />
      </div>
      <StrategyLinks />
      <DirectionStrip />
      <MarketWatch />
    </div>
  )
}
