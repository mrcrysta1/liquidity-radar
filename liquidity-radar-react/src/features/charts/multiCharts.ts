// Multi-chart workspace (Charts tab). The classic-script globals
// (mcAdd/mcRemove/mcChange*) are re-exposed on window by the engine.
//
// The panel chrome (grid, headers, coin pickers, the Add tile) is React:
// components/chart/MultiChartGrid renders it from mcSnapshot(). Everything
// behind it lives here: each panel's LightweightCharts instance (created in
// the body element the grid hands over via mcAttachBody, disposed by
// mcDetachBody), its data, its kline hub subscription and its indicators.
//
// Each panel carries its own indicator set (indicators/panelStore, slot
// 'mc<position>'), drawn by its own renderer over its own candles; the
// header's indicators button is a React portal (PanelIndicatorButtons).
import * as LightweightCharts from 'lightweight-charts'
import { createZonedChart } from './zonedTimeScale'
import { poll } from '../../services/pollScheduler'
import { pfmt } from '../../utils/format'
import { state } from '../../services/store'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { chartTheme, mapCandle } from './chartRender'
import { chartTzOptions, isDailyTf } from './timezone'
import { chartPalette, withAlpha } from './chartPalette'
import {
  mdCacheGet,
  mdCachePut,
  mdDebug,
  mdFromK,
  mdHearbeat,
  mdSym,
  mdTf,
  mdVal,
} from '../../services/market'
import { fetchKlineRows, klineHub } from '../../services/failover'
import { isInstrument } from '../../constants/instruments'
import { createIndicatorRenderer } from './indicators/render'
import type { IndicatorRenderer } from './indicators/render'
import { panelIndicatorStore, prunePanelSlots, shiftPanelSlots } from './indicators/panelStore'
import { parseMcPanels } from './savedLayoutsMath'

type Any = any

interface McPanel {
  id: number
  sym: string
  interval: string
  chart: Any
  candleSeries: Any
  volSeries: Any
  rsiSeries?: Any
  ws: Any
  candles: Any[]
  ind?: IndicatorRenderer | null
  indOff?: (() => void) | null
  indTimer?: ReturnType<typeof setTimeout> | null
  indAt?: number
  /** The chart body element the grid handed over (null while unmounted). */
  el?: HTMLElement | null
  ro?: ResizeObserver | null
  [key: string]: Any
}

/** Live ticks redraw a panel's indicators at most this often. */
const IND_THROTTLE_MS = 1000
const slotOf = (p: McPanel) => 'mc' + mcPanels.indexOf(p)

export const MC_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
let mcPanels: McPanel[] = []
let mcIdCounter = 0
const MAX_PANELS = 8

// The React workspace (header, grid, panel indicator buttons) follows these.
type Listener = () => void
const listeners: Listener[] = []
const emit = () => listeners.slice().forEach((fn) => fn())
export function onMcChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
export const mcCount = () => mcPanels.length
export const mcCanAdd = () => mcPanels.length < MAX_PANELS

/** Columns in the workspace grid (2-4); the stylesheet caps it on small screens. */
const COLS_KEY = 'lr-mc-cols'
export function mcColumns(): number {
  const n = Number(storageGetRaw(COLS_KEY))
  return n >= 2 && n <= 4 ? n : 4
}
export function mcSetColumns(n: number): void {
  storageSetRaw(COLS_KEY, String(n))
  changed()
}

/**
 * Each panel's coin and interval, in order, so the workspace reopens as it
 * was left. Missing or bad entries fall back to the four majors on the hour.
 */
const PANELS_KEY = 'lr-mc-panels-v1'
const DEFAULT_PANELS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'].map((sym) => ({ sym, interval: '1h' }))
function storedPanels(): Array<{ sym: string; interval: string }> {
  let raw: unknown = null
  try {
    raw = JSON.parse(storageGetRaw(PANELS_KEY) || 'null')
  } catch (e) {
    /* corrupt: defaults */
  }
  return parseMcPanels(raw, DEFAULT_PANELS, MC_INTERVALS, MAX_PANELS)
}
function persistPanels(): void {
  const v = JSON.stringify(mcPanels.map((p) => ({ sym: p.sym, interval: p.interval })))
  // Only real changes: every write is also a settings sync for signed-in users.
  if (storageGetRaw(PANELS_KEY) !== v) storageSetRaw(PANELS_KEY, v)
}

