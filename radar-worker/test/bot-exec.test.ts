import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Futures, RATE_LIMIT, RateLimitError, SETUP_NON_FATAL, TESTNET, TESTNET_BASES, assertTestnetBase, roundStep, roundTick, sign, usdtEquity } from '../src/bot/futures.ts'
import { DEFAULT_RISK, checkLimits, heatCheck, size } from '../src/bot/risk.ts'

test('request signing matches Binance’s published example', () => {
  const q = 'symbol=BTCUSDT&side=BUY&type=LIMIT&quantity=1&price=9000&timeInForce=GTC&recvWindow=5000&timestamp=1591702613943'
  assert.equal(sign(q, '2b5eb11e18796d12d88f13dc27dbbd02c2cc51ff7059765ed9821957d82bb4d9'), '3c661234138461fcc7a7d8746c6558c9842d4e10870d2ecbedf7777cad694af9')
})

test('testnet-only guard: only the exact testnet base URLs are accepted', () => {
  // Allowed (a trailing slash or surrounding spaces are tolerated).
  for (const ok of [TESTNET, ...TESTNET_BASES, 'https://demo-fapi.binance.com/', ' https://testnet.binancefuture.com ']) {
    const f = new Futures('k', 's', ok)
    assert.ok(f.isTestnet)
    assert.ok(TESTNET_BASES.includes(f.base))
  }
  assert.equal(new Futures('k', 's').base, TESTNET, 'default is the testnet')
  // Everything else is refused, and there is no override any more.
  process.env.ALLOW_MAINNET = 'yes'
  try {
    for (const bad of [
      'https://fapi.binance.com',
      'https://fapi.binance.com/',
      'https://dapi.binance.com',
      'https://api.binance.com',
      'http://demo-fapi.binance.com',
      'https://demo-fapi.binance.com.evil.example',
      'https://demo-fapi.binance.com@fapi.binance.com',
      'https://demo-fapi.binance.com/fapi',
      'https://DEMO-FAPI.binance.com',
      'https://testnet.binancefuture.com:8443',
      '',
    ])
      assert.throws(() => new Futures('k', 's', bad), /Refusing to start/, bad)
    assert.throws(() => assertTestnetBase(undefined), /Refusing to start/)
  } finally {
    delete process.env.ALLOW_MAINNET
  }
})

test('testnet-only guard: requests never go to a base that was changed after start', async () => {
  const f = new Futures('k', 's')
  ;(f as unknown as { base: string }).base = 'https://fapi.binance.com'
  const real = globalThis.fetch
  let called = 0
  globalThis.fetch = (async () => {
    called++
    return new Response('{}')
  }) as typeof fetch
  try {
    await assert.rejects(() => f.request('GET', '/fapi/v1/time', {}, false), /Refusing to start/)
    assert.equal(called, 0, 'nothing was sent')
  } finally {
    globalThis.fetch = real
  }
})

test('a -1021 clock rejection re-syncs and retries once; stamps stay behind server time', async () => {
  const real = globalThis.fetch
  const serverSkew = -1500 // the exchange clock runs 1.5s behind this machine
  let rejected = 0
  const stamps: number[] = []
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url)
    const now = Date.now() + serverSkew
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: now }))
    const ts = Number(u.searchParams.get('timestamp'))
    stamps.push(ts - now)
    if (rejected === 0) {
      rejected++
      return new Response(JSON.stringify({ code: -1021, msg: 'Timestamp for this request was 1000ms ahead' }), { status: 400 })
    }
    return new Response(JSON.stringify(acct('5000', '0')))
  }) as typeof fetch
  try {
    const f = new Futures('k', 's')
    assert.equal(await f.balanceUsdt(), 5000)
    assert.equal(rejected, 1, 'first attempt was rejected, the retry went through')
    assert.ok(stamps.every((d) => d < 0), 'every stamp is behind server time: ' + stamps.join(','))
  } finally {
    globalThis.fetch = real
  }
})

