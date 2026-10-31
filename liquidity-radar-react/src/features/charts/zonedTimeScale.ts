// A time scale whose day, month and year boundaries are the chart zone's.
//
// lightweight-charts decides which bar gets a day label (its tick "weight")
// from the bar's UTC date, while ./timezone only rewrites the label text. In
// any zone but UTC the day number therefore landed on the bar at UTC midnight
// — 17:00 in UTC-7, 05:00 in UTC+5 — and local midnight printed as "00:00".
// This is the library's own time behaviour (lightweight-charts 4.1,
// HorzScaleBehaviorTime), reimplemented for numeric UTC timestamps, with the
// weights computed on wall-clock time in the chart zone. Daily-and-longer bars
// keep UTC sessions, as ./timezone dates them.
//
// The weight maths is pure (no chart, no DOM) so scripts/test-engines.mjs runs it.
import { chartZone, tzOffsetMinutes } from './timezone.ts'

type Any = any

/** lightweight-charts' TickMarkWeight values. */
export const WEIGHT = {
  LessThanSecond: 0,
  Second: 10,
  Minute1: 20,
  Minute5: 21,
  Minute30: 22,
  Hour1: 30,
  Hour3: 31,
  Hour6: 32,
  Hour12: 33,
  Day: 50,
  Month: 60,
  Year: 70,
} as const

const INTRADAY: Array<[number, number]> = [
  [1000, WEIGHT.Second],
  [60_000, WEIGHT.Minute1],
  [300_000, WEIGHT.Minute5],
  [1_800_000, WEIGHT.Minute30],
  [3_600_000, WEIGHT.Hour1],
  [10_800_000, WEIGHT.Hour3],
  [21_600_000, WEIGHT.Hour6],
  [43_200_000, WEIGHT.Hour12],
]

/** The library's weightByTime, on wall-clock milliseconds (zone offset applied). */
export function weightBetween(cur: number, prev: number): number {
  const a = new Date(cur)
  const b = new Date(prev)
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return WEIGHT.Year
  if (a.getUTCMonth() !== b.getUTCMonth()) return WEIGHT.Month
  if (a.getUTCDate() !== b.getUTCDate()) return WEIGHT.Day
  for (let i = INTRADAY.length - 1; i >= 0; i--) {
    const d = INTRADAY[i][0]
    if (Math.floor(prev / d) !== Math.floor(cur / d)) return INTRADAY[i][1]
  }
  return WEIGHT.LessThanSecond
}

/** UTC seconds → wall-clock milliseconds in `zone` (UTC itself for daily bars). */
export function wallMs(tSec: number, zone: string, daily: boolean): number {
  const ms = tSec * 1000
  return daily || zone === 'UTC' ? ms : ms + tzOffsetMinutes(zone, ms) * 60_000
}

/**
 * Tick weights for time points (`time.t` in UTC seconds) from `start` on —
 * the library's fillWeightsForPoints, including its guess for the first point.
 */
export function fillZonedWeights(
  points: Array<{ time: Any; timeWeight: number }>,
  start: number,
  zone: string,
  daily: boolean,
): void {
  if (!points.length) return
  const w = (i: number) => wallMs(points[i].time.t, zone, daily)
  let prev = start > 0 ? w(start - 1) : null
  let total = 0
  let prevT: number | null = start > 0 ? points[start - 1].time.t : null
  for (let i = start; i < points.length; i++) {
    const cur = w(i)
    if (prev !== null) points[i].timeWeight = weightBetween(cur, prev)
    const t = points[i].time.t
    total += t - (prevT ?? t)
    prevT = t
    prev = cur
  }
  if (start === 0 && points.length > 1) {
    // As the library does: assume the bar before the first was one average gap earlier.
    const avg = Math.ceil(total / (points.length - 1))
    const t0 = points[0].time.t
    points[0].timeWeight = weightBetween(w(0), wallMs(t0 - avg, zone, daily))
  }
}

function tickMarkType(weight: number, timeVisible: boolean, secondsVisible: boolean): number {
  if (weight >= WEIGHT.Year) return 0
  if (weight >= WEIGHT.Month) return 1
  if (weight >= WEIGHT.Day) return 2
  if (weight <= WEIGHT.Second) return timeVisible ? (secondsVisible ? 4 : 3) : 2
  return timeVisible ? 3 : 2
}

/**
 * The horizontal-scale behaviour handed to createChartEx. Internal items are
 * `{ t }` (UTC seconds): the app only ever feeds numeric timestamps.
 */
export class ZonedTimeBehavior {
  private opts: Any = null
  private readonly daily: () => boolean
  constructor(daily: () => boolean) {
    this.daily = daily
  }

  options(): Any {
    return this.opts
  }
  setOptions(o: Any): void {
    this.opts = o
  }
  updateFormatter(): void {
    /* labels come from localization.timeFormatter / tickMarkFormatter (./timezone) */
  }
  preprocessData(): void {
    /* numeric timestamps need no conversion */
  }
  createConverterToInternalObj(): (time: Any) => Any {
    return (time: Any) => ({ t: Number(time) })
  }
  convertHorzItemToInternal(item: Any): Any {
    return { t: Number(item) }
  }
  key(item: Any): number {
    return typeof item === 'object' && item !== null ? item.t : Number(item)
  }
  cacheKey(item: Any): number {
    return item.t * 1000
  }
  formatHorzItem(item: Any): string {
    const f = this.opts?.localization?.timeFormatter
    return f ? f(item.t) : new Date(item.t * 1000).toISOString().slice(0, 16).replace('T', ' ')
  }
  formatTickmark(mark: Any, loc: Any): string {
    const ts = this.opts?.timeScale || {}
    const type = tickMarkType(mark.weight, !!ts.timeVisible, !!ts.secondsVisible)
    const s = ts.tickMarkFormatter ? ts.tickMarkFormatter(mark.originalTime, type, loc?.locale) : null
    return s ?? new Date(mark.time.t * 1000).toISOString().slice(type >= 3 ? 11 : 5, type >= 3 ? 16 : 10)
  }
  maxTickMarkWeight(marks: Any[]): number {
    let max = marks.reduce((a, b) => (a.weight > b.weight ? a : b), marks[0]).weight
    // As the library does: 15:00 bold next to a plain 14:00 looks odd.
    if (max > WEIGHT.Hour1 && max < WEIGHT.Day) max = WEIGHT.Hour1
    return max
  }
  fillWeightsForPoints(points: Any[], start: number): void {
    fillZonedWeights(points, start, chartZone(), this.daily())
  }
}

/** createChart, with day boundaries in the chart zone. */
export function createZonedChart(lwc: Any, el: HTMLElement, daily: () => boolean, options: Any): Any {
  return lwc.createChartEx(el, new ZonedTimeBehavior(daily), {
    localization: { dateFormat: "dd MMM 'yy" },
    ...options,
  })
}
