// Economic events (research plan P4): categories, parsing the two calendars,
// matching an agency's actual to Forex Factory's forecast, US-Eastern release
// times, and the market reaction around a release. Pure (tested in
// test/news.test.ts); src/news/collect.ts does the fetching and storing.
//
// A category is decided from the title only. "Positive" or "negative" news is
// never assumed: a surprise is just actual − forecast in the indicator's own
// units, and the reaction is measured from prices.
import type { Bar } from '../bot/features.ts'

export type Category =
  | 'nfp'
  | 'cpi'
  | 'ppi'
  | 'fomc'
  | 'fomc-minutes'
  | 'fed-speech'
  | 'claims'
  | 'gdp'
  | 'unemployment'
  | 'retail'
  | 'pce'
  | 'political'
  | 'other'

/** First match wins; order matters (core CPI is CPI, FOMC minutes are not the decision). */
const RULES: Array<[RegExp, Category]> = [
  [/non-?farm (employment change|payrolls)|employment situation/i, 'nfp'],
  [/fomc (meeting )?minutes/i, 'fomc-minutes'],
  [/federal funds rate|fomc (statement|press conference|decision)|fomc press release|interest rate decision/i, 'fomc'],
  [/powell|fed chair/i, 'fed-speech'],
  [/\bcpi\b|consumer price/i, 'cpi'],
  [/\bppi\b|producer price/i, 'ppi'],
  [/unemployment claims|jobless claims|unemployment insurance/i, 'claims'],
  [/unemployment rate/i, 'unemployment'],
  [/\bgdp\b|gross domestic product/i, 'gdp'],
  [/retail sales/i, 'retail'],
  [/\bpce\b|personal income|personal consumption/i, 'pce'],
  [/election|referendum|summit|tariff|sanction|war\b|shutdown/i, 'political'],
]

export function categorize(title: string): Category {
  for (const [re, c] of RULES) if (re.test(title)) return c
  return 'other'
}

/** The categories the study follows (US data and the Fed, plus flagged political events). */
export const TRACKED: Category[] = ['nfp', 'cpi', 'ppi', 'fomc', 'fed-speech', 'claims', 'gdp', 'unemployment', 'retail', 'pce', 'political']

/** "250K" → 250, "-0.1%" → -0.1, "1.2M" → 1200 (thousands), "4.25|4.50%" → 4.5; null when not a number. */
export function parseValue(s: string | null | undefined): number | null {
  if (s == null) return null
  const t = String(s).trim().replace(/,/g, '')
  if (!t) return null
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*([KMB%])?\s*$/i)
  if (!m) return null
  const v = Number(m[1])
  if (!Number.isFinite(v)) return null
  const u = (m[2] ?? '').toUpperCase()
  return u === 'M' ? v * 1000 : u === 'B' ? v * 1e6 : v
}

export interface EventRow {
  key: string
  source: 'ff' | 'agency' | 'fred' | 'fed'
  category: Category
  title: string
  country: string
  impact: string | null
  eventTime: number
  period: string | null
  unit: string | null
  previous: string | null
  forecast: string | null
  actual: string | null
  previousNum: number | null
  forecastNum: number | null
  actualNum: number | null
  revisedPreviousNum: number | null
  surprise: number | null
  decision: string | null
}

const minute = (t: number) => new Date(Math.floor(t / 60_000) * 60_000).toISOString().slice(0, 16)
export const eventKey = (source: string, country: string, title: string, t: number) => `${source}|${country}|${title.trim().toLowerCase()}|${minute(t)}`

