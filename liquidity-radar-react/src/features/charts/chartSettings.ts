// Chart display settings (the gear in the chart's right rail), saved per
// browser: grid lines, magnet crosshair, last-price line, bar countdown and the
// symbol watermark — the TradingView "Chart settings" basics the chart lacked.
import { storageGet, storageSet } from '../../services/storage'

export interface ChartSettings {
  grid: boolean
  magnet: boolean
  priceLine: boolean
  countdown: boolean
  watermark: boolean
}

const KEY = 'lr-chartSettings'
export const DEFAULT_SETTINGS: ChartSettings = {
  grid: true,
  magnet: false,
  priceLine: true,
  countdown: true,
  watermark: true,
}

function read(): ChartSettings {
  const v = storageGet<Partial<ChartSettings>>(KEY, {})
  const out = { ...DEFAULT_SETTINGS }
  if (v && typeof v === 'object')
    for (const k of Object.keys(out) as Array<keyof ChartSettings>)
      if (typeof v[k] === 'boolean') out[k] = v[k] as boolean
  return out
}

let current: ChartSettings | null = null
const listeners = new Set<() => void>()

export function chartSettings(): ChartSettings {
  if (!current) current = read()
  return current
}
export function setChartSetting<K extends keyof ChartSettings>(key: K, value: ChartSettings[K]): void {
  const s = chartSettings()
  if (s[key] === value) return
  current = { ...s, [key]: value }
  storageSet(KEY, current)
  listeners.forEach((fn) => fn())
}
export function resetChartSettings(): void {
  current = { ...DEFAULT_SETTINGS }
  storageSet(KEY, current)
  listeners.forEach((fn) => fn())
}
export function subscribeChartSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
