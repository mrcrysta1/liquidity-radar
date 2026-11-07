// Market context (research plan P3): BTC on three timeframes, its measured
// correlation with every monitored coin, gold with the dollar and Treasury
// yields, and a 7-class market regime. Pure (tested in test/context.test.ts);
// src/context/collect.ts fetches the bars and stores the result.
//
// Nothing here is fitted to past returns: the thresholds are fixed, round,
// stated below, and only describe the market. Every number is from closed bars
// up to the snapshot; nothing looks ahead.
//
//   direction   per timeframe: close vs EMA(50) and EMA(200), and the slope
//               of EMA(50) over 10 bars → 'up' | 'down' | 'flat'
//   strength    efficiency ratio over 30 bars: |net move| ÷ sum of |moves|
//               (1 = a straight line, ~0 = chop)
//   volatility  ATR(14) % of price and its percentile in the trailing 500 bars
//   regime      on BTC (4h first, 1h to confirm):
//                 high-volatility  4h ATR % in its top 10% of the trailing 500
//                 strong-bull      4h up, ER ≥ 0.3, 1h not down
//                 strong-bear      4h down, ER ≥ 0.3, 1h not up
//                 sideways         ER < 0.15 and close within 1 ATR of EMA(200)
//                 weak-bull/bear   close above / below the 4h EMA(200) otherwise
//                 uncertain        4h flat, or 4h and 1h point opposite ways
//   correlation Pearson of log returns vs BTC over the last window (15m: 192
//               bars ≈ 2 days, 1h: 168 ≈ 7 days, 4h: 180 ≈ 30 days), the
//               beta, and a change test against the window before it (Fisher
//               z; |z| ≥ 2.58 is a change at 99%). Groups: ≥ 0.7 strong,
//               0.4–0.7 moderate, < 0.4 independent.
import type { Bar } from '../bot/features.ts'

export type Dir = 'up' | 'down' | 'flat'
export type Regime = 'strong-bull' | 'weak-bull' | 'strong-bear' | 'weak-bear' | 'sideways' | 'high-volatility' | 'uncertain'
export const REGIMES: Regime[] = ['strong-bull', 'weak-bull', 'sideways', 'weak-bear', 'strong-bear', 'high-volatility', 'uncertain']

export interface TfState {
  /** Close time of the last bar used, ms. */
  t: number
  close: number
  dir: Dir
  ema50: number
  ema200: number
  /** Return over 20 bars, %. */
  roc20: number
  rsi14: number
  /** Efficiency ratio over 30 bars (0–1). */
  er30: number
  /** ATR(14) as % of price, and its percentile (0–1) in the trailing 500 bars. */
  atrPct: number
  atrRank: number
  /** Last bar's volume vs the 20-bar average. */
  volRatio: number
}

export function ema(xs: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = []
  let e = xs[0] ?? 0
  for (let i = 0; i < xs.length; i++) out.push((e = i === 0 ? xs[0] : xs[i] * k + e * (1 - k)))
  return out
}

function atrSeries(b: Bar[], n = 14): number[] {
  const out: number[] = []
  let a = 0
  for (let i = 0; i < b.length; i++) {
    const tr = i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c))
    a = i < n ? (a * i + tr) / (i + 1) : (a * (n - 1) + tr) / n
    out.push(a)
  }
  return out
}

function rsi(c: number[], n = 14): number {
  if (c.length <= n) return 50
  let up = 0
  let dn = 0
  for (let i = 1; i <= n; i++) {
    const d = c[i] - c[i - 1]
    if (d > 0) up += d
    else dn -= d
  }
  up /= n
  dn /= n
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1]
    up = (up * (n - 1) + Math.max(d, 0)) / n
    dn = (dn * (n - 1) + Math.max(-d, 0)) / n
  }
  return dn === 0 ? 100 : 100 - 100 / (1 + up / dn)
}

/** Efficiency ratio of the last n moves. */
export function efficiency(c: number[], n = 30): number {
  if (c.length <= n) return 0
  const end = c.length - 1
  let path = 0
  for (let i = end - n + 1; i <= end; i++) path += Math.abs(c[i] - c[i - 1])
  return path > 0 ? Math.abs(c[end] - c[end - n]) / path : 0
}

