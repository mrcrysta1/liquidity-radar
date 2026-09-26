import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyScaler, fitScaler, logLoss, predict, train } from '../src/bot/mlp.ts'
import { WARMUP, featureAt, indicators, outcomeAt } from '../src/bot/features.ts'
import type { Bar } from '../src/bot/features.ts'
import { DEFAULT_WF, gate, walkForward } from '../src/bot/walkforward.ts'

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
}

/** Random-walk bars: no edge exists in them by construction. */
function walk(n: number, seed = 3): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const c = o * (1 + (r() - 0.5) * 0.02)
    const h = Math.max(o, c) * (1 + r() * 0.004)
    const l = Math.min(o, c) * (1 - r() * 0.004)
    const v = 100 + r() * 50
    out.push({ t: i * 3_600_000, o, h, l, c, v, tb: v * r() })
    p = c
  }
  return out
}

test('mlp learns a non-linear boundary', () => {
  const r = rng(9)
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < 2000; i++) {
    const a = r() * 2 - 1
    const b = r() * 2 - 1
    X.push([a, b])
    y.push(a * b > 0 ? 1 : 0) // XOR-like: not linearly separable
  }
  const m = train(X, y, { hidden: 8, epochs: 200, lr: 0.03, l2: 0, validFrac: 0.2, patience: 30 })
  const acc = X.filter((x, i) => (predict(m, x) > 0.5 ? 1 : 0) === y[i]).length / X.length
  assert.ok(acc > 0.9, 'accuracy ' + acc)
  assert.ok(logLoss(m, X, y) < 0.4)
})

test('scaler standardises and clips', () => {
  const s = fitScaler([[1, 10], [3, 10], [5, 10]])
  assert.deepEqual(applyScaler(s, [3, 10]), [0, 0])
  assert.equal(applyScaler(s, [1e9, 10])[0], 5)
})

test('features never look ahead', () => {
  const b = walk(600)
  const full = indicators(b)
  const cut = b.slice(0, 400)
  const part = indicators(cut)
  for (const i of [WARMUP, 300, 399]) assert.deepEqual(featureAt(cut, part, i), featureAt(b, full, i), 'bar ' + i)
})

test('bracket outcomes: stop first, target, same-bar = stop, time exit', () => {
  const base: Bar = { t: 0, o: 100, h: 100.5, l: 99.5, c: 100, v: 1, tb: 0.5 }
  const b: Bar[] = Array.from({ length: 30 }, (_, i) => ({ ...base, t: i }))
  const ind = { ...indicators(b), atr: new Array(30).fill(1) }
  const k = { slAtr: 1.5, tpAtr: 3, horizon: 5 }
  const at = (mod: Partial<Bar>) => {
    const bb = b.map((x) => ({ ...x }))
    Object.assign(bb[3], mod)
    return outcomeAt(bb, ind, 1, 1, k)!
  }
  assert.equal(at({ h: 103.5 }).exit, 'tp')
  assert.equal(at({ h: 103.5 }).r, 2)
  assert.equal(at({ l: 98.4 }).exit, 'sl')
  assert.equal(at({ h: 103.5, l: 98.4 }).exit, 'sl', 'both in one bar counts as the stop')
  const t = at({})
  assert.equal(t.exit, 'time')
  assert.equal(t.r, 0)
  assert.equal(outcomeAt(b, ind, 26, 1, k), null, 'future unknown')
})

test('on a random walk the gate refuses to trade', () => {
  const b = walk(7000, 21)
  const res = walkForward(b, { ...DEFAULT_WF, trainBars: 3000, testBars: 800, mlp: { ...DEFAULT_WF.mlp, epochs: 15 } })
  const g = gate(res.metrics)
  assert.equal(g.pass, false, 'passed on pure noise: ' + JSON.stringify(res.metrics))
  assert.ok(g.reasons.length > 0)
})
