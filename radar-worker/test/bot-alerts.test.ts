// Operations alerts (src/bot/alerts.ts): payload, which events alert, the
// error rate limit, the daily summary and failure isolation — with a fake
// fetch, no network. Plus BotStore.onEvent and daySummary on the real schema.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { ALERT_LIMITS, Alerts, alertPayload, classifyEvent, formatSummary } from '../src/bot/alerts.ts'

function fake(o: { fail?: 'throw' | 'http' | 'hang' } = {}) {
  const sent: Array<{ url: string; body: { content: string; text: string }; signal: AbortSignal }> = []
  const fn = async (url: string, init: { body: string; signal: AbortSignal }) => {
    sent.push({ url, body: JSON.parse(init.body), signal: init.signal })
    if (o.fail === 'throw') throw new Error('network down')
    if (o.fail === 'hang')
      return new Promise<{ ok: boolean; status: number }>((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('timeout'))))
    return { ok: o.fail !== 'http', status: o.fail === 'http' ? 500 : 204 }
  }
  return { sent, fn }
}

const URL_ = 'https://discord.example/api/webhooks/1/x'

test('disabled without a webhook URL: nothing is sent', async () => {
  const f = fake()
  for (const u of [undefined, '', '   ', 'not-a-url']) {
    const a = new Alerts(u, { fetch: f.fn })
    assert.equal(a.enabled, false)
    assert.equal(await a.send('x'), false)
    assert.equal(await a.onEvent('error', 'BTCUSDT', 'boom'), false)
  }
  assert.equal(f.sent.length, 0)
})

test('payload carries both Discord content and Slack text, trimmed', async () => {
  assert.deepEqual(alertPayload('hi'), { content: 'hi', text: 'hi' })
  assert.equal(alertPayload('x'.repeat(5000)).content.length, ALERT_LIMITS.maxLen)
  const f = fake()
  const a = new Alerts(URL_, { fetch: f.fn, name: 'bot' })
  assert.equal(await a.send('hello'), true)
  assert.equal(f.sent[0].url, URL_)
  assert.deepEqual(f.sent[0].body, { content: '[bot] hello', text: '[bot] hello' })
})

test('which events alert', () => {
  assert.equal(classifyEvent('warn', 'entries halted — daily loss limit: down 3.10% today'), 'halt')
  assert.equal(classifyEvent('warn', 'entries halted — drawdown kill switch: 15.2% below peak — reset manually'), 'halt')
  assert.equal(classifyEvent('warn', 'strategy f1: live → probation — rolling 30-trade expectancy -0.35R < p5 -0.33R'), 'strategy')
  assert.equal(classifyEvent('info', 'strategy c6: shadow → live — 30 shadow trades'), 'strategy')
  assert.equal(classifyEvent('error', 'trade #4: stop could not be placed (x) — closing'), 'error')
  assert.equal(classifyEvent('info', 'opened LONG'), null)
  assert.equal(classifyEvent('warn', 'USDT balance unavailable'), null)
})

test('error alerts: 1 per market per 30 min, 20 per hour in total', async () => {
  let now = 1_000_000_000
  const f = fake()
  const a = new Alerts(URL_, { fetch: f.fn, now: () => now })
  assert.equal(await a.onEvent('error', 'BTCUSDT', 'tick failed: a'), true)
  assert.equal(await a.onEvent('error', 'BTCUSDT', 'tick failed: b'), false, 'same market within 30 min')
  assert.equal(await a.onEvent('error', 'ETHUSDT', 'tick failed: c'), true, 'another market')
  assert.match(f.sent.at(-1)!.body.content, /\+1 more error/, 'the next alert mentions what was held back')
  now += ALERT_LIMITS.perSymbolMs
  assert.equal(await a.onEvent('error', 'BTCUSDT', 'tick failed: d'), true, 'after 30 min')
  assert.doesNotMatch(f.sent.at(-1)!.body.content, /more error/)
  // Halts and strategy changes are never rate-limited.
  assert.equal(await a.onEvent('warn', null, 'entries halted — daily loss limit'), true)
  // The hourly cap across markets.
  now += ALERT_LIMITS.perSymbolMs
  const before = f.sent.length
  let ok = 0
  for (let k = 0; k < 30; k++) if (await a.onEvent('error', 'S' + k, 'x')) ok++
  // The two from an hour ago have left the window; the one from 30 min ago still counts.
  assert.equal(ok, ALERT_LIMITS.perHour - 1, 'capped at 20 per hour')
  assert.equal(f.sent.length - before, ok)
  now += 3_600_000
  assert.equal(await a.onEvent('error', 'S99', 'x'), true, 'the cap frees up after an hour')
})

