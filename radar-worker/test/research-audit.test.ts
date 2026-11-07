// The strategy audit's statistics (src/research/audit.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bar } from '../src/bot/features.ts'
import { MIN_DAYS, PROFILES, breakdown, btcRegimes, netR, regimeAt, summarize, verdict } from '../src/research/audit.ts'
import type { AuditTrade, Summary } from '../src/research/audit.ts'

const DAY = 86_400_000
const near = (a: number | null, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≈ ${b}`)

const trade = (o: Partial<AuditTrade> = {}): AuditTrade => ({
  strategy: 'f1', symbol: 'BTCUSDT', side: 1, t: 0, tExit: DAY, entry: 100, exit: 104, dist: 2, r: 2, exitWhy: 'signal', fundLongR: -0.01, regime: 'bull-calm', ...o,
})

test('netR: both legs at the profile cost, funding by side, a model take-profit as maker', () => {
  // Conservative: 0.10% per leg → (0.001 × 100 + 0.001 × 104) / 2 = 0.102R; long pays 0.01R funding.
  near(netR(trade(), PROFILES[1]), 2 - 0.102 - 0.01)
  // A short receives what a long pays.
  near(netR(trade({ side: -1, exit: 96, r: 2 }), PROFILES[1]), 2 - (0.1 + 0.096) / 2 + 0.01)
  // Moderate take-profit: market entry 0.07%, maker exit 0.02%.
  near(netR(trade({ exitWhy: 'tp' }), PROFILES[0]), 2 - (0.0007 * 100 + 0.0002 * 104) / 2 - 0.01)
  // Stress doubles funding.
  near(netR(trade(), PROFILES[2]), 2 - (0.002 * 204) / 2 - 0.02)
})

test('summarize: same-day trades are one cluster; no range with too few days', () => {
  // 10 trading days a month apart, 6 trades a day that all win or all lose together.
  const herd = Array.from({ length: 60 }, (_, i) => ({ t: Math.floor(i / 6) * 31 * DAY + (i % 6) * 3_600_000, r: Math.floor(i / 6) % 2 ? 1.5 : -1 }))
  const s = summarize(herd)
  assert.deepEqual([s.n, s.days, s.eff], [60, 10, 10])
  assert.ok(s.lo! < 0 && s.hi! > 0)
  near(s.mean, 0.25)
  near(s.win, 0.5)
  near(s.pf, 45 / 30)
  assert.equal(summarize(herd.slice(0, 6 * (MIN_DAYS - 1))).lo, null, 'nine days: no range')
  // Independent trades: full count, and a clear edge clears zero.
  const solo = Array.from({ length: 200 }, (_, i) => ({ t: i * DAY, r: i % 5 < 3 ? 1 : -0.5 }))
  const ss = summarize(solo)
  assert.equal(ss.eff, 200)
  assert.ok(ss.lo! > 0 && ss.t! > 5)
  assert.deepEqual(summarize([]).n, 0)
  // A trend that wins for a month then loses for a month: by day it looks independent, by month it is two bets.
  const runs = Array.from({ length: 600 }, (_, i) => ({ t: i * DAY, r: Math.floor(i / 30) % 2 ? -1 : 1.2 }))
  const rs = summarize(runs)
  assert.equal(rs.cluster, 'month')
  assert.ok(rs.eff <= 30, `eff ${rs.eff}`)
  assert.ok(rs.lo! < 0, 'twenty monthly swings prove nothing')
  assert.ok(summarize(runs.map((x, i) => ({ ...x, r: i % 2 ? -1 : 1.2 }))).lo! > 0, 'the same results, unclustered, would look proven')
  // Drawdown in R along time.
  assert.equal(summarize([{ t: 0, r: 1 }, { t: DAY, r: -2 }, { t: 2 * DAY, r: -1 }, { t: 3 * DAY, r: 4 }]).maxDdR, 3)
})

test('breakdown groups by key', () => {
  const b = breakdown([trade({ t: 0 }), trade({ t: DAY, symbol: 'ETHUSDT' }), trade({ t: 2 * DAY })], (x) => x.symbol, (x) => x.r)
  assert.deepEqual(Object.keys(b), ['BTCUSDT', 'ETHUSDT'])
  assert.equal(b.BTCUSDT.n, 2)
})

test('btcRegimes: bull/bear by EMA, calm/volatile vs its own past, no look-ahead', () => {
  const bars: Bar[] = []
  // 1200 calm rising bars, then 300 wild falling ones.
  for (let i = 0; i < 1500; i++) {
    const up = i < 1200
    const c = up ? 100 + i * 0.1 : 220 - (i - 1200) * 0.5
    const w = up ? 0.2 : 5
    bars.push({ t: i * 14_400_000, o: c, h: c + w, l: c - w, c, v: 1 } as Bar)
  }
  const reg = btcRegimes(bars)
  assert.equal(reg.get(bars[100].t), 'unknown', 'before warm-up')
  assert.equal(reg.get(bars[1100].t), 'bull-calm')
  assert.equal(reg.get(bars[1499].t), 'bear-volatile')
  // The same first 1300 bars give the same labels whatever follows.
  const early = btcRegimes(bars.slice(0, 1300))
  for (const i of [950, 1100, 1250, 1299]) assert.equal(early.get(bars[i].t), reg.get(bars[i].t))
  assert.equal(regimeAt(reg, bars[1100].t + 14_400_000, 14_400_000), 'bull-calm', 'the decision bar is the one before entry')
})

test('verdict: retire below zero, keep only when every check passes, otherwise watch', () => {
  const sm = (mean: number, lo: number | null, hi: number | null, n = 500, eff = 300): Summary => ({ n, days: 300, eff, mean, lo, hi, t: null, win: 0.4, pf: 1.2, totalR: mean * n, maxDdR: 10 })
  const years = { '2022': sm(0.2, null, null, 100), '2023': sm(0.1, null, null, 100), '2024': sm(-0.1, null, null, 100) }
  assert.equal(verdict({ conservative: sm(-0.2, -0.3, -0.1), stress: sm(-0.3, -0.4, -0.2), holdout: sm(0.1, null, null, 20, 10), years, neighbours: null }).verdict, 'retire')
  assert.equal(verdict({ conservative: sm(0.1, -0.05, 0.25), stress: sm(0.05, null, null), holdout: sm(-0.4, -0.6, -0.2, 100, 40), years, neighbours: 0.8 }).verdict, 'retire', 'a clearly losing holdout')
  const good = { conservative: sm(0.2, 0.1, 0.3), stress: sm(0.1, 0, 0.2), holdout: sm(0.15, -0.1, 0.4, 60, 30), years, neighbours: 0.8 }
  assert.equal(verdict(good).verdict, 'keep')
  assert.equal(verdict({ ...good, neighbours: 0.4 }).verdict, 'watch', 'an isolated parameter peak')
  assert.equal(verdict({ ...good, stress: sm(-0.01, null, null) }).verdict, 'watch', 'dies under stress costs')
  assert.equal(verdict({ ...good, holdout: sm(-0.05, -0.3, 0.2, 60, 30) }).verdict, 'watch', 'a weak holdout')
  const w = verdict({ ...good, conservative: sm(0.05, -0.02, 0.12) })
  assert.equal(w.verdict, 'watch')
  assert.ok(w.why.some((x) => x.startsWith('✗ whole history')))
})
