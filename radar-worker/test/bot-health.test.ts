// Strategy health (src/bot/health.ts), the BOT_STRATEGIES setting and the
// health refresh against the real schema (src/bot/strategies.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { HEALTH, drawdownR, evaluateHealth, riskScale, rollingExp } from '../src/bot/health.ts'
import type { HealthBands, HealthRecord, Outcome } from '../src/bot/health.ts'
import { F1_HEALTH, parseStrategies, refreshHealth, slotRuns } from '../src/bot/strategies.ts'

const BANDS: HealthBands = { expR: 0.18, roll30P5: -0.2, roll30P1: -0.35, ddP95: 15, ddP99: 22 }
const live = { id: 'f1', state: 'live' as const }

/** n outcomes of r each, closing one hour apart from t0. */
const run = (n: number, r: number | ((k: number) => number), t0: number, kind: Outcome['kind'] = 'shadow'): Outcome[] =>
  Array.from({ length: n }, (_, k) => ({ t: t0 + k * 3_600_000, r: typeof r === 'function' ? r(k) : r, kind }))

test('rolling expectancy and drawdown in R', () => {
  assert.equal(rollingExp([1, 2, 3], 30), null, 'fewer than 30: none')
  assert.equal(rollingExp([...Array(40).fill(-1), ...Array(30).fill(0.5)]), 0.5, 'the last 30 only')
  assert.deepEqual(drawdownR([1, 1, -3, 1]), { current: 2, max: 3 })
  assert.deepEqual(drawdownR([]), { current: 0, max: 0 })
})

test('starts as configured; a healthy live strategy stays live', () => {
  const t0 = 1_000_000
  const first = evaluateHealth(null, live, [], BANDS, t0)
  assert.equal(first.record.state, 'live')
  assert.equal(first.transition, null)
  const good = run(40, (k) => (k % 2 ? 1.2 : -0.8), t0 + 1, 'real')
  const next = evaluateHealth(first.record, live, good, BANDS, t0 + 1e9)
  assert.equal(next.record.state, 'live')
  assert.equal(next.record.stats.real, 40)
  assert.ok(Math.abs(next.record.stats.roll30! - 0.2) < 1e-9)
})

test('live → probation at p5, back to live within the bands, → shadow at p1', () => {
  const t0 = 1_000_000
  let rec = evaluateHealth(null, live, [], BANDS, t0).record
  // Rolling 30 at -0.33R: under p5 (-0.2), above p1 (-0.35).
  const weak = run(30, (k) => (k % 4 === 0 ? 1.5 : -1), t0 + 1, 'real')
  let r = evaluateHealth(rec, live, weak, BANDS, t0 + 1e8)
  assert.equal(r.record.state, 'probation')
  assert.match(r.transition!.reason, /p5/)
  rec = r.record
  // Better trades: back to live.
  const better = [...weak, ...run(30, 0.3, t0 + 2e8, 'real')]
  r = evaluateHealth(rec, live, better, BANDS, t0 + 3e8)
  assert.equal(r.record.state, 'live')
  assert.equal(r.transition!.reason, 'back within its bands')
  rec = r.record
  // Rolling 30 at -0.5R: under p1 → demoted, real and shadow trades both count.
  const bad = [...better, ...run(15, -0.5, t0 + 4e8, 'real'), ...run(15, -0.5, t0 + 5e8, 'shadow')]
  r = evaluateHealth(rec, live, bad, BANDS, t0 + 6e8)
  assert.equal(r.record.state, 'shadow')
  assert.equal(r.transition!.from, 'live')
  assert.match(r.transition!.reason, /rolling 30-trade expectancy -0\.50R < p1 -0\.35R/)
  assert.equal(r.record.history.length, 3)
})

