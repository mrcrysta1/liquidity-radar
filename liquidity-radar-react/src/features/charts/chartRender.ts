import * as LightweightCharts from 'lightweight-charts'
import { COINS, TICKER_COINS } from '../../constants/market'
import { pfmt, nfmt, cfmt, chgHtml } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $, showToast } from '../../utils/dom'
import { state } from '../../services/store'
import {
  attachIndicatorChart,
  indicatorLegend,
  refreshIndicatorColors,
  renderIndicators,
} from './indicators/render'
import { onIndicatorsChange } from './indicators/store'
import { isReplayOn, onReplayChange, visibleCandles } from './replay'
import { getChartStyle, isOhlcStyle, onChartStyleChange, styleDef } from './chartStyle'
import { CUSTOM_VIEWS, toCandleData } from './series/customSeries'
import { mountCloseTimer, updateCloseTimer } from './closeTimer'
import {
  drawToolDef,
  getDrawTool,
  isMagnet,
  onClearAllDrawings,
  onDrawToolChange,
  onUndoDrawing,
  setDrawTool,
  setDrawingCount,
  setPendingPoints,
} from './drawTools'
import { shape } from './drawings/geometry'
import type { Drawing, MapCtx, Shape } from './drawings/geometry'
import { fetchOlderKlines, historyExhausted } from '../../services/marketData'

type Any = any
;(window as Any).LightweightCharts = LightweightCharts

let chart: Any = null
let candleSeries: Any = null
// Chart style lives in ./chartStyle and indicators in indicators/store — both
// persist. What is left here is the live series handles and the drawings,
// which stay session-only.
const chartState: {
  drawTool: string | null
  drawings: Any[]
  drawBuf: Any[]
  [key: string]: Any
} = {
  drawTool: null,
  drawings: [],
  drawBuf: [],
}

export function isLightTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light'
}
export function cv(name: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--' + name)
    .trim()
  return (
    v ||
    (name === 'primary'
      ? '#2962FF'
      : name === 'green'
        ? '#00E676'
        : name === 'red'
          ? '#FF1744'
          : name === 'cyan'
            ? '#00E5FF'
            : '#0D1628')
  )
}
export function chartTheme(): Any {
  if (isLightTheme())
    return {
      bg: cv('card'),
      txt: cv('muted'),
      grid: '#E5E7EB',
      border: cv('border'),
      up: cv('green'),
      dn: cv('red'),
      pline: cv('primary'),
    }
  return {
    bg: cv('card'),
    txt: cv('muted'),
    grid: '#12203A',
    border: cv('border'),
    up: cv('green'),
    dn: cv('red'),
    pline: cv('primary'),
  }
}
export function applyChartTheme(): void {
  if (!chart) return
  const th = chartTheme()
  chart.applyOptions({
    layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.border },
    timeScale: { borderColor: th.border },
  })
  // Only feed each series the options it actually has — a line series has no
  // wick colours, and unknown keys are silently ignored, hiding mistakes.
  if (candleSeries) {
    const id = getChartStyle()
    const pRGB = cv('pRGB') || '41 98 255'
    if (CUSTOM_VIEWS[id]) {
      candleSeries.applyOptions({
        upColor: th.up,
        downColor: th.dn,
        wickColor: th.txt,
        textColor: th.txt,
        gridColor: isLightTheme() ? 'rgba(75,85,99,.3)' : 'rgba(143,160,181,.25)',
        priceLineColor: th.pline,
      })
    } else if (id === 'candle' || id === 'hollow') {
      candleSeries.applyOptions({
        upColor: id === 'hollow' ? 'rgba(0,0,0,0)' : th.up,
        downColor: id === 'hollow' ? 'rgba(0,0,0,0)' : th.dn,
        borderVisible: id === 'hollow',
        borderUpColor: th.up,
        borderDownColor: th.dn,
        wickUpColor: th.up,
        wickDownColor: th.dn,
        priceLineColor: th.pline,
      })
    } else if (id === 'bar') {
      candleSeries.applyOptions({ upColor: th.up, downColor: th.dn, priceLineColor: th.pline })
    } else if (id === 'area') {
      candleSeries.applyOptions({
        lineColor: cv('primary'),
        topColor: 'rgb(' + pRGB + ' / .34)',
        bottomColor: 'rgb(' + pRGB + ' / 0)',
        priceLineColor: th.pline,
      })
    } else if (id === 'baseline') {
      candleSeries.applyOptions({
        topLineColor: th.up,
        bottomLineColor: th.dn,
        priceLineColor: th.pline,
      })
    } else {
      candleSeries.applyOptions({ color: cv('primary'), priceLineColor: th.pline })
    }
  }
  refreshIndicatorColors()
}
export function mapCandle(c: Any): Any {
  return { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }
}

