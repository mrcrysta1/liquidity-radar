import type { MarketDataProvider, DerivativesProvider, Candle, Ticker, BookSnapshot, Funding, OpenInterest, OIPoint, LongShort, Interval, StatPeriod } from '@/core/providers/types';
import { toOkxSpot, toOkxSwap, split } from '@/core/symbols/registry';
import { getJSON, n } from './http';
import { isSubMinute } from '@/core/providers/types';

const BASE = 'https://www.okx.com';
const meta = { id: 'okx', name: 'OKX', label: 'FREE' as const, docs: 'https://www.okx.com/docs-v5/en/', requiresKey: false };
const IV: Partial<Record<Interval, string>> = { '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H','1d':'1D','1w':'1W','1M':'1M' };
const PERIOD: Record<StatPeriod, string> = { '5m':'5m','15m':'15m','1h':'1H','4h':'4H','1d':'1D' };
const ok = (r: any) => { if (r.code !== '0') throw new Error(`OKX ${r.code} ${r.msg}`); return r.data; };

export const okxSpot: MarketDataProvider = {
  meta,
  async klines(symbol, interval, limit = 300): Promise<Candle[]> {
    if (isSubMinute(interval)) throw new Error(`OKX has no sub-minute klines`);
    const rows = ok(await getJSON<any>(`${BASE}/api/v5/market/candles?instId=${toOkxSpot(symbol)}&bar=${IV[interval]}&limit=${Math.min(limit, 300)}`));
    return (rows as any[]).map(r => ({ time: n(r[0]) / 1000, open: n(r[1]), high: n(r[2]), low: n(r[3]), close: n(r[4]), volume: n(r[5]) })).reverse();
  },
  async ticker(symbol): Promise<Ticker> {
    const t = ok(await getJSON<any>(`${BASE}/api/v5/market/ticker?instId=${toOkxSpot(symbol)}`))[0];
    const open = n(t.open24h); const last = n(t.last);
    return { symbol, last, change24h: open ? ((last - open) / open) * 100 : 0, high24h: n(t.high24h), low24h: n(t.low24h), volume24h: n(t.vol24h), quoteVolume24h: n(t.volCcy24h) };
  },
  async depth(symbol, limit = 100): Promise<BookSnapshot> {
    const d = ok(await getJSON<any>(`${BASE}/api/v5/market/books?instId=${toOkxSpot(symbol)}&sz=${Math.min(limit, 400)}`))[0];
    return { bids: d.bids.map((x: string[]) => ({ price: n(x[0]), size: n(x[1]) })), asks: d.asks.map((x: string[]) => ({ price: n(x[0]), size: n(x[1]) })), ts: n(d.ts) };
  },
};

export const okxSwap: DerivativesProvider = {
  meta: { ...meta, id: 'okx-swap', name: 'OKX Swap' },
  async funding(symbol): Promise<Funding> {
    const f = ok(await getJSON<any>(`${BASE}/api/v5/public/funding-rate?instId=${toOkxSwap(symbol)}`))[0];
    const m = ok(await getJSON<any>(`${BASE}/api/v5/public/mark-price?instType=SWAP&instId=${toOkxSwap(symbol)}`))[0];
    return { symbol, rate: n(f.fundingRate), nextFundingTime: n(f.nextFundingTime), markPrice: n(m.markPx), indexPrice: 0 };
  },
  async openInterest(symbol): Promise<OpenInterest> {
    const o = ok(await getJSON<any>(`${BASE}/api/v5/public/open-interest?instType=SWAP&instId=${toOkxSwap(symbol)}`))[0];
    return { symbol, openInterest: n(o.oiCcy), ts: n(o.ts) };
  },
  async openInterestHistory(symbol, period, limit = 96): Promise<OIPoint[]> {
    const { base } = split(symbol);
    const rows = ok(await getJSON<any>(`${BASE}/api/v5/rubik/stat/contracts/open-interest-volume?ccy=${base}&period=${PERIOD[period]}`));
    return (rows as any[]).slice(0, limit).map(r => ({ ts: n(r[0]), openInterest: n(r[1]), openInterestValue: n(r[1]) })).reverse();
  },
  async longShortRatio(symbol, period, limit = 96): Promise<LongShort[]> {
    const { base } = split(symbol);
    const rows = ok(await getJSON<any>(`${BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=${base}&period=${PERIOD[period]}`));
    return (rows as any[]).slice(0, limit).map(r => { const ratio = n(r[1]); return { ts: n(r[0]), longAccount: ratio / (1 + ratio), shortAccount: 1 / (1 + ratio), ratio }; }).reverse();
  },
};
