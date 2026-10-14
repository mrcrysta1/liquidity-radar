// "My scripts": Pine sources the user saved from the editor. Persisted (and,
// for a signed-in user, synced to their account — the key is in SYNC_KEYS).
import { storageGet, storageSet } from '../../../services/storage'
import { MAX_SCRIPT, cleanTitle } from './indicator'

export interface SavedScript {
  id: string
  name: string
  script: string
  updatedAt: number
}

export const PINE_SCRIPTS_KEY = 'lr-pineScripts'
/** Enough for anyone's library, small enough to stay a cheap sync row. */
const MAX_SAVED = 40

function sanitize(raw: unknown): SavedScript[] {
  if (!Array.isArray(raw)) return []
  const out: SavedScript[] = []
  const seen = new Set<string>()
  for (const r of raw as Array<Record<string, unknown>>) {
    if (!r || typeof r.script !== 'string' || typeof r.id !== 'string') continue
    if (seen.has(r.id) || out.length >= MAX_SAVED) continue
    seen.add(r.id)
    out.push({
      id: r.id.slice(0, 40),
      name: cleanTitle(typeof r.name === 'string' ? r.name : 'Untitled'),
      script: r.script.slice(0, MAX_SCRIPT),
      updatedAt: Number(r.updatedAt) || 0,
    })
  }
  return out
}

let list: SavedScript[] = sanitize(storageGet<unknown>(PINE_SCRIPTS_KEY, []))
const listeners: Array<() => void> = []
export function subscribeSavedScripts(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
function commit(): void {
  storageSet(PINE_SCRIPTS_KEY, list)
  listeners.slice().forEach((fn) => fn())
}

export function savedScripts(): SavedScript[] {
  return list
}
export function savedScriptsFull(): boolean {
  return list.length >= MAX_SAVED
}

/** Save as new, or overwrite `id` when given and still there. Null when full. */
export function saveScript(name: string, script: string, id?: string): SavedScript | null {
  const existing = id ? list.find((s) => s.id === id) : undefined
  if (!existing && list.length >= MAX_SAVED) return null
  const item: SavedScript = {
    id: existing?.id ?? 'ps' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: cleanTitle(name),
    script: script.slice(0, MAX_SCRIPT),
    updatedAt: Date.now(),
  }
  list = existing ? list.map((s) => (s.id === item.id ? item : s)) : [item].concat(list)
  commit()
  return item
}

export function deleteScript(id: string): void {
  list = list.filter((s) => s.id !== id)
  commit()
}
