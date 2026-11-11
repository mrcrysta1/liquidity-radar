// Market context (src/context/market.ts, src/context/collect.ts) and its table (sql/009).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { BotStore } from '../src/bot/store.ts'
import { alignedReturns, correlation, dailyCorrelation, dailyTrend, efficiency, keyLevels, pearson, regimeOf, regimeSeries, tfState, volumeNote } from '../src/context/market.ts'
import type { TfState } from '../src/context/market.ts'
import { collectContext, saveContext } from '../src/context/collect.ts'
import type { Fetchers } from '../src/context/collect.ts'

const H4 = 14_400_000
/** Bars from a close path; the range is `w` around each close. */
const bars = (closes: number[], step = H4, w = 0.5, t0 = 0): Bar[] =>
  closes.map((c, i) => ({ t: t0 + i * step, o: i ? closes[i - 1] : c, h: Math.max(c, i ? closes[i - 1] : c) + w, l: Math.min(c, i ? closes[i - 1] : c) - w, c, v: 100 + (i % 7) }) as Bar)
/** A deterministic wiggle so series are not perfectly smooth. */
const wig = (i: number, seed = 1) => Math.sin(i * 1.7 * seed) * 0.6 + Math.sin(i * 0.31 * seed) * 0.4

test('tfState: direction, efficiency, volatility rank from closed bars', () => {
  const up = tfState(bars(Array.from({ length: 400 }, (_, i) => 100 + i * 0.5 + wig(i))), H4)!
  assert.equal(up.dir, 'up')
  assert.ok(up.er30 > 0.3, `er ${up.er30}`)
  assert.ok(up.roc20 > 0)
  const down = tfState(bars(Array.from({ length: 400 }, (_, i) => 400 - i * 0.5 + wig(i))), H4)!
  assert.equal(down.dir, 'down')
  const chop = tfState(bars(Array.from({ length: 400 }, (_, i) => 100 + wig(i) * 3)), H4)!
  assert.ok(chop.er30 < 0.15, `er ${chop.er30}`)
  assert.equal(tfState(bars([1, 2, 3]), H4), null, 'too little history')
  assert.equal(efficiency([1, 2, 3, 4, 5, 6], 5), 1)
  // Volatility jump at the end ranks at the top of its past.
  const calmThenWild = bars(Array.from({ length: 400 }, (_, i) => 100 + i * 0.1), H4, 0.2)
  calmThenWild.push({ t: 400 * H4, o: 140, h: 150, l: 130, c: 140, v: 1 } as Bar)
  assert.ok(tfState(calmThenWild, H4)!.atrRank >= 0.99)
})

test('regimeOf: the seven classes', () => {
  const s = (o: Partial<TfState>): TfState => ({ t: 0, close: 100, dir: 'flat', ema50: 100, ema200: 100, roc20: 0, rsi14: 50, er30: 0.2, atrPct: 1, atrRank: 0.5, volRatio: 1, volTrend: 1, ...o })
  assert.equal(regimeOf(s({ atrRank: 0.95 }), null).regime, 'high-volatility')
  assert.equal(regimeOf(s({ dir: 'up', er30: 0.4 }), s({ dir: 'up' })).regime, 'strong-bull')
  assert.equal(regimeOf(s({ dir: 'down', er30: 0.4 }), s({ dir: 'flat' })).regime, 'strong-bear')
  assert.equal(regimeOf(s({ dir: 'up', er30: 0.4 }), s({ dir: 'down' })).regime, 'uncertain', '4h and 1h disagree')
  assert.equal(regimeOf(s({ er30: 0.1, close: 100.5, ema200: 100 }), null).regime, 'sideways')
  assert.equal(regimeOf(s({ dir: 'up', er30: 0.2, close: 110, ema200: 100 }), null).regime, 'weak-bull')
  assert.equal(regimeOf(s({ dir: 'down', er30: 0.2, close: 90, ema200: 100 }), null).regime, 'weak-bear')
  assert.equal(regimeOf(s({ er30: 0.1, close: 110, ema200: 100 }), null).regime, 'uncertain')
  assert.equal(regimeOf(null, null).regime, 'uncertain')
})

