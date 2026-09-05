import * as LightweightCharts from 'lightweight-charts'
import { COINS, TICKER_COINS } from '../../constants/market'
import { pfmt, nfmt, cfmt, chgHtml } from '../../utils/format'
import { baseOf, coinMeta } from '../../utils/coins'
import { $, showToast } from '../../utils/dom'
import { emaArr, smaArr, calcBBList, vwapSeries, calcRSI, macdSeries } from '../../utils/indicators'
import { state } from '../../services/store'

type Any = any

let chart: Any = null
let candleSeries: Any = null
let volSeries: Any = null
const chartState: {
  style: string
  overlays: Record<string, boolean>
  panes: Record<string, boolean>
  period: number
  drawTool: string | null
  drawings: Any[]
  drawBuf: Any[]
  [key: string]: Any
} = {
  style: 'candle',
  overlays: { ema: true, sma: true, boll: true, vwap: false },
  panes: { vol: true, rsi: false, macd: false },
  period: 20,
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
  if (candleSeries)
    candleSeries.applyOptions({
      upColor: th.up,
      downColor: th.dn,
      wickUpColor: th.up,
      wickDownColor: th.dn,
      priceLineColor: th.pline,
      borderUpColor: th.up,
      borderDownColor: th.dn,
    })
  if (chartState.rsiSeries) chartState.rsiSeries.applyOptions({ color: cv('purple') })
  if (chartState.macdHist) chartState.macdHist.applyOptions({})
  refreshOverlayColors()
}
export function mapCandle(c: Any): Any {
  return { time: Math.floor(c.t / 1000), open: c.o, high: c.h, low: c.l, close: c.c }
}

