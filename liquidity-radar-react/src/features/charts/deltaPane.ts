// Draws taker buy/sell delta (CVD) as a histogram pane under the price
// candles, the same way indicator panes stack (see indicators/render.ts) —
// kept separate because delta is trade-tape driven, not candle-derived.
import { HistogramSeries } from 'lightweight-charts'
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

let chart: Any = null
let series: Any = null

export function attachDeltaPane(c: Any): void {
  chart = c
  series = null
}

/**
 * The delta histogram lives in its own native pane (lightweight-charts v5),
 * always the last one, under any indicator panes. A pane added after it (a new
 * RSI) would leave it in the middle, so it is then re-created at the bottom.
 */
function ensureSeries(): void {
  if (!chart) return
  if (series) {
    try {
      const panes = chart.panes()
      if (series.getPane().paneIndex() === panes.length - 1) return
    } catch (e) {
      /* fall through: re-create */
    }
    removeSeries()
  }
  series = chart.addSeries(
    HistogramSeries,
    {
      priceScaleId: 'right',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      base: 0,
    },
    chart.panes().length,
  )
  drawn = { first: 0, last: 0 }
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

function layout(hasPane: boolean, _otherPanes: number): void {
  if (!chart || !hasPane || !series) return
  // A thin strip: half the height of an indicator pane.
  try {
    series.getPane().setStretchFactor(0.5)
    // Until an indicator pane has laid things out, the price pane is still at
    // the default factor 1 and the strip took a third of the chart.
    const main = chart.panes()[0]
    if (main && main.getStretchFactor() < 2.4) main.setStretchFactor(2.4)
  } catch (e) {
    /* pane not mounted yet */
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
  const data = candles.map((c) => deltaPoint(c.t, byT.get(c.t)?.delta ?? 0))
  series.setData(data)
  drawn = { first: candles[0].t, last: candles[candles.length - 1].t }
  layout(true, otherPaneCount)
}

/** Empty the series but keep the pane, so a new dataset lands on a clean time scale. */
export function blankDeltaPane(): void {
  series?.setData([])
  // The next draw is a full one: updateDeltaLast must not append to nothing.
  drawn = { first: 0, last: 0 }
}

const deltaPoint = (t: number, v: number) => ({
  time: Math.floor(t / 1000),
  value: v,
  color: v >= 0 ? 'rgba(0,230,118,.75)' : 'rgba(255,23,68,.75)',
})

/** The first and last bar times the pane last drew in full. */
let drawn = { first: 0, last: 0 }

/**
 * A trade only moves the delta of the bar still forming: update that one bar
 * instead of re-sending up to 5000 with setData on every animation frame.
 * Anything else (a new dataset, history paged in) takes the full redraw.
 */
export function updateDeltaLast(candles: CandleFlat[], otherPaneCount = 0): void {
  const n = candles.length
  if (!series || !n || !getShowDelta() || candles[0].t !== drawn.first || candles[n - 1].t < drawn.last) {
    renderDeltaPane(candles, otherPaneCount)
    return
  }
  const t = candles[n - 1].t
  const bars = getDeltaBars()
  let v = 0
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].t === t) {
      v = bars[i].delta
      break
    }
    if (bars[i].t < t) break
  }
  series.update(deltaPoint(t, v))
  drawn.last = t
}

export function clearDeltaPane(): void {
  removeSeries()
}
