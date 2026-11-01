// Gradient-boosted decision trees for binary log loss, in plain TypeScript.
//
// Second-order (Newton) boosting as in XGBoost/LightGBM, kept small:
//   - features are bucketed once into ≤ maxBins quantile bins (training rows only),
//   - each tree is grown depth-first to maxDepth from per-node gradient histograms,
//   - leaf value −G/(H+λ), shrunk by the learning rate,
//   - row and column subsampling per tree, a minimum hessian / row count per leaf,
//   - early stopping on the chronologically last validFrac of the rows.
// Deterministic given a seed; the model is plain JSON.
import { clampP, logit, rng, sigmoid } from './common.ts'

export interface GbdtOpts {
  trees?: number
  lr?: number
  maxDepth?: number
  maxBins?: number
  /** L2 penalty on leaf values. */
  lambda?: number
  minLeaf?: number
  minHess?: number
  /** Minimum loss reduction for a split. */
  gamma?: number
  rowFrac?: number
  colFrac?: number
  validFrac?: number
  patience?: number
  seed?: number
}

export const DEFAULT_GBDT: Required<GbdtOpts> = {
  trees: 400,
  lr: 0.03,
  maxDepth: 3,
  maxBins: 32,
  lambda: 5,
  minLeaf: 40,
  minHess: 3,
  gamma: 0,
  rowFrac: 0.7,
  colFrac: 0.7,
  validFrac: 0.2,
  patience: 40,
  seed: 7,
}

/** A tree as flat arrays: node k splits on feat[k] (value <= thr[k] → left[k]), or is a leaf when feat[k] < 0. */
export interface Tree {
  feat: number[]
  thr: number[]
  left: number[]
  right: number[]
  value: number[]
}

export interface GbdtModel {
  base: number
  trees: Tree[]
}

/** Quantile cut points per feature: bin(v) = first k with v <= cuts[k], else cuts.length. */
export function quantileCuts(X: number[][], maxBins: number): number[][] {
  const d = X[0]?.length || 0
  const cuts: number[][] = []
  for (let j = 0; j < d; j++) {
    const v = X.map((x) => x[j]).sort((a, b) => a - b)
    const c: number[] = []
    for (let q = 1; q < maxBins; q++) {
      const t = v[Math.min(v.length - 1, Math.floor((q * v.length) / maxBins))]
      if (!c.length || t > c[c.length - 1]) c.push(t)
    }
    // The top cut would send nothing right.
    if (c.length && c[c.length - 1] >= v[v.length - 1]) c.pop()
    cuts.push(c)
  }
  return cuts
}

function binOf(cuts: number[], v: number): number {
  let lo = 0
  let hi = cuts.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (v <= cuts[m]) hi = m
    else lo = m + 1
  }
  return lo
}

export function treeValue(t: Tree, x: number[]): number {
  let k = 0
  while (t.feat[k] >= 0) k = x[t.feat[k]] <= t.thr[k] ? t.left[k] : t.right[k]
  return t.value[k]
}

export function gbdtLogit(m: GbdtModel, x: number[]): number {
  let z = m.base
  for (const t of m.trees) z += treeValue(t, x)
  return z
}

export const gbdtProb = (m: GbdtModel, x: number[]) => sigmoid(gbdtLogit(m, x))

