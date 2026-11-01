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

// ---- extended features (v2) -------------------------------------------------
//
// A second, wider feature set for the newer models: the 18 base features above
// plus multi-horizon returns, volatility structure, trend/regime, mean
// reversion, order flow from the taker-buy volume, BTC context for alts,
// funding, and calendar. The base set (FEATURES / featureAt) is unchanged, so
// the trade records the live loop already stores keep working.
//
// Every value at bar i uses only data known at that bar's close, T = t_i + step:
// bars 0..i, BTC bars that opened at or before t_i, funding settled at or
// before T. Context series may run past T; they are cut, not trusted. A test
// checks that appending the future (to the bars or the context) never changes
// a past row.

/** Data from outside the symbol's own bars. All optional; missing → neutral 0s. */
export interface Context {
  /** BTCUSDT bars at the same interval (for alts). Omit for BTC itself. */
  btc?: Bar[]
  /** Funding settlements, any order. */
  funding?: Array<{ t: number; rate: number }>
  /** Bar size in ms; inferred from the bars when omitted. */
  stepMs?: number
}

export const CONTEXT_FEATURES = [
  'lret_72_z',
  'lret_120_z',
  'rv_24',
  'rv_ratio',
  'vol_of_vol',
  'parkinson_ratio',
  'adx',
  'di_diff',
  'ema50_slope_atr',
  'dist_ema200_atr',
  'eff_ratio_24',
  'var_ratio_4',
  'z_48',
  'rsi_7',
  'taker_share_24',
  'taker_share_z',
  'taker_delta_6',
  'vol_trend',
  'btc_ret_1_z',
  'btc_ret_6_z',
  'btc_ret_24_z',
  'rel_ret_24',
  'btc_rv_ratio',
  'funding_bps',
  'funding_mean_bps',
  'funding_chg_bps',
  'dow_sin',
  'dow_cos',
  'weekend',
] as const

export const FEATURES_V2 = [...FEATURES, ...CONTEXT_FEATURES] as const

/** Per-bar context rows (null before warm-up), built once per series. */
export interface ContextSeries {
  rows: Array<number[] | null>
}

const lnRet = (b: Bar[]) => b.map((x, i) => (i && b[i - 1].c > 0 && x.c > 0 ? Math.log(x.c / b[i - 1].c) : 0))

/** Root mean square of a[i-n+1..i]. */
function rms(a: number[], i: number, n: number): number {
  let s = 0
  const lo = Math.max(0, i - n + 1)
  for (let j = lo; j <= i; j++) s += a[j] * a[j]
  return Math.sqrt(s / (i - lo + 1)) || 1e-12
}

function meanSd(a: number[], i: number, n: number): [number, number] {
  const lo = Math.max(0, i - n + 1)
  let s = 0
  for (let j = lo; j <= i; j++) s += a[j]
  const m = s / (i - lo + 1)
  let v = 0
  for (let j = lo; j <= i; j++) v += (a[j] - m) ** 2
  return [m, Math.sqrt(v / (i - lo + 1)) || 1e-12]
}

/** Wilder RSI and ADX / ±DI, causal. */
function wilder(b: Bar[], n: number): { rsi: number[]; adx: number[]; diDiff: number[] } {
  const rsi: number[] = []
  const adx: number[] = []
  const diDiff: number[] = []
  let up = 0
  let dn = 0
  let tr = 0
  let pdm = 0
  let mdm = 0
  let dx = 0
  for (let i = 0; i < b.length; i++) {
    const p = i ? b[i - 1] : b[i]
    const d = b[i].c - p.c
    const hu = b[i].h - p.h
    const ld = p.l - b[i].l
    const t = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - p.c), Math.abs(b[i].l - p.c)) : b[i].h - b[i].l
    const k = i < n ? 1 / (i + 1) : 1 / n
    up += (Math.max(0, d) - up) * k
    dn += (Math.max(0, -d) - dn) * k
    tr += (t - tr) * k
    pdm += ((hu > ld && hu > 0 ? hu : 0) - pdm) * k
    mdm += ((ld > hu && ld > 0 ? ld : 0) - mdm) * k
    const pdi = tr > 0 ? (100 * pdm) / tr : 0
    const mdi = tr > 0 ? (100 * mdm) / tr : 0
    const x = pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0
    dx += (x - dx) * k
    rsi.push(dn === 0 ? 100 : 100 - 100 / (1 + up / dn))
    adx.push(dx)
    diDiff.push(pdi - mdi)
  }
  return { rsi, adx, diDiff }
}

