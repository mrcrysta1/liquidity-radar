// Daily and weekly intelligence reports (research plan P7): what happened in
// the news and the market, how every strategy and the model did, what went
// wrong, and what deserves a look. buildDaily / buildWeekly / formatDaily are
// pure (tested in test/research-report.test.ts); loadDay reads the bot's
// tables; reportTick runs once per UTC day for the day that just ended, in the
// background, into bot_state 'report:daily' (latest + 60 days) and
// 'report:weekly', and sends a short text to BOT_ALERT_WEBHOOK when set.
// Numbers only describe; nothing here changes how the bot trades.
import type { Db } from '../db.ts'
import type { BotStore } from '../bot/store.ts'
import type { Alerts } from '../bot/alerts.ts'

const DAY = 86_400_000

export interface DayInput {
  day: string
  events: Array<{ time: number; category: string; title: string; surprise: number | null; btc1h: { ret: number; z: number | null } | null; gold1h: { ret: number; z: number | null } | null }>
  /** market_context rows of the day, oldest first. */
  context: Array<{ time: number; regime: string; btcDir: string | null; goldDir: string | null }>
  /** Correlation changes in the latest snapshot. */
  corrChanges: Array<{ symbol: string; tf: string; from: number; to: number }>
  /** Closed trades of the day (by close time). */
  trades: Array<{ strategy: string; kind: 'real' | 'shadow'; symbol: string; side: 1 | -1; entryTime: number; r: number; exit: string | null; p: number | null }>
  /** Strategy state changes logged that day. */
  transitions: string[]
  errors: Array<{ symbol: string | null; msg: string }>
}

export interface StratDay {
  strategy: string
  n: number
  real: number
  wins: number
  sumR: number
  avgR: number | null
  worst: number | null
}

