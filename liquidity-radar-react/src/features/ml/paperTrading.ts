// Simulated trade execution: no exchange order is ever placed, no API key
// is ever touched — this only tracks a hypothetical position against real
// live prices, closes it when price actually reaches the TP or SL level,
// and records what really happened. That record is what
// features/ml/rl.ts's fineTuneFromTrades() learns from — the "agent builds
// itself" loop the user asked for, without any custody risk.
import { calcATR } from '../../utils/indicators'
import { latestFeatures } from './features'
import type { CandleFlat } from '../../services/market'
import { storageGet, storageSet } from '../../services/storage'

export interface PaperTrade {
  id: string
  symbol: string
  tf: string
  side: 'long'
  entry: number
  tp: number
  sl: number
  entryFeatures: number[]
  openedAt: number
  closedAt?: number
  exitPrice?: number
  outcome?: 'tp' | 'sl'
  /** Net of the same round-trip cost assumption the backtest uses. */
  pnlPct?: number
  /** Set once this trade's outcome has been folded into a fine-tune pass,
   * so the same closed trade doesn't get learned from twice. */
  learnedFrom?: boolean
}

const COST_PER_FLIP = 0.0008
const HISTORY_KEY = 'lr-paperTrades'
const MAX_HISTORY = 200

let openTrades: Record<string, PaperTrade> = {}
let history: PaperTrade[] = storageGet<PaperTrade[]>(HISTORY_KEY, [])
let seq = 0

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onPaperTradingChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

function persist(): void {
  storageSet(HISTORY_KEY, history.slice(-MAX_HISTORY))
}

export function getOpenTrade(symbol: string): PaperTrade | null {
  return openTrades[symbol] ?? null
}
export function getHistory(symbol?: string): PaperTrade[] {
  return symbol ? history.filter((t) => t.symbol === symbol) : history
}

/** Opens a simulated long using the same ATR-based stop/target framing the
 * rest of the app already uses (tradePlan() in signals.ts — 1.5x/3x ATR),
 * so this isn't a second, inconsistent convention for what a "stop" means. */
export function openPaperTrade(symbol: string, tf: string, candles: CandleFlat[]): PaperTrade | null {
  if (openTrades[symbol]) return null // one open paper position per symbol at a time
  const entry = candles[candles.length - 1]?.c
  if (!(entry > 0)) return null
  const atr = calcATR(candles, 14)
  if (!(atr > 0)) return null
  const features = latestFeatures(candles)
  if (!features) return null
  const trade: PaperTrade = {
    id: 'pt' + Date.now() + '-' + seq++,
    symbol,
    tf,
    side: 'long',
    entry,
    sl: entry - 1.5 * atr,
    tp: entry + 3 * atr,
    entryFeatures: features,
    openedAt: Date.now(),
  }
  openTrades[symbol] = trade
  emit()
  return trade
}

/** Called on every live price tick for a symbol with an open paper trade —
 * closes it the instant price actually reaches TP or SL. */
export function checkPaperTrade(symbol: string, price: number): void {
  const t = openTrades[symbol]
  if (!t || !(price > 0)) return
  let outcome: 'tp' | 'sl' | null = null
  if (price >= t.tp) outcome = 'tp'
  else if (price <= t.sl) outcome = 'sl'
  if (!outcome) return
  const exitPrice = outcome === 'tp' ? t.tp : t.sl
  const pnlPct = (exitPrice - t.entry) / t.entry - COST_PER_FLIP
  const closed: PaperTrade = { ...t, closedAt: Date.now(), exitPrice, outcome, pnlPct }
  delete openTrades[symbol]
  history.push(closed)
  persist()
  emit()
}

export function closeManually(symbol: string, price: number): void {
  const t = openTrades[symbol]
  if (!t) return
  const pnlPct = (price - t.entry) / t.entry - COST_PER_FLIP
  const closed: PaperTrade = { ...t, closedAt: Date.now(), exitPrice: price, pnlPct }
  delete openTrades[symbol]
  history.push(closed)
  persist()
  emit()
}

/** Closed trades this symbol hasn't already been fine-tuned on. */
export function unlearnedTrades(symbol: string): PaperTrade[] {
  return history.filter((t) => t.symbol === symbol && t.outcome && !t.learnedFrom)
}
export function markLearned(ids: string[]): void {
  const set = new Set(ids)
  history = history.map((t) => (set.has(t.id) ? { ...t, learnedFrom: true } : t))
  persist()
  emit()
}

export interface PaperStats {
  count: number
  wins: number
  winRate: number
  totalReturn: number
  avgReturn: number
}
/** Every position currently open, across every symbol that has one. */
export function getOpenTrades(): PaperTrade[] {
  return Object.values(openTrades).sort((a, b) => b.openedAt - a.openedAt)
}

/**
 * The record across every symbol, not one.
 *
 * Per-symbol stats answer "is it any good at BTC"; this answers "is the
 * policy any good", which is the question the ledger is actually about.
 * Returns compound rather than summed, because a run of trades compounds.
 */
export function getOverallStats(): PaperStats {
  const closed = history.filter((t) => t.outcome)
  const wins = closed.filter((t) => t.outcome === 'tp').length
  let equity = 1
  let sum = 0
  closed.forEach((t) => {
    equity *= 1 + (t.pnlPct ?? 0)
    sum += t.pnlPct ?? 0
  })
  return {
    count: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : 0,
    totalReturn: equity - 1,
    avgReturn: closed.length ? sum / closed.length : 0,
  }
}

export function getStats(symbol: string): PaperStats {
  const closed = history.filter((t) => t.symbol === symbol && t.outcome)
  const wins = closed.filter((t) => t.outcome === 'tp').length
  let equity = 1
  let sum = 0
  closed.forEach((t) => {
    equity *= 1 + (t.pnlPct ?? 0)
    sum += t.pnlPct ?? 0
  })
  return {
    count: closed.length,
    wins,
    winRate: closed.length ? wins / closed.length : 0,
    totalReturn: equity - 1,
    avgReturn: closed.length ? sum / closed.length : 0,
  }
}

export function resetSymbol(symbol: string): void {
  delete openTrades[symbol]
  emit()
}

/** Full wipe, for a "clear paper trading history" control. */
export function clearAllPaperTrades(): void {
  openTrades = {}
  history = []
  persist()
  emit()
}
