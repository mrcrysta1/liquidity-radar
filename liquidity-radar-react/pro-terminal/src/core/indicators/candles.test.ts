import { describe, it, expect } from 'vitest';
import { aggregate, applyTrade } from './candles';
const c = (time: number, p: number, v = 1) => ({ time, open: p, high: p + 1, low: p - 1, close: p, volume: v });
describe('candles', () => {
  it('aggregates 1s into 15s buckets', () => {
    const src = Array.from({ length: 45 }, (_, i) => c(1000 + i, 100 + i));
    const out = aggregate(src, 15);
    expect(out.length).toBe(4); expect(out[0].time).toBe(990); expect(out[0].open).toBe(100); expect(out[0].close).toBe(104); expect(out[0].volume).toBe(5);
    expect(out[1].time).toBe(1005); expect(out[1].volume).toBe(15);
  });
  it('applyTrade updates current bucket or opens a new one', () => {
    let cs = [c(990, 100)];
    cs = applyTrade(cs, { price: 105, qty: 2, ts: 1010_000, isBuyerMaker: false }, '30s');
    expect(cs.length).toBe(1); expect(cs[0].high).toBe(105); expect(cs[0].volume).toBe(3);
    cs = applyTrade(cs, { price: 90, qty: 1, ts: 1031_000, isBuyerMaker: true }, '30s');
    expect(cs.length).toBe(2); expect(cs[1].time).toBe(1020); expect(cs[1].open).toBe(90);
  });
});
