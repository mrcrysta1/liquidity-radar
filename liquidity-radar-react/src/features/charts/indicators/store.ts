// Active indicators on the price-action chart: what is on, with which params,
// in which order. Persisted, so the chart comes back as it was left.
//
// `source` is a price field ('close', 'volume', …) or another instance's
// output as `uid.outputKey` (indicator-on-indicator, see ./graph). uids are
// persisted so those references survive a reload.
//
// A Pine script is an instance of type 'pine' carrying its source, title and
// input values (see ../pine/indicator); its def comes from the script itself.
import { storageGet, storageSet } from '../../../services/storage'
import type { IndicatorDef, SourceKey } from './registry'
import { SOURCES, defaultParams, indicatorDef, instanceLabel, valueOutputs } from './registry'
import { createsCycle, sourceRef } from './graph'
import {
  MAX_SCRIPT,
  PINE_TYPE,
  cleanTitle,
  forgetPine,
  pineMeta,
  scriptTitle,
} from '../pine/indicator'
import type { InputValue } from '../pine/runtime'

export interface IndicatorInstance {
  uid: string
  type: string
  params: Record<string, number>
  /** A SourceKey, or `uid.outputKey` of another instance. */
  source: string
  visible: boolean
  /** Pine only: the script, its display title and input overrides. */
  script?: string
  title?: string
  pineInputs?: Record<string, InputValue>
}

/** The def an instance draws with — catalogue, or built from its Pine script. */
export function instanceDef(inst: IndicatorInstance): IndicatorDef | null {
  if (inst.type === PINE_TYPE) return pineMeta(inst).def
  return indicatorDef(inst.type)
}

const KEY = 'lr-chartIndicators'
/** Per-chart cap. The Pro terminal has none; 50 keeps a full redraw (every
 *  indicator over a few thousand bars, on each data load) comfortably fast. */
const MAX = 50

/** What the chart shows before anyone adds one: nothing. Every user, and
 *  every new account, starts from a clean chart and picks their own. */
const SEED: Array<{ type: string; params?: Record<string, number> }> = []

let seq = 0
const uid = () => 'i' + Date.now().toString(36) + (seq++).toString(36)

const isBaseSource = (s: string) => SOURCES.some((x) => x.key === s)

/** Can `inst` read `source`: a price field, or a value output of another
 *  instance in `list` that does not lead back to `inst`? */
function validSource(list: IndicatorInstance[], inst: IndicatorInstance, source: string): boolean {
  if (isBaseSource(source)) return true
  const ref = sourceRef(source)
  if (!ref || ref.uid === inst.uid) return false
  const dep = list.find((i) => i.uid === ref.uid)
  const def = dep ? instanceDef(dep) : null
  if (!def || !valueOutputs(def).some((o) => o.key === ref.key)) return false
  return !createsCycle(list, inst.uid, source)
}

function make(type: string, params?: Record<string, number>, source: SourceKey = 'close') {
  const def = indicatorDef(type)
  if (!def) return null
  return {
    uid: uid(),
    type,
    params: { ...defaultParams(def), ...(params || {}) },
    source: def.sourced ? source : 'close',
    visible: true,
  } as IndicatorInstance
}

function sanitizeInputs(raw: unknown): Record<string, InputValue> {
  const out: Record<string, InputValue> = {}
  if (!raw || typeof raw !== 'object') return out
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (typeof v === 'number' ? isFinite(v) : typeof v === 'boolean' || typeof v === 'string')
      out[k.slice(0, 80)] = typeof v === 'string' ? v.slice(0, 200) : (v as InputValue)
  })
  return out
}

function sanitize(raw: unknown): IndicatorInstance[] {
  if (!Array.isArray(raw)) return []
  const out: IndicatorInstance[] = []
  const used = new Set<string>()
  const takeUid = (r: Record<string, unknown>) => {
    const savedUid = typeof r.uid === 'string' && /^[a-z0-9]{1,32}$/i.test(r.uid) ? r.uid : ''
    const id = savedUid && !used.has(savedUid) ? savedUid : uid()
    used.add(id)
    return id
  }
  for (const r of raw as Array<Record<string, unknown>>) {
    if (r && r.type === PINE_TYPE && typeof r.script === 'string' && out.length < MAX) {
      out.push({
        uid: takeUid(r),
        type: PINE_TYPE,
        params: {},
        source: 'close',
        visible: r.visible !== false,
        script: r.script.slice(0, MAX_SCRIPT),
        title: cleanTitle(typeof r.title === 'string' ? r.title : scriptTitle(r.script)),
        pineInputs: sanitizeInputs(r.pineInputs),
      })
      continue
    }
    const def = r && typeof r.type === 'string' ? indicatorDef(r.type) : null
    if (!def || out.length >= MAX) continue
    const params = defaultParams(def)
    const saved = r.params as Record<string, unknown> | undefined
    def.params.forEach((p) => {
      const v = Number(saved?.[p.key])
      if (isFinite(v) && v >= p.min && v <= p.max) params[p.key] = v
    })
    out.push({
      uid: takeUid(r),
      type: def.id,
      params,
      source: def.sourced ? String(r.source ?? 'close') : 'close',
      visible: r.visible !== false,
    })
  }
  // References are checked once every instance is known: a source may point
  // at a later entry. Anything dangling or circular falls back to close.
  out.forEach((inst) => {
    if (!validSource(out, inst, inst.source)) inst.source = 'close'
  })
  // A second pass: a fallback above can only remove edges, but keep this
  // strictly acyclic even for hand-edited storage.
  out.forEach((inst) => {
    if (createsCycle(out, inst.uid, inst.source)) inst.source = 'close'
  })
  return out
}

