// Strategy F1 (src/bot/strategy.ts) against a copy of the research engine's
// simulation (makeSig 'mtf' + genTrades, gross of costs): the backtest helper
// and a bar-by-bar replay of the live path must produce the same trades.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Bar } from '../src/bot/features.ts'
import { F1, checkTrendSetup, highPrev, noEntryReason, onClose, trailStop, trendBacktest, trendExit, trendIndicators, trendSignal } from '../src/bot/strategy.ts'
import type { TrailState } from '../src/bot/strategy.ts'

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
