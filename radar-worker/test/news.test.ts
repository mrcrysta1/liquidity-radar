// Economic events and reactions (src/news/) against the real schema (sql/010).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { BotStore } from '../src/bot/store.ts'
import { categorize, eventKey, fomcDecisions, fomcRows, mergeActuals, newYorkToUtc, parseAgency, parseFomcCalendar, parseForexFactory, parseValue, reaction } from '../src/news/events.ts'
import { AGENCY_URL, FF_URL, backfillFred, collectCalendars, computeReactions, keep, pendingReleases } from '../src/news/collect.ts'
import type { NewsFetchers } from '../src/news/collect.ts'

const M15 = 900_000
const NAMES: Record<string, string> = { 50: 'Employment Situation', 10: 'Consumer Price Index', 46: 'Producer Price Index', 53: 'Gross Domestic Product', 180: 'Unemployment Insurance Weekly Claims Report', 9: 'Advance Monthly Sales for Retail and Food Services', 54: 'Personal Income and Outlays' }
const DAY = 86_400_000

test('categories from titles; positive or negative is never assumed', () => {
  assert.equal(categorize('Non-Farm Employment Change'), 'nfp')
  assert.equal(categorize('Nonfarm Payrolls (Employment Situation)'), 'nfp')
  assert.equal(categorize('Core CPI m/m'), 'cpi')
  assert.equal(categorize('PPI (Producer Price Index)'), 'ppi')
  assert.equal(categorize('Federal Funds Rate'), 'fomc')
  assert.equal(categorize('FOMC Meeting Minutes'), 'fomc-minutes')
  assert.equal(categorize('Fed Chair Powell Speaks'), 'fed-speech')
  assert.equal(categorize('Unemployment Claims'), 'claims')
  assert.equal(categorize('Unemployment Rate'), 'unemployment')
  assert.equal(categorize('Advance GDP q/q'), 'gdp')
  assert.equal(categorize('Congressional Elections'), 'political')
  assert.equal(categorize('Building Approvals m/m'), 'other')
})

test('values: K / M / % and junk', () => {
  assert.deepEqual(['250K', '-0.1%', '1.2M', '4.25|4.50%', '', 'n/a', null, '102.3'].map(parseValue), [250, -0.1, 1200, 4.5, null, null, null, 102.3])
})

