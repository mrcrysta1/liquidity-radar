// One symbol's trading loop: reconcile what the exchange holds with what the
// database says, enforce the time exit, and on each newly closed bar ask the
// model and — if every check passes — open a bracketed position.
//
// Order of operations on entry is chosen so that a crash at any point leaves
// something safe and visible: market fill → trade row written → exchange-side
// stop placed (or the position is closed at once if it cannot be) → maker
// take-profit placed. A position the database does not know about is closed.
//
// Before any order, the setup rules (setup.ts) must all pass. A setup turned
// down only by the model's verdict becomes a shadow trade, resolved on market
// bars. Every closed real or shadow trade updates the online calibration; every
// hour (or 20 closed trades) a challenger model is trained on bars plus stored
// trade outcomes and replaces the champion only if it does better on a
// held-out recent slice. The walk-forward gate is refreshed every retrainMs.
//
// Hybrid mode: a real order only on a symbol that passed its walk-forward gate,
// is in the real-trade list, and fits under the portfolio heat cap; every other
// signal that passes the hard rules is a shadow trade, so the bot still learns
// from all of them at no cost.
//
// Trend strategy (BOT_STRATEGY=trend): real trades come from the rules of
// research strategy F1 (strategy.ts), not from the model — long on a 4h
// breakout, an exchange-side stop only (no target), trailed up at each close
// by placing the new stop before cancelling the old one, and a market close on
// the exit rule. The risk limits, the heat cap and BOT_REAL_SYMBOLS still apply;
// the walk-forward gate does not (it judges the model). The model keeps
// deciding on every bar, as shadow trades only, so it goes on learning.
//
// Several strategies (BOT_STRATEGIES, strategies.ts; BOT_STRATEGY=trend is
// "f1:live,ml:shadow"): every strategy decides on every bar of its markets, in
// the configured priority order. A signal of a strategy that is live
// (health.ts: 'live' or 'probation') and passes every rule is a real trade;
// any other signal — the strategy is in 'shadow', another strategy already
// holds this market's one real position, or a risk rule said no — is a shadow
// trade of that strategy. A rule strategy has at most one shadow open per
// market, resolved with its own exit logic (resolveRuleShadow); the model's
// shadows are as before.
import { closedBars, INTERVAL_MS } from './data.ts'
import type { BarCache } from './data.ts'
import { lastPrice } from '../binance.ts'
import { FEATURES, WARMUP, costR, featureAt, indicators } from './features.ts'
import { roundStep, roundTick } from './futures.ts'
import type { Fill, Position, SymbolRules } from './futures.ts'
import { heatCheck, size } from './risk.ts'
import type { RiskConfig } from './risk.ts'
import type { BotStore, ModelRow, OpenTrade } from './store.ts'
import { DEFAULT_GATE, DEFAULT_WF, decide, fitModel, gate, walkForward } from './walkforward.ts'
import type { Metrics, WfConfig } from './walkforward.ts'
import type { Bar } from './features.ts'
import { DEFAULT_SETUP, checkSetup, shadowWorthy } from './setup.ts'
import type { SetupConfig } from './setup.ts'
import { calibrate, regimeOf, resolveShadow, scoreModel, selectChampion, splitForChallenger, updateCalibration, winLabel } from './learning.ts'
import type { Calib } from './learning.ts'
import { sizePreview } from './plan.ts'
import type { TradePlan } from './plan.ts'
import { barsBetween, barsHeld, excursion, slippageBps } from './journal.ts'
import { checkTrendSetup } from './strategy.ts'
import { STRATEGIES, parseStrategies, resolveRuleShadow, ruleStrategy, slotRuns } from './strategies.ts'
import type { ManagedPos, RefBars, RuleStrategy, Signal, StrategySlot } from './strategies.ts'
import { isLive, riskScale } from './health.ts'
import type { HealthRecord, StrategyState } from './health.ts'

/** Bars a rule strategy's decisions and shadows read: the most any of them needs. */
const RULE_BARS = Math.max(...Object.values(STRATEGIES).map((s) => (s.kind === 'rule' ? s.bars : 0)))

/** Why we are closing a trade ourselves, so finalize can label it (trend: 'signal' the exit rule, 'trail' a raised stop already crossed). */
type ClosingReason = 'time' | 'tp' | 'error' | 'signal' | 'trail'

/** The exchange calls the trader needs — Futures implements it; tests fake it. */
export interface Exchange {
  base: string
  rules(symbol: string): Promise<SymbolRules>
  /** null when the balance cannot be read (no USDT row). */
  balanceUsdt(): Promise<number | null>
  position(symbol: string): Promise<Position>
  setup(symbol: string, leverage: number): Promise<void>
  marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, reduceOnly?: boolean, clientId?: string): Promise<{ orderId: number; avgPrice: string; executedQty: string }>
  bracketLeg(symbol: string, side: 'BUY' | 'SELL', type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET', triggerPrice: string, clientAlgoId: string): Promise<{ algoId: number }>
  takeProfitLimit(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientId: string): Promise<{ orderId: number; status: string }>
  cancelAllOrders(symbol: string): Promise<void>
  cancelAllAlgo(symbol: string): Promise<void>
  /** Cancel one exchange-side stop / target by id (the trend trail replaces its stop). */
  cancelAlgo(symbol: string, algoId: number): Promise<void>
  fills(symbol: string, startTime: number): Promise<Fill[]>
}

export interface TraderConfig {
  interval: string
  mode: 'gated' | 'explore' | 'hybrid'
  /**
   * Who places real orders: 'ml' (default) the model, as set by `mode`;
   * 'trend' strategy F1 (strategy.ts), with the model shadow trading only.
   */
  strategy?: 'ml' | 'trend'
  /**
   * Several strategies, in priority order, each with the state it starts in
   * (BOT_STRATEGIES). Overrides `strategy`; 'trend' alone means
   * f1:live,ml:shadow. Unset with strategy 'ml': the model alone, as before.
   */
  strategies?: StrategySlot[]
  risk: RiskConfig
  /** Hybrid mode: the only symbols that may place real orders (unset = all); the rest only shadow trade. */
  realSymbols?: string[]
  wf: WfConfig
  /** Bars of history for training + walk-forward. */
  historyBars: number
  retrainMs: number
  /** A bar is not traded when the decision comes this long after it closed. */
  maxLateMs: number
  /** Rules every setup must pass before an order is placed. */
  setup: SetupConfig
  learn: LearnConfig
  /** Account size for the small real-money sizing preview on each plan (USDT). */
  previewEquity?: number
  /**
   * A market with an open trade that is no longer in BOT_SYMBOLS: the trade is
   * managed to its end under the rules it was opened with (bracket and time
   * exit, or the trend trail and exit rule), then the trader idles. No real or
   * shadow entries, no learning, no walk-forward. Its open risk still counts in
   * the heat cap (read from the database).
   */
  manageOnly?: boolean
  /** Injected for tests; defaults to Binance spot klines. */
  bars?: (symbol: string, interval: string, count: number) => Promise<Bar[]>
  /** Closed bars kept between ticks and shared by all traders (bot.ts); takes the place of `bars`. */
  barCache?: BarCache
  /** Injected for tests; defaults to the Binance spot ticker (public, unsigned). Prices non-USDT fees. */
  price?: (symbol: string) => Promise<number>
}

export interface LearnConfig {
  /** Train a challenger this often... */
  everyMs: number
  /** ...or after this many real + shadow trades on the symbol have closed. */
  everyTrades: number
  /** The most recent stretch held out to compare challenger and champion. */
  holdoutMs: number
  /** Fewest held-out outcomes a comparison needs. */
  minHoldout: number
  /** Record and resolve shadow trades. */
  shadow: boolean
  /**
   * Shadow trades open at once per symbol (1 = like a real position). Decisions
   * are made once per bar, so horizon + 1 is enough to shadow every signal.
   * Overlapping shadows have correlated outcomes, like the overlapping bar
   * labels the model trains on; learning.ts needs no change for that (each is
   * purged / held out on its own, both models are scored on the same rows), but
   * the calibration's n then counts more trades than independent bets.
   */
  shadowMaxOpen: number
}

