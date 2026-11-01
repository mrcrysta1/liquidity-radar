// Strategy health: is a strategy still behaving like its research said it
// would? Pure functions (tested in test/bot-health.test.ts); the bot feeds them
// every closed real and shadow trade of a strategy and stores the record in
// bot_state 'strategy:<id>'.
//
//   live       real orders. Shadow trades (signals it could not take for real)
//              count too.
//   probation  still real orders, at half the risk per trade: the rolling
//              30-trade expectancy is under its band's 5th percentile, or the
//              drawdown in R from its peak (over the last 100 trades of the
//              segment) is over the 95th.
//   shadow     paper trades only. A live strategy is demoted when the rolling
//              30-trade expectancy falls under the 1st percentile or the
//              drawdown passes the 99th. It is promoted back only after at
//              least 30 new shadow trades since the demotion with a positive
//              expectancy and a drawdown within the 95th percentile.
//
// Shadow trades count in every state, so a demoted strategy can earn its way
// back. A strategy without bands is never moved automatically (no demotion and,
// above all, no promotion): it stays as configured.

export type StrategyState = 'live' | 'probation' | 'shadow'

/** Research figures for a strategy, in R per trade (net of costs). */
export interface HealthBands {
  /** Expected expectancy. */
  expR: number
  /** Rolling 30-trade expectancy: 5th and 1st percentile. */
  roll30P5: number
  roll30P1: number
  /** Drawdown in R from a peak: 95th and 99th percentile. */
  ddP95: number
  ddP99: number
}

/** A closed trade of the strategy. */
export interface Outcome {
  /** Close time, ms. */
  t: number
  /** R after costs. */
  r: number
  kind: 'real' | 'shadow'
}

export interface Transition {
  t: number
  from: StrategyState
  to: StrategyState
  reason: string
}

export interface HealthStats {
  real: number
  shadow: number
  /** Mean R of every closed trade. */
  expR: number | null
  /** Mean R of the last 30 (null with fewer). */
  roll30: number | null
  /** Drawdown in R from the peak, over the last 100 trades of the current segment (since it went live, or since its demotion). */
  ddR: number
  maxDdR: number
  /** Trades and mean R in the current segment. */
  segN: number
  segExpR: number | null
}

export interface HealthRecord {
  id: string
  /** Set by the bot when it stores the record (strategies.ts refreshHealth), for the website. */
  name?: string
  /** 1 = first in BOT_STRATEGIES: first claim on a market's one real position. */
  priority?: number
  state: StrategyState
  /** The state BOT_STRATEGIES gave it; a change there resets the record to it. */
  configured: 'live' | 'shadow'
  /** When the current state began. */
  since: number
  /** Start of the current segment: going live (config or promotion) or the demotion. Probation keeps it. */
  segmentStart: number
  hasBands: boolean
  stats: HealthStats
  /** Newest last, at most HEALTH.historyMax. */
  history: Transition[]
  updated: number
}

export const HEALTH = { window: 30, minRecover: 30, historyMax: 50, ddWindow: 100, probationRisk: 0.5 }

/** Risk per trade multiplier for a strategy in this state: probation trades at half risk. */
export const riskScale = (s: StrategyState): number => (s === 'probation' ? HEALTH.probationRisk : 1)

/** May a strategy in this state place real orders? */
export const isLive = (s: StrategyState): boolean => s === 'live' || s === 'probation'

const mean = (r: number[]) => (r.length ? r.reduce((a, x) => a + x, 0) / r.length : null)

/** Mean of the last n (null when there are fewer than n). */
export function rollingExp(r: number[], n = HEALTH.window): number | null {
  return r.length >= n ? mean(r.slice(-n)) : null
}

/** Drawdown of the cumulative R curve: now (from the running peak) and the worst, both >= 0. */
export function drawdownR(r: number[]): { current: number; max: number } {
  let cum = 0
  let peak = 0
  let max = 0
  for (const x of r) {
    cum += x
    if (cum > peak) peak = cum
    if (peak - cum > max) max = peak - cum
  }
  return { current: peak - cum, max }
}

const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2) + 'R'

