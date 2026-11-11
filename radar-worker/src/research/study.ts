// Strategy study: the statistics behind scripts/study.ts. Pure (tested in
// test/research-study.test.ts). Two questions, both on F1's own entries so
// every comparison is like for like:
//
//   filters   does a confirmation (C6's model, BTC above its EMA(300), both)
//             pick better F1 trades? Every F1 entry is kept or rejected; the
//             rejected ones keep their hypothetical outcome, so false
//             positives (taken, lost) and missed opportunities (rejected,
//             won) are counted, not guessed.
//   exits     would another exit have kept more of the move? Each F1 entry is
//             replayed bar by bar under the current exit (A) and under
//             trailing (B), break-even (C), partial profit (D) and trend (E)
//             variants. Decisions are taken at bar closes only; a bar that
//             touches both the stop and a profit level is counted as a stop
//             (the worse case). Every variant is compared with A trade by
//             trade (paired), clustered by entry day.
//
// Nothing here changes the bot: the study only reports.
import type { Bar } from '../bot/features.ts'
import { F1, trendExit } from '../bot/strategy.ts'
import type { TrendInd } from '../bot/strategy.ts'
import { summarize } from './audit.ts'
import type { Summary } from './audit.ts'

// ---- exit variants ---------------------------------------------------------------

export type ExitVariant =
  /** A: F1 as it trades — 3 ATR stop, 4 ATR chandelier trail, exit on close ≤ EMA(300) or < the 10-bar low. */
  | { id: string; kind: 'f1' }
  /** B: F1 with a tighter chandelier trail (`atr` ATRs below the highest high). */
  | { id: string; kind: 'trail'; atr: number }
  /** C: F1, and once the best high is `atR` R above the entry the stop moves to the entry. */
  | { id: string; kind: 'breakeven'; atR: number }
  /** D: F1, and `part` of the position is sold at entry + `atR` R. */
  | { id: string; kind: 'partial'; atR: number; part: number }
  /** E: F1's stops, but the rule exit is a close below EMA(`emaLen`) instead of EMA(300) / the 10-bar low. */
  | { id: string; kind: 'trend'; emaLen: number }

/** The variants tested, fixed before the run (no tuning on the results). */
export const EXIT_VARIANTS: ExitVariant[] = [
  { id: 'A', kind: 'f1' },
  { id: 'B-trail3', kind: 'trail', atr: 3 },
  { id: 'B-trail2', kind: 'trail', atr: 2 },
  { id: 'C-be1', kind: 'breakeven', atR: 1 },
  { id: 'C-be1.5', kind: 'breakeven', atR: 1.5 },
  { id: 'C-be2', kind: 'breakeven', atR: 2 },
  { id: 'D-part1.5', kind: 'partial', atR: 1.5, part: 0.5 },
  { id: 'D-part2', kind: 'partial', atR: 2, part: 0.5 },
  { id: 'E-ema50', kind: 'trend', emaLen: 50 },
  { id: 'E-ema20', kind: 'trend', emaLen: 20 },
]

export interface ExitLeg {
  /** Share of the position. */
  w: number
  price: number
}

export interface ExitResult {
  /** Bar of the last exit decision (stop bar, or the close that triggered a rule exit). */
  exitBar: number
  why: 'sl' | 'trail' | 'breakeven' | 'signal'
  legs: ExitLeg[]
  /** Gross R of the whole position. */
  grossR: number
  /** Best and worst point reached while open, in R of the initial stop (gross). */
  mfeR: number
  maeR: number
}

/** EMA of the closes, seeded with the first close (as strategy.ts). */
export function ema(b: Bar[], n: number): number[] {
  const a = 2 / (n + 1)
  const out: number[] = []
  for (let i = 0; i < b.length; i++) out.push(i ? b[i].c * a + out[i - 1] * (1 - a) : b[i].c)
  return out
}

/**
 * Replay one long F1 entry (signal bar i, filled at `entry` on bar i + 1's
 * open, 1R = `dist`) under a variant. `trendEma` is EMA(emaLen) of the bars
 * for a 'trend' variant. null: still open at the end of the data.
 */
