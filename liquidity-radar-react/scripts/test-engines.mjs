// Unit tests for the pure engines.
//
// No test framework and no new dependency: Node 24 strips TypeScript types on
// import, so these run the real modules the app ships. Keep every assertion
// here free of network, DOM and clock — anything that needs those belongs in
// the browser smoke gate (`npm run smoke`).
//
//   node scripts/test-engines.mjs
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = (p) => pathToFileURL(resolve(__dirname, '..', 'src', p)).href

const { swings, structureEvents, classifyPriceOI, bookMetrics, liquidityScore, fmtUsd } =
  await import(src('features/charts/sidePanels/metrics.ts'))
const {
  bucketIndex,
  bucketEnd,
  resample,
  tfDef,
  normalizeTf,
  TIMEFRAMES,
  parseTimeframe,
  baseFor,
  fmtTf,
  customTfDef,
  isTf,
  createFolder,
} = await import(src('services/timeframe.ts'))
const { buildRangeBars, atr, niceRange, autoRangeSize, minSafeRange, MAX_RANGE_BARS } =
  await import(src('features/charts/series/rangeBars.ts'))
const { heikinAshi, heikinAshiNext, heikinAshiOf, heikinAshiBar } = await import(
  src('features/charts/series/heikinAshi.ts')
)
const { columnUp } = await import(src('features/charts/series/basicSeries.ts'))
const { buildRenko } = await import(src('features/charts/series/renko.ts'))
const { buildDerivedBars, derivedSize } = await import(src('features/charts/series/derivedBars.ts'))
const { buildLineBreak, clampLineBreak } = await import(src('features/charts/series/lineBreak.ts'))
const { buildKagi, kagiYangEnd } = await import(src('features/charts/series/kagi.ts'))
const { buildPointFigure, clampPnfReversal, pnfBoxes } = await import(
  src('features/charts/series/pointFigure.ts')
)
const { noteLimitResponse, cooldownLeft, isRateLimited } = await import(src('api/rateLimit.ts'))
const { pfmt, nfmt, cfmt } = await import(src('utils/format.ts'))
const { VENUES, isUsdQuoted } = await import(src('features/advanced/venues.ts'))
const { groupAggTrades, autoThreshold, bubbleRadius } = await import(
  src('features/whales/whaleMath.ts')
)
const alerts = await import(src('features/alerts/rules.ts'))
const { buildVolumeProfile, computeVolumeProfile, clampRows, clampValueArea } = await import(
  src('features/charts/volumeProfile.ts')
)

const { ProviderChain, klineFreshness, createPacer, toKlineRows } = await import(
  src('services/providerChain.ts')
)
const { KlineHub, MAX_HUB_STREAMS } = await import(src('services/klineHub.ts'))

let pass = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) {
    pass++
  } else {
    fails.push(name + (detail === undefined ? '' : ' — got ' + JSON.stringify(detail)))
  }
}
const eq = (name, a, b) => ok(name, Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), a)
const near = (name, a, b, tol = 1e-6) => ok(name, Math.abs(a - b) <= tol, a)

const bar = (i, h, l, c) => ({ t: i * 60000, o: c, h, l, c, v: 1 })

// ---------------------------------------------------------------- structure
{
  const up = []
  for (let i = 0; i <= 6; i++) up.push(bar(i, 100 + i, 99 + i, 100 + i))
  for (let i = 1; i <= 6; i++) up.push(bar(6 + i, 106 - i, 105 - i, 106 - i))
  const sw = swings(up)
  eq('swings: one apex', sw.length, 1)
  eq('swings: apex is a high', sw[0].type, 'high')

  const flat = []
  for (let i = 0; i < 4; i++) flat.push(bar(i, 100 + i, 99 + i, 100 + i))
  for (let i = 0; i < 4; i++) flat.push(bar(4 + i, 110, 108, 109))
  for (let i = 0; i < 4; i++) flat.push(bar(8 + i, 105 - i, 104 - i, 105 - i))
  eq('swings: a flat top is one swing, not four', swings(flat).length, 1)

  const path = []
  let px = 100
  ;[20, -10, 25, -10, 25, -10].forEach((d) => {
    for (let j = 1; j <= 6; j++) {
      px += d / 6
      path.push(bar(path.length, px + 0.4, px - 0.4, px))
    }
  })
  const sw2 = swings(path)
  ok('swings: labels are HH/HL/LH/LL', sw2.some((s) => s.label === 'HH') && sw2.some((s) => s.label === 'HL'))
  const ev = structureEvents(path, sw2)
  ok('structure: fires events on a staircase', ev.length > 0, ev.length)
  ok(
    'structure: never dated before confirmation',
    ev.every((e) => {
      const s = sw2.find((x) => x.price === e.price)
      return !s || e.index >= s.index + 3
    }),
  )
  eq('structure: one event per swing', new Set(ev.map((e) => e.price)).size, ev.length)

  eq('swings: empty input is safe', swings([]).length, 0)
  eq('structure: empty input is safe', structureEvents([], []).length, 0)

  // Performance: the chart can hold thousands of bars.
  const big = []
  for (let i = 0; i < 6000; i++) {
    const p = 100 + Math.sin(i / 9) * 8 + Math.sin(i / 53) * 20
    big.push(bar(i, p + 0.6, p - 0.6, p))
  }
  const t0 = Date.now()
  structureEvents(big, swings(big))
  const ms = Date.now() - t0
  ok('structure: 6000 bars under 250ms', ms < 250, ms + 'ms')
}

// ------------------------------------------------------------------ regime
{
  eq('regime: price up, OI up', classifyPriceOI(2, 3).regime, 'LONGS_BUILDING')
  eq('regime: price down, OI up', classifyPriceOI(-2, 3).regime, 'SHORTS_BUILDING')
  eq('regime: price down, OI down', classifyPriceOI(-2, -3).regime, 'LONGS_CLOSING')
  eq('regime: price up, OI down', classifyPriceOI(2, -3).regime, 'SHORTS_CLOSING')
  eq('regime: inside the dead band is flat', classifyPriceOI(0.05, 0.02).regime, 'FLAT')
  ok('regime: every quadrant explains itself', classifyPriceOI(2, 3).meaning.length > 30)
}

// --------------------------------------------------------------- order book
{
  const bids = Array.from({ length: 40 }, (_, i) => ({ price: 100 - i * 0.1, size: i === 5 ? 500 : 10 }))
  const asks = Array.from({ length: 40 }, (_, i) => ({ price: 100.1 + i * 0.1, size: 10 }))
  const m = bookMetrics(bids, asks)
  ok('book: returns metrics', !!m)
  near('book: mid', m.mid, 100.05, 1e-9)
  ok('book: spread in bps is positive', m.spreadBps > 0, m.spreadBps)
  ok('book: depth counted in quote currency', m.bidDepth1 > 1000, m.bidDepth1)
  ok('book: finds the planted wall', m.walls.some((w) => w.side === 'bid' && w.size === 500))
  ok('book: slippage covers both sides', m.slippage.filter((s) => s.side === 'buy').length === 3)
  eq('book: empty side returns null', bookMetrics([], asks), null)

  const sc = liquidityScore(m, 2.4e9)
  eq('score: five components', sc.components.length, 5)
  ok('score: slippage is one of them', sc.components.some((c) => c.key === 'slippage'))
  ok('score: 0..100', sc.value >= 0 && sc.value <= 100, sc.value)
  ok('score: weights sum to 1', Math.abs(sc.components.reduce((s, c) => s + c.weight, 0) - 1) < 1e-9)
  ok('score: every component explains itself', sc.components.every((c) => c.reason.length > 3))
  const noVol = liquidityScore(m, undefined)
  ok('score: survives missing volume', noVol.value >= 0 && noVol.value <= 100, noVol.value)
}

// --------------------------------------------------------------- timeframes
{
  ok('tf: catalogue is populated', TIMEFRAMES.length > 10, TIMEFRAMES.length)
  eq('tf: 1M is a month, not a minute', normalizeTf('1M'), '1M')
  eq('tf: 1m stays a minute', normalizeTf('1m'), '1m')
  const d = tfDef('15m')
  eq('tf: 15m resolves', d.id, '15m')

  // Resampling only does work where factor > 1; feed it candles of the
  // definition's own base interval, which is what the app does.
  const def45 = tfDef('45m')
  eq('tf: 45m is built from 15m bars', def45.base + 'x' + def45.factor, '15mx3')
  const step = 15 * 60000
  const t0 = Date.UTC(2026, 0, 1)
  const base = []
  for (let i = 0; i < 120; i++) base.push({ t: t0 + i * step, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 })
  const out = resample(base, def45)
  eq('resample: folds three bars into one', out.length, 40)
  ok('resample: strictly increasing', out.every((c, i) => i === 0 || c.t > out[i - 1].t))
  ok('resample: bucket opens align to the interval', out.every((c) => (c.t - t0) % (step * 3) === 0))
  ok('resample: open is the first member', out[0].o === base[0].o)
  ok('resample: close is the last member', out[0].c === base[2].c)
  ok('resample: high is the max of its members', out[0].h === Math.max(base[0].h, base[1].h, base[2].h))
  ok('resample: low is the min of its members', out[0].l === Math.min(base[0].l, base[1].l, base[2].l))
  near('resample: volume sums', out[0].v, 3)
  eq('resample: empty input is safe', resample([], def45).length, 0)
  eq('resample: a native interval passes through', resample(base, tfDef('15m')).length, base.length)

  // Calendar-aware month ends, not a fixed 30 days.
  const jan = Date.UTC(2026, 0, 1)
  eq('bucketEnd: January rolls to February', bucketEnd(jan, tfDef('1M')), Date.UTC(2026, 1, 1))
  ok('bucketIndex: monotonic', bucketIndex(t0 + 1e6, d) > bucketIndex(t0, d))
}

// ------------------------------------------------------- custom timeframes
// Ported from the Pro terminal's core/timeframes.test.ts, plus the main app's
// resolution rules (canonical ids, catalogue hits, limits).
{
  eq('ctf: parses 45m', parseTimeframe('45m'), 2700)
  eq('ctf: parses 7m', parseTimeframe('7m'), 420)
  eq('ctf: parses 3d', parseTimeframe('3d'), 259200)
  eq('ctf: parses 90s', parseTimeframe('90s'), 90)
  eq('ctf: rejects junk', parseTimeframe('x'), null)
  eq('ctf: rejects zero', parseTimeframe('0m'), null)
  eq('ctf: base for 45m', baseFor(2700), { base: '15m', factor: 3 })
  eq('ctf: base for 7m', baseFor(420), { base: '1m', factor: 7 })
  eq('ctf: base for 15s', baseFor(15), { base: '1s', factor: 15 })
  eq('ctf: base for 1h is native', baseFor(3600).base, '1h')
  eq('ctf: base for 16h is 8h', baseFor(57600), { base: '8h', factor: 2 })
  eq('ctf: formats 45m', fmtTf(2700), '45m')
  eq('ctf: formats 30s', fmtTf(30), '30s')
  eq('ctf: formats a day', fmtTf(86400), '1d')

  for (const id of ['6h', '8h', '12h']) {
    const d = tfDef(id)
    eq('tf: ' + id + ' is in the catalogue and native', [d.id, d.base, d.factor, !!d.custom], [id, id, 1, false])
  }
  const d7 = customTfDef('7m')
  eq('ctf: 7m folds seven 1m bars', [d7.id, d7.base, d7.factor, d7.custom, d7.group], ['7m', '1m', 7, true, 'Minutes'])
  const d90 = customTfDef('90s')
  eq('ctf: 90s folds 1s bars', [d90.base, d90.factor, d90.group, d90.long], ['1s', 90, 'Seconds', '90 Seconds'])
  const d2 = customTfDef('2d')
  eq('ctf: 2d folds 1d bars', [d2.id, d2.label, d2.base, d2.factor], ['2d', '2D', '1d', 2])
  eq('ctf: 60m is the catalogue hour', customTfDef('60m').id, '1h')
  eq('ctf: 45m is the catalogue entry', customTfDef('45m').custom, undefined)
  eq('ctf: uppercase H reads as hours', customTfDef('6H').id, '6h')
  eq('ctf: 2M is two calendar months', [customTfDef('2M').base, customTfDef('2M').factor], ['1M', 2])
  eq('ctf: 1M stays the month', customTfDef('1M').id, '1M')
  eq('ctf: too many base rows is refused', customTfDef('500s'), null)
  eq('ctf: junk is refused', customTfDef('abc'), null)
  eq('ctf: tfDef resolves a custom id', tfDef('7m').factor, 7)
  eq('ctf: tfDef falls back for junk', tfDef('nope').id, '15m')
  eq('ctf: normalizeTf canonicalises', normalizeTf('120m'), '2h')
  ok('ctf: isTf accepts a canonical custom id', isTf('7m'))
  ok('ctf: isTf refuses a non-canonical spelling', !isTf('420s'))
  eq('ctf: 1m is still the minute', normalizeTf('1m'), '1m')

  // Resampling a custom interval: 7m from 1m bars, bucketed on absolute time.
  const t0 = Date.UTC(2026, 0, 1)
  const start = Math.ceil(t0 / 420000) * 420000
  const base = []
  for (let i = 0; i < 70; i++) base.push({ t: start + i * 60000, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 })
  const out = resample(base, d7)
  eq('ctf: 70 × 1m make ten 7m bars', out.length, 10)
  ok('ctf: 7m bars open on 7-minute boundaries', out.every((c) => c.t % 420000 === 0))
  eq('ctf: 7m bar folds its members', [out[0].o, out[0].h, out[0].l, out[0].c, out[0].v], [0, 7, -1, 6.5, 7])
  // The live folder keeps the forming 7m bar current.
  const f = createFolder(d7)
  f.seed(base.slice(0, 66))
  const live = f.push({ t: start + 66 * 60000, o: 66, h: 99, l: 60, c: 70, v: 2 })
  eq('ctf: live fold spans the bucket so far', [live.t, live.h, live.l, live.c, live.v], [start + 63 * 60000, 99, 60, 70, 5])
  // 90s from 1s.
  const s0 = Math.ceil(t0 / 90000) * 90000
  const secs = []
  for (let i = 0; i < 270; i++) secs.push({ t: s0 + i * 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 })
  const o90 = resample(secs, d90)
  eq('ctf: 270 × 1s make three 90s bars', o90.length, 3)
  near('ctf: 90s volume sums', o90[1].v, 90)
}

// -------------------------------------------------------------- range bars
// Ported from the Pro terminal's core/chart/rangeBars.test.ts, on the main
// app's candle shape.
{
  const srcBars = Array.from({ length: 200 }, (_, i) => {
    const o = 100 + Math.sin(i / 5) * 10
    const c = o + ((i % 3) - 1) * 2
    return { t: 1_000_000 + i * 60000, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 4 }
  })
  const rb = buildRangeBars(srcBars, 3)
  ok('range: builds plenty of bars', rb.length > 10, rb.length)
  ok('range: no bar exceeds the range', rb.every((b) => b.h - b.l <= 3 + 1e-9))
  ok('range: times strictly increase', rb.every((b, i) => i === 0 || b.t > rb[i - 1].t))
  ok('range: times step in whole seconds', rb.every((b, i) => i === 0 || (b.t - rb[i - 1].t) % 1000 === 0))
  ok('range: every closed bar spans exactly the range', rb.slice(0, -1).every((b) => Math.abs(b.h - b.l - 3) < 1e-9))
  ok('range: each bar opens where the last closed', rb.every((b, i) => i === 0 || Math.abs(b.o - rb[i - 1].c) < 1e-9))
  ok('range: bar times come from the source candles', rb[0].t === srcBars[0].t && rb[rb.length - 1].t >= srcBars[0].t)
  near('range: volume is conserved', rb.reduce((a, b) => a + b.v, 0), 200 * 4, 1e-6)
  eq('range: empty input', buildRangeBars([], 3).length, 0)
  eq('range: non-positive range', buildRangeBars(srcBars, 0).length, 0)
  // A single up candle 100 → 110 with range 2: walks O,L,H,C.
  const one = buildRangeBars([{ t: 60000, o: 100, h: 110, l: 100, c: 110, v: 8 }], 2)
  eq('range: one 10-point candle makes five 2-point bars', one.length, 5)
  eq('range: the first bar is 100 → 102', [one[0].o, one[0].c], [100, 102])
  eq('range: bars from one candle are a second apart', one.map((b) => b.t), [60000, 61000, 62000, 63000, 64000])
  // Deterministic prefix: a live tick only touches the tail.
  const a = buildRangeBars(srcBars.slice(0, 150), 3)
  const b = buildRangeBars(srcBars.slice(0, 151), 3)
  ok('range: adding a candle keeps the closed bars', a.slice(0, -1).every((x, i) => JSON.stringify(x) === JSON.stringify(b[i])))

  const flat = Array.from({ length: 30 }, (_, i) => ({ t: i * 60000, o: 100, h: 102, l: 98, c: 100, v: 1 }))
  near('atr: constant 4-point bars', atr(flat, 14), 4)
  eq('atr: needs more than len bars', atr(flat.slice(0, 14), 14), null)
  eq('nice: rounds up to two figures', niceRange(0.012345), 0.013)
  eq('nice: whole numbers', niceRange(123.4), 130)
  eq('auto: ATR of closed candles', autoRangeSize(flat), 4)
  ok('auto: the live candle does not move it', autoRangeSize(flat.concat([{ t: 31 * 60000, o: 100, h: 200, l: 1, c: 150, v: 1 }])) === 4)
  const floor = minSafeRange(srcBars)
  ok('floor: a tiny range is raised', floor > 0 && buildRangeBars(srcBars, floor).length <= MAX_RANGE_BARS * 1.1, floor)
}

