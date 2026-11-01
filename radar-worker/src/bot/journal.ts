// Trade journal figures (sql/006_bot_journal.sql): how far a trade went against
// and in favour of it while open (MAE / MFE, in R), how many candles it was open
// in, and the slippage of its fill against the planned entry.
import type { Bar } from './features.ts'

export interface Excursion {
  /** Worst unrealised result while open, in R (<= 0). */
  maeR: number
  /** Best unrealised result while open, in R (>= 0). */
  mfeR: number
}

/**
 * MAE / MFE in R of a trade from `entry` with stop `sl` and target `tp`, over
 * the bars it was open in plus any prices seen directly (marks, the exit fill).
 * A bar's wick counts only up to the stop and the target — the bracket closes
 * the trade there — while the given prices count as they are (a stop can fill
 * beyond its trigger). null when the stop distance is unusable.
 */
export function excursion(t: { side: 1 | -1; entry: number; sl: number; tp: number }, bars: Bar[], prices: number[] = []): Excursion | null {
  const dist = Math.abs(t.entry - t.sl)
  if (!(dist > 0) || !isFinite(t.entry)) return null
  const lo = Math.min(t.sl, t.tp)
  const hi = Math.max(t.sl, t.tp)
  const r = (p: number) => (t.side * (p - t.entry)) / dist
  let mae = 0
  let mfe = 0
  const see = (v: number) => {
    if (!isFinite(v)) return
    if (v < mae) mae = v
    if (v > mfe) mfe = v
  }
  for (const b of bars) {
    see(r(Math.min(hi, Math.max(lo, b.l))))
    see(r(Math.min(hi, Math.max(lo, b.h))))
  }
  for (const p of prices) if (p > 0) see(r(p))
  return { maeR: mae, mfeR: mfe }
}

/** Bars of `stepMs` the trade was open in, counted from `fromMs` (the decision bar's close). */
export function barsHeld(fromMs: number, closedAtMs: number, stepMs: number): number {
  if (!(stepMs > 0) || !(closedAtMs > fromMs)) return 0
  return Math.ceil((closedAtMs - fromMs) / stepMs - 1e-9)
}

/** Bars that overlap [fromMs, toMs): opened before the close and closed after the open. */
export function barsBetween(bars: Bar[], fromMs: number, toMs: number, stepMs: number): Bar[] {
  return bars.filter((b) => b.t < toMs && b.t + stepMs > fromMs)
}

/** Fill vs planned entry in basis points; positive = worse for the trade (bought higher / sold lower). */
export function slippageBps(side: 1 | -1, planned: number, fill: number): number | null {
  if (!(planned > 0) || !(fill > 0)) return null
  return ((side * (fill - planned)) / planned) * 10_000
}
