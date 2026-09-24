// Non-crypto instruments: metals, energy, FX majors, indices and equities.
//
// Everything here is priced by Yahoo Finance (see services/yahoo.ts), not by
// Binance. The app-internal symbol is deliberately chosen so it can never
// collide with a Binance pair — the search only ever loads USDT pairs, and
// nothing in this table ends in USDT. That lets a single registry lookup
// decide which data source a symbol belongs to, with no prefix noise leaking
// into the UI.
//
// This is the *curated* set: the instruments worth a permanent place in the
// hot lists and the scanner. Any other listed ticker is still reachable —
// yahooSearch() queries Yahoo's own symbol directory, so a search for
// "Palantir" or "Rheinmetall" resolves even though neither is listed here.

export type AssetClass = 'metal' | 'energy' | 'forex' | 'index' | 'stock'

export interface Instrument {
  /** App-internal symbol, e.g. 'XAUUSD'. Never ends in USDT. */
  sym: string
  /** What Yahoo calls it, e.g. 'GC=F'. */
  yahoo: string
  name: string
  cls: AssetClass
  icon: string
  color: string
  /** Lowercase search terms, in addition to the symbol and the name. */
  aliases: string[]
  /** Decimal places for display; FX needs more than equities. */
  dp?: number
}

export const INSTRUMENTS: Record<string, Instrument> = {
  // --- metals -------------------------------------------------------
  XAUUSD: {
    sym: 'XAUUSD', yahoo: 'GC=F', name: 'Gold (Spot)', cls: 'metal',
    icon: '🥇', color: '#D4AF37', dp: 2,
    aliases: ['gold', 'xau', 'xauusd', 'spot gold', 'bullion', 'gold futures', 'comex gold'],
  },
  XAGUSD: {
    sym: 'XAGUSD', yahoo: 'SI=F', name: 'Silver (Spot)', cls: 'metal',
    icon: '🥈', color: '#C0C0C0', dp: 3,
    aliases: ['silver', 'xag', 'xagusd', 'spot silver'],
  },
  XPTUSD: {
    sym: 'XPTUSD', yahoo: 'PL=F', name: 'Platinum', cls: 'metal',
    icon: '⚪', color: '#E5E4E2', dp: 2,
    aliases: ['platinum', 'xpt'],
  },
  XCUUSD: {
    sym: 'XCUUSD', yahoo: 'HG=F', name: 'Copper', cls: 'metal',
    icon: '🟠', color: '#B87333', dp: 4,
    aliases: ['copper', 'xcu', 'hg'],
  },

  // --- energy -------------------------------------------------------
  WTIUSD: {
    sym: 'WTIUSD', yahoo: 'CL=F', name: 'Crude Oil (WTI)', cls: 'energy',
    icon: '🛢️', color: '#3E3E3E', dp: 2,
    aliases: ['oil', 'crude', 'wti', 'crude oil', 'petroleum'],
  },
  BRENTUSD: {
    sym: 'BRENTUSD', yahoo: 'BZ=F', name: 'Brent Crude', cls: 'energy',
    icon: '🛢️', color: '#5A5A5A', dp: 2,
    aliases: ['brent', 'brent crude'],
  },
  NATGAS: {
    sym: 'NATGAS', yahoo: 'NG=F', name: 'Natural Gas', cls: 'energy',
    icon: '🔥', color: '#4FC3F7', dp: 3,
    aliases: ['gas', 'natural gas', 'natgas', 'henry hub'],
  },

  // --- FX majors ----------------------------------------------------
  EURUSD: {
    sym: 'EURUSD', yahoo: 'EURUSD=X', name: 'Euro / US Dollar', cls: 'forex',
    icon: '💶', color: '#2E7DD1', dp: 5,
    aliases: ['eur', 'euro', 'eurusd', 'fiber'],
  },
  GBPUSD: {
    sym: 'GBPUSD', yahoo: 'GBPUSD=X', name: 'Pound / US Dollar', cls: 'forex',
    icon: '💷', color: '#C8102E', dp: 5,
    aliases: ['gbp', 'pound', 'sterling', 'gbpusd', 'cable'],
  },
  USDJPY: {
    sym: 'USDJPY', yahoo: 'USDJPY=X', name: 'US Dollar / Yen', cls: 'forex',
    icon: '💴', color: '#BC002D', dp: 3,
    aliases: ['jpy', 'yen', 'usdjpy'],
  },
  USDCHF: {
    sym: 'USDCHF', yahoo: 'USDCHF=X', name: 'US Dollar / Swiss Franc', cls: 'forex',
    icon: '🇨🇭', color: '#D52B1E', dp: 5,
    aliases: ['chf', 'franc', 'swissy', 'usdchf'],
  },
  AUDUSD: {
    sym: 'AUDUSD', yahoo: 'AUDUSD=X', name: 'Aussie / US Dollar', cls: 'forex',
    icon: '🇦🇺', color: '#00843D', dp: 5,
    aliases: ['aud', 'aussie', 'audusd'],
  },
  USDCAD: {
    sym: 'USDCAD', yahoo: 'USDCAD=X', name: 'US Dollar / Loonie', cls: 'forex',
    icon: '🇨🇦', color: '#FF0000', dp: 5,
    aliases: ['cad', 'loonie', 'usdcad'],
  },
  DXY: {
    sym: 'DXY', yahoo: 'DX-Y.NYB', name: 'US Dollar Index', cls: 'forex',
    icon: '💵', color: '#2E8B57', dp: 3,
    aliases: ['dxy', 'dollar index', 'usd index', 'greenback'],
  },

  // --- indices ------------------------------------------------------
  SPX500: {
    sym: 'SPX500', yahoo: '^GSPC', name: 'S&P 500', cls: 'index',
    icon: '📈', color: '#1F77B4', dp: 2,
    aliases: ['spx', 's&p', 'sp500', 's&p 500', 'spx500', 'us500'],
  },
  NAS100: {
    sym: 'NAS100', yahoo: '^IXIC', name: 'Nasdaq Composite', cls: 'index',
    icon: '📊', color: '#9467BD', dp: 2,
    aliases: ['nasdaq', 'nas100', 'ixic', 'tech index'],
  },
  DJIA: {
    sym: 'DJIA', yahoo: '^DJI', name: 'Dow Jones', cls: 'index',
    icon: '🏛️', color: '#8C564B', dp: 2,
    aliases: ['dow', 'dow jones', 'djia', 'us30'],
  },
  VIX: {
    sym: 'VIX', yahoo: '^VIX', name: 'Volatility Index', cls: 'index',
    icon: '⚡', color: '#E74C3C', dp: 2,
    aliases: ['vix', 'volatility', 'fear index', 'fear gauge'],
  },
  DAX: {
    sym: 'DAX', yahoo: '^GDAXI', name: 'DAX 40', cls: 'index',
    icon: '🇩🇪', color: '#FFCE00', dp: 2,
    aliases: ['dax', 'germany 40', 'gdaxi'],
  },
  NIKKEI: {
    sym: 'NIKKEI', yahoo: '^N225', name: 'Nikkei 225', cls: 'index',
    icon: '🇯🇵', color: '#BC002D', dp: 2,
    aliases: ['nikkei', 'n225', 'japan 225'],
  },

  // --- equities most relevant to this audience ----------------------
  AAPL: { sym: 'AAPL', yahoo: 'AAPL', name: 'Apple', cls: 'stock', icon: '🍎', color: '#A2AAAD', dp: 2, aliases: ['apple'] },
  MSFT: { sym: 'MSFT', yahoo: 'MSFT', name: 'Microsoft', cls: 'stock', icon: '🪟', color: '#00A4EF', dp: 2, aliases: ['microsoft'] },
  NVDA: { sym: 'NVDA', yahoo: 'NVDA', name: 'NVIDIA', cls: 'stock', icon: '🟩', color: '#76B900', dp: 2, aliases: ['nvidia'] },
  GOOGL: { sym: 'GOOGL', yahoo: 'GOOGL', name: 'Alphabet', cls: 'stock', icon: '🔤', color: '#4285F4', dp: 2, aliases: ['google', 'alphabet'] },
  AMZN: { sym: 'AMZN', yahoo: 'AMZN', name: 'Amazon', cls: 'stock', icon: '📦', color: '#FF9900', dp: 2, aliases: ['amazon'] },
  META: { sym: 'META', yahoo: 'META', name: 'Meta Platforms', cls: 'stock', icon: '🔵', color: '#0668E1', dp: 2, aliases: ['meta', 'facebook'] },
  TSLA: { sym: 'TSLA', yahoo: 'TSLA', name: 'Tesla', cls: 'stock', icon: '🚗', color: '#CC0000', dp: 2, aliases: ['tesla', 'musk'] },
  AMD: { sym: 'AMD', yahoo: 'AMD', name: 'AMD', cls: 'stock', icon: '🔴', color: '#ED1C24', dp: 2, aliases: ['amd', 'advanced micro'] },
  COIN: { sym: 'COIN', yahoo: 'COIN', name: 'Coinbase', cls: 'stock', icon: '🪙', color: '#0052FF', dp: 2, aliases: ['coinbase'] },
  MSTR: { sym: 'MSTR', yahoo: 'MSTR', name: 'Strategy (MicroStrategy)', cls: 'stock', icon: '🟠', color: '#F7931A', dp: 2, aliases: ['microstrategy', 'saylor', 'strategy'] },
  SPY: { sym: 'SPY', yahoo: 'SPY', name: 'SPDR S&P 500 ETF', cls: 'stock', icon: '🧺', color: '#1F77B4', dp: 2, aliases: ['spy', 'spdr'] },
  QQQ: { sym: 'QQQ', yahoo: 'QQQ', name: 'Invesco QQQ ETF', cls: 'stock', icon: '🧺', color: '#9467BD', dp: 2, aliases: ['qqq', 'invesco'] },
  GLD: { sym: 'GLD', yahoo: 'GLD', name: 'SPDR Gold Shares', cls: 'stock', icon: '🥇', color: '#D4AF37', dp: 2, aliases: ['gld', 'gold etf'] },
}

