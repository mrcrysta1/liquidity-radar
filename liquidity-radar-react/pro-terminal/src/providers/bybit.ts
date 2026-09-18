import type { MarketDataProvider, DerivativesProvider, Candle, Ticker, BookSnapshot, Funding, OpenInterest, OIPoint, LongShort, Interval, StatPeriod } from '@/core/providers/types';
import { toBybit } from '@/core/symbols/registry';
import { getJSON, n } from './http';
import { isSubMinute } from '@/core/providers/types';

const BASE = 'https://api.bybit.com';
const meta = { id: 'bybit', name: 'Bybit', label: 'FREE' as const, docs: 'https://bybit-exchange.github.io/docs/v5/intro', requiresKey: false };
const IV: Partial<Record<Interval, string>> = { '1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W','1M':'M' };
const PERIOD: Record<StatPeriod, string> = { '5m':'5min','15m':'15min','1h':'1h','4h':'4h','1d':'1d' };
const ok = (r: any) => { if (r.retCode !== 0) throw new Error(`Bybit ${r.retCode} ${r.retMsg}`); return r.result; };

export const bybitSpot: MarketDataProvider = {
  meta,
  async klines(symbol, interval, limit = 500): Promise<Candle[]> {
    if (isSubMinute(interval)) throw new Error(`Bybit has no sub-minute klines`);
    const res = ok(await getJSON<any>(`${BASE}/v5/market/kline?category=spot&symbol=${toBybit(symbol)}&interval=${IV[interval]}&limit=${Math.min(limit, 1000)}`));
    return (res.list as any[]).map(r => ({ time: n(r[0]) / 1000, open: n(r[1]), high: n(r[2]), low: n(r[3]), close: n(r[4]), volume: n(r[5]) })).reverse();
  },
  async ticker(symbol): Promise<Ticker> {
    const t = ok(await getJSON<any>(`${BASE}/v5/market/tickers?category=spot&symbol=${toBybit(symbol)}`)).list[0];
    return { symbol, last: n(t.lastPrice), change24h: n(t.price24hPcnt) * 100, high24h: n(t.highPrice24h), low24h: n(t.lowPrice24h), volume24h: n(t.volume24h), quoteVolume24h: n(t.turnover24h) };
  },
  async depth(symbol, limit = 100): Promise<BookSnapshot> {
    const d = ok(await getJSON<any>(`${BASE}/v5/market/orderbook?category=spot&symbol=${toBybit(symbol)}&limit=${Math.min(limit, 200)}`));
    return { bids: d.b.map((x: string[]) => ({ price: n(x[0]), size: n(x[1]) })), asks: d.a.map((x: string[]) => ({ price: n(x[0]), size: n(x[1]) })), ts: n(d.ts) };
  },
};

export const bybitLinear: DerivativesProvider = {
  meta: { ...meta, id: 'bybit-linear', name: 'Bybit Linear' },
  async funding(symbol): Promise<Funding> {
    const t = ok(await getJSON<any>(`${BASE}/v5/market/tickers?category=linear&symbol=${toBybit(symbol)}`)).list[0];
    return { symbol, rate: n(t.fundingRate), nextFundingTime: n(t.nextFundingTime), markPrice: n(t.markPrice), indexPrice: n(t.indexPrice) };
  },
  async openInterest(symbol): Promise<OpenInterest> {
    const t = ok(await getJSON<any>(`${BASE}/v5/market/tickers?category=linear&symbol=${toBybit(symbol)}`)).list[0];
    return { symbol, openInterest: n(t.openInterest), openInterestValue: n(t.openInterestValue), ts: Date.now() };
  },
  async openInterestHistory(symbol, period, limit = 96): Promise<OIPoint[]> {
    const res = ok(await getJSON<any>(`${BASE}/v5/market/open-interest?category=linear&symbol=${toBybit(symbol)}&intervalTime=${PERIOD[period]}&limit=${Math.min(limit, 200)}`));
    return (res.list as any[]).map(r => ({ ts: n(r.timestamp), openInterest: n(r.openInterest), openInterestValue: 0 })).reverse();
  },
  async longShortRatio(symbol, period, limit = 96): Promise<LongShort[]> {
    const res = ok(await getJSON<any>(`${BASE}/v5/market/account-ratio?category=linear&symbol=${toBybit(symbol)}&period=${PERIOD[period]}&limit=${Math.min(limit, 500)}`));
    return (res.list as any[]).map(r => ({ ts: n(r.timestamp), longAccount: n(r.buyRatio), shortAccount: n(r.sellRatio), ratio: n(r.buyRatio) / Math.max(n(r.sellRatio), 1e-9) })).reverse();
  },
};
