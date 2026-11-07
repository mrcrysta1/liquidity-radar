// "Is it on track?" — is the server bot's learning heading the right way?
//
// Pure (tested in scripts/test-engines.mjs). Three questions, each with the
// sample size it needs before the answer means anything:
//   1. Do losing trades cost about 1R? (bracket and sizing work as planned)
//   2. Are its probabilities honest? Predicted win chance vs actual, over real
//      and shadow trades — both are the model's own calls.
//   3. Is there an edge? Mean R of real trades with a 95% interval; only real
//      trades count, because shadow trades are the ideas it turned down.
//
// Outcomes decided on the same candle are not independent: when BTC drops, the
// shorts on all 24 markets win together. Every sample size, interval and pace
// here is therefore clustered by decision candle: one market-wide move counts
// for about one outcome, not 24, so a single day cannot fake an edge.

export interface Outcome {
  /** Calibrated win probability for the side taken. */
  p: number
  /** Result in R after costs. */
  r: number
  /** When it was opened, ms. */
  t: number
  exit?: string | null
  /** The decision candle (ms); outcomes sharing it are one cluster. Default: t on the 4h grid. */
  bar?: number
}

export interface CalBucket {
  lo: number
  hi: number
  n: number
  pred: number
  actual: number
}

export type Verdict = 'early' | 'learning' | 'on-track' | 'off-track'

export interface OnTrack {
  verdict: Verdict
  reasons: string[]
  real: number
  shadow: number
  /** Real trades closed at the stop, and their mean R (should be near −1). */
  stops: { n: number; meanR: number | null }
  /** n: outcomes; eff: what they are worth as independent ones; bars: decision candles. */
  cal: { n: number; eff: number; bars: number; buckets: CalBucket[]; gap: number | null; brier: number | null; need: number }
  edge: { n: number; eff: number; meanR: number | null; lo: number | null; hi: number | null; pEdge: number | null; need: number }
  /** Days until each answer is reliable, at the pace so far; null when unknown. */
  days: { cal: number | null; edge: number | null }
}

/** Outcomes needed for a ±5% read on the win rate (95%). */
export const CAL_NEED = 385
/** Real trades assumed for an edge of ~0.17R when there is no estimate yet. */
export const EDGE_NEED_DEFAULT = 250
const MIN_CAL = 30
const MIN_EDGE = 30

const BAR_MS = 4 * 3_600_000
/** Fewer candles than this and a cluster-robust standard error is too optimistic: none is given. */
export const MIN_CLUSTERS = 10

/** Outcomes grouped by decision candle. */
export function clusters(rows: Outcome[]): Outcome[][] {
  const m = new Map<number, Outcome[]>()
  for (const x of rows) {
    const k = x.bar ?? Math.floor(x.t / BAR_MS) * BAR_MS
    const g = m.get(k)
    if (g) g.push(x)
    else m.set(k, [x])
  }
  return [...m.values()]
}

/**
 * Cluster-robust mean and standard error of v(x) (sandwich estimator with the
 * G / (G − 1) small-sample factor), and the effective sample size: how many
 * independent outcomes would give the same precision. Equals n when outcomes on
 * a candle are unrelated, falls toward the number of candles when they move
 * together.
 */
export function clustered(rows: Outcome[], v: (x: Outcome) => number): { n: number; bars: number; mean: number | null; se: number | null; eff: number } {
  const n = rows.length
  if (!n) return { n, bars: 0, mean: null, se: null, eff: 0 }
  const groups = clusters(rows)
  const G = groups.length
  const mean = rows.reduce((s, x) => s + v(x), 0) / n
  const naive = rows.reduce((s, x) => s + (v(x) - mean) ** 2, 0)
  const robust = groups.reduce((s, g) => s + g.reduce((a, x) => a + v(x) - mean, 0) ** 2, 0)
  const eff = robust > 0 ? Math.max(1, Math.min(n, Math.round((n * naive) / robust))) : naive > 0 ? n : G
  const se = G >= MIN_CLUSTERS && robust > 0 ? Math.sqrt((robust / n ** 2) * (G / (G - 1))) : null
  return { n, bars: G, mean, se, eff }
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7). */
export function phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

export function calibration(rows: Outcome[], edges = [0, 0.45, 0.5, 0.55, 0.6, 0.65, 1]): CalBucket[] {
  const out: CalBucket[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]
    const hi = edges[i + 1]
    const b = rows.filter((x) => x.p >= lo && (i === edges.length - 2 ? x.p <= hi : x.p < hi))
    if (!b.length) continue
    out.push({ lo, hi, n: b.length, pred: b.reduce((s, x) => s + x.p, 0) / b.length, actual: b.filter((x) => x.r > 0).length / b.length })
  }
  return out
}

