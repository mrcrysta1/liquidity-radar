// Geometry for the second batch of drawing tools: Gann square, three drives,
// cypher, Elliott triangle, forecast, bars pattern, ghost feed, arc, rotated
// rectangle, curve, price note and icon markers. Same vocabulary as
// ./geometry (segments, fills, arcs, labels, handles); pure maths, so the
// tests import it directly.
import type { Drawing, MapCtx, Shape } from './geometry'

type XY = { x: number; y: number }

/** The fixed set of icon markers, as on TradingView's icon tool. */
export const ICON_SET = ['🚀', '🔥', '⭐', '⚠️', '✅', '❌', '💰', '🐋', '📈', '📉', '🎯', '💡']
export const ICON_DEFAULT = ICON_SET[0]

export const EXTRA_TOOL_IDS = [
  'gannsquare',
  'threedrives',
  'cypher',
  'elliotttri',
  'forecast',
  'barspattern',
  'ghostfeed',
  'arc',
  'rotrect',
  'curve',
  'pricenote',
  'icon',
] as const

const rgba = (hex: string, a: number): string => {
  const h = String(hex || '#4FC3F7').replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16) || 0
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

const seg = (s: Shape, a: XY, b: XY, extra: Partial<Shape['segs'][number]> = {}): void => {
  s.segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...extra })
}
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const zigzag = (s: Shape, P: XY[]): void => {
  for (let i = 0; i + 1 < P.length; i++) seg(s, P[i], P[i + 1])
}
const tag = (s: Shape, p: XY, text: string): void => {
  if (text) s.labels.push({ x: p.x, y: p.y - 9, text, align: 'center', box: true })
}
/** |a-b| / |c-d| as a two-decimal ratio, or '' when undefined. */
export function ratio(a: number, b: number, c: number, d: number): string {
  const den = Math.abs(c - d)
  return den > 0 ? (Math.abs(a - b) / den).toFixed(3) : ''
}

/** Centre and radius of the circle through three points, or null if collinear. */
export function circleThrough(a: XY, b: XY, c: XY): { x: number; y: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return { x, y, r: Math.hypot(a.x - x, a.y - y) }
}

/**
 * Points along the arc of the circle through a, m, b, from a to b by way of m.
 * Collinear points give the straight line a-b.
 */
export function arcPoints(a: XY, m: XY, b: XY, n = 32): XY[] {
  const c = circleThrough(a, m, b)
  if (!c) return [a, b]
  const ang = (p: XY) => Math.atan2(p.y - c.y, p.x - c.x)
  const TAU = Math.PI * 2
  const norm = (v: number) => ((v % TAU) + TAU) % TAU
  const a0 = ang(a)
  const sweepB = norm(ang(b) - a0)
  const sweepM = norm(ang(m) - a0)
  // Counter-clockwise reaches m before b, or the other way round.
  const sweep = sweepM <= sweepB ? sweepB : sweepB - TAU
  const out: XY[] = []
  for (let i = 0; i <= n; i++) {
    const t = a0 + (sweep * i) / n
    out.push({ x: c.x + c.r * Math.cos(t), y: c.y + c.r * Math.sin(t) })
  }
  return out
}

/** Quadratic Bézier from a to b pulled toward control q. */
export function bezierPoints(a: XY, q: XY, b: XY, n = 24): XY[] {
  const out: XY[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push({
      x: u * u * a.x + 2 * u * t * q.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * q.y + t * t * b.y,
    })
  }
  return out
}

/** The four corners of a rectangle with side a-b and its far side through c. */
export function rotatedRect(a: XY, b: XY, c: XY): XY[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const w = (c.x - a.x) * nx + (c.y - a.y) * ny
  return [a, b, { x: b.x + nx * w, y: b.y + ny * w }, { x: a.x + nx * w, y: a.y + ny * w }]
}

/**
 * Synthetic bars along a path of prices, for the ghost feed: `n` bars from p0
 * to p1, each opening where the last closed, with wicks a fixed share of the
 * step so the same drawing always looks the same.
 */
