// News alerts to the chat webhook (BOT_ALERT_WEBHOOK), research plan "alerts
// you actually want". Every 5 minutes, in the background, from the bot tick:
//
//   heads-up  a high-impact US release in the next 60 minutes: what, the
//             forecast and previous, and how far BTC usually moved in the hour
//             after that kind of release (from econ_reactions, with n)
//   result    a release from the last 3 hours with an actual: actual vs
//             forecast, the surprise, and BTC's move since the release
//
// One message per release time (NFP, unemployment rate and earnings at 8:30
// are one message), each sent once (bot_state 'news:alerted'). Facts only: no
// "bullish" or "bearish" label. Without a webhook nothing is sent or read.
import type { Db } from '../db.ts'
import type { BotStore } from '../bot/store.ts'
import type { Bar } from '../bot/features.ts'
import { barsRange } from '../bot/data.ts'
import { TRACKED } from './events.ts'

export interface AlertRow {
  time: number
  category: string
  title: string
  forecast: string | null
  previous: string | null
  actual: string | null
  surprise: number | null
  unit: string | null
  source?: string
}

export interface Typical {
  n: number
  avgAbs: number
}

const LABEL: Record<string, string> = { nfp: 'NFP', cpi: 'CPI', ppi: 'PPI', fomc: 'FOMC', 'fed-speech': 'Fed chair', claims: 'Jobless claims', gdp: 'GDP', unemployment: 'Unemployment', retail: 'Retail sales', pce: 'PCE', political: 'Political' }
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16) + ' UTC'
const sg = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d)

/** The heads-up text for the rows of one release time. */
export function headsUp(rows: AlertRow[], now: number, typical: Record<string, Typical | undefined>): string {
  const t = rows[0].time
  const mins = Math.max(0, Math.round((t - now) / 60_000))
  const lines = [`⏰ In ${mins} min (${hhmm(t)}): ${rows.map((r) => r.title).join(' · ')}`]
  for (const r of rows) if (r.forecast || r.previous) lines.push(`  ${r.title}: forecast ${r.forecast ?? '—'} · previous ${r.previous ?? '—'}`)
  const cats = [...new Set(rows.map((r) => r.category))]
  for (const c of cats) {
    const ty = typical[c]
    if (ty && ty.n >= 5) lines.push(`  After past ${LABEL[c] ?? c} releases BTC moved ±${ty.avgAbs.toFixed(2)}% in the hour on average (${ty.n} releases)${ty.n < 10 ? ' — few releases' : ''}.`)
  }
  return lines.join('\n')
}

/** The result text: actuals vs forecasts and BTC's move since the release (null when no price). */
export function result(rows: AlertRow[], btcMovePct: number | null): string {
  const lines = [`📢 ${hhmm(rows[0].time)} release`]
  for (const r of rows) {
    if (!r.actual) continue
    lines.push(`  ${r.title}: ${r.actual}${r.forecast ? ` vs forecast ${r.forecast}` : ''}${r.surprise != null ? ` (surprise ${sg(r.surprise, Math.abs(r.surprise) < 10 ? 2 : 0)})` : ''}`)
  }
  if (btcMovePct != null) lines.push(`  BTC ${sg(btcMovePct)}% since the release.`)
  return lines.join('\n')
}

/**
 * Rows grouped by release time, oldest first. Where the Forex Factory calendar
 * has the release, only its rows are kept (the agency's are the same numbers
 * under other names; Forex Factory's carry the forecast).
 */
export function byTime(rows: AlertRow[]): AlertRow[][] {
  const m = new Map<number, AlertRow[]>()
  for (const r of rows) {
    const a = m.get(r.time)
    if (a) a.push(r)
    else m.set(r.time, [r])
  }
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => (v.some((r) => r.source === 'ff') ? v.filter((r) => r.source === 'ff') : v))
}

/** BTC's % move from the last close before t to the latest closed 15m bar. */
export function moveSince(bars: Bar[], t: number): number | null {
  const before = bars.filter((b) => b.t + 900_000 <= t).at(-1)
  const last = bars.at(-1)
  return before && last && last.t + 900_000 > t ? (last.c / before.c - 1) * 100 : null
}

export interface AlertSender {
  enabled: boolean
  send(text: string): Promise<boolean>
}

const KEY = 'news:alerted'
let busy = false
let lastAt = 0

/** From the bot's tick: every 5 minutes, in the background; never throws. */
export function newsAlertTick(store: BotStore, db: Db, alerts: AlertSender, now = Date.now(), bars: typeof barsRange = barsRange): Promise<void> | void {
  if (!alerts.enabled || busy || now - lastAt < 5 * 60_000) return
  busy = true
  lastAt = now
  return (async () => {
    const sent = new Set((await store.getState<{ keys?: string[] } | null>(KEY, null))?.keys ?? [])
    const q = await db.query<Record<string, unknown>>(
      `select distinct on (event_time, category, title) event_time, category, title, forecast, previous, actual, surprise, unit, source from econ_events
       where country = 'USD' and category = any($1) and (impact = 'High' or category = 'fomc') and event_time between $2 and $3
       order by event_time, category, title, (actual is null), source`,
      [TRACKED, new Date(now - 3 * 3_600_000).toISOString(), new Date(now + 60 * 60_000).toISOString()],
    )
    const rows: AlertRow[] = q.rows.map((x) => ({
      time: new Date(x.event_time as string).getTime(),
      category: String(x.category),
      title: String(x.title),
      forecast: (x.forecast as string) ?? null,
      previous: (x.previous as string) ?? null,
      actual: (x.actual as string) ?? null,
      surprise: x.surprise == null ? null : Number(x.surprise),
      unit: (x.unit as string) ?? null,
      source: String(x.source),
    }))
    for (const g of byTime(rows)) {
      const t = g[0].time
      if (t > now && !sent.has('pre:' + t)) {
        const ty = await db.query<{ category: string; n: number; a: number }>(
          `select e.category, count(*)::int n, avg(abs(x.ret_pct)) a from econ_reactions x
           join (select distinct category, event_time from econ_events where country = 'USD' and category = any($1)) e on e.event_time = x.event_time
           where x.asset = 'BTCUSDT' and x.horizon_min = 60 group by e.category`,
          [[...new Set(g.map((r) => r.category))]],
        )
        const typical = Object.fromEntries(ty.rows.map((r) => [r.category, { n: Number(r.n), avgAbs: Number(r.a) }]))
        if (await alerts.send(headsUp(g, now, typical))) sent.add('pre:' + t)
      } else if (t <= now && g.some((r) => r.actual) && !sent.has('res:' + t)) {
        const b = await bars('BTCUSDT', '15m', t - 3_600_000, now).catch(() => [] as Bar[])
        if (await alerts.send(result(g, moveSince(b, t)))) sent.add('res:' + t)
      }
    }
    await store.setState(KEY, { keys: [...sent].slice(-200) })
  })()
    .catch((e) => console.error('news alerts', (e as Error).message))
    .finally(() => {
      busy = false
    })
}
