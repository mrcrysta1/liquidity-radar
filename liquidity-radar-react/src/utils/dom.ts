export const $ = (id: string): HTMLElement | null => document.getElementById(id)

export function showToast(msg: string): void {
  const t = $('toast')
  if (!t) return
  const el = t as HTMLElement & { _h?: ReturnType<typeof setTimeout> }
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(el._h)
  el._h = setTimeout(() => el.classList.remove('show'), 3200)
}

// ---- focus trap -----------------------------------------------------------
//
// Modals move focus in, keep Tab / Shift+Tab inside and hand focus back to
// whatever opened them. Escape is not handled here: the global key handler
// (features/keyboard) closes `.modal-overlay` modals and the React dialogs
// close themselves; releasing the trap restores focus on any close path.

const FOCUSABLE =
  'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
  'select:not([disabled]),textarea:not([disabled]),iframe,[contenteditable="true"],' +
  '[tabindex]:not([tabindex="-1"])'

/**
 * Where Tab (or Shift+Tab) goes from `current` among `count` focusable
 * elements, wrapping at both ends. `current` -1 means focus is outside them.
 * Returns -1 when there is nothing to focus.
 */
export function nextFocusIndex(current: number, count: number, back: boolean): number {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return back ? count - 1 : 0
  return back ? (current - 1 + count) % count : (current + 1) % count
}

/** The visible, enabled elements inside `root` that Tab can reach. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && !el.closest('[hidden],[inert]') && el.getClientRects().length > 0,
  )
}

/**
 * Trap focus inside `root` until the returned release function is called;
 * release restores focus to the element that had it when the trap was set.
 */
export function trapFocus(root: HTMLElement, opener: Element | null = document.activeElement): () => void {
  const first = focusables(root)[0]
  // Focus already inside (an autoFocus field) stays where it is.
  if (!root.contains(document.activeElement)) {
    if (first) first.focus()
    else {
      if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      root.focus()
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const list = focusables(root)
    const i = nextFocusIndex(list.indexOf(document.activeElement as HTMLElement), list.length, e.shiftKey)
    e.preventDefault()
    if (i < 0) root.focus()
    else list[i].focus()
  }
  document.addEventListener('keydown', onKey, true)
  let done = false
  return () => {
    if (done) return
    done = true
    document.removeEventListener('keydown', onKey, true)
    const back = opener as HTMLElement | null
    if (back && back.isConnected && typeof back.focus === 'function') back.focus()
  }
}

const traps = new Map<string, () => void>()

export function openModal(id: string): void {
  const m = $(id)
  if (!m) return
  if (!m.getAttribute('role')) m.setAttribute('role', 'dialog')
  if (!m.hasAttribute('aria-modal')) m.setAttribute('aria-modal', 'true')
  m.classList.add('open')
  if (traps.has(id)) return
  const release = trapFocus((m.querySelector('.modal-box') as HTMLElement | null) ?? m)
  // Closed by any path — closeModal, the global Escape handler, a backdrop
  // click — the class goes, and so does the trap.
  const mo = new MutationObserver(() => {
    if (m.classList.contains('open')) return
    mo.disconnect()
    traps.delete(id)
    release()
  })
  mo.observe(m, { attributes: true, attributeFilter: ['class'] })
  traps.set(id, () => {
    mo.disconnect()
    traps.delete(id)
    release()
  })
}

export function closeModal(id: string): void {
  const m = $(id)
  if (m) m.classList.remove('open')
  traps.get(id)?.()
}
