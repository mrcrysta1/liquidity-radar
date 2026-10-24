// HLC area: TradingView's close line with the bar's high-low range shaded
// around it — green between the close and the high, red between the close and
// the low, with thin high and low lines on the edges.
//
// A custom series rather than stacked area series: one series means one
// price-scale entry, one last-value label (the close, the last value the
// price builder returns), autoscaling over the full high-low range and one
// set of data for the crosshair and the companion legends to read.
// Data is the same CandleData the other custom styles take (toCandleData).
type Any = any

export interface HlcAreaOptions {
  highLineColor: string
  lowLineColor: string
  closeLineColor: string
  highFillColor: string
  lowFillColor: string
  /** Close line width; the high and low lines are drawn at half of it. */
  lineWidth: number
}

const DEFAULTS: HlcAreaOptions = {
  highLineColor: '#089981',
  lowLineColor: '#F23645',
  closeLineColor: '#868993',
  highFillColor: 'rgba(8,153,129,0.2)',
  lowFillColor: 'rgba(242,54,69,0.2)',
  lineWidth: 2,
}

interface Pt {
  x: number
  h: number
  l: number
  c: number
}

export function hlcAreaView(): Any {
  let _data: Any = null
  let _opts: HlcAreaOptions = { ...DEFAULTS }
  return {
    // Last value first-to-last: the close is what the price line follows.
    priceValueBuilder: (d: Any) => [d.high, d.low, d.close],
    isWhitespace: (d: Any) => d.close === undefined,
    defaultOptions: () => ({ ...DEFAULTS }),
    update(data: Any, opts: Any) {
      _data = data
      _opts = { ...DEFAULTS, ...(opts || {}) }
    },
    renderer() {
      return {
        draw(target: Any, priceToCoordinate: Any) {
          target.useBitmapCoordinateSpace((scope: Any) => {
            const vis = _data?.visibleRange
            if (!vis || !_data.bars.length) return
            const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope
            const bars = _data.bars
            // One bar either side, so the shape runs off the edges instead of
            // stopping short of them.
            const from = Math.max(0, vis.from - 1)
            const to = Math.min(bars.length, vis.to + 1)
            // Runs of consecutive real bars; whitespace breaks the shape.
            const runs: Pt[][] = []
            let run: Pt[] = []
            for (let i = from; i < to; i++) {
              const d = bars[i].originalData
              const h = d && d.close !== undefined ? priceToCoordinate(d.high) : null
              const l = h != null ? priceToCoordinate(d.low) : null
              const c = l != null ? priceToCoordinate(d.close) : null
              if (h == null || l == null || c == null) {
                if (run.length) runs.push(run)
                run = []
                continue
              }
              run.push({ x: bars[i].x * hr, h: h * vr, l: l * vr, c: c * vr })
            }
            if (run.length) runs.push(run)
            const o = _opts
            const fill = (pts: Pt[], edge: 'h' | 'l', color: string) => {
              ctx.beginPath()
              ctx.moveTo(pts[0].x, pts[0][edge])
              for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i][edge])
              for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].c)
              ctx.closePath()
              ctx.fillStyle = color
              ctx.fill()
            }
            const stroke = (pts: Pt[], key: 'h' | 'l' | 'c', color: string, w: number) => {
              ctx.beginPath()
              ctx.moveTo(pts[0].x, pts[0][key])
              for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i][key])
              ctx.strokeStyle = color
              ctx.lineWidth = Math.max(1, w * hr)
              ctx.stroke()
            }
            ctx.lineJoin = 'round'
            ctx.lineCap = 'round'
            const lw = Math.max(1, Number(o.lineWidth) || 2)
            runs.forEach((pts) => {
              fill(pts, 'h', o.highFillColor)
              fill(pts, 'l', o.lowFillColor)
              stroke(pts, 'h', o.highLineColor, lw / 2)
              stroke(pts, 'l', o.lowLineColor, lw / 2)
              stroke(pts, 'c', o.closeLineColor, lw)
            })
          })
        },
      }
    },
  }
}
