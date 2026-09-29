// Indicator sets for the multi-chart panels — one independent store per
// panel slot, the way the Pro terminal gives every chart in its grid its own
// indicators (pro-terminal useCharts).
//
// Slots are named by where the panel sits, so a panel keeps its indicators
// across reloads and layout changes:
//   c1..c15   companion charts around the main chart (layout cell index)
//   mc0..mc7  the Market workspace panels (position in the grid)
//
// Everything lives under one key, { [slot]: [...instances] }, in the same
// per-instance shape as the main chart's 'lr-chartIndicators' (which this
// never touches).
import { storageGet, storageSet } from '../../../services/storage.ts'
import { createIndicatorStore } from './store.ts'
import type { IndicatorStore } from './store.ts'
import { forgetPine } from '../pine/indicator.ts'

export const PANEL_INDICATORS_KEY = 'lr-panelIndicators-v1'
/** Panels are small and many: a tighter cap than the main chart's. */
export const PANEL_MAX_INDICATORS = 10

const SLOT_RE = /^(c|mc)\d{1,2}$/

type Saved = Record<string, unknown[]>

function readAll(): Saved {
  const raw = storageGet<unknown>(PANEL_INDICATORS_KEY, null)
  const out: Saved = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (SLOT_RE.test(k) && Array.isArray(v)) out[k] = v
  })
  return out
}

let all: Saved = readAll()
const stores = new Map<string, IndicatorStore>()

function writeAll(): void {
  // Empty slots are left out, so the key stays small.
  const out: Saved = {}
  Object.keys(all).forEach((k) => {
    if (all[k].length) out[k] = all[k]
  })
  storageSet(PANEL_INDICATORS_KEY, out)
}

export const isPanelSlot = (slot: string): boolean => SLOT_RE.test(slot)

/** The store for one panel slot (created on first use, then shared). */
export function panelIndicatorStore(slot: string): IndicatorStore {
  let s = stores.get(slot)
  if (s) return s
  if (!SLOT_RE.test(slot)) throw new Error('bad panel slot ' + slot)
  s = createIndicatorStore({
    id: slot,
    max: PANEL_MAX_INDICATORS,
    // A distinct uid prefix per family keeps panel instances apart from the
    // main chart's in the Pine run cache, which is keyed by uid.
    prefix: slot.startsWith('mc') ? 'w' : 'p',
    load: () => (slot in all ? all[slot] : null),
    save: (data) => {
      all[slot] = data
      writeAll()
    },
  })
  stores.set(slot, s)
  return s
}

/**
 * A panel at `index` of the `family` list was removed and the ones after it
 * moved up: move their indicator sets with them. `count` is the list length
 * before the removal.
 */
export function shiftPanelSlots(family: 'c' | 'mc', index: number, count: number): void {
  const name = (i: number) => family + i
  const dropped = stores.get(name(index))?.getIndicators() || []
  dropped.forEach((i) => forgetPine(i.uid))
  for (let i = index; i < count - 1; i++) {
    if (all[name(i + 1)]) all[name(i)] = all[name(i + 1)]
    else delete all[name(i)]
  }
  delete all[name(count - 1)]
  writeAll()
  for (let i = index; i < count; i++) stores.get(name(i))?.reload()
}

/** Forget every slot of `family` from `from` on (panels that no longer exist). */
export function prunePanelSlots(family: 'c' | 'mc', from: number): void {
  let changed = false
  Object.keys(all).forEach((k) => {
    const m = /^(c|mc)(\d+)$/.exec(k)
    if (!m || m[1] !== family || Number(m[2]) < from) return
    stores
      .get(k)
      ?.getIndicators()
      .forEach((i) => forgetPine(i.uid))
    delete all[k]
    changed = true
    stores.get(k)?.reload()
  })
  if (changed) writeAll()
}

/** Re-read everything from storage (tests; a profile swap reloads the page). */
export function reloadPanelIndicators(): void {
  all = readAll()
  stores.forEach((s) => s.reload())
}