test('setup: margin type that cannot change (-4048, -4047, -4067) or is already set (-4046) is not fatal; other errors are', async () => {
  const real = globalThis.fetch
  const quiet = console.warn
  console.warn = () => {}
  let code = -4048
  const calls: string[] = []
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url)
    assert.ok(TESTNET_BASES.includes(u.origin), 'only the testnet is called')
    calls.push(u.pathname)
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: Date.now() }))
    if (u.pathname === '/fapi/v1/marginType') return new Response(JSON.stringify({ code, msg: 'margin type' }), { status: 400 })
    return new Response(JSON.stringify({ leverage: 3, symbol: 'BTCUSDT' }))
  }) as typeof fetch
  try {
    const f = new Futures('k', 's')
    for (code of [-4048, -4047, -4067, -4046]) {
      calls.length = 0
      await f.setup('BTCUSDT', 3)
      assert.ok(calls.includes('/fapi/v1/leverage'), `leverage still set after ${code}`)
    }
    code = -1102
    await assert.rejects(f.setup('BTCUSDT', 3), /-1102/)
  } finally {
    globalThis.fetch = real
    console.warn = quiet
  }
})

test('setup: reads the current mode first and changes only what differs (no -4067 when already set)', async () => {
  const real = globalThis.fetch
  const quiet = console.warn
  console.warn = () => {}
  const posts: string[] = []
  let marginType = 'isolated'
  let lev = '3'
  let dual = false
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    assert.ok(TESTNET_BASES.includes(u.origin), 'only the testnet is called')
    const method = init?.method ?? 'GET'
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: Date.now() }))
    if (method === 'POST') {
      posts.push(u.pathname)
      // Any mode change is refused the way the testnet refuses it with open orders.
      if (u.pathname !== '/fapi/v1/leverage')
        return new Response(JSON.stringify({ code: -4067, msg: 'Position side cannot be changed if there exists open orders.' }), { status: 400 })
      return new Response(JSON.stringify({ leverage: 3 }))
    }
    if (u.pathname === '/fapi/v1/positionSide/dual') return new Response(JSON.stringify({ dualSidePosition: dual }))
    if (u.pathname === '/fapi/v2/positionRisk')
      return new Response(JSON.stringify([{ symbol: u.searchParams.get('symbol'), positionSide: 'BOTH', marginType, leverage: lev, positionAmt: '0' }]))
    return new Response('{}')
  }) as typeof fetch
  try {
    // Already one-way, isolated, 3x: nothing is changed at all.
    await new Futures('k', 's').setup('BTCUSDT', 3)
    assert.deepEqual(posts, [], 'no change requests when the account is already set up')
    // Cross margin and 5x with open orders: -4067 on the margin change is tolerated, leverage still set.
    marginType = 'cross'
    lev = '5'
    posts.length = 0
    await new Futures('k', 's').setup('BTCUSDT', 3)
    assert.deepEqual(posts, ['/fapi/v1/marginType', '/fapi/v1/leverage'])
    // Hedge mode that cannot switch (-4067): not fatal either; checked once per process.
    dual = true
    marginType = 'isolated'
    lev = '3'
    posts.length = 0
    const f = new Futures('k', 's')
    await f.setup('BTCUSDT', 3)
    await f.setup('ETHUSDT', 3)
    assert.deepEqual(posts, ['/fapi/v1/positionSide/dual'], 'position mode tried once, nothing else changed')
  } finally {
    globalThis.fetch = real
    console.warn = quiet
  }
})

test('setup: the non-fatal codes are exactly the "already so / cannot change now" ones', () => {
  for (const c of [-4046, -4059, -4047, -4048, -4067, -4068]) assert.ok(SETUP_NON_FATAL.includes(c), String(c))
  assert.ok(!SETUP_NON_FATAL.includes(-1102))
  assert.ok(!SETUP_NON_FATAL.includes(-2015))
})