function daysLeft(have: number, need: number, since: number, now: number): number | null {
  if (have >= need) return 0
  const days = (now - since) / 86_400_000
  if (days < 1 || have < 1) return null
  return Math.ceil((need - have) / (have / days))
}

export function onTrack(real: Outcome[], shadow: Outcome[], since: number, now: number): OnTrack {
  const all = [...real, ...shadow]
  const reasons: string[] = []

  const sl = real.filter((x) => x.exit === 'sl')
  const stops = { n: sl.length, meanR: sl.length ? sl.reduce((s, x) => s + x.r, 0) / sl.length : null }

  const buckets = calibration(all)
  const nCal = all.length
  const wins = clustered(all, (x) => (x.r > 0 ? 1 : 0))
  const effCal = wins.eff
  const gap = effCal >= MIN_CAL ? buckets.reduce((s, b) => s + b.n * Math.abs(b.pred - b.actual), 0) / nCal : null
  const brier = nCal ? all.reduce((s, x) => s + (x.p - (x.r > 0 ? 1 : 0)) ** 2, 0) / nCal : null

  const n = real.length
  const rc = clustered(real, (x) => x.r)
  const mean = rc.mean
  const effEdge = rc.eff
  const sd = n > 1 && mean != null ? Math.sqrt(real.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (n - 1)) : null
  const se = rc.se
  const lo = mean != null && se != null ? mean - 1.96 * se : null
  const hi = mean != null && se != null ? mean + 1.96 * se : null
  const pEdge = mean != null && se ? phi(mean / se) : null
  // Independent trades for the 95% interval to clear zero at the edge seen so far.
  const need = mean != null && sd != null && mean > 0 && effEdge >= 10 ? Math.max(MIN_EDGE, Math.ceil(((1.96 * sd) / mean) ** 2)) : EDGE_NEED_DEFAULT

  let verdict: Verdict = 'learning'
  if (stops.n >= 5 && stops.meanR! < -1.3) {
    verdict = 'off-track'
    reasons.push(`stop-outs cost ${stops.meanR!.toFixed(2)}R on average, not about −1R: sizing, fees or slippage are off`)
  }
  if (gap != null && effCal >= 100 && gap > 0.1) {
    verdict = 'off-track'
    reasons.push(`its win chances are off by ${(gap * 100).toFixed(0)} points on average`)
  }
  if (effEdge >= MIN_EDGE && pEdge != null && pEdge <= 0.1) {
    verdict = 'off-track'
    reasons.push(`real trades lose ${(-mean!).toFixed(2)}R each; only a ${(pEdge * 100).toFixed(0)}% chance that is bad luck on a real edge`)
  }
  if (verdict !== 'off-track') {
    if (effCal < MIN_CAL && effEdge < 10) {
      verdict = 'early'
      reasons.push(`${nCal} outcomes so far, worth about ${effCal} independent ones — at least ${MIN_CAL} before any read`)
    } else if (effEdge >= MIN_EDGE && lo != null && lo > 0 && (gap == null || gap <= 0.07)) {
      verdict = 'on-track'
      reasons.push(`real trades make ${mean!.toFixed(2)}R each and the 95% range stays above zero`)
    } else {
      if (gap != null) reasons.push(gap <= 0.07 ? `win chances are within ${(gap * 100).toFixed(0)} points of reality` : `win chances are off by ${(gap * 100).toFixed(0)} points so far`)
      if (pEdge != null && effEdge >= 10) reasons.push(`${(pEdge * 100).toFixed(0)}% likely the real-trade edge is above zero (${n} trades)`)
      else reasons.push(`${n} real trades — the edge needs about ${need}`)
    }
  }
  if (nCal >= 20 && effCal < nCal / 2) {
    reasons.push(`${nCal} outcomes on ${wins.bars} candles: many moved together, so they count as about ${effCal} independent ones`)
  }

  return {
    verdict,
    reasons,
    real: n,
    shadow: shadow.length,
    stops,
    cal: { n: nCal, eff: effCal, bars: wins.bars, buckets, gap, brier, need: CAL_NEED },
    edge: { n, eff: effEdge, meanR: mean, lo, hi, pEdge, need },
    days: { cal: daysLeft(effCal, CAL_NEED, since, now), edge: daysLeft(effEdge, need, since, now) },
  }
}
