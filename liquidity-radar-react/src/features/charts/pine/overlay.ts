// Draws what a Pine script draws besides its plots: bgcolor (full-height
// bar backgrounds), label / line / box objects, and tables (an HTML layer
// in a corner of the script's pane). barcolor goes to ./barColors.
//
// Each script gets one series primitive, attached to one of its own series
// (indicators/render hands it over), so everything lands in the script's
// pane — the price pane for an overlay, its own pane otherwise — and maps
// prices through that series' scale. Positions are times (the runtime
// turned bar indexes into times), placed in logical bar space so they hold
// between bars and past the last one.
import type { CandleFlat } from '../../../services/market'
import { timeToLogical } from '../drawings/timeMap'
import { setPineBarColors } from './barColors'
import { pineDrawState } from './indicator'
import type { PineDrawingsOut, PineLabelOut, PineResult, PineTableOut } from './runtime'

type Any = any

const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
const SIZE_PX: Record<string, number> = { tiny: 9, small: 11, normal: 12, auto: 12, large: 15, huge: 20 }
const sizePx = (s: string) => SIZE_PX[s] ?? 12

interface DrawData {
  times: number[]
  /** bgcolor per chart bar. */
  bg: Array<string | undefined> | null
  drawings: PineDrawingsOut | null
  /** Pane scripts: the drawings' price range, so the pane scale takes them in. */
  range: { min: number; max: number } | null
}
const EMPTY: DrawData = { times: [], bg: null, drawings: null, range: null }

/** Re-index a per-bar list from the run's candles onto the chart's, by time. */
function byTime<T>(vals: Array<T | undefined>, run: CandleFlat[], cs: CandleFlat[]): Array<T | undefined> {
  const at = new Map<number, T>()
  for (let i = 0; i < run.length; i++) if (vals[i] !== undefined) at.set(run[i].t, vals[i] as T)
  return cs.map((c) => at.get(c.t))
}

function dash(ctx: CanvasRenderingContext2D, style: string, w: number): void {
  ctx.setLineDash(style === 'dashed' ? [6 * w, 4 * w] : style === 'dotted' ? [w, 2 * w] : [])
}

function arrowHead(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0)
  const len = 6 + w * 2
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - len * Math.cos(a - 0.45), y1 - len * Math.sin(a - 0.45))
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - len * Math.cos(a + 0.45), y1 - len * Math.sin(a + 0.45))
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
}

/** The series primitive one script draws through. */
class PineDrawPrimitive {
  data: DrawData = EMPTY
  chart: Any = null
  series: Any = null
  private requestUpdate: (() => void) | null = null
  private views: Any[]
  constructor() {
    this.views = [
      { zOrder: () => 'bottom', renderer: () => ({ draw: (t: Any) => this.drawBg(t) }) },
      { zOrder: () => 'normal', renderer: () => ({ draw: (t: Any) => this.drawObjects(t) }) },
    ]
  }
  attached(p: Any): void {
    this.chart = p.chart
    this.series = p.series
    this.requestUpdate = p.requestUpdate
  }
  detached(): void {
    this.requestUpdate = null
  }
  update(d: DrawData): void {
    this.data = d
    this.requestUpdate?.()
  }
  updateAllViews(): void {}
  paneViews(): Any[] {
    return this.views
  }
  autoscaleInfo(): Any {
    const r = this.data.range
    return r ? { priceRange: { minValue: r.min, maxValue: r.max } } : null
  }

  private x(t: number): number | null {
    const l = timeToLogical(this.data.times, t)
    if (l == null) return null
    const x = this.chart?.timeScale().logicalToCoordinate(l)
    return x == null || !isFinite(x) ? null : x
  }
  private y(p: number): number | null {
    const y = this.series?.priceToCoordinate(p)
    return y == null || !isFinite(y) ? null : y
  }

