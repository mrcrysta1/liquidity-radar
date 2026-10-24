// The charts' display time zone (TradingView's bottom-bar "UTC+5" button).
//
// Formatter-only: candle, drawing, replay and alert timestamps stay in UTC
// seconds exactly as before. Only the text the charts print — time-axis tick
// marks, the crosshair's time label and the other chart date read-outs — is
// rendered in the chosen zone, through lightweight-charts'
// `localization.timeFormatter` and `timeScale.tickMarkFormatter`.
//
// Daily-and-longer bars are dated by their UTC session, as TradingView dates
// crypto daily bars whatever the zone: a 1D bar opening at 00:00 UTC is "23
// Oct" in New York too, not "22 Oct 20:00".
//
// Pure apart from localStorage, so scripts/test-engines.mjs can run it.
import { storageGetRaw, storageSetRaw } from '../../services/storage.ts'
import { utcOffsetLabel } from './scaleNavMath.ts'
import { tfDef, tfMs } from '../../services/timeframe.ts'

export const CHART_TZ_KEY = 'lr-chartTz'
/** The setting value that follows the browser's own zone. */
export const LOCAL_TZ = 'local'

export interface TzOption {
  id: string
  label: string
}
/** The zones offered in the menu; any other valid IANA zone is accepted too. */
export const TZ_OPTIONS: TzOption[] = [
  { id: LOCAL_TZ, label: 'Browser time' },
  { id: 'UTC', label: 'UTC' },
  { id: 'Pacific/Honolulu', label: 'Honolulu' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Sao_Paulo', label: 'São Paulo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Europe/Istanbul', label: 'Istanbul' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Karachi', label: 'Karachi' },
  { id: 'Asia/Kolkata', label: 'Kolkata' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: 'Pacific/Auckland', label: 'Auckland' },
]

const DAY_MS = 86_400_000

/** The browser's IANA zone ("UTC" when Intl cannot say). */
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** True when Intl knows `zone`. */
export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** A setting value, cleaned: "local", or a valid IANA zone. */
export function cleanTzSetting(v: unknown): string {
  return v === LOCAL_TZ || !isValidZone(v) ? LOCAL_TZ : v
}
/** The IANA zone a setting value stands for. */
export function resolveZone(setting: string): string {
  return setting === LOCAL_TZ ? browserZone() : setting
}

let current: string | null = null
const listeners = new Set<() => void>()

