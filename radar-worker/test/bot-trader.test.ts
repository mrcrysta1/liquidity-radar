// The whole trading loop against a simulated exchange and the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { PositionBook } from '../src/bot/futures.ts'
import type { Fill, Position, SymbolRules } from '../src/bot/futures.ts'
import { BotStore } from '../src/bot/store.ts'
import { DEFAULT_TRADER, SymbolTrader } from '../src/bot/trader.ts'
import type { Exchange, TraderConfig } from '../src/bot/trader.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'
import { DEFAULT_SETUP } from '../src/bot/setup.ts'
import type { TradePlan } from '../src/bot/plan.ts'
import { highPrev, trendIndicators, trendSignal } from '../src/bot/strategy.ts'
import { BarCache } from '../src/bot/data.ts'
import { tickOrder } from '../src/bot/startup.ts'
import { FEATURES_V2 } from '../src/bot/features.ts'
import { c6State, f1FlatAt } from '../src/bot/c6.ts'
import type { C6Model } from '../src/bot/c6.ts'

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '007_bot_trend.sql', '008_bot_strategies.sql', '008_bot_strategies.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

/** Fills at the current price; stops and post-only targets trigger on move(). */
class FakeExchange implements Exchange {
  base = 'fake://testnet'
  price = 100
  pos = { amt: 0, entry: 0 }
  balance: number | null = 10_000
  log: Fill[] = []
  algo: Array<{ algoId: number; side: 'BUY' | 'SELL'; trigger: number }> = []
  limits: Array<{ orderId: number; side: 'BUY' | 'SELL'; qty: number; price: number }> = []
  failStop = false
  /** Reduce-only market orders that fail (a timeout) before one goes through. */
  failFlatten = 0
  /** Post-only target rejected as it would cross (Binance -5022). */
  rejectTp = false
  /** Asset fees are paid in (BNB with the fee discount), and its USDT price. */
  feeAsset = 'USDT'
  feeAssetUsdt = 1
  private id = 1

  async rules(): Promise<SymbolRules> {
    return { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, pricePrecision: 2, quantityPrecision: 3 }
  }
  async balanceUsdt() {
    return this.balance
  }
  /** Per-market position reads (the shared PositionBook read is counted by the book). */
  positionCalls = 0
  async position(symbol: string): Promise<Position> {
    this.positionCalls++
    return { symbol, amt: this.pos.amt, entry: this.pos.entry, mark: this.price, unrealized: 0 }
  }
  async setup() {}
  private exec(side: 'BUY' | 'SELL', qty: number, price: number, maker: boolean, orderId: number) {
    const signed = side === 'BUY' ? qty : -qty
    let pnl = 0
    if (this.pos.amt !== 0 && Math.sign(signed) !== Math.sign(this.pos.amt)) {
      const closing = Math.min(Math.abs(signed), Math.abs(this.pos.amt))
      pnl = (price - this.pos.entry) * closing * Math.sign(this.pos.amt)
    }
    const fee = price * qty * (maker ? 0.0002 : 0.0005)
    const next = +(this.pos.amt + signed).toFixed(8)
    this.pos = { amt: next, entry: next === 0 ? 0 : this.pos.amt === 0 ? price : this.pos.entry }
    if (this.balance != null) this.balance += pnl - fee
    this.log.push({ id: this.id++, orderId, time: Date.now(), side, price, qty, realizedPnl: pnl, commission: fee / this.feeAssetUsdt, commissionAsset: this.feeAsset })
  }
  async marketOrder(_s: string, side: 'BUY' | 'SELL', quantity: string, reduceOnly = false) {
    if (reduceOnly && this.failFlatten > 0) {
      this.failFlatten--
      throw new Error('simulated timeout')
    }
    const orderId = this.id++
    const q = reduceOnly ? Math.min(Number(quantity), Math.abs(this.pos.amt)) : Number(quantity)
    if (q > 0) this.exec(side, q, this.price, false, orderId)
    return { orderId, avgPrice: String(this.price), executedQty: String(q) }
  }
  async bracketLeg(_s: string, side: 'BUY' | 'SELL', _t: string, triggerPrice: string) {
    if (this.failStop) throw new Error('simulated rejection')
    const algoId = this.id++
    this.algo.push({ algoId, side, trigger: Number(triggerPrice) })
    this.ops.push('place:' + algoId)
    return { algoId }
  }
  /** Stop placements and single cancels, in order (the trend trail must place before it cancels). */
  ops: string[] = []
  async cancelAlgo(_s: string, algoId: number) {
    this.ops.push('cancel:' + algoId)
    this.algo = this.algo.filter((a) => a.algoId !== algoId)
  }
  async takeProfitLimit(_s: string, side: 'BUY' | 'SELL', quantity: string, price: string) {
    if (this.rejectTp) throw Object.assign(new Error('Binance 400 -5022: post only order will be rejected'), { code: -5022 })
    const orderId = this.id++
    this.limits.push({ orderId, side, qty: Number(quantity), price: Number(price) })
    return { orderId, status: 'NEW' }
  }
  async cancelAllOrders() {
    this.limits = []
  }
  async cancelAllAlgo() {
    this.algo = []
  }
  async fills(_s: string, start: number) {
    return this.log.filter((f) => f.time >= start)
  }
  move(p: number) {
    this.price = p
    for (const a of [...this.algo]) {
      const hit = a.side === 'SELL' ? p <= a.trigger : p >= a.trigger
      if (hit && this.pos.amt !== 0) {
        this.algo = this.algo.filter((x) => x !== a)
        this.exec(a.side, Math.abs(this.pos.amt), a.trigger, false, a.algoId)
      }
    }
    for (const l of [...this.limits]) {
      const hit = l.side === 'SELL' ? p >= l.price : p <= l.price
      if (hit && this.pos.amt !== 0) {
        this.limits = this.limits.filter((x) => x !== l)
        this.exec(l.side, Math.min(l.qty, Math.abs(this.pos.amt)), l.price, true, l.orderId)
      }
    }
  }
}

/** Random-walk 4h bars whose last bar closes about now. */
function bars(n: number, seed = 5): Bar[] {
  let s = seed
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const step = 14_400_000
  const t0 = Date.now() - n * step
  const out: Bar[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const c = o * (1 + (r() - 0.5) * 0.02)
    out.push({ t: t0 + i * step, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: 100, tb: 50 })
    p = c
  }
  return out
}

function setup(mode: TraderConfig['mode']) {
  const hist = bars(1500)
  const state = { idx: 1400 }
  const cfg: TraderConfig = {
    ...DEFAULT_TRADER,
    mode,
    historyBars: 1400,
    // These replays treat old simulated bars as "now".
    maxLateMs: Infinity,
    wf: { ...DEFAULT_WF, trainBars: 600, testBars: 200, minEvR: mode === 'gated' ? DEFAULT_WF.minEvR : -99, mlp: { ...DEFAULT_WF.mlp, epochs: 6 } },
    // These replays exercise the order flow, so the EV rule and the cooldown are
    // relaxed here; they have their own tests (bot-setup, and below).
    setup: { ...DEFAULT_SETUP, minEvR: -1e9, cooldownMs: 0 },
    bars: async (_s, _i, n) => hist.slice(0, state.idx).slice(-n),
  }
  return { hist, state, cfg }
}

