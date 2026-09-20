// Active indicators on the price-action chart: what is on, with which params,
// in which order. Persisted, so the chart comes back as it was left.
import { storageGet, storageSet } from '../../../services/storage'
import type { SourceKey } from './registry'
import { SOURCES, defaultParams, indicatorDef } from './registry'

export interface IndicatorInstance {
  uid: string
  type: string
  params: Record<string, number>
  source: SourceKey
  visible: boolean
}

const KEY = 'lr-chartIndicators'
const MAX = 12

/** What the chart shows before anyone touches it — the previous chip defaults. */
const SEED: Array<{ type: string; params?: Record<string, number> }> = [
  { type: 'ema', params: { length: 20 } },
  { type: 'sma', params: { length: 20 } },
  { type: 'bb', params: { length: 20, mult: 2 } },
  { type: 'volume' },
]

let seq = 0
const uid = () => 'i' + Date.now().toString(36) + (seq++).toString(36)

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

function sanitize(raw: unknown): IndicatorInstance[] {
  if (!Array.isArray(raw)) return []
  const out: IndicatorInstance[] = []
  for (const r of raw as Array<Record<string, unknown>>) {
    const def = r && typeof r.type === 'string' ? indicatorDef(r.type) : null
    if (!def || out.length >= MAX) continue
    const params = defaultParams(def)
    const saved = r.params as Record<string, unknown> | undefined
    def.params.forEach((p) => {
      const v = Number(saved?.[p.key])
      if (isFinite(v) && v >= p.min && v <= p.max) params[p.key] = v
    })
    const src = String(r.source ?? 'close') as SourceKey
    out.push({
      uid: uid(),
      type: def.id,
      params,
      source: def.sourced && SOURCES.some((s) => s.key === src) ? src : 'close',
      visible: r.visible !== false,
    })
  }
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
    items.map((i) => ({ type: i.type, params: i.params, source: i.source, visible: i.visible })),
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
export function removeIndicator(uidToDrop: string): void {
  items = items.filter((i) => i.uid !== uidToDrop)
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
export function setSource(uidToEdit: string, source: SourceKey): void {
  items = items.map((i) => (i.uid === uidToEdit ? { ...i, source } : i))
  commit()
}
export function resetIndicators(): void {
  items = SEED.map((s) => make(s.type, s.params)!).filter(Boolean)
  commit()
}
