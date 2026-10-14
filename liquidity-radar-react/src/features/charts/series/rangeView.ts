// What the price-action chart actually draws: the candles themselves, or —
// with the Range bars style — range bars built from them.
//
// Everything that shares the chart's time axis (the price series, indicators,
// drawings, whale bubbles, the crosshair legend) reads displayCandles(), so
// every series agrees on the same bar times. Built bars are memoised: the
// chart asks many times per frame, and they only change with the data.
import { state } from '../../../services/store'
import type { CandleFlat } from '../../../services/market'
import { visibleCandles } from '../replay'
import { isRangeStyle, manualRangeFor } from '../chartStyle'
import { autoRangeSize, buildRangeBars, minSafeRange } from './rangeBars'

export function isRangeMode(): boolean {
  return isRangeStyle()
}

let sizeKey = ''
let sizeMemo = { size: 0, auto: 0, floor: 0 }
/**
 * The range in use for these candles. Keyed on the closed candles only, so
 * the size holds still while the live candle ticks.
 */
export function rangeSizeInfo(src: CandleFlat[] = visibleCandles()): {
  size: number
  auto: number
  floor: number
  manual: boolean
} {
  const sym = String(state.symbol || '')
  const manual = manualRangeFor(sym)
  const n = src.length
  const key = [sym, n, n ? src[0].t : 0, n > 1 ? src[n - 2].t : 0, manual ?? 'a'].join('|')
  if (key !== sizeKey) {
    sizeKey = key
    const auto = autoRangeSize(src)
    const floor = minSafeRange(src)
    sizeMemo = { size: Math.max(manual ?? auto, floor), auto, floor }
  }
  return { ...sizeMemo, manual: manual != null }
}

let barsKey = ''
let barsSrc: CandleFlat[] | null = null
let barsMemo: CandleFlat[] = []
function buildFor(src: CandleFlat[]): CandleFlat[] {
  const n = src.length
  if (!n) return []
  const size = rangeSizeInfo(src).size
  const last = src[n - 1]
  const key = [n, src[0].t, last.t, last.o, last.h, last.l, last.c, last.v, size].join('|')
  if (src !== barsSrc || key !== barsKey) {
    barsSrc = src
    barsKey = key
    barsMemo = buildRangeBars(src, size)
  }
  return barsMemo
}

/** The bars the chart draws right now (replay-aware). */
export function displayCandles(): CandleFlat[] {
  const src = visibleCandles()
  return isRangeMode() ? buildFor(src) : src
}

/**
 * Candles for the panes that are genuinely per-time-candle (the delta pane):
 * there is no honest way to put them on range bars, so they are hidden.
 */
export function timeOnlyCandles(): CandleFlat[] {
  return isRangeMode() ? [] : visibleCandles()
}

/**
 * Drawings are anchored to a time. On range bars that exact time rarely
 * belongs to a bar, so it snaps to the bar in progress at that moment —
 * the same drawing lands in the right place in both modes.
 */
export function snapChartTime(tSec: number): number {
  if (!isRangeMode()) return tSec
  const bars = displayCandles()
  if (!bars.length) return tSec
  const t = tSec * 1000
  if (t < bars[0].t) return tSec
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return Math.floor(bars[lo].t / 1000)
}