export const DEFAULT_LEARN: LearnConfig = {
  everyMs: 60 * 60_000,
  everyTrades: 20,
  holdoutMs: 24 * 3_600_000,
  minHoldout: 20,
  shadow: true,
  shadowMaxOpen: 1,
}

export const DEFAULT_TRADER: TraderConfig = {
  interval: '4h',
  mode: 'gated',
  // The heat caps apply in hybrid mode only.
  risk: { riskPerTrade: 0.005, maxNotionalX: 2, leverage: 3, minMarginUsd: 100, maxDailyLoss: 0.03, maxDrawdown: 0.15, maxSideRisk: 0.015, maxTotalRisk: 0.02 },
  wf: DEFAULT_WF,
  historyBars: 4380, // ~2 years of 4h bars
  retrainMs: 24 * 3_600_000,
  // Scheduled runs (GitHub Actions) can start well after a bar closes.
  maxLateMs: 3 * 60 * 60_000,
  setup: DEFAULT_SETUP,
  learn: DEFAULT_LEARN,
}

/** The walk-forward verdict for a symbol (bot_state 'wf:SYMBOL:INTERVAL'). */
export interface GateState {
  t: number
  pass: boolean
  reasons: string[]
  metrics: Metrics
}

/**
 * Walk-forward runs are the heavy job (tens of seconds each); traders share the
 * tick loop, so at most one starts per minute and the others wait their turn.
 */
export const heavyJobs = { at: 0, spacingMs: 60_000 }

const pct = (p: number) => (p * 100).toFixed(1) + '%'

/**
 * Settings that depend on the candle size (BOT_INTERVAL). 5-minute bars: about
 * a month of history, retrain every 6 h, act within 2 min of a close (the bot
 * ticks every 15 s), and a smaller notional cap — on 5m bars the stop is so
 * tight that risk sizing alone would reach the cap on every trade, and fees
 * (~0.14% round trip) are charged on the notional.
 */
export const INTERVAL_DEFAULTS: Record<string, Partial<TraderConfig>> = {
  '5m': { historyBars: 8_640, retrainMs: 6 * 3_600_000, maxLateMs: 2 * 60_000 },
  '15m': { historyBars: 8_640, retrainMs: 12 * 3_600_000, maxLateMs: 5 * 60_000 },
  '1h': { historyBars: 8_760, retrainMs: 24 * 3_600_000, maxLateMs: 20 * 60_000 },
  '4h': {},
}
export const INTERVAL_MAX_NOTIONAL_X: Record<string, number> = { '5m': 1, '15m': 1 }

const vwap = (f: Fill[]) => {
  const q = f.reduce((a, x) => a + x.qty, 0)
  return q ? f.reduce((a, x) => a + x.price * x.qty, 0) / q : 0
}

export class SymbolTrader {
  readonly symbol: string
  model: ModelRow | null = null
  private ex: Exchange
  private store: BotStore
  private cfg: TraderConfig
  private rules!: SymbolRules
  private lastBar = 0
  /** Why a trade is being closed by us (time exit), so reconcile can label it. */
  private closing = new Map<number, ClosingReason>()
  private finalizeTries = new Map<number, number>()
  /** Latest walk-forward verdict. */
  gate: GateState | null = null
  /** When the last challenger was trained. */
  private learnAt = 0
  /** Real + shadow trades learned from since that challenger. */
  private closedSinceCycle = 0
  /** Last bar the shadow trades were checked on. */
  private shadowBar = 0
  /** Lowest and highest mark price seen per open trade (journal MAE / MFE between closed bars). */
  private marks = new Map<number, { lo: number; hi: number }>()
  /** The strategies, in priority order (null: the model alone, the single-strategy path). */
  private slots: StrategySlot[] | null

  constructor(ex: Exchange, store: BotStore, symbol: string, cfg: TraderConfig) {
    this.ex = ex
    this.store = store
    this.symbol = symbol
    this.cfg = cfg
    this.slots = cfg.strategies?.length ? cfg.strategies : parseStrategies(undefined, cfg.strategy)
    // The model's pipeline (training, walk-forward, challengers) is heavy: only on its own markets.
    this.mlOn = !cfg.manageOnly && (!this.slots || this.slots.some((s) => s.id === 'ml' && slotRuns(s, symbol)))
  }

  /** Does the model run on this market (BOT_STRATEGIES ml@...)? Otherwise no model, no walk-forward, no learning here. */
  readonly mlOn: boolean

  private get barsFn(): (symbol: string, interval: string, count: number) => Promise<Bar[]> {
    const c = this.cfg.barCache
    return c ? (s, i, n) => c.get(s, i, n) : (this.cfg.bars ?? closedBars)
  }

  async init(): Promise<void> {
    this.rules = await this.ex.rules(this.symbol)
    if (this.cfg.manageOnly) {
      // Only an open trade to see through: no margin setup, no model, no walk-forward.
      this.lastBar = await this.store.getState<number>('lastBar:' + this.symbol, 0)
      return
    }
    await this.ex.setup(this.symbol, this.cfg.risk.leverage)
    if (!this.mlOn) {
      this.lastBar = await this.store.getState<number>('lastBar:' + this.symbol, 0)
      return
    }
    this.model = await this.champion()
    this.gate = await this.store.getState<GateState | null>(this.gateKey, null)
    let bars: Bar[] | undefined
    if (!this.gate || Date.now() - this.gate.t > this.cfg.retrainMs) bars = await this.walkForwardGate()
    const ls = await this.store.getState<{ t: number; n?: number }>('learn:' + this.symbol, { t: 0 })
    this.learnAt = Math.max(ls.t || 0, this.model?.createdAt ?? 0)
    this.closedSinceCycle = ls.n || 0
    if (!this.model) await this.learnCycle('initial training', bars)
    // Kept in the database, so a bot that runs as short scheduled jobs (BOT_ONCE)
    // decides each bar once, like the long-running one.
    this.lastBar = await this.store.getState<number>('lastBar:' + this.symbol, 0)
  }

  private get gateKey(): string {
    return `wf:${this.symbol}:${this.cfg.interval}`
  }

  /** The stored champion, if it was made for the bracket and costs in use now. */
  private async champion(): Promise<ModelRow | null> {
    const m = await this.store.latestModel(this.symbol, this.cfg.interval)
    if (!m) return null
    // Field by field: jsonb does not keep key order.
    const same = (a: object | undefined, b: object) => !!a && Object.entries(b).every(([k, v]) => (a as Record<string, unknown>)[k] === v)
    return same(m.model.cfg?.bracket, this.cfg.wf.bracket) && same(m.model.cfg?.costs, this.cfg.wf.costs) ? m : null
  }

  /** The training window, shrunk for young markets (gold perpetual: listed Dec 2025) so walk-forward still has test folds. */
  private wfCfg(n: number): WfConfig {
    return { ...this.cfg.wf, trainBars: Math.min(this.cfg.wf.trainBars, Math.floor(n * 0.6)) }
  }

  /** Walk-forward the whole history: the out-of-sample verdict gated mode trades on. */
  async walkForwardGate(): Promise<Bar[]> {
    const t0 = Date.now()
    const b = await this.barsFn(this.symbol, this.cfg.interval, this.cfg.historyBars)
    const wf = walkForward(b, this.wfCfg(b.length))
    const g = gate(wf.metrics, DEFAULT_GATE)
    this.gate = { t: Date.now(), pass: g.pass, reasons: g.reasons, metrics: wf.metrics }
    await this.store.setState(this.gateKey, this.gate)
    const x = wf.metrics
    await this.store.event(
      g.pass ? 'info' : 'warn',
      this.symbol,
      `walk-forward in ${Math.round((Date.now() - t0) / 1000)}s — out-of-sample: ${x.trades} trades, ` +
        `win ${(x.winRate * 100).toFixed(1)}%, ${x.expectancyR.toFixed(3)}R/trade, PF ${x.profitFactor.toFixed(2)}, ` +
        `max DD ${x.maxDrawdownR.toFixed(1)}R — gate ${g.pass ? 'PASS' : 'FAIL: ' + g.reasons.join('; ')}`,
    )
    return b
  }

