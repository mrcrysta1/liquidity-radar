// The tape reader must produce exactly the orders that grouping the whole
// tape at once would, however it is cut into pages, connections and restarts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupAggTrades } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'
import { LiveTape, backfillChain, mergeCoverage, splitLead, splitTail } from '../src/tape.ts'
import type { Agg, Cov, TapeSink, WhaleOrder } from '../src/tape.ts'

/** Deterministic tape: runs of 1..9 fills per order, random sides and sizes. */
function makeTape(n: number, seed = 7): Agg[] {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const out: Agg[] = []
  let T = 1_000_000
  while (out.length < n) {
    T += 1 + Math.floor(rnd() * 3)
    const m = rnd() < 0.5
    const fills = 1 + Math.floor(rnd() * 9)
    for (let i = 0; i < fills && out.length < n; i++) {
      out.push({ a: out.length, p: String(100 + i * 0.5), q: String((rnd() * 900).toFixed(3)), T, m })
    }
  }
  return out
}

function memSink(floor: number) {
  const orders = new Map<number, WhaleOrder>()
  let cov: Cov[] = []
  const sink: TapeSink = {
    floor,
    covered: () => cov,
    async save(list, c) {
      for (const o of list) {
        assert.ok(!orders.has(o.a0), 'order ' + o.a0 + ' saved twice')
        orders.set(o.a0, o)
      }
      // Ranges saved must never overlap what is already covered.
      for (const x of cov) assert.ok(c.a1 < x.a0 || c.a0 > x.a1, 'overlapping coverage')
      cov = mergeCoverage(cov, c)
    },
  }
  return { sink, orders, cov: () => cov }
}

function pager(tape: Agg[]) {
  return async (from: number, limit: number) => tape.slice(from, from + limit)
}

const expected = (tape: Agg[], floor: number, lo = 0, hi = Infinity) =>
  groupAggTrades(tape)
    .filter((o) => o.usd >= floor && o.a0 >= lo && o.a1 <= hi)
    .map((o) => [o.a0, o.a1, Math.round(o.usd)])

const got = (m: Map<number, WhaleOrder>) =>
  [...m.values()].sort((x, y) => x.a0 - y.a0).map((o) => [o.a0, o.a1, Math.round(o.usd)])

test('splitLead / splitTail cut on group edges', () => {
  const t = makeTape(40)
  const [lead, rest] = splitLead(t)
  assert.equal(groupAggTrades(lead).length, 1)
  assert.notEqual(rest[0].T + String(rest[0].m), lead[0].T + String(lead[0].m))
  const [body, tail] = splitTail(t)
  assert.equal(groupAggTrades(tail).length, 1)
  assert.equal(body.length + tail.length, t.length)
})

test('backfill alone matches grouping the whole tape, for any page size', async () => {
  const tape = makeTape(3000)
  for (const pageSize of [1, 2, 7, 50, 1000]) {
    const { sink, orders, cov } = memSink(20_000)
    const top = tape.length - 1
    // Start as the live head would: the newest group as carry.
    const [, head] = splitTail(tape)
    await backfillChain(sink, { fetchPage: pager(tape), pageSize, paceMs: 0, stopT: 0 }, head[0].a - 1, head)
    assert.deepEqual(got(orders), expected(tape, 20_000), 'pageSize ' + pageSize)
    assert.deepEqual(cov().map((c) => [c.a0, c.a1]), [[0, top]])
  }
})

test('live + backfill + reconnect + restart still read every order exactly once', async () => {
  const tape = makeTape(5000, 11)
  const floor = 15_000
  const { sink, orders, cov } = memSink(floor)
  const opts = { fetchPage: pager(tape), pageSize: 37, paceMs: 0, stopT: 0 }
  const chains: Promise<unknown>[] = []
  const connect = () =>
    new LiveTape(sink, (head) => chains.push(backfillChain(sink, opts, head[0].a - 1, head)), 0)

  // First run: the socket joins at 2000 (mid-order, possibly), backfill runs
  // from there, the connection drops at 3100 — the tail group is unknown.
  let live = connect()
  for (const t of tape.slice(2000, 3100)) live.push(t)
  live.flush(false)
  live.flush(false)
  live.flush(true)
  await live.idle()
  await Promise.all(chains)

  // Reconnect at 3600: the hole 3100..3599 must be filled by the new head's backfill.
  live = connect()
  for (const t of tape.slice(3600, 4200)) live.push(t)
  // A dropped frame mid-connection.
  for (const t of tape.slice(4300, 5000)) live.push(t)
  live.flush(false)
  live.flush(false)
  await live.idle()
  await Promise.all(chains)
  await new Promise((r) => setTimeout(r, 0))
  await live.idle()
  await Promise.all(chains)

  const top = cov()[cov().length - 1].a1
  assert.deepEqual(cov().map((c) => c.a0), [0], 'one contiguous range from id 0')
  assert.deepEqual(got(orders), expected(tape, floor, 0, top))
})

test('stopT bounds the walk and leaves coverage on an order boundary', async () => {
  const tape = makeTape(2000, 3)
  const { sink, orders, cov } = memSink(0)
  const [, head] = splitTail(tape)
  const stopT = tape[1200].T
  await backfillChain(sink, { fetchPage: pager(tape), pageSize: 100, paceMs: 0, stopT }, head[0].a - 1, head)
  const c = cov()[0]
  assert.ok(tape[c.a0].T <= stopT, 'reached the target time')
  assert.ok(c.a0 === 0 || tape[c.a0 - 1].T !== tape[c.a0].T || tape[c.a0 - 1].m !== tape[c.a0].m, 'starts on an edge')
  assert.deepEqual(got(orders), expected(tape, 0, c.a0))
})
