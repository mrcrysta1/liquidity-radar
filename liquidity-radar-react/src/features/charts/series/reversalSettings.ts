// Settings for the price-reversal chart types (Line break, Kagi, Point &
// Figure), and the one place that turns candles into the bars a
// non-time-based style draws.
//
// These styles ride the range-bar plumbing (`rangeBars: true` in
// chartStyle): synthetic times, the seconds time axis, live rebuilds, the
// hidden close timer. Kagi (in ATR mode) and Point & Figure also share the
// range-bar size — auto ATR(14) or a manual size per coin — as their
// reversal amount and box size; only what is specific to each lives here.
import { storageGet, storageSet } from '../../../services/storage'
import type { CandleFlat } from '../../../services/market'
import type { ChartStyleId } from '../chartStyle'
import { buildDerivedBars } from './derivedBars'
import { DEFAULT_LINE_BREAK, buildLineBreak, clampLineBreak } from './lineBreak'
import { DEFAULT_KAGI_PCT, buildKagi } from './kagi'
import { DEFAULT_PNF_REVERSAL, buildPointFigure, clampPnfReversal } from './pointFigure'
import { DEFAULT_TICKS, clampTicks } from '../orderflow/tickBars'
import { tickBarsFor, tickKey } from '../orderflow/tickSource'

export type KagiMode = 'atr' | 'pct'
export interface ReversalSettings {
  /** Lines a reversal has to break (Line break). */
  lineBreak: number
  /** Kagi reversal: the range-bar (ATR) size, or a percentage of price. */
  kagiMode: KagiMode
  kagiPct: number
  /** Boxes a Point & Figure reversal needs. */
  pnfReversal: number
  /** Trades per bar (Tick bars). */
  ticks: number
}

export const MIN_KAGI_PCT = 0.05
export const MAX_KAGI_PCT = 50
export function clampKagiPct(n: unknown): number {
  const v = Number(n)
  if (!(v > 0) || !isFinite(v)) return DEFAULT_KAGI_PCT
  return Math.max(MIN_KAGI_PCT, Math.min(MAX_KAGI_PCT, v))
}

const KEY = 'lr-reversalCharts'
let cur: ReversalSettings = (function () {
  const raw = storageGet<Record<string, unknown>>(KEY, {})
  const r = raw && typeof raw === 'object' ? raw : {}
  return {
    lineBreak: r.lineBreak == null ? DEFAULT_LINE_BREAK : clampLineBreak(r.lineBreak),
    kagiMode: r.kagiMode === 'pct' ? 'pct' : 'atr',
    kagiPct: r.kagiPct == null ? DEFAULT_KAGI_PCT : clampKagiPct(r.kagiPct),
    pnfReversal: r.pnfReversal == null ? DEFAULT_PNF_REVERSAL : clampPnfReversal(r.pnfReversal),
    ticks: r.ticks == null ? DEFAULT_TICKS : clampTicks(r.ticks),
  }
})()

export function getReversalSettings(): ReversalSettings {
  return { ...cur }
}

type Listener = () => void
const listeners: Listener[] = []
/** Fires after any change: the picker re-renders, the chart rebuilds its bars. */
export function subscribeReversalSettings(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
export function setReversalSettings(patch: Partial<ReversalSettings>): void {
  const next: ReversalSettings = {
    lineBreak: clampLineBreak(patch.lineBreak ?? cur.lineBreak),
    kagiMode: (patch.kagiMode ?? cur.kagiMode) === 'pct' ? 'pct' : 'atr',
    kagiPct: clampKagiPct(patch.kagiPct ?? cur.kagiPct),
    pnfReversal: clampPnfReversal(patch.pnfReversal ?? cur.pnfReversal),
    ticks: clampTicks(patch.ticks ?? cur.ticks),
  }
  if (JSON.stringify(next) === JSON.stringify(cur)) return
  cur = next
  storageSet(KEY, cur)
  listeners.slice().forEach((fn) => fn())
}

/** The reversal styles this module owns. */
export function isReversalStyle(id: ChartStyleId): boolean {
  return id === 'linebreak' || id === 'kagi' || id === 'pnf' || id === 'tick'
}

/** Whether the style is sized by the shared range-bar size, and what to call it. */
export function rangeSizeLabel(id: ChartStyleId): string | null {
  if (id === 'linebreak' || id === 'tick') return null
  if (id === 'kagi') return cur.kagiMode === 'atr' ? 'Reversal' : null
  if (id === 'pnf' || id === 'renko') return 'Box size'
  return 'Range size'
}

/** A key that changes whenever the settings behind `id`'s bars do. */
export function reversalKey(id: ChartStyleId): string {
  if (id === 'linebreak') return 'lb' + cur.lineBreak
  if (id === 'kagi') return 'kg' + cur.kagiMode + cur.kagiPct
  if (id === 'pnf') return 'pf' + cur.pnfReversal
  // The tape grows with every trade, so the key moves with it.
  if (id === 'tick') return tickKey(cur.ticks)
  return ''
}

/**
 * The bars a non-time-based style draws, built from time candles. `size` is
 * the range-bar size (rangeView's rangeSizeInfo, or a companion's own).
 */
export function buildStyleBars(id: ChartStyleId, src: CandleFlat[], size: number): CandleFlat[] {
  if (id === 'linebreak') return buildLineBreak(src, cur.lineBreak)
  if (id === 'kagi')
    return cur.kagiMode === 'pct' ? buildKagi(src, cur.kagiPct, true) : buildKagi(src, size)
  if (id === 'pnf') return buildPointFigure(src, size, cur.pnfReversal)
  // Not built from `src` at all: from the trade tape, for the focused symbol only.
  if (id === 'tick') return tickBarsFor(src, cur.ticks)
  return buildDerivedBars(id, src, size)
}
