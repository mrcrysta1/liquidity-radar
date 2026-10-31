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
  return vwapBands(c).v
}

/** Where an anchored VWAP restarts: 1 each UTC day, 2 each week (Monday), 3 each month. */
function vwapPeriod(t: number, anchor: number): number {
  if (anchor === 3) {
    const d = new Date(t)
    return d.getUTCFullYear() * 12 + d.getUTCMonth()
  }
  const day = Math.floor(t / 86400000)
  // 1970-01-01 was a Thursday: shift so weeks start on Monday.
  return anchor === 2 ? Math.floor((day + 3) / 7) : day
}

/**
 * Anchored VWAP with optional bands, as TradingView's VWAP: the session, week
 * or month restarts it, and the bands sit `mult` volume-weighted standard
 * deviations either side (mult 0: no bands).
 */
export function vwapBands(c: CandleFlat[], anchor = 1, mult = 0): { v: Series; u: Series; l: Series } {
  const v = NaNs(c.length)
  const u = NaNs(c.length)
  const l = NaNs(c.length)
  let pv = 0
  let pv2 = 0
  let vol = 0
  let period = NaN
  for (let i = 0; i < c.length; i++) {
    const k = vwapPeriod(c[i].t, anchor)
    if (k !== period) {
      period = k
      pv = 0
      pv2 = 0
      vol = 0
    }
    const tp = (c[i].h + c[i].l + c[i].c) / 3
    pv += tp * c[i].v
    pv2 += tp * tp * c[i].v
    vol += c[i].v
    if (!vol) continue
    const mean = pv / vol
    v[i] = mean
    if (mult > 0) {
      const sd = Math.sqrt(Math.max(0, pv2 / vol - mean * mean))
      u[i] = mean + mult * sd
      l[i] = mean - mult * sd
    }
  }
  return { v, u, l }
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
    // Flip against this bar's final bands, as Pine's ta.supertrend does;
    // comparing with the previous bar's flipped one bar late.
    if (i === 0 || line[i - 1] == null) trend = 1
    else if (trend === 1 && c[i].c < bl) trend = -1
    else if (trend === -1 && c[i].c > bu) trend = 1
    upper = bu
    lower = bl
    line[i] = trend === 1 ? lower : upper
    dir[i] = trend
  }
  return { line, dir }
}

