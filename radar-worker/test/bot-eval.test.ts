// The offline evaluation harness: labels match the trader's rules, folds never
// leak, and comparisons say what they should.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { indicators, outcomeAt, costR } from '../src/bot/features.ts'
import type { Bar } from '../src/bot/features.ts'
import { BaseRatePredictor, MlpPredictor } from '../src/bot/predictor.ts'
import type { Predictor, PredictInput, PredictorRow } from '../src/bot/predictor.ts'
import { DEFAULT_SETUP } from '../src/bot/setup.ts'
import {
  DEFAULT_WF,
  baselines,
  bootstrapDiff,
  calibration,
  compareModels,
  labelBars,
  makeFolds,
  summarize,
  tradeLabel,
  walkForwardEval,
} from '../src/bot/walkforward.ts'
import type { EvalConfig, EvalTrade } from '../src/bot/walkforward.ts'

const H1 = 3_600_000

function rng(seed: number) {
  let s = seed
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
}

/** Random-walk 1h bars (each opens at the previous close). */
function walk(n: number, seed = 3): Bar[] {
  const r = rng(seed)
  const out: Bar[] = []
  let p = 100
  for (let i = 0; i < n; i++) {
    const o = p
    const c = o * (1 + (r() - 0.5) * 0.02)
    const h = Math.max(o, c) * (1 + r() * 0.004)
    const l = Math.min(o, c) * (1 - r() * 0.004)
    const v = 100 + r() * 50
    out.push({ t: i * H1, o, h, l, c, v, tb: v * r() })
    p = c
  }
  return out
}

const cfgFor = (over: Partial<EvalConfig['wf']> = {}, embargoBars = 3): EvalConfig => ({
  wf: { ...DEFAULT_WF, bracket: { slAtr: 1.5, tpAtr: 3, horizon: 6 }, minEvR: -1e9, trainBars: 400, testBars: 100, mlp: { ...DEFAULT_WF.mlp, epochs: 15 }, ...over },
  setup: DEFAULT_SETUP,
  embargoBars,
  stepMs: H1,
})

const flat = (t: number, p: number): Bar => ({ t, o: p, h: p, l: p, c: p, v: 1, tb: 0.5 })

test('labels equal outcomeAt when no bar gaps through the stop', () => {
  const b = walk(700)
  const ind = indicators(b)
  const k = { slAtr: 1.5, tpAtr: 3, horizon: 8 }
  let n = 0
  for (let i = 200; i < 690; i++)
    for (const side of [1, -1] as const) {
      const o = outcomeAt(b, ind, i, side, k)
      const l = tradeLabel(b, ind, i, side, k, DEFAULT_WF.costs, H1)
      if (!o) {
        assert.equal(l, null)
        continue
      }
      assert.ok(l)
      assert.equal(l.exit, o.exit)
      assert.equal(l.end, o.end)
      assert.ok(Math.abs(l.rGross - o.r) < 1e-9, `bar ${i}`)
      n++
    }
  assert.ok(n > 900)
})

