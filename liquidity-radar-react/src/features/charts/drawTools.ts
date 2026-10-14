// Drawing-tool state for the price-action chart: which tool is armed, whether
// the magnet is on, and how many drawings exist.
//
// The catalogue lives in drawings/catalog and the drawings themselves with the
// chart renderer (it owns the canvas and the coordinate maths); this module is
// the shared state the toolbar UI reads.
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { DRAW_GROUPS, DRAW_TOOLS, drawToolDef } from './drawings/catalog'
import type { DrawGroup, DrawToolDef } from './drawings/catalog'

export { DRAW_GROUPS, DRAW_TOOLS, drawToolDef }
export type { DrawGroup, DrawToolDef }

const MAGNET_KEY = 'lr-chartMagnet'

let tool: string | null = null
let magnet = storageGetRaw(MAGNET_KEY) === '1'
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
  return magnet
}
export function setMagnet(on: boolean): void {
  if (magnet === on) return
  magnet = on
  storageSetRaw(MAGNET_KEY, on ? '1' : '0')
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

let onUndo: (() => void) | null = null
export function onUndoDrawing(fn: () => void): void {
  onUndo = fn
}
export function undoDrawing(): void {
  if (onUndo) onUndo()
}