// ------------------------------------------------------------------ renko
// Traditional renko on the close: a brick per full box, two boxes to reverse,
// and the last element may be the forming (partial) brick.
{
  // Candles from closes, one minute apart; each opens on the previous close.
  const fromCloses = (cs, v = 1) =>
    cs.map((c, i) => {
      const o = i ? cs[i - 1] : c
      return { t: i * 60000, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v }
    })
  const oc = (bars) => bars.map((b) => [b.o, b.c])
  const noWicks = (bars) => bars.every((b) => b.h === Math.max(b.o, b.c) && b.l === Math.min(b.o, b.c))

  eq('renko: empty input', buildRenko([], 1).length, 0)
  eq('renko: non-positive box', buildRenko(fromCloses([100, 105]), 0).length, 0)
  eq('renko: non-finite box', buildRenko(fromCloses([100, 105]), Infinity).length, 0)

  // Trend: one box per brick, each opening where the last closed.
  const up = buildRenko(fromCloses([100, 101, 102, 103.5]), 1)
  eq('renko: trend lays one brick per box, plus the forming one', oc(up), [[100, 101], [101, 102], [102, 103], [103, 103.5]])
  ok('renko: bricks have no wicks', noWicks(up))
  ok('renko: times strictly increase', up.every((b, i) => i === 0 || b.t > up[i - 1].t))
  ok('renko: times are whole seconds', up.every((b) => b.t % 1000 === 0))
  // The first brick's move began in candle 0; each later one in the candle
  // after the previous brick; the forming one in the candle that just closed a brick.
  eq('renko: each brick takes the candle its move began in', up.map((b) => b.t), [0, 120000, 180000, 181000])
  eq('renko: exactly on the box edge is a whole brick, no forming one', buildRenko(fromCloses([100, 101, 102]), 1).length, 2)

  // Reversal needs two boxes from the top of the last brick.
  const pull = buildRenko(fromCloses([100, 101, 102, 103, 102.2, 101.01]), 1)
  eq('renko: a pullback short of two boxes lays no brick', oc(pull.slice(0, 3)), [[100, 101], [101, 102], [102, 103]])
  eq('renko: only a forming reversal brick follows it', [pull.length, pull[3].o, pull[3].c], [4, 102, 101.01])
  const rev = buildRenko(fromCloses([100, 101, 102, 103, 102.2, 101]), 1)
  eq('renko: two boxes down reverses, from the bottom of the last brick', oc(rev).slice(-1), [[102, 101]])
  ok('renko: the reversal brick is a down brick', rev[rev.length - 1].c < rev[rev.length - 1].o)
  const cont = buildRenko(fromCloses([100, 101, 102, 103, 101, 100]), 1)
  eq('renko: after a reversal one box continues the new trend', oc(cont).slice(-2), [[102, 101], [101, 100]])
  const back = buildRenko(fromCloses([100, 101, 102, 103, 101, 102.5]), 1)
  eq('renko: going back up needs two boxes again', oc(back).slice(-2), [[102, 101], [102, 102.5]])
  const back2 = buildRenko(fromCloses([100, 101, 102, 103, 101, 103]), 1)
  eq('renko: two boxes up reverses back from the top of the down brick', oc(back2).slice(-1), [[102, 103]])
  // First move from the start can go either way with one box.
  eq('renko: the first brick can be down', oc(buildRenko(fromCloses([100, 99]), 1)), [[100, 99]])

  // Gaps: one close several boxes away lays several bricks, a second apart.
  const gap = buildRenko(fromCloses([100, 104.7]), 1)
  eq('renko: a 4.7-box jump lays four bricks and a forming one', oc(gap), [[100, 101], [101, 102], [102, 103], [103, 104], [104, 104.7]])
  eq('renko: bricks from one candle are a second apart', gap.map((b) => b.t), [0, 60000, 61000, 62000, 63000])
  const gapDown = buildRenko(fromCloses([100, 101, 102, 103, 98.5]), 1)
  eq('renko: a gap down reverses through several boxes', oc(gapDown).slice(3), [[102, 101], [101, 100], [100, 99], [99, 98.5]])
  ok('renko: completed bricks span exactly one box', gapDown.slice(0, -1).every((b) => Math.abs(b.h - b.l - 1) < 1e-9))
  ok('renko: gap bricks have no wicks', noWicks(gapDown))
  // A gap candle after a long quiet stretch keeps strictly rising times.
  const late = buildRenko([{ t: 0, o: 100, h: 100, l: 100, c: 100, v: 1 }, { t: 60000, o: 100, h: 130, l: 100, c: 130, v: 1 }, { t: 61000, o: 130, h: 131, l: 130, c: 131, v: 1 }], 1)
  ok('renko: times stay strictly increasing past a big gap', late.every((b, i) => i === 0 || b.t > late[i - 1].t), late.map((b) => b.t))

  // Tiny moves: nothing completes; at most a forming brick from the start.
  const tiny = buildRenko(fromCloses([100, 100.3, 99.8, 100.2, 99.9, 100.4]), 1)
  eq('renko: sub-box noise lays no whole brick', oc(tiny), [[100, 100.4]])
  eq('renko: back at the start there is nothing to draw', buildRenko(fromCloses([100, 100.3, 100]), 1).length, 0)
  const inside = buildRenko(fromCloses([100, 101, 102, 101.5]), 1)
  eq('renko: inside the last brick there is no forming brick', oc(inside), [[100, 101], [101, 102]])

  // Floating point: 0.1 + 0.2 must still be two whole 0.1 boxes.
  const fl = buildRenko(fromCloses([0.1, 0.2, 0.30000000000000004]), 0.1)
  eq('renko: float noise does not lose a brick', fl.length, 2)

  // Volume is conserved across completed and forming bricks.
  const wave = Array.from({ length: 300 }, (_, i) => {
    const o = 100 + Math.sin(i / 7) * 12 + i * 0.02
    const c = o + Math.cos(i / 3) * 1.5
    return { t: 1_000_000 + i * 60000, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 3 }
  })
  const wb = buildRenko(wave, 1.5)
  ok('renko: builds plenty of bricks', wb.length > 20, wb.length)
  ok('renko: volume is never invented', wb.reduce((a, b) => a + b.v, 0) <= 300 * 3 + 1e-6)
  near('renko: volume is conserved into the forming brick', buildRenko(fromCloses([100, 100.4, 101, 102.2, 104.5], 2), 1).reduce((a, b) => a + b.v, 0), 10, 1e-9)
  ok('renko: each brick opens on an edge of the last one', wb.every((b, i) => i === 0 || Math.abs(b.o - wb[i - 1].c) < 1e-9 || Math.abs(b.o - wb[i - 1].o) < 1e-9))
  ok('renko: completed bricks are all exactly one box', wb.slice(0, -1).every((b) => Math.abs(Math.abs(b.c - b.o) - 1.5) < 1e-9))
  ok('renko: wave times strictly increase', wb.every((b, i) => i === 0 || b.t > wb[i - 1].t))
  ok('renko: no wicks anywhere', noWicks(wb))

  // Live ticks: a new candle never rewrites the completed bricks, and a
  // forming brick keeps its time when it completes.
  const done = (bars) => {
    const lb = bars[bars.length - 1]
    return lb && Math.abs(Math.abs(lb.c - lb.o) - 1.5) > 1e-9 ? bars.slice(0, -1) : bars
  }
  const a = buildRenko(wave.slice(0, 200), 1.5)
  const b = buildRenko(wave.slice(0, 201), 1.5)
  const ad = done(a)
  ok('renko: adding a candle keeps the completed bricks', ad.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i])))
  const tick = (c) => fromCloses([100, 101, c])
  const forming = buildRenko(tick(101.6), 1)
  const grown = buildRenko(tick(101.9), 1)
  const closed = buildRenko(tick(102.0), 1)
  eq('renko: a tick grows the forming brick in place', [forming.length, grown.length, grown[1].t === forming[1].t, grown[1].c], [2, 2, true, 101.9])
  eq('renko: the forming brick completes with the same time', [closed.length, closed[1].t === forming[1].t, closed[1].c], [2, true, 102])
  eq('renko: a tick back inside removes the forming brick', buildRenko(tick(100.5), 1).length, 1)

  // Shared plumbing: the derived-bar dispatcher and its sizing.
  eq('derived: renko builds bricks', JSON.stringify(buildDerivedBars('renko', wave, 1.5)), JSON.stringify(wb))
  eq('derived: range builds range bars', JSON.stringify(buildDerivedBars('range', wave, 1.5)), JSON.stringify(buildRangeBars(wave, 1.5)))
  const ds = derivedSize(wave, null)
  eq('derived: auto size is ATR(14)', ds.size, Math.max(autoRangeSize(wave), minSafeRange(wave)))
  eq('derived: a manual size is used as is', derivedSize(wave, 2).size, Math.max(2, ds.floor))
  eq('derived: a tiny manual size is raised to the floor', derivedSize(wave, 1e-9).size, ds.floor)
  ok('derived: the floor keeps renko bounded', buildRenko(wave, ds.floor).length <= MAX_RANGE_BARS * 1.1)
}

// ------------------------------------------------- line break / kagi / P&F
// Non-time-based styles built from candles, on the range-bar time scheme.
{
  // A candle closing at c (opening at o, else at c), one per minute.
  const cl = (i, c, o = c) => ({ t: 60000 * (i + 1), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 })
  const series = (closes, first) => closes.map((c, i) => cl(i, c, i === 0 ? first : c))
  const oc = (bars) => bars.map((b) => [b.o, b.c])
  const sine = Array.from({ length: 400 }, (_, i) => {
    const o = 100 + Math.sin(i / 7) * 12 + Math.sin(i / 23) * 6
    const c = o + Math.sin(i * 1.7) * 1.5
    return { t: 1_000_000 + i * 60000, o, h: Math.max(o, c) + 0.8, l: Math.min(o, c) - 0.8, c, v: 2 }
  })
  const increasing = (bars) => bars.every((b, i) => i === 0 || b.t > bars[i - 1].t)
  const wholeSeconds = (bars) => bars.every((b, i) => i === 0 || (b.t - bars[i - 1].t) % 1000 === 0)
  const prefixKept = (a, b) => a.slice(0, -1).every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]))
  const isUp = (b) => b.c > b.o

  // ---- line break
  const lbSrc = series([101, 102, 103, 102.5, 99, 104, 98], 100)
  const lb = buildLineBreak(lbSrc, 3)
  eq('linebreak: lines and reversals', oc(lb), [[100, 101], [101, 102], [102, 103], [102, 99], [102, 104], [102, 98]])
  ok('linebreak: no wicks (high/low are the body)', lb.every((b) => b.h === Math.max(b.o, b.c) && b.l === Math.min(b.o, b.c)))
  eq('linebreak: each line keeps its candle time', lb.map((b) => b.t), [1, 2, 3, 5, 6, 7].map((i) => i * 60000))
  eq('linebreak: a quiet close carries its volume to the next line', lb.map((b) => b.v), [1, 1, 1, 2, 1, 1])
  // 100.5 breaks the low of the last 2 lines (101) but not of the last 3 (100).
  const lbN = series([101, 102, 103, 100.5], 100)
  eq('linebreak: 2-line break reverses sooner', buildLineBreak(lbN, 2).length, 4)
  eq('linebreak: 3-line break holds', buildLineBreak(lbN, 3).length, 3)
  eq('linebreak: default is 3 lines', oc(buildLineBreak(lbN)), oc(buildLineBreak(lbN, 3)))
  eq('linebreak: a flat open makes no line', buildLineBreak(series([100, 100], 100)).length, 0)
  eq('linebreak: empty input', buildLineBreak([]).length, 0)
  const lbs = buildLineBreak(sine)
  ok('linebreak: builds lines from a real series', lbs.length > 20, lbs.length)
  ok('linebreak: times strictly increase', increasing(lbs) && wholeSeconds(lbs))
  ok(
    'linebreak: every line continues from the close or reverses from the open',
    lbs.every((b, i) => i === 0 || b.o === lbs[i - 1].c || b.o === lbs[i - 1].o),
  )
  ok(
    'linebreak: a reversal clears the last 3 lines',
    lbs.every((b, i) => {
      if (i === 0 || isUp(b) === isUp(lbs[i - 1])) return true
      const look = lbs.slice(Math.max(0, i - 3), i)
      return isUp(b) ? b.c > Math.max(...look.map((x) => x.h)) : b.c < Math.min(...look.map((x) => x.l))
    }),
  )
  ok(
    'linebreak: adding a candle keeps the earlier lines',
    prefixKept(buildLineBreak(sine.slice(0, 300)), buildLineBreak(sine.slice(0, 301))),
  )
  eq(
    'linebreak: line count is clamped',
    [clampLineBreak(0), clampLineBreak(99), clampLineBreak('x'), clampLineBreak(4.7)],
    [1, 10, 3, 4],
  )

  // ---- kagi
  const kgSrc = series([101, 103, 104, 102.5, 101, 100, 103, 105, 102, 99, 101.5, 106], 100)
  const kg = buildKagi(kgSrc, 2)
  eq('kagi: segments turn on a 2-point reversal', oc(kg), [[100, 104], [104, 100], [100, 105], [105, 99], [99, 106]])
  eq('kagi: thickness at each start', kg.map((b) => b.aux.yang0), [true, true, true, true, false])
  eq(
    'kagi: thin below the prior waist, thick above the prior shoulder',
    kg.map((b) => b.aux.flip),
    [null, null, null, 100, 105],
  )
  eq('kagi: thickness at each end', kg.map(kagiYangEnd), [true, true, true, false, true])
  eq('kagi: segment times are the turning candles', kg.map((b) => b.t), [2, 5, 7, 9, 11].map((i) => i * 60000))
  eq('kagi: volume follows the current segment', kg.map((b) => b.v), [4, 2, 2, 2, 2])
  ok('kagi: high/low span the segment', kg.every((b) => b.h === Math.max(b.o, b.c) && b.l === Math.min(b.o, b.c)))
  const kgDown = buildKagi(series([97], 100), 2)
  eq('kagi: a first move down starts thin', [oc(kgDown), kgDown[0].aux.yang0], [[[100, 97]], false])
  // Percent: 5% of the turning price. 106 -> 101 is 4.7%, 106 -> 100 is 5.7%.
  eq('kagi: percent reversal holds under the amount', oc(buildKagi(series([103, 106, 101], 100), 5, true)), [[100, 106]])
  eq('kagi: percent reversal', oc(buildKagi(series([103, 106, 101, 100], 100), 5, true)), [[100, 106], [106, 100]])
  eq('kagi: no reversal amount', buildKagi(kgSrc, 0).length, 0)
  eq('kagi: empty input', buildKagi([], 2).length, 0)
  const ks = buildKagi(sine, 2)
  ok('kagi: builds segments from a real series', ks.length > 20, ks.length)
  ok('kagi: times strictly increase', increasing(ks) && wholeSeconds(ks))
  ok('kagi: directions alternate', ks.every((b, i) => i === 0 || isUp(b) !== isUp(ks[i - 1])))
  ok('kagi: each segment starts where the last turned', ks.every((b, i) => i === 0 || b.o === ks[i - 1].c))
  ok(
    'kagi: every turn is at least the reversal',
    ks.every((b, i) => i === ks.length - 1 || Math.abs(b.c - b.o) >= 2 - 1e-9),
  )
  ok('kagi: thickness carries across turns', ks.every((b, i) => i === 0 || b.aux.yang0 === kagiYangEnd(ks[i - 1])))
  ok(
    'kagi: flips happen inside the segment',
    ks.every((b) => b.aux.flip == null || (b.aux.flip >= b.l && b.aux.flip <= b.h)),
  )
  ok(
    'kagi: some segments do change thickness',
    ks.some((b) => b.aux.flip != null),
  )
  ok(
    'kagi: adding a candle keeps the earlier segments',
    prefixKept(buildKagi(sine.slice(0, 300), 2), buildKagi(sine.slice(0, 301), 2)),
  )
  near('kagi: volume is conserved', ks.reduce((a, b) => a + b.v, 0), sine.length * 2)

  // ---- point & figure
  const pfSrc = series([100.5, 102.2, 104, 102, 101, 100.9, 100, 98.5, 101.9, 102, 103], 100.5)
  const pf = buildPointFigure(pfSrc, 1, 3)
  eq('pnf: X, O, X columns on a 3-box reversal', oc(pf), [[100, 104], [103, 99], [100, 103]])
  eq('pnf: boxes per column', pf.map(pnfBoxes), [4, 4, 3])
  ok('pnf: the box size travels with each column', pf.every((b) => b.aux.box === 1))
  eq('pnf: column times are the candles they began in', pf.map((b) => b.t), [2, 7, 11].map((i) => i * 60000))
  near('pnf: volume is conserved', pf.reduce((a, b) => a + b.v, 0), pfSrc.length)
  // A single candle 100 -> 95 -> 110 -> 108 walks low first: an O column then an X column.
  const walk = buildPointFigure([{ t: 60000, o: 100, h: 110, l: 95, c: 108, v: 8 }], 1, 3)
  eq('pnf: one candle walked O-L-H-C', oc(walk), [[100, 95], [96, 110]])
  eq('pnf: columns from one candle are a second apart', walk.map((b) => b.t), [60000, 61000])
  near('pnf: one candle keeps its volume', walk.reduce((a, b) => a + b.v, 0), 8)
  ok('pnf: 1-box reversal turns sooner', buildPointFigure(sine, 0.5, 1).length > buildPointFigure(sine, 0.5, 3).length)
  eq('pnf: default is a 3-box reversal', oc(buildPointFigure(pfSrc, 1)), oc(pf))
  eq('pnf: no box size', buildPointFigure(pfSrc, 0).length, 0)
  eq('pnf: empty input', buildPointFigure([], 1).length, 0)
  const ps = buildPointFigure(sine, 0.5, 3)
  ok('pnf: builds columns from a real series', ps.length > 20, ps.length)
  ok('pnf: times strictly increase', increasing(ps) && wholeSeconds(ps))
  ok('pnf: X and O alternate', ps.every((b, i) => i === 0 || isUp(b) !== isUp(ps[i - 1])))
  ok(
    'pnf: prices sit on the box grid',
    ps.every((b) => [b.h, b.l].every((x) => Math.abs(x / 0.5 - Math.round(x / 0.5)) < 1e-6)),
  )
  ok('pnf: every reversal column has at least 3 boxes', ps.every((b, i) => i === 0 || pnfBoxes(b) >= 3))
  ok(
    'pnf: a new column starts one box from the old extreme',
    ps.every(
      (b, i) =>
        i === 0 ||
        (isUp(b)
          ? Math.abs(b.l - (ps[i - 1].l + 0.5)) < 1e-9
          : Math.abs(b.h - (ps[i - 1].h - 0.5)) < 1e-9),
    ),
  )
  ok(
    'pnf: adding a candle keeps the earlier columns',
    prefixKept(buildPointFigure(sine.slice(0, 300), 0.5), buildPointFigure(sine.slice(0, 301), 0.5)),
  )
  const tiny = buildPointFigure(
    sine.map((k) => ({ ...k, o: k.o / 1000, h: k.h / 1000, l: k.l / 1000, c: k.c / 1000 })),
    0.001,
  )
  ok(
    'pnf: a decimal box stays on the grid',
    tiny.length > 10 && tiny.every((b) => Math.abs((b.h - b.l) / 0.001 - pnfBoxes(b)) < 1e-6),
    tiny.length,
  )
  eq(
    'pnf: reversal is clamped',
    [clampPnfReversal(0), clampPnfReversal(20), clampPnfReversal('x'), clampPnfReversal(2)],
    [1, 10, 3, 2],
  )
}

