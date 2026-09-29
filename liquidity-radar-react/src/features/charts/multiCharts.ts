// Multi-chart workspace (Market tab). Faithful extraction from the engine's
// inline <script>; the classic-script globals (mcAdd/mcRemove/mcChange*) are
// re-exposed on window by the engine. Chart creation/rendering lives here,
// matching the chartRender module conventions.
//
// Each panel carries its own indicator set (indicators/panelStore, slot
// 'mc<position>'), drawn by its own renderer over its own candles; the
// header's indicators button is a React portal (PanelIndicatorButtons).
import * as LightweightCharts from 'lightweight-charts'
import { poll } from '../../services/pollScheduler'
import { pfmt } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { chartTheme, mapCandle } from './chartRender'
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
import { createIndicatorRenderer } from './indicators/render'
import type { IndicatorRenderer } from './indicators/render'
import { panelIndicatorStore, prunePanelSlots, shiftPanelSlots } from './indicators/panelStore'

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
  [key: string]: Any
}

/** Live ticks redraw a panel's indicators at most this often. */
const IND_THROTTLE_MS = 1000
const slotOf = (p: McPanel) => 'mc' + mcPanels.indexOf(p)

const MC_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']
const MC_COINS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'PEPEUSDT',
  'WIFUSDT',
  'TRUMPUSDT',
  'XRPUSDT',
  'SUIUSDT',
  'BNBUSDT',
]
let mcPanels: McPanel[] = []
let mcIdCounter = 0
const MAX_PANELS = 8

// The React workspace header (panel count, grid layout) follows these.
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
  const g = $('mcGrid')
  if (g) g.dataset.cols = String(n)
  emit()
}

