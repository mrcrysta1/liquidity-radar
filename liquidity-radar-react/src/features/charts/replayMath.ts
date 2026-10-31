// Position arithmetic for bar replay, kept pure so scripts/test-engines.mjs
// can run it: the replay module itself reads the live store.

/** How many bars open at or before `t` (ms) — the replay count that ends on `t`. */
export function countAtOrBefore(bars: ReadonlyArray<{ t: number }>, t: number): number {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].t <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * The replay count that starts on a calendar date: the first bar opening at
 * or after `t` is the last one shown. Before the loaded history it clamps to
 * the first bar, past it to the last.
 */
export function countFromDate(bars: ReadonlyArray<{ t: number }>, t: number): number {
  const n = bars.length
  if (!n) return 0
  const before = countAtOrBefore(bars, t)
  // An exact hit is that bar; otherwise the next bar to open after `t`.
  const exact = before > 0 && bars[before - 1].t === t
  return Math.max(1, Math.min(n, exact ? before : before + 1))
}

/**
 * A random start that leaves history behind it to read and bars ahead to
 * play into — TradingView's "random bar" avoids the very ends too. `rnd` is
 * injected (Math.random in the app) so tests are deterministic.
 */
export function randomCount(n: number, rnd: () => number): number {
  if (n <= 1) return n
  const lo = Math.max(1, Math.floor(n * 0.1))
  const hi = Math.max(lo, Math.floor(n * 0.9))
  return Math.min(n, lo + Math.floor(rnd() * (hi - lo + 1)))
}
