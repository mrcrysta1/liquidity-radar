// Multi-chart workspace (Market tab). Faithful extraction from the engine's
// inline <script>; the classic-script globals (mcAdd/mcRemove/mcChange*) are
// re-exposed on window by the engine. Chart creation/rendering lives here,
// matching the chartRender module conventions.
import * as LightweightCharts from 'lightweight-charts'
import { pfmt } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $ } from '../../utils/dom'
import { jget } from '../../api/client'
import { chartTheme, mapCandle } from './chartRender'
import {
  md,
  mdCacheGet,
  mdCachePut,
  mdDebug,
  mdFromK,
  mdHealth,
  mdHearbeat,
  mdSym,
  mdTf,
  mdVal,
} from '../../services/market'

type Any = any

interface McPanel {
  id: number
  sym: string
  interval: string
  chart: Any
  candleSeries: Any
  volSeries: Any
  ws: Any
  candles: Any[]
  [key: string]: Any
}

const MC_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']
const MC_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'PEPEUSDT', 'WIFUSDT', 'TRUMPUSDT', 'XRPUSDT', 'SUIUSDT', 'BNBUSDT']
let mcPanels: McPanel[] = []
let mcIdCounter = 0

export function initMultiCharts(): void {
  mcPanels = []
  mcIdCounter = 0
  $('mcGrid')!.innerHTML = ''
  mcAdd('BTCUSDT', '15m')
  mcAdd('ETHUSDT', '1h')
  renderMCGrid()
  setInterval(mcRefreshAll, 15000)
}

export function mcAdd(sym: string, interval: string): void {
  const id = mcIdCounter++
  mcPanels.push({ id: id, sym: sym, interval: interval, chart: null, candleSeries: null, volSeries: null, ws: null, candles: [] })
  renderMCGrid() // renderMCGrid -> mcInitChart(p) creates chart + loads data for each panel
}

export function mcRemove(id: number): void {
  const idx = mcPanels.findIndex((p) => p.id === id)
  if (idx === -1) return
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
  const grid = $('mcGrid')!
  let html = ''
  mcPanels.forEach(function (p) {
    const meta = coinMeta(p.sym)
    html +=
      '<div class="multi-chart-cell" data-mc-id="' +
      p.id +
      '">' +
      '<div class="mc-head">' +
      '<span class="mc-title">' +
      meta.icon +
      ' ' +
      baseOf(p.sym) +
      '/USDT</span>' +
      '<div class="mc-controls">' +
      '<select onchange="mcChangeInterval(' +
      p.id +
      ',this.value)">' +
      MC_INTERVALS.map(function (iv) {
        return '<option value="' + iv + '"' + (iv === p.interval ? ' selected' : '') + '>' + iv + '</option>'
      }).join('') +
      '</select>' +
      '<select onchange="mcChangeSymbol(' +
      p.id +
      ',this.value)">' +
      MC_COINS.map(function (s) {
        return '<option value="' + s + '"' + (s === p.sym ? ' selected' : '') + '>' + baseOf(s) + '</option>'
      }).join('') +
      '</select>' +
      '<button class="theme-btn" onclick="mcRemove(' +
      p.id +
      ')" style="width:24px;height:24px;font-size:10px;padding:0" title="Remove">X</button>' +
      '</div></div>' +
      '<div class="mc-body" id="mcBody' +
      p.id +
      '"><div class="mc-legend" id="mcLeg' +
      p.id +
      '">Loading...</div></div>' +
      '</div>'
  })
  if (mcPanels.length < 6) {
    html += '<div class="mc-add" onclick="mcAdd(\'BTCUSDT\',\'15m\')" title="Add chart">+ Add Chart</div>'
  }
  grid.innerHTML = html
  mcPanels.forEach(function (p) {
    mcInitChart(p)
  })
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
    layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" },
    grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
    rightPriceScale: { borderColor: th.border },
    timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: 0, vertLine: { color: th.pline, labelBackgroundColor: th.pline }, horzLine: { color: th.pline, labelBackgroundColor: th.pline } },
  } as Any)
  const cs = c.addCandlestickSeries({ upColor: th.up, downColor: th.dn, borderVisible: false, wickUpColor: th.up, wickDownColor: th.dn })
  const vs = c.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
  vs.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })
  c.subscribeCrosshairMove(function (param: Any) {
    if (!param.time || !param.seriesData || !legEl) return
    const d = param.seriesData.get(cs)
    if (d) {
      const up = d.close >= d.open
      legEl.innerHTML = '<span style="color:' + (up ? 'var(--green)' : 'var(--red)') + '">O:' + pfmt(d.open) + ' H:' + pfmt(d.high) + ' L:' + pfmt(d.low) + ' C:' + pfmt(d.close) + '</span>'
    }
  })
  new ResizeObserver(function () {
    if (c && el.clientWidth) c.applyOptions({ width: el.clientWidth, height: el.clientHeight || 260 })
  }).observe(el)
  p.chart = c
  p.candleSeries = cs
  p.volSeries = vs
  mcLoadData(p)
}