/** Keltner channels: EMA(p) ± mult × ATR(atrP); TradingView's default ATR is 10. */
export function keltner(c: CandleFlat[], p = 20, mult = 2, atrP = 10) {
  const mid = ema(
    c.map((k) => k.c),
    p,
  )
  const a = atr(c, atrP)
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

// ---------------------------------------------------------------------------
// Pro library indicators (pro-terminal/src/core/pine/library.ts), ported to
// plain array maths. Same conventions as above: equal-length output, `null`
// during warm-up.

/** Run `fn` on the defined tail of a series and re-pad the warm-up with nulls,
 *  so derived series (EMA of an EMA, WMA of a WMA difference) seed correctly. */
export function onDefined(s: Series, fn: (v: number[]) => Series): Series {
  const start = s.findIndex((x) => x != null && isFinite(x))
  if (start === -1) return NaNs(s.length)
  // A gap inside the data carries the last value forward: as NaN it poisoned
  // every later value of a running sum, EMA or RMA and blanked the indicator
  // for good.
  let last = NaN
  const tail = s.slice(start).map((x) => (x == null || !isFinite(x) ? last : (last = x)))
  return [...NaNs(start), ...fn(tail).map((x) => (x == null || !isFinite(x) ? null : x))]
}

/** Wilder's moving average (RMA / SMMA): SMA seed, then (prev*(p-1)+x)/p. */
export function rma(v: number[], p: number): Series {
  const out = NaNs(v.length)
  let prev = 0
  for (let i = 0; i < v.length; i++) {
    if (i < p) {
      prev += v[i]
      if (i === p - 1) {
        prev /= p
        out[i] = prev
      }
      continue
    }
    prev = (prev * (p - 1) + v[i]) / p
    out[i] = prev
  }
  return out
}

export function highest(v: number[], p: number): Series {
  const out = NaNs(v.length)
  for (let i = p - 1; i < v.length; i++) {
    let m = -Infinity
    for (let j = i - p + 1; j <= i; j++) if (v[j] > m) m = v[j]
    out[i] = m
  }
  return out
}

export function lowest(v: number[], p: number): Series {
  const out = NaNs(v.length)
  for (let i = p - 1; i < v.length; i++) {
    let m = Infinity
    for (let j = i - p + 1; j <= i; j++) if (v[j] < m) m = v[j]
    out[i] = m
  }
  return out
}

/** Population standard deviation over a rolling window (Pine's ta.stdev). */
export function stdev(v: number[], p: number): Series {
  const out = NaNs(v.length)
  const m = sma(v, p)
  for (let i = p - 1; i < v.length; i++) {
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += (v[j] - (m[i] as number)) ** 2
    out[i] = Math.sqrt(s / p)
  }
  return out
}

/** Rolling sum. */
export function sum(v: number[], p: number): Series {
  const out = NaNs(v.length)
  let s = 0
  for (let i = 0; i < v.length; i++) {
    s += v[i]
    if (i >= p) s -= v[i - p]
    if (i >= p - 1) out[i] = s
  }
  return out
}

/** Hull MA: WMA(2·WMA(n/2) − WMA(n), √n). */
export function hma(v: number[], p: number): Series {
  const half = wma(v, Math.max(1, Math.floor(p / 2)))
  const full = wma(v, p)
  const diff: Series = v.map((_, i) =>
    half[i] != null && full[i] != null ? 2 * (half[i] as number) - (full[i] as number) : null,
  )
  return onDefined(diff, (d) => wma(d, Math.max(1, Math.round(Math.sqrt(p)))))
}

/** Volume-weighted MA of a source. */
export function vwma(v: number[], c: CandleFlat[], p: number): Series {
  const pv = sma(
    v.map((x, i) => x * c[i].v),
    p,
  )
  const vol = sma(
    c.map((k) => k.v),
    p,
  )
  return pv.map((x, i) => (x != null && vol[i] ? x / (vol[i] as number) : null))
}

/** Donchian channel: highest high, lowest low, and their midpoint. */
export function donchian(c: CandleFlat[], p = 20) {
  const upper = highest(
    c.map((k) => k.h),
    p,
  )
  const lower = lowest(
    c.map((k) => k.l),
    p,
  )
  const mid: Series = upper.map((u, i) =>
    u != null && lower[i] != null ? (u + (lower[i] as number)) / 2 : null,
  )
  return { upper, lower, mid }
}

/**
 * Ichimoku Kinko Hyo. Leading spans are shifted forward and the lagging span
 * back by `disp - 1` bars (TradingView's convention). The chart has no bars
 * in the future, so the part of the cloud projected past the last candle is
 * not drawn; `disp = 1` gives the unshifted lines the Pro script plots.
 */
export function ichimoku(c: CandleFlat[], conv = 9, base = 26, spanB = 52, disp = 26) {
  const n = c.length
  const conversion = donchian(c, conv).mid
  const baseLine = donchian(c, base).mid
  const b = donchian(c, spanB).mid
  const a: Series = conversion.map((x, i) =>
    x != null && baseLine[i] != null ? (x + (baseLine[i] as number)) / 2 : null,
  )
  const off = Math.max(0, disp - 1)
  const spanA = NaNs(n)
  const spanBOut = NaNs(n)
  const lagging = NaNs(n)
  for (let i = 0; i < n; i++) {
    if (i - off >= 0) {
      spanA[i] = a[i - off]
      spanBOut[i] = b[i - off]
    }
    if (i + off < n) lagging[i] = c[i + off].c
  }
  return { conversion, base: baseLine, spanA, spanB: spanBOut, lagging }
}

/**
 * Directional Movement Index (+DI, −DI) and ADX, Wilder-smoothed as Pine's
 * ta.dmi. Bar 0 has no previous bar, so every input series starts at bar 1.
 */
export function dmi(c: CandleFlat[], len = 14, adxLen = 14) {
  const n = c.length
  const plus = NaNs(n)
  const minus = NaNs(n)
  const adx = NaNs(n)
  if (n < 2) return { plus, minus, adx }
  const pdm: number[] = []
  const mdm: number[] = []
  const tr: number[] = []
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h
    const dn = c[i - 1].l - c[i].l
    pdm.push(up > dn && up > 0 ? up : 0)
    mdm.push(dn > up && dn > 0 ? dn : 0)
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)))
  }
  const sp = rma(pdm, len)
  const sm = rma(mdm, len)
  const st = rma(tr, len)
  const dx = NaNs(n)
  for (let j = 0; j < tr.length; j++) {
    if (sp[j] == null || !st[j]) continue
    const p = ((sp[j] as number) / (st[j] as number)) * 100
    const m = ((sm[j] as number) / (st[j] as number)) * 100
    plus[j + 1] = p
    minus[j + 1] = m
    dx[j + 1] = p + m ? (Math.abs(p - m) / (p + m)) * 100 : 0
  }
  const a = onDefined(dx, (d) => rma(d, adxLen))
  for (let i = 0; i < n; i++) adx[i] = a[i]
  return { plus, minus, adx }
}

/** Stochastic RSI: stochastic of RSI over its own range, then smoothed. */
export function stochRsi(src: number[], rsiLen = 14, stochLen = 14, smoothK = 3, smoothD = 3) {
  const r = rsi(src, rsiLen)
  const raw = onDefined(r, (v) => {
    const hi = highest(v, stochLen)
    const lo = lowest(v, stochLen)
    return v.map((x, i) =>
      hi[i] == null
        ? null
        : hi[i] === lo[i]
          ? 50
          : ((x - (lo[i] as number)) / ((hi[i] as number) - (lo[i] as number))) * 100,
    )
  })
  const k = onDefined(raw, (v) => sma(v, smoothK))
  const d = onDefined(k, (v) => sma(v, smoothD))
  return { k, d }
}

/** Parabolic SAR, stepped exactly as the Pro runtime's ta.sar. */
export function psar(c: CandleFlat[], start = 0.02, inc = 0.02, max = 0.2): Series {
  const out = NaNs(c.length)
  if (c.length < 2) return out
  let up = c[1].c > c[0].c
  let sar = up ? c[0].l : c[0].h
  let ep = up ? c[1].h : c[1].l
  let af = start
  out[1] = sar
  for (let i = 2; i < c.length; i++) {
    let s = sar + af * (ep - sar)
    if (up) {
      s = Math.min(s, c[i - 1].l, c[i - 2].l)
      if (c[i].l < s) {
        up = false
        s = ep
        ep = c[i].l
        af = start
      } else if (c[i].h > ep) {
        ep = c[i].h
        af = Math.min(max, af + inc)
      }
    } else {
      s = Math.max(s, c[i - 1].h, c[i - 2].h)
      if (c[i].h > s) {
        up = true
        s = ep
        ep = c[i].h
        af = start
      } else if (c[i].l < ep) {
        ep = c[i].l
        af = Math.min(max, af + inc)
      }
    }
    sar = s
    out[i] = s
  }
  return out
}

