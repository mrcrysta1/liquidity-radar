// Strategy plugins: every strategy the bot can run, behind one interface, and
// the BOT_STRATEGIES setting that says which run and in which state.
//
//   rule strategies  signal(bars, i) → an entry (side, stop) on the close of
//                    bar i, or null; manage(position, bars, j) → the close of
//                    bar j while in a trade: exit, or a new (never looser) stop.
//                    Real trades are placed and managed by trader.ts; shadow
//                    trades are resolved with the same manage() by
//                    resolveRuleShadow below.
//   'ml'             the model (walkforward.ts / learning.ts). Its decisions,
//                    bracket and shadow resolution stay where they are; it is
//                    listed here so it can be configured, prioritised and
//                    monitored like the others.
//
// Each strategy may carry health bands (from research): the expected
// expectancy, the 5th / 1st percentile of the rolling 30-trade expectancy and
// the 95th / 99th percentile of the drawdown in R. health.ts demotes a live
// strategy that falls outside them and promotes it back only on fresh shadow
// evidence; a strategy without bands is never promoted automatically.
import type { Bar, Costs } from './features.ts'
import { costR } from './features.ts'
import { excursion } from './journal.ts'
import { F1, TREND_BARS, highPrev, lowPrev, noEntryReason, onClose, trendIndicators, trendSignal } from './strategy.ts'
import type { TrendInd } from './strategy.ts'
import { evaluateHealth } from './health.ts'
import type { HealthBands, HealthRecord, StrategyState } from './health.ts'
import type { BotStore } from './store.ts'

/** An entry on the close of the signal bar. */
export interface Signal {
  side: 1 | -1
  /** The initial stop, from the signal bar's close. */
  stop: number
  /** Its distance (1R); a real fill keeps the distance, not the price. */
  dist: number
  /** ATR at the signal bar (stored with the trade). */
  atr: number
  /** The inputs behind the signal, kept with the trade. */
  features: Record<string, number>
}

/** A position as manage() sees it. */
export interface ManagedPos {
  side: 1 | -1
  entry: number
  /** The stop in force. */
  stop: number
  initialStop: number
  /** Most favourable extreme over the closes managed so far (highest high for a long; -Infinity / Infinity before the first). */
  best: number
}

export interface ManageResult {
  exit: boolean
  stop: number
  best: number
  /** Why it exits (exit) or how the stop was set (otherwise), for the event log. */
  note: string
}

export interface RuleStrategy {
  kind: 'rule'
  id: string
  name: string
  /** Markets it trades (unset: every market the bot runs). */
  symbols?: string[]
  interval: string
  sides: Array<1 | -1>
  /** Bars of history it needs at a decision. */
  bars: number
  health?: HealthBands
  /** One line on the signal bar's numbers, for the plan and the event log. */
  describe(b: Bar[], i: number): string
  /** Why there is no entry on bar i, '' if there is one. */
  noEntry(b: Bar[], i: number): string
  /** The initial stop distance an entry on bar i has (or would have). */
  stopDist(b: Bar[], i: number): number
  signal(b: Bar[], i: number): Signal | null
  manage(p: ManagedPos, b: Bar[], j: number): ManageResult
}

export interface ModelStrategy {
  kind: 'model'
  id: 'ml'
  name: string
  symbols?: string[]
  health?: HealthBands
}

export type Strategy = RuleStrategy | ModelStrategy

// ---- F1 ----------------------------------------------------------------------

/** Indicators per bar array: a plugin is asked about many bars of the same array. */
const f1Ind = new WeakMap<Bar[], TrendInd>()
const ind = (b: Bar[]): TrendInd => {
  let x = f1Ind.get(b)
  if (!x) f1Ind.set(b, (x = trendIndicators(b)))
  return x
}
const sig6 = (v: number) => +v.toPrecision(6)

/**
 * Health bands of F1. They come from the research runs and are set
 * conservatively until the lead replaces them with the research percentiles:
 * expected +0.18R/trade (sealed holdout), rolling 30-trade expectancy p5
 * -0.2R / p1 -0.35R, drawdown p95 15R / p99 22R.
 */
export const F1_HEALTH: HealthBands = { expR: 0.18, roll30P5: -0.2, roll30P1: -0.35, ddP95: 15, ddP99: 22 }

