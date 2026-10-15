// Companion charts for the price-action multi-chart layouts.
//
// One cell of the grid is the *active* chart: the full main chart (#chartWrap),
// which the toolbar drives — coin, timeframe, style, indicators, drawings,
// replay. Like the Pro terminal, there is one set of controls, not one per
// chart: clicking another cell makes it the active one. The main chart then
// takes over that cell's coin, timeframe, style and indicators and moves into
// its place (CSS `order`), and the chart it was showing becomes a companion
// in the cell it left. Nothing on screen changes position; the controls just
// follow the chart you picked.
//
// This module owns the other cells: it builds them into #chartLayout, gives
// each a REST load and kline socket, and tears them down again when the
// layout shrinks. Chart plumbing mirrors multiCharts.ts; candle
// loading goes through the shared resampling loader so companions support the
// same intervals as the main chart. Live bars arrive over the shared kline hub
// (services/failover), so any number of companions share one socket.
//
// Each companion carries its own indicator set (indicators/panelStore, slot
// 'c<cell position>'), drawn by its own renderer over its own candles. The
// active cell's set lives in the main chart's store; the two swap with it.
import * as LightweightCharts from 'lightweight-charts'
import { isInstrument } from '../../constants/instruments'
import { baseOf, coinMeta } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { $ } from '../../utils/dom'
import {
  chartTheme,
  createPriceSeries,
  priceSeriesData,
  priceSeriesPoint,
  themePriceSeries,
} from './chartRender'
import { autoRangeSize, minSafeRange } from './series/rangeBars'
import { buildStyleBars } from './series/reversalSettings'
import { LAYOUTS, MAX_CHARTS, cells, layoutSpec, rowCount } from './layouts'
import { loadCandles } from '../../services/marketData'
import { mdSym, mdTf } from '../../services/market'
import { klineHub } from '../../services/failover'
import type { CandleFlat } from '../../services/market'
import { TIMEFRAMES, tfDef } from '../../services/timeframe'
import type { Folder } from '../../services/timeframe'
import { storageGet, storageSet } from '../../services/storage'
import { getTimeframe, setTimeframe, subscribeTimeframe } from './timeframes'
import { getChartStyle, manualRangeFor, setChartStyle, styleDef, subscribeChartStyle } from './chartStyle'
import type { ChartStyleId } from './chartStyle'
import { mainIndicatorStore, serializeIndicators } from './indicators/store'
import { state } from '../../services/store'
import { setSymbol, subscribeSymbol } from '../actions/userActions'
import { createIndicatorRenderer } from './indicators/render'
import type { IndicatorRenderer } from './indicators/render'
import { panelIndicatorStore } from './indicators/panelStore'
import { unmountCoinPickers } from '../../components/chart/mountCoinPicker'

type Any = any

/** What a cell shows; the active cell's comes from the main chart. */
interface CellCfg {
  sym: string
  tf: string
  style: ChartStyleId
}

interface Panel {
  id: number
  /** Grid position (0-based); the main chart holds `active`. */
  pos: number
  sym: string
  tf: string
  style: ChartStyleId
  el: HTMLElement | null
  chart: Any
  /** The price series, built for `style` (see chartRender createPriceSeries). */
  candleSeries: Any
  volSeries: Any
  folder: Folder | null
  /** Unsubscribe from the kline hub. */
  off: (() => void) | null
  ro: ResizeObserver | null
  token: number
  /** Indicator slot, 'c<pos>': the panel's cell in the layout. */
  slot: string
  /** Candles on the chart, kept for the panel's indicators. */
  candles: CandleFlat[]
  /** Bars on the chart: the candles, or range bars built from them. */
  shown: CandleFlat[]
  /** Range-bar size and the closed-candle key it was sized on. */
  rangeSize: number
  rangeKey: string
  ind: IndicatorRenderer | null
  indOff: (() => void) | null
  indTimer: ReturnType<typeof setTimeout> | null
  indAt: number
}

/** Live ticks redraw a panel's indicators at most this often. */
const IND_THROTTLE_MS = 1000

const STORE_KEY = 'lr-chartLayout'
const FALLBACK_SYMS = [
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'SUIUSDT',
  'TRXUSDT',
  'DOTUSDT',
  'LTCUSDT',
  'BCHUSDT',
  'NEARUSDT',
  'APTUSDT',
]

