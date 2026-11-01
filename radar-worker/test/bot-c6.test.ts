// Strategy C6 (src/bot/c6.ts): the GBDT and FEATURES_V2 code it brings in,
// F1's candidate bars, and parity with the research (meta2.ts): on a fixture,
// the live path's take / skip decisions equal a port of the research logic
// given the same training set.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONTEXT_FEATURES, FEATURES_V2, WARMUP, contextSeries, featureAtV2, indicators } from '../src/bot/features.ts'
import type { Bar } from '../src/bot/features.ts'
import { fitGbdt, gbdtProb } from '../src/bot/models/gbdt.ts'
import { C6, c6Decide, c6Rows, c6State, f1FlatAt, fitC6, trainC6 } from '../src/bot/c6.ts'
import type { C6Model } from '../src/bot/c6.ts'
import type { Funding } from '../src/bot/data.ts'
import { trendBacktest, trendIndicators, trendSignal } from '../src/bot/strategy.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'
import { C6_STRATEGY, F1_STRATEGY, STRATEGIES, parseStrategies, ruleBacktest } from '../src/bot/strategies.ts'
import type { BotStore } from '../src/bot/store.ts'

const STEP = 14_400_000
const COSTS = DEFAULT_WF.costs

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

function walk(n: number, seed = 3, t0 = 0, step = 3_600_000): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const c = o * (1 + (r() - 0.5) * 0.02)
    const h = Math.max(o, c) * (1 + r() * 0.004)
    const l = Math.min(o, c) * (1 - r() * 0.004)
    const v = 100 + r() * 50
    out.push({ t: t0 + i * step, o, h, l, c, v, tb: v * r() })
    p = c
  }
  return out
}

/**
 * Trending random walk with regime changes, crashes and gaps (F1 trades of
 * every kind). The taker-buy share leans with the regime's drift, so F1's
 * outcomes are partly predictable from the features (the model has something to learn).
 */
function market(n: number, seed: number, t0: number): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) drift = (r() - 0.45) * 0.01
    const o = p
    const c = o * (r() < 0.003 ? 0.9 : 1 + drift + (r() - 0.5) * 0.025)
    const o2 = r() < 0.03 ? o * (1 + (r() - 0.5) * 0.06) : o
    const v = 100 + r() * 100
    out.push({ t: t0 + i * STEP, o: o2, h: Math.max(o2, c) * (1 + r() * 0.01), l: Math.min(o2, c) * (1 - r() * 0.01), c, v, tb: v * Math.min(0.95, Math.max(0.05, 0.5 + 60 * drift + (r() - 0.5) * 0.3)) })
    p = c
  }
  return out
}

/** Funding every 8 h from `from` (none before it: the research's default rate applies there). */
function funding(seed: number, from: number, to: number): Funding[] {
  const r = rng(seed)
  const out: Funding[] = []
  for (let t = from; t <= to; t += 8 * 3_600_000) out.push({ t, rate: (r() - 0.3) * 4e-4 })
  return out
}

// ---- the model code ----

test('gbdt fits a known non-linear function', () => {
  const r = rng(5)
  const X: number[][] = []
  const y: number[] = []
  for (let i = 0; i < 4000; i++) {
    const x = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]
    X.push(x)
    y.push((x[0] > 0.2 && x[1] < 0.3) || x[0] < -0.6 ? 1 : 0)
  }
  const m = fitGbdt(X.slice(0, 3000), y.slice(0, 3000), { trees: 300, lr: 0.2, maxDepth: 3, minLeaf: 5, lambda: 1, rowFrac: 1, colFrac: 1 })
  const held = X.slice(3000)
  const acc = held.filter((x, i) => (gbdtProb(m, x) > 0.5 ? 1 : 0) === y[3000 + i]).length / held.length
  assert.ok(acc > 0.95, 'held-out accuracy ' + acc)
  const used = new Set(m.trees.flatMap((t) => t.feat.filter((f) => f >= 0)))
  assert.ok(used.has(0) && used.has(1))
})

