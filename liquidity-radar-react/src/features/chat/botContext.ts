// What Radar AI knows about the testnet bot right now.
//
// A compact plain-text summary of the bot's Supabase records (account,
// strategies, readiness, trades, plans), for the model's context and for the
// built-in analyst's bot answers when no model is configured. Pure: the data
// comes in as a BotSnapshot (botContextLive.ts fills it from serverBot.ts), so
// scripts/test-engines.mjs runs it on fixtures. Every part is optional — a
// loader that failed just leaves its line out or marks it unavailable.
import type { BinanceAccount, BotEvent, BotPlan } from '../selflearn/serverBot'
import type { BotStrategy } from '../selflearn/botStrategies'
import type { JournalRow } from '../selflearn/journal'
import type { Readiness, ReadinessInput } from '../selflearn/readiness'
import { READINESS, computeReadiness } from '../selflearn/readiness.ts'

export interface BotSnapshot {
  now: number
  account?: { account: BinanceAccount | null; heartbeat: { t: number; mode: string; venue: string } | null } | null
  strategies?: BotStrategy[] | null
  plans?: BotPlan[] | null
  /** Real and shadow trades, newest first (serverBot loadJournal). */
  journal?: JournalRow[] | null
  /** Recent bot_events, newest first (serverBot loadBot). */
  events?: BotEvent[] | null
  readiness?: ReadinessInput | null
}

/** The summary's size budget (characters). */
export const BOT_CONTEXT_MAX = 5000

const DAY = 86_400_000
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fR = (v: number | null | undefined, d = 2): string => (v == null || !Number.isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const fUsd = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))
const fPx = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  return v.toFixed(a >= 1000 ? 1 : a >= 1 ? 3 : 6).replace(/\.?0+$/, '')
}
const ago = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m < 60 ? m + ' min' : m < 48 * 60 ? (m / 60).toFixed(1) + ' h' : Math.round(m / 1440) + ' d'
}
const sideOf = (s: 1 | -1 | number): string => (s === -1 ? 'SHORT' : 'LONG')
const startOfUtcDay = (t: number): number => t - (t % DAY)

/** Account equity and how fresh the bot's heartbeat is. */
function accountLines(x: BotSnapshot): string[] {
  const a = x.account
  if (a === undefined) return []
  if (!a) return ['ACCOUNT: unavailable (records could not be read).']
  const out: string[] = []
  const hb = a.heartbeat
  if (hb && Number.isFinite(hb.t)) {
    const age = x.now - hb.t
    out.push(`HEARTBEAT: ${ago(age)} ago (${age <= READINESS.staleMs ? 'running' : 'STALE: the bot looks down'}), mode ${hb.mode || '?'}, venue ${hb.venue || '?'}.`)
  } else out.push('HEARTBEAT: none recorded.')
  const acc = a.account
  if (acc) {
    out.push(
      `ACCOUNT (testnet USDT, read ${ago(x.now - acc.t)} ago): equity ${fUsd(acc.marginBalance)} | wallet ${fUsd(acc.walletBalance)} | unrealized ${fUsd(acc.unrealizedPnl)} | available ${fUsd(acc.availableBalance)} | ${acc.positions?.length ?? 0} positions, ${acc.orders?.length ?? 0} open orders.`,
    )
  } else out.push('ACCOUNT: no snapshot recorded.')
  return out
}

/** Open risk per side from the open real trades and the account's position sizes. */
function riskLines(x: BotSnapshot, open: JournalRow[]): string[] {
  const acc = x.account?.account
  const out: string[] = []
  const eq = acc?.marginBalance
  if (acc && eq && eq > 0) {
    const side = { LONG: 0, SHORT: 0 }
    for (const p of acc.positions || []) {
      const t = open.find((r) => r.symbol === p.symbol)
      if (!t) continue
      // Risk is what the stop in force would still lose; a trailed stop past entry risks nothing.
      const loss = p.side === 'LONG' ? p.entry - t.sl : t.sl - p.entry
      if (loss > 0) side[p.side] += (Math.abs(p.size) * loss) / eq
    }
    out.push(
      `RISK: open risk at stops ${(side.LONG * 100).toFixed(2)}% long, ${(side.SHORT * 100).toFixed(2)}% short of equity. Limits: 0.5% per trade (half on probation), heat cap ~1.5% per side and ~2% total, 3% daily loss halts entries, 15% drawdown kill switch.`,
    )
  }
  const ev = (x.events || []).filter((e) => x.now - Date.parse(e.t) < DAY)
  const halt = ev.find((e) => /halt|kill switch|drawdown/i.test(e.msg))
  if (halt) out.push(`RISK EVENT (${ago(x.now - Date.parse(halt.t))} ago): ${halt.msg.slice(0, 160)}`)
  return out
}

