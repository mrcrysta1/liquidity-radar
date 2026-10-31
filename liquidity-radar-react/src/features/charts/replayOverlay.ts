// What bar replay draws on the price chart itself:
//
//  - while picking the start bar ("Select bar"), a vertical cut line under the
//    cursor with the bars to its right dimmed — the future that will be hidden
//    — and a click on the chart starts replay there;
//  - while a paper position is open, a dashed price line at its entry with
//    the side, size and open P&L, as TradingView's replay trading shows;
//  - the paper fills as entry/exit arrows on their bars, and each working
//    limit/stop order as a dotted line at its price ("trade from chart": a
//    click on the chart can set the order price).
//
// The fill arrows are this module's own series-markers plugin on the price
// series. Nothing else puts markers on that series (indicator and Pine
// markers live on their own series in indicators/render), so it owns the
// whole list; a chart-style change rebuilds the series and the plugin.
//
// lightweight-charts has no click-to-pick mode, so the cut line is a plain
// element inside #chartWrap that follows the crosshair. Bar times come from
// the logical index into displayCandles(), which is what the chart draws —
// that keeps range bars and the zoned time scale out of the picture.
import { createSeriesMarkers } from 'lightweight-charts'
import { $ } from '../../utils/dom'
import { pfmt } from '../../utils/format'
import { chartPalette, mainPaneHeight } from './chartPalette'
import { displayCandles } from './series/rangeView'
import { isReplayOn, isSelecting, replayNow, selectBarAt, step, subscribeReplay } from './replay'
import {
  isPickingPrice,
  markPrice,
  paperBook,
  pickPrice,
  setPickingPrice,
  subscribePaper,
  workingOrders,
} from './paperSession'
import { fillMarkers, unrealized } from './paperTrading'

type Any = any

let chart: Any = null
let getSeries: () => Any = () => null
let cutEl: HTMLElement | null = null
let futureEl: HTMLElement | null = null
let lastLogical: number | null = null

/** The bar under a logical index, clamped to the bars on screen. */
function barAt(logical: number): { t: number } | null {
  const bars = displayCandles()
  if (!bars.length) return null
  const i = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
  return bars[i]
}

function ensureEls(wrap: HTMLElement): void {
  if (!futureEl) {
    futureEl = document.createElement('div')
    futureEl.className = 'replay-future'
    wrap.appendChild(futureEl)
  }
  if (!cutEl) {
    cutEl = document.createElement('div')
    cutEl.className = 'replay-cut'
    wrap.appendChild(cutEl)
  }
}

function hideCut(): void {
  if (cutEl) cutEl.style.display = 'none'
  if (futureEl) futureEl.style.display = 'none'
}

/** Place the cut line on the bar at `logical`, dimming everything right of it. */
function drawCut(logical: number | null): void {
  const wrap = $('chartWrap')
  const el = $('chart')
  if (!chart || !wrap || !el || logical == null || !isSelecting()) return hideCut()
  ensureEls(wrap)
  const ts = chart.timeScale()
  const x = ts.logicalToCoordinate(Math.round(logical))
  if (x == null) return hideCut()
  // Pane x is measured from the plot's left edge; the plot starts after the
  // left price scale, and the chart element need not sit at the wrap's corner.
  const wr = wrap.getBoundingClientRect()
  const cr = el.getBoundingClientRect()
  let leftScale = 0
  try {
    leftScale = chart.priceScale('left').width() || 0
  } catch {
    /* no left scale */
  }
  const plotLeft = cr.left - wr.left + leftScale
  const plotW = ts.width()
  const top = cr.top - wr.top
  const h = mainPaneHeight(chart, el.clientHeight - ts.height())
  const left = plotLeft + Math.max(0, Math.min(plotW, x))
  for (const node of [cutEl!, futureEl!]) {
    node.style.display = 'block'
    node.style.top = top + 'px'
    node.style.height = h + 'px'
  }
  cutEl!.style.left = left + 'px'
  futureEl!.style.left = left + 'px'
  futureEl!.style.width = Math.max(0, plotLeft + plotW - left) + 'px'
}

// --------------------------------------------------------------- position line
let lineSeries: Any = null
let line: Any = null