/** Awesome Oscillator: SMA5(hl2) − SMA34(hl2). */
export function awesome(c: CandleFlat[], fast = 5, slow = 34): Series {
  const hl2 = c.map((k) => (k.h + k.l) / 2)
  const f = sma(hl2, fast)
  const s = sma(hl2, slow)
  return f.map((x, i) => (x != null && s[i] != null ? x - (s[i] as number) : null))
}

export function momentum(v: number[], p = 10): Series {
  return v.map((x, i) => (i >= p ? x - v[i - p] : null))
}

/** Bollinger %B: where the source sits between the bands (0 = lower, 1 = upper). */
export function bollingerPctB(v: number[], p = 20, mult = 2): Series {
  const b = bollinger(v, p, mult)
  return v.map((x, i) => {
    const u = b.upper[i]
    const l = b.lower[i]
    return u == null || l == null || u === l ? null : (x - l) / (u - l)
  })
}

/** Bollinger Bandwidth: (upper − lower) / basis. */
export function bollingerWidth(v: number[], p = 20, mult = 2): Series {
  const b = bollinger(v, p, mult)
  return b.mid.map((m, i) =>
    m == null || !m ? null : ((b.upper[i] as number) - (b.lower[i] as number)) / m,
  )
}

/** TRIX: 10000 × one-bar change of a triple-smoothed EMA of log(close). */
export function trix(c: CandleFlat[], p = 18): Series {
  const logs = c.map((k) => Math.log(k.c))
  const e3 = onDefined(
    onDefined(ema(logs, p), (v) => ema(v, p)),
    (v) => ema(v, p),
  )
  return e3.map((x, i) =>
    x != null && i > 0 && e3[i - 1] != null ? 10000 * (x - (e3[i - 1] as number)) : null,
  )
}

/** Ultimate Oscillator (Williams), weights 4/2/1. */
export function ultimate(c: CandleFlat[], p1 = 7, p2 = 14, p3 = 28): Series {
  const n = c.length
  const bp: number[] = []
  const tr: number[] = []
  for (let i = 1; i < n; i++) {
    const lo = Math.min(c[i].l, c[i - 1].c)
    const hi = Math.max(c[i].h, c[i - 1].c)
    bp.push(c[i].c - lo)
    tr.push(hi - lo)
  }
  const avg = (p: number) => {
    const b = sum(bp, p)
    const t = sum(tr, p)
    return b.map((x, i) => (x != null && t[i] ? x / (t[i] as number) : null))
  }
  const a1 = avg(p1)
  const a2 = avg(p2)
  const a3 = avg(p3)
  const out = NaNs(n)
  for (let j = 0; j < bp.length; j++)
    if (a1[j] != null && a2[j] != null && a3[j] != null)
      out[j + 1] = (100 * (4 * (a1[j] as number) + 2 * (a2[j] as number) + (a3[j] as number))) / 7
  return out
}

/** Chaikin Money Flow. */
export function cmf(c: CandleFlat[], p = 20): Series {
  const ad = c.map((k) => (k.h === k.l ? 0 : ((2 * k.c - k.l - k.h) / (k.h - k.l)) * k.v))
  const s = sum(ad, p)
  const vol = sum(
    c.map((k) => k.v),
    p,
  )
  return s.map((x, i) => (x != null && vol[i] ? x / (vol[i] as number) : null))
}

/** Aroon Up / Down: bars since the highest high / lowest low in `p + 1` bars. */
export function aroon(c: CandleFlat[], p = 14) {
  const up = NaNs(c.length)
  const down = NaNs(c.length)
  for (let i = p; i < c.length; i++) {
    // Scanning from the newest bar back, strict comparisons keep the most
    // recent extreme on a tie, as the Pro runtime's ta.highestbars does.
    let hi = 0
    let lo = 0
    for (let k = 1; k <= p; k++) {
      if (c[i - k].h > c[i - hi].h) hi = k
      if (c[i - k].l < c[i - lo].l) lo = k
    }
    up[i] = (100 * (p - hi)) / p
    down[i] = (100 * (p - lo)) / p
  }
  return { up, down }
}

/** Choppiness Index: 100 · log10(ΣTR / range) / log10(n). */
export function choppiness(c: CandleFlat[], p = 14): Series {
  const s = sum(trueRange(c), p)
  const hi = highest(
    c.map((k) => k.h),
    p,
  )
  const lo = lowest(
    c.map((k) => k.l),
    p,
  )
  return s.map((x, i) => {
    if (x == null || hi[i] == null || p < 2) return null
    const range = (hi[i] as number) - (lo[i] as number)
    return range > 0 ? (100 * Math.log10(x / range)) / Math.log10(p) : null
  })
}

/** Vortex Indicator VI+ / VI−. */
export function vortex(c: CandleFlat[], p = 14) {
  const n = c.length
  const plus = NaNs(n)
  const minus = NaNs(n)
  const vmp: number[] = []
  const vmm: number[] = []
  const tr: number[] = []
  for (let i = 1; i < n; i++) {
    vmp.push(Math.abs(c[i].h - c[i - 1].l))
    vmm.push(Math.abs(c[i].l - c[i - 1].h))
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)))
  }
  const sp = sum(vmp, p)
  const sm = sum(vmm, p)
  const st = sum(tr, p)
  for (let j = 0; j < tr.length; j++) {
    if (sp[j] == null || !st[j]) continue
    plus[j + 1] = (sp[j] as number) / (st[j] as number)
    minus[j + 1] = (sm[j] as number) / (st[j] as number)
  }
  return { plus, minus }
}

