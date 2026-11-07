// Read-only view of the 24/7 testnet bot in radar-worker, from Supabase.
//
// Uses the same public URL and anon key as the whale history (see
// radar-worker/sql/002_bot.sql: the bot tables allow anonymous *select* and
// nothing else). Without those two variables the Neural Net page simply
// shows the in-browser engine alone.
import type { Outcome } from './onTrack'
import { buildJournal } from './journal'
import type { JournalRow } from './journal'
import { normalizeStrategies } from './botStrategies'
import type { BotStrategy } from './botStrategies'
import type { ReadinessBands, ReadinessEvent, ReadinessInput, ReadinessTrade } from './readiness'
import { buildLedger, fromReal, fromShadow } from './ledger'
import type { Funding, StrategyLedger } from './ledger'
import { jget } from '../../api/client'
import { normalizeAudit } from './audit'
import { normalizeContext } from './marketContext'
import type { ContextView } from './marketContext'
import { TRACKED_NEWS } from './newsIntel'
import { normalizeMlEval } from './mlEval'
import { normalizeDaily, normalizeWeekly } from './reports'
import { botStatus } from './botStatus'
import { reactionMap, releaseHistory } from '../news/calendarEvidence'
import type { HistoryRow, ReactionMap } from '../news/calendarEvidence'
import type { BotStatus } from './botStatus'
import type { DayReport, WeekReport } from './reports'
import type { MlEval } from './mlEval'
import type { Context4h, NewsEvent, NewsTrade, ReactionRow } from './newsIntel'
import type { AuditReport } from './audit'

const DB_URL = (import.meta.env.VITE_WHALE_DB_URL as string | undefined)?.replace(/\/+$/, '')
const DB_KEY = import.meta.env.VITE_WHALE_DB_KEY as string | undefined
export const SERVER_BOT = !!(DB_URL && DB_KEY)

export interface BotTrade {
  id: number
  symbol: string
  side: 1 | -1
  status: 'open' | 'closed' | 'error'
  opened_at: string
  closed_at: string | null
  entry: number
  exit: number | null
  /** The stop in force (a trend trade's trailed stop). */
  sl: number
  /** null: no target (trend strategy, mode 'trend'). */
  tp: number | null
  exit_reason: string | null
  pnl_usd: number | null
  r_multiple: number | null
  /** null on trend-strategy trades (made by rules, not the model). */
  p_win: number | null
  mode: string
}

export interface BotEvent {
  id: number
  t: string
  symbol: string | null
  level: 'info' | 'warn' | 'error'
  msg: string
}

async function rest<T>(path: string): Promise<T> {
  const r = await fetch(DB_URL + '/rest/v1/' + path, {
    headers: { apikey: DB_KEY!, Authorization: 'Bearer ' + DB_KEY },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error('bot records: HTTP ' + r.status)
  return (await r.json()) as T
}

export async function loadBot(): Promise<{ trades: BotTrade[]; events: BotEvent[] } | null> {
  if (!SERVER_BOT) return null
  const [trades, events] = await Promise.all([
    rest<BotTrade[]>(
      'bot_trades?select=id,symbol,side,status,opened_at,closed_at,entry,exit,sl,tp,exit_reason,pnl_usd,r_multiple,p_win,mode&order=opened_at.desc&limit=100',
    ),
    rest<BotEvent[]>('bot_events?select=id,t,symbol,level,msg&order=t.desc&limit=40'),
  ])
  return { trades, events }
}

/** The Binance futures account as the bot last read it (radar-worker/src/bot/account.ts). */
export interface BinanceAccount {
  t: number
  venue: string
  walletBalance: number
  unrealizedPnl: number
  marginBalance: number
  availableBalance: number
  positions: Array<{ symbol: string; side: 'LONG' | 'SHORT'; size: number; entry: number; mark: number; unrealized: number; leverage: number; liquidation: number; margin: number; notional: number }>
  orders: Array<{ symbol: string; side: 'BUY' | 'SELL'; type: string; price: number; qty: number; reduceOnly: boolean }>
  fills: Array<{ symbol: string; time: number; side: 'BUY' | 'SELL'; price: number; qty: number; realizedPnl: number; commission: number }>
}

/** Account snapshot and bot heartbeat. Null when the database is not configured. */
export async function loadAccount(): Promise<{ account: BinanceAccount | null; heartbeat: { t: number; mode: string; venue: string } | null } | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ key: string; value: unknown }>>('bot_state?select=key,value&key=in.(account,heartbeat)')
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null
  return { account: get('account') as BinanceAccount | null, heartbeat: get('heartbeat') as { t: number; mode: string; venue: string } | null }
}

