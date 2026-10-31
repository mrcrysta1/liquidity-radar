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
  mergeOlderPage,
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
const { noteLimitResponse, cooldownLeft, isRateLimited, isBinanceUrl } = await import(
  src('api/rateLimit.ts')
)
const { pfmt, nfmt, cfmt, priceFormatFor } = await import(src('utils/format.ts'))
const { safeUrl } = await import(src('utils/url.ts'))
const { newsSimplify } = await import(src('features/news/newsItem.ts'))
const { mergeNewsFeeds, loadNewsProgressive, hedge, newsDedup } = await import(src('features/news/newsLoad.ts'))
const { VENUES, isUsdQuoted } = await import(src('features/advanced/venues.ts'))
const { groupAggTrades, autoThreshold, bubbleRadius, gapLabelSpot, whaleLegendCompact } = await import(
  src('features/whales/whaleMath.ts')
)
const alerts = await import(src('features/alerts/rules.ts'))
const wls = await import(src('features/favorites/watchlists.ts'))
const { buildVolumeProfile, computeVolumeProfile, clampRows, clampValueArea } = await import(
  src('features/charts/volumeProfile.ts')
)

const { ProviderChain, klineFreshness, createPacer, toKlineRows } = await import(
  src('services/providerChain.ts')
)
const { KlineHub, MAX_HUB_STREAMS } = await import(src('services/klineHub.ts'))
const { StreamMux } = await import(src('services/streamMux.ts'))

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
  // 7m does not divide a day: buckets restart at 00:00 UTC, the last one short.
  const d7 = customTfDef('7m')
  const day0 = Date.UTC(2026, 9, 23)
  ok('bucket 7m: a new day starts a new bucket', bucketIndex(day0, d7) !== bucketIndex(day0 - 60000, d7))
  eq('bucket 7m: same bucket inside 7 minutes', bucketIndex(day0 + 6 * 60000, d7), bucketIndex(day0, d7))
  eq('bucket 7m: the last bucket ends at midnight', bucketEnd(day0 - 5 * 60000, d7), day0)
  eq('bucket 7m: a full bucket is 7 minutes', bucketEnd(day0, d7), day0 + 7 * 60000)
  eq('bucket 15m: dividing intervals are unchanged', bucketEnd(day0, tfDef('15m')), day0 + 900000)
}

// ------------------------------------------- older-history paging (resampled)
// The loaded series usually starts mid-bucket, and a resampled bucket is
// stamped with its first member's time — so the older page ends with the rest
// of that same bucket. It must fold into one candle, not draw twice.
{
  const def45 = tfDef('45m')
  const step = 15 * 60000
  const t0 = Date.UTC(2026, 0, 1)
  const all = []
  for (let i = 0; i < 300; i++) all.push({ t: t0 + i * step, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 })
  // First page from row 100: 100 % 3 = 1, so it opens one bar into a bucket.
  const shown = resample(all.slice(100), def45)
  const page = resample(all.filter((r) => r.t < shown[0].t), def45)
  const naive = page.concat(shown).map((c) => bucketIndex(c.t, def45))
  ok('paging: the naive prepend repeats a bucket (the bug)', naive.some((b, i) => i > 0 && b === naive[i - 1]))
  const { candles, added, merged } = mergeOlderPage(page, shown, def45)
  const ids = candles.map((c) => bucketIndex(c.t, def45))
  ok('paging: no bucket appears twice', ids.every((b, i) => i === 0 || b !== ids[i - 1]))
  ok('paging: times strictly ascending', candles.every((c, i) => i === 0 || c.t > candles[i - 1].t))
  ok('paging: the split bucket was merged', merged)
  eq('paging: added counts only new buckets', added, page.length - 1)
  eq('paging: one candle per bucket overall', candles.length, resample(all, def45).length)
  near('paging: volume preserved', candles.reduce((a, c) => a + c.v, 0), 300)
  const whole = resample(all, def45)
  eq('paging: merged bucket equals a clean resample', candles[added], whole[added])
  eq('paging: merged bucket keeps the shown close', candles[added].c, shown[0].c)
  eq('paging: newer candles untouched', candles.slice(added + 1), shown.slice(1))
  // Native interval: nothing to merge, everything older is added.
  const d15 = tfDef('15m')
  const n = mergeOlderPage(all.slice(0, 100), all.slice(100), d15)
  eq('paging: native interval prepends as-is', [n.added, n.merged, n.candles.length], [100, false, 300])
  // Room cap trims the oldest new candles, never the merge.
  const capped = mergeOlderPage(page, shown, def45, 5)
  eq('paging: room caps what is added', [capped.added, capped.merged], [5, true])
  ok('paging: capped result still ascending', capped.candles.every((c, i) => i === 0 || c.t > capped.candles[i - 1].t))
  // Overlap and disorder from a provider never leak into the series.
  const messy = mergeOlderPage([page[2], page[1], page[3], shown[0], shown[1]], shown, def45)
  ok('paging: overlapping or unsorted page stays strictly ascending', messy.candles.every((c, i) => i === 0 || c.t > messy.candles[i - 1].t))
  eq('paging: an empty page adds nothing', mergeOlderPage([], shown, def45), { candles: shown, added: 0, merged: false })
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
  // Only Binance's own 429/418 may freeze Binance REST (api/client rawFetch).
  for (const u of [
    'https://api.binance.com/api/v3/klines?symbol=BTCUSDT',
    'https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT',
    'https://data-api.binance.vision/api/v3/aggTrades?symbol=BTCUSDT',
  ]) ok('ratelimit: Binance host trips the guard — ' + new URL(u).host, isBinanceUrl(u))
  for (const u of [
    'https://api.coingecko.com/api/v3/global',
    'https://api.bybit.com/v5/market/kline',
    'https://www.okx.com/api/v5/market/candles',
    'https://query1.finance.yahoo.com/v8/finance/chart/GC=F',
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://testnet.binancefuture.com/fapi/v1/klines',
    'https://evil.example/?u=https://api.binance.com',
    'https://notbinance.com/api',
    'not a url',
  ]) ok('ratelimit: non-Binance host never trips the guard — ' + u, !isBinanceUrl(u))
}
{
  // A fresh copy of the module, with no ban recorded yet. A local clock ahead
  // of Binance's reads a live ban's expiry as past; the 418 itself still means
  // "stop", so Retry-After (or the default) must set the cooldown.
  const rl = await import(src('api/rateLimit.ts') + '?skew')
  rl.noteLimitResponse(418, '30', 'IP banned until ' + (Date.now() - 5_000))
  ok('ratelimit: a ban expiry behind our clock still sets a cooldown', rl.isRateLimited())
  ok(
    'ratelimit: that cooldown comes from Retry-After',
    Math.abs(rl.cooldownLeft() - 30_000) < 2000,
    rl.cooldownLeft(),
  )
}

// ----------------------------------------------------------------- format
{
  eq('fmt: price keeps cents above 100', pfmt(80123.456), '80,123.46')
  // Pinned outputs that were already right must not move.
  eq('fmt: pfmt pins', [0, 0.5, 1, 99.99, 1234.5, 65000, 0.00012345, 0.00000401].map(pfmt),
    ['0.00000000', '0.50000', '1.0000', '99.9900', '1,234.50', '65,000.00', '0.000123', '0.00000401'])
  // Below a millionth, about four significant digits instead of zeros.
  eq('fmt: nano prices are not zero', pfmt(3.2e-9), '0.000000003200')
  eq('fmt: sub-millionth keeps 4 significant digits', pfmt(7.123e-7), '0.0000007123')
  // Negatives take their decimals from the magnitude.
  eq('fmt: negative thousands keep cents', pfmt(-1234.5), '-1,234.50')
  eq('fmt: negative fractions match positives', pfmt(-0.5), '-0.50000')
  eq('fmt: negative small price', pfmt(-0.00012345), '-0.000123')
  ok('fmt: sub-cent prices keep precision', pfmt(0.00000401).length > 6, pfmt(0.00000401))
  eq('fmt: compact millions', nfmt(2_400_000), '2.40M')
  eq('fmt: money compacts with a symbol', cfmt(2_400_000_000), '$2.40B')
  eq('fmt: market-wide totals compact to trillions', cfmt(2_882_240_000_000), '$2.88T')
  eq('fmt: non-finite is a dash, never NaN', pfmt(NaN), '—')
  eq('fmt: infinity is a dash', nfmt(Infinity), '—')
  eq('fmtUsd: thousands', fmtUsd(1500), '1.5K')
}

