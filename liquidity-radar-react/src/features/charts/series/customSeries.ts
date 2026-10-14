// Custom price-series renderers: volume candles, volume footprint, TPO
// (market profile) and session volume profile.
//
// These plug into lightweight-charts' custom-series API, so they draw inside
// the chart's own pane and share its price scale, crosshair and auto-scaling.
//
// A note on data. Binance klines give open/high/low/close/volume per bar and
// nothing about *where inside the bar* that volume traded. Footprint, TPO and
// the volume profile all need that distribution, so it is modelled: volume is
// spread across the bar's range with the weight concentrated toward the close,
// and split into buy/sell by where the close sits within the range. That is a
// standard approximation when tick data is not available — the UI labels these
// as estimates rather than passing them off as exchange data.
import type { CandleFlat } from '../../../services/market'

type Any = any

export interface CandleData {
  time: Any
  open: number
  high: number
  low: number
  close: number
  volume: number
  /** UTC day, precomputed. See toCandleData for why it is not derived later. */
  session: string
}

export interface CustomStyleOptions {
  upColor: string
  downColor: string
  wickColor: string
  textColor: string
  gridColor: string
  /** Rows per bar for footprint, price buckets for profiles. */
  rows: number
}

const DEFAULTS: CustomStyleOptions = {
  upColor: '#00E676',
  downColor: '#FF1744',
  wickColor: '#8FA0B5',
  textColor: '#C8D3E0',
  gridColor: 'rgba(143,160,181,.25)',
  rows: 14,
}

/**
 * The session key is computed here, from the millisecond timestamp we already
 * hold, and travels with the bar. Deriving it inside a renderer from the
 * series' own `time` does not work: by then the value has been through the
 * library's horizontal-scale handling and is no longer a plain epoch number.
 */
export function toCandleData(c: CandleFlat[]): CandleData[] {
  return c.map((k) => ({
    time: Math.floor(k.t / 1000),
    open: k.o,
    high: k.h,
    low: k.l,
    close: k.c,
    volume: k.v,
    session: new Date(k.t).toISOString().slice(0, 10),
  }))
}

/**
 * Split one bar's volume across `rows` price buckets, weighted toward the
 * close, and into buy/sell by where the close sits in the range.
 */
function distribute(
  bar: CandleData,
  rows: number,
): Array<{ lo: number; hi: number; buy: number; sell: number }> {
  const span = bar.high - bar.low
  const step = span > 0 ? span / rows : 1
  const out: Array<{ lo: number; hi: number; buy: number; sell: number }> = []
  const buyShare = span > 0 ? Math.max(0.15, Math.min(0.85, (bar.close - bar.low) / span)) : 0.5
  let total = 0
  const weights: number[] = []
  for (let i = 0; i < rows; i++) {
    const mid = bar.low + step * (i + 0.5)
    // Triangular weight peaking at the close — most trade happens near it.
    const d = span > 0 ? Math.abs(mid - bar.close) / span : 0
    const w = Math.max(0.08, 1 - d * 1.6)
    weights.push(w)
    total += w
  }
  for (let i = 0; i < rows; i++) {
    const v = total ? (bar.volume * weights[i]) / total : 0
    out.push({
      lo: bar.low + step * i,
      hi: bar.low + step * (i + 1),
      buy: v * buyShare,
      sell: v * (1 - buyShare),
    })
  }
  return out
}

/** Group visible bar indices by the session carried on each bar. */
function groupSessions(bars: Any, from: number, to: number): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (let i = from; i < to; i++) {
    const d = bars[i]?.originalData
    if (!d || !Number.isFinite(d.high)) continue
    const key = typeof d.session === 'string' ? d.session : 'all'
    const arr = out.get(key)
    if (arr) arr.push(i)
    else out.set(key, [i])
  }
  return out
}

interface RenderCtx {
  ctx: CanvasRenderingContext2D
  hRatio: number
  vRatio: number
}

/** Shared scaffolding: every view below only differs in how it paints a bar. */
function makeView(
  paint: (
    r: RenderCtx,
    data: Any,
    opts: CustomStyleOptions,
    toY: (p: number) => number | null,
  ) => void,
): Any {
  let _data: Any = null
  let _opts: CustomStyleOptions = { ...DEFAULTS }
  return {
    priceValueBuilder: (d: CandleData) => [d.high, d.low, d.close],
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
            const { context: ctx, horizontalPixelRatio: hRatio, verticalPixelRatio: vRatio } = scope
            if (!_data || !_data.bars.length) return
            const toY = (p: number) => {
              const y = priceConverter(p)
              return y == null ? null : y * vRatio
            }
            paint({ ctx, hRatio, vRatio }, _data, _opts, toY)
          })
        },
      }
    },
  }
}

