// Learning from every trade: online calibration, shadow-trade resolution,
// champion/challenger selection, and the metrics written for the site.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/db.ts'
import type { Bar } from '../src/bot/features.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'
import type { Model } from '../src/bot/walkforward.ts'
import {
  CAL_PRIOR,
  buildMetrics,
  calibrate,
  ece,
  equityDrawdown,
  perfMetrics,
  regimeOf,
  resolveShadow,
  scoreModel,
  selectChampion,
  updateCalibration,
  winLabel,
} from '../src/bot/learning.ts'
import type { Calib, EvalRow } from '../src/bot/learning.ts'
import { BotStore } from '../src/bot/store.ts'

const costs = DEFAULT_WF.costs

// ---- calibration ----

test('calibration: identity until it has learned anything', () => {
  for (const p of [0.1, 0.4, 0.73]) assert.ok(Math.abs(calibrate(p, CAL_PRIOR) - p) < 1e-9)
  assert.equal(calibrate(0.3, null), 0.3)
})

test('calibration learns an over-pessimistic model upward and an over-optimistic one downward', () => {
  // The model says 40%, but 70% of these trades win.
  let up: Calib = { ...CAL_PRIOR }
  for (let i = 0; i < 400; i++) up = updateCalibration(up, 0.4, i % 10 < 7 ? 1 : 0)
  const pUp = calibrate(0.4, up)
  assert.ok(pUp > 0.6 && pUp < 0.8, 'calibrated ' + pUp)
  assert.equal(up.n, 400)
  assert.equal(up.wins, 280)
  // The model says 60%, but only 20% win.
  let down: Calib = { ...CAL_PRIOR }
  for (let i = 0; i < 400; i++) down = updateCalibration(down, 0.6, i % 5 === 0 ? 1 : 0)
  const pDown = calibrate(0.6, down)
  assert.ok(pDown > 0.1 && pDown < 0.32, 'calibrated ' + pDown)
  // Still monotone: a higher raw probability stays higher.
  assert.ok(calibrate(0.7, down) > calibrate(0.5, down))
})

test('calibration: each trade moves it one step, and the parameters stay bounded', () => {
  const one = updateCalibration(CAL_PRIOR, 0.5, 1)
  assert.ok(one.a > 0 && one.n === 1)
  assert.ok(calibrate(0.5, one) > 0.5)
  let c: Calib = { ...CAL_PRIOR }
  for (let i = 0; i < 5000; i++) c = updateCalibration(c, 0.999, 0)
  assert.ok(c.a >= -4 && c.b >= 0.05 && isFinite(calibrate(0.5, c)))
  assert.deepEqual(updateCalibration(CAL_PRIOR, NaN, 1), CAL_PRIOR, 'no probability → no update')
})

test('labels and regimes', () => {
  assert.equal(winLabel('tp', 2), 1)
  assert.equal(winLabel('sl', -1), 0)
  assert.equal(winLabel('time', 0.3), 1)
  assert.equal(winLabel('time', -0.1), 0)
  assert.equal(regimeOf({ ema20_vs_50_atr: 0.4, atr_rank_200: 0.9 }), 'up-hi')
  assert.equal(regimeOf({ ema20_vs_50_atr: -0.4, atr_rank_200: 0.1 }), 'down-lo')
  assert.equal(regimeOf({ ema20_vs_50_atr: -0.4, atr_rank_200: 0.5 }), 'down-mid')
})

test('calibration persists in the database (survives restarts and retrains)', async () => {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '005_bot_learning.sql', '006_bot_journal.sql', '006_bot_journal.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8')) // 005 and 006 twice: idempotent
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  const store = new BotStore({ query: q } as unknown as Db)
  assert.deepEqual(await store.calibration('BTCUSDT', 1, 'up-hi'), CAL_PRIOR)
  const c = updateCalibration(updateCalibration(CAL_PRIOR, 0.4, 1), 0.4, 1)
  await store.saveCalibration('BTCUSDT', 1, 'up-hi', c)
  const fresh = new BotStore({ query: q } as unknown as Db)
  const back = await fresh.calibration('BTCUSDT', 1, 'up-hi')
  assert.ok(Math.abs(back.a - c.a) < 1e-12 && Math.abs(back.b - c.b) < 1e-12 && back.n === 2 && back.wins === 2)
  assert.deepEqual(await fresh.calibration('BTCUSDT', -1, 'up-hi'), CAL_PRIOR, 'keyed by side')
})

