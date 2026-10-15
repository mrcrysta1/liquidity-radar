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
  /** Bar open time in ms — the series' own `time` is not a plain epoch by render time. */
  ms: number
  /** Session key, precomputed. See toCandleData for why it is not derived later. */
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

const DAY_MS = 86_400_000

/**
 * The session a bar belongs to. Intraday bars group by UTC day; on longer
 * bars a day holds too few of them to make a profile (a 1D bar would be a
 * session of its own), so 4h+ bars group by week (Monday start), daily bars
 * by month and weekly-or-longer bars by year.
 */
export function sessionKey(ms: number, stepMs: number): string {
  const iso = new Date(ms).toISOString()
  if (stepMs >= 7 * DAY_MS) return iso.slice(0, 4)
  if (stepMs >= DAY_MS) return iso.slice(0, 7)
  // 1970-01-01 was a Thursday: +3 days puts week boundaries on Monday 00:00 UTC.
  if (stepMs >= 4 * 3_600_000) return 'w' + Math.floor((ms / DAY_MS + 3) / 7)
  return iso.slice(0, 10)
}

/** The bar interval: the smallest gap between the first few bars. */
function stepOf(c: CandleFlat[], prev?: CandleFlat | null): number {
  let step = Infinity
  for (let i = 1; i < Math.min(c.length, 12); i++) {
    const d = c[i].t - c[i - 1].t
    if (d > 0 && d < step) step = d
  }
  if (prev && c.length && c[0].t > prev.t) step = Math.min(step, c[0].t - prev.t)
  return isFinite(step) ? step : 0
}

/**
 * The session key is computed here, from the millisecond timestamp we already
 * hold, and travels with the bar. Deriving it inside a renderer from the
 * series' own `time` does not work: by then the value has been through the
 * library's horizontal-scale handling and is no longer a plain epoch number.
 * `prev` is the bar before `c[0]`: a lone live bar needs it to know the bar
 * interval, and so which session it belongs to.
 */
export function toCandleData(c: CandleFlat[], prev?: CandleFlat | null): CandleData[] {
  const step = stepOf(c, prev)
  return c.map((k) => ({
    time: Math.floor(k.t / 1000),
    open: k.o,
    high: k.h,
    low: k.l,
    close: k.c,
    volume: k.v,
    ms: k.t,
    session: sessionKey(k.t, step),
  }))
}

/**
 * Hollow candles, as TradingView draws them: the body is hollow when the bar
 * closed above its open and filled when it closed below it, and the colour
 * says whether it closed at/above (up) or below (down) the previous bar's
 * close. Per-bar colours, so the series options are only a fallback.
 * `prev` is the bar before `c[0]` (a live update of the last bar needs it).
 */
