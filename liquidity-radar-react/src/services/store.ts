import type { CandleFlat } from './market'
import type { CrossExRow, DeepOb, LongShortRow, OiPoint } from '../features/advanced/advancedData'
import type { Liq } from '../features/advanced/liquidations'
import type { MarketCapEntry } from './coingecko'
import type { FuturesEntry } from './futures'

export interface AppState {
  symbol: string
  tab: string
  tf: string
  tickers: Record<string, { last: number; pct: number; qvol: number; high?: number; low?: number }>
  candles: CandleFlat[]
  ob: { bids: Array<Array<number | string>>; asks: Array<Array<number | string>> }
  fr: unknown
  oi: unknown
  fg: unknown
  whales: unknown[]
  wsOpen: number
  klineTick: number
  ctxCache: Record<string, unknown>
  mem: { lastCoin: string | null; topics: unknown[] }
  deepOb: DeepOb | null
  oiHist: OiPoint[] | null
  ls: LongShortRow[] | null
  crossEx: CrossExRow[]
  liqs: Liq[]
  liqWs: string
  marketCaps: Record<string, MarketCapEntry>
  futures: Record<string, FuturesEntry>
  [key: string]: unknown
}

// Single shared application state object. The engine's imperative code
// mutates it directly; typed modules only read the documented fields.
export const state: AppState = {
  symbol: 'BTCUSDT',
  tab: 'radar',
  tf: '15m',
  tickers: {},
  candles: [],
  ob: { bids: [], asks: [] },
  fr: null,
  oi: null,
  fg: null,
  whales: [],
  wsOpen: 0,
  klineTick: 0,
  ctxCache: {},
  mem: { lastCoin: null, topics: [] },
  deepOb: null,
  oiHist: null,
  ls: null,
  crossEx: [],
  liqs: [],
  liqWs: 'closed',
  marketCaps: {},
  futures: {},
}
