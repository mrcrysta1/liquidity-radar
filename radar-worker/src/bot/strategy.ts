// Research strategy F1 ("mtf50_20 | sl3 ch4 | long"): a 4h trend breakout,
// long only, on BTC / ETH / SOL / BNB. Selected as the sole primary before a
// sealed holdout was read (research: dev 2019..2026-01 +0.376R/trade, PF 2.12,
// 615 trades; holdout 2026-02..11 +0.179R/trade, PF 1.48, 63 trades, t = 0.66,
// not significant).
//
//   Entry  at a closed 4h bar i: close > EMA(300) AND close > the highest high of
//          bars i-20..i-1 → buy at the next open (live: market order right after
//          the close).
//   Stop   entry − 3 × ATR14 (ATR of the signal bar).
//   Trail  at each close j while open: stop = max(stop, highest high since entry
//          − 4 × ATR14 at j). Never lower.
//   Exit   at each close j: close ≤ EMA(300) OR close < the lowest low of bars
//          j-10..j-1 → market close. No target, no time limit.
//
// Pure functions, with the research engine's exact definitions: EMA seeded with
// the first close, ATR a running mean of the true range for the first 14 bars
// and Wilder's smoothing after, "previous N bars" excluding the current one, and
// no signal before bar 900 (warm-up). The live trader (trader.ts) and the
// backtest below share trendSignal / onClose, and test/bot-strategy.test.ts
// checks both against a copy of the research simulation.
import type { Bar } from './features.ts'

export interface TrendParams {
  emaLen: number
  /** Breakout lookback (bars, excluding the current one). */
  entryLen: number
  /** Exit lookback (bars, excluding the current one). */
  exitLen: number
  /** Initial stop, ATRs below the entry. */
  slAtr: number
  /** Chandelier trail, ATRs below the highest high since entry. */
  trailAtr: number
  /** No signal before this bar index (research warm-up: 18 × 50). */
  warm: number
}

export const F1: TrendParams = { emaLen: 300, entryLen: 20, exitLen: 10, slAtr: 3, trailAtr: 4, warm: 900 }

/** Bars of history the live trader reads: warm-up plus enough for EMA(300) to forget its seed (~e^-13). */
export const TREND_BARS = 2000

export interface TrendInd {
  ema: number[]
  atr: number[]
}

export function trendIndicators(b: Bar[], p: TrendParams = F1): TrendInd {
  const a = 2 / (p.emaLen + 1)
  const ema: number[] = []
  const atr: number[] = []
  for (let i = 0; i < b.length; i++) {
    ema.push(i ? b[i].c * a + ema[i - 1] * (1 - a) : b[i].c)
    const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l
    atr.push(i < 14 ? (i ? (atr[i - 1] * i + tr) / (i + 1) : tr) : (atr[i - 1] * 13 + tr) / 14)
  }
  return { ema, atr }
}

/** Highest high of bars i-n..i-1 (NaN when there are fewer than n). */
export function highPrev(b: Bar[], i: number, n: number): number {
  if (i < n) return NaN
  let m = -Infinity
  for (let j = i - n; j < i; j++) m = Math.max(m, b[j].h)
  return m
}

/** Lowest low of bars i-n..i-1 (NaN when there are fewer than n). */
export function lowPrev(b: Bar[], i: number, n: number): number {
  if (i < n) return NaN
  let m = Infinity
  for (let j = i - n; j < i; j++) m = Math.min(m, b[j].l)
  return m
}

/** Long entry at the close of bar i. */
export function trendSignal(b: Bar[], ind: TrendInd, i: number, p: TrendParams = F1): boolean {
  if (i < Math.max(p.warm, 1) || i >= b.length) return false
  const c = b[i].c
  return c > ind.ema[i] && c > highPrev(b, i, p.entryLen)
}

/** Rule exit at the close of bar j: the trend is gone or a 10-bar low broke. */
export function trendExit(b: Bar[], ind: TrendInd, j: number, p: TrendParams = F1): boolean {
  const c = b[j].c
  // Research: keep while close > EMA and close >= the 10-bar low (NaN never keeps).
  return !(c > ind.ema[j] && c >= lowPrev(b, j, p.exitLen))
}

/** The chandelier trail: never lower than the stop already in place. */
export function trailStop(stop: number, highSinceEntry: number, atrNow: number, p: TrendParams = F1): number {
  const ch = highSinceEntry - p.trailAtr * atrNow
  return ch > stop ? ch : stop
}

export interface TrailState {
  stop: number
  /** Highest high since entry (-Infinity before the first close). */
  high: number
}

/**
 * The close of bar j while long: exit by rule, or raise the highest high and
 * ratchet the stop. Exactly the order of the research engine.
 */
