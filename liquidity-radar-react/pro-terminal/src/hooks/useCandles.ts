import { useEffect, useRef, useState, useCallback } from 'react';
import type { Candle, Envelope } from '@/core/providers/types';
import { klines, klinesBefore, MAX_HISTORY_BARS } from '@/providers';
import { streamHub } from '@/core/ws/streamHub';
import { parseTimeframe, isNative, baseFor } from '@/core/timeframes';
import { aggregate } from '@/core/indicators/candles';

/**
 * Per-chart candle source: initial load via ProviderChain, live updates via the multiplexed kline hub
 * (custom timeframes are re-aggregated from their native base), and backwards pagination up to 40,000 bars.
 */
export function useCandles(symbol: string, timeframe: string) {
  const [env, setEnv] = useState<Envelope<Candle[]>>(); const [loadingMore, setLoadingMore] = useState(false); const [exhausted, setExhausted] = useState(false);
  const baseRef = useRef<Candle[]>([]); // native-base candles when timeframe is custom
  const sec = parseTimeframe(timeframe) ?? 900; const native = isNative(timeframe); const { base } = native ? { base: timeframe } : baseFor(sec);

  useEffect(() => {
    let alive = true; setEnv(undefined); setExhausted(false); baseRef.current = [];
    klines.get(symbol, timeframe as any, 500).then(e => { if (alive) setEnv(e); }).catch(e => alive && setEnv({ data: [], provider: 'none', ts: Date.now(), freshness: 'OFFLINE', confidence: 0, error: String(e?.message ?? e) }));
    let off: (() => void) | undefined;
    try {
      off = streamHub.subscribe(symbol, base, k => {
        setEnv(prev => {
          if (!prev) return prev; const data = prev.data.slice(); if (!data.length) return prev;
          const t = native ? k.time : Math.floor(k.time / sec) * sec; const last = data[data.length - 1];
          if (native) { if (t === last.time) data[data.length - 1] = { time: t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }; else if (t > last.time) data.push({ time: t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }); else return prev; }
          else {
            // maintain the current custom bucket from base updates
            const b = baseRef.current; const i = b.findIndex(x => x.time === k.time);
            if (i >= 0) b[i] = { time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }; else if (!b.length || k.time > b[b.length - 1].time) b.push({ time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume });
            const cutoff = t; const inBucket = b.filter(x => x.time >= cutoff); if (!inBucket.length) return prev;
            const agg = aggregate(inBucket, sec)[0];
            if (t === last.time) data[data.length - 1] = agg; else if (t > last.time) data.push(agg); else return prev;
          }
          return { ...prev, data, ts: Date.now(), freshness: 'LIVE' };
        });
      });
    } catch (e) { /* stream cap reached — chart still polls */ }
    const poll = setInterval(() => { klines.get(symbol, timeframe as any, 500).then(e => { if (!alive) return; setEnv(prev => { if (!prev || prev.data.length <= 500) return e; const merged = [...prev.data.filter(c => c.time < e.data[0].time), ...e.data]; return { ...e, data: merged }; }); }).catch(() => {}); }, 15_000);
    return () => { alive = false; off?.(); clearInterval(poll); };
  }, [symbol, timeframe]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || !env || !env.data.length || env.data.length >= MAX_HISTORY_BARS) return;
    setLoadingMore(true);
    try {
      const want = Math.min(1000, MAX_HISTORY_BARS - env.data.length); const end = env.data[0].time * 1000 - 1;
      const older = await klinesBefore.get(symbol, timeframe, want, end);
      const fresh = older.data.filter(c => c.time < env.data[0].time);
      if (!fresh.length) setExhausted(true); else setEnv(prev => prev ? { ...prev, data: [...fresh, ...prev.data] } : prev);
    } catch { setExhausted(true); } finally { setLoadingMore(false); }
  }, [env, loadingMore, exhausted, symbol, timeframe]);

  return { env, loadMore, loadingMore, exhausted, bars: env?.data.length ?? 0, maxBars: MAX_HISTORY_BARS };
}
