// Which of the model's 18 inputs carry information? (plan step 3;
// scripts/ml-inputs.ts.) Pure functions, tested in test/research-inputs.test.ts.
// Everything is measured out of sample, on the walk-forward's test blocks:
//
//   foldRows      the walk-forward's folds, exactly as walkforward.ts cuts them
//                 (train on the 2,000 bars before, purged by the horizon; test
//                 on the next 250), with both sides' labels on every test bar.
//   permutation   shuffle one input (or a group) across a fold's test rows and
//                 measure how much worse the fitted model's log loss gets: no
//                 retraining, so nothing from the test block reaches the model.
//   rankIc        Spearman correlation of one input with the trade's result on
//                 the test rows: needs no model at all.
//   correlations  inputs that move together (redundant information).
import type { Bar, Bracket, Ind } from '../bot/features.ts'
import { FEATURES, featureAt, outcomeAt } from '../bot/features.ts'
import { applyScaler, predict } from '../bot/mlp.ts'
import type { Model, SideModel, WfConfig } from '../bot/walkforward.ts'

export interface TestRow {
  i: number
  t: number
  x: number[]
  /** Gross R of the bracket on each side (null if it had not ended). */
  long: number | null
  short: number | null
}

export interface Fold {
  /** Bars [trainFrom, trainTo) train, [testFrom, testTo) test. */
  trainFrom: number
  trainTo: number
  testFrom: number
  testTo: number
}

/** The walk-forward's folds (walkforward.ts walkForward). */
export function folds(n: number, cfg: Pick<WfConfig, 'trainBars' | 'testBars'> & { bracket: Bracket }): Fold[] {
  const H = cfg.bracket.horizon
  const out: Fold[] = []
  for (let start = cfg.trainBars; start + H < n; start += cfg.testBars)
    out.push({ trainFrom: Math.max(0, start - cfg.trainBars), trainTo: start - H, testFrom: start, testTo: Math.min(n - H - 1, start + cfg.testBars) })
  return out
}

export function testRows(b: Bar[], ind: Ind, f: Fold, k: Bracket): TestRow[] {
  const out: TestRow[] = []
  for (let i = f.testFrom; i < f.testTo; i++) {
    const x = featureAt(b, ind, i)
    if (!x) continue
    out.push({ i, t: b[i].t, x, long: outcomeAt(b, ind, i, 1, k)?.r ?? null, short: outcomeAt(b, ind, i, -1, k)?.r ?? null })
  }
  return out
}

const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p))
const pOf = (s: SideModel, x: number[]) => predict(s.w, applyScaler(s.scaler, x))

/** Mean log loss of one side's net on rows with a known label (win = result > 0, as trained). */
export function sideLogLoss(s: SideModel, xs: number[][], r: Array<number | null>): { ll: number; n: number } {
  let ll = 0
  let n = 0
  xs.forEach((x, k) => {
    const y = r[k]
    if (y == null) return
    const p = clamp(pOf(s, x))
    ll -= y > 0 ? Math.log(p) : Math.log(1 - p)
    n++
  })
  return { ll: n ? ll / n : 0, n }
}

/** Deterministic shuffle (mulberry32). */
export function shuffled<T>(a: T[], seed: number): T[] {
  let s = seed >>> 0
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const o = [...a]
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[o[i], o[j]] = [o[j], o[i]]
  }
  return o
}

/**
 * How much worse both sides' log loss gets with the columns `cols` shuffled
 * together across the rows (positive = the inputs help). Rows are shuffled as
 * a block, so a group keeps its internal relations and only loses its link to
 * the outcome. Averaged over `reps` shuffles.
 */
export function permutationLoss(m: Model, rows: TestRow[], cols: number[], seed: number, reps = 3): { delta: number; n: number } {
  const xs = rows.map((r) => r.x)
  const base = [sideLogLoss(m.long, xs, rows.map((r) => r.long)), sideLogLoss(m.short, xs, rows.map((r) => r.short))]
  const n = base[0].n + base[1].n
  if (!n) return { delta: 0, n: 0 }
  const baseLl = (base[0].ll * base[0].n + base[1].ll * base[1].n) / n
  let sum = 0
  for (let k = 0; k < reps; k++) {
    const order = shuffled(rows.map((_, j) => j), seed + k * 7919)
    const px = rows.map((r, j) => {
      const x = [...r.x]
      for (const c of cols) x[c] = rows[order[j]].x[c]
      return x
    })
    const a = sideLogLoss(m.long, px, rows.map((r) => r.long))
    const b = sideLogLoss(m.short, px, rows.map((r) => r.short))
    sum += (a.ll * a.n + b.ll * b.n) / n - baseLl
  }
  return { delta: sum / reps, n }
}

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0])
  const r = new Array<number>(v.length)
  for (let k = 0; k < idx.length; ) {
    let e = k
    while (e + 1 < idx.length && idx[e + 1][0] === idx[k][0]) e++
    for (let q = k; q <= e; q++) r[idx[q][1]] = (k + e) / 2
    k = e + 1
  }
  return r
}

export function pearson(a: number[], b: number[]): number | null {
  const n = a.length
  if (n < 3) return null
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb)
    saa += (a[i] - ma) ** 2
    sbb += (b[i] - mb) ** 2
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null
}

/** Spearman rank correlation of input `col` with a side's result over the rows with a known result. */
export function rankIc(rows: TestRow[], col: number, side: 'long' | 'short'): number | null {
  const ok = rows.filter((r) => r[side] != null)
  return pearson(ranks(ok.map((r) => r.x[col])), ranks(ok.map((r) => r[side] as number)))
}

/** Pairs of inputs whose correlation is at least `min` in size, strongest first. */
export function correlations(xs: number[][], min = 0.7): Array<{ a: string; b: string; r: number }> {
  const out: Array<{ a: string; b: string; r: number }> = []
  for (let i = 0; i < FEATURES.length; i++)
    for (let j = i + 1; j < FEATURES.length; j++) {
      const r = pearson(xs.map((x) => x[i]), xs.map((x) => x[j]))
      if (r != null && Math.abs(r) >= min) out.push({ a: FEATURES[i], b: FEATURES[j], r })
    }
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r))
}

/** Inputs studied together (they describe the same thing). */
export const INPUT_GROUPS: Record<string, string[]> = {
  momentum: ['ret1_atr', 'ret4_atr', 'ret12_atr', 'ret48_atr', 'rsi', 'macd_hist_atr'],
  'trend / mean distance': ['dist_ema20_atr', 'dist_ema50_atr', 'ema20_vs_50_atr', 'bb_pctb', 'range_pos_24'],
  volatility: ['atr_pct', 'atr_rank_200'],
  'volume / order flow': ['log_vol_ratio', 'taker_buy_share', 'taker_buy_share_4'],
  'time of day': ['hour_sin', 'hour_cos'],
}