test('a drawdown past p99 demotes even with a fine rolling expectancy', () => {
  const t0 = 1_000_000
  const rec = evaluateHealth(null, live, [], BANDS, t0).record
  // +1R, then 23 straight -1R (23R down), then 30 trades averaging ~0: roll30 above p1.
  const o = [...run(1, 1, t0 + 1), ...run(23, -1, t0 + 2e6), ...run(30, (k) => (k % 2 ? 0.1 : -0.1), t0 + 2e8)]
  const r = evaluateHealth(rec, live, o, BANDS, t0 + 3e8)
  assert.equal(r.record.state, 'shadow')
  assert.match(r.transition!.reason, /drawdown 23\.0R > p99 22R/)
})

test('shadow → live only after 30 new shadow trades since the demotion, positive, drawdown within p95', () => {
  const t0 = 1_000_000
  let rec = evaluateHealth(null, live, [], BANDS, t0).record
  const bad = run(30, -0.6, t0 + 1, 'real')
  const demoteAt = t0 + 2e8
  rec = evaluateHealth(rec, live, bad, BANDS, demoteAt).record
  assert.equal(rec.state, 'shadow')
  // 29 good shadow trades: not yet.
  let o = [...bad, ...run(29, 0.6, demoteAt + 1)]
  let r = evaluateHealth(rec, live, o, BANDS, demoteAt + 2e8)
  assert.equal(r.record.state, 'shadow')
  assert.equal(r.record.stats.segN, 29)
  // The 30th: promoted.
  o = [...o, ...run(1, 0.6, demoteAt + 3e8)]
  r = evaluateHealth(r.record, live, o, BANDS, demoteAt + 4e8)
  assert.equal(r.record.state, 'live')
  assert.match(r.transition!.reason, /^30 shadow trades since the demotion: \+0\.60R\/trade/)
  // Trades from before the demotion do not count toward the 30.
  const early = evaluateHealth(rec, live, [...bad, ...run(30, 0.6, t0 + 2)], BANDS, demoteAt + 2e8)
  assert.equal(early.record.state, 'shadow')
})

test('no recovery with a non-positive expectancy or a drawdown past p95', () => {
  const t0 = 1_000_000
  const shadow = { id: 'f1', state: 'shadow' as const }
  const rec = evaluateHealth(null, shadow, [], BANDS, t0).record
  assert.equal(rec.state, 'shadow')
  const flat = evaluateHealth(rec, shadow, run(40, (k) => (k % 2 ? 0.5 : -0.5), t0 + 1), BANDS, t0 + 1e9)
  assert.equal(flat.record.state, 'shadow', 'expectancy 0 is not > 0')
  // Positive on the whole, but a 16R drawdown inside the stretch.
  const deep = evaluateHealth(rec, shadow, [...run(16, -1, t0 + 1), ...run(30, 1.2, t0 + 1e8)], BANDS, t0 + 1e9)
  assert.equal(deep.record.state, 'shadow')
  assert.ok(deep.record.stats.maxDdR >= 16)
})

test('never promoted (nor demoted) without health bands', () => {
  const t0 = 1_000_000
  const ml = { id: 'ml', state: 'shadow' as const }
  const rec = evaluateHealth(null, ml, [], undefined, t0).record
  const r = evaluateHealth(rec, ml, run(200, 1, t0 + 1), undefined, t0 + 1e9)
  assert.equal(r.record.state, 'shadow')
  assert.equal(r.transition, null)
  assert.equal(r.record.hasBands, false)
  const mlLive = evaluateHealth(null, { id: 'ml', state: 'live' }, run(100, -2, t0 + 1), undefined, t0 + 1e9)
  assert.equal(mlLive.record.state, 'live')
})

test('a changed BOT_STRATEGIES state resets the strategy to it, with a transition', () => {
  const t0 = 1_000_000
  const rec = evaluateHealth(null, live, run(30, -0.6, t0 + 1, 'real'), BANDS, t0 + 1e8).record
  assert.equal(rec.state, 'shadow')
  // Unchanged config: stays demoted.
  assert.equal(evaluateHealth(rec, live, [], BANDS, t0 + 2e8).record.state, 'shadow')
  const forced = evaluateHealth(rec, { id: 'f1', state: 'shadow' }, [], BANDS, t0 + 3e8)
  assert.equal(forced.record.state, 'shadow')
  assert.equal(forced.record.configured, 'shadow')
  const back = evaluateHealth(forced.record, live, [], BANDS, t0 + 4e8)
  assert.equal(back.record.state, 'live')
  assert.match(back.transition!.reason, /configured live/)
})