test('explore mode: enter, take profit, stop out, failed stop, stray position', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  assert.ok(t.model, 'a model was trained and stored')

  // 1. Entry with an exchange-side stop and a resting maker target.
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  let open = await store.openTrade('BTCUSDT')
  assert.ok(open, 'trade recorded')
  assert.equal(ex.algo.length, 1, 'stop on the exchange')
  assert.equal(ex.limits.length, 1, 'target on the book')
  assert.equal(Math.sign(ex.pos.amt), open!.side)
  const riskPct = open!.riskUsd / 10_000
  assert.ok(riskPct <= 0.005 + 1e-9, 'risk within 0.5%: ' + riskPct)
  // The plan on the website matches the trade that was opened.
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.equal(plan?.status, 'opened')
  assert.equal(plan?.tradeId, open!.id)
  assert.equal(plan?.sl, open!.sl)
  assert.equal(plan?.tp, open!.tp)
  assert.equal(plan?.side, open!.side > 0 ? 'LONG' : 'SHORT')
  assert.equal(plan?.live?.equity, 10_000)
  assert.equal(plan?.small?.equity, 100)

  // 2. Target reached → closed as tp, about +2R less fees.
  ex.move(open!.tp + open!.side * 0.05)
  assert.equal(ex.pos.amt, 0)
  await t.tick(true, Date.now())
  let row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.status, 'closed')
  assert.equal(row.exit_reason, 'tp')
  assert.ok((row.r_multiple as number) > 1.8 && (row.r_multiple as number) < 2, 'tp R ' + row.r_multiple)
  assert.ok((row.fees_usd as number) > 0)
  assert.equal(ex.algo.length, 0, 'leftover stop cancelled')
  // Journal: planned levels from the decision bar, slippage, MAE/MFE, bars held, model and decision.
  assert.equal(row.planned_entry, hist[state.idx - 1].c)
  assert.equal(row.slippage_bps, 0, 'filled at the planned price')
  assert.ok(Math.abs((row.planned_sl as number) - (row.sl as number)) < 0.01 && Math.abs((row.planned_tp as number) - (row.tp as number)) < 0.01)
  assert.equal(row.interval, '4h')
  assert.equal(row.model_version, t.model!.version)
  assert.match(String(row.decision), /P\(long\).*EV.*R:R/)
  assert.equal(row.mae_r, 0)
  assert.ok((row.mfe_r as number) >= 1.4, 'mfe ' + row.mfe_r)
  assert.ok((row.bars_held as number) >= 1, 'bars held ' + row.bars_held)

  // 3. Next bar: enter again, then the stop is hit → about -1R.
  state.idx++
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  open = await store.openTrade('BTCUSDT')
  assert.ok(open)
  ex.move(open!.sl - open!.side * 0.05)
  await t.tick(true, Date.now())
  row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.exit_reason, 'sl')
  assert.ok((row.r_multiple as number) < -1 && (row.r_multiple as number) > -1.2, 'sl R ' + row.r_multiple)
  assert.equal(ex.limits.length, 0, 'leftover target cancelled')

  // 4. The stop is rejected → the position is closed straight away.
  state.idx++
  ex.price = hist[state.idx - 1].c
  ex.failStop = true
  await t.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0, 'no unprotected position')
  await t.tick(true, Date.now())
  row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.exit_reason, 'error')
  ex.failStop = false

  // 5. A position nobody recorded is flattened.
  ex.pos = { amt: 0.5, entry: ex.price }
  await t.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0)
  const ev = (await pg.query<{ msg: string }>("select msg from bot_events where msg like 'unrecorded%'")).rows
  assert.equal(ev.length, 1)

  // 6. Risk limits off → no entry, and it says why.
  state.idx++
  await t.tick(false, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  const why = (await pg.query<{ msg: string }>("select msg from bot_events where msg like '%risk limits%'")).rows
  assert.equal(why.length, 1)
})

test('journal: MAE / MFE of a real trade include the mark prices seen while it was open', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  const open = (await store.openTrade('BTCUSDT'))!
  const dist = Math.abs(open.entry - open.sl)
  // Half a stop against it, then most of the way to the target, then the stop.
  // (Ticks dated inside the bracket's horizon: these replay bars are old, so "now" would be a time exit.)
  const during = open.barTime + 2 * 14_400_000
  ex.move(open.entry - open.side * 0.5 * dist)
  await t.tick(true, during)
  ex.move(open.entry + open.side * 1.2 * dist)
  await t.tick(true, during)
  ex.move(open.sl - open.side * 0.01)
  await t.tick(true, during)
  const row = (await pg.query<Record<string, number | string>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.exit_reason, 'sl')
  assert.ok(Math.abs(Number(row.mae_r) + 1) < 0.02, 'mae ' + row.mae_r)
  assert.ok(Math.abs(Number(row.mfe_r) - 1.2) < 0.02, 'mfe ' + row.mfe_r)
})

test('gated mode: a model without a proven edge never trades', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('gated')
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  assert.equal(t.model!.gatePass, false, 'random walk must not pass the gate')
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0)
  const ev = (await pg.query<{ msg: string }>("select msg from bot_events where msg like '%no proven edge%'")).rows
  assert.equal(ev.length, 1)
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.ok(plan && plan.status !== 'opened', 'planned but not opened: ' + plan?.status)
  assert.ok(plan!.reasons.some((r) => r.includes('no proven edge')), plan!.reasons.join('; '))
  assert.ok((plan!.side === 'LONG') === plan!.tp > plan!.entry && (plan!.side === 'LONG') === plan!.sl < plan!.entry, 'stop and target on the right sides')
})

test('scheduled runs (BOT_ONCE): each bar decided once across restarts; late bars skipped', async () => {
  const { db } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  ex.price = hist[state.idx - 1].c
  // Run 1 enters on the latest bar.
  const a = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await a.init()
  await a.tick(true, Date.now())
  const first = await store.openTrade('BTCUSDT')
  assert.ok(first, 'run 1 entered')
  // The trade closes; run 2 is a brand-new process on the same bar: it must not re-enter.
  ex.move(first!.tp + first!.side * 0.05)
  const b = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await b.init()
  await b.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null, 'same bar not traded twice after a restart')
  // A bar that closed long ago is skipped by a strict trader.
  state.idx++
  ex.price = hist[state.idx - 1].c
  const strict = new SymbolTrader(ex, store, 'BTCUSDT', { ...cfg, maxLateMs: 60 * 60_000 })
  await strict.init()
  await strict.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null, 'stale bar skipped')
})

test('rejected only by the EV rule → a shadow trade, resolved on bars, learned from, and it triggers a challenger', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  cfg.setup = { ...cfg.setup, minEvR: 1e9 } // no idea can clear this bar
  cfg.learn = { ...cfg.learn, everyTrades: 1 }
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null, 'no real trade')
  assert.equal(ex.pos.amt, 0, 'no order sent')
  let sh = (await pg.query<Record<string, unknown>>('select * from bot_shadow_trades order by id')).rows
  assert.equal(sh.length, 1)
  assert.equal(sh[0].status, 'open')
  assert.match(String(sh[0].reject_reason), /below the 1000000000R bar/)
  assert.equal(Number(sh[0].bar_time instanceof Date ? (sh[0].bar_time as Date).getTime() : 0), hist[state.idx - 1].t)

  // A risk-limit (hard) rejection on the next bar adds no second shadow, and the open one is not doubled.
  state.idx++
  await t.tick(false, Date.now())
  assert.equal((await pg.query('select id from bot_shadow_trades')).rows.length, 1)

  // Enough bars for the bracket to finish: the shadow closes, the calibration
  // learns from it, and (everyTrades = 1) a challenger is trained at once.
  state.idx += cfg.wf.bracket.horizon
  await t.tick(true, Date.now())
  sh = (await pg.query<Record<string, unknown>>('select * from bot_shadow_trades order by id')).rows
  assert.equal(sh[0].status, 'closed')
  assert.ok(['tp', 'sl', 'time'].includes(String(sh[0].exit_reason)))
  assert.ok(isFinite(Number(sh[0].r_net)) && Number(sh[0].r_net) < Number(sh[0].r_gross), 'costs taken off')
  assert.equal(sh[0].learned, true)
  assert.equal(Number(sh[0].bars_held) > 0 && Number(sh[0].bars_held) <= cfg.wf.bracket.horizon, true, 'bars held ' + sh[0].bars_held)
  assert.ok(Number(sh[0].mae_r) <= 0 && Number(sh[0].mfe_r) >= 0, `mae ${sh[0].mae_r} mfe ${sh[0].mfe_r}`)
  assert.equal(sh[0].model_version, 1)
  assert.equal(sh[0].interval, '4h')
  assert.match(String(sh[0].decision), /P\(long\)/)
  const cal = (await pg.query<{ n: number; side: number; regime: string }>('select * from bot_calibration')).rows
  assert.equal(cal.length, 1)
  assert.equal(cal[0].n, 1)
  assert.equal(cal[0].side, sh[0].side)
  assert.equal(cal[0].regime, sh[0].regime)
  // The closed shadow is training data now, and the challenger was stored with its held-out scores.
  assert.equal((await store.experience('BTCUSDT', cfg.wf.bracket)).length, 1)
  const models = (await pg.query<Record<string, unknown>>('select id, version, role, holdout from bot_models order by id')).rows
  assert.equal(models.length, 2)
  assert.deepEqual(models.map((m) => m.version), [1, 2])
  assert.equal(models.filter((m) => m.role === 'champion').length, 1, 'exactly one champion')
  const h = models[1].holdout as { trigger: string; challenger: { n: number }; champion: { n: number } | null }
  assert.match(h.trigger, /new closed trades/)
  assert.ok(h.challenger.n > 0 && h.champion && h.champion.n === h.challenger.n, 'both scored on the same rows')
  assert.equal(t.model!.version, models.find((m) => m.role === 'champion')!.version)
})