let layout = storedLayout()
/** Grid position of the main (active) chart. */
let active = 0
/** Last known setup of every position, so a cell comes back as it was. */
let saved: Array<CellCfg | null> = []
const panels: Panel[] = []
let idCounter = 0
let tokenCounter = 0

function storedLayout(): number {
  const s = storageGet<Any>(STORE_KEY, null)
  const n = s && typeof s === 'object' ? Number(s.n) : 1
  return LAYOUTS.some((l) => l.n === n) ? n : 1
}

function cleanCfg(p: Any): CellCfg | null {
  if (!p || typeof p.sym !== 'string' || !p.sym) return null
  return { sym: String(p.sym), tf: mdTf(p.tf), style: styleDef(p.style).id }
}

;(function restorePanels() {
  const s = storageGet<Any>(STORE_KEY, null)
  if (!s || typeof s !== 'object') return
  if (Array.isArray(s.cells)) {
    // { n, active, cells: [by grid position] }
    saved = s.cells.slice(0, MAX_CHARTS).map(cleanCfg)
    const a = Number(s.active)
    active = Number.isInteger(a) && a >= 0 && a < layout ? a : 0
  } else if (Array.isArray(s.panels)) {
    // Older shape: { n, panels: [cells 2..n] }, main chart always first.
    saved = [null as CellCfg | null].concat(s.panels.slice(0, MAX_CHARTS - 1).map(cleanCfg))
  }
})()

/** The active cell's setup, read live from the main chart. */
function mainCfg(): CellCfg {
  return { sym: String(state.symbol || ''), tf: getTimeframe(), style: getChartStyle() }
}

const panelAt = (pos: number) => panels.find((p) => p.pos === pos)

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persistSoon(): void {
  if (persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    persist()
  }, 0)
}

function persist(): void {
  panels.forEach((p) => {
    saved[p.pos] = { sym: p.sym, tf: p.tf, style: p.style }
  })
  saved[active] = mainCfg()
  storageSet(STORE_KEY, { n: layout, active, cells: saved })
}

export function getLayout(): number {
  return layout
}

/** Grid position of the chart the toolbar is driving. */
export function getActiveCell(): number {
  return active
}

type Listener = () => void
const listeners: Listener[] = []
export function subscribeLayout(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}

export function setLayout(n: number): void {
  const spec = layoutSpec(n)
  if (spec.n === layout) return
  layout = spec.n
  applyLayout()
  persist()
  emit()
}

let booted = false

/** Re-apply the current layout — also the entry point used on boot. */
export function applyLayout(): void {
  if (!booted) {
    booted = true
    // The app boots on its default coin; when the active chart is another
    // cell, that cell's coin is what the main chart was showing. This runs
    // before the engine's first load and stream connect, which then simply
    // use it — no second round of requests.
    const want = active > 0 && active < layout ? saved[active]?.sym : ''
    if (want && want !== state.symbol) {
      state.symbol = want
      const sel = $('symSelect') as HTMLSelectElement | null
      if (sel) {
        if (!sel.querySelector('option[value="' + want + '"]')) {
          const opt = document.createElement('option')
          opt.value = want
          opt.textContent = baseOf(want) + '/USDT'
          sel.appendChild(opt)
        }
        sel.value = want
      }
    }
    // Keep the stored active cell current as the toolbar changes it, so a
    // reload (or another device) comes back to the same charts.
    subscribeTimeframe(persistSoon)
    subscribeChartStyle(persistSoon)
    subscribeSymbol(persistSoon)
  }
  applyGrid()
  // Panel headers changed: the indicator buttons re-mount into them.
  emit()
}

function applyGrid(): void {
  const grid = $('chartLayout')
  const wrap = $('chartWrap')
  if (!grid || !wrap) return
  const spec = layoutSpec(layout)
  // The active chart is in a cell the new layout drops: hand the controls
  // back to the first cell before it goes.
  if (active >= spec.n) {
    if (panelAt(0)) activateCell(0)
    else active = 0
  }
  const rows = rowCount(spec)

  grid.style.gridTemplateColumns = 'repeat(' + spec.cols + ', minmax(0, 1fr))'
  grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))'
  grid.style.height = ''
  grid.style.minHeight = ''
  syncStageHeight()
  grid.classList.toggle('multi', spec.n > 1)

  for (let i = panels.length - 1; i >= 0; i--) if (panels[i].pos >= spec.n) destroyPanel(i)
  for (let pos = 0; pos < spec.n; pos++) if (pos !== active && !panelAt(pos)) addPanel(pos)
  placeCells()
  requestAnimationFrame(resizeAll)
}

