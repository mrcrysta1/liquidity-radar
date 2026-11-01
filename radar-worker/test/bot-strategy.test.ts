// Strategy F1 (src/bot/strategy.ts) against a copy of the research engine's
// simulation (makeSig 'mtf' + genTrades, gross of costs): the backtest helper
// and a bar-by-bar replay of the live path must produce the same trades.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Bar } from '../src/bot/features.ts'
import { F1, checkTrendSetup, highPrev, noEntryReason, onClose, trailStop, trendBacktest, trendExit, trendIndicators, trendSignal } from '../src/bot/strategy.ts'
import type { TrailState } from '../src/bot/strategy.ts'
import { C2_STRATEGY, F1X, F1X_STRATEGY, F1_STRATEGY, STRATEGIES, resolveRuleShadow, ruleBacktest } from '../src/bot/strategies.ts'
import { DEFAULT_WF } from '../src/bot/walkforward.ts'

/** BTCUSDT 4h, 2023-07-26 .. 2024-05-21, [t, o, h, l, c] (a slice of the research data). */
const fixture: Bar[] = (JSON.parse(readFileSync(new URL('./fixtures/btc-4h.json', import.meta.url), 'utf8')) as number[][]).map(([t, o, h, l, c]) => ({ t, o, h, l, c, v: 0, tb: 0 }))

/** Trending random walk with regime changes, so stops, trails and rule exits all happen. */
function synth(n: number, seed: number): Bar[] {
  let s = seed
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  const out: Bar[] = []
  let p = 100
  let drift = 0
  for (let i = 0; i < n; i++) {
    if (i % 150 === 0) drift = (r() - 0.45) * 0.006
    const o = p
    // Now and then a crash bar, so some trades end at their initial stop.
    const c = o * (r() < 0.015 ? 0.88 : 1 + drift + (r() - 0.5) * 0.03)
    // Occasional gap at the open.
    const o2 = r() < 0.03 ? o * (1 + (r() - 0.5) * 0.06) : o
    out.push({ t: i * 14_400_000, o: o2, h: Math.max(o2, c) * (1 + r() * 0.01), l: Math.min(o2, c) * (1 - r() * 0.01), c, v: 0, tb: 0 })
    p = c
  }
  return out
}

// ---- reference: the research engine (lib.ts), long only, sl 3 ATR, chandelier 4 ATR, no costs ----
function reference(b: Bar[]) {
  const c = b.map((x) => x.c)
  const atr: number[] = []
  for (let i = 0; i < b.length; i++) {
    const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l
    atr.push(i < 14 ? (i ? (atr[i - 1] * i + tr) / (i + 1) : tr) : (atr[i - 1] * 13 + tr) / 14)
  }
  const ema = (n: number) => {
    const a = 2 / (n + 1)
    const o: number[] = []
    c.forEach((v, i) => o.push(i ? v * a + o[i - 1] * (1 - a) : v))
    return o
  }
  const donch = (n: number, hi: boolean) => {
    const o: number[] = []
    for (let i = 0; i < b.length; i++) {
      if (i < n) {
        o.push(NaN)
        continue
      }
      let m = hi ? -Infinity : Infinity
      for (let j = i - n; j < i; j++) m = hi ? Math.max(m, b[j].h) : Math.min(m, b[j].l)
      o.push(m)
    }
    return o
  }
  const a = 50
  const E = ema(6 * a), n = 20, m = Math.round(n / 2)
  const H = donch(n, true), L = donch(n, false), xh = donch(m, true), xl = donch(m, false)
  const trd = (i: number) => (c[i] > E[i] ? 1 : -1)
  const sig = {
    entry: (i: number) => (trd(i) > 0 && c[i] > H[i] ? 1 : trd(i) < 0 && c[i] < L[i] ? -1 : 0),
    keep: (i: number, sd: number) => trd(i) === sd && (sd > 0 ? c[i] >= xl[i] : c[i] <= xh[i]),
    warm: 18 * a,
  }
  const x = { sl: 3, trail: 4 }
  const out: Array<{ i: number; exitBar: number; entry: number; exit: number; why: string }> = []
  for (let i = Math.max(sig.warm, 1); i < b.length - 1; i++) {
    const side = sig.entry(i)
    if (!side || side < 0) continue
    const entry = b[i + 1].o, dist = x.sl * atr[i]
    if (!(dist > 0)) continue
    let stop = entry - side * dist
    let ext = -Infinity
    let exitPx = NaN, why = '', j = i + 1, exitBar = 0
    for (; j < b.length; j++) {
      const bj = b[j]
      const op = j === i + 1 ? entry : bj.o
      if (bj.l <= stop) {
        exitPx = Math.min(op, stop)
        why = 'stop'
        exitBar = j
        break
      }
      if (j + 1 >= b.length) break
      if (!sig.keep(j, side)) {
        exitPx = b[j + 1].o
        why = 'signal'
        exitBar = j
        break
      }
      ext = Math.max(ext, bj.h)
      stop = Math.max(stop, ext - x.trail * atr[j])
    }
    if (!why) break
    out.push({ i, exitBar, entry, exit: exitPx, why })
    i = exitBar - 1
  }
  return out
}

