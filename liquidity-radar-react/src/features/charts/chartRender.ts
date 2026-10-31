import * as LightweightCharts from 'lightweight-charts'
import { createZonedChart } from './zonedTimeScale'
import { keepMainPane } from './chartPalette'
import { chartSettings, subscribeChartSettings } from './chartSettings'
import { onPineResult, setPineChart } from './pine/indicator'
import { venueOf } from '../../utils/coins'
import { COINS, TICKER_COINS } from '../../constants/market'
import { fmt, pfmt, nfmt, cfmt, chgHtml, priceDecimals, priceFormatFor } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $, showToast } from '../../utils/dom'
import { state } from '../../services/store'
import { storageGet, storageSet } from '../../services/storage'
import {
  attachIndicatorChart,
  blankIndicators,
  indicatorLegend,
  indicatorPaneCount,
  indicatorPaneOf,
  refreshIndicatorColors,
  renderIndicators,
} from './indicators/render'
import { onIndicatorsChange, removeIndicator, toggleIndicator } from './indicators/store'
import { isReplayOn, onReplayChange, visibleCandles } from './replay'
import {
  getChartStyle,
  onChartStyleChange,
  onRangeSettingsChange,
  styleDef,
} from './chartStyle'
import type { ChartStyleId } from './chartStyle'
import type { CandleFlat } from '../../services/market'
import { CUSTOM_VIEWS, hollowCandleData, toCandleData } from './series/customSeries'
import { BASIC_VIEWS, basicSeriesOptions } from './series/basicSeries'
import { heikinAshiBar, heikinAshiOf } from './series/heikinAshi'
import {
  createLineFamilySeries,
  stopBaselineBase,
  syncBaselineBase,
  themeLineFamilySeries,
} from './series/lineFamily'
import type { LineFamilyColors } from './series/lineFamily'
import { displayCandles, isRangeMode, snapChartTime, timeOnlyCandles } from './series/rangeView'
import { renkoSeriesOptions } from './series/renko'
import { subscribeReversalSettings } from './series/reversalSettings'
import { tfDef } from '../../services/timeframe'
import { mountCloseTimer, updateCloseTimer } from './closeTimer'
import { getTimeframe, tfLabel } from './timeframes'
import { fmtChartDate, isDailyTf } from './timezone'
import {
  chartPalette,
  resetTvLastPrice,
  tvChartOptions,
  tvLastPrice,
  syncTvWatermark,
  mainPaneHeight,
} from './chartPalette'
import {
  drawToolDef,
  getDrawTool,
  getMagnetMode,
  onClearAllDrawings,
  onDrawingCommand,
  onDrawToolChange,
  onDeleteSelectedDrawing,
  onEditSelectedDrawing,
  onRedoDrawing,
  onUndoDrawing,
  setDrawTool,
  setDrawingCount,
  setDrawingHistory,
  setDrawingList,
  stayInDrawingMode,
  toolTemplate,
  setSelectedDrawing,
  setPendingPoints,
} from './drawTools'
import type { DrawingCommand } from './drawTools'
import { createDrawingHistory } from './drawings/history'
import { shape } from './drawings/geometry'
import type { Drawing, MapCtx, Shape } from './drawings/geometry'
import { handleAt, hitShape, shiftPoints } from './drawings/edit'
import { logicalToTime, timeToLogical } from './drawings/timeMap'
import { cloneDrawing, constrainAngle, fixPositionSides, reorder } from './drawings/ops'
import { fetchOlderKlines, historyExhausted } from '../../services/marketData'
import { attachDeltaPane, blankDeltaPane, renderDeltaPane, updateDeltaLast } from './deltaPane'
import { subscribeSymbol } from '../actions/userActions'
import { attachWhaleBubbles, renderWhaleBubbles, watchLiveWhales } from './whaleBubbles'
import { attachVolumeProfile, renderVolumeProfile } from './volumeProfileOverlay'
import { attachCompare, compareLegendHtml } from './compare'
import { onDeltaChange } from '../delta/delta'
import { onOverlayTogglesChange } from './overlayToggles'
import { afterChartFit, attachScaleNav, subscribeScaleNav, syncView as syncScaleNavView } from './scaleNav'
import { registerCrosshairSync } from './crosshairSync'
import { mainLinkKey, registerTimeSync } from './linkGroups'
import type { TimeSyncHandle } from './linkGroups'

type Any = any
;(window as Any).LightweightCharts = LightweightCharts

let chart: Any = null
/** The main chart in its link group's time-range sync (./linkGroups). */
let mainTimeLink: TimeSyncHandle | null = null
let candleSeries: Any = null
// Alert price lines (features/alerts/alertLines) hang off the price series,
// which is rebuilt on every style change — let them follow it.
const priceSeriesSubs = new Set<(s: Any) => void>()
export const getPriceSeries = (): Any => candleSeries
export function onPriceSeriesChange(fn: (s: Any) => void): () => void {
  priceSeriesSubs.add(fn)
  return () => priceSeriesSubs.delete(fn)
}
// Chart style lives in ./chartStyle and indicators in indicators/store — both
// persist. What is left here is the live series handles and the drawings of
// the coin on screen (saved per coin, see currentDrawings).
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
/**
 * Chart colours. The default palette draws as TradingView, the others keep
 * their own colours — see ./chartPalette.
 */
export function chartTheme(): Any {
  return { ...chartPalette(), pline: cv('primary') }
}
export function applyChartTheme(): void {
  if (!chart) return
  chart.applyOptions(tvChartOptions(undefined, mainIsDaily))
  watermarkShown = ''
  syncWatermark()
  applyChartSettings()
  if (candleSeries) {
    themePriceSeries(candleSeries, getChartStyle())
    resetTvLastPrice(candleSeries)
    const shown = displayCandles()
    syncLastPrice(shown[shown.length - 1])
    // Hollow candles carry their colours per bar: re-colour the data too.
    if (getChartStyle() === 'hollow' && shown.length)
      candleSeries.setData(priceSeriesData('hollow', shown))
  }
  refreshIndicatorColors()
  renderLiveLegend()
}

/** Daily-or-longer bars on the main chart: dated by UTC session (./timezone). */
const mainIsDaily = (): boolean => !isRangeMode() && isDailyTf(getTimeframe())

/** "BTCUSDT, 15m" — the watermark TradingView prints behind the bars. */
function watermarkText(): string {
  if (!chartSettings().watermark) return ''
  return legendSymbol(state.symbol) + ', ' + tfLabel(getTimeframe())
}

/** Apply the chart settings (./chartSettings) over the theme's options. */
function applyChartSettings(): void {
  if (!chart) return
  const st = chartSettings()
  chart.applyOptions({
    grid: { vertLines: { visible: st.grid }, horzLines: { visible: st.grid } },
    crosshair: { mode: st.magnet ? 1 : 0 },
  })
  candleSeries?.applyOptions({ priceLineVisible: st.priceLine })
  syncWatermark()
  updateCloseTimer()
}
let watermarkShown = ''
function syncWatermark(): void {
  const text = watermarkText()
  if (text === watermarkShown) return
  watermarkShown = text
  syncTvWatermark(chart, text)
}
/** Ticker as TradingView prints it: BTCUSDT for a Binance pair, the base otherwise. */
export function legendSymbol(sym: string): string {
  const base = baseOf(sym)
  return venueOf(sym) === 'BINANCE SPOT' ? base + 'USDT' : base
}
/** Exchange name in TradingView's legend casing ("Binance", "Yahoo"). */
export function legendExchange(sym: string): string {
  return venueOf(sym) === 'BINANCE SPOT' ? 'Binance' : 'Yahoo'
}
/** Last-price label and line in the colour of the last bar's direction. */
function syncLastPrice(lc: Any): void {
  if (lc) tvLastPrice(candleSeries, lc.c >= lc.o)
}

/**
 * Re-colour a price series made by createPriceSeries for style `id`.
 * Only feed each series the options it actually has — a line series has no
 * wick colours, and unknown keys are silently ignored, hiding mistakes.
 */
export function themePriceSeries(series: Any, id: ChartStyleId): void {
  const th = chartTheme()
  if (BASIC_VIEWS[id]) {
    series.applyOptions(basicSeriesOptions(th, cv('primary')))
  } else if (CUSTOM_VIEWS[id]) {
    series.applyOptions({
      upColor: th.up,
      downColor: th.dn,
      wickColor: th.txt,
      textColor: th.txt,
      gridColor: isLightTheme() ? 'rgba(75,85,99,.3)' : 'rgba(143,160,181,.25)',
      priceLineColor: th.pline,
    })
  } else if (
    id === 'candle' ||
    id === 'hollow' ||
    id === 'range' ||
    id === 'heikin' ||
    id === 'linebreak'
  ) {
    series.applyOptions({
      upColor: id === 'hollow' ? 'rgba(0,0,0,0)' : th.up,
      downColor: id === 'hollow' ? 'rgba(0,0,0,0)' : th.dn,
      borderVisible: id === 'hollow',
      borderUpColor: th.up,
      borderDownColor: th.dn,
      wickUpColor: th.up,
      wickDownColor: th.dn,
      priceLineColor: th.pline,
    })
  } else if (id === 'renko') {
    series.applyOptions({ ...renkoSeriesOptions(), priceLineColor: th.pline })
  } else if (id === 'bar' || id === 'hlc') {
    series.applyOptions({ upColor: th.up, downColor: th.dn, priceLineColor: th.pline })
  } else {
    themeLineFamilySeries(series, id, lineFamilyColors())
  }
}
/** The palette the line-family styles (series/lineFamily) are drawn in. */
function lineFamilyColors(): LineFamilyColors {
  const th = chartTheme()
  return { primary: cv('primary'), up: th.up, dn: th.dn, neutral: th.txt, pline: th.pline }
}
export function mapCandle(c: Any): Any {
  return { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }
}

/**
 * Series data for style `id`: custom bars, OHLC, or a single closing value.
 * `prev` is the bar before `candles[0]`, which hollow candles (coloured by
 * the previous close) and the custom styles (sessions) need for a live bar.
 */
export function priceSeriesData(
  id: ChartStyleId,
  candles: CandleFlat[],
  prev?: CandleFlat | null,
): Any[] {
  const def = styleDef(id)
  // Heikin Ashi re-primes its memo here, so live ticks build on these bars.
  if (id === 'heikin') return heikinAshiOf(candles, true).map(mapCandle)
  if (def.custom) return toCandleData(candles, prev)
  if (id === 'hollow') {
    const th = chartTheme()
    return hollowCandleData(candles, th.up, th.dn, prev)
  }
  if (def.ohlc) return candles.map(mapCandle)
  return candles.map((c) => ({ time: Math.floor(c.t / 1000), value: c.c }))
}
/**
 * One bar of series data for style `id` — what series.update() takes.
 * `prev` is the bar before `c` (hollow candles and sessions need it). `src`
 * is the candle array `c` belongs to: Heikin Ashi needs the bars before it,
 * since each HA open is built from the previous HA bar.
 */
