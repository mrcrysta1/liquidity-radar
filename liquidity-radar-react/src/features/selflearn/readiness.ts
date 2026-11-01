// Go-live readiness: is the testnet bot's record good enough to consider real
// money? Pure (tested in scripts/test-engines.mjs); serverBot.ts loadReadiness
// fetches the rows. READY only when every criterion passes. Win rate is shown
// but is NOT a criterion (a trend strategy wins rarely and still makes money).
//
// The "live strategy set" is every strategy BOT_STRATEGIES configures live
// (bot_state 'strategy:*' configured = 'live'); its real trades are the
// bot_trades rows whose strategy column names one of them (rows from before the
// strategy column existed are a different setup and do not count).

export type CheckStatus = 'pass' | 'fail' | 'insufficient'

export interface ReadinessCheck {
  id: 'weeks' | 'trades' | 'expectancy' | 'drawdown' | 'uptime' | 'errors' | 'slippage' | 'stops' | 'state'
  label: string
  status: CheckStatus
  value: string
  target: string
  note?: string
  /** Time / trade-count checks: estimated days until it passes (null: unknown). */
  daysLeft?: number | null
}

export interface ReadinessTrade {
  strategy: string | null
  status: string
  opened_at: string
  closed_at: string | null
  r_multiple: number | null
  slippage_bps: number | null
  sl_algo_id: number | null
}

export interface ReadinessEvent {
  t: string
  level: string
  symbol: string | null
  msg: string
}

export interface ReadinessBands {
  roll30P5: number
  ddP95: number
}

export interface ReadinessStrategy {
  id: string
  state: 'live' | 'probation' | 'shadow'
  configured: 'live' | 'shadow'
  bands?: ReadinessBands | null
}

export interface ReadinessInput {
  now: number
  /** Real trades with a strategy set, any order. */
  trades: ReadinessTrade[]
  /** 'error' events of the last 7 days (more is fine: filtered here). */
  errors: ReadinessEvent[]
  /** 'error' events saying an exchange stop could not be placed, any time. */
  stopEvents: ReadinessEvent[]
  /** bot_equity timestamps (ms) of the last 14 days: one row per hour the bot ran. */
  equityTimes: number[]
  /** bot_state 'heartbeat' t (ms), null when none. */
  heartbeat: number | null
  strategies: ReadinessStrategy[]
}

export interface Readiness {
  ready: boolean
  checks: ReadinessCheck[]
  /** Not a go-live criterion. */
  winRate: number | null
  closed: number
  liveIds: string[]
  /** First real trade of the live strategy set (ms). */
  since: number | null
  /** Estimated days until the time and trade-count checks both pass (null: unknown, 0: done). */
  daysLeft: number | null
}

export const READINESS = {
  minDays: 56,
  minTrades: 60,
  /** Expectancy and drawdown are judged only on at least this many closed trades. */
  minForStats: 30,
  uptimeDays: 14,
  minUptime: 0.98,
  /** A heartbeat older than this means the bot is down now. */
  staleMs: 30 * 60_000,
  errorDays: 7,
  maxSlippageBps: 15,
  /** An open trade younger than this may not have its stop recorded yet. */
  stopGraceMs: 5 * 60_000,
  confidence: 0.8,
}

/**
 * 'error' events that do not concern the safety of real orders, so they do not
 * count against operations. Each is a model (shadow-only) housekeeping message.
 */
export const BENIGN_ERRORS: Array<{ re: RegExp; why: string }> = [
  {
    re: /^retrain failed: not enough history/,
    why: 'the shadow model cannot train on a market with a short history; no order is involved and it retries later',
  },
]

/**
 * Research bands (radar-worker/src/bot/strategies.ts F1_HEALTH, C6_HEALTH,
 * C2_HEALTH), used when a strategy record does not carry its own `bands` yet.
 */
export const FALLBACK_BANDS: Record<string, ReadinessBands> = {
  f1: { roll30P5: -0.33, ddP95: 22.1 },
  c6: { roll30P5: -0.32, ddP95: 21.4 },
  c2: { roll30P5: -0.38, ddP95: 26.1 },
}

const DAY = 86_400_000
const HOUR = 3_600_000
const mean = (r: number[]) => r.reduce((a, x) => a + x, 0) / r.length
const fr = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d) + 'R'

/** One-sided Student t quantile (Cornish-Fisher expansion of the normal one; fine for df >= 5). */
export function tQuantile(p: number, df: number): number {
  const z = normalQuantile(p)
  const z3 = z ** 3
  const z5 = z ** 5
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df)
}