function strategyLines(x: BotSnapshot): string[] {
  if (x.strategies === undefined) return []
  if (!x.strategies) return ['STRATEGIES: unavailable.']
  if (!x.strategies.length) return ['STRATEGIES: none recorded.']
  const bands = x.readiness?.strategies ?? []
  return [
    'STRATEGIES (priority order; state, real/shadow trade counts, rolling 30-trade expectancy, drawdown vs research bands):',
    ...x.strategies.map((s) => {
      const b = bands.find((r) => r.id === s.id)?.bands
      const band = b ? ` (bands: rolling30 p5 ${fR(b.roll30P5)}, dd p95 ${b.ddP95}R)` : s.hasBands ? '' : ' (no bands: never auto-promoted/demoted)'
      const last = s.last ? ` | last move ${s.last.from}→${s.last.to}: ${s.last.reason.slice(0, 80)}` : ''
      return `- ${s.id} ${s.name}: ${s.state.toUpperCase()}${s.state !== s.configured ? ` (configured ${s.configured})` : ''} | real ${s.real}, shadow ${s.shadow} | rolling30 ${fR(s.roll30)} | avg ${fR(s.expR)} | drawdown ${s.ddR == null ? '—' : s.ddR.toFixed(1) + 'R'} (worst ${s.maxDdR == null ? '—' : s.maxDdR.toFixed(1) + 'R'})${band}${last}`
    }),
  ]
}

/** The readiness verdict, from the same computation as the Self Learning panel. */
export function readinessOf(x: BotSnapshot): Readiness | null {
  if (!x.readiness) return null
  try {
    return computeReadiness(x.readiness)
  } catch {
    return null
  }
}

function readinessLines(x: BotSnapshot, r: Readiness | null): string[] {
  if (x.readiness === undefined) return []
  if (!r) return ['GO-LIVE READINESS: unavailable.']
  const days = r.daysLeft == null ? '' : r.daysLeft > 0 ? `, ~${Math.ceil(r.daysLeft)} days until the time and trade-count checks can pass` : ''
  return [
    `GO-LIVE READINESS (real money only when every check passes): ${r.ready ? 'READY' : 'NOT READY'} — ${r.closed} closed real trades of the live set [${r.liveIds.join(', ') || 'none'}]${r.winRate == null ? '' : `, win rate ${(r.winRate * 100).toFixed(0)}% (not a criterion)`}${days}.`,
    ...r.checks.map((c) => `- ${c.label}: ${c.status.toUpperCase()} — ${c.value} (target ${c.target})`),
  ]
}

function tradeLines(x: BotSnapshot): { open: JournalRow[]; lines: string[] } {
  if (x.journal === undefined) return { open: [], lines: [] }
  if (!x.journal) return { open: [], lines: ['TRADES: unavailable.'] }
  const real = x.journal.filter((r) => r.kind === 'real')
  const open = real.filter((r) => r.status === 'open')
  const closed = real.filter((r) => r.status === 'closed').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 10)
  const lines = [
    open.length
      ? `OPEN REAL TRADES (${open.length}):`
      : 'OPEN REAL TRADES: none.',
    ...open.map(
      (t) =>
        `- ${t.symbol} ${sideOf(t.side)} [${t.strategy || t.mode || '?'}] entry ${fPx(t.entry)} | stop in force ${fPx(t.sl)}${Number.isFinite(t.tp) ? ` | target ${fPx(t.tp)}` : ' | no target (trailing stop)'} | opened ${ago(x.now - t.openedAt)} ago`,
    ),
    closed.length ? 'LAST CLOSED REAL TRADES (newest first):' : 'CLOSED REAL TRADES: none yet.',
    ...closed.map((t) => `- ${t.symbol} [${t.strategy || t.mode || '?'}] ${sideOf(t.side)} ${fR(t.r)} exit ${t.exitReason || '?'}${t.closedAt ? `, ${ago(x.now - t.closedAt)} ago` : ''}`),
  ]
  return { open, lines }
}

