// Register of every external data source the app talks to.
//
// This is documentation that cannot rot: the settings page renders it, and
// `noteCall` matches live traffic against it, so a source listed here with no
// traffic — or traffic that matches nothing here — is visible rather than
// silently assumed. Each entry says what it is *for*, because "we call this
// endpoint" is not the useful part; "this is why the number on screen exists"
// is.
export type Transport = 'REST' | 'WebSocket' | 'RSS'

export interface DataSource {
  id: string
  name: string
  provider: string
  transport: Transport
  /** Shown as the tooltip: what this feed is used for, in plain words. */
  purpose: string
  /** Where in the UI the data lands. */
  usedBy: string
  /** Representative URL — parameters are shown as placeholders. */
  endpoint: string
  /** How often it is polled, or how it is pushed. */
  cadence: string
  auth: 'none' | 'key'
  /** Matches live request URLs to this entry. */
  match: RegExp
  /** Notes the user should know: limits, quirks, known failures. */
  note?: string
}

export interface SourceGroup {
  id: string
  label: string
  blurb: string
  sources: DataSource[]
}

export const SOURCE_GROUPS: SourceGroup[] = [
  {
    id: 'core',
    label: 'Market data — Binance',
    blurb: 'The primary feed. Prices, candles and depth all originate here.',
    sources: [
      {
        id: 'klines',
        name: 'Candles (klines)',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose:
          'Every candle on the price chart, and the history that loads when you drag backwards. Non-native intervals such as 45m are folded locally from these.',
        usedBy: 'Price Action chart, Charts tab, signal scanner',
        endpoint: 'api.binance.com/api/v3/klines?symbol=&interval=&limit=',
        cadence: 'On load and on symbol or interval change',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/klines/,
        note: 'Weight 2 per small page, 10 for 500+ rows. The heaviest single caller at boot.',
      },
      {
        id: 'ticker24',
        name: '24h ticker',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose:
          'Last price, 24-hour change, high, low and quote volume for the tracked coin set — the ticker strip and the movers list.',
        usedBy: 'Ticker bar, Market tab, Dashboard price and movers tiles',
        endpoint: 'api.binance.com/api/v3/ticker/24hr?symbols=[…]',
        cadence: 'Every 20s while visible',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/ticker\/24hr/,
        note: 'Weight 80 for a multi-symbol request — one of the most expensive calls per minute.',
      },
      {
        id: 'depth',
        name: 'Order book depth',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose:
          'The deep book behind the liquidity score, slippage estimates and wall detection. The 15-level stream is fine to draw a ladder from, but scoring needs this.',
        usedBy: 'Chart side panel (Order book, Liquidity), Dashboard liquidity tile',
        endpoint: 'api.binance.com/api/v3/depth?symbol=&limit=500',
        cadence: 'Every 3s while visible',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/depth/,
        note: 'Weight 25 at limit 500.',
      },
      {
        id: 'trades',
        name: 'Recent trades',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose:
          'Raw prints used to size block trades for the whale tracker and to measure buy/sell imbalance for the signal scanner.',
        usedBy: 'Whale Order Tracker, signal whale flow',
        endpoint: 'api.binance.com/api/v3/trades?symbol=&limit=',
        cadence: 'Every 10s (whales); per scan (signals)',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/trades/,
        note: 'Weight 25 at limit 500+.',
      },
      {
        id: 'exchangeInfo',
        name: 'Exchange info',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose: 'The list of tradeable symbols that powers the coin search box.',
        usedBy: 'Coin search',
        endpoint: 'api.binance.com/api/v3/exchangeInfo',
        cadence: 'Once per session',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/exchangeInfo/,
      },
      {
        id: 'bookTicker',
        name: 'Best bid / ask',
        provider: 'Binance Spot',
        transport: 'REST',
        purpose: 'Top-of-book quote used for the cross-exchange spread comparison.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.binance.com/api/v3/ticker/bookTicker?symbol=',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.binance\.com\/api\/v3\/ticker\/bookTicker/,
      },
    ],
  },
  {
    id: 'derivs',
    label: 'Derivatives — Binance Futures',
    blurb: 'Perpetual positioning: what leverage is doing behind the spot price.',
    sources: [
      {
        id: 'premiumIndex',
        name: 'Mark price & funding',
        provider: 'Binance USD-M',
        transport: 'REST',
        purpose:
          'Mark price, index price and the current funding rate — the basis figure and the funding countdown.',
        usedBy: 'Funding tile, chart side panel (Futures), Cross-Exchange Radar, Market tab (Perpetual Futures table)',
        endpoint: 'fapi.binance.com/fapi/v1/premiumIndex?symbol=',
        cadence: 'Every 30s while visible',
        auth: 'none',
        match: /fapi\.binance\.com\/fapi\/v1\/premiumIndex/,
      },
      {
        id: 'futuresTicker24h',
        name: 'Perpetual 24h ticker',
        provider: 'Binance USD-M',
        transport: 'REST',
        purpose: '24h change and quote volume for every perpetual pair in one call.',
        usedBy: 'Market tab (Perpetual Futures table)',
        endpoint: 'fapi.binance.com/fapi/v1/ticker/24hr',
        cadence: 'Every 60s while visible',
        auth: 'none',
        match: /fapi\.binance\.com\/fapi\/v1\/ticker\/24hr/,
      },
      {
        id: 'openInterest',
        name: 'Open interest',
        provider: 'Binance USD-M',
        transport: 'REST',
        purpose: 'Contracts currently open — how much leverage is committed right now.',
        usedBy: 'Open Interest tile, chart side panel (Futures), Market tab (Perpetual Futures table)',
        endpoint: 'fapi.binance.com/fapi/v1/openInterest?symbol=',
        cadence: 'Every 30s while visible',
        auth: 'none',
        match: /fapi\.binance\.com\/fapi\/v1\/openInterest(\?|$)/,
      },
      {
        id: 'oiHist',
        name: 'Open interest history',
        provider: 'Binance USD-M',
        transport: 'REST',
        purpose:
          'Hourly open-interest series. Paired with price change it gives the price × OI regime — new longs, new shorts, covering or liquidation.',
        usedBy: 'Chart side panel (Futures) regime banner',
        endpoint: 'fapi.binance.com/futures/data/openInterestHist?period=1h&limit=96',
        cadence: 'Every 60s while visible',
        auth: 'none',
        match: /openInterestHist/,
        note: 'Sampled hourly, so the 4h change compares five points.',
      },
      {
        id: 'longShort',
        name: 'Long / short accounts',
        provider: 'Binance USD-M',
        transport: 'REST',
        purpose: 'Share of accounts positioned long versus short — crowd positioning.',
        usedBy: 'Chart side panel (Futures)',
        endpoint: 'fapi.binance.com/futures/data/globalLongShortAccountRatio',
        cadence: 'Every 60s while visible',
        auth: 'none',
        match: /globalLongShortAccountRatio/,
      },
    ],
  },
  {
    id: 'streams',
    label: 'Live streams',
    blurb:
      'WebSockets, not polling. These carry no rate-limit weight, which is why the live price comes from here.',
    sources: [
      {
        id: 'aggTrade',
        name: 'Trade tape',
        provider: 'Binance Spot WS',
        transport: 'WebSocket',
        purpose:
          'Every executed trade. This drives the header price and the forming candle so the two always show the same number at the same moment.',
        usedBy: 'Hero price, chart last candle',
        endpoint: 'wss://stream.binance.com:9443/ws/{symbol}@aggTrade',
        cadence: 'Pushed per trade, painted once per frame',
        auth: 'none',
        match: /@aggTrade/,
      },
      {
        id: 'wsTicker',
        name: '24h stats stream',
        provider: 'Binance Spot WS',
        transport: 'WebSocket',
        purpose: 'Rolling 24-hour high, low, volume and trade count for the focused symbol.',
        usedBy: 'Hero stats',
        endpoint: 'wss://stream.binance.com:9443/ws/{symbol}@ticker',
        cadence: 'Pushed every second',
        auth: 'none',
        match: /@ticker$/,
      },
      {
        id: 'wsKline',
        name: 'Candle stream',
        provider: 'Binance Spot WS',
        transport: 'WebSocket',
        purpose:
          'Authoritative open/high/low/close/volume for the bar in progress; reconciles whatever the trade tape estimated between updates.',
        usedBy: 'Price Action chart',
        endpoint: 'wss://stream.binance.com:9443/ws/{symbol}@kline_{interval}',
        cadence: 'Pushed every 2s',
        auth: 'none',
        match: /@kline_/,
      },
      {
        id: 'wsDepth',
        name: 'Depth stream',
        provider: 'Binance Spot WS',
        transport: 'WebSocket',
        purpose: 'Top 15 book levels, refreshed continuously — the live ladder.',
        usedBy: 'Chart side panel (Order book)',
        endpoint: 'wss://stream.binance.com:9443/ws/{symbol}@depth15@100ms',
        cadence: 'Pushed every 100ms',
        auth: 'none',
        match: /@depth15/,
      },
      {
        id: 'forceOrder',
        name: 'Liquidation stream',
        provider: 'Binance USD-M WS',
        transport: 'WebSocket',
        purpose:
          'All-market forced orders. A sell-side liquidation means a long was closed out, a buy-side one a short.',
        usedBy: 'Live Liquidations, Dashboard liquidations tile',
        endpoint: 'wss://fstream.binance.com/ws/!forceOrder@arr',
        cadence: 'Pushed as they happen',
        auth: 'none',
        match: /forceOrder/,
        note: 'Genuinely quiet in calm markets — an empty panel here is usually accurate.',
      },
    ],
  },
  {
    id: 'venues',
    label: 'Cross-exchange venues',
    blurb:
      'Public, keyless endpoints that answer from a browser. Exchanges that refuse cross-origin requests are deliberately absent rather than listed and broken.',
    sources: [
      {
        id: 'bybit',
        name: 'Bybit',
        provider: 'Bybit v5',
        transport: 'REST',
        purpose: 'Spot quote, 24h turnover and linear funding, for the venue comparison.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.bybit.com/v5/market/tickers',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.bybit\.com/,
      },
      {
        id: 'okx',
        name: 'OKX',
        provider: 'OKX v5',
        transport: 'REST',
        purpose: 'Spot quote and swap funding rate.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'okx.com/api/v5/market/ticker',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /okx\.com/,
        note: 'Unreachable from some networks and regions; shows as "unreachable" rather than being hidden.',
      },
      {
        id: 'bitget',
        name: 'Bitget',
        provider: 'Bitget v2',
        transport: 'REST',
        purpose: 'Spot quote and USDT-futures funding rate.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.bitget.com/api/v2/spot/market/tickers',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.bitget\.com/,
      },
      {
        id: 'gate',
        name: 'Gate.io',
        provider: 'Gate v4',
        transport: 'REST',
        purpose: 'Spot quote with quote-currency volume, plus the futures funding indication.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.gateio.ws/api/v4/spot/tickers',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /gateio\.ws/,
      },
      {
        id: 'htx',
        name: 'HTX',
        provider: 'HTX (Huobi)',
        transport: 'REST',
        purpose: 'Merged spot quote with top-of-book bid and ask.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.huobi.pro/market/detail/merged',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /huobi\.pro/,
      },
      {
        id: 'cryptocom',
        name: 'Crypto.com',
        provider: 'Crypto.com Exchange v1',
        transport: 'REST',
        purpose: 'Spot quote and 24h quote volume.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.crypto.com/exchange/v1/public/get-tickers',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.crypto\.com/,
      },
      {
        id: 'kraken',
        name: 'Kraken',
        provider: 'Kraken v0',
        transport: 'REST',
        purpose: 'Spot quote. Volume arrives in base units and is converted to quote here.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.kraken.com/0/public/Ticker',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.kraken\.com/,
        note: 'Kraken still calls bitcoin XBT; the symbol is mapped for you.',
      },
      {
        id: 'coinbase',
        name: 'Coinbase',
        provider: 'Coinbase Exchange',
        transport: 'REST',
        purpose: 'Spot quote and 24h stats. Two calls — the ticker has no volume.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.exchange.coinbase.com/products/{pair}/ticker',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /exchange\.coinbase\.com/,
      },
      {
        id: 'gemini',
        name: 'Gemini',
        provider: 'Gemini v1',
        transport: 'REST',
        purpose: 'Spot quote against USD rather than USDT — comparable, and flagged as such.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'api.gemini.com/v1/pubticker/{pair}',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /api\.gemini\.com/,
      },
      {
        id: 'deribit',
        name: 'Deribit',
        provider: 'Deribit v2',
        transport: 'REST',
        purpose: 'Perpetual quote with 8-hour funding. BTC and ETH only.',
        usedBy: 'Cross-Exchange Radar',
        endpoint: 'deribit.com/api/v2/public/ticker',
        cadence: 'Every 15s while visible',
        auth: 'none',
        match: /deribit\.com/,
      },
    ],
  },
  {
    id: 'traditional',
    label: 'Traditional markets — Yahoo Finance',
    blurb:
      'Everything that is not a crypto pair: spot metals, energy, FX majors, indices and equities. Keyless, like the rest of the register, and routed through the same /api/fetch proxy the feeds use because Yahoo sends no CORS headers.',
    sources: [
      {
        id: 'yf-chart',
        name: 'Instrument candles',
        provider: 'Yahoo Finance',
        transport: 'REST',
        purpose:
          'OHLCV history for metals, energy, FX, indices and equities. Fetched at an interval that divides the requested one and aggregated up, so a bar is always the width it claims to be.',
        usedBy: 'Chart, indicators, ML model for any non-crypto instrument',
        endpoint: 'query1.finance.yahoo.com/v8/finance/chart/{symbol}',
        cadence: 'On symbol or timeframe change',
        auth: 'none',
        match: /finance\.yahoo\.com\/v8/,
        note: 'Unofficial endpoint and rate-limited. No order book, funding or open interest exists for these instruments, so those panels stay empty by design.',
      },
      {
        id: 'yf-quote',
        name: 'Instrument quotes',
        provider: 'Yahoo Finance',
        transport: 'REST',
        purpose:
          'Last price, session change, range and volume. These instruments have no websocket, so they are polled rather than streamed.',
        usedBy: 'Hero panel, search rows, instrument hot list',
        endpoint: 'query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d',
        cadence: 'Every 20 seconds, one symbol at a time',
        auth: 'none',
        match: /finance\.yahoo\.com\/v8\/finance\/chart\/[^?]+\?interval=1d/,
      },
      {
        id: 'yf-search',
        name: 'Symbol directory',
        provider: 'Yahoo Finance',
        transport: 'REST',
        purpose:
          'Resolves a company or ticker the curated table does not list, which is what makes any listed equity or ETF reachable from search.',
        usedBy: 'Coin/market search',
        endpoint: 'query1.finance.yahoo.com/v1/finance/search',
        cadence: 'On demand, debounced 260ms while typing',
        auth: 'none',
        match: /finance\.yahoo\.com\/v1\/finance\/search/,
      },
    ],
  },
  {
    id: 'context',
    label: 'Sentiment, news & calendar',
    blurb: 'Context around the price. None of these are required for the chart to work.',
    sources: [
      {
        id: 'coingecko',
        name: 'Market cap & supply',
        provider: 'CoinGecko',
        transport: 'REST',
        purpose:
          'Market cap and circulating supply for the Market tab — Binance is an exchange, not an aggregator, and has no concept of either. Free public endpoint, no key.',
        usedBy: 'Market tab — Top Coins table',
        endpoint: 'api.coingecko.com/api/v3/coins/markets',
        cadence: 'Every 60 seconds while visible',
        auth: 'none',
        match: /coingecko\.com/,
      },
      {
        id: 'fng',
        name: 'Fear & Greed index',
        provider: 'alternative.me',
        transport: 'REST',
        purpose: 'A single 0–100 read on market mood, refreshed daily at source.',
        usedBy: 'Fear & Greed card, Dashboard sentiment tile',
        endpoint: 'api.alternative.me/fng/',
        cadence: 'Every 5 minutes while visible',
        auth: 'none',
        match: /alternative\.me/,
      },
      {
        id: 'rss2json',
        name: 'RSS bridge',
        provider: 'rss2json',
        transport: 'REST',
        purpose:
          'Converts publisher RSS to JSON, because news sites do not send cross-origin headers. Feeds CoinDesk, Cointelegraph, Decrypt, The Block and the rest.',
        usedBy: 'News tab, Dashboard headlines',
        endpoint: 'api.rss2json.com/v1/api.json?rss_url=',
        cadence: 'Every 5 minutes while visible',
        auth: 'none',
        match: /rss2json\.com/,
        note: 'Free tier is rate-limited; headlines can briefly stall.',
      },
      {
        id: 'selfproxy',
        name: 'Same-origin fetch proxy',
        provider: 'This deployment',
        transport: 'REST',
        purpose:
          'Server-side relay for feeds that refuse cross-origin requests. Tried before any third-party proxy, so publisher content comes through your own host where possible.',
        usedBy: 'News, economic calendar',
        endpoint: '/api/fetch?url=',
        cadence: 'On demand',
        auth: 'none',
        match: /^\/api\/fetch/,
        note: 'Only present in a deployment that ships the serverless function; plain `vite dev` falls back to a direct fetch.',
      },
      {
        id: 'allorigins',
        name: 'CORS proxy',
        provider: 'allorigins.win',
        transport: 'REST',
        purpose: 'Fallback fetch for feeds that block the browser directly.',
        usedBy: 'News, economic calendar',
        endpoint: 'api.allorigins.win/raw?url=',
        cadence: 'On demand, only when a direct fetch fails',
        auth: 'none',
        match: /allorigins\.win/,
        note: 'Third-party relay — treat anything it returns as untrusted input.',
      },
      {
        id: 'ff',
        name: 'Economic calendar',
        provider: 'Forex Factory (faireconomy)',
        transport: 'REST',
        purpose:
          'Scheduled macro releases with impact ratings — last week, this week and next week.',
        usedBy: 'News tab economic calendar',
        endpoint: 'nfs.faireconomy.media/ff_calendar_{week}.json',
        cadence: 'Every 5 minutes while visible',
        auth: 'none',
        match: /faireconomy\.media/,
      },
      {
        id: 'xoomar',
        name: 'Calendar fallback',
        provider: 'xoomar',
        transport: 'REST',
        purpose: 'Second calendar source, used when Forex Factory is unavailable.',
        usedBy: 'News tab economic calendar',
        endpoint: 'xoomar.com/api/markets/calendar',
        cadence: 'Only when the primary fails',
        auth: 'none',
        match: /xoomar\.com/,
      },
      {
        id: 'cvnews',
        name: 'Coin news',
        provider: 'cryptocurrency.cv',
        transport: 'REST',
        purpose: 'Per-coin headlines the assistant quotes when you ask about a specific coin.',
        usedBy: 'Radar AI',
        endpoint: 'cryptocurrency.cv/api/news?coin=',
        cadence: 'On demand',
        auth: 'none',
        match: /cryptocurrency\.cv/,
      },
    ],
  },
]