function mcLoadData(p: McPanel): void {
  const sym = mdSym(p.sym) as string,
    iv = mdTf(p.interval)
  jget('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=120')
    .then(function (data: Any) {
      const candles = data.map(mdFromK).filter(Boolean)
      p.candles = candles
      mdCachePut(sym, iv, candles)
      if (p.candleSeries) {
        p.candleSeries.setData(p.candles.map(mapCandle))
        p.volSeries.setData(
          p.candles.map(function (c) {
            return { time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' }
          }),
        )
        p.chart.timeScale().fitContent()
      }
      mcConnectWS(p)
    })
    .catch(function (e) {
      console.warn('mc load', e)
      const cached = mdCacheGet(sym, iv)
      if (cached && cached.length && p.candleSeries) {
        p.candles = cached
        p.candleSeries.setData(cached.map(mapCandle))
        p.volSeries.setData(
          cached.map(function (c) {
            return { time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' }
          }),
        )
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
  const s = (mdSym(p.sym) as string).toLowerCase()
  const iv = mdTf(p.interval)
  const url = 'wss://stream.binance.com:9443/ws/' + s + '@kline_' + iv
  try {
    const ws = new WebSocket(url) as Any
    ws._dead = false
    p.ws = ws
    ws._expectSym = p.sym
    ws._expectIv = p.interval
    ws.onopen = function () {
      mdHearbeat('ws')
    }
    ws.onmessage = function (ev: MessageEvent) {
      try {
        const d = JSON.parse(ev.data)
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
        if (p.candleSeries) {
          p.candleSeries.update(mapCandle(c))
          p.volSeries.update({ time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' })
        }
      } catch (e) {
        mdDebug.log('ws', 'mc handler', e)
      }
    }
    ws.onclose = function () {
      // only reconnect if the panel still exists and this socket is still current
      if (ws._dead) return
      if (!mcPanels.some(function (x) { return x === p && x.ws === ws })) return
      if (p.sym !== ws._expectSym || p.interval !== ws._expectIv) return
      md.conn.ws.reconnects++
      mdHealth.wsReconnects++
      const exp = (p._retry = (p._retry || 0) + 1)
      const delay = Math.min(30000, 1200 * Math.pow(2, Math.min(exp, 6))) + Math.floor(Math.random() * 300)
      setTimeout(function () {
        if (!ws._dead && mcPanels.indexOf(p) !== -1 && p.ws === ws) mcConnectWS(p)
      }, delay)
    }
  } catch (e) {
    mdDebug.log('ws', 'mc create', e)
  }
}

export function mcChangeInterval(id: number, iv: string): void {
  const p = mcPanels.find(function (x) { return x.id === id })
  if (!p) return
  p.interval = iv
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
  const p = mcPanels.find(function (x) { return x.id === id })
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
  mcLoadData(p)
  renderMCGrid()
}

function mcRefreshAll(): void {
  mcPanels.forEach(function (p) {
    if (p.candles.length > 0) {
      const sym = mdSym(p.sym) as string,
        iv = mdTf(p.interval)
      jget('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + iv + '&limit=5')
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
            if (p.candleSeries) {
              p.candleSeries.update(mapCandle(c))
              p.volSeries.update({ time: Math.floor(c.t / 1000), value: c.v, color: c.c >= c.o ? 'rgba(0,230,118,.3)' : 'rgba(255,23,68,.3)' })
            }
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
      if (p.candleSeries) p.candleSeries.applyOptions({ upColor: th.up, downColor: th.dn, wickUpColor: th.up, wickDownColor: th.dn })
      if (p.volSeries) p.volSeries.applyOptions({})
    }
  })
}