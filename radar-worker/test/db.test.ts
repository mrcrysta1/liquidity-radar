// The real schema and the real SQL, on an in-process Postgres (PGlite).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { groupAggTrades } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'
import { DbSink, loadCoverage, loadSettings, saveSettings } from '../src/db.ts'
import type { Db } from '../src/db.ts'
import { backfillChain, splitTail } from '../src/tape.ts'
import type { Agg } from '../src/tape.ts'

async function freshDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite()
  // Supabase has these roles already; plain Postgres does not.
  await pg.exec('create role anon; create role authenticated;')
  await pg.exec(readFileSync(new URL('../sql/001_whales.sql', import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  const db = { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} }
  return { db: db as unknown as Db, pg }
}

function tape(n: number): Agg[] {
  const out: Agg[] = []
  let T = 1_790_000_000_000
  for (let i = 0; out.length < n; i++) {
    T += 7
    const fills = 1 + (i % 5)
    for (let k = 0; k < fills && out.length < n; k++)
      out.push({ a: 10_000 + out.length, p: String(80_000 + k), q: String(0.2 + (i % 7) * 0.4), T, m: i % 3 === 0 })
  }
  return out
}

test('schema applies, settings round-trip', async () => {
  const { db } = await freshDb()
  assert.equal(await loadSettings(db, 'BTCUSDT'), null)
  await saveSettings(db, 'BTCUSDT', 50_000, 100_000)
  assert.deepEqual(await loadSettings(db, 'BTCUSDT'), { floor: 50_000, auto: 100_000 })
})

test('orders and coverage land exactly, and coverage survives a restart', async () => {
  const { db, pg } = await freshDb()
  const t = tape(4000)
  const floor = 150_000
  const sink = new DbSink(db, 'BTCUSDT', floor, [])
  const [, head] = splitTail(t)
  await backfillChain(
    sink,
    { fetchPage: async (f, l) => t.filter((x) => x.a >= f && x.a < f + l), pageSize: 333, paceMs: 0, stopT: 0 },
    head[0].a - 1,
    head,
  )
  await sink.persist()

  // The tape starts at id 10000, not 0, so the first order's lower edge can
  // never be proven: it is correctly left out, and coverage starts after it.
  const groups = groupAggTrades(t)
  const first = groups[1]
  const want = groups.slice(1).filter((o) => o.usd >= floor)
  const rows = (await pg.query<{ a0: number; a1: number; usd: number; side: number; fills: number; t: Date }>(
    'select a0, a1, usd, side, fills, t from whale_orders order by a0',
  )).rows
  assert.equal(rows.length, want.length)
  rows.forEach((r, i) => {
    assert.equal(Number(r.a0), want[i].a0)
    assert.equal(Number(r.a1), want[i].a1)
    assert.ok(Math.abs(r.usd - want[i].usd) < 1e-6)
    assert.equal(r.side, want[i].side === 'buy' ? 1 : -1)
    assert.equal(r.fills, want[i].n)
    assert.equal(new Date(r.t).getTime(), want[i].t)
  })

  const cov = await loadCoverage(db, 'BTCUSDT')
  assert.deepEqual(cov, [{ a0: first.a0, a1: t[t.length - 1].a, t0: first.t, t1: t[t.length - 1].T }])

  // Inserting the same orders again (a restart re-reading a stretch) is a no-op.
  const again = new DbSink(db, 'BTCUSDT', floor, [])
  await again.save(want.slice(0, 5), cov[0])
  assert.equal(Number((await pg.query<{ n: number }>('select count(*)::int as n from whale_orders')).rows[0].n), want.length)
})

test('the anon role can read but not write', async () => {
  const { pg } = await freshDb()
  await pg.exec("insert into whale_symbols (symbol, floor, auto) values ('BTCUSDT', 1, 2)")
  // RLS does not apply to the table owner, so test as anon.
  await pg.exec('grant select, insert on whale_symbols to anon; set role anon;')
  const r = await pg.query('select symbol from whale_symbols')
  assert.equal(r.rows.length, 1)
  await assert.rejects(pg.exec("insert into whale_symbols (symbol, floor, auto) values ('X', 1, 2)"))
})
