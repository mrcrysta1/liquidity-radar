// ML2 research (docs/research/ml2-plan-2026-11-21.md, stages A and B): the 12
// inputs and the logistic-regression candidate. Research only — the bot does
// not import this file. Tested in test/research-ml2.test.ts.
//
// Every input at bar i uses only what was known at that bar's close
// (t_i + step): the coin's bars 0..i, BTC's and the other coins' bars that
// opened at or before t_i, and funding settled by the close. Breadth counts
// only coins that were trading at that time.
import type { Bar } from '../bot/features.ts'
import { indicators } from '../bot/features.ts'
import type { Funding } from '../bot/data.ts'
import { clampP, sigmoid, solveSpd } from '../bot/models/common.ts'

export const ML2_INPUTS = [
  'coin_ret48_atr',
  'coin_dist_ema20_atr',
  'coin_atr_pct',
  'coin_log_vol_ratio',
  'btc_dist_ema200_atr',
  'btc_ret48_atr',
  'btc_atr_pct',
  'breadth_above_ema50',
  'breadth_ret12_atr',
  'coin_residual48',
  'coin_corr_btc_30d',
  'coin_funding_3d_bps',
] as const

/** Bars of history an input row needs (EMA(200) settling, 30 days of 4h returns, 48-bar returns). */
export const ML2_WARMUP = 220
/** 30 days of 4h bars. */
const CORR_BARS = 180
/** Funding before the first settled rate (as the research scripts do). */
export const DEFAULT_FUNDING = 0.0001

export function ema(c: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = []
  c.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v))
  return out
}

/** Per-market series the inputs are read from. */
interface Series {
  b: Bar[]
  at: Map<number, number>
  atr: number[]
  ema20: number[]
  ema50: number[]
  ema200: number[]
  volMa: number[]
  logRet: number[]
}

function series(b: Bar[]): Series {
  const ind = indicators(b)
  const c = b.map((x) => x.c)
  return {
    b,
    at: new Map(b.map((x, i) => [x.t, i])),
    atr: ind.atr,
    ema20: ind.ema20,
    ema50: ind.ema50,
    ema200: ema(c, 200),
    volMa: ind.volMa,
    logRet: c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0)),
  }
}

/** Breadth at each bar open time: share of trading coins above their EMA(50), and their mean 12-bar return in ATR. */
function breadth(all: Series[]): Map<number, { above: number; ret12: number }> {
  const acc = new Map<number, { n: number; above: number; ret: number }>()
  for (const s of all)
    for (let i = 50; i < s.b.length; i++) {
      const a = acc.get(s.b[i].t) ?? { n: 0, above: 0, ret: 0 }
      a.n++
      a.above += s.b[i].c > s.ema50[i] ? 1 : 0
      a.ret += (s.b[i].c - s.b[i - 12].c) / (s.atr[i] || 1e-12)
      acc.set(s.b[i].t, a)
    }
  const out = new Map<number, { above: number; ret12: number }>()
  for (const [t, a] of acc) if (a.n >= 3) out.set(t, { above: a.above / a.n, ret12: a.ret / a.n })
  return out
}

/** Mean of the funding rates settled in (t - 3 days, t], or the default before the history starts. */
export function funding3d(f: Funding[], t: number): number {
  const from = t - 3 * 86_400_000
  // First settlement after t, then back over the three days before it.
  let lo = 0
  let hi = f.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (f[m].t <= t) lo = m + 1
    else hi = m
  }
  let s = 0
  let n = 0
  for (let k = lo - 1; k >= 0 && f[k].t > from; k--) {
    s += f[k].rate
    n++
  }
  return n ? s / n : !f.length || t < f[0].t ? DEFAULT_FUNDING : 0
}

function betaCorr(x: number[], y: number[]): { beta: number; corr: number } | null {
  const n = x.length
  if (n < 30) return null
  const mx = x.reduce((a, v) => a + v, 0) / n
  const my = y.reduce((a, v) => a + v, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let k = 0; k < n; k++) {
    sxy += (x[k] - mx) * (y[k] - my)
    sxx += (x[k] - mx) ** 2
    syy += (y[k] - my) ** 2
  }
  if (!(sxx > 0) || !(syy > 0)) return null
  return { beta: sxy / sxx, corr: sxy / Math.sqrt(sxx * syy) }
}