/**
 * When the current strategy went live: 4-hour candles, 1.5 / 2.25 ATR bracket
 * (PR #126). Older trades were a different setup. It ran gated at first and in
 * explore mode since PR #142 — same bracket and model, so both modes count.
 */
export const STRATEGY_SINCE = Date.parse('2026-10-31T06:12:00Z')
const BAR_4H = 4 * 3_600_000

/** Closed real and shadow trades of the model (rows with a win chance, in any mode: gated, explore or hybrid), for the "Is it on track?" panel. */
export async function loadOutcomes(): Promise<{ real: Outcome[]; shadow: Outcome[] } | null> {
  if (!SERVER_BOT) return null
  const since = new Date(STRATEGY_SINCE).toISOString()
  const [real, shadow] = await Promise.all([
    rest<Array<{ p_win: number; r_multiple: number | null; opened_at: string; exit_reason: string | null }>>(
      `bot_trades?select=p_win,r_multiple,opened_at,exit_reason&status=eq.closed&p_win=not.is.null&opened_at=gte.${since}&order=opened_at.desc&limit=1000`,
    ),
    rest<Array<{ p_cal: number; r_net: number | null; bar_time: string; exit_reason: string | null }>>(
      // The model's shadows only: a rule strategy's (008_bot_strategies.sql) have no win chance.
      `bot_shadow_trades?select=p_cal,r_net,bar_time,exit_reason&status=eq.closed&p_cal=not.is.null&bar_time=gte.${since}&order=bar_time.desc&limit=1000`,
    ),
  ])
  return {
    // Cluster on the decision candle: a shadow's bar_time is that candle's open;
    // a real trade opens at its close, one 4h candle later.
    real: real.filter((x) => x.r_multiple != null).map((x) => {
      const t = Date.parse(x.opened_at)
      return { p: x.p_win, r: x.r_multiple!, t, exit: x.exit_reason, bar: Math.floor(t / BAR_4H) * BAR_4H - BAR_4H }
    }),
    shadow: shadow.filter((x) => x.r_net != null).map((x) => ({ p: x.p_cal, r: x.r_net!, t: Date.parse(x.bar_time), exit: x.exit_reason, bar: Date.parse(x.bar_time) })),
  }
}

/** How a plan would be sized (radar-worker/src/bot/plan.ts SizePreview). */
export interface PlanSize {
  equity: number
  qty: number
  notional: number
  margin: number
  riskUsd: number
  riskPct: number
  feesUsd: number
  reason?: string
}

/** The trade the bot planned on its latest bar for one market (bot_state 'plan:SYMBOL'). */
export interface BotPlan {
  symbol: string
  t: number
  barClose: number
  interval: string
  /** 'trend': strategy F1 — no target, a trailing stop, no model numbers. */
  strategy?: 'ml' | 'trend'
  /** The rule strategy behind a 'trend' plan ('f1', ...). */
  strategyId?: string
  side: 'LONG' | 'SHORT'
  entry: number
  sl: number
  tp: number | null
  pWin?: number
  pLong?: number
  pShort?: number
  evR?: number
  rr?: number
  costR: number
  status: 'opened' | 'paper' | 'skipped'
  reasons: string[]
  tradeId?: number
  shadowId?: number
  live?: PlanSize
  small?: PlanSize
}

/** The strategies the bot runs and their health (bot_state 'strategy:*'), in priority order. */
export async function loadStrategies(): Promise<BotStrategy[] | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ value: unknown }>>('bot_state?select=value&key=like.strategy:*')
  return normalizeStrategies(rows.map((r) => r.value))
}

/** Latest plan per market, newest first. */
export async function loadPlans(): Promise<BotPlan[] | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ value: BotPlan }>>('bot_state?select=value&key=like.plan:*')
  return rows.map((r) => r.value).filter((p) => p && p.symbol).sort((a, b) => b.t - a.t)
}

/**
 * Every real and shadow trade for the trade journal, newest first. select=*
 * so it works whether or not the journal columns (006_bot_journal.sql) exist
 * yet; model versions come from bot_models for rows that do not carry one.
 */
