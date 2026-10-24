// Setup rules: what a trade idea must satisfy before any order is placed.
//
// Pure (tested in test/bot-setup.test.ts). The trader gathers the inputs; this
// decides. Every failed rule is reported, tagged by kind:
//   hard  — the setup itself or the account says no (R:R, cost, cooldown,
//           concurrency, daily cap, risk limits). Nothing happens.
//   model — only the model's verdict says no (expected value under the bar, or
//           a model without a proven edge in gated mode). If these are the only
//           reasons, the idea is recorded as a shadow trade and resolved
//           virtually, so the model still learns from it at no risk.
// The existing hard limits (risk per trade, daily halt, drawdown kill) still
// apply on top: they arrive here as `canEnter`.
import { costR } from './features.ts'
import type { Costs } from './features.ts'

export interface SetupConfig {
  /** Minimum reward:risk after estimated fees and slippage. */
  minRR: number
  /** Maximum round-trip cost (fees + slippage, stop-exit case) in R. */
  maxCostR: number
  /** No new entry on a symbol for this long after it was stopped out. */
  cooldownMs: number
  /** Most positions open at once, across all symbols. */
  maxOpen: number
  /** Most real trades opened per UTC day, across all symbols. */
  maxTradesPerDay: number
  /** The model's expected value (R, after costs) must be above this. */
  minEvR: number
}

export const DEFAULT_SETUP: SetupConfig = {
  minRR: 1.5,
  maxCostR: 0.15,
  cooldownMs: 30 * 60_000,
  maxOpen: 4,
  maxTradesPerDay: 120,
  minEvR: 0,
}

export interface SetupInput {
  entry: number
  /** Stop and target distances from the entry, in price. */
  slDist: number
  tpDist: number
  costs: Costs
  /** Calibrated expected value of the side chosen, R after costs. */
  evR: number
  /** The strategy's own EV bar (BOT_MIN_EV); the stricter of it and minEvR applies. */
  evFloor: number
  /** gated mode: the model must have passed the walk-forward gate. */
  gated: boolean
  gatePass: boolean
  gateReason?: string
  modelId?: number
  /** Risk limits and the control switch allow entries. */
  canEnter: boolean
  openPositions: number
  tradesToday: number
  /** When this symbol was last stopped out, ms; null if never. */
  lastStopAt: number | null
  now: number
}

export interface SetupCheck {
  ok: boolean
  hard: string[]
  model: string[]
  /** Reward:risk after costs: (target R − cost if the target fills) / (1R + cost if stopped). */
  rr: number
  /** Round-trip cost in R if the trade ends at the stop (the worst case). */
  costR: number
  /** The EV bar that applied. */
  evBar: number
}

export function checkSetup(i: SetupInput, c: SetupConfig = DEFAULT_SETUP): SetupCheck {
  const hard: string[] = []
  const model: string[] = []
  const valid = i.entry > 0 && i.slDist > 0 && i.tpDist > 0
  const winCost = valid ? costR(i.entry, i.slDist, i.costs, 'tp') : Infinity
  const lossCost = valid ? costR(i.entry, i.slDist, i.costs, 'sl') : Infinity
  const rr = valid ? (i.tpDist / i.slDist - winCost) / (1 + lossCost) : 0
  const evBar = Math.max(c.minEvR, i.evFloor)
  if (!valid) hard.push('invalid stop/target')
  if (!i.canEnter) hard.push('risk limits')
  if (valid && !(rr >= c.minRR)) hard.push(`R:R ${rr.toFixed(2)} after costs (need ${c.minRR})`)
  if (valid && !(lossCost <= c.maxCostR)) hard.push(`cost ${lossCost.toFixed(3)}R (max ${c.maxCostR}R)`)
  if (i.lastStopAt != null && i.now - i.lastStopAt < c.cooldownMs)
    hard.push(`cooldown after a stop-out (${Math.ceil((c.cooldownMs - (i.now - i.lastStopAt)) / 60_000)} min left)`)
  if (i.openPositions >= c.maxOpen) hard.push(`${i.openPositions} positions open (max ${c.maxOpen})`)
  if (i.tradesToday >= c.maxTradesPerDay) hard.push(`daily trade cap reached (${i.tradesToday}/${c.maxTradesPerDay})`)
  if (i.gated && !i.gatePass) model.push(`model #${i.modelId ?? '?'} has no proven edge (${i.gateReason || 'gate failed'})`)
  if (!(i.evR > evBar)) model.push(`EV ${i.evR.toFixed(3)}R below the ${+evBar.toFixed(4)}R bar`)
  return { ok: !hard.length && !model.length, hard, model, rr, costR: lossCost, evBar }
}

/** Shadow-trade a rejected setup only when the model's verdict was the sole reason. */
export function shadowWorthy(s: SetupCheck): boolean {
  return !s.ok && !s.hard.length && s.model.length > 0
}