test('gbdt with seed 7 (C6 defaults) is deterministic, seed-dependent and round-trips through JSON', () => {
  const r = rng(8)
  const X = Array.from({ length: 800 }, () => [r(), r(), r()])
  const y = X.map((x) => (x[0] + 0.3 * r() > 0.6 ? 1 : 0))
  const a = fitGbdt(X, y, { seed: C6.seed })
  assert.deepEqual(fitGbdt(X, y, { seed: 7 }), a)
  assert.notDeepEqual(fitGbdt(X, y, { seed: 8 }), a, 'row / column sampling follows the seed')
  const c = JSON.parse(JSON.stringify(a))
  assert.equal(gbdtProb(c, [0.9, 0.1, 0.1]), gbdtProb(a, [0.9, 0.1, 0.1]))
  assert.ok(gbdtProb(a, [0.95, 0.5, 0.5]) > gbdtProb(a, [0.05, 0.5, 0.5]), 'learns the signal in x[0]')
})

test('v2 features never look ahead (bars or context)', () => {
  const step = 4 * 3_600_000
  const b = walk(700, 4, 1_700_000_000_000, step)
  const btc = walk(720, 9, 1_700_000_000_000 - 10 * step, step)
  const fund = Array.from({ length: 300 }, (_, k) => ({ t: 1_700_000_000_000 + k * 8 * 3_600_000, rate: Math.sin(k) * 1e-4 }))
  const full = contextSeries(b, indicators(b), { btc, funding: fund, stepMs: step })
  const cut = b.slice(0, 450)
  const indCut = indicators(cut)
  const part = contextSeries(cut, indCut, { btc, funding: fund, stepMs: step })
  const T = cut[cut.length - 1].t + step
  const part2 = contextSeries(cut, indCut, { btc: btc.filter((x) => x.t + step <= T), funding: fund.filter((x) => x.t <= T), stepMs: step })
  const indFull = indicators(b)
  for (const i of [WARMUP, 300, 449]) {
    const want = featureAtV2(b, indFull, full, i)
    assert.ok(want && want.length === FEATURES_V2.length && want.every((v) => isFinite(v)))
    assert.deepEqual(featureAtV2(cut, indCut, part, i), want, 'bar ' + i)
    assert.deepEqual(featureAtV2(cut, indCut, part2, i), want, 'bar ' + i + ' (cut context)')
  }
  const col = (name: string) => CONTEXT_FEATURES.indexOf(name as (typeof CONTEXT_FEATURES)[number])
  const rows = full.rows.filter((x) => x) as number[][]
  assert.ok(rows.some((x) => x[col('btc_ret_6_z')] !== 0))
  assert.ok(rows.some((x) => x[col('funding_bps')] !== 0))
})

// ---- the strategy plugin ----

test('C6 is F1 with its own id, bands and the BTC reference; listed between f1 and c2', () => {
  assert.equal(STRATEGIES.c6, C6_STRATEGY)
  assert.equal(C6_STRATEGY.manage, F1_STRATEGY.manage, 'exits identical to F1')
  assert.equal(C6_STRATEGY.signal, F1_STRATEGY.signal)
  assert.deepEqual(C6_STRATEGY.health, { expR: 0.12, roll30P5: -0.32, roll30P1: -0.45, ddP95: 21.4, ddP99: 26.7 })
  assert.deepEqual(C6_STRATEGY.refs, ['BTCUSDT'])
  const b = market(1500, 11, 0)
  assert.deepEqual(ruleBacktest(C6_STRATEGY, b), ruleBacktest(F1_STRATEGY, b), 'the raw signals are F1 (the gate is live only)')
  assert.match(C6_STRATEGY.describe(b, 1200), /^C6 \(F1 entry\): close/)
  const slots = parseStrategies('f1:live@*;c6:shadow@*;c2:shadow@*;ml:shadow@BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT')!
  assert.deepEqual(
    slots.map((s) => s.id + ':' + s.state),
    ['f1:live', 'c6:shadow', 'c2:shadow', 'ml:shadow'],
  )
})

test('f1FlatAt + an F1 signal marks exactly the signal bars of the F1 trade sequence', () => {
  for (const seed of [1, 2, 3, 4]) {
    const b = market(5000, seed, 0)
    const ind = trendIndicators(b)
    const trades = trendBacktest(b)
    assert.ok(trades.length > 6, 'enough trades: ' + trades.length)
    const last = trades[trades.length - 1].i
    const want = trades.map((t) => t.i)
    const got: number[] = []
    for (let i = 0; i <= last; i++) if (trendSignal(b, ind, i) && f1FlatAt(b, i)) got.push(i)
    assert.deepEqual(got, want, 'seed ' + seed)
    // Live, the window ends at the signal bar: the same answer.
    for (const i of want.slice(-5)) assert.equal(f1FlatAt(b.slice(0, i + 1), i), true)
    // A bar inside a trade is not a candidate.
    const inside = trades.find((t) => t.exitBar > t.i + 2)!
    assert.equal(f1FlatAt(b.slice(0, inside.i + 3), inside.i + 2), false)
  }
})