// ---------------------------------------------------------------- volume candles
/** Candles whose body width scales with that bar's volume. */
export function volumeCandlesView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    let maxVol = 0
    for (let i = vis.from; i < vis.to; i++)
      maxVol = Math.max(maxVol, data.bars[i].originalData.volume || 0)
    const full = Math.max(1, data.barSpacing * 0.85)
    for (let i = vis.from; i < vis.to; i++) {
      const bar = data.bars[i]
      const d: CandleData = bar.originalData
      const yO = toY(d.open)
      const yC = toY(d.close)
      const yH = toY(d.high)
      const yL = toY(d.low)
      if (yO == null || yC == null || yH == null || yL == null) continue
      const up = d.close >= d.open
      const col = up ? o.upColor : o.downColor
      const x = bar.x * hRatio
      // Width carries the volume; a floor keeps thin bars visible.
      const frac = maxVol ? Math.max(0.18, (d.volume || 0) / maxVol) : 0.5
      const w = Math.max(1, full * frac * hRatio)
      ctx.fillStyle = col
      ctx.strokeStyle = col
      ctx.lineWidth = Math.max(1, hRatio)
      ctx.beginPath()
      ctx.moveTo(x, yH)
      ctx.lineTo(x, yL)
      ctx.stroke()
      const top = Math.min(yO, yC)
      const h = Math.max(1, Math.abs(yC - yO))
      ctx.fillRect(x - w / 2, top, w, h)
    }
  })
}

// ---------------------------------------------------------------- footprint
/** Buy/sell volume per price bucket, printed inside each bar. */
export function footprintView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio, vRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    const cellW = Math.max(2, data.barSpacing * 0.92) * hRatio
    const showText = data.barSpacing > 46
    let maxCell = 0
    const rowsPerBar: Array<ReturnType<typeof distribute>> = []
    for (let i = vis.from; i < vis.to; i++) {
      const rows = distribute(data.bars[i].originalData, o.rows)
      rowsPerBar.push(rows)
      rows.forEach((c) => {
        maxCell = Math.max(maxCell, c.buy, c.sell)
      })
    }
    ctx.font = Math.round(9 * vRatio) + 'px JetBrains Mono, monospace'
    ctx.textBaseline = 'middle'
    for (let i = vis.from; i < vis.to; i++) {
      const bar = data.bars[i]
      const rows = rowsPerBar[i - vis.from]
      const x = bar.x * hRatio
      const left = x - cellW / 2
      rows.forEach((cell) => {
        const yTop = toY(cell.hi)
        const yBot = toY(cell.lo)
        if (yTop == null || yBot == null) return
        const h = Math.max(1, yBot - yTop)
        const sellW = maxCell ? (cell.sell / maxCell) * (cellW / 2) : 0
        const buyW = maxCell ? (cell.buy / maxCell) * (cellW / 2) : 0
        ctx.fillStyle = 'rgba(255,23,68,.34)'
        ctx.fillRect(x - sellW, yTop, sellW, h)
        ctx.fillStyle = 'rgba(0,230,118,.34)'
        ctx.fillRect(x, yTop, buyW, h)
        ctx.strokeStyle = o.gridColor
        ctx.lineWidth = Math.max(0.5, 0.5 * vRatio)
        ctx.strokeRect(left, yTop, cellW, h)
        if (showText && h > 10 * vRatio) {
          ctx.fillStyle = o.textColor
          ctx.textAlign = 'right'
          ctx.fillText(cell.sell.toFixed(1), x - 2 * hRatio, yTop + h / 2)
          ctx.textAlign = 'left'
          ctx.fillText(cell.buy.toFixed(1), x + 2 * hRatio, yTop + h / 2)
        }
      })
      // Outline the bar's open/close so the price action stays readable.
      const d: CandleData = bar.originalData
      const yO = toY(d.open)
      const yC = toY(d.close)
      if (yO != null && yC != null) {
        ctx.strokeStyle = d.close >= d.open ? o.upColor : o.downColor
        ctx.lineWidth = Math.max(1, 1.4 * hRatio)
        ctx.strokeRect(left, Math.min(yO, yC), cellW, Math.max(1, Math.abs(yC - yO)))
      }
    }
  })
}

// ---------------------------------------------------------------- TPO
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Time Price Opportunity: each bar in a session contributes a letter to every
 * price bucket it traded through, stacked left to right from the session start.
 */
