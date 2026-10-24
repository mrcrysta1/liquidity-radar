// Perpetual futures snapshot for the Market tab's Futures table. Binance's
// futures API (fapi.binance.com) is already used elsewhere in this app for
// the single active symbol's funding rate and OI (see marketData.ts) - this
// extends the same free, keyless endpoints to a full table across the
// tracked coin set, batching where Binance allows it rather than firing one
// request per row.
import { state } from './store'
import { jget } from '../api/client'
import { COINS, HOT_LIST } from '../constants/market'
import { futuresSymbolOf } from './symbolScope'
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
/**
 * The futures symbol for a hot-list key: gold's spot XAUUSD trades as
 * XAUUSDT, and PEPE/SHIB/BONK/FLOKI as 1000-unit contracts (symbolScope).
 */
const futSym = (k: string) => futuresSymbolOf(COINS[k].sym)?.sym ?? COINS[k].sym
/** Spot units per contract unit for a hot-list key (1000 for 1000PEPEUSDT). */
const futMult = (k: string) => futuresSymbolOf(COINS[k].sym)?.mult ?? 1

export async function fetchFuturesSnapshot(): Promise<void> {
  const symbols = new Set(HOT_LIST.map(futSym))
  try {
    const [premiums, tickers] = (await Promise.all([
      jget(FAPI + '/fapi/v1/premiumIndex'),
      jget(FAPI + '/fapi/v1/ticker/24hr'),
    ])) as [PremiumRow[], Ticker24hRow[]]

    const premiumBySym = new Map(premiums.filter((p) => symbols.has(p.symbol)).map((p) => [p.symbol, p]))
    const tickerBySym = new Map(tickers.filter((t) => symbols.has(t.symbol)).map((t) => [t.symbol, t]))

    // premiumIndex lists every pair that actually has a futures market, so
    // use it to skip the ones that do not. FLOKI, PEPE and SHIB used to fail
    // an open-interest call apiece on every poll (they trade as 1000-unit
    // contracts, now mapped by futSym); this still guards any unlisted coin.
    const oiKeys = HOT_LIST.filter((k) => premiumBySym.has(futSym(k)))
    const oiResults = await Promise.allSettled(
      oiKeys.map((k) => jget(FAPI + '/fapi/v1/openInterest?symbol=' + futSym(k)) as Promise<OiRow>),
    )
    const oiByKey = new Map<string, number | null>()
    oiKeys.forEach((k, i) => {
      const r = oiResults[i]
      const n = r.status === 'fulfilled' ? Number(r.value.openInterest) : NaN
      oiByKey.set(k, isFinite(n) ? n : null)
    })

    const out: Record<string, FuturesEntry> = {}
    HOT_LIST.forEach((k) => {
      const sym = futSym(k)
      const p = premiumBySym.get(sym)
      const t = tickerBySym.get(sym)
      if (!p || !t) return
      const oi = oiByKey.get(k) ?? null
      // Restated per spot unit so a 1000PEPE row reads at PEPE's own price.
      const mult = futMult(k)
      out[k] = {
        markPrice: Number(p.markPrice) / mult,
        fundingRate: Number(p.lastFundingRate),
        pct: Number(t.priceChangePercent),
        qvol: Number(t.quoteVolume),
        openInterest: oi != null && isFinite(oi) ? oi * mult : null,
      }
    })
    state.futures = out
  } catch (e) {
    noteCall(FAPI + '/fapi/v1/premiumIndex', false, 0, 0)
    console.warn('futures snapshot', e)
  }
}
