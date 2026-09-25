// One place that knows every market this app can open, and can find one
// inside a sentence.
//
// The chat used to resolve coins against COIN_ALIASES alone — 32 entries out
// of the ~400 Binance pairs the search bar already loaded, and none of the
// metals, FX, indices or equities. Ask it about BONK or JUP or gold and it
// found nothing, fell through every branch, and said it did not understand.
// That single gap is most of why the assistant felt useless on anything but
// the majors.
//
// The exchange list lives here rather than inside the search widget so the
// chat and the search bar share one fetch and one view of the universe.
import { noteCall } from './dataSources'
import { COINS, COIN_ALIASES } from '../constants/market'
import { INSTRUMENTS } from '../constants/instruments'

export interface Market {
  /** What to hand setSymbol. */
  sym: string
  /** Ticker as a person writes it: BTC, BONK, XAUUSD, AAPL. */
  base: string
  /** Human name, when known. */
  name: string
  kind: 'crypto' | 'instrument'
}

export interface RawSymbol {
  symbol: string
  status: string
  baseAsset: string
  quoteAsset: string
  filters: Array<{ filterType: string; tickSize?: string }>
}

export interface ExchangeSymbol {
  sym: string
  base: string
  quote: string
  prec: string | undefined
}

let binanceSymbols: ExchangeSymbol[] = []
let fetching: Promise<void> | null = null

export function allBinanceSymbols(): ExchangeSymbol[] {
  return binanceSymbols
}

/** Fetched once per page load and shared by every caller. */
export function loadExchangeInfo(): Promise<void> {
  if (!fetching) {
    fetching = (async () => {
      try {
        const url = 'https://api.binance.com/api/v3/exchangeInfo'
        const t0 = Date.now()
        const r = await fetch(url)
        noteCall(url, r.ok, r.status, Date.now() - t0)
        const d = (await r.json()) as { symbols: RawSymbol[] }
        binanceSymbols = d.symbols
          .filter((s) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
          .map((s) => {
            const pf = s.filters.find((f) => f.filterType === 'PRICE_FILTER')
            return { sym: s.symbol, base: s.baseAsset, quote: s.quoteAsset, prec: pf ? pf.tickSize : '0.01' }
          })
        binanceSymbols.sort((a, b) => a.base.localeCompare(b.base))
      } catch {
        /* silent — callers render their own empty state */
      }
    })()
  }
  return fetching
}

/**
 * Tickers that are also ordinary English, which a bare-word match would
 * otherwise claim. Binance really does list ME, ID, SUN, GO, FOR, NOT, AI and
 * friends, so "not sure what to do" must not resolve to the NOT token.
 */
const AMBIGUOUS = new Set([
  'me', 'id', 'go', 'for', 'not', 'ai', 'sun', 'win', 'now', 'one', 'own', 'so', 'up', 'on',
  'in', 'at', 'it', 'is', 'be', 'do', 'by', 'or', 'if', 'us', 'we', 'my', 'no', 'an', 'as',
  'are', 'and', 'the', 'you', 'can', 'get', 'how', 'why', 'who', 'new', 'top', 'buy', 'sell',
  'high', 'low', 'good', 'bad', 'best', 'next', 'time', 'data', 'cake', 'gas', 'move', 'push',
  'super', 'alpha', 'beta', 'form', 'front', 'cream', 'dash', 'flow', 'grt', 'hot', 'key',
])

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

interface Entry {
  market: Market
  /** Lowercase phrase to look for. */
  phrase: string
  /** Higher wins when two entries match the same text. */
  weight: number
}

let entries: Entry[] | null = null
let entriesBuiltWith = 0

function buildEntries(): Entry[] {
  const out: Entry[] = []
  const push = (market: Market, phrase: string, weight: number) => {
    const p = norm(phrase)
    if (p) out.push({ market, phrase: p, weight })
  }

  // Curated coins: ticker, name and every alias.
  for (const [k, meta] of Object.entries(COINS)) {
    const m: Market = { sym: meta.sym, base: k, name: meta.name, kind: 'crypto' }
    push(m, k, 60)
    push(m, meta.name, 55)
    for (const a of COIN_ALIASES[k] || []) push(m, a, 58)
  }
  // Instruments: symbol, name and aliases.
  for (const inst of Object.values(INSTRUMENTS)) {
    const m: Market = { sym: inst.sym, base: inst.sym, name: inst.name, kind: 'instrument' }
    push(m, inst.sym, 60)
    push(m, inst.name, 55)
    for (const a of inst.aliases) push(m, a, 58)
  }
  // Everything else Binance lists. Lower weight so a curated coin wins a tie.
  for (const s of binanceSymbols) {
    if (COINS[s.base]) continue
    push({ sym: s.sym, base: s.base, name: s.base, kind: 'crypto' }, s.base, 30)
  }
  // Longest phrase first: "pax gold" must beat "gold", "shiba inu" beat "shib".
  out.sort((a, b) => b.phrase.length - a.phrase.length || b.weight - a.weight)
  return out
}

function index(): Entry[] {
  if (!entries || entriesBuiltWith !== binanceSymbols.length) {
    entries = buildEntries()
    entriesBuiltWith = binanceSymbols.length
  }
  return entries
}

/**
 * Find the market a sentence is talking about.
 *
 * Multi-word names and aliases are tried before bare tickers, and a bare
 * ticker that is also an English word only counts when it was capitalised in
 * the original text — otherwise "how do I get in" would resolve to IN.
 */
export function resolveMarket(text: string): Market | null {
  const t = ' ' + norm(text) + ' '
  if (!t.trim()) return null
  let best: { e: Entry; score: number } | null = null
  for (const e of index()) {
    if (t.indexOf(' ' + e.phrase + ' ') === -1) continue
    if (!e.phrase.includes(' ') && AMBIGUOUS.has(e.phrase)) {
      // Only accept it if the user actually shouted the ticker.
      const shouted = new RegExp('\\b' + e.phrase.toUpperCase() + '\\b').test(text)
      if (!shouted) continue
    }
    const score = e.weight + e.phrase.length * 2
    if (!best || score > best.score) best = { e, score }
  }
  return best ? best.e.market : null
}

/** Resolve an exact ticker, for "open X" style commands. */
export function marketBySymbol(sym: string): Market | null {
  const up = String(sym || '').toUpperCase()
  if (INSTRUMENTS[up]) {
    const i = INSTRUMENTS[up]
    return { sym: i.sym, base: i.sym, name: i.name, kind: 'instrument' }
  }
  if (COINS[up]) return { sym: COINS[up].sym, base: up, name: COINS[up].name, kind: 'crypto' }
  const hit = binanceSymbols.find((s) => s.base === up || s.sym === up)
  return hit ? { sym: hit.sym, base: hit.base, name: hit.base, kind: 'crypto' } : null
}

/** How many markets the assistant can currently talk about. */
export function universeSize(): number {
  return binanceSymbols.length + Object.keys(INSTRUMENTS).length
}