/** One timeframe's state from closed bars (oldest first); null with fewer than 220 bars. */
export function tfState(b: Bar[], stepMs: number): TfState | null {
  if (b.length < 220) return null
  const c = b.map((x) => x.c)
  const e50 = ema(c, 50)
  const e200 = ema(c, 200)
  const atr = atrSeries(b)
  const i = b.length - 1
  const pct = atr.map((a, k) => a / c[k])
  const past = pct.slice(Math.max(0, i - 500), i)
  const atrRank = past.length ? past.filter((x) => x < pct[i]).length / past.length : 0.5
  const slope = (e50[i] - e50[i - 10]) / atr[i]
  const above = c[i] > e50[i] && c[i] > e200[i]
  const below = c[i] < e50[i] && c[i] < e200[i]
  const dir: Dir = above && slope > 0 ? 'up' : below && slope < 0 ? 'down' : 'flat'
  const vols = b.slice(-21, -1).map((x) => x.v)
  const avgVol = vols.reduce((a, v) => a + v, 0) / (vols.length || 1)
  return {
    t: b[i].t + stepMs,
    close: c[i],
    dir,
    ema50: e50[i],
    ema200: e200[i],
    roc20: ((c[i] - c[i - 20]) / c[i - 20]) * 100,
    rsi14: rsi(c.slice(-200)),
    er30: efficiency(c),
    atrPct: pct[i] * 100,
    atrRank,
    volRatio: avgVol > 0 ? b[i].v / avgVol : 1,
  }
}

/** The 7-class regime from BTC's 4h state, confirmed by 1h; the reason in words. */
export function regimeOf(h4: TfState | null, h1: TfState | null): { regime: Regime; why: string } {
  if (!h4) return { regime: 'uncertain', why: 'not enough 4h history' }
  const er = h4.er30.toFixed(2)
  if (h4.atrRank >= 0.9) return { regime: 'high-volatility', why: `4h ATR ${h4.atrPct.toFixed(2)}% is in the top ${Math.round((1 - h4.atrRank) * 100) || 1}% of the last 500 bars` }
  const opp = h1 && ((h4.dir === 'up' && h1.dir === 'down') || (h4.dir === 'down' && h1.dir === 'up'))
  if (opp) return { regime: 'uncertain', why: `4h ${h4.dir} but 1h ${h1!.dir}` }
  if (h4.dir === 'up' && h4.er30 >= 0.3) return { regime: 'strong-bull', why: `4h up, efficiency ${er}, 1h ${h1?.dir ?? 'unknown'}` }
  if (h4.dir === 'down' && h4.er30 >= 0.3) return { regime: 'strong-bear', why: `4h down, efficiency ${er}, 1h ${h1?.dir ?? 'unknown'}` }
  const atrAbs = (h4.atrPct / 100) * h4.close
  if (h4.er30 < 0.15 && Math.abs(h4.close - h4.ema200) < atrAbs) return { regime: 'sideways', why: `efficiency ${er} and within 1 ATR of the 4h EMA(200)` }
  if (h4.dir === 'flat' && h4.er30 < 0.15) return { regime: 'uncertain', why: `4h flat, efficiency ${er}` }
  return h4.close > h4.ema200
    ? { regime: 'weak-bull', why: `above the 4h EMA(200), efficiency ${er}` }
    : { regime: 'weak-bear', why: `below the 4h EMA(200), efficiency ${er}` }
}

/** Log returns of two bar series aligned on open time (only bars both have). */
export function alignedReturns(a: Bar[], b: Bar[]): { x: number[]; y: number[] } {
  const m = new Map(b.map((k) => [k.t, k.c]))
  const x: number[] = []
  const y: number[] = []
  let pa: number | null = null
  let pb: number | null = null
  for (const k of a) {
    const cb = m.get(k.t)
    if (cb == null) {
      pa = pb = null
      continue
    }
    if (pa != null && pb != null && pa > 0 && pb > 0) {
      x.push(Math.log(k.c / pa))
      y.push(Math.log(cb / pb))
    }
    pa = k.c
    pb = cb
  }
  return { x, y }
}

export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 10) return null
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += x[i]
    my += y[i]
  }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

