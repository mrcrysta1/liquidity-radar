// TradingView's line family: Line, Line with markers, Step line, Area,
// HLC area and Baseline.
//
// createPriceSeries / themePriceSeries (chartRender) hand these styles over
// here, so the main chart and the multi-chart companions build them the same
// way. Colours come from the app palette (passed in, so this module does not
// depend on chartRender) and follow TradingView's defaults: 2px lines, an area
// fading from the line colour to transparent, a baseline green above its base
// and red below, and an HLC area shaded green between close and high and red
// between close and low.
import type { CandleFlat } from '../../../services/market'
import { hlcAreaView } from './hlcArea.ts'

type Any = any

export interface LineFamilyColors {
  /** Line colour for the single-value styles. */
  primary: string
  up: string
  dn: string
  /** The close line of the HLC area (TradingView draws it neutral). */
  neutral: string
  /** Price line colour, shared with every other style. */
  pline: string
}

const LINE_FAMILY = ['line', 'linemarkers', 'stepline', 'area', 'hlcarea', 'baseline']
export function isLineFamily(id: string): boolean {
  return LINE_FAMILY.indexOf(id) !== -1
}

/** `color` at opacity `a`, as rgba() — the chart library parses that reliably. */
export function withAlpha(color: string, a: number): string {
  const c = color.trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(c)
  if (m) {
    let h = m[1]
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, (x) => x + x)
    const n = parseInt(h.slice(0, 6), 16)
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  if (m) return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + a + ')'
  return c
}

/** Colour options for style `id` — used both to create and to re-theme it. */
function colorOptions(id: string, k: LineFamilyColors): Any {
  if (id === 'area') {
    return {
      lineColor: k.primary,
      topColor: withAlpha(k.primary, 0.28),
      bottomColor: withAlpha(k.primary, 0),
      priceLineColor: k.pline,
    }
  }
  if (id === 'baseline') {
    return {
      topLineColor: k.up,
      topFillColor1: withAlpha(k.up, 0.28),
      topFillColor2: withAlpha(k.up, 0.05),
      bottomLineColor: k.dn,
      bottomFillColor1: withAlpha(k.dn, 0.05),
      bottomFillColor2: withAlpha(k.dn, 0.28),
      priceLineColor: k.pline,
    }
  }
  if (id === 'hlcarea') {
    return {
      highLineColor: k.up,
      lowLineColor: k.dn,
      closeLineColor: k.neutral,
      highFillColor: withAlpha(k.up, 0.2),
      lowFillColor: withAlpha(k.dn, 0.2),
      priceLineColor: k.pline,
    }
  }
  return { color: k.primary, priceLineColor: k.pline }
}

/**
 * Add the series for a line-family style to chart `c`, or return null when
 * `id` is not one of them. `baseline` is the Baseline style's starting base
 * price; syncBaselineBase then keeps it on the visible range's midpoint.
 */
export function createLineFamilySeries(
  c: Any,
  id: string,
  k: LineFamilyColors,
  baseline = 0,
): Any | null {
  if (!isLineFamily(id)) return null
  const common = { lineWidth: 2, priceLineStyle: 2, ...colorOptions(id, k) }
  if (id === 'hlcarea') return c.addCustomSeries(hlcAreaView(), common)
  if (id === 'area') return c.addAreaSeries(common)
  if (id === 'baseline')
    return c.addBaselineSeries({ ...common, baseValue: { type: 'price', price: baseline } })
  return c.addLineSeries({
    ...common,
    // LineType.WithSteps
    lineType: id === 'stepline' ? 1 : 0,
    pointMarkersVisible: id === 'linemarkers',
  })
}

/** Re-colour a line-family series; false when `id` is not one of them. */
export function themeLineFamilySeries(series: Any, id: string, k: LineFamilyColors): boolean {
  if (!isLineFamily(id)) return false
  series.applyOptions(colorOptions(id, k))
  return true
}

// ---- Baseline base level ----
// TradingView puts the baseline at a percentage of the visible price range
// (50% by default). Following that keeps both colours in view wherever the
// chart is panned, where a fixed first close soon leaves the whole line on
// one side of it. The midpoint is taken from the bars' closes rather than the
// price scale, so the base never feeds back into the scale it is drawn on.
interface BaseTrack {
  chart: Any
  bars: () => CandleFlat[]
  base: number
  pending: boolean
  stopped: boolean
  off: () => void
}
const tracks = new WeakMap<object, BaseTrack>()

/**
 * Midpoint of the closes of bars[from..to] (a logical range, so the ends may
 * be fractional or run past the data). Falls back to the last close when the
 * range holds no bar, and null when there are no bars at all.
 */
export function closeMidpoint(bars: CandleFlat[], from: number, to: number): number | null {
  const n = bars.length
  if (!n) return null
  const a = Math.max(0, Math.floor(from))
  const b = Math.min(n - 1, Math.ceil(to))
  let lo = Infinity
  let hi = -Infinity
  for (let i = a; i <= b; i++) {
    const v = bars[i].c
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!isFinite(lo)) return bars[n - 1].c
  return (lo + hi) / 2
}

function midpoint(chart: Any, bars: CandleFlat[]): number | null {
  const r = chart.timeScale().getVisibleLogicalRange()
  return r ? closeMidpoint(bars, r.from, r.to) : closeMidpoint(bars, 0, bars.length - 1)
}

function schedule(series: Any, t: BaseTrack): void {
  if (t.pending || t.stopped) return
  t.pending = true
  requestAnimationFrame(() => {
    t.pending = false
    if (t.stopped) return
    try {
      const mid = midpoint(t.chart, t.bars())
      if (mid == null || !isFinite(mid)) return
      if (Math.abs(mid - t.base) <= Math.abs(mid) * 1e-7) return
      t.base = mid
      series.applyOptions({ baseValue: { type: 'price', price: mid } })
    } catch (e) {
      // The chart or series went away between the request and the frame.
      t.stopped = true
    }
  })
}

/**
 * Keep a Baseline series' base on the midpoint of the visible closes. Call it
 * after each setData/update: the first call starts following the time scale,
 * later ones refresh `bars` and recompute (once per frame at most).
 */
export function syncBaselineBase(chart: Any, series: Any, bars: () => CandleFlat[]): void {
  if (!chart || !series) return
  let t = tracks.get(series)
  if (!t) {
    const onRange = () => {
      if (t) schedule(series, t)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
    t = {
      chart,
      bars,
      base: NaN,
      pending: false,
      stopped: false,
      off: () => {
        try {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
        } catch (e) {
          /* chart already removed */
        }
      },
    }
    tracks.set(series, t)
  }
  t.bars = bars
  schedule(series, t)
}

/** Stop following the range — call before removing the series from a live chart. */
export function stopBaselineBase(series: Any): void {
  const t = series ? tracks.get(series) : undefined
  if (!t) return
  t.stopped = true
  t.off()
  tracks.delete(series)
}
