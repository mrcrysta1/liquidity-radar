// What bar replay draws on the price chart itself:
//
//  - while picking the start bar ("Select bar"), a vertical cut line under the
//    cursor with the bars to its right dimmed — the future that will be hidden
//    — and a click on the chart starts replay there;
//  - while a paper position is open, a dashed price line at its entry with
//    the side, size and open P&L, as TradingView's replay trading shows.
//
// lightweight-charts has no click-to-pick mode, so the cut line is a plain
// element inside #chartWrap that follows the crosshair. Bar times come from
// the logical index into displayCandles(), which is what the chart draws —
// that keeps range bars and the zoned time scale out of the picture.
import { $ } from '../../utils/dom'
import { pfmt } from '../../utils/format'
import { chartPalette, mainPaneHeight } from './chartPalette'
import { displayCandles } from './series/rangeView'
import { isSelecting, selectBarAt, step, subscribeReplay } from './replay'
import { markPrice, paperBook, subscribePaper } from './paperSession'
import { unrealized } from './paperTrading'

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
  })
  subscribePaper(syncPositionLine)
  onSeriesChange(() => syncPositionLine())
  // Escape leaves the picker and starts from the default bar.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSelecting()) step(0)
  })
}
