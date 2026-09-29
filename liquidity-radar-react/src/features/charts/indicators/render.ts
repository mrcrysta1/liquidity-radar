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
import type { CandleFlat } from '../../../services/market'
import type { IndicatorInstance } from './store'
import { getIndicators } from './store'
import { indicatorDef, instanceLabel, sourceSeries, valueOutputs } from './registry'
import type { IndicatorDef, OutputDef } from './registry'
import { computeAll } from './graph'
import type { Computed } from './graph'
import { cloudView } from './cloud'
import { PINE_TYPE, pineLive, pineStatus } from '../pine/indicator'

type Any = any

interface Held {
  series: Any
  outputKey: string
  scaleId: string
  kind: string
  /** Price lines (Pine hline) on this series, and what they were built from. */
  lines?: Any[]
  linesSig?: string
}

export interface IndicatorRendererOptions {
  /** Lay out the chart's own price scales around `bottom` (the fraction the
   *  indicator panes take). Default: candles on 'right' get the rest. */
  priceLayout?(chart: Any, bottom: number): void
}

export interface IndicatorRenderer {
  attach(chart: Any): void
  render(candles: CandleFlat[]): void
  legend(candles: CandleFlat[]): LegendEntry[]
  refreshColors(): void
  clear(): void
  paneCount(): number
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

  /** How many indicator panes currently occupy the bottom of the chart — used
   * by the Delta pane to stack under them instead of overlapping. */
  function indicatorPaneCount(): number {
    return paneOrder.length
  }

