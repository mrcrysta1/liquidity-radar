// The floating toolbar over a selected drawing, as on TradingView: colour,
// line width, line style and delete. Drawings had a fixed colour per tool and
// nothing could be changed after placing them.
import { useEffect, useState } from 'react'
import {
  deleteSelectedDrawing,
  editSelectedDrawing,
  selectedDrawing,
  subscribeDrawTools,
} from '../../features/charts/drawTools'
import type { DrawDash } from '../../features/charts/drawTools'

const COLORS = ['#2962FF', '#4FC3F7', '#00E676', '#FFD54F', '#FF9800', '#FF1744', '#E040FB', '#B2B5BE']
const WIDTHS = [1, 2, 3, 4]
const DASHES: Array<{ id: DrawDash; label: string; d: string }> = [
  { id: 'solid', label: 'Solid line', d: 'M3 12h18' },
  { id: 'dashed', label: 'Dashed line', d: 'M3 12h5M11 12h5M19 12h2' },
  { id: 'dotted', label: 'Dotted line', d: 'M3 12h1M8 12h1M13 12h1M18 12h1' },
]

export function DrawingPropsBar() {
  const [, force] = useState(0)
  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])
  const sel = selectedDrawing()
  if (!sel) return null
  return (
    <div className="dp-bar" role="toolbar" aria-label="Drawing properties">
      <div className="dp-colors" role="radiogroup" aria-label="Colour">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={sel.color.toLowerCase() === c.toLowerCase()}
            aria-label={'Colour ' + c}
            className={'dp-swatch' + (sel.color.toLowerCase() === c.toLowerCase() ? ' on' : '')}
            style={{ background: c }}
            onClick={() => editSelectedDrawing({ color: c })}
          />
        ))}
      </div>
      <span className="dp-sep" aria-hidden="true" />
      <div className="dp-group" role="radiogroup" aria-label="Line width">
        {WIDTHS.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={Math.round(sel.width) === w}
            aria-label={w + 'px line'}
            className={'dp-btn' + (Math.round(sel.width) === w ? ' on' : '')}
            onClick={() => editSelectedDrawing({ width: w })}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M4 12h16" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <span className="dp-sep" aria-hidden="true" />
      <div className="dp-group" role="radiogroup" aria-label="Line style">
        {DASHES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={sel.dash === s.id}
            aria-label={s.label}
            className={'dp-btn' + (sel.dash === s.id ? ' on' : '')}
            onClick={() => editSelectedDrawing({ dash: s.id })}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d={s.d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ))}
      </div>
      <span className="dp-sep" aria-hidden="true" />
      <button type="button" className="dp-btn dp-del" aria-label="Delete drawing" onClick={deleteSelectedDrawing}>
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
