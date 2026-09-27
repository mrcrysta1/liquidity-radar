// The user's favourite coins (base tickers, e.g. 'BTC'). Starred from the
// chart's coin picker; the Dashboard and Radar watchlists follow the list.
// Saved like every other setting, so it travels with a signed-in account.
import { useSyncExternalStore } from 'react'
import { storageGet, storageSet } from '../../services/storage'

const KEY = 'lr-favCoins'
/** What the watchlists show before anything is starred. */
export const DEFAULT_WATCH = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']

let favs: string[] = (() => {
  const v = storageGet<unknown>(KEY, [])
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
})()
let version = 0
const listeners = new Set<() => void>()
function emit(): void {
  version++
  listeners.forEach((f) => f())
}

export const getFavorites = () => favs
export const isFavorite = (base: string) => favs.includes(base)
export function toggleFavorite(base: string): void {
  favs = favs.includes(base) ? favs.filter((b) => b !== base) : [...favs, base]
  storageSet(KEY, favs)
  emit()
}
/** Favourites if any, else the default watchlist. */
export const watchList = () => (favs.length ? favs : DEFAULT_WATCH)

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