/** Chande Momentum Oscillator. */
export function cmo(v: number[], p = 9): Series {
  const out = NaNs(v.length)
  for (let i = p; i < v.length; i++) {
    let u = 0
    let d = 0
    for (let j = i - p + 1; j <= i; j++) {
      const ch = v[j] - v[j - 1]
      if (ch > 0) u += ch
      else d -= ch
    }
    out[i] = u + d ? ((u - d) / (u + d)) * 100 : 0
  }
  return out
}

/** True Strength Index (×100) and its EMA signal. */
export function tsi(v: number[], short = 13, long = 25, signal = 13) {
  const ch: Series = v.map((x, i) => (i ? x - v[i - 1] : null))
  const abs: Series = ch.map((x) => (x == null ? null : Math.abs(x)))
  const num = onDefined(
    onDefined(ch, (s) => ema(s, long)),
    (s) => ema(s, short),
  )
  const den = onDefined(
    onDefined(abs, (s) => ema(s, long)),
    (s) => ema(s, short),
  )
  const line: Series = num.map((x, i) =>
    x != null && den[i] ? (100 * x) / (den[i] as number) : null,
  )
  return { line, signal: onDefined(line, (s) => ema(s, signal)) }
}

/** Least-squares regression line value at the newest bar of each window. */
export function linreg(v: number[], p = 50): Series {
  const out = NaNs(v.length)
  if (p < 2) return out
  const xm = (p - 1) / 2
  let de = 0
  for (let x = 0; x < p; x++) de += (x - xm) ** 2
  for (let i = p - 1; i < v.length; i++) {
    let ym = 0
    for (let x = 0; x < p; x++) ym += v[i - p + 1 + x]
    ym /= p
    let nu = 0
    for (let x = 0; x < p; x++) nu += (x - xm) * (v[i - p + 1 + x] - ym)
    out[i] = ym + (nu / de) * (p - 1 - xm)
  }
  return out
}

/**
 * Pivot highs / lows: a bar whose high (low) is strictly above (below) the
 * `left` bars before and the `right` bars after it. `high` / `low` mark the
 * pivot bar itself; `lastHigh` / `lastLow` step to the newest pivot from the
 * bar that confirmed it (Pine's valuewhen).
 */
export function pivots(c: CandleFlat[], left = 5, right = 5) {
  const n = c.length
  const high = NaNs(n)
  const low = NaNs(n)
  const lastHigh = NaNs(n)
  const lastLow = NaNs(n)
  let ph: number | null = null
  let pl: number | null = null
  for (let i = 0; i < n; i++) {
    const p = i - right
    if (p - left >= 0) {
      let isH = true
      let isL = true
      for (let k = p - left; k <= p + right; k++) {
        if (k === p) continue
        if (!(c[k].h < c[p].h)) isH = false
        if (!(c[k].l > c[p].l)) isL = false
      }
      if (isH) {
        high[p] = c[p].h
        ph = c[p].h
      }
      if (isL) {
        low[p] = c[p].l
        pl = c[p].l
      }
    }
    lastHigh[i] = ph
    lastLow[i] = pl
  }
  return { high, low, lastHigh, lastLow }
}

export function zscore(v: number[], p = 20): Series {
  const m = sma(v, p)
  const sd = stdev(v, p)
  return v.map((x, i) =>
    m[i] != null && sd[i] ? (x - (m[i] as number)) / (sd[i] as number) : null,
  )
}

/** Historical volatility: annualised stdev of log returns, in percent. */
export function histVol(c: CandleFlat[], p = 10, annual = 365): Series {
  const lr: Series = c.map((k, i) =>
    i && c[i - 1].c > 0 && k.c > 0 ? Math.log(k.c / c[i - 1].c) : null,
  )
  const sd = onDefined(lr, (v) => stdev(v, p))
  return sd.map((x) => (x == null ? null : 100 * x * Math.sqrt(annual)))
}

/** Bars where `a` crosses above (`up`) or below (`down`) `b`. */
export function crosses(a: Series, b: Series) {
  const up: boolean[] = Array(a.length).fill(false)
  const down: boolean[] = Array(a.length).fill(false)
  for (let i = 1; i < a.length; i++) {
    const a0 = a[i - 1]
    const b0 = b[i - 1]
    const a1 = a[i]
    const b1 = b[i]
    if (a0 == null || b0 == null || a1 == null || b1 == null) continue
    if (a1 > b1 && a0 <= b0) up[i] = true
    else if (a1 < b1 && a0 >= b0) down[i] = true
  }
  return { up, down }
}

// ------------------------------------------------- swings, levels, patterns

/** A ZigZag turning point: the bar and the extreme (high or low) it made. */
export interface ZigPivot {
  i: number
  price: number
  high: boolean
}

/**
 * ZigZag as TradingView draws it: a leg ends when price reverses `devPct`
 * percent from the leg's extreme, and a leg shorter than `depth` bars is not
 * allowed to end (it just keeps extending). `pivots` are the confirmed
 * turns; `last` is the running extreme of the leg still in progress, which
 * moves until a reversal confirms it.
 */