function row(o: Partial<EventRow> & Pick<EventRow, 'source' | 'title' | 'country' | 'eventTime'>): EventRow {
  const previousNum = o.previousNum ?? parseValue(o.previous)
  const forecastNum = o.forecastNum ?? parseValue(o.forecast)
  const actualNum = o.actualNum ?? parseValue(o.actual)
  return {
    ...o,
    key: eventKey(o.source, o.country, o.title, o.eventTime),
    category: o.category ?? categorize(o.title),
    impact: o.impact ?? null,
    period: o.period ?? null,
    unit: o.unit ?? null,
    previous: o.previous || null,
    forecast: o.forecast || null,
    actual: o.actual || null,
    previousNum,
    forecastNum,
    actualNum,
    revisedPreviousNum: o.revisedPreviousNum ?? null,
    surprise: actualNum != null && forecastNum != null ? actualNum - forecastNum : null,
    decision: o.decision ?? null,
  } as EventRow
}

/** Forex Factory weekly JSON → rows (all countries; the caller filters). */
export function parseForexFactory(json: unknown): EventRow[] {
  if (!Array.isArray(json)) return []
  const out: EventRow[] = []
  for (const r of json as Array<Record<string, unknown>>) {
    const t = Date.parse(String(r.date ?? ''))
    const title = String(r.title ?? '').trim()
    if (!title || !Number.isFinite(t)) continue
    out.push(row({
      source: 'ff',
      title,
      country: String(r.country ?? ''),
      impact: typeof r.impact === 'string' ? r.impact : null,
      eventTime: t,
      previous: str(r.previous),
      forecast: str(r.forecast),
      actual: str(r.actual),
    }))
  }
  return out
}

/** The agency calendar (BLS, BEA, Census, DOL, Fed, Treasury) → rows; all US. */
export function parseAgency(json: unknown): EventRow[] {
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: EventRow[] = []
  for (const r of data as Array<Record<string, unknown>>) {
    const t = Date.parse(String(r.scheduledAt ?? ''))
    const title = String(r.eventName ?? '').trim()
    if (!title || !Number.isFinite(t)) continue
    out.push(row({
      source: 'agency',
      title,
      country: 'USD',
      impact: r.importance === 'high' ? 'High' : r.importance === 'med' ? 'Medium' : r.importance === 'low' ? 'Low' : null,
      eventTime: t,
      period: str(r.periodLabel),
      unit: str(r.unit),
      previous: str(r.previous),
      forecast: str(r.forecast),
      actual: str(r.actual),
    }))
  }
  return out
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))

/**
 * The agency row that reports the same number as a Forex Factory row: the
 * same category, within 5 minutes, and a unit that says it is that number
 * (NFP in thousands of jobs, CPI y/y, claims in thousands, GDP % q/q).
 */
const SAME_NUMBER: Array<{ ff: RegExp; unit: RegExp }> = [
  { ff: /non-?farm employment change/i, unit: /thousands, monthly change/i },
  { ff: /^cpi y\/y/i, unit: /% y\/y/i },
  { ff: /unemployment claims/i, unit: /^thousands/i },
  { ff: /gdp q\/q/i, unit: /% q\/q/i },
]

/**
 * Fill a Forex Factory row's missing actual from the agency's, and record the
 * agency's previous when it differs (a revision). Returns new rows.
 */
export function mergeActuals(ff: EventRow[], agency: EventRow[]): EventRow[] {
  return ff.map((f) => {
    const rule = SAME_NUMBER.find((r) => r.ff.test(f.title))
    if (!rule || f.country !== 'USD') return f
    const a = agency.find((x) => x.category === f.category && Math.abs(x.eventTime - f.eventTime) <= 5 * 60_000 && rule.unit.test(x.unit ?? ''))
    if (!a) return f
    const actualNum = f.actualNum ?? a.actualNum
    const revisedPreviousNum = a.previousNum != null && f.previousNum != null && a.previousNum !== f.previousNum ? a.previousNum : f.revisedPreviousNum
    return {
      ...f,
      actual: f.actual ?? a.actual,
      actualNum,
      revisedPreviousNum,
      surprise: actualNum != null && f.forecastNum != null ? actualNum - f.forecastNum : null,
    }
  })
}