  function attachIndicatorChart(c: Any): void {
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
  function computeActive(candles: CandleFlat[]): Array<Computed<IndicatorInstance>> {
    return computeAll(
      getItems(),
      candles,
      (inst, c) => (inst.type === PINE_TYPE ? pineLive(inst, c) : indicatorDef(inst.type)),
      sourceSeries,
    )
  }

  const LINE_STYLE = { solid: 0, dotted: 1, dashed: 2 } as const
  /** Pine hline()s as price lines on the instance's first drawn series. */
  function syncPriceLines(h: Held, def: IndicatorDef): void {
    const want = def.hlines || []
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
  }

  /**
   * Stack the price scales: candles keep the top, panes divide the bottom third
   * (or half, once there are two or more) evenly between them.
   */
  function layoutScales(): void {
    if (!chart) return
    const panes = paneOrder
    const n = panes.length
    const bottom = n === 0 ? 0 : n === 1 ? 0.3 : Math.min(0.62, 0.22 * n)
    try {
      if (opts.priceLayout) opts.priceLayout(chart, bottom)
      else chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom } })
    } catch (e) {
      /* scale not mounted yet */
    }
    panes.forEach((scaleId, i) => {
      const slice = bottom / n
      const top = 1 - bottom + slice * i
      try {
        chart
          .priceScale(scaleId)
          .applyOptions({ scaleMargins: { top: top + 0.012, bottom: 1 - (top + slice) + 0.012 } })
      } catch (e) {
        /* scale removed between frames */
      }
    })
  }

  function makeSeries(out: OutputDef, scaleId: string): Any {
    const inPane = scaleId !== 'right'
    const common = {
      priceScaleId: scaleId,
      lastValueVisible: inPane,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      title: inPane ? out.label : '',
    }
    if (out.kind === 'cloud')
      return chart.addCustomSeries(cloudView(), {
        ...common,
        lastValueVisible: false,
        title: '',
        upColor: out.color,
        downColor: out.colorDown || out.color,
      })
    if (out.kind === 'signal')
      // Carries markers only: the points exist so markers have a time and a
      // value to sit against; the line itself is never drawn.
      return chart.addLineSeries({
        ...common,
        color: out.color,
        lineVisible: false,
        lastValueVisible: false,
        title: '',
      })
    if (out.kind === 'dots')
      return chart.addLineSeries({
        ...common,
        color: out.color,
        lineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 1.6,
      })
    if (out.kind === 'histogram')
      return chart.addHistogramSeries({
        ...common,
        color: out.color,
        priceFormat: { type: 'volume' },
      })
    return chart.addLineSeries({
      ...common,
      color: out.color,
      lineWidth: out.width ?? (out.dashed ? 1 : 2),
      lineStyle: out.dashed ? 2 : 0,
      lineType: out.kind === 'step' ? 1 : 0,
    })
  }

  function histColor(
    def: IndicatorDef,
    out: OutputDef,
    values: (number | null)[],
    i: number,
    c: CandleFlat,
  ): string {
    if (def.id === 'volume') return c.c >= c.o ? 'rgba(0,230,118,.4)' : 'rgba(255,23,68,.4)'
    const v = values[i] as number
    if (out.colorBy === 'slope') {
      const prev = values[i - 1]
      return prev == null || v > prev ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)'
    }
    return v >= 0 ? 'rgba(0,230,118,.55)' : 'rgba(255,23,68,.55)'
  }

  /** Full redraw for the given candles. Cheap enough to run on every data load. */
  function renderIndicators(candles: CandleFlat[]): void {
    if (!chart) return
    const wanted = new Set<string>()
    const panes: string[] = []

    computeActive(candles).forEach(({ inst, def, outputs: outs, host }) => {
      const scaleId = scaleOf(host)
      if (scaleId !== 'right' && def.outputs.length && panes.indexOf(scaleId) === -1)
        panes.push(scaleId)
      let lineHost: Held | null = null
      def.outputs.forEach((out) => {
        const key = keyOf(inst, out.key)
        wanted.add(key)
        const kind = out.kind || 'line'
        let h = held.get(key)
        if (!h || h.scaleId !== scaleId || h.kind !== kind) {
          if (h) {
            try {
              chart.removeSeries(h.series)
            } catch (e) {
              /* already gone */
            }
          }
          h = { series: makeSeries(out, scaleId), outputKey: out.key, scaleId, kind }
          held.set(key, h)
        }
        if (!lineHost && kind !== 'signal' && kind !== 'cloud') lineHost = h
        const data: Any[] = []
        if (out.kind === 'cloud') {
          const a = outs[out.between?.[0] || ''] || []
          const b = outs[out.between?.[1] || ''] || []
          for (let i = 0; i < candles.length; i++) {
            const va = a[i]
            const vb = b[i]
            if (va == null || vb == null || !isFinite(va) || !isFinite(vb)) continue
            data.push({ time: Math.floor(candles[i].t / 1000), a: va, b: vb })
          }
          h.series.setData(data)
          return
        }
        const values = outs[out.key] || []
        const markers: Any[] = []
        for (let i = 0; i < candles.length; i++) {
          const v = values[i]
          if (v == null || !isFinite(v)) continue
          const time = Math.floor(candles[i].t / 1000)
          const point: Any = { time, value: v }
          const own = out.colors?.[i]
          if (own) point.color = own
          else if (out.kind === 'histogram')
            point.color =
              def.id === PINE_TYPE ? out.color : histColor(def, out, values, i, candles[i])
          data.push(point)
          if (out.kind === 'signal' && out.marker)
            markers.push({
              time,
              position: out.marker.position,
              shape: out.marker.shape,
              color: out.color,
              size: 1,
            })
        }
        if (out.markers)
          out.markers.forEach((m) => {
            const c = candles[m.i]
            if (!c) return
            markers.push({
              time: Math.floor(c.t / 1000),
              position: m.position,
              shape: m.shape,
              color: m.color,
              text: m.text,
              size: 1,
            })
          })
        h.series.setData(data)
        if (out.kind === 'signal') h.series.setMarkers(markers)
      })
      // hline()s ride on the first drawn series; when that series is swapped
      // the new one starts without lines, so its signature starts empty.
      if (def.hlines && lineHost) syncPriceLines(lineHost, def)
    })

    held.forEach((h, key) => {
      if (wanted.has(key)) return
      try {
        chart.removeSeries(h.series)
      } catch (e) {
        /* already gone */
      }
      held.delete(key)
    })

    if (panes.join('|') !== paneOrder.join('|')) {
      paneOrder = panes
      layoutScales()
    } else if (panes.length) {
      layoutScales()
    }
  }

  /** Volume-scale indicators; everything else is a price or an oscillator. */
  const BIG_SCALE = ['volume', 'obv']
  function indicatorLegend(candles: CandleFlat[]): LegendEntry[] {
    if (!candles.length) return []
    const i = candles.length - 1
    const out: LegendEntry[] = []
    computeActive(candles).forEach(({ inst, def, outputs: outs }) => {
      const big = BIG_SCALE.indexOf(def.id) !== -1
      const parts = valueOutputs(def)
        .map((o) => ({ label: o.label, value: outs[o.key]?.[i] as number, color: o.color, big }))
        .filter((p) => p.value != null && isFinite(p.value))
      if (parts.length) out.push({ label: instanceLabel(def, inst.params), parts })
      // A Pine script that failed shows as a badge rather than disappearing.
      else if (inst.type === PINE_TYPE && pineStatus(inst).error)
        out.push({ label: def.name + ' ⚠ error', parts: [] })
    })
    return out
  }

  /** Re-tint every series — called when the palette or light/dark mode changes. */
  function refreshIndicatorColors(): void {
    active().forEach(({ inst, def }) => {
      def.outputs.forEach((out) => {
        const h = held.get(keyOf(inst, out.key))
        if (!h) return
        if (out.kind === 'cloud')
          h.series.applyOptions({ upColor: out.color, downColor: out.colorDown || out.color })
        else h.series.applyOptions({ color: out.color })
      })
    })
  }

  function clearIndicators(): void {
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
    paneCount: indicatorPaneCount,
  }
}

/** Values at the last candle, for the chart legend. */
export interface LegendEntry {
  label: string
  /** `big` marks a count-scale value (volume, OBV) that reads better as 1.2M. */
  parts: Array<{ label: string; value: number; color: string; big: boolean }>
}

// ---------------------------------------------------------------- main chart

const main = createIndicatorRenderer(getIndicators)
export const attachIndicatorChart = (c: Any): void => main.attach(c)
/** Full redraw for the given candles. Cheap enough to run on every data load. */
export const renderIndicators = (candles: CandleFlat[]): void => main.render(candles)
export const indicatorLegend = (candles: CandleFlat[]): LegendEntry[] => main.legend(candles)
/** Re-tint every series — called when the palette or light/dark mode changes. */
export const refreshIndicatorColors = (): void => main.refreshColors()
export const clearIndicators = (): void => main.clear()
/** How many indicator panes currently occupy the bottom of the main chart. */
export const indicatorPaneCount = (): number => main.paneCount()
