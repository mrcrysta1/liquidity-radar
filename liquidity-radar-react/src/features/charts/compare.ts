// Compare / overlay symbols: up to COMPARE_MAX other markets drawn as lines on
// the main chart, each as % change from the first visible bar — TradingView's
// "Compare symbol".
//
// The lines live on their own overlay price scale in percentage mode, where
// lightweight-charts rebases every series on its own first visible value as
// the view scrolls and zooms — exactly the normalisation wanted, with no
// re-computation here. The charted market itself is drawn on that scale too
// (a faint dashed line): the candles sit on their own price scale, so without
// it there would be nothing to compare the lines with.
//
// Bars come through services/marketData (loadCandleWindow), so instruments and
// ratio / spread expressions work as compare symbols too. They are re-polled
// rather than streamed: one more socket per line is a lot of traffic for a
// line whose last point moves a pixel a minute.
import { LineSeries } from 'lightweight-charts'
import type { CandleFlat } from '../../services/market'
import { mdTf } from '../../services/market'
import { loadCandleWindow } from '../../services/marketData'
import { state } from '../../services/store'
import { storageGet, storageSet } from '../../services/storage'
import { DEFAULT_TF } from '../../services/timeframe'
import { displayCandles } from './series/rangeView'
import { asOfJoin, compareDepth, fmtPct, mergeTail, pctFrom, type ComparePoint } from './compareMath'

type Any = any

export const COMPARE_MAX = 5
const STORE_KEY = 'lr-compare-v1'
const SCALE_ID = 'lr-compare'
const POLL_MS = 30_000
const SYNC_MS = 2_000
// Distinct from the candle greens/reds and from each other, in both themes.
const COLORS = ['#FF9800', '#AB47BC', '#00BCD4', '#EC407A', '#8BC34A']
const MAIN_COLOR = 'rgba(143,160,181,.75)'

interface Entry {
  sym: string
  color: string
  series: Any
  rows: CandleFlat[]
  /** sym|tf|depth this entry's rows were loaded for. */
  loaded: string
  loading: boolean
  failed: boolean
  points: ComparePoint[]
}

let chart: Any = null
let mainLine: Any = null
let mainPoints: ComparePoint[] = []
const entries: Entry[] = []
let notify: () => void = () => {}
const listeners = new Set<() => void>()

function persist(): void {
  storageSet(
    STORE_KEY,
    entries.map((e) => e.sym),
  )
}

function emit(): void {
  legendCache = ''
  listeners.forEach((fn) => fn())
  notify()
}

/** Subscribe to the compare list changing (added, removed, loaded). */
export function onCompareChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function compareSymbols(): string[] {
  return entries.map((e) => e.sym)
}

function lineOptions(color: string, main = false): Any {
  return {
    priceScaleId: SCALE_ID,
    color,
    lineWidth: main ? 1 : 2,
    lineStyle: main ? 2 : 0,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: !main,
    // Percent of an arbitrary base: the series' own price format means nothing.
    priceFormat: { type: 'percent', precision: 2 },
  }
}

function freeColor(): string {
  const used = new Set(entries.map((e) => e.color))
  return COLORS.find((c) => !used.has(c)) ?? COLORS[entries.length % COLORS.length]
}

function ensureScale(): void {
  if (!chart) return
  try {
    // Percentage mode: each series rebased on its own first visible value.
    // Margins keep the lines off the very top, where the legend sits.
    chart.priceScale(SCALE_ID, 0).applyOptions({
      mode: 2,
      scaleMargins: { top: 0.15, bottom: 0.15 },
    })
  } catch (e) {
    /* the scale exists once a series is on it */
  }
}

function ensureMainLine(): void {
  if (!chart) return
  if (!entries.length) {
    if (mainLine) {
      try {
        chart.removeSeries(mainLine)
      } catch (e) {
        /* already gone */
      }
    }
    mainLine = null
    mainPoints = []
    return
  }
  if (!mainLine) {
    mainLine = chart.addSeries(LineSeries, lineOptions(MAIN_COLOR, true), 0)
    dataKey = '' // draw it on the next sync
  }
}

