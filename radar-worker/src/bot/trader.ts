// One symbol's trading loop: reconcile what the exchange holds with what the
// database says, enforce the time exit, and on each newly closed bar ask the
// model and — if every check passes — open a bracketed position.
//
// Order of operations on entry is chosen so that a crash at any point leaves
// something safe and visible: market fill → trade row written → exchange-side
// stop placed (or the position is closed at once if it cannot be) → maker
// take-profit placed. A position the database does not know about is closed.
import { closedBars, INTERVAL_MS } from './data.ts'
import { FEATURES, WARMUP, featureAt, indicators } from './features.ts'
import { roundStep, roundTick } from './futures.ts'
import type { Fill, Position, SymbolRules } from './futures.ts'
import { size } from './risk.ts'
import type { RiskConfig } from './risk.ts'
import type { BotStore, ModelRow, OpenTrade } from './store.ts'
import { DEFAULT_GATE, DEFAULT_WF, decide, fitModel, gate, walkForward } from './walkforward.ts'
import type { WfConfig } from './walkforward.ts'
import type { Bar } from './features.ts'

/** The exchange calls the trader needs — Futures implements it; tests fake it. */
export interface Exchange {
  base: string
  rules(symbol: string): Promise<SymbolRules>
  balanceUsdt(): Promise<number>
  position(symbol: string): Promise<Position>
  setup(symbol: string, leverage: number): Promise<void>
  marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, reduceOnly?: boolean, clientId?: string): Promise<{ orderId: number; avgPrice: string; executedQty: string }>
  bracketLeg(symbol: string, side: 'BUY' | 'SELL', type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET', triggerPrice: string, clientAlgoId: string): Promise<{ algoId: number }>
  takeProfitLimit(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientId: string): Promise<{ orderId: number; status: string }>
  cancelAllOrders(symbol: string): Promise<void>
  cancelAllAlgo(symbol: string): Promise<void>
  fills(symbol: string, startTime: number): Promise<Fill[]>
}

export interface TraderConfig {
  interval: string
  mode: 'gated' | 'explore'
  risk: RiskConfig
  wf: WfConfig
  /** Bars of history for training + walk-forward. */
  historyBars: number
  retrainMs: number
  /** Injected for tests; defaults to Binance spot klines. */
  bars?: (symbol: string, interval: string, count: number) => Promise<Bar[]>
}

