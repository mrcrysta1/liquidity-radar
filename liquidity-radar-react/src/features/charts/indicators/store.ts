// Active indicators on the price-action chart: what is on, with which params,
// in which order. Persisted, so the chart comes back as it was left.
//
// `source` is a price field ('close', 'volume', …) or another instance's
// output as `uid.outputKey` (indicator-on-indicator, see ./graph). uids are
// persisted so those references survive a reload.
//
// A Pine script is an instance of type 'pine' carrying its source, title and
// input values (see ../pine/indicator); its def comes from the script itself.
//
// Every chart that carries indicators gets its own store from
// createIndicatorStore: the main price-action chart (below, persisted under
// 'lr-chartIndicators' exactly as before) and each multi-chart panel (see
// ./panelStore). The module-level functions act on the main chart's store.
import { storageGet, storageSet } from '../../../services/storage.ts'
import type { IndicatorDef, SourceKey } from './registry.ts'
import {
  SOURCES,
  defaultParams,
  indicatorDef,
  instanceLabel,
  takesMtf,
  valueOutputs,
} from './registry.ts'
import { createsCycle, sourceRef } from './graph.ts'
import { isMtfKey } from './mtf.ts'
import {
  MAX_SCRIPT,
  PINE_TYPE,
  cleanTitle,
  forgetPine,
  pineMeta,
  scriptTitle,
} from '../pine/indicator.ts'
import type { InputValue } from '../pine/runtime.ts'

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
  /** Style tab: per-output overrides of the def's look, by output key. */
  styles?: Record<string, OutputStyle>
  /** Decimals on the indicator's axis; unset = fitted to the values. */
  precision?: number
  /** Guide levels replacing the def's (RSI 30/70 → 20/80); [] = none. */
  levels?: number[]
  /** Interval groups the instance is hidden on (false); unset = shown. */
  tfVisibility?: Partial<Record<TfGroup, boolean>>
  /** Multi-timeframe input: compute on these bars ('5m' … '1w'); unset = chart. */
  tf?: string
  /** With `tf`: the live bar shows the last closed value, not the forming one. */
  tfWait?: boolean
}

/** The multi-timeframe fields of a stored instance, cleaned. */
function sanitizeMtf(r: Record<string, unknown>, def: IndicatorDef): Partial<IndicatorInstance> {
  if (!takesMtf(def) || !isMtfKey(r.tf)) return {}
  return r.tfWait === true ? { tf: r.tf, tfWait: true } : { tf: r.tf }
}
const mtfOf = (i: IndicatorInstance): Partial<IndicatorInstance> =>
  i.tf ? (i.tfWait ? { tf: i.tf, tfWait: true } : { tf: i.tf }) : {}

export type LineStyleName = 'solid' | 'dashed' | 'dotted'
export interface OutputStyle {
  color?: string
  /** px, 1–4 */
  width?: number
  style?: LineStyleName
  /** false hides this one output; the instance's other outputs still draw. */
  visible?: boolean
}

/** TradingView's "Visibility" groups: by the chart's bar interval. */
export type TfGroup = 's' | 'm' | 'h' | 'd'
export const TF_GROUPS: Array<{ key: TfGroup; label: string }> = [
  { key: 's', label: 'Seconds' },
  { key: 'm', label: 'Minutes' },
  { key: 'h', label: 'Hours' },
  { key: 'd', label: 'Days, weeks, months' },
]

/** The interval group of bars `stepMs` apart. */
export function tfGroupFor(stepMs: number): TfGroup {
  if (!(stepMs > 0) || stepMs >= 86400000) return 'd'
  return stepMs < 60000 ? 's' : stepMs < 3600000 ? 'm' : 'h'
}

/**
 * The bar interval of a candle run: the smallest gap among the last few bars,
 * so a weekend or an exchange outage does not read as a longer interval.
 */
export function barStepMs(c: Array<{ t: number }>): number {
  let step = Infinity
  for (let i = Math.max(1, c.length - 6); i < c.length; i++) {
    const d = c[i].t - c[i - 1].t
    if (d > 0 && d < step) step = d
  }
  return isFinite(step) ? step : 0
}

