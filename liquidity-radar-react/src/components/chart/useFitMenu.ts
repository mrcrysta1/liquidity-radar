// Keeps a dropdown that hangs off a toolbar button inside the viewport.
//
// The chart's menus are positioned by CSS next to their button. At 1366x768
// the indicator menu ran past the right edge and the drawing / panes menus
// past the bottom, cutting off their last rows and footer; on a phone the
// time-zone menu ran off the top and left. This nudges the open menu back by
// exactly the overflow (the `translate` property, so the CSS placement and the
// opening animation's transform are untouched). Menus the CSS pins to the
// viewport (position: fixed sheets on phones) are left alone.
import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

const PAD = 8

/** How far to move a box spanning [lo, hi] so it sits inside [PAD, size - PAD]; the start edge wins. */
function shift(lo: number, hi: number, size: number): number {
  if (lo < PAD) return PAD - lo
  const over = hi - (size - PAD)
  return over > 0 ? -Math.min(over, lo - PAD) : 0
}

export function useFitMenu(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  deps: unknown[] = [],
): void {
  useLayoutEffect(() => {
    if (!open) return
    const fit = () => {
      const m = ref.current
      if (!m) return
      m.style.translate = ''
      if (getComputedStyle(m).position === 'fixed') return
      const r = m.getBoundingClientRect()
      const dx = shift(r.left, r.right, window.innerWidth)
      const dy = shift(r.top, r.bottom, window.innerHeight)
      if (dx || dy) m.style.translate = dx + 'px ' + dy + 'px'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref, ...deps])
}
