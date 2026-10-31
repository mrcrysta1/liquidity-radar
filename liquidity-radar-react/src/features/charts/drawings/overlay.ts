// Read-only drawings over another chart: a layout cell or a comparison-grid
// panel showing a coin the main chart has drawn on. Same geometry
// (./geometry), same anchor mapping (./timeMap, so a 15m drawing lands right
// on a 4h cell) and same painter (./paint) as the main chart, on a canvas of
// its own laid over the cell. It takes no pointer events: the cell pans and
// zooms as before, and drawings are edited on the main chart.
import { shape } from './geometry'
import type { Drawing, MapCtx } from './geometry'
import { paintDrawingShape } from './paint'
import { timeToLogical } from './timeMap'
import { visibleOnTf } from './visibility'
import { drawingsForSymbol, subscribeSharedDrawings } from './shared'
import { mainPaneHeight } from '../chartPalette'
import { pfmt } from '../../../utils/format'
import type { CandleFlat } from '../../../services/market'

type Any = any

export interface DrawingOverlayOpts {
  /** The element the chart was created in. */
  host: HTMLElement
  chart: Any
  /** The price series drawings are anchored to. */
  series: () => Any
  /** The bars on the chart, oldest first. */
  bars: () => CandleFlat[]
  sym: () => string
  tf: () => string
}

export interface DrawingOverlay {
  /** Repaint on the next frame (new bars, new view). */
  redraw(): void
  dispose(): void
}

/** [first, end) indices of the bars with lo <= t <= hi (ms). */
function span(a: CandleFlat[], lo: number, hi: number): [number, number] {
  const first = (x: number, incl: boolean) => {
    let l = 0
    let h = a.length
    while (l < h) {
      const m = (l + h) >> 1
      if (incl ? a[m].t < x : a[m].t <= x) l = m + 1
      else h = m
    }
    return l
  }
  return [first(lo, true), first(hi, false)]
}

export function createDrawingOverlay(o: DrawingOverlayOpts): DrawingOverlay {
  const cv = document.createElement('canvas')
  cv.className = 'r4dr-overlay'
  cv.setAttribute('aria-hidden', 'true')
  if (getComputedStyle(o.host).position === 'static') o.host.style.position = 'relative'
  o.host.appendChild(cv)

  let timesOf: CandleFlat[] | null = null
  let times: number[] = []
  const barTimes = (): number[] => {
    const b = o.bars()
    if (b !== timesOf || times.length !== b.length) {
      timesOf = b
      times = b.map((k) => Math.floor(k.t / 1000))
    }
    return times
  }

  const mapCtx = (cw: number, ch: number): MapCtx => {
    const ts = o.chart.timeScale()
    const s = o.series()
    const bars = o.bars()
    const between = (t1: number, t2: number) =>
      span(bars, Math.min(t1, t2) * 1000, Math.max(t1, t2) * 1000)
    return {
      x: (t: number) => {
        const l = timeToLogical(barTimes(), t)
        return l == null ? null : ts.logicalToCoordinate(l as Any)
      },
      y: (p: number) => (s ? s.priceToCoordinate(p) : null),
      cw,
      ch,
      fmt: (p: number) => pfmt(p),
      closesBetween(t1, t2) {
        const [a, b] = between(t1, t2)
        return bars.slice(a, b).map((k) => k.c)
      },
      barsBetween(t1, t2) {
        const [a, b] = between(t1, t2)
        return b - a
      },
      candles(t1, t2) {
        const [a, b] = between(t1, t2)
        return bars.slice(a, b)
      },
      last: bars.length ? bars[bars.length - 1].c : null,
      timeLabel: (t: number) =>
        new Date(t * 1000).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
    }
  }

  let dead = false
  let queued = false
  const paint = () => {
    queued = false
    if (dead) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = o.host.clientWidth
    const h = o.host.clientHeight
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const list = drawingsForSymbol(o.sym())
    if (!list.length || !o.series() || !o.bars().length) return
    const tf = o.tf()
    let left = 0
    let right = w
    try {
      left = o.chart.priceScale('left').width() || 0
      const tw = o.chart.timeScale().width()
      if (tw > 0) right = Math.min(w, left + tw)
    } catch {
      /* not laid out yet */
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, 0, right - left, mainPaneHeight(o.chart, h))
    ctx.clip()
    const m = mapCtx(w, h)
    const light = document.documentElement.getAttribute('data-theme') === 'light'
    list.forEach((d: Drawing) => {
      if (d.hidden || !visibleOnTf(d, tf)) return
      let sh: ReturnType<typeof shape>
      try {
        sh = shape(d, m)
      } catch {
        return
      }
      if (sh)
        paintDrawingShape(ctx, sh, d.color, {
          style: { width: d.width, dash: d.dash },
          light,
          noHandles: true,
        })
    })
    ctx.restore()
  }
  const redraw = () => {
    if (queued || dead) return
    queued = true
    requestAnimationFrame(paint)
  }

  const ts = o.chart.timeScale()
  ts.subscribeVisibleLogicalRangeChange(redraw)
  const off = subscribeSharedDrawings(redraw)
  const ro = new ResizeObserver(redraw)
  ro.observe(o.host)
  // Dragging the price axis or wheel-zooming moves prices without a time-range event.
  const onMove = (e: PointerEvent) => {
    if (e.buttons) redraw()
  }
  o.host.addEventListener('pointermove', onMove)
  o.host.addEventListener('wheel', redraw, { passive: true })
  o.host.addEventListener('dblclick', redraw)
  redraw()

  return {
    redraw,
    dispose() {
      if (dead) return
      dead = true
      try {
        ts.unsubscribeVisibleLogicalRangeChange(redraw)
      } catch {
        /* chart already removed */
      }
      off()
      ro.disconnect()
      o.host.removeEventListener('pointermove', onMove)
      o.host.removeEventListener('wheel', redraw)
      o.host.removeEventListener('dblclick', redraw)
      cv.remove()
    },
  }
}
