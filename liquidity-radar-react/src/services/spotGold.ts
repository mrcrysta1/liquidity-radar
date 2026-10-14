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
// Spot sources, tried in order:
//   1. gold-api.com (keyless, CORS-open).
//   2. Swissquote's public quote feed (keyless, but sends no CORS headers, so
//      it goes through our /api/fetch proxy, which allow-lists it).
//   3. Only while neither has ever answered: Binance's own index price for
//      the perpetual. It is a blend of spot-gold venues, so it moves with
//      spot, but it sits a few dollars off XAUUSD — a basis once measured from
//      real spot, even an old one, is the better guess, so the index never
//      replaces one.
// When spot has not updated for a while (the market is closed at weekends)
// the last good basis is kept rather than letting the perpetual's weekend
// drift pass for spot.

const SPOT_URL: Record<string, string> = { XAUUSDT: 'https://api.gold-api.com/price/XAU' }
const BACKUP_URL: Record<string, string> = {
  XAUUSDT: 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD',
}
const PERP_URL = 'https://fapi.binance.com/fapi/v1/ticker/price?symbol='
const INDEX_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex?symbol='
const REFRESH_MS = 10_000
const STALE_MS = 15 * 60_000

const basis: Record<string, number> = {}
const fromSpot: Record<string, boolean> = {}
const fetchedAt: Record<string, number> = {}
const inflight: Record<string, Promise<void> | undefined> = {}

/** Same-origin proxy route (api/fetch.mjs in production, feedProxy in dev). */
export const proxied = (url: string): string => '/api/fetch?url=' + encodeURIComponent(url)

async function json(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

type Spot = { price: number; at: number }

async function goldApi(perp: string): Promise<Spot> {
  const s = (await json(SPOT_URL[perp]!)) as { price?: unknown; updatedAt?: unknown }
  return { price: Number(s.price), at: Date.parse(String(s.updatedAt ?? '')) }
}

// Swissquote answers with one entry per liquidity platform; the first one's
// first spread profile is enough — its bid/ask mid is the spot price.
async function swissquote(perp: string): Promise<Spot> {
  const rows = (await json(proxied(BACKUP_URL[perp]!))) as {
    spreadProfilePrices?: { bid?: unknown; ask?: unknown }[]
    ts?: unknown
  }[]
  const q = rows?.[0]?.spreadProfilePrices?.[0]
  return { price: (Number(q?.bid) + Number(q?.ask)) / 2, at: Number(rows?.[0]?.ts) }
}

/** First spot source that answers with a price, or null if none does. */
async function spot(perp: string): Promise<Spot | null> {
  for (const src of [goldApi, swissquote]) {
    try {
      const s = await src(perp)
      if (s.price > 0) return s
    } catch {
      /* try the next source */
    }
  }
  return null
}

async function measure(perp: string): Promise<void> {
  try {
    const [s, p] = await Promise.all([spot(perp), json(PERP_URL + perp) as Promise<{ price?: unknown }>])
    const last = Number(p.price)
    fetchedAt[perp] = Date.now()
    if (!(last > 0)) return
    if (!s) {
      // Both spot feeds down: the index beats no correction at all, never a
      // basis measured from real spot.
      if (fromSpot[perp]) return
      const ix = (await json(INDEX_URL + perp)) as { indexPrice?: unknown }
      const index = Number(ix.indexPrice)
      if (index > 0) basis[perp] = index - last
      return
    }
    // Spot closed (weekend): keep the last basis measured while it traded.
    if (Number.isFinite(s.at) && Date.now() - s.at > STALE_MS && perp in basis) return
    basis[perp] = s.price - last
    fromSpot[perp] = true
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
