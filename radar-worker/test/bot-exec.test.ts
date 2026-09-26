import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Futures, roundStep, roundTick, sign } from '../src/bot/futures.ts'
import { DEFAULT_RISK, checkLimits, size } from '../src/bot/risk.ts'

test('request signing matches Binance’s published example', () => {
  const q = 'symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=1&price=9000&timeInForce=GTC&recvWindow=5000&timestamp=1591702613943'
  assert.equal(sign(q, '2b5eb11e18796d12d88f13dc27dbbd02c2cc51ff7059765ed9821957d82bb4d9'), '3c661234138461fcc7a7d8746c6558c9842d4e10870d2ecbedf7777cad694af9')
})

test('mainnet needs an explicit opt-in', () => {
  delete process.env.ALLOW_MAINNET
  assert.throws(() => new Futures('k', 's', 'https://fapi.binance.com'), /mainnet/)
  assert.ok(new Futures('k', 's').isTestnet)
})

test('rounding follows exchange steps', () => {
  assert.equal(roundStep(0.123456, 0.001, 3), '0.123')
  assert.equal(roundStep(0.3, 0.1, 1), '0.3', 'no float drift below the step')
  assert.equal(roundTick(84012.37, 0.1, 1), '84012.4')
})

const btc = { tickSize: 0.1, stepSize: 0.001, minQty: 0.001, minNotional: 100, pricePrecision: 1, quantityPrecision: 3 }

test('size risks the configured fraction, capped by notional', () => {
  const s = size(10_000, 80_000, 1_200, btc, DEFAULT_RISK)
  // $50 risk / $1200 stop = 0.0416 → 0.041
  assert.equal(s.qty, '0.041')
  assert.ok(s.riskUsd <= 50)
  const capped = size(10_000, 80_000, 10, btc, DEFAULT_RISK) // tiny stop → huge size
  assert.ok(Number(capped.qty) * 80_000 <= 20_000 + 1e-6, 'notional cap holds')
  const tooSmall = size(100, 80_000, 1_200, btc, DEFAULT_RISK)
  assert.equal(tooSmall.qty, '0')
  assert.match(tooSmall.reason!, /minimum/)
})

test('daily loss halts until the next UTC day; drawdown halts for good', () => {
  const day1 = Date.UTC(2026, 0, 1, 12)
  let { state, canEnter } = checkLimits({ day: '', dayStartEquity: 0, peakEquity: 0, halted: false, haltReason: '' }, 10_000, day1, DEFAULT_RISK)
  assert.ok(canEnter)
  ;({ state, canEnter } = checkLimits(state, 9_650, day1 + 3600_000, DEFAULT_RISK))
  assert.equal(canEnter, false)
  assert.match(state.haltReason, /daily/)
  ;({ state, canEnter } = checkLimits(state, 9_650, day1 + 86_400_000, DEFAULT_RISK))
  assert.ok(canEnter, 'lifted the next day')
  ;({ state, canEnter } = checkLimits(state, 8_400, day1 + 2 * 86_400_000, DEFAULT_RISK))
  assert.equal(canEnter, false)
  assert.match(state.haltReason, /drawdown/)
  ;({ state, canEnter } = checkLimits(state, 8_400, day1 + 3 * 86_400_000, DEFAULT_RISK))
  assert.equal(canEnter, false, 'drawdown halt does not lift by itself')
})
