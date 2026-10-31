// Settings for the price-reversal styles, shown at the top of the style menu:
// the line count for Line break, ATR or percent reversal for Kagi, and the
// reversal box count for Point & Figure. The size shared with range bars
// (Kagi in ATR mode, P&F box size) is the picker's own RangeSettings block.
import { useEffect, useState } from 'react'
import type { ChartStyleId } from '../../features/charts/chartStyle'
import {
  getReversalSettings,
  setReversalSettings,
  subscribeReversalSettings,
} from '../../features/charts/series/reversalSettings'
import { MAX_LINE_BREAK, MIN_LINE_BREAK } from '../../features/charts/series/lineBreak'
import { MAX_PNF_REVERSAL, MIN_PNF_REVERSAL } from '../../features/charts/series/pointFigure'
import { TICK_SIZES } from '../../features/charts/orderflow/tickBars'

/**
 * A small number field applied on Enter or blur — every change rebuilds every
 * bar. Callers key it on `value`, so a clamped or saved value shows through.
 */
function NumberField({
  value,
  label,
  unit,
  onApply,
}: {
  value: number
  label: string
  unit: string
  onApply: (n: number) => void
}) {
  // Keyed on the value by the caller, so a saved change resets the field.
  const [text, setText] = useState(String(value))
  const apply = () => {
    const n = Number(text.replace(',', '.'))
    if (text.trim() !== '' && n > 0 && isFinite(n)) onApply(n)
    else setText(String(value))
  }
  return (
    <form
      className="range-set-input"
      onSubmit={(e) => {
        e.preventDefault()
        apply()
      }}
    >
      <input
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
      />
      <small>{unit}</small>
    </form>
  )
}

export function ReversalSettings({ id }: { id: ChartStyleId }) {
  const [, force] = useState(0)
  useEffect(() => subscribeReversalSettings(() => force((n) => n + 1)), [])
  const s = getReversalSettings()

  if (id === 'linebreak') {
    return (
      <div className="range-set" onKeyDown={(e) => e.stopPropagation()}>
        <div className="range-set-head">
          <span>Line break</span>
          <b>{s.lineBreak} lines</b>
        </div>
        <NumberField
          key={s.lineBreak}
          value={s.lineBreak}
          label="Lines to break for a reversal"
          unit={`lines (${MIN_LINE_BREAK}–${MAX_LINE_BREAK})`}
          onApply={(n) => setReversalSettings({ lineBreak: n })}
        />
      </div>
    )
  }
  if (id === 'kagi') {
    const atr = s.kagiMode === 'atr'
    return (
      <div className="range-set" onKeyDown={(e) => e.stopPropagation()}>
        <div className="range-set-head">
          <span>Kagi reversal</span>
          <b>{atr ? 'ATR' : s.kagiPct + '%'}</b>
        </div>
        <div className="range-set-modes" role="radiogroup" aria-label="Kagi reversal">
          <button
            type="button"
            role="radio"
            aria-checked={atr}
            className={'range-mode' + (atr ? ' on' : '')}
            onClick={() => setReversalSettings({ kagiMode: 'atr' })}
          >
            Price · ATR
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!atr}
            className={'range-mode' + (!atr ? ' on' : '')}
            onClick={() => setReversalSettings({ kagiMode: 'pct' })}
          >
            Percent
          </button>
        </div>
        {!atr && (
          <NumberField
            key={s.kagiPct}
            value={s.kagiPct}
            label="Kagi reversal percent"
            unit="% of price"
            onApply={(n) => setReversalSettings({ kagiPct: n })}
          />
        )}
      </div>
    )
  }
  if (id === 'tick') {
    return (
      <div className="range-set" onKeyDown={(e) => e.stopPropagation()}>
        <div className="range-set-head">
          <span>Tick bars</span>
          <b>{s.ticks}T</b>
        </div>
        <div className="range-set-modes" role="radiogroup" aria-label="Trades per bar">
          {TICK_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={s.ticks === n}
              className={'range-mode' + (s.ticks === n ? ' on' : '')}
              onClick={() => setReversalSettings({ ticks: n })}
            >
              {n}T
            </button>
          ))}
        </div>
        <NumberField
          key={s.ticks}
          value={s.ticks}
          label="Trades per bar"
          unit="trades per bar"
          onApply={(n) => setReversalSettings({ ticks: n })}
        />
        <small className="range-set-note">Built from live trades since the page opened.</small>
      </div>
    )
  }
  if (id === 'pnf') {
    return (
      <div className="range-set" onKeyDown={(e) => e.stopPropagation()}>
        <div className="range-set-head">
          <span>Reversal</span>
          <b>{s.pnfReversal} boxes</b>
        </div>
        <NumberField
          key={s.pnfReversal}
          value={s.pnfReversal}
          label="Boxes for a reversal"
          unit={`boxes (${MIN_PNF_REVERSAL}–${MAX_PNF_REVERSAL})`}
          onApply={(n) => setReversalSettings({ pnfReversal: n })}
        />
      </div>
    )
  }
  return null
}