/** A /fapi/v2/account response: the USDT asset row and the positions (symbol, positionAmt, unrealizedProfit). */
function acct(wallet: string | undefined, upnl: string | undefined, positions: Array<[string, string, string | undefined]> = [], more: Record<string, unknown> = {}) {
  return {
    totalWalletBalance: wallet,
    totalUnrealizedProfit: upnl,
    assets: [
      { asset: 'BNB', walletBalance: '2', unrealizedProfit: '0' },
      { asset: 'USDT', walletBalance: wallet, unrealizedProfit: upnl, crossUnPnl: '0' },
    ],
    positions: [
      { symbol: 'ETHUSDT', positionAmt: '0', unrealizedProfit: '0', isolated: true },
      ...positions.map(([symbol, positionAmt, unrealizedProfit]) => ({ symbol, positionAmt, unrealizedProfit, isolated: true })),
    ],
    ...more,
  }
}

test('balanceUsdt: reads /fapi/v2/account; a missing USDT row reads as null (unknown), not 0', async () => {
  const real = globalThis.fetch
  let body: unknown = { assets: [{ asset: 'BNB', walletBalance: '2', unrealizedProfit: '0' }], positions: [] }
  const paths: string[] = []
  globalThis.fetch = (async (url: string) => {
    const u = new URL(url)
    assert.ok(TESTNET_BASES.includes(u.origin), 'only the testnet is called')
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: Date.now() }))
    paths.push(u.pathname)
    return new Response(JSON.stringify(body))
  }) as typeof fetch
  try {
    const f = new Futures('k', 's')
    assert.equal(await f.balanceUsdt(), null)
    body = acct('oops', '0')
    assert.equal(await f.balanceUsdt(), null)
    body = acct('4000', '-50', [['BTCUSDT', '0.01', '-50']])
    assert.equal(await f.balanceUsdt(), 3950)
    assert.ok(paths.every((x) => x === '/fapi/v2/account'), paths.join(','))
  } finally {
    globalThis.fetch = real
  }
})

test('usdtEquity: wallet + unrealized P&L of every USDT position, isolated included, counted once', () => {
  // Realized only (no open position): the wallet, as before.
  assert.equal(usdtEquity(acct('10000', '0')), 10_000)
  // An isolated loser: the old /fapi/v2/balance read (crossUnPnl 0) missed it.
  assert.equal(usdtEquity(acct('10000', '-300', [['BTCUSDT', '0.05', '-300']])), 9_700)
  // A cross winner and an isolated loser: each once (the asset figure already sums both).
  const mixed = acct('10000', '-200', [['BTCUSDT', '0.05', '-300'], ['SOLUSDT', '-3', '100']])
  ;(mixed.positions[2] as Record<string, unknown>).isolated = false
  assert.equal(usdtEquity(mixed), 9_800)
  // Other margin assets and their positions do not count.
  assert.equal(usdtEquity(acct('10000', '-300', [['BTCUSDT', '0.05', '-300'], ['BTCUSDC', '0.1', '-999']])), 9_700)
  // The legacy field spelling is read too.
  const legacy = acct('10000', '-300', [])
  ;(legacy.positions as Array<Record<string, unknown>>).push({ symbol: 'XRPUSDT', positionAmt: '10', unRealizedProfit: '-300' })
  assert.equal(usdtEquity(legacy), 9_700)
})

test('usdtEquity: missing, NaN or inconsistent figures read as null (unknown)', () => {
  for (const bad of [
    null,
    'nope',
    [],
    { assets: [] },
    acct(undefined, '0'),
    acct('10000', undefined),
    acct('10000', ''),
    acct('NaN', '0'),
    acct('10000', 'Infinity'),
    // A position whose P&L cannot be read.
    acct('10000', '-300', [['BTCUSDT', '0.05', undefined]]),
    acct('10000', '-300', [['BTCUSDT', '0.05', 'oops']]),
    acct('10000', '0', [['BTCUSDT', 'x', '0']]),
    // Positions losing 300 but the asset row says 0: not trusted.
    acct('10000', '0', [['BTCUSDT', '0.05', '-300']]),
    acct('10000', '-300', [], { positions: undefined }),
  ])
    assert.equal(usdtEquity(bad), null, JSON.stringify(bad))
  // Rounding in the exchange's figures is tolerated.
  assert.ok(Math.abs(usdtEquity(acct('10000', '-300.004', [['BTCUSDT', '0.05', '-100.001'], ['ETHUSDT', '1', '-200.002']]))! - 9_699.996) < 1e-9)
})

