// Walk-forward training and evaluation — the gate a model must pass before it
// is allowed to trade.
//
// The history is cut into consecutive test blocks. For each block, a fresh
// model is trained only on bars before it, with a purge gap of `horizon` bars
// so no training label overlaps the test period, then traded on the block
// exactly as the live bot would: one position at a time, the side with the
// best expected value, only when that value clears the bar after costs. The
// scores are the concatenation of every block, so every trade in them was made
// on data its model had never seen.
import { FEATURES, costR, featureAt, indicators, outcomeAt } from './features.ts'
import type { Bar, Bracket, Costs, Ind } from './features.ts'
import { applyScaler, fitScaler, predict, train } from './mlp.ts'
import type { MlpWeights, Scaler, TrainOpts } from './mlp.ts'

export interface WfConfig {
  bracket: Bracket
  /** Binance USDⓈ-M futures: taker 0.05%, maker 0.02%; slippage assumed on market legs. */
  costs: Costs
  /** Minimum expected value, in R after costs, to take a trade. */
  minEvR: number
  trainBars: number
  testBars: number
  mlp: TrainOpts
}

export const DEFAULT_WF: WfConfig = {
  // 4h bars: fees are a far smaller share of a 4h ATR than of a 1h or 15m one.
  bracket: { slAtr: 1.5, tpAtr: 3, horizon: 12 },
  costs: { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true },
  minEvR: 0.08,
  trainBars: 2000,
  testBars: 250,
  mlp: { hidden: 6, epochs: 60, lr: 0.01, l2: 2e-3, batch: 64, validFrac: 0.2, patience: 8 },
}

/** One side's model: the net, its scaler, and the payoff stats EV is built from. */
export interface SideModel {
  w: MlpWeights
  scaler: Scaler
  /** Mean R of winning / losing training outcomes (losses as a positive number), before costs. */
  winR: number
  lossR: number
}

export interface Model {
  long: SideModel
  short: SideModel
  features: readonly string[]
  cfg: WfConfig
  trainedFrom: number
  trainedTo: number
}

export interface Decision {
  side: 1 | -1 | 0
  pLong: number
  pShort: number
  evLong: number
  evShort: number
  /** Cost in R if the trade ends at the stop — the worst case. */
  costR: number
}

export interface WfTrade {
  i: number
  t: number
  side: 1 | -1
  p: number
  ev: number
  r: number // net of costs
  exit: 'tp' | 'sl' | 'time'
}

export interface Metrics {
  trades: number
  winRate: number
  expectancyR: number
  profitFactor: number
  totalR: number
  maxDrawdownR: number
  /** Mean / sd of per-trade R — a per-trade Sharpe, not annualised. */
  sharpe: number
  longTrades: number
  shortTrades: number
  folds: number
  positiveFolds: number
  lastFoldsR: number
}

interface Row {
  i: number
  x: number[]
  long: ReturnType<typeof outcomeAt>
  short: ReturnType<typeof outcomeAt>
}

function rows(b: Bar[], ind: Ind, k: Bracket, from: number, to: number): Row[] {
  const out: Row[] = []
  for (let i = from; i < to; i++) {
    const x = featureAt(b, ind, i)
    if (!x) continue
    out.push({ i, x, long: outcomeAt(b, ind, i, 1, k), short: outcomeAt(b, ind, i, -1, k) })
  }
  return out
}

function fitSide(train_: Row[], side: 'long' | 'short', cfg: WfConfig, seed: number): SideModel | null {
  const r = train_.filter((x) => x[side])
  if (r.length < 200) return null
  const scaler = fitScaler(r.map((x) => x.x))
  const X = r.map((x) => applyScaler(scaler, x.x))
  // Positive = the trade made money before costs (target first, or a green time exit).
  const y = r.map((x) => (x[side]!.r > 0 ? 1 : 0))
  const wins = r.map((x) => x[side]!.r).filter((v) => v > 0)
  const losses = r.map((x) => x[side]!.r).filter((v) => v <= 0)
  const winR = wins.length ? wins.reduce((a, v) => a + v, 0) / wins.length : 0
  const lossR = losses.length ? -losses.reduce((a, v) => a + v, 0) / losses.length : 1
  return { w: train(X, y, { ...cfg.mlp, seed }), scaler, winR, lossR }
}

export function fitModel(b: Bar[], ind: Ind, from: number, to: number, cfg: WfConfig, seed = 1): Model | null {
  const tr = rows(b, ind, cfg.bracket, from, to)
  const long = fitSide(tr, 'long', cfg, seed)
  const short = fitSide(tr, 'short', cfg, seed + 1)
  if (!long || !short) return null
  return { long, short, features: FEATURES, cfg, trainedFrom: b[from]?.t ?? 0, trainedTo: b[Math.min(b.length - 1, to)]?.t ?? 0 }
}

