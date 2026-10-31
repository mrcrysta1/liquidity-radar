// "+ Compare" in the chart toolbar: picks another market (or a ratio / spread
// expression) to draw as a % line over the chart — see features/charts/compare.
// The coin picker does the searching; the lines and their legend rows (with
// the remove buttons) belong to the chart.
import { useEffect, useState } from 'react'
import { CoinPicker } from './CoinPicker'
import {
  COMPARE_MAX,
  addCompare,
  compareSymbols,
  onCompareChange,
} from '../../features/charts/compare'

export function CompareButton() {
  const [syms, setSyms] = useState<string[]>(compareSymbols)
  useEffect(() => onCompareChange(() => setSyms(compareSymbols())), [])
  const full = syms.length >= COMPARE_MAX

  if (full)
    return (
      <button
        type="button"
        className="chart-tool-btn cmp-btn"
        disabled
        title={'Up to ' + COMPARE_MAX + ' symbols — remove one from the legend first'}
      >
        <span aria-hidden="true">+</span> Compare <span className="rail-count">{syms.length}</span>
      </button>
    )

  return (
    <CoinPicker
      className="cmp-picker"
      float
      allowSynthetic
      label="Compare"
      value=""
      onPick={(sym) => addCompare(sym)}
      trigger={
        <span className="cmp-btn-face" title="Compare with another symbol">
          <span aria-hidden="true">+</span> Compare
          {syms.length > 0 && <span className="rail-count">{syms.length}</span>}
        </span>
      }
    />
  )
}
