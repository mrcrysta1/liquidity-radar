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
import { FEATURES, WARMUP, costR, featureAt, indicators, outcomeAt } from './features.ts'
import type { Bar, Bracket, Costs, Ind } from './features.ts'
import { applyScaler, fitScaler, predict, train } from './mlp.ts'
import type { MlpWeights, Scaler, TrainOpts } from './mlp.ts'
import { DEFAULT_SETUP, checkSetup } from './setup.ts'
import type { SetupConfig } from './setup.ts'
// Types only: predictor.ts imports this module at runtime.
import type { Predictor, PredictorFactory, PredictorRow, Side } from './predictor.ts'

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

/**
 * A labelled example from outside the bar history: a closed real or shadow
 * trade, with the features the model saw and its result in R before costs.
 */
export interface Sample {
  x: number[]
  side: 1 | -1
  r: number
}

/** Fit one side's model on samples in time order; null below 200 samples. */
export function fitSide(samples: Array<{ x: number[]; r: number }>, cfg: WfConfig, seed: number): SideModel | null {
  const r = samples
  if (r.length < 200) return null
  const scaler = fitScaler(r.map((x) => x.x))
  const X = r.map((x) => applyScaler(scaler, x.x))
  // Positive = the trade made money before costs (target first, or a green time exit).
  const y = r.map((x) => (x.r > 0 ? 1 : 0))
  const wins = r.map((x) => x.r).filter((v) => v > 0)
  const losses = r.map((x) => x.r).filter((v) => v <= 0)
  const winR = wins.length ? wins.reduce((a, v) => a + v, 0) / wins.length : 0
  const lossR = losses.length ? -losses.reduce((a, v) => a + v, 0) / losses.length : 1
  return { w: train(X, y, { ...cfg.mlp, seed }), scaler, winR, lossR }
}

/**
 * Fit both sides on bars [from, to). `extra` adds real/shadow trade outcomes
 * (most recent last, so early stopping validates on them).
 */
export function fitModel(b: Bar[], ind: Ind, from: number, to: number, cfg: WfConfig, seed = 1, extra: Sample[] = []): Model | null {
  const tr = rows(b, ind, cfg.bracket, from, to)
  const side = (k: 'long' | 'short', s: 1 | -1) => [
    ...tr.filter((x) => x[k]).map((x) => ({ x: x.x, r: x[k]!.r })),
    ...extra.filter((e) => e.side === s).map((e) => ({ x: e.x, r: e.r })),
  ]
  const long = fitSide(side('long', 1), cfg, seed)
  const short = fitSide(side('short', -1), cfg, seed + 1)
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

// ---- offline evaluation harness ---------------------------------------------
//
// An honest, reproducible out-of-sample test for any Predictor (predictor.ts),
// used by `npm run eval` (scripts/eval.ts) and reusable by the live
// champion/challenger step (compareModels).
//
//   - Labels mirror trader.ts: decide at bar i's close, market entry at bar
//     i+1's open (taker + slippage), stop STOP_MARKET slAtr × ATR away (taker +
//     slippage; a bar that opens through the stop fills at that open), target a
//     resting maker limit tpAtr × ATR away, time exit at market at the close of
//     bar i+horizon (the trader's barTime + (horizon+1) bars deadline). A bar
//     touching both stop and target counts as the stop. Funding paid or received
//     while the position is held is charged too.
//   - Only trades the live setup rules allow: R:R and cost after fees
//     (setup.ts), the cooldown after a stop, one position per symbol, EV above
//     the bar (strictly, as checkSetup does).
//   - Rolling-origin folds: each test block gets a fresh model fitted only on
//     rows whose label ended `embargoBars` bars before the block began (the
//     horizon purge plus an extra embargo).

export interface EvalConfig {
  wf: WfConfig
  /** Live setup rules mirrored offline (minRR, maxCostR, cooldownMs, minEvR). */
  setup: SetupConfig
  /** Bars between the last training label's end and the test block, beyond the horizon purge. */
  embargoBars: number
  /** Bar length, ms. */
  stepMs: number
}

export const DEFAULT_EVAL: EvalConfig = { wf: DEFAULT_WF, setup: DEFAULT_SETUP, embargoBars: 12, stepMs: 4 * 3_600_000 }

/** A funding settlement: rate paid by longs to shorts (negative = shorts pay). */
export interface FundingEvent {
  t: number
  rate: number
}

export interface TradeLabel {
  side: Side
  exit: 'tp' | 'sl' | 'time'
  /** Index of the bar the trade ended in. */
  end: number
  entry: number
  sl: number
  tp: number
  exitPx: number
  /** R before costs; > 0 is a win (learning.ts winLabel). */
  rGross: number
  /** Fees + slippage, R. */
  costR: number
  /** Funding paid (positive) or received (negative), R. */
  fundingR: number
  rNet: number
  /** When the position was closed (mid-bar for a stop or target), ms. */
  closedAt: number
  /** When the outcome is known for training: the close of the exit bar, ms. */
  knownAt: number
}

function fundingSum(f: FundingEvent[], from: number, to: number): number {
  // Events with from < t <= to; f is sorted by t.
  let lo = 0
  let hi = f.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (f[mid].t <= from) lo = mid + 1
    else hi = mid
  }
  let s = 0
  for (let j = lo; j < f.length && f[j].t <= to; j++) s += f[j].rate
  return s
}

