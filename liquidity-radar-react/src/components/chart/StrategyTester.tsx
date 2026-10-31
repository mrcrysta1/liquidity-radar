// Strategy Tester: the results of a Pine strategy() on the chart — summary
// figures, the equity curve and the list of trades — in a panel docked to
// the bottom of the window, like TradingView's tester. Opened from the Pine
// editor (PinePanel) through mountStrategyTester, in a React root of its own
// so it stays open when the indicator menu that opened it closes. It follows
// the script's live runs (every new bar re-runs the backtest in the worker).
import { useEffect, useRef, useState } from 'react'
import { onPineResult, pineStatus, subscribePine } from '../../features/charts/pine/indicator'
import type { IndicatorStore } from '../../features/charts/indicators/store'
import type { StrategyReport, StrategyTrade } from '../../features/charts/pine/runtime'

/** Rows drawn in the trade list; a long backtest keeps the newest. */
const MAX_ROWS = 500

const fmt = (v: number, d = 2) =>
  isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'
const fmtQty = (v: number) => (Math.abs(v) >= 100 ? fmt(v, 0) : fmt(v, v % 1 ? 4 : 0))
const fmtTime = (t?: number) => {
  if (t == null) return '—'
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const sign = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : '')

function EquityCurve({ equity, base }: { equity: Array<number | null>; base: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const draw = () => {
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (!w || !h) return
      const dpr = window.devicePixelRatio || 1
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const ctx = cv.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const pts: Array<[number, number]> = []
      equity.forEach((v, i) => {
        if (v != null && isFinite(v)) pts.push([i, v])
      })
      if (pts.length < 2) return
      let lo = base
      let hi = base
      for (const [, v] of pts) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      if (hi === lo) hi = lo + 1
      const pad = 6
      const x0 = pts[0][0]
      const xs = (i: number) => pad + ((i - x0) / (pts[pts.length - 1][0] - x0 || 1)) * (w - pad * 2)
      const ys = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2)
      const css = getComputedStyle(cv)
      const up = css.getPropertyValue('--green').trim() || '#089981'
      const down = css.getPropertyValue('--red').trim() || '#f23645'
      const dim = css.getPropertyValue('--dim').trim() || '#787b86'
      // The starting capital, as the line the curve is judged against.
      ctx.strokeStyle = dim
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(pad, ys(base))
      ctx.lineTo(w - pad, ys(base))
      ctx.stroke()
      ctx.setLineDash([])
      const last = pts[pts.length - 1][1]
      const col = last >= base ? up : down
      ctx.beginPath()
      pts.forEach(([i, v], k) => (k ? ctx.lineTo(xs(i), ys(v)) : ctx.moveTo(xs(i), ys(v))))
      ctx.strokeStyle = col
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.lineTo(xs(pts[pts.length - 1][0]), ys(base))
      ctx.lineTo(xs(pts[0][0]), ys(base))
      ctx.closePath()
      ctx.globalAlpha = 0.12
      ctx.fillStyle = col
      ctx.fill()
      ctx.globalAlpha = 1
    }
    draw()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null
    ro?.observe(cv)
    return () => ro?.disconnect()
  }, [equity, base])
  return <canvas ref={ref} className="st-equity" aria-label="Equity curve" role="img" />
}

function Summary({ rep }: { rep: StrategyReport }) {
  const s = rep.summary
  const cells: Array<[string, string, string?, string?]> = [
    ['Net profit', fmt(s.netProfit), fmt(s.netProfitPct) + '%', sign(s.netProfit)],
    ['Total trades', String(s.totalTrades), s.wins + ' W / ' + s.losses + ' L'],
    ['Win rate', fmt(s.winRate) + '%'],
    ['Profit factor', s.profitFactor == null ? (s.grossProfit > 0 ? '∞' : '—') : fmt(s.profitFactor, 3)],
    ['Max drawdown', fmt(s.maxDrawdown), fmt(s.maxDrawdownPct) + '%', s.maxDrawdown ? 'down' : ''],
    ['Avg trade', fmt(s.avgTrade), fmt(s.avgTradePct) + '%', sign(s.avgTrade)],
    ['Open P&L', fmt(s.openPL), undefined, sign(s.openPL)],
    ['Commission', fmt(s.commission)],
    ['Buy & hold', fmt(s.buyHoldPct) + '%', undefined, sign(s.buyHoldPct)],
  ]
  return (
    <div className="st-summary">
      {cells.map(([k, v, sub, cls]) => (
        <div className="st-cell" key={k}>
          <span className="st-k">{k}</span>
          <b className={'st-v ' + (cls || '')}>{v}</b>
          {sub ? <span className={'st-sub ' + (cls || '')}>{sub}</span> : null}
        </div>
      ))}
    </div>
  )
}

