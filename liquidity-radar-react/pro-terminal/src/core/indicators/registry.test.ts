import { describe, it, expect } from 'vitest';
import { computeAll } from './registry';
import { volumeProfile } from './volumeProfile';
const c = Array.from({ length: 120 }, (_, i) => ({ time: i * 60, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10 + (i % 5) }));
describe('indicator registry', () => {
  it('indicator on indicator: EMA of RSI shares the RSI pane', () => {
    const r = computeAll([{ uid: 'a', type: 'rsi', params: { length: 14 }, source: 'close', visible: true }, { uid: 'b', type: 'ema', params: { length: 5 }, source: 'a.v', visible: true }], c);
    expect(r.length).toBe(2); expect(r[1].paneKey).toBe('a'); expect(r[1].outputs.v.filter(v => v != null).length).toBeGreaterThan(50);
  });
  it('skips instances whose source is missing', () => { expect(computeAll([{ uid: 'b', type: 'ema', params: {}, source: 'zzz.v', visible: true }], c).length).toBe(0); });
  it('volume profile value area contains POC', () => { const vp = volumeProfile(c, 24)!; expect(vp.val).toBeLessThanOrEqual(vp.poc); expect(vp.vah).toBeGreaterThanOrEqual(vp.poc); });
});
