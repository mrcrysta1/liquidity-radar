// Setup rules: every check that must pass before an order is placed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETUP, checkSetup, shadowWorthy } from '../src/bot/setup.ts'
import type { SetupInput } from '../src/bot/setup.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'

const NOW = Date.UTC(2026, 9, 24, 12)
// Entry 100, stop 1 away (1%), target 2 away: 2R gross. Round-trip cost at the
// stop = (0.0007 + 0.0007) × 100 / 1 = 0.14R; at the target 0.09R.
const base: SetupInput = {
  entry: 100,
  slDist: 1,
  tpDist: 2,
  costs: DEFAULT_WF.costs,
  evR: 0.1,
  evFloor: -1e9,
  gated: false,
  gatePass: false,
  canEnter: true,
  openPositions: 0,
  tradesToday: 0,
  lastStopAt: null,
  now: NOW,
}

test('a good setup passes every rule', () => {
  const c = checkSetup(base)
  assert.equal(c.ok, true, [...c.hard, ...c.model].join('; '))
  assert.ok(Math.abs(c.costR - 0.14) < 1e-9, 'cost ' + c.costR)
  assert.ok(Math.abs(c.rr - (2 - 0.09) / 1.14) < 1e-9, 'rr ' + c.rr)
})

test('R:R must be at least 1.5 after fees and slippage', () => {
  // 1.6R gross looks fine but is 1.33 after costs.
  const c = checkSetup({ ...base, tpDist: 1.6 })
  assert.equal(c.ok, false)
  assert.match(c.hard.join(), /R:R 1\.32 after costs/)
  assert.equal(checkSetup({ ...base, tpDist: 1.9 }).ok, true, '1.9R gross → 1.59 net passes')
})

test('cost must be at most 0.15R', () => {
  // A 0.5% stop: the same fees are 0.28R of it.
  const c = checkSetup({ ...base, slDist: 0.5, tpDist: 1.5 })
  assert.match(c.hard.join(), /cost 0\.280R \(max 0\.15R\)/)
  assert.equal(shadowWorthy(c), false, 'a hard rejection is not shadowed')
})

test('cooldown after a stop-out on the symbol', () => {
  const c = checkSetup({ ...base, lastStopAt: NOW - 10 * 60_000 })
  assert.match(c.hard.join(), /cooldown after a stop-out \(20 min left\)/)
  assert.equal(checkSetup({ ...base, lastStopAt: NOW - 31 * 60_000 }).ok, true, 'over after 30 min')
})

test('at most 4 positions at once and 120 trades a day', () => {
  assert.equal(checkSetup({ ...base, openPositions: 3 }).ok, true)
  assert.match(checkSetup({ ...base, openPositions: 4 }).hard.join(), /4 positions open \(max 4\)/)
  assert.equal(checkSetup({ ...base, tradesToday: 119 }).ok, true)
  assert.match(checkSetup({ ...base, tradesToday: 120 }).hard.join(), /daily trade cap reached \(120\/120\)/)
})

test('model expected value must be above 0 (or the stricter BOT_MIN_EV)', () => {
  for (const ev of [0, -0.2]) {
    const c = checkSetup({ ...base, evR: ev })
    assert.equal(c.ok, false)
    assert.deepEqual(c.hard, [])
    assert.match(c.model.join(), /below the 0R bar/)
    assert.equal(shadowWorthy(c), true, 'rejected only by the model → shadow trade')
  }
  const strict = checkSetup({ ...base, evR: 0.05, evFloor: 0.08 })
  assert.match(strict.model.join(), /below the 0\.08R bar/)
})

test('gated mode needs the walk-forward gate; that verdict alone also shadows', () => {
  const c = checkSetup({ ...base, gated: true, gatePass: false, modelId: 7, gateReason: 'only 12 trades' })
  assert.match(c.model.join(), /model #7 has no proven edge \(only 12 trades\)/)
  assert.equal(shadowWorthy(c), true)
  assert.equal(checkSetup({ ...base, gated: true, gatePass: true }).ok, true)
})

test('the existing risk limits still block entries, and are not shadowed', () => {
  const c = checkSetup({ ...base, canEnter: false, evR: -1 })
  assert.ok(c.hard.includes('risk limits'))
  assert.equal(c.model.length, 1)
  assert.equal(shadowWorthy(c), false, 'any hard reason means no shadow either')
})

test('limits are configurable', () => {
  const loose = { ...DEFAULT_SETUP, maxOpen: 10, maxCostR: 0.3, minRR: 1.2 }
  assert.equal(checkSetup({ ...base, openPositions: 6, slDist: 0.5, tpDist: 1 }, loose).ok, true)
  assert.match(checkSetup({ ...base, slDist: 0 }).hard.join(), /invalid stop/)
})
