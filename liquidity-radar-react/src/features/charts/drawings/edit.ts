// Selecting and editing a placed drawing: what is under the cursor, and where
// its anchors go when it is dragged. Pure maths on the pixel shapes from
// ./geometry and the bar times on screen — no chart, no DOM — so the eraser,
// the selection and the tests all agree on what a click hits.
import type { Pt, Shape } from './geometry'

/** How close (px) a click must land to a line to hit it. */
export const HIT_PX = 7
/** How close (px) a click must land to an anchor handle to grab it. */
export const HANDLE_PX = 8

export function pointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  let t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** Whether a pixel position touches a drawing's lines or boxed labels. */
export function hitShape(sh: Shape, x: number, y: number): boolean {
  for (const g of sh.segs) {
    if (pointToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= HIT_PX) return true
  }
  for (const l of sh.labels) {
    if (l.box && Math.abs(l.x - x) < 60 && Math.abs(l.y - y) < 12) return true
  }
  return false
}

/** Index of the anchor handle under a pixel position, or -1. */
export function handleAt(sh: Shape, x: number, y: number): number {
  let best = -1
  let bestD = HANDLE_PX
  sh.handles.forEach((h, i) => {
    const d = Math.hypot(h.x - x, h.y - y)
    if (d <= bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/** Index of the bar time nearest to `t` in an ascending list of bar times. */
export function nearestBar(times: number[], t: number): number {
  if (!times.length) return -1
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) return lo - 1
  return lo
}

/**
 * Move a whole drawing by `dBars` bars and a price shift. Each anchor moves by
 * whole bars of the data on screen, and the shift in time is clamped so the shape keeps its form at
 * the ends of the data instead of squashing against them. `movePrice` maps a
 * price to the dragged price (done in pixels by the caller, so a log scale
 * moves evenly); null leaves that anchor's price unchanged.
 */
export function shiftPoints(
  start: Pt[],
  dBars: number,
  times: number[],
  movePrice: (price: number) => number | null,
): Pt[] {
  if (!times.length) return start.map((p) => ({ ...p }))
  const idx = start.map((p) => nearestBar(times, p.time))
  const lo = Math.min(...idx)
  const hi = Math.max(...idx)
  const d = Math.max(-lo, Math.min(times.length - 1 - hi, Math.round(dBars)))
  return start.map((p, i) => {
    const np = movePrice(p.price)
    return {
      // Shift by whole bars and keep any offset inside the bar (an anchor
      // placed on a lower timeframe), so a purely vertical drag keeps times.
      time: p.time + (times[idx[i] + d] - times[idx[i]]),
      price: np != null && Number.isFinite(np) ? np : p.price,
    }
  })
}