export const F1_STRATEGY: RuleStrategy = {
  kind: 'rule',
  id: 'f1',
  name: 'F1 trend breakout (4h, long)',
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
  interval: '4h',
  sides: [1],
  bars: TREND_BARS,
  health: F1_HEALTH,
  describe(b, i) {
    const x = ind(b)
    return `F1: close ${b[i].c} · EMA(${F1.emaLen}) ${sig6(x.ema[i])} · ${F1.entryLen}-bar high ${highPrev(b, i, F1.entryLen)} · ATR ${sig6(x.atr[i])}`
  },
  noEntry: (b, i) => noEntryReason(b, ind(b), i),
  stopDist: (b, i) => F1.slAtr * ind(b).atr[i],
  signal(b, i) {
    const x = ind(b)
    if (!trendSignal(b, x, i)) return null
    const atr = x.atr[i]
    const dist = F1.slAtr * atr
    return {
      side: 1,
      stop: b[i].c - dist,
      dist,
      atr,
      features: { close: b[i].c, ema300: x.ema[i], high20: highPrev(b, i, F1.entryLen), low10: lowPrev(b, i, F1.exitLen), atr14: atr },
    }
  },
  manage(p, b, j) {
    const x = ind(b)
    const r = onClose(b, x, j, { stop: p.stop, high: p.best })
    if (r.exit) {
      const c = b[j].c
      const note = c <= x.ema[j] ? `close ${c} ≤ EMA(${F1.emaLen}) ${sig6(x.ema[j])}` : `close ${c} < the ${F1.exitLen}-bar low ${lowPrev(b, j, F1.exitLen)}`
      return { exit: true, stop: p.stop, best: p.best, note }
    }
    return { exit: false, stop: r.stop, best: r.high, note: `highest high ${r.high} − ${F1.trailAtr} ATR ${sig6(x.atr[j])}` }
  },
}

export const ML_STRATEGY: ModelStrategy = { kind: 'model', id: 'ml', name: 'Model (MLP, bracket)' }

/** Every strategy the bot knows, by id. */
export const STRATEGIES: Record<string, Strategy> = { f1: F1_STRATEGY, ml: ML_STRATEGY }

/** The rule strategy behind an open trend-mode trade (rows from before 008_bot_strategies.sql have none: F1). */
export function ruleStrategy(id: string | null | undefined): RuleStrategy | null {
  const s = STRATEGIES[id || 'f1']
  return s?.kind === 'rule' ? s : null
}

// ---- configuration ---------------------------------------------------------------

/** A strategy as configured: its id and the state it starts in. Order = priority for the one real position per market. */
export interface StrategySlot {
  id: string
  state: Extract<StrategyState, 'live' | 'shadow'>
}

/**
 * BOT_STRATEGIES, e.g. "f1:live,ml:shadow" (state defaults to live). Unset:
 * BOT_STRATEGY=trend is the alias "f1:live,ml:shadow"; anything else is the
 * model alone (null: the single-strategy path, unchanged).
 */
export function parseStrategies(spec: string | undefined, legacy?: string): StrategySlot[] | null {
  if (!spec || !spec.trim()) return legacy === 'trend' ? [{ id: 'f1', state: 'live' }, { id: 'ml', state: 'shadow' }] : null
  const out: StrategySlot[] = []
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [id, st = 'live'] = part.split(':').map((s) => s.trim().toLowerCase())
    if (!STRATEGIES[id]) throw new Error(`unknown strategy "${id}" in BOT_STRATEGIES (known: ${Object.keys(STRATEGIES).join(', ')})`)
    if (st !== 'live' && st !== 'shadow') throw new Error(`strategy ${id}: state must be live or shadow, not "${st}"`)
    if (out.some((x) => x.id === id)) throw new Error(`strategy ${id} is listed twice in BOT_STRATEGIES`)
    out.push({ id, state: st })
  }
  if (!out.length) throw new Error('BOT_STRATEGIES lists no strategy')
  return out
}

// ---- research-style backtest and the shadow resolver ---------------------------------

export interface RuleTrade {
  i: number
  side: 1 | -1
  entry: number
  dist: number
  initialStop: number
  exitBar: number
  exit: number
  why: 'sl' | 'trail' | 'signal'
  /** Gross R. */
  r: number
}

/**
 * A rule strategy on one symbol, one position at a time, the research way:
 * entry at the next open, stops fill at the stop or a worse open on a gap,
 * rule exits at the next open. For F1 this is exactly trendBacktest (tested).
 */
export function ruleBacktest(s: RuleStrategy, b: Bar[]): RuleTrade[] {
  const out: RuleTrade[] = []
  for (let i = 1; i < b.length - 1; i++) {
    const sg = s.signal(b, i)
    if (!sg) continue
    const side = sg.side
    const entry = b[i + 1].o
    const dist = sg.dist
    if (!(dist > 0)) continue
    const initialStop = entry - side * dist
    let p: ManagedPos = { side, entry, stop: initialStop, initialStop, best: side > 0 ? -Infinity : Infinity }
    let done: RuleTrade | null = null
    for (let j = i + 1; j < b.length; j++) {
      const op = j === i + 1 ? entry : b[j].o
      if (side > 0 ? b[j].l <= p.stop : b[j].h >= p.stop) {
        const exit = side > 0 ? Math.min(op, p.stop) : Math.max(op, p.stop)
        done = { i, side, entry, dist, initialStop, exitBar: j, exit, why: p.stop === initialStop ? 'sl' : 'trail', r: (side * (exit - entry)) / dist }
        break
      }
      if (j + 1 >= b.length) break
      const m = s.manage(p, b, j)
      if (m.exit) {
        const exit = b[j + 1].o
        done = { i, side, entry, dist, initialStop, exitBar: j, exit, why: 'signal', r: (side * (exit - entry)) / dist }
        break
      }
      p = { ...p, stop: m.stop, best: m.best }
    }
    if (!done) break
    out.push(done)
    i = done.exitBar - 1
  }
  return out
}