// -------------------------------------------------------------- rate limits
{
  const future = Date.now() + 45_000
  noteLimitResponse(418, null, JSON.stringify({ code: -1003, msg: 'IP banned until ' + future }))
  ok('ratelimit: a ban sets a cooldown', isRateLimited())
  ok('ratelimit: cooldown is roughly the ban', Math.abs(cooldownLeft() - 45_000) < 2000, cooldownLeft())
  const before = cooldownLeft()
  noteLimitResponse(429, '5', '')
  ok('ratelimit: a shorter notice cannot shorten a longer ban', cooldownLeft() >= before - 50)
  noteLimitResponse(200, null, '')
  ok('ratelimit: a healthy response changes nothing', isRateLimited())
  noteLimitResponse(418, null, 'IP banned until 1000000000000') // long past
  ok('ratelimit: an expired ban is ignored', cooldownLeft() > 0)
}

// ----------------------------------------------------------------- format
{
  eq('fmt: price keeps cents above 100', pfmt(80123.456), '80,123.46')
  ok('fmt: sub-cent prices keep precision', pfmt(0.00000401).length > 6, pfmt(0.00000401))
  eq('fmt: compact millions', nfmt(2_400_000), '2.40M')
  eq('fmt: money compacts with a symbol', cfmt(2_400_000_000), '$2.40B')
  eq('fmt: market-wide totals compact to trillions', cfmt(2_882_240_000_000), '$2.88T')
  eq('fmt: non-finite is a dash, never NaN', pfmt(NaN), '—')
  eq('fmt: infinity is a dash', nfmt(Infinity), '—')
  eq('fmtUsd: thousands', fmtUsd(1500), '1.5K')
}

// ------------------------------------------------------------- heikin ashi
{
  const cs = [
    { t: 0, o: 10, h: 14, l: 9, c: 13, v: 5 },
    { t: 60000, o: 13, h: 15, l: 12, c: 12, v: 6 },
    { t: 120000, o: 12, h: 12.5, l: 8, c: 9, v: 7 },
  ]
  const ha = heikinAshi(cs)
  eq('ha: one bar per candle, same times and volumes', ha.map((b) => [b.t, b.v]), cs.map((c) => [c.t, c.v]))
  near('ha: first open is (O + C) / 2', ha[0].o, 11.5)
  near('ha: close is (O + H + L + C) / 4', ha[0].c, 11.5)
  near('ha: next open averages the previous HA bar', ha[1].o, (ha[0].o + ha[0].c) / 2)
  near('ha: second close', ha[1].c, 13)
  near('ha: high takes the real high when above', ha[1].h, 15)
  near('ha: third open', ha[2].o, (ha[1].o + ha[1].c) / 2)
  near('ha: low takes the real low', ha[2].l, 8)
  // High/low must enclose the HA body even when the body pokes past the candle.
  const gap = heikinAshi([
    { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { t: 60000, o: 50, h: 51, l: 49, c: 50, v: 1 },
  ])
  near('ha: high is at least the HA open', gap[1].h, gap[1].o)
  ok('ha: low is at most the HA close', gap[1].l <= gap[1].c)
  eq('ha: empty input', heikinAshi([]).length, 0)
  eq('ha: next() matches the batch', heikinAshiNext(ha[1], cs[2]), ha[2])

  // Live ticks: the memo must equal a full rebuild after the last bar moves
  // and after a new bar is appended, with the source mutated in place.
  const live = Array.from({ length: 50 }, (_, i) => {
    const o = 100 + Math.sin(i / 4) * 5
    const c = o + ((i % 5) - 2)
    return { t: i * 60000, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }
  })
  heikinAshiOf(live, true)
  const last = live[live.length - 1]
  const tick = { ...last, c: last.c + 3, h: Math.max(last.h, last.c + 3) }
  live[live.length - 1] = tick
  eq('ha: live tick updates the last bar against the previous HA bar', heikinAshiBar(live, tick), heikinAshi(live)[49])
  eq('ha: memo equals a full rebuild after a tick', heikinAshiOf(live), heikinAshi(live))
  const next = { t: 50 * 60000, o: tick.c, h: tick.c + 2, l: tick.c - 1, c: tick.c + 1, v: 2 }
  live.push(next)
  eq('ha: a new bar opens from the previous HA bar', heikinAshiBar(live, next), heikinAshi(live)[50])
  eq('ha: memo equals a full rebuild after an append', heikinAshiOf(live), heikinAshi(live))
  live.shift()
  eq('ha: dropping the oldest bar rebuilds', heikinAshiOf(live), heikinAshi(live))
  const outside = { t: 99 * 60000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }
  eq('ha: a candle past the array builds on the last HA bar', heikinAshiBar(live, outside), heikinAshiNext(heikinAshi(live)[live.length - 1], outside))
}

// ----------------------------------------------------------------- columns
{
  eq('columns: up when the close is above the previous close', columnUp(10, 12, 11), true)
  eq('columns: down when below, whatever the open', columnUp(10, 8, 9), false)
  eq('columns: an unchanged close counts as up', columnUp(10, 12, 10), true)
  eq('columns: the first bar compares with its own open', columnUp(null, 10, 9), false)
  eq('columns: a missing previous close falls back to the open', columnUp(undefined, 9, 10), true)
}

// ------------------------------------------------------------------ venues
{
  ok('venues: several are registered', VENUES.length >= 10, VENUES.length)
  const ids = VENUES.map((v) => v.id)
  eq('venues: ids are unique', ids.length, new Set(ids).size)
  ok('venues: every one maps BTC or says it cannot', VENUES.every((v) => {
    const s = v.symbol('BTC')
    return s === null || (typeof s === 'string' && s.length > 2)
  }))
  ok('venues: every one builds at least one https URL', VENUES.every((v) => {
    const s = v.symbol('BTC')
    if (!s) return true
    const u = v.urls(s)
    return u.length > 0 && u.every((x) => x.startsWith('https://'))
  }))
  ok('venues: parsers survive junk without throwing', VENUES.every((v) => {
    try {
      const q = v.parse([undefined, undefined])
      return q && (q.last === undefined || typeof q.last === 'number')
    } catch {
      return false
    }
  }))
  ok('venues: Kraken calls bitcoin XBT', VENUES.find((v) => v.id === 'kraken').symbol('BTC').startsWith('XBT'))
  ok('venues: Deribit has no market for an altcoin', VENUES.find((v) => v.id === 'deribit').symbol('PEPE') === null)
  ok('venues: USD-quoted ones are flagged', isUsdQuoted('gemini') && !isUsdQuoted('binance'))
}

// ---------------------------------------------------------------- whale orders
{
  const ag = (a, p, q, T, m) => ({ a, p: String(p), q: String(q), T, m })
  // One market buy sweeping three levels at the same instant, then an
  // unrelated sell at the same millisecond, then a later buy.
  const o = groupAggTrades([
    ag(10, 100, 1, 5000, false),
    ag(11, 101, 2, 5000, false),
    ag(12, 102, 1, 5000, false),
    ag(13, 101, 5, 5000, true),
    ag(14, 100, 1, 5001, false),
  ])
  eq('whales: fills of one taker order become one order', o.length, 3)
  eq('whales: order spans its aggTrade ids', [o[0].a0, o[0].a1, o[0].n], [10, 12, 3])
  near('whales: order notional is the sum of its fills', o[0].usd, 100 + 202 + 102)
  near('whales: order price is the volume-weighted average', o[0].p, 404 / 4)
  eq('whales: side change splits the order', o[1].side, 'sell')
  eq('whales: new timestamp starts a new order', o[2].a0, 14)
  eq('whales: an id gap is never bridged', groupAggTrades([ag(1, 1, 1, 9, false), ag(3, 1, 1, 9, false)]).length, 2)
  eq('whales: junk prints are skipped', groupAggTrades([ag(1, 0, 1, 9, false), ag(2, 5, 'x', 9, false)]).length, 0)

  eq('whales: BTC-sized turnover gets a $100k floor', autoThreshold(2e9), 100_000)
  eq('whales: threshold never drops under $10k', autoThreshold(1e6), 10_000)
  eq('whales: threshold never exceeds $1M', autoThreshold(1e12), 1_000_000)
  eq('whales: unknown volume falls back to $50k', autoThreshold(0), 50_000)

  near('whales: threshold order draws at the minimum radius', bubbleRadius(1e5, 1e5), 3.5)
  near('whales: 4x the dollars is 2x the radius (area ∝ notional)', bubbleRadius(4e5, 1e5), 7)
  eq('whales: radius is capped', bubbleRadius(1e12, 1e5), 36)
}

// ---------------------------------------------------------------- failover chain
{
  const up = (v) => async () => v
  const down = async () => {
    throw new Error('down')
  }
  let t = 0
  const now = () => t

  const c1 = new ProviderChain([
    { id: 'a', name: 'A', fn: up(1) },
    { id: 'b', name: 'B', fn: up(2) },
  ])
  const r1 = await c1.get('x')
  eq('chain: healthy primary answers', [r1.data, r1.provider, r1.freshness, r1.primary], [1, 'a', 'LIVE', true])

  const c2 = new ProviderChain([
    { id: 'a', name: 'A', fn: down },
    { id: 'b', name: 'B', fn: down },
    { id: 'c', name: 'C', fn: up(3) },
  ])
  const r2 = await c2.get('x')
  eq('chain: walks the order to the first healthy fallback', [r2.data, r2.name], [3, 'C'])
  eq('chain: fallback data is labelled DELAYED, not LIVE', [r2.freshness, r2.primary], ['DELAYED', false])

  const c3 = new ProviderChain(
    [
      { id: 'a', name: 'A', fn: async () => null },
      { id: 'b', name: 'B', fn: up(2) },
    ],
    { breakerFailures: 1 },
  )
  await c3.get('x')
  ok('chain: "not served here" (null) skips without opening the breaker', !c3.isOpen('a'))

  let ok1 = true
  const c4 = new ProviderChain(
    [
      {
        id: 'a',
        name: 'A',
        fn: async () => {
          if (!ok1) throw new Error('down')
          return 1
        },
      },
    ],
    { staleTtlMs: 100, now },
  )
  await c4.get('x')
  ok1 = false
  t = 50
  eq('chain: all down → last good copy is STALE', (await c4.get('x')).freshness, 'STALE')
  t = 500
  const r4 = await c4.get('x')
  eq('chain: an old last good copy is OFFLINE but still returned', [r4.freshness, r4.data], ['OFFLINE', 1])
  ok('chain: STALE result carries the failure reason', /down/.test(r4.error))
  let threw = false
  try {
    await c4.get('never-cached')
  } catch (e) {
    threw = /All providers failed/.test(e.message)
  }
  ok('chain: nothing cached and all down → throws', threw)
  ok('chain: cache is per argument list', !!c4.cached('x') && !c4.cached('y'))

  // Circuit breaker: after N consecutive failures the provider is skipped for
  // the cooldown, then tried again.
  t = 0
  let calls = 0
  const c5 = new ProviderChain(
    [
      {
        id: 'a',
        name: 'A',
        fn: async () => {
          calls++
          throw new Error('x')
        },
      },
      { id: 'b', name: 'B', fn: up(2) },
    ],
    { breakerFailures: 2, breakerCooldownMs: 1000, now },
  )
  await c5.get()
  await c5.get()
  await c5.get()
  eq('breaker: opens after consecutive failures', calls, 2)
  ok('breaker: reports open', c5.isOpen('a'))
  eq('breaker: fallback keeps answering while open', (await c5.get()).data, 2)
  t = 1001
  await c5.get()
  eq('breaker: half-opens after the cooldown', calls, 3)

  let flaky = 0
  const c6 = new ProviderChain(
    [
      {
        id: 'a',
        name: 'A',
        fn: async () => {
          if (flaky++ % 2 === 0) throw new Error('x')
          return 1
        },
      },
      { id: 'b', name: 'B', fn: up(2) },
    ],
    { breakerFailures: 2, now },
  )
  for (let i = 0; i < 6; i++) await c6.get()
  ok('breaker: a success resets the failure count', !c6.isOpen('a'))

  // Badge freshness
  eq('fresh: recent live tick is LIVE', klineFreshness({ freshness: 'DELAYED', ts: 0 }, 1000, 5000), 'LIVE')
  eq('fresh: fresh primary snapshot before the first tick is LIVE', klineFreshness({ freshness: 'LIVE', ts: 0 }, 0, 10_000), 'LIVE')
  eq('fresh: fallback snapshot with no live tick is DELAYED', klineFreshness({ freshness: 'DELAYED', ts: 0 }, 0, 10_000), 'DELAYED')
  eq('fresh: stream gone quiet → DELAYED', klineFreshness({ freshness: 'LIVE', ts: 0 }, 1000, 40_000), 'DELAYED')
  eq('fresh: old snapshot, no stream → STALE', klineFreshness({ freshness: 'LIVE', ts: 0 }, 0, 6 * 60_000), 'STALE')
  eq('fresh: cached copy stays STALE', klineFreshness({ freshness: 'STALE', ts: 9000 }, 0, 10_000), 'STALE')
  eq('fresh: nothing at all is OFFLINE', klineFreshness(null, 0, 10_000), 'OFFLINE')
}

// ---------------------------------------------------------------- pacer + kline rows
{
  let clock = 1000
  const waits = []
  const pace = createPacer(150, () => clock, async (ms) => {
    waits.push(ms)
  })
  await pace()
  await pace()
  await pace()
  eq('pacer: first call goes at once, the next wait one and two gaps', waits, [150, 300])
  clock = 5000
  waits.length = 0
  await pace()
  eq('pacer: after a quiet spell a call is not held back', waits, [])
  await pace()
  eq('pacer: and the one after it waits a single gap', waits, [150])

  const rows = toKlineRows([
    { t: 60000, o: 1, h: 3, l: 0.5, c: 2, v: 10 },
    { t: 120000, o: 2, h: 4, l: 1.5, c: 3, v: 20 },
  ])
  eq('kline rows: Binance REST row shape, oldest first', rows, [
    [60000, 1, 3, 0.5, 2, 10],
    [120000, 2, 4, 1.5, 3, 20],
  ])
  eq('kline rows: close is index 4, as callers read it', rows.map((k) => Number(k[4])), [2, 3])
  eq('kline rows: empty in, empty out', toKlineRows([]), [])
}

// ---------------------------------------------------------------- kline hub
{
  const sockets = []
  class FakeWS {
    constructor(url) {
      this.url = url
      this.sent = []
      this.onopen = this.onmessage = this.onclose = this.onerror = null
      sockets.push(this)
    }
    send(m) {
      this.sent.push(JSON.parse(m))
    }
    close() {
      if (this.onclose) this.onclose()
    }
    accept() {
      if (this.onopen) this.onopen()
    }
    push(stream, k) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify({ stream, data: { e: 'kline', k } }) })
    }
  }
  const prevWS = globalThis.WebSocket
  globalThis.WebSocket = FakeWS
  const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
  const params = (ws, method) => ws.sent.filter((m) => m.method === method).flatMap((m) => m.params)
  try {
    const hub = new KlineHub({ url: 'wss://test/stream', flushMs: 0, idleCloseMs: 0 })
    const got = []
    const offA = hub.subscribe('BTCUSDT', '1m', (d) => got.push(['a', d.k.c]))
    const offB = hub.subscribe('BTCUSDT', '1m', (d) => got.push(['b', d.k.c]))
    const offC = hub.subscribe('ETHUSDT', '15m', () => {})
    const offD = hub.subscribe('SOLUSDT', '1h', () => {})
    eq('hub: four charts, one socket', sockets.length, 1)
    eq('hub: ref-counts — two charts on one stream is one stream', hub.streamCount, 3)
    const ws = sockets[0]
    ws.accept()
    eq('hub: subscribes every wanted stream on open, once each', params(ws, 'SUBSCRIBE').sort(), [
      'btcusdt@kline_1m',
      'ethusdt@kline_15m',
      'solusdt@kline_1h',
    ])
    eq('hub: opening costs a single frame', ws.sent.length, 1)

    ws.push('btcusdt@kline_1m', { t: 60000, c: '1.5' })
    eq('hub: fans a kline out to every subscriber of its stream', got, [
      ['a', '1.5'],
      ['b', '1.5'],
    ])
    ws.push('dogeusdt@kline_1m', { t: 60000, c: '9' })
    eq('hub: ignores streams nobody wants', got.length, 2)

    offA()
    offA() // idempotent
    await tick()
    eq('hub: dropping one of two subscribers keeps the stream', params(ws, 'UNSUBSCRIBE'), [])
    ws.push('btcusdt@kline_1m', { t: 60000, c: '2' })
    eq('hub: the remaining subscriber still receives', got[got.length - 1], ['b', '2'])
    offB()
    await tick()
    eq('hub: last subscriber gone → UNSUBSCRIBE', params(ws, 'UNSUBSCRIBE'), ['btcusdt@kline_1m'])

    const offE = hub.subscribe('XRPUSDT', '5m', () => {})
    const offF = hub.subscribe('ADAUSDT', '5m', () => {})
    await tick()
    const lastSub = ws.sent.filter((m) => m.method === 'SUBSCRIBE').pop()
    eq('hub: a burst of subscriptions coalesces into one frame', lastSub.params.sort(), [
      'adausdt@kline_5m',
      'xrpusdt@kline_5m',
    ])
    eq('hub: live changes stay on the same socket', sockets.length, 1)

    // Reconnect: the hub opens a fresh socket and replays what is wanted.
    const rnd = Math.random
    Math.random = () => 0
    ws.close()
    eq('hub: reports disconnected', hub.connected, false)
    await tick(600) // first backoff step is 500ms
    Math.random = rnd
    eq('hub: reconnects after a drop', sockets.length, 2)
    const ws2 = sockets[1]
    ws2.accept()
    eq('hub: re-subscribes everything after reconnect', params(ws2, 'SUBSCRIBE').sort(), [
      'adausdt@kline_5m',
      'ethusdt@kline_15m',
      'solusdt@kline_1h',
      'xrpusdt@kline_5m',
    ])
    const before = got.length
    hub.subscribe('ETHUSDT', '15m', (d) => got.push(['e', d.k.c]))
    ws.push('ethusdt@kline_15m', { t: 1, c: '1' }) // the replaced socket must be inert
    eq('hub: a replaced socket can no longer deliver', got.length, before)

    offC()
    offD()
    offE()
    offF()
  } finally {
    globalThis.WebSocket = prevWS
  }

  globalThis.WebSocket = FakeWS
  try {
    const idle = new KlineHub({ url: 'wss://test/stream', flushMs: 0, idleCloseMs: 0 })
    const n0 = sockets.length
    const off = idle.subscribe('BTCUSDT', '1m', () => {})
    sockets[sockets.length - 1].accept()
    eq('hub: connected once accepted', idle.connected, true)
    off()
    await tick(10)
    eq('hub: idle hub closes its socket', idle.connected, false)
    await tick(600)
    eq('hub: and does not reconnect with nothing wanted', sockets.length, n0 + 1)

    const capHub = new KlineHub({ url: 'wss://test/stream', flushMs: 0 })
    for (let i = 0; i < MAX_HUB_STREAMS; i++) capHub.subscribe('S' + i + 'USDT', '1m', () => {})
    let capped = false
    try {
      capHub.subscribe('XUSDT', '1m', () => {})
    } catch (e) {
      capped = /limit/.test(e.message)
    }
    ok('hub: enforces the stream cap', capped)
    ok('hub: an existing stream can always gain a subscriber', !!capHub.subscribe('S0USDT', '1m', () => {}))
  } finally {
    globalThis.WebSocket = prevWS
  }
}