export function simulateExit(b: Bar[], ind: TrendInd, i: number, entry: number, dist: number, v: ExitVariant, trendEma?: number[]): ExitResult | null {
  const initial = entry - dist
  let stop = initial
  let best = -Infinity
  let rest = 1
  const legs: ExitLeg[] = []
  let mfe = 0
  let mae = 0
  let be = false
  const trailAtr = v.kind === 'trail' ? v.atr : F1.trailAtr
  const done = (j: number, why: ExitResult['why'], price: number): ExitResult => {
    legs.push({ w: rest, price })
    const grossR = legs.reduce((a, l) => a + (l.w * (l.price - entry)) / dist, 0)
    return { exitBar: j, why, legs, grossR, mfeR: mfe, maeR: Math.min(mae, (price - entry) / dist) }
  }
  for (let j = i + 1; j < b.length; j++) {
    const open = j === i + 1 ? entry : b[j].o
    if (b[j].l <= stop) {
      const px = Math.min(open, stop)
      // Where in the bar the high came is unknown: only the open counts as reached.
      mfe = Math.max(mfe, (open - entry) / dist)
      mae = Math.min(mae, (px - entry) / dist)
      return done(j, stop === initial ? 'sl' : be && stop === entry ? 'breakeven' : 'trail', px)
    }
    mfe = Math.max(mfe, (b[j].h - entry) / dist)
    mae = Math.min(mae, (b[j].l - entry) / dist)
    if (v.kind === 'partial' && rest === 1) {
      const target = entry + v.atR * dist
      if (b[j].h >= target) {
        // A resting limit: filled at the target, or at a better open on a gap.
        legs.push({ w: v.part, price: Math.max(open, target) })
        rest = 1 - v.part
      }
    }
    if (j + 1 >= b.length) return null
    const ruleExit = v.kind === 'trend' ? !(b[j].c > trendEma![j]) : trendExit(b, ind, j)
    if (ruleExit) return done(j, 'signal', b[j + 1].o)
    best = Math.max(best, b[j].h)
    const ch = best - trailAtr * ind.atr[j]
    if (ch > stop) stop = ch
    if (v.kind === 'breakeven' && !be && best - entry >= v.atR * dist) {
      be = true
      if (entry > stop) stop = entry
    }
  }
  return null
}

/** Net R of an exit: every leg is a market order paying `leg` (fee + slippage, fraction of price); funding in R added (long). */
export function exitNetR(x: ExitResult, entry: number, dist: number, leg: number, fundLongR: number): number {
  const cost = (leg * entry + x.legs.reduce((a, l) => a + l.w * leg * l.price, 0)) / dist
  return x.grossR - cost + fundLongR
}

// ---- profit giveback -------------------------------------------------------------

export interface Giveback {
  n: number
  /** Mean best point reached, R. */
  avgMfeR: number
  /** Mean R given back from the best point to the exit (gross). */
  avgGivebackR: number
  /** Trades that were ≥ 1R up at some point. */
  reached1R: number
  /** ... of which closed at a loss (net). */
  reached1RLost: number
  /** Mean R given back by the trades that reached 1R. */
  givebackAfter1R: number
}

export function giveback(xs: Array<{ mfeR: number; grossR: number; netR: number }>): Giveback {
  const n = xs.length
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
  const up = xs.filter((x) => x.mfeR >= 1)
  return {
    n,
    avgMfeR: avg(xs.map((x) => x.mfeR)),
    avgGivebackR: avg(xs.map((x) => Math.max(0, x.mfeR - x.grossR))),
    reached1R: up.length,
    reached1RLost: up.filter((x) => x.netR < 0).length,
    givebackAfter1R: avg(up.map((x) => Math.max(0, x.mfeR - x.grossR))),
  }
}

// ---- filter comparison -----------------------------------------------------------

export interface FilterRow {
  /** Entry time (ms). */
  t: number
  /** Net R (conservative costs). */
  r: number
  keep: boolean
}

export interface FilterReport {
  taken: Summary
  rejected: Summary
  /** Taken trades that lost (net). */
  falsePositives: number
  /** Rejected trades that would have won (net). */
  missed: number
  /** Kept minus rejected mean; the filter "helps" only if the rejected trades' 95% range is entirely below the unfiltered mean. */
  helps: boolean
}

export function compareFilter(rows: FilterRow[]): FilterReport {
  const taken = rows.filter((x) => x.keep)
  const rej = rows.filter((x) => !x.keep)
  const all = summarize(rows)
  const rejected = summarize(rej)
  return {
    taken: summarize(taken),
    rejected,
    falsePositives: taken.filter((x) => x.r < 0).length,
    missed: rej.filter((x) => x.r > 0).length,
    helps: rejected.hi != null && all.mean != null && rejected.hi < all.mean,
  }
}

/** Paired difference variant − baseline per trade, clustered by entry day: `better` only if its 95% range is above zero. */
export function paired(base: Array<{ t: number; r: number }>, alt: Array<{ t: number; r: number }>): Summary & { better: boolean; worse: boolean } {
  const s = summarize(base.map((x, k) => ({ t: x.t, r: alt[k].r - x.r })))
  return { ...s, better: s.lo != null && s.lo > 0, worse: s.hi != null && s.hi < 0 }
}