let items: IndicatorInstance[] = (function () {
  const saved = storageGet<unknown>(KEY, null)
  if (saved === null) return SEED.map((s) => make(s.type, s.params)!).filter(Boolean)
  return sanitize(saved)
})()

type Listener = () => void
const listeners: Listener[] = []
export function subscribeIndicators(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
let onChange: (() => void) | null = null
/** The chart registers its redraw here. */
export function onIndicatorsChange(fn: () => void): void {
  onChange = fn
}
function commit(): void {
  storageSet(
    KEY,
    items.map((i) =>
      i.type === PINE_TYPE
        ? {
            uid: i.uid,
            type: i.type,
            params: {},
            source: 'close',
            visible: i.visible,
            script: i.script,
            title: i.title,
            pineInputs: i.pineInputs || {},
          }
        : {
            uid: i.uid,
            type: i.type,
            params: i.params,
            source: i.source,
            visible: i.visible,
          },
    ),
  )
  listeners.slice().forEach((fn) => fn())
  if (onChange) onChange()
}

export function getIndicators(): IndicatorInstance[] {
  return items
}
export function indicatorCount(): number {
  return items.length
}
export function maxIndicators(): number {
  return MAX
}

export function addIndicator(type: string): void {
  if (items.length >= MAX) return
  const inst = make(type)
  if (!inst) return
  items = items.concat([inst])
  commit()
}
/** Add a Pine script to the chart; returns its uid (null at the cap). */
export function addPineIndicator(script: string, title?: string): string | null {
  if (items.length >= MAX) return null
  const src = script.slice(0, MAX_SCRIPT)
  const inst: IndicatorInstance = {
    uid: uid(),
    type: PINE_TYPE,
    params: {},
    source: 'close',
    visible: true,
    script: src,
    title: cleanTitle(title || scriptTitle(src)),
    pineInputs: {},
  }
  items = items.concat([inst])
  commit()
  return inst.uid
}
/** Replace an on-chart script's source, keeping inputs that still exist. */
export function updatePineScript(uidToEdit: string, script: string, title?: string): void {
  const src = script.slice(0, MAX_SCRIPT)
  items = items.map((i) =>
    i.uid === uidToEdit && i.type === PINE_TYPE
      ? { ...i, script: src, title: cleanTitle(title || scriptTitle(src)) }
      : i,
  )
  // Plot keys follow the source; anything reading a plot that is gone
  // goes back to close.
  items = items.map((i) => (validSource(items, i, i.source) ? i : { ...i, source: 'close' }))
  commit()
}
export function setPineInput(uidToEdit: string, key: string, value: InputValue): void {
  items = items.map((i) =>
    i.uid === uidToEdit && i.type === PINE_TYPE
      ? { ...i, pineInputs: { ...(i.pineInputs || {}), [key]: value } }
      : i,
  )
  commit()
}
export function resetPineInputs(uidToEdit: string): void {
  items = items.map((i) => (i.uid === uidToEdit ? { ...i, pineInputs: {} } : i))
  commit()
}

export function removeIndicator(uidToDrop: string): void {
  forgetPine(uidToDrop)
  // Anything built on the removed one goes back to reading price.
  items = items
    .filter((i) => i.uid !== uidToDrop)
    .map((i) => (sourceRef(i.source)?.uid === uidToDrop ? { ...i, source: 'close' } : i))
  commit()
}
export function toggleIndicator(uidToToggle: string): void {
  items = items.map((i) => (i.uid === uidToToggle ? { ...i, visible: !i.visible } : i))
  commit()
}
export function setParam(uidToEdit: string, key: string, value: number): void {
  items = items.map((i) => {
    if (i.uid !== uidToEdit) return i
    const def = indicatorDef(i.type)
    const p = def?.params.find((x) => x.key === key)
    if (!p) return i
    const v = Math.min(p.max, Math.max(p.min, value))
    return { ...i, params: { ...i.params, [key]: v } }
  })
  commit()
}
/** Sources `inst` may read: price fields, then every value output of the
 *  other instances that would not create a cycle. */
export function sourceOptions(uidFor: string): Array<{ key: string; label: string }> {
  const inst = items.find((i) => i.uid === uidFor)
  const out: Array<{ key: string; label: string }> = SOURCES.map((s) => ({ ...s }))
  if (!inst) return out
  items.forEach((other) => {
    if (other.uid === uidFor) return
    const def = instanceDef(other)
    if (!def) return
    const name = instanceLabel(def, other.params)
    const outs = valueOutputs(def)
    outs.forEach((o) => {
      const key = other.uid + '.' + o.key
      if (validSource(items, inst, key))
        out.push({ key, label: name + (outs.length > 1 ? ' › ' + o.label : '') })
    })
  })
  return out
}

export function setSource(uidToEdit: string, source: string): void {
  const inst = items.find((i) => i.uid === uidToEdit)
  const def = inst ? indicatorDef(inst.type) : null
  if (!inst || !def?.sourced || !validSource(items, inst, source)) return
  items = items.map((i) => (i.uid === uidToEdit ? { ...i, source } : i))
  commit()
}
export function resetIndicators(): void {
  items = SEED.map((s) => make(s.type, s.params)!).filter(Boolean)
  commit()
}