  /**
   * Train a challenger on bars plus stored trade outcomes, score it and the
   * champion on the held-out recent slice, and promote it only if it wins.
   */
  async learnCycle(trigger: string, bars?: Bar[]): Promise<void> {
    const t0 = Date.now()
    this.learnAt = t0
    this.closedSinceCycle = 0
    await this.store.setState('learn:' + this.symbol, { t: t0, n: 0 })
    const b = bars ?? (await this.barsFn(this.symbol, this.cfg.interval, this.cfg.historyBars))
    const ind = indicators(b)
    const wfCfg = this.wfCfg(b.length)
    const step = INTERVAL_MS[this.cfg.interval]
    const exp = await this.store.experience(this.symbol, this.cfg.wf.bracket)
    const holdoutBars = Math.max(48, Math.round(this.cfg.learn.holdoutMs / step))
    const split = splitForChallenger(b, ind, exp, wfCfg, holdoutBars, step)
    const m = fitModel(b, ind, split.trainFrom, split.trainTo, wfCfg, t0 % 100_000, split.extra)
    if (!m) {
      await this.store.event('error', this.symbol, `retrain failed: not enough history (${b.length} bars)`)
      return
    }
    const champ = this.model
    // Compare on what neither model has seen if there is enough of it; otherwise
    // on the whole slice (which can favour the champion — a conservative bias).
    const fair = champ ? split.holdout.filter((r) => r.knownAt > champ.createdAt) : split.holdout
    const outcomes = (rows: typeof fair) => rows.reduce((a, r) => a + r.outcomes.length, 0)
    const rows = outcomes(fair) >= this.cfg.learn.minHoldout ? fair : split.holdout
    const minEv = Math.max(this.cfg.setup.minEvR, this.cfg.wf.minEvR)
    const sChall = scoreModel(m, rows, minEv)
    const sChamp = champ ? scoreModel(champ.model, rows, minEv) : null
    const sel = selectChampion(sChamp, sChall, { minHoldout: this.cfg.learn.minHoldout, minLogLossGain: 0.001 })
    const holdout = {
      trigger,
      rows: rows.length,
      fair: rows === fair,
      challenger: sChall,
      champion: sChamp,
      championId: champ?.id ?? null,
      promoted: sel.promote,
      reason: sel.reason,
      trainedOn: { bars: split.trainTo - split.trainFrom, trades: split.extra.length },
    }
    const saved = await this.store.saveModel(
      this.symbol,
      this.cfg.interval,
      m,
      this.gate?.metrics ?? { holdout: sChall },
      this.gate?.pass ?? false,
      this.gate?.reasons ?? ['no walk-forward yet'],
      { role: 'challenger', holdout },
    )
    if (sel.promote) {
      await this.store.promote(this.symbol, this.cfg.interval, saved.id)
      this.model = await this.champion()
    }
    await this.store.event(
      'info',
      this.symbol,
      `model v${saved.version} (#${saved.id}, ${trigger}) ${sel.promote ? 'is the new champion' : 'stays challenger'} — ${sel.reason} · ` +
        `held-out ${sChall.n} outcomes · trained on ${split.trainTo - split.trainFrom} bars + ${split.extra.length} trades in ${Math.round((Date.now() - t0) / 1000)}s`,
    )
  }

  /** Learn from every newly closed real or shadow trade: one calibration step each. */
  async learnFromClosed(): Promise<number> {
    const rows = await this.store.unlearned(this.symbol)
    if (!rows.length) return 0
    const cal = new Map<string, { side: 1 | -1; regime: string; c: Calib }>()
    for (const u of rows) {
      const f = typeof u.features === 'string' ? JSON.parse(u.features) : (u.features ?? {})
      const regime = u.regime || regimeOf(f as Record<string, number>)
      const key = u.side + '|' + regime
      const prev = cal.get(key)?.c ?? (await this.store.calibration(this.symbol, u.side, regime))
      cal.set(key, { side: u.side, regime, c: updateCalibration(prev, u.pRaw, winLabel(u.exit, u.rGross)) })
    }
    for (const v of cal.values()) await this.store.saveCalibration(this.symbol, v.side, v.regime, v.c)
    await this.store.markLearned('real', rows.filter((r) => r.kind === 'real').map((r) => r.id))
    await this.store.markLearned('shadow', rows.filter((r) => r.kind === 'shadow').map((r) => r.id))
    return rows.length
  }

  /** Walk-forward refresh, calibration from closed trades, and the challenger schedule. */
  private async learnTick(now: number): Promise<void> {
    if ((!this.gate || now - this.gate.t > this.cfg.retrainMs) && Date.now() - heavyJobs.at >= heavyJobs.spacingMs) {
      heavyJobs.at = Date.now()
      await this.walkForwardGate()
    }
    const learned = await this.learnFromClosed()
    if (learned) {
      this.closedSinceCycle += learned
      await this.store.setState('learn:' + this.symbol, { t: this.learnAt, n: this.closedSinceCycle })
    }
    const age = now - this.learnAt
    let trigger = ''
    if (age >= this.cfg.learn.everyMs) trigger = 'hourly'
    else if (!this.model && age >= 10 * 60_000) trigger = 'no usable model'
    else if (this.closedSinceCycle >= this.cfg.learn.everyTrades) trigger = `${this.closedSinceCycle} new closed trades`
    if (trigger) await this.learnCycle(trigger)
  }

  /** Resolve open shadow trades once per new closed bar. */
  private async shadowTick(now: number, b?: Bar[]): Promise<void> {
    const step = INTERVAL_MS[this.cfg.interval]
    const lastClosed = b ? (b[b.length - 1]?.t ?? 0) : Math.floor(now / step) * step - step
    if (!lastClosed || lastClosed <= this.shadowBar) return
    const open = await this.store.openShadows(this.symbol)
    if (!open.length) {
      this.shadowBar = lastClosed
      return
    }
    // A rule strategy's shadow is replayed from its signal bar, with that strategy's indicators: the long history.
    const rule = open.some((s) => s.strategy !== 'ml')
    const bars = b && (!rule || b.length >= RULE_BARS) ? b : await this.barsFn(this.symbol, this.cfg.interval, rule ? RULE_BARS : WARMUP + 80)
    this.shadowBar = bars[bars.length - 1]?.t ?? lastClosed
    for (const s of open) {
      if (s.strategy !== 'ml') {
        await this.resolveRuleShadowRow(s, bars, step)
        continue
      }
      const res = resolveShadow({ ...s, tp: s.tp ?? NaN, horizon: s.horizon ?? 0 }, bars, step, this.cfg.wf.costs)
      if (!res) continue
      if (res.status === 'expired') {
        await this.store.closeShadow(s.id, { status: 'expired' })
        await this.store.event('warn', this.symbol, `shadow #${s.id} expired: ${res.reason}`)
        continue
      }
      await this.store.closeShadow(s.id, {
        status: 'closed',
        closedAt: res.closedAt,
        exit: res.exitPrice,
        reason: res.exit,
        rGross: res.rGross,
        rNet: res.rNet,
        maeR: res.maeR,
        mfeR: res.mfeR,
        barsHeld: res.bars,
      })
      await this.store.event('info', this.symbol, `shadow #${s.id} closed by ${res.exit}: ${res.rNet >= 0 ? '+' : ''}${res.rNet.toFixed(2)}R after costs`)
    }
  }