/** Put every cell, the main chart included, at its grid position. */
function placeCells(): void {
  const wrap = $('chartWrap')
  if (!wrap) return
  const spec = layoutSpec(layout)
  const geom = cells(spec)
  wrap.style.order = String(active)
  wrap.style.gridColumn = 'span ' + (geom[active]?.span || 1)
  wrap.classList.toggle('is-active', spec.n > 1)
  panels.forEach((p) => {
    if (!p.el) return
    p.el.style.order = String(p.pos)
    p.el.style.gridColumn = 'span ' + (geom[p.pos]?.span || 1)
  })
}

/**
 * Make the chart at grid position `pos` the active one — the one the toolbar
 * drives. The main chart takes over that cell's coin, timeframe, style and
 * indicators and moves into its place; what the main chart was showing
 * becomes a companion in the cell it leaves. Drawings follow the coin
 * already, so they come along on their own.
 */
export function activateCell(pos: number): void {
  const p = panelAt(pos)
  if (!p || pos === active) return
  const from = active
  const incoming: CellCfg = { sym: p.sym, tf: p.tf, style: p.style }
  const mainSet = serializeIndicators(mainIndicatorStore.getIndicators())
  const cellSet = serializeIndicators(panelIndicatorStore(p.slot).getIndicators())

  destroyPanel(panels.indexOf(p))
  panelIndicatorStore('c' + pos).replace([])
  panelIndicatorStore('c' + from).replace(mainSet)
  saved[from] = mainCfg()
  active = pos
  // A layout shrinking past the active cell lands here: the cell it leaves
  // is about to be dropped, so don't build a chart only to destroy it.
  if (from < layout) addPanel(from)
  placeCells()

  mainIndicatorStore.replace(cellSet)
  if (incoming.style !== getChartStyle()) setChartStyle(incoming.style)
  // Coin and timeframe both changing: one load of the new pair, not a load
  // of the old coin at the new timeframe first (fast clicking queued those
  // behind each other and kept the old candles on screen).
  const symChange = !!incoming.sym && incoming.sym !== state.symbol
  if (incoming.tf !== getTimeframe()) setTimeframe(incoming.tf, { reload: !symChange })
  if (symChange) void setSymbol(incoming.sym, { keepTab: true })
  persist()
  emit()
}

function defaultFor(pos: number): CellCfg {
  const s = saved[pos]
  if (s) return s
  const n = FALLBACK_SYMS.length
  return { sym: FALLBACK_SYMS[(pos - 1 + n) % n], tf: getTimeframe(), style: getChartStyle() }
}

