// Yahoo Finance data for everything that is not a crypto pair: metals,
// energy, FX, indices and equities.
//
// No API key, which is the property the whole data-source register is built
// on. It goes through the same /api/fetch proxy the news feeds use (Yahoo
// sends no CORS headers), and jgetProxied falls back to a direct request when
// the proxy is not running, e.g. plain `vite dev`.
//
// Yahoo serves a fixed set of intervals. Rather than request the nearest one
// and quietly mislabel the candles — a 60m bar drawn as though it were 4h —
// this module fetches an interval that divides the requested one exactly and
// aggregates up to the right width. The caller always gets candles of the
// width it asked for, which is what the resampler and every indicator assume.
import { jgetProxied } from '../api/client'
import type { CandleFlat } from './market'
import { instrumentOf } from '../constants/instruments'

const CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search'

/** Intervals Yahoo actually serves, with their width in ms. */
const YF_MS: Record<string, number> = {
  '1m': 60000,
  '2m': 120000,
  '5m': 300000,
  '15m': 900000,
  '30m': 1800000,
  '60m': 3600000,
  '1d': 86400000,
  '1wk': 604800000,
  '1mo': 2592000000,
}

/**
 * How to build one of the app's base intervals out of a Yahoo interval:
 * `src` is what to request, `mult` is how many of those make one output bar.
 *
 * '1s' has no honest answer — nothing here trades tick-by-tick the way a
 * crypto pair does and Yahoo's finest is 1m, so it degrades to 1m rather
 * than pretending.
 */
const PLAN: Record<string, { src: string; mult: number }> = {
  '1s': { src: '1m', mult: 1 },
  '1m': { src: '1m', mult: 1 },
  '3m': { src: '1m', mult: 3 },
  '5m': { src: '5m', mult: 1 },
  '15m': { src: '15m', mult: 1 },
  '30m': { src: '30m', mult: 1 },
  '1h': { src: '60m', mult: 1 },
  '2h': { src: '60m', mult: 2 },
  '4h': { src: '60m', mult: 4 },
  '1d': { src: '1d', mult: 1 },
  '3d': { src: '1d', mult: 3 },
  '1w': { src: '1wk', mult: 1 },
  '1M': { src: '1mo', mult: 1 },
}

/** Yahoo caps intraday history; ask for the shortest range that covers need. */
function rangeFor(src: string, bars: number): string {
  const ms = YF_MS[src] || 60000
  const days = Math.ceil((bars * ms) / 86400000) + 1
  if (src === '1m') return days <= 7 ? '7d' : '7d' // hard cap at Yahoo's 7d for 1m
  if (ms < 86400000) {
    // 2m-60m are capped at 60 days.
    if (days <= 5) return '5d'
    if (days <= 30) return '1mo'
    return '60d'
  }
  if (days <= 365) return '1y'
  if (days <= 365 * 2) return '2y'
  if (days <= 365 * 5) return '5y'
  return 'max'
}

interface ChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[]
      indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> }
      meta?: { currency?: string; instrumentType?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number }
    }>
    error?: { description?: string } | null
  }
}

/** Fold `mult` source candles into one, preserving true OHLC. */
function aggregate(rows: CandleFlat[], mult: number): CandleFlat[] {
  if (mult <= 1) return rows
  const out: CandleFlat[] = []
  for (let i = 0; i < rows.length; i += mult) {
    const slice = rows.slice(i, i + mult)
    if (!slice.length) break
    let h = slice[0].h
    let l = slice[0].l
    let v = 0
    for (const r of slice) {
      if (r.h > h) h = r.h
      if (r.l < l) l = r.l
      v += r.v
    }
    out.push({ t: slice[0].t, o: slice[0].o, h, l, c: slice[slice.length - 1].c, v })
  }
  return out
}

/**
 * Candles for a Yahoo-priced instrument, in the app's own CandleFlat shape
 * and at exactly the requested base width.
 */
