// The bot's daily and weekly intelligence reports (radar-worker/src/research/
// report.ts; bot_state 'report:daily' = latest + 60 days, 'report:weekly').
// Pure (tested in scripts/test-engines.mjs); unusable parts are dropped.

export interface DayReport {
  day: string
  events: Array<{ time: number; category: string; title: string; surprise: number | null; btc1h: { ret: number; z: number | null } | null; gold1h: { ret: number; z: number | null } | null }>
  regime: { start: string | null; end: string | null; changes: number; snapshots: number }
  btc: string | null
  gold: string | null
  corrChanges: number
  strategies: Array<{ strategy: string; n: number; real: number; wins: number; sumR: number; avgR: number | null }>
  model: { n: number; meanP: number | null; winRate: number | null; brier: number | null }
  news: { trades: number; sumR: number; wins: number }
  wins: number
  losses: number
  errors: { count: number; top: Array<{ msg: string; n: number }> }
  anomalies: string[]
  investigate: string[]
}

export interface WeekReport {
  from: string
  to: string
  days: number
  previous: { from: string; to: string; days: number } | null
  strategies: Array<{ strategy: string; n: number; sumR: number; avgR: number | null; prevN: number; prevSumR: number; prevAvgR: number | null }>
  model: { n: number; brier: number | null; prevN: number; prevBrier: number | null }
  regimes: Array<[string, number]>
  events: number
  errors: number
  anomalies: number
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string')
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const rx = (v: unknown) => {
  const x = obj(v)
  const ret = num(x.ret)
  return ret == null ? null : { ret, z: num(x.z) }
}

export function normalizeDay(v: unknown): DayReport | null {
  const x = obj(v)
  if (typeof x.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) return null
  const rg = obj(x.regime)
  const m = obj(x.model)
  const nw = obj(x.news)
  const er = obj(x.errors)
  return {
    day: x.day,
    events: arr(x.events).map(obj).filter((e) => num(e.time) != null && typeof e.title === 'string').map((e) => ({ time: Number(e.time), category: String(e.category ?? ''), title: String(e.title), surprise: num(e.surprise), btc1h: rx(e.btc1h), gold1h: rx(e.gold1h) })),
    regime: { start: str(rg.start), end: str(rg.end), changes: num(rg.changes) ?? 0, snapshots: num(rg.snapshots) ?? 0 },
    btc: str(x.btc),
    gold: str(x.gold),
    corrChanges: arr(x.corrChanges).length,
    strategies: arr(x.strategies).map(obj).filter((s) => typeof s.strategy === 'string').map((s) => ({ strategy: String(s.strategy), n: num(s.n) ?? 0, real: num(s.real) ?? 0, wins: num(s.wins) ?? 0, sumR: num(s.sumR) ?? 0, avgR: num(s.avgR) })),
    model: { n: num(m.n) ?? 0, meanP: num(m.meanP), winRate: num(m.winRate), brier: num(m.brier) },
    news: { trades: num(nw.trades) ?? 0, sumR: num(nw.sumR) ?? 0, wins: num(nw.wins) ?? 0 },
    wins: num(x.wins) ?? 0,
    losses: num(x.losses) ?? 0,
    errors: { count: num(er.count) ?? 0, top: arr(er.top).map(obj).filter((t) => typeof t.msg === 'string').map((t) => ({ msg: String(t.msg), n: num(t.n) ?? 0 })) },
    anomalies: strs(x.anomalies),
    investigate: strs(x.investigate),
  }
}

/** bot_state 'report:daily' → reports, newest first. */
export function normalizeDaily(value: unknown): DayReport[] {
  const v = obj(typeof value === 'string' ? safeParse(value) : value)
  const all = [...arr(v.history), v.latest].map(normalizeDay).filter((d): d is DayReport => !!d)
  const by = new Map(all.map((d) => [d.day, d]))
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day))
}

export function normalizeWeekly(value: unknown): WeekReport | null {
  const v = obj(typeof value === 'string' ? safeParse(value) : value)
  const w = obj(v.week)
  if (typeof w.from !== 'string' || typeof w.to !== 'string') return null
  const p = obj(v.previous)
  const m = obj(v.model)
  return {
    from: w.from,
    to: w.to,
    days: num(w.days) ?? 0,
    previous: typeof p.from === 'string' && typeof p.to === 'string' ? { from: p.from, to: p.to, days: num(p.days) ?? 0 } : null,
    strategies: arr(v.strategies).map(obj).filter((s) => typeof s.strategy === 'string').map((s) => ({ strategy: String(s.strategy), n: num(s.n) ?? 0, sumR: num(s.sumR) ?? 0, avgR: num(s.avgR), prevN: num(s.prevN) ?? 0, prevSumR: num(s.prevSumR) ?? 0, prevAvgR: num(s.prevAvgR) })),
    model: { n: num(m.n) ?? 0, brier: num(m.brier), prevN: num(m.prevN) ?? 0, prevBrier: num(m.prevBrier) },
    regimes: Object.entries(obj(v.regimes)).filter(([, n]) => num(n) != null).map(([k, n]): [string, number] => [k, Number(n)]).sort((a, b) => b[1] - a[1]),
    events: num(v.events) ?? 0,
    errors: num(v.errors) ?? 0,
    anomalies: num(v.anomalies) ?? 0,
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
