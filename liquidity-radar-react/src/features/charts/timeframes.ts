// Timeframe store for the Radar price-action chart.
//
// The catalogue and the resampling rules live in services/timeframe; this
// module owns what the UI remembers: the selected interval, which intervals
// are pinned to the toolbar, and which accordion groups are expanded. All
// three persist.
import { state } from '../../services/store'
import {
  DEFAULT_TF,
  TF_GROUPS,
  TIMEFRAMES,
  customTfDef,
  normalizeTf,
  tfDef,
  tfLong,
  tfMs,
} from '../../services/timeframe'
import type { TfGroup, TimeframeDef } from '../../services/timeframe'
import { storageGet, storageSet, storageGetRaw, storageSetRaw } from '../../services/storage'
import { $ } from '../../utils/dom'

export { DEFAULT_TF, TF_GROUPS, TIMEFRAMES, tfDef, tfLong }
export type { TfGroup, TimeframeDef }

export const DEFAULT_FAVOURITES = ['1m', '5m', '15m', '1h', '4h', '1d']

const TF_KEY = 'lr-tf'
const FAV_KEY = 'lr-tfFavs'
const GROUP_KEY = 'lr-tfGroups'
const CUSTOM_KEY = 'lr-tfCustom'
const MAX_CUSTOM = 24

export function tfLabel(id: string): string {
  return tfDef(id).label
}

// ---- Custom intervals ----
// Typed-in intervals ("7m", "90s", "2d") the catalogue does not carry. They
// are remembered and listed with the catalogue in their group, so pinning,
// the toolbar row and the accordion treat them exactly like built-ins.
let customs: string[] = (function () {
  const saved = storageGet<unknown>(CUSTOM_KEY, null)
  if (!Array.isArray(saved)) return []
  const out: string[] = []
  saved.forEach((x) => {
    const d = typeof x === 'string' ? customTfDef(x) : null
    if (d && d.custom && out.indexOf(d.id) === -1) out.push(d.id)
  })
  return out.slice(-MAX_CUSTOM)
})()

/** Every interval on offer, ordered by length — catalogue plus custom. */
export function allTimeframes(): TimeframeDef[] {
  const list = TIMEFRAMES.concat(customs.map((id) => tfDef(id)))
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => tfMs(a.t) - tfMs(b.t) || a.i - b.i)
    .map((x) => x.t)
}
function allIds(): string[] {
  return allTimeframes().map((t) => t.id)
}
export function isCustomTf(id: string): boolean {
  return customs.indexOf(id) !== -1
}

/**
 * Add a typed interval and switch to it. Returns an error to show, or null
 * on success (an interval the catalogue already has just selects it).
 */
export function addCustomTimeframe(raw: string): string | null {
  const text = String(raw || '').trim()
  if (!text) return 'Type an interval such as 45m, 90s, 6h or 2d'
  const def = customTfDef(text)
  if (!def) {
    return /^\d+\s*[smhdwMSHDW]$/.test(text)
      ? 'Too far from a native interval to build — try a rounder number'
      : 'Use a number and a unit: s, m, h, d, w or M (e.g. 45m)'
  }
  if (def.custom && customs.indexOf(def.id) === -1) {
    customs = customs.concat([def.id]).slice(-MAX_CUSTOM)
    storageSet(CUSTOM_KEY, customs)
  }
  if (def.id === current) emit()
  else setTimeframe(def.id)
  return null
}

export function removeCustomTimeframe(id: string): void {
  if (!isCustomTf(id)) return
  customs = customs.filter((c) => c !== id)
  storageSet(CUSTOM_KEY, customs)
  if (isFavourite(id)) {
    favourites = favourites.filter((f) => f !== id)
    storageSet(FAV_KEY, favourites)
  }
  emit()
}

// ---- Favourites ----
let favourites: string[] = (function () {
  const saved = storageGet<unknown>(FAV_KEY, null)
  if (!Array.isArray(saved)) return DEFAULT_FAVOURITES.slice()
  // Keep catalogue order so the toolbar row never shuffles, and drop anything
  // that is no longer a supported interval.
  const wanted = saved.filter((x): x is string => typeof x === 'string')
  return allIds().filter((id) => wanted.indexOf(id) !== -1)
})()

export function getFavourites(): string[] {
  return favourites.slice()
}
export function isFavourite(id: string): boolean {
  return favourites.indexOf(id) !== -1
}
export function toggleFavourite(id: string): void {
  const ids = allIds()
  if (ids.indexOf(id) === -1) return
  favourites = isFavourite(id)
    ? favourites.filter((f) => f !== id)
    : ids.filter((t) => t === id || isFavourite(t))
  storageSet(FAV_KEY, favourites)
  emit()
}

// ---- Accordion groups ----
// Only the group holding the current interval starts open; whatever the user
// opens or closes from there is remembered.
let expanded: TfGroup[] = (function () {
  const saved = storageGet<unknown>(GROUP_KEY, null)
  if (!Array.isArray(saved)) return []
  const wanted = saved.filter((x): x is string => typeof x === 'string')
  return TF_GROUPS.filter((g) => wanted.indexOf(g) !== -1)
})()
let expandedSeeded = storageGetRaw(GROUP_KEY) !== null

export function isExpanded(group: TfGroup): boolean {
  if (!expandedSeeded) return group === tfDef(current).group
  return expanded.indexOf(group) !== -1
}
export function toggleGroup(group: TfGroup): void {
  const open = isExpanded(group)
  const from = expandedSeeded ? expanded : TF_GROUPS.filter((g) => isExpanded(g))
  expanded = open
    ? from.filter((g) => g !== group)
    : TF_GROUPS.filter((g) => g === group || from.indexOf(g) !== -1)
  expandedSeeded = true
  storageSet(GROUP_KEY, expanded)
  emit()
}

// ---- Current interval ----
// Restored at import time: the shell imports this module before the engine
// boots, so state.tf already holds the user's last interval by the time the
// first klines are fetched.
let current = normalizeTf(storageGetRaw(TF_KEY))
state.tf = current

export function getTimeframe(): string {
  return current
}

/** Reflect the active interval in the chart card heading. */
export function syncChartTitle(): void {
  const el = $('chartTitle')
  if (el) el.textContent = 'Price Action · ' + tfLong(current) + ' Candles'
}

type Listener = () => void
const listeners: Listener[] = []
/** Subscribe to interval/favourite changes. Returns an unsubscribe function. */
export function subscribeTimeframe(fn: Listener): () => void {
  listeners.push(fn)
  return function () {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}

let onChange: ((tf: string) => void) | null = null
/** The engine registers the reload here — the picker itself owns no data path. */
export function onTimeframeChange(fn: (tf: string) => void): void {
  onChange = fn
}

export function setTimeframe(id: string): void {
  const tf = normalizeTf(id)
  if (tf === current) return
  current = tf
  state.tf = tf
  storageSetRaw(TF_KEY, tf)
  syncChartTitle()
  emit()
  if (onChange) onChange(tf)
}
