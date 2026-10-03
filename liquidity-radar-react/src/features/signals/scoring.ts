// Per-timeframe scoring for the signal scanner, as pure functions so it can be
// tested (scripts/test-engines.mjs) and so each indicator's contribution is
// visible: `parts` records what every term added, which is what lets the
// scanner learn a weight per indicator from graded outcomes.
import { aiComposite, calcRSI, forecastFrom, macdSeries } from '../../utils/indicators.ts'
import { pfmt } from '../../utils/format.ts'

export const TF_MINUTES: Record<string, number> = { '1h': 60, '4h': 240, '1d': 1440 }

/** The weight of each scoring term (the scanner's modelWeights). */
export type ScoreWeights = Record<string, number>

/** The terms that are scored, in the order they are evaluated. */
export const SCORE_TERMS = ['rsi', 'macdCross', 'macdTrend', 'ema', 'bb', 'vol', 'diverge'] as const
export type ScoreTerm = (typeof SCORE_TERMS)[number]

export interface CandleRow {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/**
 * Binance returns the still-forming candle last. Scoring it mixes a partial
 * bar into indicators built from closed ones (its volume always reads as
 * "falling"), so it is dropped. Candles carry their open time `t`.
 */
export function closedOnly<T extends { t: number }>(candles: T[], tfKey: string, now = Date.now()): T[] {
  const mins = TF_MINUTES[tfKey]
  if (!mins || !candles.length) return candles
  const last = candles[candles.length - 1]
  return last.t + mins * 60_000 > now ? candles.slice(0, -1) : candles
}

export function scoreTimeframe(candles: CandleRow[], tfKey: string, w: ScoreWeights) {
  const closes = candles.map((c) => c.c)
  const vols = candles.map((c) => c.v)
  if (closes.length < 30) return null
  const a = aiComposite(candles, closes, vols)
  const fc = forecastFrom(closes, TF_MINUTES[tfKey] ?? 60)
  const last = closes[closes.length - 1]
  const reasons: string[] = []
  // Signed contribution of each term (+ = towards BUY).
  const parts: Partial<Record<ScoreTerm | 'sr', number>> = {}
  const add = (term: ScoreTerm | 'sr', v: number, why: string) => {
    parts[term] = (parts[term] ?? 0) + v
    reasons.push(why)
  }

  if (a.rsi < 30) add('rsi', w.rsi, 'RSI oversold (' + a.rsi.toFixed(0) + ')')
  else if (a.rsi > 70) add('rsi', -w.rsi, 'RSI overbought (' + a.rsi.toFixed(0) + ')')
  // Between the extremes RSI reads momentum: under 45 is weak, over 55 strong.
  // (These two used to push the score the opposite way to their own labels.)
  else if (a.rsi < 45) add('rsi', -Math.round(w.rsi * 0.3), 'RSI bearish (' + a.rsi.toFixed(0) + ')')
  else if (a.rsi > 55) add('rsi', Math.round(w.rsi * 0.3), 'RSI bullish (' + a.rsi.toFixed(0) + ')')

  // A cross is the histogram changing sign on the latest bar (it used to be
  // "histogram positive and the previous close fell", which is not a cross).
  const mh = macdSeries(closes).hist
  const hNow = mh[mh.length - 1]
  const hPrev = mh[mh.length - 2]
  if (hNow > 0 && hPrev <= 0) add('macdCross', w.macdCross, 'MACD bullish cross')
  else if (hNow < 0 && hPrev >= 0) add('macdCross', -w.macdCross, 'MACD bearish cross')
  else if (hNow > 0) add('macdTrend', w.macdTrend, 'MACD bullish')
  else add('macdTrend', -w.macdTrend, 'MACD bearish')

  if (last > a.e20) add('ema', w.ema, 'Above EMA20')
  else add('ema', -w.ema, 'Below EMA20')

  if (a.bb.pctB < 10) add('bb', w.bb, 'Lower BB touch')
  else if (a.bb.pctB > 90) add('bb', -w.bb, 'Upper BB stretch')

  if (a.vt === 'RISING') add('vol', w.vol, 'Volume rising')
  else if (a.vt === 'FALLING') add('vol', -w.vol, 'Volume falling')

  // Divergence: price makes a new 10-bar high (low) but RSI is clearly weaker
  // (stronger) than 10 bars ago. RSI is taken over the full history up to each
  // bar. (It used RSI over 10 closes, too few for RSI(14): both read 50 and the
  // divergence never fired.)
  const rsiThen = calcRSI(closes.slice(0, -10))
  const rsiNow = calcRSI(closes)
  const before = closes.slice(-11, -1)
  if (last > Math.max(...before) && rsiNow < rsiThen - 5) add('diverge', -w.diverge, 'Bearish RSI div')
  else if (last < Math.min(...before) && rsiNow > rsiThen + 5) add('diverge', w.diverge, 'Bullish RSI div')

  const swingH = Math.max(...closes.slice(-20))
  const swingL = Math.min(...closes.slice(-20))
  if (last > swingH * 0.995) add('sr', -5, 'Near resistance $' + pfmt(swingH))
  if (last < swingL * 1.005) add('sr', 5, 'Near support $' + pfmt(swingL))

  const raw = Object.values(parts).reduce((s, v) => s + (v ?? 0), 0)
  const score = Math.max(-100, Math.min(100, raw))
  return { score, reasons: reasons.slice(0, 4), parts, ai: a, fc, last, candles }
}
