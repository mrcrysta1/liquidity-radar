// REST market-data polling loops. Faithful extraction of the engine's
// fetchTickers / fetchKlines / fetchOB / fetchFR / fetchOI / fetchFG /
// fetchWhales: endpoint calls, response parsing, market-state writes and
// cache/store updates live here. Every rendering/UI side effect is
// delegated through the hooks wired by the engine via wireMarketHooks()
// (the same pattern as userActions), so the engine stays pure orchestration.
import { COINS } from '../constants/market'
import { jget } from '../api/client'
import { state } from './store'
import {
  md,
  mdCacheGet,
  mdCachePut,
  mdDebug,
  mdFromK,
  mdStoreCandles,
  mdStoreOB,
  mdSym,
  mdTf,
} from './market'
import type { CandleFlat } from './market'

export interface MarketHooks {
  onTickers(): void
  onKlines(): void
  onKlineCache(): void
  onKlineFail(): void
  onOB(): void
  onFR(): void
  onFRfail(): void
  onOI(): void
  onOIfail(): void
  onFG(): void
  onFGfail(): void
  onWhales(): void
}

let hooks: MarketHooks | null = null

export function wireMarketHooks(h: MarketHooks): void {
  hooks = h
}

interface TickerEntry {
  last: number
  pct: number
  high: number
  low: number
  qvol: number
  trades: number
}

export async function fetchTickers(): Promise<void> {
  try {
    const syms = Object.values(COINS).map((c) => c.sym)
    const url =
      'https://api.binance.com/api/v3/ticker/24hr?symbols=' +
      encodeURIComponent(JSON.stringify(syms))
    const data = (await jget(url)) as Array<Record<string, unknown>>
    data.forEach((d) => {
      const entry: TickerEntry = {
        last: Number(d.lastPrice),
        pct: Number(d.priceChangePercent),
        high: Number(d.highPrice),
        low: Number(d.lowPrice),
        qvol: Number(d.quoteVolume),
        trades: Number(d.count),
      }
      state.tickers[d.symbol as string] = entry
    })
    hooks!.onTickers()
  } catch (e) {
    console.warn('tickers', e)
  }
}

export async function fetchKlines(sym: string): Promise<void> {
  try {
    const inter = mdTf(state.tf || '15m')
    const data = (await jget(
      'https://api.binance.com/api/v3/klines?symbol=' +
        mdSym(sym) +
        '&interval=' +
        inter +
        '&limit=200',
    )) as unknown[]
    const candles = data.map(mdFromK).filter((c): c is CandleFlat => !!c)
    if (!candles.length) throw new Error('empty')
    state.candles = candles
    mdStoreCandles(state.symbol, inter, candles)
    mdCachePut(state.symbol, inter, candles)
    hooks!.onKlines()
  } catch (e) {
    console.warn('klines', e)
    // REST fallback: serve recent cached candles so the chart isn't left blank
    const inter = mdTf(state.tf)
    const cached =
      mdCacheGet(state.symbol, inter) ||
      md.candles[mdSym(state.symbol) + '|' + inter] ||
      null
    if (cached && cached.length) {
      state.candles = cached
      mdDebug.log('klines', 'serving cached ' + state.symbol + ' ' + inter)
      hooks!.onKlineCache()
    } else {
      hooks!.onKlineFail()
    }
  }
}

export async function fetchOB(): Promise<void> {
  try {
    const d = (await jget(
      'https://api.binance.com/api/v3/depth?symbol=' +
        mdSym(state.symbol) +
        '&limit=15',
    )) as { bids: Array<Array<string | number>>; asks: Array<Array<string | number>> }
    const ob = { bids: d.bids.map((b) => [+b[0], +b[1]]), asks: d.asks.map((a) => [+a[0], +a[1]]) }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
    hooks!.onOB()
  } catch (e) {
    console.warn('depth', e)
  }
}

export async function fetchFR(): Promise<void> {
  try {
    state.fr = await jget(
      'https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + state.symbol,
    )
    hooks!.onFR()
  } catch (e) {
    console.warn('premiumIndex', e)
    hooks!.onFRfail()
  }
}

export async function fetchOI(): Promise<void> {
  try {
    state.oi = await jget(
      'https://fapi.binance.com/fapi/v1/openInterest?symbol=' + state.symbol,
    )
    hooks!.onOI()
  } catch (e) {
    console.warn('openInterest', e)
    hooks!.onOIfail()
  }
}

export async function fetchFG(): Promise<void> {
  try {
    const d = (await jget('https://api.alternative.me/fng/')) as { data?: unknown[] }
    if (d.data && d.data[0]) {
      state.fg = d.data[0]
      hooks!.onFG()
    }
  } catch (e) {
    console.warn('fng', e)
    hooks!.onFGfail()
  }
}

interface WhaleTape {
  id: unknown
  time: number
  price: number
  qty: number
  usd: number
  maker: unknown
}

export async function fetchWhales(): Promise<void> {
  try {
    const trades = (await jget(
      'https://api.binance.com/api/v3/trades?symbol=' + state.symbol + '&limit=1000',
    )) as Array<{ id: unknown; time: unknown; price: unknown; qty: unknown; isBuyerMaker: unknown }>
    const big: WhaleTape[] = trades
      .map((t) => ({
        id: t.id,
        time: Number(t.time),
        price: Number(t.price),
        qty: Number(t.qty),
        usd: Number(t.price) * Number(t.qty),
        maker: t.isBuyerMaker,
      }))
      .filter((t) => t.usd >= 50000)
      .sort((a, b) => b.time - a.time)
      .slice(0, 40)
    state.whales = big
    hooks!.onWhales()
  } catch (e) {
    console.warn('trades', e)
  }
}