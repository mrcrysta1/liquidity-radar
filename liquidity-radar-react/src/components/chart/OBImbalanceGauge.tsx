// Live bid/ask imbalance strip: how lopsided the book is within ±1% of mid,
// using the same bookMetrics() maths already computed for the Order Book
// side-tab. Polled rather than event-driven — state.ob is written straight
// from the depth WS stream (services/streams.ts) with no change hook, and a
// gauge like this reads fine refreshed a few times a second rather than on
// every individual book delta.
import { useEffect, useState } from 'react'
import { state } from '../../services/store'
import { bookMetrics } from '../../features/charts/sidePanels/metrics'
import type { Level } from '../../features/charts/sidePanels/metrics'
import { getShowOBGauge, onOverlayTogglesChange, setShowOBGauge } from '../../features/charts/overlayToggles'

const POLL_MS = 700
const BANDS = [0.005, 0.01, 0.02]
const BAND_LABEL: Record<number, string> = { 0.005: '±0.5%', 0.01: '±1%', 0.02: '±2%' }

function toLevels(rows: number[][] | undefined): Level[] {
  if (!rows) return []
  return rows.map((r) => ({ price: r[0], size: r[1] }))
}

export function OBImbalanceGauge() {
  const [imbalance, setImbalance] = useState<number | null>(null)
  const [spreadBps, setSpreadBps] = useState<number | null>(null)
  const [show, setShow] = useState(getShowOBGauge())
  const [band, setBand] = useState<number>(0.01)

  useEffect(() => onOverlayTogglesChange(() => setShow(getShowOBGauge())), [])

  useEffect(() => {
    if (!show) return
    const tick = () => {
      const ob = state.ob as { bids: number[][]; asks: number[][] } | null
      if (!ob) return
      const m = bookMetrics(toLevels(ob.bids), toLevels(ob.asks), band)
      if (!m) return
      setImbalance(m.imbalance1)
      setSpreadBps(m.spreadBps)
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [show, band])

  if (!show) return null
  const pct = imbalance == null ? 50 : ((imbalance + 1) / 2) * 100
  const label =
    imbalance == null
      ? '—'
      : Math.abs(imbalance) < 0.08
        ? 'Balanced'
        : imbalance > 0
          ? 'Bid-heavy'
          : 'Ask-heavy'
  const color = imbalance == null ? 'var(--muted)' : imbalance > 0.08 ? 'var(--green)' : imbalance < -0.08 ? 'var(--red)' : 'var(--muted)'

  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10 }}
      title="Bid vs ask depth within ±1% of mid price — a live spoofing/absorption read, not a directional signal on its own."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 }}>
        <span className="sec-title" style={{ fontSize: 12 }}>
          Book Imbalance
        </span>
        <span style={{ fontSize: 10, color, fontWeight: 700 }}>
          {label}
          {imbalance != null ? ' · ' + (imbalance * 100).toFixed(0) + '%' : ''}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          height: 8,
          borderRadius: 5,
          background: 'linear-gradient(90deg, rgba(255,23,68,.35), var(--sunk-2) 48%, var(--sunk-2) 52%, rgba(0,230,118,.35))',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: `calc(${pct}% - 5px)`,
            width: 10,
            height: 12,
            borderRadius: 3,
            background: color,
            transition: 'left .25s ease',
          }}
        />
      </div>
      <select
        value={band}
        onChange={(e) => setBand(Number(e.target.value))}
        className="chart-tool-btn"
        style={{ fontSize: 10, padding: '2px 4px' }}
        title="Depth band used for the imbalance read"
      >
        {BANDS.map((b) => (
          <option key={b} value={b}>
            {BAND_LABEL[b]}
          </option>
        ))}
      </select>
      <span style={{ fontSize: 10, color: 'var(--muted)', minWidth: 70, textAlign: 'right' }}>
        {spreadBps != null ? spreadBps.toFixed(1) + ' bps spread' : ''}
      </span>
      <button
        type="button"
        className="chart-tool-btn"
        title="Hide order-book imbalance gauge"
        onClick={() => setShowOBGauge(false)}
      >
        ✕
      </button>
    </div>
  )
}
