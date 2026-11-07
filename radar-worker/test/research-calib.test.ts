// The calibration study (src/research/calib.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calibrationStudy, pairedDiff, prequential, score } from '../src/research/calib.ts'
import type { CalRow } from '../src/research/calib.ts'

const H4 = 14_400_000
/** A deterministic pseudo-random stream. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('score: perfect, useless and inverted predictions', () => {
  const y: Array<0 | 1> = [1, 0, 1, 0]
  const good = score([0.9, 0.1, 0.9, 0.1], y)
  const flat = score([0.5, 0.5, 0.5, 0.5], y)
  assert.equal(good.auc, 1)
  assert.equal(flat.auc, 0.5)
  assert.ok(good.logLoss! < flat.logLoss!)
  assert.equal(score([0.1, 0.9, 0.1, 0.9], y).auc, 0)
  assert.ok(Math.abs(flat.ece!) < 1e-12)
  assert.equal(score([], []).n, 0)
})

test('prequential: a prediction never sees its own outcome, or any that closed later', () => {
  // Two rows decided at once; the first closes before the second is decided? No: both decided at t=0.
  const rows: CalRow[] = [
    { symbol: 'A', side: 1, regime: 'up-lo', t: 0, closedAt: 10, pRaw: 0.6, y: 1, rr: 1.5, r: 1.4 },
    { symbol: 'A', side: 1, regime: 'up-lo', t: 0, closedAt: 10, pRaw: 0.6, y: 1, rr: 1.5, r: 1.4 },
    { symbol: 'A', side: 1, regime: 'up-lo', t: 20, closedAt: 30, pRaw: 0.6, y: 0, rr: 1.5, r: -1 },
  ]
  const p = prequential(rows)
  assert.equal(p.cell[0], p.cell[1], 'same information for both')
  assert.ok(Math.abs(p.cell[0] - 0.6) < 1e-9, 'nothing learned yet: the identity')
  assert.ok(p.cell[2] > 0.6, 'two wins learned before the third decision')
  assert.deepEqual([p['base-rate'][0], p['base-rate'][2]], [0.5, 3 / 4])
})

test('pairedDiff: grouped by candle, no range from few candles', () => {
  const d = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.02 : 0.01))
  const r = pairedDiff(d, d.map((_, i) => i))
  assert.ok(r.lo! > 0 && Math.abs(r.mean! - 0.015) < 1e-12)
  assert.equal(pairedDiff(d, d.map((_, i) => i % 5)).lo, null)
})

test('study: an over-confident model is fixed by pooled calibration, and the study says so', () => {
  const rand = rng(7)
  const rows: CalRow[] = []
  // 24 markets × 2 sides × 6 regimes; the model says ~0.5–0.6 but wins only 35% (longs) / 45% (shorts).
  const syms = Array.from({ length: 24 }, (_, i) => 'S' + i)
  const regimes = ['up-lo', 'up-mid', 'up-hi', 'down-lo', 'down-mid', 'down-hi']
  for (let k = 0; k < 1600; k++) {
    const side = rand() < 0.5 ? 1 : -1
    const pRaw = 0.5 + rand() * 0.1
    const y = rand() < (side > 0 ? 0.35 : 0.45) ? 1 : 0
    const t = Math.floor(k / 8) * H4
    rows.push({ symbol: syms[Math.floor(rand() * 24)], side, regime: regimes[Math.floor(rand() * 6)], t, closedAt: t + 3 * H4, pRaw, y, rr: 1.5, r: y ? 1.4 : -1.05 })
  }
  const s = calibrationStudy(rows)
  const get = (id: string) => s.candidates.find((c) => c.id === id)!
  assert.ok(get('side').all.logLoss! < get('cell').all.logLoss!, 'pooling per side learns the bias faster')
  assert.ok(get('side').vsLive.lo! > 0, 'and clearly so')
  assert.ok(Math.abs(get('side').long.meanP! - get('side').long.winRate!) < Math.abs(get('raw').long.meanP! - get('raw').long.winRate!))
  assert.ok(s.better && s.better !== 'cell' && s.better !== 'base-rate', s.better ?? 'none')
  assert.match(s.verdict, /predicts better than the live scheme/)
  assert.ok(get('raw').taken.n > get('side').taken.n, 'honest probabilities take fewer losing trades')
})
