// Extra data the Home dashboard shows that no other section already fetches:
// market-wide stats, the Fear & Greed history, and BTC over longer ranges for
// the Market Overview chart. Each is fetched on demand from the dashboard,
// cached, and never refetched faster than its source actually changes.
import { jget } from '../../api/client'

export interface GlobalStats {
  totalMcapUsd: number
  mcapChg24h: number
  btcDominance: number
  activeCoins: number
}

export interface FgPoint {
  t: number
  v: number
}

export type Range = '1D' | '1W' | '1M' | '3M' | '1Y'
export const RANGES: Range[] = ['1D', '1W', '1M', '3M', '1Y']
/** Binance interval × count for each range. */
const RANGE_SPEC: Record<Range, { interval: string; limit: number }> = {
  '1D': { interval: '15m', limit: 96 },
  '1W': { interval: '1h', limit: 168 },
  '1M': { interval: '4h', limit: 180 },
  '3M': { interval: '1d', limit: 90 },
  '1Y': { interval: '1d', limit: 365 },
}

let global: GlobalStats | null = null
let globalAt = 0
let fgHist: FgPoint[] = []
let fgAt = 0
const series = new Map<string, { at: number; pts: Array<[number, number]> }>()
const inflight = new Set<string>()

export const getGlobal = () => global
export const getFgHistory = () => fgHist
export function getSeries(sym: string, r: Range): Array<[number, number]> {
  return series.get(sym + '|' + r)?.pts ?? []
}

async function once(key: string, fn: () => Promise<void>): Promise<void> {
  if (inflight.has(key)) return
  inflight.add(key)
  try {
    await fn()
  } catch (e) {
    console.warn('home data ' + key, e)
  } finally {
    inflight.delete(key)
  }
}

/** Total market cap, BTC dominance, active coins — CoinGecko, every 5 minutes. */
export function refreshGlobal(): Promise<void> {
  if (Date.now() - globalAt < 300_000) return Promise.resolve()
  return once('global', async () => {
    const r = (await jget('https://api.coingecko.com/api/v3/global', 12000)) as {
      data?: {
        total_market_cap?: { usd?: number }
        market_cap_percentage?: { btc?: number }
        market_cap_change_percentage_24h_usd?: number
        active_cryptocurrencies?: number
      }
    }
    const d = r?.data
    if (!d) return
    global = {
      totalMcapUsd: d.total_market_cap?.usd ?? 0,
      mcapChg24h: d.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: d.market_cap_percentage?.btc ?? 0,
      activeCoins: d.active_cryptocurrencies ?? 0,
    }
    globalAt = Date.now()
  })
}

/** The last 30 daily Fear & Greed readings — the index updates once a day. */
export function refreshFgHistory(): Promise<void> {
  if (Date.now() - fgAt < 3_600_000) return Promise.resolve()
  return once('fg', async () => {
    const r = (await jget('https://api.alternative.me/fng/?limit=30', 12000)) as {
      data?: Array<{ value: string; timestamp: string }>
    }
    if (!r?.data?.length) return
    fgHist = r.data
      .map((x) => ({ t: Number(x.timestamp) * 1000, v: Number(x.value) }))
      .filter((x) => isFinite(x.v))
      .sort((a, b) => a.t - b.t)
    fgAt = Date.now()
  })
}

/** Close prices for a range; refreshed at most once a minute. */
export function refreshSeries(sym: string, r: Range): Promise<void> {
  const key = sym + '|' + r
  const cached = series.get(key)
  if (cached && Date.now() - cached.at < 60_000) return Promise.resolve()
  return once('series ' + key, async () => {
    const { interval, limit } = RANGE_SPEC[r]
    const rows = (await jget(
      `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`,
      15000,
    )) as unknown[][]
    if (!Array.isArray(rows) || !rows.length) return
    series.set(key, { at: Date.now(), pts: rows.map((k) => [Number(k[0]), Number(k[4])]) })
  })
}
