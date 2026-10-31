// Multi-timeframe inputs: an indicator computed on a higher timeframe's bars
// (5m … 1W) and shown on the chart's bars without lookahead.
//
// A chart bar shows the value of the newest higher-timeframe bar that had
// closed by the time the chart bar closed. The one exception is the chart's
// live bar, which shows the still-forming higher-timeframe bar unless "wait
// for close" is set — TradingView's request.security with lookahead off.
//
// Pure: no DOM, no network (the fetching lives in ./mtfFeed), so the engine
// tests run it directly.
import type { CandleFlat } from '../../../services/market'
import type { Series } from './math'

export const MTF_OPTIONS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Chart' },
  { key: '5m', label: '5m' },
  { key: '15m', label: '15m' },
  { key: '1h', label: '1h' },
  { key: '4h', label: '4h' },
  { key: '1d', label: '1D' },
  { key: '1w', label: '1W' },
]

const DAY = 86400000
const MTF_MS: Record<string, number> = {
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': DAY,
  '1w': 7 * DAY,
}
/** Weeks open on Monday (1970-01-05), as Binance's 1w klines do. */
const WEEK_OFFSET = 4 * DAY

export const isMtfKey = (tf: unknown): tf is string =>
  typeof tf === 'string' && Object.prototype.hasOwnProperty.call(MTF_MS, tf)

export const mtfLabel = (tf: string): string =>
  MTF_OPTIONS.find((o) => o.key === tf)?.label || tf

/** Length of one bar of `tf`, ms; 0 for an unknown key. */
export function mtfStepMs(tf: string): number {
  return isMtfKey(tf) ? MTF_MS[tf] : 0
}

/** Open time of the `tf` bar a time falls in. */
export function mtfBucketStart(t: number, tf: string): number {
  const s = mtfStepMs(tf)
  if (!s) return t
  const off = tf === '1w' ? WEEK_OFFSET : 0
  return Math.floor((t - off) / s) * s + off
}

/** Does a `tf` input change anything on a chart of bars `chartStep` apart? */
export function mtfApplies(tf: string | undefined, chartStep: number): boolean {
  return !!tf && mtfStepMs(tf) > chartStep && chartStep > 0
}

/** Fold ascending candles into `tf` bars (the fallback when none are fetched). */
export function resampleTo(c: CandleFlat[], tf: string): CandleFlat[] {
  const out: CandleFlat[] = []
  let cur = NaN
  for (const k of c) {
    const b = mtfBucketStart(k.t, tf)
    if (b !== cur) {
      out.push({ t: b, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v })
      cur = b
    } else {
      const x = out[out.length - 1]
      if (k.h > x.h) x.h = k.h
      if (k.l < x.l) x.l = k.l
      x.c = k.c
      x.v += k.v
    }
  }
  return out
}

/**
 * Higher-timeframe bars as the chart's last bar knows them: every bar that
 * opened before the bucket the chart is in, then that bucket rebuilt from the
 * chart's own bars. Fetched data may run ahead of the chart (replay, a stale
 * view) or lag behind it (a live tick since the fetch); either way the
 * forming bar never holds anything the chart has not seen.
 */
export function withForming(htf: CandleFlat[], chart: CandleFlat[], tf: string): CandleFlat[] {
  if (!chart.length) return htf.slice()
  const last = chart[chart.length - 1]
  const b = mtfBucketStart(last.t, tf)
  const out = htf.filter((k) => k.t < b)
  let k = chart.length - 1
  while (k > 0 && chart[k - 1].t >= b) k--
  const forming = resampleTo(chart.slice(k), tf)
  return out.concat(forming.length ? [forming[forming.length - 1]] : [])
}

/**
 * For each chart bar, the index of the higher-timeframe bar whose value it
 * shows, or -1 (no closed bar yet). `chartT` and `htfT` are ascending open
 * times. A higher-timeframe bar counts as closed on a chart bar once it ended
 * at or before that chart bar's close.
 */
export function alignIndex(
  chartT: number[],
  chartStep: number,
  htfT: number[],
  htfStep: number,
  waitClose: boolean,
): number[] {
  const n = chartT.length
  const m = htfT.length
  const out = new Array<number>(n).fill(-1)
  let k = -1
  for (let i = 0; i < n; i++) {
    const close = chartT[i] + chartStep
    while (k + 1 < m && htfT[k + 1] + htfStep <= close) k++
    out[i] = k
  }
  if (n && !waitClose) {
    // The live bar: the bucket it is in, still forming.
    const t = chartT[n - 1]
    let f = k
    while (f + 1 < m && htfT[f + 1] <= t) f++
    if (f > k) out[n - 1] = f
  }
  return out
}

/**
 * Higher-timeframe values onto chart bars by an alignIndex map. `once`: only
 * on the first chart bar showing each higher-timeframe bar (signal markers,
 * which would otherwise repeat on every bar of the period).
 */
export function mapAligned(values: Series, idx: number[], once = false): Series {
  return idx.map((j, i) => {
    if (j < 0) return null
    if (once && i > 0 && idx[i - 1] === j) return null
    const v = values[j]
    return v == null || !Number.isFinite(v) ? null : v
  })
}

/** How many `tf` bars cover the chart's span plus a warm-up. */
export function mtfBarsNeeded(chart: CandleFlat[], tf: string, warm = 300, cap = 1500): number {
  const s = mtfStepMs(tf)
  if (!s || !chart.length) return warm
  const span = chart[chart.length - 1].t - chart[0].t
  return Math.min(cap, Math.ceil(span / s) + warm)
}
