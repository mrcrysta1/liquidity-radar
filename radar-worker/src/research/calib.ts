// Model calibration study (research plan P6). Pure (tested in
// test/research-calib.test.ts); scripts/ml-eval.ts loads the model's closed
// real and shadow trades and publishes the result.
//
// The live bot calibrates its win chances per market × side × regime
// (learning.ts, 24 × 2 × 6 cells): with a few hundred outcomes most cells have
// almost no data. This replays every outcome in time order and compares that
// with pooled alternatives, prequentially: each outcome is predicted with what
// was known at its decision time, and learned from only once it closed — no
// look-ahead. Same update rule (updateCalibration) for every candidate.
//
// Scores: log loss and Brier (lower is better), ECE (calibration error), AUC
// (ranking), each by side, and the improvement over the live scheme with a
// 95% range grouped by decision candle (outcomes on one candle move
// together). "Base rate" predicts the running win rate seen so far: a model
// that cannot beat it has no usable skill.
import { CAL_PRIOR, DEFAULT_CAL, calibrate, updateCalibration, winLabel } from '../bot/learning.ts'
import type { Db } from '../db.ts'
import type { BotStore } from '../bot/store.ts'
import type { Calib } from '../bot/learning.ts'

export interface CalRow {
  symbol: string
  side: 1 | -1
  regime: string
  /** Decision time (when the probability was used) and close time (when the outcome was known), ms. */
  t: number
  closedAt: number
  pRaw: number
  y: 0 | 1
  /** Net R:R of the bracket and the trade's result (for the decision-value check). */
  rr: number | null
  r: number
}

export type CandidateId = 'raw' | 'cell' | 'side' | 'side-candle' | 'side-regime' | 'global' | 'side+cell30' | 'base-rate'
export const CANDIDATES: Array<{ id: CandidateId; label: string }> = [
  { id: 'cell', label: 'Live: per market × side × regime' },
  { id: 'side', label: 'Per side (long / short)' },
  { id: 'side-candle', label: 'Per side, one step per candle (same-candle trades share it)' },
  { id: 'side-regime', label: 'Per side × regime' },
  { id: 'side+cell30', label: 'Per side; per market cell once it has 30 trades' },
  { id: 'global', label: 'One calibration for all' },
  { id: 'raw', label: 'Raw model, no calibration' },
  { id: 'base-rate', label: 'Running win rate (no model)' },
]

const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p))

/** Each row's prediction under every candidate, made before its own outcome is learned. */
export function prequential(rows: CalRow[]): Record<CandidateId, number[]> {
  const idx = rows.map((_, i) => i)
  // Events: predictions at t, updates at closedAt; an update at the same instant comes first only if it closed strictly before.
  const ev: Array<{ at: number; kind: 0 | 1; i: number }> = []
  for (const i of idx) {
    ev.push({ at: rows[i].t, kind: 1, i })
    ev.push({ at: rows[i].closedAt, kind: 0, i })
  }
  ev.sort((a, b) => a.at - b.at || b.kind - a.kind)
  const maps: Record<string, Map<string, Calib>> = { cell: new Map(), side: new Map(), 'side-candle': new Map(), 'side-regime': new Map(), global: new Map() }
  // Same-side outcomes decided on one candle: each takes 1/k of a step, so a correlated burst moves it like one outcome.
  const perCandle = new Map<string, number>()
  for (const r of rows) perCandle.set(`${r.side}|${r.t}`, (perCandle.get(`${r.side}|${r.t}`) ?? 0) + 1)
  const keyOf: Record<string, (r: CalRow) => string> = {
    cell: (r) => `${r.symbol}|${r.side}|${r.regime}`,
    side: (r) => String(r.side),
    'side-candle': (r) => String(r.side),
    'side-regime': (r) => `${r.side}|${r.regime}`,
    global: () => '*',
  }
  const get = (m: string, r: CalRow) => maps[m].get(keyOf[m](r)) ?? CAL_PRIOR
  let wins = 0
  let seen = 0
  const out = Object.fromEntries(CANDIDATES.map((c) => [c.id, new Array(rows.length).fill(NaN)])) as Record<CandidateId, number[]>
  for (const e of ev) {
    const r = rows[e.i]
    if (e.kind === 1) {
      out.raw[e.i] = r.pRaw
      for (const m of ['cell', 'side', 'side-candle', 'side-regime', 'global'] as const) out[m][e.i] = calibrate(r.pRaw, get(m, r))
      const cell = get('cell', r)
      out['side+cell30'][e.i] = cell.n >= 30 ? calibrate(r.pRaw, cell) : calibrate(r.pRaw, get('side', r))
      out['base-rate'][e.i] = (wins + 1) / (seen + 2)
    } else {
      for (const m of ['cell', 'side', 'side-regime', 'global'] as const) maps[m].set(keyOf[m](r), updateCalibration(get(m, r), r.pRaw, r.y))
      const k = perCandle.get(`${r.side}|${r.t}`) ?? 1
      maps['side-candle'].set(keyOf['side-candle'](r), updateCalibration(get('side-candle', r), r.pRaw, r.y, { ...DEFAULT_CAL, lr: DEFAULT_CAL.lr / k }))
      wins += r.y
      seen++
    }
  }
  return out
}

