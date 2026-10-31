// The one list of markets every coin search and select in the app draws from.
//
// Crypto: the tracked coins (constants/market COINS) plus every TRADING USDT
// pair on Binance (services/symbolIndex). Everything else: the curated
// instruments — gold, silver, FX, indices, equities (constants/instruments) —
// and, for a free-text search, Yahoo's symbol directory. components/chart/
// CoinPicker renders it; nothing else should keep its own list of coins.
import { COINS, COIN_ALIASES, HOT_LIST } from '../../constants/market'
import {
  ASSET_CLASS_LABEL,
  INSTRUMENTS,
  INSTRUMENT_HOT_LIST,
  instrumentOf,
  registerInstrument,
} from '../../constants/instruments'
import { allBinanceSymbols } from '../../services/symbolIndex'
import type { YahooHit } from '../../services/yahoo'
import { baseOf } from '../../utils/coins'
import { parseSynthetic } from '../../services/syntheticSymbol'

/** One market, ready to show and to pick. */
export interface MarketRow {
  kind: 'crypto' | 'instrument' | 'remote'
  /** What to hand setSymbol / the caller. */
  sym: string
  /** The key state.tickers holds this market's price under. */
  priceSym: string
  /** Ticker as written: BTC, XAUUSD, AAPL. */
  ticker: string
  /** Quote currency shown after the ticker ('USDT'), or '' for instruments. */
  quote: string
  name: string
  icon: string
  color: string
  /** Small label: the asset class, or the exchange for a directory hit. */
  tag?: string
  /** The favourites key (a base ticker), or null where starring makes no sense. */
  fav: string | null
  /** A directory hit, registered as an instrument when picked. */
  hit?: YahooHit
}

export interface CatalogOptions {
  /** Binance crypto pairs only (views that cannot load an instrument). */
  cryptoOnly?: boolean
}

const COIN_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(COINS).map(([k, meta]) => [k, meta.name.toLowerCase()]),
)

/** The instrument behind a symbol, including by its Binance perpetual (XAUUSDT → gold). */
function instrumentFor(sym: string) {
  return instrumentOf(sym) ?? Object.values(INSTRUMENTS).find((i) => i.binance === sym) ?? null
}

/** Display data for any symbol the app can hold. */
export function marketRow(sym: string): MarketRow {
  // A ratio / spread expression (BTCUSDT/ETHUSDT) is shown as typed; it has no
  // ticker price of its own and nothing to star.
  const synth = parseSynthetic(sym, (x) => instrumentFor(x) != null)
  if (synth)
    return {
      kind: 'crypto',
      sym: synth.expr,
      priceSym: synth.expr,
      ticker: synth.expr,
      quote: '',
      name: synth.op === '/' ? 'Ratio' : synth.op === '-' ? 'Spread' : 'Expression',
      icon: synth.op === '/' ? '÷' : synth.op === '-' ? '−' : synth.op === '+' ? '+' : '×',
      color: '#9575CD',
      fav: null,
    }
  const inst = instrumentFor(sym)
  if (inst)
    return {
      kind: 'instrument',
      sym,
      priceSym: inst.sym,
      ticker: inst.sym,
      quote: '',
      name: inst.name,
      icon: inst.icon,
      color: inst.color,
      tag: ASSET_CLASS_LABEL[inst.cls],
      fav: inst.sym,
    }
  const base = baseOf(sym)
  const meta = COINS[base]
  return {
    kind: 'crypto',
    sym,
    priceSym: sym,
    ticker: base,
    quote: 'USDT',
    name: meta?.name ?? base,
    icon: meta?.icon ?? base.slice(0, 1),
    color: meta?.color ?? '#2962FF',
    fav: base,
  }
}

/** The list shown before anything is typed: tracked coins, then the instrument hot list. */
export function defaultMarkets(opts: CatalogOptions = {}): MarketRow[] {
  const rows = Object.keys(COINS).map((k) => marketRow(COINS[k].sym))
  if (!opts.cryptoOnly)
    for (const s of INSTRUMENT_HOT_LIST) if (!rows.some((r) => r.sym === s)) rows.push(marketRow(s))
  return opts.cryptoOnly ? rows.filter((r) => r.kind === 'crypto') : rows
}