export function zigzag(
  c: CandleFlat[],
  devPct = 5,
  depth = 10,
): { pivots: ZigPivot[]; last: ZigPivot | null } {
  const pivots: ZigPivot[] = []
  const n = c.length
  if (!n) return { pivots, last: null }
  const dev = Math.max(0, devPct) / 100
  let dir = 0
  let hi = 0
  let lo = 0
  const lastI = () => (pivots.length ? pivots[pivots.length - 1].i : -Infinity)
  for (let i = 1; i < n; i++) {
    if (dir === 0) {
      // Before the first turn both extremes run; whichever is older becomes
      // the first pivot once the range between them is a full deviation.
      if (c[i].h > c[hi].h) hi = i
      if (c[i].l < c[lo].l) lo = i
      if (hi !== lo && c[hi].h >= c[lo].l * (1 + dev)) {
        if (hi > lo) {
          pivots.push({ i: lo, price: c[lo].l, high: false })
          dir = 1
        } else {
          pivots.push({ i: hi, price: c[hi].h, high: true })
          dir = -1
        }
      }
      continue
    }
    if (dir === 1) {
      if (c[i].h >= c[hi].h) hi = i
      else if (c[i].l <= c[hi].h * (1 - dev) && hi - lastI() >= depth) {
        pivots.push({ i: hi, price: c[hi].h, high: true })
        dir = -1
        lo = i
      }
    } else {
      if (c[i].l <= c[lo].l) lo = i
      else if (c[i].h >= c[lo].l * (1 + dev) && lo - lastI() >= depth) {
        pivots.push({ i: lo, price: c[lo].l, high: false })
        dir = 1
        hi = i
      }
    }
  }
  const last: ZigPivot | null =
    dir === 1
      ? { i: hi, price: c[hi].h, high: true }
      : dir === -1
        ? { i: lo, price: c[lo].l, high: false }
        : null
  return { pivots, last }
}

/** The ZigZag as a series: values only at the turns, so a line through the
 *  defined points draws the legs (the live leg to the running extreme too). */
export function zigzagLine(c: CandleFlat[], devPct = 5, depth = 10): Series {
  const out = NaNs(c.length)
  const z = zigzag(c, devPct, depth)
  z.pivots.forEach((p) => (out[p.i] = p.price))
  if (z.last && (!z.pivots.length || z.last.i > z.pivots[z.pivots.length - 1].i))
    out[z.last.i] = z.last.price
  return out
}

/** Fibonacci ratios Auto Fib draws, in output order. */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]

/**
 * Auto Fib retracement over the last confirmed ZigZag swing: level 0 sits at
 * the newest pivot, 1 at the one before it, as TradingView's default. Each
 * level is a horizontal line from the swing's start to the last bar.
 */
export function autoFib(
  c: CandleFlat[],
  devPct = 5,
  depth = 10,
): { levels: number[]; from: number; series: Series[] } {
  const { pivots } = zigzag(c, devPct, depth)
  const series = FIB_RATIOS.map(() => NaNs(c.length))
  if (pivots.length < 2) return { levels: [], from: -1, series }
  const a = pivots[pivots.length - 2]
  const b = pivots[pivots.length - 1]
  const levels = FIB_RATIOS.map((r) => b.price + (a.price - b.price) * r)
  levels.forEach((lv, k) => {
    for (let i = a.i; i < c.length; i++) series[k][i] = lv
  })
  return { levels, from: a.i, series }
}

/**
 * Chandelier Exit (Le Beau): a long stop `mult` ATRs under the highest high
 * of `len` bars, a short stop as far over the lowest low. Each stop only
 * ratchets in the trade's favour while price respects it, and the trend
 * flips when the close crosses the opposite stop. `long` / `short` carry the
 * active stop only; `buy` / `sell` mark the flips.
 */
export function chandelier(c: CandleFlat[], len = 22, mult = 3) {
  const n = c.length
  const long = NaNs(n)
  const short = NaNs(n)
  const buy = NaNs(n)
  const sell = NaNs(n)
  const a = atr(c, len)
  const hh = highest(c.map((k) => k.h), len)
  const ll = lowest(c.map((k) => k.l), len)
  let ls = NaN
  let ss = NaN
  let dir = 1
  for (let i = 0; i < n; i++) {
    const av = a[i]
    if (av == null || hh[i] == null || ll[i] == null) continue
    let l = (hh[i] as number) - mult * av
    let s = (ll[i] as number) + mult * av
    const prevC = i ? c[i - 1].c : c[i].c
    if (isFinite(ls) && prevC > ls) l = Math.max(l, ls)
    if (isFinite(ss) && prevC < ss) s = Math.min(s, ss)
    const prevDir = dir
    if (isFinite(ss) && c[i].c > ss) dir = 1
    else if (isFinite(ls) && c[i].c < ls) dir = -1
    if (dir === 1) long[i] = l
    else short[i] = s
    if (isFinite(ls) && dir !== prevDir) {
      if (dir === 1) buy[i] = l
      else sell[i] = s
    }
    ls = l
    ss = s
  }
  return { long, short, buy, sell }
}

/**
 * Ehlers' Fisher Transform as TradingView's built-in: hl2 normalised into
 * its `len`-bar range, smoothed, clamped short of ±1 and mapped through the
 * inverse hyperbolic tangent. The trigger is the previous bar's Fisher.
 */
export function fisher(c: CandleFlat[], len = 9): { fisher: Series; trigger: Series } {
  const n = c.length
  const f = NaNs(n)
  const trig = NaNs(n)
  const hl2 = c.map((k) => (k.h + k.l) / 2)
  const hh = highest(hl2, len)
  const ll = lowest(hl2, len)
  let val = 0
  let fish = 0
  const clamp = (x: number) => (x > 0.999 ? 0.999 : x < -0.999 ? -0.999 : x)
  for (let i = 0; i < n; i++) {
    if (hh[i] == null || ll[i] == null) continue
    const range = (hh[i] as number) - (ll[i] as number)
    // A flat range has no position in it: read it as the middle.
    const pos = range ? (hl2[i] - (ll[i] as number)) / range : 0.5
    val = clamp(0.66 * (pos - 0.5) + 0.67 * val)
    const prev = fish
    fish = 0.5 * Math.log((1 + val) / (1 - val)) + 0.5 * fish
    f[i] = fish
    if (i && f[i - 1] != null) trig[i] = prev
  }
  return { fisher: f, trigger: trig }
}

