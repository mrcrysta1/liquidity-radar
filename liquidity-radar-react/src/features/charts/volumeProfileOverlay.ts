// Draws the volume-by-price histogram directly on the price chart as
// horizontal bars hugging the right edge, plus POC/VAH/VAL price lines —
// the same data already shown as a side list (see analysis/analytics.ts
// vpHtml), just placed where traders actually read support/resistance from.
//
// Implemented as its own canvas layer, the same pattern the drawing tools
// use (see chartRender.ts setupDrawLayer): lightweight-charts has no native
// "volume profile" series type, so pixel positions come from the candle
// series' own priceToCoordinate() on every redraw.
import type { CandleFlat } from '../../services/market'
import { computeVolumeProfile, bucketPriceRange } from './volumeProfile'
import { getShowVolumeProfile } from './overlayToggles'

type Any = any

let chart: Any = null
let candleSeries: Any = null
let canvas: HTMLCanvasElement | null = null

export function attachVolumeProfile(c: Any, series: Any, wrap: HTMLElement): void {
  chart = c
  candleSeries = series
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.id = 'vpCanvas'
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;'
    wrap.style.position = 'relative'
    wrap.appendChild(canvas)
  }
}

function resizeCanvas(): void {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }
}

export function renderVolumeProfile(candles: CandleFlat[]): void {
  if (!canvas || !chart || !candleSeries) return
  resizeCanvas()
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  ctx.clearRect(0, 0, cw, ch)
  if (!getShowVolumeProfile()) return

  const vp = computeVolumeProfile(candles)
  if (!vp) return
  const maxBarPx = Math.max(40, cw * 0.16)

  vp.buckets.forEach((vol, i) => {
    const [p0, p1] = bucketPriceRange(vp, i)
    const y0 = candleSeries.priceToCoordinate(p0)
    const y1 = candleSeries.priceToCoordinate(p1)
    if (y0 == null || y1 == null) return
    const top = Math.min(y0, y1)
    const h = Math.max(1, Math.abs(y1 - y0) - 1)
    const w = Math.max(2, (vol / vp.maxVol) * maxBarPx)
    const isPoc = i === vp.pocIdx
    const inValueArea = i >= vp.valIdx && i <= vp.vahIdx
    ctx.fillStyle = isPoc
      ? 'rgba(255,193,7,.55)'
      : inValueArea
        ? 'rgba(41,98,255,.32)'
        : 'rgba(143,160,181,.18)'
    ctx.fillRect(cw - w, top, w, h)
  })

  // POC / VAH / VAL as thin dashed lines across the visible width, labelled
  // on the right where the bars already draw the eye.
  const lines: Array<[number, string, string]> = [
    [vp.lo + (vp.pocIdx + 0.5) * vp.binSize, 'POC', 'rgba(255,193,7,.9)'],
    [vp.lo + (vp.vahIdx + 1) * vp.binSize, 'VAH', 'rgba(41,98,255,.85)'],
    [vp.lo + vp.valIdx * vp.binSize, 'VAL', 'rgba(41,98,255,.85)'],
  ]
  ctx.font = '10px "JetBrains Mono", monospace'
  ctx.textBaseline = 'middle'
  lines.forEach(([price, label, color]) => {
    const y = candleSeries.priceToCoordinate(price)
    if (y == null) return
    ctx.strokeStyle = color
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(cw - maxBarPx - 4, y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = color
    ctx.fillText(label, 4, y - 6)
  })
}

export function clearVolumeProfile(): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
}
