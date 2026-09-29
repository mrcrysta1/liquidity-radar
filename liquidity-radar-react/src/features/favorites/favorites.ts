// The user's favourite coins (base tickers, e.g. 'BTC'). Starred from the
// chart's coin picker or the Market tab's wishlist; the Dashboard and Radar
// watchlists follow the list. The list is in priority order (first = top),
// and one coin can be pinned: the Radar opens on it instead of BTC.
// Saved like every other setting, so it travels with a signed-in account.
import { useSyncExternalStore } from 'react'
import { storageGet, storageSet } from '../../services/storage'

const KEY = 'lr-favCoins'
const PIN_KEY = 'lr-pinCoin'
/** What the watchlists show before anything is starred. */
export const DEFAULT_WATCH = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']

let favs: string[] = (() => {
  const v = storageGet<unknown>(KEY, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
})()
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

export const getFavorites = () => favs
export const isFavorite = (base: string) => favs.includes(base)
function save(): void {
  storageSet(KEY, favs)
  emit()
}
export function toggleFavorite(base: string): void {
  if (favs.includes(base)) {
    favs = favs.filter((b) => b !== base)
    if (pinned === base) setPinned(null)
  } else favs = [...favs, base]
  save()
}
/** Move a favourite up (-1) or down (+1) the priority order. */
export function moveFavorite(base: string, dir: -1 | 1): void {
  const i = favs.indexOf(base)
  const j = i + dir
  if (i < 0 || j < 0 || j >= favs.length) return
  favs = favs.slice()
  ;[favs[i], favs[j]] = [favs[j], favs[i]]
  save()
}

export const getPinned = () => pinned
/** Pin one coin (null unpins). A pinned coin is always a favourite. */
export function setPinned(base: string | null): void {
  pinned = base
  storageSet(PIN_KEY, base)
  if (base && !favs.includes(base)) favs = [base, ...favs]
  save()
}
/** The pair the Radar opens on: the pinned coin, else BTC. */
export const defaultSymbol = () => (pinned ? symOf(pinned) : 'BTCUSDT')
export const symOf = (base: string) => base + 'USDT'

/** Favourites if any (pinned first), else the default watchlist. */
export const watchList = () => {
  const l = favs.length ? favs : DEFAULT_WATCH
  return pinned ? [pinned, ...l.filter((b) => b !== pinned)] : l
}

export function useFavorites(): string[] {
  useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => {
        listeners.delete(f)
      }
    },
    () => version,
  )
  return favs
}
