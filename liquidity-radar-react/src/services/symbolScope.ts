// Keeping per-symbol market data tied to the symbol it belongs to.
//
// Funding, open interest, order books and candles are all fetched for "the
// current symbol" and written into the one shared state object. Two things
// used to go wrong on a coin switch:
//   1. a response for the previous coin landing after the switch overwrote
//      the new coin's slot, and
//   2. a coin with no futures market under its spot name (PEPEUSDT trades as
//      1000PEPEUSDT on Binance futures) simply failed, leaving the previous
//      coin's funding/OI on screen and feeding the analytics indefinitely.
// Pure helpers only — no DOM, no network, no state import — so they can be
// unit-tested in Node.
import { binancePerpOf, isInstrument } from '../constants/instruments.ts'
import { isSynthetic } from './syntheticSymbol.ts'

/**
 * Bases Binance USDⓈ-M lists only as a 1000-unit contract (1000PEPEUSDT etc.).
 * Checked against fapi.binance.com/fapi/v1/exchangeInfo (TRADING, USDT quote)
 * in October 2026. Keep it to that list: guessing a contract that does not
 * exist just turns a clean "no futures" into a failing request every poll.
 */
export const FUTURES_1000X: ReadonlySet<string> = new Set([
  'PEPE',
  'SHIB',
  'BONK',
  'FLOKI',
  'LUNC',
  'XEC',
  'SATS',
  'RATS',
  'CAT',
  'CHEEMS',
])

export interface FuturesSymbol {
  /** The Binance USDⓈ-M symbol to ask fapi for. */
  sym: string
  /** Spot units per contract unit: prices divide by it, quantities multiply. */
  mult: number
}

/**
 * The Binance perpetual for a spot symbol, or null when there is none to ask
 * for (a Yahoo-priced instrument without a Binance perp). Gold maps through
 * the instrument table (XAUUSD → XAUUSDT); the 1000-unit memecoin contracts
 * map through FUTURES_1000X; everything else trades under its spot name.
 */
export function futuresSymbolOf(spot: string): FuturesSymbol | null {
  if (!spot) return null
  const perp = binancePerpOf(spot)
  if (perp) return { sym: perp, mult: 1 }
  // Instruments and ratio / spread expressions have no perpetual of their own.
  if (isInstrument(spot) || isSynthetic(spot)) return null
  const s = spot.toUpperCase()
  const m = /^(.+)USDT$/.exec(s)
  if (m && FUTURES_1000X.has(m[1])) return { sym: '1000' + m[1] + 'USDT', mult: 1000 }
  return { sym: s, mult: 1 }
}

const scaleStr = (v: unknown, f: (n: number) => number): unknown => {
  if (v == null || v === '') return v
  const n = Number(v)
  return Number.isFinite(n) ? String(f(n)) : v
}

/**
 * A premiumIndex row restated per spot unit, so a 1000PEPE mark price lines
 * up with PEPE's spot price everywhere it is compared or charted. Funding
 * rates are ratios and are left alone.
 */
export function perUnitPremium<T extends object>(row: T, mult: number): T {
  if (!row || mult === 1) return row
  const r = { ...row } as Record<string, unknown>
  for (const k of ['markPrice', 'indexPrice', 'estimatedSettlePrice']) {
    if (k in r) r[k] = scaleStr(r[k], (n) => n / mult)
  }
  return r as T
}

/** An openInterest row restated in spot units (contracts × mult). */
export function perUnitOi<T extends object>(row: T, mult: number): T {
  if (!row || mult === 1) return row
  const r = { ...row } as Record<string, unknown>
  if ('openInterest' in r) r.openInterest = scaleStr(r.openInterest, (n) => n * mult)
  return r as T
}

export type ScopedResult = 'applied' | 'failed' | 'stale'

/**
 * Fetch for the symbol current *now*, and only let the result touch state if
 * that is still the current symbol when it arrives. A failure for the current
 * symbol runs `fail` (which should clear the field, so the previous coin's
 * value never outlives the switch); a late result or failure for a symbol the
 * user has already left is dropped.
 */
export async function symbolScoped<T>(
  current: () => string,
  load: (sym: string) => Promise<T>,
  apply: (value: T, sym: string) => void,
  fail: (err: unknown, sym: string) => void,
): Promise<ScopedResult> {
  const sym = current()
  try {
    const v = await load(sym)
    if (current() !== sym) return 'stale'
    apply(v, sym)
    return 'applied'
  } catch (e) {
    if (current() !== sym) return 'stale'
    fail(e, sym)
    return 'failed'
  }
}

/** The tag stamped on state.candles: which symbol and interval they are. */
export function candlesTag(sym: string, tf: string): string {
  return sym + '|' + tf
}

/** True when candles carrying `tag` belong to `sym` on `tf`. */
export function candlesMatch(tag: string | null | undefined, sym: string, tf: string): boolean {
  return !!tag && tag === candlesTag(sym, tf)
}
