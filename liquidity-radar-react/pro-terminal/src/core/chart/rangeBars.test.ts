import { describe, it, expect } from 'vitest';
import { buildRangeBars } from './rangeBars';
describe('range bars', () => {
  it('bars never exceed the range and times strictly increase', () => {
    const src = Array.from({ length: 200 }, (_, i) => { const o = 100 + Math.sin(i / 5) * 10; const c = o + (i % 3 - 1) * 2; return { time: 1000 + i * 60, open: o, high: Math.max(o, c) + 1, low: Math.min(o, c) - 1, close: c, volume: 4 }; });
    const rb = buildRangeBars(src, 3); expect(rb.length).toBeGreaterThan(10);
    rb.forEach(b => expect(b.high - b.low).toBeLessThanOrEqual(3 + 1e-9));
    for (let i = 1; i < rb.length; i++) expect(rb[i].time).toBeGreaterThan(rb[i - 1].time);
  });
});