/** Acklam's rational approximation of the inverse normal CDF. */
function normalQuantile(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const lo = 0.02425
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - lo) return -normalQuantile(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** One-sided lower confidence bound of the mean (t interval); null with fewer than 2. */
export function meanLowerBound(r: number[], conf = READINESS.confidence): number | null {
  if (r.length < 2) return null
  const m = mean(r)
  const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1))
  return m - tQuantile(conf, r.length - 1) * (sd / Math.sqrt(r.length))
}

/** Worst drawdown of the cumulative R curve (>= 0). */
export function maxDrawdownR(r: number[]): number {
  let cum = 0
  let peak = 0
  let max = 0
  for (const x of r) {
    cum += x
    peak = Math.max(peak, cum)
    max = Math.max(max, peak - cum)
  }
  return max
}

/**
 * Share of the completed hours in the last `days` days with a bot_equity row
 * (the bot writes one per hour it runs). Null when the record is shorter than
 * that window.
 */
export function hourlyCoverage(times: number[], now: number, days = READINESS.uptimeDays): { share: number; covered: number; expected: number } | null {
  const end = now - (now % HOUR) // the current hour is not complete
  const start = end - days * 24 * HOUR
  const ok = times.filter((t) => Number.isFinite(t))
  if (!ok.length || Math.min(...ok) > start) return null
  const seen = new Set<number>()
  for (const t of ok) if (t >= start && t < end) seen.add(t - (t % HOUR))
  const expected = days * 24
  return { share: seen.size / expected, covered: seen.size, expected }
}

const benign = (msg: string) => BENIGN_ERRORS.some((b) => b.re.test(msg))

