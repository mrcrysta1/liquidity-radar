import type { Candle } from '../providers/types';
/**
 * Range bars: each bar spans at most `range` in price; a new bar opens when the range would be exceeded.
 * Built from time candles by walking O→L→H→C (up) or O→H→L→C (down): an approximation of tick-built bars.
 * Times are kept strictly increasing (lightweight-charts requirement).
 */
export function buildRangeBars(src: Candle[], range: number): Candle[] {
  if (!src.length || range <= 0) return [];
  const out: Candle[] = []; let cur: Candle | null = null; let lastT = 0;
  const bar = (): Candle => cur as Candle;
  const push = (price: number, vol: number, t: number) => {
    if (!cur) { const tt = Math.max(t, lastT + 1); cur = { time: tt, open: price, high: price, low: price, close: price, volume: vol }; return; }
    const b = bar(); b.close = price; b.volume += vol; if (price > b.high) b.high = price; if (price < b.low) b.low = price;
    while (bar().high - bar().low > range) {
      const cb = bar(); const up: boolean = price > cb.open; const boundary: number = up ? cb.low + range : cb.high - range;
      const done: Candle = { ...cb, high: up ? boundary : cb.high, low: up ? cb.low : boundary, close: boundary };
      out.push(done); lastT = done.time; const tt = Math.max(t, lastT + 1);
      cur = { time: tt, open: boundary, high: Math.max(boundary, price), low: Math.min(boundary, price), close: price, volume: 0 };
    }
  };
  for (const k of src) { const path = k.close >= k.open ? [k.open, k.low, k.high, k.close] : [k.open, k.high, k.low, k.close]; const v = k.volume / 4; for (const p of path) push(p, v, k.time); }
  if (cur) out.push(cur);
  return out;
}
