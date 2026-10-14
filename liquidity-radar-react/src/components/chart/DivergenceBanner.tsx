// Dismissible banner for the funding/OI divergence watcher
// (features/analysis/oiDivergence.ts) — only rendered when a condition is
// actually flagged, so it doesn't take up space the rest of the time.
import { useEffect, useState } from 'react'
import {
  dismissDivergenceAlert,
  getDivergenceAlert,
  onDivergenceChange,
} from '../../features/analysis/oiDivergence'

export function DivergenceBanner() {
  const [alert, setAlert] = useState(getDivergenceAlert())

  useEffect(() => onDivergenceChange(() => setAlert(getDivergenceAlert())), [])

  if (!alert) return null
  const color = alert.severity === 'warn' ? 'var(--red)' : 'var(--amber, #ffc107)'

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 12px',
        marginBottom: 10,
        borderLeft: '3px solid ' + color,
      }}
    >
      <span style={{ fontSize: 16, lineHeight: '18px' }}>{alert.severity === 'warn' ? '⚠️' : 'ℹ️'}</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{alert.title}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{alert.detail}</span>
      </div>
      <button
        type="button"
        className="chart-tool-btn"
        title="Dismiss"
        onClick={() => dismissDivergenceAlert()}
      >
        ✕
      </button>
    </div>
  )
}
