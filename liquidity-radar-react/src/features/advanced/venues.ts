// Cross-exchange venue registry.
//
// Every venue here is a free, keyless, browser-reachable public endpoint —
// each one was probed from a page origin, because CORS is the thing that
// decides whether an exchange API is usable from the front end at all. Venues
// that answer only from a server (KuCoin, MEXC, Bitfinex, Bitstamp, BingX,
// WhiteBIT, Poloniex) are deliberately absent rather than listed and broken.
//
// A venue is data, not code: symbol mapping, the URLs to call and a parser for
// the shapes they return. Adding one is a table entry.

/** What the table shows for a venue, once parsed. */
export interface VenueQuote {
  last?: number
  /** 24h volume in quote currency (USD/USDT), never base units. */
  vol?: number
  bid?: number
  ask?: number
  /** Funding rate as a fraction per interval, perps only. */
  funding?: number
}

export interface Venue {
  id: string
  name: string
  kind: 'spot' | 'perp'
  /** Venue symbol for a base asset, or null where the venue has no such market. */
  symbol(base: string): string | null
  urls(sym: string): string[]
  parse(res: Array<unknown | undefined>): VenueQuote
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}
type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined
const arr = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : undefined)
/** First element of an array payload, for the many APIs that wrap one row. */
const first = (v: unknown): Obj | undefined => obj(arr(v)?.[0])

/** Venues quoting against USD rather than USDT — close enough to compare, noted in the UI. */
const USD_QUOTED = new Set(['coinbase-usd', 'gemini'])
export const isUsdQuoted = (id: string): boolean => USD_QUOTED.has(id)

/** Deribit lists perpetuals for these only. */
const DERIBIT_BASES = new Set(['BTC', 'ETH'])

