// End-to-end trading self-test on the Binance futures TESTNET (Demo account).
//
// Opens one small random trade exactly the way the bot does (market entry, an
// exchange-side stop, a resting take-profit), checks it shows up on Binance and
// in the website's account mirror, holds it briefly, closes it, and checks the
// account is flat again with the fills and P&L recorded. Practice money only.
//
//   npm run selftest                 # random side, BTCUSDT, hold 60 s
//   SELFTEST_SYMBOL=XAUUSDT SELFTEST_HOLD_SEC=120 npm run selftest
//
// It refuses to run if the symbol already has a position (the bot's), and it
// always tries to close and cancel everything it opened, even after a failure.
import { existsSync } from 'node:fs'
import { connect } from './db.ts'
import { Futures, TESTNET, roundStep, roundTick } from './bot/futures.ts'
import { BotStore } from './bot/store.ts'
import { readAccount } from './bot/account.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
const env = process.env
for (const k of ['DATABASE_URL', 'BINANCE_API_KEY', 'BINANCE_API_SECRET']) {
  if (!env[k]) {
    console.error(k + ' is not set')
    process.exit(1)
  }
}
const SYMBOL = (env.SELFTEST_SYMBOL || 'BTCUSDT').toUpperCase()
const HOLD_MS = Math.max(10, Math.min(600, Number(env.SELFTEST_HOLD_SEC || 60))) * 1000
const db = connect(env.DATABASE_URL!, env.DATABASE_CA_FILE)
const store = new BotStore(db)
const ex = new Futures(env.BINANCE_API_KEY!, env.BINANCE_API_SECRET!, env.FUTURES_BASE || TESTNET)
if (!ex.isTestnet) {
  console.error('Self-test runs on the testnet only.')
  process.exit(1)
}

