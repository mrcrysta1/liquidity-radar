import { ProviderChain } from '@/core/providers/chain';
import type { Candle, Ticker, BookSnapshot, Funding, OpenInterest, OIPoint, LongShort, Interval, StatPeriod, CanonSymbol, ProviderMeta } from '@/core/providers/types';
import { binanceSpot, binanceFutures, binanceKlines } from './binance';
import { bybitSpot, bybitLinear } from './bybit';
import { okxSpot, okxSwap } from './okx';

/** Primary → Fallback order. Change order here, nowhere else. */
export const spotProviders = [binanceSpot, bybitSpot, okxSpot];
export const derivProviders = [binanceFutures, bybitLinear, okxSwap];
export const providerRegistry: ProviderMeta[] = [...spotProviders, ...derivProviders].map(p => p.meta);

export const klines = new ProviderChain<[CanonSymbol, Interval, number], Candle[]>(spotProviders.map(p => ({ id: p.meta.id, fn: (s, i, l) => p.klines(s, i, l) })), { cacheTtlMs: 3_000 });
export const ticker = new ProviderChain<[CanonSymbol], Ticker>(spotProviders.map(p => ({ id: p.meta.id, fn: s => p.ticker(s) })), { cacheTtlMs: 3_000 });
export const depth = new ProviderChain<[CanonSymbol, number], BookSnapshot>(spotProviders.map(p => ({ id: p.meta.id, fn: (s, l) => p.depth(s, l) })), { cacheTtlMs: 1_000 });
export const funding = new ProviderChain<[CanonSymbol], Funding>(derivProviders.map(p => ({ id: p.meta.id, fn: s => p.funding(s) })), { cacheTtlMs: 15_000 });
export const openInterest = new ProviderChain<[CanonSymbol], OpenInterest>(derivProviders.map(p => ({ id: p.meta.id, fn: s => p.openInterest(s) })), { cacheTtlMs: 15_000 });
export const oiHistory = new ProviderChain<[CanonSymbol, StatPeriod, number], OIPoint[]>(derivProviders.map(p => ({ id: p.meta.id, fn: (s, pd, l) => p.openInterestHistory(s, pd, l) })), { cacheTtlMs: 60_000 });
export const longShort = new ProviderChain<[CanonSymbol, StatPeriod, number], LongShort[]>(derivProviders.map(p => ({ id: p.meta.id, fn: (s, pd, l) => p.longShortRatio(s, pd, l) })), { cacheTtlMs: 60_000 });

/** Per-exchange fan-out for the cross-exchange radar (no failover — each venue reports itself). */
export const perExchange = {
  ticker: (s: CanonSymbol) => Promise.allSettled(spotProviders.map(async p => ({ id: p.meta.id, t: await p.ticker(s) }))),
  funding: (s: CanonSymbol) => Promise.allSettled(derivProviders.map(async p => ({ id: p.meta.id, f: await p.funding(s) }))),
  depth: (s: CanonSymbol) => Promise.allSettled(spotProviders.map(async p => ({ id: p.meta.id, d: await p.depth(s, 50) }))),
};

/** Historical backfill ending before a timestamp (for 40K-bar scrollback). Binance paginates any timeframe; others only native. */
export const klinesBefore = new ProviderChain<[CanonSymbol, string, number, number], Candle[]>([
  { id: 'binance', fn: (s, tf, limit, end) => binanceKlines(s, tf, limit, end) },
], { cacheTtlMs: 60_000, staleTtlMs: 600_000 });
export const MAX_HISTORY_BARS = 40_000;
