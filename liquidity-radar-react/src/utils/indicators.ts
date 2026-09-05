import type {
  AIScore,
  BB,
  CandleLike,
  Forecast,
  ForecastRow,
  MACD,
  SupportResistance,
  VolTrend,
} from '../types/market'

export function emaArr(v: number[], p: number): number[] {
  const k = 2 / (p + 1)
  const o = [v[0]]
  for (let i = 1; i < v.length; i++) o.push(v[i] * k + o[i - 1] * (1 - k))
  return o
}

export function calcRSI(closes: number[], p?: number): number {
  p = p || 14
  if (closes.length < p + 1) return 50
  let g = 0,
    l = 0
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) g += d
    else l -= d
  }
  let ag = g / p,
    al = l / p
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    ag = (ag * (p - 1) + Math.max(d, 0)) / p
    al = (al * (p - 1) + Math.max(-d, 0)) / p
  }
  if (al === 0) return 100
  return 100 - 100 / (1 + ag / al)
}

export function calcMACD(closes: number[]): MACD {
  const e12 = emaArr(closes, 12),
    e26 = emaArr(closes, 26)
  const line = closes.map((_, i) => e12[i] - e26[i])
  const sig = emaArr(line, 9)
  const hist = line[line.length - 1] - sig[sig.length - 1]
  return { macd: line[line.length - 1], signal: sig[sig.length - 1], hist: hist }
}

export function calcBB(closes: number[], p?: number, m?: number): BB {
  p = p || 20
  m = m || 2
  const w = closes.slice(-p)
  const mid = w.reduce((a, b) => a + b, 0) / p
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) * (b - mid), 0) / p)
  const up = mid + m * sd,
    lo = mid - m * sd,
    last = closes[closes.length - 1]
  return { mid: mid, up: up, lo: lo, pctB: up === lo ? 50 : ((last - lo) / (up - lo)) * 100 }
}

export function calcATR(candles: CandleLike[], p?: number): number {
  p = p || 14
  const w = candles.slice(-(p + 1))
  if (w.length < 2) return 0
  let s = 0
  for (let i = 1; i < w.length; i++) {
    const tr = Math.max(
      w[i].h - w[i].l,
      Math.abs(w[i].h - w[i - 1].c),
      Math.abs(w[i].l - w[i - 1].c),
    )
    s += tr
  }
  return s / (w.length - 1)
}

export function volTrend(vols: number[]): VolTrend {
  if (vols.length < 20) return 'FLAT'
  const a = vols.slice(-10).reduce((x, y) => x + y, 0) / 10
  const b = vols.slice(-20, -10).reduce((x, y) => x + y, 0) / 10
  if (b === 0) return 'FLAT'
  const r = a / b
  return r > 1.08 ? 'RISING' : r < 0.92 ? 'FALLING' : 'FLAT'
}

export function linReg(y: number[]): { slope: number; intercept: number } {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: y[n - 1] || 0 }
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]
    sxy += i * y[i]
    sxx += i * i
  }
  const den = n * sxx - sx * sx
  const slope = den ? (n * sxy - sx * sy) / den : 0
  return { slope: slope, intercept: (sy - slope * sx) / n }
}

export function aiComposite(candles: CandleLike[], closes: number[], vols: number[]): AIScore {
  const last = closes[closes.length - 1]
  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)
  const e20 = emaArr(closes, 20)[closes.length - 1]
  const bb = calcBB(closes)
  const vt = volTrend(vols)
  const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
  let score = 0
  score += clamp((50 - rsi) / 50, -1, 1) * 22
  score += clamp(macd.hist / (last * 0.002), -1, 1) * 26
  score += clamp((last - e20) / (last * 0.012), -1, 1) * 18
  score += clamp((bb.pctB - 50) / 50, -1, 1) * 14
  const momSign = closes[closes.length - 1] >= closes[closes.length - 2] ? 1 : -1
  score += (vt === 'RISING' ? 10 : vt === 'FALLING' ? -10 : 0) * momSign
  score += clamp((last - bb.mid) / (bb.mid * 0.01), -1, 1) * 10
  score = Math.max(-100, Math.min(100, Math.round(score)))
  let label: string, color: string, badge: string
  if (score > 45) {
    label = 'STRONG BUY'
    color = '#00E676'
    badge = 'b-green'
  } else if (score > 15) {
    label = 'BUY'
    color = '#00E676'
    badge = 'b-green'
  } else if (score > -15) {
    label = 'NEUTRAL'
    color = '#8FA3BF'
    badge = 'b-gray'
  } else if (score > -45) {
    label = 'SELL'
    color = '#FF1744'
    badge = 'b-red'
  } else {
    label = 'STRONG SELL'
    color = '#FF1744'
    badge = 'b-red'
  }
  return {
    score: score,
    label: label,
    color: color,
    badge: badge,
    rsi: rsi,
    macd: macd,
    e20: e20,
    bb: bb,
    vt: vt,
    last: last,
  }
}

