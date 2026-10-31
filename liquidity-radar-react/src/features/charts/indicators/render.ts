// Draws the active indicators onto the price-action chart.
//
// Overlays share the price scale; each pane indicator gets its own scale, and
// the scales are stacked so panes sit under the candles in the order they were
// added. Series are keyed by instance uid + output key, so a param change
// redraws in place rather than tearing every series down.
//
// An indicator reading another indicator's output (see ./graph) draws where
// its source lives when it is an overlay (an SMA of RSI sits in the RSI
// pane), and in a pane of its own when it is a pane indicator.
//
// Pine scripts (../pine) draw through the same paths: their plots are
// outputs, plotshape markers a signal output, hline()s price lines.
//
// createIndicatorRenderer draws one chart's store onto one chart; the main
// price-action chart uses the module-level functions below, and each
// multi-chart panel gets its own renderer over its own store.
//
// An instance's Style tab settings (colour, width, line style and visibility
// per output, axis precision, guide levels) override its def's look here, and
// its Visibility tab hides it on charts of an interval group it is off for.
import { createSeriesMarkers, HistogramSeries, LineSeries } from 'lightweight-charts'
import type { CandleFlat } from '../../../services/market'
import type { IndicatorInstance } from './store'
import { barStepMs, getIndicators, instanceDef, shownOnTf, tfGroupFor } from './store'
import { indicatorDef, instanceLabel, sourceSeries, valueOutputs } from './registry'
import type { IndicatorDef, OutputDef } from './registry'
import { computeAll } from './graph'
import type { Computed } from './graph'
import { cloudView } from './cloud'
import { volumeColor } from '../chartPalette'
import { PINE_TYPE, pineLive, pineStatus, subscribePine } from '../pine/indicator'
import { createPineDrawings } from '../pine/overlay'
import { priceFormatFor } from '../../../utils/format'

type Any = any

interface Held {
  series: Any
  outputKey: string
  scaleId: string
  kind: string
  /** Price lines (Pine hline) on this series, and what they were built from. */
  lines?: Any[]
  linesSig?: string
  /** Decimals last given to a pane series' priceFormat. */
  precision?: number
  /** The instance's fixed precision this series carries, if any. */
  fixedPrec?: number
  /** What applyLook last applied. */
  lookSig?: string
  /** The markers plugin of a signal series. */
  markers?: Any
  /** What the series last got by setData (count, first time), for pushData. */
  n?: number
  first?: Any
  updates?: number
}

/**
 * Pane values get decimals that fit their size: at the default precision 2,
 * MACD or ATR on PEPE printed 0.00 on the axis, labels and legend. Large
 * histograms (volume, OBV) keep the abbreviated volume format.
 */
function syncPaneFormat(h: Held, data: Any[], fixed?: number): void {
  if (h.kind === 'signal' || h.kind === 'cloud') return
  // A precision chosen on the Style tab wins, on any pane.
  if (fixed != null) {
    if (h.fixedPrec === fixed) return
    h.fixedPrec = h.precision = fixed
    h.series.applyOptions({
      priceFormat: { type: 'price', precision: fixed, minMove: Math.pow(10, -fixed) },
    })
    return
  }
  if (h.scaleId === 'right') return
  let max = 0
  for (const d of data) if (isFinite(d.value)) max = Math.max(max, Math.abs(d.value))
  if (!max) return
  if (h.kind === 'histogram' && max >= 1000) return
  const pf = max >= 1 ? { type: 'price' as const, precision: 2, minMove: 0.01 } : priceFormatFor(max)
  if (h.precision === pf.precision) return
  h.precision = pf.precision
  h.series.applyOptions({ priceFormat: pf })
}

const LINE_STYLE = { solid: 0, dotted: 1, dashed: 2 } as const

/** How one output draws: its def's look with the instance's overrides. */
export function outputLook(inst: IndicatorInstance, out: OutputDef) {
  const st = inst.styles?.[out.key] || {}
  return {
    color: st.color || out.color,
    /** The colour was picked on the Style tab (replaces per-bar tints). */
    custom: !!st.color,
    width: st.width ?? out.width ?? (out.dashed ? 1 : 2),
    lineStyle: st.style ? LINE_STYLE[st.style] : out.dashed ? 2 : 0,
    visible: st.visible !== false,
  }
}