export function fitGbdt(X: number[][], y: number[], opts: GbdtOpts = {}): GbdtModel {
  const o = { ...DEFAULT_GBDT, ...opts }
  const n = X.length
  const d = X[0]?.length || 0
  const nValid = Math.floor(n * o.validFrac)
  const nTr = n - nValid
  const rand = rng(o.seed)
  const cuts = quantileCuts(X.slice(0, nTr), o.maxBins)
  const nb = cuts.map((c) => c.length + 1)
  // Binned matrix, feature-major for cache-friendly histograms.
  const B: Uint8Array[] = cuts.map((c, j) => Uint8Array.from(X.map((x) => binOf(c, x[j]))))
  const mean = y.slice(0, nTr).reduce((a, v) => a + v, 0) / Math.max(1, nTr)
  const base = logit(clampP(mean))
  const F = new Float64Array(n).fill(base)
  const g = new Float64Array(n)
  const h = new Float64Array(n)
  const trees: Tree[] = []
  let best = Infinity
  let bestN = 0
  let since = 0
  const validLoss = () => {
    let s = 0
    for (let i = nTr; i < n; i++) {
      const p = clampP(sigmoid(F[i]))
      s -= y[i] ? Math.log(p) : Math.log(1 - p)
    }
    return s / Math.max(1, nValid)
  }

  for (let it = 0; it < o.trees; it++) {
    for (let i = 0; i < nTr; i++) {
      const p = sigmoid(F[i])
      g[i] = p - y[i]
      h[i] = Math.max(p * (1 - p), 1e-6)
    }
    const rows: number[] = []
    for (let i = 0; i < nTr; i++) if (rand() < o.rowFrac) rows.push(i)
    const cols: number[] = []
    for (let j = 0; j < d; j++) if (rand() < o.colFrac) cols.push(j)
    if (!cols.length) cols.push(Math.floor(rand() * d))
    const t: Tree = { feat: [], thr: [], left: [], right: [], value: [] }
    const grow = (idx: number[], depth: number): number => {
      const k = t.feat.length
      t.feat.push(-1)
      t.thr.push(0)
      t.left.push(-1)
      t.right.push(-1)
      t.value.push(0)
      let G = 0
      let H = 0
      for (const i of idx) {
        G += g[i]
        H += h[i]
      }
      t.value[k] = (-G / (H + o.lambda)) * o.lr
      if (depth >= o.maxDepth || idx.length < 2 * o.minLeaf) return k
      const parent = (G * G) / (H + o.lambda)
      let bestGain = o.gamma
      let bf = -1
      let bs = -1
      for (const j of cols) {
        const m = nb[j]
        if (m < 2) continue
        const hg = new Float64Array(m)
        const hh = new Float64Array(m)
        const hc = new Int32Array(m)
        const col = B[j]
        for (const i of idx) {
          const b = col[i]
          hg[b] += g[i]
          hh[b] += h[i]
          hc[b]++
        }
        let gl = 0
        let hl = 0
        let cl = 0
        for (let s = 0; s < m - 1; s++) {
          gl += hg[s]
          hl += hh[s]
          cl += hc[s]
          const cr = idx.length - cl
          if (cl < o.minLeaf) continue
          if (cr < o.minLeaf) break
          const hr = H - hl
          if (hl < o.minHess || hr < o.minHess) continue
          const gr = G - gl
          const gain = 0.5 * ((gl * gl) / (hl + o.lambda) + (gr * gr) / (hr + o.lambda) - parent)
          if (gain > bestGain) {
            bestGain = gain
            bf = j
            bs = s
          }
        }
      }
      if (bf < 0) return k
      const L: number[] = []
      const R: number[] = []
      for (const i of idx) (B[bf][i] <= bs ? L : R).push(i)
      t.feat[k] = bf
      t.thr[k] = cuts[bf][bs]
      t.left[k] = grow(L, depth + 1)
      t.right[k] = grow(R, depth + 1)
      return k
    }
    grow(rows, 0)
    // Apply the tree through its bins (identical to the raw-value thresholds).
    for (let i = 0; i < n; i++) {
      let k = 0
      while (t.feat[k] >= 0) {
        const j = t.feat[k]
        k = X[i][j] <= t.thr[k] ? t.left[k] : t.right[k]
      }
      F[i] += t.value[k]
    }
    trees.push(t)
    if (!nValid) continue
    const vl = validLoss()
    if (vl < best - 1e-6) {
      best = vl
      bestN = trees.length
      since = 0
    } else if (++since >= o.patience) break
  }
  return { base, trees: nValid ? trees.slice(0, bestN) : trees }
}
