// The Neural Net page's own live feed: the focused symbol at the page's own
// timeframe, its candles (reloaded when a bar closes, with the forming bar
// moved by every ticker update in between), and the forecast computed from
// them. The chart and every card on the page read this one feed, so they
// always describe the same bars.
import { useSyncExternalStore } from 'react'
import type { CandleFlat } from '../../services/market'
import { loadCandleWindow } from '../../services/marketData'
import { state } from '../../services/store'
import { getActiveTab } from '../actions/userActions'
import { forecast } from './predict'
import type { Forecast } from './predict'

export const NN_TFS: Array<[string, number]> = [
  ['1m', 60_000],
  ['5m', 300_000],
  ['15m', 900_000],
  ['1h', 3_600_000],
  ['4h', 14_400_000],
  ['1d', 86_400_000],
]

let tf = '15m'
let sym = ''
let candles: CandleFlat[] = []
let fc: Forecast | null = null
let status: 'idle' | 'loading' | 'ok' | 'error' = 'idle'
let error = ''
let loadedAt = 0
/** Bumped on every reload, so the chart knows to replace its data rather than patch it. */
let dataGen = 0
let version = 0

const listeners = new Set<() => void>()
function emit(): void {
  version++
  listeners.forEach((fn) => fn())
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const tfMs = (t = tf) => NN_TFS.find((x) => x[0] === t)?.[1] ?? 900_000
/** "16 bars of 15m" as a duration: 4h. */
export function labelBars(n: number, t = tf): string {
  const m = (tfMs(t) * n) / 60_000
  if (m < 60) return m + 'm'
  if (m < 1440) return +(m / 60).toFixed(1) + 'h'
  return +(m / 1440).toFixed(1) + 'd'
}
export const getFeed = () => ({ tf, sym, candles, fc, status, error, dataGen })
export function useFeed() {
  useSyncExternalStore(subscribe, () => version)
  return getFeed()
}

export function setFeedTf(t: string): void {
  if (t === tf) return
  tf = t
  void reload()
}

let token = 0
async function reload(): Promise<void> {
  const my = ++token
  sym = String(state.symbol || 'BTCUSDT')
  status = 'loading'
  emit()
  try {
    const cs = await loadCandleWindow(sym, tf, 500)
    if (my !== token) return
    candles = cs
    // The forecast reads closed bars only; the forming one would move under it.
    const closed = cs.filter((k) => k.t + tfMs() <= Date.now())
    fc = forecast(closed, tfMs())
    status = 'ok'
    error = ''
    loadedAt = Date.now()
    dataGen++
  } catch (e) {
    if (my !== token) return
    status = 'error'
    error = e instanceof Error ? e.message : String(e)
  }
  emit()
}

function tick(): void {
  if (document.hidden || getActiveTab() !== 'neuralnet') return
  const s = String(state.symbol || 'BTCUSDT')
  const last = candles[candles.length - 1]
  if (s !== sym || !last || Date.now() >= last.t + tfMs() || Date.now() - loadedAt > 60_000) {
    if (status !== 'loading') void reload()
    return
  }
  const px = state.tickers[sym]?.last
  if (!px || px === last.c) return
  candles = candles.slice(0, -1).concat({ ...last, c: px, h: Math.max(last.h, px), l: Math.min(last.l, px) })
  emit()
}

let users = 0
let timer: ReturnType<typeof setInterval> | null = null
/** Runs only while something on the page is mounted and the tab is open. */
export function retainFeed(): () => void {
  users++
  if (!timer) {
    void reload()
    timer = setInterval(tick, 1000)
  }
  return () => {
    users--
    if (!users && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