export interface IndicatorRendererOptions {
  /** Lay out the chart's own price scales around `bottom` (the fraction the
   *  indicator panes take). Default: candles on 'right' get the rest. */
  priceLayout?(chart: Any, bottom: number): void
  /** The main chart: Pine barcolor() recolours its candles. */
  pineBarColors?: boolean
}

export interface IndicatorRenderer {
  attach(chart: Any): void
  render(candles: CandleFlat[]): void
  legend(candles: CandleFlat[], at?: number): LegendEntry[]
  refreshColors(): void
  clear(): void
  blank(): void
  paneCount(): number
  /** The pane (0 = price) an indicator instance draws in. */
  paneOf(uid: string): number
}

/** The fraction of the chart's height `n` indicator panes take at the bottom. */
export function paneBottom(n: number): number {
  return n <= 0 ? 0 : n === 1 ? 0.3 : Math.min(0.62, 0.22 * n)
}

/** A renderer for one chart, drawing whatever `getItems` returns. */
export function createIndicatorRenderer(
  getItems: () => IndicatorInstance[],
  opts: IndicatorRendererOptions = {},
): IndicatorRenderer {
  let chart: Any = null
  const held = new Map<string, Held>()
  /** Price-scale margins recomputed whenever the set of panes changes. */
  let paneOrder: string[] = []
  /** Pine bgcolor / label / line / box / table (../pine/overlay). */
  const pineDraw = createPineDrawings({ barColors: opts.pineBarColors })

  /** How many indicator panes currently occupy the bottom of the chart — used
   * by the Delta pane to stack under them instead of overlapping. */
  function indicatorPaneCount(): number {
    return paneOrder.length
  }

  function attachIndicatorChart(c: Any): void {
    pineDraw.sweep(new Set())
    chart = c
    held.clear()
    paneOrder = []
  }

  const keyOf = (inst: IndicatorInstance, out: string) => inst.uid + '.' + out
  const scaleOf = (host: string | null) => (host ? 'ind_' + host : 'right')

  /** Live instances that should actually draw. */
  function active(): Array<{ inst: IndicatorInstance; def: IndicatorDef }> {
    const out: Array<{ inst: IndicatorInstance; def: IndicatorDef }> = []
    getItems().forEach((inst) => {
      const def = indicatorDef(inst.type)
      if (def && inst.visible) out.push({ inst, def })
    })
    return out
  }

  /** Every visible instance computed, sources resolved in dependency order. */
  // Drawing the indicators, building their legend and reading it at the
  // crosshair all want the same result over the same candles: compute once.
  // A live tick replaces the last candle object and an indicator edit replaces
  // the item list, so either one misses the cache; a Pine script finishing
  // its compile clears it.
  let memo: {
    items: IndicatorInstance[]
    candles: CandleFlat[]
    n: number
    last: CandleFlat
    out: Array<Computed<IndicatorInstance>>
  } | null = null
  subscribePine(() => (memo = null))
  function computeActive(candles: CandleFlat[]): Array<Computed<IndicatorInstance>> {
    const items = getItems()
    const n = candles.length
    const m = memo
    if (m && m.items === items && m.candles === candles && m.n === n && m.last === candles[n - 1])
      return m.out
    const out = computeAll(
      items,
      candles,
      (inst, c) => (inst.type === PINE_TYPE ? pineLive(inst, c) : indicatorDef(inst.type)),
      sourceSeries,
    )
    memo = { items, candles, n, last: candles[n - 1], out }
    return out
  }

  const GUIDE_COLOR = 'rgba(148,163,184,.5)'
  /**
   * Pine hline()s, or a built-in oscillator's guides (RSI 30/70, Stoch 20/80,
   * MACD 0…), as price lines on the instance's first drawn series.
   */
  function guideLines(
    h: Held,
    def: IndicatorDef,
    inst: IndicatorInstance,
  ): NonNullable<IndicatorDef['hlines']> {
    // Levels edited on the Style tab replace the def's guides (or a script's
    // hlines) outright.
    if (def.hlines && !inst.levels) return def.hlines
    const levels = inst.levels ?? def.guides
    // Guides mark levels on the indicator's own scale; on the price pane they
    // would be meaningless prices.
    if (!levels || h.scaleId === 'right') return []
    return levels.map((price) => ({ price, color: GUIDE_COLOR, title: '', style: 'dashed' as const }))
  }
  function syncPriceLines(h: Held, def: IndicatorDef, inst: IndicatorInstance): void {
    const want = guideLines(h, def, inst)
    const sig = JSON.stringify(want)
    if (h.linesSig === sig) return
    ;(h.lines || []).forEach((l) => {
      try {
        h.series.removePriceLine(l)
      } catch (e) {
        /* series gone */
      }
    })
    h.lines = want
      .filter((x) => isFinite(x.price))
      .map((x) =>
        h.series.createPriceLine({
          price: x.price,
          color: x.color,
          lineWidth: 1,
          lineStyle: LINE_STYLE[x.style] ?? 2,
          axisLabelVisible: false,
          title: x.title,
        }),
      )
    h.linesSig = sig
    // Price lines do not count towards autoscale: an RSI holding 40–60 left
    // its 30/70 guides off screen. Stretch the pane's range over them.
    // Never on the price pane: a Pine hline(0) there would squash the candles.
    const levels =
      h.scaleId === 'right' ? [] : want.map((x) => x.price).filter((x) => isFinite(x))
    h.series.applyOptions({
      autoscaleInfoProvider: levels.length
        ? (base: () => Any) => {
            const r = base()
            if (!r || !r.priceRange) return r
            return {
              ...r,
              priceRange: {
                minValue: Math.min(r.priceRange.minValue, ...levels),
                maxValue: Math.max(r.priceRange.maxValue, ...levels),
              },
            }
          }
        : undefined,
    })
  }

  /**
   * Stack the price scales: candles keep the top, panes divide the bottom third
   * (or half, once there are two or more) evenly between them.
   */
  function layoutScales(): void {
    if (!chart) return
    const n = paneOrder.length
    // Indicators have their own panes now: the main pane keeps its usual margins.
    try {
      if (opts.priceLayout) opts.priceLayout(chart, 0)
      else chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.04 } })
    } catch (e) {
      /* scale not mounted yet */
    }
    // The candles keep most of the height (about 70% with one pane, 60% with
    // several); every pane can be dragged to another size.
    try {
      chart.panes()[0]?.setStretchFactor(n <= 1 ? 2.4 : 1.5 * n)
      for (const h of held.values()) if (h.scaleId !== 'right') h.series.getPane().setStretchFactor(1)
    } catch (e) {
      /* pane removed between frames */
    }
  }

  /**
   * The native pane (lightweight-charts v5) an indicator draws in: the pane
   * its other outputs already use, else a new one at the bottom. Panes used to
   * be faked with price-scale margins inside the main pane, so they had no
   * separators, could not be resized, and squeezed the candles.
   */
  function paneIndexFor(scaleId: string): number {
    for (const h of held.values()) {
      if (h.scaleId !== scaleId) continue
      try {
        return h.series.getPane().paneIndex()
      } catch (e) {
        /* series gone */
      }
    }
    return chart.addPane().paneIndex()
  }

  function makeSeries(out: OutputDef, scaleId: string, inst: IndicatorInstance): Any {
    const inPane = scaleId !== 'right'
    // In its own pane an indicator uses that pane's right scale, with an axis.
    const pane = inPane ? paneIndexFor(scaleId) : 0
    const lk = outputLook(inst, out)
    const common = {
      priceScaleId: 'right',
      // Auto Fib's levels name themselves on the price axis, as TradingView's.
      lastValueVisible: inPane || !!out.axisLabel,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      title: inPane || out.axisLabel ? out.label : '',
      visible: lk.visible,
    }
    if (out.kind === 'cloud')
      return chart.addCustomSeries(cloudView(), {
        ...common,
        lastValueVisible: false,
        title: '',
        upColor: lk.color,
        downColor: lk.custom ? lk.color : out.colorDown || out.color,
      }, pane)
    if (out.kind === 'signal')
      // Carries markers only: the points exist so markers have a time and a
      // value to sit against; the line itself is never drawn.
      return chart.addSeries(LineSeries, {
        ...common,
        color: lk.color,
        lineVisible: false,
        lastValueVisible: false,
        title: '',
      }, pane)
    if (out.kind === 'dots')
      return chart.addSeries(LineSeries, {
        ...common,
        color: lk.color,
        lineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 1.6,
      }, pane)
    if (out.kind === 'histogram')
      return chart.addSeries(HistogramSeries, {
        ...common,
        color: lk.color,
        priceFormat: { type: 'volume' },
      }, pane)
    return chart.addSeries(LineSeries, {
      ...common,
      color: lk.color,
      lineWidth: lk.width,
      lineStyle: lk.lineStyle,
      lineType: out.kind === 'step' ? 1 : 0,
    }, pane)
  }

  /**
   * Bring a held series in line with the instance's Style settings. Cheap to
   * call every refresh: it only touches the series when the look changed.
   */
  function applyLook(h: Held, out: OutputDef, inst: IndicatorInstance, force = false): void {
    const lk = outputLook(inst, out)
    const sig = JSON.stringify(lk)
    if (!force && h.lookSig === sig) return
    h.lookSig = sig
    const kind = out.kind || 'line'
    if (kind === 'cloud')
      h.series.applyOptions({
        visible: lk.visible,
        upColor: lk.color,
        downColor: lk.custom ? lk.color : out.colorDown || out.color,
      })
    else if (kind === 'line' || kind === 'step')
      h.series.applyOptions({
        visible: lk.visible,
        color: lk.color,
        lineWidth: lk.width,
        lineStyle: lk.lineStyle,
      })
    else h.series.applyOptions({ visible: lk.visible, color: lk.color })
  }

  function histColor(
    def: IndicatorDef,
    out: OutputDef,
    values: (number | null)[],
    i: number,
    c: CandleFlat,
  ): string {
    if (def.id === 'volume') return volumeColor(c.c >= c.o)
    const v = values[i] as number
    if (out.colorBy === 'slope') {
      const prev = values[i - 1]
      return prev == null || v > prev ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)'
    }
    return v >= 0 ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)'
  }

  /**
   * Hand a series its points. A live tick only moves the last bar, so when
   * the point count and first time are unchanged the last point goes through
   * update(); re-sending thousands of points with setData four times a second
   * (once per panel) also rebuilt the time scale each time. A full setData
   * still runs every tenth refresh, for outputs that revise earlier bars
   * (pivots, repainting scripts).
   */
  function pushData(h: Held, data: Any[]): void {
    const n = data.length
    const first = n ? data[0].time : null
    if (n && h.n === n && h.first === first && (h.updates ?? 0) < 10) {
      h.series.update(data[n - 1])
      h.updates = (h.updates ?? 0) + 1
      return
    }
    h.series.setData(data)
    h.n = n
    h.first = first
    h.updates = 0
  }

  /** Full redraw for the given candles. Cheap enough to run on every data load. */
  function renderIndicators(candles: CandleFlat[]): void {
    if (!chart) return
    const wanted = new Set<string>()
    const panes: string[] = []

    // Visibility tab: instances switched off for this interval group draw
    // nothing (and their series go), though others may still read them.
    const tf = tfGroupFor(barStepMs(candles))
    const pineShown = new Set<string>()
    computeActive(candles).forEach(({ inst, def, outputs: outs, host }) => {
      if (!shownOnTf(inst, tf)) return
      const scaleId = scaleOf(host)
      if (scaleId !== 'right' && def.outputs.length && panes.indexOf(scaleId) === -1)
        panes.push(scaleId)
      let lineHost: Held | null = null
      const pineHost: { h: Held | null } = { h: null }
      def.outputs.forEach((out) => {
        const key = keyOf(inst, out.key)
        wanted.add(key)
        const kind = out.kind || 'line'
        let h = held.get(key)
        // A precision taken off again leaves a series rebuilt rather than
        // guessing the format it had before.
        const unfixed = h?.fixedPrec != null && inst.precision == null
        if (!h || h.scaleId !== scaleId || h.kind !== kind || unfixed) {
          if (h) {
            try {
              chart.removeSeries(h.series)
            } catch (e) {
              /* already gone */
            }
          }
          h = { series: makeSeries(out, scaleId, inst), outputKey: out.key, scaleId, kind }
          h.lookSig = JSON.stringify(outputLook(inst, out))
          held.set(key, h)
        } else applyLook(h, out, inst)
        const lk = outputLook(inst, out)
        if (!lineHost && kind !== 'signal' && kind !== 'cloud') lineHost = h
        // Pine drawings hang off a plotted series where there is one.
        const plotted = (k: string) => k !== 'signal' && k !== 'cloud'
        if (!pineHost.h || (plotted(kind) && !plotted(pineHost.h.kind))) pineHost.h = h
        const data: Any[] = []
        if (out.kind === 'cloud') {
          const a = outs[out.between?.[0] || ''] || []
          const b = outs[out.between?.[1] || ''] || []
          for (let i = 0; i < candles.length; i++) {
            const va = a[i]
            const vb = b[i]
            if (va == null || vb == null || !isFinite(va) || !isFinite(vb)) continue
            // Pine fill() coloured per bar.
            const own = lk.custom ? undefined : out.colors?.[i]
            data.push({ time: Math.floor(candles[i].t / 1000), a: va, b: vb, ...(own ? { color: own } : {}) })
          }
          pushData(h, data)
          return
        }
        const values = outs[out.key] || []
        const markers: Any[] = []
        const codes = out.labelFrom ? outs[out.labelFrom.key] : null
        for (let i = 0; i < candles.length; i++) {
          const v = values[i]
          const time = Math.floor(candles[i].t / 1000)
          if (v == null || !isFinite(v)) {
            // Whitespace: the line breaks here instead of joining across.
            if (out.gaps) data.push({ time })
            continue
          }
          const point: Any = { time, value: v }
          const own = out.colors?.[i]
          if (lk.custom) {
            if (out.kind === 'histogram') point.color = lk.color
          } else if (own) point.color = own
          else if (out.kind === 'histogram')
            point.color =
              def.id === PINE_TYPE ? out.color : histColor(def, out, values, i, candles[i])
          data.push(point)
          if (out.kind === 'signal' && out.marker) {
            const code = codes?.[i]
            markers.push({
              time,
              position: out.marker.position,
              shape: out.marker.shape,
              color: lk.color,
              size: 1,
              ...(code != null && out.labelFrom?.texts[code]
                ? { text: out.labelFrom.texts[code] }
                : {}),
            })
          }
        }
        if (out.markers)
          out.markers.forEach((m) => {
            const c = candles[m.i]
            if (!c && m.t == null) return
            // A Pine result may be one run behind the candles: place by time.
            if (m.t != null && (m.t < candles[0].t || m.t > candles[candles.length - 1].t)) return
            markers.push({
              time: Math.floor((m.t ?? c.t) / 1000),
              position: m.position,
              shape: m.shape,
              color: m.color,
              text: m.text,
              size: 1,
            })
          })
        pushData(h, data)
        syncPaneFormat(h, data, inst.precision)
        // lightweight-charts v5: markers are a plugin on the series.
        if (out.kind === 'signal') {
          if (!h.markers) h.markers = createSeriesMarkers(h.series, [])
          h.markers.setMarkers(markers)
        }
      })
      // hline()s ride on the first drawn series; when that series is swapped
      // the new one starts without lines, so its signature starts empty.
      if (lineHost) syncPriceLines(lineHost, def, inst)
      if (inst.type === PINE_TYPE && pineHost.h) {
        pineShown.add(inst.uid)
        pineDraw.sync(inst.uid, pineHost.h.series, candles, chart)
      }
    })
    pineDraw.sweep(pineShown)

    held.forEach((h, key) => {
      if (wanted.has(key)) return
      try {
        chart.removeSeries(h.series)
      } catch (e) {
        /* already gone */
      }
      held.delete(key)
    })

    // Pane sizes are set only when panes come or go: re-applying them on
    // every refresh (four times a second) undid a divider drag at once.
    if (panes.join('|') !== paneOrder.join('|')) {
      paneOrder = panes
      layoutScales()
    }
  }

  function paneOf(uid: string): number {
    for (const [key, h] of held) {
      if (!key.startsWith(uid + '.') || h.scaleId === 'right') continue
      try {
        return h.series.getPane().paneIndex()
      } catch (e) {
        return 0
      }
    }
    return 0
  }

  /** Volume-scale indicators; everything else is a price or an oscillator. */
  const BIG_SCALE = ['volume', 'obv']
  function indicatorLegend(candles: CandleFlat[], at?: number): LegendEntry[] {
    if (!candles.length) return []
    // `at`: the bar under the crosshair; the live bar otherwise.
    const i = at != null && at >= 0 && at < candles.length ? at : candles.length - 1
    const out: LegendEntry[] = []
    const tf = tfGroupFor(barStepMs(candles))
    computeActive(candles).forEach(({ inst, def, outputs: outs }) => {
      if (!shownOnTf(inst, tf)) return
      const big = BIG_SCALE.indexOf(def.id) !== -1
      const parts = valueOutputs(def)
        .filter((o) => outputLook(inst, o).visible)
        .map((o) => ({
          label: o.label,
          value: outs[o.key]?.[i] as number,
          color: outputLook(inst, o).color,
          big,
        }))
        .filter((p) => p.value != null && isFinite(p.value))
      if (parts.length) out.push({ uid: inst.uid, label: instanceLabel(def, inst.params), parts })
      // A Pine script that failed shows as a badge rather than disappearing.
      else if (inst.type === PINE_TYPE && pineStatus(inst).error)
        out.push({ uid: inst.uid, label: def.name + ' ⚠ error', parts: [] })
    })
    // Hidden ones stay listed, greyed out, so the legend's eye can bring them back.
    getItems().forEach((inst) => {
      if (inst.visible) return
      const def = instanceDef(inst)
      if (def)
        out.push({ uid: inst.uid, label: instanceLabel(def, inst.params), parts: [], hidden: true })
    })
    return out
  }

  /** Re-tint every series — called when the palette or light/dark mode changes. */
  function refreshIndicatorColors(): void {
    active().forEach(({ inst, def }) => {
      def.outputs.forEach((out) => {
        const h = held.get(keyOf(inst, out.key))
        if (h) applyLook(h, out, inst, true)
      })
    })
  }

  /** Empty every series but keep it, so a new dataset can land on a clean time scale. */
  function blankIndicators(): void {
    held.forEach((h) => {
      h.series.setData([])
      h.n = 0
    })
  }

  function clearIndicators(): void {
    pineDraw.sweep(new Set())
    held.forEach((h) => {
      try {
        chart?.removeSeries(h.series)
      } catch (e) {
        /* already gone */
      }
    })
    held.clear()
    paneOrder = []
  }

  return {
    attach: attachIndicatorChart,
    render: renderIndicators,
    legend: indicatorLegend,
    refreshColors: refreshIndicatorColors,
    clear: clearIndicators,
    blank: blankIndicators,
    paneCount: indicatorPaneCount,
    paneOf,
  }
}