/** The trade the live bot would make at bar i's close, as trader.ts executes it; null if its end is not known yet. */
export function tradeLabel(b: Bar[], ind: Ind, i: number, side: Side, k: Bracket, costs: Costs, stepMs: number, funding: FundingEvent[] = []): TradeLabel | null {
  if (i + k.horizon >= b.length) return null
  const dist = k.slAtr * ind.atr[i]
  if (!(dist > 0)) return null
  const entry = b[i + 1].o
  const sl = entry - side * dist
  const tp = entry + side * k.tpAtr * ind.atr[i]
  let exit: TradeLabel['exit'] = 'time'
  let end = i + k.horizon
  let exitPx = b[end].c
  for (let j = i + 1; j <= i + k.horizon; j++) {
    const x = b[j]
    const gapSl = side > 0 ? x.o <= sl : x.o >= sl
    const hitSl = side > 0 ? x.l <= sl : x.h >= sl
    const hitTp = side > 0 ? x.h >= tp : x.l <= tp
    if (gapSl || hitSl) {
      exit = 'sl'
      exitPx = gapSl ? x.o : sl
    } else if (hitTp) {
      exit = 'tp'
      exitPx = tp
    } else continue
    end = j
    break
  }
  const rGross = (side * (exitPx - entry)) / dist
  const cost = costR(b[i].c, dist, costs, exit)
  const closedAt = exit === 'time' ? b[end].t + stepMs : b[end].t + stepMs / 2
  // Held from just after bar i+1 opens until the exit; a time exit closes just after bar `end` does.
  const fundingR = funding.length ? (side * fundingSum(funding, b[i + 1].t, exit === 'time' ? b[end].t + stepMs : b[end].t) * entry) / dist : 0
  return { side, exit, end, entry, sl, tp, exitPx, rGross, costR: cost, fundingR, rNet: rGross - cost - fundingR, closedAt, knownAt: b[end].t + stepMs }
}

/** One decision point: features, costs, whether the setup rules allow a trade, and both sides' outcomes. */
export interface LabeledBar {
  i: number
  t: number
  x: number[]
  winCost: number
  lossCost: number
  /** R:R and cost after fees pass the setup rules (side-independent). */
  eligible: boolean
  /** Sign of the 12-bar return, for the momentum baseline. */
  mom: Side | 0
  long: TradeLabel
  short: TradeLabel
}

export interface SymbolData {
  symbol: string
  stepMs: number
  bars: Bar[]
  /** Rows in bar order; only bars with features and a known outcome. */
  rows: LabeledBar[]
}

