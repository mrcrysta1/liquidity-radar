// Strategy ledger: every strategy's closed real and paper trades as its own
// virtual portfolio, with the costs taken apart (fees, slippage, funding) and
// every trade re-scored under three cost profiles, so a strategy that only
// works with cheap fills shows it. Pure (tested in scripts/test-engines.mjs);
// serverBot.ts loadLedger fetches the rows and the funding history.
//
// Gross R is the price move over the initial stop distance (1R). Each profile
// charges both legs and the funding over the holding period:
//   moderate      the bot's own assumption (walkforward.ts): taker 0.05% +
//                 slippage 0.02% per market leg; the model's take-profit
//                 rests as a maker order (0.02%)
//   conservative  taker 0.05% + slippage 0.05% on both legs, no maker fills
//   stress        taker 0.05% + slippage 0.15% on both legs, funding × 2
// Funding is the market's real 8-hourly rate when known (a long pays a
// positive rate, a short receives it), else 0.01% per 8 h (the research
// default), and the share of trades with real funding is reported.
import { clustered } from './onTrack.ts'

export interface LedgerTrade {
  strategy: string
  kind: 'real' | 'shadow'
  symbol: string
  side: 1 | -1
  entry: number
  exit: number
  /** Initial stop distance (1R) in price. */
  dist: number
  /** Decision candle open, ms. */
  bar: number
  openedAt: number
  closedAt: number
  exitReason: string | null
  /** R after costs as the bot recorded it. */
  rRecorded: number
  /** Real trades only: exchange fees and the money at risk (USD), entry slippage (bps). */
  feesUsd?: number | null
  riskUsd?: number | null
  slippageBps?: number | null
}

export interface Funding {
  t: number
  rate: number
}

export interface CostProfile {
  id: 'moderate' | 'conservative' | 'stress'
  label: string
  taker: number
  slip: number
  /** Maker fee for a model take-profit (null: take-profits fill as taker). */
  tpMaker: number | null
  fundingX: number
}

export const PROFILES: CostProfile[] = [
  { id: 'moderate', label: 'Moderate', taker: 0.0005, slip: 0.0002, tpMaker: 0.0002, fundingX: 1 },
  { id: 'conservative', label: 'Conservative', taker: 0.0005, slip: 0.0005, tpMaker: null, fundingX: 1 },
  { id: 'stress', label: 'Stress', taker: 0.0005, slip: 0.0015, tpMaker: null, fundingX: 2 },
]
export const DEFAULT_FUNDING_8H = 0.0001
const H8 = 8 * 3_600_000
/** Virtual portfolio: $10,000, 0.75% of it risked per trade (F1's risk), no compounding. */
export const LEDGER_EQUITY = 10_000
export const LEDGER_RISK = 0.0075

export interface Perf {
  n: number
  win: number
  avgR: number | null
  totalR: number
  pf: number | null
  maxDdR: number
}

export interface StrategyLedger {
  id: string
  real: number
  shadow: number
  /** As the bot recorded it. */
  recorded: Perf
  /** Independent decisions (same candle grouped). */
  eff: number
  candles: number
  long: Perf
  short: Perf
  /** Average cost per trade in R under the moderate profile, taken apart; funding is signed (+ = paid). */
  costs: { feeR: number; slipR: number; fundingR: number }
  /** Real trades only: what the exchange actually charged, per trade in R (null without real trades). */
  actual: { feeR: number | null; slipR: number | null }
  /** Trades whose funding came from the market's real rates. */
  fundingKnown: number
  profiles: Record<CostProfile['id'], Perf & { usd: number }>
}

export function perf(rs: number[]): Perf {
  const n = rs.length
  let cum = 0
  let peak = 0
  let maxDdR = 0
  let gw = 0
  let gl = 0
  for (const r of rs) {
    cum += r
    peak = Math.max(peak, cum)
    maxDdR = Math.max(maxDdR, peak - cum)
    if (r > 0) gw += r
    else gl -= r
  }
  return { n, win: n ? rs.filter((r) => r > 0).length / n : 0, avgR: n ? cum / n : null, totalR: cum, pf: gl > 0 ? gw / gl : null, maxDdR }
}

/** Funding settlements of a market in (t0, t1]: the sum of rates, and whether real rates covered the period. */
export function fundingSum(fund: Funding[] | undefined, t0: number, t1: number): { sum: number; known: boolean } {
  // Real rates only when the history spans the hold (settlements every 8 h).
  if (!fund || !fund.length || fund[0].t > t0 + H8 || fund[fund.length - 1].t < t1 - H8) {
    return { sum: (DEFAULT_FUNDING_8H * Math.max(0, t1 - t0)) / H8, known: false }
  }
  let sum = 0
  for (const f of fund) if (f.t > t0 && f.t <= t1) sum += f.rate
  return { sum, known: true }
}

/**
 * One trade's cost in R under a profile: fees, slippage and funding (positive
 * = cost). A real trade's entry and exit are its fills, so their slippage is
 * already in the price: no modelled slippage on top.
 */
export function tradeCost(t: LedgerTrade, p: CostProfile, fund: Funding[] | undefined): { feeR: number; slipR: number; fundingR: number; known: boolean } {
  const perR = t.entry / t.dist
  const makerExit = p.tpMaker != null && t.exitReason === 'tp'
  const feeR = (p.taker + (makerExit ? p.tpMaker! : p.taker)) * perR
  const slipR = t.kind === 'real' ? 0 : (p.slip + (makerExit ? 0 : p.slip)) * perR
  const f = fundingSum(fund, t.openedAt, t.closedAt)
  return { feeR, slipR, fundingR: t.side * f.sum * perR * p.fundingX, known: f.known }
}