export function priceSeriesPoint(
  id: ChartStyleId,
  c: CandleFlat,
  prev?: CandleFlat | null,
  src?: CandleFlat[],
): Any {
  if (id === 'heikin') return mapCandle(heikinAshiBar(src || [c], c))
  return priceSeriesData(id, [c], prev)[0]
}
/** The bar before the one starting at `t` in `bars` (searched from the end). */
export function barBefore(bars: CandleFlat[], t: number): CandleFlat | null {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t < t) return bars[i]
  return null
}
/**
 * The bars the OHLC legend reports for style `id`: the candles themselves, or
 * on Heikin Ashi the HA bars actually drawn.
 */
export function legendCandles(id: ChartStyleId, candles: CandleFlat[]): CandleFlat[] {
  return id === 'heikin' ? heikinAshiOf(candles) : candles
}

/**
 * Add the price series for style `id` to chart `c`. The main chart and the
 * multi-chart companions share it, so a style looks the same in every cell.
 * `baseline` is the Baseline style's starting base price (see syncBaselineBase).
 */
export function createPriceSeries(c: Any, id: ChartStyleId, baseline = 0): Any {
  const th = chartTheme()
  const basic = BASIC_VIEWS[id]
  const custom = CUSTOM_VIEWS[id]
  if (basic) {
    // Columns and High-low (series/basicSeries).
    return c.addCustomSeries(basic(), {
      ...basicSeriesOptions(th, cv('primary')),
      priceLineStyle: 2,
    })
  } else if (custom) {
    // Our own pane renderer, drawing inside the chart's price scale.
    return c.addCustomSeries(custom(), {
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
    return c.addSeries(LightweightCharts.CandlestickSeries, {
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
  } else if (id === 'renko') {
    // Bricks: TradingView's renko colours, boxes with no wicks.
    return c.addSeries(LightweightCharts.CandlestickSeries, {
      ...renkoSeriesOptions(),
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'bar' || id === 'hlc') {
    // HLC bars are bars without the open tick.
    return c.addSeries(LightweightCharts.BarSeries, {
      upColor: th.up,
      downColor: th.dn,
      // TradingView's bars are thin OHLC ticks, not body-width blocks.
      thinBars: true,
      openVisible: id !== 'hlc',
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  }
  // Line, line with markers, step line, area, HLC area and baseline.
  const line = createLineFamilySeries(c, id, lineFamilyColors(), baseline)
  if (line) return line
  // Candles, Heikin Ashi (HA bars, see priceSeriesData), and range bars
  // (OHLC bars built off the clock).
  return c.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: th.up,
    downColor: th.dn,
    borderVisible: false,
    wickUpColor: th.up,
    wickDownColor: th.dn,
    priceLineColor: th.pline,
    priceLineStyle: 2,
  })
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
  const old = chartState.styleSeries
  chartState.styleSeries = null
  candleSeries = null

  // The new series goes in before the old one leaves, so the price pane is
  // never empty (see keepMainPane).
  const base = state.candles.length ? state.candles[0].c : 0
  candleSeries = createPriceSeries(chart, getChartStyle(), base)
  if (old) {
    stopBaselineBase(old)
    try {
      chart.removeSeries(old)
    } catch (e) {
      /* already detached */
    }
  }
  candleSeries.applyOptions({ priceLineVisible: chartSettings().priceLine })
  chartState.styleSeries = candleSeries
  priceSeriesSubs.forEach((f) => f(candleSeries))
}
export { renderWhaleBubbles } from './whaleBubbles'
/**
 * Give a price series the precision of the instrument it shows. Only re-applied
 * when the decimals change, so a live tick costs nothing.
 */
export function syncPricePrecision(series: Any, price: number | undefined): void {
  if (!series || price == null || !isFinite(price)) return
  const pf = priceFormatFor(price)
  if (series.__lrPrecision === pf.precision) return
  series.__lrPrecision = pf.precision
  series.applyOptions({ priceFormat: pf })
}
/** A value on the main chart, in at most the instrument's own price precision. */
function chartPrice(p: number): string {
  const last = state.candles[state.candles.length - 1]
  if (!last || !isFinite(p)) return pfmt(p)
  return fmt(p, Math.min(priceDecimals(p), priceDecimals(last.c)))
}
/**
 * A message over the plot with an optional Retry, for when there is nothing
 * to draw (load failed, rate limit, library missing). It used to be a line of
 * text in the small legend pill, easy to miss and with no way to act on it.
 */
export function showChartStatus(msg: string, retry?: () => void): void {
  const wrap = $('chartWrap')
  if (!wrap) return
  let el = $('chartStatus')
  if (!el) {
    el = document.createElement('div')
    el.id = 'chartStatus'
    el.className = 'chart-status'
    el.setAttribute('role', 'status')
    wrap.appendChild(el)
  }
  el.innerHTML = ''
  const p = document.createElement('p')
  p.textContent = msg
  el.appendChild(p)
  if (retry) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = 'Retry'
    b.addEventListener('click', () => {
      p.textContent = 'Retrying…'
      retry()
    })
    el.appendChild(b)
  }
}
export function hideChartStatus(): void {
  $('chartStatus')?.remove()
}

export function initChart(): void {
  if (!(window as Any).LightweightCharts) {
    $('legendOHLC')!.textContent = 'Chart library failed to load'
    showChartStatus('The chart library failed to load.', () => location.reload())
    return
  }
  const el = $('chart')!
  // TradingView's canvas: palette colours, fonts, dashed grey crosshair and a
  // faint symbol watermark (see ./chartPalette).
  const tv: Any = tvChartOptions(undefined, mainIsDaily)
  watermarkShown = '' // the watermark plugin is created by the first syncWatermark()
  chart = createZonedChart(LightweightCharts, el, mainIsDaily, {
    // autoSize lets the library watch the container itself. Passing explicit
    // width/height instead makes it write inline sizes onto the element, which
    // then override the CSS — that is what used to leave the chart stuck at
    // whatever height the side panel had stretched it to.
    autoSize: true,
    ...tv,
    timeScale: {
      ...tv.timeScale,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 10,
      barSpacing: 7,
    },
    // Normal (free) crosshair, as before; magnet snapping is the drawing tools'.
    crosshair: { ...tv.crosshair, mode: 0 },
    localization: {
      ...tv.localization,
      // Never more decimals than the instrument's own price: per-label
      // decimals printed "0.00000000" where a BTC axis crosses zero and
      // switched from 4 to 5 decimals as a coin's ticks crossed 1.00.
      priceFormatter: chartPrice,
    },
  } as Any)
  applyChartStyle()
  attachIndicatorChart(chart)
  attachDeltaPane(chart)
  attachWhaleBubbles(chart, candleSeries, $('chartWrap')!)
  attachVolumeProfile(chart, candleSeries, $('chartWrap')!)
  // Compare lines (./compare); their rows ride in the OHLC legend.
  attachCompare(chart, () => hoverTime == null && renderLiveLegend(), $('legendOHLC'))
  // The countdown reads the live series each time, so a style change that
  // replaces the series does not strand it.
  // Range bars do not close on the clock, so there is nothing to count down.
  mountCloseTimer(chart, () => (isRangeMode() ? null : candleSeries))
  // Price-scale modes, zoom/scroll buttons and the date-range bar (scaleNav).
  attachScaleNav({ chart, el, getSeries: () => candleSeries, onSeriesChange: onPriceSeriesChange })
  followPriceScale(el)
  // While the cursor is over a bar the legend shows that bar; live ticks must
  // not overwrite it, and leaving the chart hands it back to the live candle.
  chart.subscribeCrosshairMove((param: Any) => {
    hoverLegend(param.time && param.point ? param.time : null)
    // Dragging the price axis rescales without moving the time range.
    updateCloseTimer()
  })
  keepMainPane(chart)
  // Crosshair sync with the layout's other cells (./crosshairSync); a synced
  // crosshair drives the legend too.
  registerCrosshairSync({
    chart,
    series: () => candleSeries,
    bars: () => legendCandles(getChartStyle(), displayCandles()),
    onSync: hoverLegend,
  })
  // Time-range sync with the cells in its link group (./linkGroups). The
  // date-range buttons under the chart move it too.
  const wrapForLink = $('chartWrap')
  mainTimeLink = registerTimeSync({
    scope: 'layout',
    key: mainLinkKey,
    chart,
    owns: (t) => !!(wrapForLink?.contains(t) || t.closest('.sn-bar')),
    times: () => displayCandles().map((c) => Math.floor(c.t / 1000)),
    syncable: () => !isRangeMode(),
    primary: true,
  })
  // The bar countdown hangs under the last-price label; moving the view moves
  // that label, so the countdown follows at once instead of on its 1s tick.
  chart.timeScale().subscribeVisibleTimeRangeChange(function () {
    redrawDrawings()
    updateCloseTimer()
  })
  // The chart resizes itself; these only need to follow it. One exception:
  // the chart is built at startup while the Home screen is showing, so its
  // first fit happens at zero width and leaves the candles crammed into the
  // right half once a chart tab opens. Re-fit the first time it has a width.
  let fitW = el.clientWidth
  const wrapEl = $('chartWrap')
  new ResizeObserver(() => {
    if (fitW < 60 && el.clientWidth >= 60 && state.candles.length)
      openingView(chart.timeScale(), displayCandles().length)
    fitW = el.clientWidth
    // Size classes for the legend and whale box: in a 4-16 cell layout the
    // full OHLC legend wrapped to three lines over the candles (index.css).
    if (wrapEl && fitW > 0) {
      wrapEl.classList.toggle('cw-narrow', fitW < 480)
      wrapEl.classList.toggle('cw-tiny', fitW < 260)
    }
    redrawDrawings()
    updateCloseTimer()
  }).observe(el)
  setupDrawLayer()
  applyChartSettings()
  subscribeChartSettings(applyChartSettings)
  // Pine scripts run in a worker: draw each result as it arrives.
  onPineResult(() => (isReplayOn() ? updateChartData(false) : scheduleIndicatorRefresh()))
  wireLegendActions()
  initChartToolbar()
  initFullScreen()
  // Adding, editing or replaying an indicator redraws through the same path as
  // a fresh data load, so there is one place where series are built.
  onIndicatorsChange(() => updateChartData(false))
  onReplayChange((modeChanged: boolean) => updateChartData(modeChanged))
  // A new coin empties state.candles before its bars load; clear the chart with it.
  subscribeSymbol(() => updateChartData(true))
  // Which derived bars are on screen ('' for time candles): range ↔ renko
  // rebuilds the bars as surely as leaving them does.
  const derivedKind = (): string => (isRangeMode() ? getChartStyle() : '')
  let wasRange = derivedKind()
  onChartStyleChange(() => {
    // Same bars, drawn differently — keep whatever the user has zoomed or
    // panned to instead of snapping back to the newest candle. The range is
    // read before the series is swapped, because removing the only price
    // series can reset the time scale on its own. Into or out of range bars
    // the bars themselves change, so that view is refitted instead.
    const ts = chart.timeScale()
    const keep = ts.getVisibleLogicalRange()
    // Between two non-time styles (range bars → Kagi, say) the bars change too.
    const refit = wasRange !== derivedKind()
    wasRange = derivedKind()
    applyChartStyle()
    attachWhaleBubbles(chart, candleSeries, $('chartWrap')!)
    attachVolumeProfile(chart, candleSeries, $('chartWrap')!)
    updateChartData(refit)
    if (!keep || refit) return
    ts.setVisibleLogicalRange(keep)
    requestAnimationFrame(() => {
      const now = ts.getVisibleLogicalRange()
      if (now && Math.abs(now.to - keep.to) > 0.5) ts.setVisibleLogicalRange(keep)
    })
  })
  // A new range size rebuilds every bar: a new dataset, so refit.
  onRangeSettingsChange(() => updateChartData(true))
  // Same for the Line break / Kagi / Point & Figure settings, on those styles.
  subscribeReversalSettings(() => {
    if (isRangeMode()) updateChartData(true)
  })
  watchForOlderHistory()
  anchorWheelZoomToLiveEdge()
  // Delta bars stream in far faster than the chart should repaint — coalesce
  // to the next frame, same reasoning as the live-tick indicator refresh
  // below (IND_REFRESH_MS): the eye cannot read faster than that anyway.
  let deltaPending = false
  onDeltaChange(() => {
    if (deltaPending) return
    deltaPending = true
    requestAnimationFrame(() => {
      deltaPending = false
      updateDeltaLast(timeOnlyCandles(), indicatorPaneCount())
    })
  })
  onOverlayTogglesChange(() => {
    renderDeltaPane(timeOnlyCandles(), indicatorPaneCount())
    renderWhaleBubbles()
    renderVolumeProfile(visibleCandles())
  })
  watchLiveWhales()
  updateChartData(true)
}
/**
 * The overlays drawn on our own canvases (drawings, volume profile, whale
 * bubbles, the bar countdown) map prices to pixels themselves. The library
 * reports time-scale moves but not price-scale ones, so dragging the price
 * axis or switching log / % / auto left them at their old height until the
 * next live tick. Follow those too: during a drag and after a scale change,
 * two frames on, once the library has repainted with the new range.
 */
let overlayFrame = 0
function redrawOverlaysSoon(): void {
  if (overlayFrame) return
  overlayFrame = requestAnimationFrame(() => {
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0
      redrawDrawings()
      updateCloseTimer()
    })
  })
}
function followPriceScale(el: HTMLElement): void {
  el.addEventListener('pointermove', (e) => {
    if (e.buttons) redrawOverlaysSoon()
  })
  el.addEventListener('pointerup', redrawOverlaysSoon)
  el.addEventListener('dblclick', redrawOverlaysSoon)
  el.addEventListener('touchmove', redrawOverlaysSoon, { passive: true })
  subscribeScaleNav(redrawOverlaysSoon)
}
/** Bar time (seconds) under the crosshair, or null when the cursor is off the chart. */
let hoverTime: number | null = null
/** The legend for the bar at `time` (seconds), or the live bar when null / no bar there. */
function hoverLegend(time: Any): void {
  // Heikin Ashi: the legend reads the HA bars, as drawn.
  const shown = time ? legendCandles(getChartStyle(), displayCandles()) : null
  const i = shown ? shown.findIndex((c) => Math.floor(c.t / 1000) === time) : -1
  const cp = shown && i >= 0 ? shown[i] : null
  if (!shown || !cp) {
    if (hoverTime != null) {
      hoverTime = null
      hoverIndex = null
      refreshIndicatorLegend()
      renderLiveLegend()
    }
    return
  }
  hoverTime = time as number
  // The indicator values follow the crosshair too, as on TradingView (read
  // from the cached computation, so hovering costs no recompute).
  if (hoverIndex !== i) {
    hoverIndex = i
    refreshIndicatorLegend()
  }
  renderLegend(cp.o, cp.h, cp.l, cp.c, cp.v, true, shown[i - 1]?.c)
}
function renderLiveLegend(): void {
  const candles = legendCandles(getChartStyle(), displayCandles())
  const lc = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  if (lc) renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, prev?.c)
}
/**
 * The change in the price's own precision, as TradingView prints it: pfmt
 * picks decimals from the magnitude, so on BTC a +66.66 move read "+66.6600"
 * and no move at all "+0.00000000".
 */
const fmtChg = (d: number, ref: number): string =>
  (d >= 0 ? '+' : '\u2212') + fmt(Math.abs(d), priceDecimals(ref))
/**
 * The TradingView legend: "BTCUSDT · 15m · Binance", then O H L C in the
 * bar's direction colour and the change from the previous close — for the
 * bar under the crosshair, else the live one. Indicator lines follow below.
 */
function renderLegend(
  o: Any,
  h: Any,
  l: Any,
  c: Any,
  v: Any,
  isCross: Any,
  prevClose?: number,
): void {
  if (!isFinite(o)) return
  const pal = chartPalette()
  const col = c >= o ? pal.up : pal.dn
  // Change against the previous close, as TradingView reports it; the first
  // loaded bar has none, so it falls back to its own open.
  const ref = prevClose != null && isFinite(prevClose) && prevClose > 0 ? prevClose : o
  const d = c - ref
  const pct = ref ? (d / ref) * 100 : 0
  const val = (k: string, x: Any) =>
    '<span class="leg-k">' + k + '</span><b style="color:' + col + '">' + pfmt(x) + '</b>'
  const html =
    '<div class="leg-main' +
    (isCross ? ' leg-cross' : '') +
    '"><span class="leg-sym">' +
    legendSymbol(state.symbol) +
    '<i>\u00b7</i>' +
    tfLabel(getTimeframe()) +
    '<i>\u00b7</i>' +
    legendExchange(state.symbol) +
    '</span><span class="leg-ohlc">' +
    val('O', o) +
    val('H', h) +
    val('L', l) +
    val('C', c) +
    '<b style="color:' +
    col +
    '">' +
    fmtChg(d, ref) +
    ' (' +
    (pct >= 0 ? '+' : '\u2212') +
    Math.abs(pct).toFixed(2) +
    '%)</b>' +
    (v != null ? '<span class="leg-k">Vol</span><b>' + nfmt(v) + '</b>' : '') +
    '</span></div>' +
    indicatorLegendHtml() +
    compareLegendHtml()
  // The crosshair and every trade print land here; most of the time nothing
  // in the legend changed (same bar, same price). Rewriting it anyway rebuilt
  // the DOM and forced a layout for the overlays read straight after.
  const el = $('legendOHLC')!
  if (legendHtml === html && legendNode && el.firstChild === legendNode) return
  el.innerHTML = html
  legendHtml = html
  legendNode = el.firstChild
}
/**
 * What renderLegend last wrote, and the node it made. Other writers (the load
 * error messages) replace that node, which is how a stale cache is noticed.
 */
let legendHtml = ''
let legendNode: ChildNode | null = null

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
/** Index of the bar under the crosshair, or null on the live bar. */
let hoverIndex: number | null = null
export function refreshIndicatorLegend(): void {
  indLegendHtml = buildIndicatorLegend(hoverIndex ?? undefined)
}
function indicatorLegendHtml(): string {
  return indLegendHtml
}
const EYE_ON =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 4 20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
const REMOVE =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
function buildIndicatorLegend(at?: number): string {
  const rows = indicatorLegend(displayCandles(), at)
  // Indicators in a pane of their own get their values in that pane, as on
  // TradingView; only the price pane's overlays stay in the main legend.
  const byPane = new Map<number, typeof rows>()
  const main: typeof rows = []
  rows.forEach((r) => {
    const pane = r.hidden ? 0 : indicatorPaneOf(r.uid)
    if (!pane) main.push(r)
    else byPane.set(pane, [...(byPane.get(pane) || []), r])
  })
  renderPaneLegends(byPane)
  if (!main.length) return ''
  return legendRowsHtml(main)
}
/** Legends at the top-left of each indicator pane (lightweight-charts v5 panes). */
let paneLegendHtml = ''
function renderPaneLegends(byPane: Map<number, Parameters<typeof legendRowsHtml>[0]>): void {
  const wrap = $('chartWrap')
  if (!wrap) return
  let box = $('paneLegends')
  if (!box) {
    box = document.createElement('div')
    box.id = 'paneLegends'
    box.className = 'pane-legends'
    wrap.appendChild(box)
    wireLegendActions(box)
  }
  const html = [...byPane.entries()]
    .map(([pane, rows]) => '<div class="legend pane-legend" data-pane="' + pane + '">' + legendRowsHtml(rows) + '</div>')
    .join('')
  if (html !== paneLegendHtml) {
    box.innerHTML = html
    paneLegendHtml = html
  }
  placePaneLegends()
}
/** Keep each pane legend at its pane's top edge (panes are resized by drag). */
function placePaneLegends(): void {
  const box = $('paneLegends')
  if (!box || !chart) return
  let tops: number[] = []
  try {
    let y = 0
    tops = chart.panes().map((p: Any) => {
      const top = y
      y += p.getHeight() + 1
      return top
    })
  } catch {
    return
  }
  box.querySelectorAll<HTMLElement>('.pane-legend').forEach((el) => {
    const top = tops.at(Number(el.dataset.pane))
    el.style.display = top == null ? 'none' : ''
    if (top != null) el.style.top = top + 4 + 'px'
  })
}
function legendRowsHtml(rows: ReturnType<typeof indicatorLegend>): string {
  return rows
    .map(
      (r) =>
        '<div class="leg-ind' +
        (r.hidden ? ' off' : '') +
        '"><i>' +
        r.label +
        '</i>' +
        r.parts
          .map(
            (p) =>
              '<b style="color:' +
              p.color +
              '">' +
              (p.big ? nfmt(p.value) : chartPrice(p.value)) +
              '</b>',
          )
          .join('') +
        '<span class="leg-act"><button type="button" data-act="eye" data-uid="' +
        r.uid +
        '" title="' +
        (r.hidden ? 'Show' : 'Hide') +
        '" aria-pressed="' +
        !r.hidden +
        '">' +
        (r.hidden ? EYE_OFF : EYE_ON) +
        '</button><button type="button" data-act="rm" data-uid="' +
        r.uid +
        '" title="Remove">' +
        REMOVE +
        '</button></span></div>',
    )
    .join('')
}
/** The legend's eye and remove buttons drive the indicator store. */
function wireLegendActions(el: HTMLElement | null = $('legendOHLC')): void {
  if (!el) return
  el.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-act]') as HTMLElement | null
    const uid = btn?.dataset.uid
    if (!btn || !uid) return
    e.stopPropagation()
    if (btn.dataset.act === 'eye') toggleIndicator(uid)
    else removeIndicator(uid)
  })
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
/**
 * A new chart time zone. lightweight-charts keeps a bar's tick weight while
 * its time is unchanged, so after a zone change the day labels stayed on the
 * old zone's midnight. Empty every series so the weights are recomputed, then
 * redraw the same bars and keep the view.
 */