/**
 * Pring's Know Sure Thing: four rates of change, each smoothed by its own
 * SMA and weighted 1–4, plus an SMA signal line.
 */
export function kst(
  v: number[],
  roc1 = 10,
  roc2 = 15,
  roc3 = 20,
  roc4 = 30,
  sm1 = 10,
  sm2 = 10,
  sm3 = 10,
  sm4 = 15,
  sig = 9,
): { line: Series; signal: Series } {
  const parts = [
    onDefined(roc(v, roc1), (x) => sma(x, sm1)),
    onDefined(roc(v, roc2), (x) => sma(x, sm2)),
    onDefined(roc(v, roc3), (x) => sma(x, sm3)),
    onDefined(roc(v, roc4), (x) => sma(x, sm4)),
  ]
  const line: Series = v.map((_, i) => {
    let s = 0
    for (let k = 0; k < 4; k++) {
      const x = parts[k][i]
      if (x == null) return null
      s += x * (k + 1)
    }
    return s
  })
  return { line, signal: onDefined(line, (x) => sma(x, sig)) }
}

/**
 * Levels from one period's high, low and close (and the new period's open,
 * for Woodie). `kind`: 1 traditional · 2 fibonacci · 3 woodie · 4 camarilla.
 * R4/S4 exist for Camarilla only.
 */
export function pivotLevels(
  h: number,
  l: number,
  c: number,
  kind = 1,
  open = c,
): { p: number; r: number[]; s: number[] } {
  const rg = h - l
  if (kind === 4) {
    const p = (h + l + c) / 3
    const k = [12, 6, 4, 2].map((d) => (1.1 * rg) / d)
    return { p, r: k.map((x) => c + x), s: k.map((x) => c - x) }
  }
  if (kind === 2) {
    const p = (h + l + c) / 3
    const f = [0.382, 0.618, 1]
    return { p, r: f.map((x) => p + x * rg), s: f.map((x) => p - x * rg) }
  }
  const p = kind === 3 ? (h + l + 2 * open) / 4 : (h + l + c) / 3
  return {
    p,
    r: [2 * p - l, p + rg, h + 2 * (p - l)],
    s: [2 * p - h, p - rg, l - 2 * (h - p)],
  }
}

type PivotKey = 'p' | 'r1' | 'r2' | 'r3' | 'r4' | 's1' | 's2' | 's3' | 's4'

/**
 * Period pivot points: each day / week / month (`anchor` as VWAP's) draws
 * the levels of the period before it. The first bar of a period is left
 * empty, so each period's levels draw as a segment of their own instead of
 * a vertical jump from the last period's.
 */
export function pivotPoints(c: CandleFlat[], kind = 1, anchor = 1): Record<PivotKey, Series> {
  const n = c.length
  const keys: PivotKey[] = ['p', 'r1', 'r2', 'r3', 'r4', 's1', 's2', 's3', 's4']
  const out = {} as Record<PivotKey, Series>
  keys.forEach((k) => (out[k] = NaNs(n)))
  let period = NaN
  let h = -Infinity
  let l = Infinity
  let cl = NaN
  let lv: ReturnType<typeof pivotLevels> | null = null
  for (let i = 0; i < n; i++) {
    const k = vwapPeriod(c[i].t, anchor)
    const fresh = k !== period
    if (fresh) {
      // The previous period closed: its range sets this period's levels.
      lv = isFinite(cl) ? pivotLevels(h, l, cl, kind, c[i].o) : null
      period = k
      h = -Infinity
      l = Infinity
    }
    h = Math.max(h, c[i].h)
    l = Math.min(l, c[i].l)
    cl = c[i].c
    if (!lv || fresh) continue
    out.p[i] = lv.p
    lv.r.forEach((x, j) => (out[('r' + (j + 1)) as PivotKey][i] = x))
    lv.s.forEach((x, j) => (out[('s' + (j + 1)) as PivotKey][i] = x))
  }
  return out
}

/** A detected chart pattern: its outline (one or two polylines over pivot
 *  points) and the bar it completed on. */
export interface ChartPattern {
  kind: 'dtop' | 'dbot' | 'hs' | 'ihs' | 'asc' | 'desc' | 'sym'
  lines: Array<Array<{ i: number; price: number }>>
  /** Bar where the pattern completed (its last pivot). */
  at: number
  bullish: boolean
}

/** Marker text per pattern, indexed by PATTERN_KINDS position. */
export const PATTERN_KINDS: Array<ChartPattern['kind']> = [
  'dtop',
  'dbot',
  'hs',
  'ihs',
  'asc',
  'desc',
  'sym',
]
export const PATTERN_LABELS = [
  'Double Top',
  'Double Bottom',
  'H&S',
  'Inv H&S',
  'Asc Triangle',
  'Desc Triangle',
  'Sym Triangle',
]

/**
 * Classic patterns read off a run of alternating ZigZag pivots. `tolPct` is
 * how far apart two prices may be and still count as level (the tops of a
 * double top, a head & shoulders' shoulders, a triangle's flat side).
 *
 * The bigger patterns claim their pivots first (head & shoulders and
 * triangles, then double tops/bottoms) and a pivot belongs to at most one
 * pattern: the shoulder-neck-head of an H&S would otherwise also read as a
 * double bottom. Returned in chart order.
 */