  /** A rule strategy's shadow trade, resolved with that strategy's own exit logic. */
  private async resolveRuleShadowRow(s: { id: number; strategy: string; side: 1 | -1; entry: number; sl: number; barTime: number }, bars: Bar[], step: number): Promise<void> {
    const st = ruleStrategy(s.strategy)
    const res = st ? resolveRuleShadow(st, s, bars, step, this.cfg.wf.costs) : { status: 'expired' as const, reason: `unknown strategy ${s.strategy}` }
    if (!res) return
    if (res.status === 'expired') {
      await this.store.closeShadow(s.id, { status: 'expired' })
      await this.store.event('warn', this.symbol, `${s.strategy} shadow #${s.id} expired: ${res.reason}`)
      return
    }
    await this.store.closeShadow(s.id, {
      status: 'closed',
      closedAt: res.closedAt,
      exit: res.exitPrice,
      reason: res.exit,
      rGross: res.rGross,
      rNet: res.rNet,
      maeR: res.maeR,
      mfeR: res.mfeR,
      barsHeld: res.bars,
    })
    await this.store.event('info', this.symbol, `${s.strategy} shadow #${s.id} closed by ${res.exit}: ${res.rNet >= 0 ? '+' : ''}${res.rNet.toFixed(2)}R after costs`)
  }

  /** Why a trade is being closed, remembered across runs. */
  private async markClosing(id: number, reason: ClosingReason): Promise<void> {
    this.closing.set(id, reason)
    await this.store.setState('closing:' + id, reason)
  }

  async tick(canEnter: boolean, now = Date.now()): Promise<void> {
    if (this.cfg.manageOnly || !this.mlOn) return this.trade(canEnter, now)
    try {
      await this.trade(canEnter, now)
    } finally {
      // Learning runs after the trading work, so it never delays an exit, and
      // a learning failure never stops the trading.
      await this.learnTick(now).catch((e) => this.store.event('error', this.symbol, 'learning failed: ' + (e as Error).message))
    }
  }

  private async trade(canEnter: boolean, now: number): Promise<void> {
    const manageOnly = this.cfg.manageOnly === true
    // A rule strategy's trade is managed by its rules (trail, exit rule) even on a manage-only market.
    if (this.slots || manageOnly) {
      const open = manageOnly ? await this.store.openTrade(this.symbol) : null
      if (!manageOnly || open?.mode === 'trend') return this.tradeMulti(canEnter, now)
      if (open) await this.manage(open, await this.ex.position(this.symbol), now)
      // Flat: idle. Nothing new opens on a market outside BOT_SYMBOLS.
      return
    }
    const open = await this.store.openTrade(this.symbol)
    const pos = await this.ex.position(this.symbol)
    if (open) {
      await this.manage(open, pos, now)
      await this.shadowTick(now)
      return
    }
    // The self-test (src/selftest.ts) is holding a test trade on this market:
    // that position is not ours to flatten, and nothing new opens beside it.
    if ((await this.store.getState<number>('selftest:' + this.symbol, 0)) > now) return
    if (pos.amt !== 0) {
      // Not ours (or a record was lost): flatten rather than leave unmanaged risk.
      await this.store.event('error', this.symbol, `unrecorded position ${pos.amt} — closing it`)
      await this.flatten(pos)
      return
    }
    await this.maybeEnter(canEnter, now)
  }

  private async flatten(pos: Position): Promise<void> {
    if (pos.amt !== 0) {
      const qty = roundStep(Math.abs(pos.amt), this.rules.stepSize, this.rules.quantityPrecision)
      await this.ex.marketOrder(this.symbol, pos.amt > 0 ? 'SELL' : 'BUY', qty, true, `rb-flat-${Date.now()}`)
    }
    await this.ex.cancelAllOrders(this.symbol)
    await this.ex.cancelAllAlgo(this.symbol)
  }

  private async manage(open: OpenTrade, pos: Position, now: number): Promise<void> {
    if (pos.amt === 0) return this.finalize(open, now)
    this.noteMark(open, pos)
    const H = this.cfg.wf.bracket.horizon
    const deadline = open.barTime + (H + 1) * INTERVAL_MS[this.cfg.interval]
    // A close we started earlier (failed stop, target already crossed, time
    // exit) that did not go through — e.g. the reduce-only order timed out —
    // is retried every tick until the position is really gone; otherwise a
    // position without a stop could sit unmanaged until the time exit.
    await this.restoreClosing(open.id)
    if (now >= deadline && !this.closing.has(open.id)) {
      await this.markClosing(open.id, 'time')
      await this.store.event('info', this.symbol, `time exit after ${H} bars`)
    }
    if (this.closing.has(open.id)) await this.flatten(pos)
  }

  /**
   * Commissions in USDT. Fees paid in another asset (BNB fee discount) are
   * converted at <ASSET>USDT from public market data; if that price cannot be
   * read, those fees are left out and a warning is logged.
   */
  private async feesUsdt(tradeId: number, fills: Fill[]): Promise<number> {
    const byAsset = new Map<string, number>()
    for (const f of fills) if (f.commission) byAsset.set(f.commissionAsset, (byAsset.get(f.commissionAsset) || 0) + f.commission)
    let total = 0
    for (const [asset, amount] of byAsset) {
      if (asset === 'USDT') {
        total += amount
        continue
      }
      try {
        const p = await (this.cfg.price ?? lastPrice)(asset + 'USDT')
        if (!(p > 0)) throw new Error('bad price ' + p)
        total += amount * p
      } catch (e) {
        await this.store.event('warn', this.symbol, `trade #${tradeId}: ${amount} ${asset} in fees left out — no ${asset}USDT price (${(e as Error).message})`)
      }
    }
    return total
  }

  private async finalize(open: OpenTrade, now: number): Promise<void> {
    const entrySide = open.side > 0 ? 'BUY' : 'SELL'
    const fills = await this.ex.fills(this.symbol, open.openedAt - 5000)
    const exits = fills.filter((f) => f.side !== entrySide && f.time >= open.openedAt)
    if (!exits.length) {
      // Fills can lag the position by a moment; give it a few ticks.
      const n = (this.finalizeTries.get(open.id) || 0) + 1
      this.finalizeTries.set(open.id, n)
      if (n < 5) return
      await this.store.closeTrade(open.id, { closedAt: now, exit: 0, reason: 'error', pnlUsd: 0, feesUsd: 0, r: 0, status: 'error', notes: 'position gone but no exit fills found' })
      await this.store.event('error', this.symbol, `trade #${open.id}: position closed with no exit fills`)
      return
    }
    // This trade's entry fills only: by the stored entry order id; on older rows
    // without one, same-side fills from when the entry order was sent onwards —
    // never earlier, where a previous trade's closing fill can sit.
    const entries = fills.filter(
      (f) =>
        f.side === entrySide &&
        (open.entryOrderId != null ? f.orderId === open.entryOrderId : f.time >= open.openedAt && f.time <= exits[exits.length - 1].time),
    )
    const fees = await this.feesUsdt(open.id, [...entries, ...exits])
    const gross = exits.reduce((a, f) => a + f.realizedPnl, 0)
    const pnl = gross - fees
    const stored = await this.store.getState<ClosingReason | null>('closing:' + open.id, null)
    // A trend trade hit by the exchange stop: 'trail' once that stop was raised, else 'sl'.
    const byExchange =
      open.mode === 'trend'
        ? open.initialSl != null && open.sl !== open.initialSl
          ? 'trail'
          : 'sl'
        : open.tpOrderId != null && exits.some((f) => f.orderId === open.tpOrderId)
          ? 'tp'
          : 'sl'
    const reason = this.closing.get(open.id) ?? stored ?? byExchange
    await this.ex.cancelAllOrders(this.symbol)
    await this.ex.cancelAllAlgo(this.symbol)
    const r = open.riskUsd > 0 ? pnl / open.riskUsd : 0
    const closedAt = exits[exits.length - 1].time
    const exit = vwap(exits)
    await this.store.closeTrade(open.id, { closedAt, exit, reason, pnlUsd: pnl, feesUsd: fees, r, ...(await this.journalAtClose(open, closedAt, exit)) })
    this.closing.delete(open.id)
    this.finalizeTries.delete(open.id)
    this.marks.delete(open.id)
    await this.store.event('info', this.symbol, `trade #${open.id} closed by ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${r.toFixed(2)}R)`)
  }

