// A small multilayer perceptron for binary classification, in plain
// TypeScript: inputs → tanh hidden layer → sigmoid probability. Trained with
// Adam on log loss, L2 weight decay, and early stopping on a held-out slice.
//
// Deliberately tiny. With a few thousand noisy market samples, capacity is the
// enemy: a bigger net just memorises. No dependencies, deterministic given a
// seed, and the whole model serialises to JSON for the database.

export interface MlpWeights {
  nIn: number
  nHidden: number
  w1: number[] // nHidden × nIn, row-major
  b1: number[]
  w2: number[] // nHidden
  b2: number
}

export interface TrainOpts {
  hidden?: number
  epochs?: number
  lr?: number
  l2?: number
  batch?: number
  seed?: number
  /** Fraction of the (chronologically last) training rows used for early stopping. */
  validFrac?: number
  patience?: number
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    // xorshift32
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export function predict(m: MlpWeights, x: number[]): number {
  let z = m.b2
  for (let h = 0; h < m.nHidden; h++) {
    let a = m.b1[h]
    const row = h * m.nIn
    for (let i = 0; i < m.nIn; i++) a += m.w1[row + i] * x[i]
    z += m.w2[h] * Math.tanh(a)
  }
  return sigmoid(z)
}

export function logLoss(m: MlpWeights, X: number[][], y: number[]): number {
  let s = 0
  for (let i = 0; i < X.length; i++) {
    const p = Math.min(1 - 1e-7, Math.max(1e-7, predict(m, X[i])))
    s -= y[i] ? Math.log(p) : Math.log(1 - p)
  }
  return s / Math.max(1, X.length)
}

/** Train on rows X (already standardised) with 0/1 labels y, in time order. */
export function train(X: number[][], y: number[], o: TrainOpts = {}): MlpWeights {
  const nIn = X[0]?.length || 0
  const H = o.hidden ?? 6
  const epochs = o.epochs ?? 60
  const lr = o.lr ?? 0.01
  const l2 = o.l2 ?? 1e-3
  const batch = o.batch ?? 64
  const patience = o.patience ?? 8
  const r = rng(o.seed ?? 42)
  // Early-stopping slice: the most recent rows, so it looks like the future.
  const nValid = Math.floor(X.length * (o.validFrac ?? 0.2))
  const nTrain = X.length - nValid
  const scale = Math.sqrt(1 / Math.max(1, nIn))
  const m: MlpWeights = {
    nIn,
    nHidden: H,
    w1: Array.from({ length: H * nIn }, () => (r() * 2 - 1) * scale),
    b1: new Array(H).fill(0),
    w2: Array.from({ length: H }, () => (r() * 2 - 1) * Math.sqrt(1 / H)),
    b2: 0,
  }
  // Adam state, one flat vector per parameter group.
  const params = [m.w1, m.b1, m.w2]
  const mom = params.map((p) => new Array(p.length).fill(0))
  const vel = params.map((p) => new Array(p.length).fill(0))
  let mB2 = 0
  let vB2 = 0
  const b1c = 0.9
  const b2c = 0.999
  let step = 0

  let best = Infinity
  let bestW = JSON.stringify(m)
  let since = 0
  const order = Array.from({ length: nTrain }, (_, i) => i)
  const hid = new Array(H).fill(0)

  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (let s = 0; s < order.length; s += batch) {
      const g = params.map((p) => new Array(p.length).fill(0))
      let gB2 = 0
      const end = Math.min(order.length, s + batch)
      for (let k = s; k < end; k++) {
        const x = X[order[k]]
        let z = m.b2
        for (let h = 0; h < H; h++) {
          let a = m.b1[h]
          const row = h * nIn
          for (let i = 0; i < nIn; i++) a += m.w1[row + i] * x[i]
          hid[h] = Math.tanh(a)
          z += m.w2[h] * hid[h]
        }
        const d = sigmoid(z) - y[order[k]] // dLoss/dz for log loss
        gB2 += d
        for (let h = 0; h < H; h++) {
          g[2][h] += d * hid[h]
          const dh = d * m.w2[h] * (1 - hid[h] * hid[h])
          g[1][h] += dh
          const row = h * nIn
          for (let i = 0; i < nIn; i++) g[0][row + i] += dh * x[i]
        }
      }
      const n = end - s
      step++
      const c1 = 1 - b1c ** step
      const c2 = 1 - b2c ** step
      params.forEach((p, pi) => {
        const decay = pi === 1 ? 0 : l2 // no decay on biases
        for (let i = 0; i < p.length; i++) {
          const gi = g[pi][i] / n + decay * p[i]
          mom[pi][i] = b1c * mom[pi][i] + (1 - b1c) * gi
          vel[pi][i] = b2c * vel[pi][i] + (1 - b2c) * gi * gi
          p[i] -= (lr * (mom[pi][i] / c1)) / (Math.sqrt(vel[pi][i] / c2) + 1e-8)
        }
      })
      const gb = gB2 / n
      mB2 = b1c * mB2 + (1 - b1c) * gb
      vB2 = b2c * vB2 + (1 - b2c) * gb * gb
      m.b2 -= (lr * (mB2 / c1)) / (Math.sqrt(vB2 / c2) + 1e-8)
    }
    if (!nValid) continue
    const vl = logLoss(m, X.slice(nTrain), y.slice(nTrain))
    if (vl < best - 1e-5) {
      best = vl
      bestW = JSON.stringify(m)
      since = 0
    } else if (++since >= patience) break
  }
  return nValid ? (JSON.parse(bestW) as MlpWeights) : m
}

/** Column means and standard deviations, from training rows only. */
export interface Scaler {
  mean: number[]
  std: number[]
}

export function fitScaler(X: number[][]): Scaler {
  const n = X.length
  const d = X[0]?.length || 0
  const mean = new Array(d).fill(0)
  const std = new Array(d).fill(0)
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / n
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2 / n
  return { mean, std: std.map((v) => Math.sqrt(v) || 1) }
}

export function applyScaler(s: Scaler, x: number[]): number[] {
  // Clipped, so one freak bar cannot saturate every unit.
  return x.map((v, j) => Math.max(-5, Math.min(5, (v - s.mean[j]) / s.std[j])))
}