export function chartPatterns(pivots: ZigPivot[], tolPct = 1.5): ChartPattern[] {
  const tol = Math.max(0, tolPct) / 100
  const same = (a: number, b: number) =>
    Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b))
  const pt = (p: ZigPivot) => ({ i: p.i, price: p.price })

  // Head & shoulders: H L H L H (or inverted), the head beyond both
  // shoulders, the shoulders level.
  const headShoulders = ([s1, n1, hd, n2, s2]: ZigPivot[]): ChartPattern | null => {
    const up = s1.high
    const beyond = (a: number, b: number) => (up ? a > b * (1 + tol) : a < b * (1 - tol))
    if (!beyond(hd.price, s1.price) || !beyond(hd.price, s2.price) || !same(s1.price, s2.price))
      return null
    return {
      kind: up ? 'hs' : 'ihs',
      lines: [[s1, n1, hd, n2, s2].map(pt), [pt(n1), pt(n2)]],
      at: s2.i,
      bullish: !up,
    }
  }
  // Triangles: five alternating pivots (three touches on one side, two on
  // the other, as most screeners ask) whose lines converge. Four would read
  // every double top that started from a lower low as an ascending triangle.
  const triangle = (five: ZigPivot[]): ChartPattern | null => {
    const hs = five.filter((p) => p.high)
    const ls = five.filter((p) => !p.high)
    const flat = (xs: ZigPivot[]) => xs.every((p) => same(p.price, xs[0].price))
    const falling = (xs: ZigPivot[]) =>
      xs.every((p, k) => !k || p.price < xs[k - 1].price * (1 - tol))
    const rising = (xs: ZigPivot[]) =>
      xs.every((p, k) => !k || p.price > xs[k - 1].price * (1 + tol))
    const kind =
      flat(hs) && rising(ls)
        ? 'asc'
        : flat(ls) && falling(hs)
          ? 'desc'
          : falling(hs) && rising(ls)
            ? 'sym'
            : null
    if (!kind) return null
    const last = five[five.length - 1]
    return {
      kind,
      // Each side drawn as a straight line through its first and last touch.
      lines: [
        [pt(hs[0]), pt(hs[hs.length - 1])],
        [pt(ls[0]), pt(ls[ls.length - 1])],
      ],
      at: last.i,
      // A symmetric triangle leans the way its last leg points.
      bullish: kind === 'asc' || (kind === 'sym' && !last.high),
    }
  }
  // Double top / bottom: H L H (or L H L), the extremes level and the
  // middle clearly apart from them.
  const double = ([a, m, b]: ZigPivot[]): ChartPattern | null => {
    const deep = a.high
      ? m.price < Math.min(a.price, b.price) * (1 - 2 * tol)
      : m.price > Math.max(a.price, b.price) * (1 + 2 * tol)
    if (!same(a.price, b.price) || !deep) return null
    return {
      kind: a.high ? 'dtop' : 'dbot',
      lines: [[a, m, b].map(pt), [pt(m), { i: b.i, price: m.price }]],
      at: b.i,
      bullish: !a.high,
    }
  }

  const taken: boolean[] = pivots.map(() => false)
  const found: Array<{ start: number; pat: ChartPattern }> = []
  const passes: Array<[number, (p: ZigPivot[]) => ChartPattern | null]> = [
    [5, headShoulders],
    [5, triangle],
    [3, double],
  ]
  passes.forEach(([size, match]) => {
    for (let s = 0; s + size <= pivots.length; s++) {
      if (taken.slice(s, s + size).some(Boolean)) continue
      const pat = match(pivots.slice(s, s + size))
      if (!pat) continue
      for (let k = s; k < s + size; k++) taken[k] = true
      found.push({ start: s, pat })
    }
  })
  return found.sort((a, b) => a.start - b.start).map((f) => f.pat)
}

/**
 * Pattern outlines as line series with gaps: pattern k draws into slot k % 2
 * so neighbouring patterns, which share a pivot, do not join into one line.
 * Each polyline is interpolated bar by bar between its points; bars outside
 * a pattern stay null, which the renderer turns into a break in the line.
 * Returns [slot 0 line A, slot 0 line B, slot 1 line A, slot 1 line B].
 */
export function patternSeries(n: number, patterns: ChartPattern[]): Series[] {
  const out = [NaNs(n), NaNs(n), NaNs(n), NaNs(n)]
  patterns.forEach((pat, k) => {
    pat.lines.slice(0, 2).forEach((line, j) => {
      const s = out[(k % 2) * 2 + j]
      for (let q = 1; q < line.length; q++) {
        const a = line[q - 1]
        const b = line[q]
        for (let i = a.i; i <= b.i && i < n; i++)
          s[i] =
            b.i === a.i ? b.price : a.price + ((b.price - a.price) * (i - a.i)) / (b.i - a.i)
      }
    })
  })
  return out
}

// ------------------------------------------------- r4: more catalogue maths

/** Elder-ray: bull power (high − EMA) and bear power (low − EMA). */
export function elderRay(c: CandleFlat[], p = 13): { bull: Series; bear: Series } {
  const e = ema(
    c.map((k) => k.c),
    p,
  )
  return {
    bull: e.map((x, i) => (x == null ? null : c[i].h - x)),
    bear: e.map((x, i) => (x == null ? null : c[i].l - x)),
  }
}

