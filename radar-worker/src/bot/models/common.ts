// Shared pieces of every predictor: the training row, the payoff statistics
// expected value is built from, and the cost of a trade in R recovered from
// the features themselves (atr_pct), so predict(f) needs nothing else.
import type { Costs } from '../features.ts'

/** One labelled example: features at the decision bar, and the bracket trade's result in R before costs. */
export interface TrainRow {
  x: number[]
  r: number
}

export const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p))
export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)))
export const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))
export const label = (r: number): 0 | 1 => (r > 0 ? 1 : 0)

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export interface Payoff {
  /** Mean R of winning / losing outcomes (losses positive), before costs. */
  winR: number
  lossR: number
}

export function payoff(rows: TrainRow[]): Payoff {
  const w = rows.filter((x) => x.r > 0).map((x) => x.r)
  const l = rows.filter((x) => x.r <= 0).map((x) => -x.r)
  return { winR: w.length ? w.reduce((a, v) => a + v, 0) / w.length : 0, lossR: l.length ? l.reduce((a, v) => a + v, 0) / l.length : 1 }
}

export interface CostModel {
  costs: Costs
  /** Stop distance in ATRs. */
  slAtr: number
  /** Index of atr_pct (ATR / close × 100) in the feature vector. */
  atrPctIndex: number
}

/**
 * Expected R after costs, exactly as walkforward.decide computes it: a win pays
 * winR less the round trip with a maker take-profit; a loss costs lossR plus
 * the all-taker round trip. entry / slDist = 100 / (slAtr × atr_pct).
 */
export function expectedR(p: number, pay: Payoff, f: number[], cm: CostModel): number {
  const ratio = 100 / (cm.slAtr * f[cm.atrPctIndex])
  if (!isFinite(ratio) || ratio <= 0) return -Infinity
  const leg = (maker: boolean) => (maker ? cm.costs.maker : cm.costs.taker + cm.costs.slip)
  const winCost = (leg(false) + leg(cm.costs.tpMaker)) * ratio
  const lossCost = 2 * leg(false) * ratio
  return p * (pay.winR - winCost) - (1 - p) * (pay.lossR + lossCost)
}

/** Column means / sds from training rows only; applied with clipping at ±5 sd. */
export interface Scaler {
  mean: number[]
  std: number[]
}
export function fitScaler(X: number[][]): Scaler {
  const n = X.length
  const d = X[0]?.length || 0
  const mean = new Array(d).fill(0)
  const std = new Array(d).fill(0)
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n
  return { mean, std: std.map((v) => Math.sqrt(v) || 1) }
}
export function applyScaler(s: Scaler, x: number[]): number[] {
  return x.map((v, j) => Math.max(-5, Math.min(5, (v - s.mean[j]) / s.std[j])))
}

/** Solve A x = b for symmetric positive-definite A (Cholesky). A is d×d row-major. */
export function solveSpd(A: number[], b: number[], d: number): number[] {
  const L = new Array(d * d).fill(0)
  for (let i = 0; i < d; i++)
    for (let j = 0; j <= i; j++) {
      let s = A[i * d + j]
      for (let k = 0; k < j; k++) s -= L[i * d + k] * L[j * d + k]
      L[i * d + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * d + j]
    }
  const y = new Array(d).fill(0)
  for (let i = 0; i < d; i++) {
    let s = b[i]
    for (let k = 0; k < i; k++) s -= L[i * d + k] * y[k]
    y[i] = s / L[i * d + i]
  }
  const x = new Array(d).fill(0)
  for (let i = d - 1; i >= 0; i--) {
    let s = y[i]
    for (let k = i + 1; k < d; k++) s -= L[k * d + i] * x[k]
    x[i] = s / L[i * d + i]
  }
  return x
}

export function logLossOf(p: number[], y: number[]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) s -= y[i] ? Math.log(clampP(p[i])) : Math.log(1 - clampP(p[i]))
  return s / Math.max(1, p.length)
}
