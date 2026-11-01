// Learning from every trade. Pure functions (tested in test/bot-learning-loop.test.ts);
// the trader feeds them from the database and stores what they return.
//
//   regimeOf          — which market regime a decision was made in.
//   calibrate /       — an online win-probability correction per symbol, side
//   updateCalibration   and regime: p' = σ(a + b·logit(p)), one gradient step
//                       per closed trade, pulled toward the identity (a=0, b=1)
//                       by a Gaussian prior. Stored in bot_calibration, so it
//                       survives restarts and retrains.
//   resolveShadow     — did a virtual (shadow) trade hit its target or its stop
//                       first? Same rules as the training labels.
//   splitForChallenger / scoreModel / selectChampion
//                     — retrain on bars plus stored trade outcomes, hold out the
//                       most recent slice, and let the challenger replace the
//                       champion only if it is better there on log loss AND on
//                       expectancy.
//   perfMetrics / ece / equityDrawdown — the figures the web app shows.
import { FEATURES, WARMUP, costR, featureAt, outcomeAt } from './features.ts'
import type { Bar, Costs, Ind } from './features.ts'
import { applyScaler, predict } from './mlp.ts'
import { excursion } from './journal.ts'
import type { Model, Sample, WfConfig } from './walkforward.ts'

// ---- regimes ----------------------------------------------------------------

/** Trend (EMA20 vs EMA50) × volatility tercile (ATR rank over 200 bars), e.g. "up-hi". */
export function regimeOf(f: Record<string, number> | number[]): string {
  const get = (name: string) => (Array.isArray(f) ? f[FEATURES.indexOf(name as (typeof FEATURES)[number])] : f[name])
  const trend = Number(get('ema20_vs_50_atr')) >= 0 ? 'up' : 'down'
  const rank = Number(get('atr_rank_200'))
  const vol = !isFinite(rank) ? 'mid' : rank < 1 / 3 ? 'lo' : rank > 2 / 3 ? 'hi' : 'mid'
  return trend + '-' + vol
}

/** Feature record (as stored with a trade) → the model's input vector; null if incomplete. */
export function featureVector(f: unknown): number[] | null {
  const o = (typeof f === 'string' ? JSON.parse(f) : f) as Record<string, unknown> | null
  if (!o) return null
  const x = FEATURES.map((k) => Number(o[k]))
  return x.every((v) => isFinite(v)) ? x : null
}

// ---- online calibration -----------------------------------------------------

export interface Calib {
  a: number
  b: number
  /** Trades learned from. */
  n: number
  wins: number
}

export const CAL_PRIOR: Calib = { a: 0, b: 1, n: 0, wins: 0 }

export interface CalOpts {
  lr: number
  /** Strength of the pull back toward the identity (the prior). */
  prior: number
}
export const DEFAULT_CAL: CalOpts = { lr: 0.1, prior: 0.01 }

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p))
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)))
const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export function calibrate(p: number, c: Calib | null | undefined): number {
  if (!c || !isFinite(p)) return p
  return sigmoid(c.a + c.b * logit(p))
}

/** One Bayesian-regularised logistic step on (raw probability, outcome 0/1). */
export function updateCalibration(c: Calib, pRaw: number, y: 0 | 1, o: CalOpts = DEFAULT_CAL): Calib {
  if (!isFinite(pRaw)) return c
  const z = logit(pRaw)
  const g = sigmoid(c.a + c.b * z) - y
  // Big steps while it knows little, smaller as evidence piles up.
  const lr = o.lr / Math.sqrt(1 + c.n / 50)
  const a = c.a - lr * (g + o.prior * c.a)
  const b = c.b - lr * (g * z + o.prior * (c.b - 1))
  return { a: Math.max(-4, Math.min(4, a)), b: Math.max(0.05, Math.min(4, b)), n: c.n + 1, wins: c.wins + y }
}

/** The label the model and the calibration learn: did the trade make money before costs? */
export function winLabel(exit: string, rGross: number): 0 | 1 {
  if (exit === 'tp') return 1
  if (exit === 'sl') return 0
  return rGross > 0 ? 1 : 0
}

// ---- shadow trades ----------------------------------------------------------

export interface ShadowSpec {
  side: 1 | -1
  entry: number
  sl: number
  tp: number
  /** Open time of the bar the decision was made on (its close = the virtual entry). */
  barTime: number
  horizon: number
}

export type ShadowResult =
  | {
      status: 'closed'
      exit: 'tp' | 'sl' | 'time'
      exitPrice: number
      rGross: number
      rNet: number
      closedAt: number
      /** Journal: worst / best unrealised R over the bars it was open in, and how many. */
      maeR: number
      mfeR: number
      bars: number
    }
  | { status: 'expired'; reason: string }

/**
 * Resolve a shadow trade on closed bars (oldest first): whichever of target and
 * stop is touched first decides; a bar touching both counts as the stop; the
 * time exit is the close `horizon` bars on. null = not decided yet.
 */