  private drawBg(target: Any): void {
    const bg = this.data.bg
    if (!bg || !this.chart) return
    const ts = this.chart.timeScale()
    const range = ts.getVisibleLogicalRange()
    if (!range) return
    const spacing = ts.options().barSpacing as number
    target.useBitmapCoordinateSpace((scope: Any) => {
      const { context: ctx, horizontalPixelRatio: hr, bitmapSize } = scope
      const from = Math.max(0, Math.floor(range.from) - 1)
      const to = Math.min(bg.length - 1, Math.ceil(range.to) + 1)
      // Neighbouring bars of one colour fill as one rectangle: no seams.
      let runColor: string | undefined
      let runLeft = 0
      let runRight = 0
      const flush = () => {
        if (runColor) {
          ctx.fillStyle = runColor
          ctx.fillRect(runLeft, 0, runRight - runLeft, bitmapSize.height)
        }
      }
      for (let i = from; i <= to; i++) {
        const c = bg[i]
        const x = c ? ts.logicalToCoordinate(i) : null
        if (!c || x == null) {
          flush()
          runColor = undefined
          continue
        }
        const left = Math.round((x - spacing / 2) * hr)
        const right = Math.round((x + spacing / 2) * hr)
        if (c === runColor && left <= runRight) runRight = right
        else {
          flush()
          runColor = c
          runLeft = left
          runRight = right
        }
      }
      flush()
    })
  }

  private drawObjects(target: Any): void {
    const d = this.data.drawings
    if (!d || !this.chart) return
    target.useMediaCoordinateSpace((scope: Any) => {
      const ctx: CanvasRenderingContext2D = scope.context
      const W: number = scope.mediaSize.width
      const H: number = scope.mediaSize.height
      ctx.save()
      for (const b of d.boxes) this.drawBox(ctx, b, W)
      for (const l of d.lines) this.drawLine(ctx, l, W, H)
      for (const l of d.labels) this.drawLabel(ctx, l, W)
      ctx.restore()
    })
  }

  private drawLine(ctx: CanvasRenderingContext2D, l: PineDrawingsOut['lines'][number], W: number, H: number): void {
    if (!l.color) return
    let x1 = this.x(l.t1)
    let x2 = this.x(l.t2)
    let y1 = this.y(l.y1)
    let y2 = this.y(l.y2)
    if (x1 == null || x2 == null || y1 == null || y2 == null) return
    const ext = l.extend
    if (ext !== 'none') {
      if (x1 === x2) {
        if (ext === 'both' || ext === 'left') y1 = y1 < y2 ? -H : 2 * H
        if (ext === 'both' || ext === 'right') y2 = y2 > y1 ? 2 * H : -H
      } else {
        const k = (y2 - y1) / (x2 - x1)
        // "left" runs past the first point, "right" past the second.
        const sign = x2 > x1 ? 1 : -1
        if (ext === 'both' || ext === 'left') {
          const nx = sign > 0 ? -10 : W + 10
          y1 = y1 + k * (nx - x1)
          x1 = nx
        }
        if (ext === 'both' || ext === 'right') {
          const nx = sign > 0 ? W + 10 : -10
          y2 = y2 + k * (nx - x2)
          x2 = nx
        }
      }
    }
    const w = Math.max(1, Math.min(10, l.width))
    ctx.strokeStyle = l.color
    ctx.lineWidth = w
    dash(ctx, l.style, w)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.setLineDash([])
    if (l.style === 'arrow_right' || l.style === 'arrow_both') arrowHead(ctx, x1, y1, x2, y2, w)
    if (l.style === 'arrow_left' || l.style === 'arrow_both') arrowHead(ctx, x2, y2, x1, y1, w)
  }

