// Market data for the bot: Binance spot klines from the public, region-free
// data host. Signals are computed on real-market (mainnet) prices; only order
// execution happens on the testnet.
//
// Markets with no spot pair (gold, XAUUSDT) use USD-M futures klines: mainnet
// first, then the futures testnet, which is the one futures host GitHub's US
// runners can reach (its closes track mainnet to ~0.002%; wicks differ more).
import { barFromKline } from './features.ts'
import type { Bar } from './features.ts'

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com']
const FUTURES_HOSTS = ['https://fapi.binance.com', 'https://testnet.binancefuture.com']
/** Perpetual-only markets (no spot pair on Binance). */
export const FUTURES_ONLY = new Set(['XAUUSDT', 'XAGUSDT'])

async function get(path: string, hosts = HOSTS): Promise<unknown[][]> {
  let err: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const h of hosts) {
      try {
        const r = await fetch(h + path, { signal: AbortSignal.timeout(20_000) })
        if (r.status === 429 || r.status === 418) {
          await new Promise((res) => setTimeout(res, (Number(r.headers.get('retry-after')) || 30) * 1000))
          continue
        }
        if (!r.ok) throw new Error(path + ' → HTTP ' + r.status)
        return (await r.json()) as unknown[][]
      } catch (e) {
        err = e
      }
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt))
  }
  throw err
}

export const INTERVAL_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 }

/**
 * Closed bars only, oldest first, going back `count` bars from now. The bar
 * still forming is dropped: a decision must never see a half-built candle.
 */
export async function closedBars(symbol: string, interval: string, count: number): Promise<Bar[]> {
  const fut = FUTURES_ONLY.has(symbol)
  const out: Bar[] = []
  let end = Date.now()
  while (out.length < count) {
    const rows = fut
      ? await get(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=1000&endTime=${end}`, FUTURES_HOSTS)
      : await get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&endTime=${end}`)
    if (!rows.length) break
    out.unshift(...rows.map(barFromKline))
    end = Number(rows[0][0]) - 1
    if (rows.length < 1000) break
  }
  const step = INTERVAL_MS[interval]
  const closed = out.filter((b) => b.t + step <= Date.now())
  // De-duplicate by open time (page edges) and keep order.
  const seen = new Set<number>()
  return closed.filter((b) => !seen.has(b.t) && seen.add(b.t)).slice(-count)
}

/** A USD-M perpetual funding settlement: time (ms) and rate per 8 h. */
export interface Funding {
  t: number
  rate: number
}

/**
 * Funding settlements since `startTime`, oldest first, from the mainnet
 * futures host only (public; the testnet's rates are not the market's). The
 * research read the same endpoint. Throws when the host cannot be reached.
 */
export async function fundingRates(symbol: string, startTime: number, endTime = Date.now()): Promise<Funding[]> {
  const out: Funding[] = []
  let start = startTime
  while (start < endTime) {
    const rows = (await get(`/fapi/v1/fundingRate?symbol=${symbol}&limit=1000&startTime=${start}&endTime=${endTime}`, ['https://fapi.binance.com'])) as unknown as Array<{ fundingTime: number; fundingRate: string }>
    for (const r of rows) out.push({ t: Number(r.fundingTime), rate: Number(r.fundingRate) })
    if (rows.length < 1000) break
    start = Number(rows[rows.length - 1].fundingTime) + 1
  }
  const seen = new Set<number>()
  return out.filter((x) => isFinite(x.rate) && !seen.has(x.t) && seen.add(x.t)).sort((a, z) => a.t - z.t)
}

type FetchBars = (symbol: string, interval: string, count: number) => Promise<Bar[]>

/**
 * Closed bars per market, kept between ticks and shared by every trader (a
 * strategy that reads BTC on every market fetches BTC once). The data host is
 * asked again only when a new bar should have closed since the last read — and
 * then only for the bars that are missing, merged onto what is held. If the new
 * bar is not published yet (or the request fails), the held bars are served and
 * the next try waits retryMs. With 24 markets on 4h bars: ~1 request per market
 * per bar, a few more while a bar is late, instead of one per market per tick.
 */
export class BarCache {
  private held = new Map<string, { bars: Bar[]; n: number; triedAt: number }>()
  /** Requests sent to the data host (for tests and the run log). */
  requests = 0
  private fetchBars: FetchBars
  private retryMs: number
  private clock: () => number

  constructor(fetchBars: FetchBars = closedBars, o: { retryMs?: number; now?: () => number } = {}) {
    this.fetchBars = fetchBars
    this.retryMs = o.retryMs ?? 20_000
    this.clock = o.now ?? Date.now
  }

  /** The last `count` closed bars, oldest first. The same array is returned until it changes. */
  async get(symbol: string, interval: string, count: number): Promise<Bar[]> {
    const step = INTERVAL_MS[interval]
    const now = this.clock()
    // Open time of the latest bar that should have closed by now.
    const due = Math.floor(now / step) * step - step
    const key = symbol + '|' + interval
    const h = this.held.get(key)
    const cut = (b: Bar[]) => (b.length > count ? b.slice(-count) : b)
    if (h && h.n >= count) {
      const last = h.bars[h.bars.length - 1]?.t ?? -Infinity
      if (last >= due || now - h.triedAt < this.retryMs) return cut(h.bars)
      // Only the bars since the last one held (plus one for overlap), if that is fewer.
      const missing = Math.ceil((due - last) / step) + 1
      try {
        this.requests++
        const fresh = await this.fetchBars(symbol, interval, Math.min(h.n, Math.max(2, missing)))
        h.triedAt = now
        if (fresh.length) {
          const first = fresh[0].t
          const merged = missing < h.n ? [...h.bars.filter((b) => b.t < first), ...fresh] : fresh
          if (merged[merged.length - 1].t > last) h.bars = merged.slice(-h.n)
        }
      } catch (e) {
        h.triedAt = now
        if (!h.bars.length) throw e
      }
      return cut(h.bars)
    }
    this.requests++
    const bars = await this.fetchBars(symbol, interval, count)
    this.held.set(key, { bars, n: count, triedAt: now })
    return bars
  }
}