/** Values at the last candle, for the chart legend. */
export interface LegendEntry {
  /** The instance, for the legend's show/hide and remove actions. */
  uid: string
  label: string
  /** Switched off: listed without values. */
  hidden?: boolean
  /** `big` marks a count-scale value (volume, OBV) that reads better as 1.2M. */
  parts: Array<{ label: string; value: number; color: string; big: boolean }>
}

// ---------------------------------------------------------------- main chart

const main = createIndicatorRenderer(getIndicators, { pineBarColors: true })
export const attachIndicatorChart = (c: Any): void => main.attach(c)
/** Full redraw for the given candles. Cheap enough to run on every data load. */
export const renderIndicators = (candles: CandleFlat[]): void => main.render(candles)
export const indicatorLegend = (candles: CandleFlat[], at?: number): LegendEntry[] =>
  main.legend(candles, at)
/** Re-tint every series — called when the palette or light/dark mode changes. */
export const refreshIndicatorColors = (): void => main.refreshColors()
export const clearIndicators = (): void => main.clear()
export const blankIndicators = (): void => main.blank()
/** How many indicator panes currently occupy the bottom of the main chart. */
export const indicatorPaneCount = (): number => main.paneCount()
/** The pane (0 = price) a main-chart indicator draws in. */
export const indicatorPaneOf = (uid: string): number => main.paneOf(uid)