test('setup rules block real entries: cooldown after a stop-out, and the open-position cap', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  cfg.setup = { ...cfg.setup, cooldownMs: 30 * 60_000 }
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  const open = await store.openTrade('BTCUSDT')
  assert.ok(open, 'entered')
  ex.move(open!.sl - open!.side * 0.05)
  await t.tick(true, Date.now())
  // Next bar, right after the stop-out: no entry.
  state.idx++
  ex.price = hist[state.idx - 1].c
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal((await pg.query("select msg from bot_events where msg like '%cooldown after a stop-out%'")).rows.length, 1)
  assert.equal((await pg.query('select id from bot_shadow_trades')).rows.length, 0, 'a hard rejection is not shadowed')

  // Four positions open elsewhere: the fifth is refused.
  for (const s of ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XAUUSDT'])
    await store.insertTrade({
      symbol: s, modelId: t.model!.id, mode: 'explore', venue: 'fake', side: 1, openedAt: Date.now(), barTime: Date.now(), entry: 1, qty: 1,
      sl: 0.9, tp: 1.2, atr: 0.05, riskUsd: 0.1, pWin: 0.5, evR: 0.1, features: {}, entryOrderId: 1,
    })
  const t2 = new SymbolTrader(ex, store, 'BTCUSDT', { ...cfg, setup: { ...cfg.setup, cooldownMs: 0 } })
  await t2.init()
  state.idx++
  ex.price = hist[state.idx - 1].c
  await t2.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal((await pg.query("select msg from bot_events where msg like '%4 positions open (max 4)%'")).rows.length, 1)
})

test('a close that fails is retried every tick (even after a restart); a crossed post-only target is taken', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()

  // The stop is rejected and the emergency close times out: no stop, still in.
  ex.price = hist[state.idx - 1].c
  ex.failStop = true
  ex.failFlatten = 1
  await assert.rejects(t.tick(true, Date.now()))
  assert.notEqual(ex.pos.amt, 0)
  ex.failStop = false
  // Next tick, in a restarted process: the close is tried again at once.
  const t2 = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t2.init()
  await t2.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0, 'unprotected position closed on the retry')
  await t2.tick(true, Date.now())
  let row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.status, 'closed')
  assert.equal(row.exit_reason, 'error')

  // Binance rejects the post-only target with -5022 (price already through it): take the profit.
  state.idx++
  ex.price = hist[state.idx - 1].c
  ex.rejectTp = true
  await t2.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0, 'closed instead of left without a target')
  await t2.tick(true, Date.now())
  row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.exit_reason, 'tp')
  assert.equal(ex.algo.length, 0, 'leftover stop cancelled')
})

test('finalize counts only this trade’s entry fill, not an earlier same-side fill (e.g. the last trade’s close)', async () => {
  for (const legacy of [false, true]) {
    const { db, pg } = await freshDb()
    const store = new BotStore(db)
    const ex = new FakeExchange()
    const { hist, state, cfg } = setup('explore')
    const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
    await t.init()
    ex.price = hist[state.idx - 1].c
    const now = Date.now()
    await t.tick(true, now)
    const open = await store.openTrade('BTCUSDT')
    assert.ok(open)
    assert.equal(typeof open!.entryOrderId, 'number', 'entry order id is read back')
    // A row written before entry_order_id was kept falls back to the time window.
    if (legacy) await pg.query('update bot_trades set entry_order_id = null where id = $1', [open!.id])
    // A same-side fill from just before this trade opened, with a large fee.
    const side = open!.side > 0 ? 'BUY' : 'SELL'
    ex.log.unshift({ id: 9999, orderId: 9999, time: open!.openedAt - 2000, side, price: ex.price, qty: 1, realizedPnl: 0, commission: 50, commissionAsset: 'USDT' })
    ex.move(open!.tp + open!.side * 0.05)
    await t.tick(true, Date.now())
    const row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
    assert.equal(row.status, 'closed')
    const expected = ex.log.filter((f) => f.orderId !== 9999).reduce((a, f) => a + f.commission, 0)
    assert.ok(Math.abs(Number(row.fees_usd) - expected) < 1e-6, `fees ${row.fees_usd} = ${expected} (legacy ${legacy})`)
  }
})

test('fees paid in BNB are converted to USDT; without a price they are left out with a warning, not a crash', async () => {
  for (const priced of [true, false]) {
    const { db, pg } = await freshDb()
    const store = new BotStore(db)
    const ex = new FakeExchange()
    ex.feeAsset = 'BNB'
    ex.feeAssetUsdt = 600
    const { hist, state, cfg } = setup('explore')
    const asked: string[] = []
    cfg.price = async (s) => {
      asked.push(s)
      if (!priced) throw new Error('offline')
      return 600
    }
    const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
    await t.init()
    ex.price = hist[state.idx - 1].c
    await t.tick(true, Date.now())
    const open = await store.openTrade('BTCUSDT')
    assert.ok(open)
    ex.move(open!.tp + open!.side * 0.05)
    await t.tick(true, Date.now())
    const row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
    assert.equal(row.status, 'closed')
    assert.equal(row.exit_reason, 'tp')
    assert.deepEqual(asked, ['BNBUSDT'])
    const gross = ex.log.reduce((a, f) => a + f.realizedPnl, 0)
    const feesUsdt = ex.log.reduce((a, f) => a + f.commission * 600, 0)
    if (priced) {
      assert.ok(feesUsdt > 0)
      assert.ok(Math.abs(Number(row.fees_usd) - feesUsdt) < 1e-6, `fees ${row.fees_usd} = ${feesUsdt}`)
      assert.ok(Math.abs(Number(row.pnl_usd) - (gross - feesUsdt)) < 1e-6, 'PnL is net of the BNB fees')
    } else {
      assert.equal(Number(row.fees_usd), 0)
      const warn = (await pg.query<{ msg: string }>("select msg from bot_events where level = 'warn' and msg like '%BNB in fees left out%'")).rows
      assert.equal(warn.length, 1)
    }
  }
})

test('an unreadable balance means no entry this bar, not a zero-equity order', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('explore')
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  ex.price = hist[state.idx - 1].c
  ex.balance = null
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0, 'no order sent')
  assert.equal((await pg.query("select msg from bot_events where msg like '%USDT balance unavailable%'")).rows.length, 1)
})

// ---- hybrid mode: real only with a passed gate, a listed symbol and room under the heat cap ----

/** A hybrid trader whose walk-forward gate is forced to `pass` (a random walk never passes it). */
async function hybrid(pass: boolean, over: Partial<TraderConfig> = {}) {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const { hist, state, cfg } = setup('hybrid')
  const c: TraderConfig = { ...cfg, learn: { ...cfg.learn, shadowMaxOpen: cfg.wf.bracket.horizon + 1 }, ...over }
  const t = new SymbolTrader(ex, store, 'BTCUSDT', c)
  await t.init()
  t.gate = { ...t.gate!, pass }
  ex.price = hist[state.idx - 1].c
  const shadows = async () => (await pg.query<{ reject_reason: string; status: string }>('select reject_reason, status from bot_shadow_trades order by id')).rows
  return { store, ex, hist, state, t, pg, shadows }
}

/** Open real trades on other symbols, `n` per side, each risking `riskUsd`. */
async function openElsewhere(store: BotStore, modelId: number, n: number, riskUsd: number) {
  const syms = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XAUUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT', 'LTCUSDT']
  let k = 0
  for (const side of [1, -1] as const)
    for (let i = 0; i < n; i++)
      await store.insertTrade({
        symbol: syms[k++], modelId, mode: 'gated', venue: 'fake', side, openedAt: Date.now(), barTime: Date.now(), entry: 1, qty: 1,
        sl: 0.9, tp: 1.2, atr: 0.05, riskUsd, pWin: 0.5, evR: 0.1, features: {}, entryOrderId: 1,
      })
}

test('hybrid: gate passed → a real order (recorded as gated), no shadow', async () => {
  const { store, ex, t, pg, shadows } = await hybrid(true)
  await t.tick(true, Date.now())
  const open = await store.openTrade('BTCUSDT')
  assert.ok(open, 'real trade opened')
  assert.notEqual(ex.pos.amt, 0)
  assert.equal((await pg.query<{ mode: string }>('select mode from bot_trades')).rows[0].mode, 'gated')
  assert.equal((await shadows()).length, 0)
})

test('hybrid: gate failed → a shadow trade on every bar (several open at once), never an order', async () => {
  const { store, ex, hist, state, t, shadows } = await hybrid(false)
  for (let j = 0; j < 3; j++) {
    await t.tick(true, Date.now())
    state.idx++
    ex.price = hist[state.idx - 1].c
  }
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0, 'no order sent')
  const sh = await shadows()
  assert.equal(sh.length, 3, 'one shadow per bar')
  assert.ok(sh.every((s) => /no proven edge/.test(s.reject_reason)), sh.map((s) => s.reject_reason).join(' | '))
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.equal(plan?.status, 'paper')
})