test('an isolated losing position counts toward the daily loss limit and the drawdown kill switch', () => {
  const day1 = Date.UTC(2026, 0, 1, 1)
  const fresh = { day: '', dayStartEquity: 0, peakEquity: 0, halted: false, haltReason: '' }
  const r = { ...DEFAULT_RISK, maxDailyLoss: 0.045, maxDrawdown: 0.22 }
  let { state } = checkLimits(fresh, usdtEquity(acct('10000', '0')), day1, r)
  // Wallet untouched (nothing realized), but the open isolated position is down 5%.
  const losing = usdtEquity(acct('10000', '-500', [['BTCUSDT', '0.1', '-500']]))
  assert.equal(losing, 9_500)
  const d = checkLimits(state, losing, day1 + 3_600_000, r)
  assert.equal(d.canEnter, false)
  assert.match(d.reason, /daily loss limit: down 5\.00% today/)
  // The next day the daily halt lifts; a 23% open loss from the peak trips the drawdown switch.
  ;({ state } = checkLimits(d.state, 10_000, day1 + 86_400_000, r))
  assert.equal(state.halted, false)
  const deep = checkLimits(state, usdtEquity(acct('10000', '-2300', [['BTCUSDT', '0.1', '-2300']])), day1 + 90_000_000, r)
  assert.equal(deep.canEnter, false)
  assert.match(deep.reason, /drawdown kill switch: 23\.0% below peak/)
  // An unreadable P&L: null → entries paused, nothing tripped.
  const unknown = checkLimits(state, usdtEquity(acct('10000', '-2300', [['BTCUSDT', '0.1', undefined]])), day1 + 90_000_000, r)
  assert.equal(unknown.canEnter, false)
  assert.match(unknown.reason, /balance unavailable/)
  assert.equal(unknown.state.halted, false)
  // Sizing follows the lower equity: 0.75% of 9 500, not of 10 000.
  const btcRules = { tickSize: 0.1, stepSize: 0.001, minQty: 0.001, minNotional: 100, pricePrecision: 1, quantityPrecision: 3 }
  const sz = size(losing!, 80_000, 1_000, btcRules, { ...r, riskPerTrade: 0.0075, minMarginUsd: 0 })
  assert.ok(sz.riskUsd <= 9_500 * 0.0075 + 1e-9 && sz.riskUsd > 70, String(sz.riskUsd))
})

test('an unknown balance blocks new entries for that tick without tripping the drawdown kill switch', () => {
  const day1 = Date.UTC(2026, 0, 1, 12)
  let { state } = checkLimits({ day: '', dayStartEquity: 0, peakEquity: 0, halted: false, haltReason: '' }, 10_000, day1, DEFAULT_RISK)
  const before = { ...state }
  const r = checkLimits(state, null, day1 + 60_000, DEFAULT_RISK)
  assert.equal(r.canEnter, false, 'no entry while the limits cannot be checked')
  assert.match(r.reason, /balance unavailable/)
  assert.deepEqual(r.state, before, 'state untouched: not halted, peak and day kept')
  assert.equal(r.state.halted, false)
  assert.equal(checkLimits(state, NaN, day1 + 60_000, DEFAULT_RISK).canEnter, false)
  // Once the balance reads again, entries resume.
  assert.equal(checkLimits(state, 10_000, day1 + 90_000, DEFAULT_RISK).canEnter, true)
  // A real 0 is still a real loss.
  assert.equal(checkLimits(state, 0, day1 + 60_000, DEFAULT_RISK).canEnter, false)
  // An existing halt stays in force while the balance is unknown.
  ;({ state } = checkLimits(state, 8_000, day1 + 120_000, DEFAULT_RISK))
  assert.equal(checkLimits(state, null, day1 + 180_000, DEFAULT_RISK).canEnter, false)
})

