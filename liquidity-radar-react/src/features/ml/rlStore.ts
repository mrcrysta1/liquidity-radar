// Orchestrates the RL trading policy: trains it, and — when the user turns
// auto-trading on — opens simulated (paper) positions when it recommends
// going long, watches live price ticks for the position closing at TP or
// SL, and folds each real outcome back into the policy via online
// fine-tuning. This is the "agent builds itself" loop: nothing here ever
// places a real exchange order or touches an API key (see paperTrading.ts's
// header) — the policy only ever learns from simulated fills against real
// prices.
//
// rl.ts (and the tfjs it needs) is imported dynamically throughout, for the
// same reason as ml/store.ts: this module is reachable from the eager
// bundle via userActions.ts's resetRL(), and a static import would drag
// TensorFlow.js into every visitor's initial page load.
import type { CandleFlat } from '../../services/market'
import type { Action, RLPolicy } from './rl'
import {
  checkPaperTrade,
  getOpenTrade,
  getStats,
  markLearned,
  openPaperTrade,
  unlearnedTrades,
} from './paperTrading'
import type { PaperStats, PaperTrade } from './paperTrading'
import { storageGet, storageSet } from '../../services/storage'

export type RLStatus = 'idle' | 'training' | 'ready' | 'insufficient-data' | 'error'

interface RLState {
  status: RLStatus
  policy: RLPolicy | null
  action: Action | null
  symbol: string
  tf: string
  error?: string
  openTrade: PaperTrade | null
  stats: PaperStats
  learnEvents: number
  /** Epoch progress while status is 'training'; null otherwise. A button that
   *  says "Training…" for minutes with no movement reads as broken. */
  progress: { epoch: number; of: number } | null
}

const EMPTY_STATS: PaperStats = { count: 0, wins: 0, winRate: 0, totalReturn: 0, avgReturn: 0 }

let state: RLState = {
  status: 'idle',
  policy: null,
  action: null,
  symbol: '',
  tf: '',
  openTrade: null,
  stats: EMPTY_STATS,
  learnEvents: 0,
  progress: null,
}

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onRLChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getRLState(): RLState {
  return state
}

const AUTO_KEY = 'lr-rlAutoTrade'
let autoTrade = storageGet<boolean>(AUTO_KEY, false)
export function getAutoTrade(): boolean {
  return autoTrade
}
export function setAutoTrade(v: boolean): void {
  autoTrade = v
  storageSet(AUTO_KEY, v)
  emit()
}

let latestCandles: CandleFlat[] = []
let trainToken = 0

export async function trainRLPolicy(symbol: string, tf: string, candles: CandleFlat[]): Promise<void> {
  const token = ++trainToken
  latestCandles = candles
  const { disposePolicy, trainPolicy, currentAction } = await import('./rl')
  disposePolicy(state.policy)
  state = { ...state, status: 'training', policy: null, action: null, symbol, tf, progress: { epoch: 0, of: 1 } }
  emit()
  try {
    const policy = await trainPolicy(symbol, tf, candles, (epoch, of) => {
      if (token !== trainToken) return
      state = { ...state, progress: { epoch, of } }
      emit()
    })
    if (token !== trainToken) {
      disposePolicy(policy)
      return
    }
    if (!policy) {
      state = { ...state, status: 'insufficient-data', progress: null, policy: null, action: null, symbol, tf }
      emit()
      return
    }
    const action = currentAction(policy, candles)
    state = {
      ...state,
      status: 'ready',
      progress: null,
      policy,
      action,
      symbol,
      tf,
      openTrade: getOpenTrade(symbol),
      stats: getStats(symbol),
    }
    emit()
    maybeAutoOpen(symbol, tf, candles, action)
  } catch (e) {
    if (token !== trainToken) return
    state = {
      ...state,
      status: 'error',
      progress: null,
      policy: null,
      action: null,
      symbol,
      tf,
      error: e instanceof Error ? e.message : String(e),
    }
    emit()
  }
}

function maybeAutoOpen(symbol: string, tf: string, candles: CandleFlat[], action: Action | null): void {
  if (!autoTrade || !action || action.action !== 'long') return
  if (getOpenTrade(symbol)) return
  const trade = openPaperTrade(symbol, tf, candles)
  if (trade) {
    state = { ...state, openTrade: trade }
    emit()
  }
}

/** Wired to the live ticker stream (see engine/app.ts's onTickerLive) — a
 * cheap check on every price tick for whether the open paper trade (if any)
 * has actually hit its TP or SL. */
export function checkRLPriceTick(symbol: string, price: number): void {
  if (symbol !== state.symbol) return
  const hadOpen = !!getOpenTrade(symbol)
  if (!hadOpen) return
  checkPaperTrade(symbol, price)
  const stillOpen = getOpenTrade(symbol)
  if (stillOpen) return // didn't close this tick
  state = { ...state, openTrade: null, stats: getStats(symbol) }
  emit()
  void learnFromClosedTrades(symbol)
}

/** Fine-tunes the current policy on any closed-but-not-yet-learned-from
 * trades for this symbol, then re-derives the live recommendation from the
 * updated weights. Safe to call any time — a no-op if there's nothing new. */
export async function learnFromClosedTrades(symbol: string): Promise<void> {
  if (!state.policy || state.symbol !== symbol) return
  const pending = unlearnedTrades(symbol)
  if (!pending.length) return
  const { fineTuneFromTrades, currentAction } = await import('./rl')
  await fineTuneFromTrades(
    state.policy,
    pending.map((t) => ({ entryFeatures: t.entryFeatures, realizedReturn: t.pnlPct ?? 0 })),
  )
  markLearned(pending.map((t) => t.id))
  const action = currentAction(state.policy, latestCandles)
  state = { ...state, action, learnEvents: state.learnEvents + 1 }
  emit()
  maybeAutoOpen(symbol, state.tf, latestCandles, action)
}

export async function resetRL(): Promise<void> {
  trainToken++
  if (state.policy) {
    const { disposePolicy } = await import('./rl')
    disposePolicy(state.policy)
  }
  latestCandles = []
  state = {
    status: 'idle',
    progress: null,
    policy: null,
    action: null,
    symbol: '',
    tf: '',
    openTrade: null,
    stats: EMPTY_STATS,
    learnEvents: 0,
  }
  emit()
}
