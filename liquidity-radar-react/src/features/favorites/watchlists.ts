// Named watchlists: the pure list operations behind features/favorites.
//
// Every list holds base tickers ('BTC', 'XAUUSD') in the user's order, plus
// the symbols pinned to the top of that list. The first list is always the
// user's "Favourites" — the list the star buttons, Dashboard and Radar have
// always used, still saved under its old key so nothing that reads it breaks.
//
// No imports and no storage here: every function takes a state and returns
// the next one (the same object when nothing changed), so the unit tests run
// these exact functions (scripts/test-engines.mjs).

export interface Watchlist {
  id: string
  name: string
  symbols: string[]
  /** Symbols shown at the top of this list, in the order they were pinned. */
  pinned: string[]
}

export interface WatchlistsState {
  lists: Watchlist[]
  /** The list the chart's Watchlist panel shows. */
  active: string
}

/** The default list, migrated from the old single favourites list. */
export const FAV_ID = 'fav'
export const FAV_NAME = 'Favourites'
export const MAX_LISTS = 20
export const MAX_SYMBOLS = 50
export const MAX_NAME = 32

const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** Strings only, trimmed, no repeats, at most MAX_SYMBOLS. */
export function normSymbols(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (!str(x)) continue
    const s = x.trim()
    if (!out.includes(s)) out.push(s)
    if (out.length >= MAX_SYMBOLS) break
  }
  return out
}

/** A usable list name, or '' when there is nothing to use. */
export function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : ''
}

const favList = (symbols: string[] = []): Watchlist => ({
  id: FAV_ID,
  name: FAV_NAME,
  symbols,
  pinned: [],
})

/** A fresh state: just the Favourites list. */
export const initialWatchlists = (favs: unknown = []): WatchlistsState => ({
  lists: [favList(normSymbols(favs))],
  active: FAV_ID,
})

/**
 * Rebuild a state from whatever was saved. `legacyFavs` is the old
 * `lr-favCoins` array: when it is an array it is the Favourites list's
 * contents (the rest of the app still writes it), otherwise the saved copy is
 * kept. Junk entries are dropped, never the whole thing.
 */
export function normalizeWatchlists(saved: unknown, legacyFavs: unknown): WatchlistsState {
  const raw = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  const lists: Watchlist[] = []
  const ids = new Set<string>()
  for (const x of Array.isArray(raw.lists) ? raw.lists : []) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    if (!str(o.id) || ids.has(o.id)) continue
    const symbols = normSymbols(o.symbols)
    const name = cleanName(o.name) || (o.id === FAV_ID ? FAV_NAME : 'Watchlist')
    ids.add(o.id)
    lists.push({ id: o.id, name, symbols, pinned: normSymbols(o.pinned).filter((s) => symbols.includes(s)) })
    if (lists.length >= MAX_LISTS) break
  }
  let fav = lists.find((l) => l.id === FAV_ID)
  if (!fav) {
    fav = favList()
    if (lists.length >= MAX_LISTS) lists.pop()
  }
  if (Array.isArray(legacyFavs)) {
    const symbols = normSymbols(legacyFavs)
    fav = { ...fav, symbols, pinned: fav.pinned.filter((s) => symbols.includes(s)) }
  }
  const rest = lists.filter((l) => l.id !== FAV_ID)
  const all = [fav, ...rest]
  const active = str(raw.active) && all.some((l) => l.id === raw.active) ? raw.active : FAV_ID
  return { lists: all, active }
}

export const getList = (st: WatchlistsState, id: string): Watchlist | undefined =>
  st.lists.find((l) => l.id === id)

export const activeList = (st: WatchlistsState): Watchlist => getList(st, st.active) ?? st.lists[0]

function mapList(st: WatchlistsState, id: string, f: (l: Watchlist) => Watchlist): WatchlistsState {
  const i = st.lists.findIndex((l) => l.id === id)
  if (i < 0) return st
  const next = f(st.lists[i])
  if (next === st.lists[i]) return st
  const lists = st.lists.slice()
  lists[i] = next
  return { ...st, lists }
}

