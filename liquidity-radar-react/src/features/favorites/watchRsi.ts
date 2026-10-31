// RSI(14) on 1h candles for the Watchlist panel's RSI column.
//
// Fetched only while the column is on, for the rows on screen, one coin at a
// time through the paced feature-kline chain (services/failover
// fetchKlineRows: Binance → Bybit → OKX) — the same path the Screener uses —
// and never during a Binance rate-limit cooldown. Each reading is kept for
// TTL_MS; a failure is retried after RETRY_MS.
import { useSyncExternalStore } from 'react'
import { isInstrument } from '../../constants/instruments'
import { isSynthetic } from '../../services/syntheticSymbol'
import { fetchKlineRows } from '../../services/failover'
import { loadCandleWindow } from '../../services/marketData'
import { createPacer } from '../../services/providerChain'
import { isRateLimited } from '../../api/rateLimit'
import { calcRSI } from '../../utils/indicators'

const BARS = 100
const TTL_MS = 5 * 60_000
const RETRY_MS = 2 * 60_000
const GAP_MS = 400
const MAX_ROWS = 50

const cache = new Map<string, { at: number; rsi: number | null; error?: boolean }>()
const queue: string[] = []
let running = false
let inFlight: string | null = null
let version = 0
const listeners = new Set<() => void>()
const pace = createPacer(GAP_MS)

function emit(): void {
  version++
  listeners.forEach((f) => f())
}

export function rsiOf(sym: string): number | null {
  return cache.get(sym)?.rsi ?? null
}

async function closes(sym: string): Promise<number[]> {
  // Instruments and ratios are priced through marketData, not the exchanges.
  if (isInstrument(sym) || isSynthetic(sym)) return (await loadCandleWindow(sym, '1h', BARS)).map((c) => c.c)
  return (await fetchKlineRows(sym, '1h', BARS)).map((k) => +k[4]).filter((c) => Number.isFinite(c) && c > 0)
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      if (isRateLimited()) break
      await pace()
      const sym = queue.shift()!
      inFlight = sym
      try {
        const c = await closes(sym)
        cache.set(sym, { at: Date.now(), rsi: c.length > 15 ? calcRSI(c, 14) : null })
      } catch {
        cache.set(sym, { at: Date.now(), rsi: cache.get(sym)?.rsi ?? null, error: true })
      }
      inFlight = null
      emit()
    }
  } finally {
    running = false
    inFlight = null
  }
}

/** Queue whatever of `syms` (display order) is missing or stale. */
export function requestRsi(syms: string[]): void {
  const now = Date.now()
  const want = syms.slice(0, MAX_ROWS).filter((s) => {
    if (s === inFlight) return false
    const e = cache.get(s)
    return !e || now - e.at > (e.error ? RETRY_MS : TTL_MS)
  })
  queue.length = 0
  queue.push(...want)
  if (queue.length) void drain()
}

export function useRsiVersion(): number {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => {
        listeners.delete(f)
      }
    },
    () => version,
  )
}
