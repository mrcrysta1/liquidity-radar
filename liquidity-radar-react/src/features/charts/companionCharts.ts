// Companion charts for the price-action multi-chart layouts.
//
// Cell 1 of the grid is the main chart (#chartWrap) and is left alone. This
// module owns cells 2..n: it builds them into #chartLayout, gives each its own
// symbol/interval selects, REST load and kline socket, and tears them down
// again when the layout shrinks. Chart plumbing mirrors multiCharts.ts; candle
// loading goes through the shared resampling loader so companions support the
// same intervals as the main chart.
import * as LightweightCharts from 'lightweight-charts'
import { isInstrument } from '../../constants/instruments'
import { COINS } from '../../constants/market'
import { baseOf, coinMeta } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { $ } from '../../utils/dom'
import { chartTheme, mapCandle } from './chartRender'
import { LAYOUTS, MAX_CHARTS, cells, layoutSpec, rowCount } from './layouts'
import { loadCandles } from '../../services/marketData'
import { mdSym, mdTf } from '../../services/market'
import type { CandleFlat } from '../../services/market'
import { TIMEFRAMES, tfDef } from '../../services/timeframe'
import type { Folder } from '../../services/timeframe'
import { storageGet, storageSet } from '../../services/storage'
import { getTimeframe } from './timeframes'

type Any = any

interface Panel {
  id: number
  sym: string
  tf: string
  el: HTMLElement | null
  chart: Any
  candleSeries: Any
  volSeries: Any
  folder: Folder | null
  ws: Any
  ro: ResizeObserver | null
  token: number
}

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
let saved: Array<{ sym: string; tf: string }> = []
const panels: Panel[] = []
let idCounter = 0
let tokenCounter = 0

function storedLayout(): number {
  const s = storageGet<Any>(STORE_KEY, null)
  const n = s && typeof s === 'object' ? Number(s.n) : 1
  return LAYOUTS.some((l) => l.n === n) ? n : 1
}

;(function restorePanels() {
  const s = storageGet<Any>(STORE_KEY, null)
  const list = s && Array.isArray(s.panels) ? s.panels : []
  saved = list
    .filter((p: Any) => p && typeof p.sym === 'string')
    .slice(0, MAX_CHARTS)
    .map((p: Any) => ({ sym: String(p.sym), tf: mdTf(p.tf) }))
})()

function persist(): void {
  storageSet(STORE_KEY, {
    n: layout,
    panels: panels.map((p) => ({ sym: p.sym, tf: p.tf })),
  })
}