test('correlation: measured, not assumed; beta; a significant change is flagged', () => {
  const n = 400
  const btcC = [100]
  for (let i = 1; i < n; i++) btcC.push(btcC[i - 1] * (1 + 0.01 * wig(i, 1.3)))
  const btc = bars(btcC)
  // A follower: twice BTC's moves (r ≈ 1, beta ≈ 2).
  const fol = [50]
  for (let i = 1; i < n; i++) fol.push(fol[i - 1] * (1 + 0.02 * wig(i, 1.3)))
  const c = correlation(btc, bars(fol), 180)
  assert.ok(c.r! > 0.99 && Math.abs(c.beta! - 2) < 0.1, JSON.stringify(c))
  assert.equal(c.group, 'strong')
  // Its own path: independent.
  const own = [10]
  for (let i = 1; i < n; i++) own.push(own[i - 1] * (1 + 0.01 * wig(i, 7.1)))
  assert.equal(correlation(btc, bars(own), 180).group, 'independent')
  // Follows BTC in the earlier window, then its own way: a change.
  const sw = [20]
  for (let i = 1; i < n; i++) sw.push(sw[i - 1] * (1 + 0.01 * (i < n - 180 ? wig(i, 1.3) : wig(i, 7.1))))
  const ch = correlation(btc, bars(sw), 180)
  assert.ok(ch.prev! > 0.9 && ch.changed && Math.abs(ch.z!) > 2.58, JSON.stringify(ch))
  // Only bars both have are paired; a gap breaks the chain.
  const { x } = alignedReturns(bars([1, 2, 3, 4]), bars([1, 2, 3, 4]).filter((_, i) => i !== 2))
  assert.equal(x.length, 1)
  assert.equal(pearson([1, 2], [2, 4]), null, 'too few points')
})

test('daily series: trend, correlation, key levels', () => {
  const D = 86_400_000
  const d = Array.from({ length: 60 }, (_, i) => ({ t: i * D, c: 100 + i }))
  assert.equal(dailyTrend(d)!.dir, 'up')
  assert.equal(dailyTrend(d.slice(0, 10)), null)
  const inv = d.map((x, i) => ({ t: x.t, c: 200 - i - wig(i) }))
  const pos = d.map((x, i) => ({ t: x.t + 3_600_000, c: 100 + i + wig(i) }))
  assert.ok(dailyCorrelation(pos, inv)! < -0.5)
  const h1 = Array.from({ length: 24 * 25 }, (_, i) => ({ t: i * 3_600_000, o: 1, h: 10 + (i % 24), l: 5 - (i % 3), c: 8, v: 1 }) as Bar)
  const lv = keyLevels(h1, 24 * D + 5 * 3_600_000)!
  assert.deepEqual([lv.prevDayHigh, lv.prevDayLow], [33, 3])
})