/**
 * The 12 inputs for every bar of every market (null where history is too
 * short or BTC has no bar at that time). Funding lists must be sorted by time.
 */
export function ml2Inputs(bars: Record<string, Bar[]>, fund: Record<string, Funding[]>, stepMs: number, btcSym = 'BTCUSDT'): Record<string, Array<number[] | null>> {
  const S: Record<string, Series> = {}
  for (const [sym, b] of Object.entries(bars)) S[sym] = series(b)
  const btc = S[btcSym]
  if (!btc) throw new Error('BTC bars are needed')
  const br = breadth(Object.values(S))
  const out: Record<string, Array<number[] | null>> = {}
  for (const [sym, s] of Object.entries(S)) {
    const f = fund[sym] ?? []
    out[sym] = s.b.map((x, i) => {
      if (i < ML2_WARMUP) return null
      const j = btc.at.get(x.t)
      const m = br.get(x.t)
      if (j == null || j < ML2_WARMUP || !m) return null
      const a = s.atr[i] || 1e-12
      const ab = btc.atr[j] || 1e-12
      const coinR = s.logRet.slice(i - CORR_BARS + 1, i + 1)
      const btcR = btc.logRet.slice(j - CORR_BARS + 1, j + 1)
      const bc = betaCorr(btcR, coinR)
      if (!bc) return null
      const r48 = Math.log(s.b[i].c / s.b[i - 48].c)
      const b48 = Math.log(btc.b[j].c / btc.b[j - 48].c)
      return [
        (s.b[i].c - s.b[i - 48].c) / a,
        (s.b[i].c - s.ema20[i]) / a,
        (a / s.b[i].c) * 100,
        Math.log((s.b[i].v || 1e-12) / (s.volMa[i] || 1e-12)),
        (btc.b[j].c - btc.ema200[j]) / ab,
        (btc.b[j].c - btc.b[j - 48].c) / ab,
        (ab / btc.b[j].c) * 100,
        m.above,
        m.ret12,
        sym === btcSym ? 0 : (r48 - bc.beta * b48) * 100,
        sym === btcSym ? 1 : bc.corr,
        funding3d(f, x.t + stepMs) * 1e4,
      ]
    })
  }
  return out
}

// ---- M1: L2-regularised logistic regression (Newton / IRLS) ------------------

export interface Logit {
  w: number[]
  b: number
}

/** Fit on already-scaled inputs; `lambda` is the L2 penalty on the weights (not the intercept). */
export function fitLogit(X: number[][], y: number[], lambda = 10, iters = 25): Logit {
  const d = X[0]?.length ?? 0
  const D = d + 1
  let beta = new Array(D).fill(0)
  for (let it = 0; it < iters; it++) {
    const H = new Array(D * D).fill(0)
    const g = new Array(D).fill(0)
    for (let r = 0; r < X.length; r++) {
      const z = beta[d] + X[r].reduce((a, v, k) => a + v * beta[k], 0)
      const p = sigmoid(z)
      const w = Math.max(p * (1 - p), 1e-9)
      const e = p - y[r]
      for (let a = 0; a < D; a++) {
        const xa = a < d ? X[r][a] : 1
        g[a] += e * xa
        for (let c = 0; c <= a; c++) H[a * D + c] += w * xa * (c < d ? X[r][c] : 1)
      }
    }
    for (let a = 0; a < D; a++) for (let c = 0; c < a; c++) H[c * D + a] = H[a * D + c]
    for (let k = 0; k < d; k++) {
      g[k] += lambda * beta[k]
      H[k * D + k] += lambda
    }
    const step = solveSpd(H, g, D)
    beta = beta.map((v, k) => v - step[k])
    if (Math.max(...step.map(Math.abs)) < 1e-8) break
  }
  return { w: beta.slice(0, d), b: beta[d] }
}

export const logitProb = (m: Logit, x: number[]) => clampP(sigmoid(m.b + x.reduce((a, v, k) => a + v * m.w[k], 0)))
