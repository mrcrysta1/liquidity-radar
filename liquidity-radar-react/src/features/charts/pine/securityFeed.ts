// request.security() bars on the page: fetched through the app's market
// services (loadCandleWindow — Binance symbols, any interval the app can
// build), cached per key, and refreshed every half minute while a script
// keeps asking, so a higher-timeframe value follows the market.
//
// The services are imported on first use only: the engine tests load
// ./indicator under Node, where there is no network and no Vite.
import type { PineBar } from './runtime.ts'
import { appTf, tfMs } from './security.ts'

interface Entry {
  bars: PineBar[]
  /** When the last fetch landed (or failed). */
  at: number
  loading: boolean
  /** How many bars the last fetch asked for. */
  want: number
  symbol: string
  tf: string
}
const cache = new Map<string, Entry>()
const listeners: Array<(key: string) => void> = []
const REFRESH_MS = 30000
const RETRY_MS = 60000
const MAX_BARS = 5000

/** Called with a key whenever new bars for it land. */
export function onSecurityData(fn: (key: string) => void): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

/** Bars enough to cover the chart's span, plus warm-up for the script's maths. */
function barsFor(tf: string, from: number, to: number): number {
  const step = tfMs(tf) || 60000
  return Math.max(200, Math.min(MAX_BARS, Math.ceil((to - from) / step) + 300))
}

function load(key: string, symbol: string, tf: string, want: number): void {
  let e = cache.get(key)
  if (!e) {
    e = { bars: [], at: 0, loading: false, want, symbol, tf }
    cache.set(key, e)
  }
  if (e.loading) return
  e.loading = true
  e.want = want
  const entry = e
  import('../../../services/marketData')
    .then((m) => m.loadCandleWindow(symbol, appTf(tf), want))
    .then((rows) => {
      entry.bars = rows.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }))
      entry.at = Date.now()
      entry.loading = false
      if (entry.bars.length) listeners.slice().forEach((fn) => fn(key))
    })
    .catch(() => {
      entry.at = Date.now()
      entry.loading = false
    })
}

/** Fetch what a run reported missing. */
export function requestSecurity(
  needs: Array<{ key: string; symbol: string; tf: string }>,
  from: number,
  to: number,
): void {
  for (const nd of needs) {
    const e = cache.get(nd.key)
    // Failed a moment ago: no hammering.
    if (e && (e.loading || Date.now() - e.at < RETRY_MS)) continue
    load(nd.key, nd.symbol, nd.tf, barsFor(nd.tf, from, to))
  }
}

/**
 * The cached bars for `keys` (a chart spanning from…to). Stale or too-short
 * entries are refetched in the background; the run gets what is there now.
 */
export function securityData(keys: string[], from: number, to: number): Record<string, PineBar[]> | undefined {
  let out: Record<string, PineBar[]> | undefined
  for (const key of keys) {
    const e = cache.get(key)
    if (!e) continue
    const want = barsFor(e.tf, from, to)
    const short = e.bars.length > 0 && e.bars[0].t > from && want > e.want
    if (!e.loading && (Date.now() - e.at > REFRESH_MS || short)) load(key, e.symbol, e.tf, Math.max(want, e.want))
    if (e.bars.length) (out ??= {})[key] = e.bars
  }
  return out
}
