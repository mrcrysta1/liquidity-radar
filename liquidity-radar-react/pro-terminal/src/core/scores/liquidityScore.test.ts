import { describe, it, expect } from 'vitest';
import { bookMetrics, liquidityScore } from './liquidityScore';
import { classifyPriceOI } from '../analysis/priceOI';
const mk = (mid: number, levels: number, size: number, step = 1) => ({
  bids: Array.from({ length: levels }, (_, i) => ({ price: mid - step * (i + 1), size })),
  asks: Array.from({ length: levels }, (_, i) => ({ price: mid + step * (i + 1), size })), ts: 0 });
describe('liquidity score', () => {
  it('deep book scores higher than thin book', () => {
    const deep = liquidityScore(bookMetrics(mk(100_000, 50, 10, 1)), 5e9);
    const thin = liquidityScore(bookMetrics(mk(100_000, 5, 0.01, 50)), 1e5);
    expect(deep.value).toBeGreaterThan(thin.value);
    expect(deep.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
  });
  it('detects walls and imbalance', () => {
    const b = mk(100, 20, 1); b.bids[0].size = 50;
    const m = bookMetrics(b); expect(m.walls[0]).toMatchObject({ side: 'bid', price: 99 }); expect(m.imbalance1).toBeGreaterThan(0);
  });
  it('price/OI matrix', () => {
    expect(classifyPriceOI(2, 3).regime).toBe('LONG_BUILDUP'); expect(classifyPriceOI(2, -3).regime).toBe('SHORT_COVERING');
    expect(classifyPriceOI(-2, 3).regime).toBe('SHORT_BUILDUP'); expect(classifyPriceOI(-2, -3).regime).toBe('LONG_LIQUIDATION');
  });
});
