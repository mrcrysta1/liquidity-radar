// Signed client for Binance USDⓈ-M Futures — the testnet by default.
//
// Safety: TESTNET ONLY. The base URL must be one of the exact testnet hosts in
// TESTNET_BASES; anything else (mainnet, a typo, a look-alike host, a URL with
// credentials or a path) makes the constructor throw, so the bot refuses to
// start. There is no override. Keys only ever come from the environment; they
// are never logged.
import { createHmac } from 'node:crypto'

export const TESTNET = 'https://demo-fapi.binance.com'
/** The only base URLs the client will ever sign requests for (Binance Futures testnet / Demo). */
export const TESTNET_BASES: readonly string[] = Object.freeze(['https://demo-fapi.binance.com', 'https://testnet.binancefuture.com'])

/** The base URL, trailing slashes removed, if it is an allowed testnet base; otherwise throws. */
export function assertTestnetBase(base: unknown): string {
  const b = typeof base === 'string' ? base.trim().replace(/\/+$/, '') : ''
  if (!TESTNET_BASES.includes(b))
    throw new Error(`Refusing to start: ${JSON.stringify(base)} is not a Binance Futures testnet base URL (allowed: ${TESTNET_BASES.join(', ')})`)
  return b
}

export function sign(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex')
}

export class BinanceError extends Error {
  code: number
  status: number
  constructor(status: number, code: number, msg: string) {
    super(`Binance ${status} ${code}: ${msg}`)
    this.code = code
    this.status = status
  }
}

/**
 * Setup rejections that mean "already so" or "cannot change right now while
 * orders or a position are open" — the current setting stays and the bot goes on:
 * -4046 no need to change margin type, -4059 no need to change position side,
 * -4047 / -4048 margin type cannot change with open orders / a position,
 * -4067 position side cannot change with open orders (the testnet also answers
 * it to margin-type changes), -4068 position side cannot change with a position.
 */
export const SETUP_NON_FATAL: readonly number[] = Object.freeze([-4046, -4059, -4047, -4048, -4067, -4068])

function tolerate(e: unknown, what: string): void {
  if (!(e instanceof BinanceError) || !SETUP_NON_FATAL.includes(e.code)) throw e
  if (e.code !== -4046 && e.code !== -4059) console.warn(`[futures] ${what} (${e.message})`)
}

type Params = Record<string, string | number | boolean | undefined>

export interface SymbolRules {
  tickSize: number
  stepSize: number
  minQty: number
  minNotional: number
  pricePrecision: number
  quantityPrecision: number
}

export interface Position {
  symbol: string
  amt: number // signed: > 0 long, < 0 short
  entry: number
  mark: number
  unrealized: number
}

export interface Fill {
  id: number
  orderId: number
  time: number
  side: 'BUY' | 'SELL'
  price: number
  qty: number
  realizedPnl: number
  commission: number
  commissionAsset: string
}

interface ExchangeInfo {
  symbols: Array<{ symbol: string; status?: string; pricePrecision: number; quantityPrecision: number; filters: Array<Record<string, string>> }>
}

export class Futures {
  readonly base: string
  private key: string
  private secret: string
  private offset = 0

  constructor(key: string, secret: string, base = TESTNET) {
    this.base = assertTestnetBase(base)
    this.key = key
    this.secret = secret
  }

  /** Always true: the constructor refuses any base URL that is not an allowed testnet. */
  get isTestnet(): boolean {
    return TESTNET_BASES.includes(this.base)
  }