/** What the grid renders: one entry per panel, in order. */
export interface McPanelView {
  id: number
  sym: string
  interval: string
}
export interface McSnapshot {
  /** False until initMultiCharts has opened the workspace. */
  ready: boolean
  cols: number
  canAdd: boolean
  panels: readonly McPanelView[]
}
let ready = false
let snap: McSnapshot = { ready: false, cols: mcColumns(), canAdd: true, panels: [] }

/** The grid's state (a new object only when something changed). */
export const mcSnapshot = (): McSnapshot => snap

/** Panel list, a symbol, an interval or the columns changed: new snapshot, tell listeners. */
function changed(): void {
  if (ready) persistPanels()
  snap = {
    ready,
    cols: mcColumns(),
    canAdd: mcCanAdd(),
    panels: mcPanels.map((p) => ({ id: p.id, sym: p.sym, interval: p.interval })),
  }
  emit()
}

/**
 * The grid committed a render. Listeners that read the grid's DOM (the panel
 * indicator buttons look for `[data-ind-slot]`) rescan now that it is there.
 */
export function mcGridRendered(): void {
  emit()
}

export function initMultiCharts(): void {
  mcPanels.forEach(mcTearDown)
  mcPanels = []
  // The panels as they were left (else four majors on the hour).
  storedPanels().forEach((c) => {
    mcPanels.push(blankPanel(c.sym, c.interval))
  })
  // Indicator sets saved for panels beyond these belong to charts that are gone.
  prunePanelSlots('mc', mcPanels.length)
  ready = true
  changed() // the grid mounts the panels; each body creates its chart
  poll(mcRefreshAll, 15000)
}

function blankPanel(sym: string, interval: string): McPanel {
  return { id: mcIdCounter++, sym, interval, chart: null, candleSeries: null, volSeries: null, ws: null, candles: [] }
}

