// What the Analysis tab's panels share with the liquidation heatmap: the map
// it last built (so the zone, level and profile cards read the very numbers
// the heatmap draws, not a second estimate), the range the timeframe buttons
// pick, the overlay view, and whether the heatmap's settings row is open.
import { useSyncExternalStore } from 'react'
import type { Heatmap } from './engine'

export type HeatView = 'heat' | 'liq' | 'lev' | 'fvg'

let heat: Heatmap | null = null
let heatSym = ''
let range = '1w'
let view: HeatView = 'heat'
let tools = false
let version = 0

const listeners = new Set<() => void>()
function emit(): void {
  version++
  listeners.forEach((fn) => fn())
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function publishHeat(h: Heatmap | null, sym: string): void {
  heat = h
  heatSym = sym
  emit()
}
export const getHeat = () => ({ heat, sym: heatSym })
export const getRange = () => range
export function setRange(id: string): void {
  if (id !== range) {
    range = id
    emit()
  }
}
export const getView = () => view
export function setView(v: HeatView): void {
  view = v
  emit()
}
export const getTools = () => tools
export function setTools(open: boolean): void {
  tools = open
  emit()
}

/** Re-render whenever anything above changes. */
export function useHeatShared(): number {
  return useSyncExternalStore(subscribe, () => version)
}
