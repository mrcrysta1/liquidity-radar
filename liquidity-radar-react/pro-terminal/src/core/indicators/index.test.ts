import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, bollinger, atr, macd, wma } from './index';
import type { Candle } from '../providers/types';
const close = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28,46.00,46.03,46.41,46.22,45.64,46.21,46.25,45.71,46.45,45.78,45.35,44.03,44.18,44.22,44.57,43.42,42.66,43.13];
describe('indicators', () => {
  it('sma', () => { expect(sma([1,2,3,4,5], 3)).toEqual([null,null,2,3,4]); });
  it('wma', () => { expect(wma([1,2,3], 3)[2]).toBeCloseTo((1*1+2*2+3*3)/6); });
  it('ema seeds with sma', () => { const e = ema([1,2,3,4,5], 3); expect(e[2]).toBe(2); expect(e[3]).toBeCloseTo(3); });
  it('rsi(14) matches Wilder reference (~70.53 at idx 14)', () => { expect(rsi(close, 14)[14] as number).toBeCloseTo(70.5, 0); });
  it('bollinger bands symmetric', () => { const b = bollinger(close, 20); const i = 25; expect(((b.upper[i] as number) + (b.lower[i] as number)) / 2).toBeCloseTo(b.mid[i] as number, 8); });
  it('atr positive', () => { const c: Candle[] = close.map((v, i) => ({ time: i, open: v, high: v + 1, low: v - 1, close: v, volume: 1 })); expect(atr(c, 14)[20] as number).toBeGreaterThan(0); });
  it('macd hist = line - signal', () => { const long = [...close, ...close, ...close]; const m = macd(long); const i = long.length - 1; expect(m.hist[i] as number).toBeCloseTo((m.line[i] as number) - (m.signal[i] as number)); });
});
