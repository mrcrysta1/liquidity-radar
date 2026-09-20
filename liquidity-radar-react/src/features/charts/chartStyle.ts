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
