import { describe, it, expect } from 'vitest';
import { buildHeatmap, MODELS, colorAt, COLORMAPS, clipLevel } from './heatmap';
const c = Array.from({ length: 200 }, (_, i) => { const p = 100 + Math.sin(i / 20) * 5; return { time: i * 300, open: p, high: p + 0.3, low: p - 0.3, close: p, volume: 100 }; });
describe('liquidation heatmap model', () => {
  it('builds a grid with bands above and below price that persist until crossed', () => {
    const h = buildHeatmap(c, { bins: 120, model: MODELS[0] })!; expect(h.cols).toBe(200); expect(h.max).toBeGreaterThan(0);
    const lastCol = h.grid.subarray((h.cols - 1) * h.bins, h.cols * h.bins); const nonzero = [...lastCol].filter(v => v > 0).length; expect(nonzero).toBeGreaterThan(5);
    // 10x long liquidation level ~ 90% of price should carry mass; bins around current price should be near-empty (cleared by trading)
    const cur = c[c.length - 1].close; const binOf = (p: number) => Math.min(h.bins - 2, Math.max(1, Math.floor((p - h.priceMin) / h.binSize)));
    expect(lastCol[binOf(cur)]).toBeLessThan(lastCol[binOf(cur * 0.9)] + lastCol[binOf(cur * 0.9) - 1] + lastCol[binOf(cur * 0.9) + 1] + 1e-9);
    expect(h.levels.length).toBeGreaterThan(0);
  });
  it('colormap + clip', () => { expect(colorAt(COLORMAPS.viridis, 1)).toEqual([253, 231, 37]); const h = buildHeatmap(c, { bins: 60, model: MODELS[1] })!; expect(clipLevel(h, 0.85)).toBeLessThanOrEqual(h.max); });
});