function Trades({ trades }: { trades: StrategyTrade[] }) {
  const rows = trades.map((t, i) => ({ t, n: i + 1 })).reverse().slice(0, MAX_ROWS)
  if (!rows.length) return <div className="st-empty">No trades on these bars yet.</div>
  return (
    <div className="st-trades" role="region" aria-label="List of trades" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Type</th>
            <th>Entry</th>
            <th>Exit</th>
            <th className="num">Qty</th>
            <th className="num">Profit</th>
            <th className="num">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, n }) => (
            <tr key={n}>
              <td>{n}</td>
              <td className={t.dir === 'long' ? 'up' : 'down'}>
                {t.dir === 'long' ? 'Long' : 'Short'}
                {t.open ? <em> open</em> : null}
              </td>
              <td>
                <span className="st-id">{t.entryId}</span> {fmtTime(t.entryTime)}
                <br />
                {fmt(t.entryPrice, t.entryPrice < 1 ? 6 : 2)}
              </td>
              <td>
                {t.open ? (
                  '—'
                ) : (
                  <>
                    <span className="st-id">{t.exitId}</span> {fmtTime(t.exitTime)}
                    <br />
                    {fmt(t.exitPrice ?? NaN, (t.exitPrice ?? 0) < 1 ? 6 : 2)}
                  </>
                )}
              </td>
              <td className="num">{fmtQty(t.qty)}</td>
              <td className={'num ' + sign(t.profit)}>{fmt(t.profit)}</td>
              <td className={'num ' + sign(t.profit)}>{fmt(t.profitPct)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StrategyTester({
  store,
  uid,
  onClose,
}: {
  store: IndicatorStore
  uid: string
  onClose: () => void
}) {
  const [, force] = useState(0)
  const [tab, setTab] = useState<'overview' | 'trades'>('overview')
  useEffect(() => {
    const bump = () => force((n) => n + 1)
    const offs = [subscribePine(bump), onPineResult(bump), store.subscribe(bump)]
    return () => offs.forEach((off) => off())
  }, [store])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const inst = store.getIndicators().find((i) => i.uid === uid)
  const status = inst ? pineStatus(inst) : null
  const rep = status?.strategy

  return (
    <section className="st-panel" role="dialog" aria-label="Strategy Tester">
      <header className="st-head">
        <b>Strategy Tester</b>
        <span className="st-title">{status?.title ?? ''}</span>
        <div className="st-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'overview'}
            className={tab === 'overview' ? 'on' : ''}
            onClick={() => setTab('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'trades'}
            className={tab === 'trades' ? 'on' : ''}
            onClick={() => setTab('trades')}
          >
            List of trades{rep ? ' (' + rep.trades.length + ')' : ''}
          </button>
        </div>
        <button type="button" className="st-close" aria-label="Close Strategy Tester" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M6 6 18 18M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="st-body">
        {!inst ? (
          <div className="st-empty">The strategy was removed from the chart.</div>
        ) : status?.error ? (
          <div className="st-empty err">{status.error}</div>
        ) : !rep ? (
          <div className="st-empty">
            This script is not a strategy — declare it with strategy() to backtest it.
          </div>
        ) : tab === 'overview' ? (
          <>
            <Summary rep={rep} />
            <EquityCurve equity={rep.equity} base={rep.summary.initialCapital} />
            <div className="st-note">
              Market orders fill at the next bar&apos;s open; stops and limits where the bar first
              reaches them (open → nearer extreme → farther extreme → close).
            </div>
          </>
        ) : (
          <Trades trades={rep.trades} />
        )}
      </div>
    </section>
  )
}
