// The chart toolbar's "…" menu. Its children are the low-priority buttons
// (layout, replay, snapshot): while the toolbar fits on one row they sit in it
// as usual (the group is `display:contents`); once it would wrap to a second
// row — 1440px with a few indicators added — they fold into a popover behind
// "…". The buttons themselves move, not copies, so their own menus and state
// keep working.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Phones stack the header on purpose (index.css); folding only applies above. */
const WIDE = '(min-width:641px)'

/** True when the flex row has wrapped: an item starts below the first one. */
function wrapped(bar: HTMLElement): boolean {
  // The group is `display:contents` while unfolded: its buttons are the row's
  // flex items, so they are measured instead of it.
  const items = [...bar.querySelectorAll(':scope > *, :scope > .tvb-more > .tvb-more-items > *')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null,
  )
  if (items.length < 2) return false
  const top = Math.min(...items.map((el) => el.offsetTop))
  return items.some((el) => el.offsetTop > top + el.offsetHeight / 2)
}

export function ToolbarOverflow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [folded, setFolded] = useState(false)
  const [open, setOpen] = useState(false)
  /** Toolbar width when it last had to fold; unfolding is tried only past it. */
  const foldedAt = useRef(0)

  useLayoutEffect(() => {
    const bar = ref.current?.parentElement
    if (!bar) return
    const mq = window.matchMedia(WIDE)
    // ResizeObserver also fires when the bar's *height* changes, which is
    // exactly what a wrap (or an added indicator badge) does.
    const check = () => {
      const w = bar.clientWidth
      if (!mq.matches) {
        setFolded(false)
        setOpen(false)
        return
      }
      if (!bar.classList.contains('tvb-folded')) {
        if (wrapped(bar)) {
          foldedAt.current = w
          setFolded(true)
        }
      } else if (w > foldedAt.current + 8) {
        // Wider than when it folded: try the full row again; if it still
        // wraps the observer fires once more (before paint) and refolds.
        foldedAt.current = 0
        setFolded(false)
        setOpen(false)
      }
    }
    const ro = new ResizeObserver(check)
    ro.observe(bar)
    mq.addEventListener('change', check)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', check)
    }
  }, [])

  // The class lives on the toolbar so the CSS can hide the group in place.
  useLayoutEffect(() => {
    ref.current?.parentElement?.classList.toggle('tvb-folded', folded)
  }, [folded])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      ref.current?.querySelector<HTMLElement>('.tvb-more-btn')?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={'tvb-more' + (open ? ' open' : '')} ref={ref}>
      <button
        type="button"
        className={'chart-tool-btn tvb-icon tvb-more-btn' + (open ? ' open' : '')}
        aria-label="More chart tools"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" />
          <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
        </svg>
        <span className="tvb-tip">More tools</span>
      </button>
      <span className="tvb-more-items" role="group" aria-label="More chart tools">
        {children}
      </span>
    </span>
  )
}
