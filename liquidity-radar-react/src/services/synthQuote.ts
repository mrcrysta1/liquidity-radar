// The charted ratio / spread's quote, from its own candles (see
// syntheticSymbol.synthQuote): no venue streams a ticker for BTCUSDT/ETHUSDT.
import { state } from './store'
import { isSynthetic, synthQuote } from './syntheticSymbol'
import type { SynthQuote } from './syntheticSymbol'

/** null unless `sym` is a ratio / spread whose candles are the ones loaded. */
export function synthTicker(sym: string = state.symbol): SynthQuote | null {
  if (!isSynthetic(sym) || !state.candles.length) return null
  if (!String(state.candlesKey || '').startsWith(sym + '|')) return null
  return synthQuote(state.candles)
}