/** What the model would do at the close of bar i. */
export function decide(m: Model, b: Bar[], ind: Ind, i: number): Decision | null {
  const x = featureAt(b, ind, i)
  if (!x) return null
  const k = m.cfg.bracket
  const dist = k.slAtr * ind.atr[i]
  const winCost = costR(b[i].c, dist, m.cfg.costs, 'tp')
  const lossCost = costR(b[i].c, dist, m.cfg.costs, 'sl')
  // Expected value after the cost of whichever way the trade is likely to end.
  const ev = (s: SideModel, p: number) => p * (s.winR - winCost) - (1 - p) * (s.lossR + lossCost)
  const pLong = predict(m.long.w, applyScaler(m.long.scaler, x))
  const pShort = predict(m.short.w, applyScaler(m.short.scaler, x))
  const evLong = ev(m.long, pLong)
  const evShort = ev(m.short, pShort)
  const best = evLong >= evShort ? 1 : -1
  const bestEv = Math.max(evLong, evShort)
  return { side: bestEv >= m.cfg.minEvR ? best : 0, pLong, pShort, evLong, evShort, costR: lossCost }
}

export function metrics(trades: WfTrade[], foldR: number[]): Metrics {
  const r = trades.map((t) => t.r)
  const n = r.length
  const sum = r.reduce((a, v) => a + v, 0)
  const gains = r.filter((v) => v > 0).reduce((a, v) => a + v, 0)
  const pains = -r.filter((v) => v < 0).reduce((a, v) => a + v, 0)
  let eq = 0
  let peak = 0
  let dd = 0
  for (const v of r) {
    eq += v
    peak = Math.max(peak, eq)
    dd = Math.max(dd, peak - eq)
  }
  const mean = n ? sum / n : 0
  const sd = n > 1 ? Math.sqrt(r.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  return {
    trades: n,
    winRate: n ? r.filter((v) => v > 0).length / n : 0,
    expectancyR: mean,
    profitFactor: pains ? gains / pains : gains ? Infinity : 0,
    totalR: sum,
    maxDrawdownR: dd,
    sharpe: sd ? mean / sd : 0,
    longTrades: trades.filter((t) => t.side > 0).length,
    shortTrades: trades.filter((t) => t.side < 0).length,
    folds: foldR.length,
    positiveFolds: foldR.filter((v) => v > 0).length,
    lastFoldsR: foldR.slice(-3).reduce((a, v) => a + v, 0),
  }
}

export interface WfResult {
  metrics: Metrics
  trades: WfTrade[]
  foldR: number[]
}

export function walkForward(b: Bar[], cfg: WfConfig = DEFAULT_WF): WfResult {
  const ind = indicators(b)
  const H = cfg.bracket.horizon
  const trades: WfTrade[] = []
  const foldR: number[] = []
  let fold = 0
  for (let start = cfg.trainBars; start + H < b.length; start += cfg.testBars) {
    // Purge: the last training label must end before the test block starts.
    const m = fitModel(b, ind, Math.max(0, start - cfg.trainBars), start - H, cfg, (cfg.mlp.seed ?? 0) + 100 + fold++)
    if (!m) continue
    const end = Math.min(b.length - H - 1, start + cfg.testBars)
    let freeAt = start
    let fr = 0
    for (let i = start; i < end; i++) {
      if (i < freeAt) continue
      const d = decide(m, b, ind, i)
      if (!d || !d.side) continue
      const o = outcomeAt(b, ind, i, d.side, cfg.bracket)
      if (!o) continue
      const r = o.r - costR(b[i].c, cfg.bracket.slAtr * ind.atr[i], cfg.costs, o.exit)
      trades.push({ i, t: b[i].t, side: d.side, p: d.side > 0 ? d.pLong : d.pShort, ev: Math.max(d.evLong, d.evShort), r, exit: o.exit })
      fr += r
      freeAt = o.end + 1
    }
    foldR.push(fr)
  }
  return { metrics: metrics(trades, foldR), trades, foldR }
}

export interface Gate {
  minTrades: number
  minExpectancyR: number
  minProfitFactor: number
}

export const DEFAULT_GATE: Gate = { minTrades: 60, minExpectancyR: 0.05, minProfitFactor: 1.15 }

/** Whether walk-forward results earn the model the right to trade — and why not. */
export function gate(m: Metrics, g: Gate = DEFAULT_GATE): { pass: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (m.trades < g.minTrades) reasons.push(`only ${m.trades} out-of-sample trades (need ${g.minTrades})`)
  if (m.expectancyR < g.minExpectancyR)
    reasons.push(`expectancy ${m.expectancyR.toFixed(3)}R after costs (need ${g.minExpectancyR}R)`)
  if (m.profitFactor < g.minProfitFactor)
    reasons.push(`profit factor ${m.profitFactor.toFixed(2)} (need ${g.minProfitFactor})`)
  if (m.lastFoldsR <= 0) reasons.push(`losing over the most recent 3 test blocks (${m.lastFoldsR.toFixed(1)}R)`)
  return { pass: !reasons.length, reasons }
}
