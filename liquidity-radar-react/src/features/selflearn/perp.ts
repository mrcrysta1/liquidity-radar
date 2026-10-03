// Prices for the self-learning engine, read from Binance USDⓈ-M perpetual
// futures — the same contracts the server bot trades on the Demo account.
// The rest of the app charts spot prices; gold (XAUUSDT, which tracks spot
// XAUUSD) only exists as a perpetual, so the engine has its own loader.
//
// fapi.binance.com first; the futures testnet serves the same live prices and
// is the fallback where the main host is blocked.
import type { CandleFlat } from '../../services/market'

/** The two markets the engine trains and trades. */
export const SL_MARKETS = ['BTCUSDT', 'XAUUSDT']

const HOSTS = ['https://fapi.binance.com', 'https://testnet.binancefuture.com']
const PAGE = 1500

/** Short display name: BTC, Gold. */
export const marketLabel = (sym: string) => (sym === 'XAUUSDT' ? 'Gold' : sym.replace(/USDT$/, ''))
/** Symbol for the coin badge (the app's XAUUSD instrument has the gold icon). */
export const badgeSym = (sym: string) => (sym === 'XAUUSDT' ? 'XAUUSD' : sym)

async function get(path: string): Promise<unknown> {
  let err: unknown
  for (const h of HOSTS) {
    try {
      const r = await fetch(h + path)
      if (r.ok) return await r.json()
      err = new Error('HTTP ' + r.status)
    } catch (e) {
      err = e
    }
  }
  throw err instanceof Error ? err : new Error('futures prices unavailable')
}

/** The last `bars` closed-or-forming candles of a native interval (15m, 4h, ...). */
export async function loadPerpCandles(sym: string, tf: string, bars: number): Promise<CandleFlat[]> {
  const out: CandleFlat[] = []
  let end = 0
  while (out.length < bars) {
    const n = Math.min(PAGE, bars - out.length)
    const rows = (await get(`/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${n}${end ? '&endTime=' + end : ''}`)) as unknown[][]
    if (!Array.isArray(rows) || !rows.length) break
    out.unshift(...rows.map((k) => ({ t: Number(k[0]), o: +k[1]!, h: +k[2]!, l: +k[3]!, c: +k[4]!, v: +k[5]! }) as CandleFlat))
    if (rows.length < n) break
    end = Number(rows[0]![0]) - 1
  }
  return out.slice(-bars)
}

const last: Record<string, number> = {}
/** Latest polled price, or undefined before the first poll. */
export const perpPrice = (sym: string): number | undefined => last[sym]

/** Refresh the prices of `syms`; failures keep the previous value. */
export async function pollPerpPrices(syms: string[]): Promise<void> {
  await Promise.all(
    syms.map((s) =>
      get('/fapi/v1/ticker/price?symbol=' + s)
        .then((r) => {
          const p = Number((r as { price?: string }).price)
          if (p > 0) last[s] = p
        })
        .catch(() => {}),
    ),
  )
}
