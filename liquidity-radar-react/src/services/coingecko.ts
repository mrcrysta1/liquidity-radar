// Market cap and circulating supply - the two CoinMarketCap-style fields
// Binance's API structurally cannot provide (it's an exchange, not a market
// data aggregator; it has no concept of total/circulating supply). CoinGecko's
// /coins/markets endpoint is free, keyless, and CORS-enabled for browser
// calls, so this fits the app's existing "no backend, no API keys" design -
// same shape as the RSS/calendar feeds already fetched directly from a
// public API elsewhere in this app.
import { state } from './store'
import { noteCall } from './dataSources'

export interface MarketCapEntry {
  marketCap: number
  circulatingSupply: number
  chg1h: number | null
  chg7d: number | null
}

/** Our internal COINS key -> CoinGecko's own id. CoinGecko ids don't follow
 * the ticker symbol, so this has to be a manual table rather than a
 * lowercase() of the symbol. Limited to TOP16 - that's the only table this
 * data feeds. */
const COINGECKO_IDS: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  DOGE: 'dogecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  LINK: 'chainlink',
  UNI: 'uniswap',
  TRUMP: 'official-trump',
  PEPE: 'pepe',
  WIF: 'dogwifcoin',
  FLOKI: 'floki',
  SHIB: 'shiba-inu',
}

interface CgRow {
  id: string
  market_cap: number
  circulating_supply: number
  price_change_percentage_1h_in_currency?: number
  price_change_percentage_7d_in_currency?: number
}

export async function fetchMarketCaps(): Promise<void> {
  const ids = Object.values(COINGECKO_IDS).join(',')
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=' +
    ids +
    '&price_change_percentage=1h,7d&per_page=250'
  const started = Date.now()
  try {
    const r = await fetch(url)
    noteCall(url, r.ok, r.status, Date.now() - started)
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const rows = (await r.json()) as CgRow[]
    const byId = new Map(rows.map((row) => [row.id, row]))
    const out: Record<string, MarketCapEntry> = {}
    for (const [key, id] of Object.entries(COINGECKO_IDS)) {
      const row = byId.get(id)
      if (!row) continue
      out[key] = {
        marketCap: row.market_cap,
        circulatingSupply: row.circulating_supply,
        chg1h: row.price_change_percentage_1h_in_currency ?? null,
        chg7d: row.price_change_percentage_7d_in_currency ?? null,
      }
    }
    state.marketCaps = out
  } catch (e) {
    noteCall(url, false, 0, Date.now() - started)
    console.warn('coingecko marketCaps', e)
  }
}