export function reweightTimeScale(): void {
  if (!chart || !candleSeries) return
  const ts = chart.timeScale()
  const keep = ts.getVisibleLogicalRange()
  candleSeries.setData([])
  blankIndicators()
  blankDeltaPane()
  updateChartData(false)
  if (keep) ts.setVisibleLogicalRange(keep)
}

/** The symbol + interval last drawn, to tell a new dataset from a reload of it. */
let drawnKey = ''
/**
 * Whether freshly loaded candles are a different market or interval from what
 * is on screen. A retry or a gap refill reloads the same series and must keep
 * the user's zoom; only a genuinely new dataset is refitted.
 */
export function isNewDataset(): boolean {
  return !state.candlesKey || state.candlesKey !== drawnKey
}

/**
 * A fresh dataset opens on the latest ~120 bars at a readable width, with the
 * live edge's usual offset — as TradingView does — instead of fitting all
 * 500+ bars into a few pixels each. Short series are still fitted whole.
 */
const OPENING_BARS = 120
function openingView(ts: Any, n: number): void {
  if (n <= OPENING_BARS * 1.25) {
    ts.fitContent()
    return
  }
  ts.setVisibleLogicalRange({ from: n - OPENING_BARS, to: n - 1 + LIVE_EDGE_OFFSET })
}

