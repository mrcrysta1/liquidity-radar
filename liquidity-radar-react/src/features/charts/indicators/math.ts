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

// ---------------------------------------------------------------------------
// Pro library indicators (pro-terminal/src/core/pine/library.ts), ported to
// plain array maths. Same conventions as above: equal-length output, `null`
// during warm-up.

/** Run `fn` on the defined tail of a series and re-pad the warm-up with nulls,
 *  so derived series (EMA of an EMA, WMA of a WMA difference) seed correctly. */
export function onDefined(s: Series, fn: (v: number[]) => Series): Series {
  const start = s.findIndex((x) => x != null && isFinite(x))
  if (start === -1) return NaNs(s.length)
  const tail = s.slice(start).map((x) => (x == null ? NaN : x))
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