export const ALL_SOURCES: DataSource[] = SOURCE_GROUPS.flatMap((g) => g.sources)

// ---- live traffic -----------------------------------------------------------

export interface CallStat {
  calls: number
  errors: number
  lastAt: number
  lastOk: boolean
  lastStatus: number
  lastMs: number
}

const stats: Record<string, CallStat> = {}
/** Requests that matched no registered source — the register drifting from reality. */
const unmatched: Record<string, number> = {}

/** Record one outbound call against whichever source it belongs to. */
export function noteCall(url: string, ok: boolean, status: number, ms: number): void {
  const src = ALL_SOURCES.find((s) => s.match.test(url))
  if (!src) {
    try {
      const host = new URL(url).host
      unmatched[host] = (unmatched[host] || 0) + 1
    } catch {
      /* not a parseable URL */
    }
    return
  }
  const st = stats[src.id] || (stats[src.id] = { calls: 0, errors: 0, lastAt: 0, lastOk: true, lastStatus: 0, lastMs: 0 })
  st.calls++
  if (!ok) st.errors++
  st.lastAt = Date.now()
  st.lastOk = ok
  st.lastStatus = status
  st.lastMs = ms
}

/** Mark a stream as connected or dropped; streams carry no HTTP status. */
export function noteStream(url: string, up: boolean): void {
  const src = ALL_SOURCES.find((s) => s.transport === 'WebSocket' && s.match.test(url))
  if (!src) return
  const st = stats[src.id] || (stats[src.id] = { calls: 0, errors: 0, lastAt: 0, lastOk: true, lastStatus: 0, lastMs: 0 })
  st.calls++
  if (!up) st.errors++
  st.lastAt = Date.now()
  st.lastOk = up
  st.lastStatus = up ? 101 : 0
}

export function sourceStats(): Record<string, CallStat> {
  return stats
}
export function unmatchedHosts(): Record<string, number> {
  return unmatched
}
