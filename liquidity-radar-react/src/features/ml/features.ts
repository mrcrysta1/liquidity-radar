// Turns raw candles into the feature vectors the direction model trains and
// predicts on. Every feature here is a *ratio* or *bounded oscillator*
// (percent, z-score-able return, 0–100 index) rather than a raw price —
// the model has to work across BTC-at-$60k and PEPE-at-$0.000001 with the
// same weights, so nothing scale-dependent can leak in.
import type { CandleFlat } from '../../services/market'
import { calcRSI, calcMACD, calcBB, calcATR, emaArr } from '../../utils/indicators'

export const FEATURE_NAMES = [
  'ret1',
  'ret3',
  'ret10',
  'rsi',
  'macdHistPct',
  'emaDistPct',
  'bbPctB',
  'volRatio',
  'atrPct',
] as const

export type FeatureVector = number[]

/** One row of features computed as of candle index `i` (needs i >= 20 for
 * the lookback windows below to be meaningful). */
function featuresAt(candles: CandleFlat[], i: number): FeatureVector | null {
  if (i < 20) return null
  const window = candles.slice(0, i + 1)
  const closes = window.map((c) => c.c)
  const last = closes[closes.length - 1]
  if (!(last > 0)) return null

  const ret = (n: number) => {
    const prev = closes[closes.length - 1 - n]
    return prev > 0 ? (last / prev - 1) * 100 : 0
  }
  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)
  const e20 = emaArr(closes, 20)
  const emaDistPct = ((last / e20[e20.length - 1] - 1) * 100) || 0
  const bb = calcBB(closes)
  const atr = calcATR(window, 14)
  const vols = window.map((c) => c.v as number)
  const volAvg = vols.slice(-20).reduce((a, b) => a + b, 0) / 20
  const volNow = vols[vols.length - 1]
  const volRatio = volAvg > 0 ? volNow / volAvg : 1

  return [
    ret(1),
    ret(3),
    ret(10),
    rsi,
    (macd.hist / last) * 100,
    emaDistPct,
    bb.pctB,
    volRatio,
    (atr / last) * 100,
  ]
}

export interface Sample {
  x: FeatureVector
  /** 1 if price rose over the horizon, 0 if it fell/flat. */
  y: number
}

/**
 * Build a labeled training set: one sample per candle that has both enough
 * history behind it (features) and enough future ahead of it (label).
 * `horizon` is in candles — how far ahead the label looks.
 */
export function buildDataset(candles: CandleFlat[], horizon = 3): Sample[] {
  const out: Sample[] = []
  for (let i = 20; i < candles.length - horizon; i++) {
    const f = featuresAt(candles, i)
    if (!f) continue
    const now = candles[i].c
    const future = candles[i + horizon].c
    if (!(now > 0)) continue
    out.push({ x: f, y: future > now ? 1 : 0 })
  }
  return out
}

/** Features for the *current* (latest) candle — what the live prediction runs on. */
export function latestFeatures(candles: CandleFlat[]): FeatureVector | null {
  return featuresAt(candles, candles.length - 1)
}

/**
 * Feature vector at every valid index, paired with the single-bar forward
 * return from that point — the raw material an RL agent's reward function
 * is built from (features.ts stays the one place "what does the market look
 * like at bar i" is computed, whether the caller is doing supervised or
 * reinforcement learning with it).
 */
export interface StepData {
  i: number
  x: FeatureVector
  /** (close[i+1] - close[i]) / close[i] */
  fwdReturn: number
}
export function allSteps(candles: CandleFlat[]): StepData[] {
  const out: StepData[] = []
  for (let i = 20; i < candles.length - 1; i++) {
    const x = featuresAt(candles, i)
    if (!x) continue
    const now = candles[i].c
    const next = candles[i + 1].c
    if (!(now > 0)) continue
    out.push({ i, x, fwdReturn: next / now - 1 })
  }
  return out
}
