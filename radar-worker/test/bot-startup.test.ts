import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InitQueue, initBackoffMs } from '../src/bot/startup.ts'

const fake = (symbol: string, failures: number, err = 'Binance 400 -4067: Position side cannot be changed if there exists open orders.') => {
  const t = {
    symbol,
    calls: 0,
    async init() {
      t.calls++
      if (t.calls <= failures) throw new Error(err)
    },
  }
  return t
}

test('initBackoffMs doubles from the base and is capped', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 50].map((a) => initBackoffMs(a)),
    [10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000],
  )
})

test('a symbol whose setup keeps failing (-4067) does not block the others', async () => {
  const btc = fake('BTCUSDT', Infinity)
  const eth = fake('ETHUSDT', 0)
  const sol = fake('SOLUSDT', 0)
  const fails: Array<[string, number, number]> = []
  const q = new InitQueue([btc, eth, sol], { onFail: (s, a, _e, w) => void fails.push([s, a, w]) })
  await q.run(0)
  assert.deepEqual(q.ready.map((t) => t.symbol), ['ETHUSDT', 'SOLUSDT'], 'the others start right away')
  assert.deepEqual(q.pending, ['BTCUSDT'])
  assert.deepEqual(fails, [['BTCUSDT', 1, 10_000]])
})

test('a failed symbol is retried only when its backoff is due, then joins in order', async () => {
  const btc = fake('BTCUSDT', 2)
  const eth = fake('ETHUSDT', 0)
  const ready: Array<[string, number]> = []
  const q = new InitQueue([btc, eth], { onReady: (s, n) => void ready.push([s, n]) })
  await q.run(0)
  assert.equal(btc.calls, 1)
  await q.run(5_000) // not due yet (10 s)
  assert.equal(btc.calls, 1, 'no retry before the backoff')
  await q.run(10_000) // second failure, next in 20 s
  assert.equal(btc.calls, 2)
  await q.run(29_999)
  assert.equal(btc.calls, 2)
  await q.run(30_000)
  assert.equal(btc.calls, 3)
  assert.deepEqual(q.ready.map((t) => t.symbol), ['BTCUSDT', 'ETHUSDT'], 'original order kept')
  assert.deepEqual(q.pending, [])
  assert.deepEqual(ready, [
    ['ETHUSDT', 1],
    ['BTCUSDT', 3],
  ])
  await q.run(1e9)
  assert.equal(btc.calls, 3, 'a ready symbol is never set up again')
})

test('a throwing hook (e.g. the database is down) does not break startup', async () => {
  const q = new InitQueue([fake('BTCUSDT', 1), fake('ETHUSDT', 0)], {
    onFail: () => Promise.reject(new Error('db down')),
    onReady: () => {
      throw new Error('db down')
    },
  })
  await q.run(0)
  assert.deepEqual(q.ready.map((t) => t.symbol), ['ETHUSDT'])
  assert.deepEqual(q.pending, ['BTCUSDT'])
})
