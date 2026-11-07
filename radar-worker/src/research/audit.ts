// Strategy audit: the statistics behind scripts/audit.ts. Pure (tested in
// test/research-audit.test.ts). Every strategy is judged on the same terms:
//
//   costs      each trade re-priced from gross R under three profiles (both
//              legs market orders; the model's take-profit may rest as a
//              maker order under "moderate") plus the market's real funding
//   samples    trades are clustered by entry day, week and 30 days (a trend
//              trade held for weeks shares its move with entries days apart);
//              the mean's 95% range and t use the widest cluster-robust
//              (sandwich) error of the three, and `eff` is what the trades are
//              worth as independent ones at that grouping
//   periods    "dev" is the data a strategy was designed on, "holdout" what
//              came after; a strategy designed after the holdout was viewed
//              has no untouched period, and the report says so
//   regimes    BTC above / below its EMA(300) × calm / volatile (BTC's ATR %
//              against its own trailing year), read at the entry bar only
//   verdict    keep / watch / retire by fixed rules (VERDICT_RULES below),
//              never acted on automatically
import type { Bar } from '../bot/features.ts'

export interface CostProfile {
  id: 'moderate' | 'conservative' | 'stress'
  /** Per market leg: fee + slippage, as a fraction of price. */
  leg: number
  /** A take-profit resting as a maker order (model bracket trades only); null: market. */
  makerLeg: number | null
  fundingX: number
}

/** The same profiles as the website's Strategy ledger (liquidity-radar-react/src/features/selflearn/ledger.ts). */
export const PROFILES: CostProfile[] = [
  { id: 'moderate', leg: 0.0005 + 0.0002, makerLeg: 0.0002, fundingX: 1 },
  { id: 'conservative', leg: 0.0005 + 0.0005, makerLeg: null, fundingX: 1 },
  { id: 'stress', leg: 0.0005 + 0.0015, makerLeg: null, fundingX: 2 },
]

export interface AuditTrade {
  strategy: string
  symbol: string
  side: 1 | -1
  /** Entry time (the bar after the signal), ms. */
  t: number
  tExit: number
  entry: number
  exit: number
  /** Initial stop distance (1R). */
  dist: number
  /** Gross R. */
  r: number
  exitWhy: string
  /** Funding a long pays over the hold, in R (negative = paid), from the market's real rates. */
  fundLongR: number
  regime: string
}

/** Net R under a profile. */
export function netR(t: AuditTrade, p: CostProfile): number {
  const exitLeg = t.exitWhy === 'tp' && p.makerLeg != null ? p.makerLeg : p.leg
  const cost = (p.leg * t.entry + exitLeg * t.exit) / t.dist
  return t.r - cost + t.side * t.fundLongR * p.fundingX
}

export interface Summary {
  n: number
  /** Distinct entry days, and what the trades are worth as independent ones (at the most conservative grouping). */
  days: number
  eff: number
  /** The grouping that set the range: entry day, week or 30 days. */
  cluster: 'day' | 'week' | 'month' | null
  mean: number | null
  lo: number | null
  hi: number | null
  /** Cluster-robust t of the mean (null with fewer than MIN_DAYS days). */
  t: number | null
  win: number
  pf: number | null
  totalR: number
  maxDdR: number
}

/** Fewer clusters than this and no range or t is given: cluster-robust errors need clusters. */
export const MIN_DAYS = 10
const DAY = 86_400_000
const CLUSTERS: Array<[Summary['cluster'] & string, number]> = [['day', DAY], ['week', 7 * DAY], ['month', 30 * DAY]]

export function summarize(xs: Array<{ t: number; r: number }>): Summary {
  const n = xs.length
  if (!n) return { n: 0, days: 0, eff: 0, cluster: null, mean: null, lo: null, hi: null, t: null, win: 0, pf: null, totalR: 0, maxDdR: 0 }
  const s = [...xs].sort((a, b) => a.t - b.t)
  const mean = s.reduce((a, x) => a + x.r, 0) / n
  const naive = s.reduce((a, x) => a + (x.r - mean) ** 2, 0)
  let days = 0
  let eff = n
  let se: number | null = null
  let cluster: Summary['cluster'] = null
  for (const [name, width] of CLUSTERS) {
    const g = new Map<number, number>()
    for (const x of s) {
      const k = Math.floor(x.t / width)
      g.set(k, (g.get(k) ?? 0) + x.r - mean)
    }
    const G = g.size
    if (name === 'day') days = G
    let robust = 0
    for (const v of g.values()) robust += v * v
    // No range from too few clusters at any grouping: it would look more certain than it is.
    if (G < MIN_DAYS || !(robust > 0)) {
      if (name === 'day') eff = robust > 0 ? Math.max(1, Math.min(n, Math.round((n * naive) / robust))) : n
      continue
    }
    const e = Math.sqrt((robust / n ** 2) * (G / (G - 1)))
    if (se == null || e > se) {
      se = e
      cluster = name
      eff = Math.max(1, Math.min(n, Math.round((n * naive) / robust)))
    }
  }
  let cum = 0
  let peak = 0
  let maxDdR = 0
  let gw = 0
  let gl = 0
  for (const x of s) {
    cum += x.r
    peak = Math.max(peak, cum)
    maxDdR = Math.max(maxDdR, peak - cum)
    if (x.r > 0) gw += x.r
    else gl -= x.r
  }
  return {
    n,
    days,
    eff,
    cluster,
    mean,
    lo: se == null ? null : mean - 1.96 * se,
    hi: se == null ? null : mean + 1.96 * se,
    t: se ? mean / se : null,
    win: s.filter((x) => x.r > 0).length / n,
    pf: gl > 0 ? gw / gl : null,
    totalR: cum,
    maxDdR,
  }
}