/**
 * Register an instrument discovered at runtime through Yahoo's symbol
 * directory, so picking "Palantir" out of search makes PLTR behave like any
 * other instrument in the table above. Kept in memory only — the curated
 * table is the durable one; this is just what the current session has looked
 * at. An existing entry is never overwritten, so the curated metadata (icon,
 * colour, decimals) always wins over whatever the directory returned.
 */
export function registerInstrument(inst: Instrument): void {
  if (!INSTRUMENTS[inst.sym]) INSTRUMENTS[inst.sym] = inst
}

/** True when this symbol is priced by Yahoo rather than Binance. */
export function isInstrument(sym: string): boolean {
  return Object.prototype.hasOwnProperty.call(INSTRUMENTS, sym)
}

export function instrumentOf(sym: string): Instrument | null {
  return INSTRUMENTS[sym] ?? null
}

/**
 * The non-crypto names the scanner sweeps, and therefore the ones that need a
 * polled price so their signal cards are not blank. Keep this in step with
 * SIGNAL_COINS in features/signals — a scanned market with no quote renders
 * without a price or a change.
 */
export const INSTRUMENT_HOT_LIST = [
  'XAUUSD', 'XAGUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'SPX500', 'NAS100', 'WTIUSD',
]

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  metal: 'Metals',
  energy: 'Energy',
  forex: 'FX',
  index: 'Indices',
  stock: 'Stocks',
}