export function onClose(b: Bar[], ind: TrendInd, j: number, st: TrailState, p: TrendParams = F1): { exit: boolean } & TrailState {
  if (trendExit(b, ind, j, p)) return { exit: true, stop: st.stop, high: st.high }
  const high = Math.max(st.high, b[j].h)
  return { exit: false, high, stop: trailStop(st.stop, high, ind.atr[j], p) }
}

/** Why there is no entry at bar i (for the plan on the website), or '' if there is one. */
export function noEntryReason(b: Bar[], ind: TrendInd, i: number, p: TrendParams = F1): string {
  if (i < p.warm) return `not enough history (${i + 1} bars, F1 needs ${p.warm + 1})`
  const c = b[i].c
  const out: string[] = []
  if (!(c > ind.ema[i])) out.push(`close ${c} not above EMA(${p.emaLen}) ${+ind.ema[i].toPrecision(6)}`)
  const hh = highPrev(b, i, p.entryLen)
  if (!(c > hh)) out.push(`close ${c} not above the ${p.entryLen}-bar high ${hh}`)
  return out.length ? 'no F1 entry: ' + out.join('; ') : ''
}

export interface TrendTrade {
  /** Signal bar; the entry is at the next bar's open. */
  i: number
  entry: number
  /** Initial stop distance (1R). */
  dist: number
  initialStop: number
  exitBar: number
  exit: number
  /** 'sl' initial stop hit, 'trail' a raised stop hit, 'signal' rule exit at the next open. */
  why: 'sl' | 'trail' | 'signal'
  /** Gross R, before costs. */
  r: number
}

/**
 * F1 on one symbol, one position at a time: stops fill at the stop or at a
 * worse open on a gap, rule exits at the next open. Gross of costs and funding.
 * A trade still open at the end of the data is left out. `from`: no entry
 * before this open time (the research engine's GenOpts.from).
 */
export function trendBacktest(b: Bar[], p: TrendParams = F1, from = -Infinity): TrendTrade[] {
  const ind = trendIndicators(b, p)
  const out: TrendTrade[] = []
  for (let i = Math.max(p.warm, 1); i < b.length - 1; i++) {
    if (!trendSignal(b, ind, i, p) || b[i + 1].t < from) continue
    const entry = b[i + 1].o
    const dist = p.slAtr * ind.atr[i]
    if (!(dist > 0)) continue
    const initialStop = entry - dist
    let st: TrailState = { stop: initialStop, high: -Infinity }
    let done: TrendTrade | null = null
    for (let j = i + 1; j < b.length; j++) {
      const op = j === i + 1 ? entry : b[j].o
      if (b[j].l <= st.stop) {
        const exit = Math.min(op, st.stop)
        done = { i, entry, dist, initialStop, exitBar: j, exit, why: st.stop === initialStop ? 'sl' : 'trail', r: (exit - entry) / dist }
        break
      }
      if (j + 1 >= b.length) break
      const r = onClose(b, ind, j, st, p)
      if (r.exit) {
        const exit = b[j + 1].o
        done = { i, entry, dist, initialStop, exitBar: j, exit, why: 'signal', r: (exit - entry) / dist }
        break
      }
      st = r
    }
    if (!done) break
    out.push(done)
    // The next entry is decided at the close of the exit bar.
    i = done.exitBar - 1
  }
  return out
}

export interface TrendSetupInput {
  entry: number
  slDist: number
  /** Round-trip cost in R if the trade ends at its initial stop. */
  costR: number
  canEnter: boolean
  /** In the real-trade list (BOT_REAL_SYMBOLS). */
  listed: boolean
  openPositions: number
  tradesToday: number
}

/** The hard rules an F1 entry must pass (no R:R or target rule: F1 has no target). */
export function checkTrendSetup(i: TrendSetupInput, c: { maxCostR: number; maxOpen: number; maxTradesPerDay: number }): string[] {
  const out: string[] = []
  if (!(i.entry > 0) || !(i.slDist > 0)) out.push('invalid stop')
  if (!i.canEnter) out.push('risk limits')
  if (!i.listed) out.push('not in the real-trade list (BOT_REAL_SYMBOLS)')
  if (i.slDist > 0 && !(i.costR <= c.maxCostR)) out.push(`cost ${i.costR.toFixed(3)}R (max ${c.maxCostR}R)`)
  if (i.openPositions >= c.maxOpen) out.push(`${i.openPositions} positions open (max ${c.maxOpen})`)
  if (i.tradesToday >= c.maxTradesPerDay) out.push(`daily trade cap reached (${i.tradesToday}/${c.maxTradesPerDay})`)
  return out
}