// ---- shadow trades ----

const STEP = 300_000
const flat = (t: number, mod: Partial<Bar> = {}): Bar => ({ t, o: 100, h: 100.5, l: 99.5, c: 100, v: 1, tb: 0.5, ...mod })
const series = (mods: Array<Partial<Bar>>) => [flat(0), ...mods.map((m, i) => flat((i + 1) * STEP, m))]
// Long from 100, stop 98, target 104 (2R), 5-bar horizon, decided on bar t=0.
const LONG = { side: 1 as const, entry: 100, sl: 98, tp: 104, barTime: 0, horizon: 5 }

test('shadow: target first → +2R before costs, net of estimated costs', () => {
  const r = resolveShadow(LONG, series([{}, { h: 104.2 }, {}]), STEP, costs)!
  assert.equal(r.status, 'closed')
  if (r.status !== 'closed') return
  assert.equal(r.exit, 'tp')
  assert.equal(r.rGross, 2)
  assert.ok(Math.abs(r.rNet - (2 - 0.045)) < 1e-9, 'net ' + r.rNet) // (0.0007 + 0.0002) × 100 / 2
  assert.equal(r.closedAt, 3 * STEP, 'at the close of the bar that hit it')
})

test('shadow: stop first, and a bar touching both counts as the stop', () => {
  const s = resolveShadow(LONG, series([{ l: 97.9 }, { h: 105 }]), STEP, costs)!
  assert.equal(s.status === 'closed' && s.exit, 'sl')
  assert.equal(s.status === 'closed' && s.rGross, -1)
  const both = resolveShadow(LONG, series([{ l: 97.5, h: 104.5 }]), STEP, costs)!
  assert.equal(both.status === 'closed' && both.exit, 'sl')
  // A short is the mirror image.
  const short = resolveShadow({ ...LONG, side: -1, sl: 102, tp: 96 }, series([{ l: 95.9 }]), STEP, costs)!
  assert.equal(short.status === 'closed' && short.exit, 'tp')
  assert.equal(short.status === 'closed' && short.rGross, 2)
})

test('shadow: time exit at the horizon close; undecided before it', () => {
  assert.equal(resolveShadow(LONG, series([{}, {}, {}]), STEP, costs), null, 'only 3 of 5 bars: pending')
  assert.equal(resolveShadow(LONG, [flat(0)], STEP, costs), null)
  const t = resolveShadow(LONG, series([{}, {}, {}, {}, { c: 101 }, { h: 110 }]), STEP, costs)!
  assert.equal(t.status === 'closed' && t.exit, 'time')
  assert.equal(t.status === 'closed' && t.rGross, 0.5)
})

test('shadow: expired when the bars after the decision are missing', () => {
  const late = [flat(10 * STEP), flat(11 * STEP)]
  assert.equal(resolveShadow(LONG, late, STEP, costs)?.status, 'expired')
})

// ---- champion / challenger ----

/** A one-input model: P(long) = σ(k·tanh(5x)), P(short) the mirror; k = 0 is a coin flip. */
function toy(k: number): Model {
  const side = (s: number) => ({
    w: { nIn: 1, nHidden: 1, w1: [5], b1: [0], w2: [s * k], b2: 0 },
    scaler: { mean: [0], std: [1] },
    winR: 2,
    lossR: 1,
  })
  return { long: side(1), short: side(-1), features: ['x'], cfg: DEFAULT_WF, trainedFrom: 0, trainedTo: 0 }
}

/** x > 0: longs win (+2R), shorts lose; x < 0 the reverse. */
function rows(n: number): EvalRow[] {
  return Array.from({ length: n }, (_, i) => {
    const up = i % 2 === 0
    return {
      x: [up ? 1 : -1],
      knownAt: i,
      winCost: 0.05,
      lossCost: 0.1,
      outcomes: [
        { side: 1 as const, rGross: up ? 2 : -1, rNet: up ? 1.95 : -1.1 },
        { side: -1 as const, rGross: up ? -1 : 2, rNet: up ? -1.1 : 1.95 },
      ],
    }
  })
}