test('hybrid: the portfolio heat cap turns the 4th same-side trade into a shadow', async () => {
  const setupCfg = { ...DEFAULT_SETUP, minEvR: -1e9, cooldownMs: 0, maxOpen: 10 }
  // Total cap off here, so only the per-side cap (1.5%) can bind. 0.5% each at $10,000.
  const risk = { ...DEFAULT_TRADER.risk, maxSideRisk: 0.015, maxTotalRisk: 1 }
  // Two open per side: the third on either side fits.
  {
    const { store, t, shadows } = await hybrid(true, { setup: setupCfg, risk })
    await openElsewhere(store, t.model!.id, 2, 50)
    await t.tick(true, Date.now())
    assert.ok(await store.openTrade('BTCUSDT'), 'third same-side trade opened')
    assert.equal((await shadows()).length, 0)
  }
  // Three open per side: the fourth on either side is over the cap.
  {
    const { store, ex, t, pg, shadows } = await hybrid(true, { setup: setupCfg, risk })
    await openElsewhere(store, t.model!.id, 3, 50)
    await t.tick(true, Date.now())
    assert.equal(await store.openTrade('BTCUSDT'), null)
    assert.equal(ex.pos.amt, 0, 'no order sent')
    const sh = await shadows()
    assert.equal(sh.length, 1)
    assert.match(sh[0].reject_reason, /^portfolio heat: (long|short) risk 1\.50% open/)
    assert.equal((await pg.query("select msg from bot_events where msg like '%no trade: portfolio heat%'")).rows.length, 1)
    const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
    assert.equal(plan?.status, 'paper')
    assert.match(plan!.reasons[0], /portfolio heat/)
  }
})

test('hybrid: a symbol outside BOT_REAL_SYMBOLS only shadow trades, even with a passed gate', async () => {
  const { store, ex, t, shadows } = await hybrid(true, { realSymbols: ['ETHUSDT'] })
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0)
  const sh = await shadows()
  assert.equal(sh.length, 1)
  assert.match(sh[0].reject_reason, /not in the real-trade list/)
  // Listed → real.
  const listed = await hybrid(true, { realSymbols: ['ETHUSDT', 'BTCUSDT'] })
  await listed.t.tick(true, Date.now())
  assert.ok(await listed.store.openTrade('BTCUSDT'))
})

test('explore and gated ignore the heat cap and the real-symbol list (hybrid only)', async () => {
  for (const mode of ['explore', 'gated'] as const) {
    const { db } = await freshDb()
    const store = new BotStore(db)
    const ex = new FakeExchange()
    const { hist, state, cfg } = setup(mode)
    const t = new SymbolTrader(ex, store, 'BTCUSDT', {
      ...cfg,
      wf: { ...cfg.wf, minEvR: -99 },
      setup: { ...cfg.setup, maxOpen: 10 },
      risk: { ...cfg.risk, maxSideRisk: 0.001, maxTotalRisk: 0.001 },
      realSymbols: ['ETHUSDT'],
    })
    await t.init()
    if (mode === 'gated') t.gate = { ...t.gate!, pass: true }
    await openElsewhere(store, t.model!.id, 3, 50)
    ex.price = hist[state.idx - 1].c
    await t.tick(true, Date.now())
    const open = await store.openTrade('BTCUSDT')
    assert.ok(open, mode + ' opened despite heat and list')
    const row = (await db.query('select mode from bot_trades where id = $1', [open!.id])).rows[0] as { mode: string }
    assert.equal(row.mode, mode)
  }
})

// ---- trend strategy (BOT_STRATEGY=trend): F1 places the real orders, the model only shadow trades ----

/**
 * 1100 bars of a noisy uptrend (or downtrend), then: a flat stretch, an F1
 * breakout bar (index S), a run-up, a tight range, and a close below the range.
 */
function trendHist(up = true) {
  let s = 7
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const raw: Array<{ o: number; c: number }> = []
  let p = 100
  const bar = (c: number) => {
    raw.push({ o: p, c })
    p = c
  }
  for (let i = 0; i < 1100; i++) bar(p * (1 + (up ? 0.0008 : -0.0008) + (r() - 0.5) * 0.01))
  for (let i = 0; i < 25; i++) bar(p * (1 + (i % 2 ? 0.002 : -0.002)))
  const S = raw.length
  bar(p * 1.03)
  for (let i = 0; i < 8; i++) bar(p * 1.015)
  const range = raw.length
  for (let i = 0; i < 12; i++) bar(p * (1 + (i % 2 ? 0.001 : -0.001)))
  const brk = raw.length
  const lo = Math.min(...raw.slice(brk - 10).map((x) => Math.min(x.o, x.c) * 0.997))
  bar(lo * 0.995)
  for (let i = 0; i < 3; i++) bar(p)
  const step = 14_400_000
  const t0 = Date.now() - raw.length * step
  const hist: Bar[] = raw.map((x, i) => ({ t: t0 + i * step, o: x.o, h: Math.max(x.o, x.c) * 1.003, l: Math.min(x.o, x.c) * 0.997, c: x.c, v: 100, tb: 50 }))
  return { hist, S, range, brk }
}

async function trendTrader(over: Partial<TraderConfig> = {}, up = true) {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const h = trendHist(up)
  const state = { idx: h.S + 1 }
  const base = setup('hybrid').cfg
  const cfg: TraderConfig = { ...base, strategy: 'trend', bars: async (_s, _i, n) => h.hist.slice(0, state.idx).slice(-n), ...over }
  const t = new SymbolTrader(ex, store, 'BTCUSDT', cfg)
  await t.init()
  // Hybrid's walk-forward gate judges the model; it must not stop F1.
  t.gate = { ...t.gate!, pass: false }
  ex.price = h.hist[state.idx - 1].c
  const row = async () => (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  /** The next bar closes: the price moves to its close (stops trigger), then a tick. */
  const nextBar = async () => {
    state.idx++
    ex.move(h.hist[state.idx - 1].c)
    await t.tick(true, Date.now())
  }
  return { store, ex, pg, t, h, state, row, nextBar }
}

test('trend: the scenario has an F1 signal at the breakout bar only, and none below EMA(300)', () => {
  const { hist, S } = trendHist()
  const at = (k: number) => {
    const b = hist.slice(0, k + 1)
    return trendSignal(b, trendIndicators(b), k)
  }
  assert.equal(at(S), true, 'breakout above the 20-bar high and EMA(300)')
  assert.equal(at(S - 1), false, 'flat stretch: no breakout')
  const down = trendHist(false)
  const b = down.hist.slice(0, down.S + 1)
  assert.ok(b[down.S].c > highPrev(b, down.S, 20), 'the downtrend breakout clears its 20-bar high')
  assert.equal(trendSignal(b, trendIndicators(b), down.S), false, '... but is below EMA(300)')
})

test('trend: a breakout opens a long with an exchange stop only (no target), even with the model gate failed', async () => {
  const { store, ex, t, row, h } = await trendTrader()
  await t.tick(true, Date.now())
  const open = await store.openTrade('BTCUSDT')
  assert.ok(open, 'F1 trade opened')
  assert.equal(open!.mode, 'trend')
  assert.equal(open!.side, 1)
  assert.equal(open!.tp, null)
  assert.equal(ex.algo.length, 1, 'one stop on the exchange')
  assert.equal(ex.limits.length, 0, 'no take-profit order')
  assert.ok(ex.pos.amt > 0)
  const b = h.hist.slice(0, h.S + 1)
  const atr = trendIndicators(b).atr[h.S]
  assert.ok(Math.abs(open!.entry - 3 * atr - open!.sl) < 0.011, `stop 3 ATR below the fill: ${open!.sl} vs ${open!.entry - 3 * atr}`)
  assert.equal(open!.initialSl, open!.sl)
  assert.equal(ex.algo[0].trigger, open!.sl)
  // 0.5% at the planned stop distance; the stop's tick rounding moves it a hair.
  assert.ok(Math.abs(open!.riskUsd / 10_000 - 0.005) < 0.00002, 'risk 0.5%: ' + open!.riskUsd)
  const r = await row()
  assert.equal(r.model_id, null)
  assert.equal(r.p_win, null)
  assert.equal(r.planned_tp, null)
  assert.match(String(r.decision), /^F1: close/)
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.equal(plan?.strategy, 'trend')
  assert.equal(plan?.status, 'opened')
  assert.equal(plan?.side, 'LONG')
  assert.equal(plan?.tp, null)
  assert.equal(plan?.sl, open!.sl)
  assert.equal(plan?.tradeId, open!.id)
})

test('trend: no entry below EMA(300), even on a 20-bar breakout', async () => {
  const { store, ex, t } = await trendTrader({}, false)
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0)
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.equal(plan?.status, 'skipped')
  assert.match(plan!.reasons[0], /no F1 entry: close .* not above EMA\(300\)/)
})