// ---- parity with the research (rd2/meta2.ts on rd/lib.ts genTrades) ----

interface RefTrade {
  sym: string
  i: number
  tEntry: number
  tExit: number
  r: number
}

/** rd/lib.ts genTrades for F1 (makeSig mtf a=50 b=20, sl 3, trail 4, long, fresh, from 2018), net of costs and funding. */
function refF1(sym: string, b: Bar[], fund: Funding[]): RefTrade[] {
  const TAKER = 0.0005 + 0.0002
  const DEFAULT_FUND = 0.0001
  const from = Date.UTC(2018, 0, 1)
  const c = b.map((x) => x.c)
  const atr: number[] = []
  for (let i = 0; i < b.length; i++) {
    const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l
    atr.push(i < 14 ? (i ? (atr[i - 1] * i + tr) / (i + 1) : tr) : (atr[i - 1] * 13 + tr) / 14)
  }
  const a = 2 / 301
  const E: number[] = []
  c.forEach((v, i) => E.push(i ? v * a + E[i - 1] * (1 - a) : v))
  const donch = (n: number, hi: boolean) =>
    b.map((_, i) => {
      if (i < n) return NaN
      let m = hi ? -Infinity : Infinity
      for (let j = i - n; j < i; j++) m = hi ? Math.max(m, b[j].h) : Math.min(m, b[j].l)
      return m
    })
  const H = donch(20, true)
  const L = donch(20, false)
  const xl = donch(10, false)
  const trd = (i: number) => (c[i] > E[i] ? 1 : -1)
  const entry = (i: number) => (trd(i) > 0 && c[i] > H[i] ? 1 : trd(i) < 0 && c[i] < L[i] ? -1 : 0)
  const keep = (i: number) => trd(i) === 1 && c[i] >= xl[i]
  const f = [...fund].sort((x, z) => x.t - z.t)
  const fundingR = (t0: number, t1: number, e: number, dist: number) => {
    let lo = 0
    let hi = f.length
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (f[m].t <= t0) lo = m + 1
      else hi = m
    }
    let s = 0
    for (let k = lo; k < f.length && f[k].t <= t1; k++) s += f[k].rate
    const first = f.length ? f[0].t : Infinity
    if (t0 < first) s += (DEFAULT_FUND * Math.max(0, Math.min(t1, first) - t0)) / (8 * 3_600_000)
    return (-s * e) / dist
  }
  const out: RefTrade[] = []
  for (let i = 900; i < b.length - 1; i++) {
    if (entry(i) <= 0) continue
    if (b[i + 1].t < from) continue
    const e = b[i + 1].o
    const dist = 3 * atr[i]
    if (!(dist > 0)) continue
    let stop = e - dist
    let ext = -Infinity
    let px = NaN
    let tExit = 0
    let exitBar = 0
    let why = ''
    for (let j = i + 1; j < b.length; j++) {
      const op = j === i + 1 ? e : b[j].o
      if (b[j].l <= stop) {
        px = Math.min(op, stop)
        why = 'stop'
        exitBar = j
        tExit = b[j].t + STEP
        break
      }
      if (j + 1 >= b.length) break
      if (!keep(j)) {
        px = b[j + 1].o
        why = 'signal'
        exitBar = j
        tExit = b[j + 1].t
        break
      }
      ext = Math.max(ext, b[j].h)
      stop = Math.max(stop, ext - 4 * atr[j])
    }
    if (!why) break
    const r = (px - e) / dist - (TAKER * e) / dist - (TAKER * px) / dist + fundingR(b[i + 1].t, tExit, e, dist)
    out.push({ sym, i, tEntry: b[i + 1].t, tExit, r })
    i = exitBar - 1
  }
  return out
}

