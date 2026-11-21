// Input study helpers (src/research/inputs.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURES } from '../src/bot/features.ts'
import { INPUT_GROUPS, correlations, folds, pearson, permutationLoss, rankIc, shuffled } from '../src/research/inputs.ts'
import type { TestRow } from '../src/research/inputs.ts'
import type { Model } from '../src/bot/walkforward.ts'

const K = { slAtr: 1.5, tpAtr: 2.25, horizon: 12 }

test('folds match the walk-forward: purged train window, 250-bar test blocks', () => {
  const f = folds(2700, { trainBars: 2000, testBars: 250, bracket: K })
  assert.deepEqual(f[0], { trainFrom: 0, trainTo: 1988, testFrom: 2000, testTo: 2250 })
  assert.deepEqual(f[1], { trainFrom: 250, trainTo: 2238, testFrom: 2250, testTo: 2500 })
  assert.equal(f.at(-1)!.testTo, 2700 - 12 - 1, 'the last block stops where labels end')
  for (const x of f) assert.ok(x.trainTo + K.horizon <= x.testFrom, 'no label reaches into its test block')
})

test('every input is in exactly one group', () => {
  const all = Object.values(INPUT_GROUPS).flat()
  assert.equal(all.length, FEATURES.length)
  assert.deepEqual([...all].sort(), [...FEATURES].sort())
})

/** A one-input "model": p = σ(5·tanh(4·x0)) on both sides. */
const MODEL = (() => {
  const side = { w: { nIn: 18, nHidden: 1, w1: [4, ...new Array(17).fill(0)], b1: [0], w2: [5], b2: 0 }, scaler: { mean: new Array(18).fill(0), std: new Array(18).fill(1) }, winR: 1.5, lossR: 1 }
  return { long: side, short: side } as unknown as Model
})()

test('permutation: shuffling the input the outcome depends on hurts; an unused one does not', () => {
  const rows: TestRow[] = Array.from({ length: 400 }, (_, k) => {
    const x0 = k % 2 ? 1 : -1
    const x = [x0, ...new Array(17).fill(0).map((_, j) => ((k * (j + 3)) % 7) - 3)]
    return { i: k, t: k, x, long: x0 > 0 ? 1.5 : -1, short: x0 > 0 ? 1.5 : -1 }
  })
  const used = permutationLoss(MODEL, rows, [0], 1)
  const unused = permutationLoss(MODEL, rows, [5], 1)
  assert.ok(used.delta > 0.5, `used input: ${used.delta}`)
  assert.ok(Math.abs(unused.delta) < 1e-12, 'unused input: no change')
  assert.equal(used.n, 800, 'both sides scored')
  assert.ok(rankIc(rows, 0, 'long')! > 0.99)
})

test('shuffle is deterministic and a permutation', () => {
  const a = shuffled([1, 2, 3, 4, 5, 6], 42)
  assert.deepEqual(a, shuffled([1, 2, 3, 4, 5, 6], 42))
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6])
})

test('correlations: finds a duplicated input', () => {
  const xs = Array.from({ length: 200 }, (_, k) => {
    const x = new Array(18).fill(0).map((_, j) => Math.sin(k * (j + 1) * 1.37))
    x[1] = x[0] * 2 + 0.01 * Math.cos(k)
    return x
  })
  const c = correlations(xs)
  assert.equal(c[0].a, FEATURES[0])
  assert.equal(c[0].b, FEATURES[1])
  assert.ok(c[0].r > 0.99)
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null)
})
