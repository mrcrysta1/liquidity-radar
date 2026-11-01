// The server bot's strategies and their health (bot_state 'strategy:<id>',
// written by radar-worker/src/bot/strategies.ts refreshHealth from
// radar-worker/src/bot/health.ts). Pure (tested in scripts/test-engines.mjs);
// serverBot.ts loadStrategies fetches the rows.

export type BotStrategyState = 'live' | 'probation' | 'shadow'

export interface BotStrategyTransition {
  t: number
  from: BotStrategyState
  to: BotStrategyState
  reason: string
}

export interface BotStrategy {
  id: string
  name: string
  /** 1 = first claim on a market's one real position. */
  priority: number | null
  state: BotStrategyState
  /** The state BOT_STRATEGIES gave it. */
  configured: 'live' | 'shadow'
  since: number | null
  /** No bands: never promoted or demoted automatically. */
  hasBands: boolean
  real: number
  shadow: number
  /** Mean R of the last 30 closed trades (null with fewer). */
  roll30: number | null
  /** Mean R of every closed trade. */
  expR: number | null
  /** Drawdown in R from the peak, and the worst, since it went live (or since its demotion). */
  ddR: number | null
  maxDdR: number | null
  /** Trades since it went live / was demoted. */
  segN: number | null
  last: BotStrategyTransition | null
  updated: number | null
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v))
const STATES: BotStrategyState[] = ['live', 'probation', 'shadow']

/** bot_state values → strategies in priority order; unusable rows are dropped. */
export function normalizeStrategies(values: unknown[]): BotStrategy[] {
  const out: BotStrategy[] = []
  for (const v of values) {
    const x = (typeof v === 'string' ? safeParse(v) : v) as Raw | null
    if (!x || typeof x !== 'object' || typeof x.id !== 'string') continue
    const state = STATES.includes(x.state as BotStrategyState) ? (x.state as BotStrategyState) : null
    if (!state) continue
    const s = (x.stats && typeof x.stats === 'object' ? x.stats : {}) as Raw
    const hist = Array.isArray(x.history) ? (x.history as Raw[]) : []
    const h = hist[hist.length - 1]
    out.push({
      id: x.id,
      name: typeof x.name === 'string' && x.name ? x.name : x.id.toUpperCase(),
      priority: num(x.priority),
      state,
      configured: x.configured === 'shadow' ? 'shadow' : 'live',
      since: num(x.since),
      hasBands: x.hasBands === true,
      real: num(s.real) ?? 0,
      shadow: num(s.shadow) ?? 0,
      roll30: num(s.roll30),
      expR: num(s.expR),
      ddR: num(s.ddR),
      maxDdR: num(s.maxDdR),
      segN: num(s.segN),
      last: h && STATES.includes(h.to as BotStrategyState) ? { t: num(h.t) ?? 0, from: h.from as BotStrategyState, to: h.to as BotStrategyState, reason: String(h.reason ?? '') } : null,
      updated: num(x.updated),
    })
  }
  return out.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id))
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