/** Add a list and make it the active one. A blank name becomes "Watchlist N". */
export function createList(st: WatchlistsState, name: string, id: string): WatchlistsState {
  if (st.lists.length >= MAX_LISTS || !str(id) || getList(st, id)) return st
  const n = cleanName(name) || 'Watchlist ' + (st.lists.length + 1)
  return { lists: [...st.lists, { id, name: n, symbols: [], pinned: [] }], active: id }
}

export function renameList(st: WatchlistsState, id: string, name: string): WatchlistsState {
  const n = cleanName(name)
  if (!n) return st
  return mapList(st, id, (l) => (l.name === n ? l : { ...l, name: n }))
}

/**
 * Remove a list. The last list is never removed, nor the Favourites list (the
 * stars, Dashboard and Radar follow it). Deleting the active list activates
 * its neighbour.
 */
export function deleteList(st: WatchlistsState, id: string): WatchlistsState {
  const i = st.lists.findIndex((l) => l.id === id)
  if (i < 0 || st.lists.length <= 1 || id === FAV_ID) return st
  const lists = st.lists.filter((l) => l.id !== id)
  const active = st.active === id ? lists[Math.min(i, lists.length - 1)].id : st.active
  return { lists, active }
}

export function setActive(st: WatchlistsState, id: string): WatchlistsState {
  return st.active === id || !getList(st, id) ? st : { ...st, active: id }
}

export function addSymbol(st: WatchlistsState, id: string, sym: string): WatchlistsState {
  if (!str(sym)) return st
  const s = sym.trim()
  return mapList(st, id, (l) =>
    l.symbols.includes(s) || l.symbols.length >= MAX_SYMBOLS ? l : { ...l, symbols: [...l.symbols, s] },
  )
}

/** Put a symbol at the top of a list (adding it if missing). */
export function addSymbolFirst(st: WatchlistsState, id: string, sym: string): WatchlistsState {
  if (!str(sym)) return st
  const s = sym.trim()
  return mapList(st, id, (l) =>
    l.symbols.includes(s) ? l : { ...l, symbols: [s, ...l.symbols].slice(0, MAX_SYMBOLS) },
  )
}

export function removeSymbol(st: WatchlistsState, id: string, sym: string): WatchlistsState {
  return mapList(st, id, (l) =>
    l.symbols.includes(sym)
      ? { ...l, symbols: l.symbols.filter((s) => s !== sym), pinned: l.pinned.filter((s) => s !== sym) }
      : l,
  )
}

/**
 * Swap a symbol with its on-screen neighbour: up (-1) or down (+1). Pinned
 * symbols move among the pinned ones, the rest among the rest, so a move is
 * always the one the user sees (with nothing pinned this is a plain swap).
 */
export function moveSymbol(st: WatchlistsState, id: string, sym: string, dir: -1 | 1): WatchlistsState {
  return mapList(st, id, (l) => {
    const isPinned = l.pinned.includes(sym)
    const group = isPinned ? l.pinned : l.symbols.filter((s) => !l.pinned.includes(s))
    const gi = group.indexOf(sym)
    const other = group[gi + dir]
    if (gi < 0 || other === undefined) return l
    const swap = (a: string[]) => {
      const out = a.slice()
      const i = out.indexOf(sym)
      const j = out.indexOf(other)
      ;[out[i], out[j]] = [out[j], out[i]]
      return out
    }
    return isPinned ? { ...l, pinned: swap(l.pinned) } : { ...l, symbols: swap(l.symbols) }
  })
}

/** Pin a symbol to the top of its list, or unpin it. Only symbols in the list can be pinned. */
export function togglePin(st: WatchlistsState, id: string, sym: string): WatchlistsState {
  return mapList(st, id, (l) => {
    if (!l.symbols.includes(sym)) return l
    return {
      ...l,
      pinned: l.pinned.includes(sym) ? l.pinned.filter((s) => s !== sym) : [...l.pinned, sym],
    }
  })
}

/** A list in display order: pinned symbols first, then the rest in list order. */
export const orderedSymbols = (l: Watchlist): string[] => [
  ...l.pinned.filter((s) => l.symbols.includes(s)),
  ...l.symbols.filter((s) => !l.pinned.includes(s)),
]