  /**
   * Journal figures for a closed real trade: MAE / MFE from the closed bars it
   * was open in, the mark prices seen while managing it and the exit fill, and
   * the candles it was open in. Never allowed to stop a close.
   */
  private async journalAtClose(open: OpenTrade, closedAt: number, exit: number): Promise<{ maeR: number | null; mfeR: number | null; barsHeld: number }> {
    const step = INTERVAL_MS[this.cfg.interval]
    const held = barsHeld(open.barTime + step, closedAt, step)
    const m = this.marks.get(open.id)
    let bars: Bar[] = []
    try {
      bars = barsBetween(await this.barsFn(this.symbol, this.cfg.interval, Math.min(this.cfg.historyBars, held + 3)), open.openedAt, closedAt, step)
    } catch (e) {
      await this.store.event('warn', this.symbol, `trade #${open.id}: journal bars unavailable (${(e as Error).message}); MAE/MFE from prices seen only`)
    }
    // In R of the initial stop; a trade without a target is not capped above.
    const ref = { side: open.side, entry: open.entry, sl: open.initialSl ?? open.sl, tp: open.tp ?? open.side * Infinity }
    const ex = excursion(ref, bars, [...(m ? [m.lo, m.hi] : []), exit])
    return { maeR: ex?.maeR ?? null, mfeR: ex?.mfeR ?? null, barsHeld: held }
  }

  private async maybeEnter(canEnter: boolean, now: number): Promise<void> {
    const b = await this.barsFn(this.symbol, this.cfg.interval, WARMUP + 80)
    await this.shadowTick(now, b)
    const last = b[b.length - 1]
    if (!last || last.t === this.lastBar) return
    this.lastBar = last.t
    await this.store.setState('lastBar:' + this.symbol, last.t)
    // A decision reached long after its bar closed (a scheduled run that started
    // late, or a restart) would enter at a price the model never saw.
    const late = now - (last.t + INTERVAL_MS[this.cfg.interval])
    if (late > this.cfg.maxLateMs) {
      await this.store.event('info', this.symbol, `skipped the ${new Date(last.t + INTERVAL_MS[this.cfg.interval]).toISOString().slice(11, 16)} UTC bar: ${Math.round(late / 60_000)} min since it closed`)
      return
    }
    await this.mlDecide(canEnter, now, b, null)
  }