/**
 * The live path, bar by bar: at each close only the bars so far are known
 * (indicators recomputed on them, as the trader does), the exchange stop is
 * checked against the next bar, and entry / trail / exit come from the same
 * functions the trader calls.
 */
function liveReplay(b: Bar[]) {
  const out: Array<{ i: number; exitBar: number; entry: number; exit: number; why: string }> = []
  let pos: { i: number; entry: number; initial: number; st: TrailState } | null = null
  for (let k = 0; k < b.length; k++) {
    // During bar k: the exchange-side stop.
    if (pos && k > pos.i && b[k].l <= pos.st.stop) {
      const op = k === pos.i + 1 ? pos.entry : b[k].o
      out.push({ i: pos.i, exitBar: k, entry: pos.entry, exit: Math.min(op, pos.st.stop), why: 'stop' })
      pos = null
    }
    if (k + 1 >= b.length) break
    // Bar k closed: decide with bars 0..k only.
    const seen = b.slice(0, k + 1)
    const ind = trendIndicators(seen)
    if (pos) {
      const r = onClose(seen, ind, k, pos.st)
      if (r.exit) {
        out.push({ i: pos.i, exitBar: k, entry: pos.entry, exit: b[k + 1].o, why: 'signal' })
        pos = null
      } else pos.st = r
    } else if (trendSignal(seen, ind, k)) {
      const entry = b[k + 1].o
      const dist = F1.slAtr * ind.atr[k]
      pos = { i: k, entry, initial: entry - dist, st: { stop: entry - dist, high: -Infinity } }
    }
  }
  return out
}

for (const [name, bars] of [
  ['BTC fixture', fixture],
  ['synthetic A', synth(2600, 37)],
  ['synthetic B', synth(2600, 33)],
] as const) {
  test(`parity (${name}): backtest helper and live replay match the research simulation`, () => {
    const ref = reference(bars)
    assert.ok(ref.length >= 5, 'enough trades to compare: ' + ref.length)
    const bt = trendBacktest(bars)
    assert.equal(bt.length, ref.length)
    bt.forEach((t, k) => {
      const r = ref[k]
      assert.deepEqual([t.i, t.exitBar, t.entry, t.exit], [r.i, r.exitBar, r.entry, r.exit], 'trade ' + k)
      assert.equal(t.why === 'signal' ? 'signal' : 'stop', r.why, 'trade ' + k)
    })
    const live = liveReplay(bars)
    assert.equal(live.length, ref.length)
    live.forEach((t, k) => assert.deepEqual(t, ref[k], 'live trade ' + k))
  })
}

test('the parity runs cover initial stops, trailed stops and rule exits', () => {
  const all = [fixture, synth(2600, 37), synth(2600, 33)].flatMap((b) => trendBacktest(b))
  for (const why of ['sl', 'trail', 'signal']) assert.ok(all.some((t) => t.why === why), 'has ' + why)
  // A trailed stop is above the initial one; an initial-stop exit is at most -1R (worse only on a gap).
  for (const t of all) if (t.why === 'sl') assert.ok(t.r <= -1 + 1e-9, 'sl r ' + t.r)
})