function addPanel(pos: number): void {
  const grid = $('chartLayout')
  if (!grid) return
  const seed = defaultFor(pos)
  const p: Panel = {
    id: idCounter++,
    pos,
    sym: seed.sym,
    tf: seed.tf,
    style: seed.style,
    el: null,
    chart: null,
    candleSeries: null,
    volSeries: null,
    folder: null,
    off: null,
    ro: null,
    token: 0,
    slot: 'c' + pos,
    candles: [],
    shown: [],
    rangeSize: 0,
    rangeKey: '',
    ind: null,
    indOff: null,
    indTimer: null,
    indAt: 0,
  }
  // No controls of its own: the toolbar drives whichever chart is active,
  // and clicking this one (or Enter/Space on it) makes it the active chart.
  const cell = document.createElement('div')
  cell.className = 'rc-cell'
  cell.tabIndex = 0
  cell.setAttribute('role', 'button')
  cell.innerHTML =
    '<div class="rc-head">' +
    '<span class="rc-title"></span>' +
    '<span class="rc-meta"></span>' +
    '</div>' +
    '<div class="rc-body"><div class="rc-legend">Loading…</div></div>'
  // DOM order follows grid position, so Tab moves through cells in the
  // order they are seen.
  const next = panels
    .filter((q) => q.pos > pos && q.el)
    .sort((a, b) => a.pos - b.pos)[0]
  grid.insertBefore(cell, next ? next.el : null)
  p.el = cell
  panels.push(p)
  // Panning or scaling a chart ends in a click too: only a press that stays
  // put picks the chart.
  let downX = 0
  let downY = 0
  cell.addEventListener('pointerdown', (e) => {
    downX = e.clientX
    downY = e.clientY
  })
  cell.addEventListener('click', (e) => {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return
    activateCell(p.pos)
  })
  cell.addEventListener('keydown', (e) => {
    if (e.target !== cell || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    activateCell(p.pos)
    // The focused cell is gone (it became the main chart): keep focus there.
    const wrap = $('chartWrap')
    if (wrap) {
      wrap.tabIndex = -1
      wrap.focus({ preventScroll: true })
    }
  })
  syncTitle(p)
  initChart(p)
}

function syncTitle(p: Panel): void {
  const name = baseOf(p.sym) + '/USDT'
  const tf = TIMEFRAMES.find((t) => t.id === p.tf)?.label || p.tf
  const el = p.el?.querySelector('.rc-title')
  if (el) el.textContent = coinMeta(p.sym).icon + ' ' + name
  const meta = p.el?.querySelector('.rc-meta')
  if (meta) meta.textContent = tf
  p.el?.setAttribute('aria-label', name + ' ' + tf + ' chart. Select to make it the active chart')
  p.el?.setAttribute('title', 'Click to make ' + name + ' ' + tf + ' the active chart')
}

function destroyPanel(i: number): void {
  const p = panels[i]
  if (!p) return
  p.token = -1
  closeWs(p)
  if (p.indOff) p.indOff()
  p.indOff = null
  if (p.indTimer) clearTimeout(p.indTimer)
  p.indTimer = null
  p.ind = null
  if (p.ro) p.ro.disconnect()
  if (p.chart) {
    try {
      p.chart.remove()
    } catch (e) {
      /* already gone */
    }
  }
  if (p.el) unmountCoinPickers(p.el)
  p.el?.remove()
  panels.splice(i, 1)
}

function closeWs(p: Panel): void {
  if (!p.off) return
  p.off()
  p.off = null
}

function initChart(p: Panel): void {
  const body = p.el?.querySelector('.rc-body') as HTMLElement | null
  if (!body) return
  const th = chartTheme()
  const chart: Any = LightweightCharts.createChart(body, {
    // Same reason as the main chart: let the library measure its own box so it
    // never writes inline sizes that outlive the layout that caused them.
    autoSize: true,
    layout: {
      background: { type: 'solid', color: th.bg },
      textColor: th.txt,
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
    },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.border },
    // Range bars are spaced by the second (see series/rangeBars), like the main chart.
    timeScale: {
      borderColor: th.border,
      timeVisible: true,
      secondsVisible: isRangeCell(p),
      rightOffset: 4,
    },
    crosshair: {
      mode: 0,
      vertLine: { color: th.pline, labelBackgroundColor: th.pline },
      horzLine: { color: th.pline, labelBackgroundColor: th.pline },
    },
    localization: { priceFormatter: (v: number) => pfmt(v) },
  } as Any)
  p.chart = chart
  // The same series the main chart builds for this style, so a cell keeps its
  // look whether or not it is the active one.
  p.candleSeries = createPriceSeries(chart, p.style)
  p.volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
  p.volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
  const store = panelIndicatorStore(p.slot)
  p.ind = createIndicatorRenderer(store.getIndicators, {
    // Candles and volume make room for the panes; with none, the panel looks
    // exactly as it did before it had indicators.
    priceLayout: (c: Any, bottom: number) => {
      c.priceScale('right').applyOptions({
        scaleMargins: bottom ? { top: 0.08, bottom: bottom + 0.1 } : { top: 0.2, bottom: 0.1 },
      })
      c.priceScale('vol').applyOptions({
        scaleMargins: bottom ? { top: 1 - bottom - 0.1, bottom } : { top: 0.85, bottom: 0 },
      })
    },
  })
  p.ind.attach(chart)
  p.indOff = store.subscribe(() => drawIndicators(p))
  const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
  chart.subscribeCrosshairMove((param: Any) => {
    if (!legend || !param.time || !param.seriesData) return
    const d = param.seriesData.get(p.candleSeries)
    if (!d) return
    if (d.open == null) {
      // Line, area and baseline carry the close alone.
      legend.innerHTML = '<span>C ' + pfmt(d.value) + '</span>'
      return
    }
    legend.innerHTML =
      '<span style="color:' +
      (d.close >= d.open ? 'var(--green)' : 'var(--red)') +
      '">O ' +
      pfmt(d.open) +
      ' H ' +
      pfmt(d.high) +
      ' L ' +
      pfmt(d.low) +
      ' C ' +
      pfmt(d.close) +
      '</span>'
  })
  p.ro = null
  reload(p)
}

