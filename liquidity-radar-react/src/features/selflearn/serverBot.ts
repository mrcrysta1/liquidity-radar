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

/** Closed real (gated or explore) and shadow trades of the current strategy, for the "Is it on track?" panel. */
export async function loadOutcomes(): Promise<{ real: Outcome[]; shadow: Outcome[] } | null> {
  if (!SERVER_BOT) return null
  const since = new Date(STRATEGY_SINCE).toISOString()
  const [real, shadow] = await Promise.all([
    rest<Array<{ p_win: number; r_multiple: number | null; opened_at: string; exit_reason: string | null }>>(
      `bot_trades?select=p_win,r_multiple,opened_at,exit_reason&status=eq.closed&mode=in.(gated,explore)&opened_at=gte.${since}&order=opened_at.desc&limit=1000`,
    ),
    rest<Array<{ p_cal: number; r_net: number | null; bar_time: string; exit_reason: string | null }>>(
      // The model's shadows only: a rule strategy's (008_bot_strategies.sql) have no win chance.
      `bot_shadow_trades?select=p_cal,r_net,bar_time,exit_reason&status=eq.closed&p_cal=not.is.null&bar_time=gte.${since}&order=bar_time.desc&limit=1000`,
    ),
  ])
  return {
    real: real.filter((x) => x.r_multiple != null).map((x) => ({ p: x.p_win, r: x.r_multiple!, t: Date.parse(x.opened_at), exit: x.exit_reason })),
    shadow: shadow.filter((x) => x.r_net != null).map((x) => ({ p: x.p_cal, r: x.r_net!, t: Date.parse(x.bar_time), exit: x.exit_reason })),
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
