// Collects economic events and the market's reaction (events.ts) into
// econ_events / econ_reactions (sql/010_econ_events.sql).
//
//   calendars  hourly: the Forex Factory weekly calendar (the one the website
//              shows) and the agency calendar (actuals, revisions); US rows of
//              the tracked categories, plus high-impact rows of any country
//   backfill   once, when FRED_API_KEY is set: release dates since 2019 of the
//              FRED releases in FRED_RELEASES and the FOMC decisions; marked
//              done in bot_state 'news:backfill'
//   reactions  for each release time in the tracked categories that is over
//              24 h old and has none yet: BTC, ETH and gold 15-minute bars from
//              30 days before to 24 h after → econ_reactions (the bot does
//              40 per hourly run: ~1,000 past releases take about a day)
import type { Bar } from '../bot/features.ts'
import { barsRange } from '../bot/data.ts'
import type { BotStore } from '../bot/store.ts'
import type { Db } from '../db.ts'
import { FOMC_CALENDAR_URL, FRED_RELEASES, TRACKED, fomcDecisions, fomcRows, fredRows, mergeActuals, parseAgency, parseFomcCalendar, parseForexFactory, reaction } from './events.ts'
import type { EventRow } from './events.ts'

export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'
export const AGENCY_URL = 'https://xoomar.com/api/markets/calendar'
export const REACTION_ASSETS = ['BTCUSDT', 'ETHUSDT', 'XAUUSDT']
export const BACKFILL_FROM = '2019-01-01'
const DAY = 86_400_000

export interface NewsFetchers {
  json: (url: string) => Promise<unknown>
  text: (url: string) => Promise<string>
  bars: (symbol: string, interval: string, start: number, end: number) => Promise<Bar[]>
}

export async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (radar-worker)' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`${url.replace(/api_key=[^&]+/, 'api_key=…')} → HTTP ${r.status}`)
  return r.json()
}

export async function getText(url: string): Promise<string> {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (radar-worker)' }, signal: AbortSignal.timeout(20_000) })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.text()
}

export const LIVE: NewsFetchers = { json: getJson, text: getText, bars: barsRange }

/** Rows worth keeping: US rows of a tracked category, and high-impact rows of any country. */
export function keep(r: EventRow): boolean {
  return (r.country === 'USD' && TRACKED.includes(r.category)) || r.impact === 'High'
}

export async function upsertEvents(db: Db, rows: EventRow[]): Promise<number> {
  let n = 0
  for (const r of rows) {
    await db.query(
      `insert into econ_events (key, source, category, title, country, impact, event_time, period, unit, previous, forecast, actual,
         previous_num, forecast_num, actual_num, revised_previous_num, surprise, decision)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       on conflict (key) do update set
         impact = coalesce(excluded.impact, econ_events.impact), period = coalesce(excluded.period, econ_events.period),
         unit = coalesce(excluded.unit, econ_events.unit), previous = coalesce(excluded.previous, econ_events.previous),
         forecast = coalesce(excluded.forecast, econ_events.forecast), actual = coalesce(excluded.actual, econ_events.actual),
         previous_num = coalesce(excluded.previous_num, econ_events.previous_num), forecast_num = coalesce(excluded.forecast_num, econ_events.forecast_num),
         actual_num = coalesce(excluded.actual_num, econ_events.actual_num), revised_previous_num = coalesce(excluded.revised_previous_num, econ_events.revised_previous_num),
         surprise = coalesce(excluded.surprise, econ_events.surprise), decision = coalesce(excluded.decision, econ_events.decision), updated = now()`,
      [r.key, r.source, r.category, r.title, r.country, r.impact, new Date(r.eventTime).toISOString(), r.period, r.unit, r.previous, r.forecast, r.actual,
        r.previousNum, r.forecastNum, r.actualNum, r.revisedPreviousNum, r.surprise, r.decision],
    )
    n++
  }
  return n
}

/** Both calendars → econ_events. A calendar that fails is skipped (the other still counts). */
export async function collectCalendars(db: Db, f: NewsFetchers = LIVE): Promise<{ ff: number; agency: number; errors: string[] }> {
  const errors: string[] = []
  const ff = await f.json(FF_URL).then(parseForexFactory).catch((e) => (errors.push('forex factory: ' + (e as Error).message), [] as EventRow[]))
  const ag = await f.json(AGENCY_URL).then(parseAgency).catch((e) => (errors.push('agency calendar: ' + (e as Error).message), [] as EventRow[]))
  const merged = mergeActuals(ff, ag)
  const a = await upsertEvents(db, merged.filter(keep))
  const b = await upsertEvents(db, ag.filter(keep))
  return { ff: a, agency: b, errors }
}

/**
 * FRED release dates since BACKFILL_FROM and the FOMC meetings on the Fed's
 * calendar (with each decision from DFEDTARU) → econ_events. Throws on a
 * wrong release id or an FOMC page that yields no meetings.
 */
