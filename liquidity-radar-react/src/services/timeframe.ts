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
  /** Typed in by the user rather than part of the catalogue. */
  custom?: boolean
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
  '6h': 21600000,
  '8h': 28800000,
  '12h': 43200000,
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
  { id: '6h', label: '6h', long: '6 Hours', group: 'Hours', base: '6h', factor: 1 },
  { id: '8h', label: '8h', long: '8 Hours', group: 'Hours', base: '8h', factor: 1 },
  { id: '12h', label: '12h', long: '12 Hours', group: 'Hours', base: '12h', factor: 1 },

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
  return BY_ID[s] || customTfDef(s) || BY_ID[DEFAULT_TF]
}
/** True for a catalogue id or a canonical custom id ("7m", not "420s"). */
export function isTf(id: unknown): boolean {
  const s = String(id ?? '').trim()
  if (BY_ID[s]) return true
  const c = customTfDef(s)
  return !!c && c.id === s
}
export function normalizeTf(id: unknown): string {
  return tfDef(id).id
}
export function tfLong(id: unknown): string {
  return tfDef(id).long
}

// ---- Free-form custom timeframes ----------------------------------------
// The user can type any interval ("7m", "90s", "2d"); it is built by
// resampling the largest native interval that divides it evenly — the Pro
// terminal's rule. Months are calendar months and only ever fold 1M.

/** Seconds per unit. 'M' is nominal (30 days) — only used for parsing. */
const UNIT_SEC: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 }
const UNIT_NAME: Record<string, string> = {
  s: 'Second',
  m: 'Minute',
  h: 'Hour',
  d: 'Day',
  w: 'Week',
  M: 'Month',
}
const UNIT_GROUP: Record<string, TfGroup> = {
  s: 'Seconds',
  m: 'Minutes',
  h: 'Hours',
  d: 'Other',
  w: 'Other',
  M: 'Other',
}
/**
 * More base rows per candle than this and the request budget (5 pages of
 * 1000 rows) would leave too few candles to be worth drawing.
 */
export const MAX_CUSTOM_FACTOR = 200
/** Longest custom interval: a year of weeks. */
const MAX_CUSTOM_SEC = 52 * 604800

/** Native intervals in seconds, month excluded (it is not a fixed length). */
export const NATIVE_SECONDS: Record<string, number> = {}
Object.keys(BASE_MS).forEach((k) => {
  NATIVE_SECONDS[k] = BASE_MS[k] / 1000
})

function splitTf(tf: string): { n: number; unit: string } | null {
  const m = /^(\d{1,4})\s*([smhdwMSHDW])$/.exec(String(tf).trim())
  if (!m) return null
  // 'M' is month and 'm' minute; the other units read the same in either case.
  const unit = m[2] === 'M' ? 'M' : m[2].toLowerCase()
  const n = Number(m[1])
  return n > 0 ? { n, unit } : null
}

/** "45m" → 2700 seconds; null when it is not a timeframe. */
export function parseTimeframe(tf: string): number | null {
  const p = splitTf(tf)
  return p ? p.n * UNIT_SEC[p.unit] : null
}

/** The largest native interval that evenly divides `sec`, and how many of it make one bar. */
export function baseFor(sec: number): { base: string; factor: number } {
  const c = Object.keys(NATIVE_SECONDS)
    .filter((k) => NATIVE_SECONDS[k] <= sec && sec % NATIVE_SECONDS[k] === 0)
    .sort((a, b) => NATIVE_SECONDS[b] - NATIVE_SECONDS[a])
  const base = c[0] ?? '1s'
  return { base, factor: sec / NATIVE_SECONDS[base] }
}

/** Seconds → the shortest id that says it ("2700" → "45m", "86400" → "1d"). */
export function fmtTf(sec: number): string {
  if (sec % 604800 === 0) return sec / 604800 + 'w'
  if (sec % 86400 === 0) return sec / 86400 + 'd'
  if (sec % 3600 === 0) return sec / 3600 + 'h'
  if (sec % 60 === 0) return sec / 60 + 'm'
  return sec + 's'
}

const CUSTOM: Record<string, TimeframeDef | null> = {}
/**
 * Resolve a typed interval. Returns the catalogue entry when it names one
 * ("60m" → 1h), a resampled definition for anything else that can be built,
 * or null when it cannot (not a timeframe, too long, or too many base rows).
 */
export function customTfDef(raw: unknown): TimeframeDef | null {
  const s = String(raw ?? '').trim()
  if (BY_ID[s]) return BY_ID[s]
  if (s in CUSTOM) return CUSTOM[s]
  const p = splitTf(s)
  let def: TimeframeDef | null = null
  if (p && p.unit === 'M') {
    const id = p.n + 'M'
    def = BY_ID[id] ||
      (p.n <= 12
        ? { id, label: id, long: p.n + ' Months', group: 'Other', base: '1M', factor: p.n, custom: true }
        : null)
  } else if (p) {
    const sec = p.n * UNIT_SEC[p.unit]
    const id = fmtTf(sec)
    if (BY_ID[id]) def = BY_ID[id]
    else if (sec <= MAX_CUSTOM_SEC) {
      const { base, factor } = baseFor(sec)
      const unit = id.slice(-1)
      const n = Number(id.slice(0, -1))
      if (factor <= MAX_CUSTOM_FACTOR)
        def = {
          id,
          label: unit === 'd' || unit === 'w' ? n + unit.toUpperCase() : id,
          long: n + ' ' + UNIT_NAME[unit] + (n > 1 ? 's' : ''),
          group: UNIT_GROUP[unit],
          base,
          factor,
          custom: true,
        }
    }
  }
  CUSTOM[s] = def
  return def
}

/** Nominal length of an interval in ms (a month counts as 30 days). */
export function tfMs(def: TimeframeDef): number {
  return (BASE_MS[def.base] || 2592000000) * def.factor
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
