// The user's favourite coins (base tickers, e.g. 'BTC'). Starred from the
// chart's coin picker or the Market tab's wishlist; the Dashboard and Radar
// watchlists follow the list. The list is in priority order (first = top),
// and one coin can be pinned: the Radar opens on it instead of BTC.
// Saved like every other setting, so it travels with a signed-in account.
//
// Favourites are now the first of the user's named watchlists (see
// ./watchlists.ts for the list operations); the chart's Watchlist panel shows
// and edits the others. The favourites keep their old key, `lr-favCoins`,
// which stays the source of truth for that list — an old saved list is the
// Favourites list on first read, so nothing is lost and nothing that reads
// the old key breaks.
import { useSyncExternalStore } from 'react'
import { storageGet, storageSet } from '../../services/storage'
import { isInstrument } from '../../constants/instruments'
import {
  FAV_ID,
  addSymbol,
  addSymbolFirst,
  createList,
  deleteList,
  getList,
  moveSymbol,
  normalizeWatchlists,
  removeSymbol,
  renameList,
  setActive,
  togglePin,
} from './watchlists'
import type { WatchlistsState } from './watchlists'

const KEY = 'lr-favCoins'
const PIN_KEY = 'lr-pinCoin'
/** Every named watchlist and the active one (the Favourites list is also under KEY). */
export const LISTS_KEY = 'lr-watchlists'
/** What the watchlists show before anything is starred. */
export const DEFAULT_WATCH = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']

let lists: WatchlistsState = normalizeWatchlists(
  storageGet<unknown>(LISTS_KEY, null),
  storageGet<unknown>(KEY, null),
)
const favOf = (st: WatchlistsState) => getList(st, FAV_ID)?.symbols ?? []
let favs: string[] = favOf(lists)
let pinned: string | null = (() => {
  const v = storageGet<unknown>(PIN_KEY, null)
  return typeof v === 'string' && v ? v : null
})()
let version = 0
const listeners = new Set<() => void>()
function emit(): void {
  version++
  listeners.forEach((f) => f())
}
const subscribe = (f: () => void) => {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
const getVersion = () => version

/** Apply a list operation; saves (and notifies) only when something changed. */
function commit(next: WatchlistsState): void {
  if (next === lists) return
  lists = next
  favs = favOf(lists)
  save()
}

export const getFavorites = () => favs
export const isFavorite = (base: string) => favs.includes(base)
function save(): void {
  storageSet(KEY, favs)
  storageSet(LISTS_KEY, lists)
  emit()
}
export function toggleFavorite(base: string): void {
  if (favs.includes(base)) {
    lists = removeSymbol(lists, FAV_ID, base)
    favs = favOf(lists)
    if (pinned === base) setPinned(null)
  } else {
    lists = addSymbol(lists, FAV_ID, base)
    favs = favOf(lists)
  }
  save()
}
/** Move a favourite up (-1) or down (+1) the priority order. */
export function moveFavorite(base: string, dir: -1 | 1): void {
  commit(moveSymbol(lists, FAV_ID, base, dir))
}

export const getPinned = () => pinned
/** Pin one coin (null unpins). A pinned coin is always a favourite. */
export function setPinned(base: string | null): void {
  pinned = base
  storageSet(PIN_KEY, base)
  if (base && !favs.includes(base)) {
    lists = addSymbolFirst(lists, FAV_ID, base)
    favs = favOf(lists)
  }
  save()
}
/** The pair the Radar opens on: the pinned coin, else BTC. */
export const defaultSymbol = () => (pinned ? symOf(pinned) : 'BTCUSDT')
/** A favourite's pair: instruments (gold: XAUUSD) are their own symbol, coins trade against USDT. */
export const symOf = (base: string) => (isInstrument(base) ? base : base + 'USDT')

/** Favourites if any (pinned first), else the default watchlist. */
export const watchList = () => {
  const l = favs.length ? favs : DEFAULT_WATCH
  return pinned ? [pinned, ...l.filter((b) => b !== pinned)] : l
}

export function useFavorites(): string[] {
  useSyncExternalStore(subscribe, getVersion)
  return favs
}

// ------------------------------------------------------------ named watchlists

export const getWatchlists = () => lists
/** Every watchlist and the active one; re-renders on any change. */
export function useWatchlists(): WatchlistsState {
  useSyncExternalStore(subscribe, getVersion)
  return lists
}
/** Create a list (it becomes the active one); returns its id. */
export function createWatchlist(name: string): string {
  const id = 'wl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  commit(createList(lists, name, id))
  return id
}
export const renameWatchlist = (id: string, name: string) => commit(renameList(lists, id, name))
/** The Favourites list and the last list always stay. */
export const deleteWatchlist = (id: string) => commit(deleteList(lists, id))
export const setActiveWatchlist = (id: string) => commit(setActive(lists, id))
export const addToWatchlist = (id: string, base: string) => commit(addSymbol(lists, id, base))
export function removeFromWatchlist(id: string, base: string): void {
  // The Radar's pinned coin is always a favourite: dropping it unpins it, as the star does.
  if (id === FAV_ID && base === pinned) return toggleFavorite(base)
  commit(removeSymbol(lists, id, base))
}
export const moveInWatchlist = (id: string, base: string, dir: -1 | 1) =>
  commit(moveSymbol(lists, id, base, dir))
export const togglePinInWatchlist = (id: string, base: string) =>
  commit(togglePin(lists, id, base))