export function labelBars(symbol: string, b: Bar[], cfg: EvalConfig, funding: FundingEvent[] = []): SymbolData {
  const ind = indicators(b)
  const k = cfg.wf.bracket
  const f = [...funding].sort((a, c) => a.t - c.t)
  const rows: LabeledBar[] = []
  for (let i = 0; i < b.length; i++) {
    const x = featureAt(b, ind, i)
    if (!x) continue
    const long = tradeLabel(b, ind, i, 1, k, cfg.wf.costs, cfg.stepMs, f)
    const short = tradeLabel(b, ind, i, -1, k, cfg.wf.costs, cfg.stepMs, f)
    if (!long || !short) continue
    const dist = k.slAtr * ind.atr[i]
    const chk = checkSetup(
      { entry: b[i].c, slDist: dist, tpDist: k.tpAtr * ind.atr[i], costs: cfg.wf.costs, evR: Infinity, evFloor: -Infinity, gated: false, gatePass: true, canEnter: true, openPositions: 0, tradesToday: 0, lastStopAt: null, now: 0 },
      cfg.setup,
    )
    const m = i >= 12 ? Math.sign(b[i].c - b[i - 12].c) : 0
    rows.push({ i, t: b[i].t, x, winCost: costR(b[i].c, dist, cfg.wf.costs, 'tp'), lossCost: costR(b[i].c, dist, cfg.wf.costs, 'sl'), eligible: !chk.hard.length, mom: m as Side | 0, long, short })
  }
  return { symbol, stepMs: cfg.stepMs, bars: b, rows }
}

/** Training rows for a predictor: both sides of each labelled bar, R before costs. */
export function trainingRows(rows: LabeledBar[]): PredictorRow[] {
  const out: PredictorRow[] = []
  for (const r of rows) for (const l of [r.long, r.short]) out.push({ x: r.x, side: l.side, r: l.rGross, t: r.t, knownAt: l.knownAt })
  return out
}

export interface Fold {
  k: number
  /** Training rows have bar index in [trainFrom, trainTo); test rows in [testFrom, testTo). */
  trainFrom: number
  trainTo: number
  testFrom: number
  testTo: number
}

/**
 * Rolling-origin folds over n bars. Training row i's label ends by bar
 * i + horizon <= testFrom - embargo - 1, so nothing the model learns from
 * overlaps (or comes within `embargo` bars of) the block it is tested on.
 */
export function makeFolds(n: number, horizon: number, trainBars: number, testBars: number, embargoBars: number): Fold[] {
  const folds: Fold[] = []
  const gap = horizon + embargoBars
  for (let start = WARMUP + trainBars + gap; start < n - horizon; start += testBars) {
    const trainTo = start - gap
    folds.push({ k: folds.length, trainFrom: Math.max(WARMUP, trainTo - trainBars), trainTo, testFrom: start, testTo: Math.min(n - horizon, start + testBars) })
  }
  return folds
}

export interface EvalTrade {
  symbol: string
  fold: number
  i: number
  t: number
  side: Side
  p: number
  ev: number
  exit: 'tp' | 'sl' | 'time'
  rGross: number
  costR: number
  fundingR: number
  rNet: number
  closedAt: number
}

/** A scored prediction: probability of a win and whether it was one. */
export interface CalPoint {
  p: number
  y: 0 | 1
}

/** A test row with one model's predictions for both sides. */
export interface Scored {
  row: LabeledBar
  fold: number
  pL: number
  pS: number
  evL: number
  evS: number
}

export type Pick = (s: Scored) => { side: Side; p: number; ev: number } | null

/**
 * Trade a symbol's scored test rows the way the live trader does: one position
 * at a time, a cooldown after a stop, only setups that pass the rules.
 * `free` counts the bars where a trade could have been opened.
 */
export function simulate(symbol: string, scored: Scored[], pick: Pick, cfg: EvalConfig): { trades: EvalTrade[]; free: number } {
  const trades: EvalTrade[] = []
  let freeAt = -1
  let lastStop = -Infinity
  let free = 0
  for (const s of scored) {
    const r = s.row
    if (r.i < freeAt || !r.eligible) continue
    if (r.t + cfg.stepMs - lastStop < cfg.setup.cooldownMs) continue
    free++
    const d = pick(s)
    if (!d) continue
    const l = d.side > 0 ? r.long : r.short
    trades.push({ symbol, fold: s.fold, i: r.i, t: r.t, side: d.side, p: d.p, ev: d.ev, exit: l.exit, rGross: l.rGross, costR: l.costR, fundingR: l.fundingR, rNet: l.rNet, closedAt: l.closedAt })
    // The trader can open again on the close of the bar the last trade ended in.
    freeAt = l.end
    if (l.exit === 'sl') lastStop = l.closedAt
  }
  return { trades, free }
}