/** Is `inst` set to show on charts of this interval group? */
export const shownOnTf = (inst: IndicatorInstance, g: TfGroup): boolean =>
  inst.tfVisibility?.[g] !== false

const COLOR_RE =
  /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\))$/i
const LINE_STYLES: LineStyleName[] = ['solid', 'dashed', 'dotted']

function cleanStyle(raw: unknown): OutputStyle | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: OutputStyle = {}
  if (typeof r.color === 'string' && r.color.length <= 40 && COLOR_RE.test(r.color))
    out.color = r.color
  const w = Number(r.width)
  if (r.width != null && Number.isInteger(w) && w >= 1 && w <= 4) out.width = w
  if (LINE_STYLES.indexOf(r.style as LineStyleName) !== -1) out.style = r.style as LineStyleName
  if (r.visible === false) out.visible = false
  return Object.keys(out).length ? out : null
}

/**
 * The Style / Visibility settings of a stored instance, cleaned: bad colours,
 * widths and levels dropped, so hand-edited storage cannot break a series.
 * Only the keys that are set come back, so an instance without any keeps
 * exactly its old persisted shape.
 */
export function sanitizeLook(r: Record<string, unknown>): Partial<IndicatorInstance> {
  const out: Partial<IndicatorInstance> = {}
  if (r.styles && typeof r.styles === 'object') {
    const styles: Record<string, OutputStyle> = {}
    Object.entries(r.styles as Record<string, unknown>).forEach(([k, v]) => {
      const st = cleanStyle(v)
      if (st && k.length <= 40) styles[k] = st
    })
    if (Object.keys(styles).length) out.styles = styles
  }
  const prec = Number(r.precision)
  if (r.precision != null && Number.isInteger(prec) && prec >= 0 && prec <= 10)
    out.precision = prec
  if (Array.isArray(r.levels))
    out.levels = r.levels
      .map(Number)
      .filter((x) => isFinite(x))
      .slice(0, 20)
  if (r.tfVisibility && typeof r.tfVisibility === 'object') {
    const tf: Partial<Record<TfGroup, boolean>> = {}
    TF_GROUPS.forEach(({ key }) => {
      if ((r.tfVisibility as Record<string, unknown>)[key] === false) tf[key] = false
    })
    if (Object.keys(tf).length) out.tfVisibility = tf
  }
  return out
}

/** The look fields of an instance, for persisting (unset ones left out). */
function lookOf(i: IndicatorInstance): Partial<IndicatorInstance> {
  const out: Partial<IndicatorInstance> = {}
  if (i.styles && Object.keys(i.styles).length) out.styles = i.styles
  if (i.precision != null) out.precision = i.precision
  if (i.levels) out.levels = i.levels
  if (i.tfVisibility && Object.keys(i.tfVisibility).length) out.tfVisibility = i.tfVisibility
  return out
}

/** An instance without any Style / Visibility override. */
function withoutLook(i: IndicatorInstance): IndicatorInstance {
  const out = { ...i }
  delete out.styles
  delete out.precision
  delete out.levels
  delete out.tfVisibility
  return out
}

/**
 * A saved set (template) re-keyed with fresh uids, its indicator-on-indicator
 * references following along. Applying the same template to two charts, or
 * twice, must not hand two instances one uid: Pine results are cached by uid.
 */