test('entry: breakout above the 20-bar high and above EMA(300); none below the EMA or before warm-up', () => {
  const b = synth(2600, 37)
  const ind = trendIndicators(b)
  let yes = 0
  for (let i = 0; i < b.length; i++) {
    const s = trendSignal(b, ind, i)
    if (i < F1.warm) assert.equal(s, false)
    if (s) {
      yes++
      assert.ok(b[i].c > ind.ema[i] && b[i].c > highPrev(b, i, 20))
      assert.equal(noEntryReason(b, ind, i), '')
    } else if (i >= F1.warm) assert.match(noEntryReason(b, ind, i), /^no F1 entry/)
    if (b[i].c <= ind.ema[i]) assert.equal(s, false)
  }
  assert.ok(yes > 0)
})

test('trail never lowers the stop; exit on a close under the 10-bar low', () => {
  assert.equal(trailStop(100, 120, 10), 100, '120 - 40 = 80 < 100: kept')
  assert.equal(trailStop(100, 160, 10), 120)
  const b = synth(2600, 37)
  const ind = trendIndicators(b)
  for (let j = F1.warm; j < b.length; j++) {
    const lo = Math.min(...b.slice(j - 10, j).map((x) => x.l))
    if (b[j].c < lo) assert.equal(trendExit(b, ind, j), true)
    if (b[j].c <= ind.ema[j]) assert.equal(trendExit(b, ind, j), true)
  }
})

test('F1 setup rules: cost against the 3 ATR stop, list, limits; no R:R rule', () => {
  const ok = { entry: 100, slDist: 3, costR: 0.05, canEnter: true, listed: true, openPositions: 0, tradesToday: 0 }
  const c = { maxCostR: 0.15, maxOpen: 4, maxTradesPerDay: 10 }
  assert.deepEqual(checkTrendSetup(ok, c), [])
  assert.match(checkTrendSetup({ ...ok, costR: 0.2 }, c).join(), /cost 0\.200R/)
  assert.match(checkTrendSetup({ ...ok, listed: false }, c).join(), /real-trade list/)
  assert.match(checkTrendSetup({ ...ok, canEnter: false }, c).join(), /risk limits/)
  assert.match(checkTrendSetup({ ...ok, openPositions: 4 }, c).join(), /positions open/)
})

// ---- F1 as a strategy plugin (src/bot/strategies.ts) ----

for (const [name, bars] of [
  ['BTC fixture', fixture],
  ['synthetic A', synth(2600, 37)],
  ['synthetic B', synth(2600, 33)],
] as const) {
  test(`plugin parity (${name}): F1 through the strategy interface makes exactly the trendBacktest trades`, () => {
    const bt = trendBacktest(bars)
    const pl = ruleBacktest(F1_STRATEGY, bars)
    assert.ok(bt.length >= 5)
    assert.ok(pl.every((t) => t.side === 1))
    assert.deepEqual(
      pl.map(({ side: _side, ...t }) => t),
      bt,
    )
  })

  test(`shadow resolver (${name}): an F1 shadow ends where the research trade ends, by the same rule`, () => {
    const step = 14_400_000
    let n = 0
    for (const t of trendBacktest(bars)) {
      // A shadow enters at the signal close; compare where that is the next open (no gap).
      if (bars[t.i + 1].o !== bars[t.i].c) continue
      n++
      const sh = { side: 1 as const, entry: bars[t.i].c, sl: bars[t.i].c - t.dist, barTime: bars[t.i].t }
      assert.equal(resolveRuleShadow(F1_STRATEGY, sh, bars.slice(0, t.exitBar), step, DEFAULT_WF.costs), null, 'still open before its exit bar')
      const r = resolveRuleShadow(F1_STRATEGY, sh, bars, step, DEFAULT_WF.costs)
      assert.ok(r && r.status === 'closed', 'closed')
      assert.equal(r.exit, t.why)
      assert.equal(r.closedAt, bars[t.exitBar].t + step)
      assert.equal(r.bars, t.exitBar - t.i)
      // Stops fill like the research; a rule exit at the close (live: a market order right after it), not the next open.
      assert.equal(r.exitPrice, t.why === 'signal' ? bars[t.exitBar].c : t.exit)
      assert.ok(Math.abs(r.rGross - (r.exitPrice - sh.entry) / t.dist) < 1e-12)
      assert.ok(r.rNet < r.rGross, 'costs taken off')
      assert.ok(r.maeR <= 0 && r.mfeR >= 0)
    }
    assert.ok(n >= 3, 'compared ' + n)
  })
}