test('trend: the trail raises the stop (new one placed before the old is cancelled), never lowers it; the exit rule closes', async () => {
  const { store, ex, t, h, state, row, nextBar } = await trendTrader()
  await t.tick(true, Date.now())
  const first = (await store.openTrade('BTCUSDT'))!
  let raised = 0
  let last = first
  while (state.idx < h.brk) {
    const before = (await store.openTrade('BTCUSDT'))!
    ex.ops = []
    await nextBar()
    const now = (await store.openTrade('BTCUSDT'))!
    assert.ok(now, 'still open at bar ' + state.idx)
    assert.ok(now.sl >= before.sl, `never lower: ${before.sl} → ${now.sl}`)
    if (now.sl > before.sl) {
      raised++
      assert.deepEqual(ex.ops, ['place:' + now.slAlgoId, 'cancel:' + before.slAlgoId], 'new stop first, then the old one cancelled')
    } else assert.deepEqual(ex.ops, [])
    assert.equal(ex.algo.length, 1, 'exactly one stop on the exchange')
    assert.equal(ex.algo[0].trigger, now.sl)
    assert.ok(now.trailHigh! >= Math.max(...h.hist.slice(h.S + 1, state.idx).map((x) => x.h)) - 1e-9, 'highest high since entry')
    last = now
  }
  assert.ok(raised >= 3, 'raised on the run-up: ' + raised)
  assert.ok(last.sl > first.entry, 'trailed into profit')
  // The close below the 10-bar low (still above the stop): a market close by the rule.
  await nextBar()
  assert.equal(ex.pos.amt, 0, 'flattened by the exit rule')
  await t.tick(true, Date.now())
  const r = await row()
  assert.equal(r.status, 'closed')
  assert.equal(r.exit_reason, 'signal')
  assert.ok(Number(r.r_multiple) > 0, 'a winner: ' + r.r_multiple)
  assert.ok(Number(r.mfe_r) > 1, 'MFE in R of the initial stop: ' + r.mfe_r)
  assert.equal(ex.algo.length, 0, 'stop cancelled after the close')
})

test('trend: a raised stop that cannot be placed keeps the old one, and the next bar catches up', async () => {
  const { store, ex, t, state, h, nextBar } = await trendTrader()
  await t.tick(true, Date.now())
  const first = (await store.openTrade('BTCUSDT'))!
  ex.failStop = true
  while (state.idx < h.range) await nextBar()
  let open = (await store.openTrade('BTCUSDT'))!
  assert.equal(open.sl, first.sl, 'old stop kept')
  assert.deepEqual(ex.algo.map((a) => a.algoId), [first.slAlgoId], 'and still on the exchange')
  ex.failStop = false
  await nextBar()
  open = (await store.openTrade('BTCUSDT'))!
  assert.ok(open.sl > first.sl, 'raised once placing works again')
  assert.deepEqual(ex.algo.map((a) => a.algoId), [open.slAlgoId])
})

test('positions: one shared read per tick for every market, no per-market read on the ticks in between', async () => {
  const { db } = await freshDb()
  const store = new BotStore(db)
  const h = trendHist()
  const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT']
  const exes = new Map(SYMS.map((s) => [s, new FakeExchange()]))
  // One "account" read covers every market (the fakes stand in for one exchange each).
  const book = new PositionBook(async () => Promise.all(SYMS.map((s) => exes.get(s)!.position(s).finally(() => exes.get(s)!.positionCalls--))))
  const cfg: TraderConfig = { ...setup('hybrid').cfg, strategy: 'trend', bars: async (_s, _i, n) => h.hist.slice(0, h.S).slice(-n), positions: book }
  const traders = SYMS.map((s) => new SymbolTrader(exes.get(s)!, store, s, cfg))
  for (const t of traders) await t.init()
  for (let k = 1; k <= 3; k++) {
    book.clear() // bot.ts: at each tick start
    for (const t of tickOrder(traders)) await t.tick(true, Date.now())
    assert.equal(book.reads, k, 'one positions request per tick')
  }
  for (const e of exes.values()) assert.equal(e.positionCalls, 0, 'no per-market positionRisk read')
  // A market the shared read does not list (or a failed read) is read on its own, never assumed flat.
  const lean = new PositionBook(async () => [])
  const t = new SymbolTrader(exes.get('BTCUSDT')!, store, 'BTCUSDT', { ...cfg, positions: lean })
  await t.init()
  exes.get('BTCUSDT')!.pos = { amt: 0.5, entry: 100 }
  await t.tick(true, Date.now())
  assert.equal(exes.get('BTCUSDT')!.positionCalls, 1)
  assert.equal(exes.get('BTCUSDT')!.pos.amt, 0, 'the unrecorded position was seen and flattened')
})

test('positions: after its own orders a trader re-reads its market, not the shared snapshot', async () => {
  // Snapshot taken before the entry: flat. The stop is rejected after the fill; the
  // emergency close must see the real (long) position, so it reads the market itself.
  let snapshot: Position | null = null
  const book = new PositionBook(async () => [snapshot!])
  const { ex, t } = await trendTrader({ positions: book })
  snapshot = { symbol: 'BTCUSDT', amt: 0, entry: 0, mark: ex.price, unrealized: 0 }
  ex.positionCalls = 0
  ex.failStop = true
  await t.tick(true, Date.now())
  assert.equal(book.reads, 1)
  assert.equal(ex.positionCalls, 1, 'one fresh read of this market after the failed stop')
  assert.equal(ex.pos.amt, 0, 'no unprotected position')
  assert.ok(ex.log.length >= 2, 'entered, then closed')
  assert.equal(snapshot.amt, 0, 'the stale snapshot was not used for the close')
})

test('trend: a stop hit closes as sl (initial stop) or trail (raised stop)', async () => {
  {
    const { store, ex, t, row } = await trendTrader()
    await t.tick(true, Date.now())
    const open = (await store.openTrade('BTCUSDT'))!
    ex.move(open.sl - 0.01)
    assert.equal(ex.pos.amt, 0)
    await t.tick(true, Date.now())
    const r = await row()
    assert.equal(r.exit_reason, 'sl')
    assert.ok(Number(r.r_multiple) < -1 && Number(r.r_multiple) > -1.2, 'about -1R: ' + r.r_multiple)
  }
  {
    const { store, ex, t, row, state, h, nextBar } = await trendTrader()
    await t.tick(true, Date.now())
    while (state.idx < h.range) await nextBar()
    const open = (await store.openTrade('BTCUSDT'))!
    assert.ok(open.sl > open.initialSl!)
    ex.move(open.sl - 0.01)
    await t.tick(true, Date.now())
    const r = await row()
    assert.equal(r.exit_reason, 'trail')
    assert.ok(Number(r.r_multiple) > 0, 'trailed stop in profit: ' + r.r_multiple)
  }
})

test('trend: the portfolio heat cap still applies', async () => {
  const { store, ex, t } = await trendTrader({ setup: { ...setup('hybrid').cfg.setup, maxOpen: 10 } })
  await openElsewhere(store, t.model!.id, 3, 50)
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0, 'no order sent')
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.equal(plan?.status, 'skipped')
  assert.match(plan!.reasons[0], /^portfolio heat: long risk 1\.50% open/)
})

test('trend: the model keeps deciding on every bar as shadow trades only, beside the F1 position', async () => {
  const { store, ex, t, pg, nextBar } = await trendTrader({ learn: { ...DEFAULT_TRADER.learn, shadowMaxOpen: 20 } })
  await t.tick(true, Date.now())
  assert.ok(await store.openTrade('BTCUSDT'))
  for (let k = 0; k < 3; k++) await nextBar()
  const sh = (await pg.query<{ reject_reason: string }>('select reject_reason from bot_shadow_trades order by id')).rows
  assert.equal(sh.length, 4, 'one shadow per bar, while the F1 trade is open')
  assert.ok(sh.every((s) => /strategy ml is in shadow: the model trades on paper only/.test(s.reject_reason)), sh.map((s) => s.reject_reason).join(' | '))
  const real = (await pg.query<{ mode: string }>('select mode from bot_trades')).rows
  assert.deepEqual(real.map((x) => x.mode), ['trend'], 'the model placed no real order')
  assert.equal(ex.limits.length, 0)
  // The model's idea does not overwrite F1's plan.
  assert.equal((await store.getState<TradePlan | null>('plan:BTCUSDT', null))?.strategy, 'trend')
})

test('strategy ml (the default) is unchanged on the same bars: the model trades, with a target', async () => {
  const { store, ex, t, pg } = await trendTrader({ strategy: 'ml', mode: 'explore' })
  await t.tick(true, Date.now())
  const open = await store.openTrade('BTCUSDT')
  assert.ok(open, 'model trade opened')
  assert.equal(open!.mode, 'explore')
  assert.equal(typeof open!.tp, 'number')
  assert.equal(ex.limits.length, 1, 'target on the book')
  assert.equal((await pg.query('select id from bot_shadow_trades')).rows.length, 0)
  assert.equal(DEFAULT_TRADER.strategy, undefined, 'the default is the model')
})

// ---- several strategies (BOT_STRATEGIES) ----

type Row = Record<string, unknown>

