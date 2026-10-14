// Does the bot's learning actually learn? The decisive check is a controlled
// experiment: plant a real, tradeable pattern in synthetic market data and see
// whether walk-forward training finds it and makes money on data it never saw —
// and, on the same machinery, whether it refuses pure noise.
//
// The planted pattern is order flow: in each regime, aggressive buyers' share
// of volume (taker-buy share) leans toward the direction price is drifting, and
// the drift persists for a few dozen bars. The model sees taker-buy share but is
// never told about the regimes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WF, gate, walkForward } from '../src/bot/walkforward.ts'
import type { Bar } from '../src/bot/features.ts'

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

function market(n: number, seed: number, signal: number): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0) drift = (r() < 0.5 ? -1 : 1) * 0.004 * signal // a new regime every 40 bars
    const o = p
    const c = o * (1 + drift + (r() - 0.5) * 0.02)
    const h = Math.max(o, c) * (1 + r() * 0.004)
    const l = Math.min(o, c) * (1 - r() * 0.004)
    const v = 100 + r() * 50
    // Buyers' share leans with the regime when there is a signal; pure noise otherwise.
    const share = Math.min(0.95, Math.max(0.05, 0.5 + Math.sign(drift) * 0.12 * signal + (r() - 0.5) * 0.2))
    out.push({ t: i * 14_400_000, o, h, l, c, v, tb: v * share })
    p = c
  }
  return out
}

const CFG = { ...DEFAULT_WF, trainBars: 2000, testBars: 500, mlp: { ...DEFAULT_WF.mlp, epochs: 25 } }

test('learning finds a planted order-flow pattern and profits on unseen data', () => {
  const res = walkForward(market(6000, 5, 1), CFG)
  const g = gate(res.metrics)
  console.log('planted pattern:', JSON.stringify({ trades: res.metrics.trades, winRate: +res.metrics.winRate.toFixed(3), expectancyR: +res.metrics.expectancyR.toFixed(3), pf: +res.metrics.profitFactor.toFixed(2), gate: g.pass }))
  assert.ok(res.metrics.trades >= 60, 'too few trades: ' + res.metrics.trades)
  assert.ok(res.metrics.expectancyR > 0.05, 'did not learn the pattern: ' + JSON.stringify(res.metrics))
  assert.equal(g.pass, true, 'gate refused a real edge: ' + g.reasons.join('; '))
})

test('the same learning refuses pure noise (no pattern to find)', () => {
  const res = walkForward(market(6000, 5, 0), CFG)
  const g = gate(res.metrics)
  console.log('pure noise:', JSON.stringify({ trades: res.metrics.trades, expectancyR: +res.metrics.expectancyR.toFixed(3), pf: +res.metrics.profitFactor.toFixed(2), gate: g.pass }))
  assert.equal(g.pass, false, 'passed on noise: ' + JSON.stringify(res.metrics))
})
