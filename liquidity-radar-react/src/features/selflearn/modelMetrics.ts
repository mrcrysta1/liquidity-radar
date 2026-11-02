// Model metrics, a data scientist's view of the server bot: how good the
// model's win probabilities are (classification, ranking and calibration), and
// how the rule strategies' trades pay (R statistics).
//
// Pure functions only (tested in scripts/test-engines.mjs); serverBot.ts
// loadModelMetrics fetches the rows from bot_trades, bot_shadow_trades and
// bot_models (radar-worker/sql/002, 005, 006 and 008).
//
// The label is the one the bot learns from (radar-worker/src/bot/learning.ts
// winLabel): a win when the target was hit, a loss when the stop was hit, and
// otherwise (time exit) a win when the gross R was positive. Real trades carry
// no gross R, so their time exits use the net R (r_multiple) instead.

type Raw = Record<string, unknown>

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const time = (v: unknown): number | null => {
  if (v == null) return null
  const t = typeof v === 'number' ? v : Date.parse(String(v))
  return isFinite(t) ? t : null
}

/** The bot's decision bar: a model signal is "taken" when its EV after costs is above it (BOT_MIN_EV, setup.ts). */
export const DECISION_EV = 0.1
/** Rolling window, in closed trades. */
export const RECENT_N = 100

/** learning.ts winLabel. */
export function winLabel(exit: string | null, r: number): 0 | 1 {
  if (exit === 'tp') return 1
  if (exit === 'sl') return 0
  return r > 0 ? 1 : 0
}

// ---- rows ---------------------------------------------------------------------

export interface MlRow {
  kind: 'real' | 'shadow'
  symbol: string
  /** Close time; the order of "last 100". */
  t: number
  /** The model's raw probability for the side taken. */
  pRaw: number | null
  /** After online calibration (p_cal / p_win): the number the EV is built on. */
  p: number
  evR: number | null
  y: 0 | 1
  r: number | null
}

export interface RuleRow {
  kind: 'real' | 'shadow'
  strategy: string
  symbol: string
  t: number
  /** Net R (after fees / estimated costs). */
  r: number
  barsHeld: number | null
  maeR: number | null
  mfeR: number | null
}

const prob = (v: unknown): number | null => {
  const p = num(v)
  return p != null && p >= 0 && p <= 1 ? p : null
}

/**
 * Closed trades split into the model's (with a probability and a label) and
 * the rule strategies'. Real rows without a strategy are older single-strategy
 * trades: 'trend' mode was F1, gated / explore the model.
 */
export function splitRows(real: Raw[], shadow: Raw[]): { ml: MlRow[]; rule: RuleRow[] } {
  const ml: MlRow[] = []
  const rule: RuleRow[] = []
  const add = (kind: 'real' | 'shadow', x: Raw) => {
    if (str(x.status) !== 'closed') return
    const symbol = str(x.symbol) ?? '?'
    const t = time(x.closed_at) ?? time(kind === 'real' ? x.opened_at : x.bar_time)
    const rNet = num(kind === 'real' ? x.r_multiple : x.r_net)
    if (t == null) return
    const exit = str(x.exit_reason)
    let strategy = str(x.strategy)
    if (!strategy) strategy = kind === 'real' && str(x.mode) === 'trend' ? 'f1' : 'ml'
    if (strategy === 'ml') {
      const p = prob(kind === 'real' ? x.p_win : x.p_cal) ?? prob(x.p_raw)
      const rLab = kind === 'real' ? rNet : (num(x.r_gross) ?? rNet)
      if (p == null || (rLab == null && exit !== 'tp' && exit !== 'sl')) return
      ml.push({ kind, symbol, t, pRaw: prob(x.p_raw), p, evR: num(x.ev_r), y: winLabel(exit, rLab ?? 0), r: rNet })
      return
    }
    if (rNet == null) return
    rule.push({ kind, strategy, symbol, t, r: rNet, barsHeld: num(x.bars_held), maeR: num(x.mae_r), mfeR: num(x.mfe_r) })
  }
  for (const x of real) add('real', x)
  for (const x of shadow) add('shadow', x)
  ml.sort((a, b) => a.t - b.t)
  rule.sort((a, b) => a.t - b.t)
  return { ml, rule }
}

// ---- classification ---------------------------------------------------------------

export interface Confusion {
  tp: number
  fp: number
  tn: number
  fn: number
}

