// radar-bot: the autonomous trading loop, on the Binance Futures testnet.
//
//   npm run bot
//
// Every TICK_MS: read the control switch, update equity and the risk limits,
// then let each symbol's trader reconcile, manage exits and — on a newly
// closed bar — decide. Retrains each model daily. Needs DATABASE_URL,
// BINANCE_API_KEY and BINANCE_API_SECRET in .env.
import { existsSync } from 'node:fs'
import { connect } from './db.ts'
import { Futures, TESTNET } from './bot/futures.ts'
import { checkLimits } from './bot/risk.ts'
import { readAccount } from './bot/account.ts'
import type { AccountFill } from './bot/account.ts'
import { BotStore } from './bot/store.ts'
import { DEFAULT_TRADER, SymbolTrader } from './bot/trader.ts'
import type { TraderConfig } from './bot/trader.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
const env = process.env
for (const k of ['DATABASE_URL', 'BINANCE_API_KEY', 'BINANCE_API_SECRET']) {
  if (!env[k]) {
    console.error(k + ' is not set — see .env.example')
    process.exit(1)
  }
}

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && isFinite(Number(v)) ? Number(v) : d)
// BOT_ONCE=1: run one tick and exit (for a scheduler such as GitHub Actions).
const ONCE = env.BOT_ONCE === '1'
const SYMBOLS = (env.BOT_SYMBOLS || 'BTCUSDT,PAXGUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const TICK_MS = num(env.BOT_TICK_MS, 15_000)
const cfg: TraderConfig = {
  ...DEFAULT_TRADER,
  mode: env.BOT_MODE === 'explore' ? 'explore' : 'gated',
  risk: {
    riskPerTrade: num(env.RISK_PER_TRADE, DEFAULT_TRADER.risk.riskPerTrade),
    maxNotionalX: num(env.MAX_NOTIONAL_X, DEFAULT_TRADER.risk.maxNotionalX),
    leverage: num(env.LEVERAGE, DEFAULT_TRADER.risk.leverage),
    maxDailyLoss: num(env.MAX_DAILY_LOSS, DEFAULT_TRADER.risk.maxDailyLoss),
    maxDrawdown: num(env.MAX_DRAWDOWN, DEFAULT_TRADER.risk.maxDrawdown),
  },
}

const db = connect(env.DATABASE_URL!, env.DATABASE_CA_FILE)
const store = new BotStore(db)
const ex = new Futures(env.BINANCE_API_KEY!, env.BINANCE_API_SECRET!, env.FUTURES_BASE || TESTNET)
for (let attempt = 1; ; attempt++) {
  try {
    await ex.syncTime()
    break
  } catch (e) {
    const wait = Math.min(120, 5 * 2 ** (attempt - 1))
    console.warn(`cannot reach ${ex.base} (attempt ${attempt}): ${(e as Error).message} — retrying in ${wait}s`)
    if (ONCE && attempt >= 3) process.exit(1)
    await new Promise((r) => setTimeout(r, wait * 1000))
  }
}
if (!ONCE) await store.event('info', null, `bot starting on ${ex.base} (${ex.isTestnet ? 'TESTNET' : 'MAINNET'}) · mode ${cfg.mode} · ${SYMBOLS.join(', ')} · ${cfg.interval} bars · risk ${(cfg.risk.riskPerTrade * 100).toFixed(2)}%/trade`)

const traders: SymbolTrader[] = []
for (const s of SYMBOLS) {
  const t = new SymbolTrader(ex, store, s, cfg)
  // A slow or flaky link should delay startup, not kill it.
  for (let attempt = 1; ; attempt++) {
    try {
      await t.init()
      break
    } catch (e) {
      const wait = Math.min(300, 10 * 2 ** (attempt - 1))
      await store.event('warn', s, `setup failed (attempt ${attempt}): ${(e as Error).message} — retrying in ${wait}s`)
      if (ONCE && attempt >= 2) process.exit(1)
      await new Promise((r) => setTimeout(r, wait * 1000))
    }
  }
  traders.push(t)
}

let stopping = false
let lastEquityAt = 0

// The account mirror the website shows (bot_state 'account'): the same wallet,
// unrealized P&L, margin, available balance, positions, orders and fills as the
// Binance panel. Fills are slower to change and cost more, so once a minute.
let fills: AccountFill[] = []
let lastFillsAt = 0
async function mirrorAccount(now: number): Promise<void> {
  const refresh = now - lastFillsAt >= 60_000
  if (refresh) lastFillsAt = now
  const snap = await readAccount(ex, SYMBOLS, now, refresh ? undefined : fills)
  fills = snap.fills
  await store.setState('account', snap)
}
async function tick(): Promise<void> {
  const now = Date.now()
  const control = await store.getState<{ enabled?: boolean }>('control', { enabled: true })
  const equity = await ex.balanceUsdt()
  const lim = checkLimits(await store.risk(), equity, now, cfg.risk)
  await store.setState('risk', lim.state)
  if (lim.state.halted && lim.state.haltReason !== (await store.getState<string>('lastHalt', ''))) {
    await store.event('warn', null, 'entries halted — ' + lim.state.haltReason)
    await store.setState('lastHalt', lim.state.haltReason)
  }
  if (ONCE || now - lastEquityAt >= 3_600_000) {
    lastEquityAt = now
    await store.equity(now - (now % 3_600_000), equity)
  }
  await store.setState('heartbeat', { t: now, equity, mode: cfg.mode, venue: ex.base })
  await mirrorAccount(now).catch((e) => console.error('account mirror', (e as Error).message))
  const canEnter = control.enabled !== false && lim.canEnter
  for (const t of traders) {
    try {
      await t.tick(canEnter, now)
    } catch (e) {
      await store.event('error', t.symbol, 'tick failed: ' + (e as Error).message)
    }
  }
}

async function loop(): Promise<void> {
  while (!stopping) {
    const t0 = Date.now()
    await tick().catch((e) => console.error('tick', e))
    await new Promise((r) => setTimeout(r, Math.max(1000, TICK_MS - (Date.now() - t0))))
  }
}

async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  // Open positions keep their exchange-side stop and target; nothing to unwind.
  await store.event('info', null, 'bot stopping (positions keep their exchange-side stop/target)')
  await db.end().catch(() => {})
  process.exit(0)
}
// A stray network rejection must not take down a process that guards open positions.
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), 'unhandled:', (e as Error)?.message || e))
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
if (ONCE) {
  await tick()
  console.log(new Date().toISOString(), 'tick done')
  await db.end().catch(() => {})
  process.exit(0)
} else void loop()