export function initMultiCharts(): void {
  mcPanels = []
  mcIdCounter = 0
  const g = $('mcGrid')!
  g.innerHTML = ''
  g.dataset.cols = String(mcColumns())
  // Four majors on the hour, as the workspace opens.
  ;['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'].forEach((sym) => {
    mcPanels.push(blankPanel(sym, '1h'))
  })
  // The workspace always reopens with these four, so indicator sets saved
  // for panels beyond them belong to charts that are gone.
  prunePanelSlots('mc', mcPanels.length)
  renderMCGrid()
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

function mcSetAll(p: McPanel): void {
  if (!p.candleSeries) return
  p.candleSeries.setData(p.candles.map(mapCandle))
  p.volSeries.setData(
    p.candles.map(function (c) {
      return { time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' }
    }),
  )
  p.rsiSeries?.setData(rsiPoints(p.candles))
  mcDrawIndicators(p)
  mcPaintHead(p)
}

function mcUpdateLast(p: McPanel, c: Any): void {
  if (!p.candleSeries) return
  p.candleSeries.update(mapCandle(c))
  p.volSeries.update({ time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' })
  const pts = rsiPoints(p.candles.slice(-60))
  if (pts.length) p.rsiSeries?.update(pts[pts.length - 1])
  mcScheduleIndicators(p)
  mcPaintHead(p)
}

export function mcAdd(sym: string, interval: string): void {
  if (!mcCanAdd()) return
  mcPanels.push(blankPanel(sym || 'BTCUSDT', interval || '1h'))
  renderMCGrid() // renderMCGrid -> mcInitChart(p) creates chart + loads data for each panel
}

export function mcRemove(id: number): void {
  const idx = mcPanels.findIndex((p) => p.id === id)
  if (idx === -1) return
  // The panels after it move up a place, and their indicators with them.
  mcDropIndicators(mcPanels[idx])
  shiftPanelSlots('mc', idx, mcPanels.length)
  if (mcPanels[idx].ws) {
    mcPanels[idx].ws._dead = true
    try {
      mcPanels[idx].ws.close()
    } catch (e) {
      /* ignore */
    }
  }
  if (mcPanels[idx].chart) {
    try {
      mcPanels[idx].chart.remove()
    } catch (e) {
      /* ignore */
    }
  }
  mcPanels.splice(idx, 1)
  renderMCGrid()
}

function renderMCGrid(): void {
  // grid.innerHTML below throws away every panel's chart *host element*,
  // but LightweightCharts instances aren't tied to DOM removal — each one
  // keeps its own ResizeObserver, RAF loop and listeners alive until told
  // to stop via chart.remove(). Without disposing them first here, every
  // add/remove/symbol-change leaked one zombie chart instance per *other*
  // panel still on the grid — mcChangeSymbol calls this on every coin swap.
  mcPanels.forEach(function (p) {
    mcDropIndicators(p)
    if (p.chart) {
      try {
        p.chart.remove()
      } catch (e) {
        /* already detached */
      }
      p.chart = null
    }
  })
  const grid = $('mcGrid')!
  let html = ''
  const opt = (v: string, cur: string, label: string) =>
    '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>'
  mcPanels.forEach(function (p) {
    const meta = coinMeta(p.sym)
    const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[baseOf(p.sym)]?.image
    const icon = img && /^https:\/\//.test(img) ? '<img src="' + img.replace(/"/g, '') + '" alt="" loading="lazy">' : meta.icon
    html +=
      '<div class="multi-chart-cell" data-mc-id="' + p.id + '">' +
      '<div class="mc-head">' +
      '<span class="mc-id"><i class="tk-ico" style="border-color:' + meta.color + '66;background:' + meta.color + '1f;color:' + meta.color + '">' + icon + '</i>' +
      '<span><select class="mc-sym" aria-label="Symbol" onchange="mcChangeSymbol(' + p.id + ',this.value)">' +
      MC_COINS.concat(MC_COINS.indexOf(p.sym) === -1 ? [p.sym] : []).map((s) => opt(s, p.sym, baseOf(s) + '/USDT')).join('') +
      '</select><small class="mc-px" id="mcPx' + p.id + '">…</small></span></span>' +
      '<div class="mc-controls">' +
      '<span class="mc-ind" data-ind-slot="mc' + mcPanels.indexOf(p) + '" data-ind-label="' + baseOf(p.sym).replace(/"/g, '') + '/USDT ' + p.interval + '"></span>' +
      '<select aria-label="Interval" onchange="mcChangeInterval(' + p.id + ',this.value)">' +
      MC_INTERVALS.map((iv) => opt(iv, p.interval, iv)).join('') +
      '</select>' +
      '<button class="mc-x" onclick="mcRemove(' + p.id + ')" title="Remove chart" aria-label="Remove chart">' +
      '<svg width="12" height="12" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>' +
      '</div></div>' +
      '<div class="mc-body" id="mcBody' + p.id + '"><div class="mc-legend" id="mcLeg' + p.id + '"></div>' +
      '<span class="mc-rsi-tag">RSI <b id="mcRsiV' + p.id + '">—</b></span></div>' +
      '</div>'
  })
  if (mcCanAdd()) {
    html +=
      '<div class="mc-add">' +
      '<button class="mc-add-btn" onclick="mcAdd(\'BTCUSDT\',\'1h\')" aria-label="Add chart"><svg width="30" height="30" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<b>+ Add Chart</b><small>Add more assets, compare or build a new workspace.</small>' +
      '<select class="mc-add-sym" aria-label="Choose symbol" onchange="if(this.value)mcAdd(this.value,\'1h\')">' +
      '<option value="">Choose Symbol</option>' + MC_COINS.map((s) => '<option value="' + s + '">' + baseOf(s) + '/USDT</option>').join('') +
      '</select></div>'
  }
  grid.innerHTML = html
  mcPanels.forEach(function (p) {
    mcInitChart(p)
  })
  emit()
}

function mcInitChart(p: McPanel): void {
  const el = document.getElementById('mcBody' + p.id)
  if (!el) return
  const legEl = document.getElementById('mcLeg' + p.id)
  const w = el.clientWidth,
    h = el.clientHeight || 260
  const th = chartTheme()
  const c: Any = LightweightCharts.createChart(el, {
    width: w,
    height: h,
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
  // The panel's own indicators. With panes open, candles and volume move up
  // over them and the built-in RSI strip steps aside; with none, the panel
  // looks exactly as it always has.
  const store = panelIndicatorStore(slotOf(p))
  const ind = createIndicatorRenderer(store.getIndicators, {
    priceLayout: (_c: Any, bottom: number) => {
      cs.priceScale().applyOptions({
        scaleMargins: bottom ? { top: 0.06, bottom: bottom + 0.22 } : { top: 0.06, bottom: 0.36 },
      })
      vs.priceScale().applyOptions({
        scaleMargins: bottom
          ? { top: 1 - bottom - 0.2, bottom: bottom + 0.04 }
          : { top: 0.66, bottom: 0.22 },
      })
      rs.applyOptions({ visible: !bottom })
    },
  })
  ind.attach(c)
  p.ind = ind
  p.indOff = store.subscribe(() => mcDrawIndicators(p))
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
  new ResizeObserver(function () {
    if (!c || !el.clientWidth) return
    c.applyOptions({ width: el.clientWidth, height: el.clientHeight || 260 })
    if (fitW < 60 && el.clientWidth >= 60 && p.candles.length) c.timeScale().fitContent()
    fitW = el.clientWidth
  }).observe(el)
  p.chart = c
  p.candleSeries = cs
  p.volSeries = vs
  p.rsiSeries = rs
  // Re-rendering the grid (a panel added or removed elsewhere) keeps this
  // panel's data and socket; only a fresh panel, or a new symbol/interval,
  // goes back to the network.
  if (p.candles.length) {
    mcSetAll(p)
    if (!p.ws || p.ws._dead) mcConnectWS(p)
  } else mcLoadData(p)
}

function mcLoadData(p: McPanel): void {
  const sym = mdSym(p.sym) as string,
    iv = mdTf(p.interval)
  fetchKlineRows(sym, iv, 120)
    .then(function (data: Any) {
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
  if (p.ws && p.ws._dead === false) {
    p.ws._dead = true
    try {
      p.ws.close()
    } catch (e) {
      /* ignore */
    }
  }
  const s = mdSym(p.sym) as string
  const iv = mdTf(p.interval)
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
  const slot = document.querySelector('[data-mc-id="' + p.id + '"] .mc-ind') as HTMLElement | null
  if (slot) slot.dataset.indLabel = baseOf(p.sym) + '/USDT ' + iv
  if (p.ws) {
    p.ws._dead = true
    try {
      p.ws.close()
    } catch (e) {
      /* ignore */
    }
  }
  mcLoadData(p)
}

export function mcChangeSymbol(id: number, sym: string): void {
  const p = mcPanels.find(function (x) {
    return x.id === id
  })
  if (!p) return
  p.sym = sym
  p.candles = []
  if (p.ws) {
    p.ws._dead = true
    try {
      p.ws.close()
    } catch (e) {
      /* ignore */
    }
  }
  renderMCGrid() // re-inits this panel's chart, which loads its data once
}

function mcRefreshAll(): void {
  mcPanels.forEach(function (p) {
    if (p.candles.length > 0) {
      const sym = mdSym(p.sym) as string,
        iv = mdTf(p.interval)
      fetchKlineRows(sym, iv, 5)
        .then(function (data: Any) {
          if (data && data.length) {
            const c = mdFromK(data[data.length - 1])
            if (!c || !mdVal.candle(c)) return
            const arr = p.candles
            if (arr.length && arr[arr.length - 1].t === c.t) arr[arr.length - 1] = c
            else if (arr.length && c.t > arr[arr.length - 1].t) {
              arr.push(c)
              if (arr.length > 200) arr.shift()
            }
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
      p.chart.applyOptions({
        layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt },
        grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
        rightPriceScale: { borderColor: th.border },
        timeScale: { borderColor: th.border },
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