  /**
   * Align with the exchange clock, so signed requests are not rejected
   * (-1021). On a slow or jittery link one sample can be off by half its
   * round trip, so take several and trust the fastest.
   */
  async syncTime(samples = 5): Promise<void> {
    let best = Infinity
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now()
      const r = (await this.request('GET', '/fapi/v1/time', {}, false)) as { serverTime: number }
      const t1 = Date.now()
      if (t1 - t0 < best) {
        best = t1 - t0
        this.offset = r.serverTime - Math.round((t0 + t1) / 2)
      }
    }
    this.lastSync = Date.now()
  }

  private lastSync = 0

  async request(method: string, path: string, p: Params = {}, signed = true, retried = false): Promise<unknown> {
    // Drift builds up over hours; re-measure every 10 minutes.
    if (signed && Date.now() - this.lastSync > 600_000) await this.syncTime().catch(() => {})
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(p)) if (v !== undefined) qs.set(k, String(v))
    if (signed) {
      // Binance rejects a timestamp more than 1s ahead of its clock, but
      // accepts one up to recvWindow behind. So stamp a second behind the
      // best estimate and allow a wide window for slow links.
      qs.set('recvWindow', '10000')
      qs.set('timestamp', String(Date.now() + this.offset - 1000))
      qs.set('signature', sign(qs.toString(), this.secret))
    }
    // Defence in depth: never sign or send anything to a host off the allowlist.
    const url = assertTestnetBase(this.base) + path + (qs.size ? '?' + qs.toString() : '')
    const send = () =>
      fetch(url, {
        method,
        headers: signed ? { 'X-MBX-APIKEY': this.key } : {},
        signal: AbortSignal.timeout(20_000),
      })
    let r: Response
    if (method === 'GET') {
      // Reads are safe to repeat: retry network failures a few times.
      let attempt = 0
      for (;;) {
        try {
          r = await send()
          break
        } catch (e) {
          if (++attempt >= 3) throw e
          await new Promise((res) => setTimeout(res, 1500 * attempt))
        }
      }
    } else {
      // Never repeat a write blindly: a timed-out order may still have filled.
      // The trader reconciles positions it has no record of on the next tick.
      r = await send()
    }
    const text = await r.text()
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
    if (!r.ok) {
      const e = body as { code?: number; msg?: string }
      if (e?.code === -1021 && signed && !retried) {
        // Clock out of step: re-measure and send once more with a fresh stamp.
        await this.syncTime().catch(() => {})
        return this.request(method, path, p, signed, true)
      }
      throw new BinanceError(r.status, e?.code ?? 0, e?.msg ?? String(text).slice(0, 200))
    }
    return body
  }

  /** exchangeInfo, kept for 10 minutes: every market's setup reads it, and it is large. */
  private infoAt = 0
  private infoP: Promise<ExchangeInfo> | null = null
  private exchangeInfo(): Promise<ExchangeInfo> {
    if (!this.infoP || Date.now() - this.infoAt > 10 * 60_000) {
      this.infoAt = Date.now()
      this.infoP = (this.request('GET', '/fapi/v1/exchangeInfo', {}, false) as Promise<ExchangeInfo>).catch((e) => {
        this.infoP = null
        throw e
      })
    }
    return this.infoP
  }

  /** Symbols this venue lists and currently trades (status TRADING). */
  async tradingSymbols(): Promise<Set<string>> {
    const info = await this.exchangeInfo()
    return new Set(info.symbols.filter((x) => x.status === undefined || x.status === 'TRADING').map((x) => x.symbol))
  }

  async rules(symbol: string): Promise<SymbolRules> {
    const info = await this.exchangeInfo()
    const s = info.symbols.find((x) => x.symbol === symbol)
    if (!s) throw new Error(symbol + ' is not listed on ' + this.base)
    const f = (type: string) => s.filters.find((x) => x.filterType === type) || {}
    return {
      tickSize: Number(f('PRICE_FILTER').tickSize),
      stepSize: Number(f('MARKET_LOT_SIZE').stepSize || f('LOT_SIZE').stepSize),
      minQty: Number(f('MARKET_LOT_SIZE').minQty || f('LOT_SIZE').minQty),
      minNotional: Number(f('MIN_NOTIONAL').notional || 5),
      pricePrecision: s.pricePrecision,
      quantityPrecision: s.quantityPrecision,
    }
  }

  /** USDT equity (wallet + unrealized), or null when the USDT row is missing or unreadable — never a false 0. */
  async balanceUsdt(): Promise<number | null> {
    const rows = (await this.request('GET', '/fapi/v2/balance')) as Array<{ asset: string; balance: string; crossUnPnl: string }>
    const u = Array.isArray(rows) ? rows.find((x) => x.asset === 'USDT') : undefined
    if (!u) return null
    const v = Number(u.balance) + Number(u.crossUnPnl || 0)
    return Number.isFinite(v) ? v : null
  }

  async position(symbol: string): Promise<Position> {
    const rows = (await this.request('GET', '/fapi/v2/positionRisk', { symbol })) as Array<Record<string, string>>
    const p = rows.find((x) => x.symbol === symbol && (x.positionSide || 'BOTH') === 'BOTH') || rows[0] || {}
    return toPosition(symbol, p)
  }

  /**
   * Every symbol's one-way position in one request: /fapi/v2/positionRisk
   * without a symbol costs the same weight (5) as with one. Shared by all
   * traders through a PositionBook.
   */
  async positions(): Promise<Position[]> {
    const rows = (await this.request('GET', '/fapi/v2/positionRisk')) as unknown
    if (!Array.isArray(rows)) throw new Error('positionRisk: unexpected response')
    return (rows as Array<Record<string, string>>).filter((x) => x?.symbol && (x.positionSide || 'BOTH') === 'BOTH').map((x) => toPosition(x.symbol, x))
  }

  /**
   * One-way mode, isolated margin and the leverage, for one symbol. Reads the
   * current settings first and only changes what differs, so a symbol that is
   * already set up never hits the "cannot change while orders/positions are
   * open" rejections. A change the exchange refuses for that reason, or calls
   * unnecessary, is not fatal (SETUP_NON_FATAL): the current setting is kept.
   */
  async setup(symbol: string, leverage: number): Promise<void> {
    await this.ensureOneWay()
    let cur: Record<string, string> | undefined
    try {
      const rows = (await this.request('GET', '/fapi/v2/positionRisk', { symbol })) as unknown
      if (Array.isArray(rows)) cur = rows.find((x) => x?.symbol === symbol && (x.positionSide || 'BOTH') === 'BOTH') ?? rows[0]
    } catch {
      cur = undefined // unknown: fall back to setting both
    }
    if (String(cur?.marginType ?? '').toLowerCase() !== 'isolated')
      await this.request('POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' }).catch((e) => tolerate(e, `${symbol}: margin type left unchanged`))
    if (!(Number(cur?.leverage) === leverage)) await this.request('POST', '/fapi/v1/leverage', { symbol, leverage })
  }

  private oneWayChecked = false

  /** The bot trades one-way (positionSide BOTH). Account-wide, so checked once per process. */
  async ensureOneWay(): Promise<void> {
    if (this.oneWayChecked) return
    const r = (await this.request('GET', '/fapi/v1/positionSide/dual').catch(() => null)) as { dualSidePosition?: boolean | string } | null
    if (r && (r.dualSidePosition === true || r.dualSidePosition === 'true'))
      await this.request('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }).catch((e) => tolerate(e, 'position mode left at hedge'))
    // Only a successful read counts: an unreadable mode is checked again next time.
    if (r) this.oneWayChecked = true
  }

  async marketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: string, reduceOnly = false, clientId?: string) {
    return (await this.request('POST', '/fapi/v1/order', {
      symbol,
      side,
      type: 'MARKET',
      quantity,
      reduceOnly: reduceOnly ? 'true' : undefined,
      newClientOrderId: clientId,
      newOrderRespType: 'RESULT',
    })) as { orderId: number; avgPrice: string; executedQty: string; status: string; updateTime: number }
  }

  /** Exchange-side stop or target that closes the whole position (Algo Order API). */
  async bracketLeg(symbol: string, side: 'BUY' | 'SELL', type: 'STOP_MARKET' | 'TAKE_PROFIT_MARKET', triggerPrice: string, clientAlgoId: string) {
    return (await this.request('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL',
      symbol,
      side,
      type,
      triggerPrice,
      closePosition: 'true',
      workingType: 'MARK_PRICE',
      priceProtect: 'true',
      clientAlgoId,
    })) as { algoId: number; algoStatus: string }
  }

  /**
   * Take-profit as a resting post-only (GTX) reduce-only limit: it can only
   * fill as maker. Binance expires it instead if it would cross on arrival,
   * i.e. price is already through the target.
   */
  async takeProfitLimit(symbol: string, side: 'BUY' | 'SELL', quantity: string, price: string, clientId: string) {
    return (await this.request('POST', '/fapi/v1/order', {
      symbol,
      side,
      type: 'LIMIT',
      timeInForce: 'GTX',
      reduceOnly: 'true',
      quantity,
      price,
      newClientOrderId: clientId,
      newOrderRespType: 'RESULT',
    })) as { orderId: number; status: string }
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    await this.request('DELETE', '/fapi/v1/allOpenOrders', { symbol }).catch(() => {})
  }

  async cancelAllAlgo(symbol: string): Promise<void> {
    await this.request('DELETE', '/fapi/v1/algoOpenOrders', { symbol }).catch(() => {})
  }

  /** Cancel one algo order (a stop being replaced by a trailed one). Throws on failure, so the caller can log it. */
  async cancelAlgo(symbol: string, algoId: number): Promise<void> {
    await this.request('DELETE', '/fapi/v1/algoOrder', { symbol, algoId })
  }

  /** Whole account, as the Binance panel shows it (balances and positions). */
  async account(): Promise<unknown> {
    return this.request('GET', '/fapi/v2/account')
  }

  /** Every open regular order (limits, take-profits), all symbols. */
  async openOrders(): Promise<unknown> {
    return this.request('GET', '/fapi/v1/openOrders')
  }

  async openAlgo(symbol: string): Promise<Array<{ algoId: number; orderType: string; triggerPrice: string; clientAlgoId: string }>> {
    const r = (await this.request('GET', '/fapi/v1/openAlgoOrders', { symbol })) as unknown
    return Array.isArray(r) ? (r as never) : ((r as { orders?: never[] })?.orders ?? [])
  }

  async fills(symbol: string, startTime: number): Promise<Fill[]> {
    const rows = (await this.request('GET', '/fapi/v1/userTrades', { symbol, startTime, limit: 1000 })) as Array<Record<string, string | number | boolean>>
    return rows.map((x) => ({
      id: Number(x.id),
      orderId: Number(x.orderId),
      time: Number(x.time),
      side: x.side as 'BUY' | 'SELL',
      price: Number(x.price),
      qty: Number(x.qty),
      realizedPnl: Number(x.realizedPnl),
      commission: Number(x.commission),
      commissionAsset: String(x.commissionAsset),
    }))
  }
}