test('rounding follows exchange steps', () => {
  assert.equal(roundStep(0.123456, 0.001, 3), '0.123')
  assert.equal(roundStep(0.3, 0.1, 1), '0.3', 'no float drift below the step')
  assert.equal(roundTick(84012.37, 0.1, 1), '84012.4')
})

const btc = { tickSize: 0.1, stepSize: 0.001, minQty: 0.001, minNotional: 100, pricePrecision: 1, quantityPrecision: 3 }

test('size risks the configured fraction, capped by notional', () => {
  const s = size(10_000, 80_000, 1_200, btc, DEFAULT_RISK)
  // $50 risk / $1200 stop = 0.0416 → 0.041
  assert.equal(s.qty, '0.041')
  assert.ok(s.riskUsd <= 50)
  const capped = size(10_000, 80_000, 10, btc, DEFAULT_RISK) // tiny stop → huge size
  assert.ok(Number(capped.qty) * 80_000 <= 20_000 + 1e-6, 'notional cap holds')
  const tooSmall = size(100, 80_000, 1_200, btc, DEFAULT_RISK)
  assert.equal(tooSmall.qty, '0')
  assert.match(tooSmall.reason!, /minimum/)
})

test('every trade uses at least the minimum margin ($100), within twice the normal risk', () => {
  // 5,000 USDT account, BTC at 80,000, a 10% stop: risk sizing alone gives
  // 0.003 BTC ($240 notional, $80 margin at 3x) — under the $100 floor.
  const wide = size(5_000, 80_000, 8_000, btc, DEFAULT_RISK)
  assert.equal(wide.qty, '0.004') // $320 notional → $106.67 margin
  assert.ok((Number(wide.qty) * 80_000) / DEFAULT_RISK.leverage >= 100)
  assert.ok(wide.riskUsd <= 5_000 * DEFAULT_RISK.riskPerTrade * 2)
  // A normal stop already sizes far above the floor and is left alone.
  assert.equal(size(5_000, 80_000, 1_800, btc, DEFAULT_RISK).qty, '0.013')
  // Turning the floor off restores pure risk sizing.
  assert.equal(size(5_000, 80_000, 8_000, btc, { ...DEFAULT_RISK, minMarginUsd: 0 }).qty, '0.003')
})

test('daily loss halts until the next UTC day; drawdown halts for good', () => {
  const day1 = Date.UTC(2026, 0, 1, 12)
  let { state, canEnter } = checkLimits({ day: '', dayStartEquity: 0, peakEquity: 0, halted: false, haltReason: '' }, 10_000, day1, DEFAULT_RISK)
  assert.ok(canEnter)
  ;({ state, canEnter } = checkLimits(state, 9_650, day1 + 3600_000, DEFAULT_RISK))
  assert.equal(canEnter, false)
  assert.match(state.haltReason, /daily/)
  ;({ state, canEnter } = checkLimits(state, 9_650, day1 + 86_400_000, DEFAULT_RISK))
  assert.ok(canEnter, 'lifted the next day')
  ;({ state, canEnter } = checkLimits(state, 8_400, day1 + 2 * 86_400_000, DEFAULT_RISK))
  assert.equal(canEnter, false)
  assert.match(state.haltReason, /drawdown/)
  ;({ state, canEnter } = checkLimits(state, 8_400, day1 + 3 * 86_400_000, DEFAULT_RISK))
  assert.equal(canEnter, false, 'drawdown halt does not lift by itself')
})

test('portfolio heat: three 0.5% trades fit one side, the fourth does not; the total cap counts both sides', () => {
  const r = { ...DEFAULT_RISK, maxSideRisk: 0.015, maxTotalRisk: 0.02 }
  const eq = 10_000
  assert.equal(heatCheck({ long: 100, short: 0 }, 1, 50, eq, r), null, 'third long fits exactly')
  assert.match(heatCheck({ long: 150, short: 0 }, 1, 50, eq, r)!, /^portfolio heat: long risk 1\.50% open \+ 0\.50% > 1\.50% cap/)
  assert.equal(heatCheck({ long: 150, short: 0 }, -1, 50, eq, r), null, 'the other side is separate')
  assert.match(heatCheck({ long: 100, short: 100 }, -1, 50, eq, r)!, /^portfolio heat: total risk 2\.00% open/)
  assert.equal(heatCheck({ long: 0, short: 0 }, 1, 1e9, eq, DEFAULT_RISK), null, 'no caps set → never blocks')
  assert.match(heatCheck({ long: 0, short: 0 }, 1, 50, 0, r)!, /equity unknown/)
})

