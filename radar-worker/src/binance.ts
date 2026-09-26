// Binance public market data. The *.binance.vision hosts serve the same spot
// data as api.binance.com without its regional blocks, which matters on cloud
// hosts; api.binance.com stays as the fallback.
import type { Agg } from './tape.ts'

const REST = ['https://data-api.binance.vision', 'https://api.binance.com']
export const STREAM = 'wss://data-stream.binance.vision/ws/'

async function getJson(path: string): Promise<unknown> {
  let err: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const host of REST) {
      try {
        const r = await fetch(host + path, { signal: AbortSignal.timeout(15_000) })
        if (r.status === 429 || r.status === 418) {
          // Rate limited: honour Retry-After, and back off harder on a ban (418).
          const wait = Number(r.headers.get('retry-after')) || (r.status === 418 ? 120 : 10)
          console.warn(`[binance] ${r.status} — waiting ${wait}s`)
          await new Promise((res) => setTimeout(res, wait * 1000))
          continue
        }
        if (!r.ok) throw new Error(host + path + ' → HTTP ' + r.status)
        return await r.json()
      } catch (e) {
        err = e
      }
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt))
  }
  throw err
}

export async function aggTradesFrom(symbol: string, fromId: number, limit: number): Promise<Agg[]> {
  const rows = (await getJson(
    `/api/v3/aggTrades?symbol=${symbol}&fromId=${fromId}&limit=${Math.min(1000, Math.max(1, limit))}`,
  )) as Agg[]
  return Array.isArray(rows) ? rows : []
}

export async function quoteVolume24h(symbol: string): Promise<number> {
  const r = (await getJson('/api/v3/ticker/24hr?symbol=' + symbol)) as { quoteVolume?: string }
  return Number(r?.quoteVolume) || 0
}
