// Open/closed state for the AI assistant dock.
//
// It lives outside React because the keyboard layer is plain DOM wired by the
// engine and has to toggle the same thing the launcher button does.
//
// Deliberately not persisted: the assistant starts closed on every load. A
// chat panel that reopens itself on a page the user came to read the chart on
// is in the way, and "I closed it" should stay closed.
let open = false

type Listener = (open: boolean) => void
const listeners: Listener[] = []

export function isDockOpen(): boolean {
  return open
}

export function subscribeDock(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function setDockOpen(next: boolean): void {
  if (next === open) return
  open = next
  listeners.slice().forEach((fn) => fn(open))
}

export function toggleDock(): void {
  setDockOpen(!open)
}
