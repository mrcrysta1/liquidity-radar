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
await ex.syncTime()
await store.event('info', null, `bot starting on ${ex.base} (${ex.isTestnet ? 'TESTNET' : 'MAINNET'}) · mode ${cfg.mode} · ${SYMBOLS.join(', ')} · ${cfg.interval} bars · risk ${(cfg.risk.riskPerTrade * 100).toFixed(2)}%/trade`)

const traders: SymbolTrader[] = []
for (const s of SYMBOLS) {
  const t = new SymbolTrader(ex, store, s, cfg)
  await t.init()
  traders.push(t)
}

let stopping = false
let lastEquityAt = 0
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
  if (now - lastEquityAt >= 3_600_000) {
    lastEquityAt = now
    await store.equity(now - (now % 3_600_000), equity)
  }
  await store.setState('heartbeat', { t: now, equity, mode: cfg.mode, venue: ex.base })
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
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
void loop()
