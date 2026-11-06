// sql/009_bot_private.sql on the real schema (PGlite): what the public anon
// key can and cannot read once it is applied.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = (f: string) => readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8')
const ALL = ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql']

async function freshDb(): Promise<PGlite> {
  const pg = new PGlite()
  await pg.exec('create role anon; create role authenticated;')
  for (const f of ALL) await pg.exec(sql(f))
  // Supabase's default privileges give anon and authenticated every table.
  await pg.exec('grant usage on schema public to anon, authenticated; grant select on all tables in schema public to anon, authenticated;')
  const keys = ['control', 'heartbeat', 'metrics', 'strategy:f1', 'plan:BTCUSDT', 'wf:BTCUSDT:4h', 'account', 'c6:model', 'risk', 'lastHalt', 'learn:BTCUSDT', 'lastBar:BTCUSDT', 'closing:1', 'selftest:BTCUSDT', 'alerts:summaryDay']
  for (const k of keys) await pg.query('insert into bot_state (key, value) values ($1, $2) on conflict (key) do update set value = $2', [k, JSON.stringify({ k })])
  await pg.query(
    `insert into bot_models (symbol, interval, trained_from, trained_to, cfg, metrics, gate_pass, model, version, role)
     values ('BTCUSDT', '4h', now(), now(), '{"secret":1}', '{}', true, '{"weights":[1,2]}', 1, 'champion')`,
  )
  await pg.query(`insert into bot_calibration (symbol, side, regime) values ('BTCUSDT', 1, 'up-hi')`)
  return pg
}

async function asAnon<T>(pg: PGlite, text: string): Promise<T[]> {
  await pg.exec('set role anon')
  try {
    return (await pg.query<T>(text)).rows
  } finally {
    await pg.exec('reset role')
  }
}

const PUBLIC_KEYS = ['control', 'heartbeat', 'metrics', 'plan:BTCUSDT', 'strategy:f1', 'wf:BTCUSDT:4h']

test('009: anon sees only the public bot_state keys; account and c6:model are hidden', async () => {
  const pg = await freshDb()
  const before = await asAnon<{ key: string }>(pg, 'select key from bot_state')
  assert.ok(before.some((r) => r.key === 'account'), 'precondition: 002 exposes the account snapshot')
  await pg.exec(sql('009_bot_private.sql'))
  const keys = (await asAnon<{ key: string }>(pg, 'select key from bot_state order by key')).map((r) => r.key)
  assert.deepEqual(keys, PUBLIC_KEYS)
  // The owner (the bot) still reads and writes everything.
  assert.equal((await pg.query('select key from bot_state')).rows.length, 15)
  await pg.query(`update bot_state set value = '{"x":1}' where key = 'account'`)
})

test('009: anon reads bot_models metadata but not model or cfg; bot_calibration is closed', async () => {
  const pg = await freshDb()
  await pg.exec(sql('009_bot_private.sql'))
  const rows = await asAnon<Record<string, unknown>>(pg, 'select id, symbol, interval, version, role, created_at, promoted_at, gate_pass, holdout from bot_models')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].symbol, 'BTCUSDT')
  for (const q of ['select model from bot_models', 'select cfg from bot_models', 'select * from bot_models', 'select * from bot_calibration'])
    await assert.rejects(asAnon(pg, q), /permission denied/, q)
  // The dashboards' public tables are unchanged.
  for (const t of ['bot_trades', 'bot_shadow_trades', 'bot_equity', 'bot_events', 'bot_metrics']) await asAnon(pg, `select * from ${t}`)
  assert.equal((await pg.query<{ model: unknown }>('select model from bot_models')).rows.length, 1, 'the owner still reads the weights')
})

test('009 is idempotent and survives the workflow re-applying 005-008 before it', async () => {
  const pg = await freshDb()
  await pg.exec(sql('009_bot_private.sql'))
  for (const f of ALL.slice(2)) await pg.exec(sql(f))
  await pg.exec(sql('009_bot_private.sql'))
  assert.deepEqual((await asAnon<{ key: string }>(pg, 'select key from bot_state order by key')).map((r) => r.key), PUBLIC_KEYS)
  await assert.rejects(asAnon(pg, 'select model from bot_models'), /permission denied/)
})

test('009 rollback in the header restores the old access', async () => {
  const pg = await freshDb()
  await pg.exec(sql('009_bot_private.sql'))
  const head = sql('009_bot_private.sql').split(/\r?\n/)
  const at = head.findIndex((l) => l.startsWith('-- ROLLBACK'))
  const rollback = head.slice(at + 1).filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')
  assert.match(rollback, /grant select on bot_models/)
  await pg.exec(rollback)
  assert.equal((await asAnon(pg, 'select key from bot_state')).length, 15)
  assert.equal((await asAnon(pg, 'select model from bot_models')).length, 1)
})