test('multi: a strategy in shadow never orders — one F1 shadow at a time, resolved by F1’s own exit rule', async () => {
  const { store, ex, t, pg, h, state, nextBar } = await trendTrader({ strategies: [{ id: 'f1', state: 'shadow' }, { id: 'ml', state: 'shadow' }] })
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0, 'no order')
  const f1 = async () => (await pg.query<Row>(`select * from bot_shadow_trades where strategy = 'f1' order by id`)).rows
  let sh = await f1()
  assert.equal(sh.length, 1)
  assert.equal(sh[0].status, 'open')
  assert.equal(sh[0].entry, h.hist[h.S].c)
  assert.equal(sh[0].tp, null)
  assert.equal(sh[0].horizon, null)
  assert.equal(sh[0].model_id, null)
  assert.equal(sh[0].p_raw, null)
  assert.match(String(sh[0].reject_reason), /strategy f1 is in shadow/)
  assert.match(String(sh[0].decision), /^F1: close/)
  const atr = trendIndicators(h.hist.slice(0, h.S + 1)).atr[h.S]
  assert.ok(Math.abs(Number(sh[0].entry) - Number(sh[0].sl) - 3 * atr) < 1e-9, 'initial stop 3 ATR below')
  const ml = (await pg.query<Row>(`select reject_reason from bot_shadow_trades where strategy = 'ml'`)).rows
  assert.ok(ml.length >= 1 && ml.every((s) => /strategy ml is in shadow/.test(String(s.reject_reason))))
  // The run-up: more breakouts, but one F1 shadow at a time; then the close under the 10-bar low ends it.
  while (state.idx < h.brk) await nextBar()
  sh = await f1()
  assert.equal(sh.length, 1)
  assert.equal(sh[0].status, 'open', 'trailing, still open')
  await nextBar()
  sh = await f1()
  assert.equal(sh[0].status, 'closed')
  assert.equal(sh[0].exit_reason, 'signal')
  assert.equal(sh[0].exit, h.hist[h.brk].c)
  assert.ok(Number(sh[0].r_net) > 0 && Number(sh[0].r_net) < Number(sh[0].r_gross), 'a winner, after costs: ' + sh[0].r_net)
  assert.equal(sh[0].bars_held, h.brk - h.S)
  assert.ok(Number(sh[0].mfe_r) > 1)
  assert.equal((await pg.query('select id from bot_trades')).rows.length, 0, 'never a real trade')
  // Rule shadows have no model probability: the calibration does not learn from them.
  assert.ok((await store.unlearned('BTCUSDT')).every((u) => u.kind !== 'shadow' || !Number.isNaN(u.pRaw)))
  assert.equal((await pg.query(`select id from bot_shadow_trades where strategy = 'f1' and learned`)).rows.length, 0)
})

test('multi: one real position per market — the first live strategy by priority takes it, the other shadows', async () => {
  {
    const { pg, t, ex } = await trendTrader({ mode: 'explore', strategies: [{ id: 'ml', state: 'live' }, { id: 'f1', state: 'live' }] })
    await t.tick(true, Date.now())
    const real = (await pg.query<Row>('select strategy, mode, tp from bot_trades')).rows
    assert.equal(real.length, 1)
    assert.equal(real[0].strategy, 'ml')
    assert.equal(real[0].mode, 'explore')
    assert.equal(ex.limits.length, 1, 'the model’s bracket')
    const f1 = (await pg.query<Row>(`select reject_reason from bot_shadow_trades where strategy = 'f1'`)).rows
    assert.equal(f1.length, 1, 'F1’s breakout became a shadow')
    assert.match(String(f1[0].reject_reason), /one real position per market: strategy ml holds BTCUSDT/)
  }
  {
    const { pg, t } = await trendTrader({ mode: 'explore', learn: { ...DEFAULT_TRADER.learn, shadowMaxOpen: 20 }, strategies: [{ id: 'f1', state: 'live' }, { id: 'ml', state: 'live' }] })
    await t.tick(true, Date.now())
    const real = (await pg.query<Row>('select strategy, mode from bot_trades')).rows
    assert.deepEqual(real, [{ strategy: 'f1', mode: 'trend' }], 'F1 first: its trade, the model none')
    const ml = (await pg.query<Row>(`select reject_reason from bot_shadow_trades where strategy = 'ml'`)).rows
    assert.equal(ml.length, 1)
    assert.match(String(ml[0].reject_reason), /one real position per market: strategy f1 holds BTCUSDT/)
    assert.equal((await pg.query(`select id from bot_shadow_trades where strategy = 'f1'`)).rows.length, 0, 'F1 took it for real: no F1 shadow')
  }
})

test('multi: a demoted strategy (health in bot_state) shadows its signal; on probation it still trades for real', async () => {
  const health = (state: string) => ({ id: 'f1', state, configured: 'live', since: 0, segmentStart: 0, hasBands: true, stats: {}, history: [], updated: 0 })
  {
    const { store, ex, t, pg } = await trendTrader()
    await store.setState('strategy:f1', health('shadow'))
    await t.tick(true, Date.now())
    assert.equal(await store.openTrade('BTCUSDT'), null)
    assert.equal(ex.pos.amt, 0)
    const f1 = (await pg.query<Row>(`select reject_reason from bot_shadow_trades where strategy = 'f1'`)).rows
    assert.equal(f1.length, 1)
    assert.match(String(f1[0].reject_reason), /strategy f1 is in shadow/)
  }
  {
    const { store, t, row } = await trendTrader()
    await store.setState('strategy:f1', health('probation'))
    await t.tick(true, Date.now())
    const open = await store.openTrade('BTCUSDT')
    assert.ok(open, 'probation: still real')
    assert.equal(open!.strategy, 'f1')
    assert.equal((await row()).strategy, 'f1', 'the journal row names its strategy')
  }
  {
    // A record from another configuration does not apply: the configured state does.
    const { store, t } = await trendTrader()
    await store.setState('strategy:f1', { ...health('shadow'), configured: 'shadow' })
    await t.tick(true, Date.now())
    assert.ok(await store.openTrade('BTCUSDT'))
  }
})

test('multi: probation halves the risk per trade', async () => {
  const health = { id: 'f1', state: 'probation', configured: 'live', since: 0, segmentStart: 0, hasBands: true, stats: {}, history: [], updated: 0 }
  const { store, t } = await trendTrader()
  await store.setState('strategy:f1', health)
  await t.tick(true, Date.now())
  const open = (await store.openTrade('BTCUSDT'))!
  assert.ok(Math.abs(open.riskUsd / 10_000 - 0.0025) < 0.00002, 'risk 0.25%: ' + open.riskUsd)
  const plan = await store.getState<TradePlan | null>('plan:BTCUSDT', null)
  assert.ok(Math.abs(plan!.live!.riskPct - 0.0025) < 0.00002, 'the plan shows the halved risk')
})

// ---- C2: the bear-market short, reading BTC ----

/** The trend scenario upside down: a downtrend, a breakdown at S, a slide, a range and a close above it. */
const invert = (h: Bar[]) => h.map((x) => ({ ...x, o: 1e4 / x.o, c: 1e4 / x.c, h: 1e4 / x.l, l: 1e4 / x.h }))

async function c2Trader(symbol: string, btcUp: boolean, over: Partial<TraderConfig> = {}) {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const h = trendHist()
  const own = invert(h.hist)
  const btc = btcUp ? h.hist : own
  const state = { idx: h.S + 1 }
  const fetched: string[] = []
  const cfg: TraderConfig = {
    ...setup('hybrid').cfg,
    strategies: [{ id: 'c2', state: 'live' }],
    bars: async (s, _i, n) => (fetched.push(s), (s === symbol ? own : s === 'BTCUSDT' ? btc : []).slice(0, state.idx).slice(-n)),
    ...over,
  }
  const t = new SymbolTrader(ex, store, symbol, cfg)
  await t.init()
  ex.price = own[state.idx - 1].c
  const nextBar = async () => {
    state.idx++
    ex.move(own[state.idx - 1].c)
    await t.tick(true, Date.now())
  }
  return { store, ex, pg, t, h, own, state, fetched, nextBar }
}