// ---- Overlay / pane series management ----
function rebuildOverlays(): void {
  if (!chart || !candleSeries) return
  const candles = state.candles
  const o = chartState.overlays
  const period = chartState.period
  const defs = [
    ['ema', '#FFD54F', cv('pink'), 'EMA'],
    ['sma', '#64B5F6', cv('cyan'), 'SMA'],
    ['bollUp', '#B388FF', cv('purple'), 'BB UP'],
    ['bollLo', '#B388FF', cv('purple'), 'BB LO'],
    ['vwap', '#FF5252', cv('amber'), 'VWAP'],
  ]
  defs.forEach(function (d) {
    const key = d[0]
    const col = d[1]
    const lightCol = d[2]
    const lbl = d[3]
    const on = key === 'bollUp' ? o.boll : key === 'bollLo' ? o.boll : o[key]
    let data: Any[] = []
    if (on && candles.length) {
      const closes = candles.map((c) => c.c)
      if (key === 'ema')
        data = candles.map((c, i) => ({
          time: Math.floor(c.t / 1000),
          value: emaArr(closes, period)[i],
        }))
      else if (key === 'sma') {
        const s = smaArr(closes, period)
        data = candles.map((c, i) => ({ time: Math.floor(c.t / 1000), value: s[i] }))
      } else if (key === 'bollUp') {
        const bb = calcBBList(closes, period)
        data = candles.map((c, i) => ({ time: Math.floor(c.t / 1000), value: bb[i].up }))
      } else if (key === 'bollLo') {
        const bb = calcBBList(closes, period)
        data = candles.map((c, i) => ({ time: Math.floor(c.t / 1000), value: bb[i].lo }))
      } else if (key === 'vwap') data = vwapSeries(candles, 0)
    }
    const existing = chartState.overlaySeries ? chartState.overlaySeries[key] : null
    let s = existing
    if (s && !on) {
      chart.removeSeries(s)
      delete chartState.overlaySeries[key]
      return
    }
    if (!s && on) {
      s = chart.addLineSeries({
        color: isLightTheme() ? lightCol : col,
        lineWidth: key === 'vwap' ? 1 : 2,
        lineStyle: key === 'bollUp' || key === 'bollLo' ? 2 : 0,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        title: lbl,
        priceScaleId: 'right',
      })
      if (!chartState.overlaySeries) chartState.overlaySeries = {}
      chartState.overlaySeries[key] = s
    }
    if (s) s.setData(data.filter((x) => x && x.value != null && isFinite(x.value)))
  })
}
function refreshOverlayColors(): void {
  if (!chartState.overlaySeries) return
  const map: Record<string, string> = {
    ema: isLightTheme() ? cv('pink') : '#FFD54F',
    sma: isLightTheme() ? cv('cyan') : '#64B5F6',
    bollUp: cv('purple'),
    bollLo: cv('purple'),
    vwap: isLightTheme() ? cv('amber') : '#FF5252',
  }
  Object.keys(map).forEach(function (k) {
    if (chartState.overlaySeries[k]) chartState.overlaySeries[k].applyOptions({ color: map[k] })
  })
}
function rebuildVolume(): void {
  if (!volSeries) return
  const on = chartState.panes.vol
  if (!on && chartState.volumeSeries) {
    chart.removeSeries(chartState.volumeSeries)
    chartState.volumeSeries = null
    volSeries = null
    return
  }
  if (on && !chartState.volumeSeries) {
    chartState.volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chartState.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    volSeries = chartState.volumeSeries
  }
  if (on)
    chartState.volumeSeries.setData(
      state.candles.map((c) => ({
        time: Math.floor(c.t / 1000),
        value: c.v,
        color: c.c >= c.o ? 'rgba(0,230,118,.4)' : 'rgba(255,23,68,.4)',
      })),
    )
}
function rebuildRSI(): void {
  if (!chart) return
  const on = chartState.panes.rsi
  if (!on && chartState.rsiSeries && chartState.rsiLine) {
    chart.removeSeries(chartState.rsiLine)
    chartState.rsiLine = null
    chartState.rsiSeries = null
    return
  }
  if (!on) return
  const closes = state.candles.map((c) => c.c)
  const rsiArr = closes.map((_, i) => calcRSI(closes.slice(0, i + 1), 14))
  if (!chartState.rsiLine) {
    chartState.rsiLine = chart.addLineSeries({
      color: cv('purple'),
      lineWidth: 2,
      priceScaleId: 'rsi',
      lastValueVisible: true,
      priceLineVisible: false,
      title: 'RSI',
    })
    chartState.rsiLine.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } })
  }
  chartState.rsiLine.setData(
    state.candles.map((c, i) => ({ time: Math.floor(c.t / 1000), value: rsiArr[i] })),
  )
}
function rebuildMACD(): void {
  if (!chart) return
  const on = chartState.panes.macd
  if (!on && chartState.macdHist && chartState.macdLine) {
    chart.removeSeries(chartState.macdLine)
    chart.removeSeries(chartState.macdHist)
    chartState.macdLine = null
    chartState.macdHist = null
    return
  }
  if (!on) return
  const closes = state.candles.map((c) => c.c)
  const m = macdSeries(closes)
  const tArr = state.candles.map((c) => Math.floor(c.t / 1000))
  if (!chartState.macdHist) {
    chartState.macdHist = chart.addHistogramSeries({
      priceScaleId: 'macd',
      priceFormat: { type: 'price', precision: closes[0] > 100 ? 2 : 8 },
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'MACD',
    })
    chartState.macdHist.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } })
    chartState.macdLine = chart.addLineSeries({
      color: cv('cyan'),
      lineWidth: 1,
      priceScaleId: 'macd',
      priceLineVisible: false,
      lastValueVisible: false,
    })
  }
  chartState.macdHist.setData(
    state.candles.map((c, i) => ({
      time: tArr[i],
      value: m.hist[i],
      color: m.hist[i] >= 0 ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)',
    })),
  )
  chartState.macdLine.setData(state.candles.map((c, i) => ({ time: tArr[i], value: m.line[i] })))
}
function rebuildChartLayers(): void {
  if (!chart) return
  rebuildOverlays()
  rebuildVolume()
  rebuildRSI()
  rebuildMACD()
}
function applyChartStyle(): void {
  if (!chart) return
  const s = chartState.style
  const existing = chartState.styleSeries
  if (existing) {
    chart.removeSeries(existing)
    chartState.styleSeries = null
  }
  if (s === 'candle' || s === 'hollow') {
    if (!candleSeries && s === 'candle') {
      const th = chartTheme()
      candleSeries = chart.addCandlestickSeries({
        upColor: th.up,
        downColor: th.dn,
        borderVisible: false,
        wickUpColor: th.up,
        wickDownColor: th.dn,
        priceLineColor: th.pline,
        priceLineStyle: 2,
      })
    } else if (s === 'hollow') {
      const th = chartTheme()
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
    }
    chartState.styleSeries = candleSeries
  } else if (s === 'area') {
    candleSeries = chart.addAreaSeries({
      lineColor: cv('primary'),
      topColor: 'rgba(41,98,255,.35)',
      bottomColor: 'rgba(41,98,255,0)',
    })
    chartState.styleSeries = candleSeries
  } else {
    candleSeries = chart.addLineSeries({ color: cv('primary'), lineWidth: 2 })
    chartState.styleSeries = candleSeries
  }
}
export function initChart(): void {
  if (!(window as Any).LightweightCharts) {
    $('legendOHLC')!.textContent = 'Chart library failed to load'
    return
  }
  const el = $('chart')!
  const th = chartTheme()
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
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
  candleSeries = chart.addCandlestickSeries({
    upColor: th.up,
    downColor: th.dn,
    borderVisible: false,
    wickUpColor: th.up,
    wickDownColor: th.dn,
    priceLineColor: th.pline,
    priceLineStyle: 2,
  })
  chartState.styleSeries = candleSeries
  chartState.volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  })
  chartState.volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
  volSeries = chartState.volumeSeries
  chart.subscribeCrosshairMove((param: Any) => {
    if (!param.time || !param.seriesData) return
    const cp = state.candles.find((c) => Math.floor(c.t / 1000) === param.time)
    if (cp) renderLegend(cp.o, cp.h, cp.l, cp.c, null, true)
  })
  chart.timeScale().subscribeVisibleTimeRangeChange(function () {
    redrawDrawings()
  })
  new ResizeObserver(() => {
    if (chart && el.clientWidth)
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    redrawDrawings()
  }).observe(el)
  setupDrawLayer()
  initChartToolbar()
  initFullScreen()
  rebuildChartLayers()
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
    (v != null ? '<span>VOL <b>' + nfmt(v) + '</b></span>' : '')
}
export function updateChartData(): void {
  if (!chart || !state.candles.length) return
  const s = chartState.style
  if (s === 'candle' || s === 'hollow') {
    candleSeries.setData(state.candles.map(mapCandle))
  } else {
    candleSeries.setData(state.candles.map((c) => ({ time: Math.floor(c.t / 1000), value: c.c })))
  }
  if (chartState.panes.vol && chartState.volumeSeries)
    chartState.volumeSeries.setData(
      state.candles.map((c) => ({
        time: Math.floor(c.t / 1000),
        value: c.v,
        color: c.c >= c.o ? 'rgba(0,230,118,.4)' : 'rgba(255,23,68,.4)',
      })),
    )
  rebuildChartLayers()
  chart.timeScale().fitContent()
  const lc = state.candles[state.candles.length - 1]
  renderLegend(lc.o, lc.h, lc.l, lc.c, lc.v, false)
}
export function updateChartLast(c: Any): void {
  if (!candleSeries) return
  const s = chartState.style
  if (s === 'candle' || s === 'hollow') {
    candleSeries.update(mapCandle(c))
  } else {
    candleSeries.update({ time: Math.floor(c.t / 1000), value: c.c })
  }
  if (chartState.panes.vol && chartState.volumeSeries)
    chartState.volumeSeries.update({
      time: Math.floor(c.t / 1000),
      value: c.v,
      color: c.c >= c.o ? 'rgba(0,230,118,.4)' : 'rgba(255,23,68,.4)',
    })
  updateOverlayLast(c)
  redrawDrawings()
}
function updateOverlayLast(c: Any): void {
  if (!chart) return
  const candles = state.candles
  if (!candles.length) return
  const o = chartState.overlays
  const period = chartState.period
  const closes = candles.map((x) => x.c)
  const upd = (series: Any, value: Any) => {
    if (series && value != null && isFinite(value))
      series.update({ time: Math.floor(c.t / 1000), value: value })
  }
  if (o.ema && chartState.overlaySeries && chartState.overlaySeries.ema)
    upd(chartState.overlaySeries.ema, emaArr(closes, period)[closes.length - 1])
  if (o.sma && chartState.overlaySeries && chartState.overlaySeries.sma) {
    const s = smaArr(closes, period)
    upd(chartState.overlaySeries.sma, s[s.length - 1])
  }
  if (o.boll && chartState.overlaySeries) {
    const bb = calcBBList(closes, period)[closes.length - 1]
    if (bb.up != null) upd(chartState.overlaySeries.bollUp, bb.up)
    if (bb.lo != null) upd(chartState.overlaySeries.bollLo, bb.lo)
  }
  if (o.vwap && chartState.overlaySeries) {
    const vv = vwapSeries(candles, 0)[candles.length - 1]
    if (vv) upd(chartState.overlaySeries.vwap, vv.value)
  }
  if (chartState.panes.rsi && chartState.rsiLine) {
    const r = calcRSI(closes, 14)
    chartState.rsiLine.update({ time: Math.floor(c.t / 1000), value: r })
  }
  if (chartState.panes.macd && chartState.macdHist && chartState.macdLine) {
    const m = macdSeries(closes)
    const t = Math.floor(closes.length ? c.t / 1000 : 0)
    chartState.macdHist.update({
      time: Math.floor(c.t / 1000),
      value: m.hist[m.hist.length - 1],
      color: m.hist[m.hist.length - 1] >= 0 ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)',
    })
    chartState.macdLine.update({ time: Math.floor(c.t / 1000), value: m.line[m.line.length - 1] })
  }
}

