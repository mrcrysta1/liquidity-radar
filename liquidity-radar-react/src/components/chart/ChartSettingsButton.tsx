// The gear in the chart's right rail: TradingView's "Chart settings", for the
// display basics — grid, magnet crosshair, last-price line, bar countdown and
// watermark (features/charts/chartSettings).
import { useEffect, useRef, useState } from 'react'
import {
  chartSettings,
  resetChartSettings,
  setChartSetting,
  subscribeChartSettings,
} from '../../features/charts/chartSettings'
import type { ChartSettings } from '../../features/charts/chartSettings'

const ROWS: Array<{ key: keyof ChartSettings; label: string; hint: string }> = [
  { key: 'grid', label: 'Grid lines', hint: 'Horizontal and vertical lines behind the bars' },
  { key: 'magnet', label: 'Magnet crosshair', hint: 'The crosshair snaps to the bar’s close' },
  { key: 'priceLine', label: 'Last price line', hint: 'Dotted line at the live price' },
  { key: 'countdown', label: 'Bar countdown', hint: 'Time left in the bar, under the price label' },
  { key: 'watermark', label: 'Symbol watermark', hint: 'Symbol and interval faintly behind the chart' },
]

export function ChartSettingsButton() {
  const [, force] = useState(0)
  useEffect(() => subscribeChartSettings(() => force((n) => n + 1)), [])
  const ref = useRef<HTMLDialogElement>(null)
  const st = chartSettings()
  return (
    <>
      <button
        type="button"
        className="cs-rail-btn"
        aria-label="Chart settings"
        aria-haspopup="dialog"
        onClick={() => ref.current?.showModal()}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="cs-rail-tip">Chart settings</span>
      </button>
      <dialog
        ref={ref}
        className="cset-dialog"
        aria-label="Chart settings"
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === ref.current) ref.current?.close()
        }}
      >
        <header>
          <b>Chart settings</b>
          <button type="button" aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </header>
        <ul>
          {ROWS.map((r) => (
            <li key={r.key}>
              <label>
                <input
                  type="checkbox"
                  checked={st[r.key]}
                  onChange={(e) => setChartSetting(r.key, e.target.checked)}
                />
                <span>
                  <b>{r.label}</b>
                  <small>{r.hint}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <footer>
          <button type="button" className="cset-reset" onClick={resetChartSettings}>
            Reset to defaults
          </button>
          <button type="button" className="cset-done" onClick={() => ref.current?.close()}>
            Done
          </button>
        </footer>
      </dialog>
    </>
  )
}
