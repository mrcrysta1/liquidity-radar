// Read-only view of the 24/7 testnet bot in radar-worker, from Supabase.
//
// Uses the same public URL and anon key as the whale history (see
// radar-worker/sql/002_bot.sql: the bot tables allow anonymous *select* and
// nothing else). Without those two variables the Neural Net page simply
// shows the in-browser engine alone.
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
  sl: number
  tp: number
  exit_reason: string | null
  pnl_usd: number | null
  r_multiple: number | null
  p_win: number
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