// --------------------------------------------------------- news links (XSS)
// Feed links land in href/src via innerHTML and in the lr_news_cache copy, so
// only absolute http(s) may survive; everything else collapses to '#'.
{
  eq('safeUrl: https kept', safeUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c')
  eq('safeUrl: http kept', safeUrl('http://example.com/x'), 'http://example.com/x')
  eq('safeUrl: javascript blocked', safeUrl('javascript:alert(1)'), '#')
  eq('safeUrl: upper-case scheme blocked', safeUrl('JAVASCRIPT:alert(1)'), '#')
  eq('safeUrl: leading space + control chars blocked', safeUrl(' \u0001\tJaVaScRiPt:alert(1)'), '#')
  eq('safeUrl: newline/tab inside scheme blocked', safeUrl('java\nscr\tipt:alert(1)'), '#')
  eq('safeUrl: data blocked', safeUrl('data:text/html,<script>alert(1)</script>'), '#')
  eq('safeUrl: vbscript blocked', safeUrl('vbscript:msgbox(1)'), '#')
  eq('safeUrl: relative rejected', safeUrl('/news/1'), '#')
  eq('safeUrl: protocol-relative rejected', safeUrl('//evil.example/x'), '#')
  eq('safeUrl: empty', safeUrl(''), '#')
  eq('safeUrl: whitespace only', safeUrl('   '), '#')
  eq('safeUrl: non-string', safeUrl(undefined), '#')
  eq('safeUrl: malformed', safeUrl('http://'), '#')
  eq('safeUrl: garbage', safeUrl('not a url'), '#')
  eq('safeUrl: attribute breakout is encoded', safeUrl('https://a.example/"><x>').includes('"'), false)

  const simp = newsSimplify('Src', '#fff')
  const good = simp({ title: ' Bitcoin surges ', link: 'https://news.example/btc', pubDate: '2026-01-01 00:00:00', thumbnail: 'https://img.example/t.jpg' })
  eq('newsSimplify: https link kept', good.url, 'https://news.example/btc')
  eq('newsSimplify: https thumbnail kept', good.img, 'https://img.example/t.jpg')
  eq('newsSimplify: title trimmed + tagged', [good.title, good.coins.includes('BTC'), good.sent], ['Bitcoin surges', true, 'pos'])
  const bad = simp({ title: 'x', link: ' JavaScript:alert(document.cookie)', thumbnail: 'javascript:alert(1)' })
  eq('newsSimplify: javascript link becomes #', bad.url, '#')
  eq('newsSimplify: javascript thumbnail dropped', bad.img, null)
  eq('newsSimplify: missing link becomes #', simp({ title: 'x' }).url, '#')
  eq('newsSimplify: data: enclosure dropped', simp({ title: 'x', enclosure: { link: 'data:image/svg+xml,<svg onload=alert(1)>' } }).img, null)
  eq('newsSimplify: RFC 822 pubDate parsed', simp({ title: 'x', pubDate: 'Fri, 24 Oct 2026 10:00:00 +0000' }).time, Date.UTC(2026, 9, 24, 10))
  eq('newsSimplify: unparseable pubDate is 0, not NaN', simp({ title: 'x', pubDate: 'garbage' }).time, 0)
  eq('newsSimplify: empty title skipped', simp({ title: '  ', link: 'https://a.example' }), null)
}

// ------------------------------------------------- news progressive loading
// The wire renders as feeds land rather than after the slowest one, shows the
// lr_news_cache copy first, and ends the loading state at a deadline.
{
  const item = (title, time, src = 'A') => ({ title, url: '#', time, src, color: '#fff', img: null, coins: [], sent: 'neu' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const later = (ms, v) => sleep(ms).then(() => v)
  const fail = (ms) => sleep(ms).then(() => { throw new Error('down') })
  const titles = (u) => u.items.map((n) => n.title)

  eq('newsDedup: same words reordered', newsDedup('Bitcoin price hits record high today', 'Today bitcoin price hits record high'), true)
  eq('newsDedup: different stories', newsDedup('Bitcoin hits record', 'Solana network outage'), false)
  const m = mergeNewsFeeds([
    [item('Old story', 1), item('Bitcoin price hits record high today', 5)],
    null,
    [item('Bitcoin price hits record high, today!', 9, 'B'), item('Fresh one', 10, 'B')],
  ])
  eq('merge: newest first, near-dupes dropped, first feed wins', m.map((n) => [n.title, n.src]), [['Fresh one', 'B'], ['Bitcoin price hits record high today', 'A'], ['Old story', 'A']])
  eq('merge: order of arrival does not matter', mergeNewsFeeds([[item('x one', 1)], [item('y two', 2)]]).map((n) => n.title), ['y two', 'x one'])
  eq('merge: empty titles skipped', mergeNewsFeeds([[item('', 1), item('!!!', 2)]]).length, 0)

  // Partial results before the deadline: one feed hangs, the others land.
  {
    const ups = []
    const t0 = Date.now()
    const feeds = [() => later(10, [item('Alpha story', 3)]), () => new Promise(() => {}), () => later(20, [item('Beta story', 4)])]
    loadNewsProgressive({ total: 3, fetchFeed: (i) => feeds[i](), onUpdate: (u) => ups.push({ ...u, at: Date.now() - t0 }), deadlineMs: 400 })
    await sleep(450)
    const ready = ups.filter((u) => u.phase === 'ready')
    eq('progressive: first feed shown before the others', titles(ready[0]), ['Alpha story'])
    ok('progressive: shown well before the deadline', ready[0].at < 300, ready[0].at)
    eq('progressive: second feed merges in', titles(ready[ready.length - 1]), ['Beta story', 'Alpha story'])
    ok('progressive: a hung feed never puts it back to loading', !ups.slice(1).some((u) => u.phase !== 'ready'), ups.map((u) => u.phase))
  }

  // Cache first: on screen at once, kept until the deadline, then live.
  {
    const ups = []
    const cached = [item('Cached story', 1)]
    const feeds = [() => later(10, [item('Live story', 5)]), () => new Promise(() => {})]
    loadNewsProgressive({ total: 2, fetchFeed: (i) => feeds[i](), onUpdate: (u) => ups.push(u), cached, deadlineMs: 250 })
    eq('cache-first: cached wire published synchronously', [ups.length, ups[0] && ups[0].cached, ups[0] && titles(ups[0])], [1, true, ['Cached story']])
    await sleep(60)
    eq('cache-first: one feed does not replace the cached list before the deadline', ups.length, 1)
    await sleep(300)
    const lastU = ups[ups.length - 1]
    eq('cache-first: live wire takes over at the deadline', [lastU.cached, titles(lastU)], [false, ['Live story']])
  }

  // All feeds fail: error, not an endless spinner; with a cache the cache stays.
  {
    const ups = []
    const fin = await loadNewsProgressive({ total: 3, fetchFeed: () => fail(5), onUpdate: (u) => ups.push(u), deadlineMs: 1000 })
    eq('all-fail: error phase', [fin.phase, fin.items.length, fin.ok], ['error', 0, 0])
    eq('all-fail: loading then error', ups.map((u) => u.phase), ['loading', 'error'])
    const withCache = await loadNewsProgressive({ total: 2, fetchFeed: () => fail(5), onUpdate: () => {}, cached: [item('Kept', 1)], deadlineMs: 1000 })
    eq('all-fail: a cached wire stays up', [withCache.phase, withCache.cached, titles(withCache)], ['ready', true, ['Kept']])
    const empty = await loadNewsProgressive({ total: 2, fetchFeed: () => later(5, []), onUpdate: () => {}, deadlineMs: 1000 })
    eq('empty: feeds answered with no stories', empty.phase, 'empty')
    const ups2 = []
    loadNewsProgressive({ total: 2, fetchFeed: () => new Promise(() => {}), onUpdate: (u) => ups2.push(u.phase), deadlineMs: 20 })
    await sleep(40)
    eq('deadline: nothing arrived means error, not loading', ups2, ['loading', 'error'])
    const ups3 = []
    let current = true
    loadNewsProgressive({ total: 1, fetchFeed: () => later(20, [item('Stale run', 1)]), onUpdate: (u) => ups3.push(u.phase), deadlineMs: 1000, isCurrent: () => current })
    current = false
    await sleep(40)
    eq('superseded run publishes nothing more', ups3, ['loading'])
  }

  // Source hedging: fallback asked on failure or after the head start.
  {
    eq('hedge: primary wins', await hedge(() => later(5, 'p'), () => later(1, 'f'), 50), 'p')
    eq('hedge: failure goes straight to fallback', await hedge(() => fail(1), () => later(1, 'f'), 1000), 'f')
    const t0 = Date.now()
    const v = await hedge(() => new Promise(() => {}), () => later(1, 'f'), 20)
    ok('hedge: slow primary hedged after the head start', v === 'f' && Date.now() - t0 < 500, [v, Date.now() - t0])
    let err = null
    await hedge(() => fail(1), () => fail(2), 1000).catch((e) => (err = e))
    ok('hedge: rejects only when both fail', err instanceof Error)
  }
}

// ---------------------------------------------------- modal focus trap (utils/dom)
{
  const { nextFocusIndex } = await import(src('utils/dom.ts'))
  eq('focus trap: Tab moves forward', nextFocusIndex(0, 3, false), 1)
  eq('focus trap: Tab on the last wraps to the first', nextFocusIndex(2, 3, false), 0)
  eq('focus trap: Shift+Tab on the first wraps to the last', nextFocusIndex(0, 3, true), 2)
  eq('focus trap: Shift+Tab moves back', nextFocusIndex(2, 3, true), 1)
  eq('focus trap: focus outside, Tab goes to the first', nextFocusIndex(-1, 3, false), 0)
  eq('focus trap: focus outside, Shift+Tab goes to the last', nextFocusIndex(-1, 3, true), 2)
  eq('focus trap: a single element keeps focus', nextFocusIndex(0, 1, false), 0)
  eq('focus trap: nothing focusable', nextFocusIndex(-1, 0, false), -1)
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

// ------------------------------------------------- futures symbols + stale guard
// Funding/OI/books are fetched for "the current symbol": the 1000-unit
// memecoin perps must map, and a response for a coin the user has left must
// never land in the new coin's state.
{
  const S = await import(src('services/symbolScope.ts'))
  eq('futsym: BTC trades under its spot name', S.futuresSymbolOf('BTCUSDT'), { sym: 'BTCUSDT', mult: 1 })
  eq('futsym: PEPE is a 1000-unit contract', S.futuresSymbolOf('PEPEUSDT'), { sym: '1000PEPEUSDT', mult: 1000 })
  eq('futsym: SHIB too', S.futuresSymbolOf('SHIBUSDT').sym, '1000SHIBUSDT')
  eq('futsym: BONK / FLOKI', [S.futuresSymbolOf('BONKUSDT').sym, S.futuresSymbolOf('FLOKIUSDT').sym], ['1000BONKUSDT', '1000FLOKIUSDT'])
  eq('futsym: case-insensitive', S.futuresSymbolOf('pepeusdt').sym, '1000PEPEUSDT')
  eq('futsym: already-1000 base is not doubled', S.futuresSymbolOf('1000SATSUSDT').sym, '1000SATSUSDT')
  eq('futsym: gold goes through the instrument table', S.futuresSymbolOf('XAUUSD'), { sym: 'XAUUSDT', mult: 1 })
  eq('futsym: an instrument with no perp has none', S.futuresSymbolOf('EURUSD'), null)
  eq('futsym: empty has none', S.futuresSymbolOf(''), null)
  ok('futsym: the list stays small', S.FUTURES_1000X.size > 0 && S.FUTURES_1000X.size <= 12, S.FUTURES_1000X.size)

  const pr = S.perUnitPremium({ symbol: '1000PEPEUSDT', markPrice: '0.0125', indexPrice: '0.0124', lastFundingRate: '0.0001' }, 1000)
  near('futsym: mark price restated per token', +pr.markPrice, 0.0000125, 1e-12)
  near('futsym: index price restated per token', +pr.indexPrice, 0.0000124, 1e-12)
  eq('futsym: funding is a ratio, untouched', pr.lastFundingRate, '0.0001')
  eq('futsym: OI restated in tokens', +S.perUnitOi({ openInterest: '2.5' }, 1000).openInterest, 2500)
  const raw = { markPrice: '100' }
  ok('futsym: mult 1 is a no-op', S.perUnitPremium(raw, 1) === raw)

  // A mocked await whose symbol changes underneath it.
  let cur = 'BTCUSDT'
  const deferred = () => {
    let res, rej
    const p = new Promise((a, b) => ((res = a), (rej = b)))
    return { p, res, rej }
  }
  const store = { fr: 'BTC funding' }
  let d = deferred()
  let asked = ''
  let run = S.symbolScoped(() => cur, (sym) => ((asked = sym), d.p), (v) => (store.fr = v), () => (store.fr = null))
  cur = 'PEPEUSDT' // user switches while BTC's request is in flight
  d.res('BTC late')
  eq('stale guard: asked for the symbol current at call time', asked, 'BTCUSDT')
  eq('stale guard: late answer reports stale', await run, 'stale')
  eq('stale guard: late answer does not overwrite', store.fr, 'BTC funding')

  d = deferred()
  run = S.symbolScoped(() => cur, () => d.p, (v) => (store.fr = v), () => (store.fr = null))
  d.res('PEPE funding')
  eq('stale guard: current answer applies', [await run, store.fr], ['applied', 'PEPE funding'])

  d = deferred()
  run = S.symbolScoped(() => cur, () => d.p, (v) => (store.fr = v), () => (store.fr = null))
  d.rej(new Error('HTTP 400'))
  eq('stale guard: failure for current symbol clears', [await run, store.fr], ['failed', null])

  store.fr = 'PEPE funding'
  d = deferred()
  run = S.symbolScoped(() => cur, () => d.p, (v) => (store.fr = v), () => (store.fr = null))
  cur = 'ETHUSDT'
  d.rej(new Error('timeout'))
  eq('stale guard: failure for a left symbol is ignored', [await run, store.fr], ['stale', 'PEPE funding'])

  d = deferred()
  run = S.symbolScoped(() => cur, () => d.p, () => { throw new Error('bad shape') }, () => (store.fr = null))
  d.res({})
  eq('stale guard: a throwing apply counts as a failure', [await run, store.fr], ['failed', null])

  eq('candles tag: symbol|tf', S.candlesTag('BTCUSDT', '15m'), 'BTCUSDT|15m')
  ok('candles tag: matches its own market', S.candlesMatch('BTCUSDT|15m', 'BTCUSDT', '15m'))
  ok('candles tag: another symbol does not match', !S.candlesMatch('BTCUSDT|15m', 'PEPEUSDT', '15m'))
  ok('candles tag: another interval does not match', !S.candlesMatch('BTCUSDT|15m', 'BTCUSDT', '1h'))
  ok('candles tag: empty (loading) matches nothing', !S.candlesMatch('', 'BTCUSDT', '15m'))
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

  // The unscanned-gap label: never while the scan is running, never on the
  // centred watermark, against the scan boundary when it is in view.
  const gap = { left: 0, width: 400, edge: true, paneH: 400, loading: false }
  eq('whales: no gap label while the backfill is still scanning', gapLabelSpot({ ...gap, loading: true }), null)
  eq('whales: no gap label on a sliver of unscanned time', gapLabelSpot({ ...gap, width: 100 }), null)
  const spot = gapLabelSpot(gap)
  ok('whales: gap label clears the centred watermark band', spot && Math.abs(spot.y - 200) >= 30, spot)
  eq('whales: gap label hugs the scan boundary when it is in view', [spot?.x, spot?.align], [392, 'right'])
  eq('whales: gap label centres in a stretch that fills the pane', gapLabelSpot({ ...gap, edge: false })?.align, 'center')
  const short = gapLabelSpot({ ...gap, paneH: 280 })
  ok('whales: a short pane puts the label above the watermark', short && short.y < 140 &&short.y >= 64, short)
  eq('whales: no room clear of the watermark and legends: no label', gapLabelSpot({ ...gap, paneH: 200 }), null)
  eq('whales: legend collapses to a chip under 520px', [whaleLegendCompact(390), whaleLegendCompact(519)], [true, true])
  eq('whales: legend stays full width at 520px+ and before measuring', [whaleLegendCompact(520), whaleLegendCompact(0)], [false, false])
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

// ---------------------------------------------------------------- LRU caches
// md.candles and mdCache.data (services/market.ts) are capped this way — the
// same delete-and-reinsert order as memoryStore above.
{
  const { lruSet, lruTouch } = await import(src('utils/lru.ts'))
  const rec = {}
  for (let i = 0; i < 5; i++) lruSet(rec, 'S' + i + '|15m', i, 3)
  eq('lru: keeps the newest max entries', Object.keys(rec), ['S2|15m', 'S3|15m', 'S4|15m'])
  lruTouch(rec, 'S2|15m')
  lruSet(rec, 'S5|15m', 5, 3)
  eq('lru: a touched entry survives over an older one', Object.keys(rec), ['S4|15m', 'S2|15m', 'S5|15m'])
  lruSet(rec, 'S4|15m', 44, 3)
  eq('lru: re-setting a key refreshes it without growing', [Object.keys(rec).length, rec['S4|15m']], [3, 44])
  const keep = (k) => k === 'S2|15m'
  lruSet(rec, 'S6|15m', 6, 3, keep)
  lruSet(rec, 'S7|15m', 7, 3, keep)
  ok('lru: the protected (on-screen) key is never evicted', 'S2|15m' in rec, Object.keys(rec))
  eq('lru: still capped with a protected key', Object.keys(rec).length, 3)
  lruTouch(rec, 'missing')
  ok('lru: touching a missing key adds nothing', !('missing' in rec))
}

// ---------------------------------------------------------------- Binance slot queue
{
  const { createSlotQueue, StaleRequestError, isStaleRequest } = await import(src('api/slotQueue.ts'))
  // Fake clock + timers: advance() fires every timer that has come due.
  let clock = 1000
  let timers = []
  const setTimer = (fn, ms) => timers.push({ at: clock + ms, fn })
  const flush = () => new Promise((r) => setImmediate(r))
  async function advance(ms) {
    const end = clock + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift()
      clock = t.at
      t.fn()
      await flush()
    }
    clock = end
    await flush()
  }
  const track = (q, name, req, log) =>
    q.acquire(req).then(
      () => log.push([name, clock]),
      (e) => log.push([name, isStaleRequest(e) ? 'dropped' : 'error']),
    )

  // Ordering + spacing
  {
    const q = createSlotQueue(50, () => clock, setTimer)
    const log = []
    for (const n of ['a', 'b', 'c', 'd']) track(q, n, undefined, log)
    await flush()
    eq('queue: first request goes at once', log, [['a', 1000]])
    eq('queue: the rest wait', q.pending(), 3)
    await advance(200)
    eq('queue: FIFO, one slot every gap', log, [
      ['a', 1000],
      ['b', 1050],
      ['c', 1100],
      ['d', 1150],
    ])
    eq('queue: drained', q.pending(), 0)
    clock += 1000
    track(q, 'e', undefined, log)
    await flush()
    eq('queue: after a quiet spell a request is not held back', log.at(-1), ['e', clock])
  }

  // Priority
  {
    clock = 10_000
    timers = []
    const q = createSlotQueue(50, () => clock, setTimer)
    const log = []
    for (const n of ['bg1', 'bg2', 'bg3']) track(q, n, { priority: 'normal' }, log)
    await flush()
    track(q, 'chart', { priority: 'high' }, log)
    track(q, 'chart2', { priority: 'high' }, log)
    await advance(500)
    eq(
      'queue: high priority jumps queued background work, FIFO among themselves',
      log.map((x) => x[0]),
      ['bg1', 'chart', 'chart2', 'bg2', 'bg3'],
    )
    eq('queue: the high request waits only one gap', log[1], ['chart', 10_050])
  }

  // Stale drop
  {
    clock = 20_000
    timers = []
    const q = createSlotQueue(50, () => clock, setTimer)
    const log = []
    let wanted = 'BTC'
    track(q, 'first', undefined, log)
    for (const s of ['ETH', 'SOL', 'BTC'])
      track(q, s, { priority: 'high', isStale: () => wanted !== s }, log)
    track(q, 'bg', undefined, log)
    await flush()
    await advance(500)
    eq('queue: stale requests are dropped without spending a slot', log, [
      ['first', 20_000],
      ['ETH', 'dropped'],
      ['SOL', 'dropped'],
      ['BTC', 20_050],
      ['bg', 20_100],
    ])
    // Staleness is judged when the turn comes, not when queued.
    wanted = 'ETH'
    const log2 = []
    track(q, 'x', undefined, log2)
    track(q, 'ETH', { isStale: () => wanted !== 'ETH' }, log2)
    await flush()
    wanted = 'SOL'
    await advance(500)
    eq(
      'queue: a request that goes stale while waiting is dropped',
      log2.map((x) => x[0] + ':' + (x[1] === 'dropped' ? 'dropped' : 'ran')),
      ['x:ran', 'ETH:dropped'],
    )
    let err = null
    await q.acquire({ isStale: () => true }).catch((e) => (err = e))
    ok('queue: drop rejects with StaleRequestError', err instanceof StaleRequestError && isStaleRequest(err))
    ok('queue: a real error is not a stale drop', !isStaleRequest(new Error('HTTP 500')))
    const log3 = []
    track(q, 'guard', { isStale: () => { throw new Error('boom') } }, log3)
    await advance(100)
    eq('queue: a throwing guard does not drop the request', log3.map((x) => x[0] + ':' + typeof x[1]), ['guard:number'])
  }

  // Failover chains: a dropped request is not a provider failure
  {
    let calls = 0
    const chain = new ProviderChain(
      [
        { id: 'a', name: 'A', fn: async () => { calls++; throw new StaleRequestError() } },
        { id: 'b', name: 'B', fn: async () => { calls += 100; return [1] } },
      ],
      { breakerFailures: 1, keyOf: (args) => JSON.stringify(args.slice(0, 1)) },
    )
    let err = null
    await chain.get('X', { priority: 'high' }).catch((e) => (err = e))
    ok('chain: a stale drop is rethrown as is', isStaleRequest(err))
    eq('chain: and does not fall through to the fallback', calls, 1)
    ok('chain: nor trip the breaker', !chain.isOpen('a'))
    const c2 = new ProviderChain([{ id: 'a', name: 'A', fn: async () => [7] }], {
      keyOf: (args) => JSON.stringify(args.slice(0, 1)),
    })
    await c2.get('X', { priority: 'high', isStale: () => false })
    eq('chain: keyOf leaves request options out of the cache key', c2.cached('X')?.data, [7])
  }
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

// ---------------------------------------------------------------- stream mux (main chart sockets)
{
  const sockets = []
  class FakeWS {
    constructor(url) {
      this.url = url
      this.sent = []
      this.closed = 0
      this.onopen = this.onmessage = this.onclose = this.onerror = null
      sockets.push(this)
    }
    send(m) {
      this.sent.push(JSON.parse(m))
    }
    close() {
      this.closed++
      if (this.onclose) this.onclose()
    }
    accept() {
      if (this.onopen) this.onopen()
    }
    drop() {
      if (this.onclose) this.onclose()
    }
    push(stream, data) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify({ stream, data }) })
    }
  }
  const prevWS = globalThis.WebSocket
  globalThis.WebSocket = FakeWS
  const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
  const params = (ws, method) => ws.sent.filter((m) => m.method === method).flatMap((m) => m.params)
  try {
    const live = []
    let drops = 0
    const mux = new StreamMux({
      base: 'wss://test/stream',
      flushMs: 0,
      minGapMs: 0,
      idleCloseMs: 20,
      onLive: (k, up, dropped) => live.push([k, up, dropped]),
      onDrop: () => drops++,
    })
    const got = []
    const set = (sym, tag) => ({
      [sym + '@ticker']: (d) => got.push([tag, 'tk', d.c]),
      [sym + '@aggTrade']: () => {},
      [sym + '@kline_15m']: () => {},
      [sym + '@depth20@100ms']: () => {},
    })
    mux.want(set('btcusdt', 'btc'))
    eq('mux: one socket for the four streams', sockets.length, 1)
    const ws = sockets[0]
    eq(
      'mux: streams ride on the URL',
      ws.url,
      'wss://test/stream?streams=btcusdt@ticker/btcusdt@aggTrade/btcusdt@kline_15m/btcusdt@depth20@100ms',
    )
    eq('mux: not live while connecting', mux.liveCount, 0)
    ws.accept()
    eq('mux: four live streams once open', mux.liveCount, 4)
    eq('mux: opening sends no frame', ws.sent.length, 0)
    ws.push('btcusdt@ticker', { c: '1' })
    eq('mux: routes a frame to its stream', got, [['btc', 'tk', '1']])

    // Coin switch: the stop then the new set, as setSymbol does it.
    mux.want({})
    mux.want(set('ethusdt', 'eth'))
    await tick()
    eq('mux: a switch keeps the socket', [sockets.length, ws.closed], [1, 0])
    eq('mux: one UNSUBSCRIBE for the old coin', params(ws, 'UNSUBSCRIBE').sort(), [
      'btcusdt@aggTrade',
      'btcusdt@depth20@100ms',
      'btcusdt@kline_15m',
      'btcusdt@ticker',
    ])
    eq('mux: one SUBSCRIBE for the new coin', params(ws, 'SUBSCRIBE').length, 4)
    eq('mux: two frames for the whole switch', ws.sent.length, 2)
    ok('mux: unsubscribing is not reported as a drop', live.every(([, up, dropped]) => up || !dropped))
    ws.push('btcusdt@ticker', { c: '2' }) // old coin, still in flight
    eq('mux: frames for an unsubscribed stream go nowhere', got.length, 1)
    ws.push('ethusdt@ticker', { c: '3' })
    eq('mux: the new coin streams', got[got.length - 1], ['eth', 'tk', '3'])

    // Timeframe switch: only the kline stream changes; the rest keep flowing
    // to the new handlers.
    const n = ws.sent.length
    const tf1h = set('ethusdt', 'eth2')
    delete tf1h['ethusdt@kline_15m']
    tf1h['ethusdt@kline_1h'] = () => {}
    mux.want(tf1h)
    await tick()
    eq('mux: a timeframe switch swaps only the kline', [params(ws, 'SUBSCRIBE').pop(), ws.sent.length - n], [
      'ethusdt@kline_1h',
      2,
    ])
    ws.push('ethusdt@ticker', { c: '4' })
    eq('mux: an unchanged stream reaches the new handler', got[got.length - 1], ['eth2', 'tk', '4'])

    // An unexpected drop reconnects with what is wanted; a replaced socket is inert.
    const rnd = Math.random
    Math.random = () => 0
    const d0 = drops
    ws.drop()
    eq('mux: a lost socket is reported once', drops - d0, 1)
    ok('mux: and its streams as dropped', live.some(([k, up, dropped]) => k === 'ethusdt@ticker' && !up && dropped))
    await tick(1300) // first backoff step is 1.2s
    Math.random = rnd
    eq('mux: reconnects after a drop', sockets.length, 2)
    sockets[1].accept()
    eq('mux: back to four live streams', mux.liveCount, 4)
    const before = got.length
    ws.push('ethusdt@ticker', { c: '5' })
    eq('mux: the old socket can no longer deliver', got.length, before)

    // Nothing wanted: the socket closes after the idle delay, handlers first,
    // and no reconnect follows.
    const ws2 = sockets[1]
    mux.want({})
    await tick(60)
    eq('mux: idle socket closes once', ws2.closed, 1)
    ok('mux: closed with its handlers detached', !ws2.onclose && !ws2.onmessage && !ws2.onopen)
    await tick(1300)
    eq('mux: and does not reconnect', sockets.length, 2)
    eq('mux: no live streams', mux.liveCount, 0)

    // A switch while the socket is still connecting neither closes it nor
    // opens a second one; the change is sent once it opens.
    mux.want(set('solusdt', 'sol'))
    mux.want({})
    mux.want(set('adausdt', 'ada'))
    eq('mux: no second socket while connecting', sockets.length, 3)
    const ws3 = sockets[2]
    eq('mux: the connecting socket is not closed', ws3.closed, 0)
    ws3.accept()
    await tick()
    eq('mux: the change is flushed on open', params(ws3, 'SUBSCRIBE').length, 4)
    eq('mux: live set is the latest coin', mux.liveCount, 4)

    // A stall replaces the socket; dispose stops everything for good.
    const stall = new StreamMux({ base: 'wss://test/stream', flushMs: 0, minGapMs: 0, stallMs: () => 10 })
    stall.want({ 'x@ticker': () => {} })
    const sw = sockets[sockets.length - 1]
    sw.accept()
    ok('mux: fresh stream is not stalled', !stall.check(Date.now()))
    ok('mux: silent stream is stalled', stall.check(Date.now() + 50))
    eq('mux: the stalled socket is closed, handlers detached', [sw.closed, sw.onclose], [1, null])
    stall.dispose()
    mux.dispose()
    const count = sockets.length
    await tick(1300)
    eq('mux: nothing reconnects after dispose', sockets.length, count)
  } finally {
    globalThis.WebSocket = prevWS
  }
}

// ---------------------------------------------------------------- alerts
// "Add alert at {price}" from the price axis, and the notification route.
{
  const { ruleForPriceClick, notifyVia, alertDecimals } = alerts
  eq('alerts: level decimals follow the axis, then 6 significant digits', [83653.16, 1.5, 0.5, 0.00001, 1e-8].map(alertDecimals), [2, 5, 6, 10, 13])
  eq('alerts: axis click above last crosses above', ruleForPriceClick(70500, 70000), { condition: 'crosses_above', value: 70500 })
  eq('alerts: axis click below last crosses below (cents kept)', ruleForPriceClick(69000.123456789, 70000), { condition: 'crosses_below', value: 69000.12 })
  eq('alerts: axis click at last price crosses below', ruleForPriceClick(70000, 70000).condition, 'crosses_below')
  eq('alerts: tiny coin keeps its precision', ruleForPriceClick(0.0000123456789, 0.0000120001), { condition: 'crosses_above', value: 0.0000123457 })
  eq('alerts: 1e-8 coin below', ruleForPriceClick(1.23456789e-8, 2e-8), { condition: 'crosses_below', value: 1.23457e-8 })
  ok('alerts: no last price, no rule', ruleForPriceClick(100, NaN) === null && ruleForPriceClick(100, 0) === null)
  ok('alerts: unusable click price, no rule', ruleForPriceClick(NaN, 100) === null && ruleForPriceClick(-1, 100) === null && ruleForPriceClick(0, 100) === null)
  eq('alerts: notify via the worker when there is one', notifyVia({ granted: true, worker: true, ctor: true }), 'worker')
  eq('alerts: notify via the constructor without a worker', notifyVia({ granted: true, worker: false, ctor: true }), 'ctor')
  eq('alerts: no permission, toast only', notifyVia({ granted: false, worker: true, ctor: true }), 'none')
  eq('alerts: no notification API at all', notifyVia({ granted: true, worker: false, ctor: false }), 'none')
}
{
  const { evalPrice, evalTechnical, evalWatchlist, stepRule, normalizeRules, rearm, ALERT_LIMITS } = alerts
  const r = (o) => ({ id: 'x', kind: 'price', sym: 'BTCUSDT', enabled: true, created: 0, condition: 'above', value: 0, once: false, triggerCount: 0, ...o })
  const kl = (closes) => closes.map((c, i) => ({ t: i * 60000, o: c, h: c + 1, l: c - 1, c, v: 1 }))
  const ramp = (n, f) => Array.from({ length: n }, (_, i) => f(i))

  eq('alerts: limits', ALERT_LIMITS, { price: 1000, technical: 1000, watchlist: 15, cond: 400 })

  // The charted candles only stand in for a rule when they are that market's.
  {
    const { chartedCandlesFit, MIN_TECH_CANDLES } = alerts
    const view = { symbol: 'PEPEUSDT', tf: '15m', tfKey: '15m', candlesKey: 'PEPEUSDT|15m', bars: 500 }
    ok('alerts: charted candles fit their own market', chartedCandlesFit(view, 'PEPEUSDT', '15m'))
    ok("alerts: previous coin's candles (mismatched tag) are not used", !chartedCandlesFit({ ...view, candlesKey: 'BTCUSDT|15m' }, 'PEPEUSDT', '15m'))
    ok("alerts: previous interval's candles are not used", !chartedCandlesFit({ ...view, candlesKey: 'PEPEUSDT|1h' }, 'PEPEUSDT', '15m'))
    ok('alerts: untagged (loading) candles are not used', !chartedCandlesFit({ ...view, candlesKey: '' }, 'PEPEUSDT', '15m'))
    ok("alerts: another coin's rule never reads the chart", !chartedCandlesFit(view, 'BTCUSDT', '15m'))
    ok('alerts: too few bars are not used', !chartedCandlesFit({ ...view, bars: MIN_TECH_CANDLES - 1 }, 'PEPEUSDT', '15m'))
  }
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

// ------------------------------------------------------- watchlists (favourites)
{
  const { FAV_ID, FAV_NAME, MAX_LISTS, MAX_SYMBOLS, normalizeWatchlists, initialWatchlists, createList, renameList,
    deleteList, setActive, addSymbol, addSymbolFirst, removeSymbol, moveSymbol, togglePin, orderedSymbols, activeList,
    getList } = wls
  const fav = (st) => getList(st, FAV_ID)

  // migration from the old single list (lr-favCoins) — nothing lost
  const m0 = normalizeWatchlists(null, ['BTC', 'ETH', 'SOL'])
  eq('watchlists: old favourites become the Favourites list', [m0.lists.length, m0.lists[0].id, m0.lists[0].name, m0.lists[0].symbols], [1, FAV_ID, FAV_NAME, ['BTC', 'ETH', 'SOL']])
  eq('watchlists: migrated state is active on Favourites', m0.active, FAV_ID)
  eq('watchlists: nothing saved at all is an empty Favourites', normalizeWatchlists(null, null), initialWatchlists())
  eq('watchlists: migration drops junk, keeps order', normalizeWatchlists(undefined, ['BTC', 7, null, '', ' ETH ', 'BTC']).lists[0].symbols, ['BTC', 'ETH'])
  eq('watchlists: migration caps at the old 50', normalizeWatchlists(null, Array.from({ length: 70 }, (_, i) => 'C' + i)).lists[0].symbols.length, MAX_SYMBOLS)
  // corrupt JSON in storage reads back as null (storageGet's fallback) or junk
  eq('watchlists: corrupt saved lists keep the old favourites', normalizeWatchlists('{not json', ['DOGE']).lists[0].symbols, ['DOGE'])
  eq('watchlists: corrupt lists and favourites is a fresh state', normalizeWatchlists(42, 'oops'), initialWatchlists())
  const saved = { active: 'b', lists: [{ id: FAV_ID, name: 'Mine', symbols: ['BTC'], pinned: ['BTC', 'XRP'] }, { id: 'b', name: '  Alts  ', symbols: ['SOL', 'SOL', 'ADA'], pinned: ['ADA'] }, { id: 'b', name: 'dupe' }, null, { name: 'no id' }] }
  const r0 = normalizeWatchlists(saved, null)
  eq('watchlists: saved lists survive, junk is dropped', r0.lists.map((l) => [l.id, l.name, l.symbols, l.pinned]), [[FAV_ID, 'Mine', ['BTC'], ['BTC']], ['b', 'Alts', ['SOL', 'ADA'], ['ADA']]])
  eq('watchlists: saved active list is kept', r0.active, 'b')
  eq('watchlists: the old key wins for the Favourites contents', fav(normalizeWatchlists(saved, ['ETH'])).symbols, ['ETH'])
  eq('watchlists: pins outside the list are dropped on read', fav(normalizeWatchlists(saved, ['ETH'])).pinned, [])
  eq('watchlists: an unknown active id falls back to Favourites', normalizeWatchlists({ ...saved, active: 'gone' }, null).active, FAV_ID)
  eq('watchlists: Favourites is restored first when missing', normalizeWatchlists({ lists: [{ id: 'x', name: 'X', symbols: [] }] }, ['BTC']).lists.map((l) => l.id), [FAV_ID, 'x'])

  // create / rename / delete / switch
  const s0 = initialWatchlists(['BTC'])
  const s1 = createList(s0, '  Swing   trades ', 'w1')
  eq('watchlists: create adds and activates', [s1.lists.length, s1.active, activeList(s1).name], [2, 'w1', 'Swing trades'])
  eq('watchlists: create with a blank name gets a default', createList(s0, '   ', 'w2').lists[1].name, 'Watchlist 2')
  ok('watchlists: create refuses a duplicate id', createList(s1, 'Again', 'w1') === s1)
  let full = s0
  for (let i = 0; i < MAX_LISTS + 3; i++) full = createList(full, 'L' + i, 'id' + i)
  eq('watchlists: list count is capped', full.lists.length, MAX_LISTS)
  eq('watchlists: rename', getList(renameList(s1, 'w1', 'Scalps'), 'w1').name, 'Scalps')
  ok('watchlists: rename to blank is a no-op', renameList(s1, 'w1', '  ') === s1)
  ok('watchlists: rename unknown list is a no-op', renameList(s1, 'nope', 'X') === s1)
  ok('watchlists: rename caps the length', getList(renameList(s1, 'w1', 'x'.repeat(80)), 'w1').name.length <= 32)
  const d1 = deleteList(s1, 'w1')
  eq('watchlists: delete removes and re-activates a neighbour', [d1.lists.length, d1.active], [1, FAV_ID])
  ok('watchlists: the last list is never deleted', deleteList(s0, FAV_ID) === s0)
  ok('watchlists: Favourites is never deleted', deleteList(s1, FAV_ID) === s1)
  const s3 = createList(createList(s1, 'B', 'w2'), 'C', 'w3')
  eq('watchlists: deleting a middle active list activates the next', deleteList(setActive(s3, 'w2'), 'w2').active, 'w3')
  eq('watchlists: deleting an inactive list keeps the active one', deleteList(s3, 'w1').active, 'w3')
  eq('watchlists: switch list', setActive(s3, 'w1').active, 'w1')
  ok('watchlists: switching to an unknown list is a no-op', setActive(s3, 'zzz') === s3)

  // symbols: add / remove / move / pin
  let a = addSymbol(addSymbol(addSymbol(s1, 'w1', 'BTC'), 'w1', 'ETH'), 'w1', 'SOL')
  eq('watchlists: add appends in order', getList(a, 'w1').symbols, ['BTC', 'ETH', 'SOL'])
  ok('watchlists: add is idempotent', addSymbol(a, 'w1', 'ETH') === a)
  ok('watchlists: add ignores blanks', addSymbol(a, 'w1', ' ') === a)
  eq('watchlists: add leaves other lists alone', fav(a).symbols, ['BTC'])
  eq('watchlists: addSymbolFirst puts it on top', getList(addSymbolFirst(a, 'w1', 'XRP'), 'w1').symbols, ['XRP', 'BTC', 'ETH', 'SOL'])
  eq('watchlists: move down', getList(moveSymbol(a, 'w1', 'BTC', 1), 'w1').symbols, ['ETH', 'BTC', 'SOL'])
  eq('watchlists: move up', getList(moveSymbol(a, 'w1', 'SOL', -1), 'w1').symbols, ['BTC', 'SOL', 'ETH'])
  ok('watchlists: move past the top is a no-op', moveSymbol(a, 'w1', 'BTC', -1) === a)
  ok('watchlists: move past the end is a no-op', moveSymbol(a, 'w1', 'SOL', 1) === a)
  const p = togglePin(a, 'w1', 'SOL')
  eq('watchlists: pin puts the symbol on top', orderedSymbols(getList(p, 'w1')), ['SOL', 'BTC', 'ETH'])
  ok('watchlists: pinning a symbol not in the list is a no-op', togglePin(a, 'w1', 'DOGE') === a)
  eq('watchlists: unpin', getList(togglePin(p, 'w1', 'SOL'), 'w1').pinned, [])
  eq('watchlists: unpinned moves skip the pinned row', orderedSymbols(getList(moveSymbol(p, 'w1', 'BTC', 1), 'w1')), ['SOL', 'ETH', 'BTC'])
  ok('watchlists: the first unpinned row cannot move into the pins', moveSymbol(p, 'w1', 'BTC', -1) === p)
  const pp = togglePin(p, 'w1', 'BTC')
  eq('watchlists: pinned rows reorder among themselves', orderedSymbols(getList(moveSymbol(pp, 'w1', 'BTC', -1), 'w1')), ['BTC', 'SOL', 'ETH'])
  const rm = removeSymbol(p, 'w1', 'SOL')
  eq('watchlists: remove drops the symbol and its pin', [getList(rm, 'w1').symbols, getList(rm, 'w1').pinned], [['BTC', 'ETH'], []])
  ok('watchlists: removing a missing symbol is a no-op', removeSymbol(a, 'w1', 'DOGE') === a)
  for (let i = 0; i < MAX_SYMBOLS + 5; i++) a = addSymbol(a, 'w1', 'Z' + i)
  eq('watchlists: symbols per list are capped', getList(a, 'w1').symbols.length, MAX_SYMBOLS)
  // round trip through JSON, as storage does
  eq('watchlists: a saved state reads back unchanged', normalizeWatchlists(JSON.parse(JSON.stringify(pp)), fav(pp).symbols), pp)
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
  // A busy CPU slows every run, so a fixed wall-clock budget flakes. Warm up,
  // keep the best of 5, and judge it against a calibration loop timed the same
  // way in this process (load slows both alike). Idle it runs at ~1–4× the
  // calibration; 8× leaves headroom while a 10× regression still fails. The
  // absolute ceiling catches a pathological case the ratio could hide.
  const bestMs = (fn) => {
    fn()
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      fn()
      best = Math.min(best, performance.now() - t)
    }
    return best
  }
  const calib = () => {
    let s = 0
    for (let i = 0; i < 2e6; i++) s += Math.sqrt(i) % 7
    return s
  }
  const ms = bestMs(() => computeAll(many, long, defOf, base))
  const ref = bestMs(calib)
  ok('graph: a 50-deep chain over 5000 bars within its time budget', ms < ref * 8 && ms < 5000, {
    ms: Math.round(ms),
    calibMs: Math.round(ref),
  })
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
  eq('pine: a bad fill() warns; label.new now draws', [r6.warnings, r6.drawings.labels.length], [['fill'], 50])
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
  // Same scheme as the graph budget above: best of 5 after a warm-up, judged
  // against a calibration loop so a busy CPU does not fail it. Idle it runs at
  // ~5–12× the calibration; 35× leaves headroom while a 10× regression fails.
  const bestMs = (fn) => {
    fn()
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      fn()
      best = Math.min(best, performance.now() - t)
    }
    return best
  }
  const calib = () => {
    let s = 0
    for (let i = 0; i < 2e6; i++) s += Math.sqrt(i) % 7
    return s
  }
  const macd = PINE_EXAMPLES.find((x) => x.id === 'ex_macd').script
  // The runtime's own 2.5s deadline would throw under load and abort the suite:
  // lift it to the ceiling, and report a throw as a failed assertion.
  let ms = Infinity
  let err
  try {
    ms = bestMs(() => runPine(macd, big, {}, { maxMs: 10000 }))
  } catch (e) {
    err = String(e && e.message)
  }
  const ref = bestMs(calib)
  ok('pine: MACD script over 5000 bars within its time budget', ms < ref * 35 && ms < 10000, {
    ms: Math.round(ms),
    calibMs: Math.round(ref),
    err,
  })
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

// ---- signal analysis: only the newest request may paint ---------------------------
{
  const { createLatest } = await import(src('utils/latest.ts'))
  const run = createLatest()
  const btc = run.start()
  const eth = run.start()
  ok('latest: a superseded run is stale', !run.isCurrent(btc))
  ok('latest: the newest run is current', run.isCurrent(eth))
  // BTC resolving after ETH must be dropped.
  let painted = null
  const paint = (token, sym) => { if (run.isCurrent(token)) painted = sym }
  paint(eth, 'ETH')
  paint(btc, 'BTC')
  eq('latest: a late answer for an old run does not overwrite', painted, 'ETH')
  ok('latest: runs are independent', createLatest().isCurrent(1) === false)
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
  // On daily candles 1H is 1/24 of a bar, not 4 bars (4 days) ahead.
  const f1d = forecastFrom(cl, 1440)
  ok('forecast: 1H on 1D candles is a 24th of the 24H move',
    Math.abs((f1d.rows[0].pred - cl.at(-1)) * 24 - (f1d.rows[3].pred - cl.at(-1))) < 1e-9)
  ok('forecast: 24H on 1D candles is one bar ahead (same drift as 1H on 1h)',
    Math.abs((f1d.rows[3].pred - cl.at(-1)) - (f60.rows[0].pred - cl.at(-1))) < 1e-9)
  ok('forecast: a sub-bar horizon has a narrower band than a whole bar',
    f1d.rows[0].hi - f1d.rows[0].lo < f1d.rows[3].hi - f1d.rows[3].lo)
  const bad = forecastFrom(cl, 0)
  ok('forecast: a bad bar size falls back to 15m, never NaN', bad.rows.every((r) => Number.isFinite(r.pred)) &&
    bad.rows[0].pred === f15.rows[0].pred)
}

// ---- utils/indicators: RSI edge case, daily volatility by timeframe -----------------
{
  const { calcRSI, dailyVolPct } = await import(src('utils/indicators.ts'))
  eq('rsi: a perfectly flat series is neutral (50), not overbought', calcRSI(Array(30).fill(100)), 50)
  eq('rsi: only gains is still 100', calcRSI(Array.from({ length: 30 }, (_, i) => 100 + i)), 100)
  eq('rsi: only losses is still 0', calcRSI(Array.from({ length: 30 }, (_, i) => 100 - i)), 0)
  // Alternating +1% / -1%: per-bar sd is 1%, whatever the timeframe.
  const alt = Array.from({ length: 41 }, (_, i) => (i % 2 ? 101 : 100))
  const sd15 = dailyVolPct(alt) / Math.sqrt(96)
  near('vol: 15m default keeps the 96-bar day', dailyVolPct(alt, 15), sd15 * Math.sqrt(96), 1e-9)
  near('vol: 1h candles scale by sqrt(24)', dailyVolPct(alt, 60), sd15 * Math.sqrt(24), 1e-9)
  near('vol: 1D candles are already daily', dailyVolPct(alt, 1440), sd15, 1e-9)
  near('vol: 1W candles scale down by sqrt(7)', dailyVolPct(alt, 10080), sd15 / Math.sqrt(7), 1e-9)
  eq('vol: no returns is zero, not NaN', dailyVolPct([100]), 0)
}

// ---- signal scanner: market-wide sentiment word (Neural Net ring) ------------------
{
  const { avgScore100, sentimentWord, toScale100, SIGNAL_CUTOFF } = await import(src('features/signals/sentiment.ts'))
  eq('sentiment: no markets is no average', avgScore100([]), null)
  eq('sentiment: no average reads Scanning', sentimentWord(null), 'Scanning')
  eq('sentiment: -100..100 maps onto 0..100', avgScore100([-100, 100, 0]), 50)
  // The audit case: an average of 45 while no market is a SELL must not read Bearish.
  const flat = [-10, -10, -10]
  ok('sentiment: scores inside the dead zone are all WAIT', flat.every((v) => Math.abs(v) <= SIGNAL_CUTOFF))
  eq('sentiment: average 45 of WAIT calls reads Neutral', sentimentWord(avgScore100(flat)), 'Neutral')
  eq('sentiment: just past the BUY cut-off reads Bullish', sentimentWord(toScale100(SIGNAL_CUTOFF + 1)), 'Bullish')
  eq('sentiment: just past the SELL cut-off reads Bearish', sentimentWord(toScale100(-SIGNAL_CUTOFF - 1)), 'Bearish')
  eq('sentiment: exactly on the cut-off is still Neutral', sentimentWord(toScale100(SIGNAL_CUTOFF)), 'Neutral')
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

// ---- server bot: "is it on track?" ---------------------------------------------------
{
  const { onTrack, phi, calibration, CAL_NEED } = await import(src('features/selflearn/onTrack.ts'))
  near('ontrack: phi(0) = 0.5', phi(0), 0.5)
  near('ontrack: phi(1.96) ≈ 0.975', phi(1.96), 0.975, 1e-3)
  near('ontrack: phi is symmetric', phi(-1.2) + phi(1.2), 1, 1e-9)
  const day = 86_400_000
  const mk = (p, r, exit) => ({ p, r, t: 0, exit })
  eq('ontrack: nothing yet is "early"', onTrack([], [], 0, day).verdict, 'early')
  // Honest 55% calls, 1:1.5 bracket: 55 wins of +1.5R, 45 losses of −1R per 100.
  const honest = (k) => Array.from({ length: k }, (_, i) => mk(0.55, i % 20 < 11 ? 1.5 : -1, i % 20 < 11 ? 'tp' : 'sl'))
  const good = onTrack(honest(200), honest(200), 0, 20 * day)
  eq('ontrack: honest probabilities and a real edge are on track', good.verdict, 'on-track')
  near('ontrack: calibration gap of honest 55% calls is 0', good.cal.gap, 0, 1e-9)
  ok('ontrack: edge interval clears zero', good.edge.lo > 0, good.edge.lo)
  eq('ontrack: calibration reached needs no more days', good.days.cal, 0)
  // The 5m explore record: predicted ~53%, won ~20%, stops at −1.65R.
  const bad = Array.from({ length: 100 }, (_, i) => (i % 5 === 0 ? mk(0.53, 1.8, 'tp') : mk(0.53, -1.65, 'sl')))
  const b = onTrack(bad, [], 0, 25 * day)
  eq('ontrack: the old 5m record is off track', b.verdict, 'off-track')
  ok('ontrack: it names the oversized stops', b.reasons.some((r) => r.includes('stop-outs')), b.reasons)
  ok('ontrack: it names the dishonest probabilities', b.reasons.some((r) => r.includes('off by 33')), b.reasons)
  // Pace: 40 outcomes in 2 days → (385 − 40) / 20 per day = 18 days.
  eq('ontrack: days left at the pace so far', onTrack([], honest(40), 0, 2 * day).days.cal, Math.ceil((CAL_NEED - 40) / 20))
  eq('ontrack: no pace before a day has passed', onTrack([], honest(40), 0, day / 2).days.cal, null)
  eq('ontrack: buckets split on 0.5', calibration([mk(0.48, 1), mk(0.52, -1)]).map((x) => x.n), [1, 1])
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
  // lightweight-charts v5: addSeries(definition, options); the definition names its type.
  const chart = {
    addSeries: (def, o) => ({ kind: String(def.type).toLowerCase(), o }),
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

// ---- Price-scale / navigation helpers (features/charts/scaleNavMath) ----
{
  const sn = await import(src('features/charts/scaleNavMath.ts'))
  const { tfMs } = await import(src('services/timeframe.ts'))
  eq('scale: defaults for junk', sn.cleanScalePrefs(null), { mode: 'normal', invert: false, lock: false })
  eq('scale: keeps a valid mode', sn.cleanScalePrefs({ mode: 'log', invert: true }).mode, 'log')
  eq('scale: unknown mode falls back', sn.cleanScalePrefs({ mode: 'cubic' }).mode, 'normal')
  eq('scale: lock only on the regular scale', sn.cleanScalePrefs({ mode: 'percent', lock: true }).lock, false)
  eq('scale: lock kept on regular', sn.cleanScalePrefs({ mode: 'normal', lock: true }).lock, true)
  eq(
    'scale: lightweight-charts modes',
    ['normal', 'log', 'percent', 'indexed'].map((m) => sn.LWC_SCALE_MODE[m]),
    [0, 1, 2, 3],
  )
  eq('range: nine presets', sn.RANGE_PRESETS.map((p) => p.id).join(' '), '1D 5D 1M 3M 6M YTD 1Y 5Y All')
  ok('range: every preset names a catalogue interval', sn.RANGE_PRESETS.every((p) => normalizeTf(p.tf) === p.tf))
  // Each range fits in one load (~500 bars) on its interval.
  const now = Date.UTC(2026, 9, 14, 12)
  sn.RANGE_PRESETS.forEach((p) => {
    const start = sn.rangeStartMs(p.id, now)
    if (start == null) return
    const bars = (now - start) / tfMs(tfDef(p.tf))
    ok('range: ' + p.id + ' fits one load', bars > 20 && bars <= 500, Math.round(bars))
  })
  eq('range: 1D is a day', sn.rangeStartMs('1D', now), now - 86400000)
  eq('range: All has no start', sn.rangeStartMs('All', now), null)
  const ytd = new Date(sn.rangeStartMs('YTD', now))
  ok('range: YTD starts on 1 January', ytd.getMonth() === 0 && ytd.getDate() === 1 && ytd.getFullYear() === 2026)
  const m1 = (now - sn.rangeStartMs('1M', now)) / 86400000
  ok('range: 1M is a calendar month', m1 >= 28 && m1 <= 31.1, m1)
  eq('clock: UTC', sn.utcOffsetLabel(0), 'UTC')
  eq('clock: east', sn.utcOffsetLabel(120), 'UTC+2')
  eq('clock: west', sn.utcOffsetLabel(-180), 'UTC-3')
  eq('clock: half hours', sn.utcOffsetLabel(330), 'UTC+5:30')
  eq('zoom: in keeps the right edge', sn.zoomLogicalRange({ from: 0, to: 100 }, 2, true), { from: 50, to: 100 })
  eq('zoom: out about the centre', sn.zoomLogicalRange({ from: 40, to: 60 }, 0.5, false), { from: 30, to: 70 })
  eq('zoom: never below the minimum', sn.zoomLogicalRange({ from: 0, to: 6 }, 4, true), { from: 1, to: 6 })
}

// ---- Crosshair sync across layout cells (features/charts/crosshairSyncMath) ----
{
  const { barAtOrBefore } = await import(src('features/charts/crosshairSyncMath.ts'))
  // 1h bars from 10:00 UTC; times handed over by the charts are in seconds.
  const H = 3600
  const t0 = Date.UTC(2026, 9, 14, 10) / 1000
  const hourly = [0, 1, 2, 3].map((i) => ({ t: (t0 + i * H) * 1000, c: 100 + i }))
  eq('xsync: exact bar time', barAtOrBefore(hourly, t0 + 2 * H), 2)
  eq('xsync: inside a bar maps to the bar that opened before', barAtOrBefore(hourly, t0 + 2 * H + 59 * 60), 2)
  eq('xsync: after the last bar holds the last bar', barAtOrBefore(hourly, t0 + 10 * H), 3)
  eq('xsync: before the first bar has no bar', barAtOrBefore(hourly, t0 - 1), -1)
  eq('xsync: first bar', barAtOrBefore(hourly, t0), 0)
  eq('xsync: no bars', barAtOrBefore([], t0), -1)
  eq('xsync: junk time', barAtOrBefore(hourly, NaN), -1)
  // A 15m cell hovered at 11:45 lands on the 1h cell's 11:00 bar; a 1h cell
  // hovered at 11:00 lands on the 15m cell's 11:00 bar.
  const q = Array.from({ length: 16 }, (_, i) => ({ t: (t0 + i * 900) * 1000, c: 1 }))
  eq('xsync: lower timeframe to higher', barAtOrBefore(hourly, q[7].t / 1000), 1)
  eq('xsync: higher timeframe to lower', barAtOrBefore(q, hourly[1].t / 1000), 4)
  // Millisecond remainders (range bars spaced by the second) still match.
  eq('xsync: sub-second bar times', barAtOrBefore([{ t: t0 * 1000 + 500, c: 1 }], t0), 0)
}

// ---- Chart time zone: formatter-only (features/charts/timezone) ----
{
  const tz = await import(src('features/charts/timezone.ts'))
  const { TICK } = tz
  // 2026-10-23 09:30:05 UTC, a Friday.
  const t = Date.UTC(2026, 9, 23, 9, 30, 5)
  eq('tz: UTC time tick', tz.formatTick(t, TICK.Time, 'UTC'), '09:30')
  eq('tz: UTC time-with-seconds tick', tz.formatTick(t, TICK.TimeWithSeconds, 'UTC'), '09:30:05')
  eq('tz: UTC day tick', tz.formatTick(t, TICK.DayOfMonth, 'UTC'), '23')
  eq('tz: UTC month tick', tz.formatTick(t, TICK.Month, 'UTC'), 'Oct')
  eq('tz: UTC year tick', tz.formatTick(t, TICK.Year, 'UTC'), '2026')
  eq('tz: Karachi is UTC+5', tz.formatTick(t, TICK.Time, 'Asia/Karachi'), '14:30')
  eq('tz: Karachi offset', tz.tzOffsetLabel('Asia/Karachi', t), 'UTC+5')
  eq('tz: Kolkata half hour', tz.tzOffsetLabel('Asia/Kolkata', t), 'UTC+5:30')
  // Late UTC evening is already tomorrow in Karachi: day/month/year roll over.
  const nye = Date.UTC(2026, 11, 31, 20, 0)
  eq('tz: Karachi crosses midnight', tz.formatTick(nye, TICK.DayOfMonth, 'Asia/Karachi'), '1')
  eq('tz: Karachi crosses the month', tz.formatTick(nye, TICK.Month, 'Asia/Karachi'), 'Jan')
  eq('tz: Karachi crosses the year', tz.formatTick(nye, TICK.Year, 'Asia/Karachi'), '2027')
  eq('tz: New York on summer time (EDT)', tz.formatTick(t, TICK.Time, 'America/New_York'), '05:30')
  eq('tz: New York EDT offset', tz.tzOffsetLabel('America/New_York', t), 'UTC-4')
  // US DST ended 2026-11-01 at 02:00 EDT (06:00 UTC): one hour later is EST.
  const before = Date.UTC(2026, 10, 1, 5, 59)
  const after = Date.UTC(2026, 10, 1, 6, 0)
  eq('tz: NY just before the DST change', tz.formatTick(before, TICK.Time, 'America/New_York'), '01:59')
  eq('tz: NY just after the DST change', tz.formatTick(after, TICK.Time, 'America/New_York'), '01:00')
  eq('tz: NY offset before', tz.tzOffsetMinutes('America/New_York', before), -240)
  eq('tz: NY offset after', tz.tzOffsetMinutes('America/New_York', after), -300)
  // Spring forward: 2026-03-08 02:00 EST (07:00 UTC) jumps to 03:00 EDT.
  eq('tz: NY spring forward skips 02:00', tz.formatTick(Date.UTC(2026, 2, 8, 7, 0), TICK.Time, 'America/New_York'), '03:00')
  eq('tz: UTC never shifts', tz.formatTick(after, TICK.Time, 'UTC'), '06:00')
  // The cached-offset fast path agrees with Intl across a year, DST included.
  {
    const bad = []
    for (const z of ['America/New_York', 'Australia/Sydney', 'Asia/Kolkata', 'Europe/London']) {
      const ref = new Intl.DateTimeFormat('en-GB', { timeZone: z, hourCycle: 'h23', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      for (let i = 0; i < 400; i++) {
        const ms = Date.UTC(2026, 0, 1) + i * 79_013_000 // ~22h steps, odd seconds
        const got = tz.formatTick(ms, TICK.DayOfMonth, z) + ' ' + tz.formatTick(ms, TICK.TimeWithSeconds, z)
        const want = ref.format(ms).replace(',', '')
        if (got !== want) bad.push(z + ' ' + ms + ' ' + got + ' vs ' + want)
      }
    }
    eq('tz: fast path matches Intl', bad.slice(0, 3), [])
  }

  eq('tz: crosshair, UTC', tz.formatCrosshair(Date.UTC(2026, 9, 23, 9, 30), 'UTC'), "Fri 23 Oct '26  09:30")
  eq('tz: crosshair shows seconds when present', tz.formatCrosshair(t, 'UTC'), "Fri 23 Oct '26  09:30:05")
  eq('tz: crosshair, Karachi', tz.formatCrosshair(nye, 'Asia/Karachi'), "Fri 1 Jan '27  01:00")
  eq('tz: crosshair, date only', tz.formatCrosshair(Date.UTC(2026, 9, 23), 'America/New_York', true), "Fri 23 Oct '26")

  // The lightweight-charts formatters: UTC seconds in, zone text out.
  const ny = tz.chartTzOptions(() => false, 'America/New_York')
  const sec = Math.floor(t / 1000)
  eq('tz: timeFormatter takes UTC seconds', ny.localization.timeFormatter(sec), "Fri 23 Oct '26  05:30:05")
  eq('tz: tickMarkFormatter takes UTC seconds', ny.timeScale.tickMarkFormatter(sec, TICK.Time), '05:30')
  // Daily bars keep their UTC session date in any zone (no "22 Oct 20:00").
  const nyDaily = tz.chartTzOptions(() => true, 'America/New_York')
  const day = Date.UTC(2026, 9, 23) / 1000
  eq('tz: daily bar crosshair is the UTC date', nyDaily.localization.timeFormatter(day), "Fri 23 Oct '26")
  eq('tz: daily day tick is the UTC date', nyDaily.timeScale.tickMarkFormatter(day, TICK.DayOfMonth), '23')
  eq('tz: intraday day tick is the zone date', ny.timeScale.tickMarkFormatter(day, TICK.DayOfMonth), '22')
  eq('tz: business-day times are dates', ny.localization.timeFormatter({ year: 2026, month: 10, day: 23 }), "Fri 23 Oct '26")
  eq('tz: string times are dates', ny.timeScale.tickMarkFormatter('2026-10-23', TICK.DayOfMonth), '23')

  eq('tz: daily timeframes', ['1m', '4h', '1d', '1w', '1M'].map((x) => tz.isDailyTf(x)), [false, false, true, true, true])
  eq('tz: junk setting falls back to the browser zone', tz.cleanTzSetting('Mars/Olympus'), 'local')
  eq('tz: a valid zone is kept', tz.cleanTzSetting('Asia/Dubai'), 'Asia/Dubai')
  eq('tz: local resolves to the browser zone', tz.resolveZone('local'), Intl.DateTimeFormat().resolvedOptions().timeZone)
  ok('tz: every menu zone is valid', tz.TZ_OPTIONS.every((o) => o.id === 'local' || tz.isValidZone(o.id)))
  for (const z of ['America/New_York', 'Europe/London', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'])
    ok('tz: menu offers ' + z, tz.TZ_OPTIONS.some((o) => o.id === z))
  // The change is announced; without localStorage it still holds in memory.
  let heard = 0
  const off = tz.subscribeChartTz(() => heard++)
  tz.setChartTz('Asia/Tokyo')
  eq('tz: set + notify', [tz.getChartTzSetting(), tz.chartZone(), heard], ['Asia/Tokyo', 'Asia/Tokyo', 1])
  tz.setChartTz('Asia/Tokyo')
  eq('tz: same zone does not notify', heard, 1)
  off()
  tz.setChartTz('local')
  eq('tz: unsubscribed', heard, 1)
}

// ---- Saved chart layouts + workspace panels (features/charts/savedLayoutsMath) ----
{
  const L = await import(src('features/charts/savedLayoutsMath.ts'))
  const NS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16]
  const snap4 = {
    n: 4,
    active: 1,
    cells: [
      { sym: 'BTCUSDT', tf: '15m', style: 'candle' },
      { sym: 'ETHUSDT', tf: '1h', style: 'line' },
      { sym: 'SOLUSDT', tf: '4h', style: 'bar' },
      { sym: 'XAUUSD', tf: '1d', style: 'candle' },
    ],
    mainIndicators: [{ uid: 'iabc', type: 'ema', params: { length: 21 }, source: 'close', visible: true }],
    panelIndicators: { c2: [{ uid: 'pabc', type: 'rsi', params: {}, source: 'close', visible: true }] },
    scale: { mode: 'log', invert: true, lock: false },
  }
  // names
  eq('saved: name trimmed and folded', L.cleanLayoutName('  My   setup \n'), 'My setup')
  eq('saved: name capped at 32', L.cleanLayoutName('x'.repeat(50)).length, 32)
  eq('saved: control chars dropped', L.cleanLayoutName('a\u0000b\u0007c'), 'abc')
  eq('saved: junk name is empty', L.cleanLayoutName(null), '')
  // validation
  ok('saved: USDT pair valid', L.validSymbol('BTCUSDT'))
  ok('saved: instrument valid', L.validSymbol('XAUUSD'))
  ok('saved: junk symbol invalid', !L.validSymbol('btc<script>') && !L.validSymbol('') && !L.validSymbol(42))
  ok('saved: catalogue tf valid', L.validTimeframe('4h') && L.validTimeframe('1M'))
  ok('saved: junk tf invalid', !L.validTimeframe('7x') && !L.validTimeframe(null))
  eq('saved: bad symbol drops the cell', L.cleanSnapCell({ sym: 'nope', tf: '1h' }), null)
  eq('saved: bad tf drops only the tf', L.cleanSnapCell({ sym: 'ETHUSDT', tf: 'bogus', style: 'line' }), { sym: 'ETHUSDT', style: 'line' })
  eq('saved: unknown cell fields ignored', L.cleanSnapCell({ sym: 'ETHUSDT', tf: '1h', extra: 1 }), { sym: 'ETHUSDT', tf: '1h' })
  // snapshot
  const cs = L.cleanSnapshot(snap4, NS)
  eq('saved: snapshot round-trips', cs, snap4)
  eq('saved: unknown layout count rejected', L.cleanSnapshot({ ...snap4, n: 11 }, NS), null)
  eq('saved: active outside the layout resets to 0', L.cleanSnapshot({ ...snap4, active: 9 }, NS).active, 0)
  eq('saved: bad scale mode falls back', L.cleanSnapshot({ ...snap4, scale: { mode: 'cubic' } }, NS).scale, { mode: 'normal', invert: false, lock: false })
  eq(
    'saved: panel slots only c0..c15',
    Object.keys(L.cleanSnapshot({ ...snap4, panelIndicators: { c2: [{}], mc1: [{}], c99: [{}], c3: 'x' } }, NS).panelIndicators),
    ['c2'],
  )
  eq('saved: missing indicators are empty', L.cleanSnapshot({ n: 2, active: 0, cells: [] }, NS).mainIndicators, [])
  // list: parse / migrate / serialize
  const entry = { id: 'a1', name: 'Test', savedAt: 5, snapshot: snap4 }
  eq('saved: corrupt storage is an empty list', L.parseSavedLayouts('{oops', NS), [])
  eq('saved: null storage is an empty list', L.parseSavedLayouts(null, NS), [])
  eq('saved: v1 shape parses', L.parseSavedLayouts({ v: 1, items: [entry] }, NS).map((e) => e.name), ['Test'])
  eq('saved: bare array (unversioned) migrates', L.parseSavedLayouts([entry], NS).map((e) => e.id), ['a1'])
  eq('saved: newer version keeps parseable items', L.parseSavedLayouts({ v: 9, items: [entry], future: true }, NS).length, 1)
  const mixed = L.parseSavedLayouts(
    [entry, { ...entry, id: 'a2', name: 'test' }, { id: 'a3', name: '', snapshot: snap4 }, { id: 'a4', name: 'X', snapshot: { n: 99 } }, 7, { ...entry, id: 'a1', name: 'Other' }],
    NS,
  )
  eq('saved: duplicate names, empty names, bad snapshots dropped', mixed.map((e) => e.name), ['Test', 'Other'])
  ok('saved: duplicate id replaced', mixed[1].id !== 'a1', mixed[1].id)
  eq('saved: at most 20 kept', L.parseSavedLayouts(Array.from({ length: 30 }, (_, i) => ({ ...entry, id: 'x' + i, name: 'n' + i })), NS).length, 20)
  const ser = L.serializeSavedLayouts([entry])
  eq('saved: serialized with version', ser.v, 1)
  eq('saved: serialize/parse round-trip', L.parseSavedLayouts(JSON.parse(JSON.stringify(ser)), NS), [entry])
  // list edits
  let r = L.addSavedLayout([], '  Test ', snap4, 10, 'id1')
  eq('saved: add', [r.error, r.list.map((e) => [e.id, e.name, e.savedAt])], [null, [['id1', 'Test', 10]]])
  r = L.addSavedLayout(r.list, 'Second', snap4, 11, 'id2')
  eq('saved: newest first', r.list.map((e) => e.name), ['Second', 'Test'])
  r = L.addSavedLayout(r.list, 'TEST', { ...snap4, n: 2 }, 12, 'id3')
  eq('saved: same name overwrites in place', r.list.map((e) => [e.id, e.name, e.snapshot.n]), [['id2', 'Second', 4], ['id1', 'TEST', 2]])
  eq('saved: add refuses an empty name', L.addSavedLayout(r.list, '   ', snap4, 1, 'z').error !== null, true)
  const full = Array.from({ length: 20 }, (_, i) => ({ ...entry, id: 'f' + i, name: 'n' + i }))
  const rf = L.addSavedLayout(full, 'one more', snap4, 1, 'z')
  ok('saved: full list refuses a new name', rf.error && rf.list === full, rf.error)
  ok('saved: full list still overwrites', !L.addSavedLayout(full, 'n3', snap4, 1, 'z').error)
  let rn = L.renameSavedLayout(r.list, 'id1', ' Renamed ')
  eq('saved: rename', rn.list.map((e) => e.name), ['Second', 'Renamed'])
  rn = L.renameSavedLayout(r.list, 'id1', 'second')
  ok('saved: rename refuses a taken name', rn.error && rn.list === r.list, rn.error)
  ok('saved: rename refuses empty', L.renameSavedLayout(r.list, 'id1', '').error)
  ok('saved: rename of a missing id refused', L.renameSavedLayout(r.list, 'nope', 'x').error)
  ok('saved: rename to own name in another case', !L.renameSavedLayout(r.list, 'id1', 'test').error)
  eq('saved: delete', L.deleteSavedLayout(r.list, 'id2').map((e) => e.id), ['id1'])
  eq('saved: delete of a missing id is a no-op', L.deleteSavedLayout(r.list, 'nope').length, 2)

  // Charts-tab workspace panels
  const DEF = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT'].map((sym) => ({ sym, interval: '1h' }))
  const IVS = ['1m', '5m', '15m', '1h', '4h', '1d']
  eq('mc panels: nothing stored gives the defaults', L.parseMcPanels(null, DEF, IVS, 8), DEF)
  eq('mc panels: empty list gives the defaults', L.parseMcPanels([], DEF, IVS, 8), DEF)
  eq('mc panels: junk gives the defaults', L.parseMcPanels('x', DEF, IVS, 8), DEF)
  eq(
    'mc panels: stored panels restored in order',
    L.parseMcPanels([{ sym: 'XRPUSDT', interval: '5m' }, { sym: 'ADAUSDT', interval: '1d' }], DEF, IVS, 8),
    [{ sym: 'XRPUSDT', interval: '5m' }, { sym: 'ADAUSDT', interval: '1d' }],
  )
  eq(
    'mc panels: bad parts fall back per position',
    L.parseMcPanels([{ sym: '???', interval: '5m' }, { sym: 'ADAUSDT', interval: '7h' }, null], DEF, IVS, 8),
    [{ sym: 'BTCUSDT', interval: '5m' }, { sym: 'ADAUSDT', interval: '1h' }, { sym: 'SOLUSDT', interval: '1h' }],
  )
  eq('mc panels: beyond the defaults falls back to the first', L.parseMcPanels(Array(6).fill({ sym: 1 }), DEF, IVS, 8)[5], DEF[0])
  eq('mc panels: capped', L.parseMcPanels(Array(12).fill({ sym: 'BTCUSDT', interval: '1h' }), DEF, IVS, 8).length, 8)
  ok('mc panels: defaults are copies', L.parseMcPanels(null, DEF, IVS, 8)[0] !== DEF[0])
}

// ---------------------------------------------------------------- chart style data
{
  const { sessionKey, toCandleData, hollowCandleData, compactVol } = await import(
    src('features/charts/series/customSeries.ts')
  )
  const H = 3_600_000
  const D = 24 * H
  const mon = Date.UTC(2024, 0, 1) // a Monday
  eq('session: intraday bars group by UTC day', sessionKey(mon + 5 * H, H), '2024-01-01')
  eq('session: 4h bars group by week', sessionKey(mon + 6 * D, 4 * H), sessionKey(mon, 4 * H))
  ok('session: a new week starts on Monday', sessionKey(mon - 1, 4 * H) !== sessionKey(mon, 4 * H))
  eq('session: daily bars group by month', sessionKey(mon + 20 * D, D), '2024-01')
  eq('session: weekly bars group by year', sessionKey(mon + 60 * D, 7 * D), '2024')

  const k = (t, o, c, v = 1) => ({ t, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v })
  const days = [0, 1, 2].map((i) => k(mon + i * D, 10, 11))
  eq('toCandleData: daily bars share a month session', toCandleData(days).map((d) => d.session), [
    '2024-01',
    '2024-01',
    '2024-01',
  ])
  eq('toCandleData: keeps the bar ms', toCandleData(days)[1].ms, mon + D)
  // A live update is one bar: without the bar before it, it cannot know its interval.
  eq('toCandleData: a lone live bar takes its session from prev', toCandleData([days[2]], days[1])[0].session, '2024-01')

  const up = '#0f0'
  const dn = '#f00'
  const hc = hollowCandleData(
    [k(0, 10, 12), k(60e3, 12, 11), k(120e3, 9, 10.5), k(180e3, 12, 11)],
    up,
    dn,
  )
  eq('hollow: up bar is hollow', hc[0].color, 'rgba(0,0,0,0)')
  eq('hollow: first bar coloured against its open', hc[0].borderColor, up)
  eq('hollow: down bar (close<open) is filled', hc[1].color, hc[1].borderColor)
  eq('hollow: close below previous close is down-coloured', hc[1].borderColor, dn)
  eq('hollow: rising bar under prev close is hollow but down-coloured', [hc[2].color, hc[2].borderColor], ['rgba(0,0,0,0)', dn])
  eq('hollow: falling bar above prev close is filled and up-coloured', [hc[3].color, hc[3].borderColor], [up, up])
  eq('hollow: wick follows the colour', hc[3].wickColor, up)
  eq('hollow: live bar uses prev close', hollowCandleData([k(0, 12, 11)], up, dn, k(-60e3, 9, 10))[0].borderColor, up)

  eq('compactVol: small', compactVol(0.42), '0.4')
  eq('compactVol: thousands', compactVol(3400), '3.4K')
  eq('compactVol: millions', compactVol(1_234_567), '1.2M')
}

// ---------------------------------------------------------------- forex factory day grouping
{
  const { parseFF, groupByDay } = await import(src('features/news/pro/forexFactory.ts'))
  const ev = parseFF(
    JSON.stringify([
      { title: 'CPI', country: 'USD', date: '2026-09-15T08:30:00-04:00', impact: 'High' },
      { title: 'Bank Holiday', country: 'JPY', date: '2026-09-15T00:00:00-04:00', impact: 'Holiday' },
      { title: 'Trade Balance', country: 'AUD', date: '2026-09-15T01:00:00-04:00', impact: 'Low' },
    ]),
  )
  // Expectations follow the process zone, so this holds under any TZ.
  const ymd = (d) =>
    d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const groups = groupByDay(ev)
  const where = (t) => groups.find((g) => g.events.some((e) => e.title === t))
  eq('ff: all-day holiday keeps its FF date in any zone', ymd(where('Bank Holiday').date), '2026-09-15')
  eq('ff: all-day row leads its day', where('Bank Holiday').events[0].title, 'Bank Holiday')
  for (const e of ev.filter((x) => !x.allDay))
    eq('ff: timed row under its local day (' + e.title + ')', ymd(where(e.title).date), ymd(new Date(e.ts)))
  const starts = groups.map((g) => g.date.getTime())
  eq('ff: day groups ascend', starts, [...starts].sort((a, b) => a - b))
  eq('ff: group key matches its date', groups.every((g) => g.day === g.date.toDateString()), true)
}

// ---- auth: the once-per-session sign-in invite flag --------------------------------
{
  const { INVITED, wasInvited, markInvited } = await import(src('features/auth/invite.ts'))
  const m = new Map()
  const s = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) }
  eq('invite: a fresh session has not been invited', wasInvited(s), false)
  // A manual open of the dialog marks the same flag the auto popup checks.
  markInvited(s)
  eq('invite: marking sets the session flag', s.getItem(INVITED), '1')
  eq('invite: after a manual open the auto popup is suppressed', wasInvited(s), true)
  const blocked = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
  eq('invite: blocked storage never nags', wasInvited(blocked), true)
  markInvited(blocked)
  eq('invite: no storage at all never nags', wasInvited(null), true)
}

// ---- drawings: select / move / handle maths ----------------------------------------
{
  const E = await import(src('features/charts/drawings/edit.ts'))
  const sh = {
    segs: [{ x1: 0, y1: 0, x2: 100, y2: 0 }],
    fills: [],
    arcs: [],
    labels: [{ x: 200, y: 50, text: 'Note', box: true }],
    handles: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  }
  eq('edit: a click on the line hits', E.hitShape(sh, 50, 5), true)
  eq('edit: a click well off the line misses', E.hitShape(sh, 50, 20), false)
  eq('edit: a click on a boxed label hits', E.hitShape(sh, 210, 48), true)
  eq('edit: handle under the cursor', E.handleAt(sh, 97, 3), 1)
  eq('edit: no handle away from the anchors', E.handleAt(sh, 50, 0), -1)
  eq('edit: segment distance past the end', E.pointToSegment(110, 0, 0, 0, 100, 0), 10)
  const times = [100, 200, 300, 400, 500]
  eq('edit: nearest bar exact', E.nearestBar(times, 300), 2)
  eq('edit: nearest bar between', E.nearestBar(times, 340), 2)
  eq('edit: nearest bar before data', E.nearestBar(times, 0), 0)
  eq('edit: nearest bar after data', E.nearestBar(times, 999), 4)
  const pts = [
    { time: 200, price: 10 },
    { time: 300, price: 20 },
  ]
  const up = (p) => p + 5
  eq('edit: move by bars and price', E.shiftPoints(pts, 1, times, up), [
    { time: 300, price: 15 },
    { time: 400, price: 25 },
  ])
  eq('edit: fractional bar shift rounds', E.shiftPoints(pts, 1.4, times, up)[0].time, 300)
  // Past the loaded bars the shift carries on in whole bars (a target in the
  // future, history not loaded yet), keeping the shape.
  eq('edit: past the right end, in whole bars', E.shiftPoints(pts, 9, times, up), [
    { time: 1100, price: 15 },
    { time: 1200, price: 25 },
  ])
  eq('edit: past the left end too', E.shiftPoints(pts, -9, times, up)[0].time, -700)
  eq('edit: an anchor already in the future can move right', E.shiftPoints([{ time: 700, price: 1 }], 1, times, up)[0].time, 800)
  eq('edit: vertical-only drag keeps off-bar times', E.shiftPoints([{ time: 250, price: 1 }], 0, times, up), [
    { time: 250, price: 6 },
  ])
  eq('edit: unmappable price stays put', E.shiftPoints(pts, 0, times, () => null)[1].price, 20)
  eq('edit: start points are not mutated', pts[0], { time: 200, price: 10 })
}

// ---- drawings: anchors that fall between, before or after the loaded bars ----------
{
  const M = await import(src('features/charts/drawings/timeMap.ts'))
  // 4h bars (14400s apart); anchors placed on 15m land between them.
  const times = [0, 14400, 28800, 43200]
  eq('timeMap: exact bar', M.timeToLogical(times, 28800), 2)
  eq('timeMap: 15m anchor between 4h bars', M.timeToLogical(times, 14400 + 3600), 1.25)
  eq('timeMap: older than the loaded history', M.timeToLogical(times, -28800), -2)
  eq('timeMap: right of the last bar', M.timeToLogical(times, 43200 + 14400 * 3), 6)
  eq('timeMap: nothing loaded', M.timeToLogical([], 5), null)
  eq('timeMap: one bar, other time', M.timeToLogical([100], 5), null)
  eq('timeMap: logical → bar time', M.logicalToTime(times, 1.4), 14400)
  eq('timeMap: future bar time', M.logicalToTime(times, 5), 43200 + 14400 * 2)
  eq('timeMap: past bar time', M.logicalToTime(times, -1), -14400)
  eq('timeMap: round trip off-bar', M.logicalToTime(times, M.timeToLogical(times, 57600)), 57600)
}

// ---- price axis precision: minMove follows the instrument's size ------------------
{
  eq('priceFormat: BTC', priceFormatFor(77000), { type: 'price', precision: 2, minMove: 0.01 })
  eq('priceFormat: PEPE', priceFormatFor(0.00001234), { type: 'price', precision: 8, minMove: 1e-8 })
  eq('priceFormat: capped at 12', priceFormatFor(1e-15).precision, 12)
}

// ---- drawings: undo / redo history ------------------------------------------------
{
  const { createDrawingHistory } = await import(src('features/charts/drawings/history.ts'))
  const h = createDrawingHistory(3)
  h.reset('[]')
  eq('history: nothing to undo at first', h.undo(), null)
  eq('history: unchanged save is no step', h.commit('[]'), false)
  h.commit('[a]')
  h.commit('[a,b]')
  eq('history: undo returns the previous state', h.undo(), '[a]')
  eq('history: redo returns the undone state', h.redo(), '[a,b]')
  h.undo()
  h.commit('[a,c]')
  eq('history: a new change drops the redo branch', h.canRedo(), false)
  h.commit('[1]')
  h.commit('[2]')
  h.commit('[3]')
  h.undo()
  h.undo()
  h.undo()
  eq('history: capped at the limit', h.undo(), null)
  h.reset('[x]')
  eq('history: a coin switch forgets the steps', [h.canUndo(), h.canRedo()], [false, false])
}

// ---- drawings: what a click hits --------------------------------------------------
{
  const E = await import(src('features/charts/drawings/edit.ts'))
  const base = { segs: [], fills: [], arcs: [], labels: [], handles: [] }
  eq('hit: soft decoration is not grabbed', E.hitShape({ ...base, segs: [{ x1: 0, y1: 0, x2: 100, y2: 0, soft: true }] }, 50, 0), false)
  eq('hit: a main line is', E.hitShape({ ...base, segs: [{ x1: 0, y1: 0, x2: 100, y2: 0 }] }, 50, 3), true)
  const box = { ...base, fills: [{ pts: [10, 10, 90, 10, 90, 60, 10, 60], color: '' }] }
  eq('hit: inside a filled rectangle', E.hitShape(box, 50, 30), true)
  eq('hit: outside it', E.hitShape(box, 95, 30), false)
  const ring = { ...base, arcs: [{ cx: 50, cy: 50, rx: 30, ry: 20 }] }
  eq('hit: on an ellipse outline', E.hitShape(ring, 80, 50), true)
  eq('hit: far from it', E.hitShape(ring, 50, 50), false)
  eq('label: left-aligned spans to the right', E.labelSpan({ x: 100, text: 'abcd', align: 'left' }), [100, 138])
  eq('label: right-aligned spans to the left', E.labelSpan({ x: 100, text: 'abcd', align: 'right' }), [62, 100])
  const lbl = { ...base, labels: [{ x: 100, y: 20, text: 'a long caption here', box: true, align: 'left' }] }
  eq('hit: right end of a long left-aligned label', E.hitShape(lbl, 200, 20), true)
  eq('hit: empty space left of it', E.hitShape(lbl, 60, 20), false)
}

// ---- indicator maths: supertrend flip, keltner ATR, gaps, anchored VWAP -----------
{
  const M = await import(src('features/charts/indicators/math.ts'))
  const bar = (t, o, h, l, c, v = 1) => ({ t, o, h, l, c, v })
  // Flat at 100, then a bar that closes far below the lower band.
  const flat = Array.from({ length: 15 }, (_, i) => bar(i * 60000, 100, 101, 99, 100))
  const drop = flat.concat([bar(15 * 60000, 100, 100, 80, 80)])
  const st = M.supertrend(drop, 3, 1)
  eq('supertrend: flips on the bar that breaks the band', st.dir[15], -1)
  // ATR length is its own input: a different ATR length changes the bands.
  const kA = M.keltner(drop, 5, 2, 3)
  const kB = M.keltner(drop, 5, 2, 10)
  ok('keltner: ATR length is separate from the EMA length', kA.upper[15] !== kB.upper[15])
  // An interior gap carries the last value forward instead of blanking the rest.
  const gapped = M.onDefined([null, 1, 2, null, 4, 5], (v) => v.map((x) => x * 2))
  eq('onDefined: a gap does not poison later values', gapped.slice(3), [4, 8, 10])
  // Weekly anchor: Monday 2026-10-26 restarts; within the week it accumulates.
  const mon = Date.UTC(2026, 9, 26)
  const wk = [bar(mon - 86400000, 0, 10, 10, 10), bar(mon, 0, 20, 20, 20), bar(mon + 86400000, 0, 40, 40, 40)]
  eq('vwap: weekly anchor restarts on Monday', M.vwapBands(wk, 2).v, [10, 20, 30])
  eq('vwap: daily anchor restarts each day', M.vwapBands(wk, 1).v, [10, 20, 40])
  const vb = M.vwapBands(wk, 2, 1)
  eq('vwap: 1σ bands around the weekly VWAP', [vb.u[2], vb.l[2]], [40, 20])
  eq('vwap: no bands at 0σ', M.vwapBands(wk, 2, 0).u[2], null)
}

// ---- time axis: day boundaries in the chart zone ---------------------------------
{
  const Z = await import(src('features/charts/zonedTimeScale.ts'))
  const H = 3600
  // Hourly bars across 2026-10-30 → 31 UTC.
  const base = Date.UTC(2026, 9, 30, 0) / 1000
  const pts = () => Array.from({ length: 30 }, (_, i) => ({ time: { t: base + i * H }, timeWeight: 0 }))
  const dayAt = (p) => p.filter((x) => x.timeWeight === Z.WEIGHT.Day).map((x) => new Date(x.time.t * 1000).toISOString().slice(11, 16))
  const utc = pts()
  Z.fillZonedWeights(utc, 0, 'UTC', false)
  // The first bar sits on midnight too, so the library's first-point guess marks it.
  eq('zoned ticks: UTC day boundaries at 00:00 UTC', dayAt(utc), ['00:00', '00:00'])
  // Los Angeles is UTC-7 on 30 Oct 2026: local midnight is 07:00 UTC.
  const la = pts()
  Z.fillZonedWeights(la, 0, 'America/Los_Angeles', false)
  eq('zoned ticks: LA day boundary at local midnight (07:00 UTC)', dayAt(la), ['07:00'])
  // Daily-and-longer bars keep UTC sessions whatever the zone.
  const d = pts()
  Z.fillZonedWeights(d, 0, 'America/Los_Angeles', true)
  eq('zoned ticks: daily bars keep the UTC day', dayAt(d), ['00:00', '00:00'])
  // Incremental fill from an index matches a full fill.
  const part = pts()
  Z.fillZonedWeights(part, 0, 'Asia/Karachi', false)
  const inc = pts()
  Z.fillZonedWeights(inc.slice(0, 10), 0, 'Asia/Karachi', false)
  Z.fillZonedWeights(inc, 10, 'Asia/Karachi', false)
  eq('zoned ticks: incremental fill equals a full fill', inc.slice(10).map((x) => x.timeWeight), part.slice(10).map((x) => x.timeWeight))
  eq('zoned ticks: year beats month beats day', [Z.weightBetween(Date.UTC(2027, 0, 1), Date.UTC(2026, 11, 31)), Z.weightBetween(Date.UTC(2026, 10, 1), Date.UTC(2026, 9, 31))], [70, 60])
}

// ---- round 2: reloads keep paged history; Pine results line up by time -----------
{
  const T = await import(src('services/timeframe.ts'))
  const k = (t, c = t) => ({ t, o: c, h: c, l: c, c, v: 1 })
  const current = [k(1), k(2), k(3), k(4), k(5)]
  const fresh = [k(4, 40), k(5, 50), k(6, 60)]
  eq('reload: older history kept, overlap replaced', T.mergeReload(current, fresh).map((c) => c.c), [1, 2, 3, 40, 50, 60])
  eq('reload: capped at max, oldest dropped', T.mergeReload(current, fresh, 4).map((c) => c.t), [3, 4, 5, 6])
  eq('reload: nothing on screen yet', T.mergeReload([], fresh).length, 3)
  const P = await import(src('features/charts/pine/indicator.ts'))
  const run = [k(10, 1), k(20, 2), k(30, 3)]
  const series = { a: [100, 200, 300] }
  eq('pine align: same candles as is', P.alignByTime(series, run, run).a, [100, 200, 300])
  const paged = [k(0, 9), k(10, 1), k(20, 2), k(30, 3)]
  eq('pine align: history paged in front', P.alignByTime(series, run, paged).a, [null, 100, 200, 300])
  const other = [k(10, 7), k(20, 8), k(30, 9)]
  eq('pine align: another coin draws nothing', P.alignByTime(series, run, other).a, [null, null, null])
}

// ---- round 2: intrabar alert crosses, on-close technicals, Pine context ----------
{
  const R = await import(src('features/alerts/rules.ts'))
  const up = { condition: 'crosses_above', value: 100 }
  eq('alert: a wick through the level between samples crosses', R.evalPrice(up, 99, 98, 0, { hi: 101, lo: 97 }), true)
  eq('alert: no wick, no cross', R.evalPrice(up, 99, 98, 0, { hi: 99.5, lo: 97 }), false)
  eq('alert: a plain cross still fires', R.evalPrice(up, 101, 99, 0), true)
  const flat = Array.from({ length: 70 }, () => ({ c: 100 }))
  const spike = flat.concat([{ c: 200 }])
  const sma = { condition: 'close_above_sma', value: 50 }
  eq('alert: forming bar judged by default', R.evalTechnical(sma, spike), true)
  eq('alert: on bar close ignores the forming bar', R.evalTechnical({ ...sma, onClose: true }, spike), false)
  const P = await import(src('features/charts/pine/indicator.ts'))
  eq('pine period: minutes, hours, day, week, month, seconds', ['15m', '4h', '1d', '1w', '1M', '30s'].map(P.pinePeriod), ['15', '240', 'D', 'W', 'M', '30S'])
  const RT = await import(src('features/charts/pine/runtime.ts'))
  eq('pine gradient: midpoint blends', RT.gradientColor(50, 0, 100, '#000000', '#ffffff'), 'rgba(128,128,128,1.00)')
  eq('pine gradient: clamped at the ends', RT.gradientColor(150, 0, 100, '#000000', '#ffffff'), 'rgba(255,255,255,1.00)')
}

// ---- r3-sync: link groups (features/charts/linkGroupsMath) ----
{
  const L = await import(src('features/charts/linkGroupsMath.ts'))
  // Stored state: junk falls back to defaults; bad keys and groups are dropped.
  const d = L.parseLinkState(null)
  eq('link: default opts', d.opts.layout, { symbol: false, interval: false, time: true })
  eq('link: default groups empty', d.groups, {})
  const p = L.parseLinkState({
    groups: { c1: 'B', mc0: null, mc2: 'Z', foo: 'A', c99x: 'A' },
    opts: { layout: { symbol: true, time: 'yes' }, mc: 7 },
  })
  eq('link: parsed groups', p.groups, { c1: 'B', mc0: null })
  eq('link: parsed opts keep good bools', p.opts.layout, { symbol: true, interval: false, time: true })
  eq('link: junk scope opts default', p.opts.mc, { symbol: false, interval: false, time: true })
  eq('link: unset key is in the default group', L.groupOf(p.groups, 'c3'), 'A')
  eq('link: explicit none stays none', L.groupOf(p.groups, 'mc0'), null)
  // Removing grid panel 1 of 4: panels 2 and 3 move up with their groups.
  eq(
    'link: shift after removal',
    L.shiftGroups({ mc0: 'A', mc1: 'B', mc2: null, mc3: 'C' }, 'mc', 1, 4),
    { mc0: 'A', mc1: null, mc2: 'C' },
  )
  eq('link: shift keeps other prefixes', L.shiftGroups({ c1: 'B', mc0: 'C' }, 'mc', 0, 1), { c1: 'B' })
  // Time <-> index on hourly bars (seconds).
  const H = 3600
  const t0 = Date.UTC(2026, 9, 14, 0) / 1000
  const hourly = Array.from({ length: 10 }, (_, i) => t0 + i * H)
  eq('link: exact bar', L.timeToLogical(hourly, t0 + 3 * H), 3)
  eq('link: between bars', L.timeToLogical(hourly, t0 + 3.5 * H), 3.5)
  eq('link: past the live bar extrapolates', L.timeToLogical(hourly, t0 + 12 * H), 12)
  eq('link: before the first bar extrapolates', L.timeToLogical(hourly, t0 - 2 * H), -2)
  eq('link: no bars', L.timeToLogical([], t0), null)
  eq('link: inverse inside', L.logicalToTime(hourly, 4.25), t0 + 4.25 * H)
  eq('link: inverse right offset', L.logicalToTime(hourly, 11), t0 + 11 * H)
  // A 1h view of bars 2..8 (+ 2 bars of right offset) on a 15m chart.
  const q = Array.from({ length: 60 }, (_, i) => t0 + i * 900)
  const w = L.rangeToTimes(hourly, { from: 2, to: 11 })
  eq('link: window in time', w, { from: t0 + 2 * H, to: t0 + 11 * H })
  eq('link: window on the 15m chart', L.timesToRange(q, w), { from: 8, to: 44 })
  // A 15m window of one bar on the hourly chart widens to two bars.
  const narrow = L.timesToRange(hourly, { from: t0 + 3 * H, to: t0 + 3 * H + 900 })
  eq('link: narrow window widened', narrow, { from: 2.125, to: 4.125 })
  eq('link: empty window rejected', L.rangeToTimes(hourly, { from: 3, to: 3 }), null)
  // Round trip across a weekend gap stays on the same bars.
  const gap = [t0, t0 + H, t0 + 50 * H, t0 + 51 * H]
  eq('link: gap round trip', L.timeToLogical(gap, L.logicalToTime(gap, 1.5)), 1.5)
}

// ---- r3-compare: ratio / spread symbols, compare lines, volume-profile modes ----
{
  const S = await import(src('services/syntheticSymbol.ts'))
  eq('synth: ratio parses', S.parseSynthetic('btcusdt/ethusdt'), { expr: 'BTCUSDT/ETHUSDT', a: 'BTCUSDT', op: '/', b: 'ETHUSDT', k: 0 })
  eq('synth: spread with spaces', S.parseSynthetic(' BTCUSDT - ETHUSDT ')?.expr, 'BTCUSDT-ETHUSDT')
  eq('synth: bare tickers get USDT', S.parseSynthetic('BTC/ETH')?.expr, 'BTCUSDT/ETHUSDT')
  eq('synth: constant', S.parseSynthetic('BTCUSDT*2'), { expr: 'BTCUSDT*2', a: 'BTCUSDT', op: '*', b: null, k: 2 })
  eq('synth: a pair written BTC/USDT is not a ratio', S.parseSynthetic('BTC/USDT'), null)
  eq('synth: a pair written BTC-USDT is not a spread', S.parseSynthetic('BTC-USDT'), null)
  eq('synth: plain symbol', S.parseSynthetic('BTCUSDT'), null)
  eq('synth: divide by zero rejected', S.parseSynthetic('BTCUSDT/0'), null)
  eq('synth: two operators rejected', S.parseSynthetic('A1/B1/C1'), null)
  eq('synth: whole symbols kept', S.parseSynthetic('XAUUSD/BTC', (x) => x === 'XAUUSD')?.expr, 'XAUUSD/BTCUSDT')
  const bar = (t, o, h, l, c, v = 1) => ({ t, o, h, l, c, v })
  const A = [bar(3, 30, 33, 29, 32, 5), bar(1, 10, 12, 9, 11, 7), bar(2, 20, 22, 19, 21, 6)]
  const B = [bar(1, 5, 6, 4, 5), bar(3, 10, 10, 10, 8)]
  const r = S.combineSeries(A, B, '/')
  eq('synth: joined on time only, sorted', r.map((x) => x.t), [1, 3])
  eq('synth: ratio o/c per field', [r[0].o, r[0].c], [2, 2.2])
  eq('synth: high/low widened to contain o/c', [r[1].h, r[1].l, r[1].c], [4, 2.9, 4])
  eq('synth: volume is the first leg', r[1].v, 5)
  const d = S.combineSeries(A, B, '-')
  eq('synth: spread', [d[0].o, d[0].c, d[0].h, d[0].l], [5, 6, 6, 5])
  eq('synth: scalar', S.scaleSeries([bar(1, 1, 2, 0.5, 1.5)], '*', 2)[0], bar(1, 2, 4, 1, 3))
  eq('synth: zero denominator bar dropped', S.combineSeries([bar(1, 1, 1, 1, 1)], [bar(1, 0, 0, 0, 0)], '/'), [])

  const C = await import(src('features/charts/compareMath.ts'))
  const rows = [bar(100, 0, 0, 0, 10), bar(300, 0, 0, 0, 12)]
  eq('compare: as-of join', C.asOfJoin([50, 100, 200, 300, 400], rows), [{ t: 100, v: 10 }, { t: 200, v: 10 }, { t: 300, v: 12 }, { t: 400, v: 12 }])
  near('compare: pct from first visible', C.pctFrom([{ t: 1, v: 10 }, { t: 2, v: 20 }, { t: 3, v: 25 }], 2), 25)
  eq('compare: pct with no points', C.pctFrom([], 0), null)
  eq('compare: pct format', [C.fmtPct(1.234), C.fmtPct(-0.4), C.fmtPct(null)], ['+1.23%', '−0.40%', '—'])
  eq('compare: depth stepped', [C.compareDepth(10), C.compareDepth(501), C.compareDepth(99999)], [500, 1000, 5000])
  eq('compare: merge tail', C.mergeTail([bar(1, 0, 0, 0, 1), bar(2, 0, 0, 0, 2)], [bar(2, 0, 0, 0, 3), bar(3, 0, 0, 0, 4)]).map((x) => x.c), [1, 3, 4])

  const V = await import(src('features/charts/volumeProfile.ts'))
  const H = 3600_000
  const day = Date.UTC(2026, 9, 30)
  const cs = Array.from({ length: 48 }, (_, i) => bar(day - 24 * H + i * H, 1, 2, 0.5, 1.5, 1))
  eq('vp mode: session starts at the current UTC day', V.profileCandles('session', cs)[0].t, day)
  eq('vp mode: session bar count', V.profileCandles('session', cs).length, 24)
  eq('vp mode: visible range', V.profileCandles('visible', cs, { from: day, to: day + 2 * H }).length, 3)
  eq('vp mode: visible without a range falls back', V.profileCandles('visible', cs).length, V.profileWindow(cs).length)
  eq('vp mode: all is the loaded window', V.profileCandles('all', cs).length, V.profileWindow(cs).length)
  eq('vp mode: guard', [V.isVpMode('session'), V.isVpMode('x')], [true, false])
}

// ---- r3-drawings: angle constraint, stacking, position tool, anchored VWAP --------
{
  const O = await import(src('features/charts/drawings/ops.ts'))
  eq('constrain: nearly flat snaps to horizontal', O.constrainAngle(0, 0, 100, 8), [100, 0])
  eq('constrain: nearly vertical snaps to vertical', O.constrainAngle(0, 0, 6, -90), [0, -90])
  const [dx, dy] = O.constrainAngle(0, 0, 50, 46)
  ok('constrain: near 45 degrees snaps to the diagonal', Math.abs(dx - dy) < 1e-9 && dx > 45, [dx, dy])
  eq('constrain: no movement stays put', O.constrainAngle(5, 5, 5, 5), [5, 5])
  const L = ['a', 'b', 'c', 'd']
  eq('order: bring to front returns the new index', O.reorder(L, 1, 'front'), 3)
  eq('order: front moves it last (painted on top)', L, ['a', 'c', 'd', 'b'])
  eq('order: send to back', [O.reorder(L, 2, 'back'), L], [0, ['d', 'a', 'c', 'b']])
  eq('order: out of range is left alone', O.reorder(L, 9, 'front'), 9)
  const orig = { type: 'trend', color: '#fff', points: [{ time: 1, price: 2 }], locked: true, hidden: true }
  const copy = O.cloneDrawing(orig)
  copy.points[0].price = 9
  eq('clone: deep copy, never locked or hidden', [copy.locked, copy.hidden, orig.points[0].price, copy.type], [undefined, undefined, 2, 'trend'])
  const st = O.positionStats('long', 100, 95, 110, 104, 10000, 1)
  eq('position: quantity risks 1% at the stop', st.qty, 20)
  eq('position: amounts and R:R', [st.riskAmt, st.rewardAmt, st.rr], [100, 200, 2])
  eq('position: distances and % to target / stop', [st.targetDist, st.targetPct, st.stopDist, st.stopPct], [10, 10, -5, -5])
  eq('position: open P&L at the last price', [st.pnl, st.pnlPct], [80, 0.8])
  const sh = O.positionStats('short', 100, 105, 90, 104, 10000, 1)
  eq('position: a short loses as price rises', [sh.qty, sh.pnl], [20, -80])
  eq('position: no last price, no P&L', O.positionStats('long', 100, 95, 110, null).pnl, null)
  eq('position: stop on the entry sizes nothing', O.positionStats('long', 100, 100, 110, 101).qty, 0)
  const P = (e, s, t) => [{ time: 1, price: e }, { time: 2, price: s }, { time: 3, price: t }]
  eq('sides: a long with the stop above entry is mirrored', O.fixPositionSides('long', P(100, 104, 110)).map((p) => p.price), [100, 96, 110])
  eq('sides: a short with stop and target swapped', O.fixPositionSides('short', P(100, 95, 106)).map((p) => p.price), [100, 105, 94])
  eq('sides: a correct long is untouched', O.fixPositionSides('long', P(100, 95, 110)).map((p) => p.price), [100, 95, 110])
  eq('sides: dragging clamps just short of the entry', O.fixPositionSides('long', P(100, 104, 110), true)[1].price, 99.95)
  eq('sides: other tools pass through', O.fixPositionSides('trend', P(1, 2, 3)).map((p) => p.price), [1, 2, 3])
  const bars = [
    { h: 12, l: 9, c: 9, v: 2 },
    { h: 21, l: 18, c: 21, v: 0 },
    { h: 33, l: 27, c: 30, v: 1 },
  ]
  eq('avwap: cumulative typical price x volume', O.anchoredVwap(bars), [10, 10, 50 / 3])
  eq('avwap: no volume yet falls back to the typical price', O.anchoredVwap([{ h: 3, l: 1, c: 2, v: 0 }]), [2])
}

// ---- r3-replay: paper trading + replay position maths ----------------------------
{
  const PT = await import(src('features/charts/paperTrading.ts'))
  let b = PT.emptyBook()
  b = PT.buy(b, 2, 100, 1)
  eq('paper: buy opens a long', [b.pos, b.avg, b.openT], [2, 100, 1])
  b = PT.buy(b, 2, 110, 2)
  eq('paper: adding averages the entry', [b.pos, b.avg], [4, 105])
  near('paper: unrealised marks the position', PT.unrealized(b, 115), 40)
  b = PT.sell(b, 1, 125, 3)
  eq('paper: partial close books a trade', [b.pos, b.avg, b.trades.length, b.realized], [3, 105, 1, 20])
  b = PT.sell(b, 5, 95, 4)
  eq('paper: selling through flips short', [b.pos, b.avg, b.openT], [-2, 95, 4])
  near('paper: the covered slice is realised', b.realized, 20 - 30)
  near('paper: short gains as price falls', PT.unrealized(b, 90), 10)
  b = PT.flatten(b, 90, 5)
  eq('paper: flatten closes the short', [b.pos, b.avg, b.trades.length], [0, 0, 3])
  eq('paper: flatten when flat is a no-op', PT.flatten(b, 80, 6), b)
  eq('paper: a bad size is ignored', PT.buy(b, 0, 100, 7), b)
  eq('paper: a bad price is ignored', PT.sell(b, 1, NaN, 7), b)
  eq('paper: every fill is kept', b.fills.map((f) => f.side), ['buy', 'buy', 'sell', 'sell', 'buy'])
  const s = PT.summary(b, 90)
  eq('paper: summary counts round trips', [s.trades, s.wins, s.losses], [3, 2, 1])
  near('paper: win rate', s.winRate, 2 / 3)
  near('paper: net = realised when flat', s.net, 20 - 30 + 10)
  eq('paper: best and worst trade', [s.best, s.worst], [20, -30])
  const o = PT.buy(PT.emptyBook(), 0.3, 10, 1)
  const c = PT.sell(PT.sell(PT.sell(o, 0.1, 10, 2), 0.1, 10, 3), 0.1, 10, 4)
  eq('paper: float dust does not leave a position', [c.pos, c.avg], [0, 0])
  eq('paper: empty summary', PT.summary(PT.emptyBook(), 1).winRate, 0)

  const RM = await import(src('features/charts/replayMath.ts'))
  const bars = [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }]
  eq('replay: count at or before a time', [5, 10, 25, 40, 99].map((t) => RM.countAtOrBefore(bars, t)), [0, 1, 2, 4, 4])
  eq('replay: date lands on the bar at or after it', [5, 20, 25, 99].map((t) => RM.countFromDate(bars, t)), [1, 2, 3, 4])
  eq('replay: date on no bars', RM.countFromDate([], 5), 0)
  const rs = [0, 0.5, 0.999999].map((r) => RM.randomCount(100, () => r))
  eq('replay: random bar stays off the ends', rs, [10, 50, 90])
  eq('replay: random on one bar', RM.randomCount(1, () => 0.7), 1)
}

// ---- round 3: alerts — conditions (AND), drawings, Pine, frequency, webhook ----
{
  const C = await import(src('features/alerts/conditions.ts'))
  const R = await import(src('features/alerts/rules.ts'))
  const k = (t, c, extra = {}) => ({ t, o: c, h: c, l: c, c, v: 1, ...extra })
  const bars = [k(0, 10), k(1, 11), k(2, 13)]
  const ctx = (outputs = {}, pine = {}) => ({ candles: bars, outputs, pine })
  const close = { t: 'price', field: 'close' }
  const val = (v) => ({ t: 'value', v })
  // Lines: a segment ends where it was drawn; a ray runs on; a level holds from its start.
  const seg = { t1: 0, p1: 10, t2: 2, p2: 14, span: 'segment' }
  eq('cond line: segment interpolates', C.linePriceAt(seg, 1), 12)
  eq('cond line: segment stops at its end', C.linePriceAt(seg, 3), null)
  eq('cond line: ray extends forward', C.linePriceAt({ ...seg, span: 'ray' }, 3), 16)
  eq('cond line: ray not before its start', C.linePriceAt({ ...seg, span: 'ray' }, -1), null)
  eq('cond line: extended both ways', C.linePriceAt({ ...seg, span: 'extended' }, -1), 8)
  eq('cond line: level', C.linePriceAt({ t1: 0, p1: 5, t2: 0, p2: 5, span: 'level' }, 99), 5)
  // Drawings: chart seconds become candle ms; a parallel channel gives both sides.
  const ch = C.drawingLines({ type: 'parallel', points: [{ time: 0, price: 10 }, { time: 2, price: 14 }, { time: 1, price: 15 }] })
  eq('cond drawing: channel has two sides', ch.map((x) => x.label), ['Channel bottom', 'Channel top'])
  eq('cond drawing: channel top offset by the third point', C.linePriceAt(ch[1].line, 1000), 15)
  eq('cond drawing: hline is a level everywhere', C.drawingLines({ type: 'hline', points: [{ time: 50, price: 7 }] })[0].line.span, 'level')
  eq('cond drawing: vline offers nothing', C.drawingLines({ type: 'vline', points: [{ time: 1, price: 1 }] }).length, 0)
  // Operators.
  eq('cond: crossing up a value', C.evalCond({ a: close, op: 'cross_up', b: val(12) }, ctx(), 2), true)
  eq('cond: no cross on the first bar', C.evalCond({ a: close, op: 'cross', b: val(5) }, ctx(), 0), false)
  eq('cond: crossing down is not crossing up', C.evalCond({ a: close, op: 'cross_down', b: val(12) }, ctx(), 2), false)
  const sma = { t: 'out', uid: 'i1', key: 'v' }
  eq('cond: greater than another series', C.evalCond({ a: close, op: 'gt', b: sma }, ctx({ 'i1.v': [9, 12, 12] }), 2), true)
  eq('cond: missing series value never holds', C.evalCond({ a: close, op: 'gt', b: sma }, ctx({ 'i1.v': [9, 12, null] }), 2), false)
  eq('cond: crossing a trend line', C.evalCond({ a: close, op: 'cross_up', b: { t: 'line', line: { t1: 0, p1: 11, t2: 2, p2: 12, span: 'segment' } } }, ctx(), 2), true)
  const band = { op: 'enter', b: val(12), c: val(14) }
  eq('cond: entering a channel', C.evalCond({ a: close, ...band }, ctx(), 2), true)
  eq('cond: exiting needs to have been inside', C.evalCond({ a: close, ...band, op: 'exit' }, ctx(), 2), false)
  eq('cond: inside channel (bounds in any order)', C.evalCond({ a: close, op: 'inside', b: val(14), c: val(12) }, ctx(), 2), true)
  eq('cond: moving up % in N bars', C.evalCond({ a: close, op: 'up_pct', b: val(30), bars: 2 }, ctx(), 2), true)
  eq('cond: moving up % below the threshold', C.evalCond({ a: close, op: 'up_pct', b: val(31), bars: 2 }, ctx(), 2), false)
  const pineOp = { t: 'pine', uid: 'p1', idx: 0, title: 'Buy' }
  const pine = { p1: [{ title: 'Sell', values: [true, true, true] }, { title: 'Buy', values: [false, false, true] }] }
  eq('cond: Pine alertcondition found by title after an edit', C.evalCond({ a: pineOp, op: 'true' }, ctx({}, pine), 2), true)
  eq('cond: Pine alertcondition false bar', C.evalCond({ a: pineOp, op: 'true' }, ctx({}, pine), 1), false)
  eq('cond: AND of all conditions', C.evalConds([{ a: close, op: 'gt', b: val(12) }, { a: close, op: 'lt', b: val(14) }], ctx(), 2), true)
  eq('cond: AND fails on one', C.evalConds([{ a: close, op: 'gt', b: val(12) }, { a: close, op: 'lt', b: val(13) }], ctx(), 2), false)
  eq('cond: judged bar on close is the last closed one', [C.judgedBar(10, false), C.judgedBar(10, true)], [9, 8])
  // Validation.
  eq('cond norm: more than five rejected', C.normalizeConds(Array(6).fill({ a: close, op: 'gt', b: val(1) })), null)
  eq('cond norm: channel needs both bounds', C.normalizeConds([{ a: close, op: 'enter', b: val(1) }]), null)
  eq('cond norm: bars clamped', C.normalizeConds([{ a: close, op: 'up_pct', b: val(1), bars: 9999 }])[0].bars, 500)
  eq('cond uids: outputs and Pine', C.condUids([{ a: sma, op: 'gt', b: { t: 'out', uid: 'i2', key: 'x' } }, { a: pineOp, op: 'true' }]), ['i1', 'i2', 'p1'])
  const saved = R.normalizeRules([
    { kind: 'cond', id: 'a', sym: 'BTCUSDT', tf: '1h', condition: 'conditions', value: 0, conds: [{ a: close, op: 'gt', b: val(1) }], inds: [{ uid: 'i1', type: 'sma', params: { len: 9 }, source: 'close' }], freq: 'bar', webhook: 'https://example.com/h', message: 'Hi {{ticker}}' },
    { kind: 'cond', id: 'b', sym: 'BTCUSDT', condition: 'conditions', value: 0, conds: [] },
    { kind: 'watchlist', id: 'c', condition: 'any_technical', tech: 'rsi_above', value: 70, tf: '1h' },
    { kind: 'watchlist', id: 'd', condition: 'any_technical', tech: 'nope', value: 70 },
    { kind: 'price', id: 'e', sym: 'BTCUSDT', condition: 'above', value: 1, webhook: 'http://example.com' },
  ])
  eq('rules norm: cond rule kept, empty conds dropped', saved.map((r) => r.id), ['a', 'c', 'e'])
  eq('rules norm: cond extras kept', [saved[0].freq, saved[0].tf, saved[0].inds.length, saved[0].message], ['bar', '1h', 1, 'Hi {{ticker}}'])
  eq('rules norm: watchlist technical keeps tech + tf', [saved[1].tech, saved[1].tf], ['rsi_above', '1h'])
  eq('rules norm: http webhook dropped', saved[2].webhook, undefined)
  // Frequency and expiry.
  const base = { id: 'x', kind: 'cond', sym: 'BTCUSDT', condition: 'conditions', value: 0, once: false, enabled: true, created: 0, triggerCount: 0 }
  const perBar = { ...base, freq: 'bar' }
  const s1 = R.stepRule(perBar, true, 1000, undefined, 60000)
  const s2 = R.stepRule(s1.next, true, 2000, undefined, 60000)
  const s3 = R.stepRule(s2.next, true, 3000, undefined, 120000)
  eq('freq bar: fires, not again in the bar, again next bar', [s1.fire, s2.fire, s3.fire], [true, false, true])
  eq('freq: legacy once/every derived', [R.freqOf({ once: true }), R.freqOf({ once: false })], ['once', 'every'])
  const exp = R.stepRule({ ...base, expires: 500 }, true, 1000)
  eq('expiry: a rule past it switches off unfired', [exp.fire, exp.next.enabled], [false, false])
  eq('every time: cooldown 0 refires on each new edge', R.stepRule({ ...base, cooldownMin: 0, lastTriggered: 999, lastState: false }, true, 1000).fire, true)
  // Technical % moves and watchlist technicals.
  const ramp = Array.from({ length: 70 }, (_, i) => ({ c: 100 }))
  ramp.push({ c: 110 })
  eq('tech: moving up % in N bars', R.evalTechnical({ condition: 'move_up_pct', value: 10, value2: 1 }, ramp), true)
  eq('tech: moving down % not on a rise', R.evalTechnical({ condition: 'move_down_pct', value: 1, value2: 1 }, ramp), false)
  const wt = R.evalWatchTech({ tech: 'move_up_pct', value: 5, value2: 1 }, [{ symbol: 'A', candles: ramp }, { symbol: 'B', candles: ramp.slice(0, 70) }])
  eq('watchlist technical: only matching symbols', wt.matched, ['A'])
  // Message templates and webhook URLs.
  eq('template: placeholders filled, unknown kept', C.fillTemplate('{{ticker}} {{ close }} {{interval}} {{nope}}', { ticker: 'BTCUSDT', close: '1.5', interval: '1h' }), 'BTCUSDT 1.5 1h {{nope}}')
  eq('webhook url: https host ok', C.validWebhookUrl(' https://hooks.example.com/x '), 'https://hooks.example.com/x')
  eq('webhook url: http, IP, localhost, credentials refused', ['http://a.com', 'https://10.0.0.1/x', 'https://localhost/x', 'https://u:p@a.com'].map(C.validWebhookUrl), [null, null, null, null])
  const W = await import(pathToFileURL(resolve(__dirname, '..', 'api', 'alert-webhook.mjs')).href)
  eq('relay: private addresses', ['10.1.2.3', '127.0.0.1', '169.254.1.1', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1'].every(W.isPrivateAddress), true)
  eq('relay: public addresses', ['8.8.8.8', '1.1.1.1', '2606:4700::1111'].some(W.isPrivateAddress), false)
  eq('relay: target checks', ['https://a.example.com/h', 'https://a.example.com:8443/h', 'https://1.2.3.4/h', 'https://x.internal/h'].map((u) => !!W.webhookTarget(u)), [true, false, false, false])
  eq('relay: JSON messages go out as JSON', [W.messageType('{"a":1}'), W.messageType('BTC up')], ['application/json', 'text/plain; charset=utf-8'])
}

// ---- r3-indicators: zigzag, auto fib, patterns, new indicators, style, templates ----
{
  const M = await import(src('features/charts/indicators/math.ts'))
  const R = await import(src('features/charts/indicators/registry.ts'))
  const S = await import(src('features/charts/indicators/store.ts'))
  // A price path through the given turning points, 10 bars per leg.
  const path = (pts, step = 60000) => {
    const v = []
    for (let k = 1; k < pts.length; k++)
      for (let j = 0; j < 10; j++) v.push(pts[k - 1] + ((pts[k] - pts[k - 1]) * j) / 10)
    v.push(pts[pts.length - 1])
    return v.map((x, i) => ({ t: i * step, o: x, h: x, l: x, c: x, v: 1 }))
  }
  const turns = (z) => z.pivots.map((p) => [p.i, p.price, p.high])

  // ZigZag: legs end on a 5% reversal; the last leg is still running.
  const dt = path([100, 120, 105, 120, 100])
  const z = M.zigzag(dt, 5, 3)
  eq('zigzag: confirmed turns', turns(z), [[0, 100, false], [10, 120, true], [20, 105, false], [30, 120, true]])
  eq('zigzag: running extreme of the live leg', [z.last.i, z.last.price, z.last.high], [40, 100, false])
  eq('zigzag: a 20% deviation ignores the 12.5% dip', turns(M.zigzag(dt, 20, 3)), [[0, 100, false]])
  // Depth: a leg shorter than `depth` bars cannot end.
  eq('zigzag: depth 15 lets a 10-bar leg run on into the next', turns(M.zigzag(dt, 5, 15)), [[0, 100, false], [30, 120, true]])
  const zl = M.zigzagLine(dt, 5, 3)
  eq('zigzag line: values only at the turns', zl.map((v, i) => (v == null ? null : i)).filter((x) => x != null), [0, 10, 20, 30, 40])

  // Auto Fib: last confirmed swing 105 (bar 20) → 120 (bar 30); 0 at 120.
  const fib = M.autoFib(dt, 5, 3)
  eq('auto fib: drawn from the swing start', fib.from, 20)
  near('auto fib: 0 at the newest pivot', fib.levels[0], 120)
  near('auto fib: 0.618 retracement', fib.levels[4], 120 - 15 * 0.618)
  near('auto fib: 1 at the older pivot', fib.levels[6], 105)
  eq('auto fib: nothing before the swing', [fib.series[4][19], fib.series[4][40]], [null, 120 - 15 * 0.618])
  eq('auto fib: no swing, no levels', M.autoFib(path([100, 101]), 5, 3).levels, [])

  // Chart patterns from pivots.
  const kinds = (pts, dev = 5, tol = 1.5) =>
    M.chartPatterns(M.zigzag(path(pts), dev, 3).pivots, tol).map((p) => p.kind)
  eq('patterns: double top', kinds([90, 120, 100, 120.5, 95, 97]), ['dtop'])
  eq('patterns: double bottom', kinds([130, 100, 120, 100.5, 125, 123]), ['dbot'])
  eq('patterns: head & shoulders claims its pivots before a double bottom', kinds([100, 120, 110, 130, 110, 121, 95]), ['hs'])
  eq('patterns: inverse head & shoulders', kinds([130, 110, 120, 100, 120, 109, 135]), ['ihs'])
  eq('patterns: ascending triangle', kinds([90, 120, 100, 120, 110, 121, 100], 3), ['asc'])
  eq('patterns: descending triangle', kinds([130, 100, 120, 100, 110, 99.5, 112], 3), ['desc'])
  eq('patterns: symmetric triangle', kinds([90, 130, 100, 120, 108, 113], 3), ['sym'])
  eq('patterns: unequal tops are no double top', kinds([90, 120, 100, 130, 95, 97]), [])
  const hs = M.chartPatterns(M.zigzag(path([100, 120, 110, 130, 110, 121, 95]), 5, 3).pivots, 1.5)[0]
  eq('patterns: H&S completes on the right shoulder, bearish', [hs.at, hs.bullish], [50, false])
  const ps = M.patternSeries(70, [hs])
  near('pattern series: outline interpolated between pivots', ps[0][15], 115)
  eq('pattern series: gaps outside the pattern', [ps[0][9], ps[0][51], ps[2][15]], [null, null, null])
  near('pattern series: neckline', ps[1][30], 110)

  // Chandelier Exit: flat, then a collapse flips it short with a sell.
  const bar = (i, h, l, c) => ({ t: i * 60000, o: c, h, l, c, v: 1 })
  const ceBars = Array.from({ length: 30 }, (_, i) => bar(i, 101, 99, 100)).concat([bar(30, 100, 80, 80)])
  const ce = M.chandelier(ceBars, 5, 1)
  near('chandelier: long stop = highest high - ATR', ce.long[20], 101 - 2)
  eq('chandelier: no short stop while long', ce.short[20], null)
  ok('chandelier: a close under the long stop flips short with a sell', ce.sell[30] != null && ce.long[30] == null && ce.short[30] != null)

  // Fisher Transform: flat range reads the middle (0); trigger is a bar late.
  const fl = M.fisher(Array.from({ length: 12 }, (_, i) => bar(i, 101, 99, 100)), 5)
  near('fisher: flat range is 0', fl.fisher[11], 0)
  eq('fisher: warms up after length bars', [fl.fisher[3], fl.fisher[4] != null], [null, true])
  const rise = M.fisher(path([100, 200]), 9)
  ok('fisher: a steady rise reads positive, trigger lags', rise.fisher[10] > 0 && rise.trigger[10] === rise.fisher[9])

  // KST on a steady 1%-per-bar compounding rise: every ROC is constant.
  const geo = Array.from({ length: 80 }, (_, i) => 100 * Math.pow(1.01, i))
  const k = M.kst(geo, 1, 2, 3, 4, 2, 2, 2, 2, 3)
  const r = (n) => (Math.pow(1.01, n) - 1) * 100
  near('kst: weighted sum of smoothed ROCs', k.line[79], r(1) + 2 * r(2) + 3 * r(3) + 4 * r(4), 1e-9)
  near('kst: signal is its SMA', k.signal[79], k.line[79], 1e-9)

  // Pivot point levels by hand: H 110, L 90, C 100 (open 104 for Woodie).
  const tr = M.pivotLevels(110, 90, 100, 1)
  eq('pivots: traditional P/R1/S1/R2/S2/R3/S3', [tr.p, tr.r[0], tr.s[0], tr.r[1], tr.s[1], tr.r[2], tr.s[2]], [100, 110, 90, 120, 80, 130, 70])
  const fb = M.pivotLevels(110, 90, 100, 2)
  near('pivots: fibonacci R1', fb.r[0], 107.64)
  const wd = M.pivotLevels(110, 90, 100, 3, 104)
  eq('pivots: woodie pivot uses the new open', [wd.p, wd.r[0], wd.s[0]], [102, 114, 94])
  const cm = M.pivotLevels(110, 90, 100, 4)
  near('pivots: camarilla R1', cm.r[0], 100 + 22 / 12)
  near('pivots: camarilla S4', cm.s[3], 100 - 11)
  // Daily periods: day 2 draws day 1's levels, starting from its second bar.
  const day = 86400000
  const pp = M.pivotPoints([bar(0, 110, 90, 100), { ...bar(0, 105, 95, 100), t: day }, { ...bar(0, 106, 96, 101), t: day + 3600000 }], 1, 1)
  eq('pivot points: first bar of a period is a break', [pp.p[0], pp.p[1], pp.p[2]], [null, null, 100])
  eq('pivot points: R4 is Camarilla only', pp.r4[2], null)

  // The registry carries the new indicators and they compute.
  const ids = ['zigzag', 'autofib', 'chandelier', 'fisher', 'kst', 'pivotpts', 'patterns']
  ok('registry: new indicators listed', ids.every((id) => R.indicatorDef(id)))
  const pat = R.indicatorDef('patterns').compute([], path([100, 120, 110, 130, 110, 121, 95]), { dev: 5, depth: 3, tol: 1.5 })
  eq('registry: pattern marker code names the pattern', R.indicatorDef('patterns').outputs[5].labelFrom.texts[pat.code[50]], 'H&S')
  ok('registry: bearish marker on the completing bar', pat.bear[50] != null && pat.bull.every((v) => v == null))

  // Interval groups for the Visibility tab.
  eq('tf group: seconds / minutes / hours / days', [S.tfGroupFor(5000), S.tfGroupFor(300000), S.tfGroupFor(4 * 3600000), S.tfGroupFor(7 * day)], ['s', 'm', 'h', 'd'])
  eq('bar step: smallest recent gap (a weekend gap ignored)', S.barStepMs([{ t: 0 }, { t: 3600000 }, { t: 3 * 86400000 }, { t: 3 * 86400000 + 3600000 }]), 3600000)

  // Style settings: cleaned on load, persisted only when set.
  const look = S.sanitizeLook({
    styles: { v: { color: '#ff0000', width: 9, style: 'dotted', visible: false }, x: { color: 'url(evil)' } },
    precision: 4,
    levels: [20, 'x', 80],
    tfVisibility: { s: false, m: true, zz: false },
  })
  eq('style: bad width and colour dropped', look.styles, { v: { color: '#ff0000', style: 'dotted', visible: false } })
  eq('style: precision, levels, tf groups', [look.precision, look.levels, look.tfVisibility], [4, [20, 80], { s: false }])
  eq('style: nothing set, nothing added', S.sanitizeLook({}), {})
  let saved = null
  const st = S.createIndicatorStore({ id: 't', max: 10, load: () => null, save: (d) => (saved = d), prefix: 't' })
  st.addIndicator('rsi')
  const u = st.getIndicators()[0].uid
  eq('style: an untouched instance persists in its old shape', Object.keys(saved[0]).sort(), ['params', 'source', 'type', 'uid', 'visible'])
  st.setStyle(u, 'v', { color: '#00ff00', width: 3 })
  st.setStyle(u, 'v', { style: 'dashed' })
  st.setPrecision(u, 3)
  st.setLevels(u, [25, 75])
  st.setTfVisible(u, 'd', false)
  eq('style: setters merge and persist', [saved[0].styles, saved[0].precision, saved[0].levels, saved[0].tfVisibility], [{ v: { color: '#00ff00', width: 3, style: 'dashed' } }, 3, [25, 75], { d: false }])
  eq('style: round-trips through sanitize', S.sanitizeIndicators(saved)[0].styles, saved[0].styles)
  ok('style: hidden on the days group only', !S.shownOnTf(st.getIndicators()[0], 'd') && S.shownOnTf(st.getIndicators()[0], 'h'))
  st.resetLook(u)
  eq('style: defaults drop every override', Object.keys(saved[0]).sort(), ['params', 'source', 'type', 'uid', 'visible'])

  // Templates: uids re-keyed, references follow.
  let n = 0
  const re = S.remapUids([{ uid: 'a1', type: 'obv', source: 'close' }, { uid: 'a2', type: 'rsi', source: 'a1.v' }, { uid: 'a3', type: 'sma', source: 'zz.v' }], () => 'n' + n++)
  eq('templates: fresh uids, sources remapped, dangling to close', re.map((x) => [x.uid, x.source]), [['n0', 'close'], ['n1', 'n0.v'], ['n2', 'close']])

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
  const T = await import(src('features/charts/indicators/templates.ts'))
  const other = S.createIndicatorStore({ id: 'o', max: 10, load: () => null, save: () => {}, prefix: 'o' })
  st.addIndicator('obv')
  const obvUid = st.getIndicators()[1].uid
  st.setSource(u, obvUid + '.v')
  st.setStyle(u, 'v', { color: '#123456' })
  ok('templates: saved', T.saveTemplate('  My   set ', st.getIndicators()))
  eq('templates: listed under a clean name', T.listTemplates().map((t) => t.name), ['My set'])
  ok('templates: same name replaces', T.saveTemplate('my set', st.getIndicators()) && T.listTemplates().length === 1)
  ok('templates: empty name refused', !T.saveTemplate('   ', st.getIndicators()))
  ok('templates: applied', T.applyTemplate(other, 'my set'))
  const got = other.getIndicators()
  eq('templates: types and styles carried over', got.map((i) => [i.type, i.styles?.v?.color ?? null]), [['rsi', '#123456'], ['obv', null]])
  ok('templates: applied under new uids with the reference kept', got[0].uid !== u && got[0].source === got[1].uid + '.v')
  T.deleteTemplate('my set')
  eq('templates: deleted', T.listTemplates(), [])
  T.toggleFavourite('rsi')
  T.toggleFavourite('kst')
  T.toggleFavourite('rsi')
  eq('favourites: toggled', T.favourites(), ['kst'])
  if (prevLS) Object.defineProperty(globalThis, 'localStorage', prevLS)
  else delete globalThis.localStorage
}

{
  // r3-strategy: broker emulator, arrays, fill/alertcondition, error hints.
  const { runPine } = await import(src('features/charts/pine/runtime.ts'))
  const S = await import(src('features/charts/pine/strategy.ts'))
  const P = await import(src('features/charts/pine/indicator.ts'))
  const bar = (i, o, h, l, c) => ({ t: i * 60000, o, h, l, c, v: 1 })
  const cfg = (x = {}) => ({ ...S.DEFAULT_STRATEGY, mintick: 1, ...x })
  const lastOf = (a) => a[a.length - 1]
  const catchErr = (fn) => {
    try {
      fn()
      return null
    } catch (e) {
      return e
    }
  }

  // Path model: open → nearer extreme → farther extreme → close.
  eq('broker path: high nearer goes up first', S.barPath(bar(0, 100, 104, 94, 100)), [100, 104, 94, 100])
  eq('broker path: low nearer goes down first', S.barPath(bar(0, 100, 108, 95, 100)), [100, 95, 108, 100])
  eq('broker reach: gap past the level fills at the open', S.reach([100, 104, 94, 100], 98, true), [0, 100])
  eq('broker reach: crossing fills at the level', S.reach([100, 104, 94, 100], 102, true), [0.5, 102])
  eq('broker reach: never reached', S.reach([100, 104, 94, 100], 110, true), null)

  // Market entry next open, bracket exit in the same bar it is reached.
  const runBroker = (bars, place, c) => {
    const b = S.createBroker(cfg(c), bars)
    bars.forEach((_, i) => {
      b.beginBar(i)
      place(b, i)
      b.endBar(i)
    })
    return b.report()
  }
  const bracket = (b, i) => {
    if (i === 0) {
      b.entry('L', 1)
      b.exit({ id: 'X', from: 'L', profit: 3, loss: 4 })
    }
  }
  const up = runBroker([bar(0, 100, 101, 99, 100), bar(1, 100, 104, 94, 100)], bracket)
  eq('broker: market entry fills at the next open', [up.trades[0].entryBar, up.trades[0].entryPrice], [1, 100])
  eq('broker: take profit first when the high comes first', [up.trades[0].exitId, up.trades[0].exitPrice, up.trades[0].profit], ['X', 103, 3])
  const dn = runBroker([bar(0, 100, 101, 99, 100), bar(1, 100, 108, 95, 100)], bracket)
  eq('broker: stop first when the low comes first', [dn.trades[0].exitPrice, dn.trades[0].profit], [96, -4])
  eq('broker: summary counts the loss', [dn.summary.totalTrades, dn.summary.losses, dn.summary.winRate, dn.summary.netProfit], [1, 1, 0, -4])
  const lim = runBroker(
    [bar(0, 100, 101, 99, 100), bar(1, 100, 101, 99, 100), bar(2, 97, 99, 90, 92)],
    (b, i) => i === 0 && b.entry('B', 1, 1, 98),
  )
  eq('broker: buy limit gapped through fills at the open', [lim.trades[0].entryBar, lim.trades[0].entryPrice], [2, 97])
  const stp = runBroker(
    [bar(0, 100, 101, 99, 100), bar(1, 100, 106, 99, 105)],
    (b, i) => i === 0 && b.entry('B', 1, 2, undefined, 103),
    { slippage: 1 },
  )
  eq('broker: buy stop fills at the level plus slippage', [stp.trades[0].entryPrice, stp.trades[0].qty], [104, 2])
  const trail = runBroker(
    [bar(0, 100, 100, 100, 100), bar(1, 100, 110, 100, 110), bar(2, 110, 111, 104, 105)],
    (b, i) => {
      if (i === 0) {
        b.entry('L', 1)
        b.exit({ id: 'T', from: 'L', trailPoints: 5, trailOffset: 3 })
      }
    },
  )
  eq('broker: trailing stop follows the high', [trail.trades[0].exitBar, trail.trades[0].exitPrice], [2, 107])

  // Through runPine: reversal, position_size, history, open trade.
  const k = [bar(0, 10, 10, 10, 10), bar(1, 11, 12, 11, 12), bar(2, 13, 13, 13, 13), bar(3, 14, 14, 14, 14)]
  const rv = runPine(`strategy("rev", initial_capital=1000)
if bar_index == 0
    strategy.entry("L", strategy.long, qty=2)
if bar_index == 1
    strategy.entry("S", strategy.short, qty=1)
plot(strategy.position_size, "pos")
plot(strategy.position_size[1], "prev")`, k)
  eq('strategy: position_size per bar', rv.plots[0].values, [0, 2, -1, -1])
  eq('strategy: position_size[1]', rv.plots[1].values.slice(1), [0, 2, -1])
  eq('strategy: reversal closes the long at the open', [rv.strategy.trades[0].exitId, rv.strategy.trades[0].exitPrice, rv.strategy.trades[0].profit], ['S', 13, 4])
  eq('strategy: the open short is marked at the last close', [rv.strategy.trades[1].open, rv.strategy.trades[1].profit], [true, -1])
  eq('strategy: equity per bar', rv.strategy.equity, [1000, 1002, 1004, 1003])
  eq('strategy: net profit, open P&L', [rv.strategy.summary.netProfit, rv.strategy.summary.openPL], [4, -1])
  eq('strategy: markers for entries and exits', P.tradeShapes(rv.strategy).map((s) => [s.bar, s.text, s.shape]), [[1, 'L', 'arrowUp'], [2, 'S', 'arrowDown'], [2, 'S', 'arrowDown']])
  const pyr = (n) => runPine(`strategy("p", pyramiding=${n})
if bar_index < 3
    strategy.entry("L", strategy.long)
plot(close)`, k).strategy.trades.length
  eq('strategy: pyramiding 0 allows one entry, 2 allows two', [pyr(0), pyr(2)], [1, 2])
  const com = runPine(`strategy("c", initial_capital=1000, default_qty_type=strategy.percent_of_equity, default_qty_value=50, commission_type=strategy.commission.cash_per_order, commission_value=1)
if bar_index == 0
    strategy.entry("L", strategy.long)
if bar_index == 1
    strategy.close("L")
plot(close)`, k).strategy
  eq('strategy: % of equity sizing, cash commission, close', [com.trades[0].qty, com.trades[0].profit, com.summary.commission], [50, 98, 2])
  const poc = runPine(`strategy("o", process_orders_on_close=true)
if bar_index == 0
    strategy.entry("L", strategy.long)
plot(close)`, k).strategy
  eq('strategy: process_orders_on_close fills at the signal bar close', [poc.trades[0].entryBar, poc.trades[0].entryPrice], [0, 10])
  const ind = runPine('indicator("i")\nstrategy.entry("L", strategy.long)\nplot(close)', k)
  eq('strategy: orders in an indicator are a warning', [ind.warnings, ind.strategy], [['strategy.entry'], undefined])

  // Arrays.
  const ar = runPine(`indicator("arr")
var a = array.new_float(0)
array.push(a, bar_index)
b = array.from(3, 1, 2)
array.sort(b)
c = array.slice(b, 1)
plot(array.size(a), "size")
plot(array.sum(b), "sum")
plot(array.get(b, -1), "last")
plot(array.min(b) + 10 * array.max(b), "minmax")
plot(array.avg(c), "avg")
plot(array.includes(b, 2) ? 1 : 0, "incl")
x = array.new_int(3, 7)
array.set(x, 0, 1)
array.unshift(x, 5)
p = array.pop(x)
s = array.shift(x)
x.push(9)
plot(p * 100 + s * 10 + x.size(), "ops")
y = array.copy(x)
array.clear(y)
plot(array.size(y) + array.size(x) * 10, "clear")
var array<float> q = array.new<float>(2, 1.5)
plot(array.sum(q), "generic")`, k)
  eq('array: var array persists across bars', lastOf(ar.plots[0].values), 4)
  eq('array: from / sort / sum / get(-1)', [lastOf(ar.plots[1].values), lastOf(ar.plots[2].values)], [6, 3])
  eq('array: min / max', lastOf(ar.plots[3].values), 31)
  eq('array: slice / avg / includes', [lastOf(ar.plots[4].values), lastOf(ar.plots[5].values)], [2.5, 1])
  eq('array: set / unshift / pop / shift / method push', lastOf(ar.plots[6].values), 753)
  eq('array: copy / clear', lastOf(ar.plots[7].values), 30)
  eq('array: array<float> type and array.new<float>', lastOf(ar.plots[8].values), 3)
  const oob = catchErr(() => runPine('indicator("e")\na = array.new_float(2)\nplot(array.get(a, 5))', k))
  ok('array: out of bounds names line and column', oob && oob.line === 3 && oob.col === 6 && /out of bounds/.test(oob.message), oob && oob.message)
  const emp = catchErr(() => runPine('a = array.new_float()\nv = array.pop(a)', k))
  ok('array: pop on an empty array is an error', emp && /empty/.test(emp.message), emp && emp.message)

  // fill / bgcolor / alertcondition.
  const fl = runPine(`indicator("f")
p1 = plot(high, "h")
p2 = plot(low, "l")
h1 = hline(1)
h2 = hline(2)
fill(p1, p2, color=color.red)
fill(h1, h2)
bgcolor(close > 12 ? color.green : na)
alertcondition(close > 12, "Up", "close above 12")`, k)
  eq('fill: between two plots', [fl.fills[0].plot1 === fl.plots[0].key, fl.fills[0].plot2 === fl.plots[1].key, fl.fills[0].color], [true, true, '#f23645'])
  eq('fill: between two hlines', [fl.fills[1].plot1, fl.fills[1].plot2], ['hline:0', 'hline:1'])
  eq('bgcolor: per bar', fl.bgcolors, [undefined, undefined, '#089981', '#089981'])
  eq('alertcondition: title, message, per-bar values', fl.alertconditions, [{ title: 'Up', message: 'close above 12', values: [false, false, true, true] }])

  // Error hints.
  const dy1 = catchErr(() => runPine('plot(clsoe)', k))
  ok('pine error: did you mean an identifier', dy1 && /did you mean 'close'/.test(dy1.message) && dy1.col === 6, dy1 && dy1.message)
  const dy2 = catchErr(() => runPine('plot(ta.ema2(close, 3))', k))
  ok('pine error: did you mean a function', dy2 && /did you mean 'ta.ema'/.test(dy2.message), dy2 && dy2.message)
  const dy3 = catchErr(() => runPine('plot(sma(close, 3))', k))
  ok('pine error: missing namespace suggested', dy3 && /did you mean 'ta.sma'/.test(dy3.message), dy3 && dy3.message)
}

{
  // r3-orderflow: real footprint book, imbalances, tick bars, depth history.
  const FB = await import(src('features/charts/orderflow/footprintBook.ts'))
  const FS = await import(src('features/charts/orderflow/footprintSource.ts'))
  const book = FB.createFootprintBook(2, 8)
  const tr = (bar, price, qty, buyerMaker, time, key = 'BTC|1m') =>
    FB.addFootprintTrade(book, { key, bar, end: bar + 60000, price, qty, buyerMaker, time })
  tr(60000, 100, 2, false, 61000)
  tr(60000, 100, 1, true, 61500)
  tr(60000, 101, 3, false, 62000)
  const b1 = book.bars.get(60000)
  eq('fp: bar volume and range', [b1.vol, b1.lo, b1.hi], [6, 100, 101])
  eq('fp: bar the page joined mid-way is partial', FB.barCoverage(book, b1), 'partial')
  tr(120000, 102, 1, false, 120500)
  eq('fp: bar opening after the first trade is real', FB.barCoverage(book, book.bars.get(120000)), 'real')
  tr(180000, 103, 1, false, 180500)
  eq('fp: oldest bar evicted past maxBars', [...book.bars.keys()], [120000, 180000])
  for (let i = 0; i < 20; i++) tr(180000, 103 + i * 0.01, 1, false, 181000 + i)
  const b3 = book.bars.get(180000)
  ok('fp: cells coarsen to stay under maxCells', b3.cells.size <= 8 && b3.step > FB.initialStep(103), b3.cells.size)
  const totalCells = [...b3.cells.values()].reduce((a, c) => a + c.buy + c.sell, 0)
  eq('fp: coarsening keeps every unit of volume', Math.round(totalCells * 1e6) / 1e6, 21)
  const rows = FB.rebucket(b1, 100, 101, 2)
  eq('fp: rebucket into candle rows (taker buy / taker sell)', rows.map((r) => [r.buy, r.sell]), [[2, 1], [3, 0]])
  tr(240000, 50, 1, false, 240500, 'ETH|1m')
  eq('fp: a new symbol|interval key starts over', [...book.bars.keys()], [240000])
  const R = (pairs) => pairs.map(([buy, sell], i) => ({ lo: i, hi: i + 1, buy, sell }))
  const fl = FB.imbalances(R([[1, 2], [7, 1], [9, 1], [10, 3], [1, 1]]), 3)
  eq('imbalance: diagonal buy vs sell one row below', fl.map((f) => f.buy), [false, true, true, true, false])
  eq('imbalance: diagonal sell vs buy one row above', FB.imbalances(R([[1, 9], [2, 1]]), 3).map((f) => f.sell), [true, false])
  eq('imbalance: minVol ignores tiny prints', FB.imbalances(R([[0, 0], [0.5, 0]]), 3, 1)[1].buy, false)
  eq('imbalance: stacked run of 3', FB.stackedImbalances(fl, 3), [{ side: 'buy', from: 1, to: 3 }])
  eq('imbalance: run of 2 is not stacked', FB.stackedImbalances(fl.slice(0, 3), 3), [])
  eq('poc: row with most volume', FB.pocRow(R([[1, 1], [5, 4], [2, 2]])), 1)
  eq('poc: empty bar', FB.pocRow(R([[0, 0]])), -1)
  const own = FB.createFootprintBook()
  FB.addFootprintTrade(own, { key: 'k', bar: 0, end: 60000, price: 100, qty: 1, buyerMaker: false, time: 0 })
  eq('fp source: matching bar is used', FS.realFootprint({ ms: 0, low: 99, high: 101 }, null, 60000, 4, own)?.coverage, 'real')
  eq('fp source: other interval rejected', FS.realFootprint({ ms: 0, low: 99, high: 101 }, null, 300000, 4, own), null)
  eq('fp source: trades outside the bar rejected', FS.realFootprint({ ms: 0, low: 200, high: 210 }, null, 60000, 4, own), null)

  const TB = await import(src('features/charts/orderflow/tickBars.ts'))
  ok('tick: N clamped, junk falls back to default', TB.clampTicks(3) === 10 && TB.clampTicks('x') === TB.DEFAULT_TICKS)
  const tape = TB.createTradeTape(100)
  for (let i = 0; i < 25; i++) TB.pushTrade(tape, 100 + (i % 5), 2, 1000 + i * 10)
  const t10 = TB.buildTickBars(tape, 10)
  eq('tick: 25 trades / 10 = 2 closed + 1 forming', t10.length, 3)
  eq('tick: bar OHLCV', [t10[0].o, t10[0].h, t10[0].l, t10[0].c, t10[0].v], [100, 104, 100, 104, 20])
  ok('tick: times strictly increasing by >= 1s', t10.every((b, i) => i === 0 || b.t - t10[i - 1].t >= TB.TICK_STEP_MS))
  eq('tick: forming bar volume', t10[2].v, 10)
  const ring = TB.createTradeTape(25)
  for (let i = 0; i < 37; i++) TB.pushTrade(ring, 1 + i, 1, i * 2000)
  eq('tick: ring keeps bars pinned to the global trade count', TB.buildTickBars(ring, 10).map((b) => b.o), [21, 31])
  TB.clearTape(ring)
  eq('tick: cleared tape has no bars', TB.buildTickBars(ring, 10), [])

  const DH = await import(src('features/charts/orderflow/depthHistory.ts'))
  const hist = DH.createDepthHistory(3)
  for (let i = 1; i <= 5; i++) DH.pushDepthSnap(hist, DH.mergeBook(i * 1000, [[100, 1]], null))
  DH.pushDepthSnap(hist, DH.mergeBook(2000, [[100, 1]], null))
  eq('depth: rolling window, out-of-order dropped', hist.snaps.map((s) => s.t), [3000, 4000, 5000])
  eq('depth: snap at or before', [DH.snapAtOrBefore(hist.snaps, 4500), DH.snapAtOrBefore(hist.snaps, 10)], [1, -1])
  const live = [[99, 1], [100, 2], [101, 3]]
  const deep = [[90, 1], [90.5, 1], [99.5, 50], [110, 4], [111, 4]]
  const m = DH.mergeBook(0, live, deep, 1)
  eq('depth: deep levels inside the live band are dropped', Array.from(m.qty).reduce((a, b) => a + b, 0), 6 + 2 + 8)
  eq('depth: deep bins at volume-weighted price', Array.from(m.price).slice(3), [90.25, 110.5])
  const cells = new Float32Array(4)
  DH.binSnapshot(m, (p) => (p >= 100 ? 0 : 5), 3, cells)
  eq('depth: binned into pixel rows', Array.from(cells), [13, 3, 0, 0])
  eq('depth: intensity cap is a percentile', DH.intensityCap([0, 1, 2, 3, 4, 100], 0.75), 4)
  eq('depth: empty grid has no cap', DH.intensityCap([0, 0]), 0)
}

{
  // r4-ux: chart settings sections (U9), collector state (U17), VP plot edge (U21).
  const CS = await import(src('features/charts/chartSettingsMath.ts'))
  const legacy = CS.normalizeSettings({ grid: false, magnet: true })
  eq('r4ux settings: legacy grid seeds both directions', [legacy.gridVert, legacy.gridHorz, legacy.magnet], [false, false, true])
  const bad = CS.normalizeSettings({ crosshair: 'wavy', bodyUp: 'red', bgColor: '', priceLine: 'yes', bodyDown: '#00ff00' })
  eq('r4ux settings: invalid values fall back', [bad.crosshair, bad.bodyUp, bad.bgColor, bad.priceLine, bad.bodyDown], ['dashed', '', CS.DEFAULT_SETTINGS.bgColor, true, '#00ff00'])
  eq('r4ux settings: junk storage gives defaults', CS.normalizeSettings('x'), CS.DEFAULT_SETTINGS)
  eq('r4ux settings: crosshair line styles', ['dashed', 'dotted', 'solid'].map(CS.crosshairLineStyle), [3, 1, 0])
  const grad = CS.settingsChartOptions({ ...CS.DEFAULT_SETTINGS, background: 'gradient', bgColor: '#111111', bgColor2: '#222222', gridVert: false, magnet: true, priceLabels: 'exact' }, '#ffffff')
  eq('r4ux settings: gradient background', grad.layout.background, { type: 'gradient', topColor: '#111111', bottomColor: '#222222' })
  eq('r4ux settings: grid, magnet, label mode', [grad.grid.vertLines.visible, grad.grid.horzLines.visible, grad.crosshair.mode, grad.rightPriceScale.alignLabels], [false, true, 1, false])
  eq('r4ux settings: theme background writes the palette back', CS.settingsChartOptions(CS.DEFAULT_SETTINGS, '#abcdef').layout.background, { type: 'solid', color: '#abcdef' })
  eq('r4ux settings: canvas edge colour', [CS.canvasEdgeColor(CS.DEFAULT_SETTINGS, '#fff'), CS.canvasEdgeColor({ ...CS.DEFAULT_SETTINGS, background: 'gradient', bgColor2: '#010203' }, '#fff')], ['#fff', '#010203'])
  const custom = { ...CS.DEFAULT_SETTINGS, bodyUp: '#00aa00', wickDown: '#aa0000', symbolLabel: false }
  eq('r4ux settings: candle colours on candles', CS.settingsSeriesOptions(custom, 'candle'), { priceLineVisible: true, lastValueVisible: false, upColor: '#00aa00', wickDownColor: '#aa0000' })
  eq('r4ux settings: hollow keeps per-bar bodies', CS.settingsSeriesOptions(custom, 'hollow'), { priceLineVisible: true, lastValueVisible: false, wickDownColor: '#aa0000' })
  eq('r4ux settings: line styles take no candle colours', CS.settingsSeriesOptions(custom, 'line'), { priceLineVisible: true, lastValueVisible: false })
  eq('r4ux settings: a border colour turns borders on', CS.settingsSeriesOptions({ ...CS.DEFAULT_SETTINGS, borderUp: '#123456' }, 'candle').borderVisible, true)
  eq('r4ux settings: legend classes', CS.legendHideClasses({ ...CS.DEFAULT_SETTINGS, legendVolume: false }), { 'cs-hide-ohlc': false, 'cs-hide-chg': false, 'cs-hide-vol': true, 'cs-hide-indv': false })

  const WM = await import(src('features/whales/whaleMath.ts'))
  const now = 1_800_000_000_000
  eq('r4ux collector: states by age', [
    WM.collectorState(false, now, now),
    WM.collectorState(true, now - 5_000, now),
    WM.collectorState(true, now - 10 * 60_000, now),
    WM.collectorState(true, now - 49 * 3600_000, now),
    WM.collectorState(true, NaN, now),
  ], ['none', 'live', 'offline', 'unavailable', 'unavailable'])

  const VP = await import(src('features/charts/volumeProfile.ts'))
  eq('r4ux vp: plot edge is chart offset + left scale + plot width', VP.plotRightEdge(10, 0, 700, 800), 710)
  eq('r4ux vp: plot edge capped to the canvas', VP.plotRightEdge(0, 50, 900, 800), 800)
  eq('r4ux vp: nothing laid out draws nothing', [VP.plotRightEdge(0, 0, 0, 800), VP.plotRightEdge(-4, 0, 300, 800)], [0, 300])
}

// ---- r4-drawings2: visible-on-intervals + the second batch of drawing tools ----------
{
  const V = await import(src('features/charts/drawings/visibility.ts'))
  eq('r4dr vis: 15s is seconds', V.tfGroup('15s'), 'sec')
  eq('r4dr vis: 45m is minutes', V.tfGroup('45m'), 'min')
  eq('r4dr vis: 4h is hours', V.tfGroup('4h'), 'hour')
  eq('r4dr vis: 1M (month) is days and up', V.tfGroup('1M'), 'day')
  eq('r4dr vis: 1w is days and up', V.tfGroup('1w'), 'day')
  ok('r4dr vis: no hideOn shows everywhere', V.visibleOnTf({}, '1m') && V.visibleOnTf({}, '1d'))
  ok('r4dr vis: hidden on minutes', !V.visibleOnTf({ hideOn: ['min'] }, '15m') && V.visibleOnTf({ hideOn: ['min'] }, '1h'))
  eq('r4dr vis: junk entries dropped', V.hiddenGroups({ hideOn: ['x', 'day', 3] }), ['day'])
  eq('r4dr vis: toggle on', V.toggleHidden({}, 'sec'), ['sec'])
  eq('r4dr vis: toggle last off clears', V.toggleHidden({ hideOn: ['sec'] }, 'sec'), undefined)

  const X = await import(src('features/charts/drawings/shapesExtra.ts'))
  const c = X.circleThrough({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 })
  eq('r4dr arc: circle through three points', [c.x, c.y, c.r], [1, 0, 1])
  eq('r4dr arc: collinear has no circle', X.circleThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null)
  const ap = X.arcPoints({ x: 0, y: 0 }, { x: 1, y: -1 }, { x: 2, y: 0 }, 4)
  ok('r4dr arc: passes through the bulge side', ap[2].y < -0.9 && Math.abs(ap[4].x - 2) < 1e-9)
  const bz = X.bezierPoints({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 }, 2)
  eq('r4dr curve: bezier midpoint', [bz[1].x, bz[1].y], [5, 5])
  const rr = X.rotatedRect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 4 })
  eq('r4dr rotrect: far side through the third point', [rr[2].x, rr[2].y, rr[3].x, rr[3].y], [10, 4, 0, 4])
  eq('r4dr ratio: retrace', X.ratio(105, 110, 110, 100), '0.500')
  eq('r4dr ratio: zero span', X.ratio(1, 2, 3, 3), '')
  const gb = X.ghostBars(100, 110, 5)
  ok('r4dr ghost: count and chained opens', gb.length === 5 && gb.every((b, i) => i === 0 || b.o === gb[i - 1].c))
  ok('r4dr ghost: wicks wrap bodies', gb.every((b) => b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c)))
  eq('r4dr ghost: starts and ends on the path', [gb[0].o, gb[4].c], [100, 110])
  // A minimal map: time = x, price = y.
  const m = {
    x: (t) => t,
    y: (p) => p,
    cw: 500,
    ch: 500,
    fmt: (p) => String(p),
    closesBetween: () => [],
    barsBetween: () => 4,
    timeLabel: () => '',
    candles: () => [
      { t: 10000, o: 5, h: 8, l: 4, c: 7, v: 1 },
      { t: 20000, o: 7, h: 9, l: 6, c: 6, v: 1 },
    ],
  }
  const run = (type, points, extra = {}) => {
    const s = { segs: [], fills: [], arcs: [], labels: [], handles: [] }
    const P = points.map((p) => ({ x: p.time, y: p.price }))
    const done = X.extraShape({ type, color: '#4FC3F7', points, ...extra }, P, m, s)
    return { done, s }
  }
  ok('r4dr extra: unknown type falls through', !run('trend', [{ time: 1, price: 1 }]).done)
  const bp = run('barspattern', [
    { time: 10, price: 5 },
    { time: 20, price: 5 },
    { time: 100, price: 50 },
  ])
  // Copy starts at x=100, price shifted so the first open sits on 50.
  ok('r4dr bars pattern: copy placed at the third point', bp.s.segs.some((g) => g.x1 === 100 && g.y1 === 53 && g.y2 === 49))
  const ic = run('icon', [{ time: 50, price: 50 }], { text: '🔥' })
  eq('r4dr icon: glyph label', ic.s.labels[0].text, '🔥')
  ok('r4dr icon: clickable box', ic.s.fills.length === 1)
  const cy = run('cypher', [0, 1, 2, 3, 4].map((i) => ({ time: i * 10, price: [100, 200, 150, 250, 180][i] })))
  ok('r4dr cypher: X..D tagged with ratios', cy.s.labels.filter((l) => l.box).length === 5 && cy.s.labels.some((l) => l.text === '0.500'))
  const fc = run('forecast', [
    { time: 0, price: 100 },
    { time: 40, price: 110 },
  ])
  ok('r4dr forecast: % and bars', fc.s.labels[0].text.includes('+10.00%') && fc.s.labels[0].text.includes('4 bars'))
  const pn = run('pricenote', [
    { time: 0, price: 100 },
    { time: 40, price: 80 },
  ], { bg: '#00000040', border: 'none' })
  eq('r4dr price note: carries the box style', [pn.s.labels[0].text, pn.s.labels[0].bg, pn.s.labels[0].border], ['100', '#00000040', 'none'])
  ok('r4dr extra: every new tool id handled', X.EXTRA_TOOL_IDS.every((id) => run(id, [0, 1, 2, 3, 4, 5].map((i) => ({ time: i * 10, price: 100 + i }))).done))
}

// ---- r4-replay2: update-interval forming bar, working orders, fill markers ----
{
  const RM = await import(src('features/charts/replayMath.ts'))
  const subs = [
    { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 },
    { t: 60, o: 11, h: 15, l: 10, c: 14, v: 2 },
    { t: 120, o: 14, h: 14, l: 7, c: 8, v: 3 },
  ]
  eq('replay2: forming bar folds sub-bars up to the cursor', RM.formingBar(subs, 0, 60), { t: 0, o: 10, h: 15, l: 9, c: 14, v: 3 })
  eq('replay2: forming bar of every sub-bar is the whole bar', RM.formingBar(subs, 0, 120), { t: 0, o: 10, h: 15, l: 7, c: 8, v: 6 })
  eq('replay2: forming bar keeps the main bar open time', RM.formingBar(subs.slice(1), 0, 60).t, 0)
  eq('replay2: nothing formed before the first sub-bar', RM.formingBar(subs, 0, -1), null)
  eq('replay2: next / previous sub-bar', [RM.nextSubTime(subs, 0), RM.nextSubTime(subs, 120), RM.prevSubTime(subs, 120), RM.prevSubTime(subs, 0)], [60, null, 60, null])
  const opts = [{ id: '1s', ms: 1000 }, { id: '1m', ms: 60000 }, { id: '1h', ms: 3600000 }, { id: '1d', ms: 86400000 }]
  eq('replay2: update intervals for 1h bars', RM.updateIntervalsFor(3600000, opts).map((o) => o.id), ['1s', '1m'])
  eq('replay2: 1s steps stop past 1h bars', RM.updateIntervalsFor(86400000, opts).map((o) => o.id), ['1m', '1h'])

  const PT = await import(src('features/charts/paperTrading.ts'))
  const b = { o: 100, h: 105, l: 95 }
  eq('replay2: buy limit fills at its price', PT.orderFill({ side: 'buy', type: 'limit', price: 97 }, b), 97)
  eq('replay2: buy limit below the bar waits', PT.orderFill({ side: 'buy', type: 'limit', price: 90 }, b), null)
  eq('replay2: gap through a buy limit fills at the open', PT.orderFill({ side: 'buy', type: 'limit', price: 101 }, b), 100)
  eq('replay2: buy stop fills at its price', PT.orderFill({ side: 'buy', type: 'stop', price: 104 }, b), 104)
  eq('replay2: gap through a buy stop fills at the open', PT.orderFill({ side: 'buy', type: 'stop', price: 99 }, b), 100)
  eq('replay2: sell limit / sell stop', [PT.orderFill({ side: 'sell', type: 'limit', price: 103 }, b), PT.orderFill({ side: 'sell', type: 'stop', price: 96 }, b), PT.orderFill({ side: 'sell', type: 'stop', price: 94 }, b)], [103, 96, null])
  eq('replay2: order type from the picked price', [PT.orderTypeFor('buy', 90, 100), PT.orderTypeFor('buy', 110, 100), PT.orderTypeFor('sell', 110, 100), PT.orderTypeFor('sell', 90, 100)], ['limit', 'stop', 'limit', 'stop'])

  let bk = PT.buy(PT.emptyBook(), 1, 100, 120000)
  bk = PT.sell(bk, 1, 110, 60000)
  bk = PT.sell(bk, 2, 120, 300000)
  const bars = [{ t: 0 }, { t: 60000 }, { t: 120000 }, { t: 180000 }]
  const mk = PT.fillMarkers(bk.fills, bars, 180000, { up: 'g', dn: 'r' })
  eq('replay2: fill markers sorted, future fills hidden', mk.map((m) => [m.time, m.shape, m.color]), [[60, 'arrowDown', 'r'], [120, 'arrowUp', 'g']])
  eq('replay2: fill marker text', mk[1].text, 'Buy 1 @ 100')
  eq('replay2: fill snaps to the bar it happened in', PT.fillMarkers([{ side: 'buy', qty: 1, price: 1, t: 150000 }], bars, 1e9, { up: 'g', dn: 'r' })[0].time, 120)
  eq('replay2: fill before the first bar is not drawn', PT.fillMarkers([{ side: 'buy', qty: 1, price: 1, t: -5 }], bars, 1e9, { up: 'g', dn: 'r' }), [])
}

// ---- r4-indicators2: multi-timeframe inputs, volume profile, auto trendlines, catalogue ----
{
  const MT = await import(src('features/charts/indicators/mtf.ts'))
  const M = await import(src('features/charts/indicators/math.ts'))
  const R = await import(src('features/charts/indicators/registry.ts'))
  const S = await import(src('features/charts/indicators/store.ts'))
  const G = await import(src('features/charts/indicators/graph.ts'))
  const VP = await import(src('features/charts/indicators/vprofile.ts'))
  const H = 3600000
  const bar = (t, c, v = 1) => ({ t, o: c, h: c, l: c, c, v })

  // Alignment: 1h chart, 4h bars. A 4h bar shows from the chart bar whose
  // close ends it; before any closed 4h bar there is nothing.
  const chartT = Array.from({ length: 10 }, (_, i) => i * H)
  const htfT = [0, 4 * H, 8 * H]
  eq('mtf: closed 4h bar from the chart bar that closes it; live bar shows the forming one',
    MT.alignIndex(chartT, H, htfT, 4 * H, false), [-1, -1, -1, 0, 0, 0, 0, 1, 1, 2])
  eq('mtf: wait for close keeps the live bar on the last closed bar',
    MT.alignIndex(chartT, H, htfT, 4 * H, true), [-1, -1, -1, 0, 0, 0, 0, 1, 1, 1])
  eq('mtf: values mapped by index', MT.mapAligned([10, 20, 30], [-1, 0, 0, 1, 2]), [null, 10, 10, 20, 30])
  eq('mtf: once = only on the first bar of each period', MT.mapAligned([10, 20], [0, 0, 1, 1], true), [10, null, 20, null])
  ok('mtf: applies only to a longer timeframe', MT.mtfApplies('1h', 15 * 60000) && !MT.mtfApplies('1h', H) && !MT.mtfApplies(undefined, H))
  eq('mtf: weeks open on Monday', MT.mtfBucketStart(Date.UTC(2024, 0, 3, 12), '1w'), Date.UTC(2024, 0, 1))
  const ch = Array.from({ length: 10 }, (_, i) => bar(i * H, 100 + i, 2))
  const rs = MT.resampleTo(ch, '4h')
  eq('mtf: resample folds OHLCV', rs.map((k) => [k.t, k.o, k.h, k.l, k.c, k.v]),
    [[0, 100, 103, 100, 103, 8], [4 * H, 104, 107, 104, 107, 8], [8 * H, 108, 109, 108, 109, 4]])
  // Fetched bars running past the chart (replay) are cut at the chart's
  // bucket, and the forming bucket is rebuilt from what the chart has seen.
  const ahead = [bar(0, 1), bar(4 * H, 2), { t: 8 * H, o: 1, h: 999, l: 1, c: 999, v: 99 }, bar(12 * H, 3)]
  const wf = MT.withForming(ahead, ch, '4h')
  eq('mtf: no lookahead from fetched bars', wf.map((k) => [k.t, k.h, k.c, k.v]), [[0, 1, 1, 1], [4 * H, 2, 2, 1], [8 * H, 109, 109, 4]])
  ok('mtf: bars needed covers span + warm-up, capped', MT.mtfBarsNeeded(ch, '1h') === 9 + 300 && MT.mtfBarsNeeded(ch, '1h', 300, 50) === 50)

  // computeAll with a frame: SMA(2) of 4h closes onto the 1h bars.
  const smaInst = { uid: 'a', type: 'sma', params: { length: 2 }, source: 'close', visible: true }
  const frame = { candles: rs, idx: MT.alignIndex(ch.map((k) => k.t), H, rs.map((k) => k.t), 4 * H, false) }
  const [cmp] = G.computeAll([smaInst], ch, (i) => R.indicatorDef(i.type), R.sourceSeries, () => frame)
  eq('mtf: indicator computed on the higher timeframe and aligned', cmp.outputs.v,
    [null, null, null, null, null, null, null, 105, 105, 108])

  // Store: the timeframe persists; junk and drawing indicators drop it.
  const san = S.sanitizeIndicators([
    { uid: 'x1', type: 'rsi', params: {}, source: 'close', visible: true, tf: '4h', tfWait: true },
    { uid: 'x2', type: 'rsi', params: {}, source: 'close', visible: true, tf: '7h' },
    { uid: 'x3', type: 'zigzag', params: {}, source: 'close', visible: true, tf: '1h' },
  ])
  eq('mtf: stored timeframe kept / bad dropped / not on drawings', san.map((i) => [i.tf ?? null, i.tfWait ?? null]), [['4h', true], [null, null], [null, null]])
  eq('mtf: serialized', S.serializeIndicators(san)[0].tf, '4h')

  // Trendlines: lows rising 100 → 110 → 120 every 20 bars, highs in between.
  const zz = (pts) => {
    const v = []
    for (let k = 1; k < pts.length; k++)
      for (let j = 0; j < 10; j++) v.push(pts[k - 1] + ((pts[k] - pts[k - 1]) * j) / 10)
    v.push(pts[pts.length - 1])
    return v.map((x, i) => ({ t: i * 60000, o: x, h: x, l: x, c: x, v: 1 }))
  }
  const up = zz([100, 130, 110, 140, 120, 150, 135])
  const lows = [{ i: 0, price: 100, high: false }, { i: 20, price: 110, high: false }, { i: 40, price: 120, high: false }]
  const sup = M.fitTrendline(up, lows, false, 0.5)
  ok('trend: support through three rising lows', sup && sup.a === 0 && Math.abs(sup.slope - 0.5) < 1e-9 && sup.touches === 3, sup)
  eq('trend: line extended to the last bar', M.trendSeries(up.length, sup)[up.length - 1], 100 + 0.5 * (up.length - 1))
  // A close under the line breaks it: no line through those lows survives.
  const broken = up.map((k, i) => (i === 45 ? { ...k, c: 100, l: 100 } : k))
  eq('trend: a line broken by a close is rejected', M.fitTrendline(broken, lows, false, 0.5), null)
  eq('trend: needs two pivots', M.fitTrendline(up, lows.slice(0, 1), false), null)
  const highs = [{ i: 10, price: 130, high: true }, { i: 30, price: 140, high: true }, { i: 50, price: 150, high: true }]
  const res = M.fitTrendline(up, highs, true, 0.5)
  ok('trend: resistance through rising highs', res && res.a === 10 && res.touches === 3, res)
  const at = M.autoTrendlines(up, 5, 3, 0.5)
  ok('trend: auto trendlines find both sides', at.supFit && at.resFit && at.sup[at.sup.length - 1] < at.res[at.res.length - 1], at)

  // Catalogue additions.
  const cs = Array.from({ length: 60 }, (_, i) => ({ t: i, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 10 }))
  const er = M.elderRay(cs, 13)
  ok('elder: bull = high − EMA, bear = low − EMA', er.bull[12] != null && Math.abs(er.bull[59] - er.bear[59] - 3) < 1e-9 && er.bull[11] === null)
  const mi = M.massIndex(cs, 9, 25)
  ok('mass index: constant range → sum length', Math.abs(mi[59] - 25) < 1e-9 && mi[20] === null, mi[59])
  const lin = cs.map((k) => k.c)
  eq('dpo: a straight line detrends to a constant', M.dpo(lin, 20).slice(-2), [20.5, 20.5])
  ok('coppock: rising prices → positive', M.coppock(lin, 10, 14, 11)[59] > 0 && M.coppock(lin, 10, 14, 11)[20] === null)
  const lrc = M.linregChannel(lin, 30, 2)
  ok('lr channel: fits a line exactly, zero width, only the window', Math.abs(lrc.mid[59] - 160) < 1e-9 && Math.abs(lrc.upper[59] - 160) < 1e-6 && lrc.mid[29] === null && Math.abs(lrc.mid[30] - 131) < 1e-9, lrc.mid[59])
  ;['vprofile', 'autotrend', 'lrc', 'elder', 'massindex', 'coppock', 'dpo', 'supertrend', 'ichimoku', 'keltner', 'donchian', 'vortex', 'aroon', 'uo', 'cmf', 'trix', 'hv'].forEach((id) =>
    ok('catalogue: ' + id, !!R.indicatorDef(id)))
  const vpDef = R.indicatorDef('vprofile')
  eq('vprofile: label names the range mode', R.instanceLabel(vpDef, { ...R.defaultParams(vpDef), mode: 1 }), 'Volume Profile Session/200/48/70/30')
  eq('vprofile: no value outputs', R.valueOutputs(vpDef).length, 0)
  ok('vprofile / trendlines take no timeframe', !R.takesMtf(vpDef) && !R.takesMtf(R.indicatorDef('autotrend')) && R.takesMtf(R.indicatorDef('rsi')))

  // Volume profile ranges by mode (4 bars a day).
  const times = Array.from({ length: 10 }, (_, i) => i * 6 * H)
  eq('vprofile: fixed lookback = newest bars', VP.profileRanges(times, 2, null, 3), [[7, 9]])
  eq('vprofile: visible range', VP.profileRanges(times, 0, { from: 2.4, to: 7.2 }, 0), [[2, 8]])
  eq('vprofile: sessions from the day start of the first visible bar', VP.profileRanges(times, 1, { from: 5, to: 9 }, 0), [[4, 7], [8, 9]])
}

{
  // r4-data: chart CSV export, watchlist columns, popout URL / sync, ratio quote
  const DX = await import(src('features/charts/dataExport.ts'))
  eq('csv: plain cell', DX.csvCell('RSI 14'), 'RSI 14')
  eq('csv: comma and quote escaped', DX.csvCell('MACD, "fast"'), '"MACD, ""fast"""')
  eq('csv: newline quoted', DX.csvCell('a\nb'), '"a\nb"')
  eq('csv: formula neutered', DX.csvCell('=HYPERLINK(1)'), "'=HYPERLINK(1)")
  eq('csv: negative number untouched', DX.csvCell(-1.5), '-1.5')
  eq('csv: NaN / null blank', [DX.csvCell(NaN), DX.csvCell(null), DX.csvCell(undefined)], ['', '', ''])
  eq('csv: iso utc', DX.isoAtOffset(Date.UTC(2026, 9, 31, 12, 5, 9), 0), '2026-10-31T12:05:09Z')
  eq('csv: iso +05:00', DX.isoAtOffset(Date.UTC(2026, 9, 31, 22, 0), 300), '2026-11-01T03:00:00+05:00')
  eq('csv: iso -03:30', DX.isoAtOffset(Date.UTC(2026, 9, 31, 2, 0), -210), '2026-10-30T22:30:00-03:30')
  const H = 3600000
  const bars = [2, 0, 1, 3].map((i) => ({ t: i * H, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 10 * i }))
  const csv = DX.buildChartCsv({
    bars,
    columns: [
      { label: 'SMA 2 · SMA', times: [0, H, 2 * H, 3 * H], values: [null, 1.25, 2.5, NaN] },
      // A column over a different span, out of order: joined on time.
      { label: 'X, y', times: [3 * H, H], values: [7, 6] },
    ],
    from: H,
    to: 2 * H,
  })
  const lines = csv.trim().split('\r\n')
  eq('csv: header', lines[0], 'time,open,high,low,close,volume,SMA 2 · SMA,"X, y"')
  eq('csv: range kept, sorted', lines.length, 3)
  eq('csv: row aligned by time', lines[1], '1970-01-01T01:00:00Z,1,2,0,1.5,10,1.25,6')
  eq('csv: missing value blank', lines[2], '1970-01-01T02:00:00Z,2,3,1,2.5,20,2.5,')
  const csvTz = DX.buildChartCsv({ bars: bars.slice(0, 1), offsetOf: () => 60 })
  eq('csv: chart zone offset applied', csvTz.split('\r\n')[1].split(',')[0], '1970-01-01T03:00:00+01:00')
  eq('csv: file name safe for ratios', DX.csvFileName('BTCUSDT/ETHUSDT', '1h', Date.UTC(2026, 9, 31, 17, 0)), 'BTCUSDT_ETHUSDT-1h-2026-10-31T1700.csv')

  const WC = await import(src('features/favorites/watchColumns.ts'))
  eq('wlcols: default', WC.sanitizeWatchPrefs(null), { cols: ['chg'], sort: null })
  eq('wlcols: unknown dropped, catalogue order', WC.sanitizeWatchPrefs({ cols: ['rsi', 'bogus', 'vol'] }).cols, ['vol', 'rsi'])
  eq('wlcols: sort on a hidden column dropped', WC.sanitizeWatchPrefs({ cols: ['vol'], sort: { key: 'rsi', dir: 'asc' } }).sort, null)
  eq('wlcols: valid sort kept', WC.sanitizeWatchPrefs({ cols: [], sort: { key: 'last', dir: 'asc' } }).sort, { key: 'last', dir: 'asc' })
  const tg = WC.toggleWatchCol({ cols: ['chg', 'rsi'], sort: { key: 'rsi', dir: 'desc' } }, 'rsi')
  eq('wlcols: toggle off clears its sort', tg, { cols: ['chg'], sort: null })
  eq('wlcols: toggle on', WC.toggleWatchCol({ cols: ['rsi'], sort: null }, 'vol').cols, ['vol', 'rsi'])
  let s1 = WC.nextWatchSort(null, 'vol')
  eq('wlcols: first click desc', s1, { key: 'vol', dir: 'desc' })
  s1 = WC.nextWatchSort(s1, 'vol')
  eq('wlcols: second click asc', s1, { key: 'vol', dir: 'asc' })
  eq('wlcols: third click back to list order', WC.nextWatchSort(s1, 'vol'), null)
  eq('wlcols: symbol sorts asc first', WC.nextWatchSort(null, 'sym'), { key: 'sym', dir: 'asc' })
  const vals = { A: 3, B: null, C: 5, D: 3 }
  const by = (it) => vals[it]
  eq('wlcols: sort desc, missing last, ties stable', WC.sortWatch(['A', 'B', 'C', 'D'], { key: 'vol', dir: 'desc' }, by), ['C', 'A', 'D', 'B'])
  eq('wlcols: sort asc, missing still last', WC.sortWatch(['B', 'C', 'A'], { key: 'vol', dir: 'asc' }, by), ['A', 'C', 'B'])
  eq('wlcols: strings sort', WC.sortWatch(['ETH', 'BTC'], { key: 'sym', dir: 'asc' }, (x) => x), ['BTC', 'ETH'])
  eq('wlcols: no sort keeps order', WC.sortWatch(['B', 'A'], null, by), ['B', 'A'])

  const PO = await import(src('features/charts/popoutMath.ts'))
  const qs = PO.popoutSearch({ sym: 'BTCUSDT+ETHUSDT', tf: '1h', ch: 'abc123' })
  eq('popout: round trip keeps + in a spread', PO.parsePopout(qs), { sym: 'BTCUSDT+ETHUSDT', tf: '1h', ch: 'abc123' })
  eq('popout: normal app', PO.parsePopout('?sym=BTCUSDT'), null)
  eq('popout: junk cleaned', PO.parsePopout('?popout=1&sym=<x>&tf=1h;x&ch=A!'), { sym: '', tf: '', ch: '' })
  eq('popout: sym upper-cased', PO.parsePopout('?popout=1&sym=ethusdt&tf=4h').sym, 'ETHUSDT')
  eq('popout: sync msg sym', PO.readSyncMsg({ k: 'sym', v: 'BTCUSDT/ETHUSDT' }), { k: 'sym', v: 'BTCUSDT/ETHUSDT' })
  eq('popout: sync msg tf', PO.readSyncMsg({ k: 'tf', v: '15m' }), { k: 'tf', v: '15m' })
  eq('popout: bad msgs ignored', [PO.readSyncMsg(null), PO.readSyncMsg({ k: 'x', v: 'a' }), PO.readSyncMsg({ k: 'tf', v: 'drop table' })], [null, null, null])

  const SY = await import(src('services/syntheticSymbol.ts'))
  const day = 86400000
  const sc = [
    { t: 0, o: 1, h: 1.2, l: 0.9, c: 1, v: 0 },
    { t: day / 2, o: 1, h: 1.6, l: 0.95, c: 1.5, v: 0 },
    { t: day, o: 1.5, h: 2.1, l: 1.4, c: 2, v: 0 },
  ]
  eq('synthQuote: last, 24h change and range', SY.synthQuote(sc), { last: 2, pct: 100, high: 2.1, low: 0.95 })
  eq('synthQuote: under a day has no change', SY.synthQuote(sc.slice(1)).pct, null)
  eq('synthQuote: empty', SY.synthQuote([]), null)
  eq('ratio: n/a text', typeof SY.RATIO_NA, 'string')
}

// ---------------------------------------------------------------- r4-pine2: language, drawings, security
{
  const { runPine } = await import(src('features/charts/pine/runtime.ts'))
  const S = await import(src('features/charts/pine/security.ts'))
  const BC = await import(src('features/charts/pine/barColors.ts'))
  const PI = await import(src('features/charts/pine/indicator.ts'))
  const mk = (len, step = 900_000, t0 = 1_700_000_000_000) =>
    Array.from({ length: len }, (_, i) => {
      const o = 100 + Math.sin(i / 7) * 10 + i * 0.05
      const cl = o + Math.cos(i / 3) * 2
      return { t: t0 + i * step, o, h: Math.max(o, cl) + 1, l: Math.min(o, cl) - 1, c: cl, v: 100 + (i % 9) }
    })
  const c = mk(120)
  const lastV = (p) => p.values[p.values.length - 1]
  const lc = c[c.length - 1]
  const up = lc.c > lc.o

  // ---- language ----
  const L = runPine(`indicator("lang")
type Pivot
    float price
    int bar = 7
    string kind = "high"
method double(Pivot p, float k = 2) =>
    p.price * k
var Pivot pv = Pivot.new(1.5)
pv.price := pv.price + 1
q = Pivot.new(kind = "low", price = 3)
s = switch
    close > open => 1
    => -1
k = switch s
    1 => "up"
    -1 => "down"
    => "?"
x = if close > open
    10
else if close < open
    20
else
    30
var a = array.new_float()
array.push(a, bar_index)
tot = 0
for v in a
    if v % 2 == 1
        continue
    tot += 1
    if tot >= 5
        break
cnt = 0
for [i, v] in a
    cnt += i
f(a, b = 2) => a * b
plot(pv.double(), "m")
plot(pv.double(k = 10), "m10")
plot(q.bar, "qbar")
plot(q.kind == "low" ? 1 : 0, "qkind")
plot(s, "s")
plot(k == "up" ? 1 : k == "down" ? -1 : 0, "k")
plot(x, "x")
plot(tot, "tot")
plot(cnt, "cnt")
plot(f(3), "f3")
plot(f(3, b = 5), "f35")
plot(str.length(str.format("{0}|{1,number,#.##}", "ab", 1.2345)), "fmt")`, c)
  const P = Object.fromEntries(L.plots.map((p) => [p.title, lastV(p)]))
  eq('pine2: type fields, := and a method with a default', [P.m, P.m10], [(1.5 + 120) * 2, (1.5 + 120) * 10])
  eq('pine2: Type.new by name with field defaults', [P.qbar, P.qkind], [7, 1])
  eq('pine2: switch without and with a subject', [P.s, P.k], [up ? 1 : -1, up ? 1 : -1])
  eq('pine2: if as an expression', P.x, up ? 10 : lc.c < lc.o ? 20 : 30)
  eq('pine2: for…in with continue/break', P.tot, 5)
  eq('pine2: for [i, v] in', P.cnt, (119 * 120) / 2)
  eq('pine2: default and named function arguments', [P.f3, P.f35], [6, 15])
  eq('pine2: str.format with a number pattern', P.fmt, 'ab|1.23'.length)
  const bad = (() => {
    try {
      runPine('type P\n    float a\np = P.new(1)\nplot(p.b)', c)
    } catch (e) {
      return e.message
    }
  })()
  ok('pine2: unknown field is a located error', /Line 4.*no field 'b'/.test(bad || ''), bad)

  // ---- drawings ----
  const D = runPine(`indicator("d", overlay=true, max_labels_count=3)
label.new(bar_index, na, "L" + str.tostring(bar_index), yloc=yloc.abovebar, style=label.style_label_down)
var line ln = na
var box bx = na
if barstate.islast
    ln := line.new(bar_index - 10, low, bar_index, high, extend=extend.right, color=color.red)
    ln.set_width(3)
    line.set_y1(ln, 50)
    bx := box.new(bar_index - 5, high, bar_index + 5, low, bgcolor=color.new(color.green, 80), text="B")
    tmp = line.new(time, 1, time, 2, xloc=xloc.bar_time)
    line.delete(tmp)
var tb = table.new(position.top_right, 3, 3, border_width=1)
if barstate.islast
    table.cell(tb, 0, 0, "Close", bgcolor=color.gray)
    table.cell(tb, 1, 0, str.tostring(close, "#.##"))
plot(array.size(label.all), "nl")
plot(line.get_price(ln, bar_index - 5), "lp")`, c)
  const dr = D.drawings
  eq('pine2: max_labels_count keeps the newest labels', dr.labels.map((l) => l.text), ['L117', 'L118', 'L119'])
  eq('pine2: yloc.abovebar sits on the bar high', [dr.labels[2].y, dr.labels[2].t], [lc.h, lc.t])
  eq('pine2: line.new + set_* (xloc bar_index → time)', [dr.lines.length, dr.lines[0].t1, dr.lines[0].y1, dr.lines[0].width, dr.lines[0].extend], [1, c[109].t, 50, 3, 'right'])
  eq('pine2: a box past the last bar gets a future time', dr.boxes[0].t2, lc.t + 5 * 900_000)
  eq('pine2: table trimmed to its filled cells', [dr.tables[0].rows, dr.tables[0].columns, dr.tables[0].cells[0][1].text], [1, 2, String(Math.round(lc.c * 100) / 100)])
  eq('pine2: label.all counts live labels', lastV(D.plots[0]), 3)
  near('pine2: line.get_price interpolates', lastV(D.plots[1]), 50 + ((lc.h - 50) * 5) / 10, 1e-9)
  eq('pine2: drawing calls no longer warn', D.warnings, [])

  // ---- bgcolor / barcolor / fill colours ----
  const B = runPine(`indicator("b", overlay=true)
bgcolor(close > open ? color.new(color.green, 90) : na, offset=1)
barcolor(close > open ? color.lime : na)
p1 = plot(close)
p2 = plot(open)
fill(p1, p2, color = close > open ? color.green : color.red)`, c)
  const ups = c.map((k) => k.c > k.o)
  eq('pine2: bgcolor offset shifts a bar right', B.bgcolors.map(Boolean), [false, ...ups.slice(0, -1)])
  eq('pine2: barcolor per bar, na = chart colour', B.barcolors.map(Boolean), ups)
  ok('pine2: fill keeps per-bar colours', B.fills[0].colors.length === c.length && B.fills[0].colors.some(Boolean), B.fills[0].colors?.length)

  BC.setPineBarColors(new Map([[c[1].t, '#ff0000']]))
  const items = [{ time: c[0].t / 1000, open: 1, close: 2 }, { time: c[1].t / 1000, open: 2, close: 1 }]
  eq('pine2: bar colours applied to candle data only on their bars', BC.withPineBarColors(items, 'candle').map((d) => d.color), [undefined, '#ff0000'])
  eq('pine2: line styles take no bar colours', BC.withPineBarColors(items, 'line'), items)
  BC.setPineBarColors(new Map())

  // ---- request.security ----
  eq('pine2: timeframe spellings', ['60', '1H', 'D', '1D', '3D', 'W', '30S', 'x', ''].map(S.normTf), ['60', '60', 'D', 'D', '3D', 'W', '30S', null, null])
  eq('pine2: app interval ids', ['60', '240', '45', 'D', 'W', 'M', '1440'].map(S.appTf), ['1h', '4h', '45m', '1d', '1w', '1M', '1d'])
  eq('pine2: symbols lose the exchange prefix', S.normSymbol('BINANCE:ethusdt'), 'ETHUSDT')
  // Chart 15m bars, requested 1h bars on the same clock.
  const ch = Array.from({ length: 10 }, (_, i) => ({ t: i * 15 }))
  const hr = Array.from({ length: 3 }, (_, j) => ({ t: j * 60 }))
  eq('pine2: no lookahead — value lands where the hour closes; last bar sees the forming hour', Array.from(S.alignSecurity(ch, hr, 60)), [-1, -1, -1, 0, 0, 0, 0, 1, 1, 2])
  eq('pine2: lookahead_on — the hour the bar opens in', Array.from(S.alignSecurity(ch, hr, 60, true)), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2])
  eq('pine2: gaps_on — only where a value first appears', Array.from(S.alignSecurity(ch, hr, 60, false, true)), [-1, -1, -1, 0, -1, -1, -1, 1, -1, 2])
  const sec = `indicator("s")
plot(request.security("BINANCE:BTCUSDT", "60", close), "same sym")
plot(request.security(syminfo.tickerid, "15", close), "chart")
plot(request.security("ETHUSDT", "60", ta.sma(close, 2)), "eth")`
  const opt = { ticker: 'BTCUSDT', period: '15' }
  const r1 = runPine(sec, c, {}, opt)
  eq('pine2: missing bars are reported, not fetched', r1.securityNeeds.map((x) => x.key), ['BTCUSDT|60', 'ETHUSDT|60'])
  eq('pine2: the chart\'s own symbol/interval needs nothing', lastV(r1.plots[1]), lc.c)
  const htf = mk(40, 3_600_000)
  const r2 = runPine(sec, c, {}, { ...opt, security: { 'BTCUSDT|60': htf, 'ETHUSDT|60': htf } })
  eq('pine2: nothing missing once the bars are given', r2.securityNeeds, undefined)
  const v = r2.plots[0].values
  eq('pine2: hourly close appears at the hour\'s last 15m bar', [v[2], v[3], v[6], v[7]], [null, htf[0].c, htf[0].c, htf[1].c])
  const e = r2.plots[2].values
  near('pine2: expression evaluated on the requested bars', e[7], (htf[0].c + htf[1].c) / 2, 1e-9)
  eq('pine2: no value before the requested series has one', e[3], null)

  // ---- page side: a script that only draws gets a carrier series ----
  const def = PI.pineLive({ uid: 'r4pi-bg', type: 'pine', script: 'indicator("bg", overlay=true)\nbgcolor(color.red)' }, c)
  eq('pine2: draw-only script has an invisible carrier output', def.outputs.map((o) => o.key + ':' + o.kind), ['draw:signal'])
  eq('pine2: its run is kept for the drawing layer', PI.pineDrawState('r4pi-bg').result.bgcolors.length, c.length)
  PI.forgetPine('r4pi-bg')
}

console.log('\n' + pass + ' passed, ' + fails.length + ' failed')
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL  ' + f))
  process.exit(1)
}
console.log('engines OK')
