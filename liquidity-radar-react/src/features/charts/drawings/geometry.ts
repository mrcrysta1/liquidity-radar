// Turns a drawing into pixels.
//
// Every tool resolves to the same small vocabulary — segments, fills, arcs,
// labels and handles — which the renderer paints and the eraser hit-tests. One
// description, so what you can click is always what you can see.
import { FIB_EXT_LEVELS, FIB_LEVELS, drawToolDef } from './catalog'

export interface Pt {
  time: number
  price: number
}
export interface Drawing {
  type: string
  points: Pt[]
  color: string
  text?: string
}

export interface Seg {
  x1: number
  y1: number
  x2: number
  y2: number
  dash?: number[]
  color?: string
  width?: number
  /** Skip in hit-testing — decoration like fib rails behind the main shape. */
  soft?: boolean
}
export interface Fill {
  pts: number[]
  color: string
}
export interface Arc {
  cx: number
  cy: number
  rx: number
  ry: number
  color?: string
  dash?: number[]
}
export interface Label {
  x: number
  y: number
  text: string
  color?: string
  align?: 'left' | 'right' | 'center'
  box?: boolean
}
export interface Shape {
  segs: Seg[]
  fills: Fill[]
  arcs: Arc[]
  labels: Label[]
  handles: Array<{ x: number; y: number }>
}

export interface MapCtx {
  x(time: number): number | null
  y(price: number): number | null
  cw: number
  ch: number
  fmt(price: number): string
  /** Closes of the bars between two times, for the regression channel. */
  closesBetween(t1: number, t2: number): number[]
  barsBetween(t1: number, t2: number): number
  timeLabel(time: number): string
}

const empty = (): Shape => ({ segs: [], fills: [], arcs: [], labels: [], handles: [] })

/** Extend a line beyond p2 (and optionally before p1) to the canvas edges. */
function extend(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cw: number,
  ch: number,
  back: boolean,
): [number, number, number, number] {
  const dx = x2 - x1
  const dy = y2 - y1
  let ax = x1
  let ay = y1
  let bx = x2
  let by = y2
  if (dx === 0) {
    by = dy >= 0 ? ch : 0
    if (back) ay = dy >= 0 ? 0 : ch
    return [ax, ay, bx, by]
  }
  const tf = (dx > 0 ? cw - x1 : -x1) / dx
  if (tf > 1) {
    bx = x1 + dx * tf
    by = y1 + dy * tf
  }
  if (back) {
    const tb = (dx > 0 ? -x1 : cw - x1) / dx
    ax = x1 + dx * tb
    ay = y1 + dy * tb
  }
  return [ax, ay, bx, by]
}

