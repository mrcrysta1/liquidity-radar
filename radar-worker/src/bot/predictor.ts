// The shape every trading model plugs into: fit on labelled rows, then for a
// feature vector and a side, say how likely the trade is to make money and what
// it is worth in R. The offline evaluation harness (walkforward.ts,
// scripts/eval.ts) and champion/challenger comparisons take any Predictor, so a
// new model only has to implement this to be judged on the same numbers.
//
// Conventions (the same as the live bot):
//   - x is the feature vector from features.ts featureAt() — past bars only.
//   - r is the trade's result in R before costs; a "win" is r > 0
//     (target hit, or a green time exit — learning.ts winLabel()).
//   - expectedR is after the costs passed in (winCost if it wins, lossCost if
//     it loses), so it can be compared directly with an EV bar.
import { DEFAULT_WF, fitSide } from './walkforward.ts'
import type { SideModel, WfConfig } from './walkforward.ts'
import { applyScaler, predict as mlpPredict } from './mlp.ts'

export type Side = 1 | -1

/** One labelled training example. Rows arrive oldest first. */
export interface PredictorRow {
  x: number[]
  side: Side
  /** Result in R before costs. */
  r: number
  /** Open time of the decision bar, ms. */
  t: number
  /** When the outcome became known, ms (the label's last bar close). */
  knownAt: number
}

export interface PredictInput {
  x: number[]
  side: Side
  /** Cost in R if the trade ends at the target / at the stop. */
  winCost: number
  lossCost: number
}

export interface Prediction {
  /** Probability the trade makes money before costs. */
  pWin: number
  /** Expected result in R after the given costs. */
  expectedR: number
}

export interface FitContext {
  seed?: number
  features?: readonly string[]
}

export interface Predictor {
  readonly name: string
  /** Train on rows (oldest first). false = not enough data to fit. */
  fit(rows: PredictorRow[], ctx?: FitContext): boolean
  predict(features: PredictInput): Prediction
}

export type PredictorFactory = () => Predictor

const ev = (p: number, winR: number, lossR: number, f: PredictInput) => p * (winR - f.winCost) - (1 - p) * (lossR + f.lossCost)

/**
 * The current production model: one small MLP per side, EV from the mean win
 * and loss sizes seen in training — identical to walkforward.ts fitModel()/decide().
 */
export class MlpPredictor implements Predictor {
  readonly name = 'mlp'
  private cfg: WfConfig
  long: SideModel | null = null
  short: SideModel | null = null

  constructor(cfg: WfConfig = DEFAULT_WF) {
    this.cfg = cfg
  }

  fit(rows: PredictorRow[], ctx: FitContext = {}): boolean {
    const seed = ctx.seed ?? 1
    this.long = fitSide(rows.filter((r) => r.side > 0), this.cfg, seed)
    this.short = fitSide(rows.filter((r) => r.side < 0), this.cfg, seed + 1)
    return !!(this.long && this.short)
  }

  predict(f: PredictInput): Prediction {
    const m = f.side > 0 ? this.long : this.short
    if (!m) return { pWin: 0, expectedR: -Infinity }
    const p = mlpPredict(m.w, applyScaler(m.scaler, f.x))
    return { pWin: p, expectedR: ev(p, m.winR, m.lossR, f) }
  }
}

/**
 * The null model: each side's training win rate and payoff, whatever the
 * features say. A model that cannot beat this on Brier score has no skill.
 */
export class BaseRatePredictor implements Predictor {
  readonly name = 'base-rate'
  private s: Record<Side, { p: number; winR: number; lossR: number } | null> = { 1: null, [-1]: null }

  fit(rows: PredictorRow[]): boolean {
    for (const side of [1, -1] as const) {
      const r = rows.filter((x) => x.side === side).map((x) => x.r)
      if (!r.length) return false
      const wins = r.filter((v) => v > 0)
      const losses = r.filter((v) => v <= 0)
      this.s[side] = {
        p: wins.length / r.length,
        winR: wins.length ? wins.reduce((a, v) => a + v, 0) / wins.length : 0,
        lossR: losses.length ? -losses.reduce((a, v) => a + v, 0) / losses.length : 1,
      }
    }
    return true
  }

  predict(f: PredictInput): Prediction {
    const s = this.s[f.side]
    if (!s) return { pWin: 0, expectedR: -Infinity }
    return { pWin: s.p, expectedR: ev(s.p, s.winR, s.lossR, f) }
  }
}

/** Named models the CLI and comparisons can build. Other models register here. */
export const PREDICTORS: Record<string, (cfg?: WfConfig) => Predictor> = {
  mlp: (cfg) => new MlpPredictor(cfg),
  'base-rate': () => new BaseRatePredictor(),
}
