// Position sizing and the hard limits no model output can override.
import { roundStep } from './futures.ts'
import type { SymbolRules } from './futures.ts'

export interface RiskConfig {
  /** Fraction of equity lost if the stop is hit (0.005 = 0.5%). */
  riskPerTrade: number
  /** Cap on position notional as a multiple of equity. */
  maxNotionalX: number
  leverage: number
  /**
   * Smallest margin (USDT) a trade may use: a wide stop that would size below
   * it is raised to it, so the risk taken is then above riskPerTrade, but at
   * most double it. The notional cap still wins. 0 = off.
   */
  minMarginUsd?: number
  /** Halt new entries for the rest of the UTC day after losing this fraction. */
  maxDailyLoss: number
  /** Halt until manually reset after equity falls this far below its peak. */
  maxDrawdown: number
  /**
   * Portfolio heat (hybrid mode): open risk, as a fraction of equity, allowed
   * in one direction across all symbols, and in total. Majors move together, so
   * several same-side trades on one bar are one big bet. Unset = no cap.
   */
  maxSideRisk?: number
  maxTotalRisk?: number
}

/** Open risk (USDT at the stop) by direction, across all symbols. */
export interface OpenRisk {
  long: number
  short: number
}

/**
 * Would a new trade of `riskUsd` on `side` push open risk over the caps?
 * Returns why it would (for the shadow trade's reject reason), or null.
 */
export function heatCheck(open: OpenRisk, side: 1 | -1, riskUsd: number, equity: number, r: RiskConfig): string | null {
  if (!(equity > 0)) return 'portfolio heat: equity unknown'
  const sideNow = side > 0 ? open.long : open.short
  const total = open.long + open.short
  const pctOf = (usd: number) => ((usd / equity) * 100).toFixed(2) + '%'
  // A hair of tolerance: three trades at exactly 0.5% must fit a 1.5% cap.
  const over = (usd: number, cap: number | undefined) => cap != null && usd > cap * equity * (1 + 1e-9)
  if (over(sideNow + riskUsd, r.maxSideRisk))
    return `portfolio heat: ${side > 0 ? 'long' : 'short'} risk ${pctOf(sideNow)} open + ${pctOf(riskUsd)} > ${pctOf(r.maxSideRisk! * equity)} cap`
  if (over(total + riskUsd, r.maxTotalRisk)) return `portfolio heat: total risk ${pctOf(total)} open + ${pctOf(riskUsd)} > ${pctOf(r.maxTotalRisk! * equity)} cap`
  return null
}

export const DEFAULT_RISK: RiskConfig = {
  riskPerTrade: 0.005,
  maxNotionalX: 2,
  leverage: 3,
  minMarginUsd: 100,
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
  // Margin floor, rounded UP to a whole step so it really reaches the minimum,
  // but never allowed to more than double the risk the stop implies.
  const byMargin = Math.ceil(((r.minMarginUsd ?? 0) * r.leverage) / entry / rules.stepSize - 1e-9) * rules.stepSize
  const floor = Math.min(byMargin, (equity * r.riskPerTrade * 2) / slDist)
  const raw = Math.min(Math.max(byRisk, floor), byNotional)
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

/**
 * Roll the day, track the peak, and decide whether new entries are allowed.
 * equity null (balance missing or unreadable): the state is kept as it was —
 * an unknown balance is not a loss, so it never trips a halt — but no new
 * entry is allowed this tick, since the limits could not be checked.
 */
export function checkLimits(s: RiskState, equity: number | null, now: number, r: RiskConfig): { state: RiskState; canEnter: boolean; reason: string } {
  const st = { ...s }
  if (equity == null || !Number.isFinite(equity)) return { state: st, canEnter: false, reason: st.haltReason || 'balance unavailable — entries paused this tick' }
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