/** Wilder RSI(14) for every candle that has enough history. */
function rsiPoints(candles: Any[], period = 14): Array<{ time: number; value: number }> {
  const out: Array<{ time: number; value: number }> = []
  if (candles.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = candles[i].c - candles[i - 1].c
    if (d > 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c
    gain = (gain * (period - 1) + Math.max(0, d)) / period
    loss = (loss * (period - 1) + Math.max(0, -d)) / period
    const rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
    out.push({ time: Math.floor(candles[i].t / 1000), value: rsi })
  }
  return out
}

/** Price, change and RSI readout in the panel header. */
function mcPaintHead(p: McPanel): void {
  const px = document.getElementById('mcPx' + p.id)
  const last = p.candles[p.candles.length - 1]
  if (px && last) {
    const t = state.tickers[p.sym] as { pct?: number } | undefined
    const first = p.candles[0]
    const chg = t && typeof t.pct === 'number' ? t.pct : first ? ((last.c - first.c) / first.c) * 100 : 0
    px.innerHTML =
      '<b>' + pfmt(last.c) + '</b><i class="' + (chg >= 0 ? 'up' : 'dn') + '">' + (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%</i>'
  }
  const rsiEl = document.getElementById('mcRsiV' + p.id)
  const pts = rsiPoints(p.candles)
  if (rsiEl && pts.length) rsiEl.textContent = pts[pts.length - 1].value.toFixed(1)
}

/** Stop following the panel's indicator set (its chart is going away). */
function mcDropIndicators(p: McPanel): void {
  if (p.indOff) p.indOff()
  p.indOff = null
  if (p.indTimer) clearTimeout(p.indTimer)
  p.indTimer = null
  p.ind = null
}

/** Redraw the panel's indicators over its candles, now. */
function mcDrawIndicators(p: McPanel): void {
  if (p.indTimer) clearTimeout(p.indTimer)
  p.indTimer = null
  p.indAt = Date.now()
  if (!p.ind || !p.chart) return
  try {
    p.ind.render(p.candles)
  } catch (e) {
    console.warn('mc indicators', e)
  }
}

/** Live ticks: at most one indicator redraw per IND_THROTTLE_MS, trailing. */
function mcScheduleIndicators(p: McPanel): void {
  if (!p.ind || p.indTimer || mcPanels.indexOf(p) === -1) return
  if (!panelIndicatorStore(slotOf(p)).indicatorCount()) return
  const wait = Math.max(0, IND_THROTTLE_MS - (Date.now() - (p.indAt || 0)))
  p.indTimer = setTimeout(() => mcDrawIndicators(p), wait)
}

/** Volume bars in the palette's up/down colours, faint, as on the main chart. */
function mcVolColor(up: boolean): string {
  const pal = chartPalette()
  return withAlpha(up ? pal.up : pal.dn, 0.3)
}

function mcSetAll(p: McPanel): void {
  if (!p.candleSeries) return
  p.candleSeries.setData(p.candles.map(mapCandle))
  p.volSeries.setData(
    p.candles.map(function (c) {
      return { time: Math.floor(c.t / 1000), value: c.v, color: mcVolColor(c.c >= c.o) }
    }),
  )
  p.rsiSeries?.setData(rsiPoints(p.candles))
  mcDrawIndicators(p)
  mcPaintHead(p)
}

function mcUpdateLast(p: McPanel, c: Any): void {
  if (!p.candleSeries) return
  p.candleSeries.update(mapCandle(c))
  p.volSeries.update({ time: Math.floor(c.t / 1000), value: c.v, color: mcVolColor(c.c >= c.o) })
  const pts = rsiPoints(p.candles.slice(-60))
  if (pts.length) p.rsiSeries?.update(pts[pts.length - 1])
  mcScheduleIndicators(p)
  mcPaintHead(p)
}

export function mcAdd(sym: string, interval: string): void {
  if (!mcCanAdd()) return
  mcPanels.push(blankPanel(sym || 'BTCUSDT', interval || '1h'))
  changed() // the grid mounts the new panel; its body creates the chart and loads data
}

export function mcRemove(id: number): void {
  const idx = mcPanels.findIndex((p) => p.id === id)
  if (idx === -1) return
  // The panels after it move up a place, and their indicators with them.
  shiftPanelSlots('mc', idx, mcPanels.length)
  mcTearDown(mcPanels[idx])
  mcPanels.splice(idx, 1)
  // Their charts stay; only their indicator renderers follow the new slots.
  mcPanels.slice(idx).forEach(mcBindIndicators)
  changed()
}

/** Close the panel's kline subscription. */
function mcCloseWS(p: McPanel): void {
  if (!p.ws) return
  p.ws._dead = true
  try {
    p.ws.close()
  } catch (e) {
    /* ignore */
  }
}

/**
 * Dispose the panel's chart. LightweightCharts instances aren't tied to DOM
 * removal: each keeps its own ResizeObserver, RAF loop and listeners alive
 * until chart.remove(). So every chart whose host goes away comes through
 * here (the old innerHTML grid once leaked a zombie chart per panel on every
 * rebuild this way).
 */
function mcDisposeChart(p: McPanel): void {
  mcDropIndicators(p)
  p.ro?.disconnect()
  p.ro = null
  if (p.chart) {
    try {
      p.chart.remove()
    } catch (e) {
      /* already detached */
    }
  }
  p.chart = null
  p.candleSeries = null
  p.volSeries = null
  p.rsiSeries = null
}

/** A panel is going away for good: chart and socket. */
function mcTearDown(p: McPanel): void {
  mcDisposeChart(p)
  mcCloseWS(p)
  p.el = null
}

/** The grid mounted panel `id`'s chart body: build its chart there. */
export function mcAttachBody(id: number, el: HTMLElement): void {
  const p = mcPanels.find((x) => x.id === id)
  if (!p) return
  if (p.el === el && p.chart) return
  mcDisposeChart(p)
  p.el = el
  mcInitChart(p)
}

/** The grid unmounted panel `id`'s chart body: dispose its chart, keep its data. */
export function mcDetachBody(id: number, el: HTMLElement): void {
  const p = mcPanels.find((x) => x.id === id)
  if (!p || p.el !== el) return
  mcDisposeChart(p)
  p.el = null
}

function mcInitChart(p: McPanel): void {
  const el = p.el
  if (!el) return
  const legEl = document.getElementById('mcLeg' + p.id)
  // The readouts are written here, not by React; a fresh chart starts them blank.
  if (legEl) legEl.innerHTML = ''
  const pxEl = document.getElementById('mcPx' + p.id)
  if (pxEl) pxEl.textContent = '…'
  const rsiEl = document.getElementById('mcRsiV' + p.id)
  if (rsiEl) rsiEl.textContent = '—'
  const w = el.clientWidth,
    h = el.clientHeight || 260
  const th = chartTheme()
  // Times print in the chart zone (./timezone); the bars stay in UTC.
  const tz = chartTzOptions(() => isDailyTf(p.interval))
  const c: Any = createZonedChart(LightweightCharts, el, () => isDailyTf(p.interval), {
    width: w,
    height: h,
    localization: tz.localization,
    layout: {
      background: { type: 'solid', color: th.bg },
      textColor: th.txt,
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
    },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.border },
    timeScale: {
      ...tz.timeScale,
      borderColor: th.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 4,
    },
    crosshair: {
      mode: 0,
      vertLine: { color: th.pline, labelBackgroundColor: th.pline },
      horzLine: { color: th.pline, labelBackgroundColor: th.pline },
    },
  } as Any)
  const cs = c.addCandlestickSeries({
    upColor: th.up,
    downColor: th.dn,
    borderVisible: false,
    wickUpColor: th.up,
    wickDownColor: th.dn,
  })
  cs.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.36 } })
  const vs = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
  vs.priceScale().applyOptions({ scaleMargins: { top: 0.66, bottom: 0.22 } })
  const rs = c.addLineSeries({
    color: '#A78BFA',
    lineWidth: 1,
    priceScaleId: 'rsi',
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
  })
  rs.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0.02 }, visible: false })
  c.subscribeCrosshairMove(function (param: Any) {
    if (!param.time || !param.seriesData || !legEl) return
    const d = param.seriesData.get(cs)
    if (d) {
      const up = d.close >= d.open
      legEl.innerHTML =
        '<span style="color:' +
        (up ? 'var(--green)' : 'var(--red)') +
        '">O:' +
        pfmt(d.open) +
        ' H:' +
        pfmt(d.high) +
        ' L:' +
        pfmt(d.low) +
        ' C:' +
        pfmt(d.close) +
        '</span>'
    }
  })
  // Panels are built while the Charts tab may be hidden (zero width), which
  // fits the candles to nothing and leaves them crammed at the right edge
  // once it opens. Re-fit the first time the panel gets a real width.
  let fitW = el.clientWidth
  const ro = new ResizeObserver(function () {
    if (!c || !el.clientWidth) return
    c.applyOptions({ width: el.clientWidth, height: el.clientHeight || 260 })
    if (fitW < 60 && el.clientWidth >= 60 && p.candles.length) c.timeScale().fitContent()
    fitW = el.clientWidth
  })
  ro.observe(el)
  p.ro = ro
  p.chart = c
  p.candleSeries = cs
  p.volSeries = vs
  p.rsiSeries = rs
  mcBindIndicators(p)
  // A chart rebuilt for an existing panel (its body remounted) keeps the
  // panel's data and socket; only a fresh panel, or a new symbol/interval,
  // goes back to the network.
  if (p.candles.length) {
    mcSetAll(p)
    if (!p.ws || p.ws._dead) mcConnectWS(p)
  } else mcLoadData(p)
}

