// Drawing-tool state for the price-action chart: which tool is armed, whether
// the magnet is on, and how many drawings exist.
//
// The catalogue lives in drawings/catalog and the drawings themselves with the
// chart renderer (it owns the canvas and the coordinate maths); this module is
// the shared state the toolbar UI reads.
import { storageGet, storageGetRaw, storageSet, storageSetRaw } from '../../services/storage'
import { DRAW_GROUPS, DRAW_TOOLS, drawToolDef } from './drawings/catalog'
import type { DrawGroup, DrawToolDef } from './drawings/catalog'

export { DRAW_GROUPS, DRAW_TOOLS, drawToolDef }
export type { DrawGroup, DrawToolDef }

const MAGNET_KEY = 'lr-chartMagnet'
const STAY_KEY = 'lr-drawStay'
const FAVS_KEY = 'lr-drawFavs'
const TEMPLATES_KEY = 'lr-drawTemplates'

/**
 * Weak snaps to the nearest open/high/low/close only when the cursor is near
 * it; strong always snaps to it, as TradingView's two magnet modes. Stored as
 * '1' / '2' so the old on/off value ('1') still reads as the weak magnet.
 */
export type MagnetMode = 'off' | 'weak' | 'strong'

let tool: string | null = null
let magnetMode: MagnetMode = (() => {
  const v = storageGetRaw(MAGNET_KEY)
  return v === '2' ? 'strong' : v === '1' ? 'weak' : 'off'
})()
// Placing a drawing has always left its tool armed, so "stay in drawing mode"
// starts on; turning it off returns to the cursor after each drawing.
let stay = storageGetRaw(STAY_KEY) !== '0'
let favs: string[] = (() => {
  const v = storageGet<unknown>(FAVS_KEY, [])
  return Array.isArray(v) ? v.filter((id) => typeof id === 'string' && drawToolDef(id)) : []
})()
let count = 0
/** Points already placed for the shape in progress, for the toolbar hint. */
let pending = 0

type Listener = () => void
const listeners: Listener[] = []
export function subscribeDrawTools(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}

let onToolChange: (() => void) | null = null
/** The chart registers here to show/hide its click overlay and repaint. */
export function onDrawToolChange(fn: () => void): void {
  onToolChange = fn
}

export function getDrawTool(): string | null {
  return tool
}
export function setDrawTool(id: string | null): void {
  const next = id && drawToolDef(id) ? id : null
  if (next === tool) return
  tool = next
  pending = 0
  emit()
  if (onToolChange) onToolChange()
}
/** Clicking the armed tool again disarms it. */
export function toggleDrawTool(id: string): void {
  setDrawTool(tool === id ? null : id)
}

export function isMagnet(): boolean {
  return magnetMode !== 'off'
}
export function setMagnet(on: boolean): void {
  setMagnetMode(on ? 'weak' : 'off')
}
export function getMagnetMode(): MagnetMode {
  return magnetMode
}
export function setMagnetMode(mode: MagnetMode): void {
  if (magnetMode === mode) return
  magnetMode = mode
  storageSetRaw(MAGNET_KEY, mode === 'strong' ? '2' : mode === 'weak' ? '1' : '0')
  emit()
}

export function stayInDrawingMode(): boolean {
  return stay
}
export function setStayInDrawingMode(on: boolean): void {
  if (stay === on) return
  stay = on
  storageSetRaw(STAY_KEY, on ? '1' : '0')
  emit()
}

/** Starred tools, shown in the left strip under the quick tools. */
export function favouriteTools(): string[] {
  return favs
}
export function isFavouriteTool(id: string): boolean {
  return favs.includes(id)
}
export function toggleFavouriteTool(id: string): void {
  if (!drawToolDef(id) || id === 'erase') return
  favs = favs.includes(id) ? favs.filter((f) => f !== id) : favs.concat(id)
  storageSet(FAVS_KEY, favs)
  emit()
}

/**
 * Per-tool default style ("Save as default" on the selection toolbar): a new
 * drawing of that tool starts with it instead of the catalogue colour.
 */
export interface DrawTemplate {
  color?: string
  width?: number
  dash?: DrawDash
  fontSize?: number
}
let templates: Record<string, DrawTemplate> = (() => {
  const v = storageGet<unknown>(TEMPLATES_KEY, {})
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, DrawTemplate>) : {}
})()
export function toolTemplate(id: string): DrawTemplate | null {
  return templates[id] || null
}
export function saveToolTemplate(id: string, t: DrawTemplate): void {
  if (!drawToolDef(id)) return
  templates = { ...templates, [id]: { ...t } }
  storageSet(TEMPLATES_KEY, templates)
  emit()
}
export function resetToolTemplate(id: string): void {
  if (!templates[id]) return
  const next = { ...templates }
  delete next[id]
  templates = next
  storageSet(TEMPLATES_KEY, templates)
  emit()
}

