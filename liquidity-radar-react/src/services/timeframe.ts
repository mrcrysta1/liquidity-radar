// Timeframe catalogue and resampling.
//
// Binance serves a fixed set of kline intervals. Everything the picker offers
// beyond that set — 5s, 10s, 30s, 45s, 45m, 3h, 3w, 3M — is built here by
// bucketing a native "base" interval, the same way the Pro terminal builds its
// custom timeframes. A def with factor 1 is native and passes straight through.
import type { CandleFlat } from './market'

export type TfGroup = 'Seconds' | 'Minutes' | 'Hours' | 'Other'

export interface TimeframeDef {
  id: string
  label: string
  long: string
  group: TfGroup
  /** Native Binance interval to request from REST/WS. */
  base: string
  /** How many base candles make one bucket. 1 = native, no resampling. */
  factor: number
}

/** Duration of every native interval this app requests, in ms. */
export const BASE_MS: Record<string, number> = {
  '1s': 1000,
  '1m': 60000,
  '3m': 180000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '1h': 3600000,
  '2h': 7200000,
  '4h': 14400000,
  '1d': 86400000,
  '3d': 259200000,
  '1w': 604800000,
  // '1M' is a calendar month — variable length, handled by bucketIndex.
}

export const TIMEFRAMES: TimeframeDef[] = [
  { id: '1s', label: '1s', long: '1 Second', group: 'Seconds', base: '1s', factor: 1 },
  { id: '5s', label: '5s', long: '5 Seconds', group: 'Seconds', base: '1s', factor: 5 },
  { id: '10s', label: '10s', long: '10 Seconds', group: 'Seconds', base: '1s', factor: 10 },
  { id: '15s', label: '15s', long: '15 Seconds', group: 'Seconds', base: '1s', factor: 15 },
  { id: '30s', label: '30s', long: '30 Seconds', group: 'Seconds', base: '1s', factor: 30 },
  { id: '45s', label: '45s', long: '45 Seconds', group: 'Seconds', base: '1s', factor: 45 },

  { id: '1m', label: '1m', long: '1 Minute', group: 'Minutes', base: '1m', factor: 1 },
  { id: '3m', label: '3m', long: '3 Minutes', group: 'Minutes', base: '3m', factor: 1 },
  { id: '5m', label: '5m', long: '5 Minutes', group: 'Minutes', base: '5m', factor: 1 },
  { id: '15m', label: '15m', long: '15 Minutes', group: 'Minutes', base: '15m', factor: 1 },
  { id: '30m', label: '30m', long: '30 Minutes', group: 'Minutes', base: '30m', factor: 1 },
  { id: '45m', label: '45m', long: '45 Minutes', group: 'Minutes', base: '15m', factor: 3 },

  { id: '1h', label: '1h', long: '1 Hour', group: 'Hours', base: '1h', factor: 1 },
  { id: '2h', label: '2h', long: '2 Hours', group: 'Hours', base: '2h', factor: 1 },
  { id: '3h', label: '3h', long: '3 Hours', group: 'Hours', base: '1h', factor: 3 },
  { id: '4h', label: '4h', long: '4 Hours', group: 'Hours', base: '4h', factor: 1 },

  { id: '1d', label: '1D', long: '1 Day', group: 'Other', base: '1d', factor: 1 },
  { id: '3d', label: '3D', long: '3 Days', group: 'Other', base: '3d', factor: 1 },
  { id: '1w', label: '1W', long: '1 Week', group: 'Other', base: '1w', factor: 1 },
  { id: '3w', label: '3W', long: '3 Weeks', group: 'Other', base: '1w', factor: 3 },
  { id: '1M', label: '1M', long: '1 Month', group: 'Other', base: '1M', factor: 1 },
  { id: '3M', label: '3M', long: '3 Months', group: 'Other', base: '1M', factor: 3 },
]

export const TF_GROUPS: TfGroup[] = ['Seconds', 'Minutes', 'Hours', 'Other']
export const DEFAULT_TF = '15m'

const BY_ID: Record<string, TimeframeDef> = {}
TIMEFRAMES.forEach((t) => {
  BY_ID[t.id] = t
})
export const TF_IDS = TIMEFRAMES.map((t) => t.id)

