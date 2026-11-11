// The strategy study's exit replays and filter statistics (src/research/study.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Bar } from '../src/bot/features.ts'
import { F1, trendBacktest, trendIndicators } from '../src/bot/strategy.ts'
import { EXIT_VARIANTS, compareFilter, ema, exitNetR, giveback, paired, simulateExit } from '../src/research/study.ts'
import type { ExitVariant } from '../src/research/study.ts'

const DAY = 86_400_000
const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≈ ${b}`)
const fixture: Bar[] = (JSON.parse(readFileSync(new URL('./fixtures/btc-4h.json', import.meta.url), 'utf8')) as number[][]).map(([t, o, h, l, c]) => ({ t, o, h, l, c, v: 0, tb: 0 }))
const v = (id: string): ExitVariant => EXIT_VARIANTS.find((x) => x.id === id)!

test('exit A reproduces F1 exactly (exit bar, price and gross R of every trade)', () => {
  const ind = trendIndicators(fixture)
  const bt = trendBacktest(fixture)
  assert.ok(bt.length >= 10, 'fixture has F1 trades: ' + bt.length)
  for (const t of bt) {
    const x = simulateExit(fixture, ind, t.i, t.entry, t.dist, v('A'))!
    assert.equal(x.exitBar, t.exitBar)
    near(x.legs[0].price, t.exit)
    near(x.grossR, t.r)
    assert.equal(x.why === 'breakeven' ? 'trail' : x.why, t.why)
    assert.ok(x.mfeR >= Math.max(0, x.grossR) - 1e-9 && x.maeR <= Math.min(0, x.grossR) + 1e-9, 'excursions bracket the result')
  }
})

/** 12 flat bars at 100 (lows at 90, so the 10-bar low never decides), the signal on the last, then the given bars (o, h, l, c). */
const SIG = 11
function path(rows: Array<[number, number, number, number]>): { b: Bar[]; ind: ReturnType<typeof trendIndicators> } {
  const flat = Array.from({ length: SIG + 1 }, (_, k) => ({ t: k * 14_400_000, o: 100, h: 100, l: 90, c: 100, v: 0, tb: 0 }))
  const b: Bar[] = [...flat, ...rows.map(([o, h, l, c], k) => ({ t: (SIG + 1 + k) * 14_400_000, o, h, l, c, v: 0, tb: 0 }))]
  // ATR 1 throughout and an EMA far below: only the stops and the 10-bar low decide.
  const ind = { ema: b.map(() => 0), atr: b.map(() => 1) }
  return { b, ind }
}

test('break-even: once 1R up, a fall to the entry closes flat instead of at the stop', () => {
  // 1R = 3. Up to 104 (≥ 1R) then down through the entry.
  const { b, ind } = path([[100, 101, 99.5, 100.5], [100.5, 104, 100.2, 103.5], [103.5, 103.6, 98, 98.5], [98.5, 99, 96, 96.5]])
  const a = simulateExit(b, ind, SIG, 100, 3, v('A'))!
  const c = simulateExit(b, ind, SIG, 100, 3, v('C-be1'))!
  assert.equal(c.why, 'breakeven')
  near(c.grossR, 0)
  // A trails 4 ATR under the 104 high: stopped at 100 as well, but labelled a trail.
  assert.equal(a.why, 'trail')
  near(a.grossR, 0)
  // With a 2R break-even trigger the trade never qualifies: same as A.
  near(simulateExit(b, ind, SIG, 100, 3, v('C-be2'))!.grossR, a.grossR)
})

test('partial: half sold at the target, the rest at the stop; a bar through both counts as the stop', () => {
  const { b, ind } = path([[100, 106.2, 99.5, 105], [105, 105.5, 90, 91]])
  const d = simulateExit(b, ind, SIG, 100, 3, v('D-part2'))!
  assert.equal(d.legs.length, 2)
  near(d.legs[0].price, 106)
  near(d.legs[0].w, 0.5)
  // The trail after the first bar: 106.2 − 4 ATR = 102.2; the next bar opens above it (105) and falls through: filled at 102.2.
  near(d.legs[1].price, 102.2)
  near(d.grossR, 0.5 * 2 + (0.5 * 2.2) / 3)
  const worst = path([[100, 106.5, 96, 100]])
  const w = simulateExit(worst.b, worst.ind, SIG, 100, 3, v('D-part2'))!
  assert.equal(w.why, 'sl')
  assert.equal(w.legs.length, 1, 'stop first: no partial profit in the same bar')
  near(w.grossR, -1)
})

test('trend exit: a close under EMA(n) exits at the next open', () => {
  const { b, ind } = path([[100, 101, 99.8, 100.8], [100.8, 101, 99.9, 100], [99, 99.5, 98.8, 99.2]])
  const e = ema(b, 2)
  const x = simulateExit(b, ind, SIG, 100, 3, { id: 't', kind: 'trend', emaLen: 2 }, e)!
  assert.equal(x.why, 'signal')
  assert.equal(x.exitBar, SIG + 2)
  near(x.legs[0].price, 99)
})

test('net R charges every leg and adds funding', () => {
  const x = { exitBar: 3, why: 'signal' as const, legs: [{ w: 0.5, price: 106 }, { w: 0.5, price: 103 }], grossR: 1.5, mfeR: 2, maeR: -0.1 }
  // leg 0.001: (0.1 + 0.5 × 0.106 + 0.5 × 0.103) / 3
  near(exitNetR(x, 100, 3, 0.001, -0.02), 1.5 - (0.1 + 0.053 + 0.0515) / 3 - 0.02)
})

test('giveback: what winners gave back from their best point', () => {
  const g = giveback([
    { mfeR: 2, grossR: 0.5, netR: 0.4 },
    { mfeR: 1.2, grossR: -0.2, netR: -0.3 },
    { mfeR: 0.3, grossR: -1, netR: -1.1 },
  ])
  assert.deepEqual([g.n, g.reached1R, g.reached1RLost], [3, 2, 1])
  near(g.givebackAfter1R, (1.5 + 1.4) / 2)
  near(g.avgMfeR, 3.5 / 3)
})

test('filters: false positives, missed opportunities, and "helps" only with clear evidence', () => {
  // 40 days; the filter rejects every losing trade → clearly helps.
  const rows = Array.from({ length: 40 }, (_, i) => ({ t: i * DAY, r: i % 2 ? 1 : -1 - (i % 4) * 0.1, keep: i % 2 === 1 }))
  const f = compareFilter(rows)
  assert.deepEqual([f.taken.n, f.rejected.n, f.falsePositives, f.missed, f.helps], [20, 20, 0, 0, true])
  // A coin-flip filter: no evidence.
  const coin = compareFilter(rows.map((x, i) => ({ ...x, keep: i % 4 < 2 })))
  assert.equal(coin.helps, false)
  assert.equal(coin.falsePositives + coin.missed, 20)
})

test('paired: better only when the per-trade difference clears zero', () => {
  const base = Array.from({ length: 60 }, (_, i) => ({ t: i * DAY, r: i % 3 ? 0.5 : -1 }))
  const up = paired(base, base.map((x) => ({ ...x, r: x.r + 0.1 + ((x.t / DAY) % 2) * 0.01 })))
  assert.ok(up.better && !up.worse)
  const same = paired(base, base.map((x, i) => ({ ...x, r: x.r + (i % 2 ? 0.2 : -0.2) })))
  assert.ok(!same.better && !same.worse)
  assert.equal(F1.trailAtr, 4, 'the A baseline is F1 as it trades')
})