export interface Classification extends Confusion {
  n: number
  accuracy: number | null
  precision: number | null
  recall: number | null
  specificity: number | null
  f1: number | null
  /** Share predicted positive (signals taken). */
  takeRate: number | null
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null)

export function classify(y: number[], pred: boolean[]): Classification {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 }
  for (let i = 0; i < y.length; i++) {
    if (pred[i] && y[i]) c.tp++
    else if (pred[i]) c.fp++
    else if (y[i]) c.fn++
    else c.tn++
  }
  const n = y.length
  const precision = ratio(c.tp, c.tp + c.fp)
  const recall = ratio(c.tp, c.tp + c.fn)
  return {
    ...c,
    n,
    accuracy: ratio(c.tp + c.tn, n),
    precision,
    recall,
    specificity: ratio(c.tn, c.tn + c.fp),
    f1: precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : c.tp + c.fp + c.fn > 0 ? 0 : null,
    takeRate: ratio(c.tp + c.fp, n),
  }
}

/** ROC-AUC as the Mann-Whitney U statistic (ties count half). Null without both classes. */
export function rocAuc(p: number[], y: number[]): number | null {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b])
  const rank = new Array<number>(p.length)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++
    for (let k = i; k <= j; k++) rank[idx[k]] = (i + j) / 2 + 1
    i = j + 1
  }
  let pos = 0
  let sum = 0
  for (let i = 0; i < y.length; i++)
    if (y[i]) {
      pos++
      sum += rank[i]
    }
  const neg = y.length - pos
  if (!pos || !neg) return null
  return (sum - (pos * (pos + 1)) / 2) / (pos * neg)
}

/** PR-AUC as average precision: precision at each threshold, weighted by the recall it adds (tied scores step together). */
export function prAuc(p: number[], y: number[]): number | null {
  const pos = y.reduce((a, v) => a + (v ? 1 : 0), 0)
  if (!pos) return null
  const idx = p.map((_, i) => i).sort((a, b) => p[b] - p[a])
  let tp = 0
  let seen = 0
  let ap = 0
  for (let i = 0; i < idx.length; ) {
    let j = i
    let addTp = 0
    while (j < idx.length && p[idx[j]] === p[idx[i]]) {
      addTp += y[idx[j]] ? 1 : 0
      j++
    }
    seen += j - i
    tp += addTp
    if (addTp) ap += (addTp / pos) * (tp / seen)
    i = j
  }
  return ap
}

export function brier(p: number[], y: number[]): number | null {
  return p.length ? p.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / p.length : null
}

export function logLoss(p: number[], y: number[]): number | null {
  if (!p.length) return null
  const e = 1e-15
  return -p.reduce((a, v, i) => {
    const q = Math.min(1 - e, Math.max(e, v))
    return a + (y[i] ? Math.log(q) : Math.log(1 - q))
  }, 0) / p.length
}

export interface CalibBin {
  lo: number
  hi: number
  n: number
  /** Mean predicted probability in the bin (null when empty). */
  predicted: number | null
  /** Share that won. */
  actual: number | null
}

/** Reliability table: `bins` equal-width bins over [0, 1] and the expected calibration error (count-weighted |predicted - actual|). */
export function calibration(p: number[], y: number[], bins = 10): { bins: CalibBin[]; ece: number | null } {
  const out: CalibBin[] = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, predicted: null, actual: null }))
  const sp = new Array<number>(bins).fill(0)
  const sy = new Array<number>(bins).fill(0)
  for (let i = 0; i < p.length; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(p[i] * bins)))
    out[b].n++
    sp[b] += p[i]
    sy[b] += y[i]
  }
  let ece = 0
  for (let b = 0; b < bins; b++) {
    if (!out[b].n) continue
    out[b].predicted = sp[b] / out[b].n
    out[b].actual = sy[b] / out[b].n
    ece += (out[b].n / p.length) * Math.abs(out[b].predicted! - out[b].actual!)
  }
  return { bins: out, ece: p.length ? ece : null }
}

export interface MlReport {
  n: number
  real: number
  shadow: number
  /** Share of wins (the "always say win" accuracy to beat). */
  baseRate: number | null
  meanP: number | null
  at50: Classification
  /** Taken = EV > DECISION_EV (rows without an EV count as not taken). */
  atDecision: Classification
  auc: number | null
  prAuc: number | null
  brier: number | null
  /** Brier of always predicting the base rate: the bar a useful model beats. */
  brierBase: number | null
  logLoss: number | null
  ece: number | null
  calib: CalibBin[]
  /** The same scores on the raw (uncalibrated) probability, where every row has one. */
  raw: { n: number; auc: number | null; brier: number | null; logLoss: number | null; ece: number | null }
  /** Mean net R of the taken and of the skipped signals. */
  takenR: number | null
  skippedR: number | null
}

