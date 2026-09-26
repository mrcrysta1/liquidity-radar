// Market data for the bot: Binance spot klines from the public, region-free
// data host. Signals are computed on real-market (mainnet) prices; only order
// execution happens on the testnet.
import { barFromKline } from './features.ts'
import type { Bar } from './features.ts'

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com']

async function get(path: string): Promise<unknown[][]> {
  let err: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const h of HOSTS) {
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

export const INTERVAL_MS: Record<string, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 }

/**
 * Closed bars only, oldest first, going back `count` bars from now. The bar
 * still forming is dropped: a decision must never see a half-built candle.
 */
export async function closedBars(symbol: string, interval: string, count: number): Promise<Bar[]> {
  const out: Bar[] = []
  let end = Date.now()
  while (out.length < count) {
    const rows = await get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&endTime=${end}`)
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
