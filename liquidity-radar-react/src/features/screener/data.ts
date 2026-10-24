// Screener data: rows from what the app already holds, indicators on demand.
//
// Prices, 24h change and volume come straight from state.tickers (the shared
// ticker poll), names from the coin catalog and market caps from the CoinGecko
// snapshot in state.marketCaps — the screener makes no request of its own for
// them. Indicator columns need daily candles; those are fetched lazily, only for
// the rows the table is showing, one at a time through the paced feature-kline
// chain (services/failover fetchKlineRows: Binance → Bybit → OKX, which keeps
// its own last-good copy). Each coin's snapshot is cached for TECH_TTL_MS, and
// nothing is fetched during a Binance rate-limit cooldown.
import { useSyncExternalStore } from 'react'
import { COINS } from '../../constants/market'
import { isInstrument } from '../../constants/instruments'
import { state } from '../../services/store'
import { fetchKlineRows } from '../../services/failover'
import { createPacer } from '../../services/providerChain'
import { isRateLimited } from '../../api/rateLimit'
import { storageGet, storageSet } from '../../services/storage'
import { marketRow } from '../markets/catalog'
import type { CandleFlat } from '../../services/market'
import {
  absChange,
  computeTech,
  sanitizePrefs,
  type ScreenerPrefs,
  type ScreenerRow,
  type TechSnapshot,
} from './logic'

/** Daily candles per coin: enough for EMA/SMA 200 plus a little warm-up. */
const DAILY_BARS = 220
/** How long one coin's indicators stay fresh. Daily bars move slowly. */
const TECH_TTL_MS = 10 * 60_000
/** After a failed load, wait this long before trying that coin again. */
const RETRY_MS = 2 * 60_000
/** Gap between two indicator loads, on top of the client's own pacing. */
const GAP_MS = 350
/** The most rows whose indicators are loaded at once. */
export const TECH_TOP_N = 40

interface TechEntry {
  at: number
  tech: TechSnapshot | null
  error?: boolean
}

const cache = new Map<string, TechEntry>()
const queue: string[] = []
let running = false
let version = 0
const listeners = new Set<() => void>()
const pace = createPacer(GAP_MS)

function emit(): void {
  version++
  listeners.forEach((f) => f())
}

export function techOf(sym: string): TechSnapshot | null {
  return cache.get(sym)?.tech ?? null
}
/** 'ready', 'loading' (queued or in flight), 'error' or 'idle'. */
export function techStatus(sym: string): 'ready' | 'loading' | 'error' | 'idle' {
  const e = cache.get(sym)
  if (e?.tech) return 'ready'
  if (queue.includes(sym) || inFlight === sym) return 'loading'
  if (e?.error) return 'error'
  return 'idle'
}

let inFlight: string | null = null

function stale(sym: string, now: number): boolean {
  const e = cache.get(sym)
  if (!e) return true
  return now - e.at > (e.error ? RETRY_MS : TECH_TTL_MS)
}

async function load(sym: string): Promise<void> {
  const rows = await fetchKlineRows(sym, '1d', DAILY_BARS)
  const candles: CandleFlat[] = rows
    .map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
    .filter((c) => Number.isFinite(c.c) && c.c > 0)
  if (candles.length < 15) throw new Error('not enough history')
  cache.set(sym, { at: Date.now(), tech: computeTech(candles) })
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    while (queue.length) {
      // A Binance cooldown: stop and let the next render ask again.
      if (isRateLimited()) break
      await pace()
      const sym = queue.shift()!
      inFlight = sym
      try {
        await load(sym)
      } catch {
        const prev = cache.get(sym)
        // Keep an older snapshot on screen; just remember to retry later.
        cache.set(sym, { at: Date.now(), tech: prev?.tech ?? null, error: true })
      }
      inFlight = null
      emit()
    }
  } finally {
    running = false
    inFlight = null
  }
}

/**
 * Ask for indicators for these symbols (the rows on screen, in display order).
 * Anything already fresh or queued is skipped; the queue is re-ordered so the
 * first rows on screen load first, and rows that scrolled out are dropped.
 */
export function requestTech(syms: string[]): void {
  const now = Date.now()
  const want = syms.slice(0, TECH_TOP_N).filter((s) => !isInstrument(s) && stale(s, now) && s !== inFlight)
  const before = queue.join(',')
  queue.length = 0
  queue.push(...want)
  if (queue.join(',') !== before) emit()
  if (queue.length) void drain()
}

export function useTechVersion(): number {
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

/** One row per tracked crypto pair the ticker poll has a price for. */
export function buildRows(): ScreenerRow[] {
  const out: ScreenerRow[] = []
  for (const base of Object.keys(COINS)) {
    const sym = COINS[base].sym
    if (isInstrument(sym)) continue
    const t = state.tickers[sym]
    if (!t || !Number.isFinite(t.last) || t.last <= 0) continue
    const m = marketRow(sym)
    out.push({
      sym,
      base: m.ticker,
      name: m.name,
      price: t.last,
      pct: Number.isFinite(t.pct) ? t.pct : 0,
      chg: absChange(t.last, Number.isFinite(t.pct) ? t.pct : 0),
      vol: Number.isFinite(t.qvol) ? t.qvol : 0,
      mcap: state.marketCaps?.[base]?.marketCap ?? null,
      tech: techOf(sym),
    })
  }
  return out
}

// ---- Saved filters and sort --------------------------------------------------

const PREFS_KEY = 'lr-screener'

export function loadPrefs(): ScreenerPrefs {
  return sanitizePrefs(storageGet<unknown>(PREFS_KEY, null))
}
export function savePrefs(p: ScreenerPrefs): void {
  storageSet(PREFS_KEY, p)
}