/** The live entry rule: the side with the higher EV, if it clears the bar (strictly). */
export function modelPick(cfg: EvalConfig): Pick {
  const bar = Math.max(cfg.setup.minEvR, cfg.wf.minEvR)
  return (s) => {
    const side: Side = s.evL >= s.evS ? 1 : -1
    const ev = side > 0 ? s.evL : s.evS
    return ev > bar ? { side, p: side > 0 ? s.pL : s.pS, ev } : null
  }
}

function score(p: Predictor, row: LabeledBar, fold: number): Scored {
  const a = p.predict({ x: row.x, side: 1, winCost: row.winCost, lossCost: row.lossCost })
  const b = p.predict({ x: row.x, side: -1, winCost: row.winCost, lossCost: row.lossCost })
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d)
  return { row, fold, pL: fin(a.pWin, 0.5), pS: fin(b.pWin, 0.5), evL: fin(a.expectedR, -Infinity), evS: fin(b.expectedR, -Infinity) }
}

export interface FoldReport {
  symbol: string
  k: number
  fitted: boolean
  trainRows: number
  /** Open time of the first / last test bar, ms. */
  testFrom: number
  testTo: number
  /** The latest moment any training label was known, ms — must be before testFrom. */
  lastTrainKnownAt: number
  summary: Summary
  brier: number | null
}

export interface ModelEval {
  name: string
  trades: EvalTrade[]
  calib: CalPoint[]
  folds: FoldReport[]
  /** Per symbol: the scored test rows (baselines trade the same bars). */
  scored: Map<string, Scored[]>
  /** Bars where a trade could have been opened. */
  free: number
}

const calPoints = (s: Scored[]): CalPoint[] =>
  s.flatMap((x) => [
    { p: x.pL, y: (x.row.long.rGross > 0 ? 1 : 0) as 0 | 1 },
    { p: x.pS, y: (x.row.short.rGross > 0 ? 1 : 0) as 0 | 1 },
  ])

function runScored(name: string, data: SymbolData[], scoreSym: (d: SymbolData) => { scored: Scored[]; folds: FoldReport[] }, cfg: EvalConfig): ModelEval {
  const out: ModelEval = { name, trades: [], calib: [], folds: [], scored: new Map(), free: 0 }
  const pick = modelPick(cfg)
  for (const d of data) {
    const { scored, folds } = scoreSym(d)
    const sim = simulate(d.symbol, scored, pick, cfg)
    out.trades.push(...sim.trades)
    out.free += sim.free
    out.scored.set(d.symbol, scored)
    out.calib.push(...calPoints(scored))
    for (const f of folds) {
      const cp = calPoints(scored.filter((s) => s.fold === f.k))
      out.folds.push({ ...f, summary: summarize(sim.trades.filter((t) => t.fold === f.k)), brier: cp.length ? calibration(cp).brier : null })
    }
  }
  return out
}

/**
 * Purged walk-forward of a model: a fresh predictor per fold, fitted only on
 * rows whose outcome was known `embargoBars` bars before the test block began.
 */
