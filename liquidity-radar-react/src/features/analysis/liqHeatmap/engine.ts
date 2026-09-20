// Liquidation heatmap — ported from the Pro terminal's core/liquidity/heatmap,
// adapted to this app's flat candle shape ({t ms, o, h, l, c, v}).
//
// It is an ESTIMATE built from public candles plus optional open-interest
// history. Every bar opens leveraged positions around its price; each leverage
// tier implies a liquidation price (long: p·(1−1/L), short: p·(1+1/L)). Those
// levels accumulate as horizontal bands that persist until price trades
// through them. Nobody outside the exchange knows real positions, so this is a
// model — and the UI says so.
import type { CandleFlat } from '../../../services/market'

export interface LeverageTier {
  lev: number
  weight: number
}
export interface HeatmapModel {
  id: string
  name: string
  tiers: LeverageTier[]
  longShare: number
  decayPerBar: number
  description: string
}

export const MODELS: HeatmapModel[] = [
  {
    id: 'm1',
    name: 'Model 1',
    tiers: [
      { lev: 10, weight: 0.15 },
      { lev: 25, weight: 0.35 },
      { lev: 50, weight: 0.3 },
      { lev: 100, weight: 0.2 },
    ],
    longShare: 0.5,
    decayPerBar: 0.995,
    description: 'Retail-heavy: 25x–100x dominant, slow decay',
  },
  {
    id: 'm2',
    name: 'Model 2',
    tiers: [
      { lev: 5, weight: 0.2 },
      { lev: 10, weight: 0.35 },
      { lev: 20, weight: 0.3 },
      { lev: 50, weight: 0.15 },
    ],
    longShare: 0.5,
    decayPerBar: 0.99,
    description: 'Balanced: 5x–50x, medium decay',
  },
  {
    id: 'm3',
    name: 'Model 3',
    tiers: [
      { lev: 3, weight: 0.3 },
      { lev: 5, weight: 0.35 },
      { lev: 10, weight: 0.35 },
    ],
    longShare: 0.5,
    decayPerBar: 0.985,
    description: 'Low-leverage / swing positioning, faster decay',
  },
]

export interface OiPoint {
  ts: number
  value: number
}
export interface HeatmapOptions {
  bins: number
  model: HeatmapModel
  oi?: OiPoint[]
}
export interface Heatmap {
  cols: number
  bins: number
  priceMin: number
  priceMax: number
  binSize: number
  /** cols × bins, column-major. */
  grid: Float32Array
  max: number
  times: number[]
  candles: CandleFlat[]
  levels: Array<{ price: number; value: number }>
}

export function buildHeatmap(candles: CandleFlat[], opts: HeatmapOptions): Heatmap | null {
  const n = candles.length
  if (n < 10) return null
  const { bins, model } = opts
  let lo = Infinity
  let hi = -Infinity
  for (const c of candles) {
    lo = Math.min(lo, c.l)
    hi = Math.max(hi, c.h)
  }
  const minLev = Math.min(...model.tiers.map((t) => t.lev))
  // Widen the range so far-out (low-leverage) levels are visible, without
  // squashing the price action into a sliver.
  const pad = Math.min(hi * 0.1, Math.max((hi - lo) * 0.2, (hi / minLev) * 1.1))
  lo -= pad
  hi += pad
  if (!(hi > lo)) return null

  const binSize = (hi - lo) / bins
  const grid = new Float32Array(n * bins)
  const cur = new Float32Array(bins)
  const binOf = (p: number) => Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / binSize)))

  // Rising open interest means more new positions, so scale the notional by it.
  const oi = opts.oi
  const oiAt = (tsMs: number): number => {
    if (!oi || oi.length < 2) return 1
    let k = 0
    while (k + 1 < oi.length && oi[k + 1].ts <= tsMs) k++
    const a = oi[Math.max(0, k - 1)].value
    const b = oi[k].value
    return a ? Math.max(0.5, Math.min(2, 1 + ((b - a) / a) * 10)) : 1
  }

  let max = 0
  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const notional = c.v * c.c * oiAt(c.t)
    // 1) new positions become liquidation levels
    for (const t of model.tiers) {
      const w = notional * t.weight
      cur[binOf(c.c * (1 - 1 / t.lev))] += w * model.longShare
      cur[binOf(c.c * (1 + 1 / t.lev))] += w * (1 - model.longShare)
    }
    // 2) price traded through a band → those positions were liquidated
    const a = binOf(c.l)
    const b = binOf(c.h)
    for (let k = a; k <= b; k++) cur[k] *= 0.08
    // 3) decay, then snapshot the column
    for (let k = 0; k < bins; k++) {
      cur[k] *= model.decayPerBar
      grid[i * bins + k] = cur[k]
      if (cur[k] > max) max = cur[k]
    }
  }

  const levels = Array.from({ length: bins }, (_, k) => ({
    price: lo + (k + 0.5) * binSize,
    value: cur[k],
  }))
    .filter((l) => l.value > 0)
    .sort((x, y) => y.value - x.value)
    .slice(0, 8)

  return {
    cols: n,
    bins,
    priceMin: lo,
    priceMax: hi,
    binSize,
    grid,
    max,
    times: candles.map((c) => c.t),
    candles,
    levels,
  }
}

/** Colour ramps as [r,g,b] stops across t ∈ [0,1]. */
export const COLORMAPS: Record<string, Array<[number, number, number]>> = {
  viridis: [
    [68, 1, 84],
    [59, 82, 139],
    [33, 145, 140],
    [94, 201, 98],
    [253, 231, 37],
  ],
  magma: [
    [0, 0, 4],
    [81, 18, 124],
    [183, 55, 121],
    [252, 137, 97],
    [252, 253, 191],
  ],
  ocean: [
    [3, 4, 46],
    [0, 60, 140],
    [0, 128, 200],
    [80, 200, 240],
    [230, 255, 255],
  ],
  solar: [
    [20, 12, 40],
    [110, 40, 40],
    [200, 100, 20],
    [250, 200, 40],
    [255, 255, 200],
  ],
}
export type ColormapId = keyof typeof COLORMAPS

export function colorAt(map: Array<[number, number, number]>, t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (map.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = map[i]
  const b = map[Math.min(map.length - 1, i + 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/** Threshold 0..1 → clip level: higher hides weak bands and favours the strongest clusters. */
export function clipLevel(h: Heatmap, threshold: number): number {
  const vals: number[] = []
  for (let i = 0; i < h.grid.length; i += 7) if (h.grid[i] > 0) vals.push(h.grid[i])
  if (!vals.length) return h.max || 1
  vals.sort((a, b) => a - b)
  const q =
    vals[
      Math.min(vals.length - 1, Math.floor(vals.length * Math.min(0.999, 0.5 + threshold * 0.499)))
    ]
  return Math.max(q, h.max * 0.02)
}

export const RANGES = [
  { id: '12h', label: '12 hour', tf: '1m', bars: 720 },
  { id: '24h', label: '24 hour', tf: '5m', bars: 288 },
  { id: '3d', label: '3 day', tf: '15m', bars: 288 },
  { id: '1w', label: '1 week', tf: '1h', bars: 168 },
  { id: '1m', label: '1 month', tf: '4h', bars: 180 },
]

export const fmtUsd = (v: number): string =>
  v >= 1e9
    ? (v / 1e9).toFixed(2) + 'B'
    : v >= 1e6
      ? (v / 1e6).toFixed(2) + 'M'
      : v >= 1e3
        ? (v / 1e3).toFixed(1) + 'K'
        : v.toFixed(0)
