// A snapshot of the Binance futures account, exactly as Binance reports it, so
// the website can show the same balance, positions, orders and fills as the
// Binance panel. The exchange keys stay here; the site only reads the snapshot
// (bot_state key 'account', public read like the other bot tables).
//
// Pure helpers (tested in test/bot-account.test.ts); bot.ts fetches and saves.

export interface AccountPosition {
  symbol: string
  side: 'LONG' | 'SHORT'
  /** Base quantity, positive. */
  size: number
  entry: number
  mark: number
  unrealized: number
  leverage: number
  liquidation: number
  /** Margin locked by the position (isolated) or its initial margin (cross). */
  margin: number
  notional: number
}

export interface AccountOrder {
  symbol: string
  side: 'BUY' | 'SELL'
  type: string
  /** Limit price or trigger price. */
  price: number
  qty: number
  reduceOnly: boolean
}

export interface AccountFill {
  symbol: string
  time: number
  side: 'BUY' | 'SELL'
  price: number
  qty: number
  realizedPnl: number
  commission: number
}

export interface AccountSnapshot {
  /** When it was read, ms. */
  t: number
  venue: string
  asset: 'USDT'
  /** Binance "Wallet Balance". */
  walletBalance: number
  /** Binance "Unrealized PNL". */
  unrealizedPnl: number
  /** Binance "Margin Balance" = wallet + unrealized. */
  marginBalance: number
  /** Binance "Available Balance". */
  availableBalance: number
  positions: AccountPosition[]
  orders: AccountOrder[]
  fills: AccountFill[]
}

const n = (v: unknown) => {
  const x = Number(v)
  return isFinite(x) ? x : 0
}

/** /fapi/v2/account → balances and open positions (non-zero only). */
export function accountFromBinance(raw: unknown, t: number, venue: string): Omit<AccountSnapshot, 'orders' | 'fills'> {
  const a = (raw ?? {}) as Record<string, unknown>
  const assets = (Array.isArray(a.assets) ? a.assets : []) as Array<Record<string, unknown>>
  const usdt = assets.find((x) => x.asset === 'USDT') ?? {}
  const positions = ((Array.isArray(a.positions) ? a.positions : []) as Array<Record<string, unknown>>)
    .filter((p) => n(p.positionAmt) !== 0)
    .map((p) => {
      const amt = n(p.positionAmt)
      return {
        symbol: String(p.symbol),
        side: amt > 0 ? ('LONG' as const) : ('SHORT' as const),
        size: Math.abs(amt),
        entry: n(p.entryPrice),
        mark: n(p.markPrice),
        unrealized: n(p.unrealizedProfit ?? p.unRealizedProfit),
        leverage: n(p.leverage),
        liquidation: n(p.liquidationPrice),
        margin: n(p.isolatedWallet) || n(p.initialMargin),
        notional: Math.abs(n(p.notional)),
      }
    })
  return {
    t,
    venue,
    asset: 'USDT',
    walletBalance: n(usdt.walletBalance ?? a.totalWalletBalance),
    unrealizedPnl: n(usdt.unrealizedProfit ?? a.totalUnrealizedProfit),
    marginBalance: n(usdt.marginBalance ?? a.totalMarginBalance),
    availableBalance: n(usdt.availableBalance ?? a.availableBalance),
    positions,
  }
}

/** Open orders: regular ones (/fapi/v1/openOrders) and algo/conditional ones (stops). */
export function ordersFromBinance(regular: unknown, algo: unknown): AccountOrder[] {
  const out: AccountOrder[] = []
  for (const o of (Array.isArray(regular) ? regular : []) as Array<Record<string, unknown>>)
    out.push({
      symbol: String(o.symbol),
      side: o.side === 'SELL' ? 'SELL' : 'BUY',
      type: String(o.type),
      price: n(o.price) || n(o.stopPrice),
      qty: n(o.origQty),
      reduceOnly: !!o.reduceOnly,
    })
  const algoList = Array.isArray(algo) ? algo : ((algo as { orders?: unknown[] })?.orders ?? [])
  for (const o of algoList as Array<Record<string, unknown>>)
    out.push({
      symbol: String(o.symbol),
      side: o.side === 'SELL' ? 'SELL' : 'BUY',
      type: String(o.orderType ?? o.type ?? 'ALGO'),
      price: n(o.triggerPrice) || n(o.price),
      qty: n(o.quantity) || n(o.origQty),
      reduceOnly: o.reduceOnly !== false,
    })
  return out
}

/** The exchange calls readAccount needs (the bot's Futures client provides them). */
export interface AccountSource {
  base: string
  account(): Promise<unknown>
  openOrders(): Promise<unknown>
  openAlgo(symbol: string): Promise<unknown[]>
  fills(symbol: string, startTime: number): Promise<Array<{ time: number; side: 'BUY' | 'SELL'; price: number; qty: number; realizedPnl: number; commission: number }>>
}

/**
 * Read the whole account the way the Binance panel shows it. `fills` (last 7
 * days) costs more requests, so callers pass the previous list to reuse it.
 */
export async function readAccount(ex: AccountSource, symbols: string[], now: number, prevFills?: AccountFill[]): Promise<AccountSnapshot> {
  const acc = accountFromBinance(await ex.account(), now, ex.base)
  const syms = [...new Set([...symbols, ...acc.positions.map((p) => p.symbol)])]
  const algo = (await Promise.all(syms.map((s) => ex.openAlgo(s).then((r) => (r as object[]).map((o) => ({ ...o, symbol: s }))).catch(() => [])))).flat()
  const orders = ordersFromBinance(await ex.openOrders(), algo)
  let fills = prevFills
  if (!fills) {
    const since = now - 7 * 86_400_000
    const all = (await Promise.all(syms.map((s) => ex.fills(s, since).then((f) => f.map((x) => ({ ...x, symbol: s }))).catch(() => [])))).flat()
    fills = all
      .sort((a, b) => b.time - a.time)
      .slice(0, 50)
      .map((f) => ({ symbol: f.symbol, time: f.time, side: f.side, price: f.price, qty: f.qty, realizedPnl: f.realizedPnl, commission: f.commission }))
  }
  return { ...acc, orders, fills }
}
