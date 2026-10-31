// Volume Profile as an indicator: a lightweight-charts custom series on the
// price pane that bins its bars' volume by price (../volumeProfile, the same
// binning as the chart overlay and the side list) and draws the histogram,
// the value area and the Point of Control.
//
// Data points: { time, o, h, l, c, v } — the chart's own candles. The range
// profiled follows the `mode` option:
//  0 visible range: the bars on screen, anchored to the right edge;
//  1 session: one profile per UTC day in view, each from its day's start;
//  2 fixed lookback: the newest `lookback` bars.
// Being drawn by the series renderer, a visible-range profile follows every
// scroll and zoom with no extra wiring.
import type { CandleFlat } from '../../../services/market'
import { buildVolumeProfile } from '../volumeProfile.ts'

type Any = any

export interface VProfileOptions {
  mode: number
  lookback: number
  rows: number
  /** Value area, percent. */
  va: number
  /** Histogram length at the busiest row, percent of the range's width. */
  width: number
  upColor: string
  downColor: string
  pocColor: string
  vaLineColor: string
}

const DEFAULTS: VProfileOptions = {
  mode: 0,
  lookback: 200,
  rows: 48,
  va: 70,
  width: 30,
  upColor: 'rgba(41,98,255,.42)',
  downColor: 'rgba(251,192,45,.42)',
  pocColor: '#F23645',
  vaLineColor: 'rgba(41,98,255,.9)',
}

const DAY = 86400000
const MAX_SESSIONS = 40

/** The bar index ranges a profile is drawn for, by mode. Exported for tests. */
export function profileRanges(
  times: number[],
  mode: number,
  visible: { from: number; to: number } | null,
  lookback: number,
): Array<[number, number]> {
  const n = times.length
  if (!n) return []
  if (mode === 2) return [[Math.max(0, n - Math.max(1, Math.floor(lookback))), n - 1]]
  const from = visible ? Math.max(0, Math.floor(visible.from)) : 0
  const to = visible ? Math.min(n - 1, Math.ceil(visible.to)) : n - 1
  if (to < from) return []
  if (mode !== 1) return [[from, to]]
  // Sessions: each UTC day touching the view, from its first bar.
  const out: Array<[number, number]> = []
  let s = from
  const day = (i: number) => Math.floor(times[i] / DAY)
  while (s > 0 && day(s - 1) === day(s)) s--
  for (let i = s; i <= to; i++) {
    if (i === to || day(i + 1) !== day(i)) {
      out.push([s, i])
      s = i + 1
    }
  }
  return out.slice(-MAX_SESSIONS)
}

export function vprofileView(): Any {
  let data: Any = null
  let opts: VProfileOptions = { ...DEFAULTS }
  return {
    priceValueBuilder: (d: Any) => [d.c],
    isWhitespace: (d: Any) => d.v === undefined,
    defaultOptions: () => ({ ...DEFAULTS }),
    update(d: Any, o: Any) {
      data = d
      opts = { ...DEFAULTS, ...(o || {}) }
    },
    renderer() {
      return {
        draw(target: Any, priceToCoordinate: (p: number) => number | null) {
          target.useBitmapCoordinateSpace((scope: Any) => {
            const { context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr } = scope
            if (!data || !data.bars.length) return
            const bars = data.bars
            const times = bars.map((b: Any) => (b.originalData?.time ?? 0) * 1000)
            const ranges = profileRanges(times, opts.mode, data.visibleRange, opts.lookback)
            ranges.forEach(([a, b]) => {
              const w: CandleFlat[] = []
              for (let i = a; i <= b; i++) {
                const d = bars[i].originalData
                if (d && d.v !== undefined)
                  w.push({ t: times[i], o: d.o, h: d.h, l: d.l, c: d.c, v: d.v })
              }
              const vp = buildVolumeProfile(w, opts.rows, opts.va / 100)
              if (!vp || !vp.totalVol) return
              const x0 = bars[a].x * hr
              const x1 = bars[b].x * hr
              const span = Math.max(x1 - x0, 24 * hr)
              const len = (span * Math.min(100, Math.max(1, opts.width))) / 100
              // Visible range hugs the right edge, as TradingView's VPVR.
              const right = opts.mode === 0
              for (let r = 0; r < vp.buckets.length; r++) {
                const vol = vp.buckets[r]
                if (!vol) continue
                const yTop = priceToCoordinate(vp.lo + (r + 1) * vp.binSize)
                const yBot = priceToCoordinate(vp.lo + r * vp.binSize)
                if (yTop == null || yBot == null) continue
                const top = Math.round(Math.min(yTop, yBot) * vr) + 1
                const h = Math.max(1, Math.round(Math.abs(yBot - yTop) * vr) - 1)
                const total = (len * vol) / vp.maxVol
                const up = (total * vp.buy[r]) / vol
                const inVa = r >= vp.valIdx && r <= vp.vahIdx
                ctx.globalAlpha = inVa ? 1 : 0.45
                ctx.fillStyle = opts.upColor
                ctx.fillRect(right ? x1 - total : x0, top, up, h)
                ctx.fillStyle = opts.downColor
                ctx.fillRect(right ? x1 - total + up : x0 + up, top, total - up, h)
              }
              ctx.globalAlpha = 1
              const line = (price: number, color: string, dash: number[]) => {
                const y = priceToCoordinate(price)
                if (y == null) return
                const yy = Math.round(y * vr) + 0.5
                ctx.strokeStyle = color
                ctx.lineWidth = Math.max(1, Math.round(hr))
                ctx.setLineDash(dash.map((d) => d * hr))
                ctx.beginPath()
                ctx.moveTo(x0, yy)
                ctx.lineTo(Math.max(x1, x0 + span), yy)
                ctx.stroke()
              }
              line(vp.lo + (vp.vahIdx + 1) * vp.binSize, opts.vaLineColor, [4, 3])
              line(vp.lo + vp.valIdx * vp.binSize, opts.vaLineColor, [4, 3])
              line(vp.lo + (vp.pocIdx + 0.5) * vp.binSize, opts.pocColor, [])
              ctx.setLineDash([])
            })
          })
        },
      }
    },
  }
}