const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : null)

export function mlReport(rows: MlRow[], minEv = DECISION_EV): MlReport {
  const p = rows.map((r) => r.p)
  const y = rows.map((r) => r.y)
  const base = mean(y)
  const taken = rows.map((r) => r.evR != null && r.evR > minEv)
  const rawRows = rows.filter((r) => r.pRaw != null)
  const rp = rawRows.map((r) => r.pRaw!)
  const ry = rawRows.map((r) => r.y)
  const cal = calibration(p, y)
  const rOf = (want: boolean) => rows.filter((r, i) => taken[i] === want && r.r != null).map((r) => r.r!)
  return {
    n: rows.length,
    real: rows.filter((r) => r.kind === 'real').length,
    shadow: rows.filter((r) => r.kind === 'shadow').length,
    baseRate: base,
    meanP: mean(p),
    at50: classify(y, p.map((v) => v >= 0.5)),
    atDecision: classify(y, taken),
    auc: rocAuc(p, y),
    prAuc: prAuc(p, y),
    brier: brier(p, y),
    brierBase: base == null ? null : base * (1 - base),
    logLoss: logLoss(p, y),
    ece: cal.ece,
    calib: cal.bins,
    raw: { n: rawRows.length, auc: rocAuc(rp, ry), brier: brier(rp, ry), logLoss: logLoss(rp, ry), ece: calibration(rp, ry).ece },
    takenR: mean(rOf(true)),
    skippedR: mean(rOf(false)),
  }
}

// ---- rule strategies --------------------------------------------------------------

export interface RuleReport {
  trades: number
  real: number
  shadow: number
  winRate: number | null
  avgWinR: number | null
  /** Negative. */
  avgLossR: number | null
  /** avg win / |avg loss|: the realised reward:risk. */
  payoff: number | null
  /** Mean R per trade. */
  expectancy: number | null
  /** Gross wins / gross losses; null with no losses. */
  profitFactor: number | null
  totalR: number
  /** Deepest fall of the cumulative R from its peak, in close order. */
  maxDdR: number
  /** Mean / standard deviation of per-trade R (not annualised). */
  sharpe: number | null
  avgBars: number | null
  medMaeR: number | null
  medMfeR: number | null
}

export function median(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function maxDrawdownR(r: number[]): number {
  let cum = 0
  let peak = 0
  let dd = 0
  for (const x of r) {
    cum += x
    peak = Math.max(peak, cum)
    dd = Math.max(dd, peak - cum)
  }
  return dd
}

/** Rows in close order. */
export function ruleReport(rows: Array<Pick<RuleRow, 'kind' | 'r' | 'barsHeld' | 'maeR' | 'mfeR'>>): RuleReport {
  const r = rows.map((x) => x.r)
  const wins = r.filter((x) => x > 0)
  const losses = r.filter((x) => x <= 0)
  const avgWinR = mean(wins)
  const avgLossR = mean(losses)
  const m = mean(r)
  const sd = r.length > 1 && m != null ? Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1)) : null
  const gw = wins.reduce((a, x) => a + x, 0)
  const gl = -losses.reduce((a, x) => a + x, 0)
  const pick = (k: 'barsHeld' | 'maeR' | 'mfeR') => rows.map((x) => x[k]).filter((v): v is number => v != null)
  return {
    trades: r.length,
    real: rows.filter((x) => x.kind === 'real').length,
    shadow: rows.filter((x) => x.kind === 'shadow').length,
    winRate: r.length ? wins.length / r.length : null,
    avgWinR,
    avgLossR,
    payoff: avgWinR != null && avgLossR != null && avgLossR < 0 ? avgWinR / -avgLossR : null,
    expectancy: m,
    profitFactor: gl > 0 ? gw / gl : null,
    totalR: r.reduce((a, x) => a + x, 0),
    maxDdR: maxDrawdownR(r),
    sharpe: sd != null && sd > 0 ? m! / sd : null,
    avgBars: mean(pick('barsHeld')),
    medMaeR: median(pick('maeR')),
    medMfeR: median(pick('mfeR')),
  }
}

// ---- per market, overall, rolling ----------------------------------------------------

