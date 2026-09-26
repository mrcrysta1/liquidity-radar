// The predicted price path on the Neural Net chart.
//
// One ridge regression per horizon (1, 2, 4, 8 and 16 bars ahead), each fitted
// on this chart's own candles to the forward return from that bar. The first
// three quarters train an evaluation copy, which is scored on the last
// quarter it never saw — that score is the "model accuracy" shown, and it is
// the share of held-out bars where the predicted direction was right. The
// live path then comes from models refitted on everything.
import type { CandleFlat } from '../../services/market'
import { series } from './features'
import type { Series } from './features'
import { fitLogit, fitRidge, pLogit, predRidge } from './models'

export const HORIZONS = [1, 2, 4, 8, 16]

export interface PathPoint {
  t: number
  price: number
  lo: number
  hi: number
}

export interface Forecast {
  /** Predicted % change at each horizon. */
  pct: number[]
  path: PathPoint[]
  /** Chance the next `HORIZONS[2]` bars close higher. */
  pUp: number
  /** Held-out direction accuracy, 1 bar ahead and 4 bars ahead. */
  acc1: number
  acc4: number
  holdout: number
  trained: number
  /** Typical error of the 4-bar forecast, in %. */
  err4: number
  S: Series
}

export function forecast(cs: CandleFlat[], tfMs: number): Forecast | null {
  if (cs.length < 200) return null
  const S = series(cs)
  const n = cs.length
  const last = n - 1
  const xNow = S.X[last]
  if (!xNow) return null
  const H = HORIZONS
  const cut = Math.floor(n * 0.75)
  const pct: number[] = []
  const sigma: number[] = []
  let acc1 = 0.5
  let acc4 = 0.5
  let holdout = 0
  let trained = 0
  H.forEach((h, hi) => {
    const tr: number[][] = []
    const ytr: number[] = []
    const te: number[][] = []
    const yte: number[] = []
    const all: number[][] = []
    const yall: number[] = []
    for (let i = 50; i < n - h; i++) {
      const x = S.X[i]
      if (!x) continue
      const y = (cs[i + h].c / cs[i].c - 1) * 100
      all.push(x)
      yall.push(y)
      if (i + h < cut) {
        tr.push(x)
        ytr.push(y)
      } else if (i >= cut) {
        te.push(x)
        yte.push(y)
      }
    }
    if (tr.length < 60 || !te.length) {
      pct.push(0)
      sigma.push(0)
      return
    }
    const ev = fitRidge(tr, ytr)
    let hit = 0
    let se = 0
    te.forEach((x, k) => {
      const p = predRidge(ev, x)
      if (Math.sign(p) === Math.sign(yte[k]) && yte[k] !== 0) hit++
      se += (p - yte[k]) ** 2
    })
    if (hi === 0) {
      acc1 = hit / te.length
      holdout = te.length
      trained = all.length
    }
    if (hi === 2) acc4 = hit / te.length
    sigma.push(Math.sqrt(se / te.length))
    pct.push(predRidge(fitRidge(all, yall), xNow))
  })
  // Direction classifier for the confidence figure.
  const h4 = H[2]
  const X: number[][] = []
  const y: number[] = []
  for (let i = 50; i < n - h4; i++) {
    const x = S.X[i]
    if (!x) continue
    X.push(x)
    y.push(cs[i + h4].c > cs[i].c ? 1 : 0)
  }
  const pUp = X.length > 60 ? pLogit(fitLogit(X, y, { epochs: 25 }), xNow) : 0.5
  const base = cs[last].c
  const t0 = cs[last].t
  const path: PathPoint[] = [{ t: t0, price: base, lo: base, hi: base }]
  H.forEach((h, k) => {
    const price = base * (1 + pct[k] / 100)
    const band = base * (sigma[k] / 100)
    path.push({ t: t0 + h * tfMs, price, lo: price - band, hi: price + band })
  })
  return { pct, path, pUp, acc1, acc4, holdout, trained, err4: sigma[2] ?? 0, S }
}
