// Point & Figure columns.
//
// Prices fall on a fixed grid of boxes (box j spans j·box … (j+1)·box). An X
// column (rising) fills a box once price reaches its top; an O column
// (falling) once price reaches its bottom. A column keeps extending its own
// way and gives way to the other once price has come back `reversal` boxes
// (3 by default), the new column starting one box away from the old extreme.
//
// Built like range bars, from time candles walked O→L→H→C (up candle) or
// O→H→L→C (down) — the high/low method on the data the kline feed has, so
// the style is an estimate. Each column keeps the time of the candle it
// started in, bumped a second forward where several start in one candle.
//
// Each column is one bar: X columns run o = bottom → c = top, O columns the
// other way; `aux.box` carries the box size for the renderer.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'
import { STEP_MS } from './rangeBars.ts'

export interface PnfAux {
  box: number
}
export type PnfBar = CandleFlat & { aux: PnfAux }

export const DEFAULT_PNF_REVERSAL = 3
export const MIN_PNF_REVERSAL = 1
export const MAX_PNF_REVERSAL = 10

export function clampPnfReversal(n: unknown): number {
  const v = Math.floor(Number(n))
  if (!isFinite(v)) return DEFAULT_PNF_REVERSAL
  return Math.max(MIN_PNF_REVERSAL, Math.min(MAX_PNF_REVERSAL, v))
}

/** Number of boxes a column spans. */
export function pnfBoxes(b: PnfBar): number {
  return Math.max(1, Math.round((b.h - b.l) / b.aux.box))
}

const EPS = 1e-9

export function buildPointFigure(
  src: CandleFlat[],
  box: number,
  reversal = DEFAULT_PNF_REVERSAL,
): PnfBar[] {
  if (!src.length || !(box > 0) || !isFinite(box)) return []
  const r = clampPnfReversal(reversal)
  const price = (j: number): number => Number((j * box).toPrecision(12))
  const out: PnfBar[] = []
  let lastT = -Infinity
  let dir: 0 | 1 | -1 = 0
  let lo = 0
  let hi = 0
  let pendingVol = 0
  const anchor = Math.floor(src[0].o / box + EPS)

  const sync = (b: PnfBar): void => {
    const bottom = price(lo)
    const top = price(hi + 1)
    b.l = bottom
    b.h = top
    b.o = dir === 1 ? bottom : top
    b.c = dir === 1 ? top : bottom
  }
  const open = (t: number): void => {
    const tt = Math.max(t, lastT + STEP_MS)
    lastT = tt
    const b: PnfBar = { t: tt, o: 0, h: 0, l: 0, c: 0, v: 0, aux: { box } }
    sync(b)
    out.push(b)
  }
  const push = (p: number, vol: number, t: number): void => {
    // Highest box whose top price has reached; lowest box whose bottom it has.
    const up = Math.floor(p / box + EPS) - 1
    const dn = Math.ceil(p / box - EPS)
    if (dir === 0) {
      if (up >= anchor) {
        dir = 1
        lo = anchor
        hi = up
        open(t)
      } else if (dn <= anchor - 1) {
        dir = -1
        lo = dn
        hi = anchor - 1
        open(t)
      }
    } else if (dir === 1) {
      if (up > hi) {
        hi = up
        sync(out[out.length - 1])
      } else if (hi - dn >= r) {
        dir = -1
        hi = hi - 1
        lo = dn
        open(t)
      }
    } else {
      if (dn < lo) {
        lo = dn
        sync(out[out.length - 1])
      } else if (up - lo >= r) {
        dir = 1
        lo = lo + 1
        hi = up
        open(t)
      }
    }
    pendingVol += vol
    if (out.length) {
      out[out.length - 1].v += pendingVol
      pendingVol = 0
    }
  }
  for (const k of src) {
    if (!isFinite(k.c)) continue
    const path = k.c >= k.o ? [k.o, k.l, k.h, k.c] : [k.o, k.h, k.l, k.c]
    const v = (k.v || 0) / 4
    for (const p of path) push(p, v, k.t)
  }
  return out
}
