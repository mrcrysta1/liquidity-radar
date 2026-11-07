// Daily and weekly intelligence reports (src/research/report.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { buildDaily, buildWeekly, formatDaily, loadDay, reportTick } from '../src/research/report.ts'
import type { DayInput } from '../src/research/report.ts'

const H = 3_600_000
const D0 = Date.UTC(2026, 10, 6)

const input = (o: Partial<DayInput> = {}): DayInput => ({
  day: '2026-11-06',
  events: [{ time: D0 + 13.5 * H, category: 'nfp', title: 'Non-Farm Employment Change', surprise: 100, btc1h: { ret: -1.2, z: -3.4 }, gold1h: { ret: 0.4, z: 1.1 } }],
  context: [0, 4, 8, 12, 16, 20].map((h, k) => ({ time: D0 + h * H, regime: k < 3 ? 'weak-bull' : 'weak-bear', btcDir: 'down', goldDir: 'up' })),
  corrChanges: [],
  trades: [
    { strategy: 'ml', kind: 'shadow', symbol: 'ETHUSDT', side: -1, entryTime: D0 + 14 * H, r: 1.4, exit: 'tp', p: 0.55 },
    ...Array.from({ length: 5 }, (_, k) => ({ strategy: 'c2', kind: 'shadow' as const, symbol: 'S' + k, side: -1 as const, entryTime: D0, r: -1.5, exit: 'sl', p: null })),
  ],
  transitions: [],
  errors: [{ symbol: 'BTCUSDT', msg: 'tick failed: timeout 123' }, { symbol: 'ETHUSDT', msg: 'tick failed: timeout 456' }],
  ...o,
})

test('daily: strategies, model, news trades, anomalies and what to look at', () => {
  const r = buildDaily(input())
  assert.deepEqual(r.strategies.map((s) => [s.strategy, s.n, s.wins, s.sumR]), [['c2', 5, 0, -7.5], ['ml', 1, 1, 1.4]])
  assert.deepEqual([r.regime.start, r.regime.end, r.regime.changes, r.regime.snapshots], ['weak-bull', 'weak-bear', 1, 6])
  assert.deepEqual([r.news.trades, r.news.wins], [1, 1], 'entered 30 min after the release')
  assert.deepEqual(r.errors.top, [{ msg: 'tick failed: timeout #', n: 2 }], 'same error, different numbers, counted together')
  assert.ok(r.anomalies.some((a) => /5 stop-outs cost more than 1.3R/.test(a)))
  assert.ok(r.anomalies.some((a) => /C2 lost all 5/.test(a)))
  assert.ok(r.investigate.some((a) => /Non-Farm.*-1.20%.*-3.4σ/.test(a)))
  assert.match(formatDaily(r), /weak-bull → weak-bear[\s\S]*C2 5 trades -7.50R/)
  assert.ok(buildDaily(input({ context: [] })).anomalies.some((a) => /0 of 6 market-context snapshots/.test(a)))
})

test('weekly: last 7 days against the 7 before', () => {
  const days = Array.from({ length: 10 }, (_, k) => buildDaily(input({ day: `2026-11-${String(k + 1).padStart(2, '0')}` })))
  const w = buildWeekly(days)!
  assert.deepEqual([w.week.from, w.week.to, w.week.days, w.previous?.days], ['2026-11-04', '2026-11-10', 7, 3])
  const c2 = w.strategies.find((s) => s.strategy === 'c2')!
  assert.deepEqual([c2.n, c2.prevN, c2.sumR], [35, 15, -52.5])
  assert.equal(w.regimes['weak-bear'], 7)
  assert.equal(buildWeekly([]), null)
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql', '009_market_context.sql', '010_econ_events.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('loadDay + reportTick on the real schema: once per day, kept with history, sent when a webhook is set', async () => {
  const { db, pg } = await freshDb()
  await pg.query(`insert into econ_events (key, source, category, title, country, event_time, surprise) values ('k', 'ff', 'nfp', 'NFP', 'USD', $1, 100)`, [new Date(D0 + 13.5 * H).toISOString()])
  await pg.query(`insert into econ_reactions (event_time, asset, horizon_min, ret_pct, z, base_price) values ($1, 'BTCUSDT', 60, -1.2, -3.4, 100)`, [new Date(D0 + 13.5 * H).toISOString()])
  await pg.query(`insert into market_context (bar_time, regime, btc_dir_4h, snapshot) values ($1, 'weak-bear', 'down', '{}')`, [new Date(D0 + 4 * H).toISOString()])
  await pg.query(
    `insert into bot_shadow_trades (symbol, side, status, bar_time, closed_at, entry, sl, atr, r_gross, r_net, features, strategy, exit_reason)
     values ('ETHUSDT', -1, 'closed', $1, $2, 100, 102, 1, 1.5, 1.4, '{}', 'f1', 'signal')`,
    [new Date(D0 + 8 * H).toISOString(), new Date(D0 + 20 * H).toISOString()],
  )
  await pg.query(`insert into bot_events (t, level, symbol, msg) values ($1, 'error', 'BTCUSDT', 'tick failed: x')`, [new Date(D0 + H).toISOString()])
  const d = await loadDay(db, '2026-11-06')
  assert.deepEqual([d.events.length, d.events[0].btc1h?.z, d.context.length, d.trades.length, d.trades[0].strategy, d.errors.length], [1, -3.4, 1, 1, 'f1', 1])
  const store = new BotStore(db)
  const sent: string[] = []
  const alerts = { send: async (t: string) => (sent.push(t), true) } as never
  const now = Date.UTC(2026, 10, 7, 0, 30)
  reportTick(store, db, alerts, now)
  for (let k = 0; k < 50 && !sent.length; k++) await new Promise((r) => setTimeout(r, 50))
  const st = await store.getState<{ latest: { day: string }; history: unknown[] } | null>('report:daily', null)
  assert.deepEqual([st?.latest.day, st?.history.length, sent.length], ['2026-11-06', 1, 1])
  assert.ok(await store.getState('report:weekly', null))
  // Same day again: nothing new.
  reportTick(store, db, alerts, now + 60_000)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(sent.length, 1)
  // Before 00:10 UTC: waits.
  reportTick(store, db, alerts, Date.UTC(2026, 10, 8, 0, 5))
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(sent.length, 1)
})
