// The cards around the Neural Net page's chart. Every figure comes from the
// page feed (this market at the page timeframe, and its forecast), the
// self-learning engine (models, trades, learning log) or live engine state.
import { useEffect, useMemo, useRef, useState } from 'react'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'
import { instrumentOf } from '../../constants/instruments'
import { pfmt } from '../../utils/format'
import { loadCandleWindow } from '../../services/marketData'
import { getActiveTab } from '../../features/actions/userActions'
import { signalData } from '../../features/signals/signals'
import { series } from '../../features/selflearn/features'
import { insights } from '../../features/selflearn/patterns'
import { getFeed, labelBars, NN_TFS, setFeedTf, useFeed } from '../../features/selflearn/pageFeed'
import { STRATS } from '../../features/selflearn/strategy'
import { proven, setConfig } from '../../features/selflearn/engine'
import type { SLTrade } from '../../features/selflearn/engine'
import { useSL } from '../../features/selflearn/useSL'
import { SERVER_BOT, loadBot } from '../../features/selflearn/serverBot'
import type { BotTrade } from '../../features/selflearn/serverBot'
import { buildHeatmap, COLORMAPS, colorAt, MODELS } from '../../features/analysis/liqHeatmap/engine'
import { useTick } from '../useTick'
import { Bar, CoinBadge, Ico, NnCard } from './parts'
import { NI } from './icons'
import { Brain } from './Brain'