export interface Score {
  n: number
  logLoss: number | null
  brier: number | null
  ece: number | null
  auc: number | null
  /** Mean predicted vs actual win rate. */
  meanP: number | null
  winRate: number | null
}

export function score(p: number[], y: Array<0 | 1>): Score {
  const n = p.length
  if (!n) return { n, logLoss: null, brier: null, ece: null, auc: null, meanP: null, winRate: null }
  let ll = 0
  let br = 0
  for (let i = 0; i < n; i++) {
    const q = clampP(p[i])
    ll -= y[i] ? Math.log(q) : Math.log(1 - q)
    br += (q - y[i]) ** 2
  }
  // ECE over 10 equal-width bins.
  const bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }))
  for (let i = 0; i < n; i++) {
    const b = bins[Math.min(9, Math.floor(clampP(p[i]) * 10))]
    b.n++
    b.p += p[i]
    b.y += y[i]
  }
  const ece = bins.reduce((a, b) => a + (b.n ? (b.n / n) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0)
  // AUC by ranks (ties averaged).
  const order = p.map((v, i) => ({ v, y: y[i] })).sort((a, b) => a.v - b.v)
  let rank = 1
  let sumPos = 0
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j < order.length && order[j].v === order[i].v) j++
    const avg = (rank + rank + (j - i) - 1) / 2
    for (let k = i; k < j; k++) if (order[k].y) sumPos += avg
    rank += j - i
    i = j
  }
  const pos = y.filter((v) => v === 1).length
  const neg = n - pos
  return {
    n,
    logLoss: ll / n,
    brier: br / n,
    ece,
    auc: pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : null,
    meanP: p.reduce((a, b) => a + b, 0) / n,
    winRate: pos / n,
  }
}

/** Mean of per-row differences with a 95% range grouped by `group` (decision candle). No range under 10 groups. */
export function pairedDiff(d: number[], group: number[]): { mean: number | null; lo: number | null; hi: number | null; groups: number } {
  const n = d.length
  if (!n) return { mean: null, lo: null, hi: null, groups: 0 }
  const mean = d.reduce((a, b) => a + b, 0) / n
  const g = new Map<number, number>()
  d.forEach((v, i) => g.set(group[i], (g.get(group[i]) ?? 0) + v - mean))
  const G = g.size
  if (G < 10) return { mean, lo: null, hi: null, groups: G }
  let s = 0
  for (const v of g.values()) s += v * v
  const se = Math.sqrt((s / n ** 2) * (G / (G - 1)))
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, groups: G }
}

const ll1 = (p: number, y: 0 | 1) => -(y ? Math.log(clampP(p)) : Math.log(1 - clampP(p)))

export interface CandidateReport {
  id: CandidateId
  label: string
  all: Score
  long: Score
  short: Score
  /** Log-loss improvement over the live scheme (positive = better), 95% range by candle. */
  vsLive: { mean: number | null; lo: number | null; hi: number | null; groups: number }
  /** Trades it would take at EV ≥ minEv (EV in units of the loss: p·rr − (1 − p)) and their mean result. */
  taken: { n: number; meanR: number | null }
}

export interface CalibrationStudy {
  n: number
  warmup: number
  candidates: CandidateReport[]
  /** The candidate with the lowest log loss whose improvement over live is clear (range above zero), else null. */
  better: CandidateId | null
  verdict: string
}