export async function loadJournal(limit = 500): Promise<JournalRow[] | null> {
  if (!SERVER_BOT) return null
  const [real, shadow, models] = await Promise.all([
    rest<Array<Record<string, unknown>>>(`bot_trades?select=*&order=opened_at.desc&limit=${limit}`),
    rest<Array<Record<string, unknown>>>(`bot_shadow_trades?select=*&order=bar_time.desc&limit=${limit}`),
    rest<Array<Record<string, unknown>>>('bot_models?select=id,version&order=id.desc&limit=1000').catch(() => []),
  ])
  return buildJournal(real, shadow, models)
}

/**
 * Closed real and shadow trades (only the columns the metrics use) and the
 * model registry, for the "Model metrics" card (modelMetrics.ts). The model
 * weights in bot_models are not fetched.
 */
/** Every row of a query, a page at a time (Supabase returns at most 1000 per request), up to `max`. */
async function restAll<T>(path: string, max: number, page = 1000): Promise<T[]> {
  const out: T[] = []
  while (out.length < max) {
    const want = Math.min(page, max - out.length)
    const rows = await rest<T[]>(`${path}&limit=${want}&offset=${out.length}`)
    out.push(...rows)
    if (rows.length < want) break
  }
  return out
}

export async function loadModelMetrics(limit = 20_000): Promise<{ real: Array<Record<string, unknown>>; shadow: Array<Record<string, unknown>>; models: Array<Record<string, unknown>> } | null> {
  if (!SERVER_BOT) return null
  const [real, shadow, models] = await Promise.all([
    restAll<Record<string, unknown>>(
      'bot_trades?select=id,symbol,status,mode,strategy,opened_at,closed_at,exit_reason,r_multiple,p_win,p_raw,ev_r,bars_held,mae_r,mfe_r&status=eq.closed&order=closed_at.desc,id.desc',
      limit,
    ),
    restAll<Record<string, unknown>>(
      'bot_shadow_trades?select=id,symbol,status,strategy,bar_time,closed_at,exit_reason,r_gross,r_net,p_cal,p_raw,ev_r,bars_held,mae_r,mfe_r&status=eq.closed&order=closed_at.desc,id.desc',
      limit,
    ),
    // Readable with the anon key (002_bot.sql); an older schema without the registry columns just shows no registry.
    rest<Array<Record<string, unknown>>>('bot_models?select=id,symbol,interval,version,role,created_at,promoted_at,gate_pass,holdout&order=id.desc&limit=2000').catch(() => []),
  ])
  return { real, shadow, models }
}

/**
 * Everything the go-live readiness check (readiness.ts computeReadiness) needs:
 * real trades with a strategy, error events of the last 7 days and every
 * failed-stop error, the last 14 days of hourly equity rows, the heartbeat and
 * the strategy records (with their research bands when the bot stores them).
 */
