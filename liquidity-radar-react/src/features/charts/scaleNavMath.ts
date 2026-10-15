// Pure helpers behind the price-scale and navigation controls (scaleNav.ts).
// No DOM, chart or storage here, so scripts/test-engines.mjs can run them.

/** Price-scale modes, as on TradingView's price-scale menu. */
export type ScaleMode = 'normal' | 'log' | 'percent' | 'indexed'
export const SCALE_MODES: ScaleMode[] = ['normal', 'log', 'percent', 'indexed']
/** lightweight-charts PriceScaleMode values (Normal, Logarithmic, Percentage, IndexedTo100). */
export const LWC_SCALE_MODE: Record<ScaleMode, number> = {
  normal: 0,
  log: 1,
  percent: 2,
  indexed: 3,
}

/** What is remembered per chart (per layout cell). */
export interface ScalePrefs {
  mode: ScaleMode
  invert: boolean
  /** Lock price-to-bar ratio: zooming time zooms price with it. Normal mode only. */
  lock: boolean
}
export const DEFAULT_SCALE_PREFS: ScalePrefs = { mode: 'normal', invert: false, lock: false }

export function cleanScalePrefs(raw: unknown): ScalePrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode = SCALE_MODES.indexOf(r.mode as ScaleMode) !== -1 ? (r.mode as ScaleMode) : 'normal'
  return { mode, invert: r.invert === true, lock: r.lock === true && mode === 'normal' }
}

// ---- Date-range quick buttons ----
export type RangeId = '1D' | '5D' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | '5Y' | 'All'
export interface RangePreset {
  id: RangeId
  title: string
  /**
   * The interval the range is shown on. Picked so the span fits in one load
   * (marketData loads ~500 bars), so the whole range is on screen at once.
   */
  tf: string
}
export const RANGE_PRESETS: RangePreset[] = [
  { id: '1D', title: '1 day', tf: '5m' },
  { id: '5D', title: '5 days', tf: '15m' },
  { id: '1M', title: '1 month', tf: '2h' },
  { id: '3M', title: '3 months', tf: '6h' },
  { id: '6M', title: '6 months', tf: '12h' },
  { id: 'YTD', title: 'Year to date', tf: '1d' },
  { id: '1Y', title: '1 year', tf: '1d' },
  { id: '5Y', title: '5 years', tf: '1w' },
  { id: 'All', title: 'All data', tf: '1w' },
]
export function rangePreset(id: string): RangePreset | null {
  return RANGE_PRESETS.find((p) => p.id === id) || null
}

const DAY = 86400000
/** Start of range `id` (ms) ending at `now`, in local calendar terms; null means everything. */
export function rangeStartMs(id: string, now: number): number | null {
  const d = new Date(now)
  switch (id) {
    case '1D':
      return now - DAY
    case '5D':
      return now - 5 * DAY
    case '1M':
      d.setMonth(d.getMonth() - 1)
      return d.getTime()
    case '3M':
      d.setMonth(d.getMonth() - 3)
      return d.getTime()
    case '6M':
      d.setMonth(d.getMonth() - 6)
      return d.getTime()
    case 'YTD':
      return new Date(d.getFullYear(), 0, 1).getTime()
    case '1Y':
      d.setFullYear(d.getFullYear() - 1)
      return d.getTime()
    case '5Y':
      d.setFullYear(d.getFullYear() - 5)
      return d.getTime()
    default:
      return null
  }
}

/** "UTC", "UTC+2", "UTC+5:30", "UTC-3" for an offset east of UTC in minutes. */
export function utcOffsetLabel(offsetMin: number): string {
  if (!offsetMin) return 'UTC'
  const sign = offsetMin > 0 ? '+' : '-'
  const a = Math.abs(Math.round(offsetMin))
  const h = Math.floor(a / 60)
  const m = a % 60
  return 'UTC' + sign + h + (m ? ':' + String(m).padStart(2, '0') : '')
}

/**
 * A logical range zoomed by `factor` (>1 zooms in). Anchored on the right
 * edge — what TradingView's zoom buttons do while the latest bar is in view —
 * or on the centre when the chart is scrolled back into history.
 */
export function zoomLogicalRange(
  r: { from: number; to: number },
  factor: number,
  anchorRight: boolean,
  minBars = 5,
  maxBars = 5000,
): { from: number; to: number } {
  const w = r.to - r.from
  const nw = Math.max(minBars, Math.min(maxBars, w / factor))
  if (anchorRight) return { from: r.to - nw, to: r.to }
  const mid = (r.from + r.to) / 2
  return { from: mid - nw / 2, to: mid + nw / 2 }
}
