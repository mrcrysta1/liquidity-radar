// Collects the market context (market.ts) and stores it: the latest snapshot
// in bot_state 'context:latest' for the website, and one row per 4h bar in
// market_context (sql/009_market_context.sql) so strategies, news events and
// reports can later be read against the regime they happened in.
//
// Sources: Binance spot klines (data host) for the coins, Binance USDⓈ-M
// klines for gold (XAUUSDT, which follows spot XAU/USD), Yahoo Finance daily
// closes for the dollar index (DX-Y.NYB), the 13-week T-bill (^IRX) and the
// 10-year Treasury yield (^TNX) — yields are the free proxy for interest-rate
// expectations. A source that fails leaves its part null; the rest is kept.
import type { Bar } from '../bot/features.ts'
import { closedBars, INTERVAL_MS } from '../bot/data.ts'
import type { BotStore } from '../bot/store.ts'
import type { Db } from '../db.ts'
import { CORR_WINDOW, correlation, dailyCorrelation, dailyTrend, keyLevels, regimeOf, tfState } from './market.ts'
import type { Corr, DailyPoint, Regime, TfState } from './market.ts'

const TFS = ['15m', '1h', '4h'] as const
type Tf = (typeof TFS)[number]
const BTC_BARS = 720

export interface MarketContext {
  v: 1
  t: number
  regime: { regime: Regime; why: string }
  btc: Record<Tf, TfState | null>
  /** Per coin and timeframe: correlation with BTC. */
  corr: Record<string, Partial<Record<Tf, Corr>>>
  /** Coins whose correlation with BTC changed significantly (99%) on any timeframe. */
  changes: Array<{ symbol: string; tf: Tf; from: number; to: number; z: number }>
  gold: {
    h1: TfState | null
    h4: TfState | null
    levels: ReturnType<typeof keyLevels>
    dxy: ReturnType<typeof dailyTrend>
    bill13w: ReturnType<typeof dailyTrend>
    yield10y: ReturnType<typeof dailyTrend>
    /** Daily-return correlation over 60 days: gold vs the dollar index, BTC vs gold. */
    goldDxyCorr: number | null
    btcGoldCorr: number | null
  }
  /** BTC and gold on 4h: same direction, opposite, or one of them flat. Information, not a signal. */
  btcVsGold: 'same' | 'opposite' | 'mixed' | null
  errors: string[]
}

export interface Fetchers {
  bars: (symbol: string, interval: string, count: number) => Promise<Bar[]>
  daily: (yahooSymbol: string) => Promise<DailyPoint[]>
}