export function walkForwardEval(name: string, factory: PredictorFactory, data: SymbolData[], cfg: EvalConfig): ModelEval {
  return runScored(
    name,
    data,
    (d) => {
      const folds = makeFolds(d.bars.length, cfg.wf.bracket.horizon, cfg.wf.trainBars, cfg.wf.testBars, cfg.embargoBars)
      const scored: Scored[] = []
      const reports: FoldReport[] = []
      for (const f of folds) {
        const tr = trainingRows(d.rows.filter((r) => r.i >= f.trainFrom && r.i < f.trainTo))
        const p = factory()
        const fitted = tr.length > 0 && p.fit(tr, { seed: (cfg.wf.mlp.seed ?? 0) + 100 + f.k, features: FEATURES })
        if (fitted) for (const r of d.rows) if (r.i >= f.testFrom && r.i < f.testTo) scored.push(score(p, r, f.k))
        reports.push({
          symbol: d.symbol,
          k: f.k,
          fitted,
          trainRows: tr.length,
          testFrom: d.bars[f.testFrom]?.t ?? 0,
          testTo: d.bars[f.testTo - 1]?.t ?? 0,
          lastTrainKnownAt: tr.reduce((a, r) => Math.max(a, r.knownAt), 0),
          summary: summarize([]),
          brier: null,
        })
      }
      return { scored, folds: reports }
    },
    cfg,
  )
}

/** Score one already-fitted predictor on every row of the data (e.g. a live held-out slice) — no fitting. */
export function evaluateFitted(name: string, p: Predictor, data: SymbolData[], cfg: EvalConfig): ModelEval {
  return runScored(name, data, (d) => ({ scored: d.rows.map((r) => score(p, r, 0)), folds: [] }), cfg)
}

// ---- evaluation metrics -----------------------------------------------------

export interface Summary {
  trades: number
  longTrades: number
  shortTrades: number
  /** Share of trades with R > 0 before costs. */
  hitRate: number
  avgRGross: number
  /** Mean R after fees, slippage and funding — the number that matters. */
  expectancyR: number
  avgCostR: number
  avgFundingR: number
  totalR: number
  profitFactor: number
  maxDrawdownR: number
  /** Mean / sd of per-trade net R (not annualised). */
  sharpeTrade: number
  /** Annualised Sharpe of daily net R (UTC days from first to last close; idle days count as 0). */
  sharpeDaily: number
}

const avg = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0)
const stdev = (v: number[]) => {
  if (v.length < 2) return 0
  const m = avg(v)
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1))
}

export function summarize(trades: EvalTrade[]): Summary {
  const t = [...trades].sort((a, b) => a.closedAt - b.closedAt)
  const r = t.map((x) => x.rNet)
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
  let sharpeDaily = 0
  if (t.length > 1) {
    const day = (ms: number) => Math.floor(ms / 86_400_000)
    const d0 = day(t[0].closedAt)
    const days = new Array(day(t[t.length - 1].closedAt) - d0 + 1).fill(0)
    for (const x of t) days[day(x.closedAt) - d0] += x.rNet
    const s = stdev(days)
    sharpeDaily = s ? (avg(days) / s) * Math.sqrt(365) : 0
  }
  const s = stdev(r)
  return {
    trades: t.length,
    longTrades: t.filter((x) => x.side > 0).length,
    shortTrades: t.filter((x) => x.side < 0).length,
    hitRate: t.length ? t.filter((x) => x.rGross > 0).length / t.length : 0,
    avgRGross: avg(t.map((x) => x.rGross)),
    expectancyR: avg(r),
    avgCostR: avg(t.map((x) => x.costR)),
    avgFundingR: avg(t.map((x) => x.fundingR)),
    totalR: r.reduce((a, v) => a + v, 0),
    profitFactor: pains ? gains / pains : gains ? Infinity : 0,
    maxDrawdownR: dd,
    sharpeTrade: s ? avg(r) / s : 0,
    sharpeDaily,
  }
}

export interface Calibration {
  n: number
  brier: number
  logLoss: number
  /** Share of wins among these points. */
  baseRate: number
  /** Brier of always predicting that base rate (an in-sample, so generous, reference). */
  brierRef: number
  /** 1 − brier / brierRef: above 0 only if the model knows more than the base rate. */
  skill: number
  bins: Array<{ lo: number; hi: number; n: number; meanP: number; winRate: number }>
}