export function tpoView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio, vRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    const bars = data.bars
    // Bucket size from the visible range so the profile stays legible.
    let lo = Infinity
    let hi = -Infinity
    for (let i = vis.from; i < vis.to; i++) {
      const d = bars[i]?.originalData
      if (!d || !Number.isFinite(d.low) || !Number.isFinite(d.high)) continue
      lo = Math.min(lo, d.low)
      hi = Math.max(hi, d.high)
    }
    if (!(hi > lo)) return
    const buckets = 60
    const step = (hi - lo) / buckets
    const sessions = groupSessions(bars, vis.from, vis.to)
    ctx.font = Math.round(9 * vRatio) + 'px JetBrains Mono, monospace'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const cw = Math.max(5, 7 * hRatio)
    sessions.forEach((idxs) => {
      const startX = bars[idxs[0]].x * hRatio
      const rows = new Map<number, number>()
      idxs.forEach((i, letterIdx) => {
        const d: CandleData = bars[i].originalData
        const a = Math.max(0, Math.floor((d.low - lo) / step))
        const b = Math.min(buckets - 1, Math.floor((d.high - lo) / step))
        for (let k = a; k <= b; k++) {
          const n = rows.get(k) ?? 0
          const yTop = toY(lo + step * (k + 1))
          const yBot = toY(lo + step * k)
          if (yTop == null || yBot == null) continue
          const h = Math.max(1, yBot - yTop)
          ctx.fillStyle = letterIdx % 2 ? 'rgba(179,136,255,.55)' : 'rgba(0,229,255,.5)'
          ctx.fillRect(startX + n * cw, yTop, cw - 1, h)
          if (h > 9 * vRatio && cw > 6) {
            ctx.fillStyle = o.textColor
            ctx.fillText(LETTERS[letterIdx % LETTERS.length], startX + n * cw + 1, yTop + h / 2)
          }
          rows.set(k, n + 1)
        }
      })
    })
  })
}

// ---------------------------------------------------------------- session profile
/** Candles plus a per-session horizontal volume histogram and its point of control. */
export function sessionProfileView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    const bars = data.bars
    const bodyW = Math.max(1, data.barSpacing * 0.6) * hRatio

    // Candles first, so the profile reads as an overlay on real price action.
    for (let i = vis.from; i < vis.to; i++) {
      const d: CandleData = bars[i].originalData
      const yO = toY(d.open)
      const yC = toY(d.close)
      const yH = toY(d.high)
      const yL = toY(d.low)
      if (yO == null || yC == null || yH == null || yL == null) continue
      const col = d.close >= d.open ? o.upColor : o.downColor
      const x = bars[i].x * hRatio
      ctx.strokeStyle = col
      ctx.fillStyle = col
      ctx.lineWidth = Math.max(1, hRatio)
      ctx.beginPath()
      ctx.moveTo(x, yH)
      ctx.lineTo(x, yL)
      ctx.stroke()
      ctx.fillRect(x - bodyW / 2, Math.min(yO, yC), bodyW, Math.max(1, Math.abs(yC - yO)))
    }

    const sessions = groupSessions(bars, vis.from, vis.to)
    sessions.forEach((idxs) => {
      let lo = Infinity
      let hi = -Infinity
      idxs.forEach((i) => {
        lo = Math.min(lo, bars[i].originalData.low)
        hi = Math.max(hi, bars[i].originalData.high)
      })
      if (!(hi > lo)) return
      const buckets = 34
      const step = (hi - lo) / buckets
      const vol = new Array(buckets).fill(0)
      idxs.forEach((i) => {
        distribute(bars[i].originalData, buckets).forEach((cell, k) => {
          vol[k] += cell.buy + cell.sell
        })
      })
      const maxV = Math.max(...vol, 1e-9)
      const poc = vol.indexOf(Math.max(...vol))
      const startX = bars[idxs[0]].x * hRatio
      const endX = bars[idxs[idxs.length - 1]].x * hRatio
      const width = Math.max(30 * hRatio, (endX - startX) * 0.32)
      for (let k = 0; k < buckets; k++) {
        const yTop = toY(lo + step * (k + 1))
        const yBot = toY(lo + step * k)
        if (yTop == null || yBot == null) continue
        const h = Math.max(1, yBot - yTop - 1)
        const w = (vol[k] / maxV) * width
        ctx.fillStyle = k === poc ? 'rgba(255,213,79,.6)' : 'rgba(0,229,255,.26)'
        ctx.fillRect(startX, yTop, w, h)
      }
      // Session divider.
      ctx.strokeStyle = o.gridColor
      ctx.lineWidth = Math.max(1, hRatio)
      ctx.setLineDash([4 * hRatio, 3 * hRatio])
      ctx.beginPath()
      ctx.moveTo(startX, 0)
      ctx.lineTo(startX, 1e5)
      ctx.stroke()
      ctx.setLineDash([])
    })
  })
}

export const CUSTOM_VIEWS: Record<string, () => Any> = {
  volcandle: volumeCandlesView,
  footprint: footprintView,
  tpo: tpoView,
  sessionvp: sessionProfileView,
}