export const DEFAULT_TRADER: TraderConfig = {
  interval: '4h',
  mode: 'gated',
  risk: { riskPerTrade: 0.005, maxNotionalX: 2, leverage: 3, maxDailyLoss: 0.03, maxDrawdown: 0.15 },
  wf: DEFAULT_WF,
  historyBars: 4380, // ~2 years of 4h bars
  retrainMs: 24 * 3_600_000,
}

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
  private closing = new Map<number, 'time' | 'tp' | 'error'>()
  private finalizeTries = new Map<number, number>()

  constructor(ex: Exchange, store: BotStore, symbol: string, cfg: TraderConfig) {
    this.ex = ex
    this.store = store
    this.symbol = symbol
    this.cfg = cfg
  }

  private get barsFn() {
    return this.cfg.bars ?? closedBars
  }

  async init(): Promise<void> {
    this.rules = await this.ex.rules(this.symbol)
    await this.ex.setup(this.symbol, this.cfg.risk.leverage)
    this.model = await this.store.latestModel(this.symbol, this.cfg.interval)
    if (!this.model || Date.now() - this.model.createdAt > this.cfg.retrainMs) await this.retrain()
  }

  /** Walk-forward the whole history, then fit the live model on the most recent window. */
  async retrain(): Promise<void> {
    const t0 = Date.now()
    const b = await this.barsFn(this.symbol, this.cfg.interval, this.cfg.historyBars)
    const wf = walkForward(b, this.cfg.wf)
    const g = gate(wf.metrics, DEFAULT_GATE)
    const H = this.cfg.wf.bracket.horizon
    const end = b.length - H
    const m = fitModel(b, indicators(b), Math.max(0, end - this.cfg.wf.trainBars), end, this.cfg.wf, Date.now() % 100_000)
    if (!m) {
      await this.store.event('error', this.symbol, `retrain failed: not enough history (${b.length} bars)`)
      return
    }
    const id = await this.store.saveModel(this.symbol, this.cfg.interval, m, wf.metrics, g.pass, g.reasons)
    this.model = await this.store.latestModel(this.symbol, this.cfg.interval)
    const x = wf.metrics
    await this.store.event(
      g.pass ? 'info' : 'warn',
      this.symbol,
      `model #${id} trained in ${Math.round((Date.now() - t0) / 1000)}s — out-of-sample: ${x.trades} trades, ` +
        `win ${(x.winRate * 100).toFixed(1)}%, ${x.expectancyR.toFixed(3)}R/trade, PF ${x.profitFactor.toFixed(2)}, ` +
        `max DD ${x.maxDrawdownR.toFixed(1)}R — gate ${g.pass ? 'PASS' : 'FAIL: ' + g.reasons.join('; ')}`,
    )
  }

  async tick(canEnter: boolean, now = Date.now()): Promise<void> {
    if (this.model && now - this.model.createdAt > this.cfg.retrainMs) await this.retrain()
    const open = await this.store.openTrade(this.symbol)
    const pos = await this.ex.position(this.symbol)
    if (open) return this.manage(open, pos, now)
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
    const H = this.cfg.wf.bracket.horizon
    const deadline = open.barTime + (H + 1) * INTERVAL_MS[this.cfg.interval]
    if (now >= deadline && !this.closing.has(open.id)) {
      this.closing.set(open.id, 'time')
      await this.store.event('info', this.symbol, `time exit after ${H} bars`)
      await this.flatten(pos)
    }
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
    const entries = fills.filter((f) => f.side === entrySide && f.time >= open.openedAt - 5000 && f.time <= exits[exits.length - 1].time)
    const fees = [...entries, ...exits].filter((f) => f.commissionAsset === 'USDT').reduce((a, f) => a + f.commission, 0)
    const gross = exits.reduce((a, f) => a + f.realizedPnl, 0)
    const pnl = gross - fees
    const reason = this.closing.get(open.id) ?? (open.tpOrderId != null && exits.some((f) => f.orderId === open.tpOrderId) ? 'tp' : 'sl')
    await this.ex.cancelAllOrders(this.symbol)
    await this.ex.cancelAllAlgo(this.symbol)
    const r = open.riskUsd > 0 ? pnl / open.riskUsd : 0
    await this.store.closeTrade(open.id, { closedAt: exits[exits.length - 1].time, exit: vwap(exits), reason, pnlUsd: pnl, feesUsd: fees, r })
    this.closing.delete(open.id)
    this.finalizeTries.delete(open.id)
    await this.store.event('info', this.symbol, `trade #${open.id} closed by ${reason}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT (${r.toFixed(2)}R)`)
  }

  private async maybeEnter(canEnter: boolean, now: number): Promise<void> {
    const b = await this.barsFn(this.symbol, this.cfg.interval, WARMUP + 80)
    const last = b[b.length - 1]
    if (!last || last.t === this.lastBar) return
    this.lastBar = last.t
    if (!this.model) return
    const ind = indicators(b)
    const i = b.length - 1
    const d = decide(this.model.model, b, ind, i)
    if (!d) return
    const summary = `P(long) ${(d.pLong * 100).toFixed(1)}% EV ${d.evLong.toFixed(3)}R · P(short) ${(d.pShort * 100).toFixed(1)}% EV ${d.evShort.toFixed(3)}R`
    if (this.cfg.mode === 'gated' && !this.model.gatePass) {
      await this.store.event('info', this.symbol, `${summary} — no trade: model #${this.model.id} has no proven edge (${this.model.gateReasons[0] || 'gate failed'})`)
      return
    }
    if (!d.side) {
      await this.store.event('info', this.symbol, `${summary} — no trade: below the ${this.cfg.wf.minEvR}R bar`)
      return
    }
    if (!canEnter) {
      await this.store.event('info', this.symbol, `${summary} — no trade: risk limits`)
      return
    }
    const k = this.cfg.wf.bracket
    const atr = ind.atr[i]
    const slDist = k.slAtr * atr
    const equity = await this.ex.balanceUsdt()
    const sz = size(equity, last.c, slDist, this.rules, this.cfg.risk)
    if (Number(sz.qty) <= 0) {
      await this.store.event('warn', this.symbol, `${summary} — no trade: ${sz.reason}`)
      return
    }
    const side = d.side
    const buy = side > 0
    const o = await this.ex.marketOrder(this.symbol, buy ? 'BUY' : 'SELL', sz.qty, false, `rb-in-${now}`)
    const fill = Number(o.avgPrice) || last.c
    const qty = Number(o.executedQty) || Number(sz.qty)
    const sl = Number(roundTick(fill - side * slDist, this.rules.tickSize, this.rules.pricePrecision))
    const tp = Number(roundTick(fill + side * k.tpAtr * atr, this.rules.tickSize, this.rules.pricePrecision))
    // The exact inputs behind this decision, kept with the trade.
    const fv = featureAt(b, ind, i) || []
    const x = Object.fromEntries(FEATURES.map((name, j) => [name, fv[j]]))
    const id = await this.store.insertTrade({
      symbol: this.symbol,
      modelId: this.model.id,
      mode: this.cfg.mode,
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
      pWin: buy ? d.pLong : d.pShort,
      evR: buy ? d.evLong : d.evShort,
      features: x,
      entryOrderId: o.orderId,
    })
    const exitSide = buy ? 'SELL' : 'BUY'
    let slAlgo: number | null = null
    try {
      slAlgo = (await this.ex.bracketLeg(this.symbol, exitSide, 'STOP_MARKET', String(sl), `rb-sl-${id}`)).algoId
    } catch (e) {
      // No stop, no position.
      await this.store.event('error', this.symbol, `trade #${id}: stop could not be placed (${(e as Error).message}) — closing`)
      this.closing.set(id, 'error')
      await this.flatten(await this.ex.position(this.symbol))
      return
    }
    let tpOrder: number | null = null
    try {
      const t = await this.ex.takeProfitLimit(this.symbol, exitSide, roundStep(qty, this.rules.stepSize, this.rules.quantityPrecision), String(tp), `rb-tp-${id}`)
      if (t.status === 'EXPIRED') {
        // Post-only refused: price is already through the target. Take it.
        this.closing.set(id, 'tp')
        await this.flatten(await this.ex.position(this.symbol))
      } else tpOrder = t.orderId
    } catch (e) {
      await this.store.event('warn', this.symbol, `trade #${id}: target not placed (${(e as Error).message}); the stop and time exit still apply`)
    }
    await this.store.setLegs(id, tpOrder, slAlgo)
    await this.store.event('info', this.symbol, `${summary} — opened #${id} ${buy ? 'LONG' : 'SHORT'} ${qty} @ ${fill} · SL ${sl} · TP ${tp} · risk $${(qty * Math.abs(fill - sl)).toFixed(2)}`)
  }
}