test('C2 live: a breakdown with BTC below its EMA opens a short with a stop above; it trails down and the exit rule closes it', async () => {
  const { store, ex, t, pg, h, own, state, fetched, nextBar } = await c2Trader('ETHUSDT', false)
  assert.equal(t.mlOn, false, 'no model on this run')
  assert.equal(t.model, null)
  await t.tick(true, Date.now())
  assert.ok(fetched.includes('BTCUSDT'), 'BTC bars read for the filter')
  const open = (await store.openTrade('ETHUSDT'))!
  assert.ok(open, 'C2 trade opened')
  assert.equal(open.side, -1)
  assert.equal(open.strategy, 'c2')
  assert.equal(open.tp, null)
  assert.ok(ex.pos.amt < 0, 'short')
  assert.ok(open.sl > open.entry, 'stop above the entry')
  const atr = trendIndicators(own.slice(0, h.S + 1)).atr[h.S]
  assert.ok(Math.abs(open.sl - open.entry - 3 * atr) < 0.011, 'stop 3 ATR above')
  assert.equal(ex.algo[0].side, 'BUY')
  assert.equal((await store.getState<TradePlan | null>('plan:ETHUSDT', null))?.side, 'SHORT')
  let lowered = 0
  while (state.idx < h.brk) {
    const before = (await store.openTrade('ETHUSDT'))!
    await nextBar()
    const now = (await store.openTrade('ETHUSDT'))!
    assert.ok(now.sl <= before.sl, `never higher: ${before.sl} → ${now.sl}`)
    if (now.sl < before.sl) lowered++
    assert.equal(ex.algo.length, 1)
  }
  assert.ok(lowered >= 3, 'trailed down on the slide: ' + lowered)
  await nextBar()
  assert.equal(ex.pos.amt, 0, 'closed by the exit rule')
  await t.tick(true, Date.now())
  const row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.exit_reason, 'signal')
  assert.equal(row.strategy, 'c2')
  assert.ok(Number(row.r_multiple) > 0, 'a winner: ' + row.r_multiple)
  assert.equal((await pg.query('select id from bot_models')).rows.length, 0, 'no model trained')
})

test('C2: no short while BTC is above its EMA(300), even on the same breakdown', async () => {
  const { store, ex, t } = await c2Trader('ETHUSDT', true)
  await t.tick(true, Date.now())
  assert.equal(await store.openTrade('ETHUSDT'), null)
  assert.equal(ex.pos.amt, 0)
  const plan = await store.getState<TradePlan | null>('plan:ETHUSDT', null)
  assert.match(plan!.reasons[0], /^no C2 entry: BTC is above its EMA\(300\)/)
})

test('C2 on BTCUSDT reads its own bars as the BTC filter', async () => {
  const { store, t, fetched } = await c2Trader('BTCUSDT', false)
  await t.tick(true, Date.now())
  assert.ok(await store.openTrade('BTCUSDT'))
  assert.ok(fetched.every((s) => s === 'BTCUSDT'))
})

// ---- C6: F1's signal through the model's take / skip ----

/** A model whose p is always 0.5 (no trees): base 0.4 takes every candidate, 0.6 none. */
const c6Stub = (base: number): C6Model => ({ v: 1, createdAt: Date.now(), cutoff: 0, base, n: 100, symbols: ['BTCUSDT'], funding: [], nFeatures: FEATURES_V2.length, gbdt: { base: 0, trees: [] } })

async function c6Trader(model: C6Model | null) {
  c6State.reset()
  const r = await trendTrader({ strategies: [{ id: 'f1', state: 'live' }, { id: 'c6', state: 'shadow' }] })
  // The scenario's uptrend leaves an F1 trade open into the breakout: a 5% drop
  // 30 bars before it stops that trade out, so the breakout is a C6 candidate.
  const k0 = r.h.S - 30
  const prev = r.h.hist[k0 - 1].c
  for (const x of r.h.hist.slice(k0)) Object.assign(x, { o: x.o * 0.95, h: x.h * 0.95, l: x.l * 0.95, c: x.c * 0.95 })
  Object.assign(r.h.hist[k0], { o: prev, h: prev * 1.003 })
  r.ex.price = r.h.hist[r.h.S].c
  c6State.loaded = true
  c6State.model = model
  return r
}

test('C6 shadow: the model takes the F1 signal → a c6 shadow trade beside the real F1 trade', async () => {
  const { store, pg, t, h } = await c6Trader(c6Stub(0.4))
  try {
    assert.equal(f1FlatAt(h.hist.slice(0, h.S + 1), h.S), true, 'the breakout is a C6 candidate')
    await t.tick(true, Date.now())
    assert.equal((await store.openTrade('BTCUSDT'))?.strategy, 'f1', 'F1 trades for real')
    const rows = (await pg.query<Row>(`select * from bot_shadow_trades where strategy = 'c6'`)).rows
    assert.equal(rows.length, 1)
    assert.match(String(rows[0].reject_reason), /strategy c6 is in shadow/)
    const f = rows[0].features as Record<string, number>
    assert.equal(f.c6P, 0.5)
    assert.equal(f.c6Base, 0.4)
    assert.match(String(rows[0].decision), /^C6 \(F1 entry\)/)
  } finally {
    c6State.reset()
  }
})

test('C6: a skipped signal is no trade at all, one event line; no model, no decision', async () => {
  for (const [model, why] of [
    [c6Stub(0.6), /c6: signal skipped — model p 0\.500 < base rate 0\.600/],
    [null, /c6: signal skipped — no model yet/],
  ] as const) {
    const { store, pg, t } = await c6Trader(model)
    try {
      await t.tick(true, Date.now())
      assert.equal((await store.openTrade('BTCUSDT'))?.strategy, 'f1', 'F1 is not affected')
      assert.equal((await pg.query(`select id from bot_shadow_trades where strategy = 'c6'`)).rows.length, 0)
      const ev = (await pg.query<{ msg: string }>(`select msg from bot_events where msg like 'c6:%'`)).rows.map((r) => r.msg)
      assert.equal(ev.length, 1, ev.join(' | '))
      assert.match(ev[0], why)
    } finally {
      c6State.reset()
    }
  }
})

// ---- F1X: F1 with a 15-bar exit, in shadow ----

test('F1X shadow: never an order â€” its shadow sits beside the real F1 trade, and its own shadow is independent of F1â€™s', async () => {
  {
    const { store, ex, t, pg } = await trendTrader({ strategies: [{ id: 'f1', state: 'live' }, { id: 'f1x', state: 'shadow' }, { id: 'ml', state: 'shadow' }] })
    await t.tick(true, Date.now())
    assert.equal((await store.openTrade('BTCUSDT'))?.strategy, 'f1', 'F1 trades for real, as before')
    assert.equal(ex.algo.length, 1, 'one exchange stop: F1â€™s')
    const real = (await pg.query<Row>('select strategy from bot_trades')).rows
    assert.deepEqual(real, [{ strategy: 'f1' }])
    const rows = (await pg.query<Row>(`select * from bot_shadow_trades where strategy = 'f1x'`)).rows
    assert.equal(rows.length, 1)
    assert.match(String(rows[0].reject_reason), /strategy f1x is in shadow/)
    assert.match(String(rows[0].decision), /^F1X: close/)
    assert.ok('low15' in (rows[0].features as Record<string, number>))
  }
  {
    const { ex, t, pg, h, state, nextBar } = await trendTrader({ strategies: [{ id: 'f1', state: 'shadow' }, { id: 'f1x', state: 'shadow' }] })
    await t.tick(true, Date.now())
    const sh = async (id: string) => (await pg.query<Row>(`select * from bot_shadow_trades where strategy = $1 order by id`, [id])).rows
    assert.equal((await sh('f1')).length, 1)
    assert.equal((await sh('f1x')).length, 1, 'both strategies shadow the same breakout')
    assert.equal((await sh('f1x'))[0].entry, h.hist[h.S].c)
    while (state.idx <= h.brk) await nextBar()
    const f1 = (await sh('f1'))[0]
    const f1x = (await sh('f1x'))[0]
    assert.equal(f1.status, 'closed')
    assert.equal(f1.exit_reason, 'signal', 'F1: the close under the 10-bar low')
    assert.ok(f1x.status === 'open' || f1x.bars_held !== f1.bars_held, 'F1X does not exit on F1â€™s 10-bar low')
    assert.equal(ex.pos.amt, 0, 'never an order')
    assert.equal((await pg.query('select id from bot_trades')).rows.length, 0, 'never a real trade')
  }
})

test('the model runs only on its own markets: none of its pipeline elsewhere', async () => {
  const strategies = [{ id: 'f1', state: 'live' as const }, { id: 'ml', state: 'shadow' as const, symbols: ['BTCUSDT'] }]
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const h = trendHist()
  const cfg: TraderConfig = { ...setup('hybrid').cfg, strategies, bars: async (_s, _i, n) => h.hist.slice(0, h.S + 1).slice(-n) }
  const xrp = new SymbolTrader(ex, store, 'XRPUSDT', cfg)
  await xrp.init()
  assert.equal(xrp.mlOn, false)
  assert.equal(xrp.model, null)
  assert.equal((await pg.query('select id from bot_models')).rows.length, 0, 'no training, no walk-forward')
  ex.price = h.hist[h.S].c
  await xrp.tick(true, Date.now())
  assert.ok(await store.openTrade('XRPUSDT'), 'F1 still trades there')
  assert.equal((await pg.query(`select id from bot_shadow_trades where strategy = 'ml'`)).rows.length, 0, 'no model shadow')
  assert.equal(await store.getState('learn:XRPUSDT', null), null, 'no learning state')
  const btc = new SymbolTrader(new FakeExchange(), store, 'BTCUSDT', cfg)
  assert.equal(btc.mlOn, true)
})