export async function loadReadiness(now = Date.now()): Promise<ReadinessInput | null> {
  if (!SERVER_BOT) return null
  const iso = (t: number) => new Date(t).toISOString()
  const ev = 'bot_events?select=t,symbol,level,msg&level=eq.error'
  const [trades, errors, stopEvents, equity, state] = await Promise.all([
    rest<ReadinessTrade[]>('bot_trades?select=strategy,status,opened_at,closed_at,r_multiple,slippage_bps,sl_algo_id&strategy=not.is.null&order=opened_at.asc&limit=5000'),
    rest<ReadinessEvent[]>(`${ev}&t=gte.${iso(now - 7 * 86_400_000)}&order=t.desc&limit=1000`),
    rest<ReadinessEvent[]>(`${ev}&msg=ilike.${encodeURIComponent('*stop could not be placed*')}&order=t.desc&limit=1000`),
    rest<Array<{ t: string }>>(`bot_equity?select=t&t=gte.${iso(now - 15 * 86_400_000)}&order=t.asc&limit=1000`),
    rest<Array<{ key: string; value: unknown }>>('bot_state?select=key,value&or=(key.eq.heartbeat,key.like.strategy:*)'),
  ])
  const hb = state.find((r) => r.key === 'heartbeat')?.value as { t?: number } | null | undefined
  const parse = (v: unknown): Record<string, unknown> | null => {
    try {
      return (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, unknown> | null
    } catch {
      return null
    }
  }
  const raw = state.filter((r) => r.key.startsWith('strategy:')).map((r) => parse(r.value))
  const bandsOf = (id: string): ReadinessBands | null => {
    const b = raw.find((x) => x?.id === id)?.bands as Partial<ReadinessBands> | null | undefined
    return b && Number.isFinite(b.roll30P5) && Number.isFinite(b.ddP95) ? { roll30P5: Number(b.roll30P5), ddP95: Number(b.ddP95) } : null
  }
  return {
    now,
    trades,
    errors,
    stopEvents,
    equityTimes: equity.map((r) => Date.parse(r.t)),
    heartbeat: hb && Number.isFinite(Number(hb.t)) ? Number(hb.t) : null,
    strategies: normalizeStrategies(raw).map((s) => ({ id: s.id, state: s.state, configured: s.configured, bands: bandsOf(s.id) })),
  }
}

const FUNDING_TTL = 30 * 60_000
const fundingCache = new Map<string, { at: number; from: number; rows: Funding[] }>()

/** A market's funding settlements since `from` (Binance futures, public); [] when it cannot be read. Cached 30 min. */
async function fundingSince(symbol: string, from: number): Promise<Funding[]> {
  const c = fundingCache.get(symbol)
  if (c && c.from <= from && Date.now() - c.at < FUNDING_TTL) return c.rows
  const rows: Funding[] = []
  let start = from
  for (let page = 0; page < 10; page++) {
    const r = (await jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&startTime=${start}&limit=1000`)) as Array<{ fundingTime: number; fundingRate: string }>
    for (const x of r) if (Number.isFinite(Number(x.fundingRate))) rows.push({ t: Number(x.fundingTime), rate: Number(x.fundingRate) })
    if (r.length < 1000) break
    start = Number(r[r.length - 1].fundingTime) + 1
  }
  fundingCache.set(symbol, { at: Date.now(), from, rows })
  return rows
}

/**
 * Every strategy's ledger (ledger.ts) from its closed real and shadow trades
 * since `since`, with each market's real funding (markets whose funding cannot
 * be read fall back to the default rate, and the ledger says how many trades did).
 */
export async function loadLedger(since = STRATEGY_SINCE, limit = 20_000): Promise<StrategyLedger[] | null> {
  if (!SERVER_BOT) return null
  const iso = new Date(since).toISOString()
  const [real, shadow] = await Promise.all([
    restAll<Record<string, unknown>>(
      `bot_trades?select=id,symbol,mode,strategy,side,entry,exit,sl,initial_sl,planned_sl,bar_time,opened_at,closed_at,exit_reason,r_multiple,fees_usd,risk_usd,slippage_bps&status=eq.closed&opened_at=gte.${iso}&order=id.asc`,
      limit,
    ),
    restAll<Record<string, unknown>>(
      `bot_shadow_trades?select=id,symbol,strategy,side,entry,exit,sl,interval,bar_time,closed_at,exit_reason,r_net&status=eq.closed&bar_time=gte.${iso}&order=id.asc`,
      limit,
    ),
  ])
  const trades = [...fromReal(real), ...fromShadow(shadow)]
  const symbols = [...new Set(trades.map((t) => t.symbol).filter(Boolean))]
  const from = Math.min(since, ...trades.map((t) => t.openedAt)) - 8 * 3_600_000
  const got = await Promise.allSettled(symbols.map((s) => fundingSince(s, from)))
  const funding: Record<string, Funding[] | undefined> = {}
  symbols.forEach((s, i) => {
    const g = got[i]
    funding[s] = g.status === 'fulfilled' ? g.value : undefined
  })
  return buildLedger(trades, funding)
}

/** The latest strategy audit (radar-worker/scripts/audit.ts --publish); null when none has been published. */
export async function loadAudit(): Promise<AuditReport | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ value: unknown }>>('bot_state?select=value&key=eq.audit:latest')
  return rows.length ? normalizeAudit(rows[0].value) : null
}

/** The bot's latest market context (radar-worker/src/context/); null when none is stored yet. */
export async function loadContext(): Promise<ContextView | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ value: unknown }>>('bot_state?select=value&key=eq.context:latest')
  return rows.length ? normalizeContext(rows[0].value) : null
}

export interface NewsIntelData {
  now: number
  events: NewsEvent[]
  reactions: ReactionRow[]
  context: Context4h[]
  trades: NewsTrade[]
  /** Tables the bot has not created yet (it does on its next run). */
  missing: string[]
}

/** Everything the News trading intelligence card needs (newsIntel.ts). A table not created yet reads as empty. */
export async function loadNewsIntel(limit = 50_000): Promise<NewsIntelData | null> {
  if (!SERVER_BOT) return null
  const missing: string[] = []
  const soft = <T,>(name: string, p: Promise<T[]>) => p.catch(() => (missing.push(name), [] as T[]))
  const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const [ev, re, cx, real, shadow] = await Promise.all([
    soft('econ_events', restAll<Record<string, unknown>>(`econ_events?select=category,title,source,impact,event_time,unit,forecast_num,actual_num,previous_num,revised_previous_num,surprise,decision&country=eq.USD&category=in.(${TRACKED_NEWS.join(',')})&order=event_time.asc`, limit)),
    soft('econ_reactions', restAll<Record<string, unknown>>('econ_reactions?select=event_time,asset,horizon_min,ret_pct,z,range_pct&order=event_time.asc', limit)),
    soft('market_context', restAll<Record<string, unknown>>('market_context?select=bar_time,regime,btc_dir_4h&order=bar_time.asc', limit)),
    restAll<Record<string, unknown>>('bot_trades?select=id,strategy,mode,symbol,side,opened_at,r_multiple&status=eq.closed&order=id.asc', limit),
    restAll<Record<string, unknown>>('bot_shadow_trades?select=id,strategy,symbol,side,bar_time,interval,r_net&status=eq.closed&order=id.asc', limit),
  ])
  const STEP: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 }
  const trades: NewsTrade[] = []
  for (const x of real) {
    const r = n(x.r_multiple)
    const t = Date.parse(String(x.opened_at))
    if (r == null || !Number.isFinite(t)) continue
    trades.push({ key: 'r' + x.id, strategy: typeof x.strategy === 'string' && x.strategy ? x.strategy : x.mode === 'trend' ? 'f1' : 'ml', kind: 'real', symbol: String(x.symbol), side: Number(x.side) > 0 ? 1 : -1, entryTime: t, r })
  }
  for (const x of shadow) {
    const r = n(x.r_net)
    const t = Date.parse(String(x.bar_time))
    if (r == null || !Number.isFinite(t)) continue
    trades.push({ key: 's' + x.id, strategy: typeof x.strategy === 'string' && x.strategy ? x.strategy : 'ml', kind: 'shadow', symbol: String(x.symbol), side: Number(x.side) > 0 ? 1 : -1, entryTime: t + (STEP[String(x.interval)] ?? STEP['4h']), r })
  }
  return {
    now: Date.now(),
    events: ev.map((x) => ({
      time: Date.parse(String(x.event_time)),
      category: String(x.category),
      title: String(x.title),
      source: String(x.source),
      impact: typeof x.impact === 'string' ? x.impact : null,
      unit: typeof x.unit === 'string' ? x.unit : null,
      forecast: n(x.forecast_num),
      actual: n(x.actual_num),
      previous: n(x.previous_num),
      revisedPrevious: n(x.revised_previous_num),
      surprise: n(x.surprise),
      decision: typeof x.decision === 'string' ? x.decision : null,
    })).filter((e) => Number.isFinite(e.time)),
    reactions: re.map((x) => ({ time: Date.parse(String(x.event_time)), asset: String(x.asset), horizon: Number(x.horizon_min), ret: Number(x.ret_pct), z: n(x.z), range: n(x.range_pct) })).filter((r) => Number.isFinite(r.time) && Number.isFinite(r.ret)),
    context: cx.map((x) => ({ time: Date.parse(String(x.bar_time)), regime: String(x.regime), btcDir4h: typeof x.btc_dir_4h === 'string' ? x.btc_dir_4h : null })).filter((c) => Number.isFinite(c.time)),
    trades: trades.sort((a, b) => a.entryTime - b.entryTime),
    missing,
  }
}

/** The model calibration study (radar-worker/src/research/calib.ts), refreshed daily by the bot; null before the first. */
export async function loadMlEval(): Promise<MlEval | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ value: unknown }>>('bot_state?select=value&key=eq.ml:eval')
  return rows.length ? normalizeMlEval(rows[0].value) : null
}

/** The bot's daily reports (newest first) and the weekly comparison (radar-worker/src/research/report.ts). */
export async function loadReports(): Promise<{ daily: DayReport[]; weekly: WeekReport | null } | null> {
  if (!SERVER_BOT) return null
  const rows = await rest<Array<{ key: string; value: unknown }>>('bot_state?select=key,value&key=in.(report:daily,report:weekly)')
  const get = (k: string) => rows.find((r) => r.key === k)?.value
  return { daily: normalizeDaily(get('report:daily')), weekly: normalizeWeekly(get('report:weekly')) }
}

/** The status bar: heartbeat, open positions, strategy states and today's closed demo trades (three small requests). */
export async function loadBotStatus(now = Date.now()): Promise<BotStatus | null> {
  if (!SERVER_BOT) return null
  const day = new Date(now - (now % 86_400_000)).toISOString()
  // The same queries the account panel and the Strategies card use.
  const [st, strats, today] = await Promise.all([
    rest<Array<{ key: string; value: unknown }>>('bot_state?select=key,value&key=in.(account,heartbeat)'),
    loadStrategies().catch(() => null),
    rest<Array<{ r_multiple: number | null }>>(`bot_trades?select=r_multiple&status=eq.closed&closed_at=gte.${day}`),
  ])
  const get = (k: string) => st.find((r) => r.key === k)?.value as Record<string, unknown> | undefined
  const hb = get('heartbeat')
  const acct = get('account') as { positions?: unknown[] } | undefined
  const strategies = (strats ?? []).map((x) => ({ id: x.id, state: x.state }))
  return botStatus({
    now,
    heartbeat: hb && Number.isFinite(Number(hb.t)) ? { t: Number(hb.t), mode: typeof hb.mode === 'string' ? hb.mode : undefined } : null,
    positions: Array.isArray(acct?.positions) ? acct.positions.length : 0,
    strategies,
    todayR: today.map((x) => Number(x.r_multiple)).filter(Number.isFinite),
  })
}

/** BTC's and gold's 1 h reaction to releases between two times (the calendar's "BTC 1h" column). */
export async function loadCalendarReactions(from: number, to: number): Promise<ReactionMap | null> {
  if (!SERVER_BOT) return null
  const a = new Date(from - 600_000).toISOString()
  const b = new Date(to + 600_000).toISOString()
  const rows = await restAll<Record<string, unknown>>(`econ_reactions?select=event_time,asset,ret_pct,z&horizon_min=eq.60&asset=in.(BTCUSDT,XAUUSDT)&event_time=gte.${a}&event_time=lte.${b}&order=event_time.asc`, 5000)
  return reactionMap(rows.map((x) => ({ time: Date.parse(String(x.event_time)), asset: String(x.asset), ret: Number(x.ret_pct), z: x.z == null ? null : Number(x.z) })).filter((r) => Number.isFinite(r.time) && Number.isFinite(r.ret)))
}

/** The last 12 releases of a category before `before`, with reactions and the regime then (the calendar's history panel). */
export async function loadReleaseHistory(category: string, before: number, limit = 12): Promise<HistoryRow[] | null> {
  if (!SERVER_BOT) return null
  const iso = new Date(before).toISOString()
  const ev = await rest<Array<Record<string, unknown>>>(`econ_events?select=event_time,title,surprise,decision&country=eq.USD&category=eq.${encodeURIComponent(category)}&event_time=lt.${iso}&order=event_time.desc&limit=${limit * 5}`)
  const events = ev.map((x) => ({ time: Date.parse(String(x.event_time)), title: String(x.title), surprise: x.surprise == null ? null : Number(x.surprise), decision: typeof x.decision === 'string' ? x.decision : null })).filter((e) => Number.isFinite(e.time))
  if (!events.length) return []
  const oldest = Math.min(...events.map((e) => e.time))
  const [rx, cx] = await Promise.all([
    loadCalendarReactions(oldest, before),
    rest<Array<Record<string, unknown>>>(`market_context?select=bar_time,regime&bar_time=gte.${new Date(oldest - 14_400_000).toISOString()}&bar_time=lte.${iso}&order=bar_time.asc&limit=20000`).catch(() => []),
  ])
  return releaseHistory(events, rx ?? new Map(), cx.map((c) => ({ time: Date.parse(String(c.bar_time)), regime: String(c.regime) })), before, limit)
}