export function updateChartData(fit = false): void {
  if (!chart) return
  const candles = displayCandles()
  // A new dataset (fit) must not share the time scale with the old one, even
  // for a moment: lightweight-charts 4.1 misplaces the new bars when, say, 1h
  // candles land beside a 15m indicator or delta series — the bars render as a
  // weeks-long gap, then "Value is null" errors blank the plot. So empty the
  // series that follow the candles first; they are redrawn just below.
  if (fit || !candles.length) {
    blankIndicators()
    blankDeltaPane()
  }
  // Symbol or interval changed and the new bars are still loading: clear the
  // previous market rather than leave it under the new title.
  if (!candles.length) {
    candleSeries.setData([])
    chartState.firstBarTime = undefined
    syncWatermark()
    return
  }
  hideChartStatus()
  const ts = chart.timeScale()
  syncSecondsVisible()
  const keep = fit ? null : ts.getVisibleLogicalRange()
  const prevFirst = chartState.firstBarTime as number | undefined
  candleSeries.setData(priceSeriesData(getChartStyle(), candles))
  syncPricePrecision(candleSeries, candles[candles.length - 1].c)
  if (getChartStyle() === 'baseline') syncBaselineBase(chart, candleSeries, displayCandles)
  rangeShown = isRangeMode() ? candles : []
  renderIndicators(candles)
  renderDeltaPane(timeOnlyCandles(), indicatorPaneCount())
  // Panes may have come or gone: the overlays above the time axis re-measure.
  requestAnimationFrame(syncScaleNavView)
  renderWhaleBubbles()
  drawnKey = state.candlesKey || ''
  setPineChart(state.symbol, getTimeframe())
  if (fit) {
    // A fresh fit starts at bar 0 like a pan to the oldest bar would; history
    // paging must wait for this dataset's own first pan, not a past one.
    userMovedChart = false
    openingView(ts, candles.length)
    afterChartFit()
    // A new market or interval here leads its link group's time range; the
    // view settles first (see the range re-claim below).
    requestAnimationFrame(() => mainTimeLink?.publish())
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
  // Heikin Ashi: both the bar and the close it is compared with are HA bars,
  // as in renderLiveLegend — the raw previous close gave a different change.
  const lcs = legendCandles(getChartStyle(), candles)
  const lc = lcs[lcs.length - 1]
  refreshIndicatorLegend()
  if (hoverTime == null)
    renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, lcs[lcs.length - 2]?.c)
  syncLastPrice(lc)
  syncWatermark()
  redrawDrawings()
  updateCloseTimer()
}

/**
 * How many bars were prepended since the last draw. Range bars rebuilt from a
 * longer history need not reproduce the old first bar exactly, so this counts
 * up to the first bar at or after it.
 */
function countPrepended(prevFirst: number | undefined, candles: Any[]): number {
  if (prevFirst == null || !candles.length || candles[0].t >= prevFirst) return 0
  const i = candles.findIndex((c) => c.t >= prevFirst)
  return i > 0 ? i : 0
}

/** Seconds on the time axis for sub-minute intervals and for range bars. */
let secondsShown = false
function syncSecondsVisible(): void {
  const want = isRangeMode() || tfDef(state.tf).base === '1s'
  if (want === secondsShown) return
  secondsShown = want
  chart.applyOptions({ timeScale: { secondsVisible: want } })
}

/** The range bars last handed to the price series. */
let rangeShown: Any[] = []
const sameBar = (a: Any, b: Any): boolean =>
  a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c

/**
 * A live tick on range bars. The tick can extend the last bar, close it and
 * open new ones, or — when the live candle flips direction and its walk
 * changes — rebuild bars it produced earlier. series.update() can only touch
 * the last bar or append, so anything deeper is a setData with the viewport
 * kept where it was.
 */
function pushRangeLive(): void {
  const next = displayCandles()
  if (!next.length) return
  const prev = rangeShown
  let k = Math.max(0, prev.length - 64)
  while (k < prev.length && k < next.length && sameBar(prev[k], next[k])) k++
  const tailOnly =
    prev.length > 0 &&
    next.length >= prev.length &&
    k >= prev.length - 1 &&
    (k === prev.length || next[k].t === prev[k].t)
  if (tailOnly) {
    for (let i = Math.max(k, prev.length - 1); i < next.length; i++)
      candleSeries.update(priceSeriesPoint(getChartStyle(), next[i]))
  } else {
    const ts = chart.timeScale()
    const keep = ts.getVisibleLogicalRange()
    candleSeries.setData(priceSeriesData(getChartStyle(), next))
    if (keep) ts.setVisibleLogicalRange(keep)
  }
  rangeShown = next
}

// ---- Wheel zoom keeps the live edge, as on TradingView ----
// lightweight-charts zooms around the cursor, so zooming out while looking at
// the newest bars opened a wide empty stretch of future on the right. When
// the latest bar was in view, the zoom is re-anchored to it (same width, the
// usual right offset); scrolled back into history, the cursor zoom stays.
// A few bars of breathing room past the live bar. Ten (the scroll offset) left
// a wide empty band in a small layout cell, where hovering found no bar.
const LIVE_EDGE_OFFSET = 4
function anchorWheelZoomToLiveEdge(): void {
  const el = $('chart')
  if (!el) return
  let wasLive = false
  el.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const r = chart.timeScale().getVisibleLogicalRange()
      const last = displayCandles().length - 1
      wasLive = !!r && last >= 0 && r.to >= last
      if (!wasLive) return
      requestAnimationFrame(() => {
        const n = chart.timeScale().getVisibleLogicalRange()
        if (!n) return
        const width = n.to - n.from
        const to = last + LIVE_EDGE_OFFSET
        if (Math.abs(n.to - to) > 0.5) chart.timeScale().setVisibleLogicalRange({ from: to - width, to })
      })
    },
    { passive: true, capture: true },
  )
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
  if (isRangeMode()) {
    pushRangeLive()
    const lb = rangeShown[rangeShown.length - 1]
    if (lb) c = lb
  } else {
    const shown = displayCandles()
    candleSeries.update(priceSeriesPoint(getChartStyle(), c, barBefore(shown, c.t), shown))
    // A coin crossing a decimal threshold (1.00, 0.01…) gets its new precision
    // now, not at the next full redraw. Cheap: re-applied only on a change.
    syncPricePrecision(candleSeries, c.c)
    // Heikin Ashi: the legend reports the HA bar just drawn (memoised, so cheap).
    if (getChartStyle() === 'heikin') c = heikinAshiBar(shown, c)
    if (getChartStyle() === 'baseline') syncBaselineBase(chart, candleSeries, displayCandles)
  }
  // The candle follows the tape frame by frame, but indicators and the legend
  // are recomputed over the whole series — far too much work to repeat on every
  // trade print, and nothing the eye could read that fast anyway.
  // Hovering an older bar keeps its values; hovering the live one follows it.
  // Previous close for the change readout: the bar before the live one.
  // On Heikin Ashi `c` is the HA bar, so its previous close must be the HA one.
  const arr: Any[] = isRangeMode() ? rangeShown : legendCandles(getChartStyle(), state.candles)
  const at = arr.length - 1
  const prevBar = at >= 0 && arr[at].t === c.t ? arr[at - 1] : arr[at]
  if (hoverTime == null || hoverTime === Math.floor(c.t / 1000))
    renderLegend(c.o, c.h, c.l, c.c, c.v, hoverTime != null, prevBar?.c)
  syncLastPrice(c)
  scheduleIndicatorRefresh()
  scheduleDrawRedraw()
}

/**
 * Recompute indicators at most every IND_REFRESH_MS. A tick inside that window
 * schedules the refresh for when it ends rather than being dropped, so on a
 * quiet coin the indicators and legend catch up with the last trade instead of
 * waiting for the next one.
 */
function scheduleIndicatorRefresh(): void {
  if (indPending) return
  indPending = true
  const wait = Math.max(0, IND_REFRESH_MS - (Date.now() - indLast))
  setTimeout(() => {
    requestAnimationFrame(() => {
      indPending = false
      indLast = Date.now()
      if (!isReplayOn()) {
        const shown = displayCandles()
        renderIndicators(shown)
        updateDeltaLast(timeOnlyCandles(), indicatorPaneCount())
        refreshIndicatorLegend()
        const lcs = legendCandles(getChartStyle(), shown)
        const lc = lcs[lcs.length - 1]
        if (lc && hoverTime == null)
          renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, lcs[lcs.length - 2]?.c)
      }
      updateCloseTimer()
    })
  }, wait)
}

/**
 * Live ticks repaint the drawings at most once per frame: a busy tape could
 * redraw every drawing (and the volume profile and whale bubbles with them)
 * dozens of times between two frames.
 */
let drawRedrawPending = false
function scheduleDrawRedraw(): void {
  if (drawRedrawPending) return
  drawRedrawPending = true
  requestAnimationFrame(() => {
    drawRedrawPending = false
    redrawDrawings()
  })
}
// ---- Toolbar wiring ----

