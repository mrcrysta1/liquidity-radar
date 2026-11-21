// ML2 research inputs and logistic regression (src/research/ml2.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bar } from '../src/bot/features.ts'
import { ML2_INPUTS, ML2_WARMUP, fitLogit, funding3d, logitProb, ml2Inputs } from '../src/research/ml2.ts'

const STEP = 4 * 3_600_000
/** A wandering price path, deterministic. */
function path(n: number, seed: number, start = 0): Bar[] {
  let c = 100
  return Array.from({ length: n }, (_, k) => {
    const o = c
    c = c * (1 + 0.01 * Math.sin(k * 0.13 * seed) + 0.004 * Math.cos(k * 0.71 + seed))
    return { t: (start + k) * STEP, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: 10 + ((k * seed) % 7), tb: 5 }
  })
}
const market = () => ({ BTCUSDT: path(500, 1), ETHUSDT: path(500, 2), SOLUSDT: path(250, 3, 250), XRPUSDT: path(500, 5) })
const fund = { BTCUSDT: [{ t: 0, rate: 0.0001 }, { t: 300 * STEP, rate: 0.0003 }], ETHUSDT: [], SOLUSDT: [], XRPUSDT: [] }

test('12 inputs, nothing before the warm-up, all finite after it', () => {
  const x = ml2Inputs(market(), fund, STEP)
  assert.equal(ML2_INPUTS.length, 12)
  assert.equal(x.ETHUSDT[ML2_WARMUP - 1], null)
  const row = x.ETHUSDT[450]!
  assert.equal(row.length, 12)
  assert.ok(row.every((v) => Number.isFinite(v)))
  assert.ok(row[7] >= 0 && row[7] <= 1, 'breadth is a share')
  // SOL starts 250 bars later: its first rows wait for its own history.
  assert.equal(x.SOLUSDT[ML2_WARMUP - 1], null)
})

test('no look-ahead: later bars (of any market) never change an earlier input', () => {
  const full = market()
  const cut = 380
  const past = Object.fromEntries(Object.entries(full).map(([s, b]) => [s, b.filter((x) => x.t <= cut * STEP)]))
  const a = ml2Inputs(past, fund, STEP)
  const b = ml2Inputs(full, fund, STEP)
  for (const s of Object.keys(full))
    a[s].forEach((row, i) => {
      if (row) assert.deepEqual(b[s][i], row, `${s} bar ${i}`)
    })
})

test('breadth counts only coins trading at that time', () => {
  const m = market()
  const withSol = ml2Inputs(m, fund, STEP)
  const noSol = ml2Inputs({ ...m, SOLUSDT: [] }, fund, STEP)
  // Before SOL's first bar the breadth inputs are identical with or without it.
  assert.deepEqual(withSol.ETHUSDT[ML2_WARMUP + 5]!.slice(7, 9), noSol.ETHUSDT[ML2_WARMUP + 5]!.slice(7, 9))
})

test('funding: 3-day mean of settled rates; default before the history', () => {
  const f = [{ t: 10 * 86_400_000, rate: 0.0002 }, { t: 11 * 86_400_000, rate: 0.0004 }, { t: 20 * 86_400_000, rate: 0.001 }]
  assert.equal(funding3d(f, 5 * 86_400_000), 0.0001)
  assert.ok(Math.abs(funding3d(f, 12 * 86_400_000) - 0.0003) < 1e-12)
  assert.equal(funding3d(f, 16 * 86_400_000), 0, 'nothing settled in the last 3 days')
  assert.equal(funding3d(f, 19.9 * 86_400_000), 0, 'the future rate is not used')
})

test('logistic regression recovers a clear relation and stays near 0.5 on noise', () => {
  const X: number[][] = []
  const y: number[] = []
  for (let k = 0; k < 2000; k++) {
    const a = Math.sin(k * 1.7)
    const noise = Math.cos(k * 3.1)
    X.push([a, noise])
    y.push(a + 0.3 * Math.sin(k * 7.3) > 0 ? 1 : 0)
  }
  const m = fitLogit(X, y, 1)
  assert.ok(m.w[0] > 2, `signal weight ${m.w[0]}`)
  assert.ok(Math.abs(m.w[1]) < 0.5, `noise weight ${m.w[1]}`)
  assert.ok(logitProb(m, [1, 0]) > 0.8 && logitProb(m, [-1, 0]) < 0.2)
  const flat = fitLogit(X, X.map((_, k) => k % 2), 1)
  assert.ok(Math.abs(logitProb(flat, [1, 0]) - 0.5) < 0.1)
})
