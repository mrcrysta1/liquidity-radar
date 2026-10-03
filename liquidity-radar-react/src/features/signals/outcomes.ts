// Grading the scanner's calls on what they actually claimed, and learning a
// weight per indicator from those grades. Pure functions (tested in
// scripts/test-engines.mjs); signals.ts owns the storage and the timing.
//
// A "call" is a BUY or SELL signal that came with a trade plan. It opens once
// per market (a new one only after the previous resolved), and resolves on
// hourly candles that start after it was made: the target (T1) touched first is
// a win, the stop touched first is a loss, a candle that touches both counts as
// a loss, and neither within the time limit is "expired" — counted, but not as
// a win or a loss. This replaced a check of whether price had moved 0.3% by the
// next sweep two minutes later, which never looked at the stop or the target.

export type Dir = 'BUY' | 'SELL'
export type Result = 'win' | 'loss' | 'expired'

export interface SigCall {
  id: string
  sym: string
  dir: Dir
  entry: number
  stop: number
  t1: number
  openedAt: number
  expiresAt: number
  /** Open time of the last hourly candle already checked against the levels. */
  checkedUntil: number
  /** Signed contribution of each scoring term to the call (+ = towards BUY). */
  terms: Record<string, number>
  tier?: string
}

export interface GradedCall extends SigCall {
  result: Result
  closedAt: number
}

export interface HourCandle {
  t: number
  h: number
  l: number
}

export const HOUR = 3_600_000
/** How long a call has to reach its target or stop. */
export const CALL_TTL = 72 * HOUR

/**
 * Advance one open call over newly available hourly candles. Returns the result
 * once it is decided, or null while it is still open (the call's checkedUntil
 * is moved forward). Candles that started before the call are ignored, so a wick
 * from before the entry can never decide it.
 */
export function advanceCall(call: SigCall, candles: HourCandle[], now: number): Result | null {
  const fresh = candles.filter((c) => c.t >= call.openedAt && c.t > call.checkedUntil && c.t + HOUR <= now)
  // A gap in the record (the app was closed longer than the candles we have)
  // means the stop or target may have been hit unseen: do not guess.
  // (The first candle after a call starts within an hour of it.)
  const seen = Math.max(call.checkedUntil, call.openedAt)
  if (fresh.length && fresh[0].t > seen + HOUR) return 'expired'
  for (const c of fresh) {
    const hitStop = call.dir === 'BUY' ? c.l <= call.stop : c.h >= call.stop
    const hitT1 = call.dir === 'BUY' ? c.h >= call.t1 : c.l <= call.t1
    call.checkedUntil = c.t
    if (hitStop) return 'loss' // includes a candle that touched both
    if (hitT1) return 'win'
  }
  if (now >= call.expiresAt) return 'expired'
  return null
}

export interface WinRate {
  rate: number
  wins: number
  losses: number
  expired: number
  /** wins + losses */
  n: number
}

export function winRate(done: GradedCall[]): WinRate {
  const wins = done.filter((c) => c.result === 'win').length
  const losses = done.filter((c) => c.result === 'loss').length
  const expired = done.filter((c) => c.result === 'expired').length
  const n = wins + losses
  return { rate: n ? wins / n : 0, wins, losses, expired, n }
}

export interface TermStat {
  /** Decided calls where this term pointed the same way as the call. */
  n: number
  wins: number
}

/** For each term: how often calls it agreed with were won. */
export function termStats(done: GradedCall[]): Record<string, TermStat> {
  const out: Record<string, TermStat> = {}
  for (const c of done) {
    if (c.result === 'expired') continue
    const sign = c.dir === 'BUY' ? 1 : -1
    for (const [term, v] of Object.entries(c.terms)) {
      if (!v || Math.sign(v) !== sign) continue
      const s = (out[term] ??= { n: 0, wins: 0 })
      s.n++
      if (c.result === 'win') s.wins++
    }
  }
  return out
}

/** Graded calls a term needs before its weight moves at all. */
export const MIN_TERM_CALLS = 20

/**
 * Each term's weight from its record: a term whose agreeing calls win more
 * often than calls overall gets more say, one that wins less gets less. Rates
 * are smoothed toward the overall rate (a few lucky calls barely move it) and
 * the result stays within 0.5x-1.5x of the default, so one bad week cannot
 * switch an indicator off. Recomputed from the whole record every time — it
 * does not ratchet.
 */
export function learnedWeights(base: Record<string, number>, done: GradedCall[]): Record<string, number> {
  const overall = winRate(done)
  const out = { ...base }
  if (overall.n < MIN_TERM_CALLS) return out
  const stats = termStats(done)
  const prior = 10 // pseudo-calls at the overall rate
  for (const term of Object.keys(base)) {
    const s = stats[term]
    if (!s || s.n < MIN_TERM_CALLS) continue
    const rate = (s.wins + prior * overall.rate) / (s.n + prior)
    const factor = Math.max(0.5, Math.min(1.5, 1 + 2 * (rate - overall.rate)))
    out[term] = Math.round(base[term] * factor * 10) / 10
  }
  return out
}
