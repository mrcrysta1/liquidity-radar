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
import type { CandleFlat } from '../../../services/market'
import type { IndicatorInstance } from './store'
import { getIndicators } from './store'
import { indicatorDef, instanceLabel, sourceSeries, valueOutputs } from './registry'
import type { IndicatorDef, OutputDef } from './registry'
import { computeAll } from './graph'
import type { Computed } from './graph'
import { cloudView } from './cloud'

type Any = any

interface Held {
  series: Any
  outputKey: string
  scaleId: string
  kind: string
}

let chart: Any = null
const held = new Map<string, Held>()
/** Price-scale margins recomputed whenever the set of panes changes. */
let paneOrder: string[] = []

/** How many indicator panes currently occupy the bottom of the chart — used
 * by the Delta pane to stack under them instead of overlapping. */
export function indicatorPaneCount(): number {
  return paneOrder.length
}

export function attachIndicatorChart(c: Any): void {
  chart = c
  held.clear()
  paneOrder = []
}

const keyOf = (inst: IndicatorInstance, out: string) => inst.uid + '.' + out
const scaleOf = (host: string | null) => (host ? 'ind_' + host : 'right')

/** Live instances that should actually draw. */
function active(): Array<{ inst: IndicatorInstance; def: IndicatorDef }> {
  const out: Array<{ inst: IndicatorInstance; def: IndicatorDef }> = []
  getIndicators().forEach((inst) => {
    const def = indicatorDef(inst.type)
    if (def && inst.visible) out.push({ inst, def })
  })
  return out
}

/** Every visible instance computed, sources resolved in dependency order. */
function computeActive(candles: CandleFlat[]): Array<Computed<IndicatorInstance>> {
  return computeAll(getIndicators(), candles, indicatorDef, sourceSeries)
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
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom } })
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
    lineWidth: out.dashed ? 1 : 2,
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
export function renderIndicators(candles: CandleFlat[]): void {
  if (!chart) return
  const wanted = new Set<string>()
  const panes: string[] = []

  computeActive(candles).forEach(({ inst, def, outputs: outs, host }) => {
    const scaleId = scaleOf(host)
    if (scaleId !== 'right' && panes.indexOf(scaleId) === -1) panes.push(scaleId)
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
        if (out.kind === 'histogram') point.color = histColor(def, out, values, i, candles[i])
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
      h.series.setData(data)
      if (out.kind === 'signal') h.series.setMarkers(markers)
    })
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

/** Values at the last candle, for the chart legend. */
export interface LegendEntry {
  label: string
  /** `big` marks a count-scale value (volume, OBV) that reads better as 1.2M. */
  parts: Array<{ label: string; value: number; color: string; big: boolean }>
}
/** Volume-scale indicators; everything else is a price or an oscillator. */
const BIG_SCALE = ['volume', 'obv']
export function indicatorLegend(candles: CandleFlat[]): LegendEntry[] {
  if (!candles.length) return []
  const i = candles.length - 1
  const out: LegendEntry[] = []
  computeActive(candles).forEach(({ inst, def, outputs: outs }) => {
    const big = BIG_SCALE.indexOf(def.id) !== -1
    const parts = valueOutputs(def)
      .map((o) => ({ label: o.label, value: outs[o.key]?.[i] as number, color: o.color, big }))
      .filter((p) => p.value != null && isFinite(p.value))
    if (parts.length) out.push({ label: instanceLabel(def, inst.params), parts })
  })
  return out
}

/** Re-tint every series — called when the palette or light/dark mode changes. */
export function refreshIndicatorColors(): void {
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

export function clearIndicators(): void {
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
