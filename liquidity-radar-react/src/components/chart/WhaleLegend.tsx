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
import { bubbleRadius, whaleLegendCompact } from '../../features/whales/whaleMath'
import { getShowWhaleBubbles, onOverlayTogglesChange } from '../../features/charts/overlayToggles'

// Narrow charts: sit above the zoom/reset buttons (time axis + 8px + button row).
const LIFTED = { bottom: 74 } as const
const CHIP_BTN = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  minHeight: 24,
  padding: '0 4px',
  background: 'transparent',
  border: 'none',
  color: 'var(--txt)',
  font: 'inherit',
  fontWeight: 700,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
} as const

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
  // Clock for the collector-heartbeat check, ticked rather than read in render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    const a = onWhaleFlowChange(() => force((n) => n + 1))
    const b = onOverlayTogglesChange(() => force((n) => n + 1))
    return () => {
      a()
      b()
    }
  }, [])

  // On a narrow chart the full legend covers the zoom/reset buttons: it
  // collapses to a one-line chip above them that expands on tap.
  const [chartW, setChartW] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const wrap = document.getElementById('chartWrap')
    if (!wrap || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setChartW(wrap.clientWidth))
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])
  const compact = whaleLegendCompact(chartW)

  const v = getWhaleView()
  if (!getShowWhaleBubbles() || !v.auto) return null

  const scale = [1, 5, 25].map((k) => v.min * k)
  const first = v.coverage.length ? Math.min(...v.coverage.map((c) => c.t0)) : 0
  // Holes under a minute are a reconnect being refilled, not a real gap.
  const cov = v.coverage.slice().sort((x, y) => x.t0 - y.t0)
  let gaps = 0
  for (let i = 1; i < cov.length; i++) if (cov[i].t0 - cov[i - 1].t1 > 60_000) gaps++
  const shown = v.orders.filter((o) => o.usd >= v.min).length
  // The collector writes a heartbeat every ~10s; two minutes of silence means it stopped.
  const stale = v.server && Math.max(now, v.serverUpdated) - v.serverUpdated > 120_000

  if (compact && !open)
    return (
      <div
        className="whale-legend"
        role="group"
        aria-label="Whale orders legend"
        style={{ ...LIFTED, padding: '2px 4px', maxWidth: 'calc(100% - 90px)' }}
      >
        <button
          type="button"
          style={CHIP_BTN}
          aria-expanded={false}
          title="Show the whale orders legend"
          onClick={() => setOpen(true)}
        >
          {v.loading ? <i className="wl-spin" aria-hidden="true" /> : null}
          <span>Whales ≥ {cfmt(v.min)}</span>
          <span style={{ color: 'var(--dim)' }}>· {shown} orders</span>
        </button>
      </div>
    )

  return (
    <div
      className="whale-legend"
      role="group"
      aria-label="Whale orders legend"
      style={compact ? LIFTED : undefined}
    >
      <div className="wl-row">
        {compact && (
          <button
            type="button"
            style={{ ...CHIP_BTN, padding: '0 4px', marginLeft: 'auto', order: 9 }}
            aria-expanded={true}
            aria-label="Collapse the whale orders legend"
            title="Collapse"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        )}
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
        {v.server && (
          <i
            className={'wl-srv' + (stale ? ' off' : '')}
            title={
              stale
                ? 'History collector last seen ' + since(v.serverUpdated)
                : 'History from the 24/7 collector'
            }
          >
            {stale ? 'collector offline' : 'server'}
          </i>
        )}
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