test('shadow resolver: expired when the signal bar has left the history window or bars are missing', () => {
  const b = synth(2600, 37)
  const t = trendBacktest(b)[0]
  const sh = { side: 1 as const, entry: b[t.i].c, sl: b[t.i].c - t.dist, barTime: b[t.i].t }
  const step = 14_400_000
  assert.deepEqual(resolveRuleShadow(F1_STRATEGY, sh, b.slice(t.i + 1), step, DEFAULT_WF.costs), { status: 'expired', reason: 'the signal bar is outside the history window' })
  const gap = [...b.slice(0, t.i + 1), ...b.slice(t.i + 3)]
  assert.deepEqual(resolveRuleShadow(F1_STRATEGY, sh, gap, step, DEFAULT_WF.costs), { status: 'expired', reason: 'bars after the decision are missing' })
  assert.equal(resolveRuleShadow(F1_STRATEGY, sh, b.slice(0, t.i + 1), step, DEFAULT_WF.costs), null, 'no bar after it yet')
})

// ---- C2 (bear breakdown short) against a port of the research engine (round 2 lib2.ts bearShort + rd/lib.ts genTrades, gross) ----

function referenceC2(b: Bar[], btc: Bar[]) {
  const series = (x: Bar[]) => {
    const c = x.map((v) => v.c)
    const atr: number[] = []
    for (let i = 0; i < x.length; i++) {
      const tr = i ? Math.max(x[i].h - x[i].l, Math.abs(x[i].h - x[i - 1].c), Math.abs(x[i].l - x[i - 1].c)) : x[i].h - x[i].l
      atr.push(i < 14 ? (i ? (atr[i - 1] * i + tr) / (i + 1) : tr) : (atr[i - 1] * 13 + tr) / 14)
    }
    const a = 2 / 301
    const E: number[] = []
    c.forEach((v, i) => E.push(i ? v * a + E[i - 1] * (1 - a) : v))
    const donch = (n: number, hi: boolean) =>
      x.map((_, i) => {
        if (i < n) return NaN
        let m = hi ? -Infinity : Infinity
        for (let j = i - n; j < i; j++) m = hi ? Math.max(m, x[j].h) : Math.min(m, x[j].l)
        return m
      })
    return { c, atr, E, donch }
  }
  const d = series(b)
  const bt = series(btc)
  const btcIdx = new Map(btc.map((x, i) => [x.t, i]))
  const btcUp = (t: number) => {
    const i = btcIdx.get(t)
    if (i === undefined || i < 900) return 0
    return bt.c[i] > bt.E[i] ? 1 : -1
  }
  const { c, E, atr } = d
  const L = d.donch(20, false)
  const xh = d.donch(10, true)
  const sig = {
    entry: (i: number) => (btcUp(b[i].t) < 0 && c[i] < E[i] && c[i] < L[i] ? -1 : 0),
    keep: (i: number) => c[i] <= E[i] && c[i] <= xh[i],
    warm: 900,
  }
  const x = { sl: 3, trail: 4 }
  const out: Array<{ i: number; exitBar: number; entry: number; exit: number; why: string }> = []
  for (let i = Math.max(sig.warm, 1); i < b.length - 1; i++) {
    const side = sig.entry(i)
    if (!side) continue
    const entry = b[i + 1].o, dist = x.sl * atr[i]
    if (!(dist > 0)) continue
    let stop = entry - side * dist
    let ext = side > 0 ? -Infinity : Infinity
    let exitPx = NaN, why = '', j = i + 1, exitBar = 0
    for (; j < b.length; j++) {
      const bj = b[j]
      const op = j === i + 1 ? entry : bj.o
      const hitS = side > 0 ? bj.l <= stop : bj.h >= stop
      if (hitS) {
        exitPx = side > 0 ? Math.min(op, stop) : Math.max(op, stop)
        why = 'stop'
        exitBar = j
        break
      }
      if (j + 1 >= b.length) break
      if (!sig.keep(j)) {
        exitPx = b[j + 1].o
        why = 'signal'
        exitBar = j
        break
      }
      ext = side > 0 ? Math.max(ext, bj.h) : Math.min(ext, bj.l)
      const ch = ext - side * x.trail * atr[j]
      stop = side > 0 ? Math.max(stop, ch) : Math.min(stop, ch)
    }
    if (!why) break
    out.push({ i, exitBar, entry, exit: exitPx, why })
    i = exitBar - 1
  }
  return out
}