// ---------------------------------------------------------------- alerts
{
  const { evalPrice, evalTechnical, evalWatchlist, stepRule, normalizeRules, rearm, ALERT_LIMITS } = alerts
  const r = (o) => ({ id: 'x', kind: 'price', sym: 'BTCUSDT', enabled: true, created: 0, condition: 'above', value: 0, once: false, triggerCount: 0, ...o })
  const kl = (closes) => closes.map((c, i) => ({ t: i * 60000, o: c, h: c + 1, l: c - 1, c, v: 1 }))
  const ramp = (n, f) => Array.from({ length: n }, (_, i) => f(i))

  eq('alerts: limits', ALERT_LIMITS, { price: 1000, technical: 1000, watchlist: 15 })
  // crosses need a previous value on the other side (ported from Pro's engine.test.ts)
  ok('alerts: crosses above fires on the cross', evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, 99, 0))
  ok('alerts: crosses above needs a previous price', !evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, undefined, 0))
  ok('alerts: crosses above ignores a start above', !evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, 100.5, 0))
  ok('alerts: crosses below', evalPrice(r({ condition: 'crosses_below', value: 100 }), 99, 100, 0))
  ok('alerts: above is a level (inclusive, as old alerts)', evalPrice(r({ condition: 'above', value: 100 }), 100, undefined, 0))
  ok('alerts: below is a level', evalPrice(r({ condition: 'below', value: 100 }), 90, 80, 0) && !evalPrice(r({ condition: 'below', value: 100 }), 110, 80, 0))
  ok('alerts: 24h % above', evalPrice(r({ condition: 'pct_change_24h_above', value: 5 }), 1, 1, 6.1))
  ok('alerts: 24h % below', evalPrice(r({ condition: 'pct_change_24h_below', value: -5 }), 1, 1, -7) && !evalPrice(r({ condition: 'pct_change_24h_below', value: -5 }), 1, 1, undefined))

  // technical (ported: a steady climb is overbought)
  const up = kl(ramp(100, (i) => 100 + i))
  ok('alerts: rsi above on a steady climb', evalTechnical(r({ kind: 'technical', condition: 'rsi_above', value: 70 }), up))
  ok('alerts: rsi below false on a climb', !evalTechnical(r({ kind: 'technical', condition: 'rsi_below', value: 30 }), up))
  ok('alerts: too few candles never fire', !evalTechnical(r({ kind: 'technical', condition: 'rsi_above', value: 70 }), up.slice(0, 30)))
  ok('alerts: close above sma on a climb', evalTechnical(r({ kind: 'technical', condition: 'close_above_sma', value: 20 }), up))
  ok('alerts: close below sma false on a climb', !evalTechnical(r({ kind: 'technical', condition: 'close_below_sma', value: 20 }), up))
  // A long fall then a sharp final jump: the fast EMA crosses the slow one on the last bar.
  const vee = kl([...ramp(99, (i) => 200 - i), 400])
  ok('alerts: ema cross up on the last bar', evalTechnical(r({ kind: 'technical', condition: 'ema_cross_up', value: 3, value2: 10 }), vee))
  ok('alerts: no ema cross down there', !evalTechnical(r({ kind: 'technical', condition: 'ema_cross_down', value: 3, value2: 10 }), vee))
  ok('alerts: macd cross up on the reversal bar', evalTechnical(r({ kind: 'technical', condition: 'macd_cross_up' }), vee))
  ok('alerts: no macd cross on a straight climb', !evalTechnical(r({ kind: 'technical', condition: 'macd_cross_up' }), up))
  const peak = kl([...ramp(99, (i) => 100 + i), 0])
  ok('alerts: macd cross down on a collapse', evalTechnical(r({ kind: 'technical', condition: 'macd_cross_down' }), peak))

  // watchlist
  eq(
    'alerts: watchlist any above',
    evalWatchlist(r({ kind: 'watchlist', condition: 'any_pct_24h_above', value: 5 }), [{ symbol: 'A', pct: 6 }, { symbol: 'B', pct: 1 }]),
    { hit: true, matched: ['A'], detail: 'A 6.00%' },
  )
  eq('alerts: watchlist any below', evalWatchlist(r({ kind: 'watchlist', condition: 'any_pct_24h_below', value: -3 }), [{ symbol: 'A', pct: -4 }, { symbol: 'B', pct: 1 }]).matched, ['A'])
  ok('alerts: watchlist count needs value2 symbols', !evalWatchlist(r({ kind: 'watchlist', condition: 'count_above_pct', value: 2, value2: 3 }), [{ symbol: 'A', pct: 3 }, { symbol: 'B', pct: 4 }]).hit)
  ok('alerts: watchlist count hit', evalWatchlist(r({ kind: 'watchlist', condition: 'count_above_pct', value: 2, value2: 2 }), [{ symbol: 'A', pct: 3 }, { symbol: 'B', pct: 4 }]).hit)

  // firing: edges, once, repeat + cooldown
  const t0 = 1_000_000
  const s1 = stepRule(r({ once: true }), true, t0)
  ok('alerts: once fires on the first true', s1.fire && s1.next.enabled === false && s1.next.triggerCount === 1)
  ok('alerts: a disabled rule never fires', !stepRule(s1.next, true, t0 + 1).fire)
  const s2 = stepRule(r({ once: false, cooldownMin: 5 }), true, t0)
  ok('alerts: repeat fires on the edge', s2.fire && s2.next.enabled)
  ok('alerts: holding true is not a new edge', !stepRule(s2.next, true, t0 + 10 * 60000).fire)
  const off = stepRule(s2.next, false, t0 + 60000).next
  const held = stepRule(off, true, t0 + 2 * 60000)
  ok('alerts: an edge inside the cooldown is held', !held.fire && held.next.lastState === false)
  ok('alerts: the held edge fires once the cooldown ends', stepRule(held.next, true, t0 + 6 * 60000).fire)
  const w1 = stepRule(r({ kind: 'watchlist', condition: 'any_pct_24h_above', value: 5, once: false, cooldownMin: 0 }), true, t0, ['A'])
  ok('alerts: watchlist fires for a new symbol', w1.fire)
  ok('alerts: same symbols do not refire', !stepRule(w1.next, true, t0 + 1, ['A']).fire)
  ok('alerts: another symbol joining refires', stepRule(w1.next, true, t0 + 2, ['A', 'B']).fire)
  ok('alerts: rearm clears the edge memory', rearm(s1.next).enabled && rearm(s1.next).lastState === undefined)

  // migration of the old saved price alerts
  const mig = normalizeRules([
    { sym: 'BTCUSDT', dir: 'above', price: 70000, fired: false, created: 5 },
    { sym: 'ethusdt', dir: 'below', price: '2500', fired: true, created: 6 },
    { sym: '', dir: 'above', price: 1 },
    null,
    { kind: 'technical', sym: 'SOLUSDT', condition: 'rsi_above', value: 70, once: false, enabled: true, id: 'k' },
    { kind: 'price', sym: 'X', condition: 'rsi_above', value: 1 },
  ])
  eq('alerts: migration keeps valid entries only', mig.length, 3)
  eq('alerts: old above becomes a once level rule', [mig[0].kind, mig[0].condition, mig[0].value, mig[0].once, mig[0].enabled], ['price', 'above', 70000, true, true])
  eq('alerts: old fired alert stays spent', [mig[1].sym, mig[1].condition, mig[1].enabled, mig[1].triggerCount], ['ETHUSDT', 'below', false, 1])
  eq('alerts: migrated ids are stable', normalizeRules([{ sym: 'BTCUSDT', dir: 'above', price: 1, created: 5 }])[0].id, mig[0].id)
  eq('alerts: new rules default their timeframe', mig[2].tf, '15m')
  eq('alerts: junk storage is empty', normalizeRules({ a: 1 }), [])
}

// ---------------------------------------------------------- volume profile
{
  const k = (i, o, h, l, c, v) => ({ t: i * 60000, o, h, l, c, v })
  // One up bar spanning 100..110 in 10 rows: its volume lands evenly across
  // the whole range, not in the single row holding its close.
  const one = buildVolumeProfile([k(0, 100, 110, 100, 109, 100)], 10, 0.7)
  eq('vp: rows honoured', one.buckets.length, 10)
  near('vp: range low', one.lo, 100)
  near('vp: row size', one.binSize, 1)
  ok('vp: volume spread over high–low', one.buckets.every((x) => Math.abs(x - 10) < 1e-9), one.buckets)
  near('vp: volume conserved', one.totalVol, 100)
  near('vp: up bar is all buy', one.buy.reduce((a, b) => a + b, 0), 100)
  near('vp: up bar has no sell', one.sell.reduce((a, b) => a + b, 0), 0)

  // A heavy down bar parked in one middle row, light up bars covering the range.
  const bars = [
    k(0, 100, 110, 100, 101, 10),
    k(1, 105.5, 105.9, 105.1, 105.2, 500),
    k(2, 101, 110, 100, 109, 10),
  ]
  const vp = buildVolumeProfile(bars, 10, 0.7)
  eq('vp: POC is the heavy row', vp.pocIdx, 5)
  near('vp: heavy down bar counted as sell', vp.sell[5], 500)
  near('vp: light up bars counted as buy', vp.buy[5], 2)
  near('vp: buy + sell = total per row', vp.buy[5] + vp.sell[5], vp.buckets[5])
  ok('vp: value area brackets POC', vp.valIdx <= vp.pocIdx && vp.vahIdx >= vp.pocIdx, [vp.valIdx, vp.vahIdx])
  const inVa = vp.buckets.slice(vp.valIdx, vp.vahIdx + 1).reduce((a, b) => a + b, 0)
  ok('vp: value area holds >= 70%', inVa >= vp.totalVol * 0.7 - 1e-9, inVa / vp.totalVol)
  const wider = buildVolumeProfile(bars, 10, 0.99)
  ok('vp: bigger VA% widens the area', wider.vahIdx - wider.valIdx > vp.vahIdx - vp.valIdx, [wider.valIdx, wider.vahIdx])

  // Close-binning (the old behaviour) would put the POC in the close's row;
  // high–low distribution keeps it where the volume actually traded.
  const skew = buildVolumeProfile([k(0, 100, 110, 100, 110, 100), k(1, 102, 104, 102, 103, 20)], 10, 0.7)
  ok('vp: POC not dragged to the close row', skew.pocIdx >= 2 && skew.pocIdx <= 3, skew.pocIdx)

  eq('vp: empty input gives no profile', buildVolumeProfile([], 10, 0.7), null)
  near('vp: flat range still profiles its volume', buildVolumeProfile([k(0, 5, 5, 5, 5, 3)], 12, 0.7).totalVol, 3)
  eq('vp: rows clamp low', clampRows(2), 8)
  eq('vp: rows clamp high', clampRows(999), 200)
  eq('vp: rows fall back on junk', clampRows(NaN), 48)
  eq('vp: VA% clamp', clampValueArea(150), 99)
  eq('vp: default rows', buildVolumeProfile(bars).buckets.length, 48)
  const many = []
  for (let i = 0; i < 3000; i++) many.push(k(i, 100, 101, 99, 100.5, 1))
  near('vp: default lookback is the last 24h', computeVolumeProfile(many, 20, 0.7).totalVol, 1441, 1e-6)
  near('vp: lookback capped at 1500 bars', computeVolumeProfile(many, 20, 0.7, Infinity).totalVol, 1500, 1e-6)
}