export interface DailyReport {
  v: 1
  day: string
  events: DayInput['events']
  regime: { start: string | null; end: string | null; changes: number; snapshots: number }
  btc: string | null
  gold: string | null
  corrChanges: DayInput['corrChanges']
  strategies: StratDay[]
  model: { n: number; meanP: number | null; winRate: number | null; brier: number | null }
  news: { trades: number; sumR: number; wins: number }
  wins: number
  losses: number
  transitions: string[]
  errors: { count: number; top: Array<{ msg: string; n: number }> }
  anomalies: string[]
  investigate: string[]
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function buildDaily(i: DayInput): DailyReport {
  const by = new Map<string, DayInput['trades']>()
  for (const t of i.trades) {
    const a = by.get(t.strategy)
    if (a) a.push(t)
    else by.set(t.strategy, [t])
  }
  const strategies: StratDay[] = [...by.entries()]
    .map(([strategy, ts]) => ({
      strategy,
      n: ts.length,
      real: ts.filter((t) => t.kind === 'real').length,
      wins: ts.filter((t) => t.r > 0).length,
      sumR: ts.reduce((a, t) => a + t.r, 0),
      avgR: avg(ts.map((t) => t.r)),
      worst: ts.length ? Math.min(...ts.map((t) => t.r)) : null,
    }))
    .sort((a, b) => a.strategy.localeCompare(b.strategy))
  const model = i.trades.filter((t) => t.p != null)
  const brier = avg(model.map((t) => (t.p! - (t.r > 0 ? 1 : 0)) ** 2))
  const newsTrades = i.trades.filter((t) => i.events.some((e) => t.entryTime >= e.time && t.entryTime <= e.time + 4 * 3_600_000))
  let changes = 0
  for (let k = 1; k < i.context.length; k++) if (i.context[k].regime !== i.context[k - 1].regime) changes++
  const errCount = new Map<string, number>()
  for (const e of i.errors) {
    const k = e.msg.replace(/\d+(\.\d+)?/g, '#').slice(0, 120)
    errCount.set(k, (errCount.get(k) ?? 0) + 1)
  }
  const top = [...errCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([msg, n]) => ({ msg, n }))
  const anomalies: string[] = []
  const bigStops = i.trades.filter((t) => t.exit === 'sl' && t.r < -1.3)
  if (bigStops.length) anomalies.push(`${bigStops.length} stop-out${bigStops.length > 1 ? 's' : ''} cost more than 1.3R (worst ${Math.min(...bigStops.map((t) => t.r)).toFixed(2)}R): slippage or a gap`)
  if (i.context.length < 5) anomalies.push(`only ${i.context.length} of 6 market-context snapshots recorded: the bot may have been down`)
  for (const s of strategies) if (s.n >= 5 && s.wins === 0) anomalies.push(`${s.strategy.toUpperCase()} lost all ${s.n} trades — likely one market move (check the independent count)`)
  if (i.errors.length >= 20) anomalies.push(`${i.errors.length} errors logged`)
  const investigate: string[] = []
  if (model.length >= 20 && brier != null) {
    const mp = avg(model.map((t) => t.p!))!
    const wr = model.filter((t) => t.r > 0).length / model.length
    if (Math.abs(mp - wr) > 0.15) investigate.push(`model said ${Math.round(mp * 100)}% on average, won ${Math.round(wr * 100)}% (${model.length} outcomes, mostly one day's move)`)
  }
  if (i.corrChanges.length >= 5) investigate.push(`${i.corrChanges.length} correlations with BTC changed significantly: the market is moving ${i.corrChanges.filter((c) => c.to > c.from).length > i.corrChanges.length / 2 ? 'more' : 'less'} together`)
  for (const e of i.events) if (e.btc1h?.z != null && Math.abs(e.btc1h.z) >= 3) investigate.push(`${e.title}: BTC moved ${e.btc1h.ret.toFixed(2)}% (${e.btc1h.z.toFixed(1)}σ) in the hour after`)
  if (i.transitions.length) investigate.push(...i.transitions.map((t) => 'state change: ' + t))
  return {
    v: 1,
    day: i.day,
    events: i.events,
    regime: { start: i.context[0]?.regime ?? null, end: i.context.at(-1)?.regime ?? null, changes, snapshots: i.context.length },
    btc: i.context.at(-1)?.btcDir ?? null,
    gold: i.context.at(-1)?.goldDir ?? null,
    corrChanges: i.corrChanges,
    strategies,
    model: { n: model.length, meanP: avg(model.map((t) => t.p!)), winRate: model.length ? model.filter((t) => t.r > 0).length / model.length : null, brier },
    news: { trades: newsTrades.length, sumR: newsTrades.reduce((a, t) => a + t.r, 0), wins: newsTrades.filter((t) => t.r > 0).length },
    wins: i.trades.filter((t) => t.r > 0).length,
    losses: i.trades.filter((t) => t.r <= 0).length,
    transitions: i.transitions,
    errors: { count: i.errors.length, top },
    anomalies,
    investigate,
  }
}

export interface WeeklyReport {
  v: 1
  week: { from: string; to: string; days: number }
  previous: { from: string; to: string; days: number } | null
  strategies: Array<{ strategy: string; n: number; sumR: number; avgR: number | null; prevN: number; prevSumR: number; prevAvgR: number | null }>
  model: { n: number; brier: number | null; prevN: number; prevBrier: number | null }
  regimes: Record<string, number>
  events: number
  errors: number
  anomalies: number
}

/** The last 7 daily reports against the 7 before them. */
export function buildWeekly(daily: DailyReport[]): WeeklyReport | null {
  const s = [...daily].sort((a, b) => a.day.localeCompare(b.day))
  if (!s.length) return null
  const cur = s.slice(-7)
  const prev = s.slice(-14, -7)
  const agg = (ds: DailyReport[]) => {
    const m = new Map<string, { n: number; sumR: number }>()
    for (const d of ds) for (const x of d.strategies) {
      const v = m.get(x.strategy) ?? { n: 0, sumR: 0 }
      v.n += x.n
      v.sumR += x.sumR
      m.set(x.strategy, v)
    }
    return m
  }
  const a = agg(cur)
  const b = agg(prev)
  const brier = (ds: DailyReport[]) => {
    const n = ds.reduce((x, d) => x + d.model.n, 0)
    return { n, brier: n ? ds.reduce((x, d) => x + (d.model.brier ?? 0) * d.model.n, 0) / n : null }
  }
  const bc = brier(cur)
  const bp = brier(prev)
  const regimes: Record<string, number> = {}
  for (const d of cur) if (d.regime.end) regimes[d.regime.end] = (regimes[d.regime.end] ?? 0) + 1
  return {
    v: 1,
    week: { from: cur[0].day, to: cur.at(-1)!.day, days: cur.length },
    previous: prev.length ? { from: prev[0].day, to: prev.at(-1)!.day, days: prev.length } : null,
    strategies: [...new Set([...a.keys(), ...b.keys()])].sort().map((strategy) => {
      const x = a.get(strategy) ?? { n: 0, sumR: 0 }
      const y = b.get(strategy) ?? { n: 0, sumR: 0 }
      return { strategy, n: x.n, sumR: x.sumR, avgR: x.n ? x.sumR / x.n : null, prevN: y.n, prevSumR: y.sumR, prevAvgR: y.n ? y.sumR / y.n : null }
    }),
    model: { n: bc.n, brier: bc.brier, prevN: bp.n, prevBrier: bp.brier },
    regimes,
    events: cur.reduce((x, d) => x + d.events.length, 0),
    errors: cur.reduce((x, d) => x + d.errors.count, 0),
    anomalies: cur.reduce((x, d) => x + d.anomalies.length, 0),
  }
}

/** A short text for the chat webhook. */
export function formatDaily(r: DailyReport): string {
  const sg = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2)
  const lines = [`📊 Intelligence report ${r.day}`]
  lines.push(`Regime: ${r.regime.start ?? '?'} → ${r.regime.end ?? '?'} · BTC ${r.btc ?? '?'} · gold ${r.gold ?? '?'}`)
  if (r.events.length) lines.push('Releases: ' + r.events.map((e) => `${e.title}${e.btc1h ? ` (BTC ${sg(e.btc1h.ret)}% 1h)` : ''}`).join('; '))
  if (r.strategies.length) lines.push('Strategies: ' + r.strategies.map((s) => `${s.strategy.toUpperCase()} ${s.n} trades ${sg(s.sumR)}R`).join(' · '))
  if (r.model.n) lines.push(`Model: said ${Math.round((r.model.meanP ?? 0) * 100)}%, won ${Math.round((r.model.winRate ?? 0) * 100)}% of ${r.model.n}`)
  if (r.anomalies.length) lines.push('⚠ ' + r.anomalies.join('; '))
  if (r.investigate.length) lines.push('🔎 ' + r.investigate.slice(0, 4).join('; '))
  return lines.join('\n')
}