  private drawBox(ctx: CanvasRenderingContext2D, b: PineDrawingsOut['boxes'][number], W: number): void {
    let x1 = this.x(b.t1)
    let x2 = this.x(b.t2)
    const y1 = this.y(b.top)
    const y2 = this.y(b.bottom)
    if (x1 == null || x2 == null || y1 == null || y2 == null) return
    if (x1 > x2) [x1, x2] = [x2, x1]
    if (b.extend === 'left' || b.extend === 'both') x1 = -10
    if (b.extend === 'right' || b.extend === 'both') x2 = W + 10
    const top = Math.min(y1, y2)
    const h = Math.abs(y2 - y1)
    if (b.bgcolor) {
      ctx.fillStyle = b.bgcolor
      ctx.fillRect(x1, top, x2 - x1, h)
    }
    if (b.border_color && b.border_width > 0) {
      ctx.strokeStyle = b.border_color
      ctx.lineWidth = b.border_width
      dash(ctx, b.border_style, b.border_width)
      ctx.strokeRect(x1, top, x2 - x1, h)
      ctx.setLineDash([])
    }
    if (b.text && b.text_color) {
      const px = sizePx(b.text_size)
      ctx.save()
      ctx.beginPath()
      ctx.rect(x1, top, x2 - x1, h)
      ctx.clip()
      ctx.font = `${px}px ${FONT}`
      ctx.fillStyle = b.text_color
      const lines = b.text.split('\n')
      const lh = px * 1.25
      const pad = 4
      ctx.textAlign = b.text_halign === 'left' ? 'left' : b.text_halign === 'right' ? 'right' : 'center'
      ctx.textBaseline = 'middle'
      const tx = b.text_halign === 'left' ? x1 + pad : b.text_halign === 'right' ? x2 - pad : (x1 + x2) / 2
      const total = lh * lines.length
      const ty0 =
        b.text_valign === 'top' ? top + pad + lh / 2 : b.text_valign === 'bottom' ? top + h - pad - total + lh / 2 : top + h / 2 - total / 2 + lh / 2
      lines.forEach((ln, i) => ctx.fillText(ln, tx, ty0 + i * lh))
      ctx.restore()
    }
  }

  private drawLabel(ctx: CanvasRenderingContext2D, l: PineLabelOut, W: number): void {
    const x = this.x(l.t)
    const y = this.y(l.y)
    if (x == null || y == null || x < -300 || x > W + 300) return
    const px = sizePx(l.size)
    ctx.font = `${px}px ${FONT}`
    const lines = l.text ? l.text.split('\n') : []
    const lh = Math.round(px * 1.25)
    const tw = lines.reduce((m, s) => Math.max(m, ctx.measureText(s).width), 0)
    const th = lh * lines.length
    const st = l.style
    const shapes = ['circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup', 'arrowdown', 'cross', 'xcross', 'flag']
    if (shapes.includes(st)) {
      // A marker at the point, the text beside it (below for the up shapes).
      const r = px * 0.55
      const below = st === 'triangleup' || st === 'arrowup' || l.yloc === 'belowbar'
      const cy = y
      if (l.color) this.shape(ctx, st, x, cy, r, l.color)
      if (lines.length && l.textcolor) {
        ctx.fillStyle = l.textcolor
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const y0 = below ? cy + r + 4 + lh / 2 : cy - r - 4 - th + lh / 2
        lines.forEach((s, i) => ctx.fillText(s, x, y0 + i * lh))
      }
      return
    }
    if (!lines.length) return
    const pad = { x: 6, y: 3 }
    const bw = tw + pad.x * 2
    const bh = th + pad.y * 2
    const ptr = 6
    // Where the bubble sits relative to the point, and which way its pointer goes.
    let bx = x - bw / 2
    let by = y - bh / 2
    let dir: 'up' | 'down' | 'left' | 'right' | null = null
    if (st === 'label_down' || st === 'label_lower_left' || st === 'label_lower_right') {
      by = y - ptr - bh
      dir = 'down'
    } else if (st === 'label_up' || st === 'label_upper_left' || st === 'label_upper_right') {
      by = y + ptr
      dir = 'up'
    } else if (st === 'label_left') {
      bx = x + ptr
      dir = 'left'
    } else if (st === 'label_right') {
      bx = x - ptr - bw
      dir = 'right'
    }
    if (st.endsWith('_left') && (dir === 'up' || dir === 'down')) bx = x - 8
    if (st.endsWith('_right') && (dir === 'up' || dir === 'down')) bx = x - bw + 8
    const bubble = st !== 'none' && st !== 'text_outline' && !!l.color
    if (bubble) {
      ctx.fillStyle = l.color
      ctx.beginPath()
      roundRect(ctx, bx, by, bw, bh, 3)
      if (dir === 'down') {
        ctx.moveTo(x - ptr, by + bh)
        ctx.lineTo(x, y)
        ctx.lineTo(x + ptr, by + bh)
      } else if (dir === 'up') {
        ctx.moveTo(x - ptr, by)
        ctx.lineTo(x, y)
        ctx.lineTo(x + ptr, by)
      } else if (dir === 'left') {
        ctx.moveTo(bx, y - ptr)
        ctx.lineTo(x, y)
        ctx.lineTo(bx, y + ptr)
      } else if (dir === 'right') {
        ctx.moveTo(bx + bw, y - ptr)
        ctx.lineTo(x, y)
        ctx.lineTo(bx + bw, y + ptr)
      }
      ctx.fill()
    }
    if (!l.textcolor) return
    ctx.textBaseline = 'middle'
    const align = l.textalign === 'left' || l.textalign === 'right' ? l.textalign : 'center'
    ctx.textAlign = align
    const tx = align === 'left' ? bx + pad.x : align === 'right' ? bx + bw - pad.x : bx + bw / 2
    lines.forEach((s, i) => {
      const ty = by + pad.y + lh / 2 + i * lh
      if (st === 'text_outline' && l.color) {
        ctx.strokeStyle = l.color
        ctx.lineWidth = 3
        ctx.strokeText(s, tx, ty)
      }
      ctx.fillStyle = l.textcolor
      ctx.fillText(s, tx, ty)
    })
  }

