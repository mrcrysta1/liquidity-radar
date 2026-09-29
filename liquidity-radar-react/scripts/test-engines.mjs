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
const { bucketIndex, bucketEnd, resample, tfDef, normalizeTf, TIMEFRAMES } =
  await import(src('services/timeframe.ts'))
const { noteLimitResponse, cooldownLeft, isRateLimited } = await import(src('api/rateLimit.ts'))
const { pfmt, nfmt, cfmt } = await import(src('utils/format.ts'))
const { VENUES, isUsdQuoted } = await import(src('features/advanced/venues.ts'))
const { groupAggTrades, autoThreshold, bubbleRadius } = await import(
  src('features/whales/whaleMath.ts')
)
const { buildVolumeProfile, computeVolumeProfile, clampRows, clampValueArea } = await import(
  src('features/charts/volumeProfile.ts')
)

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