test('cancel-all and the open-order reads surface failures instead of swallowing them', async () => {
  const real = globalThis.fetch
  let algoBody: unknown = { code: -1000, msg: 'odd' }
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: Date.now() }))
    if (init?.method === 'DELETE') return new Response(JSON.stringify({ code: -1001, msg: 'Internal error' }), { status: 400 })
    if (u.pathname === '/fapi/v1/openAlgoOrders') return new Response(JSON.stringify(algoBody))
    if (u.pathname === '/fapi/v1/openOrders') return new Response(JSON.stringify(u.searchParams.get('symbol') ? {} : []))
    return new Response('{}')
  }) as typeof fetch
  try {
    const f = new Futures('k', 's')
    await assert.rejects(f.cancelAllOrders('BTCUSDT'), /-1001/)
    await assert.rejects(f.cancelAllAlgo('BTCUSDT'), /-1001/)
    // An answer that is not a list is not "no orders".
    await assert.rejects(f.openAlgo('BTCUSDT'), /unexpected response/)
    await assert.rejects(f.openOrders('BTCUSDT'), /unexpected response/)
    assert.deepEqual(await f.openOrders(), [], 'all symbols: as before')
    algoBody = { orders: [{ algoId: 1, orderType: 'STOP_MARKET' }] }
    assert.equal((await f.openAlgo('BTCUSDT')).length, 1)
  } finally {
    globalThis.fetch = real
  }
})

// ---- rate limits (429 / 418 / -1003, X-MBX-USED-WEIGHT-1M), with a fake fetch and a fake clock ----

/** A client on a fake clock whose sleeps only advance it; `answer` decides each response (time sync is answered here). */
function limitedClient(answer: (path: string, method: string) => Response) {
  const real = globalThis.fetch
  const quiet = console.warn
  const warns: string[] = []
  console.warn = (m: string) => void warns.push(m)
  let clock = Date.UTC(2026, 10, 5, 12, 0, 10)
  const sleeps: number[] = []
  const calls: string[] = []
  const urls: string[] = []
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url)
    if (u.pathname === '/fapi/v1/time') return new Response(JSON.stringify({ serverTime: Date.now() }))
    calls.push((init?.method ?? 'GET') + ' ' + u.pathname)
    urls.push(url)
    return answer(u.pathname, init?.method ?? 'GET')
  }) as typeof fetch
  const f = new Futures('the-key', 'the-secret', TESTNET, {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms)
      clock += ms
    },
    random: () => 0.5,
  })
  const restore = () => {
    globalThis.fetch = real
    console.warn = quiet
  }
  return { f, sleeps, calls, urls, warns, restore, advance: (ms: number) => (clock += ms) }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })
const tooMany = (headers: Record<string, string> = {}) => json({ code: -1003, msg: 'Too many requests; current limit is 2400 request weight per 1 MINUTE.' }, 429, headers)

test('rate limit: a read answered 429 with Retry-After waits that long, then succeeds', async () => {
  let n = 0
  const c = limitedClient(() => (n++ === 0 ? tooMany({ 'Retry-After': '7' }) : json([])))
  try {
    assert.deepEqual(await c.f.positions(), [])
    assert.deepEqual(c.calls, ['GET /fapi/v2/positionRisk', 'GET /fapi/v2/positionRisk'])
    assert.deepEqual(c.sleeps, [7000], 'waited exactly Retry-After')
    assert.equal(c.warns.length, 1)
  } finally {
    c.restore()
  }
})

