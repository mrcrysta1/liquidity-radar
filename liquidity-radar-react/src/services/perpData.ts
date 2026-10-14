// Binance USDⓈ-M perpetual futures data, for markets that have no spot pair.
//
// Gold is the reason this exists: XAUUSDT is Binance's gold perpetual, priced
// off a spot-gold index, so it is the live XAUUSD price (Yahoo's GC=F is the
// COMEX future — delayed, closed at weekends and ~$15-20 above spot). The
// response shapes match spot's, so callers treat the rows like any others.
//
// fapi.binance.com first; the futures testnet serves the same live prices and
// is the fallback where the main host is blocked. Both send CORS headers.
import type { CandleFlat } from './market'
import { pageKlines } from './failover'

const HOSTS = ['https://fapi.binance.com', 'https://testnet.binancefuture.com']
export const PERP_WS = 'wss://fstream.binance.com/ws/'

async function get(path: string): Promise<unknown> {
  let err: unknown
  for (const h of HOSTS) {
    try {
      const r = await fetch(h + path, { signal: AbortSignal.timeout(12_000) })
      if (r.ok) return await r.json()
      err = new Error('HTTP ' + r.status)
    } catch (e) {
      err = e
    }
  }
  throw err instanceof Error ? err : new Error('futures data unavailable')
}

/** `need` rows of a native interval, oldest first, ending before `before` (0 = now). */
export function perpKlines(sym: string, interval: string, need: number, before = 0): Promise<CandleFlat[]> {
  return pageKlines(need, before, 1500, 5, async (limit, endTime) => {
    const rows = (await get(`/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}${endTime ? '&endTime=' + endTime : ''}`)) as unknown[][]
    return (Array.isArray(rows) ? rows : []).map((k) => ({ t: Number(k[0]), o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]! }))
  })
}

export interface PerpQuote {
  last: number
  pct: number
  high: number
  low: number
  qvol: number
}

/** 24h stats, the same fields the spot ticker map carries. */
export async function perp24h(sym: string): Promise<PerpQuote | null> {
  try {
    const d = (await get('/fapi/v1/ticker/24hr?symbol=' + sym)) as Record<string, string>
    const last = Number(d.lastPrice)
    if (!(last > 0)) return null
    return { last, pct: Number(d.priceChangePercent), high: Number(d.highPrice), low: Number(d.lowPrice), qvol: Number(d.quoteVolume) }
  } catch {
    return null
  }
}