// ---- Toolbar wiring ----
function syncToolbarChips(): void {
  document.querySelectorAll('#chartBtnRow .tv-chip').forEach(function (chip) {
    const ind = (chip as HTMLElement).dataset.ind
    const pane = (chip as HTMLElement).dataset.pane
    const drw = (chip as HTMLElement).dataset.drw
    let on = false
    if (ind) on = chartState.overlays[ind]
    else if (pane) on = chartState.panes[pane]
    else if (drw) on = chartState.drawTool === drw
    chip.classList.toggle('on', !!on)
    if (drw) chip.classList.toggle('drw-on', on)
  })
  const per = $('indPeriod') as HTMLInputElement | null
  if (per) per.value = String(chartState.period)
}
function setTool(tool: Any): void {
  const group = tool === 'hline' || tool === 'trend' || tool === 'ray'
  if (!group) {
    chartState.drawTool = null
    chartState.drawBuf = []
  } else if (chartState.drawTool === tool) {
    chartState.drawTool = null
    chartState.drawBuf = []
  } else {
    chartState.drawTool = tool
    chartState.drawBuf = []
  }
  const hint = $('drawHint')
  if (hint)
    hint.textContent = chartState.drawTool
      ? 'Active: ' + chartState.drawTool + ' — click on the chart to place points'
      : 'Select a drawing tool, then click two points on the chart'
  syncToolbarChips()
}
function initChartToolbar(): void {
  document.querySelectorAll('#chartBtnRow .tv-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      if ((chip as HTMLElement).dataset.ind) {
        const k = (chip as HTMLElement).dataset.ind!
        chartState.overlays[k] = !chartState.overlays[k]
        rebuildOverlays()
      } else if ((chip as HTMLElement).dataset.pane) {
        const k = (chip as HTMLElement).dataset.pane!
        chartState.panes[k] = !chartState.panes[k]
        if (k === 'vol') rebuildVolume()
        else if (k === 'rsi') rebuildRSI()
        else rebuildMACD()
      } else if ((chip as HTMLElement).dataset.drw) {
        setTool((chip as HTMLElement).dataset.drw)
      }
      syncToolbarChips()
    })
  })
  const per = $('indPeriod') as HTMLInputElement | null
  if (per) {
    per.addEventListener('change', function () {
      let v = parseInt(per.value, 10)
      if (!(v >= 2)) v = 20
      if (v > 200) v = 200
      v = Math.round(v)
      chartState.period = v
      per.value = String(v)
      rebuildOverlays()
    })
  }
  const styleSel = $('chartStyle')
  if (styleSel) {
    styleSel.addEventListener('change', function () {
      chartState.style = (styleSel as HTMLSelectElement).value
      applyChartStyle()
      updateChartData()
    })
  }
  syncToolbarChips()
}

