// Prices for the self-learning engine, read from Binance USDⓈ-M perpetual
// futures — the same contracts the server bot trades on the Demo account.
// The rest of the app charts spot prices; gold (XAUUSDT, which tracks spot
// XAUUSD) only exists as a perpetual, so the engine has its own loader.
//
// Fetching lives in services/perpData (shared with the gold chart).
import type { CandleFlat } from '../../services/market'
import { perp24h, perpKlines } from '../../services/perpData'

/** The two markets the engine trains and trades. */
export const SL_MARKETS = ['BTCUSDT', 'XAUUSDT']

/** Short display name: BTC, Gold. */
export const marketLabel = (sym: string) => (sym === 'XAUUSDT' ? 'Gold' : sym.replace(/USDT$/, ''))
/** Symbol for the coin badge (the app's XAUUSD instrument has the gold icon). */
export const badgeSym = (sym: string) => (sym === 'XAUUSDT' ? 'XAUUSD' : sym)

/** The last `bars` candles of a native interval (15m, 4h, ...). */
export const loadPerpCandles = (sym: string, tf: string, bars: number): Promise<CandleFlat[]> => perpKlines(sym, tf, bars)

const last: Record<string, number> = {}
/** Latest polled price, or undefined before the first poll. */
export const perpPrice = (sym: string): number | undefined => last[sym]

/** Refresh the prices of `syms`; failures keep the previous value. */
export async function pollPerpPrices(syms: string[]): Promise<void> {
  await Promise.all(
    syms.map((s) =>
      perp24h(s).then((q) => {
        if (q) last[s] = q.last
      }),
    ),
  )
}
