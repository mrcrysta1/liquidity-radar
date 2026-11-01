// The shared closed-bar cache (src/bot/data.ts BarCache): one request per
// market when a bar is due, none on the ticks in between.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BarCache } from '../src/bot/data.ts'
import type { Bar } from '../src/bot/features.ts'

const STEP = 14_400_000

/** A data host with bars on the 4h grid up to the clock; counts what it is asked. */
function host(t0: number) {
  const h = {
    now: t0,
    /** Bars this far behind are not published yet. */
    lag: 0,
    fail: false,
    calls: [] as Array<[string, number]>,
    async fetch(symbol: string, _i: string, count: number): Promise<Bar[]> {
      h.calls.push([symbol, count])
      if (h.fail) throw new Error('network down')
      const last = Math.floor((h.now - h.lag) / STEP) * STEP - STEP
      const out: Bar[] = []
      for (let k = count - 1; k >= 0; k--) {
        const t = last - k * STEP
        out.push({ t, o: t / 1e9, h: t / 1e9 + 1, l: t / 1e9 - 1, c: t / 1e9, v: 1, tb: 0 })
      }
      return out
    },
  }
  return h
}

test('bars are fetched once, then served until a new bar is due; then only the missing bars', async () => {
  const t0 = Date.UTC(2026, 10, 1, 4, 0, 30)
  const h = host(t0)
  const c = new BarCache((s, i, n) => h.fetch(s, i, n), { now: () => h.now })
  const a = await c.get('BTCUSDT', '4h', 2000)
  assert.equal(a.length, 2000)
  assert.equal(a[1999].t, Date.UTC(2026, 10, 1, 0))
  // Ticks inside the bar: no request, the very same array.
  for (let k = 1; k <= 20; k++) {
    h.now = t0 + k * 15_000
    assert.equal(await c.get('BTCUSDT', '4h', 2000), a)
  }
  assert.equal(c.requests, 1)
  // Fewer bars from the same cache: a slice, no request.
  assert.equal((await c.get('BTCUSDT', '4h', 80)).length, 80)
  assert.equal(c.requests, 1)
  // The next bar closes: a small request, merged.
  h.now = t0 + STEP
  const b = await c.get('BTCUSDT', '4h', 2000)
  assert.deepEqual(h.calls[1], ['BTCUSDT', 2])
  assert.equal(b.length, 2000)
  assert.equal(b[1999].t, Date.UTC(2026, 10, 1, 4))
  assert.equal(b[0].t, a[1].t)
  assert.ok(b.every((x, k) => k === 0 || x.t - b[k - 1].t === STEP), 'no gap, no duplicate')
  // A bigger request than held: fetched in full.
  await c.get('BTCUSDT', '4h', 4000)
  assert.deepEqual(h.calls[2], ['BTCUSDT', 4000])
  // Markets are held apart.
  await c.get('ETHUSDT', '4h', 2000)
  assert.equal(c.requests, 4)
})

test('a bar that is late (or a failed request) is retried after retryMs, the held bars served meanwhile', async () => {
  const t0 = Date.UTC(2026, 10, 1, 4, 0, 30)
  const h = host(t0)
  const c = new BarCache((s, i, n) => h.fetch(s, i, n), { now: () => h.now, retryMs: 20_000 })
  const a = await c.get('SOLUSDT', '4h', 100)
  h.now = t0 + STEP
  h.lag = 60_000
  const late = await c.get('SOLUSDT', '4h', 100)
  assert.equal(late[99].t, a[99].t, 'not published yet: the held bars')
  assert.equal(c.requests, 2)
  h.now += 15_000
  await c.get('SOLUSDT', '4h', 100)
  assert.equal(c.requests, 2, 'no retry within 20 s')
  h.now += 10_000
  h.fail = true
  assert.equal((await c.get('SOLUSDT', '4h', 100))[99].t, a[99].t, 'a failure serves the held bars')
  assert.equal(c.requests, 3)
  h.fail = false
  h.lag = 0
  h.now += 20_000
  assert.equal((await c.get('SOLUSDT', '4h', 100))[99].t, a[99].t + STEP, 'the new bar once published')
  assert.equal(c.requests, 4)
  // Nothing held and the host is down: the error goes to the caller.
  h.fail = true
  await assert.rejects(c.get('XRPUSDT', '4h', 100), /network down/)
})
