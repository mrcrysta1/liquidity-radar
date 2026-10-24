// The whole trading loop against a simulated exchange and the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import type { Fill, Position, SymbolRules } from '../src/bot/futures.ts'
import { BotStore } from '../src/bot/store.ts'
import { DEFAULT_TRADER, SymbolTrader } from '../src/bot/trader.ts'
import type { Exchange, TraderConfig } from '../src/bot/trader.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'
import { DEFAULT_SETUP } from '../src/bot/setup.ts'

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

/** Fills at the current price; stops and post-only targets trigger on move(). */
class FakeExchange implements Exchange {
  base = 'fake://testnet'
  price = 100
  pos = { amt: 0, entry: 0 }
  balance = 10_000
  log: Fill[] = []
  algo: Array<{ algoId: number; side: 'BUY' | 'SELL'; trigger: number }> = []
  limits: Array<{ orderId: number; side: 'BUY' | 'SELL'; qty: number; price: number }> = []
  failStop = false
  private id = 1

  async rules(): Promise<SymbolRules> {
    return { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, pricePrecision: 2, quantityPrecision: 3 }
  }
  async balanceUsdt() {
    return this.balance
  }
  async position(symbol: string): Promise<Position> {
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
    this.balance += pnl - fee
    this.log.push({ id: this.id++, orderId, time: Date.now(), side, price, qty, realizedPnl: pnl, commission: fee, commissionAsset: 'USDT' })
  }
  async marketOrder(_s: string, side: 'BUY' | 'SELL', quantity: string, reduceOnly = false) {
    const orderId = this.id++
    const q = reduceOnly ? Math.min(Number(quantity), Math.abs(this.pos.amt)) : Number(quantity)
    if (q > 0) this.exec(side, q, this.price, false, orderId)
    return { orderId, avgPrice: String(this.price), executedQty: String(q) }
  }
  async bracketLeg(_s: string, side: 'BUY' | 'SELL', _t: string, triggerPrice: string) {
    if (this.failStop) throw new Error('simulated rejection')
    const algoId = this.id++
    this.algo.push({ algoId, side, trigger: Number(triggerPrice) })
    return { algoId }
  }
  async takeProfitLimit(_s: string, side: 'BUY' | 'SELL', quantity: string, price: string) {
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

function setup(mode: 'gated' | 'explore') {
  const hist = bars(1500)
  const state = { idx: 1400 }
  const cfg: TraderConfig = {
    ...DEFAULT_TRADER,
    mode,
    historyBars: 1400,
    // These replays treat old simulated bars as "now".
    maxLateMs: Infinity,
    wf: { ...DEFAULT_WF, trainBars: 600, testBars: 200, minEvR: mode === 'explore' ? -99 : DEFAULT_WF.minEvR, mlp: { ...DEFAULT_WF.mlp, epochs: 6 } },
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