/** A falling market: synth with a bearish drift, on the same 4h grid as synth(). */
function bear(n: number, seed: number): Bar[] {
  return synth(n, seed).map((x) => ({ ...x, o: 1e4 / x.o, c: 1e4 / x.c, h: 1e4 / x.l, l: 1e4 / x.h }))
}

for (const [name, bars, btc] of [
  ['BTC fixture (BTC as its own filter)', fixture, fixture],
  ['synthetic, BTC falling too', bear(2600, 37), bear(2600, 41)],
  ['synthetic, its own BTC', bear(2600, 33), bear(2600, 33)],
  ['synthetic, BTC rising (no shorts)', bear(2600, 37), synth(2600, 37).map((x, i) => ({ ...x, o: 100 * 1.001 ** i, c: 100 * 1.001 ** (i + 1), h: 100 * 1.001 ** (i + 1) * 1.001, l: 100 * 1.001 ** i * 0.999 }))],
] as const) {
  test(`C2 parity (${name}): the plugin makes exactly the research trades`, () => {
    const ref = referenceC2(bars, btc)
    const pl = ruleBacktest(C2_STRATEGY, bars, { BTCUSDT: btc })
    assert.equal(pl.length, ref.length)
    pl.forEach((t, k) => {
      const r = ref[k]
      assert.equal(t.side, -1)
      assert.deepEqual([t.i, t.exitBar, t.entry, t.exit], [r.i, r.exitBar, r.entry, r.exit], 'trade ' + k)
      assert.equal(t.why === 'signal' ? 'signal' : 'stop', r.why, 'trade ' + k)
      assert.ok(Math.abs(t.r - -(t.exit - t.entry) / t.dist) < 1e-12)
    })
    if (name.includes('rising')) assert.equal(pl.length, 0, 'BTC above its EMA: never short')
  })
}

test('C2 parity runs cover stops, trailed stops and rule exits; shadows resolve like the research trades', () => {
  const step = 14_400_000
  const runs = [bear(2600, 37), bear(2600, 33)].map((b) => ({ b, t: ruleBacktest(C2_STRATEGY, b, { BTCUSDT: b }) }))
  const all = runs.flatMap((r) => r.t)
  assert.ok(all.length >= 10, 'trades: ' + all.length)
  for (const why of ['sl', 'trail', 'signal']) assert.ok(all.some((t) => t.why === why), 'has ' + why)
  for (const t of all) if (t.why === 'trail') assert.ok(t.exit < t.initialStop, 'a trailed short stop is below the initial one')
  let n = 0
  for (const { b, t: trades } of runs)
    for (const t of trades) {
      if (b[t.i + 1].o !== b[t.i].c) continue
      n++
      const sh = { side: -1 as const, entry: b[t.i].c, sl: b[t.i].c + t.dist, barTime: b[t.i].t }
      const r = resolveRuleShadow(C2_STRATEGY, sh, b, step, DEFAULT_WF.costs)
      assert.ok(r && r.status === 'closed')
      assert.equal(r.exit, t.why)
      assert.equal(r.bars, t.exitBar - t.i)
      assert.equal(r.exitPrice, t.why === 'signal' ? b[t.exitBar].c : t.exit)
    }
  assert.ok(n >= 3, 'compared ' + n)
})

