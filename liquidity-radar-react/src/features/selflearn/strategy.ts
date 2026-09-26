// What a trade is, for the self-learning engine, and how it is judged.
//
// Every trade is a bracket: entry at a closed bar's close, stop and target a
// fixed number of ATRs away, and a time limit. Two styles share the rules:
// scalps on 5-minute bars with a tight bracket, swings on 1-hour bars with a
// wide one. For each style there is one model per side, each estimating the
// chance its bracket hits the target before the stop. A trade is taken only
// when that chance, after costs, is worth the risk.
//
// The backtest below is the same code path the live engine runs, replayed
// over history: train on the past, trade the future bar by bar, and (when
// asked) learn from each closed trade exactly as the live engine does.
import type { CandleFlat } from '../../services/market'
import { series, WARMUP } from './features'
import type { Series } from './features'
import { fitLogit, learnLogit, pLogit } from './models'
import type { Logit } from './models'

export type StratId = 'scalp' | 'swing'
export type Side = 1 | -1

export interface Strat {
  id: StratId
  label: string
  tf: string
  tfMs: number
  tpM: number
  slM: number
  maxHold: number
  /** Bars of history the model is trained on. */
  bars: number
  /** How often the model is rebuilt from fresh history. */
  retrainMs: number
  /** Only trade in the direction of the EMA 20 / 50 trend. */
  trend: boolean
  /** How far the model's probability must sit above its base rate. */
  edge: number
  /** Expected value, in R after costs, a trade must clear. */
  minEV: number
  blurb: string
}

export const STRATS: Record<StratId, Strat> = {
  // Settings chosen by backtest across six markets (BTC, PAXG, ETH, SOL, BNB,
  // XRP; ~4,000 bars each, trained on the first half, traded on the second):
  // the tighter 5m scalp and 1h swing both lost steadily once fees were paid.
  scalp: {
    id: 'scalp', label: 'Scalp', tf: '15m', tfMs: 900_000, tpM: 2.25, slM: 1.5, maxHold: 32,
    bars: 3000, retrainMs: 6 * 3600_000, trend: true, edge: 0, minEV: 0.25,
    blurb: '15m bars · stop 1.5 ATR · target 2.25 ATR · max 8h · with the trend',
  },
  swing: {
    id: 'swing', label: 'Swing', tf: '4h', tfMs: 14_400_000, tpM: 3, slM: 1.5, maxHold: 30,
    bars: 3000, retrainMs: 24 * 3600_000, trend: true, edge: 0, minEV: 0.1,
    blurb: '4h bars · stop 1.5 ATR · target 3 ATR · max 5 days · with the trend',
  },
}

/** Round-trip taker fees plus a little slippage, as a fraction of price. */
export const FEE = 0.0008

export interface Outcome {
  win: 0 | 1
  /** Result in R (multiples of the risk taken), after costs. */
  r: number
  exitIdx: number
  exit: number
  reason: 'tp' | 'sl' | 'time'
}

export const costR = (entry: number, atr: number, st: Strat) => (FEE * entry) / (st.slM * atr)

/** Expected value in R for a win probability, after costs. */
export const evR = (p: number, st: Strat, cR: number) => p * (st.tpM / st.slM) - (1 - p) - cR

export function levels(entry: number, atr: number, side: Side, st: Strat) {
  return { sl: entry - side * st.slM * atr, tp: entry + side * st.tpM * atr }
}

