// Higher-timeframe klines for multi-timeframe indicator inputs (see ./mtf).
//
// One cached copy per symbol + timeframe, shared by every chart and instance
// that asks. A read never waits: it returns what is cached (null at first)
// and starts a fetch when the copy is missing, too short or due a refresh;
// listeners hear when new bars land so the charts redraw. The forming bar is
// rebuilt from the chart's live bars on every redraw (withForming), so the
// refresh only has to correct closed bars and runs at most every half bar
// (30 s – 5 min), never per tick.
import type { CandleFlat } from '../../../services/market'
import { mtfStepMs } from './mtf'

interface Entry {
  candles: CandleFlat[] | null
  bars: number
  at: number
  busy: boolean
  used: number
}

const MAX_ENTRIES = 24
const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0

/** Bumped whenever fetched bars land: part of the indicator memo key. */
export const mtfVersion = (): number => version

export function subscribeMtf(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const refreshMs = (tf: string) => Math.min(300000, Math.max(30000, mtfStepMs(tf) / 2))

function evict(): void {
  if (cache.size <= MAX_ENTRIES) return
  let oldKey = ''
  let old = Infinity
  cache.forEach((e, k) => {
    if (!e.busy && e.used < old) {
      old = e.used
      oldKey = k
    }
  })
  if (oldKey) cache.delete(oldKey)
}

async function load(key: string, sym: string, tf: string, bars: number): Promise<void> {
  const e = cache.get(key)
  if (!e) return
  e.busy = true
  try {
    // Loaded on demand: the market-data module is large and the chart only
    // needs it here once someone picks a higher timeframe.
    const { loadCandleWindow } = await import('../../../services/marketData')
    const rows = await loadCandleWindow(sym, tf, bars)
    if (rows.length) {
      e.candles = rows
      e.bars = bars
      version++
      listeners.forEach((fn) => fn())
    }
  } catch (err) {
    console.warn('mtf klines', sym, tf, err)
  } finally {
    e.busy = false
    e.at = Date.now()
  }
}

/** Cached `tf` bars of `sym` (null until the first fetch lands). */
export function mtfCandles(sym: string, tf: string, bars: number): CandleFlat[] | null {
  if (!sym || !mtfStepMs(tf)) return null
  const key = sym + '|' + tf
  const now = Date.now()
  let e = cache.get(key)
  if (!e) {
    e = { candles: null, bars: 0, at: 0, busy: false, used: now }
    cache.set(key, e)
    evict()
  }
  e.used = now
  const due = now - e.at > refreshMs(tf) || (e.bars < bars && now - e.at > 5000)
  if (!e.busy && due) void load(key, sym, tf, bars)
  return e.candles
}
