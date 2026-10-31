// Chart display settings (the gear in the chart's right rail), saved per
// browser — TradingView's "Chart settings" sections: Symbol (candle colours,
// last-price line), Status line (what the legend shows), Scales (labels,
// countdown) and Canvas (background, grid, crosshair, watermark). The shape,
// validation and the options they become live in ./chartSettingsMath.
import { storageGet, storageSet } from '../../services/storage'
import { DEFAULT_SETTINGS, legendHideClasses, normalizeSettings } from './chartSettingsMath'
import type { ChartSettings } from './chartSettingsMath'

export type { ChartSettings } from './chartSettingsMath'
export { DEFAULT_SETTINGS } from './chartSettingsMath'

const KEY = 'lr-chartSettings'

let current: ChartSettings | null = null
const listeners = new Set<() => void>()

/** The legend switches are plain CSS (index.css r4-ux), for every chart at once. */
function syncLegendClasses(st: ChartSettings): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  for (const [cls, on] of Object.entries(legendHideClasses(st))) root.classList.toggle(cls, on)
}

export function chartSettings(): ChartSettings {
  if (!current) {
    current = normalizeSettings(storageGet<unknown>(KEY, {}))
    syncLegendClasses(current)
  }
  return current
}
/**
 * Listeners re-theme every chart, and a colour picker fires on each step of
 * a drag: notify once a frame, with whatever the settings are by then.
 */
let notifyFrame = 0
function commit(next: ChartSettings): void {
  current = next
  storageSet(KEY, current)
  syncLegendClasses(current)
  if (notifyFrame) return
  notifyFrame = requestAnimationFrame(() => {
    notifyFrame = 0
    listeners.forEach((fn) => fn())
  })
}
export function setChartSetting<K extends keyof ChartSettings>(key: K, value: ChartSettings[K]): void {
  const s = chartSettings()
  if (s[key] === value) return
  commit({ ...s, [key]: value })
}
export function resetChartSettings(): void {
  commit({ ...DEFAULT_SETTINGS })
}
export function subscribeChartSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