  /**
   * The model's decision on the latest closed bar of `b`; true when it opened a
   * real trade. shadowOnly (why the model may not trade for real now: it is in
   * shadow, or another strategy holds the market): the idea is only ever a
   * shadow trade — the account-level rules (risk limits, open positions, daily
   * cap, cooldown) are left out, as they are about real orders, and no plan is
   * written (the plan is the real strategy's).
   */
  private async mlDecide(canEnter: boolean, now: number, b: Bar[], shadowOnly: string | null, scale = 1): Promise<boolean> {
    const risk = scale === 1 ? this.cfg.risk : { ...this.cfg.risk, riskPerTrade: this.cfg.risk.riskPerTrade * scale }
    const last = b[b.length - 1]
    if (!this.model || !last) return false
    const ind = indicators(b)
    const i = b.length - 1
    const d = decide(this.model.model, b, ind, i)
    if (!d) return false
    // The exact inputs behind this decision, kept with the trade.
    const fv = featureAt(b, ind, i) || []
    const x = Object.fromEntries(FEATURES.map((name, j) => [name, fv[j]]))
    const regime = regimeOf(x)
    const k = this.cfg.wf.bracket
    const atr = ind.atr[i]
    const slDist = k.slAtr * atr
    const tpDist = k.tpAtr * atr
    // Calibrated win probabilities, and the expected value after costs they imply.
    const mm = this.model.model
    const winCost = costR(last.c, slDist, this.cfg.wf.costs, 'tp')
    const lossCost = costR(last.c, slDist, this.cfg.wf.costs, 'sl')
    const pL = calibrate(d.pLong, await this.store.calibration(this.symbol, 1, regime))
    const pS = calibrate(d.pShort, await this.store.calibration(this.symbol, -1, regime))
    const evL = pL * (mm.long.winR - winCost) - (1 - pL) * (mm.long.lossR + lossCost)
    const evS = pS * (mm.short.winR - winCost) - (1 - pS) * (mm.short.lossR + lossCost)
    const side: 1 | -1 = evL >= evS ? 1 : -1
    const buy = side > 0
    const pRaw = buy ? d.pLong : d.pShort
    const pCal = buy ? pL : pS
    const ev = buy ? evL : evS
    const counts = shadowOnly
      ? { openPositions: 0, tradesToday: 0, lastStopAt: null }
      : await this.store.setupCounts(this.symbol, now - (now % 86_400_000))
    const chk = checkSetup(
      {
        entry: last.c,
        slDist,
        tpDist,
        costs: this.cfg.wf.costs,
        evR: ev,
        evFloor: this.cfg.wf.minEvR,
        gated: this.cfg.mode !== 'explore',
        gatePass: this.gate?.pass ?? this.model.gatePass,
        gateReason: this.gate?.reasons[0] ?? this.model.gateReasons[0],
        modelId: this.model.id,
        canEnter: canEnter || shadowOnly != null,
        ...counts,
        now,
      },
      this.cfg.setup,
    )
    const hybrid = this.cfg.mode === 'hybrid'
    // Not cleared for real money: like the gate, a model-side "no" — it is shadowed.
    if (hybrid && this.cfg.realSymbols && !this.cfg.realSymbols.includes(this.symbol)) {
      chk.model.push('not in the real-trade list (BOT_REAL_SYMBOLS)')
      chk.ok = false
    }
    const summary =
      `P(long) ${pct(pL)} EV ${evL.toFixed(3)}R · P(short) ${pct(pS)} EV ${evS.toFixed(3)}R` +
      ` (raw ${pct(d.pLong)}/${pct(d.pShort)}, ${regime}) · R:R ${chk.rr.toFixed(2)} · cost ${chk.costR.toFixed(3)}R`
    const equityNow = shadowOnly ? null : await this.ex.balanceUsdt().catch(() => null)
    const preview = (eq: number) => sizePreview(eq, last.c, slDist, this.rules, risk, this.cfg.wf.costs)
    const plan: TradePlan = {
      symbol: this.symbol,
      t: now,
      barClose: last.t + INTERVAL_MS[this.cfg.interval],
      interval: this.cfg.interval,
      side: buy ? 'LONG' : 'SHORT',
      entry: last.c,
      sl: last.c - side * slDist,
      tp: last.c + side * tpDist,
      pWin: pCal,
      pLong: pL,
      pShort: pS,
      evR: ev,
      rr: chk.rr,
      costR: chk.costR,
      status: 'skipped',
      reasons: [...chk.hard, ...chk.model],
      live: equityNow != null ? preview(equityNow) : undefined,
      small: preview(this.cfg.previewEquity ?? 100),
    }
    // Shown on the website; never allowed to stop a decision.
    const savePlan = () => this.store.setState('plan:' + this.symbol, plan).catch((e) => console.error('plan', (e as Error).message))
    // Record the idea as a shadow trade (if shadowing is on and there is room); returns the note for the event.
    const shadow = async (reasons: string[]): Promise<string> => {
      if (!this.cfg.learn.shadow || (await this.store.openShadows(this.symbol, 'ml')).length >= this.cfg.learn.shadowMaxOpen) return ''
      const sid = await this.store.insertShadow({
        symbol: this.symbol,
        modelId: this.model!.id,
        side,
        barTime: last.t,
        entry: last.c,
        sl: last.c - side * slDist,
        tp: last.c + side * tpDist,
        atr,
        horizon: k.horizon,
        pRaw,
        pCal,
        evR: ev,
        costR: chk.costR,
        rrNet: chk.rr,
        regime,
        rejectReason: reasons.join('; '),
        features: x,
        journal: { interval: this.cfg.interval, modelVersion: this.model!.version, decision: summary },
        strategy: 'ml',
      })
      plan.status = 'paper'
      plan.shadowId = sid
      return ` · shadow #${sid} ${buy ? 'LONG' : 'SHORT'}`
    }
    if (shadowOnly != null) {
      // Real orders come from another strategy (or none); the model only paper-trades.
      chk.model.push(shadowOnly)
      const note = shadowWorthy({ ...chk, ok: false }) ? await shadow(chk.model) : ''
      await this.store.event('info', this.symbol, `model (shadow only): ${summary}${chk.hard.length ? ' — not shadowed: ' + chk.hard.join('; ') : ''}${note}`)
      return false
    }
    if (!chk.ok) {
      const note = shadowWorthy(chk) ? await shadow(chk.model) : ''
      await savePlan()
      await this.store.event('info', this.symbol, `${summary} — no trade: ${[...chk.hard, ...chk.model].join('; ')}${note}`)
      return false
    }
    const equity = equityNow ?? (await this.ex.balanceUsdt())
    if (equity == null) {
      plan.reasons = ['USDT balance unavailable']
      await savePlan()
      await this.store.event('warn', this.symbol, `${summary} — no trade: USDT balance unavailable`)
      return false
    }
    const sz = size(equity, last.c, slDist, this.rules, risk)
    if (Number(sz.qty) <= 0) {
      plan.reasons = [sz.reason || 'size is zero']
      await savePlan()
      await this.store.event('warn', this.symbol, `${summary} — no trade: ${sz.reason}`)
      return false
    }
    // Portfolio heat (hybrid): open risk across all symbols, read from the
    // database. bot.ts runs the traders one after another and each awaits its
    // trade row before the next decides, so trades opened earlier in the same
    // tick are counted.
    if (hybrid) {
      const hot = heatCheck(await this.store.openRisk(), side, sz.riskUsd, equity, this.cfg.risk)
      if (hot) {
        plan.reasons = [hot]
        const note = await shadow([hot])
        await savePlan()
        await this.store.event('info', this.symbol, `${summary} — no trade: ${hot}${note}`)
        return false
      }
    }
    const o = await this.ex.marketOrder(this.symbol, buy ? 'BUY' : 'SELL', sz.qty, false, `rb-in-${now}`)
    const fill = Number(o.avgPrice) || last.c
    const qty = Number(o.executedQty) || Number(sz.qty)
    const sl = Number(roundTick(fill - side * slDist, this.rules.tickSize, this.rules.pricePrecision))
    const tp = Number(roundTick(fill + side * tpDist, this.rules.tickSize, this.rules.pricePrecision))
    const id = await this.store.insertTrade({
      symbol: this.symbol,
      modelId: this.model.id,
      // A hybrid real trade passed its gate: recorded as gated (the schema and the site know two modes).
      mode: this.cfg.mode === 'explore' ? 'explore' : 'gated',
      venue: this.ex.base,
      side,
      openedAt: now,
      barTime: last.t,
      entry: fill,
      qty,
      sl,
      tp,
      atr,
      riskUsd: qty * Math.abs(fill - sl),
      pWin: pCal,
      evR: ev,
      features: x,
      entryOrderId: o.orderId,
      pRaw,
      regime,
      costR: chk.costR,
      rrNet: chk.rr,
      journal: {
        interval: this.cfg.interval,
        modelVersion: this.model.version,
        decision: summary,
        plannedEntry: last.c,
        plannedSl: last.c - side * slDist,
        plannedTp: last.c + side * tpDist,
        slippageBps: slippageBps(side, last.c, fill),
      },
      strategy: 'ml',
    })
    const exitSide = buy ? 'SELL' : 'BUY'
    let slAlgo: number | null = null
    try {
      slAlgo = (await this.ex.bracketLeg(this.symbol, exitSide, 'STOP_MARKET', String(sl), `rb-sl-${id}`)).algoId
    } catch (e) {
      // No stop, no position.
      await this.store.event('error', this.symbol, `trade #${id}: stop could not be placed (${(e as Error).message}) — closing`)
      Object.assign(plan, { status: 'skipped', reasons: ['stop could not be placed, position closed'], tradeId: id })
      await savePlan()
      await this.markClosing(id, 'error')
      await this.flatten(await this.ex.position(this.symbol))
      return true
    }
    let tpOrder: number | null = null
    try {
      const t = await this.ex.takeProfitLimit(this.symbol, exitSide, roundStep(qty, this.rules.stepSize, this.rules.quantityPrecision), String(tp), `rb-tp-${id}`)
      if (t.status === 'EXPIRED') {
        // Post-only refused: price is already through the target. Take it.
        await this.markClosing(id, 'tp')
        await this.flatten(await this.ex.position(this.symbol))
      } else tpOrder = t.orderId
    } catch (e) {
      if ((e as { code?: number }).code === -5022) {
        // USDⓈ-M futures reject (rather than expire) a post-only order that would
        // cross on arrival: price is already through the target. Take it.
        await this.markClosing(id, 'tp')
        await this.flatten(await this.ex.position(this.symbol))
      } else await this.store.event('warn', this.symbol, `trade #${id}: target not placed (${(e as Error).message}); the stop and time exit still apply`)
    }
    await this.store.setLegs(id, tpOrder, slAlgo)
    Object.assign(plan, { status: 'opened', reasons: [], tradeId: id, entry: fill, sl, tp })
    await savePlan()
    await this.store.event('info', this.symbol, `${summary} — opened #${id} ${buy ? 'LONG' : 'SHORT'} ${qty} @ ${fill} · SL ${sl} · TP ${tp} · risk $${(qty * Math.abs(fill - sl)).toFixed(2)}`)
    return true
  }

  // ---- several strategies (BOT_STRATEGIES; F1 = strategies.ts) ----

  /**
   * One tick with strategies: manage the market's one real position (a rule
   * strategy's trail and exit rule, or a model trade's bracket), then on a
   * newly closed bar let every strategy decide, in priority order.
   */
  private async tradeMulti(canEnter: boolean, now: number): Promise<void> {
    const open = await this.store.openTrade(this.symbol)
    const pos = await this.ex.position(this.symbol)
    let rule: OpenTrade | null = null
    if (open && open.mode !== 'trend') {
      // A model trade (live model, or from before a switch): managed to its end by its bracket.
      await this.manage(open, pos, now)
    } else if (open) {
      if (pos.amt === 0) return this.finalize(open, now)
      this.noteMark(open, pos)
      await this.restoreClosing(open.id)
      // A close we started (exit rule, stop above the price, failed stop) is retried every tick.
      if (this.closing.has(open.id)) return this.flatten(pos)
      rule = open
    } else {
      if (this.cfg.manageOnly) return
      if ((await this.store.getState<number>('selftest:' + this.symbol, 0)) > now) return
      if (pos.amt !== 0) {
        await this.store.event('error', this.symbol, `unrecorded position ${pos.amt} — closing it`)
        await this.flatten(pos)
        return
      }
    }
    const step = INTERVAL_MS[this.cfg.interval]
    // Until the next bar closes there is nothing to decide: skip the long history read.
    if (Math.floor(now / step) * step - step === this.lastBar) return this.shadowTick(now)
    const b = await this.barsFn(this.symbol, this.cfg.interval, RULE_BARS)
    await this.shadowTick(now, b)
    const last = b[b.length - 1]
    if (!last || last.t === this.lastBar) return
    this.lastBar = last.t
    await this.store.setState('lastBar:' + this.symbol, last.t)
    const late = now - (last.t + step) > this.cfg.maxLateMs
    // The exit rule and the trail protect the position: applied however late. A late entry is not taken.
    if (rule) await this.ruleBar(rule, pos, b, now)
    if (this.cfg.manageOnly) return
    if (late) {
      if (!open) await this.store.event('info', this.symbol, `skipped the ${new Date(last.t + step).toISOString().slice(11, 16)} UTC bar: ${Math.round((now - last.t - step) / 60_000)} min since it closed`)
      return
    }
    await this.decideAll(canEnter, now, b, open)
  }