/** meta2.ts metaF1 for one window [T0, T0 + 182 d): train on pool trades closed >= 7 d before T0, take test trades with p >= base. */
function refMeta(pool: RefTrade[], test: RefTrade[], T0: number, feat: (t: RefTrade) => number[] | null) {
  const X = new Map<RefTrade, number[]>()
  for (const t of [...pool, ...test]) if (!X.has(t)) { const x = feat(t); if (x) X.set(t, x) }
  const tr = pool.filter((t) => t.tExit < T0 - 7 * 86400000 && X.has(t))
  const te = test.filter((t) => t.tEntry >= T0 && t.tEntry < T0 + 182 * 86400000 && X.has(t))
  const ys = tr.map((t) => (t.r > 0 ? 1 : 0))
  const base = ys.reduce((a: number, v) => a + v, 0) / ys.length
  const m = fitGbdt(tr.map((t) => X.get(t)!), ys, { seed: 7 })
  return { m, base, te, taken: te.filter((t) => gbdtProb(m, X.get(t)!) >= base) }
}

test('parity: the live C6 (training set, model, take / skip bar by bar) equals the research logic', async () => {
  // BTC from 2017-09; the alts list later (BTC context starts mid-history for them); funding from 2019-09.
  const t0 = Date.UTC(2017, 8, 1)
  const N = 8000
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AAVEUSDT', 'ADAUSDT', 'ARBUSDT', 'AVAXUSDT']
  const data = new Map<string, { b: Bar[]; f: Funding[] }>()
  syms.forEach((s, k) => {
    const all = market(N, 101 + k * 17, t0)
    const b = all.slice(k * 100)
    const f = funding(7 + k, Date.UTC(2019, 8, 10), b[b.length - 1].t + STEP)
    data.set(s, { b, f })
  })
  const btc = data.get('BTCUSDT')!.b
  // One retrain point with plenty of trades before and a window of trades after.
  const T0 = Date.UTC(2020, 6, 1)

  // Research: pool in universe order, features over each market's whole history.
  const pool = syms.flatMap((s) => refF1(s, data.get(s)!.b, data.get(s)!.f))
  const feats = new Map<string, (i: number) => number[] | null>()
  for (const s of syms) {
    const { b, f } = data.get(s)!
    const ind = indicators(b)
    const cs = contextSeries(b, ind, { btc: s === 'BTCUSDT' ? undefined : btc, funding: f, stepMs: STEP })
    feats.set(s, (i) => featureAtV2(b, ind, cs, i))
  }
  const ref = refMeta(pool, pool, T0, (t) => feats.get(t.sym)!(t.i))
  assert.ok(ref.te.length >= 20, 'test candidates: ' + ref.te.length)
  assert.ok(ref.taken.length > 0 && ref.taken.length < ref.te.length, `the model takes some, not all: ${ref.taken.length}/${ref.te.length}`)

  // Live: the training rows (whole history per market, BOT_SYMBOLS order) and the model.
  const rows = syms.flatMap((s) => c6Rows(s, data.get(s)!.b, data.get(s)!.f, btc, COSTS, STEP))
  assert.equal(rows.length, pool.length)
  rows.forEach((r, k) => {
    const p = pool[k]
    assert.deepEqual([r.sym, r.i, r.tEntry, r.tExit], [p.sym, p.i, p.tEntry, p.tExit])
    assert.ok(Math.abs(r.r - p.r) < 1e-9, `net R ${r.r} vs ${p.r}`)
  })
  const m = fitC6(rows, T0, syms)!
  assert.ok(m)
  assert.equal(m.base, ref.base)
  assert.deepEqual(m.gbdt, ref.m, 'the same model')

  // Live decisions, bar by bar: every closed bar of the window, each market's bars up to it, BTC's up to it.
  c6State.reset()
  c6State.loaded = true
  c6State.model = m
  c6State.funding = async (s, a, z) => data.get(s)!.f.filter((x) => x.t >= a && x.t <= (z ?? Infinity))
  const store = {} as BotStore
  const live: string[] = []
  const candidates: string[] = []
  try {
    for (const s of syms) {
      const { b } = data.get(s)!
      for (let i = 900; i < b.length - 1; i++) {
        if (b[i + 1].t < T0 || b[i + 1].t >= T0 + 182 * 86400000) continue
        const w = b.slice(0, i + 1)
        if (!trendSignal(w, trendIndicators(w), i)) continue
        const d = await c6Decide(store, s, w, i, btc.filter((x) => x.t <= b[i].t), STEP)
        if (d.quiet) continue
        candidates.push(s + ':' + i)
        if (d.take) live.push(s + ':' + i)
      }
    }
  } finally {
    c6State.reset()
  }
  assert.deepEqual(candidates, ref.te.map((t) => t.sym + ':' + t.i), 'the same candidates')
  assert.deepEqual(live, ref.taken.map((t) => t.sym + ':' + t.i), 'the same take / skip decisions')
})