export function calibration(points: CalPoint[], nBins = 10): Calibration {
  const n = points.length
  const clamp = (p: number) => Math.min(1 - 1e-7, Math.max(1e-7, p))
  let brier = 0
  let ll = 0
  let wins = 0
  const bins = Array.from({ length: nBins }, (_, j) => ({ lo: j / nBins, hi: (j + 1) / nBins, n: 0, sp: 0, sy: 0 }))
  for (const { p, y } of points) {
    brier += (p - y) ** 2
    ll -= y ? Math.log(clamp(p)) : Math.log(1 - clamp(p))
    wins += y
    const b = bins[Math.min(nBins - 1, Math.max(0, Math.floor(p * nBins)))]
    b.n++
    b.sp += p
    b.sy += y
  }
  const base = n ? wins / n : 0
  const ref = base * (1 - base)
  const br = n ? brier / n : 0
  return {
    n,
    brier: br,
    logLoss: n ? ll / n : 0,
    baseRate: base,
    brierRef: ref,
    skill: ref ? 1 - br / ref : 0,
    bins: bins.filter((b) => b.n).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.sp / b.n, winRate: b.sy / b.n })),
  }
}

/** xorshift32, deterministic. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const quantile = (v: number[], q: number) => {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

export interface Baselines {
  noTrade: Summary
  /** Random side on free bars, entering as often as the model did; `runs` seeds. */
  random: { runs: number; entryProb: number; meanTrades: number; meanExpectancyR: number; p05: number; p95: number; meanTotalR: number; shareBeatingModel: number }
  /** Always the direction of the last 12 bars' move, on every free bar the rules allow. */
  momentum: Summary
}

/** Baselines on exactly the bars the model was tested on, under the same rules and costs. */
export function baselines(model: ModelEval, cfg: EvalConfig, runs = 50, seed = 7): Baselines {
  const q = model.free ? model.trades.length / model.free : 0
  const modelExp = summarize(model.trades).expectancyR
  const exps: number[] = []
  const tots: number[] = []
  const counts: number[] = []
  for (let k = 0; k < runs; k++) {
    const r = rng(seed + k * 7919)
    const all: EvalTrade[] = []
    for (const [sym, scored] of model.scored) all.push(...simulate(sym, scored, () => (r() < q ? { side: r() < 0.5 ? 1 : -1, p: 0.5, ev: 0 } : null), cfg).trades)
    const s = summarize(all)
    exps.push(s.expectancyR)
    tots.push(s.totalR)
    counts.push(s.trades)
  }
  const mom: EvalTrade[] = []
  for (const [sym, scored] of model.scored) mom.push(...simulate(sym, scored, (s) => (s.row.mom ? { side: s.row.mom, p: 0.5, ev: 0 } : null), cfg).trades)
  return {
    noTrade: summarize([]),
    random: {
      runs,
      entryProb: q,
      meanTrades: avg(counts),
      meanExpectancyR: avg(exps),
      p05: quantile(exps, 0.05),
      p95: quantile(exps, 0.95),
      meanTotalR: avg(tots),
      shareBeatingModel: exps.filter((e) => e >= modelExp).length / Math.max(1, runs),
    },
    momentum: summarize(mom),
  }
}

// ---- champion vs challenger --------------------------------------------------

export interface BootstrapDiff {
  /** Challenger minus champion, R per trade after costs. */
  expectancyDiff: number
  ci: [number, number]
  /** Share of resamples where the challenger's expectancy is higher. */
  pBetter: number
  /** Challenger minus champion, total R. */
  totalRDiff: number
  totalRci: [number, number]
  nBoot: number
  blockMs: number
  blocks: number
}

/**
 * Block bootstrap of the difference in expectancy after costs. Blocks are
 * whole UTC days (by decision time) holding both models' trades, so the
 * comparison stays paired in time and keeps intraday dependence.
 */