  private shape(ctx: CanvasRenderingContext2D, st: string, x: number, y: number, r: number, color: string): void {
    ctx.fillStyle = color
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    switch (st) {
      case 'circle':
        ctx.arc(x, y, r, 0, Math.PI * 2)
        break
      case 'square':
        ctx.rect(x - r, y - r, r * 2, r * 2)
        break
      case 'diamond':
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r, y)
        ctx.lineTo(x, y + r)
        ctx.lineTo(x - r, y)
        break
      case 'triangleup':
      case 'arrowup':
        ctx.moveTo(x, y - r)
        ctx.lineTo(x + r, y + r)
        ctx.lineTo(x - r, y + r)
        break
      case 'triangledown':
      case 'arrowdown':
        ctx.moveTo(x, y + r)
        ctx.lineTo(x + r, y - r)
        ctx.lineTo(x - r, y - r)
        break
      case 'flag':
        ctx.rect(x, y - r, r * 1.6, r)
        ctx.rect(x - 1, y - r, 1.5, r * 2)
        break
      case 'cross':
        ctx.moveTo(x - r, y)
        ctx.lineTo(x + r, y)
        ctx.moveTo(x, y - r)
        ctx.lineTo(x, y + r)
        ctx.stroke()
        return
      default:
        // xcross
        ctx.moveTo(x - r, y - r)
        ctx.lineTo(x + r, y + r)
        ctx.moveTo(x + r, y - r)
        ctx.lineTo(x - r, y + r)
        ctx.stroke()
        return
    }
    ctx.closePath()
    ctx.fill()
  }
}

// ---- tables: an HTML layer over the script's pane ----
function tableHtml(t: PineTableOut): HTMLTableElement {
  const el = document.createElement('table')
  el.className = 'pine-table pine-pos-' + t.position.replace(/[^a-z_]/g, '')
  if (t.bgcolor) el.style.background = t.bgcolor
  if (t.frame_color && t.frame_width > 0) el.style.outline = `${t.frame_width}px solid ${t.frame_color}`
  const border = t.border_color && t.border_width > 0 ? `${t.border_width}px solid ${t.border_color}` : ''
  t.cells.forEach((row) => {
    const tr = document.createElement('tr')
    row.forEach((c) => {
      const td = document.createElement('td')
      if (border) td.style.border = border
      if (c) {
        td.textContent = c.text
        if (c.bgcolor) td.style.background = c.bgcolor
        if (c.text_color) td.style.color = c.text_color
        td.style.fontSize = sizePx(c.text_size) + 'px'
        td.style.textAlign = c.text_halign === 'left' || c.text_halign === 'right' ? c.text_halign : 'center'
        td.style.verticalAlign = c.text_valign === 'top' || c.text_valign === 'bottom' ? c.text_valign : 'middle'
        if (c.tooltip) td.title = c.tooltip
      }
      tr.appendChild(td)
    })
    el.appendChild(tr)
  })
  return el
}

/** Where a series' pane sits inside the chart element. */
function paneBox(chart: Any, series: Any): { left: number; top: number; width: number; height: number } | null {
  try {
    const panes: Any[] = chart.panes()
    const idx: number = series.getPane().paneIndex()
    let top = 0
    for (let i = 0; i < idx; i++) top += panes[i].getHeight() + 1
    const left = chart.priceScale('left').width() || 0
    return { left, top, width: chart.timeScale().width(), height: panes[idx].getHeight() }
  } catch {
    return null
  }
}

