// Kagi lines.
//
// One vertical segment per swing: the line keeps going while price moves its
// way and turns (a horizontal connector, then a new segment the other way)
// once price comes back by the reversal amount — a fixed price amount (by
// default ATR-sized, see rangeView) or a percentage of the turning price.
//
// Thickness: the line turns thick (yang) when it rises above the prior
// shoulder (the top of the previous up segment) and thin (yin) when it falls
// below the prior waist (the bottom of the previous down segment). A segment
// records the state it started in (`yang0`) and, where it crossed, the price
// it flipped at (`flip`) — everything the renderer needs.
//
// Each segment is one bar: o = where it turned, c = how far it has gone.
// Times work like range bars (the forming candle's time, bumped a second
// where needed). Built from candle closes, so the style is an estimate.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'
import { STEP_MS } from './rangeBars.ts'

export interface KagiAux {
  /** Thick (yang) at the segment's start. */
  yang0: boolean
  /** Price where it changed thickness, or null when it did not. */
  flip: number | null
}
export type KagiBar = CandleFlat & { aux: KagiAux }

export const DEFAULT_KAGI_PCT = 1

/** Thick (yang) at the segment's end. */
export function kagiYangEnd(b: KagiBar): boolean {
  return b.aux.flip == null ? b.aux.yang0 : !b.aux.yang0
}

/**
 * `reversal` is a price amount, or with `percent` a percentage of the price
 * the line would turn from.
 */
export function buildKagi(src: CandleFlat[], reversal: number, percent = false): KagiBar[] {
  if (!src.length || !(reversal > 0) || !isFinite(reversal)) return []
  const rev = (p: number): number => (percent ? (Math.abs(p) * reversal) / 100 : reversal)
  const out: KagiBar[] = []
  let lastT = -Infinity
  let pendingVol = 0
  // Top of the last finished up segment / bottom of the last finished down one.
  let shoulder: number | null = null
  let waist: number | null = null
  // The level the current segment is measured against for its flip.
  let ref: number | null = null

  const open = (o: number, c: number, t: number, yang0: boolean): void => {
    const tt = Math.max(t, lastT + STEP_MS)
    lastT = tt
    ref = c > o ? shoulder : waist
    const b: KagiBar = {
      t: tt,
      o,
      h: Math.max(o, c),
      l: Math.min(o, c),
      c,
      v: 0,
      aux: { yang0, flip: null },
    }
    out.push(b)
    setFlip(b)
  }
  const setFlip = (b: KagiBar): void => {
    const up = b.c > b.o
    if (ref == null) return
    if (up && !b.aux.yang0 && b.c > ref) b.aux.flip = ref
    else if (!up && b.aux.yang0 && b.c < ref) b.aux.flip = ref
  }

  const anchor = src[0].o
  for (const k of src) {
    const p = k.c
    if (!isFinite(p)) continue
    if (!out.length) {
      if (Math.abs(p - anchor) >= rev(anchor)) open(anchor, p, k.t, p > anchor)
    } else {
      const cur = out[out.length - 1]
      const up = cur.c > cur.o
      if (up ? p > cur.c : p < cur.c) {
        cur.c = p
        cur.h = Math.max(cur.h, p)
        cur.l = Math.min(cur.l, p)
        setFlip(cur)
      } else if (Math.abs(cur.c - p) >= rev(cur.c)) {
        if (up) shoulder = cur.c
        else waist = cur.c
        open(cur.c, p, k.t, kagiYangEnd(cur))
      }
    }
    // A candle's volume belongs to whichever segment is current after it.
    pendingVol += k.v || 0
    if (out.length) {
      out[out.length - 1].v += pendingVol
      pendingVol = 0
    }
  }
  return out
}