/** Resolve a bracket from bar i forward. A bar that touches both ends counts as the stop. */
export function bracket(cs: CandleFlat[], i: number, side: Side, atr: number, st: Strat): Outcome | null {
  const entry = cs[i].c
  const { sl, tp } = levels(entry, atr, side, st)
  const cR = costR(entry, atr, st)
  const last = Math.min(cs.length - 1, i + st.maxHold)
  for (let j = i + 1; j <= last; j++) {
    const k = cs[j]
    const hitSl = side === 1 ? k.l <= sl : k.h >= sl
    const hitTp = side === 1 ? k.h >= tp : k.l <= tp
    if (hitSl) return { win: 0, r: -1 - cR, exitIdx: j, exit: sl, reason: 'sl' }
    if (hitTp) return { win: 1, r: st.tpM / st.slM - cR, exitIdx: j, exit: tp, reason: 'tp' }
  }
  if (i + st.maxHold > cs.length - 1) return null
  const exit = cs[last].c
  const r = (side * (exit - entry)) / (st.slM * atr) - cR
  return { win: r > 0 ? 1 : 0, r, exitIdx: last, exit, reason: 'time' }
}

export interface Row {
  i: number
  x: number[]
  long: Outcome
  short: Outcome
}

export function dataset(cs: CandleFlat[], S: Series, st: Strat, from = WARMUP): Row[] {
  const rows: Row[] = []
  for (let i = from; i < cs.length; i++) {
    const x = S.X[i]
    if (!x) continue
    const long = bracket(cs, i, 1, S.atr[i], st)
    const short = bracket(cs, i, -1, S.atr[i], st)
    if (!long || !short) continue
    rows.push({ i, x, long, short })
  }
  return rows
}

export interface Pair {
  long: Logit
  short: Logit
}

export function trainPair(rows: Row[]): Pair {
  const X = rows.map((r) => r.x)
  return {
    long: fitLogit(X, rows.map((r) => r.long.win)),
    short: fitLogit(X, rows.map((r) => r.short.win)),
  }
}

export interface Decision {
  side: Side | 0
  pLong: number
  pShort: number
  evLong: number
  evShort: number
}

export function decide(m: Pair, x: number[], entry: number, atr: number, st: Strat, minEV: number): Decision {
  const pLong = pLogit(m.long, x)
  const pShort = pLogit(m.short, x)
  const cR = costR(entry, atr, st)
  const evLong = evR(pLong, st, cR)
  const evShort = evR(pShort, st, cR)
  // EMA 20 above EMA 50 is an uptrend; features 6 and 7 are price minus each, in ATR.
  const trend = Math.sign(x[7] - x[6])
  const okLong = evLong > minEV && pLong - m.long.base >= st.edge && (!st.trend || trend > 0)
  const okShort = evShort > minEV && pShort - m.short.base >= st.edge && (!st.trend || trend < 0)
  let side: Side | 0 = 0
  if (okLong && (!okShort || evLong >= evShort)) side = 1
  else if (okShort) side = -1
  return { side, pLong, pShort, evLong, evShort }
}

export interface BtTrade {
  i: number
  t: number
  exitT: number
  side: Side
  entry: number
  exit: number
  sl: number
  tp: number
  r: number
  reason: Outcome['reason']
  p: number
  ev: number
  bars: number
}

/** Trade the rows from `from` on, one position at a time, optionally learning from each exit. */
export function simulate(
  cs: CandleFlat[],
  S: Series,
  rows: Row[],
  from: number,
  m: Pair,
  st: Strat,
  opts: { minEV: number; online: boolean },
): BtTrade[] {
  const out: BtTrade[] = []
  let freeAt = -1
  for (const row of rows) {
    if (row.i < from || row.i < freeAt) continue
    const atr = S.atr[row.i]
    const entry = cs[row.i].c
    const d = decide(m, row.x, entry, atr, st, opts.minEV)
    if (!d.side) continue
    const o = d.side === 1 ? row.long : row.short
    const { sl, tp } = levels(entry, atr, d.side, st)
    out.push({
      i: row.i, t: cs[row.i].t, exitT: cs[o.exitIdx].t, side: d.side, entry, exit: o.exit, sl, tp,
      r: o.r, reason: o.reason, p: d.side === 1 ? d.pLong : d.pShort, ev: d.side === 1 ? d.evLong : d.evShort,
      bars: o.exitIdx - row.i,
    })
    freeAt = o.exitIdx
    if (opts.online) learnLogit(d.side === 1 ? m.long : m.short, row.x, o.win)
  }
  return out
}

