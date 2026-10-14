// Pine scripts as indicators on the price-action chart.
//
// A Pine instance lives in the indicator store like any other (type 'pine')
// and carries its source and input values. Its IndicatorDef is not in the
// static catalogue: it is built from the script's own output — one output
// per plot(), a marker output for plotshape/plotchar/plotarrow, and its
// hline()s — so render.ts draws it through the same paths as a built-in,
// and its plots can feed other indicators (indicator-on-indicator).
//
// Two ways to evaluate a script:
//  - pineMeta: a probe run over a small synthetic series, cached by source +
//    inputs. Enough to know the inputs, the plots and overlay/pane without a
//    chart — the store validates sources with it, the settings UI lists
//    inputs from it.
//  - pineLive: the real run over the chart's candles. Full history once;
//    after that a new bar (or new history) recomputes straight away, while
//    ticks on the forming bar are throttled (at least 1s apart, longer for
//    slow scripts). Errors are caught per script and reported, never thrown
//    into the chart.
import type { CandleFlat } from '../../../services/market'
import type { IndicatorDef, OutputDef } from '../indicators/registry'
import type { Series } from '../indicators/math'
import { runPine } from './runtime.ts'
import type { InputValue, PineInput, PineResult } from './runtime.ts'

export const PINE_TYPE = 'pine'
/** Longest script kept (characters) — it is persisted with the chart. */
export const MAX_SCRIPT = 32000

export interface PineInstance {
  uid: string
  type: string
  script?: string
  title?: string
  pineInputs?: Record<string, InputValue>
}

export interface PineStatus {
  title: string
  overlay: boolean
  inputs: PineInput[]
  warnings: string[]
  error?: string
  /** Time of the last full run, ms. */
  ms?: number
}

interface Built {
  def: IndicatorDef
  status: PineStatus
}

