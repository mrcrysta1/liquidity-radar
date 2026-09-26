// Legend for the whale bubbles on the price chart: buy/sell colours, the
// bubble-size scale, the minimum order size shown, and exactly how much of the
// tape has been scanned — so a quiet stretch of chart is never mistaken for
// one with no whales in it.
import { useEffect, useState } from 'react'
import { cfmt } from '../../utils/format'
import {
  WHALE_MULTS,
  canScanFurther,
  getWhaleView,
  onWhaleFlowChange,
  scanFurther,
  setWhaleMult,
} from '../../features/whales/whaleFlow'
import { bubbleRadius } from '../../features/whales/whaleMath'
import { getShowWhaleBubbles, onOverlayTogglesChange } from '../../features/charts/overlayToggles'

function since(t: number): string {
  const d = new Date(t)
  const today = new Date()
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === today.toDateString()
    ? hm
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hm
}

export function WhaleLegend() {
  const [, force] = useState(0)
  useEffect(() => {
    const a = onWhaleFlowChange(() => force((n) => n + 1))
    const b = onOverlayTogglesChange(() => force((n) => n + 1))
    return () => {
      a()
      b()
    }
  }, [])

  const v = getWhaleView()
  if (!getShowWhaleBubbles() || !v.auto) return null

  const scale = [1, 5, 25].map((k) => v.min * k)
  const first = v.coverage.length ? Math.min(...v.coverage.map((c) => c.t0)) : 0
  // Holes under a minute are a reconnect being refilled, not a real gap.
  const cov = v.coverage.slice().sort((x, y) => x.t0 - y.t0)
  let gaps = 0
  for (let i = 1; i < cov.length; i++) if (cov[i].t0 - cov[i - 1].t1 > 60_000) gaps++
  const shown = v.orders.filter((o) => o.usd >= v.min).length

  return (
    <div className="whale-legend" role="group" aria-label="Whale orders legend">
      <div className="wl-row">
        <b className="wl-title">Whale orders</b>
        <span className="wl-key buy">Buy</span>
        <span className="wl-key sell">Sell</span>
        <label className="wl-min">
          <span className="sr-only">Minimum order size</span>
          <select value={v.mult} onChange={(e) => setWhaleMult(Number(e.target.value))}>
            {WHALE_MULTS.map((m) => (
              <option key={m} value={m}>
                ≥ {cfmt(v.auto * m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="wl-row wl-scale" aria-hidden="true">
        {scale.map((usd) => {
          const r = Math.min(11, bubbleRadius(usd, v.min))
          return (
            <span key={usd} className="wl-dot">
              <svg width={r * 2 + 2} height={r * 2 + 2}>
                <circle cx={r + 1} cy={r + 1} r={r} />
              </svg>
              {cfmt(usd)}
            </span>
          )
        })}
      </div>
      <div className="wl-row wl-cov">
        {v.loading ? <i className="wl-spin" aria-hidden="true" /> : null}
        <span>
          {first ? 'Scanned from ' + since(first) : 'Scanning trades…'}
          {gaps ? ' · ' + gaps + (gaps === 1 ? ' gap' : ' gaps') : ''}
          {' · '}
          {shown} orders
        </span>
        {canScanFurther() && (
          <button
            type="button"
            className="wl-more"
            title="Fetch older trades from Binance (about 16 MB of data)"
            onClick={scanFurther}
          >
            Scan <span className="wl-more-long">further </span>back
          </button>
        )}
      </div>
    </div>
  )
}