export function ghostBars(
  p0: number,
  p1: number,
  n: number,
): Array<{ o: number; h: number; l: number; c: number }> {
  const out: Array<{ o: number; h: number; l: number; c: number }> = []
  const k = Math.max(1, Math.floor(n))
  const step = (p1 - p0) / k
  const span = Math.abs(p1 - p0) || Math.abs(p0) * 0.002
  for (let i = 0; i < k; i++) {
    // Deterministic wobble: alternate bars overshoot a little.
    const wob = (i % 3 === 1 ? -0.6 : i % 3 === 2 ? 0.35 : 0.15) * Math.abs(step || span / k)
    const o = p0 + step * i
    const c = p0 + step * (i + 1) + (i < k - 1 ? wob : 0)
    const wick = span / k / 2 + Math.abs(wob) / 2
    out.push({ o, c, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick })
  }
  // Each bar opens at the previous close.
  for (let i = 1; i < out.length; i++) {
    out[i].o = out[i - 1].c
    out[i].h = Math.max(out[i].h, out[i].o)
    out[i].l = Math.min(out[i].l, out[i].o)
  }
  return out
}

/**
 * Fill `s` for one of EXTRA_TOOL_IDS. `P` are the drawing's points in pixels.
 * Returns false for any other type.
 */