/** An open rule-strategy shadow trade, as stored. */
export interface RuleShadowSpec {
  side: 1 | -1
  /** The signal bar's close: the virtual entry. */
  entry: number
  /** The initial stop. */
  sl: number
  /** Open time of the signal bar. */
  barTime: number
}

export type RuleShadowResult =
  | { status: 'closed'; exit: 'sl' | 'trail' | 'signal'; exitPrice: number; rGross: number; rNet: number; closedAt: number; maeR: number; mfeR: number; bars: number }
  | { status: 'expired'; reason: string }

/**
 * Resolve a rule strategy's shadow trade on closed bars (oldest first), with
 * the strategy's own exit logic replayed from the signal bar: a bar through the
 * stop fills it (or a worse open on a gap); otherwise manage() at its close —
 * a rule exit fills at that close, as a live market close right after it
 * would. Stateless: the whole trade is replayed each time. null = still open.
 */
export function resolveRuleShadow(s: RuleStrategy, sh: RuleShadowSpec, bars: Bar[], stepMs: number, costs: Costs): RuleShadowResult | null {
  const b = bars
  const i0 = b.findIndex((x) => x.t === sh.barTime)
  const after = b.filter((x) => x.t > sh.barTime)
  if (!after.length) return null
  if (i0 < 0) return { status: 'expired', reason: after[0].t > sh.barTime + stepMs ? 'bars after the decision are missing' : 'the signal bar is outside the history window' }
  if (b[i0 + 1] && b[i0 + 1].t > sh.barTime + stepMs) return { status: 'expired', reason: 'bars after the decision are missing' }
  const dist = Math.abs(sh.entry - sh.sl)
  if (!(dist > 0)) return { status: 'expired', reason: 'bad stop distance' }
  const side = sh.side
  let p: ManagedPos = { side, entry: sh.entry, stop: sh.sl, initialStop: sh.sl, best: side > 0 ? -Infinity : Infinity }
  const done = (exit: 'sl' | 'trail' | 'signal', price: number, j: number): RuleShadowResult => {
    const rGross = (side * (price - sh.entry)) / dist
    const held = b.slice(i0 + 1, j + 1)
    const ex = excursion({ side, entry: sh.entry, sl: sh.sl, tp: side * Infinity }, exit === 'signal' ? held : held.slice(0, -1), [price]) ?? { maeR: 0, mfeR: 0 }
    // Both legs are market orders (taker), as the 'sl' case of costR.
    return { status: 'closed', exit, exitPrice: price, rGross, rNet: rGross - costR(sh.entry, dist, costs, 'sl'), closedAt: b[j].t + stepMs, ...ex, bars: j - i0 }
  }
  for (let j = i0 + 1; j < b.length; j++) {
    if (side > 0 ? b[j].l <= p.stop : b[j].h >= p.stop) {
      const exit = side > 0 ? Math.min(b[j].o, p.stop) : Math.max(b[j].o, p.stop)
      return done(p.stop === p.initialStop ? 'sl' : 'trail', exit, j)
    }
    const m = s.manage(p, b, j)
    if (m.exit) return done('signal', b[j].c, j)
    p = { ...p, stop: m.stop, best: m.best }
  }
  return null
}

// ---- health, for the whole bot ---------------------------------------------------

/**
 * Re-judge every configured strategy from all its closed real and shadow
 * trades (health.ts), store the verdict in bot_state 'strategy:<id>' (the
 * traders and the website read it) and log every transition. Returns the states.
 */
export async function refreshHealth(store: BotStore, slots: StrategySlot[], now: number): Promise<Record<string, StrategyState>> {
  const out: Record<string, StrategyState> = {}
  for (const slot of slots) {
    const prev = await store.getState<HealthRecord | null>('strategy:' + slot.id, null)
    const { record, transition } = evaluateHealth(prev, slot, await store.strategyOutcomes(slot.id), STRATEGIES[slot.id]?.health, now)
    await store.setState('strategy:' + slot.id, { ...record, name: STRATEGIES[slot.id]?.name ?? slot.id, priority: slots.indexOf(slot) + 1 })
    if (transition) {
      const worse = transition.to === 'shadow' || transition.to === 'probation'
      await store.event(worse ? 'warn' : 'info', null, `strategy ${slot.id}: ${transition.from} → ${transition.to} — ${transition.reason}`)
    }
    out[slot.id] = record.state
  }
  return out
}
