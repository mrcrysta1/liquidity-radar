// Chart events the AI Insights card lists, and the setup name the journal
// gives each trade. All of them are plain rules read off the candles, so
// every line can be checked against the chart it came from.
import type { CandleFlat } from '../../services/market'
import type { Series } from './features'
import type { Side } from './strategy'

export interface Insight {
  id: string
  title: string
  sub: string
  bull: boolean | null
  barsAgo: number
}

export function insights(cs: CandleFlat[], S: Series, tf: string, lookback = 30): Insight[] {
  const n = cs.length
  const out: Insight[] = []
  const seen = new Set<string>()
  const add = (i: Insight) => {
    if (seen.has(i.id)) return
    seen.add(i.id)
    out.push(i)
  }
  for (let i = n - 1; i >= Math.max(51, n - lookback); i--) {
    const k = cs[i]
    const p = cs[i - 1]
    const ago = n - 1 - i
    const a = S.atr[i] || 1
    // Engulfing: this body swallows the previous opposite body.
    if (k.c > k.o && p.c < p.o && k.c >= p.o && k.o <= p.c && k.c - k.o > 0.3 * a)
      add({ id: 'eng', title: `Bullish engulfing on ${tf}`, sub: 'Buyers took back the whole prior candle', bull: true, barsAgo: ago })
    if (k.c < k.o && p.c > p.o && k.c <= p.o && k.o >= p.c && k.o - k.c > 0.3 * a)
      add({ id: 'eng', title: `Bearish engulfing on ${tf}`, sub: 'Sellers took back the whole prior candle', bull: false, barsAgo: ago })
    // Liquidity sweep: wick through the 20-bar extreme, close back inside.
    let lo = Infinity
    let hi = -Infinity
    for (let j = i - 20; j < i; j++) {
      lo = Math.min(lo, cs[j].l)
      hi = Math.max(hi, cs[j].h)
    }
    if (k.l < lo && k.c > lo)
      add({ id: 'sweep', title: `Liquidity sweep at $${fmt(lo)}`, sub: 'Stops under the range were taken, then reclaimed', bull: true, barsAgo: ago })
    if (k.h > hi && k.c < hi)
      add({ id: 'sweep', title: `Liquidity sweep at $${fmt(hi)}`, sub: 'Stops above the range were taken, then rejected', bull: false, barsAgo: ago })
    // MACD histogram crossing zero.
    const h0 = S.macdHist[i]
    const h1 = S.macdHist[i - 1]
    if (h1 <= 0 && h0 > 0) add({ id: 'macd', title: 'MACD crossover (bullish)', sub: 'Momentum is turning up', bull: true, barsAgo: ago })
    if (h1 >= 0 && h0 < 0) add({ id: 'macd', title: 'MACD crossover (bearish)', sub: 'Momentum is turning down', bull: false, barsAgo: ago })
    // EMA 20 / 50 cross.
    if (S.ema20[i - 1] <= S.ema50[i - 1] && S.ema20[i] > S.ema50[i])
      add({ id: 'ema', title: 'EMA 20 crossed above EMA 50', sub: 'Short-term trend turned up', bull: true, barsAgo: ago })
    if (S.ema20[i - 1] >= S.ema50[i - 1] && S.ema20[i] < S.ema50[i])
      add({ id: 'ema', title: 'EMA 20 crossed below EMA 50', sub: 'Short-term trend turned down', bull: false, barsAgo: ago })
    // RSI leaving an extreme.
    if (S.rsi[i - 1] < 30 && S.rsi[i] >= 30) add({ id: 'rsi', title: 'RSI recovered from oversold', sub: `RSI back above 30 (${S.rsi[i].toFixed(0)})`, bull: true, barsAgo: ago })
    if (S.rsi[i - 1] > 70 && S.rsi[i] <= 70) add({ id: 'rsi', title: 'RSI rolled over from overbought', sub: `RSI back below 70 (${S.rsi[i].toFixed(0)})`, bull: false, barsAgo: ago })
  }
  const f = fibHold(cs, S)
  if (f) add(f)
  return out.sort((a, b) => a.barsAgo - b.barsAgo).slice(0, 6)
}

/** The swing a Fibonacci retracement is drawn on: the last 120 bars' high and low. */
export function fibSwing(cs: CandleFlat[], bars = 120) {
  const w = cs.slice(-bars)
  if (w.length < 20) return null
  let hi = w[0]
  let lo = w[0]
  w.forEach((k) => {
    if (k.h > hi.h) hi = k
    if (k.l < lo.l) lo = k
  })
  const up = lo.t < hi.t
  const range = hi.h - lo.l
  const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({
    r,
    price: up ? hi.h - range * r : lo.l + range * r,
  }))
  return { up, hi: hi.h, lo: lo.l, levels: lv }
}

function fibHold(cs: CandleFlat[], S: Series): Insight | null {
  const s = fibSwing(cs)
  if (!s) return null
  const n = cs.length - 1
  const px = cs[n].c
  const a = S.atr[n] || 1
  const near = s.levels.filter((l) => l.r > 0 && l.r < 1).find((l) => Math.abs(px - l.price) < 0.6 * a)
  if (!near) return null
  const held = s.up ? cs[n].l <= near.price + 0.6 * a && px >= near.price : cs[n].h >= near.price - 0.6 * a && px <= near.price
  return {
    id: 'fib',
    title: `Fibonacci ${(near.r * 100).toFixed(1)}% ${held ? 'retracement holding' : 'retracement in play'}`,
    sub: `${s.up ? 'Support' : 'Resistance'} at $${fmt(near.price)}`,
    bull: s.up,
    barsAgo: 0,
  }
}

/** Name the setup a trade was taken on, and a short note on the conditions. */
export function setupOf(cs: CandleFlat[], S: Series, i: number, side: Side): { setup: string; note: string } {
  const k = cs[i]
  let hi = -Infinity
  let lo = Infinity
  for (let j = Math.max(0, i - 20); j < i; j++) {
    hi = Math.max(hi, cs[j].h)
    lo = Math.min(lo, cs[j].l)
  }
  const trendUp = S.ema20[i] > S.ema50[i]
  const withTrend = (side === 1) === trendUp
  const a = S.atr[i] || 1
  let setup = 'Continuation'
  if (side === 1 ? k.c > hi : k.c < lo) setup = 'Breakout'
  else if (!withTrend && (side === 1 ? S.rsi[i] < 38 : S.rsi[i] > 62)) setup = 'Reversal'
  else if (withTrend && Math.abs(k.c - S.ema20[i]) < 0.6 * a) setup = 'Pullback'
  else if (!withTrend) setup = 'Counter-trend'
  const notes: string[] = []
  if (S.volRatio[i] > 1.4) notes.push('strong volume')
  else if (S.volRatio[i] < 0.7) notes.push('thin volume')
  notes.push(withTrend ? 'with the trend' : 'against the trend')
  notes.push('RSI ' + S.rsi[i].toFixed(0))
  const note = notes.join(', ')
  return { setup, note: note[0].toUpperCase() + note.slice(1) }
}

function fmt(v: number): string {
  return v >= 1000 ? Math.round(v).toLocaleString('en-US') : v >= 1 ? v.toFixed(2) : v.toPrecision(4)
}