/**
 * Draw the panel's own indicators from its slot's store ('mc<position>').
 * Called when its chart is built, and again when a panel before it is removed
 * and it moves up a slot. With panes open, candles and volume move up over
 * them and the built-in RSI strip steps aside; with none, the panel looks
 * exactly as it always has.
 */
function mcBindIndicators(p: McPanel): void {
  if (p.ind) p.ind.clear()
  mcDropIndicators(p)
  const c = p.chart
  const cs = p.candleSeries
  const vs = p.volSeries
  const rs = p.rsiSeries
  if (!c || !cs || !vs || !rs) return
  const priceLayout = (_c: Any, bottom: number) => {
    cs.priceScale().applyOptions({
      scaleMargins: bottom ? { top: 0.06, bottom: bottom + 0.22 } : { top: 0.06, bottom: 0.36 },
    })
    vs.priceScale().applyOptions({
      scaleMargins: bottom
        ? { top: 1 - bottom - 0.2, bottom: bottom + 0.04 }
        : { top: 0.66, bottom: 0.22 },
    })
    rs.applyOptions({ visible: !bottom })
  }
  priceLayout(c, 0)
  const store = panelIndicatorStore(slotOf(p))
  const ind = createIndicatorRenderer(store.getIndicators, { priceLayout })
  ind.attach(c)
  p.ind = ind
  p.indOff = store.subscribe(() => mcDrawIndicators(p))
  if (p.candles.length) mcDrawIndicators(p)
}

function mcLoadData(p: McPanel): void {
  const sym = mdSym(p.sym) as string,
    iv = mdTf(p.interval)
  // A newer symbol or interval (or the panel's removal) supersedes this request.
  const stale = () => mcPanels.indexOf(p) === -1 || mdSym(p.sym) !== sym || mdTf(p.interval) !== iv
  fetchKlineRows(sym, iv, 120)
    .then(function (data: Any) {
      if (stale()) return
      const candles = data.map(mdFromK).filter(Boolean)
      p.candles = candles
      mdCachePut(sym, iv, candles)
      if (p.candleSeries) {
        mcSetAll(p)
        p.chart.timeScale().fitContent()
      }
      mcConnectWS(p)
    })
    .catch(function (e) {
      if (stale()) return
      console.warn('mc load', e)
      const cached = mdCacheGet(sym, iv)
      if (cached && cached.length && p.candleSeries) {
        p.candles = cached
        mcSetAll(p)
      }
      mcConnectWS(p)
    })
}