export const VENUES: Venue[] = [
  {
    id: 'binance',
    name: 'Binance',
    kind: 'spot',
    symbol: (b) => b + 'USDT',
    urls: (s) => [
      'https://api.binance.com/api/v3/ticker/24hr?symbol=' + s,
      'https://api.binance.com/api/v3/ticker/bookTicker?symbol=' + s,
      'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + s,
    ],
    parse: ([t, b, f]) => ({
      last: num(obj(t)?.lastPrice),
      vol: num(obj(t)?.quoteVolume),
      bid: num(obj(b)?.bidPrice),
      ask: num(obj(b)?.askPrice),
      funding: num(obj(f)?.lastFundingRate),
    }),
  },
  {
    id: 'bybit',
    name: 'Bybit',
    kind: 'spot',
    symbol: (b) => b + 'USDT',
    urls: (s) => [
      'https://api.bybit.com/v5/market/tickers?category=spot&symbol=' + s,
      'https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + s,
    ],
    parse: ([t, f]) => {
      const row = first(obj(obj(t)?.result)?.list)
      const fr = first(obj(obj(f)?.result)?.list)
      return {
        last: num(row?.lastPrice),
        vol: num(row?.turnover24h),
        bid: num(row?.bid1Price),
        ask: num(row?.ask1Price),
        funding: num(fr?.fundingRate),
      }
    },
  },
  {
    id: 'okx',
    name: 'OKX',
    kind: 'spot',
    symbol: (b) => b + '-USDT',
    urls: (s) => [
      'https://www.okx.com/api/v5/market/ticker?instId=' + s,
      'https://www.okx.com/api/v5/public/funding-rate?instId=' + s + '-SWAP',
    ],
    parse: ([t, f]) => {
      const row = first(obj(t)?.data)
      const fr = first(obj(f)?.data)
      return {
        last: num(row?.last),
        vol: num(row?.volCcy24h),
        bid: num(row?.bidPx),
        ask: num(row?.askPx),
        funding: num(fr?.fundingRate),
      }
    },
  },
  {
    id: 'bitget',
    name: 'Bitget',
    kind: 'spot',
    symbol: (b) => b + 'USDT',
    urls: (s) => [
      'https://api.bitget.com/api/v2/spot/market/tickers?symbol=' + s,
      'https://api.bitget.com/api/v2/mix/market/current-fund-rate?symbol=' +
        s +
        '&productType=usdt-futures',
    ],
    parse: ([t, f]) => {
      const row = first(obj(t)?.data)
      const fr = first(obj(f)?.data)
      return {
        last: num(row?.lastPr),
        vol: num(row?.quoteVolume),
        bid: num(row?.bidPr),
        ask: num(row?.askPr),
        funding: num(fr?.fundingRate),
      }
    },
  },
  {
    id: 'gate',
    name: 'Gate.io',
    kind: 'spot',
    symbol: (b) => b + '_USDT',
    urls: (s) => [
      'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=' + s,
      'https://api.gateio.ws/api/v4/futures/usdt/contracts/' + s,
    ],
    parse: ([t, f]) => {
      const row = first(t)
      return {
        last: num(row?.last),
        vol: num(row?.quote_volume),
        bid: num(row?.highest_bid),
        ask: num(row?.lowest_ask),
        funding: num(obj(f)?.funding_rate_indicative),
      }
    },
  },
  {
    id: 'htx',
    name: 'HTX',
    kind: 'spot',
    symbol: (b) => (b + 'usdt').toLowerCase(),
    urls: (s) => ['https://api.huobi.pro/market/detail/merged?symbol=' + s],
    parse: ([t]) => {
      const tick = obj(obj(t)?.tick)
      return {
        last: num(tick?.close),
        vol: num(tick?.vol),
        bid: num(arr(tick?.bid)?.[0]),
        ask: num(arr(tick?.ask)?.[0]),
      }
    },
  },
  {
    id: 'cryptocom',
    name: 'Crypto.com',
    kind: 'spot',
    symbol: (b) => b + '_USDT',
    urls: (s) => ['https://api.crypto.com/exchange/v1/public/get-tickers?instrument_name=' + s],
    parse: ([t]) => {
      const row = first(obj(obj(t)?.result)?.data)
      return { last: num(row?.a), vol: num(row?.vv), bid: num(row?.b), ask: num(row?.k) }
    },
  },
  {
    id: 'kraken',
    name: 'Kraken',
    kind: 'spot',
    // Kraken still calls bitcoin XBT.
    symbol: (b) => (b === 'BTC' ? 'XBT' : b) + 'USDT',
    urls: (s) => ['https://api.kraken.com/0/public/Ticker?pair=' + s],
    parse: ([t]) => {
      // The result is keyed by Kraken's own pair name, which is not always the
      // one asked for, so take whatever single entry came back.
      const row = obj(Object.values(obj(obj(t)?.result) ?? {})[0])
      const last = num(arr(row?.c)?.[0])
      // Kraken reports 24h volume in base units; the table compares quote.
      const baseVol = num(arr(row?.v)?.[1])
      return {
        last,
        vol: baseVol != null && last != null ? baseVol * last : undefined,
        bid: num(arr(row?.b)?.[0]),
        ask: num(arr(row?.a)?.[0]),
      }
    },
  },
  {
    id: 'coinbase-usd',
    name: 'Coinbase',
    kind: 'spot',
    symbol: (b) => b + '-USDT',
    urls: (s) => [
      'https://api.exchange.coinbase.com/products/' + s + '/ticker',
      'https://api.exchange.coinbase.com/products/' + s + '/stats',
    ],
    parse: ([t, st]) => {
      const last = num(obj(t)?.price)
      const baseVol = num(obj(st)?.volume)
      return {
        last,
        vol: baseVol != null && last != null ? baseVol * last : undefined,
        bid: num(obj(t)?.bid),
        ask: num(obj(t)?.ask),
      }
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    kind: 'spot',
    symbol: (b) => (b + 'usd').toLowerCase(),
    urls: (s) => ['https://api.gemini.com/v1/pubticker/' + s],
    parse: ([t]) => ({
      last: num(obj(t)?.last),
      vol: num(obj(obj(t)?.volume)?.USD),
      bid: num(obj(t)?.bid),
      ask: num(obj(t)?.ask),
    }),
  },
  {
    id: 'deribit',
    name: 'Deribit',
    kind: 'perp',
    symbol: (b) => (DERIBIT_BASES.has(b) ? b + '-PERPETUAL' : null),
    urls: (s) => ['https://www.deribit.com/api/v2/public/ticker?instrument_name=' + s],
    parse: ([t]) => {
      const r = obj(obj(t)?.result)
      return {
        last: num(r?.last_price),
        vol: num(obj(r?.stats)?.volume_usd),
        bid: num(r?.best_bid_price),
        ask: num(r?.best_ask_price),
        funding: num(r?.funding_8h),
      }
    },
  },
]
