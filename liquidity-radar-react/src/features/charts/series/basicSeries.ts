// TradingView's "Columns" and "High-low" styles, drawn with lightweight-charts'
// custom-series API so they live in the chart's own pane, price scale and
// crosshair. (HLC bars need no custom drawing: they are a bar series with the
// open tick turned off — see chartRender createPriceSeries.)
//
//   Columns  — a column from the bottom of the pane up to each close, green
//              when the close is at or above the previous close, red below.
//   High-low — a solid bar spanning each bar's high to low, no open/close.
//
// Both take the same bar data as the other custom styles (customSeries
// toCandleData), so the crosshair still sees the real OHLC.
import type { CandleData } from './customSeries'

type Any = any

export interface BasicStyleOptions {
  upColor: string
  downColor: string
  /** The High-low body colour. */
  color: string
}

const DEFAULTS: BasicStyleOptions = {
  upColor: '#00E676',
  downColor: '#FF1744',
  color: '#2962FF',
}

/** Is a column up? Against the previous close; the first bar against its own open. */
export function columnUp(
  prevClose: number | null | undefined,
  open: number,
  close: number,
): boolean {
  return prevClose != null && Number.isFinite(prevClose) ? close >= prevClose : close >= open
}

interface Paint {
  ctx: CanvasRenderingContext2D
  hRatio: number
  vRatio: number
  height: number
  data: Any
  opts: BasicStyleOptions
  toY: (p: number) => number | null
}

function makeView(priceValues: (d: CandleData) => number[], paint: (p: Paint) => void): Any {
  let _data: Any = null
  let _opts: BasicStyleOptions = { ...DEFAULTS }
  return {
    priceValueBuilder: priceValues,
    isWhitespace: (d: Any) => d.close === undefined,
    defaultOptions: () => ({ ...DEFAULTS }),
    update(data: Any, opts: Any) {
      _data = data
      _opts = { ...DEFAULTS, ...(opts || {}) }
    },
    renderer() {
      return {
        draw(target: Any, priceConverter: Any) {
          target.useBitmapCoordinateSpace((scope: Any) => {
            if (!_data || !_data.bars.length || !_data.visibleRange) return
            const vRatio = scope.verticalPixelRatio
            paint({
              ctx: scope.context,
              hRatio: scope.horizontalPixelRatio,
              vRatio,
              height: scope.bitmapSize.height,
              data: _data,
              opts: _opts,
              toY: (p: number) => {
                const y = priceConverter(p)
                return y == null ? null : y * vRatio
              },
            })
          })
        },
      }
    },
  }
}

/** Bar body width in bitmap pixels — close to the built-in candle's. */
function bodyWidth(barSpacing: number, hRatio: number, share: number): number {
  return Math.max(1, Math.floor(barSpacing * share * hRatio))
}

export function columnsView(): Any {
  // The scale follows the closes alone, as TradingView's does; the columns
  // simply run off the bottom of the pane.
  return makeView(
    (d) => [d.close],
    ({ ctx, hRatio, height, data, opts, toY }) => {
      const { from, to } = data.visibleRange
      const w = bodyWidth(data.barSpacing, hRatio, 0.8)
      ctx.save()
      ctx.globalAlpha = 0.5
      for (let i = from; i < to; i++) {
        const bar = data.bars[i]
        const d: CandleData = bar.originalData
        const y = toY(d.close)
        if (y == null) continue
        const prev = i > 0 ? data.bars[i - 1].originalData?.close : null
        ctx.fillStyle = columnUp(prev, d.open, d.close) ? opts.upColor : opts.downColor
        const left = Math.round(bar.x * hRatio - w / 2)
        const top = Math.round(y)
        ctx.fillRect(left, top, w, Math.max(1, height - top))
      }
      ctx.restore()
    },
  )
}

export function highLowView(): Any {
  return makeView(
    (d) => [d.high, d.low, d.close],
    ({ ctx, hRatio, vRatio, data, opts, toY }) => {
      const { from, to } = data.visibleRange
      const w = bodyWidth(data.barSpacing, hRatio, 0.6)
      ctx.fillStyle = opts.color
      for (let i = from; i < to; i++) {
        const bar = data.bars[i]
        const d: CandleData = bar.originalData
        const yH = toY(d.high)
        const yL = toY(d.low)
        if (yH == null || yL == null) continue
        const top = Math.round(yH)
        ctx.fillRect(
          Math.round(bar.x * hRatio - w / 2),
          top,
          w,
          Math.max(Math.round(vRatio), Math.round(yL) - top),
        )
      }
    },
  )
}

export const BASIC_VIEWS: Record<string, () => Any> = {
  columns: columnsView,
  highlow: highLowView,
}

/** Series options for a BASIC_VIEWS style, in the current theme's colours. */
export function basicSeriesOptions(th: { up: string; dn: string; pline: string }, primary: string) {
  return { upColor: th.up, downColor: th.dn, color: primary, priceLineColor: th.pline }
}