/**
 * The next health record of a strategy from all its closed trades (any order).
 * `transition` is set when the state changed (bot_events gets one line per transition).
 */
export function evaluateHealth(
  prev: HealthRecord | null,
  slot: { id: string; state: 'live' | 'shadow' },
  outcomes: Outcome[],
  bands: HealthBands | undefined,
  now: number,
): { record: HealthRecord; transition: Transition | null } {
  const all = [...outcomes].sort((a, b) => a.t - b.t)
  const history = prev?.history ?? []
  // The state as it stands; `move` changes it and records why.
  const cur: { state: StrategyState; since: number; segmentStart: number; transition: Transition | null } = prev && prev.configured === slot.state
    ? { state: prev.state, since: prev.since, segmentStart: prev.segmentStart, transition: null }
    : // First run, or the configuration was changed on purpose: start as configured.
      { state: prev?.state ?? slot.state, since: prev?.since ?? now, segmentStart: now, transition: null }
  const move = (to: StrategyState, reason: string) => {
    cur.transition = { t: now, from: cur.state, to, reason }
    cur.state = to
    cur.since = now
  }
  if (cur.state !== slot.state && (!prev || prev.configured !== slot.state)) move(slot.state, `configured ${slot.state} (BOT_STRATEGIES)`)
  const r = all.map((o) => o.r)
  const roll30 = rollingExp(r)
  const seg = all.filter((o) => o.t > cur.segmentStart).map((o) => o.r)
  // The bands are drawdowns within 100 trades: judged on the last 100 of the segment.
  const dd = drawdownR(seg.slice(-HEALTH.ddWindow))
  const segExp = mean(seg)
  if (bands && !cur.transition) {
    if (isLive(cur.state)) {
      if (roll30 != null && roll30 < bands.roll30P1) {
        move('shadow', `rolling ${HEALTH.window}-trade expectancy ${f(roll30)} < p1 ${f(bands.roll30P1)}`)
        cur.segmentStart = now
      } else if (dd.current > bands.ddP99) {
        move('shadow', `drawdown ${dd.current.toFixed(1)}R > p99 ${bands.ddP99}R`)
        cur.segmentStart = now
      } else {
        const warn: string[] = []
        if (roll30 != null && roll30 < bands.roll30P5) warn.push(`rolling ${HEALTH.window}-trade expectancy ${f(roll30)} < p5 ${f(bands.roll30P5)}`)
        if (dd.current > bands.ddP95) warn.push(`drawdown ${dd.current.toFixed(1)}R > p95 ${bands.ddP95}R`)
        if (warn.length && cur.state === 'live') move('probation', warn.join('; '))
        else if (!warn.length && cur.state === 'probation') move('live', 'back within its bands')
      }
    } else if (
      seg.length >= HEALTH.minRecover &&
      segExp != null &&
      segExp > 0 &&
      dd.max <= bands.ddP95 &&
      // Not straight back out: the rolling window must also clear the demotion line.
      !(roll30 != null && roll30 < bands.roll30P1)
    ) {
      move('live', `${seg.length} shadow trades since ${prev?.history.at(-1)?.to === 'shadow' ? 'the demotion' : 'it started'}: ${f(segExp)}/trade, max drawdown ${dd.max.toFixed(1)}R ≤ p95 ${bands.ddP95}R`)
      cur.segmentStart = now
    }
  }
  const segNow = all.filter((o) => o.t > cur.segmentStart).map((o) => o.r)
  const ddNow = drawdownR(segNow.slice(-HEALTH.ddWindow))
  const record: HealthRecord = {
    id: slot.id,
    state: cur.state,
    configured: slot.state,
    since: cur.since,
    segmentStart: cur.segmentStart,
    hasBands: !!bands,
    stats: {
      real: all.filter((o) => o.kind === 'real').length,
      shadow: all.filter((o) => o.kind === 'shadow').length,
      expR: mean(r),
      roll30,
      ddR: ddNow.current,
      maxDdR: ddNow.max,
      segN: segNow.length,
      segExpR: mean(segNow),
    },
    history: cur.transition ? [...history, cur.transition].slice(-HEALTH.historyMax) : history,
    updated: now,
  }
  return { record, transition: cur.transition }
}
