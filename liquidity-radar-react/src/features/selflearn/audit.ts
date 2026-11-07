// The strategy audit (radar-worker/scripts/audit.ts, stored in bot_state
// 'audit:latest'): every strategy re-run on each market's whole 4h history,
// re-priced under three cost profiles and judged keep / watch / retire by
// fixed rules. Pure (tested in scripts/test-engines.mjs): turns the stored
// value into what the "Strategy audit" card shows; unusable parts are dropped.

export interface AuditSummary {
  n: number
  eff: number
  mean: number | null
  lo: number | null
  hi: number | null
  pf: number | null
  maxDdR: number
}

export interface AuditStrategy {
  id: string
  name: string
  verdict: 'keep' | 'watch' | 'retire'
  why: string[]
  flags: string[]
  trades: number
  markets: number
  marketsPositive: number
  profiles: { moderate: AuditSummary; conservative: AuditSummary; stress: AuditSummary }
  dev: AuditSummary
  holdout: AuditSummary
  holdoutSeen: boolean
  live: AuditSummary
  years: Array<[string, AuditSummary]>
  regimes: Array<[string, AuditSummary]>
  neighbours: number | null
  costPerTrade: number | null
  replication: { matched: number; backtestOnly: number; liveOnly: number } | null
}

export interface AuditReport {
  generatedAt: number
  from: number | null
  to: number | null
  markets: number
  rules: string[]
  strategies: AuditStrategy[]
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function summary(v: unknown): AuditSummary {
  const x = obj(v) ?? {}
  return { n: num(x.n) ?? 0, eff: num(x.eff) ?? 0, mean: num(x.mean), lo: num(x.lo), hi: num(x.hi), pf: num(x.pf), maxDdR: num(x.maxDdR) ?? 0 }
}

const entries = (v: unknown): Array<[string, AuditSummary]> => Object.entries(obj(v) ?? {}).map(([k, s]) => [k, summary(s)])
const VERDICTS = ['keep', 'watch', 'retire'] as const

/** bot_state value → report; null when it is not an audit report. */
export function normalizeAudit(value: unknown): AuditReport | null {
  const v = obj(typeof value === 'string' ? safeParse(value) : value)
  if (!v || !Array.isArray(v.strategies)) return null
  const data = obj(v.data) ?? {}
  const strategies: AuditStrategy[] = []
  for (const s of v.strategies) {
    const x = obj(s)
    if (!x || typeof x.id !== 'string' || !VERDICTS.includes(x.verdict as AuditStrategy['verdict'])) continue
    const p = obj(x.profiles) ?? {}
    const rep = obj(x.replication)
    strategies.push({
      id: x.id,
      name: typeof x.name === 'string' ? x.name : x.id.toUpperCase(),
      verdict: x.verdict as AuditStrategy['verdict'],
      why: strs(x.why),
      flags: strs(x.flags),
      trades: num(x.trades) ?? 0,
      markets: num(x.markets) ?? 0,
      marketsPositive: num(x.marketsPositive) ?? 0,
      profiles: { moderate: summary(p.moderate), conservative: summary(p.conservative), stress: summary(p.stress) },
      dev: summary(x.dev),
      holdout: summary(x.holdout),
      holdoutSeen: x.holdoutSeen !== false,
      live: summary(x.live),
      years: entries(x.years),
      regimes: entries(x.regimes).filter(([k]) => k !== 'unknown'),
      neighbours: num(x.neighbours),
      costPerTrade: num(x.costPerTrade),
      replication: rep ? { matched: num(rep.matched) ?? 0, backtestOnly: num(rep.backtestOnly) ?? 0, liveOnly: num(rep.liveOnly) ?? 0 } : null,
    })
  }
  return {
    generatedAt: num(v.generatedAt) ?? 0,
    from: num(data.from),
    to: num(data.to),
    markets: num(data.markets) ?? 0,
    rules: strs(v.rules),
    strategies,
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
