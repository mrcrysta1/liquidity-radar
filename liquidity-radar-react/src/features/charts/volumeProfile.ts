// Volume-by-price histogram over a lookback window, plus the standard
// Point-of-Control / Value-Area-High / Value-Area-Low markers derived from
// it. Pure math — no DOM — so both the existing side-panel list and the new
// chart overlay can share one source of truth instead of computing it twice.
import type { CandleFlat } from '../../services/market'

export interface VolumeProfile {
  lo: number
  hi: number
  binSize: number
  buckets: number[]
  pocIdx: number
  vahIdx: number
  valIdx: number
  maxVol: number
  totalVol: number
}

export function computeVolumeProfile(
  candles: CandleFlat[],
  bins = 22,
  windowMs = 24 * 60 * 60 * 1000,
): VolumeProfile | null {
  if (!candles.length) return null
  const cutoff = candles[candles.length - 1].t - windowMs
  // Falls back to a fixed candle count on very low timeframes/short history,
  // where a 24h window could be thousands of bars — bounded either way.
  let w = candles.filter((c) => c.t >= cutoff)
  if (w.length < 20) w = candles.slice(-96)
  if (w.length > 1500) w = w.slice(-1500)
  const lo = Math.min(...w.map((c) => c.l))
  const hi = Math.max(...w.map((c) => c.h))
  const binSize = (hi - lo || 1) / bins
  const buckets = new Array(bins).fill(0) as number[]
  w.forEach((c) => {
    let bi = Math.floor((c.c - lo) / binSize)
    bi = Math.max(0, Math.min(bins - 1, bi))
    buckets[bi] += c.v as number
  })
  const totalVol = buckets.reduce((a, b) => a + b, 0)
  const maxVol = Math.max(...buckets) || 1
  const pocIdx = buckets.indexOf(maxVol)

  // Value area: expand outward from the POC, each step taking whichever
  // neighbour (above/below the current area) holds more volume, until the
  // area holds ~70% of the session's traded volume — the standard VA rule.
  let lowI = pocIdx
  let highI = pocIdx
  let covered = buckets[pocIdx]
  const target = totalVol * 0.7
  while (covered < target && (lowI > 0 || highI < bins - 1)) {
    const below = lowI > 0 ? buckets[lowI - 1] : -1
    const above = highI < bins - 1 ? buckets[highI + 1] : -1
    if (above >= below) {
      highI++
      covered += buckets[highI]
    } else {
      lowI--
      covered += buckets[lowI]
    }
  }

  return { lo, hi, binSize, buckets, pocIdx, vahIdx: highI, valIdx: lowI, maxVol, totalVol }
}

export function bucketPriceRange(vp: VolumeProfile, i: number): [number, number] {
  return [vp.lo + i * vp.binSize, vp.lo + (i + 1) * vp.binSize]
}