test('scoring on the held-out slice: log loss and expectancy of the trades it would take', () => {
  const good = scoreModel(toy(3), rows(40))
  const coin = scoreModel(toy(0), rows(40))
  assert.equal(good.n, 80)
  assert.ok(good.logLoss < 0.1, 'good log loss ' + good.logLoss)
  assert.ok(Math.abs(coin.logLoss - Math.log(2)) < 1e-9, 'coin flip log loss is ln 2')
  assert.equal(good.trades, 40)
  assert.ok(Math.abs(good.expectancyR - 1.95) < 1e-9)
  assert.equal(good.winRate, 1)
  // The coin flip's EV is 0.5×1.95 − 0.5×1.1 > 0, so it trades — always long — and breaks even-ish.
  assert.ok(coin.expectancyR < good.expectancyR)
})

test('champion/challenger: the challenger must win on log loss AND expectancy', () => {
  const good = scoreModel(toy(3), rows(40))
  const coin = scoreModel(toy(0), rows(40))
  assert.deepEqual(selectChampion(null, coin), { promote: true, reason: 'no champion yet' })
  assert.equal(selectChampion(coin, good).promote, true, 'better on both → promoted')
  assert.equal(selectChampion(good, coin).promote, false, 'worse → the champion stays')
  // Lower log loss but worse expectancy: not enough.
  assert.equal(selectChampion({ ...good, logLoss: 0.5 }, { ...good, logLoss: 0.4, expectancyR: good.expectancyR - 0.1 }).promote, false)
  // A tie on log loss (within the margin) keeps the champion.
  assert.equal(selectChampion(good, { ...good, logLoss: good.logLoss - 0.0005 }).promote, false)
  // Too few held-out outcomes: no verdict, the champion stays.
  const tiny = scoreModel(toy(3), rows(5))
  assert.equal(tiny.n, 10)
  const v = selectChampion(coin, tiny)
  assert.equal(v.promote, false)
  assert.match(v.reason, /too small/)
})

// ---- metrics ----

test('performance metrics and calibration error', () => {
  const p = perfMetrics([2, -1, -1, 2, -1], 2)
  assert.equal(p.trades, 5)
  assert.equal(p.winRate, 0.4)
  assert.ok(Math.abs(p.expectancyR - 0.2) < 1e-9)
  assert.equal(p.profitFactor, 4 / 3)
  assert.equal(p.maxDrawdownR, 2) // 2 → 0
  assert.equal(p.tradesPerDay, 2.5)
  assert.equal(perfMetrics([1, 1], 1).profitFactor, null, 'no losses → no ratio (JSON-safe)')
  assert.equal(ece([]), null)
  assert.ok(Math.abs(ece([{ p: 0.75, y: 1 }, { p: 0.75, y: 0 }])! - 0.25) < 1e-9)
  assert.equal(ece([{ p: 0.25, y: 0 }, { p: 0.25, y: 0 }, { p: 0.25, y: 1 }, { p: 0.25, y: 0 }]), 0)
  assert.ok(Math.abs(equityDrawdown([100, 120, 90, 130]) - 0.25) < 1e-9)
  const m = buildMetrics(
    { real: [{ symbol: 'BTCUSDT', r: 2 }, { symbol: 'ETHUSDT', r: -1 }], shadow: [{ symbol: 'BTCUSDT', r: 1 }], calib: [{ p: 0.6, y: 1 }], equity: [10, 9], models: [] },
    1,
    30,
  )
  assert.equal(m.trades, 2)
  assert.equal(m.shadow.trades, 1)
  assert.deepEqual(Object.keys(m.bySymbol), ['BTCUSDT', 'ETHUSDT'])
  assert.ok(Math.abs(m.maxDrawdownPct - 0.1) < 1e-9)
  assert.ok(m.calibrationError! > 0)
  assert.doesNotThrow(() => JSON.stringify(m))
})
