// The trade the bot planned on its latest bar, for the website (bot_state
// 'plan:SYMBOL'): side, entry, stop, target, the model's numbers, what became
// of it (opened, paper/shadow, skipped) and why, plus how it would be sized on
// the live account and on a small real-money account (BOT_PREVIEW_EQUITY,
// default $100) — the exact sizing code, so exchange minimums and fees show.
// Pure (tested in test/bot-plan.test.ts).
import type { Costs } from './features.ts'
import type { SymbolRules } from './futures.ts'
import { size } from './risk.ts'
import type { RiskConfig } from './risk.ts'

export interface SizePreview {
  equity: number
  qty: number
  notional: number
  /** Margin locked at the configured leverage. */
  margin: number
  /** USDT lost if the stop is hit, before fees. */
  riskUsd: number
  riskPct: number
  /** Exchange fees for entry plus a stop exit (both taker), USDT. */
  feesUsd: number
  /** Why the exchange would refuse it; then qty is 0. */
  reason?: string
}

export interface TradePlan {
  symbol: string
  /** When the plan was made, ms. */
  t: number
  /** Close time of the bar it was made on, ms. */
  barClose: number
  interval: string
  /** 'trend': strategy F1 (no model numbers, no target, a trailing stop). Unset: the model. */
  strategy?: 'ml' | 'trend'
  /** The rule strategy behind a 'trend' plan ('f1', ...). */
  strategyId?: string
  side: 'LONG' | 'SHORT'
  entry: number
  /** The stop in force (a trend trade's current trailed stop). */
  sl: number
  /** null: no target (trend strategy). */
  tp: number | null
  /** Calibrated win chance of the side chosen, and of each side (model plans only). */
  pWin?: number
  pLong?: number
  pShort?: number
  /** Expected value after costs, R (model plans only). */
  evR?: number
  /** Reward:risk after costs (model plans only). */
  rr?: number
  costR: number
  status: 'opened' | 'paper' | 'skipped'
  reasons: string[]
  tradeId?: number
  shadowId?: number
  live?: SizePreview
  small?: SizePreview
}

export function sizePreview(equity: number, entry: number, slDist: number, rules: SymbolRules, risk: RiskConfig, costs: Costs): SizePreview {
  const sz = size(equity, entry, slDist, rules, risk)
  const qty = Number(sz.qty)
  const base = { equity, qty, notional: sz.notional, margin: sz.notional / risk.leverage, riskUsd: sz.riskUsd, riskPct: equity > 0 ? sz.riskUsd / equity : 0 }
  return { ...base, feesUsd: sz.notional * costs.taker * 2, ...(qty > 0 ? {} : { reason: sz.reason }) }
}
