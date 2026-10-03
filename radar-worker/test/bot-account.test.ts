import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountFromBinance, ordersFromBinance } from '../src/bot/account.ts'

// Shapes as Binance /fapi/v2/account, /fapi/v1/openOrders and openAlgoOrders return them.
const RAW = {
  totalWalletBalance: '5000.00000000',
  assets: [
    { asset: 'USDT', walletBalance: '4987.12', unrealizedProfit: '12.34', marginBalance: '4999.46', availableBalance: '4800.10' },
    { asset: 'BTC', walletBalance: '0', unrealizedProfit: '0', marginBalance: '0', availableBalance: '0' },
  ],
  positions: [
    { symbol: 'PAXGUSDT', positionAmt: '-0.250', entryPrice: '4150.5', markPrice: '4140.0', unrealizedProfit: '2.625', leverage: '3', liquidationPrice: '5400.1', isolatedWallet: '345.8', notional: '-1035.0' },
    { symbol: 'BTCUSDT', positionAmt: '0.000', entryPrice: '0', markPrice: '84000', unrealizedProfit: '0', leverage: '3' },
  ],
}

test('account mirror uses the USDT figures Binance shows', () => {
  const a = accountFromBinance(RAW, 1, 'https://demo-fapi.binance.com')
  assert.equal(a.walletBalance, 4987.12)
  assert.equal(a.unrealizedPnl, 12.34)
  assert.equal(a.marginBalance, 4999.46)
  assert.equal(a.availableBalance, 4800.1)
})

test('account mirror lists only open positions, with side and size', () => {
  const a = accountFromBinance(RAW, 1, 'x')
  assert.equal(a.positions.length, 1)
  const p = a.positions[0]
  assert.deepEqual([p.symbol, p.side, p.size, p.entry, p.mark, p.unrealized, p.leverage, p.margin, p.notional], ['PAXGUSDT', 'SHORT', 0.25, 4150.5, 4140, 2.625, 3, 345.8, 1035])
})

test('orders: regular and algo (stop) orders, with prices', () => {
  const o = ordersFromBinance(
    [{ symbol: 'PAXGUSDT', side: 'BUY', type: 'LIMIT', price: '4100', origQty: '0.25', reduceOnly: true }],
    { orders: [{ symbol: 'PAXGUSDT', side: 'BUY', orderType: 'STOP_MARKET', triggerPrice: '4190', quantity: '0.25' }] },
  )
  assert.equal(o.length, 2)
  assert.deepEqual([o[0].type, o[0].price, o[1].type, o[1].price, o[1].reduceOnly], ['LIMIT', 4100, 'STOP_MARKET', 4190, true])
})

test('empty or odd responses never throw', () => {
  assert.equal(accountFromBinance(null, 1, 'x').positions.length, 0)
  assert.equal(ordersFromBinance(undefined, null).length, 0)
})