test('the two calendars; the agency actual fills Forex Factory, a revised previous is kept', () => {
  const ff = parseForexFactory([
    { title: 'Non-Farm Employment Change', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High', forecast: '65K', previous: '29K' },
    { title: 'Unemployment Rate', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High', forecast: '4.2%', previous: '4.2%' },
    { title: 'Building Approvals m/m', country: 'AUD', date: '2026-11-01T19:30:00-05:00', impact: 'Low', forecast: '1.8%', previous: '-6.1%' },
    { title: '', date: 'x' },
  ])
  assert.equal(ff.length, 3)
  assert.equal(ff[0].eventTime, Date.UTC(2026, 10, 6, 13, 30))
  const ag = parseAgency({ data: [{ source: 'bls', eventName: 'Nonfarm Payrolls (Employment Situation)', importance: 'high', scheduledAt: '2026-11-06T13:30:00.000Z', periodLabel: 'October 2026', previous: '60.0000', forecast: null, actual: '165.0000', unit: 'thousands, monthly change' }] })
  const m = mergeActuals(ff, ag)
  assert.deepEqual([m[0].actualNum, m[0].forecastNum, m[0].surprise, m[0].revisedPreviousNum], [165, 65, 100, 60])
  assert.equal(m[1].actual, null, 'no agency number for the unemployment rate here: left empty, not guessed')
  assert.deepEqual(ff.map(keep), [true, true, false])
  assert.notEqual(eventKey('ff', 'USD', 'A', 0), eventKey('agency', 'USD', 'A', 0))
})

test('New York release times across daylight saving', () => {
  assert.equal(newYorkToUtc('2026-07-02', 8, 30), Date.UTC(2026, 6, 2, 12, 30), 'summer: UTC−4')
  assert.equal(newYorkToUtc('2026-12-04', 8, 30), Date.UTC(2026, 11, 4, 13, 30), 'winter: UTC−5')
  assert.equal(newYorkToUtc('2026-03-18', 14, 0), Date.UTC(2026, 2, 18, 18, 0), 'after the March switch')
})

test('FOMC meetings from the Fed calendar page: last day, month crossings, cancelled and notation votes skipped', () => {
  const html = `<h4>2026 FOMC Meetings</h4>
    <div class="fomc-meeting__month col"><strong>January</strong></div><div class="fomc-meeting__date col">27-28</div>
    <div class="fomc-meeting__month col"><strong>March</strong></div><div class="fomc-meeting__date col">17-18*</div>
    <div class="fomc-meeting__month col"><strong>Apr/May</strong></div><div class="fomc-meeting__date col">30-1</div>
    <div class="fomc-meeting__month col"><strong>October</strong></div><div class="fomc-meeting__date col">14 (notation vote)</div>
    <div class="fomc-meeting__month col"><strong>June</strong></div><div class="fomc-meeting__date col">Cancelled</div>
    <h4>2025 FOMC Meetings</h4>
    <div class="fomc-meeting__month col"><strong>December</strong></div><div class="fomc-meeting__date col">9-10*</div>`
  assert.deepEqual(parseFomcCalendar(html), ['2025-12-10', '2026-01-28', '2026-03-18', '2026-05-01'])
  assert.deepEqual(parseFomcCalendar('<html>nothing</html>'), [])
})

test('FOMC decisions from the target series; FRED rows are dates only', () => {
  const tgt = [{ date: '2026-01-27', value: 4.5 }, { date: '2026-01-29', value: 4.25 }, { date: '2026-03-17', value: 4.25 }, { date: '2026-03-19', value: 4.25 }]
  const d = fomcDecisions(['2026-01-28', '2026-03-18', '2030-01-01'], tgt)
  assert.deepEqual([...d.entries()], [['2026-01-28', 'cut → 4.25%'], ['2026-03-18', 'hold → 4.25%']])
  const rows = fomcRows(['2026-01-28'], d)
  assert.deepEqual([rows[0].source, rows[0].eventTime, rows[0].decision, rows[0].forecast, rows[0].surprise], ['fed', Date.UTC(2026, 0, 28, 19, 0), 'cut → 4.25%', null, null])
})

/** 15m bars: a calm random-ish walk, then a jump of `jump` at time `t`. */
function walk(t: number, jump: number): Bar[] {
  const out: Bar[] = []
  let p = 100
  for (let x = t - 32 * DAY; x < t + 2 * DAY; x += M15) {
    const k = x / M15
    p *= 1 + 0.001 * Math.sin(k * 1.3) * Math.cos(k * 0.07)
    if (x === t) p *= 1 + jump
    out.push({ t: x, o: p, h: p * 1.0005, l: p * 0.9995, c: p, v: 1 } as Bar)
  }
  return out
}

test('reaction: returns from the last close before the release, sized against the 30 days before', () => {
  const t = Date.UTC(2026, 10, 6, 13, 30)
  const r = reaction(walk(t, 0.02), t)
  assert.deepEqual(r.map((x) => x.horizonMin), [15, 60, 240, 1440])
  assert.ok(r[0].retPct > 1.5, `15m ${r[0].retPct}`)
  assert.ok(r[0].z! > 5, 'a 2% jump is far outside a calm market')
  const calm = reaction(walk(t, 0), t)
  assert.ok(Math.abs(calm[0].z!) < 3)
  // No bars after the release yet: nothing, not zeros.
  assert.deepEqual(reaction(walk(t, 0).filter((b) => b.t < t), t), [])
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '010_econ_events.sql', '010_econ_events.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('collect → store → pending → reactions, de-duplicated; FRED guarded by the release name', async () => {
  const { db, pg } = await freshDb()
  const t = Date.UTC(2026, 10, 6, 13, 30)
  const f: NewsFetchers = {
    async text() {
      return '<h4>2026 FOMC Meetings</h4><div class="fomc-meeting__month"><strong>January</strong></div><div class="fomc-meeting__date">27-28</div>'
    },
    async json(url) {
      if (url === FF_URL) return [{ title: 'Non-Farm Employment Change', country: 'USD', date: '2026-11-06T08:30:00-05:00', impact: 'High', forecast: '65K', previous: '29K' }]
      if (url === AGENCY_URL) throw new Error('HTTP 503')
      if (url.includes('series/observations')) return { observations: [{ date: '2026-01-27', value: '4.5' }, { date: '2026-01-29', value: '4.25' }] }
      if (url.includes('release?release_id=')) return { releases: [{ name: NAMES[url.match(/release_id=(\d+)/)![1]] ?? 'Something else' }] }
      if (url.includes('release/dates')) return { release_dates: [{ date: '2026-11-06' }, { date: '2026-10-03' }] }
      throw new Error('unexpected ' + url)
    },
    async bars(asset, _i, start, end) {
      if (asset === 'XAUUSDT') return []
      return walk(t, asset === 'BTCUSDT' ? -0.015 : 0.01).filter((b) => b.t >= start && b.t < end)
    },
  }
  const c = await collectCalendars(db, f)
  assert.equal(c.ff, 1)
  assert.match(c.errors[0], /agency calendar/)
  await collectCalendars(db, f)
  assert.equal((await pg.query('select * from econ_events')).rows.length, 1, 'collected twice, stored once')
  // FRED: a release whose name does not match stops the backfill (rows before it kept).
  await assert.rejects(backfillFred(db, 'k', { ...f, json: async (u) => (u.includes('release_id=10') && !u.includes('dates') ? { releases: [{ name: 'Something else' }] } : f.json(u)) }), /FRED release 10 is "Something else"/)
  const res = await backfillFred(db, 'k', f)
  assert.equal(res.fomc, 1, 'FOMC from the Fed calendar, not FRED')
  const fred = (await pg.query<{ source: string; category: string; event_time: Date; decision: string | null }>(`select source, category, event_time, decision from econ_events where source in ('fred', 'fed') and category in ('nfp', 'fomc') order by event_time`)).rows
  assert.deepEqual(fred.map((x) => [x.source, x.category, x.event_time.toISOString()]), [['fed', 'fomc', '2026-01-28T19:00:00.000Z'], ['fred', 'nfp', '2026-10-03T12:30:00.000Z'], ['fred', 'nfp', '2026-11-06T13:30:00.000Z']])
  assert.equal(fred[0].decision, 'cut → 4.25%')
  // Pending: release times over 24 h old; the FF row and the FRED row share one time.
  const pend = await pendingReleases(db, t + 2 * DAY, 10)
  assert.deepEqual(pend, [Date.UTC(2026, 0, 28, 19, 0), Date.UTC(2026, 9, 3, 12, 30), t])
  await computeReactions(db, Date.UTC(2026, 0, 28, 19, 0), { ...f, bars: async () => [] })
  assert.equal(await computeReactions(db, t, f), 8, 'BTC and ETH × 4 horizons; gold had no data then')
  const btc = (await pg.query<{ ret_pct: number; z: number }>(`select ret_pct, z from econ_reactions where asset = 'BTCUSDT' and horizon_min = 15`)).rows[0]
  assert.ok(btc.ret_pct < -1 && btc.z < -5)
  assert.deepEqual(await pendingReleases(db, t + 2 * DAY, 10), [Date.UTC(2026, 9, 3, 12, 30)])
  // A time with no bars at all gets a placeholder so it is not retried forever.
  assert.equal(await computeReactions(db, Date.UTC(2026, 9, 3, 12, 30), { ...f, bars: async () => [] }), 0)
  assert.deepEqual(await pendingReleases(db, t + 2 * DAY, 10), [])
  assert.equal((await new BotStore(db).getState('news:backfill', null)), null)
})