const rgba = (hex: string, a: number): string => {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

const PATTERN_LABELS: Record<string, string[]> = {
  abcd: ['A', 'B', 'C', 'D'],
  xabcd: ['X', 'A', 'B', 'C', 'D'],
  headshoulders: ['', 'LS', '', 'H', '', 'RS', ''],
  elliott5: ['0', '1', '2', '3', '4', '5'],
  elliottabc: ['0', 'A', 'B', 'C'],
}

/** Pixel geometry for one drawing, or null when it cannot be placed. */
export function shape(d: Drawing, c: MapCtx): Shape | null {
  const def = drawToolDef(d.type)
  if (!def) return null
  const P: Array<{ x: number; y: number }> = []
  for (const pt of d.points) {
    const x = c.x(pt.time)
    const y = c.y(pt.price)
    if (x == null || y == null) return null
    P.push({ x, y })
  }
  if (!P.length) return null
  const s = empty()
  const col = d.color
  const A = P[0]
  const B = P[1]
  s.handles = P.map((p) => ({ x: p.x, y: p.y }))

  switch (d.type) {
    case 'trend':
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
      break

    case 'ray': {
      const [, , ex, ey] = extend(A.x, A.y, B.x, B.y, c.cw, c.ch, false)
      s.segs.push({ x1: A.x, y1: A.y, x2: ex, y2: ey })
      break
    }
    case 'extended': {
      const [sx, sy, ex, ey] = extend(A.x, A.y, B.x, B.y, c.cw, c.ch, true)
      s.segs.push({ x1: sx, y1: sy, x2: ex, y2: ey })
      break
    }
    case 'arrow': {
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
      const ang = Math.atan2(B.y - A.y, B.x - A.x)
      const h = 11
      for (const off of [2.6, -2.6]) {
        s.segs.push({
          x1: B.x,
          y1: B.y,
          x2: B.x - h * Math.cos(ang + off / 4),
          y2: B.y - h * Math.sin(ang + off / 4),
          soft: true,
        })
      }
      break
    }
    case 'hline':
      s.segs.push({ x1: 0, y1: A.y, x2: c.cw, y2: A.y, dash: [5, 4] })
      s.labels.push({ x: A.x + 6, y: A.y - 5, text: c.fmt(d.points[0].price) })
      break

    case 'hray':
      s.segs.push({ x1: A.x, y1: A.y, x2: c.cw, y2: A.y })
      s.labels.push({ x: A.x + 6, y: A.y - 5, text: c.fmt(d.points[0].price) })
      break

    case 'vline':
      s.segs.push({ x1: A.x, y1: 0, x2: A.x, y2: c.ch, dash: [5, 4] })
      s.labels.push({ x: A.x + 5, y: 12, text: c.timeLabel(d.points[0].time) })
      break

    case 'cross':
      s.segs.push({ x1: 0, y1: A.y, x2: c.cw, y2: A.y, dash: [4, 4] })
      s.segs.push({ x1: A.x, y1: 0, x2: A.x, y2: c.ch, dash: [4, 4] })
      s.labels.push({ x: A.x + 6, y: A.y - 5, text: c.fmt(d.points[0].price) })
      break

    case 'infoline':
    case 'measure': {
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
      const dp = d.points[1].price - d.points[0].price
      const pct = d.points[0].price ? (dp / d.points[0].price) * 100 : 0
      const bars = c.barsBetween(d.points[0].time, d.points[1].time)
      const txt = (dp >= 0 ? '+' : '') + c.fmt(dp) + '  ' + pct.toFixed(2) + '%  ' + bars + ' bars'
      s.labels.push({
        x: (A.x + B.x) / 2,
        y: Math.min(A.y, B.y) - 8,
        text: txt,
        align: 'center',
        box: true,
      })
      if (d.type === 'measure') {
        s.fills.push({ pts: [A.x, A.y, B.x, A.y, B.x, B.y, A.x, B.y], color: rgba(col, 0.12) })
        s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: A.y, dash: [3, 3], soft: true })
        s.segs.push({ x1: B.x, y1: A.y, x2: B.x, y2: B.y, dash: [3, 3], soft: true })
      }
      break
    }

    case 'parallel': {
      const C = P[2]
      // Offset of the third point from the base line, applied as the channel width.
      const dy = C.y - (A.y + ((B.y - A.y) * (C.x - A.x)) / (B.x - A.x || 1))
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
      s.segs.push({ x1: A.x, y1: A.y + dy, x2: B.x, y2: B.y + dy })
      s.fills.push({
        pts: [A.x, A.y, B.x, B.y, B.x, B.y + dy, A.x, A.y + dy],
        color: rgba(col, 0.1),
      })
      break
    }
    case 'flatchannel': {
      const top = Math.min(A.y, B.y)
      const bot = Math.max(A.y, B.y)
      s.segs.push({ x1: 0, y1: top, x2: c.cw, y2: top })
      s.segs.push({ x1: 0, y1: bot, x2: c.cw, y2: bot })
      s.fills.push({ pts: [0, top, c.cw, top, c.cw, bot, 0, bot], color: rgba(col, 0.1) })
      s.labels.push({
        x: 6,
        y: top - 5,
        text: c.fmt(Math.max(d.points[0].price, d.points[1].price)),
      })
      s.labels.push({
        x: 6,
        y: bot + 13,
        text: c.fmt(Math.min(d.points[0].price, d.points[1].price)),
      })
      break
    }
    case 'regression': {
      const closes = c.closesBetween(d.points[0].time, d.points[1].time)
      if (closes.length < 2) {
        s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
        break
      }
      const n = closes.length
      let sx = 0
      let sy = 0
      let sxy = 0
      let sxx = 0
      closes.forEach((v, i) => {
        sx += i
        sy += v
        sxy += i * v
        sxx += i * i
      })
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1)
      const inter = (sy - slope * sx) / n
      let sse = 0
      closes.forEach((v, i) => {
        const e = v - (inter + slope * i)
        sse += e * e
      })
      const sd = Math.sqrt(sse / n)
      const y0 = c.y(inter)
      const y1 = c.y(inter + slope * (n - 1))
      const yU = c.y(inter + 2 * sd)
      if (y0 == null || y1 == null || yU == null) return null
      const band = Math.abs(yU - y0)
      const lx = Math.min(A.x, B.x)
      const rx = Math.max(A.x, B.x)
      s.segs.push({ x1: lx, y1: y0, x2: rx, y2: y1 })
      s.segs.push({ x1: lx, y1: y0 - band, x2: rx, y2: y1 - band, dash: [4, 4] })
      s.segs.push({ x1: lx, y1: y0 + band, x2: rx, y2: y1 + band, dash: [4, 4] })
      s.fills.push({
        pts: [lx, y0 - band, rx, y1 - band, rx, y1 + band, lx, y0 + band],
        color: rgba(col, 0.09),
      })
      break
    }
    case 'pitchfork': {
      const C = P[2]
      const mx = (B.x + C.x) / 2
      const my = (B.y + C.y) / 2
      const [, , ex, ey] = extend(A.x, A.y, mx, my, c.cw, c.ch, false)
      s.segs.push({ x1: A.x, y1: A.y, x2: ex, y2: ey })
      const dx = ex - A.x
      const dy = ey - A.y
      s.segs.push({ x1: B.x, y1: B.y, x2: B.x + dx, y2: B.y + dy })
      s.segs.push({ x1: C.x, y1: C.y, x2: C.x + dx, y2: C.y + dy })
      s.segs.push({ x1: B.x, y1: B.y, x2: C.x, y2: C.y, dash: [4, 4], soft: true })
      s.fills.push({
        pts: [B.x, B.y, B.x + dx, B.y + dy, C.x + dx, C.y + dy, C.x, C.y],
        color: rgba(col, 0.08),
      })
      break
    }

    case 'fibretr':
    case 'fibext': {
      const levels = d.type === 'fibretr' ? FIB_LEVELS : FIB_EXT_LEVELS
      let base: number
      let span: number
      let lx: number
      let rx: number
      if (d.type === 'fibretr') {
        base = d.points[0].price
        span = d.points[1].price - base
        lx = Math.min(A.x, B.x)
        rx = Math.max(A.x, B.x)
      } else {
        const C = P[2]
        base = d.points[2].price
        span = d.points[1].price - d.points[0].price
        lx = Math.min(A.x, C.x)
        rx = Math.max(B.x, C.x)
        s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y, dash: [3, 3], soft: true })
        s.segs.push({ x1: B.x, y1: B.y, x2: C.x, y2: C.y, dash: [3, 3], soft: true })
      }
      let prevY: number | null = null
      levels.forEach((lv) => {
        const py = c.y(base + span * lv)
        if (py == null) return
        s.segs.push({
          x1: lx,
          y1: py,
          x2: c.cw,
          y2: py,
          dash: lv === 0 || lv === 1 ? undefined : [4, 3],
        })
        s.labels.push({
          x: lx + 5,
          y: py - 4,
          text: (lv * 100).toFixed(1) + '%  ' + c.fmt(base + span * lv),
        })
        if (prevY != null)
          s.fills.push({ pts: [lx, prevY, rx, prevY, rx, py, lx, py], color: rgba(col, 0.05) })
        prevY = py
      })
      break
    }
    case 'fibfan': {
      const dx = B.x - A.x
      const dy = B.y - A.y
      FIB_LEVELS.forEach((lv) => {
        const ty = A.y + dy * lv
        const [, , ex, ey] = extend(A.x, A.y, B.x, ty, c.cw, c.ch, false)
        s.segs.push({
          x1: A.x,
          y1: A.y,
          x2: ex,
          y2: ey,
          dash: lv === 0 || lv === 1 ? undefined : [4, 3],
        })
      })
      s.segs.push({ x1: A.x, y1: A.y, x2: A.x + dx, y2: A.y, dash: [2, 3], soft: true })
      break
    }
    case 'fibtime': {
      const unit = B.x - A.x
      if (!unit) break
      const fib = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55]
      fib.forEach((f) => {
        const vx = A.x + unit * f
        if (vx < -20 || vx > c.cw + 20) return
        s.segs.push({ x1: vx, y1: 0, x2: vx, y2: c.ch, dash: [4, 4] })
        s.labels.push({ x: vx + 4, y: c.ch - 6, text: String(f) })
      })
      break
    }
    case 'fibcircle': {
      const r = Math.hypot(B.x - A.x, B.y - A.y)
      FIB_LEVELS.filter((l) => l > 0).forEach((lv) => {
        s.arcs.push({
          cx: A.x,
          cy: A.y,
          rx: r * lv,
          ry: r * lv,
          dash: lv === 1 ? undefined : [4, 3],
        })
      })
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y, dash: [3, 3], soft: true })
      break
    }

    case 'gannfan': {
      const dx = B.x - A.x
      const dy = B.y - A.y
      const ratios = [
        [1, 8],
        [1, 4],
        [1, 3],
        [1, 2],
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
        [8, 1],
      ]
      ratios.forEach(([a, bb]) => {
        const tx = A.x + dx * (a / Math.max(a, bb))
        const ty = A.y + dy * (bb / Math.max(a, bb))
        const [, , ex, ey] = extend(A.x, A.y, tx, ty, c.cw, c.ch, false)
        s.segs.push({ x1: A.x, y1: A.y, x2: ex, y2: ey, dash: a === bb ? undefined : [4, 3] })
      })
      break
    }
    case 'gannbox': {
      const x1 = Math.min(A.x, B.x)
      const x2 = Math.max(A.x, B.x)
      const y1 = Math.min(A.y, B.y)
      const y2 = Math.max(A.y, B.y)
      const divs = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]
      divs.forEach((f) => {
        const gx = x1 + (x2 - x1) * f
        const gy = y1 + (y2 - y1) * f
        s.segs.push({
          x1: gx,
          y1: y1,
          x2: gx,
          y2: y2,
          dash: f === 0 || f === 1 ? undefined : [3, 3],
        })
        s.segs.push({
          x1: x1,
          y1: gy,
          x2: x2,
          y2: gy,
          dash: f === 0 || f === 1 ? undefined : [3, 3],
        })
      })
      s.segs.push({ x1: x1, y1: y2, x2: x2, y2: y1, soft: true })
      s.fills.push({ pts: [x1, y1, x2, y1, x2, y2, x1, y2], color: rgba(col, 0.05) })
      break
    }

    case 'rect': {
      const pts = [A.x, A.y, B.x, A.y, B.x, B.y, A.x, B.y]
      s.fills.push({ pts, color: rgba(col, 0.12) })
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4
        s.segs.push({ x1: pts[i * 2], y1: pts[i * 2 + 1], x2: pts[j * 2], y2: pts[j * 2 + 1] })
      }
      break
    }
    case 'ellipse': {
      const cx = (A.x + B.x) / 2
      const cy = (A.y + B.y) / 2
      const rx = Math.abs(B.x - A.x) / 2
      const ry = Math.abs(B.y - A.y) / 2
      s.arcs.push({ cx, cy, rx, ry })
      s.fills.push({ pts: ellipsePoly(cx, cy, rx, ry), color: rgba(col, 0.1) })
      // Perimeter segments give the eraser something to hit.
      const poly = ellipsePoly(cx, cy, rx, ry)
      for (let i = 0; i < poly.length; i += 2) {
        const j = (i + 2) % poly.length
        s.segs.push({ x1: poly[i], y1: poly[i + 1], x2: poly[j], y2: poly[j + 1], soft: true })
      }
      break
    }
    case 'triangle': {
      const C = P[2]
      const pts = [A.x, A.y, B.x, B.y, C.x, C.y]
      s.fills.push({ pts, color: rgba(col, 0.12) })
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y })
      s.segs.push({ x1: B.x, y1: B.y, x2: C.x, y2: C.y })
      s.segs.push({ x1: C.x, y1: C.y, x2: A.x, y2: A.y })
      break
    }
    case 'polyline':
    case 'brush': {
      for (let i = 0; i + 1 < P.length; i++)
        s.segs.push({ x1: P[i].x, y1: P[i].y, x2: P[i + 1].x, y2: P[i + 1].y })
      if (d.type === 'brush') s.handles = []
      break
    }

    case 'abcd':
    case 'xabcd':
    case 'headshoulders':
    case 'elliott5':
    case 'elliottabc': {
      const labels = PATTERN_LABELS[d.type] || []
      for (let i = 0; i + 1 < P.length; i++)
        s.segs.push({ x1: P[i].x, y1: P[i].y, x2: P[i + 1].x, y2: P[i + 1].y })
      if (d.type === 'xabcd' && P.length >= 5) {
        s.fills.push({
          pts: [P[0].x, P[0].y, P[1].x, P[1].y, P[2].x, P[2].y],
          color: rgba(col, 0.09),
        })
        s.fills.push({
          pts: [P[2].x, P[2].y, P[3].x, P[3].y, P[4].x, P[4].y],
          color: rgba(col, 0.09),
        })
      }
      if (d.type === 'headshoulders' && P.length === 7) {
        // Neckline through the two troughs.
        s.segs.push({ x1: P[2].x, y1: P[2].y, x2: P[4].x, y2: P[4].y, dash: [5, 4], soft: true })
      }
      P.forEach((p, i) => {
        const t = labels[i]
        if (t) s.labels.push({ x: p.x, y: p.y - 9, text: t, align: 'center', box: true })
      })
      break
    }

    case 'long':
    case 'short': {
      const entry = d.points[0].price
      const target = d.points[1].price
      const risk = Math.abs(target - entry) / 2
      const stop = d.type === 'long' ? entry - risk : entry + risk
      const yE = A.y
      const yT = B.y
      const yS = c.y(stop)
      if (yS == null) return null
      const x1 = Math.min(A.x, B.x)
      const x2 = Math.max(A.x, B.x)
      s.fills.push({ pts: [x1, yE, x2, yE, x2, yT, x1, yT], color: 'rgba(0,230,118,.16)' })
      s.fills.push({ pts: [x1, yE, x2, yE, x2, yS, x1, yS], color: 'rgba(255,23,68,.16)' })
      s.segs.push({ x1, y1: yE, x2, y2: yE })
      s.segs.push({ x1, y1: yT, x2, y2: yT, color: '#00E676', soft: true })
      s.segs.push({ x1, y1: yS, x2, y2: yS, color: '#FF1744', soft: true })
      const rr = risk ? Math.abs(target - entry) / risk : 0
      s.labels.push({ x: x1 + 5, y: yT - 5, text: 'Target ' + c.fmt(target) })
      s.labels.push({ x: x1 + 5, y: yS + 13, text: 'Stop ' + c.fmt(stop) })
      s.labels.push({
        x: x2 - 5,
        y: yE - 5,
        text: 'R:R ' + rr.toFixed(2),
        align: 'right',
        box: true,
      })
      break
    }
    case 'pricerange': {
      const x = B.x
      s.segs.push({ x1: x, y1: A.y, x2: x, y2: B.y })
      s.segs.push({ x1: x - 7, y1: A.y, x2: x + 7, y2: A.y, soft: true })
      s.segs.push({ x1: x - 7, y1: B.y, x2: x + 7, y2: B.y, soft: true })
      const dp = d.points[1].price - d.points[0].price
      const pct = d.points[0].price ? (dp / d.points[0].price) * 100 : 0
      s.labels.push({
        x: x + 10,
        y: (A.y + B.y) / 2,
        text: (dp >= 0 ? '+' : '') + c.fmt(dp) + '  ' + pct.toFixed(2) + '%',
        box: true,
      })
      break
    }
    case 'daterange': {
      const y = B.y
      s.segs.push({ x1: A.x, y1: y, x2: B.x, y2: y })
      s.segs.push({ x1: A.x, y1: y - 7, x2: A.x, y2: y + 7, soft: true })
      s.segs.push({ x1: B.x, y1: y - 7, x2: B.x, y2: y + 7, soft: true })
      s.labels.push({
        x: (A.x + B.x) / 2,
        y: y - 9,
        text: c.barsBetween(d.points[0].time, d.points[1].time) + ' bars',
        align: 'center',
        box: true,
      })
      break
    }

    case 'text':
      s.labels.push({ x: A.x, y: A.y, text: d.text || 'Text', box: true })
      s.segs.push({ x1: A.x - 2, y1: A.y, x2: A.x + 2, y2: A.y, soft: true })
      break

    case 'callout': {
      s.segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y, dash: [4, 3] })
      s.labels.push({ x: B.x, y: B.y, text: d.text || 'Note', box: true })
      break
    }
    case 'pricelabel':
      s.labels.push({ x: A.x, y: A.y, text: c.fmt(d.points[0].price), box: true })
      s.segs.push({ x1: A.x - 6, y1: A.y, x2: A.x + 6, y2: A.y, soft: true })
      break

    case 'markerup':
    case 'markerdown': {
      const up = d.type === 'markerup'
      const dir = up ? 1 : -1
      const tip = A.y
      const tail = A.y + dir * 22
      s.segs.push({ x1: A.x, y1: tip, x2: A.x, y2: tail })
      s.segs.push({ x1: A.x, y1: tip, x2: A.x - 6, y2: tip + dir * 9, soft: true })
      s.segs.push({ x1: A.x, y1: tip, x2: A.x + 6, y2: tip + dir * 9, soft: true })
      break
    }

    default:
      for (let i = 0; i + 1 < P.length; i++)
        s.segs.push({ x1: P[i].x, y1: P[i].y, x2: P[i + 1].x, y2: P[i + 1].y })
  }
  return s
}

function ellipsePoly(cx: number, cy: number, rx: number, ry: number): number[] {
  const out: number[] = []
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
  return out
}
