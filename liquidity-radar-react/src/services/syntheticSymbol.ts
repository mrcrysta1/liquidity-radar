// Ratio / spread "symbols": BTCUSDT/ETHUSDT, BTCUSDT-ETHUSDT, BTCUSDT*2.
//
// TradingView lets the symbol box take an expression and charts the result as
// if it were one market. Here the expression is the symbol itself — it rides
// through state.symbol, setSymbol and loadCandles unchanged — and the one
// place candles enter the app (services/marketData fetchBase) fetches each
// leg and joins them with combineSeries below. Pure, no imports, so
// scripts/test-engines.mjs runs it.
import type { CandleFlat } from './market'

export type SynthOp = '/' | '-' | '+' | '*'

export interface Synthetic {
  /** Canonical spelling, e.g. "BTCUSDT/ETHUSDT" — what setSymbol is handed. */
  expr: string
  a: string
  op: SynthOp
  /** The second leg, or null when the right-hand side is a constant. */
  b: string | null
  /** The constant on the right-hand side (BTCUSDT*2), when `b` is null. */
  k: number
}

// A bare quote currency is not a leg: "BTC/USDT" and "BTC-USDT" are how people
// write one pair, and must keep meaning that pair.
const QUOTES = new Set(['USDT', 'USD', 'USDC', 'BUSD', 'FDUSD'])
const NUM = /^\d+(\.\d+)?$/
const LEG = /^[A-Z0-9.^=_]{2,20}$/

/**
 * One leg: a ticker as typed. Bare crypto tickers get USDT, as everywhere else
 * in the app (BTC/ETH → BTCUSDT/ETHUSDT); `whole` says which tickers are
 * already complete symbols (Yahoo instruments such as XAUUSD).
 */
function leg(s: string, whole?: (s: string) => boolean): string | null {
  if (!LEG.test(s) || NUM.test(s) || QUOTES.has(s)) return null
  if (whole?.(s) || /USDT$/.test(s)) return s
  return s + 'USDT'
}

/** Parse `raw` as a two-term expression; null for an ordinary symbol. */
export function parseSynthetic(raw: unknown, whole?: (s: string) => boolean): Synthetic | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/\s+/g, '').toUpperCase()
  // Exactly one operator, not at either end ("-" inside a leg is not a thing
  // any venue uses, so the first one found is the operator).
  const m = /^([^/*+-]+)([/*+-])([^/*+-]+)$/.exec(s)
  if (!m) return null
  const op = m[2] as SynthOp
  const a = leg(m[1], whole)
  if (!a) return null
  if (NUM.test(m[3])) {
    const k = Number(m[3])
    if (!Number.isFinite(k) || (op === '/' && k === 0)) return null
    return { expr: a + op + m[3], a, op, b: null, k }
  }
  const b = leg(m[3], whole)
  if (!b || b === a) return null
  return { expr: a + op + b, a, op, b, k: 0 }
}

export function isSynthetic(sym: unknown): boolean {
  return parseSynthetic(sym) != null
}

function apply(op: SynthOp, x: number, y: number): number {
  switch (op) {
    case '/':
      return x / y
    case '*':
      return x * y
    case '+':
      return x + y
    default:
      return x - y
  }
}

/**
 * Bar-by-bar combination. Each field is combined with its counterpart (open
 * with open, high with high...), the way TradingView builds a spread, and the
 * high/low are then widened to contain the open and close — a ratio's "high"
 * of highs can sit below its close when the denominator rallied harder.
 * Volume is the first leg's: the only volume that means anything on a
 * ratio's chart is the market you would trade.
 */
function combineBar(op: SynthOp, x: CandleFlat, y: { o: number; h: number; l: number; c: number }): CandleFlat | null {
  const o = apply(op, x.o, y.o)
  const c = apply(op, x.c, y.c)
  const h1 = apply(op, x.h, y.h)
  const l1 = apply(op, x.l, y.l)
  if (![o, c, h1, l1].every(Number.isFinite)) return null
  return {
    t: x.t,
    o,
    h: Math.max(o, c, h1, l1),
    l: Math.min(o, c, h1, l1),
    c,
    v: x.v,
  }
}

/**
 * Join two candle series on open time (only bars both legs have) and combine
 * them with `op`. Inputs need not be sorted; the output is, oldest first.
 */
export function combineSeries(a: CandleFlat[], b: CandleFlat[], op: SynthOp): CandleFlat[] {
  const byT = new Map<number, CandleFlat>()
  for (const r of b) byT.set(r.t, r)
  const out: CandleFlat[] = []
  for (const x of a) {
    const y = byT.get(x.t)
    if (!y) continue
    const bar = combineBar(op, x, y)
    if (bar) out.push(bar)
  }
  return out.sort((p, q) => p.t - q.t)
}

/** A series combined with a constant (BTCUSDT*2). */
export function scaleSeries(a: CandleFlat[], op: SynthOp, k: number): CandleFlat[] {
  const out: CandleFlat[] = []
  for (const x of a) {
    const bar = combineBar(op, x, { o: k, h: k, l: k, c: k })
    if (bar) out.push(bar)
  }
  return out
}

/** Combine whatever the legs returned, for the expression `s`. */
export function synthesize(s: Synthetic, a: CandleFlat[], b: CandleFlat[] | null): CandleFlat[] {
  return s.b ? combineSeries(a, b || [], s.op) : scaleSeries(a, s.op, s.k)
}