export function computeReadiness(x: ReadinessInput): Readiness {
  const { now } = x
  const liveIds = x.strategies.filter((s) => s.configured === 'live').map((s) => s.id)
  const trades = x.trades.filter((t) => t.strategy != null && liveIds.includes(t.strategy))
  const opened = trades.map((t) => Date.parse(t.opened_at)).filter(Number.isFinite)
  const since = opened.length ? Math.min(...opened) : null
  const closed = trades
    .filter((t) => t.status === 'closed' && t.r_multiple != null && Number.isFinite(Number(t.r_multiple)))
    .sort((a, b) => Date.parse(a.closed_at ?? a.opened_at) - Date.parse(b.closed_at ?? b.opened_at))
  const r = closed.map((t) => Number(t.r_multiple))
  const n = r.length
  const checks: ReadinessCheck[] = []

  // 1. Track record: time and closed trades.
  const days = since == null ? 0 : (now - since) / DAY
  const timeLeft = since == null ? null : Math.max(0, READINESS.minDays - days)
  checks.push({
    id: 'weeks',
    label: 'Live testnet track record',
    status: days >= READINESS.minDays ? 'pass' : 'insufficient',
    value: since == null ? 'no real trade yet' : `${(days / 7).toFixed(1)} weeks`,
    target: `≥ ${READINESS.minDays / 7} weeks since the first real trade`,
    daysLeft: timeLeft,
  })
  // Trade rate so far, once there is at least a day of record.
  const rate = since != null && days >= 1 && n > 0 ? n / days : null
  const tradesLeft = n >= READINESS.minTrades ? 0 : rate ? (READINESS.minTrades - n) / rate : null
  checks.push({
    id: 'trades',
    label: 'Closed real trades',
    status: n >= READINESS.minTrades ? 'pass' : 'insufficient',
    value: String(n),
    target: `≥ ${READINESS.minTrades}`,
    note: rate ? `${(rate * 7).toFixed(1)} per week so far` : undefined,
    daysLeft: tradesLeft,
  })

  // Bands: the live strategies' (the tightest, when several are live).
  const bands = liveIds
    .map((id) => x.strategies.find((s) => s.id === id)?.bands ?? FALLBACK_BANDS[id])
    .filter((b): b is ReadinessBands => !!b && Number.isFinite(b.roll30P5) && Number.isFinite(b.ddP95))
  const p5 = bands.length ? Math.max(...bands.map((b) => b.roll30P5)) : null
  const p95 = bands.length ? Math.min(...bands.map((b) => b.ddP95)) : null

  // 2. Expectancy.
  const m = n ? mean(r) : null
  const lb = meanLowerBound(r)
  const roll30 = n >= 30 ? mean(r.slice(-30)) : null
  checks.push({
    id: 'expectancy',
    label: 'Expectancy (net R per trade)',
    status:
      n < READINESS.minForStats || m == null
        ? 'insufficient'
        : m > 0 && (p5 == null || (roll30 != null && roll30 >= p5))
          ? 'pass'
          : 'fail',
    value:
      m == null
        ? '—'
        : `${fr(m, 3)}${lb != null ? ` · 80% lower bound ${fr(lb, 3)}` : ''}${roll30 != null ? ` · last 30 ${fr(roll30)}` : ''}`,
    target: `mean > 0R${p5 != null ? ` and last 30 ≥ p5 ${fr(p5)}` : ''}`,
    note: n < READINESS.minForStats ? `judged from ${READINESS.minForStats} closed trades` : p5 == null ? 'no health band for the live strategy' : undefined,
  })

  // 3. Drawdown in R since the start.
  const dd = maxDrawdownR(r)
  checks.push({
    id: 'drawdown',
    label: 'Max drawdown (R)',
    status: p95 == null ? 'insufficient' : dd > p95 ? 'fail' : n < READINESS.minForStats ? 'insufficient' : 'pass',
    value: n ? dd.toFixed(1) + 'R' : '—',
    target: p95 == null ? 'within the p95 band (none known)' : `≤ p95 ${p95}R`,
  })

  // 4a. Operations: uptime. Proxy: bot_equity has one row per hour the bot ran
  // and read its balance; the heartbeat itself is a single overwritten row.
  const cov = hourlyCoverage(x.equityTimes, now)
  const hbAge = x.heartbeat == null ? null : now - x.heartbeat
  const stale = hbAge == null || hbAge > READINESS.staleMs
  checks.push({
    id: 'uptime',
    label: `Uptime, last ${READINESS.uptimeDays} days`,
    status: cov == null ? (stale && x.heartbeat != null ? 'fail' : 'insufficient') : cov.share >= READINESS.minUptime && !stale ? 'pass' : 'fail',
    value: `${cov == null ? 'under 14 days of record' : `${(cov.share * 100).toFixed(1)}% (${cov.covered}/${cov.expected} h)`} · heartbeat ${hbAge == null ? 'none' : Math.round(hbAge / 60_000) + ' min ago'}`,
    target: `≥ ${READINESS.minUptime * 100}% and a heartbeat under ${READINESS.staleMs / 60_000} min old`,
    note: 'hours with an equity record (written hourly while the bot runs) stand in for 15-min heartbeat windows',
  })

  // 4b. Errors in the last 7 days, benign ones aside.
  const errCut = now - READINESS.errorDays * DAY
  const errs = x.errors.filter((e) => e.level === 'error' && Date.parse(e.t) >= errCut && !benign(e.msg))
  checks.push({
    id: 'errors',
    label: `Errors, last ${READINESS.errorDays} days`,
    status: errs.length === 0 ? 'pass' : 'fail',
    value: String(errs.length),
    target: '0 (benign ones excluded)',
    note: errs[0] ? `latest: ${errs[0].symbol ? errs[0].symbol + ' ' : ''}${errs[0].msg.slice(0, 120)}` : undefined,
  })

  // 5a. Slippage.
  const slip = trades.map((t) => t.slippage_bps).filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number)
  const avgSlip = slip.length ? mean(slip) : null
  checks.push({
    id: 'slippage',
    label: 'Average entry slippage',
    status: avgSlip == null ? 'insufficient' : avgSlip <= READINESS.maxSlippageBps ? 'pass' : 'fail',
    value: avgSlip == null ? '—' : `${avgSlip.toFixed(1)} bps (${slip.length} fills)`,
    target: `≤ ${READINESS.maxSlippageBps} bps`,
  })

  // 5b. Every real trade had its exchange stop.
  const failedStops = x.stopEvents.filter((e) => e.level === 'error' && /stop could not be placed/.test(e.msg) && (since == null || Date.parse(e.t) >= since))
  const unprotected = trades.filter((t) => t.status === 'open' && t.sl_algo_id == null && now - Date.parse(t.opened_at) > READINESS.stopGraceMs)
  const missing = failedStops.length + unprotected.length
  checks.push({
    id: 'stops',
    label: 'Exchange stop on every trade',
    status: missing > 0 ? 'fail' : since == null ? 'insufficient' : 'pass',
    value: missing ? `${failedStops.length} failed stop(s), ${unprotected.length} open without one` : 'none missing',
    target: '0 trades without an exchange stop',
  })

  // 6. Strategy states.
  const live = x.strategies.filter((s) => s.configured === 'live')
  const off = live.filter((s) => s.state !== 'live')
  checks.push({
    id: 'state',
    label: 'Live strategy state',
    status: !live.length ? 'insufficient' : off.length ? 'fail' : 'pass',
    value: live.length ? live.map((s) => `${s.id.toUpperCase()} ${s.state}`).join(', ') : 'no live strategy',
    target: 'live (not probation or shadow)',
  })

  const wins = r.filter((v) => v > 0).length
  return {
    ready: checks.every((c) => c.status === 'pass'),
    checks,
    winRate: n ? wins / n : null,
    closed: n,
    liveIds,
    since,
    daysLeft: timeLeft == null || (tradesLeft == null && n < READINESS.minTrades) ? null : Math.max(timeLeft, tradesLeft ?? 0),
  }
}
