// A band fill for lightweight-charts v4's custom-series API: shades the area
// between two values per bar, in one colour where the first is above and
// another where the second is — the Ichimoku cloud (Span A vs Span B).
// Where the two lines cross between bars, the fill is split at the crossing
// so each side gets its own colour, as TradingView draws it.
//
// Data points: { time, a, b }. A point without both values is whitespace.

type Any = any

export interface CloudOptions {
  upColor: string
  downColor: string
}

const DEFAULTS: CloudOptions = {
  upColor: 'rgba(52,195,143,.16)',
  downColor: 'rgba(255,82,82,.16)',
}

export function cloudView(): Any {
  let data: Any = null
  let opts: CloudOptions = { ...DEFAULTS }
  return {
    priceValueBuilder: (d: Any) => [Math.max(d.a, d.b), Math.min(d.a, d.b), d.b],
    isWhitespace: (d: Any) => d.a === undefined || d.b === undefined,
    defaultOptions: () => ({ ...DEFAULTS }),
    update(d: Any, o: Any) {
      data = d
      opts = { ...DEFAULTS, ...(o || {}) }
    },
    renderer() {
      return {
        draw(target: Any, priceToCoordinate: Any) {
          target.useBitmapCoordinateSpace((scope: Any) => {
            const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope
            if (!data || !data.bars.length || !data.visibleRange) return
            const bars = data.bars
            // One bar either side, so the fill runs off the edges cleanly.
            const from = Math.max(0, data.visibleRange.from - 1)
            const to = Math.min(bars.length - 1, data.visibleRange.to)
            const quad = (pts: number[][], color: string) => {
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.moveTo(pts[0][0], pts[0][1])
              for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1])
              ctx.closePath()
              ctx.fill()
            }
            for (let i = from; i < to; i++) {
              const p0 = bars[i]?.originalData
              const p1 = bars[i + 1]?.originalData
              if (!p0 || !p1 || p0.a === undefined || p1.a === undefined) continue
              const ya0 = priceToCoordinate(p0.a)
              const yb0 = priceToCoordinate(p0.b)
              const ya1 = priceToCoordinate(p1.a)
              const yb1 = priceToCoordinate(p1.b)
              if (ya0 == null || yb0 == null || ya1 == null || yb1 == null) continue
              const x0 = bars[i].x * hr
              const x1 = bars[i + 1].x * hr
              const d0 = p0.a - p0.b
              const d1 = p1.a - p1.b
              if (d0 >= 0 === d1 >= 0) {
                quad(
                  [
                    [x0, ya0 * vr],
                    [x1, ya1 * vr],
                    [x1, yb1 * vr],
                    [x0, yb0 * vr],
                  ],
                  d0 >= 0 ? opts.upColor : opts.downColor,
                )
                continue
              }
              // The lines cross: split at the crossing point.
              const t = d0 / (d0 - d1)
              const xc = x0 + (x1 - x0) * t
              const yc = (ya0 + (ya1 - ya0) * t) * vr
              quad(
                [
                  [x0, ya0 * vr],
                  [xc, yc],
                  [x0, yb0 * vr],
                ],
                d0 >= 0 ? opts.upColor : opts.downColor,
              )
              quad(
                [
                  [xc, yc],
                  [x1, ya1 * vr],
                  [x1, yb1 * vr],
                ],
                d1 >= 0 ? opts.upColor : opts.downColor,
              )
            }
          })
        },
      }
    },
  }
}