test('C2 plugin: needs BTC bars; no BTC, no short', () => {
  const b = bear(2600, 37)
  assert.deepEqual(C2_STRATEGY.refs, ['BTCUSDT'])
  assert.deepEqual(C2_STRATEGY.sides, [-1])
  const i = ruleBacktest(C2_STRATEGY, b, { BTCUSDT: b })[0].i
  assert.ok(C2_STRATEGY.signal(b, i, { BTCUSDT: b }))
  assert.equal(C2_STRATEGY.signal(b, i, {}), null)
  assert.match(C2_STRATEGY.noEntry(b, i, {}), /^no C2 entry: BTC is above its EMA\(300\)/)
  assert.equal(C2_STRATEGY.noEntry(b, i, { BTCUSDT: b }), '')
  const s = C2_STRATEGY.signal(b, i, { BTCUSDT: b })!
  assert.equal(s.stop, b[i].c + s.dist)
})

test('F1 plugin: metadata, signal and manage agree with strategy.ts', () => {
  assert.equal(F1_STRATEGY.id, 'f1')
  assert.deepEqual(F1_STRATEGY.sides, [1])
  assert.equal(F1_STRATEGY.interval, '4h')
  assert.equal(STRATEGIES.f1, F1_STRATEGY)
  assert.equal(STRATEGIES.ml.kind, 'model')
  assert.equal(STRATEGIES.ml.health, undefined, 'the model has no bands: never auto-promoted')
  assert.deepEqual(F1_STRATEGY.health, { expR: 0.1, roll30P5: -0.33, roll30P1: -0.43, ddP95: 22.1, ddP99: 27.7 })
  assert.deepEqual(STRATEGIES.c2.health, { expR: 0.01, roll30P5: -0.38, roll30P1: -0.47, ddP95: 26.1, ddP99: 31.3 })
  const b = synth(2600, 37)
  const ind = trendIndicators(b)
  for (let i = F1.warm; i < b.length; i++) {
    const s = F1_STRATEGY.signal(b, i)
    assert.equal(!!s, trendSignal(b, ind, i))
    if (s) {
      assert.equal(s.dist, F1.slAtr * ind.atr[i])
      assert.equal(s.stop, b[i].c - s.dist)
      assert.equal(F1_STRATEGY.noEntry(b, i), '')
    }
    const m = F1_STRATEGY.manage({ side: 1, entry: 100, stop: 90, initialStop: 90, best: 95 }, b, i)
    const r = onClose(b, ind, i, { stop: 90, high: 95 })
    assert.equal(m.exit, r.exit)
    if (!r.exit) assert.deepEqual([m.stop, m.best], [r.stop, r.high])
  }
})

// ---- F1X (F1 with a 15-bar exit) against a port of the research engine (round 3 lib3.ts f1g, exitN, gross) ----

/** lib3.ts f1g without costs, funding, time stop or pyramid: long at close > EMA300 and > the prior 20-bar high, 3 ATR stop, HH − 4 ATR trail, exit when close < the prior exitN-bar low or not above EMA300. */
function referenceF1g(b: Bar[], exitN: number) {
  const n = b.length
  const c = b.map((x) => x.c)
  const atr: number[] = []
  for (let i = 0; i < n; i++) {
    const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l
    atr.push(i < 14 ? (i ? (atr[i - 1] * i + tr) / (i + 1) : tr) : (atr[i - 1] * 13 + tr) / 14)
  }
  const a = 2 / 301
  const e: number[] = []
  c.forEach((v, i) => e.push(i ? v * a + e[i - 1] * (1 - a) : v))
  const donch = (len: number, hi: boolean) =>
    b.map((_, i) => {
      if (i < len) return NaN
      let m = hi ? -Infinity : Infinity
      for (let j = i - len; j < i; j++) m = hi ? Math.max(m, b[j].h) : Math.min(m, b[j].l)
      return m
    })
  const H = donch(20, true), L = donch(exitN, false)
  const out: Array<{ i: number; exitBar: number; entry: number; exit: number; why: string }> = []
  for (let i = 900; i < n - 1; i++) {
    if (!(c[i] > e[i] && c[i] > H[i])) continue
    const entry = b[i + 1].o, dist = 3 * atr[i]
    if (!(dist > 0)) continue
    let stop = entry - dist, ext = -Infinity
    let exitPx = NaN, why = '', j = i + 1, exitBar = 0
    for (; j < n; j++) {
      const bj = b[j]
      const op = j === i + 1 ? entry : bj.o
      if (bj.l <= stop) {
        exitPx = Math.min(op, stop)
        why = 'stop'
        exitBar = j
        break
      }
      if (j + 1 >= n) break
      if (!(c[j] > e[j] && c[j] >= L[j])) {
        exitPx = b[j + 1].o
        why = 'signal'
        exitBar = j
        break
      }
      ext = Math.max(ext, bj.h)
      stop = Math.max(stop, ext - 4 * atr[j])
    }
    if (!why) break
    out.push({ i, exitBar, entry, exit: exitPx, why })
    i = exitBar - 1
  }
  return out
}