function reload(p: Panel): void {
  const token = ++tokenCounter
  p.token = token
  closeWs(p)
  const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
  if (legend) legend.textContent = 'Loading…'
  loadCandles(p.sym, p.tf)
    .then(({ candles, folder }) => {
      // A later symbol/interval change, or a teardown, wins over this response.
      if (p.token !== token || !p.candleSeries) return
      p.folder = folder
      draw(p, candles)
      connect(p, token)
    })
    .catch((e) => {
      console.warn('companion load', e)
      if (p.token === token && legend) legend.textContent = 'Data unavailable'
    })
}

/** Redraw the panel's indicators over its candles, now. */
function drawIndicators(p: Panel): void {
  if (p.indTimer) clearTimeout(p.indTimer)
  p.indTimer = null
  p.indAt = Date.now()
  if (!p.ind || !p.chart) return
  try {
    // Over the bars on screen, so indicators share the price series' times.
    p.ind.render(p.shown)
  } catch (e) {
    console.warn('companion indicators', e)
  }
}

/** Live ticks: at most one indicator redraw per IND_THROTTLE_MS, trailing. */
function scheduleIndicators(p: Panel): void {
  if (!p.ind || p.indTimer || !panelIndicatorStore(p.slot).indicatorCount()) return
  const wait = Math.max(0, IND_THROTTLE_MS - (Date.now() - p.indAt))
  p.indTimer = setTimeout(() => drawIndicators(p), wait)
}

const isRangeCell = (p: Panel): boolean => !!styleDef(p.style).rangeBars

/**
 * What the panel draws: its candles, or for Range bars the bars built from
 * them. Sized like the main chart (rangeView): the coin's manual size, else
 * ATR(14) of the closed candles, never below the safe floor — and keyed on
 * the closed candles so the size holds still while the live one ticks.
 */
function barsFor(p: Panel): CandleFlat[] {
  const src = p.candles
  if (!isRangeCell(p) || !src.length) return src
  const n = src.length
  const manual = manualRangeFor(p.sym)
  const key = [p.sym, n, src[0].t, n > 1 ? src[n - 2].t : 0, manual ?? 'a'].join('|')
  if (key !== p.rangeKey) {
    p.rangeKey = key
    p.rangeSize = Math.max(manual ?? autoRangeSize(src), minSafeRange(src))
  }
  return buildStyleBars(p.style, src, p.rangeSize)
}

const volBar = (c: CandleFlat): Any => ({
  time: Math.floor(c.t / 1000),
  value: c.v,
  color: c.c >= c.o ? 'rgba(0,230,118,.35)' : 'rgba(255,23,68,.35)',
})

const sameBar = (a: CandleFlat, b: CandleFlat): boolean =>
  a.t === b.t && a.o === b.o && a.h === b.h && a.l === b.l && a.c === b.c

/**
 * A live tick on range bars: it can extend the last bar, close it and open
 * new ones, or reshape earlier ones. update() only reaches the last bar, so
 * anything deeper is a setData with the view kept (as chartRender does).
 */
function pushRangeBars(p: Panel): void {
  const next = barsFor(p)
  const prev = p.shown
  let k = Math.max(0, prev.length - 64)
  while (k < prev.length && k < next.length && sameBar(prev[k], next[k])) k++
  const tailOnly =
    prev.length > 0 &&
    next.length >= prev.length &&
    k >= prev.length - 1 &&
    (k === prev.length || next[k].t === prev[k].t)
  if (tailOnly) {
    for (let i = Math.max(k, prev.length - 1); i < next.length; i++) {
      p.candleSeries.update(priceSeriesPoint(p.style, next[i]))
      p.volSeries.update(volBar(next[i]))
    }
  } else {
    const ts = p.chart.timeScale()
    const keep = ts.getVisibleLogicalRange()
    p.candleSeries.setData(priceSeriesData(p.style, next))
    p.volSeries.setData(next.map(volBar))
    if (keep) ts.setVisibleLogicalRange(keep)
  }
  p.shown = next
}