class TableLayer {
  el: HTMLDivElement | null = null
  sig = ''
  sync(chart: Any, series: Any, tables: PineTableOut[]): void {
    const host: HTMLElement | null = chart?.chartElement?.()?.parentElement ?? null
    if (!tables.length || !host) {
      this.remove()
      return
    }
    if (!this.el || this.el.parentElement !== host) {
      this.remove()
      this.el = document.createElement('div')
      this.el.className = 'pine-tables'
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
      host.appendChild(this.el)
    }
    const box = paneBox(chart, series)
    if (box) {
      // The chart element may sit inside its host with an offset.
      const off = chart.chartElement().offsetTop || 0
      Object.assign(this.el.style, {
        left: box.left + 'px',
        top: box.top + off + 'px',
        width: box.width + 'px',
        height: box.height + 'px',
      })
    }
    const sig = JSON.stringify(tables)
    if (sig === this.sig) return
    this.sig = sig
    this.el.replaceChildren(...tables.map(tableHtml))
  }
  remove(): void {
    this.el?.remove()
    this.el = null
    this.sig = ''
  }
}

interface Held {
  series: Any
  prim: PineDrawPrimitive
  tables: TableLayer
  /** What the data was built from. */
  from: { result: PineResult | null; candles: CandleFlat[] | null; n: number }
  barColors: Map<number, string> | null
}

/**
 * One chart's Pine drawings. `barColors`: this is the main chart, whose
 * candles take the scripts' barcolor().
 */
export function createPineDrawings(opts: { barColors?: boolean } = {}) {
  const held = new Map<string, Held>()

  function drop(h: Held): void {
    try {
      h.series.detachPrimitive(h.prim)
    } catch {
      /* series already gone */
    }
    h.tables.remove()
  }

  /** Draw instance `uid`'s last run on `series` (one of its own series). */
  function sync(uid: string, series: Any, candles: CandleFlat[], chart: Any): void {
    if (!series) return
    let h = held.get(uid)
    if (h && h.series !== series) {
      drop(h)
      h = undefined
    }
    if (!h) {
      h = {
        series,
        prim: new PineDrawPrimitive(),
        tables: new TableLayer(),
        from: { result: null, candles: null, n: -1 },
        barColors: null,
      }
      try {
        series.attachPrimitive(h.prim)
      } catch {
        return
      }
      held.set(uid, h)
    }
    const st = pineDrawState(uid)
    const r = st?.result ?? null
    if (h.from.result !== r || h.from.candles !== candles || h.from.n !== candles.length) {
      h.from = { result: r, candles, n: candles.length }
      let range: DrawData['range'] = null
      const dr = r?.drawings ?? null
      if (r && dr && !r.overlay) {
        const ys = [
          ...dr.labels.map((l) => l.y),
          ...dr.lines.flatMap((l) => [l.y1, l.y2]),
          ...dr.boxes.flatMap((b) => [b.top, b.bottom]),
        ].filter((v) => isFinite(v))
        if (ys.length) range = { min: Math.min(...ys), max: Math.max(...ys) }
      }
      h.prim.update({
        times: candles.map((c) => c.t),
        bg: r?.bgcolors && st ? byTime(r.bgcolors, st.candles, candles) : null,
        drawings: dr,
        range,
      })
      h.barColors = null
      if (r?.barcolors && st) {
        const m = new Map<number, string>()
        r.barcolors.forEach((c, i) => {
          if (c && st.candles[i]) m.set(st.candles[i].t, c)
        })
        h.barColors = m
      }
    }
    h.tables.sync(chart, series, r?.drawings?.tables ?? [])
  }

  /** Remove everything for instances not in `keep`; publish bar colours. */
  function sweep(keep: Set<string>): void {
    held.forEach((h, uid) => {
      if (keep.has(uid)) return
      drop(h)
      held.delete(uid)
    })
    if (!opts.barColors) return
    const all = new Map<number, string>()
    held.forEach((h) => h.barColors?.forEach((c, t) => all.set(t, c)))
    setPineBarColors(all)
  }

  return { sync, sweep }
}
export type PineDrawings = ReturnType<typeof createPineDrawings>