/** The stored setting: "local" (the default) or an IANA zone. */
export function getChartTzSetting(): string {
  if (current == null) current = cleanTzSetting(storageGetRaw(CHART_TZ_KEY))
  return current
}
/** The zone the charts print times in. */
export function chartZone(): string {
  return resolveZone(getChartTzSetting())
}
export function setChartTz(setting: string): void {
  const next = cleanTzSetting(setting)
  if (next === getChartTzSetting()) return
  current = next
  storageSetRaw(CHART_TZ_KEY, next)
  listeners.forEach((fn) => fn())
}
export function subscribeChartTz(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// One DateTimeFormat per zone + options: building them is the slow part.
const fmtCache = new Map<string, Intl.DateTimeFormat>()
function dtf(
  zone: string,
  opts: Intl.DateTimeFormatOptions,
  locale: string | undefined,
): Intl.DateTimeFormat {
  const key = (locale || '') + '|' + zone + '|' + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone })
    fmtCache.set(key, f)
  }
  return f
}

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  weekday: string
  monthName: string
}
/** Exact wall-clock fields from Intl — slow, so only the offset lookup uses it. */
function intlParts(ms: number, zone: string): Parts {
  const out: Record<string, string> = {}
  dtf(
    zone,
    {
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    },
    'en-US',
  )
    .formatToParts(ms)
    .forEach((p) => (out[p.type] = p.value))
  const month = Number(out.month)
  return {
    year: Number(out.year),
    month,
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: out.weekday,
    monthName: MONTHS[month - 1],
  }
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const p2 = (n: number) => String(n).padStart(2, '0')

// Offsets change only on quarter-hour boundaries, so one Intl lookup per
// zone and quarter hour serves every label in it — the axis formats many.
const QUARTER_MS = 900_000
const offsetCache = new Map<string, number>()

/** Minutes `zone` is ahead of UTC at instant `ms` (DST-aware). */
export function tzOffsetMinutes(zone: string, ms: number): number {
  if (zone === 'UTC') return 0
  const q = Math.floor(ms / QUARTER_MS) * QUARTER_MS
  const key = zone + '|' + q
  let off = offsetCache.get(key)
  if (off === undefined) {
    const p = intlParts(q, zone)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    off = Math.round((asUtc - q) / 60000)
    if (offsetCache.size > 20_000) offsetCache.clear()
    offsetCache.set(key, off)
  }
  return off
}

/** Wall-clock fields of `ms` in `zone`: the cached offset applied to UTC fields. */
function partsOf(ms: number, zone: string): Parts {
  const d = new Date(ms + tzOffsetMinutes(zone, ms) * 60000)
  const month = d.getUTCMonth() + 1
  return {
    year: d.getUTCFullYear(),
    month,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: WEEKDAYS[d.getUTCDay()],
    monthName: MONTHS[month - 1],
  }
}
/** "UTC+5", "UTC-4", "UTC+5:30" — the offset of `zone` at `ms`. */
export function tzOffsetLabel(zone: string, ms = Date.now()): string {
  return utcOffsetLabel(tzOffsetMinutes(zone, ms))
}

/** lightweight-charts' Time: UTC seconds, a business day, or "YYYY-MM-DD". */
type ChartTime = number | string | { year: number; month: number; day: number }
/** Milliseconds for a chart time; business days are UTC dates. */
function timeMs(t: ChartTime): { ms: number; dateOnly: boolean } {
  if (typeof t === 'number') return { ms: t * 1000, dateOnly: false }
  if (typeof t === 'string') return { ms: Date.parse(t + 'T00:00:00Z'), dateOnly: true }
  return { ms: Date.UTC(t.year, t.month - 1, t.day), dateOnly: true }
}

/** lightweight-charts' TickMarkType. */
export const TICK = { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 } as const

/** A tick-mark label for `ms` in `zone`: "2026", "Oct", "23", "14:30", "14:30:05". */
export function formatTick(ms: number, type: number, zone: string): string {
  const p = partsOf(ms, zone)
  switch (type) {
    case TICK.Year:
      return String(p.year)
    case TICK.Month:
      return p.monthName
    case TICK.DayOfMonth:
      return String(p.day)
    case TICK.TimeWithSeconds:
      return p2(p.hour) + ':' + p2(p.minute) + ':' + p2(p.second)
    default:
      return p2(p.hour) + ':' + p2(p.minute)
  }
}

/**
 * The crosshair's time label, as TradingView prints it: "Thu 23 Oct '26
 * 14:30" (seconds when the instant has them), or the date alone for a daily bar.
 */
export function formatCrosshair(ms: number, zone: string, dateOnly = false): string {
  const p = partsOf(ms, dateOnly ? 'UTC' : zone)
  const date = p.weekday + ' ' + p.day + ' ' + p.monthName + " '" + p2(p.year % 100)
  if (dateOnly) return date
  return date + '  ' + p2(p.hour) + ':' + p2(p.minute) + (p.second ? ':' + p2(p.second) : '')
}

/** True when a timeframe's bars are a day or longer (dated by UTC session). */
export function isDailyTf(tf: unknown): boolean {
  return tfMs(tfDef(tf)) >= DAY_MS
}

/**
 * The formatter options a chart needs to print times in `zone`. `daily`
 * reports, live, whether the chart's bars are daily or longer; omitted, the
 * chart is treated as intraday.
 */
export function chartTzOptions(
  daily: () => boolean = () => false,
  zone: string = chartZone(),
): { localization: Record<string, unknown>; timeScale: Record<string, unknown> } {
  return {
    localization: {
      timeFormatter: (t: ChartTime) => {
        const { ms, dateOnly } = timeMs(t)
        return formatCrosshair(ms, zone, dateOnly || daily())
      },
    },
    timeScale: {
      tickMarkFormatter: (t: ChartTime, type: number) => {
        const { ms, dateOnly } = timeMs(t)
        // Daily bars: dates are the UTC session's, whatever the zone.
        const z = dateOnly || (daily() && type <= TICK.DayOfMonth) ? 'UTC' : zone
        return formatTick(ms, type, z)
      },
    },
  }
}

/** A chart date read-out (tooltips, replay, drawing labels) in the chart zone, browser locale. */
export function fmtChartDate(ms: number, opts: Intl.DateTimeFormatOptions): string {
  return dtf(chartZone(), opts, undefined).format(ms)
}

/** "YYYY-MM-DD" of `ms` in the chart zone — for "is it today?" checks. */
export function chartDayKey(ms: number): string {
  const p = partsOf(ms, chartZone())
  return p.year + '-' + p2(p.month) + '-' + p2(p.day)
}
