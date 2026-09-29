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

const { ProviderChain, klineFreshness } = await import(src('services/providerChain.ts'))
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
  eq('fmt: non-finite is a dash, never NaN', pfmt(NaN), '—')
  eq('fmt: infinity is a dash', nfmt(Infinity), '—')
  eq('fmtUsd: thousands', fmtUsd(1500), '1.5K')
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
  const defOf = (t) => defs[t] || null
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

console.log('\n' + pass + ' passed, ' + fails.length + ' failed')
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL  ' + f))
  process.exit(1)
}
console.log('engines OK')