const checks: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = '') => {
  checks.push([name, ok, detail])
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''))
}
const log = (msg: string) => store.event('info', SYMBOL, 'self-test: ' + msg).catch(() => {})
const mirror = async () => {
  const snap = await readAccount(ex, [SYMBOL], Date.now())
  await store.setState('account', snap)
  return snap
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let opened = false
try {
  await ex.syncTime()
  // Tell the always-on bot to leave this market alone until the test is over.
  await store.setState('selftest:' + SYMBOL, Date.now() + HOLD_MS + 5 * 60_000)
  const rules = await ex.rules(SYMBOL)
  await ex.setup(SYMBOL, 3)
  const before = await ex.position(SYMBOL)
  if (before.amt !== 0) {
    check('symbol is flat before the test', false, `${SYMBOL} already has a position (${before.amt}); not touching it`)
    throw new Error('skip')
  }
  const startBal = (await mirror()).walletBalance
  check('connected to Binance testnet', true, `${ex.base} · wallet ${startBal.toFixed(2)} USDT`)

  // 1. Random side, smallest size Binance allows (with headroom over the minimum notional).
  const side: 'BUY' | 'SELL' = Math.random() < 0.5 ? 'BUY' : 'SELL'
  const px = before.mark || (await ex.position(SYMBOL)).mark
  const qty = roundStep(Math.max(rules.minQty, (Math.max(rules.minNotional, 5) * 1.3) / px) + rules.stepSize, rules.stepSize, rules.quantityPrecision)
  const t0 = Date.now()
  const entry = await ex.marketOrder(SYMBOL, side, qty, false, `rb-test-in-${t0}`)
  opened = true
  const fill = Number(entry.avgPrice) || px
  check('market entry filled', Number(entry.executedQty) > 0, `${side === 'BUY' ? 'LONG' : 'SHORT'} ${entry.executedQty} ${SYMBOL} @ ${fill}`)
  await log(`opened ${side === 'BUY' ? 'LONG' : 'SHORT'} ${entry.executedQty} @ ${fill} (random test trade)`)

  // 2. Bracket exactly like the bot: exchange-side stop, resting maker take-profit, 1% away.
  const exit: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY'
  const dir = side === 'BUY' ? 1 : -1
  const sl = roundTick(fill * (1 - dir * 0.01), rules.tickSize, rules.pricePrecision)
  const tp = roundTick(fill * (1 + dir * 0.01), rules.tickSize, rules.pricePrecision)
  const slOrder = await ex.bracketLeg(SYMBOL, exit, 'STOP_MARKET', sl, `rb-test-sl-${t0}`)
  check('stop-loss placed on Binance', !!slOrder.algoId, `stop @ ${sl}`)
  const tpOrder = await ex.takeProfitLimit(SYMBOL, exit, qty, tp, `rb-test-tp-${t0}`)
  check('take-profit placed on Binance', !!tpOrder.orderId && tpOrder.status !== 'EXPIRED', `target @ ${tp} (${tpOrder.status})`)

  // 3. Visible on Binance and in the website's mirror.
  const snap = await mirror()
  const p = snap.positions.find((x) => x.symbol === SYMBOL)
  check('position visible in the account mirror', !!p && p.side === (side === 'BUY' ? 'LONG' : 'SHORT') && Math.abs(p.size - Number(qty)) < 1e-9, p ? `${p.side} ${p.size} @ ${p.entry}, PNL ${p.unrealized.toFixed(4)}` : 'missing')
  const legs = snap.orders.filter((o) => o.symbol === SYMBOL)
  check('stop and target visible in the mirror', legs.length >= 2, legs.map((o) => o.type + ' @ ' + o.price).join(', '))

  // 4. Hold (the website shows the open trade meanwhile), then close.
  const until = Date.now() + HOLD_MS
  while (Date.now() < until) {
    await sleep(Math.min(15_000, until - Date.now()))
    await mirror()
  }
} catch (e) {
  if ((e as Error).message !== 'skip') check('test ran without errors', false, (e as Error).message)
} finally {
  if (opened) {
    try {
      const pos = await ex.position(SYMBOL)
      const rules = await ex.rules(SYMBOL)
      if (pos.amt !== 0) await ex.marketOrder(SYMBOL, pos.amt > 0 ? 'SELL' : 'BUY', roundStep(Math.abs(pos.amt), rules.stepSize, rules.quantityPrecision), true, `rb-test-out-${Date.now()}`)
      await ex.cancelAllOrders(SYMBOL)
      await ex.cancelAllAlgo(SYMBOL)
      await sleep(2000)
      const after = await ex.position(SYMBOL)
      check('position closed', after.amt === 0, `position now ${after.amt}`)
      const snap = await mirror()
      check('no orders left behind', snap.orders.filter((o) => o.symbol === SYMBOL).length === 0)
      const fills = (await ex.fills(SYMBOL, Date.now() - HOLD_MS - 5 * 60_000)).filter((f) => f.time >= Date.now() - HOLD_MS - 5 * 60_000)
      const pnl = fills.reduce((a, f) => a + f.realizedPnl, 0)
      const fees = fills.reduce((a, f) => a + f.commission, 0)
      check('entry and exit fills recorded', fills.length >= 2, `${fills.length} fills · realized ${pnl.toFixed(4)} USDT · fees ${fees.toFixed(4)} USDT · net ${(pnl - fees).toFixed(4)}`)
      await log(`closed · realized ${pnl.toFixed(4)} USDT, fees ${fees.toFixed(4)} USDT, net ${(pnl - fees).toFixed(4)} USDT`)
    } catch (e) {
      check('clean-up', false, (e as Error).message + ' — check the Binance panel and close manually')
    }
  }
  await store.setState('selftest:' + SYMBOL, 0).catch(() => {})
  const failed = checks.filter((c) => !c[1]).length
  console.log(`\nself-test ${failed ? 'FAILED' : 'PASSED'}: ${checks.length - failed}/${checks.length} checks`)
  await db.end().catch(() => {})
  process.exit(failed ? 1 : 0)
}
