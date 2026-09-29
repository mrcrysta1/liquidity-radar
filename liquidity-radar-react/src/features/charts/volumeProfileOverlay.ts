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
import { computeVolumeProfile, bucketPriceRange, type VolumeProfile } from './volumeProfile'
import { getShowVolumeProfile, getVolumeProfileSettings } from './overlayToggles'

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
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;'
    wrap.style.position = 'relative'
    wrap.appendChild(canvas)
  }
}

function resizeCanvas(): void {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  // Rounded: on a fractional DPR (125%, 150%) w*dpr is never an integer, so
  // an unrounded compare reallocated the canvas on every single redraw.
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

// The chart redraws this layer on every tick and every mouse move, but the
// profile only changes when the candles it covers or the settings do. The
// window is anchored to the last candle, so these fields pin it exactly.
let memoKey = ''
let memoVp: VolumeProfile | null = null
function profileFor(candles: CandleFlat[], rows: number, valueArea: number): VolumeProfile | null {
  const n = candles.length
  const first = candles[0]
  const last = candles[n - 1]
  const key = n
    ? [n, first.t, last.t, last.o, last.h, last.l, last.c, last.v, rows, valueArea].join('|')
    : ''
  if (key !== memoKey) {
    memoKey = key
    memoVp = n ? computeVolumeProfile(candles, rows, valueArea / 100) : null
  }
  return memoVp
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

  const { rows, valueArea, split } = getVolumeProfileSettings()
  const vp = profileFor(candles, rows, valueArea)
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
    if (split) {
      // Buy (up-bar) volume on the left of the bar, sell on the right; the
      // value area reads brighter than the tails, the POC gets a gold edge.
      const a = isPoc || inValueArea ? 0.42 : 0.18
      const buyW = vol > 0 ? w * (vp.buy[i] / vol) : 0
      ctx.fillStyle = 'rgba(34,224,138,' + a + ')'
      ctx.fillRect(cw - w, top, buyW, h)
      ctx.fillStyle = 'rgba(255,77,94,' + a + ')'
      ctx.fillRect(cw - w + buyW, top, w - buyW, h)
      if (isPoc) {
        ctx.strokeStyle = 'rgba(255,193,7,.9)'
        ctx.lineWidth = 1
        ctx.strokeRect(cw - w + 0.5, top + 0.5, w - 1, Math.max(0, h - 1))
      }
      return
    }
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
