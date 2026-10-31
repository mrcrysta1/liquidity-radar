// Indicator-on-indicator evaluation (the Pro terminal's computeAll, with cycle
// protection). An instance's `source` is either a price field ('close',
// 'volume', …) or another instance's output, written `uid.outputKey` — an RSI
// of an OBV, an SMA of Volume, a Z-score of MACD.
//
// Every instance has at most one source, so the dependencies form chains, and
// a cycle is found by walking a chain until it repeats. Kept free of runtime
// imports (defs and base sources are passed in) so the engine tests can run
// it directly under Node.
import type { CandleFlat } from '../../../services/market'
import type { Series } from './math'
import type { IndicatorDef, SourceKey } from './registry'
import { mapAligned } from './mtf.ts'

/**
 * Higher-timeframe bars an instance computes on (multi-timeframe input), and
 * the alignIndex map from chart bars to them (see ./mtf).
 */
export interface Frame {
  candles: CandleFlat[]
  idx: number[]
}

export interface GraphInstance {
  uid: string
  type: string
  params: Record<string, number>
  source: string
  visible: boolean
}

export interface Computed<I extends GraphInstance = GraphInstance> {
  inst: I
  def: IndicatorDef
  outputs: Record<string, Series>
  /** uid of the pane this instance draws in; null for the price pane. */
  host: string | null
}

export function sourceRef(source: string): { uid: string; key: string } | null {
  const dot = source.indexOf('.')
  return dot > 0 ? { uid: source.slice(0, dot), key: source.slice(dot + 1) } : null
}

/**
 * True when giving `uid` this source would make it depend on itself, directly
 * or through a chain. A chain that already loops (bad saved state) counts too.
 */
export function createsCycle(items: GraphInstance[], uid: string, source: string): boolean {
  const seen = new Set<string>()
  let ref = sourceRef(source)
  while (ref) {
    if (ref.uid === uid || seen.has(ref.uid)) return true
    seen.add(ref.uid)
    const id = ref.uid
    const next = items.find((i) => i.uid === id)
    if (!next) return false
    ref = sourceRef(next.source)
  }
  return false
}

/**
 * Compute every visible instance, plus any hidden ones a visible instance
 * reads from. Instances in a cycle, or reading a missing instance/output,
 * are skipped rather than thrown on.
 */
export function computeAll<I extends GraphInstance>(
  items: I[],
  candles: CandleFlat[],
  /** The def for an instance: a catalogue lookup by type, or — for a Pine
   *  script — one built from the script's run over these candles. */
  defOf: (inst: I, candles: CandleFlat[]) => IndicatorDef | null,
  baseSource: (key: SourceKey, c: CandleFlat[]) => number[],
  /** A higher timeframe to compute an instance on, or null for the chart's. */
  frameOf?: (inst: I, def: IndicatorDef) => Frame | null,
): Array<Computed<I>> {
  const byUid = new Map<string, I>()
  items.forEach((i) => byUid.set(i.uid, i))
  const done = new Map<string, Computed<I> | null>()
  const visiting = new Set<string>()

  const get = (uid: string): Computed<I> | null => {
    if (done.has(uid)) return done.get(uid) as Computed<I> | null
    const inst = byUid.get(uid)
    const def = inst ? defOf(inst, candles) : null
    if (!inst || !def || visiting.has(uid)) return null
    visiting.add(uid)
    let result: Computed<I> | null
    try {
      result = evaluate(inst, def)
    } finally {
      visiting.delete(uid)
    }
    done.set(uid, result)
    return result
  }

  const evaluate = (inst: I, def: IndicatorDef): Computed<I> | null => {
    const p: Record<string, number> = {}
    def.params.forEach((x) => (p[x.key] = inst.params[x.key] ?? x.default))
    const ref = def.sourced ? sourceRef(inst.source) : null
    let host: string | null = def.placement === 'pane' ? inst.uid : null
    if (!candles.length) return { inst, def, outputs: {}, host }
    if (!ref) {
      const key = (def.sourced ? inst.source : 'close') as SourceKey
      // A price overlay fed volume would squash the candles; give it a pane.
      if (def.placement === 'overlay' && key === 'volume') host = inst.uid
      const frame = frameOf ? frameOf(inst, def) : null
      if (frame && frame.candles.length) {
        const raw = def.compute(baseSource(key, frame.candles), frame.candles, p)
        // Markers (and the codes naming them) once per higher-timeframe bar.
        const once = new Set<string>()
        def.outputs.forEach((o) => {
          if (o.kind === 'signal') once.add(o.key)
          if (o.labelFrom) once.add(o.labelFrom.key)
        })
        const outputs: Record<string, Series> = {}
        for (const k in raw) outputs[k] = mapAligned(raw[k], frame.idx, once.has(k))
        return { inst, def, outputs, host }
      }
      return { inst, def, outputs: def.compute(baseSource(key, candles), candles, p), host }
    }
    const dep = get(ref.uid)
    const series = dep?.outputs[ref.key]
    if (!dep || !series) return null
    // An overlay draws where its source lives; a pane indicator gets its own.
    if (def.placement === 'overlay') host = dep.host
    // Interior gaps carry the last value forward (see onDefined); leading
    // warm-up stays NaN and is trimmed below.
    let last = NaN
    const src = series.map((v) => (v == null || !Number.isFinite(v) ? last : (last = v)))
    // Trim the source's warm-up so the dependent seeds on real values, then
    // pad back so indices keep lining up with candles.
    let f = src.findIndex((v) => Number.isFinite(v))
    if (f < 0) f = src.length
    const raw = def.compute(src.slice(f), candles.slice(f), p)
    const outputs: Record<string, Series> = {}
    for (const k in raw) {
      const pad: Series = Array(f).fill(null)
      outputs[k] = pad.concat(raw[k].map((v) => (v == null || !Number.isFinite(v) ? null : v)))
    }
    return { inst, def, outputs, host }
  }

  const out: Array<Computed<I>> = []
  items.forEach((inst) => {
    if (!inst.visible) return
    let c: Computed<I> | null = null
    try {
      c = get(inst.uid)
    } catch (e) {
      console.warn('indicator', inst.type, e)
    }
    if (c) out.push(c)
  })
  return out
}
