// Perpetual futures snapshot for the Market tab's Futures table. Binance's
// futures API (fapi.binance.com) is already used elsewhere in this app for
// the single active symbol's funding rate and OI (see marketData.ts) - this
// extends the same free, keyless endpoints to a full table across the
// tracked coin set, batching where Binance allows it rather than firing one
// request per row.
import { state } from './store'
import { jget } from '../api/client'
import { COINS, HOT_LIST } from '../constants/market'
import { noteCall } from './dataSources'

export interface FuturesEntry {
  markPrice: number
  fundingRate: number
  pct: number
  qvol: number
  openInterest: number | null
}

interface PremiumRow {
  symbol: string
  markPrice: string
  lastFundingRate: string
}
interface Ticker24hRow {
  symbol: string
  priceChangePercent: string
  quoteVolume: string
}
interface OiRow {
  symbol: string
  openInterest: string
}

const FAPI = 'https://fapi.binance.com'

export async function fetchFuturesSnapshot(): Promise<void> {
  const symbols = new Set(HOT_LIST.map((k) => COINS[k].sym))
  try {
    const [premiums, tickers] = (await Promise.all([
      jget(FAPI + '/fapi/v1/premiumIndex'),
      jget(FAPI + '/fapi/v1/ticker/24hr'),
    ])) as [PremiumRow[], Ticker24hRow[]]

    const premiumBySym = new Map(premiums.filter((p) => symbols.has(p.symbol)).map((p) => [p.symbol, p]))
    const tickerBySym = new Map(tickers.filter((t) => symbols.has(t.symbol)).map((t) => [t.symbol, t]))

    // premiumIndex lists every pair that actually has a futures market, so
    // use it to skip the ones that do not. FLOKI, PEPE and SHIB were failing
    // an open-interest call apiece on every poll and showing up in the data
    // source register as permanently unhealthy.
    const oiKeys = HOT_LIST.filter((k) => premiumBySym.has(COINS[k].sym))
    const oiResults = await Promise.allSettled(
      oiKeys.map((k) => jget(FAPI + '/fapi/v1/openInterest?symbol=' + COINS[k].sym) as Promise<OiRow>),
    )
    const oiByKey = new Map<string, number | null>()
    oiKeys.forEach((k, i) => {
      const r = oiResults[i]
      const n = r.status === 'fulfilled' ? Number(r.value.openInterest) : NaN
      oiByKey.set(k, isFinite(n) ? n : null)
    })

    const out: Record<string, FuturesEntry> = {}
    HOT_LIST.forEach((k) => {
      const sym = COINS[k].sym
      const p = premiumBySym.get(sym)
      const t = tickerBySym.get(sym)
      if (!p || !t) return
      const oi = oiByKey.get(k) ?? null
      out[k] = {
        markPrice: Number(p.markPrice),
        fundingRate: Number(p.lastFundingRate),
        pct: Number(t.priceChangePercent),
        qvol: Number(t.quoteVolume),
        openInterest: oi != null && isFinite(oi) ? oi : null,
      }
    })
    state.futures = out
  } catch (e) {
    noteCall(FAPI + '/fapi/v1/premiumIndex', false, 0, 0)
    console.warn('futures snapshot', e)
  }
}