function draw(p: Panel, candles: CandleFlat[]): void {
  p.candles = candles.slice()
  p.shown = barsFor(p)
  // Baseline is coloured around the first close, as on the main chart.
  if (p.style === 'baseline' && candles.length)
    p.candleSeries.applyOptions({ baseValue: { type: 'price', price: candles[0].c } })
  p.candleSeries.setData(priceSeriesData(p.style, p.shown))
  p.volSeries.setData(p.shown.map(volBar))
  drawIndicators(p)
  p.chart.timeScale().fitContent()
  const last = candles[candles.length - 1]
  const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
  if (legend && last)
    legend.innerHTML =
      '<span style="color:' +
      (last.c >= last.o ? 'var(--green)' : 'var(--red)') +
      '">' +
      pfmt(last.c) +
      '</span>'
}

function connect(p: Panel, token: number): void {
  // Its candles come from loadCandles and so work for any instrument, but
  // there is no Binance socket for one — the panel stays on its REST snapshot
  // instead of retrying a stream that can never open.
  if (isInstrument(p.sym)) return
  const def = tfDef(p.tf)
  closeWs(p)
  try {
    // The hub reconnects and re-subscribes on its own.
    p.off = klineHub.subscribe(String(mdSym(p.sym)), def.base, (d: Any) => {
      if (p.token !== token || !p.candleSeries) return
      const k = d.k
      if (!k) return
      const raw: CandleFlat = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
      if (!isFinite(raw.c) || raw.c <= 0) return
      const c = p.folder ? p.folder.push(raw) : raw
      const arr = p.candles
      const lastT = arr.length ? arr[arr.length - 1].t : -Infinity
      if (c.t === lastT) arr[arr.length - 1] = c
      else if (c.t > lastT) {
        arr.push(c)
        if (arr.length > 1500) arr.shift()
      }
      if (isRangeCell(p)) pushRangeBars(p)
      else {
        p.shown = arr
        p.candleSeries.update(priceSeriesPoint(p.style, c))
        p.volSeries.update(volBar(c))
      }
      scheduleIndicators(p)
      const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
      if (legend)
        legend.innerHTML =
          '<span style="color:' +
          (c.c >= c.o ? 'var(--green)' : 'var(--red)') +
          '">' +
          pfmt(c.c) +
          '</span>'
    })
  } catch (e) {
    /* stream cap reached: the panel keeps its REST snapshot */
  }
}

/** Companions size themselves via autoSize; kept so callers have one entry point. */
export function resizeAll(): void {
  panels.forEach((p) => p.chart?.timeScale().fitContent())
}

/**
 * Publish the chart area's height as a concrete pixel value on the stage.
 *
 * Doing the arithmetic here rather than in CSS keeps one rule in one place:
 * the grid and the side panel both read `--stage-h`, so they can never
 * disagree, and there is no cascade to lose. Full screen opts out — flex
 * already gives the stage a definite height there.
 */
export function syncStageHeight(): void {
  const grid = $('chartLayout')
  const stage = grid?.parentElement
  if (!grid || !stage) return
  if (document.documentElement.classList.contains('radar-fs')) {
    stage.style.removeProperty('--stage-h')
    return
  }
  const rows = rowCount(layoutSpec(layout))
  const ch =
    parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ch'), 10) || 400
  const base = rows > 1 ? Math.max(ch, rows * 175) : ch
  // Stacked on a narrow screen, or with no panel out, the chart keeps its own
  // height; side by side it grows so the panel has somewhere to live.
  const stacked = window.matchMedia('(max-width:900px) and (orientation:portrait)').matches
  const sideOpen = stage.classList.contains('side-open')
  const h =
    stacked || !sideOpen
      ? base
      : Math.max(base, Math.min(720, Math.round(window.innerHeight * 0.8)))
  stage.style.setProperty('--stage-h', h + 'px')
}

let stageWatch = false
export function watchStageHeight(): void {
  if (stageWatch) return
  stageWatch = true
  window.addEventListener('resize', syncStageHeight)
}

/** Re-theme companions when the palette or light/dark mode changes. */
export function applyCompanionTheme(): void {
  const th = chartTheme()
  panels.forEach((p) => {
    if (!p.chart) return
    p.chart.applyOptions({
      layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border },
    })
    if (p.candleSeries) themePriceSeries(p.candleSeries, p.style)
    p.ind?.refreshColors()
  })
}
