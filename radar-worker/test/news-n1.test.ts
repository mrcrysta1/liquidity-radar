// Experimental news strategy N1 (src/news/n1.ts) and its paper record (recordN1, sql/011).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import { N1, evaluateN1 } from '../src/news/n1.ts'
import { N1_LIVE_FROM, recordN1 } from '../src/news/collect.ts'

const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const input = (o: Partial<Parameters<typeof evaluateN1>[0]> = {}) => ({ eventTime: 0, category: 'cpi', asset: 'BTCUSDT', ret60: 1.2, z60: 2.5, ret1440: 2.0, ...o })

test('N1: a scheduled release alone is never a signal; only a large measured reaction is', () => {
  assert.equal(evaluateN1(input({ z60: 1.4, ret60: 0.3 })).side, 0, 'ordinary move')
  assert.match(evaluateN1(input({ z60: 1.4, ret60: 0.3 })).reason, /under 2/)
  assert.equal(evaluateN1(input({ ret60: null, z60: null })).side, 0, 'no reaction measured')
  assert.equal(evaluateN1(input({ category: 'claims' })).side, 0, 'weekly claims are not tracked')
  assert.equal(evaluateN1(input({ category: 'political' })).side, 0)
  assert.equal(evaluateN1(input({ asset: 'SOLUSDT' })).side, 0)
})

test('N1: continue trades with the reaction, fade against it; result from decision to exit, net of both legs', () => {
  const c = evaluateN1(input(), 'continue')
  assert.equal(c.side, 1)
  near(c.grossPct, 0.8)
  near(c.netPct, 0.8 - 2 * N1.legPct)
  const f = evaluateN1(input(), 'fade')
  assert.equal(f.side, -1)
  near(f.grossPct, -0.8)
  const down = evaluateN1(input({ ret60: -1.5, z60: -3, ret1440: -0.5 }), 'continue')
  assert.equal(down.side, -1)
  near(down.grossPct, -1)
  // Before the exit: decided, no result yet.
  const open = evaluateN1(input({ ret1440: null }), 'continue')
  assert.deepEqual([open.side, open.grossPct, open.netPct], [1, null, null])
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '010_econ_events.sql', '011_news_signals.sql', '011_news_signals.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('recordN1: every tracked asset gets a row, traded or not; only from go-live; re-running updates', async () => {
  const { db, pg } = await freshDb()
  const t = N1_LIVE_FROM + 2 * 86_400_000 + 13.5 * 3_600_000
  const iso = new Date(t).toISOString()
  await pg.query(`insert into econ_events (key, source, category, title, country, event_time) values ('k', 'fred', 'cpi', 'CPI', 'USD', $1)`, [iso])
  const rx = (asset: string, h: number, ret: number, z: number | null) =>
    pg.query(`insert into econ_reactions (event_time, asset, horizon_min, ret_pct, z, base_price) values ($1, $2, $3, $4, $5, 1)`, [iso, asset, h, ret, z])
  await rx('BTCUSDT', 60, 1.5, 3.1)
  await rx('BTCUSDT', 1440, 2.5, 1)
  await rx('ETHUSDT', 60, 0.2, 0.4)
  await rx('ETHUSDT', 1440, -1, null)
  assert.equal(await recordN1(db, t), 3)
  const rows = (await pg.query<Record<string, unknown>>('select asset, side, mode, reason, net_pct, decided_at from news_signals order by asset')).rows
  assert.deepEqual(rows.map((r) => [r.asset, r.side]), [['BTCUSDT', 1], ['ETHUSDT', 0], ['XAUUSDT', 0]])
  near(Number(rows[0].net_pct), 1 - 2 * N1.legPct)
  assert.equal(new Date(rows[0].decided_at as string).getTime(), t + 60 * 60_000, 'decided an hour after the release')
  assert.match(String(rows[2].reason), /no 60-minute reaction/)
  assert.equal(await recordN1(db, t), 3, 're-run: same rows, updated')
  assert.equal((await pg.query('select * from news_signals')).rows.length, 3)
  // A release before go-live is history, not a paper trade; a non-tracked one is skipped.
  assert.equal(await recordN1(db, N1_LIVE_FROM - 86_400_000), 0)
  assert.equal(await recordN1(db, t + 3_600_000), 0)
})
