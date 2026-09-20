// Draws the active indicators onto the price-action chart.
//
// Overlays share the price scale; each pane indicator gets its own scale, and
// the scales are stacked so panes sit under the candles in the order they were
// added. Series are keyed by instance uid + output key, so a param change
// redraws in place rather than tearing every series down.
import type { CandleFlat } from '../../../services/market'
import type { IndicatorInstance } from './store'
import { getIndicators } from './store'
import { indicatorDef, instanceLabel, sourceSeries } from './registry'
import type { IndicatorDef } from './registry'

type Any = any

interface Held {
  series: Any
  outputKey: string
  scaleId: string
}

let chart: Any = null
const held = new Map<string, Held>()
/** Price-scale margins recomputed whenever the set of panes changes. */
let paneOrder: string[] = []

export function attachIndicatorChart(c: Any): void {
  chart = c
  held.clear()
  paneOrder = []
}

const keyOf = (inst: IndicatorInstance, out: string) => inst.uid + '.' + out
const scaleOf = (inst: IndicatorInstance, def: IndicatorDef) =>
  def.placement === 'overlay' ? 'right' : 'ind_' + inst.uid

/** Live instances that should actually draw. */
function active(): Array<{ inst: IndicatorInstance; def: IndicatorDef }> {
  const out: Array<{ inst: IndicatorInstance; def: IndicatorDef }> = []
  getIndicators().forEach((inst) => {
    const def = indicatorDef(inst.type)
    if (def && inst.visible) out.push({ inst, def })
  })
  return out
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

function makeSeries(def: IndicatorDef, out: IndicatorDef['outputs'][0], scaleId: string): Any {
  const common = {
    priceScaleId: scaleId,
    lastValueVisible: def.placement === 'pane',
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    title: def.placement === 'pane' ? out.label : '',
  }
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
  })
}

/** Full redraw for the given candles. Cheap enough to run on every data load. */
export function renderIndicators(candles: CandleFlat[]): void {
  if (!chart) return
  const live = active()
  const wanted = new Set<string>()
  const panes: string[] = []

  live.forEach(({ inst, def }) => {
    const scaleId = scaleOf(inst, def)
    if (def.placement === 'pane' && panes.indexOf(scaleId) === -1) panes.push(scaleId)
    const src = def.sourced ? sourceSeries(inst.source, candles) : []
    let outs: Record<string, (number | null)[]> = {}
    try {
      outs = candles.length ? def.compute(src, candles, inst.params) : {}
    } catch (e) {
      console.warn('indicator', inst.type, e)
      return
    }
    def.outputs.forEach((out) => {
      const key = keyOf(inst, out.key)
      wanted.add(key)
      let h = held.get(key)
      if (!h || h.scaleId !== scaleId) {
        if (h) {
          try {
            chart.removeSeries(h.series)
          } catch (e) {
            /* already gone */
          }
        }
        h = { series: makeSeries(def, out, scaleId), outputKey: out.key, scaleId }
        held.set(key, h)
      }
      const values = outs[out.key] || []
      const data: Any[] = []
      for (let i = 0; i < candles.length; i++) {
        const v = values[i]
        if (v == null || !isFinite(v)) continue
        const point: Any = { time: Math.floor(candles[i].t / 1000), value: v }
        if (out.kind === 'histogram')
          point.color =
            def.id === 'volume'
              ? candles[i].c >= candles[i].o
                ? 'rgba(0,230,118,.4)'
                : 'rgba(255,23,68,.4)'
              : v >= 0
                ? 'rgba(0,230,118,.55)'
                : 'rgba(255,23,68,.55)'
        data.push(point)
      }
      h.series.setData(data)
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
  active().forEach(({ inst, def }) => {
    const src = def.sourced ? sourceSeries(inst.source, candles) : []
    let outs: Record<string, (number | null)[]> = {}
    try {
      outs = def.compute(src, candles, inst.params)
    } catch (e) {
      return
    }
    const big = BIG_SCALE.indexOf(def.id) !== -1
    const parts = def.outputs
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
      if (h) h.series.applyOptions({ color: out.color })
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