export async function yahooCandles(sym: string, base: string, need: number): Promise<CandleFlat[]> {
  const inst = instrumentOf(sym)
  if (!inst) return []
  const plan = PLAN[base] || PLAN['1h']
  const srcBars = Math.max(need * plan.mult, 40)
  const url =
    CHART +
    encodeURIComponent(inst.yahoo) +
    '?interval=' +
    plan.src +
    '&range=' +
    rangeFor(plan.src, srcBars) +
    '&includePrePost=false'

  const raw = (await jgetProxied(url, { to: 15000 })) as ChartResponse
  const res = raw?.chart?.result?.[0]
  const ts = res?.timestamp
  const q = res?.indicators?.quote?.[0]
  if (!ts || !q || !q.close) return []

  const rows: CandleFlat[] = []
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i]
    // Yahoo pads gaps (holidays, halts, weekends) with nulls. Dropping them
    // keeps every candle a real traded bar instead of a flat-lined hole.
    if (c == null || !isFinite(c)) continue
    const o = q.open?.[i]
    const h = q.high?.[i]
    const l = q.low?.[i]
    rows.push({
      t: ts[i] * 1000,
      o: o != null && isFinite(o) ? o : c,
      h: h != null && isFinite(h) ? h : c,
      l: l != null && isFinite(l) ? l : c,
      c,
      // FX and indices report no volume at all; 0 is honest, not a gap.
      v: Number(q.volume?.[i] ?? 0) || 0,
    })
  }
  rows.sort((a, b) => a.t - b.t)
  return aggregate(rows, plan.mult).slice(-need)
}

export interface YahooQuote {
  sym: string
  last: number
  pct: number
  prevClose: number
  /** Latest session's range and volume, when the venue reports them. */
  high?: number
  low?: number
  vol?: number
}

/**
 * Last price and 24h/session change. Derived from the chart endpoint rather
 * than the quote endpoint, which now demands a crumb/cookie handshake that a
 * keyless client cannot do reliably.
 */
export async function yahooQuote(sym: string): Promise<YahooQuote | null> {
  const inst = instrumentOf(sym)
  if (!inst) return null
  const url = CHART + encodeURIComponent(inst.yahoo) + '?interval=1d&range=5d'
  try {
    const raw = (await jgetProxied(url, { to: 12000 })) as ChartResponse
    const res = raw?.chart?.result?.[0]
    const closes = (res?.indicators?.quote?.[0]?.close || []).filter(
      (x): x is number => x != null && isFinite(x),
    )
    if (!closes.length) return null
    const last = res?.meta?.regularMarketPrice ?? closes[closes.length - 1]
    const prev =
      res?.meta?.chartPreviousClose ??
      res?.meta?.previousClose ??
      (closes.length > 1 ? closes[closes.length - 2] : last)
    const pct = prev ? ((last - prev) / prev) * 100 : 0
    // The most recent daily bar gives an honest session range. FX and index
    // bars carry volume 0, which stays 0 rather than being dressed up.
    const q = res?.indicators?.quote?.[0]
    let high: number | undefined
    let low: number | undefined
    let vol: number | undefined
    if (q?.close) {
      for (let i = q.close.length - 1; i >= 0; i--) {
        const c = q.close[i]
        if (c == null || !isFinite(c)) continue
        const h = q.high?.[i]
        const l = q.low?.[i]
        high = h != null && isFinite(h) ? h : undefined
        low = l != null && isFinite(l) ? l : undefined
        vol = Number(q.volume?.[i] ?? 0) || 0
        break
      }
    }
    return { sym, last, pct, prevClose: prev, high, low, vol }
  } catch {
    return null
  }
}

export interface YahooHit {
  /** Yahoo's own ticker, e.g. 'PLTR' or 'RHM.DE'. */
  yahoo: string
  name: string
  kind: string
  exchange: string
}

/**
 * Yahoo's symbol directory — this is what makes "every stock" reachable
 * rather than only the curated table in constants/instruments.ts.
 */
export async function yahooSearch(query: string, limit = 8): Promise<YahooHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  const url = SEARCH + '?q=' + encodeURIComponent(q) + '&quotesCount=' + limit + '&newsCount=0'
  try {
    const raw = (await jgetProxied(url, { to: 10000 })) as {
      quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; quoteType?: string; exchDisp?: string }>
    }
    return (raw?.quotes || [])
      .filter((x) => x.symbol && x.quoteType && x.quoteType !== 'CRYPTOCURRENCY')
      .map((x) => ({
        yahoo: String(x.symbol),
        name: String(x.shortname || x.longname || x.symbol),
        kind: String(x.quoteType || ''),
        exchange: String(x.exchDisp || ''),
      }))
  } catch {
    return []
  }
}
