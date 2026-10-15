import * as LightweightCharts from 'lightweight-charts'
import { venueOf } from '../../utils/coins'
import { COINS, TICKER_COINS } from '../../constants/market'
import { pfmt, nfmt, cfmt, chgHtml } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $, showToast } from '../../utils/dom'
import { state } from '../../services/store'
import { storageGet, storageSet } from '../../services/storage'
import {
  attachIndicatorChart,
  indicatorLegend,
  indicatorPaneCount,
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
import {
  chartPalette,
  resetTvLastPrice,
  tvChartOptions,
  tvLastPrice,
  tvWatermark,
} from './chartPalette'
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
import { attachDeltaPane, renderDeltaPane } from './deltaPane'
import { attachWhaleBubbles, renderWhaleBubbles, watchLiveWhales } from './whaleBubbles'
import { attachVolumeProfile, renderVolumeProfile } from './volumeProfileOverlay'
import { onDeltaChange } from '../delta/delta'
import { onOverlayTogglesChange } from './overlayToggles'
import { afterChartFit, attachScaleNav } from './scaleNav'

type Any = any
;(window as Any).LightweightCharts = LightweightCharts

let chart: Any = null
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
  chart.applyOptions({ ...tvChartOptions(), ...tvWatermark(watermarkText()) })
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

/** "BTCUSDT, 15m" — the watermark TradingView prints behind the bars. */
function watermarkText(): string {
  return legendSymbol(state.symbol) + ', ' + tfLabel(getTimeframe())
}
let watermarkShown = ''
function syncWatermark(): void {
  const text = watermarkText()
  if (text === watermarkShown) return
  watermarkShown = text
  chart.applyOptions(tvWatermark(text))
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
    return c.addCandlestickSeries({
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
    return c.addCandlestickSeries({
      ...renkoSeriesOptions(),
      priceLineColor: th.pline,
      priceLineStyle: 2,
    })
  } else if (id === 'bar' || id === 'hlc') {
    // HLC bars are bars without the open tick.
    return c.addBarSeries({
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
  return c.addCandlestickSeries({
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
  if (chartState.styleSeries) {
    stopBaselineBase(chartState.styleSeries)
    try {
      chart.removeSeries(chartState.styleSeries)
    } catch (e) {
      /* already detached */
    }
  }
  chartState.styleSeries = null
  candleSeries = null

  const base = state.candles.length ? state.candles[0].c : 0
  candleSeries = createPriceSeries(chart, getChartStyle(), base)
  chartState.styleSeries = candleSeries
  priceSeriesSubs.forEach((f) => f(candleSeries))
}
export { renderWhaleBubbles } from './whaleBubbles'
export function initChart(): void {
  if (!(window as Any).LightweightCharts) {
    $('legendOHLC')!.textContent = 'Chart library failed to load'
    return
  }
  const el = $('chart')!
  // TradingView's canvas: palette colours, fonts, dashed grey crosshair and a
  // faint symbol watermark (see ./chartPalette).
  const tv: Any = tvChartOptions()
  watermarkShown = watermarkText()
  chart = LightweightCharts.createChart(el, {
    // autoSize lets the library watch the container itself. Passing explicit
    // width/height instead makes it write inline sizes onto the element, which
    // then override the CSS — that is what used to leave the chart stuck at
    // whatever height the side panel had stretched it to.
    autoSize: true,
    ...tv,
    ...tvWatermark(watermarkShown),
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
      priceFormatter: function (p: number) {
        return pfmt(p)
      },
    },
  } as Any)
  applyChartStyle()
  attachIndicatorChart(chart)
  attachDeltaPane(chart)
  attachWhaleBubbles(chart, candleSeries, $('chartWrap')!)
  attachVolumeProfile(chart, candleSeries, $('chartWrap')!)
  // The countdown reads the live series each time, so a style change that
  // replaces the series does not strand it.
  // Range bars do not close on the clock, so there is nothing to count down.
  mountCloseTimer(chart, () => (isRangeMode() ? null : candleSeries))
  // Price-scale modes, zoom/scroll buttons and the date-range bar (scaleNav).
  attachScaleNav({ chart, el, getSeries: () => candleSeries, onSeriesChange: onPriceSeriesChange })
  // While the cursor is over a bar the legend shows that bar; live ticks must
  // not overwrite it, and leaving the chart hands it back to the live candle.
  chart.subscribeCrosshairMove((param: Any) => {
    // Heikin Ashi: the legend reads the HA bars, as drawn.
    const shown =
      param.time && param.point ? legendCandles(getChartStyle(), displayCandles()) : null
    const i = shown ? shown.findIndex((c) => Math.floor(c.t / 1000) === param.time) : -1
    const cp = shown && i >= 0 ? shown[i] : null
    if (!shown || !cp) {
      if (hoverTime != null) {
        hoverTime = null
        renderLiveLegend()
      }
      return
    }
    hoverTime = param.time as number
    renderLegend(cp.o, cp.h, cp.l, cp.c, cp.v, true, shown[i - 1]?.c)
  })
  chart.timeScale().subscribeVisibleTimeRangeChange(function () {
    redrawDrawings()
  })
  // The chart resizes itself; these only need to follow it. One exception:
  // the chart is built at startup while the Home screen is showing, so its
  // first fit happens at zero width and leaves the candles crammed into the
  // right half once a chart tab opens. Re-fit the first time it has a width.
  let fitW = el.clientWidth
  new ResizeObserver(() => {
    if (fitW < 60 && el.clientWidth >= 60 && state.candles.length) chart.timeScale().fitContent()
    fitW = el.clientWidth
    redrawDrawings()
    updateCloseTimer()
  }).observe(el)
  setupDrawLayer()
  wireLegendActions()
  initChartToolbar()
  initFullScreen()
  // Adding, editing or replaying an indicator redraws through the same path as
  // a fresh data load, so there is one place where series are built.
  onIndicatorsChange(() => updateChartData(false))
  onReplayChange((modeChanged: boolean) => updateChartData(modeChanged))
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
  // Delta bars stream in far faster than the chart should repaint — coalesce
  // to the next frame, same reasoning as the live-tick indicator refresh
  // below (IND_REFRESH_MS): the eye cannot read faster than that anyway.
  let deltaPending = false
  onDeltaChange(() => {
    if (deltaPending) return
    deltaPending = true
    requestAnimationFrame(() => {
      deltaPending = false
      renderDeltaPane(timeOnlyCandles(), indicatorPaneCount())
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
/** Bar time (seconds) under the crosshair, or null when the cursor is off the chart. */
let hoverTime: number | null = null
function renderLiveLegend(): void {
  const candles = legendCandles(getChartStyle(), displayCandles())
  const lc = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  if (lc) renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, prev?.c)
}
const fmtChg = (d: number): string => (d >= 0 ? '+' : '\u2212') + pfmt(Math.abs(d))
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
  $('legendOHLC')!.innerHTML =
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
    fmtChg(d) +
    ' (' +
    (pct >= 0 ? '+' : '\u2212') +
    Math.abs(pct).toFixed(2) +
    '%)</b>' +
    (v != null ? '<span class="leg-k">Vol</span><b>' + nfmt(v) + '</b>' : '') +
    '</span></div>' +
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
const EYE_ON =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
const EYE_OFF =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 4 20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'
const REMOVE =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 6 18 18M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
function buildIndicatorLegend(): string {
  const rows = indicatorLegend(displayCandles())
  if (!rows.length) return ''
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
              (p.big ? nfmt(p.value) : pfmt(p.value)) +
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
function wireLegendActions(): void {
  const el = $('legendOHLC')
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
export function updateChartData(fit = false): void {
  if (!chart) return
  const candles = displayCandles()
  if (!candles.length) return
  const ts = chart.timeScale()
  syncSecondsVisible()
  const keep = fit ? null : ts.getVisibleLogicalRange()
  const prevFirst = chartState.firstBarTime as number | undefined
  candleSeries.setData(priceSeriesData(getChartStyle(), candles))
  if (getChartStyle() === 'baseline') syncBaselineBase(chart, candleSeries, displayCandles)
  rangeShown = isRangeMode() ? candles : []
  renderIndicators(candles)
  renderDeltaPane(timeOnlyCandles(), indicatorPaneCount())
  renderWhaleBubbles()
  if (fit) {
    ts.fitContent()
    afterChartFit()
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
  const lc = legendCandles(getChartStyle(), candles)[candles.length - 1]
  refreshIndicatorLegend()
  if (hoverTime == null)
    renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, candles[candles.length - 2]?.c)
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
    // Heikin Ashi: the legend reports the HA bar just drawn (memoised, so cheap).
    if (getChartStyle() === 'heikin') c = heikinAshiBar(shown, c)
    if (getChartStyle() === 'baseline') syncBaselineBase(chart, candleSeries, displayCandles)
  }
  // The candle follows the tape frame by frame, but indicators and the legend
  // are recomputed over the whole series — far too much work to repeat on every
  // trade print, and nothing the eye could read that fast anyway.
  // Hovering an older bar keeps its values; hovering the live one follows it.
  // Previous close for the change readout: the bar before the live one.
  const arr: Any[] = isRangeMode() ? rangeShown : state.candles
  const at = arr.length - 1
  const prevBar = at >= 0 && arr[at].t === c.t ? arr[at - 1] : arr[at]
  if (hoverTime == null || hoverTime === Math.floor(c.t / 1000))
    renderLegend(c.o, c.h, c.l, c.c, c.v, hoverTime != null, prevBar?.c)
  syncLastPrice(c)
  const now = Date.now()
  if (!indPending && now - indLast >= IND_REFRESH_MS) {
    indPending = true
    requestAnimationFrame(() => {
      indPending = false
      indLast = Date.now()
      if (!isReplayOn()) {
        const shown = displayCandles()
        renderIndicators(shown)
        renderDeltaPane(timeOnlyCandles(), indicatorPaneCount())
        refreshIndicatorLegend()
        const lcs = legendCandles(getChartStyle(), shown)
        const lc = lcs[lcs.length - 1]
        if (lc && hoverTime == null)
          renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false, lcs[lcs.length - 2]?.c)
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
    currentDrawings()
    chartState.drawings = []
    chartState.drawBuf = []
    chartState._eraseHit = -1
    saveDrawings()
    publishDrawingCount()
    redrawDrawings()
    showToast('Drawings cleared')
  })
  onUndoDrawing(function () {
    if (chartState.drawBuf.length) chartState.drawBuf = []
    else if (currentDrawings().pop()) saveDrawings()
    chartState._eraseHit = -1
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
    drawingsSym = sym
    const all = storageGet<Record<string, Any[]>>(DRAWINGS_KEY, {})
    const list = all && Array.isArray(all[sym]) ? all[sym] : []
    chartState.drawings = list.filter(validDrawing)
    chartState.drawBuf = []
    chartState._preview = null
    chartState._eraseHit = -1
    chartState._freehand = null
    chartState._freeXY = null
    chartState._captionDraft = null
    closeLabelInput()
    publishDrawingCount()
  }
  return chartState.drawings
}

/** Write the current coin's set back; the most recently edited coins are kept. */
function saveDrawings(): void {
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
    btn.textContent = fs ? '✕' : '⛶'
    btn.title = fs ? 'Exit full screen [F]' : 'Full screen [F]'
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
      const i = drawingAt(x, y)
      if (i === -1) return
      currentDrawings().splice(i, 1)
      saveDrawings()
      chartState._eraseHit = -1
      publishDrawingCount()
      redrawDrawings()
      return
    }
    placeDrawPointFromXY(x, y)
  })
  // Open-ended shapes (polyline, patterns you want to cut short) finish here.
  overlay.addEventListener('dblclick', function (e) {
    const def = drawToolDef(getDrawTool())
    if (!def) return
    const r = overlay.getBoundingClientRect()
    if (def.points === 0) commitPending(e.clientX - r.left, e.clientY - r.top)
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
      currentDrawings().push({ type: 'brush', color: def.color || '#4FC3F7', points: pts })
      saveDrawings()
      publishDrawingCount()
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
  overlay.addEventListener('pointerleave', function () {
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
  if (def.points > 0 && chartState.drawBuf.length >= def.points) commitPending(x, y)
  redrawDrawings()
}

/** Turn the points collected so far into a drawing. (x, y) is the last click. */
function commitPending(x: number, y: number): void {
  const def = drawToolDef(getDrawTool())
  if (!def) return
  const pts = chartState.drawBuf
  const min = def.points > 0 ? def.points : 2
  if (pts.length < min) return
  const drawing: Any = { type: def.id, color: def.color || '#4FC3F7', points: pts.slice() }
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
function askCaption(x: number, y: number, done: (caption: string | null) => void): void {
  closeLabelInput()
  const wrap = $('chartWrap')
  if (!wrap) return done(null)
  const el = document.createElement('input')
  el.type = 'text'
  el.className = 'draw-label-input'
  el.placeholder = 'Label'
  el.maxLength = 80
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
    x: (t: number) => ts.timeToCoordinate(snapChartTime(t) as Any),
    y: (pr: number) => (candleSeries ? candleSeries.priceToCoordinate(pr) : null),
    cw: cw,
    ch: ch,
    fmt: (pr: number) => pfmt(pr),
    closesBetween(t1: number, t2: number) {
      const lo = Math.min(t1, t2) * 1000
      const hi = Math.max(t1, t2) * 1000
      return displayCandles()
        .filter((k) => k.t >= lo && k.t <= hi)
        .map((k) => k.c)
    },
    barsBetween(t1: number, t2: number) {
      const lo = Math.min(t1, t2) * 1000
      const hi = Math.max(t1, t2) * 1000
      return displayCandles().filter((k) => k.t >= lo && k.t <= hi).length
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
  const drawings = currentDrawings()
  for (let i = drawings.length - 1; i >= 0; i--) {
    const sh = shapeOf(drawings[i], cw, ch)
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

  currentDrawings().forEach(function (d: Any, i: number) {
    const sh = shapeOf(d, cw, ch)
    if (sh) paintShape(ctx, sh, d.color, i === chartState._eraseHit)
  })

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
    const out = document.createElement('canvas')
    out.width = shot.width
    out.height = shot.height
    const ctx = out.getContext('2d')
    if (!ctx) return shot
    ctx.drawImage(shot, 0, 0)
    // The screenshot is in device pixels; overlays are measured in CSS pixels.
    const cr = el.getBoundingClientRect()
    const kx = shot.width / cr.width
    const ky = shot.height / cr.height
    wrap.querySelectorAll('canvas').forEach((c) => {
      if (el.contains(c) || !c.width || !c.height) return
      const r = c.getBoundingClientRect()
      if (!r.width || !r.height || getComputedStyle(c).display === 'none') return
      ctx.drawImage(c, (r.left - cr.left) * kx, (r.top - cr.top) * ky, r.width * kx, r.height * ky)
    })
    return out
  } catch {
    return null
  }
}
