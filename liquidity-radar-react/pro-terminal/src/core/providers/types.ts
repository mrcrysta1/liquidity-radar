export type Freshness = 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE' | 'FALLBACK';
export type ProviderLabel = 'FREE' | 'FREE TIER' | 'OPEN SOURCE' | 'PUBLIC DATA';

export interface Envelope<T> {
  data: T;
  provider: string;
  ts: number;
  freshness: Freshness;
  confidence: number;
  error?: string;
}

export interface ProviderMeta { id: string; name: string; label: ProviderLabel; docs: string; requiresKey: boolean }

export type Interval = '1s'|'15s'|'30s'|'1m'|'3m'|'5m'|'15m'|'30m'|'1h'|'2h'|'4h'|'6h'|'12h'|'1d'|'1w'|'1M';
export const INTERVALS: Interval[] = ['1s','15s','30s','1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w','1M'];

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface Ticker { symbol: string; last: number; change24h: number; high24h: number; low24h: number; volume24h: number; quoteVolume24h: number }
export interface BookLevel { price: number; size: number }
export interface BookSnapshot { bids: BookLevel[]; asks: BookLevel[]; ts: number }
export interface Funding { symbol: string; rate: number; nextFundingTime: number; markPrice: number; indexPrice: number }
export interface OpenInterest { symbol: string; openInterest: number; openInterestValue?: number; ts: number }
export interface OIPoint { ts: number; openInterest: number; openInterestValue: number }
export interface LongShort { ts: number; longAccount: number; shortAccount: number; ratio: number }
export interface Liquidation { symbol: string; side: 'BUY' | 'SELL'; price: number; qty: number; ts: number; exchange: string }
export interface Trade { price: number; qty: number; ts: number; isBuyerMaker: boolean }
export type CanonSymbol = string; // "BTC-USDT"
export type StatPeriod = '5m'|'15m'|'1h'|'4h'|'1d';

export interface MarketDataProvider {
  meta: ProviderMeta;
  klines(symbol: CanonSymbol, interval: Interval, limit?: number): Promise<Candle[]>;
  ticker(symbol: CanonSymbol): Promise<Ticker>;
  depth(symbol: CanonSymbol, limit?: number): Promise<BookSnapshot>;
}
export interface DerivativesProvider {
  meta: ProviderMeta;
  funding(symbol: CanonSymbol): Promise<Funding>;
  openInterest(symbol: CanonSymbol): Promise<OpenInterest>;
  openInterestHistory(symbol: CanonSymbol, period: StatPeriod, limit?: number): Promise<OIPoint[]>;
  longShortRatio(symbol: CanonSymbol, period: StatPeriod, limit?: number): Promise<LongShort[]>;
}

export const INTERVAL_SECONDS: Record<Interval, number> = { '1s':1,'15s':15,'30s':30,'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'12h':43200,'1d':86400,'1w':604800,'1M':2592000 };
export const isSubMinute = (i: Interval) => INTERVAL_SECONDS[i] < 60;