test('a failing webhook never throws', async () => {
  for (const fail of ['throw', 'http', 'hang'] as const) {
    const f = fake({ fail })
    const a = new Alerts(URL_, { fetch: f.fn, timeoutMs: 50 })
    assert.equal(await a.send('x'), false, fail)
    assert.equal(await a.onEvent('warn', null, 'entries halted — x'), false, fail)
  }
  // A fetch that throws synchronously too.
  const a = new Alerts(URL_, { fetch: () => { throw new Error('sync') } })
  assert.equal(await a.onEvent('error', null, 'x'), false)
})

test('daily summary: once per UTC day, for the day that ended', async () => {
  let now = Date.parse('2026-11-02T00:00:20Z')
  const f = fake()
  const a = new Alerts(URL_, { fetch: f.fn, now: () => now })
  const days: string[] = []
  const load = async (day: string, start: number) => {
    days.push(day + '@' + new Date(start).toISOString())
    return { day, equity: 5012.5, dayPnl: -12.25, realized: 3, openPositions: 2, perStrategy: [{ strategy: 'f1', real: 1, shadow: 2 }] }
  }
  assert.equal(await a.daily('', load), '2026-11-02', 'first run: start counting, no summary')
  assert.equal(f.sent.length, 0)
  assert.equal(await a.daily('2026-11-02', load), '2026-11-02', 'already sent today')
  now = Date.parse('2026-11-03T00:01:00Z')
  assert.equal(await a.daily('2026-11-02', load), '2026-11-03')
  assert.deepEqual(days, ['2026-11-02@2026-11-02T00:00:00.000Z'])
  assert.match(f.sent[0].body.content, /Daily summary 2026-11-02/)
  assert.match(f.sent[0].body.content, /equity \$5012\.50 · day −\$12\.25 · realized \+\$3\.00/)
  assert.match(f.sent[0].body.content, /open positions 2/)
  assert.match(f.sent[0].body.content, /f1 1 real \/ 2 paper/)
  // A load failure is swallowed and the day is still marked done.
  now = Date.parse('2026-11-04T00:01:00Z')
  assert.equal(await a.daily('2026-11-03', async () => { throw new Error('db') }), '2026-11-04')
  assert.match(formatSummary({ day: 'd', equity: null, dayPnl: null, realized: 0, openPositions: 0, perStrategy: [] }), /equity unknown · day n\/a[\s\S]*trades: none/)
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('store: onEvent hook is fire-and-forget; a throwing hook does not break event()', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const seen: string[] = []
  store.onEvent = (l, s, m) => seen.push(`${l}:${s}:${m}`)
  await store.event('error', 'BTCUSDT', 'boom')
  store.onEvent = () => {
    throw new Error('hook broke')
  }
  await store.event('warn', null, 'still logged')
  store.onEvent = () => Promise.reject(new Error('async hook broke'))
  await store.event('info', null, 'and this')
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(seen, ['error:BTCUSDT:boom'])
  const n = await pg.query<{ n: number }>('select count(*)::int as n from bot_events')
  assert.equal(n.rows[0].n, 3)
})

test('store: daySummary figures', async () => {
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  const day = Date.parse('2026-11-02T00:00:00Z')
  await store.equity(day - 3_600_000, 1000)
  await store.equity(day + 3_600_000, 1010)
  await store.equity(day + 23 * 3_600_000, 990)
  await store.equity(day + 25 * 3_600_000, 2000)
  const ins = (status: string, opened: number, closed: number | null, pnl: number | null, strategy: string | null, mode = 'trend') =>
    pg.query(
      `insert into bot_trades (symbol, mode, venue, side, status, opened_at, closed_at, bar_time, entry, qty, sl, atr, risk_usd, features, pnl_usd, strategy)
       values ('BTCUSDT', $1, 'x', 1, $2, $3, $4, $3, 100, 1, 90, 1, 10, '{}', $5, $6)`,
      [mode, status, new Date(opened).toISOString(), closed == null ? null : new Date(closed).toISOString(), pnl, strategy],
    )
  await ins('closed', day - 86_400_000, day + 3_600_000, 5, 'f1')
  await ins('open', day + 7_200_000, null, null, 'f1')
  await ins('closed', day + 7_200_000, day + 86_400_000 + 1, 7, null, 'explore')
  const s = await store.daySummary(day)
  assert.equal(s.startEquity, 1000)
  assert.equal(s.endEquity, 990)
  assert.equal(s.realized, 5)
  assert.equal(s.openPositions, 1)
  assert.deepEqual(s.perStrategy, [{ strategy: 'f1', real: 1, shadow: 0 }, { strategy: 'ml', real: 1, shadow: 0 }])
})
