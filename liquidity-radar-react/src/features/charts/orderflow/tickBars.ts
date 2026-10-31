// Tick charts: a bar every N trades (100T, 500T, 1000T…), built from the
// charted symbol's aggTrade stream for the current session.
//
// Binance has no tick history to page in, so these start empty and grow
// while the page watches. Trades are kept in a fixed-size ring (typed
// arrays, a few MB at most) rather than as bars, so switching N rebuilds
// every bar from the same tape. Bar boundaries are pinned to the trade's
// global sequence number (every Nth trade since the tape started), so bars
// do not re-phase when the ring drops its oldest trades.
//
// A Binance aggTrade folds the fills of one taker order at one price into a
// single print: "N trades" means N aggTrades, which is what the stream gives.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.
import type { CandleFlat } from '../../../services/market'

/** The chart works in whole seconds: bars are spaced at least this far apart. */
export const TICK_STEP_MS = 1000
export const TICK_SIZES = [100, 250, 500, 1000, 2000] as const
export const DEFAULT_TICKS = 500

export interface TradeTape {
  cap: number
  price: Float64Array
  qty: Float64Array
  time: Float64Array
  /** Trades ever pushed; the ring holds the last min(total, cap) of them. */
  total: number
}

export function createTradeTape(cap = 100_000): TradeTape {
  return {
    cap,
    price: new Float64Array(cap),
    qty: new Float64Array(cap),
    time: new Float64Array(cap),
    total: 0,
  }
}

export function pushTrade(tape: TradeTape, price: number, qty: number, time: number): void {
  if (!(price > 0) || !isFinite(price)) return
  const i = tape.total % tape.cap
  tape.price[i] = price
  tape.qty[i] = qty > 0 ? qty : 0
  tape.time[i] = time
  tape.total++
}

export function clearTape(tape: TradeTape): void {
  tape.total = 0
}

export function clampTicks(n: unknown): number {
  const v = Math.round(Number(n))
  if (!(v > 0) || !isFinite(v)) return DEFAULT_TICKS
  return Math.max(10, Math.min(100_000, v))
}

/**
 * Bars of `n` trades each, oldest first; the last one is still forming when
 * the tape's total is not a multiple of `n`. A leading bar the ring has
 * partly forgotten is dropped rather than drawn short.
 */
export function buildTickBars(tape: TradeTape, n: number): CandleFlat[] {
  const size = clampTicks(n)
  const first = Math.max(0, tape.total - tape.cap)
  const start = Math.ceil(first / size) * size
  const out: CandleFlat[] = []
  let cur: CandleFlat | null = null
  let lastT = -Infinity
  for (let g = start; g < tape.total; g++) {
    const i = g % tape.cap
    const p = tape.price[i]
    const q = tape.qty[i]
    if ((g - start) % size === 0) {
      // Strictly increasing whole seconds, as lightweight-charts requires:
      // on a busy market several bars open inside one second, and each is
      // nudged a second past the last (as range bars are, series/rangeBars).
      const t: number = Math.max(Math.floor(tape.time[i] / 1000) * 1000, lastT + TICK_STEP_MS)
      lastT = t
      cur = { t, o: p, h: p, l: p, c: p, v: q }
      out.push(cur)
    } else if (cur) {
      cur.c = p
      cur.v += q
      if (p > cur.h) cur.h = p
      if (p < cur.l) cur.l = p
    }
  }
  return out
}