function toPosition(symbol: string, p: Record<string, string>): Position {
  return {
    symbol,
    amt: Number(p.positionAmt || 0),
    entry: Number(p.entryPrice || 0),
    mark: Number(p.markPrice || 0),
    unrealized: Number(p.unRealizedProfit || 0),
  }
}

/**
 * The positions of every market, read with ONE request and shared by all
 * traders in a tick, instead of one positionRisk request per market.
 *
 * Safety: the book is cleared at the start of every tick (bot.ts), so a read
 * never crosses ticks, and within a tick it is refreshed once it is older than
 * maxAgeMs. Traders use it only for their first read of the tick, before they
 * act; every read after one of their own orders asks the exchange for that
 * market alone. A market missing from the read, or a failed read, gives null:
 * the trader then reads its own market as before — never an assumed "flat".
 */
export class PositionBook {
  /** Requests sent (for tests and the run log). */
  reads = 0
  private readAll: () => Promise<Position[]>
  private maxAgeMs: number
  private clock: () => number
  private at = -Infinity
  private p: Promise<Map<string, Position>> | null = null

  constructor(readAll: () => Promise<Position[]>, o: { maxAgeMs?: number; now?: () => number } = {}) {
    this.readAll = readAll
    this.maxAgeMs = o.maxAgeMs ?? 5_000
    this.clock = o.now ?? Date.now
  }

  /** Drop what is held: the next get() reads again. */
  clear(): void {
    this.p = null
  }

  async get(symbol: string): Promise<Position | null> {
    const now = this.clock()
    if (!this.p || now - this.at > this.maxAgeMs) {
      this.at = now
      this.reads++
      this.p = this.readAll().then((rows) => new Map(rows.map((r) => [r.symbol, r])))
    }
    try {
      return (await this.p).get(symbol) ?? null
    } catch {
      return null
    }
  }
}

/** Round down to the exchange step, formatted to its precision. */
export function roundStep(v: number, step: number, precision: number): string {
  const n = Math.floor(v / step + 1e-9) * step
  return n.toFixed(Math.max(0, precision))
}

/** Round to the nearest tick, formatted to its precision. */
export function roundTick(v: number, tick: number, precision: number): string {
  return (Math.round(v / tick) * tick).toFixed(Math.max(0, precision))
}