test('labels follow the trader: next-open entry, stop first, gap fills at the open, maker target, time exit at the deadline', () => {
  const k = { slAtr: 1, tpAtr: 2, horizon: 3 }
  const costs = { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true }
  // Flat history so ATR at bar 20 is known exactly: every true range = 2.
  const base = Array.from({ length: 21 }, (_, i) => ({ t: i * H1, o: 100, h: 101, l: 99, c: 100, v: 1, tb: 0.5 }))
  const ind = (b: Bar[]) => indicators(b)
  const i = 20
  const atr = indicators(base).atr[i]
  assert.ok(Math.abs(atr - 2) < 1e-9)
  // 1) entry at bar 21's open (100.5); the target 104.5 is reached in bar 22 → tp at the target price.
  let b = [...base, { t: 21 * H1, o: 100.5, h: 101, l: 100, c: 101, v: 1, tb: 0.5 }, { t: 22 * H1, o: 101, h: 105, l: 100.6, c: 104, v: 1, tb: 0.5 }, flat(23 * H1, 104), flat(24 * H1, 104)]
  let l = tradeLabel(b, ind(b), i, 1, k, costs, H1)!
  assert.equal(l.entry, 100.5)
  assert.equal(l.sl, 98.5)
  assert.equal(l.tp, 104.5)
  assert.equal(l.exit, 'tp')
  assert.equal(l.end, 22)
  assert.equal(l.rGross, 2)
  // Taker + slippage in, maker out; cost priced off the decision bar's close.
  const tpCost = ((0.0005 + 0.0002 + 0.0002) * 100) / 2
  assert.ok(Math.abs(l.costR - tpCost) < 1e-12)
  assert.ok(Math.abs(l.costR - costR(100, 2, costs, 'tp')) < 1e-12)
  assert.ok(Math.abs(l.rNet - (2 - tpCost)) < 1e-12)
  // 2) one bar touches both → the stop.
  b = [...base, { t: 21 * H1, o: 100.5, h: 101, l: 100, c: 101, v: 1, tb: 0.5 }, { t: 22 * H1, o: 101, h: 105, l: 98, c: 104, v: 1, tb: 0.5 }, flat(23 * H1, 104), flat(24 * H1, 104)]
  l = tradeLabel(b, ind(b), i, 1, k, costs, H1)!
  assert.equal(l.exit, 'sl')
  assert.equal(l.rGross, -1)
  assert.ok(Math.abs(l.costR - ((0.0005 + 0.0002) * 2 * 100) / 2) < 1e-12)
  // 3) a bar opening through the stop fills at that open (worse than −1R).
  b = [...base, { t: 21 * H1, o: 100.5, h: 101, l: 100, c: 100, v: 1, tb: 0.5 }, { t: 22 * H1, o: 97.5, h: 98, l: 97, c: 97.5, v: 1, tb: 0.5 }, flat(23 * H1, 97), flat(24 * H1, 97)]
  l = tradeLabel(b, ind(b), i, 1, k, costs, H1)!
  assert.equal(l.exit, 'sl')
  assert.equal(l.exitPx, 97.5)
  assert.equal(l.rGross, -1.5)
  // 4) neither → time exit at the close of bar i + horizon, which is the
  // trader's deadline: barTime + (horizon + 1) bars.
  b = [...base, { t: 21 * H1, o: 100.5, h: 101, l: 100, c: 101, v: 1, tb: 0.5 }, flat(22 * H1, 101), flat(23 * H1, 101.5)]
  l = tradeLabel(b, ind(b), i, -1, k, costs, H1)!
  assert.equal(l.exit, 'time')
  assert.equal(l.end, i + k.horizon)
  assert.equal(l.exitPx, 101.5)
  assert.equal(l.rGross, -0.5) // short from 100.5 to 101.5, 2 per R
  assert.equal(l.closedAt, b[i].t + (k.horizon + 1) * H1)
  // The bar after the horizon is unknown → no label.
  assert.equal(tradeLabel(b.slice(0, -1), ind(b.slice(0, -1)), i, 1, k, costs, H1), null)
  // 5) funding while held: longs pay a positive rate, shorts receive it; the
  // settlement at the entry bar's open is before the fill and is not charged.
  const f = [
    { t: 21 * H1, rate: 0.01 },
    { t: 22 * H1, rate: 0.001 },
  ]
  const lf = tradeLabel(b, ind(b), i, 1, k, costs, H1, f)!
  const sf = tradeLabel(b, ind(b), i, -1, k, costs, H1, f)!
  assert.ok(Math.abs(lf.fundingR - (0.001 * 100.5) / 2) < 1e-12)
  assert.ok(Math.abs(sf.fundingR + (0.001 * 100.5) / 2) < 1e-12)
  assert.ok(Math.abs(lf.rNet - (lf.rGross - lf.costR - lf.fundingR)) < 1e-12)
})

test('folds: every training label ends before the embargo, test blocks never overlap', () => {
  for (const [H, emb] of [
    [6, 0],
    [6, 3],
    [96, 12],
  ]) {
    const folds = makeFolds(5000, H, 800, 250, emb)
    assert.ok(folds.length > 3)
    for (const f of folds) {
      // Training row i's label uses bars up to i + H.
      assert.ok(f.trainTo - 1 + H <= f.testFrom - emb - 1, `H ${H} embargo ${emb} fold ${f.k}`)
      assert.ok(f.trainFrom >= 200 && f.trainTo > f.trainFrom)
      assert.ok(f.testTo + H <= 5000, 'test labels must be known')
    }
    for (let j = 1; j < folds.length; j++) assert.equal(folds[j].testFrom, folds[j - 1].testTo)
  }
})

/** Records what it was trained on, so the test can check the fold boundaries. */
class Spy implements Predictor {
  readonly name = 'spy'
  static log: Array<{ maxKnownAt: number; maxT: number; preds: number[][] }> = []
  private inner = new BaseRatePredictor()
  private entry: { maxKnownAt: number; maxT: number; preds: number[][] } | null = null
  fit(rows: PredictorRow[]): boolean {
    this.entry = { maxKnownAt: Math.max(...rows.map((r) => r.knownAt)), maxT: Math.max(...rows.map((r) => r.t)), preds: [] }
    Spy.log.push(this.entry)
    return this.inner.fit(rows)
  }
  predict(f: PredictInput) {
    assert.ok(this.entry, 'predict before fit')
    this.entry.preds.push(f.x)
    return this.inner.predict(f)
  }
}

