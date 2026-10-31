// "Export chart data…": the chart's bars and every shown indicator output as
// CSV, TradingView-style. Pure — no DOM, no imports — so
// scripts/test-engines.mjs runs it; the menu (components/chart/ChartDataMenu)
// gathers the bars, columns and time zone and saves the file.

export interface ExportBar {
  /** Open time, ms UTC. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** One extra column: `values[i]` belongs to the bar opening at `times[i]`. */
export interface ExportColumn {
  label: string
  times: ArrayLike<number>
  values: ArrayLike<number | null | undefined>
}

export interface CsvOptions {
  bars: ExportBar[]
  columns?: ExportColumn[]
  /** Keep only bars opening within [from, to] (ms); both optional. */
  from?: number
  to?: number
  /** The chart zone's UTC offset in minutes at `ms` (0 = UTC). */
  offsetOf?: (ms: number) => number
}

/** One CSV cell: quoted when it holds a comma, quote or line break. */
export function csvCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  // A spreadsheet runs a cell starting with = + - @ as a formula. Labels come
  // from indicator and script names, so neuter that; numbers never get here.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

const p2 = (n: number): string => (n < 10 ? '0' : '') + n

/** ISO 8601 for `ms` at a fixed UTC offset: 2026-10-31T17:00:00+05:00 (Z for UTC). */
export function isoAtOffset(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000)
  const date =
    d.getUTCFullYear() +
    '-' +
    p2(d.getUTCMonth() + 1) +
    '-' +
    p2(d.getUTCDate()) +
    'T' +
    p2(d.getUTCHours()) +
    ':' +
    p2(d.getUTCMinutes()) +
    ':' +
    p2(d.getUTCSeconds())
  if (!offsetMin) return date + 'Z'
  const a = Math.abs(offsetMin)
  return date + (offsetMin < 0 ? '-' : '+') + p2(Math.floor(a / 60)) + ':' + p2(a % 60)
}

/**
 * The CSV text: a header, then one row per bar (oldest first) with its time,
 * OHLCV and each column's value at that bar's time — joined on time, so a
 * column computed over a different span still lands on the right rows, and a
 * bar it has no value for is left blank.
 */
export function buildChartCsv(o: CsvOptions): string {
  const cols = o.columns || []
  const maps = cols.map((c) => {
    const m = new Map<number, number | null | undefined>()
    const n = Math.min(c.times.length, c.values.length)
    for (let i = 0; i < n; i++) m.set(c.times[i], c.values[i])
    return m
  })
  const lines = [['time', 'open', 'high', 'low', 'close', 'volume', ...cols.map((c) => c.label)].map(csvCell).join(',')]
  const bars = o.bars
    .filter((b) => (o.from == null || b.t >= o.from) && (o.to == null || b.t <= o.to))
    .sort((a, b) => a.t - b.t)
  for (const b of bars) {
    const off = o.offsetOf ? o.offsetOf(b.t) : 0
    const row: unknown[] = [isoAtOffset(b.t, off), b.o, b.h, b.l, b.c, b.v]
    for (const m of maps) row.push(m.get(b.t))
    lines.push(row.map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/** A file name for the export: BTCUSDT-1h-2026-10-31T1700.csv (ratio symbols made safe). */
export function csvFileName(sym: string, tf: string, now: number): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_')
  return safe(sym) + '-' + safe(tf) + '-' + new Date(now).toISOString().slice(0, 16).replace(':', '') + '.csv'
}