function toSeries(points: ComparePoint[]): Any[] {
  return points.map((p) => ({ time: Math.floor(p.t / 1000), value: p.v }))
}

/** Re-join each line onto the bars on screen and redraw it. */
function redrawLines(): void {
  const bars = displayCandles()
  const times = bars.map((c) => c.t)
  mainPoints = bars.filter((c) => Number.isFinite(c.c)).map((c) => ({ t: c.t, v: c.c }))
  if (mainLine) mainLine.setData(toSeries(mainPoints))
  for (const e of entries) {
    e.points = asOfJoin(times, e.rows)
    if (e.series) e.series.setData(toSeries(e.points))
  }
}

const tfNow = (): string => mdTf(state.tf || DEFAULT_TF)

async function load(e: Entry, force = false): Promise<void> {
  const tf = tfNow()
  const depth = compareDepth(state.candles.length)
  const want = e.sym + '|' + tf + '|' + depth
  if (e.loading || (!force && e.loaded === want)) return
  e.loading = true
  try {
    const rows = await loadCandleWindow(e.sym, tf, depth)
    // Removed, or the interval changed, while this was in flight.
    if (!entries.includes(e) || tfNow() !== tf) return
    e.rows = rows
    e.loaded = want
    e.failed = !rows.length
  } catch (err) {
    if (entries.includes(e)) e.failed = true
  } finally {
    e.loading = false
  }
  if (!entries.includes(e)) return
  dataKey = ''
  sync()
  emit()
}

/** The live edge only: the last few bars, folded into what is loaded. */
const TAIL_BARS = 5
async function poll(e: Entry): Promise<void> {
  if (e.loading || !e.loaded) return
  const loaded = e.loaded
  try {
    const tail = await loadCandleWindow(e.sym, tfNow(), TAIL_BARS)
    // A full reload (new interval, deeper history) landed meanwhile.
    if (!entries.includes(e) || e.loaded !== loaded) return
    e.rows = mergeTail(e.rows, tail)
  } catch (err) {
    return // the next poll tries again; the line keeps its bars
  }
  dataKey = ''
  sync()
}

export function addCompare(sym: string): boolean {
  const s = String(sym || '').trim().toUpperCase()
  if (!s || entries.length >= COMPARE_MAX) return false
  if (s === state.symbol || entries.some((e) => e.sym === s)) return false
  const e: Entry = {
    sym: s,
    color: freeColor(),
    series: null,
    rows: [],
    loaded: '',
    loading: false,
    failed: false,
    points: [],
  }
  entries.push(e)
  if (chart) {
    ensureMainLine()
    e.series = chart.addSeries(LineSeries, lineOptions(e.color), 0)
    ensureScale()
    void load(e)
  }
  persist()
  emit()
  return true
}

export function removeCompare(sym: string): void {
  const i = entries.findIndex((e) => e.sym === sym)
  if (i < 0) return
  const [e] = entries.splice(i, 1)
  if (chart && e.series) {
    try {
      chart.removeSeries(e.series)
    } catch (err) {
      /* already gone */
    }
  }
  ensureMainLine()
  persist()
  emit()
}

// ---- keeping up with the chart ---------------------------------------------
// The main chart's bars change on a load, a page of history, a live tick and a
// replay step. Rather than hook every one of those paths, a cheap key of the
// bars on screen is compared on a short timer and on every scroll/zoom.
let dataKey = ''
let candlesKey = ''
let frame = 0

function barsKey(): string {
  const b = displayCandles()
  const last = b[b.length - 1]
  return b.length ? [b.length, b[0].t, last.t, last.c].join('|') : ''
}