export function bootstrapDiff(champ: EvalTrade[], chall: EvalTrade[], o: { nBoot?: number; blockMs?: number; seed?: number; alpha?: number } = {}): BootstrapDiff {
  const nBoot = o.nBoot ?? 2000
  const blockMs = o.blockMs ?? 86_400_000
  const alpha = o.alpha ?? 0.05
  const blocks = new Map<number, { aS: number; aN: number; bS: number; bN: number }>()
  const add = (t: EvalTrade, a: boolean) => {
    const id = Math.floor(t.t / blockMs)
    const x = blocks.get(id) ?? { aS: 0, aN: 0, bS: 0, bN: 0 }
    if (a) {
      x.aS += t.rNet
      x.aN++
    } else {
      x.bS += t.rNet
      x.bN++
    }
    blocks.set(id, x)
  }
  champ.forEach((t) => add(t, true))
  chall.forEach((t) => add(t, false))
  const B = [...blocks.values()]
  const exp = (s: number, n: number) => (n ? s / n : 0)
  const sum = (f: (x: (typeof B)[number]) => number) => B.reduce((a, x) => a + f(x), 0)
  const r = rng(o.seed ?? 1)
  const diffs: number[] = []
  const tdiffs: number[] = []
  for (let k = 0; k < nBoot && B.length; k++) {
    let aS = 0
    let aN = 0
    let bS = 0
    let bN = 0
    for (let j = 0; j < B.length; j++) {
      const x = B[Math.floor(r() * B.length)]
      aS += x.aS
      aN += x.aN
      bS += x.bS
      bN += x.bN
    }
    diffs.push(exp(bS, bN) - exp(aS, aN))
    tdiffs.push(bS - aS)
  }
  return {
    expectancyDiff: exp(sum((x) => x.bS), chall.length) - exp(sum((x) => x.aS), champ.length),
    ci: [quantile(diffs, alpha / 2), quantile(diffs, 1 - alpha / 2)],
    pBetter: diffs.length ? diffs.filter((d) => d > 0).length / diffs.length : 0,
    totalRDiff: sum((x) => x.bS) - sum((x) => x.aS),
    totalRci: [quantile(tdiffs, alpha / 2), quantile(tdiffs, 1 - alpha / 2)],
    nBoot,
    blockMs,
    blocks: B.length,
  }
}

export interface CompareResult {
  champion: { name: string; summary: Summary; calibration: Calibration }
  challenger: { name: string; summary: Summary; calibration: Calibration }
  diff: BootstrapDiff
  /** The challenger is better beyond reasonable doubt: the whole interval is above 0. */
  promote: boolean
  reason: string
  evals: { champion: ModelEval; challenger: ModelEval }
}

export interface CompareOpts {
  nBoot?: number
  blockMs?: number
  seed?: number
  alpha?: number
  /** Fewest challenger trades a promotion needs (default 30). */
  minTrades?: number
}

export type Contender = { name: string; predictor: Predictor } | { name: string; factory: PredictorFactory }

/**
 * Champion vs challenger on the same data and rules. A fitted `predictor` is
 * scored as it is on every row (e.g. the live held-out slice); a `factory` is
 * walk-forwarded (a fresh fit per fold). Promote only when the bootstrap
 * interval of the challenger's expectancy advantage lies entirely above 0.
 */
export function compareModels(champion: Contender, challenger: Contender, data: SymbolData[], cfg: EvalConfig, o: CompareOpts = {}): CompareResult {
  const run = (c: Contender) => ('factory' in c ? walkForwardEval(c.name, c.factory, data, cfg) : evaluateFitted(c.name, c.predictor, data, cfg))
  const a = run(champion)
  const b = run(challenger)
  const diff = bootstrapDiff(a.trades, b.trades, o)
  const minTrades = o.minTrades ?? 30
  const sb = summarize(b.trades)
  const ci = `${((1 - (o.alpha ?? 0.05)) * 100).toFixed(0)}% CI [${diff.ci[0].toFixed(3)}, ${diff.ci[1].toFixed(3)}]`
  const d = `${diff.expectancyDiff >= 0 ? '+' : ''}${diff.expectancyDiff.toFixed(3)}R/trade`
  let promote = false
  let reason: string
  if (sb.trades < minTrades) reason = `challenger made only ${sb.trades} trades (need ${minTrades})`
  else if (diff.ci[0] > 0) {
    promote = true
    reason = `expectancy ${d}, ${ci}`
  } else reason = `expectancy ${d}, ${ci} does not exclude 0`
  return {
    champion: { name: a.name, summary: summarize(a.trades), calibration: calibration(a.calib) },
    challenger: { name: b.name, summary: sb, calibration: calibration(b.calib) },
    diff,
    promote,
    reason,
    evals: { champion: a, challenger: b },
  }
}
