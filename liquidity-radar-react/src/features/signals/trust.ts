// "Should I trust this signal?" — the evidence shown under each Signals card.
// Pure (tested in scripts/test-engines.mjs): the scanner's own graded record
// for that market and conviction tier (outcomes.ts), and what the server bot
// is doing on the same market right now with its strategy's audit verdict.
// Nothing here changes a signal; it only says how much history stands behind it.
import type { WinRate } from './outcomes'

/** Fewer decided calls than this and a win rate is shown as "too few". */
export const MIN_RECORD = 10

export function recordText(w: WinRate | null, what: string): string {
  if (!w || !w.n) return `${what}: no graded calls yet`
  const r = `${w.wins} of ${w.n} reached target`
  return w.n < MIN_RECORD ? `${what}: ${r} (too few to judge)` : `${what}: ${Math.round(w.rate * 100)}% (${r})`
}

export interface PlanLike {
  symbol: string
  t: number
  side: 'LONG' | 'SHORT'
  status: 'opened' | 'paper' | 'skipped'
  strategy?: string
  strategyId?: string
}

export interface BotView {
  strategy: string
  side: 'LONG' | 'SHORT'
  status: 'opened' | 'paper'
  verdict: string | null
}

/** Scanner symbols are spot pairs (BTCUSDT) or keys; the bot's are futures pairs: compare on the base coin. */
const base = (s: string) => s.toUpperCase().replace(/^1000/, '').replace(/(USDT|USDC|USD|PERP|\.P)$/g, '')

/**
 * The bot's own signal on this market: a plan from the last 8 hours (two 4h
 * bars) that became a demo or paper trade. Skipped plans are not a signal.
 */
export function botViewFor(sym: string, plans: PlanLike[], verdicts: Record<string, string>, now: number): BotView | null {
  const b = base(sym)
  const p = plans.filter((x) => base(x.symbol) === b && x.status !== 'skipped' && now - x.t <= 8 * 3_600_000).sort((x, y) => y.t - x.t)[0]
  if (!p) return null
  const strategy = p.strategyId ?? (p.strategy === 'trend' ? 'f1' : 'ml')
  return { strategy, side: p.side, status: p.status as 'opened' | 'paper', verdict: verdicts[strategy] ?? null }
}