/** Summaries by a key, keys sorted. */
export function breakdown<T extends { t: number }>(xs: T[], key: (x: T) => string, r: (x: T) => number): Record<string, Summary> {
  const m = new Map<string, Array<{ t: number; r: number }>>()
  for (const x of xs) {
    const k = key(x)
    const a = m.get(k)
    const v = { t: x.t, r: r(x) }
    if (a) a.push(v)
    else m.set(k, [v])
  }
  return Object.fromEntries([...m.keys()].sort().map((k) => [k, summarize(m.get(k)!)]))
}

// ---- BTC regime -----------------------------------------------------------------

/**
 * BTC's regime at each of its bars, from data up to that bar only: 'bull' /
 * 'bear' (close above / not above EMA(300)) and 'calm' / 'volatile' (ATR(14) %
 * of price above the median of its trailing 2190 bars, one year of 4h).
 * Bars before EMA warm-up are 'unknown'.
 */
export function btcRegimes(btc: Bar[], emaLen = 300, warm = 900, volWin = 2190): Map<number, string> {
  const out = new Map<number, string>()
  const k = 2 / (emaLen + 1)
  let ema = btc[0]?.c ?? 0
  let atr = 0
  const atrPct: number[] = []
  for (let i = 0; i < btc.length; i++) {
    const b = btc[i]
    ema = i === 0 ? b.c : b.c * k + ema * (1 - k)
    const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - btc[i - 1].c), Math.abs(b.l - btc[i - 1].c))
    atr = i < 14 ? (atr * i + tr) / (i + 1) : (atr * 13 + tr) / 14
    atrPct.push(atr / b.c)
    if (i < warm) {
      out.set(b.t, 'unknown')
      continue
    }
    const past = atrPct.slice(Math.max(0, i - volWin), i).sort((a, z) => a - z)
    const med = past[Math.floor(past.length / 2)]
    out.set(b.t, (b.c > ema ? 'bull' : 'bear') + '-' + (atrPct[i] > med ? 'volatile' : 'calm'))
  }
  return out
}

/** The regime in force when a trade entering at `t` was decided: BTC's bar that opened one step earlier. */
export function regimeAt(reg: Map<number, string>, t: number, stepMs: number): string {
  return reg.get(t - stepMs) ?? 'unknown'
}

// ---- verdict ----------------------------------------------------------------------

export const VERDICT_RULES = [
  'RETIRE candidate: the 95% range at conservative costs is entirely below zero over the whole history, or over the holdout once it holds 30+ independent trades.',
  'KEEP: the 95% range at conservative costs is entirely above zero, the holdout mean is positive, the stress-cost mean is positive, most years are positive, and (where tested) at least 60% of neighbouring parameter settings are positive too.',
  'WATCH: everything else — not proven either way. A short good run never upgrades a strategy.',
]

export interface VerdictInput {
  conservative: Summary
  stress: Summary
  holdout: Summary
  /** Mean R per calendar year (conservative). */
  years: Record<string, Summary>
  /** Share of neighbouring parameter sets with a positive conservative mean (null: not tested). */
  neighbours: number | null
}

export function verdict(v: VerdictInput): { verdict: 'keep' | 'watch' | 'retire'; why: string[] } {
  const why: string[] = []
  const c = v.conservative
  if (c.hi != null && c.hi < 0) return { verdict: 'retire', why: [`whole history at conservative costs: ${f(c.mean)} per trade, 95% range up to ${f(c.hi)} — below zero`] }
  if (v.holdout.eff >= 30 && v.holdout.hi != null && v.holdout.hi < 0) {
    return { verdict: 'retire', why: [`holdout: ${f(v.holdout.mean)} per trade over ${v.holdout.eff} independent trades, 95% range up to ${f(v.holdout.hi)}`] }
  }
  const ys = Object.values(v.years).filter((y) => y.n >= 5)
  const posYears = ys.filter((y) => (y.mean ?? 0) > 0).length
  const checks: Array<[boolean, string]> = [
    [c.lo != null && c.lo > 0, `whole history at conservative costs: ${f(c.mean)}, 95% range ${f(c.lo)} to ${f(c.hi)}`],
    [(v.holdout.mean ?? -1) > 0, `holdout: ${f(v.holdout.mean)} over ${v.holdout.n} trades (${v.holdout.eff} independent)`],
    [(v.stress.mean ?? -1) > 0, `stress costs: ${f(v.stress.mean)}`],
    [ys.length > 0 && posYears > ys.length / 2, `${posYears} of ${ys.length} years positive`],
    [v.neighbours == null || v.neighbours >= 0.6, v.neighbours == null ? 'parameter neighbours not tested' : `${Math.round(v.neighbours * 100)}% of neighbouring settings positive`],
  ]
  for (const [ok, msg] of checks) why.push((ok ? '✓ ' : '✗ ') + msg)
  return { verdict: checks.every(([ok]) => ok) ? 'keep' : 'watch', why }
}

const f = (x: number | null) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(3) + 'R')