export function getLayout(): number {
  return layout
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

/** Re-apply the current layout — also the entry point used on boot. */
export function applyLayout(): void {
  const grid = $('chartLayout')
  const wrap = $('chartWrap')
  if (!grid || !wrap) return
  const spec = layoutSpec(layout)
  const rows = rowCount(spec)
  const geom = cells(spec)

  grid.style.gridTemplateColumns = 'repeat(' + spec.cols + ', minmax(0, 1fr))'
  grid.style.gridTemplateRows = 'repeat(' + rows + ', minmax(0, 1fr))'
  grid.style.height = ''
  grid.style.minHeight = ''
  syncStageHeight()
  grid.classList.toggle('multi', spec.n > 1)
  wrap.style.gridColumn = 'span ' + geom[0].span

  while (panels.length > spec.n - 1) destroyPanel(panels.length - 1)
  for (let i = panels.length; i < spec.n - 1; i++) addPanel(i)
  panels.forEach((p, i) => {
    const g = geom[i + 1]
    if (p.el && g) p.el.style.gridColumn = 'span ' + g.span
  })
  requestAnimationFrame(resizeAll)
}

function defaultFor(i: number): { sym: string; tf: string } {
  if (saved[i]) return saved[i]
  return { sym: FALLBACK_SYMS[i % FALLBACK_SYMS.length], tf: getTimeframe() }
}

function addPanel(i: number): void {
  const grid = $('chartLayout')
  if (!grid) return
  const seed = defaultFor(i)
  const p: Panel = {
    id: idCounter++,
    sym: seed.sym,
    tf: seed.tf,
    el: null,
    chart: null,
    candleSeries: null,
    volSeries: null,
    folder: null,
    ws: null,
    ro: null,
    token: 0,
  }
  const cell = document.createElement('div')
  cell.className = 'rc-cell'
  cell.innerHTML =
    '<div class="rc-head">' +
    '<span class="rc-title"></span>' +
    '<div class="rc-controls">' +
    '<select class="rc-sym" aria-label="Chart symbol">' +
    Object.keys(COINS)
      .map((k) => '<option value="' + COINS[k].sym + '">' + k + '</option>')
      .join('') +
    '</select>' +
    '<select class="rc-tf" aria-label="Chart timeframe">' +
    TIMEFRAMES.map((t) => '<option value="' + t.id + '">' + t.label + '</option>').join('') +
    '</select>' +
    '</div></div>' +
    '<div class="rc-body"><div class="rc-legend">Loading…</div></div>'
  grid.appendChild(cell)
  p.el = cell
  panels.push(p)

  const symSel = cell.querySelector('.rc-sym') as HTMLSelectElement
  const tfSel = cell.querySelector('.rc-tf') as HTMLSelectElement
  symSel.value = p.sym
  tfSel.value = p.tf
  symSel.addEventListener('change', () => {
    p.sym = symSel.value
    syncTitle(p)
    reload(p)
    persist()
  })
  tfSel.addEventListener('change', () => {
    p.tf = tfSel.value
    reload(p)
    persist()
  })
  syncTitle(p)
  initChart(p)
}

function syncTitle(p: Panel): void {
  const el = p.el?.querySelector('.rc-title')
  if (el) el.textContent = coinMeta(p.sym).icon + ' ' + baseOf(p.sym) + '/USDT'
}

function destroyPanel(i: number): void {
  const p = panels[i]
  if (!p) return
  p.token = -1
  closeWs(p)
  if (p.ro) p.ro.disconnect()
  if (p.chart) {
    try {
      p.chart.remove()
    } catch (e) {
      /* already gone */
    }
  }
  p.el?.remove()
  panels.splice(i, 1)
}

function closeWs(p: Panel): void {
  if (!p.ws) return
  p.ws._dead = true
  try {
    p.ws.close()
  } catch (e) {
    /* ignore */
  }
  p.ws = null
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
    timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: {
      mode: 0,
      vertLine: { color: th.pline, labelBackgroundColor: th.pline },
      horzLine: { color: th.pline, labelBackgroundColor: th.pline },
    },
    localization: { priceFormatter: (v: number) => pfmt(v) },
  } as Any)
  p.chart = chart
  p.candleSeries = chart.addCandlestickSeries({
    upColor: th.up,
    downColor: th.dn,
    borderVisible: false,
    wickUpColor: th.up,
    wickDownColor: th.dn,
  })
  p.volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' })
  p.volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
  const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
  chart.subscribeCrosshairMove((param: Any) => {
    if (!legend || !param.time || !param.seriesData) return
    const d = param.seriesData.get(p.candleSeries)
    if (!d) return
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

function draw(p: Panel, candles: CandleFlat[]): void {
  p.candleSeries.setData(candles.map(mapCandle))
  p.volSeries.setData(
    candles.map((c) => ({
      time: Math.floor(c.t / 1000),
      value: c.v,
      color: c.c >= c.o ? 'rgba(0,230,118,.35)' : 'rgba(255,23,68,.35)',
    })),
  )
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
  const url =
    'wss://stream.binance.com:9443/ws/' + String(mdSym(p.sym)).toLowerCase() + '@kline_' + def.base
  let ws: Any
  try {
    ws = new WebSocket(url)
  } catch (e) {
    return
  }
  ws._dead = false
  p.ws = ws
  ws.onmessage = (ev: Any) => {
    if (ws._dead || p.token !== token || !p.candleSeries) return
    let k: Any
    try {
      k = JSON.parse(ev.data).k
    } catch (e) {
      return
    }
    if (!k) return
    const raw: CandleFlat = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
    if (!isFinite(raw.c) || raw.c <= 0) return
    const c = p.folder ? p.folder.push(raw) : raw
    p.candleSeries.update(mapCandle(c))
    p.volSeries.update({
      time: Math.floor(c.t / 1000),
      value: c.v,
      color: c.c >= c.o ? 'rgba(0,230,118,.35)' : 'rgba(255,23,68,.35)',
    })
    const legend = p.el?.querySelector('.rc-legend') as HTMLElement | null
    if (legend)
      legend.innerHTML =
        '<span style="color:' +
        (c.c >= c.o ? 'var(--green)' : 'var(--red)') +
        '">' +
        pfmt(c.c) +
        '</span>'
  }
  ws.onclose = () => {
    // Reconnect only while this panel still wants this stream.
    if (ws._dead || p.token !== token) return
    setTimeout(() => {
      if (p.token === token) connect(p, token)
    }, 4000)
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
  const stacked = window.matchMedia('(max-width:900px)').matches
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
    p.candleSeries?.applyOptions({
      upColor: th.up,
      downColor: th.dn,
      wickUpColor: th.up,
      wickDownColor: th.dn,
      borderUpColor: th.up,
      borderDownColor: th.dn,
    })
  })
}