function mcConnectWS(p: McPanel): void {
  if (p.ws && p.ws._dead === false) mcCloseWS(p)
  const s = mdSym(p.sym) as string
  const iv = mdTf(p.interval)
  // Instruments (gold, FX...) have no spot kline stream; one bad stream name
  // would break the shared socket for every other panel.
  if (isInstrument(s)) return
  // Every workspace panel rides the one shared kline hub socket, which owns
  // reconnects and re-subscription. `p.ws` stays a socket-shaped handle
  // (`_dead`, `close()`) so the call sites that tear panels down are unchanged.
  try {
    const handle: Any = { _dead: false, off: null as null | (() => void) }
    handle.close = function () {
      handle._dead = true
      if (handle.off) handle.off()
      handle.off = null
    }
    p.ws = handle
    handle.off = klineHub.subscribe(s, iv, function (d: Any) {
      if (handle._dead) return
      try {
        const k = d.k
        const c = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
        if (!mdVal.candle(c)) return
        mdHearbeat('ws')
        const arr = p.candles
        if (arr.length && arr[arr.length - 1].t === c.t) arr[arr.length - 1] = c
        else if (arr.length && c.t > arr[arr.length - 1].t) {
          arr.push(c)
          if (arr.length > 200) arr.shift()
        } else return
        mcUpdateLast(p, c)
      } catch (e) {
        mdDebug.log('ws', 'mc handler', e)
      }
    })
  } catch (e) {
    mdDebug.log('ws', 'mc create', e)
  }
}

export function mcChangeInterval(id: number, iv: string): void {
  const p = mcPanels.find(function (x) {
    return x.id === id
  })
  if (!p) return
  p.interval = iv
  mcCloseWS(p)
  mcLoadData(p)
  changed()
}

export function mcChangeSymbol(id: number, sym: string): void {
  const p = mcPanels.find(function (x) {
    return x.id === id
  })
  if (!p) return
  p.sym = sym
  p.candles = []
  mcCloseWS(p)
  // A fresh chart for this panel only (it loads the new symbol's data);
  // every other panel keeps its chart.
  if (p.el) {
    mcDisposeChart(p)
    mcInitChart(p)
  }
  changed()
}

function mcRefreshAll(): void {
  mcPanels.forEach(function (p) {
    if (p.candles.length > 0) {
      const sym = mdSym(p.sym) as string,
        iv = mdTf(p.interval)
      fetchKlineRows(sym, iv, 5)
        .then(function (data: Any) {
          // The panel's coin or interval changed (or it was removed) while
          // this was in flight: the bar belongs to another series.
          if (mcPanels.indexOf(p) === -1 || mdSym(p.sym) !== sym || mdTf(p.interval) !== iv) return
          if (data && data.length) {
            const c = mdFromK(data[data.length - 1])
            if (!c || !mdVal.candle(c)) return
            const arr = p.candles
            if (arr.length && arr[arr.length - 1].t === c.t) arr[arr.length - 1] = c
            else if (arr.length && c.t > arr[arr.length - 1].t) {
              arr.push(c)
              if (arr.length > 200) arr.shift()
            } else return // older than the live bar (or no data yet): nothing to draw
            mcUpdateLast(p, c)
          }
        })
        .catch(function () {
          /* ignore */
        })
    }
  })
}

export function mcApplyTheme(): void {
  mcPanels.forEach(function (p) {
    if (p.chart) {
      const th = chartTheme()
      const tz = chartTzOptions(() => isDailyTf(p.interval))
      p.chart.applyOptions({
        localization: tz.localization,
        layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt },
        grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
        rightPriceScale: { borderColor: th.border },
        timeScale: { ...tz.timeScale, borderColor: th.border },
      })
      if (p.candleSeries)
        p.candleSeries.applyOptions({
          upColor: th.up,
          downColor: th.dn,
          wickUpColor: th.up,
          wickDownColor: th.dn,
        })
      if (p.volSeries) p.volSeries.applyOptions({})
      p.ind?.refreshColors()
    }
  })
}
