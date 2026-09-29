// Range bars — ported from the Pro terminal (core/chart/rangeBars.ts).
//
// Each bar spans at most `range` in price; a new bar opens when the range
// would be exceeded. Bars are built from time candles by walking each one
// O→L→H→C (up candle) or O→H→L→C (down candle): an approximation of bars
// built from ticks, which is the best the kline feed allows.
//
// Range bars have no time of their own. Each keeps the open time of the
// source candle it started in, bumped forward a whole second where several
// bars start inside one candle, so times stay strictly increasing (a
// lightweight-charts requirement) and still read as roughly "when".
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'

/** The chart works in whole seconds, so bars are spaced at least this far apart. */
const STEP_MS = 1000
/** Past this many bars a range is too small to be useful — see minSafeRange. */
export const MAX_RANGE_BARS = 20000

export function buildRangeBars(src: CandleFlat[], range: number): CandleFlat[] {
  if (!src.length || !(range > 0) || !isFinite(range)) return []
  const out: CandleFlat[] = []
  let cur: CandleFlat | null = null
  let lastT = -Infinity
  const push = (price: number, vol: number, t: number): void => {
    if (!cur) {
      cur = { t: Math.max(t, lastT + STEP_MS), o: price, h: price, l: price, c: price, v: vol }
      return
    }
    let b: CandleFlat = cur
    b.c = price
    b.v += vol
    if (price > b.h) b.h = price
    if (price < b.l) b.l = price
    while (b.h - b.l > range) {
      const up = price > b.o
      const boundary = up ? b.l + range : b.h - range
      const done: CandleFlat = {
        t: b.t,
        o: b.o,
        h: up ? boundary : b.h,
        l: up ? b.l : boundary,
        c: boundary,
        v: b.v,
      }
      out.push(done)
      lastT = done.t
      b = {
        t: Math.max(t, lastT + STEP_MS),
        o: boundary,
        h: Math.max(boundary, price),
        l: Math.min(boundary, price),
        c: price,
        v: 0,
      }
      cur = b
    }
  }
  for (const k of src) {
    const path = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]
    const v = (k.v || 0) / 4
    for (const p of path) push(p, v, k.t)
  }
  // Assigned inside the closure, which the compiler cannot follow.
  const open = cur as CandleFlat | null
  if (open) out.push(open)
  return out
}

/** Wilder's ATR over the candles; null until `len` + 1 candles exist. */
export function atr(src: CandleFlat[], len = 14): number | null {
  if (src.length <= len) return null
  let sum = 0
  let val = 0
  for (let i = 1; i < src.length; i++) {
    const k = src[i]
    const pc = src[i - 1].c
    const tr = Math.max(k.h - k.l, Math.abs(k.h - pc), Math.abs(k.l - pc))
    if (i <= len) {
      sum += tr
      if (i === len) val = sum / len
    } else val = (val * (len - 1) + tr) / len
  }
  return val > 0 ? val : null
}

/**
 * Round up to two significant figures, so the auto range only moves when the
 * ATR does meaningfully — every change rebuilds every bar.
 */
export function niceRange(x: number): number {
  if (!(x > 0) || !isFinite(x)) return 0
  const mag = Math.pow(10, Math.floor(Math.log10(x)) - 1)
  return Number((Math.ceil(x / mag - 1e-9) * mag).toPrecision(2))
}

/**
 * Auto range: ATR(14) of the closed candles (the live one is left out, so the
 * size does not shift tick by tick), falling back to 0.2% of price.
 */
export function autoRangeSize(src: CandleFlat[]): number {
  if (!src.length) return 0
  const closed = src.length > 1 ? src.slice(Math.max(0, src.length - 301), -1) : src
  const a = atr(closed, 14)
  return niceRange(a ?? src[src.length - 1].c * 0.002)
}

/**
 * The smallest range that keeps the bar count near MAX_RANGE_BARS. A manual
 * size typed for one coin can be absurdly small on another; without this
 * floor a single redraw could try to build millions of bars.
 */
export function minSafeRange(src: CandleFlat[]): number {
  let path = 0
  for (const k of src) path += Math.abs(k.h - k.l) * 2
  return path > 0 ? niceRange(path / MAX_RANGE_BARS) : 0
}
