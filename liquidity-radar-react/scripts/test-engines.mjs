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
const alerts = await import(src('features/alerts/rules.ts'))
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

console.log('\n' + pass + ' passed, ' + fails.length + ' failed')
if (fails.length) {
  fails.forEach((f) => console.log('  FAIL  ' + f))
  process.exit(1)
}
console.log('engines OK')
