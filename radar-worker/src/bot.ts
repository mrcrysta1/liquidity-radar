// radar-bot: the autonomous trading loop, on the Binance Futures testnet.
//
//   npm run bot
//
// Every TICK_MS: read the control switch, update equity and the risk limits,
// then let each symbol's trader reconcile, manage exits and — on a newly
// closed bar — decide. Learns from every closed real and shadow trade, trains
// a challenger model hourly, and writes performance metrics for the site.
// Needs DATABASE_URL, BINANCE_API_KEY and BINANCE_API_SECRET in .env.
// TESTNET ONLY: FUTURES_BASE must be an allowed testnet URL (bot/futures.ts).
import { existsSync } from 'node:fs'
import { connect } from './db.ts'
import { Futures, TESTNET } from './bot/futures.ts'
import { checkLimits } from './bot/risk.ts'
import { readAccount } from './bot/account.ts'
import type { AccountFill } from './bot/account.ts'
import { BotStore } from './bot/store.ts'
import { DEFAULT_LEARN, DEFAULT_TRADER, INTERVAL_DEFAULTS, INTERVAL_MAX_NOTIONAL_X, SymbolTrader, heavyJobs } from './bot/trader.ts'
import { DEFAULT_SETUP } from './bot/setup.ts'
import { InitQueue, listedOnly, tickOrder } from './bot/startup.ts'
import { buildMetrics } from './bot/learning.ts'
import { BarCache, INTERVAL_MS } from './bot/data.ts'
import type { TraderConfig } from './bot/trader.ts'
import { STRATEGIES, parseStrategies, refreshHealth } from './bot/strategies.ts'
import type { StrategySlot } from './bot/strategies.ts'
import { c6Tick } from './bot/c6.ts'
import { Alerts } from './bot/alerts.ts'

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
const SYMBOLS = (env.BOT_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XAUUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
// BOT_MODE: gated (default) | explore | hybrid. Hybrid: real orders only on
// symbols whose walk-forward gate passes, that are in BOT_REAL_SYMBOLS and fit
// under the portfolio heat cap; every other signal is a shadow trade.
const MODE: TraderConfig['mode'] = env.BOT_MODE === 'explore' || env.BOT_MODE === 'hybrid' ? env.BOT_MODE : 'gated'
// BOT_STRATEGY: ml (default) — the model places real orders as BOT_MODE says;
// trend — research strategy F1 (bot/strategy.ts) places them, long only with a
// trailing stop, and the model only shadow trades (it keeps learning).
const STRATEGY: TraderConfig['strategy'] = env.BOT_STRATEGY === 'trend' ? 'trend' : 'ml'
// BOT_STRATEGIES: several strategies in priority order, each live or shadow,
// e.g. "f1:live,ml:shadow" (bot/strategies.ts). Overrides BOT_STRATEGY, of
// which "trend" is the alias f1:live,ml:shadow. A live strategy that leaves its
// health bands is demoted to shadow and promoted back on fresh evidence (bot/health.ts).
let SLOTS: StrategySlot[] | null
try {
  SLOTS = parseStrategies(env.BOT_STRATEGIES, env.BOT_STRATEGY)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
for (const s of SLOTS ?? []) {
  const st = STRATEGIES[s.id]
  if (st.kind === 'rule' && st.interval !== (env.BOT_INTERVAL || DEFAULT_TRADER.interval))
    console.warn(`strategy ${s.id} decides on ${st.interval} bars, the bot on ${env.BOT_INTERVAL || DEFAULT_TRADER.interval}: it is skipped`)
}
// BOT_REAL_SYMBOLS (hybrid, trend): symbols allowed to place real orders; default all of BOT_SYMBOLS.
const REAL_SYMBOLS = env.BOT_REAL_SYMBOLS ? env.BOT_REAL_SYMBOLS.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : SYMBOLS
const TICK_MS = num(env.BOT_TICK_MS, 15_000)
// BOT_RUN_MINUTES: run continuously for this long, then exit cleanly so a
// hosted runner (GitHub Actions, 6 h per job) can hand over to the next run.
// Those regular handovers are not news, so they log to the console only.
const RUN_MS = num(env.BOT_RUN_MINUTES, 0) * 60_000
const DEADLINE = RUN_MS > 0 ? Date.now() + RUN_MS : Infinity
const HANDOFF = RUN_MS > 0
// BOT_INTERVAL: candle size the bot decides on (5m, 15m, 1h, 4h; default 4h).
const INTERVAL = INTERVAL_MS[env.BOT_INTERVAL || ''] ? (env.BOT_INTERVAL as string) : DEFAULT_TRADER.interval
// C6 (4h) trains its model only when it runs.
const C6_ON = !!SLOTS?.some((s) => s.id === 'c6') && STRATEGIES.c6.kind === 'rule' && STRATEGIES.c6.interval === INTERVAL
// BOT_MIN_EV: the expected-value bar (R, after fees) a side must clear. "any"
// = no extra bar in the walk-forward test. Live entries always also need a
// calibrated EV > 0 (setup rules); ideas below the bar become shadow trades.
// (A finite number, not -Infinity: the model's settings are stored as JSON.)
const MIN_EV = env.BOT_MIN_EV === 'any' ? -1e9 : num(env.BOT_MIN_EV, DEFAULT_TRADER.wf.minEvR)
// The bracket every trade (and every training label) uses, in ATRs and bars.
const BRACKET = {
  slAtr: num(env.BOT_SL_ATR, DEFAULT_TRADER.wf.bracket.slAtr),
  tpAtr: num(env.BOT_TP_ATR, DEFAULT_TRADER.wf.bracket.tpAtr),
  horizon: Math.max(1, Math.round(num(env.BOT_HORIZON, DEFAULT_TRADER.wf.bracket.horizon))),
}
const cfg: TraderConfig = {
  ...DEFAULT_TRADER,
  ...INTERVAL_DEFAULTS[INTERVAL],
  interval: INTERVAL,
  wf: { ...DEFAULT_TRADER.wf, minEvR: MIN_EV, bracket: BRACKET },
  // Setup rules, checked before any order (bot/setup.ts). EV must also clear BOT_MIN_EV.
  setup: {
    minRR: num(env.BOT_MIN_RR, DEFAULT_SETUP.minRR),
    maxCostR: num(env.BOT_MAX_COST_R, DEFAULT_SETUP.maxCostR),
    cooldownMs: num(env.BOT_COOLDOWN_MIN, DEFAULT_SETUP.cooldownMs / 60_000) * 60_000,
    maxOpen: num(env.BOT_MAX_OPEN, DEFAULT_SETUP.maxOpen),
    maxTradesPerDay: num(env.BOT_MAX_TRADES_DAY, DEFAULT_SETUP.maxTradesPerDay),
    minEvR: DEFAULT_SETUP.minEvR,
  },
  learn: {
    ...DEFAULT_LEARN,
    everyMs: num(env.BOT_LEARN_EVERY_MIN, DEFAULT_LEARN.everyMs / 60_000) * 60_000,
    everyTrades: num(env.BOT_LEARN_EVERY_TRADES, DEFAULT_LEARN.everyTrades),
    shadow: env.BOT_SHADOW !== '0',
    // Hybrid shadows every signal: one decision per bar, each open at most horizon bars.
    shadowMaxOpen: num(env.BOT_SHADOW_MAX_OPEN, MODE === 'hybrid' ? BRACKET.horizon + 1 : DEFAULT_LEARN.shadowMaxOpen),
  },
  mode: MODE,
  strategy: STRATEGY,
  strategies: SLOTS ?? undefined,
  realSymbols: REAL_SYMBOLS,
  // Closed bars kept between ticks, shared by every market: fetched when a new bar is due, not every tick.
  barCache: new BarCache(),
  // Each plan also shows how it would be sized on a small real-money account.
  previewEquity: num(env.BOT_PREVIEW_EQUITY, 100),
  risk: {
    riskPerTrade: num(env.RISK_PER_TRADE, DEFAULT_TRADER.risk.riskPerTrade),
    maxNotionalX: num(env.MAX_NOTIONAL_X, INTERVAL_MAX_NOTIONAL_X[INTERVAL] ?? DEFAULT_TRADER.risk.maxNotionalX),
    leverage: num(env.LEVERAGE, DEFAULT_TRADER.risk.leverage),
    minMarginUsd: num(env.BOT_MIN_MARGIN, DEFAULT_TRADER.risk.minMarginUsd ?? 100),
    maxDailyLoss: num(env.MAX_DAILY_LOSS, DEFAULT_TRADER.risk.maxDailyLoss),
    maxDrawdown: num(env.MAX_DRAWDOWN, DEFAULT_TRADER.risk.maxDrawdown),
    // Portfolio heat caps (hybrid): open risk per direction and in total, fractions of equity.
    maxSideRisk: num(env.BOT_MAX_SIDE_RISK, DEFAULT_TRADER.risk.maxSideRisk ?? 0.015),
    maxTotalRisk: num(env.BOT_MAX_TOTAL_RISK, DEFAULT_TRADER.risk.maxTotalRisk ?? 0.02),
  },
}

const db = connect(env.DATABASE_URL!, env.DATABASE_CA_FILE)
const store = new BotStore(db)
// BOT_ALERT_WEBHOOK (optional): halts, strategy state changes, errors and a daily summary to a chat webhook (bot/alerts.ts).
const alerts = new Alerts(env.BOT_ALERT_WEBHOOK)
if (alerts.enabled) store.onEvent = (level, symbol, msg) => alerts.onEvent(level, symbol, msg)
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
// Markets the venue does not list or trade (the testnet lists fewer than
// mainnet) are dropped with a warning, not retried forever.
{
  const listed = await ex.tradingSymbols().catch((e) => {
    console.warn('exchange listing unavailable:', (e as Error).message)
    return null
  })
  const { keep, dropped } = listedOnly(SYMBOLS, listed)
  if (dropped.length) {
    SYMBOLS.splice(0, SYMBOLS.length, ...keep)
    await store.event('warn', null, `not traded on ${ex.base}, left out: ${dropped.join(', ')}`)
  }
}
if (HANDOFF) console.log(new Date().toISOString(), `bot run started · until ${new Date(DEADLINE).toISOString()}`)
else if (!ONCE) await store.event('info', null, `bot starting on ${ex.base} (${ex.isTestnet ? 'TESTNET' : 'MAINNET'}) · mode ${cfg.mode}${SLOTS ? ' · strategies ' + SLOTS.map((s) => `${s.id}:${s.state}${s.symbols ? `@${s.symbols.length} markets` : "@all"}`).join(', ') : ''} · ${SYMBOLS.join(', ')} · ${cfg.interval} bars · risk ${(cfg.risk.riskPerTrade * 100).toFixed(2)}%/trade · bracket ${BRACKET.slAtr}/${BRACKET.tpAtr} ATR over ${BRACKET.horizon} bars · max ${cfg.setup.maxOpen} open, ${cfg.setup.maxTradesPerDay}/day${cfg.mode === 'hybrid' ? ` · real: ${REAL_SYMBOLS.join(', ')} · heat ≤ ${(cfg.risk.maxSideRisk! * 100).toFixed(1)}%/side, ${(cfg.risk.maxTotalRisk! * 100).toFixed(1)}% total` : ''}`)

// Each market starts on its own: one whose setup fails (a slow link, or a
// rejection such as -4067) is skipped and retried with a bounded backoff from
// the trading loop, while the others trade. It never stalls the run.
// A market dropped from BOT_SYMBOLS while a trade was open on it is never
// orphaned: a manage-only trader sees that trade through under the rules it
// was opened with, then idles (no new real or shadow trades, no learning).
const ORPHANS = (await store.openSymbols()).filter((s) => !SYMBOLS.includes(s))
if (ORPHANS.length) await store.event('warn', null, `open trade(s) on ${ORPHANS.join(', ')} outside BOT_SYMBOLS — managed until closed, no new entries there`)
const setupQueue = new InitQueue(
  [...SYMBOLS.map((s) => new SymbolTrader(ex, store, s, cfg)), ...ORPHANS.map((s) => new SymbolTrader(ex, store, s, { ...cfg, manageOnly: true }))],
  {
    onFail: (s, attempt, e, waitMs) =>
      store.event('warn', s, `setup failed (attempt ${attempt}): ${e.message} — skipped for now, other markets keep trading; retrying in ${Math.round(waitMs / 1000)}s`),
    onReady: (s, attempts) => (attempts > 1 ? store.event('info', s, `setup succeeded after ${attempts} attempts — trading resumed`) : undefined),
  },
)
await setupQueue.run()
if (ONCE && setupQueue.ready.length === 0) {
  console.error('no market could be set up')
  await db.end().catch(() => {})
  process.exit(1)
}

let stopping = false
let lastEquityAt = 0
/** Last equity actually read; shown in the heartbeat when a read fails. */
let lastEquity: number | null = null
let balanceMissing = false
let lastMetricsAt = 0
let lastHealthAt = 0

// Daily summary (alerts on only): once per UTC day, for the day that just
// ended, in the background so a slow webhook never delays a tick.
let summaryDay: string | null = null
let summaryBusy = false
async function dailyAlert(): Promise<void> {
  if (!alerts.enabled || summaryBusy) return
  summaryBusy = true
  try {
    summaryDay ??= await store.getState<string>('alerts:summaryDay', '')
    const day = await alerts.daily(summaryDay, async (d, start) => {
      const s = await store.daySummary(start)
      const dayPnl = s.startEquity != null && s.endEquity != null ? s.endEquity - s.startEquity : null
      return { day: d, equity: lastEquity, dayPnl, realized: s.realized, openPositions: s.openPositions, perStrategy: s.perStrategy }
    })
    if (day !== summaryDay) {
      summaryDay = day
      await store.setState('alerts:summaryDay', day)
    }
  } finally {
    summaryBusy = false
  }
}

// Performance figures for the website (bot_state 'metrics' + bot_metrics), hourly.
const METRIC_DAYS = 30
async function writeMetrics(now: number): Promise<void> {
  const inp = await store.metricInputs(now - METRIC_DAYS * 86_400_000)
  await store.saveMetrics(now, buildMetrics(inp, now, METRIC_DAYS))
}

// The account mirror the website shows (bot_state 'account'): the same wallet,
// unrealized P&L, margin, available balance, positions, orders and fills as the
// Binance panel. Fills are slower to change and cost more, so once a minute.
let fills: AccountFill[] = []
let lastFillsAt = 0
async function mirrorAccount(now: number): Promise<void> {
  const refresh = now - lastFillsAt >= 60_000
  if (refresh) lastFillsAt = now
  const snap = await readAccount(ex, [...SYMBOLS, ...ORPHANS], now, refresh ? undefined : fills)
  fills = snap.fills
  await store.setState('account', snap)
}
async function tick(): Promise<void> {
  const now = Date.now()
  const control = await store.getState<{ enabled?: boolean }>('control', { enabled: true })
  // A missing USDT row or a failed read is "unknown", not 0: reading it as 0
  // would trip the drawdown kill switch. The limits cannot be checked, so no
  // new entry is allowed this tick; open trades are still managed.
  const read = await ex.balanceUsdt().catch((e) => {
    console.warn('balance read failed', (e as Error).message)
    return null
  })
  // One event per outage, not one per tick.
  if (read == null && !balanceMissing) await store.event('warn', null, 'USDT balance unavailable — new entries paused until it can be read')
  balanceMissing = read == null
  if (read != null) lastEquity = read
  const equity = lastEquity
  const lim = checkLimits(await store.risk(), read, now, cfg.risk)
  await store.setState('risk', lim.state)
  if (lim.state.halted && lim.state.haltReason !== (await store.getState<string>('lastHalt', ''))) {
    await store.event('warn', null, 'entries halted — ' + lim.state.haltReason)
    await store.setState('lastHalt', lim.state.haltReason)
  }
  if (read != null && (ONCE || now - lastEquityAt >= 3_600_000)) {
    lastEquityAt = now
    await store.equity(now - (now % 3_600_000), read)
  }
  await store.setState('heartbeat', { t: now, equity, mode: cfg.mode, venue: ex.base })
  void dailyAlert().catch((e) => console.error('daily summary', (e as Error).message))
  await mirrorAccount(now).catch((e) => console.error('account mirror', (e as Error).message))
  if (ONCE || now - lastMetricsAt >= 3_600_000) {
    lastMetricsAt = now
    await writeMetrics(now).catch((e) => console.error('metrics', (e as Error).message))
  }
  const canEnter = control.enabled !== false && lim.canEnter
  // Strategy health (live / probation / shadow), before any trader decides on it.
  if (SLOTS && (ONCE || now - lastHealthAt >= 60_000)) {
    lastHealthAt = now
    await refreshHealth(store, SLOTS, now).catch((e) => console.error('strategy health', (e as Error).message))
  }
  // C6's model (bot/c6.ts): trained in the background once per 182 days on every market's history, kept in bot_state.
  if (C6_ON)
    await c6Tick(store, SYMBOLS, { costs: cfg.wf.costs, interval: cfg.interval, stepMs: INTERVAL_MS[cfg.interval], heavy: heavyJobs }).catch((e) =>
      console.error('c6', (e as Error).message),
    )
  // Retry any market whose setup failed earlier (each on its own backoff).
  if (!ONCE && setupQueue.pending.length) await setupQueue.run(now)
  // Alphabetical: same-bar entries compete for the heat cap in symbol order (startup.ts tickOrder).
  for (const t of tickOrder(setupQueue.ready)) {
    try {
      await t.tick(canEnter, now)
    } catch (e) {
      await store.event('error', t.symbol, 'tick failed: ' + (e as Error).message)
    }
  }
}

async function loop(): Promise<void> {
  while (!stopping && Date.now() < DEADLINE) {
    const t0 = Date.now()
    await tick().catch((e) => console.error('tick', e))
    await new Promise((r) => setTimeout(r, Math.max(1000, TICK_MS - (Date.now() - t0))))
  }
  if (stopping) return
  // Run time used up: hand over. Positions keep their exchange-side stop and
  // target, and every bit of state is in the database for the next run.
  console.log(new Date().toISOString(), 'run time over, handing over to the next run')
  await db.end().catch(() => {})
  process.exit(0)
}

async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  // Open positions keep their exchange-side stop and target; nothing to unwind.
  if (!HANDOFF) await store.event('info', null, 'bot stopping (positions keep their exchange-side stop/target)')
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