// ---- Overlay / pane series management ----
/**
 * Rebuild the price series for the current style.
 *
 * Every style gets a freshly created series: the old one is removed and the
 * module reference cleared first, because keeping a stale handle is exactly
 * what used to make "switch back to Candles" silently draw nothing.
 */
function applyChartStyle(): void {
  if (!chart) return
  if (chartState.styleSeries) {
    try {
      chart.removeSeries(chartState.styleSeries)
    } catch (e) {
      /* already detached */
    }
  }
  chartState.styleSeries = null
  candleSeries = null

  const th = chartTheme()
  const id = getChartStyle()
  const pRGB = cv('pRGB') || '41 98 255'
  const custom = CUSTOM_VIEWS[id]
  if (custom) {
    // Our own pane renderer, drawing inside the chart's price scale.
    candleSeries = chart.addCustomSeries(custom(), {
      upColor: th.up,
      downColor: th.dn,
      wickColor: th.txt,
      textColor: th.txt,
      gridColor: isLightTheme() ? 'rgba(75,85,99,.3)' : 'rgba(143,160,181,.25)',
      rows: 14,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'hollow') {
    candleSeries = chart.addCandlestickSeries({
      upColor: 'rgba(0,0,0,0)',
      downColor: 'rgba(0,0,0,0)',
      borderVisible: true,
      borderUpColor: th.up,
      borderDownColor: th.dn,
      wickUpColor: th.up,
      wickDownColor: th.dn,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'bar') {
    candleSeries = chart.addBarSeries({
      upColor: th.up,
      downColor: th.dn,
      thinBars: false,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'area') {
    candleSeries = chart.addAreaSeries({
      lineColor: cv('primary'),
      lineWidth: 2,
      topColor: 'rgb(' + pRGB + ' / .34)',
      bottomColor: 'rgb(' + pRGB + ' / 0)',
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'line') {
    candleSeries = chart.addLineSeries({
      color: cv('primary'),
      lineWidth: 2,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'baseline') {
    const base = state.candles.length ? state.candles[0].c : 0
    candleSeries = chart.addBaselineSeries({
      baseValue: { type: 'price', price: base },
      topLineColor: th.up,
      topFillColor1: 'rgba(0,230,118,.28)',
      topFillColor2: 'rgba(0,230,118,.02)',
      bottomLineColor: th.dn,
      bottomFillColor1: 'rgba(255,23,68,.02)',
      bottomFillColor2: 'rgba(255,23,68,.28)',
      lineWidth: 2,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else {
    candleSeries = chart.addCandlestickSeries({
      upColor: th.up,
      downColor: th.dn,
      borderVisible: false,
      wickUpColor: th.up,
      wickDownColor: th.dn,
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  }
  chartState.styleSeries = candleSeries
}
export function initChart(): void {
  if (!(window as Any).LightweightCharts) {
    $('legendOHLC')!.textContent = 'Chart library failed to load'
    return
  }
  const el = $('chart')!
  const th = chartTheme()
  chart = LightweightCharts.createChart(el, {
    // autoSize lets the library watch the container itself. Passing explicit
    // width/height instead makes it write inline sizes onto the element, which
    // then override the CSS — that is what used to leave the chart stuck at
    // whatever height the side panel had stretched it to.
    autoSize: true,
    layout: {
      background: { type: 'solid', color: th.bg },
      textColor: th.txt,
      fontSize: 11,
      fontFamily: "'JetBrains Mono', monospace",
    },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.border },
    timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: {
      mode: 0,
      vertLine: { color: th.pline, labelBackgroundColor: th.pline },
      horzLine: { color: th.pline, labelBackgroundColor: th.pline },
    },
    localization: {
      priceFormatter: function (p: number) {
        return pfmt(p)
      },
    },
  } as Any)
  applyChartStyle()
  attachIndicatorChart(chart)
  // The countdown reads the live series each time, so a style change that
  // replaces the series does not strand it.
  mountCloseTimer(chart, () => candleSeries)
  chart.subscribeCrosshairMove((param: Any) => {
    if (!param.time || !param.seriesData) return
    const cp = visibleCandles().find((c) => Math.floor(c.t / 1000) === param.time)
    if (cp) renderLegend(cp.o, cp.h, cp.l, cp.c, null, true)
  })
  chart.timeScale().subscribeVisibleTimeRangeChange(function () {
    redrawDrawings()
  })
  // The chart resizes itself; these only need to follow it.
  new ResizeObserver(() => {
    redrawDrawings()
    updateCloseTimer()
  }).observe(el)
  setupDrawLayer()
  initChartToolbar()
  initFullScreen()
  // Adding, editing or replaying an indicator redraws through the same path as
  // a fresh data load, so there is one place where series are built.
  onIndicatorsChange(() => updateChartData(false))
  onReplayChange((modeChanged: boolean) => updateChartData(modeChanged))
  onChartStyleChange(() => {
    // Same bars, drawn differently — keep whatever the user has zoomed or
    // panned to instead of snapping back to the newest candle. The range is
    // read before the series is swapped, because removing the only price
    // series can reset the time scale on its own.
    const ts = chart.timeScale()
    const keep = ts.getVisibleLogicalRange()
    applyChartStyle()
    updateChartData(false)
    if (!keep) return
    ts.setVisibleLogicalRange(keep)
    requestAnimationFrame(() => {
      const now = ts.getVisibleLogicalRange()
      if (now && Math.abs(now.to - keep.to) > 0.5) ts.setVisibleLogicalRange(keep)
    })
  })
  watchForOlderHistory()
  updateChartData(true)
}
function renderLegend(o: Any, h: Any, l: Any, c: Any, v: Any, isCross: Any): void {
  if (!isFinite(o)) return
  const up = c >= o
  $('legendOHLC')!.innerHTML =
    '<span>O <b style="color:' +
    (up ? 'var(--green)' : 'var(--red)') +
    '">' +
    pfmt(o) +
    '</b></span><span>H <b>' +
    pfmt(h) +
    '</b></span><span>L <b>' +
    pfmt(l) +
    '</b></span><span>C <b style="color:' +
    (up ? 'var(--green)' : 'var(--red)') +
    '">' +
    pfmt(c) +
    '</b></span>' +
    (v != null ? '<span>VOL <b>' + nfmt(v) + '</b></span>' : '') +
    indicatorLegendHtml()
}

/**
 * The active indicators' latest values, appended to the OHLC legend.
 *
 * Cached: building this recomputes every indicator across the whole series,
 * which is far too much work to repeat for each trade print. The OHLC half of
 * the legend is rebuilt every frame so it always equals the header price;
 * these values are refreshed a few times a second, which is as fast as a
 * moving average can meaningfully change anyway.
 */
let indLegendHtml = ''
export function refreshIndicatorLegend(): void {
  indLegendHtml = buildIndicatorLegend()
}
function indicatorLegendHtml(): string {
  return indLegendHtml
}
function buildIndicatorLegend(): string {
  const rows = indicatorLegend(visibleCandles())
  if (!rows.length) return ''
  return rows
    .map(
      (r) =>
        '<span class="leg-ind"><i>' +
        r.label +
        '</i>' +
        r.parts
          .map(
            (p) =>
              '<b style="color:' +
              p.color +
              '">' +
              (p.big ? nfmt(p.value) : pfmt(p.value)) +
              '</b>',
          )
          .join('') +
        '</span>',
    )
    .join('')
}
/**
 * Redraw the series.
 *
 * `fit` resets the viewport and belongs only to a genuinely new dataset — a
 * fresh load, a symbol or interval change, entering or leaving replay.
 * Everything else (toggling an indicator, paging in older history, stepping
 * replay) keeps whatever the user has scrolled to; refitting on every redraw
 * would yank the view back to the right edge mid-drag.
 */
export function updateChartData(fit = false): void {
  if (!chart) return
  const candles = visibleCandles()
  if (!candles.length) return
  const ts = chart.timeScale()
  const keep = fit ? null : ts.getVisibleLogicalRange()
  const prevFirst = chartState.firstBarTime as number | undefined
  if (styleDef(getChartStyle()).custom) {
    candleSeries.setData(toCandleData(candles))
  } else if (isOhlcStyle()) {
    candleSeries.setData(candles.map(mapCandle))
  } else {
    candleSeries.setData(candles.map((c) => ({ time: Math.floor(c.t / 1000), value: c.c })))
  }
  renderIndicators(candles)
  if (fit) {
    ts.fitContent()
  } else if (keep) {
    // Older candles land in front of index 0, so the same bars now sit that
    // many indices further along — shift the range to stay put.
    const added = countPrepended(prevFirst, candles)
    const want = { from: keep.from + added, to: keep.to + added }
    ts.setVisibleLogicalRange(want)
    // Adding a series (a new indicator pane) makes the chart scroll back to
    // the newest bar after this call returns, so claim the range again once
    // its own layout has settled.
    requestAnimationFrame(() => {
      const now = ts.getVisibleLogicalRange()
      if (now && Math.abs(now.to - want.to) > 0.5) ts.setVisibleLogicalRange(want)
    })
  }
  chartState.firstBarTime = candles[0].t
  const lc = candles[candles.length - 1]
  refreshIndicatorLegend()
  renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false)
  redrawDrawings()
  updateCloseTimer()
}

/** How many bars were prepended since the last draw. */
function countPrepended(prevFirst: number | undefined, candles: Any[]): number {
  if (prevFirst == null || !candles.length || candles[0].t >= prevFirst) return 0
  const i = candles.findIndex((c) => c.t === prevFirst)
  return i > 0 ? i : 0
}

// ---- Lazy history on pan ----
// Dragging towards the left edge pulls in the next page of older candles, so
// the chart keeps going back instead of ending in empty space.
const HISTORY_TRIGGER = 30
let historyPending = false
let userMovedChart = false
function watchForOlderHistory(): void {
  // A fresh fit starts the range at bar 0, which is indistinguishable from
  // "scrolled to the oldest bar" — so wait for a real pan or zoom before
  // paging, otherwise every load would pull history nobody asked for.
  const el = $('chart')
  if (el) {
    const moved = () => {
      userMovedChart = true
    }
    el.addEventListener('mousedown', moved)
    el.addEventListener('wheel', moved, { passive: true })
    el.addEventListener('touchstart', moved, { passive: true })
  }
  chart.timeScale().subscribeVisibleLogicalRangeChange((range: Any) => {
    if (!range || historyPending || !userMovedChart) return
    // Replay draws a slice of what is already loaded; nothing to fetch.
    if (isReplayOn() || range.from > HISTORY_TRIGGER || historyExhausted()) return
    historyPending = true
    fetchOlderKlines()
      .then((added) => {
        if (added > 0) updateChartData()
      })
      .finally(() => {
        historyPending = false
      })
  })
}

// A live tick moves the candle immediately; the indicators behind it are
// recomputed on the next frame so a 1s stream cannot run the maths ten times a
// second for no visible gain.
let indPending = false
let indLast = 0
const IND_REFRESH_MS = 250
export function updateChartLast(c: Any): void {
  if (!candleSeries) return
  // Replay owns the viewport while it is on — the tape must not jump ahead.
  if (isReplayOn()) return
  if (styleDef(getChartStyle()).custom) {
    candleSeries.update(toCandleData([c])[0])
  } else if (isOhlcStyle()) {
    candleSeries.update(mapCandle(c))
  } else {
    candleSeries.update({ time: Math.floor(c.t / 1000), value: c.c })
  }
  // The candle follows the tape frame by frame, but indicators and the legend
  // are recomputed over the whole series — far too much work to repeat on every
  // trade print, and nothing the eye could read that fast anyway.
  renderLegend(c.o, c.h, c.l, c.c, c.v, false)
  const now = Date.now()
  if (!indPending && now - indLast >= IND_REFRESH_MS) {
    indPending = true
    requestAnimationFrame(() => {
      indPending = false
      indLast = Date.now()
      if (!isReplayOn()) {
        renderIndicators(state.candles)
        refreshIndicatorLegend()
        const lc = state.candles[state.candles.length - 1]
        if (lc) renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false)
      }
      updateCloseTimer()
    })
  }
  redrawDrawings()
}
// ---- Toolbar wiring ----

function initChartToolbar(): void {
  // Drawing tools live in their own dropdown now; the chart only reacts to
  // what that store says is armed.
  onDrawToolChange(function () {
    chartState.drawBuf = []
    chartState._preview = null
    chartState._eraseHit = -1
    updateDrawHit()
    syncDrawHint()
    redrawDrawings()
  })
  onClearAllDrawings(function () {
    chartState.drawings = []
    chartState.drawBuf = []
    chartState._eraseHit = -1
    publishDrawingCount()
    redrawDrawings()
    showToast('Drawings cleared')
  })
  onUndoDrawing(function () {
    if (chartState.drawBuf.length) chartState.drawBuf = []
    else chartState.drawings.pop()
    chartState._eraseHit = -1
    publishDrawingCount()
    redrawDrawings()
  })
  syncDrawHint()
}

function publishDrawingCount(): void {
  setDrawingCount(chartState.drawings.length)
  setPendingPoints(chartState.drawBuf.length)
}

function syncDrawHint(): void {
  const hint = $('drawHint')
  if (!hint) return
  const def = drawToolDef(getDrawTool())
  hint.textContent = def ? def.name + ' — ' + def.hint : ''
}

// ---- Full screen ----
function initFullScreen(): void {
  const btn = $('fsBtn')
  if (!btn) return
  btn.addEventListener('click', function () {
    const fs = document.documentElement.classList.toggle('radar-fs')
    btn.textContent = fs ? '✕' : '⛶'
    btn.title = fs ? 'Exit full screen [F]' : 'Full screen [F]'
    requestAnimationFrame(function () {
      redrawDrawings()
      updateCloseTimer()
    })
    if (fs && window.scrollTo) window.scrollTo(0, 0)
  })
}

export function resizeChart(): void {
  requestAnimationFrame(function () {
    redrawDrawings()
    updateCloseTimer()
  })
}

// ---- Drawing layer (canvas overlay) ----
function setupDrawLayer(): void {
  const wrap = $('chartWrap')
  if (!wrap) return
  let cv = $('drawCanvas')
  if (!cv) {
    cv = document.createElement('canvas')
    cv.id = 'drawCanvas'
    cv.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:4;pointer-events:none;'
    wrap.style.position = 'relative'
    wrap.appendChild(cv)
  }
  chartState.drawCanvas = cv
  const overlay = document.createElement('div')
  overlay.id = 'drawHit'
  overlay.style.cssText = 'position:absolute;inset:0;z-index:6;cursor:crosshair;display:none;'
  wrap.appendChild(overlay)
  overlay.addEventListener('click', function (e) {
    const tool = getDrawTool()
    if (!tool) return
    const def = drawToolDef(tool)
    if (def && def.points === -1) return // freehand is handled by drag
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (tool === 'erase') {
      const i = drawingAt(x, y)
      if (i === -1) return
      chartState.drawings.splice(i, 1)
      chartState._eraseHit = -1
      publishDrawingCount()
      redrawDrawings()
      return
    }
    placeDrawPointFromXY(x, y)
  })
  // Open-ended shapes (polyline, patterns you want to cut short) finish here.
  overlay.addEventListener('dblclick', function () {
    const def = drawToolDef(getDrawTool())
    if (!def) return
    if (def.points === 0) commitPending()
  })
  // Freehand: press, drag, release.
  overlay.addEventListener('mousedown', function (e) {
    const def = drawToolDef(getDrawTool())
    if (!def || def.points !== -1) return
    const r = overlay.getBoundingClientRect()
    chartState._freehand = []
    const fx = e.clientX - r.left
    const fy = e.clientY - r.top
    chartState._freeXY = [fx, fy]
    const pt = snapToCandle(fx, fy)
    if (pt) chartState._freehand.push(pt)
  })
  overlay.addEventListener('mouseup', function () {
    const def = drawToolDef(getDrawTool())
    if (!def || def.points !== -1) return
    const pts = chartState._freehand || []
    chartState._freehand = null
    chartState._freeXY = null
    if (pts.length > 1) {
      chartState.drawings.push({ type: 'brush', color: def.color || '#4FC3F7', points: pts })
      publishDrawingCount()
    }
    redrawDrawings()
  })
  overlay.addEventListener('mousemove', function (e) {
    const tool = getDrawTool()
    if (!tool) return
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (tool === 'erase') {
      // Highlight whatever a click would remove, so nothing vanishes by surprise.
      const i = drawingAt(x, y)
      if (i !== chartState._eraseHit) {
        chartState._eraseHit = i
        overlay.style.cursor = i === -1 ? 'crosshair' : 'pointer'
        redrawDrawings()
      }
      return
    }
    const snapped = snapToCandle(x, y)
    if (!snapped) return
    if (chartState._freehand) {
      // Sample on raw pixel distance: two positions inside one bar map to the
      // same time, so a time-based gate would swallow most of the stroke.
      const prev = chartState._freeXY
      if (!prev || Math.hypot(x - prev[0], y - prev[1]) > 3) {
        chartState._freeXY = [x, y]
        chartState._freehand.push(snapped)
        redrawDrawings(true)
      }
      return
    }
    if (chartState.drawBuf.length) {
      chartState._preview = snapped
      redrawDrawings(true)
    }
  })
  overlay.addEventListener('mouseleave', function () {
    chartState._preview = null
    chartState._eraseHit = -1
    redrawDrawings()
  })
  chartState.drawHit = overlay
  updateDrawHit()
}
function updateDrawHit(): void {
  if (!chartState.drawHit) return
  const tool = getDrawTool()
  chartState.drawHit.style.display = tool ? 'block' : 'none'
  chartState.drawHit.style.cursor = tool === 'erase' ? 'pointer' : 'crosshair'
}

/**
 * Snap a pixel position to a point on the chart. With the magnet on, the price
 * jumps to the nearest open/high/low/close of the candle under the cursor —
 * the same idea as TradingView's magnet.
 */
const MAGNET_PX = 14
function snapToCandle(x: Any, y: Any): Any {
  const time = chart.timeScale().coordinateToTime(x)
  let price: number | null
  try {
    price = candleSeries ? candleSeries.coordinateToPrice(y) : null
  } catch (e) {
    price = null
  }
  if (time == null || price == null) return null
  if (!isMagnet() || !candleSeries) return { time: time, price: price }
  const candles = visibleCandles()
  const c = candles.find((k) => Math.floor(k.t / 1000) === time)
  if (!c) return { time: time, price: price }
  let best = price
  let bestDist = Infinity
  for (const v of [c.o, c.h, c.l, c.c]) {
    const cy = candleSeries.priceToCoordinate(v)
    if (cy == null) continue
    const d = Math.abs(cy - y)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  return { time: time, price: bestDist <= MAGNET_PX ? best : price }
}

function placeDrawPointFromXY(x: Any, y: Any): void {
  const def = drawToolDef(getDrawTool())
  if (!def) return
  const pt = snapToCandle(x, y)
  if (!pt) return
  chartState.drawBuf.push(pt)
  setPendingPoints(chartState.drawBuf.length)
  // points === 0 means open-ended: keep collecting until a double-click.
  if (def.points > 0 && chartState.drawBuf.length >= def.points) commitPending()
  redrawDrawings()
}

/** Turn the points collected so far into a drawing. */
function commitPending(): void {
  const def = drawToolDef(getDrawTool())
  if (!def) return
  const pts = chartState.drawBuf
  const min = def.points > 0 ? def.points : 2
  if (pts.length < min) return
  const drawing: Any = { type: def.id, color: def.color || '#4FC3F7', points: pts.slice() }
  if (def.text) {
    const caption = askCaption()
    if (caption === null) {
      chartState.drawBuf = []
      publishDrawingCount()
      redrawDrawings()
      return
    }
    drawing.text = caption
  }
  chartState.drawings.push(drawing)
  chartState.drawBuf = []
  chartState._preview = null
  publishDrawingCount()
  redrawDrawings()
}

/** Minimal caption prompt for the text tools. */
function askCaption(): string | null {
  const v = window.prompt('Label')
  if (v == null) return null
  return v.trim() || 'Note'
}

function resizeDrawCanvas(): void {
  const cv = chartState.drawCanvas
  const wrap = $('chartWrap')
  if (!cv || !wrap) return
  const dpr = window.devicePixelRatio || 1
  const w = wrap.clientWidth
  const h = wrap.clientHeight
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
  }
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'
}
/**
 * Endpoints of a drawing in canvas pixels, rays already extended. The renderer
 * and the eraser's hit test both go through this, so what you can click is
 * exactly what you can see.
 */
/** Everything the geometry engine needs to turn prices and times into pixels. */
function mapCtx(cw: number, ch: number): MapCtx {
  const ts = chart.timeScale()
  return {
    x: (t: number) => ts.timeToCoordinate(t as Any),
    y: (pr: number) => (candleSeries ? candleSeries.priceToCoordinate(pr) : null),
    cw: cw,
    ch: ch,
    fmt: (pr: number) => pfmt(pr),
    closesBetween(t1: number, t2: number) {
      const lo = Math.min(t1, t2) * 1000
      const hi = Math.max(t1, t2) * 1000
      return visibleCandles()
        .filter((k) => k.t >= lo && k.t <= hi)
        .map((k) => k.c)
    },
    barsBetween(t1: number, t2: number) {
      const lo = Math.min(t1, t2) * 1000
      const hi = Math.max(t1, t2) * 1000
      return visibleCandles().filter((k) => k.t >= lo && k.t <= hi).length
    },
    timeLabel(t: number) {
      return new Date(t * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    },
  }
}

function shapeOf(d: Any, cw: number, ch: number): Shape | null {
  if (!chart || !candleSeries) return null
  try {
    return shape(d as Drawing, mapCtx(cw, ch))
  } catch (e) {
    return null
  }
}

/** Index of the drawing under a pixel position, or -1. */
const HIT_PX = 7
function drawingAt(x: Any, y: Any): number {
  const cv = chartState.drawCanvas
  if (!cv) return -1
  const dpr = window.devicePixelRatio || 1
  const cw = cv.width / dpr
  const ch = cv.height / dpr
  for (let i = chartState.drawings.length - 1; i >= 0; i--) {
    const sh = shapeOf(chartState.drawings[i], cw, ch)
    if (!sh) continue
    for (const g of sh.segs) {
      if (pointToSegment(x, y, g.x1, g.y1, g.x2, g.y2) <= HIT_PX) return i
    }
    for (const l of sh.labels) {
      if (l.box && Math.abs(l.x - x) < 60 && Math.abs(l.y - y) < 12) return i
    }
  }
  return -1
}

function pointToSegment(px: Any, py: Any, x1: Any, y1: Any, x2: Any, y2: Any): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = dx * dx + dy * dy
  let t = len ? ((px - x1) * dx + (py - y1) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function paintShape(ctx: Any, sh: Shape, base: string, doomed: boolean): void {
  const stroke = doomed ? cv('red') || '#FF1744' : base
  sh.fills.forEach((f) => {
    if (f.pts.length < 6) return
    ctx.save()
    ctx.fillStyle = doomed ? 'rgba(255,23,68,.14)' : f.color
    ctx.beginPath()
    ctx.moveTo(f.pts[0], f.pts[1])
    for (let i = 2; i < f.pts.length; i += 2) ctx.lineTo(f.pts[i], f.pts[i + 1])
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })
  if (doomed) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,23,68,.32)'
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    sh.segs.forEach((g) => {
      ctx.beginPath()
      ctx.moveTo(g.x1, g.y1)
      ctx.lineTo(g.x2, g.y2)
      ctx.stroke()
    })
    ctx.restore()
  }
  sh.segs.forEach((g) => {
    ctx.save()
    ctx.strokeStyle = doomed ? stroke : g.color || base
    ctx.lineWidth = g.width || (doomed ? 2.2 : 1.7)
    ctx.lineCap = 'round'
    ctx.setLineDash(g.dash || [])
    ctx.beginPath()
    ctx.moveTo(g.x1, g.y1)
    ctx.lineTo(g.x2, g.y2)
    ctx.stroke()
    ctx.restore()
  })
  sh.arcs.forEach((a) => {
    if (a.rx <= 0 || a.ry <= 0) return
    ctx.save()
    ctx.strokeStyle = doomed ? stroke : a.color || base
    ctx.lineWidth = doomed ? 2.2 : 1.7
    ctx.setLineDash(a.dash || [])
    ctx.beginPath()
    ctx.ellipse(a.cx, a.cy, a.rx, a.ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  })
  sh.handles.forEach((h) => {
    ctx.save()
    ctx.fillStyle = doomed ? stroke : base
    ctx.beginPath()
    ctx.arc(h.x, h.y, 2.6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  })
  sh.labels.forEach((l) => {
    ctx.save()
    ctx.font = '10px JetBrains Mono, monospace'
    ctx.textAlign = l.align || 'left'
    const w = ctx.measureText(l.text).width
    if (l.box) {
      const bx = l.align === 'center' ? l.x - w / 2 : l.align === 'right' ? l.x - w : l.x
      ctx.fillStyle = 'rgba(6,11,24,.78)'
      ctx.fillRect(bx - 4, l.y - 10, w + 8, 14)
      ctx.strokeStyle = doomed ? stroke : l.color || base
      ctx.lineWidth = 1
      ctx.strokeRect(bx - 4, l.y - 10, w + 8, 14)
    }
    ctx.fillStyle = doomed ? stroke : l.color || base
    ctx.fillText(l.text, l.x, l.y)
    ctx.restore()
  })
}

function redrawDrawings(includePreview?: Any): void {
  const cv = chartState.drawCanvas
  if (!cv || !chart) return
  resizeDrawCanvas()
  const ctx = cv.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cv.width / dpr, cv.height / dpr)
  const cw = cv.width / dpr
  const ch = cv.height / dpr
  if (!candleSeries) return

  chartState.drawings.forEach(function (d: Any, i: number) {
    const sh = shapeOf(d, cw, ch)
    if (sh) paintShape(ctx, sh, d.color, i === chartState._eraseHit)
  })

  // The shape being placed, following the cursor.
  if (includePreview) {
    const def = drawToolDef(getDrawTool())
    const live = chartState._freehand
      ? { type: 'brush', color: def?.color || '#4FC3F7', points: chartState._freehand }
      : chartState.drawBuf.length && chartState._preview && def
        ? {
            type: def.id,
            color: def.color || '#4FC3F7',
            points: chartState.drawBuf.concat([chartState._preview]),
            text: def.text ? '…' : undefined,
          }
        : null
    if (live) {
      const sh = shapeOf(live, cw, ch)
      if (sh) {
        ctx.save()
        ctx.globalAlpha = 0.65
        paintShape(ctx, sh, live.color, false)
        ctx.restore()
      }
    }
  }
}

// ---- Hero / overview renders ----
export function renderHero(): void {
  const t = state.tickers[state.symbol] as Any
  const meta = coinMeta(state.symbol)
  $('heroIcon')!.textContent = meta.icon
  $('heroIcon')!.style.borderColor = meta.color + '55'
  $('heroName')!.textContent = meta.name
  $('heroPair')!.textContent = meta.sym + ' · BINANCE SPOT'
  if (!t) return
  const el = $('heroPrice')!
  const prev = parseFloat(el.dataset.p || '0')
  const cur = t.last
  el.textContent = '$' + pfmt(cur)
  if (prev && cur !== prev) {
    el.classList.remove('flash-up', 'flash-down')
    void el.offsetWidth
    el.classList.add(cur > prev ? 'flash-up' : 'flash-down')
    setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 450)
  }
  el.dataset.p = cur
  $('heroChg')!.innerHTML = chgHtml(t.pct) + ' <span style="color:var(--dim)">24h</span>'
  $('heroUpdated')!.textContent = '· ' + new Date().toLocaleTimeString()
  $('hsHigh')!.textContent = '$' + pfmt(t.high)
  $('hsLow')!.textContent = '$' + pfmt(t.low)
  $('hsVol')!.textContent = cfmt(t.qvol)
  $('hsTrades')!.textContent = nfmt(t.trades)
  if (state.fr) $('hsMark')!.textContent = '$' + pfmt(parseFloat((state.fr as Any).markPrice))
}

export function renderTicker(): void {
  const items = TICKER_COINS.map((k) => {
    const c = COINS[k]
    const t = state.tickers[c.sym]
    const pr = t ? '$' + pfmt(t.last) : '…'
    const ch = t ? chgHtml(t.pct) : '<span class="chg flat">—</span>'
    return (
      '<span class="tick' +
      (c.sym === state.symbol ? ' active' : '') +
      '" data-sym="' +
      c.sym +
      '"><span class="ts" style="color:' +
      c.color +
      '">' +
      c.icon +
      ' ' +
      k +
      '</span><span class="tp">' +
      pr +
      '</span>' +
      ch +
      '</span>'
    )
  }).join('')
  $('tickerTrack')!.innerHTML = items + items
}