/** Mass Index (Dorsey): rolling sum of EMA(H−L) / EMA(EMA(H−L)). */
export function massIndex(c: CandleFlat[], emaLen = 9, sumLen = 25): Series {
  const e1 = ema(
    c.map((k) => k.h - k.l),
    emaLen,
  )
  const e2 = onDefined(e1, (v) => ema(v, emaLen))
  const ratio: Series = e1.map((x, i) =>
    x != null && e2[i] != null && e2[i] !== 0 ? x / (e2[i] as number) : null,
  )
  return onDefined(ratio, (v) => sum(v, sumLen))
}

/** Coppock curve: WMA of the sum of a long and a short rate of change. */
export function coppock(v: number[], wmaLen = 10, longRoc = 14, shortRoc = 11): Series {
  const a = roc(v, longRoc)
  const b = roc(v, shortRoc)
  const s: Series = v.map((_, i) =>
    a[i] != null && b[i] != null ? (a[i] as number) + (b[i] as number) : null,
  )
  return onDefined(s, (x) => wma(x, wmaLen))
}

/** Detrended Price Oscillator, TradingView's non-centred form:
 *  source − SMA(n) as it was n/2 + 1 bars ago. */
export function dpo(v: number[], p = 21): Series {
  const back = Math.floor(p / 2) + 1
  const m = sma(v, p)
  return v.map((x, i) => (i - back >= 0 && m[i - back] != null ? x - (m[i - back] as number) : null))
}

/**
 * Linear regression channel over the newest `p` bars, as TradingView draws
 * it: the fitted line plus parallel lines `dev` standard deviations (of the
 * residuals) either side. Bars before the window are null.
 */
export function linregChannel(
  v: number[],
  p = 100,
  dev = 2,
): { mid: Series; upper: Series; lower: Series } {
  const n = v.length
  const mid = NaNs(n)
  const upper = NaNs(n)
  const lower = NaNs(n)
  const len = Math.min(Math.max(2, Math.floor(p)), n)
  if (n < 2) return { mid, upper, lower }
  const s = n - len
  let sx = 0
  let sy = 0
  let sxy = 0
  let sxx = 0
  for (let x = 0; x < len; x++) {
    const y = v[s + x]
    sx += x
    sy += y
    sxy += x * y
    sxx += x * x
  }
  const den = len * sxx - sx * sx
  const slope = den ? (len * sxy - sx * sy) / den : 0
  const icpt = (sy - slope * sx) / len
  let ss = 0
  for (let x = 0; x < len; x++) ss += (v[s + x] - (icpt + slope * x)) ** 2
  const sd = Math.sqrt(ss / len)
  for (let x = 0; x < len; x++) {
    const y = icpt + slope * x
    mid[s + x] = y
    upper[s + x] = y + dev * sd
    lower[s + x] = y - dev * sd
  }
  return { mid, upper, lower }
}

/** A fitted trendline: through pivots `a` and `b`, `touches` pivots on it. */
export interface TrendFit {
  a: number
  b: number
  /** Price at bar `a`, and the change per bar. */
  price: number
  slope: number
  touches: number
}

/**
 * The most recent valid trendline through pivots of one side (highs for
 * resistance, lows for support): the newest pivot `b` that pairs with an
 * older pivot `a` so that no close from `a` to the last bar breaks the line
 * (beyond `tolPct`), with at least two pivots within `tolPct` of it. Among
 * the pairs for that `b`, the one with most touches wins (then the longer).
 */
export function fitTrendline(
  c: CandleFlat[],
  pivots: ZigPivot[],
  resistance: boolean,
  tolPct = 0.5,
  maxPivots = 12,
): TrendFit | null {
  const pts = pivots.slice(-maxPivots)
  const n = c.length
  const tol = Math.max(0, tolPct) / 100
  for (let bi = pts.length - 1; bi >= 1; bi--) {
    const B = pts[bi]
    let best: TrendFit | null = null
    for (let ai = bi - 1; ai >= 0; ai--) {
      const A = pts[ai]
      if (B.i <= A.i) continue
      const slope = (B.price - A.price) / (B.i - A.i)
      const at = (k: number) => A.price + slope * (k - A.i)
      if (!(at(n - 1) > 0)) continue
      let broken = false
      for (let k = A.i; k < n && !broken; k++) {
        const y = at(k)
        broken = resistance ? c[k].c > y * (1 + tol) : c[k].c < y * (1 - tol)
      }
      if (broken) continue
      let touches = 0
      for (const p of pts) if (p.i >= A.i && Math.abs(p.price - at(p.i)) <= at(p.i) * tol) touches++
      if (touches < 2) continue
      if (!best || touches > best.touches)
        best = { a: A.i, b: B.i, price: A.price, slope, touches }
    }
    if (best) return best
  }
  return null
}

/** A fitted line as a series: from its first pivot, extended to the last bar. */
export function trendSeries(n: number, fit: TrendFit | null): Series {
  const out = NaNs(n)
  if (fit) for (let k = fit.a; k < n; k++) out[k] = fit.price + fit.slope * (k - fit.a)
  return out
}

/** Auto trendlines: support and resistance fitted to ZigZag pivots. */
export function autoTrendlines(
  c: CandleFlat[],
  devPct = 3,
  depth = 5,
  tolPct = 0.5,
): { res: Series; sup: Series; resFit: TrendFit | null; supFit: TrendFit | null } {
  const z = zigzag(c, devPct, depth)
  const resFit = fitTrendline(
    c,
    z.pivots.filter((p) => p.high),
    true,
    tolPct,
  )
  const supFit = fitTrendline(
    c,
    z.pivots.filter((p) => !p.high),
    false,
    tolPct,
  )
  return {
    res: trendSeries(c.length, resFit),
    sup: trendSeries(c.length, supFit),
    resFit,
    supFit,
  }
}