export function resolveShadow(s: ShadowSpec, bars: Bar[], stepMs: number, costs: Costs): ShadowResult | null {
  const after = bars.filter((x) => x.t > s.barTime).sort((a, b) => a.t - b.t)
  if (!after.length) return null
  if (after[0].t > s.barTime + stepMs) return { status: 'expired', reason: 'bars after the decision are missing' }
  const dist = Math.abs(s.entry - s.sl)
  if (!(dist > 0)) return { status: 'expired', reason: 'bad stop distance' }
  const done = (exit: 'tp' | 'sl' | 'time', price: number, j: number): ShadowResult => {
    const rGross = (s.side * (price - s.entry)) / dist
    const held = after.slice(0, j + 1)
    // The stop bar's other wick is left out: which came first inside it is unknown (as for the label).
    const ex = excursion(s, exit === 'sl' ? held.slice(0, -1) : held, [price]) ?? { maeR: 0, mfeR: 0 }
    return { status: 'closed', exit, exitPrice: price, rGross, rNet: rGross - costR(s.entry, dist, costs, exit), closedAt: after[j].t + stepMs, ...ex, bars: j + 1 }
  }
  for (let j = 0; j < Math.min(s.horizon, after.length); j++) {
    const x = after[j]
    const hitSl = s.side > 0 ? x.l <= s.sl : x.h >= s.sl
    const hitTp = s.side > 0 ? x.h >= s.tp : x.l <= s.tp
    if (hitSl) return done('sl', s.sl, j)
    if (hitTp) return done('tp', s.tp, j)
  }
  if (after.length >= s.horizon) return done('time', after[s.horizon - 1].c, s.horizon - 1)
  return null
}

// ---- champion / challenger --------------------------------------------------

/** A stored closed trade (real or shadow), as training / evaluation data. */
export interface Experience {
  x: number[]
  side: 1 | -1
  rGross: number
  rNet: number
  barTime: number
  closedAt: number
  entry: number
  slDist: number
}

/** One held-out example: features, when its outcome became known, and the outcome(s). */
export interface EvalRow {
  x: number[]
  knownAt: number
  winCost: number
  lossCost: number
  outcomes: Array<{ side: 1 | -1; rGross: number; rNet: number }>
}

export interface ChallengerData {
  /** Bars [trainFrom, trainTo) to fit on. */
  trainFrom: number
  trainTo: number
  extra: Sample[]
  holdout: EvalRow[]
}

/**
 * Split for a challenger: the most recent `holdoutBars` labelled bars, and the
 * stored trades decided in that window, are held out. The challenger trains on
 * bars before it (with a purge gap of one horizon) plus the stored trades that
 * had closed before the window began.
 */
export function splitForChallenger(b: Bar[], ind: Ind, exp: Experience[], cfg: WfConfig, holdoutBars: number, stepMs: number): ChallengerData {
  const H = cfg.bracket.horizon
  const end = b.length - H // rows i < end have a known outcome
  const hStart = Math.max(WARMUP, end - Math.max(1, holdoutBars))
  const trainTo = Math.max(0, hStart - H)
  const trainFrom = Math.max(0, trainTo - cfg.trainBars)
  const t0 = b[hStart]?.t ?? Infinity
  const holdout: EvalRow[] = []
  for (let i = hStart; i < end; i++) {
    const x = featureAt(b, ind, i)
    if (!x) continue
    const dist = cfg.bracket.slAtr * ind.atr[i]
    if (!(dist > 0)) continue
    const outcomes: EvalRow['outcomes'] = []
    for (const side of [1, -1] as const) {
      const o = outcomeAt(b, ind, i, side, cfg.bracket)
      if (o) outcomes.push({ side, rGross: o.r, rNet: o.r - costR(b[i].c, dist, cfg.costs, o.exit) })
    }
    holdout.push({ x, knownAt: b[i].t + (H + 1) * stepMs, winCost: costR(b[i].c, dist, cfg.costs, 'tp'), lossCost: costR(b[i].c, dist, cfg.costs, 'sl'), outcomes })
  }
  const extra: Sample[] = []
  for (const e of [...exp].sort((a, b) => a.closedAt - b.closedAt)) {
    if (e.barTime >= t0)
      holdout.push({
        x: e.x,
        knownAt: e.closedAt,
        winCost: costR(e.entry, e.slDist, cfg.costs, 'tp'),
        lossCost: costR(e.entry, e.slDist, cfg.costs, 'sl'),
        outcomes: [{ side: e.side, rGross: e.rGross, rNet: e.rNet }],
      })
    else if (e.closedAt <= t0) extra.push({ x: e.x, side: e.side, r: e.rGross })
    // Decided before the window but closed inside it: purged from both.
  }
  return { trainFrom, trainTo, extra, holdout }
}

export interface Score {
  /** Labelled outcomes scored. */
  n: number
  logLoss: number
  /** Trades the model would have taken (best side, EV > minEvR) and their mean net R. */
  trades: number
  expectancyR: number
  winRate: number
}