// -------------------------------------------------------------- indicators
{
  const M = await import(src('features/charts/indicators/math.ts'))
  const { computeAll, createsCycle } = await import(src('features/charts/indicators/graph.ts'))
  // A clean staircase: low = i, high = i + 2, close = i + 1.
  const stair = (n) => Array.from({ length: n }, (_, i) => ({ t: i * 60000, o: i + 1, h: i + 2, l: i, c: i + 1, v: 1 }))
  const k = (h, l, c, i = 0) => ({ t: i * 60000, o: c, h, l, c, v: 1 })

  // ADX / DMI. Every bar makes +DM 1 and -DM 0 against a true range of 2,
  // so +DI = 50, -DI = 0, DX = ADX = 100.
  const d = M.dmi(stair(60), 14, 14)
  near('adx: +DI on a staircase', d.plus[59], 50)
  near('adx: -DI on a staircase', d.minus[59], 0)
  near('adx: ADX on a staircase', d.adx[59], 100)
  eq('adx: +DI warms up after 14 moves', [d.plus[13], d.plus[14] != null], [null, true])
  eq('adx: ADX warms up after 14 more', [d.adx[26], d.adx[27] != null], [null, true])
  // By hand, length 1: bar 1 has +DM 2 over TR 3; bar 2 has -DM 2 over TR 6.
  const d1 = M.dmi([k(10, 8, 9, 0), k(12, 9, 11, 1), k(13, 7, 8, 2)], 1, 2)
  near('adx: hand-checked +DI', d1.plus[1], 200 / 3)
  near('adx: hand-checked -DI', d1.minus[2], 100 / 3)
  near('adx: hand-checked ADX (mean of two 100 DX)', d1.adx[2], 100)

  // Ichimoku on the staircase: conversion(9) = i - 3, base(26) = i - 11.5,
  // span A = (i - 7.25) and span B = (i - 24.5) shifted forward 25 bars,
  // lagging = close 25 bars ahead.
  const ich = M.ichimoku(stair(100), 9, 26, 52, 26)
  near('ichimoku: conversion line', ich.conversion[90], 87)
  near('ichimoku: base line', ich.base[90], 78.5)
  near('ichimoku: span A is displaced', ich.spanA[90], 57.75)
  near('ichimoku: span B is displaced', ich.spanB[90], 40.5)
  near('ichimoku: lagging span looks back', ich.lagging[50], 76)
  eq('ichimoku: span A waits for base + displacement', [ich.spanA[49], ich.spanA[50] != null], [null, true])
  eq('ichimoku: span B waits for 52 + displacement', [ich.spanB[75], ich.spanB[76] != null], [null, true])
  eq('ichimoku: no lagging span for the last bars', ich.lagging[80], null)
  near('ichimoku: displacement 1 is the unshifted Pro plot', M.ichimoku(stair(100), 9, 26, 52, 1).spanA[90], 82.75)

  // Stoch RSI. A one-way series pins RSI at 100: flat range, so 50.
  const up = Array.from({ length: 60 }, (_, i) => 100 + i)
  const s1 = M.stochRsi(up, 14, 14, 3, 3)
  near('stochrsi: flat RSI reads 50', s1.k[59], 50)
  near('stochrsi: D of a flat K', s1.d[59], 50)
  // Falling then rising: RSI climbs every bar of the rise, so each bar is the
  // top of its range and K = D = 100.
  const vee = [...Array.from({ length: 30 }, (_, i) => 200 - i), ...Array.from({ length: 30 }, (_, i) => 171 + i * 2)]
  const s2 = M.stochRsi(vee, 14, 14, 3, 3)
  near('stochrsi: rising RSI tops out at 100', s2.k[59], 100)
  near('stochrsi: D follows', s2.d[59], 100)
  eq('stochrsi: warm-up is rsi + stoch + smoothing', [s1.k[28], s1.k[29] != null, s1.d[30], s1.d[31] != null], [null, true, null, true])

  // Parabolic SAR, stepped by hand on the staircase (start/inc 0.02, max 0.2):
  // bar 1 seeds at low[0] = 0 with EP 3. Bar 2: 0 + .02·3 = 0.06, but SAR may
  // not sit above the last two lows, so it clamps to low[0] = 0; EP 4, AF .04.
  // Bar 3: 0 + .04·4 = 0.16, under lows 1 and 2, so it stands.
  const sar = M.psar(stair(12), 0.02, 0.02, 0.2)
  eq('psar: nothing on the first bar', sar[0], null)
  near('psar: seeds at the prior low', sar[1], 0)
  near('psar: clamped to the two-bar low', sar[2], 0)
  near('psar: accelerates', sar[3], 0.16)
  ok('psar: stays under an uptrend', sar.slice(1).every((v, i) => v < i + 1), sar)
  const flip = M.psar([...stair(10), k(5, 1, 2, 10)], 0.02, 0.02, 0.2)
  near('psar: a break flips it to the extreme point', flip[10], 11)
  const capped = M.psar(stair(80), 0.02, 0.02, 0.2)
  ok('psar: acceleration is capped', capped[79] - capped[78] < 2, capped[79] - capped[78])

  // Donchian by hand.
  const dc = M.donchian(
    [k(3, 1, 2), k(5, 2, 3), k(4, 0, 2), k(6, 3, 4), k(2, 1, 1)].map((x, i) => ({ ...x, t: i })),
    3,
  )
  eq('donchian: warm-up', dc.upper[1], null)
  eq('donchian: bar 2', [dc.upper[2], dc.lower[2], dc.mid[2]], [5, 0, 2.5])
  eq('donchian: bar 4', [dc.upper[4], dc.lower[4], dc.mid[4]], [6, 0, 3])

  // A few more against their definitions.
  // On a line, WMA(n) lags (n − 1)/3 bars: 2·WMA(8) − WMA(16) leads by 1/3,
  // then WMA(4) lags 1, so HMA 16 sits 2/3 of a bar behind.
  near('hma: lag on a straight line is 2/3 bar', M.hma(up, 16)[59], 159 - 2 / 3)
  near('linreg: fits a straight line exactly', M.linreg(up, 20)[59], 159)
  near('zscore: last of 1..5 over 5', M.zscore([1, 2, 3, 4, 5], 5)[4], 2 / Math.sqrt(2))
  near('cmo: all gains is +100', M.cmo(up, 9)[59], 100)
  const ar = M.aroon(stair(30), 14)
  eq('aroon: new highs every bar', [ar.up[29], ar.down[29]], [100, 0])
  near('momentum: 10 bars of +1', M.momentum(up, 10)[59], 10)
  const pv = M.pivots([1, 2, 3, 9, 3, 2, 1, 2].map((h, i) => ({ t: i, o: h, h, l: h - 1, c: h, v: 1 })), 2, 2)
  eq('pivots: marks the pivot bar', pv.high[3], 9)
  eq('pivots: last high steps in on confirmation', [pv.lastHigh[4], pv.lastHigh[5]], [null, 9])

  // ---- indicator-on-indicator
  const smaDef = {
    id: 'sma', name: 'SMA', params: [{ key: 'length', default: 3 }], outputs: [{ key: 'v' }],
    placement: 'overlay', sourced: true, compute: (s, _c, p) => ({ v: M.sma(s, p.length) }),
  }
  const rsiDef = {
    id: 'rsi', name: 'RSI', params: [{ key: 'length', default: 5 }], outputs: [{ key: 'v' }],
    placement: 'pane', sourced: true, compute: (s, _c, p) => ({ v: M.rsi(s, p.length) }),
  }
  const defs = { sma: smaDef, rsi: rsiDef }
  const defOf = (i) => defs[i.type] || null
  const base = (key, c) => c.map((x) => (key === 'volume' ? x.v : x.c))
  const inst = (uid, type, source, visible = true) => ({ uid, type, params: {}, source, visible })
  const candles = vee.map((c, i) => ({ t: i * 60000, o: c, h: c + 1, l: c - 1, c, v: i + 1 }))

  const loop = [inst('a', 'sma', 'b.v'), inst('b', 'sma', 'a.v'), inst('c', 'sma', 'close')]
  eq('graph: a two-instance loop is detected', createsCycle(loop, 'a', 'b.v'), true)
  eq('graph: a self reference is a cycle', createsCycle(loop, 'c', 'c.v'), true)
  eq('graph: a longer loop is detected', createsCycle([inst('x', 'sma', 'y.v'), inst('y', 'sma', 'z.v'), inst('z', 'sma', 'close')], 'z', 'x.v'), true)
  eq('graph: a plain chain is not a cycle', createsCycle(loop, 'c', 'close'), false)
  let res = null
  try {
    res = computeAll(loop, candles, defOf, base)
  } catch (e) {
    res = String(e)
  }
  ok('graph: a loop never throws or recurses forever', Array.isArray(res), res)
  eq('graph: looped instances are skipped, the rest still draws', Array.isArray(res) && res.map((r) => r.inst.uid), ['c'])

  // RSI (hidden) → SMA of it (overlay: draws in the RSI pane) → RSI of that (own pane).
  const chain = [inst('r', 'rsi', 'close', false), inst('s', 'sma', 'r.v'), inst('t', 'rsi', 's.v'), inst('u', 'sma', 'volume')]
  const out = computeAll(chain, candles, defOf, base)
  const by = Object.fromEntries(out.map((r) => [r.inst.uid, r]))
  eq('graph: hidden sources are computed but not drawn', Object.keys(by), ['s', 't', 'u'])
  const rsiSeries = M.rsi(candles.map((c) => c.c), 5)
  const expect = M.onDefined(rsiSeries, (v) => M.sma(v, 3))
  near('graph: SMA of RSI matches by hand', by.s.outputs.v[59], expect[59])
  eq('graph: SMA of RSI waits for both warm-ups', [by.s.outputs.v[6], by.s.outputs.v[7] != null], [null, true])
  eq('graph: an overlay on a pane indicator shares its pane', by.s.host, 'r')
  eq('graph: a pane indicator on an overlay gets its own pane', by.t.host, 't')
  eq('graph: an overlay on volume gets its own pane', by.u.host, 'u')
  near('graph: volume is a source', by.u.outputs.v[59], 59)
  eq('graph: outputs keep candle alignment', by.t.outputs.v.length, candles.length)
  eq('graph: a dangling reference is skipped', computeAll([inst('q', 'sma', 'gone.v')], candles, defOf, base).length, 0)

  // Performance: 50 indicators over 5000 bars on one redraw.
  const long = Array.from({ length: 5000 }, (_, i) => {
    const p = 100 + Math.sin(i / 20) * 10
    return { t: i * 60000, o: p, h: p + 1, l: p - 1, c: p, v: 1 + (i % 7) }
  })
  const many = Array.from({ length: 50 }, (_, i) => inst('m' + i, i % 2 ? 'rsi' : 'sma', i ? 'm' + (i - 1) + '.v' : 'close'))
  const t0 = Date.now()
  computeAll(many, long, defOf, base)
  const ms = Date.now() - t0
  ok('graph: a 50-deep chain over 5000 bars under 250ms', ms < 250, ms + 'ms')
}

// ---------------------------------------------------------------- pine
{
  const { runPine } = await import(src('features/charts/pine/runtime.ts'))
  const { parse, PineError } = await import(src('features/charts/pine/parser.ts'))
  const { PINE_EXAMPLES, PINE_TEMPLATE } = await import(src('features/charts/pine/examples.ts'))
  const P = await import(src('features/charts/pine/indicator.ts'))
  const M = await import(src('features/charts/indicators/math.ts'))
  // The Pro terminal's fixture: a drifting sine, 15-minute bars.
  const mk = (len) =>
    Array.from({ length: len }, (_, i) => {
      const o = 100 + Math.sin(i / 7) * 10 + i * 0.05
      const cl = o + Math.cos(i / 3) * 2
      return { t: 1_700_000_000_000 + i * 900_000, o, h: Math.max(o, cl) + 1, l: Math.min(o, cl) - 1, c: cl, v: 100 + (i % 9) }
    })
  const c = mk(300)
  const close = c.map((k) => k.c)
  const last = (a) => a[a.length - 1]
  const throws = (fn) => {
    try {
      fn()
      return null
    } catch (e) {
      return e
    }
  }

  // Ported from pro-terminal/src/core/pine/runtime.test.ts
  const r1 = runPine(`//@version=5
indicator("RSI", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
up = ta.rma(math.max(ta.change(src), 0), len)
down = ta.rma(-math.min(ta.change(src), 0), len)
rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
plot(rsi, "RSI", color=color.purple)
hline(70)
hline(30)
plot(ta.rsi(src, len), "RSI builtin")`, c)
  eq('pine: overlay=false', r1.overlay, false)
  eq('pine: inputs are listed in order', r1.inputs.map((i) => i.title), ['Length', 'Source'])
  eq('pine: input.int keeps minval', r1.inputs[0].min, 1)
  eq('pine: two hlines', r1.hlines.map((h) => h.price), [70, 30])
  near('pine: hand-written RSI matches the app RSI', last(r1.plots[0].values), last(M.rsi(close, 14)), 1e-6)
  near('pine: ta.rsi matches the hand-written one', last(r1.plots[1].values), last(r1.plots[0].values), 1e-9)

  const r2 = runPine(`indicator("t", overlay=true)
f = input(12, "Fast")
myema(s, l) => ta.ema(s, l)
var int count = 0
count := count + 1
[m, sg, h] = ta.macd(close, f, 26, 9)
plot(myema(close, 20), "e20")
plot(close[1], "prev")
plot(count, "count")
plot(h, "hist", style=plot.style_histogram)`, c, { Fast: 10 })
  eq('pine: overlay=true', r2.overlay, true)
  near('pine: user function wrapping ta.ema', last(r2.plots[0].values), last(M.ema(close, 20)), 1e-6)
  near('pine: history operator', last(r2.plots[1].values), close[close.length - 2], 1e-9)
  eq('pine: var persists across bars', last(r2.plots[2].values), 300)
  near('pine: tuple from ta.macd with an input override', last(r2.plots[3].values), last(M.macd(close, 10, 26, 9).hist), 1e-6)
  eq('pine: histogram style kept', r2.plots[3].style, 'histogram')

  const r3 = runPine(`indicator("x")
fast = ta.sma(close, 5)
slow = ta.sma(close, 20)
col = fast > slow ? color.green : color.red
sum = 0.0
for i = 0 to 4
    sum := sum + close[i]
avg5 = sum / 5
sig = 0
if ta.crossover(fast, slow)
    sig := 1
else if ta.crossunder(fast, slow)
    sig := -1
plot(fast, "fast", color=col)
plot(avg5, "avg5")
plotshape(sig == 1, style=shape.triangleup, location=location.belowbar, color=color.green)`, c)
  near('pine: ta.sma matches the app SMA', last(r3.plots[0].values), last(M.sma(close, 5)), 1e-6)
  near('pine: for loop over history', last(r3.plots[1].values), last(M.sma(close, 5)), 1e-6)
  ok('pine: plotshape fires on crossovers', r3.shapes.length > 2, r3.shapes.length)
  ok('pine: shapes sit below the bar as up arrows', r3.shapes.every((s) => s.position === 'below' && s.shape === 'arrowUp'))
  ok('pine: per-bar colours recorded', !!r3.plots[0].colors && r3.plots[0].colors.some(Boolean))

  const r4 = runPine(`indicator("st", overlay=true)
[st, dir] = ta.supertrend(3, 10)
[dp, dm, adx] = ta.dmi(14, 14)
k = ta.stoch(close, high, low, 14)
plot(st)
plot(adx)
plot(k)`, c)
  eq('pine: supertrend/dmi/stoch tuples', r4.plots.length, 3)
  ok('pine: tuple outputs finite', r4.plots.every((p) => Number.isFinite(last(p.values))))

  const e1 = throws(() => runPine('indicator("e")\nplot(ta.sma(close, 14)', c))
  ok('pine: syntax error names the line', e1 instanceof PineError && /Line 2/.test(e1.message), e1 && e1.message)
  const e2 = throws(() => runPine('indicator("e")\nplot(foo)', c))
  ok('pine: unknown identifier with line and column', e2 && /Line 2, col 6: Undeclared identifier 'foo'/.test(e2.message), e2 && e2.message)
  const e3 = throws(() => parse('x = 1 @ 2'))
  eq('pine: bad character located', e3 && [e3.line, e3.col], [1, 7])
  const e4 = throws(() => runPine('plot(ta.nope(close))', c))
  ok('pine: unsupported function reported', e4 && /Unsupported function 'ta.nope'/.test(e4.message), e4 && e4.message)
  const e5 = throws(() => runPine('x := 1', c))
  ok('pine: := on an undeclared name is an error', e5 && /undeclared/.test(e5.message), e5 && e5.message)
  const e6 = throws(() => runPine('i = 0\nwhile true\n    i := i + 1', c, {}, { maxMs: 200 }))
  ok('pine: runaway loop stops with an error', e6 && /Loop|too long/.test(e6.message), e6 && e6.message)

  // Extensions over the Pro engine.
  const r5 = runPine(`indicator("ext", overlay=true)
s = 0.0
s += close
s *= 2
long = ta.sma(close,
  10)
plot(s, "s", color=#ff000080)
plot(long, "l", offset=2)
plot(ta.tr, "tr")
plot(ta.alma(close, 9, 0.85, 6), "alma")
plotchar(bar_index == 5, "c", "x", location.abovebar)`, c)
  near('pine: += and *=', last(r5.plots[0].values), 2 * last(close), 1e-9)
  eq('pine: #RRGGBBAA colour literal', r5.plots[0].color, 'rgba(255,0,0,0.50)')
  near('pine: wrapped line + offset shifts right', last(r5.plots[1].values), M.sma(close, 10)[close.length - 3], 1e-9)
  eq('pine: offset leaves the first bars empty', r5.plots[1].values[10], null)
  const tr = Math.max(c[299].h - c[299].l, Math.abs(c[299].h - c[298].c), Math.abs(c[299].l - c[298].c))
  near('pine: ta.tr as a variable', last(r5.plots[2].values), tr, 1e-9)
  ok('pine: ta.alma is finite', Number.isFinite(last(r5.plots[3].values)))
  eq('pine: plotchar marks one bar with its char', r5.shapes.map((s) => [s.bar, s.text]), [[5, 'x']])
  const r6 = runPine('indicator("w")\nplot(close)\nfill(1, 2)\nlabel.new(bar_index, high, "x")', c)
  eq('pine: drawings are ignored with a warning', r6.warnings, ['fill', 'label.new'])
  const r7 = runPine('indicator("wrap")\nx = close +\n     open\nplot(x)', c)
  near('pine: continuation after a trailing operator', last(r7.plots[0].values), last(c).c + last(c).o, 1e-9)

  // Every built-in example (ported library tests) compiles and plots.
  const long = mk(400)
  ;[...PINE_EXAMPLES, { name: 'template', script: PINE_TEMPLATE }].forEach((ex) => {
    let r = null
    const err = throws(() => (r = runPine(ex.script, long)))
    ok('pine example runs: ' + ex.name, !err, err && err.message)
    ok('pine example plots finite values: ' + ex.name, !!r && r.plots.some((p) => p.values.slice(-50).some((v) => v != null && Number.isFinite(v))))
  })
  const ichi = runPine(PINE_EXAMPLES.find((x) => x.id === 'ex_ichimoku').script, long)
  const dc = M.donchian(long, 9)
  near('pine: Ichimoku conversion line = Donchian mid', last(ichi.plots[0].values), last(dc.mid), 1e-9)

  // As an indicator: plots -> outputs, hlines, shapes -> markers, overlay -> placement.
  const inst = { uid: 'p1', type: 'pine', script: PINE_EXAMPLES.find((x) => x.id === 'ex_rsi_signals').script, pineInputs: {} }
  const def = P.pineLive(inst, long)
  eq('pine def: pane placement from overlay=false', def.placement, 'pane')
  eq('pine def: one output per plot + a marker output', def.outputs.map((o) => o.kind), ['line', 'signal'])
  eq('pine def: hlines carried', def.hlines.map((h) => [h.price, h.style]), [[70, 'dashed'], [50, 'dotted'], [30, 'dashed']])
  const outs = def.compute([], long, {})
  near('pine def: RSI output matches the app RSI', last(outs[def.outputs[0].key]), last(M.rsi(long.map((k) => k.c), 14)), 1e-6)
  ok('pine def: markers sit on the RSI line in its pane', def.outputs[1].markers.length > 0 && def.outputs[1].markers.every((m) => outs.shapes[m.i] === outs[def.outputs[0].key][m.i]))
  ok('pine def: per-bar colours pass through', def.outputs[0].colors.some(Boolean))
  eq('pine def: same candles hit the cache', P.pineLive(inst, long) === def, true)
  const tick = long.slice()
  tick[tick.length - 1] = { ...tick[tick.length - 1], c: tick[tick.length - 1].c + 1 }
  eq('pine def: a tick on the forming bar is throttled', P.pineLive(inst, tick) === def, true)
  const next = long.concat([{ ...long[long.length - 1], t: long[long.length - 1].t + 900_000 }])
  ok('pine def: a new bar recomputes at once', P.pineLive(inst, next) !== def)
  const inst2 = { ...inst, pineInputs: { Length: 5 } }
  const d2 = P.pineLive(inst2, next)
  near('pine def: input override changes the run', last(d2.compute([], next, {})[d2.outputs[0].key]), last(M.rsi(next.map((k) => k.c), 5)), 1e-6)
  const bad = { uid: 'p2', type: 'pine', script: 'indicator("b")\nplot(nope)' }
  const bd = P.pineLive(bad, long)
  eq('pine def: a failing script draws nothing', bd.outputs.length, 0)
  ok('pine def: and reports its error', /Undeclared identifier 'nope'/.test(P.pineStatus(bad).error || ''), P.pineStatus(bad))
  const ov = P.pineLive({ uid: 'p3', type: 'pine', script: PINE_EXAMPLES[0].script }, long)
  eq('pine def: overlay placement', ov.placement, 'overlay')
  const ovOut = ov.compute([], long, {})
  ok('pine def: overlay markers sit on the bar high/low', ov.outputs.at(-1).markers.every((m) => ovOut.shapes[m.i] === (m.position === 'aboveBar' ? long[m.i].h : long[m.i].l)))
  eq('pine meta: inputs without a chart', P.pineMeta(inst).status.inputs.map((i) => i.title), ['Length', 'Source', 'Overbought', 'Oversold'])
  eq('pine: title read from the source', P.scriptTitle('indicator("A <b>" , overlay=true)'), 'A b')

  // Pine plots feed the indicator graph like any other output.
  const { computeAll } = await import(src('features/charts/indicators/graph.ts'))
  const smaDef = {
    id: 'sma', name: 'SMA', params: [{ key: 'length', default: 3 }], outputs: [{ key: 'v' }],
    placement: 'overlay', sourced: true, compute: (s, _c, p) => ({ v: M.sma(s, p.length) }),
  }
  const k0 = def.outputs[0].key
  const items = [
    { uid: 'g1', type: 'pine', params: {}, source: 'close', visible: true, script: inst.script, pineInputs: {} },
    { uid: 's1', type: 'sma', params: {}, source: 'g1.' + k0, visible: true },
  ]
  const res = computeAll(items, long, (i, cc) => (i.type === 'pine' ? P.pineLive(i, cc) : smaDef), (k, cc) => cc.map((x) => x.c))
  const rs = res.find((x) => x.inst.uid === 'g1').outputs[k0]
  const sm = res.find((x) => x.inst.uid === 's1')
  near('pine graph: SMA of a Pine plot', last(sm.outputs.v), (rs.at(-1) + rs.at(-2) + rs.at(-3)) / 3, 1e-9)
  eq('pine graph: an overlay on a Pine pane shares it', sm.host, 'g1')

  // Performance: a typical script over 5000 bars.
  const big = mk(5000)
  const t0 = Date.now()
  runPine(PINE_EXAMPLES.find((x) => x.id === 'ex_macd').script, big)
  const ms = Date.now() - t0
  ok('pine: MACD script over 5000 bars under 400ms', ms < 400, ms + 'ms')
}