export function extraShape(d: Drawing, P: XY[], c: MapCtx, s: Shape): boolean {
  const col = d.color
  const A = P[0]
  const B = P[1]
  const pr = (i: number) => d.points[i]?.price ?? 0
  switch (d.type) {
    case 'gannsquare': {
      if (!B) return true
      const x1 = Math.min(A.x, B.x)
      const x2 = Math.max(A.x, B.x)
      const y1 = Math.min(A.y, B.y)
      const y2 = Math.max(A.y, B.y)
      const w = x2 - x1
      const h = y2 - y1
      ;[0, 0.25, 0.5, 0.75, 1].forEach((f) => {
        const edge = f === 0 || f === 1
        seg(
          s,
          { x: x1 + w * f, y: y1 },
          { x: x1 + w * f, y: y2 },
          { dash: edge ? undefined : [3, 3], soft: !edge },
        )
        seg(
          s,
          { x: x1, y: y1 + h * f },
          { x: x2, y: y1 + h * f },
          { dash: edge ? undefined : [3, 3], soft: !edge },
        )
        if (!edge)
          s.labels.push({
            x: x1 + w * f,
            y: y1 - 4,
            text: String(f),
            align: 'center',
            color: rgba(col, 0.8),
          })
      })
      seg(s, { x: x1, y: y1 }, { x: x2, y: y2 }, { soft: true })
      seg(s, { x: x1, y: y2 }, { x: x2, y: y1 }, { soft: true })
      // Quarter arcs from the first corner, at half and full size.
      const sx = Math.sign(B.x - A.x) || 1
      const sy = Math.sign(B.y - A.y) || 1
      ;[0.5, 1].forEach((f) => {
        for (let i = 0; i < 12; i++) {
          const t0 = (i / 12) * (Math.PI / 2)
          const t1 = ((i + 1) / 12) * (Math.PI / 2)
          seg(
            s,
            { x: A.x + sx * w * f * Math.cos(t0), y: A.y + sy * h * f * Math.sin(t0) },
            { x: A.x + sx * w * f * Math.cos(t1), y: A.y + sy * h * f * Math.sin(t1) },
            { soft: true, dash: [2, 3] },
          )
        }
      })
      s.fills.push({ pts: [x1, y1, x2, y1, x2, y2, x1, y2], color: rgba(col, 0.05) })
      return true
    }

    case 'threedrives': {
      zigzag(s, P)
      ;['', '1', 'A', '2', 'B', '3'].forEach((t, i) => P[i] && tag(s, P[i], t))
      if (P.length >= 4) {
        seg(s, P[1], P[3], { dash: [4, 4], soft: true })
        const r = ratio(pr(2), pr(3), pr(2), pr(1))
        if (r) s.labels.push({ ...mid(P[1], P[3]), text: r, align: 'center', color: col })
      }
      if (P.length >= 6) {
        seg(s, P[3], P[5], { dash: [4, 4], soft: true })
        seg(s, P[2], P[4], { dash: [4, 4], soft: true })
        const r = ratio(pr(4), pr(5), pr(4), pr(3))
        if (r) s.labels.push({ ...mid(P[3], P[5]), text: r, align: 'center', color: col })
      }
      return true
    }

    case 'cypher': {
      zigzag(s, P)
      ;['X', 'A', 'B', 'C', 'D'].forEach((t, i) => P[i] && tag(s, P[i], t))
      if (P.length >= 3)
        s.fills.push({
          pts: [P[0].x, P[0].y, P[1].x, P[1].y, P[2].x, P[2].y],
          color: rgba(col, 0.09),
        })
      if (P.length >= 5)
        s.fills.push({
          pts: [P[2].x, P[2].y, P[3].x, P[3].y, P[4].x, P[4].y],
          color: rgba(col, 0.09),
        })
      const dashed = (i: number, j: number, r: string) => {
        if (!P[i] || !P[j]) return
        seg(s, P[i], P[j], { dash: [4, 4], soft: true })
        if (r) s.labels.push({ ...mid(P[i], P[j]), text: r, align: 'center', color: col })
      }
      // AB / XA, BC / AB (the C extension) and CD / XC.
      dashed(0, 2, ratio(pr(2), pr(1), pr(1), pr(0)))
      dashed(1, 3, ratio(pr(3), pr(2), pr(2), pr(1)))
      dashed(0, 4, ratio(pr(4), pr(3), pr(3), pr(0)))
      return true
    }

    case 'elliotttri': {
      zigzag(s, P)
      ;['', 'A', 'B', 'C', 'D', 'E'].forEach((t, i) => P[i] && tag(s, P[i], t))
      // The two converging sides through A-C-E and B-D.
      if (P.length >= 4) seg(s, P[1], P[P.length >= 6 ? 5 : 3], { dash: [5, 4], soft: true })
      if (P.length >= 5) seg(s, P[2], P[4], { dash: [5, 4], soft: true })
      return true
    }

    case 'forecast': {
      if (!B) return true
      seg(s, A, B)
      seg(s, A, { x: B.x, y: A.y }, { dash: [3, 3], soft: true })
      seg(s, { x: B.x, y: A.y }, B, { dash: [3, 3], soft: true })
      s.arcs.push({ cx: B.x, cy: B.y, rx: 4, ry: 4 })
      const dp = pr(1) - pr(0)
      const pct = pr(0) ? (dp / pr(0)) * 100 : 0
      const bars = c.barsBetween(d.points[0].time, d.points[1].time)
      const up = dp >= 0
      s.fills.push({
        pts: [A.x, A.y, B.x, A.y, B.x, B.y],
        color: rgba(up ? '#00E676' : '#FF1744', 0.1),
      })
      s.labels.push({
        x: B.x,
        y: B.y + (up ? -12 : 20),
        text:
          'Forecast ' +
          c.fmt(pr(1)) +
          '  ' +
          (up ? '+' : '') +
          pct.toFixed(2) +
          '%  ' +
          bars +
          ' bars',
        align: 'center',
        box: true,
        color: up ? '#00E676' : '#FF1744',
      })
      return true
    }

    case 'barspattern': {
      if (!B) return true
      seg(s, { x: A.x, y: A.y }, { x: B.x, y: A.y }, { dash: [3, 3] })
      const C = P[2]
      const bars = c.candles ? c.candles(d.points[0].time, d.points[1].time) : []
      if (!C || !bars.length) return true
      const dt = d.points[2].time - Math.floor(bars[0].t / 1000)
      const dpx = d.points[2].price - bars[0].o
      const xs = bars.map((b) => c.x(Math.floor(b.t / 1000) + dt))
      let gap = 6
      for (let i = 1; i < xs.length; i++) {
        const a = xs[i - 1]
        const b = xs[i]
        if (a != null && b != null && b > a) {
          gap = b - a
          break
        }
      }
      const tick = Math.max(1.5, Math.min(6, gap * 0.35))
      bars.forEach((b, i) => {
        const x = xs[i]
        const yh = c.y(b.h + dpx)
        const yl = c.y(b.l + dpx)
        const yo = c.y(b.o + dpx)
        const yc = c.y(b.c + dpx)
        if (x == null || yh == null || yl == null || yo == null || yc == null) return
        const color = b.c >= b.o ? col : rgba(col, 0.55)
        seg(s, { x, y: yh }, { x, y: yl }, { color, width: 1.2 })
        seg(s, { x: x - tick, y: yo }, { x, y: yo }, { color, width: 1.2, soft: true })
        seg(s, { x, y: yc }, { x: x + tick, y: yc }, { color, width: 1.2, soft: true })
      })
      return true
    }

    case 'ghostfeed': {
      for (let i = 0; i + 1 < P.length; i++) {
        const p = P[i]
        const q = P[i + 1]
        // The path itself, invisible but clickable.
        seg(s, p, q, { color: 'rgba(0,0,0,0)', width: 1 })
        const dx = q.x - p.x
        const n = Math.max(
          1,
          Math.min(
            80,
            c.barsBetween(d.points[i].time, d.points[i + 1].time) || Math.round(Math.abs(dx) / 8),
          ),
        )
        const bw = Math.max(1, (Math.abs(dx) / n) * 0.6)
        ghostBars(pr(i), pr(i + 1), n).forEach((b, k) => {
          const x = p.x + (dx * (k + 0.5)) / n
          const yo = c.y(b.o)
          const yc = c.y(b.c)
          const yh = c.y(b.h)
          const yl = c.y(b.l)
          if (yo == null || yc == null || yh == null || yl == null) return
          const up = b.c >= b.o
          seg(s, { x, y: yh }, { x, y: yl }, { color: rgba(col, 0.55), width: 1, soft: true })
          const top = Math.min(yo, yc)
          const bot = Math.max(yo, yc, top + 1)
          s.fills.push({
            pts: [x - bw / 2, top, x + bw / 2, top, x + bw / 2, bot, x - bw / 2, bot],
            color: rgba(col, up ? 0.5 : 0.22),
          })
        })
      }
      return true
    }

    case 'arc': {
      if (!B) return true
      const pts = P[2] ? arcPoints(A, P[2], B) : [A, B]
      for (let i = 0; i + 1 < pts.length; i++) seg(s, pts[i], pts[i + 1])
      if (pts.length > 2) {
        const poly: number[] = []
        pts.forEach((p) => poly.push(p.x, p.y))
        s.fills.push({ pts: poly, color: rgba(col, 0.08) })
      }
      return true
    }

    case 'rotrect': {
      if (!B) return true
      const C = P[2] || B
      const q = rotatedRect(A, B, C)
      for (let i = 0; i < 4; i++) seg(s, q[i], q[(i + 1) % 4])
      s.fills.push({ pts: q.flatMap((p) => [p.x, p.y]), color: rgba(col, 0.12) })
      return true
    }

    case 'curve': {
      if (!B) return true
      const pts = P[2] ? bezierPoints(A, P[2], B) : [A, B]
      for (let i = 0; i + 1 < pts.length; i++) seg(s, pts[i], pts[i + 1])
      if (P[2]) {
        seg(s, A, P[2], { dash: [2, 3], soft: true, color: rgba(col, 0.4) })
        seg(s, P[2], B, { dash: [2, 3], soft: true, color: rgba(col, 0.4) })
      }
      return true
    }

    case 'pricenote': {
      const L = B || A
      s.arcs.push({ cx: A.x, cy: A.y, rx: 3, ry: 3 })
      if (B) seg(s, A, B, { dash: [4, 3] })
      s.labels.push({
        x: L.x,
        y: L.y - 4,
        text: c.fmt(pr(0)),
        box: true,
        align: 'center',
        size: d.fontSize,
        bg: d.bg,
        border: d.border,
      })
      return true
    }

    case 'icon': {
      const size = Math.max(16, (d.fontSize || 10) * 2)
      s.labels.push({
        x: A.x,
        y: A.y + size / 3,
        text: d.text || ICON_DEFAULT,
        align: 'center',
        size,
      })
      // A clickable box around the glyph.
      const r = size / 2 + 2
      s.fills.push({
        pts: [A.x - r, A.y - r, A.x + r, A.y - r, A.x + r, A.y + r, A.x - r, A.y + r],
        color: 'rgba(0,0,0,0)',
      })
      return true
    }
  }
  return false
}