  /** A strategy's state: health.ts's verdict (bot_state 'strategy:<id>'), or the configured one until there is one. */
  private async strategyState(slot: StrategySlot): Promise<StrategyState> {
    const rec = await this.store.getState<HealthRecord | null>('strategy:' + slot.id, null)
    return rec && rec.configured === slot.state ? rec.state : slot.state
  }

  /**
   * Every strategy on the latest closed bar of `b`, in priority order. The
   * market has one real position at most: an open one (whichever strategy), or
   * the first live strategy whose signal passes every rule. Every other signal
   * is that strategy's shadow trade.
   */
  private async decideAll(canEnter: boolean, now: number, b: Bar[], open: OpenTrade | null): Promise<void> {
    const i = b.length - 1
    let holder: string | null = open ? (open.strategy ?? (open.mode === 'trend' ? 'f1' : 'ml')) : null
    // The website shows one plan per market: the first live strategy's.
    let planned = false
    // Other markets' bars a strategy reads (C2: BTC), read once per bar; this market's are `b`.
    const refs: RefBars = {}
    const refBars = async (st: RuleStrategy): Promise<RefBars> => {
      for (const s of st.refs ?? []) {
        if (s in refs) continue
        refs[s] = s === this.symbol ? b : await this.barsFn(s, this.cfg.interval, RULE_BARS).catch(() => undefined)
      }
      return refs
    }
    for (const slot of this.slots ?? []) {
      const st = STRATEGIES[slot.id]
      if (!st || !slotRuns(slot, this.symbol)) continue
      const state = await this.strategyState(slot)
      const paper = !isLive(state)
        ? `strategy ${slot.id} is in ${state}: the ${st.kind === 'model' ? 'model trades' : 'strategy trades'} on paper only`
        : holder
          ? `one real position per market: ${holder === slot.id ? 'its own trade' : 'strategy ' + holder} holds ${this.symbol}`
          : null
      if (st.kind === 'model') {
        // The model decides on the bars it always has.
        if (this.mlOn && (await this.mlDecide(canEnter, now, b.slice(-(WARMUP + 80)), paper, riskScale(state)))) holder = 'ml'
        if (!paper) planned = true
        continue
      }
      if (st.interval !== this.cfg.interval || holder === slot.id) continue
      const ref = await refBars(st)
      const sg = st.signal(b, i, ref)
      if (paper) {
        if (sg) await this.ruleShadow(st, b, sg, [paper], ref)
        continue
      }
      const r = await this.ruleEntry(st, canEnter, now, b, sg, !planned, ref, riskScale(state))
      planned = true
      if (r === 'opened') holder = slot.id
      else if (sg && r.length) await this.ruleShadow(st, b, sg, r, ref)
    }
  }

  private noteMark(open: OpenTrade, pos: Position): void {
    if (!(pos.mark > 0)) return
    const m = this.marks.get(open.id)
    this.marks.set(open.id, m ? { lo: Math.min(m.lo, pos.mark), hi: Math.max(m.hi, pos.mark) } : { lo: pos.mark, hi: pos.mark })
  }

  private async restoreClosing(id: number): Promise<void> {
    if (this.closing.has(id)) return
    const stored = await this.store.getState<ClosingReason | null>('closing:' + id, null)
    if (stored) this.closing.set(id, stored)
  }

  private saveTrendPlan(plan: TradePlan): Promise<void> {
    return this.store.setState('plan:' + this.symbol, plan).catch((e) => console.error('plan', (e as Error).message))
  }

  /**
   * The closes since the trail last ran, oldest first (normally just the newest
   * one): the strategy's exit rule, else a tighter stop — placed before the old
   * one is cancelled, so the position is never without a stop.
   */
  private async ruleBar(open: OpenTrade, pos: Position, b: Bar[], now: number): Promise<void> {
    const st = ruleStrategy(open.strategy)
    if (!st) {
      await this.store.event('error', this.symbol, `trade #${open.id}: unknown strategy ${open.strategy} — only its exchange stop protects it`)
      return
    }
    const step = INTERVAL_MS[this.cfg.interval]
    const side = open.side
    const seen = Math.max(open.trailBar ?? open.barTime, open.barTime)
    const initial = open.initialSl ?? open.sl
    let p: ManagedPos = { side, entry: open.entry, stop: open.sl, initialStop: initial, best: open.trailHigh ?? (side > 0 ? -Infinity : Infinity) }
    let lastJ = -1
    let exitNote = ''
    let note = ''
    for (let j = 0; j < b.length; j++) {
      if (b[j].t <= seen) continue
      const r = st.manage(p, b, j)
      lastJ = j
      if (r.exit) {
        exitNote = r.note
        break
      }
      p = { ...p, stop: r.stop, best: r.best }
      note = r.note
    }
    const last = b[b.length - 1]
    const plan: TradePlan = {
      symbol: this.symbol,
      t: now,
      barClose: last.t + step,
      interval: this.cfg.interval,
      strategy: 'trend',
      strategyId: st.id,
      side: side > 0 ? 'LONG' : 'SHORT',
      entry: open.entry,
      sl: open.sl,
      tp: null,
      costR: open.entry !== initial ? costR(open.entry, Math.abs(open.entry - initial), this.cfg.wf.costs, 'sl') : 0,
      status: 'opened',
      reasons: [],
      tradeId: open.id,
    }
    const exitSide = side > 0 ? 'SELL' : 'BUY'
    if (exitNote) {
      await this.markClosing(open.id, 'signal')
      await this.store.event('info', this.symbol, `trade #${open.id}: ${st.id.toUpperCase()} exit rule at the ${new Date(b[lastJ].t + step).toISOString().slice(11, 16)} UTC close (${exitNote}) — closing`)
      await this.saveTrendPlan({ ...plan, reasons: ['exit rule: ' + exitNote] })
      await this.flatten(pos)
      return
    }
    if (lastJ < 0) return
    const next = Number(roundTick(p.stop, this.rules.tickSize, this.rules.pricePrecision))
    let sl = open.sl
    let algo = open.slAlgoId
    if (side * (next - open.sl) > 0) {
      const px = pos.mark > 0 ? pos.mark : last.c
      if (side > 0 ? next >= px : next <= px) {
        // The tighter stop is already through the price: the exchange would refuse
        // it (it would trigger at once). The research engine fills such a stop at
        // the next open — close now.
        await this.markClosing(open.id, 'trail')
        await this.store.event('info', this.symbol, `trade #${open.id}: trailed stop ${next} is through the price ${px} — closing`)
        await this.saveTrendPlan({ ...plan, sl: next, reasons: ['trailed stop crossed'] })
        await this.flatten(pos)
        return
      }
      try {
        algo = (await this.ex.bracketLeg(this.symbol, exitSide, 'STOP_MARKET', String(next), `rb-sl-${open.id}-${Math.round(b[lastJ].t / 1000)}`)).algoId
        sl = next
      } catch (e) {
        // Keep the stop that is in place; not marked as seen, so the next bar retries these closes.
        await this.store.event('warn', this.symbol, `trade #${open.id}: raised stop ${next} could not be placed (${(e as Error).message}) — the stop at ${open.sl} stays`)
        await this.saveTrendPlan(plan)
        return
      }
    }
    await this.store.setTrail(open.id, { sl, slAlgoId: algo, high: p.best, bar: b[lastJ].t })
    if (sl !== open.sl) {
      if (open.slAlgoId != null && open.slAlgoId !== algo)
        await this.ex
          .cancelAlgo(this.symbol, open.slAlgoId)
          .catch((e) =>
            this.store.event('warn', this.symbol, `trade #${open.id}: old stop ${open.slAlgoId} not cancelled (${(e as Error).message}); it sits behind the new one and goes when the trade closes`),
          )
      await this.store.event('info', this.symbol, `trade #${open.id}: stop trailed ${open.sl} → ${sl} (${note})`)
    }
    await this.saveTrendPlan({ ...plan, sl })
  }