function initChartToolbar(): void {
  // Drawing tools live in their own dropdown now; the chart only reacts to
  // what that store says is armed.
  onDrawToolChange(function () {
    chartState.drawBuf = []
    chartState._preview = null
    chartState._eraseHit = -1
    chartState._sel = -1
    updateDrawHit()
    syncDrawHint()
    redrawDrawings()
  })
  onClearAllDrawings(function () {
    currentDrawings()
    chartState.drawings = []
    chartState.drawBuf = []
    chartState._eraseHit = -1
    chartState._sel = -1
    saveDrawings()
    publishDrawingCount()
    redrawDrawings()
    showToast('Drawings cleared — Ctrl+Z to undo')
  })
  // A drawing still being placed is cancelled first; after that, undo steps
  // back through every saved change (add, delete, move, clear all).
  onUndoDrawing(function () {
    currentDrawings()
    // An arrow-key nudge still settling is committed first, so undo takes
    // back the whole burst rather than whatever came before it.
    flushNudge()
    if (chartState.drawBuf.length) {
      chartState.drawBuf = []
      publishDrawingCount()
      redrawDrawings()
      return
    }
    restoreDrawings(drawHistory.undo())
  })
  onRedoDrawing(function () {
    currentDrawings()
    flushNudge()
    restoreDrawings(drawHistory.redo())
  })
  // The floating toolbar over a selected drawing: restyle it or delete it.
  onEditSelectedDrawing(function (patch) {
    const d = currentDrawings()[chartState._sel]
    if (!d) return
    Object.assign(d, patch)
    // A hidden drawing cannot be clicked, so it cannot stay selected either.
    if (d.hidden) chartState._sel = -1
    saveDrawings()
    redrawDrawings()
  })
  onDrawingCommand(runDrawingCommand)
  onDeleteSelectedDrawing(function () {
    const list = currentDrawings()
    if (chartState._sel < 0 || !list[chartState._sel]) return
    list.splice(chartState._sel, 1)
    chartState._sel = -1
    saveDrawings()
    publishDrawingCount()
    redrawDrawings()
  })
  syncDrawHint()
}

// ---- Saved drawings, one set per coin ----
// Every drawing is anchored in time + price (see snapToCandle), so it stays
// valid across timeframes of the same coin but means nothing on another one.
// The set on screen follows state.symbol lazily: whatever touches the drawings
// goes through currentDrawings(), which swaps sets the moment the coin changes.
const DRAWINGS_KEY = 'lr-drawings-v1'
const DRAWINGS_MAX_COINS = 50
const DRAWINGS_MAX_PER_COIN = 200
let drawingsSym: string | null = null

function validDrawing(d: Any): boolean {
  return !!d && typeof d.type === 'string' && Array.isArray(d.points)
}

function currentDrawings(): Any[] {
  const sym = String(state.symbol || '')
  if (sym !== drawingsSym) {
    // Save the previous coin's pending nudge under that coin, before the swap.
    flushNudge()
    drawingsSym = sym
    const all = storageGet<Record<string, Any[]>>(DRAWINGS_KEY, {})
    const list = all && Array.isArray(all[sym]) ? all[sym] : []
    chartState.drawings = list.filter(validDrawing)
    chartState.drawBuf = []
    chartState._preview = null
    chartState._eraseHit = -1
    chartState._sel = -1
    chartState._drag = null
    chartState._freehand = null
    chartState._freeXY = null
    chartState._captionDraft = null
    closeLabelInput()
    drawHistory.reset(snapshotDrawings())
    publishHistory()
    publishDrawingCount()
  }
  return chartState.drawings
}

/** Undo / redo over every saved change to the current coin's drawings. */
const drawHistory = createDrawingHistory()
const snapshotDrawings = (): string => JSON.stringify(chartState.drawings)
function publishHistory(): void {
  setDrawingHistory(drawHistory.canUndo(), drawHistory.canRedo())
}
/** Put back a snapshot from the history and persist it (not as a new step). */
function restoreDrawings(snap: string | null): void {
  if (snap == null) return
  chartState.drawings = JSON.parse(snap)
  chartState.drawBuf = []
  chartState._eraseHit = -1
  chartState._sel = -1
  writeDrawings()
  publishDrawingCount()
  publishHistory()
  redrawDrawings()
}

/** Write the current coin's set back and record it as an undo step. */
function saveDrawings(): void {
  if (drawingsSym == null) return
  if (drawHistory.commit(snapshotDrawings())) publishHistory()
  writeDrawings()
}

/** Persist the current coin's set; the most recently edited coins are kept. */
function writeDrawings(): void {
  if (drawingsSym == null) return
  const stored = storageGet<Record<string, Any[]>>(DRAWINGS_KEY, {})
  const all: Record<string, Any[]> = stored && typeof stored === 'object' ? stored : {}
  delete all[drawingsSym]
  if (chartState.drawings.length) all[drawingsSym] = chartState.drawings.slice(-DRAWINGS_MAX_PER_COIN)
  const keys = Object.keys(all)
  keys.slice(0, Math.max(0, keys.length - DRAWINGS_MAX_COINS)).forEach((k) => delete all[k])
  storageSet(DRAWINGS_KEY, all)
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

/** The selection toolbar's and the object tree's requests (see DrawingCommand). */
function runDrawingCommand(cmd: DrawingCommand): void {
  const list = currentDrawings()
  flushNudge()
  const sel = chartState._sel
  switch (cmd.kind) {
    case 'select': {
      const d = list[cmd.i]
      if (!d) return
      // Selecting from the object tree shows a hidden drawing again: a
      // selection nobody can see would be useless.
      if (d.hidden) {
        delete d.hidden
        saveDrawings()
      }
      if (getDrawTool()) setDrawTool(null)
      chartState._sel = cmd.i
      break
    }
    case 'toggle': {
      const i = cmd.i ?? sel
      const d = list[i]
      if (!d) return
      if (d[cmd.flag]) delete d[cmd.flag]
      else d[cmd.flag] = true
      if (cmd.flag === 'hidden' && d.hidden && i === sel) chartState._sel = -1
      saveDrawings()
      break
    }
    case 'delete': {
      if (!list[cmd.i]) return
      list.splice(cmd.i, 1)
      if (sel === cmd.i) chartState._sel = -1
      else if (sel > cmd.i) chartState._sel = sel - 1
      saveDrawings()
      publishDrawingCount()
      break
    }
    case 'clone': {
      const d = list[sel]
      if (!d) return
      if (list.length >= DRAWINGS_MAX_PER_COIN) {
        showToast('This coin already has ' + DRAWINGS_MAX_PER_COIN + ' drawings — delete some to add more')
        return
      }
      // Cloned in place and selected, as on TradingView: drag it off the original.
      list.push(cloneDrawing(d))
      chartState._sel = list.length - 1
      saveDrawings()
      publishDrawingCount()
      showToast('Drawing cloned — drag to move it')
      break
    }
    case 'order': {
      if (!list[sel]) return
      chartState._sel = reorder(list, sel, cmd.to)
      saveDrawings()
      break
    }
    case 'editText':
      editDrawingText(sel)
      return
  }
  redrawDrawings()
}

/** Re-open the caption field over a placed text / callout / note drawing. */
function editDrawingText(i: number): void {
  const d = currentDrawings()[i]
  const def = d && drawToolDef(d.type)
  if (!d || !def?.text || d.locked) return
  const [cw, ch] = drawCanvasSize()
  const sh = shapeOf(d, cw, ch)
  const l = sh?.labels.find((lb) => lb.box)
  if (!l) return
  const sym = drawingsSym
  askCaption(
    l.x,
    l.y,
    function (caption) {
      // Same coin and the same drawing still there (not undone meanwhile).
      if (caption == null || sym !== drawingsSym || currentDrawings()[i] !== d) return
      if (caption === d.text) return
      d.text = caption
      saveDrawings()
      redrawDrawings()
    },
    d.text || '',
  )
}

/**
 * Arrow keys nudge the selected drawing: left / right a bar, up / down a
 * pixel (Shift: 10). The moves are written straight away but recorded as one
 * undo step once the keys go quiet, so a burst of nudges undoes in one go.
 */
const NUDGE_SETTLE_MS = 600
let nudgeTimer: ReturnType<typeof setTimeout> | null = null
function flushNudge(): void {
  if (!nudgeTimer) return
  clearTimeout(nudgeTimer)
  nudgeTimer = null
  saveDrawings()
}
function nudgeSelected(key: string, big: boolean): boolean {
  const d = chartState.drawings[chartState._sel]
  if (!d || d.locked || !chart || !candleSeries) return false
  const step = big ? 10 : 1
  const dBars = key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0
  const dy = key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0
  d.points = shiftPoints(d.points, dBars, shownBarTimes(), (pr) => {
    if (!dy) return pr
    const py = candleSeries.priceToCoordinate(pr)
    return py == null ? null : candleSeries.coordinateToPrice(py + dy)
  })
  writeDrawings()
  if (nudgeTimer) clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(function () {
    nudgeTimer = null
    saveDrawings()
  }, NUDGE_SETTLE_MS)
  redrawDrawings()
  return true
}

/**
 * Leave the tool after a drawing lands unless "stay in drawing mode" is on,
 * and select the new drawing so it can be styled straight away.
 */
function afterDrawingPlaced(): void {
  if (stayInDrawingMode() || !getDrawTool()) return
  setDrawTool(null)
  chartState._sel = chartState.drawings.length - 1
  redrawDrawings()
}

/** A new drawing of `type`, styled from its saved template if there is one. */
function newDrawing(type: string, color: string, points: Any[]): Any {
  const d: Any = { type, color, points }
  const t = toolTemplate(type)
  if (t) {
    if (t.color) d.color = t.color
    if (t.width) d.width = t.width
    if (t.dash) d.dash = t.dash
    if (t.fontSize) d.fontSize = t.fontSize
  }
  return d
}

// ---- Full screen ----
// Two layers. The `radar-fs` class pins the chart card over the whole
// viewport (every browser). On top of that the Fullscreen API asks the
// browser to drop its own chrome — address bar, tab strip, and on a phone the
// status bar and system navigation too. iPhone Safari has no element
// fullscreen, so there the class alone does the work.
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

function nativeFsElement(): Element | null {
  const d = document as FsDoc
  return d.fullscreenElement || d.webkitFullscreenElement || null
}

function enterNativeFs(): void {
  const el = document.documentElement as FsEl
  try {
    const p = el.requestFullscreen
      ? el.requestFullscreen({ navigationUI: 'hide' })
      : el.webkitRequestFullscreen?.()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch {
    /* refused (not a user gesture, iframe without allowfullscreen) — the CSS layer still applies */
  }
}

function exitNativeFs(): void {
  if (!nativeFsElement()) return
  const d = document as FsDoc
  try {
    const p = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()
    if (p && typeof p.catch === 'function') p.catch(function () {})
  } catch {
    /* already out */
  }
}

function applyFsState(fs: boolean): void {
  document.documentElement.classList.toggle('radar-fs', fs)
  const btn = $('fsBtn')
  if (btn) {
    // The icon is drawn in CSS (a mask that follows html.radar-fs); the label
    // is the same styled tooltip as the toolbar's other buttons, not a native
    // title that looked different.
    const label = fs ? 'Exit full screen' : 'Full screen'
    btn.innerHTML = '<span class="tvb-tip">' + label + ' <kbd>F</kbd></span>'
    btn.removeAttribute('title')
    btn.setAttribute('aria-label', label)
  }
  // The stage-height sync (companionCharts) listens for resize; entering
  // native fullscreen fires one too, but the CSS-only path would not.
  window.dispatchEvent(new Event('resize'))
  resizeChart()
  if (fs && window.scrollTo) window.scrollTo(0, 0)
  // The chart keeps its bar spacing as it grows, which left the candles in
  // the right half of a full-screen chart. Fit them to the new size once the
  // layout has settled (native fullscreen resizes a frame or two later).
  setTimeout(() => {
    if (chart && state.candles.length) chart.timeScale().fitContent()
  }, 350)
}

export function isFullScreen(): boolean {
  return document.documentElement.classList.contains('radar-fs')
}

export function setFullScreen(fs: boolean): void {
  if (fs === isFullScreen()) return
  applyFsState(fs)
  if (fs) enterNativeFs()
  else exitNativeFs()
}

function initFullScreen(): void {
  const btn = $('fsBtn')
  if (!btn) return
  btn.addEventListener('click', function () {
    setFullScreen(!isFullScreen())
  })
  // The browser can leave fullscreen on its own — Esc, the Android back
  // gesture, a swipe from the edge. Follow it so the chart does not stay
  // pinned over a page whose browser bars have come back.
  const onNativeChange = function () {
    if (!nativeFsElement() && isFullScreen()) applyFsState(false)
  }
  document.addEventListener('fullscreenchange', onNativeChange)
  document.addEventListener('webkitfullscreenchange', onNativeChange)
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
  // touch-action:none: while a tool is armed (the only time this layer is
  // shown) a finger draws instead of scrolling the page or panning the chart.
  overlay.style.cssText =
    'position:absolute;inset:0;z-index:6;cursor:crosshair;display:none;touch-action:none;'
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
      // Locked drawings are skipped, so the eraser reaches whatever is under them.
      const i = drawingAt(x, y, true)
      if (i === -1) return
      currentDrawings().splice(i, 1)
      saveDrawings()
      chartState._eraseHit = -1
      chartState._sel = -1
      publishDrawingCount()
      redrawDrawings()
      return
    }
    placeDrawPointFromXY(x, y, e.shiftKey)
  })
  // Open-ended shapes (polyline, patterns you want to cut short) finish here.
  overlay.addEventListener('dblclick', function (e) {
    const def = drawToolDef(getDrawTool())
    if (!def) return
    const r = overlay.getBoundingClientRect()
    if (def.points !== 0) return
    // The double-click's own two clicks already placed points on the same
    // spot: drop the extras so the line does not end in stacked vertices.
    const buf = chartState.drawBuf
    while (buf.length > 1 && samePlace(buf[buf.length - 1], buf[buf.length - 2])) buf.pop()
    commitPending(e.clientX - r.left, e.clientY - r.top)
  })
  // Freehand: press, drag, release. Pointer events, so a finger or pen draws
  // exactly like the mouse; capture keeps the stroke even past the edge.
  overlay.addEventListener('pointerdown', function (e) {
    const def = drawToolDef(getDrawTool())
    if (!def || def.points !== -1) return
    try {
      overlay.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic or already-released pointer */
    }
    const r = overlay.getBoundingClientRect()
    chartState._freehand = []
    const fx = e.clientX - r.left
    const fy = e.clientY - r.top
    chartState._freeXY = [fx, fy]
    const pt = snapToCandle(fx, fy)
    if (pt) chartState._freehand.push(pt)
  })
  overlay.addEventListener('pointerup', function () {
    const def = drawToolDef(getDrawTool())
    if (!def || def.points !== -1) return
    const pts = chartState._freehand || []
    chartState._freehand = null
    chartState._freeXY = null
    if (pts.length > 1) {
      currentDrawings().push(newDrawing('brush', def.color || '#4FC3F7', pts))
      saveDrawings()
      publishDrawingCount()
      redrawDrawings()
      afterDrawingPlaced()
      return
    }
    redrawDrawings()
  })
  // The browser took the touch back (a system gesture): drop the stroke.
  overlay.addEventListener('pointercancel', function () {
    chartState._freehand = null
    chartState._freeXY = null
    redrawDrawings()
  })
  overlay.addEventListener('pointermove', function (e) {
    const tool = getDrawTool()
    if (!tool) return
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    if (tool === 'erase') {
      // Highlight whatever a click would remove, so nothing vanishes by surprise.
      const i = drawingAt(x, y, true)
      if (i !== chartState._eraseHit) {
        chartState._eraseHit = i
        overlay.style.cursor = i === -1 ? 'crosshair' : 'pointer'
        redrawDrawings()
      }
      return
    }
    if (chartState._freehand) {
      const snapped = snapToCandle(x, y)
      if (!snapped) return
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
      const [cx, cy] = constrainFromLast(x, y, e.shiftKey)
      const snapped = snapToCandle(cx, cy, e.shiftKey)
      if (!snapped) return
      chartState._preview = snapped
      redrawDrawings(true)
    }
  })
  overlay.addEventListener('pointerleave', function () {
    chartState._preview = null
    chartState._eraseHit = -1
    redrawDrawings()
  })
  chartState.drawHit = overlay
  updateDrawHit()
  setupDrawSelect(wrap)
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

