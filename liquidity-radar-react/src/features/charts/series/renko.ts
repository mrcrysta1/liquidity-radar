// Renko bricks, TradingView "Traditional" style on the close.
//
// Every brick spans exactly one box. A brick forms only once a candle closes
// a full box beyond the last brick: continuing the trend needs one box, a
// reversal two (one past the far edge of the last brick). A close that jumps
// several boxes lays down several bricks at once. Wicks are never drawn —
// high and low are the brick edges.
//
// The last element can be the *forming* brick: price has moved past the last
// brick's edge but not by a full box yet. It opens on that edge and closes at
// the latest price, so live ticks grow it until it completes (it then keeps
// its time and becomes a whole brick) or price falls back and it vanishes.
//
// Like range bars, bricks have no time of their own. Each takes the open time
// of the candle its move began in — the first candle after the previous brick
// completed, or for the second and later bricks of a multi-box candle that
// candle itself — bumped forward a whole second where several share one, so
// times stay strictly increasing and a forming brick keeps its time when it
// completes.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'

/** The chart works in whole seconds, so bricks are spaced at least this far apart. */
const STEP_MS = 1000
/** Float slack, so a close exactly one box away still counts as a full box. */
const EPS = 1e-9

export function buildRenko(src: CandleFlat[], box: number): CandleFlat[] {
  if (!src.length || !(box > 0) || !isFinite(box)) return []
  const out: CandleFlat[] = []
  // Edges of the last brick; before the first brick both sit on the first close.
  let hi = src[0].c
  let lo = src[0].c
  let lastT = -Infinity
  /** Open time of the move in progress: the first candle since the last brick. */
  let startT: number | null = null
  let vol = 0
  const tol = box * EPS
  for (const k of src) {
    const c = k.c
    if (!isFinite(c)) continue
    if (startT == null) startT = k.t
    vol += k.v || 0
    let n = 0
    if (c >= hi + box - tol) n = Math.floor((c - hi) / box + EPS)
    else if (c <= lo - box + tol) n = -Math.floor((lo - c) / box + EPS)
    if (!n) continue
    const up = n > 0
    const count = Math.abs(n)
    const v = vol / count
    for (let i = 0; i < count; i++) {
      const o = up ? hi : lo
      const cl = up ? o + box : o - box
      const t: number = Math.max(i === 0 ? startT : k.t, lastT + STEP_MS)
      out.push({ t, o, h: Math.max(o, cl), l: Math.min(o, cl), c: cl, v })
      lastT = t
      hi = Math.max(o, cl)
      lo = Math.min(o, cl)
    }
    startT = null
    vol = 0
  }
  // The forming brick: past an edge of the last brick, short of a full box.
  // When the last candle just completed bricks, its leftover move starts now.
  const lastK = src[src.length - 1]
  const last = lastK.c
  if (isFinite(last) && (last > hi + tol || last < lo - tol)) {
    const o = last > hi ? hi : lo
    out.push({
      t: Math.max(startT ?? lastK.t, lastT + STEP_MS),
      o,
      h: Math.max(o, last),
      l: Math.min(o, last),
      c: last,
      v: vol,
    })
  }
  return out
}

/**
 * The look of a renko brick on a candlestick series: TradingView's renko
 * colours, solid boxes with a matching border, and no wicks.
 */
export const RENKO_UP = '#089981'
export const RENKO_DOWN = '#F23645'
export function renkoSeriesOptions(): Record<string, unknown> {
  return {
    upColor: RENKO_UP,
    downColor: RENKO_DOWN,
    borderVisible: true,
    borderUpColor: RENKO_UP,
    borderDownColor: RENKO_DOWN,
    wickVisible: false,
    wickUpColor: RENKO_UP,
    wickDownColor: RENKO_DOWN,
  }
}