export function scoreModel(m: Model, rows: EvalRow[], minEvR = 0): Score {
  let n = 0
  let ll = 0
  const taken: number[] = []
  for (const row of rows) {
    const pL = predict(m.long.w, applyScaler(m.long.scaler, row.x))
    const pS = predict(m.short.w, applyScaler(m.short.scaler, row.x))
    for (const o of row.outcomes) {
      const p = clampP(o.side > 0 ? pL : pS)
      ll -= o.rGross > 0 ? Math.log(p) : Math.log(1 - p)
      n++
    }
    const evL = pL * (m.long.winR - row.winCost) - (1 - pL) * (m.long.lossR + row.lossCost)
    const evS = pS * (m.short.winR - row.winCost) - (1 - pS) * (m.short.lossR + row.lossCost)
    const side = evL >= evS ? 1 : -1
    if (Math.max(evL, evS) > minEvR) {
      const o = row.outcomes.find((x) => x.side === side)
      if (o) taken.push(o.rNet)
    }
  }
  const t = taken.length
  return {
    n,
    logLoss: n ? ll / n : Infinity,
    trades: t,
    expectancyR: t ? taken.reduce((a, v) => a + v, 0) / t : 0,
    winRate: t ? taken.filter((v) => v > 0).length / t : 0,
  }
}

export interface SelectOpts {
  /** Fewest held-out outcomes a comparison needs. */
  minHoldout: number
  /** How much lower the challenger's log loss must be. */
  minLogLossGain: number
}
export const DEFAULT_SELECT: SelectOpts = { minHoldout: 20, minLogLossGain: 0.001 }

/** Should the challenger replace the champion? Both are scored on the same held-out rows. */
export function selectChampion(champ: Score | null, chall: Score, o: SelectOpts = DEFAULT_SELECT): { promote: boolean; reason: string } {
  if (!champ) return { promote: true, reason: 'no champion yet' }
  if (chall.n < o.minHoldout) return { promote: false, reason: `held-out slice too small (${chall.n} < ${o.minHoldout})` }
  const ll = `log loss ${chall.logLoss.toFixed(4)} vs ${champ.logLoss.toFixed(4)}`
  const ex = `expectancy ${chall.expectancyR.toFixed(3)}R vs ${champ.expectancyR.toFixed(3)}R`
  if (!(chall.logLoss < champ.logLoss - o.minLogLossGain)) return { promote: false, reason: `${ll} not better; ${ex}` }
  if (!(chall.expectancyR >= champ.expectancyR)) return { promote: false, reason: `${ex} worse; ${ll}` }
  return { promote: true, reason: `${ll}; ${ex}` }
}

// ---- metrics for the web app -----------------------------------------------

export interface Perf {
  trades: number
  winRate: number
  expectancyR: number
  /** null when there are no losing trades. */
  profitFactor: number | null
  totalR: number
  maxDrawdownR: number
  tradesPerDay: number
}

/** From net R per trade, oldest first, over a period of `days`. */
export function perfMetrics(r: number[], days: number): Perf {
  const n = r.length
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
  return {
    trades: n,
    winRate: n ? r.filter((v) => v > 0).length / n : 0,
    expectancyR: n ? eq / n : 0,
    profitFactor: pains > 0 ? gains / pains : null,
    totalR: eq,
    maxDrawdownR: dd,
    tradesPerDay: days > 0 ? n / days : 0,
  }
}

/** Expected calibration error: |mean p − win rate| per probability bin, weighted by bin size. */
export function ece(points: Array<{ p: number; y: number }>, bins = 10): number | null {
  const ok = points.filter((x) => isFinite(x.p))
  if (!ok.length) return null
  const s = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }))
  for (const x of ok) {
    const k = Math.min(bins - 1, Math.max(0, Math.floor(x.p * bins)))
    s[k].n++
    s[k].p += x.p
    s[k].y += x.y
  }
  return s.reduce((a, b) => (b.n ? a + (Math.abs(b.p / b.n - b.y / b.n) * b.n) / ok.length : a), 0)
}

/** What the web app reads (bot_state 'metrics'). */
export function buildMetrics(
  inp: {
    real: Array<{ symbol: string; r: number }>
    shadow: Array<{ symbol: string; r: number }>
    calib: Array<{ p: number; y: number }>
    equity: number[]
    models: Array<{ symbol: string; interval: string; id: number; version: number; createdAt: number }>
  },
  t: number,
  days: number,
) {
  const symbols = [...new Set(inp.real.map((x) => x.symbol))].sort()
  return {
    t,
    windowDays: days,
    ...perfMetrics(inp.real.map((x) => x.r), days),
    maxDrawdownPct: equityDrawdown(inp.equity),
    calibrationError: ece(inp.calib),
    calibrationSamples: inp.calib.length,
    shadow: perfMetrics(inp.shadow.map((x) => x.r), days),
    bySymbol: Object.fromEntries(symbols.map((s) => [s, perfMetrics(inp.real.filter((x) => x.symbol === s).map((x) => x.r), days)])),
    models: inp.models,
  }
}

/** Largest peak-to-trough fall of an equity series, as a fraction. */
export function equityDrawdown(eq: number[]): number {
  let peak = 0
  let dd = 0
  for (const v of eq) {
    peak = Math.max(peak, v)
    if (peak > 0) dd = Math.max(dd, 1 - v / peak)
  }
  return dd
}
