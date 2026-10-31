// Indicator templates and favourites, as TradingView's: a template is a named
// snapshot of one chart's indicator set (params, sources, styles) that any
// chart can apply; favourites are starred catalogue entries listed first.
//
// Both are per browser (localStorage) and shared by every chart. A template
// stores the persisted shape (serializeIndicators), so applying it goes
// through the same sanitising as a reload; the store re-keys its uids.
import { storageGet, storageSet } from '../../../services/storage.ts'
import type { IndicatorInstance, IndicatorStore } from './store.ts'
import { serializeIndicators } from './store.ts'

export interface IndicatorTemplate {
  name: string
  items: unknown[]
}

const TPL_KEY = 'lr-indTemplates'
const FAV_KEY = 'lr-indFavourites'
/** Enough for anyone's working sets; keeps the stored blob small. */
export const MAX_TEMPLATES = 30
const MAX_NAME = 60

type Listener = () => void
const listeners: Listener[] = []
const notify = () => listeners.slice().forEach((fn) => fn())

/** Hear template and favourite changes (every picker shares them). */
export function subscribeTemplates(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export const cleanTemplateName = (name: string): string =>
  String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)

export function listTemplates(): IndicatorTemplate[] {
  const raw = storageGet<unknown>(TPL_KEY, [])
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (t): t is IndicatorTemplate =>
        !!t && typeof t.name === 'string' && !!cleanTemplateName(t.name) && Array.isArray(t.items),
    )
    .slice(0, MAX_TEMPLATES)
}

/**
 * Save `items` under `name`, replacing a template of the same name (case
 * insensitive). Returns false when the name is empty or the list is full.
 */
export function saveTemplate(name: string, items: IndicatorInstance[]): boolean {
  const n = cleanTemplateName(name)
  if (!n) return false
  const list = listTemplates()
  const at = list.findIndex((t) => t.name.toLowerCase() === n.toLowerCase())
  const tpl = { name: n, items: serializeIndicators(items) }
  if (at !== -1) list[at] = tpl
  else if (list.length >= MAX_TEMPLATES) return false
  else list.push(tpl)
  list.sort((a, b) => a.name.localeCompare(b.name))
  storageSet(TPL_KEY, list)
  notify()
  return true
}

export function deleteTemplate(name: string): void {
  const list = listTemplates().filter((t) => t.name !== name)
  storageSet(TPL_KEY, list)
  notify()
}

/** Replace `store`'s indicators with the named template's. */
export function applyTemplate(store: IndicatorStore, name: string): boolean {
  const tpl = listTemplates().find((t) => t.name === name)
  if (!tpl) return false
  store.loadTemplate(tpl.items)
  return true
}

export function favourites(): string[] {
  const raw = storageGet<unknown>(FAV_KEY, [])
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string' && x.length <= 40).slice(0, 200)
    : []
}

export function toggleFavourite(type: string): void {
  const list = favourites()
  const at = list.indexOf(type)
  if (at === -1) list.push(type)
  else list.splice(at, 1)
  storageSet(FAV_KEY, list)
  notify()
}
