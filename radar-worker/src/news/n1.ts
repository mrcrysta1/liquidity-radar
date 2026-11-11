// Experimental news strategy N1 (research, 2026-11-11): PAPER ONLY. It never
// places an order and is not one of the bot's strategies (strategies.ts): it
// is judged on its own record in news_signals (sql/011_news_signals.sql).
//
// Rule, fixed before testing (pre-registered):
//   events   US high-impact releases only: NFP, CPI, PPI, the FOMC decision,
//            GDP, unemployment, retail sales, PCE. A release being scheduled
//            is never a signal: only the market's measured reaction is.
//   decide   60 minutes after the release, per asset (BTC, ETH, gold): the
//            60-minute return's z (vs that asset's same-horizon moves over the
//            30 days before, econ_reactions) must be at least MIN_Z in size.
//            'continue' trades in the reaction's direction, 'fade' against it.
//            Which one the paper record follows was chosen on 2019–2024 only
//            (scripts/news-study.ts) and is held fixed after.
//   exit     24 hours after the release (a time exit, no stop).
//   result   the move from the decision to the exit, net of a market order
//            on each leg (fee + slippage, LEG_PCT each).
//
// Actual vs forecast: free history has no consensus forecasts before late
// 2026 (only Forex Factory's current week), so the surprise is recorded when
// known but the rule does not use it; that is a limit of the data, not a
// claim that surprises do not matter.
import type { Category } from './events.ts'

export const N1 = {
  categories: ['nfp', 'cpi', 'ppi', 'fomc', 'gdp', 'unemployment', 'retail', 'pce'] as Category[],
  assets: ['BTCUSDT', 'ETHUSDT', 'XAUUSDT'],
  minZ: 2,
  decideMin: 60,
  holdMin: 1440,
  /** Fee + slippage per market leg, % of price (the conservative profile). */
  legPct: 0.1,
}

export type N1Mode = 'continue' | 'fade'
/** The mode the live paper record follows: set from the design-period study (2019–2024). */
export const N1_MODE: N1Mode = 'continue'

/** One asset's reaction to one release: log returns in %, from econ_reactions. */
export interface N1Input {
  eventTime: number
  category: string
  asset: string
  /** 60-minute return and its z; 24-hour return (null until known). */
  ret60: number | null
  z60: number | null
  ret1440: number | null
  surprise?: number | null
}

export interface N1Eval {
  eventTime: number
  asset: string
  category: string
  mode: N1Mode
  /** 1 long, -1 short, 0 no trade. */
  side: 1 | -1 | 0
  reason: string
  z60: number | null
  ret60: number | null
  /** Move from the decision to the exit in the trade's direction, % (log), before / after costs; null without a trade or before the exit. */
  grossPct: number | null
  netPct: number | null
}

/** N1's decision on one reaction, and its result once the 24-hour return is known. */
export function evaluateN1(x: N1Input, mode: N1Mode = N1_MODE, minZ = N1.minZ): N1Eval {
  const base = { eventTime: x.eventTime, asset: x.asset, category: x.category, mode, z60: x.z60, ret60: x.ret60, grossPct: null, netPct: null }
  if (!N1.categories.includes(x.category as Category)) return { ...base, side: 0, reason: `${x.category} is not a tracked high-impact release` }
  if (!N1.assets.includes(x.asset)) return { ...base, side: 0, reason: `${x.asset} is not followed` }
  if (x.ret60 == null || x.z60 == null) return { ...base, side: 0, reason: 'no 60-minute reaction (missing bars or too little history for z)' }
  if (Math.abs(x.z60) < minZ) return { ...base, side: 0, reason: `60-minute move ${x.ret60.toFixed(2)}% is z ${x.z60.toFixed(2)}, under ${minZ}: an ordinary move` }
  if (x.ret60 === 0) return { ...base, side: 0, reason: 'no direction' }
  const dir = x.ret60 > 0 ? 1 : -1
  const side = (mode === 'continue' ? dir : -dir) as 1 | -1
  const reason = `60-minute move ${x.ret60 >= 0 ? '+' : ''}${x.ret60.toFixed(2)}% (z ${x.z60.toFixed(2)}) → ${side > 0 ? 'long' : 'short'} (${mode})`
  if (x.ret1440 == null) return { ...base, side, reason }
  const grossPct = side * (x.ret1440 - x.ret60)
  return { ...base, side, reason, grossPct, netPct: grossPct - 2 * N1.legPct }
}