function inferStep(b: Bar[]): number {
  const d: number[] = []
  for (let i = 1; i < Math.min(b.length, 50); i++) d.push(b[i].t - b[i - 1].t)
  d.sort((x, y) => x - y)
  return d[Math.floor(d.length / 2)] || 3_600_000
}

/** Index of the last element with key <= v in an ascending array; -1 if none. */
function lastAtOrBefore(keys: number[], v: number): number {
  let lo = 0
  let hi = keys.length - 1
  let ans = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (keys[m] <= v) {
      ans = m
      lo = m + 1
    } else hi = m - 1
  }
  return ans
}

/** BTC-side per-bar values on BTC's own index: z-returns over 1/6/24 bars, log 24-bar return, rv ratio. */
function btcSeries(btc: Bar[]) {
  const lr = lnRet(btc)
  const out: Array<number[] | null> = []
  for (let j = 0; j < btc.length; j++) {
    if (j < 120) {
      out.push(null)
      continue
    }
    const rv120 = rms(lr, j, 120)
    const r = (k: number) => Math.log(btc[j].c / btc[j - k].c)
    out.push([r(1) / rv120, r(6) / (rv120 * Math.sqrt(6)), r(24) / (rv120 * Math.sqrt(24)), r(24), Math.log(rms(lr, j, 24) / rv120)])
  }
  return out
}

