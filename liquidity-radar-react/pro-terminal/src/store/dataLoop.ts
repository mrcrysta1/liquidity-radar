import { useEffect } from 'react';
import { useApp } from './useApp';
import { useMarket } from './useMarket';
import * as api from '@/providers';
import { binanceStreams } from '@/core/ws/binanceStream';
import { LocalOrderBook } from '@/core/ws/orderBook';
import { binanceSpot } from '@/providers/binance';
import { toBinance } from '@/core/symbols/registry';
import { getJSON } from '@/providers/http';
import { applyTrade } from '@/core/indicators/candles';
import { isSubMinute } from '@/core/timeframes';

/** Orchestrates REST polling (via ProviderChains) + WebSocket streams for the active symbol. */
export function useDataLoop() {
  const symbol = useApp(s => s.symbol); const interval = useApp(s => s.interval);
  const m = useMarket.getState;
  useEffect(() => {
    let alive = true; m().resetSymbol();
    const safe = <T,>(p: Promise<T>, tag: string) => p.catch(e => { m().pushError(`${tag}: ${e instanceof Error ? e.message : e}`); return undefined; });
    const pull = async () => {
      if (!alive) return;
      const [candles, ticker, funding, oi] = await Promise.all([
        safe(api.klines.get(symbol, interval as any, 500), 'klines'), safe(api.ticker.get(symbol), 'ticker'),
        safe(api.funding.get(symbol), 'funding'), safe(api.openInterest.get(symbol), 'oi')]);
      if (alive) m().set({ candles: candles ?? m().candles, ticker: ticker ?? m().ticker, funding: funding ?? m().funding, oi: oi ?? m().oi });
    };
    const pullSlow = async () => {
      const [oiHist, ls] = await Promise.all([safe(api.oiHistory.get(symbol, '1h', 96), 'oiHist'), safe(api.longShort.get(symbol, '1h', 96), 'longShort')]);
      if (alive) m().set({ oiHist: oiHist ?? m().oiHist, ls: ls ?? m().ls });
    };
    pull(); pullSlow();
    const t1 = setInterval(pull, isSubMinute(interval) ? 5_000 : 10_000); const t2 = setInterval(pullSlow, 60_000);

    // Order book: local L2 from Binance diff stream + snapshot; fallback: REST depth via chain every 2s.
    const lob = new LocalOrderBook(); let usingStream = false; let bookTimer: ReturnType<typeof setInterval> | undefined;
    const streamLive = () => usingStream && lob.ready && binanceStreams.status.spot === 'open';
    const pollBook = async () => { const d = await safe(api.depth.get(symbol, 100), 'depth'); if (d && alive && !streamLive()) m().set({ book: d }); };
    binanceStreams.subscribe(symbol);
    binanceStreams.onStatus = () => { m().set({ wsStatus: { ...binanceStreams.status } }); };
    const offDepth = binanceStreams.on('depth', d => { lob.applyDiff(d); });
    const offTrade = binanceStreams.on('trade', t => {
      m().pushTrade(t);
      const cur = m().candles; if (cur && cur.provider.startsWith('binance')) m().set({ candles: { ...cur, data: applyTrade(cur.data, t, interval as any), ts: Date.now(), freshness: 'LIVE' } });
    });
    const offMark = binanceStreams.on('mark', mk => m().set({ mark: mk }));
    const offLiq = binanceStreams.on('liq', l => m().pushLiq(l));
    getJSON<any>(`${(import.meta as any).env?.VITE_BINANCE_SPOT ?? 'https://api.binance.com'}/api/v3/depth?symbol=${toBinance(symbol)}&limit=1000`)
      .then(d => { lob.applySnapshot({ bids: d.bids.map((x: string[]) => ({ price: +x[0], size: +x[1] })), asks: d.asks.map((x: string[]) => ({ price: +x[0], size: +x[1] })), ts: Date.now(), lastUpdateId: d.lastUpdateId }); usingStream = true; })
      .catch(() => { usingStream = false; });
    void binanceSpot;
    const render = setInterval(() => {
      if (!alive) return;
      if (streamLive()) m().set({ book: { data: lob.top(50), provider: 'binance-ws', ts: Date.now(), freshness: 'LIVE', confidence: 1 } });
    }, 250);
    bookTimer = setInterval(pollBook, 2_000); pollBook();
    return () => { alive = false; clearInterval(t1); clearInterval(t2); clearInterval(render); if (bookTimer) clearInterval(bookTimer); offDepth(); offTrade(); offMark(); offLiq(); binanceStreams.close(); };
  }, [symbol, interval]);
}
