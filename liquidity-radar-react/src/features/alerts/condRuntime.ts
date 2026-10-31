// Runtime side of "Conditions" alerts: turns a rule's indicator snapshot and
// Pine scripts into the series ./conditions judges, over whatever candles the
// alert engine has for the rule's symbol and interval.
//
// Indicator outputs go through the chart's own graph (indicators/graph
// computeAll), so an alert sees exactly the values the legend shows —
// indicator-on-indicator chains included. A Pine plot runs through
// pine/indicator's pineLive under an alert-only uid, so the alert's run never
// replaces the chart's cached run of the same script on other candles.
//
// Pine alertcondition() values are not part of the IndicatorDef pineLive
// builds, so they come from a run of our own: the same worker file the chart
// uses (pine/pine.worker.ts posts the whole PineResult back). Runs are async:
// until one lands the condition has no value and the rule is judged next time
// (onCondData tells the engine when to look again).
import type { CandleFlat } from '../../services/market'
import { computeAll } from '../charts/indicators/graph'
import { indicatorDef, sourceSeries, valueOutputs, instanceLabel } from '../charts/indicators/registry'
import type { IndicatorDef } from '../charts/indicators/registry'
import { getIndicators, instanceDef } from '../charts/indicators/store'
import type { IndicatorInstance } from '../charts/indicators/store'
import { sourceRef } from '../charts/indicators/graph'
import { PINE_TYPE, checkScript, forgetPine, onPineResult, pineLive, pinePeriod } from '../charts/pine/indicator'
import { runPine } from '../charts/pine/runtime'
import type { InputValue, PineResult } from '../charts/pine/runtime'
import { condUids } from './conditions'
import type { CondCtx } from './conditions'
import type { AlertRule, IndSnap } from './rules'

/** What runtime.ts will expose (another change adds it): read defensively so
 *  this compiles and runs whether or not the field exists yet. */
export interface PineAlertCondition {
  title: string
  message: string
  values: (boolean | null)[]
}
const alertConditionsOf = (r: PineResult | undefined | null): PineAlertCondition[] =>
  (r as (PineResult & { alertconditions?: PineAlertCondition[] }) | null | undefined)?.alertconditions ?? []

const listeners = new Set<() => void>()
/** Told when async data for a conditions rule arrives (a Pine run finished). */
export function onCondData(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
let notifyQueued = false
function notifyData(): void {
  if (notifyQueued) return
  notifyQueued = true
  // Several runs often land together; judge once.
  setTimeout(() => {
    notifyQueued = false
    listeners.forEach((f) => f())
  }, 50)
}
// A chart-side Pine run finishing may be an alert's pineLive run too.
onPineResult(() => {
  if (pineAlertUids.size) notifyData()
})

// ---------------------------------------------------------------- chart picks

/** One choosable series on the main chart: an indicator output. */
export interface OutputPick {
  uid: string
  key: string
  label: string
}

/** Every value output of every indicator on the main chart, for the pickers. */
export function chartOutputs(): OutputPick[] {
  const out: OutputPick[] = []
  getIndicators().forEach((inst) => {
    const def = instanceDef(inst)
    if (!def) return
    const name = inst.type === PINE_TYPE ? def.name : instanceLabel(def, inst.params)
    const outs = valueOutputs(def)
    outs.forEach((o) =>
      out.push({ uid: inst.uid, key: o.key, label: outs.length > 1 ? name + ' · ' + o.label : name }),
    )
  })
  return out
}

/** A Pine instance on the main chart and the alertconditions it declares. */
export interface PinePick {
  uid: string
  title: string
  conds: Array<{ idx: number; title: string; message: string }>
}
const declared = new Map<string, PinePick['conds']>()
/** The main chart's Pine scripts with their alertcondition() titles (probe run, cached). */
export function chartPineConditions(): PinePick[] {
  return getIndicators()
    .filter((i) => i.type === PINE_TYPE && i.script)
    .map((inst) => {
      const sig = inst.script || ''
      let conds = declared.get(sig)
      if (!conds) {
        conds = alertConditionsOf(checkScript(sig).result).map((c, idx) => ({
          idx,
          title: String(c.title || 'Condition ' + (idx + 1)).slice(0, 120),
          message: String(c.message || ''),
        }))
        if (declared.size > 32) declared.clear()
        declared.set(sig, conds)
      }
      return { uid: inst.uid, title: instanceDef(inst)?.name || 'Pine script', conds }
    })
}

/**
 * The instances a rule must keep to recompute its operands: each referenced
 * one plus everything it reads from (indicator-on-indicator chains).
 */
export function snapshotFor(uids: string[]): IndSnap[] {
  const all = getIndicators()
  const keep = new Map<string, IndicatorInstance>()
  const add = (uid: string) => {
    if (keep.has(uid)) return
    const inst = all.find((i) => i.uid === uid)
    if (!inst) return
    keep.set(uid, inst)
    const ref = sourceRef(inst.source)
    if (ref) add(ref.uid)
  }
  uids.forEach(add)
  return [...keep.values()].map((i) => ({
    uid: i.uid,
    type: i.type,
    params: { ...i.params },
    source: i.source,
    visible: true,
    script: i.script,
    title: i.title,
    pineInputs: i.pineInputs ? { ...i.pineInputs } : undefined,
  }))
}

// ---------------------------------------------------------------- Pine runs

/** Alert-only uid for a Pine instance: keeps the alert's runs apart from the chart's. */
const alertUid = (ruleId: string, uid: string) => 'al~' + ruleId + '~' + uid
const pineAlertUids = new Set<string>()

interface PineRun {
  sig: string
  first: number
  n: number
  lastT: number
  last: number
  at: number
  conds: PineAlertCondition[]
}
const runs = new Map<string, PineRun>()
const inFlight = new Set<string>()
let worker: Worker | null | undefined
let seq = 0
const jobs = new Map<number, { key: string; sig: string; candles: CandleFlat[] }>()

function pineWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker =
      typeof Worker === 'function'
        ? new Worker(new URL('../charts/pine/pine.worker.ts', import.meta.url), { type: 'module' })
        : null
  } catch {
    worker = null
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; result?: PineResult; error?: string }>) => {
      const job = jobs.get(e.data.id)
      jobs.delete(e.data.id)
      if (!job) return
      inFlight.delete(job.key)
      store(job.key, job.sig, job.candles, e.data.error ? [] : alertConditionsOf(e.data.result))
      notifyData()
    }
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      jobs.clear()
      inFlight.clear()
    }
  }
  return worker
}

