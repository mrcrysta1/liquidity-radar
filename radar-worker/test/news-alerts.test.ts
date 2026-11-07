// News alerts (src/news/alerts.ts) against the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { BotStore } from '../src/bot/store.ts'
import { byTime, headsUp, moveSince, newsAlertTick, result } from '../src/news/alerts.ts'
import type { AlertRow } from '../src/news/alerts.ts'

const T = Date.UTC(2026, 11, 4, 13, 30)
const row = (o: Partial<AlertRow>): AlertRow => ({ time: T, category: 'nfp', title: 'Non-Farm Employment Change', forecast: '65K', previous: '29K', actual: null, surprise: null, unit: null, source: 'ff', ...o })

test('texts: facts only, one message per release time, Forex Factory rows preferred', () => {
  const h = headsUp([row({}), row({ category: 'unemployment', title: 'Unemployment Rate', forecast: '4.2%', previous: '4.2%' })], T - 45 * 60_000, { nfp: { n: 80, avgAbs: 0.84 }, unemployment: { n: 3, avgAbs: 0.5 } })
  assert.match(h, /^⏰ In 45 min \(13:30 UTC\): Non-Farm Employment Change · Unemployment Rate/)
  assert.match(h, /forecast 65K · previous 29K/)
  assert.match(h, /After past NFP releases BTC moved ±0.84% in the hour on average \(80 releases\)/)
  assert.doesNotMatch(h, /Unemployment releases/, 'under 5 releases: no average')
  assert.doesNotMatch(h + result([row({ actual: '165K', surprise: 100 })], -1.2), /bullish|bearish/i)
  assert.equal(result([row({ actual: '165K', surprise: 100 })], -1.234), '📢 13:30 UTC release\n  Non-Farm Employment Change: 165K vs forecast 65K (surprise +100)\n  BTC -1.23% since the release.')
  const g = byTime([row({}), row({ source: 'agency', title: 'Nonfarm Payrolls (Employment Situation)' }), row({ time: T + 3_600_000, source: 'agency', title: 'X' })])
  assert.deepEqual(g.map((x) => x.map((r) => r.source)), [['ff'], ['agency']])
})

test('moveSince: from the last close before the release to the latest bar', () => {
  const bars = [0, 1, 2, 3].map((k) => ({ t: T - 900_000 + k * 900_000, o: 1, h: 1, l: 1, c: 100 + k, v: 1 }) as Bar)
  assert.ok(Math.abs(moveSince(bars, T)! - 3) < 1e-9)
  assert.equal(moveSince(bars.slice(0, 1), T), null, 'nothing after the release yet')
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '010_econ_events.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('newsAlertTick: heads-up once, result once, nothing without a webhook', async () => {
  const { db, pg } = await freshDb()
  await pg.query(`insert into econ_events (key, source, category, title, country, impact, event_time, forecast, previous) values ('a', 'ff', 'nfp', 'Non-Farm Employment Change', 'USD', 'High', $1, '65K', '29K')`, [new Date(T).toISOString()])
  const store = new BotStore(db)
  const sent: string[] = []
  const on = { enabled: true, send: async (t: string) => (sent.push(t), true) }
  const off = { enabled: false, send: async (): Promise<boolean> => { throw new Error('must not send') } }
  assert.equal(newsAlertTick(store, db, off, T - 40 * 60_000), undefined)
  await newsAlertTick(store, db, on, T - 40 * 60_000)
  await newsAlertTick(store, db, on, T - 30 * 60_000)
  assert.equal(sent.length, 1, 'once per release, and at most every 5 minutes')
  assert.match(sent[0], /In 40 min/)
  await newsAlertTick(store, db, on, T - 20 * 60_000)
  assert.equal(sent.length, 1, 'already sent')
  await pg.query(`update econ_events set actual = '165K', surprise = 100`)
  const bars = async () => [0, 1, 2, 3, 4].map((k) => ({ t: T - 900_000 + k * 900_000, o: 1, h: 1, l: 1, c: 100 - k, v: 1 }) as Bar)
  await newsAlertTick(store, db, on, T + 70 * 60_000, bars)
  await newsAlertTick(store, db, on, T + 80 * 60_000, bars)
  assert.equal(sent.length, 2)
  assert.match(sent[1], /165K vs forecast 65K \(surprise \+100\)[\s\S]*BTC -4.00% since/)
})