/** Bar times on screen in seconds, rebuilt only when the displayed bars change. */
let barTimesOf: Any[] | null = null
let barTimes: number[] = []
function shownBarTimes(): number[] {
  const bars = displayCandles()
  if (bars !== barTimesOf) {
    barTimesOf = bars
    barTimes = bars.map((k) => Math.floor(k.t / 1000))
  }
  return barTimes
}

function snapToCandle(x: Any, y: Any, noMagnet = false): Any {
  // Below the price pane (an indicator pane, v5) a price would be
  // extrapolated and the drawing clipped out of sight: no point there.
  if (y > mainPaneHeight(chart, Number.MAX_SAFE_INTEGER)) return null
  const ts = chart.timeScale()
  // Past the last bar the chart has no time; count bars on from the end, so
  // trend lines and fibs can be projected into the future.
  let time = ts.coordinateToTime(x)
  if (time == null) {
    const logical = ts.coordinateToLogical(x)
    time = logical == null ? null : logicalToTime(shownBarTimes(), logical)
  }
  let price: number | null
  try {
    price = candleSeries ? candleSeries.coordinateToPrice(y) : null
  } catch (e) {
    price = null
  }
  if (time == null || price == null) return null
  // Shift (angle constraint) wins over the magnet, as on TradingView.
  const mode = noMagnet ? 'off' : getMagnetMode()
  if (mode === 'off' || !candleSeries) return { time: time, price: price }
  const candles = displayCandles()
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
  // Strong magnet: always the nearest of the four; weak only when close to it.
  return { time: time, price: mode === 'strong' || bestDist <= MAGNET_PX ? best : price }
}

/**
 * Shift held while placing: the pixel the next point goes to, constrained to
 * 0/45/90 degrees from the last point placed.
 */
function constrainFromLast(x: number, y: number, shift: boolean): [number, number] {
  const last = chartState.drawBuf[chartState.drawBuf.length - 1]
  if (!shift || !last) return [x, y]
  const [cw, ch] = drawCanvasSize()
  const m = mapCtx(cw, ch)
  const lx = m.x(last.time)
  const ly = m.y(last.price)
  return lx == null || ly == null ? [x, y] : constrainAngle(lx, ly, x, y)
}

function placeDrawPointFromXY(x: Any, y: Any, shift = false): void {
  const def = drawToolDef(getDrawTool())
  if (!def) return
  ;[x, y] = constrainFromLast(x, y, shift)
  const pt = snapToCandle(x, y, shift)
  if (!pt) return
  chartState.drawBuf.push(pt)
  setPendingPoints(chartState.drawBuf.length)
  // points === 0 means open-ended: keep collecting until a double-click.
  if (def.points > 0 && chartState.drawBuf.length >= def.points) commitPending(x, y)
  redrawDrawings()
}

/** Two anchors on (nearly) the same bar and price, i.e. one place clicked twice. */
function samePlace(a: Any, b: Any): boolean {
  if (!a || !b || a.time !== b.time) return false
  const ya = candleSeries?.priceToCoordinate(a.price)
  const yb = candleSeries?.priceToCoordinate(b.price)
  return ya != null && yb != null ? Math.abs(ya - yb) <= 3 : a.price === b.price
}

/** Turn the points collected so far into a drawing. (x, y) is the last click. */
function commitPending(x: number, y: number): void {
  const def = drawToolDef(getDrawTool())
  if (!def) return
  const pts = chartState.drawBuf
  const min = def.points > 0 ? def.points : 2
  if (pts.length < min) return
  // Only the newest DRAWINGS_MAX_PER_COIN are saved: say so instead of
  // letting the oldest vanish on the next reload.
  if (currentDrawings().length >= DRAWINGS_MAX_PER_COIN) {
    chartState.drawBuf = []
    chartState._preview = null
    publishDrawingCount()
    redrawDrawings()
    showToast('This coin already has ' + DRAWINGS_MAX_PER_COIN + ' drawings — delete some to add more')
    return
  }
  // A position's stop and target are put on the right side of the entry.
  const drawing: Any = newDrawing(def.id, def.color || '#4FC3F7', fixPositionSides(def.id, pts.slice()))
  chartState.drawBuf = []
  chartState._preview = null
  if (def.text) {
    // The caption is typed in place; the drawing lands once it is confirmed.
    const sym = drawingsSym
    chartState._captionDraft = { ...drawing, text: '…' }
    askCaption(x, y, function (caption) {
      chartState._captionDraft = null
      if (caption != null && sym === drawingsSym) {
        drawing.text = caption
        currentDrawings().push(drawing)
        saveDrawings()
        publishDrawingCount()
        redrawDrawings()
        afterDrawingPlaced()
        return
      }
      publishDrawingCount()
      redrawDrawings()
    })
    publishDrawingCount()
    redrawDrawings()
    return
  }
  currentDrawings().push(drawing)
  saveDrawings()
  publishDrawingCount()
  redrawDrawings()
  afterDrawingPlaced()
}

/**
 * Caption input for the text tools, typed right where the label goes.
 * Enter saves, Esc cancels, clicking away saves whatever was typed.
 */