function store(key: string, sig: string, c: CandleFlat[], conds: PineAlertCondition[]): void {
  const n = c.length
  runs.set(key, { sig, first: c[0]?.t ?? 0, n, lastT: c[n - 1]?.t ?? 0, last: c[n - 1]?.c ?? 0, at: Date.now(), conds })
}

/**
 * A Pine instance's alertconditions over `candles`: the last run when it was
 * over these very bars, else null (and a run is started). The forming bar
 * moving re-runs at most every few seconds.
 */
function pineConditions(ruleId: string, inst: IndSnap, candles: CandleFlat[], sym: string, tf: string) {
  const key = ruleId + '|' + inst.uid
  const sig = (inst.script || '') + '\u0000' + JSON.stringify(inst.pineInputs || {})
  const n = candles.length
  const lc = candles[n - 1]
  const prev = runs.get(key)
  const same = !!prev && prev.sig === sig && prev.first === candles[0].t && prev.n === n && prev.lastT === lc.t
  const fresh = same && (prev!.last === lc.c || Date.now() - prev!.at < 5000)
  if (!fresh && !inFlight.has(key)) {
    const w = pineWorker()
    const opts = { ticker: sym, period: pinePeriod(tf) }
    const inputs = (inst.pineInputs || {}) as Record<string, InputValue>
    if (w) {
      const id = ++seq
      inFlight.add(key)
      jobs.set(id, { key, sig, candles })
      const bars = candles.map((k) => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v }))
      w.postMessage({ id, script: inst.script || '', candles: bars, inputs, opts })
    } else {
      let conds: PineAlertCondition[] = []
      try {
        conds = alertConditionsOf(runPine(inst.script || '', candles, inputs, { ...opts, maxMs: 1500 }))
      } catch {
        /* a failing script has no conditions */
      }
      store(key, sig, candles, conds)
      return conds
    }
  }
  // Same bars (the forming one may have moved since): the last run still lines up.
  return same ? prev!.conds : null
}

// ---------------------------------------------------------------- context

/** The series a conditions rule reads, over `candles`; null while a Pine run is pending. */
export function condContext(rule: AlertRule, candles: CandleFlat[]): CondCtx | null {
  const conds = rule.conds || []
  const inds = (rule.inds || []) as IndicatorInstance[]
  const ctx: CondCtx = { candles, outputs: {}, pine: {} }
  const needOut = conds.some((c) => [c.a, c.b, c.c].some((o) => o?.t === 'out'))
  if (needOut && inds.length) {
    const defOf = (inst: IndicatorInstance, c: CandleFlat[]): IndicatorDef | null => {
      if (inst.type !== PINE_TYPE) return indicatorDef(inst.type)
      const u = alertUid(rule.id, inst.uid)
      pineAlertUids.add(u)
      return pineLive({ ...inst, uid: u }, c)
    }
    computeAll(inds, candles, defOf, sourceSeries).forEach(({ inst, outputs }) => {
      for (const k in outputs) ctx.outputs[inst.uid + '.' + k] = outputs[k]
    })
  }
  const pineUids = new Set(
    conds.flatMap((c) => [c.a, c.b, c.c]).filter((o) => o?.t === 'pine').map((o) => (o as { uid: string }).uid),
  )
  for (const uid of pineUids) {
    const inst = inds.find((i) => i.uid === uid)
    if (!inst) continue
    const list = pineConditions(rule.id, inst, candles, rule.sym || '', rule.tf || '15m')
    if (!list) return null
    ctx.pine[uid] = list
  }
  return ctx
}

/** A deleted rule's cached runs. */
export function forgetCondRule(rule: AlertRule): void {
  condUids(rule.conds || []).forEach((uid) => {
    runs.delete(rule.id + '|' + uid)
    const u = alertUid(rule.id, uid)
    if (pineAlertUids.delete(u)) forgetPine(u)
  })
}
