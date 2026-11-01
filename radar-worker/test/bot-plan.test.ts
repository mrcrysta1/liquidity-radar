// Sizing previews on each plan: the real sizing code, on the live account and a small one.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sizePreview } from '../src/bot/plan.ts'
import { DEFAULT_RISK } from '../src/bot/risk.ts'
import type { SymbolRules } from '../src/bot/futures.ts'

const costs = { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true }
// BTCUSDT perpetual on mainnet: 0.001 BTC steps, $100 minimum order.
const btc: SymbolRules = { tickSize: 0.1, stepSize: 0.001, minQty: 0.001, minNotional: 100, pricePrecision: 1, quantityPrecision: 3 }
const gold: SymbolRules = { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, pricePrecision: 2, quantityPrecision: 3 }

test('preview: a $5,000 account risks about 0.5% and pays taker fees both ways', () => {
  const p = sizePreview(5000, 77_000, 1500, btc, DEFAULT_RISK, costs)
  assert.ok(p.qty > 0)
  assert.ok(p.riskPct > 0.004 && p.riskPct <= 0.01 + 1e-9, 'risk ' + p.riskPct)
  assert.ok(Math.abs(p.feesUsd - p.notional * 0.001) < 1e-9)
  assert.ok(Math.abs(p.margin - p.notional / DEFAULT_RISK.leverage) < 1e-9)
  assert.equal(p.reason, undefined)
})

test('preview: $100 on BTC — 1% risk buys 0.00067 BTC, under the 0.001 BTC minimum order', () => {
  const p = sizePreview(100, 77_000, 1500, btc, DEFAULT_RISK, costs)
  assert.equal(p.qty, 0)
  assert.match(p.reason!, /under the minimum quantity 0.001/)
})

test('preview: $100 on gold fits, and the risk never exceeds double the 0.5% target', () => {
  const p = sizePreview(100, 2650, 40, gold, DEFAULT_RISK, costs)
  assert.ok(p.qty > 0, p.reason)
  assert.ok(p.riskPct <= 0.01 + 1e-9, 'risk ' + p.riskPct)
  assert.ok(p.notional <= 100 * Math.min(DEFAULT_RISK.maxNotionalX, DEFAULT_RISK.leverage) + 1e-9)
})