test('rate limit: without Retry-After the back-off doubles (with jitter); reads give up after a bounded number of attempts', async () => {
  const c = limitedClient(() => tooMany())
  try {
    await assert.rejects(c.f.positions(), (e: Error) => e instanceof RateLimitError && /GET \/fapi\/v2\/positionRisk: Too many requests/.test(e.message))
    assert.equal(c.calls.length, RATE_LIMIT.getAttempts)
    assert.deepEqual(c.sleeps, [750, 1500], 'jittered 1 s, then 2 s')
  } finally {
    c.restore()
  }
})

test('rate limit: an order answered 429 is not resent, and the error says so', async () => {
  const c = limitedClient((_path, method) => (method === 'POST' ? tooMany({ 'Retry-After': '2' }) : json([])))
  try {
    await assert.rejects(c.f.marketOrder('BTCUSDT', 'BUY', '0.01', false, 'rb-in-1'), (e: Error) => e instanceof RateLimitError && /not resent/.test(e.message))
    await assert.rejects(c.f.bracketLeg('BTCUSDT', 'SELL', 'STOP_MARKET', '90', 'rb-sl-1'), /-1003/)
    assert.deepEqual(c.calls, ['POST /fapi/v1/order', 'POST /fapi/v1/algoOrder'], 'each write sent once')
    // The next request waits out the back-off before it goes.
    await c.f.positions()
    assert.ok(c.sleeps.length >= 1)
  } finally {
    c.restore()
  }
})

test('rate limit: a 418 ban pauses every request for Retry-After, logged once; afterwards requests go again', async () => {
  let banned = true
  const c = limitedClient(() => (banned ? json({ code: -1003, msg: 'Way too many requests; IP banned until 1762344000000.' }, 418, { 'Retry-After': '120' }) : json([])))
  try {
    await assert.rejects(c.f.positions(), (e: Error) => e instanceof RateLimitError && (e as RateLimitError).status === 418)
    assert.equal(c.calls.length, 1, 'a ban is not retried')
    banned = false
    for (const call of [() => c.f.positions(), () => c.f.marketOrder('BTCUSDT', 'SELL', '0.01', true, 'rb-flat-1'), () => c.f.openAlgo('BTCUSDT')])
      await assert.rejects(call(), /IP banned by the exchange for \d+s more/)
    assert.equal(c.calls.length, 1, 'nothing sent during the ban')
    assert.equal(c.warns.filter((w) => /418/.test(w)).length, 1, 'logged once')
    c.advance(121_000)
    assert.deepEqual(await c.f.positions(), [])
    assert.equal(c.calls.length, 2)
  } finally {
    c.restore()
  }
})

test('rate limit: above the weight threshold only deferrable reads wait for the next minute', async () => {
  const c = limitedClient(() => json([], 200, { 'X-MBX-USED-WEIGHT-1M': '2100' }))
  try {
    await c.f.positions()
    assert.equal(c.f.usedWeight, 2100)
    assert.deepEqual(c.sleeps, [])
    await c.f.positions()
    await c.f.openAlgo('BTCUSDT')
    assert.deepEqual(c.sleeps, [], 'positions and stops never wait')
    await c.f.account()
    assert.equal(c.sleeps.length, 1, 'the account read waited')
    assert.ok(c.sleeps[0] > 0 && c.sleeps[0] <= 60_500, 'into the next minute: ' + c.sleeps[0])
  } finally {
    c.restore()
  }
})

test('errors carry the reason, never the key, secret or signature', async () => {
  const c = limitedClient(() => json({ code: -2019, msg: 'Margin is insufficient.' }, 400))
  try {
    const e = await c.f.marketOrder('BTCUSDT', 'BUY', '1', false, 'rb-in-2').catch((x: Error) => x)
    assert.ok(e instanceof Error)
    assert.match(e.message, /-2019: Margin is insufficient/)
    for (const s of ['the-key', 'the-secret', 'signature', new URL(c.urls[0]).searchParams.get('signature')!]) assert.ok(!e.message.includes(s), s)
  } finally {
    c.restore()
  }
})
