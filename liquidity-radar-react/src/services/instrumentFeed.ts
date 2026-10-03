// Price feed for Yahoo-priced instruments.
//
// Crypto pairs stream over websockets; nothing here does. Metals, FX, indices
// and equities are polled instead, and the result is written into the very
// same state.tickers map the Binance stream fills — so the hero panel, the
// search rows and anything else reading a last price work unchanged and do
// not need to know which kind of instrument is on screen.
//
// Quotes are fetched one at a time on purpose. Yahoo rate-limits a keyless
// caller, and this is a background refresh: a slow, polite trickle that never
// fails loudly beats a burst that gets the whole app throttled.
import { state } from './store'
import { INSTRUMENT_HOT_LIST, binancePerpOf, isInstrument } from '../constants/instruments'
import { yahooQuote } from './yahoo'
import { perp24h } from './perpData'

/** Gold comes from Binance futures (no rate-limit worry), the rest from Yahoo. */
async function quote(sym: string): Promise<{ last: number; pct: number; qvol: number; high?: number; low?: number } | null> {
  const perp = binancePerpOf(sym)
  if (perp) {
    const q = await perp24h(perp)
    if (q) return q
  }
  const y = await yahooQuote(sym)
  return y ? { last: y.last, pct: y.pct, qvol: y.vol ?? 0, high: y.high, low: y.low } : null
}

/**
 * What to refresh this tick.
 *
 * The instrument the user is looking at gets every tick; the rest of the hot
 * list is a background nicety and rides along once every sixth. Yahoo
 * rate-limits a keyless caller, and refreshing all of them every 20s would be
 * ~18 requests a minute for prices that, unlike a crypto pair, mostly move in
 * minutes rather than milliseconds — and would risk throttling the one symbol
 * that actually matters.
 */
function wanted(): string[] {
  const active = isInstrument(state.symbol) ? [state.symbol] : []
  tick++
  if (tick % 6 !== 1) return active
  const out = active.slice()
  for (const s of INSTRUMENT_HOT_LIST) if (out.indexOf(s) === -1) out.push(s)
  return out
}

let tick = 0
let busy = false

/**
 * Refresh instrument quotes into state.tickers. Safe to call on a timer —
 * overlapping calls are dropped rather than queued, so a slow round never
 * stacks up behind the next tick.
 */
export async function refreshInstrumentQuotes(): Promise<void> {
  if (busy) return
  busy = true
  try {
    for (const sym of wanted()) {
      const q = await quote(sym)
      if (!q) continue
      // qvol is whatever the venue reported — 0 for FX and indices, which
      // genuinely have none. The hero renders 0 as a dash rather than
      // inventing a number for someone sizing a position.
      state.tickers[sym] = { last: q.last, pct: q.pct, qvol: q.qvol, high: q.high, low: q.low }
    }
  } finally {
    busy = false
  }
}

/**
 * Gold (and any other Binance-priced instrument) only: no Yahoo rate limit to
 * respect, and gold sits in the first-screen ticker, so it is fetched with
 * the crypto tickers at startup and refreshed every few seconds.
 */
export async function refreshPerpQuotes(): Promise<void> {
  await Promise.all(
    INSTRUMENT_HOT_LIST.filter((s) => binancePerpOf(s)).map(async (s) => {
      const q = await quote(s)
      if (q) state.tickers[s] = { last: q.last, pct: q.pct, qvol: q.qvol, high: q.high, low: q.low }
    }),
  )
}

/** Fetch the active instrument's price immediately, for a symbol switch. */
export async function primeInstrument(sym: string): Promise<void> {
  if (!isInstrument(sym)) return
  const q = await quote(sym)
  if (q) state.tickers[sym] = { last: q.last, pct: q.pct, qvol: q.qvol, high: q.high, low: q.low }
}
