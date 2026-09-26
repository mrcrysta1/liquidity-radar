// The Neural Net page's main chart card. One lightweight-charts instance
// shows candles, volume and RSI(14), the forecast path with its error band,
// the engine's trades on this market (entries as markers, open trades as
// stop / entry / target lines), and Fibonacci levels on the Fibonacci view.
// The other views reuse the app's own panels: the liquidation heatmap, order
// flow, and a sentiment panel; Backtest runs the engine's own backtester.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts'
import type { IChartApi, IPriceLine, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'
import { instrumentOf } from '../../constants/instruments'
import { pfmt } from '../../utils/format'
import { chartTheme } from '../../features/charts/chartRender'
import { series } from '../../features/selflearn/features'
import { fibSwing } from '../../features/selflearn/patterns'
import { getFeed, labelBars, retainFeed, tfMs, useFeed } from '../../features/selflearn/pageFeed'
import { STRATS } from '../../features/selflearn/strategy'
import type { StratId } from '../../features/selflearn/strategy'
import { runBt } from '../../features/selflearn/engine'
import { useSL } from '../../features/selflearn/useSL'
import { OrderFlow } from '../analysis/AnalysisViews'
import { EquityCurve, Ico, SentimentPanel } from './parts'
import { NI } from './icons'

const LiqHeatmap = lazy(() => import('../analysis/LiqHeatmap').then((m) => ({ default: m.LiqHeatmap })))
const w = window as unknown as { switchTab?: (t: string) => void }

type View = 'live' | 'ai' | 'bt' | 'heat' | 'flow' | 'sent' | 'fib'
const VIEWS: Array<[View, string, string]> = [
  ['live', 'Live Chart', NI.chart],
  ['ai', 'AI Prediction', NI.brain],
  ['bt', 'Backtest', NI.flask],
  ['heat', 'Heatmap', NI.fire],
  ['flow', 'Order Flow', NI.flow],
  ['sent', 'Sentiment', NI.gauge],
  ['fib', 'Fibonacci', NI.fib],
]
const sec = (t: number) => Math.floor(t / 1000) as UTCTimestamp
const pair = (s: string) => (instrumentOf(s) ? s : baseOf(s) + '/USDT')

function Tool({ label, icon, on, onClick }: { label: string; icon: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} className={on ? 'on' : ''} onClick={onClick}>
      <Ico d={icon} size={16} />
    </button>
  )
}

