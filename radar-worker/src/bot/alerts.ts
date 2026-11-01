// Operations alerts to a chat webhook (BOT_ALERT_WEBHOOK), optional.
//
// Unset = disabled, nothing is sent. The body carries both {content} (Discord)
// and {text} (Slack-style), so either kind of incoming webhook works. Sent on:
//   - the kill switch or the daily halt tripping ("entries halted — ...")
//   - a strategy state change (live ↔ probation ↔ shadow)
//   - 'error' events, rate-limited: at most 1 per market per 30 min and 20 per
//     hour in total (a broken market must not flood the channel)
//   - a daily summary, once per UTC day (bot.ts, for the day that just ended)
// A stale heartbeat cannot be seen from inside the bot: the separate workflow
// bot-watchdog.yml (scripts/watchdog.mjs) covers that.
//
// An alert never affects trading: every send has a 5 s timeout, nothing is
// awaited on the trading path (BotStore.onEvent is fire-and-forget) and every
// failure is swallowed.

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>

export interface AlertOptions {
  fetch?: FetchLike
  now?: () => number
  timeoutMs?: number
  /** Prefix of every message. */
  name?: string
}

export const ALERT_LIMITS = { perSymbolMs: 30 * 60_000, perHour: 20, timeoutMs: 5_000, maxLen: 1_800 }

/** The JSON body: Discord reads `content`, Slack-style webhooks read `text`. */
export function alertPayload(text: string): { content: string; text: string } {
  const t = text.length > ALERT_LIMITS.maxLen ? text.slice(0, ALERT_LIMITS.maxLen - 1) + '…' : text
  return { content: t, text: t }
}

/** Which bot_events lines are alerts: 'halt', 'strategy', 'error', or null (not one). */
export function classifyEvent(level: string, msg: string): 'halt' | 'strategy' | 'error' | null {
  if (/^entries halted — /.test(msg)) return 'halt'
  if (/^strategy [\w-]+: (live|probation|shadow) → (live|probation|shadow)\b/.test(msg)) return 'strategy'
  if (level === 'error') return 'error'
  return null
}

export interface DailySummary {
  day: string
  equity: number | null
  /** Equity change over the day (USDT), null when unknown. */
  dayPnl: number | null
  /** Realized P&L of real trades closed that day (USDT). */
  realized: number
  openPositions: number
  /** Trades opened that day, per strategy. */
  perStrategy: Array<{ strategy: string; real: number; shadow: number }>
}

const usd = (v: number) => (v >= 0 ? '+' : '−') + '$' + Math.abs(v).toFixed(2)

export function formatSummary(s: DailySummary): string {
  const lines = [
    `Daily summary ${s.day} (UTC)`,
    `equity ${s.equity == null ? 'unknown' : '$' + s.equity.toFixed(2)} · day ${s.dayPnl == null ? 'n/a' : usd(s.dayPnl)} · realized ${usd(s.realized)}`,
    `open positions ${s.openPositions}`,
    s.perStrategy.length ? 'trades: ' + s.perStrategy.map((x) => `${x.strategy} ${x.real} real / ${x.shadow} paper`).join(' · ') : 'trades: none',
  ]
  return lines.join('\n')
}

export class Alerts {
  readonly enabled: boolean
  private url: string
  private fetch: FetchLike
  private now: () => number
  private timeoutMs: number
  private name: string
  private lastBySymbol = new Map<string, number>()
  private sentTimes: number[] = []
  /** Error alerts dropped by the rate limit since the last one sent (mentioned in the next). */
  private dropped = 0

  constructor(url: string | undefined, o: AlertOptions = {}) {
    this.url = (url ?? '').trim()
    this.enabled = /^https?:\/\//.test(this.url)
    this.fetch = o.fetch ?? ((u, i) => fetch(u, i))
    this.now = o.now ?? Date.now
    this.timeoutMs = o.timeoutMs ?? ALERT_LIMITS.timeoutMs
    this.name = o.name ?? 'Trading bot'
  }

  /** POST one message. Never throws; false when disabled or it failed. */
  async send(text: string): Promise<boolean> {
    if (!this.enabled) return false
    try {
      const r = await this.fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alertPayload(`[${this.name}] ${text}`)),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (!r.ok) console.warn('alert webhook: HTTP ' + r.status)
      return r.ok
    } catch (e) {
      console.warn('alert webhook failed:', (e as Error)?.message || e)
      return false
    }
  }

  /** The rate limit for error alerts; records the send when allowed. */
  private allowError(symbol: string | null): boolean {
    const now = this.now()
    this.sentTimes = this.sentTimes.filter((t) => now - t < 3_600_000)
    const key = symbol || '*'
    const last = this.lastBySymbol.get(key)
    if ((last != null && now - last < ALERT_LIMITS.perSymbolMs) || this.sentTimes.length >= ALERT_LIMITS.perHour) return false
    this.lastBySymbol.set(key, now)
    this.sentTimes.push(now)
    return true
  }

  /** A bot_events line: sends it when it is an alert (see classifyEvent). Never throws. */
  async onEvent(level: string, symbol: string | null, msg: string): Promise<boolean> {
    try {
      const kind = classifyEvent(level, msg)
      if (!kind || !this.enabled) return false
      if (kind === 'error') {
        if (!this.allowError(symbol)) {
          this.dropped++
          return false
        }
        const more = this.dropped ? ` (+${this.dropped} more error(s) held back by the rate limit)` : ''
        this.dropped = 0
        return await this.send(`ERROR ${symbol ?? ''} ${msg}${more}`.replace(/\s+/g, ' ').trim())
      }
      return await this.send((kind === 'halt' ? 'HALT ' : 'STRATEGY ') + msg)
    } catch {
      return false
    }
  }

  /**
   * Once per UTC day: when `lastDay` (stored by the caller) is before today,
   * send the summary of yesterday. Returns the day to store (unchanged if
   * nothing was due). Never throws; a failed send is not retried that day.
   */
  async daily(lastDay: string, load: (day: string, dayStart: number) => Promise<DailySummary>): Promise<string> {
    const today = new Date(this.now()).toISOString().slice(0, 10)
    if (!this.enabled || lastDay >= today) return lastDay
    // First run with alerts on: start from today, no summary of a day not watched.
    if (!lastDay) return today
    try {
      const start = Date.parse(today + 'T00:00:00Z') - 86_400_000
      const day = new Date(start).toISOString().slice(0, 10)
      await this.send(formatSummary(await load(day, start)))
    } catch (e) {
      console.warn('daily summary failed:', (e as Error)?.message || e)
    }
    return today
  }
}