// ------------------------------------------------- per-panel indicator stores
{
  // A Map-backed localStorage, seeded with a main-chart set saved before
  // panels had indicators: it must load, and stay byte-for-byte untouched.
  const mem = new Map()
  const prevLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    },
  })
  const mainSaved = JSON.stringify([
    { uid: 'iabc1', type: 'ema', params: { length: 21 }, source: 'close', visible: true },
    { uid: 'iabc2', type: 'rsi', params: { length: 14 }, source: 'close', visible: false },
  ])
  mem.set('lr-chartIndicators', mainSaved)

  const S = await import(src('features/charts/indicators/store.ts'))
  const P = await import(src('features/charts/indicators/panelStore.ts'))
  const types = (st) => st.getIndicators().map((i) => i.type)

  eq('panel ind: main chart loads its saved set', S.getIndicators().map((i) => [i.uid, i.type, i.visible]), [['iabc1', 'ema', true], ['iabc2', 'rsi', false]])
  eq('panel ind: main keeps its cap', S.maxIndicators(), 50)

  const c2 = P.panelIndicatorStore('c2')
  const c3 = P.panelIndicatorStore('c3')
  ok('panel ind: one store per slot', P.panelIndicatorStore('c2') === c2 && c2 !== c3)
  eq('panel ind: a new panel starts empty', c2.indicatorCount(), 0)
  c2.addIndicator('rsi')
  c3.addIndicator('bb')
  eq('panel ind: RSI only on panel 2', types(c2), ['rsi'])
  eq('panel ind: Bollinger only on panel 3', types(c3), ['bb'])
  eq('panel ind: other slots untouched', P.panelIndicatorStore('c1').indicatorCount(), 0)
  eq('panel ind: main chart set unchanged', S.getIndicators().map((i) => i.type), ['ema', 'rsi'])
  eq('panel ind: main storage untouched', mem.get('lr-chartIndicators'), mainSaved)
  ok('panel ind: panel uids are not main-chart uids', c2.getIndicators().every((i) => i.uid[0] === 'p'))

  // Changes on one panel stay there, and only its listeners hear them.
  let heard2 = 0, heard3 = 0, heardMain = 0
  const off2 = c2.subscribe(() => heard2++)
  const off3 = c3.subscribe(() => heard3++)
  const offM = S.subscribeIndicators(() => heardMain++)
  const rsiUid = c2.getIndicators()[0].uid
  c2.setParam(rsiUid, 'length', 7)
  c2.toggleIndicator(rsiUid)
  eq('panel ind: param change on panel 2', c2.getIndicators()[0].params.length, 7)
  eq('panel ind: only panel 2 listeners fire', [heard2, heard3, heardMain], [2, 0, 0])
  off2(); off3(); offM()

  // Indicator-on-indicator works per panel, and cannot reach another chart.
  c2.addIndicator('sma')
  const sma = c2.getIndicators()[1]
  const rsiSrc = c2.sourceOptions(sma.uid).find((o) => o.key.startsWith(rsiUid + '.'))
  ok('panel ind: panel sources list its own outputs', !!rsiSrc)
  ok('panel ind: panel sources skip other charts', !c2.sourceOptions(sma.uid).some((o) => o.key.startsWith('iabc')))
  c2.setSource(sma.uid, rsiSrc.key)
  eq('panel ind: SMA of RSI on panel 2', c2.getIndicators()[1].source, rsiSrc.key)
  c2.setSource(sma.uid, 'iabc1.v')
  eq('panel ind: a main-chart source is refused', c2.getIndicators()[1].source, rsiSrc.key)

  // Persistence round-trip: one key, slots by name, same shape as the main chart.
  const saved = JSON.parse(mem.get('lr-panelIndicators-v1'))
  eq('panel ind: saved slots', Object.keys(saved).sort(), ['c2', 'c3'])
  eq('panel ind: saved panel 2', saved.c2.map((i) => [i.type, i.visible]), [['rsi', false], ['sma', true]])
  const before2 = JSON.stringify(c2.getIndicators())
  const before3 = JSON.stringify(c3.getIndicators())
  P.reloadPanelIndicators()
  eq('panel ind: panel 2 survives a reload', JSON.stringify(c2.getIndicators()), before2)
  eq('panel ind: panel 3 survives a reload', JSON.stringify(c3.getIndicators()), before3)
  eq('panel ind: serialize/sanitize round-trip', JSON.stringify(S.sanitizeIndicators(S.serializeIndicators(c2.getIndicators()), 10)), before2)

  // Pine scripts go onto a panel too.
  const pineUid = c3.addPineIndicator('//@version=5\nindicator("Mid", overlay=true)\nplot(hl2)', 'Mid')
  ok('panel ind: Pine script added to a panel', !!pineUid && types(c3).join() === 'bb,pine')
  eq('panel ind: Pine not on the main chart', S.getIndicators().length, 2)
  c3.removeIndicator(pineUid)

  // Cap per panel: Market workspace panels keep the tight cap; layout cells
  // ('c*') hold as many as the main chart, since they swap sets with it.
  const c5 = P.panelIndicatorStore('mc5')
  for (let i = 0; i < 14; i++) c5.addIndicator('ema')
  eq('panel ind: capped at 10 per workspace panel', c5.indicatorCount(), P.PANEL_MAX_INDICATORS)
  eq('panel ind: cap reported', c5.maxIndicators(), 10)
  c5.resetIndicators()
  eq('panel ind: reset clears only that panel', [c5.indicatorCount(), c2.indicatorCount()], [0, 2])
  ok('panel ind: empty slots are not stored', !('mc5' in JSON.parse(mem.get('lr-panelIndicators-v1'))))

  // Market workspace: removing a panel moves the later panels' sets up.
  const mc = [0, 1, 2].map((i) => P.panelIndicatorStore('mc' + i))
  mc[0].addIndicator('ema')
  mc[1].addIndicator('rsi')
  mc[2].addIndicator('macd')
  P.shiftPanelSlots('mc', 1, 3)
  eq('panel ind: shift keeps panels before the removed one', types(mc[0]), ['ema'])
  eq('panel ind: shift moves the next panel up', types(mc[1]), ['macd'])
  eq('panel ind: shift frees the last slot', mc[2].indicatorCount(), 0)
  P.panelIndicatorStore('mc3').addIndicator('cci')
  P.prunePanelSlots('mc', 2)
  eq('panel ind: prune drops panels past the end', P.panelIndicatorStore('mc3').indicatorCount(), 0)
  eq('panel ind: prune keeps panels before it', types(mc[1]), ['macd'])
  eq('panel ind: companions unaffected by workspace changes', types(c3), ['bb'])

  // Bad input.
  let threw = false
  try { P.panelIndicatorStore('main') } catch (e) { threw = true }
  ok('panel ind: unknown slot name refused', threw)
  mem.set('lr-panelIndicators-v1', JSON.stringify({ c2: [{ type: 'nope' }, { type: 'rsi', params: { length: 1e9 } }], x9: [{ type: 'ema' }], c4: 'junk' }))
  P.reloadPanelIndicators()
  eq('panel ind: junk in storage sanitized', types(c2), ['rsi'])
  eq('panel ind: out-of-range param reset to default', c2.getIndicators()[0].params.length, 14)
  mem.set('lr-panelIndicators-v1', '[1,2]')
  P.reloadPanelIndicators()
  eq('panel ind: a non-object store loads empty', c2.indicatorCount(), 0)
  eq('panel ind: main storage still untouched', mem.get('lr-chartIndicators'), mainSaved)

  if (prevLS) Object.defineProperty(globalThis, 'localStorage', prevLS)
  else delete globalThis.localStorage
}

// ------------------------------- indicator sets moving between charts (replace)
{
  const mem = new Map()
  const prevLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    },
  })
  const S = await import(src('features/charts/indicators/store.ts'))
  const P = await import(src('features/charts/indicators/panelStore.ts'))
  P.reloadPanelIndicators()
  const snap = (st) => JSON.stringify(st.getIndicators())
  const uids = (st) => st.getIndicators().map((i) => i.uid)

  // A source chart with every kind of state worth carrying over.
  let srcSaved = null
  const from = S.createIndicatorStore({ id: 't-from', max: 50, prefix: 'p', load: () => null, save: (d) => (srcSaved = d) })
  from.addIndicator('ema')
  from.addIndicator('rsi')
  from.addIndicator('sma')
  const [ema, rsi, sma] = from.getIndicators()
  from.setParam(ema.uid, 'length', 34)
  from.toggleIndicator(rsi.uid)
  const rsiKey = from.sourceOptions(sma.uid).find((o) => o.key.startsWith(rsi.uid + '.')).key
  from.setSource(sma.uid, rsiKey)
  const pineUid = from.addPineIndicator('//@version=5\nindicator("Len", overlay=false)\nlen = input.int(14, "Length")\nplot(ta.sma(close, len))', 'Len')
  from.setPineInput(pineUid, 'Length', 7)
  const setA = S.serializeIndicators(from.getIndicators())
  eq('replace: source fixture saved its set', JSON.stringify(srcSaved), JSON.stringify(setA))

  let saved = null
  let heard = 0
  let commits = 0
  let order = ''
  const to = S.createIndicatorStore({
    id: 't-to',
    max: 50,
    load: () => null,
    save: (d) => (saved = d),
    onCommit: () => {
      commits++
      order += 'c'
    },
  })
  const offTo = to.subscribe(() => {
    heard++
    order += 'l'
  })
  to.addIndicator('macd') // something to be replaced
  heard = 0
  commits = 0
  order = ''
  to.replace(setA)
  eq('replace: every instance carried over, uids included', snap(to), snap(from))
  eq('replace: types and order kept', to.getIndicators().map((i) => i.type), ['ema', 'rsi', 'sma', 'pine'])
  eq('replace: params kept', to.getIndicators()[0].params.length, 34)
  eq('replace: visibility kept', to.getIndicators().map((i) => i.visible), [true, false, true, true])
  eq('replace: source reference survives the move', to.getIndicators()[2].source, rsiKey)
  ok('replace: referenced instance exists in the new store', to.getIndicators().some((i) => i.uid === rsi.uid))
  const pine = to.getIndicators()[3]
  eq('replace: pine script, title and inputs kept', [pine.uid, pine.script, pine.title, pine.pineInputs], [pineUid, from.getIndicators()[3].script, 'Len', { Length: 7 }])
  eq('replace: the new set is persisted', JSON.stringify(saved), JSON.stringify(setA))
  eq('replace: listeners told once', heard, 1)
  eq('replace: onCommit fires once', commits, 1)
  eq('replace: listeners before onCommit', order, 'lc')
  eq('replace: the source chart is left as it was', JSON.stringify(S.serializeIndicators(from.getIndicators())), JSON.stringify(setA))

  // Garbage in, empty set out — and still a commit (the old set is gone).
  for (const junk of [null, undefined, 'junk', 42, { a: 1 }, [null, 7, 'x', { type: 'nope' }, { notype: true }]]) {
    to.replace(setA)
    to.replace(junk)
    eq('replace: garbage ' + JSON.stringify(junk) + ' gives an empty set', to.indicatorCount(), 0)
  }
  eq('replace: empty set persisted as []', JSON.stringify(saved), '[]')
  to.replace([{ uid: 'dup1', type: 'ema' }, { uid: 'dup1', type: 'rsi' }])
  const dupUids = uids(to)
  ok('replace: duplicate uids are made unique', dupUids.length === 2 && dupUids[0] === 'dup1' && dupUids[1] !== 'dup1', dupUids)
  offTo()

  // Capped at the target's max: the first `max` kept, in order; a reference to
  // a dropped instance falls back to close.
  const small = S.createIndicatorStore({ id: 't-small', max: 3, load: () => null, save: () => {} })
  const five = [
    { uid: 'k1', type: 'ema' },
    { uid: 'k2', type: 'rsi' },
    { uid: 'k3', type: 'sma', source: 'k5.v' },
    { uid: 'k4', type: 'bb' },
    { uid: 'k5', type: 'ema' },
  ]
  small.replace(five)
  eq('replace: capped at the store max', uids(small), ['k1', 'k2', 'k3'])
  eq('replace: a source past the cap resets to close', small.getIndicators()[2].source, 'close')

  // ---- the activateCell swap: main <-> companion cell (c0 <- main, main <- c2)
  const main = S.mainIndicatorStore
  const c0 = P.panelIndicatorStore('c0')
  const c2 = P.panelIndicatorStore('c2')
  main.replace(setA)
  c2.replace([
    { uid: 'pq1', type: 'rsi', params: { length: 9 }, visible: true },
    { uid: 'pq2', type: 'macd', visible: false },
  ])
  c0.replace([])
  const before = { main: snap(main), c2: snap(c2) }
  const all0 = [...uids(main), ...uids(c2)].sort()

  let mainCommits = 0
  S.onIndicatorsChange(() => mainCommits++)
  const A = S.serializeIndicators(main.getIndicators())
  const B = S.serializeIndicators(c2.getIndicators())
  c2.replace([])
  c0.replace(A)
  main.replace(B)
  eq('swap: the cell left holds nothing', c2.indicatorCount(), 0)
  eq('swap: main set moved to the cell main vacated', snap(c0), before.main)
  eq('swap: cell set now on the main chart', snap(main), before.c2)
  const all1 = [...uids(main), ...uids(c0), ...uids(c2)].sort()
  eq('swap: no instance lost or duplicated', all1, all0)
  eq('swap: uids unique across charts', new Set(all1).size, all1.length)
  eq('swap: main redraw hook fired once', mainCommits, 1)
  eq('swap: main storage holds the cell set', mem.get('lr-chartIndicators'), JSON.stringify(B))
  const stored = JSON.parse(mem.get('lr-panelIndicators-v1'))
  eq('swap: panel storage holds the moved main set in c0 only', [JSON.stringify(stored.c0), 'c2' in stored], [JSON.stringify(A), false])
  // Reload from storage: the swap survives a page reload.
  P.reloadPanelIndicators()
  eq('swap: c0 survives a reload', snap(c0), before.main)
  eq('swap: c2 stays empty after a reload', c2.indicatorCount(), 0)

  // Swap back (activate cell 2 again from 0): everything returns home.
  const A2 = S.serializeIndicators(main.getIndicators())
  const B2 = S.serializeIndicators(c0.getIndicators())
  c0.replace([])
  c2.replace(A2)
  main.replace(B2)
  eq('swap back: main set restored', snap(main), before.main)
  eq('swap back: cell set restored', snap(c2), before.c2)
  eq('swap back: c0 empty', c0.indicatorCount(), 0)
  S.onIndicatorsChange(() => {})

  // ---- caps: layout cells match the main chart, workspace panels stay small.
  eq('cap: companion cell c3 holds as many as main', P.panelIndicatorStore('c3').maxIndicators(), 50)
  eq('cap: c-slot cap equals MAIN_MAX_INDICATORS', P.panelIndicatorStore('c3').maxIndicators(), S.MAIN_MAX_INDICATORS)
  eq('cap: workspace panel mc1 keeps the panel cap', P.panelIndicatorStore('mc1').maxIndicators(), 10)
  eq('cap: mc-slot cap equals PANEL_MAX_INDICATORS', P.panelIndicatorStore('mc1').maxIndicators(), P.PANEL_MAX_INDICATORS)
  // A full main chart swaps into a cell without losing anything.
  const full = Array.from({ length: 50 }, (_, i) => ({ uid: 'f' + i, type: 'ema', params: { length: 2 + i } }))
  main.replace(full)
  eq('cap: main holds a full 50', main.indicatorCount(), 50)
  const c3 = P.panelIndicatorStore('c3')
  c3.replace(S.serializeIndicators(main.getIndicators()))
  eq('cap: a full main set fits in a cell', c3.indicatorCount(), 50)
  const mc1 = P.panelIndicatorStore('mc1')
  mc1.replace(S.serializeIndicators(main.getIndicators()))
  eq('cap: a workspace panel still caps at 10', mc1.indicatorCount(), 10)

  // Leave the shared stores clean for anything after this block.
  main.replace([])
  c3.replace([])
  mc1.replace([])
  if (prevLS) Object.defineProperty(globalThis, 'localStorage', prevLS)
  else delete globalThis.localStorage
}