test('trainC6: fetches every market once, trains without funding when the host is out of reach, stores the model', async () => {
  const t0 = Date.UTC(2017, 8, 1)
  const SYMS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'AAVEUSDT', 'ADAUSDT', 'ARBUSDT']
  const hist = new Map(SYMS.map((s, k) => [s, market(6000, 300 + k, t0)]))
  const asked: string[] = []
  const state = new Map<string, unknown>()
  const events: string[] = []
  const store = {
    getState: async (k: string, d: unknown) => (state.has(k) ? state.get(k) : d),
    setState: async (k: string, v: unknown) => void state.set(k, JSON.parse(JSON.stringify(v))),
    event: async (_l: string, _s: string | null, msg: string) => void events.push(msg),
  } as unknown as BotStore
  c6State.reset()
  c6State.bars = async (s, _i, n) => (asked.push(s + ':' + n), hist.get(s)!)
  let fundingCalls = 0
  c6State.funding = async () => {
    fundingCalls++
    throw new Error('HTTP 451')
  }
  const heavy = { at: 0 }
  try {
    const now = hist.get('BTCUSDT')!.at(-1)!.t + STEP
    const m = (await trainC6(store, SYMS, { costs: COSTS, interval: '4h', stepMs: STEP, heavy, now }))!
    assert.ok(m, events.join(' | '))
    assert.deepEqual(asked, SYMS.map((s) => s + ':' + C6.historyBars), 'BTC once, then each market')
    assert.equal(fundingCalls, 1, 'one failure: no more funding requests')
    assert.deepEqual(m.funding, [])
    assert.ok(heavy.at > 0, 'the heavy-job clock is kept fresh')
    assert.equal(m.createdAt, now)
    assert.ok(m.n >= C6.minRows)
    assert.deepEqual(state.get(C6.stateKey), JSON.parse(JSON.stringify(m)))
    assert.ok(events.some((e) => /funding history unavailable/.test(e)))
    assert.ok(events.some((e) => /^c6: model trained on \d+ F1 trades of 7 markets/.test(e)))
    // Deterministic: the same data, the same model.
    const again = (await trainC6(store, SYMS, { costs: COSTS, interval: '4h', stepMs: STEP, now }))!
    assert.deepEqual(again.gbdt, m.gbdt)
  } finally {
    c6State.reset()
  }
})

test('c6Decide: no model, no decision; a stored model is read once', async () => {
  const b = market(2500, 5, Date.UTC(2020, 0, 1))
  const ind = trendIndicators(b)
  const trades = trendBacktest(b)
  const i = trades[trades.length - 1].i
  const w = b.slice(0, i + 1)
  assert.ok(trendSignal(w, ind, i))
  let reads = 0
  const stored: C6Model = { v: 1, createdAt: 0, cutoff: 0, base: 0.4, n: 100, symbols: ['BTCUSDT'], funding: [], nFeatures: FEATURES_V2.length, gbdt: { base: 0, trees: [] } }
  const store = (v: unknown) => ({ getState: async () => (reads++, v) }) as unknown as BotStore
  c6State.reset()
  try {
    const none = await c6Decide(store(null), 'BTCUSDT', w, i, undefined, STEP)
    assert.deepEqual([none.take, none.note], [false, 'no model yet'])
    c6State.reset()
    const d = await c6Decide(store(stored), 'BTCUSDT', w, i, undefined, STEP)
    assert.equal(d.take, true, 'p 0.5 >= base 0.4')
    assert.equal(d.p, 0.5)
    await c6Decide(store(stored), 'BTCUSDT', w, i, undefined, STEP)
    assert.equal(reads, 2, 'read once per process (after the reset)')
    const alt = await c6Decide(store(stored), 'ETHUSDT', w, i, undefined, STEP)
    assert.deepEqual([alt.take, alt.note], [false, 'BTCUSDT bars unavailable'])
    c6State.reset()
    const old = await c6Decide(store({ ...stored, nFeatures: 18 }), 'BTCUSDT', w, i, undefined, STEP)
    assert.equal(old.note, 'no model yet', 'a model for another feature set is not used')
  } finally {
    c6State.reset()
  }
})