test('BOT_STRATEGIES: parsing, the BOT_STRATEGY=trend alias, and the workflow setting', () => {
  assert.deepEqual(parseStrategies('f1:live, ml:shadow'), [{ id: 'f1', state: 'live' }, { id: 'ml', state: 'shadow' }])
  assert.deepEqual(parseStrategies('ml'), [{ id: 'ml', state: 'live' }])
  assert.deepEqual(parseStrategies(undefined, 'trend'), parseStrategies('f1:live,ml:shadow'))
  assert.deepEqual(parseStrategies('', 'trend'), parseStrategies('f1:live,ml:shadow'))
  assert.equal(parseStrategies(undefined, 'ml'), null, 'the model alone: the single-strategy path')
  assert.equal(parseStrategies(undefined), null)
  assert.throws(() => parseStrategies('f9:live'), /unknown strategy "f9"/)
  assert.throws(() => parseStrategies('f1:paper'), /live or shadow/)
  assert.throws(() => parseStrategies('f1,f1'), /twice/)
  // Per-strategy markets: ';' between strategies, '@*' or '@' + a comma list.
  assert.deepEqual(parseStrategies('f1:live@*;c2:shadow@*;ml:shadow@btcusdt, ETHUSDT'), [
    { id: 'f1', state: 'live' },
    { id: 'c2', state: 'shadow' },
    { id: 'ml', state: 'shadow', symbols: ['BTCUSDT', 'ETHUSDT'] },
  ])
  assert.deepEqual(parseStrategies('f1;ml:shadow@BTCUSDT'), [{ id: 'f1', state: 'live' }, { id: 'ml', state: 'shadow', symbols: ['BTCUSDT'] }])
  assert.throws(() => parseStrategies('f1@*,ml'), /separate strategies with ";"/)
  const wf = readFileSync(new URL('../../.github/workflows/trading-bot.yml', import.meta.url), 'utf8')
  const m = wf.match(/^\s*BOT_STRATEGIES:\s*(\S+)\s*$/m)
  assert.ok(m, 'the workflow sets BOT_STRATEGIES')
  const syms = (wf.match(/^\s*BOT_SYMBOLS:\s*(\S+)\s*$/m) ?? [])[1].replace(/['"]/g, '').split(',')
  assert.equal(syms.length, 24, 'the 24-market universe')
  assert.deepEqual(parseStrategies(m![1].replace(/['"]/g, ''), (wf.match(/^\s*BOT_STRATEGY:\s*(\S+)\s*$/m) ?? [])[1]), [
    { id: 'f1', state: 'live' },
    { id: 'c2', state: 'shadow' },
    { id: 'ml', state: 'shadow', symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] },
  ])
  assert.ok(F1_HEALTH.roll30P1 < F1_HEALTH.roll30P5 && F1_HEALTH.ddP95 < F1_HEALTH.ddP99)
  // Which strategy runs where.
  const [f1, , ml] = parseStrategies(m![1].replace(/['"]/g, ''))!
  assert.equal(slotRuns(f1, 'XRPUSDT'), true)
  assert.equal(slotRuns(ml, 'XRPUSDT'), false)
  assert.equal(slotRuns(ml, 'SOLUSDT'), true)
})

test('probation halves the risk per trade; live and shadow keep it', () => {
  assert.deepEqual([riskScale('live'), riskScale('probation'), riskScale('shadow')], [1, 0.5, 1])
})

test('the drawdown bands are judged over the last 100 trades of the segment', () => {
  const t0 = 1_000_000
  const rec = evaluateHealth(null, live, [], BANDS, t0).record
  // 28 straight losses (28R down, past p99 22R) and then 100 flat trades: the old drawdown has left the window.
  const o = [...run(28, -1, t0 + 1), ...run(100, (k) => (k % 2 ? 0.1 : -0.1), t0 + 2e8)]
  const r = evaluateHealth(rec, live, o, BANDS, t0 + 6e8)
  assert.equal(r.record.state, 'live')
  assert.ok(r.record.stats.maxDdR < 1)
  // The same 28 losses inside the last 100 (the rolling 30 breaks too): demoted.
  const o2 = [...run(72, (k) => (k % 2 ? 0.1 : -0.1), t0 + 1), ...run(28, -1, t0 + 3e8)]
  assert.equal(evaluateHealth(rec, live, o2, BANDS, t0 + 6e8).record.state, 'shadow')
})

// ---- against the schema ----

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

async function closedShadows(pg: PGlite, strategy: string | null, n: number, r: number, from: number) {
  for (let k = 0; k < n; k++) {
    const t = new Date(from + k * 60_000).toISOString()
    await pg.query(
      `insert into bot_shadow_trades (symbol, side, status, bar_time, closed_at, entry, sl, atr, r_gross, r_net, features, strategy, exit_reason)
       values ('BTCUSDT', 1, 'closed', $1, $1, 100, 97, 1, $2, $2, '{}', $3, 'signal')`,
      [t, r, strategy],
    )
  }
}

test('refreshHealth: demotes F1 from its closed trades, logs it, and promotes it back on 30 good shadow trades; the model never moves', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const slots = parseStrategies('f1:live,ml:shadow')!
  const t0 = Date.UTC(2026, 10, 1)
  assert.deepEqual(await refreshHealth(store, slots, t0), { f1: 'live', ml: 'shadow' })
  // An older F1 real trade (no strategy column: mode 'trend') and 29 F1 shadows, all losers.
  await pg.query(
    `insert into bot_trades (symbol, mode, venue, side, status, opened_at, bar_time, closed_at, entry, qty, sl, atr, risk_usd, features, r_multiple, exit_reason)
     values ('ETHUSDT', 'trend', 'fake', 1, 'closed', $1, $1, $1, 100, 1, 97, 1, 3, '{}', -1, 'sl')`,
    [new Date(t0 + 1000).toISOString()],
  )
  await closedShadows(pg, 'f1', 29, -0.5, t0 + 2000)
  // The model's shadows (also older rows without a strategy) are its own.
  await closedShadows(pg, null, 40, 1, t0 + 2000)
  const demoteAt = t0 + 3_600_000
  assert.deepEqual(await refreshHealth(store, slots, demoteAt), { f1: 'shadow', ml: 'shadow' })
  const rec = await store.getState<HealthRecord | null>('strategy:f1', null)
  assert.equal(rec?.state, 'shadow')
  assert.equal(rec?.stats.real, 1)
  assert.equal(rec?.stats.shadow, 29)
  assert.equal(rec?.name, 'F1 trend breakout (4h, long)')
  assert.equal(rec?.priority, 1)
  const ev = (await pg.query<{ level: string; msg: string }>(`select level, msg from bot_events where msg like 'strategy f1%'`)).rows
  assert.equal(ev.length, 1)
  assert.equal(ev[0].level, 'warn')
  assert.match(ev[0].msg, /^strategy f1: live → shadow — rolling 30-trade expectancy -0\.52R < p1/)
  const ml = await store.getState<HealthRecord | null>('strategy:ml', null)
  assert.equal(ml?.stats.shadow, 40)
  assert.equal(ml?.state, 'shadow', 'no bands: never promoted')
  // 30 good shadow trades after the demotion: back to live.
  await closedShadows(pg, 'f1', HEALTH.minRecover, 0.8, demoteAt + 1000)
  assert.equal((await refreshHealth(store, slots, demoteAt + 7_200_000)).f1, 'live')
  assert.equal((await store.getState<HealthRecord | null>('strategy:f1', null))?.history.length, 2)
})
