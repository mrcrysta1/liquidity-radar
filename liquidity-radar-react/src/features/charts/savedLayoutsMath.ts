// Pure helpers behind saved chart layouts (./savedLayouts) and the Charts-tab
// workspace panels (./multiCharts): parsing, validation, migration and list
// edits. No DOM, chart or storage here, so scripts/test-engines.mjs can run
// them.
import { isTf } from '../../services/timeframe.ts'
import { isInstrument } from '../../constants/instruments.ts'

export const SAVED_LAYOUTS_VERSION = 1
export const MAX_SAVED_LAYOUTS = 20
export const MAX_LAYOUT_NAME = 32
/** Grid positions a layout can have (layouts.ts MAX_CHARTS). */
const MAX_CELLS = 16
const MAX_INDICATORS = 50

/** What one layout cell shows. `tf`/`style` absent: the restore picks the current one. */
export interface SnapCell {
  sym: string
  tf?: string
  style?: string
}
export interface SnapScale {
  mode: 'normal' | 'log' | 'percent' | 'indexed'
  invert: boolean
  lock: boolean
}
/** Everything that defines a chart setup. */
export interface LayoutSnapshot {
  /** Cell count (a LAYOUTS entry). */
  n: number
  /** Grid position of the main (active) chart. */
  active: number
  /** By grid position; null = nothing remembered, the cell gets a default. */
  cells: Array<SnapCell | null>
  /** The main chart's indicator set (persisted shape). */
  mainIndicators: unknown[]
  /** Companion indicator sets by slot ('c1'..'c15'). */
  panelIndicators: Record<string, unknown[]>
  /** The active chart's price-scale settings. */
  scale: SnapScale | null
}
export interface SavedLayout {
  id: string
  name: string
  savedAt: number
  snapshot: LayoutSnapshot
}

// ---- validation ----

/** A Binance USDT pair or a known instrument. */
export function validSymbol(s: unknown): s is string {
  if (typeof s !== 'string') return false
  return /^[A-Z0-9]{1,20}USDT$/.test(s) || (/^[A-Z0-9^=._-]{1,20}$/.test(s) && isInstrument(s))
}
export const validTimeframe = (tf: unknown): tf is string => typeof tf === 'string' && isTf(tf)
const validStyle = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-zA-Z][a-zA-Z0-9-]{0,23}$/.test(s)

/** Trim, fold runs of whitespace, cap the length; '' when nothing is left. */
export function cleanLayoutName(raw: unknown): string {
  return Array.from(String(raw ?? ''))
    .map((ch) => {
      const c = ch.charCodeAt(0)
      // Control characters: tabs/newlines become spaces, the rest go.
      return c < 32 || c === 127 ? (ch === '\t' || ch === '\n' || ch === '\r' ? ' ' : '') : ch
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LAYOUT_NAME)
    .trim()
}

/** A stored cell back to a cell: a bad symbol drops it, a bad tf/style drops only that part. */
export function cleanSnapCell(raw: unknown): SnapCell | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!validSymbol(r.sym)) return null
  const out: SnapCell = { sym: r.sym }
  if (validTimeframe(r.tf)) out.tf = r.tf
  if (validStyle(r.style)) out.style = r.style
  return out
}

const SCALE_MODES = ['normal', 'log', 'percent', 'indexed']
function cleanScale(raw: unknown): SnapScale | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const mode = (SCALE_MODES.indexOf(String(r.mode)) !== -1 ? r.mode : 'normal') as SnapScale['mode']
  return { mode, invert: r.invert === true, lock: r.lock === true && mode === 'normal' }
}

/** Indicator arrays are only shape-checked here; the stores sanitize their contents. */
const indList = (v: unknown): unknown[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, MAX_INDICATORS) : []

/**
 * A stored snapshot back to a usable one, or null when it has no layout at
 * all. `layoutNs` is the list of valid cell counts.
 */
export function cleanSnapshot(raw: unknown, layoutNs: readonly number[]): LayoutSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const n = Number(r.n)
  if (layoutNs.indexOf(n) === -1) return null
  const a = Number(r.active)
  const cells = Array.isArray(r.cells) ? r.cells.slice(0, MAX_CELLS).map(cleanSnapCell) : []
  const panelIndicators: Record<string, unknown[]> = {}
  if (
    r.panelIndicators &&
    typeof r.panelIndicators === 'object' &&
    !Array.isArray(r.panelIndicators)
  ) {
    Object.entries(r.panelIndicators as Record<string, unknown>).forEach(([k, v]) => {
      const m = /^c(\d{1,2})$/.exec(k)
      if (m && Number(m[1]) < MAX_CELLS) {
        const list = indList(v)
        if (list.length) panelIndicators[k] = list
      }
    })
  }
  return {
    n,
    active: Number.isInteger(a) && a >= 0 && a < n ? a : 0,
    cells,
    mainIndicators: indList(r.mainIndicators),
    panelIndicators,
    scale: cleanScale(r.scale),
  }
}

