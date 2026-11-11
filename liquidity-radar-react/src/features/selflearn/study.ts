// The strategy study (radar-worker/scripts/study.ts, bot_state 'study:latest')
// and the news reaction study (scripts/news-study.ts, bot_state 'news:study')
// with N1's paper record (news_signals). Pure (tested in
// scripts/test-engines.mjs): turns the stored values into what the "Strategy
// study" and "News reaction study" cards show; unusable parts are dropped.

export interface StudySummary {
  n: number
  eff: number
  mean: number | null
  lo: number | null
  hi: number | null
  win: number
  pf: number | null
  maxDdR: number
}

export interface Paired {
  mean: number | null
  lo: number | null
  hi: number | null
  better: boolean
  worse: boolean
}

export interface StudyView {
  generatedAt: number
  from: number | null
  to: number | null
  markets: number
  filters: {
    covered: number
    from: number | null
    variants: Array<{ id: string; label: string; taken: StudySummary; rejected: StudySummary; falsePositives: number; missed: number; helps: boolean; holdout: StudySummary }>
  }
  exits: Array<{
    id: string
    kind: string
    n: number
    all: StudySummary
    vsA: Paired | null
    vsADesign: Paired | null
    vsAHoldout: Paired | null
    giveback: { avgMfeR: number; avgGivebackR: number; reached1R: number; reached1RLost: number }
    exits: Array<[string, number]>
  }>
  regimes: { share: Array<[string, number]>; strategies: Array<{ id: string; cells: Array<[string, StudySummary]> }> }
  correlation: Array<{ symbol: string; windows: number; median: number | null; p10: number | null; p90: number | null; strongShare: number; changedShare: number; decoupledShare: number; beta: number | null; downBeta: number | null }>
  live: {
    strategies: Array<{ strategy: string; n: number; candles: number; days: number; byTrade: StudySummary; byCandle: StudySummary }>
    real: Array<{ id: number; symbol: string; strategy: string; exit: string; mfeR: number; maeR: number | null; r: number }>
  } | null
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const parse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

export const REGIME_ORDER = ['strong-bull', 'weak-bull', 'sideways', 'weak-bear', 'strong-bear', 'high-volatility', 'uncertain']

export function summary(v: unknown): StudySummary {
  const x = obj(v) ?? {}
  return { n: num(x.n) ?? 0, eff: num(x.eff) ?? 0, mean: num(x.mean), lo: num(x.lo), hi: num(x.hi), win: num(x.win) ?? 0, pf: num(x.pf), maxDdR: num(x.maxDdR) ?? 0 }
}

function paired(v: unknown): Paired | null {
  const x = obj(v)
  return x ? { mean: num(x.mean), lo: num(x.lo), hi: num(x.hi), better: x.better === true, worse: x.worse === true } : null
}

/** bot_state 'study:latest' → view; null when it is not a study report. */
export function normalizeStudy(value: unknown): StudyView | null {
  const v = obj(parse(value))
  const f = obj(v?.filters)
  if (!v || !f || !Array.isArray(v.exits)) return null
  const data = obj(v.data) ?? {}
  const variants = arr(f.variants)
    .map(obj)
    .filter((x): x is Raw => !!x && typeof x.id === 'string')
    .map((x) => {
      const all = obj(x.all) ?? {}
      return {
        id: String(x.id),
        label: typeof x.label === 'string' ? x.label : String(x.id),
        taken: summary(all.taken),
        rejected: summary(all.rejected),
        falsePositives: num(all.falsePositives) ?? 0,
        missed: num(all.missed) ?? 0,
        helps: all.helps === true,
        holdout: summary(obj(x.holdout)?.taken),
      }
    })
  const exits = arr(v.exits)
    .map(obj)
    .filter((x): x is Raw => !!x && typeof x.id === 'string')
    .map((x) => {
      const g = obj(x.giveback) ?? {}
      return {
        id: String(x.id),
        kind: String(x.kind ?? ''),
        n: num(x.n) ?? 0,
        all: summary(x.all),
        vsA: paired(x.vsA),
        vsADesign: paired(x.vsADesign),
        vsAHoldout: paired(x.vsAHoldout),
        giveback: { avgMfeR: num(g.avgMfeR) ?? 0, avgGivebackR: num(g.avgGivebackR) ?? 0, reached1R: num(g.reached1R) ?? 0, reached1RLost: num(g.reached1RLost) ?? 0 },
        exits: Object.entries(obj(x.exits) ?? {}).filter(([, n]) => num(n) != null).map(([k, n]) => [k, Number(n)] as [string, number]).sort((a, b) => b[1] - a[1]),
      }
    })
  const rg = obj(v.regimes) ?? {}
  const share = Object.entries(obj(rg.share) ?? {}).filter(([, x]) => num(x) != null).map(([k, x]) => [k, Number(x)] as [string, number])
  const order = (k: string) => (REGIME_ORDER.indexOf(k) + 1 || 99)
  share.sort((a, b) => order(a[0]) - order(b[0]))
  const strategies = arr(rg.strategies)
    .map(obj)
    .filter((x): x is Raw => !!x && typeof x.id === 'string')
    .map((x) => ({ id: String(x.id), cells: Object.entries(obj(x.regimes) ?? {}).map(([k, s]) => [k, summary(s)] as [string, StudySummary]).sort((a, b) => order(a[0]) - order(b[0])) }))
  const correlation = arr(v.correlation)
    .map(obj)
    .filter((x): x is Raw => !!x && typeof x.symbol === 'string')
    .map((x) => ({
      symbol: String(x.symbol),
      windows: num(x.windows) ?? 0,
      median: num(x.median),
      p10: num(x.p10),
      p90: num(x.p90),
      strongShare: num(x.strongShare) ?? 0,
      changedShare: num(x.changedShare) ?? 0,
      decoupledShare: num(x.decoupledShare) ?? 0,
      beta: num(x.beta),
      downBeta: num(x.downBeta),
    }))
  const lv = obj(v.live)
  const live = lv
    ? {
        strategies: arr(lv.strategies)
          .map(obj)
          .filter((x): x is Raw => !!x && typeof x.strategy === 'string')
          .map((x) => ({ strategy: String(x.strategy), n: num(x.n) ?? 0, candles: num(x.candles) ?? 0, days: num(x.days) ?? 0, byTrade: summary(x.byTrade), byCandle: summary(x.byCandle) })),
        real: arr(lv.real)
          .map(obj)
          .filter((x): x is Raw => !!x && num(x.id) != null && num(x.mfe_r) != null && num(x.r) != null)
          .map((x) => ({ id: Number(x.id), symbol: String(x.symbol ?? ''), strategy: String(x.strategy ?? ''), exit: String(x.exit_reason ?? ''), mfeR: Number(x.mfe_r), maeR: num(x.mae_r), r: Number(x.r) })),
      }
    : null
  return {
    generatedAt: num(v.generatedAt) ?? 0,
    from: num(data.from),
    to: num(data.to),
    markets: num(data.markets) ?? 0,
    filters: { covered: num(f.covered) ?? 0, from: num(f.from), variants },
    exits,
    regimes: { share, strategies },
    correlation,
    live,
  }
}

/** A trade's profit given back: best point minus result (never negative). */
export const givenBack = (t: { mfeR: number; r: number }) => Math.max(0, t.mfeR - t.r)

export interface NewsStudyView {
  generatedAt: number
  releases: number
  evaluated: number
  rejected: number
  chosen: string
  liveMode: string
  minZ: number
  grid: Array<{ mode: string; minZ: number; design: StudySummary; test: StudySummary }>
  base: StudySummary
  groups: Array<{ group: string; key: string; s: StudySummary }>
}

/** bot_state 'news:study' → view; null when it is not a news study. */
export function normalizeNewsStudy(value: unknown): NewsStudyView | null {
  const v = obj(parse(value))
  if (!v || !Array.isArray(v.grid)) return null
  const groups: NewsStudyView['groups'] = []
  for (const [group, key] of [['category', 'byCategory'], ['asset', 'byAsset'], ['regime', 'byRegime']] as const) {
    for (const [k, s] of Object.entries(obj(v[key]) ?? {})) groups.push({ group, key: k, s: summary(s) })
  }
  return {
    generatedAt: num(v.generatedAt) ?? 0,
    releases: num(v.releases) ?? 0,
    evaluated: num(v.evaluated) ?? 0,
    rejected: num(v.rejected) ?? 0,
    chosen: String(v.chosen ?? ''),
    liveMode: String(v.liveMode ?? ''),
    minZ: num(obj(v.rule)?.minZ) ?? 2,
    grid: arr(v.grid)
      .map(obj)
      .filter((x): x is Raw => !!x && typeof x.mode === 'string' && num(x.minZ) != null)
      .map((x) => ({ mode: String(x.mode), minZ: Number(x.minZ), design: summary(x.design), test: summary(x.test) })),
    base: summary(v.base),
    groups,
  }
}

export interface NewsSignal {
  t: number
  asset: string
  category: string
  side: -1 | 0 | 1
  reason: string
  z60: number | null
  netPct: number | null
}

/** news_signals rows → N1's paper record, newest first; rows missing a time or side are dropped. */
export function normalizeSignals(rows: unknown): NewsSignal[] {
  return arr(rows)
    .map(obj)
    .filter((x): x is Raw => !!x && Number.isFinite(Date.parse(String(x.event_time))) && [-1, 0, 1].includes(Number(x.side)))
    .map((x) => ({ t: Date.parse(String(x.event_time)), asset: String(x.asset ?? ''), category: String(x.category ?? ''), side: Number(x.side) as -1 | 0 | 1, reason: String(x.reason ?? ''), z60: num(x.z60), netPct: num(x.net_pct) }))
    .sort((a, b) => b.t - a.t)
}
