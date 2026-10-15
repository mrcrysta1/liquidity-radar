// Line break ("three-line break") bars.
//
// Each close is compared with the lines drawn so far:
//   - beyond the last line in its own direction → a new line in that
//     direction, from the last line's close to this close;
//   - beyond the extreme of the last N lines the other way → a reversal line,
//     from the last line's open to this close;
//   - anything else draws nothing.
// The lines carry no wicks: high and low are the body.
//
// Built from candle closes (the chart's time candles, not ticks), so the
// style is marked as an estimate. Times work like range bars: each line keeps
// the open time of the candle that formed it, bumped a whole second forward
// where needed so times stay strictly increasing.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'
import { STEP_MS } from './rangeBars.ts'

export const DEFAULT_LINE_BREAK = 3
export const MIN_LINE_BREAK = 1
export const MAX_LINE_BREAK = 10

export function clampLineBreak(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!isFinite(v)) return DEFAULT_LINE_BREAK
  return Math.max(MIN_LINE_BREAK, Math.min(MAX_LINE_BREAK, v))
}

export function buildLineBreak(src: CandleFlat[], lines = DEFAULT_LINE_BREAK): CandleFlat[] {
  if (!src.length) return []
  const n = clampLineBreak(lines)
  const out: CandleFlat[] = []
  let lastT = -Infinity
  // Volume traded since the last line goes to the next one.
  let vol = 0
  const add = (o: number, c: number, t: number): void => {
    const tt = Math.max(t, lastT + STEP_MS)
    out.push({ t: tt, o, h: Math.max(o, c), l: Math.min(o, c), c, v: vol })
    lastT = tt
    vol = 0
  }
  // The first line opens at the first candle's open.
  const base = src[0].o
  for (const k of src) {
    vol += k.v || 0
    const c = k.c
    if (!isFinite(c)) continue
    if (!out.length) {
      if (c !== base) add(base, c, k.t)
      continue
    }
    const last = out[out.length - 1]
    const up = last.c > last.o
    if (up ? c > last.c : c < last.c) {
      add(last.c, c, k.t)
      continue
    }
    // Reversal: past the extreme of the last n lines, whatever their colour.
    let lo = Infinity
    let hi = -Infinity
    for (let i = Math.max(0, out.length - n); i < out.length; i++) {
      if (out[i].l < lo) lo = out[i].l
      if (out[i].h > hi) hi = out[i].h
    }
    if (up ? c < lo : c > hi) add(last.o, c, k.t)
  }
  return out
}