// ---- loading ---------------------------------------------------------------------------

const TRACKED = ['nfp', 'cpi', 'ppi', 'fomc', 'fed-speech', 'claims', 'gdp', 'unemployment', 'retail', 'pce', 'political']

/** Everything for one UTC day; a table not created yet reads as empty. */
export async function loadDay(db: Db, day: string): Promise<DayInput> {
  const start = Date.parse(day + 'T00:00:00Z')
  const a = new Date(start).toISOString()
  const b = new Date(start + DAY).toISOString()
  const soft = <T>(p: Promise<{ rows: T[] }>) => p.then((r) => r.rows).catch(() => [] as T[])
  const ms = (v: unknown) => new Date(v as string).getTime()
  const evs = await soft(db.query<Record<string, unknown>>(
    `select distinct on (category, event_time) category, title, event_time, surprise from econ_events
     where country = 'USD' and category = any($1) and event_time >= $2 and event_time < $3 order by category, event_time, surprise nulls last`,
    [TRACKED, a, b],
  ))
  const re = await soft(db.query<Record<string, unknown>>(`select event_time, asset, ret_pct, z from econ_reactions where horizon_min = 60 and event_time >= $1 and event_time < $2`, [a, b]))
  const rx = (t: number, asset: string) => {
    const r = re.find((x) => ms(x.event_time) === t && x.asset === asset)
    return r ? { ret: Number(r.ret_pct), z: r.z == null ? null : Number(r.z) } : null
  }
  const ctx = await soft(db.query<Record<string, unknown>>(`select bar_time, regime, btc_dir_4h, gold_dir_4h from market_context where bar_time > $1 and bar_time <= $2 order by bar_time`, [a, b]))
  const latest = await soft(db.query<{ value: { changes?: DayInput['corrChanges'] } }>(`select value from bot_state where key = 'context:latest'`))
  const real = await soft(db.query<Record<string, unknown>>(
    `select coalesce(strategy, case when mode = 'trend' then 'f1' else 'ml' end) strategy, symbol, side, opened_at, r_multiple, exit_reason, p_win
     from bot_trades where status = 'closed' and closed_at >= $1 and closed_at < $2`,
    [a, b],
  ))
  const sh = await soft(db.query<Record<string, unknown>>(
    `select coalesce(strategy, 'ml') strategy, symbol, side, bar_time, r_net, exit_reason, p_cal from bot_shadow_trades where status = 'closed' and closed_at >= $1 and closed_at < $2`,
    [a, b],
  ))
  const ev = await soft(db.query<Record<string, unknown>>(`select level, symbol, msg from bot_events where t >= $1 and t < $2 and (level = 'error' or msg like 'strategy %:%→%')`, [a, b]))
  return {
    day,
    events: evs.map((e) => {
      const t = ms(e.event_time)
      return { time: t, category: String(e.category), title: String(e.title), surprise: e.surprise == null ? null : Number(e.surprise), btc1h: rx(t, 'BTCUSDT'), gold1h: rx(t, 'XAUUSDT') }
    }),
    context: ctx.map((c) => ({ time: ms(c.bar_time), regime: String(c.regime), btcDir: (c.btc_dir_4h as string) ?? null, goldDir: (c.gold_dir_4h as string) ?? null })),
    corrChanges: latest[0]?.value?.changes ?? [],
    trades: [
      ...real.map((t) => ({ strategy: String(t.strategy), kind: 'real' as const, symbol: String(t.symbol), side: (Number(t.side) > 0 ? 1 : -1) as 1 | -1, entryTime: ms(t.opened_at), r: Number(t.r_multiple), exit: (t.exit_reason as string) ?? null, p: t.p_win == null ? null : Number(t.p_win) })),
      ...sh.map((t) => ({ strategy: String(t.strategy), kind: 'shadow' as const, symbol: String(t.symbol), side: (Number(t.side) > 0 ? 1 : -1) as 1 | -1, entryTime: ms(t.bar_time) + 14_400_000, r: Number(t.r_net), exit: (t.exit_reason as string) ?? null, p: t.p_cal == null ? null : Number(t.p_cal) })),
    ].filter((t) => Number.isFinite(t.r)),
    transitions: ev.filter((e) => e.level !== 'error').map((e) => String(e.msg)),
    errors: ev.filter((e) => e.level === 'error').map((e) => ({ symbol: (e.symbol as string) ?? null, msg: String(e.msg) })),
  }
}

let busy = false
/**
 * From the bot's tick: once per UTC day (after 00:10), for the day that just
 * ended, in the background. Keeps 60 daily reports. Never affects trading.
 */
export function reportTick(store: BotStore, db: Db, alerts: Alerts | null, now = Date.now()): void {
  if (busy) return
  const today = new Date(now).toISOString().slice(0, 10)
  if (now - Date.parse(today + 'T00:00:00Z') < 10 * 60_000) return
  const day = new Date(now - DAY).toISOString().slice(0, 10)
  busy = true
  void (async () => {
    const prev = await store.getState<{ latest?: DailyReport; history?: DailyReport[] } | null>('report:daily', null)
    if (prev?.latest?.day === day) return
    const r = buildDaily(await loadDay(db, day))
    const history = [...(prev?.history ?? []).filter((x) => x.day !== day), r].sort((a, b) => a.day.localeCompare(b.day)).slice(-60)
    await store.setState('report:daily', { latest: r, history })
    const w = buildWeekly(history)
    if (w) await store.setState('report:weekly', w)
    if (alerts) await alerts.send(formatDaily(r)).catch(() => false)
  })()
    .catch((e) => console.error('daily report', (e as Error).message))
    .finally(() => {
      busy = false
    })
}