// ---- US Eastern time ---------------------------------------------------------------

/** UTC ms of a wall-clock time in New York on a date (handles daylight saving). */
export function newYorkToUtc(date: string, hh: number, mm: number): number {
  const [y, mo, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, mo - 1, d, hh, mm)
  // The offset of New York at that instant, from Intl.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asNy = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
  const off = guess - asNy
  const t = guess + off
  // Re-check across a DST edge.
  const p2 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t))
  const h2 = Number(p2.find((p) => p.type === 'hour')?.value)
  return h2 === hh ? t : t + (hh - h2) * 3_600_000
}

/** FRED releases followed, their New York release time, and the name FRED must report (a guard against a wrong id). */
export const FRED_RELEASES: Array<{ id: number; name: RegExp; category: Category; title: string; hh: number; mm: number }> = [
  { id: 50, name: /employment situation/i, category: 'nfp', title: 'Employment Situation (NFP)', hh: 8, mm: 30 },
  { id: 10, name: /consumer price index/i, category: 'cpi', title: 'Consumer Price Index', hh: 8, mm: 30 },
  { id: 46, name: /producer price index/i, category: 'ppi', title: 'Producer Price Index', hh: 8, mm: 30 },
  { id: 53, name: /gross domestic product/i, category: 'gdp', title: 'Gross Domestic Product', hh: 8, mm: 30 },
  { id: 180, name: /unemployment insurance weekly claims/i, category: 'claims', title: 'Unemployment Insurance Weekly Claims', hh: 8, mm: 30 },
  { id: 9, name: /retail/i, category: 'retail', title: 'Advance Retail Sales', hh: 8, mm: 30 },
  { id: 54, name: /personal income and outlays/i, category: 'pce', title: 'Personal Income and Outlays', hh: 8, mm: 30 },
]

/**
 * FOMC decisions are not taken from FRED: its "FOMC Press Release" release
 * (101) lists every day the target series updates, not the meetings. The
 * meetings come from the Fed's own calendar page (fomccalendars.htm, the
 * current year and the five before), the decision on the last meeting day at
 * 2:00 pm New York time. Cancelled meetings and notation votes are skipped.
 */
export const FOMC_CALENDAR_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
export const FOMC_RELEASE = { category: 'fomc' as Category, title: 'FOMC rate decision', hh: 14, mm: 0 }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** The Fed calendar page → decision days (YYYY-MM-DD), ascending. */
export function parseFomcCalendar(html: string): string[] {
  const re = /(\d{4}) FOMC Meetings|fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>|fomc-meeting__date[^>]*>([^<]+)</g
  const out = new Set<string>()
  let year: number | null = null
  let month: string | null = null
  for (const m of html.matchAll(re)) {
    if (m[1]) year = Number(m[1])
    else if (m[2]) month = m[2].trim().toLowerCase()
    else if (m[3] && year && month) {
      const raw = m[3].trim()
      // Not a rate decision at 2 pm: cancelled meetings and notation votes (e.g. the Aug 2025 strategy statement).
      if (/cancel|notation/i.test(raw)) continue
      const days = raw.replace(/[^0-9-]/g, '').split('-').filter(Boolean).map(Number)
      if (!days.length) continue
      // "Apr/May" with "30-1": the decision falls in the second month.
      const names = month.split('/').map((x) => x.trim())
      const last = days[days.length - 1]
      const crosses = names.length > 1 && days.length > 1 && last < days[0]
      const name = crosses ? names[names.length - 1] : names[0]
      const mi = MONTHS.findIndex((x) => x.startsWith(name.slice(0, 3)))
      if (mi < 0 || !(last >= 1 && last <= 31)) continue
      out.add(`${year}-${String(mi + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`)
    }
  }
  return [...out].sort()
}

