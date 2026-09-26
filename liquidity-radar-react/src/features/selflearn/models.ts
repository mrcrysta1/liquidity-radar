// Two small, fully inspectable learners in plain TypeScript — no TensorFlow,
// so they train in milliseconds, run in the background on any tab, and their
// weights fit in localStorage.
//
//  - Logit: logistic regression with L2, trained by mini-batch gradient
//    descent and then updated online, one closed trade at a time. This is the
//    part that "learns from its own trades".
//  - Ridge: closed-form ridge regression, used for the predicted price path.

export interface Scaler {
  mu: number[]
  sd: number[]
}

export function fitScaler(X: number[][]): Scaler {
  const d = X[0]?.length ?? 0
  const mu = new Array<number>(d).fill(0)
  const sd = new Array<number>(d).fill(0)
  X.forEach((x) => x.forEach((v, j) => (mu[j] += v / X.length)))
  X.forEach((x) => x.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / X.length)))
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1
  return { mu, sd }
}

const scale = (x: number[], s: Scaler) =>
  x.map((v, j) => Math.max(-6, Math.min(6, (v - s.mu[j]) / s.sd[j])))

export interface Logit extends Scaler {
  w: number[]
  b: number
  /** Samples it was fitted on, plus every online update since. */
  n: number
  /** Share of positive labels it was fitted on: the rate to beat. */
  base: number
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))))

export function fitLogit(X: number[][], y: number[], opts: { epochs?: number; lr?: number; l2?: number } = {}): Logit {
  const { epochs = 40, lr = 0.05, l2 = 2e-3 } = opts
  const sc = fitScaler(X)
  const Z = X.map((x) => scale(x, sc))
  const d = sc.mu.length
  const w = new Array<number>(d).fill(0)
  // Start from the base rate, so an uninformative model predicts it.
  const rate = Math.min(0.95, Math.max(0.05, y.reduce((a, b) => a + b, 0) / Math.max(1, y.length)))
  let b = Math.log(rate / (1 - rate))
  const idx = Z.map((_, i) => i)
  for (let e = 0; e < epochs; e++) {
    // Deterministic shuffle, so the same data gives the same model.
    for (let i = idx.length - 1; i > 0; i--) {
      const j = (i * 7919 + e * 104729) % (i + 1)
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    const step = lr / (1 + e * 0.05)
    for (let s = 0; s < idx.length; s += 32) {
      const gw = new Array<number>(d).fill(0)
      let gb = 0
      const end = Math.min(idx.length, s + 32)
      for (let k = s; k < end; k++) {
        const z = Z[idx[k]]
        let t = b
        for (let j = 0; j < d; j++) t += w[j] * z[j]
        const err = sigmoid(t) - y[idx[k]]
        for (let j = 0; j < d; j++) gw[j] += err * z[j]
        gb += err
      }
      const m = end - s
      for (let j = 0; j < d; j++) w[j] -= step * (gw[j] / m + l2 * w[j])
      b -= step * (gb / m)
    }
  }
  return { ...sc, w, b, n: X.length, base: rate }
}

export function pLogit(m: Logit, x: number[]): number {
  const z = scale(x, m)
  let t = m.b
  for (let j = 0; j < z.length; j++) t += m.w[j] * z[j]
  return sigmoid(t)
}

/** One online step from a real outcome. Returns the probability before and after. */
export function learnLogit(m: Logit, x: number[], y: number, lr = 0.03): { before: number; after: number } {
  const before = pLogit(m, x)
  const z = scale(x, m)
  const err = before - y
  for (let j = 0; j < z.length; j++) m.w[j] -= lr * (err * z[j] + 2e-3 * m.w[j])
  m.b -= lr * err
  m.n++
  return { before, after: pLogit(m, x) }
}

export interface Ridge extends Scaler {
  w: number[]
  b: number
}

/** Solves (ZᵀZ + λI)w = Zᵀy by Gaussian elimination; d is ~15, so this is instant. */
export function fitRidge(X: number[][], y: number[], lambda = 5): Ridge {
  const sc = fitScaler(X)
  const Z = X.map((x) => scale(x, sc))
  const d = sc.mu.length
  const ym = y.reduce((a, b) => a + b, 0) / Math.max(1, y.length)
  const A = Array.from({ length: d }, (_, i) => {
    const row = new Array<number>(d + 1).fill(0)
    row[i] = lambda
    return row
  })
  Z.forEach((z, k) => {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) A[i][j] += z[i] * z[j]
      A[i][d] += z[i] * (y[k] - ym)
    }
  })
  for (let c = 0; c < d; c++) {
    let p = c
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    const piv = A[c][c] || 1e-9
    for (let r = 0; r < d; r++) {
      if (r === c) continue
      const f = A[r][c] / piv
      if (!f) continue
      for (let k = c; k <= d; k++) A[r][k] -= f * A[c][k]
    }
  }
  const w = A.map((row, i) => row[d] / (row[i] || 1e-9))
  return { ...sc, w, b: ym }
}

export function predRidge(m: Ridge, x: number[]): number {
  const z = scale(x, m)
  let t = m.b
  for (let j = 0; j < z.length; j++) t += m.w[j] * z[j]
  return t
}
