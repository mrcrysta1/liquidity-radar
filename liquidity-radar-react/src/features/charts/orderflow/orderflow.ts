// Order-flow wiring for the main chart: feeds the real footprint book and the
// tick-chart tape from the aggTrade stream, samples the order book for the
// depth heatmap, and keeps the heatmap layer on the current price series.
//
// chartRender calls attachOrderflow() once; everything after that runs off
// the stream hook (services/streams onTradePrint), a sampling timer and the
// overlay toggles, so the chart's own code needs no other change.
import { state } from '../../../services/store'
import { onTradePrint } from '../../../services/streams'
import { subscribeChartStyle } from '../chartStyle'
import { getShowDepthHeatmap, onOverlayTogglesChange } from '../overlayToggles'
import { displayCandles } from '../series/rangeView'
import { addFootprintTrade } from './footprintBook'
import { liveFootprint } from './footprintSource'
import { recordTick } from './tickSource'
import { createDepthHistory, mergeBook, pushDepthSnap } from './depthHistory'
import { createDepthHeatmap } from './depthHeatmap'

type Any = any

/** Book sampling interval; 1200 samples at this rate is a 30-minute window. */
const SAMPLE_MS = 1500
const WINDOW = 1200
/** A book that has not changed for this long is a stalled stream, not a quiet market. */
const STALE_MS = 10_000

const history = createDepthHistory(WINDOW)
let histSym = ''
let lastOb: unknown = null
let lastObAt = 0

let attached = false
let getSeries: () => Any = () => null
let onSeries: Any = null
let heat: ReturnType<typeof createDepthHeatmap> | null = null

/** Move the heatmap onto the chart's current price series (it is rebuilt per style). */
function ensureOnSeries(): void {
  if (!heat) return
  const s = getSeries()
  if (s === onSeries) return
  try {
    onSeries?.detachPrimitive(heat.primitive)
  } catch (e) {
    /* the old series is already gone with the style change */
  }
  onSeries = s
  try {
    s?.attachPrimitive(heat.primitive)
  } catch (e) {
    onSeries = null
  }
}

type Level = [number, number]
function sampleBook(): void {
  ensureOnSeries()
  const sym = state.symbol
  if (sym !== histSym) {
    history.snaps.length = 0
    histSym = sym
    lastOb = null
  }
  const ob = state.ob
  if (!ob || !ob.bids?.length || !ob.asks?.length) return
  const now = Date.now()
  if (ob !== lastOb) {
    lastOb = ob
    lastObAt = now
  } else if (now - lastObAt > STALE_MS) return
  const live: Level[] = []
  ob.bids.forEach((l) => live.push([+l[0], +l[1]]))
  ob.asks.forEach((l) => live.push([+l[0], +l[1]]))
  // The REST book is refreshed on its own schedule and cleared on a coin
  // switch; one far from the live touch belongs to something else.
  const mid = (+ob.bids[0][0] + +ob.asks[0][0]) / 2
  let deep: Level[] | null = null
  const d = state.deepOb
  if (d && d.bids?.length && d.asks?.length && Math.abs(d.bids[0].price / mid - 1) < 0.05) {
    deep = []
    d.bids.forEach((l) => deep!.push([l.price, l.size]))
    d.asks.forEach((l) => deep!.push([l.price, l.size]))
  }
  pushDepthSnap(history, mergeBook(now, live, deep))
  // Sampled while hidden too, so switching it on shows history at once; but
  // the chart is only asked to repaint when the layer is on screen.
  if (getShowDepthHeatmap()) heat?.repaint()
}

export function attachOrderflow(chart: Any, series: () => Any): void {
  getSeries = series
  if (attached) {
    ensureOnSeries()
    return
  }
  attached = true
  onTradePrint((sym, price, info) => {
    if (!info) return
    addFootprintTrade(liveFootprint, {
      key: sym + '|' + info.tf,
      bar: info.bar,
      end: info.barEnd,
      price,
      qty: info.qty,
      buyerMaker: info.buyerMaker,
      time: info.time,
    })
    recordTick(sym, price, info.qty, info.time)
  })
  heat = createDepthHeatmap({
    chart,
    history,
    bars: displayCandles,
    maxGapMs: SAMPLE_MS * 3,
  })
  ensureOnSeries()
  // A style change swaps the price series after its listeners run: look on
  // the next tick, once the new series exists.
  subscribeChartStyle(() => setTimeout(ensureOnSeries, 0))
  onOverlayTogglesChange(() => {
    ensureOnSeries()
    heat?.repaint()
  })
  setInterval(sampleBook, SAMPLE_MS)
}