const NN = ['neuralnet']
const w = window as unknown as { switchTab?: (t: string) => void }
const pair = (s: string) => (instrumentOf(s) ? s : baseOf(s) + '/USDT')
const pct = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + '%')
const ago = (t: number, now: number) => {
  const m = Math.max(0, Math.round((now - t) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'
}
const short = (s: string) => s.replace(/USDT$/, '')

/** ATR% of the last bar against the last 200: where today's volatility sits. */
function volRank(S: ReturnType<typeof series>, closes: number[]): number | null {
  const n = closes.length
  if (n < 60) return null
  const now = S.atr[n - 1] / closes[n - 1]
  const hist = closes.slice(-200).map((c, k) => S.atr[n - Math.min(200, n) + k] / c).filter((v) => v > 0)
  return hist.filter((v) => v < now).length / hist.length
}

// ---- header -------------------------------------------------------------------

export function NnHeader() {
  useTick(1000, NN)
  const feed = useFeed()
  const sl = useSL()
  const sym = feed.sym || state.symbol
  const t = state.tickers[sym] as { last?: number; pct?: number; qvol?: number } | undefined
  const fr = state.fr as { lastFundingRate?: string | number } | null
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) : null
  const cs = feed.candles
  const S = feed.fc?.S
  const trendUp = S ? S.ema20[S.ema20.length - 1] > S.ema50[S.ema50.length - 1] : null
  const vr = S ? volRank(S, cs.slice(0, S.atr.length).map((k) => k.c)) : null
  const qv = t?.qvol ?? 0
  const liq = !qv ? '—' : qv > 1e9 ? 'High' : qv > 1e8 ? 'Medium' : 'Low'
  return (
    <header className="nn-top">
      <div className="card nn-pair">
        <CoinBadge sym={sym} size={46} />
        <span className="nn-pair-id">
          <b>{pair(sym)}</b>
          <small>{instrumentOf(sym)?.name ?? baseOf(sym)} · {instrumentOf(sym) ? 'Yahoo' : 'Binance'}</small>
        </span>
        <span className="nn-pair-px">
          <b className={(t?.pct ?? 0) >= 0 ? 'up' : 'dn'}>{t?.last ? '$' + pfmt(t.last) : '—'}</b>
          <i className={(t?.pct ?? 0) >= 0 ? 'up' : 'dn'}>{pct(t?.pct)}</i>
        </span>
        <label className="nn-kv" title="Leverage used to show paper P/L">
          <small><Ico d={NI.layers} size={12} /> Leverage</small>
          <select value={sl.config.leverage} onChange={(e) => setConfig({ leverage: Number(e.target.value) })}>
            {[1, 2, 3, 5, 10, 20, 25, 50].map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
        <button type="button" className={'nn-kv nn-auto' + (sl.config.auto ? ' on' : '')} onClick={() => setConfig({ auto: !sl.config.auto })}
          title="Paper trading only — no exchange orders">
          <small><Ico d={NI.cpu} size={12} /> Auto trading</small>
          <b>{sl.config.auto ? 'ON · paper' : 'Paused'}</b>
        </button>
        <span className="nn-kv">
          <small><Ico d={NI.flow} size={12} /> Funding</small>
          <b className={rate == null ? '' : rate >= 0 ? 'up' : 'dn'}>{rate == null ? '—' : (rate * 100).toFixed(4) + '%'}</b>
        </span>
      </div>
      <div className="nn-tfs" role="group" aria-label="Timeframe">
        {NN_TFS.map(([k]) => (
          <button key={k} type="button" className={feed.tf === k ? 'on' : ''} onClick={() => setFeedTf(k)}>{k === '1d' ? '1D' : k}</button>
        ))}
      </div>
      <div className="card nn-trend">
        <span><small>Market trend</small><b className={trendUp == null ? '' : trendUp ? 'up' : 'dn'}>{trendUp == null ? '—' : trendUp ? 'BULLISH' : 'BEARISH'}</b><em>EMA 20 vs 50, {feed.tf}</em></span>
        <span><small>Volatility</small><b>{vr == null ? '—' : vr > 0.7 ? 'High' : vr > 0.3 ? 'Medium' : 'Low'}</b><em>{vr == null ? '' : 'ATR in the ' + Math.round(vr * 100) + 'th pct'}</em></span>
        <span><small>Liquidity</small><b>{liq}</b><em>{qv ? '$' + (qv / 1e6).toFixed(0) + 'M 24h' : ''}</em></span>
        <Spark closes={cs.slice(-40).map((k) => k.c)} />
      </div>
    </header>
  )
}

function Spark({ closes }: { closes: number[] }) {
  if (closes.length < 2) return null
  const lo = Math.min(...closes)
  const hi = Math.max(...closes)
  const pts = closes.map((c, i) => `${(i / (closes.length - 1)) * 100},${30 - ((c - lo) / (hi - lo || 1)) * 28}`).join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  return (
    <svg className="nn-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ---- prediction ----------------------------------------------------------------

export function PredictionCard() {
  const feed = useFeed()
  const fc = feed.fc
  const last = feed.candles[feed.candles.length - 1]
  const next = fc?.pct[0] ?? null
  const target = fc && last ? last.c * (1 + (fc.pct[0] ?? 0) / 100) : null
  const dirUp = fc ? fc.pct[2] >= 0 : null
  const conf = fc ? (dirUp ? fc.pUp : 1 - fc.pUp) : null
  const S = fc?.S
  const vr = S ? volRank(S, feed.candles.slice(0, S.atr.length).map((k) => k.c)) : null
  const closes = feed.candles.slice(-36).map((k) => k.c)
  let mini: { a: string; p: string } | null = null
  if (fc && closes.length > 5 && last) {
    const k = last.c / fc.path[0].price
    const pp = fc.path.map((x) => x.price * k)
    const all = closes.concat(pp)
    const lo = Math.min(...all)
    const hi = Math.max(...all)
    const n = closes.length + pp.length - 1
    const Y = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * 88
    mini = {
      a: closes.map((c, i) => `${(i / n) * 300},${Y(c)}`).join(' '),
      p: pp.map((c, i) => `${((closes.length - 1 + i) / n) * 300},${Y(c)}`).join(' '),
    }
  }
  return (
    <NnCard title="AI Prediction & Analysis" icon={NI.brain} className="nn-pred" right={<span className="nn-live on">Live</span>}>
      <div className="nn-pred-top">
        <span className={'nn-pred-ico ' + ((next ?? 0) >= 0 ? 'up' : 'dn')}><Ico d={(next ?? 0) >= 0 ? NI.up : NI.down} size={22} /></span>
        <span><small>Next {feed.tf} prediction</small><b className={(next ?? 0) >= 0 ? 'up' : 'dn'}>{pct(next, 3)}</b></span>
        <span><small>Target price</small><b>{target ? '$' + pfmt(target) : '—'}</b></span>
      </div>
      <div className="nn-pred-body">
        <div className="nn-pred-chart">
          {mini ? (
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline points={mini.a} fill="none" stroke="#5ee7ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <polyline points={mini.p} fill="none" stroke="#d06bff" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : <p className="nn-empty">{feed.status === 'loading' ? 'Training on this chart…' : 'Needs 200 bars'}</p>}
          <div className="nn-pred-leg"><span><i className="a" />Actual</span><span><i className="p" />Predicted</span></div>
          <div className="nn-pred-x"><span>Now</span>{[1, 2, 4, 8, 16].map((h) => <span key={h}>{labelBars(h, feed.tf)}</span>)}</div>
        </div>
        <dl className="nn-pred-kv">
          <div><dt>Confidence</dt><dd>{conf == null ? '—' : Math.round(conf * 100) + '%'}</dd></div>
          <div title={fc ? `${fc.holdout} bars it never trained on` : ''}><dt>Model accuracy</dt><dd>{fc ? Math.round(fc.acc4 * 100) + '%' : '—'}</dd></div>
          <div><dt>Trend direction</dt><dd className={dirUp == null ? '' : dirUp ? 'up' : 'dn'}>{dirUp == null ? '—' : dirUp ? 'LONG' : 'SHORT'}</dd></div>
          <div><dt>Risk level</dt><dd className={vr == null ? '' : vr > 0.7 ? 'dn' : vr > 0.3 ? 'a' : 'up'}>{vr == null ? '—' : vr > 0.7 ? 'High' : vr > 0.3 ? 'Medium' : 'Low'}</dd></div>
        </dl>
      </div>
      <p className="nn-note">
        Ridge forecast refitted on {fc?.trained ?? '—'} bars each close. Accuracy = right direction 4 bars ahead on {fc?.holdout ?? '—'} unseen bars; 50% is a coin flip.
      </p>
      <button type="button" className="nn-link" onClick={() => w.switchTab?.('analysis')}>View detailed analysis <Ico d={NI.arrow} size={13} /></button>
    </NnCard>
  )
}

// ---- sentiment -------------------------------------------------------------------

export function AiSentiment() {
  useTick(3000, NN)
  const sig = signalData as Array<{ score: number; master: { type: string } }>
  const n = sig.length
  const bull = sig.filter((s) => s.master.type === 'BUY').length
  const bear = sig.filter((s) => s.master.type === 'SELL').length
  const neu = n - bull - bear
  const score = n ? sig.reduce((a, s) => a + (s.score + 100) / 2, 0) / n : null
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const fgv = fg?.value != null ? Number(fg.value) : null
  const r = 38
  const c = 2 * Math.PI * r
  const col = score == null ? 'var(--dim)' : score >= 55 ? 'var(--green)' : score <= 45 ? 'var(--red)' : 'var(--amber)'
  const word = score == null ? 'Scanning' : score >= 55 ? 'Bullish' : score <= 45 ? 'Bearish' : 'Neutral'
  return (
    <NnCard title="AI Market Sentiment" icon={NI.gauge} className="nn-sent">
      <div className="nn-sent-top">
        <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true" className="nn-ring">
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--hair-2)" strokeWidth="9" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={col} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(c * (score ?? 0)) / 100} ${c}`} transform="rotate(-90 50 50)" />
          <text x="50" y="50" textAnchor="middle" className="nn-ring-v" fill={col}>{score == null ? '—' : Math.round(score) + '%'}</text>
          <text x="50" y="65" textAnchor="middle" className="nn-ring-l">{word}</text>
        </svg>
        <div className="nn-sent-bars">
          {([['Bullish', bull, 'g'], ['Neutral', neu, 'a'], ['Bearish', bear, 'r']] as const).map(([l, v, cl]) => (
            <div key={l}><span><small>{l}</small><b>{n ? Math.round((v / n) * 100) + '%' : '—'}</b></span><Bar v={n ? v / n : 0} cls={cl} /></div>
          ))}
        </div>
      </div>
      <div className="nn-fg">
        <svg width="84" height="50" viewBox="0 0 84 50" aria-hidden="true">
          <defs>
            <linearGradient id="nnFgG" x1="0" x2="1">
              <stop offset="0" stopColor="#ff4d5e" /><stop offset=".5" stopColor="#ffb020" /><stop offset="1" stopColor="#22e08a" />
            </linearGradient>
          </defs>
          <path d="M12 44a30 30 0 0 1 60 0" fill="none" stroke="url(#nnFgG)" strokeWidth="8" strokeLinecap="round" />
          {fgv != null && (
            <line x1="42" y1="44" x2={42 - 26 * Math.cos((fgv / 100) * Math.PI)} y2={44 - 26 * Math.sin((fgv / 100) * Math.PI)}
              stroke="var(--txt)" strokeWidth="2.5" strokeLinecap="round" />
          )}
          <circle cx="42" cy="44" r="3.5" fill="var(--txt)" />
        </svg>
        <span><small>Fear &amp; Greed index</small><b className={fgv == null ? '' : fgv >= 55 ? 'up' : fgv <= 45 ? 'dn' : 'a'}>{fg?.value_classification ?? '—'}</b></span>
        <em>{fgv ?? '—'}</em>
      </div>
      <p className="nn-note">Ring: average signal-scanner score across {n || '—'} markets.</p>
    </NnCard>
  )
}

// ---- insights ---------------------------------------------------------------------

export function AiInsights() {
  const now = useTick(15000, NN)
  const feed = useFeed()
  const fc = feed.fc
  const closed = feed.candles.slice(0, fc?.S.atr.length ?? 0)
  const list = fc && closed.length > 60 ? insights(closed, fc.S, feed.tf) : []
  const ms = NN_TFS.find((x) => x[0] === feed.tf)?.[1] ?? 900_000
  const lastT = closed[closed.length - 1]?.t ?? 0
  return (
    <NnCard title="AI Insights" icon={NI.bolt} className="nn-ins">
      {list.length ? (
        <ul className="nn-insl">
          {list.map((i) => (
            <li key={i.id + i.barsAgo} className={i.bull == null ? '' : i.bull ? 'g' : 'r'}>
              <span className="nn-insi"><Ico d={i.bull === false ? NI.down : NI.up} size={14} /></span>
              <span><b>{i.title}</b><small>{i.sub}</small></span>
              <em>{ago(lastT + ms - i.barsAgo * ms, now)}</em>
            </li>
          ))}
        </ul>
      ) : <p className="nn-empty">{feed.status === 'loading' ? 'Reading the chart…' : 'Nothing notable in the last 30 bars.'}</p>}
    </NnCard>
  )
}

// ---- movers -----------------------------------------------------------------------

export function TopMovers() {
  useTick(4000, NN)
  const [tab, setTab] = useState<'g' | 'l'>('g')
  const rows = Object.entries(state.tickers)
    .filter(([s, t]) => s.endsWith('USDT') && (t.qvol ?? 0) > 2e7 && t.last > 0)
    .sort((a, b) => (tab === 'g' ? b[1].pct - a[1].pct : a[1].pct - b[1].pct))
    .slice(0, 5)
  return (
    <NnCard title="Top Movers" icon={NI.trend} className="nn-mov">
      <div className="nn-seg nn-seg-full">
        <button type="button" className={tab === 'g' ? 'on' : ''} onClick={() => setTab('g')}>Gainers</button>
        <button type="button" className={tab === 'l' ? 'on' : ''} onClick={() => setTab('l')}>Losers</button>
      </div>
      <ul className="nn-movl">
        {rows.map(([s, t]) => (
          <li key={s}>
            <CoinBadge sym={s} size={20} />
            <b>{short(s)}</b>
            <i className={t.pct >= 0 ? 'up' : 'dn'}>{pct(t.pct)}</i>
            <em>${pfmt(t.last)}</em>
          </li>
        ))}
        {!rows.length && <li className="nn-empty">Waiting for tickers…</li>}
      </ul>
    </NnCard>
  )
}

// ---- mini heatmap -------------------------------------------------------------------

/** The page feed's bars as of reload `gen`, as a small liquidation heatmap. */
function heatFor(gen: number) {
  const cs = getFeed().candles
  return gen && cs.length > 60 ? buildHeatmap(cs.slice(-160), { bins: 70, model: MODELS[0], oi: [], funding: null }) : null
}

export function MiniHeatmap() {
  const feed = useFeed()
  const cv = useRef<HTMLCanvasElement>(null)
  // Rebuilt when the bars reload, not on every tick of the forming bar.
  const heat = useMemo(() => heatFor(feed.dataGen), [feed.dataGen])
  useEffect(() => {
    const c = cv.current
    if (!c || !heat) return
    const W = c.clientWidth
    const H = c.clientHeight
    if (!W || !H) return
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const map = COLORMAPS.plasma
    const cw = W / heat.cols
    const bh = H / heat.bins
    for (let x = 0; x < heat.cols; x++)
      for (let b = 0; b < heat.bins; b++) {
        const v = heat.grid[x * heat.bins + b] / (heat.max * 0.6 || 1)
        const [r, g, bl] = colorAt(map, Math.min(1, v))
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${bl | 0})`
        ctx.fillRect(x * cw, H - (b + 1) * bh, cw + 0.5, bh + 0.5)
      }
    const y = (p: number) => H - ((p - heat.priceMin) / (heat.priceMax - heat.priceMin)) * H
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    heat.candles.forEach((k, i) => (i ? ctx.lineTo((i + 0.5) * cw, y(k.c)) : ctx.moveTo(0.5 * cw, y(k.c))))
    ctx.stroke()
  }, [heat])
  return (
    <NnCard title="Liquidity Heatmap" icon={NI.fire} className="nn-mh" right={<span className="nn-chip">{feed.tf}</span>}>
      <div className="nn-mh-wrap">
        <canvas ref={cv} />
        {heat && (
          <div className="nn-mh-ax">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f}>{pfmt(heat.priceMax - f * (heat.priceMax - heat.priceMin))}</span>)}
          </div>
        )}
      </div>
      <p className="nn-note">Estimated liquidation clusters on the last 160 bars; white line is price.</p>
    </NnCard>
  )
}

// ---- volume profile ---------------------------------------------------------------------

export function NnVolumeProfile() {
  const feed = useFeed()
  const cs = feed.candles.slice(-200)
  const N = 18
  let rows: Array<{ p: number; v: number; buy: number }> = []
  let poc = 0
  if (cs.length > 20) {
    const lo = Math.min(...cs.map((k) => k.l))
    const hi = Math.max(...cs.map((k) => k.h))
    const st = (hi - lo) / N || 1
    rows = Array.from({ length: N }, (_, i) => ({ p: lo + (i + 0.5) * st, v: 0, buy: 0 }))
    cs.forEach((k) => {
      const a = Math.max(0, Math.floor((k.l - lo) / st))
      const b = Math.min(N - 1, Math.floor((k.h - lo) / st))
      const share = k.v / (b - a + 1)
      for (let i = a; i <= b; i++) {
        rows[i].v += share
        if (k.c >= k.o) rows[i].buy += share
      }
    })
    rows.reverse()
    const mx = Math.max(...rows.map((r) => r.v))
    poc = rows.findIndex((r) => r.v === mx)
  }
  const mx = rows[poc]?.v || 1
  const last = feed.candles[feed.candles.length - 1]?.c
  return (
    <NnCard title="Volume Profile" icon={NI.bars} className="nn-vp" right={<span className="nn-chip">{pair(feed.sym || state.symbol)}</span>}>
      <ul className="nn-vpl">
        {rows.map((r, i) => (
          <li key={i} className={(i === poc ? 'poc ' : '') + (last && Math.abs(r.p - last) < (rows[0].p - rows[1].p) / 2 ? 'px' : '')}>
            <i style={{ width: (r.v / mx) * 100 + '%' }}>
              <b style={{ width: (r.v ? (r.buy / r.v) * 100 : 0) + '%' }} />
            </i>
            <span>{pfmt(r.p)}</span>
          </li>
        ))}
      </ul>
      <p className="nn-note">Last 200 bars · green share = volume on up bars · <b className="a">POC</b> {rows[poc] ? pfmt(rows[poc].p) : '—'}</p>
    </NnCard>
  )
}

// ---- multi-timeframe ---------------------------------------------------------------------

const MTF = ['1m', '5m', '15m', '1h', '4h', '1d']
type Read = { trend: boolean; mom: number; volUp: boolean; rsi: number; macd: number; stoch: number }

export function NnMultiTf() {
  const feed = useFeed()
  const sym = feed.sym || state.symbol
  const [tf, setTf] = useState('15m')
  const [read, setRead] = useState<{ k: string; r: Read | null } | null>(null)
  const key = sym + tf
  useEffect(() => {
    let alive = true
    const load = () => {
      if (getActiveTab() !== 'neuralnet') return
      loadCandleWindow(sym, tf, 160)
        .then((cs) => {
          if (!alive) return
          if (cs.length < 60) return setRead({ k: key, r: null })
          const S = series(cs)
          const i = cs.length - 1
          const a = S.atr[i] || 1
          setRead({
            k: key,
            r: {
              trend: S.ema20[i] > S.ema50[i],
              mom: (cs[i].c - cs[i - 10].c) / a,
              volUp: S.volRatio.slice(-5).reduce((x, y) => x + y, 0) / 5 > 1,
              rsi: S.rsi[i],
              macd: S.macdHist[i],
              stoch: S.stoch[i],
            },
          })
        })
        .catch(() => alive && setRead({ k: key, r: null }))
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sym, tf, key])
  const r = read?.k === key ? read.r : null
  const rows: Array<[string, string, string, 'g' | 'r' | 'a']> = r
    ? [
        ['Trend', NI.trend, r.trend ? 'Uptrend' : 'Downtrend', r.trend ? 'g' : 'r'],
        ['Momentum', NI.bolt, Math.abs(r.mom) > 2 ? (r.mom > 0 ? 'Strong up' : 'Strong down') : r.mom > 0 ? 'Mild up' : 'Mild down', r.mom > 0 ? 'g' : 'r'],
        ['Volume', NI.bars, r.volUp ? 'Increasing' : 'Fading', r.volUp ? 'g' : 'a'],
        ['RSI (14)', NI.gauge, r.rsi.toFixed(1), r.rsi > 70 ? 'r' : r.rsi < 30 ? 'g' : 'a'],
        ['MACD', NI.flow, r.macd > 0 ? 'Bullish' : 'Bearish', r.macd > 0 ? 'g' : 'r'],
        ['Stochastic', NI.layers, r.stoch > 80 ? 'Overbought' : r.stoch < 20 ? 'Oversold' : r.stoch.toFixed(0), r.stoch > 80 ? 'r' : r.stoch < 20 ? 'g' : 'a'],
      ]
    : []
  return (
    <NnCard title="Multi-Timeframe Analysis" icon={NI.layers} className="nn-mtf">
      <div className="nn-seg nn-seg-full">
        {MTF.map((k) => <button key={k} type="button" className={tf === k ? 'on' : ''} onClick={() => setTf(k)}>{k === '1d' ? '1D' : k}</button>)}
      </div>
      {rows.length ? (
        <ul className="nn-mtfl">
          {rows.map(([l, ic, v, c]) => (
            <li key={l}><span><Ico d={ic} size={13} />{l}</span><b className={c}><i />{v}</b></li>
          ))}
        </ul>
      ) : <p className="nn-empty">Loading {tf}…</p>}
    </NnCard>
  )
}

// ---- trades -------------------------------------------------------------------------------

function TradeRow({ t, lev }: { t: SLTrade; lev: number }) {
  const open = t.closedAt == null
  const px = state.tickers[t.sym]?.last
  const live = open && px ? t.side * (px / t.entry - 1) * 100 : null
  const p = open ? live : t.pnlPct ?? null
  return (
    <tr>
      <td><b>{pair(t.sym)}</b><small>{STRATS[t.strat].label}</small></td>
      <td className={t.side === 1 ? 'up' : 'dn'}>{t.side === 1 ? 'Long' : 'Short'}</td>
      <td className={open ? 'a' : (t.r ?? 0) > 0 ? 'up' : 'dn'}>{open ? 'Open' : (t.r ?? 0) > 0 ? 'Win' : 'Loss'}</td>
      <td>{open ? '1:' + (STRATS[t.strat].tpM / STRATS[t.strat].slM).toFixed(1) : (t.r ?? 0).toFixed(2) + 'R'}</td>
      <td className={(p ?? 0) >= 0 ? 'up' : 'dn'}>{p == null ? '—' : pct(p * lev, 1)}</td>
    </tr>
  )
}

export function RecentTrades() {
  useTick(2000, NN)
  const sl = useSL()
  const [src, setSrc] = useState<'app' | 'bot'>('app')
  const [bot, setBot] = useState<BotTrade[] | null>(null)
  useEffect(() => {
    if (src !== 'bot' || !SERVER_BOT) return
    let alive = true
    loadBot().then((d) => alive && setBot(d?.trades ?? [])).catch(() => alive && setBot([]))
    return () => {
      alive = false
    }
  }, [src])
  const list = sl.trades.slice().sort((a, b) => b.openedAt - a.openedAt).slice(0, 9)
  const closed = sl.trades.filter((t) => t.r != null)
  const wr = closed.length ? closed.filter((t) => (t.r as number) > 0).length / closed.length : null
  return (
    <NnCard title="Recent Trades" icon={NI.list} className="nn-rt"
      right={<span className="nn-chip">{closed.length} closed{wr != null ? ' · ' + Math.round(wr * 100) + '% win' : ''}</span>}>
      {SERVER_BOT && (
        <div className="nn-seg nn-seg-full">
          <button type="button" className={src === 'app' ? 'on' : ''} onClick={() => setSrc('app')}>This browser</button>
          <button type="button" className={src === 'bot' ? 'on' : ''} onClick={() => setSrc('bot')}>Server bot · testnet</button>
        </div>
      )}
      <div className="nn-tbl">
        <table>
          <thead><tr><th>Pair</th><th>Side</th><th>Result</th><th>R</th><th>P/L {src === 'app' ? `(${sl.config.leverage}x)` : ''}</th></tr></thead>
          <tbody>
            {src === 'app'
              ? list.map((t) => <TradeRow key={t.id} t={t} lev={sl.config.leverage} />)
              : (bot ?? []).slice(0, 9).map((t) => (
                  <tr key={t.id}>
                    <td><b>{pair(t.symbol)}</b><small>{t.mode}</small></td>
                    <td className={t.side === 1 ? 'up' : 'dn'}>{t.side === 1 ? 'Long' : 'Short'}</td>
                    <td className={t.status === 'open' ? 'a' : (t.pnl_usd ?? 0) > 0 ? 'up' : 'dn'}>{t.status === 'open' ? 'Open' : (t.pnl_usd ?? 0) > 0 ? 'Win' : 'Loss'}</td>
                    <td>{t.r_multiple != null ? t.r_multiple.toFixed(2) + 'R' : '—'}</td>
                    <td className={(t.pnl_usd ?? 0) >= 0 ? 'up' : 'dn'}>{t.pnl_usd != null ? '$' + t.pnl_usd.toFixed(2) : '—'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
        {src === 'app' && !list.length && <p className="nn-empty">No trades yet. The engine opens one when a setup clears its bar — scalps on 15m bars, swings on 4h.</p>}
        {src === 'bot' && bot && !bot.length && <p className="nn-empty">No server-bot trades recorded yet.</p>}
      </div>
      <button type="button" className="nn-link" onClick={() => w.switchTab?.('selflearn')}>View all trades <Ico d={NI.arrow} size={13} /></button>
    </NnCard>
  )
}

// ---- learning log, journal, goals --------------------------------------------------------

const KIND_ICON: Record<string, string> = {
  train: NI.cpu, open: NI.play, close: NI.flag, learn: NI.brain, risk: NI.shield, info: NI.bolt, error: NI.close,
}

export function LearningLog() {
  const now = useTick(20000, NN)
  const sl = useSL()
  const list = sl.events.slice(-5).reverse()
  return (
    <NnCard title="AI Learning Log" icon={NI.brain} className="nn-log"
      right={<button type="button" className="nn-chip nn-chip-btn" onClick={() => w.switchTab?.('selflearn')}>View all <Ico d={NI.arrow} size={11} /></button>}>
      <ul className="nn-logl">
        {list.map((e) => (
          <li key={e.id} className={'k-' + e.kind}>
            <span className="nn-logi"><Ico d={KIND_ICON[e.kind] ?? NI.bolt} size={13} /></span>
            <span><b>{e.title}</b><small>{e.msg}</small></span>
            <em>{ago(e.t, now)}</em>
          </li>
        ))}
        {!list.length && <li className="nn-empty">The engine writes here as it trains, trades and learns.</li>}
      </ul>
    </NnCard>
  )
}

export function Journal() {
  const sl = useSL()
  const list = sl.trades.filter((t) => t.closedAt != null).sort((a, b) => (b.closedAt as number) - (a.closedAt as number)).slice(0, 5)
  return (
    <NnCard title="Journal & Insights" icon={NI.book} className="nn-jr"
      right={<button type="button" className="nn-chip nn-chip-btn" onClick={() => w.switchTab?.('selflearn')}>View all <Ico d={NI.arrow} size={11} /></button>}>
      <div className="nn-tbl">
        <table>
          <thead><tr><th>Date</th><th>Pair</th><th>Setup</th><th>Result</th><th>Notes</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.closedAt as number).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                <td><b>{short(t.sym)}</b><small>{t.side === 1 ? 'Long' : 'Short'} · {STRATS[t.strat].label}</small></td>
                <td>{t.setup}</td>
                <td className={(t.r ?? 0) > 0 ? 'up' : 'dn'}>{(t.r ?? 0) >= 0 ? '+' : ''}{(t.r ?? 0).toFixed(2)}R</td>
                <td className="nn-jr-n">{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="nn-empty">Each closed trade is journaled here with its setup and conditions.</p>}
      </div>
    </NnCard>
  )
}

export function NextGoals() {
  const sl = useSL()
  const closed = sl.trades.filter((t) => t.r != null && t.reason !== 'manual')
  const wr = closed.length ? closed.filter((t) => (t.r as number) > 0).length / closed.length : 0
  const days = new Set(closed.map((t) => new Date(t.closedAt as number).toDateString())).size
  const models = Object.values(sl.models)
  const edge = models.filter(proven).length
  const goals: Array<[string, number, string]> = [
    ['Win rate to 55%', wr / 0.55, Math.round(wr * 100) + '%'],
    ['100 recorded trades', closed.length / 100, String(closed.length)],
    ['Journal on 30 days', days / 30, days + ' d'],
    ['Every model shows an edge', models.length ? edge / models.length : 0, `${edge}/${models.length || '—'}`],
  ]
  return (
    <NnCard title="Next Goals" icon={NI.target} className="nn-goals">
      <ul className="nn-goall">
        {goals.map(([l, f, v]) => (
          <li key={l} className={f >= 1 ? 'done' : ''}>
            <span className="nn-goalc"><Ico d={NI.check} size={11} /></span>
            <b>{l}</b>
            <Bar v={f} cls="g" />
            <em>{v}</em>
          </li>
        ))}
      </ul>
    </NnCard>
  )
}

export function BrainCard() {
  const sl = useSL()
  const busy = !!sl.busy || sl.status === 'warming'
  const models = Object.values(sl.models)
  const updates = models.reduce((a, m) => a + m.updates, 0)
  return (
    <section className="card nn-card nn-braincard">
      <Brain busy={busy} size={190} />
      <blockquote>
        <p>“Every trade teaches me something. I just learn faster than you.”</p>
        <footer>
          {sl.busy ? `Training ${sl.busy}…` : `${models.length} models · ${updates} live updates`}
          <span className={'nn-dot' + (sl.status === 'running' ? ' on' : '')} />
        </footer>
      </blockquote>
    </section>
  )
}

export function NnFooter() {
  const sl = useSL()
  return (
    <div className="nn-foot">
      <span>Liquidity Radar · AI powered · real market data · self learning · paper trading only</span>
      <span className="nn-pill on"><i />Live</span>
      <span className={'nn-pill' + (sl.config.auto ? ' on' : '')}><i />Auto scan: {sl.config.auto ? 'ON' : 'OFF'}</span>
    </div>
  )
}
