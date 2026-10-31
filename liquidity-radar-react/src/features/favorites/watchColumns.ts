// The chart Watchlist panel's optional columns and sort. Pure, no imports, so
// scripts/test-engines.mjs runs it; the panel persists the prefs.

export type WatchColId = 'chg' | 'vol' | 'high' | 'low' | 'rsi' | 'rating'
/** Sortable keys: the always-shown symbol and last price, plus the columns. */
export type WatchSortKey = 'sym' | 'last' | WatchColId

export interface WatchCol {
  id: WatchColId
  label: string
  /** What the column chooser says about it. */
  title: string
}

export const WATCH_COLS: WatchCol[] = [
  { id: 'chg', label: 'Chg%', title: 'Change % (24h)' },
  { id: 'vol', label: 'Vol', title: 'Volume (24h, quote)' },
  { id: 'high', label: 'High', title: '24h high' },
  { id: 'low', label: 'Low', title: '24h low' },
  { id: 'rsi', label: 'RSI', title: 'RSI (14) on 1h' },
  { id: 'rating', label: 'Rating', title: 'Technical rating (1D, as the Screener)' },
]

export interface WatchPrefs {
  cols: WatchColId[]
  /** null: the list's own (manual / pinned) order. */
  sort: { key: WatchSortKey; dir: 'asc' | 'desc' } | null
}

export const DEFAULT_WATCH_PREFS: WatchPrefs = { cols: ['chg'], sort: null }

const COL_IDS = WATCH_COLS.map((c) => c.id) as string[]
const SORT_KEYS = ['sym', 'last', ...COL_IDS]

/** Saved prefs made safe: unknown columns dropped, order kept as the catalogue's. */
export function sanitizeWatchPrefs(raw: unknown): WatchPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { cols?: unknown; sort?: unknown }
  const cols = Array.isArray(r.cols)
    ? (COL_IDS.filter((id) => (r.cols as unknown[]).includes(id)) as WatchColId[])
    : DEFAULT_WATCH_PREFS.cols.slice()
  const s = r.sort as { key?: unknown; dir?: unknown } | null | undefined
  const sort =
    s && typeof s === 'object' && SORT_KEYS.includes(s.key as string) && (s.dir === 'asc' || s.dir === 'desc')
      ? { key: s.key as WatchSortKey, dir: s.dir as 'asc' | 'desc' }
      : null
  return { cols, sort: sort && (sort.key === 'sym' || sort.key === 'last' || cols.includes(sort.key)) ? sort : null }
}

/** Turn a column on or off (dropping a sort on a column that goes). */
export function toggleWatchCol(p: WatchPrefs, id: WatchColId): WatchPrefs {
  const on = p.cols.includes(id)
  const cols = COL_IDS.filter((c) => (c === id ? !on : p.cols.includes(c as WatchColId))) as WatchColId[]
  return { cols, sort: on && p.sort?.key === id ? null : p.sort }
}

/** A header click: first descending (symbols ascending), then flipped, then back to the list's order. */
export function nextWatchSort(cur: WatchPrefs['sort'], key: WatchSortKey): WatchPrefs['sort'] {
  const first = key === 'sym' ? 'asc' : 'desc'
  if (!cur || cur.key !== key) return { key, dir: first }
  if (cur.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' }
  return null
}

/**
 * Sort `items` by `value(item)` (numbers or strings). Missing values sink to
 * the bottom either way; ties keep the list's order. No sort: unchanged.
 */
export function sortWatch<T>(
  items: T[],
  sort: WatchPrefs['sort'],
  value: (item: T, key: WatchSortKey) => number | string | null | undefined,
): T[] {
  if (!sort) return items
  const k = sort.dir === 'asc' ? 1 : -1
  return items
    .map((it, i) => ({ it, i, v: value(it, sort.key) }))
    .sort((a, b) => {
      const an = a.v == null || (typeof a.v === 'number' && !Number.isFinite(a.v))
      const bn = b.v == null || (typeof b.v === 'number' && !Number.isFinite(b.v))
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1
      const c = typeof a.v === 'string' ? a.v.localeCompare(String(b.v)) : (a.v as number) - (b.v as number)
      return c ? c * k : a.i - b.i
    })
    .map((x) => x.it)
}
