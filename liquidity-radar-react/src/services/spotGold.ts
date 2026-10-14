// Spot-gold correction for Binance-priced instruments.
//
// Gold's candles, quotes and live streams come from Binance's gold perpetual
// (XAUUSDT): it pages back like any Binance pair and streams every trade. But
// a perpetual trades at a basis to spot — usually a few dollars above it — so
// on its own it does not show the XAUUSD price every broker and TradingView
// show. This module measures that basis (spot − perpetual) every few seconds
// and the display paths add it, so the hero, ticker, chart and order book all
// read the actual spot price while keeping the perpetual's live tape.
//
// The bot and the Self Learning engine trade the perpetual itself and read it
// through features/selflearn — they never go through here, on purpose.
//
// Spot source: gold-api.com (keyless, CORS-open). When spot has not updated
// for a while (the market is closed at weekends) the last good basis is kept
// rather than letting the perpetual's weekend drift pass for spot.

const SPOT_URL: Record<string, string> = { XAUUSDT: 'https://api.gold-api.com/price/XAU' }
const PERP_URL = 'https://fapi.binance.com/fapi/v1/ticker/price?symbol='
const REFRESH_MS = 10_000
const STALE_MS = 15 * 60_000

const basis: Record<string, number> = {}
const fetchedAt: Record<string, number> = {}
const inflight: Record<string, Promise<void> | undefined> = {}

async function json(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return (await r.json()) as Record<string, unknown>
}

async function measure(perp: string): Promise<void> {
  try {
    const [s, p] = await Promise.all([json(SPOT_URL[perp]!), json(PERP_URL + perp)])
    const spot = Number(s.price)
    const last = Number(p.price)
    const at = Date.parse(String(s.updatedAt ?? ''))
    fetchedAt[perp] = Date.now()
    if (!(spot > 0) || !(last > 0)) return
    // Spot closed (weekend): keep the last basis measured while it traded.
    if (Number.isFinite(at) && Date.now() - at > STALE_MS && perp in basis) return
    basis[perp] = spot - last
  } catch {
    /* keep the last good basis; uncorrected (0) until one is measured */
  }
}

/** Refresh the basis if it is older than a few seconds. Resolves when done. */
export function refreshSpotBasis(perp: string): Promise<void> {
  if (!SPOT_URL[perp]) return Promise.resolve()
  if (Date.now() - (fetchedAt[perp] ?? 0) < REFRESH_MS) return Promise.resolve()
  return (inflight[perp] ??= measure(perp).finally(() => (inflight[perp] = undefined)))
}

/** Current spot − perpetual basis (0 until measured, or for other perpetuals). */
export function spotBasis(perp: string): number {
  if (SPOT_URL[perp]) void refreshSpotBasis(perp)
  return basis[perp] ?? 0
}