async function freshDb() {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  // 009 twice: it must be safe to apply on every run.
  for (const f of ['001_whales.sql', '002_bot.sql', '009_market_context.sql', '009_market_context.sql']) await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { db: { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db, pg }
}

test('collectContext + saveContext: a failing source leaves its part empty; one row per 4h bar', async () => {
  const now = Date.UTC(2026, 10, 7, 12)
  const step: Record<string, number> = { '15m': 900_000, '1h': 3_600_000, '4h': H4 }
  const fetchers: Fetchers = {
    async bars(symbol, tf, count) {
      if (symbol === 'SOLUSDT') throw new Error('HTTP 500')
      // Prices as a function of time, so every market's bar at a time agrees with BTC's.
      const k = symbol === 'XAUUSDT' ? 0.3 : 1
      const first = Math.round(now / step[tf]) - count
      return bars(Array.from({ length: count }, (_, i) => 100 + ((first + i) % 2000) * 0.2 * k + wig(first + i)), step[tf], 0.5, (first) * step[tf])
    },
    async daily(sym) {
      if (sym === '^IRX') throw new Error('timeout')
      return Array.from({ length: 120 }, (_, i) => ({ t: now - (120 - i) * 86_400_000, c: 100 + i * 0.1 + wig(i) }))
    },
  }
  const c = await collectContext(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSDT'], fetchers, now)
  assert.equal(c.btc['4h']!.dir, 'up')
  assert.ok(c.corr.ETHUSDT['4h']!.r! > 0.9, JSON.stringify(c.corr.ETHUSDT['4h']))
  assert.equal(c.corr.SOLUSDT, undefined)
  assert.equal(c.corr.XAUUSDT, undefined, 'gold is reported on its own, not as a coin')
  assert.ok(c.errors.some((e) => e.startsWith('SOLUSDT')) && c.errors.some((e) => e.startsWith('^IRX')), c.errors.join('; '))
  assert.equal(c.gold.bill13w, null)
  assert.ok(c.gold.dxy && c.gold.h4 && c.gold.levels, JSON.stringify([!!c.gold.dxy, !!c.gold.h4, !!c.gold.levels]))
  assert.ok(['same', 'opposite', 'mixed'].includes(c.btcVsGold!))
  const { db, pg } = await freshDb()
  const store = new BotStore(db)
  await saveContext(store, db, c)
  await saveContext(store, db, { ...c, regime: { regime: 'sideways', why: 'test' } })
  const rows = (await pg.query<{ regime: string; btc_dir_4h: string }>('select regime, btc_dir_4h from market_context')).rows
  assert.deepEqual(rows, [{ regime: 'sideways', btc_dir_4h: 'up' }], 'the same bar is replaced, not duplicated')
  assert.equal((await store.getState<{ v: number } | null>('context:latest', null))?.v, 1)
})

test('correlation: downside beta, trend of the correlation, and a coin moving on its own', () => {
  const n = 400
  const btcC = [100]
  for (let i = 1; i < n; i++) btcC.push(btcC[i - 1] * (1 + 0.01 * wig(i, 1.3)))
  const btc = bars(btcC)
  // Falls 3× BTC's falls, rises 1× its rises: downside beta ≈ 3, above the plain beta.
  const asym = [50]
  for (let i = 1; i < n; i++) {
    const m = btcC[i] / btcC[i - 1] - 1
    asym.push(asym[i - 1] * (1 + (m < 0 ? 3 * m : m)))
  }
  const a = correlation(btc, bars(asym), 180)
  assert.ok(a.downBeta! > 2.7 && a.downBeta! < 3.3 && a.downBeta! > a.beta!, JSON.stringify(a))
  // A follower that jumps on its own in the last 6 bars: decoupled.
  const fol = [50]
  for (let i = 1; i < n; i++) fol.push(fol[i - 1] * (1 + 0.02 * wig(i, 1.3) + 0.001 * wig(i, 5.3) + (i >= n - 6 ? 0.03 : 0)))
  const d = correlation(btc, bars(fol), 180)
  assert.ok(d.decoupled && d.residualZ! > 2.58, JSON.stringify(d))
  const tight = [50]
  for (let i = 1; i < n; i++) tight.push(tight[i - 1] * (1 + 0.02 * wig(i, 1.3) + 0.001 * wig(i, 5.3)))
  assert.equal(correlation(btc, bars(tight), 180).decoupled, false)
  // Follows, then goes its own way: weakening; the reverse: strengthening.
  const sw = [20]
  for (let i = 1; i < n; i++) sw.push(sw[i - 1] * (1 + 0.01 * (i < n - 180 ? wig(i, 1.3) : wig(i, 7.1))))
  assert.equal(correlation(btc, bars(sw), 180).trend, 'weakening')
  const back = [20]
  for (let i = 1; i < n; i++) back.push(back[i - 1] * (1 + 0.01 * (i < n - 180 ? wig(i, 7.1) : wig(i, 1.3))))
  assert.equal(correlation(btc, bars(back), 180).trend, 'strengthening')
})

test('regimeSeries: the live rules at every bar, from the past only', () => {
  const path = Array.from({ length: 700 }, (_, i) => (i < 350 ? 100 + i * 0.4 : 240 - (i - 350) * 0.4) + wig(i))
  const b = bars(path)
  const ser = regimeSeries(b)
  // Each bar's regime equals regimeOf on the bars up to it (no 1h): no look-ahead.
  for (const k of [300, 349, 420, 699]) assert.equal(ser.get(b[k].t), regimeOf(tfState(b.slice(0, k + 1), H4), null).regime, 'bar ' + k)
  assert.equal(ser.get(b[100].t), 'uncertain', 'not enough history yet')
  assert.ok([...ser.values()].includes('strong-bull') && [...ser.values()].includes('strong-bear'))
})

test('volumeNote: describes volume behind the move', () => {
  const st = tfState(bars(Array.from({ length: 400 }, (_, i) => 100 + i * 0.5 + wig(i))), H4)!
  assert.equal(volumeNote(st), 'normal')
  assert.equal(volumeNote({ ...st, volTrend: 1.5 }), 'confirming')
  assert.equal(volumeNote({ ...st, volTrend: 0.5 }), 'fading')
  assert.equal(volumeNote(null), null)
})