// ---- Full screen ----
function initFullScreen(): void {
  const btn = $('fsBtn')
  if (!btn) return
  btn.addEventListener('click', function () {
    const fs = document.documentElement.classList.toggle('radar-fs')
    btn.textContent = fs ? '✕' : '⛶'
    btn.title = fs ? 'Exit full screen [F]' : 'Full screen [F]'
    if (chart) {
      chart.applyOptions({
        width: chart._cw || $('chart')!.clientWidth,
        height: chart._ch || $('chart')!.clientHeight,
      })
    }
    requestAnimationFrame(function () {
      if (chart && $('chart')!.clientWidth)
        chart.applyOptions({ width: $('chart')!.clientWidth, height: $('chart')!.clientHeight })
      redrawDrawings()
    })
    if (fs && window.scrollTo) window.scrollTo(0, 0)
  })
}

export function resizeChart(): void {
  requestAnimationFrame(function () {
    if (chart && $('chart')!.clientWidth)
      chart.applyOptions({ width: $('chart')!.clientWidth, height: $('chart')!.clientHeight })
    redrawDrawings()
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
    if (!chartState.drawTool) return
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left + (chart._leftPad || 0)
    const y = e.clientY - r.top
    placeDrawPointFromXY(x, y)
  })
  overlay.addEventListener('dblclick', function (e) {
    if (chartState.drawTool) {
      destroyActiveDrawings()
    }
  })
  overlay.addEventListener('mousemove', function (e) {
    if (!chartState.drawTool) return
    const r = overlay.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const time = chart.timeScale().coordinateToTime(x)
    const price = chart.priceScale('right').coordinateToPrice(y)
    if (chartState.drawBuf.length && time != null && price != null) {
      chartState._preview = { time: time, price: price }
      redrawDrawings(true)
    }
  })
  overlay.addEventListener('mouseleave', function () {
    chartState._preview = null
    redrawDrawings()
  })
  chartState.drawHit = overlay
  updateDrawHit()
}
function updateDrawHit(): void {
  if (!chartState.drawHit) return
  chartState.drawHit.style.display = chartState.drawTool ? 'block' : 'none'
}
function placeDrawPointFromXY(x: Any, y: Any): void {
  const time = chart.timeScale().coordinateToTime(x)
  let price = null
  try {
    price = chart.priceScale('right').coordinateToPrice(y)
  } catch (e) {
    /* ignore */
  }
  if (time == null || price == null) return
  chartState.drawBuf.push({ time: time, price: price })
  const tool = chartState.drawTool
  const need = tool === 'hline' ? 1 : 2
  if (chartState.drawBuf.length >= need) {
    if (tool === 'hline') {
      const p = chartState.drawBuf[0]
      chartState.drawings.push({ type: 'hline', color: '#FFD54F', points: [p] })
    } else {
      const [a, b] = chartState.drawBuf
      chartState.drawings.push({ type: tool, color: '#4FC3F7', points: [a, b] })
    }
    chartState.drawBuf = []
    redrawDrawings()
  } else {
    redrawDrawings()
  }
}
function destroyActiveDrawings(): void {
  const tool = chartState.drawTool
  if (!tool) return
  if (tool === 'hline') chartState.drawings = chartState.drawings.filter((d) => d.type !== 'hline')
  else
    chartState.drawings = chartState.drawings.filter((d) => d.type !== 'trend' && d.type !== 'ray')
  chartState.drawBuf = []
  redrawDrawings()
  showToast('Cleared ' + tool + ' drawings')
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
  const ts = chart.timeScale()
  const ps = chart.priceScale('right')
  const toXY = function (p: Any) {
    const x = ts.timeToCoordinate(p.time)
    const y = ps.priceToCoordinate(p.price)
    return { x: x, y: y }
  }
  function lineXY(a: Any, b: Any) {
    const A = toXY(a)
    const B = toXY(b)
    if (A.x == null || B.x == null || A.y == null || B.y == null) return null
    return { A, B }
  }
  chartState.drawings.forEach(function (d) {
    ctx.save()
    ctx.strokeStyle = d.color
    ctx.lineWidth = 1.8
    ctx.lineCap = 'round'
    ctx.font = '10px JetBrains Mono, monospace'
    ctx.fillStyle = d.color
    if (d.type === 'hline') {
      const pt = toXY(d.points[0])
      if (pt.y == null) return ctx.restore()
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(0, pt.y)
      ctx.lineTo(cw, pt.y)
      ctx.stroke()
      ctx.setLineDash([])
      if (pt.x != null) {
        ctx.fillText('┄ ' + pfmt(d.points[0].price), pt.x + 6, pt.y - 4)
      }
    } else {
      const [a, b] = d.points
      const lr = lineXY(a, b)
      if (!lr) return ctx.restore()
      const X1 = lr.A.x
      const Y1 = lr.A.y
      let X2 = lr.B.x
      const Y2 = lr.B.y
      if (d.type === 'ray') {
        const dx = X2 - X1
        const dy = Y2 - Y1
        const t = (cw - X1) / dx
        X2 = X1 + dx * t
      }
      ctx.beginPath()
      ctx.moveTo(X1, Y1)
      ctx.lineTo(X2, Y2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(X1, Y1, 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(X2, Y2, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  })
  if (includePreview && chartState.drawBuf.length === 1 && chartState._preview) {
    const a = chartState.drawBuf[0]
    const A = toXY(a)
    const P = toXY(chartState._preview)
    if (A.x != null && A.y != null && P.x != null && P.y != null) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,.45)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(A.x, A.y)
      ctx.lineTo(P.x, P.y)
      ctx.stroke()
      ctx.restore()
    }
  }
}

// ---- Order book render ----
export function renderOB(): void {
  const bids: Any = state.ob.bids
  const asks: Any = state.ob.asks
  if (!bids.length || !asks.length) return
  const bb = bids[0][0]
  const ba = asks[0][0]
  const mid = (bb + ba) / 2
  const spreadBps = ((ba - bb) / mid) * 1e4
  $('obSpreadV')!.textContent =
    'spread ' + (ba - bb).toFixed(ba < 1 ? 6 : 2) + ' (' + spreadBps.toFixed(2) + ' bps)'
  $('obMid')!.textContent = 'mid ' + pfmt(mid)
  const rows = function (arr: Any[], cls: string) {
    const maxN =
      Math.max.apply(
        null,
        arr.map((x) => x[0] * x[1]),
      ) || 1
    return arr
      .map(function (lv) {
        const n = lv[0] * lv[1]
        const w = Math.max(2, (n / maxN) * 100)
        return (
          '<div class="ob-row ' +
          cls +
          '"><span class="fill ' +
          cls +
          '" style="width:' +
          w +
          '%"></span><span class="op">' +
          pfmt(lv[0]) +
          '</span><span class="oa">' +
          nfmt(lv[1]) +
          '</span></div>'
        )
      })
      .join('')
  }
  $('obAsks')!.innerHTML = rows(asks.slice(0, 10).reverse(), 'ask')
  $('obBids')!.innerHTML = rows(bids.slice(0, 10), 'bid')
  renderHeatmap()
  function renderHeatmap() {
    $('hmSym')!.textContent = baseOf(state.symbol) + ' ±15 LEVELS'
    const all: Any[] = asks.slice(0, 8).concat(bids.slice(0, 8))
    const maxN =
      Math.max.apply(
        null,
        all.map((x) => x[0] * x[1]),
      ) || 1
    const hm = function (arr: Any[], side: string) {
      return arr
        .map(function (lv) {
          const n = lv[0] * lv[1]
          const r = n / maxN
          const col =
            side === 'ask'
              ? 'rgba(255,23,68,' + (0.18 + r * 0.6).toFixed(2) + ')'
              : 'rgba(0,230,118,' + (0.18 + r * 0.6).toFixed(2) + ')'
          return (
            '<div class="hm-row"><span class="hm-lbl">' +
            pfmt(lv[0]) +
            '</span><span class="hm-barzone"><span class="hm-bar" style="width:' +
            Math.max(3, r * 100).toFixed(1) +
            '%;background:' +
            col +
            '"></span></span><span class="hm-val">' +
            cfmt(n) +
            '</span></div>'
          )
        })
        .join('')
    }
    $('hmAsks')!.innerHTML = hm(asks.slice(0, 8).reverse(), 'ask')
    $('hmBids')!.innerHTML = hm(bids.slice(0, 8), 'bid')
    $('hmMid')!.textContent = '—— MID ' + pfmt(mid) + ' ——'
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