for (const [name, bars] of [
  ['BTC fixture', fixture],
  ['synthetic A', synth(2600, 37)],
  ['synthetic B', synth(2600, 33)],
] as const) {
  test(`F1X parity (${name}): the plugin makes exactly the research exit-15 trades; F1 is still the exit-10 ones`, () => {
    const ref = referenceF1g(bars, 15)
    assert.ok(ref.length >= 3, 'enough trades to compare: ' + ref.length)
    const pl = ruleBacktest(F1X_STRATEGY, bars)
    assert.equal(pl.length, ref.length)
    pl.forEach((t, k) => {
      const r = ref[k]
      assert.equal(t.side, 1)
      assert.deepEqual([t.i, t.exitBar, t.entry, t.exit], [r.i, r.exitBar, r.entry, r.exit], 'trade ' + k)
      assert.equal(t.why === 'signal' ? 'signal' : 'stop', r.why, 'trade ' + k)
    })
    // The port with exitN 10 is F1 (checks the port against the F1 parity above).
    const f1 = referenceF1g(bars, 10)
    assert.deepEqual(
      trendBacktest(bars).map((t) => [t.i, t.exitBar, t.entry, t.exit]),
      f1.map((t) => [t.i, t.exitBar, t.entry, t.exit]),
    )
  })
}

test('F1X: its own parameters and bands; F1, C2 and C6 keep the 10-bar exit', () => {
  assert.deepEqual(F1X, { ...F1, exitLen: 15 })
  assert.equal(F1.exitLen, 10)
  assert.equal(STRATEGIES.f1x, F1X_STRATEGY)
  assert.deepEqual(F1X_STRATEGY.sides, [1])
  assert.equal(F1X_STRATEGY.interval, '4h')
  assert.deepEqual(F1X_STRATEGY.health, { expR: 0.12, roll30P5: -0.35, roll30P1: -0.45, ddP95: 23.2, ddP99: 29.3 })
  assert.notEqual(F1X_STRATEGY.manage, F1_STRATEGY.manage)
  assert.equal(STRATEGIES.c6.kind === 'rule' && STRATEGIES.c6.manage, F1_STRATEGY.manage)
  // The longer exit changes trades somewhere (else the parity above proves nothing new).
  const runs = [fixture, synth(2600, 37), synth(2600, 33)]
  assert.ok(runs.some((b) => JSON.stringify(ruleBacktest(F1X_STRATEGY, b)) !== JSON.stringify(ruleBacktest(F1_STRATEGY, b))))
  for (const b of runs)
    for (let i = F1.warm; i < b.length; i += 7) {
      assert.equal(!!F1X_STRATEGY.signal(b, i), !!F1_STRATEGY.signal(b, i), 'same entries as F1')
      if (!F1X_STRATEGY.signal(b, i)) assert.match(F1X_STRATEGY.noEntry(b, i), /^no F1X entry/)
    }
  const b = synth(2600, 37)
  const i = ruleBacktest(F1X_STRATEGY, b)[0].i
  const s = F1X_STRATEGY.signal(b, i)!
  assert.equal(s.features.low15, Math.min(...b.slice(i - 15, i).map((x) => x.l)))
  assert.equal(s.features.low10, undefined)
  assert.match(F1X_STRATEGY.describe(b, i), /^F1X: close/)
})
