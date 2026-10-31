// Paints a drawing's pixel shape (./geometry) on a 2D canvas. Shared by the
// main chart and the read-only overlays on layout cells and grid panels, so a
// drawing looks the same wherever it shows.
import type { Shape } from './geometry'

type Ctx = CanvasRenderingContext2D

export const DASHES: Record<string, number[]> = { dashed: [6, 4], dotted: [1.5, 3] }

export interface PaintOpts {
  /** Under the eraser: painted red. */
  doomed?: boolean
  /** Selected: hollow grab handles. */
  selected?: boolean
  /** The drawing's own line width / style. */
  style?: { width?: number; dash?: string }
  /** Light theme (label boxes and handles invert). */
  light?: boolean
  /** The theme's red, for a doomed drawing. */
  red?: string
  /** Leave out the anchor handles (read-only overlays). */
  noHandles?: boolean
}

export function paintDrawingShape(ctx: Ctx, sh: Shape, base: string, o: PaintOpts = {}): void {
  const doomed = !!o.doomed
  const style = o.style || {}
  const stroke = doomed ? o.red || '#FF1744' : base
  sh.fills.forEach((f) => {
    if (f.pts.length < 6) return
    ctx.save()
    ctx.fillStyle = doomed ? 'rgba(255,23,68,.14)' : f.color
    ctx.beginPath()
    ctx.moveTo(f.pts[0], f.pts[1])
    for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i], f.pts[i + 1])
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })
  if (doomed) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,23,68,.32)'
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    sh.segs.forEach((g) => {
      ctx.beginPath()
      ctx.moveTo(g.x1, g.y1)
      ctx.lineTo(g.x2, g.y2)
      ctx.stroke()
    })
    ctx.restore()
  }
  sh.segs.forEach((g) => {
    ctx.save()
    ctx.strokeStyle = doomed ? stroke : g.color || base
    // The drawing's own width / style apply to its main lines; decoration
    // (soft) keeps the tool's look.
    const own = !g.soft
    ctx.lineWidth = g.width || (doomed ? 2.2 : own && style.width ? style.width : 1.7)
    ctx.lineCap = 'round'
    ctx.setLineDash(g.dash || (own && style.dash ? DASHES[style.dash] || [] : []))
    ctx.beginPath()
    ctx.moveTo(g.x1, g.y1)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
    ctx.restore()
  })
  sh.arcs.forEach((a) => {
    if (a.rx <= 0 || a.ry <= 0) return
    ctx.save()
    ctx.strokeStyle = doomed ? stroke : a.color || base
    ctx.lineWidth = doomed ? 2.2 : style.width || 1.7
    ctx.setLineDash(a.dash || (style.dash ? DASHES[style.dash] || [] : []))
    ctx.beginPath()
    ctx.ellipse(a.cx, a.cy, a.rx, a.ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  })
  if (!o.noHandles)
    sh.handles.forEach((h) => {
      ctx.save()
      ctx.fillStyle = doomed ? stroke : base
      ctx.beginPath()
      if (o.selected) {
        // Selected: hollow grab handles, as on TradingView.
        ctx.fillStyle = o.light ? '#ffffff' : '#0b1220'
        ctx.strokeStyle = base
        ctx.lineWidth = 1.6
        ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.arc(h.x, h.y, 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    })
  sh.labels.forEach((l) => {
    ctx.save()
    const fs = l.size || 10
    ctx.font = fs + 'px JetBrains Mono, monospace'
    ctx.textAlign = l.align || 'left'
    const w = ctx.measureText(l.text).width
    if (l.box) {
      const bx = l.align === 'center' ? l.x - w / 2 : l.align === 'right' ? l.x - w : l.x
      ctx.fillStyle = l.bg || (o.light ? 'rgba(255,255,255,.88)' : 'rgba(6,11,24,.78)')
      ctx.fillRect(bx - 4, l.y - fs, w + 8, fs + 4)
      if (l.border !== 'none') {
        ctx.strokeStyle = doomed ? stroke : l.border || l.color || base
        ctx.lineWidth = 1
        ctx.strokeRect(bx - 4, l.y - fs, w + 8, fs + 4)
      }
    }
    ctx.fillStyle = doomed ? stroke : l.color || base
    ctx.fillText(l.text, l.x, l.y)
    ctx.restore()
  })
}
