// Indicator maths, ported from the Pro terminal's core/indicators/index.ts and
// adapted to this app's flat candle shape ({t,o,h,l,c,v}). Every function
// returns a series the same length as its input, with `null` where the
// indicator has not warmed up yet, so a series index always lines up with a
// candle index.
import type { CandleFlat } from '../../../services/market'

export type Series = (number | null)[]
const NaNs = (n: number): Series => Array(n).fill(null)

export function sma(v: number[], p: number): Series {
  const out = NaNs(v.length)
  let s = 0
  for (let i = 0; i < v.length; i++) {
    s += v[i]
    if (i >= p) s -= v[i - p]
    if (i >= p - 1) out[i] = s / p
  }
  return out
}

export function ema(v: number[], p: number): Series {
  const out = NaNs(v.length)
  const k = 2 / (p + 1)
  let prev: number | null = null
  let seed = 0
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) {
      seed += v[i]
      continue
    }
    if (i === p - 1) {
      seed += v[i]
      prev = seed / p
      out[i] = prev
      continue
    }
    prev = v[i] * k + (prev as number) * (1 - k)
    out[i] = prev
  }
  return out
}

export function wma(v: number[], p: number): Series {
  const out = NaNs(v.length)
  const den = (p * (p + 1)) / 2
  for (let i = p - 1; i < v.length; i++) {
    let s = 0
    for (let j = 0; j < p; j++) s += v[i - j] * (p - j)
    out[i] = s / den
  }
  return out
}

export function rsi(close: number[], p = 14): Series {
  const out = NaNs(close.length)
  let g = 0
  let l = 0
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1]
    const up = Math.max(d, 0)
    const dn = Math.max(-d, 0)
    if (i <= p) {
      g += up
      l += dn
      if (i === p) {
        g /= p
        l /= p
        out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
      }
      continue
    }
    g = (g * (p - 1) + up) / p
    l = (l * (p - 1) + dn) / p
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return out
}

export function macd(close: number[], fast = 12, slow = 26, sig = 9) {
  const f = ema(close, fast)
  const s = ema(close, slow)
  const line: Series = close.map((_, i) =>
    f[i] != null && s[i] != null ? (f[i] as number) - (s[i] as number) : null,
  )
  const start = line.findIndex((x) => x != null)
  if (start === -1) return { line, signal: NaNs(close.length), hist: NaNs(close.length) }
  const sigE = ema(line.slice(start) as number[], sig)
  const signal: Series = [...NaNs(start), ...sigE]
  const hist: Series = line.map((x, i) =>
    x != null && signal[i] != null ? x - (signal[i] as number) : null,
  )
  return { line, signal, hist }
}

export function bollinger(close: number[], p = 20, mult = 2) {
  const mid = sma(close, p)
  const upper = NaNs(close.length)
  const lower = NaNs(close.length)
  for (let i = p - 1; i < close.length; i++) {
    const m = mid[i] as number
    let v = 0
    for (let j = i - p + 1; j <= i; j++) v += (close[j] - m) ** 2
    const sd = Math.sqrt(v / p)
    upper[i] = m + mult * sd
    lower[i] = m - mult * sd
  }
  return { mid, upper, lower }
}

export function trueRange(c: CandleFlat[]): number[] {
  return c.map((k, i) =>
    i === 0
      ? k.h - k.l
      : Math.max(k.h - k.l, Math.abs(k.h - c[i - 1].c), Math.abs(k.l - c[i - 1].c)),
  )
}

export function atr(c: CandleFlat[], p = 14): Series {
  const tr = trueRange(c)
  const out = NaNs(c.length)
  let prev = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < p) {
      prev += tr[i]
      if (i === p - 1) {
        prev /= p
        out[i] = prev
      }
      continue
    }
    prev = (prev * (p - 1) + tr[i]) / p
    out[i] = prev
  }
  return out
}

/** Session VWAP — resets each UTC day. */
export function vwap(c: CandleFlat[]): Series {
  const out = NaNs(c.length)
  let pv = 0
  let vol = 0
  let day = -1
  for (let i = 0; i < c.length; i++) {
    const d = Math.floor(c[i].t / 86400000)
    if (d !== day) {
      day = d
      pv = 0
      vol = 0
    }
    const tp = (c[i].h + c[i].l + c[i].c) / 3
    pv += tp * c[i].v
    vol += c[i].v
    out[i] = vol ? pv / vol : null
  }
  return out
}

