// Derived (non-time) bars: the styles whose bars are built from price
// movement rather than the clock — Range bars and Renko today.
//
// They share all of their plumbing (rangeView on the main chart, the
// companions, the size settings in chartStyle, the time-axis handling in
// chartRender): only the builder differs, and it is picked here. Both are
// sized the same way — ATR(14) of the closed candles unless the coin has a
// manual size, never below the safe floor (minSafeRange).
//
// Pure: no DOM, no store.
import type { CandleFlat } from '../../../services/market'
import { autoRangeSize, buildRangeBars, minSafeRange } from './rangeBars.ts'
import { buildRenko } from './renko.ts'

/** Bars for derived style `id` ('range', 'renko', …) at box/range `size`. */
export function buildDerivedBars(id: string, src: CandleFlat[], size: number): CandleFlat[] {
  return id === 'renko' ? buildRenko(src, size) : buildRangeBars(src, size)
}

/** The size in use: the manual one if set, else auto, never below the floor. */
export function derivedSize(
  src: CandleFlat[],
  manual: number | null,
): {
  size: number
  auto: number
  floor: number
} {
  const auto = autoRangeSize(src)
  const floor = minSafeRange(src)
  return { size: Math.max(manual ?? auto, floor), auto, floor }
}
