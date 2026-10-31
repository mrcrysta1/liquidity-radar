// Order-book depth heatmap: resting liquidity by price over time, painted
// under the candles in the price pane (Bookmap-style).
//
// It is a series primitive with a 'bottom' z-order rather than a canvas over
// the chart: the chart then draws it inside the price pane only, beneath the
// candles, on the pane's own price scale — nothing to clip, size or keep out
// of the indicator panes. Primitives belong to a series and the price series
// is rebuilt on every style change, so the layer re-attaches itself whenever
// the series it sits on is no longer the chart's.
//
// The history is sampled every SAMPLE_MS (./orderflow) and kept for a rolling
// window; each paint folds the visible snapshots into a small grid (a pixel
// column every COL_PX, a row every ROW_PX), turns it into an image once, and
// draws that image scaled up. The chart repaints on every trade, so the grid
// is memoised on everything that moves it: the view, the scale and the data.
import type { CandleFlat } from '../../../services/market'
import { getShowDepthHeatmap } from '../overlayToggles'
import { binSnapshot, intensityCap, snapAtOrBefore, type DepthHistory } from './depthHistory'

type Any = any

const COL_PX = 2
const ROW_PX = 3

/** Low → high intensity: deep blue, cyan, then hot yellow. */
function ramp(v: number, out: Uint8ClampedArray, o: number): void {
  let r: number, g: number, b: number
  if (v < 0.5) {
    const k = v / 0.5
    r = 30 * (1 - k)
    g = 70 + 130 * k
    b = 190 + 65 * k
  } else {
    const k = (v - 0.5) / 0.5
    r = 255 * k
    g = 200 + 25 * k
    b = 255 - 195 * k
  }
  out[o] = r
  out[o + 1] = g
  out[o + 2] = b
  out[o + 3] = Math.round(255 * (0.1 + 0.65 * v))
}

export interface DepthHeatmapDeps {
  chart: Any
  history: DepthHistory
  /** The bars on the chart's time axis (rangeView's displayCandles). */
  bars: () => CandleFlat[]
  /** Longest gap between two snapshots still painted as continuous (ms). */
  maxGapMs: number
}