export function remapUids(raw: unknown, mkUid: () => string): unknown[] {
  if (!Array.isArray(raw)) return []
  const map = new Map<string, string>()
  raw.forEach((r) => {
    const id = r && typeof r === 'object' ? (r as { uid?: unknown }).uid : null
    if (typeof id === 'string' && !map.has(id)) map.set(id, mkUid())
  })
  return raw.map((r) => {
    if (!r || typeof r !== 'object') return r
    const o = { ...(r as Record<string, unknown>) }
    o.uid = map.get(o.uid as string) ?? mkUid()
    const ref = typeof o.source === 'string' ? sourceRef(o.source) : null
    if (ref) o.source = map.has(ref.uid) ? map.get(ref.uid) + '.' + ref.key : 'close'
    return o
  })
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
export const MAIN_MAX_INDICATORS = MAX

/** What the chart shows before anyone adds one: nothing. Every user, and
 *  every new account, starts from a clean chart and picks their own. */
const SEED: Array<{ type: string; params?: Record<string, number> }> = []

let seq = 0
const uidWith = (prefix: string) => prefix + Date.now().toString(36) + (seq++).toString(36)

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

function make(
  type: string,
  params?: Record<string, number>,
  source: SourceKey = 'close',
  prefix = 'i',
) {
  const def = indicatorDef(type)
  if (!def) return null
  return {
    uid: uidWith(prefix),
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

/** Stored data back to instances: unknown types dropped, params clamped,
 *  bad references reset to close, at most `max` kept. */
export function sanitizeIndicators(raw: unknown, max = MAX, prefix = 'i'): IndicatorInstance[] {
  if (!Array.isArray(raw)) return []
  const out: IndicatorInstance[] = []
  const used = new Set<string>()
  const takeUid = (r: Record<string, unknown>) => {
    const savedUid = typeof r.uid === 'string' && /^[a-z0-9]{1,32}$/i.test(r.uid) ? r.uid : ''
    const id = savedUid && !used.has(savedUid) ? savedUid : uidWith(prefix)
    used.add(id)
    return id
  }
  for (const r of raw as Array<Record<string, unknown>>) {
    if (r && r.type === PINE_TYPE && typeof r.script === 'string' && out.length < max) {
      out.push({
        uid: takeUid(r),
        type: PINE_TYPE,
        params: {},
        source: 'close',
        visible: r.visible !== false,
        script: r.script.slice(0, MAX_SCRIPT),
        title: cleanTitle(typeof r.title === 'string' ? r.title : scriptTitle(r.script)),
        pineInputs: sanitizeInputs(r.pineInputs),
        ...sanitizeLook(r),
      })
      continue
    }
    const def = r && typeof r.type === 'string' ? indicatorDef(r.type) : null
    if (!def || out.length >= max) continue
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
      ...sanitizeMtf(r, def),
      ...sanitizeLook(r),
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

/** The persisted shape of a list of instances. */
export function serializeIndicators(items: IndicatorInstance[]): unknown[] {
  return items.map((i) =>
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
          ...lookOf(i),
        }
      : {
          uid: i.uid,
          type: i.type,
          params: i.params,
          source: i.source,
          visible: i.visible,
          ...mtfOf(i),
          ...lookOf(i),
        },
  )
}

type Listener = () => void

/** One chart's indicator set. */
export interface IndicatorStore {
  readonly id: string
  getIndicators(): IndicatorInstance[]
  indicatorCount(): number
  maxIndicators(): number
  addIndicator(type: string): void
  /** Add a Pine script to the chart; returns its uid (null at the cap). */
  addPineIndicator(script: string, title?: string): string | null
  /** Replace an on-chart script's source, keeping inputs that still exist. */
  updatePineScript(uid: string, script: string, title?: string): void
  setPineInput(uid: string, key: string, value: InputValue): void
  resetPineInputs(uid: string): void
  removeIndicator(uid: string): void
  toggleIndicator(uid: string): void
  setParam(uid: string, key: string, value: number): void
  /** Sources `inst` may read: price fields, then every value output of the
   *  other instances that would not create a cycle. */
  sourceOptions(uid: string): Array<{ key: string; label: string }>
  setSource(uid: string, source: string): void
  resetIndicators(): void
  /** Style tab: merge `patch` into one output's style; null clears it. */
  setStyle(uid: string, outputKey: string, patch: OutputStyle | null): void
  setPrecision(uid: string, precision: number | null): void
  /** Replace the guide levels; null goes back to the def's. */
  setLevels(uid: string, levels: number[] | null): void
  setTfVisible(uid: string, group: TfGroup, on: boolean): void
  /** Multi-timeframe input ('5m' … '1w'); null computes on the chart's bars. */
  setTimeframe(uid: string, tf: string | null): void
  setWaitClose(uid: string, on: boolean): void
  /** Drop every Style / Visibility override of one instance. */
  resetLook(uid: string): void
  /** Replace the set with a saved template, under fresh uids. */
  loadTemplate(data: unknown): void
  subscribe(fn: Listener): () => void
  /** Take over another chart's set (persisted form), e.g. when charts swap. */
  replace(data: unknown): void
  /** Re-read from storage (the slot's data moved) without writing back. */
  reload(): void
}

export interface IndicatorStoreOptions {
  id: string
  max: number
  /** Saved data, or null when nothing was ever saved. */
  load(): unknown
  save(data: unknown[]): void
  /** uid prefix for new instances; keeps uids apart between charts. */
  prefix?: string
  /** Called after every change, after the listeners. */
  onCommit?(): void
}

/** Every store's redraw (listeners, then onCommit), for pokeIndicatorStores. */
const allStores: Array<() => void> = []
/**
 * Redraw every chart's indicators without changing or saving anything: data
 * an indicator reads arrived from elsewhere (higher-timeframe klines).
 */
export function pokeIndicatorStores(): void {
  allStores.slice().forEach((fn) => fn())
}

export function createIndicatorStore(opts: IndicatorStoreOptions): IndicatorStore {
  const { max } = opts
  const prefix = opts.prefix || 'i'
  const seed = () => SEED.map((s) => make(s.type, s.params, 'close', prefix)!).filter(Boolean)
  const read = () => {
    const saved = opts.load()
    if (saved === null || saved === undefined) return seed()
    return sanitizeIndicators(saved, max, prefix)
  }
  let items: IndicatorInstance[] = read()
  const listeners: Listener[] = []
  const notify = () => listeners.slice().forEach((fn) => fn())
  allStores.push(() => {
    notify()
    if (opts.onCommit) opts.onCommit()
  })

  function commit(): void {
    opts.save(serializeIndicators(items))
    notify()
    if (opts.onCommit) opts.onCommit()
  }
  function edit(uidToEdit: string, fn: (i: IndicatorInstance) => IndicatorInstance): void {
    items = items.map((i) => (i.uid === uidToEdit ? fn(i) : i))
    commit()
  }

  return {
    id: opts.id,
    getIndicators: () => items,
    indicatorCount: () => items.length,
    maxIndicators: () => max,

    addIndicator(type) {
      if (items.length >= max) return
      const inst = make(type, undefined, 'close', prefix)
      if (!inst) return
      items = items.concat([inst])
      commit()
    },
    addPineIndicator(script, title) {
      if (items.length >= max) return null
      const src = script.slice(0, MAX_SCRIPT)
      const inst: IndicatorInstance = {
        uid: uidWith(prefix),
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
    },
    updatePineScript(uidToEdit, script, title) {
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
    },
    setPineInput(uidToEdit, key, value) {
      items = items.map((i) =>
        i.uid === uidToEdit && i.type === PINE_TYPE
          ? { ...i, pineInputs: { ...(i.pineInputs || {}), [key]: value } }
          : i,
      )
      commit()
    },
    resetPineInputs(uidToEdit) {
      items = items.map((i) => (i.uid === uidToEdit ? { ...i, pineInputs: {} } : i))
      commit()
    },

    removeIndicator(uidToDrop) {
      forgetPine(uidToDrop)
      // Anything built on the removed one goes back to reading price.
      items = items
        .filter((i) => i.uid !== uidToDrop)
        .map((i) => (sourceRef(i.source)?.uid === uidToDrop ? { ...i, source: 'close' } : i))
      commit()
    },
    toggleIndicator(uidToToggle) {
      items = items.map((i) => (i.uid === uidToToggle ? { ...i, visible: !i.visible } : i))
      commit()
    },
    setParam(uidToEdit, key, value) {
      items = items.map((i) => {
        if (i.uid !== uidToEdit) return i
        const def = indicatorDef(i.type)
        const p = def?.params.find((x) => x.key === key)
        if (!p) return i
        const v = Math.min(p.max, Math.max(p.min, value))
        return { ...i, params: { ...i.params, [key]: v } }
      })
      commit()
    },
    sourceOptions(uidFor) {
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
    },
    setSource(uidToEdit, source) {
      const inst = items.find((i) => i.uid === uidToEdit)
      const def = inst ? indicatorDef(inst.type) : null
      if (!inst || !def?.sourced || !validSource(items, inst, source)) return
      items = items.map((i) => (i.uid === uidToEdit ? { ...i, source } : i))
      commit()
    },
    resetIndicators() {
      items = seed()
      commit()
    },
    setStyle(uidToEdit, key, patch) {
      edit(uidToEdit, (i) => {
        const styles = { ...(i.styles || {}) }
        const st = patch ? cleanStyle({ ...(styles[key] || {}), ...patch }) : null
        if (st) styles[key] = st
        else delete styles[key]
        return { ...i, styles }
      })
    },
    setPrecision(uidToEdit, precision) {
      edit(uidToEdit, (i) => {
        const next = { ...i }
        delete next.precision
        return precision == null ? next : { ...next, ...sanitizeLook({ precision }) }
      })
    },
    setLevels(uidToEdit, levels) {
      edit(uidToEdit, (i) => {
        const next = { ...i }
        delete next.levels
        return levels == null ? next : { ...next, ...sanitizeLook({ levels }) }
      })
    },
    setTfVisible(uidToEdit, group, on) {
      edit(uidToEdit, (i) => {
        const tf = { ...(i.tfVisibility || {}) }
        if (on) delete tf[group]
        else tf[group] = false
        return { ...i, tfVisibility: tf }
      })
    },
    setTimeframe(uidToEdit, tf) {
      edit(uidToEdit, (i) => {
        const next = { ...i }
        delete next.tf
        delete next.tfWait
        const def = indicatorDef(i.type)
        if (!tf || !def) return next
        return { ...next, ...sanitizeMtf({ tf, tfWait: i.tfWait }, def) }
      })
    },
    setWaitClose(uidToEdit, on) {
      edit(uidToEdit, (i) => {
        const next = { ...i }
        delete next.tfWait
        return on && i.tf ? { ...next, tfWait: true } : next
      })
    },
    resetLook(uidToEdit) {
      edit(uidToEdit, withoutLook)
    },
    loadTemplate(data) {
      items = sanitizeIndicators(remapUids(data, () => uidWith(prefix)), max, prefix)
      commit()
    },
    subscribe(fn) {
      listeners.push(fn)
      return () => {
        const i = listeners.indexOf(fn)
        if (i !== -1) listeners.splice(i, 1)
      }
    },
    replace(data) {
      items = sanitizeIndicators(data, max, prefix)
      commit()
    },
    reload() {
      items = read()
      notify()
    },
  }
}

// ---------------------------------------------------------------- main chart

let onChange: (() => void) | null = null
/** The main price-action chart's indicators: same key and shape as ever. */
export const mainIndicatorStore: IndicatorStore = createIndicatorStore({
  id: 'main',
  max: MAX,
  load: () => storageGet<unknown>(KEY, null),
  save: (data) => storageSet(KEY, data),
  onCommit: () => {
    if (onChange) onChange()
  },
})

export function subscribeIndicators(fn: Listener): () => void {
  return mainIndicatorStore.subscribe(fn)
}
/** The chart registers its redraw here. */
export function onIndicatorsChange(fn: () => void): void {
  onChange = fn
}

const main = mainIndicatorStore
export const getIndicators = (): IndicatorInstance[] => main.getIndicators()
export const indicatorCount = (): number => main.indicatorCount()
export const maxIndicators = (): number => main.maxIndicators()
export const addIndicator = (type: string): void => main.addIndicator(type)
/** Add a Pine script to the chart; returns its uid (null at the cap). */
export const addPineIndicator = (script: string, title?: string): string | null =>
  main.addPineIndicator(script, title)
export const updatePineScript = (u: string, script: string, title?: string): void =>
  main.updatePineScript(u, script, title)
export const setPineInput = (u: string, key: string, value: InputValue): void =>
  main.setPineInput(u, key, value)
export const resetPineInputs = (u: string): void => main.resetPineInputs(u)
export const removeIndicator = (u: string): void => main.removeIndicator(u)
export const toggleIndicator = (u: string): void => main.toggleIndicator(u)
export const setParam = (u: string, key: string, value: number): void =>
  main.setParam(u, key, value)
export const sourceOptions = (u: string): Array<{ key: string; label: string }> =>
  main.sourceOptions(u)
export const setSource = (u: string, source: string): void => main.setSource(u, source)
export const resetIndicators = (): void => main.resetIndicators()
