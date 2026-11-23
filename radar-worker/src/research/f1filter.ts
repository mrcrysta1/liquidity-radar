// F1 trade filter research (option 2): a model that only says "take" or
// "skip" to F1's own entries, as C6 does. f1Inputs is also used live by the
// paper strategy F1F (src/bot/f1f.ts). Tested in test/research-f1filter.test.ts; run by
// scripts/f1-filter.ts.
//
//   f1Inputs     the extra inputs about the breakout itself, at the signal bar.
//   walkFilter   half-year walk-forward: each half-year is judged by a model
//                fitted only on F1 trades that had closed at least an embargo
//                before it started (expanding window, as C6 retrains).
//   filterReport what the filter took vs what it skipped vs F1 alone.
import type { Bar } from '../bot/features.ts'
import { summarize } from './audit.ts'
import type { Summary } from './audit.ts'
import { ema } from './ml2.ts'

export const F1_INPUTS = ['breakout_atr', 'above_ema300_atr', 'ema300_slope30_atr', 'range20_atr'] as const

/**
 * At signal bar i: how far the close broke above the previous 20-bar high,
 * how far it sits above EMA(300), EMA(300)'s slope over 30 bars, and the
 * width of the 20-bar range before it — all in ATR. Bars 0..i only.
 */
export function f1Inputs(b: Bar[], atr: number[], e300: number[], i: number): number[] | null {
  if (i < 330) return null
  const a = atr[i] || 1e-12
  let hi = -Infinity
  let lo = Infinity
  for (let k = i - 20; k < i; k++) {
    hi = Math.max(hi, b[k].h)
    lo = Math.min(lo, b[k].l)
  }
  return [(b[i].c - hi) / a, (b[i].c - e300[i]) / a, (e300[i] - e300[i - 30]) / a, (hi - lo) / a]
}

export const ema300 = (b: Bar[]) => ema(b.map((x) => x.c), 300)

export interface FilterRow {
  t: number
  tExit: number
  r: number
  x: number[]
}

/** Half-year starts (1 Jan, 1 Jul) from `from` up to `to`. */
export function halfYears(from: number, to: number): number[] {
  const out: number[] = []
  const d = new Date(from)
  let y = d.getUTCFullYear()
  let h = d.getUTCMonth() < 6 ? 0 : 6
  for (;;) {
    const s = Date.UTC(y, h, 1)
    if (s > to) break
    if (s >= from) out.push(s)
    h += 6
    if (h === 12) {
      h = 0
      y++
    }
  }
  return out
}

export type Fit = (train: FilterRow[]) => ((x: number[]) => number) | null

/**
 * Take / skip for every row from the first half-year with enough history:
 * the model for half-year [s, next) is fitted on rows with tExit < s − embargo,
 * and takes a row when its probability is at least that training set's win rate.
 */
export function walkFilter(rows: FilterRow[], fit: Fit, starts: number[], embargoMs: number, minRows: number): Map<FilterRow, boolean> {
  const out = new Map<FilterRow, boolean>()
  starts.forEach((s, k) => {
    const end = starts[k + 1] ?? Infinity
    const tr = rows.filter((r) => r.tExit < s - embargoMs)
    if (tr.length < minRows) return
    const p = fit(tr)
    if (!p) return
    const base = tr.filter((r) => r.r > 0).length / tr.length
    for (const r of rows) if (r.t >= s && r.t < end) out.set(r, p(r.x) >= base)
  })
  return out
}

export interface FilterReport {
  all: Summary
  taken: Summary
  skipped: Summary
  /** Taken − skipped mean R, with a range from the two clustered summaries combined. */
  gap: { mean: number | null; lo: number | null; hi: number | null }
  takenShare: number
  /** Total R / max drawdown (R). */
  retDd: { all: number | null; taken: number | null }
}

export function filterReport(rows: Array<{ t: number; r: number; take: boolean }>): FilterReport {
  const all = summarize(rows)
  const taken = summarize(rows.filter((x) => x.take))
  const skipped = summarize(rows.filter((x) => !x.take))
  const se = (s: Summary) => (s.lo != null && s.hi != null ? (s.hi - s.lo) / 3.92 : null)
  const a = se(taken)
  const b = se(skipped)
  const mean = taken.mean != null && skipped.mean != null ? taken.mean - skipped.mean : null
  const s = a != null && b != null ? Math.sqrt(a * a + b * b) : null
  const rd = (x: Summary) => (x.maxDdR > 0 ? x.totalR / x.maxDdR : null)
  return {
    all,
    taken,
    skipped,
    gap: { mean, lo: mean != null && s != null ? mean - 1.96 * s : null, hi: mean != null && s != null ? mean + 1.96 * s : null },
    takenShare: rows.length ? rows.filter((x) => x.take).length / rows.length : 0,
    retDd: { all: rd(all), taken: rd(taken) },
  }
}
