// Time ↔ bar-index mapping for drawings — pure, no chart, no DOM.
//
// lightweight-charts only maps a time to x when a bar sits at exactly that
// time, so an anchor placed on 15m vanished on 4h (13:15 is no 4h bar), and
// one older than the loaded history or right of the last bar had no x at all.
// These work in logical (bar-index) space instead: between bars they
// interpolate, past either end they extrapolate one bar interval per step —
// the chart's own logicalToCoordinate then turns that into pixels.

/** The spacing used past the ends: the gap between the two end bars. */
function edgeStep(times: number[], atEnd: boolean): number {
  const n = times.length
  if (n < 2) return 0
  return atEnd ? times[n - 1] - times[n - 2] : times[1] - times[0]
}

/**
 * Logical index of `t` in an ascending list of bar times (seconds): exact on a
 * bar, fractional between two, and extrapolated before the first or after the
 * last. Null only when there is nothing to measure against.
 */
export function timeToLogical(times: number[], t: number): number | null {
  const n = times.length
  if (!n || !Number.isFinite(t)) return null
  if (n === 1) return t === times[0] ? 0 : null
  if (t <= times[0]) {
    const step = edgeStep(times, false)
    return step > 0 ? (t - times[0]) / step : 0
  }
  if (t >= times[n - 1]) {
    const step = edgeStep(times, true)
    return step > 0 ? n - 1 + (t - times[n - 1]) / step : n - 1
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  const span = times[hi] - times[lo]
  return span > 0 ? lo + (t - times[lo]) / span : lo
}

/**
 * Bar time at a logical index — the inverse, rounded to whole bars, so a click
 * in the empty space right of the last bar lands on a future bar's time.
 */
export function logicalToTime(times: number[], logical: number): number | null {
  const n = times.length
  if (!n || !Number.isFinite(logical)) return null
  const i = Math.round(logical)
  if (i >= 0 && i < n) return times[i]
  if (n < 2) return null
  if (i < 0) return times[0] + i * edgeStep(times, false)
  return times[n - 1] + (i - (n - 1)) * edgeStep(times, true)
}
