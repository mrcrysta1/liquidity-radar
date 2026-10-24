// Saved (named) chart layouts, TradingView's "Save layout as…".
//
// A saved layout is a snapshot of everything that defines the chart setup:
// the layout (cell count, each cell's coin, timeframe and style, the active
// cell — the active cell's being the main chart's coin, timeframe and style),
// the main chart's indicators, each companion's indicators and the active
// chart's price-scale settings. Loading one puts it back through the same
// public setters the toolbar uses (companionCharts.restoreLayout, the
// indicator stores, scaleNav) — never by rewriting their storage keys.
//
// The list lives under its own key, versioned; parsing, validation and the
// list edits are pure (./savedLayoutsMath) and unit-tested.
import { storageGet, storageSet } from '../../services/storage'
import { LAYOUTS } from './layouts'
import { captureLayout, restoreLayout } from './companionCharts'
import { mainIndicatorStore, serializeIndicators } from './indicators/store'
import { panelIndicatorStore } from './indicators/panelStore'
import { getTimeframe } from './timeframes'
import { getChartStyle, styleDef } from './chartStyle'
import { scaleNavSnapshot, setInvert, setLock, setScaleMode } from './scaleNav'
import {
  addSavedLayout,
  cleanSnapshot,
  deleteSavedLayout,
  parseSavedLayouts,
  renameSavedLayout,
  serializeSavedLayouts,
} from './savedLayoutsMath'
import type { LayoutSnapshot, ListEdit, SavedLayout } from './savedLayoutsMath'

export const SAVED_LAYOUTS_KEY = 'lr-savedLayouts-v1'
const LAYOUT_NS = LAYOUTS.map((l) => l.n)

let list: SavedLayout[] = parseSavedLayouts(storageGet<unknown>(SAVED_LAYOUTS_KEY, null), LAYOUT_NS)

type Listener = () => void
const listeners: Listener[] = []
export function subscribeSavedLayouts(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
/** The saved layouts, newest first (a new array whenever the list changes). */
export const getSavedLayouts = (): readonly SavedLayout[] => list

function commit(next: SavedLayout[]): void {
  list = next
  storageSet(SAVED_LAYOUTS_KEY, serializeSavedLayouts(list))
  listeners.slice().forEach((fn) => fn())
}

/** The chart setup on screen, as a snapshot. */
export function captureSnapshot(): LayoutSnapshot {
  const lay = captureLayout()
  const panelIndicators: Record<string, unknown[]> = {}
  for (let pos = 0; pos < lay.cells.length; pos++) {
    if (pos === lay.active) continue
    const set = serializeIndicators(panelIndicatorStore('c' + pos).getIndicators())
    if (set.length) panelIndicators['c' + pos] = set
  }
  const sc = scaleNavSnapshot()
  return {
    n: lay.n,
    active: lay.active,
    cells: lay.cells.map((c) => (c ? { sym: c.sym, tf: c.tf, style: c.style } : null)),
    mainIndicators: serializeIndicators(mainIndicatorStore.getIndicators()),
    panelIndicators,
    scale: { mode: sc.mode, invert: sc.invert, lock: sc.lock },
  }
}

/** Put a snapshot back on screen. Parts that no longer validate are skipped. */
export function applySnapshot(raw: LayoutSnapshot): void {
  const snap = cleanSnapshot(raw, LAYOUT_NS)
  if (!snap) return
  const tf = getTimeframe()
  const style = getChartStyle()
  restoreLayout(
    {
      n: snap.n,
      active: snap.active,
      cells: snap.cells.map((c) =>
        c ? { sym: c.sym, tf: c.tf || tf, style: styleDef(c.style || style).id } : null,
      ),
    },
    { main: snap.mainIndicators, cells: snap.panelIndicators },
  )
  // Scale settings belong to the active cell, which restoreLayout just set.
  if (snap.scale) {
    setScaleMode(snap.scale.mode)
    setInvert(snap.scale.invert)
    if (snap.scale.lock !== scaleNavSnapshot().lock) setLock(snap.scale.lock)
  }
}

const newId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

/** Save the setup on screen as `name` (same name: overwritten). */
export function saveCurrentLayout(name: string): ListEdit {
  const r = addSavedLayout(list, name, captureSnapshot(), Date.now(), newId())
  if (!r.error) commit(r.list)
  return r
}

export function loadSavedLayout(id: string): boolean {
  const e = list.find((x) => x.id === id)
  if (!e) return false
  applySnapshot(e.snapshot)
  return true
}

export function renameLayout(id: string, name: string): ListEdit {
  const r = renameSavedLayout(list, id, name)
  if (!r.error) commit(r.list)
  return r
}

export function deleteLayout(id: string): void {
  commit(deleteSavedLayout(list, id))
}