function ChartPane({ view, full, setFull }: { view: View; full: boolean; setFull: (f: boolean | ((x: boolean) => boolean)) => void }) {
  const feed = useFeed()
  const sl = useSL()
  const wrap = useRef<HTMLDivElement>(null)
  const refs = useRef<{
    chart: IChartApi
    candles: ISeriesApi<'Candlestick'>
    vol: ISeriesApi<'Histogram'>
    rsi: ISeriesApi<'Line'>
    pred: ISeriesApi<'Line'>
    hi: ISeriesApi<'Line'>
    lo: ISeriesApi<'Line'>
    lines: IPriceLine[]
  } | null>(null)
  const [magnet, setMagnet] = useState(false)

  // Build once.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const th = chartTheme()
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: th.txt, fontSize: 11 },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.grid, scaleMargins: { top: 0.06, bottom: 0.34 } },
      timeScale: { borderColor: th.grid, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
    })
    const candles = chart.addCandlestickSeries({
      upColor: th.up, downColor: th.dn, wickUpColor: th.up, wickDownColor: th.dn, borderVisible: false,
    })
    const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.68, bottom: 0.18 }, visible: false })
    const rsi = chart.addLineSeries({ priceScaleId: 'rsi', color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.85, bottom: 0.01 } })
    rsi.createPriceLine({ price: 70, color: 'rgba(255,77,94,.45)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    rsi.createPriceLine({ price: 30, color: 'rgba(34,224,138,.45)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' })
    const pred = chart.addLineSeries({ color: '#d06bff', lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: true, title: 'Predicted' })
    const band = { color: 'rgba(208,107,255,.35)', lineWidth: 1 as const, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false }
    const hi = chart.addLineSeries(band)
    const lo = chart.addLineSeries(band)
    refs.current = { chart, candles, vol, rsi, pred, hi, lo, lines: [] }
    // Follow the light / dark switch.
    const mo = new MutationObserver(() => {
      const t = chartTheme()
      chart.applyOptions({
        layout: { textColor: t.txt },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      })
      candles.applyOptions({ upColor: t.up, downColor: t.dn, wickUpColor: t.up, wickDownColor: t.dn })
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
    return () => {
      mo.disconnect()
      chart.remove()
      refs.current = null
    }
  }, [])

  // Full data on every reload.
  useEffect(() => {
    const r = refs.current
    const cs = getFeed().candles
    if (!r || !cs.length) return
    const th = chartTheme()
    r.candles.setData(cs.map((k) => ({ time: sec(k.t), open: k.o, high: k.h, low: k.l, close: k.c })))
    r.vol.setData(cs.map((k) => ({ time: sec(k.t), value: k.v, color: k.c >= k.o ? th.up + '66' : th.dn + '66' })))
    const S = series(cs)
    r.rsi.setData(cs.slice(15).map((k, i) => ({ time: sec(k.t), value: S.rsi[i + 15] })))
    r.chart.timeScale().setVisibleLogicalRange({ from: cs.length - 140, to: cs.length + 18 })
  }, [feed.dataGen])

  // The forming bar, on every tick.
  const last = feed.candles[feed.candles.length - 1]
  useEffect(() => {
    const r = refs.current
    if (!r || !last) return
    r.candles.update({ time: sec(last.t), open: last.o, high: last.h, low: last.l, close: last.c })
  }, [last])

  // Forecast path, anchored at the live price.
  const fc = feed.fc
  useEffect(() => {
    const r = refs.current
    if (!r) return
    const show = view === 'live' || view === 'ai'
    if (!fc || !show || !last) {
      r.pred.setData([])
      r.hi.setData([])
      r.lo.setData([])
      return
    }
    const k = last.c / fc.path[0].price
    const ms = tfMs(feed.tf)
    const t0 = fc.path[0].t
    // Future bars start after the forming one; keep times strictly increasing.
    const pts = fc.path.map((p, i) => ({ t: i === 0 ? last.t : Math.max(t0 + (p.t - t0), last.t + i * ms), p }))
    r.pred.setData(pts.map(({ t, p }) => ({ time: sec(t), value: p.price * k })))
    if (view === 'ai') {
      r.hi.setData(pts.map(({ t, p }) => ({ time: sec(t), value: p.hi * k })))
      r.lo.setData(pts.map(({ t, p }) => ({ time: sec(t), value: p.lo * k })))
    } else {
      r.hi.setData([])
      r.lo.setData([])
    }
  }, [fc, view, last, feed.tf])

  // Engine trades on this market, and Fibonacci levels.
  const mine = sl.trades.filter((t) => t.sym === feed.sym)
  const tradeKey = mine.map((t) => t.id + (t.closedAt ?? '')).join()
  useEffect(() => {
    const r = refs.current
    if (!r) return
    r.lines.forEach((l) => r.candles.removePriceLine(l))
    r.lines = []
    const cs = getFeed().candles
    if (!cs.length) return
    const ms = tfMs(getFeed().tf)
    const first = cs[0].t
    const markers = mine
      .filter((t) => t.openedAt >= first)
      .map((t) => ({
        time: sec(Math.floor(t.openedAt / ms) * ms) as Time,
        position: t.side === 1 ? ('belowBar' as const) : ('aboveBar' as const),
        color: t.side === 1 ? '#22e08a' : '#ff4d5e',
        shape: t.side === 1 ? ('arrowUp' as const) : ('arrowDown' as const),
        text: (t.side === 1 ? 'L ' : 'S ') + STRATS[t.strat].label,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))
    r.candles.setMarkers(markers)
    mine
      .filter((t) => t.closedAt == null)
      .forEach((t) => {
        const add = (price: number, color: string, title: string) =>
          r.lines.push(r.candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title }))
        add(t.entry, '#8fa0b5', 'Entry')
        add(t.sl, '#ff4d5e', 'SL')
        add(t.tp, '#22e08a', 'TP')
      })
    if (view === 'fib') {
      const f = fibSwing(cs)
      f?.levels.forEach((l) =>
        r.lines.push(
          r.candles.createPriceLine({
            price: l.price,
            color: l.r === 0.618 || l.r === 0.5 ? '#f5c542' : 'rgba(94,231,255,.7)',
            lineWidth: 1,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: 'Fib ' + (l.r * 100).toFixed(1) + '%',
          }),
        ),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeKey, view, feed.dataGen])

  useEffect(() => {
    refs.current?.chart.applyOptions({ crosshair: { mode: magnet ? CrosshairMode.Magnet : CrosshairMode.Normal } })
  }, [magnet])

  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [full, setFull])

  const zoom = (f: number) => {
    const ts = refs.current?.chart.timeScale()
    const rg = ts?.getVisibleLogicalRange()
    if (!ts || !rg) return
    const mid = (rg.from + rg.to) / 2
    const half = ((rg.to - rg.from) / 2) * f
    ts.setVisibleLogicalRange({ from: mid - half, to: mid + half })
  }
  const shot = () => {
    const c = refs.current?.chart.takeScreenshot()
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `${baseOf(feed.sym)}-${feed.tf}-neural.png`
    a.click()
  }
  const endPct = fc ? fc.pct[fc.pct.length - 1] : null
  const endPx = fc && last ? last.c * (1 + (endPct as number) / 100) : null
  const hz = fc ? fc.path.length - 1 : 0
  const fit = () => refs.current?.chart.timeScale().fitContent()
  const toLive = () => refs.current?.chart.timeScale().scrollToRealTime()
  return (
    <div className={'nn-pane' + (full ? ' nn-full' : '')}>
      <div className="nn-tools" role="toolbar" aria-label="Chart tools">
        <Tool label="Crosshair magnet" icon={NI.cross} on={magnet} onClick={() => setMagnet((m) => !m)} />
        <Tool label="Zoom in" icon={NI.zoomIn} onClick={() => zoom(0.7)} />
        <Tool label="Zoom out" icon={NI.zoomOut} onClick={() => zoom(1.4)} />
        <Tool label="Fit all bars" icon={NI.fit} onClick={fit} />
        <Tool label="Back to live" icon={NI.live} onClick={toLive} />
        <Tool label="Save as PNG" icon={NI.camera} onClick={shot} />
      </div>
      <div className="nn-plot">
        <div className="nn-legend">
          <b>{pair(feed.sym)} · {feed.tf} · {instrumentOf(feed.sym) ? 'Yahoo' : 'Binance'}</b>
          <span><i className="a" />Actual price</span>
          {(view === 'live' || view === 'ai') && <span><i className="p" />Predicted price</span>}
          {view === 'fib' && <span><i className="f" />Fibonacci on the last 120 bars</span>}
          <button type="button" className="nn-fs" title={full ? 'Exit full screen [Esc]' : 'Full screen'} aria-label="Full screen" onClick={() => setFull((f) => !f)}>
            <Ico d={full ? NI.close : NI.expand} size={15} />
          </button>
        </div>
        {(view === 'live' || view === 'ai') && endPx && (
          <div className="nn-predtag" title={`Ridge forecast ${hz} horizons ahead`}>
            <small>Predicted price · {fc?.path.length ? labelBars(16, feed.tf) : ''}</small>
            <b>${pfmt(endPx)}</b>
            <i className={(endPct as number) >= 0 ? 'up' : 'dn'}>({(endPct as number) >= 0 ? '+' : ''}{(endPct as number).toFixed(2)}%)</i>
          </div>
        )}
        <div className="nn-canvas" ref={wrap} />
        <div className="nn-panes"><span>Volume</span><span>RSI (14)</span></div>
        {feed.status === 'loading' && !feed.candles.length && <div className="nn-msg">Loading {feed.tf} candles…</div>}
        {feed.status === 'error' && <div className="nn-msg err">Chart unavailable: {feed.error}</div>}
      </div>
      {view === 'ai' && fc && (
        <div className="nn-hz">
          {fc.pct.map((p, i) => (
            <span key={i}>
              <small>{labelBars([1, 2, 4, 8, 16][i], feed.tf)}</small>
              <b className={p >= 0 ? 'up' : 'dn'}>{p >= 0 ? '+' : ''}{p.toFixed(2)}%</b>
            </span>
          ))}
          <em>Dotted band: typical error on unseen bars (±{fc.err4.toFixed(2)}% at 4 bars)</em>
        </div>
      )}
      {view === 'fib' && <FibTable />}
    </div>
  )
}

function FibTable() {
  const feed = useFeed()
  const f = fibSwing(feed.candles)
  const px = feed.candles[feed.candles.length - 1]?.c ?? 0
  if (!f) return null
  const near = f.levels.slice().sort((a, b) => Math.abs(a.price - px) - Math.abs(b.price - px))[0]
  return (
    <div className="nn-fib">
      <span className="nn-fib-h">{f.up ? 'Up-swing' : 'Down-swing'} ${pfmt(f.lo)} → ${pfmt(f.hi)}</span>
      {f.levels.map((l) => (
        <span key={l.r} className={l === near ? 'near' : ''}>
          <small>{(l.r * 100).toFixed(1)}%</small>
          <b>{pfmt(l.price)}</b>
        </span>
      ))}
    </div>
  )
}

function BacktestPane() {
  const sl = useSL()
  const feed = useFeed()
  const [strat, setStrat] = useState<StratId>('swing')
  const r = sl.bt.result
  const s = r?.stats
  const run = () =>
    void runBt({ sym: feed.sym || state.symbol, strat, bars: 3000, minEV: STRATS[strat].minEV, online: true, trainFrac: 0.5, riskPct: 1 })
  return (
    <div className="nn-btp">
      <div className="nn-btp-bar">
        <div className="nn-seg">
          {(Object.keys(STRATS) as StratId[]).map((k) => (
            <button key={k} type="button" className={strat === k ? 'on' : ''} onClick={() => setStrat(k)}>{STRATS[k].label}</button>
          ))}
        </div>
        <small>{STRATS[strat].blurb}</small>
        <button type="button" className="nn-btn" onClick={run} disabled={sl.bt.running}>
          <Ico d={NI.play} size={14} /> {sl.bt.running ? 'Running…' : 'Run backtest'}
        </button>
      </div>
      {sl.bt.error && <p className="nn-err">{sl.bt.error}</p>}
      {r && s ? (
        <>
          <p className="nn-btp-t">
            {pair(r.opts.sym)} · {r.st.label} · trained on {r.trainBars.toLocaleString()} bars, traded {r.testBars.toLocaleString()} unseen bars
            {r.opts.online ? ', learning from each trade' : ''}
          </p>
          <div className="nn-kpis">
            <span><small>Trades</small><b>{s.n}</b></span>
            <span><small>Win rate</small><b>{(s.winRate * 100).toFixed(1)}%</b></span>
            <span><small>Avg R</small><b className={s.avgR >= 0 ? 'up' : 'dn'}>{s.avgR >= 0 ? '+' : ''}{s.avgR.toFixed(2)}R</b></span>
            <span><small>Profit factor</small><b>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</b></span>
            <span><small>Max drawdown</small><b className="dn">{(s.maxDD * 100).toFixed(1)}%</b></span>
            <span><small>Return (1% risk)</small><b className={s.growth >= 0 ? 'up' : 'dn'}>{(s.growth * 100).toFixed(1)}%</b></span>
            <span><small>Buy &amp; hold</small><b className={r.hold >= 0 ? 'up' : 'dn'}>{(r.hold * 100).toFixed(1)}%</b></span>
            <span><small>Long / short</small><b>{s.long.n} / {s.short.n}</b></span>
          </div>
          <EquityCurve equity={s.equity} height={150} />
        </>
      ) : (
        !sl.bt.running && <p className="nn-empty">Replays the live engine’s exact rules over history: it trains on the first half, then trades the second half bar by bar.</p>
      )}
      <button type="button" className="nn-link" onClick={() => w.switchTab?.('selflearn')}>
        Open the Backtest Lab and full records <Ico d={NI.arrow} size={13} />
      </button>
    </div>
  )
}

export function NeuralChartCard() {
  const [view, setView] = useState<View>('live')
  // Full screen renders the chart at the page root, where no card's
  // backdrop filter or transform can trap a fixed element. The chart is
  // rebuilt there from the same feed, so nothing is lost in the move.
  const [full, setFull] = useState(false)
  useEffect(() => retainFeed(), [])
  const chartView = view === 'live' || view === 'ai' || view === 'fib'
  return (
    <section className="card nn-card nn-chartcard">
      <div className="nn-tabs" role="tablist" aria-label="Chart views">
        {VIEWS.map(([v, l, ic]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
            <Ico d={ic} size={14} /> {l}
            {v === 'ai' && <em className="nn-live">Live</em>}
          </button>
        ))}
      </div>
      <div className={'nn-panewrap' + (chartView ? '' : ' nn-hide')}>
        {full
          ? createPortal(<div className="nn-fullwrap"><ChartPane view={chartView ? view : 'live'} full setFull={setFull} /></div>, document.body)
          : <ChartPane view={chartView ? view : 'live'} full={false} setFull={setFull} />}
      </div>
      {view === 'bt' && <BacktestPane />}
      {view === 'heat' && (
        <div className="nn-embed">
          <Suspense fallback={<p className="nn-empty">Loading heatmap…</p>}>
            <LiqHeatmap />
          </Suspense>
        </div>
      )}
      {view === 'flow' && <div className="nn-embed"><OrderFlow tab="neuralnet" id="nnFlowView" /></div>}
      {view === 'sent' && <SentimentPanel />}
    </section>
  )
}