export function drawingCount(): number {
  return count
}
export function setDrawingCount(n: number): void {
  if (n === count) return
  count = n
  emit()
}
export function pendingPoints(): number {
  return pending
}
export function setPendingPoints(n: number): void {
  if (n === pending) return
  pending = n
  emit()
}

let onClearAll: (() => void) | null = null
export function onClearAllDrawings(fn: () => void): void {
  onClearAll = fn
}
export function clearAllDrawings(): void {
  if (onClearAll) onClearAll()
}

/** Line style of a drawing, set from the selection toolbar. */
export type DrawDash = 'solid' | 'dashed' | 'dotted'
export interface SelectedDrawing {
  color: string
  width: number
  dash: DrawDash
}
/** The editable fields of a drawing, as the selection toolbar patches them. */
export interface DrawingPatch extends Partial<SelectedDrawing> {
  locked?: boolean
  hidden?: boolean
  fontSize?: number
  account?: number
  risk?: number
  /** Timeframe groups to hide on (drawings/visibility); undefined shows on all. */
  hideOn?: string[]
  /** Text box fill / border colour (border 'none' for none); undefined resets. */
  bg?: string
  border?: string
  /** Caption, or the icon tool's emoji. */
  text?: string
}
/** What the toolbar knows about the selection beyond its line style. */
export interface SelectedInfo extends SelectedDrawing {
  type: string
  locked: boolean
  hidden: boolean
  fontSize: number
  text: string | null
  account: number | null
  risk: number | null
  hideOn: string[]
  bg: string | null
  border: string | null
}
/** The drawing selected with the cursor tool, or null. */
let selected: SelectedInfo | null = null
export function selectedDrawing(): SelectedInfo | null {
  return selected
}
export function setSelectedDrawing(v: SelectedInfo | null): void {
  if (JSON.stringify(v) === JSON.stringify(selected)) return
  selected = v
  emit()
}
let onEditSel: ((patch: DrawingPatch) => void) | null = null
export function onEditSelectedDrawing(fn: (patch: DrawingPatch) => void): void {
  onEditSel = fn
}
export function editSelectedDrawing(patch: DrawingPatch): void {
  if (onEditSel) onEditSel(patch)
}

/**
 * Everything else the toolbar and the object tree ask of the chart. `i`
 * indexes the coin's drawings (back to front); left out, the selection.
 */
export type DrawingCommand =
  | { kind: 'select'; i: number }
  | { kind: 'toggle'; flag: 'locked' | 'hidden'; i?: number }
  | { kind: 'delete'; i: number }
  | { kind: 'clone' }
  | { kind: 'order'; to: 'front' | 'back' }
  | { kind: 'editText' }
let onCommand: ((cmd: DrawingCommand) => void) | null = null
export function onDrawingCommand(fn: (cmd: DrawingCommand) => void): void {
  onCommand = fn
}
export function drawingCommand(cmd: DrawingCommand): void {
  if (onCommand) onCommand(cmd)
}

/** One row of the object tree. */
export interface DrawingSummary {
  type: string
  name: string
  color: string
  locked: boolean
  hidden: boolean
  selected: boolean
}
let list: DrawingSummary[] = []
let listKey = '[]'
/** The current coin's drawings, back to front. */
export function drawingList(): DrawingSummary[] {
  return list
}
export function setDrawingList(v: DrawingSummary[]): void {
  const key = JSON.stringify(v)
  if (key === listKey) return
  listKey = key
  list = v
  emit()
}
let onDeleteSel: (() => void) | null = null
export function onDeleteSelectedDrawing(fn: () => void): void {
  onDeleteSel = fn
}
export function deleteSelectedDrawing(): void {
  if (onDeleteSel) onDeleteSel()
}

let onUndo: (() => void) | null = null
export function onUndoDrawing(fn: () => void): void {
  onUndo = fn
}
export function undoDrawing(): void {
  if (onUndo) onUndo()
}

let onRedo: (() => void) | null = null
export function onRedoDrawing(fn: () => void): void {
  onRedo = fn
}
export function redoDrawing(): void {
  if (onRedo) onRedo()
}

/** Whether there is a drawing change to undo / redo, for the buttons. */
let history = { undo: false, redo: false }
export function drawingHistory(): { undo: boolean; redo: boolean } {
  return history
}
export function setDrawingHistory(undo: boolean, redo: boolean): void {
  if (history.undo === undo && history.redo === redo) return
  history = { undo, redo }
  emit()
}
