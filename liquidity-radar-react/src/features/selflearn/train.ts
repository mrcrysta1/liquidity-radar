// The heavy part of training a model pair, as a pure function of the candles.
//
// It is the slowest thing the self-learning engine does — features, labels, a
// walk-forward check on the last 30% and two logistic fits over a few thousand
// bars — so it runs in a Web Worker (train.worker.ts) and never blocks the page.
// Being pure (no DOM, no storage, no shared state) is what makes that possible:
// the worker and the main-thread fallback run exactly the same code.
import type { CandleFlat } from '../../services/market'
import { series } from './features.ts'
import { STRATS, dataset, simulate, stats, trainPair } from './strategy.ts'
import type { Pair, StratId } from './strategy'

export interface TrainResult {
  rows: number
  pair: Pair
  holdout: { n: number; winRate: number; avgR: number; pf: number }
}

export function trainCore(cs: CandleFlat[], strat: StratId): TrainResult {
  const st = STRATS[strat]
  const S = series(cs)
  const rows = dataset(cs, S, st)
  // Validate on the last 30% with a model that never saw it, learning as it goes.
  const cut = Math.floor(cs.length * 0.7)
  const early = rows.filter((r) => Math.max(r.long.exitIdx, r.short.exitIdx) < cut)
  const test = simulate(cs, S, rows, cut, trainPair(early), st, { minEV: st.minEV, online: true })
  const hs = stats(test)
  return {
    rows: rows.length,
    pair: trainPair(rows),
    holdout: { n: hs.n, winRate: hs.winRate, avgR: hs.avgR, pf: isFinite(hs.profitFactor) ? hs.profitFactor : 99 },
  }
}
