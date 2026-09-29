// Chart style (candles, bars, line, area…) for the price-action chart.
//
// The catalogue lives here so the picker UI and the renderer agree on what
// exists and on which styles need OHLC data rather than a single value.
import { storageGet, storageSet } from '../../services/storage'

export type ChartStyleId =
  | 'candle'
  | 'hollow'
  | 'bar'
  | 'line'
  | 'area'
  | 'baseline'
  | 'volcandle'
  | 'footprint'
  | 'tpo'
  | 'sessionvp'
  | 'range'

export interface ChartStyleDef {
  id: ChartStyleId
  name: string
  hint: string
  /** true when the series takes open/high/low/close, false for a single value. */
  ohlc: boolean
  /** Drawn by our own renderer rather than a built-in series type. */
  custom?: boolean
  /** Shown under the name where the data behind it is modelled, not measured. */
  estimate?: boolean
  /** Bars are not time-based: built from price movement (see series/rangeBars). */
  rangeBars?: boolean
}

export const CHART_STYLES: ChartStyleDef[] = [
  { id: 'candle', name: 'Candles', hint: 'Filled OHLC candles', ohlc: true },
  { id: 'hollow', name: 'Hollow candles', hint: 'Outlined bodies', ohlc: true },
  { id: 'bar', name: 'Bars', hint: 'Classic OHLC bars', ohlc: true },
  { id: 'line', name: 'Line', hint: 'Closing price', ohlc: false },
  { id: 'area', name: 'Area', hint: 'Closing price, filled', ohlc: false },
  { id: 'baseline', name: 'Baseline', hint: 'Coloured around the first close', ohlc: false },
  {
    id: 'volcandle',
    name: 'Volume candles',
    hint: 'Body width scales with volume',
    ohlc: true,
    custom: true,
  },
  {
    id: 'footprint',
    name: 'Volume footprint',
    hint: 'Buy/sell volume per price row',
    ohlc: true,
    custom: true,
    estimate: true,
  },
  {
    id: 'tpo',
    name: 'Time price opportunity',
    hint: 'Market profile letters per session',
    ohlc: true,
    custom: true,
  },
  {
    id: 'sessionvp',
    name: 'Session volume profile',
    hint: 'Volume by price, per session',
    ohlc: true,
    custom: true,
    estimate: true,
  },
  {
    id: 'range',
    name: 'Range bars',
    hint: 'A new bar every fixed price range',
    ohlc: true,
    rangeBars: true,
    estimate: true,
  },
]

export const DEFAULT_STYLE: ChartStyleId = 'candle'

const BY_ID: Record<string, ChartStyleDef> = {}
CHART_STYLES.forEach((s) => {
  BY_ID[s.id] = s
})
export function styleDef(id: unknown): ChartStyleDef {
  return BY_ID[String(id ?? '')] || BY_ID[DEFAULT_STYLE]
}

// Shares the key the chart prefs already used, so an existing choice carries over.
const KEY = 'lr-chartPrefs'
let current: ChartStyleId = (function () {
  const raw = storageGet<Record<string, unknown>>(KEY, {})
  const v = raw && typeof raw === 'object' ? raw.style : null
  return styleDef(v).id
})()

export function getChartStyle(): ChartStyleId {
  return current
}
export function isOhlcStyle(): boolean {
  return styleDef(current).ohlc
}

type Listener = () => void
const listeners: Listener[] = []
export function subscribeChartStyle(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
let onChange: (() => void) | null = null
/** The chart registers its rebuild here. */
export function onChartStyleChange(fn: () => void): void {
  onChange = fn
}

export function setChartStyle(id: ChartStyleId): void {
  const def = styleDef(id)
  if (def.id === current) return
  current = def.id
  storageSet(KEY, { style: current })
  listeners.slice().forEach((fn) => fn())
  if (onChange) onChange()
}

// ---- Range bar size ----
// Auto sizes each coin's bars from ATR(14); manual holds a size per coin,
// because a price range that suits BTC is meaningless on a sub-dollar coin.
export type RangeMode = 'auto' | 'manual'
export interface RangeSettings {
  mode: RangeMode
  /** Manual size per chart symbol, in price units. */
  size: Record<string, number>
}
const RANGE_KEY = 'lr-rangeBars'
let range: RangeSettings = (function () {
  const raw = storageGet<Record<string, unknown>>(RANGE_KEY, {})
  const r = raw && typeof raw === 'object' ? raw : {}
  const size: Record<string, number> = {}
  const saved = r.size && typeof r.size === 'object' ? (r.size as Record<string, unknown>) : {}
  Object.keys(saved).forEach((k) => {
    const n = Number(saved[k])
    if (n > 0 && isFinite(n)) size[k] = n
  })
  return { mode: r.mode === 'manual' ? 'manual' : 'auto', size }
})()

export function isRangeStyle(): boolean {
  return !!styleDef(current).rangeBars
}
export function getRangeSettings(): RangeSettings {
  return { mode: range.mode, size: { ...range.size } }
}
/** The manual size for a symbol, or null to size automatically. */
export function manualRangeFor(sym: string): number | null {
  if (range.mode !== 'manual') return null
  const n = range.size[sym]
  return n > 0 ? n : null
}

let onRangeChange: (() => void) | null = null
/** The chart registers its rebuild here — the bars change, the series does not. */
export function onRangeSettingsChange(fn: () => void): void {
  onRangeChange = fn
}
function saveRange(): void {
  storageSet(RANGE_KEY, range)
  listeners.slice().forEach((fn) => fn())
  if (onRangeChange && isRangeStyle()) onRangeChange()
}
export function setRangeMode(mode: RangeMode): void {
  if (mode === range.mode) return
  range = { ...range, mode }
  saveRange()
}
/** Set (or with a non-positive value, clear) the manual size for a symbol. */
export function setManualRange(sym: string, size: number): void {
  const next = { ...range.size }
  if (size > 0 && isFinite(size)) next[sym] = size
  else delete next[sym]
  range = { mode: 'manual', size: next }
  saveRange()
}