export interface Windowed<T> {
  all: T
  /** The last RECENT_N closed trades. */
  recent: T
}

export interface Breakdown<T> {
  overall: Windowed<T>
  perMarket: Array<{ symbol: string } & Windowed<T>>
}

function windowed<R, T>(rows: R[], f: (r: R[]) => T): Windowed<T> {
  return { all: f(rows), recent: f(rows.slice(-RECENT_N)) }
}

function breakdown<R extends { symbol: string }, T>(rows: R[], f: (r: R[]) => T): Breakdown<T> {
  const by = new Map<string, R[]>()
  for (const r of rows) by.set(r.symbol, [...(by.get(r.symbol) ?? []), r])
  return {
    overall: windowed(rows, f),
    perMarket: [...by.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(([symbol, rs]) => ({ symbol, ...windowed(rs, f) })),
  }
}

/** Rows in close order (splitRows sorts them). */
export function mlMetrics(rows: MlRow[], minEv = DECISION_EV): Breakdown<MlReport> {
  return breakdown(rows, (r) => mlReport(r, minEv))
}

export interface StrategyMetrics extends Breakdown<RuleReport> {
  id: string
}

/** One entry per rule strategy, most trades first; F1, C6, F1X, C2 lead when present. */
export function strategyMetrics(rows: RuleRow[]): StrategyMetrics[] {
  const order = ['f1', 'c6', 'f1x', 'c2']
  const ids = [...new Set(rows.map((r) => r.strategy))].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1)
  })
  return ids.map((id) => ({ id, ...breakdown(rows.filter((r) => r.strategy === id), ruleReport) }))
}

// ---- model registry ---------------------------------------------------------------

export interface ChallengerOutcome {
  version: number | null
  t: number
  promoted: boolean
  reason: string
  trigger: string | null
  /** Held-out log loss of the challenger and of the champion it faced. */
  challLogLoss: number | null
  champLogLoss: number | null
}

export interface MarketRegistry {
  symbol: string
  interval: string | null
  championVersion: number | null
  championSince: number | null
  /** Champion's walk-forward verdict. */
  gatePass: boolean | null
  lastPromotion: number | null
  challengers: number
  promotions: number
  /** Newest first, at most 5. */
  recent: ChallengerOutcome[]
}

const parse = (v: unknown): Raw | null => {
  if (v == null) return null
  if (typeof v === 'object') return v as Raw
  try {
    const o = JSON.parse(String(v))
    return o && typeof o === 'object' ? (o as Raw) : null
  } catch {
    return null
  }
}

/** bot_models rows (id, symbol, interval, version, role, created_at, promoted_at, gate_pass, holdout), any order. */
export function modelRegistry(models: Raw[]): MarketRegistry[] {
  const by = new Map<string, Raw[]>()
  for (const m of models) {
    const s = str(m.symbol)
    if (s) by.set(s, [...(by.get(s) ?? []), m])
  }
  const out: MarketRegistry[] = []
  for (const [symbol, rows] of by) {
    const newest = [...rows].sort((a, b) => (time(b.created_at) ?? 0) - (time(a.created_at) ?? 0) || (num(b.id) ?? 0) - (num(a.id) ?? 0))
    const champ = newest.find((m) => str(m.role) === 'champion') ?? null
    const promos = newest.map((m) => time(m.promoted_at)).filter((t): t is number => t != null)
    const outcomes: ChallengerOutcome[] = []
    for (const m of newest) {
      const h = parse(m.holdout)
      if (!h) continue
      outcomes.push({
        version: num(m.version),
        t: time(m.created_at) ?? 0,
        promoted: h.promoted === true,
        reason: str(h.reason) ?? '',
        trigger: str(h.trigger),
        challLogLoss: num(parse(h.challenger)?.logLoss),
        champLogLoss: num(parse(h.champion)?.logLoss),
      })
    }
    out.push({
      symbol,
      interval: str(champ?.interval ?? newest[0]?.interval),
      championVersion: champ ? num(champ.version) : null,
      championSince: champ ? (time(champ.promoted_at) ?? time(champ.created_at)) : null,
      gatePass: champ ? champ.gate_pass === true : null,
      lastPromotion: promos.length ? Math.max(...promos) : null,
      challengers: outcomes.length,
      promotions: outcomes.filter((o) => o.promoted).length,
      recent: outcomes.slice(0, 5),
    })
  }
  return out.sort((a, b) => (a.symbol < b.symbol ? -1 : 1))
}