/** Yahoo Finance daily closes (6 months). */
export async function yahooDaily(symbol: string): Promise<DailyPoint[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`, {
    headers: { 'user-agent': 'Mozilla/5.0 (radar-worker)' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`${symbol} → HTTP ${r.status}`)
  const j = (await r.json()) as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } }
  const res = j.chart?.result?.[0]
  const ts = res?.timestamp ?? []
  const cl = res?.indicators?.quote?.[0]?.close ?? []
  const out: DailyPoint[] = []
  ts.forEach((t, i) => {
    const c = cl[i]
    if (c != null && Number.isFinite(c)) out.push({ t: t * 1000, c })
  })
  return out
}

export const LIVE_FETCHERS: Fetchers = { bars: closedBars, daily: yahooDaily }

/** The last 4h close of each UTC day, as a daily series. */
function dailyFrom(b: Bar[], stepMs: number): DailyPoint[] {
  const m = new Map<number, DailyPoint>()
  for (const x of b) m.set(Math.floor(x.t / 86_400_000), { t: x.t + stepMs, c: x.c })
  return [...m.values()]
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let k = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (k < items.length) {
        const i = k++
        out[i] = await f(items[i])
      }
    }),
  )
  return out
}

export async function collectContext(symbols: string[], f: Fetchers = LIVE_FETCHERS, now = Date.now()): Promise<MarketContext> {
  const errors: string[] = []
  const safe = async <T>(what: string, p: Promise<T>): Promise<T | null> => {
    try {
      return await p
    } catch (e) {
      errors.push(`${what}: ${(e as Error).message}`)
      return null
    }
  }
  const btc = {} as Record<Tf, Bar[] | null>
  for (const tf of TFS) btc[tf] = await safe(`BTCUSDT ${tf}`, f.bars('BTCUSDT', tf, BTC_BARS))
  const btcState = Object.fromEntries(TFS.map((tf) => [tf, btc[tf] ? tfState(btc[tf]!, INTERVAL_MS[tf]) : null])) as Record<Tf, TfState | null>
  const coins = symbols.filter((s) => s !== 'BTCUSDT' && s !== 'XAUUSDT')
  const jobs = coins.flatMap((s) => TFS.map((tf) => ({ s, tf })))
  const got = await pool(jobs, 6, (j) => safe(`${j.s} ${j.tf}`, f.bars(j.s, j.tf, 2 * CORR_WINDOW[j.tf] + 2)))
  const corr: MarketContext['corr'] = {}
  const changes: MarketContext['changes'] = []
  jobs.forEach((j, i) => {
    const b = got[i]
    const base = btc[j.tf]
    if (!b || !base) return
    const c = correlation(base, b, CORR_WINDOW[j.tf])
    ;(corr[j.s] ??= {})[j.tf] = c
    if (c.changed && c.r != null && c.prev != null && c.z != null) changes.push({ symbol: j.s, tf: j.tf, from: c.prev, to: c.r, z: c.z })
  })
  const g1 = await safe('XAUUSDT 1h', f.bars('XAUUSDT', '1h', 720))
  const g4 = await safe('XAUUSDT 4h', f.bars('XAUUSDT', '4h', 720))
  const [dxy, irx, tnx] = await Promise.all([safe('DXY', f.daily('DX-Y.NYB')), safe('^IRX', f.daily('^IRX')), safe('^TNX', f.daily('^TNX'))])
  const goldDaily = g4 ? dailyFrom(g4, INTERVAL_MS['4h']) : null
  const btcDaily = btc['4h'] ? dailyFrom(btc['4h']!, INTERVAL_MS['4h']) : null
  const h4 = g4 ? tfState(g4, INTERVAL_MS['4h']) : null
  const b4 = btcState['4h']
  const btcVsGold = !b4 || !h4 ? null : b4.dir === 'flat' || h4.dir === 'flat' ? 'mixed' : b4.dir === h4.dir ? 'same' : 'opposite'
  return {
    v: 1,
    t: now,
    regime: regimeOf(btcState['4h'], btcState['1h']),
    btc: btcState,
    corr,
    changes,
    gold: {
      h1: g1 ? tfState(g1, INTERVAL_MS['1h']) : null,
      h4,
      levels: g1 ? keyLevels(g1, now) : null,
      dxy: dxy ? dailyTrend(dxy) : null,
      bill13w: irx ? dailyTrend(irx) : null,
      yield10y: tnx ? dailyTrend(tnx) : null,
      goldDxyCorr: goldDaily && dxy ? dailyCorrelation(goldDaily, dxy) : null,
      btcGoldCorr: goldDaily && btcDaily ? dailyCorrelation(btcDaily, goldDaily) : null,
    },
    btcVsGold,
    errors,
  }
}

/** Store a snapshot: bot_state for the website, and the row of its 4h bar in market_context. */
export async function saveContext(store: BotStore, db: Db, c: MarketContext): Promise<void> {
  await store.setState('context:latest', c)
  const bar = c.btc['4h']?.t
  if (bar == null) return
  await db.query(
    `insert into market_context (bar_time, regime, btc_dir_4h, btc_dir_1h, btc_dir_15m, gold_dir_4h, snapshot, updated)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (bar_time) do update set regime = excluded.regime, btc_dir_4h = excluded.btc_dir_4h, btc_dir_1h = excluded.btc_dir_1h,
       btc_dir_15m = excluded.btc_dir_15m, gold_dir_4h = excluded.gold_dir_4h, snapshot = excluded.snapshot, updated = now()`,
    [new Date(bar).toISOString(), c.regime.regime, c.btc['4h']?.dir ?? null, c.btc['1h']?.dir ?? null, c.btc['15m']?.dir ?? null, c.gold.h4?.dir ?? null, JSON.stringify(c)],
  )
}

let inFlight = false
let lastAt = 0
/**
 * From the bot's tick: refresh at most every `everyMs`, in the background
 * (never awaited by the trading loop), one at a time. Errors are logged only.
 */
export function contextTick(store: BotStore, db: Db, symbols: string[], now = Date.now(), everyMs = 15 * 60_000): void {
  if (inFlight || now - lastAt < everyMs) return
  inFlight = true
  lastAt = now
  void collectContext(symbols)
    .then((c) => saveContext(store, db, c))
    .catch((e) => console.error('market context', (e as Error).message))
    .finally(() => {
      inFlight = false
    })
}
