// Features for the self-learning engine, computed for every bar in one pass.
//
// Everything is scale-free (distances in ATR, oscillators centred on zero) so
// one model can read BTC at $84k and PEPE at $0.000004 alike, and every array
// is built once per candle set: the old per-bar slicing was O(n²) and far too
// slow to backtest a few thousand bars in the browser.
import type { CandleFlat } from '../../services/market'

export const SL_FEATURES = [
  'ret1',
  'ret3',
  'ret6',
  'ret12',
  'rsi',
  'macd',
  'ema20',
  'ema50',
  'atrPct',
  'volume',
  'bbPos',
  'body',
  'stoch',
  'toHigh',
  'toLow',
] as const

/** First bar with every lookback filled. */
export const WARMUP = 50

export interface Series {
  X: Array<number[] | null>
  atr: number[]
  rsi: number[]
  macdHist: number[]
  ema20: number[]
  ema50: number[]
  stoch: number[]
  volRatio: number[]
}

function ema(v: number[], p: number): number[] {
  const k = 2 / (p + 1)
  const out = new Array<number>(v.length)
  let e = v[0] ?? 0
  for (let i = 0; i < v.length; i++) {
    e = i ? v[i] * k + e * (1 - k) : v[i]
    out[i] = e
  }
  return out
}

export function series(cs: CandleFlat[]): Series {
  const n = cs.length
  const c = cs.map((k) => k.c)
  const e12 = ema(c, 12)
  const e26 = ema(c, 26)
  const macd = c.map((_, i) => e12[i] - e26[i])
  const sig = ema(macd, 9)
  const macdHist = macd.map((m, i) => m - sig[i])
  const ema20 = ema(c, 20)
  const ema50 = ema(c, 50)

  // Wilder RSI(14) and ATR(14).
  const rsi = new Array<number>(n).fill(50)
  const atr = new Array<number>(n).fill(0)
  let ag = 0
  let al = 0
  let tr = 0
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1]
    const g = d > 0 ? d : 0
    const l = d < 0 ? -d : 0
    const t = Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - c[i - 1]), Math.abs(cs[i].l - c[i - 1]))
    if (i <= 14) {
      ag += g / 14
      al += l / 14
      tr += t / 14
    } else {
      ag = (ag * 13 + g) / 14
      al = (al * 13 + l) / 14
      tr = (tr * 13 + t) / 14
    }
    rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al)
    atr[i] = tr
  }

  const stoch = new Array<number>(n).fill(50)
  const volRatio = new Array<number>(n).fill(1)
  const X: Array<number[] | null> = new Array(n).fill(null)
  let vSum = 0
  let cSum = 0
  let c2Sum = 0
  for (let i = 0; i < n; i++) {
    vSum += cs[i].v
    cSum += c[i]
    c2Sum += c[i] * c[i]
    if (i >= 20) {
      vSum -= cs[i - 20].v
      cSum -= c[i - 20]
      c2Sum -= c[i - 20] * c[i - 20]
    }
    const avgV = vSum / Math.min(20, i + 1)
    volRatio[i] = avgV > 0 ? cs[i].v / avgV : 1
    let hh = -Infinity
    let ll = Infinity
    for (let j = Math.max(0, i - 13); j <= i; j++) {
      if (cs[j].h > hh) hh = cs[j].h
      if (cs[j].l < ll) ll = cs[j].l
    }
    stoch[i] = hh > ll ? ((c[i] - ll) / (hh - ll)) * 100 : 50
    if (i < WARMUP) continue
    const a = atr[i]
    if (!(a > 0) || !(c[i] > 0)) continue
    let h20 = -Infinity
    let l20 = Infinity
    for (let j = i - 19; j <= i; j++) {
      if (cs[j].h > h20) h20 = cs[j].h
      if (cs[j].l < l20) l20 = cs[j].l
    }
    const mean = cSum / 20
    const sd = Math.sqrt(Math.max(0, c2Sum / 20 - mean * mean))
    const range = cs[i].h - cs[i].l
    X[i] = [
      (c[i] - c[i - 1]) / a,
      (c[i] - c[i - 3]) / a,
      (c[i] - c[i - 6]) / a,
      (c[i] - c[i - 12]) / a,
      (rsi[i] - 50) / 50,
      macdHist[i] / a,
      (c[i] - ema20[i]) / a,
      (c[i] - ema50[i]) / a,
      (a / c[i]) * 100,
      Math.log(Math.max(0.05, volRatio[i])),
      sd > 0 ? (c[i] - mean) / (2 * sd) : 0,
      range > 0 ? (c[i] - cs[i].o) / range : 0,
      stoch[i] / 100 - 0.5,
      (h20 - c[i]) / a,
      (c[i] - l20) / a,
    ]
  }
  return { X, atr, rsi, macdHist, ema20, ema50, stoch, volRatio }
}