export function hollowCandleData(
  c: CandleFlat[],
  up: string,
  down: string,
  prev?: CandleFlat | null,
): Any[] {
  return c.map((k, i) => {
    const before = i > 0 ? c[i - 1] : prev
    const col = k.c >= (before ? before.c : k.o) ? up : down
    return {
      time: Math.floor(k.t / 1000),
      open: k.o,
      high: k.h,
      low: k.l,
      close: k.c,
      color: k.c >= k.o ? 'rgba(0,0,0,0)' : col,
      borderColor: col,
      wickColor: col,
    }
  })
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
/** A volume short enough to print inside a footprint cell: 0.4, 12, 3.4K, 1.2M. */
export function compactVol(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K'
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return a >= 10 ? v.toFixed(0) : v.toFixed(1)
}

/** Buy/sell volume per price bucket, printed inside each bar. */
export function footprintView(): Any {
  return makeView((r, data, o, toY) => {
    const { ctx, hRatio, vRatio } = r
    const vis = data.visibleRange
    if (!vis) return
    // Never wider than a bar slot, so neighbouring footprints cannot overlap
    // when zoomed out; too narrow for a grid to read, the cell outlines go.
    const cellW = Math.max(1, data.barSpacing * 0.92) * hRatio
    const showGrid = data.barSpacing >= 6
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
        if (showGrid) {
          ctx.strokeStyle = o.gridColor
          ctx.lineWidth = Math.max(0.5, 0.5 * vRatio)
          ctx.strokeRect(left, yTop, cellW, h)
        }
        if (showText && h > 10 * vRatio) {
          // Compact, and only when both halves fit inside the cell: raw
          // volumes on a low-priced coin run to millions and spilled into
          // the neighbouring bars.
          const sTxt = compactVol(cell.sell)
          const bTxt = compactVol(cell.buy)
          const room = cellW / 2 - 3 * hRatio
          if (ctx.measureText(sTxt).width <= room && ctx.measureText(bTxt).width <= room) {
            ctx.fillStyle = o.textColor
            ctx.textAlign = 'right'
            ctx.fillText(sTxt, x - 2 * hRatio, yTop + h / 2)
            ctx.textAlign = 'left'
            ctx.fillText(bTxt, x + 2 * hRatio, yTop + h / 2)
          }
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

/** A TPO letter covers 30 minutes, or one bar when bars are longer than that. */
const TPO_PERIOD_MS = 30 * 60_000

/**
 * Time Price Opportunity: each period of a session (30 minutes, as on
 * TradingView, or one bar on longer bars) contributes a letter to every price
 * bucket it traded through, stacked left to right from the session start.
 * A session's letters never reach past its own bars: when there are more
 * than fit, the columns narrow (and drop their letters) instead of running
 * over the next session.
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
    const fullCw = Math.max(5, 7 * hRatio)
    sessions.forEach((idxs) => {
      const first: CandleData = bars[idxs[0]].originalData
      const startX = bars[idxs[0]].x * hRatio
      const endX = bars[idxs[idxs.length - 1]].x * hRatio
      // Bar interval within this session, for the letter period.
      let barMs = Infinity
      for (let j = 1; j < idxs.length; j++) {
        const dt = bars[idxs[j]].originalData.ms - bars[idxs[j - 1]].originalData.ms
        if (dt > 0 && dt < barMs) barMs = dt
      }
      const period = Math.max(TPO_PERIOD_MS, isFinite(barMs) ? barMs : 0)
      const letterOf = (d: CandleData) =>
        Number.isFinite(d.ms) && Number.isFinite(first.ms)
          ? Math.max(0, Math.floor((d.ms - first.ms) / period))
          : 0
      // Pass 1: which letters land in each bucket (a period's bars share one).
      const marks: Array<number[]> = Array.from({ length: buckets }, () => [])
      idxs.forEach((i) => {
        const d: CandleData = bars[i].originalData
        const letter = letterOf(d)
        const a = Math.max(0, Math.floor((d.low - lo) / step))
        const b = Math.min(buckets - 1, Math.floor((d.high - lo) / step))
        for (let k = a; k <= b; k++) {
          const m = marks[k]
          if (m[m.length - 1] !== letter) m.push(letter)
        }
      })
      let most = 1
      marks.forEach((m) => (most = Math.max(most, m.length)))
      // The session's own width: from its first bar to half a slot past its last.
      const room = Math.max(1, endX - startX + data.barSpacing * hRatio * 0.5)
      const cw = Math.min(fullCw, room / most)
      const gap = cw >= 3 ? 1 : 0
      const withText = cw >= 6 * hRatio
      // Pass 2: paint.
      for (let k = 0; k < buckets; k++) {
        const m = marks[k]
        if (!m.length) continue
        const yTop = toY(lo + step * (k + 1))
        const yBot = toY(lo + step * k)
        if (yTop == null || yBot == null) continue
        const h = Math.max(1, yBot - yTop)
        m.forEach((letter, n) => {
          ctx.fillStyle = letter % 2 ? 'rgba(179,136,255,.55)' : 'rgba(0,229,255,.5)'
          ctx.fillRect(startX + n * cw, yTop, Math.max(0.5, cw - gap), h)
          if (withText && h > 9 * vRatio) {
            ctx.fillStyle = o.textColor
            ctx.fillText(LETTERS[letter % LETTERS.length], startX + n * cw + 1, yTop + h / 2)
          }
        })
      }
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
      // A third of the session, at least 30px — but never past its own bars,
      // or zoomed out (or on short sessions) profiles pile onto each other.
      const room = Math.max(1, endX - startX + data.barSpacing * hRatio * 0.5)
      const width = Math.min(room, Math.max(30 * hRatio, (endX - startX) * 0.32))
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
