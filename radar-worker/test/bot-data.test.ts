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

test('refreshDue: every due market at once, at most `limit` in flight, the same bars as one by one', async () => {
  const t0 = Date.UTC(2026, 10, 1, 4, 0, 30)
  const SYMS = Array.from({ length: 24 }, (_, k) => 'S' + k + 'USDT')
  const make = (delay: number) => {
    const h = host(t0)
    let inFlight = 0
    const stats = { peak: 0 }
    const c = new BarCache(
      async (s, i, n) => {
        inFlight++
        stats.peak = Math.max(stats.peak, inFlight)
        await new Promise((r) => setTimeout(r, delay))
        inFlight--
        return h.fetch(s, i, n)
      },
      { now: () => h.now },
    )
    return { h, c, stats }
  }
  const one = make(0)
  const many = make(5)
  for (const s of SYMS) {
    await one.c.get(s, '4h', 300)
    await many.c.get(s, '4h', 300)
  }
  // Nothing due inside the bar.
  assert.equal(await many.c.refreshDue(6), 0)
  one.h.now = many.h.now = t0 + STEP
  many.stats.peak = 0
  assert.equal(await many.c.refreshDue(6), SYMS.length)
  assert.ok(many.stats.peak > 1 && many.stats.peak <= 6, 'concurrent, within the limit: ' + many.stats.peak)
  assert.equal(many.c.requests, SYMS.length * 2, 'one request per due market')
  for (const s of SYMS) {
    const a = await one.c.get(s, '4h', 300)
    const b = await many.c.get(s, '4h', 300)
    assert.deepEqual(b, a, s + ': the same bars')
    assert.equal(b[299].t, Date.UTC(2026, 10, 1, 4))
  }
  assert.equal(many.c.requests, SYMS.length * 2, 'the traders then read the cache: no request')
  assert.deepEqual(many.h.calls.slice(SYMS.length).map((x) => x[1]), SYMS.map(() => 2), 'only the missing bars')
  // A failure is served the held bars by get(), and retried after retryMs as before.
  many.h.now += STEP
  many.h.fail = true
  assert.equal(await many.c.refreshDue(6), SYMS.length)
  assert.equal((await many.c.get('S0USDT', '4h', 300))[299].t, Date.UTC(2026, 10, 1, 4))
  assert.equal(await many.c.refreshDue(6), 0, 'within the retry wait')
})