test('24 markets: one bar request per market per candle, idle ticks fetch nothing; same-bar entries take the heat cap in symbol order', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const h = trendHist()
  // The whole scenario: its last bar is the latest closed one, as live.
  const hist = h.hist.slice(0, h.S + 1)
  const stepMs = 14_400_000
  const shift = Math.floor(Date.now() / stepMs) * stepMs - stepMs - hist[hist.length - 1].t
  const bars = hist.map((x) => ({ ...x, t: x.t + shift }))
  const asked: string[] = []
  const cache = new BarCache(async (s, _i, n) => (asked.push(s + ':' + n), bars.slice(-n)))
  const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AAVEUSDT', 'ADAUSDT', 'ARBUSDT', 'AVAXUSDT', 'BCHUSDT', 'DOTUSDT', 'ETCUSDT', 'INJUSDT', 'NEARUSDT', 'UNIUSDT', 'APTUSDT', 'ATOMUSDT', 'DOGEUSDT', 'FILUSDT', 'LINKUSDT', 'LTCUSDT', 'OPUSDT', 'SUIUSDT', 'TRXUSDT', 'XRPUSDT']
  const cfg: TraderConfig = {
    ...setup('hybrid').cfg,
    setup: { ...setup('hybrid').cfg.setup, maxOpen: 10 },
    strategies: [{ id: 'f1', state: 'live' }, { id: 'c2', state: 'shadow' }, { id: 'ml', state: 'shadow', symbols: ['BTCUSDT'] }],
    barCache: cache,
  }
  // One simulated account per market (the fake holds a single position), all at the same equity.
  const traders = SYMS.map((s) => {
    const e = new FakeExchange()
    e.price = bars[bars.length - 1].c
    return new SymbolTrader(e, store, s, cfg)
  })
  for (const t of traders) await t.init()
  // The model's own start-up (BTCUSDT only) read its training history; count from here.
  assert.deepEqual(asked, ['BTCUSDT:1400'], 'only the model market trained')
  const base = cache.requests
  const t0 = performance.now()
  for (const t of tickOrder(traders)) await t.tick(true, Date.now())
  const decide = performance.now() - t0
  assert.equal(cache.requests - base, traders.length, 'one request per market for the new bar: ' + asked.join(' '))
  const t1 = performance.now()
  for (let k = 0; k < 3; k++) for (const t of tickOrder(traders)) await t.tick(true, Date.now())
  const idle = (performance.now() - t1) / 3
  assert.equal(cache.requests - base, traders.length, 'no request on the ticks in between')
  // Well under the 15 s tick, even here (in-process Postgres, every market deciding at once).
  assert.ok(decide < 15_000 && idle < 5_000, `decision tick ${decide.toFixed(0)} ms, idle tick ${idle.toFixed(0)} ms`)
  // The heat cap (1.5% per side at ~0.5% each; tick rounding can put a stop a hair further) takes the
  // first longs in symbol order, every later one is blocked.
  const real = (await pg.query<{ symbol: string }>('select symbol from bot_trades order by id')).rows.map((r) => r.symbol)
  assert.ok(real.length >= 2 && real.length <= 3, real.join())
  assert.deepEqual(real, [...traders.map((t) => t.symbol)].sort().slice(0, real.length))
  const blocked = (await pg.query<{ reject_reason: string }>(`select reject_reason from bot_shadow_trades where strategy = 'f1'`)).rows
  assert.equal(blocked.length, traders.length - real.length)
  assert.ok(blocked.every((r) => /portfolio heat/.test(r.reject_reason)))
})

test('multi: a live strategy blocked by a risk rule records the signal as its shadow', async () => {
  const { store, ex, t, pg } = await trendTrader()
  await t.tick(false, Date.now())
  assert.equal(await store.openTrade('BTCUSDT'), null)
  assert.equal(ex.pos.amt, 0)
  const f1 = (await pg.query<Row>(`select reject_reason from bot_shadow_trades where strategy = 'f1'`)).rows
  assert.equal(f1.length, 1)
  assert.match(String(f1[0].reject_reason), /risk limits/)
  assert.equal((await store.getState<TradePlan | null>('plan:BTCUSDT', null))?.strategyId, 'f1')
})

// ---- never orphan an open trade ----

/** A model (ML bracket) trade already open on the exchange and in the database. */
async function openMlTrade(store: BotStore, ex: FakeExchange, symbol: string, barTime: number, price: number, modelId: number | null) {
  ex.price = price
  ex.pos = { amt: 1, entry: price }
  ex.log.push({ id: 900, orderId: 900, time: barTime + 1000, side: 'BUY', price, qty: 1, realizedPnl: 0, commission: 0.05, commissionAsset: 'USDT' })
  const id = await store.insertTrade({
    symbol, modelId, mode: 'explore', venue: 'fake', side: 1, openedAt: barTime + 1000, barTime, entry: price, qty: 1,
    sl: price * 0.97, tp: price * 1.05, atr: price * 0.02, riskUsd: price * 0.03, pWin: 0.5, evR: 0.1, features: {}, entryOrderId: 900,
  })
  ex.algo.push({ algoId: 901, side: 'SELL', trigger: price * 0.97 })
  ex.limits.push({ orderId: 902, side: 'SELL', qty: 1, price: price * 1.05 })
  await store.setLegs(id, 902, 901)
  return id
}

test('manage-only: an open XAU trade outside BOT_SYMBOLS is managed to its time exit, and nothing new opens there', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const ex = new FakeExchange()
  const h = trendHist()
  const step = 14_400_000
  const barTime = h.hist[h.S].t
  await openMlTrade(store, ex, 'XAUUSDT', barTime, 100, null)
  // bot.ts: the symbols with an open trade that are not in BOT_SYMBOLS get a manage-only trader.
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
  assert.deepEqual((await store.openSymbols()).filter((s) => !symbols.includes(s)), ['XAUUSDT'])
  assert.equal((await store.openRisk()).long, 3, 'its open risk still counts in the heat cap')
  const cfg: TraderConfig = { ...setup('hybrid').cfg, strategy: 'trend', manageOnly: true, bars: async (_s, _i, n) => h.hist.slice(0, h.S + 1).slice(-n) }
  const t = new SymbolTrader(ex, store, 'XAUUSDT', cfg)
  await t.init()
  assert.equal(t.model, null, 'no model trained')
  // Inside its horizon: kept, with its own stop and target.
  await t.tick(true, barTime + 2 * step)
  assert.equal(ex.pos.amt, 1)
  assert.ok(await store.openTrade('XAUUSDT'))
  // Past the bracket's horizon: the time exit closes it.
  await t.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0, 'time exit')
  await t.tick(true, Date.now())
  const row = (await pg.query<Record<string, unknown>>('select * from bot_trades order by id desc limit 1')).rows[0]
  assert.equal(row.status, 'closed')
  assert.equal(row.exit_reason, 'time')
  // Flat now (the bars show an F1 breakout): it stays idle.
  for (let k = 0; k < 3; k++) await t.tick(true, Date.now())
  assert.equal((await pg.query('select id from bot_trades')).rows.length, 1, 'no new real trade')
  assert.equal((await pg.query('select id from bot_shadow_trades')).rows.length, 0, 'no shadow trade')
  assert.equal((await pg.query('select id from bot_models')).rows.length, 0, 'no learning, no walk-forward')
  assert.equal(ex.pos.amt, 0)
})

test('trend: a model trade open from before the switch keeps its bracket — time exit, no trail, no F1 entry beside it', async () => {
  const { store, ex, t, pg, h, state } = await trendTrader()
  const step = 14_400_000
  const barTime = h.hist[h.S].t
  const id = await openMlTrade(store, ex, 'BTCUSDT', barTime, h.hist[h.S].c, t.model!.id)
  const before = (await store.openTrade('BTCUSDT'))!
  ex.ops = []
  // Several new bars inside the horizon, on the F1 breakout and run-up.
  for (let k = 0; k < 4; k++) {
    state.idx++
    ex.price = h.hist[state.idx - 1].c
    await t.tick(true, barTime + (k + 2) * step)
  }
  const still = (await store.openTrade('BTCUSDT'))!
  assert.equal(still.id, id)
  assert.equal(still.sl, before.sl, 'no trail on a model trade')
  assert.deepEqual(ex.ops, [], 'no stop replaced')
  assert.equal((await pg.query('select id from bot_trades')).rows.length, 1, 'no F1 entry while it is open')
  // Past its horizon: the time exit.
  await t.tick(true, Date.now())
  assert.equal(ex.pos.amt, 0)
  await t.tick(true, Date.now())
  const row = (await pg.query<Record<string, unknown>>('select * from bot_trades where id = $1', [id])).rows[0]
  assert.equal(row.exit_reason, 'time')
})
