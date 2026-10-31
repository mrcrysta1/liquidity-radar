// The toolbar's "more" menu beside the camera: export the chart's data as CSV
// (visible bars or everything loaded: time in the chart's zone, OHLCV and every
// shown indicator output) and open the chart in a window of its own.
import { useEffect, useRef, useState } from 'react'
import { useFitMenu } from './useFitMenu'
import { chartVisibleRange } from '../../features/charts/chartRender'
import { displayCandles } from '../../features/charts/series/rangeView'
import { indicatorColumns } from '../../features/charts/indicators/render'
import { buildChartCsv, csvFileName } from '../../features/charts/dataExport'
import type { ExportColumn } from '../../features/charts/dataExport'
import { chartZone, tzOffsetMinutes } from '../../features/charts/timezone'
import { getTimeframe } from '../../features/charts/timeframes'
import { isPopout, openPopout } from '../../features/charts/popout'
import { state } from '../../services/store'
import { showToast } from '../../utils/dom'

function exportCsv(visibleOnly: boolean): void {
  const bars = displayCandles()
  if (!bars.length) {
    showToast('Chart is not ready yet')
    return
  }
  const times = bars.map((b) => b.t)
  const columns: ExportColumn[] = indicatorColumns(bars).map((c) => ({ ...c, times }))
  const r = visibleOnly ? chartVisibleRange() : null
  const zone = chartZone()
  const csv = buildChartCsv({
    bars,
    columns,
    from: r ? r.from * 1000 : undefined,
    to: r ? r.to * 1000 : undefined,
    offsetOf: (ms) => tzOffsetMinutes(zone, ms),
  })
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = csvFileName(state.symbol, getTimeframe(), Date.now())
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ChartDataMenu() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useFitMenu(menuRef, open)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div className="r4d-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className={'chart-tool-btn tvb-icon' + (open ? ' open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Export data and more"
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="tvb-tip">Export data · new window</span>
      </button>
      {open && (
        <div className="r4d-menu" role="menu" ref={menuRef}>
          <button type="button" role="menuitem" onClick={run(() => exportCsv(true))}>
            Export chart data… <small>visible bars · CSV</small>
          </button>
          <button type="button" role="menuitem" onClick={run(() => exportCsv(false))}>
            Export all loaded bars… <small>CSV</small>
          </button>
          {!isPopout() && (
            <button type="button" role="menuitem" onClick={run(openPopout)}>
              Open chart in new window <small>synced</small>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
