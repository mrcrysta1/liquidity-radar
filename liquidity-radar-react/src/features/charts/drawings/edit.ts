// Selecting and editing a placed drawing: what is under the cursor, and where
// its anchors go when it is dragged. Pure maths on the pixel shapes from
// ./geometry and the bar times on screen — no chart, no DOM — so the eraser,
// the selection and the tests all agree on what a click hits.
import type { Pt, Shape } from './geometry'
import { logicalToTime, timeToLogical } from './timeMap.ts'

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
    // Soft segments are decoration behind the shape (fib rails, TP/SL rails).
    if (g.soft) continue
    if (pointToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= HIT_PX) return true
  }
  for (const a of sh.arcs) if (nearEllipse(a, x, y)) return true
  // Inside a filled area (rectangle, zone, ellipse fill) counts, as on TradingView.
  for (const f of sh.fills) if (insidePolygon(f.pts, x, y)) return true
  for (const l of sh.labels) {
    if (!l.box) continue
    const [lo, hi] = labelSpan(l)
    if (x >= lo && x <= hi && Math.abs(l.y - y) < 12) return true
  }
  return false
}

/**
 * Horizontal extent of a boxed label. The text is measured by eye (no canvas
 * here): about 6.5px a character at the 11px label font, plus the padding.
 * A fixed ±60px around x missed the right of long left-aligned labels and
 * caught clicks on empty space to their left.
 */
export function labelSpan(l: { x: number; text: string; align?: 'left' | 'right' | 'center' }): [number, number] {
  const w = l.text.length * 6.5 + 12
  if (l.align === 'left') return [l.x, l.x + w]
  if (l.align === 'right') return [l.x - w, l.x]
  return [l.x - w / 2, l.x + w / 2]
}

/** On an ellipse's outline, within the hit radius. */
function nearEllipse(a: Shape['arcs'][number], x: number, y: number): boolean {
  const rx = Math.abs(a.rx)
  const ry = Math.abs(a.ry)
  if (!rx || !ry) return false
  const r = Math.hypot((x - a.cx) / rx, (y - a.cy) / ry)
  return Math.abs(r - 1) * Math.min(rx, ry) <= HIT_PX
}

/** Point in a polygon given as flat x, y pairs (even-odd rule). */
export function insidePolygon(pts: number[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]
    const yi = pts[i + 1]
    const xj = pts[j]
    const yj = pts[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
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
 * whole bars, counted in bar-index space so anchors past the last bar (a
 * position's target, a fib extension) or before the first loaded one move
 * too; they used to be clamped to the loaded bars, so such a drawing could not
 * be dragged towards that side at all. `movePrice` maps a price to the dragged
 * price (done in pixels by the caller, so a log scale moves evenly); null
 * leaves that anchor's price unchanged.
 */
export function shiftPoints(
  start: Pt[],
  dBars: number,
  times: number[],
  movePrice: (price: number) => number | null,
): Pt[] {
  if (times.length < 2) return start.map((p) => ({ ...p }))
  const d = Math.round(dBars)
  return start.map((p) => {
    const np = movePrice(p.price)
    const l = timeToLogical(times, p.time)
    const base = l == null ? null : Math.round(l)
    const t0 = base == null ? null : logicalToTime(times, base)
    const t1 = base == null ? null : logicalToTime(times, base + d)
    return {
      // Shift by whole bars and keep any offset inside the bar (an anchor
      // placed on a lower timeframe), so a purely vertical drag keeps times.
      time: t0 == null || t1 == null ? p.time : p.time + (t1 - t0),
      price: np != null && Number.isFinite(np) ? np : p.price,
    }
  })
}