function todayLine(x: BotSnapshot): string[] {
  if (!x.journal) return []
  const t0 = startOfUtcDay(x.now)
  const real = x.journal.filter((r) => r.kind === 'real')
  const opened = real.filter((r) => r.openedAt >= t0).length
  const closed = real.filter((r) => r.status === 'closed' && (r.closedAt ?? 0) >= t0)
  const sumR = closed.reduce((a, r) => a + (r.r ?? 0), 0)
  const shadow = x.journal.filter((r) => r.kind === 'shadow' && r.openedAt >= t0).length
  const errors = (x.events || []).filter((e) => e.level === 'error' && Date.parse(e.t) >= t0).length
  return [
    `TODAY (UTC): ${opened} real opened, ${closed.length} real closed (${fR(sumR)}), ${shadow} shadow trades${x.events ? `, ${errors} error events` : ''} (counts from the latest records).`,
  ]
}

function planLines(x: BotSnapshot, max: number): string[] {
  if (x.plans === undefined) return []
  if (!x.plans) return ['LATEST PLANS: unavailable.']
  if (!x.plans.length) return ['LATEST PLANS: none recorded.']
  const order = { opened: 0, paper: 1, skipped: 2 } as Record<string, number>
  const rows = x.plans.slice().sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || b.t - a.t)
  const shown = rows.slice(0, max)
  return [
    `LATEST PLAN PER MARKET (${x.plans.length} markets; opened = real order, paper = shadow, skipped = no trade):`,
    ...shown.map(
      (p) =>
        `- ${p.symbol} ${p.interval} ${p.side} [${p.strategyId || p.strategy || 'ml'}] ${p.status} | entry ${fPx(p.entry)} stop ${fPx(p.sl)}${p.tp != null ? ` target ${fPx(p.tp)}` : ''}${p.evR != null ? ` | EV ${fR(p.evR)}` : ''}${p.reasons?.length ? ' | ' + p.reasons[0].slice(0, 70) : ''}`,
    ),
    ...(rows.length > shown.length ? [`(+${rows.length - shown.length} more markets)`] : []),
  ]
}

/**
 * The bot summary for the model, at most `max` characters. Sections in order of
 * importance; plans and then older trades are cut first when it runs long.
 */
export function summarizeBot(x: BotSnapshot, max = BOT_CONTEXT_MAX): string {
  const r = readinessOf(x)
  const { open, lines: trades } = tradeLines(x)
  const build = (plans: number, closedKeep: number): string => {
    let tl = trades
    if (closedKeep < 10) {
      const at = tl.findIndex((l) => l.startsWith('LAST CLOSED'))
      if (at >= 0) tl = tl.slice(0, at + 1 + closedKeep)
    }
    return [
      'BOT STATUS (the 24/7 Binance Futures TESTNET bot — fake money; live records):',
      ...accountLines(x),
      ...riskLines(x, open),
      ...todayLine(x),
      ...strategyLines(x),
      ...readinessLines(x, r),
      ...tl,
      ...planLines(x, plans),
    ].join('\n')
  }
  for (const [plans, closed] of [[12, 10], [6, 10], [3, 6], [0, 3]]) {
    const s = build(plans, closed)
    if (s.length <= max) return s
  }
  return build(0, 3).slice(0, max - 1) + '…'
}

/** Single-flight cache: one load per `ttlMs`; a failure is not cached. */
export function createCache<T>(load: () => Promise<T>, ttlMs = 60_000, clock: () => number = Date.now) {
  let value: { t: number; v: T } | null = null
  let pending: Promise<T> | null = null
  return async (): Promise<T> => {
    if (value && clock() - value.t < ttlMs) return value.v
    if (!pending) {
      pending = load()
        .then((v) => {
          value = { t: clock(), v }
          return v
        })
        .finally(() => {
          pending = null
        })
    }
    return pending
  }
}

// ------------------------------------------------------- built-in analyst

export type BotIntent = 'ready' | 'open' | 'strategies' | 'status'

/** A question about the bot, and which kind. null: not about the bot. */
export function botIntent(raw: string): BotIntent | null {
  const t = ' ' + raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' '
  const botWord = /\b(bot|bots|testnet|trading bot|server bot)\b/.test(t)
  const stratId = /\b(f1|f1x|c6|c2)\b/.test(t)
  if (/\b(real money|go live|going live|mainnet|readiness|ready for real|ready to go live|live money)\b/.test(t)) return 'ready'
  if ((botWord || stratId) && /\bready\b/.test(t)) return 'ready'
  if (/\bopen (trade|trades|position|positions)\b/.test(t) && (botWord || !/\b(how to|how do i|should i)\b/.test(t))) return 'open'
  if ((botWord || stratId) && /\b(position|positions|holding|holdings|in a trade)\b/.test(t)) return 'open'
  if (stratId || (/\bstrateg(y|ies)\b/.test(t) && (botWord || /\b(running|live|shadow|probation|demoted|promoted)\b/.test(t)))) return 'strategies'
  if (botWord) return 'status'
  return null
}

