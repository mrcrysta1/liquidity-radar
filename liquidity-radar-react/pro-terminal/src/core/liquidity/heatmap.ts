import type { Candle } from '../providers/types';

/**
 * Liquidation heatmap — ESTIMATE, built only from public candles (+ optional OI history).
 * Idea (same as the well-known heatmap products): every bar opens new leveraged positions around its price; each
 * leverage tier implies a liquidation price (long: p·(1−1/L), short: p·(1+1/L)). Those levels accumulate as
 * horizontal "liquidity" bands that persist through time until price trades through them (liquidated → cleared).
 * Nobody outside the exchange knows real positions, so this is a model, labelled as such in the UI.
 */
export interface LeverageTier { lev: number; weight: number }
export interface HeatmapModel { id: string; name: string; tiers: LeverageTier[]; longShare: number; decayPerBar: number; description: string }
export const MODELS: HeatmapModel[] = [
  { id: 'm1', name: 'Model 1', tiers: [{ lev: 10, weight: 0.15 }, { lev: 25, weight: 0.35 }, { lev: 50, weight: 0.3 }, { lev: 100, weight: 0.2 }], longShare: 0.5, decayPerBar: 0.995, description: 'Retail-heavy: 25x–100x dominant, slow decay' },
  { id: 'm2', name: 'Model 2', tiers: [{ lev: 5, weight: 0.2 }, { lev: 10, weight: 0.35 }, { lev: 20, weight: 0.3 }, { lev: 50, weight: 0.15 }], longShare: 0.5, decayPerBar: 0.99, description: 'Balanced: 5x–50x, medium decay' },
  { id: 'm3', name: 'Model 3', tiers: [{ lev: 3, weight: 0.3 }, { lev: 5, weight: 0.35 }, { lev: 10, weight: 0.35 }], longShare: 0.5, decayPerBar: 0.985, description: 'Low-leverage / swing positioning, faster decay' },
];
export interface HeatmapOptions { bins: number; model: HeatmapModel; oi?: { ts: number; openInterestValue: number }[] }
export interface Heatmap { cols: number; bins: number; priceMin: number; priceMax: number; binSize: number; grid: Float32Array /* cols*bins, col-major */; max: number; times: number[]; candles: Candle[]; levels: { price: number; value: number }[] }

export function buildHeatmap(candles: Candle[], opts: HeatmapOptions): Heatmap | null {
  const n = candles.length; if (n < 10) return null;
  const { bins, model } = opts;
  let lo = Infinity, hi = -Infinity; for (const c of candles) { lo = Math.min(lo, c.low); hi = Math.max(hi, c.high); }
  const maxLev = Math.max(...model.tiers.map(t => t.lev)); const minLev = Math.min(...model.tiers.map(t => t.lev));
  // extend range so far liquidation levels (low leverage) are visible, but keep the chart readable
  const pad = Math.min(hi * 0.1, Math.max((hi - lo) * 0.2, hi / minLev * 1.1)); lo -= pad; hi += pad; if (!(hi > lo)) return null;
  const binSize = (hi - lo) / bins; const grid = new Float32Array(n * bins); const cur = new Float32Array(bins);
  const binOf = (p: number) => Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / binSize)));
  // notional per bar: volume × price, scaled by OI change when available (OI rising → more new positions)
  const oiAt = (ts: number) => { const o = opts.oi; if (!o || o.length < 2) return 1; let k = 0; while (k + 1 < o.length && o[k + 1].ts <= ts * 1000) k++; const a = o[Math.max(0, k - 1)].openInterestValue, b = o[k].openInterestValue; return a ? Math.max(0.5, Math.min(2, 1 + (b - a) / a * 10)) : 1; };
  let max = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i]; const notional = c.volume * c.close * oiAt(c.time);
    // 1) new positions → liquidation levels
    for (const t of model.tiers) {
      const w = notional * t.weight; const lp = c.close * (1 - 1 / t.lev), sp = c.close * (1 + 1 / t.lev);
      cur[binOf(lp)] += w * model.longShare; cur[binOf(sp)] += w * (1 - model.longShare);
    }
    // 2) price traded through a band → those positions got liquidated → clear (leave 8% residue for visual continuity)
    const a = binOf(c.low), b = binOf(c.high); for (let k = a; k <= b; k++) cur[k] *= 0.08;
    // 3) decay + snapshot
    for (let k = 0; k < bins; k++) { cur[k] *= model.decayPerBar; grid[i * bins + k] = cur[k]; if (cur[k] > max) max = cur[k]; }
    void maxLev;
  }
  const levels = Array.from({ length: bins }, (_, k) => ({ price: lo + (k + 0.5) * binSize, value: cur[k] })).filter(l => l.value > 0).sort((x, y) => y.value - x.value).slice(0, 8);
  return { cols: n, bins, priceMin: lo, priceMax: hi, binSize, grid, max, times: candles.map(c => c.time), candles, levels };
}

/** Colormaps as [r,g,b] stops at t∈[0,1] */
export const COLORMAPS: Record<string, [number, number, number][]> = {
  viridis: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]],
  magma: [[0, 0, 4], [81, 18, 124], [183, 55, 121], [252, 137, 97], [252, 253, 191]],
  ocean: [[3, 4, 46], [0, 60, 140], [0, 128, 200], [80, 200, 240], [230, 255, 255]],
  solar: [[20, 12, 40], [110, 40, 40], [200, 100, 20], [250, 200, 40], [255, 255, 200]],
};
export function colorAt(map: [number, number, number][], t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (map.length - 1); const i = Math.floor(x), f = x - i; const a = map[i], b = map[Math.min(map.length - 1, i + 1)];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** Threshold 0..1 → clip level (percentile-like): higher threshold hides weak bands and emphasises the strongest clusters. */
export function clipLevel(h: Heatmap, threshold: number): number {
  const vals: number[] = []; for (let i = 0; i < h.grid.length; i += 7) if (h.grid[i] > 0) vals.push(h.grid[i]);
  if (!vals.length) return h.max || 1; vals.sort((a, b) => a - b); const q = vals[Math.min(vals.length - 1, Math.floor(vals.length * Math.min(0.999, 0.5 + threshold * 0.499)))];
  return Math.max(q, h.max * 0.02);
}
