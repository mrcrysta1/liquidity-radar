// Experimental strategies (src/bot/experimental.ts): F1 plus one filter, shadow only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Bar } from '../src/bot/features.ts'
import { STRATEGIES, parseStrategies, ruleBacktest } from '../src/bot/strategies.ts'
import type { RuleStrategy } from '../src/bot/strategies.ts'
import { btcAbove, volumeRatio, X2_VOLUME_X } from '../src/bot/experimental.ts'

const H4 = 14_400_000
/** An uptrend with deep swings (F1 enters and exits repeatedly), volume `vol(i)`. */
function trend(n: number, slope: number, vol: (i: number) => number = () => 100): Bar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 200 + i * slope + 15 * Math.sin(i / 8)
    return { t: i * H4, o: c, h: c + 1, l: c - 1, c, v: vol(i) } as Bar
  })
}

test('registered as rule strategies without health bands (never promoted)', () => {
  for (const id of ['x1', 'x2']) {
    const s = STRATEGIES[id] as RuleStrategy
    assert.equal(s.kind, 'rule')
    assert.equal(s.health, undefined)
    assert.match(s.name, /experimental/)
  }
  assert.deepEqual(parseStrategies('f1:live,x1:shadow,x2:shadow')!.map((x) => [x.id, x.state]), [['f1', 'live'], ['x1', 'shadow'], ['x2', 'shadow']])
  // F1 itself is untouched.
  assert.equal(STRATEGIES.f1.name, 'F1 trend breakout (4h, long)')
})

test('x1: F1 entries only while BTC is above its EMA(300)', () => {
  const coin = trend(1600, 0.3)
  const btcUp = trend(1600, 0.5).map((x) => ({ ...x, c: 100 + (x.t / H4) * 0.5 }))
  const btcDown = trend(1600, 0).map((x) => ({ ...x, c: 900 - (x.t / H4) * 0.5 }))
  const f1 = ruleBacktest(STRATEGIES.f1 as RuleStrategy, coin)
  const up = ruleBacktest(STRATEGIES.x1 as RuleStrategy, coin, { BTCUSDT: btcUp })
  const down = ruleBacktest(STRATEGIES.x1 as RuleStrategy, coin, { BTCUSDT: btcDown })
  assert.ok(f1.length > 3)
  assert.equal(up.length, f1.length, 'BTC trending up: same entries as F1')
  assert.equal(down.length, 0, 'BTC below its EMA: no entries')
  assert.equal(ruleBacktest(STRATEGIES.x1 as RuleStrategy, coin).length, 0, 'BTC unknown: no entries')
  assert.equal(btcAbove(btcUp, btcUp[1500].t), true)
  assert.equal(btcAbove(btcUp, btcUp[10].t), null, 'before warm-up')
  assert.match((STRATEGIES.x1 as RuleStrategy).noEntry(coin, f1[0].i, { BTCUSDT: btcDown }), /no X1 entry: BTC not above/)
})

test('x2: F1 entries only on a volume surge', () => {
  const quiet = trend(1600, 0.3)
  const surge = trend(1600, 0.3, (i) => (i % 2 ? 100 : 400))
  const f1 = ruleBacktest(STRATEGIES.f1 as RuleStrategy, quiet)
  assert.equal(ruleBacktest(STRATEGIES.x2 as RuleStrategy, quiet).length, 0, 'flat volume never confirms')
  const x2 = ruleBacktest(STRATEGIES.x2 as RuleStrategy, surge)
  assert.ok(x2.length > 0 && x2.every((t) => volumeRatio(surge, t.i)! >= X2_VOLUME_X))
  assert.ok(f1.length >= x2.length)
  assert.equal(volumeRatio(quiet, 5), null)
  const sig = (STRATEGIES.x2 as RuleStrategy).signal(surge, x2[0].i)!
  assert.ok(sig.features.volRatio >= X2_VOLUME_X, 'the filter value is kept with the trade')
})
