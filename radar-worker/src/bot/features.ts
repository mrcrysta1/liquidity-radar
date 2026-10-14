// Features and labels for the trading model.
//
// Features at bar i use bars 0..i only (bar i is closed): the bot decides at a
// bar's close and enters at the next bar's open, exactly as the labels assume.
// A test checks that appending future bars never changes a past feature.
//
// Labels are the trade the bot would actually take: enter at the next open,
// stop SL_ATR × ATR away, target TP_ATR × ATR away, time exit after `horizon`
// bars. Whichever is touched first decides it; a bar that touches both counts
// as a stop (we cannot know the order inside a bar, so assume the worst).

export interface Bar {
  t: number // open time, ms
  o: number
  h: number
  l: number
  c: number
  v: number // base volume
  tb: number // taker-buy base volume — the aggressive-buyer share of the bar
}

/** Binance kline array → Bar. */
export function barFromKline(k: unknown[]): Bar {
  return { t: +(k[0] as number), o: +(k[1] as string), h: +(k[2] as string), l: +(k[3] as string), c: +(k[4] as string), v: +(k[5] as string), tb: +(k[9] as string) }
}

export interface Ind {
  atr: number[]
  rsi: number[]
  ema20: number[]
  ema50: number[]
  macdH: number[]
  bbMid: number[]
  bbSd: number[]
  volMa: number[]
}

function ema(src: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = []
  src.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v))
  return out
}

/** Every indicator is causal: value i depends on bars 0..i. */
export function indicators(b: Bar[]): Ind {
  const n = b.length
  const tr = b.map((x, i) => (i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l))
  const atr: number[] = []
  const rsi: number[] = []
  let up = 0
  let dn = 0
  for (let i = 0; i < n; i++) {
    atr.push(i < 14 ? tr.slice(0, i + 1).reduce((a, v) => a + v, 0) / (i + 1) : (atr[i - 1] * 13 + tr[i]) / 14)
    const d = i ? b[i].c - b[i - 1].c : 0
    up = i < 14 ? up + Math.max(0, d) / 14 : (up * 13 + Math.max(0, d)) / 14
    dn = i < 14 ? dn + Math.max(0, -d) / 14 : (dn * 13 + Math.max(0, -d)) / 14
    rsi.push(dn === 0 ? 100 : 100 - 100 / (1 + up / dn))
  }
  const c = b.map((x) => x.c)
  const e12 = ema(c, 12)
  const e26 = ema(c, 26)
  const macd = e12.map((v, i) => v - e26[i])
  const sig = ema(macd, 9)
  const bbMid: number[] = []
  const bbSd: number[] = []
  const volMa: number[] = []
  for (let i = 0; i < n; i++) {
    const w = c.slice(Math.max(0, i - 19), i + 1)
    const m = w.reduce((a, v) => a + v, 0) / w.length
    bbMid.push(m)
    bbSd.push(Math.sqrt(w.reduce((a, v) => a + (v - m) ** 2, 0) / w.length) || 1e-12)
    const vw = b.slice(Math.max(0, i - 19), i + 1)
    volMa.push(vw.reduce((a, x) => a + x.v, 0) / vw.length || 1e-12)
  }
  return { atr, rsi, ema20: ema(c, 20), ema50: ema(c, 50), macdH: macd.map((v, i) => v - sig[i]), bbMid, bbSd, volMa }
}

export const FEATURES = [
  'ret1_atr',
  'ret4_atr',
  'ret12_atr',
  'ret48_atr',
  'rsi',
  'macd_hist_atr',
  'dist_ema20_atr',
  'dist_ema50_atr',
  'ema20_vs_50_atr',
  'bb_pctb',
  'atr_pct',
  'atr_rank_200',
  'log_vol_ratio',
  'taker_buy_share',
  'taker_buy_share_4',
  'range_pos_24',
  'hour_sin',
  'hour_cos',
] as const

/** Bars needed before the first feature row. */
export const WARMUP = 200

