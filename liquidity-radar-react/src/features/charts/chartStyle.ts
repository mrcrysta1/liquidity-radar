// Chart style (candles, bars, line, area…) for the price-action chart.
//
// The catalogue lives here so the picker UI and the renderer agree on what
// exists and on which styles need OHLC data rather than a single value.
import { storageGet, storageSet } from '../../services/storage'

export type ChartStyleId =
  | 'candle'
  | 'hollow'
  | 'heikin'
  | 'bar'
  | 'hlc'
  | 'line'
  | 'linemarkers'
  | 'stepline'
  | 'area'
  | 'hlcarea'
  | 'baseline'
  | 'columns'
  | 'highlow'
  | 'volcandle'
  | 'footprint'
  | 'tpo'
  | 'sessionvp'
  | 'range'
  | 'renko'

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
  /**
   * Bars are not time-based: built from price movement (see
   * series/derivedBars — range bars, renko), with a size per coin.
   */
  rangeBars?: boolean
}

export const CHART_STYLES: ChartStyleDef[] = [
  { id: 'candle', name: 'Candles', hint: 'Filled OHLC candles', ohlc: true },
  { id: 'hollow', name: 'Hollow candles', hint: 'Outlined bodies', ohlc: true },
  { id: 'heikin', name: 'Heikin Ashi', hint: 'Averaged candles that smooth the trend', ohlc: true },
  { id: 'bar', name: 'Bars', hint: 'Classic OHLC bars', ohlc: true },
  { id: 'hlc', name: 'HLC bars', hint: 'High-low bars with a close tick', ohlc: true },
  { id: 'line', name: 'Line', hint: 'Closing price', ohlc: false },
  { id: 'linemarkers', name: 'Line with markers', hint: 'Closing price, a dot per bar', ohlc: false },
  { id: 'stepline', name: 'Step line', hint: 'Closing price, in steps', ohlc: false },
  { id: 'area', name: 'Area', hint: 'Closing price, filled', ohlc: false },
  // Drawn by series/hlcArea from the full bar, so it takes the custom-series data.
  { id: 'hlcarea', name: 'HLC area', hint: 'Close line, high–low range shaded', ohlc: true, custom: true },
  { id: 'baseline', name: 'Baseline', hint: 'Green above, red below the mid of the view', ohlc: false },
  {
    id: 'columns',
    name: 'Columns',
    hint: 'Closing price as columns, vs the previous close',
    ohlc: true,
    custom: true,
  },
  {
    id: 'highlow',
    name: 'High-low',
    hint: 'Each bar from its high to its low',
    ohlc: true,
    custom: true,
  },
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
  {
    id: 'renko',
    name: 'Renko',
    hint: 'A brick every fixed box on the close',
    ohlc: true,
    rangeBars: true,
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

// ---- Range bar / renko box size ----
// Auto sizes each coin's bars from ATR(14); manual holds a size per coin,
// because a price range that suits BTC is meaningless on a sub-dollar coin.
// Each derived style keeps its own settings (a range size and a renko box are
// set separately); `id` defaults to the style on screen.
export type RangeMode = 'auto' | 'manual'
export interface RangeSettings {
  mode: RangeMode
  /** Manual size per chart symbol, in price units. */
  size: Record<string, number>
}
const RANGE_KEYS: Record<string, string> = { range: 'lr-rangeBars', renko: 'lr-renkoBox' }
const rangeKeyFor = (id: string): string => RANGE_KEYS[id] || RANGE_KEYS.range
function loadRange(key: string): RangeSettings {
  const raw = storageGet<Record<string, unknown>>(key, {})
  const r = raw && typeof raw === 'object' ? raw : {}
  const size: Record<string, number> = {}
  const saved = r.size && typeof r.size === 'object' ? (r.size as Record<string, unknown>) : {}
  Object.keys(saved).forEach((k) => {
    const n = Number(saved[k])
    if (n > 0 && isFinite(n)) size[k] = n
  })
  return { mode: r.mode === 'manual' ? 'manual' : 'auto', size }
}
const ranges: Record<string, RangeSettings> = {}
function rangeOf(id: string): RangeSettings {
  const key = rangeKeyFor(id)
  return ranges[key] || (ranges[key] = loadRange(key))
}

export function isRangeStyle(): boolean {
  return !!styleDef(current).rangeBars
}
export function getRangeSettings(id: string = current): RangeSettings {
  const range = rangeOf(id)
  return { mode: range.mode, size: { ...range.size } }
}
/** The manual size for a symbol, or null to size automatically. */
export function manualRangeFor(sym: string, id: string = current): number | null {
  const range = rangeOf(id)
  if (range.mode !== 'manual') return null
  const n = range.size[sym]
  return n > 0 ? n : null
}

let onRangeChange: (() => void) | null = null
/** The chart registers its rebuild here — the bars change, the series does not. */
export function onRangeSettingsChange(fn: () => void): void {
  onRangeChange = fn
}
function saveRange(id: string, next: RangeSettings): void {
  const key = rangeKeyFor(id)
  ranges[key] = next
  storageSet(key, next)
  listeners.slice().forEach((fn) => fn())
  if (onRangeChange && isRangeStyle() && rangeKeyFor(current) === key) onRangeChange()
}
export function setRangeMode(mode: RangeMode, id: string = current): void {
  const range = rangeOf(id)
  if (mode === range.mode) return
  saveRange(id, { ...range, mode })
}
/** Set (or with a non-positive value, clear) the manual size for a symbol. */
export function setManualRange(sym: string, size: number, id: string = current): void {
  const next = { ...rangeOf(id).size }
  if (size > 0 && isFinite(size)) next[sym] = size
  else delete next[sym]
  saveRange(id, { mode: 'manual', size: next })
}