export function stochastic(c: CandleFlat[], kP = 14, dP = 3) {
  const k = NaNs(c.length)
  for (let i = kP - 1; i < c.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - kP + 1; j <= i; j++) {
      hi = Math.max(hi, c[j].h)
      lo = Math.min(lo, c[j].l)
    }
    k[i] = hi === lo ? 50 : ((c[i].c - lo) / (hi - lo)) * 100
  }
  const start = k.findIndex((x) => x != null)
  if (start === -1) return { k, d: NaNs(c.length) }
  const d: Series = [...NaNs(start), ...sma(k.slice(start) as number[], dP)]
  return { k, d }
}

export function obv(c: CandleFlat[]): Series {
  const out: Series = c.length ? [0] : []
  for (let i = 1; i < c.length; i++)
    out[i] =
      (out[i - 1] as number) + (c[i].c > c[i - 1].c ? c[i].v : c[i].c < c[i - 1].c ? -c[i].v : 0)
  return out
}

export function supertrend(c: CandleFlat[], p = 10, mult = 3) {
  const a = atr(c, p)
  const line = NaNs(c.length)
  const dir: (1 | -1 | null)[] = Array(c.length).fill(null)
  let upper = 0
  let lower = 0
  let trend: 1 | -1 = 1
  for (let i = 0; i < c.length; i++) {
    if (a[i] == null) continue
    const hl2 = (c[i].h + c[i].l) / 2
    let bu = hl2 + mult * (a[i] as number)
    let bl = hl2 - mult * (a[i] as number)
    if (i > 0 && line[i - 1] != null) {
      if (bl < lower && c[i - 1].c > lower) bl = lower
      if (bu > upper && c[i - 1].c < upper) bu = upper
    }
    if (i === 0 || line[i - 1] == null) trend = 1
    else if (trend === 1 && c[i].c < lower) trend = -1
    else if (trend === -1 && c[i].c > upper) trend = 1
    upper = bu
    lower = bl
    line[i] = trend === 1 ? lower : upper
    dir[i] = trend
  }
  return { line, dir }
}

export function keltner(c: CandleFlat[], p = 20, mult = 2) {
  const mid = ema(
    c.map((k) => k.c),
    p,
  )
  const a = atr(c, p)
  return {
    mid,
    upper: mid.map((m, i) => (m != null && a[i] != null ? m + mult * (a[i] as number) : null)),
    lower: mid.map((m, i) => (m != null && a[i] != null ? m - mult * (a[i] as number) : null)),
  }
}

export function cci(c: CandleFlat[], p = 20): Series {
  const tp = c.map((k) => (k.h + k.l + k.c) / 3)
  const m = sma(tp, p)
  const out = NaNs(c.length)
  for (let i = p - 1; i < c.length; i++) {
    let md = 0
    for (let j = i - p + 1; j <= i; j++) md += Math.abs(tp[j] - (m[i] as number))
    md /= p
    out[i] = md ? (tp[i] - (m[i] as number)) / (0.015 * md) : 0
  }
  return out
}

export function roc(close: number[], p = 12): Series {
  return close.map((v, i) =>
    i >= p && close[i - p] ? ((v - close[i - p]) / close[i - p]) * 100 : null,
  )
}

export function williamsR(c: CandleFlat[], p = 14): Series {
  const out = NaNs(c.length)
  for (let i = p - 1; i < c.length; i++) {
    let hi = -Infinity
    let lo = Infinity
    for (let j = i - p + 1; j <= i; j++) {
      hi = Math.max(hi, c[j].h)
      lo = Math.min(lo, c[j].l)
    }
    out[i] = hi === lo ? -50 : ((hi - c[i].c) / (hi - lo)) * -100
  }
  return out
}

export function mfi(c: CandleFlat[], p = 14): Series {
  const out = NaNs(c.length)
  const tp = c.map((k) => (k.h + k.l + k.c) / 3)
  for (let i = p; i < c.length; i++) {
    let pos = 0
    let neg = 0
    for (let j = i - p + 1; j <= i; j++) {
      const flow = tp[j] * c[j].v
      if (tp[j] > tp[j - 1]) pos += flow
      else if (tp[j] < tp[j - 1]) neg += flow
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  }
  return out
}