let labelInput: HTMLInputElement | null = null
function closeLabelInput(): void {
  const el = labelInput
  labelInput = null
  el?.remove()
}
function askCaption(
  x: number,
  y: number,
  done: (caption: string | null) => void,
  initial = '',
): void {
  closeLabelInput()
  const wrap = $('chartWrap')
  if (!wrap) return done(null)
  const el = document.createElement('input')
  el.type = 'text'
  el.className = 'draw-label-input'
  el.placeholder = 'Label'
  el.maxLength = 80
  el.value = initial
  el.setAttribute('aria-label', 'Drawing label')
  el.style.left = Math.max(4, Math.min(x, wrap.clientWidth - 170)) + 'px'
  el.style.top = Math.max(4, Math.min(y - 14, wrap.clientHeight - 32)) + 'px'
  labelInput = el
  let settled = false
  const finish = (caption: string | null) => {
    if (settled) return
    settled = true
    if (labelInput === el) closeLabelInput()
    done(caption)
  }
  el.addEventListener('keydown', function (e) {
    e.stopPropagation()
    if (e.key === 'Enter') finish(el.value.trim() || 'Note')
    else if (e.key === 'Escape') finish(null)
  })
  el.addEventListener('blur', function () {
    finish(el.value.trim() || null)
  })
  // Clicks on the field must not place points on the draw layer beneath.
  el.addEventListener('pointerdown', (e) => e.stopPropagation())
  el.addEventListener('click', (e) => e.stopPropagation())
  wrap.appendChild(el)
  el.focus()
  if (initial) el.select()
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
/** [first, end) indices of the displayed bars with lo <= t <= hi (ms). */
function barSpan(lo: number, hi: number): [number, number] {
  const a = displayCandles()
  const first = (x: number, incl: boolean) => {
    let l = 0
    let h = a.length
    while (l < h) {
      const m = (l + h) >> 1
      if (incl ? a[m].t < x : a[m].t <= x) l = m + 1
      else h = m
    }
    return l
  }
  return [first(lo, true), first(hi, false)]
}

/** Everything the geometry engine needs to turn prices and times into pixels. */
function mapCtx(cw: number, ch: number): MapCtx {
  const ts = chart.timeScale()
  return {
    // Through logical space, not timeToCoordinate: that needs a bar at exactly
    // `t`, so an anchor from another interval (13:15 on 4h) or outside the
    // loaded bars had no x and the whole drawing vanished.
    x: (t: number) => {
      const logical = timeToLogical(shownBarTimes(), snapChartTime(t))
      return logical == null ? null : ts.logicalToCoordinate(logical as Any)
    },
    y: (pr: number) => (candleSeries ? candleSeries.priceToCoordinate(pr) : null),
    cw: cw,
    ch: ch,
    fmt: (pr: number) => pfmt(pr),
    // Binary searches over the bars on screen: these run on every paint of a
    // measure or regression drawing, and filtering 5000 bars each time added up.
    closesBetween(t1: number, t2: number) {
      const [a, b] = barSpan(Math.min(t1, t2) * 1000, Math.max(t1, t2) * 1000)
      return displayCandles()
        .slice(a, b)
        .map((k) => k.c)
    },
    barsBetween(t1: number, t2: number) {
      const [a, b] = barSpan(Math.min(t1, t2) * 1000, Math.max(t1, t2) * 1000)
      return b - a
    },
    candles(t1: number, t2: number) {
      const [a, b] = barSpan(Math.min(t1, t2) * 1000, Math.max(t1, t2) * 1000)
      return displayCandles().slice(a, b)
    },
    last: (() => {
      const bars = displayCandles()
      return bars.length ? bars[bars.length - 1].c : null
    })(),
    timeLabel(t: number) {
      return fmtChartDate(t * 1000, {
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

/**
 * Horizontal extent of the plot area in canvas pixels — the canvas spans the
 * price axis too, and drawings stop at its edge (as on TradingView).
 */
function plotSpan(cw: number): [number, number] {
  try {
    const left = chart.priceScale('left').width() || 0
    const w = chart.timeScale().width()
    if (w > 0) return [left, Math.min(cw, left + w)]
  } catch {
    /* chart not laid out yet */
  }
  return [0, cw]
}

/** Canvas size in CSS pixels. */
function drawCanvasSize(): [number, number] {
  const cv = chartState.drawCanvas
  const dpr = window.devicePixelRatio || 1
  return cv ? [cv.width / dpr, cv.height / dpr] : [0, 0]
}

/**
 * Index of the drawing under a pixel position, or -1. Hidden drawings are
 * never hit; `skipLocked` (the eraser) passes over locked ones too.
 */
function drawingAt(x: Any, y: Any, skipLocked = false): number {
  if (!chartState.drawCanvas) return -1
  const [cw, ch] = drawCanvasSize()
  const [px0, px1] = plotSpan(cw)
  if (x < px0 || x > px1) return -1
  const drawings = currentDrawings()
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (drawings[i].hidden || (skipLocked && drawings[i].locked)) continue
    const sh = shapeOf(drawings[i], cw, ch)
    if (sh && hitShape(sh, x, y)) return i
  }
  return -1
}

// ---- Selecting and editing drawings (cursor tool) ----
// With no tool armed the chart gets every pointer event, so this listens in
// the capture phase on #chartWrap: a press on a drawing (or on a handle of the
// selected one) is taken from the chart and becomes a move; a press anywhere
// else deselects and is left alone, so the chart pans as before.
function setupDrawSelect(wrap: HTMLElement): void {
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = wrap.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const onMove = (e: PointerEvent) => {
    const drag = chartState._drag
    if (!drag || e.pointerId !== drag.pointerId) return
    let [x, y] = local(e)
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return
    const d = currentDrawings()[drag.i]
    // Locked: it can be selected (to unlock it) but not moved.
    if (!d || d.locked) return
    drag.moved = true
    if (drag.handle >= 0) {
      // Shift: the handle keeps 0/45/90 degrees to its neighbouring anchor.
      if (e.shiftKey && drag.start.length > 1) {
        const other = drag.start[drag.handle > 0 ? drag.handle - 1 : 1]
        const [cw, ch] = drawCanvasSize()
        const m = mapCtx(cw, ch)
        const ox = m.x(other.time)
        const oy = m.y(other.price)
        if (ox != null && oy != null) [x, y] = constrainAngle(ox, oy, x, y)
      }
      const pt = snapToCandle(x, y, e.shiftKey)
      if (!pt) return
      const pts = drag.start.map((p: Any, k: number) => (k === drag.handle ? pt : { ...p }))
      d.points = fixPositionSides(d.type, pts, true)
    } else {
      // Shift: move straight across, straight up or down, or at 45 degrees.
      if (e.shiftKey) [x, y] = constrainAngle(drag.x0, drag.y0, x, y)
      const ts = chart.timeScale()
      const l0 = ts.coordinateToLogical(drag.x0)
      const l1 = ts.coordinateToLogical(x)
      const dBars = l0 != null && l1 != null ? l1 - l0 : 0
      const dy = y - drag.y0
      const times = displayCandles().map((k) => Math.floor(k.t / 1000))
      d.points = shiftPoints(drag.start, dBars, times, (pr) => {
        const py = candleSeries ? candleSeries.priceToCoordinate(pr) : null
        return py == null ? null : candleSeries.coordinateToPrice(py + dy)
      })
    }
    redrawDrawings()
  }
  const end = (e: PointerEvent) => {
    const drag = chartState._drag
    if (!drag || e.pointerId !== drag.pointerId) return
    chartState._drag = null
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', end, true)
    window.removeEventListener('pointercancel', end, true)
    const d = currentDrawings()[drag.i]
    if (d && e.type === 'pointercancel') d.points = drag.start
    else if (d && drag.moved) saveDrawings()
    redrawDrawings()
  }
  wrap.addEventListener(
    'pointerdown',
    function (e) {
      if (getDrawTool() || chartState._drag || e.button !== 0 || !chart) return
      const t = e.target as Element | null
      if (t && t.closest('button, input, select, textarea, a, [role="button"]')) return
      const [x, y] = local(e)
      const [cw, ch] = drawCanvasSize()
      const drawings = currentDrawings()
      // The selected drawing's handles win over anything drawn on top.
      const sel = chartState._sel
      const selShape = sel >= 0 && drawings[sel] ? shapeOf(drawings[sel], cw, ch) : null
      const handle = selShape ? handleAt(selShape, x, y) : -1
      const i = handle >= 0 ? sel : drawingAt(x, y)
      if (i === -1) {
        if (sel >= 0) {
          chartState._sel = -1
          redrawDrawings()
        }
        return
      }
      // Ours: keep the chart from panning or scrolling under the drag.
      e.preventDefault()
      e.stopPropagation()
      flushNudge()
      chartState._sel = i
      chartState._drag = {
        pointerId: e.pointerId,
        i,
        handle,
        x0: x,
        y0: y,
        moved: false,
        start: drawings[i].points.map((p: Any) => ({ ...p })),
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', end, true)
      window.addEventListener('pointercancel', end, true)
      redrawDrawings()
    },
    true,
  )
  // The chart listens for mouse and touch events, not only pointer ones.
  const swallow = (e: Event) => {
    if (chartState._drag) {
      e.stopPropagation()
      if (e.cancelable && e.type === 'touchmove') e.preventDefault()
    }
  }
  ;['mousedown', 'mousemove', 'touchstart', 'touchmove'].forEach((type) =>
    wrap.addEventListener(type, swallow, { capture: true, passive: false }),
  )
  // While placing a drawing: Esc cancels it (then disarms the tool), Enter
  // finishes an open-ended one (polyline, path), as the tool hints say.
  window.addEventListener(
    'keydown',
    function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey || chartState._sel >= 0) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return
      if (!wrap.isConnected || !wrap.offsetParent || !getDrawTool()) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (chartState.drawBuf.length) {
          chartState.drawBuf = []
          chartState._preview = null
          publishDrawingCount()
          redrawDrawings()
        } else setDrawTool(null)
      } else if (e.key === 'Enter') {
        const def = drawToolDef(getDrawTool())
        if (def && def.points === 0 && chartState.drawBuf.length >= 2) {
          e.preventDefault()
          commitPending(0, 0)
        }
      }
    },
    true,
  )
  // Double-click a text, callout or note with the cursor to edit its caption.
  wrap.addEventListener(
    'dblclick',
    function (e) {
      if (getDrawTool() || !chart) return
      const [x, y] = local(e)
      const i = drawingAt(x, y)
      const d = i >= 0 ? currentDrawings()[i] : null
      if (!d || !drawToolDef(d.type)?.text) return
      // Ours, not the chart's (a double-click there resets the price scale).
      e.preventDefault()
      e.stopPropagation()
      chartState._sel = i
      redrawDrawings()
      editDrawingText(i)
    },
    true,
  )
  // Delete / Backspace removes the selection, Esc drops it, arrows nudge it,
  // Ctrl+D clones it.
  window.addEventListener(
    'keydown',
    function (e) {
      if (!(chartState._sel >= 0) || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return
      // Only while the chart is on screen; a hidden tab keeps its selection.
      if (!wrap.isConnected || !wrap.offsetParent) return
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+D would bookmark the page; here it clones the drawing.
        if (e.key.toLowerCase() === 'd' && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          runDrawingCommand({ kind: 'clone' })
        }
        return
      }
      if (e.key.startsWith('Arrow')) {
        // Arrows otherwise scroll the chart (and the page): only while nudging.
        if (nudgeSelected(e.key, e.shiftKey)) {
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        flushNudge()
        if (currentDrawings()[chartState._sel]) {
          currentDrawings().splice(chartState._sel, 1)
          saveDrawings()
        }
        chartState._sel = -1
        chartState._drag = null
        publishDrawingCount()
        redrawDrawings()
      } else if (e.key === 'Escape') {
        e.stopPropagation()
        chartState._sel = -1
        redrawDrawings()
      }
    },
    true,
  )
}

/** Per-drawing line style from the selection toolbar (width in px). */
const DASHES: Record<string, number[]> = { dashed: [6, 4], dotted: [1.5, 3] }

function paintShape(
  ctx: Any,
  sh: Shape,
  base: string,
  doomed: boolean,
  selected = false,
  style: { width?: number; dash?: string } = {},
): void {
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
    // The drawing's own width / style apply to its main lines; decoration
    // (soft) keeps the tool's look.
    const own = !g.soft
    ctx.lineWidth = g.width || (doomed ? 2.2 : own && style.width ? style.width : 1.7)
    ctx.lineCap = 'round'
    ctx.setLineDash(g.dash || (own && style.dash ? DASHES[style.dash] || [] : []))
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
    ctx.lineWidth = doomed ? 2.2 : style.width || 1.7
    ctx.setLineDash(a.dash || (style.dash ? DASHES[style.dash] || [] : []))
    ctx.beginPath()
    ctx.ellipse(a.cx, a.cy, a.rx, a.ry, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  })
  sh.handles.forEach((h) => {
    ctx.save()
    ctx.fillStyle = doomed ? stroke : base
    ctx.beginPath()
    if (selected) {
      // Selected: hollow grab handles, as on TradingView.
      ctx.fillStyle = isLightTheme() ? '#ffffff' : '#0b1220'
      ctx.strokeStyle = base
      ctx.lineWidth = 1.6
      ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.arc(h.x, h.y, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  })
  sh.labels.forEach((l) => {
    ctx.save()
    const fs = l.size || 10
    ctx.font = fs + 'px JetBrains Mono, monospace'
    ctx.textAlign = l.align || 'left'
    const w = ctx.measureText(l.text).width
    if (l.box) {
      const bx = l.align === 'center' ? l.x - w / 2 : l.align === 'right' ? l.x - w : l.x
      ctx.fillStyle = isLightTheme() ? 'rgba(255,255,255,.88)' : 'rgba(6,11,24,.78)'
      ctx.fillRect(bx - 4, l.y - fs, w + 8, fs + 4)
      ctx.strokeStyle = doomed ? stroke : l.color || base
      ctx.lineWidth = 1
      ctx.strokeRect(bx - 4, l.y - fs, w + 8, fs + 4)
    }
    ctx.fillStyle = doomed ? stroke : l.color || base
    ctx.fillText(l.text, l.x, l.y)
    ctx.restore()
  })
}

/** Tell the selection toolbar which drawing is selected and how it looks. */
function publishSelection(): void {
  const d = chartState._sel >= 0 ? chartState.drawings[chartState._sel] : null
  setSelectedDrawing(
    d
      ? {
          type: d.type,
          color: d.color || '#4FC3F7',
          width: d.width || 1.7,
          dash: d.dash || 'solid',
          locked: !!d.locked,
          hidden: !!d.hidden,
          fontSize: d.fontSize || 10,
          text: typeof d.text === 'string' ? d.text : null,
          account: typeof d.account === 'number' ? d.account : null,
          risk: typeof d.risk === 'number' ? d.risk : null,
        }
      : null,
  )
  // The object tree (side panel); the store skips the update when nothing changed.
  setDrawingList(
    chartState.drawings.map((x: Any, i: number) => ({
      type: x.type,
      name: (drawToolDef(x.type)?.name || x.type) + (x.text ? ': ' + x.text : ''),
      color: x.color || '#4FC3F7',
      locked: !!x.locked,
      hidden: !!x.hidden,
      selected: i === chartState._sel,
    })),
  )
}

function redrawDrawings(includePreview?: Any): void {
  placePaneLegends()
  renderVolumeProfile(visibleCandles())
  renderWhaleBubbles()
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

  // Keep every drawing off the price axis: a horizontal line used to run
  // straight across the axis labels.
  const [px0, px1] = plotSpan(cw)
  ctx.save()
  ctx.beginPath()
  ctx.rect(px0, 0, px1 - px0, mainPaneHeight(chart, ch))
  ctx.clip()

  currentDrawings().forEach(function (d: Any, i: number) {
    if (d.hidden) return
    const sh = shapeOf(d, cw, ch)
    if (sh)
      paintShape(ctx, sh, d.color, i === chartState._eraseHit, i === chartState._sel, {
        width: d.width,
        dash: d.dash,
      })
  })
  publishSelection()

  // A text drawing waiting for its caption stays visible while it is typed.
  if (chartState._captionDraft) {
    const sh = shapeOf(chartState._captionDraft, cw, ch)
    if (sh) {
      ctx.save()
      ctx.globalAlpha = 0.65
      paintShape(ctx, sh, chartState._captionDraft.color, false)
      ctx.restore()
    }
  }

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
  ctx.restore()
}

// ---- Hero / overview renders ----
export function renderHero(): void {
  const t = state.tickers[state.symbol] as Any
  const meta = coinMeta(state.symbol)
  $('heroIcon')!.textContent = meta.icon
  $('heroIcon')!.style.borderColor = meta.color + '55'
  $('heroName')!.textContent = meta.name
  $('heroPair')!.textContent = meta.sym + ' · ' + venueOf(state.symbol)
  if (!t) {
    // The name and venue above have already switched to the new market. If we
    // simply returned here, the price block kept the *previous* symbol's
    // numbers — so selecting spot gold showed Bitcoin's price under a XAUUSD
    // heading until the first quote landed. Blank it instead; an instrument
    // is polled rather than streamed, so that gap is a second or two.
    const el = $('heroPrice')!
    el.textContent = '—'
    el.dataset.p = '0'
    $('heroChg')!.innerHTML = ''
    $('heroUpdated')!.textContent = ''
    $('hsHigh')!.textContent = '—'
    $('hsLow')!.textContent = '—'
    $('hsVol')!.textContent = '—'
    $('hsTrades')!.textContent = '—'
    return
  }
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
  // An instrument priced by Yahoo reports no trade count, and FX and indices
  // report no volume at all. Printing a formatted undefined — or a confident
  // "0 trades" for Apple — would be worse than saying nothing.
  const dash = (v: unknown, fmt: (x: Any) => string): string =>
    v == null || (typeof v === 'number' && !isFinite(v)) ? '—' : fmt(v)
  $('hsHigh')!.textContent = dash(t.high, (v) => '$' + pfmt(v))
  $('hsLow')!.textContent = dash(t.low, (v) => '$' + pfmt(v))
  $('hsVol')!.textContent = t.qvol ? cfmt(t.qvol) : '—'
  $('hsTrades')!.textContent = dash(t.trades, (v) => nfmt(v))
  $('hsMark')!.textContent = state.fr
    ? '$' + pfmt(parseFloat((state.fr as Any).markPrice))
    : '—'
}

/** A round coin badge: the CoinGecko logo once it is known, else the glyph. */
function tickIcon(key: string, glyph: string, color: string): string {
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[key]?.image
  const inner = img && /^https:\/\//.test(img) ? '<img src="' + img.replace(/"/g, '') + '" alt="" loading="lazy">' : glyph
  return '<i class="tk-ico" style="border-color:' + color + '66;background:' + color + '1f;color:' + color + '">' + inner + '</i>'
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
      '"><span class="ts">' +
      tickIcon(k, c.icon, c.color) +
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

/**
 * The main chart as an image (Charts tab → Quick Tools → Export).
 *
 * takeScreenshot() only paints the library's own canvases, so the overlays
 * stacked on top of it inside #chartWrap (drawings, volume profile, whale
 * bubbles) are composited in at the position they sit on screen.
 */
export function chartScreenshot(): HTMLCanvasElement | null {
  try {
    if (!chart) return null
    const shot = chart.takeScreenshot() as HTMLCanvasElement
    const el = $('chart')
    const wrap = $('chartWrap')
    if (!el || !wrap || !el.clientWidth) return shot
    // The screenshot is in device pixels; overlays are measured in CSS pixels.
    const cr = el.getBoundingClientRect()
    const kx = shot.width / cr.width
    const ky = shot.height / cr.height
    // A header strip, as TradingView snapshots carry: symbol, interval,
    // exchange, the last bar's OHLC and when it was taken.
    const headH = Math.round(30 * ky)
    const out = document.createElement('canvas')
    out.width = shot.width
    out.height = shot.height + headH
    const ctx = out.getContext('2d')
    if (!ctx) return shot
    const pal = chartPalette()
    ctx.fillStyle = pal.bg
    ctx.fillRect(0, 0, out.width, headH)
    ctx.drawImage(shot, 0, headH)
    wrap.querySelectorAll('canvas').forEach((c) => {
      if (el.contains(c) || !c.width || !c.height) return
      const r = c.getBoundingClientRect()
      if (!r.width || !r.height || getComputedStyle(c).display === 'none') return
      ctx.drawImage(c, (r.left - cr.left) * kx, headH + (r.top - cr.top) * ky, r.width * kx, r.height * ky)
    })
    const lcs = legendCandles(getChartStyle(), displayCandles())
    const lc = lcs[lcs.length - 1]
    const title =
      legendSymbol(state.symbol) + ' · ' + tfLabel(getTimeframe()) + ' · ' + legendExchange(state.symbol)
    const ohlc = lc
      ? '   O ' + chartPrice(lc.o) + '  H ' + chartPrice(lc.h) + '  L ' + chartPrice(lc.l) + '  C ' + chartPrice(lc.c)
      : ''
    const when = fmtChartDate(Date.now(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    ctx.textBaseline = 'middle'
    ctx.font = '600 ' + Math.round(13 * ky) + 'px ' + "-apple-system, 'Trebuchet MS', Roboto, sans-serif"
    ctx.fillStyle = isLightTheme() ? '#131722' : '#D1D4DC'
    ctx.textAlign = 'left'
    ctx.fillText(title + ohlc, Math.round(10 * kx), headH / 2)
    ctx.font = Math.round(11 * ky) + 'px ' + "-apple-system, 'Trebuchet MS', Roboto, sans-serif"
    ctx.textAlign = 'right'
    ctx.fillText(when + '  ·  Liquidity Radar', out.width - Math.round(10 * kx), headH / 2)
    return out
  } catch {
    return null
  }
}