export interface BtStats {
  n: number
  wins: number
  winRate: number
  avgR: number
  totalR: number
  profitFactor: number
  maxDD: number
  /** Account growth risking `riskPct` per trade, compounded. */
  growth: number
  equity: number[]
  long: { n: number; winRate: number }
  short: { n: number; winRate: number }
  avgBars: number
}

export function stats(trades: Array<{ r: number; side: Side; bars?: number }>, riskPct = 1): BtStats {
  const n = trades.length
  const wins = trades.filter((t) => t.r > 0).length
  const gain = trades.filter((t) => t.r > 0).reduce((a, t) => a + t.r, 0)
  const loss = -trades.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0)
  const equity = [1]
  let peak = 1
  let maxDD = 0
  trades.forEach((t) => {
    const e = equity[equity.length - 1] * (1 + (t.r * riskPct) / 100)
    equity.push(e)
    peak = Math.max(peak, e)
    maxDD = Math.max(maxDD, (peak - e) / peak)
  })
  const side = (s: Side) => {
    const ts = trades.filter((t) => t.side === s)
    return { n: ts.length, winRate: ts.length ? ts.filter((t) => t.r > 0).length / ts.length : 0 }
  }
  return {
    n,
    wins,
    winRate: n ? wins / n : 0,
    avgR: n ? trades.reduce((a, t) => a + t.r, 0) / n : 0,
    totalR: trades.reduce((a, t) => a + t.r, 0),
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0,
    maxDD,
    growth: equity[equity.length - 1] - 1,
    equity,
    long: side(1),
    short: side(-1),
    avgBars: n ? trades.reduce((a, t) => a + (t.bars ?? 0), 0) / n : 0,
  }
}

export interface BacktestOpts {
  sym: string
  strat: StratId
  bars: number
  minEV: number
  online: boolean
  trainFrac: number
  riskPct: number
  tpM?: number
  slM?: number
  maxHold?: number
  trend?: boolean
  edge?: number
}

export interface BacktestResult {
  opts: BacktestOpts
  st: Strat
  from: number
  to: number
  trainBars: number
  testBars: number
  trades: BtTrade[]
  stats: BtStats
  /** Buy-and-hold over the test window, for comparison. */
  hold: number
  ranAt: number
}

/** Pure: the caller fetches `STRATS[o.strat].tf` candles (see engine.backtest). */
export function runBacktest(o: BacktestOpts, cs: CandleFlat[]): BacktestResult {
  const base = STRATS[o.strat]
  const st: Strat = {
    ...base,
    tpM: o.tpM ?? base.tpM,
    slM: o.slM ?? base.slM,
    maxHold: o.maxHold ?? base.maxHold,
    trend: o.trend ?? base.trend,
    edge: o.edge ?? base.edge,
  }
  if (cs.length < 300) throw new Error('Only ' + cs.length + ' bars of history — need at least 300.')
  const S = series(cs)
  const rows = dataset(cs, S, st)
  const cut = Math.floor(cs.length * o.trainFrac)
  // Only rows whose outcomes were known before the test window opens.
  const trainRows = rows.filter((r) => Math.max(r.long.exitIdx, r.short.exitIdx) < cut)
  if (trainRows.length < 150) throw new Error('Not enough training rows (' + trainRows.length + ').')
  const m = trainPair(trainRows)
  const trades = simulate(cs, S, rows, cut, m, st, { minEV: o.minEV, online: o.online })
  const testStart = cs[cut]?.c ?? cs[0].c
  const testEnd = cs[cs.length - 1].c
  return {
    opts: o,
    st,
    from: cs[0].t,
    to: cs[cs.length - 1].t,
    trainBars: cut,
    testBars: cs.length - cut,
    trades,
    stats: stats(trades, o.riskPct),
    hold: testEnd / testStart - 1,
    ranAt: Date.now(),
  }
}