export function createDepthHeatmap(deps: DepthHeatmapDeps): {
  primitive: Any
  repaint: () => void
} {
  let series: Any = null
  let requestUpdate: (() => void) | null = null
  let memoKey = ''
  let image: HTMLCanvasElement | null = null
  let imageW = 0
  let imageH = 0
  let grid = new Float32Array(0)
  let counts = new Uint16Array(0)
  const tmpRows: { a: Float32Array } = { a: new Float32Array(0) }

  /** X (media px) of time `t` on the bars' axis, interpolated inside its bar. */
  function xOf(bars: CandleFlat[], t: number): number | null {
    let lo = 0
    let hi = bars.length - 1
    if (hi < 1 || t < bars[0].t) return null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (bars[mid].t <= t) lo = mid
      else hi = mid - 1
    }
    const start = bars[lo].t
    const next = lo + 1 < bars.length ? bars[lo + 1].t : start + (start - bars[lo - 1].t)
    const frac = next > start ? Math.min(1, (t - start) / (next - start)) : 0
    const ts = deps.chart.timeScale()
    const x0 = ts.logicalToCoordinate(lo)
    const x1 = ts.logicalToCoordinate(lo + 1)
    if (x0 == null || x1 == null) return null
    // A bar's slot runs from half a bar before its centre to half after.
    return x0 + (x1 - x0) * (frac - 0.5)
  }

  function build(w: number, h: number): HTMLCanvasElement | null {
    const snaps = deps.history.snaps
    const bars = deps.bars()
    if (!series || snaps.length < 2 || bars.length < 2 || w < 2 || h < 2) return null
    const cols = Math.ceil(w / COL_PX)
    const rows = Math.ceil(h / ROW_PX)
    if (grid.length < cols * rows) grid = new Float32Array(cols * rows)
    else grid.fill(0, 0, cols * rows)
    if (counts.length < cols) counts = new Uint16Array(cols)
    else counts.fill(0, 0, cols)
    if (tmpRows.a.length !== rows) tmpRows.a = new Float32Array(rows)
    const yOf = (p: number): number | null => series.priceToCoordinate(p)
    // Only snapshots from the first visible bar on.
    const ts = deps.chart.timeScale()
    const vr = ts.getVisibleLogicalRange()
    const firstBar = vr
      ? bars[Math.max(0, Math.min(bars.length - 1, Math.floor(vr.from)))]
      : bars[0]
    const from = Math.max(0, snapAtOrBefore(snaps, firstBar.t))
    for (let j = from; j < snaps.length; j++) {
      const s = snaps[j]
      const x = xOf(bars, s.t)
      if (x == null) continue
      if (x > w) break
      const end = j + 1 < snaps.length ? Math.min(snaps[j + 1].t, s.t + deps.maxGapMs) : s.t
      const xe = xOf(bars, end) ?? x
      const c0 = Math.max(0, Math.floor(x / COL_PX))
      const c1 = Math.min(cols - 1, Math.max(c0, Math.ceil(xe / COL_PX) - 1))
      if (c1 < 0 || c0 >= cols) continue
      const tmp = tmpRows.a
      tmp.fill(0)
      binSnapshot(s, yOf, ROW_PX, tmp)
      for (let c = c0; c <= c1; c++) {
        counts[c]++
        const off = c * rows
        for (let r = 0; r < rows; r++) if (tmp[r]) grid[off + r] += tmp[r]
      }
    }
    // Average where several snapshots share a column: a column must not
    // read brighter only because more samples fell into it.
    for (let c = 0; c < cols; c++) {
      const n = counts[c]
      if (n > 1) {
        const off = c * rows
        for (let r = 0; r < rows; r++) grid[off + r] /= n
      }
    }
    const cap = intensityCap(grid.subarray(0, cols * rows))
    if (!(cap > 0)) return null
    if (!image) image = document.createElement('canvas')
    if (imageW !== cols || imageH !== rows) {
      image.width = imageW = cols
      image.height = imageH = rows
    }
    const ictx = image.getContext('2d')
    if (!ictx) return null
    const img = ictx.createImageData(cols, rows)
    const px = img.data
    for (let c = 0; c < cols; c++) {
      if (!counts[c]) continue
      const off = c * rows
      for (let r = 0; r < rows; r++) {
        const v = grid[off + r] / cap
        if (v < 0.04) continue
        ramp(Math.min(1, v), px, (r * cols + c) * 4)
      }
    }
    ictx.putImageData(img, 0, 0)
    return image
  }

  function draw(target: Any): void {
    if (!getShowDepthHeatmap()) return
    target.useMediaCoordinateSpace((scope: Any) => {
      const { context: ctx, mediaSize } = scope
      const w = mediaSize.width
      const h = mediaSize.height
      const snaps = deps.history.snaps
      const vr = deps.chart.timeScale().getVisibleLogicalRange()
      // Two prices pin the (linear or log) scale's mapping as it autoscales.
      const last = snaps[snaps.length - 1]
      const ref = last && last.price.length ? last.price[0] : 1
      const key = [
        w,
        h,
        vr ? vr.from.toFixed(2) : '',
        vr ? vr.to.toFixed(2) : '',
        snaps.length,
        last ? last.t : 0,
        series?.priceToCoordinate(ref),
        series?.priceToCoordinate(ref * 1.01),
        deps.bars().length,
      ].join('|')
      if (key !== memoKey) {
        memoKey = key
        if (!build(w, h)) {
          memoKey = ''
          return
        }
      }
      if (!image || !imageW) return
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(image, 0, 0, imageW, imageH, 0, 0, imageW * COL_PX, imageH * ROW_PX)
      ctx.restore()
    })
  }

  const view = {
    zOrder: () => 'bottom' as const,
    renderer: () => ({ draw }),
  }
  const primitive = {
    attached(p: Any) {
      series = p.series
      requestUpdate = p.requestUpdate
      memoKey = ''
    },
    detached() {
      series = null
      requestUpdate = null
    },
    updateAllViews() {},
    paneViews: () => (getShowDepthHeatmap() ? [view] : []),
  }
  return {
    primitive,
    repaint: () => {
      memoKey = ''
      requestUpdate?.()
    },
  }
}
