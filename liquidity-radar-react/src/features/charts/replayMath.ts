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

// ------------------------------------------------- lower-interval stepping
// TradingView Premium's "update interval": replaying 1h bars a minute (or a
// second) at a time. The bar in progress is built from the lower-interval
// sub-bars that have "happened" so far; the rest of it stays hidden.

export interface SubBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/**
 * The forming bar opening at `open`: every sub-bar from `open` up to and
 * including the one opening at `upTo`, folded into one OHLCV bar stamped with
 * the main bar's open time. Null when no sub-bar has happened yet.
 */
export function formingBar(subs: ReadonlyArray<SubBar>, open: number, upTo: number): SubBar | null {
  let out: SubBar | null = null
  for (const s of subs) {
    if (s.t < open) continue
    if (s.t > upTo) break
    if (!out) out = { t: open, o: s.o, h: s.h, l: s.l, c: s.c, v: s.v }
    else {
      if (s.h > out.h) out.h = s.h
      if (s.l < out.l) out.l = s.l
      out.c = s.c
      out.v += s.v
    }
  }
  return out
}

/** Open time of the first sub-bar after `t`, or null past the last one. */
export function nextSubTime(subs: ReadonlyArray<{ t: number }>, t: number): number | null {
  const i = countAtOrBefore(subs, t)
  return i < subs.length ? subs[i].t : null
}

/** Open time of the last sub-bar before `t`, or null before the first one. */
export function prevSubTime(subs: ReadonlyArray<{ t: number }>, t: number): number | null {
  const i = countAtOrBefore(subs, t - 1)
  return i > 0 ? subs[i - 1].t : null
}

/**
 * The update intervals a bar of `mainMs` can be replayed by: strictly
 * shorter, and at most `maxRatio` sub-bars per bar so one bar stays a
 * handful of requests (1s steps only reach up to 1h bars).
 */
export function updateIntervalsFor<T extends { ms: number }>(
  mainMs: number,
  options: ReadonlyArray<T>,
  maxRatio = 3600,
): T[] {
  return options.filter((o) => o.ms < mainMs && mainMs / o.ms <= maxRatio)
}