  /**
   * A live rule strategy on the latest closed bar of `b`, the market being
   * flat: a real entry if its signal fires and every rule passes. Returns
   * 'opened', or why a signal could not be taken (a shadow trade then); [] when
   * there was no signal. writePlan: this decision is the market's plan.
   * scale: risk per trade multiplier (0.5 on probation, health.ts).
   */
  private async ruleEntry(
    st: RuleStrategy,
    canEnter: boolean,
    now: number,
    b: Bar[],
    sg: Signal | null,
    writePlan: boolean,
    ref: RefBars = {},
    scale = 1,
  ): Promise<'opened' | string[]> {
    const i = b.length - 1
    const last = b[i]
    const step = INTERVAL_MS[this.cfg.interval]
    const costs = this.cfg.wf.costs
    const side = sg?.side ?? st.sides[0]
    // Without a signal, the stop an entry here would have had (for the plan on the website).
    const slDist = sg?.dist ?? st.stopDist(b, i)
    const cost = slDist > 0 ? costR(last.c, slDist, costs, 'sl') : Infinity
    const summary = `${st.describe(b, i, ref)} · cost ${cost.toFixed(3)}R${scale !== 1 ? ` · risk ×${scale} (probation)` : ''}`
    const equityNow = await this.ex.balanceUsdt().catch(() => null)
    const risk = scale === 1 ? this.cfg.risk : { ...this.cfg.risk, riskPerTrade: this.cfg.risk.riskPerTrade * scale }
    const preview = (eq: number) => sizePreview(eq, last.c, slDist, this.rules, risk, costs)
    const plan: TradePlan = {
      symbol: this.symbol,
      t: now,
      barClose: last.t + step,
      interval: this.cfg.interval,
      strategy: 'trend',
      strategyId: st.id,
      side: side > 0 ? 'LONG' : 'SHORT',
      entry: last.c,
      sl: last.c - side * slDist,
      tp: null,
      costR: cost,
      status: 'skipped',
      reasons: [],
      live: equityNow != null ? preview(equityNow) : undefined,
      small: preview(this.cfg.previewEquity ?? 100),
    }
    const skip = async (reasons: string[], level: 'info' | 'warn' = 'info') => {
      plan.reasons = reasons
      if (writePlan) await this.saveTrendPlan(plan)
      await this.store.event(level, this.symbol, `${summary} — no trade: ${reasons.join('; ')}`)
    }
    if (!sg) {
      await skip([st.noEntry(b, i, ref) || `no ${st.id.toUpperCase()} entry`])
      return []
    }
    const counts = await this.store.setupCounts(this.symbol, now - (now % 86_400_000))
    const hard = checkTrendSetup(
      {
        entry: last.c,
        slDist,
        costR: cost,
        canEnter,
        listed: !this.cfg.realSymbols || this.cfg.realSymbols.includes(this.symbol),
        openPositions: counts.openPositions,
        tradesToday: counts.tradesToday,
      },
      this.cfg.setup,
    )
    if (hard.length) {
      await skip(hard)
      return hard
    }
    const equity = equityNow ?? (await this.ex.balanceUsdt())
    if (equity == null) {
      await skip(['USDT balance unavailable'], 'warn')
      return ['USDT balance unavailable']
    }
    const sz = size(equity, last.c, slDist, this.rules, risk)
    if (Number(sz.qty) <= 0) {
      await skip([sz.reason || 'size is zero'], 'warn')
      return [sz.reason || 'size is zero']
    }
    // Portfolio heat: open risk at the initial stops, across all symbols (research: 1.5% per side).
    const hot = heatCheck(await this.store.openRisk(), side, sz.riskUsd, equity, this.cfg.risk)
    if (hot) {
      await skip([hot])
      return [hot]
    }
    const o = await this.ex.marketOrder(this.symbol, side > 0 ? 'BUY' : 'SELL', sz.qty, false, `rb-in-${now}`)
    const fill = Number(o.avgPrice) || last.c
    const qty = Number(o.executedQty) || Number(sz.qty)
    const sl = Number(roundTick(fill - side * slDist, this.rules.tickSize, this.rules.pricePrecision))
    const id = await this.store.insertTrade({
      symbol: this.symbol,
      modelId: null,
      mode: 'trend',
      venue: this.ex.base,
      side,
      openedAt: now,
      barTime: last.t,
      entry: fill,
      qty,
      sl,
      tp: null,
      atr: sg.atr,
      riskUsd: qty * Math.abs(fill - sl),
      pWin: null,
      evR: null,
      features: sg.features,
      entryOrderId: o.orderId,
      costR: cost,
      journal: { interval: this.cfg.interval, decision: summary, plannedEntry: last.c, plannedSl: last.c - side * slDist, plannedTp: null, slippageBps: slippageBps(side, last.c, fill) },
      strategy: st.id,
    })
    // The trail starts from the entry bar: the signal bar counts as seen.
    await this.store.setTrail(id, { sl, slAlgoId: null, high: null, bar: last.t, initialSl: sl })
    let slAlgo: number
    try {
      slAlgo = (await this.ex.bracketLeg(this.symbol, side > 0 ? 'SELL' : 'BUY', 'STOP_MARKET', String(sl), `rb-sl-${id}`)).algoId
    } catch (e) {
      // No stop, no position.
      await this.store.event('error', this.symbol, `trade #${id}: stop could not be placed (${(e as Error).message}) — closing`)
      Object.assign(plan, { reasons: ['stop could not be placed, position closed'], tradeId: id })
      await this.saveTrendPlan(plan)
      await this.markClosing(id, 'error')
      await this.flatten(await this.ex.position(this.symbol))
      return 'opened'
    }
    await this.store.setLegs(id, null, slAlgo)
    Object.assign(plan, { status: 'opened', reasons: [], tradeId: id, entry: fill, sl })
    await this.saveTrendPlan(plan)
    await this.store.event('info', this.symbol, `${summary} — opened #${id} ${side > 0 ? 'LONG' : 'SHORT'} ${qty} @ ${fill} · SL ${sl} · no target · risk $${(qty * Math.abs(fill - sl)).toFixed(2)}`)
    return 'opened'
  }

  /**
   * A rule strategy's signal it could not (or may not) trade for real, as a
   * shadow trade: entry at the signal bar's close, its initial stop, no target;
   * at most one open per strategy and market, like a position.
   */
  private async ruleShadow(st: RuleStrategy, b: Bar[], sg: Signal, reasons: string[], ref: RefBars = {}): Promise<void> {
    if (!this.cfg.learn.shadow || (await this.store.openShadows(this.symbol, st.id)).length) return
    const i = b.length - 1
    const last = b[i]
    const sl = last.c - sg.side * sg.dist
    const cost = costR(last.c, sg.dist, this.cfg.wf.costs, 'sl')
    const id = await this.store.insertShadow({
      symbol: this.symbol,
      modelId: null,
      side: sg.side,
      barTime: last.t,
      entry: last.c,
      sl,
      tp: null,
      atr: sg.atr,
      horizon: null,
      pRaw: null,
      pCal: null,
      evR: null,
      costR: cost,
      rrNet: null,
      regime: null,
      rejectReason: reasons.join('; '),
      features: sg.features,
      journal: { interval: this.cfg.interval, decision: st.describe(b, i, ref) },
      strategy: st.id,
    })
    await this.store.event('info', this.symbol, `${st.id} shadow #${id} ${sg.side > 0 ? 'LONG' : 'SHORT'} @ ${last.c} · SL ${+sl.toPrecision(8)} — ${reasons.join('; ')}`)
  }
}
