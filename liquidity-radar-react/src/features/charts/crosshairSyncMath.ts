// Pure time mapping for crosshair sync (./crosshairSync): no DOM, no chart,
// so the unit tests can import it directly.

/**
 * Index of the last bar that opened at or before `timeSec` (seconds), or -1
 * when every bar is later. `bars` are ascending by `t` (milliseconds).
 */
export function barAtOrBefore(bars: readonly { t: number }[], timeSec: number): number {
  if (!isFinite(timeSec)) return -1
  let lo = 0
  let hi = bars.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (Math.floor(bars[mid].t / 1000) <= timeSec) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}