function sync(): void {
  if (!chart || !entries.length) return
  // A new market or interval: every line's bars belong to the old one.
  if (state.candlesKey !== candlesKey) {
    candlesKey = state.candlesKey || ''
    if (candlesKey) entries.forEach((e) => void load(e, true))
  } else {
    // History paged in front: load the lines that deep too.
    entries.forEach((e) => void load(e))
  }
  const k = barsKey()
  if (k !== dataKey) {
    // Only the forming bar's close moved (a live tick): move the main line's
    // last point instead of re-setting thousands of points on every sync.
    const sameBars = dataKey && k.slice(0, k.lastIndexOf('|')) === dataKey.slice(0, dataKey.lastIndexOf('|'))
    dataKey = k
    const b = displayCandles()
    const last = b[b.length - 1]
    if (sameBars && mainLine && mainPoints.length && last) {
      mainPoints[mainPoints.length - 1] = { t: last.t, v: last.c }
      mainLine.update({ time: Math.floor(last.t / 1000), value: last.c })
    } else redrawLines()
  }
  const html = buildLegend()
  if (html !== legendCache) {
    legendCache = html
    notify()
  }
}

function syncSoon(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    sync()
  })
}

// ---- legend ---------------------------------------------------------------
let legendCache = ''

function firstVisibleMs(): number {
  try {
    const r = chart?.timeScale().getVisibleRange()
    if (r && r.from != null) return Number(r.from) * 1000
  } catch (e) {
    /* no data yet */
  }
  return 0
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function buildLegend(): string {
  if (!entries.length) return ''
  const from = firstVisibleMs()
  const row = (sym: string, color: string, pct: string, removable: boolean, note = ''): string =>
    '<div class="leg-cmp' +
    (removable ? '' : ' leg-cmp-main') +
    '"><i class="leg-cmp-dot" style="background:' +
    color +
    '"></i><span class="leg-cmp-sym">' +
    esc(sym) +
    '</span><b>' +
    pct +
    '</b>' +
    (note ? '<small>' + note + '</small>' : '') +
    (removable
      ? '<button type="button" class="leg-cmp-x" data-cmp-remove="' +
        esc(sym) +
        '" aria-label="Remove ' +
        esc(sym) +
        ' from compare" title="Remove">×</button>'
      : '') +
    '</div>'
  return (
    '<div class="leg-cmp-list">' +
    row(state.symbol, MAIN_COLOR, fmtPct(pctFrom(mainPoints, from)), false) +
    entries
      .map((e) =>
        row(
          e.sym,
          e.color,
          e.loading && !e.points.length ? '…' : fmtPct(pctFrom(e.points, from)),
          true,
          e.failed ? 'no data' : '',
        ),
      )
      .join('') +
    '</div>'
  )
}

/**
 * The compare rows for the chart's OHLC legend (chartRender renderLegend
 * appends this). Cached: the legend is rebuilt on every trade print.
 */
export function compareLegendHtml(): string {
  if (!legendCache && entries.length) legendCache = buildLegend()
  return legendCache
}

/**
 * Wire compare lines into the main chart. `onLegendChange` re-renders the
 * OHLC legend, which carries the compare rows.
 */
export function attachCompare(c: Any, onLegendChange: () => void, legendEl: HTMLElement | null): void {
  chart = c
  notify = onLegendChange
  c.timeScale().subscribeVisibleLogicalRangeChange(syncSoon)
  setInterval(sync, SYNC_MS)
  setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    entries.forEach((e) => void poll(e))
  }, POLL_MS)
  legendEl?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button[data-cmp-remove]') as HTMLElement | null
    if (!btn) return
    ev.stopPropagation()
    removeCompare(btn.dataset.cmpRemove || '')
  })
  // The list from the last session.
  const saved = storageGet<string[]>(STORE_KEY, [])
  if (Array.isArray(saved)) saved.slice(0, COMPARE_MAX).forEach((s) => addCompare(String(s)))
}