export interface Corr {
  /** Correlation of the coin's returns with BTC's over the last window, and the window before it. */
  r: number | null
  prev: number | null
  /** Beta to BTC: a 1% BTC move goes with this % move in the coin. */
  beta: number | null
  n: number
  /** Fisher z of the change; |z| ≥ 2.58 = a change at 99%. */
  z: number | null
  changed: boolean
  group: 'strong' | 'moderate' | 'independent' | null
}

export const CORR_WINDOW: Record<string, number> = { '15m': 192, '1h': 168, '4h': 180 }

/** BTC (x) vs a coin (y): correlation now and in the window before, beta, change test. */
export function correlation(btc: Bar[], coin: Bar[], window: number): Corr {
  const { x, y } = alignedReturns(btc, coin)
  const now = { x: x.slice(-window), y: y.slice(-window) }
  const before = { x: x.slice(-2 * window, -window), y: y.slice(-2 * window, -window) }
  const r = pearson(now.x, now.y)
  const prev = pearson(before.x, before.y)
  let beta: number | null = null
  if (r != null) {
    const sd = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)
    }
    const sx = sd(now.x)
    beta = sx > 0 ? (r * sd(now.y)) / sx : null
  }
  const n1 = now.x.length
  const n2 = before.x.length
  const clip = (v: number) => Math.max(-0.999999, Math.min(0.999999, v))
  const z = r != null && prev != null && n1 > 3 && n2 > 3 ? (Math.atanh(clip(r)) - Math.atanh(clip(prev))) / Math.sqrt(1 / (n1 - 3) + 1 / (n2 - 3)) : null
  return {
    r,
    prev,
    beta,
    n: n1,
    z,
    changed: z != null && Math.abs(z) >= 2.58,
    group: r == null ? null : r >= 0.7 ? 'strong' : r >= 0.4 ? 'moderate' : 'independent',
  }
}

export interface DailyPoint {
  t: number
  c: number
}

/** A daily series' direction: close vs its 20-day EMA and the 5-day change. */
export function dailyTrend(d: DailyPoint[]): { last: number; change5: number; change20: number; dir: Dir } | null {
  if (d.length < 25) return null
  const c = d.map((x) => x.c)
  const e = ema(c, 20)
  const i = c.length - 1
  const change5 = c[i] - c[i - 5]
  const change20 = c[i] - c[i - 20]
  const dir: Dir = c[i] > e[i] && change5 > 0 ? 'up' : c[i] < e[i] && change5 < 0 ? 'down' : 'flat'
  return { last: c[i], change5, change20, dir }
}

/** Correlation of daily % changes of two daily series aligned by UTC day, over the last n days. */
export function dailyCorrelation(a: DailyPoint[], b: DailyPoint[], n = 60): number | null {
  const day = (t: number) => Math.floor(t / 86_400_000)
  const mb = new Map(b.map((x) => [day(x.t), x.c]))
  const pairs = a.filter((x) => mb.has(day(x.t))).map((x) => [x.c, mb.get(day(x.t))!])
  const ra: number[] = []
  const rb: number[] = []
  for (let i = 1; i < pairs.length; i++) {
    ra.push(Math.log(pairs[i][0] / pairs[i - 1][0]))
    rb.push(Math.log(pairs[i][1] / pairs[i - 1][1]))
  }
  return pearson(ra.slice(-n), rb.slice(-n))
}

/** Levels worth knowing: the previous UTC day's high / low and the 20-day high / low, from 1h bars. */
export function keyLevels(h1: Bar[], now: number): { prevDayHigh: number; prevDayLow: number; high20d: number; low20d: number } | null {
  const D = 86_400_000
  const today = Math.floor(now / D) * D
  const prev = h1.filter((b) => b.t >= today - D && b.t < today)
  const last20 = h1.filter((b) => b.t >= today - 20 * D)
  if (!prev.length || !last20.length) return null
  return {
    prevDayHigh: Math.max(...prev.map((b) => b.h)),
    prevDayLow: Math.min(...prev.map((b) => b.l)),
    high20d: Math.max(...last20.map((b) => b.h)),
    low20d: Math.min(...last20.map((b) => b.l)),
  }
}
