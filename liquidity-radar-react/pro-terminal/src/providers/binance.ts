import type { MarketDataProvider, DerivativesProvider, Candle, Ticker, BookSnapshot, Funding, OpenInterest, OIPoint, LongShort, Interval, StatPeriod } from '@/core/providers/types';
import { toBinance } from '@/core/symbols/registry';
import { getJSON, n } from './http';
import { aggregate } from '@/core/indicators/candles';
import { parseTimeframe, isNative, baseFor } from '@/core/timeframes';

/** Binance public endpoints — FREE, no key. US IPs: set VITE_BINANCE_SPOT=https://data-api.binance.vision */
const SPOT = (import.meta as any).env?.VITE_BINANCE_SPOT ?? 'https://api.binance.com';
const FUT = 'https://fapi.binance.com';
const meta = { id: 'binance', name: 'Binance', label: 'FREE' as const, docs: 'https://developers.binance.com/docs', requiresKey: false };

export const binanceSpot: MarketDataProvider = {
  meta,
  async klines(symbol, interval: Interval, limit = 500): Promise<Candle[]> { return binanceKlines(symbol, interval, limit); },
  async ticker(symbol): Promise<Ticker> {
    const t = await getJSON<any>(`${SPOT}/api/v3/ticker/24hr?symbol=${toBinance(symbol)}`);
    return { symbol, last: n(t.lastPrice), change24h: n(t.priceChangePercent), high24h: n(t.highPrice), low24h: n(t.lowPrice), volume24h: n(t.volume), quoteVolume24h: n(t.quoteVolume) };
  },
  async depth(symbol, limit = 100): Promise<BookSnapshot> {
    const d = await getJSON<any>(`${SPOT}/api/v3/depth?symbol=${toBinance(symbol)}&limit=${limit}`);
    return { bids: d.bids.map((b: string[]) => ({ price: n(b[0]), size: n(b[1]) })), asks: d.asks.map((a: string[]) => ({ price: n(a[0]), size: n(a[1]) })), ts: Date.now() };
  },
};

export const binanceFutures: DerivativesProvider = {
  meta: { ...meta, id: 'binance-futures', name: 'Binance USD-M' },
  async funding(symbol): Promise<Funding> {
    const p = await getJSON<any>(`${FUT}/fapi/v1/premiumIndex?symbol=${toBinance(symbol)}`);
    return { symbol, rate: n(p.lastFundingRate), nextFundingTime: n(p.nextFundingTime), markPrice: n(p.markPrice), indexPrice: n(p.indexPrice) };
  },
  async openInterest(symbol): Promise<OpenInterest> {
    const o = await getJSON<any>(`${FUT}/fapi/v1/openInterest?symbol=${toBinance(symbol)}`);
    return { symbol, openInterest: n(o.openInterest), ts: n(o.time) };
  },
  async openInterestHistory(symbol, period: StatPeriod, limit = 96): Promise<OIPoint[]> {
    const rows = await getJSON<any[]>(`${FUT}/futures/data/openInterestHist?symbol=${toBinance(symbol)}&period=${period}&limit=${limit}`);
    return rows.map(r => ({ ts: n(r.timestamp), openInterest: n(r.sumOpenInterest), openInterestValue: n(r.sumOpenInterestValue) }));
  },
  async longShortRatio(symbol, period: StatPeriod, limit = 96): Promise<LongShort[]> {
    const rows = await getJSON<any[]>(`${FUT}/futures/data/globalLongShortAccountRatio?symbol=${toBinance(symbol)}&period=${period}&limit=${limit}`);
    return rows.map(r => ({ ts: n(r.timestamp), longAccount: n(r.longAccount), shortAccount: n(r.shortAccount), ratio: n(r.longShortRatio) }));
  },
};

const mapRows = (rows: any[]): Candle[] => rows.map(r => ({ time: r[0] / 1000, open: n(r[1]), high: n(r[2]), low: n(r[3]), close: n(r[4]), volume: n(r[5]) }));
/**
 * Fetch `limit` bars of any timeframe ending at `endTimeMs` (default now). Native intervals are fetched directly
 * (paginated, 1000/req); custom ones (15s, 45m, 3d…) are built from the largest dividing native interval.
 */
export async function binanceKlines(symbol: string, tf: string, limit: number, endTimeMs?: number): Promise<Candle[]> {
  const sec = parseTimeframe(tf); if (!sec) throw new Error(`bad timeframe ${tf}`);
  const { base, factor } = isNative(tf) ? { base: tf, factor: 1 } : baseFor(sec);
  const needBase = limit * factor; let end = endTimeMs ?? Date.now(); let all: Candle[] = [];
  while (all.length < needBase) {
    const take = Math.min(1000, needBase - all.length);
    const rows = mapRows(await getJSON<any[]>(`${SPOT}/api/v3/klines?symbol=${toBinance(symbol)}&interval=${base}&limit=${take}&endTime=${end}`));
    if (!rows.length) break; all = [...rows, ...all]; end = rows[0].time * 1000 - 1; if (rows.length < take) break;
  }
  return factor === 1 ? all : aggregate(all, sec);
}
