// Model backup (src/bot/backup.ts): snapshot, damage check, restore into a
// fresh database, and a roll-back over newer models — against the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { compareWith, contentDigest, loadBackup, parseBackup, restoreBackup, saveBackup, takeBackup } from '../src/bot/backup.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'
import type { Model } from '../src/bot/walkforward.ts'
import { applyScaler, predict } from '../src/bot/mlp.ts'

async function freshDb(): Promise<Db> {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql', '012_bot_backups.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db
}

/** A small model whose weights depend on `seed`. */
function model(seed: number): Model {
  const side = (k: number) => ({
    w: { nIn: 2, nHidden: 2, w1: [seed, -k, 0.5, seed / 3], b1: [0.1, -0.2], w2: [k, seed], b2: 0.05 * seed },
    scaler: { mean: [0, 1], std: [1, 2] },
    winR: 1.5,
    lossR: 1,
  })
  return { long: side(1), short: side(-1), features: ['a', 'b'], cfg: DEFAULT_WF, trainedFrom: 0, trainedTo: 1 } as unknown as Model
}

async function seed(db: Db): Promise<BotStore> {
  const store = new BotStore(db)
  for (const [sym, s] of [['BTCUSDT', 1], ['ETHUSDT', 2]] as const) {
    const m = await store.saveModel(sym, '4h', model(s), {}, false, ['x'], { role: 'challenger' })
    await store.promote(sym, '4h', m.id)
  }
  await store.saveCalibration('BTCUSDT', 1, 'down-lo', { a: 0.3, b: 1.2, n: 40, wins: 25 })
  await store.saveCalibration('ETHUSDT', -1, 'up-hi', { a: -0.1, b: 0.9, n: 12, wins: 4 })
  await store.setState('learn:BTCUSDT', { t: 5, n: 2 })
  await store.setState('plan:BTCUSDT', { not: 'kept' })
  return store
}

const out = (m: Model, x: number[]) => [predict(m.long.w, applyScaler(m.long.scaler, x)), predict(m.short.w, applyScaler(m.short.scaler, x))]

test('a backup restores into an empty database with identical networks and corrections', async () => {
  const src = await freshDb()
  const store = await seed(src)
  const b = await takeBackup(src, 1000)
  assert.equal(b.champions.length, 2)
  assert.equal(b.calibration.length, 2)
  assert.deepEqual(b.state.map((s) => s.key), ['learn:BTCUSDT'], 'only the learning keys')
  assert.deepEqual(b.records.bot_models, { count: 2, maxId: 2 })
  const id = await saveBackup(src, b, 'test')
  const back = await loadBackup(src, id)
  assert.equal(back.digest, b.digest)

  const dst = await freshDb()
  const r = await restoreBackup(dst, back, { state: true })
  assert.deepEqual(r, { models: 2, calibration: 2, state: 1 })
  assert.deepEqual(await compareWith(dst, back), [])
  // The bot's own read path gives the same decisions.
  const a = (await store.latestModel('BTCUSDT', '4h'))!.model as Model
  const c = (await new BotStore(dst).latestModel('BTCUSDT', '4h'))!.model as Model
  for (const x of [[0, 0], [1.3, -2], [-4, 7]]) assert.deepEqual(out(c, x), out(a, x))
  assert.deepEqual(await new BotStore(dst).calibration('BTCUSDT', 1, 'down-lo'), { a: 0.3, b: 1.2, n: 40, wins: 25 })
})

test('a roll-back keeps the newer models as retired rows and brings the backup back', async () => {
  const db = await freshDb()
  const store = await seed(db)
  const b = await takeBackup(db)
  // The bot learns on: a new champion and a moved correction.
  const m = await store.saveModel('BTCUSDT', '4h', model(9), {}, false, [], { role: 'challenger' })
  await store.promote('BTCUSDT', '4h', m.id)
  await store.saveCalibration('BTCUSDT', 1, 'down-lo', { a: 1, b: 1, n: 41, wins: 26 })
  const diffs = await compareWith(db, b)
  assert.equal(diffs.length, 2)
  await restoreBackup(db, b)
  assert.deepEqual(await compareWith(db, b), [])
  const rows = (await db.query(`select id, role, holdout from bot_models where symbol = 'BTCUSDT' order by id`)).rows
  assert.deepEqual(rows.map((x) => x.role), ['retired', 'retired', 'champion'], 'nothing deleted: original, newer, restored')
  assert.equal(rows.at(-1)!.holdout.restoredFrom, b.champions.find((c) => c.symbol === 'BTCUSDT')!.id)
})

test('a damaged or foreign file is refused', async () => {
  const db = await freshDb()
  await seed(db)
  const b = await takeBackup(db)
  assert.equal(parseBackup(JSON.stringify(b)).digest, b.digest)
  const bad = structuredClone(b)
  bad.calibration[0].a = 9
  assert.throws(() => parseBackup(bad), /damaged/)
  assert.throws(() => parseBackup({ v: 2 }), /not a model backup/)
  // The digest ignores row ids and times: the same content always gives the same digest.
  assert.equal(contentDigest(b.champions.map((c) => ({ ...c, id: 99 })), b.calibration.map((c) => ({ ...c, updated: 'x' }))), b.digest)
})
