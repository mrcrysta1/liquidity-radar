// Undo / redo for a coin's drawings — pure, no chart, no DOM.
//
// Undo used to pop the last drawing added, so a delete, a drag or "Clear all"
// could not be taken back. Every committed change (whatever was saved) is now
// a snapshot here, so all of them step back and forward the same way.

export interface DrawingHistory {
  /** A new coin's set was loaded: forget the previous coin's steps. */
  reset(snapshot: string): void
  /** Record a save; false when nothing actually changed. */
  commit(snapshot: string): boolean
  /** The state to return to, or null when there is nothing to undo. */
  undo(): string | null
  redo(): string | null
  canUndo(): boolean
  canRedo(): boolean
}

export function createDrawingHistory(limit = 100): DrawingHistory {
  let past: string[] = []
  let future: string[] = []
  let current = '[]'
  return {
    reset(snapshot) {
      past = []
      future = []
      current = snapshot
    },
    commit(snapshot) {
      if (snapshot === current) return false
      past.push(current)
      if (past.length > limit) past.shift()
      future = []
      current = snapshot
      return true
    },
    undo() {
      const prev = past.pop()
      if (prev == null) return null
      future.push(current)
      current = prev
      return prev
    },
    redo() {
      const next = future.pop()
      if (next == null) return null
      past.push(current)
      current = next
      return next
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
  }
}