export function forecastFrom(closes: number[]): Forecast {
  const win = closes.slice(-20)
  const last = closes[closes.length - 1]
  const lr = linReg(win)
  const slope = lr.slope
  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1)
  }
  const meanR = rets.reduce((a, b) => a + b, 0) / rets.length
  const sd =
    Math.sqrt(rets.reduce((a, b) => a + (b - meanR) * (b - meanR), 0) / rets.length) || 0.001
  const damp = 0.55
  const defs: Array<[number, string, number]> = [
    [1, '1H', 4],
    [4, '4H', 16],
    [8, '8H', 32],
    [24, '24H', 96],
  ]
  const baseConf = [74, 62, 50, 38]
  const rows: ForecastRow[] = defs.map(function (def, idx) {
    const k = def[2]
    const pred = last + slope * k * damp
    const band = last * sd * Math.sqrt(k) * 1.28
    const dp = (pred / last - 1) * 100
    const sigOK = Math.abs(slope / last) > 0.0002
    const conf = Math.max(20, baseConf[idx] + (sigOK ? 6 : -14))
    return { label: def[1], pred: pred, lo: pred - band, hi: pred + band, dp: dp, conf: conf }
  })
  const bias = rows[3].dp >= 0 ? 'UP ▲' : 'DOWN ▼'
  return { rows: rows, bias: bias }
}

export function supportResistance(candles: CandleLike[]): SupportResistance | null {
  const w = candles.slice(-96)
  if (!w.length) return null
  return {
    res: Math.max.apply(
      null,
      w.map((c) => c.h),
    ),
    sup: Math.min.apply(
      null,
      w.map((c) => c.l),
    ),
  }
}

export function smaArr(v: number[], p: number): (number | null)[] {
  const o: (number | null)[] = []
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) {
      o.push(null)
      continue
    }
    let s = 0
    for (let j = 0; j < p; j++) s += v[i - j]
    o.push(s / p)
  }
  return o
}

export function vwapSeries(
  candles: CandleLike[],
  period?: number,
): ({ time: number; value: number } | null)[] {
  const p = period || 0
  const n = candles.length
  const out: ({ time: number; value: number } | null)[] = new Array(n).fill(null)
  let pv = 0,
    vol = 0,
    start = 0
  for (let i = 0; i < n; i++) {
    const c = candles[i],
      t = +c.t
    const typical = (c.h + c.l + c.c) / 3
    if (p > 0 && i - start >= p) {
      const rem = candles[start]
      const tpv = ((rem.h + rem.l + rem.c) / 3) * (rem.v || 0)
      pv -= tpv
      vol -= rem.v || 0
      start++
    }
    pv += typical * (c.v || 0)
    vol += c.v || 0
    if (vol > 0) out[i] = { time: Math.floor(t / 1000), value: pv / vol }
  }
  return out
}

export function macdSeries(closes: number[]): { line: number[]; sig: number[]; hist: number[] } {
  const e12 = emaArr(closes, 12),
    e26 = emaArr(closes, 26)
  const line = closes.map((_, i) => e12[i] - e26[i])
  const sig = emaArr(line, 9)
  const hist = line.map((v, i) => v - (sig[i] != null ? sig[i] : v))
  return { line: line, sig: sig, hist: hist }
}

export function calcBBList(
  closes: number[],
  p: number,
): { mid: number | null; up: number | null; lo: number | null }[] {
  const out: { mid: number | null; up: number | null; lo: number | null }[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < p - 1) {
      out.push({ mid: null, up: null, lo: null })
      continue
    }
    const bb = calcBB(closes.slice(0, i + 1), p)
    out.push({ mid: bb.mid, up: bb.up, lo: bb.lo })
  }
  return out
}
