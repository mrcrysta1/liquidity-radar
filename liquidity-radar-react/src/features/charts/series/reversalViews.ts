// Custom series renderers for the price-reversal styles: Kagi and Point &
// Figure. Same scaffolding as the other custom series (customSeries.ts
// makeView): they draw inside the chart's own pane, on its price scale.
//
// The bars come from series/kagi.ts and series/pointFigure.ts; what the
// renderer needs beyond OHLC travels on each bar as `aux`.
import { makeView } from './customSeries.ts'
import type { CandleData } from './customSeries'
import type { KagiAux } from './kagi'
import type { PnfAux } from './pointFigure'

type Any = any

// ---------------------------------------------------------------- kagi
/**
 * Vertical segments joined by horizontal connectors. Yang (thick, up colour)
 * and yin (thin, down colour) switch at the price recorded on the bar.
 */
export function kagiView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    const thick = Math.max(2, Math.round(3 * hRatio))
    const thin = Math.max(1, Math.round(1.2 * hRatio))
    ctx.lineCap = 'square'
    const seg = (x1: number, y1: number, x2: number, y2: number, yang: boolean): void => {
      ctx.strokeStyle = yang ? o.upColor : o.downColor
      ctx.lineWidth = yang ? thick : thin
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
    }
    for (let i = vis.from; i < vis.to; i++) {
      const bar = data.bars[i]
      const d: CandleData = bar.originalData
      const aux = d.aux as KagiAux | undefined
      if (!aux) continue
      const yO = toY(d.open)
      const yC = toY(d.close)
      if (yO == null || yC == null) continue
      const x = bar.x * hRatio
      // The shoulder/waist joining the previous segment to this one.
      const prev = data.bars[i - 1]
      if (prev) seg(prev.x * hRatio, yO, x, yO, aux.yang0)
      const yF = aux.flip == null ? null : toY(aux.flip)
      if (yF == null) seg(x, yO, x, yC, aux.yang0)
      else {
        seg(x, yO, x, yF, aux.yang0)
        seg(x, yF, x, yC, !aux.yang0)
      }
    }
  })
}

// ---------------------------------------------------------------- point & figure
/** X columns (rising) and O columns (falling), one mark per box. */
export function pointFigureView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio, vRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    const w = Math.max(2, data.barSpacing * 0.8) * hRatio
    ctx.lineWidth = Math.max(1, Math.round(1.4 * hRatio))
    for (let i = vis.from; i < vis.to; i++) {
      const bar = data.bars[i]
      const d: CandleData = bar.originalData
      const aux = d.aux as PnfAux | undefined
      if (!aux || !(aux.box > 0)) continue
      const up = d.close >= d.open
      const col = up ? o.upColor : o.downColor
      const x = bar.x * hRatio
      const yHi = toY(d.high)
      const yLo = toY(d.low)
      if (yHi == null || yLo == null) continue
      const n = Math.max(1, Math.round((d.high - d.low) / aux.box))
      const boxH = (yLo - yHi) / n
      ctx.strokeStyle = col
      ctx.fillStyle = col
      // Too small to tell an X from an O: a solid column says the same thing.
      if (boxH < 4 * vRatio || w < 4 * hRatio) {
        ctx.globalAlpha = 0.55
        ctx.fillRect(x - w / 2, yHi, w, Math.max(1, yLo - yHi))
        ctx.globalAlpha = 1
        continue
      }
      const pad = Math.min(w, boxH) * 0.14
      const hw = w / 2 - pad
      const hh = boxH / 2 - pad
      for (let j = 0; j < n; j++) {
        const cy = yLo - boxH * (j + 0.5)
        ctx.beginPath()
        if (up) {
          ctx.moveTo(x - hw, cy - hh)
          ctx.lineTo(x + hw, cy + hh)
          ctx.moveTo(x + hw, cy - hh)
          ctx.lineTo(x - hw, cy + hh)
        } else {
          ctx.ellipse(x, cy, Math.max(1, hw), Math.max(1, hh), 0, 0, Math.PI * 2)
        }
        ctx.stroke()
      }
    }
  })
}
