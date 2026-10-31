// Where the other charts read drawings from. The main chart owns the coin it
// shows (its set lives in memory and is being edited); every other coin's set
// is the one saved in storage. Layout cells and grid panels showing a coin
// read it here and repaint when it changes.
import { storageGet } from '../../../services/storage'
import type { Drawing } from './geometry'

export const DRAWINGS_KEY = 'lr-drawings-v1'

let liveSym = ''
let liveList: Drawing[] = []
let liveKey = ''
let stored: Record<string, Drawing[]> | null = null

type Listener = () => void
const listeners: Listener[] = []

export function subscribeSharedDrawings(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

let pending = false
function emitSoon(): void {
  if (pending) return
  pending = true
  const run = () => {
    pending = false
    listeners.slice().forEach((fn) => fn())
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 16)
}

/**
 * The main chart's coin and its drawings, called on every repaint. Only a real
 * change (a drawing added, moved, restyled) reaches the listeners, and only
 * when someone listens — a live tick repaints the main chart, not the cells.
 */
export function publishLiveDrawings(sym: string, list: Drawing[]): void {
  liveSym = sym
  liveList = list
  if (!listeners.length) return
  const key = sym + '\u0000' + JSON.stringify(list)
  if (key === liveKey) return
  liveKey = key
  emitSoon()
}

/** A set was written to storage: re-read it next time. */
export function storedDrawingsChanged(): void {
  stored = null
  emitSoon()
}

/** The drawings for `sym`: the main chart's live set, else the saved one. */
export function drawingsForSymbol(sym: string): Drawing[] {
  if (!sym) return []
  if (sym === liveSym) return liveList
  if (!stored) {
    const all = storageGet<Record<string, Drawing[]>>(DRAWINGS_KEY, {})
    stored = all && typeof all === 'object' ? all : {}
  }
  const list = stored[sym]
  return Array.isArray(list)
    ? list.filter((d) => !!d && typeof d.type === 'string' && Array.isArray(d.points))
    : []
}