export function tfDef(id: unknown): TimeframeDef {
  const s = String(id ?? '').trim()
  return BY_ID[s] || BY_ID[DEFAULT_TF]
}
export function isTf(id: unknown): boolean {
  return !!BY_ID[String(id ?? '').trim()]
}
export function normalizeTf(id: unknown): string {
  return tfDef(id).id
}
export function tfLong(id: unknown): string {
  return tfDef(id).long
}

/**
 * Stable bucket number for a candle open time. Derived from absolute time, not
 * from position in the array, so buckets do not shift as candles arrive.
 */
export function bucketIndex(tMs: number, def: TimeframeDef): number {
  if (def.base === '1M') {
    const d = new Date(tMs)
    return Math.floor((d.getUTCFullYear() * 12 + d.getUTCMonth()) / def.factor)
  }
  return Math.floor(Math.round(tMs / BASE_MS[def.base]) / def.factor)
}

/** Fold one bucket's base candles into a single candle. */
export function foldBucket(bucket: CandleFlat[]): CandleFlat | null {
  if (!bucket.length) return null
  const first = bucket[0]
  const out: CandleFlat = { t: first.t, o: first.o, h: first.h, l: first.l, c: first.c, v: first.v }
  for (let i = 1; i < bucket.length; i++) {
    const c = bucket[i]
    if (c.h > out.h) out.h = c.h
    if (c.l < out.l) out.l = c.l
    out.c = c.c
    out.v += c.v
  }
  return out
}

/** Resample ascending base candles onto the target interval. */
export function resample(base: CandleFlat[], def: TimeframeDef): CandleFlat[] {
  if (def.factor <= 1) return base.slice()
  const out: CandleFlat[] = []
  let idx = NaN
  for (const c of base) {
    const i = bucketIndex(c.t, def)
    if (i !== idx) {
      out.push({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })
      idx = i
    } else {
      const b = out[out.length - 1]
      if (c.h > b.h) b.h = c.h
      if (c.l < b.l) b.l = c.l
      b.c = c.c
      b.v += c.v
    }
  }
  return out
}

/**
 * When the bucket a candle opened at closes. Calendar-aware for the monthly
 * intervals, where a fixed duration would drift.
 */
export function bucketEnd(openMs: number, def: TimeframeDef): number {
  if (def.base === '1M') {
    const d = new Date(openMs)
    const start = d.getUTCFullYear() * 12 + d.getUTCMonth()
    const end = Math.floor(start / def.factor) * def.factor + def.factor
    return Date.UTC(Math.floor(end / 12), end % 12, 1)
  }
  return openMs + BASE_MS[def.base] * def.factor
}

/**
 * Folds live base candles into the bucket still forming, so a resampled chart's
 * last candle stays live instead of only appearing once the bucket closes.
 * Each chart owns one — the main price-action chart and every companion in a
 * multi-chart layout fold independently.
 */
export interface Folder {
  /** Seed from a REST load: keeps the base rows of the bucket in progress. */
  seed(base: CandleFlat[]): void
  /** Fold one live base candle in and return the bucket as it now stands. */
  push(c: CandleFlat): CandleFlat
}

export function createFolder(def: TimeframeDef): Folder {
  let tail: CandleFlat[] = []
  return {
    seed(base) {
      if (def.factor <= 1 || !base.length) {
        tail = []
        return
      }
      const last = bucketIndex(base[base.length - 1].t, def)
      tail = base.filter((c) => bucketIndex(c.t, def) === last)
    },
    push(c) {
      if (def.factor <= 1) return c
      const i = bucketIndex(c.t, def)
      if (!tail.length || bucketIndex(tail[0].t, def) !== i) tail = [c]
      else {
        const at = tail.findIndex((x) => x.t === c.t)
        if (at === -1) tail.push(c)
        else tail[at] = c
      }
      return foldBucket(tail) as CandleFlat
    },
  }
}

/**
 * The price-action chart's folder. The REST load creates it and the kline
 * socket folds into it, so the two stay in step across an interval change.
 */
export const mainFolder: { key: string; folder: Folder | null } = { key: '', folder: null }
