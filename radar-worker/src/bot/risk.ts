// Position sizing and the hard limits no model output can override.
import { roundStep } from './futures.ts'
import type { SymbolRules } from './futures.ts'

export interface RiskConfig {
  /** Fraction of equity lost if the stop is hit (0.005 = 0.5%). */
  riskPerTrade: number
  /** Cap on position notional as a multiple of equity. */
  maxNotionalX: number
  leverage: number
  /** Halt new entries for the rest of the UTC day after losing this fraction. */
  maxDailyLoss: number
  /** Halt until manually reset after equity falls this far below its peak. */
  maxDrawdown: number
}

export const DEFAULT_RISK: RiskConfig = {
  riskPerTrade: 0.005,
  maxNotionalX: 2,
  leverage: 3,
  maxDailyLoss: 0.03,
  maxDrawdown: 0.15,
}

export interface Sizing {
  qty: string
  notional: number
  riskUsd: number
  /** Why no trade is possible, if qty is zero. */
  reason?: string
}

export function size(equity: number, entry: number, slDist: number, rules: SymbolRules, r: RiskConfig): Sizing {
  if (!(equity > 0) || !(entry > 0) || !(slDist > 0)) return { qty: '0', notional: 0, riskUsd: 0, reason: 'bad inputs' }
  const byRisk = (equity * r.riskPerTrade) / slDist
  const byNotional = (equity * Math.min(r.maxNotionalX, r.leverage)) / entry
  const raw = Math.min(byRisk, byNotional)
  const qty = roundStep(raw, rules.stepSize, rules.quantityPrecision)
  const q = Number(qty)
  if (q < rules.minQty) return { qty: '0', notional: 0, riskUsd: 0, reason: `size ${raw.toPrecision(3)} under the minimum quantity ${rules.minQty}` }
  if (q * entry < rules.minNotional)
    return { qty: '0', notional: 0, riskUsd: 0, reason: `notional $${(q * entry).toFixed(2)} under the exchange minimum $${rules.minNotional}` }
  return { qty, notional: q * entry, riskUsd: q * slDist }
}

export interface RiskState {
  day: string // UTC date the daily figures belong to
  dayStartEquity: number
  peakEquity: number
  halted: boolean
  haltReason: string
}

export function utcDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/** Roll the day, track the peak, and decide whether new entries are allowed. */
export function checkLimits(s: RiskState, equity: number, now: number, r: RiskConfig): { state: RiskState; canEnter: boolean; reason: string } {
  const st = { ...s }
  const day = utcDay(now)
  if (st.day !== day) {
    st.day = day
    st.dayStartEquity = equity
    // A daily halt lifts at the new UTC day; a drawdown halt never does by itself.
    if (st.halted && st.haltReason.startsWith('daily')) {
      st.halted = false
      st.haltReason = ''
    }
  }
  st.peakEquity = Math.max(st.peakEquity || equity, equity)
  if (!st.halted && st.dayStartEquity > 0 && equity <= st.dayStartEquity * (1 - r.maxDailyLoss)) {
    st.halted = true
    st.haltReason = `daily loss limit: down ${((1 - equity / st.dayStartEquity) * 100).toFixed(2)}% today`
  }
  if (st.peakEquity > 0 && equity <= st.peakEquity * (1 - r.maxDrawdown)) {
    st.halted = true
    st.haltReason = `drawdown kill switch: ${((1 - equity / st.peakEquity) * 100).toFixed(1)}% below peak — reset manually`
  }
  return { state: st, canEnter: !st.halted, reason: st.haltReason }
}