/** The whole study; the first `warmup` outcomes (by decision time) are replayed but not scored. */
export function calibrationStudy(rows: CalRow[], warmup = 50, minEv = 0.1): CalibrationStudy {
  const s = [...rows].sort((a, b) => a.t - b.t)
  const pred = prequential(s)
  const keep = s.map((_, i) => i).filter((i) => i >= warmup)
  const y = keep.map((i) => s[i].y)
  const groups = keep.map((i) => s[i].t)
  const live = keep.map((i) => pred.cell[i])
  const candidates: CandidateReport[] = CANDIDATES.map(({ id, label }) => {
    const p = keep.map((i) => pred[id][i])
    const side = (sd: 1 | -1) => {
      const k = keep.map((i, j) => [i, j] as const).filter(([i]) => s[i].side === sd)
      return score(k.map(([, j]) => p[j]), k.map(([i]) => s[i].y))
    }
    const tk = keep.map((i, j) => [i, j] as const).filter(([i, j]) => s[i].rr != null && p[j] * s[i].rr! - (1 - p[j]) >= minEv)
    return {
      id,
      label,
      all: score(p, y),
      long: side(1),
      short: side(-1),
      vsLive: pairedDiff(keep.map((i, j) => ll1(live[j], s[i].y) - ll1(p[j], s[i].y)), groups),
      taken: { n: tk.length, meanR: tk.length ? tk.reduce((a, [i]) => a + s[i].r, 0) / tk.length : null },
    }
  })
  const clear = candidates.filter((c) => c.id !== 'cell' && c.id !== 'base-rate' && c.vsLive.lo != null && c.vsLive.lo > 0).sort((a, b) => (a.all.logLoss ?? 9) - (b.all.logLoss ?? 9))
  const live0 = candidates.find((c) => c.id === 'cell')!
  const base = candidates.find((c) => c.id === 'base-rate')!
  const skill = live0.all.logLoss != null && base.all.logLoss != null ? base.all.logLoss - live0.all.logLoss : null
  const verdict = !keep.length
    ? 'Not enough outcomes yet.'
    : clear.length
      ? `${clear[0].label} predicts better than the live scheme (log loss ${clear[0].all.logLoss!.toFixed(4)} vs ${live0.all.logLoss!.toFixed(4)}, 95% range of the gain above zero). Worth trying as a challenger; nothing was changed.`
      : `No alternative beats the live scheme by more than chance yet.${skill != null ? ` The live model ${skill > 0 ? 'beats' : 'does not beat'} simply predicting the running win rate (log loss ${live0.all.logLoss!.toFixed(4)} vs ${base.all.logLoss!.toFixed(4)}).` : ''}`
  return { n: rows.length, warmup, candidates, better: clear[0]?.id ?? null, verdict }
}

// ---- loading and the daily refresh -------------------------------------------------------


/** The 4h setup's start (PR #126): older outcomes came from a different model setup. */
export const CALIB_SINCE = Date.UTC(2026, 9, 31, 6, 12)
const STEP_4H = 14_400_000

/** The model's closed shadow and real trades with a raw probability, since `since`. */
export async function loadCalRows(db: Db, since = CALIB_SINCE): Promise<CalRow[]> {
  const iso = new Date(since).toISOString()
  const sh = await db.query<Record<string, unknown>>(
    `select symbol, side, regime, bar_time, closed_at, p_raw, exit_reason, r_gross, r_net, rr_net from bot_shadow_trades
     where status = 'closed' and p_raw is not null and coalesce(strategy, 'ml') = 'ml' and coalesce(interval, '4h') = '4h' and bar_time >= $1`,
    [iso],
  )
  const re = await db.query<Record<string, unknown>>(
    `select symbol, side, regime, bar_time, opened_at, closed_at, p_raw, exit_reason, r_multiple, cost_r, rr_net from bot_trades
     where status = 'closed' and p_raw is not null and coalesce(strategy, case when mode = 'trend' then 'f1' else 'ml' end) = 'ml' and opened_at >= $1`,
    [iso],
  )
  const ms = (v: unknown) => new Date(v as string).getTime()
  const out: CalRow[] = []
  for (const x of sh.rows) {
    const rg = Number(x.r_gross)
    out.push({ symbol: String(x.symbol), side: Number(x.side) > 0 ? 1 : -1, regime: String(x.regime ?? ''), t: ms(x.bar_time) + STEP_4H, closedAt: ms(x.closed_at), pRaw: Number(x.p_raw), y: winLabel(String(x.exit_reason), rg), rr: x.rr_net == null ? null : Number(x.rr_net), r: Number(x.r_net) })
  }
  for (const x of re.rows) {
    const rg = Number(x.r_multiple) + Number(x.cost_r ?? 0)
    out.push({ symbol: String(x.symbol), side: Number(x.side) > 0 ? 1 : -1, regime: String(x.regime ?? ''), t: ms(x.opened_at), closedAt: ms(x.closed_at), pRaw: Number(x.p_raw), y: winLabel(String(x.exit_reason), rg), rr: x.rr_net == null ? null : Number(x.rr_net), r: Number(x.r_multiple) })
  }
  return out.filter((r) => Number.isFinite(r.t) && Number.isFinite(r.closedAt) && Number.isFinite(r.pRaw) && Number.isFinite(r.r))
}

let evalAt = 0
let evalBusy = false
/** From the bot's tick: once a day, in the background, the study → bot_state 'ml:eval'. Report only. */
export function mlEvalTick(store: BotStore, db: Db, now = Date.now()): void {
  if (evalBusy || now - evalAt < 86_400_000) return
  evalBusy = true
  evalAt = now
  void loadCalRows(db)
    .then((rows) => store.setState('ml:eval', { t: Date.now(), since: CALIB_SINCE, ...calibrationStudy(rows) }))
    .catch((e) => console.error('ml eval', (e as Error).message))
    .finally(() => {
      evalBusy = false
    })
}
