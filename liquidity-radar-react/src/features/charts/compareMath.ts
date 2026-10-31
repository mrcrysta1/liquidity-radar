// Pure maths behind the compare lines (./compare): lining another market's
// closes up with the bars on the chart, and the % change the legend prints.
// No chart, no DOM, so scripts/test-engines.mjs runs it.
import type { CandleFlat } from '../../services/market'

export interface ComparePoint {
  /** Bar open time, ms — the main chart's bar this value is drawn at. */
  t: number
  v: number
}

/**
 * The close of `rows` as of each time in `times` (both oldest first): the
 * latest bar that opened at or before it. An as-of join rather than an exact
 * one, so a market that skips bars (a weekend-closed instrument, a range-bar
 * chart whose bars open at odd times) still lines up, and the compare line
 * never adds a time to the chart's time scale that its own bars do not have.
 * Times before the first row get no point.
 */
export function asOfJoin(times: number[], rows: CandleFlat[]): ComparePoint[] {
  const out: ComparePoint[] = []
  let j = -1
  for (const t of times) {
    while (j + 1 < rows.length && rows[j + 1].t <= t) j++
    if (j < 0) continue
    const v = rows[j].c
    if (Number.isFinite(v)) out.push({ t, v })
  }
  return out
}

/**
 * % change of the last point from the first one at or after `fromT` — the same
 * base lightweight-charts' percentage scale uses (the first visible value), so
 * the legend agrees with where the line sits. Null without a usable base.
 */
export function pctFrom(points: ComparePoint[], fromT: number): number | null {
  if (!points.length) return null
  const base = points.find((p) => p.t >= fromT) ?? points[points.length - 1]
  const last = points[points.length - 1]
  if (!base.v) return null
  return (last.v / base.v - 1) * 100
}

/** "+1.23%" / "−0.40%" (a true minus sign, as the OHLC legend prints it). */
export function fmtPct(p: number | null): string {
  if (p == null || !Number.isFinite(p)) return '—'
  return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(2) + '%'
}

/**
 * How many bars to load for a compare line: as deep as the chart, within
 * reason. Stepped by 500 so a new live bar on the chart (one more bar) does
 * not ask for a whole reload — only a page of history paged in does.
 */
export function compareDepth(mainBars: number): number {
  const n = Math.ceil(Math.max(0, mainBars) / 500) * 500
  return Math.max(500, Math.min(5000, n))
}

/**
 * Fold a freshly polled tail of bars into `rows` (both oldest first): bars at
 * the same open time are replaced (the forming bar moved), newer ones appended.
 */
export function mergeTail(rows: CandleFlat[], tail: CandleFlat[]): CandleFlat[] {
  if (!tail.length) return rows
  const from = tail[0].t
  const keep = rows.filter((r) => r.t < from)
  return keep.concat(tail)
}