/** Titles end up in legend HTML: keep them plain text. */
export const cleanTitle = (t: string) =>
  t
    .replace(/[<>&"'`]/g, '')
    .trim()
    .slice(0, 60) || 'Pine script'

/** The script's own title, read without running it. */
export function scriptTitle(src: string): string {
  const m = /(?:indicator|study|strategy)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)/.exec(src)
  return cleanTitle(m ? m[1] : 'Pine script')
}

const signature = (inst: PineInstance) =>
  (inst.script || '') + '\u0000' + JSON.stringify(inst.pineInputs || {})

function outputKind(style: string): OutputDef['kind'] {
  if (style === 'histogram' || style === 'columns') return 'histogram'
  if (style === 'circles' || style === 'cross') return 'dots'
  if (style === 'stepline') return 'step'
  return 'line'
}

/** Turn a run into an IndicatorDef whose compute hands back its series. */
function build(inst: PineInstance, r: PineResult, candles: CandleFlat[], ms?: number): Built {
  const outputs: OutputDef[] = []
  const series: Record<string, Series> = {}
  r.plots.forEach((p) => {
    const key = 'p' + p.key.replace(/\W+/g, '_')
    outputs.push({
      key,
      label: cleanTitle(p.title),
      color: p.color,
      kind: outputKind(p.style),
      width: Math.max(1, Math.min(4, Math.round(p.linewidth))),
      colors: p.colors,
    })
    series[key] = p.values
  })
  if (r.shapes.length) {
    // Markers need a value to sit against: the bar's high/low on the price
    // pane; in a pane of its own, the script's first plot (so the hidden
    // carrier series never stretches the pane's scale).
    const first = r.plots[0]?.values
    const guide = r.hlines[0]?.price ?? 0
    const vals: Series = new Array(candles.length).fill(null)
    const markers: NonNullable<OutputDef['markers']> = []
    r.shapes.forEach((s) => {
      const c = candles[s.bar]
      if (!c) return
      const v = r.overlay ? (s.position === 'above' ? c.h : c.l) : (first?.[s.bar] ?? guide)
      if (v == null || !isFinite(v)) return
      if (vals[s.bar] == null) vals[s.bar] = v
      markers.push({
        i: s.bar,
        position: s.position === 'above' ? 'aboveBar' : 'belowBar',
        shape: s.shape,
        color: s.color,
        text: s.text ? cleanTitle(s.text).slice(0, 12) : undefined,
      })
    })
    outputs.push({ key: 'shapes', label: 'Shapes', color: '#2962ff', kind: 'signal', markers })
    series.shapes = vals
  }
  const title = cleanTitle(inst.title || r.title)
  const def: IndicatorDef = {
    id: PINE_TYPE,
    name: title,
    group: 'Oscillators',
    params: [],
    outputs,
    placement: r.overlay ? 'overlay' : 'pane',
    sourced: false,
    hlines: r.hlines.map((h) => ({ ...h, title: cleanTitle(h.title || '').slice(0, 24) })),
    compute: () => series,
  }
  return {
    def,
    status: { title, overlay: r.overlay, inputs: r.inputs, warnings: r.warnings, ms },
  }
}

function failed(inst: PineInstance, e: unknown, overlay: boolean, inputs: PineInput[]): Built {
  const title = cleanTitle(inst.title || scriptTitle(inst.script || ''))
  const def: IndicatorDef = {
    id: PINE_TYPE,
    name: title,
    group: 'Oscillators',
    params: [],
    outputs: [],
    placement: overlay ? 'overlay' : 'pane',
    sourced: false,
    compute: () => ({}),
  }
  const error = e instanceof Error ? e.message : String(e)
  return { def, status: { title, overlay, inputs, warnings: [], error } }
}

// ---- probe runs (no chart needed) ----
let probeBars: CandleFlat[] | null = null
function probeCandles(): CandleFlat[] {
  if (probeBars) return probeBars
  probeBars = Array.from({ length: 160 }, (_, i) => {
    const o = 100 + Math.sin(i / 7) * 10 + i * 0.05
    const c = o + Math.cos(i / 3) * 2
    return {
      t: Date.UTC(2024, 0, 1) + i * 3600000,
      o,
      h: Math.max(o, c) + 1,
      l: Math.min(o, c) - 1,
      c,
      v: 100 + (i % 9) * 10,
    }
  })
  return probeBars
}
const meta = new Map<string, Built>()
/** What a script declares (inputs, plots, overlay), from a probe run. */
export function pineMeta(inst: PineInstance): Built {
  const sig = signature(inst) + '\u0000' + (inst.title || '')
  const hit = meta.get(sig)
  if (hit) return hit
  let b: Built
  try {
    b = build(
      inst,
      runPine(inst.script || '', probeCandles(), inst.pineInputs, { maxMs: 600 }),
      probeCandles(),
    )
  } catch (e) {
    b = failed(inst, e, /overlay\s*=\s*true/.test(inst.script || ''), [])
  }
  if (meta.size > 64) meta.clear()
  meta.set(sig, b)
  return b
}

/** Compile + probe-run a source: null when it runs, else the error text. */
export function checkScript(src: string): { error: string | null; result?: PineResult } {
  try {
    return { error: null, result: runPine(src, probeCandles(), {}, { maxMs: 1500 }) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ---- live runs over the chart's candles ----
interface Live extends Built {
  sig: string
  /** Everything but the forming bar: length, ends, and a couple of closes. */
  shape: string
  last: string
  at: number
  throttle: number
}
const live = new Map<string, Live>()
const statusListeners: Array<() => void> = []
export function subscribePine(fn: () => void): () => void {
  statusListeners.push(fn)
  return () => {
    const i = statusListeners.indexOf(fn)
    if (i !== -1) statusListeners.splice(i, 1)
  }
}
const statusKey = (s: PineStatus) =>
  (s.error || '') + '|' + s.warnings.join(',') + '|' + s.inputs.map((i) => i.key).join(',')

/** The def to draw with, computed over `candles` (cached/throttled). */
export function pineLive(inst: PineInstance, candles: CandleFlat[]): IndicatorDef {
  const n = candles.length
  if (!n) return pineMeta(inst).def
  const sig = signature(inst) + '\u0000' + (inst.title || '')
  const lc = candles[n - 1]
  const shape = [n, candles[0].t, candles[0].c, lc.t, n > 1 ? candles[n - 2].c : ''].join(':')
  const last = [lc.o, lc.h, lc.l, lc.c, lc.v].join(':')
  const prev = live.get(inst.uid)
  const now = Date.now()
  if (prev && prev.sig === sig && prev.shape === shape) {
    if (prev.last === last) return prev.def
    // Only the forming bar moved: a slow script is not re-run on every tick.
    if (now - prev.at < prev.throttle) return prev.def
  }
  const t0 = Date.now()
  let b: Built
  try {
    b = build(inst, runPine(inst.script || '', candles, inst.pineInputs), candles)
  } catch (e) {
    const m = pineMeta(inst)
    b = failed(inst, e, m.status.overlay, m.status.inputs)
  }
  const ms = Date.now() - t0
  b.status.ms = ms
  const entry: Live = {
    ...b,
    sig,
    shape,
    last,
    at: Date.now(),
    throttle: Math.min(10000, Math.max(1000, ms * 10)),
  }
  live.set(inst.uid, entry)
  if (!prev || statusKey(prev.status) !== statusKey(b.status)) {
    // Told after the draw that found it, not during it.
    queueMicrotask(() => statusListeners.slice().forEach((fn) => fn()))
  }
  return entry.def
}

/** Latest known status for an instance: its live run, else a probe run. */
export function pineStatus(inst: PineInstance): PineStatus {
  const l = live.get(inst.uid)
  if (l && l.sig === signature(inst) + '\u0000' + (inst.title || '')) return l.status
  return pineMeta(inst).status
}

/** Drop the cached run for an instance (it was removed). */
export function forgetPine(uid: string): void {
  live.delete(uid)
}
