// Volume-by-price histogram over a lookback window, plus the standard
// Point-of-Control / Value-Area-High / Value-Area-Low markers derived from
// it. Pure math — no DOM — so both the existing side-panel list and the new
// chart overlay can share one source of truth instead of computing it twice.
import type { CandleFlat } from '../../services/market'

export interface VolumeProfile {
  lo: number
  hi: number
  binSize: number
  /** Total volume per row, bottom (lo) to top (hi). */
  buckets: number[]
  /** Up-bar (close >= open) share of each row's volume. */
  buy: number[]
  /** Down-bar share of each row's volume. */
  sell: number[]
  pocIdx: number
  vahIdx: number
  valIdx: number
  maxVol: number
  totalVol: number
}

export const VP_ROWS_MIN = 8
export const VP_ROWS_MAX = 200
export const VP_ROWS_DEFAULT = 48
export const VP_VA_MIN = 10
export const VP_VA_MAX = 99
export const VP_VA_DEFAULT = 70

export function clampRows(n: number): number {
  if (!Number.isFinite(n)) return VP_ROWS_DEFAULT
  return Math.max(VP_ROWS_MIN, Math.min(VP_ROWS_MAX, Math.round(n)))
}
export function clampValueArea(n: number): number {
  if (!Number.isFinite(n)) return VP_VA_DEFAULT
  return Math.max(VP_VA_MIN, Math.min(VP_VA_MAX, Math.round(n)))
}

/** The lookback the chart profiles: last `windowMs` of candles, bounded both ways. */
export function profileWindow(candles: CandleFlat[], windowMs = 24 * 60 * 60 * 1000): CandleFlat[] {
  if (!candles.length) return []
  const cutoff = candles[candles.length - 1].t - windowMs
  // Falls back to a fixed candle count on very low timeframes/short history,
  // where a 24h window could be thousands of bars — bounded either way.
  let w = candles.filter((c) => c.t >= cutoff)
  if (w.length < 20) w = candles.slice(-96)
  if (w.length > 1500) w = w.slice(-1500)
  return w
}

/**
 * Profile of exactly these candles. Each bar's volume is spread evenly over
 * every row its high–low range touches (not dumped at its close, which
 * skews the POC toward wherever bars happened to settle), and attributed to
 * buyers on an up bar, sellers on a down bar. `valueArea` is a fraction
 * (0.7 = 70%).
 */
export function buildVolumeProfile(
  w: CandleFlat[],
  rows = VP_ROWS_DEFAULT,
  valueArea = VP_VA_DEFAULT / 100,
): VolumeProfile | null {
  if (!w.length) return null
  rows = clampRows(rows)
  let lo = Infinity
  let hi = -Infinity
  for (const c of w) {
    if (c.l < lo) lo = c.l
    if (c.h > hi) hi = c.h
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  const binSize = (hi - lo || 1) / rows
  const buckets = new Array(rows).fill(0) as number[]
  const buy = new Array(rows).fill(0) as number[]
  const sell = new Array(rows).fill(0) as number[]
  const row = (p: number) => Math.max(0, Math.min(rows - 1, Math.floor((p - lo) / binSize)))
  for (const c of w) {
    const vol = Number(c.v) || 0
    if (vol <= 0) continue
    const a = row(c.l)
    const b = row(c.h)
    const share = vol / (b - a + 1)
    const up = c.c >= c.o
    for (let i = a; i <= b; i++) {
      buckets[i] += share
      if (up) buy[i] += share
      else sell[i] += share
    }
  }
  const totalVol = buckets.reduce((s, x) => s + x, 0)
  let pocIdx = 0
  for (let i = 1; i < rows; i++) if (buckets[i] > buckets[pocIdx]) pocIdx = i
  const maxVol = buckets[pocIdx] || 1

  // Value area: expand outward from the POC, each step taking whichever
  // neighbour (above/below the current area) holds more volume, until the
  // area holds `valueArea` of the traded volume — the standard VA rule.
  let lowI = pocIdx
  let highI = pocIdx
  let covered = buckets[pocIdx]
  const target = totalVol * valueArea
  while (covered < target && (lowI > 0 || highI < rows - 1)) {
    const below = lowI > 0 ? buckets[lowI - 1] : -1
    const above = highI < rows - 1 ? buckets[highI + 1] : -1
    if (above >= below) {
      highI++
      covered += buckets[highI]
    } else {
      lowI--
      covered += buckets[lowI]
    }
  }

  return {
    lo,
    hi,
    binSize,
    buckets,
    buy,
    sell,
    pocIdx,
    vahIdx: highI,
    valIdx: lowI,
    maxVol,
    totalVol,
  }
}

export function computeVolumeProfile(
  candles: CandleFlat[],
  rows = VP_ROWS_DEFAULT,
  valueArea = VP_VA_DEFAULT / 100,
  windowMs = 24 * 60 * 60 * 1000,
): VolumeProfile | null {
  return buildVolumeProfile(profileWindow(candles, windowMs), rows, valueArea)
}

export function bucketPriceRange(vp: VolumeProfile, i: number): [number, number] {
  return [vp.lo + i * vp.binSize, vp.lo + (i + 1) * vp.binSize]
}
