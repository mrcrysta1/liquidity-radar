// F1 filter research helpers (src/research/f1filter.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bar } from '../src/bot/features.ts'
import { f1Inputs, filterReport, halfYears, walkFilter } from '../src/research/f1filter.ts'
import type { FilterRow } from '../src/research/f1filter.ts'

const DAY = 86_400_000

test('halfYears: 1 Jan and 1 Jul between the dates', () => {
  assert.deepEqual(halfYears(Date.UTC(2020, 2, 5), Date.UTC(2021, 6, 1)).map((t) => new Date(t).toISOString().slice(0, 10)), ['2020-07-01', '2021-01-01', '2021-07-01'])
})

test('walkFilter: a half-year is judged only by trades closed an embargo before it', () => {
  const rows: FilterRow[] = []
  for (let k = 0; k < 400; k++) rows.push({ t: Date.UTC(2020, 0, 1) + k * DAY, tExit: Date.UTC(2020, 0, 1) + (k + 5) * DAY, r: k % 3 ? -1 : 2, x: [k] })
  const starts = halfYears(rows[0].t, rows.at(-1)!.t)
  const seen: number[] = []
  const v = walkFilter(rows, (tr) => (seen.push(Math.max(...tr.map((r) => r.tExit))), () => 1), starts, 7 * DAY, 100)
  // The first half-year has too little history; each later one sees only trades closed ≥ 7 days before it starts.
  const judged = starts.slice(starts.length - seen.length)
  assert.ok(seen.length >= 1)
  seen.forEach((m, k) => assert.ok(m < judged[k] - 7 * DAY, `fit ${k} saw a trade closing too late`))
  for (const [r] of v) assert.ok(r.t >= judged[0])
})

test('walkFilter: takes when the probability reaches the training win rate', () => {
  const rows: FilterRow[] = Array.from({ length: 600 }, (_, k) => ({ t: Date.UTC(2020, 0, 1) + k * DAY, tExit: Date.UTC(2020, 0, 1) + k * DAY, r: k % 2 ? 1 : -1, x: [k % 2] }))
  const v = walkFilter(rows, () => (x) => (x[0] ? 0.9 : 0.1), halfYears(rows[0].t, rows.at(-1)!.t), 0, 100)
  for (const [r, take] of v) assert.equal(take, r.x[0] === 1)
})

test('filterReport: taken vs skipped and return over drawdown', () => {
  const rows = Array.from({ length: 60 }, (_, k) => ({ t: k * DAY, r: k % 2 ? 1 : -0.5, take: k % 2 === 1 }))
  const r = filterReport(rows)
  assert.equal(r.taken.mean, 1)
  assert.equal(r.skipped.mean, -0.5)
  assert.equal(r.takenShare, 0.5)
  assert.equal(r.retDd.taken, null, 'no drawdown')
  assert.ok(r.gap.mean === 1.5)
})

test('f1Inputs: breakout size, distance above EMA(300), past bars only', () => {
  const b: Bar[] = Array.from({ length: 400 }, (_, k) => ({ t: k, o: 100, h: 101, l: 99, c: k === 399 ? 104 : 100, v: 1, tb: 0.5 }))
  const atr = b.map(() => 2)
  const e = b.map(() => 100)
  const x = f1Inputs(b, atr, e, 399)!
  assert.deepEqual(x, [(104 - 101) / 2, (104 - 100) / 2, 0, (101 - 99) / 2])
  assert.equal(f1Inputs(b, atr, e, 100), null)
})
