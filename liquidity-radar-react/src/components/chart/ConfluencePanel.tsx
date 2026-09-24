// Compact horizontal strip: one chip per timeframe, colored by whether RSI +
// MACD + price-vs-EMA20 agree bullish/bearish/neutral there — so alignment
// (or disagreement) across timeframes is visible without switching tabs.
import { useEffect, useState } from 'react'
import {
  confluenceSummary,
  getConfluenceRows,
  onConfluenceChange,
} from '../../features/analysis/confluence'
import type { ConfluenceRow, Verdict } from '../../features/analysis/confluence'
import { getShowConfluence, onOverlayTogglesChange, setShowConfluence } from '../../features/charts/overlayToggles'

const VERDICT_COLOR: Record<Verdict, string> = {
  bull: 'var(--green)',
  bear: 'var(--red)',
  neutral: 'var(--muted)',
}
const VERDICT_BG: Record<Verdict, string> = {
  bull: 'rgba(0,230,118,.1)',
  bear: 'rgba(255,23,68,.1)',
  neutral: 'transparent',
}
const VERDICT_LABEL: Record<Verdict, string> = { bull: 'BULL', bear: 'BEAR', neutral: 'FLAT' }

function Chip({ row }: { row: ConfluenceRow }) {
  const color = VERDICT_COLOR[row.verdict]
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: '5px 10px',
        borderRadius: 8,
        border: '1px solid ' + (row.loading ? 'var(--border)' : color),
        background: row.loading ? 'transparent' : VERDICT_BG[row.verdict],
        minWidth: 54,
        opacity: row.loading ? 0.5 : 1,
      }}
      title={
        row.loading
          ? 'Loading…'
          : `RSI ${row.rsi.toFixed(0)} · MACD hist ${row.macdHist >= 0 ? '+' : ''}${row.macdHist.toFixed(4)} · ${row.trendPct >= 0 ? '+' : ''}${row.trendPct.toFixed(2)}% vs EMA20`
      }
    >
      <span style={{ fontSize: 10, opacity: 0.7 }}>{row.tf}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: row.loading ? 'var(--muted)' : color }}>
        {row.loading ? '···' : VERDICT_LABEL[row.verdict]}
      </span>
    </div>
  )
}

export function ConfluencePanel() {
  const [rows, setRows] = useState(getConfluenceRows())
  const [show, setShow] = useState(getShowConfluence())

  useEffect(() => {
    const off1 = onConfluenceChange(() => setRows([...getConfluenceRows()]))
    const off2 = onOverlayTogglesChange(() => setShow(getShowConfluence()))
    return () => {
      off1()
      off2()
    }
  }, [])

  if (!show) return null
  const summary = confluenceSummary()

  return (
    <div
      className="card"
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="sec-title" style={{ fontSize: 12 }}>
          Confluence
        </span>
        <span style={{ fontSize: 10, color: VERDICT_COLOR[summary], fontWeight: 700 }}>
          {VERDICT_LABEL[summary]}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {rows.map((r) => (
          <Chip key={r.tf} row={r} />
        ))}
      </div>
      <button
        type="button"
        className="chart-tool-btn"
        title="Hide confluence panel"
        style={{ marginLeft: 'auto' }}
        onClick={() => setShowConfluence(false)}
      >
        ✕
      </button>
    </div>
  )
}