export const grossR = (t: LedgerTrade): number => (t.side * (t.exit - t.entry)) / t.dist

/** Every strategy's ledger, ordered by id. `funding` by symbol (missing: the default rate). */
export function buildLedger(trades: LedgerTrade[], funding: Record<string, Funding[] | undefined>): StrategyLedger[] {
  const by = new Map<string, LedgerTrade[]>()
  for (const t of trades) {
    if (!(t.dist > 0) || ![t.entry, t.exit, t.rRecorded, t.closedAt].every(Number.isFinite)) continue
    const g = by.get(t.strategy)
    if (g) g.push(t)
    else by.set(t.strategy, [t])
  }
  const out: StrategyLedger[] = []
  for (const [id, raw] of by) {
    const ts = [...raw].sort((a, b) => a.closedAt - b.closedAt)
    const cl = clustered(ts.map((t) => ({ p: 0, r: t.rRecorded, t: t.bar, bar: t.bar })), (x) => x.r)
    const mod = ts.map((t) => tradeCost(t, PROFILES[0], funding[t.symbol]))
    const real = ts.filter((t) => t.kind === 'real')
    const fees = real.filter((t) => t.feesUsd != null && t.riskUsd != null && t.riskUsd > 0)
    const slips = real.filter((t) => t.slippageBps != null)
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0)
    const profiles = {} as StrategyLedger['profiles']
    for (const p of PROFILES) {
      const rs = ts.map((t) => {
        const c = tradeCost(t, p, funding[t.symbol])
        return grossR(t) - c.feeR - c.slipR - c.fundingR
      })
      const pr = perf(rs)
      profiles[p.id] = { ...pr, usd: pr.totalR * LEDGER_EQUITY * LEDGER_RISK }
    }
    out.push({
      id,
      real: real.length,
      shadow: ts.length - real.length,
      recorded: perf(ts.map((t) => t.rRecorded)),
      eff: cl.eff,
      candles: cl.bars,
      long: perf(ts.filter((t) => t.side > 0).map((t) => t.rRecorded)),
      short: perf(ts.filter((t) => t.side < 0).map((t) => t.rRecorded)),
      costs: { feeR: avg(mod.map((c) => c.feeR)), slipR: avg(mod.map((c) => c.slipR)), fundingR: avg(mod.map((c) => c.fundingR)) },
      actual: {
        feeR: fees.length ? avg(fees.map((t) => t.feesUsd! / t.riskUsd!)) : null,
        // Entry slippage as recorded (positive = paid), in R.
        slipR: slips.length ? avg(slips.map((t) => (t.slippageBps! / 1e4) * (t.entry / t.dist))) : null,
      },
      fundingKnown: mod.filter((c) => c.known).length,
      profiles,
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const ms = (v: unknown): number | null => (typeof v === 'string' || typeof v === 'number' ? (Number.isFinite(Date.parse(String(v))) ? Date.parse(String(v)) : null) : null)
const STEP_4H = 4 * 3_600_000
const STEP: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': STEP_4H }

/** bot_trades rows (closed) → ledger trades; rows missing a price, stop or result are dropped. */
export function fromReal(rows: Raw[]): LedgerTrade[] {
  const out: LedgerTrade[] = []
  for (const x of rows) {
    const entry = num(x.entry)
    const exit = num(x.exit)
    const stop = num(x.initial_sl) ?? num(x.planned_sl) ?? num(x.sl)
    const r = num(x.r_multiple)
    const opened = ms(x.opened_at)
    const closed = ms(x.closed_at)
    if (entry == null || exit == null || stop == null || r == null || opened == null || closed == null) continue
    out.push({
      strategy: typeof x.strategy === 'string' && x.strategy ? x.strategy : x.mode === 'trend' ? 'f1' : 'ml',
      kind: 'real',
      symbol: String(x.symbol ?? ''),
      side: Number(x.side) > 0 ? 1 : -1,
      entry,
      exit,
      dist: Math.abs(entry - stop),
      bar: ms(x.bar_time) ?? opened - STEP_4H,
      openedAt: opened,
      closedAt: closed,
      exitReason: typeof x.exit_reason === 'string' ? x.exit_reason : null,
      rRecorded: r,
      feesUsd: num(x.fees_usd),
      riskUsd: num(x.risk_usd),
      slippageBps: num(x.slippage_bps),
    })
  }
  return out
}

/** bot_shadow_trades rows (closed) → ledger trades. A shadow enters at its decision candle's close. */
export function fromShadow(rows: Raw[]): LedgerTrade[] {
  const out: LedgerTrade[] = []
  for (const x of rows) {
    const entry = num(x.entry)
    const exit = num(x.exit)
    const sl = num(x.sl)
    const r = num(x.r_net)
    const bar = ms(x.bar_time)
    const closed = ms(x.closed_at)
    if (entry == null || exit == null || sl == null || r == null || bar == null || closed == null) continue
    out.push({
      strategy: typeof x.strategy === 'string' && x.strategy ? x.strategy : 'ml',
      kind: 'shadow',
      symbol: String(x.symbol ?? ''),
      side: Number(x.side) > 0 ? 1 : -1,
      entry,
      exit,
      dist: Math.abs(entry - sl),
      bar,
      openedAt: bar + (STEP[String(x.interval)] ?? STEP_4H),
      closedAt: closed,
      exitReason: typeof x.exit_reason === 'string' ? x.exit_reason : null,
      rRecorded: r,
    })
  }
  return out
}