// ---- signal scanner: per-timeframe scoring ------------------------------------------
{
  const { scoreTimeframe, closedOnly } = await import(src('features/signals/scoring.ts'))
  const { macdSeries, calcRSI, forecastFrom } = await import(src('utils/indicators.ts'))
  const W = { rsi: 25, macdCross: 30, macdTrend: 10, ema: 12, bb: 18, vol: 5, diverge: 20 }
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const bars = []
  let px = 100
  for (let i = 0; i < 520; i++) {
    const o = px
    px = Math.max(1, px * (1 + Math.sin(i / 37) * 0.004 + (rnd() - 0.5) * 0.02))
    bars.push({ t: i * 3_600_000, o, h: Math.max(o, px) * 1.002, l: Math.min(o, px) * 0.998, c: px, v: 50 + rnd() * 100 })
  }
  let rsiOk = true, crossOk = true, sumOk = true, divOk = true, divFired = 0, crossFired = 0
  for (let end = 120; end <= bars.length; end++) {
    const win = bars.slice(end - 100, end)
    const closes = win.map((b) => b.c)
    const r = scoreTimeframe(win, '1h', W)
    const rsi = r.ai.rsi
    if (rsi > 55 && rsi <= 70 && !(r.parts.rsi > 0)) rsiOk = false
    if (rsi >= 30 && rsi < 45 && !(r.parts.rsi < 0)) rsiOk = false
    const h = macdSeries(closes).hist
    const crossed = (h.at(-1) > 0 && h.at(-2) <= 0) || (h.at(-1) < 0 && h.at(-2) >= 0)
    if (crossed !== (r.parts.macdCross !== undefined)) crossOk = false
    if (crossed) crossFired++
    const sum = Object.values(r.parts).reduce((a, b) => a + b, 0)
    if (r.score !== Math.max(-100, Math.min(100, sum))) sumOk = false
    if (r.parts.diverge !== undefined) {
      divFired++
      const last = closes.at(-1), before = closes.slice(-11, -1)
      const rT = calcRSI(closes.slice(0, -10)), rN = calcRSI(closes)
      const bear = last > Math.max(...before) && rN < rT - 5
      const bull = last < Math.min(...before) && rN > rT + 5
      if (!(bear && r.parts.diverge < 0) && !(bull && r.parts.diverge > 0)) divOk = false
    }
  }
  ok('scoring: RSI 55-70 adds to BUY, 30-45 to SELL (signs match the labels)', rsiOk)
  ok('scoring: "MACD cross" fires exactly when the histogram changes sign', crossOk && crossFired > 0, crossFired)
  ok('scoring: RSI divergence fires (it never could before) and only under its rule', divOk && divFired > 0, divFired)
  ok('scoring: score is the clamped sum of its parts', sumOk)
  // Forming candle is dropped; closed ones kept.
  const hourly = [{ t: 0 }, { t: 3_600_000 }]
  eq('scoring: forming candle dropped', closedOnly(hourly, '1h', 3_600_000 + 60_000).length, 1)
  eq('scoring: closed candle kept', closedOnly(hourly, '1h', 7_200_000).length, 2)
  // Forecast horizons follow the candle size.
  const cl = bars.slice(0, 60).map((b) => b.c)
  const f15 = forecastFrom(cl), f60 = forecastFrom(cl, 60)
  ok('forecast: 1H on 1h candles is one bar ahead (a quarter of the 15m step count)',
    Math.abs((f60.rows[0].pred - cl.at(-1)) * 4 - (f15.rows[0].pred - cl.at(-1))) < 1e-9)
}

// ---- assistant: actions it can take in the app --------------------------------------
{
  const { parseActions, localCommand, isCommand, hideTagsWhileStreaming, appGuide } = await import(src('features/chat/actions.ts'))
  const markets = new Set(['sol', 'btc', 'eth', 'gold', 'pepe', 'xauusd'])
  const isMarket = (s) => markets.has(s.toLowerCase())
  const p = parseActions('SOL looks strong.\n\n[[open:SOL]]\n[[learn:rsi]]\n[[tab:signals]]\n[[tab:nowhere]]\n[[open:SOL]]')
  eq('assistant: tags stripped from the text', p.text, 'SOL looks strong.')
  eq('assistant: actions parsed in order, duplicates and unknown tabs dropped',
    JSON.stringify(p.actions), JSON.stringify([{ kind: 'open', arg: 'SOL' }, { kind: 'learn', arg: 'rsi' }, { kind: 'tab', arg: 'signals' }]))
  eq('assistant: a half-written tag is hidden while streaming', hideTagsWhileStreaming('Opening SOL.\n[[op'), 'Opening SOL.\n')
  eq('assistant: "open SOL" opens the market', JSON.stringify(localCommand('open SOL', isMarket)), JSON.stringify({ kind: 'open', arg: 'sol' }))
  eq('assistant: "take me to the signals" opens the tab', JSON.stringify(localCommand('take me to the signals', isMarket)), JSON.stringify({ kind: 'tab', arg: 'signals' }))
  eq('assistant: "show me the BTC chart" opens BTC', JSON.stringify(localCommand('show me the BTC chart', isMarket)), JSON.stringify({ kind: 'open', arg: 'btc' }))
  eq('assistant: "open the learning guide for fvg" opens that guide', JSON.stringify(localCommand('open the learning guide for fvg', isMarket)), JSON.stringify({ kind: 'learn', arg: 'fvg' }))
  eq('assistant: "go to settings" opens Settings', localCommand('please go to settings', isMarket)?.arg, 'settings')
  eq('assistant: a question is not a command ("show me why BTC dropped")', localCommand('show me why BTC dropped', isMarket), null)
  eq('assistant: an unknown thing is not a command', localCommand('open the pod bay doors', isMarket), null)
  ok('assistant: isCommand recognises commands only', isCommand('take me to signals') && !isCommand('what is RSI?'))
  const g = appGuide(['rsi', 'fvg'])
  ok('assistant: the guide lists every tab and the topic ids', ['home', 'radar', 'signals', 'settings'].every((t) => g.includes('- ' + t + ' (')) && g.includes('rsi, fvg'))
}

// ---- self-learning: "edge proven" needs more than luck ------------------------------
{
  const { edgeProven, STRATS } = await import(src('features/selflearn/strategy.ts'))
  const st = STRATS.scalp
  ok('proven: fewer than 15 trades is never proven', !edgeProven({ n: 10, winRate: 0.6, avgR: 0.5 }, [], st).proven)
  ok('proven: 15 test trades at +0.1R (the old rule passed this) is not proven',
    !edgeProven({ n: 15, winRate: 0.45, avgR: 0.1 }, [], st).proven)
  ok('proven: 60 test trades at +0.5R is proven', edgeProven({ n: 60, winRate: 0.5, avgR: 0.5 }, [], st).proven)
  const strong = { n: 40, winRate: 0.5, avgR: 0.45 }
  ok('proven: a borderline test record passes on its own', edgeProven(strong, [], st).proven)
  ok('proven: live losses can take it away', !edgeProven(strong, Array(30).fill(-1.05), st).proven)
  ok('proven: live wins can earn it', edgeProven({ n: 15, winRate: 0.45, avgR: 0.1 }, Array(30).fill(2.2), st).proven)
}

// ---- direction models: is holdout accuracy an edge? ---------------------------------
{
  const { majorityBaseline, provenEdge } = await import(src('features/ml/edge.ts'))
  eq('edge: majority baseline of 65% up labels', majorityBaseline([...Array(65).fill(1), ...Array(35).fill(0)]), 0.65)
  eq('edge: majority baseline of 30% up labels', majorityBaseline([...Array(30).fill(1), ...Array(70).fill(0)]), 0.7)
  // "Always up" in a trending window matches the baseline exactly: no edge.
  ok('edge: always guessing the trend direction is not an edge', provenEdge(0.65, 0.65, 95) <= 0)
  // Zero-skill model on 95 balanced holdout bars: how often does each rule wrongly accept it?
  let seed = 3
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let oldPass = 0, newPass = 0
  const trials = 2000
  for (let t = 0; t < trials; t++) {
    let hits = 0
    for (let i = 0; i < 95; i++) if (rnd() < 0.5) hits++
    const acc = hits / 95
    if (acc > 0.52) oldPass++
    if (provenEdge(acc, 0.5, 95) > 0) newPass++
  }
  ok('edge: the old 52% bar accepted a zero-skill model ~1/3 of the time', oldPass / trials > 0.25, oldPass / trials)
  ok('edge: the new bar accepts it ~5% of the time (one-sided 95%)', newPass / trials < 0.08, newPass / trials)
  ok('edge: a real 10-point lead over the baseline is accepted', provenEdge(0.75, 0.6, 120) > 0)
}

// ---- signal scanner: grading calls on stop/target, learning per indicator ----------
{
  const { advanceCall, winRate, learnedWeights, termStats, HOUR, CALL_TTL } = await import(src('features/signals/outcomes.ts'))
  const T0 = 1_700_000_000_000 - (1_700_000_000_000 % HOUR) + 30 * 60_000 // a call made at hh:30
  const mk = (dir, extra = {}) => ({ id: 'x', sym: 'BTCUSDT', dir, entry: 100, stop: dir === 'BUY' ? 97 : 103, t1: dir === 'BUY' ? 103 : 97,
    openedAt: T0, expiresAt: T0 + CALL_TTL, checkedUntil: 0, terms: {}, ...extra })
  const H1 = T0 + 30 * 60_000 // first full hour after the call
  const c = (t, l, h) => ({ t, l, h })
  // A wick before the call (same hour, started earlier) must not decide it.
  eq('outcomes: pre-entry candle ignored, later target = win',
    advanceCall(mk('BUY'), [c(H1 - HOUR, 90, 110), c(H1, 99, 103.5)], H1 + 2 * HOUR), 'win')
  eq('outcomes: candle touching stop and target = loss', advanceCall(mk('BUY'), [c(H1, 96, 104)], H1 + 2 * HOUR), 'loss')
  eq('outcomes: SELL target below = win', advanceCall(mk('SELL'), [c(H1, 96.5, 101)], H1 + 2 * HOUR), 'win')
  eq('outcomes: SELL stop above = loss', advanceCall(mk('SELL'), [c(H1, 99, 103.2)], H1 + 2 * HOUR), 'loss')
  // The still-forming candle is never used.
  eq('outcomes: forming candle not used', advanceCall(mk('BUY'), [c(H1, 99, 104)], H1 + 30 * 60_000), null)
  // Incremental: nothing decided yet, then decided by a later candle.
  const inc = mk('BUY')
  eq('outcomes: still open while levels untouched', advanceCall(inc, [c(H1, 99, 101)], H1 + HOUR), null)
  eq('outcomes: checkedUntil advances', inc.checkedUntil, H1)
  eq('outcomes: decided on a later sweep', advanceCall(inc, [c(H1, 99, 101), c(H1 + HOUR, 98, 103.1)], H1 + 2 * HOUR), 'win')
  // A gap (app closed) means the levels may have been hit unseen: expired, not guessed.
  const gap = mk('BUY'); advanceCall(gap, [c(H1, 99, 101)], H1 + HOUR)
  eq('outcomes: gap in candles -> expired', advanceCall(gap, [c(H1 + 5 * HOUR, 99, 103.5)], H1 + 6 * HOUR), 'expired')
  eq('outcomes: time limit -> expired', advanceCall(mk('BUY'), [c(H1, 99, 101)], T0 + CALL_TTL + 1), 'expired')
  // Win rate counts wins and losses; expired calls are reported, not counted.
  const done = (r, terms = {}, dir = 'BUY') => ({ ...mk(dir), terms, result: r, closedAt: 0 })
  const w = winRate([done('win'), done('loss'), done('loss'), done('expired')])
  ok('outcomes: win rate = wins / (wins + losses)', w.n === 3 && Math.abs(w.rate - 1 / 3) < 1e-12 && w.expired === 1, w)
  // Per-indicator learning.
  const base = { rsi: 25, ema: 12, bb: 18 }
  eq('learning: weights stay at defaults with too few calls', learnedWeights(base, [done('win', { rsi: 5 })]), base)
  const hist = []
  for (let i = 0; i < 40; i++) hist.push(done(i % 5 === 0 ? 'loss' : 'win', { rsi: 5 }))   // rsi-agreeing: 80% win
  for (let i = 0; i < 40; i++) hist.push(done(i % 5 === 0 ? 'win' : 'loss', { ema: 3 }))   // ema-agreeing: 20% win
  for (let i = 0; i < 40; i++) hist.push(done(i % 2 ? 'win' : 'loss', { bb: -4 }))         // bb pointed against the call
  const lw = learnedWeights(base, hist)
  ok('learning: an indicator whose calls win more gets more weight', lw.rsi > base.rsi && lw.rsi <= base.rsi * 1.5, lw)
  ok('learning: one whose calls lose gets less, never below half', lw.ema < base.ema && lw.ema >= base.ema * 0.5, lw)
  eq('learning: an indicator that disagreed with the calls is not credited', lw.bb, base.bb)
  eq('learning: term stats count only agreeing calls', termStats(hist).bb, undefined)
  eq('learning: recomputed, not ratcheted (same input, same weights)', JSON.stringify(learnedWeights(base, hist)), JSON.stringify(lw))
}