const STATIC_STRATEGIES = [
  'F1 (live): long-only 4h trend breakout — close above EMA(300) and the prior 20-bar high; 3×ATR exchange stop, trailed at the highest high − 4×ATR; exit on a close under the prior 10-bar low or EMA(300).',
  'C6 (shadow): F1’s entries filtered by a GBDT model; exits as F1.',
  'F1X (shadow): F1 with the exit on the prior 15-bar low.',
  'C2 (shadow): the bear-market short mirror of F1 (BTC and the market below EMA(300)).',
  'ML (shadow): the neural-network bracket model on BTC/ETH/SOL/BNB.',
]

/**
 * The built-in analyst's answer to a bot question, as plain lines (the caller
 * escapes them). `x` null: the bot's records are not available here.
 */
export function botReply(intent: BotIntent, x: BotSnapshot | null): string[] {
  if (!x) {
    return [
      'The bot’s live records are not connected on this deployment, so I can’t show its trades or numbers.',
      'What it is: a 24/7 Binance Futures testnet bot (fake money) on 4h candles, 24 markets, 0.5% risk per trade.',
      ...(intent === 'strategies' ? STATIC_STRATEGIES : []),
      ...(intent === 'ready' ? ['It may only be considered for real money once every go-live check passes: 8+ weeks and 60+ real trades, positive expectancy (80% lower bound), drawdown within its research band, 98% uptime, no errors, low slippage, a stop on every trade.'] : []),
    ]
  }
  const r = readinessOf(x)
  const { open, lines: trades } = tradeLines(x)
  if (intent === 'ready') {
    if (!r) return ['The readiness records could not be read right now. Try again in a minute.']
    const bad = r.checks.filter((c) => c.status !== 'pass')
    return [
      r.ready
        ? 'Every go-live check passes. That makes real money worth considering — it does not guarantee profit, and it is your decision.'
        : `Not ready for real money: ${bad.length} of ${r.checks.length} checks are not passing yet.`,
      ...r.checks.map((c) => `${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '…'} ${c.label}: ${c.value} (target ${c.target})`),
      ...(r.daysLeft ? [`About ${Math.ceil(r.daysLeft)} more days before the time and trade-count checks can pass.`] : []),
    ]
  }
  if (intent === 'open') {
    if (!x.journal) return ['The trade records could not be read right now. Try again in a minute.']
    const cut = trades.findIndex((l) => l.includes('CLOSED'))
    return [...(cut >= 0 ? trades.slice(0, cut) : trades), ...riskLines(x, open)].map(tidy)
  }
  if (intent === 'strategies') {
    const s = strategyLines(x)
    return (s.length ? s : ['Strategy records are unavailable.']).map(tidy).concat(['Rules:', ...STATIC_STRATEGIES])
  }
  // Overall status: health, account, today, last few trades, readiness verdict.
  const closed = trades.filter((l) => l.startsWith('- ') && / exit /.test(l)).slice(0, 5)
  return [
    ...accountLines(x),
    ...todayLine(x),
    ...(x.strategies?.length ? ['Strategies: ' + x.strategies.map((s) => `${s.id} ${s.state} (rolling30 ${fR(s.roll30)})`).join(', ') + '.'] : []),
    open.length ? `${open.length} open real trade${open.length > 1 ? 's' : ''}: ${open.map((t) => t.symbol + ' ' + sideOf(t.side)).join(', ')}.` : 'No open real trades.',
    ...(closed.length ? ['Last closed:', ...closed] : []),
    ...(r ? [`Go-live readiness: ${r.ready ? 'READY' : 'NOT READY'} (${r.checks.filter((c) => c.status === 'pass').length}/${r.checks.length} checks pass).`] : []),
  ].map(tidy)
}

/** Section labels read better in a chat bubble as plain sentences. */
function tidy(l: string): string {
  return l.replace(/^([A-Z][A-Z0-9 \-()/]+):/, (_m, h: string) => h.charAt(0) + h.slice(1).toLowerCase() + ':')
}
