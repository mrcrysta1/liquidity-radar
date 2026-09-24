// Draws taker buy/sell delta (CVD) as a histogram pane under the price
// candles, the same way indicator panes stack (see indicators/render.ts) —
// kept separate because delta is trade-tape driven, not candle-derived.
import type { CandleFlat } from '../../services/market'
import { cumulativeDelta, getDeltaBars } from '../delta/delta'
import { getShowDelta } from './overlayToggles'

export type CvdDivergence = 'bullish' | 'bearish' | null

/**
 * Classic exhaustion read: price prints a new high/low over the lookback but
 * cumulative delta does not confirm it — the move is running on thinner and
 * thinner aggressor participation. Compares the two most recent swing points
 * within the window rather than just first-vs-last, so a mid-window pullback
 * doesn't mask the comparison.
 */
export function detectCvdDivergence(candles: CandleFlat[], lookback = 40): CvdDivergence {
  if (candles.length < lookback) return null
  const bars = getDeltaBars()
  if (bars.length < lookback) return null
  const w = candles.slice(-lookback)
  const byT = new Map(bars.map((b) => [b.t, b]))
  let cvd = 0
  const cvdSeries = w.map((c) => {
    const d = byT.get(c.t)
    cvd += d ? d.delta : 0
    return cvd
  })
  const hiIdx = w.reduce((best, c, i) => (c.h > w[best].h ? i : best), 0)
  const loIdx = w.reduce((best, c, i) => (c.l < w[best].l ? i : best), 0)
  const lastIdx = w.length - 1
  // New high late in the window, but CVD's own high came earlier and wasn't
  // matched on this latest push — buying pressure isn't keeping up.
  if (hiIdx === lastIdx && hiIdx > lookback / 2) {
    const priorMax = Math.max(...cvdSeries.slice(0, hiIdx))
    if (cvdSeries[hiIdx] < priorMax) return 'bearish'
  }
  if (loIdx === lastIdx && loIdx > lookback / 2) {
    const priorMin = Math.min(...cvdSeries.slice(0, loIdx))
    if (cvdSeries[loIdx] > priorMin) return 'bullish'
  }
  return null
}

export { cumulativeDelta }

type Any = any

const SCALE_ID = 'delta'
let chart: Any = null
let series: Any = null

export function attachDeltaPane(c: Any): void {
  chart = c
  series = null
}

function ensureSeries(): void {
  if (series || !chart) return
  series = chart.addHistogramSeries({
    priceScaleId: SCALE_ID,
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
    base: 0,
  })
}

function removeSeries(): void {
  if (!series || !chart) return
  try {
    chart.removeSeries(series)
  } catch (e) {
    /* already detached */
  }
  series = null
}

function layout(hasPane: boolean, otherPanes: number): void {
  if (!chart) return
  try {
    // Delta gets its own thin strip at the very bottom, under any indicator
    // panes; the price scale's bottom margin is nudged to make room.
    const deltaSlice = hasPane ? 0.12 : 0
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.08, bottom: Math.min(0.7, (otherPanes ? 0.22 * otherPanes : 0) + deltaSlice) },
    })
    if (hasPane) {
      chart.priceScale(SCALE_ID).applyOptions({
        scaleMargins: { top: 1 - deltaSlice + 0.02, bottom: 0 },
      })
    }
  } catch (e) {
    /* scale not mounted yet */
  }
}

/**
 * `otherPaneCount` lets us stack under whatever indicator panes (RSI, MACD…)
 * are already occupying the bottom of the chart, instead of overlapping them.
 */
export function renderDeltaPane(candles: CandleFlat[], otherPaneCount = 0): void {
  if (!chart) return
  if (!getShowDelta() || !candles.length) {
    removeSeries()
    layout(false, otherPaneCount)
    return
  }
  ensureSeries()
  const bars = getDeltaBars()
  const byT = new Map(bars.map((b) => [b.t, b]))
  const data = candles.map((c) => {
    const d = byT.get(c.t)
    const v = d ? d.delta : 0
    return {
      time: Math.floor(c.t / 1000),
      value: v,
      color: v >= 0 ? 'rgba(0,230,118,.75)' : 'rgba(255,23,68,.75)',
    }
  })
  series.setData(data)
  layout(true, otherPaneCount)
}

export function clearDeltaPane(): void {
  removeSeries()
}