export function featureAt(b: Bar[], ind: Ind, i: number): number[] | null {
  if (i < WARMUP || i >= b.length) return null
  const a = ind.atr[i] || 1e-12
  const c = b[i].c
  const ret = (k: number) => (c - b[i - k].c) / a
  const w200 = ind.atr.slice(i - 199, i + 1)
  const atrRank = w200.filter((v) => v <= ind.atr[i]).length / w200.length
  const share = (x: Bar) => (x.v > 0 ? x.tb / x.v : 0.5)
  const last4 = b.slice(i - 3, i + 1)
  const hi24 = Math.max(...b.slice(i - 23, i + 1).map((x) => x.h))
  const lo24 = Math.min(...b.slice(i - 23, i + 1).map((x) => x.l))
  const hour = new Date(b[i].t).getUTCHours() + new Date(b[i].t).getUTCMinutes() / 60
  return [
    ret(1),
    ret(4),
    ret(12),
    ret(48),
    ind.rsi[i] / 100 - 0.5,
    ind.macdH[i] / a,
    (c - ind.ema20[i]) / a,
    (c - ind.ema50[i]) / a,
    (ind.ema20[i] - ind.ema50[i]) / a,
    (c - (ind.bbMid[i] - 2 * ind.bbSd[i])) / (4 * ind.bbSd[i]),
    (a / c) * 100,
    atrRank,
    Math.log((b[i].v || 1e-12) / ind.volMa[i]),
    share(b[i]) - 0.5,
    last4.reduce((s, x) => s + share(x), 0) / 4 - 0.5,
    hi24 > lo24 ? (c - lo24) / (hi24 - lo24) : 0.5,
    Math.sin((hour / 24) * 2 * Math.PI),
    Math.cos((hour / 24) * 2 * Math.PI),
  ]
}

export interface Bracket {
  slAtr: number
  tpAtr: number
  horizon: number
}

export interface Outcome {
  /** Result in R (multiples of the stop distance), before costs. */
  r: number
  exit: 'tp' | 'sl' | 'time'
  /** Index of the bar the trade ended in. */
  end: number
  entry: number
  sl: number
  tp: number
}

/** The bracket trade decided at bar i's close; null if the future is not known yet. */
export function outcomeAt(b: Bar[], ind: Ind, i: number, side: 1 | -1, k: Bracket): Outcome | null {
  if (i + k.horizon >= b.length) return null
  const entry = b[i + 1].o
  const dist = k.slAtr * ind.atr[i]
  if (!(dist > 0)) return null
  const sl = entry - side * dist
  const tp = entry + side * k.tpAtr * ind.atr[i]
  for (let j = i + 1; j <= i + k.horizon; j++) {
    const x = b[j]
    const hitSl = side > 0 ? x.l <= sl : x.h >= sl
    const hitTp = side > 0 ? x.h >= tp : x.l <= tp
    if (hitSl) return { r: -1, exit: 'sl', end: j, entry, sl, tp }
    if (hitTp) return { r: k.tpAtr / k.slAtr, exit: 'tp', end: j, entry, sl, tp }
  }
  const last = b[i + k.horizon].c
  return { r: (side * (last - entry)) / dist, exit: 'time', end: i + k.horizon, entry, sl, tp }
}

/**
 * Fees and slippage, per leg. Market orders (entry, stop, time exit) pay the
 * taker fee plus slippage; a take-profit resting as a limit order pays the
 * maker fee and no slippage.
 */
export interface Costs {
  taker: number
  maker: number
  slip: number
  /** Take-profit as a resting limit (maker) rather than a market trigger. */
  tpMaker: boolean
}

/** Cost of one trade in R, by how it ended. */
export function costR(entry: number, slDist: number, c: Costs, exit: 'tp' | 'sl' | 'time'): number {
  const leg = (maker: boolean) => (maker ? c.maker : c.taker + c.slip)
  return ((leg(false) + leg(exit === 'tp' && c.tpMaker)) * entry) / slDist
}