/**
 * Markets matching a typed query, best first. Matches the ticker, the name
 * and the aliases — "gold" finds spot gold, "ripple" finds XRP — and ranks an
 * exact ticker above a name that merely contains the letters.
 */
export function searchMarkets(query: string, opts: CatalogOptions = {}, limit = 40): MarketRow[] {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/\/?usdt$/, '')
  if (!q) return defaultMarkets(opts)
  const rankOf = (ticker: string, name?: string, aliases?: string[]): number => {
    const t = ticker.toLowerCase()
    if (t === q) return 0
    if (aliases && aliases.indexOf(q) !== -1) return 1
    if (t.indexOf(q) === 0) return 2
    if (name && name.indexOf(q) === 0) return 3
    if (aliases && aliases.some((a) => a.indexOf(q) === 0)) return 4
    if (t.indexOf(q) !== -1) return 5
    if (name && name.indexOf(q) !== -1) return 6
    if (aliases && aliases.some((a) => a.indexOf(q) !== -1)) return 7
    return -1
  }
  const scored: Array<{ row: MarketRow; rank: number }> = []
  const seen = new Set<string>()
  const add = (sym: string, rank: number) => {
    if (rank < 0 || seen.has(sym)) return
    seen.add(sym)
    scored.push({ row: marketRow(sym), rank })
  }
  // Tracked coins first, so they rank even before exchangeInfo has loaded.
  for (const k of Object.keys(COINS)) {
    if (instrumentOf(COINS[k].sym)) continue
    add(COINS[k].sym, rankOf(k, COIN_NAMES[k], COIN_ALIASES[k]) * 3)
  }
  for (const s of allBinanceSymbols()) {
    const up = s.base.toUpperCase()
    add(s.sym, rankOf(s.base, COIN_NAMES[up], COIN_ALIASES[up]) * 3 + 1)
  }
  if (!opts.cryptoOnly)
    for (const inst of Object.values(INSTRUMENTS))
      add(inst.sym, rankOf(inst.sym, inst.name.toLowerCase(), inst.aliases) * 3)
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(HOT_LIST.indexOf(b.row.ticker) !== -1) - Number(HOT_LIST.indexOf(a.row.ticker) !== -1) ||
      a.row.ticker.localeCompare(b.row.ticker),
  )
  return scored.slice(0, limit).map((x) => x.row)
}

/** A Yahoo directory hit as a row (not yet registered). */
export function remoteMarket(h: YahooHit): MarketRow {
  return {
    kind: 'remote',
    sym: h.yahoo,
    priceSym: h.yahoo,
    ticker: h.yahoo,
    quote: '',
    name: h.name,
    icon: '•',
    color: '#2962FF',
    tag: h.exchange || h.kind,
    fav: null,
    hit: h,
  }
}

/**
 * Make a picked row usable and return its symbol. A directory hit is not in
 * the instrument table yet, so it is registered first — otherwise it would be
 * mistaken for a Binance pair and every request for it would 400.
 */
export function commitMarket(row: MarketRow): string {
  if (row.kind === 'remote' && row.hit)
    registerInstrument({
      sym: row.hit.yahoo,
      yahoo: row.hit.yahoo,
      name: row.hit.name,
      cls: 'stock',
      icon: '•',
      color: 'var(--primary)',
      aliases: [row.hit.name.toLowerCase()],
      dp: 2,
    })
  return row.sym
}

/**
 * Resolve free text ("gold", "eth", "PEPEUSDT") to a symbol: the best catalog
 * match, else the text taken as a Binance ticker.
 */
export function resolveMarketText(text: string, opts: CatalogOptions = {}): string | null {
  const s = text.trim()
  if (!s) return null
  const hit = searchMarkets(s, opts, 1)[0]
  if (hit) return hit.sym
  const up = s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return up ? (up.endsWith('USDT') ? up : up + 'USDT') : null
}