/** Build the context rows for every bar of `b`. O(n · window). */
export function contextSeries(b: Bar[], ind: Ind, ctx: Context = {}): ContextSeries {
  const n = b.length
  const step = ctx.stepMs ?? inferStep(b)
  const lr = lnRet(b)
  const c = b.map((x) => x.c)
  const ema = (src: number[], k: number) => {
    const a = 2 / (k + 1)
    const o: number[] = []
    src.forEach((v, i) => o.push(i ? v * a + o[i - 1] * (1 - a) : v))
    return o
  }
  const ema200 = ema(c, 200)
  const w7 = wilder(b, 7)
  const w14 = wilder(b, 14)
  const share = b.map((x) => (x.v > 0 ? x.tb / x.v : 0.5))
  const hl = b.map((x) => (x.h > 0 && x.l > 0 ? Math.log(x.h / x.l) : 0))
  const rv12 = b.map((_, i) => rms(lr, i, 12))
  // BTC: values at the last BTC bar that opened at or before this bar.
  const btc = ctx.btc?.length ? ctx.btc : null
  const btcT = btc ? btc.map((x) => x.t) : []
  const btcRows = btc ? btcSeries(btc) : []
  const fund = (ctx.funding ?? []).filter((x) => isFinite(x.rate)).sort((x, y) => x.t - y.t)
  const fundT = fund.map((x) => x.t)
  const rows: Array<number[] | null> = []
  for (let i = 0; i < n; i++) {
    if (i < WARMUP) {
      rows.push(null)
      continue
    }
    const a = ind.atr[i] || 1e-12
    const rv24 = rms(lr, i, 24)
    const rv120 = rms(lr, i, 120)
    const lret = (k: number) => Math.log(c[i] / c[i - k])
    // Vol of vol: dispersion of the 12-bar realised vol over 48 bars, relative to its mean.
    const [vm, vs] = meanSd(rv12, i, 48)
    const pk = Math.sqrt(hl.slice(i - 23, i + 1).reduce((s, v) => s + v * v, 0) / 24 / (4 * Math.LN2))
    // Efficiency ratio, signed: net move over path length.
    let path = 0
    for (let j = i - 23; j <= i; j++) path += Math.abs(c[j] - c[j - 1])
    const er = path > 0 ? (c[i] - c[i - 24]) / path : 0
    // Variance ratio over 96 bars: >0 trending, <0 mean reverting.
    let v1 = 0
    let v4 = 0
    for (let j = i - 95; j <= i; j++) {
      v1 += lr[j] * lr[j]
      const r4 = lr[j] + lr[j - 1] + lr[j - 2] + lr[j - 3]
      v4 += r4 * r4
    }
    const vr = v1 > 0 ? v4 / (4 * v1) - 1 : 0
    const [m48, s48] = meanSd(c, i, 48)
    let v24 = 0
    let tb24 = 0
    for (let j = i - 23; j <= i; j++) {
      v24 += b[j].v
      tb24 += b[j].tb
    }
    const [sm, ss] = meanSd(share, i, 96)
    let v6 = 0
    let d6 = 0
    for (let j = i - 5; j <= i; j++) {
      v6 += b[j].v
      d6 += 2 * b[j].tb - b[j].v
    }
    let v48 = 0
    for (let j = i - 47; j <= i; j++) v48 += b[j].v
    // BTC context.
    let bx = [0, 0, 0, 0, 0]
    if (btc) {
      const j = lastAtOrBefore(btcT, b[i].t)
      // Stale BTC data (more than one bar behind) counts as missing.
      if (j >= 0 && b[i].t - btcT[j] <= step && btcRows[j]) bx = btcRows[j]!
    } else bx = [lret(1) / rv120, lret(6) / (rv120 * Math.sqrt(6)), lret(24) / (rv120 * Math.sqrt(24)), lret(24), Math.log(rv24 / rv120)]
    // Funding settled by the close.
    let f = [0, 0, 0]
    const T = b[i].t + step
    const k = lastAtOrBefore(fundT, T)
    if (k >= 0 && T - fundT[k] <= 24 * 3_600_000) {
      const last = fund[k].rate
      const prev = fund.slice(Math.max(0, k - 21), k).map((x) => x.rate)
      const mean = prev.length ? prev.reduce((s, v) => s + v, 0) / prev.length : last
      const all = fund.slice(Math.max(0, k - 20), k + 1).map((x) => x.rate)
      f = [last * 1e4, (all.reduce((s, v) => s + v, 0) / all.length) * 1e4, (last - mean) * 1e4]
    }
    const d = new Date(T - 1)
    const dow = d.getUTCDay() + (d.getUTCHours() + d.getUTCMinutes() / 60) / 24
    rows.push([
      lret(72) / (rv120 * Math.sqrt(72)),
      lret(120) / (rv120 * Math.sqrt(120)),
      rv24 * 100,
      Math.log(rv24 / rv120),
      vm > 0 ? vs / vm : 0,
      pk / rv24,
      w14.adx[i] / 100 - 0.25,
      w14.diDiff[i] / 100,
      (ind.ema50[i] - ind.ema50[i - 6]) / a,
      (c[i] - ema200[i]) / a,
      er,
      vr,
      (c[i] - m48) / s48,
      w7.rsi[i] / 100 - 0.5,
      v24 > 0 ? tb24 / v24 - 0.5 : 0,
      (share[i] - sm) / ss,
      v6 > 0 ? d6 / v6 : 0,
      v48 > 0 && v6 > 0 ? Math.log(v6 / 6 / (v48 / 48)) : 0,
      bx[0],
      bx[1],
      bx[2],
      btc ? lret(24) - bx[3] : 0,
      bx[4],
      f[0],
      f[1],
      f[2],
      Math.sin((dow / 7) * 2 * Math.PI),
      Math.cos((dow / 7) * 2 * Math.PI),
      d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 1 : 0,
    ].map((v) => (isFinite(v) ? v : 0)))
  }
  return { rows }
}

/** Base features followed by the context features (FEATURES_V2 order). */
export function featureAtV2(b: Bar[], ind: Ind, cs: ContextSeries, i: number): number[] | null {
  const base = featureAt(b, ind, i)
  const extra = cs.rows[i]
  return base && extra ? [...base, ...extra] : null
}