test('walk-forward never trains on an outcome known inside (or within the embargo of) its test block', () => {
  const b = walk(2000, 11)
  const cfg = cfgFor({}, 5)
  const data = labelBars('X', b, cfg)
  Spy.log = []
  const m = walkForwardEval('spy', () => new Spy(), [data], cfg)
  assert.equal(Spy.log.length, m.folds.length)
  for (const [j, f] of m.folds.entries()) {
    assert.ok(f.fitted)
    // The first test decision is at testFrom's close; the embargo starts embargo bars before testFrom opens.
    assert.ok(f.lastTrainKnownAt <= f.testFrom - cfg.embargoBars * H1, `fold ${j}: ${f.lastTrainKnownAt} vs ${f.testFrom}`)
    assert.ok(Spy.log[j].maxKnownAt === f.lastTrainKnownAt)
    assert.ok(Spy.log[j].preds.length > 0)
  }
  // Trades only on test bars, never overlapping, with the cooldown after a stop.
  const t = [...m.trades].sort((a, c) => a.i - c.i)
  assert.ok(t.length > 10)
  const ends = new Map(data.rows.map((r) => [r.i, r]))
  for (let j = 1; j < t.length; j++) {
    const prev = ends.get(t[j - 1].i)!
    const pl = t[j - 1].side > 0 ? prev.long : prev.short
    assert.ok(t[j].i >= pl.end, 'one position at a time')
    if (pl.exit === 'sl') assert.ok(t[j].t + H1 - pl.closedAt >= cfg.setup.cooldownMs)
  }
})

test('no future bars: rewriting the bars after K leaves every trade closed before K unchanged', () => {
  const b = walk(1600, 5)
  const K = 1200
  const r = rng(99)
  const bad = b.map((x, i) => (i < K ? x : { ...x, o: x.o * (1 + r() * 0.05), h: x.h * 1.06, l: x.l * 0.94, c: x.c * (1 + (r() - 0.5) * 0.08), v: x.v * 3 }))
  const cfg = cfgFor()
  for (const make of [() => new BaseRatePredictor(), () => new MlpPredictor(cfg.wf)]) {
    const before = (es: EvalTrade[]) => es.filter((t) => t.closedAt <= b[K].t)
    const a = walkForwardEval('m', make, [labelBars('X', b, cfg)], cfg)
    const c = walkForwardEval('m', make, [labelBars('X', bad, cfg)], cfg)
    assert.ok(before(a.trades).length > 5, 'enough trades to compare')
    assert.deepEqual(before(c.trades), before(a.trades))
  }
})

/** A fitted predictor with a fixed opinion. */
const fixed = (side: 1 | -1): Predictor => ({
  name: 'fixed',
  fit: () => true,
  predict: (f) => (f.side === side ? { pWin: 0.9, expectedR: 1 } : { pWin: 0.1, expectedR: -1 }),
})

test('compareModels promotes a challenger that is clearly better, and keeps the champion otherwise', () => {
  // A steady uptrend: longs win, shorts lose.
  const b: Bar[] = []
  const r = rng(4)
  let p = 100
  for (let i = 0; i < 1200; i++) {
    const o = p
    const c = o * (1.004 + (r() - 0.5) * 0.01)
    b.push({ t: i * H1, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: 100, tb: 50 })
    p = c
  }
  const cfg = cfgFor()
  const data = [labelBars('UP', b, cfg)]
  const up = compareModels({ name: 'short', predictor: fixed(-1) }, { name: 'long', predictor: fixed(1) }, data, cfg, { nBoot: 500 })
  assert.ok(up.challenger.summary.expectancyR > 0 && up.champion.summary.expectancyR < 0)
  assert.ok(up.diff.ci[0] > 0)
  assert.equal(up.promote, true)
  const down = compareModels({ name: 'long', predictor: fixed(1) }, { name: 'short', predictor: fixed(-1) }, data, cfg, { nBoot: 500 })
  assert.equal(down.promote, false)
  assert.ok(down.diff.ci[1] < 0)
})

test('bootstrap of identical trade lists is exactly zero; calibration and baselines are sane', () => {
  const t: EvalTrade[] = Array.from({ length: 50 }, (_, i) => ({ symbol: 'X', fold: 0, i, t: i * 6 * H1, side: 1, p: 0.5, ev: 0, exit: 'tp', rGross: i % 3 ? 1 : -1, costR: 0.05, fundingR: 0, rNet: (i % 3 ? 1 : -1) - 0.05, closedAt: i * 6 * H1 + H1 }))
  const d = bootstrapDiff(t, t, { nBoot: 200 })
  assert.equal(d.expectancyDiff, 0)
  assert.deepEqual(d.ci, [0, 0])
  // Perfect forecasts: Brier 0; the base rate itself: no skill.
  assert.equal(calibration([{ p: 1, y: 1 }, { p: 0, y: 0 }]).brier, 0)
  const pts = Array.from({ length: 100 }, (_, i) => ({ p: 0.3, y: (i < 30 ? 1 : 0) as 0 | 1 }))
  assert.ok(Math.abs(calibration(pts).skill) < 1e-12)
  const s = summarize(t)
  assert.equal(s.trades, 50)
  assert.ok(Math.abs(s.expectancyR - (s.totalR / 50)) < 1e-12)

  const b = walk(1500, 8)
  const cfg = cfgFor()
  const m = walkForwardEval('base', () => new BaseRatePredictor(), [labelBars('X', b, cfg)], cfg)
  const base = baselines(m, cfg, 10)
  assert.equal(base.noTrade.trades, 0)
  assert.ok(Math.abs(base.random.entryProb - m.trades.length / m.free) < 1e-12)
  assert.ok(base.momentum.trades > 0)
})
