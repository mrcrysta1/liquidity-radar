// Pure helpers that turn the server bot's records (serverBot.ts) into chart
// overlays: which records belong to the charted market, entry / exit markers
// snapped to the chart's bars, and the Entry / SL / TP levels of the open
// trade and the latest plan. No DOM, network or chart library here, so
// scripts/test-engines.mjs runs it as is. Types only from serverBot.ts: that
// module reads import.meta.env at load time.
import type { BotPlan, BotTrade } from './serverBot'

const QUOTES = ['USDT', 'USDC', 'FDUSD', 'BUSD', 'USD']

/**
 * The bot's spelling of a market (Binance futures, e.g. BTCUSDT) from any of
 * the chart's: 'BTCUSDT', 'btc/usdt', 'BINANCE:BTCUSDT.P', 'BTC-USDT',
 * 'BTCUSDTPERP' or a bare base ('BTC' -> 'BTCUSDT').
 */
export function botSymbol(s: string): string {
  let x = String(s || '').trim().toUpperCase()
  x = x.replace(/^[A-Z0-9_]+:/, '') // exchange prefix
  x = x.replace(/\.P$|PERP$/, '') // perpetual suffix
  x = x.replace(/[/\-_ ]/g, '')
  if (x && !QUOTES.some((q) => x.endsWith(q))) x += 'USDT'
  return x
}

export const sameMarket = (a: string, b: string): boolean => !!a && !!b && botSymbol(a) === botSymbol(b)

export interface BotMarker {
  /** Bar open time in ms (the chart bar the event falls in). */
  t: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text: string
}

export const BOT_COLORS = { open: '#5ee7ff', win: '#22e08a', loss: '#ff4d5e', entry: '#8fa0b5' }

/** Open time of the bar containing time t, from sorted bar open times; -1 when before the first bar. */
export function barAt(barTimes: number[], t: number): number {
  let lo = 0
  let hi = barTimes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (barTimes[mid] <= t) {
      ans = barTimes[mid]
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export const fmtR = (r: number): string => (r >= 0 ? '+' : '') + r.toFixed(2) + 'R'

function won(t: BotTrade): boolean | null {
  if (t.r_multiple != null) return t.r_multiple > 0
  if (t.pnl_usd != null) return t.pnl_usd > 0
  return null
}

/**
 * Entry and exit markers for the bot's trades on one market, sorted by time.
 * Entries: arrow in the trade's direction. Exits: arrow the other way. Closed
 * trades are green / red by outcome and labelled with their R; open ones are
 * cyan. Trades before the first loaded bar are left out.
 */
export function botTradeMarkers(trades: BotTrade[], sym: string, barTimes: number[]): BotMarker[] {
  if (!barTimes.length) return []
  const out: BotMarker[] = []
  for (const t of trades) {
    if (t.status === 'error' || !sameMarket(t.symbol, sym)) continue
    const long = t.side === 1
    const w = t.status === 'closed' ? won(t) : null
    const color = w == null ? BOT_COLORS.open : w ? BOT_COLORS.win : BOT_COLORS.loss
    const r = t.status === 'closed' && t.r_multiple != null ? ' ' + fmtR(t.r_multiple) : ''
    const open = barAt(barTimes, Date.parse(t.opened_at))
    if (open >= 0)
      out.push({
        t: open,
        position: long ? 'belowBar' : 'aboveBar',
        shape: long ? 'arrowUp' : 'arrowDown',
        color,
        text: 'Bot ' + (long ? 'L' : 'S') + (t.status === 'open' ? ' open' : r),
      })
    if (t.status === 'closed' && t.closed_at) {
      const close = barAt(barTimes, Date.parse(t.closed_at))
      if (close >= 0)
        out.push({
          t: close,
          position: long ? 'aboveBar' : 'belowBar',
          shape: long ? 'arrowDown' : 'arrowUp',
          color,
          text: 'Exit' + (r || (t.exit_reason ? ' ' + t.exit_reason : '')),
        })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

export interface BotLevel {
  price: number
  color: string
  title: string
}

/**
 * Entry / SL / TP lines for the bot's open trade(s) on this market, and for
 * its latest plan when that plan is live (opened) or paper-traded and not
 * already shown as an open trade. A plan whose trade has since closed is
 * stale and left out.
 */
export function botLevels(trades: BotTrade[], plan: BotPlan | null, sym: string): BotLevel[] {
  const out: BotLevel[] = []
  const add = (pre: string, entry: number, sl: number, tp: number) => {
    if (Number.isFinite(entry)) out.push({ price: entry, color: BOT_COLORS.entry, title: pre + ' entry' })
    if (Number.isFinite(sl)) out.push({ price: sl, color: BOT_COLORS.loss, title: pre + ' SL' })
    if (Number.isFinite(tp)) out.push({ price: tp, color: BOT_COLORS.win, title: pre + ' TP' })
  }
  const mine = trades.filter((t) => sameMarket(t.symbol, sym))
  const open = mine.filter((t) => t.status === 'open')
  open.forEach((t) => add('Bot ' + (t.side === 1 ? 'L' : 'S'), t.entry, t.sl, t.tp))
  if (plan && sameMarket(plan.symbol, sym) && (plan.status === 'opened' || plan.status === 'paper')) {
    const linked = plan.tradeId != null ? mine.find((t) => t.id === plan.tradeId) : undefined
    if (!linked) add(plan.status === 'paper' ? 'Paper' : 'Plan', plan.entry, plan.sl, plan.tp)
  }
  return out
}

/** A cheap change key, so a poll that brings nothing new redraws nothing. */
export function botOverlayKey(trades: BotTrade[], plan: BotPlan | null, sym: string): string {
  const mine = trades.filter((t) => sameMarket(t.symbol, sym))
  return (
    botSymbol(sym) +
    '|' +
    mine.map((t) => t.id + ':' + t.status + ':' + (t.closed_at ?? '') + ':' + t.sl + ':' + t.tp).join(',') +
    '|' +
    (plan && sameMarket(plan.symbol, sym) ? plan.t + ':' + plan.status + ':' + (plan.tradeId ?? '') : '')
  )
}
