import type { Candle, Interval, Trade } from '../providers/types';
import { parseTimeframe } from '../timeframes';

/** Aggregate finer candles into coarser buckets (e.g. 1s → 15s). Buckets align to epoch. */
export function aggregate(src: Candle[], sec: number): Candle[] {
  const out: Candle[] = [];
  for (const k of src) {
    const t = Math.floor(k.time / sec) * sec; const last = out[out.length - 1];
    if (last && last.time === t) { last.high = Math.max(last.high, k.high); last.low = Math.min(last.low, k.low); last.close = k.close; last.volume += k.volume; }
    else out.push({ time: t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume });
  }
  return out;
}

/** Apply a live trade to the candle array in place (returns new array reference for React). */
export function applyTrade(candles: Candle[], trade: Trade, interval: Interval): Candle[] {
  const sec = parseTimeframe(interval) ?? 60; const t = Math.floor(trade.ts / 1000 / sec) * sec;
  const last = candles[candles.length - 1];
  if (!last || t > last.time) {
    const next: Candle = { time: t, open: trade.price, high: trade.price, low: trade.price, close: trade.price, volume: trade.qty };
    return [...candles, next].slice(-2000);
  }
  if (t < last.time) return candles; // late trade, ignore
  const upd = { ...last, high: Math.max(last.high, trade.price), low: Math.min(last.low, trade.price), close: trade.price, volume: last.volume + trade.qty };
  return [...candles.slice(0, -1), upd];
}
