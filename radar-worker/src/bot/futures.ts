// Signed client for Binance USDⓈ-M Futures — the testnet by default.
//
// Safety: the base URL defaults to the testnet, and pointing it anywhere else
// requires ALLOW_MAINNET=yes as well. Keys only ever come from the
// environment; they are never logged.
import { createHmac } from 'node:crypto'

export const TESTNET = 'https://demo-fapi.binance.com'
const MAINNET = 'https://fapi.binance.com'

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

export class Futures {
  readonly base: string
  private key: string
  private secret: string
  private offset = 0

  constructor(key: string, secret: string, base = TESTNET) {
    const b = base.replace(/\/+$/, '')
    if (b === MAINNET && process.env.ALLOW_MAINNET !== 'yes')
      throw new Error('Refusing to trade on mainnet: set ALLOW_MAINNET=yes if that is really intended.')
    this.base = b
    this.key = key
    this.secret = secret
  }

  get isTestnet(): boolean {
    return this.base !== MAINNET
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
    const url = this.base + path + (qs.size ? '?' + qs.toString() : '')
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

  async rules(symbol: string): Promise<SymbolRules> {
    const info = (await this.request('GET', '/fapi/v1/exchangeInfo', {}, false)) as {
      symbols: Array<{ symbol: string; pricePrecision: number; quantityPrecision: number; filters: Array<Record<string, string>> }>
    }
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

  async balanceUsdt(): Promise<number> {
    const rows = (await this.request('GET', '/fapi/v2/balance')) as Array<{ asset: string; balance: string; crossUnPnl: string }>
    const u = rows.find((x) => x.asset === 'USDT')
    return u ? Number(u.balance) + Number(u.crossUnPnl || 0) : 0
  }

  async position(symbol: string): Promise<Position> {
    const rows = (await this.request('GET', '/fapi/v2/positionRisk', { symbol })) as Array<Record<string, string>>
    const p = rows.find((x) => x.symbol === symbol && (x.positionSide || 'BOTH') === 'BOTH') || rows[0] || {}
    return {
      symbol,
      amt: Number(p.positionAmt || 0),
      entry: Number(p.entryPrice || 0),
      mark: Number(p.markPrice || 0),
      unrealized: Number(p.unRealizedProfit || 0),
    }
  }

  async setup(symbol: string, leverage: number): Promise<void> {
    await this.request('POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' }).catch((e) => {
      if (!(e instanceof BinanceError) || e.code !== -4046) throw e // -4046: already isolated
    })
    await this.request('POST', '/fapi/v1/leverage', { symbol, leverage })
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

/** Round down to the exchange step, formatted to its precision. */
export function roundStep(v: number, step: number, precision: number): string {
  const n = Math.floor(v / step + 1e-9) * step
  return n.toFixed(Math.max(0, precision))
}

/** Round to the nearest tick, formatted to its precision. */
export function roundTick(v: number, tick: number, precision: number): string {
  return (Math.round(v / tick) * tick).toFixed(Math.max(0, precision))
}