// ---- self-learning: does it actually learn? (controlled experiment) ----------------
{
  // Plant a pattern the engine can see from price (drift regimes that persist),
  // and check it profits on its unseen 30%; on pure noise it must not.
  const { trainCore } = await import(src('features/selflearn/train.ts'))
  let seed = 5
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const market = (drift0) => {
    const out = []
    let p = 100, drift = 0
    for (let i = 0; i < 3000; i++) {
      if (i % 60 === 0) drift = (rnd() < 0.5 ? -1 : 1) * drift0
      const o = p, c = o * (1 + drift + (rnd() - 0.5) * 0.02)
      out.push({ t: i * 14_400_000, o, h: Math.max(o, c) * (1 + rnd() * 0.004), l: Math.min(o, c) * (1 - rnd() * 0.004), c, v: 100 + rnd() * 50 })
      p = c
    }
    return out
  }
  const planted = trainCore(market(0.002), 'swing').holdout
  seed = 5
  const noise = trainCore(market(0), 'swing').holdout
  ok('self-learning: finds a planted pattern and profits on unseen data', planted.n >= 30 && planted.avgR > 0.3, planted)
  ok('self-learning: makes no profit on pure noise', noise.avgR < 0.05, noise)
}

// ---- self-learning: training core (runs in a Web Worker in the app) ----------------
{
  const { trainCore } = await import(src('features/selflearn/train.ts'))
  // A seeded random walk with a slow swing, so both sides produce labelled trades.
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const cs = []
  let px = 100
  for (let i = 0; i < 1200; i++) {
    const o = px
    px = Math.max(1, px * (1 + Math.sin(i / 90) * 0.0015 + (rnd() - 0.5) * 0.012))
    const hi = Math.max(o, px) * (1 + rnd() * 0.004)
    const lo = Math.min(o, px) * (1 - rnd() * 0.004)
    cs.push({ t: 1_700_000_000_000 + i * 300_000, o, h: hi, l: lo, c: px, v: 100 + rnd() * 50 })
  }
  const a = trainCore(cs, 'scalp')
  const b = trainCore(cs, 'scalp')
  ok('selflearn: training produces labelled rows', a.rows > 500, a.rows)
  ok(
    'selflearn: both models carry weights',
    a.pair.long.w.length > 0 && a.pair.long.w.length === a.pair.short.w.length,
    a.pair.long.w.length,
  )
  ok(
    'selflearn: holdout stats are finite',
    [a.holdout.n, a.holdout.winRate, a.holdout.avgR, a.holdout.pf].every(Number.isFinite),
    a.holdout,
  )
  // The worker and the main-thread fallback must agree, so training must be deterministic.
  eq('selflearn: training is deterministic (worker = fallback)', JSON.stringify(a), JSON.stringify(b))
  // What crosses to and from the worker must survive structured cloning unchanged.
  eq('selflearn: result survives structured clone', JSON.stringify(structuredClone(a)), JSON.stringify(a))
}

// ---- chart styles: the line family (line, markers, step, area, HLC area, baseline) ----
{
  const { isLineFamily, withAlpha, closeMidpoint, createLineFamilySeries, themeLineFamilySeries } =
    await import(src('features/charts/series/lineFamily.ts'))
  const { hlcAreaView } = await import(src('features/charts/series/hlcArea.ts'))

  const family = ['line', 'linemarkers', 'stepline', 'area', 'hlcarea', 'baseline']
  ok('line family: members', family.every(isLineFamily))
  ok('line family: candles are not in it', !['candle', 'bar', 'range', ''].some(isLineFamily))

  eq('withAlpha: #rrggbb', withAlpha('#2962FF', 0.28), 'rgba(41,98,255,0.28)')
  eq('withAlpha: #rgb', withAlpha('#0f0', 1), 'rgba(0,255,0,1)')
  eq('withAlpha: #rrggbbaa drops the old alpha', withAlpha('#00E676ff', 0), 'rgba(0,230,118,0)')
  eq('withAlpha: rgb()', withAlpha('rgb(255, 23, 68)', 0.05), 'rgba(255,23,68,0.05)')
  eq('withAlpha: space-separated rgb', withAlpha(' rgb(41 98 255) ', 0.5), 'rgba(41,98,255,0.5)')
  eq('withAlpha: unknown form passes through', withAlpha('var(--primary)', 0.3), 'var(--primary)')

  const closes = [10, 14, 12, 20, 16].map((c, i) => bar(i, c + 1, c - 1, c))
  eq('midpoint: whole range', closeMidpoint(closes, 0, 4), 15)
  eq('midpoint: fractional logical ends round outwards', closeMidpoint(closes, 0.4, 1.6), 12)
  eq('midpoint: range past the data is clamped', closeMidpoint(closes, 3, 40), 18)
  eq('midpoint: no bar in view falls back to the last close', closeMidpoint(closes, 9, 12), 16)
  eq('midpoint: no bars at all', closeMidpoint([], 0, 1), null)

  // A chart that records what it was asked to add, so the options can be checked.
  const chart = {
    addLineSeries: (o) => ({ kind: 'line', o }),
    addAreaSeries: (o) => ({ kind: 'area', o }),
    addBaselineSeries: (o) => ({ kind: 'baseline', o }),
    addCustomSeries: (view, o) => ({ kind: 'custom', view, o }),
  }
  const k = { primary: '#2962FF', up: '#089981', dn: '#F23645', neutral: '#868993', pline: '#999' }
  const mk = (id) => createLineFamilySeries(chart, id, k, 123)
  eq('line family: candles are left to the caller', mk('candle'), null)

  const line = mk('line')
  eq('line: plain line series', line.kind, 'line')
  eq('line: width 2 (TradingView default)', line.o.lineWidth, 2)
  eq('line: no markers, no steps', [line.o.pointMarkersVisible, line.o.lineType], [false, 0])
  eq(
    'line: primary colour, dashed price line',
    [line.o.color, line.o.priceLineStyle],
    [k.primary, 2],
  )
  eq('line with markers: a dot per bar', mk('linemarkers').o.pointMarkersVisible, true)
  eq('step line: LineType.WithSteps', mk('stepline').o.lineType, 1)

  const area = mk('area')
  eq('area: area series', area.kind, 'area')
  eq('area: line colour', area.o.lineColor, k.primary)
  eq('area: gradient from the line colour…', area.o.topColor, 'rgba(41,98,255,0.28)')
  eq('area: …to transparent', area.o.bottomColor, 'rgba(41,98,255,0)')

  const base = mk('baseline')
  eq('baseline: starts on the given base', base.o.baseValue, { type: 'price', price: 123 })
  eq(
    'baseline: green above',
    [base.o.topLineColor, base.o.topFillColor1],
    [k.up, 'rgba(8,153,129,0.28)'],
  )
  eq(
    'baseline: red below',
    [base.o.bottomLineColor, base.o.bottomFillColor2],
    [k.dn, 'rgba(242,54,69,0.28)'],
  )

  const hlc = mk('hlcarea')
  eq('hlc area: one custom series', hlc.kind, 'custom')
  eq(
    'hlc area: high green, low red, close neutral',
    [hlc.o.highLineColor, hlc.o.lowLineColor, hlc.o.closeLineColor],
    [k.up, k.dn, k.neutral],
  )
  const d = { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1, session: 'x' }
  eq(
    'hlc area: scales over the full bar, close last for the price line',
    hlc.view.priceValueBuilder(d),
    [12, 9, 11],
  )
  eq(
    'hlc area: whitespace is a bar without a close',
    [hlc.view.isWhitespace({ time: 1 }), hlc.view.isWhitespace(d)],
    [true, false],
  )
  const v = hlcAreaView()
  v.update({ bars: [] }, { lineWidth: 3 })
  ok('hlc area: defaults are a fresh copy', v.defaultOptions() !== v.defaultOptions())
  eq('hlc area: default line width', v.defaultOptions().lineWidth, 2)

  // Re-theming only ever changes colours, never the shape options.
  const applied = []
  const series = { applyOptions: (o) => applied.push(o) }
  eq('theme: candles are not re-themed here', themeLineFamilySeries(series, 'candle', k), false)
  eq('theme: step line is', themeLineFamilySeries(series, 'stepline', k), true)
  eq('theme: colours only', applied, [{ color: k.primary, priceLineColor: k.pline }])
  themeLineFamilySeries(series, 'area', { ...k, primary: '#ff0000' })
  eq('theme: area follows the new palette', applied[1].topColor, 'rgba(255,0,0,0.28)')
}

// ---- screener: technical rating, filters, presets, sorting -------------------
{
  const S = await import(src('features/screener/logic.ts'))

  // Rating thresholds (TradingView's): > .5 strong buy, > .1 buy, ≥ -.1 neutral, ≥ -.5 sell.
  eq('screener: rating 0.6 is strong buy', S.ratingOf(0.6), 'strong_buy')
  eq('screener: rating 0.5 is buy (strict >)', S.ratingOf(0.5), 'buy')
  eq('screener: rating 0.1 is neutral', S.ratingOf(0.1), 'neutral')
  eq('screener: rating -0.1 is neutral', S.ratingOf(-0.1), 'neutral')
  eq('screener: rating -0.3 is sell', S.ratingOf(-0.3), 'sell')
  eq('screener: rating -0.51 is strong sell', S.ratingOf(-0.51), 'strong_sell')
  eq('screener: no score, no rating', S.ratingOf(null), null)
  eq('screener: group score (buy − sell) / votes', S.groupScore({ buy: 3, sell: 1, neutral: 4 }), 0.25)
  eq('screener: an empty group does not score', S.groupScore({ buy: 0, sell: 0, neutral: 0 }), null)

  const mk = (closes) =>
    closes.map((c, i) => ({ t: i * 86_400_000, o: c, h: c * 1.01, l: c * 0.99, c, v: 1000 }))
  const upTrend = mk(Array.from({ length: 220 }, (_, i) => 100 * Math.pow(1.01, i)))
  const downTrend = mk(Array.from({ length: 220 }, (_, i) => 100 * Math.pow(0.99, i)))
  const up = S.computeTech(upTrend)
  const dn = S.computeTech(downTrend)
  eq('screener: steady uptrend — every MA votes buy', up.maVotes, { buy: 12, sell: 0, neutral: 0 })
  eq('screener: steady downtrend — every MA votes sell', dn.maVotes, { buy: 0, sell: 12, neutral: 0 })
  ok('screener: uptrend rates buy or strong buy', up.rating === 'buy' || up.rating === 'strong_buy', up.rating)
  ok('screener: downtrend rates sell or strong sell', dn.rating === 'sell' || dn.rating === 'strong_sell', dn.rating)
  ok('screener: uptrend RSI is high', up.rsi > 70, up.rsi)
  eq('screener: uptrend price above EMA200', S.emaRelation(upTrend.at(-1).c, up.ema200), 'above')
  near('screener: 1W performance is 7 daily bars back', up.perf1W, (Math.pow(1.01, 7) - 1) * 100, 1e-6)
  near('screener: 1M performance is 30 daily bars back', dn.perf1M, (Math.pow(0.99, 30) - 1) * 100, 1e-6)
  ok('screener: ATR% is about the bar range', up.atrPct > 1.5 && up.atrPct < 3.5, up.atrPct)
  eq('screener: oscillator group has 8 voters', S.oscillatorVotes(upTrend).length, 8)
  // A new listing: too short for the 100/200 MAs, which then do not vote.
  const young = S.computeTech(upTrend.slice(-60))
  eq('screener: MAs without enough history do not vote', young.maVotes.buy + young.maVotes.sell + young.maVotes.neutral, 8)
  eq('screener: no EMA200 on 60 bars', young.ema200, null)
  eq('screener: no candles, no rating', S.computeTech([]).rating, null)

  near('screener: absolute change from last and %', S.absChange(110, 10), 10, 1e-9)
  near('screener: absolute change for a loss', S.absChange(90, -10), -10, 1e-9)

  const tech = (rsi, score) => ({ rsi, score, rating: S.ratingOf(score), macd: 1, macdSignal: 0, macdState: 'bull', ema20: null, ema50: null, ema200: null, atrPct: 2, perf1W: 1, perf1M: 2, maVotes: { buy: 0, sell: 0, neutral: 0 }, oscVotes: { buy: 0, sell: 0, neutral: 0 } })
  const row = (base, name, pct, vol, t = null, mcap = null) => ({ sym: base + 'USDT', base, name, price: 10, pct, chg: 0, vol, mcap, tech: t })
  const rows = [
    row('BTC', 'Bitcoin', 2, 5e9, tech(55, 0.7), 1e12),
    row('ETH', 'Ethereum', -3, 2e9, tech(25, -0.6)),
    row('SOL', 'Solana', 8, 9e8, tech(75, 0.3)),
    row('PEPE', 'Pepe', -12, 4e8, null),
    row('DOGE', 'Dogecoin', 0.5, 6e8, tech(45, 0)),
  ]
  const F = S.EMPTY_FILTERS
  const bases = (rs) => rs.map((r) => r.base).join(',')
  eq('screener: no filters keep everything', S.filterRows(rows, F).length, 5)
  eq('screener: search matches ticker or name', bases(S.filterRows(rows, { ...F, q: 'eth' })), 'ETH')
  eq('screener: search by name', bases(S.filterRows(rows, { ...F, q: 'doge' })), 'DOGE')
  eq('screener: min volume', bases(S.filterRows(rows, { ...F, minVol: 1e9 })), 'BTC,ETH')
  eq('screener: change % range', bases(S.filterRows(rows, { ...F, chgMin: 0, chgMax: 5 })), 'BTC,DOGE')
  eq('screener: RSI range drops rows still computing', bases(S.filterRows(rows, { ...F, rsiMin: 40, rsiMax: 60 })), 'BTC,DOGE')
  eq('screener: rating filter, exact', bases(S.filterRows(rows, { ...F, rating: 'strong_buy' })), 'BTC')
  eq('screener: rating filter, buy or better', bases(S.filterRows(rows, { ...F, rating: 'buy_up' })), 'BTC,SOL')
  eq('screener: rating filter, sell or worse', bases(S.filterRows(rows, { ...F, rating: 'sell_down' })), 'ETH')
  ok('screener: indicator filters need indicators', S.needsTech({ ...F, rsiMax: 30 }) && !S.needsTech({ ...F, minVol: 1 }))

  eq('screener: sort by change, descending', bases(S.sortRows(rows, { key: 'pct', dir: 'desc' })), 'SOL,BTC,DOGE,ETH,PEPE')
  eq('screener: sort by change, ascending', bases(S.sortRows(rows, { key: 'pct', dir: 'asc' })), 'PEPE,ETH,DOGE,BTC,SOL')
  eq('screener: missing RSI sorts last either way (desc)', bases(S.sortRows(rows, { key: 'rsi', dir: 'desc' })), 'SOL,BTC,DOGE,ETH,PEPE')
  eq('screener: missing RSI sorts last either way (asc)', bases(S.sortRows(rows, { key: 'rsi', dir: 'asc' })), 'ETH,DOGE,BTC,SOL,PEPE')
  eq('screener: missing market cap sorts last', S.sortRows(rows, { key: 'mcap', dir: 'asc' })[0].base, 'BTC')
  eq('screener: sort by symbol', bases(S.sortRows(rows, { key: 'sym', dir: 'asc' })), 'BTC,DOGE,ETH,PEPE,SOL')
  eq('screener: sort by rating', bases(S.sortRows(rows, { key: 'rating', dir: 'desc' })), 'BTC,SOL,DOGE,ETH,PEPE')
  eq('screener: sorting does not mutate its input', bases(rows), 'BTC,ETH,SOL,PEPE,DOGE')
  eq('screener: same header flips direction', S.nextSort({ key: 'vol', dir: 'desc' }, 'vol'), { key: 'vol', dir: 'asc' })
  eq('screener: a new numeric header starts descending', S.nextSort({ key: 'vol', dir: 'asc' }, 'rsi'), { key: 'rsi', dir: 'desc' })
  eq('screener: the symbol header starts ascending', S.nextSort({ key: 'vol', dir: 'desc' }, 'sym'), { key: 'sym', dir: 'asc' })

  const base = { filters: { ...F, q: 'so', minVol: 1e6 }, sort: S.DEFAULT_SORT, preset: null }
  const os = S.applyPreset(base, 'oversold')
  eq('screener: Oversold preset = RSI < 30, lowest first, search kept', [os.filters.rsiMax, os.filters.minVol, os.filters.q, os.sort.key, os.sort.dir, os.preset], [30, 0, 'so', 'rsi', 'asc', 'oversold'])
  const g = S.applyPreset(base, 'gainers')
  eq('screener: Top gainers preset sorts change % descending', [g.filters.chgMin, g.sort.key, g.sort.dir], [0, 'pct', 'desc'])
  const losers = S.applyPreset({ ...base, filters: F }, 'losers')
  eq('screener: Top losers lists the fallers, worst first', bases(S.sortRows(S.filterRows(rows, losers.filters), losers.sort)), 'PEPE,ETH')
  const sb = S.applyPreset({ ...base, filters: F }, 'strongbuy')
  eq('screener: Strong buy preset', bases(S.sortRows(S.filterRows(rows, sb.filters), sb.sort)), 'BTC')
  eq('screener: every preset id is distinct', new Set(S.PRESETS.map((p) => p.id)).size, 6)

  const clean = S.sanitizePrefs({ filters: { q: 42, minVol: -5, chgMin: '3', rsiMax: 30, rating: 'moon' }, sort: { key: 'nope', dir: 'up' }, preset: 'oversold' })
  eq('screener: stored prefs are sanitised', clean, { filters: { ...F, rsiMax: 30 }, sort: S.DEFAULT_SORT, preset: 'oversold' })
  eq('screener: garbage in storage falls back to defaults', S.sanitizePrefs('x'), { filters: F, sort: S.DEFAULT_SORT, preset: null })
  eq('screener: valid prefs survive a round trip', S.sanitizePrefs(JSON.parse(JSON.stringify(os))), os)
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed')
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL  ' + f))
  process.exit(1)
}
console.log('engines OK')