/** FOMC decision days → rows (with the decision when the target series has it). */
export function fomcRows(days: string[], decisions: Map<string, string> = new Map()): EventRow[] {
  return days.map((d) =>
    row({ source: 'fed', category: 'fomc', title: FOMC_RELEASE.title, country: 'USD', impact: 'High', eventTime: newYorkToUtc(d, FOMC_RELEASE.hh, FOMC_RELEASE.mm), decision: decisions.get(d) ?? null }),
  )
}

/** FRED release dates → rows (dates only: values, forecasts and surprises are not backfilled). */
export function fredRows(rel: (typeof FRED_RELEASES)[number], dates: string[]): EventRow[] {
  return dates.map((d) => row({ source: 'fred', category: rel.category, title: rel.title, country: 'USD', impact: 'High', eventTime: newYorkToUtc(d, rel.hh, rel.mm) }))
}

/**
 * FOMC decisions from the daily upper target (FRED DFEDTARU): on each meeting
 * date, the target on the next published day vs the day before.
 */
export function fomcDecisions(meetings: string[], target: Array<{ date: string; value: number }>): Map<string, string> {
  const out = new Map<string, string>()
  const s = [...target].sort((a, b) => a.date.localeCompare(b.date))
  for (const m of meetings) {
    const before = [...s].reverse().find((x) => x.date < m)
    const after = s.find((x) => x.date > m)
    if (!before || !after) continue
    const d = after.value - before.value
    out.set(m, `${d > 0 ? 'hike' : d < 0 ? 'cut' : 'hold'} → ${after.value.toFixed(2)}%`)
  }
  return out
}

// ---- reaction ----------------------------------------------------------------------

export const HORIZONS_MIN = [15, 60, 240, 1440]
const M15 = 900_000

export interface Reaction {
  horizonMin: number
  retPct: number
  z: number | null
  rangePct: number
  basePrice: number
}

/**
 * The reaction of one asset to a release at `t` from 15-minute bars covering
 * at least 30 days before to 24 h after. Base: the close of the last bar that
 * ended at or before t. z: the return over the standard deviation of
 * non-overlapping same-horizon returns in the 30 days before the release
 * (ending 24 h before it, so an earlier move into the event is not counted).
 * A horizon whose end bar is missing is left out.
 */
export function reaction(b: Bar[], t: number): Reaction[] {
  const byEnd = new Map(b.map((x) => [x.t + M15, x]))
  const baseBar = byEnd.get(Math.floor(t / M15) * M15)
  if (!baseBar) return []
  const p0 = baseBar.c
  const out: Reaction[] = []
  for (const h of HORIZONS_MIN) {
    const end = Math.floor(t / M15) * M15 + h * 60_000
    const eb = byEnd.get(end)
    if (!eb) continue
    const within = b.filter((x) => x.t >= end - h * 60_000 && x.t + M15 <= end)
    const hi = Math.max(...within.map((x) => x.h))
    const lo = Math.min(...within.map((x) => x.l))
    const ret = Math.log(eb.c / p0)
    // Same-horizon returns before the event.
    const rs: number[] = []
    const stop = t - 86_400_000
    for (let e = stop; e - h * 60_000 >= t - 30 * 86_400_000; e -= h * 60_000) {
      const a = byEnd.get(Math.floor((e - h * 60_000) / M15) * M15)
      const z = byEnd.get(Math.floor(e / M15) * M15)
      if (a && z) rs.push(Math.log(z.c / a.c))
    }
    let sd: number | null = null
    if (rs.length >= 20) {
      const m = rs.reduce((x, y) => x + y, 0) / rs.length
      sd = Math.sqrt(rs.reduce((x, y) => x + (y - m) ** 2, 0) / (rs.length - 1))
    }
    out.push({ horizonMin: h, retPct: ret * 100, z: sd && sd > 0 ? ret / sd : null, rangePct: ((hi - lo) / p0) * 100, basePrice: p0 })
  }
  return out
}
