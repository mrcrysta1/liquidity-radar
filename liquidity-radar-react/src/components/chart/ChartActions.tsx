// Chart actions TradingView keeps one click away: undo / redo for drawings
// (left strip, under the eraser) and price alerts (right rail). Undo used to
// sit only inside the drawing menu, with no redo; alerts had no chart button.
import { useEffect, useState } from 'react'
import {
  drawingHistory,
  redoDrawing,
  subscribeDrawTools,
  undoDrawing,
} from '../../features/charts/drawTools'
import { renderAlerts } from '../../features/alerts/alerts'
import { openModal } from '../../utils/dom'

const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const UNDO = 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'
const REDO = 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'
const BELL = 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16ZM10 20.5a2 2 0 0 0 4 0'

/** Undo / redo every saved drawing change (add, delete, move, clear all). */
export function DrawHistoryButtons() {
  const [, force] = useState(0)
  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])
  const h = drawingHistory()
  return (
    <>
      <button
        type="button"
        className="chart-tool-btn tvb-icon draw-quick"
        aria-label="Undo"
        disabled={!h.undo}
        onClick={undoDrawing}
      >
        <Glyph d={UNDO} />
        <span className="tvb-tip">
          Undo <kbd>{MOD}Z</kbd>
        </span>
      </button>
      <button
        type="button"
        className="chart-tool-btn tvb-icon draw-quick"
        aria-label="Redo"
        disabled={!h.redo}
        onClick={redoDrawing}
      >
        <Glyph d={REDO} />
        <span className="tvb-tip">
          Redo <kbd>{MOD}Y</kbd>
        </span>
      </button>
    </>
  )
}

/** Opens the price alerts, as the alert button in TradingView's right rail. */
export function AlertRailButton() {
  return (
    <button
      type="button"
      className="cs-rail-btn"
      aria-label="Price alerts"
      onClick={() => {
        renderAlerts()
        openModal('alModal')
      }}
    >
      <Glyph d={BELL} />
      <span className="cs-rail-tip">Price alerts</span>
    </button>
  )
}