function syncPositionLine(): void {
  const s = getSeries()
  if (s !== lineSeries) {
    line = null // the old series took its line with it
    lineSeries = s
  }
  const b = paperBook()
  const mark = markPrice()
  if (!s || b.pos === 0 || mark == null) {
    if (line) {
      try {
        s?.removePriceLine(line)
      } catch {
        /* series already gone */
      }
    }
    line = null
    return
  }
  const pnl = unrealized(b, mark)
  const pal = chartPalette()
  const opts = {
    price: b.avg,
    color: b.pos > 0 ? pal.up : pal.dn,
    lineWidth: 1,
    lineStyle: 2, // dashed
    axisLabelVisible: true,
    title:
      (b.pos > 0 ? 'Long ' : 'Short ') +
      Number(Math.abs(b.pos).toPrecision(6)) +
      '  ' +
      (pnl >= 0 ? '+' : '−') +
      pfmt(Math.abs(pnl)),
  }
  try {
    if (line) line.applyOptions(opts)
    else line = s.createPriceLine(opts)
  } catch {
    line = null
  }
}

// ------------------------------------------------- fill arrows + order lines
let markerSeries: Any = null
let markers: Any = null
let orderSeries: Any = null
let orderLines: Any[] = []
let orderKey = ''

function syncFillMarkers(): void {
  const s = getSeries()
  if (s !== markerSeries) {
    try {
      markers?.detach()
    } catch {
      /* went with its series */
    }
    markers = null
    markerSeries = s
  }
  if (!s) return
  const now = replayNow()
  const fills = paperBook().fills
  const list =
    isReplayOn() && now != null && fills.length
      ? fillMarkers(fills, displayCandles(), now, chartPalette(), pfmt)
      : []
  if (!markers) {
    if (!list.length) return
    markers = createSeriesMarkers(s, [])
  }
  markers.setMarkers(list)
}

function syncOrderLines(): void {
  const s = getSeries()
  const list = isReplayOn() ? workingOrders() : []
  const key = list.map((o) => o.id + ':' + o.price + ':' + o.qty).join(',')
  if (s === orderSeries && key === orderKey) return
  if (orderSeries)
    orderLines.forEach((l) => {
      try {
        orderSeries.removePriceLine(l)
      } catch {
        /* series already gone */
      }
    })
  orderLines = []
  orderSeries = s
  orderKey = key
  if (!s) return
  const pal = chartPalette()
  for (const o of list) {
    try {
      orderLines.push(
        s.createPriceLine({
          price: o.price,
          color: o.side === 'buy' ? pal.up : pal.dn,
          lineWidth: 1,
          lineStyle: 1, // dotted
          axisLabelVisible: true,
          title:
            (o.side === 'buy' ? 'Buy ' : 'Sell ') +
            o.type +
            ' ' +
            Number(o.qty.toPrecision(6)),
        }),
      )
    } catch {
      /* series mid-rebuild: the next change redraws */
    }
  }
}

function syncTradeMarks(): void {
  syncFillMarkers()
  syncOrderLines()
  $('chartWrap')?.classList.toggle('replay-picking-price', isPickingPrice())
}

/**
 * Called once by the main chart (chartRender) after it is built. The series
 * getter is read each time: a chart-style change rebuilds the price series.
 */
export function mountReplayOverlay(
  c: Any,
  series: () => Any,
  onSeriesChange: (fn: (s: Any) => void) => unknown,
): void {
  chart = c
  getSeries = series
  chart.subscribeCrosshairMove((p: Any) => {
    lastLogical = p?.point && p.logical != null ? p.logical : null
    drawCut(lastLogical)
  })
  chart.subscribeClick((p: Any) => {
    // Trade from chart: the clicked price becomes the order ticket's.
    if (isPickingPrice() && p?.point) {
      const px = getSeries()?.coordinateToPrice(p.point.y)
      if (px != null) pickPrice(Number(px))
      return
    }
    if (!isSelecting() || p?.logical == null) return
    const bar = barAt(p.logical)
    if (bar) selectBarAt(bar.t)
  })
  // Pan/zoom while picking moves the bars under a still cursor.
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
    if (isSelecting()) drawCut(lastLogical)
  })
  subscribeReplay(() => {
    $('chartWrap')?.classList.toggle('replay-selecting', isSelecting())
    if (isSelecting()) drawCut(lastLogical)
    else hideCut()
    // After the chart has redrawn the bars the arrows sit on.
    requestAnimationFrame(syncTradeMarks)
  })
  subscribePaper(syncPositionLine)
  subscribePaper(syncTradeMarks)
  onSeriesChange(() => {
    syncPositionLine()
    syncTradeMarks()
  })
  // Escape leaves the picker and starts from the default bar, or drops a
  // pending pick of the order price.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (isPickingPrice()) setPickingPrice(false)
    else if (isSelecting()) step(0)
  })
}
