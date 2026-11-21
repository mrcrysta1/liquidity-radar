// Model-vs-trend-rule study helpers (src/research/skill.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costR, indicators } from '../src/bot/features.ts'
import type { Bar } from '../src/bot/features.ts'
import { bracketTrade, standalone, trendSides } from '../src/research/skill.ts'

const STEP = 4 * 3_600_000
const K = { slAtr: 1.5, tpAtr: 2.25, horizon: 12 }
const COSTS = { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true }
const bar = (k: number, c: number, wick = 0.5): Bar => ({ t: k * STEP, o: c, h: c + wick, l: c - wick, c, v: 1, tb: 0.5 })
/** Flat, then a steady climb: a long from the climb hits its target. */
const path = (n = 120) => Array.from({ length: n }, (_, k) => bar(k, k < 60 ? 100 : 100 + (k - 60) * 0.8))
const noFunding = [{ t: 0, rate: 0 }]

test('trendSides: above / below the EMA, 0 without history or a matching bar', () => {
  const ref = Array.from({ length: 40 }, (_, k) => bar(k, k < 20 ? 100 - k : 80 + 3 * (k - 20)))
  const s = trendSides(ref, ref, 10)
  assert.equal(s[5], 0, 'not 10 bars yet')
  assert.equal(s[18], -1)
  assert.equal(s[39], 1)
  // A coin with a bar the reference does not have.
  const coin = [bar(3, 1), bar(39, 1), bar(99, 1)]
  assert.deepEqual(trendSides(coin, ref, 10), [0, 1, 0])
})

test('bracketTrade: target hit, net of the same costs as the labels, funding by side', () => {
  const b = path()
  const ind = indicators(b)
  const i = 70
  const long = bracketTrade(b, ind, i, 1, K, COSTS, noFunding, STEP)!
  assert.equal(long.exit, 'tp')
  const dist = K.slAtr * ind.atr[i]
  assert.ok(Math.abs(long.r - (K.tpAtr / K.slAtr - costR(b[i].c, dist, COSTS, 'tp'))) < 1e-9)
  assert.equal(long.t, b[i].t + STEP)
  const short = bracketTrade(b, ind, i, -1, K, COSTS, noFunding, STEP)!
  assert.equal(short.exit, 'sl')
  // Positive funding: longs pay, shorts receive.
  const paid = [{ t: 0, rate: 0 }, { t: b[i].t + STEP + 1, rate: 0.001 }]
  assert.ok(bracketTrade(b, ind, i, 1, K, COSTS, paid, STEP)!.r < long.r)
  assert.ok(bracketTrade(b, ind, i, -1, K, COSTS, paid, STEP)!.r > short.r)
  assert.equal(bracketTrade(b, ind, b.length - 2, 1, K, COSTS, noFunding, STEP), null, 'not ended yet')
})

test('standalone: one trade at a time, only when the rule has a side', () => {
  const b = path()
  const ind = indicators(b)
  const tr = standalone(b, ind, (i) => (i % 2 ? 1 : 0), 20, 100, K, COSTS, noFunding, STEP)
  assert.ok(tr.length > 1)
  for (let k = 1; k < tr.length; k++) assert.ok(tr[k].i > tr[k - 1].end, 'no overlap')
  assert.ok(tr.every((x) => x.i % 2 === 1 && x.i >= 20 && x.i < 100))
  assert.deepEqual(standalone(b, ind, () => 0, 20, 100, K, COSTS, noFunding, STEP), [])
})
