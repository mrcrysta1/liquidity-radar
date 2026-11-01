// Trade journal figures (src/bot/journal.ts) and the shadow path that records them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { barsBetween, barsHeld, excursion, slippageBps } from '../src/bot/journal.ts'
import { resolveShadow } from '../src/bot/learning.ts'
import { BotStore } from '../src/bot/store.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'

const STEP = 300_000
const flat = (t: number, mod: Partial<Bar> = {}): Bar => ({ t, o: 100, h: 100.5, l: 99.5, c: 100, v: 1, tb: 0.5, ...mod })
const series = (mods: Array<Partial<Bar>>) => [flat(0), ...mods.map((m, i) => flat((i + 1) * STEP, m))]
// Long from 100, stop 98, target 104 (2R), 5-bar horizon, decided on bar t=0.
const LONG = { side: 1 as const, entry: 100, sl: 98, tp: 104, barTime: 0, horizon: 5 }
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

test('excursion: worst and best unrealised R, wicks capped at the stop and the target', () => {
  const ex = excursion(LONG, [flat(0, { l: 99, h: 101 }), flat(STEP, { l: 97, h: 106 })])!
  assert.ok(near(ex.maeR, -1) && near(ex.mfeR, 2), JSON.stringify(ex))
  // Prices seen directly count as they are: a stop filled through its trigger.
  assert.ok(near(excursion(LONG, [], [97.8])!.maeR, -1.1))
  // Never above 0 adverse or below 0 favourable.
  const up = excursion(LONG, [flat(0, { l: 100.5, h: 101 })])!
  assert.ok(near(up.maeR, 0) && near(up.mfeR, 0.5))
  // A short is the mirror image.
  const sh = excursion({ side: -1, entry: 100, sl: 102, tp: 96 }, [flat(0, { l: 99, h: 101 })])!
  assert.ok(near(sh.maeR, -0.5) && near(sh.mfeR, 0.5))
  assert.equal(excursion({ ...LONG, sl: 100 }, []), null, 'no stop distance')
})

test('bars held, bars in the window, slippage', () => {
  assert.equal(barsHeld(1000, 1000 + 3 * STEP, STEP), 3)
  assert.equal(barsHeld(1000, 1000 + 1, STEP), 1, 'part of a bar counts')
  assert.equal(barsHeld(1000, 900, STEP), 0)
  const b = series([{}, {}, {}, {}])
  assert.deepEqual(barsBetween(b, STEP + 10, 3 * STEP + 10, STEP).map((x) => x.t), [STEP, 2 * STEP, 3 * STEP])
  assert.ok(near(slippageBps(1, 100, 100.1)!, 10), 'bought higher: worse')
  assert.ok(near(slippageBps(-1, 100, 100.1)!, -10), 'sold higher: better')
  assert.equal(slippageBps(1, 0, 100), null)
})

test('shadow resolution records MAE / MFE and bars held', () => {
  const tp = resolveShadow(LONG, series([{ l: 99 }, { h: 103 }, { h: 104.2 }]), STEP, DEFAULT_WF.costs)!
  assert.ok(tp.status === 'closed')
  if (tp.status !== 'closed') return
  assert.equal(tp.exit, 'tp')
  assert.equal(tp.bars, 3)
  assert.ok(near(tp.maeR, -0.5) && near(tp.mfeR, 2), JSON.stringify(tp))
  // Stop: the stop bar's own up-wick is left out (which came first is unknown).
  const sl = resolveShadow(LONG, series([{ h: 101 }, { l: 97.5, h: 104.5 }]), STEP, DEFAULT_WF.costs)!
  assert.ok(sl.status === 'closed' && sl.exit === 'sl' && sl.bars === 2)
  if (sl.status !== 'closed') return
  assert.ok(near(sl.maeR, -1) && near(sl.mfeR, 0.5), JSON.stringify(sl))
  const time = resolveShadow(LONG, series([{}, {}, {}, {}, { c: 101 }]), STEP, DEFAULT_WF.costs)!
  assert.ok(time.status === 'closed' && time.exit === 'time' && time.bars === 5)
})

test('journal columns are written for shadow trades and readable by anon', async () => {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  const store = new BotStore({ query: q } as unknown as Db)
  const id = await store.insertShadow({
    symbol: 'BTCUSDT', modelId: null as unknown as number, side: 1, barTime: 0, entry: 100, sl: 98, tp: 104, atr: 1, horizon: 5,
    pRaw: 0.4, pCal: 0.45, evR: 0.05, costR: 0.05, rrNet: 1.9, regime: 'up-mid', rejectReason: 'EV below the bar', features: { a: 1 },
    journal: { interval: '4h', modelVersion: 7, decision: 'P(long) 45%' },
  })
  await store.closeShadow(id, { status: 'closed', closedAt: 3 * STEP, exit: 104, reason: 'tp', rGross: 2, rNet: 1.95, maeR: -0.5, mfeR: 2, barsHeld: 3 })
  const row = (await pg.query<Record<string, unknown>>('select * from bot_shadow_trades')).rows[0]
  assert.equal(row.interval, '4h')
  assert.equal(row.model_version, 7)
  assert.equal(row.decision, 'P(long) 45%')
  assert.equal(row.mae_r, -0.5)
  assert.equal(row.mfe_r, 2)
  assert.equal(row.bars_held, 3)
  const pol = (await pg.query<{ tablename: string }>("select tablename from pg_policies where policyname = 'public read' and 'anon' = any(roles)")).rows
  assert.ok(['bot_trades', 'bot_shadow_trades'].every((t) => pol.some((p) => p.tablename === t)), 'anon can read both journals')
})
