// Ported from pro-terminal/src/core/news/forexFactory.ts (Pro Terminal calendar).
/**
 * Forex Factory economic calendar. Public weekly JSON (also served as XML/CSV) at
 * https://nfs.faireconomy.media/ff_calendar_thisweek.json — unofficial but long-standing; fetched via our proxy.
 * Fields: title, country, date (ISO with offset), impact (High|Medium|Low|Holiday), forecast, previous; `actual` appears on some rows.
 */
export type Impact = 'High' | 'Medium' | 'Low' | 'Holiday' | 'Non-Economic'
export interface CalendarEvent {
  id: string
  title: string
  currency: string
  ts: number
  impact: Impact
  actual?: string
  forecast?: string
  previous?: string
  allDay: boolean
}
export const FF_URLS = {
  lastWeek: 'https://nfs.faireconomy.media/ff_calendar_lastweek.json',
  thisWeek: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  nextWeek: 'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
}
/** Auxiliary month-depth feed (30+ day range) merged when the FF weekly files alone don't span a month. */
export const XOOMAR_URL = 'https://xoomar.com/api/markets/calendar'
export const MONTH_MS = 28 * 86400e3
export function parseFF(json: string): CalendarEvent[] {
  const rows = JSON.parse(json) as any[]
  if (!Array.isArray(rows)) throw new Error('unexpected calendar payload')
  return rows
    .map((r, i) => {
      const ts = Date.parse(r.date)
      const impact = (String(r.impact || 'Low').replace(/\s.*$/, '') as Impact)
      const allDay = /T00:00:00|Tentative|All Day/i.test(String(r.date)) && impact === 'Holiday'
      return {
        id: `${r.country}-${r.title}-${r.date}-${i}`,
        title: String(r.title ?? ''),
        currency: String(r.country ?? ''),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        impact: ['High', 'Medium', 'Low', 'Holiday'].includes(impact) ? impact : 'Non-Economic',
        actual: r.actual ? String(r.actual) : undefined,
        forecast: r.forecast ? String(r.forecast) : undefined,
        previous: r.previous ? String(r.previous) : undefined,
        allDay,
      }
    })
    .filter((e) => e.title)
    .sort((a, b) => a.ts - b.ts)
}
/** Group by local calendar day, like Forex Factory's day header rows. */
export function groupByDay(
  events: CalendarEvent[],
): { day: string; date: Date; events: CalendarEvent[] }[] {
  const m = new Map<string, { day: string; date: Date; events: CalendarEvent[] }>()
  for (const e of events) {
    const d = new Date(e.ts)
    const key = d.toDateString()
    let g = m.get(key)
    if (!g) {
      g = { day: key, date: d, events: [] }
      m.set(key, g)
    }
    g.events.push(e)
  }
  return [...m.values()]
}
/** Actual vs forecast tone: green if better for the currency (higher), red if worse; unemployment/claims-type rows invert. */
export function actualTone(e: CalendarEvent): 'better' | 'worse' | 'neutral' {
  if (!e.actual || !e.forecast) return 'neutral'
  const a = parseFloat(e.actual.replace(/[^0-9.-]/g, ''))
  const f = parseFloat(e.forecast.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(a) || !Number.isFinite(f) || a === f) return 'neutral'
  const invert = /unemploy|claims|inventor|deficit/i.test(e.title)
  const better = a > f
  return (invert ? !better : better) ? 'better' : 'worse'
}

/**
 * Merge and de-duplicate calendar events from several weekly files (and the
 * depth feed) so the calendar always spans at least one month.
 * Key = currency + title + minute-resolution timestamp.
 */
export function mergeCalendar(...groups: CalendarEvent[][]): CalendarEvent[] {
  const seen = new Set<string>()
  const out: CalendarEvent[] = []
  for (const ev of groups.flat().sort((a, b) => a.ts - b.ts)) {
    const key = `${ev.currency}|${ev.title.trim().toLowerCase()}|${Math.floor(ev.ts / 60000)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}

/** Day-span covered by a set of events (≈ nfs this-week JSON only gives ~7 days). */
export function calendarSpanDays(events: CalendarEvent[]): number {
  if (!events.length) return 0
  let min = Infinity
  let max = -Infinity
  for (const e of events) {
    if (e.ts < min) min = e.ts
    if (e.ts > max) max = e.ts
  }
  return Math.max(1, Math.round((max - min) / 86400e3))
}

/** e.g. "Sep 15 – Oct 16 · 31 days" for the calendar header chip. */
export function calendarRangeLabel(events: CalendarEvent[]): string {
  if (!events.length) return 'no data'
  let min = Infinity
  let max = -Infinity
  for (const e of events) {
    if (e.ts < min) min = e.ts
    if (e.ts > max) max = e.ts
  }
  const f = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${f(min)} – ${f(max)} · ${calendarSpanDays(events)}d`
}

/** Xoomar month-depth feed → CalendarEvent (auxiliary; fills FF week gaps). */
export function parseXoomar(json: string): CalendarEvent[] {
  const d = JSON.parse(json) as { data?: Array<Record<string, unknown>> }
  const rows = Array.isArray(d?.data) ? d.data : []
  return rows
    .map((r, i) => {
      const imp = String(r.importance ?? '').toLowerCase()
      const impact: Impact =
        imp === 'high' || imp === 'med' || imp === 'medium' ? (imp === 'high' ? 'High' : 'Medium') : 'Low'
      const ts = Date.parse(String(r.scheduledAt ?? ''))
      return {
        id: `xo-${i}-${ts}`,
        title: String(r.eventName ?? ''),
        currency: String(r.country ?? 'US'),
        ts: Number.isFinite(ts) ? ts : Date.now(),
        impact,
        actual: r.actual ? String(r.actual) : undefined,
        forecast: r.forecast ? String(r.forecast) : undefined,
        previous: r.previous ? String(r.previous) : undefined,
        allDay: false,
      }
    })
    .filter((e) => e.title)
}