// ---- the saved list ----

/**
 * Whatever is stored back to a list. Takes the versioned shape
 * `{ v: 1, items: [...] }` and a bare array (unversioned); anything else,
 * corrupt entries and duplicate ids/names are dropped. Unknown fields are
 * ignored.
 */
export function parseSavedLayouts(raw: unknown, layoutNs: readonly number[]): SavedLayout[] {
  let items: unknown[] = []
  if (Array.isArray(raw)) items = raw
  else if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    // A newer schema than this build knows: keep what still parses.
    if (Array.isArray(r.items)) items = r.items
  }
  const out: SavedLayout[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const it of items) {
    if (out.length >= MAX_SAVED_LAYOUTS) break
    if (!it || typeof it !== 'object') continue
    const e = it as Record<string, unknown>
    const name = cleanLayoutName(e.name)
    const snapshot = cleanSnapshot(e.snapshot, layoutNs)
    if (!name || !snapshot || names.has(name.toLowerCase())) continue
    let id = typeof e.id === 'string' && /^[a-z0-9]{1,24}$/i.test(e.id) ? e.id : ''
    if (!id || ids.has(id))
      id = 'l' + out.length.toString(36) + Math.random().toString(36).slice(2, 8)
    ids.add(id)
    names.add(name.toLowerCase())
    const at = Number(e.savedAt)
    out.push({ id, name, savedAt: isFinite(at) && at > 0 ? at : 0, snapshot })
  }
  return out
}

export function serializeSavedLayouts(list: SavedLayout[]): { v: number; items: SavedLayout[] } {
  return { v: SAVED_LAYOUTS_VERSION, items: list.slice(0, MAX_SAVED_LAYOUTS) }
}

export interface ListEdit {
  list: SavedLayout[]
  /** Set when the edit was refused; `list` is then unchanged. */
  error: string | null
  /** The entry that was added or overwritten. */
  id?: string
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Save `snapshot` as `name`. An existing layout of the same name (any case)
 * is overwritten in place; a new one goes first. Refused when the name is
 * empty or the list is full.
 */
export function addSavedLayout(
  list: SavedLayout[],
  rawName: unknown,
  snapshot: LayoutSnapshot,
  now: number,
  id: string,
): ListEdit {
  const name = cleanLayoutName(rawName)
  if (!name) return { list, error: 'Give the layout a name' }
  const i = list.findIndex((e) => sameName(e.name, name))
  if (i !== -1) {
    const next = list.slice()
    next[i] = { id: list[i].id, name, savedAt: now, snapshot }
    return { list: next, error: null, id: list[i].id }
  }
  if (list.length >= MAX_SAVED_LAYOUTS)
    return { list, error: 'You can keep ' + MAX_SAVED_LAYOUTS + ' layouts; delete one first' }
  return { list: [{ id, name, savedAt: now, snapshot }].concat(list), error: null, id }
}

export function renameSavedLayout(list: SavedLayout[], id: string, rawName: unknown): ListEdit {
  const name = cleanLayoutName(rawName)
  const i = list.findIndex((e) => e.id === id)
  if (i === -1) return { list, error: 'That layout no longer exists' }
  if (!name) return { list, error: 'Give the layout a name' }
  if (list.some((e) => e.id !== id && sameName(e.name, name)))
    return { list, error: 'A layout named "' + name + '" already exists' }
  const next = list.slice()
  next[i] = { ...list[i], name }
  return { list: next, error: null, id }
}

export function deleteSavedLayout(list: SavedLayout[], id: string): SavedLayout[] {
  return list.filter((e) => e.id !== id)
}

// ---- Charts-tab workspace panels ----

export interface McPanelCfg {
  sym: string
  interval: string
}

/**
 * The stored workspace panels back to a list. Missing, corrupt or empty
 * storage gives `defaults`; within a list, a bad symbol or interval falls back
 * to that position's default (else the first default's), and at most `max`
 * panels are kept.
 */
export function parseMcPanels(
  raw: unknown,
  defaults: readonly McPanelCfg[],
  intervals: readonly string[],
  max: number,
): McPanelCfg[] {
  const fallback = () => defaults.map((d) => ({ ...d }))
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).panels)
      ? ((raw as Record<string, unknown>).panels as unknown[])
      : null
  if (!list || !list.length) return fallback()
  return list.slice(0, max).map((it, i) => {
    const d = defaults[i] || defaults[0] || { sym: 'BTCUSDT', interval: '1h' }
    const r = it && typeof it === 'object' ? (it as Record<string, unknown>) : {}
    return {
      sym: validSymbol(r.sym) ? r.sym : d.sym,
      interval:
        typeof r.interval === 'string' && intervals.indexOf(r.interval) !== -1
          ? r.interval
          : d.interval,
    }
  })
}