export async function backfillFred(db: Db, key: string, f: NewsFetchers = LIVE): Promise<Record<string, number>> {
  const api = (path: string) => f.json(`https://api.stlouisfed.org/fred/${path}${path.includes('?') ? '&' : '?'}api_key=${key}&file_type=json`)
  const out: Record<string, number> = {}
  const target = (await api(`series/observations?series_id=DFEDTARU&observation_start=${BACKFILL_FROM}`)) as { observations?: Array<{ date: string; value: string }> }
  const tgt = (target.observations ?? []).filter((o) => Number.isFinite(Number(o.value))).map((o) => ({ date: o.date, value: Number(o.value) }))
  const today = new Date().toISOString().slice(0, 10)
  for (const rel of FRED_RELEASES) {
    const info = (await api(`release?release_id=${rel.id}`)) as { releases?: Array<{ name: string }> }
    const name = info.releases?.[0]?.name ?? ''
    if (!rel.name.test(name)) throw new Error(`FRED release ${rel.id} is "${name}", expected ${rel.name}`)
    const d = (await api(`release/dates?release_id=${rel.id}&realtime_start=${BACKFILL_FROM}&realtime_end=${today}&include_release_dates_with_no_data=false&limit=10000&sort_order=asc`)) as { release_dates?: Array<{ date: string }> }
    const dates = [...new Set((d.release_dates ?? []).map((x) => x.date))].filter((x) => x >= BACKFILL_FROM && x <= today)
    out[rel.category] = await upsertEvents(db, fredRows(rel, dates))
  }
  const meetings = parseFomcCalendar(await f.text(FOMC_CALENDAR_URL)).filter((d) => d >= BACKFILL_FROM && d <= today)
  if (!meetings.length) throw new Error('the Fed calendar page gave no FOMC meetings (layout changed?)')
  out.fomc = await upsertEvents(db, fomcRows(meetings, fomcDecisions(meetings, tgt)))
  return out
}

/** Release times (any source) in the tracked categories, over 24 h old, with no reaction yet; oldest first. */
export async function pendingReleases(db: Db, now: number, limit: number): Promise<number[]> {
  const r = await db.query<{ t: string }>(
    `select distinct e.event_time t from econ_events e
     where e.category = any($1) and e.country = 'USD' and e.event_time < $2 and e.event_time > $3
       and not exists (select 1 from econ_reactions x where x.event_time = e.event_time)
     order by e.event_time limit $4`,
    [TRACKED, new Date(now - DAY).toISOString(), new Date(Date.UTC(2019, 0, 1)).toISOString(), limit],
  )
  return r.rows.map((x) => new Date(x.t).getTime())
}

/**
 * Reactions for one release time: every asset with bars around it. An asset
 * with no data then (gold before its perpetual listed) is skipped; when none
 * has data a placeholder row (asset 'none') stops the time being retried.
 */
export async function computeReactions(db: Db, t: number, f: NewsFetchers = LIVE): Promise<number> {
  let n = 0
  for (const asset of REACTION_ASSETS) {
    const bars = await f.bars(asset, '15m', t - 31 * DAY, t + DAY + 900_000).catch(() => [] as Bar[])
    for (const x of reaction(bars, t)) {
      await db.query(
        `insert into econ_reactions (event_time, asset, horizon_min, ret_pct, z, range_pct, base_price) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (event_time, asset, horizon_min) do update set ret_pct = excluded.ret_pct, z = excluded.z, range_pct = excluded.range_pct, base_price = excluded.base_price, computed = now()`,
        [new Date(t).toISOString(), asset, x.horizonMin, x.retPct, x.z, x.rangePct, x.basePrice],
      )
      n++
    }
  }
  if (!n) {
    await db.query(
      `insert into econ_reactions (event_time, asset, horizon_min, ret_pct, base_price) values ($1, 'none', 0, 0, 0) on conflict do nothing`,
      [new Date(t).toISOString()],
    )
  }
  return n
}

let inFlight = false
let lastAt = 0
/**
 * From the bot's tick: hourly, in the background (never awaited), one at a
 * time: calendars, the one-off FRED backfill when a key is set, then up to
 * `perRun` pending reactions. Errors are logged, never thrown.
 */
export function newsTick(store: BotStore, db: Db, opts: { fredKey?: string; perRun?: number; everyMs?: number } = {}, now = Date.now()): void {
  if (inFlight || now - lastAt < (opts.everyMs ?? 3_600_000)) return
  inFlight = true
  lastAt = now
  void (async () => {
    const c = await collectCalendars(db)
    if (c.errors.length) console.warn('news calendars', c.errors.join('; '))
    if (opts.fredKey && !(await store.getState<{ done?: number } | null>('news:backfill', null))?.done) {
      const res = await backfillFred(db, opts.fredKey)
      await store.setState('news:backfill', { done: Date.now(), from: BACKFILL_FROM, rows: res })
      await store.event('info', null, `news backfill from FRED: ${Object.entries(res).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    }
    for (const t of await pendingReleases(db, now, opts.perRun ?? 10)) await computeReactions(db, t)
  })()
    .catch((e) => console.error('news', (e as Error).message))
    .finally(() => {
      inFlight = false
    })
}
